'use strict';
// Writes the delivery dataset in data/evaluation/: two years (2025 and 2026) of one fictional lab's compute and results, seen from Nadia's account.
// It builds stories from the templates of dev/evaluation-scenarios.cjs with a seeded PRNG. Each story fixes all its parts together: a campaign with its
// config, run plans, seeds, jobs and results; a protocol change with its rationale and answers; an allocation change; a paper table with its freeze and
// its correction; a script sweep; a node failure. Then it replays every step in time order through the App's own hooks, so the App made every
// job of Nadia, every hold, sign-off, table, manifest and notification. A new quarter is history that a task loads, so it is written into the data.
// Run `node dev/generate-dataset.cjs` after a change, or with `--check` to compare with the committed files. Never used at run time.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const plugin = require('../plugin.cjs');
const time = require('../src/time.cjs');
const views = require('../src/views.cjs');
const {records} = require('../src/model.cjs');
const {at} = require('./replay.cjs');
const S = require('./evaluation-scenarios.cjs');

const VERSION = '1.0.0', PRNG_SEED = 20250101, ZONE = 'America/New_York';
const ROOT = path.resolve(__dirname, '..'), OUT = path.join(ROOT, 'data/evaluation');
const ACCOUNT = 'benchline-nadia', OWNER = 'person-nadia';
const START = '2025-01-01T00:00:00-05:00', CLOCK = '2026-12-31T23:00:00-05:00';
const MONTH_STARTS = [];
for (let year = 2025; year <= 2026; year++) for (let month = 1; month <= 12; month++) MONTH_STARTS.push(at(year + '-' + String(month).padStart(2, '0') + '-01 00:00'));
// Core reads one request line of at most 2 MiB, and env.load_seed sends the whole seed in one line. Keep a margin.
const REQUEST_LIMIT = 1.8 * 1024 * 1024;
const ms = Date.parse, pad = (n, size = 4) => String(n).padStart(size, '0');
const {addDays, weekday} = time;
const binding = require('../fixtures/binding.json');

// mulberry32: a small PRNG with a fixed seed.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let random;
const between = (low, high) => low + Math.floor(random() * (high - low + 1));
const chance = p => random() < p;
const pick = list => list[Math.floor(random() * list.length)];
const round3 = v => Math.round(v * 1000) / 1000;
const HOLIDAYS = new Set(S.HOLIDAYS);
const working = day => weekday(day) % 6 !== 0 && !HOLIDAYS.has(day);
const minutes = hhmm => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hhmm = m => pad(Math.floor(m / 60), 2) + ':' + pad(m % 60, 2);
const local = (day, from, to) => at(day + ' ' + hhmm(between(minutes(from), minutes(to))));
const nextWorking = day => { let d = addDays(day, 1); while (!working(d)) d = addDays(d, 1); return d; };
const dayOf = value => time.localDay(ms(value), ZONE);
const shift = (value, mins) => time.iso(ms(value) + mins * 60000, ZONE);
const eraOf = day => S.ERAS.filter(e => e.from <= day).pop();
const quarterOf = day => S.QUARTERS.find(q => q.from <= day && day <= q.to);

// The configs: one subject-level config of each family for each dataset era, and the variants for the other splits.
function configs() {
  const out = [], counters = {};
  const add = (family, dataset, split, suffix, when, by) => {
    const f = S.FAMILIES.find(x => x.family === family), key = family + suffix;
    counters[key] = (counters[key] || 0) + 1;
    const params = {...f.params, lr: round3(f.params.lr * (1 - 0.1 * (counters[key] - 1)) * 1000) / 1000};
    out.push({id: 'cfg-' + family + suffix + '-v' + counters[key], family, version: counters[key], params, dataset_version: dataset, eval_split: split,
      code_ref: crypto.createHash('sha256').update(family + suffix + counters[key]).digest('hex').slice(0, 7), registered_by: by, registered_at: when});
  };
  S.ERAS.forEach((era, i) => {
    for (const f of S.FAMILIES) {
      const owner = f.owner === 'person-ines' && era.from < S.JOINS['person-ines'] ? 'person-tomas' : f.owner;
      const day = i === 0 ? '2024-12-0' + (2 + S.FAMILIES.indexOf(f) % 6) : (() => { let d = addDays(era.from, 1 + S.FAMILIES.indexOf(f)); while (!working(d)) d = addDays(d, 1); return d; })();
      add(f.family, era.dataset, 'test-subjects', '', at(day + ' ' + hhmm(600 + 13 * S.FAMILIES.indexOf(f))), owner);
    }
  });
  const variants = [['vit-s16', '-sess', 'test-sessions', [0, 1, 2, 3]], ['conformer', '-trial', 'test-trials', [0, 2]], ['atlas', '-xfer', 'held-out-site', [0, 1]],
    ['mae-b16', '-rob', 'noisy-subjects', [0, 2]]];
  for (const [family, suffix, split, eras] of variants) for (const i of eras) {
    const era = S.ERAS[i], day = i === 0 ? '2024-12-10' : nextWorking(addDays(era.from, 8));
    add(family, era.dataset, split, suffix, at(day + ' 11:' + pad(10 + eras.indexOf(i) * 7, 2)), S.FAMILIES.find(x => x.family === family).owner);
  }
  return out;
}

// The lab before the window: Q1 2025, the first configs and the first signed version of each protocol line.
function base(allConfigs) {
  const shares = {...S.SHARES, 'person-ines': null};
  return {
    account_id: ACCOUNT, owner_person_id: OWNER,
    project: {id: 'proj-okafor-eeg', name: 'Okafor Lab: EEG decoding', cluster: 'Halden research cluster', timezone: ZONE, lab_head_person_id: 'person-okafor',
      policy: {hard_shares: false, max_active_jobs: 6, required_signers: ['person-okafor', 'person-nadia'], signoff_window_days: 10}},
    partitions: [{id: 'gpu-h', name: 'H100 nodes', rate: 2, max_hours: 24}, {id: 'gpu-a', name: 'A100 nodes', rate: 1, max_hours: 48}, {id: 'cpu', name: 'CPU nodes', rate: 0, max_hours: 72}],
    people: S.PEOPLE.map(p => ({...p, share_hours: shares[p.person_id] ?? null})),
    allocation: {period_id: 'alloc-2025-q1', label: 'Q1 2025', starts_at: at('2025-01-01 00:00'), ends_at: at('2025-03-31 23:59:59'), opening_hours: 7200, allocation_hours: 7200,
      opening_shares: Object.entries(shares).map(([person_id, share_hours]) => ({person_id, share_hours}))},
    past_periods: [{period_id: 'alloc-2024-q4', label: 'Q4 2024', starts_at: at('2024-10-01 00:00'), ends_at: at('2024-12-31 23:59:59'), opening_hours: 6800, allocation_hours: 6800}],
    allocation_changes: [],
    configs: allConfigs.filter(c => c.registered_at < START).map(c => ({...c, event_id: null})),
    protocols: S.LINES.map((l, i) => {
      const when = at('2024-11-' + pad(4 + i * 3, 2) + ' 10:00'), signed = at('2024-11-' + pad(5 + i * 3, 2) + ' 15:00');
      return {id: l.prefix + '-v1', line: l.line, version: 1, dataset_version: S.ERAS[0].dataset, eval_split: l.split, metrics: l.metrics, seeds: l.seeds, proposed_by: 'person-okafor',
        proposed_at: when, rationale: 'The first protocol of the line.', respond_by: time.iso(time.addDaysAt(ms(when), 10, ZONE), ZONE), stored_state: 'signed',
        signoffs: [{person_id: 'person-okafor', answer: 'sign', at: when, note: null, request_id: null, event_id: null}, {person_id: OWNER, answer: 'sign', at: signed, note: null, request_id: null, event_id: null}],
        signed_at: signed, supersedes: null, superseded_at: null, superseded_by: null, declined_at: null, withdrawn_at: null, withdraw_note: null, request_id: null, event_id: null, history: []};
    }),
    run_plans: [], jobs: [], tables: [],
    preferences: {timezone: ZONE, email_notices: false, job_end_notices: true},
    notifications: [], activity: []
  };
}

