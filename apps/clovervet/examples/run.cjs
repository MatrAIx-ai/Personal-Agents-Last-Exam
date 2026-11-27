'use strict';

// Standalone local CloverVet boarding-clearance & vaccination event example (no runtime imports).
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const plugin = require('../plugin.cjs');

const root = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/minimal.json'), 'utf8'));
const binding = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/binding.json'), 'utf8'));
const event = JSON.parse(fs.readFileSync(path.join(__dirname, 'scenario.json'), 'utf8'));

const ctx = { binding, virtual_now: '2026-11-18T12:00:00+00:00' };
plugin.validateSeed(ctx, data);

// Before booster: Mochi's Bordetella expires 2026-11-28 (mid-stay for Nov 26 - Dec 1)
const before = plugin.handleTool(ctx, data, 'clovervet.clearance.check', {
  pet_id: 'pet-mochi',
  clearance_type: 'boarding_stay',
  stay_start_at: '2026-11-26T12:00:00+00:00',
  stay_end_at: '2026-12-01T12:00:00+00:00',
}).result;
assert.equal(before.eligible, false);
assert.ok(before.reasons.includes('VACCINE_EXPIRES_BEFORE_END'));

// After booster on Nov 18 14:45 (7-day waiting period ends Nov 25 14:45 -> eligible for Nov 26!)
const updated = plugin.applyEvent({ binding, virtual_now: event.at }, structuredClone(data), event);
const after = plugin.handleTool({ binding, virtual_now: event.at }, updated, 'clovervet.clearance.check', {
  pet_id: 'pet-mochi',
  clearance_type: 'boarding_stay',
  stay_start_at: '2026-11-26T12:00:00+00:00',
  stay_end_at: '2026-12-01T12:00:00+00:00',
}).result;
assert.equal(after.eligible, true);

console.log(JSON.stringify({ event_id: event.event_id, before, after }, null, 2));
console.log('PASS: local CloverVet vaccination & boarding-clearance example.');
