'use strict';
// Writes the delivery dataset in data/evaluation/: two years (2025 and 2026) of Riley's synthetic card account, with its opening month of December 2024.
// It builds a list of stories from the templates of dev/evaluation-scenarios.cjs with a seeded PRNG. Each story fixes all its parts together:
// a purchase with its hold, its refund or its dispute with the credits; an offer with its answer and payout; a payment story. Then it replays every
// step in time order through the App's own hooks, so the App accepted every step and made every payment, dispute, redemption and notification.
// The statement amounts and the points of each cycle are read from the App's data at that time.
// Run `node dev/generate-dataset.cjs` after a change, or with `--check` to compare with the committed files. Never used at run time.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const plugin = require('../plugin.cjs');
const time = require('../src/time.cjs');
const views = require('../src/views.cjs');
const {records} = require('../src/model.cjs');
const {RECORDS} = require('../src/common.cjs');
const {at, ctxAt, check} = require('./replay.cjs');
const {compile} = require('../tests/schema-validator.cjs');
const S = require('./evaluation-scenarios.cjs');

const VERSION = '1.0.0', PRNG_SEED = 20241202, ZONE = 'America/New_York';
const ROOT = path.resolve(__dirname, '..'), OUT = path.join(ROOT, 'data/evaluation');
const APP = require('../app.json').app_id, A = S.ACCOUNT;
const CLOCK = '2026-12-31T23:00:00-05:00', START = A.opened_at;
const MONTH_STARTS = [];
for (let year = 2025; year <= 2026; year++) for (let month = 1; month <= 12; month++) MONTH_STARTS.push(at(year + '-' + String(month).padStart(2, '0') + '-01 00:00'));
// Core reads one request line of at most 2 MiB, and env.load_seed sends the whole seed in one line. Keep a margin.
const REQUEST_LIMIT = 1.8 * 1024 * 1024, TIME_LIMIT_MS = 20000;
const ms = Date.parse, pad = (n, size = 4) => String(n).padStart(size, '0');
const {addDays, weekday} = time;
const dayOf = value => time.localDay(ms(value), ZONE);

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
const random = prng(PRNG_SEED);
const between = (low, high) => low + Math.floor(random() * (high - low + 1));
const chance = p => random() < p;
const pick = list => list[Math.floor(random() * list.length)];
const centsIn = (low, high) => between(Math.round(low * 100), Math.round(high * 100));
const amount = cents => cents / 100;
const text = cents => (cents / 100).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const words = (day, year) => Number(day.slice(8, 10)) + ' ' + MONTHS[Number(day.slice(5, 7)) - 1] + (year && day.slice(0, 4) !== String(year) ? ' ' + day.slice(0, 4) : '');

// Local times: 'YYYY-MM-DD HH:MM'. Batch postings run from 03:00 to 05:59, so they never meet the clock change at 02:00.
const minutes = hhmm => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hhmm = m => pad(Math.floor(m / 60), 2) + ':' + pad(m % 60, 2);
const local = (day, [from, to]) => day + ' ' + hhmm(between(minutes(from), minutes(to)));
const batch = day => local(day, ['03:00', '05:59']);
const evening = day => local(day, ['18:30', '22:30']);
const HOLIDAYS = new Set(S.HOLIDAYS);
const business = day => weekday(day) % 6 !== 0 && !HOLIDAYS.has(day);
const onBusiness = day => { while (!business(day)) day = addDays(day, 1); return day; };
const addBusiness = (day, n) => { while (n > 0) { day = addDays(day, 1); if (business(day)) n--; } return day; };
const decision = day => local(onBusiness(day), S.HOURS.issuer);

// Stories and their steps. '#t:N', '#o:N' and '#p:N' stand for the IDs of transactions, offers and points entries that the replay gives out in
// time order. '@label' stands for an ID that the App made in a labelled write. A payload or arguments can be a function of the data and of `id`.
const stories = [], plan = {purchases: [], refunds: []};
let keys = 0;
const key = kind => '#' + kind + ':' + (++keys);
function story(template, facts = {}) {
  const s = {template, facts, steps: []};
  s.event = (when, name, payload) => { s.steps.push({at: at(when), story: s, event: name, payload}); return s; };
  s.call = (when, name, args, label) => { s.steps.push({at: at(when), story: s, call: name, args, label}); return s; };
  stories.push(s);
  return s;
}
// A purchase that arrives posted at the batch `lag` nights after its transaction time.
function purchase(s, when, merchant, cents, lag = 1, note) {
  const id = key('t'), post = batch(addDays(when.slice(0, 10), lag));
  s.event(post, 'transaction.posted', {transaction_id: id, kind: 'purchase', state: 'posted', amount: amount(cents), merchant, transaction_at: at(when), ...(note ? {note} : {})});
  plan.purchases.push({id, posted: ms(at(post)), cents, merchant});
  return id;
}
// A purchase with a hold first: the hold at the transaction time, and the final amount at a later batch.
function held(s, when, merchant, hold, final, lag, notes = {}) {
  const id = key('t'), post = batch(addDays(when.slice(0, 10), lag));
  s.event(when, 'transaction.posted', {transaction_id: id, kind: 'purchase', state: 'pending', amount: amount(hold), merchant, ...(notes.hold ? {note: notes.hold} : {})});
  s.event(post, 'transaction.posted', {transaction_id: id, kind: 'purchase', state: 'posted', amount: amount(final), merchant, ...(notes.final ? {note: notes.final} : {})});
  plan.purchases.push({id, posted: ms(at(post)), cents: final, merchant});
  return id;
}
// A charge that the merchant posts directly, such as a subscription.
function direct(s, when, merchant, cents) {
  const id = key('t');
  s.event(when, 'transaction.posted', {transaction_id: id, kind: 'purchase', state: 'posted', amount: amount(cents), merchant});
  plan.purchases.push({id, posted: ms(at(when)), cents, merchant});
  return id;
}
// A merchant refund: made at `when`, posted at the next batch.
function refund(s, when, merchant, cents, relates, note) {
  const id = key('t'), post = batch(addDays(when.slice(0, 10), 1));
  s.event(post, 'transaction.posted', {transaction_id: id, kind: 'refund', state: 'posted', amount: amount(cents), merchant, relates_to: relates, note, transaction_at: at(when)});
  plan.refunds.push({id, posted: ms(at(post)), cents, relates});
  return {id, post};
}
const tipped = (bill, merchant) => bill + Math.round(bill * between(...S.MERCHANTS[merchant].tip) / 100);
function dine(s, day, merchant, meal, lag = between(1, 3)) {
  const bill = centsIn(...(meal === 'lunch' ? S.LUNCH : S.DINNER)), hours = S.MERCHANTS[merchant].hours[meal === 'lunch' ? 0 : 1];
  return held(s, local(day, hours), merchant, bill, tipped(bill, merchant), lag);
}
const merchantTime = (day, merchant) => local(day, S.MERCHANTS[merchant].hours[0]);
const simple = (template, day, merchant, cents = centsIn(S.MERCHANTS[merchant].low, S.MERCHANTS[merchant].high)) =>
  purchase(story(template), merchantTime(day, merchant), merchant, cents);

