const express = require("express");
const pool = require("../db");
const activity = require("../services/activity");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

/* Lifecycle of a bid package. Mirrors the other modules' maps so the audit
   trail can never record a nonsensical jump. */
const TRANSITIONS = {
  draft: ["open", "cancelled"],
  open: ["closed", "awarded", "cancelled"],
  closed: ["awarded", "cancelled"],
  awarded: [],
  cancelled: [],
};

/** Submission states. A submission may be withdrawn until it is decided. */
const SUBMISSION_TRANSITIONS = {
  submitted: ["awarded", "rejected", "withdrawn"],
  awarded: [],
  rejected: [],
  withdrawn: [],
};

const SORTS = {
  bidNumber: "b.bid_number",
  title: "b.title",
  status: "b.status",
  openedAt: "b.opened_at",
  // The two aggregate columns and the range are only valid in the grouped list
  // query, which is the only one that produces them — quoted lowercase so
  // Postgres reads them as the output-column aliases, not as table columns.
  // Leaving one out would not error: it would quietly sort by the fallback
  // while the header claimed a different order.
  submissionCount: '"submissionCount"',
  awardedValue: '"awardedValue"',
  lowestBid: 'MIN(s.total_amount)',
  highestBid: 'MAX(s.total_amount)',
};

/** Whitelisted ORDER BY. Never interpolate raw user input into SQL. */
function orderBy(sort, dir, allowed, fallback) {
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

function money(value) {
  return Number(value) || 0;
}

/* ------------------------------------------------------------------ */
/* List                                                                */
/* ------------------------------------------------------------------ */

/**
 * GET /api/bids?q=&status=&sort=&dir=&page=&limit=
 *
 * Each row carries the package plus the aggregates a buyer actually needs at a
 * glance: how many suppliers bid, what the lowest and highest offers were, and
 * what the award was worth. Those come from the same submission query so they
 * can never disagree with each other.
 */
router.get("/bids", requireAuth, async (req, res) => {
  try {
    const status = str(req, "status");
    const { limit, offset, page } = paging(req);
    const sort = orderBy(str(req, "sort"), str(req, "dir"), SORTS, "openedAt");
    const q = likeTerm(req);

    // 1 = has at least one submission. Lets the supplier filter ask "which
    // packages did this supplier actually bid on" without a second round trip.
    const supplier = str(req, "supplier").toLowerCase();

    const where = `($1 = '' OR b.status = $1)
      AND ($3 = '' OR EXISTS (
            SELECT 1 FROM bid_submissions bs
            WHERE bs.bid_id = b.id AND LOWER(bs.supplier_name) LIKE $3))
      AND (LOWER(b.bid_number) LIKE $2 OR LOWER(b.title) LIKE $2 OR LOWER(b.notes) LIKE $2)`;
    const args = [status, q, supplier];

    const [rowsResult, countResult, statusResult] = await Promise.all([
      pool.query(
        `SELECT b.id, b.bid_number AS "bidNumber", b.title, b.status,
                b.opened_at AS "openedAt", b.closed_at AS "closedAt", b.notes,
                r.request_number AS "requestNumber",
                COUNT(s.id)::int AS "submissionCount",
                MIN(s.total_amount) AS "lowestBid",
                MAX(s.total_amount) AS "highestBid",
                -- The award value, only where a submission was actually awarded.
                MAX(s.total_amount) FILTER (WHERE s.status = 'awarded') AS "awardedValue",
                MAX(s.supplier_name) FILTER (WHERE s.status = 'awarded') AS "awardedSupplier",
                (SELECT COUNT(*)::int FROM bid_submissions x WHERE x.bid_id = b.id AND x.status = 'rejected')
                  AS "rejectedCount"
         FROM bids b
         LEFT JOIN procurement_requests r ON r.id = b.request_id
         LEFT JOIN bid_submissions s ON s.bid_id = b.id
         WHERE ${where}
         GROUP BY b.id, r.request_number
         ORDER BY ${sort}
         LIMIT $4 OFFSET $5`,
        [...args, limit, offset]
      ),
      // The count query runs against the same WHERE, so the placeholder numbers
      // inside it must match the row query's, not be renumbered.
      pool.query(
        `SELECT COUNT(DISTINCT b.id)::int AS total FROM bids b WHERE ${where}`,
        args
      ),
      // Per-status counts for the filter labels. Status is left out of the
      // filter on purpose — see the same note in requests.js. Placeholders
      // restart at $1 because an unreferenced parameter has no type to infer.
      pool.query(
        `SELECT b.status, COUNT(DISTINCT b.id)::int AS n
         FROM bids b
         WHERE ($2 = '' OR EXISTS (
                 SELECT 1 FROM bid_submissions bs
                 WHERE bs.bid_id = b.id AND LOWER(bs.supplier_name) LIKE $2))
           AND (LOWER(b.bid_number) LIKE $1 OR LOWER(b.title) LIKE $1 OR LOWER(b.notes) LIKE $1)
         GROUP BY b.status`,
        [q, supplier]
      ),
    ]);

    const total = countResult.rows[0].total;
    return res.json({
      bids: rowsResult.rows,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      limit,
      sort: str(req, "sort") || "openedAt",
      dir: String(str(req, "dir")).toLowerCase() === "asc" ? "asc" : "desc",
      statusCounts: Object.fromEntries(statusResult.rows.map((r) => [r.status, r.n])),
    });
  } catch (err) {
    console.error("Bids list error:", err);
    return res.status(500).json({ error: "Could not load bidding records." });
  }
});

/**
 * GET /api/bids/:id — one package, its submissions and its audit trail.
 */
router.get("/bids/:id", requireAuth, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid bid id." });

  try {
    const [item, submissions, events] = await Promise.all([
      pool.query(
        `SELECT b.id, b.bid_number AS "bidNumber", b.title, b.status, b.notes,
                b.opened_at AS "openedAt", b.closed_at AS "closedAt",
                b.created_at AS "createdAt",
                r.request_number AS "requestNumber",
                r.item_description AS "requestDescription",
                r.estimated_amount AS "estimatedAmount",
                u.full_name AS "createdBy"
         FROM bids b
         LEFT JOIN procurement_requests r ON r.id = b.request_id
         LEFT JOIN users u ON u.id = b.created_by
         WHERE b.id = $1`,
        [id]
      ),
      pool.query(
        `SELECT id, supplier_name AS "supplierName", total_amount AS "totalAmount",
                notes, status, submitted_at AS "submittedAt", awarded_at AS "awardedAt"
         FROM bid_submissions
         WHERE bid_id = $1
         ORDER BY total_amount ASC, supplier_name ASC`,
        [id]
      ),
      activity.forEntity("bid", id),
    ]);

    const bid = item.rows[0];
    if (!bid) return res.status(404).json({ error: "Bid not found." });

    return res.json({
      bid,
      submissions: submissions.rows,
      events,
      allowedNext: TRANSITIONS[bid.status] || [],
    });
  } catch (err) {
    console.error("Bid detail error:", err);
    return res.status(500).json({ error: "Could not load that bidding record." });
  }
});

