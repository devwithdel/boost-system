/* BOOST — shared data table: filters, sortable headers, row selection,
   bulk actions and pagination. Used by the list pages. */
(function () {
  "use strict";

  function dataTable(options) {
    var opts = {
      endpoint: "/",
      columns: [],          // { key, label, cls, sortable, render(row) }
      filters: [],          // { id, type: 'search'|'select', options:[{value,label}] }
      selectable: false,
      rowKey: "id",
      bulkActions: [],      // { value, label, requiresNote }
      pageSize: 25,
      emptyText: "No records to show.",
      onRowClick: null,
      rowClass: null,
      extraUrl: {},         // extra query params (e.g. status filter preset)
      onLoaded: null,
    };
    Object.keys(options || {}).forEach(function (k) {
      opts[k] = options[k];
    });

    var state = { page: 1, limit: opts.pageSize, sort: "", dir: "", q: "", filters: {}, selected: {}, data: null, rows: [] };

    // Seed state from the URL so deep links (?status=pending) work.
    var params = new URLSearchParams(window.location.search);
    state.q = params.get("q") || "";
    state.sort = params.get("sort") || "";
    state.dir = params.get("dir") || "";
    state.page = Math.max(Number(params.get("page")) || 1, 1);
    opts.filters.forEach(function (f) {
      var v = params.get(f.id);
      state.filters[f.id] = v === null ? (f.default || "") : v;
    });

    function syncUrl() {
      var next = new URLSearchParams();
      if (state.q) next.set("q", state.q);
      if (state.sort) next.set("sort", state.sort);
      if (state.dir) next.set("dir", state.dir);
      if (state.page > 1) next.set("page", String(state.page));
      Object.keys(state.filters).forEach(function (k) {
        if (state.filters[k]) next.set(k, state.filters[k]);
      });
      var qs = next.toString();
      window.history.replaceState({}, "", qs ? "?" + qs : window.location.pathname);
    }

    function query() {
      var p = new URLSearchParams({ page: String(state.page), limit: String(state.limit) });
      if (state.sort) p.set("sort", state.sort);
      if (state.dir) p.set("dir", state.dir);
      if (state.q) p.set("q", state.q);
      Object.keys(opts.extraUrl || {}).forEach(function (k) {
        if (opts.extraUrl[k]) p.set(k, opts.extraUrl[k]);
      });
      Object.keys(state.filters).forEach(function (k) {
        if (state.filters[k]) p.set(k, state.filters[k]);
      });
      return opts.endpoint + "?" + p.toString();
    }

    function selectedIds() {
      return Object.keys(state.selected)
        .filter(function (k) { return state.selected[k]; })
        .map(Number);
    }

    function renderFilterBar() {
      return opts.filters
        .map(function (f) {
          if (f.type === "select") {
            var options = (typeof f.options === "function" ? f.options(state.data) : f.options) || [];
            return (
              '<select data-filter="' + f.id + '" class="dt-input">' +
              options
                .map(function (o) {
                  return '<option value="' + BOOST.esc(o.value) + '"' + (String(state.filters[f.id]) === String(o.value) ? " selected" : "") + ">" + BOOST.esc(o.label) + "</option>";
                })
                .join("") +
              "</select>"
            );
          }
          return '<input data-filter="' + f.id + '" type="search" class="dt-input" placeholder="' + BOOST.esc(f.placeholder || "Search…") + '" value="' + BOOST.esc(state.q) + '" />';
        })
        .join("");
    }

    function renderHead() {
      var head =
        '<thead><tr>' +
        (opts.selectable ? '<th class="dt-check"><input type="checkbox" id="dt-select-all" aria-label="Select all rows on this page" /></th>' : "");

      opts.columns.forEach(function (c) {
        var active = state.sort === c.key;
        var arrow = active ? (state.dir === "asc" ? "▲" : "▼") : "";
        head +=
          '<th class="' + (c.cls || "") + '">' +
          (c.sortable === false
            ? BOOST.esc(c.label)
            : '<button type="button" class="dt-sort' + (active ? " active" : "") + '" data-sort="' + BOOST.esc(c.key) + '">' +
              BOOST.esc(c.label) + '<span class="dt-arrow">' + arrow + "</span></button>") +
          "</th>";
      });
      return head + "</tr></thead>";
    }

    function renderBody(rows) {
      if (!rows.length) {
        return (
          '<tbody></tbody>' +
          '<tfoot><tr><td class="dt-empty" colspan="' + (opts.columns.length + (opts.selectable ? 1 : 0)) + '">' +
          '<div class="empty"><strong>Nothing to show</strong><p>' + BOOST.esc(opts.emptyText) + "</p></div>" +
          "</td></tr></tfoot>"
        );
      }

      var allChecked = rows.every(function (r) { return state.selected[r[opts.rowKey]]; });
      var body = rows
        .map(function (row) {
          var id = row[opts.rowKey];
          var tds = opts.columns
            .map(function (c) {
              return '<td class="' + (c.cls || "") + '">' + c.render(row) + "</td>";
            })
            .join("");
          var cls = clickable(null);
          return (
            '<tr data-id="' + id + '" data-row-id="' + id + '" tabindex="0"' +
            (cls ? ' class="' + cls + '"' : "") + '>' +
            (opts.selectable ? '<td class="dt-check"><input type="checkbox" class="dt-row-check" data-id="' + id + '"' + (state.selected[id] ? " checked" : "") + ' aria-label="Select row" /></td>' : "") +
            tds +
            "</tr>"
          );
        })
        .join("");

      return "<tbody>" + body + "</tbody>";
    }

    /* Phones get a card list: wide tables force horizontal scrolling, which
       is the clearest sign of a desktop layout squeezed into a phone. */
    function renderCards(rows) {
      if (!opts.card) return "";
      if (!rows.length) return "";
      return rows
        .map(function (row) {
          var id = row[opts.rowKey];
          return (
            '<article class="dt-card" data-id="' + id + '" tabindex="0">' +
            (opts.selectable
              ? '<label class="dt-card-check"><input type="checkbox" class="dt-row-check" data-id="' + id + '"' +
                (state.selected[id] ? " checked" : "") + ' aria-label="Select ' + BOOST.esc(row[opts.columns[0].key] || "") + '" /></label>'
              : "") +
            '<div class="dt-card-body">' + opts.card(row) + "</div>" +
            "</article>"
          );
        })
        .join("");
    }

    function renderPager(meta) {
      if (!meta) return "";
      var from = meta.total === 0 ? 0 : (meta.page - 1) * meta.limit + 1;
      var to = Math.min(meta.page * meta.limit, meta.total);
      return (
        '<div class="dt-pager">' +
        '<span class="dt-count">Showing ' + from + "–" + to + " of " + meta.total + "</span>" +
        '<div class="dt-pages">' +
        '<button type="button" class="btn ghost" data-page="prev"' + (meta.page <= 1 ? " disabled" : "") + ">‹ Prev</button>" +
        '<span class="dt-page">Page ' + meta.page + " of " + meta.pages + "</span>" +
        '<button type="button" class="btn ghost" data-page="next"' + (meta.page >= meta.pages ? " disabled" : "") + ">Next ›</button>" +
        "</div>" +
        "</div>"
      );
    }

    function renderBulkBar() {
      var ids = selectedIds();
      if (!opts.selectable || !ids.length) return '<div class="dt-bulk" hidden></div>';

      var actions = opts.bulkActions
        .map(function (a) {
          return '<button type="button" class="btn ' + (a.value === "cancelled" ? "ghost danger" : "") + '" data-bulk="' + BOOST.esc(a.value) + '" data-note="' + (a.requiresNote ? "1" : "") + '">' + BOOST.esc(a.label) + "</button>";
        })
        .join("");

      return (
        '<div class="dt-bulk">' +
        '<strong>' + ids.length + " selected</strong>" +
        actions +
        '<button type="button" class="btn ghost" data-clear="1">Clear</button>' +
        "</div>"
      );
    }

    function shell() {
      return (
        '<section class="card">' +
        '<div class="filters">' + renderFilterBar() +
        // Pinned to the trailing edge as one group, so the buttons hold the
        // same column on every page instead of sliding left or right with
        // however many filters that page happens to have.
        '<div class="filter-actions">' +
        '<button class="btn" type="button" data-apply="1">Apply</button>' +
        '<button class="btn ghost" type="button" data-reset="1">Reset</button>' +
        // Page-level actions live in the flow, never floating over the list:
        // a fixed overlay sat on top of the pager's Next button on phones.
        (opts.toolbarActions || "") +
        "</div>" +
        "</div>" +
        renderBulkBar() +
        '<div class="table-scroll" id="dt-table"></div>' +
        '<div class="dt-cards" id="dt-cards"></div>' +
        '<div class="dt-pager-slot">' + renderPager(state.data) + "</div>" +
        "</section>"
      );
    }

    function paint() {
      document.getElementById("page").innerHTML = '<div class="stack" id="dt-stack">' + shell() + "</div>";
      bind();
    }

    function refresh() {
      syncUrl();
      var host = document.getElementById("dt-table");
      if (host) host.innerHTML = '<div class="dt-loading">' + Array(5).join("<div class='dt-skel'></div>") + "</div>";
      var bulk = document.querySelector(".dt-bulk");
      if (bulk) bulk.hidden = true;

      return BOOST.json(query())
        .then(function (data) {
          state.data = data;
          var rows = data.rows || data.requests || data.quotations || data.orders || data.documents || [];
          // Kept separately so a row click can hand the whole record to the
          // page without another request. state.data is the pager's metadata.
          state.rows = rows;

          var host2 = document.getElementById("dt-table");
          if (host2) host2.innerHTML = '<table class="dt-table">' + renderHead() + renderBody(rows) + "</table>";

          var cards = document.getElementById("dt-cards");
          if (cards) {
            cards.innerHTML = renderCards(rows);
            if (!rows.length) cards.innerHTML = "";
          }

          // The pager lives in a stable slot so it can be swapped safely even
          // when it was empty on first paint (no server data yet).
          var slot = document.querySelector(".dt-pager-slot");
          if (slot) slot.innerHTML = renderPager(data);

          var bulkHost = document.querySelector(".dt-bulk");
          if (bulkHost) bulkHost.outerHTML = renderBulkBar();

          bindTable();
          // The header checkbox is re-created on every render, so restore
          // its checked/indeterminate state from the selection model.
          syncSelectAll();
          if (typeof opts.onLoaded === "function") opts.onLoaded(data);
          return data;
        })
        .catch(function (err) {
          BOOST.error(err.message, refresh);
          throw err;
        });
    }

    function bind() {
      var apply = document.querySelector("[data-apply]");
      if (apply) {
        apply.addEventListener("click", function () {
          var search = document.querySelector('[data-filter="q"], .dt-input[type="search"]');
          state.q = search ? search.value.trim() : state.q;
          opts.filters.forEach(function (f) {
            if (f.id === "q") return;
            var el = document.querySelector('[data-filter="' + f.id + '"]');
            if (el) state.filters[f.id] = el.value;
          });
          state.page = 1;
          refresh();
        });
      }

      var reset = document.querySelector("[data-reset]");
      if (reset) {
        reset.addEventListener("click", function () {
          state.q = "";
          state.page = 1;
          state.filters = {};
          opts.filters.forEach(function (f) {
            state.filters[f.id] = f.default || "";
          });
          paint();
          refresh();
        });
      }

      var searchInput = document.querySelector('.dt-input[type="search"]');
      if (searchInput) {
        searchInput.addEventListener("keydown", function (e) {
          if (e.key === "Enter") apply && apply.click();
        });
      }
    }

    function syncSelectAll() {
      var all = document.getElementById("dt-select-all");
      if (!all) return;

      var rows = (state.data && (state.data.rows || state.data.requests)) || [];
      var selectedOnPage = rows.filter(function (r) { return state.selected[r[opts.rowKey]]; }).length;

      all.checked = rows.length > 0 && selectedOnPage === rows.length;
      all.indeterminate = selectedOnPage > 0 && selectedOnPage < rows.length;
    }

    // Rows only get pointer/keyboard affordances when a row handler exists.
function clickable(cls) {
      return opts.onRowClick ? (opts.rowClass ? opts.rowClass + " is-clickable" : "is-clickable") : opts.rowClass || "";
    }

    function bindTable() {
      document.querySelectorAll(".dt-sort").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var key = btn.dataset.sort;
          if (state.sort === key) {
            state.dir = state.dir === "asc" ? "desc" : "asc";
          } else {
            state.sort = key;
            state.dir = "desc";
          }
          refresh();
        });
      });

      document.querySelectorAll("[data-page]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var meta = state.data;
          if (!meta) return;
          var next = btn.dataset.page === "next" ? meta.page + 1 : meta.page - 1;
          if (next < 1 || next > meta.pages) return;
          state.page = next;
          refresh();
        });
      });

      var all = document.getElementById("dt-select-all");
      if (all) {
        all.addEventListener("change", function () {
          var rows = state.data && (state.data.rows || state.data.requests || []);
          (rows || []).forEach(function (r) {
            state.selected[r[opts.rowKey]] = all.checked;
          });
          refresh();
        });
      }

      // One checkbox lives in the table row and one in the mobile card, so
      // sync every mirror of the same id after a change.
      document.querySelectorAll(".dt-row-check").forEach(function (box) {
        box.addEventListener("change", function () {
          state.selected[box.dataset.id] = box.checked;
          document.querySelectorAll('.dt-row-check[data-id="' + box.dataset.id + '"]').forEach(function (mirror) {
            mirror.checked = box.checked;
          });
          var bulk = document.querySelector(".dt-bulk");
          if (bulk) bulk.outerHTML = renderBulkBar();
          bindBulk();
          syncSelectAll();
        });
      });

      // onRowClick(id, element, row) — the whole record is passed as the third
      // argument so a drawer can be built without a second request. Pages that
      // need fresher data can still fetch by id.
      function rowHandler(el) {
        return function (e) {
          if (e.target.closest("input, button, a")) return;
          if (typeof opts.onRowClick !== "function") return;
          var id = Number(el.dataset.id);
          var row = null;
          for (var i = 0; i < state.rows.length; i++) {
            if (Number(state.rows[i].id) === id) {
              row = state.rows[i];
              break;
            }
          }
          opts.onRowClick(id, el, row);
        };
      }

      function rowKeyHandler(el) {
        return function (e) {
          // Rows are real controls for keyboard users, not click-only divs.
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          rowHandler(el)(e);
        };
      }

      document.querySelectorAll("tbody tr").forEach(function (tr) {
        tr.addEventListener("click", rowHandler(tr));
        tr.addEventListener("keydown", rowKeyHandler(tr));
      });

      document.querySelectorAll(".dt-card").forEach(function (card) {
        card.addEventListener("click", rowHandler(card));
        card.addEventListener("keydown", rowKeyHandler(card));
      });

      bindBulk();
    }

    function bindBulk() {
      document.querySelectorAll("[data-bulk]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var ids = selectedIds();
          if (!ids.length) return;

          var note = "";
          if (btn.dataset.note === "1") {
            note = window.prompt("Reason for " + btn.dataset.bulk + " (required):", "") || "";
            if (!note.trim()) {
              BOOST.toast("A reason is required for that action.", "warn");
              return;
            }
          }

          btn.disabled = true;
          fetch(opts.bulkEndpoint || "/api/requests/bulk-status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ ids: ids, status: btn.dataset.bulk, note: note.trim() }),
          })
            .then(function (r) {
              return r.json().then(function (b) {
                return { ok: r.ok, body: b };
              });
            })
            .then(function (res) {
              if (!res.ok) throw new Error(res.body.error || "Bulk update failed.");
              BOOST.toast(res.body.message || "Updated.", "ok");
              state.selected = {};
              return refresh();
            })
            .catch(function (err) {
              BOOST.toast(err.message, "warn");
            })
            .finally(function () {
              btn.disabled = false;
            });
        });
      });

      var clear = document.querySelector("[data-clear]");
      if (clear) {
        clear.addEventListener("click", function () {
          state.selected = {};
          refresh();
        });
      }
    }

    paint();
    refresh();

    return { refresh: refresh, state: state };
  }

  window.BOOST.dataTable = dataTable;
})();