// The trips: home routines stop while Riley is away.
const away = day => S.TRIPS.some(t => day >= t.from && day <= t.to);
const FIRST_DAY = '2024-12-03', LAST_DAY = '2026-12-31', YEAR_END = '2026-12-30';

// Everyday spending, day by day.
function everyday() {
  let fuelDay = '2024-12-04', groceryPlan = null;
  for (let day = FIRST_DAY; day <= LAST_DAY; day = addDays(day, 1)) {
    const wd = weekday(day);
    // One main shop a week, mostly on the weekend, and sometimes a small top-up in the week.
    if (wd === 6) groceryPlan = chance(0.8) ? addDays(day, between(0, 1)) : addDays(day, between(3, 5));
    if (fuelDay <= day && !away(day)) { fuelDay = addDays(day, between(6, 9));
      const station = chance(0.65) ? 'Northgate Fuel' : 'Ridgeline Gas';
      held(story('fuel'), local(day, S.MERCHANTS[station].hours[0]), station, 15000, centsIn(32, 68), 1);
    }
    if (away(day)) continue;
    const store = () => chance(0.7) ? 'Greenway Market' : 'Fairfield Grocers';
    if (day === groceryPlan) simple('groceries', day, store());
    if (wd >= 2 && wd <= 4 && chance(0.1)) simple('groceries', day, store(), centsIn(45, 80));
    if (wd >= 1 && wd <= 5 ? chance(0.45) : chance(0.15)) purchase(story('coffee'), local(day, wd >= 1 && wd <= 5 ? ['07:00', '09:30'] : ['08:30', '11:00']), 'Copperleaf Coffee', centsIn(3.75, 8.4));
    if (wd >= 2 && wd <= 4 && !HOLIDAYS.has(day) && chance(0.8)) purchase(story('transit'), local(day, ['07:15', '09:00']), 'Bayline Transit', 580);
    const yearEnd = day >= YEAR_END;
    if (wd >= 1 && wd <= 5 && chance(0.22) && !yearEnd) dine(story('dining'), day, pick(['Harbor Lane Bistro', 'Corner Slice', 'Juniper Noodle House']), 'lunch');
    if ((wd === 5 || wd === 6 ? chance(0.3) : chance(0.1)) && !yearEnd) dine(story('dining'), day, pick(['Harbor Lane Bistro', 'Corner Slice', 'Juniper Noodle House']), 'dinner');
    if (wd === 5 || wd === 6 ? chance(0.25) : chance(0.03)) purchase(story('rideshare'), local(day, ['19:00', '23:30']), 'Lumen Rides', centsIn(9, 34));
    if (chance(0.04)) simple('errands', day, 'Tidewater Pharmacy');
    if (chance(0.02)) simple('errands', day, 'Quillstone Books');
    if (chance(0.035)) simple('errands', day, 'Barkley Pet Supply');
    if (wd % 6 === 0 && chance(0.1)) simple('errands', day, 'Fernhill Hardware');
    if (chance(0.1)) simple('online', day, chance(0.55) ? 'Parcelbox Online' : 'Brightcart');
  }
  // Over New Year the restaurants close their batches late, so the bills of 30 and 31 December are still on hold at the clock.
  dine(story('dining'), YEAR_END, 'Juniper Noodle House', 'lunch', 3);
  dine(story('dining'), '2026-12-31', 'Harbor Lane Bistro', 'dinner', 1);
}

// Subscriptions: one story for each, with its fixed day, price and time. Two charges belong to dispute stories instead.
const TAKEN = {'Ironworks Gym': ['2025-10-02'], 'Reelhouse Plus': ['2026-03-09']};
const LAST_CHARGE = {'Reelhouse Plus': '2026-03-09'};
function subscriptions() {
  for (const [merchant, m] of Object.entries(S.MERCHANTS).filter(([, m]) => m.template === 'subscription')) {
    const s = story('subscription', {merchant});
    for (let month = '2024-12'; month <= '2026-12'; month = time.addDays(month + '-28', 5).slice(0, 7)) {
      const day = month + '-' + pad(m.day, 2);
      if (day < FIRST_DAY || (LAST_CHARGE[merchant] && day >= LAST_CHARGE[merchant]) || (TAKEN[merchant] || []).includes(day)) continue;
      direct(s, day + ' ' + m.hours[0][0], merchant, Math.round(m.prices.filter(([from]) => from <= day).pop()[1] * 100));
    }
  }
}

