'use strict';
// Deterministic fixture generator. Agencies, rules and notice text are authored here; periods, documents and the member's
// history are computed. Same seed, same bytes. Also writes the document files (UTF-8 text and a few text-based PDFs).
//   node apps/civicdesk/scripts/generate-fixture.cjs
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const NOW = '2026-11-30T18:00:00-08:00', ACCOUNT = 'acct-dana', PERSON = 'person-dana';
let state = 20261130;
const rand = () => {state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648;};
const pick = list => list[Math.floor(rand() * list.length)];
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const OFFSETS = {'America/New_York':['-05:00', '-04:00'], 'America/Chicago':['-06:00', '-05:00'], 'America/Denver':['-07:00', '-06:00']};
const dst = day => (day >= '2025-03-09' && day < '2025-11-02') || (day >= '2026-03-08' && day < '2026-11-01');
const T = (day, hm, tz) => day + 'T' + hm + ':00' + OFFSETS[tz][dst(day) ? 1 : 0];
const hist = entries => entries.map(([at, action, detail]) => detail === undefined ? {at, action} : {at, action, detail});

const AGENCIES = [
  {agency_id:'ocdd', name:'Office of Consumer Device Data', acronym:'OCDD', timezone:'America/New_York', description:'Fictional federal office that regulates how makers of consumer devices collect, keep and share data.'},
  {agency_id:'bsbr', name:'Bureau of Small Business Records', acronym:'BSBR', timezone:'America/Chicago', description:'Fictional bureau that sets record-keeping and reporting rules for small businesses and practices.'},
  {agency_id:'ools', name:'Office of Outdoor Lighting Standards', acronym:'OOLS', timezone:'America/Denver', description:'Fictional office that sets efficiency, glare and dark-sky standards for outdoor lighting.'}
];
// Rules: [agency, number, title, summary, supplementary]. The two OCDD wearable dockets are the ones the linked task uses.
const RULES = [
  ['ocdd', 'Retention and Sharing of Consumer Wearable Sensor Data', 'The Office proposes to permit makers of consumer wearables to retain raw step, heart-rate and sleep sensor data for three years after collection and to share de-identified sensor data with research partners by default, with an opt-out available in device settings.', 'The proposal sets a three-year retention ceiling, defines de-identification by removal of direct identifiers, and asks whether small clinics and individual practitioners who use patient wearable data in care should have a defined deletion path when care ends.', {number:'2026-0031', opened:'2026-11-04', closes:'2026-12-04', target:true}],
  ['ocdd', 'Cybersecurity Labeling for Consumer Wearables', 'The Office proposes a voluntary cybersecurity label for consumer wearables that states update support periods and encryption at rest.', 'The label would be awarded after third-party testing; the Office seeks comment on the testing scope and label format.', {number:'2026-0027', opened:'2026-10-20', closes:'2026-12-18'}],
  ['ocdd', 'Default Settings for Location History on Fitness Devices', 'The Office proposes that location history on fitness devices be off by default for new accounts.', 'Comment is sought on exemptions for safety features that rely on location.'],
  ['ocdd', 'Disclosure of Sensor Accuracy Ranges', 'The Office proposes that device makers publish the accuracy range of heart-rate and oxygen sensors in plain language.', 'The Office asks how ranges should be measured and whether they belong on packaging or in the app.'],
  ['ocdd', 'Data Portability Between Wearable Platforms', 'The Office proposes a common export format for daily activity summaries so that users can move between platforms.', 'The proposed format covers steps, distance, active minutes and sleep stages; raw sensor streams are excluded.'],
  ['ocdd', 'Children\'s Accounts on Consumer Health Devices', 'The Office proposes stricter defaults and parental controls for accounts of users under thirteen.', 'Comment is sought on age verification that does not itself collect more data.'],
  ['ocdd', 'Notice of Data Breach Timelines for Device Makers', 'The Office proposes a thirty-day notice requirement for breaches involving sensor data.', 'The Office asks whether the clock should start at discovery or at confirmation.'],
  ['ocdd', 'Research Partner Agreements for De-identified Data', 'The Office proposes minimum contract terms for sharing de-identified device data with research partners.', 'Terms include a prohibition on re-identification attempts and an audit right.'],
  ['ocdd', 'Sleep Tracking Claims and Substantiation', 'The Office proposes that sleep-stage claims be substantiated by validation studies.', 'The Office asks what study designs are adequate for consumer devices.'],
  ['ocdd', 'Account Deletion Standards for Device Platforms', 'The Office proposes that deleting an account removes associated sensor data within thirty days.', 'Backups and legal holds are addressed in section 4.'],
  ['ocdd', 'Interoperable Alerts for Abnormal Heart Rhythm Notifications', 'The Office proposes a common format for rhythm notifications shared with clinicians.', 'Comment is sought on false-positive handling.'],
  ['ocdd', 'Advertising Based on Wearable Data', 'The Office proposes to prohibit targeted advertising based on health sensor data without separate consent.', 'The proposal distinguishes activity data from health inferences.'],
  ['ocdd', 'Firmware Update Transparency', 'The Office proposes that device makers publish release notes for firmware changes that alter sensor behavior.', 'The Office asks about the level of detail required.'],
  ['ocdd', 'Secondary Use of Workout Data by Employers', 'The Office proposes limits on employer access to employees\' wearable workout data in wellness programs.', 'Comment is sought on aggregate reporting thresholds.'],
  ['bsbr', 'Electronic Record Retention for Small Practices', 'The Bureau proposes a seven-year retention standard for patient and client records kept by practices with fewer than ten employees.', 'The proposal would allow encrypted cloud storage and asks how long records must stay retrievable after a practice closes.', {number:'2025-0004', opened:'2025-02-10', closes:'2025-04-11'}],
  ['bsbr', 'Simplified Quarterly Reporting for Sole Proprietors', 'The Bureau proposes a one-page quarterly report for sole proprietors below a revenue threshold.', 'The threshold and the treatment of seasonal businesses are open questions.'],
  ['bsbr', 'Digital Signature Acceptance for Client Agreements', 'The Bureau proposes to accept digital signatures on client agreements kept by small practices.', 'Comment is sought on identity assurance levels.'],
  ['bsbr', 'Record-Keeping for Appointment-Based Services', 'The Bureau proposes minimum appointment records for service businesses, including cancellations and no-shows.', 'The proposal asks whether fee disputes should be part of the record.'],
  ['bsbr', 'Deletion Requests from Former Clients', 'The Bureau proposes a process and a thirty-day deadline for deleting former clients\' records on request, subject to retention law.', 'The Bureau asks how the deadline should interact with clinical retention requirements.', {number:'2026-0016', opened:'2026-06-22', closes:'2026-08-21'}],
  ['bsbr', 'Backup and Recovery Standards for Practice Records', 'The Bureau proposes an annual recovery test for practices that keep records electronically.', 'Comment is sought on what counts as a successful test.'],
  ['bsbr', 'Plain-Language Privacy Notices for Small Practices', 'The Bureau proposes a model privacy notice that practices may adopt.', 'The model notice is published as a supporting document.'],
  ['bsbr', 'Shared Record Systems Among Independent Practitioners', 'The Bureau proposes rules for practitioners who share one record system.', 'Access logging and separation of client lists are addressed.'],
  ['bsbr', 'Record Transfer When a Practice Changes Hands', 'The Bureau proposes a notice to clients and a transfer inventory when a practice is sold.', 'The proposal asks about timing and client consent.'],
  ['bsbr', 'Reporting of Data Incidents by Small Practices', 'The Bureau proposes a simplified incident report for practices with fewer than ten employees.', 'The Bureau asks whether a telephone report should suffice for the first notice.'],
  ['bsbr', 'Retention of Wearable-Derived Measurements in Client Files', 'The Bureau proposes that measurements imported from client wearables be kept only for the episode of service unless the client agrees otherwise.', 'The proposal cross-references the OCDD wearable retention rulemaking.', {number:'2026-0021', opened:'2026-11-09', closes:'2026-12-23'}],
  ['ools', 'Correlated Color Temperature Limits for Street Lighting', 'The Office proposes a 3000 kelvin ceiling for new street lighting.', 'Exemptions for sports facilities are discussed in section 5.'],
  ['ools', 'Shielding Requirements for Commercial Parking Lots', 'The Office proposes full-cutoff fixtures for parking lots above a size threshold.', 'Comment is sought on retrofit timelines.'],
  ['ools', 'Curfew Dimming for Outdoor Signage', 'The Office proposes that illuminated signs dim after midnight in residential zones.', 'The Office asks about safety exceptions.'],
  ['ools', 'Efficiency Standards for Residential Path Lighting', 'The Office proposes minimum efficacy for residential path and porch lights.', 'Solar fixtures are addressed separately.'],
  ['ools', 'Glare Measurement Method for Sports Fields', 'The Office proposes a standard glare measurement method for sports-field lighting.', 'The proposal asks which measurement positions are representative.'],
  ['ools', 'Dark-Sky Protection Near Observatories', 'The Office proposes stricter limits within fifteen miles of observatories.', 'Comment is sought on the radius.'],
  ['ools', 'Motion-Activated Lighting in Public Parks', 'The Office proposes motion activation for park lighting after closing hours.', 'The Office asks about maintenance costs.'],
  ['ools', 'Labeling of Outdoor Fixtures for Light Pollution', 'The Office proposes a label stating upward light output.', 'Testing procedures are in the supporting analysis.'],
  ['ools', 'Trail Lighting Standards in Wildlife Corridors', 'The Office proposes amber lighting and seasonal curfews in wildlife corridors.', 'The Office asks how corridors should be designated.', {number:'2026-0032', opened:'2026-10-26', closes:'2026-12-10'}],
  ['ools', 'Reporting of Municipal Lighting Inventories', 'The Office proposes an annual inventory report for municipalities.', 'A spreadsheet template is a supporting document.', {number:'2026-0017', opened:'2026-05-11', closes:'2026-07-02'}],
  ['ools', 'Bridge and Waterfront Lighting Guidance', 'The Office proposes guidance for lighting over water to limit reflection.', 'Comment is sought on whether guidance should become a standard.', {number:'2026-0034', opened:'2026-11-16', closes:'2027-01-08'}]
];
const data = {account_id:ACCOUNT, owner_person_id:PERSON, settings:{timezone:'America/Los_Angeles', min_comment_chars:40, max_comment_chars:5000, closing_soon_days:7},
  member:{name:'Dana Reyes', email:'dana.reyes@example.com', organization:null}, agencies:AGENCIES, dockets:[], documents:[], drafts:[], comments:[]};

