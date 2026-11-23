'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const { compile } = require('../tests/schema-validator.cjs');
const plugin = require('../plugin.cjs');
const { totals } = require('../src/pricing.cjs');
const { localParts, ms, toIso, isOpen } = require('../src/time.cjs');

const ALLERGENS = new Set(['milk', 'egg', 'fish', 'crustacean shellfish', 'tree nuts', 'peanuts', 'wheat', 'soybeans', 'sesame']);
const BRANDS = /\b(doordash|door dash|uber ?eats|grubhub|postmates|seamless|instacart|deliveroo|just eat|caviar|mcdonald'?s|starbucks|chipotle|domino'?s|pizza hut|subway|kfc|taco bell|panera|wendy'?s|burger king|dunkin|chick-fil-a|shake shack|sweetgreen|five guys|panda express|olive garden|papa john'?s|popeyes|in-n-out|cheesecake factory|p\.?f\.? chang'?s|nando'?s|wagamama|visa|mastercard|master card|american express|amex|discover|jcb|unionpay|diners club|maestro)\b/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const PAST = new Set(['delivered', 'cancelled']);
const ACTIVE = new Set(['submitted', 'preparing', 'picked_up']);
const MIB = 1024 * 1024;

function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach(v => strings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach(v => strings(v, out));
  return out;
}

