const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

/**
 * GET /api/dashboard
 * Overview payload for the dashboard page: summary metrics, monthly
 * quotation activity, document breakdown and pipeline stages.
 */
router.get("/", requireAuth, async (req, res) => {
  try {
    const [summaryResult, monthlyResult, docsResult, queueResult, pipelineResult] = await Promise.all([
      pool.query(`
        WITH month_start AS (
          SELECT date_trunc('month', CURRENT_DATE) AS this_month,
                 date_trunc('month', CURRENT_DATE) - INTERVAL '1 month' AS last_month
        )
        SELECT
          (SELECT COUNT(*)::int FROM procurement_requests
            WHERE status IN ('pending','approved','in_progress')) AS active_requests,
          (SELECT COUNT(*)::int FROM procurement_requests
            WHERE status = 'pending') AS pending_requests,
          (SELECT COUNT(*)::int FROM procurement_requests
            WHERE status IN ('pending','approved','in_progress')
              AND requested_at >= NOW() - INTERVAL '7 days') AS requests_new_7d,
          (SELECT COUNT(*)::int FROM quotations WHERE status = 'active') AS open_quotations,
          (SELECT COUNT(*)::int FROM quotations WHERE status = 'active' AND created_at >= NOW() - INTERVAL '7 days')
            AS quotations_reviewing,
          (SELECT COUNT(*)::int FROM quotations WHERE status = 'awarded'
            AND created_at >= date_trunc('year', CURRENT_DATE)) AS awarded_this_year,
          (SELECT COUNT(*)::int FROM quotations
            WHERE status IN ('awarded','expired','cancelled')
              AND created_at >= date_trunc('year', CURRENT_DATE)) AS decided_this_year,
          (SELECT COUNT(*)::int FROM quotations WHERE status = 'awarded'
            AND created_at >= NOW() - INTERVAL '30 days') AS won_last_30d,
          (SELECT COALESCE(SUM(total_amount), 0) FROM purchase_orders p, month_start m
            WHERE p.status IN ('approved','shipped','delivered')
              AND p.ordered_at >= m.this_month) AS revenue,
          (SELECT COALESCE(SUM(total_amount), 0) FROM purchase_orders p, month_start m
            WHERE p.status IN ('approved','shipped','delivered')
              AND p.ordered_at >= m.last_month AND p.ordered_at < m.this_month) AS revenue_last,
          (SELECT to_char(date_trunc('month', CURRENT_DATE), 'Mon') FROM month_start) AS revenue_month
      `),
      pool.query(`
        SELECT
          to_char(m.month, 'Mon') AS label,
          COUNT(q.id)::int AS submitted,
          COUNT(q.id) FILTER (WHERE q.status = 'awarded')::int AS won,
          COALESCE(SUM(q.total_amount), 0) AS value
        FROM generate_series(
          date_trunc('month', CURRENT_DATE) - INTERVAL '5 months',
          date_trunc('month', CURRENT_DATE),
          INTERVAL '1 month'
        ) AS m(month)
        LEFT JOIN quotations q ON date_trunc('month', q.created_at) = m.month
        GROUP BY m.month
        ORDER BY m.month
      `),
      pool.query(`
        SELECT
          document_type,
          COUNT(*)::int AS count,
          ROUND(COUNT(*) * 100.0 / NULLIF(SUM(COUNT(*)) OVER (), 0))::int AS percentage
        FROM documents
        GROUP BY document_type
        ORDER BY count DESC
      `),
      pool.query(`
        SELECT id, request_number AS "requestNumber", item_description AS description,
               estimated_amount AS "estimatedAmount", status, requested_at AS "requestedAt"
        FROM procurement_requests
        WHERE status = 'pending'
        ORDER BY requested_at ASC, id ASC
        LIMIT 5
      `),
      pool.query(`
        SELECT 'Pending requests' AS label, COUNT(*)::int AS count, '#e08a1b' AS color
          FROM procurement_requests WHERE status = 'pending'
        UNION ALL
        SELECT 'Approved requests', COUNT(*)::int, '#2f7bf6'
          FROM procurement_requests WHERE status = 'approved'
        UNION ALL
        SELECT 'In progress', COUNT(*)::int, '#7b5cf0'
          FROM procurement_requests WHERE status = 'in_progress'
        UNION ALL
        SELECT 'Completed', COUNT(*)::int, '#16a06a'
          FROM procurement_requests WHERE status = 'completed'
        UNION ALL
        SELECT 'Open orders', COUNT(*)::int, '#1e56c8'
          FROM purchase_orders WHERE status IN ('pending','approved','shipped')
      `),
    ]);

    const summary = summaryResult.rows[0] || {};
    const decided = Number(summary.decided_this_year) || 0;
    const awarded = Number(summary.awarded_this_year) || 0;
    const revenue = Number(summary.revenue) || 0;
    const revenueLast = Number(summary.revenue_last) || 0;

    return res.json({
      summary: {
        active_requests: Number(summary.active_requests) || 0,
        pending_requests: Number(summary.pending_requests) || 0,
        requests_new_7d: Number(summary.requests_new_7d) || 0,
        open_quotations: Number(summary.open_quotations) || 0,
        quotations_reviewing: Number(summary.quotations_reviewing) || 0,
        won_last_30d: Number(summary.won_last_30d) || 0,
        win_rate: decided ? Math.round((awarded / decided) * 100) : 0,
        revenue,
        revenue_change_pct: revenueLast
          ? Math.round(((revenue - revenueLast) / revenueLast) * 100)
          : revenue > 0
            ? 100
            : 0,
      },
      revenue_month: String(summary.revenue_month || "").toLowerCase(),
      monthly: monthlyResult.rows,
      documentsByType: docsResult.rows,
      approvalQueue: queueResult.rows,
      pipeline: pipelineResult.rows,
      greeting: `${Number(summary.pending_requests) || 0} pending request(s) and ${
        Number(summary.open_quotations) || 0
      } open quotation(s) need attention.`,
    });
  } catch (err) {
    console.error("Dashboard data error:", err);
    return res.status(500).json({ error: "Could not load dashboard data. Please try again." });
  }
});

module.exports = router;