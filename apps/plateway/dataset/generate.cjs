'use strict';
const fs = require('node:fs');
const { fixture } = require('../tests/harness.cjs');
const { ms, toIso, isOpen, MINUTE } = require('../src/time.cjs');
const lib = require('./lib.cjs');
const feedback = require('./feedback.cjs');
const { ZONE, FIRST, LAST, START, END, REFERENCE, HOLDER, FILES, SEED_IDS, localIso, addDays, weekday, localDate, months } = lib;

const SEED = 20250101;
const VERSION = '1';
const HOME = 'a-1', OFFICE = 'a-2';
const AWAY = [['2025-07-12', '2025-07-20'], ['2026-04-20', '2026-04-23'], ['2026-08-08', '2026-08-16']];
const NO_DELIVERY = ['2025-11-27', '2026-11-26'];
const HOLIDAYS = new Set(['2025-01-01', '2025-01-20', '2025-02-17', '2025-05-26', '2025-06-19', '2025-07-04', '2025-09-01', '2025-10-13', '2025-11-11', '2025-11-27', '2025-11-28', '2025-12-25',
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26', '2026-11-27', '2026-12-25']);
const WEEKLY = [2.4, 2.2, 2, 1.9, 1.8, 1.6, 1.4, 1.5, 1.9, 2, 2.1, 2.4];
const DAY_WEIGHT = [1.6, 1, 1, 1.1, 1.2, 1.8, 1.7];
const FORCED = [{ date: FIRST, kind: 'dinner', minutes: 18 * 60 + 30 }, { date: LAST, kind: 'dinner', minutes: 18 * 60 }];
const QUIET = '2026-12-20T00:00:00-05:00';
const PREFERENCES = {
  lunch: [['r-6', 4], ['r-4', 3], ['r-1', 3]],
  dinner: [['r-4', 3], ['r-1', 3], ['r-2', 2.5], ['r-3', 2.5]],
  scheduled_dinner: [['r-3', 3], ['r-1', 2], ['r-4', 2], ['r-2', 2]],
  brunch: [['r-5', 5], ['r-4', 1]],
  breakfast_next: [['r-5', 1]],
  late: [['r-2', 1]],
};
const FAVORITES = new Set(['mi-1', 'mi-2', 'mi-9', 'mi-11', 'mi-13', 'mi-19', 'mi-20', 'mi-22', 'mi-26', 'mi-28', 'mi-30', 'mi-31', 'mi-33']);
const TIPS = { lunch: [200, 250, 300, 300, 350], dinner: [300, 400, 500, 500, 600, 700], brunch: [200, 300, 300, 400], late: [400, 500, 500, 600] };
const LABELS = { home: ['For Sam', 'For Alex'], office: ['For Priya', 'For Mina'] };
const PRICE_CHANGES = [
  ['2025-04-01', 'mi-19', 1250, 1295], ['2025-04-01', 'mi-20', 1350, 1395], ['2025-04-01', 'mi-22', 750, 795],
  ['2025-09-02', 'mi-1', 1250, 1295], ['2025-09-02', 'mi-2', 1395, 1450], ['2025-09-02', 'mi-6', 425, 450],
  ['2026-01-05', 'mi-31', 1650, 1695], ['2026-01-05', 'mi-35', 1850, 1895],
  ['2026-03-02', 'mi-7', 1295, 1350], ['2026-03-02', 'mi-8', 1550, 1595], ['2026-03-02', 'mi-9', 1050, 1095],
  ['2026-06-01', 'mi-25', 395, 425], ['2026-06-01', 'mi-28', 495, 525], ['2026-06-01', 'mi-30', 450, 475],
  ['2026-09-08', 'mi-13', 1595, 1650], ['2026-09-08', 'mi-14', 1150, 1195],
  ['2026-12-01', 'mi-13', 1650, 1695], ['2026-12-01', 'mi-26', 895, 925],
];
const AVAILABILITY = [
  ['2025-10-18', '17:30', 'mi-15', false], ['2025-10-19', '10:45', 'mi-15', true],
  ['2025-12-12', '12:40', 'mi-35', false], ['2025-12-13', '10:30', 'mi-35', true],
  ['2026-03-14', '10:15', 'mi-28', false], ['2026-03-15', '06:30', 'mi-28', true],
  ['2026-11-12', '16:30', 'mi-12', false], ['2026-11-27', '16:00', 'mi-12', true],
];
const PAUSES = [
  ['2025-03-14', '18:30', '2025-03-15', '10:30', 'r-1', 'Short-staffed tonight'],
  ['2025-08-05', '10:00', '2025-08-12', '11:00', 'r-3', 'Closed for a kitchen renovation'],
  ['2026-02-06', '19:00', '2026-02-06', '22:30', 'r-2', 'Too busy to take more orders tonight'],
  ['2026-06-20', '10:00', '2026-06-21', '11:00', 'r-6', 'Closed for a private event'],
  ['2026-12-24', '15:00', '2026-12-26', '09:30', 'r-4', 'Closed for the holidays'],
];
const REJECTIONS = ['The kitchen closed early', 'Too busy to take more orders', 'An ingredient ran out', 'No courier available nearby', 'The kitchen is backed up'];

function random(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = n => Math.floor(next() * n);
  const weighted = pairs => {
    const total = pairs.reduce((s, [, w]) => s + w, 0);
    let x = next() * total;
    for (const [value, w] of pairs) { x -= w; if (x < 0) return value; }
    return pairs[pairs.length - 1][0];
  };
  return { next, int, weighted, chance: p => next() < p, between: (lo, hi) => lo + int(hi - lo + 1), pick: list => list[int(list.length)] };
}
const streamOf = i => random((SEED ^ Math.imul(i + 1, 0x9E3779B1)) >>> 0);

const away = date => AWAY.some(([from, to]) => date >= from && date <= to) || NO_DELIVERY.includes(date);
const dayOff = date => [0, 6].includes(weekday(date)) || HOLIDAYS.has(date);
function kinds(date) {
  const wd = weekday(date);
  const list = dayOff(date) ? [['brunch', 0.7], ['dinner', 1.3], ['scheduled_dinner', 0.15]] : [['lunch', 1], ['dinner', wd === 5 ? 1.5 : 0.9], ['scheduled_dinner', 0.18], ['breakfast_next', 0.06]];
  if ([4, 5, 6].includes(wd)) list.push(['late', wd === 6 ? 0.2 : 0.12]);
  return list.filter(([k]) => date !== LAST || !['late', 'breakfast_next'].includes(k)).filter(([k]) => k !== 'breakfast_next' || !away(addDays(date, 1)));
}
const slot = (date, kind) => kind === 'breakfast_next' ? 'morning ' + addDays(date, 1) : kind === 'brunch' ? 'morning ' + date : (kind === 'scheduled_dinner' ? 'dinner' : kind) + ' ' + date;

function timing(occ, r) {
  const off = dayOff(occ.date);
  const minutes = occ.minutes ?? {
    lunch: () => 11 * 60 + 35 + 5 * r.int(18),
    dinner: () => off ? 17 * 60 + 20 + 5 * r.int(34) : 17 * 60 + 50 + 5 * r.int(29),
    brunch: () => 8 * 60 + 20 + 5 * r.int(29),
    late: () => 22 * 60 + 20 + 5 * r.int(23),
    scheduled_dinner: () => 13 * 60 + 30 + 5 * r.int(40),
    breakfast_next: () => 20 * 60 + 40 + 5 * r.int(12),
  }[occ.kind]();
  const delivery = occ.kind === 'scheduled_dinner' ? localIso(occ.date, 18 * 60 + 30 + 15 * r.int(6)) : occ.kind === 'breakfast_next' ? localIso(addDays(occ.date, 1), 8 * 60 + 15 * r.int(5)) : null;
  return { date: occ.date, kind: occ.kind, at: localIso(occ.date, minutes), delivery_at: delivery };
}

function plan() {
  const r = random(SEED);
  const all = [];
  for (let monday = addDays(FIRST, -((weekday(FIRST) + 6) % 7)); monday <= LAST; monday = addDays(monday, 7)) {
    const days = [0, 1, 2, 3, 4, 5, 6].map(i => addDays(monday, i)).filter(d => d >= FIRST && d <= LAST && !away(d));
    if (!days.length) continue;
    const mid = days[days.length >> 1];
    const rate = (WEEKLY[Number(mid.slice(5, 7)) - 1] + (mid >= '2026' ? 0.2 : 0)) * days.length / 7;
    let n = Math.floor(rate) + (r.next() < rate - Math.floor(rate) ? 1 : 0);
    if (r.chance(0.15)) n += r.chance(0.5) ? 1 : -1;
    if (days.length >= 5) n = Math.max(n, 1);
    const chosen = FORCED.filter(o => days.includes(o.date)).map(o => ({ ...o }));
    n = Math.max(n, chosen.length);
    for (let guard = 0; chosen.length < n && guard < 200; guard++) {
      const near = d => chosen.some(o => Math.abs(ms(localIso(o.date, 0)) - ms(localIso(d, 0))) <= 36 * 3600000);
      const date = r.weighted(days.map(d => [d, DAY_WEIGHT[weekday(d)] * (near(d) ? 0.3 : 1)]));
      const kind = r.weighted(kinds(date));
      const taken = [...all, ...chosen];
      if (taken.some(o => slot(o.date, o.kind) === slot(date, kind)) || taken.filter(o => o.date === date).length >= 2) continue;
      chosen.push({ date, kind });
    }
    all.push(...chosen);
  }
  return all.map(o => timing(o, r)).sort((a, b) => ms(a.at) - ms(b.at));
}

function catalogEvents() {
  const events = [];
  for (const [date, item_id, , price_cents] of PRICE_CHANGES) events.push({ at: localIso(date, 6 * 60), operation: 'menu_item.price_changed', payload: { item_id, price_cents } });
  const clock = hhmm => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
  for (const [date, hhmm, item_id, available] of AVAILABILITY) events.push({ at: localIso(date, clock(hhmm)), operation: 'menu_item.availability_changed', payload: { item_id, available } });
  for (const [fromDate, from, toDate, to, restaurant_id, reason] of PAUSES) {
    events.push({ at: localIso(fromDate, clock(from)), operation: 'restaurant.status_changed', payload: { restaurant_id, status: 'paused', reason } });
    events.push({ at: localIso(toDate, clock(to)), operation: 'restaurant.status_changed', payload: { restaurant_id, status: 'open' } });
  }
  return events.sort((a, b) => ms(a.at) - ms(b.at));
}

function catalog(seed) {
  return { holder: seed.holder, zones: seed.zones, addresses: seed.addresses, cards: seed.cards, restaurants: seed.restaurants, dishes: seed.dishes, time_zone: seed.time_zone, account_id: seed.account_id, owner_person_id: seed.owner_person_id };
}

function baseSeed(reference) {
  const base = { ...structuredClone(reference), seed_id: SEED_IDS.base, cart: { restaurant_id: null, lines: [] }, orders: [], notices: [] };
  delete base.issued;
  const seen = new Set();
  for (const [, item, before] of PRICE_CHANGES) if (!seen.has(item)) { seen.add(item); base.dishes.find(d => d.id === item).price_cents = before; }
  const flipped = new Set();
  for (const [, , item, available] of AVAILABILITY) if (!flipped.has(item)) { flipped.add(item); base.dishes.find(d => d.id === item).available = !available; }
  for (const r of base.restaurants) Object.assign(r, { paused: false, pause_reason: null });
  return base;
}

function simulate() {
  const reference = lib.read('fixtures/minimal.json');
  const base = baseSeed(reference);
  const f = fixture({ seed: base, now: START });
  const steps = [];
  const queue = [];
  let seq = 0, now = ms(START);
  const schedule = (t, run) => {
    if (t < now) throw Error('A step was scheduled before the current time at ' + toIso(now, ZONE) + '.');
    const item = { t, seq: seq++, run };
    let lo = 0, hi = queue.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; const q = queue[mid]; if (q.t < t || (q.t === t && q.seq < item.seq)) lo = mid + 1; else hi = mid; }
    queue.splice(lo, 0, item);
  };
  const record = (at, entry) => steps.push({ id: 's-' + (steps.length + 1), at, ...entry });
  const stored = () => f.data();
  const orderOf = id => stored().orders.find(o => o.id === id);
  function holder(at, tool, args, { optional = false } = {}) {
    f.setNow(at);
    let full = args;
    const preview = { 'plateway.orders.place': 'plateway.checkout.preview', 'plateway.orders.cancel.confirm': 'plateway.orders.cancel.preview' }[tool];
    if (preview) {
      const p = f.call(preview, args);
      if (p.status !== 'ok') { if (optional) return p; throw Error(preview + ' at ' + at + ': ' + p.status + ' ' + (p.message || '')); }
      full = { ...args, token: p.token };
    }
    const out = f.call(tool, full);
    if (out.status !== 'committed') { if (optional) return out; throw Error(tool + ' at ' + at + ': ' + out.status + ' ' + (out.message || '')); }
    record(at, { by: HOLDER, tool, args });
    return out;
  }
  function infra(at, operation, payload) {
    const out = f.event({ event_id: lib.RUN + '-s-' + (steps.length + 1), at, operation, payload });
    if (out.status !== 'committed') throw Error(operation + ' at ' + at + ': ' + out.status + ' ' + (out.message || ''));
    record(at, { by: 'infra', operation, payload });
  }
  const projected = (at, id) => { f.setNow(at); return f.call('plateway.orders.get', { order_id: id }).order.status; };
  const cancel = (at, id) => holder(at, 'plateway.orders.cancel.confirm', { order_id: id });

  function chooseLines(data, rid, kind, r, address) {
    const menu = data.dishes.filter(d => d.restaurant_id === rid && d.available);
    const draw = (list, n) => {
      const pool = [...list], out = [];
      while (out.length < n && pool.length) { const d = r.weighted(pool.map(x => [x, FAVORITES.has(x.id) ? 3 : 1])); out.push(d); pool.splice(pool.indexOf(d), 1); }
      return out;
    };
    const mains = menu.filter(d => d.price_cents >= 1000), sides = menu.filter(d => d.price_cents < 1000);
    let picks;
    if (rid === 'r-5') picks = draw(menu, r.between(2, 3));
    else if (kind === 'lunch') picks = [...draw(mains, r.chance(0.15) ? 2 : 1), ...(r.chance(0.35) ? draw(sides, 1) : [])];
    else if (kind === 'late') picks = [...draw(mains, 1), ...draw(sides, r.int(2))];
    else picks = [...draw(mains, r.between(2, 3)), ...draw(sides, r.int(3))];
    if (!picks.length) picks = draw(menu, 1);
    const labels = address === OFFICE ? LABELS.office : LABELS.home;
    return picks.map((d, i) => {
      const option_ids = d.option_groups.flatMap(g => {
        if (!g.required && !(g.max >= 1 && r.chance(0.25))) return [];
        const pool = [...g.options], chosen = [];
        while (chosen.length < Math.max(g.min, 1) && pool.length) { const o = r.weighted(pool.map((x, k) => [x, k === 0 ? 3 : 1])); chosen.push(o.id); pool.splice(pool.indexOf(o), 1); }
        return chosen;
      });
      const side = d.price_cents < 1000;
      const quantity = r.chance(side ? 0.25 : 0.08) ? 2 : 1;
      const label = address === OFFICE ? (i === 1 && !side ? r.pick(labels) : null) : (i > 0 && r.chance(0.25) ? r.pick(labels) : null);
      return { item_id: d.id, option_ids, quantity, ...(label ? { label } : {}) };
    });
  }

  function afterDelivery(id, delivered, r) {
    let last = delivered, reported = false;
    if (r.chance(0.06)) {
      last = delivered + r.between(10, 90) * MINUTE;
      reported = true;
      schedule(last, at => {
        const line = r.pick(orderOf(id).lines.filter(l => !l.removed && !l.report));
        holder(at, 'plateway.orders.report_issue', { order_id: id, lines: [{ line_id: line.id, kind: r.chance(0.6) ? 'missing' : 'wrong' }] });
      });
    }
    if (!r.chance(reported ? 0.6 : 0.4)) return;
    const day = localDate(toIso(last, ZONE)), roll = r.next();
    let t = roll < 0.55 ? last + r.between(20, 120) * MINUTE : roll < 0.9 ? ms(localIso(addDays(day, 1), 15 * r.between(34, 86))) : ms(localIso(addDays(day, r.between(2, 6)), 15 * r.between(48, 84)));
    if (t <= last + 10 * MINUTE) t = last + r.between(20, 60) * MINUTE;
    if (t >= ms(END)) t = last + r.between(20, 60) * MINUTE;
    if (t >= ms(END)) return;
    const u = r.next();
    schedule(t, at => {
      const choices = feedback.eligible(stored(), orderOf(id), at);
      const [stars, text] = choices[Math.floor(u * choices.length)];
      holder(at, 'plateway.orders.rate', { order_id: id, stars, ...(text ? { text } : {}) });
    });
  }

  function courier(order, rest, r, acceptAt, travel) {
    const id = order.id, p = ms(order.placed_at);
    let estimate = ms(order.estimated_delivery_at), kitchen = 0;
    if (order.lines.length >= 2 && r.chance(0.04)) {
      const line = r.pick(order.lines).id;
      schedule(acceptAt + r.between(1, 4) * MINUTE, at => infra(at, 'order.item_unavailable', { order_id: id, line_id: line }));
    }
    const delay = r.chance(0.12) ? (r.chance(0.7) ? 'kitchen' : 'courier') : null;
    if (delay === 'kitchen') {
      kitchen = r.between(10, 25);
      estimate += kitchen * MINUTE;
      const e = estimate;
      schedule(acceptAt + r.between(4, 10) * MINUTE, at => infra(at, 'order.delayed', { order_id: id, estimated_delivery: toIso(e, ZONE) }));
    }
    const pickupAt = Math.max(acceptAt + 5 * MINUTE, p + (rest.prep_minutes + kitchen + r.between(3, 9)) * MINUTE);
    let deliveredAt = Math.max(estimate + r.between(-4, 6) * MINUTE, pickupAt + Math.max(8, travel - 4) * MINUTE);
    schedule(pickupAt, at => { if (orderOf(id).status === 'preparing') infra(at, 'order.picked_up', { order_id: id }); });
    if (delay === 'courier') {
      const delayAt = pickupAt + r.between(2, 5) * MINUTE, e = estimate + r.between(8, 20) * MINUTE;
      deliveredAt = Math.max(e + r.between(-3, 5) * MINUTE, delayAt + 5 * MINUTE);
      schedule(delayAt, at => { if (orderOf(id).status === 'picked_up') infra(at, 'order.delayed', { order_id: id, estimated_delivery: toIso(e, ZONE) }); });
    }
    schedule(deliveredAt, at => {
      if (orderOf(id).status !== 'picked_up') return;
      infra(at, 'order.delivered', { order_id: id });
      afterDelivery(id, deliveredAt, r);
    });
  }

  function lifecycle(order, address, r) {
    const id = order.id, p = ms(order.placed_at);
    const rest = stored().restaurants.find(x => x.id === order.restaurant_id);
    const zone = stored().addresses.find(a => a.id === address).zone_id;
    const travel = rest.zones.find(z => z.zone_id === zone).travel_minutes;
    if (order.mode === 'scheduled') {
      const release = ms(order.release_at), delivery = ms(order.delivery_at);
      if (r.chance(0.06)) {
        const c = p + r.between(10, 60) * MINUTE;
        if (c < release - 15 * MINUTE) return schedule(c, at => cancel(at, id));
      }
      const acceptAt = release + r.between(2, 6) * MINUTE;
      const pickupAt = release + (rest.prep_minutes + r.between(1, 5)) * MINUTE;
      const deliveredAt = Math.max(delivery + r.between(-3, 6) * MINUTE, pickupAt + Math.max(8, travel - 4) * MINUTE);
      schedule(acceptAt, at => { if (projected(at, id) === 'submitted') infra(at, 'order.accepted', { order_id: id }); });
      schedule(pickupAt, at => { if (orderOf(id).status === 'preparing') infra(at, 'order.picked_up', { order_id: id }); });
      schedule(deliveredAt, at => { if (orderOf(id).status !== 'picked_up') return; infra(at, 'order.delivered', { order_id: id }); afterDelivery(id, deliveredAt, r); });
      return;
    }
    const roll = r.next();
    if (roll < 0.025) return schedule(p + r.between(3, 8) * MINUTE, at => infra(at, 'order.rejected', { order_id: id, reason: r.pick(REJECTIONS) }));
    if (roll < 0.035 && p < ms(QUIET)) return;
    if (roll < 0.055) return schedule(p + r.between(1, 3) * MINUTE, at => cancel(at, id));
    const acceptAt = p + r.between(2, 9) * MINUTE;
    schedule(acceptAt, at => {
      if (orderOf(id).status !== 'submitted') return;
      infra(at, 'order.accepted', { order_id: id });
      if (roll < 0.075) return schedule(acceptAt + r.between(3, 8) * MINUTE, x => cancel(x, id));
      courier(orderOf(id), rest, r, acceptAt, travel);
    });
  }

  function session(occ, r, at) {
    const data = stored(), t = ms(at);
    const address = occ.kind === 'lunch' ? OFFICE : HOME;
    const zone = data.addresses.find(a => a.id === address).zone_id;
    const scheduled = occ.delivery_at !== null;
    const options = PREFERENCES[occ.kind].filter(([rid]) => {
      const rest = data.restaurants.find(x => x.id === rid);
      const entry = rest.zones.find(z => z.zone_id === zone);
      if (rest.paused || !entry) return false;
      if (!scheduled) return isOpen(rest, t, ZONE) && isOpen(rest, t + 45 * MINUTE, ZONE);
      const release = ms(occ.delivery_at) - (rest.prep_minutes + entry.travel_minutes) * MINUTE;
      return isOpen(rest, release, ZONE) && isOpen(rest, release + rest.prep_minutes * MINUTE, ZONE);
    });
    if (!options.length) return;
    const rid = r.weighted(options);
    const lines = chooseLines(data, rid, occ.kind, r, address);
    const stale = data.cart.lines.map(l => l.id), added = [];
    let minute = 0;
    const later = run => schedule(t + minute * MINUTE, run);
    for (const line_id of stale) later(x => holder(x, 'plateway.cart.remove_item', { line_id }));
    if (stale.length) minute++;
    for (const line of lines) { later(x => { const out = holder(x, 'plateway.cart.add_item', line, { optional: true }); if (out.status === 'committed') added.push(out.line_id); }); minute++; }
    if (r.chance(0.12)) { const k = r.int(lines.length); later(x => { if (added[k]) holder(x, 'plateway.cart.update_item', { line_id: added[k], quantity: Math.min(3, lines[k].quantity + 1) }); }); minute++; }
    if (lines.length >= 2 && r.chance(0.05)) { later(x => { if (added.length >= 2) holder(x, 'plateway.cart.remove_item', { line_id: added.pop() }); }); minute++; }
    if (t < ms(QUIET) && r.chance(0.04)) return;
    minute += r.int(2);
    const kind = { scheduled_dinner: 'dinner', breakfast_next: 'brunch' }[occ.kind] || occ.kind;
    const tip = r.chance(0.03) ? 0 : r.pick(TIPS[kind]);
    const workCard = r.chance(occ.kind === 'lunch' ? 0.8 : 0.15);
    later(x => {
      if (!added.length) return;
      const [y, m] = localDate(x).split('-').map(Number);
      const c3 = stored().cards.find(c => c.id === 'c-3');
      const card_id = workCard && (c3.exp_year > y || (c3.exp_year === y && c3.exp_month >= m)) ? 'c-3' : 'c-1';
      const when = scheduled ? { mode: 'scheduled', delivery_at: occ.delivery_at } : { mode: 'asap' };
      const out = holder(x, 'plateway.orders.place', { address_id: address, card_id, when, tip_cents: tip }, { optional: true });
      if (out.status === 'committed') lifecycle(out.order, address, r);
    });
  }

  for (const e of catalogEvents()) schedule(ms(e.at), at => infra(at, e.operation, e.payload));
  plan().forEach((occ, i) => { const r = streamOf(i); schedule(ms(occ.at), at => session(occ, r, at)); });
  while (queue.length) {
    const item = queue.shift();
    now = item.t;
    item.run(toIso(item.t, ZONE));
  }
  const end = stored();
  end.seed_id = SEED_IDS.full;
  return { base, end, steps, reference };
}

function check(base, log, end, reference) {
  const problems = [];
  const expect = (ok, message) => { if (!ok) problems.push(message); };
  const replayed = lib.replay(base, log.steps).data;
  replayed.seed_id = SEED_IDS.full;
  expect(JSON.stringify(replayed) === JSON.stringify(end), 'replaying the steps over the base reproduces the end state');
  expect(log.steps.every((s, i) => i === 0 || ms(s.at) >= ms(log.steps[i - 1].at)), 'steps are in time order');
  expect(log.steps.every(s => ms(s.at) >= ms(START) && ms(s.at) < ms(END)), 'every step is inside the window');
  expect(localDate(log.steps[0].at) === FIRST && localDate(log.steps[log.steps.length - 1].at) === LAST, 'the steps start on ' + FIRST + ' and end on ' + LAST);
  expect(end.orders.every(o => ['delivered', 'cancelled'].includes(o.status)), 'every order is delivered or cancelled at the end');
  expect(end.cart.lines.length === 0 && end.restaurants.every(r => !r.paused), 'the cart is empty and no restaurant is paused at the end');
  const counts = Object.fromEntries(months().map(m => [m, end.orders.filter(o => localDate(o.placed_at).startsWith(m)).length]));
  expect(Object.values(counts).every(n => n >= 3), 'at least three orders in every month: ' + JSON.stringify(counts));
  const contradicted = end.orders.filter(o => !feedback.holds(end, o)).map(o => o.id);
  expect(contradicted.length === 0, 'every rating agrees with the order it rates: ' + contradicted.join(', '));
  const repeated = feedback.repeated(end);
  expect(repeated.length === 0, 'no rating text is repeated more than ' + feedback.MAX_REPEAT + ' times (' + feedback.MAX_NEGATIVE + ' for one or two stars): ' + repeated.join(', '));
  const atReference = lib.replay(base, log.steps, REFERENCE).data;
  expect(JSON.stringify(catalog(atReference)) === JSON.stringify(catalog(reference)), 'at the fixture clock the account and catalog equal the fixture');
  return problems;
}

function build() {
  const { base, end, steps, reference } = simulate();
  const log = { schema: 'plateway.delivery-replay.v1', dataset_id: SEED_IDS.full, generator: { tool: 'dataset/generate.cjs', version: VERSION, seed: SEED }, time_zone: ZONE, starts_at: START, ends_at: END, reference_clock: REFERENCE, base: FILES.base, end_state: FILES.full, steps };
  const problems = check(base, log, end, reference);
  if (problems.length) throw Error(problems.join('\n'));
  return { [FILES.base]: lib.pretty(base), [FILES.replay]: lib.replayText(log), [FILES.full]: lib.pretty(end), stats: { orders: end.orders.length, notices: end.notices.length, steps: steps.length } };
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
module.exports = { build, SEED, VERSION, AWAY, NO_DELIVERY, HOLIDAYS, PRICE_CHANGES, AVAILABILITY, PAUSES, catalog };
