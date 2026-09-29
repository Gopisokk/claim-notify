/**
 * mailer.js — Email notification service
 *
 * Sends real transactional emails when claims are created or their status changes.
 * Uses Nodemailer with two operating modes:
 *
 *   DEMO MODE (default, zero config):
 *     Auto-creates a free Ethereal.email test account on first use.
 *     Emails are captured (not delivered to real inboxes) and can be viewed
 *     at the preview URL printed in the server console.
 *
 *   PRODUCTION MODE (configure via .env):
 *     Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS to use a real mail server
 *     (Gmail, SendGrid, Mailgun, etc.). Emails will be delivered for real.
 *
 * This is NOT part of Guidewire's App Events — it is an additional outbound
 * channel added to this portfolio project.
 */

'use strict';

const nodemailer = require('nodemailer');

let _transporter = null;   // cached transport instance
let _previewMode = false;  // true when using Ethereal test account

// ── Transport factory ────────────────────────────────────────────────────────

async function getTransporter() {
  if (_transporter) return _transporter;

  if (process.env.SMTP_HOST) {
    // ── Real SMTP (configured via .env) ─────────────────────────────────────
    _transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    console.log(`[Mailer] Using real SMTP → ${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 587}`);
    _previewMode = false;

  } else {
    // ── Ethereal test account (zero-config demo mode) ────────────────────────
    const testAccount = await nodemailer.createTestAccount();
    _transporter = nodemailer.createTransport({
      host:   'smtp.ethereal.email',
      port:   587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
    _previewMode = true;
    console.log('\n[Mailer] ══════════════════════════════════════════════════');
    console.log('[Mailer] Demo mode — using Ethereal free test account');
    console.log(`[Mailer] Account : ${testAccount.user}`);
    console.log('[Mailer] View sent emails → https://ethereal.email/messages');
    console.log('[Mailer] (Preview URLs also printed per email below)');
    console.log('[Mailer] ══════════════════════════════════════════════════\n');
  }

  return _transporter;
}

// ── Email helpers ────────────────────────────────────────────────────────────

const FROM = process.env.SMTP_FROM || '"Claim Notification Relay" <noreply@claim-relay.dev>';

function statusColor(status) {
  return { Approved: '#1a1a1a', Rejected: '#1a1a1a', Open: '#555' }[status] || '#555';
}

function statusLabel(status) {
  return { Approved: '✅ Approved', Rejected: '❌ Rejected', Open: '🔵 Open' }[status] || status;
}

function emailHtml({ title, greeting, body, footer }) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e0e0e0;border-radius:6px;overflow:hidden;max-width:580px;">

        <!-- Header -->
        <tr><td style="background:#111;padding:24px 32px;">
          <p style="margin:0;color:#fff;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;">Claim Notification Relay</p>
          <p style="margin:4px 0 0;color:#999;font-size:11px;">Portfolio Demo · Modeled on Guidewire App Events</p>
        </td></tr>

        <!-- Title bar -->
        <tr><td style="background:#f9f9f9;padding:16px 32px;border-bottom:1px solid #e8e8e8;">
          <p style="margin:0;font-size:18px;font-weight:700;color:#111;">${title}</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:28px 32px;">
          <p style="margin:0 0 20px;color:#333;font-size:14px;">${greeting}</p>
          ${body}
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:16px 32px 24px;border-top:1px solid #f0f0f0;">
          <p style="margin:0;font-size:11px;color:#aaa;">${footer}</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function detailRow(label, value) {
  return `<tr>
    <td style="padding:8px 12px;font-size:12px;color:#666;white-space:nowrap;border-bottom:1px solid #f0f0f0;">${label}</td>
    <td style="padding:8px 12px;font-size:12px;color:#111;border-bottom:1px solid #f0f0f0;">${value}</td>
  </tr>`;
}

function detailTable(rows) {
  return `<table width="100%" cellpadding="0" cellspacing="0"
    style="border:1px solid #e8e8e8;border-radius:4px;border-collapse:collapse;margin-bottom:20px;">
    ${rows}
  </table>`;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Send a "claim received" confirmation email when a new claim is created.
 * No-ops silently if the claim has no claimant_email.
 */
async function sendClaimCreatedEmail(claim) {
  if (!claim.claimant_email) return;

  const t = await getTransporter();

  const html = emailHtml({
    title:    'Your Claim Has Been Received',
    greeting: `Dear claimant,`,
    body: `
      <p style="color:#333;font-size:14px;margin:0 0 16px;">
        We have received your insurance claim and it is now being reviewed.
        Here are the details we have on file:
      </p>
      ${detailTable(`
        ${detailRow('Policy Number', `<strong>${claim.policy_number}</strong>`)}
        ${detailRow('Claim ID', `#${claim.id}`)}
        ${detailRow('Description', claim.description)}
        ${detailRow('Status', '<span style="font-weight:600;">🔵 Open — Under Review</span>')}
        ${detailRow('Submitted', new Date(claim.created_at.replace(' ', 'T') + 'Z').toLocaleString())}
      `)}
      <p style="color:#555;font-size:13px;margin:0;">
        You will receive another email when the status of your claim changes.
        Please keep your policy number (<strong>${claim.policy_number}</strong>) handy for any follow-up.
      </p>`,
    footer: `This is an automated message from the Claim Notification Relay (portfolio demo project).
             Do not reply to this email. Claim ID: #${claim.id}`,
  });

  const info = await t.sendMail({
    from:    FROM,
    to:      claim.claimant_email,
    subject: `Claim Received — ${claim.policy_number} [#${claim.id}]`,
    text:    `Your claim ${claim.policy_number} (ID #${claim.id}) has been received and is under review.\nDescription: ${claim.description}\n\nYou will be notified when the status changes.`,
    html,
  });

  console.log(`[Mailer] ✉  Claim-created email → ${claim.claimant_email} (msg: ${info.messageId})`);
  if (_previewMode) {
    console.log(`[Mailer] 🔗 Preview: ${nodemailer.getTestMessageUrl(info)}`);
  }
}

/**
 * Send a status-change notification email when a claim is Approved or Rejected.
 * No-ops silently if the claim has no claimant_email.
 */
async function sendStatusChangedEmail(claim) {
  if (!claim.claimant_email) return;

  const t = await getTransporter();

  const isApproved = claim.status === 'Approved';
  const isRejected = claim.status === 'Rejected';

  // Only send for terminal status changes, not for Open (re-opened)
  if (!isApproved && !isRejected) return;

  const subjectPrefix = isApproved ? '✅ Claim Approved' : '❌ Claim Update';

  const html = emailHtml({
    title:    isApproved ? 'Your Claim Has Been Approved' : 'Update on Your Claim',
    greeting: `Dear claimant,`,
    body: `
      <p style="color:#333;font-size:14px;margin:0 0 16px;">
        ${isApproved
          ? 'We are pleased to inform you that your insurance claim has been <strong>approved</strong>. Our team will be in touch regarding next steps and settlement details.'
          : 'We have completed our review of your insurance claim. After careful consideration, we are unable to approve this claim at this time. Please contact us if you have any questions or wish to discuss this decision.'}
      </p>
      ${detailTable(`
        ${detailRow('Policy Number', `<strong>${claim.policy_number}</strong>`)}
        ${detailRow('Claim ID', `#${claim.id}`)}
        ${detailRow('Description', claim.description)}
        ${detailRow('New Status', `<strong style="color:${statusColor(claim.status)}">${statusLabel(claim.status)}</strong>`)}
      `)}
      ${isApproved
        ? '<p style="color:#555;font-size:13px;margin:0;">Our claims team will contact you within 2-3 business days with settlement details. Thank you for your patience.</p>'
        : '<p style="color:#555;font-size:13px;margin:0;">If you believe this decision is incorrect, you have the right to appeal. Please contact our claims department within 30 days.</p>'}`,
    footer: `This is an automated message from the Claim Notification Relay (portfolio demo project).
             Do not reply to this email. Claim ID: #${claim.id}`,
  });

  const info = await t.sendMail({
    from:    FROM,
    to:      claim.claimant_email,
    subject: `${subjectPrefix} — ${claim.policy_number} [#${claim.id}]`,
    text:    `Your claim ${claim.policy_number} (ID #${claim.id}) has been updated.\nNew status: ${claim.status}\nDescription: ${claim.description}`,
    html,
  });

  console.log(`[Mailer] ✉  Status-change email → ${claim.claimant_email} | status=${claim.status} (msg: ${info.messageId})`);
  if (_previewMode) {
    console.log(`[Mailer] 🔗 Preview: ${nodemailer.getTestMessageUrl(info)}`);
  }
}

module.exports = { sendClaimCreatedEmail, sendStatusChangedEmail };
