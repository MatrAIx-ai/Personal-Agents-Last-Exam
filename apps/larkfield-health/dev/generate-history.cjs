'use strict';
const fs = require('node:fs');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const { compile } = require('../tests/schema-validator.cjs');
const { project } = require('../src/timers.cjs');
const { ms, toIso, fromLocal, localDate, addDays, dayDeadline, MINUTE, DAY } = require('../src/time.cjs');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'fixtures/minimal.json');
const read = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const BINDING = read('fixtures/binding.json');
const CLOCK = read('fixtures/clock.json').initial_time;
const APP = 'larkfield-health', P = APP + '.';
const TOOLS = read('tools.json');
const seedValid = compile(read('schemas/seed.schema.json'), path.join(ROOT, 'schemas'));
const eventValid = compile(read('schemas/events.schema.json'), path.join(ROOT, 'schemas'));
const inputValid = new Map(TOOLS.map(t => [t.name, compile(t.inputSchema, ROOT)]));
const WRITES = new Set(TOOLS.filter(t => !t.read_only).map(t => t.name));

const SEED = 2025, FROM = '2025-01-01', TASK_FROM = '2026-01-01', ROUTINE_TO = '2026-10', SLACK = 2 * DAY;
const HISTORY = /^[a-z]+-h\d+$/;
const TIMELINE_NOTICE = /^n-t\d+$/;
const COUNTED = ['ir', 'eob', 'ap', 'n'];
const GRANTS_ISSUED = '2';
const LIVE_ID = /\b(?:ir|eob|ap|n)-\d+\b/g;
const RECORDS = ['coverage', 'claims', 'info_requests', 'eobs', 'accumulators', 'pas', 'appeals', 'windows', 'grants', 'approvals', 'notices'];

const PT = (dates, billed = 16500) => dates.map(d => ['svc-physical-therapy', d, billed]);

const HISTORY_STEPS = [
  { at: '2025-01-01 10:00', do: 'grant', id: 'gr-h1', member: 'm-1', grantor: 'm-1', grantee: 'm-2', scope: 'act', expires: '2027-01-01T00:00:00-05:00' },
  { at: '2025-04-07 19:30', do: 'grant', id: 'gr-h2', member: 'm-2', grantor: 'm-2', grantee: 'm-1', scope: 'view', expires: null },
  { at: '2025-04-14 13:25', do: 'claim', member: 'm-1', provider: 'pv-1', lines: [['svc-office-visit', '2025-04-10', 21000], ['svc-xray', '2025-04-10', 14500, { accident: true }]], unanswered: ['ln-2'] },
  { at: '2025-06-16 10:40', do: 'claim', member: 'm-2', provider: 'pv-6', lines: [['svc-ultrasound', '2025-06-10', 58500]] },
  { at: '2025-08-20 13:10', do: 'claim', member: 'm-3', provider: 'pv-4', lines: [['svc-er-visit', '2025-08-16', 241000, { emergency: true, accident: true }], ['svc-xray', '2025-08-16', 16800, { emergency: true, accident: true }]], accident: 'accident', answerer: 'm-2' },
  { at: '2025-09-15 21:10', do: 'revoke', id: 'gr-h2' },
];

