'use strict';
// The generated delivery evidence that is checked in as text (dependency transcripts, GUI sequence
// files) holds nothing that depends on when, where or with which Node version it was produced, so
// re-running its script reproduces it byte for byte. `node scripts/dependency-evidence.cjs --check`
// regenerates the transcripts and compares them; this test checks the committed files without a run.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {stable, runDependent, WALL_CLOCK} = require('../scripts/dependency-evidence.cjs');
const dir = path.join(__dirname, '../evidence');

test('committed transcripts and sequence files hold no run-dependent value', () => {
  for (const f of ['dependencies/mail.json', 'dependencies/resource-access.json', 'gui/sequences.json', 'gui/SEQUENCES.md']) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.equal(runDependent(text), null, f);
    if (f.endsWith('.json')) assert.equal(JSON.stringify(stable(JSON.parse(text)), null, 2) + '\n', text, f + ' is already in stable form');
  }
  for (const f of ['dependencies/mail.json', 'dependencies/resource-access.json']) assert.match(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).reproducible, /^Byte for byte/, f);
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'gui/sequences.json'), 'utf8')).frames.every(x => !('bytes' in x)), 'frame sizes are not recorded');
  // Only UTC wall-clock times are replaced; virtual-clock times and missing times stay as they are.
  assert.deepEqual(stable({received_at: '2026-11-26T02:00:50.538Z', receipt: {committed_at: null, processed_at: '2026-11-26T02:00:50.588Z'}, message: {received_at: '2026-11-20T09:00:00-08:00'}}),
    {received_at: WALL_CLOCK, receipt: {committed_at: null, processed_at: WALL_CLOCK}, message: {received_at: '2026-11-20T09:00:00-08:00'}});
});
