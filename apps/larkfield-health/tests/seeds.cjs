'use strict';
const { ms, toIso, dayDeadline } = require('../src/time.cjs');

const due = (at, n) => toIso(dayDeadline(at, n));
const year = () => ({ deductible: { individual_cents: 150000, family_cents: 300000 }, oop_max: { individual_cents: 400000, family_cents: 800000 }, coinsurance_pct: 20,
  copays: { office: 2500, specialist: 5000, therapy: 3500, emergency: 25000 } });
const MEMBERS = ['m-1', 'm-2', 'm-3'], YEARS = [2025, 2026, 2027];
const line = (line_id, position, service_id, service_date, billed_cents, extra = {}) => ({ line_id, position, service_id, service_date, units: 1, billed_cents, emergency: false, possible_accident: false, ...extra });
const paid = (line_id, allowed, parts, billed, pa) => ({ line_id, status: 'paid', reason: null, allowed_cents: allowed, copay_cents: parts.copay || 0, deductible_cents: parts.ded || 0, coinsurance_cents: parts.coins || 0,
  member_cost_cents: (parts.copay || 0) + (parts.ded || 0) + (parts.coins || 0), plan_paid_cents: allowed - (parts.copay || 0) - (parts.ded || 0) - (parts.coins || 0), not_allowed_cents: billed - allowed, pa_id: pa ? pa.id : null, pa_units: pa ? pa.units : 0 });
const denied = (line_id, reason, billed) => ({ line_id, status: 'denied', reason, allowed_cents: 0, copay_cents: 0, deductible_cents: 0, coinsurance_cents: 0, member_cost_cents: 0, plan_paid_cents: 0, not_allowed_cents: billed, pa_id: null, pa_units: 0 });
const yearOf = d => Number(d.slice(0, 4));
const byTime = key => (a, b) => ms(a[key]) - ms(b[key]);
const counter = (s, key) => String(BigInt(s.issued[key] ?? '0') + 1n);

function household() {
  return {
    seed_id: 'larkfield-test-household', account_id: 'larkfield-m-1', owner_person_id: 'm-1', time_zone: 'America/New_York',
    plan: { plan_id: 'plan-epo', name: 'Larkfield EPO Plan', years: Object.fromEntries(YEARS.map(y => [String(y), year()])), pa_services: ['svc-physical-therapy', 'svc-arthroscopy', 'svc-adalimumab-40'] },
    members: [
      { member_id: 'm-1', name: 'Jordan Hale', relation: 'self', birth_date: '1984-03-12', is_minor: false, guardian_ids: [], enrolled_years: [...YEARS] },
      { member_id: 'm-2', name: 'Casey Hale', relation: 'spouse', birth_date: '1986-09-02', is_minor: false, guardian_ids: [], enrolled_years: [...YEARS] },
      { member_id: 'm-3', name: 'Riley Hale', relation: 'child', birth_date: '2015-05-20', is_minor: true, guardian_ids: ['m-1', 'm-2'], enrolled_years: [...YEARS] }],
    providers: [
      { provider_id: 'pv-1', name: 'Quarrowby Family Medicine', kind: 'prescriber', in_network: true }, { provider_id: 'pv-2', name: 'Kestrel Valley Orthopedics', kind: 'imaging', in_network: true },
      { provider_id: 'pv-3', name: 'Fernhollow Physical Therapy', kind: 'therapy', in_network: true }, { provider_id: 'pv-4', name: 'Wrenmoor Community Hospital', kind: 'hospital', in_network: true },
      { provider_id: 'pv-5', name: 'Quillmont Imaging Center', kind: 'imaging', in_network: false }, { provider_id: 'pv-6', name: 'Cindervale Medical Center', kind: 'hospital', in_network: false }],
    services: [
      { service_id: 'svc-office-visit', description: 'Primary care office visit', category: 'office', fee_cents: 18000 }, { service_id: 'svc-specialist-visit', description: 'Specialist office visit', category: 'specialist', fee_cents: 30000 },
      { service_id: 'svc-knee-mri', description: 'MRI of the knee', category: 'imaging', fee_cents: 150000 }, { service_id: 'svc-physical-therapy', description: 'Physical therapy session', category: 'therapy', fee_cents: 15000 },
      { service_id: 'svc-lab-panel', description: 'Basic metabolic lab panel', category: 'lab', fee_cents: 9000 }, { service_id: 'svc-er-visit', description: 'Emergency department visit', category: 'emergency', fee_cents: 220000 },
      { service_id: 'svc-arthroscopy', description: 'Knee arthroscopy', category: 'surgery', fee_cents: 800000 }, { service_id: 'svc-adalimumab-40', description: 'Adalimumab 40 mg, two-week supply', category: 'pharmacy', fee_cents: 300000 }],
    coverage: MEMBERS.flatMap(m => YEARS.map(y => (m === 'm-1' && y === 2026 ? { member_id: m, plan_year: y, status: 'none', version: 1, attested_at: '2026-01-15T10:00:00-05:00' } : { member_id: m, plan_year: y, status: 'unknown', version: 0, attested_at: null }))),
    claims: [], info_requests: [], eobs: [], accumulators: MEMBERS.flatMap(m => YEARS.map(y => ({ member_id: m, plan_year: y, deductible_cents: 0, oop_cents: 0 }))),
    pas: [], appeals: [], windows: [], grants: [], approvals: [], notices: [], issued: {},
  };
}

