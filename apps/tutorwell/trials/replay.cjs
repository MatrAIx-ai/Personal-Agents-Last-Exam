#!/usr/bin/env node
'use strict';
// Replays every stored trial in the App-only harness and checks that its committed tool calls reproduce the grade in
// its result.json. The final snapshots are not stored: this rebuilds them from the traces.
//
//   node apps/tutorwell/trials/replay.cjs [ROUND_DIR ...]      (default: every round-* folder here; exit 0 = all match)
const fs = require('node:fs'), path = require('node:path');
const {load} = require('../examples/scenarios/local.cjs');
const {grade} = require('../examples/scenarios/grade.cjs');

const rounds = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(__dirname).filter(d => d.startsWith('round-')).map(d => path.join(__dirname, d));
let runs = 0, same = 0;
for (const round of rounds) {
  for (const id of fs.readdirSync(round)) for (const name of fs.readdirSync(path.join(round, id))) {
    const dir = path.join(round, id, name), result = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
    const trace = fs.readFileSync(path.join(dir, 'trace.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const {f, s} = load(id, result.variant);
    for (const e of trace.filter(x => x.type === 'tool' && x.result && ['ok', 'committed'].includes(x.result.status))) f.call(e.tool, e.arguments);
    const g = grade(f.snapshot(), s, result.variant), failed = g.checks.filter(c => !c.pass).map(c => c.name);
    const match = g.pass === result.pass && JSON.stringify(failed) === JSON.stringify(result.failed_checks);
    runs++; if (match) same++;
    console.log(`${match ? 'same' : 'DIFFERENT'} ${path.relative(__dirname, dir)}: ${g.pass ? 'PASS' : 'FAIL ' + failed.join(',')}`);
  }
}
console.log(`${same} of ${runs} runs reproduce their recorded grade`);
process.exit(runs > 0 && same === runs ? 0 : 1);
