const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/database');
const env = require('../config/env');

const generateTokens = (userId) => {
  const accessToken = jwt.sign({ userId }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
  const refreshToken = uuidv4();
  return { accessToken, refreshToken };
};

const persistRefreshToken = async (userId, token) => {
  const expiresAt = new Date(Date.now() + env.refreshExpiresInDays * 24 * 60 * 60 * 1000);
  await query(
    `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
    [userId, token, expiresAt]
  );
};

const consumeRefreshToken = async (token) => {
  const result = await query(
    `SELECT user_id FROM refresh_tokens WHERE token = $1 AND expires_at > NOW()`,
    [token]
  );
  if (!result.rows.length) return null;
  await query(`DELETE FROM refresh_tokens WHERE token = $1`, [token]);
  return result.rows[0].user_id;
};

const revokeRefreshToken = async (token) => {
  if (!token) return;
  await query(`DELETE FROM refresh_tokens WHERE token = $1`, [token]);
};

const revokeAllForUser = async (userId) => {
  await query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [userId]);
};

module.exports = {
  generateTokens,
  persistRefreshToken,
  consumeRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
};
