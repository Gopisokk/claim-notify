# Claim Notification Relay

A portfolio/resume project that demonstrates outbound event-driven notification
architecture, **modeled on Guidewire's App Events pattern**.

> **⚠ What this project IS and IS NOT**
>
> - ✅ An independent Node.js + Express application built from scratch.
> - ✅ Modeled on Guidewire's **App Events** pattern — the mechanism by which
>   Guidewire InsuranceSuite publishes outbound business events (e.g. a claim
>   status change) to external subscribers.
> - ❌ **Not** Guidewire software.
> - ❌ **Not** connected to any Guidewire instance.
> - ❌ **Not** an implementation of Guidewire's Cloud API or Integration Gateway.
> - ❌ Does **not** use Gosu, any Guidewire SDK, or any Guidewire-licensed code.

---

## What it does

When a claim's status changes (`Open → Approved`, etc.), the relay fires
outbound HTTP notifications to two mock external systems:

| Channel | Behavior |
|---------|----------|
| **`/mock/crm`** | Simulates a CRM (e.g. Salesforce) — always succeeds |
| **`/mock/notify`** | Simulates an Email/SMS gateway — randomly fails ~20% of requests to make retry logic observable |

Failed deliveries are retried up to **3 times** with exponential backoff
(**1 s → 2 s → 4 s**). Every attempt is persisted to the JSON file store and shown live in
the dashboard.

---

## How this maps to Guidewire's App Events pattern

Guidewire InsuranceSuite's **App Events** mechanism publishes structured
business events (e.g. `ClaimStatusChanged`) outward to registered external
subscribers whenever a core-system state change occurs — without the external
system needing to poll. This project replicates that outbound fan-out model:
a single internal state change (claim status update) triggers concurrent HTTP
deliveries to multiple subscriber endpoints, with retry semantics for transient
failures. The structure of the event payload (`event_type`, `occurred_at`,
`claim` object) mirrors the kind of envelope a real App Event body would carry.

---

## Architecture

```
  PATCH /api/claims/:id/status  ← curl / Dashboard button
          │
          ▼
  ┌─────────────────────┐
  │   Claim Service     │  Updates JSON store, responds 200 immediately
  │  (Express + JSON)   │
  └──────────┬──────────┘
             │  async — models Guidewire App Events outbound publish
             │
      ┌──────┴──────┐
      ▼             ▼
 ┌──────────┐  ┌──────────────────────────────┐
 │ /mock/crm│  │        /mock/notify          │
 │ Always ✓ │  │  ~20% failure · retry ×3     │
 └──────────┘  │  backoff: 1 s → 2 s → 4 s   │
               └──────────────────────────────┘

  All attempt records → data/claims.json
  Dashboard polls every 3 s to show live status
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Node.js 18+ · Express 4 |
| Data store | Lightweight JSON file store (`data/claims.json`) — chosen to avoid native build dependencies for a portfolio demo |
| Frontend | Plain React 18 (CDN, no build step) served by Express |
| Mock endpoints | Express routes in the same process |

---

## Local setup

### Prerequisites
- Node.js 18 or later
- npm

### Install & run

```bash
# 1. Install dependencies
npm install

# 2. Seed the JSON store with 8 demo claims
npm run seed

# 3. Start the server (auto-reloads on file changes)
npm run dev

# — or without auto-reload —
npm start
```

Open **http://localhost:3001** in your browser.

The `data/` directory is created automatically; it contains `claims.json` (the JSON file store).

---

## Demo walkthrough

### Sample curl commands

**Create a claim:**
```bash
curl -s -X POST http://localhost:3001/api/claims \
  -H "Content-Type: application/json" \
  -d '{"policy_number":"POL-DEMO-01","description":"Test claim for demo"}' | jq
```

**List all claims:**
```bash
curl -s http://localhost:3001/api/claims | jq
```

**Trigger a status change (fires notifications):**
```bash
curl -s -X PATCH http://localhost:3001/api/claims/1/status \
  -H "Content-Type: application/json" \
  -d '{"status":"Approved"}' | jq
```

**Check notification history for claim 1:**
```bash
curl -s http://localhost:3001/api/claims/1/notifications | jq
```

### Observing retry behavior

The `/mock/notify` endpoint fails **~20% of the time** (randomly). To force a
visible retry in the server logs, change a claim's status several times — you
will eventually see:

```
[Notifier] claim=1 channel=notify attempt=1/3
[Mock Notify] Simulated transient failure (20% chance)
[Notifier] Retrying in 1000ms…
[Notifier] claim=1 channel=notify attempt=2/3
[Notifier] claim=1 channel=notify → Sent (attempt 2)
```

The dashboard will show the badge cycling through **Retrying → Sent** in
real-time (polls every 3 seconds).

---

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/claims` | Create a claim |
| `GET`  | `/api/claims` | List all claims (with latest notification status) |
| `PATCH`| `/api/claims/:id/status` | Update status; triggers notification relay |
| `GET`  | `/api/claims/:id/notifications` | Full notification history for one claim |
| `POST` | `/api/claims/:id/notifications/:channel/replay` | Re-trigger delivery for a Failed channel only |
| `POST` | `/mock/crm` | Mock CRM endpoint (always 200) |
| `POST` | `/mock/notify` | Mock Email/SMS endpoint (~20% 503) |
| `GET`  | `/health` | Health check |

---

## Data store structure

Data is persisted to `data/claims.json` as a single JSON file with two
arrays and an auto-increment sequence counter. No SQL engine is running —
reads and writes use Node's built-in `fs` module (synchronous, safe at
demo scale since Node.js is single-threaded).

```json
{
  "_seqs": { "claims": 8, "notifications": 12 },
  "claims": [
    {
      "id": 1,
      "policy_number": "POL-2024-001",
      "description": "Water damage to living room ceiling following pipe burst",
      "status": "Open",
      "created_at": "2026-09-26 08:23:06"
    }
  ],
  "notifications": [
    {
      "id": 1,
      "claim_id": 1,
      "channel": "crm",
      "status": "Sent",
      "attempt_count": 1,
      "last_attempt_at": "2026-09-26 08:23:51",
      "response_detail": "{\"channel\":\"crm\",\"result\":\"accepted\"}",
      "created_at": "2026-09-26 08:23:51"
    }
  ]
}
```

**Field reference:**

| Field | Values |
|-------|--------|
| `claims.status` | `Open` · `Approved` · `Rejected` |
| `notifications.channel` | `crm` · `notify` |
| `notifications.status` | `Sent` · `Retrying` · `Failed` |

---

## Project structure

```
claim-notification-relay/
├── package.json
├── README.md
├── data/
│   └── claims.json        ← auto-created JSON file store (git-ignored)
├── server/
│   ├── index.js           ← Express app entry point
│   ├── db.js              ← Pure-JS JSON file store (no native deps)
│   ├── notifier.js        ← Notification relay engine (retry logic)
│   ├── seed.js            ← Demo data seeder
│   └── routes/
│       ├── claims.js      ← CRUD + status-change endpoint
│       └── mock.js        ← /mock/crm and /mock/notify
└── client/
    └── index.html         ← Single-page React dashboard (CDN React, no build)
```

---

## Guidewire terminology note

> **Guidewire InsuranceSuite** (PolicyCenter · ClaimCenter · BillingCenter) is a
> property & casualty insurance core platform. It has three distinct integration
> mechanisms: **Cloud API** (inbound REST), **App Events** (outbound pub/sub),
> and **Integration Gateway** (Apache Camel-based mediation). This project
> models only the **App Events** outbound pattern and has no connection to any
> Guidewire product or license.
