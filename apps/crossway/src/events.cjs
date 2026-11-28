'use strict';
// Scenario events, applied by Infra through env.apply_event at the event's time.
// Crossway has no scheduler: time effects due before the event are settled first.
const {fail} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');
const R = require('./rules.cjs');
const C = require('./clock.cjs');
const {settle} = require('./settle.cjs');
const {debitToll, issueNotice} = require('./account.cjs');
const {nextId} = require('./ids.cjs');
const {closeDispute} = require('./disputes.cjs');

const HANDLERS = {
  'crossway.toll.posted'(ctx, data, p, now) {
    if (data.tolls.some(t => t.id === p.toll_id)) fail('invalid_event', `Toll ${p.toll_id} already exists.`);
    if (!data.authority.plazas.some(x => x.id === p.plaza_id)) fail('invalid_event', `Plaza ${p.plaza_id} does not exist.`);
    if ((p.read === 'transponder') !== (p.transponder_id !== null)) fail('invalid_event', 'A transponder read names a transponder; a plate read does not.');
    const plate = R.normalizePlate(p.plate), at = ctx.virtual_now;
    const toll = {id: p.toll_id, plaza_id: p.plaza_id, at, read: p.read, transponder_id: p.transponder_id, plate_seen: plate,
      class_seen: p.class, class_charged: null, rate: null, amount_cents: 0, vehicle_id: null, disposition: 'unmatched',
      notice_id: null, ledger_id: null};
    let v = null;
    if (p.read === 'transponder') {
      const tp = data.transponders.find(x => x.id === p.transponder_id);
      if (!tp) fail('invalid_event', `Transponder ${p.transponder_id} is not on this account.`);
      v = tp.vehicle_id ? R.vehicle(data, tp.vehicle_id) : null;
      // Tolls are charged at the transponder's class, whatever vehicle carries it.
      toll.class_charged = tp.class;
    } else {
      v = data.vehicles.find(x => x.plate === plate && R.possessionCovers(x, now)) || null;
      toll.class_charged = p.class;
    }
    R.rate(data, p.plaza_id, toll.class_charged, 'account');
    toll.vehicle_id = v ? v.id : null;
    data.tolls.push(toll);
    if (p.read === 'plate' && !v) {
      toll.class_charged = null;
      log(ctx, 'crossway.toll_unmatched', {toll_id: toll.id});
      return;
    }
    if (p.read === 'transponder' && !data.suspended_at) {
      toll.rate = 'account';
      toll.amount_cents = R.rate(data, p.plaza_id, toll.class_charged, 'account');
      toll.disposition = 'debited';
      debitToll(data, toll, at, now);
    } else {
      toll.rate = 'mail';
      toll.amount_cents = R.rate(data, p.plaza_id, toll.class_charged, 'mail');
      toll.disposition = 'noticed';
      if (p.read === 'transponder') toll.plate_seen = v ? v.plate : plate;
      issueNotice(data, toll, v, at);
    }
    log(ctx, 'crossway.toll_posted', {toll_id: toll.id, disposition: toll.disposition});
  },
  'crossway.card.status_changed'(ctx, data, p) {
    const c = data.cards.find(x => x.id === p.card_id);
    if (!c) fail('invalid_event', `Card ${p.card_id} is not on this account.`);
    if (c.status === p.status) fail('invalid_event', `Card ${c.id} is already ${p.status}.`);
    c.history.push({at: ctx.virtual_now, action: 'status_changed', from: c.status, to: p.status});
    c.status = p.status;
  },
  'crossway.dispute.decided'(ctx, data, p, now) {
    const n = data.notices.find(x => x.id === p.notice_id);
    if (!n) fail('invalid_event', `Notice ${p.notice_id} does not exist.`);
    for (const entry of p.grant_if) {
      if (!R.REASONS[entry.reason] || !entry.evidence.every(R.validEvidenceRef)) fail('invalid_event', 'Malformed grant_if entry.');
    }
    const d = n.dispute_id ? R.dispute(data, n.dispute_id) : null;
    const id = nextId(data.dispute_decisions, 'dd');
    if (!d || d.state !== 'submitted') {
      data.dispute_decisions.push({id, at: ctx.virtual_now, notice_id: n.id, dispute_id: d ? d.id : null, outcome: 'no_target'});
      return;
    }
    const granted = p.grant_if.some(e => e.reason === d.reason && e.evidence.every(ref => d.evidence.some(x => R.sameRef(x, ref))));
    data.dispute_decisions.push({id, at: ctx.virtual_now, notice_id: n.id, dispute_id: d.id, outcome: granted ? 'granted' : 'denied'});
    closeDispute(data, d, n, granted ? 'granted' : 'denied', ctx.virtual_now, now);
  },
};

function applyEvent(ctx, data, event) {
  const handler = HANDLERS[event.operation];
  if (!handler) fail('invalid_event', 'Unsupported operation.');
  settle(ctx, data);
  handler(ctx, data, event.payload, C.ms(ctx.virtual_now));
  log(ctx, 'crossway.event', {event_id: event.event_id, operation: event.operation});
  return data;
}

module.exports = {applyEvent, HANDLERS};
