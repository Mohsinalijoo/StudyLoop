import { Session } from '../models/Session.js';
import { User } from '../models/User.js';
import { onlineStatuses } from './presence.service.js';

const MAX_ACTIVE_STUDY_SECONDS = 8 * 60 * 60;

export async function getStudyLeaderboard(limit = 5) {
  const now = new Date();
  const [completed, active] = await Promise.all([
    Session.aggregate([
      { $match: { leftAt: { $ne: null } } },
      { $group: { _id: '$userId', seconds: { $sum: { $ifNull: ['$durationSeconds', 0] } } } }
    ]),
    Session.aggregate([
      { $match: { leftAt: null } },
      { $group: { _id: '$userId', startedAt: { $min: '$joinedAt' } } }
    ])
  ]);

  const secondsByUser = new Map(completed.map((row) => [String(row._id), Math.max(0, Number(row.seconds) || 0)]));
  if (active.length) {
    const statuses = await onlineStatuses(active.map((row) => String(row._id)));
    for (const row of active) {
      const userId = String(row._id);
      if (!statuses.get(userId)) continue;
      const elapsed = Math.max(0, Math.floor((now.getTime() - new Date(row.startedAt).getTime()) / 1000));
      secondsByUser.set(userId, (secondsByUser.get(userId) || 0) + Math.min(elapsed, MAX_ACTIVE_STUDY_SECONDS));
    }
  }

  const ranked = [...secondsByUser.entries()]
    .filter(([, seconds]) => seconds > 0)
    .sort((left, right) => right[1] - left[1])
    .slice(0, Math.min(5, Math.max(1, limit)));
  if (!ranked.length) return [];

  const users = await User.find({ _id: { $in: ranked.map(([id]) => id) }, isDisabled: false })
    .select('displayName loginStreak longestLoginStreak')
    .lean();
  const usersById = new Map(users.map((user) => [String(user._id), user]));
  return ranked.flatMap(([id, seconds], index) => {
    const user = usersById.get(id);
    if (!user) return [];
    return [{
      rank: index + 1,
      user: { id, displayName: user.displayName },
      studySeconds: seconds,
      studyHours: Number((seconds / 3600).toFixed(1)),
      loginStreak: Number(user.loginStreak || 0),
      longestLoginStreak: Number(user.longestLoginStreak || 0)
    }];
  });
}
