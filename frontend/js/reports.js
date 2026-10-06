/* BOOST — Reports.

   Every figure here is computed on demand from the same tables the modules
   write, so a report can never disagree with the module that produced the
   data. Nothing is stored or cached server-side; the page refetches when the
   period changes. */
(function () {
  "use strict";

  /* The windows the page offers. Kept short and specific: a report that
     defaults to "everything" is usually answering a question nobody asked. */
  var PERIODS = [
    { value: "30", label: "Last 30 days" },
    { value: "90", label: "Last 90 days" },
    { value: "180", label: "Last 6 months" },
    { value: "365", label: "Last 12 months" },
  ];

  var SECTIONS = [
    { key: "spend", label: "Spend analysis" },
    { key: "suppliers", label: "Supplier performance" },
    { key: "cycle", label: "Cycle times" },
  ];

  var activeSection = "spend";
  var activeDays = "90";
  var spendGroup = "month";

  function money(value) {
    var n = Number(value);
    return isFinite(n) ? n : 0;
  }

  /* A bar chart drawn from plain divs, matching the dashboard's chart so the
     two do not look like different products. */
  function barChart(series, opts) {
    opts = opts || {};
    if (!series.length) {
      return '<div class="empty" style="padding:28px 12px"><p>' + (opts.emptyText || "Nothing recorded in this period.") + "</p></div>";
    }

    var max = Math.max.apply(
      null,
      series.map(function (r) {
        return money(opts.valueOf ? opts.valueOf(r) : r.value);
      })
    );

    // Round the axis up to a clean 4-step maximum so the gridlines land on
    // readable values rather than arbitrary fractions.
    var step = Math.ceil((max || 1) / 4);
    var top = step * 4 || 4;
    var ticks = [top, top - step, top - 2 * step, top - 3 * step, 0];
    var compact = opts.compact !== false;

    var axis = ticks
      .map(function (t) {
        return '<span class="chart-y">' + BOOST.esc(opts.format ? opts.format(t) : String(t)) + "</span>";
      })
      .join("");

    var cols = series
      .map(function (r) {
        var v = money(opts.valueOf ? opts.valueOf(r) : r.value);
        var pct = Math.round((v / top) * 100);
        return (
          '<div class="chart-col">' +
          '<span class="chart-value">' + BOOST.esc(compact ? BOOST.fmtMoneyK(v) : BOOST.fmtMoney(v)) + "</span>" +
          '<div class="chart-bars"><i class="bar" style="height:' + Math.max(pct, 1.5) + '%"></i></div>' +
          '<span class="chart-x">' + BOOST.esc(r.label) + "</span>" +
          "</div>"
        );
      })
      .join("");

    return (
      '<div class="chart-area">' +
      '<div class="chart-axis"><span class="chart-unit">' + BOOST.esc(opts.unit || "Value") + "</span>" + axis + "</div>" +
      '<div class="chart-cols">' + cols + "</div>" +
      "</div>"
    );
  }

  function stat(label, value, sub) {
    return (
      '<div class="fact"><span>' + BOOST.esc(label) + "</span>" +
      '<div class="stat-value">' + value + "</div>" +
      (sub ? '<span class="stat-sub">' + BOOST.esc(sub) + "</span>" : "") +
      "</div>"
    );
  }

  /* ---------------- spend ---------------- */

  function renderSpend(data) {
    var t = data.totals || {};
    var saving = money(t.savings);
    var over = saving < 0;

    var groupPicker =
      '<div class="seg" role="group" aria-label="Group spend by">' +
      [["month", "By month"], ["supplier", "By supplier"], ["request", "By request"]]
        .map(function (g) {
          return (
            '<button type="button" class="seg-btn' + (data.group === g[0] ? " is-active" : "") +
            '" data-group="' + g[0] + '">' + g[1] + "</button>"
          );
        })
        .join("") +
      "</div>";

    return (
      '<section class="card">' +
      '<div class="card-head"><div><h2>Spend analysis</h2>' +
      "<p>Value of awarded bids in the selected period</p></div>" + groupPicker + "</div>" +
      '<div class="card-body">' +
      '<div class="facts report-facts">' +
      stat("Awarded value", BOOST.fmtMoney(t.awarded), (t.awards || 0) + " awards") +
      stat("Original estimates", t.estimated ? BOOST.fmtMoney(t.estimated) : "—", "Linked to requests") +
      stat(
        over ? "Above estimate" : "Saved against estimate",
        BOOST.fmtMoney(Math.abs(saving)),
        (t.savingsPct || 0) + "% " + (over ? "over" : "under")
      ) +
      stat(
        "Average award",
        t.awards ? BOOST.fmtMoney(money(t.awarded) / t.awards) : "—",
        "Per awarded bid"
      ) +
      "</div>" +
      barChart(data.series || [], { unit: "₱", emptyText: "No awards in this period." }) +
      "</div></section>"
    );
  }

  /* ---------------- suppliers ---------------- */

  function renderSuppliers(data) {
    var rows = data.rows || [];
    var t = data.totals || {};

    if (!rows.length) {
      return (
        '<section class="card"><div class="card-head"><div><h2>Supplier performance</h2>' +
        "<p>Who bids, and how often they win</p></div></div>" +
        '<div class="empty"><strong>No supplier bids yet</strong>' +
        "<p>Suppliers appear here once they submit an offer on a bid package.</p></div></section>"
      );
    }

    var maxValue = Math.max.apply(
      null,
      rows.map(function (r) {
        return money(r.awardedValue);
      })
    );

    var body = rows
      .map(function (r) {
        var pct = maxValue ? Math.round((money(r.awardedValue) / maxValue) * 100) : 0;
        return (
          "<tr>" +
          "<td><strong>" + BOOST.esc(r.supplierName) + "</strong>" +
          '<span class="sub">Last bid ' + BOOST.esc(String(r.lastBidAt || "").slice(0, 10) || "—") + "</span></td>" +
          '<td class="num">' + r.submissions + "</td>" +
          '<td class="num">' + r.awards + "</td>" +
          '<td class="num">' + (r.winRate === null ? "—" : r.winRate + "%") + "</td>" +
          '<td class="num">' + BOOST.fmtMoney(r.awardedValue) + "</td>" +
          '<td class="sup-bar"><div class="pipe-track"><div class="pipe-fill" style="width:' +
          Math.max(pct, 2) + '%"></div></div></td>' +
          "</tr>"
        );
      })
      .join("");

    return (
      '<section class="card">' +
      '<div class="card-head"><div><h2>Supplier performance</h2>' +
      "<p>Bid frequency, win rate and awarded value</p></div></div>" +
      '<div class="card-body">' +
      '<div class="facts report-facts">' +
      stat("Suppliers", String(t.suppliers || 0), "In this period") +
      stat("Bids submitted", String(t.submissions || 0), "Across all packages") +
      stat("Overall win rate", (t.winRate || 0) + "%", t.awards + " of " + (t.awards + (t.submissions - t.awards)) + " decided") +
      stat("Top supplier", t.topSupplier || "—", t.topValue ? BOOST.fmtMoney(t.topValue) + " awarded" : "") +
      "</div>" +
      '<div class="table-scroll"><table class="dt-table">' +
      "<thead><tr><th>Supplier</th><th class=\"num\">Bids</th><th class=\"num\">Awards</th>" +
      '<th class="num">Win rate</th><th class="num">Awarded value</th><th></th></tr></thead>' +
      "<tbody>" + body + "</tbody></table></div>" +
      '<p class="report-note">Win rate counts only decided bids, so a supplier who has bid twice and been decided once is not shown as 50% certain.</p>' +
      "</div></section>"
    );
  }

  /* ---------------- cycle times ---------------- */

  function renderCycle(data) {
    var t = data.totals || {};
    var depts = data.departments || [];
    var slowest = t.slowestAwards || [];

    var hours = function (h) {
      var n = money(h);
      if (!n) return "—";
      if (n < 24) return n + "h";
      return Math.round((n / 24) * 10) / 10 + "d";
    };

    var deptBody = depts.length
      ? depts
          .map(function (d) {
            return (
              "<tr>" +
              "<td><strong>" + BOOST.esc(d.department) + "</strong></td>" +
              '<td class="num">' + d.requests + "</td>" +
              '<td class="num">' + BOOST.esc(hours(d.avgHours)) + "</td>" +
              '<td class="num">' + BOOST.esc(hours(d.maxHours)) + "</td>" +
              "</tr>"
            );
          })
          .join("")
      : '<tr><td colspan="4"><div class="empty" style="padding:22px 12px"><p>No approved requests in this period.</p></div></td></tr>';

    var slowBody = slowest.length
      ? slowest
          .map(function (a) {
            return (
              "<tr>" +
              "<td><strong>" + BOOST.esc(a.bidNumber) + "</strong>" +
              '<span class="sub">' + BOOST.esc(a.supplierName) + "</span></td>" +
              '<td class="num">' + BOOST.esc(hours(a.hoursToAward)) + "</td>" +
              "</tr>"
            );
          })
          .join("")
      : '<tr><td colspan="2"><div class="empty" style="padding:22px 12px"><p>No awards in this period.</p></div></td></tr>';

    return (
      '<section class="card">' +
      '<div class="card-head"><div><h2>Cycle times</h2>' +
      "<p>How long work takes, measured from the audit trail</p></div></div>" +
      '<div class="card-body">' +
      '<div class="facts report-facts">' +
      stat("Requests approved", String(t.requestsApproved || 0), "In this period") +
      stat("Avg. approval time", hours(t.avgApprovalHours), "Raised → approved") +
      stat("Slowest department", t.slowestDepartment || "—", "Longest average") +
      stat("Avg. time to award", hours(t.avgAwardHours), (t.awardsDecided || 0) + " bids decided") +
      "</div>" +
      '<h3 class="report-sub">Approval time by department</h3>' +
      '<div class="table-scroll"><table class="dt-table"><thead><tr>' +
      "<th>Department</th><th class=\"num\">Requests</th><th class=\"num\">Average</th><th class=\"num\">Slowest</th>" +
      "</tr></thead><tbody>" + deptBody + "</tbody></table></div>" +
      '<h3 class="report-sub">Slowest bids to award</h3>' +
      '<div class="table-scroll"><table class="dt-table"><thead><tr>' +
      '<th>Bid</th><th class="num">Days open to award</th>' +
      "</tr></thead><tbody>" + slowBody + "</tbody></table></div>" +
      '<p class="report-note">Times come from the activity trail, so they reflect when a change actually happened rather than a stored counter.</p>' +
      "</div></section>"
    );
  }

  /* ---------------- exporting ---------------- */

  /* The payload behind whatever is on screen. Kept so "Download CSV" exports
     exactly the table the user is looking at, rather than a second, subtly
     different query. */
  var lastData = null;

  var SECTION_TITLES = {
    spend: "Spend analysis",
    suppliers: "Supplier performance",
    cycle: "Cycle times",
  };

  function periodLabel() {
    var found = PERIODS.filter(function (p) {
      return p.value === activeDays;
    })[0];
    return found ? found.label : "Last " + activeDays + " days";
  }

  function groupLabel() {
    return {
      month: "grouped by month",
      supplier: "grouped by supplier",
      request: "grouped by request",
    }[spendGroup] || "";
  }

  /* One CSV cell. Anything containing a comma, quote or newline has to be
     quoted, and an embedded quote doubled — otherwise a supplier named
     `Smith, "Bob" Ltd` splits into three columns and shifts every value after
     it. A leading =, +, - or @ is prefixed with a tab so a spreadsheet treats
     it as text rather than a formula. */
  function csvCell(value) {
    if (value === null || value === undefined) return "";
    var text = String(value);
    // Formula-injection guard. A plain negative number starts with "-" too, and
    // tabbing that would make Excel treat it as text and break a SUM down the
    // Amount column — so the guard only fires when the cell is not a number.
    var isFormula = /^[=+@]/.test(text) || (/^-/.test(text) && !/^-?[\d.,]+$/.test(text));
    if (isFormula) text = "\t" + text;
    if (/[",\n\r]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function toCsv(rows) {
    return rows.map(function (r) {
      return r.map(csvCell).join(",");
    }).join("\r\n");
  }

  function filename(ext) {
    var stamp = new Date().toISOString().slice(0, 10);
    return "boost-" + activeSection + "-" + activeDays + "d-" + stamp + "." + ext;
  }

  /* The BOM makes Excel read the file as UTF-8. Without it the peso sign and
     any accented supplier name come through as mojibake. */
  function downloadCsv() {
    if (!lastData) {
      BOOST.toast("The report is still loading.", "warn");
      return;
    }

    var rows = [];

    if (activeSection === "spend") {
      var t = lastData.totals || {};
      rows.push([SECTION_TITLES.spend + " " + groupLabel()]);
      rows.push([periodLabel(), "Generated", new Date().toLocaleString()]);
      rows.push([]);
      rows.push(["Metric", "Value"]);
      rows.push(["Awarded value", t.awarded || 0]);
      rows.push(["Original estimates", t.estimated || 0]);
      rows.push(["Saved against estimate", t.savings || 0]);
      rows.push(["Savings %", t.savingsPct || 0]);
      rows.push(["Awards", t.awards || 0]);
      rows.push([]);
      rows.push(["Group", "Awards", "Value"]);
      (lastData.series || []).forEach(function (s) {
        rows.push([s.label, s.awards, s.value]);
      });
    } else if (activeSection === "suppliers") {
      var st = lastData.totals || {};
      rows.push([SECTION_TITLES.suppliers]);
      rows.push([periodLabel(), "Generated", new Date().toLocaleString()]);
      rows.push([]);
      rows.push(["Metric", "Value"]);
      rows.push(["Suppliers", st.suppliers || 0]);
      rows.push(["Bids submitted", st.submissions || 0]);
      rows.push(["Awards", st.awards || 0]);
      rows.push(["Overall win rate %", st.winRate || 0]);
      rows.push([]);
      rows.push(["Supplier", "Bids", "Awards", "Rejections", "Win rate %", "Awarded value", "Last bid"]);
      (lastData.rows || []).forEach(function (r) {
        rows.push([
          r.supplierName,
          r.submissions,
          r.awards,
          r.rejections,
          r.winRate === null ? "" : r.winRate,
          r.awardedValue,
          r.lastBidAt ? String(r.lastBidAt).slice(0, 10) : "",
        ]);
      });
    } else {
      var ct = lastData.totals || {};
      rows.push([SECTION_TITLES.cycle]);
      rows.push([periodLabel(), "Generated", new Date().toLocaleString()]);
      rows.push([]);
      rows.push(["Metric", "Value"]);
      rows.push(["Requests approved", ct.requestsApproved || 0]);
      rows.push(["Average approval hours", ct.avgApprovalHours || 0]);
      rows.push(["Slowest department", ct.slowestDepartment || ""]);
      rows.push(["Average hours to award", ct.avgAwardHours || 0]);
      rows.push(["Bids decided", ct.awardsDecided || 0]);
      rows.push([]);
      rows.push(["Department", "Requests", "Average hours", "Slowest hours"]);
      (lastData.departments || []).forEach(function (d) {
        rows.push([d.department, d.requests, d.avgHours, d.maxHours]);
      });
      rows.push([]);
      rows.push(["Bid", "Supplier", "Hours open to award"]);
      (ct.slowestAwards || []).forEach(function (a) {
        rows.push([a.bidNumber, a.supplierName, a.hoursToAward]);
      });
    }

    var blob = new Blob(["﻿" + toCsv(rows)], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename("csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Release the blob once the download has been handed to the browser.
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);

    BOOST.toast("Downloaded " + link.download, "ok");
  }

  /* Browsers name the saved file after the document title, so set it for the
     duration of the print and put it back afterwards. */
  function printReport() {
    var previous = document.title;
    document.title = "BOOST " + SECTION_TITLES[activeSection] + " (" + periodLabel() + ")";
    window.addEventListener(
      "afterprint",
      function () {
        document.title = previous;
      },
      { once: true }
    );
    window.print();
  }

  function printHead() {
    return (
      '<div class="print-head">' +
      '<img src="/assets/boost-logo-mark.png" alt="" />' +
      "<h1>" + BOOST.esc(SECTION_TITLES[activeSection]) + "</h1>" +
      '<div class="print-meta">' +
      "<span>" + BOOST.esc(periodLabel()) + "</span>" +
      "<span>Generated " + BOOST.esc(new Date().toLocaleString()) + "</span>" +
      (activeSection === "spend" ? "<span>" + BOOST.esc(groupLabel()) + "</span>" : "") +
      "</div></div>"
    );
  }

  function actions() {
    return (
      '<div class="report-actions">' +
      '<button type="button" class="btn ghost" data-print="1">Print / PDF</button>' +
      '<button type="button" class="btn ghost" data-csv="1">Download CSV</button>' +
      "</div>"
    );
  }

  /* ---------------- shell ---------------- */

  function tabs() {
    return SECTIONS.map(function (s) {
      return (
        '<button type="button" class="tab' + (s.key === activeSection ? " is-active" : "") +
        '" data-section="' + s.key + '">' + s.label + "</button>"
      );
    }).join("");
  }

  function periodPicker() {
    return (
      '<label class="period">Period' +
      '<select class="dt-input" id="period">' +
      PERIODS.map(function (p) {
        return '<option value="' + p.value + '"' + (p.value === activeDays ? " selected" : "") + ">" + p.label + "</option>";
      }).join("") +
      "</select></label>"
    );
  }

  function load() {
    var host = document.getElementById("report-body");
    if (host) {
      host.innerHTML = '<div class="state-msg"><div class="spinner"></div>Building the report…</div>';
      // A stale export is worse than none: the file would not match the table.
      lastData = null;
    }

    var path =
      activeSection === "spend"
        ? "/api/reports/spend?days=" + activeDays + "&group=" + spendGroup
        : activeSection === "suppliers"
          ? "/api/reports/suppliers?days=" + activeDays
          : "/api/reports/cycle-times?days=" + activeDays;

    return BOOST.json(path).then(function (data) {
      if (!host) return;

      if (activeSection === "spend") host.innerHTML = renderSpend(data);
      else if (activeSection === "suppliers") host.innerHTML = renderSuppliers(data);
      else host.innerHTML = renderCycle(data);

      // Cached so "Download CSV" exports exactly what is on screen.
      lastData = data;

      // Group-by buttons live inside the freshly rendered markup.
      host.querySelectorAll("[data-group]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          spendGroup = btn.dataset.group;
          load();
        });
      });
    });
  }

  BOOST.mount(function () {
    BOOST.loading("Building your reports…");

    return Promise.all([BOOST.json("/api/reports/overview?days=" + activeDays)]).then(function (res) {
      var o = res[0];

      document.getElementById("page").innerHTML =
        '<div class="stack">' +
        '<section class="kpi-grid">' +
        '<article class="card kpi">' +
        '<div class="kpi-top"><span>Bid Packages</span><span class="kpi-ico">' + BOOST.icon("bidding", { size: 17 }) + "</span></div>" +
        '<p class="kpi-value">' + BOOST.esc(o.packages || 0) + "</p>" +
        '<div class="kpi-trend"><b>↗</b><span>' + (o.openPackages || 0) + " open now</span></div>" +
        "</article>" +
        '<article class="card kpi">' +
        '<div class="kpi-top"><span>Awarded Value</span><span class="kpi-ico">' + BOOST.icon("wallet", { size: 17 }) + "</span></div>" +
        '<p class="kpi-value">' + BOOST.esc(BOOST.fmtMoneyK(o.awardedValue || 0)) + "</p>" +
        '<div class="kpi-trend"><b>↗</b><span>Last ' + (o.days || 90) + " days</span></div>" +
        "</article>" +
        '<article class="card kpi">' +
        '<div class="kpi-top"><span>Savings vs Estimate</span><span class="kpi-ico">' + BOOST.icon("trophy", { size: 17 }) + "</span></div>" +
        '<p class="kpi-value">' +
        BOOST.esc((o.savings > 0 ? "▼ " : o.savings < 0 ? "▲ " : "") + BOOST.fmtMoneyK(Math.abs(o.savings || 0))) +
        "</p>" +
        '<div class="kpi-trend' + (Number(o.savings || 0) < 0 ? " down" : "") + '"><b>' +
        (Number(o.savings || 0) < 0 ? "▼" : "↗") + "</b><span>" + (o.savingsPct || 0) + "% against estimate</span></div>" +
        "</article>" +
        '<article class="card kpi">' +
        '<div class="kpi-top"><span>Avg. Approval Time</span><span class="kpi-ico">' + BOOST.icon("calendar", { size: 17 }) + "</span></div>" +
        '<p class="kpi-value">' +
        BOOST.esc(o.avgApprovalHours ? (o.avgApprovalHours < 24 ? o.avgApprovalHours + "h" : Math.round((o.avgApprovalHours / 24) * 10) / 10 + "d") : "—") +
        "</p>" +
        '<div class="kpi-trend"><b>↗</b><span>Raised → approved</span></div>' +
        "</article>" +
        "</section>" +
        printHead() +
        '<section class="card report-shell">' +
        '<div class="card-head report-head"><div>' +
        '<div class="tabs" role="tablist">' + tabs() + "</div>" +
        "</div>" + periodPicker() + actions() + "</div>" +
        '<div id="report-body"></div>' +
        "</section>" +
        '<section class="card">' +
        '<div class="card-head"><div><h2>Waiting on someone</h2>' +
        "<p>Open work across the modules</p></div></div>" +
        '<div class="card-body"><div class="facts report-facts">' +
        stat("Pending requests", String(o.pendingRequests || 0), "Awaiting approval") +
        stat("Active quotations", String(o.activeQuotations || 0), "Out to suppliers") +
        stat("Open bid packages", String(o.openBids || 0), "Accepting offers") +
        stat("Submissions", String(o.submissions || 0), "In this period") +
        "</div></div>" +
        "</section>" +
        "</div>";

      // Tabs and the period picker are re-bound after every render because the
      // report body is replaced wholesale.
      function bind() {
        document.querySelectorAll("[data-section]").forEach(function (btn) {
          btn.addEventListener("click", function () {
            activeSection = btn.dataset.section;
            document.querySelectorAll("[data-section]").forEach(function (b) {
              b.classList.toggle("is-active", b === btn);
            });
            load();
          });
        });

        var period = document.getElementById("period");
        if (period) {
          period.addEventListener("change", function () {
            activeDays = period.value;
            load();
          });
        }
      }

      // Delegated: the action buttons sit inside the card head, which survives
      // a report swap but is not rebuilt, so binding once is enough.
      document.addEventListener("click", function (e) {
        if (e.target.closest("[data-print]")) {
          e.preventDefault();
          printReport();
        } else if (e.target.closest("[data-csv]")) {
          e.preventDefault();
          downloadCsv();
        }
      });

      bind();
      return load();
    });
  });
})();