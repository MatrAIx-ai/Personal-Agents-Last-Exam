#!/usr/bin/env node
'use strict';
// Validate the PALE #49 workspace seeds against the reused Apps.
//
//   node validate.cjs --root <checkout>
//
// <checkout> is a repository checkout that holds the shared runtime and the
// Apps (examples/apps/mail, examples/apps/calendar, apps/files, apps/notes,
// apps/contacts). Checks, per App:
//   1. the seed against the App's schemas/seed.schema.json;
//   2. the App's validateSeed(ctx, data) with ctx {app_id, binding, virtual_now};
//   3. the binding lists the App's account and every object the seed defines;
//   4. the public runtime: env.load_seed with the asset bundle, then
//      env.validate_bundle (provenance, counts, asset bytes and hashes).
// Plus: every mail-timeline item is a valid message and applies through
// env.apply_event in order; business-day rules reproduce the reference
// delivery times; the visa MRZ check digits are correct; and the facts the
// rubric relies on appear in the records named in proposal Section 5.

const fs = require('node:fs');
const path = require('node:path');

const WS = __dirname;
const VIRTUAL_NOW = '2027-02-08T20:30:00-06:00';
const APPS = {mail: 'examples/apps/mail', calendar: 'examples/apps/calendar', files: 'apps/files', notes: 'apps/notes', contacts: 'apps/contacts'};
const RECORDS = {mail: 'messages', calendar: 'events', files: 'files', notes: 'notes', contacts: 'contacts'};

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
if (rootIndex < 0 || !args[rootIndex + 1]) {
  console.error('Usage: node validate.cjs --root <checkout with runtime/ and the Apps>');
  process.exit(2);
}
const ROOT = path.resolve(args[rootIndex + 1]);
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const local = name => read(path.join(WS, name));

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log((cond ? 'PASS ' : 'FAIL ') + label + (detail ? ' - ' + detail : ''));
  return cond;
};
const attempt = (label, fn) => {
  try { const detail = fn(); ok(true, label, detail || ''); } catch (e) { ok(false, label, (e.code ? e.code + ': ' : '') + e.message); }
};

function compilerFor(appDir) {
  const own = path.join(appDir, 'tests/schema-validator.cjs');
  return require(fs.existsSync(own) ? own : path.join(ROOT, 'runtime/contracts/schema-validator.cjs')).compile;
}

const binding = local('binding.json');
const seeds = {};

console.log('== Seeds: schema, validateSeed, binding (root ' + ROOT + ')');
for (const [app, rel] of Object.entries(APPS)) {
  const dir = path.join(ROOT, rel);
  const data = seeds[app] = local(app + '.seed.json');
  const schemasDir = path.join(dir, 'schemas');
  const valid = compilerFor(dir)(read(path.join(schemasDir, 'seed.schema.json')), schemasDir);
  ok(valid(data), app + ': seed matches ' + rel + '/schemas/seed.schema.json');
  const plugin = require(path.join(dir, 'plugin.cjs'));
  attempt(app + ': validateSeed', () => { plugin.validateSeed({app_id: app, binding, virtual_now: VIRTUAL_NOW}, data); return plugin.records(data).length + ' records'; });
  const objects = plugin.objects(data), bound = binding.objects[app] || [];
  ok(objects.length === bound.length && objects.every(id => bound.includes(id)), app + ': binding.objects lists exactly the seed objects', objects.length + ' objects');
  ok(binding.accounts.some(a => a.app_id === app && a.account_id === data.account_id && a.owner_person_id === data.owner_person_id), app + ': account ' + data.account_id + ' is bound');
  const late = plugin.records(data).filter(r => [r.received_at, r.created_at, r.updated_at].some(t => t && Date.parse(t) > Date.parse(VIRTUAL_NOW)));
  ok(late.length === 0, app + ': no record is dated after the session-1 snapshot');
  const early = plugin.records(data).filter(r => [r.received_at, r.created_at].some(t => t && Date.parse(t) < Date.parse('2026-05-01T00:00:00-05:00')));
  ok(early.length === 0, app + ': history starts 2026-05 or later');
}
for (const p of binding.people) ok(/^person-[a-z]+$/.test(p.person_id), 'binding: person id ' + p.person_id);

