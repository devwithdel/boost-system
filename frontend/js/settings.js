/* BOOST — Settings: your account, your activity, and sign-in security.

   The module status list used to be a hand-maintained copy of the nav, which
   went stale the moment a placeholder shipped and then quietly lied about it.
   It is now derived from the nav itself, so the page cannot disagree with the
   sidebar. */
(function () {
  "use strict";

  var MIN_LENGTH = 8;

  BOOST.mount(function (user) {
    var role = (user && user.role) || "client";

    document.getElementById("page").innerHTML =
      '<div class="stack">' +

      // ---- account ----
      '<section class="card">' +
      '<div class="card-head"><div><h2>Your account</h2><p>Signed-in identity and access</p></div></div>' +
      '<div class="settings-list">' +
      row("Full name", (user && user.fullName) || "—") +
      row("Email", (user && user.email) || "—") +
      row("Username", (user && user.username) || "—") +
      row("Role", role.charAt(0).toUpperCase() + role.slice(1)) +
      row("User ID", String((user && user.id) || "—")) +
      "</div>" +
      "</section>" +

      // ---- activity ----
      '<section class="card">' +
      '<div class="card-head"><div><h2>Your activity</h2><p>What you have done in BOOST</p></div></div>' +
      '<div class="settings-list" id="activity-list"><div class="state-msg">Loading…</div></div>' +
      "</section>" +

      // ---- security ----
      '<section class="card" id="security-card">' +
      '<div class="card-head"><div><h2>Security</h2><p>Sign-in activity and lockout state</p></div>' +
      '<div class="card-actions">' +
      '<button type="button" class="btn" data-change-password="1">Change password</button>' +
      '<button type="button" class="btn ghost" data-signout="1">Sign out</button>' +
      "</div></div>" +
      '<div class="settings-list" id="security-list"><div class="state-msg">Loading…</div></div>' +
      "</section>" +

      // ---- modules ----
      '<section class="card">' +
      '<div class="card-head"><div><h2>Modules</h2><p>What is live in this build</p></div></div>' +
      '<div class="settings-list">' +
      moduleRows() +
      "</div>" +
      "</section>" +
      "</div>";

    loadSecurity();
    loadActivity();
    bindActions();
  });

  /* A row of plain text. The value is escaped, so callers must not pass markup —
     use actionRow for anything that needs a control. */
  function row(label, value) {
    return (
      '<div class="settings-row"><div><strong>' + BOOST.esc(label) + "</strong>" +
      "<span>" + BOOST.esc(value) + "</span></div></div>"
    );
  }

  /* A row whose value is trusted markup (a status badge). Kept separate from
     row() so the escaping rule is obvious at the call site: the old version
     took HTML and escaped it anyway, which printed the badge as literal
     "<span class=...>" text on the security card. */
  function badgeRow(label, html) {
    return (
      '<div class="settings-row"><div><strong>' + BOOST.esc(label) + "</strong>" +
      "<span>" + html + "</span></div></div>"
    );
  }

  function moduleRows() {
    // Grouped to match the sidebar, so the two read as the same list.
    var groups = {};
    var order = [];
    BOOST.navItems().forEach(function (item) {
      if (!groups[item.group]) {
        groups[item.group] = [];
        order.push(item.group);
      }
      groups[item.group].push(item);
    });

    return order
      .map(function (group) {
        var head = '<div class="settings-group">' + BOOST.esc(group) + "</div>";
        var body = groups[group].map(function (item) {
          // A module is live once its page loads its own script. Placeholders
          // load soon.js instead, which is the only place that word appears.
          return (
            '<div class="settings-row"><div><strong>' + BOOST.esc(item.label) + "</strong>" +
            "<span>" + BOOST.esc(item.href) + "</span></div>" +
            '<span class="badge awarded">Live</span></div>'
          );
        }).join("");
        return head + body;
      })
      .join("");
  }

  function loadSecurity() {
    BOOST.json("/api/auth/session-info")
      .then(function (s) {
        var locked = Boolean(s.lockedUntil);
        var attemptsLeft = Math.max((s.maxAttempts || 5) - (s.failedAttempts || 0), 0);

        document.getElementById("security-list").innerHTML =
          row("Last successful sign-in", s.lastLoginAt ? BOOST.fmtDate(s.lastLoginAt) : "This is your first sign-in") +
          row("Failed attempts", locked ? s.failedAttempts + " (account locked)" : s.failedAttempts + " of " + s.maxAttempts) +
          badgeRow(
            "Account status",
            locked
              ? '<span class="badge cancelled">Locked until ' + BOOST.fmtDate(s.lockedUntil) + "</span>"
              : '<span class="badge awarded">Active</span>'
          ) +
          badgeRow(
            "Attempts remaining",
            attemptsLeft <= 2 && !locked
              ? '<span class="badge pending">' + attemptsLeft + " left</span>"
              : String(attemptsLeft)
          ) +
          row("Session length", (s.sessionExpiresInHours || 8) + " hours") +
          row("Member since", BOOST.fmtDate(s.memberSince));
      })
      .catch(function (err) {
        document.getElementById("security-list").innerHTML =
          '<div class="state-msg">' + BOOST.esc(err.message) + "</div>";
      });
  }

  function loadActivity() {
    BOOST.json("/api/account/summary")
      .then(function (a) {
        document.getElementById("activity-list").innerHTML =
          row("Requests raised", String(a.requestsRaised || 0)) +
          row("Documents uploaded", String(a.documentsUploaded || 0)) +
          row("Bid packages created", String(a.bidsCreated || 0)) +
          row("Actions logged", String(a.actionsLogged || 0)) +
          row("Last activity", a.lastActivityAt ? BOOST.fmtDate(a.lastActivityAt) : "Nothing recorded yet");
      })
      .catch(function (err) {
        document.getElementById("activity-list").innerHTML =
          '<div class="state-msg">' + BOOST.esc(err.message) + "</div>";
      });
  }

  /* ---------------- change password ---------------- */

  function changePasswordDrawer() {
    var layer = BOOST.openDrawer(
      "Change password",
      '<form class="sub-form" id="pw-form">' +
        '<label>Current password<input type="password" id="currentPassword" autocomplete="current-password" required /></label>' +
        '<label>New password<input type="password" id="newPassword" autocomplete="new-password" required /></label>' +
        '<label>Confirm new password<input type="password" id="confirmPassword" autocomplete="new-password" required /></label>' +
        '<ul class="pw-rules">' +
        '<li id="rule-length">At least ' + MIN_LENGTH + " characters</li>" +
        '<li id="rule-letter">Contains a letter</li>' +
        '<li id="rule-number">Contains a number</li>' +
        "</ul>" +
        '<p class="report-note">You will stay signed in. Any password reset link already in your inbox stops working.</p>' +
        '<button type="submit" class="btn">Update password</button>' +
        "</form>"
    );

    var form = layer.querySelector("#pw-form");
    var next = layer.querySelector("#newPassword");
    var rules = {
      length: layer.querySelector("#rule-length"),
      letter: layer.querySelector("#rule-letter"),
      number: layer.querySelector("#rule-number"),
    };

    var first = layer.querySelector("#currentPassword");
    if (first) first.focus();

    next.addEventListener("input", function () {
      var value = next.value;
      mark(rules.length, value.length >= MIN_LENGTH);
      mark(rules.letter, /[a-zA-Z]/.test(value));
      mark(rules.number, /[0-9]/.test(value));
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();

      var current = layer.querySelector("#currentPassword").value;
      var value = next.value;
      var confirm = layer.querySelector("#confirmPassword").value;

      if (!current) {
        BOOST.toast("Enter your current password.", "warn");
        return;
      }
      if (value.length < MIN_LENGTH || !/[a-zA-Z]/.test(value) || !/[0-9]/.test(value)) {
        BOOST.toast(
          "Your password must be at least " + MIN_LENGTH + " characters and include a letter and a number.",
          "warn"
        );
        return;
      }
      if (value !== confirm) {
        BOOST.toast("The two passwords do not match.", "warn");
        return;
      }

      var submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      submit.textContent = "Updating…";

      fetch("/api/account/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ currentPassword: current, newPassword: value }),
      })
        .then(function (res) {
          return res.json().then(function (b) {
            return { ok: res.ok, body: b };
          });
        })
        .then(function (res) {
          if (!res.ok) throw new Error(res.body.error || "Could not change your password.");
          BOOST.closeDrawer();
          BOOST.toast(res.body.message || "Password changed.", "ok");
          // A change clears the lockout, so the security panel is now stale.
          loadSecurity();
          loadActivity();
        })
        .catch(function (err) {
          BOOST.toast(err.message, "warn");
          submit.disabled = false;
          submit.textContent = "Update password";
        });
    });
  }

  function mark(el, ok) {
    if (el) el.classList.toggle("ok", ok);
  }

  function bindActions() {
    // Delegated because the security card is re-rendered on refresh.
    document.addEventListener("click", function (e) {
      if (e.target.closest("[data-change-password]")) {
        e.preventDefault();
        changePasswordDrawer();
      } else if (e.target.closest("[data-signout]")) {
        e.preventDefault();
        BOOST.closeDrawer();
        signOut();
      }
    });
  }

  /* Same call the sidebar button makes: clear the cookie, then leave. Using the
     shared path means the session cookie is dropped before navigation rather
     than after it. */
  function signOut() {
    fetch("/api/auth/logout", { method: "POST", credentials: "include" })
      .catch(function () {
        /* navigate anyway — the cookie expires on its own */
      })
      .then(function () {
        window.location.replace("/login");
      });
  }
})();