/* BOOST — Settings module: read-only account + system info for now. */
(function () {
  "use strict";

  BOOST.mount(function (user) {
    var role = (user && user.role) || "client";

    document.getElementById("page").innerHTML =
      '<div class="stack">' +
      '<section class="card">' +
      '<div class="card-head"><div><h2>Your account</h2><p>Signed-in identity and access</p></div></div>' +
      '<div class="settings-list">' +
      row("Full name", (user && user.fullName) || "—") +
      row("Email", (user && user.email) || "—") +
      row("Username", (user && user.username) || "—") +
      row("Role", role.charAt(0).toUpperCase() + role.slice(1)) +
      "</div>" +
      "</section>" +

      '<section class="card" id="security-card">' +
      '<div class="card-head"><div><h2>Security</h2><p>Sign-in activity and lockout state</p></div></div>' +
      '<div class="settings-list" id="security-list"><div class="state-msg">Loading…</div></div>' +
      "</section>" +

      '<section class="card">' +
      '<div class="card-head"><div><h2>Modules</h2><p>What is live in this build</p></div></div>' +
      '<div class="settings-list">' +
      moduleRow("Dashboard", "Live", "/dashboard") +
      moduleRow("Procurement Requests", "Live", "/requests") +
      moduleRow("Quotations", "Live", "/quotations") +
      moduleRow("Purchase Orders", "Live", "/orders") +
      moduleRow("Document Repository", "Live", "/documents") +
      moduleRow("Open Mobile Scanner", "Live", "/scanner") +
      moduleRow("Bidding Records", "Placeholder", "/bidding") +
      moduleRow("Reports", "Placeholder", "/reports") +
      "</div>" +
      "</section>" +
      "</div>";

    loadSecurity();
  });

  function loadSecurity() {
    BOOST.json("/api/auth/session-info")
      .then(function (s) {
        var locked = Boolean(s.lockedUntil);
        var attemptsLeft = Math.max((s.maxAttempts || 5) - (s.failedAttempts || 0), 0);

        document.getElementById("security-list").innerHTML =
          row("Last successful sign-in", s.lastLoginAt ? BOOST.fmtDate(s.lastLoginAt) : "This is your first sign-in") +
          row("Failed attempts", locked ? s.failedAttempts + " (account locked)" : s.failedAttempts + " of " + s.maxAttempts) +
          row(
            "Account status",
            locked
              ? '<span class="badge cancelled">Locked until ' + BOOST.fmtDate(s.lockedUntil) + "</span>"
              : '<span class="badge awarded">Active</span>'
          ) +
          row("Attempts remaining", String(attemptsLeft)) +
          row("Session length", (s.sessionExpiresInHours || 8) + " hours") +
          row("Member since", BOOST.fmtDate(s.memberSince));
      })
      .catch(function (err) {
        document.getElementById("security-list").innerHTML =
          '<div class="state-msg">' + BOOST.esc(err.message) + "</div>";
      });
  }

  function row(label, value) {
    return (
      '<div class="settings-row"><div><strong>' + BOOST.esc(label) + "</strong>" +
      "<span>" + BOOST.esc(value) + "</span></div></div>"
    );
  }

  function moduleRow(label, state, href) {
    var badge = state === "Live" ? '<span class="badge awarded">Live</span>' : '<span class="badge draft">Placeholder</span>';
    return (
      '<div class="settings-row"><div><strong>' + BOOST.esc(label) + "</strong>" +
      '<span>Open module</span></div><a class="btn ghost" href="' + href + '">' + badge + "</a></div>"
    );
  }
})();