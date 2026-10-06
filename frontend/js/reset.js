/* BOOST — password recovery.
   Both pages share this script: it picks the form it is given by looking for
   #forgot-form / #reset-form on the page, so one file covers the request and
   the set-password steps and the two pages cannot drift apart. */
(function () {
  "use strict";

  var MIN_LENGTH = 8;

  var forgotForm = document.getElementById("forgot-form");
  var resetForm = document.getElementById("reset-form");
  var errorEl = document.getElementById("form-error");
  var noteEl = document.getElementById("form-note");
  var passwordInput = document.getElementById("password");
  var toggleBtn = document.getElementById("toggle-password");

  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
    noteEl.hidden = true;
  }

  function showNote(message) {
    errorEl.hidden = true;
    noteEl.textContent = message;
    noteEl.hidden = false;
  }

  function clearMessages() {
    errorEl.hidden = true;
    noteEl.hidden = true;
  }

  function post(url, body) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
        return data;
      });
    });
  }

  /* ---- step 1: request a link ---- */
  if (forgotForm) {
    var emailInput = document.getElementById("email");
    var sendBtn = document.getElementById("send-btn");

    // Arriving from the sign-in form means the address is already known.
    var remembered = null;
    try {
      remembered = window.localStorage.getItem("boost.login.remember");
      if (remembered) emailInput.value = JSON.parse(remembered).identifier || "";
    } catch (e) {
      /* storage unavailable: the field just starts empty */
    }

    forgotForm.addEventListener("submit", function (e) {
      e.preventDefault();
      clearMessages();

      var email = emailInput.value.trim();
      if (!email) {
        showError("Enter the email address on your account.");
        return;
      }

      sendBtn.disabled = true;
      sendBtn.textContent = "Sending…";

      post("/api/auth/forgot-password", { email: email })
        .then(function (data) {
          showNote(data.message);

          // Development convenience: with no mail server the server hands the
          // link back instead of sending it, so it is shown here rather than
          // buried in a console the requester cannot see.
          if (data.resetUrl) {
            noteEl.innerHTML =
              '<span class="note-line">' +
              escapeHtml(data.message) +
              "</span>" +
              '<a class="note-link" href="' +
              escapeHtml(data.resetUrl) +
              '">Open the reset link</a>';
            noteEl.hidden = false;
          }

          emailInput.readOnly = true;
          sendBtn.textContent = "Link sent";
        })
        .catch(function (err) {
          showError(err.message);
          sendBtn.disabled = false;
          sendBtn.textContent = "Send reset link";
        });
    });
  }

  /* ---- step 2: set the new password ---- */
  if (resetForm) {
    var token = new URLSearchParams(window.location.search).get("token") || "";
    var confirmInput = document.getElementById("confirm");
    var subtitle = document.getElementById("reset-subtitle");
    var resetBtn = document.getElementById("reset-btn");

    var rules = {
      length: document.getElementById("rule-length"),
      letter: document.getElementById("rule-letter"),
      number: document.getElementById("rule-number"),
    };

    bindToggle();

    if (!token) {
      subtitle.textContent = "This link is missing its reset code";
      showError("Open the link from your reset email, or request a new one.");
      return;
    }

    // Confirm the link is still good before asking for a password, so an
    // expired link is reported immediately instead of after typing.
    fetch("/api/auth/reset-password/" + encodeURIComponent(token), { credentials: "include" })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.error || "This reset link is not valid.");
          return data;
        });
      })
      .then(function (data) {
        subtitle.textContent = "Resetting the password for " + data.email;
        resetForm.hidden = false;
        passwordInput.focus();
      })
      .catch(function (err) {
        showError(err.message);
      });

    // Live checklist, so the rules are visible before the user submits.
    passwordInput.addEventListener("input", function () {
      var value = passwordInput.value;
      mark(rules.length, value.length >= MIN_LENGTH);
      mark(rules.letter, /[a-zA-Z]/.test(value));
      mark(rules.number, /[0-9]/.test(value));
    });

    resetForm.addEventListener("submit", function (e) {
      e.preventDefault();
      clearMessages();

      var password = passwordInput.value;
      if (password.length < MIN_LENGTH || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
        showError("Your password must be at least " + MIN_LENGTH + " characters and include a letter and a number.");
        return;
      }
      if (password !== confirmInput.value) {
        showError("The two passwords do not match.");
        return;
      }

      resetBtn.disabled = true;
      resetBtn.textContent = "Updating…";

      post("/api/auth/reset-password", { token: token, password: password })
        .then(function () {
          // The session cookie is already set by the response, so straight to
          // the dashboard.
          window.location.replace("/dashboard");
        })
        .catch(function (err) {
          showError(err.message);
          resetBtn.disabled = false;
          resetBtn.textContent = "Update password";
        });
    });
  }

  function bindToggle() {
    if (!toggleBtn || !passwordInput) return;
    var eyeIcon = toggleBtn.querySelector(".icon-eye");
    var eyeOffIcon = toggleBtn.querySelector(".icon-eye-off");

    toggleBtn.addEventListener("click", function () {
      var isHidden = passwordInput.type === "password";
      passwordInput.type = isHidden ? "text" : "password";
      eyeIcon.toggleAttribute("hidden", isHidden);
      eyeOffIcon.toggleAttribute("hidden", !isHidden);
      toggleBtn.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
    });
  }

  function mark(el, ok) {
    if (el) el.classList.toggle("ok", ok);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();