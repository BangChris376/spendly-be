const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const env = require('./config/env');
const apiRoutes = require('./routes');
const { errorHandler, notFound } = require('./middlewares/errorHandler');

const app = express();

app.disable('x-powered-by');

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: env.allowedOrigins, credentials: true }));
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// serve uploaded receipts and avatars
app.use('/uploads', express.static(path.join(__dirname, '..', env.uploadDir)));

app.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    service: 'Spendly API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: env.nodeEnv,
  });
});

app.use('/api/v1', apiRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
