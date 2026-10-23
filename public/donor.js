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
          location: {
            lat: Number(document.getElementById("postLat").value),
            lng: Number(document.getElementById("postLng").value),
          },
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Unable to publish donation.");

      showToast("🎉 Surplus Food Listed! Matched on Ledger.", "success");
      form.reset();
      hoursDisplay.textContent = "4.0 hrs";

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

            <div class="donation-actions-row">
              ${
                canIssueOtp
                  ? `<button class="btn-generate-otp" onclick="donorGenerateOtp('${d.id}')">
                      🔑 Generate Pickup OTP
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
    if (!data.success) throw new Error(data.error);

    openDonorModal(`
      <div class="otp-display-box">
        <span class="otp-number">${data.pickupCode}</span>
        <p class="otp-expiry-note">Present this secure 6-digit code to the arriving volunteer collector.</p>
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
  toast.textContent = `${type === "success" ? "✅" : "⚠️"} ${message}`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
