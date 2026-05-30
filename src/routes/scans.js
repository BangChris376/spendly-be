const express = require('express');
const { body, param } = require('express-validator');
const ctrl = require('../controllers/scanController');
const { authenticate } = require('../middlewares/auth');
const validate = require('../middlewares/validate');
const upload = require('../middlewares/upload');

const router = express.Router();
router.use(authenticate);

router.get('/', ctrl.getScans);
router.post('/upload', upload.single('receipt'), ctrl.uploadReceipt);
router.get('/:id', [param('id').isUUID()], validate, ctrl.getScanResult);

router.post(
  '/:id/confirm',
  [
    param('id').isUUID(),
    body('total_amount').optional().isFloat({ min: 1 }),
    body('wallet_id').optional().isUUID(),
    body('category_id').optional().isUUID(),
    body('date').optional().isISO8601(),
  ],
  validate,
  ctrl.confirmScan
);

router.delete('/:id', [param('id').isUUID()], validate, ctrl.deleteScan);

module.exports = router;
