'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const plugin = require('../plugin.cjs');
const { ms, toIso } = require('../src/time.cjs');
const { fixture } = require('./harness.cjs');
const lib = require('../dataset/lib.cjs');
const generate = require('../dataset/generate.cjs');
const { asOf } = require('../dataset/as-of.cjs');
const feedback = require('../dataset/feedback.cjs');
const { compute, render, OUT, instantsOf } = require('../dataset/coverage.cjs');
const { dueTimers } = require('../src/timers.cjs');

const files = lib.load();
const steps = files.replay.steps;
const step = test => steps.find(test);
const plus = (iso, minutes) => toIso(ms(iso) + minutes * 60000, lib.ZONE);
const firstAfter = (from, test) => step(s => ms(s.at) > ms(from) && test(s));
const pick = (...args) => { const s = firstAfter(...args); assert.ok(s, 'a replay step for the instant'); return s.at; };
const pending = files.full.orders.find(o => o.cancellation && o.cancellation.reason === 'not_accepted');
const sessionAdd = steps.find((s, i) => s.tool === 'plateway.cart.add_item' && steps[i - 1] && steps[i - 1].tool === 'plateway.cart.add_item' && ms(steps[i - 1].at) < ms(s.at));
const scheduled = files.full.orders.find(o => o.mode === 'scheduled' && o.status === 'delivered' && ms(o.placed_at) > ms('2026-01-01T00:00:00-05:00'));
const INSTANTS = [
  lib.START, '2026-01-01', lib.REFERENCE, '2026-12-15', lib.END,
  pick('2026-01-01T00:00:00-05:00', s => s.operation === 'order.picked_up'),
  sessionAdd.at,
  plus(pending.accept_by, 1),
  plus(scheduled.placed_at, 1),
];
const times = o => [o.placed_at, o.submitted_at, o.charge.at, o.delivered_at, o.cancellation && o.cancellation.at, o.rating && o.rating.at,
  ...o.timeline.map(t => t.at), ...o.refunds.map(r => r.at), ...o.lines.flatMap(l => [l.removed_at, l.report && l.report.at])].filter(Boolean);
const suffix = (list, prefix) => Math.max(0, ...list.map(id => new RegExp('^' + prefix + '-(\\d+)$').exec(id)).filter(Boolean).map(m => Number(m[1])));
const strings = (v, out = []) => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach(x => strings(x, out)); else if (v && typeof v === 'object') Object.values(v).forEach(x => strings(x, out)); return out; };

test('Dataset every month from 2025-01 to 2026-12 has orders and dated records, from the first day to the last', () => {
  const c = compute(files);
  assert.deepEqual(c.monthly.map(m => m.month), lib.months());
  assert.equal(c.monthly.length, 24);
  for (const m of c.monthly) assert.ok(m.orders >= 3 && m.distinct_dates >= 3 && m.records > m.orders, 'coverage in ' + m.month);
  assert.deepEqual(c.months_without_orders, []);
  assert.deepEqual([c.earliest, c.latest, c.invalid_dates, c.outside_window], [lib.FIRST, lib.LAST, 0, 0]);
  assert.equal(c.record_kinds.find(k => k.kind === 'order').earliest, lib.FIRST);
  assert.equal(c.record_kinds.find(k => k.kind === 'order').latest, lib.LAST);
  assert.ok(c.distinct_dates.global >= c.distinct_dates.coverage);
  assert.equal(c.distinct_dates.coverage, new Set(lib.dated(files.full).map(i => lib.localDate(i.at))).size);
  assert.ok(c.gaps.filter(g => g.kind === 'days_without_records').every(g => lib.dated(files.full).every(i => lib.localDate(i.at) < g.from || lib.localDate(i.at) > g.to)));
  assert.deepEqual([c.provenance.real, c.provenance.mixed, c.provenance.synthetic], [0, 0, c.totals.records]);
  const after = lib.dated(files.full).filter(i => ms(i.at) >= ms(lib.REFERENCE)).length;
  assert.equal(c.partitions[1].records, after);
  assert.equal(c.monthly.reduce((s, m) => s + m.records_after_reference_clock, 0), after);
  assert.ok(c.gaps.some(g => g.kind === 'real_data_anchor' && g.period === '2026-11' && /no crawling or copied menus/.test(g.reason) && /pending maintainer agreement/.test(g.status)));
});

