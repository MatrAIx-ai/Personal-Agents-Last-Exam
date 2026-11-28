'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const plugin = require('../plugin.cjs');
const { compile } = require('../tests/schema-validator.cjs');
const { ms, toIso, localDate, addDays, fromLocal, validDate } = require('../src/time.cjs');

const ROOT = path.join(__dirname, '..');
const APP = 'larkfield-health', P = APP + '.';
const ZONE = 'America/New_York';
const FIRST = '2025-01-01', LAST = '2026-12-31';
const START = '2025-01-01T00:00:00-05:00', END = '2027-01-01T00:00:00-05:00';
const FILES = { base: 'dataset/base.json', replay: 'dataset/replay.json', full: 'dataset/full.json' };
const SEED_IDS = { base: 'larkfield-delivery-base', full: 'larkfield-delivery-2025-2026', asOf: 'larkfield-delivery-asof-' };
const RUN = 'larkfield-delivery';
const read = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const BINDING = read('fixtures/binding.json');
const REFERENCE = read('fixtures/clock.json').initial_time;
const OWNER = BINDING.accounts.find(a => a.app_id === APP).owner_person_id;
const TOOLS = read('tools.json');
const WRITES = new Set(TOOLS.filter(t => !t.read_only).map(t => t.name));
const seedValid = compile(read('schemas/seed.schema.json'), path.join(ROOT, 'schemas'));
const eventValid = compile(read('schemas/events.schema.json'), path.join(ROOT, 'schemas'));
const inputValid = new Map(TOOLS.map(t => [t.name, compile(t.inputSchema, ROOT)]));
const PREVIEW = {
  'grants.change.confirm': 'grants.change.preview', 'coverage.cob.confirm': 'coverage.cob.preview', 'claims.info.confirm': 'claims.info.preview',
  'appeals.file.confirm': 'appeals.file.preview', 'appeals.withdraw.confirm': 'appeals.withdraw.preview',
};

const pad = n => String(n).padStart(2, '0');
const dateOf = iso => localDate(ms(iso));
const at = (date, hhmm) => toIso(fromLocal(date, hhmm));
const weekdayOf = date => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const INSTANT = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-](\d{2}):(\d{2})))?$/;
function instant(text) {
  const m = typeof text === 'string' ? INSTANT.exec(text) : null;
  const usage = 'Give the instant as a calendar date (2026-01-01, local midnight in ' + ZONE + ') or as a date-time with an offset (2026-01-01T00:00:00-05:00).';
  if (!m || !validDate(m[1])) throw Error(usage + ' ' + JSON.stringify(text) + ' is not one.');
  if (m[2] === undefined) return toIso(fromLocal(m[1], '00:00'));
  if (m[6] === undefined || Number(m[2]) > 23 || Number(m[3]) > 59 || Number(m[4] || 0) > 59 || (m[7] !== undefined && (Number(m[7]) > 14 || Number(m[8]) > 59))) throw Error(usage + ' ' + JSON.stringify(text) + ' is not one.');
  const t = ms(text);
  if (!Number.isFinite(t)) throw Error(usage + ' ' + JSON.stringify(text) + ' is not one.');
  return toIso(t);
}
const months = () => {
  const out = [];
  for (let y = Number(FIRST.slice(0, 4)), m = Number(FIRST.slice(5, 7)); y * 12 + m <= Number(LAST.slice(0, 4)) * 12 + Number(LAST.slice(5, 7)); m === 12 ? (y++, m = 1) : m++) out.push(y + '-' + pad(m));
  return out;
};

function validate(data, now) {
  if (!seedValid(data)) throw Error('The state at ' + now + ' does not match the seed schema.');
  if (data.approvals.length) throw Error('The state at ' + now + ' keeps an approval; seeds carry none.');
  try { plugin.validateSeed({ app_id: APP, virtual_now: now, binding: BINDING }, data); } catch (e) { throw Error('The state at ' + now + ' fails validateSeed: ' + e.message); }
}

function as(data, person, fn) {
  if (person === data.owner_person_id) return fn(BINDING);
  const account = data.account_id, owner = data.owner_person_id;
  data.owner_person_id = person;
  data.account_id = 'larkfield-' + person;
  try { return fn({ ...BINDING, accounts: [{ app_id: APP, account_id: data.account_id, owner_person_id: person }] }); } finally {
    data.account_id = account;
    data.owner_person_id = owner;
  }
}

