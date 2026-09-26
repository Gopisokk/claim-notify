/**
 * routes/claims.js — Claims API
 *
 * Endpoints:
 *   POST   /api/claims               — create a new claim (status defaults to "Open")
 *   GET    /api/claims               — list all claims (with latest delivery status per channel)
 *   PATCH  /api/claims/:id/status    — update status; triggers outbound notification flow
 *   GET    /api/claims/:id/notifications — delivery history for one claim
 *   POST   /api/claims/:id/notifications/:channel/replay — re-trigger a Failed delivery (Failed only)
 *
 * Note: there is no DELETE and no arbitrary field update — PATCH /status is the
 * only mutation beyond creation, which matches the project's scope of modeling
 * the App Events "status-change triggers outbound event" pattern.
 *
 * On every PATCH /api/claims/:id/status the system fires outbound notifications
 * to both mock channels (crm and notify). This mirrors how Guidewire's App Events
 * mechanism publishes a business event (e.g. "ClaimStatusChanged") outward to
 * subscribed external systems — without using any Guidewire SDK or Integration Gateway.
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { triggerNotifications, notifyChannel, buildEventPayload } = require('../notifier');

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

// ─── GET /api/claims/:id/notifications — delivery history ────────────────────
// Returns one record per trigger-event per channel. Attempt count and final
// status are updated in place on the same record (not one row per attempt).
router.get('/:id/notifications', (req, res) => {
  const { id } = req.params;

  const claim = db.getClaim(id);
  if (!claim) return res.status(404).json({ error: 'Claim not found.' });

  const notifications = db.getNotificationsByClaimId(id);

  res.json({ claim, notifications });
});

// ─── POST /api/claims/:id/notifications/:channel/replay ──────────────────────
// Scope: re-triggers delivery for one channel only, and only when its current
// status is "Failed". Creates a fresh delivery record (does not mutate the
// failed one). Not available for Sent or Retrying channels.
router.post('/:id/notifications/:channel/replay', async (req, res) => {
  const { id, channel } = req.params;

  const VALID_CHANNELS = ['crm', 'notify'];
  if (!VALID_CHANNELS.includes(channel)) {
    return res.status(400).json({ error: `channel must be one of: ${VALID_CHANNELS.join(', ')}` });
  }

  const claim = db.getClaim(id);
  if (!claim) return res.status(404).json({ error: 'Claim not found.' });

  // Guard: only replay a Failed channel
  const latest = db.getLatestNotificationsByClaimId(id);
  if (!latest[channel] || latest[channel].status !== 'Failed') {
    return res.status(409).json({
      error: `Channel "${channel}" is not in Failed state — replay is only available for failed deliveries.`,
    });
  }

  res.json({ replaying: true, claim_id: Number(id), channel });

  // Fire-and-forget: reuse notifyChannel (creates a fresh notification record)
  const eventPayload = buildEventPayload(claim);
  console.log(`[Notifier] Replaying channel=${channel} for claim ${id}`);
  notifyChannel(claim.id, channel, eventPayload).catch(err =>
    console.error(`[Notifier] Replay error for claim ${id} channel ${channel}:`, err)
  );
});

module.exports = router;
