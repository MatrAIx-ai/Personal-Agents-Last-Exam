'use strict';
const {fail, copy, ms, cents, money, twoDecimals, sum, references} = require('./domain-utils.cjs');
const time = require('./time.cjs');
const {log} = require('./diagnostics.cjs');
const APP = require('../app.json').app_id;

const zone = data => data.insurer.timezone;
const policyOf = (data, claim) => data.policies.find(p => p.id === claim.policy_id);
const coverageOf = (policy, type) => policy.coverages.find(c => c.type === type) || null;
const vehicleOf = (policy, id) => policy.vehicles.find(v => v.id === id) || null;
// The insured item of a claim: a vehicle for collision and comprehensive, the insured address for personal property.
function subjectOf(policy, coverage, id) {
  if (coverage === 'personal_property') return policy.insured_address && policy.insured_address.id === id ? policy.insured_address : null;
  return vehicleOf(policy, id);
}
const knownSubject = (policy, id) => !!vehicleOf(policy, id) || !!policy.insured_address && policy.insured_address.id === id;
function findPolicy(data, id) {
  return data.policies.find(p => p.id === id) || fail('not_found', 'No policy has this ID.');
}
function findClaim(data, id) {
  return data.claims.find(c => c.id === id) || fail('not_found', 'No claim has this ID.');
}
// Every line of a claim, with its estimate.
const linesOf = claim => claim.estimates.flatMap(estimate => estimate.lines.map(line => ({line, estimate})));
const findLine = (claim, id) => linesOf(claim).find(row => row.line.id === id) || null;
const standing = line => line.decisions[line.decisions.length - 1] || null;
// An offer stored as `open` reads `expired` once the clock reaches its `respond_by`. Nothing is rewritten.
// It also reads `expired` when its claim has a later offer or is not open: the seed rules allow that only after its `respond_by`.
function offerState(claim, offer, now) {
  if (offer.state !== 'open') return offer.state;
  const last = claim.offers[claim.offers.length - 1] === offer;
  return last && claim.state === 'open' && now < ms(offer.respond_by) ? 'open' : 'expired';
}
const lossDay = (data, claim) => time.localDay(ms(claim.loss_at), zone(data));

function allIds(data) {
  const ids = [];
  for (const p of data.policies) ids.push(p.id, ...p.vehicles.map(v => v.id), ...(p.insured_address ? [p.insured_address.id] : []));
  for (const c of data.claims) {
    ids.push(c.id);
    for (const part of ['evidence', 'requests', 'estimates', 'determinations', 'disputes', 'offers', 'rentals', 'payments']) ids.push(...c[part].map(x => x.id));
  }
  ids.push(...data.notifications.map(n => n.id));
  return ids;
}
// IDs made by the App: a prefix and the next number after the highest one in use.
function nextId(ids, prefix, width = 4) {
  const taken = new Set(ids);
  let next = 1;
  for (const id of taken) {
    if (id.startsWith(prefix) && /^\d{1,12}$/.test(id.slice(prefix.length))) next = Math.max(next, Number(id.slice(prefix.length)) + 1);
  }
  while (taken.has(prefix + String(next).padStart(width, '0'))) next++;
  return prefix + String(next).padStart(width, '0');
}
// One activity row for a write, an event or one of their effects, and one history row on the claim.
function record(t, data, claim, action, objectId, effect = false) {
  data.activity.push({seq: data.activity.length ? data.activity[data.activity.length - 1].seq + 1 : 1, at: t.at, actor: t.actor,
    action, object_id: objectId, request_id: t.actor === 'agent' ? t.ref : null, event_id: t.actor === 'event' ? t.ref : null, effect});
  if (claim) claim.history.push({at: t.at, action, actor: t.actor, ref: t.ref});
  log(t.ctx, APP + '.' + action, {object_id: objectId});
}
// What a withdrawal or a closure ends on a claim. Each change is one effect row.
function endClaim(t, data, claim, endedBy) {
  const last = claim.offers[claim.offers.length - 1];
  for (const request of claim.requests) if (request.state === 'open') { request.state = 'void'; record(t, data, claim, 'request.void', request.id, true); }
  for (const dispute of claim.disputes) if (dispute.state === 'open') { dispute.state = 'void'; record(t, data, claim, 'dispute.void', dispute.id, true); }
  // The claim is no longer open here, so its open offer is found by its own time.
  if (last && last.state === 'open' && t.now < ms(last.respond_by)) { last.state = 'superseded'; record(t, data, claim, 'offer.superseded', last.id, true); }
  for (const rental of claim.rentals) if (rental.state === 'active') {
    // A seed can hold a rental that starts after the clock. It then ends at its own start.
    Object.assign(rental, {state: 'ended', end_at: t.now < ms(rental.start_at) ? rental.start_at : t.at, ended_by: endedBy});
    record(t, data, claim, 'rental.ended', rental.id, true);
  }
}
module.exports = {APP, fail, copy, ms, cents, money, twoDecimals, sum, references, time, log, zone, policyOf, coverageOf, vehicleOf, subjectOf,
  knownSubject, findPolicy, findClaim, linesOf, findLine, standing, offerState, lossDay, allIds, nextId, record, endClaim};
