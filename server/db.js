/**
 * db.js — Pure-JavaScript JSON file store
 *
 * Replaces better-sqlite3 (which requires a native C++ build) with a zero-
 * dependency, file-persisted JSON datastore.  The public API intentionally
 * mirrors the better-sqlite3 synchronous surface so the route files stay
 * unchanged.
 *
 * Data layout inside data/claims.json:
 *   {
 *     "_seqs": { "claims": <int>, "notifications": <int> },
 *     "claims": [ { id, policy_number, description, status, created_at } … ],
 *     "notifications": [ { id, claim_id, channel, status, attempt_count,
 *                          last_attempt_at, response_detail, created_at } … ]
 *   }
 *
 * Thread-safety: Node.js is single-threaded; synchronous fs calls are fine
 * for this demo scale.  Every mutating operation calls save() immediately.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const DB_PATH  = path.join(__dirname, '..', 'data', 'claims.json');
const DATA_DIR = path.dirname(DB_PATH);

// ── Bootstrap ─────────────────────────────────────────────────────────────────

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/** @type {{ _seqs: Record<string,number>, claims: object[], notifications: object[] }} */
let store = { _seqs: { claims: 0, notifications: 0 }, claims: [], notifications: [] };

if (fs.existsSync(DB_PATH)) {
  try {
    store = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    // Back-fill any missing seq keys after a partial load
    store._seqs = store._seqs || {};
    store._seqs.claims        = store._seqs.claims        || (store.claims.length        ? Math.max(...store.claims.map(r => r.id))        : 0);
    store._seqs.notifications = store._seqs.notifications || (store.notifications.length ? Math.max(...store.notifications.map(r => r.id)) : 0);
  } catch (e) {
    console.error('[DB] Could not load claims.json, starting with empty store:', e.message);
  }
}

function save() {
  fs.writeFileSync(DB_PATH, JSON.stringify(store, null, 2));
}

