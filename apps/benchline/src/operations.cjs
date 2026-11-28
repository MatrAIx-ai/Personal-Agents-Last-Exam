'use strict';
const c = require('./common.cjs');
const views = require('./views.cjs');
const notices = require('./notices.cjs');
const {sha256, canonical} = require('./sha256.cjs');
const {ms, time, fail, copy, hours, hundredths} = c;
const A = c.APP + '.';

// `start` and `end` of a list are calendar days in the project's time zone, both included.
function window(args) {
  if (args.start !== undefined && args.end !== undefined && args.end < args.start) fail('invalid_window', 'The window ends before it starts.');
  return day => (args.start === undefined || day >= args.start) && (args.end === undefined || day <= args.end);
}
const decimals = (...values) => { if (values.some(v => v !== undefined && !c.twoDecimals(v))) fail('invalid_arguments', 'An hour value has at most two decimals.'); };
const jobOf = (data, id) => c.find(data.jobs, id, 'job');
const protocolOf = (data, id) => c.find(data.protocols, id, 'protocol version');
const tableOf = (data, id) => c.find(data.tables, id, 'table version');
const own = (data, personId, what) => { if (!c.isOwner(data, personId)) fail('not_yours', 'This ' + what + ' belongs to ' + c.nameOf(data, personId) + '.'); };
const FIRST = ['time_limit_too_long', 'protocol_mismatch', 'too_many_active', 'over_allocation', 'over_share'];
const MESSAGES = {
  time_limit_too_long: ({partition}) => 'The time limit is longer than ' + partition.max_hours + ' hours, the longest job time of ' + partition.id + '.',
  protocol_mismatch: ({protocol}) => 'The protocol version ' + protocol.id + ' does not cover this config and seed.',
  too_many_active: ({data}) => 'You already have ' + data.project.policy.max_active_jobs + ' jobs queued, held or running.',
  over_allocation: ({check}) => 'The job needs ' + c.hoursText(check.reserve) + ' GPU-hours, and the project has ' + c.hoursText(Math.max(0, check.projectLeft + check.reserve)) + ' left.',
  over_share: ({check}) => 'The job needs ' + c.hoursText(check.reserve) + ' GPU-hours, and your share has ' + c.hoursText(Math.max(0, check.shareLeft + check.reserve)) + ' left.'
};
const refuse = (data, check) => { const code = FIRST.find(x => check.failures.includes(x)); if (code) fail(code, MESSAGES[code]({data, check, partition: check.partition, protocol: check.protocol})); };

// The run plan that a job gets when it is submitted or released: the most specific plan for its config.
// A plan that names the seed and the partition is the most specific. Between one that names only the seed and one that names only the partition, the seed wins.
function planFor(data, job) {
  const score = p => (p.seed === null ? 0 : 2) + (p.partition_id === null ? 0 : 1);
  const fits = data.run_plans.filter(p => p.config_id === job.config_id && (p.seed === null || p.seed === job.seed) && (p.partition_id === null || p.partition_id === job.partition_id));
  return fits.sort((a, b) => score(b) - score(a) || c.compare(a.id, b.id))[0] || null;
}
// A copy of the plan, with the start and the end from `from`. A time limit shorter than the run time ends the job `timed_out`.
function runOf(data, job, from) {
  const plan = planFor(data, job);
  if (!plan) return null;
  const starts = from + plan.queue_wait_minutes * 60000, limit = hundredths(job.time_limit_hours) * 36000, run = plan.run_minutes * 60000;
  const short = limit < run, zone = c.zone(data);
  return {plan_id: plan.id, starts_at: time.iso(starts, zone), ends_at: time.iso(starts + (short ? limit : run), zone),
    end_kind: short ? 'timed_out' : plan.outcome, metrics: !short && plan.outcome === 'completed' ? copy(plan.metrics) : null, error: !short && plan.outcome === 'failed' ? plan.error : null};
}
// Adds a job of the account holder, from the Agent or from a script, as jobs.submit says.
function addJob(t, data, args, check, by, script) {
  const hold = args.hold === true;
  const job = {id: c.nextId(c.allIds(data), 'job-a'), owner_person_id: data.owner_person_id, submitted_by: by, script, config_id: args.config_id, seed: args.seed,
    partition_id: args.partition_id, gpus: args.gpus, time_limit_hours: args.time_limit_hours, protocol_id: args.protocol_id ?? null, period_id: data.allocation.period_id,
    submitted_at: t.at, stored_state: hold ? 'held' : 'queued', hold_reason: hold ? 'submitted_held' : null, run: null, cancelled_at: null, interrupted_at: null,
    interrupt_reason: null, review: null, invalidation: null, request_id: t.actor === 'agent' ? t.ref : null, event_id: t.actor === 'event' ? t.ref : null, history: []};
  if (!hold) job.run = runOf(data, job, t.now);
  data.jobs.push(job);
  c.record(t, data, by === 'script' ? 'job.script_submitted' : 'jobs.submit', job.id, false, job.history, {state: job.stored_state});
  if (!hold) notices.jobEnded(t, data, job);
  return job;
}
const submitArgs = args => ({config_id: args.id, seed: args.seed, partition_id: args.partition_id, gpus: args.gpus, time_limit_hours: args.time_limit_hours,
  protocol_id: args.protocol_id ?? null, hold: args.hold === true});
