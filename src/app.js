require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const { errorHandler, notFound } = require('./middlewares/errorHandler');
const authRoutes = require('./routes/auth');
const txnRoutes = require('./routes/transactions');
const {
  categoriesRouter,
  walletsRouter,
  budgetsRouter,
  scansRouter,
  analysisRouter,
} = require('./routes/index');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Security & Logging ──────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin: (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(','),
  credentials: true,
}));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ── Body Parsing ────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Static Files (uploaded receipts) ───────────────────────────
app.use('/uploads', express.static(path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads')));

// ── Health Check ────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    service: 'Spendly API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// ── API Routes ──────────────────────────────────────────────────
const API = '/api/v1';
app.use(`${API}/auth`,         authRoutes);
app.use(`${API}/transactions`, txnRoutes);
app.use(`${API}/categories`,   categoriesRouter);
app.use(`${API}/wallets`,      walletsRouter);
app.use(`${API}/budgets`,      budgetsRouter);
app.use(`${API}/scans`,        scansRouter);
app.use(`${API}/analysis`,     analysisRouter);

// ── 404 & Error Handler ─────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── Start Server ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║        🧾 Spendly API Server             ║
║  Port   : ${PORT}                          ║
║  Env    : ${(process.env.NODE_ENV || 'development').padEnd(12)}                ║
║  Base   : http://localhost:${PORT}/api/v1  ║
╚══════════════════════════════════════════╝
  `);
});

module.exports = app;
