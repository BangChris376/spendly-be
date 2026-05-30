require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');

// system categories — icon values are Lucide React component names (PascalCase)
const SYSTEM_CATEGORIES = [
  { name: 'Lifestyle',     icon: 'Shirt',           color: '#F59E0B', type: 'expense' },
  { name: 'Groceries',     icon: 'ShoppingCart',    color: '#10B981', type: 'expense' },
  { name: 'Beauty',        icon: 'Sparkles',        color: '#EC4899', type: 'expense' },
  { name: 'Gas',           icon: 'Fuel',            color: '#F97316', type: 'expense' },
  { name: 'F&B',           icon: 'UtensilsCrossed', color: '#EF4444', type: 'expense' },
  { name: 'Health',        icon: 'HeartPulse',      color: '#3B82F6', type: 'expense' },
  { name: 'Household',     icon: 'House',           color: '#8B5CF6', type: 'expense' },
  { name: 'Electricity',   icon: 'Zap',             color: '#EAB308', type: 'expense' },
  { name: 'Transport',     icon: 'Car',             color: '#06B6D4', type: 'expense' },
  { name: 'Entertainment', icon: 'Tv',              color: '#A855F7', type: 'expense' },
  { name: 'Others',        icon: 'LayoutGrid',      color: '#6B7280', type: 'both'    },
  { name: 'Income',        icon: 'Wallet',          color: '#16A34A', type: 'income'  },
];

const SAMPLE_TRANSACTIONS = [
  { type: 'income',  merchant: 'Salary Deposit',       amount: 15000000, cat: 'Income',        days: 5  },
  { type: 'expense', merchant: 'H&M Grand Indonesia',  amount: 450000,   cat: 'Lifestyle',     days: 0  },
  { type: 'expense', merchant: 'Sociolla',             amount: 88500,    cat: 'Beauty',        days: 2  },
  { type: 'expense', merchant: 'Starbucks',            amount: 65000,    cat: 'F&B',           days: 0  },
  { type: 'expense', merchant: 'Blue Door Coffee',     amount: 88000,    cat: 'F&B',           days: 1  },
  { type: 'expense', merchant: 'Pertamina MT Haryono', amount: 250000,   cat: 'Gas',           days: 1  },
  { type: 'expense', merchant: 'Indomaret',            amount: 88888,    cat: 'Groceries',     days: 0  },
  { type: 'expense', merchant: 'Superindo',            amount: 188000,   cat: 'Groceries',     days: 3  },
  { type: 'expense', merchant: 'Apotek K24',           amount: 75000,    cat: 'Health',        days: 4  },
  { type: 'expense', merchant: 'IKEA',                 amount: 320000,   cat: 'Household',     days: 6  },
  { type: 'expense', merchant: 'PLN Token Listrik',    amount: 200000,   cat: 'Electricity',   days: 7  },
  { type: 'expense', merchant: 'Uniqlo',               amount: 399000,   cat: 'Lifestyle',     days: 8  },
  { type: 'expense', merchant: 'KFC',                  amount: 95000,    cat: 'F&B',           days: 9  },
  { type: 'expense', merchant: 'Guardian',             amount: 145000,   cat: 'Beauty',        days: 10 },
  { type: 'expense', merchant: 'Shell Pom Bensin',     amount: 100000,   cat: 'Gas',           days: 12 },
  { type: 'expense', merchant: 'Alfamart',             amount: 55000,    cat: 'Groceries',     days: 13 },
  { type: 'expense', merchant: 'Klinik Pratama',       amount: 150000,   cat: 'Health',        days: 14 },
  { type: 'expense', merchant: 'Ace Hardware',         amount: 210000,   cat: 'Household',     days: 15 },
  { type: 'expense', merchant: 'PLN Pascabayar',       amount: 450000,   cat: 'Electricity',   days: 20 },
  { type: 'expense', merchant: 'Grab',                 amount: 45000,    cat: 'Transport',     days: 2  },
  { type: 'expense', merchant: 'Netflix',              amount: 54000,    cat: 'Entertainment', days: 5  },
];

const SAMPLE_BUDGETS = [
  { name: 'Monthly Groceries', cat: 'Groceries',     amount: 2000000 },
  { name: 'F&B Budget',        cat: 'F&B',           amount: 1500000 },
  { name: 'Lifestyle',         cat: 'Lifestyle',     amount: 1000000 },
  { name: 'Electricity',       cat: 'Electricity',   amount: 500000  },
  { name: 'Health',            cat: 'Health',        amount: 500000  },
  { name: 'Transport',         cat: 'Transport',     amount: 300000  },
  { name: 'Entertainment',     cat: 'Entertainment', amount: 300000  },
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

    // wipe existing demo user (cascade deletes all related data)
    await client.query(
      `DELETE FROM users WHERE email = $1`,
      ['alex.graham@spendly.io']
    );
    console.log('  old data cleared');

    // demo user
    const hash = await bcrypt.hash('password123', 12);
    const userRes = await client.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, is_premium, monthly_limit)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id`,
      ['alex.graham@spendly.io', hash, 'Alex', 'Graham', true, 25000000]
    );
    const userId = userRes.rows[0].id;
    console.log('  user created');

    await client.query(
      `INSERT INTO user_preferences (user_id) VALUES ($1)`,
      [userId]
    );

    // system categories — always insert fresh so icon/color are correct
    const catIds = {};
    for (const cat of SYSTEM_CATEGORIES) {
      const inserted = await client.query(
        `INSERT INTO categories (user_id, name, icon, color, type, is_system)
         VALUES ($1,$2,$3,$4,$5,true)
         RETURNING id`,
        [userId, cat.name, cat.icon, cat.color, cat.type]
      );
      catIds[cat.name] = inserted.rows[0].id;
    }
    console.log(`  categories inserted (${Object.keys(catIds).length})`);

    // default wallet
    const walletRes = await client.query(
      `INSERT INTO wallets (user_id, name, type, account_number, bank_name, balance, is_default)
       VALUES ($1,'BCA Savings','bank','****1234','Bank BCA',12850000,true) RETURNING id`,
      [userId]
    );
    const walletId = walletRes.rows[0].id;
    console.log('  wallet created');

    // sample transactions
    for (const t of SAMPLE_TRANSACTIONS) {
      if (!catIds[t.cat]) continue;
      await client.query(
        `INSERT INTO transactions (user_id, wallet_id, category_id, type, amount, merchant_name, date)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [userId, walletId, catIds[t.cat], t.type, t.amount, t.merchant, dateOffset(t.days)]
      );
    }
    console.log(`  transactions inserted (${SAMPLE_TRANSACTIONS.length})`);

    // sample budgets
    const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const lastDay  = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().split('T')[0];
    for (const b of SAMPLE_BUDGETS) {
      if (!catIds[b.cat]) continue;
      await client.query(
        `INSERT INTO budgets (user_id, category_id, name, amount, period, start_date, end_date)
         VALUES ($1,$2,$3,$4,'monthly',$5,$6)`,
        [userId, catIds[b.cat], b.name, b.amount, firstDay, lastDay]
      );
    }
    console.log(`  budgets inserted (${SAMPLE_BUDGETS.length})`);

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