const estimateView = check => ({allowed: check.failures.length === 0, failures: check.failures, reserve_hours: hours(check.reserve),
  project_left: hours(check.projectLeft), share_left: check.shareLeft === null ? null : hours(check.shareLeft), flags: check.flags});

// Protocol versions.
function nextVersion(data, line) {
  const list = data.protocols.filter(p => p.line === line), n = Math.max(0, ...list.map(p => p.version)) + 1;
  const newest = list.slice().sort((a, b) => b.version - a.version)[0], match = /^(.*)-v\d+$/.exec(newest.id), prefix = match ? match[1] : line;
  let id = prefix + '-v' + n, k = n;
  const taken = new Set(c.allIds(data));
  while (taken.has(id)) id = prefix + '-v' + (++k);
  return {id, version: n};
}
const sameSpec = (a, b) => a.dataset_version === b.dataset_version && a.eval_split === b.eval_split && canonical(a.metrics) === canonical(b.metrics) &&
  canonical(a.seeds.slice().sort((x, y) => x - y)) === canonical(b.seeds.slice().sort((x, y) => x - y));
// After an answer: the last required signature signs the version and supersedes the earlier signed one. A decline by a required signer declines it.
function settle(t, data, p) {
  if (p.signoffs.some(s => s.answer === 'decline')) {
    Object.assign(p, {stored_state: 'declined', declined_at: t.at});
    return 'declined';
  }
  if (views.missingSigners(data, p).length) return 'proposed';
  const earlier = data.protocols.find(x => x !== p && x.line === p.line && x.stored_state === 'signed');
  Object.assign(p, {stored_state: 'signed', signed_at: t.at, supersedes: earlier ? earlier.id : null});
  if (earlier) {
    Object.assign(earlier, {stored_state: 'superseded', superseded_at: t.at, superseded_by: p.id});
    c.record(t, data, 'protocol.superseded', earlier.id, true, earlier.history);
  }
  return 'signed';
}
function propose(t, data, spec) {
  const respond = time.iso(time.addDaysAt(t.now, data.project.policy.signoff_window_days, c.zone(data)), c.zone(data));
  const p = {id: spec.id, line: spec.line, version: spec.version, dataset_version: spec.dataset_version, eval_split: spec.eval_split, metrics: copy(spec.metrics),
    seeds: copy(spec.seeds), proposed_by: spec.proposed_by, proposed_at: t.at, rationale: spec.rationale ?? null, respond_by: respond, stored_state: 'proposed',
    signoffs: [], signed_at: null, supersedes: null, superseded_at: null, superseded_by: null, declined_at: null, withdrawn_at: null, withdraw_note: null,
    request_id: t.actor === 'agent' ? t.ref : null, event_id: t.actor === 'event' ? t.ref : null, history: []};
  // A proposer who is a required signer has signed by proposing.
  if (data.project.policy.required_signers.includes(p.proposed_by)) p.signoffs.push({person_id: p.proposed_by, answer: 'sign', at: t.at, note: null, request_id: p.request_id, event_id: p.event_id});
  data.protocols.push(p);
  return p;
}
const lineState = (data, line, now) => data.protocols.filter(p => p.line === line);
const openProposal = (data, line, now) => lineState(data, line, now).find(p => views.protocolState(p, now) === 'proposed') || null;

