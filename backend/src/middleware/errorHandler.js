import { AppError } from '../utils/AppError.js';
import { env } from '../config/env.js';

export function notFoundHandler(req, res, next) {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.originalUrl} was not found`));
}

export function errorHandler(error, req, res, _next) {
  if (res.headersSent) return;
  let statusCode = error.statusCode || 500;
  let code = error.code || 'INTERNAL_ERROR';
  let message = error.message || 'An unexpected error occurred';

  if (error?.code === 11000) {
    statusCode = 409;
    code = 'DUPLICATE_RESOURCE';
    message = 'A record with that value already exists';
  } else if (error?.name === 'ValidationError') {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    message = 'One or more fields failed validation';
  } else if (error?.name === 'CastError') {
    statusCode = 400;
    code = 'INVALID_ID';
    message = 'The requested identifier is invalid';
  } else if (error?.type === 'entity.parse.failed') {
    statusCode = 400;
    code = 'INVALID_JSON';
    message = 'Request body contains invalid JSON';
  } else if (error?.type === 'entity.too.large') {
    statusCode = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body is too large';
  } else if (error?.name === 'JsonWebTokenError' || error?.name === 'TokenExpiredError') {
    statusCode = 401;
    code = 'INVALID_TOKEN';
    message = 'Authentication token is invalid or expired';
  }

  if (statusCode >= 500) {
    console.error(JSON.stringify({ level: 'error', requestId: req.id, path: req.originalUrl, error: error.stack || message }));
    message = env.nodeEnv === 'production' ? 'Internal server error' : message;
  }

  res.status(statusCode).json({
    error: { code, message, ...(error.details ? { details: error.details } : {}), requestId: req.id }
  });
}
