import { Router } from 'express';
import { signup, login, refresh, logout, logoutAll, googleLogin, forgotPassword, resetPassword } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';

const router = Router();
const authIpLimit = rateLimit({ name: 'auth', limit: 12, windowSeconds: 15 * 60 });
const passwordResetLimit = rateLimit({ name: 'password-reset', limit: 5, windowSeconds: 60 * 60 });

router.post('/signup', authIpLimit, signup);
// Keep the REST-friendly /register alias for clients that call registration by name.
router.post('/register', authIpLimit, signup);
router.post('/login', authIpLimit, login);
router.post('/google', authIpLimit, googleLogin);
router.post('/forgot-password', passwordResetLimit, forgotPassword);
router.post('/reset-password', authIpLimit, resetPassword);
router.post('/refresh', authIpLimit, refresh);
router.post('/logout', logout);
router.post('/logout-all', requireAuth, logoutAll);

export default router;