// Tables.
function checkRows(data, table, rows, now) {
  const jobs = rows.map(r => r.result_ids.map(id => jobOf(data, id)));
  if (table.stored_state !== 'draft') fail('invalid_state', 'The table version is ' + table.stored_state + '. Only a draft can change.');
  for (const job of jobs.flat()) if (!views.hasResult(job, now)) fail('not_completed', 'The job ' + job.id + ' has no result yet.');
  for (const job of jobs.flat()) if (job.protocol_id !== table.protocol_id) fail('mixed_protocols', 'The result of ' + job.id + ' was run under ' + (job.protocol_id || 'no protocol') + ', not ' + table.protocol_id + '.');
  const ids = rows.flatMap(r => r.result_ids);
  const twice = ids.find((id, i) => ids.indexOf(id) !== i);
  if (twice) fail('duplicate_result', 'The table cites the result of ' + twice + ' twice.');
}
function manifestOf(data, table, now) {
  const p = protocolOf(data, table.protocol_id), jobs = new Map(data.jobs.map(j => [j.id, j]));
  const rows = table.rows.map(row => {
    const list = row.result_ids.map(id => jobs.get(id)).sort((a, b) => a.seed - b.seed);
    const metrics = {};
    for (const m of p.metrics) metrics[m.name] = views.stats(list.map(j => j.run.metrics[m.name]).filter(v => typeof v === 'number'));
    return {name: row.name, config_id: list[0].config_id, seeds: list.map(j => j.seed), result_ids: list.map(j => j.id), metrics};
  });
  const body = {table_id: table.table_id, version: table.version, title: table.title, protocol_id: p.id, metrics: copy(p.metrics), rows, frozen_at: time.iso(now, c.zone(data))};
  return {...body, content_hash: 'sha256:' + sha256(canonical(body))};
}

