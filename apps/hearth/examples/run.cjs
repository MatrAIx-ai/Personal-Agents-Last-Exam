'use strict';
const assert = require('node:assert/strict');
const plugin = require('../plugin.cjs');
const seed = require('../fixtures/seed.json');
const event = require('./scenario.json');

const before = JSON.parse(JSON.stringify(seed));
const ctx = {
  app_id: 'hearth',
  run_id: 'example',
  role: 'infra',
  virtual_now: event.at,
};

const after = plugin.applyEvent(ctx, JSON.parse(JSON.stringify(before)), event);
assert.notDeepEqual(after, before);
console.log(JSON.stringify({ app: 'hearth', before, after }, null, 2));
