const { query, getClient } = require('../config/database');
const { success, failure, paginated } = require('../utils/response');

const SORT_COLUMNS = { date: 't.date', amount: 't.amount', created_at: 't.created_at' };

const getTransactions = async (req, res, next) => {
  try {
    const {
      page = 1, limit = 10,
      type, category_id, wallet_id,
      date_from, date_to,
      amount_min, amount_max,
      search, sort = 'date', order = 'DESC',
    } = req.query;

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
      values.push(`%${search}%`);
      idx++;
    }

    const where = conditions.join(' AND ');
    const sortCol = SORT_COLUMNS[sort] || SORT_COLUMNS.date;
    const sortDir = String(order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const countRes = await query(`SELECT COUNT(*)::int AS total FROM transactions t WHERE ${where}`, values);
    const total = countRes.rows[0].total;

    const offset = (page - 1) * limit;
    values.push(limit, offset);

    const result = await query(
      `SELECT t.*,
              c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
              w.name AS wallet_name, w.type AS wallet_type
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN wallets w    ON w.id = t.wallet_id
       WHERE ${where}
       ORDER BY ${sortCol} ${sortDir}
       LIMIT $${idx} OFFSET $${idx + 1}`,
      values
    );

    return paginated(res, result.rows, total, page, limit);
  } catch (err) {
    return next(err);
  }
};

const getTransaction = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT t.*,
              c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
              w.name AS wallet_name
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN wallets w    ON w.id = t.wallet_id
       WHERE t.id = $1 AND t.user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return failure(res, 'Transaction not found', 404);
    return success(res, result.rows[0]);
  } catch (err) {
    return next(err);
  }
};

const ownsWallet = async (client, walletId, userId) => {
  if (!walletId) return true;
  const r = await client.query(`SELECT 1 FROM wallets WHERE id=$1 AND user_id=$2`, [walletId, userId]);
  return r.rowCount > 0;
};

const applyBalanceDelta = async (client, walletId, delta) => {
  if (!walletId || !delta) return;
  await client.query(`UPDATE wallets SET balance = balance + $1 WHERE id = $2`, [delta, walletId]);
};

