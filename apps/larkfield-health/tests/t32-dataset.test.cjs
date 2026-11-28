'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const { ms, toIso } = require('../src/time.cjs');
const { dueTimers, project, applyDueTimers } = require('../src/timers.cjs');
const { relation } = require('../src/authority.cjs');
const { fixture } = require('./harness.cjs');
const lib = require('../dataset/lib.cjs');
const generate = require('../dataset/generate.cjs');
const notes = require('../dataset/notes.cjs');
const { asOf, outcome } = require('../dataset/as-of.cjs');
const { compute, render, measures, OUT, instantsOf, timerInstant, PROPOSAL } = require('../dataset/coverage.cjs');

const files = lib.load();
const steps = files.replay.steps;
const P = lib.P;
const END_READ = toIso(ms(lib.END) - 1);
const after = s => toIso(ms(s.at) + 1);
const strings = (v, out = []) => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach(x => strings(x, out)); else if (v && typeof v === 'object') Object.values(v).forEach(x => strings(x, out)); return out; };
const COUNTED = { ir: ['info_requests', 'info_request_id'], eob: ['eobs', 'eob_id'], ap: ['appeals', 'appeal_id'], n: ['notices', 'notice_id'] };
const expired = files.full.info_requests.find(r => r.status === 'expired' && toIso(ms(r.expires_at) + 1) === timerInstant(files));
const holderFilings = steps.filter(s => s.by === lib.OWNER && s.tool === P + 'appeals.file.confirm');
const holderAnswers = steps.filter(s => s.by === lib.OWNER && (s.tool === P + 'claims.info.confirm' || s.tool === P + 'coverage.cob.confirm'));
const claimOf = id => files.full.claims.find(c => c.claim_id === id);
const CORE_CUTS = [...holderFilings.map(s => after({ at: claimOf(s.args.target_id).processed_at })), after({ at: claimOf(holderAnswers[0].args.claim_id || files.full.info_requests.find(r => r.answered_at === holderAnswers[0].at).claim_id).review_at })];
const INSTANTS = [...new Set([lib.START, '2025-07-01', '2026-01-01', lib.REFERENCE, '2026-12-15', lib.END, timerInstant(files), ...CORE_CUTS].map(lib.instant))];

function claimTimes(seed, id) {
  const c = seed.claims.find(x => x.claim_id === id), out = [c.received_at, c.processed_at];
  for (const r of seed.info_requests.filter(x => x.claim_id === id)) out.push(r.opened_at, r.answered_at, r.status === 'expired' ? r.expires_at : null);
  for (const e of seed.eobs.filter(x => x.claim_id === id)) out.push(e.issued_at);
  for (const a of seed.appeals.filter(x => x.target.type === 'claim' && x.target.id === id)) out.push(a.filed_at, a.decided_at, a.withdrawn_at, a.overdue_at, ...a.statements.map(s => s.at), ...a.info_requests.map(r => r.at));
  const w = seed.windows.find(x => x.target.type === 'claim' && x.target.id === id);
  if (w) out.push(w.notice_at, w.closing.done ? w.closing.due_at : null);
  return out.filter(Boolean);
}

function writtenAfter(data, from) {
  const out = new Set(), late = at => at && ms(at) >= ms(from), target = a => a.target.type + ':' + a.target.id;
  for (const c of data.claims) if (late(c.received_at)) out.add('claim ' + c.claim_id + ' ' + c.received_at);
  for (const r of data.info_requests) if (r.status === 'answered' && late(r.answered_at)) out.add('answer ' + r.claim_id + ' ' + r.line_id + ' ' + r.type + ' ' + r.answered_at + ' ' + r.answer);
  for (const c of data.coverage) if (late(c.attested_at)) out.add('attestation ' + c.member_id + ':' + c.plan_year + ' ' + c.attested_at + ' ' + c.status);
  for (const e of data.eobs) if (e.version > 1 && late(e.issued_at)) out.add('eob ' + e.claim_id + ' v' + e.version + ' ' + e.issued_at);
  for (const p of data.pas) {
    if (late(p.submitted_at)) out.add('pa ' + p.pa_id + ' ' + p.submitted_at);
    if (late(p.denial_notice_at)) out.add('pa denial ' + p.pa_id + ' ' + p.denial_notice_at);
    if (p.approved && late(p.decided_at)) out.add('pa approval ' + p.pa_id + ' ' + p.decided_at);
    for (const r of p.info_requests) if (late(r.at)) out.add('pa request ' + p.pa_id + ' ' + r.at);
    if (p.expedite && late(p.expedite.requested_at)) out.add('expedite ' + p.pa_id + ' ' + p.expedite.requested_at);
    if (p.expedite && late(p.expedite.decided_at)) out.add('expedite decision ' + p.pa_id + ' ' + p.expedite.decided_at + ' ' + p.expedite.status);
    for (const s of p.covered_submissions) if (late(s.at)) out.add('covered ' + s.pa_id + ' ' + s.at);
  }
  for (const a of data.appeals) {
    if (late(a.filed_at)) out.add('appeal ' + target(a) + ' ' + a.filed_at);
    for (const s of a.statements) if (late(s.at)) out.add('statement ' + target(a) + ' ' + s.at + ' ' + s.by);
    for (const r of a.info_requests) if (late(r.at)) out.add('appeal request ' + target(a) + ' ' + r.at);
    if (late(a.decided_at)) out.add('appeal decision ' + target(a) + ' ' + a.decided_at + ' ' + a.status);
    if (late(a.withdrawn_at)) out.add('withdrawal ' + target(a) + ' ' + a.withdrawn_at);
  }
  for (const g of data.grants) { if (late(g.created_at)) out.add('grant ' + g.member_id + '>' + g.grantee_id + ' ' + g.scope + ' ' + g.created_at); if (late(g.revoked_at)) out.add('revocation ' + g.grant_id + ' ' + g.revoked_at); }
  return out;
}
const DATASET_ENTRIES = writtenAfter(files.full, lib.START);

function replayInApp(selection, entries, each = () => {}) {
  const f = fixture({ seed: selection.data, now: selection.virtual_now });
  const statuses = [];
  for (const e of entries) {
    if (e.kind === 'event') { statuses.push(f.event(e.event).status); each(f.data(), e.event.at); continue; }
    f.setNow(e.at);
    const name = e.tool.slice(P.length);
    let args = e.args;
    if (lib.PREVIEW[name]) {
      const token = f.call(P + lib.PREVIEW[name], e.args).preview.token;
      statuses.push(f.event({ event_id: 'confirm-' + e.id, at: e.at, operation: 'user.confirmed', payload: { token, confirmed_by: e.by } }).status);
      args = { ...e.args, token };
    }
    statuses.push(f.call(e.tool, args).status);
    each(f.data(), e.at);
  }
  const data = f.data(), end = project(data, END_READ);
  return { statuses, end, extra: [...writtenAfter(data, selection.as_of)].filter(x => !DATASET_ENTRIES.has(x)), outcome: item => outcome(end, item) };
}

