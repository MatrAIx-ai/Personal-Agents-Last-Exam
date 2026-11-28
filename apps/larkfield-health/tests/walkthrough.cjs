'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { compile } = require('./schema-validator.cjs');
const sender = require('../infra/sender.cjs');

const STEPS = require('../examples/walkthrough.json');
const SPEC = require('./spec-events.json').envelopes;
const P = 'larkfield-health.';
const REASON = 'Riley\'s orthopedist wants therapy for the injured knee to start this week.';
const TOOL = { at: '2026-12-03T11:30:00-05:00', name: P + 'pa.request_expedite', arguments: { pa_id: 'pa-4', reason: REASON } };
const ORDER = ['ev-1', 'ev-2', 'ev-3', 'ev-4', 'expedite', 'ev-5', 'ev-6', 'ev-7', 'ev-8', 'ev-9', 'ev-10', 'ev-11'];
const WIRE = '{"specversion":"1.0","id":"e2-n-17","source":"urn:pale:app:larkfield-health:account:larkfield-m-1","type":"org.pale.mail.notification.v1","time":"2026-12-04T10:00:00-05:00","datacontenttype":"application/json","dataschema":"urn:pale:email-payload:1","data":{"channel":"channel.email","recipient":{"kind":"person_ref","id":"m-1"},"source_object":{"app_id":"larkfield-health","account_id":"larkfield-m-1","object_type":"pa","object_id":"pa-4"},"content":{"title":"Prior authorization decision","body":{"format":"text/plain","text":"Prior authorization pa-4 for member m-3 was approved: 12 units, valid 2026-12-01 to 2027-02-28."},"asset_ids":[]},"extensions":[]}}';
const wireValid = compile(require('../schemas/router-message.schema.json'), path.join(__dirname, '..', 'schemas'));
const TITLES = { eob_available: 'Explanation of benefits available', info_requested: 'Information requested', claim_denied: 'Claim denied', pa_decision: 'Prior authorization decision', decision_overdue: 'Decision overdue', appeal_info_requested: 'Appeal information requested', appeal_decision: 'Appeal decision' };
const KEYS = { claims: c => c.claim_id, info_requests: r => r.info_request_id, eobs: e => e.eob_id, pas: p => p.pa_id, appeals: a => a.appeal_id, windows: w => w.target.type + ':' + w.target.id, grants: g => g.grant_id, approvals: a => a.approval_id, coverage: c => c.member_id + ':' + c.plan_year, accumulators: a => a.member_id + ':' + a.plan_year };

const idOf = s => (s.event ? s.event.event_id : 'expedite');
const atOf = s => (s.event ? s.event.at : s.tool.at);
const group = (ids, recipients, kind, [type, id], member_id, at, body, fields) => ids.map((notice_id, i) => ({ notice_id, kind: 'notice.' + kind, recipient_id: recipients[i], subject: { type, id }, member_id, at, title: TITLES[kind], body, fields }));
const paid = (line_id, allowed, copay, ded, coins, billed, pa = null) => ({ line_id, status: 'paid', reason: null, allowed_cents: allowed, copay_cents: copay, deductible_cents: ded, coinsurance_cents: coins, member_cost_cents: copay + ded + coins, plan_paid_cents: allowed - copay - ded - coins, not_allowed_cents: billed - allowed, pa_id: pa, pa_units: pa ? 1 : 0 });
const denied = (line_id, reason, billed) => ({ line_id, status: 'denied', reason, allowed_cents: 0, copay_cents: 0, deductible_cents: 0, coinsurance_cents: 0, member_cost_cents: 0, plan_paid_cents: 0, not_allowed_cents: billed, pa_id: null, pa_units: 0 });
const ledger = (md, mo, fd, fo) => ({ 2026: { member: { deductible_cents: md, oop_cents: mo }, family: { deductible_cents: fd, oop_cents: fo } } });
const accident = (info_request_id, claim_id, line_id, opened_at, expires_at) => ({ info_request_id, request_version: 0, type: 'accident', claim_id, line_id, plan_year: 2026, opened_at, expires_at, status: 'open', answer: null, answered_at: null });
const eob = (eob_id, claim_id, version, issued_at, posting_seq, reason, appeal_id, ledger_before, lines, member, oop, ded = 0) => ({ eob_id, claim_id, version, issued_at, posting_seq, reason, appeal_id, ledger_before, lines, postings: [{ member_id: member, plan_year: 2026, deductible_cents: ded, oop_cents: oop }] });

