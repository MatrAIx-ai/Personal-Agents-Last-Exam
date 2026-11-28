'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const { compile } = require('../tests/schema-validator.cjs');
const plugin = require('../plugin.cjs');
const sender = require('../infra/sender.cjs');
const { dueTimers } = require('../src/timers.cjs');
const { TITLES } = require('../src/notices.cjs');
const { ms, toIso, localDate, endOfDay, DAY } = require('../src/time.cjs');
const { WIRE } = require('../tests/walkthrough.cjs');
const { build, GRANTS_ISSUED, HISTORY, TIMELINE_NOTICE, LIVE_ID, SEED, FROM, TASK_FROM, ROUTINE_TO, routineVisits } = require('./generate-history.cjs');

const APP = 'larkfield-health', P = APP + '.';
const SEP = "[\\s.&'’/-]*";
const NAMES = [
  'united health', 'unitedhealth', 'aetna', 'cigna', 'evernorth', 'humana', 'elevance', 'centene', 'ambetter', 'wellcare', 'molina', 'kaiser', 'blue cross', 'blue shield', 'blue care', 'highmark', 'regence', 'premera',
  'carefirst', 'florida blue', 'oscar health', 'bright health', 'clover health', 'harvard pilgrim', 'tufts health', 'emblem health', 'health partners', 'priority health', 'wellmark', 'excellus', 'independence blue', 'horizon blue', 'geisinger', 'tricare', 'medicare', 'medicaid',
  'optum', 'express scripts', 'caremark', 'prime therapeutics', 'medimpact', 'navitus', 'elixir rx', 'accredo', 'cvs', 'walgreen', 'wal mart', 'rite aid', 'kroger', 'costco', 'publix', 'safeway', 'albertsons', 'duane reade',
  'pillpack', 'amazon pharmacy', 'good rx', 'hca health', 'tenet health', 'common spirit', 'trinity health', 'providence health', 'advocate health', 'advocate aurora', 'atrium health', 'sutter health', 'intermountain', 'mayo clinic', 'cleveland clinic', 'johns hopkins', 'mass general', 'mount sinai',
  'nyu langone', 'cedars sinai', 'banner health', 'baylor scott', 'northwell', 'ochsner', 'sanford health', 'spectrum health', 'corewell', 'henry ford health', 'hackensack', 'rwj barnabas', 'novant', 'wellstar', 'piedmont health', 'prisma health', 'advent health', 'orlando health',
  'baptist health', 'memorial hermann', 'texas health resources', 'christus health', 'summit health', 'riverside health', 'harbor ucla', 'harbor general', 'community health systems', 'lifepoint', 'universal health services', 'steward health', 'dignity health', 'bon secours', 'allina', 'essentia', 'avera', 'mercy health',
  'beaumont health', 'penn medicine', 'quest diagnostics', 'lab corp', 'radnet', 'simonmed', 'akumin', 'concentra', 'city md', 'minute clinic', 'one medical', 'teladoc', 'amwell', 'ozempic', 'wegovy', 'rybelsus', 'mounjaro', 'zepbound',
  'trulicity', 'victoza', 'saxenda', 'humira', 'enbrel', 'remicade', 'stelara', 'skyrizi', 'dupixent', 'lipitor', 'synthroid', 'eliquis', 'xarelto', 'jardiance', 'farxiga', 'januvia', 'aricept', 'adlarity',
  'coumadin', 'jantoven', 'zestril', 'prinivil', 'qbrelis', 'levoxyl', 'unithroid', 'euthyrox', 'tirosint', 'levothroid', 'thyquidity', 'ermeza', 'zoloft', 'prilosec', 'glucophage', 'fortamet', 'glumetza', 'riomet',
  'norvasc', 'katerzia', 'norliqva', 'pro air', 'ventolin', 'proventil', 'accuneb', 'amoxil', 'moxatag', 'singulair', 'zegerid', 'atorvaliq', 'konvomep', 'meijer', 'hy vee', 'giant eagle', "sam'?s club", 'bcbs',
  'silverscript', 'master card', 'american express', 'amex', 'jcb', 'union pay', 'diners club',
];
const WORDS = [
  'uhc', 'bcbs', 'anthem', 'medica', 'upmc', 'hca', 'sutter', 'ascension', 'providence', 'optumrx', 'cpt', 'hcpcs', 'icd', 'npi', 'tylenol', 'advil', 'motrin', 'aleve',
  'keflex', 'augmentin', 'zithromax', 'amoxil', 'flonase', 'zyrtec', 'claritin', 'levo-t', 'crestor', 'zocor', 'pravachol', 'livalo', 'zetia', 'vytorin',
  'plavix', 'brilinta', 'pradaxa', 'lovenox', 'entresto', 'lasix', 'toprol', 'lopressor', 'tenormin', 'coreg', 'diovan', 'cozaar', 'hyzaar', 'benicar', 'micardis', 'avapro', 'atacand', 'altace',
  'vasotec', 'lotensin', 'accupril', 'cardizem', 'procardia', 'janumet', 'invokana', 'lantus', 'levemir', 'tresiba', 'humalog', 'novolog', 'glucotrol', 'amaryl', 'actos', 'lexapro', 'celexa', 'prozac',
  'paxil', 'wellbutrin', 'effexor', 'cymbalta', 'xanax', 'ativan', 'klonopin', 'valium', 'ambien', 'adderall', 'ritalin', 'concerta', 'vyvanse', 'seroquel', 'abilify', 'risperdal', 'zyprexa', 'lamictal',
  'depakote', 'keppra', 'topamax', 'neurontin', 'lyrica', 'namenda', 'ultram', 'norco', 'vicodin', 'percocet', 'oxycontin', 'celebrex', 'mobic', 'imitrex', 'nexium', 'protonix', 'pepcid', 'zantac',
  'allegra', 'advair', 'symbicort', 'spiriva', 'flovent', 'qvar', 'breo', 'trelegy', 'cipro', 'levaquin', 'bactrim', 'valtrex', 'tamiflu', 'viagra', 'cialis', 'flomax', 'proscar', 'avodart',
  'premarin', 'fosamax', 'otezla',
];
const BRANDS = new RegExp('\\b(?:' + NAMES.map(n => n.split(' ').join(SEP)).join('|') + ')|\\b(?:' + WORDS.join('|') + ')\\b', 'i');
const NAME_BRANDS = /\b(?:Visa|Discover|Maestro|Target)\b/;
const CODES = [/\b\d{5}\b/g, /\b\d{4}[FT]\b/g, /\b[A-V]\d{4}\b/g, /\b[A-Z]\d[0-9A-Z](?:\.?[0-9A-Z]{1,4})?\b/g];
const LAB_TERMS = new Set(['B12', 'A1C', 'H1N1', 'H3N2', 'H5N1', 'G6PD', 'A1AT', 'H2O', 'D3', 'B6', 'T3', 'T4']);
const coded = text => CODES.some(re => [...text.matchAll(re)].some(m => !LAB_TERMS.has(m[0].toUpperCase())));
const NPI = /\b\d{10}\b/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const H_ID = /\b(?:cl|ir|eob|ap|gr|pa|n)-h\d+\b/;
const T_NOTICE = /\bn-t\d+\b/;
const MIB = 1024 * 1024;
const REGISTRY_START = '2026-11-18T12:00:00-05:00';
const PLAN_YEARS = ['2025', '2026', '2027'];
const AGES = { 'svc-semaglutide-1': 18, 'svc-lipid-panel': 18, 'svc-arthroscopy': 18 };
const TIMELINE_CLAIMS = ['cl-1', 'cl-2', 'cl-3', 'cl-4', 'cl-5', 'cl-6', 'cl-8', 'cl-9', 'cl-10', 'cl-11', 'cl-12', 'cl-13', 'cl-14', 'cl-15', 'cl-16', 'cl-17'];

