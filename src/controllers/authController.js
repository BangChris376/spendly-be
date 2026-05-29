const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/database');
const { success } = require('../utils/response');

const generateTokens = (userId) => {
  const accessToken = jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
  const refreshToken = uuidv4();
  return { accessToken, refreshToken };
};

const register = async (req, res, next) => {
  try {
    const { email, password, first_name, last_name } = req.body;

    const exists = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (exists.rows.length) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    const hash = await bcrypt.hash(password, 12);
    const userRes = await query(
      `INSERT INTO users (email, password_hash, first_name, last_name)
       VALUES ($1, $2, $3, $4) RETURNING id, email, first_name, last_name, is_premium, created_at`,
      [email.toLowerCase(), hash, first_name, last_name]
    );
    const user = userRes.rows[0];

    // Create default preferences
    await query('INSERT INTO user_preferences (user_id) VALUES ($1)', [user.id]);

    // Create default cash wallet
    await query(
      `INSERT INTO wallets (user_id, name, type, balance, is_default)
       VALUES ($1, 'Cash', 'cash', 0, true)`,
      [user.id]
    );

    const { accessToken, refreshToken } = generateTokens(user.id);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, refreshToken, expiresAt]
    );

    return success(res, { user, accessToken, refreshToken }, 'Registration successful', 201);
  } catch (err) {
    next(err);
  }
};

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const result = await query(
      'SELECT id, email, password_hash, first_name, last_name, is_premium, monthly_limit, avatar_url FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (!result.rows.length) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const { accessToken, refreshToken } = generateTokens(user.id);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, refreshToken, expiresAt]
    );

    const { password_hash, ...safeUser } = user;
    return success(res, { user: safeUser, accessToken, refreshToken }, 'Login successful');
  } catch (err) {
    next(err);
  }
};

const refreshToken = async (req, res, next) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) {
      return res.status(400).json({ success: false, message: 'Refresh token required' });
    }

    const result = await query(
      'SELECT * FROM refresh_tokens WHERE token = $1 AND expires_at > NOW()',
      [refresh_token]
    );
    if (!result.rows.length) {
      return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
    }

    const { user_id } = result.rows[0];
    await query('DELETE FROM refresh_tokens WHERE token = $1', [refresh_token]);

    const { accessToken, refreshToken: newRefresh } = generateTokens(user_id);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user_id, newRefresh, expiresAt]
    );

    return success(res, { accessToken, refreshToken: newRefresh }, 'Token refreshed');
  } catch (err) {
    next(err);
  }
};

const logout = async (req, res, next) => {
  try {
    const { refresh_token } = req.body;
    if (refresh_token) {
      await query('DELETE FROM refresh_tokens WHERE token = $1', [refresh_token]);
    }
    return success(res, null, 'Logged out successfully');
  } catch (err) {
    next(err);
  }
};

const getMe = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.avatar_url, u.is_premium, u.monthly_limit, u.created_at,
              p.push_notifications, p.email_summaries, p.security_alerts, p.spending_alerts, p.dark_mode, p.currency
       FROM users u
       LEFT JOIN user_preferences p ON p.user_id = u.id
       WHERE u.id = $1`,
      [req.user.id]
    );
    return success(res, result.rows[0]);
  } catch (err) {
    next(err);
  }
};

const updateProfile = async (req, res, next) => {
  try {
    const { first_name, last_name, monthly_limit } = req.body;
    let avatar_url = req.body.avatar_url;
    if (req.file) {
      avatar_url = `/uploads/${req.file.filename}`;
    }

    const result = await query(
      `UPDATE users SET first_name=$1, last_name=$2, monthly_limit=COALESCE($3, monthly_limit), avatar_url=COALESCE($4, avatar_url)
       WHERE id=$5 RETURNING id, email, first_name, last_name, is_premium, monthly_limit, avatar_url`,
      [first_name, last_name, monthly_limit, avatar_url, req.user.id]
    );
    return success(res, result.rows[0], 'Profile updated');
  } catch (err) {
    next(err);
  }
};

const updatePassword = async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;
    const result = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const isMatch = await bcrypt.compare(current_password, result.rows[0].password_hash);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect' });
    }
    const hash = await bcrypt.hash(new_password, 12);
    await query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, req.user.id]);
    await query('DELETE FROM refresh_tokens WHERE user_id=$1', [req.user.id]);
    return success(res, null, 'Password updated. Please login again.');
  } catch (err) {
    next(err);
  }
};

const updatePreferences = async (req, res, next) => {
  try {
    const fields = ['push_notifications','email_summaries','security_alerts','spending_alerts','dark_mode','currency'];
    const updates = [];
    const values = [];
    let idx = 1;
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        updates.push(`${f}=$${idx++}`);
        values.push(req.body[f]);
      }
    }
    if (!updates.length) return res.status(400).json({ success: false, message: 'No fields to update' });
    values.push(req.user.id);
    const result = await query(
      `UPDATE user_preferences SET ${updates.join(',')} WHERE user_id=$${idx} RETURNING *`,
      values
    );
    return success(res, result.rows[0], 'Preferences updated');
  } catch (err) {
    next(err);
  }
};

const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    const userRes = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (!userRes.rows.length) {
      return success(res, null, 'If that email is registered, we have sent a reset link.');
    }

    const resetToken = uuidv4();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await query(
      'UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3',
      [resetToken, expiresAt, userRes.rows[0].id]
    );

    console.log(`[Email Mock] Password reset link for ${email}: /reset-password?token=${resetToken}`);
    
    return success(res, { reset_token: resetToken }, 'If that email is registered, we have sent a reset link.');
  } catch (err) {
    next(err);
  }
};

const resetPassword = async (req, res, next) => {
  try {
    const { token, new_password } = req.body;
    
    const userRes = await query(
      'SELECT id FROM users WHERE reset_token = $1 AND reset_token_expires > NOW()',
      [token]
    );

    if (!userRes.rows.length) {
      return res.status(400).json({ success: false, message: 'Invalid or expired reset token' });
    }

    const hash = await bcrypt.hash(new_password, 12);
    await query(
      'UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2',
      [hash, userRes.rows[0].id]
    );
    
    await query('DELETE FROM refresh_tokens WHERE user_id = $1', [userRes.rows[0].id]);

    return success(res, null, 'Password has been reset successfully.');
  } catch (err) {
    next(err);
  }
};

module.exports = { register, login, refreshToken, logout, getMe, updateProfile, updatePassword, updatePreferences, forgotPassword, resetPassword };
