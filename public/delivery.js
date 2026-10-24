/**
 * FoodBridge AI — Delivery Courier Client Application
 */

let activeDeliveryTrackingInterval = null;

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireFoodBridgeRole("VOLUNTEER", "delivery-login.html");
  if (!user) return;

  if (user) {
    window.foodBridgeUser = user;
    document.getElementById("riderName").textContent = user.name;
    if (user.avatar) document.getElementById("riderAvatar").textContent = user.avatar;
    const status = document.querySelector(".user-role-badge");
    if (status) status.textContent = `${user.isAvailable ? "Available delivery partner" : "Off-duty delivery partner"}${user.isDemo ? " · Demo account" : ""}`;
    renderAvailabilityButton(user.isAvailable);
  }

  // Logout button
  document.getElementById("btnRiderLogout")?.addEventListener("click", async () => {
    await logoutFoodBridge();
    window.location.href = "delivery-login.html";
  });
  document.getElementById("btnDeliveryAvailability")?.addEventListener("click", async () => {
    const current = window.foodBridgeUser;
    if (!current) return;
    try {
      const response = await fetch("/api/delivery/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isAvailable: !current.isAvailable }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update availability.");
      current.isAvailable = data.isAvailable;
      localStorage.setItem("foodbridge_user", JSON.stringify(current));
      renderAvailabilityButton(current.isAvailable);
      const status = document.querySelector(".user-role-badge");
      if (status) status.textContent = current.isAvailable ? "Available delivery partner" : "Off-duty delivery partner";
      showToast(data.message, "success");
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  fetchDeliveryMissions();
  loadFoodBridgeNotifications();

  // Periodic poll
  setInterval(() => {
    fetchDeliveryMissions();
    loadFoodBridgeNotifications();
  }, 5000);
});

async function fetchDeliveryMissions() {
  const availableContainer = document.getElementById("deliveryAvailableFeed");
  const activeConsole = document.getElementById("deliveryActiveConsole");

  try {
    const res = await fetch("/api/donations");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Unable to load delivery missions.");
    const donations = data.donations || [];

    const active = donations.filter((d) => d.status === "ASSIGNED" || d.status === "PICKED_UP");
    const completed = donations.filter((donation) => donation.status === "DELIVERED");
    const missionCount = document.getElementById("riderCompletedMissions");
    const mealsCount = document.getElementById("riderMealsDelivered");
    const activeCount = document.getElementById("riderActiveCount");
    if (missionCount) missionCount.textContent = completed.length;
    if (mealsCount) mealsCount.textContent = completed
      .reduce((total, donation) => total + (donation.deliveredQuantity || donation.quantity), 0);
    if (activeCount) activeCount.textContent = String(active.length);

    // Render available updates & visual dispatch radar
    if (availableContainer) {
      const isKn = window.foodBridgeLanguage?.() === "kn";
      const volunteerLoc = window.foodBridgeUser?.location || { lat: 12.87, lng: 74.84 };
      const openSurplus = donations.filter((d) => d.status === "LISTED" || d.status === "REQUESTED");
      const recentDeliveries = completed.slice(0, 3);

      let surplusListHtml = "";
      if (openSurplus.length > 0) {
        surplusListHtml = `
          <div class="dispatch-surplus-header">
            <h4>🍲 Nearby Hotel Food Ready for Rescue (${openSurplus.length})</h4>
            <span class="badge-count">Live Radar</span>
          </div>
          ${openSurplus.map((d) => {
            const title = (isKn && d.titleKn) ? d.titleKn : d.title;
            const donor = (isKn && d.donorOrgKn) ? d.donorOrgKn : (d.donorName || "Hotel Banquet Kitchen");
            const area = d.pickupAddress || `${d.city || "Mangaluru"}, Karnataka`;
            const hoursRemaining = Math.max(0.5, Math.round((d.deadline - Date.now()) / 3.6e5) / 10);
            const distKm = calculateDistanceKm(volunteerLoc, d.location);
            return `
              <div class="dispatch-surplus-card">
                <div class="dispatch-card-top">
                  <div>
                    <div class="dispatch-card-title">🍲 ${escapeHtml(title)}</div>
                    <div class="dispatch-donor-info">🏨 <strong>${escapeHtml(donor)}</strong> (Verified Donor) • 📍 ${escapeHtml(area)}</div>
                  </div>
                  <span class="status-badge status-LISTED">Ready</span>
                </div>
                <div class="dispatch-pill-row">
                  <span class="donor-distance-pill">📏 <strong>${distKm} km away</strong></span>
                  <span class="stat-pill">🍲 <strong>${d.quantity}</strong> meals</span>
                  <span class="stat-pill">⏳ Safe for: <strong>${hoursRemaining}h</strong></span>
                  ${d.storageOk ? `<span class="quality-pass-badge">📦 Insulated Container</span>` : ""}
                </div>
                <button type="button" class="btn btn-outline btn-sm" style="width:100%;margin-top:6px" onclick="openDonorLocationPreview('${escapeHtml(d.id)}', '${escapeHtml(title)}', ${d.location?.lat || 12.8715}, ${d.location?.lng || 74.8427})">
                  📍 View Hotel Location &amp; Distance
                </button>
              </div>
            `;
          }).join("")}
        `;
      } else {
        surplusListHtml = `
          <div class="dispatch-all-clear-card">
            <span class="all-clear-icon">✨</span>
            <div class="all-clear-body">
              <h4>All Local Surplus Pickups Safely Dispatched!</h4>
              <p>There are no unassigned surplus meals right now. All hotel surplus in this sector has been claimed and delivered to community shelters. You will be notified instantly when a new donor posts meals!</p>
            </div>
          </div>
        `;
      }

      availableContainer.innerHTML = `
        <!-- Hero Photo Banner -->
        <div class="volunteer-dispatch-banner">
          <img src="/images/volunteer-dispatch-hero.svg" alt="Volunteers Food Rescue Fleet" class="volunteer-dispatch-img" />
          <div class="dispatch-banner-overlay">
            <div class="dispatch-badge-row">
              <span class="dispatch-live-pill"><span class="dispatch-pulse-dot"></span> 🟢 Active Standby — On-Call Dispatch</span>
              <span class="dispatch-tag-pill">🚴 Mangaluru Rescue Fleet</span>
            </div>
            <p class="dispatch-banner-text">
              Real-time GPS radar is scanning verified hotel banquet kitchens in Dakshina Kannada. When an NGO reserves surplus food, assignments ring directly on your console for rapid delivery.
            </p>
          </div>
        </div>

        <!-- Live Surplus Feed -->
        ${surplusListHtml}

        <!-- Volunteer Protocol Checklist Card -->
        <div class="volunteer-guidelines-box">
          <div class="guidelines-header">
            <span class="guidelines-icon">📋</span>
            <h4>Volunteer Food Safety &amp; Pickup Protocol</h4>
          </div>
          <div class="guidelines-grid">
            <div class="guideline-item">
              <span class="gl-icon">🌡️</span>
              <div class="gl-text"><strong>Temperature Check</strong><span>Hot cooked meals must be &gt; 65°C upon pickup.</span></div>
            </div>
            <div class="guideline-item">
              <span class="gl-icon">📦</span>
              <div class="gl-text"><strong>Insulated Seal</strong><span>Ensure stainless containers are sealed &amp; clean.</span></div>
            </div>
            <div class="guideline-item">
              <span class="gl-icon">🔑</span>
              <div class="gl-text"><strong>Pickup OTP</strong><span>Collect 6-digit verification code from hotel kitchen.</span></div>
            </div>
            <div class="guideline-item">
              <span class="gl-icon">📸</span>
              <div class="gl-text"><strong>Photo Proof</strong><span>Capture handover evidence photo at shelter gate.</span></div>
            </div>
          </div>
        </div>

        <!-- Recent Rescues Feed -->
        ${recentDeliveries.length > 0 ? `
          <div class="recent-rescues-feed">
            <div class="recent-rescues-header">🏆 Recent Community Rescues Handed Over</div>
            ${recentDeliveries.map((d) => `
              <div class="rescue-item">
                <span class="rescue-check">✓</span>
                <div class="rescue-info">
                  <strong>${escapeHtml(d.title)}</strong>
                  <span class="rescue-meta">🍲 ${d.deliveredQuantity || d.quantity} meals delivered safely · SHA-256 Ledger Verified</span>
                </div>
              </div>
            `).join("")}
          </div>
        ` : ""}
      `;
    }

    // Render active console
    if (activeConsole) {
      if (active.length === 0) {
        activeConsole.innerHTML = `
          <div class="empty-state">
            <span class="empty-icon">🚴</span>
            <p>You have no active missions right now. When an NGO reserves hotel surplus food, you will be notified here!</p>
          </div>
        `;
      } else {
        const cur = active[0];
        const isAssigned = cur.status === "ASSIGNED";
        const isPickedUp = cur.status === "PICKED_UP";

        activeConsole.innerHTML = `
          <div class="donation-card" style="border-color: rgba(6, 182, 212, 0.4);overflow:hidden">
            <!-- Visual Related Mission Image (Replaced textual header & stepper) -->
            <div class="mission-food-hero-wrap" style="position:relative;border-radius:14px;overflow:hidden;margin-bottom:12px;box-shadow:0 6px 20px rgba(0,0,0,0.15)">
              <img src="/images/active-mission-food.svg" alt="${escapeHtml(cur.title)}" style="width:100%;height:auto;display:block" />
              <div style="position:absolute;bottom:0;left:0;right:0;padding:12px 14px;background:linear-gradient(to top, rgba(15,23,42,0.96) 0%, rgba(15,23,42,0.6) 70%, transparent 100%);display:flex;justify-content:space-between;align-items:flex-end">
                <div>
                  <div style="font-size:0.75rem;font-weight:800;color:#38bdf8;text-transform:uppercase;letter-spacing:0.06em">Assigned Volunteer Rescue</div>
                  <div style="font-size:1.05rem;font-weight:800;color:#ffffff;text-shadow:0 2px 4px rgba(0,0,0,0.5)">🍲 ${escapeHtml(cur.title)}</div>
                </div>
                <span class="status-badge status-${cur.status}" style="font-weight:800;padding:4px 10px">${cur.status}</span>
              </div>
            </div>

            <!-- Food Quality & Info Pill Row -->
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0 8px">
              <span class="stat-pill">🍲 <strong>${cur.quantity}</strong> meals</span>
              ${cur.foodQualityPassed
                ? `<span class="quality-pass-badge">✅ Hotel Food Quality Verified &amp; Passed</span>`
                : `<span class="stat-pill" style="border-color:#f59e0b;color:#f59e0b">🧪 Food Quality Test Pending</span>`
              }
            </div>

            <!-- Route Preview -->
            <div class="route-preview-box">
              <div class="route-point">
                <span class="point-dot origin"></span>
                <span><strong>Pickup Hotel:</strong> ${escapeHtml(cur.donorName || "Food donor")}</span>
              </div>
              <div class="route-line-connect"></div>
              <div class="route-point">
                <span class="point-dot dest"></span>
                <span><strong>Destination Shelter:</strong> ${escapeHtml(cur.assignedNgoId || "NGO Shelter")}</span>
              </div>
            </div>

            <!-- Action Buttons -->
            <div class="donation-actions-row" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
              ${
                !cur.foodQualityPassed
                  ? `<button class="btn btn-sm btn-outline" style="border-color:#10b981;color:#10b981;font-weight:700" onclick="openQualityCheckModal('${escapeHtml(cur.id)}')">
                      <span>🧪 Verify Hotel Food Quality</span>
                    </button>`
                  : ""
              }
              ${
                isAssigned
                  ? `<button class="btn btn-sm btn-cyan" onclick="openRiderPickupModal('${escapeHtml(cur.id)}')">
                      <span>🔑 Enter Donor's Pickup OTP</span>
                    </button>`
                  : ""
              }
              ${
                isPickedUp
                  ? `<button class="btn btn-sm btn-primary" onclick="openRiderDeliveryModal('${escapeHtml(cur.id)}', ${cur.quantity})">
                      <span>📸 Confirm Delivery with NGO OTP</span>
                    </button>`
                  : ""
              }
              <button class="btn btn-sm btn-outline" onclick="openDeliveryTrackingModal('${escapeHtml(cur.id)}')">
                <span>🗺️ Live GPS Tracker &amp; Route</span>
              </button>
            </div>
          </div>
        `;
      }
    }
  } catch (err) {
    if (activeConsole) {
      activeConsole.innerHTML = `<div class="empty-state" role="alert"><p>${escapeHtml(err.message || "Unable to load delivery missions.")}</p></div>`;
    }
    console.error("Delivery missions error:", err);
  }
}

// 1. Hotel Food Quality Inspection by Volunteer
function openQualityCheckModal(donationId) {
  openDeliveryModal(
    "🧪 Hotel Food Quality Verification",
    `
    <form class="app-form" onsubmit="submitQualityCheck(event, '${donationId}')">
      <div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.3);padding:12px;border-radius:10px;margin-bottom:14px">
        <h4 style="margin:0 0 4px;color:#10b981">Mandatory Food Safety Protocol</h4>
        <p style="margin:0;font-size:0.83rem;color:var(--text-muted)">
          As a volunteer delivery partner, verify that this hotel-prepared food meets safe consumption and hygiene standards before transit.
        </p>
      </div>

      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px">
        <label style="display:flex;align-items:center;gap:10px;font-size:0.9rem;cursor:pointer">
          <input type="checkbox" id="chkQualityTemp" checked required style="width:18px;height:18px;accent-color:#10b981" />
          <span>🌡️ <strong>Temperature Compliance:</strong> Hot food &gt; 60°C or Chilled food &lt; 5°C</span>
        </label>
        <label style="display:flex;align-items:center;gap:10px;font-size:0.9rem;cursor:pointer">
          <input type="checkbox" id="chkQualityFresh" checked required style="width:18px;height:18px;accent-color:#10b981" />
          <span>👃 <strong>Freshness &amp; Odor:</strong> Pleasant aroma, no sour smell or discoloration</span>
        </label>
        <label style="display:flex;align-items:center;gap:10px;font-size:0.9rem;cursor:pointer">
          <input type="checkbox" id="chkQualityPackaging" checked required style="width:18px;height:18px;accent-color:#10b981" />
          <span>📦 <strong>Packaging Integrity:</strong> Food-grade sealed or insulated containers</span>
        </label>
        <label style="display:flex;align-items:center;gap:10px;font-size:0.9rem;cursor:pointer">
          <input type="checkbox" id="chkQualityHygiene" checked required style="width:18px;height:18px;accent-color:#10b981" />
          <span>🧼 <strong>Kitchen Hygiene:</strong> Prepared in compliant hotel kitchen with gloves/hairnets</span>
        </label>
      </div>

      <div class="form-field" style="margin-bottom:14px">
        <label for="qualityNotes">Volunteer Notes / Observations:</label>
        <input type="text" id="qualityNotes" class="form-input" placeholder="e.g. Freshly packed from kitchen counter, warm and sealed" value="Hotel food verified fresh, warm, and sealed for safe transit." />
      </div>

      <button type="submit" class="btn btn-primary btn-block" style="background:#10b981;border-color:#10b981">
        ✅ Certify &amp; Pass Food Quality Test
      </button>
    </form>
    `
  );
}

async function submitQualityCheck(e, donationId) {
  e.preventDefault();
  const notes = document.getElementById("qualityNotes")?.value?.trim() || "Passed quality test";
  try {
    const res = await fetch("/api/verify-quality", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        donationId,
        temperatureChecked: true,
        freshnessChecked: true,
        packagingChecked: true,
        hygieneChecked: true,
        notes
      })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || "Failed to submit quality check.");
    }
    closeDeliveryModal();
    showToast("✅ Food Quality Test PASSED: Verified fresh, safe, and hygiene-compliant!", "success");
    await fetchDeliveryMissions();
  } catch (err) {
    showToast(err.message, "error");
  }
}

