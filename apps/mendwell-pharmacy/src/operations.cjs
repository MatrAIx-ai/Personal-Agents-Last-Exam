'use strict';
const { fail, clone, byId, sortBy, newStep, PROJECTION } = require('./util.cjs');
const { isOpen, clockInRange } = require('./time.cjs');
const { relation, fillAccess } = require('./authority.cjs');
const { guard } = require('./guards.cjs');
const { applyDueTimers } = require('./timers.cjs');
const V = require('./views.cjs');
const fills = require('./fills.cjs');
const cash = require('./cash.cjs');
const requests = require('./requests.cjs');
const grants = require('./grants.cjs');
const payment = require('./payment.cjs');
const cancel = require('./cancel.cjs');

const PREFIX = 'mendwell-pharmacy.';
const KNOWN = new Set(require('../tools.json').map(t => t.name));
const { grantInForce } = require('./model.cjs');

function householdList(ctx, data, args, g) {
  const powers = new Map();
  const add = (id, power) => { if (!powers.has(id)) powers.set(id, new Set()); powers.get(id).add(power); };
  add(g.actor, 'self');
  for (const p of data.people) if (p.is_minor && p.guardian_ids.includes(g.actor)) add(p.person_id, 'guardian');
  const live = data.grants.filter(x => x.grantee_id === g.actor && grantInForce(x, g.now));
  const viewers = new Set(live.filter(x => x.scope === 'view' || x.scope === 'refill').map(x => x.patient_id));
  for (const x of live) {
    if (!viewers.has(x.patient_id)) continue;
    if (x.scope === 'refill') { add(x.patient_id, 'view'); add(x.patient_id, 'refill'); }
    else if (x.scope === 'view') add(x.patient_id, 'view');
    else if (x.fill_id === null) add(x.patient_id, 'pickup');
  }
  const order = ['self', 'guardian', 'view', 'refill', 'pickup'];
  return { people: data.people.filter(p => powers.has(p.person_id)).sort(sortBy('person_id')).map(p => ({ person_id: p.person_id, name: p.name, relation: p.relation, is_minor: p.is_minor, powers: order.filter(x => powers.get(p.person_id).has(x)) })) };
}

function grantsList(ctx, data, args, g) {
  const visible = data.grants.filter(x => (args.patient_id === undefined || x.patient_id === args.patient_id) && (x.grantee_id === g.actor || relation(data, g.actor, x.patient_id, g.now).full)).sort(sortBy('grant_id'));
  const ids = new Set(visible.map(x => x.grant_id));
  const approvals = V.approvalsFor(data, g.actor, g.now, p => (p.kind === 'grant' && ids.has(p.id)) || (p.kind === 'patient' && (args.patient_id === undefined || p.id === args.patient_id)));
  return { grants: visible.map(x => V.grantView(x, g.now)), approvals };
}

function cardsList(ctx, data, args, g) {
  return { cards: data.cards.filter(c => c.owner_id === g.actor).sort(sortBy('card_id')).map(c => ({ card_id: c.card_id, label: c.label, last4: c.last4, exp_month: c.exp_month, exp_year: c.exp_year })) };
}

function storesList(ctx, data, args, g) {
  return { stores: [...data.stores].sort(sortBy('store_id')).map(s => ({ store_id: s.store_id, name: s.name, address: s.address, hours: s.hours.map(h => ({ ...h })), open_now: isOpen(s, g.now), in_stock: args.drug_id === undefined ? null : s.stock[args.drug_id] === true })) };
}

function rxList(ctx, data, args, g) {
  const list = data.prescriptions.filter(rx => (args.patient_id === undefined || rx.patient_id === args.patient_id) && relation(data, g.actor, rx.patient_id, g.now).view).sort(sortBy('rx_id'));
  return { prescriptions: list.map(rx => V.rxView(data, rx, g.now, false)) };
}

const rxGet = (ctx, data, args, g) => ({ prescription: V.rxView(data, g.rx, g.now, true) });

function fillsList(ctx, data, args, g) {
  const rows = [];
  for (const f of [...data.fills].sort(sortBy('fill_id'))) {
    const rx = byId(data.prescriptions, 'rx_id', f.rx_id);
    if (args.state !== undefined && f.state !== args.state) continue;
    if (args.patient_id !== undefined && rx.patient_id !== args.patient_id) continue;
    if (args.rx_id !== undefined && f.rx_id !== args.rx_id) continue;
    const access = fillAccess(relation(data, g.actor, rx.patient_id, g.now), f.fill_id);
    if (access) rows.push(V.fillView(data, f, access, g.actor, g.now));
  }
  return { fills: rows };
}

