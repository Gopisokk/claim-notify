/**
 * server/index.js — Express application entry point
 *
 * Claim Notification Relay
 * ─────────────────────────────────────────────────────────────────────────────
 * A portfolio project modeling Guidewire's App Events pattern.
 * When a claim's status changes, an outbound notification is fired to
 * mock external subscribers (CRM, Email/SMS) with exponential-backoff retry.
 *
 * This is NOT Guidewire software and does not connect to any Guidewire instance.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Ports
 *   3001 — the Express server (API + mock endpoints + static frontend)
 *
 * Routes
 *   /api/claims              — Claims API (create, list, status-change, delivery history)
 *   /mock/crm, /mock/notify  — mock external system endpoints
 *   /                        — serves the React frontend
 */

const express = require('express');
const cors = require('cors');
const path = require('path');

// Initialise JSON file store (creates data/claims.json if it doesn't exist)
require('./db');

const claimsRouter = require('./routes/claims');
const mockRouter = require('./routes/mock');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Serve the React frontend's built output (or plain HTML in dev mode)
app.use(express.static(path.join(__dirname, '..', 'client', 'build')));
// Also serve the raw client folder for dev without a build step
app.use(express.static(path.join(__dirname, '..', 'client')));

// ─── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/claims', claimsRouter);
app.use('/mock', mockRouter);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'claim-notification-relay' }));

// ─── SPA fallback ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  // Try build output first, fall back to dev HTML
  const buildIndex = path.join(__dirname, '..', 'client', 'build', 'index.html');
  const devIndex = path.join(__dirname, '..', 'client', 'index.html');
  const fs = require('fs');
  if (fs.existsSync(buildIndex)) {
    res.sendFile(buildIndex);
  } else {
    res.sendFile(devIndex);
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Claim Notification Relay running at http://localhost:${PORT}`);
  console.log(`   API:     http://localhost:${PORT}/api/claims`);
  console.log(`   Mock CRM:    http://localhost:${PORT}/mock/crm`);
  console.log(`   Mock Notify: http://localhost:${PORT}/mock/notify`);
  console.log(`   Dashboard:   http://localhost:${PORT}/\n`);
});

module.exports = app;
