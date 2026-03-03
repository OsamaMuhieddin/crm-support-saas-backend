import nodemailer from 'nodemailer';
import sendgridMail from '@sendgrid/mail';
import { authConfig } from '../../config/auth.config.js';

let smtpTransporter = null;

const hasSendgrid = Boolean(authConfig.email.sendgridApiKey);
const hasSmtp = Boolean(
  authConfig.email.smtp.host &&
    authConfig.email.smtp.port &&
    authConfig.email.smtp.user &&
    authConfig.email.smtp.pass
);

if (hasSendgrid) {
  sendgridMail.setApiKey(authConfig.email.sendgridApiKey);
}

const getSmtpTransporter = () => {
  if (!hasSmtp) {
    return null;
  }

  if (!smtpTransporter) {
    smtpTransporter = nodemailer.createTransport({
      host: authConfig.email.smtp.host,
      port: authConfig.email.smtp.port,
      secure: authConfig.email.smtp.port === 465,
      auth: {
        user: authConfig.email.smtp.user,
        pass: authConfig.email.smtp.pass
      }
    });
  }

  return smtpTransporter;
};

const sendMail = async ({ to, subject, text, html, debugPayload }) => {
  const from = authConfig.email.from;

  if (hasSendgrid) {
    if (!from) {
      throw new Error('EMAIL_FROM is required when SENDGRID_API_KEY is set');
    }

    await sendgridMail.send({
      to,
      from,
      subject,
      text,
      html
    });
    return;
  }

  const transporter = getSmtpTransporter();
  if (transporter) {
    await transporter.sendMail({
      to,
      from: from || authConfig.email.smtp.user,
      subject,
      text,
      html
    });
    return;
  }

  if (authConfig.environment !== 'production') {
    console.info('[email:fallback]', { to, subject, ...debugPayload });
    return;
  }

  throw new Error(
    'No email provider configured. Set SENDGRID_API_KEY or NODEMAILER_* env vars.'
  );
};

const getOtpPurposeLabel = (purpose) => {
  switch (purpose) {
    case 'verifyEmail':
      return 'Email Verification';
    case 'resetPassword':
      return 'Password Reset';
    case 'login':
      return 'Login Verification';
    case 'changeEmail':
      return 'Email Change Verification';
    default:
      return 'Verification';
  }
};

export const sendOtpEmail = async ({ to, purpose, code }) => {
  const purposeLabel = getOtpPurposeLabel(purpose);
  const subject = `Your ${purposeLabel} OTP`;
  const text = `Your one-time code is ${code}.`;
  const html = `<p>Your one-time code is <strong>${code}</strong>.</p>`;

  await sendMail({
    to,
    subject,
    text,
    html,
    debugPayload: { purpose, code }
  });
};

export const sendOtpEmailFireAndForget = (payload) => {
  Promise.resolve()
    .then(() => sendOtpEmail(payload))
    .catch((error) => {
      console.error('OTP email send failed:', {
        to: payload?.to,
        purpose: payload?.purpose,
        error: error?.message || 'unknown'
      });
    });
};

export const sendInviteEmail = async ({
  to,
  invitedByName,
  workspaceName,
  inviteLinkOrToken,
  roleKey,
  expiresAt
}) => {
  const subject = `You are invited to join ${workspaceName}`;
  const inviterText = invitedByName
    ? `${invitedByName} invited you`
    : 'You were invited';
  const expirationText = expiresAt
    ? new Date(expiresAt).toISOString()
    : 'an upcoming date';
  const text = `${inviterText} to join ${workspaceName} as ${roleKey}. Accept here: ${inviteLinkOrToken}. Expires at: ${expirationText}`;
  const html = `<p>${inviterText} to join <strong>${workspaceName}</strong> as <strong>${roleKey}</strong>.</p><p>Accept here: <a href="${inviteLinkOrToken}">${inviteLinkOrToken}</a></p><p>Expires at: ${expirationText}</p>`;

  await sendMail({
    to,
    subject,
    text,
    html,
    debugPayload: {
      workspaceName,
      inviteLinkOrToken,
      roleKey,
      expiresAt
    }
  });
};