test('Dataset every month from 2025-01 to 2026-12 has claims and dated records, from the window\'s first day', () => {
  const c = compute(files);
  assert.deepEqual(c.monthly.map(m => m.month), lib.months());
  for (const m of c.monthly) assert.ok(m.claims >= 1 && m.distinct_dates >= 4 && m.eobs >= 1 && m.notices >= 2, 'coverage in ' + m.month + ': ' + JSON.stringify([m.claims, m.distinct_dates, m.eobs, m.notices]));
  assert.deepEqual(c.months_without_claims, []);
  assert.deepEqual([c.earliest, c.invalid_dates, c.outside_window], [lib.FIRST, 0, 0]);
  assert.ok(c.latest >= '2026-12-28');
  assert.equal(c.distinct_dates.coverage, new Set(lib.dated(files.full).map(i => lib.dateOf(i.at))).size);
  assert.ok(c.distinct_dates.global >= c.distinct_dates.coverage);
  const dates = new Set(lib.dated(files.full).map(i => lib.dateOf(i.at)));
  for (const g of c.gaps.filter(x => x.kind === 'days_without_records')) {
    assert.ok(g.days >= 7 && lib.daysBetween(g.from, g.to) + 1 === g.days);
    for (let d = g.from; d <= g.to; d = lib.addDays(d, 1)) assert.ok(!dates.has(d), g.from + ' gap holds ' + d);
    assert.ok((g.from === lib.FIRST || dates.has(lib.addDays(g.from, -1))) && (g.to === lib.LAST || dates.has(lib.addDays(g.to, 1))), 'gap bounds');
    assert.equal(g.last_claim_before, files.full.claims.map(x => lib.dateOf(x.received_at)).filter(d => d < g.from).sort().at(-1) || null);
    assert.equal(/Overlaps the/.test(g.reason), notes.TRIPS.some(t => t.from <= g.to && t.to >= g.from), g.from + ' names a trip exactly when one overlaps');
  }
  assert.deepEqual([c.provenance.real, c.provenance.mixed, c.provenance.synthetic], [0, 0, c.totals.records]);
  assert.ok(c.sources.every(s => s.kind === 'synthetic'));
  const later = lib.dated(files.full).filter(i => ms(i.at) >= ms(lib.REFERENCE)).length;
  assert.equal(c.partitions[1].records, later);
  assert.equal(c.monthly.reduce((s, m) => s + m.records_after_reference_clock, 0), later);
  const anchor = c.gaps.find(g => g.kind === 'real_data_anchor');
  assert.ok(anchor && anchor.reason.includes(PROPOSAL) && /PR #64/.test(anchor.reason) && /line 103/.test(anchor.reason) && /no crawling or copied content/.test(anchor.reason) && /pending maintainer agreement/.test(anchor.status));
  assert.match(c.provenance.code_sets, /^None\./);
  assert.deepEqual(c.provenance.real_public_facts[0].dates, [...notes.OFFICE_CLOSED]);
});

test('Dataset an as-of selection holds only what was recorded before its instant, with matching counters, timers and clock', () => {
  const seen = new Set();
  for (const text of INSTANTS) {
    const s = asOf(text, files), t = ms(s.as_of);
    assert.equal(s.virtual_now, toIso(t), text);
    assert.ok(!seen.has(s.data.seed_id), 'its own seed ID');
    seen.add(s.data.seed_id);
    assert.ok(steps.slice(0, s.steps_applied).every(x => ms(x.at) < t) && steps.slice(s.steps_applied).every(x => ms(x.at) >= t), 'cut at ' + text);
    assert.equal(s.steps_applied + s.steps_withheld, steps.length);
    assert.deepEqual(s.data.claims.map(c => c.claim_id), files.full.claims.filter(c => ms(c.received_at) < t).map(c => c.claim_id), 'claims before ' + text);
    assert.deepEqual(s.data.pas.map(p => p.pa_id), files.full.pas.filter(p => ms(p.submitted_at) < t).map(p => p.pa_id), 'PAs before ' + text);
    assert.ok(lib.dated(s.data).every(i => ms(i.at) < t), 'every dated record is before ' + text);
    assert.deepEqual(s.data.notices.map(n => n.notice_id), files.full.notices.filter(n => ms(n.at) < t).map(n => n.notice_id), 'exactly the notices dated before ' + text);
    assert.deepEqual(dueTimers(s.data, toIso(t - 1)), [], 'no timer due before ' + text + ' is left uncommitted');
    assert.equal(s.data.approvals.length, 0);
    for (const c of s.data.claims) if (Math.max(...claimTimes(files.full, c.claim_id).map(ms)) < t) assert.deepEqual(c, claimOf(c.claim_id), 'a finished claim is identical to the dataset record');
    for (const [prefix, [list, key]] of Object.entries(COUNTED)) {
      assert.equal(Number(s.data.issued[prefix] || 0), s.data[list].length, prefix + ' counter at ' + text);
      assert.ok(s.data[list].every((r, i) => r[key] === prefix + '-' + (i + 1)), prefix + ' IDs in issue order at ' + text);
    }
    assert.ok(s.events.every(e => ms(e.at) >= t), 'staged events are later');
    assert.equal(s.bundle.dataset.expected_counts.records, plugin.records(s.data).length);
    assert.equal(s.bundle.dataset.dataset_id, s.data.seed_id);
    const f = fixture({ seed: s.data, now: s.virtual_now });
    assert.deepEqual(f.call(P + 'claims.list', {}).claims.map(c => c.claim_id).sort(), s.data.claims.filter(c => relation(s.data, lib.OWNER, c.member_id, t).view).map(c => c.claim_id).sort(), 'the account holder lists what the grants allow at ' + text);
    assert.ok(Buffer.byteLength(lib.pretty(s.data)) < 1024 * 1024, 'selection under 1 MiB');
  }
});

test('Dataset selections on either side of a replay step have their own seed IDs, and a preview token from one is stale on the other', () => {
  const step = steps.find(s => s.operation === 'claim.received' && ms(s.at) > ms('2026-03-01T00:00:00-05:00'));
  const before = asOf(step.at, files), later = asOf(toIso(ms(step.at) + 1), files), same = asOf(toIso(ms(step.at) + 1), files);
  assert.equal(later.steps_applied, before.steps_applied + steps.filter(s => s.at === step.at).length);
  assert.notEqual(before.data.seed_id, later.data.seed_id);
  assert.equal(same.data.seed_id, later.data.seed_id);
  assert.match(later.data.seed_id, /^larkfield-delivery-asof-\d{8}T\d{6}\.\d{3}Z-[0-9a-f]{12}$/);
  const args = { action: 'grant', member_id: 'm-1', grantee_id: 'm-2', scope: 'view', expires_at: '2027-06-01T00:00:00-04:00' };
  const open = s => {
    const f = fixture({ seed: s.data, now: toIso(ms(step.at) + 60000) });
    return { f, token: f.call(P + 'grants.change.preview', args).preview.token };
  };
  const earlier = open(before), after2 = open(later);
  assert.notEqual(earlier.token, after2.token);
  const confirm = (f, token) => { f.event({ event_id: 'c-' + token.slice(-8), at: toIso(ms(step.at) + 60000), operation: 'user.confirmed', payload: { token, confirmed_by: 'm-1' } }); return f.call(P + 'grants.change.confirm', { ...args, token }).status; };
  assert.equal(confirm(after2.f, earlier.token), 'stale_preview');
  assert.equal(confirm(after2.f, after2.token), 'committed');
  assert.equal(confirm(earlier.f, earlier.token), 'committed');
});

test('Dataset every generated text agrees with the records it describes, and a contradicting one is caught', () => {
  assert.deepEqual(notes.problems(files.full, steps), []);
  const kinds = { pa: files.full.pas.filter(p => p.info_requests.length).length, expedite: files.full.pas.filter(p => p.expedite).length, statements: files.full.appeals.length, replies: files.full.appeals.filter(a => a.statements.length > 1).length };
  assert.ok(Object.values(kinds).every(n => n > 0), JSON.stringify(kinds));
  const broken = (change, pattern) => { const copy = structuredClone(files.full); change(copy); assert.ok(notes.problems(copy).some(p => pattern.test(p)), String(pattern)); };
  const appeal = test => files.full.appeals.findIndex(test);
  for (const a of files.full.appeals) {
    const i = files.full.appeals.indexOf(a);
    const dated = /\w+ \d{1,2}, \d{4}/.test(a.statements[0].text);
    broken(c => { const x = c.appeals[i].statements[0]; x.text = dated ? x.text.replace(/(\w+ \d{1,2}), (\d{4})/, (m, d, y) => d + ', ' + (Number(y) - 1)) : x.text.replace(/since \w+ \d{4}/, 'since December 2026'); }, new RegExp(a.appeal_id + ' statement'));
  }
  const oon = appeal(a => /first opening/.test(a.statements[0].text));
  broken(c => { c.appeals[oon].statements[0].text = c.appeals[oon].statements[0].text.replace('Quarrowby Family Medicine', 'Wrenmoor Community Hospital'); }, /does not match the denial/);
  const reply = appeal(a => a.statements.length > 1);
  broken(c => { const s = c.appeals[reply].statements[1]; s.text = s.text.replace(/(\w+) (\d{1,2}), (\d{4})/, (m, mo, d, y) => mo + ' ' + (Number(d) % 27 + 1) + ', ' + y); }, /reply .* does not answer/);
  broken(c => { c.appeals[reply].info_requests[0].text = 'Something else'; }, /information request "Something else"/);
  const pa = files.full.pas.findIndex(p => p.info_requests.length);
  broken(c => { c.pas[pa].info_requests[0].text = notes.PA_REQUESTS['svc-semaglutide-1'] === c.pas[pa].info_requests[0].text ? 'Notes' : notes.PA_REQUESTS['svc-semaglutide-1']; }, /information request/);
  const ex = files.full.pas.findIndex(p => p.expedite);
  broken(c => { const e = c.pas[ex].expedite; e.reason = e.reason.replace(/(\w+ \d{1,2}, \d{4})/, () => notes.spoken('2024-01-02')); }, /expedite reason/);
  const decided = files.full.pas.findIndex(p => p.decided_at);
  broken(c => { c.pas[decided].decided_at = c.pas[decided].decided_at.replace(/T\d{2}:/, 'T22:'); }, /outside the plan's business hours/);
  broken(c => { c.claims[0].received_at = '2025-12-25T10:00:00-05:00'; }, /outside business hours/);
  const moved = files.full.appeals.find(a => /was moved from/.test(a.statements[0].text));
  if (moved) broken(c => { const from = notes.parsed(notes.SHAPES.prior_auth_missing.exec(moved.statements[0].text)[2]), member = c.claims.find(x => x.claim_id === moved.target.id).member_id, x = c.pas.find(p => p.member_id === member && p.approved && p.approved.valid_from <= from && from <= p.approved.valid_until); x.units_used = x.approved.units; }, new RegExp(moved.appeal_id + ' statement'));
  const stepsBroken = structuredClone(steps), decision = stepsBroken.find(s => s.operation === 'pa.decided');
  decision.at = '2026-07-04T10:00:00-04:00';
  assert.ok(notes.problems(files.full, stepsBroken).some(p => p.startsWith(decision.id + ' pa.decided')));
});

test('Dataset a cut just after a due timer agrees with the App reads Core relays, in the seed, its notices and open_items', () => {
  assert.ok(expired, 'an accident question that expired with no step at its expiry');
  for (const t of [ms(expired.expires_at) + 1, ms(expired.expires_at)]) {
    const s = asOf(toIso(t), files), reads = project(s.data, s.virtual_now);
    assert.deepEqual(s.open_items.filter(o => o.item.startsWith('claim:') && !/^appealable/.test(o.status)).map(o => o.item + ' ' + o.status), reads.claims.filter(c => c.status !== 'processed').map(c => 'claim:' + c.claim_id + ' ' + c.status), 'open claims at ' + s.as_of + ' equal the reads');
    assert.equal(reads.info_requests.find(r => r.info_request_id === expired.info_request_id).status, 'expired', 'the App reads the expiry at ' + s.as_of);
    const stored = s.data.info_requests.find(r => r.info_request_id === expired.info_request_id);
    if (t > ms(expired.expires_at)) {
      assert.ok(s.timers_committed.some(x => x.kind === 'request_expiry' && x.id === expired.info_request_id && x.at === expired.expires_at));
      assert.deepEqual(stored, expired, 'the committed timer leaves the dataset record');
      assert.ok(s.data.notices.some(n => n.kind === 'notice.claim_denied' && n.subject.id === expired.claim_id && n.at === expired.expires_at));
    } else {
      assert.equal(stored.status, 'open', 'a timer due exactly at the instant is left to the reads, as Core shows it');
      assert.ok(!s.timers_committed.some(x => x.id === expired.info_request_id));
    }
  }
  const review = files.full.claims.find(c => !steps.some(s => ms(s.at) === ms(c.review_at)) && ms(c.review_at) > ms('2025-03-01T00:00:00-05:00'));
  const s = asOf(toIso(ms(review.review_at) + 1), files);
  assert.notEqual(s.data.claims.find(c => c.claim_id === review.claim_id).status, 'received', 'a review due before the instant is committed');
  assert.ok(s.timers_committed.some(x => x.kind === 'review' && x.id === review.claim_id));
});

test('Dataset at every cut the exported events alone and the exported account-holder script, replayed through the App, give the outcomes the selection states', () => {
  const cuts = [...steps.filter((s, i) => i % 9 === 0).map(after), ...CORE_CUTS, lib.REFERENCE];
  let open = 0, conditional = 0, actions = 0;
  for (const cut of cuts) {
    const s = asOf(cut, files);
    const events = replayInApp(s, s.events.map(event => ({ kind: 'event', event })));
    const script = replayInApp(s, s.account_holder_script);
    assert.ok([...events.statuses, ...script.statuses].every(x => x === 'committed'), cut + ': every exported step commits');
    assert.deepEqual(events.extra, [], cut + ': the events as given write nothing the dataset lacks');
    assert.deepEqual(script.extra, [], cut + ': the account-holder script writes nothing the dataset lacks');
    for (const o of s.open_items) {
      open++;
      assert.equal(events.outcome(o.item), o.after_staged_events, cut + ' ' + o.item + ' after the exported events');
      assert.equal(script.outcome(o.item), o.with_account_holder_actions, cut + ' ' + o.item + ' after the account-holder script');
      assert.equal(o.with_household_actions, o.in_dataset, cut + ' ' + o.item + ' with every household action');
      for (const a of o.actions) assert.equal(a.with_household_actions, 'committed', cut + ' ' + a.id);
    }
    conditional += s.conditional_events.length;
    actions += s.account_holder_script.filter(x => x.kind === 'action').length;
    const position = x => s.account_holder_script.findIndex(e => (e.kind === 'event' ? e.event.event_id : e.id) === x);
    for (const c of s.conditional_events) {
      assert.ok(c.after.length > 0 && c.needs.length > 0, cut + ': a conditional event names the actions it waits for and who takes them');
      if (c.in_account_holder_script) assert.ok(c.after.every(id => position(id) >= 0 && position(id) < position(c.event.event_id)), cut + ': a scripted conditional event comes after the actions it needs');
      else assert.ok(position(c.event.event_id) < 0 && c.after.some(id => position(id) < 0), cut + ': a conditional event outside the script waits for an action the script does not take');
    }
  }
  assert.ok(open > 30 && conditional > 0 && actions > 0, open + ' open items, ' + conditional + ' conditional events, ' + actions + ' account-holder actions');
});

test('Dataset a plan step that needs an account-holder filing is exported as a conditional event, and actions on appeals made by withheld filings are traced to their claim', () => {
  assert.ok(holderFilings.length > 0);
  let traced = 0;
  for (const filing of holderFilings) {
    const cut = after({ at: claimOf(filing.args.target_id).processed_at }), s = asOf(cut, files);
    const appeal = files.full.appeals.find(a => a.target.id === filing.args.target_id && a.filed_at === filing.at);
    const plan = steps.filter(x => (x.operation === 'appeal.decided' || x.operation === 'appeal.info_requested') && x.payload.appeal_id === appeal.appeal_id);
    for (const p of plan) {
      const exported = s.conditional_events.find(c => c.event.event_id === lib.eventId(p));
      assert.ok(exported && exported.after.includes(filing.id), cut + ': ' + p.operation + ' on ' + appeal.appeal_id + ' waits for ' + filing.id);
      assert.ok(!s.events.some(e => e.event_id === lib.eventId(p)), 'not an unconditional event');
    }
    const item = s.open_items.find(o => o.item === 'claim:' + filing.args.target_id);
    assert.ok(item && item.actions.some(a => a.id === filing.id), filing.id + ' is listed on its claim');
    assert.equal(item.with_household_actions, item.in_dataset);
  }
  for (const filing of steps.filter(x => x.tool === P + 'appeals.file.confirm' && x.args.target_type === 'claim')) {
    const s = asOf(after({ at: claimOf(filing.args.target_id).processed_at }), files), appeal = files.full.appeals.find(a => a.target.id === filing.args.target_id && a.filed_at === filing.at);
    const item = s.open_items.find(o => o.item === 'claim:' + filing.args.target_id);
    for (const later of steps.filter(x => x.by !== 'infra' && x.args.appeal_id === appeal.appeal_id)) { assert.ok(item.actions.some(a => a.id === later.id), later.id + ' on the withheld appeal ' + appeal.appeal_id + ' is traced to its claim'); traced++; }
  }
  assert.ok(traced > 0, 'a later action on an appeal the cut withholds');
});

test('Dataset actions that need another household member are labelled, and the account holder sees exactly the members and items the export names', () => {
  let others = 0;
  for (const cut of [...CORE_CUTS, ...steps.filter((s, i) => s.by === 'm-2' && i % 3 === 0).map(s => s.at)]) {
    const s = asOf(cut, files), t = ms(s.as_of);
    const f = fixture({ seed: s.data, now: s.virtual_now });
    assert.deepEqual(f.call(P + 'members.list', {}).members.filter(m => m.powers.length).map(m => m.member_id).sort(), s.account_holder.visible_members, cut);
    assert.deepEqual(s.account_holder.visible_open_items, s.open_items.filter(o => o.visible_to_account_holder).map(o => o.item));
    for (const o of s.open_items) {
      assert.equal(o.visible_to_account_holder, relation(s.data, lib.OWNER, o.member_id, t).view);
      for (const a of o.actions) {
        assert.equal(a.account_holder, a.by === lib.OWNER);
        if (a.by !== lib.OWNER) { others++; assert.equal(a.with_account_holder_actions, 'not taken: needs ' + a.by); assert.ok(!s.account_holder_script.some(x => x.id === a.id)); }
      }
    }
    for (const o of s.open_items.filter(x => !x.visible_to_account_holder && x.item.startsWith('claim:'))) assert.equal(f.callRaw(P + 'claims.get', { claim_id: o.item.slice(6) }).status, 'not_authorized', o.item);
  }
  assert.ok(others > 0);
});

test('Dataset the account-holder script replays in real Core over MCP with the outcomes and visible claims the selection states', async () => {
  const runtimeDir = path.resolve(process.env.PALE_RUNTIME_ROOT || path.join(lib.ROOT, '..', '..', 'runtime'));
  const { prepare } = require(path.join(runtimeDir, 'prepare.cjs'));
  const { Client } = require(path.join(runtimeDir, 'client.cjs'));
  const prepared = prepare(lib.ROOT), clients = [];
  const open = async role => { const c = new Client(prepared.app, role, 'dataset-script', path.join(prepared.root, 'state'), 'larkfield-dataset-script', { registry: prepared.registry }); clients.push(c); await c.initialize(); return c; };
  try {
    const infra = await open('infra'), agent = await open('agent');
    let v = (await infra.call('env.snapshot')).version, clock = null, n = 0;
    const step = async (client, name, args, expected) => { const out = await client.call(name, { ...args, expected_version: v }); if (out.version) v = out.version; assert.equal(out.status, expected, name + ' ' + (out.message || '')); return out; };
    const advance = async t => { if (ms(clock) < ms(t)) { await step(infra, 'env.advance_time', { virtual_now: t, request_id: 'adv-' + (++n) }, 'committed'); clock = t; } };
    const replyCut = after(filingOf(appealOfStep(replies[0]))), withdrawal = steps.find(x => x.tool === P + 'appeals.withdraw.confirm');
    const sample = ['2025-06-24', '2026-01-01', '2026-04-23T12:00:00-04:00', '2026-09-07'].map(lib.instant);
    const runs = [...[...sample, remapCut(), ...CORE_CUTS].map(cut => [cut, 'script']), ...[...sample, replyCut, withdrawal.at, ...CORE_CUTS].map(cut => [cut, 'events'])];
    const info = require('../dataset/as-of.cjs').createdBy(files), full = project(files.full, END_READ), totals = { script: 0, events: 0 };
    for (const [cut, mode] of runs) {
      const s = asOf(cut, files);
      await step(infra, 'env.load_seed', { request_id: 'load-' + (++n), data: s.data, virtual_now: s.virtual_now, bundle: s.bundle }, 'ready');
      clock = s.virtual_now;
      const visible = s.data.claims.filter(c => relation(s.data, lib.OWNER, c.member_id, ms(s.as_of)).view).map(c => c.claim_id).sort();
      assert.deepEqual((await agent.call(P + 'claims.list', {})).claims.map(x => x.claim_id).sort(), visible, cut + ' visible claims');
      const entries = mode === 'script' ? s.account_holder_script : s.events.map(event => ({ kind: 'event', event }));
      for (const e of entries) {
        if (e.kind === 'event') { await step(infra, 'env.apply_event', { event: e.event }, 'committed'); clock = e.event.at; continue; }
        await advance(e.at);
        const name = e.tool.slice(P.length);
        let args = e.args;
        if (lib.PREVIEW[name]) {
          const token = (await agent.call(P + lib.PREVIEW[name], e.args)).preview.token;
          await step(infra, 'env.apply_event', { event: { event_id: 'confirm-' + (++n), at: e.at, operation: 'user.confirmed', payload: { token, confirmed_by: e.by } } }, 'committed');
          args = { ...e.args, token };
        }
        await step(agent, e.tool, { ...args, request_id: 'act-' + (++n) }, 'committed');
      }
      await advance(END_READ);
      const end = project((await infra.call('env.snapshot')).snapshot.data, END_READ);
      for (const o of s.open_items) assert.equal(outcome(end, o.item), mode === 'script' ? o.with_account_holder_actions : o.after_staged_events, cut + ' ' + mode + ' ' + o.item + ' in Core');
      for (const o of s.open_items.filter(x => x.item.startsWith('appeal:'))) {
        const a = end.appeals.find(x => 'appeal:' + x.appeal_id === o.item), stated = mode === 'script' ? o.with_account_holder_actions : o.after_staged_events;
        assert.deepEqual([a.status, a.overdue], [stated.split(' ')[0], / \(decision overdue\)$/.test(stated)], cut + ' ' + mode + ' ' + o.item + ' status and overdue flag in Core');
      }
      const app = replayInApp(s, entries);
      const strip = x => { const { seed_id, approvals, issued, ...rest } = x; return rest; };
      assert.deepEqual(strip(end), strip(app.end), cut + ' ' + mode + ': Core ends exactly where the App does');
      const taken = new Set(mode === 'script' ? s.account_holder_script.filter(e => e.kind === 'action').map(e => e.id) : []);
      const missing = steps.slice(s.steps_applied).filter(x => x.by !== 'infra' && !taken.has(x.id)), touched = new Set(), years = new Set();
      for (const x of missing) { for (const k of info.targets.get(x.id)) if (k.startsWith('claim:')) touched.add(k.slice(6)); if (x.tool === P + 'coverage.cob.confirm') years.add(x.args.member_id + ':' + x.args.plan_year); }
      const waiting = new Set(s.conditional_events.filter(c => mode === 'events' || !c.in_account_holder_script).map(c => c.event.payload.claim_id).filter(Boolean));
      assert.deepEqual(end.claims.map(c => c.claim_id).sort(), full.claims.map(c => c.claim_id).filter(id => !waiting.has(id)).sort(), cut + ' ' + mode + ': Core holds every claim of full.json except those that wait for a withheld action');
      let compared = 0;
      for (const c of end.claims) {
        if (touched.has(c.claim_id) || c.lines.some(l => years.has(c.member_id + ':' + l.service_date.slice(0, 4)))) continue;
        compared++;
        assert.equal(outcome(end, 'claim:' + c.claim_id), outcome(full, 'claim:' + c.claim_id), cut + ' ' + mode + ' ' + c.claim_id + ' equals full.json');
      }
      if (mode === 'script') assert.ok(compared > 0, cut + ' ' + mode + ': claims compared with full.json');
      totals[mode] += compared;
      if (cut === replyCut && mode === 'events') assert.equal(end.appeals.find(x => x.appeal_id === appealOfStep(replies[0]).appeal_id).status, 'info_requested', 'Core leaves the appeal waiting for the reply');
      if (cut === withdrawal.at && mode === 'events') assert.notEqual(end.appeals.find(x => x.appeal_id === withdrawal.args.appeal_id).status, 'withdrawn');
    }
    assert.ok(totals.events > 0 && totals.script > 0, 'claims compared with full.json after the events alone and after the script: ' + JSON.stringify(totals));
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
  }
});

test('Dataset a missing or unparseable occurrence date is reported by ID and excluded, and the report text follows the numbers', () => {
  const changed = structuredClone(files);
  delete changed.full.claims[0].received_at;
  changed.full.notices[0].at = 'not a time';
  const c = compute(changed), clean = compute(files);
  assert.deepEqual([clean.invalid_dates, clean.invalid, clean.outside], [0, [], []]);
  assert.deepEqual(c.invalid.map(i => i.kind + ' ' + i.id).sort(), ['claim ' + files.full.claims[0].claim_id, 'notice ' + files.full.notices[0].notice_id].sort());
  assert.deepEqual([c.invalid_dates, c.totals.records, c.totals.counted], [2, clean.totals.records, clean.totals.counted - 2]);
  assert.match(c.counting, /2 invalid or missing and 0 outside the window/);
  assert.doesNotMatch(c.counting, /There are none/);
  assert.match(render({ ...c, loading: null }), /Invalid or missing occurrence dates: 2 \(/);
  const optional = structuredClone(files);
  const processed = optional.full.claims.find(x => x.status === 'processed');
  processed.processed_at = null;
  assert.ok(compute(optional).invalid.some(i => i.id === processed.claim_id + '/processed'), 'a processed claim must carry its processing time');
  const pending = structuredClone(files);
  pending.full.claims.find(x => x.status === 'processed').status = 'received';
  assert.equal(compute(pending).invalid.length, 0, 'an unprocessed claim needs none');
});

test('Dataset provenance is synthetic throughout, and hashes follow the bytes read, so one added newline or an edit changes them, the bundle and the report', () => {
  const c = compute(files);
  assert.deepEqual(c.sources.map(x => x.file + ' ' + x.kind), [lib.FILES.base + ' synthetic', lib.FILES.replay + ' synthetic', lib.FILES.full + ' synthetic']);
  for (const x of c.sources) assert.equal(x.sha256, lib.sha256(x.file));
  const read = lib.load(), base = read.bytes[lib.FILES.base];
  assert.equal(lib.digestOf(base), lib.sha256(lib.FILES.base));
  const changed = lib.load();
  Object.defineProperty(changed, 'bytes', { value: { ...read.bytes, [lib.FILES.base]: base + '\n' }, enumerable: false });
  const hash = lib.digestOf(base + '\n');
  assert.notEqual(hash, lib.sha256(lib.FILES.base));
  assert.match(asOf('2025-02-01', changed).bundle.dataset.transformations[0], new RegExp(hash));
  const sources = compute(changed).sources;
  assert.deepEqual([sources[0].sha256, sources[0].bytes], [hash, Buffer.byteLength(base) + 1]);
  assert.notDeepEqual(sources, JSON.parse(fs.readFileSync(lib.file(OUT.json), 'utf8')).sources, 'the committed report no longer matches, so coverage --check fails');
  const edited = lib.load();
  edited.base.providers[0].name = 'Quarrowby Family Medicine North';
  assert.notEqual(lib.digestOf(lib.bytesOf(edited)[lib.FILES.base]), lib.sha256(lib.FILES.base), 'an edited provider name is not hashed as the bytes read');
  assert.equal(lib.digestOf(lib.bytesOf(edited)[lib.FILES.base]), lib.digestOf(lib.pretty(edited.base)));
  assert.doesNotMatch(asOf('2025-02-01', edited).bundle.dataset.transformations[0], new RegExp(lib.sha256(lib.FILES.base)));
  const trimmed = lib.load();
  trimmed.full.notices.pop();
  const t = compute(trimmed);
  assert.equal(t.totals.records, compute(read).totals.records - 1);
  assert.notEqual(t.sources[2].sha256, lib.sha256(lib.FILES.full), 'a removed notice is not counted under the original hash');
  assert.equal(lib.digestOf(lib.bytesOf(lib.load())[lib.FILES.full]), lib.sha256(lib.FILES.full), 'unchanged content keeps the hash of the bytes read');
});

test('Dataset an impossible calendar date or time is refused in either input form', () => {
  for (const bad of ['2025-02-30', '2026-02-29', '2025-13-01', '2025-02-30T10:00:00-05:00', '2026-01-01T24:00:00-05:00', '2026-01-01T10:60:00-05:00', '2026-01-01T10:00:00+15:00', '2026-01-01T10:00']) assert.throws(() => asOf(bad, files), /Give the instant/, bad);
  assert.equal(asOf('2025-02-28', files).as_of, '2025-02-28T00:00:00-05:00');
  assert.throws(() => asOf('2024-12-31', files), /dataset window/);
  assert.throws(() => asOf('next week', files), /Give the instant/);
});

test('Dataset no replay step leaves the state as it was, and one that would is caught', () => {
  assert.deepEqual(lib.unchanged(files.base, steps), []);
  const decided = steps.find(s => s.operation === 'appeal.decided'), i = steps.indexOf(decided);
  const again = { ...decided, id: 's-again', at: toIso(ms(decided.at) + 60000) };
  assert.deepEqual(lib.unchanged(files.base, [...steps.slice(0, i + 1), again]), ['s-again (appeal.decided at ' + again.at + ')']);
  assert.match(fs.readFileSync(lib.file('dataset/generate.cjs'), 'utf8'), /if \(!lib\.changes\(data, step\)\) throw/);
});

test('Dataset providers, claim intake and the plan keep business days without federal holidays; the household acts at its own hours and before every deadline', () => {
  assert.deepEqual(notes.problems(files.full, steps), []);
  for (const s of steps.filter(x => ['claim.received', 'pa.submitted', 'pa.info_provided', 'pa.withdrawn'].includes(x.operation))) assert.ok(notes.officeHours(s.at), s.id);
  for (const s of steps.filter(x => ['pa.info_requested', 'pa.decided', 'pa.expedite_decided', 'appeal.info_requested', 'appeal.decided'].includes(x.operation))) assert.ok(notes.planHours(s.at), s.id);
  for (const c of files.full.claims) for (const l of c.lines) if (!l.emergency) assert.ok(notes.officeDay(l.service_date) || files.full.claims.some(x => x !== c && x.provider_id === c.provider_id && x.lines.some(y => y.emergency && y.service_date === l.service_date)), c.claim_id + ' ' + l.service_date);
  assert.ok(!notes.officeDay('2026-07-03') && !notes.officeDay('2025-11-27') && !notes.officeDay('2026-12-24') && notes.officeDay('2026-07-06'));
  for (const s of steps.filter(x => x.by !== 'infra')) { const clock = s.at.slice(11, 16); assert.ok(clock >= '09:30' && clock <= '22:32', s.id + ' at ' + s.at); }
  for (const r of files.full.info_requests.filter(x => x.status === 'answered')) assert.ok(ms(r.answered_at) < ms(r.expires_at) - 3600000, r.info_request_id);
  for (const a of files.full.appeals) { const w = files.full.windows.find(x => x.target.type === a.target.type && x.target.id === a.target.id); assert.ok(ms(a.filed_at) < ms(w.ends_at)); }
  for (const p of files.full.pas.filter(x => x.overdue)) assert.ok(ms(p.decided_at) > ms(p.due_at), p.pa_id + ' decided after its due time');
  const holiday = structuredClone(steps), received = holiday.find(s => s.operation === 'claim.received');
  received.at = '2025-07-04T10:00:00-04:00';
  assert.ok(notes.problems(files.full, holiday).some(p => p.startsWith(received.id + ' claim.received')));
});

test('Dataset rare outcomes come from per-person draws over many episodes, not from fixed positions, and each measure follows its one stated method', () => {
  const expiredClaims = [...new Set(files.full.info_requests.filter(r => r.status === 'expired').map(r => r.claim_id))];
  const accidentClaims = [...new Set(files.full.info_requests.filter(r => r.type === 'accident').map(r => r.claim_id))];
  assert.ok(expiredClaims.length >= 1 && expiredClaims.length * 2 < accidentClaims.length, expiredClaims.length + ' of ' + accidentClaims.length);
  assert.doesNotMatch(fs.readFileSync(lib.file('dataset/generate.cjs'), 'utf8'), /%\s*[\w.]+\s*===\s*0/, 'no outcome is assigned by a fixed counter');
  const sittings = new Map();
  for (const r of files.full.info_requests.filter(x => x.status === 'answered')) { const key = r.claim_id + ' ' + r.answered_at.slice(0, 13); if (!sittings.has(key)) sittings.set(key, Math.round((ms(r.answered_at) - ms(r.opened_at)) / 3600000)); }
  const lags = [...sittings.values()];
  assert.ok(lags.length >= 5 && new Set(lags).size > lags.length / 2, 'answer delays vary: ' + lags.join(', '));
  assert.ok(Object.keys(generate.ANSWER).length === 2 && generate.ANSWER['m-1'].accident !== generate.ANSWER['m-2'].accident, 'each adult has their own chances');
  const late = files.full.pas.filter(p => p.overdue).length, all = files.full.pas.filter(p => p.decided_at).length;
  assert.ok(late >= 1 && late * 4 <= all, late + ' overdue of ' + all + ' decided PAs');
  const m = compute(files).household.measures;
  assert.deepEqual(m, measures(files.full));
  const days = files.full.info_requests.filter(r => r.status === 'answered').map(r => (ms(r.answered_at) - ms(r.opened_at)) / 86400000).sort((a, b) => a - b);
  assert.deepEqual([m.answer_days.count, m.answer_days.min, m.answer_days.max], [days.length, +days[0].toFixed(1), +days.at(-1).toFixed(1)]);
  assert.equal(m.answer_days.expired, files.full.info_requests.filter(r => r.status === 'expired').length);
  const md = fs.readFileSync(lib.file(OUT.md), 'utf8');
  for (const method of Object.values(m.methods)) assert.equal(md.split(method).length - 1, 1, 'each method is stated once: ' + method.slice(0, 40));
  const reached = m.out_of_pocket.filter(x => x.out_of_pocket_max_reached);
  for (const x of reached) { const a = files.full.accumulators.find(y => y.member_id === x.member_id && y.plan_year === x.plan_year); assert.equal(a.oop_cents, files.full.plan.years[String(x.plan_year)].oop_max.individual_cents); }
});

test('Dataset published labels describe the records: README counts, the representative examples and the pinned proposal', () => {
  const readme = fs.readFileSync(lib.file('README.md'), 'utf8'), section = readme.slice(readme.indexOf('## Delivery dataset')), md = fs.readFileSync(lib.file(OUT.md), 'utf8');
  assert.ok(section.includes(steps.filter(s => s.by !== 'infra').length + ' tool calls') && section.includes(steps.filter(s => s.by === 'infra').length + ' Infra events'), 'README step counts');
  for (const [n, what] of [[files.full.claims.length, 'claims'], [files.full.eobs.length, 'EOBs'], [files.full.pas.length, 'prior authorizations'], [files.full.appeals.length, 'appeals'], [files.full.notices.length, 'notices'], [files.full.grants.length, 'grants']]) assert.ok(section.includes(n + ' ' + what), 'README names ' + n + ' ' + what);
  const reps = compute(files).representative, by = label => reps.find(r => r.example === label);
  assert.ok(by('work injury denied as another party\'s').eobs[0].includes('denied other_party_liable'));
  assert.ok(by('accident questions left to expire, appealed and overturned into EOB version 2').eobs.length === 2);
  assert.ok(/v1 .*denied out_of_network/.test(by('scheduled imaging out of network, denied and appealed').eobs[0]));
  for (const text of [section, md]) assert.ok(text.includes(PROPOSAL) && text.includes('PR #64'));
  assert.ok(!section.includes('](../../proposals/'));
});

test('Dataset a selection at the fixture clock shares the fixture household and catalog, loads, and continues every ID sequence', () => {
  const s = asOf(lib.REFERENCE, files);
  assert.deepEqual(generate.catalog(s.data), generate.catalog(lib.read('fixtures/minimal.json')));
  const f = fixture({ seed: s.data, now: s.virtual_now });
  const id = 'cl-' + (s.data.claims.length + 1);
  assert.equal(f.event({ event_id: 'new-claim', at: s.virtual_now, operation: 'claim.received', payload: { claim_id: id, member_id: 'm-3', provider_id: 'pv-2', lines: [{ line_id: 'ln-1', service_id: 'svc-xray', service_date: '2026-11-17', units: 1, billed_cents: 16300, emergency: false, possible_accident: true }] } }).status, 'committed');
  f.setNow('2026-11-22T00:00:00-05:00');
  const read = f.call(P + 'claims.get', { claim_id: id }).claim;
  assert.equal(read.status, 'pending_info', 'the review is read as due');
  assert.equal(read.info_requests[0].info_request_id, 'ir-' + (Number(s.data.issued.ir) + 1));
  const token = f.call(P + 'claims.info.preview', { claim_id: id, line_id: 'ln-1', answer: 'accident' }).preview.token;
  f.event({ event_id: 'confirm-new', at: '2026-11-22T00:00:00-05:00', operation: 'user.confirmed', payload: { token, confirmed_by: 'm-1' } });
  assert.equal(f.call(P + 'claims.info.confirm', { claim_id: id, line_id: 'ln-1', answer: 'accident', token }).status, 'committed');
  const data = f.data();
  const eobs = data.eobs.slice(s.data.eobs.length).map(e => e.eob_id);
  assert.ok(eobs.length >= 1 && data.eobs.some(e => e.claim_id === id && eobs.includes(e.eob_id)));
  assert.deepEqual(eobs, eobs.map((x, i) => 'eob-' + (Number(s.data.issued.eob) + 1 + i)), 'EOBs continue the series');
  const notices = data.notices.slice(s.data.notices.length).map(n => n.notice_id);
  assert.deepEqual(notices, notices.map((x, i) => 'n-' + (Number(s.data.issued.n) + 1 + i)), 'notices continue the series');
});

test('Dataset every replayed state is valid, the replay reproduces the committed files, and the window holds every kind of record and outcome', () => {
  lib.validate(files.base, lib.START);
  lib.validate(files.full, lib.END);
  const { data, applied } = lib.replay(files.base, steps, undefined, { check: true });
  assert.equal(applied, steps.length);
  assert.equal(lib.pretty(generate.selectEnd(data)), fs.readFileSync(lib.file(lib.FILES.full), 'utf8'));
  const end = asOf(lib.END, files);
  end.data.seed_id = lib.SEED_IDS.full;
  assert.equal(lib.pretty(end.data), fs.readFileSync(lib.file(lib.FILES.full), 'utf8'));
  assert.equal(lib.replayText(files.replay), fs.readFileSync(lib.file(lib.FILES.replay), 'utf8'));
  const iso = strings([files.base, files.replay, files.full]).filter(x => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(x));
  assert.ok(iso.every(x => x.slice(-6) === toIso(ms(x)).slice(-6)), 'every time written with the zone offset in force');
  assert.deepEqual(generate.variety(files.full, steps), []);
  const fewer = structuredClone(files.full);
  fewer.appeals = fewer.appeals.filter(a => !a.overdue);
  assert.ok(generate.variety(fewer, steps).includes('an overdue appeal'), 'a missing kind is caught');
  assert.ok(steps.every(s => s.by === 'infra' || ['m-1', 'm-2'].includes(s.by)), 'only the adults act');
  const memberOf = a => a.member_id || (a.claim_id && claimOf(a.claim_id).member_id) || (a.target_id && (a.target_type === 'claim' ? claimOf(a.target_id).member_id : files.full.pas.find(p => p.pa_id === a.target_id).member_id)) || (a.pa_id && files.full.pas.find(p => p.pa_id === a.pa_id).member_id) || (a.appeal_id && files.full.appeals.find(x => x.appeal_id === a.appeal_id).member_id);
  const replayed = structuredClone(files.base);
  for (const s of steps) { if (s.by !== 'infra') assert.ok(relation(replayed, s.by, memberOf(s.args), ms(s.at)).act, s.id + ' by ' + s.by + ' on ' + memberOf(s.args) + ' has authority'); lib.apply(replayed, s); }
  const { BRANDS, coded } = require('../dev/check-fixture.cjs');
  const all = strings([files.base, files.replay, files.full]);
  assert.deepEqual(all.filter(x => BRANDS.test(x)), [], 'no insurer, health-system, pharmacy or brand names');
  assert.deepEqual(all.filter(x => !/^\d{4}-\d{2}-\d{2}T/.test(x) && coded(x)), [], 'no billing or diagnosis codes');
});

test('Dataset the generator check passes on the committed files and catches a month without claims, a catalog that drifts from the fixture and a step out of order', () => {
  const live = lib.replay(files.base, steps).data, reference = lib.read('fixtures/minimal.json');
  assert.deepEqual(generate.check(files.base, files.replay, files.full, live, reference), []);
  const month = structuredClone(files.full);
  month.claims = month.claims.filter(c => !lib.dateOf(c.received_at).startsWith('2025-08'));
  assert.ok(generate.check(files.base, files.replay, month, live, reference).some(p => /a claim received in every month/.test(p) && /"2025-08":\[0/.test(p)));
  const drifted = structuredClone(reference);
  drifted.providers[0].name = 'Quarrowby Family Practice';
  assert.ok(generate.check(files.base, files.replay, files.full, live, drifted).some(p => /catalog equal the fixture/.test(p)));
  const swapped = structuredClone(files.replay), k = swapped.steps.findIndex((x, i) => i && x.at !== swapped.steps[i - 1].at);
  [swapped.steps[k - 1], swapped.steps[k]] = [swapped.steps[k], swapped.steps[k - 1]];
  assert.ok(generate.check(files.base, swapped, files.full, live, reference).some(p => /steps are in time order/.test(p)));
});

test('Dataset the committed coverage report matches a fresh computation, its hashes and its MCP read-back', () => {
  const committed = JSON.parse(fs.readFileSync(lib.file(OUT.json), 'utf8'));
  const { loading, ...counted } = committed;
  assert.deepEqual(counted, compute(files));
  for (const source of committed.sources) assert.equal(source.sha256, lib.sha256(source.file), source.file);
  for (const m of committed.method) assert.equal(m.sha256, lib.sha256(m.file), m.file);
  assert.equal(render(committed), fs.readFileSync(lib.file(OUT.md), 'utf8'));
  assert.deepEqual(loading.instants.map(x => x.as_of), instantsOf(files));
  assert.ok(loading.instants.some(x => x.timers_committed > 0), 'a loaded cut commits a due timer');
  for (const x of loading.instants) {
    const fresh = asOf(x.as_of, files);
    assert.deepEqual([x.seed_id, x.load.loaded_objects, x.claims_in_selection, x.steps_applied, x.timers_committed], [fresh.data.seed_id, plugin.objects(fresh.data).length, fresh.data.claims.length, fresh.steps_applied, fresh.timers_committed.length], x.as_of + ' matches a fresh selection');
    assert.deepEqual([x.load.status, x.load.automated_checks, x.agent_clock, x.listed_ids_match_grants, x.states_match_app_reads, x.monthly_read_back_matches_selection, x.open_items_match_core], ['ready', 'pass', x.as_of, true, true, true, true], x.as_of);
    assert.deepEqual(x.open_items, fresh.open_items.map(o => o.item + ' ' + o.status));
    assert.ok(!x.latest_received_at || ms(x.latest_received_at) < ms(x.as_of));
  }
  const whole = loading.instants.at(-1).monthly_read_back;
  for (const m of committed.monthly) for (const key of Object.keys(whole[m.month])) assert.equal(whole[m.month][key], m[key], m.month + ' ' + key);
  const declared = lib.read('contribution/dataset.json').sources.find(s => s.source_id === 'delivery-dataset');
  assert.deepEqual([declared.kind, declared.generation.tool, declared.generation.seed, declared.generation.tool_version], ['synthetic', 'dataset/generate.cjs', String(generate.SEED), generate.VERSION]);
  assert.deepEqual([declared.generation.parameters.from, declared.generation.parameters.to, declared.generation.parameters.time_zone], [lib.FIRST, lib.LAST, lib.ZONE]);
  assert.ok(declared.description.includes(PROPOSAL.split('/blob/')[1].slice(0, 40)) && declared.description.includes('PR #64'));
  assert.ok(!lib.read('contribution/dataset.json').record_source_ids.includes('delivery-dataset'), 'the fixture bundle cites only the fixture sources');
});

const replies = steps.filter(s => s.tool === P + 'appeals.add_statement');
const appealOfStep = s => files.full.appeals.find(a => a.appeal_id === s.args.appeal_id);
const filingOf = a => steps.find(s => s.tool === P + 'appeals.file.confirm' && s.at === a.filed_at);

test('Dataset an exported event never runs ahead of a withheld household action it waits for: a decision made after a reply waits for that reply', () => {
  assert.ok(replies.length > 0);
  for (const reply of replies) {
    const a = appealOfStep(reply), filing = filingOf(a), s = asOf(after(filing), files);
    const decision = steps.find(x => x.operation === 'appeal.decided' && ms(x.at) > ms(reply.at) && x.payload.appeal_id === a.appeal_id);
    if (!decision) continue;
    const id = lib.eventId(decision);
    assert.ok(!s.events.some(e => e.event_id === id), a.appeal_id + ': the decision after ' + reply.id + ' is not an unconditional event');
    const listed = s.conditional_events.find(c => c.event.event_id === id);
    assert.ok(listed && listed.after.includes(reply.id), a.appeal_id + ': the decision is exported as waiting for ' + reply.id);
    const run = replayInApp(s, s.events.map(event => ({ kind: 'event', event })));
    assert.equal(run.outcome('appeal:' + a.appeal_id), s.open_items.find(o => o.item === 'appeal:' + a.appeal_id).after_staged_events);
    assert.doesNotMatch(run.outcome('appeal:' + a.appeal_id), /upheld|overturned/, 'the plan does not decide before the reply it asked for');
  }
});

test('Dataset every open item has an outcome, an appeal\'s includes its status and overdue flag, and an appeal withdrawn later is not complete after the events alone', () => {
  for (const cut of [...steps.filter((x, i) => i % 15 === 0).map(after), ...steps.filter(x => x.tool === P + 'appeals.withdraw.confirm').map(x => x.at)]) {
    const s = asOf(cut, files);
    for (const o of s.open_items) for (const key of ['after_staged_events', 'with_account_holder_actions', 'with_household_actions', 'in_dataset']) assert.doesNotMatch(o[key], /^unknown/, cut + ' ' + o.item + ' ' + key);
  }
  const withdrawal = steps.find(x => x.tool === P + 'appeals.withdraw.confirm'), s = asOf(withdrawal.at, files);
  const item = s.open_items.find(o => o.item === 'appeal:' + withdrawal.args.appeal_id);
  assert.equal(item.in_dataset, 'withdrawn');
  assert.equal(item.completed_by_staged_events, false);
  assert.match(item.after_staged_events, /^(under_review|info_requested)/);
  const run = replayInApp(s, s.events.map(event => ({ kind: 'event', event })));
  assert.equal(run.outcome(item.item), item.after_staged_events);
});

test('Dataset no member has two visits billed at one provider on one day, nor two office visits on one day, and a duplicate is caught', () => {
  assert.deepEqual(lib.collisions(files.full, steps), []);
  const copy = structuredClone(files.full), c = copy.claims.find(x => x.lines.some(l => l.service_id === 'svc-office-visit'));
  copy.claims.push({ ...structuredClone(c), claim_id: 'cl-dup' });
  assert.ok(lib.collisions(copy, steps).some(p => p.includes('cl-dup')));
});

test('Dataset an attestation that answers requests on several open claims is listed on each of them and taken once', () => {
  let shared = 0;
  for (const x of steps.filter(y => y.tool === P + 'coverage.cob.confirm')) {
    const s = asOf(x.at, files), v = project(s.data, s.as_of);
    const claims = [...new Set(v.info_requests.filter(r => r.type === 'other_coverage' && r.status === 'open' && r.plan_year === x.args.plan_year && v.claims.find(c => c.claim_id === r.claim_id).member_id === x.args.member_id).map(r => 'claim:' + r.claim_id))];
    for (const key of claims) assert.ok(s.open_items.find(o => o.item === key).actions.some(a => a.id === x.id), x.id + ' is listed on ' + key);
    assert.ok(s.account_holder_script.filter(e => e.id === x.id).length <= 1, x.id + ' is taken once');
    if (claims.length > 1) shared++;
  }
  assert.ok(shared > 0, 'an attestation that answers more than one open claim');
});


test('Dataset the PA decision measure counts every first decision the plan made, including those an appeal later replaced', () => {
  const m = measures(files.full).pa_decision_days, decided = steps.filter(x => x.operation === 'pa.decided');
  assert.equal(m.count, decided.length);
  const firsts = decided.map(x => (ms(x.at) - ms(files.full.pas.find(p => p.pa_id === x.payload.pa_id).submitted_at)) / 86400000).sort((a, b) => a - b);
  assert.deepEqual([m.min, m.max], [+firsts[0].toFixed(1), +firsts.at(-1).toFixed(1)]);
});

test('Dataset no generated text promises a document the records do not hold', () => {
  const texts = [...files.full.appeals.flatMap(a => a.statements.map(s => s.text)), ...files.full.pas.flatMap(p => p.expedite ? [p.expedite.reason] : [])];
  assert.deepEqual(texts.filter(t => /attach|enclos/i.test(t)), []);
});

test('Dataset the README states the billing delay of original submissions and the corrected claim apart, and gap texts count distinct service dates', () => {
  const readme = fs.readFileSync(lib.file('README.md'), 'utf8'), section = readme.slice(readme.indexOf('## Delivery dataset'));
  const business = (from, to) => { let n = 0; for (let d = from; d < to; d = lib.addDays(d, 1)) if (notes.officeDay(lib.addDays(d, 1))) n++; return n; };
  const links = lib.corrections(files.full, steps), corrected = files.full.claims.filter(c => links.has(c.claim_id));
  const lags = files.full.claims.filter(c => !corrected.includes(c)).map(c => business(c.lines.map(l => l.service_date).sort().at(-1), lib.dateOf(c.received_at)));
  assert.ok(section.includes('billed ' + Math.min(...lags) + ' to ' + Math.max(...lags) + ' business days after its last service'), 'README states ' + Math.min(...lags) + ' to ' + Math.max(...lags));
  assert.ok(corrected.length >= 1);
  for (const c of corrected) {
    const original = files.full.claims.find(o => links.get(c.claim_id) === o.claim_id), appeal = files.full.appeals.find(a => a.target.id === original.claim_id);
    assert.ok(section.includes('corrected claim for Riley\'s summer-trip emergency arrives ' + business(lib.dateOf(appeal.filed_at), lib.dateOf(c.received_at)) + ' business days after the appeal it answers'), c.claim_id);
  }
  for (const g of compute(files).gaps.filter(x => x.kind === 'days_without_records')) {
    const inside = new Set(files.full.claims.flatMap(c => c.lines.map(l => l.service_date)).filter(d => d >= g.from && d <= g.to));
    if (inside.size) assert.ok(g.reason.includes(inside.size + ' service date' + (inside.size === 1 ? '' : 's') + ' inside it'), g.from + ': ' + g.reason);
  }
});

const SAMPLE_CUTS = ['2025-06-24', '2026-01-01', '2026-04-23T12:00:00-04:00', '2026-09-07'].map(lib.instant);
const dataOf = x => { const { seed_id, approvals, issued, ...rest } = x; return rest; };

test('Dataset the out-of-pocket and deductible labels name the claim whose posting reaches the limit', () => {
  const reps = compute(files).representative;
  const oop = reps.filter(r => /out-of-pocket maximum/.test(r.example)), surgery = reps.find(r => /^surgery/.test(r.example));
  assert.ok(oop.length === 1 && surgery);
  const reached = files.full.eobs.flatMap(e => e.postings.map(p => ({ e, p }))).find(({ e, p }) => { const max = files.full.plan.years[String(p.plan_year)].oop_max.individual_cents, before = e.ledger_before[String(p.plan_year)].member.oop_cents; return before < max && before + p.oop_cents >= max; });
  assert.ok(reached, 'some posting reaches an out-of-pocket maximum');
  assert.equal(oop[0].claim_id, reached.e.claim_id, 'the label names the claim whose posting reaches the maximum');
  const s = files.full.eobs.find(e => e.claim_id === surgery.claim_id && e.version === 1), p = s.postings[0], year = files.full.plan.years[String(p.plan_year)];
  assert.ok(s.ledger_before[String(p.plan_year)].member.oop_cents + p.oop_cents < year.oop_max.individual_cents, 'the surgery does not reach the maximum');
  assert.equal(/meeting the deductible/.test(surgery.example), s.ledger_before[String(p.plan_year)].member.deductible_cents < year.deductible.individual_cents && s.ledger_before[String(p.plan_year)].member.deductible_cents + p.deductible_cents >= year.deductible.individual_cents);
  const readme = fs.readFileSync(lib.file('README.md'), 'utf8');
  assert.doesNotMatch(readme, /surgery reaching/);
});

test('Dataset at sampled cuts no staged event depends on a withheld household action, the events write no first EOB outcome the dataset lacks unless an unanswered question explains it, and every household action replays full.json exactly', () => {
  const info = require('../dataset/as-of.cjs').createdBy(files);
  for (const cut of [...SAMPLE_CUTS, ...steps.filter(x => x.tool === P + 'appeals.file.confirm' && x.args.target_type === 'pa').map(x => x.at)]) {
    const s = asOf(cut, files), withheld = new Set(steps.slice(s.steps_applied).filter(x => x.by !== 'infra').map(x => x.id));
    for (const e of s.events) { const id = e.event_id.slice(lib.RUN.length + 1); assert.deepEqual([...info.waits.get(id)].filter(x => withheld.has(x)), [], cut + ': ' + id + ' waits for nothing withheld'); }
    const run = replayInApp(s, s.events.map(event => ({ kind: 'event', event })));
    assert.deepEqual(run.extra, [], cut + ': no extra writes');
    const f = fixture({ seed: s.data, now: s.virtual_now });
    for (const e of s.events) f.event(e);
    const end = project(f.data(), END_READ);
    for (const c of end.claims.filter(x => ms(x.received_at) >= ms(s.as_of))) {
      const mine = end.eobs.find(e => e.claim_id === c.claim_id && e.version === 1), theirs = files.full.eobs.find(e => e.claim_id === c.claim_id && e.version === 1);
      if (!mine || !theirs) continue;
      const statuses = e => e.lines.map(l => l.line_id + ' ' + (l.reason || l.status)).join(', ');
      if (statuses(mine) === statuses(theirs)) continue;
      const answered = files.full.info_requests.some(r => r.claim_id === c.claim_id && r.status === 'answered' && ms(r.answered_at) >= ms(s.as_of)) || c.lines.some(l => files.full.coverage.some(x => x.member_id === c.member_id && x.plan_year === Number(l.service_date.slice(0, 4)) && x.attested_at && ms(x.attested_at) >= ms(s.as_of)));
      assert.ok(answered && mine.lines.every((l, i) => l.reason === theirs.lines[i].reason || l.reason === 'missing_information'), cut + ' ' + c.claim_id + ': ' + statuses(mine) + ' against ' + statuses(theirs) + ' is explained only by questions the household answers later');
    }
  }
  for (const cut of SAMPLE_CUTS) {
    const s = asOf(cut, files), data = structuredClone(s.data);
    for (const x of steps.slice(s.steps_applied)) lib.apply(data, x);
    const end = generate.selectEnd(data);
    assert.deepEqual(JSON.parse(JSON.stringify(dataOf(end))), dataOf(files.full), cut + ': the withheld steps replay to full.json');
    const owner = asOf(cut, files).withheld_actions.filter(a => a.account_holder);
    assert.deepEqual(owner.map(a => a.id), steps.slice(s.steps_applied).filter(x => x.by === lib.OWNER).map(x => x.id), cut + ': every withheld account-holder action is listed');
    const scripted = new Set(s.account_holder_script.filter(e => e.kind === 'action').map(e => e.id));
    for (const a of owner) assert.equal(scripted.has(a.id), a.with_account_holder_actions === 'committed', cut + ' ' + a.id + ' is in the script exactly when it commits');
  }
  const s = asOf('2026-01-01', files), names = s.account_holder_script.filter(e => e.kind === 'action').map(e => e.id);
  assert.ok(names.length >= 5, '2026-01-01: the script takes the account holder\'s withheld actions: ' + names.join(', '));
});

test('Dataset every claim appeal statement names each appealed line, and an appeal that supplies the missing answer is overturned', () => {
  for (const a of files.full.appeals.filter(x => x.target.type === 'claim')) {
    const c = files.full.claims.find(x => x.claim_id === a.target.id), denied = files.full.eobs.find(e => e.claim_id === c.claim_id && e.version === 1).lines.filter(l => l.status === 'denied');
    assert.deepEqual(a.lines, denied.map(l => l.line_id), a.appeal_id + ' appeals every denied line');
    if (/therapy session/.test(a.statements[0].text)) continue;
    for (const l of denied) { const line = c.lines.find(x => x.line_id === l.line_id); assert.ok(a.statements[0].text.includes(notes.lowerFirst(files.full.services.find(x => x.service_id === line.service_id).description) + ' on ' + notes.spoken(line.service_date)), a.appeal_id + ' names ' + l.line_id); }
    if (denied[0].reason === 'missing_information') assert.equal(a.status === 'withdrawn' || OPEN.includes(a.status) ? 'overturned' : a.status, 'overturned', a.appeal_id + ' supplies the missing answer and is overturned');
  }
  const two = files.full.appeals.find(a => a.lines && a.lines.length > 1);
  assert.ok(two, 'an appeal of two lines');
  const copy = structuredClone(files.full), x = copy.appeals.find(a => a.appeal_id === two.appeal_id);
  x.statements[0].text = x.statements[0].text.replace(/ and the [^;:.]+ on \w+ \d+, \d{4}/, '');
  assert.ok(notes.problems(copy).some(p => p.startsWith(two.appeal_id + ' statement')), 'a statement naming only one of two lines is caught');
});
const OPEN = ['under_review', 'info_requested'];

test('Dataset office visits are at least four days apart for each member, routine and scripted alike, and a back-to-back pair is caught', () => {
  assert.deepEqual(lib.collisions(files.full, steps), []);
  const copy = structuredClone(files.full), c = copy.claims.find(x => x.lines.length === 1 && x.lines[0].service_id === 'svc-office-visit' && !x.lines[0].possible_accident);
  const twin = { ...structuredClone(c), claim_id: 'cl-next' };
  twin.lines[0].service_date = lib.addDays(c.lines[0].service_date, 1);
  copy.claims.push(twin);
  assert.ok(lib.collisions(copy, steps).some(p => p.includes('cl-next') && /less than 4 days apart/.test(p)));
});

test('Dataset report wording: counts take the singular for one, a gap at the window edge says so, the authorizations never used are stated as a gap, the fixture checker allows exactly the three declared sources, and the method hashes cover the App code that writes the records', () => {
  const md = fs.readFileSync(lib.file(OUT.md), 'utf8');
  assert.doesNotMatch(md, /undefined|NaN|arrived on none|(?<![\d.])\b1 [a-z ]*(?:requests|dates|days|expirys|overdues|decisions|withdrawals|appeals|claims)\b|expirys|overdues/);
  assert.doesNotMatch(JSON.stringify(compute(files)), /(?<![\d.])\b1 days\b/);
  const unused = compute(files).gaps.filter(g => g.kind === 'unused_authorizations'), idle = files.full.pas.filter(p => p.approved && p.units_used === 0 && !files.full.claims.some(c => c.lines.some(l => l.service_id === p.service_id)));
  assert.deepEqual(unused.flatMap(g => g.pa_ids).sort(), idle.map(p => p.pa_id).sort(), 'the gaps name every approved authorization that is never used');
  assert.ok(idle.length > 0 && idle.every(p => p.service_id === 'svc-semaglutide-1') && md.includes('Authorizations never used'), 'the semaglutide authorizations are stated as never used');
  const { check, load } = require('../dev/check-fixture.cjs'), { seed, options } = load();
  assert.deepEqual(check(seed, options), []);
  const extra = { ...options, dataset: { ...options.dataset, sources: [...options.dataset.sources, { ...options.dataset.sources[0], source_id: 'something-else' }] } };
  assert.ok(check(seed, extra).some(p => /lists the authored and generated-history sources/.test(p)), 'an undeclared extra source is refused');
  const method = compute(files).method.map(m => m.file);
  for (const f of ['plugin.cjs', ...fs.readdirSync(lib.file('src')).map(x => 'src/' + x)]) assert.ok(method.includes(f), f + ' is hashed');
});

const idOf = e => e.event_id.slice(lib.RUN.length + 1);
function exportProblems(s) {
  const info = require('../dataset/as-of.cjs').createdBy(files), later = steps.slice(s.steps_applied), withheld = new Set(later.filter(x => x.by !== 'infra').map(x => x.id)), problems = [];
  const staged = s.events.map(idOf), conditional = s.conditional_events.map(c => idOf(c.event)), unstaged = s.unstaged_events.map(u => idOf(u.event)), all = [...staged, ...conditional, ...unstaged];
  if (JSON.stringify([...all].sort()) !== JSON.stringify(later.filter(x => x.by === 'infra').map(x => x.id).sort())) problems.push('the staged, conditional and unstaged events are not exactly the withheld Infra steps');
  if (new Set(all).size !== all.length) problems.push('an event is listed twice');
  const waiting = id => [...info.waits.get(id)].filter(x => withheld.has(x));
  for (const e of s.events) { if (JSON.stringify(e) !== JSON.stringify(lib.envelope(info.by.get(idOf(e))))) problems.push('staged ' + idOf(e) + ' differs from its replay step'); if (waiting(idOf(e)).length) problems.push('staged ' + idOf(e) + ' waits for a withheld action'); }
  for (const c of s.conditional_events) {
    const id = idOf(c.event), w = waiting(id);
    if (JSON.stringify(c.event) !== JSON.stringify(lib.envelope(info.by.get(id)))) problems.push('conditional ' + id + ' differs from its replay step');
    if (w.length && JSON.stringify(c.after) !== JSON.stringify(w)) problems.push('conditional ' + id + ' names the wrong actions');
    if (JSON.stringify(c.needs) !== JSON.stringify([...new Set(c.after.map(x => info.by.get(x).by))].sort())) problems.push('conditional ' + id + ' names the wrong people');
    const scripted = s.account_holder_script.find(x => x.kind === 'event' && idOf(x.event) === id);
    if (c.in_account_holder_script !== Boolean(scripted) || JSON.stringify(c.account_holder_event) !== JSON.stringify(scripted ? scripted.event : null)) problems.push('conditional ' + id + ' does not match the script');
  }
  for (const u of s.unstaged_events) { if (waiting(idOf(u.event)).length || !u.reason) problems.push('unstaged ' + idOf(u.event) + ' waits for a withheld action or gives no reason'); if (!info.by.has(idOf(u.event)) || JSON.stringify(u.event) !== JSON.stringify(lib.envelope(info.by.get(idOf(u.event))))) problems.push('unstaged ' + idOf(u.event) + ' differs from its replay step'); }
  for (const x of s.account_holder_script.filter(e => e.kind === 'event')) if (!staged.includes(idOf(x.event)) && !s.conditional_events.some(c => idOf(c.event) === idOf(x.event) && c.in_account_holder_script)) problems.push('script event ' + idOf(x.event) + ' is neither staged nor conditional');
  return problems;
}
const remapCut = () => steps.filter((x, i) => i % 4 === 0).map(after).find(cut => asOf(cut, files).conditional_events.some(c => c.account_holder_event && JSON.stringify(c.account_holder_event) !== JSON.stringify(c.event)));

test('Dataset every withheld Infra step is exported exactly once, as staged, conditional or unstaged, with the payload of its branch, and removing or altering any one is caught', () => {
  const cut = remapCut();
  assert.ok(cut, 'a cut where the script renames an ID in a conditional event');
  const cuts = [...SAMPLE_CUTS, '2025-03-01', cut, ...steps.filter((x, i) => i % 11 === 0).map(after)];
  for (const c of cuts) assert.deepEqual(exportProblems(asOf(c, files)), [], c);
  const s = asOf(cut, files), renamed = s.conditional_events.find(c => c.account_holder_event && JSON.stringify(c.account_holder_event) !== JSON.stringify(c.event));
  const run = replayInApp(s, s.account_holder_script);
  assert.ok(run.statuses.every(x => x === 'committed'), 'the script with its renamed IDs commits');
  const broken = change => { const copy = structuredClone(s); change(copy); return exportProblems(copy); };
  assert.ok(broken(x => x.events.splice(0, 1)).length > 0, 'a removed staged event is caught');
  assert.ok(broken(x => x.conditional_events.splice(x.conditional_events.indexOf(x.conditional_events.find(c => idOf(c.event) === idOf(renamed.event))), 1)).length > 0, 'a removed conditional event is caught');
  assert.ok(broken(x => { x.events[0].at = toIso(ms(x.events[0].at) + 60000); }).length > 0, 'an altered staged event is caught');
  assert.ok(broken(x => { x.conditional_events.find(c => idOf(c.event) === idOf(renamed.event)).account_holder_event = structuredClone(renamed.event); }).length > 0, 'a conditional event with the other branch\'s payload is caught');
  assert.ok(broken(x => { x.conditional_events[0].after = []; }).length > 0, 'a conditional event without its actions is caught');
});

const SEQUENCE = new Set(['received_seq', 'posting_seq', 'filed_seq', 'approved_after_post']);
function recordsOf(data) {
  const name = new Map(), groups = new Map(), raw = new Map();
  for (const r of data.info_requests) name.set(r.info_request_id, 'request ' + r.claim_id + ' ' + r.line_id + ' ' + r.type);
  for (const e of data.eobs) name.set(e.eob_id, 'eob ' + e.claim_id + ' v' + e.version);
  for (const a of data.appeals) name.set(a.appeal_id, 'appeal ' + a.target.type + ' ' + a.target.id + ' ' + a.filed_at);
  for (const g of data.grants) name.set(g.grant_id, 'grant ' + g.member_id + ' ' + g.grantee_id + ' ' + g.created_at);
  const plain = v => (typeof v === 'string' ? name.get(v) || v.replace(/\b(?:ir|eob|ap|gr)-\d+\b/g, m => name.get(m) || m) : Array.isArray(v) ? v.map(plain) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).filter(k => !SEQUENCE.has(k) && k !== 'notice_id').sort().map(k => [k, plain(v[k])])) : v);
  const add = (id, record) => { if (!groups.has(id)) groups.set(id, []); groups.get(id).push(JSON.stringify(plain(record))); raw.set(id, record); };
  const ownerOf = n => (n.subject.type === 'info_request' ? data.info_requests.find(r => r.info_request_id === n.subject.id).claim_id : n.subject.type === 'appeal' ? data.appeals.find(a => a.appeal_id === n.subject.id).target.id : n.subject.id);
  for (const c of data.claims) add('claim ' + c.claim_id, c);
  for (const r of data.info_requests) add(name.get(r.info_request_id), r);
  for (const e of data.eobs) add(name.get(e.eob_id), e);
  for (const c of data.coverage) add('coverage ' + c.member_id + ' ' + c.plan_year, c);
  for (const a of data.accumulators) add('accumulator ' + a.member_id + ' ' + a.plan_year, a);
  for (const x of data.pas) add('pa ' + x.pa_id, x);
  for (const a of data.appeals) add(name.get(a.appeal_id), a);
  for (const w of data.windows) add('window ' + w.target.type + ' ' + w.target.id, w);
  for (const g of data.grants) add(name.get(g.grant_id), g);
  for (const n of data.notices) add('notice ' + n.kind + ' ' + ownerOf(n) + ' ' + n.recipient_id + ' ' + n.at, n);
  return Object.assign(groups, { raw });
}
function nameOf(record) {
  const [kind, ...rest] = record.replace(/~closing$/, '').split(':'), id = rest.join(':').replace(/#\d+$/, '');
  if (kind === 'request') return 'request ' + id.replace(/#\d+$/, '').split(':').join(' ');
  if (kind === 'eob') return 'eob ' + id.split(':').join(' ');
  if (kind === 'appeal') return 'appeal ' + id.split('@')[0].split(':').join(' ') + ' ' + id.split('@')[1];
  if (kind === 'grant') { const [pair, at] = id.split('@'); return 'grant ' + pair.split('>').join(' ') + ' ' + at; }
  if (kind === 'notice') { const [what, subject, whom] = id.split('|'), owner = subject.startsWith('appeal:') ? subject.split(':')[2].split('@')[0] : subject.split(':')[1]; return 'notice notice.' + what + ' ' + owner + ' ' + whom.replace('@', ' '); }
  return kind + ' ' + id.split(':').join(' ');
}
function differingRecords(end, full) {
  const a = recordsOf(end), b = recordsOf(full), out = new Set();
  for (const id of new Set([...a.keys(), ...b.keys()])) if (JSON.stringify((a.get(id) || []).sort()) !== JSON.stringify((b.get(id) || []).sort())) out.add(id);
  return out;
}
function changesOf(start, apply) {
  const last = new Map();
  let prev = recordsOf(start);
  const mark = (data, at) => { const cur = recordsOf(data); for (const id of new Set([...prev.keys(), ...cur.keys()])) if (JSON.stringify((prev.get(id) || []).slice().sort()) !== JSON.stringify((cur.get(id) || []).slice().sort())) last.set(id, ms(at)); prev = cur; };
  apply(mark);
  return last;
}
let datasetChanges = null;
const changedInDataset = () => datasetChanges || (datasetChanges = changesOf(files.base, mark => {
  const d = structuredClone(files.base);
  for (const x of steps) { const fired = applyDueTimers(d, x.at); if (fired.length) mark(d, fired[fired.length - 1].at); lib.apply(d, x); mark(d, x.at); }
  const fired = applyDueTimers(d, END_READ);
  if (fired.length) mark(d, fired[fired.length - 1].at);
}));
const changedInBranch = (s, entries) => changesOf(project(s.data, s.virtual_now), mark => { const run = replayInApp(s, entries, (data, at) => mark(project(data, at), at)); mark(run.end, lib.END); });
const BORN = { claim: 'received_at', request: 'opened_at', eob: 'issued_at', pa: 'submitted_at', appeal: 'filed_at', window: 'notice_at', grant: 'created_at', notice: 'at' };
const stepAt = new Map(steps.map(x => [x.id, ms(x.at)]));
function compareWithDataset(end, listed, withheld, label, branch = null) {
  const full = project(files.full, END_READ), differ = differingRecords(end, full), records = new Set(listed.map(x => x.record)), mine = recordsOf(end).raw, theirs = recordsOf(full).raw;
  assert.equal(records.size, listed.length, label + ': each record is listed once');
  assert.deepEqual([...new Set(listed.map(x => nameOf(x.record)))].sort(), [...differ].sort(), label + ': the listed records are exactly those that differ from full.json');
  const born = r => { const f = BORN[r.split(':')[0]], xs = [mine.get(nameOf(r)), theirs.get(nameOf(r))].filter(Boolean); return f ? Math.min(...xs.map(x => ms(x[f]))) : -Infinity; };
  let inBranch = null;
  for (const x of listed) {
    assert.ok(x.reason !== 'unexplained' && x.because.length > 0, label + ' ' + x.record + ' is explained');
    assert.deepEqual(x.because.filter(id => !withheld.has(id)), [], label + ' ' + x.record + ' is explained by steps the branch does not take');
    assert.deepEqual(x.via.filter(r => !records.has(r)), [], label + ' ' + x.record + ' is traced through listed records only');
    if (/^(eob|notice):/.test(x.record) || (x.record.startsWith('window:') && !x.record.endsWith('~closing'))) {
      const r = theirs.get(nameOf(x.record)) || mine.get(nameOf(x.record)), issued = x.record.startsWith('window:') ? r.notice_at : r.issued_at || r.at;
      assert.equal(x.issued_at, issued, label + ' ' + x.record + ' states its issuance in the dataset, or in the branch for a record only the branch writes');
      assert.deepEqual(x.because.filter(id => stepAt.get(id) > ms(issued)), [], label + ' ' + x.record + ' cites only steps before its issuance');
      assert.deepEqual(x.via.filter(v => born(v) > ms(issued)), [], label + ' ' + x.record + ' is traced only through records that existed when it was issued');
    } else if (branch) {
      const last = changedInDataset().get(nameOf(x.record));
      for (const id of x.because.filter(id => last === undefined || stepAt.get(id) > last)) {
        inBranch = inBranch || changedInBranch(...branch);
        assert.ok(stepAt.get(id) <= (inBranch.get(nameOf(x.record)) ?? -Infinity), label + ' ' + x.record + ' cites ' + id + ', which precedes a change of the record in the dataset or in the branch');
      }
    }
    if (!x.record.startsWith('notice:')) continue;
    const n = mine.get(nameOf(x.record)) || theirs.get(nameOf(x.record)), at = ms(n.at), member = n.member_id;
    for (const g of x.via.filter(r => r.startsWith('grant:'))) {
      const [pair, created] = g.slice(6).split('@'), versions = [...end.grants, ...full.grants].filter(y => y.member_id + '>' + y.grantee_id === pair && y.created_at === created);
      assert.ok(versions.some(y => y.member_id === member && y.grantee_id === n.recipient_id && ms(y.created_at) <= at && (y.expires_at === null || at < ms(y.expires_at)) && (!y.revoked_at || at < ms(y.revoked_at))), label + ' ' + x.record + ' is traced to ' + g + ', the recipient\'s access to the member when the notice was issued');
    }
  }
  return differ;
}
const withheldBy = (s, entries) => { const done = new Set(entries.map(e => (e.kind === 'event' ? idOf(e.event) : e.id))); return new Set(steps.filter(x => ms(x.at) >= ms(s.as_of) && !done.has(x.id)).map(x => x.id)); };

test('Dataset after the events alone and after the script every record of every kind equals full.json unless the selection lists it with the withheld steps that explain it', () => {
  const kinds = new Set();
  let traced = 0, ledger = 0;
  for (const cut of [...SAMPLE_CUTS, '2025-01-01', '2025-03-01', ...steps.filter((x, i) => i % 13 === 0).map(after)]) {
    const s = asOf(cut, files), staged = s.events.map(event => ({ kind: 'event', event }));
    for (const [entries, listed, label] of [[staged, s.differences_from_dataset.after_staged_events, cut + ' events'], [s.account_holder_script, s.differences_from_dataset.with_account_holder_actions, cut + ' script']]) {
      for (const id of compareWithDataset(replayInApp(s, entries).end, listed, withheldBy(s, entries), label, [s, entries])) kinds.add(id.split(' ')[0]);
      traced += listed.filter(x => x.record.startsWith('notice:') && x.via.some(r => r.startsWith('grant:'))).length;
      ledger += listed.filter(x => x.record.startsWith('eob:') && x.via.some(r => r.startsWith('eob:') && r.split(':')[1] !== x.record.split(':')[1])).length;
    }
  }
  assert.deepEqual([...kinds].sort(), ['accumulator', 'appeal', 'claim', 'coverage', 'eob', 'grant', 'notice', 'pa', 'request', 'window'], 'differences of every kind of record are compared');
  assert.ok(traced > 0, 'some notice difference is traced to the grant in force when it was issued');
  assert.ok(ledger > 0, 'some EOB difference is traced to the earlier EOBs whose postings move its deductible or out-of-pocket snapshot');
});

test('Dataset a notice or EOB is traced only to steps before its issuance: the July 4 denial of cl-17 cites no appeal step taken after it', () => {
  const s = asOf('2025-01-01', files), list = s.differences_from_dataset.after_staged_events;
  const filed = files.full.appeals.find(a => a.target.id === 'cl-17').appeal_id;
  const appeal = steps.filter(x => x.by !== 'infra' && ((x.args || {}).target_id === 'cl-17' || (x.args || {}).appeal_id === filed)).map(x => x.id);
  assert.ok(appeal.length >= 2, 'the household files and adds to an appeal on cl-17');
  const denial = list.filter(x => /^notice:(claim_denied|eob_available)\|claim:cl-17\|.*@2025-07-04/.test(x.record));
  assert.ok(denial.length >= 2, 'the July 4 denial notices of cl-17 are listed');
  for (const x of denial) {
    assert.equal(x.issued_at, '2025-07-04T23:59:00-04:00');
    assert.deepEqual(x.because.filter(id => appeal.includes(id) || stepAt.get(id) > ms(x.issued_at)), [], x.record + ' cites no appeal step and nothing after its issuance');
  }
  const eob = list.find(x => x.record === 'eob:cl-17:v1');
  assert.deepEqual(eob.because.filter(id => appeal.includes(id)), [], 'the first EOB of cl-17 cites no appeal step');
});

test('Dataset an appeal window\'s opening and closing are listed apart, each traced in time order: at the expedite request on pa-8 the opening cites no filing made after it', () => {
  const expedite = steps.find(x => x.tool === P + 'pa.request_expedite' && x.args.pa_id === 'pa-8'), filing = steps.find(x => x.tool === P + 'appeals.file.confirm' && x.args.target_id === 'pa-8');
  const window = files.full.windows.find(w => w.target.id === 'pa-8');
  assert.ok(expedite && filing && ms(filing.at) > ms(window.notice_at), 'the household files on pa-8 after its window opens');
  for (const cut of [expedite.at, toIso(ms(expedite.at) + 1)]) {
    const s = asOf(cut, files), list = s.differences_from_dataset.after_staged_events;
    const opening = list.find(x => x.record === 'window:pa:pa-8'), closing = list.find(x => x.record === 'window:pa:pa-8~closing');
    if (opening) {
      assert.equal(opening.issued_at, window.notice_at, cut + ': the opening states when the window opened');
      assert.deepEqual(opening.because.filter(id => stepAt.get(id) > ms(window.notice_at)), [], cut + ': the opening cites nothing after it');
    }
    assert.ok(closing && closing.because.includes(filing.id), cut + ': the closing cites the filing that closes it');
  }
  assert.ok(asOf(expedite.at, files).differences_from_dataset.after_staged_events.some(x => x.record === 'window:pa:pa-8'), 'without the expedite request the window opens otherwise');
  assert.ok(!asOf(toIso(ms(expedite.at) + 1), files).differences_from_dataset.after_staged_events.some(x => x.record === 'window:pa:pa-8'), 'after it the staged events open the window as the dataset does');
});

test('Dataset an appeal filed, withdrawn and filed again at one instant is traced through its own name: the export before it lists both appeals', () => {
  const log = structuredClone(files.replay), k = log.steps.findIndex(x => x.tool === P + 'appeals.file.confirm' && x.args.target_id === 'cl-90'), first = log.steps[k];
  const filed = files.full.appeals.find(a => a.target.id === 'cl-90').appeal_id, again = 'ap-' + (Number(filed.slice(3)) + 1);
  for (const x of log.steps.slice(k + 1)) for (const o of [x.args, x.payload]) if (o && o.appeal_id === filed) o.appeal_id = again;
  log.steps.splice(k + 1, 0, { id: 's-w1', at: first.at, by: first.by, tool: P + 'appeals.withdraw.confirm', args: { appeal_id: filed } }, { id: 's-w2', at: first.at, by: first.by, tool: first.tool, args: structuredClone(first.args) });
  const full = generate.selectEnd(lib.replay(files.base, log.steps).data), mutated = { ...files, replay: log, full };
  assert.deepEqual(full.appeals.filter(a => a.target.id === 'cl-90').map(a => a.status), ['withdrawn', 'overturned']);
  const s = asOf('2026-11-01', mutated), end = replayInApp(s, s.events.map(event => ({ kind: 'event', event }))).end;
  const listed = s.differences_from_dataset.after_staged_events.filter(x => x.record.startsWith('appeal:claim:cl-90@'));
  assert.deepEqual(listed.map(x => [x.record.replace(/^.*@[^#]*/, ''), x.change]), [['', 'missing'], ['#1', 'missing']], 'both appeals are listed under their own names');
  assert.ok(listed.every(x => x.because.includes(first.id)), 'each cites the first filing');
  const names = new Set(s.differences_from_dataset.after_staged_events.map(x => nameOf(x.record)));
  assert.deepEqual([...differingRecords(end, full)].filter(x => !names.has(x)), [], 'every differing record is listed');
});

test('Dataset identical records that share a name are matched before pairing: a revoked act grant beside an updated view grant from one instant is listed once, as missing', () => {
  const T = '2026-07-01T12:00:00-04:00', log = structuredClone(files.replay), k = log.steps.findIndex(x => ms(x.at) > ms(T));
  const grant = { id: 's-g1', at: T, by: 'm-2', tool: P + 'grants.change.confirm', args: { action: 'grant', member_id: 'm-2', grantee_id: 'm-1', scope: 'act', expires_at: '2026-12-01T00:00:00-05:00' } };
  const issued = lib.replay(files.base, [...log.steps.slice(0, k), grant]).data.grants.at(-1), view = { grant_id: 'gr-9', member_id: 'm-2', grantor_id: 'm-2', grantee_id: 'm-1', scope: 'view', status: 'active' };
  log.steps.splice(k, 0, grant, { id: 's-g2', at: T, by: 'infra', operation: 'grant.changed', payload: { grant_id: issued.grant_id, status: 'revoked' }, after: ['s-g1'] }, { id: 's-g3', at: T, by: 'infra', operation: 'grant.changed', payload: { ...view, expires_at: null } }, { id: 's-g4', at: T, by: 'infra', operation: 'grant.changed', payload: { ...view, expires_at: '2026-10-01T00:00:00-04:00' } });
  const full = generate.selectEnd(lib.replay(files.base, log.steps).data), s = asOf('2026-06-01', { ...files, replay: log, full });
  assert.deepEqual(full.grants.filter(g => g.created_at === T).map(g => g.scope + ' ' + g.status).sort(), ['act revoked', 'view active']);
  const listed = s.differences_from_dataset.after_staged_events.filter(x => x.record.startsWith('grant:m-2>m-1@' + T));
  assert.deepEqual(listed.map(x => [x.change, x.because]), [['missing', ['s-g1']]], 'only the act grant is listed, as missing');
});

test('Dataset two grants that share a member, grantee and start are both compared: a household grant with a dependent revocation and an Infra regrant at one instant are listed', () => {
  const T = '2026-07-01T12:00:00-04:00', log = structuredClone(files.replay), k = log.steps.findIndex(x => ms(x.at) > ms(T));
  const grant = { id: 's-g1', at: T, by: 'm-2', tool: P + 'grants.change.confirm', args: { action: 'grant', member_id: 'm-2', grantee_id: 'm-1', scope: 'view', expires_at: '2026-12-01T00:00:00-05:00' } };
  const issued = lib.replay(files.base, [...log.steps.slice(0, k), grant]).data.grants.at(-1);
  log.steps.splice(k, 0, grant, { id: 's-g2', at: T, by: 'infra', operation: 'grant.changed', payload: { grant_id: issued.grant_id, status: 'revoked' }, after: ['s-g1'] }, { id: 's-g3', at: T, by: 'infra', operation: 'grant.changed', payload: { grant_id: 'gr-9', member_id: 'm-2', grantor_id: 'm-2', grantee_id: 'm-1', scope: 'view', expires_at: null, status: 'active' } });
  const full = generate.selectEnd(lib.replay(files.base, log.steps).data), mutated = { ...files, replay: log, full };
  assert.equal(full.grants.filter(g => g.created_at === T).length, 2, 'the dataset holds both grants');
  const s = asOf('2026-06-01', mutated), end = replayInApp(s, s.events.map(event => ({ kind: 'event', event }))).end;
  assert.equal(end.grants.filter(g => g.created_at === T).length, 1, 'the staged events write only the regrant');
  assert.ok(differingRecords(end, full).has('grant m-2 m-1 ' + T), 'the grants differ');
  const listed = s.differences_from_dataset.after_staged_events.filter(x => x.record.startsWith('grant:m-2>m-1@' + T));
  assert.equal(listed.length, 1, 'the missing grant is listed');
  assert.deepEqual([listed[0].change, listed[0].because], ['missing', ['s-g1']]);
});

test('Dataset at the window start the other-coverage notices cite the skipped attestation, the therapy authorization cites the claims that use its units, and a changed member cost on a notice is listed', () => {
  const s = asOf('2025-01-01', files), script = s.differences_from_dataset.with_account_holder_actions, staged = s.differences_from_dataset.after_staged_events;
  const attest = steps.find(x => x.tool === P + 'coverage.cob.confirm' && x.args.member_id === 'm-1' && x.args.plan_year === 2025), grants = steps.filter(x => x.operation === 'grant.changed' || x.tool === P + 'grants.change.confirm').map(x => x.id);
  const asked = script.filter(x => /^notice:info_requested\|request:cl-21:/.test(x.record));
  assert.ok(asked.length >= 2 && asked.every(x => x.change === 'extra'), 'the script branch adds the other-coverage notices of cl-21');
  for (const x of script.filter(x => x.record.includes('cl-21') && !x.record.startsWith('eob:'))) {
    assert.deepEqual(x.because, [attest.id], x.record + ' cites the skipped attestation');
    assert.ok(!x.because.some(id => grants.includes(id)), x.record + ' cites no grant change');
  }
  const users = files.full.eobs.filter(e => e.lines.some(l => l.pa_id === 'pa-4')).map(e => 'eob:' + e.claim_id + ':v' + e.version);
  assert.ok(users.length > 0);
  for (const list of [staged, script]) {
    const pa = list.find(x => x.record === 'pa:pa-4');
    assert.ok(pa && pa.fields.includes('units_used'), 'pa-4 is listed with its used units');
    assert.ok(users.every(e => pa.via.includes(e)), 'pa-4 is traced to the claims that use its units');
    assert.deepEqual(pa.because.filter(id => !list.find(x => users.includes(x.record)).because.includes(id)), [], 'pa-4 cites the steps that change those claims');
  }
  const noon = asOf('2026-04-23T12:00:00-04:00', files), cost = noon.differences_from_dataset.after_staged_events.find(x => /^notice:eob_available\|claim:cl-69\|/.test(x.record));
  assert.ok(cost && cost.change === 'changed' && cost.fields.includes('fields') && cost.via.includes('eob:cl-69:v1'), 'the cl-69 notice with another member cost is listed');
  const full = project(files.full, END_READ), mine = replayInApp(noon, noon.events.map(event => ({ kind: 'event', event }))).end;
  const costOf = d => d.notices.filter(n => n.kind === 'notice.eob_available' && n.subject.id === 'cl-69').map(n => n.fields.member_cost_cents);
  assert.notDeepEqual(costOf(mine), costOf(full));
});

test('Dataset the summary counts each differing record once, by kind', () => {
  const { execFileSync } = require('node:child_process');
  const brief = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, '..', 'dataset', 'as-of.cjs'), '--at', '2025-01-01', '--summary'], { encoding: 'utf8' }));
  const s = asOf('2025-01-01', files);
  const count = list => list.reduce((m, x) => { const k = x.record.split(':')[0]; m[k] = (m[k] || 0) + 1; return m; }, {});
  assert.deepEqual(brief.differing_after_staged_events, count(s.differences_from_dataset.after_staged_events));
  assert.deepEqual(brief.differing_with_account_holder_actions, count(s.differences_from_dataset.with_account_holder_actions));
  assert.equal(brief.differing_after_staged_events.claim, new Set(s.differences_from_dataset.after_staged_events.filter(x => x.record.startsWith('claim:')).map(x => x.record)).size);
});

test('Dataset a corrected claim names the claim it corrects, and a delayed duplicate or a false link is caught', () => {
  const links = lib.corrections(files.full, steps);
  assert.equal(links.size, 1);
  assert.deepEqual(links.problems, []);
  const fixed = steps.find(x => x.corrects);
  assert.ok(fixed && files.full.appeals.some(a => a.target.id === fixed.corrects && ms(a.filed_at) < ms(fixed.at)));
  const copy = structuredClone(files.full), c = copy.claims.find(x => x.lines.every(l => l.service_id === 'svc-office-visit' && !l.possible_accident) && x.lines.length === 1);
  const again = { ...structuredClone(c), claim_id: 'cl-again', received_at: toIso(ms(c.received_at) + 86400000) };
  copy.claims.push(again);
  assert.ok(lib.collisions(copy, steps).some(p => p.includes('cl-again')), 'a bill sent again a day later without a link is a collision');
  const falseLink = steps.map(x => (x === fixed ? { ...x, corrects: c.claim_id } : x));
  assert.ok(lib.collisions(files.full, falseLink).some(p => /names .* as the claim it corrects/.test(p)), 'a link to a claim with other services or no appeal is refused');
});

test('Dataset either branch of the expedited surgery appeal generates every required kind of record', () => {
  for (const surgery of ['overturned', 'upheld']) {
    const out = generate.build({ surgery });
    assert.ok(out.stats.claims > 80, surgery);
  }
});

test('Dataset a selection alone stages the whole household branch: its events and every withheld action with its arguments replay to full.json, and the account-holder arguments are the script\'s', () => {
  const number = id => Number(id.slice(2));
  for (const cut of [...SAMPLE_CUTS, remapCut()]) {
    const s = asOf(cut, files);
    const scripted = new Map(s.account_holder_script.filter(e => e.kind === 'action').map(e => [e.id, e.args]));
    for (const a of s.withheld_actions) {
      assert.ok(a.args && typeof a.args === 'object', cut + ' ' + a.id + ' carries its arguments');
      if (scripted.has(a.id)) assert.deepEqual(a.account_holder_args, scripted.get(a.id), cut + ' ' + a.id + ' gives the script\'s arguments');
    }
    const entries = [...s.events, ...s.conditional_events.map(c => c.event), ...s.unstaged_events.map(u => u.event)].map(e => ({ id: idOf(e), at: e.at, by: 'infra', operation: e.operation, payload: e.payload }));
    for (const a of s.withheld_actions) entries.push({ id: a.id, at: a.at, by: a.by, tool: a.tool, args: a.args });
    entries.sort((x, y) => number(x.id) - number(y.id));
    const data = structuredClone(s.data);
    for (const x of entries) lib.apply(data, x);
    assert.deepEqual(JSON.parse(JSON.stringify(dataOf(generate.selectEnd(data)))), dataOf(files.full), cut + ': the selection alone replays to full.json');
  }
});

test('Dataset in the upheld branch of the expedited surgery appeal Casey continues therapy before the surgeon asks again', () => {
  const out = generate.build({ surgery: 'upheld' }), full = JSON.parse(out[lib.FILES.full]);
  const appeal = full.appeals.find(a => a.expedited && a.target.type === 'pa');
  assert.equal(appeal.status, 'upheld');
  const again = full.pas.filter(p => p.service_id === 'svc-arthroscopy' && ms(p.submitted_at) > ms(appeal.decided_at));
  const therapy = full.pas.filter(p => p.member_id === 'm-2' && p.service_id === 'svc-physical-therapy' && ms(p.submitted_at) > ms(appeal.decided_at) && again.length && ms(p.submitted_at) < ms(again[0].submitted_at));
  assert.ok(again.length === 1 && therapy.length >= 1, 'a therapy authorization between the uphold and the new surgery request');
  const sessions = full.claims.filter(c => c.member_id === 'm-2' && c.provider_id === 'pv-3').flatMap(c => c.lines.map(l => l.service_date)).filter(d => d >= therapy[0].approved.valid_from && d <= again[0].submitted_at.slice(0, 10));
  assert.ok(sessions.length >= 4, 'sessions are billed in that course: ' + sessions.join(', '));
});

test('Dataset skipped actions carry no account-holder arguments, ledger causes post other amounts, a second correction of one claim is refused, draws do not follow generated IDs, the next business opening follows the candidate time, and an unstaged envelope must match its step', () => {
  for (const cut of ['2025-03-01', ...SAMPLE_CUTS]) {
    const s = asOf(cut, files), scripted = new Set(s.account_holder_script.filter(e => e.kind === 'action').map(e => e.id));
    for (const a of s.withheld_actions) assert.equal(a.account_holder_args === null, !scripted.has(a.id), cut + ' ' + a.id + ' has account-holder arguments exactly when the script takes it');
  }
  const fixed = steps.find(x => x.corrects), copy = structuredClone(files.full), twin = { ...structuredClone(files.full.claims.find(c => c.claim_id === fixed.payload.claim_id)), claim_id: 'cl-twice', received_at: toIso(ms(fixed.at) + 9 * 86400000) };
  copy.claims.push(twin);
  const linked = [...steps, { id: 's-twice', at: twin.received_at, by: 'infra', operation: 'claim.received', payload: { claim_id: 'cl-twice' }, corrects: fixed.corrects }];
  assert.ok(lib.collisions(copy, linked).some(p => /cl-twice names .* already corrected/.test(p)), 'a second correction of one original is refused');
  const withdrawals = ['overturned', 'upheld'].map(surgery => JSON.parse(generate.build({ surgery })[lib.FILES.replay]).steps.filter(x => x.tool === P + 'appeals.withdraw.confirm').map(x => x.at));
  assert.deepEqual(withdrawals[0], withdrawals[1], 'the withdrawal of the corrected claim\'s appeal does not move with the surgery branch');
  const rand = generate.random(7), at = (d, h) => require('../src/time.cjs').fromLocal(d, h);
  for (const [from, opens] of [[at('2026-04-23', '22:30'), '2026-04-24'], [at('2026-04-24', '16:40'), '2026-04-27'], [at('2026-04-25', '10:00'), '2026-04-27'], [at('2026-07-02', '16:50'), '2026-07-06'], [at('2026-04-23', '07:00'), '2026-04-23']]) {
    for (let k = 0; k < 40; k++) {
      const w = generate.promptly(rand, from);
      assert.ok(w > from && notes.planHours(toIso(w)), toIso(from) + ' gives ' + toIso(w));
      assert.ok(lib.dateOf(toIso(w)) <= opens || lib.dateOf(toIso(w)) === lib.dateOf(toIso(from + 150 * 60000)), toIso(from) + ' opens by ' + opens + ', not ' + toIso(w));
    }
  }
  const s = asOf('2026-12-15', files), moved = structuredClone(s), e = moved.events.pop();
  moved.unstaged_events.push({ reason: 'moved', event: { ...e, payload: { ...e.payload, claim_id: e.payload.claim_id ? e.payload.claim_id + 'x' : 'cl-x' } } });
  assert.ok(exportProblems(moved).some(p => /unstaged .* differs from its replay step/.test(p)), 'a moved and corrupted unstaged event is caught');
});

test('Dataset every representative label holds for the record it names, and a label on the wrong record is caught', () => {
  const F = files.full, svc = id => F.services.find(s => s.service_id === id), prov = c => F.providers.find(p => p.provider_id === c.provider_id);
  const v = (c, n) => F.eobs.find(e => e.claim_id === c.claim_id && e.version === n), latest = c => F.eobs.filter(e => e.claim_id === c.claim_id).sort((a, b) => b.version - a.version)[0];
  const req = (c, test) => F.info_requests.some(r => r.claim_id === c.claim_id && test(r)), appeals = c => F.appeals.filter(a => a.target.type === 'claim' && a.target.id === c.claim_id);
  const line = (c, l) => c.lines.find(x => x.line_id === l.line_id);
  const reaches = (c, kind, name, year) => F.eobs.filter(e => e.claim_id === c.claim_id).some(e => e.postings.some(p => { const y = F.plan.years[String(p.plan_year)], cap = kind === 'oop' ? y.oop_max.individual_cents : y.deductible.individual_cents, before = e.ledger_before[String(p.plan_year)].member[kind === 'oop' ? 'oop_cents' : 'deductible_cents']; return (!year || p.plan_year === year) && before < cap && before + p[kind === 'oop' ? 'oop_cents' : 'deductible_cents'] >= cap; })) && (!name || F.members.find(m => m.member_id === c.member_id).name === name);
  const rules = [
    [/^first claim of the window$/, c => c === F.claims[0]],
    [/^last claim of the window$/, c => c === F.claims.at(-1)],
    [/^first claim after the reference clock$/, c => c === F.claims.find(o => ms(o.received_at) >= ms(lib.REFERENCE))],
    [/^accident questions left to expire, appealed and overturned into EOB version 2$/, c => req(c, r => r.type === 'accident' && r.status === 'expired') && v(c, 2) && appeals(c).some(a => a.status === 'overturned')],
    [/^work injury denied as another party's$/, c => req(c, r => r.answer === 'work_related') && v(c, 1).lines.every(l => l.reason === 'other_party_liable')],
    [/^scheduled imaging out of network, denied and appealed$/, c => prov(c).kind === 'imaging' && !prov(c).in_network && v(c, 1).lines.every(l => l.reason === 'out_of_network') && appeals(c).length > 0],
    [/^emergency billed without the emergency flag, appeal withdrawn after the corrected claim$/, c => c.lines.every(l => !l.emergency && l.service_id === 'svc-er-visit') && appeals(c).some(a => a.status === 'withdrawn') && lib.corrections(F, steps).get([...lib.corrections(F, steps).keys()][0]) === c.claim_id],
    [/^therapy session after the authorization ended, appealed$/, c => v(c, 1).lines.some(l => l.reason === 'prior_auth_missing' && line(c, l).service_id === 'svc-physical-therapy') && appeals(c).length > 0],
    [/^surgery( meeting the deductible)?$/, (c, m) => c.lines.some(l => l.service_id === 'svc-arthroscopy') && Boolean(m[1]) === reaches(c, 'deductible')],
    [/^physical therapy session reaching (\w+ \w+)'s out-of-pocket maximum for (\d{4})$/, (c, m) => reaches(c, 'oop', m[1], Number(m[2])) && c.lines.some(l => l.service_id === 'svc-physical-therapy')],
    [/^one claim posting to two plan years$/, c => new Set(c.lines.map(l => l.service_date.slice(0, 4))).size === 2],
    [/^emergency at an out-of-network hospital, paid at in-network cost sharing$/, c => prov(c).kind === 'hospital' && !prov(c).in_network && c.lines.every(l => l.emergency) && v(c, 1).lines.every(l => l.status === 'paid')],
    [/^other coverage answered as secondary$/, c => req(c, r => r.answer === 'other_secondary')],
    [/^accident questions answered as not an accident$/, c => req(c, r => r.answer === 'not_accident')],
    [/^routine office visit paid with a copay$/, c => c.lines.length === 1 && c.lines[0].service_id === 'svc-office-visit' && v(c, 1).lines[0].status === 'paid' && v(c, 1).lines[0].copay_cents > 0],
    [/^nurse phone consultation priced below the copay$/, c => v(c, 1).lines.some(l => line(c, l).service_id === 'svc-phone-consult' && l.copay_cents === l.allowed_cents && l.allowed_cents < F.plan.years[line(c, l).service_date.slice(0, 4)].copays.office)],
    [/^lab work toward the deductible$/, c => v(c, 1).lines.some(l => svc(line(c, l).service_id).category === 'lab' && l.deductible_cents > 0)],
    [/^coinsurance after the deductible was met$/, c => latest(c).lines.some(l => l.coinsurance_cents > 0 && l.deductible_cents === 0)],
    [/^other-coverage questions answered on the first claim of a year$/, c => req(c, r => r.type === 'other_coverage' && r.answer === 'none')],
    [/^accident questions answered as an accident$/, c => req(c, r => r.answer === 'accident')],
    [/^received and not yet reviewed at the window end$/, c => c.status === 'received'],
    [/^waiting for answers at the window end$/, c => c.status === 'pending_info'],
  ];
  const check = reps => reps.map(r => { const rule = rules.find(([re]) => re.test(r.example)); return rule && rule[1](F.claims.find(c => c.claim_id === r.claim_id), r.example.match(rule[0])) ? null : r.example + ' on ' + r.claim_id; }).filter(Boolean);
  const reps = compute(files).representative;
  assert.deepEqual(check(reps), []);
  const xray = F.claims.find(c => c.lines.some(l => l.service_id === 'svc-xray') && !c.lines.some(l => svc(l.service_id).category === 'lab'));
  assert.deepEqual(check([{ example: 'lab work toward the deductible', claim_id: xray.claim_id }]), ['lab work toward the deductible on ' + xray.claim_id], 'an X-ray labelled as lab work is caught');
});

test('Dataset injuries are spaced and episodic, primary care is capped per month, at most one therapy session follows an authorization, and each rule catches a violation', () => {
  assert.deepEqual([lib.injuryProblems(files.full, steps), lib.visitLoad(files.full), lib.afterEnd(files.full, steps), lib.visitProblems(files.full, steps, generate.VISITS)], [[], [], [], []]);
  const story = steps.find(x => x.episode === 'riley-knee'), c = files.full.claims.find(x => x.claim_id === story.payload.claim_id);
  const copy = structuredClone(files.full), extra = { ...structuredClone(c), claim_id: 'cl-fall' };
  extra.lines.forEach(l => { l.service_date = lib.addDays(c.lines[0].service_date, -3); });
  copy.claims.push(extra);
  const marked = [...steps, { id: 's-fall', at: c.received_at, by: 'infra', operation: 'claim.received', payload: { claim_id: 'cl-fall' }, episode: 'injury:m-3:' + extra.lines[0].service_date }];
  assert.ok(lib.injuryProblems(copy, marked).some(p => /two injuries within 14 days/.test(p)), 'a routine injury three days before a story injury is caught');
  assert.ok(lib.injuryProblems(copy, steps).some(p => /cl-fall bills an injury without naming its episode/.test(p)));
  const month = Object.entries(files.full.claims.filter(x => x.lines.some(l => l.service_id === 'svc-office-visit' && !l.possible_accident)).reduce((m, x) => { const k = x.member_id + ' ' + x.lines[0].service_date.slice(0, 7); m[k] = [...(m[k] || []), x]; return m; }, {})).find(([, list]) => list.length === 2);
  assert.ok(month, 'a month with two office visits');
  const busy = structuredClone(files.full), third = { ...structuredClone(month[1][0]), claim_id: 'cl-third' };
  busy.claims.push(third);
  assert.ok(lib.visitLoad(busy).some(p => /has 3 office visits/.test(p)), 'a third office visit in a month is caught');
  const pa = files.full.pas.find(p => p.approved && p.service_id === 'svc-physical-therapy'), late = structuredClone(files.full), owner = late.claims.find(x => x.member_id === pa.member_id && x.lines.some(l => l.service_id === pa.service_id));
  const course = steps.find(x => x.payload && x.payload.claim_id === owner.claim_id).course, tagged = [...steps];
  for (const k of [1, 2]) { late.claims.push({ ...structuredClone(owner), claim_id: 'cl-late-' + k, lines: [{ ...structuredClone(owner.lines.find(l => l.service_id === pa.service_id)), service_date: lib.addDays(pa.approved.valid_until, k * 3) }] }); tagged.push({ id: 's-late-' + k, at: owner.received_at, by: 'infra', operation: 'claim.received', payload: { claim_id: 'cl-late-' + k }, visit: 'therapy', course }); }
  assert.ok(lib.afterEnd(late, tagged).some(p => p.startsWith('the course ' + pa.member_id + ' ' + course + ' has 2 sessions outside')), 'two more sessions after an authorization ends are caught');
  assert.equal(generate.CAPS.sick_per_month, 1);
});

test('Dataset the generator check reads the visit kind, episode and course from the replay and catches a second sick visit in a month, routine injuries 20 days apart across a quarter and a second session after an authorization ends', () => {
  const reference = lib.read('fixtures/minimal.json');
  const line = (service_id, service_date, billed_cents, flags = {}) => ({ service_id, service_date, units: 1, billed_cents, emergency: false, possible_accident: false, ...flags });
  const bill = (n, at, member, provider, lines, meta) => ({ id: 's-90' + n, at, by: 'infra', operation: 'claim.received', payload: { claim_id: 'cl-90' + n, member_id: member, provider_id: provider, lines: lines.map((l, i) => ({ line_id: 'ln-' + (i + 1), ...l })) }, ...meta });
  const checked = extra => {
    const log = structuredClone(files.replay);
    for (const x of extra) { const i = log.steps.findIndex(y => ms(y.at) > ms(x.at)); log.steps.splice(i < 0 ? log.steps.length : i, 0, x); }
    const live = lib.replay(files.base, log.steps).data;
    return generate.check(files.base, log, generate.selectEnd(live), live, reference);
  };
  assert.ok(steps.filter(x => x.operation === 'claim.received').every(x => lib.VISIT_KINDS.includes(x.visit)), 'every claim step names its kind of visit');
  const may = steps.find(x => ['sick', 'strep'].includes(x.visit) && x.payload.member_id === 'm-3' && x.payload.lines[0].service_date.startsWith('2025-05'));
  assert.ok(may, 'Riley has a sick visit in May 2025');
  const sick = [line('svc-office-visit', '2025-05-27', 21000)];
  assert.ok(checked([bill(1, '2025-05-29T10:00:00-04:00', 'm-3', 'pv-1', sick, { visit: 'sick' })]).some(p => p.includes('m-3 2025-05 has 2 sick visits: ' + may.payload.claim_id + ', cl-901')), 'a second sick visit in a month is caught');
  assert.ok(checked([bill(1, '2025-05-29T10:00:00-04:00', 'm-3', 'pv-1', sick, {})]).some(p => p.includes('cl-901 names no kind of visit')), 'a claim without its kind of visit is caught');
  assert.ok(checked([bill(1, '2025-05-29T10:00:00-04:00', 'm-3', 'pv-1', sick, { visit: 'physical' })]).some(p => p.includes('cl-901 is labelled a physical visit')), 'a sick visit labelled as a physical is caught');
  const regular = steps.filter(x => x.visit === 'labs' && x.payload.member_id === 'm-1'), moved = regular[2];
  assert.ok(checked([{ ...structuredClone(moved), id: 's-904', payload: { ...structuredClone(moved.payload), claim_id: 'cl-904', lines: moved.payload.lines.map(l => ({ ...l, service_date: lib.addDays(l.service_date, 30) })) }, at: toIso(ms(moved.at) + 30 * 86400000) }]).some(p => /m-1 has lab visits on .* days apart, not 12 to 14 weeks/.test(p)), 'an extra regular visit for Jordan between two others is caught');
  const routine = steps.find(x => x.episode === 'injury:m-3:2026-01-05');
  assert.ok(routine, 'Riley has a routine injury early in 2026');
  const hurt = [line('svc-specialist-visit', '2025-12-16', 33500, { possible_accident: true }), line('svc-xray', '2025-12-16', 15800, { possible_accident: true })];
  assert.ok(checked([bill(2, '2025-12-19T10:00:00-05:00', 'm-3', 'pv-2', hurt, { visit: 'injury', episode: 'injury:m-3:2025-12-16' })]).some(p => p.includes('m-3 has two routine injuries 20 days apart: cl-902 on 2025-12-16 and ' + routine.payload.claim_id)), 'routine injuries 20 days apart across a quarter boundary are caught');
  const back = files.full.pas.find(p => p.pa_id === 'pa-12'), last = steps.filter(x => x.course === 'jordan-back').at(-1);
  assert.ok(back && back.approved && last.payload.lines.some(l => l.service_date > back.approved.valid_until), 'one jordan-back session already follows the end of pa-12');
  const session = [line('svc-physical-therapy', lib.addDays(back.approved.valid_until, 24), 16500)];
  assert.ok(checked([bill(3, '2026-11-20T10:00:00-05:00', 'm-1', 'pv-3', session, { visit: 'therapy', course: 'jordan-back' })]).some(p => p.includes('the course m-1 jordan-back has 2 sessions outside its authorizations')), 'a second session 24 days after pa-12 ends is caught');
  assert.ok(checked([bill(3, '2026-11-20T10:00:00-05:00', 'm-1', 'pv-3', session, { visit: 'therapy', course: 'jordan-more' })]).some(p => p.includes('the course m-1 jordan-more has no session inside an approved authorization')), 'the same session under a new course name is caught');
  assert.ok(checked([bill(3, '2026-11-20T10:00:00-05:00', 'm-1', 'pv-3', session, { visit: 'therapy' })]).some(p => p.includes('cl-903 bills therapy without naming its course')), 'a therapy claim without its course is caught');
});

test('Dataset the generator check binds a course to its own authorizations, counts a corrected session once, fits providers to services in any line order, requires the yearly visits and the regular visits to the window edges, checks episode names and ties a follow-up to a semaglutide request', () => {
  const reference = lib.read('fixtures/minimal.json');
  const line = (service_id, service_date, billed_cents, flags = {}) => ({ service_id, service_date, units: 1, billed_cents, emergency: false, possible_accident: false, ...flags });
  const bill = (n, at, member, provider, lines, meta) => ({ id: 's-90' + n, at, by: 'infra', operation: 'claim.received', payload: { claim_id: 'cl-90' + n, member_id: member, provider_id: provider, lines: lines.map((l, i) => ({ line_id: 'ln-' + (i + 1), ...l })) }, ...meta });
  const checked = edit => {
    const log = structuredClone(files.replay);
    edit(log.steps);
    log.steps.sort((a, b) => ms(a.at) - ms(b.at));
    const live = lib.replay(files.base, log.steps).data;
    return generate.check(files.base, log, generate.selectEnd(live), live, reference);
  };
  const add = extra => list => list.push(...extra), claimStep = (list, id) => list.find(x => x.operation === 'claim.received' && x.payload.claim_id === id);
  const caught = (edit, pattern, what) => { const p = checked(edit); assert.ok(p.some(x => pattern.test(x)), what + ': ' + p.join(' | ')); };
  assert.deepEqual(checked(() => {}), [], 'the committed replay passes');
  caught(add([bill(1, '2026-06-15T10:00:00-04:00', 'm-2', 'pv-3', [line('svc-physical-therapy', '2026-06-09', 16500), line('svc-physical-therapy', '2026-06-11', 16500)], { visit: 'therapy', course: 'casey-knee-preop' })]), /the course m-2 casey-knee-preop has 2 sessions outside its authorizations \(pa-6\)/, 'sessions under another course\'s authorization are caught');
  caught(list => { delete list.find(x => x.operation === 'pa.submitted' && x.payload.pa_id === 'pa-12').course; }, /pa-12 requests therapy without naming its course/, 'a therapy request without its course is caught');
  const c90 = files.full.claims.find(c => c.claim_id === 'cl-90');
  assert.deepEqual(checked(add([{ id: 's-905', at: '2026-11-13T10:00:00-05:00', by: 'infra', operation: 'claim.received', payload: { claim_id: 'cl-905', member_id: c90.member_id, provider_id: c90.provider_id, lines: c90.lines.map(l => ({ line_id: l.line_id, service_id: l.service_id, service_date: l.service_date, units: l.units, billed_cents: l.billed_cents, emergency: l.emergency, possible_accident: l.possible_accident })) }, visit: 'therapy', course: 'jordan-back', corrects: 'cl-90' }])), [], 'a valid correction of cl-90 counts its sessions once');
  caught(list => { claimStep(list, 'cl-66').payload.provider_id = 'pv-1'; }, /cl-66 bills svc-arthroscopy at pv-1, a prescriber, which does not provide it/, 'a surgery billed by the family practice is caught');
  assert.deepEqual(checked(list => { claimStep(list, 'cl-3').payload.lines.reverse(); }), [], 'a lab visit with its lines in the other order passes');
  caught(list => { claimStep(list, 'cl-22').visit = 'follow-up'; }, /m-3 has 0 checkup visits in 2025, not 1/, 'a missing yearly checkup is caught');
  caught(list => { list.splice(list.indexOf(claimStep(list, 'cl-93')), 1); }, /m-1's last regular visit, 2026-08-06, is more than 14 weeks before 2026-12-31/, 'a missing last regular visit is caught');
  const early = structuredClone(files.full);
  early.claims = early.claims.filter(c => c.claim_id !== 'cl-3');
  assert.ok(lib.visitProblems(early, steps, generate.VISITS).some(p => /m-1's first regular visit, 2025-04-17, is more than 14 weeks after 2025-01-01/.test(p)), 'a missing first regular visit is caught');
  caught(add([bill(2, '2025-12-19T10:00:00-05:00', 'm-3', 'pv-2', [line('svc-specialist-visit', '2025-12-16', 33500, { possible_accident: true }), line('svc-xray', '2025-12-16', 15800, { possible_accident: true })], { visit: 'injury', episode: 'injury:m-3:2026-01-05' })]), /cl-902 names the episode injury:m-3:2026-01-05 but bills m-3 from 2025-12-16/, 'an injury reusing another day\'s episode is caught');
  caught(add([bill(2, '2025-12-19T10:00:00-05:00', 'm-3', 'pv-2', [line('svc-specialist-visit', '2025-12-16', 33500, { possible_accident: true }), line('svc-xray', '2025-12-16', 15800, { possible_accident: true })], { visit: 'injury', episode: 'riley-fall' })]), /cl-902 names riley-fall, which is no episode of the dataset/, 'an injury under an unknown episode is caught');
  caught(add([bill(2, '2026-03-23T10:00:00-04:00', 'm-3', 'pv-2', [line('svc-specialist-visit', '2026-03-20', 33500, { possible_accident: true })], { visit: 'injury', episode: 'riley-knee' })]), /cl-902 on 2026-03-20 is more than 30 days after the first visit of riley-knee/, 'a story injury far from its episode is caught');
  const sick = steps.find(x => x.visit === 'sick' && x.payload.member_id === 'm-2');
  caught(list => { list.find(x => x.id === sick.id).visit = 'follow-up'; }, new RegExp(sick.payload.claim_id + ' is labelled a follow-up visit, but no semaglutide request of its own from pv-1 follows it within 10 days'), 'a sick visit relabelled as a follow-up is caught');
  for (const c of files.full.claims.filter(x => steps.find(y => y.operation === 'claim.received' && y.payload.claim_id === x.claim_id).visit === 'follow-up')) {
    const next = files.full.pas.filter(p => p.service_id === 'svc-semaglutide-1' && p.member_id === c.member_id).map(p => lib.daysBetween(c.lines[0].service_date, lib.dateOf(p.submitted_at))).filter(d => d >= 1 && d <= 10);
    assert.ok(next.length, c.claim_id + ' precedes a semaglutide request');
  }
});

test('Dataset the generator check binds a story episode to its member and first visit, fits a surgery to any hospital, links each work-up and follow-up to a semaglutide request of its own and caps Casey\'s lab visit at one a year', () => {
  const reference = lib.read('fixtures/minimal.json');
  const line = (service_id, service_date, billed_cents, flags = {}) => ({ service_id, service_date, units: 1, billed_cents, emergency: false, possible_accident: false, ...flags });
  const bill = (n, at, member, provider, lines, meta) => ({ id: 's-90' + n, at, by: 'infra', operation: 'claim.received', payload: { claim_id: 'cl-90' + n, member_id: member, provider_id: provider, lines: lines.map((l, i) => ({ line_id: 'ln-' + (i + 1), ...l })) }, ...meta });
  const checked = edit => {
    const log = structuredClone(files.replay);
    edit(log.steps);
    log.steps.sort((a, b) => ms(a.at) - ms(b.at));
    const live = lib.replay(files.base, log.steps).data;
    return generate.check(files.base, log, generate.selectEnd(live), live, reference);
  };
  const add = extra => list => list.push(...extra), claimStep = (list, id) => list.find(x => x.operation === 'claim.received' && x.payload.claim_id === id);
  const caught = (edit, pattern, what) => { const p = checked(edit); assert.ok(p.some(x => pattern.test(x)), what + ': ' + p.join(' | ')); };
  assert.deepEqual(checked(() => {}), [], 'the committed replay passes');
  assert.equal(claimStep(steps, 'cl-23').visit, 'work-up', 'the semaglutide work-up has its own label');
  const knee = [line('svc-specialist-visit', '2025-12-16', 33500, { possible_accident: true }), line('svc-xray', '2025-12-16', 15800, { possible_accident: true })];
  caught(add([bill(1, '2025-12-19T10:00:00-05:00', 'm-3', 'pv-2', knee, { visit: 'injury', episode: 'casey-knee' })]), /cl-901 names the episode casey-knee, which is m-2's, but bills m-3/, 'Riley\'s injury under Casey\'s episode is caught');
  caught(add([bill(1, '2026-01-30T10:00:00-05:00', 'm-2', 'pv-2', [line('svc-specialist-visit', '2026-01-27', 33500, { possible_accident: true })], { visit: 'injury', episode: 'casey-knee' })]), /casey-knee of m-2 has 2 injury visits from 2026-01-27, 2026-02-04, not one first visit/, 'a second first visit in a story episode is caught');
  assert.deepEqual(checked(list => { claimStep(list, 'cl-66').payload.provider_id = 'pv-6'; }), [], 'the surgery billed by the other hospital passes');
  caught(add([bill(2, '2026-03-09T10:00:00-04:00', 'm-2', 'pv-1', [line('svc-office-visit', '2026-03-06', 21500)], { visit: 'follow-up' })]), /cl-52 is labelled a follow-up visit, but no semaglutide request of its own from pv-1 follows it within 10 days/, 'two follow-ups before one renewal are caught');
  caught(list => { claimStep(list, 'cl-23').visit = 'labs'; }, /m-2 has 2 labs visits in 2025, not 1: cl-1, cl-23/, 'the work-up counted as a lab visit is caught');
  caught(list => { claimStep(list, 'cl-23').visit = 'labs'; }, /pa-3, a first semaglutide request, has no work-up visit of its own/, 'a first request without its work-up is caught');
  caught(add([bill(4, '2025-04-17T10:00:00-04:00', 'm-2', 'pv-1', [line('svc-office-visit', '2025-04-14', 21500), line('svc-lab-panel', '2025-04-14', 9418)], { visit: 'labs' })]), /m-2 has 2 labs visits in 2025, not 1: cl-1, cl-904/, 'a second yearly lab visit is caught');
  const requests = files.full.pas.filter(p => p.service_id === 'svc-semaglutide-1').sort((a, b) => ms(a.submitted_at) - ms(b.submitted_at));
  const linked = files.full.claims.filter(c => ['work-up', 'follow-up'].includes(claimStep(steps, c.claim_id).visit));
  assert.equal(linked.length, requests.length, 'one work-up or follow-up per semaglutide request');
});

test('Dataset out-of-network statements and replies come in more than one wording, each checked against the records', () => {
  const a = files.full.appeals.find(x => /scan/.test(x.statements[0].text)), copy = structuredClone(files.full), x = copy.appeals.find(y => y.appeal_id === a.appeal_id);
  const c = files.full.claims.find(y => y.claim_id === a.target.id), provider = files.full.providers.find(p => p.provider_id === c.provider_id).name;
  const m = notes.SHAPES.out_of_network.exec(a.statements[0].text) || notes.SHAPES.out_of_network_soonest.exec(a.statements[0].text);
  assert.ok(m, 'a scan statement in one of the wordings');
  const ordered = notes.parsed(notes.SHAPES.out_of_network.test(a.statements[0].text) ? m[2] : m[1]), orderer = notes.SHAPES.out_of_network.test(a.statements[0].text) ? m[1] : m[2];
  const lines = c.lines.map(l => ({ service: files.full.services.find(s => s.service_id === l.service_id).description, date: l.service_date }));
  for (const variant of [0, 1]) {
    x.statements[0].text = notes.STATEMENTS.out_of_network({ member: c.member_id, provider, lines, orderer, ordered, variant });
    if (x.statements[1]) x.statements[1].text = notes.REPLIES.out_of_network(orderer, ordered, provider, variant);
    assert.deepEqual(notes.problems(copy).filter(p => p.startsWith(a.appeal_id)), [], 'wording ' + variant + ' passes');
  }
  assert.notEqual(notes.STATEMENTS.out_of_network({ member: c.member_id, provider, lines, orderer, ordered, variant: 0 }), notes.STATEMENTS.out_of_network({ member: c.member_id, provider, lines, orderer, ordered, variant: 1 }));
  x.statements[0].text = notes.STATEMENTS.out_of_network({ member: c.member_id, provider, lines, orderer, ordered: lib.addDays(ordered, -60), variant: 1 });
  assert.ok(notes.problems(copy).some(p => p.startsWith(a.appeal_id + ' statement')), 'the second wording with a wrong order date is caught');
});
