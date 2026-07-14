from flask import Flask, request, jsonify
from flask_cors import CORS
from pymongo import MongoClient
from datetime import datetime
from functools import wraps
from bson.objectid import ObjectId
from bson.errors import InvalidId
import os
import base64
import hashlib
import logging
import re

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# CORS - Restrict to specific origins in production
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*")
if ALLOWED_ORIGINS == "*":
    CORS(app)
else:
    CORS(app, origins=ALLOWED_ORIGINS.split(","))

# MongoDB Connection
MONGO_URI = os.getenv("MONGO_URI")
if not MONGO_URI:
    raise RuntimeError("MONGO_URI environment variable is not set.")

DB_NAME = os.getenv("DB_NAME", "location_tracker")
MAX_IMAGE_SIZE_MB = int(os.getenv("MAX_IMAGE_SIZE_MB", "5"))

try:
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    # Verify connection
    client.admin.command('ping')
    logger.info("Successfully connected to MongoDB")
except Exception as e:
    logger.error(f"Failed to connect to MongoDB: {e}")
    raise RuntimeError(f"MongoDB connection failed: {e}")

db = client[DB_NAME]
locations_collection = db["locations"]
selfies_collection = db["selfies"]

# Create indexes for better query performance
locations_collection.create_index("selfie_id")
locations_collection.create_index("timestamp")
selfies_collection.create_index("location_id")
selfies_collection.create_index("timestamp")

# Admin API key
ADMIN_API_KEY = os.getenv("ADMIN_API_KEY")


def require_api_key(view_func):
    """Guards an endpoint so only requests with the correct API key can read data."""
    @wraps(view_func)
    def wrapped(*args, **kwargs):
        if not ADMIN_API_KEY:
            logger.warning("ADMIN_API_KEY not configured")
            return jsonify({
                "success": False,
                "message": "Server is not configured with an admin API key."
            }), 500

        provided_key = request.headers.get("X-API-Key")
        if not provided_key:
            return jsonify({
                "success": False,
                "message": "API key is required. Set X-API-Key header."
            }), 401

        # Constant-time comparison to prevent timing attacks
        if len(provided_key) != len(ADMIN_API_KEY) or not hmac_compare(provided_key, ADMIN_API_KEY):
            return jsonify({
                "success": False,
                "message": "Unauthorized. Invalid API key."
            }), 401

        return view_func(*args, **kwargs)
    return wrapped


def hmac_compare(a, b):
    """Constant-time string comparison to prevent timing attacks."""
    return hashlib.sha256(a.encode()).digest() == hashlib.sha256(b.encode()).digest()


def validate_image_size(image_data):
    """Validate that the decoded image is within size limits."""
    try:
        decoded = base64.b64decode(image_data)
        size_mb = len(decoded) / (1024 * 1024)
        if size_mb > MAX_IMAGE_SIZE_MB:
            return False, f"Image too large ({size_mb:.1f} MB). Maximum is {MAX_IMAGE_SIZE_MB} MB."
        return True, None
    except Exception:
        return False, "Invalid base64 image data."


@app.route("/", methods=["GET"])
def home():
    return jsonify({
        "status": "online",
        "database": f"MongoDB Connected ({DB_NAME})",
        "message": "Location Tracker API Running",
        "version": "2.0.0"
    })


@app.route("/selfie", methods=["POST"])
def save_selfie():
    """
    Receives a selfie image from the frontend.
    Accepts:
      - multipart/form-data with an 'image' field (file upload)
      - JSON with a base64-encoded 'image' field
    
    Validates image data and size before saving.
    Returns the selfie ID for linking with location data.
    """
    try:
        image_data = None
        timestamp = datetime.utcnow().isoformat() + "Z"

        # Handle multipart file upload
        if request.files:
            file = request.files.get("image")
            if file and file.filename:
                # Validate filename to prevent path traversal
                filename = re.sub(r'[^\w\.\-]', '_', file.filename)
                file_content = file.read()
                image_data = base64.b64encode(file_content).decode("utf-8")
                timestamp = request.form.get("timestamp", timestamp)

        # Handle JSON payload with base64 image
        if not image_data and request.is_json:
            data = request.get_json(silent=True)
            if data and data.get("image"):
                image_data = data["image"]
                timestamp = data.get("timestamp", timestamp)

        if not image_data:
            return jsonify({
                "success": False,
                "message": "No image data received. Send 'image' field as file or base64 JSON."
            }), 400

        # Validate image size
        size_valid, size_error = validate_image_size(image_data)
        if not size_valid:
            return jsonify({
                "success": False,
                "message": size_error
            }), 413  # Payload Too Large

        # Create record
        selfie_record = {
            "image_base64": image_data,
            "timestamp": timestamp,
            "location_id": None,
            "received_at": datetime.utcnow().isoformat() + "Z",
            "ip_address": request.headers.get("X-Forwarded-For", request.remote_addr),
            "user_agent": (request.headers.get("User-Agent") or "")[:500]  # Limit length
        }

        result = selfies_collection.insert_one(selfie_record)
        selfie_id = str(result.inserted_id)

        logger.info(f"New selfie saved: {selfie_id} | IP: {selfie_record['ip_address']}")

        return jsonify({
            "success": True,
            "message": "Selfie uploaded successfully.",
            "id": selfie_id
        })

    except Exception as e:
        logger.error(f"Selfie upload error: {e}", exc_info=True)
        return jsonify({
            "success": False,
            "message": "Internal server error. Please try again."
        }), 500


