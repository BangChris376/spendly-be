const express = require('express');
const ctrl = require('../controllers/analysisController');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();
router.use(authenticate);

// Unified analysis endpoint for frontend global filtering
router.get('/summary', ctrl.getFullAnalysisSummary);

module.exports = router;
