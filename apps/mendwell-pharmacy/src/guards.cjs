'use strict';
const { fail, byId } = require('./util.cjs');
const { ms, toIso } = require('./time.cjs');
const { actorId, relation, fillAccess, deny } = require('./authority.cjs');

const fill = (power, key = 'fill_id') => ({ subject: 'fill', key, power });
const GUARDS = {
  'household.list': { subject: null, power: 'none' },
  'grants.list': { subject: 'patient?', key: 'patient_id', power: 'none' },
  'cards.list': { subject: null, power: 'none' },
  'stores.list': { subject: 'drug?', key: 'drug_id', power: 'none' },
  'rx.list': { subject: 'patient?', key: 'patient_id', power: 'view' },
  'rx.get': { subject: 'rx', key: 'rx_id', power: 'view' },
  'fills.list': { subject: 'filters', power: 'view' },
  'fills.get': fill('see'),
  'grants.change.preview': { subject: 'grant-change', power: 'full' },
  'grants.change.confirm': { subject: 'grant-change', power: 'full' },
  'fills.choose_cash.preview': fill('refill'),
  'fills.choose_cash.confirm': fill('refill'),
  'fills.prepay.preview': fill('see'),
  'fills.prepay.confirm': fill('see'),
  'fills.cancel.preview': fill('refill'),
  'fills.cancel.confirm': fill('refill'),
  'fills.request': { subject: 'rx+store', power: 'refill' },
  'fills.change_quantity': fill('refill'),
  'fills.change_store': fill('refill'),
  'fills.wait': fill('refill'),
  'fills.set_collector': fill('refill'),
  'plan_requests.create': fill('refill'),
  'plan_requests.withdraw': { subject: 'plan_request', key: 'plan_request_id', power: 'refill' },
  'renewals.create': { subject: 'rx', key: 'rx_id', power: 'refill' },
  'renewals.withdraw': { subject: 'renewal', key: 'renewal_id', power: 'refill' },
};

const EVENT_TARGETS = {
  'rx.received': p => [['patient', p.patient_id], ['prescriber', p.prescriber_id], ['drug', p.drug_id]],
  'renewal.replied': p => [['renewal', p.renewal_id]],
  'plan.decided': p => [['plan_request', p.plan_request_id]],
  'grant.changed': p => [['patient?', p.patient_id], ['person?', p.grantor_id], ['person?', p.grantee_id], ['fill?', p.fill_id]],
  'fill.hold_placed': p => [['fill', p.fill_id]],
  'fill.hold_released': p => [['fill', p.fill_id]],
  'store.restocked': p => [['store', p.store_id], ['drug', p.drug_id]],
  'fill.collection_attempted': p => [['fill', p.fill_id]],
  'user.confirmed': p => [['person', p.confirmed_by]],
};

const LOOKUP = {
  patient: (d, id) => byId(d.people, 'person_id', id), person: (d, id) => byId(d.people, 'person_id', id), prescriber: (d, id) => byId(d.prescribers, 'prescriber_id', id),
  drug: (d, id) => byId(d.drugs, 'drug_id', id), store: (d, id) => byId(d.stores, 'store_id', id), fill: (d, id) => byId(d.fills, 'fill_id', id),
  rx: (d, id) => byId(d.prescriptions, 'rx_id', id), renewal: (d, id) => byId(d.renewals, 'renewal_id', id), plan_request: (d, id) => byId(d.plan_requests, 'plan_request_id', id),
  grant: (d, id) => byId(d.grants, 'grant_id', id),
};

function eventTargets(data, event) {
  for (const [kind, id] of EVENT_TARGETS[event.operation](event.payload)) {
    const optional = kind.endsWith('?'), k = optional ? kind.slice(0, -1) : kind;
    if (id === undefined || id === null) { if (optional) continue; fail('invalid_event', 'The event names no ' + k + '.'); }
    if (!LOOKUP[k](data, id)) fail('invalid_event', 'The event names an unknown ' + k + ' ' + id + '.');
  }
}

const missing = (what, id) => fail('not_found', 'No ' + what + ' ' + id + '.');
const patientOfFill = (data, f) => byId(data.prescriptions, 'rx_id', f.rx_id).patient_id;

