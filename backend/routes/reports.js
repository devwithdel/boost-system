const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

/* Reports read across every module, so they are computed on demand from the
   same tables the modules write. Nothing is stored, which means a report can
   never drift from the data it describes. */

function money(value) {
  return Number(value) || 0;
}

function str(req, key) {
  return String(req.query[key] || "").trim();
}

/**
 * Date window shared by every report. Defaults to the last 90 days, which is
 * long enough to be worth reading and short enough to still be current.
 *
 * Only the shape is validated here; the values are bound as parameters, and
 * both bounds are clamped so a reversed range cannot ask for a negative
 * interval.
 */
function window(req) {
  const days = Math.min(Math.max(Number.parseInt(req.query.days, 10) || 90, 7), 730);
  return { days, from: `NOW() - INTERVAL '${days} days'` };
}

/* ------------------------------------------------------------------ */
/* Spend                                                               */
/* ------------------------------------------------------------------ */

/**
 * GET /api/reports/spend?days=90&group=month
 * Awarded value over time, against the original estimates.
 */
router.get("/reports/spend", requireAuth, async (req, res) => {
  const { days, from } = window(req);

  // groupBy is chosen from a fixed map, never interpolated from the request.
  const GROUPS = {
    month: { expr: "date_trunc('month', s.awarded_at)", label: "to_char(date_trunc('month', s.awarded_at), 'Mon YYYY')" },
    supplier: { expr: "s.supplier_name", label: "s.supplier_name" },
    request: { expr: "COALESCE(r.request_number, '—')", label: "COALESCE(r.request_number, '—')" },
  };

  try {
    // Inside the try: a throw before it would escape as an unhandled rejection
    // and leave the request hanging with no response at all.
    const group = GROUPS[str(req, "group")] ? str(req, "group") : "month";
    const { expr, label } = GROUPS[group];

    const [series, totals, estimates] = await Promise.all([
      pool.query(
        `SELECT ${label} AS label,
                COUNT(*)::int AS awards,
                COALESCE(SUM(s.total_amount), 0) AS value
         FROM bid_submissions s
         LEFT JOIN bids b ON b.id = s.bid_id
         LEFT JOIN procurement_requests r ON r.id = b.request_id
         WHERE s.status = 'awarded' AND s.awarded_at >= ${from}
         GROUP BY ${expr}
         ORDER BY ${expr}`,
      ),
      pool.query(
        `SELECT COALESCE(SUM(s.total_amount), 0) AS awarded, COUNT(*)::int AS awards
         FROM bid_submissions s
         WHERE s.status = 'awarded' AND s.awarded_at >= ${from}`
      ),
      pool.query(
        `SELECT COALESCE(SUM(r.estimated_amount), 0) AS estimated
         FROM bid_submissions s
         JOIN bids b ON b.id = s.bid_id
         JOIN procurement_requests r ON r.id = b.request_id
         WHERE s.status = 'awarded' AND s.awarded_at >= ${from}`
      ),
    ]);

    const awarded = money(totals.rows[0]?.awarded);
    const estimated = money(estimates.rows[0]?.estimated);

    return res.json({
      group,
      days,
      series: series.rows,
      totals: {
        awarded,
        estimated,
        awards: totals.rows[0]?.awards || 0,
        // Only measured where an estimate exists; an award with no linked
        // request has nothing to be under or over.
        savings: estimated > 0 ? estimated - awarded : 0,
        savingsPct: estimated > 0 ? Math.round(((estimated - awarded) / estimated) * 100) : 0,
      },
    });
  } catch (err) {
    console.error("Spend report error:", err);
    return res.status(500).json({ error: "Could not build the spend report." });
  }
});

/* ------------------------------------------------------------------ */
/* Suppliers                                                           */
/* ------------------------------------------------------------------ */

/**
 * GET /api/reports/suppliers?days=90
 * Who bids, how often they win, and what that is worth.
 */
