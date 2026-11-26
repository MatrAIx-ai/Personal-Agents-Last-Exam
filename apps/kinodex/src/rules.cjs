'use strict';
// Business rules shared by agent writes and Infra events: alert matching and triggering, correction
// targets and values, and the activity / notice ledger. Callers validate before mutating.
const {fail, copy, text} = require('./domain-utils.cjs');
const c = require('./catalog.cjs');

// ---- Activity ledger and IDs --------------------------------------------------------------
const nextSeq = data => (data.activity.length ? data.activity[data.activity.length - 1].seq : 0) + 1;
function newId(prefix, seq, taken) {
  let id = prefix + '-' + seq;
  for (let i = 2; taken.has(id); i++) id = prefix + '-' + seq + '-' + i;
  return id;
}
// One row per committed write or applied event. Replays and rejected calls never reach the App, and
// time passing alone changes nothing, so neither produces a row.
function record(ctx, data, {action, request_id = null, event_id = null, object_type, object_id, replaced = null, alert_ids = [], notice_ids = []}) {
  data.activity.push({seq: nextSeq(data), at: ctx.virtual_now, actor: event_id ? 'event' : 'agent', action, request_id, event_id,
    object_type, object_id, replaced: copy(replaced), effects: {alert_ids, notice_ids}});
}
function notice(ctx, data, seq, fields) {
  const notice_id = newId('notice', seq, new Set(data.notices.map(n => n.notice_id)));
  data.notices.push({notice_id, at: ctx.virtual_now, kind: fields.kind, title_id: fields.title_id, alert_id: fields.alert_id ?? null,
    correction_id: fields.correction_id ?? null, guide_version: fields.guide_version ?? null, event_id: fields.event_id, text: fields.text});
  return notice_id;
}

// ---- Alerts -------------------------------------------------------------------------------
// The offer a rule matches at nowMs, or null. available_on_my_services: a currently available
// subscription offer in the account's region on a subscribed service. price_below: a currently
// available offer of the rule's type in the account's region priced strictly below the threshold.
function matchOffer(idx, data, alert, nowMs) {
  let best = null;
  for (const o of idx.offersByTitle.get(alert.title_id) || []) {
    if (o.region !== data.account.region || !c.isCurrent(c.availability(o, nowMs))) continue;
    if (alert.kind === 'available_on_my_services') {
      if (o.type === 'subscription' && data.account.service_ids.includes(o.service_id) && !best) best = o;
    } else if (alert.kind === 'price_below' && o.type === alert.offer_type && o.price < alert.threshold && (!best || o.price < best.price)) best = o;
  }
  return best;
}
function matchSeason(idx, alert) {
  const added = idx.titles.get(alert.title_id).seasons.map(s => s.season_number).filter(n => !alert.known_seasons.includes(n)).sort((a, b) => a - b);
  return added.length ? added[0] : null;
}
const snapshot = o => ({offer_id: o.offer_id, service_id: o.service_id, region: o.region, type: o.type, price: o.price, currency: o.currency,
  available_from: o.available_from, available_until: o.available_until});
const money = (o) => ({USD: '$', GBP: '£', CAD: 'CA$'}[o.currency] + o.price.toFixed(2));
function noticeText(idx, alert, offer, season) {
  const t = idx.titles.get(alert.title_id).name;
  if (alert.kind === 'new_season') return t + ' season ' + season + ' has been added.';
  const service = idx.services.get(offer.service_id).name;
  if (alert.kind === 'available_on_my_services') return t + ' is now included with your ' + service + ' subscription in the ' + offer.region + '.';
  return t + ' can now be ' + (offer.type === 'rent' ? 'rented' : 'bought') + ' for ' + money(offer) + ' on ' + service + ' (below your ' + money({...offer, price: alert.threshold}) + ' alert).';
}
// ---- Records with a seeded future -----------------------------------------------------------
// A write or event on a rule or correction whose stored history continues after the clock replaces that
// later history: the stored record takes its state as of the clock (catalog.alertAsOf / correctionAsOf)
// and the later notices about it are dropped. Returns the stored record to change.
function adopt(data, list, key, asOf, nowMs) {
  const i = data[list].findIndex(x => x[key] === asOf[key]);
  if (data[list][i] !== asOf) {
    data[list][i] = copy(asOf);
    data.notices = data.notices.filter(n => !(n[key] === asOf[key] && c.instant(n.at) > nowMs));
  }
  return data[list][i];
}
// A new rule or correction replaces seeded ones on the same key that were created after the clock, with
// their notices: active rule kind and title; correction title, field and target.
function dropLater(data, list, key, created, same, nowMs) {
  const gone = new Set(data[list].filter(x => c.instant(x[created]) > nowMs && same(x)).map(x => x[key]));
  if (!gone.size) return;
  data[list] = data[list].filter(x => !gone.has(x[key]));
  data.notices = data.notices.filter(n => !gone.has(n[key]));
}