const TIMELINE = [
  { at: '2026-01-01 10:00', do: 'grant', id: 'gr-1', member: 'm-2', grantor: 'm-2', grantee: 'm-1', scope: 'view', expires: '2026-04-01T00:00:00-04:00' },
  { at: '2026-01-05 09:10', do: 'claim', id: 'cl-1', member: 'm-1', provider: 'pv-6', lines: [['svc-er-visit', '2025-12-31', 268500, { emergency: true }], ['svc-lab-panel', '2026-01-01', 11800, { emergency: true }]] },
  { at: '2026-01-11 20:30', do: 'cob', actor: 'm-1', member: 'm-1', year: 2026, answer: 'none' },
  { at: '2026-01-15 11:20', do: 'claim', id: 'cl-2', member: 'm-3', provider: 'pv-1', lines: [['svc-office-visit', '2026-01-13', 21500], ['svc-strep-test', '2026-01-13', 4200]] },
  { at: '2026-01-21 19:45', do: 'cob', actor: 'm-2', member: 'm-3', year: 2026, answer: 'none' },
  { at: '2026-02-03 10:05', do: 'claim', id: 'cl-3', member: 'm-1', provider: 'pv-5', lines: [['svc-ultrasound', '2026-01-29', 61000]] },
  { at: '2026-02-13 14:30', do: 'claim', id: 'cl-4', member: 'm-2', provider: 'pv-1', lines: [['svc-office-visit', '2026-02-10', 22000], ['svc-lipid-panel', '2026-02-10', 7800]] },
  { at: '2026-02-16 20:10', do: 'file', actor: 'm-1', label: 'ap-1', target: ['claim', 'cl-3'], statement: 'The emergency doctor at Cindervale asked me to get an abdominal ultrasound within a month, and Quillmont had the only opening near home before the month ran out. I did not know it was out of network. Please cover it at the in-network level.' },
  { at: '2026-03-09 10:30', do: 'appeal_info', appeal: 'ap-1', request: 'The referral from the doctor who ordered the ultrasound' },
  { at: '2026-03-09 11:00', do: 'claim', id: 'cl-5', member: 'm-1', provider: 'pv-4', lines: [['svc-knee-mri', '2026-03-05', 172000]] },
  { at: '2026-03-12 19:30', do: 'statement', actor: 'm-1', appeal: 'ap-1', statement: 'The discharge papers from the Cindervale emergency department, dated December 31, ask for the ultrasound within a month. The first in-network appointment I was offered was in late February.' },
  { at: '2026-03-18 15:40', do: 'claim', id: 'cl-6', member: 'm-2', provider: 'pv-4', lines: [['svc-specialist-visit', '2026-03-16', 34000]] },
  { at: '2026-04-02 14:00', do: 'appeal_decide', appeal: 'ap-1', outcome: 'upheld' },
  { at: '2026-04-06 20:15', do: 'cob', actor: 'm-2', member: 'm-2', year: 2026, answer: 'other_secondary' },
  { at: '2026-05-11 10:00', do: 'pa', id: 'pa-1', member: 'm-2', provider: 'pv-1', service: 'svc-semaglutide-1', units: 6, from: '2026-05-15', until: '2026-11-14' },
  { at: '2026-05-20 15:30', do: 'pa_decide', pa: 'pa-1', decision: 'denied' },
  { at: '2026-06-03 09:40', do: 'claim', id: 'cl-8', member: 'm-1', provider: 'pv-1', lines: [['svc-office-visit', '2026-06-01', 21000, { accident: true }], ['svc-wound-repair', '2026-06-01', 46000, { accident: true }]] },
  { at: '2026-06-09 21:00', do: 'info', actor: 'm-1', claim: 'cl-8', line: 'ln-1', answer: 'work_related' },
  { at: '2026-06-09 21:02', do: 'info', actor: 'm-1', claim: 'cl-8', line: 'ln-2', answer: 'work_related' },
  { at: '2026-06-29 19:20', do: 'file', actor: 'm-2', label: 'ap-2', target: ['claim', 'cl-8'], statement: 'Jordan cut his hand repairing the garden fence at home on a Monday evening; it did not happen at work. The accident answers were entered as work related by mistake. Please process the visit and the repair.' },
  { at: '2026-07-27 11:00', do: 'appeal_decide', appeal: 'ap-2', outcome: 'overturned', lines: ['ln-1', 'ln-2'] },
  { at: '2026-08-03 09:15', do: 'pa', id: 'pa-2', member: 'm-2', provider: 'pv-3', service: 'svc-physical-therapy', units: 8, from: '2026-08-10', until: '2026-10-02' },
  { at: '2026-08-05 10:30', do: 'pa_info', pa: 'pa-2', request: 'Notes from the initial evaluation' },
  { at: '2026-08-06 13:00', do: 'pa_provided', pa: 'pa-2' },
  { at: '2026-08-10 10:45', do: 'pa_decide', pa: 'pa-2', decision: 'approved', units: 8, from: '2026-08-10', until: '2026-10-02' },
  { at: '2026-09-03 15:00', do: 'pa', id: 'pa-3', member: 'm-3', provider: 'pv-3', service: 'svc-physical-therapy', units: 6, from: '2026-09-08', until: '2026-10-09' },
  { at: '2026-09-03 20:30', do: 'expedite', actor: 'm-1', pa: 'pa-3', reason: 'Riley\'s soccer season has started and the orthopedist wants therapy to begin next week.' },
  { at: '2026-09-04 10:00', do: 'expedite_decide', pa: 'pa-3', decision: 'approved' },
  { at: '2026-09-04 10:20', do: 'claim', id: 'cl-9', member: 'm-2', provider: 'pv-3', lines: PT(['2026-08-12', '2026-08-19', '2026-08-26', '2026-09-02']) },
  { at: '2026-09-04 11:05', do: 'claim', id: 'cl-10', member: 'm-3', provider: 'pv-2', lines: [['svc-specialist-visit', '2026-09-02', 33500, { accident: true }], ['svc-xray', '2026-09-02', 15800, { accident: true }]] },
  { at: '2026-09-04 14:30', do: 'pa_decide', pa: 'pa-3', decision: 'approved', units: 6, from: '2026-09-08', until: '2026-10-09' },
  { at: '2026-09-10 20:40', do: 'info', actor: 'm-2', claim: 'cl-10', line: 'ln-1', answer: 'accident' },
  { at: '2026-09-10 20:42', do: 'info', actor: 'm-2', claim: 'cl-10', line: 'ln-2', answer: 'accident' },
  { at: '2026-09-28 09:50', do: 'claim', id: 'cl-11', member: 'm-3', provider: 'pv-3', lines: PT(['2026-09-10', '2026-09-14', '2026-09-17', '2026-09-24']) },
  { at: '2026-10-02 10:10', do: 'claim', id: 'cl-12', member: 'm-2', provider: 'pv-3', lines: PT(['2026-09-09', '2026-09-16', '2026-09-23', '2026-09-30']) },
  { at: '2026-10-12 13:15', do: 'claim', id: 'cl-13', member: 'm-1', provider: 'pv-2', lines: [['svc-specialist-visit', '2026-10-09', 33500, { accident: true }], ['svc-xray', '2026-10-09', 15800, { accident: true }]] },
  { at: '2026-10-15 10:30', do: 'claim', id: 'cl-14', member: 'm-3', provider: 'pv-3', lines: PT(['2026-10-01', '2026-10-13']) },
  { at: '2026-10-19 09:00', do: 'expect', actor: 'm-1', claim: 'cl-14', status: 'processed', denied: ['ln-2'] },
  { at: '2026-10-29 20:05', do: 'file', actor: 'm-1', label: 'ap-3', target: ['claim', 'cl-14'], statement: 'Riley\'s sixth approved therapy session was moved from October 8 to October 13 because the clinic closed for a staff training day; the authorization still had that session left. Please cover it as part of the approved course.' },
  { at: '2026-11-16 10:20', do: 'claim', id: 'cl-15', member: 'm-3', provider: 'pv-1', lines: [['svc-office-visit', '2026-11-12', 21500]] },
  { at: '2026-11-17 09:00', do: 'pa', id: 'pa-5', member: 'm-2', provider: 'pv-4', service: 'svc-arthroscopy', units: 1, from: '2026-12-07', until: '2027-01-15' },
  { at: '2026-11-17 11:40', do: 'claim', id: 'cl-16', member: 'm-3', provider: 'pv-2', lines: [['svc-specialist-visit', '2026-11-16', 33500, { accident: true }], ['svc-xray', '2026-11-16', 15800, { accident: true }]] },
  { at: '2026-11-18 08:50', do: 'claim', id: 'cl-17', member: 'm-1', provider: 'pv-1', lines: [['svc-office-visit', '2026-11-13', 21000]] },
];

