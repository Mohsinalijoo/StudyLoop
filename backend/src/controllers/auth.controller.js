import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { parseSubjects, requireAvailability, requireString } from '../utils/validation.js';
import { publicUser } from '../utils/serializers.js';
import { issueTokenPair, rotateRefreshToken, revokeAllRefreshTokens, revokeRefreshToken, durationToSeconds } from '../services/token.service.js';
import { env } from '../config/env.js';
import { createPasswordResetToken, consumePasswordResetToken, revokePasswordResetToken } from '../services/password-reset.service.js';
import { requirePasswordResetEmailConfig, sendPasswordResetEmail } from '../services/email.service.js';

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

export const googleLogin = asyncHandler(async (req, res) => {
  if (!env.googleClientId) {
    throw new AppError(503, 'GOOGLE_SIGN_IN_UNAVAILABLE', 'Google sign-in is not configured yet');
  }
  const credential = requireString(req.body.credential, 'credential', { min: 40, max: 8192 });
  const client = new OAuth2Client(env.googleClientId);
  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: env.googleClientId });
    payload = ticket.getPayload();
  } catch {
    throw new AppError(401, 'INVALID_GOOGLE_CREDENTIAL', 'Google sign-in could not be verified. Please try again.');
  }
  if (!payload?.sub || !payload.email || payload.email_verified !== true) {
    throw new AppError(401, 'UNVERIFIED_GOOGLE_ACCOUNT', 'Use a Google account with a verified email address.');
  }

  const email = validateEmail(payload.email);
  let user = await User.findOne({ googleId: payload.sub }).select('+googleId');
  if (user?.isDisabled) throw new AppError(403, 'ACCOUNT_UNAVAILABLE', 'This account is unavailable');

  if (!user) {
    user = await User.findOne({ email }).select('+googleId');
    if (user?.isDisabled) throw new AppError(403, 'ACCOUNT_UNAVAILABLE', 'This account is unavailable');
    if (user) {
      if (user.googleId && user.googleId !== payload.sub) {
        throw new AppError(409, 'GOOGLE_ACCOUNT_ALREADY_LINKED', 'This Studyloop account is linked to a different Google account.');
      }
      user.googleId = payload.sub;
      await user.save();
    } else {
      let displayName = String(payload.name || payload.given_name || email.split('@')[0]).trim().slice(0, 60);
      if (displayName.length < 2) displayName = `${displayName || 'New'} Student`;
      try {
        user = await User.create({
          displayName,
          email,
          passwordHash: await bcrypt.hash(randomBytes(32).toString('base64url'), 12),
          googleId: payload.sub,
          subjects: ['General study'],
          subjectKeys: ['general-study'],
          availability: 'flexible'
        });
      } catch (error) {
        if (error?.code === 11000) {
          throw new AppError(409, 'ACCOUNT_ALREADY_EXISTS', 'This email is already connected to a Studyloop account. Try logging in with that account.');
        }
        throw error;
      }
    }
  }

  const tokens = await issueTokenPair(user);
  attachRefreshCookie(res, tokens.refreshToken);
  res.json({ data: { user: publicUser(user), accessToken: tokens.accessToken, accessTokenExpiresIn: env.jwtAccessTtl } });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const email = validateEmail(req.body.email);
  // Fail consistently for every address when email delivery is not configured.
  requirePasswordResetEmailConfig();
  const user = await User.findOne({ email, isDisabled: false });
  if (user) {
    const token = await createPasswordResetToken(user._id);
    // Send without waiting so response timing does not reveal whether the
    // address belongs to an account. The user can safely request another link
    // if delivery fails.
    void sendPasswordResetEmail(email, token).catch(async (error) => {
      await revokePasswordResetToken(user._id, token).catch(() => {});
      console.error('[password-reset] email delivery failed', error.message);
    });
  }
  res.status(202).json({ data: { message: 'If an account with that email exists, a password reset link will be sent shortly.' } });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const token = requireString(req.body.token, 'token', { min: 40, max: 100 });
  const password = validatePassword(req.body.password);
  const userId = await consumePasswordResetToken(token);
  if (!userId) throw new AppError(400, 'INVALID_OR_EXPIRED_RESET_TOKEN', 'This reset link is invalid or has expired. Request a new one.');

  const user = await User.findOne({ _id: userId, isDisabled: false }).select('+passwordHash');
  if (!user) throw new AppError(400, 'INVALID_OR_EXPIRED_RESET_TOKEN', 'This reset link is invalid or has expired. Request a new one.');
  user.passwordHash = await bcrypt.hash(password, 12);
  await user.save();
  await revokeAllRefreshTokens(user._id);
  clearRefreshCookie(res);
  res.json({ data: { message: 'Your password has been reset. You can now log in with your new password.' } });
});