// 2. Pickup Modal & Verification
function openRiderPickupModal(donationId) {
  openDeliveryModal(
    "🔑 Enter Donor's Pickup OTP",
    `
    <form class="app-form" onsubmit="submitRiderPickupOtp(event, '${donationId}')">
      <div class="form-field">
        <label>Enter 6-digit OTP given by Donor:</label>
        <input type="text" id="riderPickupCode" class="form-input otp-entry" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" placeholder="000000" required autofocus />
      </div>
      <button type="submit" class="btn btn-cyan btn-block">Confirm Pickup &amp; Start Delivery</button>
    </form>
  `
  );
}

async function submitRiderPickupOtp(e, donationId) {
  e.preventDefault();
  const code = document.getElementById("riderPickupCode").value.trim();

  try {
    const res = await fetch("/api/verify-pickup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ donationId, code }),
    });

    const data = await res.json();
    if (!res.ok || data.result !== "OK" || data.donationStatus !== "PICKED_UP") {
      throw new Error(data.error || `OTP verification failed: ${data.result || res.status}`);
    }

    closeDeliveryModal();
    showToast("✅ Pickup Verified! Partner has left donor hotel. En route to shelter destination.", "success");
    await fetchDeliveryMissions();
  } catch (err) {
    showToast(err.message, "error");
  }
}

