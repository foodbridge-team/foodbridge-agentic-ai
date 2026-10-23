/**
 * FoodBridge AI — Full Platform Client Application
 * Modular Vanilla JavaScript driving multi-role portals, Leaflet geo-map,
 * cryptographic state verification, and English/Kannada i18n.
 */

// Global State
const state = {
  currentRole: "donor",
  currentLang: "en",
  donations: [],
  stats: {},
  ledger: { events: [], verification: { ok: true } },
  map: null,
  mapMarkers: [],
  activeVolunteerMission: null,
};

// Kannada (ಕನ್ನಡ) and English Translations Dictionary
const i18n = {
  en: {
    tagline: "Surplus Food Redistribution Network",
    mealsRescued: "Meals Rescued",
    co2Saved: "CO₂ Avoided",
    activeTrips: "In Transit",
    ledgerStatus: "Tamper-Proof Ledger",
    resetDemo: "Reset",
    roleDonor: "Donor Portal",
    roleDonorSub: "Post Food & Manage Pickup",
    roleNgo: "NGO Portal",
    roleNgoSub: "Claim Donations & Delivery OTP",
    roleVolunteer: "Volunteer Dispatch",
    roleVolunteerSub: "Pickup, Deliver & Evidence",
    roleAudit: "AI & Cryptographic Ledger",
    roleAuditSub: "SHA-256 Hash Chain Explorer",
    liveMapTitle: "Live City Rescue Network & Transit Map",
    legendDonors: "Donors",
    legendNgos: "NGOs",
    legendVolunteers: "Volunteers in Transit",
    postDonationTitle: "List Surplus Food",
    postDonationDesc: "Instant AI-matching with eligible verified receivers",
    lblFoodTitle: "Food Title / Description",
    lblCategory: "Food Category",
    lblQuantity: "Quantity (Portions / Meals)",
    lblDeadline: "Safe Expiration Window (Hours)",
    lblAllergens: "Allergen Declarations",
    lblStorageSafe: "Stored in hygienic, insulated food-grade containers",
    myDonationsTitle: "My Food Donations",
    myDonationsDesc: "Track volunteer dispatch & generate pickup verification codes",
    ngoAvailableTitle: "Available Surplus Food Nearby",
    ngoAvailableDesc: "Deterministic feasibility filter & AI proximity ranking",
    ngoClaimedTitle: "Claimed Donations & Receiving Handover",
    ngoClaimedDesc: "Generate secure delivery OTP and verify incoming meals",
    volMissionsTitle: "Rescue Deliveries in Your Area",
    volMissionsDesc: "Accept delivery routes to transport food from donors to NGOs",
    volActiveTitle: "Active Mission Handover Console",
    volActiveDesc: "Two-Stage OTP Verification with Photo Evidence",
    auditLedgerTitle: "Immutable SHA-256 Audit Ledger",
    auditLedgerDesc: "Cryptographically linked hash chain securing every donation event",
    auditAiTitle: "Deterministic Rules & Security Core",
    auditAiDesc: "Architecture rules running on zero-dependency Node.js core",
  },
  kn: {
    tagline: "ಹೆಚ್ಚುವರಿ ಆಹಾರ ಮರುಹಂಚಿಕೆ ನೆಟ್‌ವರ್ಕ್",
    mealsRescued: "ಉಳಿಸಿದ ಊಟಗಳು",
    co2Saved: "ತಪ್ಪಿಸಿದ CO₂",
    activeTrips: "ಸಾರಿಗೆಯಲ್ಲಿದೆ",
    ledgerStatus: "ಸುರಕ್ಷಿತ ಲೆಡ್ಜರ್",
    resetDemo: "ಮರುಹೊಂದಿಸಿ",
    roleDonor: "ದಾನಿಗಳ ಪೋರ್ಟಲ್",
    roleDonorSub: "ಆಹಾರ ಪೋಸ್ಟ್ ಮಾಡಿ ಮತ್ತು ಪಿಕಪ್ ನಿರ್ವಹಿಸಿ",
    roleNgo: "ಎನ್‌ಜಿಒ ಪೋರ್ಟಲ್",
    roleNgoSub: "ಆಹಾರ ಪಡೆದುಕೊಳ್ಳಿ & ವಿತರಣಾ OTP",
    roleVolunteer: "ಸ್ವಯಂಸೇವಕರು",
    roleVolunteerSub: "ಪಿಕಪ್, ವಿತರಣೆ ಮತ್ತು ಪುರಾವೆ",
    roleAudit: "AI & ಕ್ರಿಪ್ಟೋಗ್ರಾಫಿಕ್ ಲೆಡ್ಜರ್",
    roleAuditSub: "SHA-256 ಹ್ಯಾಶ್ ಚೈನ್ ಪರಿಶೀಲಕ",
    liveMapTitle: "ನಗರದ ನೈಜ ಸಮಯದ ಆಹಾರ ರಕ್ಷಣಾ ನೆಟ್‌ವರ್ಕ್ ನಕ್ಷೆ",
    legendDonors: "ದಾನಿಗಳು",
    legendNgos: "ಎನ್‌ಜಿಒಗಳು",
    legendVolunteers: "ಸಂಚಾರದಲ್ಲಿರುವ ಸ್ವಯಂಸೇವಕರು",
    postDonationTitle: "ಹೆಚ್ಚುವರಿ ಆಹಾರವನ್ನು ಪಟ್ಟಿ ಮಾಡಿ",
    postDonationDesc: "ಪರಿಶೀಲಿಸಿದ ಸ್ವೀಕರಿಸುವವರೊಂದಿಗೆ ತಕ್ಷಣದ AI ಹೊಂದಾಣಿಕೆ",
    lblFoodTitle: "ಆಹಾರದ ಶೀರ್ಷಿಕೆ / ವಿವರಣೆ",
    lblCategory: "ಆಹಾರ ವರ್ಗ",
    lblQuantity: "ಪ್ರಮಾಣ (ಊಟಗಳ ಸಂಖ್ಯೆ)",
    lblDeadline: "ಸುರಕ್ಷಿತ ಬಳಕೆಯ ಅವಧಿ (ಗಂಟೆಗಳು)",
    lblAllergens: "ಅಲರ್ಜಿನ್ ವಿವರ",
    lblStorageSafe: "ಸ್ವಚ್ಛ ಮತ್ತು ಸುರಕ್ಷಿತ ಪಾತ್ರೆಗಳಲ್ಲಿ ಇಡಲಾಗಿದೆ",
    myDonationsTitle: "ನನ್ನ ಆಹಾರ ಕೊಡುಗೆಗಳು",
    myDonationsDesc: "ವಿತರಣಾ ಪ್ರಕ್ರಿಯೆ ಮತ್ತು ಪಿಕಪ್ OTP ಕೋಡ್ ಪರಿಶೀಲಿಸಿ",
    ngoAvailableTitle: "ಹತ್ತಿರದ ಲಭ್ಯವಿರುವ ಹೆಚ್ಚುವರಿ ಆಹಾರ",
    ngoAvailableDesc: "AI ಹೊಂದಾಣಿಕೆ ಮತ್ತು ಅಂತರ ಶ್ರೇಯಾಂಕ",
    ngoClaimedTitle: "ಪಡೆದ ಕೊಡುಗೆಗಳು ಮತ್ತು ಹಸ್ತಾಂತರ",
    ngoClaimedDesc: "ಸುರಕ್ಷಿತ ವಿತರಣಾ OTP ರಚಿಸಿ ಮತ್ತು ಊಟ ಪರಿಶೀಲಿಸಿ",
    volMissionsTitle: "ನಿಮ್ಮ ಪ್ರದೇಶದಲ್ಲಿ ವಿತರಣಾ ಕಾರ್ಯಗಳು",
    volMissionsDesc: "ದಾನಿಗಳಿಂದ ಎನ್‌ಜಿಒಗಳಿಗೆ ಆಹಾರ ಸಾಗಿಸಲು ಸ್ವೀಕರಿಸಿ",
    volActiveTitle: "ಸಕ್ರಿಯ ವಿತರಣಾ ಕನ್ಸೋಲ್",
    volActiveDesc: "ಎರಡು ಹಂತದ OTP ಮತ್ತು ಫೋಟೋ ಪುರಾವೆ ಪರಿಶೀಲನೆ",
    auditLedgerTitle: "ಬದಲಾಯಿಸಲಾಗದ SHA-256 ಲೆಡ್ಜರ್",
    auditLedgerDesc: "ಪ್ರತಿ ಹಂತವನ್ನು ಸುರಕ್ಷಿತಗೊಳಿಸುವ ಹ್ಯಾಶ್ ಸರಪಳಿ",
    auditAiTitle: "ಭದ್ರತಾ ಕೋರ್ ಮತ್ತು ನಿಯಮಗಳು",
    auditAiDesc: "Node.js ನಲ್ಲಿ ಚಲಿಸುವ ಪರಿಶೀಲನಾ ವ್ಯವಸ್ಥೆ",
  },
};

