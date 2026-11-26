'use strict';
// Runs the recognizer over tests/recognizer-diagnostic.json and lists every message whose recognized
// requests differ from the expectation, in order. A diagnostic with no accuracy target (approved plan):
// an unrecognized message is answered with an acknowledgement that lists the quick actions and changes
// nothing, so a miss costs a turn, never a wrong state change.
// Run: node scripts/text-diagnostic.cjs [--json]
const {recognize} = require('../src/policy.cjs');
const provider = require('../fixtures/minimal.json').provider;
const set = require('../tests/recognizer-diagnostic.json');

function run() {
  const rows = [];
  const got = text => recognize(provider, text).map(r => r.action);
  for (const [category, list] of Object.entries(set)) {
    if (category === 'description') continue;
    for (const item of list) {
      const text = typeof item === 'string' ? item : item.text;
      const expect = category === 'none' ? [] : category === 'double' ? item.expect : [category];
      const actual = got(text);
      rows.push({category, text, expect, actual, as_expected: JSON.stringify(actual) === JSON.stringify(expect)});
    }
  }
  const by = {};
  for (const r of rows) { by[r.category] = by[r.category] || {messages: 0, as_expected: 0}; by[r.category].messages++; if (r.as_expected) by[r.category].as_expected++; }
  return {summary: by, differences: rows.filter(r => !r.as_expected), rows};
}
module.exports = {run};
if (require.main === module) {
  const r = run();
  if (process.argv.includes('--json')) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }
  for (const [c, s] of Object.entries(r.summary)) console.log(`${c.padEnd(22)} ${s.as_expected}/${s.messages} as expected`);
  console.log(`\n${r.differences.length} message(s) differ from the expectation:`);
  for (const d of r.differences) console.log(`- [${d.category}] "${d.text}" expected ${JSON.stringify(d.expect)}, recognized ${JSON.stringify(d.actual)}`);
}
