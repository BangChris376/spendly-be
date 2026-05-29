const { query } = require('../config/database');
const { success } = require('../utils/response');

const getBudgets = async (req, res, next) => {
  try {
    const now = new Date();
    const result = await query(
      `SELECT
         b.*,
         c.name AS category_name,
         c.icon AS category_icon,
         c.color AS category_color,
         COALESCE(SUM(t.amount), 0) AS spent,
         ROUND(COALESCE(SUM(t.amount), 0) / b.amount * 100, 2) AS percentage_used
       FROM budgets b
       LEFT JOIN categories c ON c.id = b.category_id
       LEFT JOIN transactions t
         ON t.category_id = b.category_id
         AND t.user_id = b.user_id
         AND t.type = 'expense'
         AND t.date >= b.start_date
         AND (b.end_date IS NULL OR t.date <= b.end_date)
       WHERE b.user_id = $1
       GROUP BY b.id, c.name, c.icon, c.color
       ORDER BY b.created_at DESC`,
      [req.user.id]
    );

    const budgets = result.rows.map(b => ({
      ...b,
      remaining: Math.max(0, b.amount - b.spent),
      is_exceeded: parseFloat(b.spent) > parseFloat(b.amount),
      status: parseFloat(b.spent) / parseFloat(b.amount) >= 1 ? 'exceeded'
            : parseFloat(b.spent) / parseFloat(b.amount) >= 0.8 ? 'warning'
            : 'healthy',
    }));

    return success(res, budgets);
  } catch (err) {
    next(err);
  }
};

const getBudget = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT b.*, c.name AS category_name, c.icon AS category_icon
       FROM budgets b
       LEFT JOIN categories c ON c.id = b.category_id
       WHERE b.id = $1 AND b.user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Budget not found' });
    }
    return success(res, result.rows[0]);
  } catch (err) {
    next(err);
  }
};

const createBudget = async (req, res, next) => {
  try {
    const { category_id, name, amount, period, start_date, end_date } = req.body;

    // Check category belongs to user or is system
    if (category_id) {
      const cat = await query(
        'SELECT id FROM categories WHERE id = $1 AND (user_id = $2 OR is_system = true)',
        [category_id, req.user.id]
      );
      if (!cat.rows.length) {
        return res.status(400).json({ success: false, message: 'Category not found' });
      }
    }

    const result = await query(
      `INSERT INTO budgets (user_id, category_id, name, amount, period, start_date, end_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.id, category_id || null, name, amount, period || 'monthly', start_date, end_date || null]
    );

    return success(res, result.rows[0], 'Budget created', 201);
  } catch (err) {
    next(err);
  }
};

const updateBudget = async (req, res, next) => {
  try {
    const existing = await query(
      'SELECT id FROM budgets WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ success: false, message: 'Budget not found' });
    }

    const { name, amount, period, start_date, end_date } = req.body;
    const result = await query(
      `UPDATE budgets
       SET name = COALESCE($1, name),
           amount = COALESCE($2, amount),
           period = COALESCE($3, period),
           start_date = COALESCE($4, start_date),
           end_date = COALESCE($5, end_date)
       WHERE id = $6 RETURNING *`,
      [name, amount, period, start_date, end_date, req.params.id]
    );

    return success(res, result.rows[0], 'Budget updated');
  } catch (err) {
    next(err);
  }
};

const deleteBudget = async (req, res, next) => {
  try {
    const result = await query(
      'DELETE FROM budgets WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Budget not found' });
    }
    return success(res, null, 'Budget deleted');
  } catch (err) {
    next(err);
  }
};

const getBudgetSummary = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT
         COUNT(*)::int AS total_budgets,
         COUNT(CASE WHEN (COALESCE(spent,0) / NULLIF(b.amount,0)) >= 1 THEN 1 END)::int AS exceeded,
         COUNT(CASE WHEN (COALESCE(spent,0) / NULLIF(b.amount,0)) >= 0.8
                     AND (COALESCE(spent,0) / NULLIF(b.amount,0)) < 1 THEN 1 END)::int AS warning,
         COALESCE(SUM(b.amount), 0) AS total_budget_amount,
         COALESCE(SUM(spent), 0) AS total_spent
       FROM budgets b
       LEFT JOIN LATERAL (
         SELECT SUM(t.amount) AS spent
         FROM transactions t
         WHERE t.category_id = b.category_id
           AND t.user_id = b.user_id
           AND t.type = 'expense'
           AND t.date >= b.start_date
           AND (b.end_date IS NULL OR t.date <= b.end_date)
       ) s ON true
       WHERE b.user_id = $1`,
      [req.user.id]
    );
    return success(res, result.rows[0]);
  } catch (err) {
    next(err);
  }
};

module.exports = { getBudgets, getBudget, createBudget, updateBudget, deleteBudget, getBudgetSummary };
