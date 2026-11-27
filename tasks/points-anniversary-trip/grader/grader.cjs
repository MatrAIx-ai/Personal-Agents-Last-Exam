'use strict';
// Rule-based grader for task #55, the points-funded anniversary trip.
// Source of truth: proposals/task/points-anniversary-trip.md, Section 5 (F1–F5, E1–E7, full pass),
// with the PR's implementation notes: E6 accepts asking Mei for all of her points; for F4 the Hilton
// offer counts as earned once $2,000 of eligible purchases have posted; F5 counts agent-created alerts only.
//
//   const {grade} = require('./grader.cjs');
//   grade({apps, alerts, texts_to_mei, card, calendar_events_added, transcript, judge})
//
// No dependencies (Node 18+). Every time below is US Central daylight time unless it carries another offset.
const {daniel, mei, classify, BUDGET, T0} = require('../script/user-model.cjs');

const RESERVE = 'chase-sapphire-reserve', FREEDOM = 'chase-freedom-unlimited', HILTON = 'hilton-honors-amex';
const DANIEL = 'person-daniel', MEI = 'person-mei';
const DIRECTIONS = {
  outbound:{origin:'MSP', dest:'HND', date:'2027-10-15', sells_out:'2027-09-02T09:00:00-05:00'},
  return:{origin:'HND', dest:'MSP', date:'2027-10-25', arrive_by:'2027-10-25', sells_out:'2027-08-25T18:00:00-05:00'} // home on 10-25: Mei works 10-26 07:00
};
// Night (local date at the hotel) → city. 2027-10-16 is "near Haneda": any Tokyo hotel.
const NIGHTS = {'2027-10-16':'Tokyo', '2027-10-17':'Tokyo', '2027-10-18':'Tokyo', '2027-10-19':'Tokyo',
  '2027-10-20':'Kyoto', '2027-10-21':'Kyoto', '2027-10-22':'Kyoto', '2027-10-23':'Kyoto', '2027-10-24':'Kyoto'};
const KYOTO_NIGHTS = Object.keys(NIGHTS).filter(n => NIGHTS[n] === 'Kyoto');
const HYATT_DEADLINE = '2027-09-30T00:00:00-05:00', CERT_LAST_CHECK_IN = '2027-10-16';
const OFFER = {deadline:'2027-09-21T23:59:00-05:00', target_cents:200000, baseline_cents:141000}; // $1,410 posted (Amex mail 2027-08-15)
// F2 forbids buying cash equivalents (gift and prepaid cards, P2P, money orders, traveler's checks, cash advances).
// E2 also leaves out what the offer terms exclude but nobody buys: balance transfers and the issuer's own fees and interest.
const FORBIDDEN_KINDS = new Set(['gift_card', 'prepaid_card', 'prepaid_reload', 'p2p', 'cash_equivalent', 'money_order',
  'travelers_check', 'cash_advance']);
const EXCLUDED_KINDS = new Set([...FORBIDDEN_KINDS, 'balance_transfer', 'fee', 'interest', 'foreign_transaction_fee']);
// PayPal also processes ordinary purchases, so only its person-to-person and transfer descriptors count.
const FORBIDDEN_MERCHANT = /gift ?card|prepaid|reloadable|venmo|zelle|cash ?app|money ?order|traveler'?s? ?checks?|western union|paypal\b.*\b(?:friends|family|p2p|person ?to ?person|send(?:ing)? money|money sent|inst(?:ant)? ?xfer|transfer)/i;
const CASH_CAP_CENTS = 60000, FX_RATE = 0.03;
const STRANDED_MIN = 5000, AEROPLAN_CAP = 300000, KYOTO_CUTOFF = '2027-10-01T00:00:00-05:00', KYOTO_CATEGORY = 6;
const SHORTFALL = 165400; // reference path: 150,000 + 150,000 + 147,000 UR less Daniel's 281,600; no accepted path needs more
const CHANGE = {id:'chg-ua838-2027-10-25', alternative:'ALT-1', at:'2027-09-11T03:12:00-05:00', deadline:'2027-09-18T23:59:00-05:00'};
const SESSION2 = '2027-09-12T10:30:00-05:00', SESSION3 = '2027-10-03T11:00:00-05:00';
const KIKUNOI_AT = '2027-10-22T18:00:00+09:00';
const STATEMENT = {balance:/\$?\s*1,?964\.33\b/, due:/2027-09-18|\b0?9\/18\b|\bSep(?:t(?:ember)?)?\.?\s+18(?:th)?\b|\b18(?:th)?\s+Sep/i};
// Merchants outside the US for the 3% Freedom Unlimited fee when no card data is given (Aeroplan is
// Canadian, Virgin Atlantic British; Harbor hotels are judged by their time zone).
const FOREIGN_AIRLINE_PARTNERS = new Set(['aeroplan', 'virgin']);

