'use strict';
// Story rules for the delivery dataset: every record must hold together as one story of its template in dev/evaluation-scenarios.cjs.
// `problems(seed, manifest, asOf)` returns one row {story_id, record_id, rule, detail} for each broken rule. `asOf` is the time of the seed
// (default: its latest activity row), so a seed as of an earlier time is checked only for what has happened by then.
// dev/check-fixture.cjs --evaluation runs it on the delivered seed and on the 24 month-start seeds.
const time = require('../src/time.cjs');
const views = require('../src/views.cjs');
const S = require('./evaluation-scenarios.cjs');

const ZONE = 'America/New_York', ms = Date.parse, DAY = 86400000, cents = value => Math.round(value * 100);
const local = value => time.iso(ms(value), ZONE), dayOf = value => local(value).slice(0, 10), hourOf = value => local(value).slice(11, 16);
const days = (from, to) => time.dayNumber(dayOf(to)) - time.dayNumber(dayOf(from));
const within = (value, [from, to]) => hourOf(value) >= from && hourOf(value) <= to;
const HOLIDAYS = new Set(S.HOLIDAYS), business = day => time.weekday(day) % 6 !== 0 && !HOLIDAYS.has(day);
function businessDays(from, to) {
  let n = 0;
  for (let day = time.addDays(dayOf(from), 1); day <= dayOf(to); day = time.addDays(day, 1)) if (business(day)) n++;
  return n;
}
const text = value => (value / 100).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const words = (day, year) => Number(day.slice(8, 10)) + ' ' + MONTHS[Number(day.slice(5, 7)) - 1] + (year && day.slice(0, 4) !== String(year) ? ' ' + day.slice(0, 4) : '');
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A template text as a pattern: known parts must match exactly, the other parts are free.
const pattern = (template, values) => new RegExp('^' + template.split(/(\{\w+\})/).map(part => {
  const name = /^\{(\w+)\}$/.exec(part);
  return name ? (name[1] in values ? escape(String(values[name[1]])) : '.+') : escape(part);
}).join('') + '$');

const RULES = ['story', 'merchant', 'posting', 'refund', 'dispute', 'offer', 'fees', 'statement', 'interest', 'payments', 'points', 'times', 'names', 'notifications'];
// The record kinds that each template makes.
const KINDS = {
  groceries: ['tx:purchase'], fuel: ['tx:purchase'], dining: ['tx:purchase'], coffee: ['tx:purchase'], transit: ['tx:purchase'], rideshare: ['tx:purchase'],
  errands: ['tx:purchase'], online: ['tx:purchase'], subscription: ['tx:purchase'], cycle: ['statement', 'payment', 'points:earned'], account: [],
  trip: ['tx:purchase', 'points:transferred', 'dispute', 'tx:provisional_credit'], online_return: ['tx:purchase', 'tx:refund'], online_partial: ['tx:purchase', 'tx:refund'],
  cancelled_flight: ['tx:purchase', 'tx:refund'], opening_payment: ['payment'], trip_prepay: ['payment'], duplicate_cancel: ['payment'],
  bank_change: ['payment', 'tx:fee', 'tx:interest'], car_repair: ['tx:purchase', 'payment', 'tx:interest'], annual_fee: ['tx:fee'], redeem: ['points:redeemed', 'tx:credit'],
  offer: ['offer', 'tx:purchase', 'tx:refund', 'tx:credit', 'points:bonus'], offer_group: ['offer', 'tx:credit', 'points:bonus'],
  dispute_not_received: ['tx:purchase', 'dispute', 'tx:provisional_credit'], dispute_not_received_open: ['tx:purchase', 'dispute', 'tx:provisional_credit'],
  dispute_duplicate_charge: ['tx:purchase', 'tx:refund', 'dispute'], dispute_not_as_described: ['tx:purchase', 'dispute', 'tx:provisional_credit', 'tx:reversal'],
  dispute_credit_not_processed: ['tx:purchase', 'tx:refund', 'dispute', 'tx:provisional_credit', 'tx:reversal'],
  dispute_not_recognized: ['tx:purchase', 'dispute', 'tx:provisional_credit', 'tx:reversal'], dispute_cancelled_recurring: ['tx:purchase', 'dispute', 'tx:provisional_credit']
};
// The merchant templates that a story template may use.
const SHOPS = {groceries: ['groceries'], fuel: ['fuel'], dining: ['dining'], coffee: ['coffee'], transit: ['transit'], rideshare: ['rideshare'], errands: ['errands'], online: ['online'],
  subscription: ['subscription'], trip: ['flight', 'hotel', 'trip_dining', 'trip_transit', 'rideshare'], online_return: ['online'], online_partial: ['online'], cancelled_flight: ['flight'],
  dispute_not_received: ['online'], dispute_not_received_open: ['online'], dispute_duplicate_charge: ['dining'], dispute_not_as_described: ['electronics'],
  dispute_credit_not_processed: ['subscription'], dispute_not_recognized: ['yearly_plan'], dispute_cancelled_recurring: ['subscription'], offer: ['electronics'], car_repair: ['car_repair']};
const disputeTemplate = (story, facts) => story.template.startsWith('dispute_') ? story.template.slice(8) : facts.dispute;
// The notes that the App writes itself. They are the same in every story, so the note rule leaves them out.
const APP_NOTES = new Set(['Temporary credit during a dispute', 'Temporary credit taken back', 'Points redeemed as a statement credit']);