// The monthly cycle: the statement and its autopay payment, then the points earned in the cycle.
const closingOf = month => month + '-' + A.closing_day + ' 23:59:59';
const nextMonth = month => time.addDays(month + '-28', 5).slice(0, 7);
const statementId = month => 'stm-' + month;
const CYCLES = [];
for (let month = '2024-12'; month <= '2026-12'; month = nextMonth(month)) CYCLES.push(month);
const previousClosing = month => month === CYCLES[0] ? -Infinity : ms(at(closingOf(CYCLES[CYCLES.indexOf(month) - 1])));
const inCycle = (month, value) => value !== null && ms(value) > previousClosing(month) && ms(value) <= ms(at(closingOf(month)));
function cycles() {
  for (const month of CYCLES) {
    const s = story('cycle', {statement_id: statementId(month)}), closing = at(closingOf(month)), issued = month + '-28 02:00';
    s.event(issued, 'statement.issued', data => {
      const balance = views.balance(data, ms(at(issued)), ms(closing));
      const charges = data.transactions.filter(tx => (tx.kind === 'fee' || tx.kind === 'interest') && tx.state === 'posted' && inCycle(month, tx.posted_at));
      const minimum = S.minimumCents(balance, charges.reduce((n, tx) => n + Math.round(tx.amount * 100), 0));
      return {statement_id: statementId(month), closing_at: closing, statement_balance: amount(balance), minimum_due: amount(minimum),
        due_at: at(nextMonth(month) + '-' + A.due_day + ' 17:00')};
    });
    s.event(addDays(month + '-28', 1) + ' 04:00', 'points.adjusted', data => ({entry_id: key('p'), reason: 'earned', points: earned(data, month),
      note: 'Points for the purchases of the statement ' + statementId(month)}));
  }
}
// Net purchases of the cycle by category: purchases posted in the cycle, less the merchant refunds posted in the cycle.
function earned(data, month) {
  const sums = {double: 0, single: 0}, byId = new Map(data.transactions.map(tx => [tx.id, tx]));
  const add = (merchant, cents) => { sums[S.DOUBLE.has(S.MERCHANTS[merchant].category) ? 'double' : 'single'] += cents; };
  for (const tx of data.transactions) {
    if (tx.state !== 'posted' || !inCycle(month, tx.posted_at)) continue;
    if (tx.kind === 'purchase') add(tx.merchant, Math.round(tx.amount * 100));
    if (tx.kind === 'refund') add(byId.get(tx.relates_to).merchant, -Math.round(tx.amount * 100));
  }
  return S.earnedPoints(sums.double, sums.single);
}
// Interest at 23:00 on the closing day after a statement that was not paid in full by its due time.
function interest(s, month) {
  const next = nextMonth(month);
  s.event(next + '-' + A.closing_day + ' 23:00', 'transaction.posted', data => {
    const statement = data.statements.find(x => x.id === statementId(month)), amounts = views.postedAmounts(data);
    const paid = data.payments.filter(p => p.stored_state === 'scheduled' && ms(p.posts_at) > ms(statement.closing_at) && ms(p.posts_at) <= ms(statement.due_at))
      .reduce((n, p) => n + amounts.get(p.id), 0);
    const unpaid = Math.round(statement.statement_balance * 100) - paid;
    return {transaction_id: key('t'), kind: 'interest', state: 'posted', amount: amount(S.interestCents(unpaid)),
      note: 'Interest on ' + text(unpaid) + ' of the statement ' + statement.id + ' that was not paid by its due time'};
  });
}

// The account story and the payment stories.
const ACCOUNT_ID = A.id;
function payments() {
  story('account', {}).call('2025-02-09 19:45', 'preferences.update', {email_notices: true});
  story('opening_payment', {statement_id: 'stm-2024-12'})
    .call('2025-01-14 19:30', 'payments.schedule', {id: ACCOUNT_ID, amount_type: 'statement_balance', pay_on: '2025-01-16', source: S.BANKS.old})
    .call('2025-01-20 20:10', 'autopay.set', {id: ACCOUNT_ID, mode: 'statement_balance', source: S.BANKS.old});
  // Before the summer 2025 trip Riley pays the June statement in full, so its autopay payment has nothing left and reads skipped.
  story('trip_prepay', {statement_id: 'stm-2025-06'}).call('2025-07-08 20:00', 'payments.schedule', {id: ACCOUNT_ID, amount_type: 'statement_balance', pay_on: '2025-07-08', source: S.BANKS.old});
  // The old bank account closed, and the autopay payment of 22 August comes back. A fee posts the day after, and Riley pays from the new bank.
  const bank = story('bank_change', {statement_id: 'stm-2025-07', old_source: S.BANKS.old, new_source: S.BANKS.new, changed_at: at('2025-08-27 19:20')});
  bank.event('2025-08-25 10:15', 'payment.returned', data => ({payment_id: data.statements.find(x => x.id === 'stm-2025-07').autopay_payment_id, reason: S.RETURN_REASON}));
  bank.event('2025-08-26 03:40', 'transaction.posted', data => ({transaction_id: key('t'), kind: 'fee', fee_type: 'other', state: 'posted', amount: A.returned_payment_fee,
    note: 'Returned payment fee for the payment ' + data.statements.find(x => x.id === 'stm-2025-07').autopay_payment_id}));
  bank.call('2025-08-27 19:20', 'payments.schedule', {id: ACCOUNT_ID, amount_type: 'statement_balance', pay_on: '2025-08-27', source: S.BANKS.new});
  bank.call('2025-08-27 19:26', 'autopay.set', {id: ACCOUNT_ID, mode: 'statement_balance', source: S.BANKS.new});
  interest(bank, '2025-07');
  // A payment scheduled twice by mistake: the copy is cancelled the same evening.
  // Riley pays down about a third of the balance, in steps of 50.00, so both copies fit under the balance.
  const third = data => ({id: ACCOUNT_ID, amount_type: 'fixed', amount: Math.max(50, 50 * Math.floor(views.balance(data, ms(at('2025-10-24 20:05'))) / 15000)), pay_on: '2025-10-27', source: S.BANKS.new});
  story('duplicate_cancel', {})
    .call('2025-10-24 20:05', 'payments.schedule', third)
    .call('2025-10-24 20:06', 'payments.schedule', third, 'copy')
    .call('2025-10-24 20:31', 'payments.cancel', {id: '@copy'});
  // A large car repair: autopay pays only the minimum for two cycles, two payments by hand after each due day, and interest on what was left.
  const car = story('car_repair', {statements: ['stm-2026-04', 'stm-2026-05']});
  const repairDay = '2026-04-08';
  purchase(car, local(repairDay, ['15:00', '17:00']), 'Hollis Auto Repair', centsIn(2400, 3200), 1, 'Brake and suspension repair');
  car.call('2026-04-19 20:30', 'autopay.set', {id: ACCOUNT_ID, mode: 'minimum_due'})
    .call('2026-05-25 19:10', 'payments.schedule', {id: ACCOUNT_ID, amount_type: 'fixed', amount: 1500, pay_on: '2026-05-26', source: S.BANKS.new});
  interest(car, '2026-04');
  car.call('2026-06-23 19:40', 'payments.schedule', {id: ACCOUNT_ID, amount_type: 'fixed', amount: 2000, pay_on: '2026-06-24', source: S.BANKS.new})
    .call('2026-06-24 20:00', 'autopay.set', {id: ACCOUNT_ID, mode: 'statement_balance'});
  interest(car, '2026-05');
  // The annual fee, on the anniversary from the second year on.
  for (const year of [2025, 2026]) {
    const day = year + '-' + A.fee_day;
    story('annual_fee', {year}).event(batch(day), 'transaction.posted', {transaction_id: key('t'), kind: 'fee', fee_type: 'annual', state: 'posted', amount: A.annual_fee,
      note: 'Annual fee for the card year from ' + words(day) + ' ' + year});
  }
  for (const r of S.REDEMPTIONS) story('redeem', {points: r.points}).call(r.at, 'rewards.redeem', {id: ACCOUNT_ID, points: r.points});
}

