import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { parseSubjects, requireAvailability, requireString } from '../utils/validation.js';
import { publicUser } from '../utils/serializers.js';
import { issueTokenPair, rotateRefreshToken, revokeAllRefreshTokens, revokeRefreshToken, durationToSeconds } from '../services/token.service.js';
import { env } from '../config/env.js';

const REFRESH_COOKIE = 'studyloop_refresh';
const cookieOptions = () => ({
  httpOnly: true,
  secure: env.cookieSecure,
  sameSite: env.cookieSameSite,
  path: '/api/auth',
  maxAge: durationToSeconds(env.jwtRefreshTtl) * 1000
});
const clearCookieOptions = () => {
  const { maxAge: _maxAge, ...options } = cookieOptions();
  return options;
};
const attachRefreshCookie = (res, token) => res.cookie(REFRESH_COOKIE, token, cookieOptions());
const clearRefreshCookie = (res) => res.clearCookie(REFRESH_COOKIE, clearCookieOptions());

function validateEmail(value) {
  const email = requireString(value, 'email', { min: 3, max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError(400, 'VALIDATION_ERROR', 'Enter a valid email address');
  return email;
}

function validatePassword(value, { login = false } = {}) {
  if (typeof value !== 'string') throw new AppError(400, 'VALIDATION_ERROR', 'password must be a string');
  if (login && value.length >= 1 && value.length <= 128) return value;
  if (value.length < 12 || value.length > 128) {
    throw new AppError(400, 'WEAK_PASSWORD', 'Password must be between 12 and 128 characters');
  }
  return value;
}

export const signup = asyncHandler(async (req, res) => {
  const displayName = requireString(req.body.displayName, 'displayName', { min: 2, max: 60 });
  const email = validateEmail(req.body.email);
  const password = validatePassword(req.body.password);
  const { labels, keys } = parseSubjects(req.body.subjects);
  const availability = requireAvailability(req.body.availability || 'flexible');
  const timezone = typeof req.body.timezone === 'string' ? req.body.timezone.trim().slice(0, 80) : '';
  const bio = typeof req.body.bio === 'string' ? req.body.bio.trim().slice(0, 300) : '';
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ displayName, email, passwordHash, subjects: labels, subjectKeys: keys, availability, timezone, bio });
  const tokens = await issueTokenPair(user);
  attachRefreshCookie(res, tokens.refreshToken);
  res.status(201).json({ data: { user: publicUser(user), accessToken: tokens.accessToken, accessTokenExpiresIn: env.jwtAccessTtl } });
});

export const login = asyncHandler(async (req, res) => {
  const email = validateEmail(req.body.email);
  const password = validatePassword(req.body.password, { login: true });
  const user = await User.findOne({ email, isDisabled: false }).select('+passwordHash');
  const valid = user ? await bcrypt.compare(password, user.passwordHash) : false;
  if (!valid) throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  const tokens = await issueTokenPair(user);
  attachRefreshCookie(res, tokens.refreshToken);
  res.json({ data: { user: publicUser(user), accessToken: tokens.accessToken, accessTokenExpiresIn: env.jwtAccessTtl } });
});

export const refresh = asyncHandler(async (req, res) => {
  try {
    const result = await rotateRefreshToken(req.cookies?.[REFRESH_COOKIE]);
    attachRefreshCookie(res, result.refreshToken);
    res.json({ data: { user: publicUser(result.user), accessToken: result.accessToken, accessTokenExpiresIn: env.jwtAccessTtl } });
  } catch (error) {
    clearRefreshCookie(res);
    throw error;
  }
});

export const logout = asyncHandler(async (req, res) => {
  await revokeRefreshToken(req.cookies?.[REFRESH_COOKIE]);
  clearRefreshCookie(res);
  res.json({ data: { loggedOut: true } });
});

export const logoutAll = asyncHandler(async (req, res) => {
  await revokeAllRefreshTokens(req.auth.userId);
  clearRefreshCookie(res);
  res.json({ data: { loggedOutEverywhere: true } });
});