// Story building. A step is {at, call, args} or {at, event, payload} or {at, edit}. An args or payload function can return SKIP(reason) when the act
// does not happen at that time (for example a release of a job that is not held). Such a step is listed in manifest.skipped with its reason.
// Every other step must commit: the replay stops on any step that the App refuses.
let stories, steps, evn, rqn;
const SKIP = reason => ({skip: reason});
function story(template, details = {}) { const s = {id: 'st-' + pad(stories.length + 1), template, ...details, steps: []}; stories.push(s); return s; }
function add(s, step) { step.story = s.id; s.steps.push(step); steps.push(step); return step; }
const ev = (s, when, name, payload, more = {}) => add(s, {at: when, event: name, event_id: 'ev-ds-' + pad(++evn, 5), payload, ...more});
const call = (s, when, name, args, more = {}) => add(s, {at: when, call: name, args, request_id: 'req-ds-' + pad(++rqn, 5), ...more});

// The protocol changes of the window, as [line, day, change, proposer, outcome, values]. The outcome is how the signers answer.
const PROTOCOL_STORIES = [
  ['subject-eval', '2025-06-23', 'dataset', 'person-mei', 'signed', {dataset_version: 'eeg-subjects-2025.2'}],
  ['session-eval', '2025-07-07', 'dataset', 'person-tomas', 'signed', {dataset_version: 'eeg-subjects-2025.2'}],
  ['transfer-eval', '2025-07-14', 'dataset', 'person-mei', 'signed', {dataset_version: 'eeg-subjects-2025.2'}],
  ['subject-eval', '2025-09-15', 'seeds', 'person-tomas', 'declined_by_nadia', {seeds: [0, 1, 2, 3, 4]}],
  ['trial-eval', '2025-11-04', 'metrics', 'person-tomas', 'expired', {metrics: [{name: 'accuracy', direction: 'higher'}, {name: 'macro_f1', direction: 'higher'}, {name: 'kappa', direction: 'higher'}]}],
  ['subject-eval', '2026-02-09', 'dataset', 'person-mei', 'signed', {dataset_version: 'eeg-subjects-2026.1'}],
  ['session-eval', '2026-02-11', 'dataset', 'person-tomas', 'signed', {dataset_version: 'eeg-subjects-2026.1'}],
  ['robust-eval', '2026-02-17', 'dataset', 'person-farid', 'signed', {dataset_version: 'eeg-subjects-2026.1'}],
  ['subject-eval', '2026-03-09', 'seeds', 'person-mei', 'signed', {seeds: [0, 1, 2, 3, 4]}],
  ['latency-eval', '2026-03-11', 'seeds', 'person-farid', 'signed', {seeds: [0, 1]}],
  ['trial-eval', '2026-04-07', 'dataset', 'person-tomas', 'signed', {dataset_version: 'eeg-subjects-2026.1'}],
  ['subject-eval', '2026-08-10', 'dataset', 'person-mei', 'signed', {dataset_version: 'eeg-subjects-2026.2'}],
  ['session-eval', '2026-08-12', 'dataset', 'person-tomas', 'withdrawn_then_signed', {dataset_version: 'eeg-subjects-2026.2'}],
  ['transfer-eval', '2026-08-17', 'dataset', 'person-mei', 'declined_by_head', {dataset_version: 'eeg-subjects-2026.2'}],
  ['subject-eval', '2026-12-22', 'split', 'person-tomas', 'open', {eval_split: 'test-trials'}]
];
// The current spec of each line, as the stories change it. Used to plan which seeds and dataset a campaign needs.
function protocolPlan() {
  const specs = Object.fromEntries(S.LINES.map(l => [l.line, [{from: at('2024-11-01 00:00'), id: l.prefix + '-v1', dataset_version: S.ERAS[0].dataset, eval_split: l.split, seeds: l.seeds, metrics: l.metrics}]]));
  const versions = Object.fromEntries(S.LINES.map(l => [l.line, 1]));
  for (const [line, day, change, proposer, outcome, values] of PROTOCOL_STORIES) {
    const l = S.LINES.find(x => x.line === line), s = story('protocol_change', {line, change, outcome}), cur = specs[line][specs[line].length - 1];
    const spec = {dataset_version: cur.dataset_version, eval_split: cur.eval_split, seeds: cur.seeds, metrics: cur.metrics, ...values};
    const id = l.prefix + '-v' + (++versions[line]), proposed = local(day, '09:30', '11:30');
    const first = outcome === 'withdrawn_then_signed' ? {...spec, dataset_version: S.TYPO[spec.dataset_version]} : spec;
    ev(s, proposed, 'protocol.proposed', {protocol_id: id, line, ...first, proposed_by: proposer, rationale: S.CHANGES[change].rationale(first)});
    const answerDay = nextWorking(day), headDay = nextWorking(answerDay);
    if (outcome === 'signed' || outcome === 'withdrawn_then_signed') {
      if (outcome === 'withdrawn_then_signed') {
        ev(s, local(day, '15:00', '16:30'), 'protocol.withdrawn', {protocol_id: id, note: 'Withdrawn: the dataset version string had a typo (' + first.dataset_version + ').'});
        const id2 = l.prefix + '-v' + (++versions[line]), again = local(answerDay, '09:00', '10:00');
        ev(s, again, 'protocol.proposed', {protocol_id: id2, line, ...spec, proposed_by: proposer, rationale: S.CHANGES[change].rationale(spec)});
        call(s, local(answerDay, '13:00', '15:00'), 'protocols.respond', {id: id2, answer: 'sign', note: pick(S.SIGN_NOTES)});
        const signed = local(headDay, '10:00', '12:00');
        ev(s, signed, 'protocol.answered', {protocol_id: id2, person_id: 'person-okafor', answer: 'sign', note: pick(S.SIGN_NOTES)});
        specs[line].push({from: signed, id: id2, ...spec});
      } else {
        call(s, local(answerDay, '13:00', '16:00'), 'protocols.respond', {id, answer: 'sign', note: pick(S.SIGN_NOTES)});
        const signed = local(headDay, '10:00', '12:00');
        ev(s, signed, 'protocol.answered', {protocol_id: id, person_id: 'person-okafor', answer: 'sign', note: pick(S.SIGN_NOTES)});
        specs[line].push({from: signed, id, ...spec});
      }
    } else if (outcome === 'declined_by_nadia') {
      call(s, local(answerDay, '13:00', '16:00'), 'protocols.respond', {id, answer: 'decline', note: pick(S.CHANGES[change].decline)});
    } else if (outcome === 'declined_by_head') {
      call(s, local(answerDay, '13:00', '16:00'), 'protocols.respond', {id, answer: 'sign', note: pick(S.SIGN_NOTES)});
      ev(s, local(headDay, '10:00', '12:00'), 'protocol.answered', {protocol_id: id, person_id: 'person-okafor', answer: 'decline', note: pick(S.CHANGES[change].decline)});
    }
    // An expired or open version gets no answer.
  }
  return specs;
}
// The version of a line that is signed at a time: a campaign uses the version that is signed when it starts.
const specAt = (specs, line, when) => specs[line].filter(s => ms(s.from) <= ms(when)).pop();

