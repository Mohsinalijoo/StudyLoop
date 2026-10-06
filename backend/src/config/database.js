import mongoose from 'mongoose';
import { env } from './env.js';

mongoose.set('strictQuery', true);
mongoose.connection.on('connected', () => console.info('[mongo] connected'));
mongoose.connection.on('disconnected', () => console.warn('[mongo] disconnected'));
mongoose.connection.on('error', (error) => console.error('[mongo] connection error', error));

export async function connectDatabase() {
  await mongoose.connect(env.mongoUri, {
    autoIndex: env.nodeEnv !== 'production',
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 30,
    minPoolSize: 2
  });
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