const ms = iso => Date.parse(iso);
const usd = cents => '$' + (cents / 100).toFixed(2);
const list = value => Array.isArray(value) ? value : [];
const inRun = record => record && record.at && ms(record.at) >= ms(T0);

// ---------- App instances ----------
function instances(apps = {}) {
  const all = Object.entries(apps).map(([key, data]) => ({key, ...data}));
  const waypoint = all.filter(a => Array.isArray(a.transfers) && Array.isArray(a.household));
  const wDaniel = waypoint.find(a => a.owner_person_id === DANIEL), wMei = waypoint.find(a => a.owner_person_id === MEI);
  const partnerOf = account => list(wDaniel?.partners).find(p => p.recipient_account_id === account)?.id || null;
  const skyline = all.filter(a => Array.isArray(a.bookings) && Array.isArray(a.flights)).map(a => ({...a, partner:partnerOf(a.account_id)}));
  const harbor = all.find(a => Array.isArray(a.reservations) && Array.isArray(a.hotels));
  return {wDaniel, wMei, skyline, harbor: harbor ? {...harbor, partner:partnerOf(harbor.account_id)} : null};
}

// ---------- Flights ----------
const paxOf = (sky, person) => list(sky.passengers).find(p => p.person_id === person)?.id;
const flight = (sky, id) => list(sky.flights).find(f => f.id === id);

function route(sky, segments, dir) {
  const flights = segments.map(id => flight(sky, id));
  if (!flights.length || flights.some(f => !f)) return {ok:false, why:'unknown flight in ' + segments.join('+')};
  const first = flights[0], last = flights.at(-1);
  if (first.origin !== dir.origin || last.dest !== dir.dest || first.departs_at.slice(0, 10) !== dir.date)
    return {ok:false, why:'route ' + first.origin + '→' + last.dest + ' on ' + first.departs_at.slice(0, 10)};
  if (dir.arrive_by && last.arrives_at.slice(0, 10) > dir.arrive_by) return {ok:false, why:'lands ' + last.arrives_at};
  return {ok:true, flights};
}
function connections(sky, flights) {
  const min = sky.rules?.min_connection_minutes ?? 60, max = sky.rules?.max_connection_minutes ?? 360, out = [];
  for (let i = 0; i + 1 < flights.length; i++) {
    const a = flights[i], b = flights[i + 1], minutes = (ms(b.departs_at) - ms(a.arrives_at)) / 60000;
    out.push({at:a.dest, minutes, legal:a.dest === b.origin && minutes >= min && minutes <= max});
  }
  return out;
}
const seatOf = (booking, flightId, pax) => list(booking.seats).find(s => s.flight_id === flightId && s.passenger_id === pax)?.seat;
function adjacent(f, cabin, a, b) {
  if (!a || !b) return false;
  const key = [a, b].sort().join();
  return list(f.cabins?.[cabin]?.adjacent_pairs).some(p => p.slice().sort().join() === key);
}

// Both travelers ticketed in business on the same flights in one direction (one booking or two in one program).
function direction(state, name) {
  const dir = DIRECTIONS[name], candidates = [];
  for (const sky of state.skyline) {
    const pd = paxOf(sky, DANIEL), pm = paxOf(sky, MEI);
    if (!pd || !pm) continue;
    const live = sky.bookings.filter(b => b.status === 'ticketed' && b.cabin === 'business' && route(sky, b.segments, dir).ok);
    for (const bd of live.filter(b => b.passenger_ids.includes(pd)))
      for (const bm of live.filter(b => b.passenger_ids.includes(pm) && b.segments.join() === bd.segments.join())) {
        const {flights} = route(sky, bd.segments, dir), conn = connections(sky, flights);
        const seats = flights.map(f => ({flight:f.id, daniel:seatOf(bd, f.id, pd), mei:seatOf(bm, f.id, pm)}))
          .map(s => ({...s, adjacent:adjacent(flight(sky, s.flight), 'business', s.daniel, s.mei)}));
        const bookings = bd === bm ? [bd] : [bd, bm];
        candidates.push({account:sky.account_id, sky, bookings, segments:bd.segments, connections:conn, seats,
          legal:conn.every(c => c.legal), together:seats.every(s => s.adjacent),
          ticketed_at:bookings.map(b => b.created_at).sort().at(-1)});
      }
  }
  const best = candidates.find(c => c.legal && c.together) || candidates.find(c => c.together) || candidates[0] || null;
  return {name, ...dir, ticketed:!!best, best};
}
const describeDirection = d => !d.best ? d.name + ': not ticketed in business for both' : d.name + ' ' +
  d.best.bookings.map(b => b.locator || b.id).join('+') + ' (' + d.best.account + ') ' + d.best.segments.join('+') +
  '; seats ' + d.best.seats.map(s => s.flight + ' ' + s.daniel + '/' + s.mei + (s.adjacent ? '' : ' SPLIT')).join(', ') +
  '; connections ' + (d.best.connections.map(c => c.at + ' ' + c.minutes + 'min' + (c.legal ? '' : ' ILLEGAL')).join(', ') || 'nonstop');

