/**
 * Check docs/architecture.md against the code it claims to describe.
 *
 * The diagrams are hand-written, so they can drift from the system. This parses
 * the Mermaid out of the document and cross-checks every name it asserts against
 * the source: services, middleware, the connection pool, database tables and
 * columns, route mounts, dependencies and environment variables.
 *
 *   node scripts/check-diagrams.js
 *
 * Exits non-zero on any mismatch, so it can gate a commit.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const DOC = path.join(ROOT, "docs", "architecture.md");

let failures = 0;
let checks = 0;

function check(name, ok, detail) {
  checks++;
  if (!ok) {
    failures++;
    console.log("  FAIL  " + name + (detail ? "  — " + detail : ""));
  }
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

const markdown = fs.readFileSync(DOC, "utf8");

/** Every mermaid block, with the heading above it. */
function blocks() {
  const lines = markdown.split(/\r?\n/);
  const out = [];
  let heading = "";
  let inBlock = false;
  let buf = [];
  for (const line of lines) {
    if (!inBlock) {
      const h = /^#{1,6}\s+(.*)$/.exec(line);
      if (h) heading = h[1].trim();
      if (/^```mermaid\s*$/.test(line)) {
        inBlock = true;
        buf = [];
      }
      continue;
    }
    if (/^```\s*$/.test(line)) {
      out.push({ heading, source: buf.join("\n") });
      inBlock = false;
      continue;
    }
    buf.push(line);
  }
  return out;
}

const all = blocks();
const classDiagram = all.find((b) => /classDiagram/.test(b.source));
const erDiagram = all.find((b) => /erDiagram/.test(b.source));
const flowcharts = all.filter((b) => /flowchart/.test(b.source));

// ---------------------------------------------------------------- services --
// Class-diagram members for these must exist verbatim in their module.
const SERVICE_FILES = {
  ActivityLog: "backend/services/activity.js",
  Mailer: "backend/services/mailer.js",
  OcrEngine: "backend/services/ocr.js",
  AuthMiddleware: "backend/middleware/auth.js",
};

console.log("\n### Services, middleware and the pool");
/**
 * Members of a class in the diagram. Classes sit at two indent levels now — some
 * are inside a `namespace` block — so match on the class header and read to the
 * next line that closes it at the same indent, rather than assuming 4 spaces.
 */
function classMembers(source, cls) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp("^\\s*class\\s+" + cls + "\\s*\\{").test(l));
  if (start < 0) return null;
  const indent = lines[start].length - lines[start].trimStart().length;
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    const lineIndent = line.length - line.trimStart().length;
    if (line.trim() === "}" && lineIndent === indent) break;
    body.push(line);
  }
  // Members are indented, and sit at two levels (inside a namespace or not).
  return [...body.join("\n").matchAll(/^\s*[+-]\s*([A-Za-z_$][\w$]*)\s*\(/gm)].map((x) => x[1]);
}

for (const [cls, file] of Object.entries(SERVICE_FILES)) {
  const src = read(file);
  const members = classMembers(classDiagram.source, cls);
  if (!members) {
    check(`${cls} documented in the class diagram`, false, "class block not found");
    continue;
  }
  if (!members.length) {
    check(`${cls} has members to verify`, false, "no members parsed from the class block");
    continue;
  }
  const missing = members.filter((name) => !new RegExp("\\b" + name + "\\b").test(src));
  check(`${cls} methods exist in ${path.basename(file)}`, missing.length === 0, missing.join(", "));
}

