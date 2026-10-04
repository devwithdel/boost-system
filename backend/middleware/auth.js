const jwt = require("jsonwebtoken");

const COOKIE_NAME = process.env.COOKIE_NAME || "boost_token";

function readSession(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;

  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (_err) {
    return null;
  }
}

function optionalAuth(req, _res, next) {
  req.user = readSession(req);
  return next();
}

/**
 * API authentication middleware. It reads the JWT from the httpOnly cookie,
 * verifies it, and attaches the decoded payload to req.user.
 */
function requireAuth(req, res, next) {
  req.user = readSession(req);

  if (!req.user) {
    return res.status(401).json({ error: "Not authenticated." });
  }

  return next();
}

/**
 * Page authentication middleware. Invalid or missing sessions are redirected
 * to the login page while preserving the page the user originally requested.
 */
function requirePageAuth(req, res, next) {
  req.user = readSession(req);

  if (!req.user) {
    const nextPath = req.originalUrl === "/" ? "/dashboard" : req.originalUrl;
    return res.redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  return next();
}

/**
 * Sends authenticated users away from the sign-in page so they do not land on
 * a second login screen after refreshing or using the browser back button.
 */
function redirectIfAuthenticated(req, res, next) {
  req.user = readSession(req);

  if (req.user) {
    const requestedNext = req.query?.next;
    if (
      typeof requestedNext === "string" &&
      requestedNext.startsWith("/") &&
      !requestedNext.startsWith("//") &&
      !requestedNext.includes("\\")
    ) {
      return res.redirect(requestedNext);
    }
    return res.redirect("/dashboard");
  }

  return next();
}

module.exports = {
  COOKIE_NAME,
  optionalAuth,
  requireAuth,
  requirePageAuth,
  redirectIfAuthenticated,
};
