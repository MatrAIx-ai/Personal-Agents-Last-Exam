'use strict';
const fs = require('node:fs');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const { ms, toIso } = require('../src/time.cjs');
const { project } = require('../src/timers.cjs');
const { relation } = require('../src/authority.cjs');
const { money } = require('../src/util.cjs');
const lib = require('./lib.cjs');
const notes = require('./notes.cjs');
const { PLAN_LATE, SEED, backlogs } = require('./generate.cjs');
const { asOf } = require('./as-of.cjs');
const { lowerFirst } = notes;
const NAMES = {
  claim: ['claim', 'claims'], claim_processing: ['claim processed', 'claims processed'], info_request: ['information request', 'information requests'], info_answer: ['answer', 'answers'], info_expiry: ['request expiry', 'request expiries'],
  attestation: ['attestation', 'attestations'], eob: ['EOB', 'EOBs'], pa: ['PA', 'PAs'], pa_info_request: ['PA information request', 'PA information requests'], pa_expedite: ['expedite request', 'expedite requests'],
  pa_expedite_decision: ['expedite decision', 'expedite decisions'], pa_decision: ['PA decision', 'PA decisions'], pa_overdue: ['overdue PA decision', 'overdue PA decisions'], pa_expiry: ['PA expiry', 'PA expiries'], covered_submission: ['covered submission', 'covered submissions'],
  appeal: ['appeal', 'appeals'], appeal_statement: ['appeal statement', 'appeal statements'], appeal_info_request: ['appeal information request', 'appeal information requests'], appeal_decision: ['appeal decision', 'appeal decisions'], appeal_withdrawal: ['appeal withdrawal', 'appeal withdrawals'],
  appeal_overdue: ['overdue appeal decision', 'overdue appeal decisions'], appeal_window: ['appeal window', 'appeal windows'], window_closing_notice: ['closing notice', 'closing notices'], grant: ['grant', 'grants'], grant_revocation: ['grant revocation', 'grant revocations'], notice: ['notice', 'notices'],
};
const { ZONE, FIRST, LAST, START, END, REFERENCE, FILES } = lib;

const OUT = { json: 'dataset/COVERAGE.json', md: 'dataset/COVERAGE.md' };
const METHOD = ['dataset/lib.cjs', 'dataset/notes.cjs', 'dataset/generate.cjs', 'dataset/as-of.cjs', 'dataset/coverage.cjs', 'plugin.cjs', ...fs.readdirSync(path.join(lib.ROOT, 'src')).filter(f => f.endsWith('.cjs')).sort().map(f => 'src/' + f)];
const INSTANTS = ['2026-01-01', REFERENCE, '2026-12-15', END];
const PROPOSAL = 'https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/c0f566a3c5be418cd0c971d58e4144cb8085d25a/proposals/environment/larkfield-health.md';
const DAY = 86400000;
const timerInstant = files => {
  const steps = new Set(files.replay.steps.map(s => ms(s.at)));
  const expired = files.full.info_requests.find(r => r.status === 'expired' && r.type === 'accident' && !steps.has(ms(r.expires_at)) && !steps.has(ms(r.expires_at) + 1));
  return toIso(ms(expired.expires_at) + 1);
};
const instantsOf = files => [timerInstant(files), ...INSTANTS.map(lib.instant)].sort((a, b) => ms(a) - ms(b));
const GAP_DAYS = 7;
const KINDS = [...lib.KINDS.map(k => ({ ...k, source: FILES.full })), { kind: 'replay_step', source: FILES.replay, list: 'steps', id: 'steps[].id', date_field: 'at' }];
const ROLES = {
  [FILES.base]: 'Seed at the window start ' + START + ': the household, the plan with its 2025 to 2027 benefit years, the six providers and fourteen services of the fixture, coverage unknown for every member and year, accumulators at zero; no records.',
  [FILES.replay]: 'Every committed step in time order: the household members\' tool calls and Infra events, each with its time.',
  [FILES.full]: 'Seed at ' + END + ', the state after every step with the timers due before that instant committed: all records of the window.',
};
const MEASURES = {
  answer_days: 'Days from an information request\'s opening to its answer: (answered_at minus opened_at) in elapsed milliseconds divided by 86,400,000, over answered requests; requests that expired are counted separately and are not part of the distribution.',
  pa_decision_days: 'Days from a PA\'s submission to the plan\'s first decision on it: (the first decision minus submitted_at) in elapsed milliseconds divided by 86,400,000, where the first decision is a denied PA\'s denial_notice_at, which a later appeal does not change, and otherwise an approved PA\'s decided_at; a withdrawn PA has no decision.',
  appeal_decision_days: 'Days from an appeal\'s filing to its decision: (decided_at minus filed_at) in elapsed milliseconds divided by 86,400,000, over decided appeals; withdrawn and open appeals are listed by status.',
  out_of_pocket: 'Each member\'s deductible and out-of-pocket amounts per plan year are the App\'s accumulators in ' + FILES.full + ', compared with that year\'s individual limits; family totals are the sums over the enrolled members.',
};
const plural = kind => kind + 's';

function inventory(files) {
  const items = [...lib.dated(files.full).map(i => ({ ...i, source: FILES.full })), ...files.replay.steps.map(s => ({ kind: 'replay_step', id: s.id, at: s.at, source: FILES.replay, action: s.operation || s.tool }))];
  const invalid = items.filter(i => !lib.validInstant(i.at));
  const dated = items.filter(i => !invalid.includes(i)).map(i => ({ ...i, date: lib.dateOf(i.at) }));
  const outside = dated.filter(i => i.date < FIRST || i.date > LAST);
  return { invalid, outside, counted: dated.filter(i => i.date >= FIRST && i.date <= LAST) };
}

function span(list) {
  const dates = [...new Set(list.map(i => i.date))].sort();
  return { distinct_dates: dates.length, earliest: dates[0] || null, latest: dates[dates.length - 1] || null };
}

