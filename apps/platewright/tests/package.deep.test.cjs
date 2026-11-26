'use strict';
// Deep suite: both fixtures are rebuilt by scripts/build-fixtures.cjs, which replays the generated
// history and the hand-written weeks through the App's hooks, and match the committed files byte for
// byte (the same check as `node scripts/build-fixtures.cjs --check`).
const test = require('node:test');
const assert = require('node:assert/strict');

test('generated fixtures match their builder', () => {
  assert.deepEqual(require('../scripts/build-fixtures.cjs').build({check: true}), []);
});