// Trips: the flight bought weeks ahead, a transfer of points, the hotel hold and final charge, and dining and transit at the destination.
function trips() {
  for (const t of S.TRIPS) {
    const nights = time.dayNumber(t.to) - time.dayNumber(t.from), rate = between(149, 239) * 100, pays = t.transfer ? t.transfer.pays : null;
    const pointsNights = pays === 'night' ? 1 : 0, paid = nights - pointsNights, charged = t.dispute ? nights + 1 : paid;
    const s = story('trip', {trip: t.key, from: t.from, to: t.to, nights, rate: amount(rate), hotel: t.hotel, points_nights: pointsNights, charged_nights: charged,
      award_flight: pays === 'flight', dispute: t.dispute || null});
    const booked = addDays(t.from, -between(28, 70)), transfer = when => s.call(when, 'rewards.transfer', {id: ACCOUNT_ID, partner_id: t.transfer.partner_id, points: t.transfer.points,
      member_name: A.member_name});
    if (pays === 'flight') {
      transfer(local(booked, ['18:30', '19:30']));
      purchase(s, local(booked, ['19:40', '22:30']), t.airline, centsIn(...S.AWARD.fees), 1, S.AWARD.flight_note);
    } else purchase(s, local(booked, ['18:30', '22:30']), t.airline, centsIn(240, 720));
    if (pays === 'night') transfer(evening(addDays(t.from, -between(14, 24))));
    purchase(s, local(t.from, ['07:00', '09:00']), S.TRIP_PLACES.ride, centsIn(24, 34));
    const checkIn = local(t.from, S.MERCHANTS[t.hotel].hours[0]), checkOut = local(t.to, S.HOTEL_CHECKOUT), hold = key('t');
    s.event(checkIn, 'transaction.posted', {transaction_id: hold, kind: 'purchase', state: 'pending', amount: amount(paid * rate + 10000), merchant: t.hotel,
      note: 'Hold for ' + paid + ' nights at ' + text(rate) + ' and 100.00 for extras'});
    s.event(checkOut, 'transaction.dropped', {transaction_id: hold, reason: 'Hold released at checkout on ' + words(t.to)});
    const final = purchase(s, checkOut, t.hotel, charged * rate, 1, pointsNights ? S.fill(S.AWARD.night_note, {paid, rate: text(rate)}) : charged + ' nights at ' + text(rate));
    for (let day = t.from; day <= t.to; day = addDays(day, 1)) {
      if (day !== t.from && chance(0.6)) dine(s, day, pick(S.TRIP_PLACES.dining), 'lunch');
      if (day !== t.to && chance(0.9)) dine(s, day, pick(S.TRIP_PLACES.dining), 'dinner');
      for (let n = between(1, 2); n > 0; n--) purchase(s, local(day, ['09:00', '17:00']), S.TRIP_PLACES.transit, centsIn(2.75, 8.25));
    }
    purchase(s, local(t.to, ['16:00', '22:00']), S.TRIP_PLACES.ride, centsIn(24, 34));
    if (t.dispute) {
      const d = S.DISPUTES.wrong_amount, opened = evening(addDays(t.to, between(4, 7))), credit = decision(addBusiness(opened.slice(0, 10), between(2, 10)));
      const values = {merchant: t.hotel, charged, nights, from: words(t.from), to: words(t.to), rate: text(rate)};
      s.facts.trigger = at(checkOut);
      s.call(opened, 'disputes.open', {id: final, amount: amount(rate), reason: d.reason, note: S.fill(d.note, values)}, 'hotel');
      s.event(credit, 'dispute.updated', {dispute_id: '@hotel', status: 'open', provisional_credit: {transaction_id: key('t'), amount: amount(rate)}, note: d.credit});
      s.event(decision(addDays(credit.slice(0, 10), between(20, 50))), 'dispute.updated', {dispute_id: '@hotel', status: 'resolved_for_me', note: S.fill(d.end, values)});
    }
  }
}

// Returns and refunds: a full return, one returned item of an order, and a flight that the airline cancelled.
function returns() {
  for (const month of ['2025-04', '2025-08', '2026-01', '2026-10']) {
    const s = story('online_return'), merchant = pick(['Parcelbox Online', 'Brightcart']), day = month + '-' + pad(between(3, 20), 2), cents = centsIn(40, 240);
    const order = purchase(s, merchantTime(day, merchant), merchant, cents);
    refund(s, local(addDays(day, between(5, 20)), ['10:00', '16:00']), merchant, cents, order, S.fill(S.REFUNDS.full_return, {day: words(day)}));
  }
  for (const month of ['2025-06', '2025-11', '2026-05']) {
    const items = Array.from({length: between(2, 4)}, () => centsIn(12, 60)), merchant = pick(['Parcelbox Online', 'Brightcart']), day = month + '-' + pad(between(3, 20), 2);
    const s = story('online_partial', {items: items.map(amount)}), back = pick(items);
    const order = purchase(s, merchantTime(day, merchant), merchant, items.reduce((a, b) => a + b, 0));
    refund(s, local(addDays(day, between(4, 15)), ['10:00', '16:00']), merchant, back, order, S.fill(S.REFUNDS.partial_return, {day: words(day)}));
  }
  const booked = '2026-01-' + pad(between(20, 25), 2), flight = '2026-03-20', cancelled = '2026-02-' + pad(between(10, 20), 2);
  const s = story('cancelled_flight', {flight_day: flight, cancelled_on: cancelled}), cents = centsIn(240, 720);
  const ticket = purchase(s, local(booked, ['18:30', '22:30']), 'Bluecrest Airlines', cents);
  refund(s, local(addDays(cancelled, between(3, 10)), ['10:00', '16:00']), 'Bluecrest Airlines', cents, ticket, S.fill(S.REFUNDS.flight, {day: words(flight)}));
}

