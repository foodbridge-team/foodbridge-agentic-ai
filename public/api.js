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
    try {
      const response = await fetch("/api/notifications");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load notifications.");
      const notifications = data.notifications || [];
      const user = JSON.parse(localStorage.getItem("foodbridge_user") || "null");
      if (!user?.id || !notifications.length) return;

      const storageKey = `foodbridge_seen_notifications_${user.id}`;
      let seenIds = [];
      try {
        seenIds = JSON.parse(localStorage.getItem(storageKey) || "[]");
      } catch {
        seenIds = [];
      }
      if (!Array.isArray(seenIds)) seenIds = [];
      const seen = new Set(seenIds);
      const unseen = notifications.filter((item) => !seen.has(item.id));
      const recentUnseen = unseen.filter((item) => Date.now() - Date.parse(item.timestamp) < 15 * 60 * 1000);
      recentUnseen.slice(0, 3).forEach((item) => {
        window.showToast(`${item.title}: ${item.message}`, item.type);
      });
      localStorage.setItem(
        storageKey,
        JSON.stringify([...new Set([...seenIds, ...notifications.map((item) => item.id)])].slice(-100))
      );
    } catch (error) {
      console.error("Notification fetch failed:", error);
    }
  };
})();