const ROUTINE = {
  'm-1': { weight: 3, from: { 2025: '2025-01-02', 2026: '2026-01-12' }, kinds: [['sick', 4], ['labs', 2], ['specialist', 1], ['xray', 1], ['phone', 1]], physical: { 2025: '03', 2026: '05' } },
  'm-2': { weight: 3, from: { 2025: '2025-01-02', 2026: '2026-04-07' }, kinds: [['sick', 4], ['labs', 2], ['specialist', 2], ['phone', 1]], physical: { 2025: '02' } },
  'm-3': { weight: 4, from: { 2025: '2025-01-02', 2026: '2026-01-22' }, kinds: [['sick', 5], ['strep', 2], ['specialist', 1]], physical: { 2025: '08', 2026: '08' } },
};
const VISITS = {
  sick: { provider: 'pv-1', lines: [['svc-office-visit', [20500, 21000, 21500, 22000]]] },
  strep: { provider: 'pv-1', lines: [['svc-office-visit', [20500, 21000, 21500]], ['svc-strep-test', [4200]]] },
  labs: { provider: 'pv-1', lines: [['svc-office-visit', [21000, 21500, 22000]], ['svc-lab-panel', [8643, 9418, 11826]]] },
  phone: { provider: 'pv-1', lines: [['svc-phone-consult', [2400]]] },
  specialist: { provider: 'pv-4', lines: [['svc-specialist-visit', [33500, 34000, 36500]]] },
  xray: { provider: 'pv-4', lines: [['svc-xray', [14500, 15800, 16800]]] },
  physical: { provider: 'pv-1', lines: [['svc-office-visit', [22000, 23500]], ['svc-lipid-panel', [7200, 7800]]] },
  checkup: { provider: 'pv-1', lines: [['svc-office-visit', [21500, 22000]]] },
};
const EVENING = [1110, 1330];