// The disputes, each with its purchase. The temporary credit comes 2 to 10 business days after opening, and the end within 90 days.
function disputes() {
  const credit = opened => decision(addBusiness(opened.slice(0, 10), between(2, 10)));
  const open = (s, when, id, cents, d, values, label) => s.call(when, 'disputes.open', {id, amount: amount(cents), reason: d.reason, note: S.fill(d.note, values)}, label);
  const update = (s, when, label, status, note, extra = {}) => s.event(when, 'dispute.updated', {dispute_id: '@' + label, status, ...extra, ...(note ? {note} : {})});
  // 1 and 8: an order that never arrived.
  for (const [template, merchant, orderDay, promisedDays, openedOn, creditOn] of [
    ['not_received', 'Brightcart', '2025-03-' + pad(between(3, 14), 2), between(5, 7), null, null],
    ['not_received_open', 'Parcelbox Online', '2026-11-27', 7, '2026-12-14', '2026-12-18']]) {
    const d = S.DISPUTES[template], cents = centsIn(60, 180), promised = addDays(orderDay, promisedDays);
    const s = story('dispute_' + template, {promised_by: promised});
    const order = purchase(s, local(orderDay, ['08:00', '22:00']), merchant, cents);
    const opened = evening(openedOn || addDays(promised, between(8, 14))), label = 'd-' + template;
    s.facts.trigger = at(promised + ' 23:59:59');
    open(s, opened, order, cents, d, {order: words(orderDay), merchant, promised: words(promised)}, label);
    const credited = creditOn ? local(creditOn, S.HOURS.issuer) : credit(opened);
    update(s, credited, label, 'open', d.credit, {provisional_credit: {transaction_id: key('t'), amount: amount(cents)}});
    if (d.end) update(s, decision(addDays(credited.slice(0, 10), between(20, 50))), label, d.path, d.end);
  }
  // 2: a dinner charged twice. The restaurant refunds the copy two days later, and Riley withdraws the dispute that evening.
  {
    const d = S.DISPUTES.duplicate_charge, merchant = 'Corner Slice', day = pick(['2025-05-02', '2025-05-09', '2025-05-16']), bill = centsIn(...S.DINNER);
    const first = local(day, ['18:00', '21:29']), second = first.slice(0, 11) + hhmm(minutes(first.slice(11)) + 1), final = tipped(bill, merchant), lag = between(1, 2);
    const s = story('dispute_duplicate_charge', {copy_of: null});
    const one = key('t'), copy = key('t'), post = batch(addDays(day, lag)), post2 = post.slice(0, 11) + hhmm(minutes(post.slice(11)) + 1);
    s.facts.copy_of = one;
    for (const [id, when, posted] of [[one, first, post], [copy, second, post2]]) {
      s.event(when, 'transaction.posted', {transaction_id: id, kind: 'purchase', state: 'pending', amount: amount(bill), merchant});
      s.event(posted, 'transaction.posted', {transaction_id: id, kind: 'purchase', state: 'posted', amount: amount(final), merchant});
      plan.purchases.push({id, posted: ms(at(posted)), cents: final, merchant});
    }
    const opened = evening(addDays(post.slice(0, 10), between(1, 3)));
    s.facts.trigger = at(post2);
    open(s, opened, copy, final, d, {merchant, day: words(day)}, 'dup');
    const back = refund(s, local(addDays(opened.slice(0, 10), 1), ['10:00', '16:00']), merchant, final, copy, S.fill(S.REFUNDS.duplicate, {day: words(day)}));
    s.call(evening(back.post.slice(0, 10)), 'disputes.withdraw', {id: '@dup', note: S.fill(d.withdraw, {merchant})});
  }
  // 4: a laptop sold as new that arrived refurbished. The merchant wins, and the issuer takes the credit back.
  {
    const d = S.DISPUTES.not_as_described, merchant = 'Voltage Row Electronics', day = '2026-01-' + pad(between(10, 20), 2), cents = centsIn(780, 1150);
    const delivered = addDays(day, between(3, 5)), s = story('dispute_not_as_described', {delivered_on: delivered, trigger: at(delivered + ' 18:00')});
    const order = purchase(s, local(day, ['10:00', '20:00']), merchant, cents);
    const opened = evening(addDays(delivered, between(3, 10)));
    open(s, opened, order, cents, d, {merchant}, 'laptop');
    const credited = credit(opened);
    update(s, credited, 'laptop', 'open', d.credit, {provisional_credit: {transaction_id: key('t'), amount: amount(cents)}});
    update(s, decision(addDays(credited.slice(0, 10), between(25, 60))), 'laptop', 'resolved_for_merchant', d.end, {reversal: {transaction_id: key('t'), amount: amount(cents)}});
  }
  // 5: the gym fee of a frozen month. The gym refunds 20.00, Riley disputes the rest, the gym then refunds the rest, and the issuer closes it as matched.
  {
    const d = S.DISPUTES.credit_not_processed, merchant = 'Ironworks Gym', day = '2025-10-02', s = story('dispute_credit_not_processed', {frozen_month: '2025-10'});
    const fee = direct(s, day + ' 05:10', merchant, 6000);
    const first = refund(s, local('2025-10-0' + between(7, 9), ['10:00', '16:00']), merchant, 2000, fee, S.fill(S.REFUNDS.gym_first, {day: words(day)}));
    s.facts.trigger = at(first.post);
    const opened = evening('2025-10-' + between(14, 17));
    open(s, opened, fee, 4000, d, {month: 'October', merchant, day: words(day), first: '20.00'}, 'gym');
    const credited = credit(opened);
    update(s, credited, 'gym', 'open', d.credit, {provisional_credit: {transaction_id: key('t'), amount: 40}});
    const rest = refund(s, local(onBusiness(addDays(credited.slice(0, 10), between(3, 6))), ['10:00', '16:00']), merchant, 4000, fee, S.fill(S.REFUNDS.gym_rest, {day: words(day)}));
    update(s, decision(addBusiness(rest.post.slice(0, 10), between(3, 8))), 'gym', 'closed_matched', S.fill(d.end, {merchant}), {reversal: {transaction_id: key('t'), amount: 40}});
  }
  // 6: a charge Riley did not recognize. Riley finds it later and withdraws, and the issuer posts the reversal a few days after.
  {
    const d = S.DISPUTES.not_recognized, merchant = 'NVL*Ostrander Digital', day = '2026-02-14', s = story('dispute_not_recognized', {trigger: at(day + ' 04:20')});
    const charge = direct(s, day + ' 04:20', merchant, 12900);
    const opened = evening(addDays(day, between(2, 6)));
    open(s, opened, charge, 12900, d, {amount: '129.00', merchant, day: words(day)}, 'nvl');
    const credited = credit(opened);
    update(s, credited, 'nvl', 'open', d.credit, {provisional_credit: {transaction_id: key('t'), amount: 129}});
    const withdrawn = evening(addDays(credited.slice(0, 10), between(3, 8)));
    s.call(withdrawn, 'disputes.withdraw', {id: '@nvl', note: d.withdraw});
    s.event(batch(addDays(withdrawn.slice(0, 10), between(3, 8))), 'transaction.posted', {transaction_id: key('t'), kind: 'reversal', state: 'posted', amount: 129, dispute_id: '@nvl', note: d.reversal});
  }
  // 7: a streaming plan that charged after Riley cancelled it.
  {
    const d = S.DISPUTES.cancelled_recurring, merchant = 'Reelhouse Plus', day = '2026-03-09', cancelled = '2026-02-20';
    const s = story('dispute_cancelled_recurring', {cancelled_on: cancelled, trigger: at(day + ' 03:50')});
    const charge = direct(s, day + ' 03:50', merchant, 1199);
    const opened = evening(addDays(day, between(1, 4)));
    open(s, opened, charge, 1199, d, {merchant, cancelled: words(cancelled, 2026) + ' 2026', amount: '11.99', day: words(day)}, 'reel');
    const credited = credit(opened);
    update(s, credited, 'reel', 'open', d.credit, {provisional_credit: {transaction_id: key('t'), amount: 11.99}});
    update(s, decision(addDays(credited.slice(0, 10), between(15, 45))), 'reel', 'resolved_for_me', d.end);
  }
}

