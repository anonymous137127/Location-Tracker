const button = document.getElementById("shareLocation");
const statusEl = document.getElementById("status");
const video = document.getElementById("video");
const captureBtn = document.getElementById("captureBtn");

// Replace with your actual backend URLs
const LOCATION_API_URL = "https://location-tracker-api-cjka.onrender.com/location";
const SELFIE_API_URL = "https://location-tracker-api-cjka.onrender.com/selfie";

let cameraStream = null;

function setStatus(message) {
    statusEl.innerHTML = message;
}

function geolocationErrorMessage(error) {
    switch (error.code) {
        case error.PERMISSION_DENIED:
            return "Location permission was denied.";
        case error.POSITION_UNAVAILABLE:
            return "Location information is unavailable.";
        case error.TIMEOUT:
            return "Location request timed out.";
        default:
            return "An unknown error occurred while getting location.";
    }
}

button.addEventListener("click", () => {
    if (!navigator.geolocation) {
        setStatus("Geolocation is not supported by your browser.");
        return;
    }

    button.disabled = true;
    setStatus("Requesting location...");

    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const data = {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy,
                timestamp: new Date().toISOString()
            };

            try {
                const response = await fetch(LOCATION_API_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(data)
                });

                if (!response.ok) {
                    const error = await response.text();
                    console.log(error);
                    setStatus("❌ " + error);
                    button.disabled = false;
                    return;
                }

                setStatus("✅ Location shared. Please allow camera access.");
                await startCamera();

            } catch (err) {
                console.error(err);
                setStatus("❌ Could not connect to the server.");
            } finally {
                button.disabled = false;
            }
        },
        (error) => {
            setStatus(geolocationErrorMessage(error));
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
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStatus("Camera access is not supported by your browser.");
        return;
    }

    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user" }
        });

        video.srcObject = cameraStream;
        video.style.display = "block";
        captureBtn.style.display = "inline-block";
        captureBtn.disabled = false;

        setStatus("Camera ready. Click 'Capture Selfie' to continue.");

    } catch (err) {
        console.error(err);
        setStatus("Camera permission denied or unavailable.");
    }
}

function stopCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach((track) => track.stop());
        cameraStream = null;
    }
    video.srcObject = null;
    video.style.display = "none";
    captureBtn.style.display = "none";
}

captureBtn.addEventListener("click", async () => {
    captureBtn.disabled = true;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0);

    setStatus("Uploading selfie...");

    canvas.toBlob(async (blob) => {
        if (!blob) {
            setStatus("❌ Failed to capture image.");
            captureBtn.disabled = false;
            return;
        }

        try {
            const formData = new FormData();
            formData.append("image", blob, "selfie.jpg");
            formData.append("timestamp", new Date().toISOString());

            const response = await fetch(SELFIE_API_URL, {
                method: "POST",
                body: formData
            });

            if (response.ok) {
                setStatus("✅ Selfie captured and uploaded successfully.");
            } else {
                setStatus("❌ Server error while uploading selfie.");
            }

        } catch (err) {
            console.error(err);
            setStatus("❌ Could not upload selfie.");
        } finally {
            stopCamera();
        }
    }, "image/jpeg", 0.9);
});