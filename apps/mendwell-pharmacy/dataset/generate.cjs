'use strict';
const fs = require('node:fs');
const lib = require('./lib.cjs');
const notes = require('./notes.cjs');
const { inForceAt, collectorVia } = require('../src/authority.cjs');
const { applyDueTimers } = require('../src/timers.cjs');
const { ms, toIso, fromLocal, localDate, addDays, weekdayOf, isOpen, intervalsOn, rxExpiry, MINUTE, HOUR, DAY } = require('../src/time.cjs');
const { P, START, END, FIRST, LAST, REFERENCE, FILES, SEED_IDS } = lib;

const SEED = 20250101;
const VERSION = '1';
const RECORDS = ['prescriptions', 'fills', 'claims', 'authorizations', 'charges', 'grants', 'plan_requests', 'renewals', 'approvals', 'notices'];
const RESTOCKED = [['st-3', 'd-donepezil-5'], ['st-1', 'd-montelukast-4'], ['st-1', 'd-albuterol-90']];
const REGIMENS = [
  ['p4-atorvastatin', 'p-4', 'd-atorvastatin-40', 30, [23, 25]],
  ['p4-warfarin', 'p-4', 'd-warfarin-5', 30, [23, 25]],
  ['p4-donepezil', 'p-4', 'd-donepezil-5', 90, [70, 74]],
  ['p4-amlodipine', 'p-4', 'd-amlodipine-5', 90, [76, 82]],
  ['p2-levothyroxine', 'p-2', 'd-levothyroxine-50', 90, [76, 82]],
  ['p2-lisinopril', 'p-2', 'd-lisinopril-10', 90, [76, 82]],
  ['p2-metformin', 'p-2', 'd-metformin-500', 180, [76, 82]],
  ['p1-sertraline', 'p-1', 'd-sertraline-50', 90, [76, 82]],
  ['p1-omeprazole', 'p-1', 'd-omeprazole-20', 90, [76, 82]],
  ['p3-montelukast', 'p-3', 'd-montelukast-4', 30, [23, 25]],
  ['p3-albuterol', 'p-3', 'd-albuterol-90', 1, [70, 115]],
].map(([key, patient, drug, quantity, gap], index) => ({ key, patient, drug, quantity, gap, index, actor: patient === 'p-4' ? 'p-4' : 'p-2', maintenance: quantity >= 30 }));
const RENEWAL_FILLS = { 1: 4, 30: 11, 90: 3, 180: 3 };
const SUPPLY_DAYS = lib.supplyDays;
const RENEWAL_REPLIES = ['approved', 'approved', 'denied', 'approved', 'withdrawn', 'approved', 'approved'];
const EARLY_REPLIES = ['approved', 'approved', 'denied', 'approved', 'approved'];
const PA_REPLIES = ['approved', 'approved', 'denied', 'approved', 'withdrawn', 'approved', 'approved'];
const DESK = { wrong: 37 };
const DECLINED = { usual: 0.03, after_trip: 0.35, retry: 0.7 }, LATE = 0.15, NEAR_CLOSING = 150, AFTER_TRIP_DAYS = 14, EARLY = 0.1;
const LEAD = { spare: [2, 5], authorization: 10, review: 1, pickup: 2 };
const LOST = { 'p4-warfarin': { after: '2025-09-15', reply: 'denied' }, 'p4-atorvastatin': { after: '2026-07-15', reply: 'approved' } };
const EVERY = { reviewHold: 14, storeChange: 24, earlyVisit: 12, readyHold: 15 };
const PRESCRIBER = { 'p-1': 'dr-3', 'p-2': 'dr-3', 'p-3': 'dr-1', 'p-4': 'dr-2' };
const STAY = ['2025-06-16', '2025-08-31'];
const HARBOR = ['2025-10-01', '2026-02-28'];
const CARD_SWITCH = '2026-06-01T00:00:00-04:00';
const EXPIRED_CARD_FROM = '2026-10-01T00:00:00-04:00';
const ASK = { 'p-4': [540, 690], 'p-2': [1140, 1290] };
const VISIT = {
  'p-4': [null, [600, 870], [600, 870], [600, 870], [600, 870], [600, 870], [600, 720]],
  'p-2': [[660, 990], [1060, 1170], [1060, 1170], [1060, 1170], [1060, 1170], [1060, 1170], [600, 960]],
  'p-1': [[720, 960], [1050, 1140], [1050, 1140], [1050, 1140], [1050, 1140], [1050, 1140], [600, 780]],
};
const PINS = [
  { reg: 'p4-atorvastatin', from: '2026-11-22', store: 'st-2', restock: true, collector: 'p-2' },
];
const EXPIRY = { patient: 'p-3', drugs: ['d-albuterol-90'], written: '2025-01-13', at: '2026-01-12 19:40', hold: '20:05', note: 2, store: 'st-1' };
const STORY = [
  ['2025-01-01 10:00', 'grant', { patient: 'p-1', grantor: 'p-1', grantee: 'p-2', scope: 'refill', expires: null }],
  ['2025-01-01 10:01', 'grant', { patient: 'p-1', grantor: 'p-1', grantee: 'p-2', scope: 'pickup', expires: null }],
  ['2025-01-08 15:00', 'annual', { patient: 'p-4', drugs: [['d-atorvastatin-40', 30, 13], ['d-warfarin-5', 30, 13], ['d-donepezil-5', 90, 6], ['d-amlodipine-5', 90, 5]] }],
  ['2025-01-13 11:00', 'annual', { patient: 'p-3', drugs: [['d-montelukast-4', 30, 13], ['d-albuterol-90', 1, 6]] }],
  ['2025-01-21 16:00', 'annual', { patient: 'p-2', drugs: [['d-levothyroxine-50', 90, 5], ['d-lisinopril-10', 90, 5], ['d-metformin-500', 180, 5]] }],
  ['2025-01-21 16:03', 'annual', { patient: 'p-1', drugs: [['d-sertraline-50', 90, 5], ['d-omeprazole-20', 90, 5]] }],
  ['2025-02-18 09:40', 'course', { quantity: 100, request: '10:00', collect: '18:15', collector: 'p-2' }],
  ['2025-03-12 10:00', 'grant', { patient: 'p-4', grantor: 'p-4', grantee: 'p-1', scope: 'view', expires: '2025-07-01T00:00:00-04:00' }],
  ['2025-05-06 09:05', 'course', { quantity: 100, request: '09:20', collect: '18:20', collector: 'p-2' }],
  ['2025-06-14 11:00', 'grant', { patient: 'p-4', grantor: 'p-4', grantee: 'p-2', scope: 'pickup', expires: '2025-09-02T00:00:00-04:00' }],
  ['2025-09-23 10:10', 'course', { quantity: 100, request: '10:40', collect: '17:50', collector: 'p-2' }],
  ['2025-11-03 09:30', 'course', { quantity: 150, request: '10:00', grant: { at: '12:30', grantor: 'p-1', grantee: 'p-4', collectorAt: '12:35', revoke: '15:00', attempt: '15:40' }, collect: '18:30', collector: 'p-2' }],
  ['2025-12-02 09:20', 'course', { quantity: 150, request: '09:50', collect: '18:40', collector: 'p-2' }],
  ['2026-01-01 10:00', 'grant', { patient: 'p-4', grantor: 'p-4', grantee: 'p-1', scope: 'view', expires: '2026-12-01T00:00:00-05:00' }],
  ['2026-01-07 14:00', 'annual', { patient: 'p-4', drugs: [['d-atorvastatin-40', 30, 12], ['d-warfarin-5', 30, 12], ['d-donepezil-5', 90, 4], ['d-amlodipine-5', 90, 4]] }],
  ['2026-01-14 16:00', 'annual', { patient: 'p-2', drugs: [['d-levothyroxine-50', 90, 3], ['d-lisinopril-10', 90, 5], ['d-metformin-500', 180, 5]] }],
  ['2026-01-14 16:03', 'annual', { patient: 'p-1', drugs: [['d-sertraline-50', 90, 5], ['d-omeprazole-20', 90, 4]] }],
  ['2026-01-27 11:15', 'course', { quantity: 100, request: '11:40', collect: '18:10', collector: 'p-2' }],
  ['2026-03-09 10:30', 'course', { quantity: 100, request: '11:00', grantTool: { at: '11:05', grantee: 'p-4', collectorAt: '13:35' }, collect: '16:10', collector: 'p-4' }],
  ['2026-04-27 20:00', 'grant_tool', { patient: 'p-2', grantee: 'p-1', scope: 'pickup', expires: '2026-09-01T00:00:00-04:00' }],
  ['2026-08-24 20:30', 'extend_tool', { patient: 'p-2', grantee: 'p-1', scope: 'pickup', expires: '2026-12-31T00:00:00-05:00' }],
  ['2026-09-09 09:40', 'course', { quantity: 150, request: '10:15', collect: '18:25', collector: 'p-2' }],
  ['2026-11-30 19:45', 'revoke_tool', { patient: 'p-2', grantee: 'p-1', scope: 'pickup' }],
  ['2026-12-08 09:15', 'course', { quantity: 100, request: '09:45', collect: '18:05', collector: 'p-2' }],
  ['2026-12-31 10:00', 'grant', { patient: 'p-4', grantor: 'p-4', grantee: 'p-1', scope: 'view', expires: '2027-12-01T00:00:00-05:00' }],
];

