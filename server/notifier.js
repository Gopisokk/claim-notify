/**
 * notifier.js — Notification relay engine
 *
 * Implements the outbound delivery flow that fires when a claim's status changes,
 * modeling the App Events pattern of publishing a business event to external
 * subscribers. Delivery is best-effort: up to MAX_ATTEMPTS HTTP POSTs per channel
 * with exponential backoff. There is no durable queue — if the Node process
 * crashes mid-retry the in-flight delivery is lost. For a portfolio demo this
 * is intentional; a production system would use a persistent job queue.
 *
 * Implementation details:
 *   - Two channels are always notified concurrently: "crm" and "notify"
 *   - Each channel gets up to MAX_ATTEMPTS total tries (1 initial + 2 retries = 3)
 *   - Retry delays follow an exponential backoff: 1 s → 2 s → 4 s
 *   - One delivery record per trigger-event per channel is written to the store;
 *     attempt_count and status are updated in place (not one row per attempt)
 *   - Final status is "Sent" (any attempt succeeded) or "Failed" (all exhausted)
 *
 * Note: fetch calls target the local mock endpoints in the same Express process.
 * In a real App Events integration these would be external HTTPS webhook URLs.
 */

const fetch = require('node-fetch');
const db    = require('./db');

const BASE_URL = 'http://localhost:3001';

// Retry configuration
const MAX_ATTEMPTS      = 3;
const BACKOFF_DELAYS_MS = [1000, 2000, 4000]; // 1 s, 2 s, 4 s

/** Pauses execution for `ms` milliseconds. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends one HTTP POST to a mock channel endpoint.
 * Throws on HTTP error (non-2xx) or network error.
 */
async function callChannel(channel, payload) {
  const url      = `${BASE_URL}/mock/${channel}`;
  const response = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });

  const body = await response.json();

  if (!response.ok) {
    const err       = new Error(`HTTP ${response.status}: ${body.message || 'Unknown error'}`);
    err.responseBody = body;
    throw err;
  }

  return body;
}

/**
 * Attempts to deliver the event payload to a single channel with exponential
 * backoff retry.  Updates the notifications store after every attempt.
 *
 * @param {number} claimId
 * @param {string} channel   — "crm" or "notify"
 * @param {object} eventPayload
 */
async function notifyChannel(claimId, channel, eventPayload) {
  // Create the initial notification record (status = Retrying, attempt_count = 0)
  const { lastInsertRowid: notifId } = db.insertNotification(claimId, channel);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`[Notifier] claim=${claimId} channel=${channel} attempt=${attempt}/${MAX_ATTEMPTS}`);

    try {
      const responseBody = await callChannel(channel, eventPayload);

      // ── Success ────────────────────────────────────────────────────────────
      db.updateNotification(notifId, {
        status:          'Sent',
        attempt_count:   attempt,
        response_detail: JSON.stringify(responseBody),
      });

      console.log(`[Notifier] claim=${claimId} channel=${channel} → Sent (attempt ${attempt})`);
      return;

    } catch (err) {
      const detail = err.responseBody
        ? JSON.stringify(err.responseBody)
        : err.message;

      console.warn(
        `[Notifier] claim=${claimId} channel=${channel} attempt=${attempt} FAILED: ${err.message}`
      );

      if (attempt < MAX_ATTEMPTS) {
        // ── Retrying ─────────────────────────────────────────────────────────
        db.updateNotification(notifId, {
          status:          'Retrying',
          attempt_count:   attempt,
          response_detail: `Attempt ${attempt} failed: ${detail}`,
        });

        const delay = BACKOFF_DELAYS_MS[attempt - 1];
        console.log(`[Notifier] Retrying in ${delay}ms…`);
        await sleep(delay);
      } else {
        // ── All attempts exhausted ────────────────────────────────────────────
        db.updateNotification(notifId, {
          status:          'Failed',
          attempt_count:   attempt,
          response_detail: `All ${MAX_ATTEMPTS} attempts failed. Last error: ${detail}`,
        });

        console.error(
          `[Notifier] claim=${claimId} channel=${channel} → Failed after ${MAX_ATTEMPTS} attempts`
        );
      }
    }
  }
}

/**
 * Builds the outbound event envelope for a claim status change.
 * The structure (event_type, occurred_at, claim object) is loosely inspired
 * by the kind of payload a real App Events subscription would receive, but
 * does NOT implement Guidewire's actual CloudEvents-based App Events schema.
 *
 * @param {object} claim
 * @returns {object}
 */
function buildEventPayload(claim) {
  return {
    event_type:  'ClaimStatusChanged',
    occurred_at: new Date().toISOString(),
    claim: {
      id:            claim.id,
      policy_number: claim.policy_number,
      description:   claim.description,
      new_status:    claim.status,
    },
  };
}

/**
 * Entry point: called on every claim status change.
 * Fires notifications to both channels concurrently.
 *
 * @param {object} claim — the updated claim row
 */
async function triggerNotifications(claim) {
  const eventPayload = buildEventPayload(claim);

  console.log(
    `[Notifier] Firing ClaimStatusChanged event for claim ${claim.id} → status="${claim.status}"`
  );

  // Notify both channels concurrently; errors are handled inside notifyChannel
  await Promise.all([
    notifyChannel(claim.id, 'crm',    eventPayload),
    notifyChannel(claim.id, 'notify', eventPayload),
  ]);
}

module.exports = { triggerNotifications, notifyChannel, buildEventPayload };
