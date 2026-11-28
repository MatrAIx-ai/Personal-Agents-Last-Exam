'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const plugin = require('../plugin.cjs');
const { compile } = require('../tests/schema-validator.cjs');
const { ms, toIso, localDate, addDays, fromLocal, validDate } = require('../src/time.cjs');

const ROOT = path.join(__dirname, '..');
const APP = 'mendwell-pharmacy', P = APP + '.';
const ZONE = 'America/New_York';
const FIRST = '2025-01-01', LAST = '2026-12-31';
const START = '2025-01-01T00:00:00-05:00', END = '2027-01-01T00:00:00-05:00';
const FILES = { base: 'dataset/base.json', replay: 'dataset/replay.json', full: 'dataset/full.json' };
const SEED_IDS = { base: 'mendwell-delivery-base', full: 'mendwell-delivery-2025-2026', asOf: 'mendwell-delivery-asof-' };
const RUN = 'mendwell-delivery';
const read = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const BINDING = read('fixtures/binding.json');
const REFERENCE = read('fixtures/clock.json').initial_time;
const OWNER = BINDING.accounts.find(a => a.app_id === APP).owner_person_id;
const TOOLS = read('tools.json');
const WRITES = new Set(TOOLS.filter(t => !t.read_only).map(t => t.name));
const seedValid = compile(read('schemas/seed.schema.json'), path.join(ROOT, 'schemas'));
const eventValid = compile(read('schemas/events.schema.json'), path.join(ROOT, 'schemas'));
const inputValid = new Map(TOOLS.map(t => [t.name, compile(t.inputSchema, ROOT)]));
const PREVIEW = { 'fills.cancel.confirm': 'fills.cancel.preview', 'fills.choose_cash.confirm': 'fills.choose_cash.preview', 'fills.prepay.confirm': 'fills.prepay.preview', 'grants.change.confirm': 'grants.change.preview' };
const CONFIRMED = new Set(['fills.prepay.confirm', 'grants.change.confirm']);

const pad = n => String(n).padStart(2, '0');
const dateOf = iso => localDate(ms(iso));
const at = (date, hhmm) => toIso(fromLocal(date, hhmm));
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
  const saved = data.people.map(p => p.relation), account = data.account_id, owner = data.owner_person_id;
  for (const p of data.people) if (p.relation === 'self') p.relation = 'other';
  data.people.find(p => p.person_id === person).relation = 'self';
  data.owner_person_id = person;
  data.account_id = 'mendwell-' + person;
  try { return fn({ ...BINDING, accounts: [{ app_id: APP, account_id: data.account_id, owner_person_id: person }] }); } finally {
    data.people.forEach((p, i) => { p.relation = saved[i]; });
    data.account_id = account;
    data.owner_person_id = owner;
  }
}

const eventId = step => RUN + '-' + step.id;
const envelope = step => ({ event_id: eventId(step), at: step.at, operation: step.operation, payload: structuredClone(step.payload) });
const context = (step, binding, role) => ({ app_id: APP, run_id: RUN, role, virtual_now: step.at, binding });

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
        if (CONFIRMED.has(name)) plugin.applyEvent(context(step, binding, 'infra'), data, { event_id: eventId(step) + '-confirmed', at: step.at, operation: 'user.confirmed', payload: { token: args.token, confirmed_by: step.by } });
      }
      if (check && !inputValid.get(step.tool)(args)) throw Error('the arguments do not match the tool schema');
      const result = plugin.handleTool(ctx, data, step.tool, args).result;
      if (CONFIRMED.has(name)) data.approvals = data.approvals.filter(a => a.used_at === null);
      return result;
    });
  } catch (e) { throw Object.assign(Error('Replay step ' + step.id + ' (' + (step.tool || step.operation) + ' at ' + step.at + ' by ' + step.by + ') failed: ' + (e.code ? e.code + ' ' : '') + e.message), { code: e.code || 'error' }); }
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

