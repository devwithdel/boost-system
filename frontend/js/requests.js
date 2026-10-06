/* BOOST — Procurement Requests: sortable/paged table, bulk actions and a
   detail drawer with status transitions + audit trail. */
(function () {
  "use strict";

  var STATUSES = ["", "pending", "approved", "in_progress", "completed", "cancelled"];
  var table;

  BOOST.mount(function () {
    table = BOOST.dataTable({
      endpoint: "/api/requests",
      pageSize: 25,
      selectable: true,
      emptyText: "No procurement requests match these filters.",
      bulkActions: [
        { value: "approved", label: "Approve selected" },
        { value: "completed", label: "Mark completed" },
        // Spelled out rather than "Cancel…": the ellipsis read as clipped text,
        // and a bare "Cancel" next to the row's Clear button was ambiguous.
        { value: "cancelled", label: "Cancel selected", requiresNote: true },
      ],
      onRowClick: openRequest,
      // In the filter bar rather than a floating button: on a phone the FAB
      // covered the pager's Next button and could not be scrolled clear.
      toolbarActions:
        '<a class="btn ghost" href="/scanner">' +
        BOOST.icon("scanner", { size: 16 }) +
        "<em>Scan document</em></a>",
      filters: [
        { id: "q", type: "search", placeholder: "Search number, item, requester…" },
        BOOST.statusFilter(STATUSES),
        {
          id: "department",
          type: "select",
          options: function (data) {
            return [{ value: "", label: "All departments" }].concat(
              (data && data.departments ? data.departments : []).map(function (d) {
                return { value: d, label: d };
              })
            );
          },
        },
      ],
      columns: [
        {
          key: "requestNumber",
          label: "Request",
          render: function (r) {
            return "<strong>" + esc(r.requestNumber) + '</strong><span class="sub">' + esc(r.description) + "</span>";
          },
        },
        { key: "requesterName", label: "Requester", render: function (r) { return esc(r.requesterName); } },
        { key: "department", label: "Department", render: function (r) { return esc(r.department); } },
        { key: "quantity", label: "Items", cls: "num", render: function (r) { return Number(r.quantity) || 0; } },
        { key: "estimatedAmount", label: "Estimated value", cls: "num", render: function (r) { return BOOST.fmtMoney(r.estimatedAmount); } },
        { key: "dueDate", label: "Due", cls: "num", render: function (r) { return BOOST.fmtDate(r.dueDate); } },
        { key: "status", label: "Status", render: function (r) { return BOOST.badge(r.status); } },
      ],
      // Badges come from layout.js (/api/nav-counts) so every page agrees.
      onLoaded: function () {
        BOOST.refreshBadges();
      },
      /* Mobile card (no horizontal scrolling on a phone). */
      card: function (r) {
        return (
          '<div class="dc-top"><strong>' + esc(r.requestNumber) + "</strong>" + BOOST.badge(r.status) + "</div>" +
          '<div class="dc-desc">' + esc(r.description) + "</div>" +
          '<dl class="dc-facts">' +
          "<div><dt>Requester</dt><dd>" + esc(r.requesterName) + "</dd></div>" +
          "<div><dt>Department</dt><dd>" + esc(r.department) + "</dd></div>" +
          "<div><dt>Value</dt><dd>" + BOOST.fmtMoney(r.estimatedAmount) + "</dd></div>" +
          "<div><dt>Due</dt><dd>" + BOOST.fmtDate(r.dueDate) + "</dd></div>" +
          "</dl>"
        );
      },
    });
  });

  function attachmentsSection(payload) {
    var files = payload.attachments || [];
    var id = payload.request.id;

    var body = files.length
      ? '<div class="attach-grid">' +
        files
          .map(function (f) {
            var url = "/api/requests/" + id + "/attachments/" + f.id + "/file";
            return (
              '<a class="attach" href="' + url + '" target="_blank" rel="noopener">' +
              '<img src="' + url + '" alt="' + esc(f.fileName) + '" loading="lazy" />' +
              '<span>' + (f.source === "scan" ? BOOST.icon("scanner", { size: 12 }) + " Scan" : BOOST.icon("image", { size: 12 }) + " Upload") +
              " · " + esc(f.fileName) + "</span>" +
              "</a>"
            );
          })
          .join("") +
        "</div>"
      : '<p class="muted-note">No scans or files attached yet.</p>';

    return (
      '<div class="drawer-section"><h3>Evidence</h3>' + body +
      '<label class="btn ghost attach-upload">' + BOOST.icon("plus", { size: 15 }) + " Attach image<input type=" + '"file"' +
      " accept=" + '"image/*"' + " hidden /></label>" +
      "</div>"
    );
  }

  function openRequest(id) {
    BOOST.json("/api/requests/" + id)
      .then(renderDrawer)
      .catch(function (err) {
        BOOST.toast(err.message, "warn");
      });
  }

  function renderDrawer(payload) {
    var r = payload.request;
    var events = payload.events || [];

    var facts = [
      ["Status", BOOST.badge(r.status)],
      ["Requester", esc(r.requesterName)],
      ["Department", esc(r.department)],
      ["Quantity", Number(r.quantity) || 0],
      ["Estimated value", BOOST.fmtMoney(r.estimatedAmount)],
      ["Due date", BOOST.fmtDate(r.dueDate)],
      ["Raised", BOOST.fmtDate(r.requestedAt)],
      ["Raised by", esc(r.createdBy || "Unknown")],
      ["Approved by", r.approvedBy ? esc(r.approvedBy) + " · " + BOOST.fmtDate(r.approvedAt) : "Not approved yet"],
    ];

    var actions = (payload.allowedNext || [])
      .map(function (next) {
        return (
          '<button type="button" class="btn ' + (next === "cancelled" ? "ghost danger" : "") + '" data-next="' +
          next + '" data-note="' + (next === "cancelled" ? "1" : "0") + '">Mark ' + BOOST.label(next) + "</button>"
        );
      })
      .join("");

    var timeline = events.length
      ? events
          .map(function (e) {
            return (
              '<li class="tl-item"><span class="tl-dot"></span>' +
              "<div><strong>" + esc(BOOST.label(e.toStatus || e.action)) + "</strong>" +
              "<span>" + esc(e.actorName || "System") + " · " + BOOST.fmtDate(e.createdAt) + "</span>" +
              (e.note ? '<em>"' + esc(e.note) + '"</em>' : "") +
              "</div></li>"
            );
          })
          .join("")
      : '<li class="tl-item tl-empty">No activity recorded yet.</li>';

    BOOST.openDrawer(
      r.requestNumber,
      '<div class="facts">' +
        facts.map(function (f) {
          return '<div class="fact"><span>' + esc(f[0]) + "</span><div>" + f[1] + "</div></div>";
        }).join("") +
      "</div>" +
      '<div class="drawer-section"><h3>Item</h3><p class="drawer-text">' + esc(r.description) + "</p></div>" +
      (attachmentsSection(payload) || "") +
      (actions ? '<div class="drawer-actions">' + actions + "</div>" : '<p class="muted-note">No further actions available for this status.</p>') +
      '<div class="drawer-section"><h3>Activity</h3><ul class="timeline">' + timeline + "</ul></div>",
      function (layer) {
        layer.querySelectorAll("[data-next]").forEach(function (btn) {
          btn.addEventListener("click", function () {
            var note = "";
            if (btn.dataset.note === "1") {
              note = window.prompt("Reason for cancelling (required):", "") || "";
              if (!note.trim()) {
                BOOST.toast("A reason is required to cancel a request.", "warn");
                return;
              }
            }
            btn.disabled = true;
            changeStatus(r.id, btn.dataset.next, note.trim(), btn);
          });
        });

        var upload = layer.querySelector(".attach-upload input");
        if (upload) {
          upload.addEventListener("change", function () {
            var file = upload.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function () {
              fetch("/api/requests/" + r.id + "/attachments", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ image: reader.result, fileName: file.name }),
              })
                .then(function (res) {
                  return res.json().then(function (b) {
                    return { ok: res.ok, body: b };
                  });
                })
                .then(function (res) {
                  if (!res.ok) throw new Error(res.body.error || "Upload failed.");
                  BOOST.toast("Attached " + file.name, "ok");
                  openRequest(r.id); // reopen to refresh the evidence grid
                })
                .catch(function (err) {
                  BOOST.toast(err.message, "warn");
                });
            };
            reader.onerror = function () { BOOST.toast("Could not read that file.", "warn"); };
            reader.readAsDataURL(file);
          });
        }
      }
    );
  }

  /* Phase 5: paint the new status immediately, then reconcile with the
     server. If the call fails the badge snaps back and we explain why. */
  function changeStatus(id, status, note, btn) {
    var previous = optimisticStatus(id, status);
    BOOST.closeDrawer();
    if (btn) btn.disabled = true;

    fetch("/api/requests/" + id + "/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ status: status, note: note }),
    })
      .then(function (res) {
        return res.json().then(function (b) {
          return { ok: res.ok, body: b };
        });
      })
      .then(function (res) {
        if (!res.ok) throw new Error(res.body.error || "Could not update.");
        BOOST.toast(res.body.message || "Updated.", "ok");
        return table.refresh();
      })
      .catch(function (err) {
        optimisticStatus(id, previous); // roll back the badge
        BOOST.toast(err.message, "warn");
        if (btn) btn.disabled = false;
      });
  }

  /** Returns the status before the change so callers can revert. */
  function optimisticStatus(id, status) {
    var badgeEl = document.querySelector('[data-row-id="' + id + '"] .badge');
    var previous = badgeEl ? badgeEl.textContent : "";
    if (badgeEl) {
      badgeEl.textContent = BOOST.label(status);
      badgeEl.className = "badge " + status + " pending-change";
    }
    return previous;
  }

  function esc(v) {
    return BOOST.esc(v);
  }
})();