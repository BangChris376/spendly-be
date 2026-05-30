const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const env = require('../config/env');

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, env.uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const prefix = file.fieldname === 'avatar' ? 'avatar_' : 'receipt_';
    cb(null, `${prefix}${uuidv4()}${ext}`);
  },
});

const ALLOWED = new Set(['.jpg', '.jpeg', '.png', '.pdf']);

const fileFilter = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED.has(ext)) return cb(null, true);
  return cb(new Error('Only JPG, PNG, PDF files are allowed'), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: env.maxFileSize },
});

module.exports = upload;
