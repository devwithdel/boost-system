const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");

const pool = require("../db");
const { requireAuth, COOKIE_NAME } = require("../middleware/auth");

const router = express.Router();

/* Self-service account actions for a signed-in user. Separate from routes/auth.js,
   which deals with proving who you are; this file deals with changing what you
   already are. */

const MIN_PASSWORD_LENGTH = 8;

// Kept tight: this endpoint accepts a password and compares it against the
// stored hash, so it must not become a way to grind guesses at a valid session.
const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again in a few minutes." },
});

function isProd() {
  return process.env.NODE_ENV === "production";
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: isProd(),
    sameSite: "lax",
    maxAge: 8 * 60 * 60 * 1000,
    path: "/",
  };
}

function passwordProblem(password) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must contain at least one letter and one number.";
  }
  return null;
}

/**
 * POST /api/account/change-password
 * Body: { currentPassword, newPassword }
 *
 * The signed-in counterpart to the forgot-password flow: someone who remembers
 * their password can change it without going near email or the console.
 *
 * The current password is required even though the caller already holds a valid
 * session. A stolen cookie should not be enough to lock the real owner out of
 * their own account.
 */
router.post("/account/change-password", changePasswordLimiter, requireAuth, async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || "");
  const newPassword = req.body?.newPassword;

  if (!currentPassword) {
    return res.status(400).json({ error: "Enter your current password." });
  }

  const problem = passwordProblem(newPassword);
  if (problem) return res.status(400).json({ error: problem });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT id, email, role, password_hash, is_active
       FROM users WHERE id = $1 FOR UPDATE`,
      [req.user.sub]
    );
    const user = rows[0];

    if (!user || !user.is_active) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Account not found." });
    }

    if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
      await client.query("ROLLBACK");
      return res.status(401).json({ error: "Your current password is not correct." });
    }

    if (await bcrypt.compare(newPassword, user.password_hash)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Choose a password you have not used before." });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    // The lockout is cleared at the same time: a run of failed attempts and a
    // deliberate password change are usually the same stuck-at-sign-in story.
    await client.query(
      `UPDATE users
       SET password_hash = $1, failed_attempts = 0, locked_until = NULL, updated_at = NOW()
       WHERE id = $2`,
      [passwordHash, user.id]
    );

    // Any outstanding reset link dies with the old password. Leaving it live
    // would let a reset email sent before the change overwrite the new one.
    await client.query(
      `UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL`,
      [user.id]
    );

    // Re-issue the session, so nobody gets signed out by their own change.
    const token = jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
    );
    res.cookie(COOKIE_NAME, token, cookieOptions());

    await client.query("COMMIT");

    console.log(`[account] password changed for ${user.email}`);

    return res.json({ message: "Your password has been changed." });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Change password error:", err);
    return res.status(500).json({ error: "Could not change your password." });
  } finally {
    client.release();
  }
});

/**
 * GET /api/account/summary
 *
 * What the Settings page needs beyond /api/auth/me: how much this account has
 * actually done, so the page can show a person's footprint rather than a list of
 * fields they already know.
 */
router.get("/account/summary", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM procurement_requests WHERE created_by = $1) AS "requestsRaised",
         (SELECT COUNT(*)::int FROM documents WHERE uploaded_by = $1) AS "documentsUploaded",
         (SELECT COUNT(*)::int FROM bids WHERE created_by = $1) AS "bidsCreated",
         (SELECT COUNT(*)::int FROM activity_log WHERE actor_id = $1) AS "actionsLogged",
         (SELECT MAX(created_at) FROM activity_log WHERE actor_id = $1) AS "lastActivityAt"`,
      [req.user.sub]
    );

    const row = rows[0] || {};
    return res.json({
      requestsRaised: row.requestsRaised || 0,
      documentsUploaded: row.documentsUploaded || 0,
      bidsCreated: row.bidsCreated || 0,
      actionsLogged: row.actionsLogged || 0,
      lastActivityAt: row.lastActivityAt || null,
    });
  } catch (err) {
    console.error("Account summary error:", err);
    return res.status(500).json({ error: "Could not load your activity summary." });
  }
});

module.exports = router;