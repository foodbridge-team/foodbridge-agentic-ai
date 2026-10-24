/**
 * FoodBridge AI — Universal Interaction Engine
 * Clean, fast, solid, enterprise-grade responsive interactions with zero distracting animations.
 */

(() => {
  // Ensure all interactive elements render immediately without delay
  function initInstantDisplay() {
    const revealElements = document.querySelectorAll(
      ".hero-content, .role-gateway-card, .workflow-section, .workflow-card, .glass-card, .stat-card, .login-wrapper, .donation-card, .verification-card"
    );
    revealElements.forEach((el) => {
      el.style.opacity = "1";
      el.style.transform = "none";
      el.style.transition = "none";
      el.classList.add("revealed");
    });
  }

  // Tactile button feedback (subtle active state)
  function initButtonFeedback() {
    document.addEventListener("pointerdown", (e) => {
      const btn = e.target.closest(".btn, .control-btn, .btn-claim, .btn-approve, .btn-reject, .btn-submit, .btn-demo-login");
      if (!btn) return;
      btn.style.opacity = "0.9";
    });

    document.addEventListener("pointerup", (e) => {
      const btn = e.target.closest(".btn, .control-btn, .btn-claim, .btn-approve, .btn-reject, .btn-submit, .btn-demo-login");
      if (!btn) return;
      btn.style.opacity = "";
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      initInstantDisplay();
      initButtonFeedback();
    });
  } else {
    initInstantDisplay();
    initButtonFeedback();
  }
})();
