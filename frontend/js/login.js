(function () {
  const form = document.getElementById("login-form");
  const errorEl = document.getElementById("form-error");
  const submitBtn = document.getElementById("signin-btn");
  const toggleBtn = document.getElementById("toggle-password");
  const passwordInput = document.getElementById("password");
  const eyeIcon = toggleBtn.querySelector(".icon-eye");
  const eyeOffIcon = toggleBtn.querySelector(".icon-eye-off");

  toggleBtn.addEventListener("click", () => {
    const isHidden = passwordInput.type === "password";
    passwordInput.type = isHidden ? "text" : "password";
    eyeIcon.toggleAttribute("hidden", isHidden);
    eyeOffIcon.toggleAttribute("hidden", !isHidden);
    toggleBtn.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
  });

  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  function clearError() {
    errorEl.textContent = "";
    errorEl.hidden = true;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError();

    const identifier = document.getElementById("identifier").value.trim();
    const password = passwordInput.value;

    if (!identifier || !password) {
      showError("Please enter your email and password.");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Signing in…";

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include", // sends/receives the httpOnly auth cookie
        body: JSON.stringify({ identifier, password }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        showError(data.error || "Unable to sign in. Please try again.");
        return;
      }

      window.location.href = "/dashboard.html";
    } catch (err) {
      console.error("Login request failed:", err);
      showError("Could not reach the server. Please check your connection and try again.");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Sign in";
    }
  });
})();
