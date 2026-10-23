document.addEventListener("DOMContentLoaded", () => {
  const MANGALURU_CENTER = { lat: 12.9141, lng: 74.856 };
  const form = document.getElementById("registerForm");
  const phoneInput = document.getElementById("regPhone");
  const codeInput = document.getElementById("regPhoneOtp");
  const licenseInput = document.getElementById("regLicenseDoc");
  const sendButton = document.getElementById("btnSendOtp");
  const verifyButton = document.getElementById("btnVerifyOtp");
  const submitButton = document.getElementById("btnSubmitRegister");
  const status = document.getElementById("phoneOtpStatus");
  const errorBox = document.getElementById("loginErrorBox");
  const successBox = document.getElementById("loginSuccessBox");
  let requestedPhone = "";
  let verifiedPhone = "";

  function showError(message) {
    if (successBox) {
      successBox.hidden = true;
      successBox.textContent = "";
      successBox.style.display = "none";
    }
    if (errorBox) {
      errorBox.textContent = window.foodBridgeTranslate?.(message) || message;
      errorBox.hidden = false;
      errorBox.style.display = "block";
    }
  }

  function showSuccess(message) {
    if (errorBox) {
      errorBox.hidden = true;
      errorBox.textContent = "";
      errorBox.style.display = "none";
    }
    if (successBox) {
      successBox.textContent = window.foodBridgeTranslate?.(message) || message;
      successBox.hidden = false;
      successBox.style.display = "block";
    }
  }

  function updatePhoneVerificationState() {
    const phone = phoneNumberForVerification();
    if (verifiedPhone && phone !== verifiedPhone) {
      verifiedPhone = "";
      requestedPhone = "";
      codeInput.value = "";
      status.textContent = "";
      sendButton.disabled = false;
      submitButton.disabled = true;
    }
    verifyButton.disabled = !requestedPhone || requestedPhone !== phone || verifiedPhone === phone;
  }

  function phoneNumberForVerification() {
    return `+91${phoneInput.value}`;
  }

  async function requestJson(url, body) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success) {
      throw new Error(result.error || `Request failed (${response.status}).`);
    }
    return result;
  }

  phoneInput.addEventListener("input", () => {
    const digitsOnly = phoneInput.value.replace(/\D/g, "").slice(0, 10);
    if (phoneInput.value !== digitsOnly) phoneInput.value = digitsOnly;
    updatePhoneVerificationState();
  });

  sendButton.addEventListener("click", async () => {
    if (!phoneInput.reportValidity()) return;
    const phone = phoneNumberForVerification();
    requestedPhone = "";
    verifiedPhone = "";
    codeInput.value = "";
    status.textContent = "";
    submitButton.disabled = true;
    sendButton.disabled = true;
    const label = sendButton.textContent;
    sendButton.textContent = window.foodBridgeTranslate?.("Sending OTP...") || "Sending OTP...";
    try {
      await requestJson("/api/ngo-phone-otp/send", { phone });
      if (phoneNumberForVerification() !== phone) {
        showError("Phone number changed while the code was being sent. Request a new code.");
        return;
      }
      requestedPhone = phone;
      status.textContent = window.foodBridgeTranslate?.("A verification code was sent by SMS.") || "A verification code was sent by SMS.";
      status.dataset.state = "success";
      verifyButton.disabled = false;
    } catch (error) {
      showError(error.message);
    } finally {
      sendButton.disabled = false;
      sendButton.textContent = label;
    }
  });

  verifyButton.addEventListener("click", async () => {
    const phone = phoneNumberForVerification();
    if (!phoneInput.reportValidity() || requestedPhone !== phone) {
      showError("Request a new code for this phone number before verifying.");
      return;
    }
    if (!codeInput.reportValidity()) return;
    verifyButton.disabled = true;
    const label = verifyButton.textContent;
    verifyButton.textContent = window.foodBridgeTranslate?.("Verifying...") || "Verifying...";
    try {
      await requestJson("/api/ngo-phone-otp/verify", {
        phone,
        code: codeInput.value.trim(),
      });
      verifiedPhone = phone;
      status.textContent = window.foodBridgeTranslate?.("Phone number verified.") || "Phone number verified.";
      status.dataset.state = "success";
      submitButton.disabled = false;
      sendButton.disabled = true;
    } catch (error) {
      status.textContent = "";
      status.dataset.state = "error";
      showError(error.message);
      verifyButton.disabled = false;
    } finally {
      verifyButton.textContent = label;
    }
  });

  licenseInput.addEventListener("change", () => {
    const file = licenseInput.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      licenseInput.value = "";
      showError("Choose a JPG or PNG license photo no larger than 5 MB.");
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    if (!verifiedPhone || verifiedPhone !== phoneNumberForVerification()) {
      showError("Verify your registered phone number before creating the account.");
      submitButton.disabled = true;
      return;
    }

    const file = licenseInput.files?.[0];
    if (!file) {
      showError("Upload a photo of the hotel or food business license.");
      return;
    }
    if (!["image/jpeg", "image/png"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      showError("Choose a JPG or PNG license photo no larger than 5 MB.");
      return;
    }

    submitButton.disabled = true;
    const label = submitButton.textContent;
    submitButton.textContent = window.foodBridgeTranslate?.("Creating account...") || "Creating account...";
    try {
      const licenseDoc = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Unable to read the selected license photo."));
        reader.readAsDataURL(file);
      });
      const result = await requestJson("/api/auth/register", {
        name: document.getElementById("regName").value.trim(),
        organization: document.getElementById("regOrg").value.trim(),
        email: document.getElementById("regEmail").value.trim(),
        phone: verifiedPhone,
        password: document.getElementById("regPassword").value,
        role: "NGO",
        licenseDoc,
        capacity: Number(document.getElementById("regCapacity").value),
        lat: MANGALURU_CENTER.lat,
        lng: MANGALURU_CENTER.lng,
      });
      localStorage.removeItem("foodbridge_token");
      localStorage.setItem("foodbridge_user", JSON.stringify(result.user));
      showSuccess("Registration submitted successfully! Your account is pending Administrator verification before you can publish or claim donations.");
      window.setTimeout(() => {
        window.location.href = "/ngo";
      }, 1800);
    } catch (error) {
      showError(error.message);
      submitButton.disabled = false;
    } finally {
      submitButton.textContent = label;
    }
  });
});