// Evaluate the active, unexpired rules selected by `which` at ctx.virtual_now. Only rules created by
// then count, with their state as of then, and only the seasons added by then. Each match becomes
// triggered once and keeps the matching offer or season and the cause; event triggers also write a
// notice. Rules are never evaluated by reads or by time passing alone.
function evaluate(ctx, data, which, cause) {
  const idx = c.index(c.visible(data, ctx.virtual_now)), nowMs = c.instant(ctx.virtual_now), fired = [];
  for (const stored of [...data.alerts]) {
    if (c.instant(stored.created_at) > nowMs) continue;
    const asOf = c.alertAsOf(stored, nowMs);
    if (c.alertStatus(asOf, nowMs) !== 'active' || !which(asOf)) continue;
    const offer = asOf.kind === 'new_season' ? null : matchOffer(idx, data, asOf, nowMs);
    const season = asOf.kind === 'new_season' ? matchSeason(idx, asOf) : null;
    if (!offer && season === null) continue;
    const alert = adopt(data, 'alerts', 'alert_id', asOf, nowMs);
    alert.status = 'triggered'; alert.updated_at = ctx.virtual_now;
    alert.trigger = {at: ctx.virtual_now, cause: cause.event_id ? 'event' : 'services.update', event_id: cause.event_id ?? null,
      operation: cause.operation ?? null, request_id: cause.request_id ?? null, offer: offer && snapshot(offer), season_number: season, notice_id: null};
    fired.push({alert, offer, season});
  }
  return fired;
}
// Shared create/update preconditions: invalid_threshold, already_true. The match uses the clock.
function checkThreshold(idx, data, rule, nowMs) {
  if (rule.kind !== 'price_below') {
    if (rule.offer_type !== null || rule.threshold !== null) fail('invalid_threshold', 'Only price_below rules take an offer_type and threshold.');
    return;
  }
  if (rule.offer_type === null || rule.threshold === null) fail('invalid_threshold', 'price_below rules need offer_type (rent or buy) and threshold.');
  if (!(rule.threshold > 0 && rule.threshold < 10000) || Math.abs(rule.threshold * 100 - Math.round(rule.threshold * 100)) > 1e-6) {
    fail('invalid_threshold', 'The threshold must be a positive amount with at most two decimals.');
  }
  const priced = (idx.offersByTitle.get(rule.title_id) || []).some(o => o.region === data.account.region && o.type === rule.offer_type && c.availability(o, nowMs) !== 'ended');
  if (!priced) fail('invalid_threshold', idx.titles.get(rule.title_id).name + ' has no current or upcoming ' + rule.offer_type + ' offer in ' + data.account.region + ', so a price threshold cannot apply.');
}
function checkAlreadyTrue(idx, data, rule, nowMs, creating = true) {
  if (rule.kind === 'new_season') return;
  const o = matchOffer(idx, data, rule, nowMs);
  if (o) {
    fail('already_true', 'Already true: offer ' + o.offer_id + ' (' + idx.services.get(o.service_id).name + ', ' + o.type + ', ' + o.region +
      (o.price !== null ? ', ' + money(o) : '') + (o.available_until ? ', until ' + o.available_until : '') + ') matches now. ' + (creating ? 'No rule was stored.' : 'The rule was not changed.'));
  }
}