function random(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const n = k => Math.floor(next() * k);
  return { next, n, chance: p => next() < p, between: (lo, hi) => lo + n(hi - lo + 1), pick: list => list[n(list.length)] };
}
const streamOf = i => random((SEED ^ Math.imul(i + 1, 0x9E3779B1)) >>> 0);

const pad = n => String(n).padStart(2, '0');
const clockOf = minutes => pad(Math.floor(minutes / 60)) + ':' + pad(minutes % 60);
const stamp = text => fromLocal(text.slice(0, 10), text.slice(11, 16));
const within = (date, [from, to]) => date >= from && date <= to;

function baseSeed(reference) {
  const base = structuredClone(reference);
  base.seed_id = SEED_IDS.base;
  for (const key of RECORDS) base[key] = [];
  base.issued = {};
  for (const p of base.people) p.grant_set_version = 0;
  for (const [storeId, drugId] of RESTOCKED) delete base.stores.find(s => s.store_id === storeId).stock[drugId];
  return base;
}

function catalog(seed) {
  const stock = s => Object.keys(s.stock).filter(d => s.stock[d] === true).sort();
  return {
    account_id: seed.account_id, owner_person_id: seed.owner_person_id, time_zone: seed.time_zone,
    people: seed.people.map(({ grant_set_version, ...p }) => p), prescribers: seed.prescribers, drugs: seed.drugs, plans: seed.plans, cash_prices: seed.cash_prices,
    stores: seed.stores.map(s => ({ ...s, stock: stock(s) })), cards: seed.cards,
  };
}

