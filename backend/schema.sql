-- BOOST — System Foundation: Database schema (initial slice)
-- Run against your PostgreSQL database before starting the server:
--   psql -d boost_db -f schema.sql

CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  full_name       VARCHAR(150) NOT NULL,
  email           VARCHAR(150) NOT NULL UNIQUE,
  username        VARCHAR(100) UNIQUE,
  password_hash   TEXT NOT NULL,

  -- 'client' is the only role implemented right now. 'employee' is reserved
  -- for a later phase pending the second stakeholder interview scope.
  role            VARCHAR(20) NOT NULL DEFAULT 'client'
                    CHECK (role IN ('client', 'employee')),

  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  failed_attempts SMALLINT NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);
