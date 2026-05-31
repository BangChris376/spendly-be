const express = require('express');

const authRoutes = require('./auth');
const transactionRoutes = require('./transactions');
const categoryRoutes = require('./categories');
const walletRoutes = require('./wallets');
const budgetRoutes = require('./budgets');
const scanRoutes = require('./scans');
const analysisRoutes = require('./analysis');
const dashboardRoutes = require('./dashboard');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/transactions', transactionRoutes);
router.use('/categories', categoryRoutes);
router.use('/wallets', walletRoutes);
router.use('/budgets', budgetRoutes);
router.use('/scans', scanRoutes);
router.use('/analysis', analysisRoutes);
router.use('/dashboard', dashboardRoutes);

module.exports = router;