function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach(v => strings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach(v => strings(v, out));
  return out;
}

const half = (cents, pct) => Math.floor((cents * pct + 50) / 100);
const byDate = (a, b) => (a.service_date < b.service_date ? -1 : a.service_date > b.service_date ? 1 : a.position - b.position);

function expectedPricing(seed) {
  const problems = [];
  const services = new Map(seed.services.map(s => [s.service_id, s])), providers = new Map(seed.providers.map(p => [p.provider_id, p]));
  const claims = new Map(seed.claims.map(c => [c.claim_id, c])), cov = new Map(seed.coverage.map(c => [c.member_id + ':' + c.plan_year, c]));
  const book = new Map(), cell = (m, y) => { if (!book.has(m + ':' + y)) book.set(m + ':' + y, { deductible_cents: 0, oop_cents: 0 }); return book.get(m + ':' + y); };
  const family = y => seed.members.filter(m => m.enrolled_years.includes(Number(y))).reduce((f, m) => ({ deductible_cents: f.deductible_cents + cell(m.member_id, y).deductible_cents, oop_cents: f.oop_cents + cell(m.member_id, y).oop_cents }), { deductible_cents: 0, oop_cents: 0 });
  const used = new Map(), current = new Map();
  const denied = (l, reason) => ({ line_id: l.line_id, status: 'denied', reason, allowed_cents: 0, copay_cents: 0, deductible_cents: 0, coinsurance_cents: 0, member_cost_cents: 0, plan_paid_cents: 0, not_allowed_cents: l.billed_cents, pa_id: null, pa_units: 0 });
  function priced(c, l, pa) {
    const y = l.service_date.slice(0, 4), plan = seed.plan.years[y], service = services.get(l.service_id), allowed = Math.min(l.billed_cents, service.fee_cents * l.units);
    const me = cell(c.member_id, y), fam = family(y), flat = plan.copays[service.category];
    let copay = flat === undefined ? 0 : Math.min(flat, allowed);
    let ded = flat === undefined ? Math.min(allowed, Math.max(0, plan.deductible.individual_cents - me.deductible_cents), Math.max(0, plan.deductible.family_cents - fam.deductible_cents)) : 0;
    let coins = flat === undefined ? half(allowed - ded, plan.coinsurance_pct) : 0;
    let room = Math.min(Math.max(0, plan.oop_max.individual_cents - me.oop_cents), Math.max(0, plan.oop_max.family_cents - fam.oop_cents));
    copay = Math.min(copay, room); room -= copay; ded = Math.min(ded, room); room -= ded; coins = Math.min(coins, room);
    const cost = copay + ded + coins;
    me.deductible_cents += ded; me.oop_cents += cost;
    return { line_id: l.line_id, status: 'paid', reason: null, allowed_cents: allowed, copay_cents: copay, deductible_cents: ded, coinsurance_cents: coins, member_cost_cents: cost, plan_paid_cents: allowed - cost, not_allowed_cents: l.billed_cents - allowed, pa_id: pa ? pa.pa_id : null, pa_units: pa ? l.units : 0 };
  }
  const approvedBefore = (p, e) => { const d = ms(p.decided_at), i = ms(e.issued_at); return d < i || (d === i && BigInt(p.approved_after_post) < BigInt(e.posting_seq)); };
  for (const p of seed.pas.filter(x => x.approved !== null)) for (const e of seed.eobs) if (ms(p.decided_at) !== ms(e.issued_at) && (BigInt(p.approved_after_post) < BigInt(e.posting_seq)) !== (ms(p.decided_at) < ms(e.issued_at))) problems.push('PA ' + p.pa_id + ' approval mark disagrees with its decision time against EOB ' + e.eob_id);
  for (const e of [...seed.eobs].sort((a, b) => Number(a.posting_seq) - Number(b.posting_seq))) {
    const c = claims.get(e.claim_id);
    if (!c) { problems.push('EOB ' + e.eob_id + ' names an unknown claim'); continue; }
    const years = [...new Set(c.lines.map(l => l.service_date.slice(0, 4)))].sort();
    const snapshot = Object.fromEntries(years.map(y => [y, { member: { ...cell(c.member_id, y) }, family: family(y) }]));
    if (JSON.stringify(snapshot) !== JSON.stringify(Object.fromEntries(years.map(y => [y, e.ledger_before[y] && { member: { deductible_cents: e.ledger_before[y].member.deductible_cents, oop_cents: e.ledger_before[y].member.oop_cents }, family: { deductible_cents: e.ledger_before[y].family.deductible_cents, oop_cents: e.ledger_before[y].family.oop_cents } }])))) problems.push('EOB ' + e.eob_id + ' ledger before posting differs from a replay of the earlier postings');
    const before = Object.fromEntries(years.map(y => [y, { ...cell(c.member_id, y) }]));
    const lines = new Map(), prev = current.get(c.claim_id);
    if (e.version === 1) {
      const requests = seed.info_requests.filter(r => r.claim_id === c.claim_id);
      for (const l of [...c.lines].sort(byDate)) {
        const y = l.service_date.slice(0, 4), cv = cov.get(c.member_id + ':' + y);
        const standing = cv && cv.attested_at !== null && ms(cv.attested_at) < ms(c.review_at) ? cv.status : 'unknown';
        const mine = requests.filter(r => r.line_id === l.line_id);
        if (standing === 'other_primary' || mine.some(r => r.answer === 'other_primary' || r.answer === 'work_related')) { lines.set(l.line_id, denied(l, 'other_party_liable')); continue; }
        if (mine.some(r => r.status === 'expired')) { lines.set(l.line_id, denied(l, 'missing_information')); continue; }
        if (!l.emergency && !providers.get(c.provider_id).in_network) { lines.set(l.line_id, denied(l, 'out_of_network')); continue; }
        let pa = null;
        if (!l.emergency && seed.plan.pa_services.includes(l.service_id)) {
          const fits = seed.pas.filter(p => p.member_id === c.member_id && p.service_id === l.service_id && p.approved !== null && approvedBefore(p, e) && p.approved.valid_from <= l.service_date && l.service_date <= p.approved.valid_until && p.approved.units - (used.get(p.pa_id) || 0) >= l.units);
          pa = fits.sort((a, b) => (a.approved.valid_until + '|' + a.pa_id < b.approved.valid_until + '|' + b.pa_id ? -1 : 1))[0] || null;
          if (!pa) { lines.set(l.line_id, denied(l, 'prior_auth_missing')); continue; }
          used.set(pa.pa_id, (used.get(pa.pa_id) || 0) + l.units);
        }
        lines.set(l.line_id, priced(c, l, pa));
      }
    } else {
      const appeal = seed.appeals.find(a => a.appeal_id === e.appeal_id), named = appeal && appeal.outcome ? appeal.outcome.lines : [];
      for (const y of years) Object.assign(cell(c.member_id, y), before[y]);
      for (const l of [...c.lines].sort(byDate)) lines.set(l.line_id, named.includes(l.line_id) ? priced(c, l, null) : structuredClone(prev.lines.find(x => x.line_id === l.line_id)));
    }
    const want = c.lines.map(l => lines.get(l.line_id));
    const postings = years.map(y => { const mine = c.lines.filter(l => l.service_date.slice(0, 4) === y).map(l => lines.get(l.line_id)); return { member_id: c.member_id, plan_year: Number(y), deductible_cents: mine.reduce((s, l) => s + l.deductible_cents, 0), oop_cents: mine.reduce((s, l) => s + l.member_cost_cents, 0) }; });
    if (JSON.stringify(e.lines) !== JSON.stringify(want)) problems.push('EOB ' + e.eob_id + ' lines differ from an independent repricing of claim ' + c.claim_id);
    if (JSON.stringify(e.postings) !== JSON.stringify(postings)) problems.push('EOB ' + e.eob_id + ' postings differ from the sums of its repriced lines');
    if (e.version > 1) for (const p of postings) {
      const was = prev.postings.find(x => x.plan_year === p.plan_year), me = cell(c.member_id, String(p.plan_year));
      me.deductible_cents = before[String(p.plan_year)].deductible_cents + p.deductible_cents - was.deductible_cents;
      me.oop_cents = before[String(p.plan_year)].oop_cents + p.oop_cents - was.oop_cents;
    }
    current.set(c.claim_id, { lines: want, postings });
  }
  for (const a of seed.accumulators) { const c = cell(a.member_id, String(a.plan_year)); if (a.deductible_cents !== c.deductible_cents || a.oop_cents !== c.oop_cents) problems.push('accumulator of ' + a.member_id + ' for ' + a.plan_year + ' differs from the replayed postings'); }
  for (const p of seed.pas) { const u = [...current.values()].flatMap(x => x.lines).filter(l => l.pa_id === p.pa_id).reduce((s, l) => s + l.pa_units, 0); if (p.units_used !== u) problems.push('PA ' + p.pa_id + ' units used differ from its paid lines'); }
  return problems;
}

