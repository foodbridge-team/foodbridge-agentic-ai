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
    const donations = data.donations || [];

    // Available missions = RESERVED
    const available = [];
    const active = donations.filter((d) => d.status === "ASSIGNED" || d.status === "PICKED_UP");
    const completed = donations.filter((donation) => donation.status === "DELIVERED");
    document.getElementById("riderCompletedMissions").textContent = completed.length;
    document.getElementById("riderMealsDelivered").textContent = completed
      .reduce((total, donation) => total + (donation.deliveredQuantity || donation.quantity), 0);

    // Render available
    if (availableContainer) {
      if (available.length === 0) {
        availableContainer.innerHTML = `
          <div class="empty-state">
            <span class="empty-icon">🛵</span>
            <p>Verified delivery partners are assigned automatically when an NGO reserves a donation.</p>
          </div>
        `;
      } else {
        availableContainer.innerHTML = available
          .map(
            (m) => `
          <div class="donation-card">
            <div class="donation-card-header">
              <div class="donation-title-group">
                <span class="donation-title">${m.title}</span>
                <span class="donation-meta">From ${m.donorName} ➔ To ${m.assignedNgoId || "Local Shelter"}</span>
              </div>
              <span class="status-badge status-RESERVED">Ready</span>
            </div>

            <div class="donation-stats-row">
              <span class="stat-pill">🍲 <strong>${m.quantity}</strong> meals</span>
              <span class="stat-pill">📍 Approx route: <strong>~1.4 km</strong></span>
              <span class="stat-pill text-cyan">⚡ Standard Insulated Transit</span>
            </div>

            <div class="donation-actions-row">
              <button class="btn btn-sm btn-cyan" onclick="riderAcceptMission('${m.id}')">
                <span>🚴 Accept & Start Rescue</span>
              </button>
            </div>
          </div>
        `
          )
          .join("");
      }
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
                <span><strong>Pickup:</strong> ${escapeHtml(cur.donorName)} (Kitchen)</span>
              </div>
              <div class="route-line-connect"></div>
              <div class="route-point">
                <span class="point-dot dest"></span>
                <span><strong>Destination:</strong> ${escapeHtml(cur.assignedNgoId || "Receiving NGO")}</span>
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
                      <span>📸 Submit Delivery OTP & Camera Proof</span>
                    </button>`
                  : ""
              }
            </div>
          </div>
        `;
      }
    }
  } catch (err) {
    console.warn("Delivery missions error:", err);
  }
}

function openRiderPickupModal(donationId) {
  openDeliveryModal(
    "🔑 Enter Donor's Pickup OTP",
    `
    <form class="app-form" onsubmit="submitRiderPickupOtp(event, '${donationId}')">
      <div class="form-field">
        <label>Enter 6-digit OTP given by Donor:</label>
        <input type="text" id="riderPickupCode" class="form-input" style="font-size:1.8rem;text-align:center;letter-spacing:0.2em;font-family:var(--font-code)" maxlength="6" placeholder="000000" required autofocus />
      </div>
      <button type="submit" class="btn btn-cyan btn-block">Confirm Pickup & Start Navigation</button>
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
    if (data.result !== "OK") {
      throw new Error(`OTP Verification Failed: ${data.result}`);
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
        <input type="text" id="riderDeliveryCode" class="form-input" style="font-size:1.8rem;text-align:center;letter-spacing:0.2em;font-family:var(--font-code)" maxlength="6" placeholder="000000" required autofocus />
      </div>

      <div class="form-field">
        <label>Delivered Quantity Verified:</label>
        <input type="number" id="riderDeliveryQty" class="form-input" value="${quantity}" min="1" required />
      </div>

      <div class="form-field">
        <label>Proof of Delivery Evidence:</label>
        <div style="background:rgba(255,255,255,0.04);border:1px dashed var(--border-active);border-radius:var(--radius-sm);padding:1rem;text-align:center">
          <span style="font-size:1.8rem">📷</span>
          <p style="font-size:0.8rem;color:var(--text-secondary);margin-top:0.3rem">Proof Captured: delivery-proof-mglr.jpg</p>
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
    if (data.result !== "OK") {
      throw new Error(`Delivery Verification Failed: ${data.result}`);
    }

    function renderAvailabilityButton(isAvailable) {
      const button = document.getElementById("btnDeliveryAvailability");
      if (button) button.textContent = isAvailable ? "Available · Set off duty" : "Off duty · Go available";
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

    closeDeliveryModal();
    showToast("🎉 Mission Completed! Food safely delivered and fed!", "success");
    await fetchDeliveryMissions();
  } catch (err) {
    showToast(err.message, "error");
  }
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
  toast.textContent = `${type === "success" ? "✅" : "⚠️"} ${message}`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
