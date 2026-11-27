#!/usr/bin/env node
'use strict';
// Authoring-time script, never run by the App or the host.
//   node dev/dataset.cjs          write datasets/full-window/{seed.json,clock.json,dataset.json}
//   node dev/dataset.cjs --check  exit 1 if the committed files differ from a fresh build
// Builds the full-window evaluation dataset: the Finch Street Café schedule from 30 December
// 2024 to 17 January 2027 and two years of Noor's account (1 January 2025 to 31 December 2026),
// replayed through the App's own business functions, so every shift, handoff, time-off entry,
// notification and activity row follows the App rules. It is separate from fixtures/minimal.json,
// which stays the small smoke-test fixture. Deterministic: a seeded generator, no wall clock.
// Everything is synthetic; the workplace and the people are invented.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { fixture, plugin } = require('../tests/harness.cjs');
const { compile } = require('../tests/schema-validator.cjs');
const { addDays, localToInstant, isoAt, ms, HOUR, nextId } = require('../src/util.cjs');
const { shiftState, handoffPending, handoffState, timeOffState } = require('../src/model.cjs');
const { TZ, ME, BOSS, workplace, people: basePeople, TEMPLATE } = require('./build-fixture.cjs');

const SEED = 20250101, VERSION = '1.0.0';
const ROOT = path.resolve(__dirname, '..'), OUT = path.join(ROOT, 'datasets/full-window');
const FIRST_WEEK = '2024-12-30', LAST_WEEK = '2027-01-11';   // the posted schedule, by week start
const START = '2025-01-01', END = '2026-12-31';               // the coverage window
const at = (date, hhmm) => isoAt(localToInstant(date, hhmm, TZ), TZ);
const BEGIN = at('2024-12-16', '09:00'), CLOCK = at(END, '20:00');
const B = 'pos-barista', C = 'pos-cashier', L = 'pos-lead';
const binding = require('../fixtures/binding.json');

// Two more people than the smoke fixture: Eli worked until the end of August 2025, Mae from
// mid-September 2025. Pegboard has no employment dates, so both stay on the team list.
const people = [...basePeople.slice(0, -1),
  { id: 'person-eli', name: 'Eli Marsh', role: 'employee', position_ids: [B], max_weekly_hours: null },
  { id: 'person-mae', name: 'Mae Collins', role: 'employee', position_ids: [C], max_weekly_hours: 28 },
  basePeople.at(-1)];
const EMPLOYED = { 'person-eli': [null, '2025-08-31'], 'person-mae': ['2025-09-15', null] };
const employed = (id, date) => { const r = EMPLOYED[id]; return !r || ((!r[0] || date >= r[0]) && (!r[1] || date <= r[1])); };
const staff = people.filter(p => p.role === 'employee'), person = idValue => people.find(p => p.id === idValue);