function recipientsAt(seed, memberId, at) {
  const t = ms(at), m = seed.members.find(x => x.member_id === memberId);
  const out = new Set([memberId, ...(m ? m.guardian_ids : [])]);
  for (const g of seed.grants) if (g.member_id === memberId && ms(g.created_at) <= t && (g.revoked_at === null || t < ms(g.revoked_at)) && (g.expires_at === null || t < ms(g.expires_at))) out.add(g.grantee_id);
  return [...out].sort();
}

function replay(seed, ctx, steps) {
  let state = structuredClone(seed), revision = 0;
  const out = [];
  for (const s of steps) {
    const before = state.notices.length, name = s.event ? s.event.event_id : s.tool.name;
    try {
      if (s.event) state = plugin.applyEvent({ ...ctx, run_id: 'check', role: 'infra', virtual_now: s.event.at }, state, structuredClone(s.event));
      else state = plugin.handleTool({ ...ctx, run_id: 'check', role: 'agent', virtual_now: s.tool.at }, state, s.tool.name, { request_id: 'check-' + (++revision), expected_version: { epoch: 1, revision }, ...s.tool.arguments }).data;
    } catch (e) { return { out, failed: 'the example step ' + name + ' does not apply to the fixture: ' + (e.code || 'error') + ' ' + e.message }; }
    out.push({ step: s, notices: state.notices.slice(before), state });
  }
  return { out, failed: null };
}

