/**
 * Applies backend/schema.sql to the configured database.
 *
 * The schema file is written to be idempotent (CREATE ... IF NOT EXISTS and
 * guarded backfills), so this is safe to run against an existing database —
 * it adds what is missing and leaves data alone. Useful after pulling changes
 * that add a table or column.
 *
 *   npm run migrate
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../db");

const schemaPath = path.join(__dirname, "..", "schema.sql");

(async () => {
  const sql = fs.readFileSync(schemaPath, "utf8");
  try {
    await pool.query(sql);
    console.log("Schema applied. No changes were destructive.");
  } catch (err) {
    console.error("Migration failed:", err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();