// ---- a small seeded generator ---------------------------------------------------------------
let state = SEED;
function rand() { state = (state + 0x6D2B79F5) | 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const pick = list => list[Math.floor(rand() * list.length)];
const chance = p => rand() < p;
const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const maybe = (key, text) => (text ? { [key]: text } : {});

// ---- Noor's terms: the weekly times she cannot work --------------------------------------------
const SUN = ['sun', '08:00', '12:00'];
const TERMS = [
  ['2024-12-16', 'winter break', [SUN]],
  ['2025-01-06', 'spring term', [['tue', '09:00', '13:00'], ['thu', '09:00', '13:00'], ['wed', '18:00', '21:00'], SUN]],
  ['2025-05-19', 'summer', [SUN]],
  ['2025-08-25', 'fall term', [['mon', '10:00', '14:00'], ['wed', '10:00', '14:00'], ['wed', '18:00', '21:00'], SUN]],
  ['2025-12-15', 'winter break', [SUN]],
  ['2026-01-05', 'spring term', [['tue', '09:00', '13:00'], ['wed', '18:00', '21:00'], SUN]],
  ['2026-05-18', 'summer', [SUN]],
  ['2026-08-24', 'fall term', [['tue', '09:00', '13:00'], ['thu', '13:00', '17:00'], SUN]],
  ['2026-12-14', 'winter break', [SUN]],
];
const blocksFor = date => TERMS.filter(([from]) => from <= date).at(-1)[2];
const DAYNAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const dow = date => new Date(date + 'T12:00:00Z').getUTCDay();

// ---- the posted schedule: the six-slot template of the smoke fixture, by season -------------
// Four slots every day (the two openers, the afternoon barista and the shift lead). The Quay
// kiosk (slot 02) opens Friday to Sunday from May to September; the evening cashier (slot 05)
// works Friday and Saturday all year and every day in July and August. Summer opens at 05:30.
// The café is closed on Thanksgiving Day, Christmas Day and New Year's Day.
const CLOSED = new Set(['2025-01-01', '2025-11-27', '2025-12-25', '2026-01-01', '2026-11-26', '2026-12-25', '2027-01-01']);
function slotsFor(date) {
  if (CLOSED.has(date)) return [];
  const month = +date.slice(5, 7), d = dow(date);
  const kiosk = month >= 5 && month <= 9 && (d === 0 || d >= 5), evening = d >= 5 || month === 7 || month === 8;
  return TEMPLATE.filter(([slot]) => (slot !== '02' || kiosk) && (slot !== '05' || evening))
    .map(([slot, location_id, position_id, start, end]) => [slot, location_id, position_id, month >= 6 && month <= 8 && slot === '01' ? '05:30' : start, end]);
}
const shiftId = (date, slot) => 'sh-' + date.slice(2, 4) + date.slice(5, 7) + date.slice(8, 10) + '-' + slot;
const hoursOf = s => (ms(s.end) - ms(s.start)) / HOUR;
const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;
const blockedForNoor = (date, start, end) => blocksFor(date).some(([day, from, to]) => day === DAYNAMES[dow(date)] && overlaps(ms(start), ms(end), ms(at(date, from)), ms(at(date, to))));

// The manager's draft for one week: the least-loaded qualified person who fits, with two
// rotating days off each and Noor's classes and time off respected.
function draft(week, data) {
  const days = Array.from({ length: 7 }, (_, d) => addDays(week, d));
  const n = Math.round((ms(week) - ms(FIRST_WEEK)) / (7 * 24 * HOUR));
  const off = new Map(staff.map((p, i) => [p.id, new Set([days[(2 * i + n) % 7], days[(2 * i + n + 3) % 7]])]));
  const away = new Set(data.time_off.filter(t => ['approved', 'pending'].includes(t.state)).flatMap(t => { const out = []; for (let x = t.start_date; x <= t.end_date; x = addDays(x, 1)) out.push(x); return out; }));
  const shifts = days.flatMap(date => slotsFor(date).map(([slot, location_id, position_id, start, end]) => ({ shift_id: shiftId(date, slot), location_id, position_id, start: at(date, start), end: at(date, end), assignee: null, date })));
  const load = new Map(staff.map(p => [p.id, 0]));
  const cap = p => (p.id === ME ? 24 : Math.min(p.max_weekly_hours ?? 34, 34));
  const fits = (p, s) => {
    if (!p.position_ids.includes(s.position_id) || !employed(p.id, s.date) || off.get(p.id).has(s.date)) return false;
    if (p.id === ME && (away.has(s.date) || blockedForNoor(s.date, s.start, s.end))) return false;
    const mine = shifts.filter(x => x.assignee === p.id);
    if (mine.some(x => x.date === s.date)) return false;
    if (mine.some(x => (x.date < s.date ? ms(s.start) - ms(x.end) : ms(x.start) - ms(s.end)) < 10 * HOUR)) return false;
    return load.get(p.id) + hoursOf(s) <= cap(p);
  };
  // The scarcest position first: only two people can lead a shift.
  const order = [...shifts.filter(s => s.position_id === L), ...shifts.filter(s => s.position_id !== L)];
  for (const s of order) {
    if (chance(0.025)) continue;                                  // posted open
    const fit = staff.filter(p => fits(p, s)).map(p => ({ p, score: load.get(p.id) - (p.id === ME ? 8 : 0) + rand() * 5 }));
    fit.sort((a, b) => a.score - b.score);
    if (!fit.length) continue;
    s.assignee = fit[0].p.id;
    load.set(s.assignee, load.get(s.assignee) + hoursOf(s));
  }
  return shifts.map(({ date, ...s }) => s);
}

// ---- words people use ---------------------------------------------------------------------------
const COVER = ['Could you take this one for me?', 'I have an exam that morning. Any chance you could cover?', 'Family thing came up. Could you cover?', 'Could you take my shift? I can return the favour.', 'I have a doctor\'s appointment then. Could you take it?', null, null];
const TRADE = ['Would you swap with me?', 'Could we trade these two?', 'Swap so we both get a better week?', null];
const RELEASE = ['I can no longer make this one.', 'My class schedule changed.', 'Something came up that day, sorry.', null];
const PICKUP = [null, 'Happy to take this one.', null];
const INCOMING = ['Could you cover for me?', 'Any chance you could take my shift?', 'I have a family event. Could you help?', 'Could you take this one? I owe you.', null];
const INCOMING_TRADE = ['Could we swap shifts that week?', 'Would you trade with me?', null];
const ANSWER_OK = ['Sure, I can do it.', 'Yes, that works.', null, 'No problem.'];
const ANSWER_NO = ['Sorry, I can\'t that day.', 'I\'m busy then, sorry.', null];
const DENY = ['We are short that week.', 'I need you on that shift.', 'Not this time, sorry.', 'Please find someone who can do the whole shift.'];
const CHANGE_WHY = ['Delivery moved', 'Earlier open for an event', 'Later close for an event', 'Staff meeting', 'Inventory count'];
const CANCEL_WHY = ['Kiosk closed for a private event', 'Quiet day: fewer staff needed', 'Power work on the street', 'Kiosk closed for weather'];
const OFF_DENY = ['Two people are already off that weekend.', 'That is our busiest week.', 'Please ask again for fewer days.'];
const OFF = {
  2025: [['01-24', 'Family visit', 2], ['03-21', 'Spring trip', 3], ['04-18', 'Dentist', 1], ['05-14', 'Final exams', 4], ['06-20', 'Sister\'s graduation', 1],
    ['07-03', 'Fourth of July trip', 3], ['08-22', 'Move-in weekend', 2], ['10-10', 'Friend\'s wedding', 1], ['11-26', 'Thanksgiving travel', 3], ['12-19', 'Holiday travel', 5]],
  2026: [['01-16', 'Conference', 2], ['03-27', 'Spring trip', 3], ['04-24', 'Dentist', 1], ['05-13', 'Final exams', 4], ['06-12', 'Cousin\'s wedding', 2],
    ['07-02', 'Fourth of July trip', 3], ['08-21', 'Move-in weekend', 2], ['10-16', 'Family visit', 2], ['11-25', 'Thanksgiving travel', 4], ['12-18', 'Holiday travel', 5]],
};

// ---- schemas, so that every call and event is one the host would accept ------------------------
const tools = require('../tools.json'), schemaDir = path.join(ROOT, 'schemas');
const inputOf = new Map(tools.map(t => [t.name, compile(t.inputSchema, ROOT)])), readOnly = new Map(tools.map(t => [t.name, t.read_only]));
const eventSchema = compile(require('../schemas/events.schema.json'), schemaDir);
const EXPECTED = ['invalid_event', 'not_qualified', 'overlap', 'short_rest', 'over_hours', 'too_late', 'already_requested', 'invalid_state', 'conflict', 'shift_assigned', 'invalid_window', 'not_yours', 'not_open', 'not_theirs'];

// ---- the replay --------------------------------------------------------------------------------
function build() {
  state = SEED;
  const seed = {
    account_id: 'pegboard-noor', owner_person_id: ME, workplace, people, weeks: [], shifts: [],
    availability: TERMS[0][2].map(([weekday, start, end]) => ({ weekday, start, end })),
    time_off: [], handoffs: [],
    preferences: { timezone: TZ, quiet_hours: { enabled: true, start: '22:00', end: '07:00' }, email_notices: true, open_shift_notices: true },
    notifications: [], activity: [],
  };
  let data = fixture({ seed, now: BEGIN }).data, now = BEGIN, requests = 0, events = 0, steps = 0;
  const stats = { calls: {}, events: {}, refused: {} };
  const count = (bag, key) => { bag[key] = (bag[key] || 0) + 1; };
  const ctx = (t, role = 'agent') => ({ app_id: 'pegboard', run_id: 'dataset', role, virtual_now: t, binding });
  const check = () => { fixture({ seed: data, now }); };
  const refuse = (what, e) => { if (!EXPECTED.includes(e.code)) throw e; count(stats.refused, what + ': ' + e.code); };
  const call = (name, args) => {
    const full = 'pegboard.' + name, input = { ...args, request_id: 'ds-' + String(requests + 1).padStart(5, '0') };
    if (readOnly.get(full) !== false || !inputOf.get(full)({ expected_version: { epoch: 1, revision: 0 }, ...input })) throw new Error('Bad call ' + full + ' ' + JSON.stringify(args));
    try {
      const out = plugin.handleTool(ctx(now), structuredClone(data), full, input);
      data = out.data; requests++; count(stats.calls, name); if (++steps % 250 === 0) check();
      return out.result;
    } catch (e) { refuse(name, e); return null; }
  };
  const read = (name, args) => plugin.handleTool(ctx(now), data, 'pegboard.' + name, args).result;
  const event = (name, payload) => {
    const e = { event_id: 'ev-' + String(events + 1).padStart(5, '0'), at: now, operation: 'pegboard.' + name, payload };
    if (!eventSchema(e)) throw new Error('Bad event ' + JSON.stringify(e).slice(0, 300));
    try {
      data = plugin.applyEvent(ctx(now, 'infra'), structuredClone(data), e);
      events++; count(stats.events, name); if (++steps % 250 === 0) check();
      return true;
    } catch (err) { refuse(name, err); return false; }
  };

  // Timed actions in a queue ordered by time; an action may plan follow-ups.
  const queue = [];
  let order = 0;
  const plan = (t, fn) => {
    if (ms(t) > ms(CLOCK)) return;
    const item = { t, k: ms(t), n: order++, fn };
    let lo = 0, hi = queue.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (queue[mid].k < item.k || (queue[mid].k === item.k && queue[mid].n < item.n)) lo = mid + 1; else hi = mid; }
    queue.splice(lo, 0, item);
  };
  const dayIn = (from, to) => addDays(from, Math.floor(rand() * (Math.round((ms(to) - ms(from)) / (24 * HOUR)) + 1)));
  const daytime = (date, lo = 8, hi = 21) => { const q = between(lo * 4, hi * 4 - 1); return at(date, String(Math.floor(q / 4)).padStart(2, '0') + ':' + String((q % 4) * 15).padStart(2, '0')); };
  const later = (t, loH, hiH) => isoAt(ms(t) + between(loH * 4, hiH * 4) * 15 * 60000, TZ);
  const pending = shiftIdValue => data.handoffs.some(h => handoffPending(h, ms(now)) && (h.shift_id === shiftIdValue || h.other_shift_id === shiftIdValue));
  const clean = e => e.eligible && !e.flags.length && !e.cutoff_passed && e.pending_handoff_id === null;

  // The manager decides a handoff that waits for her, or lets it run out.
  const decide = handoffId => {
    const h = data.handoffs.find(x => x.id === handoffId), when = later(now, 2, 30);
    if (ms(when) >= ms(h.cutoff_at) || chance(0.08)) return;
    const approve = chance(0.8);
    plan(when, () => event('handoff.decided', { handoff_id: handoffId, decision: approve ? 'approve' : 'deny', decided_by: BOSS, ...(approve ? {} : { note: pick(DENY) }) }));
  };
  // A request of Noor's: she may cancel it; a coworker answers; the manager decides.
  const followUp = (handoffId, kind) => {
    const h = data.handoffs.find(x => x.id === handoffId);
    if (chance(0.07)) return plan(later(now, 1, 10), () => call('handoffs.cancel', { id: handoffId }));
    if (kind === 'release' || kind === 'pickup') return decide(handoffId);
    const when = later(now, 1, 20);
    if (ms(when) >= ms(h.cutoff_at) || chance(0.1)) return;                               // no answer: it expires
    const yes = chance(0.72);
    plan(when, () => { if (event('handoff.answered', { handoff_id: handoffId, answer: yes ? 'accept' : 'decline', ...maybe('message', pick(yes ? ANSWER_OK : ANSWER_NO)) }) && yes) decide(handoffId); });
  };

  // 1. The schedule: the first week two weeks before the window opens, then every Monday at
  //    15:00 the week that starts two weeks later.
  for (let week = FIRST_WEEK; week <= LAST_WEEK; week = addDays(week, 7)) {
    const postDay = addDays(week, -14);
    plan(at(postDay, '15:00'), () => event('schedule.published', { week_start: week, shifts: draft(week, data), posted_by: BOSS }));
  }
  //    Every Thursday the manager fills most open shifts of the next six days.
  for (let thursday = '2025-01-02'; thursday <= END; thursday = addDays(thursday, 7)) plan(at(thursday, '10:00'), () => {
    for (const s of data.shifts.filter(x => shiftState(x) === 'open' && ms(x.start) - ms(now) > 20 * HOUR && ms(x.start) - ms(now) < 6 * 24 * HOUR && !pending(x.id))) {
      if (!chance(0.7)) continue;
      const who = staff.filter(p => p.id !== ME && employed(p.id, s.start.slice(0, 10)) && read('eligibility.check', { id: s.id, person_id: p.id }).eligible);
      if (who.length) event('shift.changed', { shift_id: s.id, change: { assignee: pick(who).id }, changed_by: BOSS, reason: 'Filled the open shift' });
    }
  });
  // 2. Term changes three days ahead, and a few preference changes.
  for (const [from, , blocks] of TERMS.slice(1)) plan(at(addDays(from, -3), '20:30'), () => call('availability.update', { blocks: blocks.map(([weekday, start, end]) => ({ weekday, start, end })) }));
  plan(at('2025-03-09', '21:10'), () => call('preferences.update', { patch: { quiet_hours: { start: '23:00' } } }));
  plan(at('2025-09-02', '18:40'), () => call('preferences.update', { patch: { open_shift_notices: false, email_notices: false } }));
  plan(at('2026-02-11', '08:15'), () => call('preferences.update', { patch: { open_shift_notices: true } }));
  plan(at('2026-11-08', '12:20'), () => call('preferences.update', { patch: { email_notices: true } }));
  plan(at('2026-10-04', '22:05'), () => call('preferences.update', { patch: { quiet_hours: { start: '22:00', end: '06:30' } } }));

  for (let month = '2025-01-01'; month <= '2026-12-01'; month = addDays(month, 32).slice(0, 8) + '01') {
    const last = addDays(addDays(month, 32).slice(0, 8) + '01', -1);
    // 3. Noor's own requests: one to four a month.
    for (let i = between(1, 4); i > 0; i--) {
      const kind = pick(['cover', 'cover', 'cover', 'trade', 'release', 'pickup', 'pickup']);
      plan(daytime(dayIn(month, last)), () => {
        if (kind === 'pickup') {
          const open = data.shifts.filter(s => shiftState(s) === 'open' && ms(s.start) - ms(now) > 30 * HOUR && ms(s.start) - ms(now) < 16 * 24 * HOUR && !pending(s.id));
          const s = open.find(x => clean(read('eligibility.check', { id: x.id })));
          if (s) { const r = call('handoffs.pickup', { id: s.id, ...maybe('message', pick(PICKUP)) }); if (r) followUp(r.id, kind); }
          return;
        }
        const mine = data.shifts.filter(s => s.assignee === ME && shiftState(s) === 'assigned' && ms(s.start) - ms(now) > 30 * HOUR && ms(s.start) - ms(now) < 20 * 24 * HOUR && !pending(s.id));
        if (!mine.length) return;
        const s = pick(mine);
        let r = null;
        if (kind === 'cover') {
          const ok = staff.filter(p => p.id !== ME && employed(p.id, s.start.slice(0, 10)) && read('eligibility.check', { id: s.id, person_id: p.id }).eligible);
          if (ok.length) r = call('handoffs.cover', { id: s.id, to_person_id: pick(ok).id, ...maybe('message', pick(COVER)) });
        } else if (kind === 'trade') {
          const theirs = data.shifts.filter(x => x.assignee && x.assignee !== ME && shiftState(x) === 'assigned' && ms(x.start) - ms(now) > 30 * HOUR && Math.abs(ms(x.start) - ms(s.start)) < 9 * 24 * HOUR && !pending(x.id));
          const x = theirs.find(y => { const e = read('eligibility.check', { id: y.id, give_shift_id: s.id }); return clean(e) && e.other?.eligible; });
          if (x) r = call('handoffs.trade', { id: s.id, their_shift_id: x.id, ...maybe('message', pick(TRADE)) });
        } else r = call('handoffs.release', { id: s.id, ...maybe('message', pick(RELEASE)) });
        if (r) followUp(r.id, kind);
      });
    }
    // 4. Coworkers ask Noor: about one or two requests a month. They do not know her hours,
    //    so some asks are ones she cannot take.
    for (let i = (chance(0.9) ? 1 : 0) + (chance(0.4) ? 1 : 0); i > 0; i--) plan(daytime(dayIn(month, last)), () => {
      const asks = data.shifts.filter(x => x.assignee && x.assignee !== ME && shiftState(x) === 'assigned' && ms(x.start) - ms(now) > 36 * HOUR && ms(x.start) - ms(now) < 12 * 24 * HOUR && !pending(x.id) && person(ME).position_ids.includes(x.position_id));
      if (!asks.length) return;
      const x = pick(asks), handoffId = nextId(plugin.objects(data), 'ho-');
      const mine = data.shifts.filter(s => s.assignee === ME && shiftState(s) === 'assigned' && ms(s.start) - ms(now) > 36 * HOUR && Math.abs(ms(s.start) - ms(x.start)) < 7 * 24 * HOUR && !pending(s.id));
      const give = chance(0.3) ? mine.find(s => read('eligibility.check', { id: s.id, person_id: x.assignee, give_shift_id: x.id }).eligible) || null : null;
      if (!event('handoff.received', { handoff_id: handoffId, kind: give ? 'trade' : 'cover', from_person_id: x.assignee, their_shift_id: x.id, ...(give ? { your_shift_id: give.id } : {}), ...maybe('message', pick(give ? INCOMING_TRADE : INCOMING)) })) return;
      const h = data.handoffs.find(y => y.id === handoffId);
      if (chance(0.07)) return plan(later(now, 1, 8), () => event('handoff.withdrawn', { handoff_id: handoffId, message: 'Never mind, I sorted it out.' }));
      const when = later(now, 1, 18);
      if (ms(when) >= ms(h.cutoff_at) || chance(0.1)) return;                             // Noor does not answer: it expires
      plan(when, () => {
        if (handoffState(data.handoffs.find(y => y.id === handoffId), ms(now)) !== 'awaiting_me') return;
        const e = read('eligibility.check', give ? { id: x.id, give_shift_id: give.id } : { id: x.id }), yes = e.eligible && !e.flags.length && chance(0.65);
        const no = e.eligible ? pick(ANSWER_NO) : e.blocks.includes('over_hours') ? 'I\'m at my hours limit that week, sorry.' : pick(ANSWER_NO);
        if (call('handoffs.respond', { id: handoffId, answer: yes ? 'accept' : 'decline', ...maybe('message', yes ? pick(ANSWER_OK) : no) }) && yes) decide(handoffId);
      });
    });
    // 5. The manager changes, cancels or fills a few shifts.
    for (let i = between(2, 5); i > 0; i--) plan(at(dayIn(month, last), pick(['09:00', '10:30', '13:00', '16:00', '17:30'])), () => {
      const soon = data.shifts.filter(s => shiftState(s) !== 'cancelled' && ms(s.start) - ms(now) > 20 * HOUR && ms(s.start) - ms(now) < 14 * 24 * HOUR);
      if (!soon.length) return;
      const open = soon.filter(s => shiftState(s) === 'open' && !pending(s.id));
      if (open.length && chance(0.45)) {
        const s = pick(open), who = staff.filter(p => (p.id !== ME || chance(0.2)) && employed(p.id, s.start.slice(0, 10)) && read('eligibility.check', { id: s.id, person_id: p.id }).eligible && (p.id !== ME || !read('eligibility.check', { id: s.id }).flags.length));
        if (who.length) event('shift.changed', { shift_id: s.id, change: { assignee: pick(who).id }, changed_by: BOSS, reason: 'Filled the open shift' });
        return;
      }
      const mineSoon = soon.filter(s => s.assignee === ME), asked = soon.filter(s => pending(s.id));
      const s = asked.length && chance(0.12) ? pick(asked) : mineSoon.length && chance(0.3) ? pick(mineSoon) : pick(soon);
      if (chance(0.22)) return event('shift.cancelled', { shift_id: s.id, changed_by: BOSS, reason: pick(CANCEL_WHY) });
      const minutes = pick([-30, 30, 60]), field = pick(['start', 'end', 'both']), change = {};
      if (field !== 'end') change.start = isoAt(ms(s.start) + minutes * 60000, TZ);
      if (field !== 'start') change.end = isoAt(ms(s.end) + minutes * 60000, TZ);
      event('shift.changed', { shift_id: s.id, change, changed_by: BOSS, reason: pick(CHANGE_WHY) });
    });
    // 6. An extra open shift, added to a week that is already posted, most months.
    if (chance(0.75)) plan(at(dayIn(month, last), '11:00'), () => {
      const date = addDays(now.slice(0, 10), between(3, 9)), week = addDays(date, -((dow(date) + 6) % 7));
      if (!data.weeks.some(w => w.week_start === week) || plugin.objects(data).includes(shiftId(date, '07'))) return;
      const [location_id, position_id, start, end] = pick([['loc-finch', B, '10:00', '14:00'], ['loc-quay', C, '11:00', '15:00'], ['loc-finch', C, '17:00', '21:00']]);
      event('schedule.published', { week_start: week, shifts: [{ shift_id: shiftId(date, '07'), location_id, position_id, start: at(date, start), end: at(date, end), assignee: null }], posted_by: BOSS });
    });
  }
  // 7. Time off: about ten requests a year, three to six weeks ahead.
  for (const [year, list] of Object.entries(OFF)) for (const [md, reason, len] of list) {
    const first = year + '-' + md, lastDay = addDays(first, len - 1), askOn = addDays(first, -between(21, 42));
    if (askOn < START) continue;
    plan(daytime(askOn, 9, 22), () => {
      const r = call('time_off.request', { start: first, end: lastDay, reason });
      if (!r) return;
      const roll = rand();
      if (roll < 0.08) return plan(later(now, 24, 240), () => call('time_off.cancel', { id: r.id }));   // Noor withdraws it
      if (roll < 0.14) return;                                                                         // nobody decides: it expires
      const approve = roll < 0.86;
      plan(later(now, 6, 72), () => {
        if (event('time_off.decided', { time_off_id: r.id, decision: approve ? 'approve' : 'deny', decided_by: BOSS, ...(approve ? {} : { note: pick(OFF_DENY) }) }) && approve && chance(0.1))
          plan(later(now, 48, 300), () => call('time_off.cancel', { id: r.id }));                     // plans change after approval
      });
    });
  }

  // 8. Still open at the clock: a time-off request, Noor's cover request and a coworker's ask.
  plan(at('2026-12-21', '19:40'), () => call('time_off.request', { start: '2027-01-29', end: '2027-01-31', reason: 'Ski trip' }));
  plan(at('2026-12-30', '14:05'), () => {
    const s = data.shifts.find(x => x.assignee === ME && shiftState(x) === 'assigned' && ms(x.start) - ms(now) > 3 * 24 * HOUR && !pending(x.id));
    const to = s && staff.find(p => p.id !== ME && read('eligibility.check', { id: s.id, person_id: p.id }).eligible);
    if (to) call('handoffs.cover', { id: s.id, to_person_id: to.id, message: 'Could you take this one? My exam was moved.' });
  });
  plan(at('2026-12-31', '09:30'), () => {
    const theirs = data.shifts.filter(y => y.assignee && y.assignee !== ME && shiftState(y) === 'assigned' && ms(y.start) - ms(now) > 4 * 24 * HOUR && !pending(y.id) && person(ME).position_ids.includes(y.position_id));
    const mine = data.shifts.filter(y => y.assignee === ME && shiftState(y) === 'assigned' && ms(y.start) - ms(now) > 4 * 24 * HOUR && !pending(y.id));
    for (const x of theirs) for (const give of mine) {
      if (Math.abs(ms(x.start) - ms(give.start)) > 6 * 24 * HOUR || !clean(read('eligibility.check', { id: x.id, give_shift_id: give.id })) || !read('eligibility.check', { id: give.id, person_id: x.assignee, give_shift_id: x.id }).eligible) continue;
      event('handoff.received', { handoff_id: nextId(plugin.objects(data), 'ho-'), kind: 'trade', from_person_id: x.assignee, their_shift_id: x.id, your_shift_id: give.id, message: 'Happy new year! Could we swap these two?' });
      return;
    }
  });

  while (queue.length) {
    const next = queue.shift();
    if (next.k < ms(now)) throw new Error('Time moved backwards at ' + next.t);
    now = next.t;
    next.fn();
  }
  now = CLOCK;
  check();
  return { data, stats };
}

