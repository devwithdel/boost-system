/* BOOST — dashboard overview: greeting, KPI cards, monthly chart,
   documents-by-type donut, procurement pipeline. */
(function () {
  "use strict";

  var DOC_COLORS = ["#2f7bf6", "#f5a623", "#16a06a", "#7b5cf0", "#e5484d"];
  var DOC_LABELS = {
    request: "Procurement Requests",
    quotation: "Quotations",
    order: "Purchase Orders",
    contract: "Contracts",
    invoice: "Invoices & Receipts",
    other: "Other",
  };

  function greeting() {
    var h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  }

  /* A count in the greeting banner, as a link into the filtered list. */
  function chip(icon, count, noun, href) {
    if (!count) return "";
    return (
      '<a class="greet-chip' + (count === 0 ? " is-clear" : "") + '" href="' + BOOST.esc(href) + '">' +
      BOOST.icon(icon, { size: 14 }) +
      "<b>" + count + "</b>" +
      "<span>" + BOOST.esc(noun + (count === 1 ? "" : "s")) + "</span></a>"
    );
  }

  function kpi(label, icon, value, trend, down, href) {
    var inner =
      '<div class="kpi-top"><span>' + BOOST.esc(label) + "</span>" +
      '<span class="kpi-ico">' + BOOST.icon(icon, { size: 17 }) + "</span></div>" +
      '<p class="kpi-value">' + BOOST.esc(value) + "</p>" +
      '<div class="kpi-trend' + (down ? " down" : "") + '"><b>' + (down ? "▼" : "↗") + "</b><span>" + BOOST.esc(trend) + "</span></div>";

    // Every KPI is a shortcut into the filtered list it describes.
    return href
      ? '<a class="card kpi kpi-link" href="' + BOOST.esc(href) + '">' + inner + "</a>"
      : '<article class="card kpi">' + inner + "</article>";
  }

  function queue(rows) {
    if (!rows.length) {
      return (
        '<div class="empty" style="padding:28px 12px">' +
        "<strong>Nothing waiting on you</strong><p>New requests will appear here for approval.</p></div>"
      );
    }
    return rows
      .map(function (r) {
        return (
          '<a class="q-row" href="/requests?q=' + encodeURIComponent(r.requestNumber) + '">' +
          '<div><strong>' + BOOST.esc(r.requestNumber) + "</strong>" +
          "<span>" + BOOST.esc(r.description) + "</span></div>" +
          '<div class="q-meta">' + BOOST.fmtMoney(r.estimatedAmount) + BOOST.badge(r.status) + "</div>" +
          "</a>"
        );
      })
      .join("");
  }

  function bars(monthly) {
    var max = Math.max(
      1,
      monthly.reduce(function (m, r) {
        return Math.max(m, Number(r.submitted) || 0, Number(r.won) || 0);
      }, 0)
    );

    // Round the axis up to a clean 4-step maximum so gridlines land on
    // readable values instead of arbitrary fractions.
    var step = Math.ceil(max / 4);
    var top = step * 4 || 4;
    // Five labels for the four 25% gridline intervals, so every label lines up
    // with a gridline. Four labels left a gap in the middle of the axis.
    var ticks = [top, top - step, top - 2 * step, top - 3 * step, 0];

    // The bars plot bid COUNTS, so the axis is a plain number. Formatting it as
    // money made a "3 bids" axis read "₱3".
    var axis = ticks
      .map(function (t) {
        return '<span class="chart-y">' + BOOST.esc(String(t)) + "</span>";
      })
      .join("");

    var cols = monthly
      .map(function (r) {
        var sub = Math.round(((Number(r.submitted) || 0) / top) * 100);
        var won = Math.round(((Number(r.won) || 0) / top) * 100);
        var value = BOOST.fmtMoneyK(r.value);

        return (
          '<div class="chart-col">' +
          // No title attributes: native tooltips only appear on hover, which
          // is exactly the interaction we don't want on a static chart.
          '<span class="chart-value">' + BOOST.esc(value) + "</span>" +
          '<div class="chart-bars">' +
          '<i class="bar submitted" style="height:' + Math.max(sub, 1.5) + '%"></i>' +
          '<i class="bar won" style="height:' + Math.max(won, 1.5) + '%"></i>' +
          "</div>" +
          '<span class="chart-x">' + BOOST.esc(r.label) + "</span>" +
          "</div>"
        );
      })
      .join("");

    return (
      '<div class="chart-area">' +
      '<div class="chart-axis"><span class="chart-unit">Bids</span>' + axis + "</div>" +
      '<div class="chart-cols">' + cols + "</div>" +
      "</div>"
    );
  }

  function donut(items) {
    var total = items.reduce(function (s, i) {
      return s + i.count;
    }, 0);

    if (!total) return '<div class="empty" style="padding:24px 0"><p>No documents yet.</p></div>';

    var r = 68;
    var circ = 2 * Math.PI * r;
    var offset = 0;

    var segments = items
      .map(function (item, i) {
        var pct = (item.count / total) * 100;
        var len = (item.count / total) * circ;
        var seg =
          '<circle cx="90" cy="90" r="' + r + '" stroke="' + (item.color || DOC_COLORS[i % DOC_COLORS.length]) +
          '" stroke-dasharray="' + len.toFixed(2) + " " + (circ - len).toFixed(2) +
          '" stroke-dashoffset="' + (-offset).toFixed(2) + '"></circle>';
        offset += len;
        return seg;
      })
      .join("");

    var legend = items
      .map(function (item, i) {
        return (
          "<div><i style=\"background:" + (item.color || DOC_COLORS[i % DOC_COLORS.length]) + '"></i>' +
          "<span>" + BOOST.esc(item.label) + "</span><b>" + item.pct + "%</b></div>"
        );
      })
      .join("");

    return (
      '<div class="donut-wrap">' +
      '<svg class="donut" viewBox="0 0 180 180" role="img" aria-label="Documents by type">' + segments + "</svg>" +
      "</div>" +
      '<div class="donut-legend">' + legend + "</div>"
    );
  }

  function pipeline(stages) {
    var max = Math.max(
      1,
      stages.reduce(function (m, s) {
        return Math.max(m, s.count);
      }, 0)
    );

    var HREF = {
      "Pending requests": "/requests?status=pending",
      "Approved requests": "/requests?status=approved",
      "In progress": "/requests?status=in_progress",
      Completed: "/requests?status=completed",
      "Open orders": "/orders",
    };

    return stages
      .map(function (s) {
        var pct = Math.round((s.count / max) * 100);
        var href = HREF[s.label];
        var row =
          '<span>' + BOOST.esc(s.label) + "</span>" +
          '<div class="pipe-track"><div class="pipe-fill" style="width:' + Math.max(pct, 3) + "%;background:" + s.color + '"></div></div>' +
          "<b>" + s.count + "</b>";
        return href
          ? '<a class="pipe-row" href="' + href + '">' + row + "</a>"
          : '<div class="pipe-row">' + row + "</div>";
      })
      .join("");
  }

  BOOST.mount(function (user) {
    BOOST.loading("Loading your dashboard…");

    return BOOST.json("/api/dashboard").then(function (data) {
      var s = data.summary || {};
      var today = new Date();

      var name = (user && (user.fullName || user.email)) || "there";
      var docs = (data.documentsByType || []).map(function (d, i) {
        return {
          label: DOC_LABELS[d.document_type] || BOOST.label(d.document_type),
          count: Number(d.count) || 0,
          color: DOC_COLORS[i % DOC_COLORS.length],
          pct: d.percentage,
        };
      });

      document.getElementById("page").innerHTML =
        '<div class="stack">' +
        '<section class="card greet">' +
        '<span class="greet-ico">' + BOOST.icon("dashboard", { size: 19 }) + "</span>" +
        '<div class="greet-text">' +
        "<strong>" + BOOST.esc(greeting()) + ", " + BOOST.esc(name) + ".</strong>" +
        '<time class="greet-sub" datetime="' + today.toISOString().slice(0, 10) + '">' +
        BOOST.esc(today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })) +
        "</time></div>" +
        // The counts are links, not grey prose: the banner should be the
        // quickest way into the work that is waiting.
        '<div class="greet-actions">' +
        chip("requests", Number(s.pending_requests) || 0, "pending request", "/requests?status=pending") +
        chip("quotations", Number(s.open_quotations) || 0, "open quotation", "/quotations?status=active") +
        "</div>" +
        "</section>" +

        '<section class="kpi-grid">' +
        kpi("Active Requests", "calendar", s.active_requests || 0, (Number(s.requests_new_7d) || 0) + " new in the last 7 days", false, "/requests?status=pending") +
        kpi("Open Quotations", "quotations", s.open_quotations || 0, (Number(s.quotations_reviewing) || 0) + " pending review", false, "/quotations?status=active") +
        kpi("Win Rate (2026)", "trophy", (s.win_rate || 0) + "%", (Number(s.won_last_30d) || 0) + " bids awarded", Number(s.won_last_30d) < Number(s.active_quotations), "/quotations?status=awarded") +
        kpi("Revenue (" + BOOST.label(data.revenue_month || "month") + ")", "wallet", BOOST.fmtMoneyK(s.revenue), (Number(s.revenue_change_pct) || 0) + "% vs last month", Number(s.revenue_change_pct) < 0, "/orders") +
        "</section>" +

        '<section class="card">' +
        '<div class="card-head"><div><h2>Needs your approval</h2><p>Pending requests, oldest first</p></div>' +
        '<a class="pill-count" href="/requests?status=pending">View all</a></div>' +
        '<div class="q-list">' + queue(data.approvalQueue || []) + "</div>" +
        "</section>" +

        '<section class="charts">' +
        '<article class="card chart-card">' +
        "<h3>Bids Submitted vs. Won — Monthly</h3>" +
        '<p class="sub">Quotation activity over the last 6 months</p>' +
        bars(data.monthly || []) +
        '<div class="chart-legend">' +
        "<span><i class='sw submitted'></i>Submitted</span><span><i class='sw won'></i>Won</span>" +
        "<span><i class='sw value'></i>Total value (₱)</span>" +
        "</div>" +
        "</article>" +

        '<article class="card">' +
        '<div class="card-head"><div><h2>Documents by Type</h2><p>Repository breakdown</p></div></div>' +
        '<div class="card-body">' + donut(docs) + "</div>" +
        "</article>" +
        "</section>" +

        '<section class="card">' +
        '<div class="card-head"><div><h2>Active Procurement Pipeline</h2><p>Where work sits right now</p></div>' +
        '<a class="pill-count" href="/requests">Open requests</a></div>' +
        '<div class="card-body"><div class="pipeline">' + pipeline(data.pipeline || []) + "</div></div>" +
        "</section>" +
        "</div>";
    });
  });
})();