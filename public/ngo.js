/**
 * FoodBridge AI — NGO Portal Client Application
 */

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireFoodBridgeRole("NGO", "ngo-login.html");
  if (!user) return;

  if (user) {
    window.foodBridgeUser = user;
    document.getElementById("ngoName").textContent = user.organization || user.name;
    if (user.avatar) document.getElementById("ngoAvatar").textContent = user.avatar;
    const status = document.querySelector(".user-role-badge");
    if (status) status.textContent = `${user.verification === "APPROVED" ? "Verified Relief Partner" : `Verification ${user.verification}`}${user.isDemo ? " · Demo account" : ""}`;
  }

  // Logout button
  document.getElementById("btnNgoLogout")?.addEventListener("click", async () => {
    await logoutFoodBridge();
    window.location.href = "ngo-login.html";
  });

  // Fetch feeds
  fetchNgoFeeds();
  loadFoodBridgeNotifications();

  // Periodic poll
  setInterval(() => {
    fetchNgoFeeds();
    loadFoodBridgeNotifications();
  }, 5000);

  if (user) {
    document.getElementById("ngoCapacity").textContent = `${user.freeCapacity ?? user.capacity ?? "—"} meals`;
    document.getElementById("ngoVerification").textContent = user.verification;
  }
});

async function fetchNgoFeeds() {
  const surplusContainer = document.getElementById("ngoSurplusFeed");
  const inboundContainer = document.getElementById("ngoInboundFeed");

  try {
    const res = await fetch("/api/donations");
    const data = await res.json();
    const donations = data.donations || [];

    const available = donations.filter((d) => d.status === "LISTED");
    const claimed = donations.filter((d) => d.status !== "LISTED");
    const matches = await Promise.all(available.map(async (donation) => {
      const matchResponse = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ donationId: donation.id }),
      });
      const matchData = await matchResponse.json();
      return { donation, matchData };
    }));

    // Update inbound courier count
    const inboundTrips = donations.filter((d) => d.status === "ASSIGNED" || d.status === "PICKED_UP").length;
    document.getElementById("ngoInboundCount").textContent = inboundTrips;
    document.getElementById("ngoTotalReceived").textContent = donations
      .filter((donation) => donation.status === "DELIVERED")
      .reduce((total, donation) => total + (donation.deliveredQuantity || donation.quantity), 0);

    // 1. Available surplus to claim
    if (surplusContainer) {
      if (available.length === 0) {
        surplusContainer.innerHTML = `<div class="empty-state"><span class="empty-icon">✨</span><p>No open surplus listings right now.</p></div>`;
      } else {
        surplusContainer.innerHTML = matches
          .map(
            ({ donation: d, matchData }) => {
              const match = matchData.ranked?.find((item) => item.ngoId === window.foodBridgeUser?.ngoProfileId);
              const reason = match
                ? match.reasons.map((item) => escapeHtml(item)).join(" · ")
                : escapeHtml(matchData.eligibility?.rejected?.find((item) => item.ngoId === window.foodBridgeUser?.ngoProfileId)?.reason || matchData.eligibility?.donationBlocked || "No eligibility result for this NGO profile.");
              return `
          <div class="donation-card">
            <div class="donation-card-header">
              <div class="donation-title-group">
                <span class="donation-title">${escapeHtml(d.title)}</span>
                <span class="donation-meta">${escapeHtml(d.donorName)} • ${d.isDemo ? "Demo listing" : "Verified donor listing"}${match?.isDemo ? " • Demo shelter profile" : ""}</span>
              </div>
              <span class="status-badge status-LISTED">Available</span>
            </div>

            <div class="donation-stats-row">
              <span class="stat-pill">🍲 <strong>${d.quantity}</strong> meals</span>
              <span class="stat-pill">⏳ Safe for: <strong>${Math.max(0.5, Math.round((d.deadline - Date.now()) / 3.6e5) / 10)}h</strong></span>
              ${match ? `<span class="stat-pill text-emerald">🎯 Suitability: <strong>${match.suitabilityScore}%</strong></span>` : `<span class="stat-pill text-amber">Not eligible for this shelter</span>`}
              ${d.allergens && d.allergens.length ? `<span class="stat-pill text-amber">⚠️ ${d.allergens.map((item) => escapeHtml(item)).join(", ")}</span>` : ""}
            </div>
            <p class="donation-meta" style="margin:.5rem 0">${reason}</p>

            <div class="donation-actions-row">
              ${match ? `
                <button class="btn-claim" onclick="claimDonationForNgo('${escapeHtml(d.id)}', 'VOLUNTEER')"><span>📥 Reserve Verified Delivery</span></button>
                <button class="btn-claim" onclick="claimDonationForNgo('${escapeHtml(d.id)}', 'NGO_SELF_PICKUP')"><span>🚶 Choose NGO Self-Pickup</span></button>
              ` : `<span class="stat-pill text-amber">Reservation blocked by safety/eligibility checks</span>`}
            </div>
          </div>
        `;
            }
          )
          .join("");
      }
    }

    // 2. Claimed inbounds
    if (inboundContainer) {
      if (claimed.length === 0) {
        inboundContainer.innerHTML = `<div class="empty-state"><span class="empty-icon">📋</span><p>No claimed deliveries yet.</p></div>`;
      } else {
        inboundContainer.innerHTML = claimed
          .map((d) => {
            const isPickedUp = d.status === "PICKED_UP";

            return `
            <div class="donation-card">
              <div class="donation-card-header">
                <div class="donation-title-group">
                  <span class="donation-title">${escapeHtml(d.title)}</span>
                  <span class="donation-meta">From ${escapeHtml(d.donorName)} • ${d.handoverType === "NGO_SELF_PICKUP" ? "NGO Self-Pickup" : `Delivery partner: ${escapeHtml(d.collectorId || "Awaiting assignment")}`}</span>
                </div>
                <span class="status-badge status-${d.status}">${d.status}</span>
              </div>

              <div class="donation-stats-row">
                <span class="stat-pill">🍲 <strong>${d.quantity}</strong> meals</span>
                <span class="stat-pill">Status: <strong>${d.status}</strong></span>
              </div>

              <div class="donation-actions-row">
                ${
                  isPickedUp
                    ? `<button class="btn-issue-delivery-otp" onclick="issueDeliveryOtpModal('${escapeHtml(d.id)}', '${d.handoverType}')">
                        <span>🔑 ${d.handoverType === "NGO_SELF_PICKUP" ? "Confirm NGO Self-Pickup Handover" : "Issue Delivery Handover OTP"}</span>
                      </button>`
                    : ""
                }
                ${
                  d.status === "ASSIGNED" && d.handoverType === "NGO_SELF_PICKUP"
                    ? `<button class="btn-claim" onclick="confirmSelfPickup('${escapeHtml(d.id)}')">Confirm donor pickup with OTP</button>`
                    : ""
                }
                ${
                  d.status === "RESERVED"
                    ? `<span class="stat-pill text-amber">⏳ Awaiting Volunteer Acceptance</span>`
                    : ""
                }
                ${
                  d.status === "ASSIGNED"
                    ? `<span class="stat-pill text-cyan">🚴 Volunteer En Route to Donor Kitchen</span>`
                    : ""
                }
                ${
                  d.status === "DELIVERED"
                    ? `<span class="stat-pill text-emerald">🎉 Handover Complete & Verified on Chain</span>`
                    : ""
                }
              </div>
            </div>
          `;
          })
          .join("");
      }
    }
  } catch (err) {
    console.warn("NGO feed error:", err);
  }
}

