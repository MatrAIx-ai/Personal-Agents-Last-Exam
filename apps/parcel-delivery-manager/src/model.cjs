'use strict';
// Record consistency. Core runs validateSeed on loaded history and after every committed
// tool call or event, so these invariants hold for every persisted state.
const {fail, references, ms} = require('./common.cjs');
const t = require('./time.cjs');

const COLLECTIONS = ['addresses', 'pickup_points', 'policies', 'shipments', 'changes', 'grants', 'passes', 'notices'];

function unique(data) {
  for (const key of COLLECTIONS) {
    const seen = new Set();
    for (const item of data[key]) {
      if (seen.has(item.id)) fail('invalid_seed', 'Duplicate ID in ' + key + ': ' + item.id);
      seen.add(item.id);
      if ('account_id' in item && item.account_id !== data.account_id) fail('invalid_seed', 'Record belongs to another account: ' + item.id);
    }
  }
}
function ordered(item, label) {
  let previous = ms(item.created_at);
  if (previous > ms(item.updated_at)) fail('invalid_seed', label + ' timestamps are reversed.');
  for (const entry of item.history) {
    const at = ms(entry.at);
    if (at < previous || at > ms(item.updated_at)) fail('invalid_seed', label + ' has an invalid history timeline.');
    previous = at;
  }
  if (!item.history.length || previous !== ms(item.updated_at)) fail('invalid_seed', label + ' history must include its last update.');
}