console.log('\n== Public runtime: env.load_seed, env.validate_bundle, env.apply_event');
let runtime = null;
try {
  runtime = require(path.join(ROOT, 'runtime/core/runtime.cjs')).createRuntime({registryFile: path.join(ROOT, 'apps.registry.json')});
} catch (e) { ok(false, 'runtime: load ' + path.join(ROOT, 'apps.registry.json'), e.message); }
const timeline = local('mail-timeline.json');
const fill = (text, values) => text.replace(/\{\{(\w+)\}\}/g, (_, k) => {
  if (!(k in values)) throw new Error('No example value for {{' + k + '}}');
  return values[k];
});
if (runtime) {
  for (const app of Object.keys(APPS)) {
    const bundle = local('bundles/' + app + '.bundle.json');
    const policies = runtime.configs.get(app).policies;
    let s = runtime.create(app, 'pale49-validate');
    const load = runtime.execute(s, 'infra', 'env.load_seed', {expected_version: runtime.version(s), data: seeds[app], binding, policies, bundle,
      virtual_now: VIRTUAL_NOW, request_id: 'pale49-load-' + app});
    if (!ok(load.result.status === 'ready', app + ': env.load_seed', load.result.status === 'ready'
      ? load.result.loaded + ' objects, ' + load.result.quality.counts.assets + ' assets, ' + load.result.quality.counts.total_bytes + ' bytes'
      : (load.result.message || load.result.status))) continue;
    s = load.state;
    const check = runtime.execute(s, 'infra', 'env.validate_bundle', {data: seeds[app], bundle, binding, policies});
    const failed = (check.result.quality?.checks || []).filter(c => c.status !== 'pass').map(c => c.name);
    ok(check.result.status === 'ok', app + ': env.validate_bundle automated checks', failed.length ? failed.join(', ') : (check.result.quality?.checks.length + ' checks'));
    if (app === 'mail') {
      for (const item of timeline.items) {
        const e = JSON.parse(JSON.stringify(item.event));
        e.payload.subject = fill(e.payload.subject, item.example_values || {});
        e.payload.body = fill(e.payload.body, item.example_values || {});
        const r = runtime.execute(s, 'infra', 'env.apply_event', {expected_version: runtime.version(s), event: e});
        if (ok(r.result.status === 'committed', 'mail-timeline: ' + item.item_id + ' applies at ' + e.at, r.result.status === 'committed' ? '' : (r.result.message || r.result.status))) s = r.state;
      }
      ok(s.data.messages.length === seeds.mail.messages.length + timeline.items.length, 'mail-timeline: inbox holds ' + s.data.messages.length + ' messages after every delivery');
    }
  }
}

console.log('\n== Mail timeline rules');
const addBusinessDays = (isoDate, n) => {
  const d = new Date(isoDate.slice(0, 10) + 'T12:00:00Z');
  while (n > 0) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n--; }
  return d.toISOString().slice(0, 10);
};
for (const item of timeline.items) {
  ok(item.event.payload.received_at === item.event.at && Date.parse(item.event.at) > Date.parse(VIRTUAL_NOW), item.item_id + ': delivered after the snapshot, received_at = event.at');
  const holes = (item.event.payload.subject + item.event.payload.body).match(/\{\{\w+\}\}/g) || [];
  ok(holes.every(h => item.placeholders && h.slice(2, -2) in item.placeholders), item.item_id + ': every placeholder is declared', [...new Set(holes)].join(' ') || 'none');
  if (item.kind !== 'rule') continue;
  const [refKey] = Object.keys(item.reference).filter(k => k !== 'deliver_at');
  const day = addBusinessDays(item.reference[refKey], item.rule.business_days);
  ok(item.reference.deliver_at.startsWith(day + 'T' + item.rule.local_time), item.item_id + ': ' + item.rule.business_days + ' business days after ' + item.reference[refKey] + ' = ' + item.reference.deliver_at);
}

