const express = require('express');
const { body, param } = require('express-validator');
const ctrl = require('../controllers/walletController');
const { authenticate } = require('../middlewares/auth');
const validate = require('../middlewares/validate');

const router = express.Router();
router.use(authenticate);

router.get('/', ctrl.getWallets);
router.get('/balance', ctrl.getTotalBalance);
router.get('/:id', [param('id').isUUID()], validate, ctrl.getWallet);

router.post(
  '/',
  [
    body('name').trim().notEmpty(),
    body('type').isIn(['bank', 'credit_card', 'e_wallet', 'cash']),
    body('balance').optional().isFloat({ min: 0 }),
  ],
  validate,
  ctrl.createWallet
);

router.put(
  '/:id',
  [
    param('id').isUUID(),
    body('name').optional().trim().notEmpty(),
    body('is_default').optional().isBoolean(),
  ],
  validate,
  ctrl.updateWallet
);

router.delete('/:id', [param('id').isUUID()], validate, ctrl.deleteWallet);

module.exports = router;
