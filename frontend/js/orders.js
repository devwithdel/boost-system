/* BOOST — Purchase Orders: sortable, paged list with status workflow + history. */
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
  function openOrder(id, el, row) {
    if (!row) return;
    BOOST.moduleDrawer({
      entity: "order",
      row: row,
      title: row.orderNumber,
      onChanged: function () {
        table.refresh();
      },
      body:
        facts([
          ["Status", BOOST.badge(row.status)],
          ["Supplier", BOOST.esc(row.supplierName)],
          ["Value", BOOST.fmtMoney(row.totalAmount)],
          ["Ordered", BOOST.fmtDate(row.orderedAt)],
          ["Expected delivery", BOOST.fmtDate(row.expectedDeliveryDate)],
          ["Source quotation", row.quotationNumber ? BOOST.esc(row.quotationNumber) : "Direct order"],
        ]) +
        (row.quotationNumber
          ? '<div class="drawer-actions"><a class="btn ghost" href="/quotations?q=' + encodeURIComponent(row.quotationNumber) + '">View source quotation</a></div>'
          : ""),
    });
  }

  BOOST.mount(function () {
    table = BOOST.dataTable({
      endpoint: "/api/orders",
      emptyText: "No purchase orders match these filters.",
      onRowClick: openOrder,
      filters: [
        { id: "q", type: "search", placeholder: "Search order or supplier…" },
        {
          id: "status",
          type: "select",
          options: ["", "pending", "approved", "shipped", "delivered", "cancelled"].map(function (s) {
            return { value: s, label: s ? BOOST.label(s) : "All statuses" };
          }),
        },
      ],
      columns: [
        {
          key: "orderNumber",
          label: "Order",
          render: function (r) {
            return "<strong>" + BOOST.esc(r.orderNumber) + '</strong><span class="sub">' + BOOST.esc(r.quotationNumber || "Direct order") + "</span>";
          },
        },
        { key: "supplierName", label: "Supplier", render: function (r) { return BOOST.esc(r.supplierName); } },
        { key: "totalAmount", label: "Value", cls: "num", render: function (r) { return BOOST.fmtMoney(r.totalAmount); } },
        { key: "expectedDeliveryDate", label: "Expected delivery", cls: "num", render: function (r) { return BOOST.fmtDate(r.expectedDeliveryDate); } },
        { key: "status", label: "Status", render: function (r) { return BOOST.badge(r.status); } },
      ],
      card: function (r) {
        return (
          '<div class="dc-top"><strong>' + BOOST.esc(r.orderNumber) + "</strong>" + BOOST.badge(r.status) + "</div>" +
          '<div class="dc-desc">' + BOOST.esc(r.supplierName) + "</div>" +
          '<dl class="dc-facts">' +
          "<div><dt>Value</dt><dd>" + BOOST.fmtMoney(r.totalAmount) + "</dd></div>" +
          "<div><dt>Delivery</dt><dd>" + BOOST.fmtDate(r.expectedDeliveryDate) + "</dd></div>" +
          "</dl>"
        );
      },
    });
  });
})();