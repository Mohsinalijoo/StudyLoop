import express from 'express';
import mongoose from 'mongoose';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { env } from './config/env.js';
import { redis } from './config/redis.js';
import apiRoutes from './routes/api.routes.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { rateLimit } from './middleware/rateLimit.js';
import { expressCorsOptions } from './config/cors.js';

export const app = express();
app.set('trust proxy', env.trustProxy);
app.disable('x-powered-by');
app.use((req, res, next) => {
  req.id = req.get('x-request-id')?.slice(0, 100) || randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
});
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// One Express CORS middleware; REST and Socket.IO share the same origin allow-list.
app.use(cors(expressCorsOptions));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(cookieParser());

app.get('/health/live', (_req, res) => res.json({ status: 'alive', uptimeSeconds: Math.floor(process.uptime()) }));
app.get('/health/ready', (_req, res) => {
  const mongoReady = mongoose.connection.readyState === 1;
  const ready = redis.isReady && mongoReady;
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', mongo: mongoReady ? 'up' : 'down', redis: redis.isReady ? 'up' : 'down' });
});
app.use('/api', rateLimit({ name: 'api', limit: 120, windowSeconds: 60 }));
app.use('/api', apiRoutes);
app.use(notFoundHandler);
app.use(errorHandler);

export default app;