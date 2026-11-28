'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const { compile } = require('../tests/schema-validator.cjs');
const plugin = require('../plugin.cjs');
const { eligibleOn } = require('../src/plans.cjs');
const { dueTimers } = require('../src/timers.cjs');
const { cardUsable } = require('../src/payment.cjs');
const { ms, toIso, localDate, isOpen, rxExpiry } = require('../src/time.cjs');
const { build, HISTORY, TIMELINE_NOTICE, LIVE_ID, SEED, FROM, TASK_FROM, REGIMENS } = require('./generate-history.cjs');

const APP = 'mendwell-pharmacy';
const SEP = "[\\s.&'\u2019/-]*";
const NAMES = [
  'lipitor', 'aricept', 'adlarity', 'coumadin', 'jantoven', 'zestril', 'prinivil', 'qbrelis', 'synthroid', 'levoxyl', 'unithroid', 'euthyrox', 'tirosint', 'levothroid', 'thyquidity', 'ermeza',
  'zoloft', 'prilosec', 'glucophage', 'fortamet', 'glumetza', 'riomet', 'norvasc', 'katerzia', 'norliqva', 'pro air', 'ventolin', 'proventil', 'accuneb', 'amoxil', 'moxatag', 'singulair', 'zegerid', 'atorvaliq', 'konvomep',
  'cvs', 'walgreen', 'wal mart', 'rite aid', 'kroger', 'costco', 'publix', 'duane reade', 'safeway', 'albertsons', 'meijer', 'hy vee', 'giant eagle', 'pillpack', 'amazon pharmacy', "sam'?s club",
  'express scripts', 'optum', 'caremark', 'cigna', 'evernorth', 'aetna', 'humana', 'united health', 'elevance', 'centene', 'wellcare', 'molina', 'tricare', 'highmark', 'navitus', 'medimpact', 'prime therapeutics',
  'blue cross', 'blue shield', 'bcbs', 'silverscript', 'kaiser', 'medicare', 'medicaid', 'good rx', 'master card', 'american express', 'amex', 'jcb', 'union pay', 'diners club',
];
const WORDS = [
  'levo-t', 'anthem',
  'crestor', 'zocor', 'pravachol', 'livalo', 'zetia', 'vytorin', 'plavix', 'brilinta', 'eliquis', 'xarelto', 'pradaxa', 'lovenox', 'entresto', 'lasix', 'toprol', 'lopressor', 'tenormin', 'coreg', 'diovan', 'cozaar', 'hyzaar', 'benicar', 'micardis', 'avapro', 'atacand', 'altace', 'vasotec', 'lotensin', 'accupril', 'cardizem', 'procardia',
  'januvia', 'janumet', 'jardiance', 'farxiga', 'invokana', 'ozempic', 'wegovy', 'rybelsus', 'mounjaro', 'zepbound', 'trulicity', 'victoza', 'lantus', 'levemir', 'tresiba', 'humalog', 'novolog', 'glucotrol', 'amaryl', 'actos',
  'lexapro', 'celexa', 'prozac', 'paxil', 'wellbutrin', 'effexor', 'cymbalta', 'xanax', 'ativan', 'klonopin', 'valium', 'ambien', 'adderall', 'ritalin', 'concerta', 'vyvanse', 'seroquel', 'abilify', 'risperdal', 'zyprexa', 'lamictal', 'depakote', 'keppra', 'topamax', 'neurontin', 'lyrica', 'namenda',
  'ultram', 'norco', 'vicodin', 'percocet', 'oxycontin', 'motrin', 'advil', 'aleve', 'tylenol', 'celebrex', 'mobic', 'imitrex',
  'nexium', 'protonix', 'pepcid', 'zantac', 'claritin', 'zyrtec', 'allegra', 'flonase', 'advair', 'symbicort', 'spiriva', 'flovent', 'qvar', 'breo', 'trelegy',
  'augmentin', 'zithromax', 'cipro', 'levaquin', 'keflex', 'bactrim', 'valtrex', 'tamiflu', 'viagra', 'cialis', 'flomax', 'proscar', 'avodart', 'premarin', 'fosamax', 'humira', 'enbrel', 'dupixent', 'stelara', 'otezla',
];
const BRANDS = new RegExp('\\b(?:' + NAMES.map(n => n.split(' ').join(SEP)).join('|') + ')|\\b(?:' + WORDS.join('|') + ')\\b', 'i');
const NAME_BRANDS = /\b(?:Visa|Discover|Maestro|Target)\b/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const H_COUNTER = /\b(?:f|cl|pr|rn|au|ch|rf|n)-h\d+\b/;
const MIB = 1024 * 1024;
const PUBLISHER = 'DailyMed, U.S. National Library of Medicine';
const LABEL_LICENSE = 'Public U.S. drug labeling; cited, not redistributed';
const STATES = ['requested', 'waiting_stock', 'claim_rejected', 'pending_plan_decision', 'ready', 'collected', 'returned_to_stock', 'cancelled'];
const REGISTRY_START = '2026-11-18T12:00:00-05:00';
const FIRST_EXAMPLE = '2026-12-01T09:00:00-05:00';
const COUNTERS = { f: 'fills', cl: 'claims', pr: 'plan_requests', rn: 'renewals', au: 'authorizations', ch: 'charges' };
const T_NOTICE = /\bn-t\d+\b/;
const SAME_VISIT = 15 * 60000;
const LABEL_AGES = { 'd-albuterol-90': [4, null], 'd-montelukast-4': [2, 5] }, LAST_EXAMPLE_DAY = '2026-12-06';
const EXAMPLE = [
  ['2026-12-01T09:00:00-05:00', 'rx.received', { rx_id: 'rx-9', patient_id: 'p-4', prescriber_id: 'dr-2', drug_id: 'd-atorvastatin-40', quantity: 30, fills_authorized: 3, written_on: '2026-12-01' }],
  ['2026-12-02T11:00:00-05:00', 'renewal.replied', { renewal_id: 'rn-2', decision: 'approved', rx: { rx_id: 'rx-10', quantity: 30, fills_authorized: 5, written_on: '2026-12-02' } }],
  ['2026-12-04T10:00:00-05:00', 'plan.decided', { plan_request_id: 'pr-12', decision: 'approved' }],
  ['2026-12-04T12:00:00-05:00', 'grant.changed', { grant_id: 'g-3', patient_id: 'p-4', grantor_id: 'p-4', grantee_id: 'p-2', scope: 'pickup', fill_id: 'f-15', expires_at: null, status: 'active' }],
  ['2026-12-05T09:00:00-05:00', 'fill.hold_placed', { fill_id: 'f-15', note: 'Interaction flag: confirm with the prescriber' }],
  ['2026-12-05T13:00:00-05:00', 'fill.hold_released', { fill_id: 'f-15', note: 'Prescriber confirmed the dose' }],
  ['2026-12-06T08:00:00-05:00', 'store.restocked', { store_id: 'st-2', drug_id: 'd-atorvastatin-40' }],
];
const ID_KEYS = { fills: 'fill_id', claims: 'claim_id', plan_requests: 'plan_request_id', renewals: 'renewal_id', authorizations: 'authorization_id', charges: 'charge_id', notices: 'notice_id', grants: 'grant_id', prescriptions: 'rx_id' };