router.get("/reports/suppliers", requireAuth, async (req, res) => {
  const { days, from } = window(req);

  try {
    const { rows } = await pool.query(
      `SELECT s.supplier_name AS "supplierName",
              COUNT(*)::int AS submissions,
              COUNT(*) FILTER (WHERE s.status = 'awarded')::int AS awards,
              COUNT(*) FILTER (WHERE s.status = 'rejected')::int AS rejections,
              COALESCE(SUM(s.total_amount) FILTER (WHERE s.status = 'awarded'), 0) AS "awardedValue",
              MAX(s.submitted_at) AS "lastBidAt",
              -- Win rate measured against decided bids only: a supplier who has
              -- bid twice and been decided once should not look 50% certain.
              ROUND(
                100.0 * COUNT(*) FILTER (WHERE s.status = 'awarded') /
                NULLIF(COUNT(*) FILTER (WHERE s.status IN ('awarded','rejected')), 0)
              )::int AS "winRate"
       FROM bid_submissions s
       WHERE s.submitted_at >= ${from}
       GROUP BY s.supplier_name
       ORDER BY "awardedValue" DESC, submissions DESC`,
    );

    const decided = rows.filter((r) => r.awards + r.rejections > 0);
    const leader = rows.find((r) => r.awards > 0) || null;

    return res.json({
      days,
      rows,
      totals: {
        suppliers: rows.length,
        submissions: rows.reduce((s, r) => s + r.submissions, 0),
        awards: rows.reduce((s, r) => s + r.awards, 0),
        // Portfolio-wide win rate, not an average of per-supplier rates: an
        // average would weight a supplier with one bid the same as one with ten.
        winRate: decided.length
          ? Math.round((rows.reduce((s, r) => s + r.awards, 0) / rows.reduce((s, r) => s + r.awards + r.rejections, 0)) * 100)
          : 0,
        topSupplier: leader ? leader.supplierName : null,
        topValue: leader ? money(leader.awardedValue) : 0,
      },
    });
  } catch (err) {
    console.error("Supplier report error:", err);
    return res.status(500).json({ error: "Could not build the supplier report." });
  }
});

/* ------------------------------------------------------------------ */
/* Cycle time                                                          */
/* ------------------------------------------------------------------ */

/**
 * GET /api/reports/cycle-times?days=90
 *
 * How long work actually takes, measured from the shared activity trail
 * rather than from any denormalised column, so it reflects what happened.
 */
router.get("/reports/cycle-times", requireAuth, async (req, res) => {
  const { days, from } = window(req);

  try {
    const [requests, awards] = await Promise.all([
      // Raised -> approved, from the approval event in the trail.
      pool.query(
        `SELECT r.department,
                COUNT(*)::int AS requests,
                ROUND(AVG(EXTRACT(EPOCH FROM (a.created_at - r.requested_at)) / 3600), 1) AS "avgHours",
                ROUND(MAX(EXTRACT(EPOCH FROM (a.created_at - r.requested_at)) / 3600), 1) AS "maxHours"
         FROM procurement_requests r
         JOIN activity_log a
           ON a.entity_type = 'request' AND a.entity_id = r.id AND a.to_status = 'approved'
         WHERE r.requested_at >= ${from}
         GROUP BY r.department
         ORDER BY "avgHours" DESC NULLS LAST`,
      ),
      // Submission -> award, the decision half of the cycle.
      pool.query(
        `SELECT b.bid_number AS "bidNumber", b.title, s.supplier_name AS "supplierName",
                ROUND(EXTRACT(EPOCH FROM (s.awarded_at - b.opened_at)) / 3600, 1) AS "hoursToAward",
                COUNT(*) OVER ()::int AS "totalAwards"
         FROM bid_submissions s
         JOIN bids b ON b.id = s.bid_id
         WHERE s.status = 'awarded' AND s.awarded_at >= ${from} AND b.opened_at IS NOT NULL
         ORDER BY "hoursToAward" DESC`,
      ),
    ]);

    const deptRows = requests.rows.filter((r) => r.avgHours !== null);
    const awardRows = awards.rows.filter((r) => r.hoursToAward !== null);

    const avg = (rows, key) =>
      rows.length ? Math.round((rows.reduce((s, r) => s + money(r[key]), 0) / rows.length) * 10) / 10 : 0;

    const slowest = [...awardRows].sort((a, b) => b.hoursToAward - a.hoursToAward).slice(0, 5);

    return res.json({
      days,
      departments: deptRows,
      awards: awardRows,
      totals: {
        departments: deptRows.length,
        requestsApproved: deptRows.reduce((s, r) => s + r.requests, 0),
        avgApprovalHours: avg(deptRows, "avgHours"),
        slowestDepartment: deptRows[0] ? deptRows[0].department : null,
        avgAwardHours: avg(awardRows, "hoursToAward"),
        awardsDecided: awardRows.length,
        slowestAwards: slowest,
      },
    });
  } catch (err) {
    console.error("Cycle-time report error:", err);
    return res.status(500).json({ error: "Could not build the cycle-time report." });
  }
});

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