console.log('\n== Visa MRZ');
const manifest = local('manifest.json');
const mrzCheck = s => String([...s].reduce((sum, c, i) => sum + (c === '<' ? 0 : /[0-9]/.test(c) ? Number(c) : c.charCodeAt(0) - 55) * [7, 3, 1][i % 3], 0) % 10);
const visaText = fs.readFileSync(path.join(WS, 'assets/files/us_visa_photo_SPECIMEN.txt'), 'utf8');
const line2 = visaText.split('\n').find(l => /^[A-Z0-9<]{44}$/.test(l) && !l.startsWith('V'));
ok(!!line2 && line2 === manifest.mrz.line2, 'visa photo carries MRZ line 2', line2 || 'missing');
if (line2) {
  ok(mrzCheck(line2.slice(0, 9)) === line2[9], 'MRZ document-number check digit', line2.slice(0, 9) + ' -> ' + line2[9]);
  ok(mrzCheck(line2.slice(13, 19)) === line2[19], 'MRZ birth-date check digit', line2.slice(13, 19) + ' -> ' + line2[19]);
  ok(line2.slice(21, 27) === '270501' && mrzCheck(line2.slice(21, 27)) === line2[27], 'MRZ expiry 270501 with valid check digit', line2.slice(21, 27) + ' -> ' + line2[27]);
}
ok(/Expiration Date: \[glare - unreadable\]/.test(visaText), 'visa photo: printed expiry unreadable');

