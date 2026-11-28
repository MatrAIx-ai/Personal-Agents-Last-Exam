'use strict';
const assert = require('node:assert/strict');
const { fixture } = require('../tests/harness.cjs');

const f = fixture();
const before = structuredClone(f.data);
f.event(require('./scenario.json'));
assert.notDeepEqual(f.data, before);
console.log(JSON.stringify({ app: 'personal-records', documents_before: before.documents.length, documents_after: f.data.documents.length }, null, 2));
