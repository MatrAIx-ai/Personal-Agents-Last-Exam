'use strict';
const crypto = require('node:crypto');
const {fail, premise: getPremise, zoneOf, localDate, addBusinessDays, isBusinessDay, daysBetween, addDays, nextId, stamp, money, render} = require('./common.cjs');
const {PLANS, FEES, POLICY} = require('./catalog.cjs');
const {charge, lateCount} = require('./billing.cjs');
const {notify} = require('./notify.cjs');
const field = require('./field.cjs');

const today = (data, premiseId, now) => localDate(now, zoneOf(data, premiseId));
const planFor = (p, type, planId) => {
  const plan = PLANS.find(x => x.service_type === type && (planId ? x.plan_id === planId : true) && (type !== 'internet' || x.tech === p.internet_tech));
  if (!plan) fail(type === 'internet' && p.internet_tech === 'none' ? 'not_serviceable' : 'invalid_date', 'No such plan for this premise.');
  return plan;
};
// A token carries the request, the preview time and a digest of the result. The seal only detects edits:
// create recomputes the preview, so an edited token can never yield more than a new preview would.
const digest = value => crypto.createHash('sha256').update('homegrid-order-token|' + JSON.stringify(value)).digest('hex');

function startPart(data, req, now) {
  const p = getPremise(data, req.premise_id), type = req.service_type;
  if (type === 'internet' && p.internet_tech === 'none') fail('not_serviceable', 'No internet technology at this premise.');
  const existing = data.services.find(s => s.premise_id === p.premise_id && s.service_type === type && ['active', 'pending_start', 'pending_stop'].includes(s.status));
  if (existing) fail('already_active', 'This service is already active or ordered at the premise.');
  const plan = planFor(p, type, req.plan_id), day = today(data, p.premise_id, now);
  if (type === 'internet') {
    if (p.self_install) {
      const earliest = addBusinessDays(data, day, POLICY.shipping_business_days);
      return {type: 'start', premise_id: p.premise_id, service_type: type, plan_id: plan.plan_id, date: earliest, earliest, needs: 'self_install', earliest_window: null};
    }
    const window = field.earliestWindow(data, p, now);
    return {type: 'start', premise_id: p.premise_id, service_type: type, plan_id: plan.plan_id, date: null, earliest: window && window.date,
      needs: 'technician', earliest_window: window};
  }
  const earliest = addBusinessDays(data, day, POLICY.utility_lead_business_days), date = req.date || earliest;
  if (date < earliest) fail('lead_time_not_met', 'The earliest start is ' + earliest + '.');
  if (!isBusinessDay(data, date)) fail('invalid_date', 'Service starts on a business day.');
  return {type: 'start', premise_id: p.premise_id, service_type: type, plan_id: plan.plan_id, date, earliest, needs: 'none', earliest_window: null};
}
function stopPart(data, service, date, now) {
  if (!['active', 'pending_start'].includes(service.status)) fail('service_not_active', 'The service is not active.');
  const earliest = addBusinessDays(data, today(data, service.premise_id, now), POLICY.utility_lead_business_days);
  if (date < earliest) fail('lead_time_not_met', 'The earliest stop is ' + earliest + '.');
  if (!isBusinessDay(data, date)) fail('invalid_date', 'Service stops on a business day.');
  return {type: 'stop', premise_id: service.premise_id, service_type: service.service_type, plan_id: null, date, earliest, needs: 'none', service_id: service.service_id};
}