function changes(a, b) {
  const out = [];
  for (const [list, key] of Object.entries(KEYS)) {
    const before = new Map(a[list].map(r => [key(r), JSON.stringify(r)])), after = new Set(b[list].map(key));
    for (const r of b[list]) if (before.get(key(r)) !== JSON.stringify(r)) out.push([list, key(r), r]);
    for (const k of before.keys()) if (!after.has(k)) out.push([list, k, null]);
  }
  return out;
}

function expectations(seed) {
  const S = (list, id) => structuredClone(seed[list].find(r => r[Object.keys(seed[list][0])[0]] === id));
  const ALL = ['m-1', 'm-2', 'm-3'], ADULTS = ['m-1', 'm-2'];
  const due = '2026-11-29T23:59:00-05:00';
  const ask = (claim, line, expires) => 'Claim ' + claim + ' for member m-3 needs an answer on whether the service on line ' + line + ' resulted from an accident. Answer before 23:59 Eastern Time on ' + expires + '; an unanswered request can lead to a denial for missing information.';
  const cl7 = { claim_id: 'cl-7', claim_version: 0, member_id: 'm-3', provider_id: 'pv-2', received_at: '2026-12-01T09:00:00-05:00', received_seq: '59', review_at: '2026-12-04T23:59:00-05:00', status: 'received',
    lines: [{ line_id: 'ln-1', position: 1, service_id: 'svc-knee-mri', service_date: '2026-11-24', units: 1, billed_cents: 180000, emergency: false, possible_accident: true }], processed_at: null };
  const pa4 = { pa_id: 'pa-4', pa_version: 0, member_id: 'm-3', provider_id: 'pv-2', service_id: 'svc-physical-therapy', status: 'pending', submitted_at: '2026-12-01T10:00:00-05:00', requested: { units: 12, valid_from: '2026-12-01', valid_until: '2027-02-28' },
    approved: null, approved_after_post: null, units_used: 0, info_requests: [], expedite: null, due_at: '2026-12-16T23:59:00-05:00', overdue: false, overdue_at: null, decided_at: null, expired_at: null, denial_notice_at: null, covered_submissions: [] };
  const asked = { ...pa4, pa_version: 1, status: 'info_requested', info_requests: [{ at: '2026-12-02T10:00:00-05:00', text: 'Notes from the last two visits' }] };
  const pa5 = { ...S('pas', 'pa-5'), pa_version: 1, overdue: true, overdue_at: '2026-12-02T23:59:00-05:00' };
  const expedite = { requested_at: '2026-12-03T11:30:00-05:00', reason: REASON, status: 'open', decided_at: null };
  const fast = { ...asked, pa_version: 4, status: 'pending', expedite: { ...expedite, status: 'approved', decided_at: '2026-12-03T15:00:00-05:00' }, due_at: '2026-12-06T11:30:00-05:00' };
  const terms = { units: 12, valid_from: '2026-12-01', valid_until: '2027-02-28' };
  const ap3 = S('appeals', 'ap-3'), request = { at: '2026-12-07T09:00:00-05:00', text: 'A letter from the treating provider' };
  const appealFields = status => ({ appeal_id: 'ap-3', target: { type: 'claim', id: 'cl-14' }, status, due_at: '2026-12-28T23:59:00-05:00' });
  const at = '2026-12-08T09:00:00-05:00';
  return {
    'ev-1': [[
      ['claims', 'cl-13', { ...S('claims', 'cl-13'), claim_version: 3, status: 'processed', processed_at: due }],
      ['claims', 'cl-15', { ...S('claims', 'cl-15'), claim_version: 1, status: 'processed', processed_at: '2026-11-19T23:59:00-05:00' }],
      ['claims', 'cl-16', { ...S('claims', 'cl-16'), claim_version: 1, status: 'pending_info' }],
      ['claims', 'cl-17', { ...S('claims', 'cl-17'), claim_version: 1, status: 'processed', processed_at: '2026-11-21T23:59:00-05:00' }],
      ['claims', 'cl-7', cl7],
      ['info_requests', 'ir-11', { ...S('info_requests', 'ir-11'), request_version: 1, status: 'expired' }],
      ['info_requests', 'ir-12', { ...S('info_requests', 'ir-12'), request_version: 1, status: 'expired' }],
      ['info_requests', 'ir-13', accident('ir-13', 'cl-16', 'ln-1', '2026-11-20T23:59:00-05:00', '2027-01-04T23:59:00-05:00')],
      ['info_requests', 'ir-14', accident('ir-14', 'cl-16', 'ln-2', '2026-11-20T23:59:00-05:00', '2027-01-04T23:59:00-05:00')],
      ['eobs', 'eob-14', eob('eob-14', 'cl-15', 1, '2026-11-19T23:59:00-05:00', '56', 'initial', null, ledger(15375, 55375, 183651, 292269), [paid('ln-1', 18000, 2500, 0, 0, 21500)], 'm-3', 2500)],
      ['eobs', 'eob-15', eob('eob-15', 'cl-17', 1, '2026-11-21T23:59:00-05:00', '57', 'initial', null, ledger(150000, 175618, 183651, 294769), [paid('ln-1', 18000, 2500, 0, 0, 21000)], 'm-1', 2500)],
      ['eobs', 'eob-16', eob('eob-16', 'cl-13', 1, due, '58', 'initial', null, ledger(150000, 178118, 183651, 297269), [denied('ln-1', 'missing_information', 33500), denied('ln-2', 'missing_information', 15800)], 'm-1', 0)],
      ['windows', 'claim:cl-8', { ...seed.windows.find(w => w.target.id === 'cl-8'), closing: { due_at: '2026-11-22T23:59:00-05:00', done: true, notice_at: null } }],
      ['windows', 'claim:cl-13', { target: { type: 'claim', id: 'cl-13' }, notice_at: due, ends_at: '2027-05-28T23:59:00-04:00', closing: { due_at: '2027-05-14T23:59:00-04:00', done: false, notice_at: null } }],
      ['accumulators', 'm-1:2026', { member_id: 'm-1', plan_year: 2026, deductible_cents: 150000, oop_cents: 178118 }],
      ['accumulators', 'm-3:2026', { member_id: 'm-3', plan_year: 2026, deductible_cents: 15375, oop_cents: 57875 }],
    ], [
      ...group(['n-1', 'n-2', 'n-3'], ALL, 'eob_available', ['claim', 'cl-15'], 'm-3', '2026-11-19T23:59:00-05:00', 'Explanation of benefits version 1 for claim cl-15 (member m-3) is available: member cost $25.00, plan paid $155.00.', { claim_id: 'cl-15', eob_version: 1, member_cost_cents: 2500, plan_paid_cents: 15500 }),
      ...group(['n-4', 'n-5', 'n-6'], ALL, 'info_requested', ['info_request', 'ir-13'], 'm-3', '2026-11-20T23:59:00-05:00', ask('cl-16', 'ln-1', '2027-01-04'), { claim_id: 'cl-16', line_id: 'ln-1', type: 'accident', expires_at: '2027-01-04T23:59:00-05:00' }),
      ...group(['n-7', 'n-8', 'n-9'], ALL, 'info_requested', ['info_request', 'ir-14'], 'm-3', '2026-11-20T23:59:00-05:00', ask('cl-16', 'ln-2', '2027-01-04'), { claim_id: 'cl-16', line_id: 'ln-2', type: 'accident', expires_at: '2027-01-04T23:59:00-05:00' }),
      ...group(['n-10', 'n-11'], ADULTS, 'eob_available', ['claim', 'cl-17'], 'm-1', '2026-11-21T23:59:00-05:00', 'Explanation of benefits version 1 for claim cl-17 (member m-1) is available: member cost $25.00, plan paid $155.00.', { claim_id: 'cl-17', eob_version: 1, member_cost_cents: 2500, plan_paid_cents: 15500 }),
      ...group(['n-12', 'n-13'], ADULTS, 'eob_available', ['claim', 'cl-13'], 'm-1', due, 'Explanation of benefits version 1 for claim cl-13 (member m-1) is available: member cost $0.00, plan paid $0.00.', { claim_id: 'cl-13', eob_version: 1, member_cost_cents: 0, plan_paid_cents: 0 }),
      ...group(['n-14', 'n-15'], ADULTS, 'claim_denied', ['claim', 'cl-13'], 'm-1', due, 'Claim cl-13 for member m-1 has denied lines: ln-1 (information was not provided), ln-2 (information was not provided). An appeal can be filed before 23:59 Eastern Time on 2027-05-28.', { claim_id: 'cl-13', denied_lines: ['ln-1', 'ln-2'], window_ends_at: '2027-05-28T23:59:00-04:00' }),
    ]],
    'ev-2': [[['pas', 'pa-4', pa4]], []],
    'ev-3': [[['pas', 'pa-4', asked]], []],
    'ev-4': [[['pas', 'pa-5', pa5], ['pas', 'pa-4', { ...asked, pa_version: 2, status: 'pending' }]],
      group(['n-16'], ['m-2'], 'decision_overdue', ['pa', 'pa-5'], 'm-2', '2026-12-02T23:59:00-05:00', 'The decision on prior authorization pa-5 for member m-2 was due by 2026-12-02 at 23:59 Eastern Time and is overdue.', { due_at: '2026-12-02T23:59:00-05:00' })],
    expedite: [[['pas', 'pa-4', { ...asked, pa_version: 3, status: 'pending', expedite }]], []],
    'ev-5': [[['pas', 'pa-4', fast]], []],
    'ev-6': [[['pas', 'pa-4', { ...fast, pa_version: 5, status: 'approved', approved: terms, approved_after_post: '58', decided_at: '2026-12-04T10:00:00-05:00' }]],
      group(['n-17', 'n-18', 'n-19'], ALL, 'pa_decision', ['pa', 'pa-4'], 'm-3', '2026-12-04T10:00:00-05:00', 'Prior authorization pa-4 for member m-3 was approved: 12 units, valid 2026-12-01 to 2027-02-28.', { pa_id: 'pa-4', status: 'approved', ...terms })],
    'ev-7': [[['pas', 'pa-5', { ...pa5, pa_version: 2, status: 'withdrawn' }]], []],
    'ev-8': [[
      ['claims', 'cl-7', { ...cl7, claim_version: 1, status: 'pending_info' }],
      ['info_requests', 'ir-15', accident('ir-15', 'cl-7', 'ln-1', '2026-12-04T23:59:00-05:00', '2027-01-18T23:59:00-05:00')],
      ['appeals', 'ap-3', { ...ap3, appeal_version: 1, status: 'info_requested', info_requests: [request] }],
    ], [
      ...group(['n-20', 'n-21', 'n-22'], ALL, 'info_requested', ['info_request', 'ir-15'], 'm-3', '2026-12-04T23:59:00-05:00', ask('cl-7', 'ln-1', '2027-01-18'), { claim_id: 'cl-7', line_id: 'ln-1', type: 'accident', expires_at: '2027-01-18T23:59:00-05:00' }),
      ...group(['n-23', 'n-24', 'n-25'], ALL, 'appeal_info_requested', ['appeal', 'ap-3'], 'm-3', request.at, 'The plan asked for more information on appeal ap-3 of claim cl-14 for member m-3: "A letter from the treating provider". The decision is still due by 2026-12-28 at 23:59 Eastern Time.', appealFields('info_requested')),
    ]],
    'ev-9': [[
      ['claims', 'cl-14', { ...S('claims', 'cl-14'), claim_version: 2 }],
      ['eobs', 'eob-17', eob('eob-17', 'cl-14', 2, at, '59', 'appeal', 'ap-3', ledger(15375, 57875, 183651, 297269), [paid('ln-1', 15000, 3500, 0, 0, 16500, 'pa-3'), paid('ln-2', 15000, 3500, 0, 0, 16500)], 'm-3', 7000)],
      ['appeals', 'ap-3', { ...ap3, appeal_version: 2, status: 'overturned', info_requests: [request], decided_at: at, outcome: { lines: ['ln-2'], units: null, valid_until: null } }],
      ['accumulators', 'm-3:2026', { member_id: 'm-3', plan_year: 2026, deductible_cents: 15375, oop_cents: 61375 }],
    ], [
      ...group(['n-26', 'n-27', 'n-28'], ALL, 'eob_available', ['claim', 'cl-14'], 'm-3', at, 'Explanation of benefits version 2 for claim cl-14 (member m-3) is available: member cost $70.00, plan paid $230.00.', { claim_id: 'cl-14', eob_version: 2, member_cost_cents: 7000, plan_paid_cents: 23000 }),
      ...group(['n-29', 'n-30', 'n-31'], ALL, 'appeal_decision', ['appeal', 'ap-3'], 'm-3', at, 'Appeal ap-3 of claim cl-14 for member m-3 was overturned for line ln-2; a new explanation of benefits was issued.', appealFields('overturned')),
    ]],
    'ev-10': [[['grants', 'gr-2', { grant_id: 'gr-2', grant_version: 0, member_id: 'm-2', grantor_id: 'm-2', grantee_id: 'm-1', scope: 'act', created_at: '2026-12-08T10:00:00-05:00', expires_at: null, status: 'active', revoked_at: null }]], []],
    'ev-11': [[['approvals', 'cf-1', { approval_id: 'cf-1', token: 'tok-7c1e', subject: null, confirmed_by: 'm-1', confirmed_at: '2026-12-08T10:05:00-05:00', used_at: null }]], []],
    expediteResult: [expedite, '2026-12-16T23:59:00-05:00', []],
    cl14v1: [paid('ln-1', 15000, 3500, 0, 0, 16500, 'pa-3'), denied('ln-2', 'prior_auth_missing', 16500)],
  };
}

