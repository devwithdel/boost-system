const { Pool } = require("pg");

// Uses DATABASE_URL if present, otherwise falls back to individual PG* env vars
// (the "pg" package reads PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD automatically).
const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : undefined
);

pool.on("error", (err) => {
  // Catches idle client errors so a bad connection doesn't crash the process
  console.error("Unexpected PostgreSQL client error:", err);
});

module.exports = pool;
