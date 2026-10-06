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
- Forgot password: single-use reset links (30 minutes, hashed at rest), sent by email over SMTP or printed to the server console when no SMTP server is configured
- Optional "remember for 30 days" on the sign-in form, which stores only the email address client-side

**Nine modules**, one page each (no shared/mixed dashboard)

| Module | Route | What it does |
| --- | --- | --- |
| Dashboard | `/dashboard` | KPIs, approval queue, monthly bid chart, document breakdown, pipeline |
| Procurement Requests | `/requests` | Sortable/paged table, bulk actions, approval workflow, attachments, audit timeline |
| Quotations | `/quotations` | List with status workflow and per-record history |
| Bidding Records | `/bidding` | Bid packages, competing supplier offers, award decisions, savings against estimate |
| Purchase Orders | `/orders` | List with status workflow and per-record history |
| Document Repository | `/documents` | Document list with per-record history |
| Scan a Document | `/scanner` | Camera capture, OCR, field extraction, save-as-request |
| Reports | `/reports` | Spend analysis, supplier performance, cycle times, over a selectable period |
| Settings | `/settings` | Profile and security panel |

**Cross-cutting**
- One audit trail (`activity_log`) for requests, quotations, orders, documents and bids
- Notification bell showing recent activity and the approval queue
- Dashboard overview stays current: every figure is a live query, and the page
  re-reads it on tab return, window focus and a 60-second heartbeat, with a
  manual refresh button and an "updated N min ago" stamp
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
| `npm run check:routes` | Automated route/API sweep |

## Testing

`npm run check:routes` exercises every page route and API endpoint, signed in
and signed out, including error paths: authentication guards, validation,
pagination, sorting, workflow guards, SQL-injection attempts on sort keys, and a
real OCR round-trip. It exits non-zero on failure, so it can gate a release.

It also asserts the contract the shared data table depends on: that every list
endpoint exposes its records where `js/datatable.js` can find them. A payload
that breaks that shape renders "Nothing to show" with no error anywhere, which
is exactly how the bidding list shipped empty once already.

Point `QA_SCAN_IMAGE` at a scan to include the OCR round-trip:

```bash
QA_SCAN_IMAGE=/path/to/scan.jpg npm run check:routes
```

The login endpoint allows **10 attempts per 15 minutes per IP**, which repeated
runs of the sweep will exhaust. Restart the server (the limiter is in-memory) or
wait.

The sweep checks the password-reset endpoints without changing any password. To
also run the full round trip — reset the seed account, prove the link cannot be
reused, then put the original password back:

```bash
QA_RESET_PASSWORD=1 npm run check:routes
```

It needs the server to hand the reset link back, which happens outside
production when SMTP is not configured.

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

## Bidding Records

A **bid package** is one procurement opportunity. Each holds the competing
supplier offers and the award decision, and hangs off the request that caused
it — which is what lets the award be compared against that request's estimate.

- Packages move `draft → open → closed → awarded`, with `cancelled` available
  from any live stage. Illegal jumps are rejected with a 409.
- Packages are created from the Bidding page ("New bid package"), optionally
  linked to the request that caused them. The number is generated the same way
  requests are (`BID-YYYY-NNN`, highest canonical sequence plus one), and a
  package always starts as a **draft** — opening it is a separate, deliberate
  step, so nothing is advertised to suppliers until someone decides to.
- Offers are only accepted while a package is `open`. A closed package is a
  fixed historical record; accepting a late bid would change a decision that
  has already been made against it.
- Awarding a submission closes the package in the same transaction, so a
  package can never sit `open` with a winner already picked.
- A partial unique index makes "exactly one awarded submission per package"
  true at the database level, not just in application code.
- Re-awarding demotes the previous winner in the same transaction, so the
  correction is an explicit, recorded move rather than a constraint violation.

## Reports

