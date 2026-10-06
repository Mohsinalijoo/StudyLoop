(() => {
  'use strict';

  const apiMeta = document.querySelector('meta[name="studyloop-api-url"]');
  const isLocalFrontend = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const defaultApiOrigin = isLocalFrontend ? 'http://localhost:4000' : (apiMeta?.content || 'https://studyloop-api-mmrq.onrender.com');
  const API_ORIGIN = (window.STUDYLOOP_API_URL || defaultApiOrigin).replace(/\/+$/, '');
  const API_BASE = (window.STUDYLOOP_API_BASE || `${API_ORIGIN}/api`).replace(/\/+$/, '');
  let accessToken = null;
  let refreshPromise = null;

  class ApiError extends Error {
    constructor(status, code, message) {
      super(message || `Request failed (HTTP ${status})`);
      this.name = 'ApiError';
      this.status = status;
      this.code = code || 'API_ERROR';
    }
  }

  function routeUrl(path) {
    if (/^https?:\/\//i.test(path)) return path;
    return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  }

  async function fetchPayload(path, options = {}, token = accessToken) {
    const { headers: suppliedHeaders, body: suppliedBody, ...fetchOptions } = options;
    const headers = new Headers(suppliedHeaders || {});
    headers.set('Accept', 'application/json');
    let body = suppliedBody;
    if (body !== undefined && body !== null && !(body instanceof FormData) && typeof body !== 'string') {
      body = JSON.stringify(body);
    }
    if (typeof body === 'string' && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    let response;
    try {
      response = await fetch(routeUrl(path), {
        ...fetchOptions,
        body,
        headers,
        credentials: 'include'
      });
    } catch (error) {
      throw new ApiError(0, 'NETWORK_ERROR', `Could not reach ${API_ORIGIN}. Check that the API is running and its CORS origin includes this frontend.`);
    }

    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  }

  async function refreshSession() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      const { response, payload } = await fetchPayload('/auth/refresh', { method: 'POST' }, null);
      if (!response.ok) {
        accessToken = null;
        throw new ApiError(response.status, payload.error?.code, payload.error?.message);
      }
      accessToken = payload.data?.accessToken || null;
      if (!accessToken) throw new ApiError(401, 'INVALID_REFRESH_RESPONSE', 'Refresh response did not include an access token');
      return payload.data;
    })().finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  const publicAuthPaths = new Set(['/auth/login', '/auth/signup', '/auth/register', '/auth/google', '/auth/forgot-password', '/auth/reset-password', '/auth/refresh', '/auth/logout']);

  async function request(path, options = {}) {
    const { retryAuth = true, ...requestOptions } = options;
    let result = await fetchPayload(path, requestOptions);
    if (result.response.status === 401 && accessToken && retryAuth && !publicAuthPaths.has(path.split('?')[0])) {
      try {
        await refreshSession();
        result = await fetchPayload(path, requestOptions);
      } catch (refreshError) {
        accessToken = null;
        window.dispatchEvent(new CustomEvent('studyloop:auth-expired', { detail: refreshError }));
        throw refreshError;
      }
    }
    if (!result.response.ok) {
      const error = new ApiError(result.response.status, result.payload.error?.code, result.payload.error?.message);
      if (result.response.status === 401 && !publicAuthPaths.has(path.split('?')[0])) {
        window.dispatchEvent(new CustomEvent('studyloop:auth-expired', { detail: error }));
      }
      throw error;
    }
    return result.payload.data;
  }

  async function login(credentials) {
    const data = await request('/auth/login', { method: 'POST', body: credentials, retryAuth: false });
    accessToken = data?.accessToken || null;
    return data;
  }

  async function register(profile) {
    const data = await request('/auth/register', { method: 'POST', body: profile, retryAuth: false });
    accessToken = data?.accessToken || null;
    return data;
  }

  async function googleLogin(credential) {
    const data = await request('/auth/google', { method: 'POST', body: { credential }, retryAuth: false });
    accessToken = data?.accessToken || null;
    return data;
  }

  async function forgotPassword(email) {
    return request('/auth/forgot-password', { method: 'POST', body: { email }, retryAuth: false });
  }

  async function resetPassword(token, password) {
    return request('/auth/reset-password', { method: 'POST', body: { token, password }, retryAuth: false });
  }

  async function logout() {
    try {
      return await request('/auth/logout', { method: 'POST', retryAuth: false });
    } finally {
      accessToken = null;
    }
  }

  window.StudyloopAPI = Object.freeze({
    API_BASE,
    API_ORIGIN,
    request,
    login,
    register,
    googleLogin,
    forgotPassword,
    resetPassword,
    refreshSession,
    logout,
    getAccessToken: () => accessToken,
    setAccessToken: (token) => { accessToken = typeof token === 'string' ? token : null; },
    clearAccessToken: () => { accessToken = null; },
    ApiError
  });
})();
