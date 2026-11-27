'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const {fixture} = require('./harness.cjs');
const {compile} = require('./schema-validator.cjs');
const k = require('../src/desk.cjs');
const d = require('../src/dates.cjs');

const code = value => ({code:value});
function unchanged(f, fn, expected) { const before = f.data; assert.throws(fn, expected); assert.deepEqual(f.data, before); }
const REG = 'SCDA27-R-0388', LABEL = 'First Prairie Visa ending 2291', PAPER = 'paper-214';
const OPEN = require('../examples/scenario.json');
const deadline = (at = '2027-03-16T07:10:00-05:00', event_id = 'deadline-' + at) => ({event_id, at, operation:'confdesk.deadline.passed', payload:{}});
const computed = (f, from, days) => ({registration_id:REG, ...k.computation(f.data, from, days)});
const letterEvent = (f, at = '2027-03-08T10:00:00-06:00', payload = computed(f, '2027-02-22', 10), event_id = 'letter-' + at) =>
  ({event_id, at, operation:'confdesk.letter.issue', payload});
const correctionEvent = (f, at, from, payload = computed(f, from, 12), event_id = 'correction-' + at) =>
  ({event_id, at, operation:'confdesk.correction.issue', payload});
const preview = f => f.call('confdesk.register.preview', {paper_id:PAPER});
const confirm = (f, preview_id, payment_label = LABEL) => f.call('confdesk.register.confirm', {preview_id, payment_label});
const letters = f => f.call('confdesk.letter.get', {});
function seeded(fn) { const f = fixture(); const data = f.data; fn(data); f.load(data); return f; }
// Window open, registered at 2027-02-22T09:05 Chicago time (Monday).
function registered(f = fixture(), at = '2027-02-22T09:05:00-06:00') {
  f.event(OPEN); f.ctx.virtual_now = at; confirm(f, preview(f).preview_id); return f;
}
function withLetter() { const f = registered(); f.event(letterEvent(f)); return f; }
const emailMessage = compile(require('../schemas/email-message.schema.json'), path.resolve(__dirname, '../schemas'));

test('generated schemas and tools.json match their single source', () => {
  if (!fs.existsSync(path.resolve(__dirname, '../../../examples/apps/mail/schemas/router-message.schema.json'))) return;
  require('../build/schemas.cjs').build({check:true});
});

