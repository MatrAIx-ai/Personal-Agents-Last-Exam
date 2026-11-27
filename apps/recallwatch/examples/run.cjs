'use strict';

// Standalone local RecallWatch event example (no runtime sibling imports).
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

const before = plugin.handleTool(ctx, data, 'recallwatch.inventory.check_exposure', { item_id: 'item-kettle-kitchen' }).result;
assert.equal(before.exposures[0].exposure_status, 'unaffected');

const updated = plugin.applyEvent({ binding, virtual_now: event.at }, structuredClone(data), event);
const after = plugin.handleTool({ binding, virtual_now: event.at }, updated, 'recallwatch.inventory.check_exposure', { item_id: 'item-kettle-kitchen' }).result;
assert.equal(after.exposures[0].exposure_status, 'matched_active');
assert.deepEqual(after.exposures[0].matched_recall_ids, ['RW-2026-018']);

console.log(JSON.stringify({ event_id: event.event_id, before: before.exposures[0], after: after.exposures[0] }, null, 2));
console.log('PASS: local RecallWatch lot-expansion event example.');
