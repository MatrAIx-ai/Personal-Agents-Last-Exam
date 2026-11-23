'use strict';
// Agent reads. They run on a copy already materialized at ctx.virtual_now and never change App data.
const {fail, copy, premise: getPremise, render} = require('./common.cjs');
const {PLANS, TARIFFS} = require('./catalog.cjs');
const {allocate, billStatus, arrangementStatus} = require('./billing.cjs');
const {preview} = require('./orders.cjs');
const field = require('./field.cjs');

// An advisory's status from its latest message and the virtual time.
function advisoryStatus(a, now) {
  const v = a.versions[a.versions.length - 1], t = Date.parse(now);
  if (v.msg_type === 'lift') return 'lifted';
  if (t < Date.parse(v.effective_from)) return 'upcoming';
  if (v.planned_end && t >= Date.parse(v.planned_end)) return 'ended';
  return 'in_effect';
}
// Premises an advisory version covers: its areas plus any listed premises.
const covers = (data, v, premiseId) => v.premise_ids.includes(premiseId) || v.area_ids.includes(getPremise(data, premiseId).area_id);
const outageStatus = o => o.versions[o.versions.length - 1].status === 'restored' ? 'restored' : 'ongoing';
const masked = m => ({payment_method_id: m.payment_method_id, label: m.label, last4: m.last4});

function plans(data, premiseId, type) {
  const p = getPremise(data, premiseId);
  if (type === 'internet' && p.internet_tech === 'none') fail('not_serviceable', 'No internet service is available at this premise.');
  return PLANS.filter(x => x.service_type === type && (type !== 'internet' || x.tech === p.internet_tech)).map(x => ({...x,
    ...(TARIFFS[type] ? {tariff: TARIFFS[type]} : {})}));
}
function billView(data, b, now) {
  return {...copy(b), status: billStatus(data, b, now), paid_cents: allocate(data)[b.bill_id], pending_cents: allocate(data, {pending: true})[b.bill_id]};
}

function read(ctx, data, name, args) {
  const now = ctx.virtual_now, as_of = render(Date.parse(now), data.preferences.time_zone);
  const out = value => ({as_of, ...value});
  switch (name) {
    case 'homegrid.account.get': return out({account: {account_id: data.account_id, name: data.customer.name,
      payment_methods: data.customer.payment_methods.map(masked), autopay: copy(data.autopay),
      premises: data.premises.filter(p => data.services.some(s => s.premise_id === p.premise_id) || data.orders.some(o => o.premise_id === p.premise_id)).map(copy)}});
    case 'homegrid.premises.search': {
      const q = (args.query || '').trim().toLocaleLowerCase();
      return out({premises: copy(data.premises.filter(p => !q || p.address.toLocaleLowerCase().includes(q) || p.premise_id.includes(q)))});
    }
    case 'homegrid.services.list': {
      if (args.premise_id) getPremise(data, args.premise_id);
      return out({services: copy(data.services.filter(s => !args.premise_id || s.premise_id === args.premise_id))});
    }
    case 'homegrid.plans.list': return out({plans: plans(data, args.premise_id, args.service_type)});
    case 'homegrid.orders.list': return out({orders: copy(data.orders.filter(o => (!args.premise_id || o.premise_id === args.premise_id) && (!args.status || o.status === args.status)))});
    case 'homegrid.orders.preview': return out(preview(data, args, now));
    case 'homegrid.appointments.slots': {
      const p = getPremise(data, args.premise_id);
      if (args.to < args.from || Date.parse(args.to) - Date.parse(args.from) > 62 * 86400e3) fail('invalid_date', 'Search up to 62 days.');
      // With an order, the windows that order can use (its lead time counts from when it was placed).
      const order = args.order_id ? data.orders.find(o => o.order_id === args.order_id && o.premise_id === p.premise_id) : null;
      if (args.order_id && !order) fail('order_not_found', 'No such order at this premise.');
      const w = field.earliestWindow(data, p, now, order);
      return out({slots: field.freeSlots(data, p, args.from, args.to, now, null, order), earliest: w && w.date, earliest_slot: w && w.slot});
    }
    case 'homegrid.equipment.list': return out({equipment: copy(data.equipment)});
    case 'homegrid.outages.list': {
      getPremise(data, args.premise_id);
      return out({outages: data.outages.filter(o => o.premise_ids.includes(args.premise_id)).map(o => ({...copy(o), status: outageStatus(o),
        etr: o.versions[o.versions.length - 1].etr, reports: data.reports.filter(r => r.outage_id === o.outage_id).map(r => r.report_id)}))});
    }
    case 'homegrid.advisories.list': {
      getPremise(data, args.premise_id);
      return out({advisories: data.advisories.filter(a => a.versions.some(v => covers(data, v, args.premise_id))).map(a => {
        const latest = a.versions[a.versions.length - 1];
        return {advisory_id: a.advisory_id, kind: latest.kind, status: advisoryStatus(a, now), latest_version: latest.version,
          covers_premise: covers(data, latest, args.premise_id), versions: copy(a.versions)};
      })});
    }
    case 'homegrid.bills.list': return out({bills: data.bills.filter(b => !args.premise_id || b.premise_id === args.premise_id).map(b => billView(data, b, now))});
    case 'homegrid.bills.get': {
      const b = data.bills.find(x => x.bill_id === args.bill_id);
      if (!b) fail('bill_not_found', 'Bill does not exist.');
      return out({bill: billView(data, b, now)});
    }
    case 'homegrid.payments.list': return out({payments: copy(data.payments), autopay: copy(data.autopay),
      arrangements: data.arrangements.map(a => ({...copy(a), status: arrangementStatus(data, a, now)}))});
    case 'homegrid.preferences.get': return out({preferences: copy(data.preferences)});
    case 'homegrid.notifications.list': return out({notifications: copy(data.notifications.filter(n => (!args.status || n.status === args.status) && (!args.type || n.type === args.type)))});
    default: return null;
  }
}

module.exports = {read, advisoryStatus, covers, outageStatus};
