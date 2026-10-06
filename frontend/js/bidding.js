/* BOOST — Bidding Records: bid packages, competing supplier submissions and
   award decisions.

   The list is one row per package (a procurement opportunity), not per bid.
   A buyer thinks in terms of "the bid for the laptops", and the number of
   offers, the range and the winner are all facts about that package — so they
   are aggregated by the server and shown on the row itself. */
(function () {
  "use strict";

  var table;

  var BID_STATUSES = ["draft", "open", "closed", "awarded", "cancelled"];

  /* Package statuses are 'open' while accepting offers and 'awarded' once a
     supplier has won. The list filter uses the same words. */

  function money(value) {
    var n = Number(value);
    return isFinite(n) ? n : 0;
  }

  /* A package with no submissions yet has nothing to award, so it says so
     rather than showing a zero-value "award". */
  function awardCell(row) {
    if (row.awardedValue === null || row.awardedValue === undefined) {
      return '<span class="muted-note">Not awarded</span>';
    }
    return (
      BOOST.fmtMoney(row.awardedValue) +
      (row.awardedSupplier ? '<span class="sub">' + BOOST.esc(row.awardedSupplier) + "</span>" : "")
    );
  }

  function savingsNote(row) {
    // Without an estimate there is nothing to compare the award against, so
    // the range is shown on its own.
    if (row.estimatedAmount === null || row.estimatedAmount === undefined) return "";
    var est = money(row.estimatedAmount);
    var won = money(row.awardedValue);
    if (!est || !won) return "";
    var diff = est - won;
    var cls = diff > 0 ? "is-good" : diff < 0 ? "is-over" : "";
    return (
      '<span class="delta ' + cls + '">' +
      (diff > 0 ? "▼ " : diff < 0 ? "▲ " : "") +
      BOOST.fmtMoney(Math.abs(diff)) +
      "</span>"
    );
  }

  /* ---------------- detail drawer ---------------- */

  function submissionRows(submissions) {
    if (!submissions.length) {
      return (
        '<div class="empty" style="padding:24px 12px">' +
        "<strong>No bids yet</strong><p>Supplier offers on this package will appear here.</p></div>"
      );
    }

    var lowest = Math.min.apply(
      null,
      submissions.map(function (s) {
        return money(s.totalAmount);
      })
    );

    return submissions
      .map(function (s) {
        var isLowest = money(s.totalAmount) === lowest && s.status !== "withdrawn";
        return (
          '<tr' + (s.status === "awarded" ? ' class="row-won"' : "") + ">" +
          "<td><strong>" + BOOST.esc(s.supplierName) + "</strong>" +
          (isLowest ? '<span class="tag-low">Lowest</span>' : "") +
          "</td>" +
          '<td class="num">' + BOOST.fmtMoney(s.totalAmount) + "</td>" +
          "<td>" + BOOST.badge(s.status) + "</td>" +
          '<td class="num">' + BOOST.fmtDate(s.submittedAt) + "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  /* A submission gets its own actions, because awarding one is the decision
     this module exists to record. */
  function submissionActions(submission) {
    var opts = {
      submitted: ["awarded", "rejected", "withdrawn"],
      awarded: [],
      rejected: [],
      withdrawn: [],
    }[submission.status] || [];

    if (!opts.length) return "";

    return (
      '<div class="sub-actions">' +
      opts
        .map(function (next) {
          var cls = next === "awarded" ? "btn" : "btn ghost";
          return (
            '<button type="button" class="' + cls + '" data-sub-status="' + next +
            '" data-sub-id="' + submission.id + '">' +
            (next === "awarded" ? "Award" : BOOST.label(next)) +
            "</button>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function openBid(id, el, row) {
    if (!row) return;

    BOOST.loading("Loading the bidding record…");

    return BOOST.json("/api/bids/" + id).then(function (data) {
      var bid = data.bid;
      var subs = data.submissions || [];

      /* Only an open package can take new offers — the same rule the server
         enforces, mirrored here so the form is not offered and then refused. */
      var canSubmit = bid.status === "open";

      var body =
        '<div class="facts">' +
        fact("Status", BOOST.badge(bid.status)) +
        fact("Opened", BOOST.fmtDate(bid.openedAt)) +
        fact("Closed", BOOST.fmtDate(bid.closedAt)) +
        fact("Submissions", String(subs.length)) +
        fact("Lowest offer", subs.length ? BOOST.fmtMoney(Math.min.apply(null, subs.map(function (s) { return money(s.totalAmount); }))) : "—") +
        fact("Awarded", bid.status === "awarded" && subs.filter(function (s) { return s.status === "awarded"; }).length
          ? BOOST.fmtMoney(subs.filter(function (s) { return s.status === "awarded"; })[0].totalAmount) +
            " · " + BOOST.esc(subs.filter(function (s) { return s.status === "awarded"; })[0].supplierName)
          : "Not awarded") +
        fact("Linked request", bid.requestNumber ? BOOST.esc(bid.requestNumber) : "Not linked") +
        fact("Estimate", bid.estimatedAmount ? BOOST.fmtMoney(bid.estimatedAmount) : "—") +
        "</div>" +
        (bid.notes ? '<div class="drawer-section"><h3>Notes</h3><p class="drawer-text">' + BOOST.esc(bid.notes) + "</p></div>" : "") +
        '<div class="drawer-section"><h3>Supplier bids</h3>' +
        (subs.length
          ? '<div class="table-scroll"><table class="dt-table sub-table"><thead><tr>' +
            "<th>Supplier</th><th class=\"num\">Amount</th><th>Status</th><th class=\"num\">Submitted</th>" +
            "</tr></thead><tbody>" + submissionRows(subs) + "</tbody></table></div>"
          : '<div class="empty" style="padding:20px 12px"><p>No supplier bids recorded yet.</p></div>') +
        "</div>";

      /* Offer capture for an open package. */
      if (canSubmit) {
        body +=
          '<div class="drawer-section"><h3>Record a supplier bid</h3>' +
          '<form class="sub-form" id="sub-form">' +
          '<div class="sub-grid">' +
          '<label>Supplier<input type="text" id="supplierName" required placeholder="Supplier name" /></label>' +
          '<label>Amount<input type="number" id="totalAmount" min="0" step="0.01" required placeholder="0.00" /></label>' +
          "</div>" +
          '<label>Notes<input type="text" id="subNotes" placeholder="Optional" /></label>' +
          '<button type="submit" class="btn">Record bid</button>' +
          "</form></div>";
      }

      var layer = BOOST.moduleDrawer({
        entity: "bid",
        row: bid,
        title: bid.bidNumber,
        onChanged: function () {
          table.refresh();
          BOOST.refreshBadges();
        },
        body: body,
      });

      /* moduleDrawer renders the status buttons from the server's allowed
         moves. Close the layer and reopen after any change so the submission
         table reflects the new award rather than going stale behind the
         drawer. */
      layer.querySelectorAll("[data-next]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var needsNote = btn.dataset.note === "1";
          var reason = "";
          if (needsNote) {
            reason =
              window.prompt("Reason for cancelling this bid (required):", "") || "";
            if (!reason.trim()) {
              BOOST.toast("A reason is required to cancel a bid.", "warn");
              return;
            }
          }
          btn.disabled = true;
          closeThen(function () {
            fetch("/api/bids/" + bid.id + "/status", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ status: btn.dataset.next, note: reason.trim() }),
            })
              .then(function (res) {
                return res.json().then(function (b) {
                  return { ok: res.ok, body: b };
                });
              })
              .then(function (res) {
                if (!res.ok) throw new Error(res.body.error || "Could not update.");
                BOOST.toast(res.body.message || "Updated.", "ok");
                table.refresh();
                BOOST.refreshBadges();
                // Reopen on the same record so the drawer reflects the change.
                BOOST.closeDrawer();
                openBid(bid.id, null, { id: bid.id });
              })
              .catch(function (err) {
                BOOST.toast(err.message, "warn");
                btn.disabled = false;
              });
          });
        });
      });

      function closeThen(fn) {
        BOOST.closeDrawer();
        fn();
      }

      /* Award / reject / withdraw on an individual submission. */
      layer.querySelectorAll("[data-sub-status]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var next = btn.dataset.subStatus;
          var subId = btn.dataset.subId;

          var note = "";
          if (next === "rejected") {
            note = window.prompt("Why is this bid being rejected?", "") || "";
          }

          btn.disabled = true;
          fetch("/api/bids/" + bid.id + "/submissions/" + subId + "/status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ status: next, note: note }),
          })
            .then(function (res) {
              return res.json().then(function (b) {
                return { ok: res.ok, body: b };
              });
            })
            .then(function (res) {
              if (!res.ok) throw new Error(res.body.error || "Could not update.");
              BOOST.toast(res.body.message || "Updated.", "ok");
              table.refresh();
              BOOST.refreshBadges();
              // Reopen so the award shows in the table immediately.
              BOOST.closeDrawer();
              openBid(bid.id, null, { id: bid.id });
            })
            .catch(function (err) {
              BOOST.toast(err.message, "warn");
              btn.disabled = false;
            });
        });
      });

      /* Record a new supplier offer. */
      var form = layer.querySelector("#sub-form");
      if (form) {
        form.addEventListener("submit", function (e) {
          e.preventDefault();

          var supplier = layer.querySelector("#supplierName").value.trim();
          var amount = Number(layer.querySelector("#totalAmount").value);
          var notes = layer.querySelector("#subNotes").value.trim();

          if (!supplier) {
            BOOST.toast("Enter a supplier name.", "warn");
            return;
          }
          if (!isFinite(amount) || amount < 0) {
            BOOST.toast("Enter a bid amount of zero or more.", "warn");
            return;
          }

          var submit = form.querySelector('button[type="submit"]');
          submit.disabled = true;

          fetch("/api/bids/" + bid.id + "/submissions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ supplierName: supplier, totalAmount: amount, notes: notes }),
          })
            .then(function (res) {
              return res.json().then(function (b) {
                return { ok: res.ok, body: b };
              });
            })
            .then(function (res) {
              if (!res.ok) throw new Error(res.body.error || "Could not record that bid.");
              BOOST.toast(res.body.message || "Bid recorded.", "ok");
              table.refresh();
              BOOST.closeDrawer();
              openBid(bid.id, null, { id: bid.id });
            })
            .catch(function (err) {
              BOOST.toast(err.message, "warn");
              submit.disabled = false;
            });
        });
      }

      return layer;
    });
  }

  function fact(label, value) {
    return '<div class="fact"><span>' + BOOST.esc(label) + "</span><div>" + value + "</div></div>";
  }

  /* ---------------- KPI strip ---------------- */

  function kpiMarkup(a) {
    return (
      kpi("Open Packages", "bidding", a.openPackages || 0, (a.packages || 0) + " packages in total", false, "/bidding?status=open") +
      kpi("Awarded Value", "wallet", BOOST.fmtMoneyK(a.awardedValue), (a.awardedLast30d || 0) + " awards in last 30 days", false, "/bidding?status=awarded") +
      kpi("Savings vs Estimate", "trophy",
          (a.savings > 0 ? "▼ " : a.savings < 0 ? "▲ " : "") + BOOST.fmtMoneyK(Math.abs(a.savings || 0)),
          (a.savingsPct || 0) + "% against estimate", Number(a.savings || 0) < 0, "/bidding?status=awarded") +
      kpi("Suppliers", "users", a.suppliers || 0, (a.submissions || 0) + " bids submitted", false, "/bidding")
    );
  }

  /* The data table owns #page and rewrites it wholesale on every paint, so the
     KPI strip cannot simply live above it — it would be destroyed. Instead it is
     re-inserted as the first child of the table's stack on each render, which
     keeps it in place across filters, sorting and paging.

     `latestSummary` is module state rather than the value captured when the
     page loaded: onLoaded fires after every list render, so a strip repainted
     from a captured copy would show the figures from first load, silently undo
     every refresh. */
  var latestSummary = null;

  function paintKpis(a) {
    var summary = a || latestSummary;
    var stack = document.getElementById("dt-stack");
    if (!stack || !summary) return;

    var host = document.getElementById("bid-kpis");
    if (!host) {
      host = document.createElement("section");
      host.id = "bid-kpis";
      host.className = "kpi-grid";
      stack.insertBefore(host, stack.firstChild);
    }
    host.innerHTML = kpiMarkup(summary);
  }

  function loadKpis() {
    return BOOST.json("/api/bids/analytics/summary").then(function (a) {
      latestSummary = a;
      paintKpis(a);
      return a;
    });
  }

  /* ---------------- new package ---------------- */

  function newBidDrawer() {
    // Requests that are still live are the sensible ones to bid against: a
    // completed or cancelled request has nothing left to source.
    return BOOST.json("/api/requests?limit=50")
      .catch(function () {
        return { requests: [] };
      })
      .then(function (data) {
        // Only live requests make sense to bid against: a completed or
        // cancelled request has nothing left to source. Filtered here because
        // the API takes a single status and this is only a convenience list.
        var options = (data.requests || [])
          .filter(function (r) {
            return ["pending", "approved", "in_progress"].indexOf(r.status) !== -1;
          })
          .map(function (r) {
            return (
              '<option value="' + r.id + '">' +
              BOOST.esc(r.requestNumber + " · " + r.department + " · " + BOOST.fmtMoney(r.estimatedAmount)) +
              "</option>"
            );
          })
          .join("");

        var layer = BOOST.openDrawer(
          "New bid package",
          '<form class="sub-form" id="new-bid-form">' +
            "<label>Title<input type=\"text\" id=\"bidTitle\" maxlength=\"200\" required placeholder=\"What is being bid for?\" /></label>" +
            '<label>Link to a request' +
            '<select id="bidRequest"><option value="">Not linked</option>' + options + "</select></label>" +
            "<label>Notes<input type=\"text\" id=\"bidNotes\" maxlength=\"500\" placeholder=\"Optional\" /></label>" +
            '<p class="form-note">A package starts as a draft. Open it to start accepting supplier offers.</p>' +
            '<button type="submit" class="btn">Create package</button>' +
            "</form>"
        );

        var form = layer.querySelector("#new-bid-form");
        var title = layer.querySelector("#bidTitle");
        if (title) title.focus();

        form.addEventListener("submit", function (e) {
          e.preventDefault();

          var value = title.value.trim();
          if (!value) {
            BOOST.toast("Give the package a title.", "warn");
            return;
          }

          var submit = form.querySelector('button[type="submit"]');
          submit.disabled = true;

          fetch("/api/bids", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              title: value,
              requestId: Number(layer.querySelector("#bidRequest").value) || null,
              notes: layer.querySelector("#bidNotes").value.trim() || null,
            }),
          })
            .then(function (res) {
              return res.json().then(function (b) {
                return { ok: res.ok, body: b };
              });
            })
            .then(function (res) {
              if (!res.ok) throw new Error(res.body.error || "Could not create that package.");
              BOOST.toast(res.body.message || "Bid package created.", "ok");
              BOOST.closeDrawer();
              table.refresh();
              BOOST.refreshBadges();
              // Straight into the new package so offers can start arriving.
              openBid(res.body.bid.id, null, { id: res.body.bid.id });
            })
            .catch(function (err) {
              BOOST.toast(err.message, "warn");
              submit.disabled = false;
            });
        });

        return layer;
      });
  }

  /* ---------------- page ---------------- */

  BOOST.mount(function () {
    BOOST.loading("Loading bidding records…");

    return loadKpis().then(function (a) {
      table = BOOST.dataTable({
        endpoint: "/api/bids",
        // Named rather than left to the shape heuristic: this endpoint returns
        // its collection under `bids`, and being explicit keeps the list honest
        // if another array is ever added to the payload.
        rowsKey: "bids",
        emptyText: "No bidding records match these filters.",
        onRowClick: openBid,
        toolbarActions:
          '<button class="btn" type="button" data-new-bid="1">New bid package</button>',
        onLoaded: function () {
          // Re-attach the strip the table's own render just removed, using the
          // latest figures rather than the ones from first load.
          paintKpis();
        },
        filters: [
          { id: "q", type: "search", placeholder: "Search bid number, title…" },
          BOOST.statusFilter(BID_STATUSES),
        ],
        columns: [
          {
            key: "bidNumber",
            label: "Bid",
            render: function (r) {
              return (
                "<strong>" + BOOST.esc(r.bidNumber) + "</strong>" +
                '<span class="sub">' + BOOST.esc(r.title) + "</span>"
              );
            },
          },
          {
            key: "submissionCount",
            label: "Bids",
            cls: "num",
            render: function (r) {
              return r.submissionCount || 0;
            },
          },
          {
            key: "lowestBid",
            label: "Lowest",
            cls: "num",
            render: function (r) {
              return r.submissionCount ? BOOST.fmtMoney(r.lowestBid) : "—";
            },
          },
          {
            key: "highestBid",
            label: "Highest",
            cls: "num",
            render: function (r) {
              if (!r.submissionCount) return "—";
              // A single offer is its own low and high, so showing the same
              // number twice reads as two bids that never existed.
              return r.submissionCount === 1 ? "—" : BOOST.fmtMoney(r.highestBid);
            },
          },
          { key: "awardedValue", label: "Awarded", cls: "num", render: awardCell },
          { key: "status", label: "Status", render: function (r) { return BOOST.badge(r.status); } },
        ],
        card: function (r) {
          return (
            '<div class="dc-top"><strong>' + BOOST.esc(r.bidNumber) + "</strong>" + BOOST.badge(r.status) + "</div>" +
            '<div class="dc-desc">' + BOOST.esc(r.title) + "</div>" +
            '<dl class="dc-facts">' +
            "<div><dt>Bids</dt><dd>" + (r.submissionCount || 0) + "</dd></div>" +
            "<div><dt>Range</dt><dd>" + (r.submissionCount ? BOOST.fmtMoney(r.lowestBid) : "—") + "</dd></div>" +
            "<div><dt>Awarded</dt><dd>" + (r.awardedValue != null ? BOOST.fmtMoney(r.awardedValue) : "—") + "</dd></div>" +
            "<div><dt>Saving</dt><dd>" + (savingsNote(r) || "—") + "</dd></div>" +
            "</dl>"
          );
        },
      });

      // Delegated: the table rewrites its own filter bar on paint, so a
      // directly-bound listener would be lost with it.
      document.addEventListener("click", function (e) {
        if (e.target.closest("[data-new-bid]")) {
          e.preventDefault();
          newBidDrawer();
        }
      });

      // Every list reload refreshes the headline figures too, so an award made
      // in a drawer moves the tiles and the list in the same paint.
      var originalRefresh = table.refresh;
      table.refresh = function () {
        return loadKpis().then(function () {
          return originalRefresh();
        });
      };
    });
  });

  function kpi(label, icon, value, trend, down, href) {
    var inner =
      '<div class="kpi-top"><span>' + BOOST.esc(label) + "</span>" +
      '<span class="kpi-ico">' + BOOST.icon(icon, { size: 17 }) + "</span></div>" +
      '<p class="kpi-value">' + BOOST.esc(value) + "</p>" +
      '<div class="kpi-trend' + (down ? " down" : "") + '"><b>' + (down ? "▼" : "↗") + "</b><span>" + BOOST.esc(trend) + "</span></div>";

    return href
      ? '<a class="card kpi kpi-link" href="' + BOOST.esc(href) + '">' + inner + "</a>"
      : '<article class="card kpi">' + inner + "</article>";
  }
})();