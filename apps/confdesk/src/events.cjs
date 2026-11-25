'use strict';
// Infra-applied events. Each handler observes the event's own `at` as ctx.virtual_now.
// The App never schedules itself: the Task decides when the window opens, when the deadline
// is processed and when letters are issued. Letter events carry the business-day computation
// and the desk checks it against its own rule and calendar.
const c = require('./common.cjs');
const k = require('./desk.cjs');
const {notice} = require('./notices.cjs');

function record(data, event, result, objectId) {
  data.events.push({event_id:event.event_id, at:event.at, operation:event.operation, result, object_id:objectId});
}

function open(ctx, data, event) {
  const w = data.conference.window;
  if (w.opened_at !== null) c.fail('invalid_state', 'Registration already opened at ' + w.opened_at + '.');
  if (c.ms(event.at) < c.ms(w.opens_at)) c.fail('not_due', 'Registration opens at ' + w.opens_at + '.');
  if (c.ms(event.at) > c.ms(w.closes_at)) c.fail('invalid_event', 'The registration window closed at ' + w.closes_at + '.');
  w.opened_at = event.at;
  record(data, event, 'opened', data.conference.id);
  c.log(ctx, 'confdesk.registration_open', {record_id:data.conference.id});
  return data;
}

function deadline(ctx, data, event) {
  const conf = data.conference, w = conf.window, paper = data.paper;
  if (w.closed_at !== null) c.fail('invalid_state', 'The deadline was already processed at ' + w.closed_at + '.');
  if (c.ms(event.at) <= c.ms(w.closes_at)) c.fail('not_due', 'The registration deadline is ' + w.closes_at + '; apply this event after it.');
  w.closed_at = event.at;
  if (data.registration) {
    record(data, event, 'kept', paper.id);
    c.log(ctx, 'confdesk.deadline_kept', {record_id:paper.id, registration_id:data.registration.id});
    return data;
  }
  paper.status = 'removed'; paper.removed_at = event.at;
  c.stamp(ctx, paper, 'removed_from_program', {record_id:paper.id});
  notice(ctx, data, 'paper_removed', conf.short_name + ': paper #' + paper.number + ' removed from the program',
    'Dear ' + k.addressee(data.attendee.details) + ',\n\nNo author registration for paper #' + paper.number + ', "' + paper.title +
    '", was completed by the registration deadline (' + w.closes_at + '). The paper has been removed from the ' + conf.short_name +
    ' program and proceedings.\n\n' + conf.short_name + ' Registration Desk', {object_type:'paper', object_id:paper.id});
  record(data, event, 'removed', paper.id);
  return data;
}

// Shared check of a business-day event: the payload must carry the desk's own computation
// (counting date, rule, counted days, skipped holidays and due date), and the event is applied on
// or after the due date in the business calendar. The letter is dated by the event's own time.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function checkBusinessDays(data, event, {days, from, label}) {
  const p = event.payload, expected = k.computation(data, from, days), on = k.businessDate(data, event.at);
  const wrong = ['counted_from', 'business_days', 'counted_days', 'skipped_holidays', 'due_on'].filter(key => !same(p[key], expected[key]));
  if (wrong.length) {
    c.fail('invalid_event', 'The business-day computation does not match the desk\'s rule (' + wrong.join(', ') + '). ' + label + ' is counted from ' + from +
      ' over ' + days + ' business days: counted ' + expected.counted_days.join(', ') +
      (expected.skipped_holidays.length ? '; holidays skipped ' + expected.skipped_holidays.join(', ') : '') + '; due on ' + expected.due_on + '.');
  }
  if (on < expected.due_on) c.fail('not_due', label + ' is not due until ' + expected.due_on + ' (business date now ' + on + ').');
  return expected.due_on;
}

function registrationFor(data, event) {
  const reg = data.registration;
  if (!reg) c.fail('invalid_state', 'No author registration has been completed.');
  if (event.payload.registration_id !== reg.id) c.fail('not_found', 'Registration ' + event.payload.registration_id + ' does not exist in this account.');
  return reg;
}

