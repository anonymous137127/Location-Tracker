from flask import Flask, request, jsonify
from flask_cors import CORS
import json
import os
from datetime import datetime

app = Flask(__name__)
CORS(app)

DATA_FOLDER = "data"
DATA_FILE = os.path.join(DATA_FOLDER, "locations.json")

os.makedirs(DATA_FOLDER, exist_ok=True)

if not os.path.exists(DATA_FILE):
    with open(DATA_FILE, "w") as f:
        json.dump([], f)


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

    with open(DATA_FILE, "r") as f:
        locations = json.load(f)

    locations.append(location_data)

    with open(DATA_FILE, "w") as f:
        json.dump(locations, f, indent=4)

    return jsonify({
        "success": True,
        "message": "Location received."
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)