function simulate() {
  const reference = lib.read('fixtures/minimal.json');
  const base = baseSeed(reference);
  const data = structuredClone(base);
  const steps = [], queue = [];
  let seq = 0, now = ms(START);
  const schedule = (t, fn) => {
    if (t < now) throw Error('A step was scheduled at ' + toIso(t) + ', before the current time ' + toIso(now) + '.');
    const item = { t, seq: seq++, fn };
    let lo = 0, hi = queue.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; const q = queue[mid]; if (q.t < t || (q.t === t && q.seq < item.seq)) lo = mid + 1; else hi = mid; }
    queue.splice(lo, 0, item);
  };
  const record = (t, entry) => {
    if (t < now) throw Error('A step at ' + toIso(t) + ' comes before the current time ' + toIso(now) + '.');
    const step = { id: 's-' + (steps.length + 1), at: toIso(t), ...entry };
    const pre = structuredClone(data);
    applyDueTimers(pre, step.at);
    const before = JSON.stringify({ ...pre, issued: null });
    const result = lib.apply(data, step, { check: true });
    if (JSON.stringify({ ...data, issued: null }) === before) throw Error('Step ' + step.id + ' (' + (step.tool || step.operation) + ' at ' + step.at + ') would not change the state.');
    lib.validate(data, step.at);
    steps.push(step);
    return result;
  };
  const call = (t, actor, tool, args) => record(t, { by: actor, tool: P + tool, args });
  const event = (t, operation, payload) => record(t, { by: 'infra', operation, payload });
  const fillOf = id => data.fills.find(f => f.fill_id === id);
  const rxOf = id => data.prescriptions.find(r => r.rx_id === id);
  const storeOf = id => data.stores.find(s => s.store_id === id);
  const seen = (t, id) => lib.read1(data, rxOf(fillOf(id).rx_id).patient_id, toIso(t), 'fills.get', { fill_id: id }).fill;
  const nextRx = () => 'rx-' + (data.prescriptions.length + 1);
  const nextGrant = () => 'g-' + (Math.max(data.issued.g || 0, 0, ...data.grants.map(g => Number(g.grant_id.slice(2)))) + 1);
  const cardFor = (person, t) => (person === 'p-4' ? 'card-1' : person === 'p-2' ? (t < ms(CARD_SWITCH) ? 'card-4' : 'card-3') : null);
  const regOf = (patient, drug) => REGIMENS.find(r => r.patient === patient && r.drug === drug) || null;
  const streams = new Map(REGIMENS.map(r => [r.key, streamOf(r.index)]));
  const R = reg => streams.get(reg.key);
  const run = new Map(REGIMENS.map(r => [r.key, { missed: false, started: false, lost: false, covered: 0, returned: false }]));
  const pins = new Map(PINS.map(p => [p.reg, { ...p, used: false, fill: null }]));
  const owner = new Map(), planned = new Map(), forgotten = new Set(), done = new Set();
  const arrivals = reg => STORY.filter(([, kind, a]) => kind === 'annual' && a.patient === reg.patient && a.drugs.some(d => d[0] === reg.drug)).map(([w]) => stamp(w));
  let expiredCardTried = false, renewals = 0, early = 0, pas = 0, asks = 0;
  const people = new Map(['p-1', 'p-2', 'p-4'].map((p, i) => [p, random((SEED ^ Math.imul(i + 101, 0x85EBCA6B)) >>> 0)]));
  let travelCardRetired = false, forgets = 0;
  const lateVisits = new Set();
  const ticks = {};
  const tick = name => { ticks[name] = (ticks[name] || 0) + 1; return ticks[name] % EVERY[name] === 0; };

  const currentRx = (reg, t) => data.prescriptions.filter(r => r.patient_id === reg.patient && r.drug_id === reg.drug && r.state === 'active' && ms(r.received_at) <= t && t < rxExpiry(r.written_on) && r.fills_remaining >= 1).sort((a, b) => ms(b.received_at) - ms(a.received_at))[0] || null;
  const askAt = (actor, rand, date) => fromLocal(date, clockOf(rand.between(...ASK[actor])));
  const later = (reg, t, low, high, actor = reg.actor) => { const rand = R(reg); let date = addDays(localDate(t), rand.between(low, high)), when = askAt(actor, rand, date); while (when <= t) { date = addDays(date, 1); when = askAt(actor, rand, date); } return when; };
  function office(t, days, rand) {
    let date = addDays(localDate(t), days);
    while (!notes.officeDay(date)) date = addDays(date, 1);
    const when = fromLocal(date, clockOf(rand.between(540, 990)));
    return when > t ? when : office(t, days + 1, rand);
  }
  function visitAt(person, storeId, after, rand, soon = false) {
    const store = storeOf(storeId);
    for (let d = soon ? 0 : rand.pick([0, 1, 1, 1, 2, 2, 3]); d < 40; d++) {
      const date = addDays(localDate(after), d), window = VISIT[person][weekdayOf(date)];
      if (!window || notes.away(person, date)) continue;
      const t = fromLocal(date, clockOf(rand.between(...window)));
      if (t > after + 45 * MINUTE && isOpen(store, t)) return t;
    }
    throw Error('no visit time for ' + person + ' at ' + storeId + ' after ' + toIso(after));
  }
  function closingOf(store, t) {
    for (const date of [addDays(localDate(t), -1), localDate(t)]) for (const [open, close] of intervalsOn(store, date)) if (open <= t && t < close) return close;
    return null;
  }
  const homeStore = (reg, t) => {
    const date = localDate(t);
    if (reg.patient === 'p-4') return within(date, STAY) ? 'st-1' : 'st-3';
    return within(date, HARBOR) ? 'st-2' : 'st-1';
  };
  const pickupGrant = (patient, grantee, fillId, t) => data.grants.some(g => g.patient_id === patient && g.grantee_id === grantee && g.scope === 'pickup' && (g.fill_id === null || g.fill_id === fillId) && inForceAt(g, t));
  const live = v => v.authorization !== null && v.authorization.state === 'live';
  const payable = (v, who, t) => !(v.amount_due_cents > 0) || live(v) || cardFor(who, t) !== null;

  function planNext(reg, need) {
    const pin = pins.get(reg.key);
    if (pin && !pin.used && localDate(need) >= pin.from) {
      pin.used = true;
      return schedule(Math.max(need, later(reg, now, 0, 0)), u => cycle(reg, u, { pin }));
    }
    if (need >= ms(END)) return;
    if (reg.maintenance) {
      const trip = notes.TRIPS.find(x => x.people.includes(reg.patient) && localDate(need) >= addDays(x.from, -3) && localDate(need) <= x.to);
      if (trip) {
        const back = askAt(reg.actor, R(reg), addDays(trip.to, 1));
        if (run.get(reg.key).covered >= back + 3 * DAY) return schedule(back, u => cycle(reg, u, {}));
        const prepare = askAt(reg.actor, R(reg), addDays(trip.from, -R(reg).between(4, 8)));
        if (prepare > later(reg, now, 0, 0)) return schedule(prepare, u => cycle(reg, u, { trip }));
        return schedule(later(reg, now, 0, 0), u => cycle(reg, u, { trip, urgent: true }));
      }
    }
    run.get(reg.key).next = need;
    schedule(need, u => cycle(reg, u, {}));
  }
  function resume(reg, closed) {
    const rand = R(reg), state = run.get(reg.key);
    if (LOST[reg.key] && !state.lost && localDate(closed) >= LOST[reg.key].after) {
      const days = rand.between(6, 12);
      const free = [days, ...[6, 7, 8, 9, 10, 11, 12].filter(d => d !== days)].map(d => addDays(localDate(closed), d)).find(d => !notes.TRIPS.some(x => x.people.includes(reg.patient) && d >= addDays(x.from, -1) && d <= x.to));
      if (free) {
        state.lost = true;
        return schedule(askAt(reg.actor, rand, free), u => cycle(reg, u, { lost: true }));
      }
    }
    if (!reg.maintenance) { const gap = rand.between(...reg.gap); return planNext(reg, later(reg, closed, gap, gap)); }
    const plan = data.plans.find(p => p.plan_id === data.people.find(x => x.person_id === reg.patient).plan_id);
    const eligible = addDays(localDate(closed), plan.rules[reg.drug].refill_days);
    if (reg.quantity >= 90 && rand.next() < EARLY && !notes.TRIPS.some(x => x.people.includes(reg.patient) && eligible >= addDays(x.from, -2) && eligible <= addDays(x.to, 1))) {
      const gap = rand.between(60, 68), need = later(reg, closed, gap, gap);
      return need < ms(END) ? schedule(need, u => cycle(reg, u, { early: true })) : null;
    }
    const lead = rand.between(...LEAD.spare) + (plan.rules[reg.drug].prior_auth_required ? LEAD.authorization : LEAD.review) + LEAD.pickup;
    const depletion = localDate(state.covered - lead * DAY);
    planNext(reg, later(reg, fromLocal(depletion > eligible ? depletion : eligible, '00:00'), 0, 0));
  }

  function cycle(reg, t, how) {
    const rx = currentRx(reg, t);
    if (!rx) {
      if (how.pin) how.pin.used = false;
      return renew(reg, t, { cycle: how });
    }
    const trip = notes.TRIPS.find(x => x.people.includes(reg.patient) && t >= fromLocal(x.from, '00:00') - 2 * DAY && localDate(t) <= x.to);
    if (trip && !how.urgent && !how.pin && !how.lost) {
      const back = askAt(reg.actor, R(reg), addDays(trip.to, 1));
      if (!reg.maintenance || run.get(reg.key).covered >= back + 3 * DAY) return schedule(back, u => cycle(reg, u, {}));
    }
    if (how.lost) run.get(reg.key).covered = Math.min(run.get(reg.key).covered, t);
    const rand = R(reg), pin = how.pin, elena = reg.patient === 'p-4';
    let store = pin && pin.store ? pin.store : homeStore(reg, t);
    if (!pin && elena && store === 'st-3' && ['d-atorvastatin-40', 'd-donepezil-5'].includes(reg.drug) && localDate(t) > '2025-03-01' && rand.n(100) < 10) store = 'st-2';
    const quantity = !pin && elena && reg.quantity === 30 && rand.n(100) < 7 ? 90 : reg.quantity;
    const wrong = !pin && !elena && !how.trip && ++asks % DESK.wrong === 0;
    const fill = call(t, reg.actor, 'fills.request', { rx_id: rx.rx_id, store_id: wrong ? 'st-3' : store, quantity }).fill;
    owner.set(fill.fill_id, { reg, how });
    if (pin) pin.fill = fill.fill_id;
    if (wrong) {
      return schedule(t + rand.between(8, 20) * MINUTE, u => {
        call(u, reg.actor, 'fills.cancel.confirm', { fill_id: fill.fill_id });
        done.add(fill.fill_id);
        schedule(u + 2 * MINUTE, w => cycle(reg, w, how));
      });
    }
    const due = ms(fill.review_due_at);
    const placed = t + rand.between(15, 40) * MINUTE, s = storeOf(store), close = isOpen(s, placed) ? closingOf(s, placed) : null;
    if (!pin && placed < due && close !== null && close - placed >= 2 * HOUR && tick('reviewHold')) {
      const until = Math.min(placed + rand.between(60, 300) * MINUTE, close - 15 * MINUTE);
      const [hold, release] = rand.pick(notes.REVIEW_HOLDS.filter(h => !notes.PRESCRIBER_RELEASES.includes(h[1]) || (notes.officeHours(toIso(until)) && notes.officeHours(toIso(placed)))));
      schedule(placed, u => event(u, 'fill.hold_placed', { fill_id: fill.fill_id, note: hold }));
      schedule(until, u => event(u, 'fill.hold_released', { fill_id: fill.fill_id, note: release }));
    } else if (!pin && !elena && isOpen(s, t + 30 * MINUTE) && tick('storeChange')) {
      const other = store === 'st-1' ? 'st-2' : 'st-1';
      schedule(t + rand.between(10, 25) * MINUTE, u => { if (seen(u, fill.fill_id).state === 'requested') call(u, reg.actor, 'fills.change_store', { fill_id: fill.fill_id, store_id: other }); });
    } else if (!pin && reg.actor === 'p-2' && isOpen(s, t + 40 * MINUTE) && t + 40 * MINUTE < due && !notes.away('p-2', localDate(t)) && tick('earlyVisit')) {
      schedule(t + rand.between(30, 40) * MINUTE, u => { if (seen(u, fill.fill_id).state === 'requested') attempt(u, fill.fill_id, 'p-2', cardFor('p-2', u)); });
    }
    schedule(due + rand.between(5, 40) * MINUTE, u => look(reg, fill.fill_id, u));
  }

  function renew(reg, t, how = {}) {
    const rand = R(reg);
    const arrival = arrivals(reg).find(a => a > t && a - t < 45 * DAY);
    if (arrival) return how.early ? null : planNext(reg, later(reg, arrival, 0, 2));
    const old = data.prescriptions.filter(r => r.patient_id === reg.patient && r.drug_id === reg.drug && r.state === 'active').sort((a, b) => ms(b.received_at) - ms(a.received_at))[0];
    if (data.renewals.some(r => r.rx_id === old.rx_id && r.state === 'pending')) return how.early ? null : schedule(later(reg, t, 1, 1), u => cycle(reg, u, how.cycle || {}));
    const expired = t >= rxExpiry(old.written_on);
    if (how.early && !expired && old.fills_remaining > 0) return null;
    const note = expired ? notes.RENEWAL.expired : notes.RENEWAL.used;
    const rn = call(t, reg.actor, 'renewals.create', { rx_id: old.rx_id, note }).renewal;
    const fresh = u => ({ rx_id: nextRx(), quantity: reg.quantity, fills_authorized: RENEWAL_FILLS[reg.quantity], written_on: localDate(u) });
    const visit = u => ({ ...fresh(u), patient_id: reg.patient, prescriber_id: PRESCRIBER[reg.patient], drug_id: reg.drug });
    const next = u => { if (!how.early) planNext(reg, later(reg, u, 0, 1)); };
    const reply = RENEWAL_REPLIES[renewals++ % RENEWAL_REPLIES.length];
    if (reply === 'approved') {
      schedule(office(t, 1, rand), u => { event(u, 'renewal.replied', { renewal_id: rn.renewal_id, decision: 'approved', rx: fresh(u) }); next(u); });
    } else if (reply === 'denied') {
      schedule(office(t, 1, rand), u => {
        event(u, 'renewal.replied', { renewal_id: rn.renewal_id, decision: 'denied' });
        schedule(office(u, rand.between(4, 9), rand), w => { event(w, 'rx.received', visit(w)); next(w); });
      });
    } else {
      schedule(office(t, rand.between(1, 2), rand), u => {
        event(u, 'rx.received', visit(u));
        schedule(later(reg, u, 0, 0), w => { call(w, reg.actor, 'renewals.withdraw', { renewal_id: rn.renewal_id }); if (!how.early) planNext(reg, w + rand.between(2, 5) * MINUTE); });
      });
    }
    return rn;
  }

  function look(reg, id, t) {
    if (done.has(id)) return;
    const f = seen(t, id);
    if (f.state === 'requested' || f.state === 'pending_plan_decision') return schedule(t + HOUR, u => look(reg, id, u));
    if (f.state === 'ready') return ready(reg, f, t);
    if (f.state === 'waiting_stock') return waiting(reg, f, t);
    if (f.state === 'claim_rejected') return rejected(reg, f, t);
    if (f.state === 'cancelled') { done.add(id); return planNext(reg, later(reg, t, 0, 1)); }
    throw Error('fill ' + id + ' is unexpectedly ' + f.state + ' at ' + toIso(t));
  }

  function chooseCollector(reg, f, t, rand) {
    const how = owner.get(f.fill_id).how;
    if (how.pin && how.pin.collector) return how.pin.collector;
    if (reg.patient === 'p-4') return pickupGrant('p-4', 'p-2', f.fill_id, t) && rand.n(100) < 60 ? 'p-2' : 'p-4';
    if (reg.patient === 'p-2') return pickupGrant('p-2', 'p-1', f.fill_id, t) && rand.n(100) < 45 ? 'p-1' : 'p-2';
    if (reg.patient === 'p-1') return rand.n(100) < 30 ? 'p-1' : 'p-2';
    return rand.n(100) < 15 ? 'p-1' : 'p-2';
  }

  function ready(reg, f, t) {
    const rand = R(reg), state = run.get(reg.key), how = owner.get(f.fill_id).how;
    const quiet = state.missed || how.trip || how.pin || how.lost;
    const who = chooseCollector(reg, f, t, rand);
    planned.set(f.fill_id, who);
    const prepay = f.amount_due_cents > 0 && (who === 'p-1' || (who === 'p-2' && reg.patient !== 'p-4' && rand.n(100) < 10));
    let at = Math.max(t, ms(f.ready_at));
    if (prepay) {
      at = later(reg, at, 0, 0, 'p-2');
      const card = cardFor('p-2', at);
      schedule(at, u => { const v = seen(u, f.fill_id); if (v.state === 'ready' && v.hold === null && !live(v)) call(u, 'p-2', 'fills.prepay.confirm', { fill_id: f.fill_id, card_id: card }); });
    }
    const household = reg.patient !== 'p-4';
    const clear = !notes.TRIPS.some(x => x.people.includes(reg.patient) && x.from <= addDays(localDate(ms(f.ready_at)), 12) && x.to >= localDate(ms(f.ready_at)));
    const forget = how.early && !quiet && clear ? (household ? ++forgets : 1) : 0;
    if (forget && (!household || forget % 2 === 0) && !prepay) {
      state.missed = true;
      forgotten.add(f.fill_id);
      return schedule(ms(f.return_at) + rand.between(30, 180) * MINUTE, u => { if (done.has(f.fill_id)) return; done.add(f.fill_id); planNext(reg, later(reg, u, 1, 3)); });
    }
    if (forget) {
      forgotten.add(f.fill_id);
      if (!prepay && household && f.amount_due_cents > 0) {
        const paid = later(reg, at, 0, 0, 'p-2');
        schedule(paid, u => { const v = seen(u, f.fill_id); if (v.state === 'ready' && v.hold === null && !live(v)) call(u, 'p-2', 'fills.prepay.confirm', { fill_id: f.fill_id, card_id: cardFor('p-2', u) }); });
        at = paid;
      }
      return schedule(later(reg, at + DAY, 0, 1), u => {
        if (done.has(f.fill_id)) return;
        state.missed = true;
        call(u, reg.actor, 'fills.cancel.confirm', { fill_id: f.fill_id });
        done.add(f.fill_id);
        planNext(reg, later(reg, u, 1, 2));
      });
    }
    if (!quiet && !prepay) {
      const st = storeOf(f.store_id), placed = at + rand.between(20, 90) * MINUTE, close = isOpen(st, placed) ? closingOf(st, placed) : null;
      const visit = close === null ? null : placed + rand.between(30, 60) * MINUTE;
      if (close !== null && close - placed >= 3 * HOUR && VISIT[who][weekdayOf(localDate(visit))] && !notes.away(who, localDate(visit)) && tick('readyHold')) {
        const [hold, release] = rand.pick(notes.READY_HOLDS);
        schedule(placed, u => { const v = seen(u, f.fill_id); if (v.state === 'ready' && v.hold === null) event(u, 'fill.hold_placed', { fill_id: f.fill_id, note: hold }); });
        const until = Math.min(placed + rand.between(90, 240) * MINUTE, close - 20 * MINUTE);
        schedule(until, u => { if (fillOf(f.fill_id).hold) event(u, 'fill.hold_released', { fill_id: f.fill_id, note: release }); });
        if (ticks.readyHold % (2 * EVERY.readyHold) === EVERY.readyHold) return schedule(visit, u => collect(reg, f.fill_id, u, who));
        return schedule(visitAt(who, f.store_id, until, rand), u => collect(reg, f.fill_id, u, who));
      }
    }
    const low = (reg.maintenance && state.covered - at < 4 * DAY) || rxExpiry(rxOf(fillOf(f.fill_id).rx_id).written_on) - at < 5 * DAY || notes.TRIPS.some(x => x.people.includes(who) && x.from > localDate(at) && x.from <= addDays(localDate(at), 4));
    schedule(visitAt(who, f.store_id, at, rand, Boolean(how.trip) || low), u => collect(reg, f.fill_id, u, who));
  }

  function attempt(t, id, who, card) {
    event(t, 'fill.collection_attempted', { fill_id: id, collector_id: who, ...(card ? { card_id: card } : {}) });
    return fillOf(id).state === 'collected';
  }

  function collect(reg, id, t, who) {
    if (done.has(id)) return;
    const rand = R(reg), f = seen(t, id), store = storeOf(f.store_id);
    if (f.state === 'returned_to_stock') {
      done.add(id);
      run.get(reg.key).missed = true;
      return planNext(reg, later(reg, t, 0, 1));
    }
    if (f.state !== 'ready') throw Error('fill ' + id + ' is ' + f.state + ' at its collection ' + toIso(t));
    const card = f.amount_due_cents > 0 && !live(f) ? cardFor(who, t) : undefined;
    if (f.hold !== null) {
      attempt(t, id, who, card);
      const wait = u => {
        if (done.has(id)) return;
        if (fillOf(id).hold !== null) return schedule(u + HOUR, wait);
        schedule(visitAt(who, f.store_id, u, rand), w => collect(reg, id, w, who));
      };
      return schedule(t + HOUR, wait);
    }
    if (who === 'p-2' && card && t >= ms(EXPIRED_CARD_FROM) && !expiredCardTried) {
      expiredCardTried = true;
      if (attempt(t, id, who, 'card-4')) throw Error('an expired card paid for ' + id);
      return schedule(t + rand.between(2, 4) * MINUTE, u => collect(reg, id, u, who));
    }
    const close = closingOf(store, t), person = people.get(who);
    const afterTrip = notes.TRIPS.some(x => x.people.includes(who) && localDate(t) > x.to && localDate(t) <= addDays(x.to, AFTER_TRIP_DAYS));
    if (who === 'p-2' && card && !travelCardRetired && person.next() < (afterTrip ? DECLINED.after_trip : DECLINED.usual)) {
      travelCardRetired = true;
      if (attempt(t, id, who, 'card-2')) throw Error('a declined card paid for ' + id);
      if (close - t >= 20 * MINUTE && person.next() < DECLINED.retry) return schedule(t + person.between(2, 6) * MINUTE, u => collect(reg, id, u, who));
      return schedule(visitAt(who, f.store_id, t + 8 * HOUR, rand), u => collect(reg, id, u, who));
    }
    const night = who + ' ' + f.store_id + ' ' + localDate(close);
    if (lateVisits.has(night)) return schedule(visitAt(who, f.store_id, close + 8 * HOUR, rand), u => collect(reg, id, u, who));
    if (person && close - t <= NEAR_CLOSING * MINUTE && !owner.get(id).how.pin && person.next() < LATE) {
      const late = close + person.between(5, 40) * MINUTE;
      lateVisits.add(night);
      return schedule(late, u => {
        if (done.has(id)) return;
        if (attempt(u, id, who, card)) throw Error('a closed store released ' + id);
        schedule(visitAt(who, f.store_id, u + 8 * HOUR, rand), w => collect(reg, id, w, who));
      });
    }
    if (!attempt(t, id, who, card)) {
      const reason = fillOf(id).refusals.at(-1).reason, patient = rxOf(fillOf(id).rx_id).patient_id, fallback = patient === 'p-3' ? 'p-2' : patient;
      if (reason !== 'collector_not_authorized' || fallback === who) throw Error('collection of ' + id + ' by ' + who + ' at ' + toIso(t) + ' was refused: ' + reason);
      planned.set(id, fallback);
      return schedule(visitAt(fallback, f.store_id, t, rand), u => collect(reg, id, u, fallback));
    }
    finish(owner.get(id).reg, id, t);
    sweep(who, f.store_id, t);
  }

  function finish(reg, id, t) {
    done.add(id);
    if (reg.story) return;
    const state = run.get(reg.key), f = fillOf(id);
    state.missed = false;
    if (reg.maintenance) state.covered = Math.max(state.covered, t) + SUPPLY_DAYS(reg.drug, f.quantity) * DAY;
    if (rxOf(f.rx_id).fills_remaining === 0) schedule(later(reg, t, 0, 2), u => renew(reg, u, { early: true }));
    resume(reg, t);
  }

  function sweep(who, storeId, t) {
    let at = t;
    for (const g of data.fills) {
      if (done.has(g.fill_id) || g.store_id !== storeId) continue;
      const v = seen(t, g.fill_id);
      if (v.state !== 'ready' || v.hold !== null || !payable(v, who, t) || !collectorVia(data, g, who, t)) continue;
      at += MINUTE;
      const id = g.fill_id;
      schedule(at, u => {
        if (done.has(id)) return;
        const w = seen(u, id);
        if (w.state !== 'ready' || w.hold !== null || !isOpen(storeOf(storeId), u)) throw Error('fill ' + id + ' changed during ' + who + '\'s visit at ' + toIso(u));
        if (!attempt(u, id, who, w.amount_due_cents > 0 && !live(w) ? cardFor(who, u) : undefined)) throw Error('collection of ' + id + ' with ' + who + '\'s other fills at ' + toIso(u) + ' was refused: ' + fillOf(id).refusals.at(-1).reason);
        finish(owner.get(id).reg, id, u);
      });
    }
  }

  function waiting(reg, f, t) {
    const how = owner.get(f.fill_id).how, store = storeOf(f.store_id), rand = R(reg);
    if (how.pin && how.pin.restock) {
      const day = localDate(t);
      schedule(fromLocal(addDays(day, 1), '12:00'), u => grantEvent(u, { patient: reg.patient, grantor: reg.patient, grantee: how.pin.collector, scope: 'pickup' }, f.fill_id));
      return schedule(fromLocal(addDays(day, 2), '08:00'), u => { event(u, 'store.restocked', { store_id: f.store_id, drug_id: reg.drug }); schedule(u + rand.between(20, 90) * MINUTE, w => look(reg, f.fill_id, w)); });
    }
    if (RESTOCKED.some(([s, d]) => s === f.store_id && d === reg.drug) && store.stock[reg.drug] !== true) {
      return schedule(office(t, rand.between(1, 2), rand), u => { event(u, 'store.restocked', { store_id: f.store_id, drug_id: reg.drug }); schedule(u + rand.between(20, 90) * MINUTE, w => look(reg, f.fill_id, w)); });
    }
    const other = data.stores.find(s => s.store_id === homeStore(reg, t) && s.store_id !== f.store_id && s.stock[reg.drug] === true) || data.stores.find(s => s.store_id !== f.store_id && s.stock[reg.drug] === true);
    schedule(later(reg, t, 0, 0), w => { call(w, reg.actor, 'fills.change_store', { fill_id: f.fill_id, store_id: other.store_id }); schedule(w + 10 * MINUTE, x => look(reg, f.fill_id, x)); });
  }

  function rejected(reg, f, t) {
    const id = f.fill_id, reason = f.claim.reason, rand = R(reg), how = owner.get(id).how;
    if (reason === 'refill_too_soon') {
      const note = how.trip ? rand.pick(notes.TRAVEL) : how.lost ? notes.LOST : null;
      if (note && !data.plan_requests.some(x => x.fill_id === id)) {
        const pr = call(t, reg.actor, 'plan_requests.create', { fill_id: id, note }).plan_request;
        const approve = (how.lost ? LOST[reg.key].reply : EARLY_REPLIES[early++ % EARLY_REPLIES.length]) === 'approved';
        return schedule(office(t, 1, rand), u => {
          event(u, 'plan.decided', { plan_request_id: pr.plan_request_id, decision: approve ? 'approved' : 'denied' });
          schedule(u + rand.between(20, 90) * MINUTE, w => {
            if (approve) return look(reg, id, w);
            const eligible = seen(w, id).claim.eligible_on;
            if (how.lost || (how.trip && eligible >= addDays(how.trip.from, -1))) {
              call(w, reg.actor, 'fills.choose_cash.confirm', { fill_id: id });
              return schedule(w + 10 * MINUTE, x => look(reg, id, x));
            }
            call(w, reg.actor, 'fills.wait', { fill_id: id });
            const due = fillOf(id).resubmission_due_at;
            schedule(due === null ? w + 10 * MINUTE : Math.max(w + 10 * MINUTE, ms(due) + rand.between(7 * 60, 10 * 60) * MINUTE), x => look(reg, id, x));
          });
        });
      }
      call(t, reg.actor, 'fills.wait', { fill_id: id });
      const due = fillOf(id).resubmission_due_at;
      return schedule(due === null ? t + 10 * MINUTE : Math.max(t + 10 * MINUTE, ms(due) + rand.between(7 * 60, 10 * 60) * MINUTE), u => look(reg, id, u));
    }
    if (reason === 'prior_auth_required') {
      const earlier = data.plan_requests.filter(x => x.fill_id === id).at(-1);
      const note = !earlier ? notes.PA.first : earlier.state === 'denied' ? notes.PA.denied : notes.PA.withdrawn;
      return schedule(office(t, 0, rand), sent => {
        if (seen(sent, id).state !== 'claim_rejected') return look(reg, id, sent);
        const pr = call(sent, reg.actor, 'plan_requests.create', { fill_id: id, note }).plan_request;
        const reply = !earlier && !how.pin ? PA_REPLIES[pas++ % PA_REPLIES.length] : 'approved';
        if (reply === 'withdrawn') {
          return schedule(later(reg, sent, 1, 1), u => {
            call(u, reg.actor, 'plan_requests.withdraw', { plan_request_id: pr.plan_request_id });
            schedule(u + rand.between(5, 30) * MINUTE, w => rejected(reg, seen(w, id), w));
          });
        }
        const deny = reply === 'denied';
        schedule(office(sent, rand.between(1, 3), rand), u => {
          const open = data.plan_requests.find(x => x.plan_request_id === pr.plan_request_id).state === 'pending';
          if (!open) return look(reg, id, u);
          event(u, 'plan.decided', { plan_request_id: pr.plan_request_id, decision: deny ? 'denied' : 'approved' });
          if (deny) return schedule(u + rand.between(20, 120) * MINUTE, w => rejected(reg, seen(w, id), w));
          schedule(u + rand.between(20, 120) * MINUTE, w => look(reg, id, w));
        });
      });
    }
    if (reason === 'quantity_limit') {
      return schedule(t + rand.between(10, 50) * MINUTE, w => { call(w, reg.actor, 'fills.change_quantity', { fill_id: id, quantity: reg.quantity }); schedule(w + 10 * MINUTE, x => look(reg, id, x)); });
    }
    if (reason === 'not_covered') {
      call(t, reg.actor, 'fills.choose_cash.confirm', { fill_id: id });
      return schedule(t + 10 * MINUTE, u => look(reg, id, u));
    }
    throw Error('fill ' + id + ' was rejected for ' + reason + ', which the generator does not handle');
  }

  function grantEvent(t, a, fillId = null) {
    const id = nextGrant();
    event(t, 'grant.changed', { grant_id: id, patient_id: a.patient, grantor_id: a.grantor, grantee_id: a.grantee, scope: a.scope, fill_id: fillId, expires_at: a.expires ?? null, status: 'active' });
    return id;
  }
  const liveGrant = a => data.grants.find(g => g.patient_id === a.patient && g.grantee_id === a.grantee && g.scope === a.scope && g.fill_id === null && g.status === 'active');

  function course(t, a) {
    const date = localDate(t), store = within(date, HARBOR) ? 'st-2' : 'st-1', rxId = nextRx();
    const story = { key: 'p3-amoxicillin-' + date, story: true };
    event(t, 'rx.received', { rx_id: rxId, patient_id: 'p-3', prescriber_id: 'dr-1', drug_id: 'd-amoxicillin-250-5', quantity: a.quantity, fills_authorized: 1, written_on: date });
    schedule(fromLocal(date, a.request), u => {
      const fill = call(u, 'p-2', 'fills.request', { rx_id: rxId, store_id: store, quantity: a.quantity }).fill;
      owner.set(fill.fill_id, { reg: story, how: { story: true } });
      planned.set(fill.fill_id, a.collector);
      if (a.grant) {
        let grant = null;
        schedule(fromLocal(date, a.grant.at), w => { grant = grantEvent(w, { patient: 'p-3', grantor: a.grant.grantor, grantee: a.grant.grantee, scope: 'pickup' }, fill.fill_id); });
        schedule(fromLocal(date, a.grant.collectorAt), w => call(w, 'p-2', 'fills.set_collector', { fill_id: fill.fill_id, collector_id: a.grant.grantee }));
        schedule(fromLocal(date, a.grant.revoke), w => event(w, 'grant.changed', { grant_id: grant, status: 'revoked' }));
        schedule(fromLocal(date, a.grant.attempt), w => { if (attempt(w, fill.fill_id, a.grant.grantee, cardFor(a.grant.grantee, w))) throw Error('a revoked grant let ' + a.grant.grantee + ' collect'); });
      }
      if (a.grantTool) {
        schedule(fromLocal(date, a.grantTool.at), w => call(w, 'p-2', 'grants.change.confirm', { action: 'grant', patient_id: 'p-3', grantee_id: a.grantTool.grantee, scope: 'pickup', fill_id: fill.fill_id }));
        schedule(fromLocal(date, a.grantTool.collectorAt), w => call(w, 'p-2', 'fills.set_collector', { fill_id: fill.fill_id, collector_id: a.grantTool.grantee }));
      }
      schedule(fromLocal(date, a.collect), w => {
        if (!attempt(w, fill.fill_id, a.collector, cardFor(a.collector, w))) throw Error('the course fill ' + fill.fill_id + ' was refused: ' + fillOf(fill.fill_id).refusals.at(-1).reason);
        done.add(fill.fill_id);
        sweep(a.collector, store, w);
      });
    });
  }

  function expiryStory(t) {
    const until = stamp(EXPIRY.at) + 2 * DAY;
    const supply = drug => run.get(regOf(EXPIRY.patient, drug).key).covered - t;
    for (const drug of [...EXPIRY.drugs].sort((a, b) => supply(a) - supply(b))) {
      const reg = regOf(EXPIRY.patient, drug), rx = data.prescriptions.find(r => r.patient_id === EXPIRY.patient && r.drug_id === drug && r.written_on === EXPIRY.written);
      if (!rx || rx.state !== 'active' || rx.fills_remaining < 1 || data.fills.some(f => f.rx_id === rx.rx_id && !['collected', 'returned_to_stock', 'cancelled'].includes(f.state)) || (run.get(reg.key).next && run.get(reg.key).next < until)) continue;
      const fill = call(t, reg.actor, 'fills.request', { rx_id: rx.rx_id, store_id: EXPIRY.store, quantity: rx.quantity }).fill;
      owner.set(fill.fill_id, { reg: { key: 'expiry-' + drug, story: true }, how: { story: true } });
      done.add(fill.fill_id);
      const [hold] = notes.REVIEW_HOLDS[EXPIRY.note];
      return schedule(fromLocal(localDate(t), EXPIRY.hold), u => event(u, 'fill.hold_placed', { fill_id: fill.fill_id, note: hold }));
    }
    throw Error('no prescription of ' + EXPIRY.patient + ' written on ' + EXPIRY.written + ' is free for the expiry story at ' + toIso(t));
  }

  function storyStep(t, kind, a) {
    if (kind === 'grant') return grantEvent(t, a);
    if (kind === 'annual') {
      a.drugs.forEach(([drug, quantity, fills], i) => schedule(t + i * MINUTE, u => {
        event(u, 'rx.received', { rx_id: nextRx(), patient_id: a.patient, prescriber_id: PRESCRIBER[a.patient], drug_id: drug, quantity, fills_authorized: fills, written_on: localDate(u) });
        const reg = regOf(a.patient, drug), state = run.get(reg.key);
        if (!state.started) { state.started = true; planNext(reg, later(reg, u, 0, 1)); }
      }));
      return null;
    }
    if (kind === 'course') return course(t, a);
    if (kind === 'grant_tool' || kind === 'extend_tool') return call(t, 'p-2', 'grants.change.confirm', { action: 'grant', patient_id: a.patient, grantee_id: a.grantee, scope: a.scope, expires_at: a.expires });
    if (kind === 'revoke_tool') return call(t, 'p-2', 'grants.change.confirm', { action: 'revoke', grant_id: liveGrant(a).grant_id });
    throw Error('unknown story step ' + kind);
  }

  for (const [when, kind, a] of STORY) schedule(stamp(when), t => storyStep(t, kind, a));
  schedule(stamp(EXPIRY.at), t => expiryStory(t));
  while (queue.length) {
    const item = queue.shift();
    if (item.t >= ms(END)) continue;
    now = item.t;
    item.fn(item.t);
  }
  for (const pin of pins.values()) if (!pin.used) throw Error('pin ' + pin.reg + ' was never reached');
  return { base, data, steps, reference };
}