// ---- outputs -----------------------------------------------------------------------------------
function describe(data) {
  const T = ms(CLOCK), by = (list, key) => list.reduce((o, x) => (o[key(x)] = (o[key(x)] || 0) + 1, o), {});
  const sorted = o => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
  return {
    workplaces: 1, time_zone: TZ, locations: workplace.locations.length, positions: workplace.positions.length, people: people.length,
    posted_weeks: data.weeks.length, first_week: data.weeks[0].week_start, last_week: data.weeks.at(-1).week_start,
    shifts: data.shifts.length, shifts_by_state: sorted(by(data.shifts, shiftState)),
    shifts_starting_after_clock: data.shifts.filter(s => ms(s.start) > T).length,
    account_holder_shifts: data.shifts.filter(s => s.assignee === ME && shiftState(s) === 'assigned').length,
    availability_blocks: data.availability.length,
    time_off_entries: data.time_off.length, time_off_by_state: sorted(by(data.time_off, t => timeOffState(data, t, T))),
    handoffs: data.handoffs.length, handoffs_by_kind: sorted(by(data.handoffs, h => h.kind)), handoffs_by_state: sorted(by(data.handoffs, h => handoffState(h, T))),
    handoffs_from_coworkers: data.handoffs.filter(h => h.requester_id !== ME).length,
    notifications: data.notifications.length, activity_rows: data.activity.length,
    window: [START, END], clock: CLOCK,
  };
}

