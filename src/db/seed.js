require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');

// system categories aligned with the ai forecaster model
const SYSTEM_CATEGORIES = [
  { name: 'Beauty',    icon: 'beauty',    color: '#EC4899', type: 'expense' },
  { name: 'F&B',       icon: 'fnb',       color: '#EF4444', type: 'expense' },
  { name: 'Gas',       icon: 'gas',       color: '#F97316', type: 'expense' },
  { name: 'Groceries', icon: 'groceries', color: '#10B981', type: 'expense' },
  { name: 'Health',    icon: 'health',    color: '#3B82F6', type: 'expense' },
  { name: 'HouseHold', icon: 'household', color: '#8B5CF6', type: 'expense' },
  { name: 'Lifestyle', icon: 'lifestyle', color: '#F59E0B', type: 'expense' },
  { name: 'Listrik',   icon: 'electric',  color: '#EAB308', type: 'expense' },
  { name: 'Income',    icon: 'income',    color: '#16A34A', type: 'income'  },
];

const SAMPLE_TRANSACTIONS = [
  { type: 'income',  merchant: 'Salary Deposit',       amount: 15000000, cat: 'Income',    days: 5  },
  { type: 'expense', merchant: 'H&M Grand Indonesia',  amount: 450000,   cat: 'Lifestyle', days: 0  },
  { type: 'expense', merchant: 'Sociolla',             amount: 88500,    cat: 'Beauty',    days: 2  },
  { type: 'expense', merchant: 'Starbucks',            amount: 65000,    cat: 'F&B',       days: 0  },
  { type: 'expense', merchant: 'Blue Door Coffee',     amount: 88000,    cat: 'F&B',       days: 1  },
  { type: 'expense', merchant: 'Pertamina MT Haryono', amount: 250000,   cat: 'Gas',       days: 1  },
  { type: 'expense', merchant: 'Indomaret',            amount: 88888,    cat: 'Groceries', days: 0  },
  { type: 'expense', merchant: 'Superindo',            amount: 188000,   cat: 'Groceries', days: 3  },
  { type: 'expense', merchant: 'Apotek K24',           amount: 75000,    cat: 'Health',    days: 4  },
  { type: 'expense', merchant: 'IKEA',                 amount: 320000,   cat: 'HouseHold', days: 6  },
  { type: 'expense', merchant: 'PLN Token Listrik',    amount: 200000,   cat: 'Listrik',   days: 7  },
  { type: 'expense', merchant: 'Uniqlo',               amount: 399000,   cat: 'Lifestyle', days: 8  },
  { type: 'expense', merchant: 'KFC',                  amount: 95000,    cat: 'F&B',       days: 9  },
  { type: 'expense', merchant: 'Guardian',             amount: 145000,   cat: 'Beauty',    days: 10 },
  { type: 'expense', merchant: 'Shell Pom Bensin',     amount: 100000,   cat: 'Gas',       days: 12 },
  { type: 'expense', merchant: 'Alfamart',             amount: 55000,    cat: 'Groceries', days: 13 },
  { type: 'expense', merchant: 'Klinik Pratama',       amount: 150000,   cat: 'Health',    days: 14 },
  { type: 'expense', merchant: 'Ace Hardware',         amount: 210000,   cat: 'HouseHold', days: 15 },
  { type: 'expense', merchant: 'PLN Pascabayar',       amount: 450000,   cat: 'Listrik',   days: 20 },
];

const SAMPLE_BUDGETS = [
  { name: 'Monthly Groceries', cat: 'Groceries', amount: 2000000 },
  { name: 'F&B Budget',        cat: 'F&B',       amount: 1500000 },
  { name: 'Lifestyle',         cat: 'Lifestyle', amount: 1000000 },
  { name: 'Listrik',           cat: 'Listrik',   amount: 500000  },
  { name: 'Health',            cat: 'Health',    amount: 500000  },
];