async function claimDonationForNgo(donationId, handoverType) {
  try {
    const res = await fetch("/api/reserve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ donationId, ngoId: window.foodBridgeUser?.ngoProfileId, handoverType }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Reservation failed.");
    if (!data.success) {
      showToast(data.message || "No delivery partner is available.", "warning");
      return;
    }

    showToast(data.message, "success");
    await fetchNgoFeeds();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function issueDeliveryOtpModal(donationId, handoverType) {
  try {
    const res = await fetch("/api/delivery-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ donationId }),
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    if (handoverType === "NGO_SELF_PICKUP") {
      openNgoModal(`
        <div class="otp-display-box"><span class="otp-number">${escapeHtml(data.deliveryCode)}</span><p class="otp-expiry-note">Confirm the food has been inspected and physically received before submitting.</p></div>
        <form class="app-form" onsubmit="completeSelfPickup(event, '${escapeHtml(donationId)}', '${escapeHtml(data.deliveryCode)}')">
          <label>Received quantity</label><input id="selfPickupQty" type="number" min="1" required />
          <label>Photo evidence (JPG/PNG, max 5 MB)</label><input id="selfPickupPhoto" type="file" accept="image/jpeg,image/png" required />
          <button class="btn btn-primary btn-block" type="submit">Confirm NGO Self-Pickup Handover</button>
        </form>
      `);
    } else {
      openNgoModal(`
        <div class="otp-display-box">
          <span class="otp-number">${escapeHtml(data.deliveryCode)}</span>
          <p class="otp-expiry-note">Give this code to the assigned delivery partner after inspecting the food and container seals.</p>
        </div>
        <button class="btn btn-outline btn-block" onclick="closeNgoModal()">Close Window</button>
      `);
    }

    showToast("Delivery OTP Generated!", "success");
  } catch (err) {
    showToast(err.message, "error");
  }

  async function confirmSelfPickup(donationId) {
    const code = window.prompt("Enter the pickup OTP provided by the donor:");
    if (!code) return;
    try {
      const res = await fetch("/api/verify-pickup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ donationId, code }),
      });
      const data = await res.json();
      if (!res.ok || data.result !== "OK") throw new Error(data.error || `Pickup confirmation failed: ${data.result}`);
      showToast("Pickup confirmed. Confirm inspected handover to complete the record.", "success");
      await fetchNgoFeeds();
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  async function completeSelfPickup(event, donationId, code) {
    event.preventDefault();
    const file = document.getElementById("selfPickupPhoto").files[0];
    const quantityReceived = Number(document.getElementById("selfPickupQty").value);
    try {
      const photoData = await readPhotoData(file);
      const uploadResponse = await fetch("/api/delivery-proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ donationId, photoData }),
      });
      const upload = await uploadResponse.json();
      if (!uploadResponse.ok) throw new Error(upload.error || "Photo upload failed.");
      const response = await fetch("/api/complete-delivery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ donationId, code, quantityReceived, photoRef: upload.photoRef }),
      });
      const result = await response.json();
      if (!response.ok || result.result !== "OK") throw new Error(result.error || `Handover failed: ${result.result}`);
      closeNgoModal();
      showToast("NGO Self-Pickup and handover confirmed.", "success");
      await fetchNgoFeeds();
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  function readPhotoData(file) {
    return new Promise((resolve, reject) => {
      if (!file || file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png"].includes(file.type)) {
        reject(new Error("Choose a JPG or PNG photo no larger than 5 MB."));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Unable to read the selected photo."));
      reader.readAsDataURL(file);
    });
  }
}

function openNgoModal(html) {
  const modal = document.getElementById("ngoModal");
  const body = document.getElementById("ngoModalBody");
  if (body) body.innerHTML = html;
  if (modal) modal.classList.add("open");
}

function closeNgoModal() {
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