const stamp = text => fromLocal(text.slice(0, 10), text.slice(11, 16));
const pad = n => String(n).padStart(2, '0');
const clockOf = minutes => pad(Math.floor(minutes / 60)) + ':' + pad(minutes % 60);
const weekday = date => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const monthDays = month => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const nextMonth = month => (month.slice(5) === '12' ? (Number(month.slice(0, 4)) + 1) + '-01' : month.slice(0, 5) + pad(Number(month.slice(5)) + 1));

function lcg(seed) {
  let state = seed;
  const n = k => { state = (state * 1103515245 + 12345) % 2147483648; return Math.floor(state / 65536) % k; };
  return { n, between: (a, b) => a + n(b - a + 1), pick: list => list[n(list.length)], weighted: list => { let r = n(list.reduce((s, [, w]) => s + w, 0)); for (const [v, w] of list) { if (r < w) return v; r -= w; } return list[0][0]; } };
}

function routineVisits() {
  const R = lcg(SEED), out = [], used = new Set();
  const addVisit = (member, kind, month) => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const day = R.between(1, monthDays(month)), received = month + '-' + pad(day);
      if ([0, 6].includes(weekday(received))) continue;
      let service = addDays(received, -R.between(2, 7));
      while ([0, 6].includes(weekday(service))) service = addDays(service, -1);
      const year = Number(month.slice(0, 4)), from = ROUTINE[member].from[year];
      if (service < from || used.has(member + ' ' + service)) continue;
      used.add(member + ' ' + service);
      const visit = VISITS[kind], minor = member === 'm-3';
      const lines = (kind === 'physical' && minor ? VISITS.checkup : visit).lines.map(([service_id, prices]) => [service_id, service, R.pick(prices)]);
      out.push({ at: received + ' ' + clockOf(R.between(480, 1050)), do: 'claim', member, provider: visit.provider, lines, routine: kind });
      return;
    }
  };
  for (let month = FROM.slice(0, 7); month <= ROUTINE_TO; month = nextMonth(month)) {
    const year = Number(month.slice(0, 4)), last = month + '-' + pad(monthDays(month));
    for (const [member, r] of Object.entries(ROUTINE)) if (r.physical[year] === month.slice(5)) addVisit(member, 'physical', month);
    const count = year === 2025 ? R.between(1, 3) : R.between(1, 2);
    for (let i = 0; i < count; i++) {
      const eligible = Object.entries(ROUTINE).filter(([, r]) => r.from[year] <= last).map(([m, r]) => [m, r.weight]);
      const member = R.weighted(eligible);
      addVisit(member, R.weighted(ROUTINE[member].kinds), month);
    }
  }
  return out.sort((a, b) => stamp(a.at) - stamp(b.at));
}

function authored(current) {
  const base = structuredClone(current);
  for (const key of RECORDS) base[key] = [];
  base.issued = {};
  for (const m of base.members) for (const y of m.enrolled_years) {
    base.coverage.push({ member_id: m.member_id, plan_year: y, status: 'unknown', version: 0, attested_at: null });
    base.accumulators.push({ member_id: m.member_id, plan_year: y, deductible_cents: 0, oop_cents: 0 });
  }
  return base;
}

