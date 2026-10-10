import { User } from '../models/User.js';
import { withDistributedLock } from './distributedLock.js';

const utcDateKey = (date) => date.toISOString().slice(0, 10);

export async function markLoginStreak(userId, now = new Date()) {
  return withDistributedLock(`lock:login-streak:${userId}`, async () => {
    const user = await User.findOne({ _id: userId, isDisabled: false });
    if (!user) return null;

    const today = utcDateKey(now);
    if (user.lastLoginDate !== today) {
      const yesterday = utcDateKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));
      user.loginStreak = user.lastLoginDate === yesterday ? (user.loginStreak || 0) + 1 : 1;
      user.longestLoginStreak = Math.max(user.longestLoginStreak || 0, user.loginStreak);
      user.lastLoginDate = today;
      await user.save();
    }
    return user;
  });
}