function check(power, rel, fillId, what) {
  if (power === 'view' && !rel.view) deny('view this patient\'s records');
  if (power === 'refill' && !rel.refill) deny(what || 'act on this patient\'s prescriptions');
  if (power === 'full' && !rel.full) deny('change this patient\'s access grants');
  if (power === 'see' && fillAccess(rel, fillId) === null) deny('see this fill');
}

function guard(ctx, data, op, args) {
  const spec = GUARDS[op];
  const now = ms(ctx.virtual_now);
  const g = { actor: actorId(ctx, data), now, at: toIso(now) };
  const rel = patientId => relation(data, g.actor, patientId, g.now);
  if (spec.subject === 'patient?' || spec.subject === 'drug?') {
    const id = args[spec.key];
    if (id !== undefined) {
      if (!LOOKUP[spec.subject.slice(0, -1)](data, id)) missing(spec.subject.slice(0, -1), id);
      if (spec.subject === 'patient?') { g.patientId = id; g.rel = rel(id); check(spec.power, g.rel); }
    }
    return g;
  }
  if (spec.subject === 'filters') {
    const found = [];
    for (const [key, kind] of [['patient_id', 'patient'], ['rx_id', 'rx']]) {
      if (args[key] === undefined) continue;
      const r = LOOKUP[kind](data, args[key]);
      if (!r) missing(kind, args[key]);
      found.push(kind === 'rx' ? r.patient_id : args[key]);
    }
    for (const patientId of found) check('view', rel(patientId));
    return g;
  }
  if (spec.subject === 'rx+store') {
    g.rx = LOOKUP.rx(data, args.rx_id); if (!g.rx) missing('prescription', args.rx_id);
    g.store = LOOKUP.store(data, args.store_id); if (!g.store) missing('store', args.store_id);
    g.patientId = g.rx.patient_id; g.rel = rel(g.patientId); check('refill', g.rel, null, 'request fills for this patient');
    return g;
  }
  if (spec.subject === 'grant-change') {
    const grantArgs = ['patient_id', 'grantee_id', 'scope', 'fill_id', 'expires_at'];
    if (args.action === 'grant' ? args.grant_id !== undefined || !args.patient_id || !args.grantee_id || !args.scope : grantArgs.some(k => args[k] !== undefined) || !args.grant_id) fail('invalid_arguments', 'Use action grant with patient_id, grantee_id, scope and optional fill_id and expires_at, or action revoke with grant_id only.');
    if (args.action === 'grant') {
      if (args.grantee_id === args.patient_id) fail('invalid_arguments', 'A patient cannot be their own grantee.');
      if (args.fill_id !== undefined && args.fill_id !== null && args.scope !== 'pickup') fail('invalid_arguments', 'Only a pickup grant can be limited to one fill.');
      if (!LOOKUP.patient(data, args.patient_id)) missing('person', args.patient_id);
      if (!LOOKUP.person(data, args.grantee_id)) missing('person', args.grantee_id);
      if (args.fill_id !== undefined && args.fill_id !== null && !LOOKUP.fill(data, args.fill_id)) missing('fill', args.fill_id);
      g.patientId = args.patient_id;
    }
    else { g.grant = LOOKUP.grant(data, args.grant_id); if (!g.grant) missing('grant', args.grant_id); g.patientId = g.grant.patient_id; }
    g.rel = rel(g.patientId); check('full', g.rel);
    return g;
  }
  if (spec.subject === null) return g;
  const record = LOOKUP[spec.subject](data, args[spec.key]);
  if (!record) missing(spec.subject.replace('_', ' '), args[spec.key]);
  g[spec.subject] = record;
  if (spec.subject === 'fill') { g.fill = record; g.rx = LOOKUP.rx(data, record.rx_id); }
  if (spec.subject === 'plan_request') { g.fill = LOOKUP.fill(data, record.fill_id); g.rx = LOOKUP.rx(data, g.fill.rx_id); }
  if (spec.subject === 'renewal') g.rx = LOOKUP.rx(data, record.rx_id);
  if (spec.subject === 'rx') g.rx = record;
  g.patientId = g.rx.patient_id;
  g.rel = rel(g.patientId);
  check(spec.power, g.rel, g.fill ? g.fill.fill_id : null);
  if (g.fill) g.access = fillAccess(g.rel, g.fill.fill_id);
  return g;
}

module.exports = { GUARDS, EVENT_TARGETS, guard, eventTargets, patientOfFill };