function problems(seed, manifest, asOf) {
  const out = [], activity = seed.activity;
  const now = ms(asOf || (activity.length ? activity[activity.length - 1].at : manifest.clock));
  const tx = new Map(seed.transactions.map(x => [x.id, x])), offers = new Map(seed.offers.map(o => [o.id, o]));
  const statements = views.ordered(seed), amounts = views.postedAmounts(seed);
  const storyOf = new Map(), rows = manifest.stories;
  const bad = (story, id, rule, detail) => out.push({story_id: story ? story.story_id : null, record_id: id, rule, detail});
  const kindOf = (key, r) => key === 'transactions' ? 'tx:' + r.kind : 'points:' + r.reason;
  const KEYS = [['statements', 'statement'], ['transactions', null], ['payments', 'payment'], ['disputes', 'dispute'], ['offers', 'offer'], ['points_entries', null]];

  // 1. story: every record belongs to exactly one story, and its kind fits the template.
  const listed = new Map();
  for (const story of rows) for (const id of story.records) listed.set(id, (listed.get(id) || []).concat(story));
  for (const [key, label] of KEYS) for (const r of seed[key]) {
    const owners = listed.get(r.id) || [];
    if (owners.length !== 1) { bad(null, r.id, 'story', 'the record is in ' + owners.length + ' stories'); continue; }
    storyOf.set(r.id, owners[0]);
    const kind = label || kindOf(key, r);
    if (!(KINDS[owners[0].template] || []).includes(kind)) bad(owners[0], r.id, 'story', kind + ' does not fit the template ' + owners[0].template);
  }
  const story = id => storyOf.get(id) || null;
  const recordsOf = s => s.records.map(id => tx.get(id)).filter(Boolean);

  // 2 and 3. merchant and posting: each purchase comes from its template, with its day, hour, amount and posting.
  for (const p of seed.transactions.filter(x => x.kind === 'purchase')) {
    const s = story(p.id), m = S.MERCHANTS[p.merchant];
    if (!s) continue;
    if (!m) { bad(s, p.id, 'merchant', 'unknown merchant ' + p.merchant); continue; }
    if (!(SHOPS[s.template] || []).includes(m.template)) bad(s, p.id, 'merchant', p.merchant + ' is not a merchant of the template ' + s.template);
    const hold = p.pending_amount === null ? null : cents(p.pending_amount), value = cents(p.amount), facts = s.facts;
    const hotelFinal = m.template === 'hotel' && p.state !== 'dropped';
    if (!m.days.includes(time.weekday(dayOf(p.transaction_at)))) bad(s, p.id, 'merchant', 'the day ' + dayOf(p.transaction_at) + ' is not a day of ' + p.merchant);
    if (!(hotelFinal ? [S.HOTEL_CHECKOUT] : m.hours).some(range => within(p.transaction_at, range))) bad(s, p.id, 'merchant', 'the hour ' + hourOf(p.transaction_at) + ' is not an hour of ' + p.merchant);
    if (m.template === 'subscription') {
      const day = dayOf(p.transaction_at), price = cents(m.prices.filter(([from]) => from <= day).pop()[1]);
      if (Number(day.slice(8)) !== m.day || value !== price) bad(s, p.id, 'merchant', 'a subscription of ' + p.merchant + ' is ' + text(price) + ' on day ' + m.day + ', not ' + p.amount + ' on ' + day);
    } else if (m.tip) {
      const bill = hold === null ? value : hold, meal = within(p.transaction_at, m.hours[0]) ? S.LUNCH : S.DINNER;
      if (bill < cents(meal[0]) || bill > cents(meal[1])) bad(s, p.id, 'merchant', 'a bill of ' + text(bill) + ' is outside the meal range');
    } else if (m.template === 'fuel') {
      if (p.state === 'posted' && (value < cents(m.low) || value > cents(m.high))) bad(s, p.id, 'merchant', 'a fuel amount of ' + p.amount);
    } else if (m.template === 'hotel') {
      const paid = facts.nights - facts.points_nights, hold = p.state === 'dropped' || p.state === 'pending';
      const expected = hold ? paid * cents(facts.rate) + cents(m.extra) : facts.charged_nights * cents(facts.rate);
      if (value !== expected || cents(facts.rate) < cents(m.low) || cents(facts.rate) > cents(m.high)) bad(s, p.id, 'merchant', 'a hotel amount of ' + p.amount + ' against ' + text(expected));
      const note = hold ? 'Hold for ' + paid + ' nights at ' + text(cents(facts.rate)) + ' and 100.00 for extras'
        : facts.points_nights ? S.fill(S.AWARD.night_note, {paid, rate: text(cents(facts.rate))}) : facts.charged_nights + ' nights at ' + text(cents(facts.rate));
      if (p.note !== note || (!hold && facts.charged_nights !== (facts.dispute ? facts.nights + 1 : paid))) bad(s, p.id, 'merchant', 'the hotel note does not fit: ' + p.note);
    } else if (m.template === 'flight' && s.facts.award_flight) {
      const transfer = seed.points_entries.find(e => s.records.includes(e.id) && e.reason === 'transferred');
      if (value < cents(S.AWARD.fees[0]) || value > cents(S.AWARD.fees[1]) || p.note !== S.AWARD.flight_note) bad(s, p.id, 'merchant', 'an award ticket costs only its taxes and fees');
      if (!transfer || transfer.transfer.partner_id !== 'skyway' || ms(transfer.at) >= ms(p.transaction_at)) bad(s, p.id, 'merchant', 'an award ticket comes after the transfer to Skyway Miles');
    } else if (s.template === 'online_partial') {
      if (value !== facts.items.reduce((n, x) => n + cents(x), 0)) bad(s, p.id, 'merchant', 'the order is not the sum of its items');
    } else if (value < cents(m.low) || value > cents(m.high)) bad(s, p.id, 'merchant', 'the amount ' + p.amount + ' is outside ' + m.low + ' to ' + m.high);

    if (p.state === 'posted') {
      const lag = days(p.transaction_at, p.posted_at);
      if (ms(p.posted_at) < ms(p.transaction_at) || lag > 3) bad(s, p.id, 'posting', 'posted ' + lag + ' days after the purchase');
      if (m.pending && m.template !== 'hotel' && hold === null) bad(s, p.id, 'posting', p.merchant + ' sends a hold first');
      if ((!m.pending || m.template === 'hotel') && hold !== null) bad(s, p.id, 'posting', p.merchant + ' sends no hold');
      if (m.template === 'fuel' && hold !== null && (hold !== cents(m.hold) || value >= hold)) bad(s, p.id, 'posting', 'a fuel hold of ' + text(hold) + ' posts lower');
      if (m.tip && hold !== null && (value - hold < Math.floor(hold * m.tip[0] / 100) || value - hold > Math.ceil(hold * m.tip[1] / 100))) bad(s, p.id, 'posting', 'a tip of ' + text(value - hold) + ' on ' + text(hold));
    }
    if (p.state === 'pending' && !m.pending) bad(s, p.id, 'posting', p.merchant + ' sends no hold');
    if (p.state === 'dropped' || (m.template === 'hotel' && p.state === 'pending')) {
      if (m.template !== 'hotel') { bad(s, p.id, 'posting', 'only a hotel hold is dropped'); continue; }
      if (p.state === 'dropped') {
        const final = recordsOf(s).find(x => x.kind === 'purchase' && x.merchant === p.merchant && x.state !== 'dropped' && x.transaction_at === p.dropped_at);
        if (!final && ms(p.dropped_at) + 2 * DAY <= now) bad(s, p.id, 'posting', 'the dropped hotel hold has no final charge');
        if (!within(p.dropped_at, S.HOTEL_CHECKOUT)) bad(s, p.id, 'times', 'checkout at ' + hourOf(p.dropped_at));
      } else if (ms(p.transaction_at) + (s.facts.nights + 1) * DAY <= now) bad(s, p.id, 'posting', 'the hotel hold was never dropped');
    }
  }

  // 4. refund: names a purchase of the same merchant, posts after it, uses the note of its template, and is never above what is still owed.
  const REFUND_OF = {online_return: ['full_return'], online_partial: ['partial_return'], cancelled_flight: ['flight'], dispute_duplicate_charge: ['duplicate'],
    dispute_credit_not_processed: ['gym_first', 'gym_rest'], offer: ['television']};
  for (const r of seed.transactions.filter(x => x.kind === 'refund')) {
    const s = story(r.id), p = tx.get(r.relates_to);
    if (!s) continue;
    if (!p || p.kind !== 'purchase' || p.merchant !== r.merchant) { bad(s, r.id, 'refund', 'the refund does not name a purchase of ' + r.merchant); continue; }
    if (!s.records.includes(p.id)) bad(s, r.id, 'refund', 'the purchase is in another story');
    if (p.state !== 'posted' || ms(r.posted_at) <= ms(p.posted_at)) bad(s, r.id, 'refund', 'the refund posts before the purchase');
    const day = s.template === 'cancelled_flight' ? s.facts.flight_day : dayOf(p.transaction_at);
    if (!(REFUND_OF[s.template] || []).some(k => r.note === S.fill(S.REFUNDS[k], {day: words(day)}))) bad(s, r.id, 'refund', 'the note does not fit: ' + r.note);
    const refunds = seed.transactions.filter(x => x.kind === 'refund' && x.relates_to === p.id && x.state === 'posted' && ms(x.posted_at) <= ms(r.posted_at));
    const total = refunds.reduce((n, x) => n + cents(x.amount), 0), g = views.groups(seed);
    const credits = (g.disputes.get(p.id) || []).reduce((n, d) => n + ((g.byDispute.get(d.id) || []).filter(x => ms(x.posted_at) <= ms(r.posted_at))
      .reduce((m, x) => m + (x.kind === 'provisional_credit' ? 1 : -1) * cents(x.amount), 0)), 0);
    const matched = s.template === 'dispute_credit_not_processed';
    if (total > cents(p.amount) || (!matched && total + Math.max(0, credits) > cents(p.amount))) bad(s, r.id, 'refund', 'refunds of ' + text(total) + ' are above what is owed on ' + p.amount);
    const gap = days(p.transaction_at, r.transaction_at);
    const limits = {online_return: [5, 20], online_partial: [4, 15]}[s.template];
    if (limits && (gap < limits[0] || gap > limits[1])) bad(s, r.id, 'refund', 'the refund comes ' + gap + ' days after the order');
    if (s.template === 'online_return' && r.amount !== p.amount) bad(s, r.id, 'refund', 'a full return of ' + r.amount + ' for ' + p.amount);
    if (s.template === 'online_partial' && !s.facts.items.includes(r.amount)) bad(s, r.id, 'refund', 'the refund is not one item of the order');
    if (s.template === 'cancelled_flight' && (r.amount !== p.amount || days(s.facts.cancelled_on + 'T12:00:00-05:00', r.transaction_at) < 3 || days(s.facts.cancelled_on + 'T12:00:00-05:00', r.transaction_at) > 10)) bad(s, r.id, 'refund', 'the flight refund is not in full 3 to 10 days after the cancellation');
  }

  // 5. dispute: reason and texts from the template, opened after the trigger and inside the window, the amount, the credit and the end of its path.
  for (const d of seed.disputes) {
    const s = story(d.id);
    if (!s) continue;
    const name = disputeTemplate(s, s.facts), t = S.DISPUTES[name], p = tx.get(d.transaction_id);
    if (!t) { bad(s, d.id, 'dispute', 'no dispute template'); continue; }
    if (d.reason !== t.reason) bad(s, d.id, 'dispute', 'the reason ' + d.reason + ' is not ' + t.reason);
    const values = {merchant: p.merchant, amount: p.amount.toFixed(2), day: words(dayOf(p.transaction_at)), rate: text(cents(s.facts.rate || 0)), nights: s.facts.nights,
      charged: s.facts.charged_nights, from: s.facts.from && words(s.facts.from), to: s.facts.to && words(s.facts.to), order: words(dayOf(p.transaction_at)),
      promised: s.facts.promised_by && words(s.facts.promised_by)};
    if (!pattern(t.note, values).test(d.note)) bad(s, d.id, 'dispute', 'the note does not fit: ' + d.note);
    if (!s.facts.trigger || ms(d.opened_at) <= ms(s.facts.trigger)) bad(s, d.id, 'dispute', 'opened before its trigger');
    if (ms(d.opened_at) >= time.limitEnd(dayOf(p.posted_at), seed.issuer.rules.dispute_window_days, ZONE)) bad(s, d.id, 'dispute', 'opened after the dispute window');
    const refunded = seed.transactions.filter(x => x.kind === 'refund' && x.relates_to === p.id && x.state === 'posted' && ms(x.posted_at) < ms(d.opened_at)).reduce((n, x) => n + cents(x.amount), 0);
    const owed = name === 'wrong_amount' ? (() => { const h = recordsOf(s).find(x => x.state === 'dropped'); return h ? cents(p.amount) - (cents(h.amount) - cents((S.MERCHANTS[p.merchant] || {extra: 0}).extra)) : -1; })()
      : cents(p.amount) - refunded;
    if (cents(d.amount) !== owed) bad(s, d.id, 'dispute', 'the amount ' + d.amount + ' is not the ' + (name === 'wrong_amount' ? 'difference ' : 'net charge ') + text(owed));
    const rows = d.history.slice(1), creditRow = rows.find(h => h.credit_id), credit = creditRow && tx.get(creditRow.credit_id);
    const reversals = seed.transactions.filter(x => x.kind === 'reversal' && x.dispute_id === d.id);
    const end = d.ended_at || d.withdrawn_at, path = t.path;
    if (path !== 'withdrawn_refunded') {
      if (credit) {
        if (credit.amount !== d.amount) bad(s, d.id, 'dispute', 'the temporary credit ' + credit.amount + ' is not the amount ' + d.amount);
        const n = businessDays(d.opened_at, credit.posted_at);
        if (n < 2 || n > 10) bad(s, d.id, 'dispute', 'the temporary credit comes ' + n + ' business days after opening');
        if (creditRow.note !== t.credit) bad(s, d.id, 'dispute', 'the credit note does not fit');
      } else if (businessDays(d.opened_at, new Date(now).toISOString()) > 10) bad(s, d.id, 'dispute', 'no temporary credit 10 business days after opening');
    } else if (credit) bad(s, d.id, 'dispute', 'a temporary credit on a duplicate that the merchant refunds');
    if (end && ms(end) - ms(d.opened_at) > 90 * DAY) bad(s, d.id, 'dispute', 'the end comes more than 90 days after opening');
    if (!end && path !== 'open' && now - ms(d.opened_at) > 90 * DAY) bad(s, d.id, 'dispute', 'not ended 90 days after opening');
    const endRow = d.history[d.history.length - 1], reversed = reversals.reduce((n, x) => n + cents(x.amount), 0);
    const expected = {resolved_for_me: 'resolved_for_me', resolved_for_merchant: 'resolved_for_merchant', closed_matched: 'closed_matched', withdrawn_refunded: 'withdrawn',
      withdrawn_reversed: 'withdrawn', open: 'open'}[path];
    if (d.state !== 'open' && d.state !== expected) bad(s, d.id, 'dispute', 'the state ' + d.state + ' is not the path ' + path);
    if (path === 'open' && d.state !== 'open') bad(s, d.id, 'dispute', 'this dispute stays open');
    if (d.state === 'resolved_for_me' && reversed) bad(s, d.id, 'dispute', 'a credit kept for the cardholder is reversed');
    if (['resolved_for_merchant', 'closed_matched'].includes(d.state) && (!credit || reversed !== cents(credit.amount) || !endRow.reversal_id)) bad(s, d.id, 'dispute', 'the end does not take the credit back');
    if (t.end && ['resolved_for_me', 'resolved_for_merchant', 'closed_matched'].includes(d.state) && !pattern(t.end, values).test(endRow.note || '')) bad(s, d.id, 'dispute', 'the end note does not fit');
    if (d.state === 'closed_matched') {
      const after = seed.transactions.some(x => x.kind === 'refund' && x.relates_to === p.id && credit && ms(x.posted_at) > ms(credit.posted_at) && ms(x.posted_at) < ms(d.ended_at));
      if (!after) bad(s, d.id, 'dispute', 'closed as matched with no merchant refund after the credit');
    }
    if (d.state === 'withdrawn') {
      const note = d.history[d.history.length - 1].note;
      if (note !== S.fill(t.withdraw || '', {merchant: p.merchant})) bad(s, d.id, 'dispute', 'the withdrawal note does not fit');
      if (path === 'withdrawn_refunded' && !seed.transactions.some(x => x.kind === 'refund' && x.relates_to === p.id && ms(x.posted_at) < ms(d.withdrawn_at))) bad(s, d.id, 'dispute', 'withdrawn before the merchant refunded the copy');
      if (path === 'withdrawn_reversed') {
        const rev = reversals[0];
        if (!credit || ms(credit.posted_at) > ms(d.withdrawn_at)) bad(s, d.id, 'dispute', 'withdrawn before the temporary credit');
        if (rev && (rev.amount !== credit.amount || days(d.withdrawn_at, rev.posted_at) < 3 || days(d.withdrawn_at, rev.posted_at) > 8 || rev.note !== t.reversal)) bad(s, d.id, 'dispute', 'the reversal after the withdrawal does not fit');
        if (!rev && now - ms(d.withdrawn_at) > 9 * DAY) bad(s, d.id, 'dispute', 'no reversal 8 days after the withdrawal');
      }
    }
    if (name === 'duplicate_charge') {
      const first = tx.get(s.facts.copy_of);
      if (!first || first.amount !== p.amount || first.merchant !== p.merchant || ms(p.transaction_at) - ms(first.transaction_at) !== 60000) bad(s, d.id, 'dispute', 'the disputed charge is not a copy');
    }
  }

  // 6. offer: terms state the numbers, answers come before accept_by, payouts name an enrolled offer at the right time and amount, a group shares one issue time.
  const pays = o => [...seed.transactions.filter(x => x.offer_id === o.id), ...seed.points_entries.filter(e => e.offer_id === o.id)];
  const groupTimes = new Map();
  for (const o of seed.offers) {
    const s = story(o.id);
    if (!s) continue;
    const product = o.product_id && seed.products.find(p => p.id === o.product_id);
    const numbers = [o.credit_amount !== null && text(cents(o.credit_amount)), o.spend_target !== null && text(cents(o.spend_target)), o.spend_days !== null && o.spend_days + ' days',
      o.points !== null && o.points.toLocaleString('en-US') + ' bonus points', product && product.name].filter(Boolean);
    for (const n of numbers) if (!o.terms.includes(n)) bad(s, o.id, 'offer', 'the terms do not say ' + n);
    const answered = o.enrolled_at || o.declined_at;
    if (answered && ms(answered) >= ms(o.accept_by)) bad(s, o.id, 'offer', 'answered after accept_by');
    if (o.group) { if (groupTimes.has(o.group) && groupTimes.get(o.group) !== o.issued_at) bad(s, o.id, 'offer', 'the group does not share one issue time'); groupTimes.set(o.group, o.issued_at); }
    const paid = pays(o), spend = views.spend(seed, o, now), facts = s.facts;
    if (paid.length && (o.stored_state !== 'enrolled' || (spend && spend.condition !== 'met'))) bad(s, o.id, 'offer', 'a payout for an offer that is ' + views.offerState(o, now) + (spend ? ' with the condition ' + spend.condition : ''));
    if (paid.length > 1) bad(s, o.id, 'offer', 'paid twice');
    // A group story lists its offers in the order they were issued, which is the order of their IDs.
    const index = s.facts.offers ? seed.offers.filter(x => x.group === o.group).indexOf(o) : -1;
    const template = S.OFFERS.find(t => t.key === (s.facts.offers ? (s.facts.offers[index] || {}).offer : s.facts.offer));
    if (!template || template.kind !== o.kind) bad(s, o.id, 'offer', 'no offer template of this kind');
    for (const x of paid) {
      if (template && x.note !== template.payout_note) bad(s, o.id, 'offer', 'the payout note does not fit: ' + x.note);
      const amountOk = o.kind === 'bonus_points' ? x.points === o.points && x.reason === 'bonus' : x.kind === 'credit' && x.amount === o.credit_amount;
      if (!amountOk) bad(s, o.id, 'offer', 'the payout ' + x.id + ' does not have the offer\'s amount');
      const from = o.kind === 'spend_credit' ? facts.met_at : o.enrolled_at, gap = from ? days(from, x.at || x.posted_at) : -1;
      const [low, high] = S.PAYOUT_DAYS[o.kind] || [0, 0];
      if (!from || ms(x.at || x.posted_at) <= ms(from) || gap < low || gap > high) bad(s, o.id, 'offer', 'the payout ' + x.id + ' comes ' + gap + ' days after ' + (o.kind === 'spend_credit' ? 'the target was met' : 'acceptance'));
      if (o.kind === 'spend_credit' && facts.met_at) {
        const progress = views.spend({...seed, transactions: seed.transactions.filter(y => y.state === 'posted' && ms(y.posted_at) <= ms(facts.met_at))}, o, ms(facts.met_at));
        if (!progress || progress.condition !== 'met') bad(s, o.id, 'offer', 'the target was not met at ' + facts.met_at);
      }
    }
    const outcome = template && template.outcome;
    if (outcome) {
      const state = views.offerState(o, now);
      const fits = {paid: ['available', 'enrolled'], expired: ['available', 'expired'], declined: ['available', 'declined'], missed: ['available', 'enrolled'], unavailable: ['available', 'unavailable'],
        available: ['available']}[outcome];
      if (!fits.includes(state)) bad(s, o.id, 'offer', 'the state ' + state + ' does not fit the outcome ' + outcome);
      if (outcome === 'missed' && spend && spend.condition === 'met' && now >= ms(spend.deadline)) bad(s, o.id, 'offer', 'a missed offer reads met');
    }
  }

  // 7. fees: an annual fee on the anniversary from the second year on, with the product's amount; a returned-payment fee once, the day after a return.
  const product = seed.products.find(p => p.id === 'prd-reserve'), returned = seed.payments.filter(p => p.stored_state === 'returned');
  for (const f of seed.transactions.filter(x => x.kind === 'fee')) {
    const s = story(f.id);
    if (f.fee_type === 'annual') {
      const day = dayOf(f.posted_at);
      if (day.slice(5) !== S.ACCOUNT.fee_day || Number(day.slice(0, 4)) < S.ACCOUNT.first_fee_year || f.amount !== product.annual_fee) bad(s, f.id, 'fees', 'an annual fee of ' + f.amount + ' on ' + day);
      if (seed.transactions.filter(x => x.fee_type === 'annual' && dayOf(x.posted_at).slice(0, 4) === day.slice(0, 4)).length > 1) bad(s, f.id, 'fees', 'two annual fees in one year');
    } else {
      const ret = returned.find(p => f.note === 'Returned payment fee for the payment ' + p.id);
      if (!ret || days(ret.returned_at, f.posted_at) !== 1 || f.amount !== S.ACCOUNT.returned_payment_fee) bad(s, f.id, 'fees', 'a fee that is not the returned-payment fee of the day after a return');
    }
  }
  for (const p of returned) {
    const fees = seed.transactions.filter(x => x.kind === 'fee' && x.note === 'Returned payment fee for the payment ' + p.id);
    if (fees.length > 1 || (!fees.length && now - ms(p.returned_at) > 2 * DAY)) bad(story(p.id), p.id, 'fees', fees.length + ' returned-payment fees');
  }
  for (let year = S.ACCOUNT.first_fee_year; year <= 2026; year++) {
    const due = ms(year + '-12-03T07:00:00-05:00');
    if (now > due && !seed.transactions.some(x => x.fee_type === 'annual' && dayOf(x.posted_at) === year + '-' + S.ACCOUNT.fee_day)) bad(null, null, 'fees', 'no annual fee in ' + year);
  }

  // 8. statement: the balance at the closing from the records, the minimum by the issuer's formula, and the cycle's days.
  const counted = at => seed.payments.filter(p => p.stored_state !== 'cancelled' && ms(p.posts_at) <= at && amounts.get(p.id) > 0 && !(p.stored_state === 'returned' && ms(p.returned_at) <= at));
  const balanceAt = at => seed.transactions.filter(x => x.state === 'posted' && ms(x.posted_at) <= at)
    .reduce((n, x) => n + (views.CHARGES.has(x.kind) ? 1 : -1) * cents(x.amount), 0) - counted(at).reduce((n, p) => n + amounts.get(p.id), 0);
  statements.forEach((st, i) => {
    const s = story(st.id), closing = local(st.closing_at), month = closing.slice(0, 7), previous = i ? ms(statements[i - 1].closing_at) : -Infinity;
    const balance = balanceAt(ms(st.closing_at));
    if (cents(st.statement_balance) !== balance) bad(s, st.id, 'statement', 'the balance ' + st.statement_balance + ' is not ' + text(balance) + ' from the records');
    const extra = seed.transactions.filter(x => (x.kind === 'fee' || x.kind === 'interest') && x.state === 'posted' && ms(x.posted_at) > previous && ms(x.posted_at) <= ms(st.closing_at))
      .reduce((n, x) => n + cents(x.amount), 0);
    if (cents(st.minimum_due) !== S.minimumCents(cents(st.statement_balance), extra)) bad(s, st.id, 'statement', 'the minimum ' + st.minimum_due + ' does not follow the formula');
    const next = time.addDays(month + '-28', 5).slice(0, 7);
    if (st.id !== 'stm-' + month || closing.slice(8, 19) !== S.ACCOUNT.closing_day + 'T23:59:59' || local(st.issued_at).slice(8, 16) !== '28T02:00' || local(st.issued_at).slice(0, 7) !== month ||
      local(st.due_at).slice(0, 16) !== next + '-' + S.ACCOUNT.due_day + 'T17:00') bad(s, st.id, 'statement', 'the days do not follow the cycle');
  });

  // 9. interest: only after a statement not paid in full by its due time, at 23:00 on the next closing day, with the formula's amount.
  const paidByDue = st => seed.payments.filter(p => p.stored_state === 'scheduled' && ms(p.posts_at) > ms(st.closing_at) && ms(p.posts_at) <= ms(st.due_at))
    .reduce((n, p) => n + amounts.get(p.id), 0);
  const interestFor = new Map();
  for (const st of statements) {
    const month = local(st.due_at).slice(0, 7), when = ms(local(st.due_at).slice(0, 8) + S.ACCOUNT.closing_day + 'T23:00:00' + local(st.due_at).slice(19));
    const unpaid = cents(st.statement_balance) - paidByDue(st), found = seed.transactions.filter(x => x.kind === 'interest' && ms(x.posted_at) === when);
    if (now <= when) continue;
    const need = 'unpaid ' + text(unpaid) + ' at the due time needs interest of ' + text(S.interestCents(unpaid)) + ' on ' + month;
    if (unpaid > 0 && found.length !== 1) bad(story(st.id), st.id, 'interest', need);
    if (unpaid > 0 && found.length === 1 && cents(found[0].amount) !== S.interestCents(unpaid)) bad(story(found[0].id), found[0].id, 'interest', need + ', not ' + found[0].amount);
    if (unpaid <= 0 && found.length) bad(story(found[0].id), found[0].id, 'interest', 'interest after a statement paid in full');
    for (const x of found) interestFor.set(x.id, st.id);
  }
  for (const x of seed.transactions.filter(y => y.kind === 'interest')) if (!interestFor.has(x.id)) bad(story(x.id), x.id, 'interest', 'interest that follows no statement');

  // 10. payments: autopay follows the setting at scheduling, every statement but the returned one is paid its minimum by its due time, and the sources fit the bank change.
  const bank = rows.find(r => r.template === 'bank_change'), changed = bank ? ms(bank.facts.changed_at) : Infinity;
  const sourceAt = at => at < changed ? S.BANKS.old : S.BANKS.new;
  const modeAt = at => { const h = seed.account.history.filter(r => r.action === 'autopay.set' && ms(r.at) <= at); return h.length ? h[h.length - 1].to : 'off'; };
  for (const p of seed.payments) {
    const s = story(p.id);
    if (p.source !== sourceAt(ms(p.scheduled_at))) bad(s, p.id, 'payments', 'paid from ' + p.source + ' at ' + p.scheduled_at);
    if (p.autopay) {
      const st = seed.statements.find(x => x.id === p.statement_id), mode = modeAt(ms(p.scheduled_at));
      if (p.amount_type !== mode || p.scheduled_amount !== (mode === 'minimum_due' ? st.minimum_due : st.statement_balance) || p.pay_on !== dayOf(st.due_at)) bad(s, p.id, 'payments', 'the autopay payment does not follow the setting ' + mode);
    }
    if (p.stored_state === 'returned' && (!bank || p.source !== bank.facts.old_source || p.return_reason !== S.RETURN_REASON)) bad(s, p.id, 'payments', 'a returned payment that is not from the closed bank account');
  }
  for (const st of statements) {
    if (now < ms(st.due_at) || cents(st.statement_balance) <= 0) continue;
    const isReturned = seed.payments.some(p => p.statement_id === st.id && p.stored_state === 'returned');
    if (!isReturned && paidByDue(st) < cents(st.minimum_due)) bad(story(st.id), st.id, 'payments', 'the minimum was not paid by the due time');
  }

  // 11. points: each earned entry follows the earning rule for its cycle; a redemption credit is the points times the rate; a transfer uses the partner's ratio.
  for (const e of seed.points_entries) {
    const s = story(e.id);
    if (e.reason === 'earned') {
      const st = seed.statements.find(x => e.note === 'Points for the purchases of the statement ' + x.id), i = statements.indexOf(st);
      if (!st) { bad(s, e.id, 'points', 'an earned entry with no statement'); continue; }
      const previous = i ? ms(statements[i - 1].closing_at) : -Infinity, sums = {double: 0, single: 0};
      for (const x of seed.transactions) {
        if (x.state !== 'posted' || ms(x.posted_at) <= previous || ms(x.posted_at) > ms(st.closing_at)) continue;
        const merchant = x.kind === 'purchase' ? x.merchant : x.kind === 'refund' ? tx.get(x.relates_to).merchant : null;
        if (merchant) sums[S.MERCHANTS[merchant] && S.DOUBLE.has(S.MERCHANTS[merchant].category) ? 'double' : 'single'] += (x.kind === 'refund' ? -1 : 1) * cents(x.amount);
      }
      if (e.points !== S.earnedPoints(sums.double, sums.single)) bad(s, e.id, 'points', e.points + ' points for ' + st.id + ', not ' + S.earnedPoints(sums.double, sums.single));
      if (local(e.at).slice(0, 16) !== time.addDays(dayOf(st.issued_at), 1) + 'T04:00') bad(s, e.id, 'points', 'the earned entry is not at 04:00 the day after the statement');
      if (story(st.id) !== s) bad(s, e.id, 'points', 'the earned entry is not in the story of its statement');
    }
    if (e.reason === 'redeemed') {
      const credit = tx.get(e.transaction_id);
      if (!credit || cents(credit.amount) !== Math.floor(-e.points * Math.round(seed.issuer.rules.redeem_cents_per_point * 100) / 100)) bad(s, e.id, 'points', 'the redemption credit is not the points times the rate');
    }
    if (e.reason === 'transferred') {
      const partner = product.partners.find(p => p.id === e.transfer.partner_id);
      if (e.transfer.partner_points !== Math.floor(-e.points * Math.round(partner.ratio * 100) / 100) || e.transfer.member_name !== S.ACCOUNT.member_name) bad(s, e.id, 'points', 'the transfer does not follow the partner ratio');
      if (!s || s.template !== 'trip' || ms(e.at) >= ms(s.facts.from + 'T00:00:00-05:00')) bad(s, e.id, 'points', 'a transfer that does not come before its trip');
    }
  }

  // 12. times: local hours fit the actor. The cardholder writes from 07:00 to 23:00; batches run at night; decisions are on business days.
  const madeByDispute = new Set(seed.disputes.flatMap(d => d.history.flatMap(h => [h.credit_id, h.reversal_id])).filter(Boolean));
  for (const row of activity) {
    const where = row.object_id, s = story(where), at = row.at;
    const fail = (rule, range) => bad(s, where, 'times', row.action + ' at ' + local(at) + ' is outside ' + rule + ' ' + range.join(' to '));
    if (row.actor === 'agent') { if (!within(at, S.HOURS.cardholder)) fail('the cardholder hours', S.HOURS.cardholder); continue; }
    if (row.effect) continue;
    const decide = range => { if (!business(dayOf(at)) || !within(at, range)) fail('the business hours', range); };
    if (row.action === 'dispute.updated' || row.action === 'payment.returned') decide(S.HOURS.issuer);
    else if (row.action === 'offer.issued') decide(S.HOURS.offer);
    else if (row.action === 'statement.issued') { if (!within(at, S.HOURS.statement)) fail('the statement run', S.HOURS.statement); }
    else if (row.action === 'points.adjusted') { if (!within(at, S.BATCH)) fail('the batch', S.BATCH); }
    else if (row.action === 'transaction.posted') {
      const x = tx.get(where), first = x && x.history[0];
      if (!x || madeByDispute.has(x.id)) continue;
      const pendingRow = first.action === 'transaction.pending' && first.at === at, posting = x.kind === 'purchase' && (pendingRow || x.posted_at === x.transaction_at);
      if (x.kind === 'interest') { if (!within(at, S.HOURS.interest)) fail('the interest run', S.HOURS.interest); }
      else if (!posting && !within(at, S.BATCH)) fail('the batch', S.BATCH);
    }
  }
  for (const x of seed.transactions.filter(y => madeByDispute.has(y.id))) if (!business(dayOf(x.posted_at)) || !within(x.posted_at, S.HOURS.issuer)) bad(story(x.id), x.id, 'times', 'a dispute credit at ' + local(x.posted_at));

  // 13. names: merchants come from the fictional list, and no note text is used by more than 3 stories.
  const notes = new Map(), note = (value, s) => { if (value && s && !APP_NOTES.has(value)) notes.set(value, (notes.get(value) || new Set()).add(s.story_id)); };
  for (const x of seed.transactions) {
    if (x.merchant !== null && !S.MERCHANTS[x.merchant]) bad(story(x.id), x.id, 'names', 'the merchant ' + x.merchant + ' is not in the fictional list');
    note(x.note, story(x.id));
    note(x.drop_reason, story(x.id));
  }
  for (const d of seed.disputes) for (const h of d.history) note(h.note, story(d.id));
  for (const e of seed.points_entries) note(e.note, story(e.id));
  for (const p of seed.payments) note(p.return_reason, story(p.id));
  for (const [value, set] of notes) if (set.size > 3) bad(null, null, 'names', set.size + ' stories share the note: ' + value);

  // 14. notifications: one for each event except purchase postings and drops, with the amounts and days of its record, and the email only when notices were on.
  const byEvent = new Map();
  for (const n of seed.notifications) byEvent.set(n.event_id, (byEvent.get(n.event_id) || []).concat(n));
  const emailFrom = activity.find(r => r.action === 'preferences.update');
  for (const row of activity.filter(r => r.actor === 'event' && !r.effect)) {
    const x = tx.get(row.object_id), silent = row.action === 'transaction.dropped' || (row.action === 'transaction.posted' && x && x.kind === 'purchase');
    const list = byEvent.get(row.event_id) || [];
    if (list.length !== (silent ? 0 : 1)) bad(story(row.object_id), row.object_id, 'notifications', row.event_id + ' wrote ' + list.length + ' notifications');
  }
  for (const n of seed.notifications) {
    const year = Number(dayOf(n.at).slice(0, 4)), say = day => words(day, year), s = story(n.object_id), needs = [];
    if (n.kind === 'transaction.posted') {
      const x = tx.get(n.object_id), p = x.relates_to && tx.get(x.relates_to);
      needs.push(text(cents(x.amount)));
      if (p && p.kind === 'purchase') needs.push(text(cents(p.amount)), say(dayOf(p.transaction_at)));
    } else if (n.kind === 'statement.issued') {
      const st = seed.statements.find(x => x.id === n.object_id);
      needs.push(text(cents(st.statement_balance)), text(cents(st.minimum_due)), say(dayOf(st.due_at)));
    } else if (n.kind === 'payment.returned') {
      const p = seed.payments.find(x => x.id === n.object_id);
      needs.push(text(amounts.get(p.id)), say(p.pay_on));
    } else if (n.kind === 'dispute.updated') {
      const d = seed.disputes.find(x => x.id === n.object_id), p = tx.get(d.transaction_id), h = d.history.find(r => r.ref === n.event_id);
      needs.push(text(cents(p.amount)), say(dayOf(p.transaction_at)));
      if (h && h.credit_id) needs.push(text(cents(tx.get(h.credit_id).amount)));
      if (h && h.reversal_id) needs.push(text(cents(tx.get(h.reversal_id).amount)));
    } else if (n.kind === 'offer.issued') {
      const o = offers.get(n.object_id);
      needs.push(say(dayOf(o.accept_by)));
    } else if (n.kind === 'points.adjusted') {
      const e = seed.points_entries.find(x => x.id === n.object_id);
      needs.push(Math.abs(e.points).toLocaleString('en-US'));
    }
    for (const part of needs) if (!(n.title + ' ' + n.text).includes(part)) bad(s, n.id, 'notifications', 'the notification does not say ' + part);
    if ((n.email !== null) !== (!!emailFrom && ms(n.at) >= ms(emailFrom.at))) bad(s, n.id, 'notifications', 'the email is ' + (n.email ? 'stored while notices were off' : 'missing while notices were on'));
  }
  return out;
}
module.exports = {RULES, problems};
