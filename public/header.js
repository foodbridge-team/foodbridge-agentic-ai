/**
 * FoodBridge AI — Universal Header & Theme Component
 * Ensures identical, neat, responsive header with Light/Dark mode and Language toggle across all pages.
 */

(() => {
  // 1. Immediately apply theme to avoid FOUC (flash of unstyled content)
  const savedTheme = localStorage.getItem("foodbridge_theme") || "dark";
  document.documentElement.setAttribute("data-theme", savedTheme);

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("foodbridge_theme", theme);

    document.querySelectorAll(".theme-toggle-btn").forEach((btn) => {
      const isDark = theme === "dark";
      const icon = btn.querySelector(".theme-icon-indicator");
      const label = btn.querySelector(".theme-label-text");
      if (icon) icon.textContent = isDark ? "☀️" : "🌙";
      if (label) {
        const text = isDark ? "Light Mode" : "Dark Mode";
        label.textContent = window.foodBridgeTranslate ? window.foodBridgeTranslate(text) : text;
      }
      btn.setAttribute("title", isDark ? "Switch to Light Mode" : "Switch to Dark Mode");
      btn.setAttribute("aria-label", isDark ? "Switch to Light Mode" : "Switch to Dark Mode");
    });
  }

  function setupHeader() {
    // Current route detection
    const path = window.location.pathname.toLowerCase();
    const isHome = path === "/" || path.endsWith("/index.html") || path === "";
    const isDonor = path.includes("donor");
    const isNgo = path.includes("ngo");
    const isDelivery = path.includes("delivery") || path.includes("volunteer");
    const isAdmin = path.includes("admin");

    const currentTheme = document.documentElement.getAttribute("data-theme") || "dark";
    const currentLang = localStorage.getItem("foodbridge_language") || "en";

    // Standard nav links HTML
    const navLinksHtml = `
      <nav class="nav-links" id="globalNavLinks" aria-label="Main Navigation">
        <a href="index.html" class="nav-link ${isHome ? 'active' : ''}">
          <span class="nav-link-icon">🏠</span>
          <span class="nav-link-text">Home</span>
        </a>
        <a href="donor-login.html" class="nav-link ${isDonor ? 'active' : ''}">
          <span class="nav-link-icon">🏪</span>
          <span class="nav-link-text">Food Donor</span>
        </a>
        <a href="ngo-login.html" class="nav-link ${isNgo ? 'active' : ''}">
          <span class="nav-link-icon">🏢</span>
          <span class="nav-link-text">NGO Shelter</span>
        </a>
        <a href="delivery-login.html" class="nav-link ${isDelivery ? 'active' : ''}">
          <span class="nav-link-icon">🚴</span>
          <span class="nav-link-text">Volunteers</span>
        </a>
        <a href="admin-login.html" class="nav-link ${isAdmin ? 'active' : ''}">
          <span class="nav-link-icon">🛡️</span>
          <span class="nav-link-text">Admin</span>
        </a>
      </nav>
    `;

    // Standard control buttons (Theme + Language)
    const isDark = currentTheme === "dark";
    const controlsHtml = `
      <div class="nav-controls" id="globalNavControls">
        <button type="button" class="control-btn theme-toggle-btn" id="btnThemeToggle" aria-label="${isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}" title="${isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}">
          <span class="theme-icon-indicator" aria-hidden="true">${isDark ? '☀️' : '🌙'}</span>
          <span class="theme-label-text">${isDark ? 'Light Mode' : 'Dark Mode'}</span>
        </button>

        <button type="button" class="control-btn portal-language-toggle" data-language-toggle aria-label="${currentLang === 'en' ? 'Switch language to Kannada' : 'Switch language to English'}" title="${currentLang === 'en' ? 'Switch language to Kannada' : 'Switch language to English'}">
          <span class="btn-icon" aria-hidden="true">🌐</span>
          <span data-language-label>${currentLang === 'en' ? 'ಕನ್ನಡ' : 'English'}</span>
        </button>
      </div>
    `;

    // Check if the page already has a header element
    const existingHeader = document.querySelector("header.app-nav, header.portal-header");

    if (existingHeader) {
      existingHeader.classList.add("site-universal-header");

      // Check if nav-links already present
      if (!existingHeader.querySelector("#globalNavLinks")) {
        // Insert nav links after brand
        const leftWrap = existingHeader.querySelector(".nav-left, .header-left");
        if (leftWrap) {
          leftWrap.insertAdjacentHTML("afterend", navLinksHtml);
        } else {
          existingHeader.insertAdjacentHTML("afterbegin", navLinksHtml);
        }
      }

      // Check right controls: Ensure theme toggle is present
      const rightWrap = existingHeader.querySelector(".nav-controls, .header-right");
      if (rightWrap) {
        if (!rightWrap.querySelector(".theme-toggle-btn")) {
          const themeBtnHtml = `
            <button type="button" class="control-btn theme-toggle-btn" id="btnThemeToggle" aria-label="${isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}" title="${isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}">
              <span class="theme-icon-indicator" aria-hidden="true">${isDark ? '☀️' : '🌙'}</span>
              <span class="theme-label-text">${isDark ? 'Light Mode' : 'Dark Mode'}</span>
            </button>
          `;
          rightWrap.insertAdjacentHTML("afterbegin", themeBtnHtml);
        }
      }
    } else {
      // For auth/login pages that don't have a top header yet
      const brandSubText = isDonor ? "Food Donor Portal" : isNgo ? "NGO Shelter Hub" : isDelivery ? "Delivery Dispatch Fleet" : isAdmin ? "Platform Administration" : "Surplus Redistribution";
      const newHeader = document.createElement("header");
      newHeader.className = "app-nav site-universal-header";
      newHeader.id = "siteUniversalHeader";
      newHeader.innerHTML = `
        <div class="nav-left">
          <a href="index.html" class="brand-badge" style="text-decoration:none">
            <div class="brand-logo-glow">
              <span class="brand-emoji">🌱</span>
            </div>
            <div class="brand-meta">
              <div class="brand-title">FoodBridge <span class="gradient-text">AI</span></div>
              <span class="brand-tagline">${brandSubText}</span>
            </div>
          </a>
        </div>
        ${navLinksHtml}
        ${controlsHtml}
      `;

      // Insert at very top of body or before login container
      const loginContainer = document.querySelector(".login-container, .portal-wrapper, .app-shell");
      if (loginContainer && loginContainer.parentNode) {
        loginContainer.parentNode.insertBefore(newHeader, loginContainer);
      } else {
        document.body.insertAdjacentElement("afterbegin", newHeader);
      }
    }

    // Attach click listener for theme toggle
    document.addEventListener("click", (e) => {
      const themeBtn = e.target.closest(".theme-toggle-btn");
      if (themeBtn) {
        const activeTheme = document.documentElement.getAttribute("data-theme") || "dark";
        const newTheme = activeTheme === "dark" ? "light" : "dark";
        applyTheme(newTheme);
      }
    });

    applyTheme(savedTheme);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupHeader);
  } else {
    setupHeader();
  }
})();
