'use strict';
// Host-run publisher. After the portal has committed a record, Infra runs this with a trusted Agent connection
// to the portal and a trusted publishing connection to Messaging. It reads the committed record through the
// public tools, builds the notice and calls router.publish. The receipt returns to this caller: the portal
// never observes delivery and stores no notice status (business tests and the connected example check it).
const notices = require('./notices.cjs');
const APP = require('../app.json').app_id, T = APP + '.';

const ok = (result, what) => {if (result.status !== 'ok') throw Object.assign(new Error('Could not read the ' + what + ': ' + (result.message || result.status)), {result}); return result;};
const find = (list, key, id, what) => {const x = list.find(item => item[key] === id); if (!x) throw new Error(what + ' ' + id + ' is not visible on this account.'); return x;};
const READERS = {
  async new_message(agent, ref) {return {thread:ok(await agent.call(T + 'messages.get', {id:ref.thread_id}), 'thread').thread, message_id:ref.message_id};},
  async statement_ready(agent, ref) {return {statement:find(ok(await agent.call(T + 'billing.list', {}), 'ledger').statements, 'statement_id', ref.statement_id, 'Statement')};},
  async request_decided(agent, ref) {return {request:find(ok(await agent.call(T + 'billing.requests.list', {}), 'requests').requests, 'request_id', ref.request_id, 'Request')};},
  async appointment_confirmation(agent, ref) {return {appointment:ok(await agent.call(T + 'appointments.get', {id:ref.appointment_id}), 'appointment').appointment};},
  async appointment_changed(agent, ref) {
    const appointment = ok(await agent.call(T + 'appointments.get', {id:ref.appointment_id}), 'appointment').appointment;
    const replacement = appointment.replaced_by ? ok(await agent.call(T + 'appointments.get', {id:appointment.replaced_by}), 'replacement appointment').appointment : null;
    return {appointment, replacement};
  },
  async appointment_reminder(agent, ref) {return {appointment:ok(await agent.call(T + 'appointments.get', {id:ref.appointment_id}), 'appointment').appointment};},
  async waitlist_offer(agent, ref) {return {entry:find(ok(await agent.call(T + 'waitlist.list', {}), 'waitlist').entries, 'waitlist_entry_id', ref.waitlist_entry_id, 'Waitlist entry')};}
};

// kind: one of notices.KINDS; ref: the record IDs the event or write reported; account/person: the trusted binding.
async function publish({agent, router, kind, ref, requestId, account, person}) {
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
