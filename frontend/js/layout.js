/* BOOST — shared shell for all module pages.
   Each page declares <body data-page="requests"> and loads this script,
   then calls BOOST.mount(renderFn). */
(function () {
  "use strict";

  var NAV = [
    {
      group: "Procurement",
      items: [
        { key: "dashboard", href: "/dashboard", label: "Dashboard", icon: "dashboard" },
        { key: "requests", href: "/requests", label: "Procurement Requests", icon: "requests", badge: "requests" },
        { key: "quotations", href: "/quotations", label: "Quotations", icon: "quotations", badge: "quotations" },
        { key: "bidding", href: "/bidding", label: "Bidding Records", icon: "bidding" },
        { key: "orders", href: "/orders", label: "Purchase Orders", icon: "orders" },
      ],
    },
    {
      group: "Documents",
      items: [
        { key: "documents", href: "/documents", label: "Document Repository", icon: "documents" },
        { key: "scanner", href: "/scanner", label: "Scan a Document", icon: "scanner" },
      ],
    },
    {
      group: "System",
      items: [
        { key: "reports", href: "/reports", label: "Reports", icon: "reports" },
        { key: "settings", href: "/settings", label: "Settings", icon: "settings" },
      ],
    },
  ];

  var money = new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  });
  var dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
  var moneyK = new Intl.NumberFormat("en-PH", { notation: "compact", maximumFractionDigits: 1 });

  function esc(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function fmtMoney(v) {
    var n = Number(v);
    return Number.isFinite(n) ? money.format(n) : "—";
  }

  function fmtMoneyK(v) {
    var n = Number(v);
    return Number.isFinite(n) ? "₱" + moneyK.format(n) : "—";
  }

  function fmtDate(v) {
    if (!v) return "—";
    var d = new Date(v);
    return isNaN(d.getTime()) ? "—" : dateFmt.format(d);
  }

  function label(status) {
    return String(status || "").replace(/_/g, " ");
  }

  function badge(status) {
    return '<span class="badge ' + esc(status) + '">' + esc(label(status)) + "</span>";
  }

  /* The status filter was rebuilt by hand in five modules and they had already
     drifted apart. One definition, used everywhere, with the counts wired to the
     `statusCounts` facet the list endpoints return. */
  function statusFilter(statuses, allLabel) {
    return {
      id: "status",
      type: "select",
      options: [""].concat(statuses).map(function (s) {
        return { value: s, label: s ? label(s) : allLabel || "All statuses" };
      }),
      counts: function (data) {
        return (data && data.statusCounts) || null;
      },
    };
  }

  function shell() {
    var page = document.body.dataset.page || "dashboard";
    var title = document.body.dataset.title || "Dashboard";

    var groups = NAV.map(function (g) {
      var items = g.items
        .map(function (i) {
          var active = i.key === page ? " active" : "";
          var badgeHtml = i.badge ? ' <span class="nav-badge" data-nav-badge="' + i.badge + '"></span>' : "";
          return (
            '<a class="nav-item' + active + '" href="' + i.href + '">' +
            '<span class="nav-icon">' + BOOST.icon(i.icon, { size: 17 }) + "</span>" +
            "<span>" + esc(i.label) + "</span>" +
            badgeHtml +
            "</a>"
          );
        })
        .join("");
      return '<div class="nav-group">' + esc(g.group) + "</div>" + items;
    }).join("");

    document.body.innerHTML =
      '<a class="skip-link" href="#main-content">Skip to main content</a>' +
      '<div class="scrim" id="scrim" hidden></div>' +
      '<div class="app">' +
      '<aside class="sidebar" id="sidebar">' +
      '<div class="sidebar-head">' +
      '<a class="sidebar-brand" href="/dashboard">' +
      '<img src="/assets/boost-logo-mark.png" alt="BOOST" />' +
      "<span>Procurement and Order Operations System</span>" +
      "</a>" +
      '<button class="drawer-close" id="drawer-close" type="button" aria-label="Close navigation">' + BOOST.icon("close", { size: 16 }) + "</button>" +
      "</div>" +
      '<nav class="sidebar-nav" aria-label="Main">' + groups + "</nav>" +
      '<div class="sidebar-foot">' +
      '<div class="avatar" id="foot-avatar">B</div>' +
      '<div class="who"><strong id="foot-name">BOOST user</strong><span id="foot-org">Signed in</span></div>' +
      '<button class="sidebar-logout" id="logout" type="button" title="Sign out" aria-label="Sign out">' +
      BOOST.icon("logout", { size: 16 }) +
      "</button>" +
      "</div>" +
      "</aside>" +
      '<div class="main">' +
      '<header class="topbar">' +
      '<div class="topbar-main">' +
      '<button class="burger" id="burger" type="button" aria-label="Open navigation" aria-expanded="false" aria-controls="sidebar">' +
      '<span></span><span></span><span></span>' +
      "</button>" +
      "<h1>" + esc(title) + "</h1>" +
      '<div class="topbar-spacer"></div>' +
      // Search lives on each page's filter card, where it filters that list.
      // A second global box in the bar duplicated it and never applied to the
      // page you were looking at.
      '<div class="bell-wrap">' +
      '<button class="bell" id="bell" type="button" aria-label="Notifications" aria-expanded="false" aria-haspopup="true">' +
      BOOST.icon("bell", { size: 18 }) +
      '<span class="bell-count" id="bell-count" hidden></span>' +
      "</button>" +
      '<div class="bell-panel" id="bell-panel" role="dialog" aria-label="Notifications" hidden></div>' +
      "</div>" +
      "</div>" +
      "</header>" +
      '<main class="content" id="main-content" tabindex="-1"><div id="page"></div></main>' +
      "</div>" +
      "</div>";

    bindDrawer();

    var logout = document.getElementById("logout");
    logout.addEventListener("click", async function () {
      logout.disabled = true;
      try {
        await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
      } catch (e) {
        /* redirect anyway */
      }
      window.location.replace("/login");
    });
  }

  /* ---- mobile drawer (desktop keeps the static sidebar) ---- */
  var drawerOpen = false;

  function setDrawer(open) {
    var sidebar = document.getElementById("sidebar");
    var scrim = document.getElementById("scrim");
    var burger = document.getElementById("burger");
    if (!sidebar || !scrim || !burger) return;

    drawerOpen = !!open;
    sidebar.classList.toggle("open", drawerOpen);
    scrim.hidden = !drawerOpen;
    scrim.classList.toggle("on", drawerOpen);
    burger.setAttribute("aria-expanded", String(drawerOpen));
    // Its own lock class: the detail drawer must not clear this one.
    document.body.classList.toggle("nav-open", drawerOpen);
  }

  function bindDrawer() {
    var burger = document.getElementById("burger");
    var scrim = document.getElementById("scrim");
    var closeBtn = document.getElementById("drawer-close");

    burger.addEventListener("click", function () { setDrawer(!drawerOpen); });
    scrim.addEventListener("click", function () { setDrawer(false); });
    closeBtn.addEventListener("click", function () { setDrawer(false); });

    // Tapping a destination closes the drawer (same-page jumps feel instant).
    document.querySelectorAll(".nav-item").forEach(function (item) {
      item.addEventListener("click", function () { setDrawer(false); });
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && drawerOpen) setDrawer(false);
    });

    // Back to a wide viewport: hand the space back to the docked sidebar.
    window.addEventListener("resize", function () {
      if (window.innerWidth > 860 && drawerOpen) setDrawer(false);
    });
  }

  function me() {
    return fetch("/api/auth/me", { cache: "no-store", credentials: "include" }).then(function (r) {
      if (r.status === 401) {
        window.location.replace("/login?next=" + encodeURIComponent(window.location.pathname));
        return null;
      }
      return r.ok ? r.json() : null;
    });
  }

  function json(url) {
    return fetch(url, { cache: "no-store", credentials: "include" }).then(function (r) {
      if (r.status === 401) {
        window.location.replace("/login?next=" + encodeURIComponent(window.location.pathname));
        throw new Error("unauthenticated");
      }
      return r.json().then(function (body) {
        if (!r.ok) throw new Error(body.error || "Request failed");
        return body;
      });
    });
  }

  function initials(name) {
    return String(name || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(function (p) {
        return p.charAt(0).toUpperCase();
      })
      .join("") || "B";
  }

  function setUser(user) {
    var name = (user && (user.fullName || user.email)) || "BOOST user";
    document.getElementById("foot-avatar").textContent = initials(name);
    document.getElementById("foot-name").textContent = name;
    document.getElementById("foot-org").textContent = (user && user.role) || "Client";
  }

  function setBadges(counts) {
    Object.keys(counts || {}).forEach(function (key) {
      document.querySelectorAll('[data-nav-badge="' + key + '"]').forEach(function (el) {
        var n = Number(counts[key]) || 0;
        el.textContent = n > 0 ? n : "";
        el.hidden = n <= 0;
      });
    });
  }

  /* One source of truth for the sidebar badges. Fetched once per page load so
     the numbers are identical everywhere and don't depend on which module
     happened to render last. */
  function refreshBadges() {
    return json("/api/nav-counts")
      .then(function (c) {
        setBadges({ requests: c.requests, quotations: c.quotations });
      })
      .catch(function () {
        /* badges are cosmetic — never block a page on them */
      })
      .then(function () {
        // A status change moves work out of the approval queue, so the bell
        // has to be re-counted at the same time.
        if (document.getElementById("bell")) {
          notif.loaded = false;
          return loadNotifications();
        }
      });
  }

  /* Badges are a snapshot taken once per page load, so any update made on a
     different page left the nav lying until a manual reload. Each module used to
     remember to call refreshBadges() after its own mutations — which is exactly
     the thing that gets forgotten when someone adds a new action. So rather than
     trust every call site, re-read on the way back to the tab and slowly while
     it is being watched. Cheap: two small GETs, and the count is unchanged
     almost every time. */
  var badgeCheckedAt = 0;

  function revalidateBadges() {
    // Rebuilding the bell while someone is reading it is worse than a number
    // that is a minute old.
    if (notif.open) return;
    // visibilitychange and focus normally fire together; a burst of events
    // should not turn into a burst of requests.
    if (Date.now() - badgeCheckedAt < 30 * 1000) return;

    badgeCheckedAt = Date.now();
    refreshBadges();
  }

  function watchBadges() {
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) revalidateBadges();
    });
    window.addEventListener("focus", revalidateBadges);
    // Back/forward restores the page from the bfcache without a reload, so
    // whatever is on screen is what was true when the tab was hidden.
    window.addEventListener("pageshow", function (e) {
      if (e.persisted) revalidateBadges();
    });
    setInterval(function () {
      // Only a tab being looked at is worth polling.
      if (!document.hidden) revalidateBadges();
    }, 60 * 1000);
  }

  function loading(label) {
    document.getElementById("page").innerHTML =
      '<div class="state-msg"><div class="spinner"></div>' + esc(label || "Loading…") + "</div>";
  }

  function error(message, retry) {
    document.getElementById("page").innerHTML =
      '<div class="card"><div class="empty">' +
      "<strong>We could not load this page</strong>" +
      "<p>" + esc(message) + "</p>" +
      '<button class="btn" type="button" id="retry">Try again</button>' +
      "</div></div>";
    var btn = document.getElementById("retry");
    if (btn && retry) btn.addEventListener("click", retry);
  }

  function table(columns, rows, emptyText) {
    if (!rows || !rows.length) {
      return '<div class="empty"><strong>Nothing here yet</strong><p>' + esc(emptyText || "No records to show.") + "</p></div>";
    }
    var head = columns.map(function (c) {
      return "<th>" + esc(c.label) + "</th>";
    }).join("");
    var body = rows
      .map(function (row) {
        return "<tr>" + columns.map(function (c) {
          return '<td class="' + (c.cls || "") + '">' + c.render(row) + "</td>";
        }).join("") + "</tr>";
      })
      .join("");
    return '<div class="table-scroll"><table><thead><tr>' + head + "</tr></thead><tbody>" + body + "</tbody></table></div>";
  }

  function soon(title, detail) {
    document.getElementById("page").innerHTML =
      '<div class="card"><div class="soon">' +
      '<span class="badge-lg">Module placeholder</span>' +
      "<h2>" + esc(title) + "</h2>" +
      "<p>" + esc(detail) + "</p>" +
      '<a class="btn ghost" href="/dashboard">Back to dashboard</a>' +
      "</div></div>";
  }

  /* ---- notifications (the bell) ----
     Activity comes from /api/notifications (recent request_events plus the
     queue waiting on a decision). "Seen" state is kept in localStorage so
     there is no per-user read table to maintain. */

  var SEEN_KEY = "boost.notifications.seen";
  var notif = { loaded: false, loading: false, items: [], awaiting: { total: 0 }, open: false };

  function seenAt() {
    try {
      var raw = window.localStorage.getItem(SEEN_KEY);
      var t = raw ? Date.parse(raw) : NaN;
      return isFinite(t) ? t : null;
    } catch (e) {
      return null;
    }
  }

  function markSeen(iso) {
    try {
      window.localStorage.setItem(SEEN_KEY, iso || new Date().toISOString());
    } catch (e) {
      /* private mode: the bell still works, it just cannot remember */
    }
  }

  function ago(value) {
    var t = Date.parse(value);
    if (!isFinite(t)) return "";
    var mins = Math.round((Date.now() - t) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    var days = Math.round(hrs / 24);
    if (days < 7) return days + "d ago";
    return fmtDate(value);
  }

  // Events come from the shared trail, so each one names the module it belongs
    // to and links straight to that record.
  function eventText(item) {
    var ref = item.entityRef || "A record";
    var kind = item.entityType === "request" ? "" : ENTITY_LABEL[item.entityType] + " ";

    switch (item.action) {
      case "created":
        return kind + ref + " was created";
      case "cancelled":
        return kind + ref + " was cancelled";
      case "bulk_status":
        return kind + ref + " moved to " + label(item.toStatus) + " in a bulk update";
      case "status_change":
        return kind + ref + " moved to " + label(item.toStatus);
      default:
        return kind + ref + " was updated";
    }
  }

  function eventIcon(item) {
    if (item.action === "created") return "plus";
    if (item.action === "cancelled") return "close";
    if (item.action === "status_change" || item.action === "bulk_status") return "check";
    return ENTITY_ICON[item.entityType] || "requests";
  }

  function unreadCount() {
    var seen = seenAt();
    if (seen === null) return 0; // first visit: treat history as already seen
    return notif.items.filter(function (i) {
      var t = Date.parse(i.createdAt);
      return isFinite(t) && t > seen;
    }).length;
  }

  function paintBellCount() {
    var badge = document.getElementById("bell-count");
    if (!badge) return;
    var n = unreadCount();
    var waiting = Number(notif.awaiting.total) || 0;

    if (n > 0) {
      badge.textContent = n > 99 ? "99+" : String(n);
      badge.hidden = false;
      badge.classList.remove("is-dot");
    } else if (waiting > 0) {
      // Nothing new to read, but work is waiting — show a quiet dot.
      badge.textContent = "";
      badge.hidden = false;
      badge.classList.add("is-dot");
    } else {
      badge.hidden = true;
      badge.classList.remove("is-dot");
    }
  }

  function paintBellPanel() {
    var panel = document.getElementById("bell-panel");
    if (!panel) return;
    var seen = seenAt();

    var head =
      '<div class="bell-head"><strong>Notifications</strong>' +
      '<button type="button" class="bell-read" id="bell-read">Mark all read</button></div>';

    var waiting = Number(notif.awaiting.total) || 0;
    var waitingHtml = waiting
      ? '<a class="bell-waiting" href="/requests?status=pending">' +
        BOOST.icon("alert", { size: 15 }) +
        "<span><strong>" + waiting + "</strong> request" + (waiting > 1 ? "s" : "") +
        " awaiting a decision</span></a>"
      : "";

    var body = notif.items.length
      ? '<ul class="bell-list">' +
        notif.items
          .map(function (item) {
            var t = Date.parse(item.createdAt);
            var isNew = seen !== null && isFinite(t) && t > seen;
            return (
              '<li><a class="bell-item' + (isNew ? " is-new" : "") + '" href="' +
              BOOST.entityHref(item.entityType, item.entityRef) + '">' +
              '<span class="bell-ico">' + BOOST.icon(eventIcon(item), { size: 14 }) + "</span>" +
              "<span class=\"bell-body\"><span class=\"bell-text\">" + esc(eventText(item)) + "</span>" +
              // The status is already in the headline, so the sub-line carries only who
              // and when.
              '<span class="bell-sub">' +
              esc([item.actorName, ago(item.createdAt)].filter(Boolean).join(" · ")) +
              "</span></span></a></li>"
            );
          })
          .join("") +
        "</ul>"
      : '<p class="bell-empty">Nothing here yet. Requests you create or approve will show up in this list.</p>';

    var foot =
      '<div class="bell-foot"><a href="/requests?status=pending">Go to approval queue</a>' +
      '<a href="/requests">All requests</a></div>';

    panel.innerHTML = head + waitingHtml + body + foot;

    var read = document.getElementById("bell-read");
    if (read) {
      read.addEventListener("click", function () {
        markSeen();
        paintBellCount();
        paintBellPanel();
      });
    }
  }

  function toggleBell(force) {
    var panel = document.getElementById("bell-panel");
    var btn = document.getElementById("bell");
    if (!panel || !btn) return;

    notif.open = force === undefined ? !notif.open : !!force;
    panel.hidden = !notif.open;
    btn.setAttribute("aria-expanded", String(notif.open));

    if (notif.open) {
      paintBellPanel();
      if (!notif.loaded) loadNotifications();
    }
  }

  function loadNotifications() {
    if (notif.loading) return Promise.resolve();
    notif.loading = true;

    return json("/api/notifications")
      .then(function (data) {
        notif.items = data.items || [];
        notif.awaiting = data.awaitingDecision || { total: 0 };
        notif.loaded = true;

        // First visit: remember what is already there so the bell does not
        // greet you with a wall of unread history.
        if (seenAt() === null) markSeen(data.serverTime);

        paintBellCount();
        if (notif.open) paintBellPanel();
      })
      .catch(function () {
        /* the bell is not worth an error banner */
      })
      .then(function () {
        notif.loading = false;
      });
  }

  function initBell() {
    var btn = document.getElementById("bell");
    var panel = document.getElementById("bell-panel");
    if (!btn || !panel) return;

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleBell();
    });

    panel.addEventListener("click", function (e) {
      e.stopPropagation();
      // Opening an item counts as reading it.
      if (e.target.closest("a")) markSeen();
    });

    document.addEventListener("click", function (e) {
      if (!notif.open) return;
      if (e.target.closest(".bell-wrap")) return;
      toggleBell(false);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && notif.open) {
        toggleBell(false);
        btn.focus();
      }
    });

    // Fetch up front so the count is right on first paint, and refresh after
    // any action that changes the queue.
    loadNotifications();
  }

  function mount(render) {
    shell();
    initBell();
    watchBadges();

    return me()
      .then(function (payload) {
        if (payload && payload.user) setUser(payload.user);
        refreshBadges();
        return render(payload && payload.user);
      })
      .catch(function (err) {
        error(err.message);
      });
  }

  /* ---- toast ---- */
  function toast(message, tone) {
    var host = document.getElementById("toasts");
    if (!host) {
      host = document.createElement("div");
      host.id = "toasts";
      host.className = "toasts";
      host.setAttribute("role", "status");
      host.setAttribute("aria-live", "polite");
      document.body.appendChild(host);
    }
    var el = document.createElement("div");
    el.className = "toast" + (tone ? " " + tone : "");
    el.textContent = message;
    host.appendChild(el);
    setTimeout(function () {
      el.classList.add("out");
      setTimeout(function () { el.remove(); }, 250);
    }, 3600);
  }

  /* ---- detail drawer (mobile: full-width sheet, desktop: right panel) ---- */
  var FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function openDrawer(title, html, onMount) {
    closeDrawer();
    var returnFocusTo = document.activeElement;

    var wrap = document.createElement("div");
    wrap.className = "drawer-layer";
    wrap.innerHTML =
      '<div class="drawer-scrim" data-close="1"></div>' +
      '<aside class="drawer" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
      '<header class="drawer-head"><h2>' + esc(title) + "</h2>" +
      '<button type="button" class="drawer-x" data-close="1" aria-label="Close">' + BOOST.icon("close", { size: 16 }) + "</button></header>" +
      '<div class="drawer-body">' + html + "</div>" +
      "</aside>";
    document.body.appendChild(wrap);
    document.body.classList.add("detail-open");

    wrap.querySelectorAll("[data-close]").forEach(function (el) {
      el.addEventListener("click", function () { closeDrawer(); });
    });

    function onKey(e) {
      if (e.key === "Escape") {
        closeDrawer();
        return;
      }
      // Keep Tab inside the dialog while it is modal.
      if (e.key !== "Tab") return;
      var panel = wrap.querySelector(".drawer");
      var items = Array.prototype.filter.call(
        panel.querySelectorAll(FOCUSABLE),
        function (el) { return el.offsetParent !== null; }
      );
      if (!items.length) return;
      var first = items[0];
      var last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    wrap._onKey = onKey;

    if (typeof onMount === "function") onMount(wrap);

    var focusTarget = wrap.querySelector(".drawer-body [data-autofocus]") || wrap.querySelector(".drawer-x");
    if (focusTarget) focusTarget.focus();

    wrap._returnFocusTo = returnFocusTo;
    return wrap;
  }

  function closeDrawer() {
    var layer = document.querySelector(".drawer-layer");
    if (!layer) return;
    if (layer._onKey) document.removeEventListener("keydown", layer._onKey);
    var back = layer._returnFocusTo;
    layer.remove();
    // Always release this lock. It used to be conditional on the sidebar not
    // existing, which left the page with overflow:hidden after every detail
    // panel — nothing could be scrolled or dragged again.
    document.body.classList.remove("detail-open");
    // Send focus back where it came from so keyboard users keep their place.
    if (back && back.isConnected) back.focus();
  }

  /* ---- shared activity trail rendering ---- */

  var ENTITY_LABEL = {
    bid: "Bid",
    request: "Request",
    quotation: "Quotation",
    order: "Purchase order",
    document: "Document",
  };

  var ENTITY_HREF = {
    request: "/requests?q=",
    quotation: "/quotations?q=",
    order: "/orders?q=",
    document: "/documents?q=",
    bid: "/bidding?q=",
  };

  var ENTITY_ICON = {
    request: "requests",
    quotation: "quotations",
    order: "orders",
    document: "documents",
    bid: "bidding",
  };

  function timelineHtml(events) {
    if (!events || !events.length) {
      return '<li class="tl-item tl-empty">No activity recorded yet.</li>';
    }
    return events
      .map(function (e) {
        return (
          '<li class="tl-item"><span class="tl-dot"></span>' +
          "<div><strong>" + esc(label(e.toStatus || e.action)) + "</strong>" +
          "<span>" + esc(e.actorName || "System") + " · " + fmtDate(e.createdAt) + "</span>" +
          (e.note ? '<em>"' + esc(e.note) + '"</em>' : "") +
          "</div></li>"
        );
      })
      .join("");
  }

  /**
   * Fetches a record's history from the shared trail and returns the markup
   * for a drawer section. Every module records into the same log, so this is
   * the one place that knows how to read it.
   */
  function historySection(entity, id, heading) {
    return json("/api/activity?entity=" + encodeURIComponent(entity) + "&id=" + encodeURIComponent(id))
      .then(function (data) {
        var events = (data && data.events) || [];
        if (!events.length) return "";
        return (
          '<div class="drawer-section"><h3>' + esc(heading || "Activity") + "</h3>" +
          '<ul class="timeline">' + timelineHtml(events) + "</ul></div>"
        );
      })
      .catch(function () {
        return "";
      });
  }

  /* ---- module record drawer (quotations, orders, documents) ---- */

  // Mirrors the server's rules so the buttons match what the API will accept.
  // The server still validates; this only avoids offering impossible moves.
  var MODULE_TRANSITIONS = {
    // Bid packages: draft -> open -> closed -> awarded, matching
    // routes/bidding.js.
    bid: {
      draft: ["open", "cancelled"],
      open: ["closed", "awarded", "cancelled"],
      closed: ["awarded", "cancelled"],
      awarded: [],
      cancelled: [],
    },
    quotation: {
      draft: ["active", "cancelled"],
      active: ["awarded", "expired", "cancelled"],
      awarded: [],
      expired: [],
      cancelled: [],
    },
    order: {
      pending: ["approved", "cancelled"],
      approved: ["shipped", "cancelled"],
      shipped: ["delivered"],
      delivered: [],
      cancelled: [],
    },
  };

  var MODULE_PATH = { bid: "bids", quotation: "quotations", order: "orders" };

  /**
   * The nav as data, for pages that need to reflect it. Settings lists the
   * modules from this instead of keeping its own copy, which went stale the
   * moment a placeholder shipped and then quietly lied about it.
   */
  function navItems() {
    var out = [];
    NAV.forEach(function (g) {
      g.items.forEach(function (item) {
        out.push({ group: g.group, label: item.label, href: item.href, key: item.key });
      });
    });
    return out;
  }

  /**
   * Opens a record drawer with its status actions and audit history.
   *
   * @param {object}   o
   * @param {string}   o.entity   quotation | order | document
   * @param {object}   o.row      the record from the list
   * @param {string}   o.title    heading for the drawer
   * @param {string}   o.body     pre-built HTML (facts, description, links)
   * @param {Function} [o.onChanged] called after a successful status change
   */
  function moduleDrawer(o) {
    var entity = o.entity;
    var row = o.row || {};
    var allowed = (MODULE_TRANSITIONS[entity] || {})[row.status] || [];

    var buttons = allowed
      .map(function (next) {
        var needsNote = next === "cancelled" ? ' data-note="1"' : "";
        var style = next === "cancelled" ? "ghost danger" : "";
        return (
          '<button type="button" class="btn ' + style + '" data-next="' + esc(next) + '"' + needsNote + ">" +
          "Mark " + esc(label(next)) + "</button>"
        );
      })
      .join("");

    var actionsHtml = buttons
      ? '<div class="drawer-actions">' + buttons + "</div>"
      : '<p class="muted-note">This record is ' + esc(label(row.status)) +
        " — there are no further status changes available.</p>";

    return openDrawer(
      o.title,
      o.body +
        actionsHtml +
        // Filled in once the history request returns.
        '<div class="tl-slot" data-tl-slot></div>',
      function (layer) {
        BOOST.historySection(entity, row.id).then(function (html) {
          var slot = layer.querySelector("[data-tl-slot]");
          if (slot && html) slot.outerHTML = html;
        });

        layer.querySelectorAll("[data-next]").forEach(function (btn) {
          btn.addEventListener("click", function () {
            var next = btn.dataset.next;
            var note = "";
            if (btn.dataset.note === "1") {
              note = window.prompt("Reason for cancelling (required):", "") || "";
              if (!note.trim()) {
                BOOST.toast("A reason is required to cancel.", "warn");
                return;
              }
            }
            btn.disabled = true;
            closeDrawer();

            fetch("/api/" + MODULE_PATH[entity] + "/" + row.id + "/status", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ status: next, note: note.trim() }),
            })
              .then(function (res) {
                return res.json().then(function (b) {
                  return { ok: res.ok, body: b };
                });
              })
              .then(function (res) {
                if (!res.ok) throw new Error(res.body.error || "Could not update.");
                BOOST.toast(res.body.message || "Updated.", "ok");
                // A status change is activity: refresh the bell too.
                if (typeof o.onChanged === "function") o.onChanged();
                else refreshBadges();
              })
              .catch(function (err) {
                BOOST.toast(err.message, "warn");
              });
          });
        });
      }
    );
  }

  window.BOOST = {
    mount: mount,
    navItems: navItems,
    me: me,
    json: json,
    esc: esc,
    fmtMoney: fmtMoney,
    fmtMoneyK: fmtMoneyK,
    fmtDate: fmtDate,
    badge: badge,
    label: label,
    statusFilter: statusFilter,
    entityLabel: function (type) { return ENTITY_LABEL[type] || "Record"; },
    entityHref: function (type, ref) {
      return (ENTITY_HREF[type] || "/requests?q=") + encodeURIComponent(ref || "");
    },
    entityIcon: function (type) { return ENTITY_ICON[type] || "requests"; },
    timelineHtml: timelineHtml,
    historySection: historySection,
    moduleDrawer: moduleDrawer,
    table: table,
    loading: loading,
    error: error,
    soon: soon,
    setBadges: setBadges,
    refreshBadges: refreshBadges,
    refreshNotifications: function () {
      notif.loaded = false;
      return loadNotifications();
    },
    setUser: setUser,
    initials: initials,
    toast: toast,
    openDrawer: openDrawer,
    closeDrawer: closeDrawer,
  };
})();