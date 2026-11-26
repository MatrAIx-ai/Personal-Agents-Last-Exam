'use strict';
// Agent tools. "Now" is ctx.virtual_now; business dates are read in the business calendar.
const c = require('./common.cjs');
const d = require('./dates.cjs');
const k = require('./desk.cjs');
const {notice} = require('./notices.cjs');

const CORRECTABLE = ['salutation', 'surname', 'given_names', 'date_of_birth', 'nationality'];

function conferenceView(ctx, data) {
  const conf = data.conference, rate = k.rateAt(conf, ctx.virtual_now), cal = k.calendar(data);
  return {id:conf.id, short_name:conf.short_name, name:conf.name, venue:conf.venue, city:conf.city, country:conf.country,
    starts_on:conf.starts_on, ends_on:conf.ends_on,
    registration:{opens_at:conf.window.opens_at, closes_at:conf.window.closes_at, status:k.windowStatus(conf, ctx.virtual_now)},
    author_rate:rate ? {amount_cents:rate.amount_cents, currency:conf.currency, from:rate.from} : null,
    author_rates:c.copy(conf.author_rates), currency:conf.currency, rate_covers:c.copy(conf.rate_covers),
    preview_ttl_minutes:conf.preview_ttl_minutes, letter_business_days:conf.letter_business_days,
    correction_business_days:conf.correction_business_days,
    business_calendar:{timezone:cal.timezone, weekend:['Saturday', 'Sunday'], holidays:c.copy(cal.holidays), source:k.calendarSource(data)},
    as_of:ctx.virtual_now};
}

function openWindow(ctx, data) {
  const conf = data.conference, status = k.windowStatus(conf, ctx.virtual_now);
  if (status === 'not_open') c.fail('registration_not_open', 'Author registration opens at ' + conf.window.opens_at + '; it is not open yet.');
  if (status === 'closed') c.fail('registration_closed', 'Author registration closed at ' + conf.window.closes_at + '.');
}

function preview(ctx, data, args) {
  const conf = data.conference, paper = data.paper;
  if (args.paper_id !== paper.id) c.fail('not_found', 'Paper does not exist in this account.');
  if (paper.status === 'removed') c.fail('paper_removed', 'Paper ' + paper.id + ' was removed from the program at ' + paper.removed_at + '.');
  if (data.registration) c.fail('already_registered', 'Paper ' + paper.id + ' already has an author registration (' + data.registration.id + ').');
  openWindow(ctx, data);
  const at = c.ms(ctx.virtual_now), parsed = k.parsePreview(data, k.previewId(data, at)), rate = k.rateAt(conf, ctx.virtual_now);
  c.log(ctx, 'confdesk.preview', {paper_id:paper.id});
  return {preview_id:k.previewId(data, at), paper_id:paper.id, registration_type:'author',
    rate:{amount_cents:rate.amount_cents, currency:conf.currency}, covers:c.copy(conf.rate_covers),
    window:{opens_at:conf.window.opens_at, closes_at:conf.window.closes_at},
    previewed_at:parsed.previewed_at, expires_at:parsed.expires_at, payment_labels:c.copy(data.payment_labels)};
}

function confirm(ctx, data, args) {
  const conf = data.conference, paper = data.paper;
  if (!data.payment_labels.includes(args.payment_label)) c.fail('invalid_payment_label', 'Unknown payment label for this account.');
  const p = k.parsePreview(data, args.preview_id);
  if (!p || p.previewed_ms > c.ms(ctx.virtual_now)) c.fail('not_found', 'Unknown registration preview.');
  if (data.registration && data.registration.preview_id === args.preview_id) c.fail('preview_used', 'This preview was already used for registration ' + data.registration.id + '.');
  if (data.registration) c.fail('already_registered', 'Paper ' + paper.id + ' already has an author registration (' + data.registration.id + ').');
  if (c.ms(ctx.virtual_now) > p.expires_ms) c.fail('preview_expired', 'The preview expired at ' + p.expires_at + '; request a new preview.');
  if (paper.status === 'removed') c.fail('preview_mismatch', 'The paper was removed from the program after this preview.');
  if (k.windowStatus(conf, ctx.virtual_now) !== 'open') c.fail('preview_mismatch', 'The registration window is no longer open (it closed at ' + conf.window.closes_at + ').');
  const then = k.rateAt(conf, p.previewed_at), now = k.rateAt(conf, ctx.virtual_now);
  if (!then || then.amount_cents !== now.amount_cents) {
    c.fail('preview_mismatch', 'The author rate changed after this preview; it is now ' + c.money(now.amount_cents, conf.currency) + '. Request a new preview.');
  }
  const id = k.registrationId(conf), paymentId = c.nextId(data.payments, 'payment');
  const registration = {id, type:'author', status:'completed', paper_id:paper.id, preview_id:args.preview_id, previewed_at:p.previewed_at,
    completed_at:ctx.virtual_now, rate:{amount_cents:then.amount_cents, currency:conf.currency}, covers:c.copy(conf.rate_covers),
    payment_label:args.payment_label, payment_id:paymentId, created_at:ctx.virtual_now, updated_at:ctx.virtual_now, history:[]};
  data.registration = registration;
  c.stamp(ctx, registration, 'registered', {record_id:id, paper_id:paper.id});
  const payment = {id:paymentId, at:ctx.virtual_now, label:args.payment_label, amount_cents:then.amount_cents, currency:conf.currency,
    description:conf.short_name + ' author registration, paper #' + paper.number, registration_id:id};
  data.payments.push(payment);
  paper.status = 'in_program'; paper.registration_id = id;
  c.stamp(ctx, paper, 'author_registered', {record_id:paper.id, registration_id:id});
  const expected = k.dueOn(data, k.businessDate(data, ctx.virtual_now), conf.letter_business_days);
  const n = notice(ctx, data, 'registration_confirmed', conf.short_name + ' author registration ' + id + ' confirmed',
    'Dear ' + k.addressee(data.attendee.details) + ',\n\nYour author registration ' + id + ' for ' + conf.short_name + ' is complete. Paper #' + paper.number +
    ', "' + paper.title + '", stays in the program.\n\nAuthor rate: ' + c.money(then.amount_cents, conf.currency) + ', paid with ' + args.payment_label +
    '. It covers: ' + conf.rate_covers.join('; ') + '.\n\nYour visa invitation letter is issued ' + conf.letter_business_days +
    ' business days after registration, on ' + expected + ', using the details on file. Corrections can be requested in ConfDesk.\n\n' + conf.short_name + ' Registration Desk',
    {object_type:'registration', object_id:id});
  return {registration:c.copy(registration), payment:c.copy(payment), notice_id:n.id, letter_expected_on:expected};
}

