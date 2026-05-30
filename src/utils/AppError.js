// thin error class so controllers can throw and the global handler will format

class AppError extends Error {
  constructor(message, status = 400, errors = null) {
    super(message);
    this.status = status;
    this.errors = errors;
    this.isOperational = true;
  }
}

module.exports = AppError;
