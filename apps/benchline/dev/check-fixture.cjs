'use strict';
// The consistency script of the plan. It recomputes, with its own code, what the App reads from a seed at a time, and compares:
// job states, reservations and charges; the usage summary; protocol states and their sign-offs; frozen manifests and their hashes; and the flags.
// Usage: node dev/check-fixture.cjs [SEED TIME]. Without arguments it checks fixtures/minimal.json and examples/task-data/seed.json at their clocks.
// `--evaluation` checks the delivered evaluation seed at its clock and the seeds at the 24 month starts, and runs the story rules. Exits 1 on a problem.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const plugin = require('../plugin.cjs');
const binding = require('../fixtures/binding.json');

const ms = Date.parse, H = 3600000;
const read = (data, name, args, at) => plugin.handleTool(Object.freeze({app_id: 'benchline', role: 'agent', virtual_now: at, binding}), structuredClone(data), 'benchline.' + name, args).result;
const round2 = v => Math.round(v * 100) / 100;
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}

// The state, reservation and charge of a job at `now`, from its stored fields only.
function expectJob(data, job, now) {
  const rate = data.partitions.find(p => p.id === job.partition_id).rate;
  let state = job.stored_state;
  if (state === 'queued' && job.run) state = now < ms(job.run.starts_at) ? 'queued' : now < ms(job.run.ends_at) ? 'running' : job.run.end_kind;
  const stop = {cancelled: job.cancelled_at, interrupted: job.interrupted_at}[state] || (job.run ? job.run.ends_at : null);
  const ran = job.run && !['queued', 'running', 'held'].includes(state) ? Math.max(0, ms(stop) - ms(job.run.starts_at)) / H : 0;
  return {state, reserved: ['queued', 'running'].includes(state) ? round2(job.gpus * rate * job.time_limit_hours) : 0, charged: round2(job.gpus * rate * ran)};
}
function consistency(data, at) {
  const now = ms(at), out = [], problem = (what, id, detail) => out.push({what, id, detail});
  const views = new Map(read(data, 'jobs.list', {}, at).items.map(j => [j.id, j]));
  const pStates = new Map(read(data, 'protocols.list', {}, at).items.map(p => [p.id, p.state]));
  let used = 0, reserved = 0;
  const per = new Map();
  for (const job of data.jobs) {
    const want = expectJob(data, job, now), got = views.get(job.id);
    if (!got || got.state !== want.state || round2(got.reserved_hours) !== want.reserved || round2(got.charged_hours) !== want.charged) {
      problem('job state, reservation or charge', job.id, JSON.stringify({want, got: got && {state: got.state, reserved: got.reserved_hours, charged: got.charged_hours}}));
    }
    if (job.run && ms(job.run.ends_at) - ms(job.run.starts_at) > job.time_limit_hours * H + 1) problem('a job runs longer than its limit', job.id);
    if (job.run && job.run.end_kind === 'timed_out' && job.run.plan_id !== null && Math.abs(ms(job.run.ends_at) - ms(job.run.starts_at) - job.time_limit_hours * H) > 1) problem('a timed-out job did not run to its limit', job.id);
    if (job.period_id !== data.allocation.period_id) continue;
    used += want.charged; reserved += want.reserved;
    const p = per.get(job.owner_person_id) || {used: 0, reserved: 0};
    p.used += want.charged; p.reserved += want.reserved; per.set(job.owner_person_id, p);
  }
  // The usage summary: the sums of the current period, for the project and for each share.
  const u = read(data, 'usage.summary', {}, at).usage, alloc = data.allocation.allocation_hours;
  const block = (limit, s) => ({used: round2(s.used), reserved: round2(s.reserved), remaining: round2(Math.max(0, limit - s.used - s.reserved)), overdrawn: round2(Math.max(0, s.used + s.reserved - limit))});
  const same = (label, a, b) => { if (canonical(a) !== canonical(b)) problem('usage summary', label, JSON.stringify({want: a, got: b})); };
  same('project', block(alloc, {used, reserved}), {used: u.used, reserved: u.reserved, remaining: u.remaining, overdrawn: u.overdrawn_hours});
  for (const s of u.shares) {
    const person = data.people.find(p => p.person_id === s.person_id);
    same(s.person_id, block(person.share_hours, per.get(s.person_id) || {used: 0, reserved: 0}), {used: s.used, reserved: s.reserved, remaining: s.remaining, overdrawn: s.overdrawn_hours});
  }
  // The allocation is the opening hours with the changes of the period applied, in time order.
  const changes = data.allocation_changes.filter(c => c.period_id === data.allocation.period_id).sort((a, b) => ms(a.at) - ms(b.at));
  if ((changes.length ? changes[changes.length - 1].to_hours : data.allocation.opening_hours) !== alloc) problem('the allocation does not follow its changes', data.allocation.period_id);
  // Protocol versions and their sign-offs.
  for (const p of data.protocols) {
    const signs = p.signoffs.filter(s => s.answer === 'sign'), declines = p.signoffs.filter(s => s.answer === 'decline');
    if (['signed', 'superseded'].includes(p.stored_state) && (declines.length || !signs.length || ms(p.signed_at) < ms(p.proposed_at))) problem('a signed version does not fit its sign-offs', p.id);
    if (p.stored_state === 'declined' && !declines.length) problem('a declined version has no decline', p.id);
    if (p.stored_state === 'superseded') {
      const next = data.protocols.find(x => x.id === p.superseded_by);
      if (!next || next.line !== p.line || !['signed', 'superseded'].includes(next.stored_state) || ms(next.signed_at) !== ms(p.superseded_at)) problem('a superseded version names no later signed version', p.id);
    }
    if (p.stored_state === 'proposed' && now >= ms(p.respond_by) && pStates.get(p.id) !== 'expired') problem('a version past its respond_by does not read expired', p.id);
  }
  // Frozen manifests: the cited results, the statistics and the content hash.
  const jobs = new Map(data.jobs.map(j => [j.id, j]));
  for (const t of data.tables.filter(x => x.manifest)) {
    const {content_hash, ...body} = t.manifest;
    if (content_hash !== 'sha256:' + crypto.createHash('sha256').update(canonical(body)).digest('hex')) problem('a manifest hash does not match', t.id);
    for (const row of body.rows) for (const [name, s] of Object.entries(row.metrics)) {
      const values = row.result_ids.map(id => jobs.get(id).run.metrics[name]), mean = values.reduce((a, b) => a + b, 0) / values.length;
      const sd = values.length > 1 ? Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length - 1)) : null;
      const r4 = v => v === null ? null : Math.round(v * 10000) / 10000;
      if (s.count !== values.length || s.mean !== r4(mean) || s.sd !== r4(sd)) problem('a manifest statistic does not match its results', t.id + ' ' + row.name + ' ' + name);
    }
  }
  // The flags: only the intended ones. A job under a version that is not signed reads protocol_unsigned; one under a superseded version, protocol_superseded.
  for (const [id, view] of views) {
    const job = jobs.get(id), p = job.protocol_id && data.protocols.find(x => x.id === job.protocol_id);
    const pState = p ? pStates.get(p.id) : null;
    const want = new Set();
    if (pState && pState !== 'signed') want.add(pState === 'superseded' ? 'protocol_superseded' : 'protocol_unsigned');
    if (job.stored_state === 'held' && job.hold_reason === 'allocation') want.add('unfunded');
    const got = new Set(view.flags.filter(f => f !== 'over_share'));
    if (canonical([...want].sort()) !== canonical([...got].sort())) problem('job flags', id, JSON.stringify({want: [...want], got: [...got]}));
  }
  // A pending job.ended notice is released at the end of its job and names a job that has a run.
  for (const n of data.notifications.filter(x => x.kind === 'job.ended' && x.removed_at === null && ms(x.at) > now)) {
    const job = jobs.get(n.object_id);
    if (!job || !job.run || job.run.ends_at !== n.at || job.stored_state !== 'queued') problem('a pending job.ended notice does not match its job', n.id);
  }
  return out;
}

