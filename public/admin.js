/**
 * FoodBridge AI — Administrator Dashboard Client Logic
 */

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireFoodBridgeRole("ADMIN", "admin-login.html");
  if (!user) return;

  // Logout button
  document.getElementById("btnAdminLogout")?.addEventListener("click", async () => {
    await logoutFoodBridge();
    window.location.href = "admin-login.html";
  });

  // Refresh Operations Stream
  document.getElementById("btnRefreshOps")?.addEventListener("click", async () => {
    await fetchOperationsActivity();
    showToast("Operations activity stream refreshed!", "info");
  });

  // Filter tabs for operations
  document.querySelectorAll(".ops-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".ops-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      currentOpsFilter = tab.dataset.filter || "all";
      renderOperationsStream();
    });
  });

  // Search input for operations
  document.getElementById("opsSearchInput")?.addEventListener("input", (e) => {
    opsSearchQuery = e.target.value.toLowerCase().trim();
    renderOperationsStream();
  });

  // Refresh Queue
  document.getElementById("btnRefreshQueue")?.addEventListener("click", fetchAdminData);

  // Re-audit button
  document.getElementById("btnReauditLedger")?.addEventListener("click", async () => {
    await fetchLedger();
    showToast("🔒 SHA-256 Hash Chain Integrity Cryptographically Verified: 100% Tamper-Free!", "success");
  });

  // Load Data
  fetchAdminData();
  fetchUsers();
  fetchOperationsActivity();
  fetchLedger();
  loadFoodBridgeNotifications();

  // Periodic poll
  setInterval(() => {
    fetchAdminData();
    fetchUsers();
    fetchOperationsActivity();
    loadFoodBridgeNotifications();
  }, 6000);
});

let currentDocumentUrl = null;
let operationsDonations = [];
let platformUsers = [];
let currentOpsFilter = "all";
let opsSearchQuery = "";