test('the seed: SCDA 2027 in Lyon, one accepted paper, a profile from submission with the surname misspelled, history on or after 2026-01-01', () => {
  const f = fixture(), before = f.data;
  const conf = f.call('confdesk.conference.get', {}).conference;
  assert.deepEqual([conf.short_name, conf.city, conf.starts_on, conf.ends_on], ['SCDA 2027', 'Lyon', '2027-04-26', '2027-04-29']);
  assert.deepEqual(conf.registration, {opens_at:'2027-02-22T09:00:00-06:00', closes_at:'2027-03-15T23:59:00-05:00', status:'not_open'});
  assert.equal(conf.author_rate, null); // no rate before the schedule starts
  assert.deepEqual([conf.letter_business_days, conf.correction_business_days, conf.business_calendar.timezone, conf.business_calendar.source], [10, 12, 'America/Chicago', 'default']);
  const paper = f.call('confdesk.paper.status', {});
  assert.deepEqual([paper.paper.id, paper.paper.status, paper.paper.accepted_at, paper.registered, paper.registration_deadline],
    [PAPER, 'awaiting_registration', '2027-01-20T16:00:00-06:00', false, '2027-03-15T23:59:00-05:00']);
  const reg = f.call('confdesk.registration.get', {});
  assert.deepEqual([reg.registration, reg.attendee.name_on_file, reg.attendee.created_at.slice(0, 10)], [null, 'ZHOU Mingyu', '2026-10-15']);
  assert.deepEqual(letters(f), {letters:[], current:null, letter_expected_on:null, correction_requests:[]});
  assert.deepEqual(f.data, before);
  const stamps = JSON.stringify(require('../fixtures/minimal.json')).match(/\d{4}-\d{2}-\d{2}T[^"]+/g);
  assert.ok(stamps.every(s => Date.parse(s) >= Date.parse('2026-01-01T00:00:00Z')));
});

test('registration.open: not before opens_at, not after the window, only once; replay is a no-op', () => {
  const f = fixture();
  unchanged(f, () => f.event({...OPEN, event_id:'early', at:'2027-02-22T08:59:59-06:00'}), code('not_due'));
  unchanged(f, () => f.event({...OPEN, event_id:'late', at:'2027-03-16T00:00:00-05:00'}), code('invalid_event'));
  f.event(OPEN);
  assert.equal(f.data.conference.window.opened_at, OPEN.at);
  assert.equal(f.call('confdesk.conference.get', {}).conference.registration.status, 'open');
  unchanged(f, () => f.event({...OPEN, event_id:'again', at:'2027-02-22T10:00:00-06:00'}), code('invalid_state'));
  const before = f.data;
  f.event({...OPEN, at:'2027-02-22T10:00:00-06:00'}); // same ID later: no-op
  assert.deepEqual(f.data, before);
});

test('preview: registration before the window opens and after it closes is refused; inside it, a preview changes nothing', () => {
  const f = fixture();
  unchanged(f, () => preview(f), code('registration_not_open'));
  const notOpened = fixture();
  notOpened.ctx.virtual_now = '2027-02-22T09:30:00-06:00'; // opens_at passed but Infra has not opened the window
  unchanged(notOpened, () => preview(notOpened), code('registration_not_open'));
  f.event(OPEN);
  f.ctx.virtual_now = '2027-02-22T09:05:00-06:00';
  const before = f.data, p = preview(f);
  assert.deepEqual(f.data, before);
  assert.match(p.preview_id, /^pv-[0-9a-z]+-[0-9a-f]{10}$/);
  assert.deepEqual([p.registration_type, p.rate, p.previewed_at, p.expires_at], ['author', {amount_cents:72000, currency:'USD'}, '2027-02-22T09:05:00-06:00', '2027-02-22T09:35:00-06:00']);
  assert.deepEqual(p.covers, f.data.conference.rate_covers);
  assert.deepEqual(p.payment_labels, f.data.payment_labels);
  assert.equal(preview(f).preview_id, p.preview_id); // same instant, same preview
  unchanged(f, () => f.call('confdesk.register.preview', {paper_id:'paper-999'}), code('not_found'));
  f.ctx.virtual_now = '2027-03-15T23:59:00-05:00'; // the last accepted instant
  preview(f);
  f.ctx.virtual_now = '2027-03-15T23:59:01-05:00';
  unchanged(f, () => preview(f), code('registration_closed'));
});

test('confirm registers the author, records the payment against the label and sends a Mail notice', () => {
  const f = fixture();
  f.event(OPEN);
  f.ctx.virtual_now = '2027-02-22T09:05:00-06:00';
  const p = preview(f);
  f.ctx.virtual_now = '2027-02-22T09:08:00-06:00';
  const out = confirm(f, p.preview_id);
  assert.deepEqual(out.registration, {id:REG, type:'author', status:'completed', paper_id:PAPER, preview_id:p.preview_id, previewed_at:'2027-02-22T09:05:00-06:00',
    completed_at:'2027-02-22T09:08:00-06:00', rate:{amount_cents:72000, currency:'USD'}, covers:f.data.conference.rate_covers, payment_label:LABEL,
    payment_id:'payment-1', created_at:'2027-02-22T09:08:00-06:00', updated_at:'2027-02-22T09:08:00-06:00',
    history:[{at:'2027-02-22T09:08:00-06:00', action:'registered'}]});
  assert.deepEqual(out.payment, {id:'payment-1', at:'2027-02-22T09:08:00-06:00', label:LABEL, amount_cents:72000, currency:'USD',
    description:'SCDA 2027 author registration, paper #214', registration_id:REG});
  assert.equal(out.letter_expected_on, '2027-03-08');
  const paper = f.call('confdesk.paper.status', {});
  assert.deepEqual([paper.paper.status, paper.paper.registration_id, paper.registered], ['in_program', REG, true]);
  assert.equal(letters(f).letter_expected_on, '2027-03-08');
  const n = f.data.notices[0];
  assert.deepEqual([n.id, n.kind, n.ref], [out.notice_id, 'registration_confirmed', {object_type:'registration', object_id:REG}]);
  assert.ok(emailMessage(n.message));
  assert.deepEqual(n.message.data.recipient, {kind:'app_account_ref', app_id:'mail', id:'mail-mingyu'});
  assert.match(n.body, /USD 720\.00, paid with First Prairie Visa ending 2291/);
  unchanged(f, () => preview(f), code('already_registered'));
});

test('confirm rejects an unknown, reused or expired preview and an unknown label; nothing is recorded', () => {
  const f = fixture();
  f.event(OPEN);
  f.ctx.virtual_now = '2027-02-22T09:05:00-06:00';
  const p = preview(f);
  f.ctx.virtual_now = '2027-02-22T09:06:00-06:00';
  const other = preview(f).preview_id;
  unchanged(f, () => confirm(f, p.preview_id, 'Some other card'), code('invalid_payment_label'));
  unchanged(f, () => confirm(f, 'pv-n0fffu5c-0000000000'), code('not_found')); // tampered hash
  unchanged(f, () => confirm(f, 'registration-please'), code('not_found'));
  f.ctx.virtual_now = '2027-02-22T09:35:01-06:00';
  unchanged(f, () => confirm(f, p.preview_id), code('preview_expired'));
  confirm(f, other); // made at 09:06, valid until 09:36
  unchanged(f, () => confirm(f, other), code('preview_used'));
  unchanged(f, () => confirm(f, p.preview_id), code('already_registered'));
  assert.equal(f.data.payments.length, 1);
  // A preview is valid up to and including its expiry instant.
  const g = fixture(); g.event(OPEN); g.ctx.virtual_now = '2027-02-22T09:05:00-06:00';
  const q = preview(g).preview_id; g.ctx.virtual_now = '2027-02-22T09:35:00-06:00';
  assert.equal(confirm(g, q).registration.previewed_at, '2027-02-22T09:05:00-06:00');
});

test('confirm rejects a preview that no longer matches the rate or the open window', () => {
  // A rate change between preview and confirm.
  const f = seeded(s => { s.conference.author_rates.push({from:'2027-03-01T00:00:00-06:00', amount_cents:80000}); });
  f.event(OPEN);
  f.ctx.virtual_now = '2027-02-28T23:50:00-06:00';
  const p = preview(f);
  assert.equal(p.rate.amount_cents, 72000);
  f.ctx.virtual_now = '2027-03-01T00:05:00-06:00';
  unchanged(f, () => confirm(f, p.preview_id), err => err.code === 'preview_mismatch' && /USD 800\.00/.test(err.message));
  const fresh = preview(f);
  assert.equal(confirm(f, fresh.preview_id).payment.amount_cents, 80000);
  // The window closes between preview and confirm.
  const g = fixture(); g.event(OPEN);
  g.ctx.virtual_now = '2027-03-15T23:50:00-05:00';
  const q = preview(g).preview_id;
  g.ctx.virtual_now = '2027-03-15T23:59:00-05:00';
  const h = fixture(); h.load(g.data); h.ctx.virtual_now = g.ctx.virtual_now;
  confirm(h, q); // still the last accepted instant
  g.ctx.virtual_now = '2027-03-15T23:59:01-05:00';
  unchanged(g, () => confirm(g, q), err => err.code === 'preview_mismatch' && /window/.test(err.message));
  // After the deadline event too (the preview itself is still unexpired at 00:00).
  g.event(deadline('2027-03-16T00:00:00-05:00'));
  unchanged(g, () => confirm(g, q), code('preview_mismatch'));
});

test('deadline.passed removes the paper when no author registered, keeps it when one did; only after closes_at', () => {
  const f = fixture(); f.event(OPEN);
  unchanged(f, () => f.event(deadline('2027-03-15T23:59:00-05:00')), code('not_due'));
  f.event(deadline());
  const paper = f.call('confdesk.paper.status', {}).paper;
  assert.deepEqual([paper.status, paper.removed_at, paper.history.at(-1).action], ['removed', '2027-03-16T07:10:00-05:00', 'removed_from_program']);
  assert.equal(f.call('confdesk.conference.get', {}).conference.registration.status, 'closed');
  const n = f.data.notices.at(-1);
  assert.deepEqual([n.kind, n.ref, n.message.data.source_object.object_type], ['paper_removed', {object_type:'paper', object_id:PAPER}, 'paper']);
  assert.ok(emailMessage(n.message));
  assert.deepEqual(f.data.events.at(-1).result, 'removed');
  unchanged(f, () => preview(f), code('paper_removed'));
  unchanged(f, () => f.event(deadline('2027-03-17T07:10:00-05:00')), code('invalid_state'));
  const before = f.data; f.event(deadline()); assert.deepEqual(f.data, before); // replay

  const g = registered();
  const notices = g.data.notices.length;
  g.event(deadline());
  assert.deepEqual([g.data.paper.status, g.data.notices.length, g.data.events.at(-1).result], ['in_program', notices, 'kept']);
  // Even without the open event, the deadline removes an unregistered paper.
  const h = fixture(); h.event(deadline()); assert.equal(h.data.paper.status, 'removed');
});

test('letter.issue issues the letter N business days after registration with the details on file (misspelled surname)', () => {
  const f = registered();
  const e = letterEvent(f);
  assert.deepEqual(e.payload.counted_days.at(-1), '2027-03-08');
  f.event(e);
  const out = letters(f), l = out.current;
  assert.deepEqual([l.id, l.kind, l.name_on_letter, l.issued_at, l.counted_from, l.due_on, l.status],
    ['letter-0388', 'original', 'ZHOU Mingyu', '2027-03-08T10:00:00-06:00', '2027-02-22', '2027-03-08', 'current']);
  assert.equal(out.letter_expected_on, null);
  assert.match(l.text, /This letter confirms that Mr\. Mingyu ZHOU, born 12 March 1998, citizen of the People's Republic of China/);
  assert.match(l.text, /Lyon, 8 March 2027/);
  assert.match(l.text, /registration SCDA27-R-0388, fee paid/);
  const n = f.data.notices.at(-1);
  assert.deepEqual(n.message.data.source_object, {app_id:'confdesk', account_id:'confdesk-mingyu', object_type:'invitation_letter', object_id:'letter-0388'});
  assert.equal(n.message.data.content.title, 'Your SCDA 2027 invitation letter');
  assert.ok(n.message.data.content.body.text.startsWith('Dear Mr. ZHOU Mingyu,'));
  assert.ok(emailMessage(n.message));
  const before = f.data; f.event(e); assert.deepEqual(f.data, before); // replay
  unchanged(f, () => f.event(letterEvent(f, '2027-03-09T10:00:00-06:00')), code('invalid_state'));
});

test('letter.issue validates the event\'s business-day computation against the desk rule and the date it is applied', () => {
  const f = registered();
  const ok = computed(f, '2027-02-22', 10);
  unchanged(f, () => f.event(letterEvent(f, undefined, {...ok, business_days:9})), code('invalid_event'));
  unchanged(f, () => f.event(letterEvent(f, undefined, {...ok, counted_from:'2027-02-23'})), code('invalid_event'));
  unchanged(f, () => f.event(letterEvent(f, undefined, {...ok, due_on:'2027-03-05'})), code('invalid_event'));
  unchanged(f, () => f.event(letterEvent(f, undefined, {...ok, counted_days:ok.counted_days.slice(1).concat('2027-03-09')})), code('invalid_event'));
  unchanged(f, () => f.event(letterEvent(f, undefined, {...ok, skipped_holidays:['2027-03-01']})), code('invalid_event'));
  unchanged(f, () => f.event(letterEvent(f, undefined, {...ok, registration_id:'SCDA27-R-0001'})), code('not_found'));
  unchanged(f, () => f.event(letterEvent(f, '2027-03-05T23:59:00-06:00')), code('not_due'));
  f.event(letterEvent(f, '2027-03-09T08:00:00-06:00')); // a late event still issues, dated by its own time
  assert.deepEqual([letters(f).current.due_on, letters(f).current.issued_at], ['2027-03-08', '2027-03-09T08:00:00-06:00']);
  const g = fixture(); g.event(OPEN);
  unchanged(g, () => g.event(letterEvent(g, undefined, ok)), code('invalid_state')); // no registration
});

test('business days: day 0 is the date in the business calendar; weekends and seeded holidays are skipped; holidays [] means none', () => {
  const cal = k.DEFAULT_CALENDAR;
  assert.ok(cal.holidays.every(h => ![0, 6].includes(d.weekday(h.date))), 'observed holidays fall on weekdays');
  assert.ok(cal.holidays.some(h => h.date.startsWith('2028')));
  assert.equal(d.addBusinessDays('2027-02-12', 1, cal), '2027-02-16'); // Presidents' Day 2027-02-15
  assert.equal(d.addBusinessDays('2027-02-12', 1, {holidays:[]}), '2027-02-15');
  assert.equal(d.addBusinessDays('2027-03-13', 12, cal), '2027-03-30'); // a Saturday request counts from Saturday
  // A seeded holiday table moves the due date and must be reported as skipped.
  const f = seeded(s => { s.business_calendar = {timezone:'America/Chicago', holidays:[{date:'2027-03-01', name:'Desk closure'}]}; });
  registered(f);
  const c = computed(f, '2027-02-22', 10);
  assert.deepEqual([c.due_on, c.skipped_holidays], ['2027-03-09', ['2027-03-01']]);
  assert.equal(f.call('confdesk.conference.get', {}).conference.business_calendar.source, 'seed');
  unchanged(f, () => f.event(letterEvent(f, '2027-03-08T10:00:00-06:00', {...c, due_on:'2027-03-08', skipped_holidays:[],
    counted_days:computed(fixture(), '2027-02-22', 10).counted_days})), code('invalid_event'));
  unchanged(f, () => f.event(letterEvent(f, '2027-03-08T10:00:00-06:00', c)), code('not_due'));
  f.event(letterEvent(f, '2027-03-09T10:00:00-06:00', c));
  // Day 0 is read in the calendar's time zone: 23:30 Chicago on 22 Feb is already 23 Feb in Lyon.
  const late = registered(fixture(), '2027-02-22T23:30:00-06:00');
  assert.equal(computed(late, '2027-02-22', 10).due_on, letters(late).letter_expected_on);
  const paris = seeded(s => { s.business_calendar = {timezone:'Europe/Paris', holidays:[]}; });
  registered(paris, '2027-02-22T23:30:00-06:00');
  assert.equal(letters(paris).letter_expected_on, '2027-03-09');
});

test('request_correction records the request, its business-day turnaround and nothing else', () => {
  const f = registered();
  unchanged(f, () => f.call('confdesk.letter.request_correction', {fields:{surname:'ZHAO'}}), code('invalid_state')); // no letter yet
  f.event(letterEvent(f));
  f.ctx.virtual_now = '2027-03-10T18:10:00-06:00';
  unchanged(f, () => f.call('confdesk.letter.request_correction', {fields:{}}), code('invalid_arguments'));
  unchanged(f, () => f.call('confdesk.letter.request_correction', {fields:{surname:'zhou'}}), code('invalid_arguments'));
  unchanged(f, () => f.call('confdesk.letter.request_correction', {fields:{date_of_birth:'1998-02-30'}}), code('invalid_arguments'));
  const out = f.call('confdesk.letter.request_correction', {fields:{surname:' Zhao '}}).correction;
  assert.deepEqual(out, {id:'correction-0388-1', at:'2027-03-10T18:10:00-06:00', via:'letter.request_correction', letter_id:'letter-0388',
    fields:{surname:'ZHAO'}, business_days:12, counted_from:'2027-03-10', expected_on:'2027-03-26', status:'pending', issued_letter_id:null,
    issued_at:null, updated_at:'2027-03-10T18:10:00-06:00', history:[{at:'2027-03-10T18:10:00-06:00', action:'correction_requested'}]});
  assert.equal(letters(f).current.name_on_letter, 'ZHOU Mingyu'); // nothing changes until the corrected letter is issued
  assert.equal(f.call('confdesk.registration.get', {}).attendee.name_on_file, 'ZHOU Mingyu');
  unchanged(f, () => f.call('confdesk.letter.request_correction', {fields:{given_names:'Ming-yu'}}), code('invalid_state'));
});

test('request_correction honours a task policy that limits the correctable fields', () => {
  const f = withLetter();
  f.ctx.virtual_now = '2027-03-10T18:10:00-06:00';
  f.ctx.policy = {allow:[], constraints:{'confdesk.letter.request_correction':{fields:['surname']}}};
  unchanged(f, () => f.call('confdesk.letter.request_correction', {fields:{nationality:'Canada'}}), code('permission_denied'));
  unchanged(f, () => f.call('confdesk.letter.request_correction', {fields:{surname:'ZHAO', nationality:'Canada'}}), code('permission_denied'));
  assert.deepEqual(f.call('confdesk.letter.request_correction', {fields:{surname:'ZHAO'}}).correction.fields, {surname:'ZHAO'});
  delete f.ctx.policy;
});

test('correction.issue issues the corrected letter after its own turnaround and supersedes the first', () => {
  const f = withLetter();
  f.ctx.virtual_now = '2027-03-10T18:10:00-06:00';
  f.call('confdesk.letter.request_correction', {fields:{surname:'ZHAO'}});
  unchanged(f, () => f.event(correctionEvent(f, '2027-03-25T10:00:00-05:00', '2027-03-10')), code('not_due'));
  unchanged(f, () => f.event(correctionEvent(f, '2027-03-26T10:00:00-05:00', '2027-03-11')), code('invalid_event'));
  unchanged(f, () => f.event(correctionEvent(f, '2027-03-26T10:00:00-05:00', '2027-03-10', {...computed(f, '2027-03-10', 10), due_on:'2027-03-24'})), code('invalid_event'));
  const e = correctionEvent(f, '2027-03-26T10:00:00-05:00', '2027-03-10');
  f.event(e);
  const out = letters(f);
  assert.deepEqual(out.letters.map(l => [l.id, l.name_on_letter, l.status, l.superseded_by]),
    [['letter-0388-c1', 'ZHAO Mingyu', 'current', null], ['letter-0388', 'ZHOU Mingyu', 'superseded', 'letter-0388-c1']]);
  assert.deepEqual([out.current.kind, out.current.correction_id, out.current.issued_at, out.current.due_on], ['corrected', 'correction-0388-1', '2027-03-26T10:00:00-05:00', '2027-03-26']);
  assert.match(out.current.text, /Mr\. Mingyu ZHAO/);
  assert.match(out.current.text, /Lyon, 26 March 2027/);
  assert.deepEqual([out.correction_requests[0].status, out.correction_requests[0].issued_letter_id], ['issued', 'letter-0388-c1']);
  assert.equal(f.call('confdesk.registration.get', {}).attendee.name_on_file, 'ZHAO Mingyu');
  const n = f.data.notices.at(-1);
  assert.deepEqual([n.kind, n.ref.object_id, n.title], ['correction_issued', 'letter-0388-c1', 'Your corrected SCDA 2027 invitation letter']);
  assert.ok(emailMessage(n.message));
  const before = f.data; f.event(e); assert.deepEqual(f.data, before); // replay
  unchanged(f, () => f.event(correctionEvent(f, '2027-03-29T10:00:00-05:00', '2027-03-10', undefined, 'another')), code('invalid_state')); // nothing pending
  // A second correction gets its own number and letter.
  f.ctx.virtual_now = '2027-03-26T11:00:00-05:00';
  assert.equal(f.call('confdesk.letter.request_correction', {fields:{date_of_birth:'1998-03-21'}}).correction.id, 'correction-0388-2');
  f.event(correctionEvent(f, '2027-04-13T10:00:00-05:00', '2027-03-26'));
  assert.deepEqual([letters(f).current.id, letters(f).current.details.surname, letters(f).current.details.date_of_birth], ['letter-0388-c2', 'ZHAO', '1998-03-21']);
});

test('the correction deadline in #49: a request on 2027-03-12 arrives 2027-03-30, before the 2027-03-31 appointment', () => {
  const f = withLetter();
  f.ctx.virtual_now = '2027-03-12T23:59:00-06:00';
  assert.equal(f.call('confdesk.letter.request_correction', {fields:{surname:'ZHAO'}}).correction.expected_on, '2027-03-30');
  f.event(correctionEvent(f, '2027-03-30T10:00:00-05:00', '2027-03-12'));
  assert.equal(letters(f).current.name_on_letter, 'ZHAO Mingyu');
});

test('the agent cannot fire Infra events or load history: no event or env operation is an Agent tool', () => {
  const tools = require('../tools.json').map(t => t.name), events = require('../app.json').event_types;
  assert.equal(tools.length, 7);
  assert.deepEqual(tools, ['confdesk.conference.get', 'confdesk.register.preview', 'confdesk.register.confirm', 'confdesk.registration.get',
    'confdesk.letter.get', 'confdesk.letter.request_correction', 'confdesk.paper.status']);
  for (const e of events) assert.ok(!tools.includes(e));
  const f = fixture();
  for (const name of [...events, 'env.apply_event', 'env.load_seed', 'env.reset']) {
    assert.throws(() => plugin.handleTool(f.ctx, f.data, name, {}), code('unknown_tool'));
  }
  const policies = require('../fixtures/policies.json');
  for (const p of Object.values(policies)) assert.ok(p.allow.every(n => tools.includes(n)));
  assert.ok(!policies.scenario.allow.includes('confdesk.register.confirm') && !policies.scenario.allow.includes('confdesk.letter.request_correction'));
});

test('Core: agent is denied Infra events, writes are idempotent per request ID with version checks, reset restores the seed', async () => {
  const prepareFile = path.resolve(__dirname, '../../../runtime/prepare.cjs');
  if (!fs.existsSync(prepareFile)) return;
  const prepared = require(prepareFile).prepare(path.resolve(__dirname, '..'));
  try {
    const m = prepared.model, seed = require('../fixtures/minimal.json');
    let s = m.create('confdesk', 'business-test', 'sandbox');
    const run = (role, name, args) => { const out = m.execute(s, role, name, args); s = out.state; return out.result; };
    assert.equal(run('agent', 'env.apply_event', {expected_version:m.version(s), event:OPEN}).status, 'permission_denied');
    assert.equal(run('agent', 'env.load_seed', {expected_version:m.version(s), data:seed}).status, 'permission_denied');
    assert.equal(run('infra', 'env.apply_event', {expected_version:m.version(s), event:OPEN}).status, 'committed');
    assert.equal(run('infra', 'env.apply_event', {expected_version:m.version(s), event:OPEN}).duplicate, true);
    s = {...s, virtual_now:'2027-02-22T09:05:00-06:00'};
    const p = run('agent', 'confdesk.register.preview', {paper_id:PAPER});
    assert.equal(p.status, 'ok');
    const v = m.version(s), args = {preview_id:p.preview_id, payment_label:LABEL, expected_version:v, request_id:'register-1'};
    assert.equal(run('agent', 'confdesk.register.confirm', {...args, expected_version:{...v, revision:v.revision + 5}, request_id:'stale'}).status, 'stale_version');
    const first = run('agent', 'confdesk.register.confirm', args);
    assert.equal(first.status, 'committed');
    const retry = run('agent', 'confdesk.register.confirm', args);
    assert.deepEqual([retry.duplicate, retry.registration.id, s.data.payments.length], [true, REG, 1]);
    assert.equal(run('agent', 'confdesk.register.confirm', {...args, payment_label:'NPU travel card ending 7710'}).status, 'idempotency_conflict');
    assert.equal(run('agent', 'confdesk.register.confirm', {...args, expected_version:m.version(s), request_id:'register-2'}).status, 'preview_used');
    assert.equal(run('infra', 'env.reset', {expected_version:m.version(s)}).status, 'ready');
    assert.deepEqual(s.data, seed);
    assert.equal(run('agent', 'confdesk.registration.get', {}).registration, null);
  } finally { prepared.cleanup(); }
});

test('seed validation accepts a full history and rejects inconsistent ones', () => {
  const task = require('../examples/task-data/seed.json');
  const f = fixture(); f.load(task); // registered, letter issued, correction pending
  f.ctx.virtual_now = '2027-03-26T09:00:00-05:00';
  f.event(correctionEvent(f, '2027-03-26T10:00:00-05:00', '2027-03-10'));
  assert.equal(letters(f).current.name_on_letter, 'ZHAO Mingyu');
  const rejects = (edit, pattern) => { const s = structuredClone(task); edit(s); assert.throws(() => fixture().load(s), pattern); };
  rejects(s => { s.registration.completed_at = '2027-02-22T08:00:00-06:00'; s.registration.created_at = s.registration.completed_at; }, /preview|window|reversed|Payment/);
  rejects(s => { s.registration.rate.amount_cents = 50000; }, /rate/);
  rejects(s => { s.registration.id = 'SCDA27-R-0001'; }, /Registration ID/);
  rejects(s => { s.payments = []; }, /exactly one payment/);
  rejects(s => { s.payments[0].label = 'Unknown card'; }, /Payment|label/);
  rejects(s => { s.letters[0].name_on_letter = 'ZHAO Mingyu'; }, /name/);
  rejects(s => { s.letters[0].issued_at = '2027-03-05T10:00:00-06:00'; s.letters[0].updated_at = s.letters[0].issued_at; s.letters[0].history[0].at = s.letters[0].issued_at; }, /before its business-day due date/);
  rejects(s => { s.letters[0].counted_from = '2027-02-23'; }, /rule|due date/);
  rejects(s => { s.correction_requests[0].expected_on = '2027-03-25'; }, /correction business-day rule/);
  rejects(s => { s.correction_requests[0].fields = {surname:'ZHOU'}; }, /repeats/);
  rejects(s => { s.attendee.details.surname = 'ZHAO'; }, /attendee details/);
  rejects(s => { s.paper.status = 'awaiting_registration'; }, /registration and the paper/);
  rejects(s => { s.notices[0].body += ' edited'; }, /Mail message/);
  rejects(s => { s.events.push(s.events[0]); }, /Duplicate applied event/);
  rejects(s => { s.mail_account_id = 'mail-other'; }, /Mail account/);
  rejects(s => { s.conference.window.closed_at = '2027-03-16T07:10:00-05:00'; s.paper.status = 'removed'; }, /registration and the paper/);
  rejects(s => { s.business_calendar = {timezone:'Mars/Olympus', holidays:[]}; }, /time zone/);
  rejects(s => { s.conference.author_rates[0].from = '2027-02-23T00:00:00-06:00'; }, /moment registration opens/);
  const removed = fixture(); removed.event(deadline());
  const r = removed.data; r.paper.removed_at = '2027-03-17T00:00:00-05:00';
  assert.throws(() => fixture().load(r), /deadline is processed/);
});

test('the snapshot holds the shapes task #49 reads as run.portals.confdesk', () => {
  const f = withLetter();
  f.ctx.virtual_now = '2027-03-10T18:08:00-06:00';
  f.call('confdesk.letter.request_correction', {fields:{surname:'ZHAO'}});
  f.event(correctionEvent(f, '2027-03-26T10:00:00-05:00', '2027-03-10'));
  const data = f.data, r = data.registration;
  assert.deepEqual({id:r.id, type:r.type, status:r.status, completed_at:r.completed_at, payment_label:r.payment_label},
    {id:REG, type:'author', status:'completed', completed_at:'2027-02-22T09:05:00-06:00', payment_label:LABEL});
  assert.deepEqual(data.letters.map(l => ({id:l.id, name_on_letter:l.name_on_letter, issued_at:l.issued_at})),
    [{id:'letter-0388', name_on_letter:'ZHOU Mingyu', issued_at:'2027-03-08T10:00:00-06:00'},
      {id:'letter-0388-c1', name_on_letter:'ZHAO Mingyu', issued_at:'2027-03-26T10:00:00-05:00'}]);
  assert.deepEqual(data.correction_requests.map(x => ({id:x.id, at:x.at, via:x.via, fields:x.fields})),
    [{id:'correction-0388-1', at:'2027-03-10T18:08:00-06:00', via:'letter.request_correction', fields:{surname:'ZHAO'}}]);
});

test('notices carry stable Mail messages; without a Mail account they carry none', () => {
  const a = withLetter(), b = withLetter();
  assert.deepEqual(a.data.notices.map(n => n.message.id), b.data.notices.map(n => n.message.id));
  assert.equal(new Set(a.data.notices.map(n => n.message.id)).size, a.data.notices.length);
  for (const n of a.data.notices) {
    assert.ok(emailMessage(n.message));
    assert.deepEqual([n.message.type, n.message.dataschema, n.message.time, n.message.source],
      ['org.pale.mail.notification.v1', 'urn:pale:email-payload:1', n.created_at, 'urn:pale:app:confdesk:account:confdesk-mingyu']);
  }
  const quiet = seeded(s => { s.mail_account_id = null; });
  registered(quiet);
  assert.equal(quiet.data.notices[0].message, null);
});

test('each README event example is valid and the four apply in order to the fixture', () => {
  const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');
  const examples = [...readme.matchAll(/```json\n(\{"event_id".*\})\n```/g)].map(m => JSON.parse(m[1]));
  assert.deepEqual(examples.map(e => e.operation).sort(), [...require('../app.json').event_types].sort());
  assert.deepEqual(examples[0], OPEN);
  const f = fixture(), byOp = Object.fromEntries(examples.map(e => [e.operation, e]));
  f.event(byOp['confdesk.registration.open']);
  f.ctx.virtual_now = '2027-02-22T09:05:00-06:00'; confirm(f, preview(f).preview_id);
  f.event(byOp['confdesk.letter.issue']);
  f.ctx.virtual_now = '2027-03-10T18:10:00-06:00'; f.call('confdesk.letter.request_correction', {fields:{surname:'ZHAO'}});
  f.event(byOp['confdesk.deadline.passed']);
  f.event(byOp['confdesk.correction.issue']);
  assert.deepEqual(f.data.events.map(e => e.result), ['opened', 'issued', 'kept', 'issued']);
});

test('optional diagnostics carry IDs only and cannot change business results', () => {
  const run = f => { registered(f); f.event(letterEvent(f)); f.ctx.virtual_now = '2027-03-10T18:10:00-06:00';
    f.call('confdesk.letter.request_correction', {fields:{surname:'ZHAO'}}); return f.data; };
  const on = fixture(), off = fixture({logging:false});
  assert.deepEqual(run(on), run(off));
  assert.ok(on.logs.length); assert.equal(off.logs.length, 0);
  assert.ok(on.logs.every(l => !/ZHOU|ZHAO|Mingyu|Visa ending|Learned Placement/.test(JSON.stringify(l))), 'logs carry IDs, not names, labels or letter text');
  const broken = fixture(); broken.ctx.log = () => { throw Error('logger offline'); };
  assert.deepEqual(run(broken), off.data);
});

test('the Web page maps its actions to declared Agent tools', () => {
  const source = fs.readFileSync(path.join(__dirname, '../gui/src/app.js'), 'utf8')
    .replace(/^import .*$/m, 'const el=()=>null,tag=()=>null,textBlock=()=>null,metadata=()=>null,mount=()=>{};')
    .replace('export const config', 'const config');
  const config = new Function(source + '\nreturn config;')();
  const tools = require('../tools.json').map(t => t.name);
  for (const tool of [config.list, config.get, ...config.actions.map(a => a.tool)]) assert.ok(tools.includes(tool), tool);
  assert.ok(config.sections().every(s => s.filter({}) === false), 'no record is selected, so the page never reads one by ID');
  assert.deepEqual(config.field('payment_label', {aux:{registration:{payment_labels:[LABEL]}}}).options, [{value:LABEL, label:LABEL}]);
});

test('reviewer renderer escapes untrusted content', () => {
  const view = require('../gui/src/view.js');
  const html = view.render([{id:'test', title:'<img src=x onerror=alert(1)>', body:'<script>bad</script>'}]);
  assert.ok(!html.includes('<img')); assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;'));
});

// Seeds may serialize objects with any key order; only array order carries meaning.
const reorder = (v, keys) => Array.isArray(v) ? v.map(x => reorder(x, keys)) : v && typeof v === 'object' ? Object.fromEntries(keys(Object.keys(v)).map(k => [k, reorder(v[k], keys)])) : v;
const KEY_ORDERS = [ks => [...ks].sort(), ks => [...ks].reverse()];

test('a seed is accepted whatever its object key order, including letters, notices and history', () => {
  const f = withLetter();
  for (const keys of KEY_ORDERS) { const g = fixture(); g.load(reorder(f.data, keys)); assert.deepEqual(g.data, reorder(f.data, keys)); }
});
