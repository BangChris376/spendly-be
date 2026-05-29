require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('./database');

/**
 * Kategori WAJIB sinkron dengan model AI tim (8 kategori):
 * Beauty | F&B | Gas | Groceries | Health | HouseHold | Lifestyle | Listrik
 *
 * + Income sebagai kategori pemasukan (tidak diproses model AI)
 */
const SYSTEM_CATEGORIES = [
  // ── 8 Kategori model AI ─────────────────────────────────────
  { name: 'Beauty',    icon: '💄', color: '#EC4899', type: 'expense', ai_label: 'Beauty'    },
  { name: 'F&B',       icon: '🍽️', color: '#EF4444', type: 'expense', ai_label: 'F&B'       },
  { name: 'Gas',       icon: '⛽', color: '#F97316', type: 'expense', ai_label: 'Gas'       },
  { name: 'Groceries', icon: '🛒', color: '#10B981', type: 'expense', ai_label: 'Groceries' },
  { name: 'Health',    icon: '🏥', color: '#3B82F6', type: 'expense', ai_label: 'Health'    },
  { name: 'HouseHold', icon: '🏠', color: '#8B5CF6', type: 'expense', ai_label: 'HouseHold' },
  { name: 'Lifestyle', icon: '👗', color: '#F59E0B', type: 'expense', ai_label: 'Lifestyle' },
  { name: 'Listrik',   icon: '⚡', color: '#EAB308', type: 'expense', ai_label: 'Listrik'   },
  // ── Non-AI kategori ──────────────────────────────────────────
  { name: 'Income',    icon: '💰', color: '#16A34A', type: 'income',  ai_label: null        },
];