function check(base, log, end, live, reference) {
  const problems = [];
  const expect = (ok, message) => { if (!ok) problems.push(message); };
  const replayed = lib.replay(base, log.steps).data;
  expect(JSON.stringify(replayed) === JSON.stringify(live), 'replaying the steps over the base reproduces the generated state');
  expect(log.steps.every((s, i) => i === 0 || ms(s.at) >= ms(log.steps[i - 1].at)), 'steps are in time order');
  expect(log.steps.every(s => ms(s.at) >= ms(START) && ms(s.at) < ms(END)), 'every step is inside the window');
  expect(lib.dateOf(log.steps[0].at) === FIRST && lib.dateOf(log.steps[log.steps.length - 1].at) === LAST, 'the steps start on ' + FIRST + ' and end on ' + LAST);
  const counts = Object.fromEntries(lib.months().map(m => [m, end.fills.filter(f => lib.dateOf(f.requested_at).startsWith(m)).length]));
  expect(Object.values(counts).every(n => n >= 2), 'at least two fills requested in every month: ' + JSON.stringify(counts));
  const texts = notes.problems(end, log.steps);
  expect(texts.length === 0, 'every note agrees with the records it describes: ' + texts.join('; '));
  const atReference = lib.replay(base, log.steps, REFERENCE).data;
  expect(JSON.stringify(catalog(atReference)) === JSON.stringify(catalog(reference)), 'at the fixture clock the account and catalog equal the fixture');
  const counter = lib.counter(base, log.steps);
  expect(counter.away.length === 0, 'nobody is at the counter while away: ' + counter.away.join(', '));
  expect(counter.left.length === 0, 'each visit takes the collector\'s other ready, unheld fills at that store that the collector can pay for: ' + counter.left.join(', '));
  expect(Buffer.byteLength(lib.pretty(end)) < 1024 * 1024, 'the end state is under 1 MiB');
  const short = lib.unexplainedGaps(end), twice = lib.repeatedReturns(end);
  expect(short.length === 0, 'no regimen runs out of supply, apart from at most seven days after a documented lost supply: ' + JSON.stringify(short));
  expect(twice.length === 0, 'no regimen has two pickups returned to stock in a row: ' + twice.join('; '));
  const expired = lib.afterExpiry(end), nights = lib.lateWalkIns(end);
  expect(expired.length === 0, 'no fill is collected after its prescription expired: ' + expired.join('; '));
  expect(nights.length === 0, 'nobody walks into the same closed store twice in one evening: ' + nights.join('; '));
  const away = lib.readyWhileAway(end);
  expect(away.length === 0, 'no fill becomes ready while its patient is away: ' + away.join('; '));
  const missing = variety(end, log.steps);
  expect(missing.length === 0, 'the window holds every kind of record and outcome: missing ' + missing.join('; '));
  return problems;
}

