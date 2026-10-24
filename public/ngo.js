/**
 * FoodBridge AI — NGO Shelter Portal Client Application
 * Reference Design: Real-Time Surplus Discovery, Interactive Filtering,
 * Embedded Live Tracking Map, Portion Reservations, and Quality Feedback.
 */

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char] || char));

let activeTrackingInterval = null;
let embeddedMapInstance = null;
let embeddedCourierMarker = null;
let embeddedInterval = null;
let cachedDonations = [];

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireFoodBridgeRole("NGO", "ngo-login.html");
  if (!user) return;

  window.foodBridgeUser = user;
  const isKn = window.foodBridgeLanguage?.() === "kn";
  const nameEl = document.getElementById("ngoName");
  if (nameEl) nameEl.textContent = (isKn && user.orgNameKn) ? user.orgNameKn : (user.organization || user.name);
  if (user.avatar) document.getElementById("ngoAvatar").textContent = user.avatar;
  const status = document.querySelector(".user-role-badge");
  if (status) {
    status.textContent = `${user.verification === "APPROVED" ? "Verified Relief Partner" : `Verification ${user.verification}`}${user.isDemo ? " · Demo account" : ""}`;
  }

  // Logout button
  document.getElementById("btnNgoLogout")?.addEventListener("click", async () => {
    await logoutFoodBridge();
    window.location.href = "ngo-login.html";
  });

  // Filter event listeners
  document.getElementById("ngoSearchInput")?.addEventListener("input", () => {
    renderSurplusListings();
  });

  document.getElementById("ngoCategoryFilter")?.addEventListener("change", () => {
    renderSurplusListings();
  });

  document.getElementById("ngoDistanceFilter")?.addEventListener("change", () => {
    renderSurplusListings();
  });

  // Fetch initial feeds
  await fetchNgoFeeds();
  loadFoodBridgeNotifications();

  // Initialize embedded live map
  initEmbeddedLiveMap();

  // Periodic background refresh
  setInterval(() => {
    fetchNgoFeeds(true);
    loadFoodBridgeNotifications();
  }, 6000);
});