const SAME_VISIT = 15 * 60000;
function counter(base, steps) {
  const { cardUsable } = require('../src/payment.cjs');
  const { collectorVia } = require('../src/authority.cjs');
  const { away } = require('./notes.cjs');
  const data = structuredClone(base), visits = [];
  for (const step of steps) {
    apply(data, step);
    if (step.by !== 'infra' || step.operation !== 'fill.collection_attempted') continue;
    const t = ms(step.at), who = step.payload.collector_id, f = data.fills.find(x => x.fill_id === step.payload.fill_id);
    const visit = { at: t, id: step.id, fill_id: f.fill_id, who, store: f.store_id, ok: f.state === 'collected' && f.closed_at === step.at, eligible: [] };
    if (visit.ok) {
      const card = data.cards.some(c => c.owner_id === who && cardUsable(c, t));
      for (const g of data.fills) {
        if (g === f || g.store_id !== f.store_id || g.state !== 'ready' || g.hold !== null || !collectorVia(data, g, who, t)) continue;
        const auth = g.authorization_id && data.authorizations.find(a => a.authorization_id === g.authorization_id);
        if (g.amount_due_cents > 0 && !(auth && auth.state === 'live') && !card) continue;
        visit.eligible.push(g.fill_id);
      }
    }
    visits.push(visit);
  }
  const taken = (id, v) => visits.some(x => x.ok && x.fill_id === id && x.who === v.who && x.store === v.store && x.at >= v.at && x.at <= v.at + SAME_VISIT);
  const left = visits.filter(v => v.ok).flatMap(v => v.eligible.filter(id => !taken(id, v)).map(id => id + ' left at ' + v.id + ' (' + v.who + ', ' + v.store + ')'));
  return { visits, away: visits.filter(v => away(v.who, dateOf(toIso(v.at)))).map(v => v.id + ' ' + v.who), left };
}