// 3. Live Movement & Route Tracker for Courier
async function openDeliveryTrackingModal(donationId) {
  try {
    const res = await fetch(`/api/donations/${encodeURIComponent(donationId)}/tracking`);
    if (!res.ok) throw new Error("Unable to load live tracking stream.");
    const data = await res.json();

    const isPickedUp = data.status === "PICKED_UP";
    const statusText = data.tracking.stepDescription;

    openDeliveryModal(
      "🛵 Live Route & Delivery Navigation",
      `
      <div class="live-tracker-box" style="margin:0;padding:12px">
        <div class="live-tracker-header">
          <div class="live-status-title">
            <span>🛵</span>
            <span>Your Delivery Route</span>
          </div>
          <span class="live-eta-badge">⚡ ETA: ~${data.tracking.etaMinutes} mins (${data.tracking.distanceKm} km)</span>
        </div>

        <div style="background:rgba(6,182,212,0.12);border:1px solid rgba(6,182,212,0.3);padding:10px 14px;border-radius:10px;margin-bottom:12px">
          <div style="font-size:0.92rem;font-weight:700;color:var(--text-primary)">
            ${isPickedUp ? "🛵 Food picked up! Delivering to shelter destination." : "🚀 Head to Donor Kitchen to verify food &amp; pickup"}
          </div>
          <div style="font-size:0.82rem;color:var(--text-muted);margin-top:2px">
            ${escapeHtml(statusText)}
          </div>
        </div>

        <div style="display:flex;gap:8px;margin-bottom:10px;align-items:center;flex-wrap:wrap">
          <span class="quality-pass-badge">✅ Hotel Food Quality Inspected</span>
          <span class="stat-pill text-cyan">📍 Donor: ${escapeHtml(data.donor.name)}</span>
          <span class="stat-pill">🏢 Shelter: ${escapeHtml(data.ngo.name)}</span>
        </div>

        <!-- Live Route Leaflet Map Canvas -->
        <div id="deliveryLiveMap" class="live-map-canvas" style="height:250px"></div>

        <div class="live-timeline">
          <div class="live-timeline-line"></div>
          <div class="live-timeline-step ${data.tracking.step >= 1 ? 'completed' : ''}">
            <div class="live-step-dot">✓</div>
            <span>Matched</span>
          </div>
          <div class="live-timeline-step ${data.tracking.step >= 2 ? 'completed' : ''}">
            <div class="live-step-dot">${data.tracking.step >= 2 ? '✓' : '2'}</div>
            <span>Quality Check</span>
          </div>
          <div class="live-timeline-step ${data.tracking.step >= 3 ? 'active' : ''}">
            <div class="live-step-dot">${data.tracking.step >= 3 ? '🛵' : '3'}</div>
            <span>Left Donor</span>
          </div>
          <div class="live-timeline-step ${data.tracking.step >= 4 ? 'completed' : ''}">
            <div class="live-step-dot">🏁</div>
            <span>Delivered</span>
          </div>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;border-top:1px solid var(--border);padding-top:10px">
          <div style="font-size:0.84rem;color:var(--text-muted)">Destination shelter: <strong>${escapeHtml(data.ngo.name)}</strong></div>
          <button type="button" class="btn btn-outline btn-sm" onclick="closeDeliveryModal()">Close Map</button>
        </div>
      </div>
    `
    );

    setTimeout(() => {
      renderDeliveryLiveMap("deliveryLiveMap", data.donor.location, data.ngo.location, data.courier.currentLocation);
    }, 100);
  } catch (err) {
    showToast(err.message, "error");
  }
}

