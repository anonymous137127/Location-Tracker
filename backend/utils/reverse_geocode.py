import requests

def get_address(lat, lon):
    url = (
        f"https://nominatim.openstreetmap.org/reverse"
        f"?format=jsonv2&lat={lat}&lon={lon}"
    )

    headers = {
        "User-Agent": "LocationTracker/1.0"
    }

    response = requests.get(url, headers=headers, timeout=10)

    if response.status_code == 200:
        return response.json()

    return None