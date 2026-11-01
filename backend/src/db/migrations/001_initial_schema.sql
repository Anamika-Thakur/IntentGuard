-- IntentGuard Core Database Schema
-- All monetary fields are integer minor units (cents). Floating points are prohibited.

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  role VARCHAR(32) NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS merchants (
  id VARCHAR(64) PRIMARY KEY,
  merchant_id VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS catalogue_products (
  id VARCHAR(64) PRIMARY KEY,
  merchant_id VARCHAR(64) NOT NULL REFERENCES merchants(merchant_id),
  sku VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  currency VARCHAR(3) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_merchant_sku UNIQUE (merchant_id, sku)
);

CREATE TABLE IF NOT EXISTS intents (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id),
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS intent_policies (
  id VARCHAR(64) PRIMARY KEY,
  intent_id VARCHAR(64) NOT NULL REFERENCES intents(id),
  version INTEGER NOT NULL,
  merchant_id VARCHAR(64) NOT NULL REFERENCES merchants(merchant_id),
  allowed_sku VARCHAR(64) NOT NULL,
  max_quantity INTEGER NOT NULL,
  max_total_cents INTEGER NOT NULL,
  currency VARCHAR(3) NOT NULL,
  allowed_conditions JSONB,
  canonical_hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_intent_policy_version UNIQUE (intent_id, version)
);

CREATE TABLE IF NOT EXISTS authorizations (
  id VARCHAR(64) PRIMARY KEY,
  intent_id VARCHAR(64) NOT NULL REFERENCES intents(id),
  policy_version INTEGER NOT NULL,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id),
  checkout_id VARCHAR(64) NOT NULL,
  auth_token_hash VARCHAR(64) NOT NULL,
  key_id VARCHAR(32) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  consumed_order_id VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id),
  intent_id VARCHAR(64) NOT NULL REFERENCES intents(id),
  provider_order_id VARCHAR(128) NOT NULL UNIQUE,
  status VARCHAR(64) NOT NULL DEFAULT 'CREATED',
  amount_cents INTEGER NOT NULL,
  currency VARCHAR(3) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS capture_attempts (
  id VARCHAR(64) PRIMARY KEY,
  idempotency_key VARCHAR(128) NOT NULL UNIQUE,
  order_id VARCHAR(64) NOT NULL REFERENCES orders(id),
  status VARCHAR(64) NOT NULL,
  provider_capture_id VARCHAR(128),
  attempt_count INTEGER NOT NULL DEFAULT 1,
  request_payload_hash VARCHAR(64) NOT NULL,
  response_payload JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_events (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64),
  correlation_id VARCHAR(64) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  resource_type VARCHAR(64) NOT NULL,
  resource_id VARCHAR(64) NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indices for performance and query optimization
CREATE INDEX IF NOT EXISTS idx_intents_user ON intents(user_id);
CREATE INDEX IF NOT EXISTS idx_authorizations_intent ON authorizations(intent_id);
CREATE INDEX IF NOT EXISTS idx_authorizations_checkout ON authorizations(checkout_id);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_intent ON orders(intent_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_events(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_correlation ON audit_events(correlation_id);
