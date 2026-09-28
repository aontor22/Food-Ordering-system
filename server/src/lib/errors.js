import { captureOperationalError } from '../services/observability.js';

export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message); this.status = status; this.code = code; this.details = details;
  }
}
export const notFound = (req, _res, next) => next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`));

function errorPayload(req, code, message, details) {
  return { error: { code, message, ...(details && { details }), ...(req.id && { requestId: req.id }) } };
}

export const errorHandler = (err, req, res, _next) => {
  if (err?.name === 'ZodError') return res.status(400).json(errorPayload(req, 'VALIDATION_ERROR', 'Invalid request', err.issues));
  if (err?.code === 'P2002') return res.status(409).json(errorPayload(req, 'CONFLICT', 'A record with that value already exists'));
  if (err?.code === 'P2025') return res.status(404).json(errorPayload(req, 'NOT_FOUND', 'The requested record was not found'));
  if (err?.code === 'P2034') return res.status(409).json(errorPayload(req, 'ORDER_CONFLICT', 'Availability changed while placing the order. Please review the latest slot and try again.'));
  if (['P2021', 'P2022'].includes(err?.code) || (err?.name === 'PrismaClientValidationError' && /manual(Submissions|Destination)|manualPayment(Channel|Submission)|imagePublicId|pointsBalance|Review|Loyalty|DeliveryZone|deliveryZone|Fulfillment|fulfillment|scheduledForLocal/i.test(err.message || ''))) {
    req.log?.error({ err }, 'database schema/client is out of date');
    void captureOperationalError(err, { source: 'DATABASE', code: 'DATABASE_SCHEMA_OUT_OF_DATE', message: 'Database schema/client is out of date', requestId: req.id, route: req.path, method: req.method, statusCode: 503 });
    return res.status(503).json(errorPayload(req, 'DATABASE_SCHEMA_OUT_OF_DATE', 'Database schema is out of date. Run the production migration before serving traffic.'));
  }
  const status = err.status || 500;
  if (status >= 500) {
    req.log?.error({ err }, 'request failed');
    void captureOperationalError(err, {
      source: 'HTTP', code: err.code || 'INTERNAL_ERROR', message: 'HTTP request failed', requestId: req.id,
      route: req.path, method: req.method, statusCode: status,
      metadata: { actorRole: req.auth?.role || null },
    });
  }
  res.status(status).json(errorPayload(req, err.code || 'INTERNAL_ERROR', status >= 500 ? 'An unexpected error occurred' : err.message, err.details));
};
