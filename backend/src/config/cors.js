import { env } from './env.js';
import { AppError } from '../utils/AppError.js';

const allowedOrigins = new Set(env.corsOrigins);

export function isAllowedOrigin(origin) {
  return !origin || allowedOrigins.has(origin);
}

function corsOrigin(origin, callback) {
  if (isAllowedOrigin(origin)) return callback(null, true);
  return callback(new AppError(403, 'CORS_ORIGIN_DENIED', 'Browser origin is not in CORS_ORIGINS'));
}

export const expressCorsOptions = Object.freeze({
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  origin: corsOrigin
});

export const socketCorsOptions = Object.freeze({
  credentials: true,
  origin: corsOrigin
});

export function allowSocketOrigin(request, callback) {
  if (isAllowedOrigin(request.headers.origin)) return callback(null, true);
  return callback(new Error('Origin is not allowed by CORS_ORIGINS'), false);
}
