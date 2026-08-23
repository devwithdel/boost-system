const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");

const pool = require("../db");
const { requireAuth, COOKIE_NAME } = require("../middleware/auth");

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

function isProd() {
  return process.env.NODE_ENV === "production";
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

      return res.status(401).json(genericError);
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

module.exports = router;
