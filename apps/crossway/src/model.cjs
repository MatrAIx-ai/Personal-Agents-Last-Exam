'use strict';
// Record consistency for seeds, events and every committed write.
const {fail, references} = require('./domain-utils.cjs');
const R = require('./rules.cjs');
const C = require('./clock.cjs');

function unique(list, what) {
  const seen = new Set();
  for (const item of list) {
    if (seen.has(item.id)) fail('invalid_seed', `Duplicate ${what} ID ${item.id}.`);
    seen.add(item.id);
  }
  return seen;
}

function ordered(list, what) {
  let previous = -Infinity;
  for (const item of list) {
    const t = C.ms(item.at);
    if (t < previous) fail('invalid_seed', `${what} history is out of order.`);
    previous = t;
  }
}

function validateSeed(ctx, data) {
  references(ctx, data);
  const a = data.authority, pol = a.policy;
  if (!C.validDate(data.opened_on)) fail('invalid_seed', 'opened_on must be a date.');
  const plazas = unique(a.plazas, 'plaza');
  for (const p of a.plazas) {
    if (p.account_cents.length !== pol.vehicle_classes.length || p.mail_cents.length !== pol.vehicle_classes.length) {
      fail('invalid_seed', `Plaza ${p.id} needs one rate per vehicle class.`);
    }
  }
  const agencies = unique(a.rental_agencies, 'rental agency');
  const people = new Set(ctx.binding.people.map(p => p.person_id));
  const cards = unique(data.cards, 'card');
  for (const c of data.cards) if (!people.has(c.holder_person_id)) fail('invalid_seed', `Cardholder of ${c.id} is not in the binding.`);
  if (!cards.has(data.replenish.card_id)) fail('invalid_seed', 'Replenish card is missing.');
  const vehicles = unique(data.vehicles, 'vehicle');
  for (const v of data.vehicles) {
    if (!C.validDate(v.possession_start) || (v.possession_end !== null && !C.validDate(v.possession_end))) fail('invalid_seed', `Vehicle ${v.id} has an invalid date.`);
    if (v.possession_end !== null && v.possession_end < v.possession_start) fail('invalid_seed', `Vehicle ${v.id} ends before it starts.`);
    if (v.class > pol.vehicle_classes.length) fail('invalid_seed', `Vehicle ${v.id} has an unknown class.`);
    if (v.temporary && (v.possession_end === null || C.daysBetween(v.possession_start, v.possession_end) > pol.temporary_plate_max_days)) {
      fail('invalid_seed', `Temporary plate ${v.id} needs an end date within ${pol.temporary_plate_max_days} days.`);
    }
    if (!v.temporary && !v.ended_at && v.possession_end !== null) fail('invalid_seed', `Active vehicle ${v.id} has an end date.`);
    if (v.rental_agency_id !== null && !agencies.has(v.rental_agency_id)) fail('invalid_seed', `Vehicle ${v.id} names an unknown rental agency.`);
  }
  for (let i = 0; i < data.vehicles.length; i++) {
    for (let j = i + 1; j < data.vehicles.length; j++) {
      const x = data.vehicles[i], y = data.vehicles[j];
      if (x.plate === y.plate && R.intervalsOverlap(x, y)) fail('invalid_seed', `Possession intervals of plate ${x.plate} overlap.`);
    }
  }
  unique(data.transponders, 'transponder');
  const carried = new Set();
  for (const t of data.transponders) {
    if (t.vehicle_id === null) continue;
    const v = data.vehicles.find(x => x.id === t.vehicle_id);
    if (!v || v.ended_at) fail('invalid_seed', `Transponder ${t.id} is assigned to a missing or ended vehicle.`);
    if (carried.has(v.id)) fail('invalid_seed', `Vehicle ${v.id} carries two transponders.`);
    carried.add(v.id);
  }
  const tolls = unique(data.tolls, 'toll');
  const notices = unique(data.notices, 'notice');
  for (const t of data.tolls) {
    if (!plazas.has(t.plaza_id)) fail('invalid_seed', `Toll ${t.id} names an unknown plaza.`);
    if (t.vehicle_id !== null && !vehicles.has(t.vehicle_id)) fail('invalid_seed', `Toll ${t.id} names an unknown vehicle.`);
    if (t.transponder_id !== null && !data.transponders.some(x => x.id === t.transponder_id)) fail('invalid_seed', `Toll ${t.id} names an unknown transponder.`);
    if ((t.disposition === 'noticed') !== (t.notice_id !== null)) fail('invalid_seed', `Toll ${t.id} and its notice disagree.`);
    if ((t.disposition === 'debited') !== (t.ledger_id !== null)) fail('invalid_seed', `Toll ${t.id} and its ledger row disagree.`);
  }
  // Every notice maps to exactly one toll, and back.
  for (const n of data.notices) {
    const t = data.tolls.find(x => x.id === n.toll_id);
    if (!t || t.notice_id !== n.id) fail('invalid_seed', `Notice ${n.id} does not map to its toll.`);
    if (n.toll_cents !== t.amount_cents) fail('invalid_seed', `Notice ${n.id} amount differs from its toll.`);
    if (n.dispute_id !== null && !data.disputes.some(d => d.id === n.dispute_id && d.notice_id === n.id)) fail('invalid_seed', `Notice ${n.id} names a missing dispute.`);
    if ((n.state === 'disputed') !== (n.dispute_id !== null && data.disputes.find(d => d.id === n.dispute_id).state === 'submitted')) {
      fail('invalid_seed', `Notice ${n.id} state disagrees with its dispute.`);
    }
    if (n.state === 'paid' && !data.receipts.some(r => r.id === n.payment_receipt_id && r.notice_ids.includes(n.id))) {
      fail('invalid_seed', `Paid notice ${n.id} has no payment receipt.`);
    }
    ordered(n.history, `Notice ${n.id}`);
  }
  unique(data.disputes, 'dispute');
  const disputed = new Set();
  for (const d of data.disputes) {
    if (!notices.has(d.notice_id)) fail('invalid_seed', `Dispute ${d.id} names a missing notice.`);
    if (disputed.has(d.notice_id)) fail('invalid_seed', `Notice ${d.notice_id} has two disputes.`);
    disputed.add(d.notice_id);
    if (!R.REASONS[d.reason] || !d.evidence.every(R.validEvidenceRef)) fail('invalid_seed', `Dispute ${d.id} is malformed.`);
  }
  unique(data.receipts, 'receipt');
  for (const r of data.receipts) if (r.card_id !== null && !cards.has(r.card_id)) fail('invalid_seed', `Receipt ${r.id} names an unknown card.`);
  // The balance reconciles to the cent with the ledger.
  unique(data.ledger, 'ledger row');
  let balance = 0;
  for (const l of data.ledger) {
    balance += l.amount_cents;
    if (l.balance_cents !== balance) fail('invalid_seed', `Ledger row ${l.id} does not reconcile.`);
    if (l.kind === 'toll' && !tolls.has(l.ref_id)) fail('invalid_seed', `Ledger row ${l.id} names a missing toll.`);
    if (l.kind !== 'toll' && !data.receipts.some(r => r.id === l.ref_id)) fail('invalid_seed', `Ledger row ${l.id} names a missing receipt.`);
  }
  ordered(data.ledger, 'Ledger');
  if (balance !== data.balance_cents) fail('invalid_seed', 'The balance does not match the ledger.');
  unique(data.statements, 'statement');
  for (let i = 1; i < data.statements.length; i++) {
    if (data.statements[i].period !== C.nextMonth(data.statements[i - 1].period) ||
      data.statements[i].opening_balance_cents !== data.statements[i - 1].closing_balance_cents) {
      fail('invalid_seed', 'Statements must be consecutive months that carry the balance forward.');
    }
  }
  unique(data.dispute_decisions, 'dispute decision');
  unique(data.outgoing, 'outgoing notice');
  unique(data.run.previews, 'preview');
}

const records = data => [...data.tolls, ...data.notices];
const objects = data => [...data.vehicles, ...data.transponders, ...data.tolls, ...data.notices, ...data.disputes, ...data.receipts, ...data.statements].map(x => x.id);

// Dispute evidence points at other Apps' objects (normally Mail messages), but
// Crossway records those references as given and never resolves them, so it
// declares no references for the host to check.
module.exports = {validateSeed, records, objects, references: () => [], assetReferences: () => []};
