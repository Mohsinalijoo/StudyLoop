import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { User } from '../models/User.js';

export const requireAuth = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new AppError(401, 'AUTH_REQUIRED', 'A Bearer access token is required');
  const payload = jwt.verify(match[1], env.jwtAccessSecret, {
    issuer: env.jwtIssuer,
    audience: env.jwtAudience
  });
  if (payload.typ !== 'access' || !payload.sub) throw new AppError(401, 'INVALID_TOKEN', 'Access token is invalid');
  const user = await User.findOne({ _id: payload.sub, isDisabled: false }).select('_id displayName email subjects subjectKeys availability timezone bio');
  if (!user) throw new AppError(401, 'ACCOUNT_UNAVAILABLE', 'This account is unavailable');
  req.user = user;
  req.auth = { userId: String(user._id) };
  next();
});
