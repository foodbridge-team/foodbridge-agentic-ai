/**
 * FoodBridge AI — Delivery Courier Client Application
 */

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

    // Render available
    if (availableContainer) {
      availableContainer.innerHTML = `
          <div class="empty-state">
            <span class="empty-icon">🛵</span>
            <p>Dispatch will notify you when a verified, available partner is assigned to an NGO reservation.</p>
          </div>
        `;
    }

    // Render active console
    if (activeConsole) {
      if (active.length === 0) {
        activeConsole.innerHTML = `
          <div class="empty-state">
            <span class="empty-icon">🚴</span>
            <p>You have no active missions. Accept a pickup request from the left panel!</p>
          </div>
        `;
      } else {
        const cur = active[0];
        const isAssigned = cur.status === "ASSIGNED";
        const isPickedUp = cur.status === "PICKED_UP";

        activeConsole.innerHTML = `
          <div class="donation-card" style="border-color: rgba(6, 182, 212, 0.4)">
            <div class="donation-card-header">
              <div class="donation-title-group">
                <span class="donation-title">Current Mission: ${escapeHtml(cur.title)}</span>
                <span class="donation-meta">Assigned to: <strong>${escapeHtml(window.foodBridgeUser?.name || "You")}</strong></span>
              </div>
              <span class="status-badge status-${cur.status}">${cur.status}</span>
            </div>

            <!-- Mini Stepper -->
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
                <span>In Transit</span>
              </div>
              <div class="mini-step-connector"></div>
              <div class="mini-step">
                <div class="mini-step-dot">4</div>
                <span>Delivered</span>
              </div>
            </div>

            <!-- Route Preview -->
            <div class="route-preview-box">
              <div class="route-point">
                <span class="point-dot origin"></span>
                <span><strong>Pickup:</strong> ${escapeHtml(cur.donorName || "Food donor")}</span>
              </div>
              <div class="route-line-connect"></div>
              <div class="route-point">
                <span class="point-dot dest"></span>
                <span><strong>Destination:</strong> ${escapeHtml(cur.assignedNgoId || "NGO-SEVA-TRUST")}</span>
              </div>
            </div>

            <div class="donation-actions-row">
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

function openRiderPickupModal(donationId) {
  openDeliveryModal(
    "🔑 Enter Donor's Pickup OTP",
    `
    <form class="app-form" onsubmit="submitRiderPickupOtp(event, '${donationId}')">
      <div class="form-field">
        <label>Enter 6-digit OTP given by Donor:</label>
        <input type="text" id="riderPickupCode" class="form-input otp-entry" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" placeholder="000000" required autofocus />
      </div>
      <button type="submit" class="btn btn-cyan btn-block">Confirm Pickup & Continue Mission</button>
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
    showToast("✅ Pickup Verified! Now transport food to destination shelter.", "success");
    await fetchDeliveryMissions();
  } catch (err) {
    showToast(err.message, "error");
  }
}

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

      <button type="submit" class="btn btn-primary btn-block">Confirm Delivery & Verify on Ledger</button>
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
    showToast("🎉 Mission Completed! Food safely delivered and fed!", "success");
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
