#!/usr/bin/env node
'use strict';
// Runs a built Harbor directory without Docker, following the order Harbor uses for a multi-step task:
// build-time init, then for every step: copy workdir, run setup.sh, run the agent, take the state snapshot, run the verifier.
// It is a check of the task files, not a replacement for a Harbor run: there is no container and no model.
//
//   node scripts/lifepack/local-run.cjs <built-dir> --agent oracle|nop [--variant NAME] [--keep]
//   node scripts/lifepack/local-run.cjs <built-dir> --check        run every path in solution/variants.json, plus nop
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function usage(message) {
  if (message) console.error(`Error: ${message}\n`);
  console.error('Usage: node scripts/lifepack/local-run.cjs <built-dir> (--agent oracle|nop [--variant NAME] [--keep] | --check)');
  process.exit(2);
}
const argv = process.argv.slice(2);
const opts = { agent: null, variant: 'reference', keep: false, check: false };
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === '--agent') opts.agent = argv[++i];
  else if (a === '--variant') opts.variant = argv[++i];
  else if (a === '--keep') opts.keep = true;
  else if (a === '--check') opts.check = true;
  else if (a.startsWith('--')) usage(`unknown option ${a}`);
  else opts.dir = a;
}
if (!opts.dir || (!opts.check && !['oracle', 'nop'].includes(opts.agent))) usage();
const BUILT = path.resolve(opts.dir);
if (!fs.existsSync(path.join(BUILT, 'lifepack-build.json'))) usage(`${BUILT} is not a directory built by to-harbor.cjs`);
const build = JSON.parse(fs.readFileSync(path.join(BUILT, 'lifepack-build.json'), 'utf8'));
if (build.probe) usage('this is a --probe build; the probe checks the container, so run it with Harbor');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, entry.name);
    const b = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(a, b);
    else { fs.copyFileSync(a, b); fs.chmodSync(b, fs.statSync(a).mode); }
  }
}

