const express = require("express");
const pool = require("../db");
const activity = require("../services/activity");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

/* Lifecycle rules per module. A change outside these is rejected, so the
   audit trail can never record a nonsensical jump. */
const TRANSITIONS = {
  quotation: {
    draft: ["active", "cancelled"],
    active: ["awarded", "expired", "cancelled"],
    awarded: [],
    expired: [],
    cancelled: [],
  },
  order: {
    pending: ["approved", "cancelled"],
    approved: ["shipped", "cancelled"],
    shipped: ["delivered"],
    delivered: [],
    cancelled: [],
  },
};

// entity_type -> table + reference column, so one handler serves every module.
const ENTITIES = {
  quotation: { table: "quotations", ref: "quotation_number", label: "Quotation" },
  order: { table: "purchase_orders", ref: "order_number", label: "Purchase order" },
  document: { table: "documents", ref: "document_number", label: "Document" },
};

/* Procurement requests live in routes/requests.js (list + detail + status
   transitions + bulk actions). This router serves the read-only module
   lists for quotations, orders and documents. */

function orderBy(sort, dir, allowed, fallback) {
  // Resolve the key -> column mapping for BOTH the requested sort and the
  // fallback, otherwise an empty sort leaks the camelCase key into SQL.
  const column = allowed[sort] || allowed[fallback] || fallback;
  return `${column} ${String(dir).toLowerCase() === "asc" ? "ASC" : "DESC"}`;
}

function paging(req, defaultLimit = 25) {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || defaultLimit, 5), 200);
  const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
  return { limit, offset: (page - 1) * limit, page };
}

function likeTerm(req) {
  return `%${String(req.query.q || "").trim().toLowerCase()}%`;
}

function str(req, key) {
  return String(req.query[key] || "").trim();
}

/* `...extra` is carried through deliberately. This helper used to rebuild the
   payload from a fixed list of paging keys, which silently swallowed anything
   else the caller passed — that is how the statusCounts facet went missing from
   quotations and orders while working fine in requests, whose route builds its
   response by hand. */
function meta(req, { page, pages, total, limit, rows, ...extra }) {
  return {
    rows,
    total,
    page,
    pages: Math.max(1, pages),
    limit,
    sort: str(req, "sort"),
    dir: String(str(req, "dir")).toLowerCase() === "asc" ? "asc" : "desc",
    ...extra,
  };
}

// NOTE: this router is mounted at /api, so a blanket router.use(requireAuth)
// would also lock out public endpoints like /api/health. Each route guards
// itself instead.

/**
 * GET /api/nav-counts
 * Lightweight badge counts for the sidebar. Kept separate from the full
 * dashboard payload so the shell can show badges on every page without
 * pulling the whole overview.
 */
router.get("/nav-counts", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM procurement_requests
          WHERE status IN ('pending','approved','in_progress')) AS requests,
        (SELECT COUNT(*)::int FROM quotations WHERE status = 'active') AS quotations
    `);
    return res.json(rows[0] || { requests: 0, quotations: 0 });
  } catch (err) {
    console.error("Nav counts error:", err);
    return res.status(500).json({ error: "Could not load counts." });
  }
});

/**
 * GET /api/quotations?q=&status=&sort=&dir=&page=&limit=
 */
router.get("/quotations", requireAuth, async (req, res) => {
  try {
    const status = str(req, "status");
    const { limit, offset, page } = paging(req);
    const sort = orderBy(
      str(req, "sort"),
      str(req, "dir"),
      {
        quotationNumber: "q.quotation_number",
        supplierName: "q.supplier_name",
        totalAmount: "q.total_amount",
        validUntil: "q.valid_until",
        status: "q.status",
        createdAt: "q.created_at",
      },
      "validUntil"
    );
    const q = likeTerm(req);

    const where = `($1 = '' OR q.status = $1)
      AND (LOWER(q.quotation_number) LIKE $2 OR LOWER(q.supplier_name) LIKE $2 OR LOWER(q.item_description) LIKE $2)`;
    const args = [status, q];

    const [rowsResult, countResult, statusResult] = await Promise.all([
      pool.query(
        `SELECT q.id, q.quotation_number AS "quotationNumber", q.supplier_name AS "supplierName",
                q.item_description AS description, q.total_amount AS "totalAmount",
                q.status, q.valid_until AS "validUntil", q.created_at AS "createdAt",
                r.request_number AS "requestNumber",
                -- The originating estimate, so the drawer can show what the
                -- quote came in against instead of only its own figure.
                r.estimated_amount AS "estimatedAmount"
         FROM quotations q
         LEFT JOIN procurement_requests r ON r.id = q.request_id
         WHERE ${where}
         ORDER BY ${sort}
         LIMIT $3 OFFSET $4`,
        [...args, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total FROM quotations q WHERE ${where}`,
        args
      ),
      // Per-status counts for the filter labels, ignoring the status filter
      // itself — see the same note in requests.js. Placeholders restart at $1
      // because an unreferenced parameter has no type for Postgres to infer.
      pool.query(
        `SELECT q.status, COUNT(*)::int AS n
         FROM quotations q
         WHERE (LOWER(q.quotation_number) LIKE $1 OR LOWER(q.supplier_name) LIKE $1 OR LOWER(q.item_description) LIKE $1)
         GROUP BY q.status`,
        [q]
      ),
    ]);

    const total = countResult.rows[0].total;
    return res.json(
      meta(req, {
        page,
        pages: Math.ceil(total / limit),
        total,
        limit,
        rows: rowsResult.rows,
        statusCounts: Object.fromEntries(statusResult.rows.map((r) => [r.status, r.n])),
      })
    );
  } catch (err) {
    console.error("Quotations list error:", err);
    return res.status(500).json({ error: "Could not load quotations." });
  }
});