function play(f, seed, steps = STEPS) {
  assert.deepEqual(steps.map(idOf), ORDER, 'the walkthrough steps, in order');
  assert.deepEqual(steps.filter(s => s.event).map(s => s.event), SPEC, 'the walkthrough events are the proposal\'s');
  assert.deepEqual(steps.filter(s => s.tool).map(s => s.tool), [TOOL], 'the walkthrough\'s Agent step is the authored expedite request');
  const want = expectations(seed);
  assert.deepEqual(seed.eobs.find(e => e.claim_id === 'cl-14' && e.version === 1).lines, want.cl14v1);
  const start = seed.notices.length, summary = [];
  let wire = null;
  for (const s of steps) {
    const id = idOf(s), before = f.data();
    assert.ok(Date.parse(atOf(s)) >= Date.parse(f.ctx.virtual_now), id + ' does not move the clock backward');
    const out = s.event ? f.event(s.event) : (f.setNow(s.tool.at), f.call(s.tool.name, s.tool.arguments));
    assert.equal(out.status, 'committed', id + ': ' + JSON.stringify(out));
    const after = f.data(), added = after.notices.slice(before.notices.length);
    assert.deepEqual(changes(before, after), want[id][0], id + ' effects');
    assert.deepEqual(added, want[id][1], id + ' notices');
    if (id === 'expedite') assert.deepEqual([out.pa.expedite, out.pa.due_at, out.pa.approvals], want.expediteResult);
    if (id === 'ev-6') {
      const message = sender.message({ epoch: 2, data: after }, added.find(n => n.notice_id === 'n-17'));
      assert.equal(JSON.stringify(message), WIRE);
      assert.ok(wireValid(message));
      wire = message.id;
    }
    if (id === 'ev-10') assert.deepEqual(f.call(P + 'members.list', {}).members.map(m => [m.member_id, m.powers]), [['m-1', ['self']], ['m-2', ['view', 'act']], ['m-3', ['guardian']]]);
    summary.push([id, added.length]);
  }
  assert.deepEqual(f.data().notices.slice(start).map(n => n.notice_id), Array.from({ length: 31 }, (_, i) => 'n-' + (i + 1)));
  return { steps: summary, wire };
}

module.exports = { STEPS, ORDER, WIRE, TOOL, play, expectations, changes };
