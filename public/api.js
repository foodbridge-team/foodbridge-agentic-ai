(() => {
  window.escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);

  window.requireFoodBridgeRole = async (expectedRole, loginPath) => {
    let cachedUser;
    try {
      cachedUser = JSON.parse(localStorage.getItem("foodbridge_user") || "null");
    } catch {
      cachedUser = null;
    }
    if (!cachedUser || cachedUser.role !== expectedRole) {
      window.location.replace(loginPath);
      return null;
    }
    try {
      const response = await fetch("/api/auth/me");
      if (!response.ok) throw new Error("Your session has expired. Please sign in again.");
      const data = await response.json();
      if (!data.user || data.user.role !== expectedRole) throw new Error("This portal is not available to your account.");
      localStorage.setItem("foodbridge_user", JSON.stringify(data.user));
      return data.user;
    } catch (error) {
      localStorage.removeItem("foodbridge_user");
      window.location.replace(loginPath);
      return null;
    }
  };

  window.logoutFoodBridge = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      localStorage.removeItem("foodbridge_user");
      localStorage.removeItem("foodbridge_token");
    }
  };

  window.loadFoodBridgeNotifications = async () => {
    const container = document.getElementById("accountNotifications");
    if (!container) return;
    try {
      const response = await fetch("/api/notifications");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load notifications.");
      const notifications = data.notifications || [];
      container.innerHTML = notifications.length
        ? `<h2>Updates</h2>${notifications.slice(0, 4).map((item) => `
            <article class="notification-item notification-${escapeHtml(item.type)}">
              <strong>${escapeHtml(item.title)}</strong>
              <p>${escapeHtml(item.message)}</p>
              <time>${escapeHtml(new Date(item.timestamp).toLocaleString())}</time>
            </article>
          `).join("")}`
        : `<h2>Updates</h2><p>No new activity notifications.</p>`;
    } catch (error) {
      container.textContent = error.message;
    }
  };
})();