function variety(end, steps) {
  const missing = [];
  const need = (ok, what) => { if (!ok) missing.push(what); };
  const has = (list, test) => list.some(test);
  for (const state of ['requested', 'waiting_stock', 'claim_rejected', 'pending_plan_decision', 'ready', 'collected', 'returned_to_stock', 'cancelled']) need(has(end.fills, f => f.timeline.some(e => e.state === state)), 'a fill that was ' + state);
  for (const reason of ['not_covered', 'quantity_limit', 'prior_auth_required', 'refill_too_soon']) need(has(end.claims, c => c.reason === reason), 'a claim rejected as ' + reason);
  for (const reason of ['prior_auth_required', 'refill_too_soon']) for (const state of ['approved', 'denied']) need(has(end.plan_requests, r => r.reason === reason && r.state === state), 'a ' + reason + ' plan request ' + state);
  need(has(end.plan_requests, r => r.state === 'withdrawn'), 'a withdrawn plan request');
  for (const state of ['approved', 'denied', 'withdrawn']) need(has(end.renewals, r => r.state === state), 'a renewal ' + state);
  for (const reason of ['on_hold', 'not_ready', 'store_closed', 'collector_not_authorized', 'payment_failed']) need(has(end.fills, f => f.refusals.some(r => r.reason === reason)), 'a collection refused for ' + reason);
  const attempts = steps.filter(s => s.operation === 'fill.collection_attempted');
  need(attempts.some(s => s.payload.card_id === 'card-2'), 'a declined card at the counter');
  need(attempts.some(s => s.payload.card_id === 'card-4' && s.at >= EXPIRED_CARD_FROM.slice(0, 10)), 'an expired card at the counter');
  for (const state of ['captured', 'voided']) need(has(end.authorizations, a => a.state === state), 'a prepayment ' + state);
  for (const method of ['counter', 'capture']) need(has(end.charges, c => c.method === method), 'a ' + method + ' charge');
  need(has(end.fills, f => f.state === 'collected' && f.amount_due_cents === 0), 'a collection with nothing due');
  for (const [reason, stage] of [['agent', 'requested'], ['agent', 'ready'], ['rx_expired', null]]) need(has(end.fills, f => f.cancellation && f.cancellation.reason === reason && (!stage || f.cancellation.stage === stage)), 'a cancellation (' + reason + (stage ? ', ' + stage : '') + ')');
  need(has(end.fills, f => f.cash && end.claims.find(c => c.claim_id === f.claim_id).reason === 'not_covered') && has(end.fills, f => f.cash && end.claims.find(c => c.claim_id === f.claim_id).reason !== 'not_covered'), 'cash for a drug the plan does not cover and for a denied early refill');
  for (const scope of ['view', 'refill', 'pickup']) need(has(end.grants, g => g.scope === scope && g.fill_id === null), 'a patient-wide ' + scope + ' grant');
  need(has(end.grants, g => g.fill_id !== null), 'a fill-limited pickup grant');
  need(has(end.grants, g => g.status === 'revoked') && has(end.grants, g => g.expires_at !== null && g.expires_at < END && g.status === 'active'), 'a revoked and an expired grant');
  need(steps.some(s => s.tool === P + 'grants.change.confirm' && s.args.action === 'grant') && steps.some(s => s.tool === P + 'grants.change.confirm' && s.args.action === 'revoke'), 'grants given and revoked by the account holder');
  need(has(end.fills, f => f.notes.length && f.timeline.some((e, i) => e.state === 'requested' && f.notes[0].at >= e.at && (!f.timeline[i + 1] || f.notes[0].at <= f.timeline[i + 1].at))), 'a hold during review');
  need(has(end.fills, f => f.notes.some(n => notes.READY_HOLDS.some(h => h[0] === n.text))), 'a hold while ready');
  need(steps.some(s => s.operation === 'store.restocked') && steps.some(s => s.tool === P + 'fills.change_store'), 'stock waits ended by a restock and by a store change');
  return missing;
}

