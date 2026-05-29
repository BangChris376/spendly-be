// ─── categories.js ───────────────────────────────────────────────
const express = require('express');
const { body } = require('express-validator');
const { authenticate } = require('../middlewares/auth');
const { validate } = require('../middlewares/errorHandler');
const catCtrl = require('../controllers/categoryController');

const catRouter = express.Router();
catRouter.use(authenticate);

catRouter.get('/', catCtrl.getCategories);
catRouter.get('/stats', catCtrl.getCategoryStats);
catRouter.get('/:id', catCtrl.getCategory);
catRouter.post('/', [
  body('name').trim().notEmpty(),
  body('type').isIn(['expense', 'income', 'both']),
], validate, catCtrl.createCategory);
catRouter.put('/:id', catCtrl.updateCategory);
catRouter.delete('/:id', catCtrl.deleteCategory);

module.exports.categoriesRouter = catRouter;


// ─── wallets.js ───────────────────────────────────────────────────
const walletCtrl = require('../controllers/walletController');

const walletRouter = express.Router();
walletRouter.use(authenticate);

walletRouter.get('/', walletCtrl.getWallets);
walletRouter.get('/balance', walletCtrl.getTotalBalance);
walletRouter.get('/:id', walletCtrl.getWallet);
walletRouter.post('/', [
  body('name').trim().notEmpty(),
  body('type').isIn(['bank', 'credit_card', 'e_wallet', 'cash']),
], validate, walletCtrl.createWallet);
walletRouter.put('/:id', walletCtrl.updateWallet);
walletRouter.delete('/:id', walletCtrl.deleteWallet);

module.exports.walletsRouter = walletRouter;


// ─── budgets.js ───────────────────────────────────────────────────
const budgetCtrl = require('../controllers/budgetController');

const budgetRouter = express.Router();
budgetRouter.use(authenticate);

budgetRouter.get('/', budgetCtrl.getBudgets);
budgetRouter.get('/summary', budgetCtrl.getBudgetSummary);
budgetRouter.get('/:id', budgetCtrl.getBudget);
budgetRouter.post('/', [
  body('name').trim().notEmpty(),
  body('amount').isFloat({ min: 1 }),
  body('start_date').isISO8601(),
], validate, budgetCtrl.createBudget);
budgetRouter.put('/:id', budgetCtrl.updateBudget);
budgetRouter.delete('/:id', budgetCtrl.deleteBudget);

module.exports.budgetsRouter = budgetRouter;


// ─── scans.js ─────────────────────────────────────────────────────
const upload = require('../middlewares/upload');
const scanCtrl = require('../controllers/scanController');

const scanRouter = express.Router();
scanRouter.use(authenticate);

scanRouter.get('/', scanCtrl.getScans);
scanRouter.post('/upload', upload.single('receipt'), scanCtrl.uploadReceipt);
scanRouter.get('/:id', scanCtrl.getScanResult);
scanRouter.post('/:id/confirm', [
  body('total_amount').optional().isFloat({ min: 1 }),
], validate, scanCtrl.confirmScan);
scanRouter.delete('/:id', scanCtrl.deleteScan);

module.exports.scansRouter = scanRouter;


// ─── analysis.js ──────────────────────────────────────────────────
const analysisCtrl = require('../controllers/analysisController');

const analysisRouter = express.Router();
analysisRouter.use(authenticate);

analysisRouter.get('/dashboard',        analysisCtrl.getDashboardOverview);
analysisRouter.get('/insights',         analysisCtrl.getAnalysis);
analysisRouter.get('/unusual-spending', analysisCtrl.getUnusualSpending);
analysisRouter.get('/forecast',         analysisCtrl.getForecast);      // → FastAPI LSTM
analysisRouter.get('/ai-health',        analysisCtrl.getAIHealth);      // cek status AI service

module.exports.analysisRouter = analysisRouter;