// Accuracy of a config on a split: the family's level on the dataset release, a fixed offset for the config's own settings, and a small noise for each seed.
// A config never changes, so its result for one seed is set once. A failed or timed-out run has no metrics.
const hash = text => parseInt(crypto.createHash('sha256').update(text).digest('hex').slice(0, 8), 16) / 0xffffffff;
function metricsFor(config, line, seed) {
  const f = S.FAMILIES.find(x => x.family === config.family), era = S.ERAS.findIndex(e => e.dataset === config.dataset_version);
  const mean = f.base + 0.008 * era + S.SPLIT_SHIFT[config.eval_split] + (hash(config.id) * 0.016 - 0.008);
  const noise = hash(config.id + '|' + seed) * 0.014 - 0.007;
  const out = {};
  for (const m of line.metrics) {
    if (m.name === 'latency_ms') out[m.name] = Math.round(18 + 4 * f.hours + hash(config.id) * 6 + seed * 0.7);
    else if (m.name === 'accuracy') out[m.name] = round3(mean + noise);
    else out[m.name] = round3(mean - 0.03 + noise);
  }
  return out;
}

// A new config: the next version of a family on a split, with other settings (a step of a hyperparameter sweep). It is registered by its owner.
const LR = [1, 0.7, 1.4, 0.5, 2, 0.85, 1.2], EPOCHS = [1, 1.5, 0.75, 1.25, 2];
const ABLATIONS = ['no_mask', 'no_pos_embed', 'small_decoder', 'no_augment', 'frozen_encoder', 'no_dropout'];
function newConfig(cfgs, s, family, split, dataset, when, by) {
  const f = S.FAMILIES.find(x => x.family === family), suffix = S.SUFFIX[split], name = 'cfg-' + family + suffix + '-v';
  const version = 1 + Math.max(0, ...cfgs.filter(c => c.id.startsWith(name) && /^\d+$/.test(c.id.slice(name.length))).map(c => c.version));
  // The sweep steps through learning rates, epochs and (for an ablation) what is ablated, so no two configs of a family share their settings.
  const k = version - 1, params = {...f.params, lr: Number((f.params.lr * LR[k % LR.length]).toPrecision(3)), epochs: Math.round(f.params.epochs * EPOCHS[Math.floor(k / LR.length) % EPOCHS.length]),
    warmup_steps: 500 * (1 + Math.floor(k / (LR.length * EPOCHS.length)))};
  if (family === 'birch-abl') params.ablate = ABLATIONS[k % ABLATIONS.length];
  const c = {id: name + version, family, version, params, dataset_version: dataset, eval_split: split,
    code_ref: crypto.createHash('sha256').update(name + version).digest('hex').slice(0, 7), registered_by: by, registered_at: when};
  cfgs.push(c);
  ev(s, when, 'config.registered', {config_id: c.id, family, version, params, dataset_version: dataset, eval_split: split, code_ref: c.code_ref, registered_by: by});
  return c;
}
const FAMILIES_OF = owner => S.FAMILIES.filter(f => f.owner === owner || owner === 'person-ines' && f.family === 'eegnet').map(f => f.family);

// One job of a campaign or of a rerun. Labmates' jobs arrive as job.recorded events. Nadia's go through the App: a run plan, then jobs.submit
// (held when the hours do not fit, released the next morning, and cancelled when it still does not fit). `outcome` is completed, failed or timed_out.
function runSeed(s, owner, config, l, seed, job, sub, outcome) {
  const {partition, gpus, limit, runMinutes, protocol_id} = job;
  const run = outcome === 'timed_out' ? Math.round(limit * 60 * 1.2) : outcome === 'failed' ? Math.round(runMinutes * (0.1 + random() * 0.4)) : runMinutes + between(-20, 20);
  const wait = between(5, 120), metrics = metricsFor(config, l, seed), error = pick(S.FAILURES);
  if (owner === OWNER) {
    ev(s, shift(sub, -10), 'plan.set', outcome === 'failed' ? {config_id: config.id, seed, queue_wait_minutes: wait, run_minutes: run, outcome: 'failed', error}
      : {config_id: config.id, seed, queue_wait_minutes: wait, run_minutes: run, outcome: 'completed', metrics});
    const args = {id: config.id, seed, partition_id: partition, gpus, time_limit_hours: limit, protocol_id};
    const submit = submitMine(s, sub, args);
    holdFollowUp(s, submit, at(nextWorking(dayOf(sub)) + ' 09:' + pad(5 + seed % 10, 2)));
  } else {
    const starts = shift(sub, wait), ends = shift(starts, Math.min(run, limit * 60));
    ev(s, sub, 'job.recorded', {job_id: 'job-' + pad(++jobn, 5), owner_person_id: owner, config_id: config.id, seed, partition_id: partition, gpus, time_limit_hours: limit,
      starts_at: starts, ends_at: ends, end_kind: outcome, protocol_id, ...(outcome === 'completed' ? {metrics} : outcome === 'failed' ? {error} : {})});
  }
  return shift(sub, wait + Math.min(run, limit * 60));
}