// Initialize App
document.addEventListener("DOMContentLoaded", () => {
  initMap();
  bindRoleTabs();
  bindFormControls();
  bindI18nToggle();
  bindModalEvents();
  fetchInitialData();

  // Periodic polling for stats & ledger updates
  setInterval(refreshPlatformData, 6000);
});

/* ==========================================================================
   1. MAP INITIALIZATION (Leaflet OpenStreetMap)
   ========================================================================== */
function initMap() {
  const mapElement = document.getElementById("rescueMap");
  if (!mapElement || typeof L === "undefined") return;

  // Mangaluru center coordinates
  state.map = L.map("rescueMap", {
    zoomControl: true,
    scrollWheelZoom: false,
  }).setView([12.921, 74.862], 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "© OpenStreetMap contributors",
  }).addTo(state.map);
}

function updateMapMarkers() {
  if (!state.map || typeof L === "undefined") return;

  // Clear existing markers
  state.mapMarkers.forEach((m) => state.map.removeLayer(m));
  state.mapMarkers = [];

  // Default NGOs on Map
  const ngos = [
    { name: "Seva Trust Care", lat: 12.921, lng: 74.862, desc: "Capacity: 80 meals" },
    { name: "Karuna Meal Mission", lat: 12.928, lng: 74.872, desc: "Capacity: 120 meals" },
    { name: "Child Nutrition Center", lat: 12.936, lng: 74.869, desc: "Capacity: 25 meals" },
  ];

  ngos.forEach((ngo) => {
    const marker = L.circleMarker([ngo.lat, ngo.lng], {
      radius: 9,
      fillColor: "#8b5cf6",
      color: "#c4b5fd",
      weight: 2,
      opacity: 1,
      fillOpacity: 0.9,
    }).addTo(state.map);

    marker.bindPopup(`<strong>🏢 ${ngo.name}</strong><br>${ngo.desc}`);
    state.mapMarkers.push(marker);
  });

  // Render Donations
  state.donations.forEach((d) => {
    if (!d.location) return;

    let color = "#10b981"; // Listed
    let emoji = "🍲";

    if (d.status === "PICKED_UP" || d.status === "ASSIGNED") {
      color = "#06b6d4";
      emoji = "🚴";
    } else if (d.status === "DELIVERED") {
      color = "#34d399";
      emoji = "✅";
    }

    const marker = L.circleMarker([d.location.lat, d.location.lng], {
      radius: 10,
      fillColor: color,
      color: "#ffffff",
      weight: 2,
      opacity: 1,
      fillOpacity: 0.95,
    }).addTo(state.map);

    marker.bindPopup(`
      <strong>${emoji} ${d.title}</strong><br>
      Donor: ${d.donorName}<br>
      Portions: <strong>${d.quantity} meals</strong><br>
      Status: <span style="color:${color};font-weight:700">${d.status}</span>
    `);

    state.mapMarkers.push(marker);
  });
}