const AS_NEEDED = new Set(['d-albuterol-90', 'd-amoxicillin-250-5']);
const supplyDays = (drug, quantity) => (drug === 'd-metformin-500' ? quantity / 2 : quantity);
function regimens(seed) {
  const out = new Map();
  for (const f of [...seed.fills].sort((a, b) => ms(a.requested_at) - ms(b.requested_at))) {
    const rx = seed.prescriptions.find(r => r.rx_id === f.rx_id);
    if (AS_NEEDED.has(rx.drug_id)) continue;
    const key = rx.patient_id + ' ' + rx.drug_id;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(f);
  }
  return out;
}
function supplyEvents(seed, key, list) {
  const { LOST } = require('./notes.cjs');
  const losses = seed.plan_requests.filter(r => r.note === LOST && list.some(f => f.fill_id === r.fill_id)).map(r => ({ t: ms(list.find(f => f.fill_id === r.fill_id).requested_at), loss: r.plan_request_id }));
  const pickups = list.filter(x => x.state === 'collected').map(f => ({ t: ms(f.closed_at), fill: f }));
  return [...pickups, ...losses].sort((a, b) => a.t - b.t || (a.loss ? -1 : 1));
}
const LOSS_METHOD = 'A documented lost supply (a plan request noted "Replacement for a lost supply") empties all supply on hand at the moment the household asks for the replacement, the lost-supply fill\'s requested_at; supply restarts with the next pickup. Every other pickup adds its days of supply to whatever is left (supply carries over).';
function walk(seed, key, list, until, visit = () => {}, losses = true) {
  let covered = null, lost = null;
  for (const e of supplyEvents(seed, key, list)) {
    if (e.t > until || (e.t === until && !e.loss)) break;
    if (e.loss) { if (!losses) continue; if (covered !== null && covered > e.t) covered = e.t; lost = e.loss; continue; }
    visit(e, covered, lost);
    covered = Math.max(covered ?? e.t, e.t) + supplyDays(key.split(' ')[1], e.fill.quantity) * 86400000;
    lost = null;
  }
  return covered;
}
function supplyGaps(seed, through = END, { losses = true } = {}) {
  const out = [], day = 86400000, round = x => Math.round(x / day * 100) / 100;
  const started = new Set(seed.prescriptions.filter(r => !AS_NEEDED.has(r.drug_id)).map(r => r.patient_id + ' ' + r.drug_id));
  const all = regimens(seed);
  for (const key of [...started].sort()) {
    const list = all.get(key) || [];
    if (!list.some(f => f.state === 'collected')) { out.push({ key, kind: 'no_pickup', days: null, from: null, to: null, after_loss: null }); continue; }
    if (!list.some(f => f.state === 'collected' && ms(f.closed_at) <= ms(through))) continue;
    const covered = walk(seed, key, list, ms(through), (e, before, lost) => { if (before !== null && e.t > before) out.push({ key, kind: 'between_pickups', from: toIso(before), to: e.fill.closed_at, days: round(e.t - before), fill_id: e.fill.fill_id, after_loss: lost }); }, losses);
    if (covered < ms(through)) out.push({ key, kind: 'before_window_end', from: toIso(covered), to: through, days: round(ms(through) - covered), after_loss: null });
  }
  return out;
}
const elapsed = g => ms(g.to) - ms(g.from);
const unexplainedGaps = (seed, maxDays = 7) => supplyGaps(seed).filter(g => !(g.after_loss && elapsed(g) <= maxDays * 86400000));
const shortages = (seed, through = END) => supplyGaps(seed, through).map(g => g.kind === 'no_pickup' ? g.key + ': no pickup at all' : g.kind === 'before_window_end' ? g.key + ': the supply runs out ' + g.days + ' days before ' + through : g.key + ': ' + g.fill_id + ' collected ' + g.days + ' days after the supply ran out' + (g.after_loss ? ' (after the lost supply ' + g.after_loss + ')' : ''));
function onHand(seed, steps) {
  const out = [], all = regimens(seed);
  for (const step of steps.filter(s => s.tool === P + 'fills.request')) {
    const rx = seed.prescriptions.find(r => r.rx_id === step.args.rx_id);
    if (AS_NEEDED.has(rx.drug_id)) continue;
    const key = rx.patient_id + ' ' + rx.drug_id, t = ms(step.at), covered = walk(seed, key, all.get(key), t);
    out.push({ step: step.id, key, at: step.at, days: covered === null ? null : Math.round((covered - t) / 864e5 * 10) / 10 });
  }
  return out;
}
function readyWhileAway(seed) {
  const { TRIPS } = require('./notes.cjs');
  const out = [];
  for (const f of seed.fills) {
    const rx = seed.prescriptions.find(r => r.rx_id === f.rx_id);
    for (const t of TRIPS) if (t.people.includes(rx.patient_id) && f.ready_at && dateOf(f.ready_at) >= t.from && dateOf(f.ready_at) <= t.to) out.push(f.fill_id + ' became ready on ' + dateOf(f.ready_at) + ' while ' + rx.patient_id + ' was away (' + t.from + ' to ' + t.to + ')');
  }
  return out;
}
function afterExpiry(seed) {
  const { rxExpiry } = require('../src/time.cjs');
  return seed.fills.filter(f => f.state === 'collected' && ms(f.closed_at) > rxExpiry(seed.prescriptions.find(r => r.rx_id === f.rx_id).written_on)).map(f => f.fill_id + ' collected ' + f.closed_at + ' after its prescription expired');
}
function lateWalkIns(seed) {
  const seen = new Map(), out = [];
  for (const f of seed.fills) for (const r of f.refusals.filter(x => x.reason === 'store_closed')) {
    const key = r.collector_id + ' ' + f.store_id + ' ' + dateOf(r.at);
    if (seen.has(key)) out.push(r.collector_id + ' walked into ' + f.store_id + ' after closing twice on ' + dateOf(r.at) + ' (' + seen.get(key) + ', ' + f.fill_id + ')');
    else seen.set(key, f.fill_id);
  }
  return out;
}
function repeatedReturns(seed) {
  const out = [];
  for (const [key, list] of regimens(seed)) {
    const ends = list.filter(f => f.state !== 'cancelled');
    ends.forEach((f, i) => { if (i && f.state === 'returned_to_stock' && ends[i - 1].state === 'returned_to_stock') out.push(key + ': ' + ends[i - 1].fill_id + ' and ' + f.fill_id + ' both returned to stock'); });
  }
  return out;
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
  { kind: 'prescription', list: 'prescriptions', id: 'rx_id', date_field: 'received_at' },
  { kind: 'fill', list: 'fills', id: 'fill_id', date_field: 'requested_at' },
  { kind: 'fill_closing', list: 'fills', id: '<fill id>/closed', date_field: 'closed_at (collected, returned to stock or cancelled)' },
  { kind: 'pharmacist_note', list: 'fills[].notes', id: '<fill id>/note-<n>', date_field: 'at (a hold placed or released)' },
  { kind: 'refusal', list: 'fills[].refusals', id: 'refusal_id', date_field: 'at' },
  { kind: 'claim', list: 'claims', id: 'claim_id', date_field: 'at' },
  { kind: 'plan_request', list: 'plan_requests', id: 'plan_request_id', date_field: 'created_at' },
  { kind: 'renewal', list: 'renewals', id: 'renewal_id', date_field: 'created_at' },
  { kind: 'authorization', list: 'authorizations', id: 'authorization_id', date_field: 'at' },
  { kind: 'charge', list: 'charges', id: 'charge_id', date_field: 'at' },
  { kind: 'grant', list: 'grants', id: 'grant_id', date_field: 'created_at' },
  { kind: 'grant_revocation', list: 'grants', id: '<grant id>/revoked', date_field: 'revoked_at' },
  { kind: 'notice', list: 'notices', id: 'notice_id', date_field: 'at' },
];