const eventId = step => RUN + '-' + step.id;
const envelope = step => ({ event_id: eventId(step), at: step.at, operation: step.operation, payload: structuredClone(step.payload) });
const context = (step, binding, role) => ({ app_id: APP, run_id: RUN, role, virtual_now: step.at, binding });
const businessOf = args => { const { request_id, expected_version, token, ...rest } = args; return rest; };

function read1(data, actor, now, tool, args) {
  return as(data, actor, binding => plugin.handleTool(context({ at: now }, binding, 'agent'), data, P + tool, args).result);
}

function apply(data, step, { check = false } = {}) {
  try {
    if (step.by === 'infra') {
      const e = envelope(step);
      if (check && !eventValid(e)) throw Error('the event does not match the event schema');
      plugin.applyEvent(context(step, BINDING, 'infra'), data, e);
      return null;
    }
    return as(data, step.by, binding => {
      const ctx = context(step, binding, 'agent'), name = step.tool.slice(P.length);
      const args = { request_id: RUN + '-' + step.id, expected_version: { epoch: 1, revision: 0 }, ...structuredClone(step.args) };
      if (PREVIEW[name]) {
        args.token = plugin.handleTool(ctx, data, P + PREVIEW[name], structuredClone(step.args)).result.preview.token;
        plugin.applyEvent(context(step, binding, 'infra'), data, { event_id: eventId(step) + '-confirmed', at: step.at, operation: 'user.confirmed', payload: { token: args.token, confirmed_by: step.by } });
      }
      if (check && !inputValid.get(step.tool)(args)) throw Error('the arguments do not match the tool schema');
      const result = plugin.handleTool(ctx, data, step.tool, args).result;
      if (PREVIEW[name]) data.approvals = data.approvals.filter(a => a.used_at === null);
      return result;
    });
  } catch (e) { throw Object.assign(Error('Replay step ' + step.id + ' (' + (step.tool || step.operation) + ' at ' + step.at + ' by ' + step.by + ') failed: ' + (e.code ? e.code + ' ' : '') + e.message), { code: e.code || 'error' }); }
}

function changes(data, step) {
  const { applyDueTimers } = require('../src/timers.cjs');
  const pre = structuredClone(data);
  applyDueTimers(pre, step.at);
  const before = JSON.stringify({ ...pre, issued: null }), trial = structuredClone(data);
  apply(trial, step);
  return JSON.stringify({ ...trial, issued: null }) !== before;
}
function unchanged(base, steps) {
  const data = structuredClone(base), out = [];
  for (const step of steps) { if (!changes(data, step)) out.push(step.id + ' (' + (step.tool || step.operation) + ' at ' + step.at + ')'); apply(data, step); }
  return out;
}

function replay(base, steps, until, { check = false } = {}) {
  const limit = until === undefined ? Infinity : ms(until);
  const data = structuredClone(base);
  let applied = 0;
  for (const step of steps) {
    if (ms(step.at) >= limit) break;
    apply(data, step, { check });
    applied++;
    if (check) validate(data, step.at);
  }
  return { data, applied };
}

const pretty = value => JSON.stringify(value, null, 2) + '\n';
function replayText(log) {
  const { steps, ...head } = log;
  return JSON.stringify(head, null, 2).slice(0, -2) + ',\n  "steps": [\n' + steps.map(s => '    ' + JSON.stringify(s)).join(',\n') + '\n  ]\n}\n';
}
const file = rel => path.join(ROOT, rel);
function load() {
  const bytes = Object.fromEntries(Object.values(FILES).map(rel => [rel, fs.readFileSync(file(rel), 'utf8')]));
  const files = { base: JSON.parse(bytes[FILES.base]), replay: JSON.parse(bytes[FILES.replay]), full: JSON.parse(bytes[FILES.full]) };
  const parsed = { [FILES.base]: JSON.stringify(files.base), [FILES.replay]: JSON.stringify(files.replay), [FILES.full]: JSON.stringify(files.full) };
  Object.defineProperty(files, 'bytes', { value: bytes, enumerable: false, configurable: true });
  Object.defineProperty(files, 'parsed', { value: parsed, enumerable: false, configurable: true });
  return files;
}
const sha256 = rel => crypto.createHash('sha256').update(fs.readFileSync(file(rel))).digest('hex');
const digestOf = text => crypto.createHash('sha256').update(text).digest('hex');
function bytesOf(files) {
  const canonical = { [FILES.base]: () => pretty(files.base), [FILES.replay]: () => replayText(files.replay), [FILES.full]: () => pretty(files.full) };
  const used = { [FILES.base]: files.base, [FILES.replay]: files.replay, [FILES.full]: files.full };
  return Object.fromEntries(Object.keys(canonical).map(rel => [rel, files.bytes && files.parsed && files.parsed[rel] === JSON.stringify(used[rel]) ? files.bytes[rel] : canonical[rel]()]));
}