function report(label, problems) {
  if (problems.length) { console.log('FAIL  ' + label + ': ' + problems.length + ' problems'); for (const p of problems.slice(0, 10)) console.log('      ' + JSON.stringify(p)); }
  else console.log('ok    ' + label);
  return problems.length;
}
function main(argv) {
  const root = path.resolve(__dirname, '..'), load = file => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  const ctx = at => Object.freeze({app_id: 'benchline', role: 'agent', virtual_now: at, binding});
  let failed = 0;
  const check = (label, data, at) => {
    try { plugin.validateSeed(ctx(at), data); } catch (error) { failed++; console.log('FAIL  ' + label + ': validateSeed ' + error.message); return; }
    failed += report(label + ' at ' + at, consistency(data, at));
  };
  if (argv.includes('--evaluation')) {
    const generator = require('./generate-dataset.cjs'), {problems} = require('./check-evaluation.cjs');
    const dir = path.join(root, 'data/evaluation'), seed = load(path.join(dir, 'seed.json')), clock = load(path.join(dir, 'clock.json')).initial_time;
    check('data/evaluation/seed.json', seed, clock);
    failed += report('story rules on data/evaluation/seed.json', problems(seed, load(path.join(dir, 'manifest.json'))));
    const {snapshots} = generator.generate({keepAt: generator.MONTH_STARTS});
    for (const at of generator.MONTH_STARTS) check('the seed at the month start', snapshots[at], at);
  } else if (argv.length >= 2) check(argv[0], load(argv[0]), argv[1]);
  else {
    check('fixtures/minimal.json', load(path.join(root, 'fixtures/minimal.json')), load(path.join(root, 'fixtures/clock.json')).initial_time);
    check('examples/task-data/seed.json', load(path.join(root, 'examples/task-data/seed.json')), load(path.join(root, 'examples/task-data/clock.json')).initial_time);
  }
  console.log(failed ? failed + ' problems.' : 'No problems.');
  process.exitCode = failed ? 1 : 0;
}
if (require.main === module) main(process.argv.slice(2));
module.exports = {consistency};
