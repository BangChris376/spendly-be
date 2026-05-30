const express = require('express');
const ctrl = require('../controllers/analysisController');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();
router.use(authenticate);

router.get('/dashboard', ctrl.getDashboardOverview);
router.get('/insights', ctrl.getAnalysis);
router.get('/unusual-spending', ctrl.getUnusualSpending);
router.get('/forecast', ctrl.getForecast);
router.get('/ai-health', ctrl.getAIHealth);

module.exports = router;