// Nadia's submission: held when the hours do not fit. When her job limit is full at that time, she does not submit, and the step is listed as skipped.
function submitMine(s, when, args, guard = null) {
  return call(s, when, 'jobs.submit', data => {
    if (guard && !guard(data)) return SKIP('nothing to run');
    const check = views.check(data, {...args, config_id: args.id}, ms(when));
    if (check.failures.includes('too_many_active')) return SKIP('too_many_active');
    return {...args, hold: !fits(data, args, when)};
  });
}
// A held job is released the next morning when it fits, and cancelled when it still does not.
function holdFollowUp(s, submit, morning) {
  const held = data => data.jobs.find(x => x.request_id === submit.request_id && x.stored_state === 'held');
  call(s, morning, 'jobs.release', data => { const j = held(data); return !j ? SKIP('not held') : fits(data, j, morning) ? {id: j.id} : SKIP('still does not fit'); });
  call(s, shift(morning, 20), 'jobs.cancel', data => { const j = held(data); return j ? {id: j.id} : SKIP('not held'); });
}
// A campaign: one config run on the seeds of the current version of a line that nobody has run for it yet, by one person.
// It takes a config that still misses seeds under that version, or it registers a new one: a config never changes, so a done run is never repeated.
// A failed or timed-out seed is run again in a rerun story, with the reason recorded in the manifest.
function campaign(cfgs, taken, specs, day, owner, lineName, busy) {
  const families = FAMILIES_OF(owner);
  const start = owner === OWNER ? (() => { let t = at(day + ' 09:00'); if (busy.until && ms(busy.until) > ms(t)) t = busy.until; return t; })() : local(day, '07:30', '18:00');
  if (dayOf(start) !== day || !working(day) || ms(start) > ms(at(day + ' 19:00'))) return null;
  const l = S.LINES.find(x => x.line === lineName), spec = specAt(specs, lineName, start);
  // A run is the same when the config, the seed and the evaluation (dataset release, split and metrics) are the same, under any version of the line.
  const missing = c => spec.seeds.filter(seed => !taken.has(runKey(c, spec, seed)));
  const open = cfgs.filter(c => covers(spec, c) && families.includes(c.family) && ms(c.registered_at) < ms(start) - 3600000 && missing(c).length);
  const s = story(owner === OWNER ? 'campaign_mine' : 'campaign_labmate', {line: lineName, protocol_id: spec.id, owner});
  const config = open.length && chance(0.6) ? pick(open) : newConfig(cfgs, s, pick(families), spec.eval_split, spec.dataset_version, shift(start, -between(30, 70)), owner);
  s.config_id = config.id;
  const f = S.FAMILIES.find(x => x.family === config.family), small = ['eegnet', 'lstm-base'].includes(f.family);
  const partition = small && chance(0.5) ? 'cpu' : chance(0.72) ? 'gpu-h' : 'gpu-a';
  const gpus = partition === 'cpu' ? pick([4, 8]) : pick([1, 2, 2, 2, 4]);
  const runMinutes = Math.round(f.hours * 60 * (partition === 'gpu-a' ? 1.6 : partition === 'cpu' ? 3 : 1) * (2 / Math.max(1, gpus)) ** 0.5 * (0.85 + random() * 0.3));
  const max = {'gpu-h': 24, 'gpu-a': 48, cpu: 72}[partition], limit = Math.min(max, Math.ceil(runMinutes / 60 * 1.3));
  const job = {partition, gpus, limit, runMinutes, protocol_id: spec.id};
  let last = start;
  missing(config).forEach((seed, i) => {
    taken.add(runKey(config, spec, seed));
    const outcome = chance(0.05) ? 'failed' : chance(0.025) ? 'timed_out' : 'completed';
    const end = runSeed(s, owner, config, l, seed, job, shift(start, i * between(1, 4)), outcome);
    if (ms(end) > ms(last)) last = end;
    if (outcome !== 'completed') rerun(owner, config, l, seed, outcome === 'timed_out' ? {...job, limit: Math.min(max, Math.ceil(limit * 1.6))} : job, end, outcome);
  });
  if (owner === OWNER) busy.until = shift(last, 30);
  return s;
}
// A rerun of one failed or timed-out seed on a later working day. A timed-out seed gets a longer limit.
function rerun(owner, config, l, seed, job, after, reason) {
  let day = nextWorking(dayOf(after));
  if (owner === OWNER) day = nextWorking(day);
  const s = story('rerun', {config_id: config.id, seed, protocol_id: job.protocol_id, owner, reason});
  const fixed = {...job, runMinutes: Math.min(job.runMinutes, job.limit * 60 - 30)};
  if (owner !== OWNER) return runSeed(s, owner, config, l, seed, fixed, local(day, '10:00', '11:30'), 'completed');
  // Nadia tries on up to four working days: a day when her job limit is full is skipped and listed, and she tries again the next day.
  const first = local(day, '10:00', '11:30'), wait = between(5, 60);
  ev(s, shift(first, -10), 'plan.set', {config_id: config.id, seed, queue_wait_minutes: wait, run_minutes: fixed.runMinutes, outcome: 'completed', metrics: metricsFor(config, l, seed)});
  const args = {id: config.id, seed, partition_id: fixed.partition, gpus: fixed.gpus, time_limit_hours: fixed.limit, protocol_id: fixed.protocol_id};
  const attempts = [];
  for (let i = 0, d = day; i < 4; i++, d = nextWorking(d)) {
    const when = i ? at(d + ' ' + first.slice(11, 16)) : first;
    const notYet = data => !attempts.some(a => data.jobs.some(j => j.request_id === a.request_id));
    const submit = submitMine(s, when, args, notYet);
    attempts.push(submit);
    holdFollowUp(s, submit, at(nextWorking(d) + ' 09:3' + i));
  }
}
let jobn;
const runKey = (c, spec, seed) => [c.id, spec.dataset_version, spec.eval_split, spec.metrics.map(m => m.name).join('+'), seed].join('|');
const covers = (spec, config) => config.dataset_version === spec.dataset_version && config.eval_split === spec.eval_split;
// Does a job fit what the project and Nadia's share have left at `when`?
function fits(data, args, when) {
  const check = views.check(data, {...args, config_id: args.config_id || args.id}, ms(when), args.stored_state === 'held' ? {self: args} : {});
  return !check.failures.includes('over_allocation') && !check.failures.includes('over_share');
}
const TITLES = {'session-eval': 'Session-level results', 'transfer-eval': 'Transfer to the held-out site', 'robust-eval': 'Robustness to noise'};
const byRequest = (data, request_id) => (data.jobs.find(j => j.request_id === request_id) || {id: 'job-none'}).id;

// Nadia's script sweeps of the Birch ablations at 22:00: each sweep registers one new ablation config and runs three or four seeds of it, unless the allocation refuses them.
function sweep(cfgs, day) {
  const dataset = S.ERAS.filter(e => e.from <= day).pop().dataset, s = story('script_sweep', {day});
  const config = newConfig(cfgs, s, 'birch-abl', 'test-subjects', dataset, at(day + ' 17:' + pad(between(10, 50), 2)), OWNER);
  s.config_id = config.id;
  const n = between(3, 4);
  for (let i = 0; i < n; i++) {
    const sub = at(day + ' 22:' + pad(i * 2, 2));
    ev(s, shift(sub, -30 - i), 'plan.set', {config_id: config.id, seed: i, queue_wait_minutes: between(10, 60), run_minutes: between(300, 420), outcome: 'completed',
      metrics: {accuracy: round3(0.6 + hash(config.id) * 0.03 + hash(config.id + i) * 0.006)}});
    ev(s, sub, 'job.script_submitted', {script: 'birch-ablations.sh', config_id: config.id, seed: i, partition_id: 'gpu-a', gpus: 1, time_limit_hours: 8, protocol_id: null, hold: false});
  }
}