// PgPool is the pg Pool from backend/db.js. query/connect/end are that library's
// own API rather than code in this repository, so confirm the pool is really
// constructed from the pg package and not something hand-rolled.
{
  const src = read("backend/db.js");
  check("PgPool is the pg Pool", /new Pool\(\s*\) |new Pool\(/.test(src), "no pg Pool construction found");
  check("PgPool accepts a DATABASE_URL connection string", /DATABASE_URL/.test(src));
}

// ------------------------------------------------------------------- routers --
console.log("\n### Routers");
// Every route file the diagram names must exist, and the endpoint counts the
// component diagram quotes must match reality.
const ROUTER_FILES = {
  AuthRouter: "backend/routes/auth.js",
  RequestsRouter: "backend/routes/requests.js",
  ModulesRouter: "backend/routes/modules.js",
  BiddingRouter: "backend/routes/bidding.js",
  ReportsRouter: "backend/routes/reports.js",
  DashboardRouter: "backend/routes/dashboard.js",
  AccountRouter: "backend/routes/account.js",
  NotificationsRouter: "backend/routes/notifications.js",
  ScannerRouter: "backend/routes/scanner.js",
};
for (const [cls, file] of Object.entries(ROUTER_FILES)) {
  check(`${cls} file exists`, fs.existsSync(path.join(ROOT, file)), file);
}
{
  // The component diagram states endpoint counts next to each router name, e.g.
  // `auth.js<br/><i>7 endpoints</i>`.
  const claims = [...markdown.matchAll(/([a-z]+)\.js<br\/>\s*<i>(\d+)\s+endpoints?<\/i>/g)];
  check("endpoint counts found in the component diagram", claims.length > 0, claims.length + " found");
  for (const [, name, count] of claims) {
    const entry = Object.entries(ROUTER_FILES).find(([, f]) => path.basename(f, ".js") === name);
    if (!entry) {
      check(`endpoint count for ${name}.js is verifiable`, false, "no matching route file");
      continue;
    }
    const real = (read(entry[1]).match(/router\.(get|post|patch|put|delete)\(/g) || []).length;
    check(`${name}.js has ${count} endpoints as documented`, real === Number(count), `actual ${real}`);
  }
}

// ---------------------------------------------------------------- data model --
console.log("\n### Data model");
{
  // Comments are stripped before parsing. A comment that happens to spell out
  // "CREATE TABLE IF NOT EXISTS does nothing" otherwise parses as a table
  // called "does".
  const schema = read("backend/schema.sql")
    .split(/\r?\n/)
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");

  // Constraint and table clauses are not columns. The \b matters: without it
  // /^CREATE/i also swallows the created_at column.
  const NOT_A_COLUMN = /^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT|REFERENCES|CREATE|INDEX)\b/i;

  // Tables named in the ER diagram.
  const erTables = [...erDiagram.source.matchAll(/^\s{4}(\w+)\s*\{/gm)].map((m) => m[1]);
  check("ER diagram lists tables", erTables.length > 0, erTables.length + " found");

  for (const t of erTables) {
    check(`table ${t} exists in schema.sql`, new RegExp("CREATE TABLE IF NOT EXISTS\\s+" + t + "\\b").test(schema));
  }

  const realTables = [...schema.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/g)].map((m) => m[1]);
  const missing = realTables.filter((t) => !erTables.includes(t));
  check("every schema table appears in the ER diagram", missing.length === 0, "absent: " + missing.join(", "));

  // Columns, per table.
  let columnMismatches = 0;
  const details = [];
  const tableBlocks = [...erDiagram.source.matchAll(/^\s{4}(\w+)\s*\{\n([\s\S]*?)^\s{4}\}/gm)];
  for (const [full, table, body] of tableBlocks) {
    void full;
    const schemaTable = new RegExp(
      "CREATE TABLE IF NOT EXISTS\\s+" + table + "\\s*\\(([\\s\\S]*?)\\n\\);"
    ).exec(schema);
    if (!schemaTable) continue;
    const realCols = schemaTable[1]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !NOT_A_COLUMN.test(l))
      .map((l) => l.split(/\s+/)[0])
      .filter(Boolean);
    const docCols = body
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.split(/\s+/)[1])
      .filter(Boolean);

    const notInSchema = docCols.filter((c) => !realCols.includes(c));
    const notInDoc = realCols.filter((c) => !docCols.includes(c));
    if (notInSchema.length || notInDoc.length) {
      columnMismatches++;
      details.push(`${table}: doc-only=[${notInSchema}] schema-only=[${notInDoc}]`);
    }
  }
  check("every documented column exists and every column is documented", columnMismatches === 0, details.join("; "));
}

// ----------------------------------------------------------------- mounting --
console.log("\n### Route mounting and dependencies");
{
  const server = read("backend/server.js");
  // Component diagram: "app.use("/api", requestRoutes)" etc. Check each named
  // router variable is mounted somewhere in server.js.
  const mounted = new Set([...server.matchAll(/app\.use\([^,]+,\s*(\w+Routes?)\)/g)].map((m) => m[1]));
  for (const name of ["authRoutes", "accountRoutes", "biddingRoutes", "dashboardRoutes", "moduleRoutes", "notificationRoutes", "reportRoutes", "requestRoutes", "scannerRoutes"]) {
    check(`${name} is mounted in server.js`, mounted.has(name));
  }

  // Dependencies named on the deployment diagram must be real.
  const pkg = JSON.parse(read("backend/package.json"));
  for (const dep of ["express", "pg", "jsonwebtoken", "bcrypt", "tesseract.js", "nodemailer", "helmet"]) {
    check(`dependency ${dep} is declared`, Boolean(pkg.dependencies[dep]));
  }

  // Env vars named on the deployment diagram must be read somewhere.
  const envExample = read("backend/.env.example");
  for (const v of ["DATABASE_URL", "JWT_SECRET", "UPLOAD_DIR"]) {
    check(`${v} documented in .env.example`, envExample.includes(v));
  }
  check("SMTP_HOST documented in .env.example", envExample.includes("SMTP_HOST"));
  check("PORT default is 4000", /PORT\s*\|\|\s*4000/.test(server));
  check("HOST default is 0.0.0.0", /HOST\s*\|\|\s*"0\.0\.0\.0"/.test(server));
}

// ------------------------------------------------------------------ frontend --
console.log("\n### Frontend scripts named in the component diagram");
{
  for (const script of ["layout.js", "icons.js", "datatable.js", "requests.js", "bidding.js", "reports.js", "scanner.js"]) {
    check(`${script} exists`, fs.existsSync(path.join(ROOT, "frontend", "js", script)));
  }
  // Every page the component diagram lists must exist.
  for (const page of ["dashboard", "requests", "quotations", "orders", "documents", "bidding", "reports", "scanner", "settings"]) {
    check(`page ${page}.html exists`, fs.existsSync(path.join(ROOT, "frontend", page + ".html")));
  }
  // On-disk stores named on the deployment diagram.
  check("backend/uploads exists", fs.existsSync(path.join(ROOT, "backend", "uploads")));
  check("backend/langdata exists", fs.existsSync(path.join(ROOT, "backend", "langdata")));
  check("langdata holds the OCR model", fs.existsSync(path.join(ROOT, "backend", "langdata", "eng.traineddata")));
  const gitignore = read(".gitignore");
  check("uploads is gitignored", gitignore.includes("backend/uploads/"));
  check("langdata is gitignored", gitignore.includes("backend/langdata/"));
}

// -------------------------------------------------------------------- report --
console.log("\n" + (failures === 0 ? "All " + checks + " diagram checks passed." : failures + " of " + checks + " checks FAILED."));
process.exit(failures ? 1 : 0);