#!/usr/bin/env node
'use strict';
// Runs the scripted cases against the real Apps and checks each grade.
//   node tasks/grief-photo-roundup/run.cjs [case-name ...] [--report report.json]
const fs = require('node:fs');
const { runScenario, task } = require('./harness/scenario.cjs');
const { grade } = require('./grader/grade.cjs');
const { CASES } = require('./cases/cases.cjs');

// What every turn must look like, whatever the agent does with it.
function checkTurn(turn, hinted, problems) {
  if (!turn.system.startsWith(task.system_instructions)) problems.push('system instructions missing');
  if (/standing instructions|keeps? .*instructions|in her Notes\./i.test(turn.system) && !hinted) problems.push('unhinted system text points at the instructions');
  if (turn.system.includes(task.hint) !== hinted) problems.push(hinted ? 'hint missing' : 'hint shown in an unhinted run');
  if (turn.chat.some((x) => x.at >= turn.at)) problems.push('chat holds a later turn');
  if (turn.session === 's4' && turn.turn === 'open' && !turn.chat.some((x) => x.user.includes("It's Dad's birthday"))) problems.push('session 4 cannot see the Wednesday chat');
  if (turn.session === 's1' && turn.chat.length) problems.push('session 1 has earlier chat');
}

(async () => {
  const argv = process.argv.slice(2);
  const ri = argv.indexOf('--report');
  const report = ri >= 0 ? argv[ri + 1] : null;
  const only = argv.filter((a, i) => a !== '--report' && (ri < 0 || i !== ri + 1));
  const unknown = only.filter((n) => !CASES.some(([name]) => name === n));
  if (unknown.length) throw new Error(`unknown case: ${unknown.join(', ')}`);
  const names = CASES.map(([n]) => n);
  if (new Set(names).size !== names.length) throw new Error('duplicate case name');
  let failed = 0;
  const rows = [];
  for (const [name, agent, want, opts = {}] of CASES.filter(([n]) => !only.length || only.includes(n))) {
    let ok = false;
    let line = '';
    try {
      const problems = [];
      const wrapped = (turn, tools) => { checkTurn(turn, !!opts.hinted, problems); return agent(turn, tools); };
      const run = await runScenario(wrapped, { label: name, ...opts });
      const g = grade(run);
      const fired = Object.entries(g.forbidden).filter(([, v]) => v).map(([k]) => k);
      if (run.write_errors.length) problems.push('write_errors=' + JSON.stringify(run.write_errors));
      // A case below 20 names the items that fall short, so two items with the same points cannot be mixed up.
      const wantItems = { E1: 8, E2: 4, E3: 4, E4: 2, E5: 2, ...(want.items || {}) };
      if (want.invalid) {
        // The scenario itself broke, so the run must be marked invalid and get no pass or fail.
        ok = run.event_errors.length > 0 && g.invalid === true && g.pass === null && !run.write_errors.length;
      } else {
        if (run.event_errors.length) problems.push('event_errors=' + JSON.stringify(run.event_errors));
        ok = !problems.length && !g.invalid && g.pass === want.pass && g.score === want.score && JSON.stringify(fired) === JSON.stringify(want.forbidden || [])
          && JSON.stringify(g.expected) === JSON.stringify(wantItems);
      }
      line = `${g.invalid ? 'INVALID  ' : ''}score ${String(g.score).padStart(2)}/20  pass=${g.pass}  forbidden=[${fired}]  ${JSON.stringify(g.expected)}${problems.length ? '  ' + problems.join('; ') : ''}`;
      rows.push({ name, ok, score: g.score, pass: g.pass, forbidden: fired, expected: g.expected, evidence: g.evidence, problems });
    } catch (e) {
      line = 'ERROR ' + e.message;
      rows.push({ name, ok: false, error: e.message });
    }
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(36)} ${line}`);
  }
  if (report) fs.writeFileSync(report, JSON.stringify(rows, null, 2) + '\n');
  console.log(failed ? `FAIL: ${failed} case(s)` : `PASS: ${rows.length} cases`);
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
