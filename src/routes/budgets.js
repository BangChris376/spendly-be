const express = require('express');
const { body, param } = require('express-validator');
const ctrl = require('../controllers/budgetController');
const { authenticate } = require('../middlewares/auth');
const validate = require('../middlewares/validate');

const router = express.Router();
router.use(authenticate);

router.get('/', ctrl.getBudgets);
router.get('/summary', ctrl.getBudgetSummary);
router.get('/:id', [param('id').isUUID()], validate, ctrl.getBudget);

router.post(
  '/',
  [
    body('name').trim().notEmpty(),
    body('amount').isFloat({ min: 1 }),
    body('start_date').isISO8601(),
    body('period').optional().isIn(['weekly', 'monthly', 'yearly']),
    body('category_id').optional().isUUID(),
    body('end_date').optional().isISO8601(),
  ],
  validate,
  ctrl.createBudget
);

router.put(
  '/:id',
  [
    param('id').isUUID(),
    body('amount').optional().isFloat({ min: 1 }),
    body('period').optional().isIn(['weekly', 'monthly', 'yearly']),
  ],
  validate,
  ctrl.updateBudget
);

router.delete('/:id', [param('id').isUUID()], validate, ctrl.deleteBudget);

module.exports = router;
