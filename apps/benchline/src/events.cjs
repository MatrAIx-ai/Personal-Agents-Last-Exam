'use strict';
const c = require('./common.cjs');
const views = require('./views.cjs');
const rules = require('./rules.cjs');
const notices = require('./notices.cjs');
const ops = require('./operations.cjs');
const {ms, time, copy, hundredths} = c;
const A = c.APP + '.';
// What labmates, the lab head and the cluster do arrives here. Their acts are applied as given: only the plan's listed rules are checked.
const bad = message => c.fail('invalid_event', message);
const fresh = (data, id) => { if (c.allIds(data).includes(id)) bad('The ID ' + id + ' already exists.'); };
const known = (data, personId) => { if (!c.person(data, personId)) bad('The person ' + personId + ' is unknown.'); };
const other = (data, personId, role) => { known(data, personId); if (c.isOwner(data, personId)) bad('An event cannot name the account holder as ' + role + '.'); };
const exists = (list, id, label) => list.find(x => x.id === id) || bad('The ' + label + ' ' + id + ' is unknown.');
const decimal = value => { if (!c.twoDecimals(value)) bad('An hour value has more than two decimals.'); };

const handlers = {
  'allocation.changed'(t, data, p) {
    known(data, p.changed_by);
    if (p.allocation_hours !== undefined) decimal(p.allocation_hours);
    const shares = p.shares || [];
    for (const s of shares) { known(data, s.person_id); if (s.share_hours !== null) decimal(s.share_hours); }
    if (new Set(shares.map(s => s.person_id)).size !== shares.length) bad('The event names one person twice.');
    const from = data.allocation.allocation_hours, to = p.allocation_hours ?? from;
    const change = {id: c.nextId(c.allIds(data), 'alc-'), period_id: data.allocation.period_id, at: t.at, from_hours: from, to_hours: to,
      shares: shares.map(s => ({person_id: s.person_id, from: c.person(data, s.person_id).share_hours, to: s.share_hours})), changed_by: p.changed_by, reason: p.reason ?? null, event_id: t.ref};
    data.allocation.allocation_hours = to;
    for (const s of shares) c.person(data, s.person_id).share_hours = s.share_hours;
    data.allocation_changes.push(change);
    c.record(t, data, 'allocation.changed', data.allocation.period_id);
    // When the project is overdrawn, the account holder's queued jobs of this period are held, the last submitted first, until it is not.
    const held = [];
    const overdrawn = () => { const s = views.sums(data, t.now); return s.used + s.reserved > hundredths(data.allocation.allocation_hours); };
    // A queued job that reserves nothing frees no hours, so it is never held.
    const queued = data.jobs.filter(j => views.current(data, j) && c.isOwner(data, j.owner_person_id) && views.jobState(j, t.now) === 'queued' && views.reservationOf(data, j) > 0)
      .sort((a, b) => ms(b.submitted_at) - ms(a.submitted_at) || c.compare(b.id, a.id));
    for (const job of queued) {
      if (!overdrawn()) break;
      Object.assign(job, {stored_state: 'held', hold_reason: 'allocation', run: null});
      c.record(t, data, 'job.held', job.id, true, job.history, {state: 'held'});
      notices.removeJobEnded(t, data, job);
      held.push(job.id);
    }
    const mine = change.shares.find(s => s.person_id === data.owner_person_id);
    const notify = from !== to || (mine && mine.from !== mine.to);
    return {object: data.allocation.period_id, notify, details: {change, held}};
  },
  'job.recorded'(t, data, p) {
    fresh(data, p.job_id);
    other(data, p.owner_person_id, 'owner');
    const config = exists(data.configs, p.config_id, 'config');
    exists(data.partitions, p.partition_id, 'partition');
    const protocol = p.protocol_id === undefined || p.protocol_id === null ? null : exists(data.protocols, p.protocol_id, 'protocol version');
    decimal(p.time_limit_hours);
    if (ms(p.ends_at) < ms(p.starts_at)) bad('The recorded job ends before it starts.');
    if (ms(p.ends_at) - ms(p.starts_at) > hundredths(p.time_limit_hours) * 36000) bad('The recorded job runs longer than its time limit.');
    if (protocol && !views.covers(protocol, config, p.seed)) bad('The protocol version ' + protocol.id + ' does not cover the config and seed of the recorded job.');
    const job = {id: p.job_id, owner_person_id: p.owner_person_id, submitted_by: 'labmate', script: null, config_id: p.config_id, seed: p.seed, partition_id: p.partition_id,
      gpus: p.gpus, time_limit_hours: p.time_limit_hours, protocol_id: protocol ? protocol.id : null, period_id: data.allocation.period_id, submitted_at: t.at,
      stored_state: 'queued', hold_reason: null, run: {plan_id: null, starts_at: p.starts_at, ends_at: p.ends_at, end_kind: p.end_kind,
        metrics: p.end_kind === 'completed' ? copy(p.metrics) : null, error: p.end_kind === 'failed' ? p.error ?? null : null},
      cancelled_at: null, interrupted_at: null, interrupt_reason: null, review: null, invalidation: null, request_id: null, event_id: t.ref, history: []};
    data.jobs.push(job);
    c.record(t, data, 'job.recorded', job.id, false, job.history, {state: views.jobState(job, t.now)});
    return {object: job.id, notify: false};
  },
  'job.script_submitted'(t, data, p) {
    const args = {config_id: p.config_id, seed: p.seed, partition_id: p.partition_id, gpus: p.gpus, time_limit_hours: p.time_limit_hours, protocol_id: p.protocol_id ?? null, hold: p.hold === true};
    exists(data.configs, args.config_id, 'config');
    exists(data.partitions, args.partition_id, 'partition');
    if (args.protocol_id !== null) exists(data.protocols, args.protocol_id, 'protocol version');
    decimal(args.time_limit_hours);
    // The same submission check as jobs.submit. A failing step adds no job: one notification records the arguments and the error.
    const check = views.check(data, args, t.now, {hold: args.hold});
    const error = ops.FIRST.find(x => check.failures.includes(x));
    if (error) {
      c.record(t, data, 'job.script_submitted', args.config_id, false, null);
      return {object: args.config_id, notify: true, kind: 'job.submission_rejected',
        details: {args, check, error, script: p.script, record: {script: p.script, ...copy(args), error}}};
    }
    const job = ops.addJob(t, data, args, check, 'script', p.script);
    return {object: job.id, notify: false};
  },
  'job.interrupted'(t, data, p) {
    const job = exists(data.jobs, p.job_id, 'job'), state = views.jobState(job, t.now);
    if (state !== 'queued' && state !== 'running') bad('The job is ' + state + '. Only a queued or running job can be interrupted.');
    Object.assign(job, {stored_state: 'interrupted', interrupted_at: t.at, interrupt_reason: p.reason ?? null});
    c.record(t, data, 'job.interrupted', job.id, false, job.history, {state: 'interrupted'});
    notices.removeJobEnded(t, data, job);
    return {object: job.id, notify: c.isOwner(data, job.owner_person_id), details: {job}};
  },
  'plan.set'(t, data, p) {
    exists(data.configs, p.config_id, 'config');
    if (p.partition_id !== undefined && p.partition_id !== null) exists(data.partitions, p.partition_id, 'partition');
    const key = {config_id: p.config_id, seed: p.seed ?? null, partition_id: p.partition_id ?? null};
    const fields = {queue_wait_minutes: p.queue_wait_minutes, run_minutes: p.run_minutes, outcome: p.outcome, metrics: p.outcome === 'completed' ? copy(p.metrics) : null,
      error: p.outcome === 'failed' ? p.error ?? null : null, set_at: t.at, event_id: t.ref};
    let plan = data.run_plans.find(x => x.config_id === key.config_id && x.seed === key.seed && x.partition_id === key.partition_id);
    if (plan) Object.assign(plan, fields);
    else { plan = {id: c.nextId(c.allIds(data), 'rp-'), ...key, ...fields}; data.run_plans.push(plan); }
    c.record(t, data, 'plan.set', plan.id);
    // A queued job of the account holder that had no plan gets its start, its end and its job.ended notice.
    for (const job of data.jobs.filter(j => c.isOwner(data, j.owner_person_id) && j.stored_state === 'queued' && j.run === null)) {
      job.run = ops.runOf(data, job, t.now);
      if (!job.run) continue;
      c.record(t, data, 'job.planned', job.id, true, job.history);
      notices.jobEnded(t, data, job);
    }
    return {object: plan.id, notify: false};
  },
  'config.registered'(t, data, p) {
    fresh(data, p.config_id);
    known(data, p.registered_by);
    const config = {id: p.config_id, family: p.family, version: p.version, params: copy(p.params), dataset_version: p.dataset_version, eval_split: p.eval_split,
      code_ref: p.code_ref, registered_by: p.registered_by, registered_at: t.at, event_id: t.ref};
    data.configs.push(config);
    c.record(t, data, 'config.registered', config.id);
    return {object: config.id, notify: false};
  },
  'protocol.proposed'(t, data, p) {
    fresh(data, p.protocol_id);
    other(data, p.proposed_by, 'proposer');
    const open = data.protocols.find(x => x.line === p.line && views.protocolState(x, t.now) === 'proposed');
    if (open) bad('The line ' + p.line + ' already has the proposed version ' + open.id + '.');
    if (new Set(p.seeds).size !== p.seeds.length) bad('A seed is listed twice.');
    const version = Math.max(0, ...data.protocols.filter(x => x.line === p.line).map(x => x.version)) + 1;
    const protocol = ops.propose(t, data, {id: p.protocol_id, version, line: p.line, dataset_version: p.dataset_version, eval_split: p.eval_split, metrics: p.metrics,
      seeds: p.seeds, rationale: p.rationale, proposed_by: p.proposed_by});
    c.record(t, data, 'protocol.proposed', protocol.id, false, protocol.history);
    ops.settle(t, data, protocol);
    const signer = data.project.policy.required_signers.includes(data.owner_person_id);
    return {object: protocol.id, notify: signer && views.protocolState(protocol, t.now) === 'proposed', details: {protocol}};
  },
  'protocol.answered'(t, data, p) {
    const protocol = exists(data.protocols, p.protocol_id, 'protocol version');
    other(data, p.person_id, 'signer');
    if (!data.project.policy.required_signers.includes(p.person_id)) bad('The person ' + p.person_id + ' is not a required signer.');
    if (protocol.signoffs.some(s => s.person_id === p.person_id)) bad('The person ' + p.person_id + ' has already answered.');
    const state = views.protocolState(protocol, t.now);
    if (state !== 'proposed') bad('The version is ' + state + '. Only a proposed version takes an answer.');
    const answer = {person_id: p.person_id, answer: p.answer, at: t.at, note: p.note ?? null, request_id: null, event_id: t.ref};
    protocol.signoffs.push(answer);
    c.record(t, data, 'protocol.answered', protocol.id, false, protocol.history, {answer: p.answer});
    ops.settle(t, data, protocol);
    const notify = protocol.proposed_by === data.owner_person_id || data.project.policy.required_signers.includes(data.owner_person_id);
    return {object: protocol.id, notify, kind: 'protocol.updated', details: {protocol, answer}};
  },
  'protocol.withdrawn'(t, data, p) {
    const protocol = exists(data.protocols, p.protocol_id, 'protocol version');
    if (c.isOwner(data, protocol.proposed_by)) bad('An event cannot withdraw the account holder\'s version.');
    const state = views.protocolState(protocol, t.now);
    if (state !== 'proposed') bad('The version is ' + state + '. Only a proposed version can be withdrawn.');
    Object.assign(protocol, {stored_state: 'withdrawn', withdrawn_at: t.at, withdraw_note: p.note ?? null});
    c.record(t, data, 'protocol.withdrawn', protocol.id, false, protocol.history);
    const notify = data.project.policy.required_signers.includes(data.owner_person_id);
    return {object: protocol.id, notify, kind: 'protocol.updated', details: {protocol, withdrawn: {note: p.note ?? null}}};
  },
  'result.invalidated'(t, data, p) {
    const job = exists(data.jobs, p.job_id, 'job');
    known(data, p.invalidated_by);
    if (!views.hasResult(job, t.now)) bad('The job ' + job.id + ' has no result.');
    job.invalidation = {by: p.invalidated_by, at: t.at, reason: p.reason ?? null, event_id: t.ref};
    c.record(t, data, 'result.invalidated', job.id, false, job.history);
    const tables = data.tables.filter(x => x.stored_state !== 'discarded' && x.rows.some(r => r.result_ids.includes(job.id))).map(x => x.id);
    return {object: job.id, notify: c.isOwner(data, job.owner_person_id) || tables.length > 0, details: {job, tables}};
  }
};
function applyEvent(ctx, data, event) {
  const kind = event.operation.startsWith(A) ? event.operation.slice(A.length) : '';
  if (!handlers[kind]) bad('Unsupported operation.');
  const t = {ctx, at: event.at, now: ms(event.at), actor: 'event', ref: event.event_id};
  const out = handlers[kind](t, data, event.payload);
  if (out.notify) notices.write(t, data, out.kind || kind, out.object, out.details || {});
  // The same rules as a seed. A failure rejects the event and leaves the state unchanged.
  rules.validate(ctx, data, 'invalid_event');
  return data;
}
module.exports = {applyEvent};
