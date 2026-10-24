/**
 * FoodBridge AI — Universal Crisp & Compact Footer Component
 * Minimalist, attractive, responsive, and translated across all pages.
 */

(() => {
  function renderFooter() {
    // Remove any existing footer
    document.querySelectorAll("footer.app-footer").forEach((el) => el.remove());

    const footer = document.createElement("footer");
    footer.className = "app-footer portal-footer crisp-footer";
    footer.setAttribute("aria-label", "Site footer");
    footer.innerHTML = `
      <div class="footer-crisp-inner">
        <div class="footer-crisp-left">
          <a href="index.html" class="footer-crisp-brand" aria-label="FoodBridge AI Home">
            <span class="footer-crisp-logo" aria-hidden="true">🌱</span>
            <span class="footer-crisp-title">FoodBridge <span class="gradient-text">AI</span></span>
          </a>
          <span class="footer-crisp-separator" aria-hidden="true">·</span>
          <span class="footer-crisp-tagline">Good Food Deserves a Second Chance.</span>
        </div>

        <nav class="footer-crisp-nav" aria-label="Quick links">
          <a href="index.html" class="footer-crisp-link">Home</a>
          <a href="donor-login.html" class="footer-crisp-link">Donor</a>
          <a href="ngo-login.html" class="footer-crisp-link">NGO Shelter</a>
          <a href="delivery-login.html" class="footer-crisp-link">Volunteers</a>
          <a href="admin-login.html" class="footer-crisp-link">Admin</a>
        </nav>

        <div class="footer-crisp-right">
          <span class="footer-status-pill">
            <span class="footer-status-dot" aria-hidden="true"></span>
            <span>Network Live</span>
          </span>
          <span class="footer-crisp-separator" aria-hidden="true">·</span>
          <span class="footer-crisp-copy">© 2026 FoodBridge AI · Mangaluru</span>
        </div>
      </div>
    `;

    const container = document.querySelector(".portal-wrapper, .app-shell");
    if (container) {
      container.append(footer);
    } else {
      document.body.classList.add("has-auth-footer");
      document.body.append(footer);
    }

    if (window.foodBridgeLanguage && window.setFoodBridgeLanguage) {
      if (window.foodBridgeLanguage() === "kn") {
        window.setFoodBridgeLanguage("kn");
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderFooter);
  } else {
    renderFooter();
  }
})();