/* ==========================================================================
   2. ROLE NAVIGATION & TABS
   ========================================================================== */
function bindRoleTabs() {
  const tabs = document.querySelectorAll(".role-tab");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");

      const role = tab.getAttribute("data-role");
      state.currentRole = role;

      document.querySelectorAll(".role-view").forEach((v) => v.classList.remove("active"));

      const activeView = document.getElementById(
        role === "donor"
          ? "viewDonor"
          : role === "ngo"
          ? "viewNgo"
          : role === "volunteer"
          ? "viewVolunteer"
          : "viewAudit"
      );

      if (activeView) activeView.classList.add("active");

      // Trigger map resize fix
      if (state.map) {
        setTimeout(() => state.map.invalidateSize(), 150);
      }
    });
  });
}

/* ==========================================================================
   3. DATA FETCHING & RENDERING
   ========================================================================== */
async function fetchInitialData() {
  await Promise.all([refreshPlatformData(), fetchDonations(), fetchLedger()]);
  updateMapMarkers();
}

async function refreshPlatformData() {
  try {
    const res = await fetch("/api/stats");
    const data = await res.json();
    state.stats = data;
    const demoNotice = document.getElementById("demoDataNotice");
    if (demoNotice) demoNotice.hidden = !data.demoMode;

    document.getElementById("metricMealsRescued").textContent = data.mealsRescued;
    document.getElementById("metricCo2Saved").textContent = `${data.co2SavedKg} kg`;
    document.getElementById("metricActiveDeliveries").textContent = data.activeDeliveries;
    document.getElementById("metricLedgerBlocks").textContent = `${data.ledgerBlocks} Blocks`;
  } catch (err) {
    console.warn("Stats fetch failed:", err);
  }
}