@app.route("/location", methods=["POST"])
def save_location():
    """
    Receives location data from the frontend.
    Requires:
      - consent: true (confirms user was notified)
      - latitude, longitude
      - selfie_id: ID from the selfie endpoint
    
    Links the location back to the selfie record.
    """
    try:
        data = request.get_json(silent=True)

        if not data:
            return jsonify({
                "success": False,
                "message": "No JSON data received. Send Content-Type: application/json."
            }), 400

        # Require consent confirmation
        if not data.get("consent"):
            return jsonify({
                "success": False,
                "message": "Consent not confirmed. Set 'consent: true' to save location."
            }), 400

        # Validate required fields
        latitude = data.get("latitude")
        longitude = data.get("longitude")
        selfie_id = data.get("selfie_id")

        if latitude is None or longitude is None:
            return jsonify({
                "success": False,
                "message": "latitude and longitude are required."
            }), 400

        # Validate coordinate ranges
        try:
            lat = float(latitude)
            lng = float(longitude)
            if lat < -90 or lat > 90:
                return jsonify({"success": False, "message": "Invalid latitude (-90 to 90)."}), 400
            if lng < -180 or lng > 180:
                return jsonify({"success": False, "message": "Invalid longitude (-180 to 180)."}), 400
        except (ValueError, TypeError):
            return jsonify({"success": False, "message": "Latitude and longitude must be numeric."}), 400

        # Validate selfie_id if provided
        if selfie_id:
            try:
                selfie_exists = selfies_collection.find_one({"_id": ObjectId(selfie_id)})
                if not selfie_exists:
                    logger.warning(f"Selfie ID {selfie_id} not found — saving location without link")
                    selfie_id = None
            except InvalidId:
                logger.warning(f"Invalid selfie_id format: {selfie_id}")
                selfie_id = None

        # Get accuracy with fallback
        accuracy = data.get("accuracy")
        if accuracy is not None:
            try:
                accuracy = float(accuracy)
            except (ValueError, TypeError):
                accuracy = None

        location = {
            "latitude": lat,
            "longitude": lng,
            "accuracy": accuracy,
            "altitude": data.get("altitude"),
            "altitude_accuracy": data.get("altitudeAccuracy"),
            "heading": data.get("heading"),
            "speed": data.get("speed"),
            "selfie_id": selfie_id,
            "timestamp": data.get("timestamp", datetime.utcnow().isoformat() + "Z"),
            "received_at": datetime.utcnow().isoformat() + "Z",
            "ip_address": request.headers.get("X-Forwarded-For", request.remote_addr),
            "user_agent": (request.headers.get("User-Agent") or "")[:500],
            "google_maps": f"https://www.google.com/maps?q={lat},{lng}"
        }

        result = locations_collection.insert_one(location)
        loc_id = str(result.inserted_id)

        # Update the selfie record with the location ID
        if selfie_id:
            selfies_collection.update_one(
                {"_id": ObjectId(selfie_id)},
                {"$set": {"location_id": loc_id}}
            )
            logger.info(f"Linked selfie {selfie_id} to location {loc_id}")

        logger.info(f"New location saved: {loc_id} | Lat: {lat}, Lng: {lng}")

        return jsonify({
            "success": True,
            "message": "Location saved successfully.",
            "id": loc_id,
            "google_maps": location["google_maps"]
        })

    except Exception as e:
        logger.error(f"Location save error: {e}", exc_info=True)
        return jsonify({
            "success": False,
            "message": "Internal server error. Please try again."
        }), 500


