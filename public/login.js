/**
 * FoodBridge AI — Role Authentication & Registration Client Logic
 * Handles role-specific sign-in, registration with document uploads, and 1-click demo logins.
 */

document.addEventListener("DOMContentLoaded", () => {
  const roleInput = document.getElementById("roleIdentifier");
  const currentRole = roleInput ? roleInput.value.toUpperCase() : "DONOR";

  const tabSignIn = document.getElementById("tabSignIn");
  const tabRegister = document.getElementById("tabRegister");
  const signInSection = document.getElementById("signInSection");
  const registerSection = document.getElementById("registerSection");

  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");
  const btnDemoLogin = document.getElementById("btnDemoLogin");
  const errorBox = document.getElementById("loginErrorBox");
  const successBox = document.getElementById("loginSuccessBox");

  fetch("/api/stats")
    .then((response) => {
      if (!response.ok) throw new Error("Unable to load login configuration.");
      return response.json();
    })
    .then((stats) => {
      if (stats.demoMode) return;
      document.querySelector(".demo-banner")?.remove();
      const emailField = document.getElementById("emailInput");
      if (emailField) emailField.value = "";
      const passwordField = document.getElementById("passwordInput");
      if (passwordField) passwordField.value = "";
    })
    .catch((error) => showError(error.message));

  const isSignupPage = window.location.pathname.includes("-signup");
  const roleLabels = {
    DONOR: "Donor",
    NGO: "NGO / Shelter",
    VOLUNTEER: "Delivery Partner",
  };
  document.title = `${isSignupPage ? "Create Account" : "Sign In"} — ${roleLabels[currentRole] || "FoodBridge"} — FoodBridge AI`;
  if (window.foodBridgeTranslate) document.title = window.foodBridgeTranslate(document.title);
  if (tabSignIn && tabRegister) {
    tabSignIn.classList.toggle("active", !isSignupPage);
    tabRegister.classList.toggle("active", isSignupPage);
    tabSignIn.setAttribute("aria-current", isSignupPage ? "false" : "page");
    tabRegister.setAttribute("aria-current", isSignupPage ? "page" : "false");
  }
  if (signInSection) signInSection.style.display = isSignupPage ? "none" : "flex";
  if (registerSection) registerSection.style.display = isSignupPage ? "flex" : "none";

  function clearMessages() {
    if (errorBox) { errorBox.style.display = "none"; errorBox.textContent = ""; }
    if (successBox) { successBox.style.display = "none"; successBox.textContent = ""; }
  }

  // 1-Click Demo Login
  if (btnDemoLogin) {
    btnDemoLogin.addEventListener("click", () => {
      let email = "donor@oceanpearl.com";
      let pwd = "password123";

      if (currentRole === "NGO") {
        email = "ngo@sevatrust.org";
        pwd = "password123";
      } else if (currentRole === "VOLUNTEER") {
        email = "rider@foodbridge.org";
        pwd = "password123";
      } else if (currentRole === "ADMIN") {
        email = "admin@foodbridge.org";
        pwd = "adminSecure2026!";
      }

      const emailField = document.getElementById("emailInput");
      const pwdField = document.getElementById("passwordInput");
      if (emailField) emailField.value = email;
      if (pwdField) pwdField.value = pwd;

      performLogin(email, pwd, currentRole);
    });
  }

  // Sign In Form Submit
  if (loginForm) {
    loginForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const email = document.getElementById("emailInput").value.trim();
      const password = document.getElementById("passwordInput").value;
      performLogin(email, password, currentRole);
    });
  }

  // Register Form Submit
  if (registerForm) {
    registerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearMessages();

      const name = document.getElementById("regName").value.trim();
      const organization = document.getElementById("regOrg") ? document.getElementById("regOrg").value.trim() : name;
      const email = document.getElementById("regEmail").value.trim();
      const phone = document.getElementById("regPhone").value.trim();
      const password = document.getElementById("regPassword").value;
      const capacity = document.getElementById("regCapacity") ? parseInt(document.getElementById("regCapacity").value, 10) : undefined;
      const vehicleType = document.getElementById("regVehicle") ? document.getElementById("regVehicle").value : undefined;
      const latInput = document.getElementById("regLat");
      const lngInput = document.getElementById("regLng");
      const lat = latInput ? Number(latInput.value) : undefined;
      const lng = lngInput ? Number(lngInput.value) : undefined;

      // Document file upload for NGOs
      let licenseDoc = "";
      const docInput = document.getElementById("regLicenseDoc");
      if (docInput && docInput.files && docInput.files[0]) {
        const file = docInput.files[0];
        if (file.size > 5 * 1024 * 1024 || !["application/pdf", "image/jpeg", "image/png"].includes(file.type)) {
          showError("Please upload a PDF, JPG, or PNG document no larger than 5 MB.");
          return;
        }
        try {
          licenseDoc = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error("Unable to read the selected document."));
            reader.readAsDataURL(file);
          });
        } catch (error) {
          showError(error.message);
          return;
        }
      } else if (currentRole === "NGO") {
        showError("Please upload an official registration / license document (PDF/JPG/PNG).");
        return;
      }

      const submitBtn = document.getElementById("btnSubmitRegister");
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Submitting for Admin Verification..."; }

      try {
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            organization,
            email,
            phone,
            password,
            role: currentRole,
            licenseDoc,
            capacity,
            vehicleType,
            lat,
            lng,
          }),
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Registration failed");
        }
        if (data.user.role !== currentRole) {
          throw new Error("The registration response did not match the selected role portal.");
        }

        // Store session
        localStorage.removeItem("foodbridge_token");
        localStorage.setItem("foodbridge_user", JSON.stringify(data.user));

        showSuccess("Registration submitted successfully! Your account is pending Administrator verification before you can publish or claim donations.");

        // Redirect after brief pause
        setTimeout(() => {
          window.location.href = portalForRole(currentRole);
        }, 1800);
      } catch (err) {
        showError(err.message);
      } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Submit Application for Verification"; }
      }
    });
  }

  // Perform Sign In
  async function performLogin(email, password, role) {
    clearMessages();

    const submitBtn = document.getElementById("btnSubmitLogin");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Authenticating...";
    }

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, role }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Login failed");
      }

      if (data.user.role !== role) {
        throw new Error("This account does not belong to the selected role portal.");
      }
      localStorage.removeItem("foodbridge_token");
      localStorage.setItem("foodbridge_user", JSON.stringify(data.user));
      window.location.href = portalForRole(role);
    } catch (err) {
      showError(err.message);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Sign In ➔";
      }

    }
  }

  function portalForRole(role) {
    if (role === "NGO") return "/ngo";
    if (role === "VOLUNTEER") return "/delivery";
    if (role === "DONOR") return "/donor";
    return "/admin";
  }

  function showError(msg) {
    if (errorBox) {
      errorBox.textContent = msg;
      errorBox.style.display = "block";
    }
  }

  function showSuccess(msg) {
    if (successBox) {
      successBox.textContent = msg;
      successBox.style.display = "block";
    }
  }
});