test('Dataset an as-of selection holds only what was recorded before its instant, with matching counters and clock', () => {
  const seen = new Set();
  for (const text of INSTANTS) {
    const s = asOf(text, files), t = ms(s.as_of);
    assert.equal(s.virtual_now, toIso(t, lib.ZONE), text);
    assert.ok(!seen.has(s.data.seed_id), 'its own seed ID');
    seen.add(s.data.seed_id);
    assert.ok(steps.slice(0, s.steps_applied).every(x => ms(x.at) < t) && steps.slice(s.steps_applied).every(x => ms(x.at) >= t), 'cut at ' + text);
    assert.equal(s.steps_applied + s.steps_withheld, steps.length);
    assert.deepEqual(s.data.orders.map(o => o.id), files.full.orders.filter(o => ms(o.placed_at) < t).map(o => o.id), 'orders before ' + text);
    for (const o of s.data.orders) assert.ok(times(o).every(x => ms(x) < t), 'order ' + o.id + ' shows nothing after ' + text);
    assert.deepEqual(s.data.notices.map(n => n.id), files.full.notices.filter(n => ms(n.at) < t).map(n => n.id), 'exactly the notices dated before ' + text);
    assert.deepEqual(s.data.orders.flatMap(o => o.refunds.map(r => r.id)), files.full.orders.flatMap(o => o.refunds.filter(r => ms(r.at) < t).map(r => r.id)).sort((a, b) => Number(a.slice(3)) - Number(b.slice(3))), 'exactly the refunds dated before ' + text);
    assert.deepEqual(dueTimers(s.data, toIso(t - 1, lib.ZONE)), [], 'no timer due before ' + text + ' is left uncommitted');
    for (const o of s.data.orders) {
      const end = files.full.orders.find(x => x.id === o.id);
      if (Math.max(...times(end).map(ms)) < t) assert.deepEqual(o, end, 'a finished order is identical to the dataset record');
    }
    const issued = s.data.issued || {};
    const ids = { o: s.data.orders.map(o => o.id), n: s.data.notices.map(n => n.id), rf: s.data.orders.flatMap(o => o.refunds.map(r => r.id)), ol: [...s.data.orders.flatMap(o => o.lines.map(l => l.id)), ...s.data.cart.lines.map(l => l.id)] };
    for (const prefix of ['o', 'n', 'rf']) assert.equal(issued[prefix] || 0, ids[prefix].length, prefix + ' counter at ' + text);
    assert.ok((issued.ol || 0) >= suffix(ids.ol, 'ol'), 'line counter at ' + text);
    assert.ok(s.events.every(e => ms(e.at) >= t && (!e.payload.order_id || s.data.orders.some(o => o.id === e.payload.order_id))), 'staged events are later and name known orders');
    assert.equal(s.bundle.dataset.expected_counts.records, plugin.records(s.data).length);
    assert.equal(s.bundle.dataset.dataset_id, s.data.seed_id);
    const f = fixture({ seed: s.data, now: s.virtual_now });
    assert.equal(f.call('plateway.account.get', {}).now, s.virtual_now);
    assert.deepEqual(f.call('plateway.orders.list', { from: s.virtual_now }).orders, [], 'no order listed at or after ' + text);
    assert.equal(f.call('plateway.orders.list', {}).orders.length, s.data.orders.length);
  }
});

