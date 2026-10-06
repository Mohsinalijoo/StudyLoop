(() => {
    'use strict';
  
    const api = window.StudyloopAPI;
  
    function setFeedback(element, message, type = 'error') {
      if (!element) return;
      element.textContent = message;
      element.className = `auth-feedback is-${type}`;
      element.hidden = !message;
    }
  
    const forgotForm = document.querySelector('[data-forgot-password]');
    if (forgotForm) {
      const feedback = forgotForm.querySelector('[data-reset-feedback]');
      const button = forgotForm.querySelector('button[type="submit"]');
      const buttonMarkup = button?.innerHTML || '';
      forgotForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        setFeedback(feedback, '');
        if (button) {
          button.disabled = true;
          button.textContent = 'Sending…';
        }
        try {
          const result = await api.forgotPassword(forgotForm.elements.email.value.trim());
          setFeedback(feedback, result?.message || 'If an account with that email exists, a password reset link will be sent shortly.', 'success');
        } catch (error) {
          setFeedback(feedback, error.message || 'Unable to request a reset link. Please try again.');
        } finally {
          if (button) {
            button.disabled = false;
            button.innerHTML = buttonMarkup;
          }
        }
      });
    }
  
    const resetForm = document.querySelector('[data-reset-password]');
    if (resetForm) {
      const feedback = resetForm.querySelector('[data-reset-feedback]');
      const button = resetForm.querySelector('button[type="submit"]');
      const buttonMarkup = button?.innerHTML || '';
      let token = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token') || '';
      if (window.location.hash) {
        // The one-time token is kept only in memory, not in browser history or referrers.
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      }
      if (!token) {
        setFeedback(feedback, 'This reset link is missing or invalid. Request a new one to continue.');
        if (button) button.disabled = true;
      }
  
      resetForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        setFeedback(feedback, '');
        if (!token) {
          setFeedback(feedback, 'This reset link is missing or invalid. Request a new one to continue.');
          return;
        }
        const password = resetForm.elements.password.value;
        const confirmation = resetForm.elements.confirmPassword.value;
        if (password !== confirmation) {
          setFeedback(feedback, 'Those passwords do not match. Please try again.');
          resetForm.elements.confirmPassword.focus();
          return;
        }
        if (button) {
          button.disabled = true;
          button.textContent = 'Resetting…';
        }
        try {
          const result = await api.resetPassword(token, password);
          token = '';
          resetForm.elements.password.value = '';
          resetForm.elements.confirmPassword.value = '';
          setFeedback(feedback, result?.message || 'Your password has been reset. You can now log in with your new password.', 'success');
          if (button) {
            button.textContent = 'Password reset';
            button.disabled = true;
          }
        } catch (error) {
          setFeedback(feedback, error.message || 'Unable to reset your password. Request a new link and try again.');
          if (button) {
            button.disabled = false;
            button.innerHTML = buttonMarkup;
          }
        }
      });
    }
  })();
  