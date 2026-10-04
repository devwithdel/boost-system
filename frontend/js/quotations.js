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
        {
          id: "status",
          type: "select",
          options: ["", "draft", "active", "awarded", "expired", "cancelled"].map(function (s) {
            return { value: s, label: s ? BOOST.label(s) : "All statuses" };
          }),
        },
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