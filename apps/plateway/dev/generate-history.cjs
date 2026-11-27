'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { fixture } = require('../tests/harness.cjs');
const plugin = require('../plugin.cjs');
const { toIso } = require('../src/time.cjs');

const FILE = path.join(__dirname, '../fixtures/minimal.json');
const SEED = 2025, FROM = [2025, 1], TO = [2026, 7];
const HISTORY = /-h\d+$/;
const LIVE_ID = /\b(o|ol|rf|n)-(\d+)\b/g;
let state = SEED;
const rnd = n => { state = (state * 1103515245 + 12345) % 2147483648; return Math.floor(state / 65536) % n; };
const pick = list => list[rnd(list.length)];
const shuffled = list => { const out = [...list]; for (let i = out.length - 1; i > 0; i--) { const j = rnd(i + 1); [out[i], out[j]] = [out[j], out[i]]; } return out; };
const pad = n => String(n).padStart(2, '0');
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const TIMES = ['08:40', '12:10', '12:45', '13:20', '18:05', '18:40', '19:15', '19:50', '20:30', '22:10'];
const RATINGS = [[5, 'Hot and on time.'], [5, 'Exactly as ordered.'], [4, 'Good, a little late.'], [4, 'Tasty; packaging could be better.'], [3, 'Fine, but the sides were cold.'], [5, null], [4, null],
  [5, 'Driver was friendly and quick.'], [4, 'Generous portions.'], [2, 'Arrived lukewarm and a bit soggy.'], [5, 'Our usual, still great.'], [4, 'Spice level was spot on.'], [3, 'Took longer than the estimate.'],
  [5, 'Perfect for a rainy evening.'], [4, null], [5, 'The kids loved it.'], [3, null], [4, 'Good value for the price.']];
const LABELS = ['For Sam', 'For Alex'];
const REJECTIONS = ['The kitchen closed early', 'Too busy to take more orders', 'An ingredient ran out'];

function offset(y, m, d) {
  const probe = new Date(Date.UTC(y, m - 1, d, 12));
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' }).formatToParts(probe).find(p => p.type === 'timeZoneName').value;
  const h = Number(name.replace('GMT', '') || 0);
  return (h < 0 ? '-' : '+') + pad(Math.abs(h)) + ':00';
}
const local = (y, m, d, hhmm) => y + '-' + pad(m) + '-' + pad(d) + 'T' + hhmm + ':00' + offset(y, m, d);
const plus = (iso, minutes) => toIso(Date.parse(iso) + minutes * 60000, 'America/New_York');

function authored(data) {
  const keep = x => !HISTORY.test(x.id);
  return { ...data, orders: data.orders.filter(keep), notices: data.notices.filter(keep) };
}