// The allocation changes of a quarter: a cut in a busy quarter, and a raise before some deadlines.
function allocationStories() {
  const plan = [['2025-02-24', 'cut', 0.82], ['2025-05-05', 'raise', 1.15], ['2025-08-18', 'cut', 0.85], ['2025-09-08', 'raise', 1.1], ['2025-11-17', 'cut', 0.78],
    ['2026-01-05', 'raise', 1.12], ['2026-04-20', 'cut', 0.86], ['2026-05-04', 'raise', 1.2], ['2026-11-30', 'cut', 0.55], ['2026-12-07', 'raise', 1.45]];
  for (const [day, kind, factor] of plan) {
    const s = story('allocation_change', {kind}), when = local(day, '08:30', '09:30');
    ev(s, when, 'allocation.changed', data => ({allocation_hours: Math.round(data.allocation.allocation_hours * factor / 10) * 10, changed_by: 'person-okafor',
      // The node outage and its return belong to the crunch story, so the other changes give the other reasons.
      reason: pick(kind === 'cut' ? S.CUTS.slice(0, 1).concat(S.CUTS.slice(2)) : S.RAISES.slice(1))}));
  }
}

// A paper table before a deadline: Nadia's complete campaigns under the signed version of a line, frozen a few days before. It is made only when
// there are complete rows; otherwise the story is listed as skipped.
function tableStory(deadline, line = 'subject-eval', part = 0) {
  let day = addDays(deadline.day, -6);
  while (!working(day)) day = addDays(day, -1);
  const s = story('paper_table', {deadline: deadline.day, line}), create = at(day + ' ' + ['10:15', '14:40', '15:20'][part]);
  const lastDay = (() => { let d = addDays(deadline.day, -3); while (!working(d)) d = addDays(d, -1); return d; })();
  const title = ['Main results for the ', 'More configs for the ', TITLES[line] + ' for the '][part] + deadline.name;
  const rows = data => rowsFor(data, ms(create), line, part === 1 ? 3 : 0);
  const made = call(s, create, 'tables.create', data => rows(data).length ? {id: signedVersion(data, line, ms(create)), title} : SKIP('no complete rows'));
  call(s, shift(create, 10), 'tables.update', data => tableOf(data, made.request_id) ? {id: tableOf(data, made.request_id), rows: rows(data)} : SKIP('no table'));
  call(s, at(lastDay + ' ' + ['16:40', '17:10', '17:25'][part]), 'tables.freeze', data => tableOf(data, made.request_id) ? {id: tableOf(data, made.request_id)} : SKIP('no table'));
  return {s, made, title};
}
function progressTable(day, title) {
  const s = story('progress_table', {day}), create = at(day + ' 09:20');
  const made = call(s, create, 'tables.create', data => rowsFor(data, ms(create)).length ? {id: signedVersion(data, 'subject-eval', ms(create)), title} : SKIP('no complete rows'));
  call(s, shift(create, 10), 'tables.update', data => tableOf(data, made.request_id) ? {id: tableOf(data, made.request_id), rows: rowsFor(data, ms(create))} : SKIP('no table'));
  call(s, shift(create, 25), 'tables.freeze', data => tableOf(data, made.request_id) ? {id: tableOf(data, made.request_id)} : SKIP('no table'));
}
const signedVersion = (data, line, now) => data.protocols.find(p => p.line === line && views.protocolState(p, now) === 'signed').id;
const tableOf = (data, request_id) => (data.tables.find(t => t.request_id === request_id) || {id: null}).id;
// Results that a table version (not discarded) cites. Nadia never excludes them: a correction is a new version.
const cited = data => new Set(data.tables.filter(t => t.stored_state !== 'discarded').flatMap(t => t.rows.flatMap(r => r.result_ids)));
// Rows: each of Nadia's configs whose results under the signed version cover every seed, newest first, at most three, after the first `skip`.
function rowsFor(data, now, line = 'subject-eval', skip = 0) {
  const version = data.protocols.find(p => p.line === line && views.protocolState(p, now) === 'signed');
  const byConfig = new Map();
  for (const j of data.jobs) {
    if (j.owner_person_id !== OWNER || j.protocol_id !== version.id || !views.hasResult(j, now) || (j.review && j.review.excluded) || j.invalidation) continue;
    if (!byConfig.has(j.config_id)) byConfig.set(j.config_id, new Map());
    const seeds = byConfig.get(j.config_id);
    if (!seeds.has(j.seed)) seeds.set(j.seed, j);
  }
  const rows = [];
  for (const [config, seeds] of [...byConfig].reverse()) {
    if (!version.seeds.every(seed => seeds.has(seed))) continue;
    rows.push({name: config.replace(/^cfg-/, ''), result_ids: version.seeds.map(seed => seeds.get(seed).id)});
  }
  return rows.slice(skip, skip + 3);
}

// A correction: a labmate invalidates a result that a frozen table cites, because the run went wrong (its reason names the run, not the config).
// Nadia reruns that seed of the unchanged config, revises the table and freezes the new version.
function correction(table, day) {
  const s = story('correction', {table: table.made.request_id}), when = local(day, '10:00', '11:30'), reason = pick(S.INVALIDATIONS);
  let target = null;
  ev(s, when, 'result.invalidated', data => {
    const t = data.tables.find(x => x.request_id === table.made.request_id && x.stored_state === 'frozen');
    target = t ? data.jobs.find(j => j.id === t.rows[0].result_ids[t.rows[0].result_ids.length > 1 ? 1 : 0]) : null;
    return target ? {job_id: target.id, invalidated_by: pick(['person-mei', 'person-tomas']), reason} : SKIP('no frozen table');
  });
  const fix = shift(when, 60);
  ev(s, fix, 'plan.set', () => target ? {config_id: target.config_id, seed: target.seed, queue_wait_minutes: 20, run_minutes: 480, outcome: 'completed',
    metrics: {...target.run.metrics, accuracy: round3(target.run.metrics.accuracy + 0.002)}} : SKIP('no invalidation'));
  const rerunStep = call(s, shift(fix, 5), 'jobs.submit', data => {
    if (!target) return SKIP('no invalidation');
    const args = {id: target.config_id, seed: target.seed, partition_id: 'gpu-h', gpus: 2, time_limit_hours: 12, protocol_id: target.protocol_id};
    return views.check(data, {...args, config_id: args.id}, ms(shift(fix, 5))).failures.includes('too_many_active') ? SKIP('too_many_active') : args;
  });
  const next = at(nextWorking(dayOf(fix)) + ' 10:00');
  const rerunOf = data => data.jobs.find(j => j.request_id === rerunStep.request_id && views.hasResult(j, ms(next)));
  const revise = call(s, next, 'tables.revise', data => target && rerunOf(data) ? {id: tableOf(data, table.made.request_id)} : SKIP('no rerun result'));
  call(s, shift(next, 5), 'tables.update', data => {
    const draft = data.tables.find(x => x.request_id === revise.request_id);
    if (!draft) return SKIP('no draft');
    const rid = rerunOf(data).id;
    return {id: draft.id, rows: draft.rows.map(r => ({name: r.name, result_ids: r.result_ids.map(id => id === target.id ? rid : id)}))};
  });
  call(s, shift(next, 10), 'tables.freeze', data => tableOf(data, revise.request_id) ? {id: tableOf(data, revise.request_id)} : SKIP('no draft'));
}

