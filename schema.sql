
-- ============================================================
-- DEVZIKKY PAY
-- MASTER POSTGRESQL DATABASE SCHEMA
-- Version: 1.2
-- ============================================================
--
-- Creates all database objects required by DEVZIKKY PAY:
--
-- 1. transactions
-- 2. rate_snapshots
-- 3. maintenance_state
--
-- Includes:
-- - Payment and donation records
-- - Paystack verification information
-- - Original currency and NGN conversion information
-- - Optional donor notes (maximum 200 characters)
-- - Explicit public-note consent
-- - Three-year retention support
-- - Lazy pending-payment reconciliation
-- - Statistics and reporting indexes
--
-- Run once when creating a NEW database.
-- Do not use this as a replacement for a migration
-- on an existing database containing transactions.
-- ============================================================


-- ============================================================
-- 1. TRANSACTIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.transactions (
    id BIGSERIAL PRIMARY KEY,

    -- Unique application transaction reference
    reference TEXT NOT NULL UNIQUE,

    -- Donor / customer information
    name TEXT NOT NULL,
    email TEXT NOT NULL,

    -- Amount charged by Paystack, stored in kobo
    amount_minor BIGINT NOT NULL
        CHECK (amount_minor > 0),

    -- Paystack settlement currency
    currency CHAR(3) NOT NULL DEFAULT 'NGN'
        CHECK (currency = 'NGN'),

    -- Original amount entered by the customer
    original_amount NUMERIC(20, 6),

    -- Currency originally selected
    original_currency CHAR(3),

    -- Conversion information
    exchange_rate NUMERIC(24, 10),
    rate_date DATE,
    rate_source TEXT,

    -- Transaction category
    type TEXT NOT NULL
        CHECK (
            type IN (
                'donation',
                'service',
                'transaction'
            )
        ),

    -- Optional donor message
    note TEXT
        CHECK (
            note IS NULL
            OR CHAR_LENGTH(note) <= 200
        ),

    -- Explicit consent for public note display
    -- Existing and default notes remain private.
    note_public BOOLEAN NOT NULL DEFAULT FALSE,

    -- Transaction origin
    source TEXT NOT NULL
        CHECK (
            source IN (
                'website',
                'api'
            )
        ),

    -- Application transaction status
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (
            status IN (
                'pending',
                'success',
                'failed',
                'reversed'
            )
        ),

    -- Status returned by Paystack
    paystack_status TEXT,

    -- Timestamps are stored as timezone-aware values.
    -- Display formatting is handled by the application.
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    paid_at TIMESTAMPTZ,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 2. TRANSACTION INDEXES
-- ============================================================

-- General transaction history
CREATE INDEX IF NOT EXISTS transactions_created_at_idx
ON public.transactions (created_at DESC);

-- Filter by transaction status
CREATE INDEX IF NOT EXISTS transactions_status_idx
ON public.transactions (status);

-- Filter by transaction type
CREATE INDEX IF NOT EXISTS transactions_type_idx
ON public.transactions (type);

-- Efficient status and date filtering
CREATE INDEX IF NOT EXISTS idx_transactions_status_created_at
ON public.transactions (status, created_at DESC);

-- Successful transaction reporting.
-- Uses actual payment time, falling back to creation time.
CREATE INDEX IF NOT EXISTS idx_transactions_success_activity_at
ON public.transactions (
    (COALESCE(paid_at, created_at)) DESC
)
WHERE status = 'success';

-- Pending-payment reconciliation
CREATE INDEX IF NOT EXISTS idx_transactions_pending_created_at
ON public.transactions (created_at ASC)
WHERE status = 'pending';

-- Original currency breakdown
CREATE INDEX IF NOT EXISTS idx_transactions_original_currency
ON public.transactions (original_currency);


-- ============================================================
-- 3. RATE SNAPSHOTS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.rate_snapshots (
    id BIGSERIAL PRIMARY KEY,

    rate_date DATE NOT NULL,

    source_url TEXT NOT NULL,

    -- Complete stored exchange-rate snapshot
    rates JSONB NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Prevent duplicate snapshots for the same date/source
    CONSTRAINT rate_snapshots_date_source_unique
        UNIQUE (rate_date, source_url)
);


-- Rate snapshot lookup
CREATE INDEX IF NOT EXISTS rate_snapshots_created_idx
ON public.rate_snapshots (created_at DESC);


-- ============================================================
-- 4. MAINTENANCE STATE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.maintenance_state (
    task TEXT PRIMARY KEY,

    last_run_at TIMESTAMPTZ
);


-- Register the existing maintenance tasks.
-- ON CONFLICT prevents duplicate task entries.

INSERT INTO public.maintenance_state (
    task,
    last_run_at
)
VALUES
    ('transaction_retention', NULL),
    ('pending_reconciliation', NULL)
ON CONFLICT (task) DO NOTHING;


-- ============================================================
-- 5. DATABASE DOCUMENTATION
-- ============================================================

COMMENT ON TABLE public.transactions IS
'DEVZIKKY PAY payment, donation and service transaction records.';

COMMENT ON COLUMN public.transactions.amount_minor IS
'Paystack amount in the smallest currency unit. For NGN, this is kobo.';

COMMENT ON COLUMN public.transactions.note IS
'Optional donor/customer message. Maximum 200 characters.';

COMMENT ON COLUMN public.transactions.note_public IS
'True only when the donor explicitly consents to public display of their note.';

COMMENT ON COLUMN public.transactions.created_at IS
'Timestamp when the application created the transaction.';

COMMENT ON COLUMN public.transactions.paid_at IS
'Timestamp when successful payment was verified.';

COMMENT ON TABLE public.rate_snapshots IS
'Cached exchange-rate snapshots used by DEVZIKKY PAY.';

COMMENT ON TABLE public.maintenance_state IS
'Tracks lazy maintenance execution without requiring Cron.';


-- ============================================================
-- 6. INITIAL DATABASE VERIFICATION
-- ============================================================

SELECT
    'transactions' AS table_name,
    to_regclass('public.transactions') IS NOT NULL AS exists

UNION ALL

SELECT
    'rate_snapshots',
    to_regclass('public.rate_snapshots') IS NOT NULL

UNION ALL

SELECT
    'maintenance_state',
    to_regclass('public.maintenance_state') IS NOT NULL;


-- ============================================================
-- END OF DEVZIKKY PAY MASTER SCHEMA
-- ============================================================
