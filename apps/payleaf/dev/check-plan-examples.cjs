'use strict';
// Checks that the example events and the example wire message in tests/ are in the approved plan, byte for byte.
// Run `node dev/check-plan-examples.cjs` in the repository, because the plan is not a part of the package. Exits 1 on a failure.
const fs = require('node:fs');
const path = require('node:path');
const PLAN = path.resolve(__dirname, '../../../proposals/environment/payleaf.md');
// A helper file has one example on each line.
const examples = file => fs.readFileSync(path.join(__dirname, '../tests', file), 'utf8').split('\n').filter(line => line.startsWith('{')).map(line => line.replace(/,$/, ''));
const named = (text, key) => (new RegExp('"' + key + '":"([^"]+)"').exec(text) || [])[1] || text.slice(0, 60);

function main() {
  if (!fs.existsSync(PLAN)) {
    console.log('FAIL  The plan file is not here: ' + PLAN + '\n      Run this check in the repository, where this package is apps/payleaf.');
    console.log('0 of 1 checks passed.');
    process.exitCode = 1;
    return;
  }
  const plan = fs.readFileSync(PLAN, 'utf8'), inPlan = text => plan.includes('`' + text + '`');
  const events = examples('proposal-events.json'), messages = examples('proposal-wire-message.json');
  // Every example of the plan is in the helper files too: the plan has seven events and one wire message as inline code.
  const spans = [...plan.matchAll(/`(\{"(?:event_id|specversion)"[^`]*\})`/g)].map(match => match[1]);
  const checks = [['tests/proposal-events.json has seven example events', events.length === 7],
    ...events.map(text => ['The plan has the example event ' + named(text, 'event_id') + ' (' + named(text, 'operation') + ')', inPlan(text)]),
    ['tests/proposal-wire-message.json has one example message', messages.length === 1],
    ...messages.map(text => ['The plan has the example wire message ' + named(text, 'id'), inPlan(text)]),
    ['Each example of the plan is in tests/', spans.length === 8 && spans.every(text => events.includes(text) || messages.includes(text))]];
  for (const [title, passed] of checks) console.log((passed ? 'ok    ' : 'FAIL  ') + title);
  const failed = checks.filter(([, passed]) => !passed).length;
  console.log((checks.length - failed) + ' of ' + checks.length + ' checks passed.');
  process.exitCode = failed ? 1 : 0;
}
main();