console.log('\n== Facts the rubric relies on (proposal Section 5 evidence)');
const msg = id => seeds.mail.messages.find(m => m.id === id) || {body: ''};
const tl = id => (timeline.items.find(i => i.item_id === id) || {event: {payload: {body: ''}}}).event.payload;
const evt = id => seeds.calendar.events.find(e => e.id === id) || {};
const note = id => seeds.notes.notes.find(n => n.id === id) || {body: ''};
const asset = name => fs.readFileSync(path.join(WS, 'assets/files', name), 'utf8');
const facts = [
  ['acceptance: Lyon, April 26-29', /April 26-29, 2027, at the Centre des Congres de Lyon/.test(msg('msg-scda-accept').body)],
  ['acceptance: talk 2027-04-29 16:00-17:30 +02:00', /April 29, 2027, 16:00-17:30 Lyon time \(UTC\+02:00\)/.test(msg('msg-scda-accept').body)],
  ['acceptance: registration opens 2027-02-22 09:00 Central, closes 2027-03-15 23:59', /February 22, 2027 at 09:00 US Central.*March 15, 2027 at 23:59 US Central/.test(msg('msg-scda-accept').body)],
  ['acceptance: letter 10 business days, correction 12 business days', /within 10 business days/.test(msg('msg-scda-accept').body) && /within 12 business days/.test(msg('msg-scda-accept').body)],
  ['registration terms: author fee non-refundable, no refundable option', /non-refundable/.test(asset('SCDA2027_registration_terms.txt')) && /no refundable author rate/.test(asset('SCDA2027_registration_terms.txt'))],
  ['registration terms: corrections only in ConfDesk', /Requests sent by email are not processed/.test(asset('SCDA2027_registration_terms.txt'))],
  ['advisor: travel on the NSF grant', /NSF grant/.test(msg('msg-hartmann-nsf').body)],
  ['Hao: four months in 221(g)', /Four months in 221\(g\)/.test(msg('msg-hao-221g').body)],
  ['ISSO: travel signature valid 12 months', /valid for 12 months/.test(msg('msg-isso-monthly').body)],
  ['Northline history: two unread schedule changes in June 2026', ['msg-northline-change-1', 'msg-northline-change-2'].every(id => msg(id).read === false)],
  ['qual mail and calendar: 2027-03-18T09:00:00-05:00', /March 18, 2027, 9:00-11:00 am/.test(msg('msg-qual-confirmed').body) && evt('evt-qual-oral').start === '2027-03-18T09:00:00-05:00'],
  ['calendar: TA on Tuesdays and Thursdays only', seeds.calendar.events.filter(e => e.title.startsWith('TA: EE 3101 discussion')).every(e => [2, 4].includes(new Date(e.start.slice(0, 10) + 'T12:00:00Z').getUTCDay()))],
  ['I-20 travel signature dated 03/09/2026', /Date: 03\/09\/2026/.test(asset('i20_page2_travel_endorsement_SPECIMEN.txt'))],
  ['travel policy: Fly America, code share, written PI approval', /code share/.test(asset('NPU_Travel_Policy_2026_excerpt.txt')) && /approves an exception in writing/.test(asset('NPU_Travel_Policy_2026_excerpt.txt'))],
  ['travel policy: personal days on the same ticket up to a comparison round trip', /same ticket/.test(asset('NPU_Travel_Policy_2026_excerpt.txt')) && /comparison round trip/.test(asset('NPU_Travel_Policy_2026_excerpt.txt'))],
  ['consulates: competence by most nights; invitation letter required', ['Schengen_visa_guidance_Germany_Chicago.txt', 'Schengen_visa_guidance_France_Chicago.txt'].every(f => /nights/.test(asset(f)) && /invitation letter/.test(asset(f)))],
  ['schedule change: 2027-03-05T19:22, lands 2027-05-01, NL 97 free until 2027-03-12 23:59', tl('tl-northline-schedule-change').received_at === '2027-03-05T19:22:00-06:00' && /May 1, 2027/.test(tl('tl-northline-schedule-change').body) && /NL 97, Friday, April 30, 2027, Lyon \(LYS\) 06:30 - Minneapolis \(MSP\) 21:45/.test(tl('tl-northline-schedule-change').body) && /until Friday, March 12, 2027, 23:59 US Central/.test(tl('tl-northline-schedule-change').body)],
  ['letter: surname misspelled ZHOU, reference 2027-03-08T10:00:00-06:00', /Mr\. Mingyu ZHOU/.test(tl('tl-scda-letter-misspelled').body) && tl('tl-scda-letter-misspelled').received_at === '2027-03-08T10:00:00-06:00'],
  ['registration opens mail at 2027-02-22T09:00:00-06:00', tl('tl-scda-registration-open').received_at === '2027-02-22T09:00:00-06:00'],
  ['note: alerts are the only thing he acts on', /if it's not in my calendar with an alert, it doesn't exist/.test(note('note-alerts-only').body)],
  ['note: Northline changed my flight twice', /Northline changed my flight twice and I only found out at the gate/.test(note('note-northline-changes').body)],
  ['note: not going near a consulate before my qual', /Not going near a consulate before my qual/.test(note('note-no-consulate-before-qual').body)],
  ['note: not landing the same day my paperwork runs out', /landed the same day my paperwork ran out and I am not doing that again/.test(note('note-paperwork-landing').body)],
  ['note: visa delay ate a non-refundable ticket', /second time a visa delay ate a non-refundable ticket/.test(note('note-visa-delay-ticket').body)],
  ['note: French consulate lure', /French consulate.*would use them again/.test(note('note-french-consulate').body)],
  ['14 memory notes: 5 decisive, 9 not', seeds.notes.notes.length === 14 && Object.values(manifest.roles.notes).filter(r => r === 'decisive').length === 5],
  ['4 immigration documents watermarked SPECIMEN', seeds.files.files.filter(f => f.parent_id === 'folder-immigration').length === 4 && seeds.files.files.filter(f => f.parent_id === 'folder-immigration').every(f => /SPECIMEN/.test(asset(f.name)))],
  ['no calendar event was created by the assistant (schema has no alert field)', seeds.calendar.events.every(e => !/assistant/i.test(e.title))]
];
for (const [label, cond] of facts) ok(!!cond, label);
const everything = JSON.stringify([seeds, timeline, binding]);
ok(!/@(?!(?:[a-z0-9-]+\.)*example\.(?:com|org|net)\b)[a-z0-9.-]+\.[a-z]+/i.test(everything), 'every email address uses a reserved example.* domain');

console.log('\n' + (failures ? failures + ' check(s) FAILED' : 'All checks passed'));
process.exitCode = failures ? 1 : 0;
