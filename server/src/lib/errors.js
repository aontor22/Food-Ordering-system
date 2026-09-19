export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message); this.status = status; this.code = code; this.details = details;
  }
}
export const notFound = (req, _res, next) => next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`));
export const errorHandler = (err, req, res, _next) => {
  if (err?.name === 'ZodError') return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: err.issues } });
  if (err?.code === 'P2002') return res.status(409).json({ error: { code: 'CONFLICT', message: 'A record with that value already exists' } });
  if (err?.code === 'P2025') return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'The requested record was not found' } });
  const status = err.status || 500;
  if (status >= 500) req.log?.error({ err }, 'request failed');
  res.status(status).json({ error: { code: err.code || 'INTERNAL_ERROR', message: status >= 500 ? 'An unexpected error occurred' : err.message, ...(err.details && { details: err.details }) } });
};
