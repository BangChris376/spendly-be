const { query } = require('../config/database');
const { success, paginated } = require('../utils/response');

const getTransactions = async (req, res, next) => {
  try {
    const {
      page = 1, limit = 10,
      type, category_id, wallet_id,
      date_from, date_to,
      amount_min, amount_max,
      search, sort = 'date', order = 'DESC',
    } = req.query;

    const offset = (page - 1) * limit;
    const conditions = ['t.user_id = $1'];
    const values = [req.user.id];
    let idx = 2;

    if (type) { conditions.push(`t.type = $${idx++}`); values.push(type); }
    if (category_id) { conditions.push(`t.category_id = $${idx++}`); values.push(category_id); }
    if (wallet_id) { conditions.push(`t.wallet_id = $${idx++}`); values.push(wallet_id); }
    if (date_from) { conditions.push(`t.date >= $${idx++}`); values.push(date_from); }
    if (date_to) { conditions.push(`t.date <= $${idx++}`); values.push(date_to); }
    if (amount_min) { conditions.push(`t.amount >= $${idx++}`); values.push(amount_min); }
    if (amount_max) { conditions.push(`t.amount <= $${idx++}`); values.push(amount_max); }
    if (search) {
      conditions.push(`(t.merchant_name ILIKE $${idx} OR t.description ILIKE $${idx})`);
      values.push(`%${search}%`); idx++;
    }

    const where = conditions.join(' AND ');
    const allowedSort = { date: 't.date', amount: 't.amount', created_at: 't.created_at' };
    const sortCol = allowedSort[sort] || 't.date';
    const sortDir = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const countRes = await query(`SELECT COUNT(*) FROM transactions t WHERE ${where}`, values);
    const total = parseInt(countRes.rows[0].count);

    values.push(limit, offset);
    const result = await query(
      `SELECT t.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
              w.name AS wallet_name, w.type AS wallet_type
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN wallets w ON w.id = t.wallet_id
       WHERE ${where}
       ORDER BY ${sortCol} ${sortDir}
       LIMIT $${idx} OFFSET $${idx + 1}`,
      values
    );

    return paginated(res, result.rows, total, page, limit);
  } catch (err) {
    next(err);
  }
};

const getTransaction = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT t.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
              w.name AS wallet_name
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN wallets w ON w.id = t.wallet_id
       WHERE t.id = $1 AND t.user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }
    return success(res, result.rows[0]);
  } catch (err) {
    next(err);
  }
};