const compact = value => JSON.stringify(value) + '\n';
function files() {
  const { data, stats } = build(), seed = compact(data), sha = crypto.createHash('sha256').update(seed).digest('hex');
  const dataset = {
    schema_version: 'pale.dataset.v1', dataset_id: 'pegboard-full-window', version: VERSION,
    description: 'Full-window evaluation dataset for Pegboard: the Finch Street Café schedule from 30 December 2024 to 17 January 2027 and two years of one employee account (1 January 2025 to 31 December 2026), with handoffs, coworker requests, manager answers, decisions and changes, time off, availability, preferences, notifications and the activity log. Synthetic; separate from the smoke fixture (fixtures/minimal.json).',
    record_source_ids: ['pegboard-full-window-generator'],
    sources: [{
      source_id: 'pegboard-full-window-generator', kind: 'synthetic',
      description: 'Generated by dev/dataset.cjs: an invented café, its staff and a seeded two-year timeline (weekly postings, Noor\'s covers, trades, releases and pickups, coworker requests, manager answers, decisions, changes and cancellations, time off, availability and preference changes), applied through the App\'s own tools and events. No real person, workplace, schedule or website; nothing collected.',
      uri: null, license: 'MIT', usage: 'permitted', collection: null,
      generation: { method: 'seeded scripted replay through the App business functions (mulberry32 generator)', tool: 'dev/dataset.cjs', tool_version: VERSION, seed: SEED, parameters: describe(data) },
    }],
    transformations: ['None: seed.json is the App state exactly as the replay leaves it, written as compact JSON (sha256 ' + sha + ').'],
    expected_counts: { records: plugin.objects(data).length, assets: 0 },
    quality_policy: { duplicate_records: 'reject', duplicate_assets: 'reject', missing_assets: 'allow_declared' },
    review: { status: 'pending', reviewer: null, notes: 'Automated checks (seed schema and rules every 250 steps and at the end, dev/coverage.cjs, tests/dataset.integration.cjs) do not replace human review of realism: the schedule pattern, the frequency and wording of requests and decisions, and that the workplace and every person are fictional.' },
  };
  return { files: { 'seed.json': seed, 'clock.json': JSON.stringify({ initial_time: CLOCK }, null, 2) + '\n', 'dataset.json': JSON.stringify(dataset, null, 2) + '\n' }, stats };
}

function main() {
  const { files: out, stats } = files();
  if (process.argv.includes('--check')) {
    const bad = Object.entries(out).filter(([name, text]) => !fs.existsSync(path.join(OUT, name)) || fs.readFileSync(path.join(OUT, name), 'utf8') !== text).map(([n]) => n);
    if (bad.length) { console.error('datasets/full-window differs from dev/dataset.cjs: ' + bad.join(', ')); process.exit(1); }
    console.log('datasets/full-window matches dev/dataset.cjs.');
    return;
  }
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, text] of Object.entries(out)) fs.writeFileSync(path.join(OUT, name), text);
  console.log('Wrote datasets/full-window: seed.json ' + Buffer.byteLength(out['seed.json']) + ' bytes.');
  console.log(JSON.stringify(stats));
}

module.exports = { build, CLOCK, START, END, TZ };
if (require.main === module) main();
