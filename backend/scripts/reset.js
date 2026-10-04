/**
 * Resets the local demo data to a clean, realistic seed.
 *
 * Testing moves records through their workflow and creates extra ones, which
 * slowly makes the dashboard meaningless (everything approved, no pending
 * queue, flat charts). This clears the demo tables and re-runs the seed so
 * every module has a believable mix again.
 *
 *   npm run reset
 *
 * Refuses to run against production, and never touches the users table — you
 * keep your login.
 */
require("dotenv").config();
const { execFileSync } = require("child_process");
const path = require("path");
const pool = require("../db");

// Children first: attachments and the trail reference requests.
const TABLES = ["request_attachments", "activity_log", "documents", "purchase_orders", "quotations", "procurement_requests"];

async function reset() {
  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to reset demo data with NODE_ENV=production.");
    process.exit(1);
  }

  const expected = process.env.SEED_EMAIL;
  if (!expected) {
    console.error("SEED_EMAIL is not set in .env, so this may not be the local demo database. Aborting.");
    process.exit(1);
  }

  // Cheap confirmation that we are pointed at the demo database before
  // deleting anything.
  const { rows } = await pool.query("SELECT email FROM users WHERE email = $1", [expected.toLowerCase()]);
  if (!rows.length) {
    console.error(`No user ${expected} in this database. Aborting rather than clearing someone else's data.`);
    process.exit(1);
  }

  console.log("Clearing demo data…");
  for (const table of TABLES) {
    const res = await pool.query(`DELETE FROM ${table}`);
    console.log(`  ${table.padEnd(22)} removed ${res.rowCount} row(s)`);
  }

  // Stale scan/attachment files on disk would otherwise accumulate forever.
  const uploads = path.join(__dirname, "..", "uploads");
  try {
    const fs = require("fs");
    const files = fs.readdirSync(uploads).filter((f) => !f.startsWith("."));
    for (const f of files) fs.unlinkSync(path.join(uploads, f));
    if (files.length) console.log(`  uploads/               removed ${files.length} file(s)`);
  } catch (err) {
    if (err.code !== "ENOENT") console.warn("  uploads/               could not be cleared:", err.message);
  }

  await pool.end();

  console.log("\nRe-seeding…");
  execFileSync(process.execPath, [path.join(__dirname, "seed.js")], { stdio: "inherit" });
  console.log("\nDone. Restart the server if it is running, then open http://localhost:4000");
}

reset().catch((err) => {
  console.error("Reset failed:", err);
  process.exit(1);
});