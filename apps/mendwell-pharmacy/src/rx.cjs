'use strict';
const { fail, byId } = require('./util.cjs');
const { validDate, localDate, ms } = require('./time.cjs');
const { notifyRenewal } = require('./notices.cjs');
const L = require('./lifecycle.cjs');

function newRx(data, fields, at) {
  if (byId(data.prescriptions, 'rx_id', fields.rx_id)) fail('invalid_event', 'Prescription ' + fields.rx_id + ' already exists.');
  if (!validDate(fields.written_on)) fail('invalid_event', 'written_on ' + fields.written_on + ' is not a calendar date between 1900 and 2201.');
  if (fields.written_on > localDate(ms(at))) fail('invalid_event', 'written_on ' + fields.written_on + ' is after the event date.');
  const rx = { rx_id: fields.rx_id, patient_id: fields.patient_id, prescriber_id: fields.prescriber_id, drug_id: fields.drug_id, quantity: fields.quantity, fills_authorized: fields.fills_authorized, fills_remaining: fields.fills_authorized, written_on: fields.written_on, received_at: at, state: 'active', superseded_by: null, superseded_at: null };
  data.prescriptions.push(rx);
  return rx;
}

function rxReceived(data, payload, ctx) {
  newRx(data, payload, ctx.virtual_now);
  return data;
}

function renewalReplied(data, payload, ctx) {
  const at = ctx.virtual_now, rn = byId(data.renewals, 'renewal_id', payload.renewal_id);
  if (rn.state !== 'pending') return data;
  const old = byId(data.prescriptions, 'rx_id', rn.rx_id);
  if (payload.decision === 'denied') {
    Object.assign(rn, { state: 'denied', closed_at: at });
    notifyRenewal(data, rn, at, { decision: 'denied' });
    return data;
  }
  const rx = newRx(data, { ...payload.rx, patient_id: old.patient_id, prescriber_id: old.prescriber_id, drug_id: old.drug_id }, at);
  Object.assign(old, { state: 'superseded', superseded_by: rx.rx_id, superseded_at: at });
  Object.assign(rn, { state: 'approved', new_rx_id: rx.rx_id, closed_at: at });
  for (const f of data.fills.filter(x => x.rx_id === old.rx_id && L.UNMADE.has(x.state)).sort((a, b) => (a.fill_id < b.fill_id ? -1 : 1))) L.cancel(data, f, at, 'rx_superseded');
  notifyRenewal(data, rn, at, { decision: 'approved', new_rx_id: rx.rx_id });
  return data;
}

module.exports = { rxReceived, renewalReplied };
