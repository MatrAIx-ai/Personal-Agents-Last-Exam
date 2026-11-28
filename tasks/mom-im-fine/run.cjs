#!/usr/bin/env node
'use strict';
// Runs the scripted cases against the real Apps and checks each grade.
//   node tasks/mom-im-fine/run.cjs [case-name ...]
const { runScenario, task } = require('./harness/scenario.cjs');
const { grade } = require('./grader/grade.cjs');
const { CASES } = require('./cases/cases.cjs');

(async () => {
  const only = process.argv.slice(2);
  const unknown = only.filter((n) => !CASES.some(([name]) => name === n));
  if (unknown.length) throw new Error(`unknown case: ${unknown.join(', ')}`);
  let failed = 0;
  let ran = 0;
  for (const [name, agent, want, opts = {}] of CASES.filter(([n]) => !only.length || only.includes(n))) {
    let ok = false;
    let line = '';
    try {
      const problems = [];
      const wrapped = (turn, tools) => {
        if (!turn.system.startsWith(task.system_instructions)) problems.push('system instructions missing');
        if (/standing instructions|in her Notes\./i.test(turn.system) && !opts.hinted) problems.push('unhinted system text points at the instructions');
        if (turn.system.includes(task.hint) !== !!opts.hinted) problems.push(opts.hinted ? 'hint missing' : 'hint shown in an unhinted run');
        if (turn.session === 'meeting' && turn.chat.length) problems.push('session 1 has earlier chat');
        if (turn.session === 'after' && !turn.chat.some((x) => x.user.includes('Q4 review till noon'))) problems.push('session 2 cannot see the morning chat');
        return agent(turn, tools);
      };
      const run = await runScenario(wrapped, { label: name, ...opts });
      const g = grade(run);
      const fired = Object.entries(g.forbidden).filter(([, v]) => v).map(([k]) => k);
      ok = run.write_errors.length === 0 && !problems.length && g.pass === want.pass
        && (want.score === undefined || g.score === want.score)
        && JSON.stringify(fired) === JSON.stringify(want.forbidden || []);
      line = `score ${String(g.score).padStart(2)}/20  pass=${g.pass}  forbidden=[${fired}]  ${JSON.stringify(g.expected)}${run.write_errors.length ? '  write_errors=' + JSON.stringify(run.write_errors) : ''}${problems.length ? '  ' + [...new Set(problems)].join('; ') : ''}`;
    } catch (e) {
      line = 'ERROR ' + e.message;
    }
    ran++;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(32)} ${line}`);
  }
  console.log(failed ? `FAIL: ${failed} case(s)` : `PASS: ${ran} cases`);
  process.exitCode = failed ? 1 : 0;
})();