function unusedAuthorizations(full) {
  const billed = new Set(full.claims.flatMap(c => c.lines.map(l => l.service_id))), kinds = new Set(full.providers.map(p => p.kind));
  const groups = new Map();
  for (const p of full.pas.filter(x => x.approved && x.units_used === 0 && !billed.has(x.service_id))) groups.set(p.service_id, [...(groups.get(p.service_id) || []), p]);
  return [...groups].map(([id, pas]) => {
    const svc = full.services.find(s => s.service_id === id), members = [...new Set(pas.map(p => p.member_id))].map(m => full.members.find(x => x.member_id === m).name.split(' ')[0]);
    const list = pas.map(p => p.pa_id + ' (' + p.approved.units + ' units, ' + p.approved.valid_from + ' to ' + p.approved.valid_until + ')');
    const joined = list.length < 2 ? list.join('') : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1], none = kinds.has(svc.category) ? '' : ' and the catalogue has no ' + svc.category + ' among its providers';
    return { kind: 'unused_authorizations', status: 'stated gap', service_id: id, pa_ids: pas.map(p => p.pa_id), reason: members.join(' and ') + '\'s ' + svc.description.split(',')[0].replace(/^./, c => c.toLowerCase()) + ' authorizations ' + joined + ' are approved and never used: each ends with 0 units used, and no claim line bills ' + id + '. The service is a ' + svc.category + ' item' + none + ', so the authorization is never used in this App; each request follows a visit at ' + full.providers.find(x => x.provider_id === pas[0].provider_id).name + ', which bills the visit, not the medicine, and the dataset invents no ' + svc.category + ' claims.' };
  });
}
function gaps(dates, full) {
  const out = [];
  let run = null;
  for (let d = FIRST; d <= LAST; d = lib.addDays(d, 1)) {
    if (!dates.has(d)) { run = run || { from: d, to: d }; run.to = d; continue; }
    if (run) out.push(run);
    run = null;
  }
  if (run) out.push(run);
  return out.map(r => {
    const days = lib.daysBetween(r.from, r.to) + 1;
    const trip = notes.TRIPS.find(x => x.from <= r.to && x.to >= r.from);
    const received = full.claims.filter(c => lib.validInstant(c.received_at)).map(c => lib.dateOf(c.received_at)).sort();
    const before = received.filter(d => d < r.from).at(-1) || null, next = received.find(d => d > r.to) || null;
    const visits = new Set(full.claims.flatMap(c => c.lines.map(l => l.service_date)).filter(d => d >= r.from && d <= r.to)).size;
    const around = (before ? 'the last claim before it arrived on ' + before : 'no claim arrives before it in the window') + ', ' + (next ? 'the next on ' + next : 'none arrives after it in the window') + ', and ' + (visits ? visits + ' service date' + (visits === 1 ? '' : 's') + ' inside it ' + (visits === 1 ? 'was' : 'were') + ' billed after it' : 'no visit falls inside it');
    const reason = (trip ? 'Overlaps the ' + trip.what + ' (' + trip.from + ' to ' + trip.to + '), when the household has no scheduled care. ' : '') + 'No claim arrives and no review, request, decision, notice or household action falls in these days: ' + around + '.';
    return { kind: 'days_without_records', from: r.from, to: r.to, days, reason, last_claim_before: before, next_claim: next };
  }).filter(g => g.days >= GAP_DAYS);
}

const stats = list => { const s = [...list].sort((a, b) => a - b); return s.length ? { count: s.length, min: +s[0].toFixed(1) + 0, median: +s[Math.floor(s.length / 2)].toFixed(1) + 0, max: +s[s.length - 1].toFixed(1) + 0 } : { count: 0, min: null, median: null, max: null }; };
function measures(full) {
  const answered = full.info_requests.filter(r => r.status === 'answered').map(r => (ms(r.answered_at) - ms(r.opened_at)) / DAY);
  const pas = full.pas.filter(p => p.denial_notice_at || p.decided_at).map(p => (ms(p.denial_notice_at || p.decided_at) - ms(p.submitted_at)) / DAY);
  const appeals = full.appeals.filter(a => a.decided_at).map(a => (ms(a.decided_at) - ms(a.filed_at)) / DAY);
  const oop = full.accumulators.filter(a => a.plan_year <= 2026).map(a => {
    const year = full.plan.years[String(a.plan_year)];
    return { member_id: a.member_id, plan_year: a.plan_year, deductible: money(a.deductible_cents) + ' of ' + money(year.deductible.individual_cents), out_of_pocket: money(a.oop_cents) + ' of ' + money(year.oop_max.individual_cents), deductible_met: a.deductible_cents >= year.deductible.individual_cents, out_of_pocket_max_reached: a.oop_cents >= year.oop_max.individual_cents };
  });
  return {
    methods: MEASURES,
    answer_days: { ...stats(answered), expired: full.info_requests.filter(r => r.status === 'expired').length, by_type: Object.fromEntries(['other_coverage', 'accident'].map(t => [t, stats(full.info_requests.filter(r => r.type === t && r.status === 'answered').map(r => (ms(r.answered_at) - ms(r.opened_at)) / DAY))])) },
    pa_decision_days: { ...stats(pas), overdue: full.pas.filter(p => p.overdue).map(p => p.pa_id) },
    appeal_decision_days: { ...stats(appeals), overdue: full.appeals.filter(a => a.overdue).map(a => a.appeal_id), by_status: Object.fromEntries(['upheld', 'overturned', 'withdrawn', 'under_review', 'info_requested'].map(s => [s, full.appeals.filter(a => a.status === s).length])) },
    out_of_pocket: oop,
  };
}