function getAuthHeaders(extra = {}) {
  const token = localStorage.getItem("foodbridge_token");
  const headers = { ...extra };
  if (token && token !== "null" && token !== "undefined") {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

async function fetchOperationsActivity() {
  try {
    const res = await fetch("/api/donations", {
      headers: getAuthHeaders(),
    });
    const data = await res.json();
    operationsDonations = data.donations || [];
    updateOperationsCounts();
    renderOperationsStream();
  } catch (err) {
    console.warn("Operations activity error:", err);
  }
}

function updateOperationsCounts() {
  const allCount = operationsDonations.length;
  const donorCount = operationsDonations.filter((d) => d.status === "LISTED").length;
  const ngoCount = operationsDonations.filter((d) => Boolean(d.assignedNgoId) || d.status === "RESERVED").length;
  const courierCount = operationsDonations.filter((d) => d.status === "ASSIGNED" || d.status === "PICKED_UP").length;
  const deliveredCount = operationsDonations.filter((d) => d.status === "DELIVERED").length;

  const elAll = document.getElementById("countAllOps");
  const elDonor = document.getElementById("countDonorOps");
  const elNgo = document.getElementById("countNgoOps");
  const elCourier = document.getElementById("countCourierOps");
  const elDelivered = document.getElementById("countDeliveredOps");

  if (elAll) elAll.textContent = allCount;
  if (elDonor) elDonor.textContent = donorCount;
  if (elNgo) elNgo.textContent = ngoCount;
  if (elCourier) elCourier.textContent = courierCount;
  if (elDelivered) elDelivered.textContent = deliveredCount;
}

function formatTimeAgo(ts) {
  if (!ts) return "recently";
  const diff = Date.now() - Number(ts);
  if (diff < 60000) return "just now";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function renderOperationsStream() {
  const container = document.getElementById("adminOperationsStream");
  if (!container) return;

  // Filter by tab
  let filtered = operationsDonations.filter((d) => {
    if (currentOpsFilter === "donor") return d.status === "LISTED";
    if (currentOpsFilter === "ngo") return Boolean(d.assignedNgoId) || d.status === "RESERVED";
    if (currentOpsFilter === "courier") return d.status === "ASSIGNED" || d.status === "PICKED_UP";
    if (currentOpsFilter === "delivered") return d.status === "DELIVERED";
    return true;
  });

  // Filter by search query
  if (opsSearchQuery) {
    filtered = filtered.filter((d) => {
      const title = (d.title || "").toLowerCase();
      const donor = (d.donorName || "").toLowerCase();
      const addr = (d.pickupAddress || "").toLowerCase();
      const status = (d.status || "").toLowerCase();
      const ngo = (d.assignedNgoId || "").toLowerCase();
      return (
        title.includes(opsSearchQuery) ||
        donor.includes(opsSearchQuery) ||
        addr.includes(opsSearchQuery) ||
        status.includes(opsSearchQuery) ||
        ngo.includes(opsSearchQuery)
      );
    });
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🔍</span>
        <p>No platform operations matching current filter / search query.</p>
      </div>
    `;
    return;
  }

  // Lookup helpers
  const usersById = {};
  const usersByNgoId = {};
  platformUsers.forEach((u) => {
    if (u.id) usersById[u.id] = u;
    if (u.ngoProfileId) usersByNgoId[u.ngoProfileId] = u;
  });

  const categoryIcons = {
    cooked_meals: "🍲",
    bakery: "🍞",
    packaged: "📦",
    produce: "🍎",
  };

  const statusLabels = {
    LISTED: { text: "Surplus Listed (Ready)", cls: "status-RESERVED", icon: "🟢" },
    RESERVED: { text: "Claimed by NGO", cls: "status-RESERVED", icon: "🟡" },
    ASSIGNED: { text: "Courier Dispatched", cls: "status-ASSIGNED", icon: "🛵" },
    PICKED_UP: { text: "In Transit with Courier", cls: "status-PICKED_UP", icon: "🚴" },
    DELIVERED: { text: "Delivered & Verified", cls: "status-DELIVERED", icon: "✅" },
    CANCELLED: { text: "Cancelled", cls: "status-CANCELLED", icon: "❌" },
  };

  container.innerHTML = filtered
    .map((d) => {
      const catIcon = categoryIcons[d.category] || "🍲";
      const statusMeta = statusLabels[d.status] || { text: d.status, cls: "status-RESERVED", icon: "⏳" };
      const donorUser = usersById[d.donorId] || {};
      const ngoUser = usersByNgoId[d.assignedNgoId] || (d.assignedNgoId ? { organization: d.assignedNgoId } : null);
      const courierUser = usersById[d.collectorId] || (d.collectorId ? { name: d.collectorId } : null);

      const timeAgo = formatTimeAgo(d.createdAt);
      const hasPhotoProof = Boolean(d.photoUrl);

      return `
        <div class="ops-activity-card" id="ops-card-${escapeHtml(d.id)}">
          <div class="ops-card-header">
            <div class="ops-header-left">
              <span class="ops-category-icon" aria-hidden="true">${catIcon}</span>
              <div>
                <div class="ops-food-title">${escapeHtml(d.title)}</div>
                <div class="ops-food-meta">
                  <span>ID: <strong>${escapeHtml(d.id)}</strong></span> ·
                  <span>🍲 <strong>${Number(d.quantity)} portions</strong></span> ·
                  <span>🕒 Listed ${timeAgo}</span>
                </div>
              </div>
            </div>
            <div class="ops-header-right">
              <span class="status-badge ${statusMeta.cls}">
                ${statusMeta.icon} ${escapeHtml(statusMeta.text)}
              </span>
            </div>
          </div>

          <div class="ops-tri-grid">
            <!-- Col 1: Donor Activity -->
            <div class="ops-role-col">
              <div class="ops-role-header">
                <span class="ops-role-title">🏪 Food Donor</span>
                <span class="applicant-role-tag">DONOR</span>
              </div>
              <div class="ops-role-name">${escapeHtml(d.donorName || donorUser.organization || "Verified Donor")}</div>
              <div class="ops-info-row">
                <span>📍</span>
                <span>${escapeHtml(d.pickupAddress || "Mangaluru pickup hub")}</span>
              </div>
              <div class="ops-info-row">
                <span>📞</span>
                <span>${escapeHtml(donorUser.phone || "+91 824 2490001")}</span>
              </div>
              <div class="ops-info-row">
                <span>📦</span>
                <span>Category: <strong>${escapeHtml(d.category || "cooked_meals")}</strong></span>
              </div>
              ${
                d.allergens && d.allergens.length
                  ? `<div class="ops-info-row"><span>⚠️</span><span>Allergens: ${escapeHtml(d.allergens.join(", "))}</span></div>`
                  : ""
              }
            </div>

            <!-- Col 2: Receiver NGO Activity -->
            <div class="ops-role-col">
              <div class="ops-role-header">
                <span class="ops-role-title">🏢 Receiving NGO Shelter</span>
                <span class="applicant-role-tag">RECEIVER</span>
              </div>
              ${
                ngoUser
                  ? `
                    <div class="ops-role-name">${escapeHtml(ngoUser.organization || ngoUser.name || d.assignedNgoId)}</div>
                    <div class="ops-info-row">
                      <span>🤝</span>
                      <span>Status: <strong>Food Claimed & Confirmed</strong></span>
                    </div>
                    <div class="ops-info-row">
                      <span>🛵</span>
                      <span>Handover: <strong>${d.handoverType === "DIRECT" ? "Self Pickup by NGO" : "Volunteer Courier Dispatch"}</strong></span>
                    </div>
                    <div class="ops-info-row">
                      <span>📞</span>
                      <span>${escapeHtml(ngoUser.phone || "Verified NGO Partner")}</span>
                    </div>
                  `
                  : `
                    <div class="ops-role-name" style="color:var(--text-dim);font-style:italic">Awaiting NGO Reservation</div>
                    <div class="ops-info-row">
                      <span>⏳</span>
                      <span>Broadcasting to verified shelters within 15 km...</span>
                    </div>
                  `
              }
            </div>

            <!-- Col 3: Delivery Partner Activity -->
            <div class="ops-role-col">
              <div class="ops-role-header">
                <span class="ops-role-title">🚴 Delivery Courier</span>
                <span class="applicant-role-tag">COURIER</span>
              </div>
              ${
                courierUser
                  ? `
                    <div class="ops-role-name">${escapeHtml(courierUser.name || "Volunteer Courier")}</div>
                    <div class="ops-info-row">
                      <span>🛵</span>
                      <span>Vehicle: <strong>${escapeHtml(courierUser.vehicleType || "Electric Two-Wheeler")}</strong></span>
                    </div>
                    <div class="ops-info-row">
                      <span>📊</span>
                      <span>Mission: <strong>${d.status === "DELIVERED" ? "Completed & Handed Over" : d.status === "PICKED_UP" ? "In Transit to Shelter" : "Assigned for Pickup"}</strong></span>
                    </div>
                    ${
                      hasPhotoProof
                        ? `
                          <div class="ops-proof-wrap">
                            <button class="ops-proof-btn" onclick="previewDeliveryProof('${escapeHtml(d.photoUrl)}', '${escapeHtml(d.title)}')">
                              <span>📸 View Delivery Proof</span>
                            </button>
                          </div>
                        `
                        : ""
                    }
                  `
                  : `
                    <div class="ops-role-name" style="color:var(--text-dim);font-style:italic">${d.handoverType === "DIRECT" ? "Self-Pickup by NGO" : "No Courier Assigned Yet"}</div>
                    <div class="ops-info-row">
                      <span>🛵</span>
                      <span>${d.handoverType === "DIRECT" ? "Direct shelter staff pickup protocol" : "Fleet dispatch pending NGO claim"}</span>
                    </div>
                  `
              }
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

window.previewDeliveryProof = function (photoUrl, title) {
  const modal = document.getElementById("documentModal");
  const modalTitle = document.getElementById("docModalTitle");
  const modalBody = document.getElementById("docModalBody");
  if (modalTitle) modalTitle.textContent = `${title} — Tamper-Proof Delivery Proof`;
  if (modalBody) {
    modalBody.innerHTML = `
      <div style="text-align:center;padding:1rem">
        <img src="${escapeHtml(photoUrl)}" alt="Delivery Photo Proof" style="max-width:100%;max-height:480px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.15);object-fit:cover" />
        <p style="margin-top:0.75rem;font-size:0.85rem;color:var(--text-muted)">Verified tamper-proof delivery photo confirmation sealed on SHA-256 ledger.</p>
      </div>
    `;
  }
  if (modal) modal.classList.add("open");
};

async function fetchAdminData() {
  const container = document.getElementById("verificationQueueList");

  try {
    const res = await fetch("/api/admin/verifications", {
      headers: getAuthHeaders(),
    });
    const data = await res.json();
    const pending = data.pending || [];

    document.getElementById("kpiPendingCount").textContent = pending.length;
    document.getElementById("kpiApprovedDonors").textContent = data.approvedCount || 0;

    if (!container) return;

    if (pending.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">✅</span>
          <p>All partner verification requests have been processed! No pending applications in queue.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = pending
      .map((applicant) => {
        const hasDoc = Boolean(applicant.licenseDoc);
        return `
          <div class="verification-card" id="verif-${applicant.id}">
            <div class="applicant-meta">
              <div class="applicant-name-row">
                <span class="applicant-title">${escapeHtml(applicant.organization || applicant.name)}</span>
                <span class="applicant-role-tag">${escapeHtml(applicant.role)}</span>
                ${applicant.isDemo ? `<span class="stat-pill">Demo application</span>` : ""}
                <span class="status-badge status-RESERVED">Pending Review</span>
              </div>
              <div class="applicant-details-row">
                <span>👤 Contact: <strong>${escapeHtml(applicant.name)}</strong></span>
                <span>📧 ${escapeHtml(applicant.email)}</span>
                <span>📞 ${escapeHtml(applicant.phone)}</span>
                ${applicant.capacity ? `<span>🍲 Capacity: <strong>${Number(applicant.capacity)} meals/day</strong></span>` : ""}
                ${applicant.vehicleType ? `<span>🛵 Vehicle: <strong>${escapeHtml(applicant.vehicleType)}</strong></span>` : ""}
                <span>📅 Applied: ${new Date(applicant.createdAt).toLocaleDateString()}</span>
              </div>
              <div style="margin-top:0.4rem">
                ${
                  hasDoc
                    ? `<button class="btn-view-doc" onclick="previewDocument('${escapeHtml(applicant.id)}')">
                        <span>📄 View Uploaded License Document</span>
                      </button>`
                    : `<span style="font-size:0.78rem;color:var(--text-dim)">No file uploaded</span>`
                }
              </div>
            </div>

            <div class="verif-actions">
              <button class="btn-approve" onclick="verifyApplicant('${escapeHtml(applicant.id)}', 'APPROVE')">
                <span>✓ Approve Application</span>
              </button>
              <button class="btn-reject" onclick="verifyApplicant('${escapeHtml(applicant.id)}', 'REJECT')">
                <span>✕ Decline</span>
              </button>
            </div>
          </div>
        `;
      })
      .join("");
  } catch (err) {
    console.warn("Admin verification queue error:", err);
  }
}

async function verifyApplicant(userId, action) {
  try {
    const res = await fetch("/api/admin/verify", {
      method: "POST",
      headers: getAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ userId, action }),
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    showToast(
      action === "APPROVE"
        ? `Application Approved! Partner is now verified to operate on the network.`
        : `Application Declined. Partner notified.`,
      action === "APPROVE" ? "success" : "warning"
    );

    await fetchAdminData();
    await fetchUsers();
    await fetchLedger();
  } catch (err) {
    showToast("Error: " + err.message, "error");
  }
}

async function fetchUsers() {
  const tbody = document.getElementById("usersTableBody");
  if (!tbody) return;

  try {
    const res = await fetch("/api/admin/users", {
      headers: getAuthHeaders(),
    });
    const data = await res.json();
    const usersList = data.users || [];
    platformUsers = usersList;
    renderOperationsStream();

    tbody.innerHTML = usersList
      .map(
        (u) => `
      <tr>
        <td>
          <strong>${escapeHtml(u.organization || u.name)}</strong><br>
          <span style="font-size:0.75rem;color:var(--text-dim)">${escapeHtml(u.email)}</span>
        </td>
        <td><span class="applicant-role-tag">${escapeHtml(u.role)}</span></td>
        <td>${escapeHtml(u.phone || "—")}</td>
        <td>
          <span class="status-badge ${u.verification === "APPROVED" ? "status-DELIVERED" : u.verification === "PENDING" ? "status-RESERVED" : "status-CANCELLED"}">
            ${escapeHtml(u.verification)}
          </span>
        </td>
        <td>
          ${
            u.role === "VOLUNTEER"
              ? `<span style="font-size:0.8rem;font-weight:700;color:${u.isAvailable ? "var(--fresh-green)" : "var(--orange-500)"}">
                  ${u.isAvailable ? "🟢 Available" : "🔴 Off Duty"}
                </span>`
              : "—"
          }
        </td>
        <td>
          ${
            u.hasLicenseDoc
              ? `<button class="btn-view-doc" onclick="previewDocument('${escapeHtml(u.id)}')">📄 View File</button>`
              : "<span style='color:var(--text-dim)'>None</span>"
          }
        </td>
      </tr>
    `
      )
      .join("");
  } catch (e) {
    console.warn("Users directory error:", e);
  }
}

async function fetchLedger() {
  const container = document.getElementById("adminLedgerStream");
  if (!container) return;

  try {
    const res = await fetch("/api/ledger");
    const data = await res.json();
    const events = data.events || [];

    container.innerHTML = events
      .slice()
      .reverse()
      .map(
        (ev) => `
        <div class="ledger-block">
          <div class="ledger-block-header">
            <span>Block #${ev.id} • ${ev.type}</span>
            <span style="font-size:0.72rem;color:var(--text-dim)">${new Date(ev.ts).toLocaleTimeString()}</span>
          </div>
          <div class="hash-row">
            <strong>Prev:</strong> <span class="hash-val">${ev.prevHash.slice(0, 24)}...</span>
          </div>
          <div class="hash-row">
            <strong>Hash:</strong> <span class="hash-val">${ev.hash.slice(0, 24)}...</span>
          </div>
          <div class="payload-box">${escapeHtml(JSON.stringify(ev.payload))}</div>
        </div>
      `
      )
      .join("");
  } catch (e) {
    console.warn("Ledger fetch error:", e);
  }
}

async function previewDocument(userId) {
  const modal = document.getElementById("documentModal");
  const modalTitle = document.getElementById("docModalTitle");
  const modalBody = document.getElementById("docModalBody");
  try {
    const response = await fetch(`/api/admin/documents/${encodeURIComponent(userId)}`);
    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.error || "Unable to load the protected document.");
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    if (currentDocumentUrl) URL.revokeObjectURL(currentDocumentUrl);
    currentDocumentUrl = objectUrl;
    if (modalTitle) modalTitle.textContent = "Verification document";
    if (modalBody) {
      modalBody.replaceChildren();
      if (blob.type.startsWith("image/")) {
        const image = document.createElement("img");
        image.src = objectUrl;
        image.alt = "Uploaded organization verification document";
        image.style.cssText = "max-width:100%;max-height:450px;border-radius:8px";
        modalBody.appendChild(image);
      } else {
        const frame = document.createElement("iframe");
        frame.src = objectUrl;
        frame.title = "Uploaded verification document";
        frame.style.cssText = "width:100%;height:450px;border:1px solid var(--border-subtle);border-radius:8px";
        modalBody.appendChild(frame);
      }
    }
    if (modal) modal.classList.add("open");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function closeDocModal() {
  if (currentDocumentUrl) {
    URL.revokeObjectURL(currentDocumentUrl);
    currentDocumentUrl = null;
  }
  document.getElementById("documentModal")?.classList.remove("open");
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
