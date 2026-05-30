// pg sqlstate codes mapped to user-friendly responses
const PG_ERRORS = {
  '23505': { status: 409, message: 'Record already exists' },
  '23503': { status: 400, message: 'Referenced record not found' },
  '22P02': { status: 400, message: 'Invalid UUID format' },
};

const errorHandler = (err, req, res, _next) => {
  console.error(`[${new Date().toISOString()}]`, err.stack || err.message);

  if (err.code && PG_ERRORS[err.code]) {
    const mapped = PG_ERRORS[err.code];
    return res.status(mapped.status).json({ success: false, message: mapped.message });
  }

  const status = err.status || 500;
  const body = {
    success: false,
    message: err.message || 'Internal server error',
  };
  if (err.errors) body.errors = err.errors;
  if (process.env.NODE_ENV === 'development') body.stack = err.stack;

  return res.status(status).json(body);
};

const notFound = (req, res) =>
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });

module.exports = { errorHandler, notFound };
