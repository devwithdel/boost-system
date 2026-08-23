/**
 * Creates (or updates) a single local test CLIENT account, using
 * credentials from .env (SEED_EMAIL / SEED_PASSWORD / SEED_FULL_NAME).
 *
 * Usage:
 *   npm run seed
 *
 * This is for local development only — do not run against production
 * with placeholder credentials.
 */
require("dotenv").config();
const bcrypt = require("bcrypt");
const pool = require("../db");

async function seed() {
  const email = (process.env.SEED_EMAIL || "").trim().toLowerCase();
  const password = process.env.SEED_PASSWORD;
  const fullName = process.env.SEED_FULL_NAME || "Test Client";

  if (!email || !password) {
    console.error("SEED_EMAIL and SEED_PASSWORD must be set in .env before seeding.");
    process.exit(1);
  }

  if (password === "change_me_before_seeding") {
    console.error("Refusing to seed with the placeholder password. Set SEED_PASSWORD in .env first.");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await pool.query(
    `INSERT INTO users (full_name, email, password_hash, role)
     VALUES ($1, $2, $3, 'client')
     ON CONFLICT (email)
     DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = NOW()`,
    [fullName, email, passwordHash]
  );

  console.log(`Seeded client account: ${email}`);
  await pool.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
