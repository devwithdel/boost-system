# 1. Login Module

This is the first working slice of BOOST: the **login page** (frontend) wired
to **real authentication** (backend + PostgreSQL). It implements:

- System Foundation → Frontend, Backend/API, Database, Authentication
- User & Access Management → Login, Security (rate limiting, lockout, hashed passwords)

**Not included yet:** Dashboard (next module), employee role logic (deferred —
see note below), user self-registration/account management UI, roles/permissions
beyond the `role` column already present in the schema.

## Stack

- Frontend: static HTML/CSS/vanilla JS (no framework yet — kept simple until
  the UI needs more interactivity)
- Backend: Node.js + Express
- Database: PostgreSQL
- Auth: bcrypt password hashing, JWT stored in an **httpOnly cookie** (not
  localStorage — safer against XSS token theft)

## Setup

### 1. Create the database

```bash
createdb boost_db
psql -d boost_db -f backend/schema.sql
```

### 2. Configure environment variables

```bash
cd backend
cp .env.example .env
```

Edit `.env`:
- Set `DATABASE_URL` (or the individual `PG*` vars) to match your local Postgres.
- Generate a real `JWT_SECRET`:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```
- Set `SEED_EMAIL` / `SEED_PASSWORD` to whatever you want your local test
  login to be (don't leave the placeholder password).

### 3. Install dependencies

```bash
npm install
```

### 4. Create a test client account

```bash
npm run seed
```

This inserts one `role = 'client'` user using the `SEED_*` values from `.env`.

### 5. Run the server

```bash
npm start
```

Visit **http://localhost:4000** — you'll land on the login page. Sign in with
the seed credentials; on success you're redirected to a placeholder dashboard
page (`/dashboard.html`) that confirms the session via `/api/auth/me`. That
placeholder gets replaced when we build the real Dashboard module next.

## Security notes already in place

- Passwords hashed with bcrypt (cost factor 12), never stored in plain text.
- JWT kept in an httpOnly, `sameSite=lax` cookie — inaccessible to JS, so an
  XSS bug can't just read it out of localStorage.
- Login endpoint is rate-limited (10 attempts / 15 min per IP) on top of
  **per-account lockout** after 5 failed attempts (15-minute lock).
- Login errors are generic ("Invalid email/username or password") so the
  system never confirms whether a given email/username exists.
- Helmet sets a restrictive Content-Security-Policy.
- All DB queries are parameterized — no string-concatenated SQL.

## Deferred: employee role

The `users.role` column already supports `'employee'` in its CHECK constraint,
so the schema won't need to change shape later — but no employee-specific
login flow, permissions, or UI exists yet. That's scoped for after the second
stakeholder interview, as agreed.

## Next module

Dashboard — procurement summary, pending requests, active
quotations/bids, orders, recent documents.