const lineText = (seed, c, e) => e.lines.map(l => { const cl = c.lines.find(x => x.line_id === l.line_id); return l.line_id + ' ' + cl.service_id.replace('svc-', '') + ' ' + cl.service_date + ' ' + (l.status === 'paid' ? 'paid ' + money(l.plan_paid_cents) + ', member ' + money(l.member_cost_cents) + (l.copay_cents ? ' copay' : '') + (l.deductible_cents ? ' deductible ' + money(l.deductible_cents) : '') + (l.coinsurance_cents ? ' coinsurance ' + money(l.coinsurance_cents) : '') : 'denied ' + l.reason); }).join('; ');
function describe(seed, c, label) {
  const eobs = seed.eobs.filter(e => e.claim_id === c.claim_id).sort((a, b) => a.version - b.version);
  return {
    example: label, claim_id: c.claim_id, member: c.member_id + ' ' + seed.members.find(m => m.member_id === c.member_id).name, provider: c.provider_id + ' ' + seed.providers.find(p => p.provider_id === c.provider_id).name,
    received_at: c.received_at, status: c.status, requests: seed.info_requests.filter(r => r.claim_id === c.claim_id).map(r => r.info_request_id + ' ' + r.type + ' ' + r.line_id + ' ' + r.status + (r.answer ? ' ' + r.answer : '')),
    eobs: eobs.map(e => 'v' + e.version + ' ' + e.issued_at + ': ' + lineText(seed, c, e)),
    appeals: seed.appeals.filter(a => a.target.type === 'claim' && a.target.id === c.claim_id).map(a => a.appeal_id + ' ' + a.status + ' (filed ' + a.filed_at + ' by ' + a.statements[0].by + ')'),
    notices: seed.notices.filter(n => (n.subject.type === 'claim' && n.subject.id === c.claim_id) || (n.subject.type === 'info_request' && seed.info_requests.some(r => r.info_request_id === n.subject.id && r.claim_id === c.claim_id))).map(n => n.notice_id + ' ' + n.kind + ' to ' + n.recipient_id),
  };
}
function meets(seed, c, kind) {
  if (!c) return null;
  for (const e of seed.eobs.filter(x => x.claim_id === c.claim_id).sort((a, b) => a.version - b.version)) for (const p of e.postings) {
    const year = seed.plan.years[String(p.plan_year)], cap = kind === 'oop' ? year.oop_max.individual_cents : year.deductible.individual_cents;
    const before = e.ledger_before[String(p.plan_year)].member[kind === 'oop' ? 'oop_cents' : 'deductible_cents'];
    const prev = e.version > 1 ? seed.eobs.find(x => x.claim_id === c.claim_id && x.version === e.version - 1).postings.find(x => x.plan_year === p.plan_year) : null;
    const delta = p[kind === 'oop' ? 'oop_cents' : 'deductible_cents'] - (prev ? prev[kind === 'oop' ? 'oop_cents' : 'deductible_cents'] : 0);
    if (before < cap && before + delta >= cap) {
      const lines = e.lines.filter(l => c.lines.find(x => x.line_id === l.line_id).service_date.startsWith(String(p.plan_year)) && l[kind === 'oop' ? 'member_cost_cents' : 'deductible_cents'] > 0);
      return { eob_id: e.eob_id, year: p.plan_year, service_id: c.lines.find(x => x.line_id === lines.at(-1).line_id).service_id };
    }
  }
  return null;
}
function representative(seed) {
  const used = new Set();
  const v = (c, n) => seed.eobs.find(e => e.claim_id === c.claim_id && e.version === n);
  const lines = c => (v(c, 1) ? v(c, 1).lines : []);
  const latest = c => { const list = seed.eobs.filter(e => e.claim_id === c.claim_id).sort((a, b) => b.version - a.version); return list.length ? list[0].lines : []; };
  const req = (c, test) => seed.info_requests.some(r => r.claim_id === c.claim_id && test(r));
  const find = (label, test) => { const c = seed.claims.find(x => !used.has(x.claim_id) && test(x)); if (!c) return null; used.add(c.claim_id); return describe(seed, c, label); };
  const prov = c => seed.providers.find(p => p.provider_id === c.provider_id);
  return [
    find('first claim of the window', c => c === seed.claims[0]),
    find('last claim of the window', c => c === seed.claims[seed.claims.length - 1]),
    find('first claim after the reference clock', c => ms(c.received_at) >= ms(REFERENCE)),
    find('accident questions left to expire, appealed and overturned into EOB version 2', c => req(c, r => r.status === 'expired') && v(c, 2)),
    find('work injury denied as another party\'s', c => req(c, r => r.answer === 'work_related')),
    find('scheduled imaging out of network, denied and appealed', c => lines(c).some(l => l.reason === 'out_of_network') && prov(c).kind === 'imaging' && seed.appeals.some(a => a.target.id === c.claim_id)),
    find('emergency billed without the emergency flag, appeal withdrawn after the corrected claim', c => lines(c).some(l => l.reason === 'out_of_network') && seed.appeals.some(a => a.target.id === c.claim_id && a.status === 'withdrawn')),
    find('therapy session after the authorization ended, appealed', c => lines(c).some(l => l.reason === 'prior_auth_missing') && seed.appeals.some(a => a.target.id === c.claim_id)),
    find('surgery' + (meets(seed, seed.claims.find(c => c.lines.some(l => l.service_id === 'svc-arthroscopy')), 'deductible') ? ' meeting the deductible' : ''), c => c.lines.some(l => l.service_id === 'svc-arthroscopy')),
    (c => c && describe(seed, c, lowerFirst(seed.services.find(x => x.service_id === meets(seed, c, 'oop').service_id).description) + ' reaching ' + seed.members.find(m => m.member_id === c.member_id).name + '\'s out-of-pocket maximum for ' + meets(seed, c, 'oop').year))(seed.claims.find(c => !used.has(c.claim_id) && meets(seed, c, 'oop'))),
    find('one claim posting to two plan years', c => new Set(c.lines.map(l => l.service_date.slice(0, 4))).size === 2),
    find('emergency at an out-of-network hospital, paid at in-network cost sharing', c => !prov(c).in_network && c.lines.every(l => l.emergency) && lines(c).every(l => l.status === 'paid')),
    find('other coverage answered as secondary', c => req(c, r => r.answer === 'other_secondary')),
    find('accident questions answered as not an accident', c => req(c, r => r.answer === 'not_accident')),
    find('received and not yet reviewed at the window end', c => c.status === 'received'),
    find('waiting for answers at the window end', c => c.status === 'pending_info'),
    find('routine office visit paid with a copay', c => c.lines.length === 1 && c.lines[0].service_id === 'svc-office-visit' && lines(c).every(l => l.status === 'paid' && l.copay_cents > 0) && !req(c, () => true)),
    find('nurse phone consultation priced below the copay', c => c.lines.some(l => l.service_id === 'svc-phone-consult') && lines(c).some(l => l.status === 'paid' && l.copay_cents === l.allowed_cents)),
    find('lab work toward the deductible', c => lines(c).some(l => l.deductible_cents > 0 && l.coinsurance_cents === 0 && seed.services.find(x => x.service_id === c.lines.find(y => y.line_id === l.line_id).service_id).category === 'lab') && !req(c, () => true)),
    find('coinsurance after the deductible was met', c => latest(c).some(l => l.coinsurance_cents > 0 && l.deductible_cents === 0)),
    find('other-coverage questions answered on the first claim of a year', c => req(c, r => r.type === 'other_coverage' && r.answer === 'none')),
    find('accident questions answered as an accident', c => req(c, r => r.answer === 'accident')),
  ].filter(Boolean);
}
function paRows(seed) {
  return seed.pas.map(p => ({
    pa_id: p.pa_id, member_id: p.member_id, provider_id: p.provider_id, service_id: p.service_id, status: p.status, submitted_at: p.submitted_at, due_at: p.due_at, decided_at: p.decided_at, overdue_at: p.overdue_at,
    requested: p.requested, approved: p.approved, units_used: p.units_used, info_requests: p.info_requests.map(r => r.at + ' ' + r.text), expedite: p.expedite ? p.expedite.status + ' (requested ' + p.expedite.requested_at + ')' : null,
    covered_submissions: p.covered_submissions.map(s => s.pa_id + ' ' + s.units + ' units at ' + s.at), appeals: seed.appeals.filter(a => a.target.type === 'pa' && a.target.id === p.pa_id).map(a => a.appeal_id + ' ' + a.status + (a.expedited ? ' (expedited)' : '')),
  }));
}
function appealRows(seed) {
  return seed.appeals.map(a => ({ appeal_id: a.appeal_id, member_id: a.member_id, target: a.target.type + ':' + a.target.id, expedited: a.expedited, filed_at: a.filed_at, filed_by: a.statements[0].by, due_at: a.due_at, status: a.status, decided_at: a.decided_at, withdrawn_at: a.withdrawn_at, overdue: a.overdue, statements: a.statements.map(s => s.at + ' ' + s.by + ': ' + s.text), info_requests: a.info_requests.map(r => r.at + ' ' + r.text) }));
}