// A node failure: one running job of the lab is interrupted. If it is Nadia's, she submits it again the next morning.
function failure(day) {
  const s = story('node_failure', {day}), when = local(day, '10:00', '16:00');
  let victim = null;
  ev(s, when, 'job.interrupted', data => {
    victim = data.jobs.find(j => views.jobState(j, ms(when)) === 'running' && j.partition_id !== 'cpu') || null;
    return victim ? {job_id: victim.id, reason: 'Node ' + pick(S.NODES[victim.partition_id]) + ' failed.'} : SKIP('no running job');
  });
  const again = at(nextWorking(day) + ' 09:30');
  call(s, again, 'jobs.submit', data => {
    if (!victim || victim.owner_person_id !== OWNER) return SKIP(victim ? 'a labmate\'s job' : 'no running job');
    const args = {id: victim.config_id, seed: victim.seed, partition_id: victim.partition_id, gpus: victim.gpus, time_limit_hours: victim.time_limit_hours, protocol_id: victim.protocol_id};
    const check = views.check(data, {...args, config_id: args.id}, ms(again));
    return check.failures.includes('too_many_active') ? SKIP('too_many_active') : {...args, hold: !fits(data, args, again)};
  });
}

// Nadia's dispositions: a tag on a good result, an exclusion of a bad one. She never excludes a result that a table cites.
function review(day) {
  const s = story('result_review', {day}), when = local(day, '14:00', '17:00');
  call(s, when, 'results.update', data => {
    const inTables = cited(data);
    // A result with no protocol (a script sweep) cannot enter a table, so it gets no paper tag or disposition.
    const done = data.jobs.filter(j => j.owner_person_id === OWNER && j.protocol_id !== null && views.hasResult(j, ms(when)) && !j.review && !inTables.has(j.id) && ms(j.run.ends_at) > ms(when) - 30 * 86400000);
    const j = done[done.length - 1];
    if (!j) return SKIP('no new result');
    return chance(0.3) ? {id: j.id, disposition: 'excluded', reason: pick(['The run used the old augmentation flag.', 'A node was swapping during the run.'])}
      : {id: j.id, tags: ['paper'], note: 'Seed ' + j.seed + ' of ' + j.config_id + '.'};
  });
}

// The allocation runs short before a deadline: the lab head cuts the allocation below what is already used while Nadia's planned jobs wait in the queue.
// The cut holds them (W2 of the plan). Her next submissions are held, and those that still do not fit the next morning are cancelled.
// Three days later the department returns hours: Nadia releases two of the held jobs and cancels the third, whose config she dropped.
function crunch(cfgs, specs, taken, day) {
  const s = story('allocation_crunch', {day}), spec = specAt(specs, 'subject-eval', at(day + ' 07:30')), l = S.LINES.find(x => x.line === 'subject-eval');
  const config = newConfig(cfgs, s, 'atlas', spec.eval_split, spec.dataset_version, at(day + ' 07:40'), OWNER);
  const jobs = spec.seeds.slice(0, 3).map((seed, i) => {
    taken.add(runKey(config, spec, seed));
    ev(s, at(day + ' 07:5' + i), 'plan.set', {config_id: config.id, seed, queue_wait_minutes: 300, run_minutes: 540, outcome: 'completed', metrics: metricsFor(config, l, seed)});
    return call(s, at(day + ' 08:0' + i), 'jobs.submit', {id: config.id, seed, partition_id: 'gpu-h', gpus: 2, time_limit_hours: 12, protocol_id: spec.id});
  });
  ev(s, at(day + ' 09:10'), 'allocation.changed', data => {
    const u = views.sums(data, ms(at(day + ' 09:10')));
    return {allocation_hours: Math.floor((u.used / 100) * 0.92 / 10) * 10, changed_by: 'person-okafor', reason: S.CUTS[1]};
  });
  // The next day she submits one more seed: it does not fit, so it is submitted held, and the next morning it still does not fit and is cancelled.
  const more = nextWorking(day), extra = spec.seeds[3] ?? spec.seeds[0] + 10;
  taken.add(runKey(config, spec, extra));
  ev(s, at(more + ' 09:50'), 'plan.set', {config_id: config.id, seed: extra, queue_wait_minutes: 60, run_minutes: 540, outcome: 'completed', metrics: metricsFor(config, l, extra)});
  const late = submitMine(s, at(more + ' 10:00'), {id: config.id, seed: extra, partition_id: 'gpu-h', gpus: 2, time_limit_hours: 12, protocol_id: spec.id});
  holdFollowUp(s, late, at(nextWorking(more) + ' 09:05'));
  const back = nextWorking(nextWorking(nextWorking(day)));
  ev(s, at(back + ' 09:00'), 'allocation.changed', data => {
    const u = views.sums(data, ms(at(back + ' 09:00')));
    return {allocation_hours: Math.ceil((u.used + u.reserved) / 100 / 10) * 10 + 1800, changed_by: 'person-okafor', reason: S.RAISES[0]};
  });
  const id = (data, step) => data.jobs.find(j => j.request_id === step.request_id).id;
  call(s, at(back + ' 09:40'), 'jobs.release', data => ({id: id(data, jobs[0])}));
  call(s, at(back + ' 09:41'), 'jobs.release', data => ({id: id(data, jobs[1])}));
  call(s, at(back + ' 09:45'), 'jobs.cancel', data => ({id: id(data, jobs[2])}));
  return s;
}

