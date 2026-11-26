'use strict';
// Writes the seed of one evaluation account as of a given time: only the steps before that time, and each record in its state at that time.
// So a task never gets a later record as history. Later events of the story can reach the task only as scenario events.
// Usage: node dev/select-evaluation-seed.cjs --account ID --as-of TIME [--out DIR]. TIME needs a UTC offset. Without --out it prints the counts only.
const fs = require('node:fs');
const path = require('node:path');
const generator = require('./generate-evaluation-data.cjs');
const records = require('./evaluation-records.cjs');

function options(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--account', '--as-of', '--out'].includes(argv[i]) || !argv[i + 1]) throw new Error('Usage: node dev/select-evaluation-seed.cjs --account ID --as-of TIME [--out DIR]');
    out[argv[i].slice(2)] = argv[i + 1];
  }
  if (!out.account || !out['as-of']) throw new Error('Give --account and --as-of.');
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(out['as-of']) || Number.isNaN(Date.parse(out['as-of']))) throw new Error('--as-of needs a full time with a UTC offset, for example 2026-06-01T09:00:00-04:00.');
  return out;
}
// The account with this ID. Its plan comes from the same generator and seed as the delivered files.
function select(accountId, asOf) {
  for (let index = 0; index < generator.ACCOUNTS; index++) {
    const account = generator.plan(index);
    if (account.account_id !== accountId) continue;
    const out = generator.replay(account, asOf), late = records.after(out.data, asOf);
    // Only deadlines and policy term ends may be later. Any other later time would leak the future into the task's history.
    if (late.length) throw new Error(late.length + ' timestamps are not before ' + asOf + ', for example ' + late[0].path + ' = ' + late[0].value);
    return out;
  }
  throw new Error('Unknown evaluation account: ' + accountId);
}
function main() {
  const opts = options(process.argv.slice(2)), asOf = opts['as-of'], out = select(opts.account, asOf);
  const rows = records.lifecycle(out.data.account_id, out.data.claims), last = rows.reduce((a, r) => (!a || Date.parse(r.at) > Date.parse(a) ? r.at : a), null);
  if (opts.out) {
    fs.mkdirSync(path.resolve(opts.out), {recursive: true});
    fs.writeFileSync(path.resolve(opts.out, opts.account + '.seed.json'), JSON.stringify(out.data) + '\n');
    fs.writeFileSync(path.resolve(opts.out, opts.account + '.binding.json'), JSON.stringify(out.binding, null, 2) + '\n');
  }
  console.log(JSON.stringify({account_id: opts.account, as_of: asOf, virtual_now: asOf, policies: out.data.policies.length, claims: out.data.claims.length,
    lifecycle_steps: rows.length, distinct_dates: new Set(rows.map(r => r.day)).size, latest_step: last, steps_after_as_of: out.held_back,
    written: opts.out ? [opts.account + '.seed.json', opts.account + '.binding.json'] : []}));
}
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = {select};