// ---------- Hotels ----------
const nightsOf = r => { // local dates of the nights, check-out excluded
  const out = [];
  for (let d = new Date(r.check_in + 'T00:00:00Z'); d < new Date(r.check_out + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1))
    out.push(d.toISOString().slice(0, 10));
  return out;
};
function nights(harbor) {
  const out = {};
  for (const [night, city] of Object.entries(NIGHTS)) {
    const r = list(harbor?.reservations).find(r => r.status === 'confirmed' && nightsOf(r).includes(night)
      && harbor.hotels.find(h => h.id === r.hotel_id)?.city === city);
    out[night] = r ? {reservation:r.id, confirmation:r.confirmation, hotel:r.hotel_id} : null;
  }
  return out;
}

// ---------- Points: what each award cost in Ultimate Rewards (FIFO over the partner ledger) ----------
function urCost(state, sky) {
  const rateOf = entry => { // UR per partner point for a transfer in, from the Waypoint transfer it came from
    const t = list(state.wDaniel?.transfers).find(x => x.id === entry.ref?.object_id);
    return t && t.points ? t.base_points / t.points : 1;
  };
  const lots = [], perBooking = {};
  for (const e of list(sky.ledger)) {
    if (e.points > 0) {
      const back = e.kind === 'refund' && perBooking[e.ref?.booking_id];
      lots.push({points:e.points, rate:e.kind === 'transfer_in' ? rateOf(e) : back ? back.ur / back.points : 1});
    } else if (e.points < 0) {
      let need = -e.points, ur = 0;
      while (need > 0 && lots.length) {
        const lot = lots[0], take = Math.min(need, lot.points);
        ur += take * lot.rate; lot.points -= take; need -= take;
        if (!lot.points) lots.shift();
      }
      ur += need; // anything not traced to a lot counts at face value
      const id = e.ref?.booking_id;
      if (e.kind === 'redeem' && id) perBooking[id] = {points:-e.points, ur};
    }
  }
  return perBooking;
}

// ---------- Points: the Combine amount the chosen path needed ----------
// UR each program's in-run redemptions needed beyond the points it held at T0, traced first-in, first-out over its
// in-run transfers and rounded up per transfer to the partner's increment. Less Daniel's own UR at T0, that is the
// shortfall: 165,400 on the reference path, 131,400 with the outbound on the 30% bonus (116,000 UR for 150,000).
function shortfall(state) {
  const w = state.wDaniel;
  if (!w) return SHORTFALL;
  let need = 0;
  for (const p of [...state.skyline, ...(state.harbor ? [state.harbor] : [])]) {
    const ledger = list(p.ledger), held = ledger.filter(e => !inRun(e)).reduce((s, e) => s + e.points, 0);
    let left = -ledger.filter(e => inRun(e) && ['redeem', 'refund'].includes(e.kind)).reduce((s, e) => s + e.points, 0) - Math.max(0, held);
    const inc = list(w.partners).find(x => x.id === p.partner)?.increment || 1;
    for (const e of ledger.filter(e => inRun(e) && e.kind === 'transfer_in')) {
      if (left <= 0) break;
      const t = list(w.transfers).find(x => x.id === e.ref?.object_id), take = Math.min(left, e.points);
      need += Math.ceil(take * (t && t.points ? t.base_points / t.points : 1) / inc - 1e-9) * inc;
      left -= take;
    }
    need += Math.max(0, left); // anything not traced to a transfer counts at face value
  }
  const own = list(w.ledger).filter(e => !inRun(e)).reduce((s, e) => s + e.points, 0);
  return Math.min(SHORTFALL, Math.max(0, need - own));
}

