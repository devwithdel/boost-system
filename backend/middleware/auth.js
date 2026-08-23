const jwt = require("jsonwebtoken");

const COOKIE_NAME = process.env.COOKIE_NAME || "boost_token";

/**
 * Reads the JWT from the httpOnly cookie, verifies it, and attaches
 * the decoded payload to req.user. Responds 401 if missing/invalid.
 */
function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];

  if (!token) {
    return res.status(401).json({ error: "Not authenticated." });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ error: "Session expired. Please sign in again." });
  }
}

module.exports = { requireAuth, COOKIE_NAME };