const fillsGet = (ctx, data, args, g) => ({ fill: V.fillView(data, g.fill, g.access, g.actor, g.now) });

function fillResult(data, f, g) {
  const access = fillAccess(relation(data, g.actor, byId(data.prescriptions, 'rx_id', f.rx_id).patient_id, g.now), f.fill_id);
  return { fill: V.fillView(data, f, access || 'logistics', g.actor, g.now) };
}

const OPS = {
  'household.list': { read: true, fn: householdList },
  'grants.list': { read: true, fn: grantsList },
  'cards.list': { read: true, fn: cardsList },
  'stores.list': { read: true, fn: storesList },
  'rx.list': { read: true, fn: rxList },
  'rx.get': { read: true, fn: rxGet },
  'fills.list': { read: true, fn: fillsList },
  'fills.get': { read: true, fn: fillsGet },
  'grants.change.preview': { read: true, fn: (ctx, data, args, g) => grants.changePreview(ctx, data, args, g) },
  'fills.choose_cash.preview': { read: true, fn: (ctx, data, args, g) => cash.preview(ctx, data, args, g) },
  'fills.prepay.preview': { read: true, fn: (ctx, data, args, g) => payment.prepayPreview(ctx, data, args, g) },
  'fills.cancel.preview': { read: true, fn: (ctx, data, args, g) => cancel.cancelPreview(ctx, data, args, g) },
  'grants.change.confirm': { fn: (ctx, data, args, g) => grants.changeConfirm(ctx, data, args, g) },
  'fills.request': { fn: (ctx, data, args, g) => fillResult(data, fills.request(data, args, g), g) },
  'fills.change_quantity': { fn: (ctx, data, args, g) => fillResult(data, fills.changeQuantity(data, args, g), g) },
  'fills.change_store': { fn: (ctx, data, args, g) => fillResult(data, fills.changeStore(data, args, g), g) },
  'fills.wait': { fn: (ctx, data, args, g) => fillResult(data, fills.wait(data, args, g), g) },
  'fills.choose_cash.confirm': { fn: (ctx, data, args, g) => fillResult(data, cash.confirm(ctx, data, args, g), g) },
  'fills.set_collector': { fn: (ctx, data, args, g) => fillResult(data, grants.setCollector(data, args, g), g) },
  'fills.prepay.confirm': { fn: (ctx, data, args, g) => fillResult(data, payment.prepayConfirm(ctx, data, args, g), g) },
  'fills.cancel.confirm': { fn: (ctx, data, args, g) => fillResult(data, cancel.cancelConfirm(ctx, data, args, g), g) },
  'plan_requests.create': { fn: (ctx, data, args, g) => ({ plan_request: V.planRequestView(requests.createPlanRequest(data, args, g)) }) },
  'plan_requests.withdraw': { fn: (ctx, data, args, g) => ({ plan_request: V.planRequestView(requests.withdrawPlanRequest(data, args, g)) }) },
  'renewals.create': { fn: (ctx, data, args, g) => ({ renewal: V.renewalView(requests.createRenewal(data, args, g)) }) },
  'renewals.withdraw': { fn: (ctx, data, args, g) => ({ renewal: V.renewalView(requests.withdrawRenewal(data, args, g)) }) },
};

function project(data, now) {
  const copy = clone(data);
  copy[PROJECTION] = true;
  applyDueTimers(copy, now);
  return copy;
}

const READ_ONLY = new Set(require('../tools.json').filter(t => t.read_only).map(t => t.name.slice(PREFIX.length)));
const missingHandler = op => fail('invalid_state', 'Operation ' + op + ' is not available.');

function handleTool(ctx, data, name, args, handlers = OPS) {
  if (!KNOWN.has(name)) fail('unknown_tool', 'Unknown tool ' + name + '.');
  if (!clockInRange(ctx.virtual_now)) fail('invalid_state', 'The App clock ' + ctx.virtual_now + ' is outside the supported range 2000-01-01 to 2199-12-31.');
  const op = name.slice(PREFIX.length), spec = handlers[op];
  if (READ_ONLY.has(op)) {
    const projected = project(data, ctx.virtual_now);
    const g = guard(ctx, projected, op, args);
    if (!spec) missingHandler(op);
    return { data, result: spec.fn(ctx, projected, args, g) };
  }
  applyDueTimers(data, ctx.virtual_now);
  const g = guard(ctx, data, op, args);
  if (!spec) missingHandler(op);
  newStep(data);
  return { data, result: spec.fn(ctx, data, args, g) };
}

module.exports = { handleTool, project, OPS };