/**
 * POST /api/bids — create a package.
 * Body: { title, requestId?, notes? }
 *
 * Always created as a draft. Opening it is a separate, deliberate step, so
 * nothing is advertised to suppliers until someone decides to open it.
 */
router.post("/bids", requireAuth, async (req, res) => {
  const title = String(req.body?.title || "").trim().slice(0, 200);
  const notes = req.body?.notes ? String(req.body.notes).trim().slice(0, 500) : null;
  const raw = req.body?.requestId;
  const requestId =
    raw === null || raw === undefined || raw === "" ? null : Number.parseInt(raw, 10);

  if (!title) return res.status(400).json({ error: "Give the package a title." });
  if (requestId !== null && (!Number.isInteger(requestId) || requestId < 1)) {
    return res.status(400).json({ error: "Invalid request id." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // The link is optional, but a dangling one is worse than none, so a supplied
    // id has to resolve to a real request.
    if (requestId !== null) {
      const found = await client.query(`SELECT 1 FROM procurement_requests WHERE id = $1`, [requestId]);
      if (!found.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "That request was not found." });
      }
    }

    // Numbering follows the requests module: highest canonical BID-YYYY-NNN
    // plus one. Only canonical numbers are parsed, so a suffixed one
    // (BID-2026-106-4821) cannot blow up the integer cast.
    const { rows: seq } = await client.query(
      `SELECT COALESCE(MAX((regexp_match(bid_number, '^BID-\\d{4}-(\\d+)'))[1]::int), 0) AS n
       FROM bids WHERE bid_number ~ '^BID-\\d{4}-\\d+'`
    );

    let bidNumber = `BID-${new Date().getFullYear()}-${String((seq[0].n || 0) + 1).padStart(3, "0")}`;
    const clash = await client.query(`SELECT 1 FROM bids WHERE bid_number = $1`, [bidNumber]);
    if (clash.rows.length) bidNumber = `${bidNumber}-${Date.now().toString().slice(-4)}`;

    const { rows } = await client.query(
      `INSERT INTO bids (bid_number, request_id, title, status, notes, created_by)
       VALUES ($1, $2, $3, 'draft', $4, $5)
       RETURNING id, bid_number AS "bidNumber", title, status, notes, created_at AS "createdAt"`,
      [bidNumber, requestId, title, notes, req.user.sub]
    );

    const actorResult = await client.query(`SELECT full_name FROM users WHERE id = $1`, [req.user.sub]);
    await activity.record(
      {
        entity: "bid",
        entityId: rows[0].id,
        ref: bidNumber,
        action: "created",
        to: "draft",
        actor: { sub: req.user.sub, fullName: actorResult.rows[0]?.full_name || null },
        note: title,
      },
      client
    );

    await client.query("COMMIT");
    return res.status(201).json({ bid: rows[0], message: `${bidNumber} created as a draft.` });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Bid create error:", err);
    return res.status(500).json({ error: "Could not create that bidding record." });
  } finally {
    client.release();
  }
});

