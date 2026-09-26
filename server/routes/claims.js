/**
 * routes/claims.js — CRUD routes for insurance claims
 *
 * Endpoints:
 *   POST   /api/claims               — create a new claim (status = "Open")
 *   GET    /api/claims               — list all claims (with latest notification status)
 *   PATCH  /api/claims/:id/status    — update status; triggers notification flow
 *   GET    /api/claims/:id/notifications — notification history for one claim
 *
 * On every PATCH /api/claims/:id/status the system fires outbound notifications
 * to both mock channels (crm and notify).  This mirrors how Guidewire's
 * App Events mechanism publishes a business event (e.g. "ClaimStatusChanged")
 * outward to subscribed external systems — without using any Guidewire SDK or
 * Integration Gateway.
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { triggerNotifications } = require('../notifier');

// ─── POST /api/claims ─────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const { policy_number, description } = req.body;

  if (!policy_number || !description) {
    return res.status(400).json({ error: 'policy_number and description are required.' });
  }

  const { lastInsertRowid } = db.insertClaim(policy_number, description);
  const claim = db.getClaim(lastInsertRowid);

  res.status(201).json(claim);
});

// ─── GET /api/claims ──────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const claims = db.getAllClaims();

  // Attach the most recent notification status per channel to each claim row
  const enriched = claims.map(claim => ({
    ...claim,
    notification_status: db.getLatestNotificationsByClaimId(claim.id),
  }));

  res.json(enriched);
});

// ─── PATCH /api/claims/:id/status ────────────────────────────────────────────
router.patch('/:id/status', async (req, res) => {
  const { id }     = req.params;
  const { status } = req.body;

  const VALID_STATUSES = ['Open', 'Approved', 'Rejected'];
  if (!status || !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  const claim = db.getClaim(id);
  if (!claim) return res.status(404).json({ error: 'Claim not found.' });

  const updatedClaim = db.updateClaimStatus(id, status);

  // Respond immediately; notification flow runs in the background
  res.json(updatedClaim);

  // Fire-and-forget: trigger outbound notifications asynchronously
  // This models the App Events "publish on status change" behavior
  triggerNotifications(updatedClaim).catch(err =>
    console.error(`[Notifier] Unhandled error for claim ${id}:`, err)
  );
});

// ─── GET /api/claims/:id/notifications ───────────────────────────────────────
router.get('/:id/notifications', (req, res) => {
  const { id } = req.params;

  const claim = db.getClaim(id);
  if (!claim) return res.status(404).json({ error: 'Claim not found.' });

  const notifications = db.getNotificationsByClaimId(id);

  res.json({ claim, notifications });
});

module.exports = router;