function dated(seed) {
  const out = [];
  const add = (kind, id, when, required = true) => { if (required || (when !== null && when !== undefined)) out.push({ kind, id, at: when === undefined ? null : when }); };
  for (const r of seed.prescriptions) add('prescription', r.rx_id, r.received_at);
  for (const f of seed.fills) {
    add('fill', f.fill_id, f.requested_at);
    add('fill_closing', f.fill_id + '/closed', f.closed_at, ['collected', 'returned_to_stock', 'cancelled'].includes(f.state));
    f.notes.forEach((n, i) => add('pharmacist_note', f.fill_id + '/note-' + (i + 1), n.at));
    for (const r of f.refusals) add('refusal', r.refusal_id, r.at);
  }
  for (const c of seed.claims) add('claim', c.claim_id, c.at);
  for (const r of seed.plan_requests) add('plan_request', r.plan_request_id, r.created_at);
  for (const r of seed.renewals) add('renewal', r.renewal_id, r.created_at);
  for (const a of seed.authorizations) add('authorization', a.authorization_id, a.at);
  for (const c of seed.charges) add('charge', c.charge_id, c.at);
  for (const g of seed.grants) { add('grant', g.grant_id, g.created_at); add('grant_revocation', g.grant_id + '/revoked', g.revoked_at, g.status === 'revoked'); }
  for (const n of seed.notices) add('notice', n.notice_id, n.at);
  return out;
}
const validInstant = at => typeof at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?[+-]\d{2}:\d{2}$/.test(at) && Number.isFinite(ms(at)) && toIso(ms(at)) === at;

function summarize(seed) {
  const items = dated(seed), kinds = {};
  for (const item of items) kinds[item.kind] = (kinds[item.kind] || 0) + 1;
  const dates = [...new Set(items.filter(i => validInstant(i.at)).map(i => dateOf(i.at)))].sort();
  const monthly = {};
  for (const f of seed.fills.filter(x => validInstant(x.requested_at))) { const m = dateOf(f.requested_at).slice(0, 7); monthly[m] = (monthly[m] || 0) + 1; }
  return { records: items.length, by_kind: kinds, distinct_dates: dates.length, earliest: dates[0] || null, latest: dates[dates.length - 1] || null, fills_by_month: monthly };
}

module.exports = {
  ROOT, APP, P, ZONE, OWNER, FIRST, LAST, START, END, FILES, SEED_IDS, RUN, BINDING, REFERENCE, TOOLS, WRITES, KINDS, PREVIEW, CONFIRMED,
  read, file, load, sha256, digestOf, bytesOf, validInstant, pad, dateOf, at, addDays, instant, months, eventValid, inputValid,
  validate, as, read1, apply, replay, counter, shortages, supplyGaps, unexplainedGaps, LOSS_METHOD, repeatedReturns, readyWhileAway, afterExpiry, lateWalkIns, supplyDays, onHand, regimens, envelope, eventId, pretty, replayText, dated, summarize,
};