function claim(s, c) {
  const record = { claim_version: 0, review_at: due(c.received_at, 3), status: 'received', processed_at: null, received_seq: counter(s, 'seq'), ...c };
  s.claims.push(record);
  s.issued.seq = record.received_seq;
  return record;
}

function post(s, eob) {
  const c = s.claims.find(x => x.claim_id === eob.claim_id);
  const years = [...new Set(c.lines.map(l => yearOf(l.service_date)))].sort();
  const postings = years.map(y => {
    const mine = eob.lines.filter(l => yearOf(c.lines.find(x => x.line_id === l.line_id).service_date) === y);
    return { member_id: c.member_id, plan_year: y, deductible_cents: mine.reduce((t, l) => t + l.deductible_cents, 0), oop_cents: mine.reduce((t, l) => t + l.member_cost_cents, 0) };
  });
  const record = { posting_seq: counter(s, 'post'), ledger_before: {}, postings, ...eob };
  s.eobs.push(record);
  s.issued.post = record.posting_seq;
  s.issued.eob = String(Math.max(Number(s.issued.eob ?? '0'), Number(eob.eob_id.slice(4))));
  c.claim_version++;
  return record;
}

function finalize(s) {
  [...s.claims].sort(byTime('received_at')).forEach((c, i) => { c.received_seq = String(i + 1); });
  if (s.claims.length) s.issued.seq = String(s.claims.length);
  const order = [...s.eobs].sort(byTime('issued_at'));
  order.forEach((e, i) => { e.posting_seq = String(i + 1); });
  if (order.length) s.issued.post = String(order.length);
  for (const a of s.accumulators) { a.deductible_cents = 0; a.oop_cents = 0; }
  const acc = (m, y) => s.accumulators.find(a => a.member_id === m && a.plan_year === y);
  const family = y => s.members.filter(m => m.enrolled_years.includes(y)).reduce((f, m) => ({ deductible_cents: f.deductible_cents + acc(m.member_id, y).deductible_cents, oop_cents: f.oop_cents + acc(m.member_id, y).oop_cents }), { deductible_cents: 0, oop_cents: 0 });
  for (const e of order) {
    const c = s.claims.find(x => x.claim_id === e.claim_id), prev = s.eobs.find(x => x.claim_id === e.claim_id && x.version === e.version - 1);
    e.ledger_before = Object.fromEntries(e.postings.map(p => [String(p.plan_year), { member: { deductible_cents: acc(c.member_id, p.plan_year).deductible_cents, oop_cents: acc(c.member_id, p.plan_year).oop_cents }, family: family(p.plan_year) }]));
    for (const p of e.postings) {
      const before = prev ? prev.postings.find(x => x.plan_year === p.plan_year) : null, a = acc(c.member_id, p.plan_year);
      a.deductible_cents += p.deductible_cents - (before ? before.deductible_cents : 0);
      a.oop_cents += p.oop_cents - (before ? before.oop_cents : 0);
    }
  }
  for (const p of s.pas) if (p.approved !== null) p.approved_after_post = postedBy(s, p.decided_at);
  [...s.appeals].sort(byTime('filed_at')).forEach((a, i) => { if (!a.keep_seq) a.filed_seq = String(i + 1); delete a.keep_seq; });
  if (s.appeals.length) s.issued.file = String(Math.max(...s.appeals.map(a => Number(a.filed_seq))));
  return s;
}

