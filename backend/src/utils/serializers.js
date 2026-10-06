export function publicUser(user, online = undefined) {
  if (!user) return null;
  const result = {
    id: String(user._id ?? user.id),
    displayName: user.displayName,
    subjects: user.subjects || [],
    availability: user.availability,
    timezone: user.timezone || null,
    bio: user.bio || ''
  };
  if (online !== undefined) result.online = Boolean(online);
  return result;
}

export function roomDto(room) {
  if (!room) return null;
  const members = (room.members || []).map((member) => {
    if (member && typeof member === 'object' && member._id && member.displayName !== undefined) {
      return {
        id: String(member._id),
        displayName: member.displayName,
        subjects: member.subjects || [],
        availability: member.availability
      };
    }
    return String(member?._id ?? member);
  });
  return {
    id: String(room._id ?? room.id),
    title: room.title,
    subject: room.subject,
    goal: room.goal || '',
    type: room.type,
    capacity: room.capacity,
    memberCount: members.length,
    members,
    hostId: room.host ? String(room.host?._id ?? room.host) : null,
    status: room.status,
    createdAt: room.createdAt
  };
}
