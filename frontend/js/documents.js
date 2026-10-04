/* BOOST — Document Repository: sortable, paged list. */
(function () {
  "use strict";

  var TYPE_LABEL = {
    request: "Procurement Request",
    quotation: "Quotation",
    order: "Purchase Order",
    contract: "Contract",
    invoice: "Invoice / Receipt",
    other: "Other",
  };

  function size(bytes) {
    var n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return "—";
    if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + " KB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
  }

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
  function openDocument(id, el, row) {
    if (!row) return;
    // Documents have no status workflow, so this drawer shows the record plus
    // whatever the shared trail knows about it.
    BOOST.openDrawer(
      row.title,
      facts([
        ["Type", BOOST.badge(row.documentType)],
        ["Document no.", BOOST.esc(row.documentNumber)],
        ["File", BOOST.esc(row.fileName)],
        ["Size", size(row.fileSizeBytes)],
        ["Uploaded by", BOOST.esc(row.uploadedBy || "System")],
        ["Uploaded", BOOST.fmtDate(row.uploadedAt)],
      ]) +
        '<div class="tl-slot" data-tl-slot></div>',
      function (layer) {
        BOOST.historySection("document", row.id).then(function (html) {
          var slot = layer.querySelector("[data-tl-slot]");
          if (slot && html) slot.outerHTML = html;
        });
      }
    );
  }

  BOOST.mount(function () {
    BOOST.dataTable({
      endpoint: "/api/documents",
      emptyText: "No documents match these filters.",
      onRowClick: openDocument,
      filters: [
        { id: "q", type: "search", placeholder: "Search title, number, file…" },
        {
          id: "type",
          type: "select",
          options: function (data) {
            return [{ value: "", label: "All types" }].concat(
              (data && data.types ? data.types : []).map(function (t) {
                return { value: t, label: TYPE_LABEL[t] || BOOST.label(t) };
              })
            );
          },
        },
      ],
      columns: [
        {
          key: "title",
          label: "Document",
          render: function (d) {
            return "<strong>" + BOOST.esc(d.title) + '</strong><span class="sub">' + BOOST.esc(d.documentNumber) + "</span>";
          },
        },
        { key: "documentType", label: "Type", render: function (d) { return BOOST.badge(d.documentType); } },
        { key: "fileName", label: "File", render: function (d) { return BOOST.esc(d.fileName); } },
        { key: "fileSizeBytes", label: "Size", cls: "num", render: function (d) { return size(d.fileSizeBytes); } },
        { key: "uploadedBy", label: "Uploaded by", sortable: false, render: function (d) { return BOOST.esc(d.uploadedBy || "System"); } },
        { key: "uploadedAt", label: "Uploaded", cls: "num", render: function (d) { return BOOST.fmtDate(d.uploadedAt); } },
      ],
      card: function (d) {
        return (
          '<div class="dc-top"><strong>' + BOOST.esc(d.title) + "</strong>" + BOOST.badge(d.documentType) + "</div>" +
          '<div class="dc-desc">' + BOOST.esc(d.documentNumber) + " · " + size(d.fileSizeBytes) + "</div>" +
          '<dl class="dc-facts">' +
          "<div><dt>Uploaded by</dt><dd>" + BOOST.esc(d.uploadedBy || "System") + "</dd></div>" +
          "<div><dt>Uploaded</dt><dd>" + BOOST.fmtDate(d.uploadedAt) + "</dd></div>" +
          "</dl>"
        );
      },
    });
  });
})();