function compute(files = lib.load()) {
  const { invalid, outside, counted } = inventory(files);
  const records = counted.filter(i => i.source === FILES.full);
  const after = i => ms(i.at) >= ms(REFERENCE);
  const all = new Set(counted.map(i => i.date));
  const monthly = lib.months().map(month => {
    const inMonth = counted.filter(i => i.date.startsWith(month)), mine = inMonth.filter(i => i.source === FILES.full);
    const row = { month };
    for (const k of KINDS) row[plural(k.kind)] = inMonth.filter(i => i.kind === k.kind).length;
    return { ...row, records: mine.length, distinct_dates: new Set(mine.map(i => i.date)).size, distinct_dates_with_replay_log: new Set(inMonth.map(i => i.date)).size, records_after_reference_clock: mine.filter(after).length, real: 0, synthetic: mine.length };
  });
  const perDate = Object.fromEntries([...all].sort().map(d => [d, { records: 0, claims: 0, replay_steps: 0 }]));
  for (const i of counted) { if (i.source === FILES.full) perDate[i.date].records++; if (i.kind === 'claim') perDate[i.date].claims++; if (i.kind === 'replay_step') perDate[i.date].replay_steps++; }
  const bytes = lib.bytesOf(files);
  const sources = [FILES.base, FILES.replay, FILES.full].map(file => ({ file, role: ROLES[file], kind: 'synthetic', bytes: Buffer.byteLength(bytes[file]), sha256: lib.digestOf(bytes[file]) }));
  const kinds = KINDS.map(k => { const list = counted.filter(i => i.kind === k.kind); return { ...k, records: list.length, ...span(list) }; });
  const full = files.full;
  const catalogCount = full.members.length + full.providers.length + full.services.length + Object.keys(full.plan.years).length;
  return {
    schema: 'larkfield-health.coverage.v1',
    scope: 'Environment dataset coverage of the Larkfield delivery dataset ' + files.replay.dataset_id + ', whole window. Not a Task history report: a Task reports its own selection after its first-session cutoff (dataset/as-of.cjs).',
    dataset_id: files.replay.dataset_id,
    time_zone: ZONE,
    window: { from: FIRST, to: LAST },
    reference_clock: REFERENCE,
    generator_seed: SEED,
    reproduce: ['node dataset/generate.cjs --check', 'node dataset/coverage.cjs --check'],
    counting: 'Every timestamp is ISO 8601 with its offset; each is converted to its calendar date in ' + ZONE + ' before counting. Date-only fields (a claim line\'s service_date, a PA\'s valid_from and valid_until) are not occurrence dates and are not counted. A date counts once however many records or sources fall on it. A required occurrence date (received_at, opened_at, issued_at, submitted_at, filed_at, notice_at, created_at or at) that is missing or not a valid ISO 8601 instant with the offset in force, and a record outside the window, is excluded from the count and listed by ID; processed_at, answered_at, attested_at, decided_at, overdue_at, expired_at, withdrawn_at and revoked_at are required only of records in the status that sets them, and a window\'s closing notice only when one was sent. ' + (invalid.length || outside.length ? invalid.length + ' invalid or missing and ' + outside.length + ' outside the window, listed in invalid and outside.' : 'There are none.'),
    sources,
    method: METHOD.map(file => ({ file, sha256: lib.sha256(file) })),
    record_kinds: kinds,
    exclusions: [
      { records: 'members[], providers[], services[] and plan.years in ' + FILES.full, count: catalogCount, reason: 'Household, provider, service and benefit rows with no occurrence date; they are the fixture\'s and do not change in the window.' },
      { records: 'accumulators[] in ' + FILES.full, count: full.accumulators.length, reason: 'Running totals per member and plan year with no date; their changes are the EOB postings, which are dated.' },
      { records: 'coverage[] rows still unknown', count: full.coverage.filter(c => c.status === 'unknown').length, reason: 'No attestation, so no date (the 2027 rows, and any member-year never answered).' },
      { records: 'PA withdrawals', count: full.pas.filter(p => p.status === 'withdrawn').length, reason: 'The App records a withdrawn PA\'s status without a time; the withdrawal is the pa.withdrawn step in ' + FILES.replay + ', counted there.' },
      { records: FILES.base, count: 0, reason: 'Holds only the household, plan and catalog at the window start; no dated records.' },
      { records: 'approvals', count: 0, reason: 'A confirmation (user.confirmed) is applied with the grant change, attestation, answer, filing or withdrawal it confirms and is not kept, because seeds carry no approvals; the confirmed step itself is in ' + FILES.replay + '.' },
    ],
    invalid_dates: invalid.length,
    invalid: invalid.map(i => ({ kind: i.kind, id: i.id, at: i.at })),
    outside_window: outside.length,
    outside: outside.map(i => ({ kind: i.kind, id: i.id, at: i.at })),
    totals: { records: records.length + invalid.filter(i => i.source === FILES.full).length + outside.filter(i => i.source === FILES.full).length, counted: records.length, replay_steps: counted.filter(i => i.kind === 'replay_step').length, app_records: plugin.records(full).length, claims: full.claims.length, eobs: full.eobs.length, pas: full.pas.length, appeals: full.appeals.length, grants: full.grants.length, notices: full.notices.length },
    distinct_dates: {
      coverage: span(records).distinct_dates,
      coverage_basis: 'Counted over the records loaded into the App (' + FILES.full + '), which Agents and Infra read back.',
      coverage_note: 'The global count over both sources adds ' + (all.size - span(records).distinct_dates) + (all.size - span(records).distinct_dates === 1 ? ' day' : ' days') + ' on which the replay log holds steps but no App record is dated.',
      by_source: { [FILES.full]: span(records).distinct_dates, [FILES.replay]: span(counted.filter(i => i.source === FILES.replay)).distinct_dates },
      by_kind: Object.fromEntries(kinds.map(k => [k.kind, k.distinct_dates])),
      global: all.size,
    },
    earliest: span(counted).earliest,
    latest: span(counted).latest,
    provenance: {
      real: 0, synthetic: records.length, mixed: 0,
      note: 'Every dated record and step is synthetic, written by the App while dataset/generate.cjs replayed it; none was collected or observed, including those dated at or after the reference clock. The three files are synthetic throughout: the household, plan, providers and services are the fixture\'s invented catalog.',
      code_sets: 'None. Services keep the fixture\'s plain descriptions; no procedure, diagnosis, drug or provider code set (CPT, HCPCS, ICD-10, NDC, NPI or similar) appears or is used.',
      real_public_facts: [
        { fact: 'U.S. federal holidays of 2025 and 2026 as observed (5 U.S.C. 6103), plus December 24', dates: [...notes.OFFICE_CLOSED], used_for: 'The calendar of the providers\' offices and the plan: visits, claim intake, PA submissions and plan decisions fall on weekdays outside these dates. Not stored in any record.' },
        { fact: 'America/New_York daylight-saving rules from the IANA time zone database, as Node.js applies them', used_for: 'The offset of every timestamp; the App\'s own time functions use the same rules.' },
      ],
      app_policy: 'The deadline lengths (3-day review, 45-day request expiry, 15-day PA decision, 30- and 60-day appeal decisions, 72-hour expedite, 180-day appeal window) are the App\'s policy, modelled on U.S. employer-plan rules as the approved proposal states; they are business logic, not data, and the dataset only follows them.',
    },
    partitions: [
      { partition: 'synthetic, dated before the reference clock', from: START, to: REFERENCE, records: records.filter(i => !after(i)).length, replay_steps: counted.filter(i => i.kind === 'replay_step' && !after(i)).length },
      { partition: 'synthetic, dated at or after the reference clock: generated, never observed', from: REFERENCE, to: END, records: records.filter(after).length, replay_steps: counted.filter(i => i.kind === 'replay_step' && after(i)).length },
    ],
    monthly,
    months_without_claims: monthly.filter(m => m.claims === 0).map(m => m.month),
    household: {
      trips: notes.TRIPS,
      plan_backlog: { periods: backlogs(), usual: PLAN_LATE.usual, pa_factor: PLAN_LATE.pa },
      grants: full.grants.map(g => ({ grant_id: g.grant_id, member_id: g.member_id, grantee_id: g.grantee_id, scope: g.scope, created_at: g.created_at, expires_at: g.expires_at, status: g.status, revoked_at: g.revoked_at, changed_by: (files.replay.steps.find(s => s.operation === 'grant.changed' && s.payload.grant_id === g.grant_id) ? 'event' : 'account holder') })),
      prior_authorizations: paRows(full),
      appeals: appealRows(full),
      measures: measures(full),
    },
    gaps: [
      { kind: 'real_data_anchor', period: '2026-11', status: 'stated gap, pending maintainer agreement', reason: 'There is no real health-plan record to collect: claims, EOBs, prior authorizations and appeals are a real member\'s protected health information, the reference product shows them only inside a signed-in member account, and the approved proposal (PR #64, ' + PROPOSAL + ' at the approved revision) describes a synthetic plan with the reference site as a workflow reference only (line 6), excludes data collection (line 103: "N/A: no crawling or copied content; record public workflow references") and calls for synthetic data with no real people, brands or member data (line 104). No real data anchors November 2026 or any other month; every dated record of the window is synthetic.' },
      { kind: 'mail_history', status: 'stated gap', reason: 'The ' + full.notices.length + ' notices are in the App\'s own notice log only; the dataset holds no Mail history for them. Mail is optional, and the Mail sender treats notices present in a loaded seed as history.' },
      ...unusedAuthorizations(full),
      ...gaps(new Set(records.map(i => i.date)), full),
    ],
    dates: perDate,
    representative: representative(full),
  };
}

