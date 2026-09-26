/**
 * routes/mock.js — Mock external system endpoints
 *
 * These simulate the external subscribers that would receive outbound
 * App Events notifications in a real Guidewire integration scenario:
 *
 *   POST /mock/crm    — mock CRM system; always succeeds (logs payload)
 *   POST /mock/notify — mock Email/SMS gateway; randomly fails ~20% of calls
 *                       (Math.random() < 0.2) to demonstrate retry behavior
 *
 * In a real Guidewire App Events setup, these endpoints would be registered
 * as webhook subscribers.  Here they run in the same Express process for
 * simplicity and demo purposes.
 */

const express = require('express');
const router = express.Router();

// ─── POST /mock/crm ────────────────────────────────────────────────────────────
// Simulates a CRM (e.g. Salesforce) receiving a claim-status-change event.
// Always returns 200 to demonstrate the "happy path" channel.
router.post('/crm', (req, res) => {
  const payload = req.body;
  console.log('[Mock CRM] Received notification payload:', JSON.stringify(payload, null, 2));

  res.status(200).json({
    channel: 'crm',
    result: 'accepted',
    message: 'CRM record updated successfully.',
    received_at: new Date().toISOString(),
  });
});

// ─── POST /mock/notify ─────────────────────────────────────────────────────────
// Simulates an Email/SMS gateway receiving a claim-status-change event.
// Randomly fails ~20% of the time to make retry logic observable and demonstrable.
router.post('/notify', (req, res) => {
  const payload = req.body;
  console.log('[Mock Notify] Received notification payload:', JSON.stringify(payload, null, 2));

  // Inject ~20% transient failure to demonstrate exponential backoff retry
  if (Math.random() < 0.2) {
    console.warn('[Mock Notify] Simulated transient failure (20% chance)');
    return res.status(503).json({
      channel: 'notify',
      result: 'error',
      message: 'Service temporarily unavailable (simulated failure).',
      failed_at: new Date().toISOString(),
    });
  }

  res.status(200).json({
    channel: 'notify',
    result: 'accepted',
    message: 'Email/SMS notification dispatched successfully.',
    received_at: new Date().toISOString(),
  });
});

module.exports = router;