const createTransaction = async (req, res, next) => {
  try {
    const { wallet_id, to_wallet_id, category_id, type, amount, description, merchant_name, notes, date } = req.body;

    // Check wallet belongs to user
    if (wallet_id) {
      const w = await query('SELECT id FROM wallets WHERE id=$1 AND user_id=$2', [wallet_id, req.user.id]);
      if (!w.rows.length) return res.status(400).json({ success: false, message: 'Source wallet not found' });
    }
    if (type === 'transfer' && to_wallet_id) {
      const w2 = await query('SELECT id FROM wallets WHERE id=$1 AND user_id=$2', [to_wallet_id, req.user.id]);
      if (!w2.rows.length) return res.status(400).json({ success: false, message: 'Destination wallet not found' });
    }

    const result = await query(
      `INSERT INTO transactions (user_id, wallet_id, to_wallet_id, category_id, type, amount, description, merchant_name, notes, date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [req.user.id, wallet_id || null, to_wallet_id || null, category_id || null, type, amount, description, merchant_name, notes, date || new Date()]
    );

    // Update wallet balance
    if (type === 'transfer' && wallet_id && to_wallet_id) {
      await query('UPDATE wallets SET balance = balance - $1 WHERE id = $2', [amount, wallet_id]);
      await query('UPDATE wallets SET balance = balance + $1 WHERE id = $2', [amount, to_wallet_id]);
    } else if (wallet_id) {
      const delta = type === 'income' ? amount : -amount;
      await query('UPDATE wallets SET balance = balance + $1 WHERE id = $2', [delta, wallet_id]);
    }

    return success(res, result.rows[0], 'Transaction created', 201);
  } catch (err) {
    next(err);
  }
};

const updateTransaction = async (req, res, next) => {
  try {
    const existing = await query(
      'SELECT * FROM transactions WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    if (!existing.rows.length) return res.status(404).json({ success: false, message: 'Transaction not found' });

    const old = existing.rows[0];
    const { wallet_id, category_id, amount, description, merchant_name, notes, date } = req.body;

    const result = await query(
      `UPDATE transactions
       SET wallet_id=COALESCE($1, wallet_id), category_id=COALESCE($2, category_id), amount=COALESCE($3, amount),
           description=COALESCE($4, description), merchant_name=COALESCE($5, merchant_name),
           notes=COALESCE($6, notes), date=COALESCE($7, date)
       WHERE id=$8 AND user_id=$9 RETURNING *`,
      [wallet_id, category_id, amount, description, merchant_name, notes, date, req.params.id, req.user.id]
    );

    // Adjust wallet balance if amount or wallet changed
    if ((amount && amount !== old.amount) || (wallet_id && wallet_id !== old.wallet_id)) {
      const newAmount = amount || old.amount;
      const newWalletId = wallet_id || old.wallet_id;

      if (old.type === 'transfer') {
        // Revert old
        if (old.wallet_id) await query('UPDATE wallets SET balance = balance + $1 WHERE id = $2', [old.amount, old.wallet_id]);
        if (old.to_wallet_id) await query('UPDATE wallets SET balance = balance - $1 WHERE id = $2', [old.amount, old.to_wallet_id]);
        
        // Apply new
        if (newWalletId) await query('UPDATE wallets SET balance = balance - $1 WHERE id = $2', [newAmount, newWalletId]);
        if (old.to_wallet_id) await query('UPDATE wallets SET balance = balance + $1 WHERE id = $2', [newAmount, old.to_wallet_id]);
      } else {
        // Revert old wallet
        if (old.wallet_id) {
          const revertDelta = old.type === 'income' ? -old.amount : old.amount;
          await query('UPDATE wallets SET balance = balance + $1 WHERE id = $2', [revertDelta, old.wallet_id]);
        }
        
        // Apply to new wallet
        if (newWalletId) {
          const applyDelta = old.type === 'income' ? newAmount : -newAmount;
          await query('UPDATE wallets SET balance = balance + $1 WHERE id = $2', [applyDelta, newWalletId]);
        }
      }
    }

    return success(res, result.rows[0], 'Transaction updated');
  } catch (err) {
    next(err);
  }
};

const deleteTransaction = async (req, res, next) => {
  try {
    const result = await query(
      'DELETE FROM transactions WHERE id=$1 AND user_id=$2 RETURNING *',
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ success: false, message: 'Transaction not found' });

    // Reverse wallet balance
    const t = result.rows[0];
    if (t.wallet_id) {
      const delta = t.type === 'income' ? -t.amount : t.amount;
      await query('UPDATE wallets SET balance = balance + $1 WHERE id = $2', [delta, t.wallet_id]);
    }

    return success(res, null, 'Transaction deleted');
  } catch (err) {
    next(err);
  }
};

const getSummary = async (req, res, next) => {
  try {
    const { period = 'month', year = new Date().getFullYear(), month = new Date().getMonth() + 1 } = req.query;

    let dateFilter;
    if (period === 'month') {
      dateFilter = `date_trunc('month', t.date) = date_trunc('month', make_date($2::int, $3::int, 1))`;
    } else {
      dateFilter = `date_trunc('year', t.date) = date_trunc('year', make_date($2::int, 1, 1))`;
    }

    const result = await query(
      `SELECT
         COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0) AS total_income,
         COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) AS total_expense,
         COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END),0) AS net_balance,
         COUNT(*) AS transaction_count
       FROM transactions t
       WHERE t.user_id=$1 AND ${dateFilter}`,
      [req.user.id, year, month]
    );

    // Category breakdown
    const breakdown = await query(
      `SELECT c.name, c.icon, c.color,
              SUM(t.amount) AS total, COUNT(*) AS count
       FROM transactions t
       JOIN categories c ON c.id = t.category_id
       WHERE t.user_id=$1 AND t.type='expense' AND ${dateFilter}
       GROUP BY c.id, c.name, c.icon, c.color
       ORDER BY total DESC LIMIT 6`,
      [req.user.id, year, month]
    );

    return success(res, { summary: result.rows[0], breakdown: breakdown.rows });
  } catch (err) {
    next(err);
  }
};

const getCashFlow = async (req, res, next) => {
  try {
    const { months = 6 } = req.query;
    const result = await query(
      `SELECT
         TO_CHAR(date_trunc('month', date), 'Mon') AS month,
         date_trunc('month', date) AS month_date,
         COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0) AS income,
         COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) AS expense
       FROM transactions
       WHERE user_id=$1 AND date >= NOW() - INTERVAL '${parseInt(months)} months'
       GROUP BY date_trunc('month', date)
       ORDER BY month_date ASC`,
      [req.user.id]
    );
    return success(res, result.rows);
  } catch (err) {
    next(err);
  }
};

const getSpendingByDay = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT EXTRACT(DOW FROM date) AS dow, SUM(amount) AS total
       FROM transactions
       WHERE user_id=$1 AND type='expense' AND date >= NOW() - INTERVAL '30 days'
       GROUP BY dow ORDER BY dow`,
      [req.user.id]
    );
    return success(res, result.rows);
  } catch (err) {
    next(err);
  }
};

const exportCsv = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT t.date, t.type, t.amount, c.name AS category_name, w.name AS wallet_name, t.description, t.merchant_name
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN wallets w ON w.id = t.wallet_id
       WHERE t.user_id = $1
       ORDER BY t.date DESC`,
      [req.user.id]
    );

    const fields = ['Date', 'Type', 'Amount', 'Category', 'Wallet', 'Description', 'Merchant'];
    let csv = fields.join(',') + '\n';
    result.rows.forEach(row => {
      const rowDate = row.date ? new Date(row.date).toISOString().split('T')[0] : '';
      csv += `${rowDate},${row.type},${row.amount},"${row.category_name || ''}","${row.wallet_name || ''}","${row.description || ''}","${row.merchant_name || ''}"\n`;
    });

    res.header('Content-Type', 'text/csv');
    res.attachment('transactions.csv');
    return res.send(csv);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getTransactions, getTransaction, createTransaction,
  updateTransaction, deleteTransaction, getSummary, getCashFlow, getSpendingByDay, exportCsv,
};