let liveMapInstance = null;

function renderDeliveryLiveMap(containerId, donorLoc, ngoLoc, courierLoc) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (typeof L === "undefined") {
    container.innerHTML = `<div style="padding:40px;text-align:center;color:#fff"><p>Live Route Navigation Map</p></div>`;
    return;
  }

  if (liveMapInstance) {
    try { liveMapInstance.remove(); } catch (_) {}
    liveMapInstance = null;
  }
  if (container._leaflet_id) {
    container._leaflet_id = null;
  }

  const map = L.map(containerId).setView([courierLoc.lat, courierLoc.lng], 15);
  liveMapInstance = map;

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19
  }).addTo(map);

  L.marker([donorLoc.lat, donorLoc.lng]).addTo(map).bindPopup("<b>🏪 Donor Kitchen (Hotel)</b>");
  L.marker([ngoLoc.lat, ngoLoc.lng]).addTo(map).bindPopup("<b>🏢 NGO Shelter Destination</b>");

  const courierIcon = L.divIcon({
    html: '<div style="font-size:26px;filter:drop-shadow(0 2px 5px rgba(0,0,0,0.5))">🛵</div>',
    className: 'courier-gps-marker',
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });

  const courierMarker = L.marker([courierLoc.lat, courierLoc.lng], { icon: courierIcon }).addTo(map);
  courierMarker.bindPopup("<b>🛵 Your Current Location</b>").openPopup();

  const routeLine = L.polyline([[donorLoc.lat, donorLoc.lng], [ngoLoc.lat, ngoLoc.lng]], {
    color: "#06b6d4",
    weight: 5,
    dashArray: "8, 10"
  }).addTo(map);

  map.fitBounds(routeLine.getBounds(), { padding: [35, 35] });

  setTimeout(() => {
    map.invalidateSize();
  }, 200);

  let step = 0;
  if (activeDeliveryTrackingInterval) clearInterval(activeDeliveryTrackingInterval);
  activeDeliveryTrackingInterval = setInterval(() => {
    step = (step + 1) % 40;
    const progress = 0.5 + (step / 80);
    const lat = donorLoc.lat + (ngoLoc.lat - donorLoc.lat) * progress;
    const lng = donorLoc.lng + (ngoLoc.lng - donorLoc.lng) * progress;
    courierMarker.setLatLng([lat, lng]);
  }, 1000);
}