function check(seed, { clock, binding, scenario, walkthrough, spec, dataset, bytes, raw }) {
  const problems = [];
  const expect = (ok, message) => { if (!ok) problems.push(message); };
  const guard = (name, fn) => { try { fn(); } catch (e) { problems.push('the ' + name + ' checks could not run: ' + e.message); } };
  const seedValid = compile(require('../schemas/seed.schema.json'), path.join(root, 'schemas'));
  const now = clock.initial_time, t = ms(now);
  const ctx = { app_id: APP, virtual_now: now, binding };
  expect(seedValid(seed), 'the seed does not match its schema');
  try { plugin.validateSeed(ctx, seed); } catch (e) { problems.push('validateSeed: ' + e.message); }
  const by = (list, key, id) => (seed[list] || []).find(r => r[key] === id) || null;
  const claim = id => by('claims', 'claim_id', id), member = id => by('members', 'member_id', id);
  const history = id => HISTORY.test(id);
  const v1 = id => seed.eobs.find(e => e.claim_id === id && e.version === 1) || null;

  const canonical = JSON.stringify(seed, null, 2) + '\n';
  let built = null;
  try { built = build(seed).out; } catch (e) { problems.push('dev/generate-history.cjs fails on this fixture: ' + e.message); }
  expect(built !== null && JSON.stringify(built, null, 2) + '\n' === canonical, 'the fixture matches dev/generate-history.cjs byte for byte');
  if (raw !== undefined) expect(raw === canonical, 'the fixture file is the canonical serialisation of the seed');

  expect(now === REGISTRY_START, 'the fixture clock is the shared registry start ' + REGISTRY_START);
  const first = walkthrough.find(s => s.event);
  expect(first && t < ms(first.event.at), 'the fixture clock is before the first example event');
  expect(seed.approvals.length === 0, 'no approvals');
  expect(bytes < MIB, 'fixture under 1 MiB');
  const all = strings(seed);
  const titles = [seed.plan.name, ...seed.members.map(m => m.name), ...seed.providers.map(p => p.name), ...seed.services.map(x => x.description)];
  expect(!all.some(s => BRANDS.test(s)) && !titles.some(s => NAME_BRANDS.test(s)), 'no insurer, health-system, hospital-chain, PBM, pharmacy, lab or drug-brand names and no billing-code system names');
  const named = [seed.plan.name, ...seed.providers.map(p => p.name), ...seed.services.map(s => s.description), ...seed.pas.flatMap(p => [...p.info_requests.map(r => r.text), ...(p.expedite && p.expedite.reason ? [p.expedite.reason] : [])]), ...seed.appeals.flatMap(a => [...a.statements, ...a.info_requests].map(x => x.text))];
  expect(!named.some(coded) && !all.some(s => NPI.test(s)), 'no procedure, supply or diagnosis codes in names, descriptions or texts, and no ten-digit provider numbers anywhere');

  const people = new Map(binding.people.map(p => [p.person_id, p.name]));
  const [m1, m2, m3] = ['m-1', 'm-2', 'm-3'].map(member);
  expect(seed.members.length === 3 && m1 && m2 && m3 && m1.relation === 'self' && m2.relation === 'spouse' && m3.relation === 'child' && seed.owner_person_id === 'm-1' && seed.account_id === 'larkfield-m-1', 'a three-person household: the subscriber m-1 (account holder), the spouse m-2 and the child m-3');
  expect(seed.members.every(m => people.get(m.member_id) === m.name), 'every member is in the binding under the same name');
  expect(m3 && m3.is_minor && JSON.stringify(m3.guardian_ids) === JSON.stringify(['m-1', 'm-2']) && m1 && !m1.is_minor && m2 && !m2.is_minor, 'the child is a minor with both adults as guardians');
  const ageOn = (m, day) => Number(day.slice(0, 4)) - Number(m.birth_date.slice(0, 4)) - (day.slice(5) < m.birth_date.slice(5) ? 1 : 0);
  expect(m1 && m2 && m3 && ageOn(m1, FROM) >= 18 && ageOn(m2, FROM) >= 18 && ageOn(m3, '2027-12-31') < 18 && ageOn(m3, FROM) >= 5 && ageOn(m1, m3.birth_date) >= 18 && ageOn(m2, m3.birth_date) >= 18, 'birth dates fit the household: two adults throughout, a school-age child who stays a minor through 2027, born when both adults were adults');
  expect(seed.members.every(m => JSON.stringify(m.enrolled_years) === JSON.stringify([2025, 2026, 2027])) && JSON.stringify(Object.keys(seed.plan.years)) === JSON.stringify(PLAN_YEARS), 'plan years 2025 to 2027, with every member enrolled in each');
  const ages = [...seed.claims.flatMap(c => c.lines.map(l => [c.member_id, l.service_id, l.service_date])), ...seed.pas.map(p => [p.member_id, p.service_id, localDate(ms(p.submitted_at))])];
  expect(ages.every(([m, s, d]) => AGES[s] === undefined || (member(m) && ageOn(member(m), d) >= AGES[s])), 'services for adults only (semaglutide, the cholesterol panel and knee arthroscopy) are given to adults');
  expect(seed.providers.length === 6 && JSON.stringify(seed.providers.map(p => p.provider_id)) === JSON.stringify(['pv-1', 'pv-2', 'pv-3', 'pv-4', 'pv-5', 'pv-6']), 'six providers pv-1 to pv-6');
  const oon = seed.providers.filter(p => !p.in_network);
  expect(oon.length === 2 && oon.every(p => ['imaging', 'hospital'].includes(p.kind)) && by('providers', 'provider_id', 'pv-2')?.in_network === true && seed.providers.some(p => ['prescriber', 'pharmacy'].includes(p.kind) && p.in_network), 'two out-of-network facilities, pv-2 in network and a prescriber in network');
  expect(JSON.stringify((binding.objects || {})[APP]) === JSON.stringify(seed.providers.map(p => p.provider_id)), 'the binding lists the six providers as shared objects');
  const svc = id => by('services', 'service_id', id);
  expect(svc('svc-knee-mri') && svc('svc-physical-therapy') && seed.plan.pa_services.includes('svc-physical-therapy') && !seed.plan.pa_services.includes('svc-knee-mri') && seed.services.every(s => Number.isInteger(s.fee_cents) && s.fee_cents > 0), 'services with fees, among them svc-knee-mri and the PA-listed svc-physical-therapy');
  expect(seed.plan.pa_services.some(id => svc(id)?.category === 'pharmacy') && seed.pas.some(p => svc(p.service_id)?.category === 'pharmacy'), 'a PA-listed pharmacy service and a pharmacy PA');

  const timeline = seed.claims.filter(c => !history(c.claim_id)), hist = seed.claims.filter(c => history(c.claim_id));
  expect(JSON.stringify(timeline.map(c => c.claim_id)) === JSON.stringify(TIMELINE_CLAIMS), 'exactly sixteen task-timeline claims, cl-1 to cl-17 without cl-7');
  expect(hist.length >= 30, 'at least thirty generated history claims');
  expect(['received', 'pending_info', 'processed'].every(s => timeline.some(c => c.status === s)), 'task-timeline claims received, pending information and processed');
  const paid = seed.eobs.flatMap(e => e.lines).filter(l => l.status === 'paid');
  expect(paid.some(l => l.copay_cents > 0) && paid.some(l => l.deductible_cents > 0) && paid.some(l => l.coinsurance_cents > 0), 'paid lines with a copay, a deductible and coinsurance');
  expect(paid.some(l => l.copay_cents > 0 && l.copay_cents === l.allowed_cents) && paid.some(l => l.coinsurance_cents > 0 && ((l.allowed_cents - l.deductible_cents) * 20) % 100 >= 50 && l.coinsurance_cents === half(l.allowed_cents - l.deductible_cents, 20)), 'a copay capped at a smaller allowed amount and a coinsurance rounded up from half a cent or more');
  const lineOf = (c, id) => c.lines.find(l => l.line_id === id);
  const emergency = seed.eobs.filter(e => { const c = claim(e.claim_id); return c && e.lines.some(l => l.status === 'paid' && lineOf(c, l.line_id).emergency); }).map(e => claim(e.claim_id));
  expect(emergency.some(c => !history(c.claim_id)) && emergency.some(c => !by('providers', 'provider_id', c.provider_id).in_network), 'a paid task-timeline emergency, and an emergency paid at an out-of-network hospital');
  const boundary = seed.eobs.find(e => { const c = claim(e.claim_id); return c && c.lines.some(l => l.service_date.endsWith('-12-31')) && c.lines.some(l => l.service_date.endsWith('-01-01')) && e.postings.length === 2 && e.postings.every(p => p.oop_cents > 0); });
  expect(boundary && !history(boundary.claim_id), 'a task-timeline claim with separate December 31 and January 1 postings');
  const reasons = new Set(seed.eobs.flatMap(e => e.lines).map(l => l.reason));
  expect(['out_of_network', 'prior_auth_missing', 'other_party_liable', 'missing_information'].every(r => reasons.has(r)), 'denials for each reason: out of network, no PA, another party liable and missing information');
  const deniedFor = reason => seed.eobs.filter(e => e.version === 1).flatMap(e => e.lines.filter(l => l.reason === reason).map(l => [claim(e.claim_id), l.line_id])).filter(([c]) => c).map(([c, id]) => [c, lineOf(c, id)]);
  expect(deniedFor('out_of_network').every(([c, l]) => svc(l.service_id)?.category === 'imaging' && !l.emergency), 'every out-of-network denial is scheduled imaging at an out-of-network facility');
  expect(deniedFor('prior_auth_missing').every(([c, l]) => seed.pas.some(p => p.member_id === c.member_id && p.service_id === l.service_id && p.approved !== null && (l.service_date > p.approved.valid_until ? ms(l.service_date + 'T12:00:00Z') - ms(p.approved.valid_until + 'T12:00:00Z') <= 14 * DAY : l.service_date < p.approved.valid_from ? ms(p.approved.valid_from + 'T12:00:00Z') - ms(l.service_date + 'T12:00:00Z') <= 14 * DAY : p.units_used === p.approved.units))), 'every denial for a missing PA is on a line just outside the dates or units of a PA of that member and service');
  const kinds = (list, status) => new Set(list.filter(r => r.status === status).map(r => r.type));
  for (const [label, list] of [['history', seed.info_requests.filter(r => history(r.claim_id))], ['task timeline', seed.info_requests.filter(r => !history(r.claim_id))]]) expect(kinds(list, 'answered').size === 2 && kinds(list, 'expired').size >= 1 && kinds(list, 'answered').has('accident'), 'the ' + label + ' has both question types answered and a question that expired');
  expect(seed.info_requests.some(r => r.status === 'open' && !history(r.claim_id)), 'an open question at the clock');
  const cobYears = new Map();
  for (const r of seed.info_requests.filter(x => x.type === 'other_coverage')) { if (!cobYears.has(r.claim_id)) cobYears.set(r.claim_id, new Set()); cobYears.get(r.claim_id).add(r.plan_year); }
  expect([...cobYears.values()].every(s => s.size === 1), 'no claim carries other-coverage questions for two plan years, so no attestation instant can complete two such claims');
  expect(new Set(seed.coverage.filter(c => c.status !== 'unknown').map(c => c.status)).size >= 2 && seed.coverage.filter(c => c.plan_year === 2027).every(c => c.status === 'unknown'), 'attestations with more than one answer, and 2027 coverage still unknown');

  expect(JSON.stringify(seed.pas.map(p => p.pa_id)) === JSON.stringify(['pa-1', 'pa-2', 'pa-3', 'pa-5']), 'four PAs pa-1, pa-2, pa-3 and pa-5');
  const pa = id => by('pas', 'pa_id', id);
  expect(pa('pa-5') && pa('pa-5').status === 'pending' && pa('pa-5').member_id === 'm-2', 'pa-5 is pending for the withdrawal example');
  expect(seed.pas.some(p => p.status === 'denied') && seed.pas.some(p => p.status === 'expired' && p.units_used > 0) && seed.pas.some(p => p.expedite && p.expedite.status === 'approved') && seed.pas.some(p => p.info_requests.length && p.approved !== null), 'a denied PA, a used and expired PA, an approved expedite and a PA approved after an information request');
  const [ap1, ap2, ap3] = ['ap-1', 'ap-2', 'ap-3'].map(id => by('appeals', 'appeal_id', id));
  expect(seed.appeals.length === 3 && ap1?.status === 'upheld' && ap2?.status === 'overturned' && ap3?.status === 'under_review', 'three appeals: ap-1 upheld, ap-2 overturned, ap-3 under review');
  expect(ap3 && ap3.target.type === 'claim' && JSON.stringify(ap3.lines) === JSON.stringify(['ln-2']) && v1(ap3.target.id)?.lines.find(l => l.line_id === 'ln-2')?.status === 'denied' && ms(ap3.due_at) > ms('2026-12-08T09:00:00-05:00') + 2 * DAY, 'ap-3 is open on a claim whose denied line is ln-2, due well after the example decision');
  expect(ap2 && seed.eobs.some(e => e.appeal_id === 'ap-2' && e.version === 2) && ap1 && ap1.info_requests.length && ap1.statements.length >= 2, 'ap-2 has its EOB version 2, and ap-1 had an information request answered by a statement');
  expect(seed.appeals.some(a => a.statements[0].by !== a.member_id && !member(a.member_id).guardian_ids.includes(a.statements[0].by)), 'an appeal filed by an act grantee');

  const live = g => g.status === 'active' && ms(g.created_at) <= t && (g.expires_at === null || t < ms(g.expires_at));
  expect(['view', 'act'].every(s => seed.grants.some(g => g.scope === s)) && seed.grants.some(g => g.status === 'revoked') && seed.grants.some(g => g.status === 'active' && g.expires_at !== null && ms(g.expires_at) <= t) && seed.grants.some(g => live(g) && g.expires_at !== null) && seed.grants.some(g => g.expires_at === null), 'grants of each kind: view and act, open-ended and expiring, one revoked, one expired and one in force with a future expiry');
  const pairFree = ms('2026-12-08T10:00:00-05:00');
  expect(!by('grants', 'grant_id', 'gr-2') && !seed.grants.some(g => g.member_id === 'm-2' && g.grantee_id === 'm-1' && g.status === 'active' && ms(g.created_at) <= pairFree && (g.expires_at === null || pairFree < ms(g.expires_at))), 'no gr-2 and no grant of m-2 to m-1 in force at the grant example');
  expect(!claim('cl-7') && !pa('pa-4') && !seed.pas.some(p => p.covered_submissions.some(s => s.pa_id === 'pa-4')), 'the example events can add cl-7 and pa-4');
  expect(!seed.pas.some(p => p.member_id === 'm-3' && p.service_id === 'svc-physical-therapy' && p.status === 'approved' && endOfDay(p.approved.valid_until) > ms('2026-12-01T10:00:00-05:00') && p.approved.valid_from <= '2026-12-01' && '2027-02-28' <= p.approved.valid_until && p.approved.units - p.units_used >= 12), 'no approved PA covers the example submission');

  for (const prefix of ['ir', 'eob', 'ap']) {
    const list = { ir: seed.info_requests.map(r => r.info_request_id), eob: seed.eobs.map(e => e.eob_id), ap: seed.appeals.map(a => a.appeal_id) }[prefix].filter(id => !history(id));
    expect(String(list.length) === (seed.issued[prefix] ?? '0') && list.every(id => Number(id.slice(prefix.length + 1)) <= list.length), 'the ' + prefix + ' counter continues the task timeline');
  }
  const tNotices = seed.notices.filter(n => TIMELINE_NOTICE.test(n.notice_id)).map(n => Number(n.notice_id.slice(3))).sort((a, b) => a - b);
  expect(seed.issued.gr === GRANTS_ISSUED && seed.grants.every(g => history(g.grant_id) || Number(g.grant_id.slice(3)) <= Number(GRANTS_ISSUED)), 'the grant counter is past the task timeline\'s gr-1 and the example\'s gr-2, so a run\'s first grant is gr-3');
  expect(!('n' in seed.issued) && !('cf' in seed.issued) && seed.notices.every(n => history(n.notice_id) || TIMELINE_NOTICE.test(n.notice_id)) && tNotices.every((k, i) => k === i + 1), 'seeded notices are outside the runtime notice series (n-h for history, n-t1 onward for the task timeline), so the first notice of a run is n-1');
  const subjectSeries = n => (n.subject.type === 'claim' ? n.subject.id : n.subject.type === 'info_request' ? (by('info_requests', 'info_request_id', n.subject.id) || {}).claim_id : n.subject.type === 'appeal' ? (by('appeals', 'appeal_id', n.subject.id) || { target: {} }).target.id : n.subject.id) || '';
  expect(seed.info_requests.every(r => history(r.info_request_id) === history(r.claim_id)) && seed.eobs.every(e => history(e.eob_id) === history(e.claim_id)) && seed.notices.every(n => history(n.notice_id) === history(subjectSeries(n))), 'requests, EOBs and notices belong to records of the same series');
  const ID_KEYS = { claims: 'claim_id', info_requests: 'info_request_id', eobs: 'eob_id', pas: 'pa_id', appeals: 'appeal_id', grants: 'grant_id', notices: 'notice_id' };
  const historyRecords = Object.entries(ID_KEYS).flatMap(([list, key]) => seed[list].filter(r => history(r[key])));
  const timelineRecords = Object.entries(ID_KEYS).flatMap(([list, key]) => seed[list].filter(r => !history(r[key])));
  expect(strings(historyRecords).every(s => !(s.match(LIVE_ID) || []).length && !T_NOTICE.test(s) && !/\b(?:cl|pa|gr)-\d+\b/.test(s)), 'history records name only history IDs');
  expect(strings(timelineRecords).every(s => !H_ID.test(s)), 'task-timeline records name only task-timeline IDs');

  const instants = all.filter(s => ISO.test(s)).sort((a, b) => ms(a) - ms(b));
  expect(instants.length && localDate(ms(instants[0])) === FROM, 'the earliest time in the fixture is on ' + FROM);
  expect(instants.every(s => s.slice(-6) === toIso(ms(s)).slice(-6)), 'every time written with the zone offset in force');
  const stamps = records => strings(records).filter(s => ISO.test(s)).map(s => localDate(ms(s))).sort();
  expect(stamps(historyRecords)[0] === FROM, 'the history opens on ' + FROM);
  expect(stamps(timelineRecords)[0] === TASK_FROM, 'the task timeline opens on ' + TASK_FROM);
  const tDates = timelineRecords.flatMap(r => (r.lines && r.claim_id && !r.eob_id ? strings({ ...r, lines: r.lines.map(l => ({ ...l, service_date: null })) }) : strings(r))).filter(s => ISO.test(s) || DATE.test(s)).map(s => (DATE.test(s) ? s : localDate(ms(s))));
  expect(tDates.every(d => d >= TASK_FROM), 'every task-timeline time and date on or after ' + TASK_FROM + ' (a claim line may report a service before its receipt)');
  expect(seed.claims.every(c => c.lines.every(l => localDate(ms(c.received_at)) > l.service_date && ms(c.received_at) - ms(l.service_date + 'T12:00:00Z') < 31 * DAY)), 'every claim arrives after its services and within a month of each');
  guard('timer', () => expect(dueTimers(structuredClone(seed), now).length === 0, 'no timer is due at or before the fixture clock'));
  const months = [];
  for (let m = FROM.slice(0, 7); m <= localDate(t).slice(0, 7); m = m.slice(5) === '12' ? (Number(m.slice(0, 4)) + 1) + '-01' : m.slice(0, 5) + String(Number(m.slice(5)) + 1).padStart(2, '0')) months.push(m);
  const busy = new Set(seed.claims.map(c => localDate(ms(c.received_at)).slice(0, 7)));
  expect(months.every(m => busy.has(m)), 'a claim is received in every month from ' + FROM.slice(0, 7) + ' to the clock');

  const slack = (at, deadline) => ms(deadline) - ms(at) >= 2 * DAY;
  expect(seed.info_requests.every(r => r.status !== 'answered' || slack(r.answered_at, r.expires_at)), 'every answer comes at least two days before its question expires');
  expect(seed.appeals.every(a => { const w = seed.windows.find(x => x.target.type === a.target.type && x.target.id === a.target.id); return w && slack(a.filed_at, w.ends_at); }), 'every appeal is filed at least two days before its window closes');
  expect(seed.appeals.every(a => [...a.statements.slice(1), ...a.info_requests].every(x => slack(x.at, a.due_at)) && (a.decided_at === null || slack(a.decided_at, a.due_at))), 'every appeal step comes at least two days before the decision is due');
  expect(seed.pas.every(p => [...p.info_requests.map(r => r.at), ...(p.expedite ? [p.expedite.requested_at, p.expedite.decided_at] : []), ...(p.decided_at ? [p.decided_at] : [])].every(x => x === null || slack(x, p.due_at))), 'every PA step comes at least two days before the decision is due');
  expect(seed.pas.filter(p => p.overdue).every(p => p.pa_id === 'pa-5' && p.decided_at === null), 'only the withdrawal example pa-5 may run overdue, undecided');

  guard('pricing', () => { for (const p of expectedPricing(seed)) problems.push(p); });
  guard('notice', () => {
    const groups = new Map();
    for (const n of seed.notices) { const k = n.kind + '|' + n.subject.type + ':' + n.subject.id + '|' + n.at; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(n); }
    const bad = [];
    for (const [k, list] of groups) {
      const want = recipientsAt(seed, list[0].member_id, list[0].at);
      if (JSON.stringify(list.map(n => n.recipient_id)) !== JSON.stringify(want) || list.some(n => n.title !== TITLES[n.kind] || n.member_id !== list[0].member_id)) bad.push(k);
    }
    expect(bad.length === 0, 'every seeded notice went, with its title, to exactly the member, the guardians and the grantees in force at its time' + (bad.length ? ': ' + bad.slice(0, 3).join(', ') : ''));
  });

  const events = walkthrough.filter(s => s.event).map(s => s.event), tools = walkthrough.filter(s => s.tool);
  expect(JSON.stringify(events) === JSON.stringify(spec.envelopes) && tools.length === 1 && tools[0].tool.name === P + 'pa.request_expedite' && walkthrough.indexOf(tools[0]) === 4, 'examples/walkthrough.json holds the eleven example events and the Agent expedite request between ev-4 and ev-5');
  expect(JSON.stringify(scenario) === JSON.stringify(spec.envelopes[0]), 'examples/scenario.json is the first example event');
  const stepTexts = strings([walkthrough, scenario]);
  expect(!stepTexts.some(x => BRANDS.test(x)) && !stepTexts.some(x => coded(x) && !ISO.test(x)) && !stepTexts.some(x => NPI.test(x)), 'the walkthrough and the scenario name no deny-listed organisation or brand and carry no billing or diagnosis codes');
  const times = walkthrough.map(x => ms(x.event ? x.event.at : x.tool ? x.tool.at : NaN));
  expect(times.every((x, i) => Number.isFinite(x) && x >= (i ? times[i - 1] : t)), 'the walkthrough steps run forward in time from the fixture clock');
  guard('walkthrough', () => {
    const { out: runs, failed } = replay(seed, ctx, walkthrough);
    expect(failed === null, failed);
    if (runs.length < 7) return;
    const before = runs.slice(0, 7).flatMap(r => r.notices), decision = runs[6].notices;
    expect(JSON.stringify(before.slice(0, 16).map(n => n.notice_id)) === JSON.stringify(Array.from({ length: 16 }, (_, i) => 'n-' + (i + 1))) && runs.slice(0, 6).flatMap(r => r.notices).length === 16, 'the example events and the expedite request before ev-6 write exactly sixteen run notices, n-1 to n-16');
    const entry = decision.find(n => n.recipient_id === 'm-1');
    expect(entry && entry.notice_id === 'n-17' && JSON.stringify(sender.message({ epoch: 2, data: runs[6].state }, entry)) === WIRE, 'ev-6\'s entry for m-1 is n-17 and builds, at epoch 2, the proposal\'s wire example e2-n-17 byte for byte');
  });
  let recorded = false;
  try { recorded = plugin.applyEvent({ ...ctx, run_id: 'check', role: 'infra', virtual_now: scenario.at }, structuredClone(seed), structuredClone(scenario)).claims.some(c => c.claim_id === scenario.payload.claim_id); } catch { recorded = false; }
  expect(ms(scenario.at) >= t && recorded, 'the example claim in examples/scenario.json comes after the fixture clock and is recorded');

  const sources = new Map(dataset.sources.map(s => [s.source_id, s]));
  expect(JSON.stringify(dataset.sources.map(s => s.source_id)) === JSON.stringify(['authored', 'generated-history', 'delivery-dataset']) && ['authored', 'generated-history'].every(id => sources.get(id).kind === 'synthetic' && dataset.record_source_ids.includes(id)) && sources.get('delivery-dataset').kind === 'synthetic', 'contribution/dataset.json lists the authored and generated-history sources');
  const generation = sources.get('generated-history')?.generation;
  expect(generation && generation.tool === 'dev/generate-history.cjs' && generation.method === 'script' && generation.seed === String(SEED) && JSON.stringify(generation.parameters) === JSON.stringify({ from: FROM, to: now, routine_until: ROUTINE_TO, routine_visits: String(routineVisits().length), seed: String(SEED) }), 'contribution/dataset.json states the generator, its seed, start, end and routine visits as dev/generate-history.cjs runs them');
  expect(dataset.expected_counts.records === plugin.records(seed).length, 'dataset record count matches');
  return problems;
}

