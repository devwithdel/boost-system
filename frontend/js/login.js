(function () {
  const form = document.getElementById("login-form");
  const errorEl = document.getElementById("form-error");
  const submitBtn = document.getElementById("signin-btn");
  const toggleBtn = document.getElementById("toggle-password");
  const passwordInput = document.getElementById("password");
  const identifierInput = document.getElementById("identifier");
  const rememberInput = document.getElementById("remember");
  const eyeIcon = toggleBtn.querySelector(".icon-eye");
  const eyeOffIcon = toggleBtn.querySelector(".icon-eye-off");

  /* ---- remember me (30 days) ----
     The session cookie is httpOnly with no persistence flag, so the browser
     drops it when the window closes. Remembering the address only saves the
     user retyping it — never the password — and the stored entry expires on
     its own so an old machine cannot prefill an account months later. */
  const REMEMBER_KEY = "boost.login.remember";
  const REMEMBER_DAYS = 30;

  function readRemembered() {
    try {
      const raw = window.localStorage.getItem(REMEMBER_KEY);
      if (!raw) return null;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved.identifier !== "string") return null;
      if (!isFinite(saved.expiresAt) || Date.now() > saved.expiresAt) {
        window.localStorage.removeItem(REMEMBER_KEY);
        return null;
      }
      return saved.identifier;
    } catch (e) {
      return null; // private mode / disabled storage — the form still works
    }
  }

  function saveRemembered(identifier) {
    try {
      window.localStorage.setItem(
        REMEMBER_KEY,
        JSON.stringify({
          identifier: identifier,
          expiresAt: Date.now() + REMEMBER_DAYS * 24 * 60 * 60 * 1000,
        })
      );
    } catch (e) {
      /* nothing to do — the sign-in itself already succeeded */
    }
  }

  function clearRemembered() {
    try {
      window.localStorage.removeItem(REMEMBER_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  const remembered = readRemembered();
  if (remembered) {
    identifierInput.value = remembered;
    rememberInput.checked = true;
  }

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

  function getSafeNextPath() {
    const next = new URLSearchParams(window.location.search).get("next");
    // Only allow same-origin absolute paths (no //, no protocol, no backslash).
    if (typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")) {
      return next;
    }
    return "/dashboard";
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError();

    const identifier = identifierInput.value.trim();
    const password = passwordInput.value;

    if (!identifier || !password) {
      showError("Please enter your email and password.");
      return;
    }

    if (rememberInput.checked) saveRemembered(identifier);
    else clearRemembered();

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
        // The backend warns when the account is close to a lockout, so a
        // typo doesn't silently cost the user 15 minutes.
        var message = data.error || "Unable to sign in. Please try again.";
        if (data.hint) message += " " + data.hint;
        showError(message);
        return;
      }

      window.location.href = getSafeNextPath();
    } catch (err) {
      console.error("Login request failed:", err);
      showError("Could not reach the server. Please check your connection and try again.");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Sign in";
    }
  });
})();
