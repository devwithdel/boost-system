require("dotenv").config();

const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const authRoutes = require("./routes/auth");

const app = express();
const PORT = process.env.PORT || 4000;

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
      },
    },
  })
);

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || "http://localhost:4000",
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());

// --- API routes ---
app.use("/api/auth", authRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true }));

// --- Static frontend ---
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");
app.use(express.static(FRONTEND_DIR));

app.get("/", (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "login.html"));
});

// --- 404 + error handling ---
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Something went wrong." });
});

app.listen(PORT, () => {
  console.log(`BOOST running at http://localhost:${PORT}`);
});