const postedBy = (s, at) => s.eobs.filter(e => ms(e.issued_at) <= ms(at)).reduce((m, e) => (BigInt(e.posting_seq) > BigInt(m) ? e.posting_seq : m), '0');

function process(s, claimId, lines, at) {
  const c = s.claims.find(x => x.claim_id === claimId);
  c.status = 'processed'; c.processed_at = at ?? c.review_at;
  return post(s, { eob_id: 'eob-' + (Number(s.issued.eob ?? '0') + 1), claim_id: claimId, version: 1, issued_at: c.processed_at, reason: 'initial', appeal_id: null, lines });
}

function window(s, type, id, notice_at) {
  s.windows.push({ target: { type, id }, notice_at, ends_at: due(notice_at, 180), closing: { due_at: due(notice_at, 166), done: false, notice_at: null } });
}

function base() {
  const s = household();
  claim(s, { claim_id: 'cl-1', member_id: 'm-1', provider_id: 'pv-1', received_at: '2026-11-12T10:00:00-05:00', lines: [line('ln-1', 1, 'svc-office-visit', '2026-11-10', 21000)] });
  process(s, 'cl-1', [paid('ln-1', 18000, { copay: 2500 }, 21000)]);
  return finalize(s);
}

const DENIED_LINES = [line('ln-1', 1, 'svc-knee-mri', '2026-11-11', 180000), line('ln-2', 2, 'svc-specialist-visit', '2026-11-11', 32000)];
function deniedClaim(lines = DENIED_LINES, s = base()) {
  claim(s, { claim_id: 'cl-3', member_id: 'm-1', provider_id: 'pv-5', received_at: '2026-11-12T11:00:00-05:00', lines: structuredClone(lines) });
  const e = process(s, 'cl-3', lines.map(l => denied(l.line_id, 'out_of_network', l.billed_cents)));
  window(s, 'claim', 'cl-3', e.issued_at);
  return finalize(s);
}

function openAppeal(target = { type: 'claim', id: 'cl-3' }, status = 'under_review', s, over = {}) {
  s = s ?? (target.type === 'claim' ? deniedClaim() : deniedPa());
  const filed_at = over.filed_at ?? '2026-11-17T09:00:00-05:00', id = over.appeal_id ?? 'ap-' + (Number(s.issued.ap ?? '0') + 1);
  const onClaim = target.type === 'claim', member = onClaim ? s.claims.find(c => c.claim_id === target.id).member_id : s.pas.find(p => p.pa_id === target.id).member_id;
  const lines = onClaim ? s.eobs.find(e => e.claim_id === target.id && e.version === 1).lines.filter(l => l.status === 'denied').map(l => l.line_id) : null;
  const expedited = Boolean(over.expedited);
  s.appeals.push({ appeal_id: id, appeal_version: 0, member_id: member, target: { ...target }, lines, expedited, filed_at, filed_seq: '0', due_at: expedited ? toIso(ms(filed_at) + 72 * 3600000) : due(filed_at, onClaim ? 60 : 30),
    overdue: false, overdue_at: null, status, statements: [{ at: filed_at, by: 'm-1', text: 'The care was medically necessary and the provider was listed as in network.' }],
    info_requests: status === 'info_requested' ? [{ at: toIso(ms(filed_at) + 6 * 3600000), text: 'A copy of the referral' }] : [], decided_at: null, outcome: null, withdrawn_at: null, ...over, keep_seq: over.filed_seq !== undefined });
  s.issued.ap = String(Math.max(Number(s.issued.ap ?? '0'), Number(id.slice(3))));
  return finalize(s);
}

