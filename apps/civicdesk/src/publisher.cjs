'use strict';
// Host-run publisher. After CivicDesk has committed a comment, Infra runs this with a trusted Agent connection to CivicDesk
// and a trusted publishing connection to Messaging; it reads the committed record through the public tools, builds the
// notice and calls router.publish. The receipt returns to this caller; Infra may then record the outcome on the comment
// with the comment.notice_recorded event (examples/mail-notice.cjs shows both).
const notices = require('./notices.cjs');
const APP = require('../app.json').app_id, T = APP + '.';
const ok = (result, what) => {if (result.status !== 'ok') throw Object.assign(new Error('Could not read the ' + what + ': ' + (result.message || result.status)), {result}); return result;};
const READERS = {
  async receipt(agent, ref) {return {receipt:ok(await agent.call(T + 'comments.receipt', {id:ref.comment_id}), 'receipt').receipt};},
  async status(agent, ref) {return {comment:ok(await agent.call(T + 'comments.status', {id:ref.comment_id}), 'comment').comment};}
};
async function publish({agent, router, kind, ref, requestId, account, person}) {
  const read = READERS[kind];
  if (!read) throw new Error('Unknown notice kind ' + kind + '.');
  let views;
  try {views = await read(agent, ref);} catch (e) {if (e.result) return {stage:'source_read', kind, result:e.result}; throw e;}
  const message = notices.build(kind, views, {account, person});
  const receipt = await router.call('router.publish', {request_id:requestId, message});
  return {stage:receipt.status === 'committed' ? (receipt.duplicate ? 'duplicate' : 'delivered') : 'router_rejected', kind, request_id:requestId, message, result:receipt};
}
module.exports = {publish, build:notices.build, KINDS:notices.KINDS};