test('Dataset selections on either side of a replay step have their own seed IDs, and a checkout token from one is stale on the other', () => {
  const at = step(s => s.operation === 'menu_item.price_changed' && s.payload.item_id === 'mi-19').at;
  const before = asOf(at, files), after = asOf(toIso(ms(at) + 1, lib.ZONE), files);
  assert.equal(after.virtual_now, toIso(ms(at) + 1, lib.ZONE));
  assert.equal(after.steps_applied, before.steps_applied + steps.filter(s => s.at === at).length);
  assert.deepEqual([before.data.dishes.find(d => d.id === 'mi-19').price_cents, after.data.dishes.find(d => d.id === 'mi-19').price_cents], [1250, 1295]);
  assert.notEqual(before.data.seed_id, after.data.seed_id);
  assert.equal(asOf(at, files).data.seed_id, before.data.seed_id);
  const args = { address_id: 'a-1', card_id: 'c-1', when: { mode: 'scheduled', delivery_at: lib.localIso(lib.localDate(at), 12 * 60) }, tip_cents: 300 };
  const open = s => {
    const f = fixture({ seed: s.data, now: s.virtual_now });
    for (const line of f.data().cart.lines) f.call('plateway.cart.remove_item', { line_id: line.id });
    assert.equal(f.call('plateway.cart.add_item', { item_id: 'mi-3', option_ids: [], quantity: 1 }).status, 'committed');
    const p = f.call('plateway.checkout.preview', args);
    assert.equal(p.status, 'ok');
    return { f, token: p.token };
  };
  const earlier = open(before), later = open(after);
  assert.notEqual(earlier.token, later.token);
  assert.equal(later.f.call('plateway.orders.place', { ...args, token: earlier.token }).status, 'stale_preview');
  assert.equal(later.f.call('plateway.orders.place', { ...args, token: later.token }).status, 'committed');
  assert.equal(earlier.f.call('plateway.orders.place', { ...args, token: earlier.token }).status, 'committed');
});

test('Dataset every rating text agrees with the order it rates', () => {
  const rated = files.full.orders.filter(o => o.rating);
  assert.ok(rated.length >= 50);
  for (const o of rated) assert.ok(feedback.holds(files.full, o), o.id + ': ' + o.rating.stars + ' ' + o.rating.text);
  const copy = structuredClone(files.full);
  const late = copy.orders.find(o => o.rating && !o.lines.some(l => l.report) && feedback.context(copy, o, o.rating.at).lateness > 0);
  late.rating = { ...late.rating, stars: 5, text: 'Arrived earlier than the estimate.' };
  assert.equal(feedback.holds(copy, late), false, 'an early claim on a late delivery is caught');
  const reported = copy.orders.find(o => o.rating && o.lines.some(l => l.report && l.report.kind === 'missing'));
  if (reported) { reported.rating = { ...reported.rating, stars: 2, text: 'Wrong dish in the bag.' }; assert.equal(feedback.holds(copy, reported), false, 'a wrong-dish claim on a missing report is caught'); }
  const lunch = copy.orders.find(o => o.rating && !o.lines.some(l => l.report) && lib.localDate(o.placed_at) && Number(o.placed_at.slice(11, 13)) >= 17);
  lunch.rating = { ...lunch.rating, stars: 5, text: 'Quick lunch, no fuss.' };
  assert.equal(feedback.holds(copy, lunch), false, 'a lunch claim on a dinner order is caught');
  const morning = copy.orders.find(o => o.rating && !o.lines.some(l => l.report) && Number(o.delivered_at.slice(11, 13)) < 12);
  morning.rating = { ...morning.rating, stars: 5, text: 'Just right for a quiet evening.' };
  assert.equal(feedback.holds(copy, morning), false, 'an evening claim on a morning delivery is caught');
  const wrong = copy.orders.find(o => o.rating && o.lines.some(l => l.report && l.report.kind === 'wrong'));
  if (wrong) { wrong.rating = { ...wrong.rating, stars: 2, text: 'One item never arrived.' }; assert.equal(feedback.holds(copy, wrong), false, 'a missing-item claim on a wrong-item report is caught'); }
  assert.deepEqual(feedback.repeated(files.full), []);
  const counts = new Map();
  for (const o of rated) if (o.rating.text) counts.set(o.rating.text, (counts.get(o.rating.text) || 0) + 1);
  assert.ok([...counts].every(([text, n]) => n <= ([...feedback.RATINGS, ...feedback.LOW].find(e => e[1] === text)[0] <= 2 ? feedback.MAX_NEGATIVE : feedback.MAX_REPEAT)));
  const echo = structuredClone(files.full);
  echo.orders.filter(o => o.rating && !o.lines.some(l => l.report)).slice(0, feedback.MAX_NEGATIVE + 1).forEach(o => { o.rating = { ...o.rating, stars: 2, text: 'Arrived lukewarm and a bit soggy.' }; });
  assert.ok(feedback.repeated(echo).length > 0, 'a text repeated beyond its cap is caught');
  const used = new Set(rated.map(o => o.rating.text));
  assert.ok(['Hot and on time.', 'Good, a little late.', 'Took longer than the estimate.', 'Arrived earlier than the estimate.'].some(t => used.has(t)), 'timing feedback is present');
});

