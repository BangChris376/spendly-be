const { query } = require('../config/database');
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
    return success(res, result.rows);
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

    const { name, account_number, bank_name, color, is_default } = req.body;

    if (is_default) {
      await query(`UPDATE wallets SET is_default = false WHERE user_id = $1`, [req.user.id]);
    }

    const result = await query(
      `UPDATE wallets SET
         name           = COALESCE($1, name),
         account_number = COALESCE($2, account_number),
         bank_name      = COALESCE($3, bank_name),
         color          = COALESCE($4, color),
         is_default     = COALESCE($5, is_default)
       WHERE id = $6 RETURNING *`,
      [name, account_number, bank_name, color, is_default, req.params.id]
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

module.exports = {
  getWallets,
  getWallet,
  createWallet,
  updateWallet,
  deleteWallet,
  getTotalBalance,
};