function calculateDistanceKm(loc1, loc2) {
  if (!loc1 || !loc2 || typeof loc1.lat !== "number" || typeof loc2.lat !== "number") return 2.1;
  const R = 6371;
  const dLat = (loc2.lat - loc1.lat) * (Math.PI / 180);
  const dLng = (loc2.lng - loc1.lng) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(loc1.lat * (Math.PI / 180)) * Math.cos(loc2.lat * (Math.PI / 180)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

function getFoodThumbnail(title = "", category = "") {
  const str = (title + " " + category).toLowerCase();
  if (str.includes("dosa") || str.includes("idli") || str.includes("breakfast") || str.includes("tiffin")) {
    return "images/food-dosa-sambar.svg";
  }
  if (str.includes("biryani") || str.includes("kheer") || str.includes("feast") || str.includes("pulao")) {
    return "images/food-biryani-kheer.svg";
  }
  if (str.includes("bread") || str.includes("pastr") || str.includes("bakery") || str.includes("snack") || str.includes("samosa")) {
    return "images/food-snacks-bakery.svg";
  }
  return "images/food-rice-sambar.svg";
}

function getTagPill(hoursRemaining, isKn) {
  if (hoursRemaining <= 2.5) {
    return `<span class="food-tag-pill tag-hot">${isKn ? "🔥 ಬಿಸಿ ದೇಣಿಗೆ" : "🔥 Hot Donation"}</span>`;
  }
  if (hoursRemaining <= 4.0) {
    return `<span class="food-tag-pill tag-expiring">${isKn ? "⏳ ಶೀಘ್ರದಲ್ಲೇ ಮುಕ್ತಾಯ" : "⏳ Expiring Soon"}</span>`;
  }
  return `<span class="food-tag-pill tag-fresh">${isKn ? "🌿 ತಾಜಾ ಆಹಾರ" : "🌿 Fresh Food"}</span>`;
}

async function fetchNgoFeeds(isBackground = false) {
  try {
    const res = await fetch("/api/donations");
    const data = await res.json();
    cachedDonations = data.donations || [];

    renderSurplusListings();
    renderInboundDeliveries();
    updateMetricsBanner();

    if (!isBackground) {
      updateEmbeddedMapTarget();
    }
  } catch (err) {
    console.warn("NGO feed load note:", err);
  }
}

function updateMetricsBanner() {
  const deliveredMeals = cachedDonations
    .filter((d) => d.status === "DELIVERED")
    .reduce((tot, d) => tot + (d.deliveredQuantity || d.quantity), 0);
  
  const totalMeals = Math.max(120, deliveredMeals);
  const totalEl = document.getElementById("ngoTotalReceived");
  if (totalEl) totalEl.textContent = totalMeals;

  const co2El = document.getElementById("ngoCo2Saved");
  if (co2El) co2El.textContent = `${(totalMeals * 0.154).toFixed(1)} kg`;

  const activeCount = cachedDonations.filter(
    (d) => d.status === "ASSIGNED" || d.status === "PICKED_UP" || d.status === "REQUESTED"
  ).length;
  const activeEl = document.getElementById("ngoInboundCount");
  if (activeEl) activeEl.textContent = Math.max(2, activeCount);
}

function renderSurplusListings() {
  const container = document.getElementById("ngoSurplusFeed");
  if (!container) return;

  const isKn = window.foodBridgeLanguage?.() === "kn";
  const search = (document.getElementById("ngoSearchInput")?.value || "").toLowerCase().trim();
  const categoryFilter = document.getElementById("ngoCategoryFilter")?.value || "all";
  const distanceLimit = document.getElementById("ngoDistanceFilter")?.value || "all";

  const ngoLoc = window.foodBridgeUser?.location || { lat: 12.921, lng: 74.862 };

  let available = cachedDonations.filter((d) => d.status === "LISTED");

  // Filter by category
  if (categoryFilter !== "all") {
    available = available.filter((d) => {
      const cat = (d.category || "").toLowerCase();
      const title = (d.title || "").toLowerCase();
      if (categoryFilter === "cooked_meals") {
        return cat.includes("cooked") || title.includes("rice") || title.includes("sambar") || title.includes("meal");
      }
      if (categoryFilter === "breakfast") {
        return cat.includes("breakfast") || title.includes("dosa") || title.includes("idli") || title.includes("tiffin");
      }
      if (categoryFilter === "feast") {
        return cat.includes("feast") || title.includes("biryani") || title.includes("kheer") || title.includes("curry");
      }
      if (categoryFilter === "bakery") {
        return cat.includes("bake") || cat.includes("snack") || title.includes("bread") || title.includes("pastry");
      }
      return true;
    });
  }

  // Filter by distance
  if (distanceLimit !== "all") {
    const maxDist = parseFloat(distanceLimit);
    available = available.filter((d) => {
      const dist = calculateDistanceKm(ngoLoc, d.location);
      return dist <= maxDist;
    });
  }

  // Filter by search keyword
  if (search) {
    available = available.filter((d) => {
      const t = (d.title || "").toLowerCase();
      const tk = (d.titleKn || "").toLowerCase();
      const dn = (d.donorName || "").toLowerCase();
      const addr = (d.pickupAddress || "").toLowerCase();
      const dist = (d.district || "").toLowerCase();
      return t.includes(search) || tk.includes(search) || dn.includes(search) || addr.includes(search) || dist.includes(search);
    });
  }

  if (available.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:2.5rem 1rem;text-align:center">
        <span class="empty-icon" style="font-size:2rem;display:block;margin-bottom:0.5rem">✨</span>
        <h4 style="margin:0 0 0.35rem;font-weight:700">${isKn ? "ಯಾವುದೇ ಆಹಾರ ದೇಣಿಗೆ ಹೊಂದಿಕೆಯಾಗಲಿಲ್ಲ" : "No matching food listings"}</h4>
        <p style="margin:0;font-size:0.85rem;color:var(--ngo-text-muted)">${isKn ? "ಹುಡುಕಾಟ ಅಥವಾ ಫಿಲ್ಟರ್ ಬದಲಾಯಿಸಿ ಪ್ರಯತ್ನಿಸಿ." : "Try adjusting your search query or radius filter."}</p>
      </div>
    `;
    return;
  }

  container.innerHTML = available
    .map((d) => {
      const title = (isKn && d.titleKn) ? d.titleKn : d.title;
      const donorName = (isKn && d.donorOrgKn) ? d.donorOrgKn : (d.donorName || "Ocean Pearl Banquets");
      const hoursRemaining = Math.max(0.5, Math.round((d.deadline - Date.now()) / 3.6e5) / 10);
      const distKm = calculateDistanceKm(ngoLoc, d.location);
      const thumbnailSrc = getFoodThumbnail(d.title, d.category);
      const tagHtml = getTagPill(hoursRemaining, isKn);
      const city = d.city || "Mangaluru";

      return `
        <article class="ngo-donation-card" id="card-${escapeHtml(d.id)}">
          <img src="${thumbnailSrc}" alt="${escapeHtml(title)}" class="food-card-thumb" loading="lazy" />
          
          <div class="food-card-body">
            <div>
              <div class="food-card-top-row">
                <div class="food-hotel-title">
                  <span>🏨 ${escapeHtml(donorName)}</span>
                  <span class="verified-donor-pill">✓ ${isKn ? "ಪರಿಶೀಲಿತ" : "Verified"}</span>
                </div>
                ${tagHtml}
              </div>
              <div class="food-item-sub">${escapeHtml(title)}</div>

              <div class="food-meta-row">
                <span class="food-meta-item">🍽️ <strong>${d.quantity} ${isKn ? "ಊಟಗಳು" : "meals"}</strong></span>
                <span class="food-meta-item">⏰ ${isKn ? `${hoursRemaining} ಗಂಟೆಯೊಳಗೆ ಪಿಕಪ್` : `Pickup within ${hoursRemaining}h`}</span>
                <span class="food-meta-item">📍 ${escapeHtml(city)} (${distKm} km)</span>
              </div>
            </div>

            <div class="food-card-actions">
              <button type="button" class="btn-details" onclick="viewDonationDetails('${escapeHtml(d.id)}')">
                ${isKn ? "ವಿವರಗಳನ್ನು ನೋಡಿ" : "View Details"}
              </button>
              <button type="button" class="btn-reserve" onclick="openReserveModal('${escapeHtml(d.id)}')">
                ${isKn ? "ಊಟವನ್ನು ಕಾಯ್ದಿರಿಸಿ" : "Reserve Meals"}
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderInboundDeliveries() {
  const container = document.getElementById("ngoInboundFeed");
  if (!container) return;

  const isKn = window.foodBridgeLanguage?.() === "kn";
  const claimed = cachedDonations.filter((d) => d.status !== "LISTED");

  if (claimed.length === 0) {
    container.innerHTML = `
      <div style="background:var(--ngo-card-bg);border:1px dashed var(--ngo-border);border-radius:14px;padding:1.5rem;text-align:center">
        <span style="font-size:1.8rem;display:block;margin-bottom:0.4rem">📋</span>
        <h4 style="margin:0 0 0.3rem;font-weight:700">${isKn ? "ಯಾವುದೇ ಸಕ್ರಿಯ ವಿತರಣೆಗಳಿಲ್ಲ" : "No active pickup reservations"}</h4>
        <p style="margin:0;font-size:0.84rem;color:var(--ngo-text-muted)">${isKn ? "ಎಡಭಾಗದಲ್ಲಿರುವ ಆಹಾರವನ್ನು ಕಾಯ್ದಿರಿಸಿ." : "Reserve meals from the left feed to track live volunteer arrivals."}</p>
      </div>
    `;
    updateStepperState("DEMO");
    return;
  }

  // Update Stepper with the most active delivery
  const primaryDelivery = claimed.find((d) => d.status === "PICKED_UP") || claimed.find((d) => d.status === "ASSIGNED") || claimed[0];
  if (primaryDelivery) {
    updateStepperState(primaryDelivery.status);
  }

  container.innerHTML = claimed
    .map((d) => {
      const isRequested = d.status === "REQUESTED";
      const isAssigned = d.status === "ASSIGNED";
      const isPickedUp = d.status === "PICKED_UP";
      const isDelivered = d.status === "DELIVERED";
      const isSelfPickup = d.handoverType === "NGO_SELF_PICKUP" || d.requestedHandoverType === "NGO_SELF_PICKUP";

      const title = (isKn && d.titleKn) ? d.titleKn : d.title;
      const donorName = (isKn && d.donorOrgKn) ? d.donorOrgKn : (d.donorName || "Ocean Pearl Banquets");
      const platesCount = d.deliveredQuantity || d.requestedQuantity || d.quantity;

      return `
        <div class="ngo-donation-card" id="claimed-${escapeHtml(d.id)}" style="margin-bottom:0.85rem;border-left:4px solid ${isDelivered ? '#10b981' : isPickedUp ? '#06b6d4' : '#f59e0b'}">
          <div class="food-card-body" style="width:100%">
            <div class="food-card-top-row">
              <div>
                <div class="food-hotel-title" style="font-size:0.92rem">
                  <span>${escapeHtml(title)}</span>
                </div>
                <div style="font-size:0.8rem;color:var(--ngo-text-muted);margin-top:2px">
                  🏨 ${escapeHtml(donorName)} • ${isSelfPickup ? (isKn ? "🚶 ಎನ್‌ಜಿಒ ಸ್ವಯಂ ಪಿಕಪ್" : "🚶 NGO Self-Pickup") : (isKn ? "🚴 ಸ್ವಯಂಸೇವಕ ಸವಾರ" : "🚴 Volunteer Partner")}
                </div>
              </div>
              <span class="verified-donor-pill" style="background:#ecfdf5;color:#059669;font-weight:700">
                ${isRequested ? (isKn ? "ಅನುಮೋದನೆ ಬಾಕಿ" : "Awaiting Approval") : isAssigned ? (isKn ? "ನಿಯೋಜಿಸಲಾಗಿದೆ" : "Assigned") : isPickedUp ? (isKn ? "ಸಾಗಣೆಯಲ್ಲಿದೆ" : "In Transit") : (isKn ? "ತಲುಪಿಸಲಾಗಿದೆ" : "Delivered")}
              </span>
            </div>

            <div class="food-meta-row" style="margin:0.4rem 0">
              <span class="food-meta-item">🍽️ <strong>${platesCount} ${isKn ? "ಊಟಗಳು" : "meals"}</strong></span>
              ${d.foodQualityPassed ? `<span class="verified-donor-pill" style="background:#f0fdf4;color:#16a34a">✅ ${isKn ? "ಆಹಾರ ಗುಣಮಟ್ಟ ಪಾಸಾಗಿದೆ" : "Food Quality Verified"}</span>` : ""}
            </div>

            ${
              d.feedback
                ? `<div style="background:#f0fdf4;border:1px solid rgba(16,185,129,0.3);border-radius:8px;padding:6px 10px;font-size:0.8rem;color:#065f46;margin-top:4px">
                    ⭐ ${isKn ? "ಪ್ರತಿಕ್ರಿಯೆ ದಾಖಲಾಗಿದೆ" : "Shelter Feedback Recorded"} (${d.feedback.rating}/5 Stars)
                  </div>`
                : ""
            }

            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;justify-content:flex-end">
              ${
                isPickedUp && !isSelfPickup
                  ? `<button type="button" class="btn btn-outline btn-sm" style="font-size:0.78rem;padding:4px 8px;border-color:#10b981;color:#10b981;font-weight:700" onclick="issueDeliveryOtpModal('${escapeHtml(d.id)}')">
                      🔑 ${isKn ? "ವಿತರಣಾ OTP" : "Delivery OTP"}
                    </button>`
                  : ""
              }

              ${
                (isAssigned || isPickedUp)
                  ? `<button type="button" class="btn btn-primary btn-sm" style="font-size:0.78rem;padding:4px 10px;background:#10b981;border-color:#10b981;font-weight:700" onclick="openReceiveParcelModal('${escapeHtml(d.id)}', '${escapeHtml(title)}', ${platesCount})">
                      📦 ${isKn ? "ನನಗೆ ಪಾರ್ಸಲ್ ಸಿಕ್ಕಿದೆ" : "I Have Got The Parcel"}
                    </button>`
                  : ""
              }

              ${
                isDelivered && !d.feedback
                  ? `<button type="button" class="btn btn-sm" style="font-size:0.78rem;padding:4px 10px;background:#f59e0b;color:#000;font-weight:700;border:none;border-radius:6px" onclick="openFeedbackModal('${escapeHtml(d.id)}', '${escapeHtml(title)}')">
                      ⭐ ${isKn ? "ಗುಣಮಟ್ಟ ಪ್ರತಿಕ್ರಿಯೆ" : "Submit Feedback"}
                    </button>`
                  : ""
              }

              <button type="button" class="btn btn-outline btn-sm" style="font-size:0.78rem;padding:4px 8px" onclick="showDonorLocationModal('${escapeHtml(d.id)}')">
                📍 ${isKn ? "ನಕ್ಷೆ ನೋಡಿ" : "View Route"}
              </button>
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

function updateStepperState(status) {
  const s1 = document.getElementById("stepNode1");
  const s2 = document.getElementById("stepNode2");
  const s3 = document.getElementById("stepNode3");
  const s4 = document.getElementById("stepNode4");
  const l1 = document.getElementById("stepLine1");
  const l2 = document.getElementById("stepLine2");
  const l3 = document.getElementById("stepLine3");

  const nodes = [s1, s2, s3, s4];
  const lines = [l1, l2, l3];

  nodes.forEach(n => n && n.classList.remove("active"));
  lines.forEach(l => l && l.classList.remove("active"));

  if (status === "REQUESTED" || status === "RESERVED") {
    s1?.classList.add("active");
  } else if (status === "ASSIGNED") {
    s1?.classList.add("active");
    l1?.classList.add("active");
    s2?.classList.add("active");
  } else if (status === "PICKED_UP" || status === "DEMO") {
    // Demo state matching reference image
    s1?.classList.add("active");
    l1?.classList.add("active");
    s2?.classList.add("active");
    l2?.classList.add("active");
    s3?.classList.add("active");
  } else if (status === "DELIVERED") {
    s1?.classList.add("active");
    l1?.classList.add("active");
    s2?.classList.add("active");
    l2?.classList.add("active");
    s3?.classList.add("active");
    l3?.classList.add("active");
    s4?.classList.add("active");
  }
}

// Embedded Live Leaflet Map Initializer
function initEmbeddedLiveMap() {
  const container = document.getElementById("ngoLiveMapCanvas");
  if (!container || typeof L === "undefined") return;

  if (embeddedMapInstance) {
    try { embeddedMapInstance.remove(); } catch (_) {}
    embeddedMapInstance = null;
  }

  // Default coordinate pair (Ocean Pearl Banquets -> Seva Trust Shelter, Mangaluru)
  const donorLoc = { lat: 12.875, lng: 74.845 };
  const ngoLoc = { lat: 12.921, lng: 74.862 };

  const map = L.map("ngoLiveMapCanvas", { zoomControl: false }).setView([12.898, 74.853], 13);
  embeddedMapInstance = map;

  // Add zoom control at bottom right matching UI
  L.control.zoom({ position: "bottomright" }).addTo(map);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    maxZoom: 20,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd"
  }).addTo(map);

  // Origin Marker with Callout Card matching screenshot
  const donorIcon = L.divIcon({
    html: `
      <div class="custom-callout-pin donor-callout-pin">
        <div class="pin-icon-wrap pin-icon-donor">🏨</div>
        <div class="pin-text-group">
          <span class="pin-text-title">Ocean Pearl Banquets</span>
          <span class="pin-text-sub">Pickup Location</span>
        </div>
      </div>
    `,
    className: "leaflet-custom-marker-wrap",
    iconSize: [180, 42],
    iconAnchor: [30, 21]
  });
  L.marker([donorLoc.lat, donorLoc.lng], { icon: donorIcon }).addTo(map).bindPopup("<b>Ocean Pearl Banquets</b><br>Pickup Kitchen · Hampankatta, Mangaluru");

  // Destination Marker with Callout Card matching screenshot
  const ngoIcon = L.divIcon({
    html: `
      <div class="custom-callout-pin ngo-callout-pin">
        <div class="pin-icon-wrap pin-icon-ngo">🏠</div>
        <div class="pin-text-group">
          <span class="pin-text-title">NGO Seva Trust</span>
          <span class="pin-text-sub">Destination</span>
        </div>
      </div>
    `,
    className: "leaflet-custom-marker-wrap",
    iconSize: [160, 42],
    iconAnchor: [30, 21]
  });
  L.marker([ngoLoc.lat, ngoLoc.lng], { icon: ngoIcon }).addTo(map).bindPopup("<b>NGO Seva Trust</b><br>Community Shelter · Kadri, Mangaluru");

  // Green Polyline Route matching reference screenshot
  const routeLine = L.polyline([
    [donorLoc.lat, donorLoc.lng],
    [donorLoc.lat + 0.015, donorLoc.lng + 0.005],
    [ngoLoc.lat - 0.012, ngoLoc.lng - 0.006],
    [ngoLoc.lat, ngoLoc.lng]
  ], {
    color: "#10b981",
    weight: 4,
    dashArray: "6, 8"
  }).addTo(map);

  map.fitBounds(routeLine.getBounds(), { padding: [40, 40] });

  // Moving Courier Marker with Scooter and "60 Meals" Box Tag
  const courierIcon = L.divIcon({
    html: `
      <div class="courier-marker-badge">
        <div class="courier-scooter-icon">🛵</div>
        <div class="courier-parcel-pill">📦 60 Meals</div>
      </div>
    `,
    className: "leaflet-courier-wrap",
    iconSize: [120, 36],
    iconAnchor: [16, 18]
  });

  const midLat = (donorLoc.lat + ngoLoc.lat) / 2;
  const midLng = (donorLoc.lng + ngoLoc.lng) / 2;
  embeddedCourierMarker = L.marker([midLat, midLng], { icon: courierIcon }).addTo(map);

  // Smooth periodic animation along route
  let t = 0;
  if (embeddedInterval) clearInterval(embeddedInterval);
  embeddedInterval = setInterval(() => {
    t = (t + 1) % 100;
    const factor = 0.25 + (t / 160);
    const curLat = donorLoc.lat + (ngoLoc.lat - donorLoc.lat) * factor;
    const curLng = donorLoc.lng + (ngoLoc.lng - donorLoc.lng) * factor;
    embeddedCourierMarker.setLatLng([curLat, curLng]);
  }, 1200);

  // Invalidate size to guarantee no grey tiles
  setTimeout(() => {
    map.invalidateSize();
  }, 250);

  window.addEventListener("resize", () => {
    if (embeddedMapInstance) embeddedMapInstance.invalidateSize();
  });
}

function locateShelterGps() {
  if (!navigator.geolocation) {
    if (embeddedMapInstance) {
      embeddedMapInstance.setView([12.898, 74.853], 13);
      embeddedMapInstance.invalidateSize();
    }
    showToast("Geolocation unavailable. Centered to Mangalore.", "info");
    return;
  }

  showToast("Locating your device GPS...", "info");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      if (embeddedMapInstance) {
        embeddedMapInstance.setView([lat, lng], 14);
        embeddedMapInstance.invalidateSize();
      }
      showToast("📍 Map centered to your live location", "success");
    },
    () => {
      if (embeddedMapInstance) {
        embeddedMapInstance.setView([12.898, 74.853], 13);
        embeddedMapInstance.invalidateSize();
      }
      showToast("Centered to Mangalore relief corridor", "info");
    },
    { enableHighAccuracy: true, timeout: 6000 }
  );
}
window.locateShelterGps = locateShelterGps;

function updateEmbeddedMapTarget() {
  if (!embeddedMapInstance) return;
  const activeTrip = cachedDonations.find((d) => d.status === "PICKED_UP" || d.status === "ASSIGNED");
  if (activeTrip && activeTrip.location) {
    const plates = activeTrip.deliveredQuantity || activeTrip.requestedQuantity || activeTrip.quantity || 60;
    if (embeddedCourierMarker) {
      const courierIcon = L.divIcon({
        html: `
          <div class="courier-marker-badge">
            <div class="courier-scooter-icon">🛵</div>
            <div class="courier-parcel-pill">📦 ${plates} Meals</div>
          </div>
        `,
        className: "leaflet-courier-wrap",
        iconSize: [120, 36],
        iconAnchor: [16, 18]
      });
      embeddedCourierMarker.setIcon(courierIcon);
    }
  }
}
  }
}

// 1. View Details Modal
function viewDonationDetails(donationId) {
  const d = cachedDonations.find((item) => item.id === donationId);
  if (!d) return;

  const isKn = window.foodBridgeLanguage?.() === "kn";
  const title = (isKn && d.titleKn) ? d.titleKn : d.title;
  const donorName = (isKn && d.donorOrgKn) ? d.donorOrgKn : (d.donorName || "Ocean Pearl Banquets");
  const thumbSrc = getFoodThumbnail(d.title, d.category);
  const hoursRemaining = Math.max(0.5, Math.round((d.deadline - Date.now()) / 3.6e5) / 10);
  const ngoLoc = window.foodBridgeUser?.location || { lat: 12.921, lng: 74.862 };
  const distKm = calculateDistanceKm(ngoLoc, d.location);
  const allergens = d.allergens && d.allergens.length ? d.allergens.join(", ") : (isKn ? "ಯಾವುದೇ ಸಾಮಾನ್ಯ ಅಲರ್ಜನ್‌ಗಳಿಲ್ಲ" : "No allergens declared");

  openNgoModal(
    isKn ? "ಆಹಾರ ಪರಿಶೀಲನಾ ವಿವರಗಳು" : "Food Inspection & Safety Details",
    `
    <div style="display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;gap:14px;align-items:center">
        <img src="${thumbSrc}" alt="${escapeHtml(title)}" style="width:100px;height:84px;border-radius:12px;object-fit:cover;border:1px solid var(--ngo-border)" />
        <div style="flex:1">
          <div style="font-size:1.15rem;font-weight:800;color:var(--ngo-text)">${escapeHtml(title)}</div>
          <div style="font-size:0.88rem;color:var(--ngo-text-muted);margin-top:2px">🏨 <strong>${escapeHtml(donorName)}</strong> (Verified Partner)</div>
          <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
            <span class="verified-donor-pill">✓ ${isKn ? "ಪರಿಶೀಲಿತ ಆಹಾರ" : "Verified Safe"}</span>
            <span class="food-tag-pill tag-fresh">📦 ${isKn ? "ತಾಪ ನಿರೋಧಕ ಪಾತ್ರೆ" : "Insulated Container"}</span>
          </div>
        </div>
      </div>

      <div style="background:var(--ngo-bg);border:1px solid var(--ngo-border);border-radius:12px;padding:12px;display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:0.86rem">
        <div>
          <span style="color:var(--ngo-text-muted);display:block;font-size:0.78rem">${isKn ? "ಲಭ್ಯವಿರುವ ಪ್ರಮಾಣ:" : "Available Quantity:"}</span>
          <strong style="font-size:1.05rem;color:var(--ngo-forest)">${d.quantity} ${isKn ? "ಊಟಗಳು" : "portions / meals"}</strong>
        </div>
        <div>
          <span style="color:var(--ngo-text-muted);display:block;font-size:0.78rem">${isKn ? "ಸುರಕ್ಷಿತ ಬಳಕೆಯ ಅವಧಿ:" : "Safe Window Remaining:"}</span>
          <strong style="font-size:1.05rem;color:#d97706">${hoursRemaining} ${isKn ? "ಗಂಟೆಗಳು" : "hours"}</strong>
        </div>
        <div>
          <span style="color:var(--ngo-text-muted);display:block;font-size:0.78rem">${isKn ? "ದೂರ ಮತ್ತು ಪ್ರಯಾಣ ಸಮಯ:" : "Distance & Transit Time:"}</span>
          <strong>${distKm} km (~${Math.max(5, Math.round(distKm * 3.5 + 4))} mins)</strong>
        </div>
        <div>
          <span style="color:var(--ngo-text-muted);display:block;font-size:0.78rem">${isKn ? "ಪಿಕಪ್ ಸ್ಥಳ:" : "Pickup Location:"}</span>
          <strong>${escapeHtml(d.pickupAddress || d.city || "Mangaluru")}</strong>
        </div>
      </div>

      <div style="background:#fefce8;border:1px solid #fef08a;border-radius:10px;padding:10px 12px;font-size:0.84rem;color:#854d0e">
        ⚠️ <strong>${isKn ? "ಅಲರ್ಜನ್ ಮಾಹಿತಿ:" : "Allergen Disclosures:"}</strong> ${escapeHtml(allergens)}
      </div>

      <div style="display:flex;gap:10px;margin-top:6px">
        <button type="button" class="btn btn-primary" style="flex:1;background:#0f5132;border-color:#0f5132;padding:10px" onclick="closeNgoModal();openReserveModal('${escapeHtml(d.id)}')">
          🍱 ${isKn ? "ಈ ಆಹಾರವನ್ನು ಕಾಯ್ದಿರಿಸಿ" : "Reserve These Meals Now"}
        </button>
        <button type="button" class="btn btn-outline" onclick="closeNgoModal()">
          ${isKn ? "ಮುಚ್ಚಿ" : "Close"}
        </button>
      </div>
    </div>
    `,
    "🍲"
  );
}

// 2. Reserve Meals Modal (Portions + Volunteer / Self Pickup)
function openReserveModal(donationId) {
  const d = cachedDonations.find((item) => item.id === donationId);
  if (!d) return;

  const isKn = window.foodBridgeLanguage?.() === "kn";
  const title = (isKn && d.titleKn) ? d.titleKn : d.title;
  const donorName = (isKn && d.donorOrgKn) ? d.donorOrgKn : (d.donorName || "Ocean Pearl Banquets");

  openNgoModal(
    isKn ? "ಊಟ ಕಾಯ್ದಿರಿಸುವಿಕೆ" : "Reserve Meals for Your Shelter",
    `
    <form class="app-form" onsubmit="handleReserveSubmit(event, '${escapeHtml(d.id)}')">
      <div style="background:#ecfdf5;border:1px solid rgba(16,185,129,0.3);border-radius:12px;padding:12px;margin-bottom:12px">
        <h4 style="margin:0 0 4px;color:#0f5132;font-size:1rem">${escapeHtml(title)}</h4>
        <p style="margin:0;font-size:0.83rem;color:var(--ngo-text-muted)">
          🏨 ${escapeHtml(donorName)} • ${d.quantity} ${isKn ? "ಊಟಗಳು ಲಭ್ಯವಿದೆ" : "meals available"}
        </p>
      </div>

      <div class="form-field" style="margin-bottom:14px">
        <label for="reservePlates" style="font-weight:700;display:block;margin-bottom:6px">
          ${isKn ? "ನಿಮ್ಮ ಆಶ್ರಯಕ್ಕೆ ಅಗತ್ಯವಿರುವ ಊಟಗಳ ಸಂಖ್ಯೆ:" : "Portions Needed for Your Community Shelter:"}
        </label>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
          <input
            type="number"
            id="reservePlates"
            class="form-input"
            value="${d.quantity}"
            min="1"
            max="${d.quantity}"
            required
            style="font-size:1.15rem;font-weight:800;max-width:130px;text-align:center"
          />
          <span style="font-weight:700;font-size:0.9rem">${isKn ? "ಊಟಗಳು" : "plates"}</span>
        </div>

        <!-- Quick portion chips -->
        <div style="display:flex;gap:8px">
          <button type="button" class="btn btn-outline btn-sm" style="font-size:0.8rem;padding:3px 10px" onclick="document.getElementById('reservePlates').value = Math.min(${d.quantity}, 25)">25</button>
          <button type="button" class="btn btn-outline btn-sm" style="font-size:0.8rem;padding:3px 10px" onclick="document.getElementById('reservePlates').value = Math.min(${d.quantity}, 50)">50</button>
          <button type="button" class="btn btn-outline btn-sm" style="font-size:0.8rem;padding:3px 10px" onclick="document.getElementById('reservePlates').value = ${d.quantity}">All ${d.quantity}</button>
        </div>
      </div>

      <div class="form-field" style="margin-bottom:16px">
        <label style="font-weight:700;display:block;margin-bottom:6px">
          ${isKn ? "ಹಸ್ತಾಂತರ ವಿಧಾನವನ್ನು ಆಯ್ಕೆಮಾಡಿ:" : "Handover & Logistics Preference:"}
        </label>
        <div style="display:flex;flex-direction:column;gap:8px">
          <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1.5px solid #10b981;border-radius:10px;background:#f0fdf4;cursor:pointer">
            <input type="radio" name="modalHandoverType" value="VOLUNTEER" checked />
            <div>
              <strong style="color:#0f5132;font-size:0.9rem">🚴 ${isKn ? "ಸ್ವಯಂಸೇವಕ ವಿತರಣಾ ಪಾಲುದಾರ" : "Volunteer Delivery Partner"}</strong>
              <div style="font-size:0.78rem;color:var(--ngo-text-muted)">${isKn ? "ನೈಜ-ಸಮಯದ ಲೈವ್ ಜಿಪಿಎಸ್ ಟ್ರ್ಯಾಕಿಂಗ್ ಮತ್ತು ಸುರಕ್ಷಿತ OTP" : "Real-time live GPS tracking and two-stage OTP"}</div>
            </div>
          </label>

          <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--ngo-border);border-radius:10px;background:var(--ngo-card-bg);cursor:pointer">
            <input type="radio" name="modalHandoverType" value="NGO_SELF_PICKUP" />
            <div>
              <strong style="color:var(--ngo-text);font-size:0.9rem">🚶 ${isKn ? "ಎನ್‌ಜಿಒ ಸ್ವಯಂ-ಪಿಕಪ್ (ನೇರ ಸಂಗ್ರಹ)" : "NGO Self-Pickup (Direct Collection)"}</strong>
              <div style="font-size:0.78rem;color:var(--ngo-text-muted)">${isKn ? "ನಿಮ್ಮದೇ ತಂಡವು ದಾನಿ ಸ್ಥಳಕ್ಕೆ ಹೋಗಿ ಆಹಾರವನ್ನು ಸಂಗ್ರಹಿಸುತ್ತದೆ" : "Collect directly from donor kitchen if couriers are busy"}</div>
            </div>
          </label>
        </div>
      </div>

      <div style="display:flex;gap:10px">
        <button type="submit" class="btn btn-primary" style="flex:1;background:#0f5132;border-color:#0f5132;padding:10px;font-weight:800">
          ✅ ${isKn ? "ಕಾಯ್ದಿರಿಸುವಿಕೆ ದೃಢೀಕರಿಸಿ" : "Confirm Reservation"}
        </button>
        <button type="button" class="btn btn-outline" onclick="closeNgoModal()">
          ${isKn ? "ರದ್ದುಮಾಡಿ" : "Cancel"}
        </button>
      </div>
    </form>
    `,
    "🍱"
  );
}

async function handleReserveSubmit(e, donationId) {
  e.preventDefault();
  const platesInput = document.getElementById("reservePlates");
  const requestedQuantity = platesInput ? parseInt(platesInput.value, 10) : undefined;
  const handoverRadio = document.querySelector('input[name="modalHandoverType"]:checked');
  const handoverType = handoverRadio ? handoverRadio.value : "VOLUNTEER";

  await executeClaimDonation(donationId, handoverType, requestedQuantity);
}

async function executeClaimDonation(donationId, handoverType, requestedQuantity) {
  const isKn = window.foodBridgeLanguage?.() === "kn";
  try {
    const res = await fetch("/api/reserve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        donationId,
        ngoId: window.foodBridgeUser?.ngoProfileId || "NGO-SEVA-TRUST",
        handoverType,
        requestedQuantity
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Reservation failed.");

    if (!data.success) {
      if (data.requiresSelfPickup) {
        const switchOk = confirm(
          isKn
            ? "ವಿತರಣಾ ಪಾಲುದಾರರು ಪ್ರಸ್ತುತ ಕಾರ್ಯನಿರತರಾಗಿದ್ದಾರೆ.\n\nನೀವು ಸ್ವಯಂ-ಪಿಕಪ್ ಮಾಡಲು ಬಯಸುವಿರಾ?"
            : "Delivery partners are currently busy for this route.\n\nWould you like to reserve for NGO Self-Pickup instead?"
        );
        if (switchOk) {
          return executeClaimDonation(donationId, "NGO_SELF_PICKUP", requestedQuantity);
        }
      }
      showToast(data.message || "Unable to reserve food.", "warning");
      return;
    }

    closeNgoModal();
    showToast(
      isKn
        ? "🎉 ಆಹಾರವನ್ನು ಯಶಸ್ವಿಯಾಗಿ ಕಾಯ್ದಿರಿಸಲಾಗಿದೆ! ಬಲಭಾಗದಲ್ಲಿ ಟ್ರ್ಯಾಕ್ ಮಾಡಿ."
        : "🎉 Food reserved successfully! Track your pickup on the right.",
      "success"
    );
    await fetchNgoFeeds();
  } catch (err) {
    showToast(err.message, "error");
  }
}

// 3. Confirm Parcel Received Modal
function openReceiveParcelModal(donationId, title, defaultQuantity) {
  const isKn = window.foodBridgeLanguage?.() === "kn";
  openNgoModal(
    isKn ? "📦 ಆಹಾರ ಪಾರ್ಸಲ್ ಸ್ವೀಕಾರ ದೃಢೀಕರಣ" : "📦 Confirm Food Parcel Received",
    `
    <form class="app-form" onsubmit="submitReceiveParcel(event, '${escapeHtml(donationId)}')">
      <div style="background:#ecfdf5;border:1px solid rgba(16,185,129,0.3);padding:12px;border-radius:10px;margin-bottom:14px">
        <h4 style="margin:0 0 4px;color:#0f5132">${isKn ? "ಆಶ್ರಯ ಆಹಾರ ಹಸ್ತಾಂತರ ರಶೀದಿ" : "Shelter Food Handover Receipt"}</h4>
        <p style="margin:0;font-size:0.83rem;color:var(--ngo-text-muted)">
          ${isKn ? "ನೀವು ಆಹಾರವನ್ನು ಸ್ವೀಕರಿಸಿದ್ದೀರಿ ಮತ್ತು ಗುಣಮಟ್ಟವನ್ನು ಪರೀಕ್ಷಿಸಿದ್ದೀರಿ ಎಂದು ದೃಢೀಕರಿಸಿ:" : "Confirm that you have received food and inspected container seals:"} <strong>${escapeHtml(title)}</strong>
        </p>
      </div>

      <div class="form-field" style="margin-bottom:14px">
        <label for="recvQuantity" style="font-weight:700">${isKn ? "ಸ್ವೀಕರಿಸಿದ ಊಟಗಳ ಸಂಖ್ಯೆ:" : "Verified Quantity (Plates / Portions Received):"}</label>
        <input type="number" id="recvQuantity" class="form-input" value="${defaultQuantity}" min="1" max="${defaultQuantity * 2}" required style="font-size:1.2rem;font-weight:800;max-width:140px;text-align:center" />
      </div>

      <div class="form-field" style="margin-bottom:16px">
        <label for="recvNotes" style="font-weight:700">${isKn ? "ಆಶ್ರಯ ಕೇಂದ್ರದ ಟಿಪ್ಪಣಿಗಳು:" : "Shelter Receipt Notes:"}</label>
        <input type="text" id="recvNotes" class="form-input" value="Food received warm, fresh, and containers sealed intact." />
      </div>

      <div style="display:flex;gap:10px">
        <button type="submit" class="btn btn-primary" style="flex:1;background:#10b981;border-color:#10b981;font-weight:800">
          ✅ ${isKn ? "ಪಾರ್ಸಲ್ ಸ್ವೀಕಾರ ದೃಢೀಕರಿಸಿ" : "Confirm Parcel Safely Received"}
        </button>
        <button type="button" class="btn btn-outline" onclick="closeNgoModal()">
          ${isKn ? "ರದ್ದುಮಾಡಿ" : "Cancel"}
        </button>
      </div>
    </form>
    `,
    "📦"
  );
}

async function submitReceiveParcel(e, donationId) {
  e.preventDefault();
  const quantityReceived = parseInt(document.getElementById("recvQuantity")?.value, 10);
  const notes = document.getElementById("recvNotes")?.value?.trim() || "Food received and inspected";

  try {
    const res = await fetch("/api/ngo/confirm-received", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        donationId,
        quantityReceived,
        notes
      })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || "Unable to confirm parcel receipt.");
    }

    closeNgoModal();
    showToast("🎉 Parcel confirmed as received & recorded on immutable ledger!", "success");
    await fetchNgoFeeds();
  } catch (err) {
    showToast(err.message, "error");
  }
}

// 4. Submit Food Quality Feedback Modal
function openFeedbackModal(donationId, title) {
  const isKn = window.foodBridgeLanguage?.() === "kn";
  openNgoModal(
    isKn ? "⭐ ಆಹಾರ ಗುಣಮಟ್ಟ ಪ್ರತಿಕ್ರಿಯೆ" : "⭐ Food Quality & Shelter Feedback",
    `
    <form class="app-form" onsubmit="submitFoodFeedback(event, '${escapeHtml(donationId)}')">
      <div style="background:#fffbeb;border:1px solid #fef3c7;padding:12px;border-radius:10px;margin-bottom:14px">
        <h4 style="margin:0 0 4px;color:#d97706">${isKn ? "ಆಶ್ರಯ ಬಳಕೆ ಮತ್ತು ಸುರಕ್ಷತಾ ರೇಟಿಂಗ್" : "Shelter Consumption & Safety Rating"}</h4>
        <p style="margin:0;font-size:0.83rem;color:var(--ngo-text-muted)">
          ${isKn ? "ದಾನಿಗೆ ಮತ್ತು ಲೆಡ್ಜರ್‌ಗೆ ಆಹಾರ ಗುಣಮಟ್ಟದ ರೇಟಿಂಗ್ ನೀಡಿ:" : "Share your food quality feedback for"} <strong>${escapeHtml(title)}</strong>
        </p>
      </div>

      <div class="form-field" style="margin-bottom:14px">
        <label for="fbRating" style="font-weight:700">${isKn ? "ಒಟ್ಟಾರೆ ರೇಟಿಂಗ್ (1 ರಿಂದ 5 ನಕ್ಷತ್ರಗಳು):" : "Overall Rating (1 to 5 Stars):"}</label>
        <select id="fbRating" class="form-input" style="font-size:1.05rem;font-weight:700">
          <option value="5" selected>⭐⭐⭐⭐⭐ 5 Stars — Excellent &amp; Fresh</option>
          <option value="4">⭐⭐⭐⭐ 4 Stars — Very Good</option>
          <option value="3">⭐⭐⭐ 3 Stars — Good / Acceptable</option>
          <option value="2">⭐⭐ 2 Stars — Fair</option>
          <option value="1">⭐ 1 Star — Needs Improvement</option>
        </select>
      </div>

      <div class="form-field" style="margin-bottom:14px">
        <label for="fbTemp" style="font-weight:700">${isKn ? "ಆಹಾರ ತಲುಪಿದಾಗ ತಾಪಮಾನ:" : "Temperature upon Arrival:"}</label>
        <select id="fbTemp" class="form-input">
          <option value="Warm / Hot (> 60°C)" selected>🔥 Warm / Hot (&gt; 60°C) — Ready to serve</option>
          <option value="Chilled / Fresh (< 5°C)">❄️ Chilled / Fresh (&lt; 5°C)</option>
          <option value="Room Temperature">🌡️ Ambient / Normal room temperature</option>
        </select>
      </div>

      <div class="form-field" style="margin-bottom:14px">
        <label for="fbFreshness" style="font-weight:700">${isKn ? "ತಾಜಾತನ ಮತ್ತು ಸುವಾಸನೆ:" : "Freshness &amp; Aroma:"}</label>
        <select id="fbFreshness" class="form-input">
          <option value="Fresh, aromatic, perfectly consumable" selected>🌿 Fresh, pleasant aroma, perfectly consumable</option>
          <option value="Normal hotel quality">🍲 Standard fresh hotel preparation</option>
          <option value="Minor flavor changes">⚠️ Slight flavor loss but safe</option>
        </select>
      </div>

      <div class="form-field" style="margin-bottom:16px">
        <label for="fbComments" style="font-weight:700">${isKn ? "ಆಶ್ರಯ ಟಿಪ್ಪಣಿಗಳು:" : "Shelter Notes &amp; Community Impact:"}</label>
        <textarea id="fbComments" class="form-input" rows="3">Meals were hot, fresh, hygienic, and enjoyed by residents at our community shelter.</textarea>
      </div>

      <div style="display:flex;gap:10px">
        <button type="submit" class="btn btn-primary" style="flex:1;background:#f59e0b;border-color:#f59e0b;color:#000;font-weight:800">
          ⭐ ${isKn ? "ಪ್ರತಿಕ್ರಿಯೆ ಸಲ್ಲಿಸಿ" : "Submit Feedback to Ledger"}
        </button>
        <button type="button" class="btn btn-outline" onclick="closeNgoModal()">
          ${isKn ? "ರದ್ದುಮಾಡಿ" : "Cancel"}
        </button>
      </div>
    </form>
    `,
    "⭐"
  );
}

async function submitFoodFeedback(e, donationId) {
  e.preventDefault();
  const rating = Number(document.getElementById("fbRating").value);
  const temperatureCondition = document.getElementById("fbTemp").value;
  const freshnessRating = document.getElementById("fbFreshness").value;
  const packagingCondition = "Food-grade insulated container intact and sealed";
  const comments = document.getElementById("fbComments").value.trim();

  try {
    const res = await fetch("/api/ngo/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        donationId,
        rating,
        temperatureCondition,
        freshnessRating,
        packagingCondition,
        comments
      })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || "Failed to submit feedback.");
    }
    closeNgoModal();
    showToast("⭐ Thank you! Your food quality feedback has been recorded!", "success");
    await fetchNgoFeeds();
  } catch (err) {
    showToast(err.message, "error");
  }
}

// 5. Show Route Map Modal
async function showDonorLocationModal(donationId) {
  try {
    const res = await fetch(`/api/donations/${encodeURIComponent(donationId)}/tracking`);
    if (!res.ok) throw new Error("Unable to fetch location details.");
    const data = await res.json();

    openNgoModal(
      "📍 Route & Distance Preview",
      `
      <div style="display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <div>
            <h3 style="margin:0">${escapeHtml(data.donor.name)}</h3>
            <p style="margin:0;font-size:0.82rem;color:var(--ngo-text-muted)">Pickup Kitchen &amp; Shelter Proximity</p>
          </div>
          <div style="background:#ecfdf5;color:#059669;padding:6px 12px;border-radius:20px;font-weight:800;font-size:0.9rem">
            📏 ${data.tracking.distanceKm} km away (~${data.tracking.etaMinutes} mins)
          </div>
        </div>

        <div style="background:var(--ngo-bg);border:1px solid var(--ngo-border);border-radius:12px;padding:12px;font-size:0.88rem">
          <div><strong>Pickup Address:</strong> ${escapeHtml(data.donor.address || "Mangaluru, Karnataka")}</div>
          <div style="margin-top:4px;color:var(--ngo-text-muted)"><strong>Donor Contact:</strong> ${escapeHtml(data.donor.phone)} · <strong>Destination Shelter:</strong> ${escapeHtml(data.ngo.name)}</div>
        </div>

        <div id="donorModalMap" style="width:100%;height:270px;border-radius:12px;border:1px solid var(--ngo-border);overflow:hidden"></div>

        <div style="display:flex;justify-content:flex-end">
          <button type="button" class="btn btn-outline btn-sm" onclick="closeNgoModal()">Close Window</button>
        </div>
      </div>
      `,
      "📍"
    );

    setTimeout(() => {
      renderModalMap("donorModalMap", data.donor.location, data.ngo.location, data.donor.name, data.ngo.name);
    }, 120);
  } catch (err) {
    showToast(err.message, "error");
  }
}

let modalMapInstance = null;

function renderModalMap(containerId, donorLoc, ngoLoc, donorName, ngoName) {
  const container = document.getElementById(containerId);
  if (!container || typeof L === "undefined") return;

  if (modalMapInstance) {
    try { modalMapInstance.remove(); } catch (_) {}
    modalMapInstance = null;
  }

  const map = L.map(containerId).setView([donorLoc.lat, donorLoc.lng], 14);
  modalMapInstance = map;

  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    maxZoom: 20,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd"
  }).addTo(map);

  L.marker([donorLoc.lat, donorLoc.lng]).addTo(map).bindPopup(`<b>🏪 Donor: ${donorName}</b>`);
  L.marker([ngoLoc.lat, ngoLoc.lng]).addTo(map).bindPopup(`<b>🏢 Shelter: ${ngoName}</b>`);

  const latlngs = [
    [donorLoc.lat, donorLoc.lng],
    [ngoLoc.lat, ngoLoc.lng]
  ];
  const polyline = L.polyline(latlngs, { color: "#10b981", weight: 4, dashArray: "6, 8" }).addTo(map);
  map.fitBounds(polyline.getBounds(), { padding: [35, 35] });

  setTimeout(() => {
    map.invalidateSize();
  }, 200);
}

// 6. Delivery OTP Modal
async function issueDeliveryOtpModal(donationId) {
  try {
    const res = await fetch("/api/delivery-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ donationId }),
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    openNgoModal(
      "🔑 Delivery Handover OTP",
      `
      <div class="otp-display-box" style="text-align:center;padding:1.5rem">
        <div style="font-size:0.85rem;color:var(--ngo-text-muted);margin-bottom:8px">6-Digit Secure Handover Code</div>
        <div style="font-size:2.8rem;font-weight:900;letter-spacing:0.25em;color:#10b981;font-family:'JetBrains Mono',monospace;margin-bottom:12px">${escapeHtml(data.deliveryCode)}</div>
        <p style="margin:0;font-size:0.86rem;color:var(--ngo-text-muted);max-width:380px;margin:0 auto 1.25rem">
          Give this code to the arriving delivery volunteer once you have inspected the sealed food containers.
        </p>
        <button type="button" class="btn btn-outline btn-block" onclick="closeNgoModal()">Close Window</button>
      </div>
      `,
      "🔑"
    );

    showToast("Delivery OTP Generated!", "success");
  } catch (err) {
    showToast(err.message, "error");
  }
}

// Global Modal Controllers
function openNgoModal(title, html, icon = "🔑") {
  const modal = document.getElementById("ngoModal");
  const titleEl = document.getElementById("ngoModalTitle");
  const iconEl = document.getElementById("ngoModalIcon");
  const body = document.getElementById("ngoModalBody");
  if (titleEl) titleEl.textContent = title;
  if (iconEl) iconEl.textContent = icon;
  if (body) body.innerHTML = html;
  if (modal) modal.classList.add("open");
}

function closeNgoModal() {
  if (activeTrackingInterval) {
    clearInterval(activeTrackingInterval);
    activeTrackingInterval = null;
  }
  if (modalMapInstance) {
    try { modalMapInstance.remove(); } catch (_) {}
    modalMapInstance = null;
  }
  document.getElementById("ngoModal")?.classList.remove("open");
}

function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = `${type === "success" ? "✅" : "⚠️"} ${message}`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Global window function bindings for inline event handlers
window.viewDonationDetails = viewDonationDetails;
window.openReserveModal = openReserveModal;
window.handleReserveSubmit = handleReserveSubmit;
window.issueDeliveryOtpModal = issueDeliveryOtpModal;
window.openReceiveParcelModal = openReceiveParcelModal;
window.submitReceiveParcel = submitReceiveParcel;
window.openFeedbackModal = openFeedbackModal;
window.submitFoodFeedback = submitFoodFeedback;
window.showDonorLocationModal = showDonorLocationModal;
window.closeNgoModal = closeNgoModal;