// A read: the same request at the same state gives the same preview and token.
function preview(data, req, now) {
  const parts = [], warnings = {};
  let price = 0;
  if (req.type === 'start') parts.push(startPart(data, req, now));
  else if (req.type === 'stop') {
    const s = data.services.find(x => x.service_id === req.service_id);
    if (!s) fail('service_not_active', 'Unknown service.');
    if (!req.date) fail('invalid_date', 'A stop needs its last day of service (date).');
    parts.push(stopPart(data, s, req.date, now));
  } else if (req.type === 'transfer') {
    getPremise(data, req.from_premise_id); getPremise(data, req.to_premise_id);
    if (!req.stop_date) fail('invalid_date', 'A transfer needs a stop date.');
    const from = data.services.filter(s => s.premise_id === req.from_premise_id && ['active', 'pending_start'].includes(s.status));
    const types = req.services || from.map(s => s.service_type);
    for (const s of from.filter(x => types.includes(x.service_type))) parts.push(stopPart(data, s, req.stop_date, now));
    for (const type of types) {
      const part = startPart(data, {premise_id: req.to_premise_id, service_type: type, date: type === 'internet' ? undefined : (req.start_date || req.stop_date)}, now);
      parts.push(part);
      const start = part.date || part.earliest;
      if (start) {
        const gap = daysBetween(req.stop_date, start) - 1, overlap = daysBetween(start, req.stop_date) + 1;
        if (gap > 0) warnings[type] = {service_gap_days: gap};
        else if (overlap > 0) warnings[type] = {overlap_days: overlap};
      }
    }
  } else if (req.type === 'temporary_internet') {
    const p = getPremise(data, req.premise_id);
    if (!req.from || !req.to || req.to < req.from || daysBetween(req.from, req.to) > POLICY.hotspot_max_days) fail('invalid_date', 'A loan lasts at most 30 days.');
    if (req.from < today(data, p.premise_id, now)) fail('invalid_date', 'A loan cannot start in the past.');
    const stock = (data.stock.find(s => s.area_id === p.area_id) || {hotspots: 0}).hotspots;
    const busy = l => !(addDays(l.temp.to, POLICY.hotspot_return_days) < req.from || l.temp.from > addDays(req.to, POLICY.hotspot_return_days));
    const loans = data.orders.filter(o => o.type === 'temporary_internet' && o.status !== 'cancelled' && getPremise(data, o.premise_id).area_id === p.area_id && busy(o));
    if (loans.length >= stock) {
      const free = loans.map(l => addDays(l.temp.to, POLICY.hotspot_return_days + 1)).sort()[0] || null;
      fail('no_stock', 'No hotspot is free for those dates' + (free ? '; the earliest free date is ' + free : '') + '.');
    }
    // $10.00 per started 7-day period of the loan (Jan 19-26 is one period).
    price = field.missedInstall(data, p.premise_id) ? 0 : Math.max(1, Math.ceil(daysBetween(req.from, req.to) / 7)) * FEES.temporary_week;
    parts.push({type: 'temporary_internet', premise_id: p.premise_id, service_type: 'internet', plan_id: null, date: null, temp: {from: req.from, to: req.to}, needs: 'none'});
  } else fail('invalid_date', 'Unknown order type.');
  if (!parts.length) fail('service_not_active', 'There is no active service to move from this premise.');
  const firstStart = parts.find(x => x.type === 'start');
  const newPremise = firstStart && !data.services.some(s => s.premise_id === firstStart.premise_id) && !data.orders.some(o => o.premise_id === firstStart.premise_id && o.deposit_cents > 0);
  const deposit = newPremise && lateCount(data, now) >= POLICY.late_payments_for_deposit ? FEES.deposit : 0;
  const result = {parts, warnings, deposit_cents: deposit, price_cents: price};
  const sealed = {req, at: now, result: digest(result)};
  const token = Buffer.from(JSON.stringify({...sealed, seal: digest(sealed)})).toString('base64url');
  return {...result, order_token: token, expires_at: render(Date.parse(now) + POLICY.token_minutes * 60e3, data.preferences.time_zone)};
}

function create(ctx, data, token) {
  let parsed;
  try { parsed = JSON.parse(Buffer.from(token, 'base64url').toString()); } catch { fail('invalid_order_token', 'The token cannot be read.'); }
  if (!parsed || typeof parsed !== 'object' || !parsed.req || !parsed.at || !parsed.result ||
      parsed.seal !== digest({req: parsed.req, at: parsed.at, result: parsed.result})) fail('invalid_order_token', 'The token was not issued by orders.preview or was edited.');
  if (Date.parse(ctx.virtual_now) - Date.parse(parsed.at) > POLICY.token_minutes * 60e3) fail('order_token_expired', 'Preview again; tokens last 30 minutes.');
  let fresh;
  try { fresh = preview(data, parsed.req, ctx.virtual_now); } catch (error) {
    if (!error.code) throw error;
    fail('order_token_stale', 'The order can no longer be made as previewed (' + error.code + '): ' + error.message);
  }
  const {order_token, expires_at, ...result} = fresh;
  if (digest(result) !== parsed.result) fail('order_token_stale', 'Stock, capacity or the account changed since the preview; preview again.');
  const at = stamp(ctx, data), transfer = parsed.req.type === 'transfer' ? nextId(data.orders.filter(o => o.transfer_id).map(o => ({id: o.transfer_id})), 'id', 'tr') : null;
  const ids = [];
  for (const part of result.parts) {
    const order = {order_id: nextId(data.orders, 'order_id', `or-${part.premise_id}-${part.service_type}`), transfer_id: transfer, type: part.type,
      premise_id: part.premise_id, service_type: part.service_type, plan_id: part.plan_id, date: part.date, temp: part.temp || null,
      status: 'scheduled', needs: part.needs, deposit_cents: 0, price_cents: 0, created_at: at, history: [{at, action: 'created'}]};
    if (part.type === 'start') {
      const sid = `sv-${part.premise_id}-${part.service_type}`;
      data.services = data.services.filter(s => !(s.service_id === sid && ['stopped', 'install_failed'].includes(s.status)));
      data.services.push({service_id: sid, premise_id: part.premise_id, service_type: part.service_type, plan_id: part.plan_id, status: 'pending_start',
        start_date: part.date, stop_date: null, activated_at: null, last_test: null});
      if (part.needs === 'self_install') data.equipment.push({equipment_id: 'eq-' + order.order_id, kind: 'gateway', premise_id: part.premise_id,
        order_id: order.order_id, status: 'ordered', return_due: null, return_method: null, returned_at: null});
    }
    if (part.type === 'stop') {
      const s = data.services.find(x => x.service_id === part.service_id);
      s.status = 'pending_stop'; s.stop_date = part.date;
    }
    if (part.type === 'temporary_internet') {
      order.price_cents = result.price_cents;
      data.equipment.push({equipment_id: 'eq-' + order.order_id, kind: 'hotspot', premise_id: part.premise_id, order_id: order.order_id,
        status: 'ordered', return_due: addDays(part.temp.to, POLICY.hotspot_return_days), return_method: null, returned_at: null});
      if (result.price_cents > 0) charge(data, part.premise_id, 'temporary_internet', `Temporary internet ${order.order_id}`, result.price_cents, at, order.order_id);
    }
    data.orders.push(order); ids.push(order.order_id);
  }
  const first = data.orders.find(o => o.order_id === ids.find((id, i) => result.parts[i].type === 'start'));
  if (result.deposit_cents && first) { first.deposit_cents = result.deposit_cents; charge(data, first.premise_id, 'deposit', 'Deposit for a new premise', result.deposit_cents, at, first.order_id); }
  const lines = result.parts.map(x => `${x.type} ${x.service_type} at ${getPremise(data, x.premise_id).address}${x.date ? ' on ' + x.date : x.temp ? ` ${x.temp.from} to ${x.temp.to}` : ' (book an installation window)'}`);
  const warn = Object.entries(result.warnings).map(([t, w]) => w.service_gap_days ? `${t}: ${w.service_gap_days}-day gap` : `${t}: ${w.overlap_days}-day overlap`);
  notify(ctx, data, {type: 'order', source: {kind: 'order', id: transfer || ids[0], version: 0},
    title: transfer ? 'Your move is scheduled' : 'Order confirmed', body: lines.join('; ') + '.' + (warn.length ? ' Note: ' + warn.join(', ') + '.' : '') +
      (result.deposit_cents ? ` A ${money(result.deposit_cents)} deposit will appear on your first bill.` : '') + (result.price_cents ? ` Hotspot loan: ${money(result.price_cents)}.` : '')});
  return {order_ids: ids, transfer_id: transfer};
}

