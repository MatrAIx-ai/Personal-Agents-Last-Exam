'use strict';
const c = require('./common.cjs');
const {ms, copy, sum, hundredths, hours} = c;
// Values computed from the stored records and the clock. Nothing here writes.

const ENDED = new Set(['completed', 'failed', 'timed_out']);
const ACTIVE = new Set(['queued', 'held', 'running']);
// The state of a job at `now`. A stored queued job runs from its start and ends at its end, as its run plan said.
function jobState(job, now) {
  if (job.stored_state !== 'queued') return job.stored_state;
  if (!job.run || now < ms(job.run.starts_at)) return 'queued';
  return now < ms(job.run.ends_at) ? 'running' : job.run.end_kind;
}
const rate100 = (data, job) => Math.round(data.partitions.find(p => p.id === job.partition_id).rate * 100);
// gpus × rate × time limit, in hundredths of a GPU-hour.
const reservationOf = (data, job) => Math.round(job.gpus * rate100(data, job) * hundredths(job.time_limit_hours) / 100);
// gpus × rate × hours run, in hundredths. A job runs from its start to its end, or to its cancellation or interruption.
function chargeOf(data, job, now) {
  const state = jobState(job, now);
  if (!job.run || state === 'queued' || state === 'held' || state === 'running') return 0;
  const stop = state === 'cancelled' ? ms(job.cancelled_at) : state === 'interrupted' ? ms(job.interrupted_at) : ms(job.run.ends_at);
  const ran = Math.max(0, stop - ms(job.run.starts_at));
  return Math.round(job.gpus * rate100(data, job) * ran / 3600000);
}
const reserves = state => state === 'queued' || state === 'running';
const current = (data, job) => job.period_id === data.allocation.period_id;
const shareOf = (data, personId) => { const p = c.person(data, personId); return p && p.share_hours !== null ? hundredths(p.share_hours) : null; };

// Used and reserved hundredths of the current period, for the project and for one person.
function sums(data, now, personId = null) {
  let used = 0, reserved = 0;
  for (const job of data.jobs) {
    if (!current(data, job) || personId !== null && job.owner_person_id !== personId) continue;
    const state = jobState(job, now);
    if (reserves(state)) reserved += reservationOf(data, job); else used += chargeOf(data, job, now);
  }
  return {used, reserved};
}
const left = (limit, s) => limit - s.used - s.reserved;
function usage(data, now) {
  const allocation = hundredths(data.allocation.allocation_hours), project = sums(data, now);
  const block = (limit, s) => ({used: hours(s.used), reserved: hours(s.reserved), remaining: hours(Math.max(0, left(limit, s))), overdrawn_hours: hours(Math.max(0, -left(limit, s)))});
  return {period: periodView(data.allocation), allocation_hours: data.allocation.allocation_hours, hard_shares: data.project.policy.hard_shares, ...block(allocation, project),
    shares: data.people.filter(p => p.share_hours !== null).map(p => ({person_id: p.person_id, name: p.name, share_hours: p.share_hours, ...block(hundredths(p.share_hours), sums(data, now, p.person_id))}))};
}
const periodView = a => ({period_id: a.period_id, label: a.label, starts_at: a.starts_at, ends_at: a.ends_at});

// The submission check of section 2. It returns the failing steps after `not_found`, in table order.
// `self` is a held job that `jobs.release` checks: it does not count against the job count.
function check(data, args, now, {hold = false, self = null} = {}) {
  const config = c.find(data.configs, args.config_id, 'config'), partition = c.find(data.partitions, args.partition_id, 'partition');
  const protocol = args.protocol_id === null || args.protocol_id === undefined ? null : c.find(data.protocols, args.protocol_id, 'protocol version');
  const failures = [], job = {gpus: args.gpus, time_limit_hours: args.time_limit_hours, partition_id: partition.id};
  if (hundredths(args.time_limit_hours) > hundredths(partition.max_hours)) failures.push('time_limit_too_long');
  if (protocol && !covers(protocol, config, args.seed)) failures.push('protocol_mismatch');
  const active = data.jobs.filter(j => j !== self && c.isOwner(data, j.owner_person_id) && ACTIVE.has(jobState(j, now))).length;
  if (active >= data.project.policy.max_active_jobs) failures.push('too_many_active');
  const reserve = hold ? 0 : reservationOf(data, job);
  // A job fits when its reservation is at most what is left, and what is left is never below zero. So a free job always fits.
  const projectBefore = left(hundredths(data.allocation.allocation_hours), sums(data, now)), projectLeft = Math.max(0, projectBefore) - reserve;
  const share = shareOf(data, data.owner_person_id), shareBefore = share === null ? null : left(share, sums(data, now, data.owner_person_id));
  const shareLeft = share === null ? null : Math.max(0, shareBefore) - reserve, overShare = shareBefore !== null && reserve > Math.max(0, shareBefore);
  if (!hold && reserve > Math.max(0, projectBefore)) failures.push('over_allocation');
  if (!hold && data.project.policy.hard_shares && overShare) failures.push('over_share');
  const flags = [];
  if (!hold && !data.project.policy.hard_shares && overShare) flags.push('over_share');
  if (protocol) flags.push(...protocolFlags(protocol, now));
  return {config, partition, protocol, failures, reserve, projectLeft, shareLeft, flags};
}
const covers = (protocol, config, seed) => config.dataset_version === protocol.dataset_version && config.eval_split === protocol.eval_split && protocol.seeds.includes(seed);

