import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

const hasAppsScriptMailer = () => Boolean(env.mailerWebAppUrl && env.mailerSharedSecret);
const hasResendMailer = () => Boolean(env.resendApiKey && env.emailFrom);

function parseWebUrl(value, label, { httpsOnly = false } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(503, 'PASSWORD_RESET_UNAVAILABLE', `${label} is not configured correctly.`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || (httpsOnly && url.protocol !== 'https:')) {
    throw new AppError(503, 'PASSWORD_RESET_UNAVAILABLE', `${label} must be a valid ${httpsOnly ? 'HTTPS' : 'HTTP or HTTPS'} URL.`);
  }
  return url;
}

export function requirePasswordResetEmailConfig() {
  if (!env.frontendUrl || (!hasAppsScriptMailer() && !hasResendMailer())) {
    throw new AppError(503, 'PASSWORD_RESET_UNAVAILABLE', 'Password reset email is not configured yet. Please contact Studyloop support.');
  }
  const frontendUrl = parseWebUrl(env.frontendUrl, 'FRONTEND_URL', { httpsOnly: env.nodeEnv === 'production' });
  if (hasAppsScriptMailer()) parseWebUrl(env.mailerWebAppUrl, 'MAILER_WEBAPP_URL', { httpsOnly: true });
  return frontendUrl;
}

export async function sendPasswordResetEmail(email, token) {
  requirePasswordResetEmailConfig();
  const resetUrl = new URL('/reset-password.html', env.frontendUrl);
  resetUrl.hash = new URLSearchParams({ token }).toString();
  const link = resetUrl.toString();
  const ttlMinutes = Math.max(1, Math.round(env.passwordResetTtlSeconds / 60));
  const text = `We received a request to reset your Studyloop password. Use this one-time link within ${ttlMinutes} minutes:\n\n${link}\n\nIf you did not request this, you can ignore this email.`;
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#23243a"><h2>Reset your Studyloop password</h2><p>Use this one-time link within ${ttlMinutes} minutes to choose a new password:</p><p><a href="${link}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#7063d5;color:#fff;text-decoration:none">Reset password</a></p><p>If you did not request this, you can ignore this email.</p></div>`;

  // Google Apps Script is a no-domain, free option for small projects. It
  // executes as the Gmail account owner and checks this shared secret server-side.
  if (hasAppsScriptMailer()) {
    const response = await fetch(env.mailerWebAppUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: env.mailerSharedSecret,
        to: email,
        subject: 'Reset your Studyloop password',
        text,
        html
      }),
      signal: AbortSignal.timeout(10000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok !== true) {
      throw new Error(`Apps Script mailer failed${result.error ? `: ${String(result.error).slice(0, 120)}` : ` (HTTP ${response.status})`}`);
    }
    return;
  }

  // Resend remains available as an alternative for users with a verified domain.
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.resendApiKey}`,
      'Content-Type': 'application/json'
    },
    signal: AbortSignal.timeout(10000),
    body: JSON.stringify({
      from: env.emailFrom,
      to: [email],
      subject: 'Reset your Studyloop password',
      html,
      text
    })
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Resend returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
  }
}
