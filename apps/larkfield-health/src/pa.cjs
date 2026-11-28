'use strict';
const { fail, byId, bump, sortBy, textLength } = require('./util.cjs');
const { ms, toIso, validDate, endOfDay, dayDeadline, HOUR } = require('./time.cjs');
const N = require('./notices.cjs');

const OPEN = new Set(['pending', 'info_requested']);
const invalid = message => fail('invalid_event', message);
const due = (at, n) => toIso(dayDeadline(at, n));
const change = (data, pa) => bump(data, pa, 'pa_id', 'pa_version');
const remaining = p => p.approved.units - p.units_used;

function dates(from, until, what) {
  for (const d of [from, until]) if (!validDate(d, 2000, 2200)) invalid(what + ' has an invalid date ' + d + '.');
}

function covering(data, p) {
  const fits = data.pas.filter(x => x.status === 'approved' && x.member_id === p.member_id && x.service_id === p.service_id && x.approved.valid_from <= p.valid_from && p.valid_until <= x.approved.valid_until && remaining(x) >= p.units);
  return fits.map(x => ({ x, key: x.approved.valid_until + '|' + x.pa_id })).sort(sortBy('key')).map(o => o.x)[0] || null;
}

function paSubmitted(data, p, ctx) {
  const at = ctx.virtual_now;
  if (byId(data.pas, 'pa_id', p.pa_id) || data.pas.some(x => x.covered_submissions.some(s => s.pa_id === p.pa_id))) invalid('PA ' + p.pa_id + ' already exists.');
  dates(p.valid_from, p.valid_until, 'PA ' + p.pa_id);
  if (p.valid_from > p.valid_until) invalid('PA ' + p.pa_id + ' is valid from ' + p.valid_from + ', after its end ' + p.valid_until + '.');
  const service = byId(data.services, 'service_id', p.service_id), provider = byId(data.providers, 'provider_id', p.provider_id);
  if (service.category === 'pharmacy' && provider.kind !== 'pharmacy' && provider.kind !== 'prescriber') invalid('A pharmacy PA must come from a pharmacy or a prescriber; ' + provider.provider_id + ' is a ' + provider.kind + '.');
  const cover = covering(data, p);
  if (cover) {
    cover.covered_submissions.push({ pa_id: p.pa_id, provider_id: p.provider_id, units: p.units, valid_from: p.valid_from, valid_until: p.valid_until, at });
    change(data, cover);
    return data;
  }
  data.pas.push({ pa_id: p.pa_id, pa_version: 0, member_id: p.member_id, provider_id: p.provider_id, service_id: p.service_id, status: 'pending', submitted_at: at,
    requested: { units: p.units, valid_from: p.valid_from, valid_until: p.valid_until }, approved: null, approved_after_post: null, units_used: 0, info_requests: [], expedite: null,
    due_at: due(at, 15), overdue: false, overdue_at: null, decided_at: null, expired_at: null, denial_notice_at: null, covered_submissions: [] });
  return data;
}

function text(t, what) {
  if (textLength(t) > 2000) invalid(what + ' is longer than 2,000 characters.');
}

function paInfoRequested(data, p, ctx) {
  const pa = byId(data.pas, 'pa_id', p.pa_id);
  if (pa.status !== 'pending') return data;
  text(p.request, 'The information request');
  pa.status = 'info_requested';
  pa.info_requests.push({ at: ctx.virtual_now, text: p.request });
  change(data, pa);
  return data;
}

function paInfoProvided(data, p) {
  const pa = byId(data.pas, 'pa_id', p.pa_id);
  if (pa.status !== 'info_requested') return data;
  pa.status = 'pending';
  change(data, pa);
  return data;
}

function paWithdrawn(data, p) {
  const pa = byId(data.pas, 'pa_id', p.pa_id);
  if (!OPEN.has(pa.status)) return data;
  pa.status = 'withdrawn';
  change(data, pa);
  return data;
}

function approve(data, pa, terms, at) {
  dates(terms.valid_from, terms.valid_until, 'The approval of PA ' + pa.pa_id);
  const expired = endOfDay(terms.valid_until) <= ms(at);
  if (terms.valid_from > terms.valid_until && !expired) invalid('The approval of PA ' + pa.pa_id + ' is valid from ' + terms.valid_from + ', after its end ' + terms.valid_until + '.');
  Object.assign(pa, { status: expired ? 'expired' : 'approved', approved: { units: terms.units, valid_from: terms.valid_from, valid_until: terms.valid_until }, approved_after_post: data.issued.post === undefined ? '0' : data.issued.post, decided_at: at, expired_at: expired ? at : null });
}

function paDecided(data, p, ctx) {
  const pa = byId(data.pas, 'pa_id', p.pa_id), at = ctx.virtual_now;
  if (!OPEN.has(pa.status)) return data;
  if (p.decision === 'approved') approve(data, pa, p, at);
  else {
    Object.assign(pa, { status: 'denied', decided_at: at, denial_notice_at: at });
    data.windows.push({ target: { type: 'pa', id: pa.pa_id }, notice_at: at, ends_at: due(at, 180), closing: { due_at: due(at, 166), done: false, notice_at: null } });
  }
  change(data, pa);
  N.paDecision(data, pa, at);
  return data;
}

function paExpediteDecided(data, p, ctx) {
  const pa = byId(data.pas, 'pa_id', p.pa_id), at = ctx.virtual_now;
  if (!OPEN.has(pa.status) || pa.expedite === null || pa.expedite.status !== 'open') return data;
  Object.assign(pa.expedite, { status: p.decision, decided_at: at });
  if (p.decision === 'approved') {
    pa.due_at = toIso(Math.min(ms(pa.due_at), ms(pa.expedite.requested_at) + 72 * HOUR));
    if (ms(pa.due_at) <= ms(at) && !pa.overdue) {
      Object.assign(pa, { overdue: true, overdue_at: at });
      N.decisionOverdue(data, 'pa', pa, at);
    }
  }
  change(data, pa);
  return data;
}

function requestExpedite(ctx, data, args, g) {
  const pa = g.pa;
  if (args.reason !== undefined && textLength(args.reason) > 2000) fail('invalid_arguments', 'The expedite reason is longer than 2,000 characters.');
  if (!OPEN.has(pa.status)) fail('expedite_not_allowed', 'PA ' + pa.pa_id + ' is ' + pa.status + '; only a pending PA can be expedited.');
  if (pa.expedite !== null) fail('duplicate_request', 'PA ' + pa.pa_id + ' already has an expedite request.');
  pa.expedite = { requested_at: g.at, reason: args.reason === undefined ? null : args.reason, status: 'open', decided_at: null };
  change(data, pa);
  return pa;
}

function validityEnd(data, pa, at) {
  Object.assign(pa, { status: 'expired', expired_at: at });
  change(data, pa);
}

function paDue(data, pa, at) {
  Object.assign(pa, { overdue: true, overdue_at: at });
  change(data, pa);
  N.decisionOverdue(data, 'pa', pa, at);
}

module.exports = { paSubmitted, paInfoRequested, paInfoProvided, paWithdrawn, paDecided, paExpediteDecided, requestExpedite, validityEnd, paDue, approve, OPEN };