const KINDS = [
  { kind: 'claim', list: 'claims', id: 'claim_id', date_field: 'received_at' },
  { kind: 'claim_processing', list: 'claims', id: '<claim id>/processed', date_field: 'processed_at (processed claims)' },
  { kind: 'info_request', list: 'info_requests', id: 'info_request_id', date_field: 'opened_at' },
  { kind: 'info_answer', list: 'info_requests', id: '<request id>/answered', date_field: 'answered_at (answered requests)' },
  { kind: 'info_expiry', list: 'info_requests', id: '<request id>/expired', date_field: 'expires_at (expired requests)' },
  { kind: 'attestation', list: 'coverage', id: '<member id>:<plan year>', date_field: 'attested_at (attested member-years)' },
  { kind: 'eob', list: 'eobs', id: 'eob_id', date_field: 'issued_at' },
  { kind: 'pa', list: 'pas', id: 'pa_id', date_field: 'submitted_at' },
  { kind: 'pa_info_request', list: 'pas[].info_requests', id: '<pa id>/info-<n>', date_field: 'at' },
  { kind: 'pa_expedite', list: 'pas[].expedite', id: '<pa id>/expedite', date_field: 'requested_at' },
  { kind: 'pa_expedite_decision', list: 'pas[].expedite', id: '<pa id>/expedite-decided', date_field: 'decided_at (decided expedites)' },
  { kind: 'pa_decision', list: 'pas', id: '<pa id>/decided', date_field: 'decided_at (approved or denied PAs, also after expiry)' },
  { kind: 'pa_overdue', list: 'pas', id: '<pa id>/overdue', date_field: 'overdue_at (overdue PAs)' },
  { kind: 'pa_expiry', list: 'pas', id: '<pa id>/expired', date_field: 'expired_at (expired PAs)' },
  { kind: 'covered_submission', list: 'pas[].covered_submissions', id: 'pa_id', date_field: 'at' },
  { kind: 'appeal', list: 'appeals', id: 'appeal_id', date_field: 'filed_at' },
  { kind: 'appeal_statement', list: 'appeals[].statements', id: '<appeal id>/statement-<n>', date_field: 'at' },
  { kind: 'appeal_info_request', list: 'appeals[].info_requests', id: '<appeal id>/info-<n>', date_field: 'at' },
  { kind: 'appeal_decision', list: 'appeals', id: '<appeal id>/decided', date_field: 'decided_at (upheld or overturned appeals)' },
  { kind: 'appeal_withdrawal', list: 'appeals', id: '<appeal id>/withdrawn', date_field: 'withdrawn_at (withdrawn appeals)' },
  { kind: 'appeal_overdue', list: 'appeals', id: '<appeal id>/overdue', date_field: 'overdue_at (overdue appeals)' },
  { kind: 'appeal_window', list: 'windows', id: '<target type>:<target id>', date_field: 'notice_at' },
  { kind: 'window_closing_notice', list: 'windows', id: '<target type>:<target id>/closing', date_field: 'closing.notice_at (closing notices sent)' },
  { kind: 'grant', list: 'grants', id: 'grant_id', date_field: 'created_at' },
  { kind: 'grant_revocation', list: 'grants', id: '<grant id>/revoked', date_field: 'revoked_at (revoked grants)' },
  { kind: 'notice', list: 'notices', id: 'notice_id', date_field: 'at' },
];

