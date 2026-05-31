const { query } = require('../config/database');
const { success } = require('../utils/response');

const pctChange = (current, previous) =>
  previous > 0 ? Math.round(((current - previous) / previous) * 100) : 0;

const getDashboardSummary = async (req, res, next) => {
  try {
    const userId = req.user.id;
    // const filterQuery = req.query; // If needed in the future

    const now = new Date();
    const m = now.getMonth() + 1;
    const y = now.getFullYear();
    const prevM = m === 1 ? 12 : m - 1;
    const prevY = m === 1 ? y - 1 : y;

    const [summaryRes, prevRes, walletRes, recentRes, budgetRes, growthRes, categoryRes] = await Promise.all([
      query(
        `SELECT
           COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END), 0) AS income,
           COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) AS expense,
           COUNT(*)::int AS tx_count
         FROM transactions
         WHERE user_id=$1 AND EXTRACT(MONTH FROM date)=$2 AND EXTRACT(YEAR FROM date)=$3`,
        [userId, m, y]
      ),
      query(
        `SELECT
           COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END), 0) AS income,
           COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) AS expense
         FROM transactions
         WHERE user_id=$1 AND EXTRACT(MONTH FROM date)=$2 AND EXTRACT(YEAR FROM date)=$3`,
        [userId, prevM, prevY]
      ),
      query(`SELECT COALESCE(SUM(balance), 0) AS total_balance FROM wallets WHERE user_id=$1`, [userId]),
      query(
        `SELECT t.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
                w.name AS wallet_name, w.type AS wallet_type
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         LEFT JOIN wallets w    ON w.id = t.wallet_id
         WHERE t.user_id = $1
         ORDER BY t.date DESC, t.created_at DESC
         LIMIT 5`,
        [userId]
      ),
      query(
        `SELECT b.id, b.name, b.amount,
                COALESCE(SUM(t.amount), 0) AS spent,
                ROUND(COALESCE(SUM(t.amount), 0) / NULLIF(b.amount, 0) * 100, 0) AS percentage
         FROM budgets b
         LEFT JOIN transactions t
           ON t.category_id = b.category_id
          AND t.user_id     = b.user_id
          AND t.type        = 'expense'
          AND t.date        >= b.start_date
          AND (b.end_date IS NULL OR t.date <= b.end_date)
         WHERE b.user_id = $1
         GROUP BY b.id, b.name, b.amount
         ORDER BY percentage DESC
         LIMIT 5`,
        [userId]
      ),
      query(
        `SELECT
           TO_CHAR(date_trunc('month', date), 'Mon') AS month,
           date_trunc('month', date) AS period,
           SUM(CASE WHEN type='income' THEN amount ELSE -amount END) AS net
         FROM transactions
         WHERE user_id = $1 AND date >= NOW() - INTERVAL '7 months'
         GROUP BY date_trunc('month', date)
         ORDER BY period ASC`,
        [userId]
      ),
      query(
        `SELECT id, name, icon, color, type, is_system
         FROM categories
         WHERE user_id = $1 OR is_system = true
         ORDER BY is_system DESC, name ASC`,
        [userId]
      ),
    ]);

    const cur = summaryRes.rows[0];
    const prev = prevRes.rows[0];

    const dashboard = {
      balance: {
        total: walletRes.rows[0].total_balance,
        income: cur.income,
        expense: cur.expense,
        income_change_pct: pctChange(cur.income, prev.income),
        expense_change_pct: pctChange(cur.expense, prev.expense),
        transaction_count: cur.tx_count,
      },
      recent_transactions: recentRes.rows,
      budgets: budgetRes.rows,
      wealth_growth: growthRes.rows,
      categories: categoryRes.rows,
    };

    return success(res, dashboard);
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  getDashboardSummary,
};