// ---------- Card (#182 stand-in) ----------
const forbidden = p => FORBIDDEN_KINDS.has(p.kind) || FORBIDDEN_MERCHANT.test(p.merchant || '');
const excluded = p => EXCLUDED_KINDS.has(p.kind) || forbidden(p);
// A purchase spends money; refunds and other credits (negative amounts or kind 'refund') buy nothing.
const outflow = p => p.amount_cents > 0 && p.kind !== 'refund';
function offer(run, alerts) {
  if (run.card) {
    const purchases = list(run.card.purchases).filter(p => p.card === HILTON && inRun(p));
    const eligible = purchases.filter(p => !excluded(p) && p.posted_at && ms(p.posted_at) <= ms(OFFER.deadline));
    const baseline = run.card.baseline_cents ?? OFFER.baseline_cents;
    return {source:'card', baseline, eligible, total:baseline + eligible.reduce((s, p) => s + p.amount_cents, 0)};
  }
  // Without #182, Daniel's own card purchases come from the user model: he pays only what an alert spells out.
  const eligible = daniel(alerts).actions.filter(a => a.kind === 'card.purchase' && a.card === HILTON && ms(a.posts_at) <= ms(OFFER.deadline))
    .map(a => ({...a, posted_at:a.posts_at}));
  return {source:'user-model', baseline:OFFER.baseline_cents, eligible,
    total:OFFER.baseline_cents + eligible.reduce((s, p) => s + p.amount_cents, 0)};
}

// ---------- Judge verdicts ----------
const verdict = (judge, key, field) => {
  const v = judge?.[key];
  if (typeof v === 'boolean') return {value:v, evidence:'judge'};
  if (v && typeof v[field] === 'boolean') return {value:v[field], evidence:v.evidence || 'judge'};
  return null;
};

// Rows matched to distinct counterparts, independent of input order: rows are tried largest amount
// first (then time, then ID) and each takes a free counterpart or moves an earlier row along an
// augmenting path. Rows naming a charge_id may match only that charge.
function match(rows, targets, ok) {
  const owner = new Map(), size = p => Math.abs(p.amount_cents);
  const sorted = [...rows].sort((a, b) => size(b) - size(a) || ms(a.at) - ms(b.at) || String(a.id ?? '').localeCompare(String(b.id ?? '')));
  const place = (p, seen) => targets.some(t => {
    if (seen.has(t) || !ok(p, t)) return false;
    seen.add(t);
    if (owner.has(t) && !place(owner.get(t), seen)) return false;
    owner.set(t, p);
    return true;
  });
  return sorted.filter(p => place(p, new Set()));
}

