/* BOOST — one icon set for the whole app.
   Every icon is a 24x24 stroked SVG using currentColor, so the same shape
   renders white in the dark sidebar, blue on active items, and inherits
   text colour elsewhere. No emoji, no mixed glyph styles. */
(function () {
  "use strict";

  var PATHS = {
    dashboard:
      '<rect x="3" y="3" width="7" height="7" rx="1.5"/>' +
      '<rect x="14" y="3" width="7" height="7" rx="1.5"/>' +
      '<rect x="3" y="14" width="7" height="7" rx="1.5"/>' +
      '<rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    requests:
      '<path d="M8 4h8a1 1 0 0 1 1 1v1H7V5a1 1 0 0 1 1-1z"/>' +
      '<path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/>' +
      '<path d="M8 11h8M8 15h5"/>',
    quotations:
      '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/>' +
      '<path d="M14 3v5h5"/>' +
      '<path d="M9 13h6M9 17h4"/>',
    bidding:
      '<path d="M14 4 20 10l-2.5 2.5L11.5 6.5z"/>' +
      '<path d="m13 7-6.2 6.2a2 2 0 1 0 2.8 2.8L16 10"/>' +
      '<path d="M4 20h7"/>',
    orders:
      '<path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L21 8H6"/>' +
      '<circle cx="10" cy="20" r="1.2"/>' +
      '<circle cx="18" cy="20" r="1.2"/>',
    documents:
      '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    scanner:
      '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/>' +
      '<rect x="3" y="8" width="18" height="8" rx="2"/>',
    reports:
      '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    settings:
      '<circle cx="12" cy="12" r="3"/>' +
      '<path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a1.7 1.7 0 0 0-1.5-1H1.3a2 2 0 1 1 0-4h.2A1.7 1.7 0 0 0 3 9a1.7 1.7 0 0 0-.4-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H7a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1h.2a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1z"/>',

    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>',
    bell:
      '<path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7"/>' +
      '<path d="M10.3 20a2 2 0 0 0 3.4 0"/>',
    logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h11"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    chevronLeft: '<path d="m15 6-6 6 6 6"/>',
    chevronRight: '<path d="m9 6 6 6-6 6"/>',

    calendar:
      '<rect x="3" y="5" width="18" height="16" rx="2"/>' +
      '<path d="M8 3v4M16 3v4M3 10h18"/>',
    chart: '<path d="M4 20V9M10 20V4M16 20v-8M22 20H2"/>',
    trophy:
      '<path d="M7 4h10v5a5 5 0 0 1-10 0z"/>' +
      '<path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3"/>' +
      '<path d="M10 14h4v3h-4zM8 20h8"/>',
    wallet:
      '<path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>' +
      '<path d="M16 12h3"/>',
    users:
      '<circle cx="9" cy="8" r="3.2"/>' +
      '<path d="M3 20a6 6 0 0 1 12 0"/>' +
      '<path d="M16 5.5a3 3 0 0 1 0 5.6M17 20a6 6 0 0 0-2-4.5"/>',
    check: '<path d="m5 13 4 4L19 7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
    image:
      '<rect x="3" y="4" width="18" height="16" rx="2"/>' +
      '<circle cx="9" cy="10" r="1.6"/>' +
      '<path d="m4 18 5-5 4 4 3-2 4 4"/>',
    document:
      '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/>' +
      '<path d="M14 3v5h5"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 2-2.4 3.7"/><path d="M12 17.5h.01"/>',
    alert:
      '<path d="M12 4.2 21 19.8H3z"/>' +
      '<path d="M12 10v4.2"/>' +
      '<path d="M12 17.2h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11.2V16"/><path d="M12 8h.01"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  };

  function icon(name, opts) {
    var o = opts || {};
    var body = PATHS[name];
    if (!body) return "";
    return (
      '<svg class="ico ' + (o.class || "") + '" width="' + (o.size || 18) + '" height="' + (o.size || 18) +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (o.weight || 1.7) +
      '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      body +
      "</svg>"
    );
  }

  window.BOOST = window.BOOST || {};
  window.BOOST.icon = icon;
})();