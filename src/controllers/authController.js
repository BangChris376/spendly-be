const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { query, getClient } = require('../config/database');
const { success, failure } = require('../utils/response');
const tokenService = require('../services/tokenService');

const register = async (req, res, next) => {
  const client = await getClient();
  try {
    const { email, password, first_name, last_name } = req.body;
    const normalizedEmail = email.toLowerCase();

    const exists = await client.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (exists.rows.length) return failure(res, 'Email already registered', 409);

    await client.query('BEGIN');

    const hash = await bcrypt.hash(password, 12);
    const userRes = await client.query(
      `INSERT INTO users (email, password_hash, first_name, last_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, first_name, last_name, is_premium, created_at`,
      [normalizedEmail, hash, first_name, last_name]
    );
    const user = userRes.rows[0];

    await client.query(`INSERT INTO user_preferences (user_id) VALUES ($1)`, [user.id]);
    await client.query(
      `INSERT INTO wallets (user_id, name, type, balance, is_default)
       VALUES ($1, 'Cash', 'cash', 0, true)`,
      [user.id]
    );

    await client.query('COMMIT');

    const { accessToken, refreshToken } = tokenService.generateTokens(user.id);
    await tokenService.persistRefreshToken(user.id, refreshToken);

    return success(res, { user, accessToken, refreshToken }, 'Registration successful', 201);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return next(err);
  } finally {
    client.release();
  }
};

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const result = await query(
      `SELECT id, email, password_hash, first_name, last_name, is_premium, monthly_limit, avatar_url
       FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );
    if (!result.rows.length) return failure(res, 'Invalid credentials', 401);

    const user = result.rows[0];
    const matched = await bcrypt.compare(password, user.password_hash);
    if (!matched) return failure(res, 'Invalid credentials', 401);

    const { accessToken, refreshToken } = tokenService.generateTokens(user.id);
    await tokenService.persistRefreshToken(user.id, refreshToken);

    const { password_hash, ...safeUser } = user;
    return success(res, { user: safeUser, accessToken, refreshToken }, 'Login successful');
  } catch (err) {
    return next(err);
  }
};

const refreshToken = async (req, res, next) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) return failure(res, 'Refresh token required', 400);

    const userId = await tokenService.consumeRefreshToken(refresh_token);
    if (!userId) return failure(res, 'Invalid or expired refresh token', 401);

    const tokens = tokenService.generateTokens(userId);
    await tokenService.persistRefreshToken(userId, tokens.refreshToken);

    return success(res, { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }, 'Token refreshed');
  } catch (err) {
    return next(err);
  }
};

const logout = async (req, res, next) => {
  try {
    await tokenService.revokeRefreshToken(req.body.refresh_token);
    return success(res, null, 'Logged out successfully');
  } catch (err) {
    return next(err);
  }
};

const getMe = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.avatar_url,
              u.is_premium, u.monthly_limit, u.created_at,
              p.push_notifications, p.email_summaries, p.security_alerts,
              p.spending_alerts, p.spending_alert_pct, p.dark_mode, p.currency
       FROM users u
       LEFT JOIN user_preferences p ON p.user_id = u.id
       WHERE u.id = $1`,
      [req.user.id]
    );
    return success(res, result.rows[0]);
  } catch (err) {
    return next(err);
  }
};

const updateProfile = async (req, res, next) => {
  try {
    const { first_name, last_name, monthly_limit } = req.body;
    const avatar_url = req.file ? `/uploads/${req.file.filename}` : undefined;

    const result = await query(
      `UPDATE users SET
         first_name    = COALESCE($1, first_name),
         last_name     = COALESCE($2, last_name),
         monthly_limit = COALESCE($3, monthly_limit),
         avatar_url    = COALESCE($4, avatar_url)
       WHERE id = $5
       RETURNING id, email, first_name, last_name, is_premium, monthly_limit, avatar_url`,
      [first_name || null, last_name || null, monthly_limit || null, avatar_url || null, req.user.id]
    );
    return success(res, result.rows[0], 'Profile updated');
  } catch (err) {
    return next(err);
  }
};

// dedicated avatar upload — accepts multipart/form-data with field "avatar"
const updateAvatar = async (req, res, next) => {
  try {
    if (!req.file) return failure(res, 'Avatar file is required', 400);
    const avatar_url = `/uploads/${req.file.filename}`;
    const result = await query(
      `UPDATE users SET avatar_url = $1 WHERE id = $2
       RETURNING id, email, first_name, last_name, is_premium, monthly_limit, avatar_url`,
      [avatar_url, req.user.id]
    );
    return success(res, result.rows[0], 'Avatar updated');
  } catch (err) {
    return next(err);
  }
};

const updatePassword = async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;

    const result = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const matched = await bcrypt.compare(current_password, result.rows[0].password_hash);
    if (!matched) return failure(res, 'Current password is incorrect', 400);

    const hash = await bcrypt.hash(new_password, 12);
    await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, req.user.id]);
    await tokenService.revokeAllForUser(req.user.id);

    return success(res, null, 'Password updated. Please login again.');
  } catch (err) {
    return next(err);
  }
};

const PREF_FIELDS = [
  'push_notifications', 'email_summaries', 'security_alerts',
  'spending_alerts', 'spending_alert_pct', 'dark_mode', 'currency',
];

const updatePreferences = async (req, res, next) => {
  try {
    const sets = [];
    const values = [];
    let idx = 1;

    for (const field of PREF_FIELDS) {
      if (req.body[field] !== undefined) {
        sets.push(`${field} = $${idx++}`);
        values.push(req.body[field]);
      }
    }
    if (!sets.length) return failure(res, 'No fields to update', 400);

    values.push(req.user.id);
    const result = await query(
      `UPDATE user_preferences SET ${sets.join(', ')} WHERE user_id = $${idx} RETURNING *`,
      values
    );
    return success(res, result.rows[0], 'Preferences updated');
  } catch (err) {
    return next(err);
  }
};

const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    const result = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);

    // generic response to avoid email enumeration
    const genericMessage = 'If that email is registered, we have sent a reset link.';
    if (!result.rows.length) return success(res, null, genericMessage);

    const resetToken = uuidv4();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await query(
      `UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3`,
      [resetToken, expiresAt, result.rows[0].id]
    );

    console.log(`[email mock] reset link for ${email}: /reset-password?token=${resetToken}`);

    // only expose the token in development for easier testing
    const payload = process.env.NODE_ENV === 'development' ? { reset_token: resetToken } : null;
    return success(res, payload, genericMessage);
  } catch (err) {
    return next(err);
  }
};

const resetPassword = async (req, res, next) => {
  try {
    const { token, new_password } = req.body;
    const result = await query(
      `SELECT id FROM users WHERE reset_token = $1 AND reset_token_expires > NOW()`,
      [token]
    );
    if (!result.rows.length) return failure(res, 'Invalid or expired reset token', 400);

    const userId = result.rows[0].id;
    const hash = await bcrypt.hash(new_password, 12);
    await query(
      `UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL
       WHERE id = $2`,
      [hash, userId]
    );
    await tokenService.revokeAllForUser(userId);

    return success(res, null, 'Password has been reset successfully.');
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  register,
  login,
  refreshToken,
  logout,
  getMe,
  updateProfile,
  updateAvatar,
  updatePassword,
  updatePreferences,
  forgotPassword,
  resetPassword,
};
