'use strict';
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');
const f = fixture();
const before = f.data;
f.event(require('./scenario.json'));
assert.notDeepEqual(f.data, before);
assert.equal(f.data.notes.length, 1);
console.log(JSON.stringify({app: 'postyard', notes: f.data.notes.length, id: f.data.notes[0].id}));