// ---- periods spread over 2025-01 .. 2026-12: most closed, several open or extended at the clock ----
const counters = {ocdd:0, bsbr:0, ools:0};
const openings = ['2025-01-06', '2025-02-10', '2025-03-17', '2025-04-21', '2025-05-19', '2025-06-23', '2025-07-28', '2025-09-08', '2025-10-13', '2025-11-17', '2026-01-12', '2026-02-16', '2026-03-23', '2026-04-27', '2026-06-01', '2026-07-13', '2026-08-24', '2026-09-28', '2026-11-02', '2026-11-16'];
let openIdx = 0;
const notice = (a, d, supp) => [a.name.toUpperCase(), 'Docket ' + d.docket_id, 'Proposed rule: ' + d.title, '', 'AGENCY: ' + a.name + ' (' + a.acronym + ').', 'ACTION: Proposed rule; request for comments.', 'SUMMARY: ' + d.summary, 'DATES: Comments must be received on or before ' + d.closes_at.slice(0, 10) + ' at 11:59 PM ' + a.timezone + '.', 'ADDRESSES: Submit comments through CivicDesk under docket ' + d.docket_id + '. All comments received are part of the public record.', '', 'SUPPLEMENTARY INFORMATION:', supp || d.supplementary_information, '', 'This fictional notice was generated for the PALE benchmark; it mirrors the structure of a public-domain rulemaking notice and describes no real agency or rule.'].join('\n');
function pdf(lines) {
  const esc = s => s.replace(/[^\x20-\x7e]/g, '?').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const wrapped = lines.flatMap(l => l.match(/.{1,90}(\s|$)/g) || ['']);
  const objects = [], add = body => {objects.push(body); return objects.length;};
  const catalog = add(null), pages = add(null), font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');
  const content = 'BT /F1 9 Tf 11 TL 36 756 Td ' + wrapped.slice(0, 64).map(l => '(' + esc(l) + ') Tj T*').join(' ') + ' ET';
  const stream = add('<< /Length ' + Buffer.byteLength(content, 'latin1') + ' >>\nstream\n' + content + '\nendstream');
  const page = add('<< /Type /Page /Parent ' + pages + ' 0 R /MediaBox [0 0 612 792] /Contents ' + stream + ' 0 R /Resources << /Font << /F1 ' + font + ' 0 R >> >> >>');
  objects[catalog - 1] = '<< /Type /Catalog /Pages ' + pages + ' 0 R >>'; objects[pages - 1] = '<< /Type /Pages /Kids [' + page + ' 0 R] /Count 1 >>';
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'; const offsets = [];
  objects.forEach((body, i) => {offsets.push(Buffer.byteLength(out, 'latin1')); out += (i + 1) + ' 0 obj\n' + body + '\nendobj\n';});
  const xref = Buffer.byteLength(out, 'latin1');
  out += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n' + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root ' + catalog + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(out, 'latin1');
}
fs.mkdirSync(path.join(root, 'assets'), {recursive:true});
for (const f of fs.readdirSync(path.join(root, 'assets'))) if (/\.(txt|pdf)$/.test(f)) fs.unlinkSync(path.join(root, 'assets', f));
const catalog = {schema_version:'pale.asset-catalog.v1', catalog_id:'civicdesk-assets', app_id:'civicdesk', dataset_ref:'dataset.json', assets:[], extensions:[]};
let docN = 0, pdfBudget = 4;
function addDocument(d, title, kind, text, asPdf) {
  const a = AGENCIES.find(x => x.agency_id === d.agency_id), id = 'doc-' + String(++docN).padStart(3, '0'), assetId = 'asset-' + id;
  const bytes = asPdf ? pdf(text.split('\n')) : Buffer.from(text + '\n', 'utf8'), file = 'assets/' + id + (asPdf ? '.pdf' : '.txt');
  fs.writeFileSync(path.join(root, file), bytes);
  data.documents.push({document_id:id, docket_id:d.docket_id, title, kind, mime_type:asPdf ? 'application/pdf' : 'text/plain', asset_id:assetId, bytes:bytes.length, published_at:d.opened_at});
  d.document_ids.push(id);
  catalog.assets.push({schema_version:'pale.asset-descriptor.v1', asset_id:assetId, scope:{level:'package', app_id:'civicdesk'}, roles:['content.inline'], subjects:[{app_id:'civicdesk', account_id:ACCOUNT, object_type:'docket', object_id:d.docket_id}],
    mime_type:asPdf ? 'application/pdf' : 'text/plain', availability:{status:'ready'}, storage:{adapter:'storage.file', path:file, packaging:'bundled'}, provenance:{dataset_id:'civicdesk-dana', source_ids:['generated']}, publication:'public',
    access:{audience:['agent'], rule:'parent_object'}, presentation:{alt_text:title}, media:{captured_at:d.opened_at}, extensions:[], integrity:{bytes:bytes.length, sha256:sha256(bytes)}});
}
for (const [agencyId, title, summary, supplementary, fixed = {}] of RULES) {
  const a = AGENCIES.find(x => x.agency_id === agencyId);
  const opened = fixed.opened || openings[openIdx++ % openings.length], year = opened.slice(0, 4);
  counters[agencyId]++;
  const number = fixed.number || year + '-' + String(counters[agencyId] * 3 + (agencyId === 'bsbr' ? 1 : 2)).padStart(4, '0');
  const closesDay = fixed.closes || addDays(opened, 45 + Math.floor(rand() * 30));
  const d = {docket_id:a.acronym + '-' + number, agency_id:agencyId, title, summary, supplementary_information:supplementary, opened_at:T(opened, '09:00', a.timezone), closes_at:T(closesDay, '23:59', a.timezone), extended_from:null, corrections:[], document_ids:[],
    public_comment_count:Math.floor(rand() * 400), created_at:T(addDays(opened, -3), '14:00', a.timezone), updated_at:T(addDays(opened, -3), '14:00', a.timezone), history:hist([[T(addDays(opened, -3), '14:00', a.timezone), 'published']])};
  // Some closed dockets were extended or corrected during their period; the records keep that history.
  if (!fixed.target && rand() < 0.25 && closesDay < '2026-11-01') {const before = d.closes_at, newDay = addDays(closesDay, 14), at = T(addDays(closesDay, -5), '10:00', a.timezone); d.extended_from = before; d.closes_at = T(newDay, '23:59', a.timezone); d.updated_at = at; d.history.push({at, action:'period_extended', detail:'Extended at the request of commenters'});}
  if (!fixed.target && rand() < 0.2) {const at = T(addDays(opened, 10), '10:00', a.timezone); d.corrections.push({at, text:'Correction: a date in the DATES section was printed incorrectly; the closing date stated in CivicDesk is authoritative.'}); if (Date.parse(at) > Date.parse(d.updated_at)) {d.updated_at = at; d.history.push({at, action:'correction_published', detail:'Date corrected'});}}
  data.dockets.push(d);
  addDocument(d, 'Notice of proposed rulemaking, ' + d.docket_id, 'notice', notice(a, d), false);
  if (rand() < 0.45 || fixed.target) {const usePdf = pdfBudget > 0 && (fixed.target || rand() < 0.3); if (usePdf) pdfBudget--; addDocument(d, (fixed.target ? 'Retention analysis and small-practice impact' : 'Supporting analysis') + ', ' + d.docket_id, fixed.target ? 'analysis' : 'supporting', [a.name, 'Supporting analysis for docket ' + d.docket_id, '', fixed.target ? 'The Office estimates that 18 percent of users share wearable data with a clinician during an episode of care. The analysis assumes a three-year retention period and asks whether small practices need a defined deletion path when care ends.' : 'The analysis summarizes the costs and benefits the Office considered for ' + d.title.toLowerCase() + '.', '', 'Figures in this fictional analysis are illustrative and describe no real data.'].join('\n'), usePdf);}
}
// The target docket keeps its second document in the window: the task's agent should find both documents.
// ---- the member: two posted comments on closed dockets, one recent comment awaiting posting ----
const comment = (id, docketId, day, hm, text, submitter, status, extra = {}) => {
  const d = data.dockets.find(x => x.docket_id === docketId), a = AGENCIES.find(x => x.agency_id === d.agency_id), at = T(day, hm, a.timezone);
  const posted = status === 'posted' ? T(addDays(day, 6), '11:00', a.timezone) : at;
  const x = {comment_id:id, docket_id:docketId, draft_id:null, tracking_number:'CDK-' + docketId.split('-').slice(1).join('-') + '-' + sha256(docketId + '|' + text + '|' + at).slice(0, 5).toUpperCase(), text, text_sha256:sha256(text), submitter, supplemental:false, status, return_reason:null,
    submitted_at:at, updated_at:posted, notices:[{kind:'receipt', status:'delivered', at, event_id:null}], history:hist([[at, 'submitted', (submitter.kind === 'anonymous' ? 'Anonymous' : 'Named') + '; tracking'], [at, 'notice_delivered', 'receipt notice'], ...(status === 'posted' ? [[posted, 'posted']] : [])]), ...extra};
  x.history[0].detail += ' ' + x.tracking_number; data.comments.push(x);
};
comment('cmt-h001', 'BSBR-2025-0004', '2025-03-30', '20:15', 'As a two-person physical therapy clinic we keep client records for seven years already; the proposal should say plainly that encrypted cloud storage counts, because most small practices cannot run their own servers. Retrievability after a practice closes should be limited to the retention period, not indefinite.', {kind:'named', name:'Dana Reyes', organization:null}, 'posted');
comment('cmt-h002', 'BSBR-2026-0016', '2026-08-02', '19:40', 'A thirty-day deadline for deleting a former client\'s records is workable for a small practice if it is clear which records clinical retention law still requires us to keep; the rule should list those categories so that we can answer the client in one message.', {kind:'named', name:'Dana Reyes', organization:null}, 'posted');
comment('cmt-h003', 'OOLS-2026-0032', '2026-11-28', '21:05', 'Amber trail lighting with a seasonal curfew is a good balance for the river corridor near our town; please keep an exception for the trailhead parking area where people load equipment after dark.', {kind:'anonymous', name:null, organization:null}, 'received');
data.dockets.sort((a, b) => a.opened_at.localeCompare(b.opened_at) || a.docket_id.localeCompare(b.docket_id));
// ---- write ----
fs.writeFileSync(path.join(root, 'fixtures/minimal.json'), JSON.stringify(data, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'fixtures/clock.json'), JSON.stringify({initial_time:NOW}, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'fixtures/binding.json'), JSON.stringify({people:[{person_id:PERSON, name:'Dana Reyes'}], accounts:[{app_id:'civicdesk', account_id:ACCOUNT, owner_person_id:PERSON}], objects:{civicdesk:require('../src/model.cjs').objects(data)}}, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'contribution/assets.catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
const datasetFile = path.join(root, 'contribution/dataset.json');
if (fs.existsSync(datasetFile)) {const ds = JSON.parse(fs.readFileSync(datasetFile, 'utf8')); ds.expected_counts = {records:require('../src/model.cjs').records(data).length, assets:catalog.assets.length}; fs.writeFileSync(datasetFile, JSON.stringify(ds, null, 2) + '\n');}
const counts = {agencies:data.agencies.length, dockets:data.dockets.length, open_at_clock:data.dockets.filter(d => Date.parse(d.closes_at) > Date.parse(NOW)).length, documents:data.documents.length, pdfs:data.documents.filter(x => x.mime_type === 'application/pdf').length, bundle_bytes:catalog.assets.reduce((s, a) => s + a.integrity.bytes, 0), comments:data.comments.length, records:require('../src/model.cjs').records(data).length};
console.log('Wrote fixtures/minimal.json: ' + JSON.stringify(counts));
