const button = document.getElementById("shareLocation");
const status = document.getElementById("status");

// Replace this with your Render backend URL
const API_URL = "https://YOUR-RENDER-APP.onrender.com/location";

button.addEventListener("click", () => {

    if (!navigator.geolocation) {
        status.innerHTML = "Geolocation is not supported by your browser.";
        return;
    }

    status.innerHTML = "Requesting location...";
    button.disabled = true;

    navigator.geolocation.getCurrentPosition(
        async (position) => {

            const data = {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy,
                timestamp: new Date().toISOString()
            };

            try {

                const response = await fetch(API_URL, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(data)
                });

                if (response.ok) {
                    status.innerHTML = "✅ Location shared successfully.";
                } else {
                    status.innerHTML = "❌ Server error.";
                }

            } catch (err) {
                console.error(err);
                status.innerHTML = "❌ Could not connect to the server.";
            }

            button.disabled = false;

        },
        (error) => {

            switch (error.code) {
                case error.PERMISSION_DENIED:
                    status.innerHTML = "Location permission was denied.";
                    break;

                case error.POSITION_UNAVAILABLE:
                    status.innerHTML = "Location information is unavailable.";
                    break;

                case error.TIMEOUT:
                    status.innerHTML = "Location request timed out.";
                    break;

                default:
                    status.innerHTML = "An unknown error occurred.";
            }

            button.disabled = false;
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        }
    );

});