function overturned(lines = ['ln-1', 'ln-2'], decided_at = '2026-11-18T10:00:00-05:00', s = openAppeal(), priced = {}) {
  const a = s.appeals.find(x => x.target.type === 'claim' && x.target.id === 'cl-3' && (x.status === 'under_review' || x.status === 'info_requested'));
  Object.assign(a, { status: 'overturned', decided_at, outcome: { lines, units: null, valid_until: null }, appeal_version: a.appeal_version + 1 });
  const v1 = s.eobs.find(e => e.claim_id === 'cl-3' && e.version === 1);
  const repriced = { 'ln-1': paid('ln-1', 150000, { ded: 150000 }, 180000), 'ln-2': paid('ln-2', 30000, { copay: 5000 }, 32000), ...priced };
  post(s, { eob_id: 'eob-' + (Number(s.issued.eob) + 1), claim_id: 'cl-3', version: 2, issued_at: decided_at, reason: 'appeal', appeal_id: a.appeal_id, lines: v1.lines.map(l => (lines.includes(l.line_id) ? repriced[l.line_id] : structuredClone(l))) });
  return finalize(s);
}

function paApproved(units = 12, validity = { valid_from: '2026-11-05', valid_until: '2027-02-28' }, s = base()) {
  const submitted_at = '2026-11-02T09:00:00-05:00';
  s.pas.push({ pa_id: 'pa-1', pa_version: 1, member_id: 'm-3', provider_id: 'pv-3', service_id: 'svc-physical-therapy', status: 'approved', submitted_at, requested: { units: 12, valid_from: '2026-11-05', valid_until: '2027-02-28' },
    approved: { units, ...validity }, approved_after_post: '0', units_used: 0, info_requests: [], expedite: null, due_at: due(submitted_at, 15), overdue: false, overdue_at: null,
    decided_at: '2026-11-05T10:00:00-05:00', expired_at: null, denial_notice_at: null, covered_submissions: [] });
  return finalize(s);
}

function paUsed(s = paApproved()) {
  Object.assign(s.coverage.find(c => c.member_id === 'm-3' && c.plan_year === 2026), { status: 'none', version: 1, attested_at: '2026-02-01T10:00:00-05:00' });
  claim(s, { claim_id: 'cl-5', member_id: 'm-3', provider_id: 'pv-3', received_at: '2026-11-13T10:00:00-05:00', lines: [line('ln-1', 1, 'svc-physical-therapy', '2026-11-12', 15000)] });
  process(s, 'cl-5', [paid('ln-1', 15000, { copay: 3500 }, 15000, { id: 'pa-1', units: 1 })]);
  s.pas.find(p => p.pa_id === 'pa-1').units_used = 1;
  return finalize(s);
}

function paPending(status = 'pending', s = base()) {
  const submitted_at = '2026-11-16T09:00:00-05:00';
  s.pas.push({ pa_id: 'pa-2', pa_version: status === 'pending' ? 0 : 1, member_id: 'm-3', provider_id: 'pv-4', service_id: 'svc-arthroscopy', status, submitted_at, requested: { units: 1, valid_from: '2026-12-01', valid_until: '2026-12-31' },
    approved: null, approved_after_post: null, units_used: 0, info_requests: status === 'info_requested' ? [{ at: '2026-11-17T09:00:00-05:00', text: 'Imaging report from the last visit' }] : [], expedite: null,
    due_at: due(submitted_at, 15), overdue: false, overdue_at: null, decided_at: null, expired_at: null, denial_notice_at: null, covered_submissions: [] });
  return finalize(s);
}