// Spending toward an offer, from the planned postings: purchases posted from `from` to the deadline, less the refunds of those purchases before it.
function progress(from, deadline, skip = new Set()) {
  const counted = plan.purchases.filter(p => p.posted >= from && p.posted < deadline && !skip.has(p.id)), ids = new Set(counted.map(p => p.id));
  const steps = [...counted.map(p => [p.posted, p.cents]), ...plan.refunds.filter(r => ids.has(r.relates) && r.posted < deadline).map(r => [r.posted, -r.cents])];
  return steps.sort((a, b) => a[0] - b[0]);
}
const deadlineOf = (enrolled, days) => time.limitEnd(dayOf(enrolled), days, ZONE);

// The 16 offers, each with its answer and payout. The two spending offers read the planned spending of their window.
function offers() {
  const groups = new Map();
  for (const o of S.OFFERS) {
    const s = o.group ? groups.get(o.group) || story('offer_group', {group: o.group, offers: []}) : story('offer', {offer: o.key, outcome: o.outcome});
    if (o.group) { groups.set(o.group, s); s.facts.offers.push({offer: o.key, outcome: o.outcome}); }
    const id = key('o'), fields = {statement_credit: ['credit_amount'], spend_credit: ['credit_amount', 'spend_target', 'spend_days'], bonus_points: ['points'], product_change: ['product_id']}[o.kind];
    let terms = o.terms, target = o.spend_target;
    if (o.key === 'fall-spend') {
      // Riley buys a television in this window and returns it before the deadline. The target needs the television, so the offer ends missed.
      const enrolled = at(o.answer[1]), deadline = deadlineOf(enrolled, o.spend_days), tvDay = '2025-09-20', tv = centsIn(900, 1400);
      const usual = progress(ms(enrolled), deadline).reduce((n, [, c]) => n + c, 0);
      target = 25000 * Math.ceil((usual + tv / 2) / 25000);
      terms = S.fill(o.terms, {target: text(target)});
      s.facts.usual_spending = amount(usual);
      const set = purchase(s, local(tvDay, ['12:00', '17:00']), 'Voltage Row Electronics', tv, 1, 'Television, 55 inch');
      refund(s, local('2025-10-04', ['11:00', '15:00']), 'Voltage Row Electronics', tv, set, S.fill(S.REFUNDS.television, {day: words(tvDay)}));
      target = amount(target);
    }
    const values = {spend_target: target, credit_amount: o.credit_amount, spend_days: o.spend_days, points: o.points, product_id: o.product_id};
    s.event(o.issued, 'offer.issued', {offer_id: id, kind: o.kind, ...(o.group ? {group: o.group} : {}), terms, accept_by: at(o.accept_by + ' 23:59:59'),
      ...Object.fromEntries(fields.map(f => [f, values[f]]))});
    if (!o.answer) continue;
    s.call(o.answer[1], o.answer[0] === 'accept' ? 'offers.accept' : 'offers.decline', {id});
    if (o.outcome !== 'paid') continue;
    const accepted = at(o.answer[1]);
    let paidOn;
    if (o.kind === 'spend_credit') {
      let total = 0;
      const met = progress(ms(accepted), deadlineOf(accepted, o.spend_days)).find(([, c]) => (total += c) >= o.spend_target * 100);
      assert.ok(met, o.key + ' never reaches its target');
      s.facts.met_at = time.iso(met[0], ZONE);
      paidOn = addDays(dayOf(s.facts.met_at), between(...S.PAYOUT_DAYS.spend_credit));
    } else paidOn = addDays(o.answer[1].slice(0, 10), between(...S.PAYOUT_DAYS[o.kind]));
    if (o.kind === 'bonus_points') {
      s.event(paidOn + ' 04:00', 'points.adjusted', {entry_id: key('p'), points: o.points, reason: 'bonus', offer_id: id, note: o.payout_note});
    } else {
      s.event(batch(paidOn), 'transaction.posted', {transaction_id: key('t'), kind: 'credit', state: 'posted', amount: o.credit_amount, offer_id: id, note: o.payout_note});
    }
  }
}