function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach(v => strings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach(v => strings(v, out));
  return out;
}

function check(seed, { clock, binding, scenario, dataset, bytes, raw }) {
  const problems = [];
  const expect = (ok, message) => { if (!ok) problems.push(message); };
  const guard = (name, fn) => { try { fn(); } catch (e) { problems.push('the ' + name + ' checks could not run: ' + e.message); } };
  const seedValid = compile(require('../schemas/seed.schema.json'), path.join(root, 'schemas'));
  const now = clock.initial_time, t = ms(now);
  const ctx = { app_id: APP, virtual_now: now, binding };
  expect(seedValid(seed), 'the seed does not match its schema');
  try { plugin.validateSeed(ctx, seed); } catch (e) { problems.push('validateSeed: ' + e.message); }
  const by = (list, key, id) => (seed[list] || []).find(r => r[key] === id) || null;
  const fill = id => by('fills', 'fill_id', id), rxOf = f => by('prescriptions', 'rx_id', f.rx_id), person = id => by('people', 'person_id', id);
  const history = id => HISTORY.test(id);

  const canonical = JSON.stringify(seed, null, 2) + '\n';
  let built = null;
  try { built = build(seed).out; } catch (e) { problems.push('dev/generate-history.cjs fails on this fixture: ' + e.message); }
  expect(built !== null && JSON.stringify(built, null, 2) + '\n' === canonical, 'the fixture matches dev/generate-history.cjs byte for byte');
  if (raw !== undefined) expect(raw === canonical, 'the fixture file is the canonical serialisation of the seed');

  expect(now === REGISTRY_START, 'the fixture clock is the shared registry start ' + REGISTRY_START);
  expect(t < ms(FIRST_EXAMPLE), 'the fixture clock is before the first example event');
  expect(seed.approvals.length === 0, 'no approvals');
  expect(bytes < MIB, 'fixture under 1 MiB');
  const all = strings(seed);
  const titles = [...seed.plans.map(p => p.name), ...seed.people.map(p => p.name), ...seed.prescribers.map(p => p.name), ...seed.stores.flatMap(x => [x.name, x.address]), ...seed.cards.map(c => c.label), ...seed.drugs.flatMap(d => [d.generic_name, d.strength, d.form])];
  expect(!all.some(s => BRANDS.test(s)) && !titles.some(s => NAME_BRANDS.test(s)), 'no brand, chain, insurer or card-network names');

  const self = seed.people.find(p => p.relation === 'self');
  const spouse = seed.people.find(p => p.relation === 'spouse'), child = seed.people.find(p => p.relation === 'child'), parent = seed.people.find(p => p.relation === 'parent');
  expect(seed.people.length === 4 && self && spouse && child && parent && self.person_id === seed.owner_person_id, 'a four-person household: account holder, spouse, child and parent');
  expect(child && child.is_minor && [...child.guardian_ids].sort().join() === [spouse?.person_id, self?.person_id].sort().join(), 'the child is a minor with both parents as guardians');
  expect(seed.people.filter(p => p.is_minor).length === 1 && parent && !parent.is_minor && parent.plan_id !== self?.plan_id, 'the parent is an adult on her own drug plan');
  const today = localDate(t), age = p => Number(today.slice(0, 4)) - Number(p.birth_date.slice(0, 4)) - (today.slice(5) < p.birth_date.slice(5) ? 1 : 0);
  expect(self && spouse && child && parent && age(self) >= 18 && age(spouse) >= 18 && age(child) < 18 && age(parent) >= 65 && age(parent) - age(self) >= 18, 'birth dates fit the household: two adults, a child under 18 and a parent of 65 or more, a generation older than the account holder');
  const ageOn = (p, day) => Number(day.slice(0, 4)) - Number(p.birth_date.slice(0, 4)) - (day.slice(5) < p.birth_date.slice(5) ? 1 : 0);
  expect(seed.prescriptions.every(rx => { const range = LABEL_AGES[rx.drug_id], p = person(rx.patient_id); return !range || !p || (ageOn(p, rx.written_on) >= range[0] && (range[1] === null || ageOn(p, LAST_EXAMPLE_DAY) <= range[1])); }), 'patients fit the ages of the cited labels: albuterol from 4 years on the day it is written, montelukast 4 mg from 2 to 5 years through ' + LAST_EXAMPLE_DAY);
  expect(seed.drugs.length === 12 && seed.drugs.every(d => d.facts.length >= 2), 'twelve drugs with at least two cited facts each');
  expect(seed.plans.length === 2 && seed.plans.every(p => seed.drugs.every(d => p.rules[d.drug_id])), 'two drug plans, each with a rule for every drug');
  const rules = seed.plans.flatMap(p => Object.values(p.rules));
  expect(rules.some(r => !r.covered) && rules.some(r => r.prior_auth_required) && rules.some(r => r.covered && r.copay_cents === 0) && seed.plans.some(p => seed.drugs.some(d => p.rules[d.drug_id].max_quantity !== null && d.quantities.some(q => q > p.rules[d.drug_id].max_quantity))), 'plan rules include not covered, prior authorization, a zero copay and a quantity limit');
  const timelineRx = seed.prescriptions.filter(r => !history(r.rx_id));
  expect(timelineRx.length === 12 && new Set(timelineRx.map(r => r.drug_id)).size === 12, 'twelve task-timeline prescriptions, one for each drug');
  expect(seed.stores.length === 3 && new Set(seed.stores.map(s => JSON.stringify(s.hours))).size === 3 && seed.stores.some(s => new Set(s.hours.map(h => h.day)).size < 7), 'three stores with different hours, one closed on a weekday');
  const usable = c => cardUsable(c, t);
  const ended = c => c.exp_year * 12 + c.exp_month < Number(localDate(t).slice(0, 4)) * 12 + Number(localDate(t).slice(5, 7));
  expect(seed.cards.length === 4, 'four cards');
  expect(seed.cards.some(c => c.owner_id === self?.person_id && usable(c)), 'a usable card of the account holder');
  expect(seed.cards.some(c => c.status === 'declined' && !ended(c)), 'a declined card');
  expect(seed.cards.some(c => c.status === 'active' && ended(c)), 'an expired card');
  expect(seed.cards.some(c => c.owner_id !== self?.person_id), 'another owner\'s card');
  const live = g => g.status === 'active' && (g.expires_at === null || ms(g.expires_at) > t);
  expect(['view', 'refill'].every(scope => seed.grants.some(g => g.scope === scope && live(g))) && seed.grants.some(g => g.scope === 'pickup' && g.fill_id === null && live(g)) && seed.grants.some(g => g.scope === 'pickup' && g.fill_id !== null && live(g)), 'grants in force of each kind: view, refill, patient-wide pickup and fill-limited pickup');
  expect(seed.grants.some(g => g.status === 'revoked') && seed.grants.some(g => g.status === 'active' && g.expires_at !== null && ms(g.expires_at) <= t) && seed.grants.some(g => g.status === 'active' && g.expires_at !== null && ms(g.expires_at) > t) && seed.grants.some(g => g.grantor_id !== g.patient_id), 'a revoked grant, an expired grant, a grant with a future expiry and a grant given by a guardian');
  expect(STATES.every(s => seed.fills.some(f => f.state === s)), 'fills in every state');
  expect(seed.fills.some(f => f.hold !== null) && seed.fills.some(f => f.hold === null && f.notes.length > 0), 'a fill on hold and a fill whose hold was released');
  const historyFills = seed.fills.filter(f => history(f.fill_id)), timelineFills = seed.fills.filter(f => !history(f.fill_id));
  expect(historyFills.length >= 100, 'at least a hundred generated history fills');
  expect(timelineFills.length >= 15, 'at least fifteen task-timeline fills');
  expect(['pending', 'approved', 'denied', 'withdrawn'].every(s => seed.plan_requests.some(r => r.state === s)) && ['refill_too_soon', 'prior_auth_required'].every(x => seed.plan_requests.some(r => r.reason === x)), 'plan requests pending, approved, denied and withdrawn, for both reasons');
  expect(seed.renewals.some(r => r.state === 'approved') && seed.renewals.some(r => r.state === 'pending'), 'an approved and a pending renewal');
  expect(seed.fills.some(f => f.cash) && seed.fills.some(f => f.state === 'collected' && f.amount_due_cents === 0) && seed.charges.some(c => c.method === 'capture') && seed.charges.some(c => c.method === 'counter') && seed.authorizations.some(a => a.state === 'live'), 'a cash fill, a zero-due collection, a captured prepayment, a counter charge and a live prepayment');
  expect(['payment_failed', 'store_closed'].every(r => seed.fills.some(f => f.refusals.some(x => x.reason === r))), 'collection refusals for a failed payment and a closed store');
  expect(seed.fills.some(f => f.cancellation && f.cancellation.stage === 'ready') && seed.fills.some(f => f.timeline.some(e => e.state === 'waiting_stock') && f.state === 'collected'), 'a fill cancelled when ready and a fill that waited for stock');

  for (const [prefix, list] of Object.entries(COUNTERS)) expect((seed.issued[prefix] || 0) === seed[list].filter(r => !history(r[ID_KEYS[list]])).length, 'the ' + prefix + ' counter continues the task timeline');
  const tNotices = seed.notices.filter(n => TIMELINE_NOTICE.test(n.notice_id)).map(n => Number(n.notice_id.slice(3))).sort((a, b) => a - b);
  expect(!('n' in seed.issued) && seed.notices.every(n => history(n.notice_id) || TIMELINE_NOTICE.test(n.notice_id)) && tNotices.every((k, i) => k === i + 1), 'seeded notices are outside the runtime notice series (n-h for history, n-t1 onward for the task timeline), so the first notice of a run is n-1');
  expect((seed.issued.rf || 0) === seed.fills.flatMap(f => f.refusals).filter(r => !history(r.refusal_id)).length, 'the rf counter continues the task timeline');
  expect((seed.issued.g || 0) === seed.grants.filter(g => !history(g.grant_id)).length, 'the g counter continues the task timeline');
  const sameSeries = (a, b) => history(a) === history(b);
  const owned = [['claims', 'claim_id'], ['plan_requests', 'plan_request_id'], ['authorizations', 'authorization_id'], ['charges', 'charge_id']].flatMap(([list, key]) => seed[list].map(r => [r[key], r.fill_id]));
  expect(owned.every(([id, f]) => sameSeries(id, f)) && seed.fills.every(f => f.refusals.every(r => sameSeries(r.refusal_id, f.fill_id))), 'claims, plan requests, payments and refusals belong to fills of the same series');
  expect(seed.notices.every(n => n.subject.type === 'notice' || sameSeries(n.notice_id, n.subject.id)), 'notices belong to records of the same series');
  const texts = list => list.flatMap(r => strings(r));
  const historyRecords = Object.entries(ID_KEYS).flatMap(([list, key]) => seed[list].filter(r => history(r[key])));
  const timelineRecords = Object.entries(ID_KEYS).flatMap(([list, key]) => seed[list].filter(r => !history(r[key])));
  expect(texts(historyRecords).every(s => !(s.match(LIVE_ID) || []).length && !T_NOTICE.test(s)), 'history records name only history IDs');
  expect(texts(timelineRecords).every(s => !H_COUNTER.test(s)), 'task-timeline records name only task-timeline IDs');

  const sources = new Map(dataset.sources.map(s => [s.source_id, s]));
  const labels = dataset.sources.filter(s => s.kind === 'reused');
  const cited = new Set();
  for (const d of seed.drugs) for (const f of d.facts) {
    const s = f.source;
    if (!s) { problems.push('a fact of ' + d.drug_id + ' has no source'); continue; }
    const source = labels.find(x => x.uri === s.url);
    let setid = null;
    try { const url = new URL(s.url); setid = url.hostname === 'dailymed.nlm.nih.gov' ? url.searchParams.get('setid') : null; } catch { setid = null; }
    const ok = source && s.publisher === PUBLISHER && setid === s.set_id && source.description.includes(s.publisher) && source.description.includes('set ID ' + s.set_id) && source.description.includes('version ' + s.version + ')') && source.description.includes(d.generic_name) && source.description.includes(d.drug_id) && dataset.record_source_ids.includes(source.source_id);
    expect(ok, 'the fact source of ' + d.drug_id + ' (' + s.section + ') matches its label in contribution/dataset.json');
    expect(source && source.description.includes('section "' + s.section + '" as "' + f.text + '"'), 'the fact of ' + d.drug_id + ' cited to section ' + s.section + ' is the reviewed paraphrase of that section recorded in contribution/dataset.json');
    if (source) cited.add(source.source_id);
  }
  for (const d of seed.drugs) {
    const source = labels.find(x => x.uri === d.facts[0]?.source?.url);
    const recorded = source ? [...source.description.matchAll(/section "([^"]*)" as "([^"]*)"/g)].map(m => m[1] + '\n' + m[2]).sort() : [];
    const shipped = d.facts.map(f => (f.source ? f.source.section : '') + '\n' + f.text).sort();
    expect(source && source.description.includes('Its ' + d.facts.length + ' facts') && JSON.stringify(recorded) === JSON.stringify(shipped), 'the facts of ' + d.drug_id + ' are exactly the reviewed (section, text) pairs recorded in contribution/dataset.json, each as often as recorded');
  }
  expect(labels.length === seed.drugs.length && labels.every(s => cited.has(s.source_id)), 'every label source in contribution/dataset.json is cited by a fact');
  expect(labels.every(s => s.usage === 'permitted' && s.license === LABEL_LICENSE && s.collection === null && s.generation === null), 'every label source in contribution/dataset.json is reused under the label terms: ' + LABEL_LICENSE);
  expect(['authored', 'generated-history'].every(id => sources.has(id) && sources.get(id).kind === 'synthetic' && dataset.record_source_ids.includes(id)), 'contribution/dataset.json lists the authored and generated-history sources');
  const generation = sources.get('generated-history')?.generation;
  expect(generation && generation.tool === 'dev/generate-history.cjs' && generation.seed === String(SEED) && JSON.stringify(generation.parameters) === JSON.stringify({ from: FROM, to: now, regimens: String(REGIMENS.length), seed: String(SEED) }), 'contribution/dataset.json states the generator, its seed, start, end and regimen count as dev/generate-history.cjs runs them');
  expect(dataset.expected_counts.records === plugin.records(seed).length, 'dataset record count matches');

  const instants = all.filter(s => ISO.test(s)).sort((a, b) => ms(a) - ms(b));
  expect(instants.length && localDate(ms(instants[0])) === FROM, 'the earliest time in the fixture is on ' + FROM);
  expect(all.filter(s => ISO.test(s)).every(s => s.slice(-6) === toIso(ms(s)).slice(-6)), 'every time written with the zone offset in force');
  const dates = records => strings(records).filter(s => ISO.test(s) || DATE.test(s)).map(s => (DATE.test(s) ? s : localDate(ms(s)))).sort();
  const historyDates = dates(historyRecords), timelineDates = dates(timelineRecords);
  expect(historyDates[0] === FROM, 'the history opens on ' + FROM);
  expect(timelineDates[0] === TASK_FROM, 'the task timeline opens on ' + TASK_FROM);
  expect(timelineDates.every(d => d >= TASK_FROM), 'every task-timeline date on or after ' + TASK_FROM);
  guard('timer', () => expect(dueTimers(structuredClone(seed), now).length === 0, 'no timer is due at or before the fixture clock'));

  guard('refill window', () => { for (const c of seed.claims) {
    const f = fill(c.fill_id);
    if (!f) continue;
    const rx = rxOf(f), plan = rx && person(rx.patient_id)?.plan_id ? by('plans', 'plan_id', person(rx.patient_id).plan_id) : null, rule = plan ? plan.rules[rx.drug_id] : null;
    if (!rule || (c.result === 'rejected' && c.reason !== 'refill_too_soon')) continue;
    const waived = seed.plan_requests.some(r => r.fill_id === f.fill_id && r.reason === 'refill_too_soon' && r.state === 'approved' && ms(r.closed_at) <= ms(c.at));
    const eligible = waived ? null : eligibleOn(seed, rx.patient_id, rx.drug_id, rule.refill_days, c.at), day = localDate(ms(c.at));
    if (c.result === 'paid') expect(eligible === null || day >= eligible, 'claim ' + c.claim_id + ' was paid inside the refill window of an earlier collection');
    else expect(eligible !== null && day < eligible && c.eligible_on === eligible, 'claim ' + c.claim_id + ' was rejected as refill_too_soon outside the refill window');
  } });
  const collected = seed.fills.filter(f => f.state === 'collected');
  const months = [];
  for (let m = FROM.slice(0, 7); m <= localDate(t).slice(0, 7); m = m.slice(5) === '12' ? (Number(m.slice(0, 4)) + 1) + '-01' : m.slice(0, 5) + String(Number(m.slice(5)) + 1).padStart(2, '0')) months.push(m);
  const busy = new Set(seed.fills.map(f => localDate(ms(f.requested_at)).slice(0, 7)));
  expect(months.every(m => busy.has(m)), 'a fill is requested in every month from ' + FROM.slice(0, 7) + ' to the clock');
  guard('counter', () => {
    const usual = patient => (REGIMENS.find(r => r.patient === patient) || { actor: seed.owner_person_id }).actor;
    const collectorOf = f => {
      const charge = f.charge_id ? by('charges', 'charge_id', f.charge_id) : null;
      if (f.state === 'collected' && charge && charge.method === 'counter') return charge.payer_id;
      return f.collector ? f.collector.person_id : usual(rxOf(f).patient_id);
    };
    const heldAt = (g, at) => g.notes.some((n, i) => i % 2 === 0 && ms(n.at) <= at && (i + 1 >= g.notes.length || at < ms(g.notes[i + 1].at)));
    const forgotten = g => g.state === 'returned_to_stock' || (g.cancellation && g.cancellation.stage === 'ready');
    const readyAt = (g, at) => g.timeline.some((e, i) => e.state === 'ready' && ms(e.at) <= at && (i + 1 >= g.timeline.length || ms(g.timeline[i + 1].at) > at + SAME_VISIT));
    const left = collected.flatMap(f => {
      const at = ms(f.closed_at), who = collectorOf(f);
      return seed.fills.filter(g => g !== f && g.store_id === f.store_id && !forgotten(g) && collectorOf(g) === who && readyAt(g, at) && !heldAt(g, at)).map(g => g.fill_id + ' at ' + f.fill_id);
    });
    expect(left.length === 0, 'every collection takes the collector\'s other unheld fills that are ready at that store, unless they are left to return to stock or cancelled' + (left.length ? ': ' + left.slice(0, 5).join(', ') : ''));
  });
  expect(collected.every(f => isOpen(by('stores', 'store_id', f.store_id) || { hours: [] }, ms(f.closed_at))), 'every collection happened while its store was open');
  expect(seed.fills.every(f => f.refusals.every(r => r.reason !== 'store_closed' || !isOpen(by('stores', 'store_id', f.store_id) || { hours: [] }, ms(r.at)))), 'every store_closed refusal happened while the store was closed');
  expect([...seed.charges, ...seed.authorizations].every(x => { const c = by('cards', 'card_id', x.card_id); return c && cardUsable(c, ms(x.at)); }), 'every charge and prepayment used a card that was usable then');

  const f15 = fill('f-15'), r15 = f15 && rxOf(f15), c15 = f15 && by('claims', 'claim_id', f15.claim_id);
  const rn2 = by('renewals', 'renewal_id', 'rn-2'), pr12 = by('plan_requests', 'plan_request_id', 'pr-12'), f12 = pr12 && fill(pr12.fill_id);
  const st2 = by('stores', 'store_id', 'st-2'), card3 = by('cards', 'card_id', 'card-3'), sunday = ms('2026-12-06T17:30:00-05:00');
  expect(!by('prescriptions', 'rx_id', 'rx-9') && !by('prescriptions', 'rx_id', 'rx-10'), 'the example events can add rx-9 and rx-10');
  expect(f15 && r15 && f15.state === 'waiting_stock' && f15.store_id === 'st-2' && r15.patient_id === 'p-4' && r15.drug_id === 'd-atorvastatin-40' && c15 && c15.result === 'paid' && c15.copay_cents === 1200 && r15.state === 'active' && sunday < rxExpiry(r15.written_on), 'f-15 is p-4\'s paid atorvastatin fill waiting for stock at st-2 on a valid prescription, with a $12.00 copay');
  expect(st2 && st2.stock['d-atorvastatin-40'] !== true && isOpen(st2, sunday), 'st-2 has no atorvastatin until restocked and is open on Sunday 2026-12-06 at 17:30');
  expect(rn2 && rn2.state === 'pending' && f15 && rn2.rx_id !== f15.rx_id && f12 && rn2.rx_id !== f12.rx_id, 'rn-2 is pending on a prescription other than those of f-15 and pr-12');
  expect(pr12 && pr12.state === 'pending' && f12 && f12.state === 'pending_plan_decision' && f12.claim_id === pr12.claim_id && f12.fill_id !== 'f-15', 'pr-12 is pending on another fill\'s current claim');
  expect(card3 && card3.owner_id === 'p-2' && cardUsable(card3, sunday) && by('prescribers', 'prescriber_id', 'dr-2'), 'card-3 is p-2\'s usable card and prescriber dr-2 exists');
  const first = ms('2026-12-01T09:00:00-05:00'), sharers = id => seed.grants.filter(g => g.patient_id === id && g.grantee_id !== id && ['view', 'refill'].includes(g.scope) && g.status === 'active' && (g.expires_at === null || ms(g.expires_at) > first));
  expect(sharers('p-2').length === 0 && sharers('p-4').length === 0, 'from the first example event no one else holds a view or refill grant on p-2 or p-4, so their example notices go to the patient alone');
  expect(!by('grants', 'grant_id', 'g-3') && !seed.grants.some(g => g.patient_id === 'p-4' && g.grantee_id === 'p-2'), 'no grant g-3 and no grant from p-4 to p-2');

  guard('wire example', () => {
    let state = structuredClone(seed), written = [];
    EXAMPLE.forEach(([at, operation, payload], i) => {
      const before = state.notices.length;
      state = plugin.applyEvent({ ...ctx, run_id: 'check', role: 'infra', virtual_now: at }, state, { event_id: 'ev-' + (i + 1), at, operation, payload });
      written = state.notices.slice(before);
    });
    const entry = written.find(n => n.recipient_id === 'p-2');
    expect(state.notices.length - seed.notices.length === 9 && entry && entry.notice_id === 'n-9' && entry.audience === 'logistics' && entry.subject.id === 'f-15', 'the proposal\'s example events through the restock write eight notices and then the wire example\'s entry n-9 for p-2');
  });
  const restock = [].concat(scenario).find(e => e.operation === 'store.restocked');
  let changed = false;
  if (restock) {
    const store = by('stores', 'store_id', restock.payload.store_id);
    try {
      const next = plugin.applyEvent({ ...ctx, run_id: 'check', role: 'infra', virtual_now: restock.at }, structuredClone(seed), structuredClone(restock));
      changed = store && store.stock[restock.payload.drug_id] !== true && next.stores.find(s => s.store_id === store.store_id).stock[restock.payload.drug_id] === true;
    } catch { changed = false; }
  }
  expect(restock && ms(restock.at) >= t && changed, 'the example restock comes at or after the fixture clock and changes stock');
  return problems;
}

function load() {
  const read = rel => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
  return {
    seed: read('fixtures/minimal.json'),
    options: {
      clock: read('fixtures/clock.json'), binding: read('fixtures/binding.json'), scenario: read('examples/scenario.json'),
      dataset: read('contribution/dataset.json'), bytes: fs.statSync(path.join(root, 'fixtures/minimal.json')).size, raw: fs.readFileSync(path.join(root, 'fixtures/minimal.json'), 'utf8'),
    },
  };
}

if (require.main === module) {
  const { seed, options } = load();
  const problems = check(seed, options);
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
  const split = list => list.filter(r => HISTORY.test(Object.values(r)[0])).length + ' history, ' + list.filter(r => !HISTORY.test(Object.values(r)[0])).length + ' task timeline';
  console.log('fixture ok: ' + seed.prescriptions.length + ' prescriptions (' + split(seed.prescriptions) + '), ' + seed.fills.length + ' fills (' + split(seed.fills) + '), ' + seed.notices.length + ' notices, ' + options.bytes + ' bytes');
}
module.exports = { check, load, BRANDS, NAME_BRANDS };