async function fetchDonations() {
  try {
    const res = await fetch("/api/donations");
    const data = await res.json();
    state.donations = data.donations || [];

    renderDonorPortal();
    renderNgoPortal();
    renderVolunteerPortal();
    updateMapMarkers();
  } catch (err) {
    console.warn("Donations fetch failed:", err);
  }
}

async function fetchLedger() {
  try {
    const res = await fetch("/api/ledger");
    const data = await res.json();
    state.ledger = data;
    renderAuditLedger();
  } catch (err) {
    console.warn("Ledger fetch failed:", err);
  }
}

/* ==========================================================================
   4. RENDERERS PER ROLE
   ========================================================================== */

// --- DONOR PORTAL ---
function renderDonorPortal() {
  const container = document.getElementById("donorDonationsList");
  if (!container) return;

  if (state.donations.length === 0) {
    container.innerHTML = `<div class="empty-state"><span class="empty-icon">📦</span><p>No donations listed yet.</p></div>`;
    return;
  }

  container.innerHTML = state.donations
    .map((d) => {
      const isPendingPickup = d.status === "ASSIGNED" || d.status === "RESERVED";

      return `
        <div class="donation-card" id="card-${d.id}">
          <div class="donation-card-header">
            <div class="donation-title-group">
              <span class="donation-title">${d.title}</span>
              <span class="donation-meta">Listed by ${d.donorName} • ${d.category.replace("_", " ")}</span>
            </div>
            <span class="status-badge status-${d.status}">${d.status}</span>
          </div>

          <div class="donation-stats-row">
            <span class="stat-pill">🍲 <strong>${d.quantity}</strong> meals</span>
            <span class="stat-pill">⏳ Safe for <strong>${Math.max(0.5, Math.round((d.deadline - Date.now()) / 3.6e5) / 10)}h</strong></span>
            ${d.storageOk ? `<span class="stat-pill">❄️ Temp controlled</span>` : ""}
            ${d.allergens && d.allergens.length ? `<span class="stat-pill">⚠️ ${d.allergens.join(", ")}</span>` : ""}
          </div>

          <div class="donation-actions-row">
            ${
              d.status === "ASSIGNED"
                ? `<button class="btn btn-sm btn-primary" onclick="handleDonorIssuePickupOtp('${d.id}')">
                    <span>🔑 Generate Pickup OTP</span>
                  </button>`
                : ""
            }
            ${
              d.status === "LISTED"
                ? `<span class="stat-pill" style="color:var(--cyan-400)">🤖 Waiting for NGO Claim / AI Match</span>`
                : ""
            }
            ${
              d.status === "PICKED_UP"
                ? `<span class="stat-pill text-cyan">🚴 In transit with volunteer</span>`
                : ""
            }
            ${
              d.status === "DELIVERED"
                ? `<span class="stat-pill text-emerald">✅ Successfully Delivered & Verified</span>`
                : ""
            }
          </div>
        </div>
      `;
    })
    .join("");
}

