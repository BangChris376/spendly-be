// standard response envelopes used across all controllers

const success = (res, data = null, message = 'Success', status = 200) =>
  res.status(status).json({ success: true, message, data });

const failure = (res, message = 'Error', status = 400, errors = null) =>
  res.status(status).json({ success: false, message, ...(errors ? { errors } : {}) });

const paginated = (res, data, total, page, limit, message = 'Success') => {
  const p = parseInt(page, 10);
  const l = parseInt(limit, 10);
  return res.status(200).json({
    success: true,
    message,
    data,
    pagination: {
      total,
      page: p,
      limit: l,
      totalPages: Math.ceil(total / l),
      hasNext: p * l < total,
      hasPrev: p > 1,
    },
  });
};

module.exports = { success, failure, paginated };