function runOnce(agent, variant, keep) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lifepack-local-'));
  const dirs = { work: path.join(tmp, 'workspace'), state: path.join(tmp, 'state'), logs: path.join(tmp, 'logs/verifier'), tests: path.join(tmp, 'tests'), solution: path.join(tmp, 'solution') };
  const snapshot = path.join(tmp, 'collect/state.json');
  for (const d of [dirs.work, dirs.logs]) fs.mkdirSync(d, { recursive: true });
  // In the image, pale-mcp and pale-session run the door through sudo as the service account.
  // Here they run the same door directly: this check has one account and no isolation.
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'pale-mcp'), '#!/bin/sh\nexec "$PALE_TASK_DIR/door" mcp "$@"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'pale-session'), '#!/bin/sh\nexec "$PALE_TASK_DIR/door" session\n', { mode: 0o755 });
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`,
    PALE_ROOT: path.join(BUILT, 'environment/pale'),
    PALE_TASK_DIR: path.join(BUILT, 'environment/pale-task'),
    PALE_STATE_DIR: dirs.state,
    PALE_LOG_DIR: dirs.logs,
    PALE_STATE_FILE: snapshot,
    PALE_SOLUTION_VARIANT: variant,
  };
  const sh = (label, command, args, cwd) => {
    const r = spawnSync(command, args, { cwd, env, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`${label} failed (exit ${r.status}):\n${r.stdout}${r.stderr}`);
    return r.stdout.trim();
  };
  const steps = [];
  try {
    sh('init', process.execPath, [path.join(env.PALE_TASK_DIR, 'pale-task.cjs'), 'init'], tmp);
    for (const step of build.steps) {
      const src = path.join(BUILT, 'steps', step.id);
      if (fs.existsSync(path.join(src, 'workdir'))) copyDir(path.join(src, 'workdir'), dirs.work);
      if (fs.existsSync(path.join(dirs.work, 'setup.sh'))) sh(`${step.id} setup`, 'bash', ['setup.sh'], dirs.work);
      const left = fs.readdirSync(dirs.work);
      if (agent === 'oracle') {
        fs.rmSync(dirs.solution, { recursive: true, force: true });
        copyDir(path.join(src, 'solution'), dirs.solution);
        sh(`${step.id} solution`, 'bash', [path.join(dirs.solution, 'solve.sh')], dirs.work);
      }
      // Harbor runs this as a collect step in the agent's container, then gives the file to the verifier's container.
      sh(`${step.id} snapshot`, process.execPath, [path.join(env.PALE_TASK_DIR, 'pale-task.cjs'), 'snapshot', snapshot], tmp);
      fs.rmSync(dirs.tests, { recursive: true, force: true });
      copyDir(path.join(BUILT, 'tests'), dirs.tests);
      if (fs.existsSync(path.join(src, 'tests'))) copyDir(path.join(src, 'tests'), dirs.tests);
      const line = sh(`${step.id} verifier`, 'bash', [path.join(dirs.tests, 'test.sh')], dirs.work);
      const reward = JSON.parse(fs.readFileSync(path.join(dirs.logs, 'reward.json'), 'utf8'));
      const outcome = JSON.parse(fs.readFileSync(path.join(dirs.logs, 'outcome.json'), 'utf8'));
      steps.push({ step: step.id, reward, outcome, verifier: line, workspace_after_setup: left });
    }
    return { final: steps[steps.length - 1], steps, tmp };
  } finally {
    if (!keep) fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const fired = (outcome) => Object.entries(outcome.forbidden).filter(([, f]) => f.triggered).map(([id]) => id);

if (opts.check) {
  const variantsFile = path.join(BUILT, 'steps', build.steps[0].id, 'solution/reference/variants.json');
  const cases = fs.existsSync(variantsFile) ? JSON.parse(fs.readFileSync(variantsFile, 'utf8')).variants : [{ id: 'reference', expect: { score: null, pass: true, forbidden: [] } }];
  let failures = 0;
  const check = (name, agent, variant, expect) => {
    let line;
    try {
      const { final } = runOnce(agent, variant, false);
      const o = final.outcome;
      const bad = [];
      if (expect.score !== null && expect.score !== undefined && o.score !== expect.score) bad.push(`score ${o.score}, expected ${expect.score}`);
      if (o.pass !== expect.pass) bad.push(`pass ${o.pass}, expected ${expect.pass}`);
      if (JSON.stringify(fired(o)) !== JSON.stringify(expect.forbidden || [])) bad.push(`forbidden [${fired(o)}], expected [${expect.forbidden || []}]`);
      line = `${bad.length ? 'FAIL' : 'PASS'}  ${name.padEnd(12)} score ${String(o.score).padStart(2)}/${o.max_score}  pass=${o.pass}  forbidden=[${fired(o)}]${bad.length ? '  <- ' + bad.join('; ') : ''}`;
      failures += bad.length ? 1 : 0;
    } catch (e) {
      failures += 1;
      line = `FAIL  ${name.padEnd(12)} ${e.message.split('\n').slice(0, 6).join('\n      ')}`;
    }
    console.log(line);
  };
  for (const c of cases) check(c.id, 'oracle', c.id, c.expect);
  check('nop', 'nop', 'reference', { score: 0, pass: false, forbidden: [] });
  console.log(failures ? `${failures} case(s) failed` : `PASS: ${cases.length + 1} cases`);
  process.exit(failures ? 1 : 0);
}

try {
  const result = runOnce(opts.agent, opts.variant, opts.keep);
  for (const s of result.steps) console.log(`${s.step}: ${s.verifier}${s.workspace_after_setup.length ? `   (left in workspace after setup: ${s.workspace_after_setup.join(', ')})` : ''}`);
  console.log(`final reward: ${JSON.stringify(result.final.reward)}`);
  if (opts.keep) console.log(`kept: ${result.tmp}`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