const createTransaction = async (req, res, next) => {
  const client = await getClient();
  try {
    const {
      wallet_id, to_wallet_id, category_id,
      type, amount, description, merchant_name, notes, date,
    } = req.body;

    await client.query('BEGIN');

    if (!(await ownsWallet(client, wallet_id, req.user.id))) {
      await client.query('ROLLBACK');
      return failure(res, 'Source wallet not found', 400);
    }
    if (type === 'transfer' && !(await ownsWallet(client, to_wallet_id, req.user.id))) {
      await client.query('ROLLBACK');
      return failure(res, 'Destination wallet not found', 400);
    }

    const inserted = await client.query(
      `INSERT INTO transactions
         (user_id, wallet_id, to_wallet_id, category_id, type, amount,
          description, merchant_name, notes, date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        req.user.id,
        wallet_id || null,
        to_wallet_id || null,
        category_id || null,
        type,
        amount,
        description,
        merchant_name,
        notes,
        date || new Date(),
      ]
    );

    if (type === 'transfer' && wallet_id && to_wallet_id) {
      await applyBalanceDelta(client, wallet_id, -amount);
      await applyBalanceDelta(client, to_wallet_id, amount);
    } else if (wallet_id) {
      await applyBalanceDelta(client, wallet_id, type === 'income' ? amount : -amount);
    }

    await client.query('COMMIT');
    return success(res, inserted.rows[0], 'Transaction created', 201);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return next(err);
  } finally {
    client.release();
  }
};

const updateTransaction = async (req, res, next) => {
  const client = await getClient();
  try {
    const existing = await client.query(
      `SELECT * FROM transactions WHERE id=$1 AND user_id=$2`,
      [req.params.id, req.user.id]
    );
    if (!existing.rows.length) return failure(res, 'Transaction not found', 404);

    const old = existing.rows[0];
    const { wallet_id, category_id, amount, description, merchant_name, notes, date } = req.body;

    await client.query('BEGIN');

    const updated = await client.query(
      `UPDATE transactions SET
         wallet_id     = COALESCE($1, wallet_id),
         category_id   = COALESCE($2, category_id),
         amount        = COALESCE($3, amount),
         description   = COALESCE($4, description),
         merchant_name = COALESCE($5, merchant_name),
         notes         = COALESCE($6, notes),
         date          = COALESCE($7, date)
       WHERE id=$8 AND user_id=$9 RETURNING *`,
      [wallet_id, category_id, amount, description, merchant_name, notes, date, req.params.id, req.user.id]
    );

    const amountChanged = amount && Number(amount) !== Number(old.amount);
    const walletChanged = wallet_id && wallet_id !== old.wallet_id;

    if (amountChanged || walletChanged) {
      const newAmount = amount || old.amount;
      const newWalletId = wallet_id || old.wallet_id;

      if (old.type === 'transfer') {
        await applyBalanceDelta(client, old.wallet_id, Number(old.amount));
        await applyBalanceDelta(client, old.to_wallet_id, -Number(old.amount));
        await applyBalanceDelta(client, newWalletId, -Number(newAmount));
        await applyBalanceDelta(client, old.to_wallet_id, Number(newAmount));
      } else {
        const revertDelta = old.type === 'income' ? -Number(old.amount) : Number(old.amount);
        await applyBalanceDelta(client, old.wallet_id, revertDelta);
        const applyDelta = old.type === 'income' ? Number(newAmount) : -Number(newAmount);
        await applyBalanceDelta(client, newWalletId, applyDelta);
      }
    }

    await client.query('COMMIT');
    return success(res, updated.rows[0], 'Transaction updated');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return next(err);
  } finally {
    client.release();
  }
};

const deleteTransaction = async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `DELETE FROM transactions WHERE id=$1 AND user_id=$2 RETURNING *`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return failure(res, 'Transaction not found', 404);
    }

    const t = result.rows[0];
    if (t.type === 'transfer') {
      await applyBalanceDelta(client, t.wallet_id, Number(t.amount));
      await applyBalanceDelta(client, t.to_wallet_id, -Number(t.amount));
    } else if (t.wallet_id) {
      await applyBalanceDelta(client, t.wallet_id, t.type === 'income' ? -Number(t.amount) : Number(t.amount));
    }

    await client.query('COMMIT');
    return success(res, null, 'Transaction deleted');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return next(err);
  } finally {
    client.release();
  }
};

const getSummary = async (req, res, next) => {
  try {
    const now = new Date();
    const period = req.query.period || 'month';
    const year = parseInt(req.query.year, 10) || now.getFullYear();
    const month = parseInt(req.query.month, 10) || now.getMonth() + 1;

    const dateFilter = period === 'year'
      ? `date_trunc('year', t.date) = date_trunc('year', make_date($2::int, 1, 1))`
      : `date_trunc('month', t.date) = date_trunc('month', make_date($2::int, $3::int, 1))`;

    const summary = await query(
      `SELECT
         COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END), 0) AS total_income,
         COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) AS total_expense,
         COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE -amount END), 0) AS net_balance,
         COUNT(*)::int AS transaction_count
       FROM transactions t
       WHERE t.user_id=$1 AND ${dateFilter}`,
      [req.user.id, year, month]
    );

    const breakdown = await query(
      `SELECT c.name, c.icon, c.color, SUM(t.amount) AS total, COUNT(*)::int AS count
       FROM transactions t
       JOIN categories c ON c.id = t.category_id
       WHERE t.user_id=$1 AND t.type='expense' AND ${dateFilter}
       GROUP BY c.id, c.name, c.icon, c.color
       ORDER BY total DESC
       LIMIT 6`,
      [req.user.id, year, month]
    );

    return success(res, { summary: summary.rows[0], breakdown: breakdown.rows });
  } catch (err) {
    return next(err);
  }
};

const getCashFlow = async (req, res, next) => {
  try {
    const months = Math.min(Math.max(parseInt(req.query.months, 10) || 6, 1), 24);
    const result = await query(
      `SELECT
         TO_CHAR(date_trunc('month', date), 'Mon') AS month,
         date_trunc('month', date) AS month_date,
         COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END), 0) AS income,
         COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) AS expense
       FROM transactions
       WHERE user_id = $1 AND date >= NOW() - ($2 || ' months')::interval
       GROUP BY date_trunc('month', date)
       ORDER BY month_date ASC`,
      [req.user.id, months]
    );
    return success(res, result.rows);
  } catch (err) {
    return next(err);
  }
};

const getSpendingByDay = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT EXTRACT(DOW FROM date)::int AS dow, SUM(amount) AS total
       FROM transactions
       WHERE user_id=$1 AND type='expense' AND date >= NOW() - INTERVAL '30 days'
       GROUP BY dow
       ORDER BY dow`,
      [req.user.id]
    );
    return success(res, result.rows);
  } catch (err) {
    return next(err);
  }
};

// rfc 4180 csv field escape
const csvEscape = (val) => {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
};

const exportCsv = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT t.date, t.type, t.amount,
              c.name AS category_name, w.name AS wallet_name,
              t.description, t.merchant_name
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN wallets w    ON w.id = t.wallet_id
       WHERE t.user_id = $1
       ORDER BY t.date DESC`,
      [req.user.id]
    );

    const headers = ['Date', 'Type', 'Amount', 'Category', 'Wallet', 'Description', 'Merchant'];
    const lines = [headers.join(',')];
    for (const row of result.rows) {
      const date = row.date ? new Date(row.date).toISOString().split('T')[0] : '';
      lines.push([
        csvEscape(date),
        csvEscape(row.type),
        csvEscape(row.amount),
        csvEscape(row.category_name),
        csvEscape(row.wallet_name),
        csvEscape(row.description),
        csvEscape(row.merchant_name),
      ].join(','));
    }

    res.header('Content-Type', 'text/csv');
    res.attachment('transactions.csv');
    return res.send(lines.join('\n'));
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  getTransactions,
  getTransaction,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  getSummary,
  getCashFlow,
  getSpendingByDay,
  exportCsv,
};