function check(seed, { clock, binding, scenario, dataset, bytes }) {
  const problems = [];
  const expect = (ok, message) => { if (!ok) problems.push(message); };
  const seedValid = compile(require('../schemas/seed.schema.json'), path.join(root, 'schemas'));
  expect(seedValid(seed), 'the seed does not match its schema');
  try { plugin.validateSeed({ app_id: 'plateway', virtual_now: clock.initial_time, binding }, seed); } catch (e) { problems.push('validateSeed: ' + e.message); }
  const now = ms(clock.initial_time);
  const today = localParts(now, seed.time_zone);

  expect(seed.holder && seed.holder.person_id === seed.owner_person_id, 'one account holder, the bound owner');
  const served = new Set(seed.restaurants.flatMap(r => r.zones.map(z => z.zone_id)));
  expect(seed.addresses.filter(a => served.has(a.zone_id)).length === 2, 'two addresses in served zones');
  expect(seed.addresses.filter(a => !served.has(a.zone_id)).length === 1, 'one address outside every served zone');

  const expired = c => c.exp_year * 12 + c.exp_month < Number(today.date.slice(0, 4)) * 12 + Number(today.date.slice(5, 7));
  expect(seed.cards.length === 3, 'three cards');
  expect(seed.cards.some(c => c.behavior === 'approve' && !expired(c)), 'a valid card');
  expect(seed.cards.some(c => c.behavior === 'decline' && !expired(c)), 'a declining card');
  expect(seed.cards.some(c => expired(c)), 'an expired card');

  expect(seed.restaurants.length === 6, 'six restaurants');
  expect(new Set(seed.restaurants.map(r => r.cuisines[0])).size === 6, 'six different lead cuisines');
  expect(seed.restaurants.some(r => Object.values(r.hours).filter(d => d.length === 0).length === 1), 'a restaurant closed on exactly one weekday');
  const pauses = [].concat(scenario).filter(e => e.operation === 'restaurant.status_changed' && e.payload.status === 'paused');
  expect(pauses.length > 0 && pauses.every(e => { const r = seed.restaurants.find(x => x.id === e.payload.restaurant_id); return r && !r.paused && ms(e.at) >= now && isOpen(r, ms(e.at), seed.time_zone); }), 'the scenario pauses a restaurant while it is open, at or after the seed clock');
  const spans = seed.restaurants.flatMap(r => Object.values(r.hours).flat());
  expect(spans.some(([start, end]) => end <= start), 'a restaurant open past midnight');
  expect(seed.restaurants.some(r => Object.values(r.hours).some(d => d.length > 1)), 'a restaurant with split hours');

  expect(seed.dishes.length >= 30 && seed.dishes.length <= 42, 'about 36 dishes');
  expect(seed.restaurants.every(r => seed.dishes.filter(d => d.restaurant_id === r.id).length >= 4), 'every restaurant has a menu');
  expect(seed.dishes.filter(d => d.option_groups.length).length >= 12, 'option groups on many dishes');
  expect(seed.dishes.some(d => d.option_groups.some(g => g.required)), 'a required option group');
  expect(seed.dishes.some(d => d.option_groups.some(g => g.options.some(o => o.allergens.contains.some(a => !d.allergens.contains.includes(a))))), 'an option that adds an allergen');
  expect(seed.dishes.some(d => d.allergens.may_contain.length), 'a may_contain declaration');
  const declared = seed.dishes.flatMap(d => [d.allergens, ...d.option_groups.flatMap(g => g.options.map(o => o.allergens))]).flatMap(a => [...a.contains, ...a.may_contain]);
  expect(declared.every(a => ALLERGENS.has(a)), 'only the nine listed allergens');

  const past = seed.orders.filter(o => PAST.has(o.status) && ms(o.placed_at) < now);
  expect(past.length === 10, 'ten past orders');
  expect(past.every(o => o.lines.length > 0 && o.charge.amount_cents > 0), 'past orders carry receipts');
  expect(past.some(o => o.lines.some(l => l.label)), 'a labelled line');
  expect(seed.orders.filter(o => o.rating).length === 4, 'four ratings');
  expect(seed.orders.filter(o => o.status === 'scheduled').length === 1, 'one scheduled order');
  expect(past.some(o => o.cancellation && o.cancellation.reason === 'rejected'), 'a rejected order');
  expect(past.some(o => o.lines.some(l => l.report)), 'a reported line');
  expect(past.some(o => o.lines.some(l => l.removed && l.removed_reason === 'unavailable')), 'a line removed as unavailable');
  expect(past.some(o => o.fees.small_order_cents > 0), 'an order with the small-order fee');
  expect(seed.dishes.some(d => !d.available), 'a sold-out dish');
  expect(seed.orders.filter(o => ACTIVE.has(o.status)).length === 1, 'one order in progress');
  for (const o of seed.orders) {
    const t = totals(o.lines, o.fees.delivery_cents, o.tip_cents);
    expect(t.total_cents === o.total_cents && t.total_cents === o.charge.amount_cents && t.tax_cents === o.tax_cents && t.service_cents === o.fees.service_cents && t.small_order_cents === o.fees.small_order_cents, 'order ' + o.id + ' total recomputes');
    expect(o.refunds.reduce((s, r) => s + r.amount_cents, 0) <= o.charge.amount_cents, 'order ' + o.id + ' refunds within the charge');
  }

  const all = strings(seed);
  expect(all.filter(s => ISO.test(s)).every(s => localParts(ms(s), seed.time_zone).date >= '2026-01-01'), 'every date on or after 2026-01-01');
  expect(all.filter(s => ISO.test(s)).every(s => s.slice(-6) === toIso(ms(s), seed.time_zone).slice(-6)), 'every time written with the zone offset in force');
  expect(bytes < MIB, 'fixture under 1 MiB');
  expect(!all.some(s => BRANDS.test(s)), 'no real brands');
  expect(dataset.expected_counts.records === plugin.records(seed).length, 'dataset record count matches');
  return problems;
}

function load() {
  const read = rel => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
  return {
    seed: read('fixtures/minimal.json'),
    options: {
      clock: read('fixtures/clock.json'), binding: read('fixtures/binding.json'), scenario: read('examples/scenario.json'),
      dataset: read('contribution/dataset.json'), bytes: fs.statSync(path.join(root, 'fixtures/minimal.json')).size,
    },
  };
}

if (require.main === module) {
  const { seed, options } = load();
  const problems = check(seed, options);
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
  console.log('fixture ok: ' + seed.restaurants.length + ' restaurants, ' + seed.dishes.length + ' dishes, ' + seed.orders.length + ' orders');
}
module.exports = { check, load };
