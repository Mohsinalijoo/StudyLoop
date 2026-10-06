(() => {
  'use strict';

  const api = window.StudyloopAPI;
  const state = { user: null, ready: Promise.resolve(null) };

  function updateHeader(user) {
    state.user = user || null;
    const loginLink = document.getElementById('loginLink');
    const signupLink = document.getElementById('signupLink');
    const greeting = document.getElementById('authGreeting');
    const logoutButton = document.getElementById('logoutButton');
    const mobileLoginLink = document.getElementById('mobileLoginLink');
    if (!loginLink || !signupLink || !greeting || !logoutButton) return;

    loginLink.hidden = Boolean(user);
    signupLink.hidden = Boolean(user);
    if (mobileLoginLink) mobileLoginLink.hidden = Boolean(user);
    greeting.hidden = !user;
    logoutButton.hidden = !user;
    if (user) {
      greeting.textContent = `Hi, ${user.displayName}`;
      greeting.title = 'View and edit your Studyloop profile';
      greeting.setAttribute('aria-label', `Open profile for ${user.displayName}`);
    }
  }

  function showGuardError(message) {
    const guard = document.getElementById('authGuard');
    const text = guard?.querySelector('[data-auth-guard-message]');
    const retry = guard?.querySelector('[data-auth-retry]');
    if (text) text.textContent = message;
    if (retry) retry.hidden = false;
    if (guard) guard.hidden = false;
    document.body.classList.add('auth-pending');
  }

  async function initializeProtectedPage() {
    const guard = document.getElementById('authGuard');
    if (guard) guard.hidden = false;
    document.body.classList.add('auth-pending');
    try {
      await api.refreshSession();
      const result = await api.request('/users/me');
      state.user = result.user;
      updateHeader(state.user);
      document.body.classList.remove('auth-pending');
      if (guard) guard.hidden = true;
      return state.user;
    } catch (error) {
      if (error.status === 401) {
        const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        window.location.replace(`login.html?next=${encodeURIComponent(next)}`);
        return null;
      }
      showGuardError(error.message || 'Could not verify your session. Check that the API is running and try again.');
      return null;
    }
  }

  async function signOut() {
    await api.logout();
    state.user = null;
    window.StudyloopRealtime?.disconnect();
    window.location.assign('login.html?loggedOut=1');
  }

  window.StudyloopAuth = Object.freeze({
    get user() { return state.user; },
    get ready() { return state.ready; },
    updateHeader,
    signOut
  });

  const protectedPage = document.body.dataset.authProtected === 'true';
  if (protectedPage) {
    state.ready = initializeProtectedPage();
    const retryButton = document.querySelector('[data-auth-retry]');
    retryButton?.addEventListener('click', () => window.location.reload());
  }

  window.addEventListener('studyloop:auth-expired', () => {
    if (!protectedPage) return;
    const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.replace(`login.html?next=${encodeURIComponent(next)}`);
  });

  const logoutButton = document.getElementById('logoutButton');
  logoutButton?.addEventListener('click', async () => {
    logoutButton.disabled = true;
    try {
      await signOut();
    } catch (error) {
      logoutButton.disabled = false;
      const greeting = document.getElementById('authGreeting');
      if (greeting) greeting.title = error.message || 'Logout failed. Please try again.';
    }
  });

  const authForm = document.querySelector('[data-auth-form]');
  if (authForm) {
    const mode = authForm.dataset.authMode;
    const feedback = authForm.querySelector('[data-auth-feedback]');
    const submitButton = authForm.querySelector('button[type="submit"]');
    const originalButtonText = submitButton?.innerHTML || '';

    function setFeedback(message, type = 'error') {
      if (!feedback) return;
      feedback.textContent = message;
      feedback.className = `auth-feedback is-${type}`;
      feedback.hidden = !message;
    }

    function nextPage() {
      // The only protected frontend route is the Studyloop dashboard.
      return 'index.html#find';
    }

    authForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      setFeedback('');
      const values = authForm.elements;
      const email = values.email.value.trim();
      const password = values.password.value;
      let result;

      if (mode === 'signup') {
        const displayName = values.displayName.value.trim();
        const subject = values.subject.value;
        if (password !== values.confirmPassword.value) {
          setFeedback('Those passwords do not match. Please try again.');
          values.confirmPassword.focus();
          return;
        }
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
        result = await submitRequest(() => api.register({
          displayName,
          email,
          password,
          subjects: [subject],
          availability: values.availability.value,
          timezone
        }));
      } else {
        result = await submitRequest(() => api.login({ email, password }));
      }

      if (result) {
        setFeedback(mode === 'signup' ? 'Account created. Taking you to Studyloop…' : 'You’re signed in. Taking you to Studyloop…', 'success');
        window.setTimeout(() => window.location.assign(nextPage()), 450);
      }
    });

    async function submitRequest(operation) {
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = mode === 'signup' ? 'Creating account…' : 'Logging in…';
      }
      try {
        const data = await operation();
        if (!data?.accessToken) throw new Error('The API response did not include an access token.');
        // The access token remains only in this page's memory. The API sets
        // an HttpOnly refresh cookie used when the protected page loads.
        return data;
      } catch (error) {
        setFeedback(error.message || 'Unable to complete the request. Please try again.');
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.innerHTML = originalButtonText;
        }
        return null;
      }
    }
  }

  if (window.location.search.includes('loggedOut=1')) {
    const feedback = document.querySelector('[data-auth-feedback]');
    if (feedback) {
      feedback.textContent = 'You have been logged out.';
      feedback.className = 'auth-feedback is-success';
      feedback.hidden = false;
    }
  }

  const googleSection = document.querySelector('[data-google-signin]');
  if (googleSection) {
    const clientId = document.querySelector('meta[name="google-client-id"]')?.content.trim();
    if (clientId) {
      const googleButton = googleSection.querySelector('[data-google-button]');
      const feedback = googleSection.querySelector('[data-google-feedback]');
      googleSection.hidden = false;

      function googleFeedback(message, type = 'error') {
        if (!feedback) return;
        feedback.textContent = message;
        feedback.className = `auth-feedback is-${type}`;
        feedback.hidden = !message;
      }

      function renderGoogleButton() {
        if (!window.google?.accounts?.id || !googleButton) {
          googleFeedback('Google sign-in could not load. Check your connection and try again.');
          return;
        }
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: async (response) => {
            googleFeedback('');
            if (!response?.credential) {
              googleFeedback('Google did not return a sign-in credential. Please try again.');
              return;
            }
            try {
              const result = await api.googleLogin(response.credential);
              if (!result?.accessToken) throw new Error('The API response did not include an access token.');
              googleFeedback('You’re signed in. Taking you to Studyloop…', 'success');
              window.setTimeout(() => window.location.assign('index.html#find'), 400);
            } catch (error) {
              googleFeedback(error.message || 'Google sign-in failed. Please try again.');
            }
          }
        });
        window.google.accounts.id.renderButton(googleButton, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          width: Math.min(360, Math.floor(googleButton.getBoundingClientRect().width || 360))
        });
      }

      const googleScript = document.createElement('script');
      googleScript.src = 'https://accounts.google.com/gsi/client';
      googleScript.async = true;
      googleScript.defer = true;
      googleScript.onload = renderGoogleButton;
      googleScript.onerror = () => googleFeedback('Google sign-in could not load. Please try again later.');
      document.head.append(googleScript);
    }
  }
})();