async function seed() {
  const client = await pool.connect();
  try {
    console.log('🌱 Seeding database...');
    await client.query('BEGIN');

    // Demo User
    const hash = await bcrypt.hash('password123', 12);
    const userRes = await client.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, is_premium, monthly_limit)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (email) DO UPDATE SET first_name=EXCLUDED.first_name
       RETURNING id`,
      ['alex.graham@spendly.io', hash, 'Alex', 'Graham', true, 25000000]
    );
    const userId = userRes.rows[0].id;
    console.log('   ✅ User created');

    await client.query(
      `INSERT INTO user_preferences (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );

    // System Categories — sinkron dengan 8 kategori model AI
    const catIds = {};
    for (const cat of SYSTEM_CATEGORIES) {
      const r = await client.query(
        `INSERT INTO categories (user_id, name, icon, color, type, is_system)
         VALUES ($1,$2,$3,$4,$5,true)
         ON CONFLICT DO NOTHING RETURNING id, name`,
        [userId, cat.name, cat.icon, cat.color, cat.type]
      );
      if (r.rows.length) {
        catIds[cat.name] = r.rows[0].id;
      } else {
        const ex = await client.query(
          `SELECT id FROM categories WHERE user_id=$1 AND name=$2`, [userId, cat.name]
        );
        if (ex.rows.length) catIds[cat.name] = ex.rows[0].id;
      }
    }
    console.log(`   ✅ Categories: ${Object.keys(catIds).join(', ')}`);

    // Default Wallet
    const walletRes = await client.query(
      `INSERT INTO wallets (user_id, name, type, account_number, bank_name, balance, is_default)
       VALUES ($1,'BCA Savings','bank','****1234','Bank BCA',12850000,true)
       ON CONFLICT DO NOTHING RETURNING id`,
      [userId]
    );
    let walletId = walletRes.rows[0]?.id;
    if (!walletId) {
      const w = await client.query(`SELECT id FROM wallets WHERE user_id=$1 AND is_default=true LIMIT 1`, [userId]);
      walletId = w.rows[0]?.id;
    }
    console.log('   ✅ Wallet created');

    // Sample Transactions (sesuai 8 kategori AI)
    if (walletId && Object.keys(catIds).length) {
      const d = (offset) => {
        const dt = new Date(); dt.setDate(dt.getDate() - offset);
        return dt.toISOString().split('T')[0];
      };

      const txns = [
        { type:'income',  merchant:'Salary Deposit',       amount:15000000, cat:'Income',    days:5  },
        { type:'expense', merchant:'H&M Grand Indonesia',  amount:450000,   cat:'Lifestyle', days:0  },
        { type:'expense', merchant:'Sociolla',             amount:88500,    cat:'Beauty',    days:2  },
        { type:'expense', merchant:'Starbucks',            amount:65000,    cat:'F&B',       days:0  },
        { type:'expense', merchant:'Blue Door Coffee',     amount:88000,    cat:'F&B',       days:1  },
        { type:'expense', merchant:'Pertamina MT Haryono', amount:250000,   cat:'Gas',       days:1  },
        { type:'expense', merchant:'Indomaret',            amount:88888,    cat:'Groceries', days:0  },
        { type:'expense', merchant:'Superindo',            amount:188000,   cat:'Groceries', days:3  },
        { type:'expense', merchant:'Apotek K24',           amount:75000,    cat:'Health',    days:4  },
        { type:'expense', merchant:'IKEA',                 amount:320000,   cat:'HouseHold', days:6  },
        { type:'expense', merchant:'PLN Token Listrik',    amount:200000,   cat:'Listrik',   days:7  },
        { type:'expense', merchant:'Uniqlo',               amount:399000,   cat:'Lifestyle', days:8  },
        { type:'expense', merchant:'KFC',                  amount:95000,    cat:'F&B',       days:9  },
        { type:'expense', merchant:'Guardian',             amount:145000,   cat:'Beauty',    days:10 },
        { type:'expense', merchant:'Shell Pom Bensin',     amount:100000,   cat:'Gas',       days:12 },
        { type:'expense', merchant:'Alfamart',             amount:55000,    cat:'Groceries', days:13 },
        { type:'expense', merchant:'Klinik Pratama',       amount:150000,   cat:'Health',    days:14 },
        { type:'expense', merchant:'Ace Hardware',         amount:210000,   cat:'HouseHold', days:15 },
        { type:'expense', merchant:'PLN Pascabayar',       amount:450000,   cat:'Listrik',   days:20 },
      ];

      for (const t of txns) {
        if (!catIds[t.cat]) continue;
        await client.query(
          `INSERT INTO transactions (user_id,wallet_id,category_id,type,amount,merchant_name,date)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
          [userId, walletId, catIds[t.cat], t.type, t.amount, t.merchant, d(t.days)]
        );
      }
      console.log(`   ✅ Transactions: ${txns.length} records`);

      // Budgets
      const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
      const lastDay  = new Date(new Date().getFullYear(), new Date().getMonth()+1, 0).toISOString().split('T')[0];
      const budgets  = [
        { name:'Monthly Groceries', cat:'Groceries', amount:2000000 },
        { name:'F&B Budget',        cat:'F&B',       amount:1500000 },
        { name:'Lifestyle',         cat:'Lifestyle',  amount:1000000 },
        { name:'Listrik',           cat:'Listrik',    amount:500000  },
        { name:'Health',            cat:'Health',     amount:500000  },
      ];
      for (const b of budgets) {
        if (!catIds[b.cat]) continue;
        await client.query(
          `INSERT INTO budgets (user_id,category_id,name,amount,period,start_date,end_date)
           VALUES ($1,$2,$3,$4,'monthly',$5,$6) ON CONFLICT DO NOTHING`,
          [userId, catIds[b.cat], b.name, b.amount, firstDay, lastDay]
        );
      }
      console.log(`   ✅ Budgets: ${budgets.length} records`);
    }

    await client.query('COMMIT');
    console.log('\n✅ Seed selesai!');
    console.log('   📧 Email   : alex.graham@spendly.io');
    console.log('   🔑 Password: password123');
    console.log('\n   📦 Kategori AI (8):');
    SYSTEM_CATEGORIES.filter(c => c.ai_label).forEach(c => console.log(`      ${c.icon} ${c.name}`));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed gagal:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