test('Dataset a cut just after a due timer agrees with the App reads Core relays, in the seed, its notices and open_orders', () => {
  const timeout = files.full.orders.find(o => o.cancellation && o.cancellation.reason === 'not_accepted');
  const release = files.full.orders.find(o => o.mode === 'scheduled' && o.status === 'delivered' && steps.every(x => !(ms(x.at) > ms(o.release_at) && ms(x.at) <= ms(o.release_at) + 1)));
  const cases = [[timeout, ms(timeout.accept_by) + 1], [timeout, ms(timeout.accept_by)], [release, ms(release.release_at) + 1]];
  for (const [order, t] of cases) {
    const s = asOf(toIso(t, lib.ZONE), files);
    const f = fixture({ seed: s.data, now: s.virtual_now });
    const reads = f.call('plateway.orders.list', {}).orders;
    const open = reads.filter(o => !['delivered', 'cancelled'].includes(o.status)).map(o => o.id + ' ' + o.status).sort();
    assert.deepEqual(s.open_orders.map(o => o.order_id + ' ' + o.status).sort(), open, 'open_orders at ' + s.as_of + ' equal the reads');
    for (const o of s.open_orders) assert.equal(o.status, f.call('plateway.orders.get', { order_id: o.order_id }).order.status);
    const stored = s.data.orders.find(o => o.id === order.id), shown = f.call('plateway.orders.get', { order_id: order.id }).order;
    if (order === timeout) {
      assert.equal(shown.status, 'cancelled', 'the acceptance limit has passed at ' + s.as_of);
      assert.ok(!s.open_orders.some(o => o.order_id === order.id));
      assert.equal(s.events.filter(e => e.payload.order_id === order.id).length, 0);
      if (t > ms(order.accept_by)) {
        assert.deepEqual(s.timers_committed, [{ kind: 'accept_limit', order_id: order.id, at: order.accept_by }]);
        assert.deepEqual(stored, order, 'the committed timer leaves the dataset record');
        assert.ok(s.data.notices.some(n => n.order_id === order.id && n.kind === 'notice.order_cancelled'));
      } else assert.deepEqual([stored.status, s.timers_committed], ['submitted', []], 'a timer due exactly at the instant is left to the reads, as Core shows it');
    } else {
      assert.deepEqual([stored.status, shown.status, s.timers_committed.map(x => x.kind)], ['submitted', 'submitted', ['release']]);
      assert.deepEqual(s.open_orders.find(o => o.order_id === order.id).after_staged_events, 'delivered');
      assert.ok(s.events.some(e => e.operation === 'order.accepted' && e.payload.order_id === order.id));
    }
  }
});

test('Dataset temperature and side-dish claims need a hot dish or a hot side dish from the catalog', () => {
  const names = Object.fromEntries(files.full.dishes.map(d => [d.id, d.name]));
  for (const [id, name] of Object.entries({ ...feedback.HOT, ...feedback.HOT_SIDES })) assert.equal(names[id], name, id);
  assert.ok(Object.keys(feedback.HOT_SIDES).every(id => feedback.HOT[id]));
  const claimed = [...feedback.RATINGS, ...feedback.LOW].filter(e => feedback.claimsOf(e).some(k => k === 'hot' || k === 'sides'));
  assert.deepEqual(claimed.map(e => e[1]).sort(), ['Arrived lukewarm and a bit soggy.', 'Fine, but the sides were cold.', 'Hot and on time.', 'Still warm when it arrived.']);
  for (const o of files.full.orders.filter(x => x.rating && claimed.some(e => e[1] === x.rating.text))) {
    const live = o.lines.filter(l => !l.removed);
    assert.ok(live.some(l => feedback.HOT[l.item_id]), o.id + ' has a hot dish');
    if (o.rating.text === 'Fine, but the sides were cold.') assert.ok(live.some(l => feedback.HOT_SIDES[l.item_id]) && live.length > 1, o.id + ' has a hot side dish and a main');
  }
  const copy = structuredClone(files.full);
  const bakery = copy.orders.find(o => o.rating && !o.lines.some(l => l.report) && o.lines.length > 1 && o.lines.every(l => l.unit_price_cents < 1000 && !feedback.HOT_SIDES[l.item_id]));
  bakery.rating = { ...bakery.rating, stars: 3, text: 'Fine, but the sides were cold.' };
  assert.equal(feedback.holds(copy, bakery), false, 'cheap items are not side dishes');
  const cold = copy.orders.find(o => o.rating && !o.lines.some(l => l.report) && o.lines.every(l => !feedback.HOT[l.item_id]));
  cold.rating = { ...cold.rating, stars: 5, text: 'Hot and on time.' };
  assert.equal(feedback.holds(copy, cold), false, 'a hot claim on an order with no hot dish is caught');
});