everyday();
subscriptions();
trips();
returns();
disputes();
cycles();
payments();
offers();
// Every step in time order. Steps at the same time keep the order of their story. Nothing after the clock is part of the history.
const STEPS = stories.flatMap(s => s.steps).map((step, n) => ({...step, n})).filter(step => ms(step.at) < ms(CLOCK)).sort((a, b) => ms(a.at) - ms(b.at) || a.n - b.n);

const BASE = {
  account_id: A.id, owner_person_id: A.owner,
  issuer: {name: 'Brindle Card', timezone: ZONE, rules: {dispute_window_days: 60, fee_refund_days: 30, redeem_cents_per_point: 1, min_redeem_points: 1000}},
  products: [
    {id: 'prd-reserve', name: 'Brindle Reserve', annual_fee: A.annual_fee, partners: [
      {id: 'skyway', name: 'Skyway Miles', ratio: 1, min_points: 1000, step: 1000},
      {id: 'larch', name: 'Larch Hotels Rewards', ratio: 2, min_points: 1000, step: 1000},
      {id: 'meridian', name: 'Meridian Rail Club', ratio: 1, min_points: 2000, step: 500}]},
    {id: 'prd-everyday', name: 'Brindle Everyday', annual_fee: null, partners: []}],
  account: {product_id: 'prd-reserve', credit_limit: A.credit_limit, state: 'open', opened_at: A.opened_at, closed_at: null,
    autopay: {mode: 'off', source: S.BANKS.old}, fee_refunds: [], history: []},
  preferences: {timezone: ZONE, email_notices: false},
  statements: [], transactions: [], payments: [], disputes: [], offers: [], points_entries: [], notifications: [], activity: []
};
const schemaDir = path.join(ROOT, 'schemas');
const eventValid = compile(require('../schemas/events.schema.json'), schemaDir);
const inputs = new Map(require('../tools.json').map(t => [t.name, compile(t.inputSchema, ROOT)]));
const PREFIX = {t: 'txn-', o: 'off-', p: 'pts-'};

// The replay: every step strictly before `until`. `keepAt` times get a copy of the data as of that time, from the same pass.
function replay({until = CLOCK, keepAt = []} = {}) {
  const limit = ms(until), keep = [...keepAt].sort((a, b) => ms(a) - ms(b)), snapshots = {}, checks = MONTH_STARTS.slice();
  let data = structuredClone(BASE), events = 0, writes = 0;
  const ids = new Map(), labels = new Map(), counters = {t: 0, o: 0, p: 0}, owners = new Map(), first = new Map();
  const resolve = value => {
    if (typeof value === 'string' && value.startsWith('@')) return labels.get(value.slice(1)) || assert.fail('Unknown label ' + value);
    if (typeof value === 'string' && /^#[top]:\d+$/.test(value)) {
      if (!ids.has(value)) ids.set(value, PREFIX[value[1]] + pad(++counters[value[1]]));
      return ids.get(value);
    }
    if (Array.isArray(value)) return value.map(resolve);
    return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v)])) : value;
  };
  const before = t => { while (keep.length && ms(keep[0]) <= t) snapshots[keep.shift()] = structuredClone(data);
    while (checks.length && ms(checks[0]) <= t && ms(checks[0]) <= limit) check(data, checks.shift(), 'the month start'); };
  for (const step of STEPS) {
    const t = ms(step.at);
    if (t >= limit) break;
    before(t);
    const lengths = RECORDS.map(k => data[k].length), value = x => resolve(typeof x === 'function' ? x(data, resolve) : x);
    try {
      if (step.event) {
        const event = {event_id: 'ev-br-' + pad(++events, 5), at: step.at, operation: APP + '.' + step.event, payload: value(step.payload)};
        assert.ok(eventValid(event), 'Event schema ' + JSON.stringify(eventValid.errors || ''));
        // applyEvent runs the seed rules after every event, and fails the event when one breaks.
        data = plugin.applyEvent(ctxAt(step.at, 'infra'), data, event);
      } else {
        const name = APP + '.' + step.call, args = {...value(step.args), expected_version: {epoch: 1, revision: events + writes}, request_id: 'req-riley-' + pad(++writes)};
        assert.ok(inputs.get(name)(args), 'Input schema of ' + name);
        const out = plugin.handleTool(ctxAt(step.at), data, name, args);
        data = out.data;
        plugin.validateSeed(ctxAt(step.at), data);
        if (step.label) labels.set(step.label, out.result.id);
      }
    } catch (error) { error.message = step.story.template + ' ' + (step.call || step.event) + ' at ' + step.at + ': ' + error.message; throw error; }
    RECORDS.forEach((k, i) => data[k].slice(lengths[i]).forEach(record => owners.set(record.id, step.story)));
    if (!first.has(step.story)) first.set(step.story, t);
  }
  before(limit);
  for (const t of keep) snapshots[t] = structuredClone(data);
  check(data, until, 'the end');
  return {data, snapshots, owners, first, ids, counts: {steps: events + writes, events, writes}};
}

const GENERATION = {method: 'scripted replay of story templates with a seeded PRNG (mulberry32)', tool: 'apps/brindle/dev/generate-dataset.cjs', tool_version: VERSION, seed: PRNG_SEED,
  parameters: {start: START, clock: CLOCK, timezone: ZONE}};
// The provenance record that a task passes to env.load_seed with this seed.
function dataset(data) {
  return {schema_version: 'pale.dataset.v1', dataset_id: 'brindle-evaluation-2025-2026', version: VERSION,
    description: 'Synthetic delivery dataset of one cardholder account at a fictional card issuer: the account opened on 2 December 2024, and the history runs to ' + CLOCK + '. ' +
      'Every record is synthetic: the issuer, the cardholder, the merchants, the banks and the loyalty programs are fictional, and nothing was collected. ' +
      'A development script builds stories from fixed templates with a seeded PRNG and replays every step through the App\'s own hooks, so the App made every payment, dispute, redemption and notification.',
    record_source_ids: ['evaluation-generator'],
    sources: [{source_id: 'evaluation-generator', kind: 'synthetic',
      description: 'Scripted synthetic card account history from story templates with seeded random variation; no external collection and no real person, issuer, merchant, card number, bank or loyalty program. Dates are represented event dates of the fictional history, not collection dates.',
      uri: null, license: 'MIT', usage: 'permitted', collection: null,
      generation: GENERATION}],
    transformations: ['None. The seed is the App state after the replay.'],
    expected_counts: {records: records(data).length, assets: 0},
    quality_policy: {duplicate_records: 'reject', duplicate_assets: 'reject', missing_assets: 'allow_declared'},
    review: {status: 'pending', reviewer: null, notes: 'Automated checks do not replace human review of realism and variation.'}};
}
const json = value => JSON.stringify(value, null, 2) + '\n';
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const fileInfo = (name, value) => ({name, bytes: Buffer.byteLength(value), sha256: sha256(value)});

