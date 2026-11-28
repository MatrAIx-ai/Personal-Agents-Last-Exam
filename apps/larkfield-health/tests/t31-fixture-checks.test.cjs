'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { compile } = require('./schema-validator.cjs');
const plugin = require('../plugin.cjs');
const { check, load, BRANDS, NAME_BRANDS, coded } = require('../dev/check-fixture.cjs');
const { authored, simulate, relabel, HISTORY } = require('../dev/generate-history.cjs');

const SEED = require('../fixtures/minimal.json');
const BINDING = require('../fixtures/binding.json');
const seedValid = compile(require('../schemas/seed.schema.json'), path.join(__dirname, '..', 'schemas'));
const find = (list, key, id) => list.find(r => r[key] === id);

test('Fixture the representative fixture passes every content check', () => {
  const { seed, options } = load();
  assert.deepEqual(check(seed, options), []);
});

test('Fixture the checker catches broken references, names, codes, history edits, dates, numbering, pricing and provenance', () => {
  const { seed, options: file } = load();
  const options = { ...file, raw: undefined };
  const has = (problems, text) => assert.ok(problems.some(p => p.includes(text)), 'expected "' + text + '" in ' + JSON.stringify(problems));
  const edit = fn => { const s = structuredClone(seed); fn(s); return check(s, options); };
  const C = (s, id) => find(s.claims, 'claim_id', id);
  has(edit(s => { C(s, 'cl-h1').lines[0].service_id = 'svc-unknown'; }), 'validateSeed: Claim cl-h1 names an unknown service svc-unknown');
  assert.deepEqual(edit(s => { s.providers[3].name = 'UnitedHealthcare Imaging'; }), ['no insurer, health-system, hospital-chain, PBM, pharmacy, lab or drug-brand names and no billing-code system names']);
  for (const name of ['UnitedHealthcare', 'United Health Group', 'Aetna Better Health', 'Cigna', 'Humana', 'Anthem', 'Kaiser Permanente', 'BlueCross BlueShield', 'Blue Shield', 'BCBS', 'Medicare Advantage', 'Optum Rx', 'OptumRx', 'Express-Scripts', 'CVS Caremark', 'Walgreens', "Walgreen's", 'Mayo Clinic', 'Cleveland Clinic', 'HCA', 'Harbor General Hospital', 'Harbor-UCLA', 'Summit Health', 'Quest Diagnostics', 'LabCorp', 'Ozempic', 'Wegovy', 'Humira', 'CPT', 'ICD-10', 'NPI']) assert.ok(BRANDS.test(name), name);
  for (const text of ['Semaglutide 1 mg weekly pen, four-week supply', 'Wrenmoor Community Hospital', 'Cindervale Medical Center', 'Quillmont Imaging Center', 'Primary care office visit', 'Medical Center', 'medical records', 'humane', 'a hospital chain', 'scripts', 'anthemic', 'Larkfield EPO Plan']) assert.ok(!BRANDS.test(text), text);
  for (const name of ['Crestor', 'Crestor 10 mg', 'crestor', 'Zocor', 'Plavix', 'Singulair', 'Synthroid', 'Meijer', 'Giant Eagle', "Sam's Club"]) assert.ok(BRANDS.test(name), name);
  for (const text of ['I10', 'Follow-up for I10', 'E11.9', 'E119', 'S83.511A', 'S83511A', 'M54.5', 'M545', 'J0135', '99213', '3074F', 'Z00.00']) assert.ok(coded(text), text);
  for (const text of ['cl-h10', 'ln-2', 'pv-6', 'n-t82', 'eob-17', 'ir-h9', 'gr-h1', 'svc-er-visit', 'svc-semaglutide-1', 'tok-7c1e', 'larkfield-household-1', 'X-ray, two views', 'MRI of the knee', 'Semaglutide 1 mg weekly pen, four-week supply', 'Larkfield EPO Plan', '2026-11-18', '23:59 Eastern Time', '$155.00']) assert.ok(!coded(text), text);
  has(edit(s => { s.services.find(x => x.service_id === 'svc-lipid-panel').description = 'Cholesterol lab panel for Crestor patients'; }), 'no insurer, health-system, hospital-chain, PBM, pharmacy, lab or drug-brand names');
  for (const description of ['Primary care office visit for I10', 'Primary care office visit, E11.9', 'Primary care office visit, E119']) assert.deepEqual(edit(s => { s.services.find(x => x.service_id === 'svc-office-visit').description = description; }), ['no procedure, supply or diagnosis codes in names, descriptions or texts, and no ten-digit provider numbers anywhere'], description);
  has(edit(s => { s.appeals.find(a => a.appeal_id === 'ap-1').statements[1].text += ' Diagnosis R10.9.'; }), 'no procedure, supply or diagnosis codes in names, descriptions or texts');
  has(edit(s => { s.pas.find(p => p.pa_id === 'pa-3').expedite.reason += ' (S93.401A)'; }), 'no procedure, supply or diagnosis codes in names, descriptions or texts');
  has(edit(s => { s.pas.find(p => p.pa_id === 'pa-3').expedite.reason += ' (97110)'; }), 'no procedure, supply or diagnosis codes in names, descriptions or texts');
  for (const text of ['U07.1', 'M1A.0710', 'C4A.9', 'Z3A.01', 'S93401A']) assert.ok(coded(text), text);
  for (const name of ['Visa', 'Discover card', 'Target Pharmacy', 'Maestro', 'Pay with Visa']) assert.ok(NAME_BRANDS.test(name), name);
  for (const text of ['We did not discover this until the claim arrived.', 'The target date was October 8.', 'a visa appointment', 'discovery', 'targeted therapy']) { assert.ok(!NAME_BRANDS.test(text), text); assert.ok(!BRANDS.test(text), text); }
  for (const text of ['Vitamin B12 level', 'A1C test', 'Hemoglobin A1C', 'H1N1 vaccine', 'Vitamin D3 level', 'G6PD screen', 'T4 and T3 panel']) assert.ok(!coded(text), text);
  for (const text of ['I10', 'E119', 'E11.9', 'S93.401A', 'S93401A', '97110', 'B12 and I10', 'A1C, E11.9']) assert.ok(coded(text), text);
  for (const [where, mutate] of [['provider', s => { s.providers[0].name = 'Target Family Medicine'; }], ['service', s => { s.services[0].description = 'Primary care office visit, Visa accepted'; }], ['plan', s => { s.plan.name = 'Discover EPO Plan'; }]]) has(edit(mutate), 'no insurer, health-system, hospital-chain, PBM, pharmacy, lab or drug-brand names', where);
  const ordinary = edit(s => { s.appeals.find(a => a.appeal_id === 'ap-1').statements[1].text += ' We did not discover this until the claim arrived; the target date was October 8. Target dates moved twice. Discover more in the letter.'; s.services.find(x => x.service_id === 'svc-lab-panel').description = 'Basic metabolic lab panel with vitamin B12 level and A1C test'; });
  assert.ok(!ordinary.some(p => /brand names|diagnosis codes/.test(p)), JSON.stringify(ordinary));
  assert.deepEqual(edit(s => { s.services.find(x => x.service_id === 'svc-knee-mri').description = 'MRI of the knee (73721)'; }), ['no procedure, supply or diagnosis codes in names, descriptions or texts, and no ten-digit provider numbers anywhere']);
  assert.deepEqual(edit(s => { s.notices.find(n => n.notice_id === 'n-h1').body += ' '; }), ['the fixture matches dev/generate-history.cjs byte for byte']);
  has(edit(s => { s.approvals.push({ approval_id: 'cf-1', token: 'tok-7c1e', subject: null, confirmed_by: 'm-1', confirmed_at: '2026-11-18T11:00:00-05:00', used_at: null }); }), 'no approvals');
  has(edit(s => { const g = find(s.grants, 'grant_id', 'gr-h1'); g.created_at = g.created_at.replace('-05:00', '-04:00'); }), 'every time written with the zone offset in force');
  has(edit(s => { find(s.grants, 'grant_id', 'gr-h1').created_at = '2025-01-03T10:00:00-05:00'; }), 'the history opens on 2025-01-01');
  has(edit(s => { find(s.grants, 'grant_id', 'gr-1').created_at = '2026-01-07T10:00:00-05:00'; }), 'the task timeline opens on 2026-01-01');
  has(edit(s => { find(s.grants, 'grant_id', 'gr-1').created_at = '2025-12-31T10:00:00-05:00'; }), 'every task-timeline time and date on or after 2026-01-01');
  has(edit(s => { find(s.notices, 'notice_id', 'n-t1').notice_id = 'n-1'; }), 'seeded notices are outside the runtime notice series');
  const unbound = edit(s => { find(s.grants, 'grant_id', 'gr-1').expires_at = null; });
  has(unbound, 'no gr-2 and no grant of m-2 to m-1 in force at the grant example');
  has(unbound, 'the example step ev-10 does not apply to the fixture: invalid_event Grant gr-1 is already live for m-2 and m-1');
  const viewer = edit(s => { s.grants.push({ grant_id: 'gr-h9', grant_version: 0, member_id: 'm-2', grantor_id: 'm-2', grantee_id: 'm-1', scope: 'view', created_at: '2026-11-10T09:00:00-05:00', expires_at: '2026-12-05T00:00:00-05:00', status: 'active', revoked_at: null }); });
  has(viewer, 'the example events and the expedite request before ev-6 write exactly sixteen run notices, n-1 to n-16');
  has(viewer, 'ev-6\'s entry for m-1 is n-17');
  has(edit(s => { s.issued.n = '3'; }), 'ev-6\'s entry for m-1 is n-17');
  has(edit(s => { s.issued.n = '3'; }), 'the example events and the expedite request before ev-6 write exactly sixteen run notices');
  has(edit(s => { s.claims = s.claims.filter(c => !c.received_at.startsWith('2025-05')); s.eobs = s.eobs.filter(e => s.claims.some(c => c.claim_id === e.claim_id)); s.notices = s.notices.filter(n => n.subject.type !== 'claim' || s.claims.some(c => c.claim_id === n.subject.id)); }), 'a claim is received in every month from 2025-01 to the clock');
  const repriced = edit(s => { const l = find(s.eobs, 'claim_id', 'cl-5').lines[0]; l.coinsurance_cents += 100; l.member_cost_cents += 100; l.plan_paid_cents -= 100; });
  has(repriced, 'EOB eob-4 lines differ from an independent repricing of claim cl-5');
  has(repriced, 'validateSeed:');
  has(edit(s => { find(s.accumulators, 'member_id', 'm-2').oop_cents += 1; }), 'accumulator of m-2 for 2025 differs from the replayed postings');
  has(edit(s => { find(s.pas, 'pa_id', 'pa-3').units_used = 6; }), 'PA pa-3 units used differ from its paid lines');
  has(edit(s => { find(s.members, 'member_id', 'm-3').birth_date = '2006-05-20'; }), 'birth dates fit the household');
  has(edit(s => { find(s.members, 'member_id', 'm-2').birth_date = '2010-09-02'; }), 'services for adults only (semaglutide, the cholesterol panel and knee arthroscopy) are given to adults');
  has(edit(s => { const n = s.notices.findIndex(x => x.notice_id === 'n-h2'); s.notices.splice(n, 1); }), 'every seeded notice went, with its title, to exactly the member, the guardians and the grantees in force at its time');
  has(edit(s => { find(s.pas, 'pa_id', 'pa-5').status = 'withdrawn'; }), 'pa-5 is pending for the withdrawal example');
  has(edit(s => { Object.assign(find(s.pas, 'pa_id', 'pa-5'), { status: 'info_requested', pa_version: 1, info_requests: [{ at: '2026-11-18T09:30:00-05:00', text: 'Notes from the orthopedic consultation' }] }); }), 'pa-5 is pending for the withdrawal example');
  has(edit(s => { find(s.claims, 'claim_id', 'cl-17').claim_id = 'cl-18'; }), 'exactly sixteen task-timeline claims, cl-1 to cl-17 without cl-7');
  has(edit(s => { const r = s.info_requests.find(x => x.status === 'answered' && !HISTORY.test(x.claim_id)); r.answered_at = new Date(Date.parse(r.expires_at) - 86400000).toISOString(); }), 'every answer comes at least two days before its question expires');
  has(edit(s => { const r = s.info_requests.find(x => x.type === 'other_coverage'); s.info_requests.push({ ...r, info_request_id: 'ir-h99', plan_year: r.plan_year + 1 }); }), 'no claim carries other-coverage questions for two plan years');
  has(check(seed, { ...options, walkthrough: options.walkthrough.filter(x => x.event) }), 'examples/walkthrough.json holds the eleven example events and the Agent expedite request between ev-4 and ev-5');
  has(check(seed, { ...options, scenario: { ...options.scenario, at: '2026-11-18T11:00:00-05:00' } }), 'the example claim in examples/scenario.json comes after the fixture clock and is recorded');
  for (const generation of [{ seed: '2024' }, { parameters: { ...file.dataset.sources.find(x => x.source_id === 'generated-history').generation.parameters, routine_visits: '40' } }]) {
    const dataset = structuredClone(file.dataset);
    Object.assign(dataset.sources.find(x => x.source_id === 'generated-history').generation, generation);
    has(check(seed, { ...options, dataset }), 'contribution/dataset.json states the generator, its seed, start, end and routine visits as dev/generate-history.cjs runs them');
  }
  has(check(seed, { ...options, dataset: { ...options.dataset, expected_counts: { records: 1, assets: 0 } } }), 'dataset record count matches');
  has(check(seed, { ...options, bytes: 1024 * 1024 }), 'fixture under 1 MiB');
});

