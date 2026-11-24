'use strict';
// Agent business operations. Reads are projections; writes change only request/authorization
// records. Physical progress, carrier decisions and handoffs arrive as trusted events.
const c = require('./common.cjs');
const v = require('./views.cjs');
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
    const items = data.grants.filter(g => {
      const s = data.shipments.find(x => x.id === g.shipment_id);
      if (args.shipment_id && g.shipment_id !== args.shipment_id) return false;
      // Recipients see every grant on their parcels; a delegate sees only their own live grants.
      return s.recipient_person_id === me || (g.collector_person_id === me && c.liveGrant(ctx, s, g));
    });
    return {items: copy(items)};
  },
  'pass.get'(ctx, data, args) {
    const {shipment, access} = c.visibleShipment(ctx, data, args.shipment_id);
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
    return {items: copy(data.notices.filter(n => n.audience.includes(me) && (!args.shipment_id || n.shipment_id === args.shipment_id)))};
  }
};

// Planned in the next implementation step: eligibility/preview, submissions, cancellation and grants.
const PLANNED = ['options.get', 'change.preview', 'change.submit', 'change.cancel', 'grant.preview', 'grant.create', 'grant.revoke'];

function handleTool(ctx, data, tool, args) {
  const op = c.name(tool);
  if (READS[op]) return {data, result: READS[op](ctx, data, args)};
  if (PLANNED.includes(op)) fail('not_implemented', 'This operation is not implemented yet.');
  fail('unknown_tool', 'Unknown business operation.');
}

module.exports = {handleTool};