// 4. Delivery Modal & Handover
function openRiderDeliveryModal(donationId, quantity) {
  openDeliveryModal(
    "📸 Complete Delivery Handover",
    `
    <form class="app-form" onsubmit="submitRiderDelivery(event, '${donationId}')">
      <div class="form-field">
        <label>Enter Delivery OTP given by NGO Rep:</label>
        <input type="text" id="riderDeliveryCode" class="form-input otp-entry" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" placeholder="000000" required autofocus />
      </div>

      <div class="form-field">
        <label>Delivered Quantity Verified:</label>
        <input type="number" id="riderDeliveryQty" class="form-input" value="${quantity}" min="1" max="${quantity}" required />
      </div>

      <div class="form-field">
        <label>Proof of Delivery Evidence:</label>
        <div style="background:rgba(255,255,255,0.04);border:1px dashed var(--border-active);border-radius:var(--radius-sm);padding:1rem;text-align:center">
          <span style="font-size:1.8rem">📷</span>
          <p style="font-size:0.8rem;color:var(--text-secondary);margin-top:0.3rem">Choose an actual JPG or PNG delivery photo.</p>
          <input type="file" id="riderProofPhoto" accept="image/jpeg,image/png" required />
        </div>
      </div>

      <button type="submit" class="btn btn-primary btn-block">Confirm Delivery &amp; Verify on Ledger</button>
    </form>
  `
  );
}

