/**
 * seed.js — Demo data seeder
 *
 * Inserts 8 sample claims into the JSON store so the dashboard is populated
 * on first launch without needing manual API calls.
 *
 * Run: node server/seed.js
 *
 * Safe to run multiple times (checks for existing data first).
 */

const db = require('./db');

const DEMO_CLAIMS = [
  { policy_number: 'POL-2024-001', description: 'Water damage to living room ceiling following pipe burst',                   status: 'Open'     },
  { policy_number: 'POL-2024-002', description: 'Rear-end collision on I-95; vehicle requires bumper and trunk repair',       status: 'Approved' },
  { policy_number: 'POL-2024-003', description: 'Theft of personal electronics from unattended vehicle',                      status: 'Rejected' },
  { policy_number: 'POL-2024-004', description: 'Hail damage to roof and two skylights after severe storm',                   status: 'Open'     },
  { policy_number: 'POL-2024-005', description: 'Slip-and-fall injury in insured commercial property lobby',                  status: 'Approved' },
  { policy_number: 'POL-2024-006', description: 'Kitchen fire caused by electrical fault; structural damage reported',        status: 'Open'     },
  { policy_number: 'POL-2024-007', description: 'Vandalism to parked vehicle; keyed doors and broken mirrors',                status: 'Rejected' },
  { policy_number: 'POL-2024-008', description: 'Flooding from overflowing river; basement and ground floor affected',        status: 'Approved' },
];

function seed() {
  const existing = db.getAllClaims();
  if (existing.length > 0) {
    console.log(`ℹ  Database already contains ${existing.length} claim(s). Skipping seed.`);
    console.log('   To reseed, delete data/claims.json and run again.');
    process.exit(0);
  }

  for (const claim of DEMO_CLAIMS) {
    const { lastInsertRowid: claimId } = db.insertClaim(claim.policy_number, claim.description);

    // Set non-Open status directly (insertClaim always starts at 'Open')
    if (claim.status !== 'Open') {
      db.updateClaimStatus(claimId, claim.status);
    }

    // Add realistic notification history for non-Open claims
    // (they've already gone through a status-change event)
    if (claim.status !== 'Open') {
      // CRM always succeeds
      const { lastInsertRowid: crmId } = db.insertNotification(claimId, 'crm');
      db.updateNotification(crmId, {
        status:          'Sent',
        attempt_count:   1,
        response_detail: JSON.stringify({ channel: 'crm', result: 'accepted', message: 'CRM record updated successfully.' }),
      });

      // Notify channel: Approved claims succeeded on attempt 2; Rejected claims failed all 3
      const { lastInsertRowid: notifyId } = db.insertNotification(claimId, 'notify');

      if (claim.status === 'Approved') {
        db.updateNotification(notifyId, {
          status:          'Sent',
          attempt_count:   2,
          response_detail: JSON.stringify({ channel: 'notify', result: 'accepted', message: 'Email/SMS dispatched.' }),
        });
      } else {
        // Rejected: simulates exhausted retries
        db.updateNotification(notifyId, {
          status:          'Failed',
          attempt_count:   3,
          response_detail: 'All 3 attempts failed. Last error: HTTP 503: Service temporarily unavailable (simulated failure).',
        });
      }
    }
  }

  const count = db.getAllClaims().length;
  console.log(`✅ Seeded ${count} demo claims into data/claims.json`);
  console.log('   Start the server: npm run dev');
  console.log('   Then open:        http://localhost:3001');
}

seed();
