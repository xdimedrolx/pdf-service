export class AppError extends Error {
  constructor({ message, status = 500, code = 'INTERNAL_ERROR', details = null, cause = null }) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;

    if (cause) {
      this.cause = cause;
    }
  }
}
