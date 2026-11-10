CREATE TABLE IF NOT EXISTS transactions (
  id BIGSERIAL PRIMARY KEY,
  reference TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  amount_minor BIGINT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'NGN',
  original_amount NUMERIC(20,6),
  original_currency CHAR(3),
  exchange_rate NUMERIC(24,10),
  rate_date DATE,
  rate_source TEXT,
  type TEXT NOT NULL CHECK (type IN ('donation','service','transaction')),
  note TEXT,
  source TEXT NOT NULL CHECK (source IN ('website','api')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed','reversed')),
  paystack_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS transactions_created_at_idx ON transactions(created_at);
CREATE INDEX IF NOT EXISTS transactions_status_idx ON transactions(status);
CREATE INDEX IF NOT EXISTS transactions_type_idx ON transactions(type);

CREATE TABLE IF NOT EXISTS rate_snapshots (
  id BIGSERIAL PRIMARY KEY,
  rate_date DATE NOT NULL,
  source_url TEXT NOT NULL,
  rates JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(rate_date, source_url)
);
CREATE INDEX IF NOT EXISTS rate_snapshots_created_idx ON rate_snapshots(created_at DESC);

CREATE TABLE IF NOT EXISTS maintenance_state (
  task TEXT PRIMARY KEY,
  last_run_at TIMESTAMPTZ
);
INSERT INTO maintenance_state(task,last_run_at)
VALUES ('transaction_retention', NULL)
ON CONFLICT (task) DO NOTHING;

-- Pending payment reconciliation state (lazy, request-driven; no Cron required).
INSERT INTO maintenance_state(task,last_run_at)
VALUES ('pending_reconciliation', NULL)
ON CONFLICT (task) DO NOTHING;

-- Helps bounded scans for old pending records and date-range statistics.
CREATE INDEX IF NOT EXISTS transactions_status_created_at_idx
  ON transactions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS transactions_paid_at_idx
  ON transactions(paid_at DESC)
  WHERE status = 'success';
