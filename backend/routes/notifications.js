const express = require("express");
const pool = require("../db");
const activity = require("../services/activity");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

/**
 * GET /api/notifications
 *
 * What the bell shows: recent activity from the shared audit trail (requests,
 * quotations, purchase orders, documents) plus the requests still waiting on a
 * decision. Read tracking lives in the browser (localStorage), so there is no
 * per-user read state to store.
 */
router.get("/", requireAuth, async (req, res) => {
  try {
    const [items, waitingResult] = await Promise.all([
      activity.recent(25),
      // Requests sitting in a state that needs a decision.
      pool.query(`
        SELECT COUNT(*)::int AS total, MIN(requested_at) AS oldest
        FROM procurement_requests
        WHERE status = 'pending'
      `),
    ]);

    const waiting = waitingResult.rows[0] || {};

    return res.json({
      items,
      awaitingDecision: {
        total: Number(waiting.total) || 0,
        oldest: waiting.oldest || null,
      },
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Notifications error:", err);
    return res.status(500).json({ error: "Could not load notifications." });
  }
});

module.exports = router;