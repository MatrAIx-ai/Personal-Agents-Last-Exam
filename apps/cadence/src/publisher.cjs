'use strict';
// Host-run publisher. After Cadence has committed a record, Infra runs this with a trusted Agent connection to
// Cadence and a trusted publishing connection to Messaging. It reads the committed record through the public tools,
// builds the notice and calls router.publish. The receipt returns to this caller; Cadence itself never learns the
// delivery outcome and stores no notice status.
const notices = require('./notices.cjs');
const APP = require('../app.json').app_id, T = APP + '.';
const ok = (result, what) => {if (result.status !== 'ok') throw Object.assign(new Error('Could not read the ' + what + ': ' + (result.message || result.status)), {result}); return result;};
const find = (list, key, id, what) => {const x = list.find(item => item[key] === id); if (!x) throw new Error(what + ' ' + id + ' is not visible on this account.'); return x;};
const reservation = async (agent, ref) => ({reservation:ok(await agent.call(T + 'reservations.get', {id:ref.reservation_id}), 'reservation').reservation});
const READERS = {
  booking_confirmed:reservation, cancelled_by_studio:reservation, schedule_changed:reservation,
  async waitlist_offer(agent, ref) {return {entry:find(ok(await agent.call(T + 'waitlist.list', {}), 'waitlist').entries, 'id', ref.waitlist_entry_id, 'Waitlist entry')};},
  async trial_ending(agent) {return {plan:ok(await agent.call(T + 'plan.get', {}), 'plan').plan};},
  async renewal_receipt(agent, ref) {const r = ok(await agent.call(T + 'plan.get', {}), 'plan'); return {plan:r.plan, receipt:find(r.receipts, 'receipt_id', ref.receipt_id, 'Receipt')};}
};
async function publish({agent, router, kind, ref = {}, requestId, account, person}) {
  const read = READERS[kind];
  if (!read) throw new Error('Unknown notice kind ' + kind + '.');
  let views;
  try {views = {account:ok(await agent.call(T + 'account.get', {}), 'account').account, ...(await read(agent, ref))};}
  catch (e) {if (e.result) return {stage:'source_read', kind, result:e.result}; throw e;}
  const message = notices.build(kind, views, {account, person});
  const receipt = await router.call('router.publish', {request_id:requestId, message});
  return {stage:receipt.status === 'committed' ? (receipt.duplicate ? 'duplicate' : 'delivered') : 'router_rejected', kind, request_id:requestId, message, result:receipt};
}
module.exports = {publish, build:notices.build, KINDS:notices.KINDS};
