/**
 * FoodBridge AI — Donor Portal Client Application
 */

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireFoodBridgeRole("DONOR", "donor-login.html");
  if (!user) return;

  if (user) {
    document.getElementById("donorName").textContent = user.organization || user.name;
    if (user.avatar) document.getElementById("donorAvatar").textContent = user.avatar;
    const status = document.querySelector(".user-role-badge");
    if (status) status.textContent = `${user.verification === "APPROVED" ? "Verified Food Donor" : `Verification ${user.verification}`}${user.isDemo ? " · Demo account" : ""}`;
  }

  // Logout button
  document.getElementById("btnDonorLogout")?.addEventListener("click", async () => {
    await logoutFoodBridge();
    window.location.href = "donor-login.html";
  });

  // Slider update
  const hoursSlider = document.getElementById("postHours");
  const hoursDisplay = document.getElementById("postHoursDisplay");
  hoursSlider?.addEventListener("input", (e) => {
    hoursDisplay.textContent = `${parseFloat(e.target.value).toFixed(1)} hrs`;
  });
  const pickupAddress = document.getElementById("postPickupAddress");
  const pickupLat = document.getElementById("postLat");
  const pickupLng = document.getElementById("postLng");
  const pickupLocationStatus = document.getElementById("pickupLocationStatus");
  const pickupLocationButton = document.getElementById("btnConfirmPickupLocation");
  let locationWatchId = null;
  let confirmedAddress = "";
  const locationDefaultStatus = "Enter the pickup address, then confirm the pickup location from the device at that location.";

  const stopLocationTracking = (message) => {
    if (locationWatchId !== null) {
      navigator.geolocation.clearWatch(locationWatchId);
      locationWatchId = null;
    }
    if (pickupLocationButton) {
      pickupLocationButton.disabled = false;
      pickupLocationButton.textContent = "Use this device's location for matching";
    }
    if (message && pickupLocationStatus) pickupLocationStatus.textContent = message;
  };

  pickupAddress?.addEventListener("input", () => {
    stopLocationTracking("Confirm the pickup location again after changing the address.");
    pickupLat.value = "";
    pickupLng.value = "";
    confirmedAddress = "";
  });
  pickupLocationButton?.addEventListener("click", async () => {
    if (locationWatchId !== null) {
      stopLocationTracking("Location tracking stopped. Your last confirmed pickup point is saved.");
      return;
    }
    if (!pickupAddress?.value.trim()) {
      showToast("Enter the pickup address before confirming its location.", "warning");
      pickupAddress?.focus();
      return;
    }
    if (!window.isSecureContext) {
      const message = "Use a secure connection (HTTPS or localhost) to access device location.";
      if (pickupLocationStatus) pickupLocationStatus.textContent = message;
      showToast(message, "error");
      return;
    }
    if (!navigator.geolocation?.watchPosition) {
      showToast("This browser does not provide device location. Pickup matching cannot be confirmed.", "error");
      if (pickupLocationStatus) pickupLocationStatus.textContent = "Location tracking is unavailable on this browser.";
      return;
    }

    if (navigator.permissions?.query) {
      try {
        const permission = await navigator.permissions.query({ name: "geolocation" });
        if (permission.state === "denied") {
          const message = "Location permission is blocked. Allow location access in your browser settings.";
          if (pickupLocationStatus) pickupLocationStatus.textContent = message;
          showToast(message, "error");
          return;
        }
      } catch {
        // Some browsers do not support querying geolocation permission; watchPosition will still request it.
      }
    }

    confirmedAddress = pickupAddress.value.trim();
    pickupLocationButton.textContent = "Confirming location...";
    if (pickupLocationStatus) pickupLocationStatus.textContent = "Confirming location...";
    locationWatchId = navigator.geolocation.watchPosition(
      (position) => {
        if (pickupAddress.value.trim() !== confirmedAddress) {
          pickupLat.value = "";
          pickupLng.value = "";
          confirmedAddress = "";
          stopLocationTracking("The address changed while location was being checked. Confirm the new pickup point again.");
          return;
        }
        const { latitude, longitude, accuracy } = position.coords;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
            latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
          stopLocationTracking("Unable to confirm the pickup point. Try again at the pickup address.");
          return;
        }
        pickupLat.value = String(latitude);
        pickupLng.value = String(longitude);
        pickupLocationButton.textContent = "Stop location tracking";
        if (pickupLocationStatus) {
          pickupLocationStatus.textContent = `Device location confirmed (±${Math.round(accuracy)} m). Tracking while this form is open.`;
        }
      },
      (error) => {
        const message = error.code === error.PERMISSION_DENIED
          ? "Location access is blocked. Enable location permission in your browser settings and try again."
          : error.code === error.POSITION_UNAVAILABLE
            ? "Location unavailable. Check your device's location services and try again."
            : "Location request timed out. Move to an area with a clearer GPS signal and try again.";
        stopLocationTracking(message);
        showToast(message, "error");
      }, {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0,
      }
    );
  });
  window.addEventListener("pagehide", () => stopLocationTracking());

  // Load Initial Data
  fetchDonorDonations();
  fetchDonorStats();
  loadFoodBridgeNotifications();

  // Periodic poll
  setInterval(() => {
    fetchDonorDonations();
    fetchDonorStats();
    loadFoodBridgeNotifications();
  }, 5000);

  // Form submit
  const form = document.getElementById("donorPostForm");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const title = document.getElementById("postTitle").value.trim();
    const category = document.getElementById("postCategory").value;
    const quantity = parseInt(document.getElementById("postQuantity").value, 10);
    const hours = parseFloat(hoursSlider.value);
    const storageOk = document.getElementById("postStorage").checked;
    const address = pickupAddress.value.trim();
    const lat = Number(pickupLat.value);
    const lng = Number(pickupLng.value);
    if (!address || !pickupLat.value || !pickupLng.value || address !== confirmedAddress) {
      showToast("Enter the pickup address and confirm its location before publishing.", "error");
      return;
    }

    const allergens = [];
    if (document.getElementById("algDairy").checked) allergens.push("dairy");
    if (document.getElementById("algNuts").checked) allergens.push("nuts");
    if (document.getElementById("algGluten").checked) allergens.push("gluten");
    if (document.getElementById("algNonVeg").checked) allergens.push("non_veg");

    const submitBtn = document.getElementById("btnPublish");
    submitBtn.disabled = true;
    submitBtn.textContent = "Matching with verified NGOs...";

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
          pickupAddress: address,
          location: { lat, lng },
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Unable to publish donation.");

      showToast("🎉 Surplus Food Listed! Matched on Ledger.", "success");
      stopLocationTracking();
      confirmedAddress = "";
      form.reset();
      hoursDisplay.textContent = "4.0 hrs";
      if (pickupLocationStatus) pickupLocationStatus.textContent = locationDefaultStatus;
      const locationButton = document.getElementById("btnConfirmPickupLocation");
      if (locationButton) locationButton.textContent = "Use this device's location for matching";

      await fetchDonorDonations();
      await fetchDonorStats();
    } catch (err) {
      showToast("Error: " + err.message, "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "🚀 Publish Surplus Food Listing";
    }
  });
});