/**
 * GET /api/orders?q=&status=&sort=&dir=&page=&limit=
 */
router.get("/orders", requireAuth, async (req, res) => {
  try {
    const status = str(req, "status");
    const { limit, offset, page } = paging(req);
    const sort = orderBy(
      str(req, "sort"),
      str(req, "dir"),
      {
        orderNumber: "o.order_number",
        supplierName: "o.supplier_name",
        totalAmount: "o.total_amount",
        expectedDeliveryDate: "o.expected_delivery_date",
        status: "o.status",
        orderedAt: "o.ordered_at",
      },
      // Default to the order number, not ordered_at. The two disagree: a PO can
      // be raised out of sequence, so sorting by date left PO-2026-033 stranded
      // below older numbers and the list read as random. The number is the
      // sequence a person actually expects to see running down the column.
      "orderNumber"
    );
    const q = likeTerm(req);

    const where = `($1 = '' OR o.status = $1)
      AND (LOWER(o.order_number) LIKE $2 OR LOWER(o.supplier_name) LIKE $2 OR LOWER(q.quotation_number) LIKE $2)`;
    const args = [status, q];

    const [rowsResult, countResult, statusResult] = await Promise.all([
      pool.query(
        `SELECT o.id, o.order_number AS "orderNumber", o.supplier_name AS "supplierName",
                o.total_amount AS "totalAmount", o.status, o.ordered_at AS "orderedAt",
                o.expected_delivery_date AS "expectedDeliveryDate",
                q.quotation_number AS "quotationNumber"
         FROM purchase_orders o
         LEFT JOIN quotations q ON q.id = o.quotation_id
         WHERE ${where}
         ORDER BY ${sort}
         LIMIT $3 OFFSET $4`,
        [...args, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total FROM purchase_orders o
         LEFT JOIN quotations q ON q.id = o.quotation_id
         WHERE ${where}`,
        args
      ),
      // Needs the join too: the search term matches on the quotation number.
      // Placeholders restart at $1 — see the note in the quotations facet.
      pool.query(
        `SELECT o.status, COUNT(*)::int AS n
         FROM purchase_orders o
         LEFT JOIN quotations q ON q.id = o.quotation_id
         WHERE (LOWER(o.order_number) LIKE $1 OR LOWER(o.supplier_name) LIKE $1 OR LOWER(q.quotation_number) LIKE $1)
         GROUP BY o.status`,
        [q]
      ),
    ]);

    const total = countResult.rows[0].total;
    return res.json(
      meta(req, {
        page,
        pages: Math.ceil(total / limit),
        total,
        limit,
        rows: rowsResult.rows,
        statusCounts: Object.fromEntries(statusResult.rows.map((r) => [r.status, r.n])),
      })
    );
  } catch (err) {
    console.error("Orders list error:", err);
    return res.status(500).json({ error: "Could not load purchase orders." });
  }
});

/**
 * GET /api/documents?q=&type=&sort=&dir=&page=&limit=
 */
router.get("/documents", requireAuth, async (req, res) => {
  try {
    const type = str(req, "type");
    const { limit, offset, page } = paging(req);
    const sort = orderBy(
      str(req, "sort"),
      str(req, "dir"),
      {
        documentNumber: "d.document_number",
        title: "d.title",
        documentType: "d.document_type",
        fileSizeBytes: "d.file_size_bytes",
        uploadedAt: "d.uploaded_at",
      },
      "uploadedAt"
    );
    const q = likeTerm(req);

    const where = `($1 = '' OR d.document_type = $1)
      AND (LOWER(d.title) LIKE $2 OR LOWER(d.document_number) LIKE $2 OR LOWER(d.file_name) LIKE $2)`;
    const args = [type, q];

    const [rowsResult, countResult, typesResult] = await Promise.all([
      pool.query(
        `SELECT d.id, d.document_number AS "documentNumber", d.title, d.document_type AS "documentType",
                d.file_name AS "fileName", d.file_size_bytes AS "fileSizeBytes",
                d.uploaded_at AS "uploadedAt", u.full_name AS "uploadedBy"
         FROM documents d
         LEFT JOIN users u ON u.id = d.uploaded_by
         WHERE ${where}
         ORDER BY ${sort}
         LIMIT $3 OFFSET $4`,
        [...args, limit, offset]
      ),
      pool.query(`SELECT COUNT(*)::int AS total FROM documents d WHERE ${where}`, args),
      pool.query(`SELECT DISTINCT document_type FROM documents ORDER BY document_type`),
    ]);

    const total = countResult.rows[0].total;
    const payload = meta(req, { page, pages: Math.ceil(total / limit), total, limit, rows: rowsResult.rows });
    payload.types = typesResult.rows.map((r) => r.document_type);
    return res.json(payload);
  } catch (err) {
    console.error("Documents list error:", err);
    return res.status(500).json({ error: "Could not load documents." });
  }
});

/**
 * GET /api/activity?entity=quotation&id=12
 * Audit history for one record, newest first. Works for every module because
 * they all share the activity_log trail.
 */
router.get("/activity", requireAuth, async (req, res) => {
  const entity = str(req, "entity");
  const id = Number.parseInt(str(req, "id"), 10);

  if (!activity.isEntityType(entity)) {
    return res.status(400).json({ error: "Unknown record type." });
  }
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "A record id is required." });
  }

  try {
    return res.json({ entity, id, events: await activity.forEntity(entity, id) });
  } catch (err) {
    console.error("Activity history error:", err);
    return res.status(500).json({ error: "Could not load the history for that record." });
  }
});

/**
 * POST /api/quotations/:id/status   body: { status, note? }
 * POST /api/orders/:id/status
 *
 * The same shape as the request status endpoint, so quotations and orders get
 * a real workflow and a real trail instead of being read-only lists.
 */
async function changeStatus(entity, req, res) {
  const config = ENTITIES[entity];
  const id = Number.parseInt(req.params.id, 10);
  const next = String(req.body?.status || "").trim().toLowerCase();
  const note = req.body?.note ? String(req.body.note).slice(0, 500) : null;

  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid id." });
  }
  if (!next) {
    return res.status(400).json({ error: "Choose a status." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Table and column names come from the fixed ENTITIES map above, never
    // from the request body.
    const currentResult = await client.query(
      `SELECT id, status, ${config.ref} AS ref FROM ${config.table} WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const current = currentResult.rows[0];
    if (!current) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: `${config.label} not found.` });
    }

    if (current.status === next) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: `Already marked as ${next.replace(/_/g, " ")}.` });
    }

    const allowed = TRANSITIONS[entity][current.status] || [];
    if (!allowed.includes(next)) {
      await client.query("ROLLBACK");
      // 409 Conflict, matching POST /api/requests/:id/status — the request was
      // understood but the record's current state forbids it.
      return res.status(409).json({
        error: `A ${config.label.toLowerCase()} that is ${current.status.replace(/_/g, " ")} cannot be marked ${next.replace(
          /_/g,
          " "
        )}.`,
      });
    }

    const updated = await client.query(
      `UPDATE ${config.table} SET status = $1 WHERE id = $2 RETURNING id, status`,
      [next, id]
    );

    const actorResult = await client.query(`SELECT full_name FROM users WHERE id = $1`, [req.user.sub]);
    await activity.record(
      {
        entity,
        entityId: id,
        ref: current.ref,
        action: next === "cancelled" ? "cancelled" : "status_change",
        from: current.status,
        to: next,
        actor: { sub: req.user.sub, fullName: actorResult.rows[0]?.full_name || null },
        note,
      },
      client
    );

    await client.query("COMMIT");
    return res.json({
      record: updated.rows[0],
      message: `${config.label} marked as ${next.replace(/_/g, " ")}.`,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(`${entity} status error:`, err);
    return res.status(500).json({ error: `Could not update that ${config.label.toLowerCase()}.` });
  } finally {
    client.release();
  }
}

router.post("/quotations/:id/status", requireAuth, (req, res) => changeStatus("quotation", req, res));
router.post("/orders/:id/status", requireAuth, (req, res) => changeStatus("order", req, res));

module.exports = router;