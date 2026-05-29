require('dotenv').config();
const { pool } = require('./database');

const migrations = `
  -- Enable UUID extension
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

  -- USERS
  CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email         VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name    VARCHAR(100) NOT NULL,
    last_name     VARCHAR(100) NOT NULL,
    avatar_url    TEXT,
    is_premium    BOOLEAN DEFAULT FALSE,
    monthly_limit NUMERIC(15,2) DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
  );

  -- USER PREFERENCES
  CREATE TABLE IF NOT EXISTS user_preferences (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    push_notifications    BOOLEAN DEFAULT TRUE,
    email_summaries       BOOLEAN DEFAULT FALSE,
    security_alerts       BOOLEAN DEFAULT TRUE,
    spending_alerts       BOOLEAN DEFAULT TRUE,
    spending_alert_pct    INTEGER DEFAULT 80,
    dark_mode             BOOLEAN DEFAULT FALSE,
    currency              VARCHAR(10) DEFAULT 'IDR',
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id)
  );

  -- REFRESH TOKENS
  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token      TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  -- WALLETS / PAYMENT METHODS
  CREATE TABLE IF NOT EXISTS wallets (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name           VARCHAR(100) NOT NULL,
    type           VARCHAR(50) NOT NULL CHECK (type IN ('bank','credit_card','e_wallet','cash')),
    account_number VARCHAR(50),
    bank_name      VARCHAR(100),
    balance        NUMERIC(15,2) DEFAULT 0,
    is_default     BOOLEAN DEFAULT FALSE,
    color          VARCHAR(20) DEFAULT '#1B4D35',
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW()
  );

  -- CATEGORIES
  CREATE TABLE IF NOT EXISTS categories (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
    name       VARCHAR(100) NOT NULL,
    icon       VARCHAR(50),
    color      VARCHAR(20),
    type       VARCHAR(20) NOT NULL CHECK (type IN ('expense','income','both')),
    is_system  BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  -- TRANSACTIONS
  CREATE TABLE IF NOT EXISTS transactions (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wallet_id      UUID REFERENCES wallets(id) ON DELETE SET NULL,
    category_id    UUID REFERENCES categories(id) ON DELETE SET NULL,
    type           VARCHAR(20) NOT NULL CHECK (type IN ('income','expense','transfer')),
    amount         NUMERIC(15,2) NOT NULL CHECK (amount > 0),
    description    VARCHAR(255),
    merchant_name  VARCHAR(150),
    notes          TEXT,
    receipt_url    TEXT,
    date           DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW()
  );

  -- BUDGETS
  CREATE TABLE IF NOT EXISTS budgets (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id UUID REFERENCES categories(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,
    amount      NUMERIC(15,2) NOT NULL CHECK (amount > 0),
    period      VARCHAR(20) NOT NULL DEFAULT 'monthly' CHECK (period IN ('weekly','monthly','yearly')),
    start_date  DATE NOT NULL,
    end_date    DATE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
  );

  -- RECEIPT SCANS
  CREATE TABLE IF NOT EXISTS receipt_scans (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_url         TEXT NOT NULL,
    file_name        VARCHAR(255),
    status           VARCHAR(30) DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
    merchant_name    VARCHAR(150),
    total_amount     NUMERIC(15,2),
    scan_date        DATE,
    suggested_category_id UUID REFERENCES categories(id),
    confidence_score INTEGER DEFAULT 0 CHECK (confidence_score BETWEEN 0 AND 100),
    raw_text         TEXT,
    transaction_id   UUID REFERENCES transactions(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
  );

  -- INDEXES
  CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date DESC);
  CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
  CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);
  CREATE INDEX IF NOT EXISTS idx_budgets_user_id ON budgets(user_id);
  CREATE INDEX IF NOT EXISTS idx_receipt_scans_user_id ON receipt_scans(user_id);

  -- ALTER TABLES FOR NEW FEATURES
  DO $$ BEGIN
    ALTER TABLE users ADD COLUMN reset_token VARCHAR(255);
    ALTER TABLE users ADD COLUMN reset_token_expires TIMESTAMPTZ;
  EXCEPTION WHEN duplicate_column THEN NULL; END $$;

  DO $$ BEGIN
    ALTER TABLE transactions ADD COLUMN to_wallet_id UUID REFERENCES wallets(id) ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_column THEN NULL; END $$;

  -- AUTO UPDATE updated_at
  CREATE OR REPLACE FUNCTION update_updated_at()
  RETURNS TRIGGER AS $$
  BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
  $$ LANGUAGE plpgsql;

  DO $$ BEGIN
    CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

  DO $$ BEGIN
    CREATE TRIGGER trg_transactions_updated_at BEFORE UPDATE ON transactions
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

  DO $$ BEGIN
    CREATE TRIGGER trg_wallets_updated_at BEFORE UPDATE ON wallets
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
`;

async function runMigrations() {
  const client = await pool.connect();
  try {
    console.log('🔄 Running migrations...');
    await client.query(migrations);
    console.log('✅ Migrations completed successfully.');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations();