/**
 * GET /api/reports/overview?days=90
 *
 * One request for the four tiles at the top of the page. Kept separate from
 * the individual reports so the tiles do not each re-query the same tables.
 */
router.get("/reports/overview", requireAuth, async (req, res) => {
  const { days, from } = window(req);

  try {
    const [volume, value, cycle, pending] = await Promise.all([
      pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM bids WHERE created_at >= ${from}) AS packages,
           (SELECT COUNT(*)::int FROM bids WHERE status = 'open') AS "openPackages",
           (SELECT COUNT(*)::int FROM bid_submissions WHERE submitted_at >= ${from}) AS submissions`
      ),
      pool.query(
        `SELECT COALESCE(SUM(s.total_amount), 0) AS awarded,
                COALESCE(SUM(r.estimated_amount), 0) AS estimated
         FROM bid_submissions s
         LEFT JOIN bids b ON b.id = s.bid_id
         LEFT JOIN procurement_requests r ON r.id = b.request_id
         WHERE s.status = 'awarded' AND s.awarded_at >= ${from}`
      ),
      pool.query(
        `SELECT ROUND(AVG(EXTRACT(EPOCH FROM (a.created_at - r.requested_at)) / 3600), 1) AS "avgHours"
         FROM procurement_requests r
         JOIN activity_log a
           ON a.entity_type = 'request' AND a.entity_id = r.id AND a.to_status = 'approved'
         WHERE r.requested_at >= ${from}`
      ),
      pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM procurement_requests WHERE status = 'pending') AS "pendingRequests",
           (SELECT COUNT(*)::int FROM quotations WHERE status = 'active') AS "activeQuotations",
           (SELECT COUNT(*)::int FROM bids WHERE status = 'open') AS "openBids"`
      ),
    ]);

    const v = volume.rows[0] || {};
    const val = value.rows[0] || {};
    const estimated = money(val.estimated);
    const awarded = money(val.awarded);
    const p = pending.rows[0] || {};

    return res.json({
      days,
      packages: v.packages || 0,
      openPackages: v.openPackages || 0,
      submissions: v.submissions || 0,
      awardedValue: awarded,
      estimatedValue: estimated,
      // Zero unless there is an estimate to compare against — an award with no
      // linked request is unmeasured, not overspent.
      savings: estimated > 0 ? estimated - awarded : 0,
      savingsPct: estimated > 0 ? Math.round(((estimated - awarded) / estimated) * 100) : 0,
      avgApprovalHours: money(cycle.rows[0]?.avgHours),
      pendingRequests: p.pendingRequests || 0,
      activeQuotations: p.activeQuotations || 0,
      openBids: p.openBids || 0,
    });
  } catch (err) {
    console.error("Reports overview error:", err);
    return res.status(500).json({ error: "Could not load the report summary." });
  }
});

module.exports = router;