function monthlyOf(data) {
  const rows = Object.fromEntries(lib.months().map(m => [m, Object.fromEntries(lib.KINDS.map(k => [plural(k.kind), 0]))]));
  for (const i of lib.dated(data)) { const m = lib.dateOf(i.at).slice(0, 7); if (rows[m]) rows[m][plural(i.kind)]++; }
  return rows;
}

const visibleTo = (data, actor, at) => data.claims.filter(c => relation(data, actor, c.member_id, ms(at)).view).map(c => c.claim_id).sort();

async function demonstrate(runtimeDir, files) {
  const { prepare } = require(path.join(runtimeDir, 'prepare.cjs'));
  const { Client } = require(path.join(runtimeDir, 'client.cjs'));
  const prepared = prepare(lib.ROOT);
  const clients = [];
  const open = async role => {
    const c = new Client(prepared.app, role, 'dataset-load', path.join(prepared.root, 'state'), 'larkfield-dataset-load', { registry: prepared.registry });
    clients.push(c);
    await c.initialize();
    return c;
  };
  try {
    const infra = await open('infra'), agent = await open('agent');
    const version = async () => (await infra.call('env.snapshot')).version;
    const instants = [];
    for (const [i, text] of instantsOf(files).entries()) {
      const selection = asOf(text, files);
      const loaded = await infra.call('env.load_seed', { expected_version: await version(), request_id: 'dataset-load-' + (i + 1), data: selection.data, virtual_now: selection.virtual_now, bundle: selection.bundle });
      if (loaded.status !== 'ready') throw Error('env.load_seed at ' + selection.as_of + ': ' + loaded.status + ' ' + (loaded.message || ''));
      const members = (await agent.call(lib.P + 'members.list', {})).members;
      const listed = (await agent.call(lib.P + 'claims.list', {})).claims;
      const views = [];
      for (const c of listed) views.push((await agent.call(lib.P + 'claims.get', { claim_id: c.claim_id })).claim);
      const pas = (await agent.call(lib.P + 'pa.list', {})).pas, appeals = (await agent.call(lib.P + 'appeals.list', {})).appeals, grants = (await agent.call(lib.P + 'grants.list', {})).grants;
      const plan = await agent.call(lib.P + 'plan.get', {});
      const snapshot = (await infra.call('env.snapshot')).snapshot;
      const projected = project(selection.data, selection.virtual_now);
      const expectedVisible = visibleTo(selection.data, selection.data.owner_person_id, selection.virtual_now);
      const readBack = monthlyOf(snapshot.data), expected = monthlyOf(selection.data);
      const openSeen = [...listed.filter(c => c.status !== 'processed').map(c => 'claim:' + c.claim_id), ...pas.filter(p => ['pending', 'info_requested'].includes(p.status)).map(p => 'pa:' + p.pa_id), ...appeals.filter(a => ['under_review', 'info_requested'].includes(a.status)).map(a => 'appeal:' + a.appeal_id)].sort();
      const openExpected = selection.open_items.filter(o => o.visible_to_account_holder && /^(claim|pa|appeal):/.test(o.item) && !/^appealable/.test(o.status)).map(o => o.item).sort();
      const totals = Object.fromEntries(lib.KINDS.map(k => [plural(k.kind), Object.values(readBack).reduce((s, r) => s + r[plural(k.kind)], 0)]));
      let staged = null;
      if (selection.events.length) {
        const event = selection.events[0];
        const applied = await infra.call('env.apply_event', { expected_version: await version(), event });
        const p = event.payload, after = (await infra.call('env.snapshot')).snapshot.data;
        const target = event.operation === 'claim.received' ? 'claim ' + p.claim_id + ' ' + after.claims.find(c => c.claim_id === p.claim_id).status
          : p.appeal_id ? 'appeal ' + p.appeal_id + ' ' + after.appeals.find(a => a.appeal_id === p.appeal_id).status
            : p.pa_id ? 'PA ' + p.pa_id + ' ' + (after.pas.find(x => x.pa_id === p.pa_id) || { status: 'covered' }).status
              : 'grant ' + p.grant_id + ' ' + after.grants.find(g => g.grant_id === p.grant_id).status;
        staged = { event_id: event.event_id, at: event.at, operation: event.operation, status: applied.status, target_after: target };
      }
      instants.push({
        as_of: selection.as_of,
        seed_id: selection.data.seed_id,
        load: { tool: 'env.load_seed', status: loaded.status, loaded_objects: loaded.loaded, bundle_dataset_id: loaded.quality.dataset_id, automated_checks: loaded.quality.automated_pass ? 'pass' : 'fail' },
        agent_clock: snapshot.virtual_now,
        steps_applied: selection.steps_applied,
        steps_withheld: selection.steps_withheld,
        timers_committed: selection.timers_committed.length,
        claims_in_selection: selection.data.claims.length,
        claims_listed_by_agent: listed.length,
        listed_ids_match_grants: JSON.stringify(listed.map(c => c.claim_id).sort()) === JSON.stringify(expectedVisible),
        states_match_app_reads: views.every(v => v.status === projected.claims.find(c => c.claim_id === v.claim_id).status && v.eobs.length === projected.eobs.filter(e => e.claim_id === v.claim_id).length),
        household_powers: members.map(m => m.member_id + ' ' + m.powers.join('+')),
        pas_listed: pas.length,
        appeals_listed: appeals.length,
        grants_listed: grants.length,
        plan_year_read: plan.plan.plan_year,
        accumulators_read: plan.members.map(m => m.member_id + ' ' + money(m.oop_cents)),
        latest_received_at: selection.data.claims.length ? selection.data.claims.map(c => c.received_at).sort((a, b) => ms(b) - ms(a))[0] : null,
        open_items: selection.open_items.map(o => o.item + ' ' + o.status),
        open_seen_by_agent: openSeen,
        open_items_match_core: JSON.stringify(openSeen) === JSON.stringify(openExpected),
        read_back: totals,
        monthly_read_back_matches_selection: JSON.stringify(readBack) === JSON.stringify(expected),
        staged_events_available: selection.events.length,
        first_staged_event: staged,
        ...(ms(selection.as_of) === ms(END) ? { monthly_read_back: readBack } : {}),
      });
    }
    const version_ = require(path.join(runtimeDir, 'package.json')).version;
    return { interface: 'Real Core ' + version_ + ' over MCP stdio: Infra loads each selection with env.load_seed (data, virtual_now and provenance bundle) and reads env.snapshot; the Agent, bound as the account holder m-1, reads ' + lib.P + 'members.list, claims.list, claims.get for every listed claim, pa.list, appeals.list, grants.list and plan.get; the first staged event, if any, is applied with env.apply_event.', runtime: version_, instants };
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
  }
}

