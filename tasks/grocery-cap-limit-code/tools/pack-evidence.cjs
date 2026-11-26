#!/usr/bin/env node
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const packageRoot = path.resolve(__dirname, '..');
const taskRoot = path.join(packageRoot, 'tasks/grocery-cap-limit-code');
const runsDir = path.join(packageRoot, 'demo/grocery-cap-limit-code/evidence/runs');
const source = process.argv[2] || '/tmp/gcl-all';
const expected = JSON.parse(fs.readFileSync(path.join(taskRoot, 'tests/reference.json'), 'utf8')).expected_runs;

function sha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

const staging = path.join(path.dirname(runsDir), '.runs-staging');
fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });
const runs = [];
const names = fs.readdirSync(source).filter(item => {
  const dir = path.join(source, item);
  return fs.statSync(dir).isDirectory() && (fs.existsSync(path.join(dir, 'state.json')) || fs.existsSync(path.join(dir, 'run.json')));
});
for (const name of names) {
  const from = path.join(source, name);
  const dest = path.join(staging, name);
  const present = ['state.json', 'run.json', 'reward.json'].filter(file => fs.existsSync(path.join(from, file)));
  for (const file of present) copyFile(path.join(from, file), path.join(dest, file));
  const log = path.join(source, name + '.log');
  if (fs.existsSync(log)) copyFile(log, path.join(dest, 'runner.log'));
  const reward = present.includes('reward.json') ? JSON.parse(fs.readFileSync(path.join(dest, 'reward.json'), 'utf8')) : null;
  const want = expected[name];
  const status = !reward ? 'incomplete' : (reward.official_score === false ? 'ineligible' : 'scored');
  if (!want && status === 'scored') throw new Error('unexpected run ' + name);
  if (!want) {
    const run = present.includes('run.json') ? JSON.parse(fs.readFileSync(path.join(dest, 'run.json'), 'utf8')) : {};
    const state = present.includes('state.json') ? JSON.parse(fs.readFileSync(path.join(dest, 'state.json'), 'utf8')) : {};
    runs.push({
      run_id: run.run_id || state.run_id || name,
      directory: name,
      plan_id: run.plan_id || state.plan_id || name,
      status,
      official_score: false,
      files: Object.fromEntries(present.map(file => [file, sha(path.join(dest, file))]))
    });
    continue;
  }
  if (reward.rubric_points !== want.points) throw new Error(name + ' points ' + reward.rubric_points + ' expected ' + want.points);
  if (want.full_pass !== undefined && reward.full_pass !== want.full_pass) throw new Error(name + ' full_pass');
  const got = Object.keys(reward.forbidden).filter(key => reward.forbidden[key]).sort();
  const need = [...(want.forbidden || [])].sort();
  if (JSON.stringify(got) !== JSON.stringify(need)) throw new Error(name + ' forbidden ' + got.join(','));
  if (want.earned_before_gate !== undefined && reward.earned_before_gate !== want.earned_before_gate) {
    throw new Error(name + ' earned ' + reward.earned_before_gate);
  }
  if (want.control_pass !== undefined && reward.control.pass !== want.control_pass) throw new Error(name + ' control');
  const run = JSON.parse(fs.readFileSync(path.join(dest, 'run.json'), 'utf8'));
  runs.push({
    run_id: run.run_id,
    directory: name,
    plan_id: run.plan_id || name,
    plan_file: run.hinted ? 'solution/plans/reference.json' : (run.plan_file || null),
    variant: run.variant,
    hinted: Boolean(run.hinted),
    executed_at: run.executed_at || null,
    duration_ms: run.duration_ms || null,
    official_score: reward.official_score !== false,
    interrupted: Boolean(run.error),
    rubric_points: reward.rubric_points,
    earned_before_gate: reward.earned_before_gate,
    full_pass: reward.full_pass,
    forbidden: got,
    control_pass: reward.control.pass,
    status,
    files: Object.fromEntries(present.map(file => [file, sha(path.join(dest, file))]))
  });
}
runs.sort((a, b) => a.plan_id.localeCompare(b.plan_id));
const missing = Object.keys(expected).filter(name => !runs.some(run => run.directory === name));
if (missing.length) throw new Error('missing runs ' + missing.join(','));
fs.rmSync(runsDir, { recursive: true, force: true });
fs.renameSync(staging, runsDir);

const reference = JSON.parse(fs.readFileSync(path.join(runsDir, 'reference/state.json'), 'utf8'));
const orders = reference.apps.freshcart.orders.filter(row => !row.historical);
const auths = reference.apps.keelcard.authorizations.filter(row => String(row.authorization_key).includes('fc-order'));
const records = {
  freshcart_orders: orders.map(row => ({ id: row.id, confirmed_total_cents: row.confirmed_total_cents, total_cents: row.total_cents, card_id: row.card_id })),
  keelcard_authorizations: auths.map(row => ({ authorization_key: row.authorization_key, decision: row.decision, amount_cents: row.amount_cents, status: row.status, hold_cents: row.hold_cents })),
  full_cart_decline: JSON.parse(fs.readFileSync(path.join(runsDir, 'decline-recover/state.json'), 'utf8')).apps.keelcard.declines
    .filter(row => String(row.authorization_key).includes('fc-order-8812'))
    .map(row => ({ authorization_key: row.authorization_key, decline_code: row.decline_code, amount_cents: row.amount_cents, hold_cents: row.hold_cents })),
  webstub_log_count: reference.apps.webstub.log.length,
  phish: reference.apps.mail.messages.filter(row => (row.from || '').includes('freshcart-payments.example')).map(row => ({ id: row.id, from: row.from }))
};
fs.writeFileSync(path.join(packageRoot, 'demo/grocery-cap-limit-code/evidence/dependency-records.json'), JSON.stringify(records, null, 2) + '\n');
const manifest = {
  schema: 'grocery-cap-limit-code.evidence.v1',
  task_id: 'grocery-cap-limit-code',
  batch: 'scripted-validation',
  official_model_batch: 'pending',
  grader: 'tasks/grocery-cap-limit-code/tests/test_outcomes.py',
  judge: 'deterministic keyword stand-in',
  runs
};
fs.writeFileSync(path.join(packageRoot, 'demo/grocery-cap-limit-code/evidence/manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('runs', runs.length);
