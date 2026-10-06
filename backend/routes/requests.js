const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const pool = require("../db");
const activity = require("../services/activity");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, "..", "uploads");
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
};

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ---------- shared list helpers ---------- */

/** Whitelisted ORDER BY. Never interpolate raw user input into SQL. */
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

// This router is mounted at /api, so a blanket router.use(requireAuth) would
// also lock out public endpoints such as /api/health. Guard each route.

/* ---------- attachments ---------- */

/**
 * POST /api/requests/:id/attachments
 * Body: { image: "data:image/png;base64,...", fileName?: string, source?: "scan" | "upload" }
 */
router.post("/requests/:id/attachments", requireAuth, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid request id." });

  const dataUrl = String(req.body?.image || "");
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i);
  if (!match) {
    return res.status(400).json({ error: "Attach a PNG, JPEG or WebP image." });
  }

  const mime = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], "base64");

  if (!buffer.length) return res.status(400).json({ error: "That image is empty." });
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    return res.status(413).json({ error: "Image is too large. Keep it under 8 MB." });
  }

  const source = req.body?.source === "scan" ? "scan" : "upload";

  try {
    const exists = await pool.query(`SELECT 1 FROM procurement_requests WHERE id = $1`, [id]);
    if (!exists.rows.length) return res.status(404).json({ error: "Request not found." });

    const stored = `${id}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ALLOWED_IMAGE_TYPES[mime]}`;
    await fs.promises.writeFile(path.join(UPLOAD_DIR, stored), buffer);

    const fileName = String(req.body?.fileName || `scan.${ALLOWED_IMAGE_TYPES[mime].slice(1)}`).slice(0, 255);

    const { rows } = await pool.query(
      `INSERT INTO request_attachments
        (request_id, file_name, stored_name, mime_type, size_bytes, source, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, request_id AS "requestId", file_name AS "fileName", mime_type AS "mimeType",
                 size_bytes AS "sizeBytes", source, uploaded_at AS "uploadedAt"`,
      [id, fileName, stored, mime, buffer.length, source, req.user.sub]
    );

    return res.status(201).json({ attachment: rows[0] });
  } catch (err) {
    console.error("Attachment upload error:", err);
    return res.status(500).json({ error: "Could not attach that file." });
  }
});

/**
 * GET /api/requests/:id/attachments/:attachmentId/file
 */
router.get("/requests/:id/attachments/:attachmentId/file", requireAuth, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const attachmentId = Number.parseInt(req.params.attachmentId, 10);

  try {
    const { rows } = await pool.query(
      `SELECT a.stored_name, a.mime_type, a.file_name
       FROM request_attachments a
       WHERE a.id = $1 AND a.request_id = $2`,
      [attachmentId, id]
    );
    const file = rows[0];
    if (!file) return res.status(404).json({ error: "Attachment not found." });

    const absolute = path.join(UPLOAD_DIR, path.basename(file.stored_name));
    if (!fs.existsSync(absolute)) return res.status(410).json({ error: "That file is no longer available." });

    res.set("Content-Type", file.mime_type);
    res.set("Content-Disposition", `inline; filename="${encodeURIComponent(file.file_name)}"`);
    res.set("Cache-Control", "private, max-age=3600");
    return res.sendFile(absolute);
  } catch (err) {
    console.error("Attachment download error:", err);
    return res.status(500).json({ error: "Could not load that file." });
  }
});

/* ---------- procurement requests ---------- */

const REQUEST_SORTS = {
  requestedAt: "requested_at",
  requestNumber: "request_number",
  department: "department",
  estimatedAmount: "estimated_amount",
  dueDate: "due_date",
  status: "status",
};

const REQUEST_STATUSES = ["pending", "approved", "in_progress", "completed", "cancelled"];

/** Allowed status transitions — keeps the workflow honest. */
const TRANSITIONS = {
  pending: ["approved", "cancelled"],
  approved: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: ["pending"],
};