function getOrder(data, id) {
  const o = data.orders.find(x => x.order_id === id);
  if (!o) fail('order_not_found', 'Order does not exist.');
  if (o.status === 'effective') fail('order_already_effective', 'The order is already effective.');
  if (o.status === 'cancelled') fail('order_not_found', 'The order is cancelled.');
  return o;
}
function reschedule(ctx, data, id, date) {
  const o = getOrder(data, id);
  if (o.needs === 'technician') fail('invalid_date', 'Internet installations are rescheduled through appointments.');
  if (o.type === 'temporary_internet') fail('invalid_date', 'Cancel the loan and order a new one.');
  const earliest = addBusinessDays(data, today(data, o.premise_id, ctx.virtual_now), o.needs === 'self_install' ? POLICY.shipping_business_days : POLICY.utility_lead_business_days);
  if (date < earliest) fail('lead_time_not_met', 'The earliest date is ' + earliest + '.');
  if (!isBusinessDay(data, date)) fail('invalid_date', 'Choose a business day.');
  o.date = date; o.history.push({at: stamp(ctx, data), action: 'rescheduled to ' + date});
  const s = data.services.find(x => x.premise_id === o.premise_id && x.service_type === o.service_type);
  if (s) { if (o.type === 'start') s.start_date = date; else s.stop_date = date; }
  notify(ctx, data, {type: 'order', source: {kind: 'order', id: o.order_id, version: o.history.length}, title: 'Order rescheduled',
    body: `${o.type} ${o.service_type} at ${getPremise(data, o.premise_id).address} moved to ${date}.`});
  return {order_id: o.order_id, date};
}
function cancel(ctx, data, id) {
  const o = getOrder(data, id), at = stamp(ctx, data);
  o.status = 'cancelled'; o.history.push({at, action: 'cancelled'});
  const s = data.services.find(x => x.premise_id === o.premise_id && x.service_type === o.service_type);
  if (o.type === 'start' && s && ['pending_start', 'install_failed'].includes(s.status)) data.services = data.services.filter(x => x !== s);
  if (o.type === 'stop' && s && s.status === 'pending_stop') { s.status = 'active'; s.stop_date = null; }
  for (const a of data.appointments.filter(x => x.order_id === o.order_id && x.status === 'booked')) { a.status = 'cancelled'; a.history.push({at, action: 'cancelled with order'}); }
  data.equipment = data.equipment.filter(e => !(e.order_id === o.order_id && e.status === 'ordered'));
  data.charges = data.charges.filter(c => !(c.kind === 'temporary_internet' && c.ref === o.order_id && !c.billed_in));
  notify(ctx, data, {type: 'order', source: {kind: 'order', id: o.order_id, version: o.history.length}, title: 'Order cancelled',
    body: `${o.type} ${o.service_type} at ${getPremise(data, o.premise_id).address} is cancelled.`});
  return {order_id: o.order_id};
}

module.exports = {preview, create, reschedule, cancel};
