/**
 * FoodBridge AI — Universal Interaction & Micro-Animations Engine
 * Adds 3D card tilt, cursor spotlight glows, scroll-reveal, button ripples,
 * and smooth micro-interactions across all pages.
 */

(() => {
  // 1. Subtle 3D Card Tilt & Cursor Spotlight (Desktop only with mouse)
  const isFinePointer = window.matchMedia("(pointer: fine)").matches;

  function initCardInteractions() {
    if (!isFinePointer) return;

    const cards = document.querySelectorAll(
      ".role-gateway-card, .workflow-card, .stat-card, .glass-card, .donation-card, .verification-card"
    );

    cards.forEach((card) => {
      // Avoid attaching multiple times
      if (card.dataset.tiltInitialized) return;
      card.dataset.tiltInitialized = "true";

      let rafId = null;

      card.addEventListener("mousemove", (e) => {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          const rect = card.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          const centerX = rect.width / 2;
          const centerY = rect.height / 2;

          const rotateX = ((y - centerY) / centerY) * -3.5;
          const rotateY = ((x - centerX) / centerX) * 3.5;

          card.style.transform = `perspective(1000px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) translateY(-6px) scale(1.015)`;
          card.style.setProperty("--spotlight-x", `${x}px`);
          card.style.setProperty("--spotlight-y", `${y}px`);
        });
      });

      card.addEventListener("mouseleave", () => {
        if (rafId) cancelAnimationFrame(rafId);
        card.style.transform = "";
      });
    });
  }

  // 2. Scroll-Reveal Animations with IntersectionObserver
  function initScrollReveal() {
    if (!("IntersectionObserver" in window)) return;

    const revealElements = document.querySelectorAll(
      ".hero-content, .role-gateway-card, .workflow-section, .workflow-card, .glass-card, .stat-card, .login-wrapper"
    );

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("revealed");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );

    revealElements.forEach((el) => {
      el.classList.add("reveal-on-scroll");
      observer.observe(el);
    });
  }

  // 3. Button Click Micro-Feedback (Tactile press & ripple)
  function initButtonFeedback() {
    document.addEventListener("pointerdown", (e) => {
      const btn = e.target.closest(".btn, .control-btn, .btn-claim, .btn-approve, .btn-reject, .btn-submit, .btn-demo-login");
      if (!btn) return;
      btn.style.transform = "scale(0.96)";
    });

    document.addEventListener("pointerup", (e) => {
      const btn = e.target.closest(".btn, .control-btn, .btn-claim, .btn-approve, .btn-reject, .btn-submit, .btn-demo-login");
      if (!btn) return;
      setTimeout(() => {
        btn.style.transform = "";
      }, 120);
    });
  }

  // Initialize on load and re-run on dynamic content updates
  function initAll() {
    initCardInteractions();
    initScrollReveal();
    initButtonFeedback();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAll);
  } else {
    initAll();
  }

  // Re-attach card tilt for dynamically rendered elements (e.g. newly loaded donation cards)
  const dynamicObserver = new MutationObserver(() => {
    initCardInteractions();
  });

  document.addEventListener("DOMContentLoaded", () => {
    dynamicObserver.observe(document.body, { childList: true, subtree: true });
  });
})();
