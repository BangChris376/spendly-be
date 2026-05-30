const { query, getClient } = require('../config/database');
const { success, failure } = require('../utils/response');

const getWallets = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT w.*,
              COUNT(t.id)::int AS transaction_count,
              COALESCE(SUM(CASE WHEN t.type='income'  THEN t.amount ELSE 0 END), 0) AS total_income,
              COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount ELSE 0 END), 0) AS total_expense
       FROM wallets w
       LEFT JOIN transactions t ON t.wallet_id = w.id
       WHERE w.user_id = $1
       GROUP BY w.id
       ORDER BY w.is_default DESC, w.created_at ASC`,
      [req.user.id]
    );

    const wallets = result.rows;

    // fetch recent activity across ALL wallets (20 most recent), attach wallet_name for display
    const recentRes = await query(
      `SELECT t.*,
              c.name  AS category_name,
              c.icon  AS category_icon,
              c.color AS category_color,
              w.name  AS wallet_name,
              w.type  AS wallet_type,
              tw.name AS to_wallet_name
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN wallets w    ON w.id = t.wallet_id
       LEFT JOIN wallets tw   ON tw.id = t.to_wallet_id
       WHERE t.user_id = $1
       ORDER BY t.date DESC, t.created_at DESC
       LIMIT 20`,
      [req.user.id]
    );

    // also group per-wallet for individual wallet cards (5 each)
    const byWallet = {};
    for (const tx of recentRes.rows) {
      if (tx.wallet_id && !byWallet[tx.wallet_id]) byWallet[tx.wallet_id] = [];
      if (tx.wallet_id && byWallet[tx.wallet_id].length < 5) byWallet[tx.wallet_id].push(tx);
    }
    for (const w of wallets) w.recent_activity = byWallet[w.id] || [];

    return success(res, {
      wallets,
      recent_activity: recentRes.rows,
    });
  } catch (err) {
    return next(err);
  }
};

const getWallet = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT * FROM wallets WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return failure(res, 'Wallet not found', 404);
    const wallet = result.rows[0];

    const recent = await query(
      `SELECT t.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.wallet_id = $1 AND t.user_id = $2
       ORDER BY t.date DESC, t.created_at DESC
       LIMIT 5`,
      [req.params.id, req.user.id]
    );
    wallet.recent_activity = recent.rows;

    return success(res, wallet);
  } catch (err) {
    return next(err);
  }
};

const createWallet = async (req, res, next) => {
  try {
    const { name, type, account_number, bank_name, balance, color } = req.body;
    const result = await query(
      `INSERT INTO wallets (user_id, name, type, account_number, bank_name, balance, color)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.user.id, name, type, account_number, bank_name, balance || 0, color || '#1B4D35']
    );
    return success(res, result.rows[0], 'Wallet created', 201);
  } catch (err) {
    return next(err);
  }
};

const updateWallet = async (req, res, next) => {
  try {
    const existing = await query(
      `SELECT id FROM wallets WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!existing.rows.length) return failure(res, 'Wallet not found', 404);

    // balance is accepted here so the FE edit form can update it directly
    const { name, account_number, bank_name, color, is_default, balance } = req.body;

    if (is_default) {
      await query(`UPDATE wallets SET is_default = false WHERE user_id = $1`, [req.user.id]);
    }

    const result = await query(
      `UPDATE wallets SET
         name           = COALESCE($1, name),
         account_number = COALESCE($2, account_number),
         bank_name      = COALESCE($3, bank_name),
         color          = COALESCE($4, color),
         is_default     = COALESCE($5, is_default),
         balance        = COALESCE($6, balance)
       WHERE id = $7 RETURNING *`,
      [name, account_number, bank_name, color, is_default, balance, req.params.id]
    );
    return success(res, result.rows[0], 'Wallet updated');
  } catch (err) {
    return next(err);
  }
};

const deleteWallet = async (req, res, next) => {
  try {
    const existing = await query(
      `SELECT * FROM wallets WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!existing.rows.length) return failure(res, 'Wallet not found', 404);
    if (existing.rows[0].is_default) return failure(res, 'Cannot delete default wallet', 400);

    await query(`UPDATE transactions SET wallet_id = NULL WHERE wallet_id = $1`, [req.params.id]);
    await query(`DELETE FROM wallets WHERE id = $1`, [req.params.id]);

    return success(res, null, 'Wallet deleted');
  } catch (err) {
    return next(err);
  }
};

const getTotalBalance = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT
         COALESCE(SUM(w.balance), 0) AS total_balance,
         COUNT(w.*)::int AS wallet_count,
         COALESCE((
           SELECT SUM(amount) FROM transactions
           WHERE user_id = $1 AND type = 'income'
         ), 0) AS total_income,
         COALESCE((
           SELECT SUM(amount) FROM transactions
           WHERE user_id = $1 AND type = 'expense'
         ), 0) AS total_expense
       FROM wallets w
       WHERE w.user_id = $1`,
      [req.user.id]
    );
    return success(res, result.rows[0]);
  } catch (err) {
    return next(err);
  }
};

const transferBetweenWallets = async (req, res, next) => {
  const client = await getClient();
  try {
    const { from_wallet_id, to_wallet_id, amount, notes, date } = req.body;

    if (from_wallet_id === to_wallet_id) {
      return failure(res, 'Source and destination wallet must be different', 400);
    }

    // verify both wallets belong to user
    const wallets = await client.query(
      `SELECT id, name, balance FROM wallets WHERE id = ANY($1::uuid[]) AND user_id = $2`,
      [[from_wallet_id, to_wallet_id], req.user.id]
    );
    if (wallets.rows.length < 2) {
      return failure(res, 'One or both wallets not found', 404);
    }

    const fromWallet = wallets.rows.find((w) => w.id === from_wallet_id);
    if (parseFloat(fromWallet.balance) < parseFloat(amount)) {
      return failure(res, 'Insufficient balance in source wallet', 400);
    }

    await client.query('BEGIN');

    const inserted = await client.query(
      `INSERT INTO transactions
         (user_id, wallet_id, to_wallet_id, type, amount, merchant_name, notes, date)
       VALUES ($1, $2, $3, 'transfer', $4, $5, $6, $7)
       RETURNING *`,
      [
        req.user.id,
        from_wallet_id,
        to_wallet_id,
        amount,
        `Transfer to ${wallets.rows.find((w) => w.id === to_wallet_id)?.name || 'wallet'}`,
        notes || null,
        date || new Date(),
      ]
    );

    await client.query(`UPDATE wallets SET balance = balance - $1 WHERE id = $2`, [amount, from_wallet_id]);
    await client.query(`UPDATE wallets SET balance = balance + $1 WHERE id = $2`, [amount, to_wallet_id]);

    await client.query('COMMIT');

    // return transaction with wallet names attached
    const txRes = await query(
      `SELECT t.*,
              w.name  AS wallet_name,
              tw.name AS to_wallet_name
       FROM transactions t
       LEFT JOIN wallets w  ON w.id  = t.wallet_id
       LEFT JOIN wallets tw ON tw.id = t.to_wallet_id
       WHERE t.id = $1`,
      [inserted.rows[0].id]
    );

    return success(res, txRes.rows[0], 'Transfer successful', 201);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return next(err);
  } finally {
    client.release();
  }
};

module.exports = {
  getWallets,
  getWallet,
  createWallet,
  updateWallet,
  deleteWallet,
  getTotalBalance,
  transferBetweenWallets,
};
