const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");

const pool = require("../db");
const { requireAuth, COOKIE_NAME } = require("../middleware/auth");
const { sendPasswordReset } = require("../services/mailer");

const router = express.Router();

// Slows brute-force attempts against the login endpoint specifically.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Please try again later." },
});

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 15;

// Reset links are short-lived and single-use: 30 minutes is long enough to
// open a mail on a phone and short enough that a link left in a mailbox or a
// shared screen expires before anyone can use it.
const RESET_TOKEN_MINUTES = 30;
const RESET_TOKEN_BYTES = 32;
const MIN_PASSWORD_LENGTH = 8;

// Two endpoints, one budget. Otherwise an attacker could burn the request
// limit on /forgot-password and still get 10 tries at guessing a token.
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many reset attempts. Please try again later." },
});

function isProd() {
  return process.env.NODE_ENV === "production";
}

function baseUrl(req) {
  return (process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
}

/** Only the hash of a reset token is ever stored or compared. */
function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function maskEmail(email) {
  const [name, domain] = String(email || "").split("@");
  if (!domain) return "your account";
  const head = name.slice(0, 2);
  return `${head}${"*".repeat(Math.max(name.length - 2, 1))}@${domain}`;
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

function cookieOptions() {
  return {
    httpOnly: true,
    secure: isProd(), // requires HTTPS in production
    sameSite: "lax",
    maxAge: 8 * 60 * 60 * 1000, // 8 hours, mirrors JWT_EXPIRES_IN default
    path: "/",
  };
}

/**
 * POST /api/auth/login
 * Body: { identifier: string (email or username), password: string }
 */
router.post("/login", loginLimiter, async (req, res) => {
  const { identifier, password } = req.body || {};

  if (!identifier || !password) {
    return res.status(400).json({ error: "Email/username and password are required." });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, full_name, email, username, password_hash, role, is_active,
              failed_attempts, locked_until
       FROM users
       WHERE email = $1 OR username = $1
       LIMIT 1`,
      [identifier.trim().toLowerCase()]
    );

    const user = rows[0];

    // Same generic error whether the account doesn't exist or the password
    // is wrong — avoids confirming which accounts exist.
    const genericError = { error: "Invalid email/username or password." };

    if (!user || !user.is_active) {
      return res.status(401).json(genericError);
    }

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return res.status(423).json({
        error: `Account temporarily locked due to repeated failed attempts. Try again after ${new Date(
          user.locked_until
        ).toLocaleTimeString()}.`,
      });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatches) {
      const attempts = user.failed_attempts + 1;
      const lock = attempts >= MAX_FAILED_ATTEMPTS;

      await pool.query(
        `UPDATE users
         SET failed_attempts = $1,
             locked_until = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [
          lock ? 0 : attempts,
          lock ? new Date(Date.now() + LOCK_DURATION_MINUTES * 60 * 1000) : null,
          user.id,
        ]
      );

      // Tell the user how close they are to a lockout so a typo doesn't
      // silently cost them 15 minutes. Still never reveals whether the
      // account exists.
      const remaining = lock ? 0 : MAX_FAILED_ATTEMPTS - attempts;
      return res.status(401).json({
        ...genericError,
        attemptsRemaining: remaining,
        hint: lock
          ? `Too many failed attempts. This account is now locked for ${LOCK_DURATION_MINUTES} minutes.`
          : remaining <= 2
            ? `${remaining} attempt${remaining === 1 ? "" : "s"} remaining before a ${LOCK_DURATION_MINUTES}-minute lockout.`
            : undefined,
      });
    }

    // Successful login — reset failed attempts, stamp last login
    await pool.query(
      `UPDATE users
       SET failed_attempts = 0, locked_until = NULL, last_login_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [user.id]
    );

    const token = jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
    );

    res.cookie(COOKIE_NAME, token, cookieOptions());

    return res.json({
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        username: user.username,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

/**
 * POST /api/auth/logout
 */
router.post("/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
  return res.json({ ok: true });
});

/**
 * POST /api/auth/forgot-password
 * Body: { email: string }
 *
 * Always answers with the same message so the endpoint cannot be used to
 * discover which addresses have an account. The reset link goes out by email;
 * with no SMTP server configured the server prints it to its own console
 * (development only — see services/mailer.js).
 */
router.post("/forgot-password", resetLimiter, async (req, res) => {
  const { email } = req.body || {};
  const generic = {
    message:
      "If that address belongs to a BOOST account, a password reset link is on its way. It expires in " +
      RESET_TOKEN_MINUTES +
      " minutes.",
  };

  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "Enter the email address on your account." });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, full_name, email FROM users
       WHERE email = $1 AND is_active = TRUE
       LIMIT 1`,
      [email.trim().toLowerCase()]
    );
    const user = rows[0];

    // No mail for locked or disabled accounts: the user cannot sign in until an
    // administrator unlocks them, so a link would only add a dead end. The
    // caller still gets the generic reply.
    if (!user) return res.json(generic);

    // Only the newest link stays usable. Anything already issued is retired
    // first, so an older mail in someone's inbox can't be replayed.
    await pool.query(
      `UPDATE password_reset_tokens SET used_at = NOW()
       WHERE user_id = $1 AND used_at IS NULL`,
      [user.id]
    );

    const token = crypto.randomBytes(RESET_TOKEN_BYTES).toString("hex");
    const expiresAt = new Date(Date.now() + RESET_TOKEN_MINUTES * 60 * 1000);

    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, requested_ip)
       VALUES ($1, $2, $3, $4)`,
      [user.id, hashToken(token), expiresAt, req.ip || null]
    );

    const resetUrl = `${baseUrl(req)}/reset-password?token=${encodeURIComponent(token)}`;
    const { delivered } = await sendPasswordReset({
      to: user.email,
      fullName: user.full_name,
      resetUrl,
      expiresMinutes: RESET_TOKEN_MINUTES,
    });

    console.log(`[auth] password reset requested for ${user.email} (delivered via ${delivered})`);

    // Development convenience only: with no mail server there is no inbox to
    // check, so the link comes back to the screen that asked for it. Never in
    // production, where the response would hand a reset link to anyone who
    // knows an address.
    if (!isProd() && delivered === "console") {
      return res.json({ ...generic, delivered: "console", resetUrl });
    }

    return res.json(generic);
  } catch (err) {
    console.error("Forgot password error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

/**
 * GET /api/auth/reset-password/:token
 * Lets the reset form check the link before showing a password field.
 */
router.get("/reset-password/:token", resetLimiter, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.expires_at, u.email
       FROM password_reset_tokens t
       JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = $1 AND t.used_at IS NULL AND u.is_active = TRUE
       LIMIT 1`,
      [hashToken(req.params.token || "")]
    );

    const row = rows[0];
    const expired = row && new Date(row.expires_at) <= new Date();

    if (!row || expired) {
      return res.status(400).json({
        valid: false,
        error: "This reset link is invalid or has expired. Please request a new one.",
      });
    }

    return res.json({
      valid: true,
      email: maskEmail(row.email),
      expiresAt: row.expires_at,
      expiresInMinutes: Math.max(1, Math.round((new Date(row.expires_at) - Date.now()) / 60000)),
    });
  } catch (err) {
    console.error("Reset token check error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

/**
 * POST /api/auth/reset-password
 * Body: { token: string, password: string }
 *
 * Spends the token and sets the new password. Any existing session cookie is
 * left alone, but a fresh one is returned so the user is signed in without a
 * second round trip through the sign-in form.
 */
router.post("/reset-password", resetLimiter, async (req, res) => {
  const { token, password } = req.body || {};

  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "This reset link is invalid or has expired." });
  }

  const problem = passwordProblem(password);
  if (problem) return res.status(400).json({ error: problem });

  try {
    const { rows } = await pool.query(
      `SELECT t.id AS token_id, t.user_id, t.expires_at,
              u.id, u.full_name, u.email, u.username, u.role, u.password_hash
       FROM password_reset_tokens t
       JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = $1 AND t.used_at IS NULL AND u.is_active = TRUE
       LIMIT 1`,
      [hashToken(token)]
    );

    const row = rows[0];

    if (!row || new Date(row.expires_at) <= new Date()) {
      return res.status(400).json({ error: "This reset link is invalid or has expired. Please request a new one." });
    }

    // Someone who asked for a reset may well have the old password still open
    // in another tab. Refuse the new one if it is what we just replaced.
    if (await bcrypt.compare(password, row.password_hash)) {
      return res.status(400).json({ error: "Choose a password you have not used before." });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Clear the lockout too: a user who forgot their password is very often
    // locked out by the failed attempts that followed forgetting it.
    await pool.query(
      `UPDATE users
       SET password_hash = $1, failed_attempts = 0, locked_until = NULL, updated_at = NOW()
       WHERE id = $2`,
      [passwordHash, row.user_id]
    );

    // Single use, and every other outstanding link dies with it.
    await pool.query(
      `UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL`,
      [row.user_id]
    );

    const jwtToken = jwt.sign(
      { sub: row.user_id, email: row.email, role: row.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
    );

    res.cookie(COOKIE_NAME, jwtToken, cookieOptions());

    console.log(`[auth] password reset completed for ${row.email}`);

    return res.json({
      message: "Your password has been updated.",
      user: {
        id: row.user_id,
        fullName: row.full_name,
        email: row.email,
        username: row.username,
        role: row.role,
      },
    });
  } catch (err) {
    console.error("Reset password error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

/**
 * GET /api/auth/me
 * Returns the current authenticated user (used by the dashboard on load).
 */
router.get("/me", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, full_name, email, username, role FROM users WHERE id = $1`,
      [req.user.sub]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: "Not authenticated." });

    return res.json({
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        username: user.username,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("Me endpoint error:", err);
    return res.status(500).json({ error: "Something went wrong." });
  }
});

/**
 * GET /api/auth/session-info
 * Security posture of the signed-in account (for the Settings screen).
 */
router.get("/session-info", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT last_login_at, failed_attempts, locked_until, created_at
       FROM users WHERE id = $1`,
      [req.user.sub]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: "Not authenticated." });

    const locked = Boolean(user.locked_until && new Date(user.locked_until) > new Date());

    return res.json({
      lastLoginAt: user.last_login_at,
      failedAttempts: Number(user.failed_attempts) || 0,
      maxAttempts: MAX_FAILED_ATTEMPTS,
      lockedUntil: locked ? user.locked_until : null,
      memberSince: user.created_at,
      sessionExpiresInHours: Math.round(
        (Number(process.env.JWT_EXPIRES_IN?.match(/^(\d+)h$/)?.[1] || 8))
      ),
    });
  } catch (err) {
    console.error("Session info error:", err);
    return res.status(500).json({ error: "Could not load account security details." });
  }
});

module.exports = router;
