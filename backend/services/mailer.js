/**
 * Outbound email for password resets.
 *
 * Delivery is optional by design. BOOST usually runs on one PC inside a small
 * office with no mail server of its own, so when SMTP is not configured the
 * message is written to the server console instead — the reset still works,
 * an administrator just passes the link on to the user.
 *
 * Configure SMTP_HOST (plus the rest) in .env to send real mail. See .env.example.
 */
"use strict";

let nodemailer = null;
try {
  // Optional dependency: only required when SMTP settings are present.
  nodemailer = require("nodemailer");
} catch (err) {
  /* falls back to console delivery */
}

function smtpConfig() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;

  const config = {
    host,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true",
  };

  if (process.env.SMTP_USER) {
    config.auth = { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || "" };
  }

  return config;
}

function fromAddress() {
  return process.env.MAIL_FROM || process.env.SMTP_USER || "no-reply@boost.local";
}

/**
 * Sends a password reset email.
 *
 * @param {object} o
 * @param {string} o.to
 * @param {string} o.fullName
 * @param {string} o.resetUrl
 * @param {number} o.expiresMinutes
 * @returns {Promise<{ delivered: "smtp" | "console" }>}
 */
async function sendPasswordReset({ to, fullName, resetUrl, expiresMinutes }) {
  const config = smtpConfig();
  const greeting = fullName ? `Hi ${fullName},` : "Hi,";
  const body =
    `${greeting}\n\n` +
    `We received a request to reset the password for your BOOST account.\n\n` +
    `Open this link to choose a new password:\n${resetUrl}\n\n` +
    `The link expires in ${expiresMinutes} minutes and can only be used once.\n` +
    `If you did not request this, you can ignore this email — nothing has changed.\n`;

  if (!config || !nodemailer) {
    if (config && !nodemailer) {
      console.warn("[mailer] SMTP_HOST is set but nodemailer is not installed — falling back to console delivery.");
    }
    console.log(
      `\n[mailer] SMTP not configured — password reset for ${to}:\n` +
        `  ${resetUrl}\n` +
        `  (expires in ${expiresMinutes} minutes)\n`
    );
    return { delivered: "console" };
  }

  const transporter = nodemailer.createTransport(config);

  await transporter.sendMail({
    from: fromAddress(),
    to,
    subject: "Reset your BOOST password",
    text: body,
    html:
      `<p>${escapeHtml(greeting)}</p>` +
      "<p>We received a request to reset the password for your BOOST account.</p>" +
      `<p><a href="${escapeHtml(resetUrl)}" style="background:#4a5fd1;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">Choose a new password</a></p>` +
      `<p style="color:#6b7280;font-size:13px">Or paste this link into your browser:<br>${escapeHtml(resetUrl)}</p>` +
      `<p style="color:#6b7280;font-size:13px">The link expires in ${expiresMinutes} minutes and can only be used once. If you did not request this, ignore this email — nothing has changed.</p>`,
  });

  return { delivered: "smtp" };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

module.exports = { sendPasswordReset, smtpConfigured: () => Boolean(smtpConfig()) };