function validateSeed(ctx, data) {
  references(ctx, data);
  unique(data);
  const people = new Set(ctx.binding.people.map(p => p.person_id));
  const person = (id, label) => { if (!people.has(id)) fail('invalid_seed', label + ' is not a person in the task binding.'); };
  const find = (key, id, label) => data[key].find(x => x.id === id) || fail('invalid_seed', label + ' references a missing record: ' + id);

  if (!t.validZone(data.carrier.time_zone)) fail('invalid_seed', 'Carrier time zone is not a known zone.');
  const day = (value, label) => { if (value !== null && !t.validDay(value)) fail('invalid_seed', label + ' is not a calendar date.'); };
  for (const a of data.addresses) person(a.person_id, 'Address owner');
  for (const p of data.pickup_points) {
    if (!t.validZone(p.time_zone)) fail('invalid_seed', 'Pickup point time zone is not a known zone: ' + p.id);
    for (const h of p.hours) if (h.opens >= h.closes) fail('invalid_seed', 'Pickup point hours must open before they close: ' + p.id);
  }
  const trusted = new Set();
  for (const c of data.collectors) {
    person(c.recipient_person_id, 'Collector recipient');
    person(c.person_id, 'Collector');
    if (c.person_id === c.recipient_person_id) fail('invalid_seed', 'A recipient is not their own delegate.');
    const key = c.recipient_person_id + '>' + c.person_id;
    if (trusted.has(key)) fail('invalid_seed', 'Duplicate trusted collector.');
    trusted.add(key);
  }

  for (const s of data.shipments) {
    const label = 'Parcel ' + s.id;
    person(s.recipient_person_id, label + ' recipient');
    find('policies', s.policy_id, label);
    ordered(s, label);
    for (let i = 1; i < s.timeline.length; i++) if (ms(s.timeline[i].at) < ms(s.timeline[i - 1].at)) fail('invalid_seed', label + ' timeline is out of order.');
    const plan = s.plan;
    day(plan.delivery_date, label + ' delivery date'); day(plan.hold_until, label + ' hold end'); day(s.estimated_delivery, label + ' estimated delivery');
    if (['out_for_delivery', 'attempt_failed', 'delivered'].includes(s.status) && plan.mode !== 'home') fail('invalid_seed', label + ' status requires a home delivery plan.');
    if (s.status === 'collected' && plan.mode !== 'pickup') fail('invalid_seed', label + ' can only be collected under a pickup plan.');
    if (plan.mode === 'pickup') {
      if (!plan.point_id || plan.address_id || plan.delivery_date || plan.hold_until) fail('invalid_seed', label + ' pickup plan must name only a point.');
      find('pickup_points', plan.point_id, label);
    } else {
      if (!plan.address_id || plan.point_id) fail('invalid_seed', label + ' home or hold plan must name only an address.');
      const address = find('addresses', plan.address_id, label);
      if (address.person_id !== s.recipient_person_id || !address.verified) fail('invalid_seed', label + ' must use a verified address of its recipient.');
      if ((plan.mode === 'hold') !== Boolean(plan.hold_until)) fail('invalid_seed', label + ' hold plans, and only hold plans, carry hold_until.');
    }
    // Pickup readiness is tied to the current pickup arrangement and epoch.
    if ((s.status === 'at_pickup') !== Boolean(s.pickup)) fail('invalid_seed', label + ' pickup readiness must match its status.');
    if (s.pickup) {
      if (plan.mode !== 'pickup' || s.pickup.point_id !== plan.point_id || s.pickup.epoch !== s.pickup_epoch) fail('invalid_seed', label + ' readiness does not match its current pickup plan.');
      if (ms(s.pickup.deadline) <= ms(s.pickup.ready_at)) fail('invalid_seed', label + ' pickup deadline must follow readiness.');
    }
    if ((s.status === 'attempt_failed') !== Boolean(s.attempt)) fail('invalid_seed', label + ' failed-delivery details must match its status.');
    if (['returning', 'returned'].includes(s.status) !== Boolean(s.return_info)) fail('invalid_seed', label + ' return details must match its status.');
    if (s.return_info && (s.status === 'returned') !== Boolean(s.return_info.completed_at)) fail('invalid_seed', label + ' return completion must match its status.');
    if (['delivered', 'collected', 'returned'].includes(s.status) !== Boolean(s.completed_at)) fail('invalid_seed', label + ' completion time must match a terminal status.');
    const pending = data.changes.filter(c => c.shipment_id === s.id && c.status === 'pending');
    if (pending.length > 1) fail('invalid_seed', label + ' has more than one pending change.');
    if ((pending[0]?.id ?? null) !== s.pending_change_id) fail('invalid_seed', label + ' pending change reference is inconsistent.');
  }

  for (const c of data.changes) {
    const s = find('shipments', c.shipment_id, 'Change ' + c.id);
    person(c.requested_by_person_id, 'Change requester');
    ordered(c, 'Change ' + c.id);
    if (c.base_plan_revision > s.plan.revision) fail('invalid_seed', 'Change ' + c.id + ' is based on a future plan revision.');
    if ((c.status === 'pending') === Boolean(c.decided_at)) fail('invalid_seed', 'Change ' + c.id + ' decision time must match its status.');
  }

  for (const g of data.grants) {
    const s = find('shipments', g.shipment_id, 'Grant ' + g.id);
    if (!g.history.length || g.history.some((h, i) => ms(h.at) < ms(i ? g.history[i - 1].at : g.created_at))) fail('invalid_seed', 'Grant ' + g.id + ' has an invalid history timeline.');
    if (ms(g.expires_at) <= ms(g.created_at)) fail('invalid_seed', 'Grant ' + g.id + ' must expire after it is created.');
    if (!trusted.has(s.recipient_person_id + '>' + g.collector_person_id)) fail('invalid_seed', 'Grant ' + g.id + ' names someone who is not a trusted collector.');
    if ((g.status === 'active') === Boolean(g.ended_at)) fail('invalid_seed', 'Grant ' + g.id + ' end time must match its status.');
    if (g.status === 'active' && !(s.pickup && s.pickup.epoch === g.pickup_epoch && s.pickup.point_id === g.point_id)) fail('invalid_seed', 'Active grant ' + g.id + ' does not match the current pickup.');
    if (g.status === 'active' && ms(g.expires_at) > ms(s.pickup.deadline)) fail('invalid_seed', 'Grant ' + g.id + ' outlasts the pickup deadline.');
    if (g.replaces_grant_id) find('grants', g.replaces_grant_id, 'Grant ' + g.id);
  }
  const holders = new Set();
  for (const p of data.passes) {
    const s = find('shipments', p.shipment_id, 'Pass ' + p.id);
    if ((p.status === 'active') === Boolean(p.ended_at)) fail('invalid_seed', 'Pass ' + p.id + ' end time must match its status.');
    if (p.grant_id) {
      const g = find('grants', p.grant_id, 'Pass ' + p.id);
      if (g.shipment_id !== s.id || g.collector_person_id !== p.holder_person_id || g.pickup_epoch !== p.pickup_epoch) fail('invalid_seed', 'Pass ' + p.id + ' does not match its grant.');
      if (p.status === 'active' && g.status !== 'active') fail('invalid_seed', 'Pass ' + p.id + ' outlived its grant.');
    } else if (p.holder_person_id !== s.recipient_person_id) fail('invalid_seed', 'Pass ' + p.id + ' without a grant must belong to the recipient.');
    if (p.status === 'active') {
      if (!(s.pickup && s.pickup.epoch === p.pickup_epoch && s.pickup.point_id === p.point_id)) fail('invalid_seed', 'Active pass ' + p.id + ' does not match the current pickup.');
      if (ms(p.expires_at) > ms(s.pickup.deadline)) fail('invalid_seed', 'Pass ' + p.id + ' outlasts the pickup deadline.');
      const key = s.id + '>' + p.holder_person_id;
      if (holders.has(key)) fail('invalid_seed', 'More than one active pass for one holder and parcel.');
      holders.add(key);
    }
  }
  for (const n of data.notices) {
    if (n.shipment_id) find('shipments', n.shipment_id, 'Notice ' + n.id);
    n.audience.forEach(id => person(id, 'Notice audience'));
  }
}

module.exports = {
  validateSeed,
  // Parcels are the primary records. Core counts records against objects when a Task loads
  // history without a resource bundle, so both hooks describe the same set.
  records: data => data.shipments,
  objects: data => data.shipments.map(s => s.id),
  references: () => []
};