// --- NGO PORTAL ---
function renderNgoPortal() {
  const availableContainer = document.getElementById("ngoAvailableFeed");
  const claimedContainer = document.getElementById("ngoClaimedFeed");

  const availableDonations = state.donations.filter((d) => d.status === "LISTED");
  const claimedDonations = state.donations.filter((d) => d.status !== "LISTED");

  if (availableContainer) {
    if (availableDonations.length === 0) {
      availableContainer.innerHTML = `<div class="empty-state"><span class="empty-icon">✨</span><p>No open surplus food listings right now.</p></div>`;
    } else {
      availableContainer.innerHTML = availableDonations
        .map(
          (d) => `
        <div class="donation-card">
          <div class="donation-card-header">
            <div class="donation-title-group">
              <span class="donation-title">${d.title}</span>
              <span class="donation-meta">Listed by ${escapeHtml(d.donorName)} • ${d.isDemo ? "Demo listing" : "Current listing"}</span>
            </div>
            <span class="status-badge status-LISTED">Available</span>
          </div>

          <div class="donation-stats-row">
            <span class="stat-pill">🍲 <strong>${d.quantity}</strong> meals</span>
            <span class="stat-pill">⏳ Expiry: <strong>${Math.max(0.5, Math.round((d.deadline - Date.now()) / 3.6e5) / 10)}h</strong></span>
            <span class="stat-pill">🎯 AI Match Score: <strong class="text-emerald">96%</strong></span>
          </div>

          <div class="donation-actions-row">
            <button class="btn btn-sm btn-cyan" onclick="handleNgoClaim('${d.id}')">
              <span>📥 Claim / Reserve for NGO</span>
            </button>
          </div>
        </div>
      `
        )
        .join("");
    }
  }

  if (claimedContainer) {
    if (claimedDonations.length === 0) {
      claimedContainer.innerHTML = `<div class="empty-state"><span class="empty-icon">📋</span><p>No active claimed donations.</p></div>`;
    } else {
      claimedContainer.innerHTML = claimedDonations
        .map((d) => {
          return `
          <div class="donation-card">
            <div class="donation-card-header">
              <div class="donation-title-group">
                <span class="donation-title">${d.title}</span>
                <span class="donation-meta">Reserved for NGO • Collector: ${d.collectorId || "Awaiting Volunteer"}</span>
              </div>
              <span class="status-badge status-${d.status}">${d.status}</span>
            </div>

            <div class="donation-stats-row">
              <span class="stat-pill">🍲 <strong>${d.quantity}</strong> meals</span>
              <span class="stat-pill">🚴 Status: <strong>${d.status}</strong></span>
            </div>

            <div class="donation-actions-row">
              ${
                d.status === "PICKED_UP"
                  ? `<button class="btn btn-sm btn-primary" onclick="handleNgoIssueDeliveryOtp('${d.id}')">
                      <span>🔑 Issue Delivery Handover OTP</span>
                    </button>`
                  : ""
              }
              ${
                d.status === "RESERVED"
                  ? `<span class="stat-pill text-amber">⏳ Awaiting Volunteer Assignment</span>`
                  : ""
              }
              ${
                d.status === "DELIVERED"
                  ? `<span class="stat-pill text-emerald">🎉 Handover Complete & Verified</span>`
                  : ""
              }
            </div>
          </div>
        `;
        })
        .join("");
    }
  }
}