test('Fixture every content rule of the checker has a counterexample it reports', () => {
  const { seed, options: file } = load();
  const options = { ...file, raw: undefined };
  const find2 = (s, list, key, id) => s[list].find(r => r[key] === id);
  const cases = [
    ['the seed does not match its schema', s => { s.claims[0].status = 'paid'; }],
    ['the fixture clock is the shared registry start', null, { clock: { initial_time: '2026-11-18T12:01:00-05:00' } }],
    ['the fixture clock is before the first example event', null, { walkthrough: [{ event: { ...file.walkthrough[0].event, at: '2026-11-18T11:00:00-05:00' } }, ...file.walkthrough.slice(1)] }],
    ['a three-person household', s => { find2(s, 'members', 'member_id', 'm-2').relation = 'other'; }],
    ['every member is in the binding under the same name', null, { binding: { ...file.binding, people: file.binding.people.map(p => (p.person_id === 'm-2' ? { ...p, name: 'C. Hale' } : p)) } }],
    ['the child is a minor with both adults as guardians', s => { find2(s, 'members', 'member_id', 'm-3').guardian_ids = ['m-1']; }],
    ['plan years 2025 to 2027, with every member enrolled in each', s => { find2(s, 'members', 'member_id', 'm-3').enrolled_years = [2025, 2026]; }],
    ['six providers pv-1 to pv-6', s => { s.providers.push({ provider_id: 'pv-7', name: 'Ashvane Clinic', kind: 'clinic', in_network: true }); }],
    ['two out-of-network facilities, pv-2 in network and a prescriber in network', s => { find2(s, 'providers', 'provider_id', 'pv-1').kind = 'clinic'; }],
    ['the binding lists the six providers as shared objects', null, { binding: { ...file.binding, objects: { 'larkfield-health': ['pv-1', 'pv-2', 'pv-3', 'pv-4', 'pv-5'] } } }],
    ['services with fees, among them svc-knee-mri and the PA-listed svc-physical-therapy', s => { s.plan.pa_services.push('svc-knee-mri'); }],
    ['a PA-listed pharmacy service and a pharmacy PA', s => { s.plan.pa_services = s.plan.pa_services.filter(x => x !== 'svc-semaglutide-1'); }],
    ['at least thirty generated history claims', s => { for (const c of s.claims) if (/^cl-h(?:[0-9]|1[0-9]|20)$/.test(c.claim_id)) c.claim_id = c.claim_id.replace('cl-h', 'cl-x'); }],
    ['task-timeline claims received, pending information and processed', s => { find2(s, 'claims', 'claim_id', 'cl-13').status = 'processed'; }],
    ['paid lines with a copay, a deductible and coinsurance', s => { for (const e of s.eobs) for (const l of e.lines) { l.plan_paid_cents += l.coinsurance_cents; l.member_cost_cents -= l.coinsurance_cents; l.coinsurance_cents = 0; } }],
    ['a copay capped at a smaller allowed amount and a coinsurance rounded up from half a cent or more', s => { for (const e of s.eobs) for (const l of e.lines) if (l.coinsurance_cents > 0 && ((l.allowed_cents - l.deductible_cents) * 20) % 100 >= 50) { l.coinsurance_cents -= 1; l.member_cost_cents -= 1; l.plan_paid_cents += 1; } }],
    ['a copay capped at a smaller allowed amount', s => { for (const e of s.eobs) for (const l of e.lines) if (l.copay_cents > 0 && l.copay_cents === l.allowed_cents) { l.allowed_cents += 1; l.plan_paid_cents += 1; l.not_allowed_cents -= 1; } }],
    ['a paid task-timeline emergency, and an emergency paid at an out-of-network hospital', s => { for (const l of find2(s, 'claims', 'claim_id', 'cl-1').lines) l.emergency = false; }],
    ['a task-timeline claim with separate December 31 and January 1 postings', s => { find2(s, 'claims', 'claim_id', 'cl-1').lines[0].service_date = '2025-12-30'; }],
    ['denials for each reason', s => { for (const e of s.eobs) for (const l of e.lines) if (l.reason === 'prior_auth_missing') l.reason = 'out_of_network'; }],
    ['every out-of-network denial is scheduled imaging at an out-of-network facility', s => { find2(s, 'claims', 'claim_id', 'cl-3').lines[0].service_id = 'svc-specialist-visit'; }],
    ['every denial for a missing PA is on a line just outside the dates or units of a PA of that member and service', s => { find2(s, 'claims', 'claim_id', 'cl-14').lines[1].service_date = '2026-10-31'; }],
    ['the history has both question types answered and a question that expired', s => { for (const r of s.info_requests) if (r.status === 'expired' && /-h/.test(r.claim_id)) r.status = 'open'; }],
    ['the task timeline has both question types answered and a question that expired', s => { for (const r of s.info_requests) if (r.status === 'expired' && !/-h/.test(r.claim_id)) r.status = 'open'; }],
    ['an open question at the clock', s => { for (const r of s.info_requests) if (r.status === 'open') r.status = 'expired'; }],
    ['attestations with more than one answer, and 2027 coverage still unknown', s => { find2(s, 'coverage', 'member_id', 'm-1').plan_year = 2027; }],
    ['four PAs pa-1, pa-2, pa-3 and pa-5', s => { find2(s, 'pas', 'pa_id', 'pa-5').pa_id = 'pa-6'; }],
    ['a denied PA, a used and expired PA, an approved expedite and a PA approved after an information request', s => { find2(s, 'pas', 'pa_id', 'pa-3').expedite = null; }],
    ['three appeals: ap-1 upheld, ap-2 overturned, ap-3 under review', s => { find2(s, 'appeals', 'appeal_id', 'ap-1').status = 'overturned'; }],
    ['ap-3 is open on a claim whose denied line is ln-2', s => { find2(s, 'appeals', 'appeal_id', 'ap-3').due_at = '2026-12-09T23:59:00-05:00'; }],
    ['ap-2 has its EOB version 2, and ap-1 had an information request answered by a statement', s => { find2(s, 'appeals', 'appeal_id', 'ap-1').statements.pop(); }],
    ['an appeal filed by an act grantee', s => { find2(s, 'appeals', 'appeal_id', 'ap-2').statements[0].by = 'm-1'; }],
    ['grants of each kind', s => { s.grants = s.grants.filter(g => g.grant_id !== 'gr-h2'); }],
    ['the example events can add cl-7 and pa-4', s => { find2(s, 'claims', 'claim_id', 'cl-17').claim_id = 'cl-7'; }],
    ['no approved PA covers the example submission', s => { Object.assign(find2(s, 'pas', 'pa_id', 'pa-3'), { status: 'approved', expired_at: null, approved: { units: 18, valid_from: '2026-09-08', valid_until: '2027-03-31' } }); }],
    ['the ir counter continues the task timeline', s => { s.issued.ir = '20'; }],
    ['the grant counter is past the task timeline\'s gr-1 and the example\'s gr-2, so a run\'s first grant is gr-3', s => { s.issued.gr = '1'; }],
    ['requests, EOBs and notices belong to records of the same series', s => { find2(s, 'notices', 'notice_id', 'n-h1').subject = { type: 'claim', id: 'cl-2' }; }],
    ['history records name only history IDs', s => { find2(s, 'notices', 'notice_id', 'n-h1').body += ' See cl-3.'; }],
    ['task-timeline records name only task-timeline IDs', s => { find2(s, 'appeals', 'appeal_id', 'ap-1').statements[1].text += ' See cl-h5.'; }],
    ['the earliest time in the fixture is on 2025-01-01', s => { find2(s, 'grants', 'grant_id', 'gr-h1').created_at = '2024-12-31T10:00:00-05:00'; }],
    ['every claim arrives after its services and within a month of each', s => { find2(s, 'claims', 'claim_id', 'cl-h1').lines[0].service_date = '2024-12-20'; }],
    ['no timer is due at or before the fixture clock', null, { clock: { initial_time: '2026-11-20T12:00:00-05:00' } }],
    ['every appeal is filed at least two days before its window closes', s => { s.windows.find(w => w.target.id === 'cl-14').ends_at = '2026-10-30T23:59:00-04:00'; }],
    ['every appeal step comes at least two days before the decision is due', s => { find2(s, 'appeals', 'appeal_id', 'ap-1').decided_at = '2026-04-16T14:00:00-04:00'; }],
    ['every PA step comes at least two days before the decision is due', s => { find2(s, 'pas', 'pa_id', 'pa-1').decided_at = find2(s, 'pas', 'pa_id', 'pa-1').denial_notice_at = '2026-05-25T15:30:00-04:00'; }],
    ['only the withdrawal example pa-5 may run overdue, undecided', s => { Object.assign(find2(s, 'pas', 'pa_id', 'pa-2'), { overdue: true, overdue_at: '2026-08-18T23:59:00-04:00' }); }],
    ['examples/scenario.json is the first example event', null, { scenario: { ...file.scenario, event_id: 'ev-1b' } }],
    ['the walkthrough and the scenario name no deny-listed organisation or brand and carry no billing or diagnosis codes', null, { walkthrough: file.walkthrough.map(x => (x.tool ? { tool: { ...x.tool, arguments: { ...x.tool.arguments, reason: x.tool.arguments.reason + ' Crestor, S93.401A.' } } } : x)) }],
    ['the walkthrough and the scenario name no deny-listed organisation or brand and carry no billing or diagnosis codes', null, { walkthrough: file.walkthrough.map(x => (x.tool ? { tool: { ...x.tool, arguments: { ...x.tool.arguments, reason: x.tool.arguments.reason + ' (97110)' } } } : x)) }],
    ['the walkthrough and the scenario name no deny-listed organisation or brand and carry no billing or diagnosis codes', null, { walkthrough: file.walkthrough.map(x => (x.tool ? { tool: { ...x.tool, arguments: { ...x.tool.arguments, reason: '2026-12-03T11:30:00-05:00: therapy session 97110' } } } : x)) }],
    ['the walkthrough steps run forward in time from the fixture clock', null, { walkthrough: file.walkthrough.map(x => (x.tool ? { tool: { ...x.tool, at: '2026-12-03T09:30:00-05:00' } } : x)) }],
    ['contribution/dataset.json lists the authored and generated-history sources', null, { dataset: { ...file.dataset, sources: file.dataset.sources.filter(x => x.source_id !== 'authored') } }],
    ['the fixture file is the canonical serialisation of the seed', null, { raw: JSON.stringify(seed) }],
  ];
  for (const [text, mutate, over] of cases) {
    const s = structuredClone(seed);
    if (mutate) mutate(s);
    const problems = check(s, { ...options, ...(over || {}) });
    assert.ok(problems.some(p => p.includes(text)), 'expected "' + text + '" in ' + JSON.stringify(problems));
  }
});

test('Fixture the history replay commits only states that pass the App\'s validateSeed and reproduces the fixture', () => {
  let states = 0;
  const sim = simulate(authored(SEED), (state, at) => {
    assert.ok(seedValid(state), 'seed schema at ' + at);
    plugin.validateSeed({ app_id: 'larkfield-health', virtual_now: at, binding: BINDING }, state);
    states++;
  });
  assert.equal(states, sim.steps);
  assert.ok(states >= 100);
  assert.equal(JSON.stringify(relabel(sim)), JSON.stringify(SEED));
});
