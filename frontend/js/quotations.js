/* BOOST — Quotations: sortable, paged list with status workflow + history. */
(function () {
  "use strict";

  var table;

  function facts(items) {
    return (
      '<div class="facts">' +
      items
        .map(function (f) {
          return '<div class="fact"><span>' + BOOST.esc(f[0]) + "</span><div>" + f[1] + "</div></div>";
        })
        .join("") +
      "</div>"
    );
  }

  // Percentage of an estimate saved by awarding below it. Only meaningful when
  // there is an estimate to compare against, hence the guard.
  function savingPct(estimated, awarded) {
    var est = Number(estimated);
    var won = Number(awarded);
    if (!est || !won || won > est) return "";
    var pct = Math.round(((est - won) / est) * 100);
    return pct > 0 ? pct + "% below estimate" : "";
  }

  // onRowClick(id, element, row) — the record comes with the click.
  function openQuotation(id, el, row) {
    if (!row) return;
    BOOST.moduleDrawer({
      entity: "quotation",
      row: row,
      title: row.quotationNumber,
      onChanged: function () {
        table.refresh();
      },
      body:
        facts([
          ["Status", BOOST.badge(row.status)],
          ["Supplier", BOOST.esc(row.supplierName)],
          ["Value", BOOST.fmtMoney(row.totalAmount)],
          [
            "Against estimate",
            row.estimatedAmount
              ? BOOST.fmtMoney(row.estimatedAmount) +
                (savingPct(row.estimatedAmount, row.totalAmount) ? " · " + savingPct(row.estimatedAmount, row.totalAmount) : "")
              : "No linked request",
          ],
          ["Valid until", BOOST.fmtDate(row.validUntil)],
          ["Raised", BOOST.fmtDate(row.createdAt)],
          ["Linked request", row.requestNumber ? BOOST.esc(row.requestNumber) : "Not linked"],
        ]) +
        '<div class="drawer-section"><h3>Item</h3><p class="drawer-text">' + BOOST.esc(row.description) + "</p></div>" +
        (row.requestNumber
          ? '<div class="drawer-actions"><a class="btn ghost" href="/requests?q=' + encodeURIComponent(row.requestNumber) + '">View linked request</a></div>'
          : ""),
    });
  }

  BOOST.mount(function () {
    table = BOOST.dataTable({
      endpoint: "/api/quotations",
      emptyText: "No quotations match these filters.",
      onRowClick: openQuotation,
      filters: [
        { id: "q", type: "search", placeholder: "Search number, supplier, item…" },
        BOOST.statusFilter(["draft", "active", "awarded", "expired", "cancelled"]),
      ],
      columns: [
        {
          key: "quotationNumber",
          label: "Quotation",
          render: function (r) {
            return "<strong>" + BOOST.esc(r.quotationNumber) + '</strong><span class="sub">' + BOOST.esc(r.requestNumber || "No linked request") + "</span>";
          },
        },
        { key: "supplierName", label: "Supplier", render: function (r) { return BOOST.esc(r.supplierName); } },
        { key: "totalAmount", label: "Value", cls: "num", render: function (r) { return BOOST.fmtMoney(r.totalAmount); } },
        { key: "validUntil", label: "Valid until", cls: "num", render: function (r) { return BOOST.fmtDate(r.validUntil); } },
        { key: "status", label: "Status", render: function (r) { return BOOST.badge(r.status); } },
      ],
      card: function (r) {
        return (
          '<div class="dc-top"><strong>' + BOOST.esc(r.quotationNumber) + "</strong>" + BOOST.badge(r.status) + "</div>" +
          '<div class="dc-desc">' + BOOST.esc(r.supplierName) + "</div>" +
          '<dl class="dc-facts">' +
          "<div><dt>Value</dt><dd>" + BOOST.fmtMoney(r.totalAmount) + "</dd></div>" +
          "<div><dt>Valid until</dt><dd>" + BOOST.fmtDate(r.validUntil) + "</dd></div>" +
          "</dl>"
        );
      },
    });
  });
})();