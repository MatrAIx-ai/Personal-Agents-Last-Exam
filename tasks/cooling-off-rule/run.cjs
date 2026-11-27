'use strict';
// Runs every scripted case against Mail and Calendar and checks the grader's verdicts.
// Usage: node tasks/cooling-off-rule/run.cjs [case ...] [--report report.json]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runScenario } = require('./harness/scenario.cjs');
const { grade } = require('./grader/grade.cjs');
const cases = require('./cases/cases.cjs');

async function runCase(c) {
  const run = await runScenario(c.agent, { label: c.name, hinted: !!c.hinted });
  const g = grade(run);
  const fired = Object.entries(g.forbidden).filter(([, v]) => v).map(([k]) => k);
  const problems = [];
  const check = (fn, what) => { try { fn(); } catch { problems.push(what); } };
  if ('score' in c.expect) check(() => assert.equal(g.score, c.expect.score), `score ${g.score} != ${c.expect.score}`);
  if ('max_score' in c.expect) check(() => assert.ok(g.score <= c.expect.max_score), `score ${g.score} > ${c.expect.max_score}`);
  check(() => assert.equal(g.pass, c.expect.pass), `pass ${g.pass} != ${c.expect.pass}`);
  check(() => assert.deepEqual(fired, c.expect.forbidden), `forbidden [${fired}] != [${c.expect.forbidden}]`);
  if (run.write_errors.length) problems.push(`write errors: ${JSON.stringify(run.write_errors)}`);
  return { g, fired, problems, run };
}

async function main() {
  const results = [];
  let failures = 0;
  const args = process.argv.slice(2);
  const ri = args.indexOf('--report');
  const reportPath = ri >= 0 ? args[ri + 1] : null;
  const names = args.filter((a, i) => i !== ri && i !== ri + 1);
  if (ri >= 0 && !reportPath) throw new Error('--report needs a file name');
  const unknown = names.filter((n) => !cases.some((c) => c.name === n));
  if (unknown.length) throw new Error(`unknown case: ${unknown.join(', ')}`);
  for (const c of cases.filter((x) => !names.length || names.includes(x.name))) {
    let out;
    try {
      out = await runCase(c);
    } catch (e) {
      failures += 1;
      console.log(`FAIL  ${c.name.padEnd(32)} error: ${e.message}`);
      results.push({ case: c.name, expect: c.expect, error: String(e.stack || e) });
      continue;
    }
    const { g, fired, problems, run } = out;
    failures += problems.length ? 1 : 0;
    console.log(`${problems.length ? 'FAIL' : 'PASS'}  ${c.name.padEnd(32)} score ${String(g.score).padStart(2)}/20  pass=${g.pass}  forbidden=[${fired}]  ${JSON.stringify(g.expected)}${problems.length ? '  <- ' + problems.join('; ') : ''}`);
    results.push({ case: c.name, expect: c.expect, ...g, morning_reply_at: run.morning_reply_at, write_errors: run.write_errors, transcript: run.transcript });
  }
  const report = { task: 'cooling-off-rule', node: process.version, cases: results.length, failures, results };
  if (reportPath) fs.writeFileSync(path.resolve(reportPath), JSON.stringify(report, null, 2) + '\n');
  console.log(failures ? `${failures} case(s) failed` : `PASS: ${results.length} cases`);
  if (failures) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