function plan() {
  random = prng(PRNG_SEED); stories = []; steps = []; evn = 0; rqn = 0; jobn = 0;
  const cfgs = configs(), specs = protocolPlan();
  // Configs registered in the window, by their owner, a few days after a dataset release.
  for (const c of cfgs.filter(x => x.registered_at >= START)) {
    const s = story('config_release', {config_id: c.id});
    ev(s, c.registered_at, 'config.registered', {config_id: c.id, family: c.family, version: c.version, params: c.params, dataset_version: c.dataset_version,
      eval_split: c.eval_split, code_ref: c.code_ref, registered_by: c.registered_by});
  }
  // New quarters, written into the data at their start.
  for (const q of S.QUARTERS.slice(1)) {
    const s = story('new_quarter', {period_id: q.id});
    // The edit runs one second before the quarter starts, so a seed as of its first instant already holds the new period.
    add(s, {at: at(addDays(q.from, -1) + ' 23:59:59'), edit: data => {
      const {opening_shares, ...old} = data.allocation;
      data.past_periods.push(old);
      const shares = {...S.SHARES, 'person-ines': q.from >= S.JOINS['person-ines'] ? S.SHARES['person-ines'] : null};
      data.allocation = {period_id: q.id, label: q.label, starts_at: at(q.from + ' 00:00'), ends_at: at(q.to + ' 23:59:59'), opening_hours: q.hours, allocation_hours: q.hours,
        opening_shares: Object.entries(shares).map(([person_id, share_hours]) => ({person_id, share_hours}))};
      for (const p of data.people) p.share_hours = shares[p.person_id] ?? null;
    }});
  }
  allocationStories();
  // Campaigns, week by week. Busy weeks before a deadline have about twice as many.
  const busy = {until: null}, tables = [], taken = new Set();
  for (let day = '2025-01-02'; day <= '2026-12-23'; day = addDays(day, 1)) {
    if (!working(day)) continue;
    const near = S.DEADLINES.some(d => d.day >= day && time.dayNumber(d.day) - time.dayNumber(day) <= 21);
    const n = near ? between(1, 2) + (chance(0.3) ? 1 : 0) : (chance(0.55) ? 1 : 0) + (chance(0.08) ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const owners = S.LABMATES.filter(p => !S.JOINS[p] || S.JOINS[p] <= day);
      const owner = chance(near ? 0.32 : 0.2) ? OWNER : pick(owners);
      const line = chance(0.68) ? 'subject-eval' : pick(['session-eval', 'trial-eval', 'latency-eval', 'transfer-eval', 'robust-eval']);
      campaign(cfgs, taken, specs, day, owner, line, busy);
    }
    if (weekday(day) === 3 && chance(0.18)) sweep(cfgs, day);
    if (chance(0.025)) failure(day);
    if (weekday(day) === 5 && chance(0.25)) review(day);
  }
  // The allocation runs short in the push before the Autumn conference 2026.
  crunch(cfgs, specs, taken, '2026-09-15');
  for (const d of S.DEADLINES) tables.push(tableStory(d), tableStory(d, 'subject-eval', 1), tableStory(d, pick(['session-eval', 'transfer-eval', 'robust-eval']), 2));
  // A progress table for the lab meeting at the start of every other month, when there are complete rows.
  const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  for (let year = 2025; year <= 2026; year++) for (let month = 2; month <= 12; month += 2) {
    let day = year + '-' + pad(month, 2) + '-02';
    while (!working(day)) day = addDays(day, 1);
    progressTable(day, 'Progress results for the ' + MONTH[month - 1] + ' ' + year + ' lab meeting');
  }
  // Corrections of frozen tables, a week or more after their freeze.
  [[3, '2025-06-03'], [6, '2025-10-14'], [9, '2026-02-03'], [12, '2026-06-02'], [15, '2026-10-13'], [16, '2026-10-20'], [17, '2026-10-27']].forEach(([i, day]) => correction(tables[i], day));
  // A discarded draft and an open draft at the clock.
  const draft = story('table_draft'), d1 = at('2026-07-14 11:00');
  const made = call(draft, d1, 'tables.create', data => ({id: signedVersion(data, 'session-eval', ms(d1)), title: 'Session-level results (draft)'}));
  call(draft, at('2026-07-16 15:00'), 'tables.discard', data => ({id: tableOf(data, made.request_id)}));
  const open = story('table_draft'), d2 = at('2026-12-22 10:00');
  const opened = call(open, d2, 'tables.create', data => ({id: signedVersion(data, 'subject-eval', ms(d2)), title: 'Results for the journal version'}));
  // The draft is left open over the winter break.
  call(open, shift(d2, 15), 'tables.update', data => ({id: tableOf(data, opened.request_id), rows: rowsFor(data, ms(d2)).slice(0, 2)}));
  return {cfgs, ordered: steps.map((step, i) => [step, i]).sort((a, b) => ms(a[0].at) - ms(b[0].at) || a[1] - b[1]).map(([step]) => step)};
}

// The replay: every step through the App's hooks, in time order, on one copy of the data. Optional steps that the App refuses leave no history.
const ctxAt = (now, role = 'agent') => Object.freeze({app_id: 'benchline', role, virtual_now: now, binding});
function apply(data, step) {
  if (step.edit) { step.edit(data); return {data}; }
  const input = typeof (step.args || step.payload) === 'function' ? (step.args || step.payload)(data) : (step.args || step.payload);
  if (input && input.skip) return {data, skip: input.skip};
  if (step.call) return {data: plugin.handleTool(ctxAt(step.at), data, 'benchline.' + step.call, {expected_version: {epoch: 1, revision: 0}, request_id: step.request_id, ...input}).data};
  return {data: plugin.applyEvent(ctxAt(step.at, 'infra'), data, {event_id: step.event_id, at: step.at, operation: 'benchline.' + step.event, payload: input})};
}
// Only the notifications and activity rows of the current period are kept, so the seed stays small. The records keep their own history.
function trim(data) {
  const from = ms(data.allocation.starts_at);
  const keep = new Set(data.notifications.filter(n => ms(n.at) >= from || n.removed_at === null && ms(n.at) > from).map(n => n.id));
  data.notifications = data.notifications.filter(n => keep.has(n.id));
  data.activity = data.activity.filter(row => ms(row.at) >= from && (!row.object_id.startsWith('ntf-') || keep.has(row.object_id)));
  return data;
}
// One replay pass. `keepAt` lists the times at which a copy of the data is kept, for the selector and the tests. `until` stops the pass before that time.
function generate({keepAt = [], until = CLOCK} = {}) {
  const {cfgs, ordered} = plan();
  let data = base(cfgs);
  const snapshots = {}, wanted = [...keepAt].sort((a, b) => ms(a) - ms(b)), done = new Map(), skipped = [];
  const keep = upTo => { while (wanted.length && ms(wanted[0]) <= upTo) { const t = wanted.shift(); snapshots[t] = trim(structuredClone(data)); } };
  for (const step of ordered) {
    if (ms(step.at) >= ms(until)) break;
    keep(ms(step.at));
    let out;
    try { out = apply(data, step); }
    catch (error) { error.message = 'Step ' + (step.call || step.event || 'edit') + ' at ' + step.at + ' (' + step.story + '): ' + error.message; throw error; }
    data = out.data;
    if (out.skip) skipped.push({story_id: step.story, step: step.call || step.event, at: step.at, reason: out.skip}); else done.set(step, true);
    // A release or cancel of a job that is not held, and a later rerun attempt after one that ran, are conditional acts: they are counted, not listed.
  }
  keep(ms(until) - 1);
  const seed = trim(structuredClone(data));
  const conditional = x => x.reason === 'not held' || x.reason === 'nothing to run', counts = {};
  for (const x of skipped) counts[x.step + ': ' + x.reason] = (counts[x.step + ': ' + x.reason] || 0) + 1;
  return {seed, manifest: {...manifestOf(seed, ordered, done), skipped_counts: counts, skipped: skipped.filter(x => !conditional(x))}, snapshots};
}
// The manifest: each story with its template and the IDs of the records its committed steps made.
function manifestOf(data, ordered, done) {
  const byStory = new Map(stories.map(s => [s.id, {story_id: s.id, template: s.template, ...(s.reason ? {reason: s.reason, config_id: s.config_id, seed: s.seed} : {}), records: []}]));
  const jobsByRef = new Map(data.jobs.map(j => [j.request_id || j.event_id, j.id]));
  const plans = new Map(data.run_plans.map(p => [p.event_id, p.id]));
  for (const step of ordered) {
    if (!done.get(step)) continue;
    const list = byStory.get(step.story).records, ref = step.request_id || step.event_id;
    if (jobsByRef.has(ref)) list.push(jobsByRef.get(ref));
    if (plans.has(ref)) list.push(plans.get(ref));
    if (step.event === 'config.registered') list.push(step.payload.config_id);
    if (step.event === 'protocol.proposed') list.push(step.payload.protocol_id);
    for (const t of data.tables) if (t.request_id === ref) list.push(t.id);
    for (const c of data.allocation_changes) if (c.event_id === ref) list.push(c.id);
  }
  return {schema: 'benchline.evaluation-manifest.v1', generator: 'dev/generate-dataset.cjs', version: VERSION, prng_seed: PRNG_SEED, start: START, clock: CLOCK,
    stories: [...byStory.values()].filter(s => s.records.length || s.template === 'new_quarter')};
}
const json = value => JSON.stringify(value, null, 2) + '\n';
const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');
const fileInfo = (name, text) => ({name, bytes: Buffer.byteLength(text), sha256: sha256(text)});
const GENERATION = {method: 'scripted replay of story templates with a seeded PRNG (mulberry32)', tool: 'apps/benchline/dev/generate-dataset.cjs', tool_version: VERSION,
  seed: PRNG_SEED, parameters: {start: START, clock: CLOCK, timezone: ZONE}};