// ---- Corrections --------------------------------------------------------------------------
// A correction targets a title, a field category and one object; this key also identifies the open
// correction a correction.decision event decides.
const TARGET_KEY = {runtime: 'edition_id', release_date: 'region', certification: 'region', credit: 'credit_id', guide_item: 'item_id'};
const sameTarget = (a, b) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => a[k] === b[k]);
const isOpen = co => co.status === 'submitted' || co.status === 'needs_info';
function guideItem(idx, titleId, itemId) {
  const cur = c.currentGuide(idx.guides.get(titleId));
  for (const name of c.CATEGORIES) {
    const item = cur.categories[name].items.find(i => i.item_id === itemId);
    if (item) return {category: name, item};
  }
  return null;
}
// The target's current value: the one no_change compares against and an approval replaces.
function currentValue(idx, titleId, field, target, code = 'not_found') {
  const key = TARGET_KEY[field], t = idx.titles.get(titleId);
  if (Object.keys(target).length !== 1 || target[key] === undefined) fail('invalid_arguments', 'A ' + field + ' correction targets exactly one ' + key + '.');
  const id = target[key];
  if (field === 'runtime') {
    const e = idx.editions.get(id);
    if (!e || e.title_id !== titleId) fail(code, 'Edition ' + id + ' is not an edition of ' + t.name + '.');
    return e.edition.runtime_minutes;
  }
  if (field === 'release_date' || field === 'certification') {
    const r = t.releases.find(x => x.region === id);
    if (!r) fail(code, t.name + ' has no release listed in ' + id + '.');
    return field === 'release_date' ? r.date : r.certification;
  }
  if (field === 'credit') {
    const cr = idx.credits.get(id);
    if (!cr || cr.title_id !== titleId) fail(code, 'Credit ' + id + ' is not a credit of ' + t.name + '.');
    return {role: cr.role, character: cr.character, billing_order: cr.billing_order};
  }
  const found = guideItem(idx, titleId, id);
  if (!found) fail(code, 'Item ' + id + ' is not in the current parental guide of ' + t.name + '.');
  return {text: found.item.text, spoiler: found.item.spoiler};
}
// code overrides the error code (invalid_seed for seeds, invalid_event for decisions).
function checkProposed(field, target, value, code) {
  const bad = message => fail(code || 'invalid_arguments', message);
  if (field === 'runtime' && !(Number.isInteger(value) && value >= 1 && value <= 1000)) bad('A runtime correction proposes whole minutes.');
  if (field === 'release_date' && !c.isDate(value)) fail(code || 'invalid_date', 'A release date correction proposes a real YYYY-MM-DD date.');
  if (field === 'certification' && !(typeof value === 'string' && c.CERTIFICATIONS[target.region].includes(value))) {
    bad('Certifications in ' + target.region + ' are ' + c.CERTIFICATIONS[target.region].join(', ') + '.');
  }
  const keys = {credit: ['role', 'character', 'billing_order'], guide_item: ['text', 'spoiler']}[field];
  if (keys) {
    if (!value || typeof value !== 'object' || !Object.keys(value).length || Object.keys(value).some(k => !keys.includes(k))) bad('A ' + field + ' correction proposes an object with ' + keys.join(', ') + '.');
    if ((value.character !== undefined && !text(value.character, 120)) || (value.text !== undefined && !text(value.text, 500))) bad('Proposed text cannot be blank.');
  }
}
const sameValue = (current, proposed) => (proposed !== null && typeof proposed === 'object'
  ? Object.keys(proposed).every(k => current[k] === proposed[k]) : current === proposed);
// Apply an approved correction to the catalog at ctx.virtual_now. Returns the new guide version, if any.
function applyCorrection(ctx, data, idx, co) {
  const id = co.target[TARGET_KEY[co.field]], t = idx.titles.get(co.title_id), v = co.proposed_value;
  if (co.field === 'runtime') {idx.editions.get(id).edition.runtime_minutes = v; return null;}
  if (co.field === 'release_date' || co.field === 'certification') {
    const r = t.releases.find(x => x.region === id);
    if (co.field === 'certification') {r.certification = v; return null;}
    const earliest = t.releases.reduce((min, x) => ((x.region === id ? v : x.date) < min ? (x.region === id ? v : x.date) : min), v);
    if (data.diary.some(e => e.title_id === t.title_id && e.watched_on < earliest)) {
      fail('invalid_event', 'Approving this release date would place diary entries before ' + t.name + '\'s release.');
    }
    r.date = v; return null;
  }
  if (co.field === 'credit') {Object.assign(idx.credits.get(id), copy(v)); return null;}
  const g = idx.guides.get(t.title_id), cur = c.currentGuide(g), next = copy(cur);
  if (c.instant(ctx.virtual_now) < c.instant(cur.published_at)) fail('invalid_event', 'The current guide version of ' + t.name + ' is dated after this decision.');
  next.version = cur.version + 1; next.reason = 'correction_approved'; next.published_at = ctx.virtual_now;
  for (const name of c.CATEGORIES) for (const item of next.categories[name].items) if (item.item_id === id) Object.assign(item, copy(v));
  g.versions.push(next);
  return next.version;
}

module.exports = {nextSeq, newId, record, notice, adopt, dropLater, matchOffer, matchSeason, evaluate, noticeText, checkThreshold, checkAlreadyTrue,
  TARGET_KEY, sameTarget, isOpen, currentValue, checkProposed, sameValue, applyCorrection};