function simulate(base) {
  const seed = { ...structuredClone(base), orders: [], notices: [] };
  const f = fixture({ seed, now: local(FROM[0], FROM[1], 1, '08:00') });
  let events = 0;
  const ev = (at, operation, payload) => { f.setNow(at); const r = f.event({ event_id: 'history-' + (++events), at, operation, payload }); if (r.status !== 'committed') throw Error(operation + ' ' + r.status + ' ' + (r.message || '')); };
  const call = (at, name, args) => { f.setNow(at); return f.call(name, args); };
  for (let y = FROM[0], m = FROM[1]; y < TO[0] || (y === TO[0] && m <= TO[1]); m === 12 ? (y++, m = 1) : m++) {
    const days = [...new Set([1 + rnd(13), 14 + rnd(14), ...(rnd(2) === 0 ? [8 + rnd(12)] : [])])].sort((a, b) => a - b);
    for (const day of days) {
      const data = f.data();
      const weekday = DAYS[new Date(Date.UTC(y, m - 1, day)).getUTCDay()];
      let placedAt = null, preview = null, args = null, restaurant = null;
      for (const base of shuffled(TIMES)) {
        const minutes = Number(base.slice(0, 2)) * 60 + Number(base.slice(3)) + 5 * rnd(6);
        const hhmm = pad(Math.floor(minutes / 60)) + ':' + pad(minutes % 60);
        const at = local(y, m, day, hhmm);
        const workdayLunch = !['sat', 'sun'].includes(weekday) && hhmm < '15:00';
        const address = data.addresses.find(a => a.label === (workdayLunch ? 'Office' : 'Home'));
        const choices = data.restaurants.filter(r => r.hours[weekday].length && r.zones.some(z => z.zone_id === address.zone_id));
        if (!choices.length || Date.parse(at) <= Date.parse(f.ctx.virtual_now)) continue;
        restaurant = pick(choices);
        const dishes = data.dishes.filter(x => x.restaurant_id === restaurant.id && x.available);
        call(at, 'plateway.cart.get', {});
        const cart = f.data().cart;
        for (const line of cart.lines) call(at, 'plateway.cart.remove_item', { line_id: line.id });
        for (const dish of shuffled(dishes).slice(0, 1 + rnd(3))) {
          const options = dish.option_groups.flatMap(g => shuffled(g.options).slice(0, g.required ? g.min : rnd(3) === 0 ? 1 : 0).map(o => o.id));
          call(at, 'plateway.cart.add_item', { item_id: dish.id, option_ids: options, quantity: 1 + (rnd(4) === 0 ? 1 : 0), label: rnd(6) === 0 ? pick(LABELS) : null });
        }
        args = { address_id: address.id, card_id: rnd(3) === 0 ? 'c-3' : 'c-1', when: { mode: 'asap' }, tip_cents: pick([0, 200, 300, 300, 400, 500]) };
        preview = call(at, 'plateway.checkout.preview', args);
        if (preview.token) { placedAt = at; break; }
      }
      if (!placedAt) continue;
      const placed = call(placedAt, 'plateway.orders.place', { ...args, token: preview.token });
      if (placed.status !== 'committed') throw Error('place ' + placed.status + ' ' + placed.message);
      const id = placed.order_id, roll = rnd(100);
      if (roll < 5) { ev(plus(placedAt, 6), 'order.rejected', { order_id: id, reason: REJECTIONS[Number(id.slice(2)) % REJECTIONS.length] }); continue; }
      if (roll >= 95) {
        const at = plus(placedAt, 2);
        const p = call(at, 'plateway.orders.cancel.preview', { order_id: id });
        const c = call(at, 'plateway.orders.cancel.confirm', { order_id: id, token: p.token });
        if (c.status !== 'committed') throw Error('cancel ' + c.status);
        continue;
      }
      ev(plus(placedAt, 3 + rnd(8)), 'order.accepted', { order_id: id });
      const order = f.data().orders.find(o => o.id === id);
      ev(plus(placedAt, restaurant.prep_minutes + 4 + rnd(6)), 'order.picked_up', { order_id: id });
      const deliveredAt = plus(order.estimated_delivery_at, rnd(9) - 3);
      ev(deliveredAt, 'order.delivered', { order_id: id });
      let last = deliveredAt;
      if (rnd(100) < 8) {
        const line = pick(f.data().orders.find(o => o.id === id).lines);
        last = plus(deliveredAt, 10 + rnd(110));
        const r = call(last, 'plateway.orders.report_issue', { order_id: id, lines: [{ line_id: line.id, kind: pick(['missing', 'wrong']) }] });
        if (r.status !== 'committed') throw Error('report ' + r.status + ' ' + r.message);
      }
      if (rnd(100) < 45) {
        const [stars, text] = pick(RATINGS);
        const r = call(plus(last, 15 + rnd(105)), 'plateway.orders.rate', { order_id: id, stars, ...(text ? { text } : {}) });
        if (r.status !== 'committed') throw Error('rate ' + r.status + ' ' + r.message);
      }
    }
  }
  return f.data();
}

function relabel(generated) {
  const map = new Map();
  const id = old => { if (!map.has(old)) map.set(old, old.replace(/-(\d+)$/, '-h$1')); return map.get(old); };
  const text = value => value.replace(LIVE_ID, (whole, prefix, num) => prefix + '-h' + num);
  for (const o of generated.orders) {
    o.id = id(o.id);
    for (const l of o.lines) l.id = id(l.id);
    for (const r of o.refunds) { r.id = id(r.id); if (r.line_id) r.line_id = id(r.line_id); }
    for (const t of o.timeline) t.note = text(t.note);
  }
  for (const n of generated.notices) {
    n.id = id(n.id);
    n.order_id = id(n.order_id);
    if (n.line_id) n.line_id = id(n.line_id);
    n.title = text(n.title);
    n.body = text(n.body);
  }
  return generated;
}

function build(current) {
  state = SEED;
  const base = authored(current);
  const history = relabel(simulate(base));
  return { out: { ...base, orders: [...history.orders, ...base.orders], notices: [...history.notices, ...base.notices] }, history };
}

function main() {
  const current = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const { out, history } = build(current);
  const binding = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/binding.json'), 'utf8'));
  plugin.validateSeed({ app_id: 'plateway', virtual_now: JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/clock.json'), 'utf8')).initial_time, binding }, out);
  if (process.argv.includes('--check')) {
    const same = JSON.stringify(out, null, 2) + '\n' === fs.readFileSync(FILE, 'utf8');
    console.log(same ? 'fixture history is up to date' : 'fixture history differs from the generator output');
    process.exitCode = same ? 0 : 1;
    return;
  }
  fs.writeFileSync(FILE, JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify({ generated_orders: history.orders.length, generated_notices: history.notices.length, first: history.orders[0].placed_at, last: history.orders[history.orders.length - 1].placed_at }));
}

if (require.main === module) main();
module.exports = { build, authored, HISTORY, LIVE_ID, SEED, FROM, TO };
