const express = require('express');
const { body, param } = require('express-validator');
const ctrl = require('../controllers/categoryController');
const { authenticate } = require('../middlewares/auth');
const validate = require('../middlewares/validate');

const router = express.Router();
router.use(authenticate);

router.get('/', ctrl.getCategories);
router.get('/stats', ctrl.getCategoryStats);
router.get('/:id', [param('id').isUUID()], validate, ctrl.getCategory);

router.post(
  '/',
  [
    body('name').trim().notEmpty(),
    body('type').isIn(['expense', 'income', 'both']),
    body('icon').optional().isString(),
    body('color').optional().isString(),
  ],
  validate,
  ctrl.createCategory
);

router.put(
  '/:id',
  [
    param('id').isUUID(),
    body('name').optional().trim().notEmpty(),
    body('icon').optional().isString(),
    body('color').optional().isString(),
  ],
  validate,
  ctrl.updateCategory
);

router.delete('/:id', [param('id').isUUID()], validate, ctrl.deleteCategory);

module.exports = router;