const table = (head, rows) => ['| ' + head.join(' | ') + ' |', '| ' + head.map(() => '---').join(' | ') + ' |', ...rows.map(r => '| ' + r.join(' | ') + ' |')].join('\n');
function render(report) {
  const k = Object.fromEntries(report.record_kinds.map(x => [x.kind, x]));
  const label = (kind, n) => (n === 1 ? NAMES[kind][0] : NAMES[kind][1]);
  const h = report.household, m = h.measures;
  const lines = [
    '# Larkfield delivery dataset: coverage',
    '',
    report.scope,
    '',
    '- Dataset: `' + report.dataset_id + '`; window ' + report.window.from + ' to ' + report.window.to + ' inclusive; time zone `' + report.time_zone + '`; reference clock (the fixture clock) `' + report.reference_clock + '`; generator seed ' + report.generator_seed + '.',
    '- Reproduce: ' + report.reproduce.map(c => '`' + c + '`').join(', then ') + ' from `apps/larkfield-health`. This file and `COVERAGE.json` are written by `dataset/coverage.cjs`.',
    '- Counting: ' + report.counting,
    '- Smoke fixture and delivery dataset: `fixtures/minimal.json` and this dataset share the household, the plan, the providers and the services (equal at the fixture clock, checked by `tests/t32-dataset.test.cjs`) but have independent histories. The fixture serves the business tests, the examples and the proposal\'s example events; the dataset serves evaluation, and Tasks select their history from it with `dataset/as-of.cjs`. Their IDs overlap but name different records: the dataset uses the App\'s runtime series (`cl-1`, `pa-1`, `ap-1`, `gr-1`, `n-1`, …), while the fixture keeps its history in the `h` series and its task-timeline notices in the `t` series; the fixture\'s `cl-7`, `pa-4`, `gr-2` and the other IDs named by the proposal\'s example events are not the dataset\'s.',
    '',
    '## Sources',
    '',
    table(['File', 'Role', 'Kind', 'Bytes', 'SHA-256'], report.sources.map(s => ['`' + s.file + '`', s.role, s.kind, String(s.bytes), '`' + s.sha256 + '`'])),
    '',
    'Method: ' + report.method.map(x => '`' + x.file + '` (`' + x.sha256.slice(0, 16) + '…`)').join(', ') + '; full hashes in `COVERAGE.json`.',
    '',
    '## Record kinds, IDs and date fields',
    '',
    table(['Kind', 'Source', 'Found at', 'Stable ID', 'Date field', 'Dated entries', 'Distinct dates', 'Earliest', 'Latest'], report.record_kinds.map(x => [x.kind, '`' + x.source + '`', '`' + x.list + '`', '`' + x.id + '`', x.date_field, String(x.records), String(x.distinct_dates), x.earliest || '—', x.latest || '—'])),
    '',
    'Excluded from date counts:',
    '',
    ...report.exclusions.map(e => '- ' + e.records + ' (' + e.count + '): ' + e.reason),
    '- Invalid or missing occurrence dates: ' + report.invalid_dates + (report.invalid.length ? ' (' + report.invalid.map(i => i.kind + ' ' + i.id).join(', ') + ')' : '') + '; records outside the window: ' + report.outside_window + (report.outside.length ? ' (' + report.outside.map(i => i.kind + ' ' + i.id).join(', ') + ')' : '') + '.',
    '',
    '## Totals',
    '',
    '- Dated entries in `' + FILES.full + '`: ' + report.totals.records + ' (one per record\'s occurrence date, plus the dated changes a record carries: a claim\'s processing, a request\'s answer or expiry, an attestation, a PA\'s information requests, expedite, decision, overdue time and expiry, an appeal\'s statements, information requests, decision, withdrawal and overdue time, a window\'s closing notice and a grant\'s revocation), of which ' + report.totals.counted + ' have a valid occurrence date in the window (' + lib.KINDS.map(x => k[x.kind].records + ' ' + label(x.kind, k[x.kind].records)).join(', ') + '). App records (`plugin.records`: members, providers, services, claims, PAs, appeals and grants): ' + report.totals.app_records + '.',
    '- Replay steps in `' + FILES.replay + '`: ' + report.totals.replay_steps + '.',
    '- Coverage figure: **' + report.distinct_dates.coverage + '** distinct dates. ' + report.distinct_dates.coverage_basis + ' ' + report.distinct_dates.coverage_note + ' Per source: ' + Object.entries(report.distinct_dates.by_source).map(([f, n]) => '`' + f + '` ' + n).join(', ') + '; global deduplicated count over both sources: ' + report.distinct_dates.global + '.',
    '- Earliest date ' + report.earliest + ', latest date ' + report.latest + '. Months without a received claim: ' + (report.months_without_claims.length ? report.months_without_claims.join(', ') : 'none') + '.',
    '',
    '## Real and synthetic',
    '',
    '- Files: `' + FILES.base + '`, `' + FILES.replay + '` and `' + FILES.full + '` are synthetic throughout; nothing in them is mixed or reused.',
    '- Dated entries: real ' + report.provenance.real + ', synthetic ' + report.provenance.synthetic + ', mixed ' + report.provenance.mixed + '. ' + report.provenance.note,
    '- Code sets: ' + report.provenance.code_sets,
    ...report.provenance.real_public_facts.map(f => '- Real public fact: ' + f.fact + (f.dates ? ' (' + f.dates.join(', ') + ')' : '') + '. Used for: ' + f.used_for),
    '- App policy: ' + report.provenance.app_policy,
    '',
    table(['Partition', 'From', 'To', 'Dated entries', 'Replay steps'], report.partitions.map(p => [p.partition, p.from, p.to, String(p.records), String(p.replay_steps)])),
    '',
    '## Monthly coverage',
    '',
    table(['Month', 'Claims', 'Processed', 'Requests', 'Answers', 'Expiries', 'Attestations', 'EOBs', 'PAs', 'PA steps', 'Appeals', 'Appeal steps', 'Windows', 'Grants', 'Notices', 'Dated entries', 'Replay steps', 'Distinct dates (entries)', 'Distinct dates (with replay log)', 'After reference clock', 'Real', 'Synthetic'],
      report.monthly.map(x => [x.month, x.claims, x.claim_processings, x.info_requests, x.info_answers, x.info_expirys, x.attestations, x.eobs, x.pas, x.pa_info_requests + x.pa_expedites + x.pa_expedite_decisions + x.pa_decisions + x.pa_overdues + x.pa_expirys + x.covered_submissions, x.appeals, x.appeal_statements + x.appeal_info_requests + x.appeal_decisions + x.appeal_withdrawals + x.appeal_overdues, x.appeal_windows + x.window_closing_notices, x.grants + x.grant_revocations, x.notices, x.records, x.replay_steps, x.distinct_dates, x.distinct_dates_with_replay_log, x.records_after_reference_clock, x.real, x.synthetic].map(String))),
    '',
    'PA steps counts information requests, expedites and their decisions, decisions, overdue times, expiries and covered submissions; appeal steps counts statements (the first is filed with the appeal), information requests, decisions, withdrawals and overdue times; windows counts appeal windows opened and closing notices sent; grants counts grants given and revoked. Per-date counts are in `COVERAGE.json` (`dates`).',
    '',
    '## Household calendar, plan workload and measures',
    '',
    '- Trips (no scheduled care for the travellers; an emergency is seen near the destination): ' + h.trips.map(t => t.from + ' to ' + t.to + ' (' + t.what + ')').join('; ') + '.',
    '- Plan decisions: each busy period has a heavy or light backlog by a seeded draw, and a decision planned in it slips past its due date with the period\'s chance (' + h.plan_backlog.periods.map(p => p.what + ' ' + p.from + ' to ' + p.to + ', ' + p.severity + ', ' + p.chance).join('; ') + '; otherwise ' + h.plan_backlog.usual + '; for PA decisions ' + h.plan_backlog.pa_factor + ' times these), and a decision that waits for requested documents comes some business days after they arrive, so a late provider or household reply can make it overdue. Overdue: PAs ' + (m.pa_decision_days.overdue.join(', ') || 'none') + '; appeals ' + (m.appeal_decision_days.overdue.join(', ') || 'none') + '.',
    '- Grants: ' + h.grants.map(g => g.grant_id + ' ' + g.scope + ' on ' + g.member_id + ' to ' + g.grantee_id + ' from ' + g.created_at + (g.expires_at ? ' until ' + g.expires_at : '') + ', ' + g.status + (g.revoked_at ? ' ' + g.revoked_at : '') + ' (' + g.changed_by + ')').join('; ') + '.',
    '- Answers to information requests (' + MEASURES.answer_days + '): ' + m.answer_days.count + ' answered, ' + m.answer_days.min + ' to ' + m.answer_days.max + ' days, ' + m.answer_days.median + ' at the median; ' + m.answer_days.expired + ' expired unanswered.',
    '- PA decisions (' + MEASURES.pa_decision_days + '): ' + m.pa_decision_days.count + ' decided, ' + m.pa_decision_days.min + ' to ' + m.pa_decision_days.max + ' days, ' + m.pa_decision_days.median + ' at the median.',
    '- Appeal decisions (' + MEASURES.appeal_decision_days + '): ' + m.appeal_decision_days.count + ' decided, ' + m.appeal_decision_days.min + ' to ' + m.appeal_decision_days.max + ' days, ' + m.appeal_decision_days.median + ' at the median; by status ' + Object.entries(m.appeal_decision_days.by_status).map(([s, n]) => n + ' ' + s).join(', ') + '.',
    '- Out of pocket (' + MEASURES.out_of_pocket + '): ' + m.out_of_pocket.map(x => x.member_id + ' ' + x.plan_year + ' deductible ' + x.deductible + ', out of pocket ' + x.out_of_pocket + (x.out_of_pocket_max_reached ? ' (maximum reached)' : '')).join('; ') + '.',
    '',
    table(['PA', 'Member', 'Service', 'Status', 'Submitted', 'Decided', 'Approved', 'Used', 'Steps', 'Appeals'], h.prior_authorizations.map(p => [p.pa_id, p.member_id, p.service_id, p.status + (p.overdue_at ? ' (overdue ' + p.overdue_at + ')' : ''), p.submitted_at, p.decided_at || '—', p.approved ? p.approved.units + ' units, ' + p.approved.valid_from + ' to ' + p.approved.valid_until : '—', String(p.units_used), [...p.info_requests.map(r => 'information requested ' + r.slice(0, 25)), p.expedite ? 'expedite ' + p.expedite : null, ...p.covered_submissions.map(s => 'covered submission ' + s)].filter(Boolean).join('; ') || '—', p.appeals.join('; ') || '—'])),
    '',
    table(['Appeal', 'Member', 'Target', 'Filed (by)', 'Due', 'Status', 'Decided or withdrawn', 'Statements', 'Information requests'], h.appeals.map(a => [a.appeal_id + (a.expedited ? ' (expedited)' : ''), a.member_id, a.target, a.filed_at + ' (' + a.filed_by + ')', a.due_at, a.status + (a.overdue ? ' (overdue)' : ''), a.decided_at || a.withdrawn_at || '—', String(a.statements.length), a.info_requests.join('; ') || '—'])),
    '',
    '## Gaps',
    '',
    ...report.gaps.map(g => g.kind === 'real_data_anchor' ? '- No real health-plan records (' + g.period + ' anchor; ' + g.status + '): ' + g.reason : g.kind === 'mail_history' ? '- No Mail history (' + g.status + '): ' + g.reason : g.kind === 'unused_authorizations' ? '- Authorizations never used (' + g.status + '): ' + g.reason : '- ' + g.from + ' to ' + g.to + ' (' + g.days + ' days without any App record): ' + g.reason),
    '',
    '## Representative records',
    '',
    table(['Example', 'Claim', 'Member', 'Provider', 'Received', 'Status', 'Requests', 'EOBs', 'Appeals'], report.representative.map(r => [r.example, r.claim_id, r.member, r.provider, r.received_at, r.status, r.requests.join('; ') || '—', r.eobs.join(' / ') || '—', r.appeals.join('; ') || '—'])),
    '',
    'Notices of these claims are in `COVERAGE.json` (`representative`).',
    '',
  ];
  if (report.loading) {
    const l = report.loading, last = l.instants[l.instants.length - 1];
    lines.push('## Loading and query demonstration', '', l.interface, '',
      table(['As of', 'Seed ID', 'env.load_seed', 'Core clock', 'Steps applied / withheld', 'Timers committed', 'Claims in selection / listed by the Agent', 'Listed as the grants allow', 'Claim states equal the App reads', 'PAs / appeals / grants listed', 'Latest claim'],
        l.instants.map(x => [x.as_of, '`' + x.seed_id + '`', x.load.status + ', ' + x.load.loaded_objects + ' objects, bundle `' + x.load.bundle_dataset_id + '`, automated checks ' + x.load.automated_checks, x.agent_clock,
          x.steps_applied + ' / ' + x.steps_withheld, String(x.timers_committed), x.claims_in_selection + ' / ' + x.claims_listed_by_agent, x.listed_ids_match_grants ? 'yes' : 'no', x.states_match_app_reads ? 'yes' : 'no', x.pas_listed + ' / ' + x.appeals_listed + ' / ' + x.grants_listed, x.latest_received_at || '—'])),
      '',
      table(['As of', 'EOBs', 'Requests', 'Appeals', 'Notices', 'Monthly read-back equals the selection', 'Open items', 'Open claims, PAs and appeals the Agent sees (equal)', 'Staged events', 'First staged event applied'],
        l.instants.map(x => [x.as_of, x.read_back.eobs, x.read_back.info_requests, x.read_back.appeals, x.read_back.notices, x.monthly_read_back_matches_selection ? 'yes' : 'no', x.open_items.join(', ') || 'none', (x.open_seen_by_agent.join(', ') || 'none') + (x.open_items_match_core ? ' (yes)' : ' (no)'), x.staged_events_available,
          x.first_staged_event ? x.first_staged_event.operation + ' at ' + x.first_staged_event.at + ': ' + x.first_staged_event.status + '; then ' + x.first_staged_event.target_after : '—'].map(String))),
      '', 'Record counts are read back from env.snapshot; the Agent sees the claims of the members the account holder may see at that instant (his own, his minor child\'s as a guardian, and his spouse\'s while she has given him a view or act grant), each through claims.get. The row at ' + (l.instants.find(x => x.timers_committed > 0) || last).as_of + ' cuts one millisecond after an accident question expired with no later step yet: the selection commits that expiry (with the EOB, the denial for missing information and their notices) at its due time, as the App\'s next write would, so the seed and Core\'s reads agree. At ' + last.as_of + ' the whole window is loaded; its monthly read-back (`loading.instants[].monthly_read_back` in `COVERAGE.json`) equals the monthly table above, which `dataset/coverage.cjs` checks.', '');
  }
  return lines.join('\n');
}