function asActor(state, person) {
  const seed = structuredClone(state), binding = structuredClone(BINDING);
  seed.account_id = 'larkfield-' + person;
  seed.owner_person_id = person;
  binding.accounts = [{ app_id: APP, account_id: seed.account_id, owner_person_id: person }];
  return { seed, binding };
}

function simulate(base, observe) {
  const answers = lcg(SEED + 7);
  const END = ms(CLOCK), START = fromLocal(FROM, '00:00');
  let data = structuredClone(base), revision = 0, requests = 0, events = 0, steps = 0, seq = 0, hClaim = 0;
  const queue = [], labels = new Map(), done = new Set();
  const schedule = (t, fn) => queue.push({ t, seq: seq++, fn });
  const fail = message => { throw new Error(message); };
  const ctxOf = (binding, t, role = 'agent') => ({ app_id: APP, run_id: 'fixture-history', role, virtual_now: toIso(t), binding });
  function valid(state, ctx, when) {
    if (!seedValid(state)) fail('the state ' + when + ' at ' + ctx.virtual_now + ' does not match the seed schema');
    try { plugin.validateSeed(ctx, state); } catch (e) { fail('the state ' + when + ' at ' + ctx.virtual_now + ' fails validateSeed: ' + e.message); }
  }
  function owned(state) {
    const back = structuredClone(state);
    back.account_id = base.account_id;
    back.owner_person_id = base.owner_person_id;
    return back;
  }
  function commit(next, t) {
    valid(next, ctxOf(BINDING, t), 'after the step');
    if (observe) observe(next, toIso(t));
    data = next;
    steps++;
    revision++;
  }
  function call(t, actor, name, args = {}) {
    const write = WRITES.has(P + name);
    const full = write ? { request_id: 'fixture-' + (++requests), expected_version: { epoch: 1, revision }, ...args } : args;
    if (!inputValid.get(P + name)(full)) fail(name + ' arguments do not match the tool schema: ' + JSON.stringify(args));
    const { seed: mine, binding } = asActor(data, actor), ctx = ctxOf(binding, t);
    valid(mine, ctx, 'before ' + name + ' as ' + actor);
    let out;
    try { out = plugin.handleTool(ctx, mine, P + name, full); } catch (e) { fail(name + ' at ' + toIso(t) + ' as ' + actor + ': ' + (e.code || 'error') + ' ' + e.message); }
    if (write) {
      valid(out.data, ctx, 'after ' + name + ' as ' + actor);
      commit(owned(out.data), t);
    }
    return out.result;
  }
  function event(t, operation, payload) {
    const envelope = { event_id: 'fixture-' + (++events), at: toIso(t), operation, payload };
    if (!eventValid(envelope)) fail(operation + ' does not match the event schema: ' + JSON.stringify(payload));
    let next;
    try { next = plugin.applyEvent(ctxOf(BINDING, t, 'infra'), structuredClone(data), envelope); } catch (e) { fail(operation + ' at ' + toIso(t) + ': ' + (e.code || 'error') + ' ' + e.message); }
    commit(next, t);
  }
  function confirmed(t, actor, name, args) {
    const preview = call(t, actor, name + '.preview', args).preview;
    event(t, 'user.confirmed', { token: preview.token, confirmed_by: actor });
    return call(t, actor, name + '.confirm', { ...args, token: preview.token });
  }
  const slack = (t, deadline, what) => { if (ms(deadline) - t < SLACK) fail(what + ' at ' + toIso(t) + ' leaves less than two days before ' + deadline); };
  let seen = null, seenAt = null;
  const at = t => { if (seen === null || seenAt !== t || seen.source !== data) { seen = { source: data, state: project(data, toIso(t)) }; seenAt = t; } return seen.state; };
  let clock = 0;
  const claimOf = id => at(clock).claims.find(c => c.claim_id === id);
  const openOf = (claimId, type) => at(clock).info_requests.filter(r => r.claim_id === claimId && r.status === 'open' && (!type || r.type === type));
  const openCob = (member, year) => at(clock).info_requests.filter(r => r.type === 'other_coverage' && r.status === 'open' && r.plan_year === year && claimOf(r.claim_id).member_id === member);
  const pa = id => at(clock).pas.find(p => p.pa_id === id);
  const appealOf = label => at(clock).appeals.find(a => a.appeal_id === labels.get(label)) || fail('unknown appeal ' + label);
  const ref = name => labels.get(name) ?? fail('unknown label ' + name);
  const evening = date => fromLocal(date, clockOf(answers.between(...EVENING)));
  function cob(t, actor, member, year, answer) {
    const open = openCob(member, year);
    if (!open.length) fail('no open other-coverage question for ' + member + ' in ' + year + ' at ' + toIso(t));
    for (const r of open) slack(t, r.expires_at, 'the other-coverage answer for ' + r.claim_id);
    confirmed(t, actor, 'coverage.cob', { member_id: member, plan_year: year, answer });
  }
  function info(t, actor, claim, line, answer) {
    const r = openOf(claim, 'accident').find(x => x.line_id === line) || fail('no open accident question on ' + claim + ' ' + line + ' at ' + toIso(t));
    slack(t, r.expires_at, 'the accident answer for ' + claim + ' ' + line);
    confirmed(t, actor, 'claims.info', { claim_id: claim, line_id: line, answer });
  }
  const answererOf = member => (member === 'm-2' ? 'm-2' : member === 'm-3' ? (answers.n(100) < 65 ? 'm-2' : 'm-1') : answers.n(100) < 25 ? 'm-2' : 'm-1');
  function answerHistory(id, spec, t) {
    const c = claimOf(id);
    if (c.status !== 'pending_info') return;
    const actor = spec.answerer || answererOf(c.member_id);
    for (const year of [...new Set(openOf(id, 'other_coverage').map(r => r.plan_year))]) cob(t, actor, c.member_id, year, 'none');
    let when = t;
    for (const r of openOf(id, 'accident')) {
      if ((spec.unanswered || []).includes(r.line_id)) continue;
      when += 2 * MINUTE;
      info(when, actor, id, r.line_id, spec.accident || 'not_accident');
    }
  }
  function claim(t, s) {
    const id = s.id || 'cl-h' + (++hClaim);
    const lines = s.lines.map(([service_id, service_date, billed_cents, flags = {}], i) => ({ line_id: 'ln-' + (i + 1), service_id, service_date, units: 1, billed_cents, emergency: Boolean(flags.emergency), possible_accident: Boolean(flags.accident) }));
    event(t, 'claim.received', { claim_id: id, member_id: s.member, provider_id: s.provider, lines });
    labels.set(id, id);
    if (HISTORY.test(id)) {
      const review = ms(claimOf(id).review_at);
      schedule(evening(addDays(localDate(review), answers.between(1, 5))), u => answerHistory(id, s, u));
    }
  }
  function step(s, t) {
    if (s.do === 'grant') event(t, 'grant.changed', { grant_id: s.id, member_id: s.member, grantor_id: s.grantor, grantee_id: s.grantee, scope: s.scope, expires_at: s.expires, status: 'active' });
    else if (s.do === 'revoke') event(t, 'grant.changed', { grant_id: s.id, status: 'revoked' });
    else if (s.do === 'claim') claim(t, s);
    else if (s.do === 'cob') cob(t, s.actor, s.member, s.year, s.answer);
    else if (s.do === 'info') info(t, s.actor, s.claim, s.line, s.answer);
    else if (s.do === 'file') {
      const [type, id] = s.target, w = at(clock).windows.find(x => x.target.type === type && x.target.id === id) || fail('no appeal window for ' + id);
      slack(t, w.ends_at, 'the appeal filing on ' + id);
      const appeal = confirmed(t, s.actor, 'appeals.file', { target_type: type, target_id: ref(id), statement: s.statement }).appeal;
      if (appeal.appeal_id !== s.label) fail('timeline appeal ' + s.label + ' was issued as ' + appeal.appeal_id);
      labels.set(s.label, appeal.appeal_id);
    } else if (s.do === 'statement') {
      const a = appealOf(s.appeal);
      slack(t, a.due_at, 'the statement on ' + s.appeal);
      call(t, s.actor, 'appeals.add_statement', { appeal_id: a.appeal_id, statement: s.statement });
    } else if (s.do === 'appeal_info') {
      const a = appealOf(s.appeal);
      slack(t, a.due_at, 'the information request on ' + s.appeal);
      event(t, 'appeal.info_requested', { appeal_id: a.appeal_id, request: s.request });
    } else if (s.do === 'appeal_decide') {
      const a = appealOf(s.appeal);
      slack(t, a.due_at, 'the decision on ' + s.appeal);
      event(t, 'appeal.decided', { appeal_id: a.appeal_id, outcome: s.outcome, ...(s.lines ? { lines: s.lines } : {}) });
    } else if (s.do === 'pa') event(t, 'pa.submitted', { pa_id: s.id, member_id: s.member, provider_id: s.provider, service_id: s.service, units: s.units, valid_from: s.from, valid_until: s.until });
    else if (s.do === 'pa_info') { slack(t, pa(s.pa).due_at, 'the information request on ' + s.pa); event(t, 'pa.info_requested', { pa_id: s.pa, request: s.request }); }
    else if (s.do === 'pa_provided') { slack(t, pa(s.pa).due_at, 'the information for ' + s.pa); event(t, 'pa.info_provided', { pa_id: s.pa }); }
    else if (s.do === 'pa_decide') {
      slack(t, pa(s.pa).due_at, 'the decision on ' + s.pa);
      event(t, 'pa.decided', { pa_id: s.pa, decision: s.decision, ...(s.decision === 'approved' ? { units: s.units, valid_from: s.from, valid_until: s.until } : {}) });
    } else if (s.do === 'expedite') { slack(t, pa(s.pa).due_at, 'the expedite request on ' + s.pa); call(t, s.actor, 'pa.request_expedite', { pa_id: s.pa, reason: s.reason }); }
    else if (s.do === 'expedite_decide') { slack(t, pa(s.pa).due_at, 'the expedite decision on ' + s.pa); event(t, 'pa.expedite_decided', { pa_id: s.pa, decision: s.decision }); }
    else if (s.do === 'expect') {
      const c = call(t, s.actor, 'claims.get', { claim_id: s.claim }).claim, v1 = c.eobs.find(e => e.version === 1);
      const denied = v1 ? v1.lines.filter(l => l.status === 'denied').map(l => l.line_id) : [];
      if (c.status !== s.status || JSON.stringify(denied) !== JSON.stringify(s.denied)) fail(s.claim + ' is ' + c.status + ' with denied lines ' + denied.join(', ') + ' at ' + toIso(t));
    } else fail('unknown step ' + s.do);
  }
  const routine = routineVisits();
  for (const list of [HISTORY_STEPS, TIMELINE]) list.forEach((s, i) => { if (i && stamp(s.at) < stamp(list[i - 1].at)) fail('step ' + s.at + ' ' + s.do + ' is out of date order'); });
  for (const s of [...HISTORY_STEPS, ...routine, ...TIMELINE]) schedule(stamp(s.at), t => { step(s, t); done.add(s); });
  if (Math.min(...queue.map(q => q.t)) < START) fail('a step comes before ' + FROM);
  if (Math.min(...TIMELINE.map(s => stamp(s.at))) < fromLocal(TASK_FROM, '00:00')) fail('a task-timeline step comes before ' + TASK_FROM);
  while (queue.length) {
    queue.sort((a, b) => a.t - b.t || a.seq - b.seq);
    const task = queue.shift();
    if (task.t > END) fail('a step falls after the fixture clock at ' + toIso(task.t));
    clock = task.t;
    task.fn(task.t);
  }
  const missing = [...HISTORY_STEPS, ...routine, ...TIMELINE].filter(s => !done.has(s));
  if (missing.length) fail('steps not run: ' + missing.map(s => s.at + ' ' + s.do).join(', '));
  return { data, labels, steps, routine: routine.length };
}

