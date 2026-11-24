'use strict';
// Agent business operations. Reads are projections; writes change only request/authorization
// records. Physical progress, carrier decisions and handoffs arrive as trusted events.
const c = require('./common.cjs');
const v = require('./views.cjs');
const ch = require('./changes.cjs');
const gr = require('./grants.cjs');
const {fail, copy, now, ms} = c;

const READS = {
  'shipments.list'(ctx, data, args) {
    const query = (args.query || '').toLocaleLowerCase();
    const items = data.shipments
      .map(s => ({s, access: c.accessTo(ctx, data, s)}))
      .filter(({s, access}) => access && (args.include_closed || !c.TERMINAL.includes(s.status)))
      .map(({s, access}) => v.summary(ctx, data, s, access))
      .filter(x => !query || [x.id, x.tracking_number, x.sender_label, x.contents_label, x.status].join(' ').toLocaleLowerCase().includes(query))
      .sort((a, b) => ms(b.updated_at) - ms(a.updated_at));
    return {items};
  },
  'shipments.get'(ctx, data, args) {
    const {shipment, access} = c.visibleShipment(ctx, data, args.id);
    return {shipment: v.shipmentView(ctx, data, shipment, access)};
  },
  'options.get'(ctx, data, args) {
    const {shipment} = c.visibleShipment(ctx, data, args.id, {recipientOnly: true});
    return {options: ch.options(ctx, data, shipment)};
  },
  'change.preview'(ctx, data, args) {
    const {shipment} = c.visibleShipment(ctx, data, args.id, {recipientOnly: true});
    const {id, ...input} = args, e = ch.evaluate(ctx, data, shipment, input);
    return {preview: {allowed: e.allowed, reason: e.reason, summary: e.summary, confirmation: e.confirmation, current_plan: copy(shipment.plan), proposed_plan: e.target}};
  },
  // Only the acting person's own address book; a collector never sees the recipient's.
  'addresses.list'(ctx, data) {
    return {items: data.addresses.filter(a => a.person_id === data.owner_person_id).map(({person_id, ...address}) => copy(address))};
  },
  'points.list'(ctx, data, args) {
    const query = (args.query || '').toLocaleLowerCase();
    const items = data.pickup_points.map(p => v.pointView(ctx, p))
      .filter(p => (!args.accessible_only || p.accessible) && (!args.open_only || p.status === 'open'))
      .filter(p => !query || [p.id, p.name, p.address_text, p.kind].join(' ').toLocaleLowerCase().includes(query));
    return {items};
  },
  'changes.list'(ctx, data, args) {
    if (args.shipment_id) c.visibleShipment(ctx, data, args.shipment_id, {recipientOnly: true});
    const own = new Set(data.shipments.filter(s => s.recipient_person_id === data.owner_person_id).map(s => s.id));
    return {items: copy(data.changes.filter(x => own.has(x.shipment_id) && (!args.shipment_id || x.shipment_id === args.shipment_id)))};
  },
  'collectors.list'(ctx, data) {
    return {items: data.collectors.filter(x => x.recipient_person_id === data.owner_person_id)
      .map(x => ({person_id: x.person_id, name: c.personName(ctx, x.person_id), relationship: x.relationship}))};
  },
  'grants.list'(ctx, data, args) {
    if (args.shipment_id) c.visibleShipment(ctx, data, args.shipment_id);
    const me = data.owner_person_id;
    const items = [];
    for (const g of data.grants) {
      if (args.shipment_id && g.shipment_id !== args.shipment_id) continue;
      const s = data.shipments.find(x => x.id === g.shipment_id);
      // Recipients see every grant on their parcels; a collector sees only their own current grant.
      if (s.recipient_person_id === me) items.push(v.grantView(ctx, data, g, 'recipient'));
      else if (g.collector_person_id === me && c.liveGrant(ctx, s, g)) items.push(v.grantView(ctx, data, g, 'delegate'));
    }
    return {items};
  },
  'grant.preview'(ctx, data, args) {
    const {shipment} = c.visibleShipment(ctx, data, args.id, {recipientOnly: true});
    const {id, ...input} = args, {replaced, ...preview} = gr.evaluate(ctx, data, shipment, input);
    return {preview};
  },
  'pass.get'(ctx, data, args) {
    const {shipment, access} = c.visibleShipment(ctx, data, args.id);
    const me = data.owner_person_id;
    const pass = data.passes.find(p => p.shipment_id === shipment.id && p.holder_person_id === me && p.status === 'active');
    if (!pass || shipment.status !== 'at_pickup') fail('not_available', 'There is no current collection pass for this parcel.');
    const point = c.pointOf(data, pass.point_id);
    return {pass: {id: pass.id, shipment_id: pass.shipment_id, holder_person_id: me, role: access, point_id: pass.point_id, point_name: point.name,
      pickup_epoch: pass.pickup_epoch, code: pass.code, issued_at: pass.issued_at, expires_at: pass.expires_at, valid_now: now(ctx) < ms(pass.expires_at)}};
  },
  'notices.list'(ctx, data, args) {
    if (args.shipment_id) c.visibleShipment(ctx, data, args.shipment_id);
    const me = data.owner_person_id;
    // Access follows current ownership and grants: a notice is readable only while its parcel is.
    const visible = new Set(data.shipments.filter(s => c.accessTo(ctx, data, s)).map(s => s.id));
    return {items: copy(data.notices.filter(n => n.audience.includes(me) && (n.shipment_id === null || visible.has(n.shipment_id)) &&
      (!args.shipment_id || n.shipment_id === args.shipment_id)))};
  }
};

