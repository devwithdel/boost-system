require("dotenv").config();

const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const authRoutes = require("./routes/auth");
const accountRoutes = require("./routes/account");
const biddingRoutes = require("./routes/bidding");
const dashboardRoutes = require("./routes/dashboard");
const moduleRoutes = require("./routes/modules");
const notificationRoutes = require("./routes/notifications");
const reportRoutes = require("./routes/reports");
const requestRoutes = require("./routes/requests");
const scannerRoutes = require("./routes/scanner");
const { optionalAuth, requirePageAuth, redirectIfAuthenticated } = require("./middleware/auth");

const app = express();
// PORT is read before the handlers below because the bind-failure message
// quotes the port it tried.
const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || "0.0.0.0";
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");

// Last line of defence. This is a single-process system, so one unhandled
// error anywhere (a native OCR failure, a bad stream) would otherwise take
// procurement offline for everyone. Log it loudly and keep serving; the
// supervisor restarts only if the process truly dies.
process.on("uncaughtException", (err) => {
  // A failure to bind is not a request-time fault, so "keep serving" is a lie:
  // the process stays alive, never listens, and every route returns a
  // connection error with nothing obviously wrong on screen. Fail loudly
  // instead, so the second copy of the server exits and the first one is
  // visibly the one holding the port.
  if (err && (err.code === "EADDRINUSE" || err.code === "EACCES")) {
    console.error(
      `\n[STARTUP FAILED] ${err.code === "EADDRINUSE" ? "Port " + PORT + " is already in use." : "Not permitted to bind port " + PORT + "."}\n` +
        `Another copy of BOOST is almost certainly already running. Stop it, or start this one on a different port:\n` +
        `  ${
          err.code === "EADDRINUSE"
            ? "  PowerShell:  Get-NetTCPConnection -State Listen -LocalPort " + PORT + " | Select-Object OwningProcess\n" +
              "               Stop-Process -Id (Get-NetTCPConnection -State Listen -LocalPort " + PORT + ").OwningProcess\n"
            : ""
        }` +
        `  Other port:   $env:PORT=4001; npm run dev\n`
    );
    process.exit(1);
  }

  console.error("UNCAUGHT EXCEPTION (server continues):", (err && err.stack) || err);
});
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION (server continues):", (reason && reason.stack) || reason);
});

function getAllowedOrigins() {
  const raw = process.env.FRONTEND_ORIGIN || "http://localhost:4000";
  return raw
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

if (!process.env.JWT_SECRET || process.env.JWT_SECRET === "replace_this_with_a_generated_secret") {
  console.warn(
    "\n[WARNING] JWT_SECRET is not set (or still the placeholder) in your .env file.\n" +
    "Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"\n"
  );
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        // No HTTPS on LAN/dev, so never ask browsers to upgrade
        // http:// subresources to https:// (that breaks all CSS/JS/img
        // on plain-HTTP hosts like 192.168.x.x). Re-enable behind TLS.
        upgradeInsecureRequests: null,
      },
    },
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      // Same-origin page loads and curl have no Origin header — allow them.
      if (!origin) return callback(null, true);
      const allowed = getAllowedOrigins();
      if (allowed.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
  })
);

// Scanner uploads arrive as base64 inside JSON, so allow larger bodies there.
app.use("/api/scanner", express.json({ limit: "12mb" }));
app.use(express.json());
app.use(cookieParser());

// Lightweight API request log — the only server-side trace of what the
// phone actually requested (successes are otherwise silent).
// no-store: fetch().json() cannot parse Express 304 (empty-body) replies,
// so API responses must never be revalidated from cache.
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  const started = Date.now();
  res.on("finish", () => {
    console.log(`[api] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - started}ms)`);
  });
  next();
});

// --- API routes ---
app.use("/api/auth", authRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/modules", requestRoutes);
app.use("/api/modules", moduleRoutes);
app.use("/api/scanner", scannerRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api", accountRoutes);
app.use("/api", biddingRoutes);
app.use("/api", reportRoutes);

// Short aliases so module pages can call /api/requests directly.
// requests.js is mounted first so it owns every /api/requests* path.
app.use("/api", requestRoutes);
app.use("/api", moduleRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true }));

// --- Authenticated and public pages ---
// Keep page routes ahead of express.static so /dashboard.html cannot bypass the
// same authentication check as the friendly /dashboard route.
// no-store keeps phones on the newest shell/JS instead of a stale cached copy.
function sendPage(res, file) {
  res.set("Cache-Control", "no-store");
  return res.sendFile(path.join(FRONTEND_DIR, file));
}

app.get("/", optionalAuth, (req, res) => {
  return req.user ? res.redirect("/dashboard") : sendPage(res, "login.html");
});

app.get("/login", redirectIfAuthenticated, (req, res) => {
  return sendPage(res, "login.html");
});

app.get("/login.html", redirectIfAuthenticated, (req, res) => {
  return sendPage(res, "login.html");
});

// Password recovery. /forgot-password is public like the sign-in page;
// /reset-password carries a single-use token, so it stays reachable even when a
// stale session cookie is still in the browser (the reset signs the user in
// again at the end).
app.get("/forgot-password", redirectIfAuthenticated, (req, res) => {
  return sendPage(res, "forgot-password.html");
});

app.get("/forgot-password.html", redirectIfAuthenticated, (req, res) => {
  return sendPage(res, "forgot-password.html");
});

app.get("/reset-password", (req, res) => {
  return sendPage(res, "reset-password.html");
});

app.get("/reset-password.html", (req, res) => {
  return sendPage(res, "reset-password.html");
});

app.get("/dashboard", requirePageAuth, (req, res) => {
  return sendPage(res, "dashboard.html");
});

app.get("/dashboard.html", requirePageAuth, (req, res) => {
  return sendPage(res, "dashboard.html");
});

// One route per module so no two modules share a page.
const MODULE_PAGES = [
  ["requests", "requests"],
  ["quotations", "quotations"],
  ["bidding", "bidding"],
  ["orders", "orders"],
  ["documents", "documents"],
  ["scanner", "scanner"],
  ["reports", "reports"],
  ["settings", "settings"],
];

MODULE_PAGES.forEach(([url, file]) => {
  app.get(`/${url}`, requirePageAuth, (req, res) => sendPage(res, `${file}.html`));
});

// --- Static frontend ---
app.use(express.static(FRONTEND_DIR));

// --- 404 + error handling ---
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Something went wrong." });
});

app.listen(PORT, HOST, () => {
  const os = require("os");
  const nets = os.networkInterfaces();
  const lanUrls = new Set();
  for (const addrs of Object.values(nets)) {
    for (const a of addrs || []) {
      if (a.family === "IPv4" && !a.internal) lanUrls.add(`http://${a.address}:${PORT}`);
    }
  }
  console.log(`BOOST running at http://localhost:${PORT}`);
  for (const url of lanUrls) console.log(`BOOST on your network at ${url}`);
  console.log(`Allowed CORS origins: ${getAllowedOrigins().join(", ")}`);
});