function setQty(val) {
  document.getElementById("postQuantity").value = val;
}

async function fetchDonorStats() {
  try {
    const res = await fetch("/api/donations");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Unable to load donor activity.");
    if (!res.ok) throw new Error(data.error || "Unable to load donor activity.");
    const deliveredMeals = (data.donations || [])
      .filter((donation) => donation.status === "DELIVERED")
      .reduce((total, donation) => total + (donation.deliveredQuantity || donation.quantity), 0);
    document.getElementById("statMealsDonated").textContent = deliveredMeals;
    document.getElementById("statCo2Saved").textContent = `${Math.round(deliveredMeals * 2.5 * 10) / 10} kg`;
  } catch (error) {
    console.warn("Donor activity fetch error:", error);
  }
}

async function fetchDonorDonations() {
  const container = document.getElementById("donorListingsStream");
  if (!container) return;

  try {
    const res = await fetch("/api/donations");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Unable to load donor donations.");
    const donations = data.donations || [];

    if (donations.length === 0) {
      container.innerHTML = `<div class="empty-state"><span class="empty-icon">📦</span><p>No active food listings. Create one on the left!</p></div>`;
      return;
    }

    container.innerHTML = donations
      .map((d) => {
        const canIssueOtp = d.status === "ASSIGNED";

        return `
          <div class="donation-card">
            <div class="donation-card-header">
              <div class="donation-title-group">
                <span class="donation-title">${escapeHtml(d.title)}</span>
                <span class="donation-meta">${escapeHtml(d.category.replaceAll("_", " "))} • ID: ${escapeHtml(d.id)} ${d.isDemo ? "• Demo data" : ""}</span>
              </div>
              <span class="status-badge status-${d.status}">${d.status}</span>
            </div>

            <div class="donation-stats-row">
              <span class="stat-pill">🍲 <strong>${d.quantity}</strong> meals</span>
              <span class="stat-pill">⏳ Expiry: <strong>${Math.max(0.5, Math.round((d.deadline - Date.now()) / 3.6e5) / 10)}h</strong></span>
              ${d.assignedNgoId ? `<span class="stat-pill text-cyan">🏢 Reserved by ${escapeHtml(d.assignedNgoId)}</span>` : ""}
              ${d.collectorId ? `<span class="stat-pill text-emerald">🚴 ${d.handoverType === "NGO_SELF_PICKUP" ? "NGO Self-Pickup" : `Partner: ${escapeHtml(d.collectorId)}`}</span>` : ""}
            </div>
            ${d.pickupAddress ? `<div class="donation-location-row"><span class="location-icon">📍</span><span class="location-text">${escapeHtml(d.pickupAddress)}</span></div>` : ""}

            <div class="donation-actions-row">
              ${
                canIssueOtp
                  ? `<button type="button" class="btn-generate-otp" onclick="donorGenerateOtp('${d.id}')">
                      🔑 Get OTP
                    </button>`
                  : ""
              }
              ${
                d.status === "LISTED"
                  ? `<span class="stat-pill text-cyan">Waiting for NGO Claim / AI Match</span>`
                  : ""
              }
              ${
                d.status === "PICKED_UP"
                  ? `<span class="stat-pill text-emerald">🚴 ${d.handoverType === "NGO_SELF_PICKUP" ? "Collected by NGO Self-Pickup" : "In Transit with Delivery Partner"}</span>`
                  : ""
              }
              ${
                d.status === "DELIVERED"
                  ? `<span class="stat-pill text-emerald">✅ Successfully Delivered to Shelter</span>`
                  : ""
              }
            </div>
          </div>
        `;
      })
      .join("");
  } catch (e) {
    console.warn("Donor listings fetch error:", e);
  }
}

async function donorGenerateOtp(donationId) {
  try {
    const res = await fetch("/api/pickup-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ donationId }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || "Unable to issue pickup code.");

    openDonorModal(`
      <div class="otp-display-box">
        <span class="otp-code-label">Share this pickup code with the arriving rider</span>
        <span class="otp-number">${data.pickupCode}</span>
        <p class="otp-expiry-note">This code is valid for 10 minutes and can be used once.</p>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;justify-content:center;margin-top:0.5rem">
          <span class="stat-pill">🔒 HMAC-SHA256 Salted</span>
          <span class="stat-pill">⏱️ 10-Min Expiry</span>
          <span class="stat-pill">⚡ Single-Use</span>
        </div>
      </div>
      <button class="btn btn-outline btn-block" onclick="closeDonorModal()">Close & Return to Dashboard</button>
    `);

    showToast("Pickup OTP Generated!", "success");
  } catch (err) {
    showToast(err.message, "error");
  }
}

function openDonorModal(html) {
  const modal = document.getElementById("donorModal");
  const body = document.getElementById("donorModalBody");
  if (body) body.innerHTML = html;
  if (modal) modal.classList.add("open");
}

function closeDonorModal() {
  document.getElementById("donorModal")?.classList.remove("open");
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