// The manifest lists every story with its template, its facts and the IDs of its records. One story is one line.
function manifestOf(run, files) {
  const list = stories.filter(s => run.first.has(s)).sort((a, b) => run.first.get(a) - run.first.get(b) || stories.indexOf(a) - stories.indexOf(b));
  const byStory = new Map(list.map(s => [s, []]));
  for (const record of records(run.data)) byStory.get(run.owners.get(record.id)).push(record.id);
  const resolveFacts = facts => JSON.parse(JSON.stringify(facts), (k, v) => typeof v === 'string' && run.ids.has(v) ? run.ids.get(v) : v);
  const rows = list.map((s, i) => ({story_id: 'st-' + pad(i + 1), template: s.template, facts: resolveFacts(s.facts), records: byStory.get(s)}));
  const templates = {};
  for (const row of rows) templates[row.template] = (templates[row.template] || 0) + 1;
  const head = {schema: 'brindle.evaluation-manifest.v1', generator: 'apps/brindle/dev/generate-dataset.cjs', generator_version: VERSION, prng: 'mulberry32', prng_seed: PRNG_SEED,
    start: START, clock: CLOCK, timezone: ZONE, provenance: 'synthetic',
    counts: {...run.counts, records: records(run.data).length, ...Object.fromEntries(RECORDS.map(k => [k, run.data[k].length])), notifications: run.data.notifications.length,
      activity: run.data.activity.length, stories: rows.length, templates},
    files: Object.fromEntries(Object.entries(files).map(([name, value]) => [name, {bytes: Buffer.byteLength(value), sha256: sha256(value)}])), stories: '@'};
  return json(head).replace('"stories": "@"', '"stories": [\n' + rows.map(r => '    ' + JSON.stringify(r)).join(',\n') + '\n  ]');
}

function generate({keepAt = []} = {}) {
  const run = replay({keepAt});
  const files = {'seed.json': JSON.stringify(run.data) + '\n', 'clock.json': json({initial_time: CLOCK}), 'dataset.json': json(dataset(run.data))};
  const manifestText = manifestOf(run, files);
  return {seed: run.data, manifest: JSON.parse(manifestText), snapshots: run.snapshots, files: {...files, 'manifest.json': manifestText}, counts: run.counts};
}
// The seed as of a time: only the steps strictly before it.
const build = (until = CLOCK) => replay({until}).data;

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
const declared = files => ({...GENERATION, parameters: {...GENERATION.parameters,
  files: ['seed.json', 'clock.json', 'dataset.json'].map(name => fileInfo('data/evaluation/' + name, files[name]))}});
function contributionStale(files) {
  const doc = JSON.parse(fs.readFileSync(CONTRIBUTION, 'utf8')), source = doc.sources.find(s => s.source_id === 'evaluation-generator');
  return !source || JSON.stringify(source.generation) !== JSON.stringify(declared(files));
}

function main() {
  const checkMode = process.argv.includes('--check'), started = process.hrtime.bigint();
  const out = generate(), elapsed = Number(process.hrtime.bigint() - started) / 1e6, problems = [];
  const bytes = requestBytes(out.seed, out.files['dataset.json']);
  if (bytes > REQUEST_LIMIT) problems.push('The env.load_seed request is ' + bytes + ' bytes, above the limit of ' + REQUEST_LIMIT + '.');
  if (elapsed > TIME_LIMIT_MS) problems.push('The replay took ' + Math.round(elapsed) + ' ms, above the limit of ' + TIME_LIMIT_MS + ' ms.');
  const rules = require('./check-evaluation.cjs').problems(out.seed, out.manifest);
  if (rules.length) problems.push(rules.length + ' story rules are broken, first: ' + JSON.stringify(rules[0]));
  const stale = [];
  for (const [name, value] of Object.entries(out.files)) {
    const target = path.join(OUT, name);
    if (checkMode) { if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== value) stale.push(name); } else { fs.mkdirSync(OUT, {recursive: true}); fs.writeFileSync(target, value); }
  }
  if (contributionStale(out.files)) {
    if (checkMode) stale.push('contribution/dataset.json (sources[evaluation-generator].generation)');
    else {
      const raw = fs.readFileSync(CONTRIBUTION, 'utf8'), doc = JSON.parse(raw), source = doc.sources.find(s => s.source_id === 'evaluation-generator');
      if (!source || json(doc) !== raw) problems.push('contribution/dataset.json needs sources[evaluation-generator].generation = ' + JSON.stringify(declared(out.files)));
      else { source.generation = declared(out.files); fs.writeFileSync(CONTRIBUTION, json(doc)); }
    }
  }
  if (stale.length) problems.push('Generated files are out of date: ' + stale.join(', ') + '. Run node apps/brindle/dev/generate-dataset.cjs.');
  const summary = out.counts.steps + ' steps, ' + records(out.seed).length + ' records, ' + Buffer.byteLength(out.files['seed.json']) + ' bytes of seed, ' + bytes +
    ' bytes of env.load_seed request, replay ' + (elapsed / 1000).toFixed(1) + ' s on Node ' + process.versions.node;
  if (problems.length) { problems.forEach(p => console.error(p)); console.error('FAIL (' + summary + ')'); process.exitCode = 1; return; }
  console.log((checkMode ? 'Checked' : 'Wrote') + ' data/evaluation (' + summary + ').');
}
if (require.main === module) main();
module.exports = {generate, build, MONTH_STARTS, CLOCK, START, VERSION, PRNG_SEED, STEPS};