function seriesOf(data) {
  const claim = id => (HISTORY.test(id) ? 'history' : 'timeline');
  const requests = new Map(data.info_requests.map(r => [r.info_request_id, r.claim_id]));
  const appeals = new Map(data.appeals.map(a => [a.appeal_id, a.target]));
  const target = t => (t.type === 'claim' ? claim(t.id) : HISTORY.test(t.id) ? 'history' : 'timeline');
  const records = [];
  for (const r of data.info_requests) records.push([r.info_request_id, claim(r.claim_id)]);
  for (const e of data.eobs) records.push([e.eob_id, claim(e.claim_id)]);
  for (const a of data.appeals) records.push([a.appeal_id, target(a.target)]);
  for (const n of data.notices) {
    const s = n.subject;
    records.push([n.notice_id, s.type === 'claim' ? claim(s.id) : s.type === 'info_request' ? claim(requests.get(s.id)) : s.type === 'appeal' ? target(appeals.get(s.id)) : target(s)]);
  }
  return records;
}

function relabel({ data }) {
  const groups = new Map(), map = new Map(), counts = {};
  for (const [id, as] of seriesOf(data)) {
    const prefix = id.slice(0, id.lastIndexOf('-')), key = prefix + ' ' + as;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(id);
  }
  const number = id => Number(id.slice(id.lastIndexOf('-') + 1));
  for (const [key, ids] of groups) {
    const [prefix, as] = key.split(' ');
    const series = as === 'history' ? 'h' : prefix === 'n' ? 't' : '';
    ids.sort((a, b) => number(a) - number(b)).forEach((id, i) => map.set(id, prefix + '-' + series + (i + 1)));
    if (as === 'timeline' && series === '') counts[prefix] = ids.length;
  }
  const swap = v => (typeof v === 'string' ? v.replace(LIVE_ID, m => map.get(m) ?? m) : Array.isArray(v) ? v.map(swap) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)])) : v);
  const out = { ...data };
  for (const key of RECORDS) out[key] = key === 'approvals' ? [] : swap(data[key]);
  const issued = {};
  for (const [k, v] of Object.entries(data.issued)) if (!COUNTED.includes(k) && k !== 'cf' && k !== 'gr') issued[k] = v;
  for (const p of COUNTED) if (p !== 'n' && counts[p]) issued[p] = String(counts[p]);
  issued.gr = GRANTS_ISSUED;
  out.issued = Object.fromEntries(Object.entries(issued).sort(([a], [b]) => (a < b ? -1 : 1)));
  if (out.notices.some(n => !HISTORY.test(n.notice_id) && !TIMELINE_NOTICE.test(n.notice_id))) throw new Error('a seeded notice is in the runtime notice series');
  return out;
}