Three reports over a selectable period (30 / 90 / 180 / 365 days). Nothing is
stored — each figure is computed on demand from the same tables the modules
write, so a report can never drift from the data behind it.

- **Spend analysis** — awarded value against original estimates, grouped by
  month, supplier or request.
- **Supplier performance** — bid frequency, awards and win rate per supplier.
  Win rate counts only *decided* bids, and the headline figure is a portfolio
  ratio rather than an average of per-supplier rates, so one bid is not worth
  the same as ten.
- **Cycle times** — raised → approved (per department) and opened → awarded,
  both measured from the shared activity trail rather than from a stored
  counter, so they reflect when something actually happened.

Savings are only reported where an estimate exists. An award with no linked
request is unmeasured, not overspent.

### Exporting a report

Each report has **Print / PDF** and **Download CSV** in its header.

- **Print / PDF** opens the browser's print dialog, where "Save as PDF" (or
  Microsoft Print to PDF) produces a real PDF file. No PDF library and no
  third-party script is involved, so it works offline and adds no dependency.
  A @media print layout drops the sidebar, top bar and every button, repeats
  table headers across page breaks, and adds a document header carrying the
  report name, the period and the generation time.
- **Download CSV** exports the table currently on screen, from the same payload
  the report was rendered from rather than a second query. Cells are quoted for
  commas, quotes and newlines, a UTF-8 BOM is prepended so Excel reads the peso
  sign and accented supplier names correctly, and formula-looking cells are
  neutralised while genuine negative numbers stay numeric so a SUM still works.

### Your account

Settings covers who you are, what you have done, and how your sign-in is
holding up.

- **Change password** is self-service, so a user who remembers their password no
  longer needs the reset flow. It asks for the current password even though a
  valid session is already present: a stolen cookie should not be enough to lock
  the real owner out. The change clears any account lockout, kills outstanding
  reset links so an old email cannot overwrite the new password, and re-issues
  the session so nobody is signed out by their own change.
- **Your activity** summarises requests raised, documents uploaded and bid
  packages created, so the page shows a footprint rather than a list of fields
  the user already knows.
- **Security** shows last sign-in, failed attempts, lockout state and how many
  attempts remain, warning when that count gets low.
- The **Modules** list is generated from the same navigation data as the
  sidebar. It used to be a hand-maintained copy, which went stale and kept
  labelling Bidding Records and Reports as placeholders after they shipped.

## Security notes

- Passwords hashed with bcrypt; never stored in plain text
- JWTs in an httpOnly, `SameSite=Lax` cookie; 8-hour expiry
- Login is rate-limited (10 / 15 min) and accounts lock after 5 failed attempts
- Login errors are generic and do not reveal whether an account exists
- Reset links are random, single-use, expire after 30 minutes, and are stored only as a SHA-256 hash; requesting a new one retires every older link
- The reset flow answers identically for known and unknown addresses, and never emails a locked or disabled account
- Resetting a password also clears the account lockout
- Helmet sets a restrictive Content-Security-Policy
- All SQL is parameterized; sort keys are whitelist-mapped to columns, never
  interpolated from user input
- Table and column names in the module status endpoints come from a fixed map,
  never from the request body
- Attachments are served through an authenticated route, not as static files
- Bid packages accept offers only while open, and at most one submission per
  package can be awarded — enforced by a partial unique index, not just code

### Known limitations

- JWT sessions cannot be revoked server-side, so a copied cookie stays valid
  until it expires (8 hours). A password reset signs the user in again but
  cannot pull an already-issued cookie out of someone else's browser.
- Attachments are stored on local disk with no malware scanning; move to object
  storage before shared deployment
- Session state is in-process, so the app runs as a single instance
- Nothing has been load-tested at scale or with concurrent users

## Deferred

Employee-specific login flows, role permissions, self-registration, document
upload/editing, and a change-password screen for signed-in users are not
implemented yet. There is no way to edit a bid package's title or notes after
creation, and no supplier-facing portal — offers are recorded by staff.