function selectEnd(data) {
  const out = structuredClone(data);
  applyDueTimers(out, toIso(ms(END) - 1));
  out.seed_id = SEED_IDS.full;
  return out;
}

function build() {
  const { base, data, steps, reference } = simulate();
  const log = { schema: 'mendwell-pharmacy.delivery-replay.v1', dataset_id: SEED_IDS.full, generator: { tool: 'dataset/generate.cjs', version: VERSION, seed: SEED }, time_zone: lib.ZONE, starts_at: START, ends_at: END, reference_clock: REFERENCE, base: FILES.base, end_state: FILES.full, steps };
  const end = selectEnd(data);
  lib.validate(end, END);
  const problems = check(base, log, end, data, reference);
  if (problems.length) throw Error(problems.join('\n'));
  return { [FILES.base]: lib.pretty(base), [FILES.replay]: lib.replayText(log), [FILES.full]: lib.pretty(end), stats: { fills: end.fills.length, notices: end.notices.length, steps: steps.length, bytes: Buffer.byteLength(lib.pretty(end)) } };
}

function main() {
  const out = build();
  const files = [FILES.base, FILES.replay, FILES.full];
  if (process.argv.includes('--check')) {
    const differs = files.filter(rel => !fs.existsSync(lib.file(rel)) || fs.readFileSync(lib.file(rel), 'utf8') !== out[rel]);
    console.log(differs.length ? 'delivery dataset differs from the generator output: ' + differs.join(', ') : 'delivery dataset is up to date: ' + JSON.stringify(out.stats));
    process.exitCode = differs.length ? 1 : 0;
    return;
  }
  for (const rel of files) fs.writeFileSync(lib.file(rel), out[rel]);
  console.log(JSON.stringify(out.stats));
}

if (require.main === module) main();
module.exports = { build, selectEnd, catalog, variety, SEED, VERSION, REGIMENS, STAY, HARBOR, PINS, STORY, RESTOCKED, CARD_SWITCH, EXPIRED_CARD_FROM };
