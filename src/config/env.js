require('dotenv').config();

const env = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
  refreshExpiresInDays: 30,
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 5 * 1024 * 1024,
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(','),
  aiBaseUrl: process.env.AI_SERVICE_URL || 'http://localhost:8000',
  aiTimeoutMs: parseInt(process.env.AI_TIMEOUT_MS, 10) || 30000,
};

if (!env.jwtSecret) {
  console.warn('warning: JWT_SECRET is not set, using insecure fallback');
}

module.exports = env;