function dated(seed) {
  const out = [];
  const add = (kind, id, when, required = true) => { if (required || (when !== null && when !== undefined)) out.push({ kind, id, at: when === undefined ? null : when }); };
  for (const c of seed.claims) { add('claim', c.claim_id, c.received_at); add('claim_processing', c.claim_id + '/processed', c.processed_at, c.status === 'processed'); }
  for (const r of seed.info_requests) {
    add('info_request', r.info_request_id, r.opened_at);
    add('info_answer', r.info_request_id + '/answered', r.answered_at, r.status === 'answered');
    if (r.status === 'expired') add('info_expiry', r.info_request_id + '/expired', r.expires_at);
  }
  for (const c of seed.coverage) add('attestation', c.member_id + ':' + c.plan_year, c.attested_at, c.status !== 'unknown');
  for (const e of seed.eobs) add('eob', e.eob_id, e.issued_at);
  for (const p of seed.pas) {
    add('pa', p.pa_id, p.submitted_at);
    p.info_requests.forEach((r, i) => add('pa_info_request', p.pa_id + '/info-' + (i + 1), r.at));
    if (p.expedite) { add('pa_expedite', p.pa_id + '/expedite', p.expedite.requested_at); add('pa_expedite_decision', p.pa_id + '/expedite-decided', p.expedite.decided_at, p.expedite.status !== 'open'); }
    add('pa_decision', p.pa_id + '/decided', p.decided_at, p.approved !== null || p.status === 'denied');
    add('pa_overdue', p.pa_id + '/overdue', p.overdue_at, p.overdue);
    add('pa_expiry', p.pa_id + '/expired', p.expired_at, p.status === 'expired');
    for (const s of p.covered_submissions) add('covered_submission', s.pa_id, s.at);
  }
  for (const a of seed.appeals) {
    add('appeal', a.appeal_id, a.filed_at);
    a.statements.forEach((s, i) => add('appeal_statement', a.appeal_id + '/statement-' + (i + 1), s.at));
    a.info_requests.forEach((r, i) => add('appeal_info_request', a.appeal_id + '/info-' + (i + 1), r.at));
    add('appeal_decision', a.appeal_id + '/decided', a.decided_at, a.status === 'upheld' || a.status === 'overturned');
    add('appeal_withdrawal', a.appeal_id + '/withdrawn', a.withdrawn_at, a.status === 'withdrawn');
    add('appeal_overdue', a.appeal_id + '/overdue', a.overdue_at, a.overdue);
  }
  for (const w of seed.windows) {
    const key = w.target.type + ':' + w.target.id;
    add('appeal_window', key, w.notice_at);
    add('window_closing_notice', key + '/closing', w.closing.notice_at, false);
  }
  for (const g of seed.grants) { add('grant', g.grant_id, g.created_at); add('grant_revocation', g.grant_id + '/revoked', g.revoked_at, g.status === 'revoked'); }
  for (const n of seed.notices) add('notice', n.notice_id, n.at);
  return out;
}
const OFFICE_GAP = 3;
const CAPS = { sick_per_month: 1, office_per_month: 2, story_injury_days: 14, injury_gap_days: 30, episode_days: 30 };
const STORY_EPISODES = { 'riley-ankle': 'm-3', 'casey-knee': 'm-2', 'riley-knee': 'm-3', 'jordan-work': 'm-1', 'jordan-back': 'm-1' };
const ROUTINE_EPISODE = /^(injury|joint):(m-\d+):(\d{4}-\d{2}-\d{2})$/;
function injuryProblems(seed, steps) {
  const out = [], fixes = corrections(seed, steps), episodes = new Map();
  const quarter = d => d.slice(0, 4) + 'Q' + Math.ceil(Number(d.slice(5, 7)) / 3);
  for (const c of seed.claims) {
    if (fixes.has(c.claim_id) || !c.lines.some(l => l.possible_accident)) continue;
    const step = steps.find(x => x.operation === 'claim.received' && x.payload.claim_id === c.claim_id);
    if (!step || !step.episode) { out.push(c.claim_id + ' bills an injury without naming its episode'); continue; }
    const first = c.lines.map(l => l.service_date).sort()[0], key = c.member_id + ' ' + step.episode, named = ROUTINE_EPISODE.exec(step.episode);
    if (named && (named[2] !== c.member_id || named[3] !== first)) { out.push(c.claim_id + ' names the episode ' + step.episode + ' but bills ' + c.member_id + ' from ' + first); continue; }
    if (!named && !STORY_EPISODES[step.episode]) { out.push(c.claim_id + ' names ' + step.episode + ', which is no episode of the dataset'); continue; }
    if (!named && STORY_EPISODES[step.episode] !== c.member_id) { out.push(c.claim_id + ' names the episode ' + step.episode + ', which is ' + STORY_EPISODES[step.episode] + '\'s, but bills ' + c.member_id); continue; }
    if (!episodes.has(key)) episodes.set(key, { member: c.member_id, episode: step.episode, date: first, claim: c.claim_id, dates: [] });
    const e = episodes.get(key);
    e.dates.push([first, c.claim_id, step.visit]);
    if (first < e.date) Object.assign(e, { date: first, claim: c.claim_id });
  }
  for (const e of episodes.values()) {
    const opening = e.dates.filter(([, , kind]) => kind === 'injury');
    if (STORY_EPISODES[e.episode] && (opening.length !== 1 || opening[0][0] !== e.date)) out.push(e.episode + ' of ' + e.member + ' has ' + opening.length + ' injury visits' + (opening.length ? ' from ' + opening.map(x => x[0]).join(', ') : '') + ', not one first visit on ' + e.date);
    for (const [d, id] of e.dates) if (daysBetween(e.date, d) > CAPS.episode_days) out.push(id + ' on ' + d + ' is more than ' + CAPS.episode_days + ' days after the first visit of ' + e.episode + ' on ' + e.date);
  }
  const list = [...episodes.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  const injuries = list.filter(e => !e.episode.startsWith('joint:'));
  for (const x of injuries) for (const y of injuries) if (x.member === y.member && x.episode < y.episode && Math.abs(daysBetween(x.date, y.date)) <= CAPS.story_injury_days) out.push(x.member + ' has two injuries within ' + CAPS.story_injury_days + ' days: ' + x.claim + ' on ' + x.date + ' and ' + y.claim + ' on ' + y.date);
  const routine = new Map();
  for (const x of list.filter(e => e.episode.startsWith('injury:'))) { const k = x.member + ' ' + quarter(x.date); routine.set(k, [...(routine.get(k) || []), x.claim]); }
  for (const [k, claims] of routine) if (claims.length > 1) out.push(k + ' has ' + claims.length + ' routine injuries: ' + claims.join(', '));
  const spaced = list.filter(e => e.episode.startsWith('injury:'));
  for (const x of spaced) for (const y of spaced) if (x.member === y.member && x.date < y.date && daysBetween(x.date, y.date) <= CAPS.injury_gap_days) out.push(x.member + ' has two routine injuries ' + daysBetween(x.date, y.date) + ' days apart: ' + x.claim + ' on ' + x.date + ' and ' + y.claim + ' on ' + y.date);
  return out;
}
function afterEnd(seed, steps) {
  const out = [], courses = new Map(), fixes = corrections(seed, steps), named = new Map();
  for (const x of steps.filter(y => y.operation === 'pa.submitted' && y.payload.service_id === 'svc-physical-therapy')) {
    if (!x.course) out.push(x.payload.pa_id + ' requests therapy without naming its course');
    else named.set(x.payload.pa_id, x.course);
  }
  for (const c of seed.claims) {
    const lines = c.lines.filter(l => l.service_id === 'svc-physical-therapy');
    if (!lines.length || fixes.has(c.claim_id)) continue;
    const step = steps.find(x => x.operation === 'claim.received' && x.payload.claim_id === c.claim_id);
    if (!step || !step.course) { out.push(c.claim_id + ' bills therapy without naming its course'); continue; }
    const k = c.member_id + ' ' + step.course;
    courses.set(k, [...(courses.get(k) || []), ...lines.map(l => ({ claim: c.claim_id, line: l.line_id, date: l.service_date }))]);
  }
  for (const [k, sessions] of courses) {
    const [member, course] = k.split(' '), approved = seed.pas.filter(x => x.member_id === member && x.service_id === 'svc-physical-therapy' && x.approved && named.get(x.pa_id) === course);
    const covered = d => approved.some(x => x.approved.valid_from <= d && d <= x.approved.valid_until);
    const list = sessions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)), outside = list.filter(x => !covered(x.date));
    if (outside.length === list.length) { out.push('the course ' + k + ' has no session inside an approved authorization of its own'); continue; }
    if (outside.length > 1) out.push('the course ' + k + ' has ' + outside.length + ' sessions outside its authorizations (' + approved.map(x => x.pa_id).join(', ') + '): ' + outside.map(x => x.claim + ' ' + x.line + ' ' + x.date).join(', '));
    else if (outside.length === 1 && outside[0] !== list[list.length - 1]) out.push('the course ' + k + ' continues after its session outside the authorization on ' + outside[0].date);
    else if (outside.length === 1 && !approved.some(x => x.approved.valid_until < outside[0].date && list.some(y => covered(y.date) && x.approved.valid_from <= y.date && y.date <= x.approved.valid_until))) out.push('the course ' + k + ' has a session outside its authorizations that does not follow one: ' + outside[0].date);
  }
  return out;
}
const VISIT_KINDS = ['sick', 'strep', 'labs', 'phone', 'specialist', 'joint', 'physical', 'checkup', 'work-up', 'follow-up', 'orthopedic', 'imaging', 'injury', 'therapy', 'emergency', 'surgery'];
const IMAGING = ['svc-xray', 'svc-ultrasound', 'svc-knee-mri'];
const SERVICE_PROVIDERS = {
  'svc-office-visit': ['prescriber'], 'svc-phone-consult': ['prescriber'], 'svc-lipid-panel': ['prescriber'], 'svc-strep-test': ['prescriber'], 'svc-semaglutide-1': ['prescriber'],
  'svc-lab-panel': ['prescriber', 'hospital'], 'svc-wound-repair': ['prescriber', 'hospital'], 'svc-specialist-visit': ['clinic', 'hospital'], 'svc-xray': ['clinic', 'hospital', 'imaging'],
  'svc-ultrasound': ['hospital', 'imaging'], 'svc-knee-mri': ['hospital', 'imaging'], 'svc-physical-therapy': ['therapy'], 'svc-er-visit': ['hospital'], 'svc-arthroscopy': ['hospital'],
};
const YEARLY = { 'm-1': { physical: 1 }, 'm-2': { physical: 1, labs: 1 }, 'm-3': { checkup: 1 } };
const LINKED = { first: 'work-up', later: 'follow-up', service: 'svc-semaglutide-1' };
const CADENCE = { member: 'm-1', kind: 'labs', days: [84, 98] };
const FOLLOW_UP_DAYS = 10;
function visitProblems(seed, steps, routine) {
  const out = [], sick = new Map(), yearly = new Map(), kindOf = new Map(seed.providers.map(p => [p.provider_id, p.kind]));
  const services = c => c.lines.map(l => l.service_id).sort().join('+'), list = ids => ids.slice().sort().join('+');
  const at = (c, ...kinds) => kinds.includes(kindOf.get(c.provider_id)), calm = c => c.lines.every(l => !l.possible_accident && !l.emergency);
  const fits = {
    'work-up': c => at(c, 'prescriber') && services(c) === 'svc-lab-panel+svc-office-visit' && calm(c),
    'follow-up': c => at(c, 'prescriber') && services(c) === 'svc-office-visit' && calm(c),
    orthopedic: c => at(c, 'clinic') && services(c) === 'svc-specialist-visit' && c.lines.every(l => !l.possible_accident),
    imaging: c => c.lines.length === 1 && IMAGING.includes(c.lines[0].service_id) && at(c, 'hospital', 'imaging'),
    injury: (c, x) => c.lines.every(l => l.possible_accident) && Boolean(x.episode) && !x.episode.startsWith('joint:'),
    therapy: (c, x) => at(c, 'therapy') && c.lines.every(l => l.service_id === 'svc-physical-therapy') && Boolean(x.course),
    emergency: c => at(c, 'hospital') && c.lines.some(l => l.service_id === 'svc-er-visit'),
    surgery: c => at(c, 'hospital') && c.lines.some(l => l.service_id === 'svc-arthroscopy'),
  };
  for (const [kind, v] of Object.entries(routine)) fits[kind] = (c, x) => at(c, kindOf.get(v.provider)) && services(c) === list(v.lines.map(([id]) => id)) && c.lines.every(l => Boolean(l.possible_accident) === Boolean(v.accident)) && (!v.accident || (x.episode || '').startsWith('joint:'));
  const fixes = corrections(seed, steps), labelled = new Map();
  for (const c of seed.claims) {
    const x = steps.find(y => y.operation === 'claim.received' && y.payload.claim_id === c.claim_id);
    for (const l of c.lines) if (!(SERVICE_PROVIDERS[l.service_id] || []).includes(kindOf.get(c.provider_id))) out.push(c.claim_id + ' bills ' + l.service_id + ' at ' + c.provider_id + ', a ' + kindOf.get(c.provider_id) + ', which does not provide it');
    if (!x || !VISIT_KINDS.includes(x.visit)) { out.push(c.claim_id + ' names no kind of visit'); continue; }
    if (!fits[x.visit] || !fits[x.visit](c, x)) { out.push(c.claim_id + ' is labelled a ' + x.visit + ' visit but bills ' + services(c) + ' at ' + c.provider_id); continue; }
    if (fixes.has(c.claim_id)) continue;
    const first = c.lines.map(l => l.service_date).sort()[0];
    labelled.set(c.claim_id, { c, kind: x.visit, first });
    if (x.visit === 'sick' || x.visit === 'strep') { const k = c.member_id + ' ' + first.slice(0, 7); sick.set(k, [...(sick.get(k) || []), c.claim_id]); }
    const y = c.member_id + ' ' + first.slice(0, 4) + ' ' + x.visit;
    yearly.set(y, [...(yearly.get(y) || []), c.claim_id]);
  }
  for (const [k, claims] of sick) if (claims.length > CAPS.sick_per_month) out.push(k + ' has ' + claims.length + ' sick visits: ' + claims.join(', '));
  for (const year of [FIRST.slice(0, 4), LAST.slice(0, 4)]) for (const [member, kinds] of Object.entries(YEARLY)) for (const [kind, n] of Object.entries(kinds)) {
    const claims = yearly.get(member + ' ' + year + ' ' + kind) || [];
    if (claims.length !== n) out.push(member + ' has ' + claims.length + ' ' + kind + ' visits in ' + year + ', not ' + n + (claims.length ? ': ' + claims.join(', ') : ''));
  }
  for (const [y, claims] of yearly) { const [member, , kind] = y.split(' '); if ((kind === 'physical' || kind === 'checkup' || (kind === 'labs' && member !== CADENCE.member)) && !(YEARLY[member] || {})[kind]) out.push(member + ' has a ' + kind + ' visit, which is not one of their yearly visits: ' + claims.join(', ')); }
  const regular = [...labelled.values()].filter(v => v.c.member_id === CADENCE.member && v.kind === CADENCE.kind).map(v => v.first).sort(), [low, high] = CADENCE.days;
  if (!regular.length || daysBetween(FIRST, regular[0]) > high) out.push(CADENCE.member + '\'s first regular visit, ' + (regular[0] || 'none') + ', is more than 14 weeks after ' + FIRST);
  if (!regular.length || daysBetween(regular[regular.length - 1], LAST) > high) out.push(CADENCE.member + '\'s last regular visit, ' + (regular[regular.length - 1] || 'none') + ', is more than 14 weeks before ' + LAST);
  for (let i = 1; i < regular.length; i++) { const gap = daysBetween(regular[i - 1], regular[i]); if (gap < low || gap > high) out.push(CADENCE.member + ' has lab visits on ' + regular[i - 1] + ' and ' + regular[i] + ', ' + gap + ' days apart, not 12 to 14 weeks'); }
  const visits = [...labelled.values()].filter(x => x.kind === LINKED.first || x.kind === LINKED.later), linked = new Set();
  const requests = seed.pas.filter(p => p.service_id === LINKED.service).sort((a, b) => ms(a.submitted_at) - ms(b.submitted_at));
  requests.forEach((p, i) => {
    const kind = requests.slice(0, i).some(q => q.member_id === p.member_id) ? LINKED.later : LINKED.first;
    const match = visits.filter(v => !linked.has(v) && v.kind === kind && v.c.member_id === p.member_id && v.c.provider_id === p.provider_id).filter(v => { const d = daysBetween(v.first, dateOf(p.submitted_at)); return d >= 1 && d <= FOLLOW_UP_DAYS; }).sort((a, b) => (a.first < b.first ? 1 : -1))[0];
    if (match) linked.add(match);
    else out.push(p.pa_id + ', a ' + (kind === LINKED.first ? 'first' : 'renewed') + ' semaglutide request, has no ' + kind + ' visit of its own in the ' + FOLLOW_UP_DAYS + ' days before it');
  });
  for (const v of visits.filter(x => !linked.has(x))) out.push(v.c.claim_id + ' is labelled a ' + v.kind + ' visit, but no semaglutide request of its own from ' + v.c.provider_id + ' follows it within ' + FOLLOW_UP_DAYS + ' days');
  return out;
}
function visitLoad(seed) {
  const out = [], counts = new Map();
  for (const c of seed.claims) for (const d of new Set(c.lines.filter(l => l.service_id === 'svc-office-visit' && !l.possible_accident && !l.emergency).map(l => l.service_date))) { const k = c.member_id + ' ' + d.slice(0, 7); counts.set(k, [...(counts.get(k) || []), c.claim_id]); }
  for (const [k, claims] of counts) if (claims.length > CAPS.office_per_month) out.push(k + ' has ' + claims.length + ' office visits: ' + claims.join(', '));
  return out;
}
function corrections(seed, steps) {
  const out = new Map(), problems = [];
  for (const step of steps.filter(x => x.operation === 'claim.received' && x.corrects)) {
    const c = seed.claims.find(x => x.claim_id === step.payload.claim_id), o = seed.claims.find(x => x.claim_id === step.corrects);
    const lines = x => x.lines.map(l => l.service_id + '@' + l.service_date).sort().join(',');
    const appealed = o && seed.appeals.some(a => a.target.type === 'claim' && a.target.id === o.claim_id && ms(a.filed_at) < ms(c.received_at));
    if (!c || !o || c.member_id !== o.member_id || c.provider_id !== o.provider_id || lines(c) !== lines(o) || ms(c.received_at) <= ms(o.received_at) || !appealed) problems.push(step.payload.claim_id + ' names ' + step.corrects + ' as the claim it corrects, but it does not bill the same services after an appeal on it');
    else if ([...out.values()].includes(o.claim_id) || out.has(o.claim_id)) problems.push(step.payload.claim_id + ' names ' + step.corrects + ' as the claim it corrects, which is already corrected or is itself a correction');
    else out.set(c.claim_id, o.claim_id);
  }
  return Object.assign(out, { problems });
}
function collisions(seed, steps) {
  const fixes = corrections(seed, steps), out = [...fixes.problems], at = new Map(), office = new Map();
  for (const c of seed.claims) {
    if (fixes.has(c.claim_id)) continue;
    for (const l of c.lines) {
      const k = c.member_id + ' ' + c.provider_id + ' ' + l.service_date, o = c.member_id + ' ' + l.service_date;
      if (at.has(k) && at.get(k) !== c.claim_id) out.push(c.claim_id + ' and ' + at.get(k) + ' both bill ' + c.member_id + ' at ' + c.provider_id + ' on ' + l.service_date);
      else at.set(k, c.claim_id);
      if (l.service_id !== 'svc-office-visit') continue;
      if (office.has(o) && office.get(o) !== c.claim_id) out.push(c.claim_id + ' and ' + office.get(o) + ' both bill an office visit for ' + c.member_id + ' on ' + l.service_date);
      else office.set(o, c.claim_id);
    }
  }
  const visits = seed.claims.filter(c => !fixes.has(c.claim_id)).flatMap(c => c.lines.filter(l => l.service_id === 'svc-office-visit' && !l.possible_accident && !l.emergency).map(l => ({ c, date: l.service_date })));
  for (const x of visits) for (const y of visits) if (x.c.member_id === y.c.member_id && x.c.claim_id < y.c.claim_id && x.date !== y.date && Math.abs(daysBetween(x.date, y.date)) <= OFFICE_GAP) out.push(x.c.claim_id + ' and ' + y.c.claim_id + ' bill office visits for ' + x.c.member_id + ' on ' + x.date + ' and ' + y.date + ', less than ' + (OFFICE_GAP + 1) + ' days apart');
  return [...new Set(out)];
}
const validInstant = at => typeof at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?[+-]\d{2}:\d{2}$/.test(at) && Number.isFinite(ms(at)) && toIso(ms(at)) === at;

