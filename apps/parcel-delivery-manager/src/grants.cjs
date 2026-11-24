'use strict';
// W3 — collection authorizations. Only the recipient can authorize, replace or revoke; a
// collector gets one pass for one parcel at its current pickup point and nothing else.
const crypto = require('node:crypto');
const c = require('./common.cjs');
const cr = require('./credentials.cjs');
const {fail, ms, now, TERMINAL} = c;
const HOUR = 3600000;

const MESSAGES = {
  parcel_closed: 'This parcel has already been delivered, collected or returned.',
  return_started: 'This parcel is being returned to the sender and can no longer be collected.',
  not_permitted: 'The parcel\'s delivery policy does not permit another person to collect it.',
  not_ready: 'The parcel is not waiting at a pickup point, so nobody can be authorized to collect it yet.',
  deadline_passed: 'The pickup deadline has passed.',
  unknown_collector: 'That person is not one of your trusted collectors.',
  expiry_in_past: 'The authorization must end in the future.',
  expiry_out_of_range: 'The authorization cannot outlast the pickup deadline or the policy\'s maximum duration.',
  already_authorized: 'That person already holds a current authorization for this parcel. Replace or revoke it instead.',
  unknown_grant: 'The authorization to replace does not exist for this parcel.',
  grant_not_active: 'That authorization has already ended.',
  stale_confirmation: 'The parcel changed after the preview, or the confirmation does not match this request. Preview again.'
};

// Whether anyone can be authorized for this parcel now, and until when at the latest.
function gate(ctx, data, s) {
  const policy = c.policyOf(data, s);
  const reason = TERMINAL.includes(s.status) ? 'parcel_closed' : s.status === 'returning' ? 'return_started' : !policy.allow_delegation ? 'not_permitted'
    : s.status !== 'at_pickup' ? 'not_ready' : now(ctx) >= ms(s.pickup.deadline) ? 'deadline_passed' : null;
  return {reason, latest: reason ? null : Math.min(ms(s.pickup.deadline), now(ctx) + policy.max_grant_hours * HOUR)};
}
const trusted = (data, s, personId) => data.collectors.some(x => x.recipient_person_id === s.recipient_person_id && x.person_id === personId);

function evaluate(ctx, data, s, input) {
  const g = gate(ctx, data, s), latest = g.latest === null ? null : c.iso(g.latest);
  const refuse = reason => ({allowed: false, reason, summary: MESSAGES[reason], confirmation: null, point_id: null, expires_at: null, latest_expires_at: latest, replaced: null});
  if (g.reason) return refuse(g.reason);
  // People who are not saved collectors are reported the same way as people who do not exist.
  if (!trusted(data, s, input.collector_person_id)) return refuse('unknown_collector');
  const expires = ms(input.expires_at);
  if (expires <= now(ctx)) return refuse('expiry_in_past');
  if (expires > g.latest) return refuse('expiry_out_of_range');
  let replaced = null;
  if (input.replaces_grant_id) {
    replaced = data.grants.find(x => x.id === input.replaces_grant_id && x.shipment_id === s.id);
    if (!replaced) return refuse('unknown_grant');
    if (replaced.status !== 'active') return refuse('grant_not_active');
  }
  if (data.grants.some(x => x !== replaced && x.shipment_id === s.id && x.collector_person_id === input.collector_person_id && c.liveGrant(ctx, s, x))) return refuse('already_authorized');
  const point = c.pointOf(data, s.pickup.point_id), name = c.personName(ctx, input.collector_person_id) ?? input.collector_person_id;
  const summary = name + ' will be able to collect ' + s.contents_label + ' at ' + point.name + ' until ' + c.iso(expires) + ' with their own pass. ' +
    'They will see only this parcel\'s pickup details and cannot change the parcel or authorize anyone else.' +
    (replaced ? ' This replaces authorization ' + replaced.id + ', whose pass stops working at once.' : '');
  // Bound to the parcel revision and pickup arrival that were previewed.
  const confirmation = 'cf-' + crypto.createHash('sha256')
    .update(JSON.stringify([s.id, s.updated_at, s.pickup.epoch, s.pickup.point_id, input.collector_person_id, expires, replaced?.id ?? null])).digest('hex').slice(0, 24);
  return {allowed: true, reason: null, summary, confirmation, point_id: point.id, expires_at: input.expires_at, latest_expires_at: latest, replaced};
}

function create(ctx, data, s, input, confirmation) {
  const e = evaluate(ctx, data, s, input);
  if (!e.allowed) fail(e.reason, e.summary);
  if (confirmation !== e.confirmation) fail('stale_confirmation', MESSAGES.stale_confirmation);
  const at = ctx.virtual_now, collector = input.collector_person_id;
  // The collector's earlier authorization for this arrival, if any, has expired by the clock.
  for (const old of data.grants) {
    if (old !== e.replaced && old.shipment_id === s.id && old.collector_person_id === collector && old.status === 'active') cr.endGrant(data, old, at, 'expired', 'expired');
  }
  if (e.replaced) cr.endGrant(data, e.replaced, at, 'replaced', 'replaced');
  const grant = {id: c.nextId(data.grants, 'G'), account_id: data.account_id, shipment_id: s.id, collector_person_id: collector, point_id: s.pickup.point_id,
    pickup_epoch: s.pickup.epoch, created_at: at, expires_at: input.expires_at, status: 'active', ended_at: null, end_reason: null,
    replaces_grant_id: e.replaced?.id ?? null, history: [{at, action: 'created'}]};
  data.grants.push(grant);
  const pass = cr.issuePass(data, s, at, collector, input.expires_at, grant.id);
  const point = c.pointOf(data, grant.point_id), name = c.personName(ctx, collector) ?? collector;
  c.timeline(s, at, 'collector_authorized', name + ' authorized to collect at ' + point.name + ' until ' + c.iso(ms(grant.expires_at)) + '.' +
    (e.replaced ? ' Authorization ' + e.replaced.id + ' was replaced.' : ''));
  // The collector is told only what they need to collect this parcel.
  c.notify(ctx, data, {shipment_id: s.id, at, type: 'collection_authorized', audience: [collector],
    message: (c.personName(ctx, s.recipient_person_id) ?? 'The recipient') + ' authorized you to collect ' + s.contents_label + ' at ' + point.name + ' until ' + c.iso(ms(grant.expires_at)) + '.'});
  c.log(ctx, c.APP + '.grant_created', {shipment_id: s.id, grant_id: grant.id, replaced_grant_id: grant.replaces_grant_id});
  return {grant_id: grant.id, pass_id: pass.id};
}

function revoke(ctx, data, grantId) {
  const grant = data.grants.find(x => x.id === grantId);
  const s = grant && data.shipments.find(x => x.id === grant.shipment_id);
  if (!s || s.recipient_person_id !== data.owner_person_id) fail('not_found', 'Authorization does not exist in this account.');
  if (grant.status !== 'active') fail('grant_not_active', MESSAGES.grant_not_active);
  const at = ctx.virtual_now;
  cr.endGrant(data, grant, at, 'revoked', 'revoked');
  c.timeline(s, at, 'collector_revoked', (c.personName(ctx, grant.collector_person_id) ?? grant.collector_person_id) + ' is no longer authorized to collect this parcel.');
  c.log(ctx, c.APP + '.grant_revoked', {shipment_id: s.id, grant_id: grant.id});
  return {grant_id: grant.id, grant_status: 'revoked'};
}

module.exports = {MESSAGES, gate, evaluate, create, revoke};
