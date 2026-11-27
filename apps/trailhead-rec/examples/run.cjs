'use strict';

// Standalone local Trailhead weather-closure event example (no runtime imports).
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

const beforeCredit = data.household_credit_cents;
const updated = plugin.applyEvent({ binding, virtual_now: event.at }, structuredClone(data), event);
const outdoorBkg = updated.court_bookings.find((b) => b.id === 'bkg-301');
const indoorBkg = updated.court_bookings.find((b) => b.id === 'bkg-302');

assert.equal(outdoorBkg.status, 'credited_closure');
assert.equal(outdoorBkg.refunded_cents, 1800);
assert.equal(updated.household_credit_cents, beforeCredit + 1800);
assert.equal(indoorBkg.status, 'confirmed');

console.log(JSON.stringify({ event_id: event.event_id, credited_booking: outdoorBkg.id, credit_before: beforeCredit, credit_after: updated.household_credit_cents }, null, 2));
console.log('PASS: local Trailhead weather-closure credit example.');
