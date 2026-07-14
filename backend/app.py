from flask import Flask, request, jsonify
from flask_cors import CORS
from pymongo import MongoClient
from datetime import datetime
import os

app = Flask(__name__)

# Allow requests from any origin.
# For production, you can replace "*" with your Netlify domain.
CORS(app)

# MongoDB Connection
MONGO_URI = os.getenv("MONGO_URI")

if not MONGO_URI:
    raise RuntimeError("MONGO_URI environment variable is not set.")

client = MongoClient(MONGO_URI)

db = client["location_tracker"]
locations_collection = db["locations"]


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

        location = {
            "latitude": data.get("latitude"),
            "longitude": data.get("longitude"),
            "accuracy": data.get("accuracy"),
            "timestamp": data.get("timestamp"),
            "received_at": datetime.utcnow().isoformat() + "Z",
            "ip_address": request.headers.get(
                "X-Forwarded-For",
                request.remote_addr
            ),
            "user_agent": request.headers.get("User-Agent")
        }

        result = locations_collection.insert_one(location)

        print("=" * 60, flush=True)
        print("📍 New Location Saved", flush=True)
        print(location, flush=True)
        print("=" * 60, flush=True)

        return jsonify({
            "success": True,
            "message": "Location saved successfully.",
            "id": str(result.inserted_id)
        })

    except Exception as e:
        print(str(e), flush=True)

        return jsonify({
            "success": False,
            "message": str(e)
        }), 500


@app.route("/locations", methods=["GET"])
def get_locations():

    locations = []

    for doc in locations_collection.find():

        locations.append({
            "id": str(doc["_id"]),
            "latitude": doc.get("latitude"),
            "longitude": doc.get("longitude"),
            "accuracy": doc.get("accuracy"),
            "timestamp": doc.get("timestamp"),
            "received_at": doc.get("received_at"),
            "ip_address": doc.get("ip_address"),
            "user_agent": doc.get("user_agent")
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