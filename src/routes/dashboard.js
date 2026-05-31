const express = require('express');
const ctrl = require('../controllers/dashboardController');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();
router.use(authenticate);

// Endpoint for the dashboard data
router.get('/summary', ctrl.getDashboardSummary);

module.exports = router;
