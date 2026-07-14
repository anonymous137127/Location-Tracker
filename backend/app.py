from flask import Flask, request, jsonify
from flask_cors import CORS
from pymongo import MongoClient
from datetime import datetime
from functools import wraps
import os

app = Flask(__name__)

# Allow all origins (for production, consider restricting this to your frontend's domain)
CORS(app)

# MongoDB Connection
MONGO_URI = os.getenv("MONGO_URI")
if not MONGO_URI:
    raise RuntimeError("MONGO_URI environment variable is not set.")

client = MongoClient(MONGO_URI)
db = client["location_tracker"]
locations_collection = db["locations"]

# Simple API key to protect read access to collected data.
# Set this in your Render environment variables — do NOT hardcode a real key here.
ADMIN_API_KEY = os.getenv("ADMIN_API_KEY")


def require_api_key(view_func):
    """Guards an endpoint so only requests with the correct API key can read data."""
    @wraps(view_func)
    def wrapped(*args, **kwargs):
        if not ADMIN_API_KEY:
            return jsonify({
                "success": False,
                "message": "Server is not configured with an admin API key."
            }), 500

        provided_key = request.headers.get("X-API-Key")
        if provided_key != ADMIN_API_KEY:
            return jsonify({
                "success": False,
                "message": "Unauthorized."
            }), 401

        return view_func(*args, **kwargs)
    return wrapped


@app.route("/", methods=["GET"])
def home():
    return jsonify({
        "status": "online",
        "database": "MongoDB Connected",
        "message": "Location Tracker API Running"
    })


@app.route("/location", methods=["POST"])
def save_location():
    try:
        data = request.get_json()

        if not data:
            return jsonify({
                "success": False,
                "message": "No JSON data received."
            }), 400

        # Require explicit confirmation from the frontend that the user
        # was shown a consent notice before their location was captured.
        if not data.get("consent"):
            return jsonify({
                "success": False,
                "message": "Consent not confirmed; location was not saved."
            }), 400

        latitude = data.get("latitude")
        longitude = data.get("longitude")

        location = {
            "latitude": latitude,
            "longitude": longitude,
            "accuracy": data.get("accuracy"),
            "photo": data.get("photo"),  # Base64 image, optional
            "timestamp": data.get("timestamp"),
            "received_at": datetime.utcnow().isoformat() + "Z",
            "ip_address": request.headers.get(
                "X-Forwarded-For",
                request.remote_addr
            ),
            "user_agent": request.headers.get("User-Agent"),
            "google_maps": f"https://www.google.com/maps?q={latitude},{longitude}"
        }

        result = locations_collection.insert_one(location)

        print("=" * 60, flush=True)
        print("New location saved", flush=True)
        print(location, flush=True)
        print("=" * 60, flush=True)

        return jsonify({
            "success": True,
            "message": "Location saved successfully.",
            "id": str(result.inserted_id),
            "google_maps": location["google_maps"]
        })

    except Exception as e:
        print(e, flush=True)
        return jsonify({
            "success": False,
            "message": str(e)
        }), 500


@app.route("/locations", methods=["GET"])
@require_api_key
def get_locations():
    locations = []

    for doc in locations_collection.find():
        locations.append({
            "id": str(doc["_id"]),
            "latitude": doc.get("latitude"),
            "longitude": doc.get("longitude"),
            "accuracy": doc.get("accuracy"),
            "photo": doc.get("photo"),
            "timestamp": doc.get("timestamp"),
            "received_at": doc.get("received_at"),
            "ip_address": doc.get("ip_address"),
            "user_agent": doc.get("user_agent"),
            "google_maps": doc.get(
                "google_maps",
                f"https://www.google.com/maps?q={doc.get('latitude')},{doc.get('longitude')}"
            )
        })

    return jsonify({
        "success": True,
        "count": len(locations),
        "locations": locations
    })


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "healthy"
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)