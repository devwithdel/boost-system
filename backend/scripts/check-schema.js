/**
 * Prove backend/schema.sql can build the system from an empty database.
 *
 * Replays the file into a throwaway schema inside a transaction, then rolls
 * back, so the live database is provably untouched. Two things it catches:
 *
 *   - a table created before something it references, which fails on a fresh
 *     database even though an incrementally-built one works fine;
 *   - an ALTER or index against a table that does not exist yet.
 *
 * Both happened: bidding tables were declared before procurement_requests, and
 * the constraint adding 'bid' to activity_log ran before activity_log was
 * created. The existing database had been built up by hand and looked fine.
 *
 *   npm run check:schema
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../db");

const SCHEMA = "boost_fresh_check";
const EXPECTED_TABLES = 11;

const sql = fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8");

// Comment-only lines are dropped before splitting, so a semicolon inside a
// comment cannot break a statement in half.
const statements = sql
  .split(/\r?\n/)
  .filter((l) => !/^\s*--/.test(l))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

(async () => {
  const client = await pool.connect();
  let failures = [];
  let missing = [];
  let bidAllowed = false;

  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA ${SCHEMA}`);
    await client.query(`SET LOCAL search_path TO ${SCHEMA}`);

    for (const stmt of statements) {
      // A savepoint per statement: without one the first error aborts the whole
      // transaction and hides every statement after it.
      await client.query("SAVEPOINT s");
      try {
        await client.query(stmt);
        await client.query("RELEASE SAVEPOINT s");
      } catch (err) {
        failures.push({ first: stmt.replace(/\s+/g, " ").slice(0, 72), message: err.message });
        await client.query("ROLLBACK TO SAVEPOINT s");
      }
    }

    const tables = await client.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = $1 ORDER BY table_name`,
      [SCHEMA]
    );
    missing = EXPECTED_TABLES === tables.rows.length ? [] : tables.rows.map((r) => r.table_name);

    const con = await client.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = $1::regclass AND conname = 'activity_log_entity_type_check'`,
      [`${SCHEMA}.activity_log`]
    );
    bidAllowed = con.rows.some((r) => /'bid'/.test(r.def));

    // The constraint is the real test: the bidding module writes this on every
    // package action, so a fresh database without it rejects those rows.
    let insertOk = false;
    let insertErr = "";
    try {
      await client.query(
        `INSERT INTO activity_log (entity_type, entity_id, action) VALUES ('bid', 1, 'check_schema')`
      );
      insertOk = true;
    } catch (err) {
      insertErr = err.message;
    }
    await client.query("ROLLBACK TO SAVEPOINT s").catch(() => {});

    console.log("Replayed " + statements.length + " statement(s) into an empty schema.\n");

    console.log("statements that failed: " + failures.length);
    failures.forEach((f) => console.log("  " + f.first + "\n      " + f.message));

    console.log("\ntables created: " + tables.rows.length + " of " + EXPECTED_TABLES);
    console.log("  " + tables.rows.map((r) => r.table_name).join(", "));

    console.log("\nactivity_log accepts entity_type='bid': " + bidAllowed);
    console.log("  insert probe: " + (insertOk ? "accepted" : "REJECTED -> " + insertErr));
  } finally {
    await client.query("ROLLBACK");
    client.release();
    const left = await pool.query(
      `SELECT count(*)::int AS n FROM information_schema.schemata WHERE schema_name = $1`,
      [SCHEMA]
    );
    console.log("\nrolled back; leftover schema rows: " + left.rows[0].n);
    await pool.end();
  }

  const bad = failures.length || missing.length || !bidAllowed;
  console.log(bad ? "\nSchema does NOT build from scratch." : "\nSchema builds cleanly from scratch.");
  process.exit(bad ? 1 : 0);
})().catch(async (e) => {
  console.error(e.message);
  await pool.end().catch(() => {});
  process.exit(1);
});