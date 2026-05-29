const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const ctrl = require('../controllers/transactionController');
const { authenticate } = require('../middlewares/auth');
const { validate } = require('../middlewares/errorHandler');

router.use(authenticate);

router.get('/', ctrl.getTransactions);
router.get('/summary', ctrl.getSummary);
router.get('/cash-flow', ctrl.getCashFlow);
router.get('/spending-by-day', ctrl.getSpendingByDay);
router.get('/export-csv', ctrl.exportCsv);
router.get('/:id', ctrl.getTransaction);

router.post('/', [
  body('type').isIn(['income', 'expense', 'transfer']),
  body('amount').isFloat({ min: 1 }),
  body('date').optional().isISO8601(),
], validate, ctrl.createTransaction);

router.put('/:id', [
  body('amount').optional().isFloat({ min: 1 }),
  body('date').optional().isISO8601(),
], validate, ctrl.updateTransaction);

router.delete('/:id', ctrl.deleteTransaction);

module.exports = router;
