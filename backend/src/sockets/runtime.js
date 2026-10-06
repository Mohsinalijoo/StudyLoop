let ioInstance;

export function setSocketServer(io) {
  ioInstance = io;
}

export function getSocketServer() {
  if (!ioInstance) throw new Error('Socket.IO has not been initialized');
  return ioInstance;
}

export const userSocketRoom = (userId) => `user:${String(userId)}`;
export const studySocketRoom = (roomId) => `study:${String(roomId)}`;