function deniedPa(s = base()) {
  const submitted_at = '2026-11-01T09:00:00-05:00', decided_at = '2026-11-10T10:00:00-05:00';
  s.pas.push({ pa_id: 'pa-3', pa_version: 1, member_id: 'm-2', provider_id: 'pv-4', service_id: 'svc-arthroscopy', status: 'denied', submitted_at, requested: { units: 1, valid_from: '2026-11-20', valid_until: '2026-12-20' },
    approved: null, approved_after_post: null, units_used: 0, info_requests: [], expedite: null, due_at: due(submitted_at, 15), overdue: false, overdue_at: null, decided_at, expired_at: null, denial_notice_at: decided_at, covered_submissions: [] });
  window(s, 'pa', 'pa-3', decided_at);
  return finalize(s);
}

function pendingCob(member = 'm-2', planYear = 2026, s = base(), flagged = false, over = {}) {
  const id = over.claim_id ?? (s.claims.some(c => c.claim_id === 'cl-4') ? 'cl-4-' + s.claims.length : 'cl-4');
  const c = claim(s, { claim_id: id, member_id: member, provider_id: 'pv-1', received_at: over.received_at ?? '2026-11-13T09:00:00-05:00',
    lines: [line('ln-1', 1, 'svc-office-visit', over.service_date ?? (planYear === 2026 ? '2026-11-09' : planYear + '-12-20'), 21000, { possible_accident: flagged })] });
  c.status = 'pending_info';
  const open = (type, n) => ({ info_request_id: 'ir-' + n, request_version: 0, type, claim_id: id, line_id: 'ln-1', plan_year: planYear, opened_at: c.review_at, expires_at: due(c.review_at, 45), status: 'open', answer: null, answered_at: null });
  const n = Number(s.issued.ir ?? '0');
  s.info_requests.push(open('other_coverage', n + 1));
  if (flagged) s.info_requests.push(open('accident', n + 2));
  s.issued.ir = String(n + (flagged ? 2 : 1));
  return finalize(s);
}

function received(lines = [line('ln-1', 1, 'svc-office-visit', '2026-11-16', 21000)], s = base()) {
  claim(s, { claim_id: 'cl-2', member_id: 'm-2', provider_id: 'pv-1', received_at: '2026-11-17T10:00:00-05:00', lines: structuredClone(lines) });
  return finalize(s);
}

function ledger(postings, s = base()) {
  postings.forEach((p, i) => {
    const id = 'cl-l' + (i + 1), date = p.year + '-02-0' + (i + 1), received_at = toIso(Date.parse(p.year + '-02-1' + (i + 1) + 'T10:00:00-05:00'));
    claim(s, { claim_id: id, member_id: p.member, provider_id: 'pv-2', received_at, lines: [line('ln-1', 1, 'svc-knee-mri', date, p.deductible_cents)] });
    if (p.year !== 2026 || p.member !== 'm-1') Object.assign(s.coverage.find(c => c.member_id === p.member && c.plan_year === p.year), { status: 'none', version: 1, attested_at: p.year + '-01-0' + (i + 1) + 'T10:00:00-05:00' });
    process(s, id, [paid('ln-1', p.deductible_cents, { ded: p.deductible_cents }, p.deductible_cents)]);
  });
  return finalize(s);
}

function granted(s = base(), member = 'm-2', scope = 'view', expires_at = null, grantee = 'm-1') {
  const m = s.members.find(x => x.member_id === member);
  s.grants.push({ grant_id: 'gr-h' + (s.grants.length + 1), grant_version: 0, member_id: member, grantor_id: m.is_minor ? m.guardian_ids[0] : member, grantee_id: grantee, scope, created_at: '2026-06-01T09:00:00-04:00', expires_at, status: 'active', revoked_at: null });
  return finalize(s);
}

const edit = (s, fn) => { fn(s); return s; };
const full = () => granted(received(undefined, pendingCob(undefined, undefined, deniedPa(paPending(undefined, paUsed(paApproved(undefined, undefined, openAppeal(undefined, undefined, deniedClaim()))))))));

module.exports = { household, base, deniedClaim, openAppeal, overturned, paApproved, paUsed, paPending, deniedPa, pendingCob, received, ledger, granted, edit, full, finalize, postedBy, claim, process, post, window, line, paid, denied, due, ms };