test('Dataset staged events bring an open order to its dataset outcome, and open_orders names the account holder steps they cannot replace', () => {
  const outcome = o => o.status + (o.cancellation ? ' (' + o.cancellation.reason + ')' : '');
  const at = (iso, minutes) => toIso(ms(iso) + minutes * 60000, lib.ZONE);
  const instants = [
    ...files.full.orders.filter(o => o.cancellation && o.cancellation.reason === 'account_holder').map(o => o.cancellation.stage === 'preparing' ? at(o.timeline.find(t => t.status === 'preparing').at, 1) : at(o.placed_at, 1)),
    pick('2026-01-01T00:00:00-05:00', s => s.operation === 'order.picked_up'),
    pick('2025-06-01T00:00:00-04:00', s => s.operation === 'order.accepted'),
  ];
  let holderOnly = 0, open = 0;
  for (const instant of instants) {
    const s = asOf(instant, files);
    const settle = withHolder => {
      const f = fixture({ seed: s.data, now: s.virtual_now });
      const staged = new Set(s.events.map(e => e.event_id));
      const held = new Set(withHolder ? s.open_orders.flatMap(o => o.withheld_account_holder_steps.map(x => x.id)) : []);
      for (const x of steps.slice(s.steps_applied)) {
        if (x.by === 'infra' && staged.has(lib.eventId(x))) assert.equal(f.event(lib.envelope(x)).status, 'committed');
        else if (held.has(x.id)) {
          f.setNow(x.at);
          const args = { ...x.args, ...(x.tool === 'plateway.orders.cancel.confirm' ? { token: f.call('plateway.orders.cancel.preview', x.args).token } : {}) };
          assert.equal(f.call(x.tool, args).status, 'committed', x.id);
        }
      }
      f.setNow(lib.END);
      return id => outcome(f.call('plateway.orders.get', { order_id: id }).order);
    };
    const events = settle(false), both = settle(true);
    const listed = s.data.orders.filter(o => !['delivered', 'cancelled'].includes(o.status)).map(o => o.id);
    assert.deepEqual(s.open_orders.map(o => o.order_id), listed, 'open orders at ' + instant);
    for (const o of s.open_orders) {
      open++;
      assert.equal(o.after_staged_events, events(o.order_id), o.order_id + ' after the staged events');
      assert.equal(o.in_dataset, outcome(files.full.orders.find(x => x.id === o.order_id)));
      assert.equal(both(o.order_id), o.in_dataset, o.order_id + ' with the withheld account-holder steps');
      if (o.completed_by_staged_events) assert.equal(events(o.order_id), o.in_dataset);
      else { holderOnly++; assert.ok(o.withheld_account_holder_steps.length > 0, o.order_id + ' names the steps that complete it'); }
    }
  }
  assert.ok(open >= instants.length && holderOnly >= 3, 'both kinds of open order are exercised');
});