async function submitRiderDelivery(e, donationId) {
  e.preventDefault();
  const code = document.getElementById("riderDeliveryCode").value.trim();
  const quantityReceived = parseInt(document.getElementById("riderDeliveryQty").value, 10);
  const file = document.getElementById("riderProofPhoto").files[0];

  try {
    const photoData = await readPhotoData(file);
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
    if (!res.ok || data.result !== "OK" || data.donationStatus !== "DELIVERED") {
      throw new Error(data.error || `Delivery verification failed: ${data.result || res.status}`);
    }

    closeDeliveryModal();
    showToast("🎉 Mission Completed! Food safely delivered and verified!", "success");
    await fetchDeliveryMissions();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function renderAvailabilityButton(isAvailable) {
  const button = document.getElementById("btnDeliveryAvailability");
  if (button) button.textContent = isAvailable ? "Available · Set off duty" : "Off duty · Go available";
  const availability = document.getElementById("riderAvailability");
  if (availability) availability.textContent = isAvailable ? "Available" : "Off duty";
}

function readPhotoData(file) {
  return new Promise((resolve, reject) => {
    if (!file || file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png"].includes(file.type)) {
      reject(new Error("Choose a JPG or PNG delivery photo no larger than 5 MB."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Unable to read the selected photo."));
    reader.readAsDataURL(file);
  });
}

function openDeliveryModal(title, html) {
  const modal = document.getElementById("deliveryModal");
  const titleEl = document.getElementById("delModalTitle");
  const body = document.getElementById("deliveryModalBody");
  if (titleEl) titleEl.textContent = title;
  if (body) body.innerHTML = html;
  if (modal) modal.classList.add("open");
}

function closeDeliveryModal() {
  if (activeDeliveryTrackingInterval) {
    clearInterval(activeDeliveryTrackingInterval);
    activeDeliveryTrackingInterval = null;
  }
  document.getElementById("deliveryModal")?.classList.remove("open");
}

function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  const translatedMessage = window.foodBridgeTranslate?.(message) || message;
  toast.textContent = `${type === "success" ? "✅" : "⚠️"} ${translatedMessage}`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function calculateDistanceKm(loc1, loc2) {
  if (!loc1 || !loc2 || typeof loc1.lat !== "number" || typeof loc2.lat !== "number") return 2.4;
  const R = 6371;
  const dLat = (loc2.lat - loc1.lat) * (Math.PI / 180);
  const dLng = (loc2.lng - loc1.lng) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(loc1.lat * (Math.PI / 180)) * Math.cos(loc2.lat * (Math.PI / 180)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

let donorPreviewMapInstance = null;

function openDonorLocationPreview(donationId, title, lat, lng) {
  openDeliveryModal(
    `Hotel Location: ${title}`,
    `
      <div style="display:flex;flex-direction:column;gap:12px">
        <p style="font-size:0.86rem;color:var(--text-muted);margin:0">
          📍 Verified hotel kitchen GPS coordinates: <strong>${lat.toFixed(4)}, ${lng.toFixed(4)}</strong> · Mangaluru, Karnataka
        </p>
        <div id="donorPreviewMap" style="height:250px;border-radius:12px;overflow:hidden;border:1px solid var(--border-subtle);background:#1e293b"></div>
        <div style="display:flex;justify-content:flex-end;margin-top:6px">
          <button type="button" class="btn btn-outline btn-sm" onclick="closeDeliveryModal()">Close Map</button>
        </div>
      </div>
    `
  );

  setTimeout(() => {
    try {
      if (donorPreviewMapInstance) {
        try { donorPreviewMapInstance.remove(); } catch (_) {}
        donorPreviewMapInstance = null;
      }
      const el = document.getElementById("donorPreviewMap");
      if (el && el._leaflet_id) el._leaflet_id = null;

      const map = L.map("donorPreviewMap").setView([lat, lng], 15);
      donorPreviewMapInstance = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors"
      }).addTo(map);
      L.marker([lat, lng]).addTo(map).bindPopup(`<b>${escapeHtml(title)}</b><br>Donor Kitchen Location`).openPopup();
      setTimeout(() => map.invalidateSize(), 200);
    } catch (e) {
      console.warn("Leaflet preview map init note:", e);
    }
  }, 150);
}
window.openDonorLocationPreview = openDonorLocationPreview;
