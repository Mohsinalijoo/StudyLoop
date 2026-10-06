(() => {
  'use strict';

  const api = window.StudyloopAPI;
  let socket = null;
  let scriptPromise = null;
  let connectPromise = null;
  let readyPayload = null;
  let refreshingSocketAuth = false;

  function loadSocketClient() {
    if (typeof window.io === 'function') return Promise.resolve();
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${api.API_ORIGIN}/socket.io/socket.io.js`;
      script.async = true;
      script.onload = () => typeof window.io === 'function'
        ? resolve()
        : reject(new Error('Socket.IO client loaded but the io() function is unavailable'));
      script.onerror = () => reject(new Error('Could not load the Socket.IO client from the API server'));
      document.head.appendChild(script);
    }).catch((error) => {
      scriptPromise = null;
      throw error;
    });
    return scriptPromise;
  }

  async function refreshSocketToken(error) {
    if (refreshingSocketAuth || !socket || !/AUTH_REQUIRED|INVALID_TOKEN|jwt expired|expired/i.test(error?.message || '')) return;
    refreshingSocketAuth = true;
    try {
      await api.refreshSession();
      socket.auth = { token: api.getAccessToken() };
      socket.connect();
    } catch {
      window.dispatchEvent(new CustomEvent('studyloop:auth-expired'));
    } finally {
      refreshingSocketAuth = false;
    }
  }

  function connect() {
    if (socket?.connected && readyPayload) return Promise.resolve(socket);
    if (connectPromise) return connectPromise;

    connectPromise = (async () => {
      await loadSocketClient();
      if (socket) socket.disconnect();
      readyPayload = null;
      socket = window.io(api.API_ORIGIN, {
        auth: { token: api.getAccessToken() },
        withCredentials: true,
        autoConnect: false,
        reconnection: true,
        reconnectionAttempts: 8,
        timeout: 10000
      });

      socket.on('connection:ready', (data) => { readyPayload = data; });
      socket.on('connect_error', (error) => { void refreshSocketToken(error); });

      return new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          cleanup();
          reject(new Error('Timed out connecting to the real-time server'));
        }, 12000);
        const onReady = (data) => {
          readyPayload = data;
          cleanup();
          resolve(socket);
        };
        const onError = (error) => {
          cleanup();
          reject(error);
        };
        const onDisconnect = (reason) => {
          if (!readyPayload) onError(new Error(`Socket disconnected before setup completed: ${reason}`));
        };
        function cleanup() {
          window.clearTimeout(timeout);
          socket.off('connection:ready', onReady);
          socket.off('connect_error', onError);
          socket.off('disconnect', onDisconnect);
        }
        socket.once('connection:ready', onReady);
        socket.once('connect_error', onError);
        socket.once('disconnect', onDisconnect);
        socket.connect();
      });
    })().finally(() => { connectPromise = null; });
    return connectPromise;
  }

  function emitAck(event, payload = {}) {
    if (!socket?.connected) return Promise.reject(new Error('Real-time connection is not ready. Reconnect and try again.'));
    return new Promise((resolve, reject) => {
      socket.timeout(10000).emit(event, payload, (timeoutError, response) => {
        if (timeoutError) return reject(new Error('The real-time request timed out.'));
        if (!response?.ok) return reject(new api.ApiError(0, response?.error?.code, response?.error?.message || 'Real-time request failed'));
        resolve(response.data);
      });
    });
  }

  window.StudyloopRealtime = Object.freeze({
    connect,
    emitAck,
    get socket() { return socket; },
    get ready() { return Boolean(socket?.connected && readyPayload); },
    get readyPayload() { return readyPayload; },
    disconnect() {
      if (socket) socket.disconnect();
      socket = null;
      readyPayload = null;
    }
  });
})();