const reads = {
  'project.get'(data) {
    return {account_id: data.account_id, owner_person_id: data.owner_person_id, project: copy(data.project), partitions: copy(data.partitions), people: copy(data.people),
      allocation: copy(data.allocation), past_periods: copy(data.past_periods), allocation_changes: data.allocation_changes.slice().sort(c.byTime('at')).map(copy)};
  },
  'usage.summary': (data, args, now) => ({usage: views.usage(data, now)}),
  'configs.list': (data, args) => ({items: data.configs.filter(x => args.family === undefined || x.family === args.family).sort(c.byTime('registered_at')).map(copy)}),
  'configs.get': (data, args) => ({config: copy(c.find(data.configs, args.id, 'config'))}),
  'jobs.list'(data, args, now) {
    const inside = window(args), over = views.overShare(data, now);
    return {items: data.jobs.filter(j => inside(c.dayOf(data, j.submitted_at)) && (args.owner_person_id === undefined || j.owner_person_id === args.owner_person_id) &&
      (args.state === undefined || views.jobState(j, now) === args.state) && (args.config_id === undefined || j.config_id === args.config_id) &&
      (args.protocol_id === undefined || j.protocol_id === args.protocol_id)).sort(c.byTime('submitted_at')).map(j => views.jobView(data, j, now, over))};
  },
  'jobs.get'(data, args, now) {
    const job = jobOf(data, args.id), visible = job.history.filter(h => ms(h.at) <= now);
    return {job: {...views.jobView(data, job, now), history: copy(visible)}, result: views.hasResult(job, now) ? views.resultView(data, job, now) : null};
  },
  'jobs.estimate'(data, args, now) {
    decimals(args.time_limit_hours);
    return {estimate: estimateView(views.check(data, submitArgs(args), now, {hold: args.hold === true}))};
  },
  'results.list'(data, args, now) {
    const inside = window(args);
    return {items: data.jobs.filter(j => views.hasResult(j, now) && inside(c.dayOf(data, j.run.ends_at)) && (args.owner_person_id === undefined || j.owner_person_id === args.owner_person_id) &&
      (args.config_id === undefined || j.config_id === args.config_id) && (args.protocol_id === undefined || j.protocol_id === args.protocol_id))
      .map(j => views.resultView(data, j, now)).filter(r => args.state === undefined || r.state === args.state).sort(c.byTime('completed_at'))};
  },
  'results.compare'(data, args, now) {
    const jobs = args.ids.map(id => jobOf(data, id));
    for (const j of jobs) if (!views.hasResult(j, now)) fail('not_completed', 'The job ' + j.id + ' has no result yet.');
    const protocols = jobs.map(j => j.protocol_id === null ? null : protocolOf(data, j.protocol_id)), differences = [];
    const values = key => Object.fromEntries(jobs.map((j, i) => [j.id, protocols[i] === null ? null : copy(protocols[i][key])]));
    if (new Set(jobs.map(j => j.protocol_id)).size > 1) differences.push({field: 'protocol_id', values: Object.fromEntries(jobs.map(j => [j.id, j.protocol_id]))});
    for (const key of ['dataset_version', 'eval_split', 'metrics', 'seeds']) {
      if (new Set(protocols.map(p => p === null ? 'null' : canonical(p[key]))).size > 1) differences.push({field: key, values: values(key)});
    }
    return {comparable: protocols.every(p => p !== null) && new Set(jobs.map(j => j.protocol_id)).size === 1, protocol_ids: jobs.map(j => j.protocol_id),
      differences, results: jobs.map(j => views.resultView(data, j, now))};
  },
  'protocols.list': (data, args, now) => ({items: data.protocols.filter(p => (args.line === undefined || p.line === args.line) && (args.state === undefined || views.protocolState(p, now) === args.state))
    .sort(c.byTime('proposed_at')).map(p => views.protocolView(data, p, now))}),
  'protocols.get': (data, args, now) => ({protocol: views.protocolView(data, protocolOf(data, args.id), now)}),
  'tables.list': (data, args, now) => ({items: data.tables.filter(t => (args.state === undefined || t.stored_state === args.state) && (args.protocol_id === undefined || t.protocol_id === args.protocol_id))
    .sort(c.byTime('created_at')).map(t => views.tableRow(data, t, now))}),
  'tables.get': (data, args, now) => ({table: views.tableView(data, tableOf(data, args.id), now)}),
  'notifications.list'(data, args, now) {
    const inside = window(args);
    return {items: data.notifications.filter(n => views.listed(n, now) && inside(c.dayOf(data, n.at))).sort(c.byTime('at')).map(n => ({id: n.id, at: n.at, kind: n.kind,
      event_id: n.event_id, request_id: n.request_id, object_type: n.object_type, object_id: n.object_id, title: n.title, text: n.text, details: copy(n.details), email_stored: n.email !== null}))};
  },
  'preferences.get': data => ({preferences: copy(data.preferences)})
};

