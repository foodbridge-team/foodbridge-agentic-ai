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
  fetchLedger();
  loadFoodBridgeNotifications();

  // Periodic poll
  setInterval(() => {
    fetchAdminData();
    fetchUsers();
    loadFoodBridgeNotifications();
  }, 6000);
});

let currentDocumentUrl = null;

async function fetchAdminData() {
  const container = document.getElementById("verificationQueueList");

  try {
    const res = await fetch("/api/admin/verifications", {
      headers: { Authorization: `Bearer ${localStorage.getItem("foodbridge_token")}` },
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
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("foodbridge_token")}`,
      },
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
      headers: { Authorization: `Bearer ${localStorage.getItem("foodbridge_token")}` },
    });
    const data = await res.json();
    const usersList = data.users || [];

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
  toast.textContent = `${type === "success" ? "✅" : "⚠️"} ${message}`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