function issueLetter(ctx, data, event) {
  const conf = data.conference, reg = registrationFor(data, event);
  if (data.letters.some(l => l.kind === 'original')) c.fail('invalid_state', 'The invitation letter for ' + reg.id + ' was already issued.');
  const from = k.businessDate(data, reg.completed_at);
  const due = checkBusinessDays(data, event, {days:conf.letter_business_days, from, label:'The invitation letter'});
  const details = c.copy(data.attendee.details), on = k.businessDate(data, event.at);
  const letter = {id:k.letterId(conf), registration_id:reg.id, kind:'original', correction_id:null, name_on_letter:k.nameOnLetter(details), details,
    issued_at:event.at, business_days:conf.letter_business_days, counted_from:from, due_on:due, status:'current', superseded_by:null,
    text:k.letterText(data, details, on), updated_at:event.at, history:[]};
  data.letters.push(letter);
  c.stamp(ctx, letter, 'letter_issued', {record_id:letter.id, registration_id:reg.id});
  notice(ctx, data, 'letter_issued', 'Your ' + conf.short_name + ' invitation letter',
    'Dear ' + k.addressee(details) + ',\n\nYour visa invitation letter for registration ' + reg.id + ' is below. Check every detail against your passport. ' +
    'If anything is wrong, request a correction in ConfDesk; corrected letters are issued ' + conf.correction_business_days +
    ' business days after the request.\n\n----------\n' + letter.text + '\n----------', {object_type:'invitation_letter', object_id:letter.id});
  record(data, event, 'issued', letter.id);
  return data;
}

function issueCorrection(ctx, data, event) {
  const conf = data.conference, reg = registrationFor(data, event);
  const request = data.correction_requests.find(r => r.status === 'pending');
  if (!request) c.fail('invalid_state', 'No correction request is pending.');
  const due = checkBusinessDays(data, event, {days:request.business_days, from:request.counted_from, label:'Correction ' + request.id});
  const previous = data.letters.find(l => l.status === 'current'), details = {...c.copy(previous.details), ...c.copy(request.fields)};
  const n = data.letters.filter(l => l.kind === 'corrected').length + 1, on = k.businessDate(data, event.at);
  const letter = {id:k.correctedLetterId(conf, n), registration_id:reg.id, kind:'corrected', correction_id:request.id, name_on_letter:k.nameOnLetter(details),
    details, issued_at:event.at, business_days:request.business_days, counted_from:request.counted_from, due_on:due, status:'current', superseded_by:null,
    text:k.letterText(data, details, on), updated_at:event.at, history:[]};
  data.letters.push(letter);
  c.stamp(ctx, letter, 'letter_issued', {record_id:letter.id, correction_id:request.id});
  previous.status = 'superseded'; previous.superseded_by = letter.id;
  c.stamp(ctx, previous, 'superseded', {record_id:previous.id, by:letter.id});
  request.status = 'issued'; request.issued_letter_id = letter.id; request.issued_at = event.at;
  c.stamp(ctx, request, 'correction_issued', {record_id:request.id, letter_id:letter.id});
  data.attendee.details = c.copy(details);
  c.stamp(ctx, data.attendee, 'details_corrected', {correction_id:request.id});
  notice(ctx, data, 'correction_issued', 'Your corrected ' + conf.short_name + ' invitation letter',
    'Dear ' + k.addressee(details) + ',\n\nYour corrected visa invitation letter for registration ' + reg.id + ' (correction ' + request.id +
    ') is below. It replaces ' + previous.id + '.\n\n----------\n' + letter.text + '\n----------', {object_type:'invitation_letter', object_id:letter.id});
  record(data, event, 'issued', letter.id);
  return data;
}

function applyEvent(ctx, data, event) {
  // A replayed event ID is a no-op, also after a history load that already contains it.
  if (data.events.some(e => e.event_id === event.event_id)) { c.log(ctx, 'confdesk.event_replay', {event_id:event.event_id}); return data; }
  const op = event.operation;
  if (op === 'confdesk.registration.open') return open(ctx, data, event);
  if (op === 'confdesk.deadline.passed') return deadline(ctx, data, event);
  if (op === 'confdesk.letter.issue') return issueLetter(ctx, data, event);
  if (op === 'confdesk.correction.issue') return issueCorrection(ctx, data, event);
  c.fail('invalid_event', 'Unsupported operation.');
}

module.exports = {applyEvent};
