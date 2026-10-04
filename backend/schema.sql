-- BOOST — System Foundation and Dashboard data schema
-- Run against your PostgreSQL database before starting the server:
--   psql -d boost_db -f backend/schema.sql

CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  full_name       VARCHAR(150) NOT NULL,
  email           VARCHAR(150) NOT NULL UNIQUE,
  username        VARCHAR(100) UNIQUE,
  password_hash   TEXT NOT NULL,

  -- 'client' is the role implemented by the first dashboard slice. 'employee'
  -- remains available for the next access-management phase.
  role            VARCHAR(20) NOT NULL DEFAULT 'client'
                    CHECK (role IN ('client', 'employee')),

  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  failed_attempts SMALLINT NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS procurement_requests (
  id                SERIAL PRIMARY KEY,
  request_number    VARCHAR(30) NOT NULL UNIQUE,
  requester_name    VARCHAR(150) NOT NULL,
  department        VARCHAR(100) NOT NULL,
  item_description  TEXT NOT NULL,
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  estimated_amount  NUMERIC(12, 2) NOT NULL CHECK (estimated_amount >= 0),
  status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'in_progress', 'completed', 'cancelled')),
  requested_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_date          DATE,
  created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quotations (
  id                SERIAL PRIMARY KEY,
  quotation_number  VARCHAR(30) NOT NULL UNIQUE,
  request_id        INTEGER REFERENCES procurement_requests(id) ON DELETE SET NULL,
  supplier_name     VARCHAR(150) NOT NULL,
  item_description  TEXT NOT NULL,
  total_amount      NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
  status            VARCHAR(20) NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'active', 'awarded', 'expired', 'cancelled')),
  valid_until       DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id                     SERIAL PRIMARY KEY,
  order_number           VARCHAR(30) NOT NULL UNIQUE,
  quotation_id           INTEGER REFERENCES quotations(id) ON DELETE SET NULL,
  supplier_name          VARCHAR(150) NOT NULL,
  total_amount           NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
  status                 VARCHAR(20) NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'approved', 'shipped', 'delivered', 'cancelled')),
  ordered_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expected_delivery_date DATE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS documents (
  id               SERIAL PRIMARY KEY,
  document_number  VARCHAR(30) NOT NULL UNIQUE,
  title            VARCHAR(200) NOT NULL,
  document_type    VARCHAR(20) NOT NULL DEFAULT 'other'
                   CHECK (document_type IN ('request', 'quotation', 'order', 'contract', 'invoice', 'other')),
  file_name        VARCHAR(255) NOT NULL,
  file_size_bytes  INTEGER NOT NULL CHECK (file_size_bytes >= 0),
  uploaded_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit trail: every status change on a procurement request, who did it and when.
-- Superseded by activity_log below, which covers every module. Kept so existing
-- rows stay intact; nothing writes to it any more.
CREATE TABLE IF NOT EXISTS request_events (
  id          SERIAL PRIMARY KEY,
  request_id  INTEGER NOT NULL REFERENCES procurement_requests(id) ON DELETE CASCADE,
  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name  VARCHAR(150),
  action      VARCHAR(30) NOT NULL,
  from_status VARCHAR(20),
  to_status   VARCHAR(20),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One audit trail for the whole system: requests, quotations, purchase orders
-- and documents all record into this table, so the bell and each module's
-- history read from a single source.
CREATE TABLE IF NOT EXISTS activity_log (
  id          SERIAL PRIMARY KEY,
  entity_type VARCHAR(30) NOT NULL
                CHECK (entity_type IN ('request','quotation','order','document')),
  entity_id   INTEGER NOT NULL,
  entity_ref  VARCHAR(80),              -- human label: REQ-2026-107, QUO-…, DOC-…
  action      VARCHAR(40) NOT NULL,
  from_status VARCHAR(20),
  to_status   VARCHAR(20),
  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name  VARCHAR(150),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Carry the existing request history over. Guarded so re-running is a no-op.
INSERT INTO activity_log
  (entity_type, entity_id, entity_ref, action, from_status, to_status, actor_id, actor_name, note, created_at)
SELECT
  'request', e.request_id, r.request_number, e.action, e.from_status, e.to_status,
  e.actor_id, e.actor_name, e.note, e.created_at
FROM request_events e
JOIN procurement_requests r ON r.id = e.request_id
WHERE NOT EXISTS (
  SELECT 1 FROM activity_log a
  WHERE a.entity_type = 'request' AND a.entity_id = e.request_id AND a.created_at = e.created_at
);

-- Photos and scans attached to a request (the mobile scanner writes here).
CREATE TABLE IF NOT EXISTS request_attachments (
  id           SERIAL PRIMARY KEY,
  request_id   INTEGER NOT NULL REFERENCES procurement_requests(id) ON DELETE CASCADE,
  file_name    VARCHAR(255) NOT NULL,
  stored_name  VARCHAR(255) NOT NULL,
  mime_type    VARCHAR(80) NOT NULL,
  size_bytes   INTEGER NOT NULL CHECK (size_bytes >= 0),
  source       VARCHAR(20) NOT NULL DEFAULT 'upload'
                 CHECK (source IN ('upload', 'scan')),
  uploaded_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_request_attachments_request ON request_attachments (request_id, uploaded_at DESC);

CREATE INDEX IF NOT EXISTS idx_request_events_request ON request_events (request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_log (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_recent ON activity_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);
CREATE INDEX IF NOT EXISTS idx_requests_status_requested ON procurement_requests (status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotations_status_valid ON quotations (status, valid_until);
CREATE INDEX IF NOT EXISTS idx_orders_status_ordered ON purchase_orders (status, ordered_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_uploaded ON documents (uploaded_at DESC);
