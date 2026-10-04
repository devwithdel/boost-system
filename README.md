# BOOST — Procurement and Order Operations System

BOOST is a web-based procurement system for managing requests, quotations, purchase
orders and documents, with a mobile document scanner that reads paper forms.

This repository is a working slice covering authentication, all nine modules, the
approval workflow, the audit trail and the OCR scanner.

## What is included

**Authentication**
- Sign-in wired to real authentication, JWT sessions in an httpOnly `SameSite=Lax` cookie
- Server-side page routing with authentication guards, so `/dashboard.html` cannot bypass the check on `/dashboard`
- Rate limiting and account lockout after repeated failures

**Nine modules**, one page each (no shared/mixed dashboard)

| Module | Route | What it does |
| --- | --- | --- |
| Dashboard | `/dashboard` | KPIs, approval queue, monthly bid chart, document breakdown, pipeline |
| Procurement Requests | `/requests` | Sortable/paged table, bulk actions, approval workflow, attachments, audit timeline |
| Quotations | `/quotations` | List with status workflow and per-record history |
| Bidding Records | `/bidding` | Module placeholder |
| Purchase Orders | `/orders` | List with status workflow and per-record history |
| Document Repository | `/documents` | Document list with per-record history |
| Open Mobile Scanner | `/scanner` | Camera capture, OCR, field extraction, save-as-request |
| Reports | `/reports` | Module placeholder |
| Settings | `/settings` | Profile and security panel |

**Cross-cutting**
- One audit trail (`activity_log`) for requests, quotations, orders and documents
- Notification bell showing recent activity and the approval queue
- Responsive throughout: persistent sidebar on desktop, burger drawer and card lists on phones
- Keyboard accessible, focus-trapped dialogs, skip link

## Stack

- Frontend: static HTML/CSS/vanilla JS, one shared shell injected by `js/layout.js`
- Backend: Node.js + Express
- Database: PostgreSQL
- Auth: bcrypt + JWT cookies
- OCR: [tesseract.js](https://github.com/naptha/tesseract.js) 5.x, running server-side on WASM

## Setup

### 1. Create and prepare the database

```bash
createdb boost_db
psql -d boost_db -f backend/schema.sql
```

`schema.sql` is idempotent, so it is also the migration path for an existing
database — re-run it after pulling changes that add a table or column, or use
`npm run migrate` (below).

### 2. Configure environment variables

```bash
cp backend/.env.example backend/.env
```

Then set at minimum:

- `DATABASE_URL` (or the individual `PG*` variables)
- A strong `JWT_SECRET` — generate one with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```
- Local `SEED_EMAIL`, `SEED_PASSWORD`, and optional `SEED_FULL_NAME`

To reach the app from a phone on the same WiFi, set `HOST=0.0.0.0` and list your
LAN address in `FRONTEND_ORIGIN`:

```
FRONTEND_ORIGIN=http://localhost:4000,http://192.168.1.10:4000
```

The server prints the LAN URL on startup.

### 3. Install dependencies and seed

```bash
cd backend
npm install
npm run migrate     # applies schema.sql (safe to re-run)
npm run ocr:setup   # downloads English OCR data (~4 MB) into backend/langdata
npm run seed        # creates the test account + demo records
npm start
```

### 4. Open the app

Visit **http://localhost:4000**. The root serves the sign-in page; you are
redirected to `/dashboard` after signing in.

## npm scripts

Run from `backend/`:

| Script | Purpose |
| --- | --- |
| `npm start` | Start the server |
| `npm run dev` | Start with auto-restart on file changes |
| `npm run lan` | Same as `start`; prints the LAN URL for phone access |
| `npm run seed` | Create the test account and demo records |
| `npm run reset` | Clear demo data and re-seed (refuses on production) |
| `npm run migrate` | Apply `schema.sql` to the configured database |
| `npm run ocr:setup` | Fetch the OCR language data |
| `npm run check:routes` | Automated route/API sweep — 117 checks |

## Testing

`npm run check:routes` exercises every page route and API endpoint, signed in
and signed out, including error paths: authentication guards, validation,
pagination, sorting, workflow guards, SQL-injection attempts on sort keys, and a
real OCR round-trip. It exits non-zero on failure, so it can gate a release.

Point `QA_SCAN_IMAGE` at a scan to include the OCR round-trip:

```bash
QA_SCAN_IMAGE=/path/to/scan.jpg npm run check:routes
```

The login endpoint allows **10 attempts per 15 minutes per IP**, which repeated
runs of the sweep will exhaust. Restart the server (the limiter is in-memory) or
wait.

## OCR scanner

Photograph a document, read it server-side, review the extracted fields, then
save it as a procurement request with the photo attached as evidence.

- Runs on the server, so the phone only uploads the JPEG
- English traineddata, vendored in `backend/langdata` (CSP forbids remote scripts)
- One shared worker, created lazily and reused

**Extraction is deliberately conservative.** A total is only used when the page
corroborates it — either `quantity × unit price` for a single line, or the sum of
the line items. If they disagree the amount is left blank rather than guessed,
and the field is flagged for review. A scan typically takes 5–10 seconds.

Corrupt or non-image uploads are rejected with a 400 and never reach the OCR
engine.

## Security notes

- Passwords hashed with bcrypt; never stored in plain text
- JWTs in an httpOnly, `SameSite=Lax` cookie; 8-hour expiry
- Login is rate-limited (10 / 15 min) and accounts lock after 5 failed attempts
- Login errors are generic and do not reveal whether an account exists
- Helmet sets a restrictive Content-Security-Policy
- All SQL is parameterized; sort keys are whitelist-mapped to columns, never
  interpolated from user input
- Table and column names in the module status endpoints come from a fixed map,
  never from the request body
- Attachments are served through an authenticated route, not as static files

### Known limitations

- JWT sessions cannot be revoked server-side, so a copied cookie stays valid
  until it expires (8 hours)
- Attachments are stored on local disk with no malware scanning; move to object
  storage before shared deployment
- Session state is in-process, so the app runs as a single instance
- Nothing has been load-tested at scale or with concurrent users

## Deferred

Employee-specific login flows, role permissions, self-registration, password
reset, document upload/editing, and the bidding and reports modules are not
implemented yet.