/* ------------------------------------------------------------------ */
/* Package lifecycle                                                   */
/* ------------------------------------------------------------------ */

/** Shared guard + transition check for a package status change. */
async function setBidStatus(req, res, { id, next, note }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const currentResult = await client.query(`SELECT id, status, bid_number FROM bids WHERE id = $1 FOR UPDATE`, [id]);
    const current = currentResult.rows[0];
    if (!current) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Bid not found." });
    }

    if (current.status === next) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: `This bid is already ${next}.` });
    }

    const allowed = TRANSITIONS[current.status] || [];
    if (!allowed.includes(next)) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: `A bid that is ${current.status} cannot be marked ${next}.`,
      });
    }

    // Awarding the package is a decision about a supplier, so the winning
    // submission has to be named. Without one there is nothing to award.
    if (next === "awarded") {
      const { rows: winners } = await client.query(
        `SELECT supplier_name FROM bid_submissions WHERE bid_id = $1 AND status = 'awarded'`,
        [id]
      );
      if (!winners.length) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: "Award a supplier bid before closing this package.",
        });
      }
    }

    // Opening stamps opened_at, closing stamps closed_at, and both are
    // timestamped by the database rather than the client.
    const stamps =
      next === "open"
        ? ", opened_at = COALESCE(opened_at, NOW())"
        : next === "closed" || next === "awarded"
          ? ", closed_at = COALESCE(closed_at, NOW())"
          : "";

    const updated = await client.query(
      `UPDATE bids SET status = $1${stamps}, updated_at = NOW() WHERE id = $2
       RETURNING id, status, opened_at AS "openedAt", closed_at AS "closedAt"`,
      [next, id]
    );

    const actorResult = await client.query(`SELECT full_name FROM users WHERE id = $1`, [req.user.sub]);
    await activity.record(
      {
        entity: "bid",
        entityId: id,
        ref: current.bid_number,
        action: next === "cancelled" ? "cancelled" : "status_change",
        from: current.status,
        to: next,
        actor: { sub: req.user.sub, fullName: actorResult.rows[0]?.full_name || null },
        note,
      },
      client
    );

    await client.query("COMMIT");
    return res.json({ record: updated.rows[0], message: `Bid marked as ${next}.` });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Bid status error:", err);
    return res.status(500).json({ error: "Could not update that bidding record." });
  } finally {
    client.release();
  }
}

/** POST /api/bids/:id/status  { status, note? } */
router.post("/bids/:id/status", requireAuth, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const next = String(req.body?.status || "").trim().toLowerCase();
  const note = req.body?.note ? String(req.body.note).slice(0, 500) : null;

  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid bid id." });
  if (!TRANSITIONS[next]) return res.status(400).json({ error: "Unknown status." });
  if (next === "cancelled" && !note) {
    return res.status(400).json({ error: "A reason is required when cancelling a bid." });
  }

  return setBidStatus(req, res, { id, next, note });
});

/* ------------------------------------------------------------------ */
/* Submissions                                                         */
/* ------------------------------------------------------------------ */

/**
 * POST /api/bids/:id/submissions
 * Body: { supplierName, totalAmount, notes? }
 */