// Protocol versions.
function protocolState(p, now) {
  return p.stored_state === 'proposed' && now >= ms(p.respond_by) ? 'expired' : p.stored_state;
}
function protocolFlags(p, now) {
  const state = protocolState(p, now);
  return state === 'superseded' ? ['protocol_superseded'] : state === 'signed' ? [] : ['protocol_unsigned'];
}
const missingSigners = (data, p) => data.project.policy.required_signers.filter(id => !p.signoffs.some(s => s.person_id === id && s.answer === 'sign'));
function protocolView(data, p, now) {
  const {history, ...stored} = p;
  return {...copy(stored), state: protocolState(p, now), required_signers: copy(data.project.policy.required_signers), missing_signers: missingSigners(data, p),
    history: copy(history)};
}

// Jobs and results. A job shows its start only once it has started, and its end and result only once it has ended.
function overShare(data, now) {
  const out = new Set(), share = shareOf(data, data.owner_person_id);
  if (data.project.policy.hard_shares || share === null) return out;
  let total = sums(data, now, data.owner_person_id).used;
  for (const job of data.jobs.filter(j => current(data, j) && c.isOwner(data, j.owner_person_id) && reserves(jobState(j, now))).sort(c.byTime('submitted_at'))) {
    const reserve = reservationOf(data, job);
    total += reserve;
    // A job that reserves nothing takes no hours past the share.
    if (reserve > 0 && total > share) out.add(job.id);
  }
  return out;
}
function jobFlags(data, job, now, over = overShare(data, now)) {
  const flags = [];
  if (over.has(job.id)) flags.push('over_share');
  if (job.stored_state === 'held' && job.hold_reason === 'allocation') flags.push('unfunded');
  const p = job.protocol_id === null ? null : data.protocols.find(x => x.id === job.protocol_id);
  if (p) flags.push(...protocolFlags(p, now));
  return flags;
}
function hasResult(job, now) { return jobState(job, now) === 'completed'; }
function jobView(data, job, now, over) {
  const state = jobState(job, now), stopped = state === 'cancelled' ? job.cancelled_at : state === 'interrupted' ? job.interrupted_at : null;
  const started = job.run !== null && ms(job.run.starts_at) <= (stopped === null ? now : ms(stopped)), ended = ENDED.has(state);
  return {id: job.id, owner_person_id: job.owner_person_id, submitted_by: job.submitted_by, script: job.script, config_id: job.config_id, seed: job.seed,
    partition_id: job.partition_id, gpus: job.gpus, time_limit_hours: job.time_limit_hours, protocol_id: job.protocol_id, period_id: job.period_id,
    submitted_at: job.submitted_at, state, hold_reason: state === 'held' ? job.hold_reason : null,
    starts_at: started ? job.run.starts_at : null, ends_at: ended ? job.run.ends_at : stopped,
    error: state === 'failed' ? job.run.error : state === 'interrupted' ? job.interrupt_reason : null,
    reserved_hours: reserves(state) ? hours(reservationOf(data, job)) : 0, charged_hours: hours(chargeOf(data, job, now)),
    has_result: state === 'completed', flags: jobFlags(data, job, now, over)};
}
function resultView(data, job, now) {
  const review = job.review || {tags: [], note: null, excluded: false, reason: null, updated_at: null};
  const p = job.protocol_id === null ? null : data.protocols.find(x => x.id === job.protocol_id);
  const flags = p ? protocolFlags(p, now) : [];
  if (job.invalidation) flags.push('invalidated');
  return {id: job.id, job_id: job.id, owner_person_id: job.owner_person_id, config_id: job.config_id, seed: job.seed, protocol_id: job.protocol_id,
    metrics: copy(job.run.metrics), completed_at: job.run.ends_at, state: review.excluded ? 'excluded' : 'candidate', exclusion_reason: review.excluded ? review.reason : null,
    tags: copy(review.tags), note: review.note, invalidated: copy(job.invalidation), flags};
}