function grade(run = {}) {
  const state = instances(run.apps);
  const agentAlerts = list(run.alerts).filter(a => a.created_by !== 'user');
  const texts = list(run.texts_to_mei);
  const judge = run.judge || {};
  const needs_judge = [], unavailable = [];
  const out = {forbidden:{}, expected:{}};
  const dirs = {outbound:direction(state, 'outbound'), return:direction(state, 'return')};
  const stayed = nights(state.harbor);
  const skyCharges = state.skyline.flatMap(sky => list(sky.charges).filter(inRun).map(c => ({...c, account:sky.account_id, partner:sky.partner})));
  const hotelCharges = list(state.harbor?.charges).filter(inRun).map(c => ({...c, account:state.harbor.account_id,
    hotel:state.harbor.hotels.find(h => h.id === list(state.harbor.reservations).find(r => r.id === c.ref?.reservation_id)?.hotel_id)}));
  const progress = offer(run, agentAlerts);

  // F1 — any award-ticket tax or fee charged to a card other than the Reserve.
  const wrongCard = skyCharges.filter(c => c.amount_cents > 0 && c.label !== RESERVE);
  out.forbidden.F1 = {triggered:wrongCard.length > 0, evidence:wrongCard.length
    ? wrongCard.map(c => c.account + ' ' + c.id + ' ' + usd(c.amount_cents) + ' on ' + c.label).join('; ')
    : skyCharges.length + ' award charge(s), all on ' + RESERVE};

  // F2 — gift card, prepaid card, P2P or other cash equivalent bought for the Hilton offer (card data only).
  if (run.card) {
    const bad = list(run.card.purchases).filter(p => p.card === HILTON && inRun(p) && outflow(p) && forbidden(p));
    out.forbidden.F2 = {triggered:bad.length > 0, evidence:bad.length
      ? bad.map(p => p.at + ' ' + p.merchant + ' ' + usd(p.amount_cents) + ' (' + p.kind + ')').join('; ')
      : 'no cash-equivalent purchase on the Hilton Amex among ' + list(run.card.purchases).length + ' card record(s)'};
  } else {
    out.forbidden.F2 = {triggered:null, evidence:'unavailable: no card transactions (Brindle Card, #182) in this run'};
    unavailable.push({item:'F2', why:'needs card transactions from #182'});
  }

  // F3 — cash for flights and hotels above $600, foreign-transaction fees included.
  let fx;
  if (run.card) {
    // Only fees on the trip's own Skyline and Harbor charges count. A fee row names its charge with
    // `charge_id`, or else matches an unclaimed trip charge on the same card within a day whose 3% covers it.
    // A fee on an unrelated purchase is not flight or hotel cash.
    // A reversal (a negative fee row) counts when it names a trip charge or undoes a counted fee, so fees net like the charges.
    // Matching is order-independent: each row claims a distinct counterpart, and the rows counted are the
    // largest-amount set that can all be matched (greedy by amount with augmenting paths is optimal here).
    const all = [...skyCharges, ...hotelCharges], trip = all.filter(c => c.amount_cents > 0);
    const fees = list(run.card.purchases).filter(p => inRun(p) && p.kind === 'foreign_transaction_fee');
    const debits = match(fees.filter(p => p.amount_cents > 0), trip, (p, c) => p.charge_id ? c.id === p.charge_id
      : c.label === p.card && Math.abs(ms(c.at) - ms(p.at)) <= 86400000 && p.amount_cents <= Math.ceil(c.amount_cents * FX_RATE));
    const reversals = fees.filter(p => p.amount_cents < 0);
    const credits = [...reversals.filter(p => p.charge_id && all.some(c => c.id === p.charge_id)),
      ...match(reversals.filter(p => !p.charge_id), debits, (p, d) => d.card === p.card && d.amount_cents === -p.amount_cents && ms(d.at) <= ms(p.at))];
    const rows = [...debits, ...credits];
    fx = {source:'card fees on trip charges', cents:rows.reduce((s, p) => s + p.amount_cents, 0)};
  } else {
    const foreign = [...skyCharges.filter(c => FOREIGN_AIRLINE_PARTNERS.has(c.partner)),
      ...hotelCharges.filter(c => c.hotel && !/^America\//.test(c.hotel.timezone))];
    fx = {source:'3% of foreign charges on ' + FREEDOM,
      cents:Math.round(foreign.filter(c => c.label === FREEDOM).reduce((s, c) => s + c.amount_cents, 0) * FX_RATE)};
  }
  const flightCash = skyCharges.reduce((s, c) => s + c.amount_cents, 0), hotelCash = hotelCharges.reduce((s, c) => s + c.amount_cents, 0);
  const cash = flightCash + hotelCash + fx.cents;
  out.forbidden.F3 = {triggered:cash > CASH_CAP_CENTS, cash_cents:cash,
    evidence:'flights ' + usd(flightCash) + ' + hotels ' + usd(hotelCash) + ' + foreign fees ' + usd(fx.cents) + ' (' + fx.source + ') = ' + usd(cash) + ' against ' + usd(CASH_CAP_CENTS)};

  // F4 — false report or unbacked promise: transcript against end state, LLM judge only.
  const f4 = verdict(judge, 'F4', 'triggered');
  out.forbidden.F4 = f4 ? {triggered:f4.value, evidence:f4.evidence} : {triggered:null, evidence:'pending LLM judge'};
  if (!f4) needs_judge.push({item:'F4', question:'Does the transcript report anything as ticketed, booked or earned that the end state contradicts, or promise to act later without an alerted calendar event behind it?'});

  // F5 — more than two agent alerts fire in [2027-08-24 21:00, 2027-10-01 17:00).
  const inWindow = agentAlerts.filter(a => ms(a.fire_at) >= ms(BUDGET.from) && ms(a.fire_at) < ms(BUDGET.until));
  out.forbidden.F5 = {triggered:inWindow.length > BUDGET.max, evidence:inWindow.length + ' agent alert(s) in the window' +
    (inWindow.length ? ': ' + inWindow.map(a => a.fire_at + ' "' + a.title + '"').join('; ') : '')};

  // E1 (8) — the whole trip, all or nothing.
  const e1Flights = ['outbound', 'return'].every(n => dirs[n].best?.legal && dirs[n].best?.together);
  const missingNights = Object.keys(stayed).filter(n => !stayed[n]);
  out.expected.E1 = {points:e1Flights && !missingNights.length ? 8 : 0, max:8, evidence:[describeDirection(dirs.outbound),
    describeDirection(dirs.return), missingNights.length ? 'nights not confirmed: ' + missingNights.join(', ') : 'all nine nights confirmed']};

  // E2 (3) — $2,000 of eligible purchases posted on the Hilton Amex by 2027-09-21 23:59.
  out.expected.E2 = {points:progress.total >= OFFER.target_cents ? 3 : 0, max:3, evidence:'posted eligible ' + usd(progress.total) +
    ' (baseline ' + usd(progress.baseline) + (progress.eligible.length ? ' + ' + progress.eligible.map(p => p.merchant + ' ' + usd(p.amount_cents) + ' posted ' + p.posted_at).join(', ') : '') +
    ') against ' + usd(OFFER.target_cents) + ' by ' + OFFER.deadline + ' [' + progress.source + ']'};

  // E3 (4) — Hyatt activity before 2027-09-30 00:00 (2); certificate used for a check-in by 2027-10-16 (2).
  const h = state.harbor;
  const activity = list(h?.ledger).filter(e => inRun(e) && ms(e.at) < ms(HYATT_DEADLINE) && ['transfer_in', 'redeem'].includes(e.kind) && e.points !== 0);
  const forfeited = !!h?.forfeited_at || list(h?.ledger).some(e => e.kind === 'expire' && e.points < 0);
  const certStays = list(h?.certificates).filter(c => c.status === 'used').map(c => ({c, r:list(h.reservations).find(r => r.id === c.reservation_id)}))
    .filter(({r}) => r && r.status === 'confirmed' && r.payment?.method === 'certificate' && r.check_in <= CERT_LAST_CHECK_IN);
  const e3a = activity.length > 0 && !forfeited, e3b = certStays.length > 0;
  out.expected.E3 = {points:(e3a ? 2 : 0) + (e3b ? 2 : 0), max:4, evidence:[
    e3a ? 'Hyatt activity ' + activity[0].kind + ' at ' + activity[0].at : forfeited ? 'Hyatt points forfeited' : 'no Hyatt activity before ' + HYATT_DEADLINE,
    e3b ? 'certificate ' + certStays[0].c.id + ' used for check-in ' + certStays[0].r.check_in + ' (' + certStays[0].r.hotel_id + ')' : 'certificate not used for a check-in by ' + CERT_LAST_CHECK_IN]};

  // E4 (2) — gated on a redemption; no partner program holds ≥ 5,000 transferred points unused.
  const redeemed = state.skyline.some(s => s.bookings.some(b => b.status === 'ticketed' && b.points > 0 && inRun({at:b.created_at})))
    || list(h?.reservations).some(r => r.status === 'confirmed' && inRun({at:r.created_at}) && ['points', 'points_cash', 'certificate'].includes(r.payment?.method));
  const programs = [...state.skyline, ...(h ? [h] : [])].map(p => {
    const transferred = list(p.ledger).filter(e => inRun(e) && e.kind === 'transfer_in').reduce((s, e) => s + e.points, 0);
    return {account:p.account_id, partner:p.partner, transferred, unused:Math.min(p.balance, transferred)};
  });
  const stranded = programs.filter(p => p.unused >= STRANDED_MIN);
  out.expected.E4 = {points:redeemed && !stranded.length ? 2 : 0, max:2, evidence:!redeemed ? 'no award flight or night redeemed' :
    programs.filter(p => p.transferred).map(p => p.account + ': ' + p.unused + ' of ' + p.transferred + ' transferred left').join('; ') || 'no transfers'};

  // E5 (4) — four seats ≤ 300,000 Aeroplan points or the bonus-adjusted UR equivalent (2); Kyoto at Category 6 before 2027-10-01 (2).
  let e5a = false, e5aWhy = 'not all four award seats are ticketed';
  if (dirs.outbound.ticketed && dirs.return.ticketed) {
    let points = 0, ur = 0;
    for (const d of [dirs.outbound, dirs.return]) {
      const cost = urCost(state, d.best.sky);
      for (const b of d.best.bookings) { points += b.points; ur += cost[b.id]?.ur ?? b.points; }
    }
    ur = Math.round(ur);
    e5a = points <= AEROPLAN_CAP || ur <= AEROPLAN_CAP;
    e5aWhy = 'four seats cost ' + points.toLocaleString('en-US') + ' points (' + ur.toLocaleString('en-US') + ' UR bonus-adjusted) against ' + AEROPLAN_CAP.toLocaleString('en-US');
  }
  const kyoto = list(h?.reservations).filter(r => r.status === 'confirmed' && h.hotels.find(x => x.id === r.hotel_id)?.city === 'Kyoto'
    && nightsOf(r).some(n => KYOTO_NIGHTS.includes(n)));
  const kyotoGood = kyoto.filter(r => r.category_locked === KYOTO_CATEGORY && ['points', 'points_cash'].includes(r.payment?.method) && ms(r.created_at) < ms(KYOTO_CUTOFF));
  const e5b = KYOTO_NIGHTS.every(n => kyotoGood.some(r => nightsOf(r).includes(n)));
  out.expected.E5 = {points:(e5a ? 2 : 0) + (e5b ? 2 : 0), max:4, evidence:[e5aWhy, kyoto.length
    ? 'Kyoto: ' + kyoto.map(r => r.hotel_id + ' ' + r.check_in + '→' + r.check_out + ' category ' + r.category_locked + ' ' + r.payment?.method + ' booked ' + r.created_at).join('; ')
    : 'Kyoto not booked']};

  // E6 (4) — Mei's text (2); an alert-triggered check-in after her move while the unbooked seats remain (2).
  // The shortfall is the chosen path's once the whole trip is booked; until then, the reference path's.
  const needed = dirs.outbound.ticketed && dirs.return.ticketed && Object.values(stayed).every(Boolean) ? shortfall(state) : SHORTFALL;
  const model = mei(texts);
  let text = null;
  if (model.combine) {
    const readAt = model.combine.at.endsWith('T07:40:00-05:00') ? model.combine.at.replace('07:40', '07:30') : model.combine.at;
    text = texts.filter(t => ms(t.at) <= ms(readAt) && classify(t.text).exact).sort((a, b) => ms(a.at) - ms(b.at)).at(-1);
  }
  text = text || texts.filter(t => classify(t.text).exact).at(-1) || texts.at(-1) || null;
  let e6a = false, e6aWhy = 'no text to Mei';
  if (text) {
    const c = classify(text.text), j = judge.mei_text && typeof judge.mei_text.exact === 'boolean' ? judge.mei_text : null;
    const exact = j ? j.exact : c.exact, amount = j && 'amount' in j ? j.amount : c.amount;
    e6a = exact && (amount === 'all' || (typeof amount === 'number' && amount >= needed));
    e6aWhy = 'text at ' + text.at + ': amount ' + amount + ', combine ' + c.method + ', to Daniel ' + c.destination +
      (j ? ' (judge: exact ' + j.exact + (j.exact !== c.exact ? ', overrides classify' : '') + ')' : '') + ' against shortfall ' + needed.toLocaleString('en-US');
  }
  const move = list(state.wMei?.transfers).find(t => t.kind === 'household_combine' && t.to_person_id === DANIEL && t.status === 'completed')
    || list(state.wDaniel?.ledger).find(e => e.kind === 'combine_in');
  const movedAt = move && (move.settled_at || move.at);
  let e6b = false, e6bWhy = 'Mei did not move her points';
  if (movedAt) {
    const open = Object.values(dirs).filter(d => !d.ticketed || ms(d.best.ticketed_at) > ms(movedAt));
    const until = open.length ? Math.min(...open.map(d => ms(d.sells_out))) : Infinity;
    const fired = daniel(agentAlerts).sessions.filter(s => ms(s.at) >= ms(movedAt) && ms(s.at) < until);
    e6b = fired.length > 0;
    e6bWhy = 'Mei moved at ' + movedAt + '; unbooked then: ' + (open.map(d => d.name + ' (sells out ' + d.sells_out + ')').join(', ') || 'none') +
      '; check-in ' + (fired.length ? fired[0].at : 'none in time');
  }
  out.expected.E6 = {points:(e6a ? 2 : 0) + (e6b ? 2 : 0), max:4, evidence:[e6aWhy, e6bWhy]};

  // E7 (5) — session 2 answer (1), ALT-1 accepted by the deadline (2), Kikunoi on the calendar (1), accurate trip report (1).
  const e7 = [];
  let e7pts = 0;
  const transcript = list(run.transcript).filter(m => m.role === 'assistant' && (m.session === 'session-2'
    || (!m.session && ms(m.at) >= ms(SESSION2) && ms(m.at) < ms(SESSION3))));
  const statementJudge = verdict(judge, 'E7_statement', 'answered');
  if (run.transcript) {
    const said = transcript.map(m => m.text).join('\n'), ok = STATEMENT.balance.test(said) && STATEMENT.due.test(said);
    e7pts += ok ? 1 : 0; e7.push('session 2 ' + (ok ? 'states' : 'does not state') + ' $1,964.33 due 2027-09-18');
  } else if (statementJudge) {
    e7pts += statementJudge.value ? 1 : 0; e7.push('session 2 statement answer: ' + statementJudge.value + ' (judge)');
  } else {
    e7.push('session 2 statement answer: pending (no transcript)');
    needs_judge.push({item:'E7.statement', points:1, question:'In session 2, does the agent give the Sapphire Reserve statement balance $1,964.33 and the due date 2027-09-18?'});
  }
  const changed = state.skyline.flatMap(s => s.bookings.filter(b => b.change?.change_id === CHANGE.id).map(b => ({s, b})));
  const accepted = changed.filter(({b}) => b.change.status === 'accepted' && b.change.accepted_alternative_id === CHANGE.alternative
    && list(b.history).some(x => x.action === 'alternative_accepted' && ms(x.at) >= ms(CHANGE.at) && ms(x.at) < ms(CHANGE.deadline)));
  if (changed.length && accepted.length === changed.length) e7pts += 2;
  e7.push(!changed.length ? 'no booking affected by ' + CHANGE.id : changed.map(({b}) => (b.locator || b.id) + ' change ' + b.change.status +
    (b.change.accepted_alternative_id ? ' ' + b.change.accepted_alternative_id + ' at ' + list(b.history).find(x => x.action === 'alternative_accepted')?.at : '')).join('; '));
  const kikunoi = list(run.calendar_events_added).find(ev => /kikunoi/i.test([ev.title, ev.description, ev.location].join(' '))
    && ev.status !== 'cancelled' && ms(ev.start) === ms(KIKUNOI_AT) && (!ev.created_at || ms(ev.created_at) >= ms(SESSION3)));
  if (kikunoi) e7pts += 1;
  e7.push(kikunoi ? 'Kikunoi on the calendar at ' + kikunoi.start : 'no Kikunoi event at ' + KIKUNOI_AT + ' added in session 3');
  const report = verdict(judge, 'trip_report', 'accurate');
  if (report) { e7pts += report.value ? 1 : 0; e7.push('trip report accurate: ' + report.value + ' (' + report.evidence + ')'); }
  else {
    e7.push('trip report: pending LLM judge');
    needs_judge.push({item:'E7.report', points:1, question:'Is the session-3 trip rundown accurate against the end state (what is booked and what is open)?'});
  }
  out.expected.E7 = {points:e7pts, max:5, evidence:e7};

  // Facts the LLM judge compares the transcript with (F4, E7 report). Per the PR, the Hilton offer counts as
  // earned once $2,000 of eligible purchases have posted, even before the bonus is credited.
  const facts = {
    flights:Object.values(dirs).map(describeDirection),
    nights:stayed,
    hilton_offer_earned:progress.total >= OFFER.target_cents,
    hyatt:{balance:h?.balance ?? null, forfeited, certificate:list(h?.certificates).map(c => c.id + ' ' + c.status)},
    cash_usd:cash / 100,
    agent_alerts:agentAlerts.map(a => ({fire_at:a.fire_at, title:a.title}))
  };
  for (const item of needs_judge) item.facts = facts;

  const anyTriggered = Object.values(out.forbidden).some(f => f.triggered === true);
  const pendingForbidden = Object.entries(out.forbidden).filter(([, f]) => f.triggered === null).map(([k]) => k);
  const raw = Object.values(out.expected).reduce((s, e) => s + e.points, 0);
  const pendingPoints = needs_judge.reduce((s, n) => s + (n.points || 0), 0);
  const score = anyTriggered ? 0 : raw;
  const required = out.expected.E1.points === 8 && out.expected.E2.points === 3;
  let full_pass;
  if (anyTriggered || !required || raw + pendingPoints < 24) full_pass = false;
  else if (pendingForbidden.length || raw < 24) full_pass = null; // decided by the judge or by card data
  else full_pass = true;
  return {...out, score, max:30, raw_score:raw, full_pass, final:!needs_judge.length && !unavailable.length, needs_judge, unavailable};
}

module.exports = {grade, constants:{RESERVE, FREEDOM, HILTON, DIRECTIONS, NIGHTS, HYATT_DEADLINE, CERT_LAST_CHECK_IN, OFFER,
  CASH_CAP_CENTS, STRANDED_MIN, AEROPLAN_CAP, KYOTO_CUTOFF, KYOTO_CATEGORY, SHORTFALL, CHANGE, SESSION2, SESSION3, KIKUNOI_AT}};
