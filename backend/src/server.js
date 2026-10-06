import { createServer } from 'node:http';
import * as appModule from './app.js';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { connectRedis, disconnectRedis, redis } from './config/redis.js';
import { hydrateActiveRoomCache } from './services/presence.room-cache.js';
import { createSocketServer, closeSocketServer } from './sockets/index.js';
import { User } from './models/User.js';
import { Room } from './models/Room.js';
import { Session } from './models/Session.js';
import { ChatMessage } from './models/ChatMessage.js';
import { StudyNote } from './models/StudyNote.js';
import { Flashcard } from './models/Flashcard.js';
import { StudyRequest } from './models/StudyRequest.js';

// Accept either export style so the server can start with named or default app exports.
const app = appModule.app ?? appModule.default;
if (!app) throw new TypeError("./app.js must export the Express application as 'app' or as its default export");

let httpServer;
let shuttingDown = false;

async function ensureIndexes() {
  await Promise.all([User.createIndexes(), Room.createIndexes(), Session.createIndexes(), ChatMessage.createIndexes(), StudyNote.createIndexes(), Flashcard.createIndexes(), StudyRequest.createIndexes()]);
}

async function start() {
  await connectDatabase();
  await connectRedis();
  await ensureIndexes();
  await hydrateActiveRoomCache();
  httpServer = createServer(app);
  await createSocketServer(httpServer);
  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(env.port, '0.0.0.0', resolve);
  });
  console.info(`[server] REST + Socket.IO listening on 0.0.0.0:${env.port}`);
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`[server] ${signal} received; graceful shutdown starting`);
  try {
    await closeSocketServer();
    if (httpServer?.listening) await new Promise((resolve) => httpServer.close(resolve));
    await disconnectDatabase();
    await disconnectRedis();
  } catch (error) {
    console.error('[server] shutdown error', error);
  } finally {
    process.exit(0);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandled rejection', reason);
  void shutdown('unhandledRejection');
});

start().catch(async (error) => {
  console.error('[server] startup failed', error);
  try { await disconnectDatabase(); } catch { /* ignore during failed startup */ }
  try { if (redis.isOpen) await disconnectRedis(); } catch { /* ignore during failed startup */ }
  process.exit(1);
});