function dataset(seed) {
  return {schema_version: 'pale.dataset.v1', dataset_id: 'benchline-evaluation-2025-2026', version: VERSION,
    description: 'Synthetic delivery dataset of one fictional lab\'s shared GPU allocation, job queue, results, evaluation protocols and results tables, seen from the researcher account of Nadia Ferrante, from 2025-01-01 to ' + CLOCK + '. Every record is synthetic: the lab, the people, the cluster, the datasets, the configs and the results are fictional, and nothing was collected. A development script builds stories from fixed templates with a seeded PRNG and replays every step through the App\'s own hooks, so the App made every job of the researcher, every hold, sign-off, table, manifest and notification.',
    record_source_ids: ['evaluation-generator'],
    sources: [{source_id: 'evaluation-generator', kind: 'synthetic', description: 'Scripted synthetic lab history from story templates with seeded random variation; no external collection and no real person, lab, university, cluster, dataset, model or result. Dates are represented event dates of the fictional history, not collection dates.',
      uri: null, license: 'MIT', usage: 'permitted', collection: null, generation: GENERATION}],
    transformations: ['The seed keeps the notifications and activity rows of its current allocation period. Every record keeps its own history.'],
    expected_counts: {records: records(seed).length, assets: 0},
    quality_policy: {duplicate_records: 'reject', duplicate_assets: 'reject', missing_assets: 'allow_declared'},
    review: {status: 'pending', reviewer: null, notes: 'Automated checks do not replace human review of realism, variation and reuse permissions.'}};
}
function outputs(run) {
  const files = {'seed.json': JSON.stringify(run.seed) + '\n', 'clock.json': json({initial_time: CLOCK}), 'dataset.json': json(dataset(run.seed))};
  const templates = {};
  for (const st of run.manifest.stories) templates[st.template] = (templates[st.template] || 0) + 1;
  const head = {...run.manifest, counts: {records: records(run.seed).length, jobs: run.seed.jobs.length, researcher_jobs: run.seed.jobs.filter(j => j.owner_person_id === OWNER).length,
    configs: run.seed.configs.length, protocol_versions: run.seed.protocols.length, table_versions: run.seed.tables.length, run_plans: run.seed.run_plans.length,
    allocation_changes: run.seed.allocation_changes.length, periods: run.seed.past_periods.length + 1, notifications: run.seed.notifications.length,
    activity: run.seed.activity.length, stories: run.manifest.stories.length, templates},
    files: Object.fromEntries(Object.entries(files).map(([name, value]) => [name, {bytes: Buffer.byteLength(value), sha256: sha256(value)}])), stories: '@'};
  files['manifest.json'] = json(head).replace('"stories": "@"', '"stories": [\n' + run.manifest.stories.map(r => '    ' + JSON.stringify(r)).join(',\n') + '\n  ]');
  return files;
}
// The env.load_seed request line that Core reads, compact, as a task sends it.
function requestBytes(seed, datasetText) {
  const read = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  const line = JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: 'env.load_seed', arguments: {expected_version: {epoch: 1, revision: 0},
    request_id: 'evaluation-seed', data: seed, binding: read('fixtures/binding.json'), policies: read('fixtures/policies.json'),
    bundle: {dataset: JSON.parse(datasetText), catalog: read('contribution/assets.catalog.json'), blobs: {}}, virtual_now: CLOCK}}});
  return Buffer.byteLength(line);
}
// contribution/dataset.json declares the source with the same generation, and names the delivered files with their sizes and hashes.
const CONTRIBUTION = path.join(ROOT, 'contribution/dataset.json');
const declared = files => ({...GENERATION, parameters: {...GENERATION.parameters, files: ['seed.json', 'clock.json', 'dataset.json'].map(name => fileInfo('data/evaluation/' + name, files[name]))}});
function contributionStale(files) {
  const doc = JSON.parse(fs.readFileSync(CONTRIBUTION, 'utf8')), source = doc.sources.find(x => x.source_id === 'evaluation-generator');
  return !source || JSON.stringify(source.generation) !== JSON.stringify(declared(files));
}
function main() {
  const checkMode = process.argv.includes('--check'), started = process.hrtime.bigint();
  const run = generate(), elapsed = Number(process.hrtime.bigint() - started) / 1e6, files = outputs(run), problems = [];
  const bytes = requestBytes(run.seed, files['dataset.json']);
  if (bytes > REQUEST_LIMIT) problems.push('The env.load_seed request is ' + bytes + ' bytes, above the limit of ' + REQUEST_LIMIT + '.');
  const rules = require('./check-evaluation.cjs').problems(run.seed, run.manifest);
  if (rules.length) problems.push(rules.length + ' story rules are broken, first: ' + JSON.stringify(rules[0]));
  const stale = [];
  for (const [name, value] of Object.entries(files)) {
    const target = path.join(OUT, name);
    if (checkMode) { if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== value) stale.push(name); } else { fs.mkdirSync(OUT, {recursive: true}); fs.writeFileSync(target, value); }
  }
  if (contributionStale(files)) {
    if (checkMode) stale.push('contribution/dataset.json (sources[evaluation-generator].generation)');
    else {
      const doc = JSON.parse(fs.readFileSync(CONTRIBUTION, 'utf8')), source = doc.sources.find(x => x.source_id === 'evaluation-generator');
      if (!source) problems.push('contribution/dataset.json has no source evaluation-generator.');
      else { source.generation = declared(files); fs.writeFileSync(CONTRIBUTION, json(doc)); }
    }
  }
  if (stale.length) problems.push('Generated files are out of date: ' + stale.join(', ') + '. Run node apps/benchline/dev/generate-dataset.cjs.');
  const summary = records(run.seed).length + ' records, ' + run.seed.jobs.length + ' jobs, ' + Buffer.byteLength(files['seed.json']) + ' bytes of seed, ' + bytes +
    ' bytes of env.load_seed request, replay ' + (elapsed / 1000).toFixed(1) + ' s on Node ' + process.versions.node;
  if (problems.length) { problems.forEach(x => console.error(x)); console.error('FAIL (' + summary + ')'); process.exitCode = 1; return; }
  console.log((checkMode ? 'Checked' : 'Wrote') + ' data/evaluation (' + summary + ').');
}
// The seed as of a time: only the steps strictly before it, with the notifications and activity rows of that time's period.
const build = (until = CLOCK) => until === CLOCK ? generate().seed : generate({until}).seed;
module.exports = {generate, build, plan, trim, outputs, START, CLOCK, MONTH_STARTS, VERSION, PRNG_SEED, ZONE, OUT};
if (require.main === module) main();