router.post("/bids/:id/submissions", requireAuth, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const supplierName = String(req.body?.supplierName || "").trim();
  const notes = req.body?.notes ? String(req.body.notes).slice(0, 500) : null;
  const totalAmount = Number(req.body?.totalAmount);

  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid bid id." });
  if (!supplierName) return res.status(400).json({ error: "A supplier name is required." });
  if (!Number.isFinite(totalAmount) || totalAmount < 0) {
    return res.status(400).json({ error: "Enter a bid amount of zero or more." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: bidRows } = await client.query(`SELECT id, bid_number, status FROM bids WHERE id = $1 FOR UPDATE`, [id]);
    const bid = bidRows[0];
    if (!bid) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Bid not found." });
    }

    // A closed package is a fixed historical record — accepting a late bid
    // would change a decision that has already been made against it.
    if (bid.status !== "open") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: `Bids can only be submitted while a package is open. This one is ${bid.status}.` });
    }

    const { rows: dupe } = await client.query(
      `SELECT 1 FROM bid_submissions WHERE bid_id = $1 AND LOWER(supplier_name) = LOWER($2)`,
      [id, supplierName]
    );
    if (dupe.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: `${supplierName} has already submitted a bid on this package.` });
    }

    const { rows } = await client.query(
      `INSERT INTO bid_submissions (bid_id, supplier_name, total_amount, notes)
       VALUES ($1, $2, $3, $4)
       RETURNING id, supplier_name AS "supplierName", total_amount AS "totalAmount",
                 notes, status, submitted_at AS "submittedAt"`,
      [id, supplierName, totalAmount, notes]
    );

    const actorResult = await client.query(`SELECT full_name FROM users WHERE id = $1`, [req.user.sub]);
    await activity.record(
      {
        entity: "bid",
        entityId: id,
        ref: bid.bid_number,
        action: "submission_received",
        actor: { sub: req.user.sub, fullName: actorResult.rows[0]?.full_name || null },
        note: `${supplierName} bid ${totalAmount}`,
      },
      client
    );

    await client.query("COMMIT");
    return res.status(201).json({ submission: rows[0], message: `${supplierName}'s bid was recorded.` });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Bid submission error:", err);
    return res.status(500).json({ error: "Could not record that bid." });
  } finally {
    client.release();
  }
});

/**
 * POST /api/bids/:id/submissions/:submissionId/status
 * Body: { status, note? }
 *
 * Awarding a submission closes the package too, because an award is the last
 * thing that happens to a package. Doing it in one call keeps the two in step
 * rather than leaving a package 'open' with a winner already picked.
 */
router.post("/bids/:id/submissions/:submissionId/status", requireAuth, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const submissionId = Number.parseInt(req.params.submissionId, 10);
  const next = String(req.body?.status || "").trim().toLowerCase();
  const note = req.body?.note ? String(req.body.note).slice(0, 500) : null;

  if (!Number.isFinite(id) || !Number.isFinite(submissionId)) {
    return res.status(400).json({ error: "Invalid id." });
  }
  if (!SUBMISSION_TRANSITIONS[next]) {
    return res.status(400).json({ error: "Unknown submission status." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: bidRows } = await client.query(`SELECT id, bid_number, status FROM bids WHERE id = $1 FOR UPDATE`, [id]);
    const bid = bidRows[0];
    if (!bid) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Bid not found." });
    }

    const { rows: subRows } = await client.query(
      `SELECT id, supplier_name, status FROM bid_submissions WHERE id = $1 AND bid_id = $2 FOR UPDATE`,
      [submissionId, id]
    );
    const submission = subRows[0];
    if (!submission) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "That supplier bid was not found." });
    }

    if (submission.status === next) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: `That bid is already ${next}.` });
    }

    const allowed = SUBMISSION_TRANSITIONS[submission.status] || [];
    if (!allowed.includes(next)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: `A bid that is ${submission.status} cannot be marked ${next}.` });
    }

    if (next === "awarded" && bid.status === "cancelled") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "This package was cancelled." });
    }

    // Awarding supersedes any previous winner, so demote the old one in the
    // same transaction. The partial unique index would reject a second award
    // outright; this keeps the correction an explicit, recorded move instead.
    if (next === "awarded") {
      await client.query(
        `UPDATE bid_submissions SET status = 'rejected', awarded_at = NULL
         WHERE bid_id = $1 AND status = 'awarded' AND id <> $2`,
        [id, submissionId]
      );
    }

    const updated = await client.query(
      `UPDATE bid_submissions
       SET status = $1::varchar(20),
           awarded_at = CASE WHEN $1::varchar(20) = 'awarded' THEN NOW() ELSE awarded_at END
       WHERE id = $2
       RETURNING id, supplier_name AS "supplierName", total_amount AS "totalAmount", status`,
      [next, submissionId]
    );

    // An award also closes the package, in the same transaction.
    let bidRecord = null;
    if (next === "awarded" && bid.status !== "awarded") {
      const bidUpdate = await client.query(
        `UPDATE bids SET status = 'awarded', opened_at = COALESCE(opened_at, NOW()),
                         closed_at = COALESCE(closed_at, NOW()), updated_at = NOW()
         WHERE id = $1
         RETURNING id, status, closed_at AS "closedAt"`,
        [id]
      );
      bidRecord = bidUpdate.rows[0];
    }

    const actorResult = await client.query(`SELECT full_name FROM users WHERE id = $1`, [req.user.sub]);
    await activity.record(
      {
        entity: "bid",
        entityId: id,
        ref: bid.bid_number,
        action: next === "awarded" ? "awarded" : "status_change",
        from: submission.status,
        to: next,
        actor: { sub: req.user.sub, fullName: actorResult.rows[0]?.full_name || null },
        note: note || `${submission.supplier_name}`,
      },
      client
    );

    await client.query("COMMIT");
    return res.json({
      submission: updated.rows[0],
      bid: bidRecord,
      message:
        next === "awarded"
          ? `${submission.supplier_name} was awarded the bid.`
          : `Bid marked as ${next}.`,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Submission status error:", err);
    return res.status(500).json({ error: "Could not update that supplier bid." });
  } finally {
    client.release();
  }
});