test('Dataset a selection at the fixture clock loads, shares the fixture catalog and continues every ID sequence', () => {
  const s = asOf(lib.REFERENCE, files);
  assert.deepEqual(generate.catalog(s.data), generate.catalog(lib.read('fixtures/minimal.json')));
  const f = fixture({ seed: s.data, now: s.virtual_now });
  for (const line of f.data().cart.lines) assert.equal(f.call('plateway.cart.remove_item', { line_id: line.id }).status, 'committed');
  assert.equal(f.call('plateway.cart.add_item', { item_id: 'mi-1', option_ids: ['op-2'], quantity: 1 }).line_id, 'ol-' + (s.data.issued.ol + 1));
  const args = { address_id: 'a-1', card_id: 'c-1', when: { mode: 'asap' }, tip_cents: 300 };
  const placed = f.call('plateway.orders.place', { ...args, token: f.call('plateway.checkout.preview', args).token });
  assert.equal(placed.order_id, 'o-' + (s.data.issued.o + 1));
  assert.equal(f.data().notices.at(-1).id, 'n-' + (s.data.issued.n + 1));
});

test('Dataset every replayed state is valid and the replay reproduces the committed files', () => {
  lib.validate(files.base, lib.START);
  lib.validate(files.full, lib.END);
  const { data, applied } = lib.replay(files.base, steps, undefined, { check: true });
  assert.equal(applied, steps.length);
  data.seed_id = lib.SEED_IDS.full;
  assert.equal(lib.pretty(data), fs.readFileSync(lib.file(lib.FILES.full), 'utf8'));
  const end = asOf(lib.END, files);
  end.data.seed_id = lib.SEED_IDS.full;
  assert.equal(lib.pretty(end.data), fs.readFileSync(lib.file(lib.FILES.full), 'utf8'));
  assert.equal(lib.replayText(files.replay), fs.readFileSync(lib.file(lib.FILES.replay), 'utf8'));
  assert.ok(files.full.orders.every(o => ['delivered', 'cancelled'].includes(o.status)));
  const iso = strings([files.base, files.replay, files.full]).filter(x => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(x));
  assert.ok(iso.every(x => x.slice(-6) === toIso(ms(x), lib.ZONE).slice(-6)), 'every time written with the zone offset in force');
  assert.throws(() => asOf('2024-12-31', files), /dataset window/);
  assert.throws(() => asOf('next week', files), /Give the instant/);
});

test('Dataset the committed coverage report matches a fresh computation, its hashes and its MCP read-back', () => {
  const committed = JSON.parse(fs.readFileSync(lib.file(OUT.json), 'utf8'));
  const { loading, ...counted } = committed;
  assert.deepEqual(counted, compute(files));
  for (const source of committed.sources) assert.equal(source.sha256, lib.sha256(source.file), source.file);
  assert.equal(render(committed), fs.readFileSync(lib.file(OUT.md), 'utf8'));
  assert.deepEqual(loading.instants.map(x => x.as_of), instantsOf(files));
  assert.ok(loading.instants[0].timers_committed > 0, 'the first loaded cut commits a due timer');
  for (const x of loading.instants) {
    assert.deepEqual([x.load.status, x.load.automated_checks, x.account_now, x.listed_ids_match_selection, x.orders_listed_from_as_of, x.monthly_read_back_matches_selection, x.open_orders_match_core], ['ready', 'pass', x.as_of, true, 0, true, true], x.as_of);
    assert.deepEqual(x.open_orders, asOf(x.as_of, files).open_orders.map(o => o.order_id + ' ' + o.status));
    assert.ok(!x.latest_listed_placed_at || ms(x.latest_listed_placed_at) < ms(x.as_of));
  }
  const whole = loading.instants.at(-1).monthly_read_back;
  for (const m of committed.monthly) for (const key of Object.keys(whole[m.month])) assert.equal(whole[m.month][key], m[key], m.month + ' ' + key);
  const declared = lib.read('contribution/dataset.json').sources.find(s => s.source_id === 'delivery-dataset');
  assert.deepEqual([declared.kind, declared.generation.tool, declared.generation.seed, declared.generation.tool_version], ['synthetic', 'dataset/generate.cjs', String(generate.SEED), generate.VERSION]);
  assert.deepEqual([declared.generation.parameters.from, declared.generation.parameters.to, declared.generation.parameters.time_zone], [lib.FIRST, lib.LAST, lib.ZONE]);
});