function load() {
  const read = rel => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
  return {
    seed: read('fixtures/minimal.json'),
    options: {
      clock: read('fixtures/clock.json'), binding: read('fixtures/binding.json'), scenario: read('examples/scenario.json'), walkthrough: read('examples/walkthrough.json'), spec: read('tests/spec-events.json'),
      dataset: read('contribution/dataset.json'), bytes: fs.statSync(path.join(root, 'fixtures/minimal.json')).size, raw: fs.readFileSync(path.join(root, 'fixtures/minimal.json'), 'utf8'),
    },
  };
}

if (require.main === module) {
  const { seed, options } = load();
  const problems = check(seed, options);
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
  const split = (list, key) => list.filter(r => HISTORY.test(r[key])).length + ' history, ' + list.filter(r => !HISTORY.test(r[key])).length + ' task timeline';
  console.log('fixture ok: ' + seed.claims.length + ' claims (' + split(seed.claims, 'claim_id') + '), ' + seed.eobs.length + ' EOBs, ' + seed.pas.length + ' PAs, ' + seed.appeals.length + ' appeals, ' + seed.grants.length + ' grants, ' + seed.notices.length + ' notices (' + split(seed.notices, 'notice_id') + '), ' + options.bytes + ' bytes');
}
module.exports = { check, load, BRANDS, NAME_BRANDS, CODES, LAB_TERMS, coded, expectedPricing, recipientsAt, replay, WIRE };
