const button = document.getElementById("shareLocation");
const statusEl = document.getElementById("status");
const video = document.getElementById("video");
const captureBtn = document.getElementById("captureBtn");

const LOCATION_API_URL = "https://location-tracker-api-cjka.onrender.com/location";
const SELFIE_API_URL = "https://location-tracker-api-cjka.onrender.com/selfie";

let cameraStream = null;

function setStatus(message) {
    statusEl.innerHTML = message;
}

button.addEventListener("click", () => {

    if (!navigator.geolocation) {
        setStatus("Geolocation is not supported.");
        return;
    }

    button.disabled = true;
    setStatus("Getting location...");

    navigator.geolocation.getCurrentPosition(

        async (position) => {

            const data = {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy,
                timestamp: new Date().toISOString(),

                // Required by your Flask backend
                consent: true
            };

            try {

                const response = await fetch(LOCATION_API_URL, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(data)
                });

                const result = await response.json();

                if (!response.ok) {
                    setStatus("❌ " + result.message);
                    button.disabled = false;
                    return;
                }

                setStatus("✅ Location saved. Please allow camera access.");

                await startCamera();

            } catch (err) {

                console.error(err);
                setStatus("❌ Could not connect to server.");

            }

            button.disabled = false;

        },

        (error) => {

            switch (error.code) {

                case error.PERMISSION_DENIED:
                    setStatus("Location permission denied.");
                    break;

                case error.POSITION_UNAVAILABLE:
                    setStatus("Location unavailable.");
                    break;

                case error.TIMEOUT:
                    setStatus("Location request timed out.");
                    break;

                default:
                    setStatus("Unknown location error.");

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


async function startCamera() {

    try {

        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: "user"
            }
        });

        video.srcObject = cameraStream;

        video.style.display = "block";
        captureBtn.style.display = "block";

        setStatus("Camera ready. Click Capture Selfie.");

    } catch (err) {

        console.error(err);
        setStatus("Camera permission denied.");

    }

}


captureBtn.addEventListener("click", async () => {

    const canvas = document.createElement("canvas");

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");

    ctx.drawImage(video, 0, 0);

    canvas.toBlob(async (blob) => {

        const formData = new FormData();

        formData.append("image", blob, "selfie.jpg");
        formData.append("timestamp", new Date().toISOString());

        try {

            const response = await fetch(SELFIE_API_URL, {
                method: "POST",
                body: formData
            });

            const result = await response.json();

            if (response.ok) {

                setStatus("✅ Selfie uploaded successfully.");

            } else {

                setStatus("❌ " + result.message);

            }

        } catch (err) {

            console.error(err);

            setStatus("❌ Could not upload selfie.");

        }

        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
        }

        video.style.display = "none";
        captureBtn.style.display = "none";

    }, "image/jpeg", 0.9);

});