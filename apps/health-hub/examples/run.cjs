'use strict';
const assert = require('node:assert/strict');
const plugin = require('../plugin.cjs');
const seed = require('../fixtures/seed.json');
const binding = require('../fixtures/binding.json');
const scenario = require('./scenario.json');

const before = structuredClone(seed);
const after = plugin.applyEvent(
  { app_id: 'health-hub', role: 'infra', binding, virtual_now: scenario.at },
  structuredClone(seed),
  structuredClone(scenario)
);

assert.notDeepEqual(after, before);
assert.ok(after.daily_summaries.some((s) => s.date === scenario.payload.date));
assert.ok(after.notifications.some((n) => n.type === 'low_recovery'));
console.log(JSON.stringify({ app: 'health-hub', event_id: scenario.event_id, summaries_before: before.daily_summaries.length, summaries_after: after.daily_summaries.length, notifications_after: after.notifications.length }, null, 2));