function now() {
  // SQLite datetime('now') format: "YYYY-MM-DD HH:MM:SS"
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function nextId(table) {
  store._seqs[table] = (store._seqs[table] || 0) + 1;
  return store._seqs[table];
}

// ── Public API ────────────────────────────────────────────────────────────────
// These methods are consumed by routes/claims.js and seed.js.

/**
 * Thin wrapper that mimics better-sqlite3's db.prepare(sql).run(…) and
 * db.prepare(sql).get(…) / .all(…) interface.
 *
 * We parse a small subset of SQL keywords to route to the right store method.
 * For a demo project this is far simpler than embedding a real SQL engine.
 */

const db = {

  // ── claims ─────────────────────────────────────────────────────────────────

  /** Insert a new claim; returns { lastInsertRowid } */
  insertClaim(policy_number, description) {
    const id = nextId('claims');
    const row = { id, policy_number, description, status: 'Open', created_at: now() };
    store.claims.push(row);
    save();
    return { lastInsertRowid: id };
  },

  /** Return one claim by id, or undefined */
  getClaim(id) {
    return store.claims.find(c => c.id === Number(id));
  },

  /** Return all claims ordered by created_at DESC */
  getAllClaims() {
    return [...store.claims].sort((a, b) => b.created_at.localeCompare(a.created_at));
  },

  /** Update claim status; returns the updated row */
  updateClaimStatus(id, status) {
    const claim = store.claims.find(c => c.id === Number(id));
    if (!claim) return undefined;
    claim.status = status;
    save();
    return claim;
  },

  // ── notifications ──────────────────────────────────────────────────────────

  /** Insert a new notification record; returns { lastInsertRowid } */
  insertNotification(claim_id, channel) {
    const id = nextId('notifications');
    const row = {
      id,
      claim_id: Number(claim_id),
      channel,
      status: 'Retrying',
      attempt_count: 0,
      last_attempt_at: null,
      response_detail: null,
      created_at: now(),
    };
    store.notifications.push(row);
    save();
    return { lastInsertRowid: id };
  },

  /** Update an existing notification record */
  updateNotification(id, { status, attempt_count, response_detail }) {
    const notif = store.notifications.find(n => n.id === Number(id));
    if (!notif) return;
    notif.status          = status;
    notif.attempt_count   = attempt_count;
    notif.last_attempt_at = now();
    notif.response_detail = response_detail;
    save();
  },

  /** Return all notifications for a claim, ordered by id ASC */
  getNotificationsByClaimId(claim_id) {
    return store.notifications
      .filter(n => n.claim_id === Number(claim_id))
      .sort((a, b) => a.id - b.id);
  },

  /**
   * Return the latest notification per channel for a claim (for the table badges).
   * Returns { crm?: row, notify?: row }
   */
  getLatestNotificationsByClaimId(claim_id) {
    const rows = store.notifications
      .filter(n => n.claim_id === Number(claim_id))
      .sort((a, b) => b.id - a.id); // newest first

    const byChannel = {};
    for (const row of rows) {
      if (!byChannel[row.channel]) byChannel[row.channel] = row;
    }
    return byChannel;
  },

  // ── prepare() shim — keeps routes/claims.js untouched ─────────────────────
  //
  // The routes call db.prepare(sql).run(…), .get(…), .all(…) and
  // db.prepare(sql).run(…).lastInsertRowid.
  // We map each recognised SQL pattern to the right store method above.

  prepare(sql) {
    const s = sql.replace(/\s+/g, ' ').trim();

    return {
      // ── run() ──────────────────────────────────────────────────────────────
      run(...args) {
        // INSERT INTO claims
        if (/^INSERT INTO claims/i.test(s)) {
          return db.insertClaim(args[0], args[1]);
        }
        // UPDATE claims SET status
        if (/^UPDATE claims SET status/i.test(s)) {
          db.updateClaimStatus(args[1], args[0]);
          return { changes: 1 };
        }
        // INSERT INTO notifications
        if (/^INSERT INTO notifications/i.test(s)) {
          return db.insertNotification(args[0], args[1]);
        }
        // UPDATE notifications SET status
        if (/^UPDATE notifications/i.test(s)) {
          // args order: status, attempt_count, last_attempt_at (skipped), response_detail, id
          // Our SQL: SET status=?, attempt_count=?, last_attempt_at=…, response_detail=? WHERE id=?
          db.updateNotification(args[4], {
            status: args[0],
            attempt_count: args[1],
            response_detail: args[3],
          });
          return { changes: 1 };
        }
        console.warn('[DB] prepare().run() — unrecognised SQL:', s.slice(0, 80));
        return {};
      },

      // ── get() ──────────────────────────────────────────────────────────────
      get(...args) {
        if (/SELECT \* FROM claims WHERE id/i.test(s)) {
          return db.getClaim(args[0]);
        }
        if (/SELECT COUNT\(\*\)/i.test(s)) {
          return { count: store.claims.length };
        }
        console.warn('[DB] prepare().get() — unrecognised SQL:', s.slice(0, 80));
        return undefined;
      },

      // ── all() ──────────────────────────────────────────────────────────────
      all(...args) {
        if (/SELECT \* FROM claims ORDER BY/i.test(s)) {
          return db.getAllClaims();
        }
        if (/SELECT channel, status, attempt_count FROM notifications WHERE claim_id/i.test(s)) {
          // Newest first (route uses ORDER BY id DESC)
          return db.getNotificationsByClaimId(args[0]).reverse();
        }
        if (/SELECT \* FROM notifications WHERE claim_id/i.test(s)) {
          return db.getNotificationsByClaimId(args[0]);
        }
        console.warn('[DB] prepare().all() — unrecognised SQL:', s.slice(0, 80));
        return [];
      },
    };
  },

  // ── exec() — used for DDL in db init (no-op here; structure is implied) ────
  exec() { /* schema is implicit in the JSON structure */ },

  // ── pragma() — no-op ───────────────────────────────────────────────────────
  pragma() {},

  // ── transaction() — wraps a function; for JSON writes atomicity is "free" ──
  transaction(fn) {
    return (...args) => fn(...args); // JSON writes are sync, so always atomic
  },
};

module.exports = db;
