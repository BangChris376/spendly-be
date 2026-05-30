const express = require('express');
const { body, param } = require('express-validator');
const ctrl = require('../controllers/transactionController');
const { authenticate } = require('../middlewares/auth');
const validate = require('../middlewares/validate');

const router = express.Router();
router.use(authenticate);

router.get('/', ctrl.getTransactions);
router.get('/summary', ctrl.getSummary);
router.get('/cash-flow', ctrl.getCashFlow);
router.get('/spending-by-day', ctrl.getSpendingByDay);
router.get('/export-csv', ctrl.exportCsv);

router.get('/:id', [param('id').isUUID()], validate, ctrl.getTransaction);

router.post(
  '/',
  [
    body('type').isIn(['income', 'expense', 'transfer']),
    body('amount').isFloat({ min: 1 }),
    body('date').optional().isISO8601(),
    body('wallet_id').optional().isUUID(),
    body('to_wallet_id').optional().isUUID(),
    body('category_id').optional().isUUID(),
  ],
  validate,
  ctrl.createTransaction
);

router.put(
  '/:id',
  [
    param('id').isUUID(),
    body('amount').optional().isFloat({ min: 1 }),
    body('date').optional().isISO8601(),
    body('wallet_id').optional().isUUID(),
    body('category_id').optional().isUUID(),
  ],
  validate,
  ctrl.updateTransaction
);

router.delete('/:id', [param('id').isUUID()], validate, ctrl.deleteTransaction);

module.exports = router;