function summarize(seed) {
  const items = dated(seed), kinds = {};
  for (const item of items) kinds[item.kind] = (kinds[item.kind] || 0) + 1;
  const dates = [...new Set(items.filter(i => validInstant(i.at)).map(i => dateOf(i.at)))].sort();
  const monthly = {};
  for (const c of seed.claims.filter(x => validInstant(x.received_at))) { const m = dateOf(c.received_at).slice(0, 7); monthly[m] = (monthly[m] || 0) + 1; }
  return { records: items.length, by_kind: kinds, distinct_dates: dates.length, earliest: dates[0] || null, latest: dates[dates.length - 1] || null, claims_by_month: monthly };
}

module.exports = {
  ROOT, APP, P, ZONE, OWNER, FIRST, LAST, START, END, FILES, SEED_IDS, RUN, BINDING, REFERENCE, TOOLS, WRITES, KINDS, PREVIEW,
  read, file, load, sha256, digestOf, bytesOf, validInstant, pad, dateOf, at, addDays, weekdayOf, daysBetween, instant, months, eventValid, inputValid, seedValid,
  validate, as, read1, apply, replay, changes, unchanged, corrections, collisions, injuryProblems, visitLoad, visitProblems, VISIT_KINDS, SERVICE_PROVIDERS, YEARLY, STORY_EPISODES, FOLLOW_UP_DAYS, afterEnd, OFFICE_GAP, CAPS, envelope, eventId, businessOf, pretty, replayText, dated, summarize,
};