async function report({ runtimeDir, files = lib.load() } = {}) {
  const out = compute(files);
  out.loading = await demonstrate(runtimeDir, files);
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const option = (name, fallback) => { const i = argv.lastIndexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
  const runtimeDir = path.resolve(option('--runtime', process.env.PALE_RUNTIME_ROOT || path.join(lib.ROOT, '..', '..', 'runtime')));
  const out = await report({ runtimeDir });
  const end = out.loading.instants[out.loading.instants.length - 1];
  const fresh = { [OUT.json]: lib.pretty(out), [OUT.md]: render(out) };
  const monthlyOk = out.monthly.every(x => Object.keys(end.monthly_read_back[x.month]).every(key => end.monthly_read_back[x.month][key] === x[key]));
  if (!monthlyOk) throw Error('The monthly counts read back through MCP differ from the computed coverage.');
  const failed = out.loading.instants.filter(x => x.load.automated_checks !== 'pass' || !x.listed_ids_match_grants || !x.states_match_app_reads || !x.open_items_match_core || !x.monthly_read_back_matches_selection || x.agent_clock !== x.as_of);
  if (failed.length) throw Error('The loading demonstration failed at ' + failed.map(x => x.as_of).join(', ') + '.');
  if (argv.includes('--check')) {
    const differs = Object.keys(fresh).filter(rel => !fs.existsSync(lib.file(rel)) || fs.readFileSync(lib.file(rel), 'utf8') !== fresh[rel]);
    console.log(differs.length ? 'coverage report differs: ' + differs.join(', ') : 'coverage report is up to date: ' + out.totals.records + ' dated entries, ' + out.distinct_dates.coverage + ' distinct dates (' + out.distinct_dates.global + ' with the replay log), ' + out.earliest + ' to ' + out.latest);
    process.exitCode = differs.length ? 1 : 0;
    return;
  }
  for (const [rel, text] of Object.entries(fresh)) fs.writeFileSync(lib.file(rel), text);
  console.log(JSON.stringify({ records: out.totals.records, replay_steps: out.totals.replay_steps, distinct_dates: out.distinct_dates.coverage, with_replay_log: out.distinct_dates.global, earliest: out.earliest, latest: out.latest }));
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });
module.exports = { compute, render, monthlyOf, visibleTo, measures, OUT, INSTANTS, instantsOf, KINDS, MEASURES, PROPOSAL, timerInstant };
