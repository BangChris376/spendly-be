const { query } = require('../config/database');
const { success } = require('../utils/response');

const getCategories = async (req, res, next) => {
  try {
    const { type } = req.query;
    const conditions = ['(c.user_id = $1 OR c.is_system = true)'];
    const values = [req.user.id];

    if (type) {
      conditions.push(`(type = $2 OR type = 'both')`);
      values.push(type);
    }

    const result = await query(
      `SELECT c.*,
         COUNT(t.id) AS transaction_count,
         COALESCE(SUM(t.amount), 0) AS total_amount
       FROM categories c
       LEFT JOIN transactions t ON t.category_id = c.id AND t.user_id = $1
       WHERE ${conditions.join(' AND ')}
       GROUP BY c.id
       ORDER BY c.is_system DESC, c.name ASC`,
      values
    );

    return success(res, result.rows);
  } catch (err) {
    next(err);
  }
};

const getCategory = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT c.*,
         COUNT(t.id) AS transaction_count,
         COALESCE(SUM(t.amount), 0) AS total_amount
       FROM categories c
       LEFT JOIN transactions t ON t.category_id = c.id AND t.user_id = $1
       WHERE c.id = $2 AND (c.user_id = $1 OR c.is_system = true)
       GROUP BY c.id`,
      [req.user.id, req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    return success(res, result.rows[0]);
  } catch (err) {
    next(err);
  }
};

const createCategory = async (req, res, next) => {
  try {
    const { name, icon, color, type } = req.body;

    const exists = await query(
      'SELECT id FROM categories WHERE user_id = $1 AND LOWER(name) = LOWER($2)',
      [req.user.id, name]
    );
    if (exists.rows.length) {
      return res.status(409).json({ success: false, message: 'Category name already exists' });
    }

    const result = await query(
      `INSERT INTO categories (user_id, name, icon, color, type)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.id, name, icon || '📦', color || '#6B7280', type]
    );

    return success(res, result.rows[0], 'Category created', 201);
  } catch (err) {
    next(err);
  }
};

const updateCategory = async (req, res, next) => {
  try {
    const existing = await query(
      'SELECT * FROM categories WHERE id = $1 AND user_id = $2 AND is_system = false',
      [req.params.id, req.user.id]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ success: false, message: 'Category not found or cannot be edited' });
    }

    const { name, icon, color } = req.body;
    const result = await query(
      `UPDATE categories
       SET name = COALESCE($1, name),
           icon = COALESCE($2, icon),
           color = COALESCE($3, color)
       WHERE id = $4 RETURNING *`,
      [name, icon, color, req.params.id]
    );

    return success(res, result.rows[0], 'Category updated');
  } catch (err) {
    next(err);
  }
};

const deleteCategory = async (req, res, next) => {
  try {
    const existing = await query(
      'SELECT * FROM categories WHERE id = $1 AND user_id = $2 AND is_system = false',
      [req.params.id, req.user.id]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ success: false, message: 'Category not found or cannot be deleted' });
    }

    // Nullify transactions referencing this category
    await query('UPDATE transactions SET category_id = NULL WHERE category_id = $1', [req.params.id]);
    await query('DELETE FROM categories WHERE id = $1', [req.params.id]);

    return success(res, null, 'Category deleted');
  } catch (err) {
    next(err);
  }
};

const getCategoryStats = async (req, res, next) => {
  try {
    const { month, year } = req.query;
    const now = new Date();
    const m = parseInt(month) || now.getMonth() + 1;
    const y = parseInt(year) || now.getFullYear();

    const result = await query(
      `SELECT
         c.id, c.name, c.icon, c.color,
         COUNT(t.id)::int AS transaction_count,
         COALESCE(SUM(t.amount), 0) AS total_amount,
         ROUND(
           COALESCE(SUM(t.amount), 0) /
           NULLIF((SELECT SUM(amount) FROM transactions WHERE user_id = $1 AND type = 'expense'
                   AND EXTRACT(MONTH FROM date) = $2 AND EXTRACT(YEAR FROM date) = $3), 0) * 100, 2
         ) AS percentage
       FROM categories c
       LEFT JOIN transactions t
         ON t.category_id = c.id
         AND t.user_id = $1
         AND t.type = 'expense'
         AND EXTRACT(MONTH FROM t.date) = $2
         AND EXTRACT(YEAR FROM t.date) = $3
       WHERE c.user_id = $1 OR c.is_system = true
       GROUP BY c.id
       ORDER BY total_amount DESC`,
      [req.user.id, m, y]
    );

    return success(res, result.rows);
  } catch (err) {
    next(err);
  }
};

module.exports = { getCategories, getCategory, createCategory, updateCategory, deleteCategory, getCategoryStats };