const current = data => data.letters.find(l => l.status === 'current') || null;
const newestFirst = list => [...list].sort((a, b) => c.ms(b.issued_at) - c.ms(a.issued_at) || b.id.localeCompare(a.id));

function letters(ctx, data) {
  const reg = data.registration, hasOriginal = data.letters.some(l => l.kind === 'original');
  const expected = reg && !hasOriginal ? k.dueOn(data, k.businessDate(data, reg.completed_at), data.conference.letter_business_days) : null;
  return {letters:c.copy(newestFirst(data.letters)), current:c.copy(current(data)), letter_expected_on:expected,
    correction_requests:c.copy(data.correction_requests)};
}

function requestCorrection(ctx, data, args) {
  const conf = data.conference, letter = current(data);
  if (!letter) c.fail('invalid_state', 'No invitation letter has been issued yet; corrections apply to an issued letter.');
  const pending = data.correction_requests.find(r => r.status === 'pending');
  if (pending) c.fail('invalid_state', 'Correction ' + pending.id + ' is already pending; its corrected letter is due on ' + pending.expected_on + '.');
  const keys = Object.keys(args.fields);
  if (!keys.length) c.fail('invalid_arguments', 'Give at least one corrected field.');
  // Core checks constraint fields only against args.patch; this tool names its fields in args.fields.
  const allowed = ctx.policy?.constraints?.['confdesk.letter.request_correction']?.fields;
  if (allowed && keys.some(key => !allowed.includes(key))) c.fail('permission_denied', 'The fields are outside the current task permissions.');
  const fields = {};
  for (const key of CORRECTABLE.filter(x => keys.includes(x))) {
    let value = args.fields[key].trim();
    if (!value) c.fail('invalid_arguments', key + ' must not be blank.');
    if (key === 'surname') value = value.toUpperCase();
    if (key === 'date_of_birth' && !d.validDate(value)) c.fail('invalid_arguments', 'date_of_birth must be a real calendar date.');
    const printed = key === 'surname' ? letter.details.surname.toUpperCase() : letter.details[key];
    if (value === printed) c.fail('invalid_arguments', 'The letter already reads ' + key + ' = ' + value + '.');
    fields[key] = value;
  }
  const n = data.correction_requests.length + 1, countedFrom = k.businessDate(data, ctx.virtual_now);
  const request = {id:k.correctionId(conf, n), at:ctx.virtual_now, via:'letter.request_correction', letter_id:letter.id, fields,
    business_days:conf.correction_business_days, counted_from:countedFrom, expected_on:k.dueOn(data, countedFrom, conf.correction_business_days),
    status:'pending', issued_letter_id:null, issued_at:null, updated_at:ctx.virtual_now, history:[]};
  data.correction_requests.push(request);
  c.stamp(ctx, request, 'correction_requested', {record_id:request.id, letter_id:letter.id, fields:Object.keys(fields)});
  return {correction:c.copy(request)};
}

function handleTool(ctx, data, name, args) {
  if (name === 'confdesk.conference.get') return {data, result:{conference:conferenceView(ctx, data)}};
  if (name === 'confdesk.register.preview') return {data, result:preview(ctx, data, args)};
  if (name === 'confdesk.register.confirm') return {data, result:confirm(ctx, data, args)};
  if (name === 'confdesk.registration.get') {
    const a = data.attendee;
    return {data, result:{registration:c.copy(data.registration),
      attendee:{details:c.copy(a.details), name_on_file:k.nameOnLetter(a.details), affiliation:a.affiliation, created_at:a.created_at},
      payment_labels:c.copy(data.payment_labels), payments:c.copy(data.payments)}};
  }
  if (name === 'confdesk.letter.get') return {data, result:letters(ctx, data)};
  if (name === 'confdesk.letter.request_correction') return {data, result:requestCorrection(ctx, data, args)};
  if (name === 'confdesk.paper.status') {
    return {data, result:{paper:c.copy(data.paper), registered:data.registration !== null, registration_deadline:data.conference.window.closes_at}};
  }
  c.fail('unknown_tool', 'Unknown confdesk operation.');
}

module.exports = {handleTool, CORRECTABLE};