const cache = new Map();
function build(current) {
  const base = authored(current), key = JSON.stringify(base);
  if (!cache.has(key)) {
    const sim = simulate(base);
    const out = relabel(sim);
    if (!seedValid(out)) throw new Error('the generated fixture does not match the seed schema');
    plugin.validateSeed({ app_id: APP, virtual_now: CLOCK, binding: BINDING }, out);
    cache.set(key, { out, steps: sim.steps, routine: sim.routine });
  }
  const { out, steps, routine } = cache.get(key);
  return { out: structuredClone(out), steps, routine };
}

function main() {
  const current = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const { out, steps } = build(current);
  const text = JSON.stringify(out, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    const same = text === fs.readFileSync(FILE, 'utf8');
    console.log(same ? 'fixture history is up to date' : 'fixture history differs from the generator output');
    process.exitCode = same ? 0 : 1;
    return;
  }
  fs.writeFileSync(FILE, text);
  const count = (list, key) => ({ history: list.filter(r => HISTORY.test(r[key])).length, timeline: list.filter(r => !HISTORY.test(r[key])).length });
  console.log(JSON.stringify({ validated_states: steps, claims: count(out.claims, 'claim_id'), eobs: count(out.eobs, 'eob_id'), requests: count(out.info_requests, 'info_request_id'), pas: out.pas.length, appeals: out.appeals.length, grants: count(out.grants, 'grant_id'), notices: count(out.notices, 'notice_id'), bytes: Buffer.byteLength(text) }));
}

if (require.main === module) main();
module.exports = { build, authored, simulate, relabel, routineVisits, GRANTS_ISSUED, HISTORY, TIMELINE_NOTICE, LIVE_ID, SEED, FROM, TASK_FROM, ROUTINE_TO, TIMELINE, HISTORY_STEPS, ROUTINE, VISITS };