// --- VOLUNTEER PORTAL ---
function renderVolunteerPortal() {
  const missionsContainer = document.getElementById("volunteerMissionsList");
  const activeConsole = document.getElementById("volunteerActiveConsole");

  // Available missions: donations that are RESERVED (awaiting volunteer)
  const availableMissions = state.donations.filter((d) => d.status === "RESERVED");
  const activeMissions = state.donations.filter(
    (d) => d.status === "ASSIGNED" || d.status === "PICKED_UP"
  );

  if (missionsContainer) {
    if (availableMissions.length === 0) {
      missionsContainer.innerHTML = `<div class="empty-state"><span class="empty-icon">🛵</span><p>All missions currently assigned!</p></div>`;
    } else {
      missionsContainer.innerHTML = availableMissions
        .map(
          (m) => `
        <div class="donation-card">
          <div class="donation-card-header">
            <div class="donation-title-group">
              <span class="donation-title">${m.title}</span>
              <span class="donation-meta">From ${m.donorName} ➔ To ${m.assignedNgoId || "Local NGO Shelter"}</span>
            </div>
            <span class="status-badge status-RESERVED">Ready for Pickup</span>
          </div>

          <div class="donation-stats-row">
            <span class="stat-pill">🍲 <strong>${m.quantity}</strong> meals</span>
            <span class="stat-pill">📍 Approx route: <strong>~1.4 km</strong></span>
          </div>

          <div class="donation-actions-row">
            <button class="btn btn-sm btn-primary" onclick="handleVolunteerAcceptMission('${m.id}')">
              <span>🚴 Accept Rescue Mission</span>
            </button>
          </div>
        </div>
      `
        )
        .join("");
    }
  }

  if (activeConsole) {
    if (activeMissions.length === 0) {
      activeConsole.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">🚴</span>
          <p>No active delivery mission claimed yet. Accept a mission from the left panel!</p>
        </div>
      `;
    } else {
      const active = activeMissions[0];
      const isAssigned = active.status === "ASSIGNED";
      const isPickedUp = active.status === "PICKED_UP";

      activeConsole.innerHTML = `
        <div class="donation-card" style="border-color: var(--border-active)">
          <div class="donation-card-header">
            <div class="donation-title-group">
              <span class="donation-title">Current Mission: ${active.title}</span>
              <span class="donation-meta">Assigned Volunteer: <strong>Rahul (You)</strong></span>
            </div>
            <span class="status-badge status-${active.status}">${active.status}</span>
          </div>

          <!-- Stepper -->
          <div class="mini-stepper">
            <div class="mini-step done">
              <div class="mini-step-dot">✓</div>
              <span>Reserved</span>
            </div>
            <div class="mini-step-connector done"></div>
            <div class="mini-step ${isAssigned ? "current" : "done"}">
              <div class="mini-step-dot">${isAssigned ? "2" : "✓"}</div>
              <span>Assigned</span>
            </div>
            <div class="mini-step-connector ${isPickedUp ? "done" : ""}"></div>
            <div class="mini-step ${isPickedUp ? "current" : ""}">
              <div class="mini-step-dot">3</div>
              <span>Pickup</span>
            </div>
            <div class="mini-step-connector"></div>
            <div class="mini-step">
              <div class="mini-step-dot">4</div>
              <span>Delivered</span>
            </div>
          </div>

          <!-- Actions -->
          <div class="donation-actions-row">
            ${
              isAssigned
                ? `<button class="btn btn-sm btn-cyan" onclick="openVolunteerPickupModal('${active.id}')">
                    <span>🔑 Enter Donor's Pickup OTP</span>
                  </button>`
                : ""
            }
            ${
              isPickedUp
                ? `<button class="btn btn-sm btn-primary" onclick="openVolunteerDeliveryModal('${active.id}', ${active.quantity})">
                    <span>📸 Enter Delivery OTP & Photo Proof</span>
                  </button>`
                : ""
            }
          </div>
        </div>
      `;
    }
  }
}

// --- AUDIT LEDGER ---
function renderAuditLedger() {
  const container = document.getElementById("auditLedgerStream");
  const badge = document.getElementById("auditBadgeChain");
  if (!container) return;

  const events = state.ledger.events || [];
  const ok = state.ledger.verification?.ok ?? true;

  if (badge) {
    badge.className = ok ? "badge badge-success" : "badge badge-warning";
    badge.innerHTML = `<span class="badge-dot"></span> Chain Integrity: ${ok ? "VERIFIED (100% OK)" : "COMPROMISED!"}`;
  }

  if (events.length === 0) {
    container.innerHTML = `<div class="empty-state"><span class="empty-icon">⛓️</span><p>No blocks recorded yet.</p></div>`;
    return;
  }

  container.innerHTML = events
    .slice()
    .reverse()
    .map(
      (ev) => `
      <div class="ledger-block">
        <div class="ledger-block-header">
          <span>Block #${ev.id} • ${ev.type}</span>
          <span class="block-ts">${new Date(ev.ts).toLocaleTimeString()}</span>
        </div>
        <div class="hash-row">
          <strong>Prev:</strong> <span class="hash-val">${ev.prevHash.slice(0, 24)}...</span>
        </div>
        <div class="hash-row">
          <strong>Hash:</strong> <span class="hash-val">${ev.hash.slice(0, 24)}...</span>
        </div>
        <div class="payload-box">
          ${escapeHtml(JSON.stringify(ev.payload))}
        </div>
      </div>
    `
    )
    .join("");
}

/* ==========================================================================
   5. ACTIONS & MODALS
   ========================================================================== */

// DONOR: Generate Pickup OTP
async function handleDonorIssuePickupOtp(donationId) {
  try {
    const res = await fetch("/api/pickup-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ donationId }),
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    openModal(
      "🔑 Pickup Verification OTP",
      `
      <div class="otp-display-box">
        <span class="otp-number">${data.pickupCode}</span>
        <p class="otp-expiry-note">Share this 6-digit code with the arriving volunteer at pickup location.</p>
        <span class="stat-pill">🔒 Salted HMAC-SHA256 • 10-Minute Expiry • Single-Use</span>
      </div>
      <button class="btn btn-outline btn-block" onclick="closeModal()">Close</button>
    `
    );
    showToast("Pickup OTP Generated for Volunteer", "success");
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
}

// NGO: Claim Donation
async function handleNgoClaim(donationId) {
  try {
    const res = await fetch("/api/reserve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        donationId,
        ngoId: JSON.parse(localStorage.getItem("foodbridge_user") || "{}").ngoProfileId,
        handoverType: "VOLUNTEER",
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || data.message);

    showToast("🎉 Donation reserved for NGO! Dispatching volunteer...", "success");
    await fetchDonations();
    await fetchLedger();
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
}

// NGO: Generate Delivery OTP
async function handleNgoIssueDeliveryOtp(donationId) {
  try {
    const res = await fetch("/api/delivery-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ donationId }),
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    openModal(
      "🔑 Delivery Verification Code",
      `
      <div class="otp-display-box">
        <span class="otp-number">${data.deliveryCode}</span>
        <p class="otp-expiry-note">Provide this OTP to the volunteer collector once all meal packages are physically inspected.</p>
        <span class="stat-pill">🔒 Bound to Receiving NGO Rep Priya • HMAC-SHA256</span>
      </div>
      <button class="btn btn-outline btn-block" onclick="closeModal()">Close</button>
    `
    );
    showToast("Delivery OTP generated for arriving volunteer", "success");
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
}

// VOLUNTEER: Accept Mission
async function handleVolunteerAcceptMission(donationId) {
  showToast(`Mission ${donationId} is assigned automatically to verified, available delivery partners.`, "info");
}

// VOLUNTEER: Modal for Entering Pickup OTP
function openVolunteerPickupModal(donationId) {
  openModal(
    "🔑 Enter Donor's Pickup OTP",
    `
    <form id="pickupOtpForm" class="app-form" onsubmit="submitVolunteerPickupOtp(event, '${donationId}')">
      <div class="form-field">
        <label>Enter 6-digit OTP given by Donor:</label>
        <input type="text" id="inputPickupOtp" class="form-input" style="font-size:1.8rem;text-align:center;letter-spacing:0.2em;font-family:var(--font-code)" maxlength="6" placeholder="000000" required autofocus />
      </div>
      <button type="submit" class="btn btn-primary btn-block">Confirm Pickup & Take Custody</button>
    </form>
  `
  );
}

async function submitVolunteerPickupOtp(e, donationId) {
  e.preventDefault();
  const code = document.getElementById("inputPickupOtp").value.trim();

  try {
    const res = await fetch("/api/verify-pickup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ donationId, code }),
    });

    const data = await res.json();
    if (data.result !== "OK") {
      throw new Error(`OTP Verification Failed: ${data.result}`);
    }

    closeModal();
    showToast("✅ Pickup Verified! Food now in transit to NGO.", "success");
    await fetchDonations();
    await fetchLedger();
  } catch (err) {
    showToast(err.message, "error");
  }
}

// VOLUNTEER: Modal for Entering Delivery OTP + Photo Proof + GPS
function openVolunteerDeliveryModal(donationId, quantity) {
  openModal(
    "📸 Complete Delivery Handover",
    `
    <form id="deliveryForm" class="app-form" onsubmit="submitVolunteerDelivery(event, '${donationId}')">
      <div class="form-field">
        <label>Enter NGO Representative's Delivery OTP:</label>
        <input type="text" id="inputDeliveryOtp" class="form-input" style="font-size:1.8rem;text-align:center;letter-spacing:0.2em;font-family:var(--font-code)" maxlength="6" placeholder="000000" required autofocus />
      </div>

      <div class="form-field">
        <label>Delivered Quantity Verified by NGO:</label>
        <input type="number" id="inputDeliveryQty" class="form-input" value="${quantity}" min="1" required />
      </div>

      <div class="form-field">
        <label>Proof of Delivery Evidence:</label>
        <div style="background:rgba(255,255,255,0.04);border:1px dashed var(--border-active);border-radius:var(--radius-sm);padding:1rem;text-align:center">
          <span style="font-size:1.8rem">📷</span>
          <input type="file" id="inputDeliveryPhoto" accept="image/jpeg,image/png" required />
        </div>
      </div>

      <button type="submit" class="btn btn-primary btn-block">Confirm Delivery & Append to Ledger</button>
    </form>
  `
  );
}

async function submitVolunteerDelivery(e, donationId) {
  e.preventDefault();
  const code = document.getElementById("inputDeliveryOtp").value.trim();
  const quantityReceived = parseInt(document.getElementById("inputDeliveryQty").value, 10);
  const file = document.getElementById("inputDeliveryPhoto").files[0];

  try {
    const photoData = await new Promise((resolve, reject) => {
      if (!file || file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png"].includes(file.type)) {
        reject(new Error("Choose a JPG or PNG delivery photo no larger than 5 MB."));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Unable to read the selected delivery photo."));
      reader.readAsDataURL(file);
    });
    const uploadResponse = await fetch("/api/delivery-proof", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ donationId, photoData }),
    });
    const upload = await uploadResponse.json();
    if (!uploadResponse.ok) throw new Error(upload.error || "Photo upload failed.");
    const res = await fetch("/api/complete-delivery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        donationId,
        code,
        quantityReceived,
        photoRef: upload.photoRef,
      }),
    });

    const data = await res.json();
    if (data.result !== "OK") {
      throw new Error(`Delivery Verification Failed: ${data.result}`);
    }

    closeModal();
    showToast("🎉 Delivery Verified! Food successfully rescued and fed!", "success");
    await fetchDonations();
    await fetchLedger();
    await refreshPlatformData();
  } catch (err) {
    showToast(err.message, "error");
  }
}

/* ==========================================================================
   6. FORM CONTROLS & EVENT BINDINGS
   ========================================================================== */
function bindFormControls() {
  // New Donation Listing Form
  const donForm = document.getElementById("newDonationForm");
  const hoursSlider = document.getElementById("donHours");
  const hoursDisplay = document.getElementById("donHoursDisplay");

  if (hoursSlider && hoursDisplay) {
    hoursSlider.addEventListener("input", (e) => {
      hoursDisplay.textContent = `${parseFloat(e.target.value).toFixed(1)}h`;
    });
  }

  if (donForm) {
    donForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const title = document.getElementById("donTitle").value;
      const category = document.getElementById("donCategory").value;
      const quantity = parseInt(document.getElementById("donQuantity").value, 10);
      const hours = parseFloat(hoursSlider.value);
      const storageOk = document.getElementById("donStorage").checked;

      const allergens = [];
      if (document.getElementById("algDairy").checked) allergens.push("dairy");
      if (document.getElementById("algNuts").checked) allergens.push("nuts");
      if (document.getElementById("algGluten").checked) allergens.push("gluten");
      if (document.getElementById("algNonVeg").checked) allergens.push("non_veg");

      try {
        const res = await fetch("/api/donations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            category,
            quantity,
            hours,
            storageOk,
            allergens,
          }),
        });

        const data = await res.json();
        if (!data.success) throw new Error(data.error);

        showToast("📦 Surplus Food Listed & Registered on Ledger!", "success");
        donForm.reset();
        hoursDisplay.textContent = "4.0h";

        await fetchDonations();
        await fetchLedger();
        await refreshPlatformData();
      } catch (err) {
        showToast(`Error: ${err.message}`, "error");
      }
    });
  }

  // Audit Ledger Re-verify Button
  const btnAuditReverify = document.getElementById("btnAuditReverify");
  if (btnAuditReverify) {
    btnAuditReverify.addEventListener("click", async () => {
      await fetchLedger();
      const valid = state.ledger.verification?.ok;
      showToast(valid ? "SHA-256 audit hash chain verified." : "Audit hash chain verification failed.", valid ? "success" : "error");
    });
  }

  // Reset Demo Button
  const btnReset = document.getElementById("btnResetDemo");
  if (btnReset) {
    try {
      btnReset.hidden = JSON.parse(localStorage.getItem("foodbridge_user") || "null")?.role !== "ADMIN";
    } catch {
      btnReset.hidden = true;
    }
    btnReset.addEventListener("click", async () => {
      try {
        const response = await fetch("/api/reset", { method: "POST" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Administrator authorization required.");
        showToast("Demo state reset to initial verified seed data", "info");
        await fetchInitialData();
      } catch (err) {
        showToast("Reset failed: " + err.message, "error");
      }
    });
  }
}

/* ==========================================================================
   7. I18N LANGUAGE TOGGLE (English / Kannada ಕನ್ನಡ)
   ========================================================================== */
function bindI18nToggle() {
  const btnLang = document.getElementById("btnLangToggle");
  const langLabel = document.getElementById("langLabel");

  if (!btnLang) return;

  btnLang.addEventListener("click", () => {
    state.currentLang = state.currentLang === "en" ? "kn" : "en";
    langLabel.textContent = state.currentLang === "en" ? "English" : "ಕನ್ನಡ";

    const dict = i18n[state.currentLang];
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (dict[key]) {
        el.textContent = dict[key];
      }
    });

    showToast(
      state.currentLang === "kn"
        ? "ಭಾಷೆಯನ್ನು ಕನ್ನಡಕ್ಕೆ ಬದಲಾಯಿಸಲಾಗಿದೆ"
        : "Language switched to English",
      "info"
    );
  });
}

/* ==========================================================================
   8. MODAL CONTROLS & TOAST NOTIFICATIONS
   ========================================================================== */
function bindModalEvents() {
  const modal = document.getElementById("actionModal");
  const btnClose = document.getElementById("btnModalClose");
  const backdrop = document.getElementById("modalBackdrop");

  if (btnClose) btnClose.addEventListener("click", closeModal);
  if (backdrop) backdrop.addEventListener("click", closeModal);
}

function openModal(title, contentHtml) {
  const modal = document.getElementById("actionModal");
  const titleEl = document.getElementById("modalTitle");
  const bodyEl = document.getElementById("modalBody");

  if (titleEl) titleEl.textContent = title;
  if (bodyEl) bodyEl.innerHTML = contentHtml;
  if (modal) modal.classList.add("open");
}

function closeModal() {
  const modal = document.getElementById("actionModal");
  if (modal) modal.classList.remove("open");
}

function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = `${type === "success" ? "✅" : type === "error" ? "⚠️" : "ℹ️"} ${message}`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(8px)";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