const WRITES = {
  // A submission only records a pending request. The plan changes when the carrier applies it.
  'change.submit'(ctx, data, args) {
    const {shipment: s} = c.visibleShipment(ctx, data, args.id, {recipientOnly: true});
    const {id, confirmation, expected_version, request_id, ...input} = args;
    const e = ch.evaluate(ctx, data, s, input);
    if (!e.allowed) fail(e.reason, e.summary);
    if (confirmation !== e.confirmation) fail('stale_confirmation', ch.MESSAGES.stale_confirmation);
    const at = ctx.virtual_now;
    const change = {id: c.nextId(data.changes, 'C'), shipment_id: s.id, kind: input.kind,
      requested_by_person_id: data.owner_person_id, created_at: at, updated_at: at, base_plan_revision: s.plan.revision,
      target: e.target, status: 'pending', decided_at: null, reason: null, history: [{at, action: 'submitted'}]};
    data.changes.push(change);
    s.pending_change_id = change.id;
    c.timeline(s, at, 'change_requested', 'Change requested: ' + ch.describe(data, e.target) + '. Waiting for the carrier.');
    c.log(ctx, c.APP + '.change_submitted', {shipment_id: s.id, change_id: change.id, kind: input.kind});
    return {change_id: change.id, change_status: 'pending'};
  },
  'change.cancel'(ctx, data, args) {
    const change = data.changes.find(x => x.id === args.id);
    const s = change && data.shipments.find(x => x.id === change.shipment_id);
    if (!s || s.recipient_person_id !== data.owner_person_id) fail('not_found', 'Change request does not exist in this account.');
    if (change.status !== 'pending') fail('too_late', ch.MESSAGES.too_late);
    const at = ctx.virtual_now;
    change.status = 'cancelled';
    change.decided_at = at;
    c.touch(change, at, 'cancelled');
    s.pending_change_id = null;
    c.timeline(s, at, 'change_cancelled', 'Change request withdrawn; the delivery plan is unchanged.');
    c.log(ctx, c.APP + '.change_cancelled', {shipment_id: s.id, change_id: change.id});
    return {change_id: change.id, change_status: 'cancelled'};
  },
  // Only the recipient can authorize, replace or revoke a collector.
  'grant.create'(ctx, data, args) {
    const {shipment} = c.visibleShipment(ctx, data, args.id, {recipientOnly: true});
    const {id, confirmation, expected_version, request_id, ...input} = args;
    return gr.create(ctx, data, shipment, input, confirmation);
  },
  'grant.revoke'(ctx, data, args) {
    return gr.revoke(ctx, data, args.id);
  }
};

function handleTool(ctx, data, tool, args) {
  const op = c.name(tool);
  if (READS[op]) return {data, result: READS[op](ctx, data, args)};
  if (WRITES[op]) return {data, result: WRITES[op](ctx, data, args)};
  fail('unknown_tool', 'Unknown business operation.');
}

module.exports = {handleTool};