@app.route("/locations", methods=["GET"])
@require_api_key
def get_locations():
    """
    Returns all stored locations with their linked selfie images.
    Protected by X-API-Key header.
    
    Supports optional query parameters:
      - limit: max number of records (default: 100, max: 1000)
      - skip: pagination offset
    """
    try:
        limit = min(int(request.args.get("limit", 100)), 1000)
        skip = int(request.args.get("skip", 0))
    except (ValueError, TypeError):
        limit = 100
        skip = 0

    locations = []

    for doc in locations_collection.find().sort("received_at", -1).skip(skip).limit(limit):
        # Fetch linked selfie
        photo = None
        selfie_id = doc.get("selfie_id")
        if selfie_id:
            try:
                selfie_doc = selfies_collection.find_one({"_id": ObjectId(selfie_id)})
                if selfie_doc:
                    photo = selfie_doc.get("image_base64")
            except InvalidId:
                pass

        locations.append({
            "id": str(doc["_id"]),
            "latitude": doc.get("latitude"),
            "longitude": doc.get("longitude"),
            "accuracy": doc.get("accuracy"),
            "altitude": doc.get("altitude"),
            "heading": doc.get("heading"),
            "speed": doc.get("speed"),
            "photo": photo,
            "selfie_id": doc.get("selfie_id"),
            "timestamp": doc.get("timestamp"),
            "received_at": doc.get("received_at"),
            "ip_address": doc.get("ip_address"),
            "user_agent": doc.get("user_agent"),
            "google_maps": doc.get("google_maps")
        })

    total = locations_collection.count_documents({})

    return jsonify({
        "success": True,
        "count": len(locations),
        "total": total,
        "limit": limit,
        "skip": skip,
        "locations": locations
    })


@app.route("/selfies", methods=["GET"])
@require_api_key
def get_selfies():
    """
    Returns all captured selfies with their linked location data.
    Protected by X-API-Key header.
    """
    try:
        limit = min(int(request.args.get("limit", 100)), 1000)
        skip = int(request.args.get("skip", 0))
    except (ValueError, TypeError):
        limit = 100
        skip = 0

    selfies = []

    for doc in selfies_collection.find().sort("received_at", -1).skip(skip).limit(limit):
        # Fetch linked location data
        linked_location = None
        location_id = doc.get("location_id")
        if location_id:
            try:
                loc_doc = locations_collection.find_one({"_id": ObjectId(location_id)})
                if loc_doc:
                    linked_location = {
                        "latitude": loc_doc.get("latitude"),
                        "longitude": loc_doc.get("longitude"),
                        "accuracy": loc_doc.get("accuracy"),
                        "google_maps": loc_doc.get("google_maps")
                    }
            except InvalidId:
                pass

        selfies.append({
            "id": str(doc["_id"]),
            "image_base64": doc.get("image_base64"),
            "timestamp": doc.get("timestamp"),
            "location_id": doc.get("location_id"),
            "location": linked_location,
            "received_at": doc.get("received_at"),
            "ip_address": doc.get("ip_address"),
            "user_agent": doc.get("user_agent")
        })

    total = selfies_collection.count_documents({})

    return jsonify({
        "success": True,
        "count": len(selfies),
        "total": total,
        "limit": limit,
        "skip": skip,
        "selfies": selfies
    })


@app.route("/location/<location_id>", methods=["GET"])
@require_api_key
def get_location_by_id(location_id):
    """Get a single location record by ID."""
    try:
        doc = locations_collection.find_one({"_id": ObjectId(location_id)})
        if not doc:
            return jsonify({"success": False, "message": "Location not found."}), 404

        # Fetch linked selfie
        photo = None
        selfie_id = doc.get("selfie_id")
        if selfie_id:
            try:
                selfie_doc = selfies_collection.find_one({"_id": ObjectId(selfie_id)})
                if selfie_doc:
                    photo = selfie_doc.get("image_base64")
            except InvalidId:
                pass

        return jsonify({
            "success": True,
            "location": {
                "id": str(doc["_id"]),
                "latitude": doc.get("latitude"),
                "longitude": doc.get("longitude"),
                "accuracy": doc.get("accuracy"),
                "photo": photo,
                "selfie_id": doc.get("selfie_id"),
                "timestamp": doc.get("timestamp"),
                "received_at": doc.get("received_at"),
                "ip_address": doc.get("ip_address"),
                "user_agent": doc.get("user_agent"),
                "google_maps": doc.get("google_maps")
            }
        })
    except InvalidId:
        return jsonify({"success": False, "message": "Invalid location ID format."}), 400


@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint for monitoring."""
    try:
        # Verify MongoDB is still connected
        client.admin.command('ping')
        db_status = "connected"
    except Exception:
        db_status = "disconnected"

    return jsonify({
        "status": "healthy" if db_status == "connected" else "degraded",
        "database": db_status,
        "timestamp": datetime.utcnow().isoformat() + "Z"
    })


@app.errorhandler(404)
def not_found(e):
    return jsonify({"success": False, "message": "Endpoint not found."}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"success": False, "message": "Method not allowed."}), 405


@app.errorhandler(500)
def server_error(e):
    return jsonify({"success": False, "message": "Internal server error."}), 500


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    debug = os.getenv("FLASK_ENV", "production").lower() == "development"
    
    logger.info(f"Starting Location Tracker API on port {port} (debug={debug})")
    app.run(host="0.0.0.0", port=port, debug=debug)