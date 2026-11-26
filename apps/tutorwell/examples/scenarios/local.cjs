'use strict';
// Plays a scenario run in the App-only harness (tests/harness.cjs), without the public runtime: load the bundle at
// `load_at`, apply the variant's setup, run the Agent calls and grade the snapshot. A call the App refuses is counted,
// not thrown. play.cjs does the same over MCP with the real runtime.
const fs = require('node:fs'), path = require('node:path');
const {fixture} = require('../../tests/harness.cjs');
const {setupOf} = require('../../scripts/build-scenarios.cjs');
const {grade, spec} = require('./grade.cjs');

function load(id, variant) {
  const s = spec(id), dir = path.join(__dirname, id, variant), read = f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const f = fixture({seed: read('seed.json'), binding: read('binding.json'), now: s.load_at});
  for (const step of setupOf(s, variant)) step.event ? f.event(step.event) : f.advance(step.advance_to);
  return {s, f};
}

function playLocal(id, variant, calls) {
  const {s, f} = load(id, variant);
  let refused = 0;
  for (const [name, args] of calls) {
    try { f.call(name, args); } catch (e) { if (!e.code || e.code === 'ERR_ASSERTION') throw e; refused++; }
  }
  return {refused, snapshot: f.snapshot(), grade: grade(f.snapshot(), s, variant)};
}

module.exports = {load, playLocal};
