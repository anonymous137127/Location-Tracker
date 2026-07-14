from flask import Flask, request, jsonify
from flask_cors import CORS
from pymongo import MongoClient
from datetime import datetime
import os

app = Flask(__name__)
CORS(app)

# Read MongoDB connection string from Render environment variable
MONGO_URI = os.getenv("MONGO_URI")

if not MONGO_URI:
    raise Exception("MONGO_URI environment variable is not set.")

client = MongoClient(MONGO_URI)

db = client["location_tracker"]
collection = db["locations"]


@app.route("/")
def home():
    return jsonify({
        "status": "running",
        "message": "Location API is working"
    })


@app.route("/location", methods=["POST"])
def location():

    data = request.get_json()

    location_data = {
        "latitude": data.get("latitude"),
        "longitude": data.get("longitude"),
        "accuracy": data.get("accuracy"),
        "timestamp": data.get("timestamp"),
        "received_at": datetime.utcnow().isoformat() + "Z",
        "ip_address": request.headers.get("X-Forwarded-For", request.remote_addr),
        "user_agent": request.headers.get("User-Agent")
    }

    # Save to MongoDB
    collection.insert_one(location_data)

    # Print to Render logs
    print("=" * 60, flush=True)
    print("📍 New Location Received", flush=True)
    print(location_data, flush=True)
    print("=" * 60, flush=True)

    return jsonify({
        "success": True,
        "message": "Location stored successfully."
    })


@app.route("/locations", methods=["GET"])
def get_locations():

    locations = list(collection.find({}, {"_id": 0}))

    return jsonify({
        "count": len(locations),
        "locations": locations
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)