/**
 * Writes an audit row. `executor` must be the same client that performed the
 * status change, otherwise the event can be written before (or without) the
 * transaction that created the parent row.
 */
async function logEvent(executor, requestId, actor, action, fromStatus, toStatus, note, ref) {
  await activity.record(
    {
      entity: "request",
      entityId: requestId,
      ref: ref || null,
      action,
      from: fromStatus,
      to: toStatus,
      actor,
      note,
    },
    executor
  );
}

/**
 * GET /api/requests?q=&status=&department=&sort=&dir=&page=&limit=
 */
router.get("/requests", requireAuth, async (req, res) => {
  try {
    const status = str(req, "status");
    const department = str(req, "department");
    const { limit, offset, page } = paging(req);
    const sort = orderBy(str(req, "sort"), str(req, "dir"), REQUEST_SORTS, "requestedAt");
    const q = likeTerm(req);

    const where = [
      "($1 = '' OR status = $1)",
      "($2 = '' OR department = $2)",
      "(LOWER(request_number) LIKE $3 OR LOWER(item_description) LIKE $3 OR LOWER(requester_name) LIKE $3 OR LOWER(department) LIKE $3)",
    ];
    const args = [status, department, q];

    // How many of each status sit behind the current department and search,
    // with the status filter deliberately left out. Counting under the active
    // status would report 0 for every other option the moment you picked one,
    // which makes the filter useless for moving between statuses.
    // Placeholders restart at $1: an unreferenced parameter has no type for
    // Postgres to infer, so passing the status through would fail outright.
    const facetWhere = [
      "($1 = '' OR department = $1)",
      "(LOWER(request_number) LIKE $2 OR LOWER(item_description) LIKE $2 OR LOWER(requester_name) LIKE $2 OR LOWER(department) LIKE $2)",
    ];

    const [rowsResult, countResult, deptResult, statusResult] = await Promise.all([
      pool.query(
        `SELECT id, request_number AS "requestNumber", requester_name AS "requesterName",
                department, item_description AS description, quantity,
                estimated_amount AS "estimatedAmount", status, due_date AS "dueDate",
                requested_at AS "requestedAt"
         FROM procurement_requests
         WHERE ${where.join(" AND ")}
         ORDER BY ${sort}
         LIMIT $4 OFFSET $5`,
        [...args, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total FROM procurement_requests WHERE ${where.join(" AND ")}`,
        args
      ),
      pool.query(`SELECT DISTINCT department FROM procurement_requests ORDER BY department`),
      pool.query(
        `SELECT status, COUNT(*)::int AS n
         FROM procurement_requests
         WHERE ${facetWhere.join(" AND ")}
         GROUP BY status`,
        [args[1], args[2]]
      ),
    ]);

    const total = countResult.rows[0].total;
    return res.json({
      requests: rowsResult.rows,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      limit,
      sort: str(req, "sort") || "requestedAt",
      dir: String(str(req, "dir")).toLowerCase() === "asc" ? "asc" : "desc",
      departments: deptResult.rows.map((r) => r.department),
      statusCounts: Object.fromEntries(statusResult.rows.map((r) => [r.status, r.n])),
    });
  } catch (err) {
    console.error("Requests list error:", err);
    return res.status(500).json({ error: "Could not load procurement requests." });
  }
});

/**
 * GET /api/requests/:id — one request plus its audit trail.
 */
router.get("/requests/:id", requireAuth, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid request id." });

  try {
    const [item, events, files] = await Promise.all([
      pool.query(
        `SELECT r.id, r.request_number AS "requestNumber", r.requester_name AS "requesterName",
                r.department, r.item_description AS description, r.quantity,
                r.estimated_amount AS "estimatedAmount", r.status, r.due_date AS "dueDate",
                r.requested_at AS "requestedAt", r.updated_at AS "updatedAt",
                u.full_name AS "createdBy",
                (SELECT e.actor_name FROM activity_log e
                  WHERE e.entity_type = 'request' AND e.entity_id = r.id AND e.to_status = 'approved'
                  ORDER BY e.created_at DESC LIMIT 1) AS "approvedBy",
                (SELECT e.created_at FROM activity_log e
                  WHERE e.entity_type = 'request' AND e.entity_id = r.id AND e.to_status = 'approved'
                  ORDER BY e.created_at DESC LIMIT 1) AS "approvedAt"
         FROM procurement_requests r
         LEFT JOIN users u ON u.id = r.created_by
         WHERE r.id = $1`,
        [id]
      ),
      activity.forEntity("request", id),
      pool.query(
        `SELECT id, file_name AS "fileName", mime_type AS "mimeType", size_bytes AS "sizeBytes",
                source, uploaded_at AS "uploadedAt"
         FROM request_attachments
         WHERE request_id = $1
         ORDER BY uploaded_at DESC, id DESC`,
        [id]
      ),
    ]);

    const request = item.rows[0];
    if (!request) return res.status(404).json({ error: "Request not found." });

    return res.json({
      request,
      events,
      attachments: files.rows,
      allowedNext: TRANSITIONS[request.status] || [],
    });
  } catch (err) {
    console.error("Request detail error:", err);
    return res.status(500).json({ error: "Could not load that request." });
  }
});

/**
 * POST /api/requests/:id/status  { status, note }
 */
router.post("/requests/:id/status", requireAuth, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const next = String(req.body?.status || "").trim();
  const note = String(req.body?.note || "").trim();

  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid request id." });
  if (!REQUEST_STATUSES.includes(next)) return res.status(400).json({ error: "Unknown status." });
  if (next === "cancelled" && !note) {
    return res.status(400).json({ error: "A reason is required when cancelling a request." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT status, request_number FROM procurement_requests WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const current = rows[0];
    if (!current) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Request not found." });
    }

    const allowed = TRANSITIONS[current.status] || [];
    if (!allowed.includes(next)) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: `Cannot move a ${current.status.replace("_", " ")} request to ${next.replace("_", " ")}.`,
      });
    }

    const { rows: updated } = await client.query(
      `UPDATE procurement_requests SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, status`,
      [next, id]
    );

    const { rows: actorRows } = await client.query(`SELECT full_name FROM users WHERE id = $1`, [req.user.sub]);
    await logEvent(
      client,
      id,
      { sub: req.user.sub, fullName: actorRows[0]?.full_name || null },
      next === "cancelled" ? "cancelled" : "status_change",
      current.status,
      next,
      note || null,
      current.request_number || current.requestNumber
    );

    await client.query("COMMIT");
    return res.json({ request: updated[0], message: `Marked as ${next.replace("_", " ")}.` });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Status change error:", err);
    return res.status(500).json({ error: "Could not update that request." });
  } finally {
    client.release();
  }
});

/**
 * POST /api/requests/bulk-status  { ids: [], status, note }
 */
router.post("/requests/bulk-status", requireAuth, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : [];
  const next = String(req.body?.status || "").trim();
  const note = String(req.body?.note || "").trim();

  if (!ids.length) return res.status(400).json({ error: "Select at least one request." });
  if (ids.length > 200) return res.status(400).json({ error: "Too many requests selected (max 200)." });
  if (!["approved", "cancelled", "completed"].includes(next)) {
    return res.status(400).json({ error: "That action is not available in bulk." });
  }
  if (next === "cancelled" && !note) {
    return res.status(400).json({ error: "A reason is required when cancelling requests." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT id, status FROM procurement_requests WHERE id = ANY($1::int[]) FOR UPDATE`,
      [ids]
    );

    const updatable = rows.filter((r) => (TRANSITIONS[r.status] || []).includes(next));
    const skipped = rows.filter((r) => !(TRANSITIONS[r.status] || []).includes(next));

    if (updatable.length) {
      await client.query(
        `UPDATE procurement_requests SET status = $1, updated_at = NOW() WHERE id = ANY($2::int[])`,
        [next, updatable.map((r) => r.id)]
      );
      const { rows: actorRows } = await client.query(`SELECT full_name FROM users WHERE id = $1`, [req.user.sub]);
      for (const r of updatable) {
        await logEvent(
          client,
          r.id,
          { sub: req.user.sub, fullName: actorRows[0]?.full_name || null },
          "bulk_status",
          r.status,
          next,
          note || null,
          r.request_number || r.requestNumber
        );
      }
    }

    await client.query("COMMIT");
    return res.json({
      updated: updatable.length,
      skipped: skipped.length,
      message: `${updatable.length} request(s) updated${skipped.length ? `, ${skipped.length} skipped (not allowed from their current status)` : ""}.`,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Bulk status error:", err);
    return res.status(500).json({ error: "Could not update the selected requests." });
  } finally {
    client.release();
  }
});

/**
 * POST /api/requests  — create (used by the scanner and manual entry).
 */
router.post("/requests", requireAuth, async (req, res) => {
  const body = req.body || {};
  const item = String(body.item || "").trim();
  const quantity = Number(body.quantity);
  const estimatedAmount = Number(body.estimatedAmount);
  const department = String(body.department || "").trim() || "General";
  const requester = String(body.requester || "").trim() || "Unknown";

  if (!item) return res.status(400).json({ error: "Item description is required." });
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return res.status(400).json({ error: "Quantity must be a positive number." });
  }
  if (!Number.isFinite(estimatedAmount) || estimatedAmount < 0) {
    return res.status(400).json({ error: "Estimated amount must be zero or more." });
  }
  if (body.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.dueDate))) {
    return res.status(400).json({ error: "Due date must be YYYY-MM-DD." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let requestNumber = String(body.requestNumber || "").trim();
    if (!requestNumber) {
      // Only look at canonical REQ-YYYY-NNN numbers and take the trailing
      // sequence — suffixed ones (REQ-2026-105-7936) would otherwise blow up
      // the integer cast.
      const { rows } = await client.query(
        `SELECT COALESCE(MAX((regexp_match(request_number, '^REQ-\\d{4}-(\\d+)'))[1]::int), 0) AS n
         FROM procurement_requests
         WHERE request_number ~ '^REQ-\\d{4}-\\d+'`
      );
      requestNumber = `REQ-${new Date().getFullYear()}-${String((rows[0].n || 0) + 1).padStart(3, "0")}`;
    } else {
      const { rows } = await client.query(
        `SELECT 1 FROM procurement_requests WHERE request_number = $1`,
        [requestNumber]
      );
      if (rows.length) requestNumber = `${requestNumber}-${Date.now().toString().slice(-4)}`;
    }

    const { rows } = await client.query(
      `INSERT INTO procurement_requests
        (request_number, requester_name, department, item_description, quantity,
         estimated_amount, status, due_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)
       RETURNING id, request_number AS "requestNumber", status, requested_at AS "requestedAt"`,
      [requestNumber, requester, department, item, Math.round(quantity), estimatedAmount, body.dueDate || null, req.user.sub]
    );

    const { rows: actorRows } = await client.query(`SELECT full_name FROM users WHERE id = $1`, [req.user.sub]);
    await logEvent(
      client,
      rows[0].id,
      { sub: req.user.sub, fullName: actorRows[0]?.full_name },
      "created",
      null,
      "pending",
      note0(body.note),
      rows[0].requestNumber
    );

    await client.query("COMMIT");
    return res.status(201).json({ request: rows[0] });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Create request error:", err);
    return res.status(500).json({ error: "Could not save the request." });
  } finally {
    client.release();
  }
});

function note0(v) {
  return v ? String(v) : null;
}

module.exports = router;