/* ------------------------------------------------------------------ */
/* Analytics                                                           */
/* ------------------------------------------------------------------ */

/**
 * GET /api/bids/analytics/summary
 *
 * Headline numbers for the page: how much was awarded, how much that saved
 * against the original estimate, and how the packages are distributed.
 */
router.get("/bids/analytics/summary", requireAuth, async (req, res) => {
  try {
    const [totals, distribution, savings] = await Promise.all([
      pool.query(
        // Aliases are quoted: an unquoted camelCase alias is folded to lower case by
        // Postgres, so `openPackages` comes back as `openpackages` and reads as
        // undefined on this side.
        `SELECT
           (SELECT COUNT(*)::int FROM bids) AS packages,
           (SELECT COUNT(*)::int FROM bids WHERE status = 'open') AS "openPackages",
           (SELECT COUNT(*)::int FROM bids WHERE status = 'awarded') AS "awardedPackages",
           (SELECT COUNT(*)::int FROM bid_submissions) AS submissions,
           (SELECT COUNT(DISTINCT supplier_name)::int FROM bid_submissions) AS suppliers,
           (SELECT COALESCE(SUM(total_amount), 0) FROM bid_submissions WHERE status = 'awarded') AS "awardedValue",
           (SELECT COUNT(*)::int FROM bid_submissions WHERE status = 'awarded'
              AND submitted_at >= NOW() - INTERVAL '30 days') AS "awardedLast30d"`
      ),
      pool.query(
        `SELECT status, COUNT(*)::int AS count FROM bids GROUP BY status ORDER BY count DESC`
      ),
      pool.query(
        `SELECT
           COALESCE(SUM(r.estimated_amount), 0) AS estimated,
           COALESCE(SUM(s.total_amount), 0) AS awarded
         FROM bids b
         JOIN bid_submissions s ON s.bid_id = b.id AND s.status = 'awarded'
         JOIN procurement_requests r ON r.id = b.request_id`
      ),
    ]);

    const t = totals.rows[0] || {};
    const estimated = money(savings.rows[0]?.estimated);
    const awarded = money(savings.rows[0]?.awarded);

    return res.json({
      packages: t.packages || 0,
      openPackages: t.openPackages || 0,
      awardedPackages: t.awardedPackages || 0,
      submissions: t.submissions || 0,
      suppliers: t.suppliers || 0,
      awardedValue: money(t.awardedValue),
      awardedLast30d: t.awardedLast30d || 0,
      estimatedValue: estimated,
      // Only meaningful against a real estimate. With none on file, reporting
      // a negative saving would read as "overspent" when nothing was measured.
      savings: estimated > 0 ? estimated - awarded : 0,
      savingsPct: estimated > 0 ? Math.round(((estimated - awarded) / estimated) * 100) : 0,
      distribution: distribution.rows,
    });
  } catch (err) {
    console.error("Bid analytics error:", err);
    return res.status(500).json({ error: "Could not load bidding analytics." });
  }
});

module.exports = router;