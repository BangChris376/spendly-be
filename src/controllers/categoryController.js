const { query } = require('../config/database');
const { success, failure } = require('../utils/response');

const getCategories = async (req, res, next) => {
  try {
    const { type } = req.query;
    const conditions = ['(c.user_id = $1 OR c.is_system = true)'];
    const values = [req.user.id];
    let idx = 2;

    if (type) {
      conditions.push(`(c.type = $${idx++} OR c.type = 'both')`);
      values.push(type);
    }

    const result = await query(
      `SELECT c.*,
              COUNT(t.id)::int AS transaction_count,
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
    return next(err);
  }
};

const getCategory = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT c.*,
              COUNT(t.id)::int AS transaction_count,
              COALESCE(SUM(t.amount), 0) AS total_amount
       FROM categories c
       LEFT JOIN transactions t ON t.category_id = c.id AND t.user_id = $1
       WHERE c.id = $2 AND (c.user_id = $1 OR c.is_system = true)
       GROUP BY c.id`,
      [req.user.id, req.params.id]
    );
    if (!result.rows.length) return failure(res, 'Category not found', 404);
    return success(res, result.rows[0]);
  } catch (err) {
    return next(err);
  }
};

const createCategory = async (req, res, next) => {
  try {
    const { name, icon, color, type } = req.body;

    const exists = await query(
      `SELECT id FROM categories WHERE user_id = $1 AND LOWER(name) = LOWER($2)`,
      [req.user.id, name]
    );
    if (exists.rows.length) return failure(res, 'Category name already exists', 409);

    const result = await query(
      `INSERT INTO categories (user_id, name, icon, color, type)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.id, name, icon || null, color || '#6B7280', type]
    );
    return success(res, result.rows[0], 'Category created', 201);
  } catch (err) {
    return next(err);
  }
};

const updateCategory = async (req, res, next) => {
  try {
    const existing = await query(
      `SELECT id FROM categories
       WHERE id = $1 AND user_id = $2 AND is_system = false`,
      [req.params.id, req.user.id]
    );
    if (!existing.rows.length) return failure(res, 'Category not found or cannot be edited', 404);

    const { name, icon, color } = req.body;
    const result = await query(
      `UPDATE categories SET
         name  = COALESCE($1, name),
         icon  = COALESCE($2, icon),
         color = COALESCE($3, color)
       WHERE id = $4 RETURNING *`,
      [name, icon, color, req.params.id]
    );
    return success(res, result.rows[0], 'Category updated');
  } catch (err) {
    return next(err);
  }
};

const deleteCategory = async (req, res, next) => {
  try {
    const existing = await query(
      `SELECT id FROM categories
       WHERE id = $1 AND user_id = $2 AND is_system = false`,
      [req.params.id, req.user.id]
    );
    if (!existing.rows.length) return failure(res, 'Category not found or cannot be deleted', 404);

    await query(`UPDATE transactions SET category_id = NULL WHERE category_id = $1`, [req.params.id]);
    await query(`DELETE FROM categories WHERE id = $1`, [req.params.id]);

    return success(res, null, 'Category deleted');
  } catch (err) {
    return next(err);
  }
};

const getCategoryStats = async (req, res, next) => {
  try {
    const now = new Date();
    const month = parseInt(req.query.month, 10) || now.getMonth() + 1;
    const year = parseInt(req.query.year, 10) || now.getFullYear();

    const result = await query(
      `WITH total AS (
         SELECT COALESCE(SUM(amount), 0) AS sum_total
         FROM transactions
         WHERE user_id = $1 AND type = 'expense'
           AND EXTRACT(MONTH FROM date) = $2
           AND EXTRACT(YEAR FROM date) = $3
       )
       SELECT c.id, c.name, c.icon, c.color,
              COUNT(t.id)::int AS transaction_count,
              COALESCE(SUM(t.amount), 0) AS total_amount,
              ROUND(COALESCE(SUM(t.amount), 0) / NULLIF((SELECT sum_total FROM total), 0) * 100, 2) AS percentage
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
      [req.user.id, month, year]
    );
    return success(res, result.rows);
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  getCategories,
  getCategory,
  createCategory,
  updateCategory,
  deleteCategory,
  getCategoryStats,
};