// Tables. On a draft the flags are what would stop a freeze. A frozen table reads flags from what changed after its freeze.
function tableFlags(data, table, now) {
  const flags = [], jobs = new Map(data.jobs.map(j => [j.id, j]));
  const p = data.protocols.find(x => x.id === table.protocol_id), ids = table.rows.flatMap(r => r.result_ids);
  const draft = table.stored_state === 'draft';
  if (draft && !table.rows.length) flags.push('empty_table');
  if (draft && table.rows.length && !seedsComplete(data, table, p)) flags.push('incomplete_seeds');
  if (ids.some(id => jobs.get(id) && jobs.get(id).review && jobs.get(id).review.excluded)) flags.push('cites_excluded');
  if (ids.some(id => jobs.get(id) && jobs.get(id).invalidation)) flags.push('cites_invalidated');
  flags.push(...protocolFlags(p, now));
  return flags;
}
// Each row has exactly one result for each seed of the protocol, all from one config.
function seedsComplete(data, table, p) {
  const jobs = new Map(data.jobs.map(j => [j.id, j]));
  return table.rows.every(row => {
    const list = row.result_ids.map(id => jobs.get(id));
    if (list.some(j => !j) || new Set(list.map(j => j.config_id)).size !== 1) return false;
    const seeds = list.map(j => j.seed).sort((a, b) => a - b), want = p.seeds.slice().sort((a, b) => a - b);
    return seeds.length === want.length && seeds.every((s, i) => s === want[i]);
  });
}
// Mean and sample standard deviation, rounded to four decimals. One value has no standard deviation.
function stats(values) {
  const n = values.length, mean = sum(values) / n;
  const sd = n > 1 ? Math.sqrt(sum(values.map(v => (v - mean) ** 2)) / (n - 1)) : null;
  const round = v => Math.round(v * 10000) / 10000;
  return {count: n, mean: round(mean), sd: sd === null ? null : round(sd)};
}
const CSV_SAFE = value => /[",\n]/.test(String(value)) ? '"' + String(value).replace(/"/g, '""') + '"' : String(value);
function csv(manifest) {
  const names = manifest.metrics.map(m => m.name);
  const head = ['row', 'config_id', 'seeds', 'result_ids', ...names.flatMap(n => [n + '_count', n + '_mean', n + '_sd'])];
  const lines = manifest.rows.map(r => [r.name, r.config_id, r.seeds.join(' '), r.result_ids.join(' '),
    ...names.flatMap(n => { const s = r.metrics[n]; return [s.count, s.mean === null ? '' : s.mean.toFixed(4), s.sd === null ? '' : s.sd.toFixed(4)]; })]);
  return [head, ...lines].map(line => line.map(CSV_SAFE).join(',')).join('\n') + '\n';
}
function tableView(data, table, now) {
  const {history, ...stored} = table;
  return {...copy(stored), flags: tableFlags(data, table, now), csv: table.manifest ? csv(table.manifest) : null, history: copy(history)};
}
const tableRow = (data, t, now) => ({id: t.id, table_id: t.table_id, version: t.version, title: t.title, protocol_id: t.protocol_id, state: t.stored_state,
  rows: t.rows.length, created_at: t.created_at, frozen_at: t.frozen_at, flags: tableFlags(data, t, now)});

// Notifications are listed from their release time on, and never once removed.
const listed = (n, now) => n.removed_at === null && ms(n.at) <= now;
module.exports = {ENDED, ACTIVE, jobState, reservationOf, chargeOf, usage, sums, check, covers, protocolState, protocolFlags, missingSigners, protocolView,
  overShare, jobFlags, hasResult, jobView, resultView, tableFlags, seedsComplete, stats, csv, tableView, tableRow, listed, periodView, current, shareOf};