const writes = {
  'jobs.submit'(t, data, args) {
    decimals(args.time_limit_hours);
    const check = views.check(data, submitArgs(args), t.now, {hold: args.hold === true});
    refuse(data, check);
    const job = addJob(t, data, submitArgs(args), check, 'agent', null);
    return {id: job.id, config_id: job.config_id, state: job.stored_state, hold_reason: job.hold_reason, reserved_hours: job.stored_state === 'held' ? 0 : hours(check.reserve), flags: check.flags};
  },
  'jobs.hold'(t, data, args) {
    const job = jobOf(data, args.id);
    own(data, job.owner_person_id, 'job');
    const state = views.jobState(job, t.now);
    if (state !== 'queued') fail('invalid_state', 'The job is ' + state + '. Only a queued job can be held.');
    Object.assign(job, {stored_state: 'held', hold_reason: 'agent', run: null});
    c.record(t, data, 'jobs.hold', job.id, false, job.history, {state: 'held'});
    notices.removeJobEnded(t, data, job);
    return {id: job.id, state: 'held', hold_reason: 'agent'};
  },
  'jobs.release'(t, data, args) {
    const job = jobOf(data, args.id);
    own(data, job.owner_person_id, 'job');
    if (job.stored_state !== 'held') fail('invalid_state', 'The job is ' + views.jobState(job, t.now) + '. Only a held job can be released.');
    const check = views.check(data, job, t.now, {self: job});
    refuse(data, check);
    Object.assign(job, {stored_state: 'queued', hold_reason: null});
    job.run = runOf(data, job, t.now);
    c.record(t, data, 'jobs.release', job.id, false, job.history, {state: 'queued'});
    notices.jobEnded(t, data, job);
    return {id: job.id, state: 'queued', reserved_hours: hours(check.reserve), flags: check.flags};
  },
  'jobs.cancel'(t, data, args) {
    const job = jobOf(data, args.id);
    own(data, job.owner_person_id, 'job');
    const state = views.jobState(job, t.now);
    if (!views.ACTIVE.has(state)) fail('invalid_state', 'The job is ' + state + '. Only a queued, held or running job can be cancelled.');
    Object.assign(job, {stored_state: 'cancelled', cancelled_at: t.at, hold_reason: null});
    c.record(t, data, 'jobs.cancel', job.id, false, job.history, {state: 'cancelled'});
    notices.removeJobEnded(t, data, job);
    return {id: job.id, state: 'cancelled', charged_hours: hours(views.chargeOf(data, job, t.now))};
  },
  'results.update'(t, data, args) {
    const job = jobOf(data, args.id);
    own(data, job.owner_person_id, 'result');
    if (!views.hasResult(job, t.now)) fail('not_completed', 'The job is ' + views.jobState(job, t.now) + '. It has no result yet.');
    if (args.disposition === 'excluded' && !args.reason) fail('reason_required', 'Give a reason to exclude a result.');
    const review = job.review || {tags: [], note: null, excluded: false, reason: null, updated_at: null};
    if (args.tags !== undefined) review.tags = [...new Set(args.tags)];
    if (args.note !== undefined) review.note = args.note;
    if (args.disposition !== undefined) Object.assign(review, {excluded: args.disposition === 'excluded', reason: args.disposition === 'excluded' ? args.reason : null});
    review.updated_at = t.at;
    job.review = review;
    c.record(t, data, 'results.update', job.id, false, job.history, {disposition: review.excluded ? 'excluded' : 'candidate'});
    return {id: job.id, state: review.excluded ? 'excluded' : 'candidate', tags: copy(review.tags), note: review.note};
  },
  'protocols.propose'(t, data, args) {
    if (!data.protocols.some(p => p.line === args.id)) fail('not_found', 'No protocol line has the name ' + args.id + '.');
    const open = openProposal(data, args.id, t.now);
    if (open) fail('already_proposed', 'The line ' + args.id + ' already has the proposed version ' + open.id + '.');
    const signed = data.protocols.find(p => p.line === args.id && p.stored_state === 'signed');
    if (signed && sameSpec(signed, args)) fail('no_change', 'The new version is the same as the signed version ' + signed.id + '.');
    const p = propose(t, data, {...args, ...nextVersion(data, args.id), line: args.id, proposed_by: data.owner_person_id});
    c.record(t, data, 'protocols.propose', p.id, false, p.history);
    const state = settle(t, data, p);
    return {id: p.id, state, respond_by: p.respond_by, missing_signers: views.missingSigners(data, p)};
  },
  'protocols.respond'(t, data, args) {
    const p = protocolOf(data, args.id);
    if (!data.project.policy.required_signers.includes(data.owner_person_id)) fail('not_a_signer', 'You are not a required signer of this project.');
    const state = views.protocolState(p, t.now);
    if (state !== 'proposed') fail('invalid_state', 'The version is ' + state + '. Only a proposed version takes an answer.');
    if (p.signoffs.some(s => s.person_id === data.owner_person_id)) fail('already_answered', 'You have already answered this version.');
    p.signoffs.push({person_id: data.owner_person_id, answer: args.answer, at: t.at, note: args.note ?? null, request_id: t.ref, event_id: null});
    c.record(t, data, 'protocols.respond', p.id, false, p.history, {answer: args.answer});
    return {id: p.id, state: settle(t, data, p), missing_signers: views.missingSigners(data, p)};
  },
  'protocols.withdraw'(t, data, args) {
    const p = protocolOf(data, args.id);
    own(data, p.proposed_by, 'proposal');
    const state = views.protocolState(p, t.now);
    if (state !== 'proposed') fail('invalid_state', 'The version is ' + state + '. Only a proposed version can be withdrawn.');
    Object.assign(p, {stored_state: 'withdrawn', withdrawn_at: t.at, withdraw_note: args.note ?? null});
    c.record(t, data, 'protocols.withdraw', p.id, false, p.history);
    return {id: p.id, state: 'withdrawn'};
  },
  'tables.create'(t, data, args) {
    const p = protocolOf(data, args.id), tableId = c.nextId(c.allIds(data).concat(data.tables.map(x => x.table_id)), 'tbl-');
    const table = {id: tableId + '.v1', table_id: tableId, version: 1, title: args.title, protocol_id: p.id, stored_state: 'draft', rows: [], created_at: t.at,
      frozen_at: null, superseded_at: null, discarded_at: null, revises: null, manifest: null, request_id: t.ref, history: []};
    data.tables.push(table);
    c.record(t, data, 'tables.create', table.id, false, table.history);
    return {id: table.id, table_id: tableId, table_version: 1, state: 'draft'};
  },
  'tables.update'(t, data, args) {
    const table = tableOf(data, args.id);
    const names = args.rows.map(r => r.name);
    if (new Set(names).size !== names.length) fail('invalid_arguments', 'Two rows have the same name.');
    checkRows(data, table, args.rows, t.now);
    table.rows = args.rows.map(r => ({name: r.name, result_ids: r.result_ids.slice()}));
    c.record(t, data, 'tables.update', table.id, false, table.history, {rows: table.rows.length});
    return {id: table.id, state: 'draft', rows: table.rows.length, flags: views.tableFlags(data, table, t.now)};
  },
  'tables.freeze'(t, data, args) {
    const table = tableOf(data, args.id);
    if (table.stored_state !== 'draft') fail('invalid_state', 'The table version is ' + table.stored_state + '. Only a draft can be frozen.');
    const flags = views.tableFlags(data, table, t.now), p = protocolOf(data, table.protocol_id), state = views.protocolState(p, t.now);
    if (flags.includes('empty_table')) fail('empty_table', 'The table has no rows.');
    if (state !== 'signed' && state !== 'superseded') fail('protocol_not_signed', 'The protocol version ' + p.id + ' is ' + state + '. A table is frozen only under a signed or superseded version.');
    if (flags.includes('incomplete_seeds')) fail('incomplete_seeds', 'Each row needs exactly one result for each seed of ' + p.id + ' (' + p.seeds.join(', ') + '), all from one config.');
    if (flags.includes('cites_excluded')) fail('cites_excluded', 'The table cites an excluded result.');
    if (flags.includes('cites_invalidated')) fail('cites_invalidated', 'The table cites an invalidated result.');
    Object.assign(table, {stored_state: 'frozen', frozen_at: t.at, manifest: manifestOf(data, table, t.now)});
    c.record(t, data, 'tables.freeze', table.id, false, table.history);
    const earlier = table.revises === null ? null : data.tables.find(x => x.id === table.revises);
    if (earlier && earlier.stored_state === 'frozen') {
      Object.assign(earlier, {stored_state: 'superseded', superseded_at: t.at});
      c.record(t, data, 'table.superseded', earlier.id, true, earlier.history);
    }
    return {id: table.id, state: 'frozen', content_hash: table.manifest.content_hash, superseded: earlier ? earlier.id : null};
  },
  'tables.revise'(t, data, args) {
    const frozen = tableOf(data, args.id), family = data.tables.filter(x => x.table_id === frozen.table_id);
    const latest = family.filter(x => x.stored_state === 'frozen').sort((a, b) => b.version - a.version)[0];
    if (frozen.stored_state !== 'frozen' || latest !== frozen || family.some(x => x.stored_state === 'draft')) {
      fail('invalid_state', 'Only the latest frozen version of a table with no draft can be revised.');
    }
    const version = Math.max(...family.map(x => x.version)) + 1;
    const table = {id: frozen.table_id + '.v' + version, table_id: frozen.table_id, version, title: frozen.title, protocol_id: frozen.protocol_id, stored_state: 'draft',
      rows: copy(frozen.rows), created_at: t.at, frozen_at: null, superseded_at: null, discarded_at: null, revises: frozen.id, manifest: null, request_id: t.ref, history: []};
    if (c.allIds(data).includes(table.id)) fail('invalid_state', 'The ID ' + table.id + ' is in use.');
    data.tables.push(table);
    c.record(t, data, 'tables.revise', table.id, false, table.history, {from: frozen.id});
    return {id: table.id, table_version: version, state: 'draft', revises: frozen.id};
  },
  'tables.discard'(t, data, args) {
    const table = tableOf(data, args.id);
    if (table.stored_state !== 'draft') fail('invalid_state', 'The table version is ' + table.stored_state + '. Only a draft can be discarded.');
    Object.assign(table, {stored_state: 'discarded', discarded_at: t.at});
    c.record(t, data, 'tables.discard', table.id, false, table.history);
    return {id: table.id, state: 'discarded'};
  },
  'preferences.update'(t, data, args) {
    if (args.timezone === undefined && args.email_notices === undefined && args.job_end_notices === undefined) fail('invalid_arguments', 'Give the time zone, email_notices or job_end_notices.');
    if (args.timezone !== undefined && !time.validZone(args.timezone)) fail('invalid_timezone', 'The time zone is unknown. Use an IANA name such as America/New_York.');
    for (const key of ['timezone', 'email_notices', 'job_end_notices']) if (args[key] !== undefined) data.preferences[key] = args[key];
    c.record(t, data, 'preferences.update', data.account_id);
    return {id: data.account_id, preferences: copy(data.preferences)};
  }
};
function handleTool(ctx, data, name, args) {
  const short = name.startsWith(A) ? name.slice(A.length) : '', now = ms(ctx.virtual_now);
  if ([args.start, args.end].some(day => day !== undefined && !time.validDay(day))) fail('invalid_arguments', 'A day is not a real calendar date. Use YYYY-MM-DD.');
  if (reads[short]) return {data, result: {...reads[short](data, args, now), now: time.iso(now, c.zone(data))}};
  if (!writes[short]) fail('unknown_tool', 'Unknown Benchline operation.');
  const result = writes[short]({ctx, at: ctx.virtual_now, now, actor: 'agent', ref: args.request_id}, data, args);
  return {data, result};
}
module.exports = {handleTool, addJob, runOf, planFor, propose, settle, nextVersion, submitArgs, MESSAGES, FIRST};