const dateOffset = (days) => {
  const dt = new Date();
  dt.setDate(dt.getDate() - days);
  return dt.toISOString().split('T')[0];
};

async function seed() {
  const client = await pool.connect();
  try {
    console.log('seeding database...');
    await client.query('BEGIN');

    // demo user
    const hash = await bcrypt.hash('password123', 12);
    const userRes = await client.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, is_premium, monthly_limit)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (email) DO UPDATE SET first_name = EXCLUDED.first_name
       RETURNING id`,
      ['alex.graham@spendly.io', hash, 'Alex', 'Graham', true, 25000000]
    );
    const userId = userRes.rows[0].id;
    console.log('  user ready');

    await client.query(
      `INSERT INTO user_preferences (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );

    // system categories
    const catIds = {};
    for (const cat of SYSTEM_CATEGORIES) {
      const inserted = await client.query(
        `INSERT INTO categories (user_id, name, icon, color, type, is_system)
         VALUES ($1,$2,$3,$4,$5,true)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [userId, cat.name, cat.icon, cat.color, cat.type]
      );
      if (inserted.rows.length) {
        catIds[cat.name] = inserted.rows[0].id;
      } else {
        const existing = await client.query(
          `SELECT id FROM categories WHERE user_id=$1 AND LOWER(name)=LOWER($2)`,
          [userId, cat.name]
        );
        if (existing.rows.length) catIds[cat.name] = existing.rows[0].id;
      }
    }
    console.log(`  categories ready (${Object.keys(catIds).length})`);

    // default wallet
    const walletRes = await client.query(
      `SELECT id FROM wallets WHERE user_id=$1 AND is_default=true LIMIT 1`,
      [userId]
    );
    let walletId = walletRes.rows[0]?.id;
    if (!walletId) {
      const inserted = await client.query(
        `INSERT INTO wallets (user_id, name, type, account_number, bank_name, balance, is_default)
         VALUES ($1,'BCA Savings','bank','****1234','Bank BCA',12850000,true) RETURNING id`,
        [userId]
      );
      walletId = inserted.rows[0].id;
    }
    console.log('  wallet ready');

    // sample transactions (skip if user already has any)
    const txnCheck = await client.query(
      `SELECT COUNT(*)::int AS count FROM transactions WHERE user_id=$1`,
      [userId]
    );
    if (txnCheck.rows[0].count === 0) {
      for (const t of SAMPLE_TRANSACTIONS) {
        if (!catIds[t.cat]) continue;
        await client.query(
          `INSERT INTO transactions (user_id, wallet_id, category_id, type, amount, merchant_name, date)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [userId, walletId, catIds[t.cat], t.type, t.amount, t.merchant, dateOffset(t.days)]
        );
      }
      console.log(`  transactions inserted (${SAMPLE_TRANSACTIONS.length})`);
    } else {
      console.log('  transactions already exist, skipping');
    }

    // sample budgets (only if none yet)
    const budgetCheck = await client.query(
      `SELECT COUNT(*)::int AS count FROM budgets WHERE user_id=$1`,
      [userId]
    );
    if (budgetCheck.rows[0].count === 0) {
      const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
      const lastDay = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().split('T')[0];
      for (const b of SAMPLE_BUDGETS) {
        if (!catIds[b.cat]) continue;
        await client.query(
          `INSERT INTO budgets (user_id, category_id, name, amount, period, start_date, end_date)
           VALUES ($1,$2,$3,$4,'monthly',$5,$6)`,
          [userId, catIds[b.cat], b.name, b.amount, firstDay, lastDay]
        );
      }
      console.log(`  budgets inserted (${SAMPLE_BUDGETS.length})`);
    } else {
      console.log('  budgets already exist, skipping');
    }

    await client.query('COMMIT');
    console.log('\nseed done');
    console.log('  email   : alex.graham@spendly.io');
    console.log('  password: password123');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('seed failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
