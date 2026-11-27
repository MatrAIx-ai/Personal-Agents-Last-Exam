'use strict';
// Seed and state consistency. Core runs validateSeed after every load, tool call and event,
// so an invariant here can never be broken by a later write. Task seeds may hold any point of
// the history (window opened, registered, letters and corrections issued, paper removed).
const {references:bound} = require('./domain-utils.cjs');
const {fail, ms} = require('./common.cjs');
const d = require('./dates.cjs');
const k = require('./desk.cjs');
const {message} = require('./notices.cjs');

const bad = text => fail('invalid_seed', text);
// Structural equality: object key order is ignored, array order is kept.
const canon = v => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

function timeline(record, label, created) {
  if (ms(created) > ms(record.updated_at)) bad(label + ' timestamps are reversed.');
  let previous = ms(created);
  for (const entry of record.history) {
    const at = ms(entry.at);
    if (!Number.isFinite(at) || at < previous || at > ms(record.updated_at)) bad('Invalid history timeline for ' + label + '.');
    previous = at;
  }
  if (!record.history.length || previous !== ms(record.updated_at)) bad(label + ' history must include the last update.');
}

function calendar(data) {
  if (!data.business_calendar) return;
  const cal = data.business_calendar;
  if (!d.validTimeZone(cal.timezone)) bad('The business calendar time zone is not a valid IANA zone.');
  if (!cal.holidays.every(h => d.validDate(h.date))) bad('The business calendar has an invalid holiday date.');
  if (new Set(cal.holidays.map(h => h.date)).size !== cal.holidays.length) bad('Duplicate holiday date.');
}

function conference(data) {
  const conf = data.conference, w = conf.window;
  if (!d.validDate(conf.starts_on) || !d.validDate(conf.ends_on) || conf.starts_on > conf.ends_on) bad('Conference dates are invalid.');
  if (ms(w.opens_at) >= ms(w.closes_at)) bad('The registration window must open before it closes.');
  conf.author_rates.forEach((r, i) => { if (i && ms(r.from) <= ms(conf.author_rates[i - 1].from)) bad('Author rates must be in from order.'); });
  if (ms(conf.author_rates[0].from) > ms(w.opens_at)) bad('An author rate must apply from the moment registration opens.');
  if (w.opened_at !== null && (ms(w.opened_at) < ms(w.opens_at) || ms(w.opened_at) > ms(w.closes_at))) bad('opened_at must fall inside the registration window.');
  if (w.closed_at !== null && ms(w.closed_at) <= ms(w.closes_at)) bad('closed_at must come after closes_at.');
  if (w.opened_at !== null && w.closed_at !== null && ms(w.closed_at) < ms(w.opened_at)) bad('The window cannot close before it opened.');
}

function paperAndRegistration(data) {
  const conf = data.conference, w = conf.window, paper = data.paper, reg = data.registration;
  timeline(paper, paper.id, paper.created_at);
  if (ms(paper.submitted_at) > ms(paper.accepted_at) || ms(paper.created_at) > ms(paper.submitted_at)) bad('Paper submission and acceptance are out of order.');
  if (!reg) {
    if (paper.registration_id !== null || paper.status === 'in_program') bad('Paper ' + paper.id + ' cannot be in the program without a registration.');
    if ((paper.status === 'removed') !== (paper.removed_at !== null)) bad('Only a removed paper has removed_at.');
    if (paper.status === 'removed' && (w.closed_at === null || ms(paper.removed_at) !== ms(w.closed_at))) bad('A paper is removed when the deadline is processed.');
    if (paper.status === 'awaiting_registration' && w.closed_at !== null) bad('A paper still awaiting registration after the deadline must be removed.');
    if (data.payments.length || data.letters.length || data.correction_requests.length) bad('Payments, letters and corrections need a registration.');
    return;
  }
  timeline(reg, reg.id, reg.created_at);
  if (reg.id !== k.registrationId(conf)) bad('Registration ID must be ' + k.registrationId(conf) + '.');
  if (paper.status !== 'in_program' || paper.registration_id !== reg.id || paper.removed_at !== null || reg.paper_id !== paper.id) bad('The registration and the paper do not match.');
  const previewed = ms(reg.previewed_at), completed = ms(reg.completed_at);
  if (reg.preview_id !== k.previewId(data, previewed)) bad('Registration preview ID does not match previewed_at.');
  if (previewed > completed || completed > previewed + conf.preview_ttl_minutes * 60000) bad('The registration must be confirmed while its preview is valid.');
  if (w.opened_at === null || completed < ms(w.opened_at) || completed > ms(w.closes_at) || (w.closed_at !== null && completed > ms(w.closed_at))) bad('The registration must be completed while the window is open.');
  if (ms(reg.created_at) !== completed) bad('A registration is created when it is completed.');
  const then = k.rateAt(conf, reg.previewed_at), now = k.rateAt(conf, reg.completed_at);
  if (!then || then.amount_cents !== now.amount_cents || reg.rate.amount_cents !== then.amount_cents || reg.rate.currency !== conf.currency) bad('The registration rate does not match the rate schedule.');
  if (!same(reg.covers, conf.rate_covers)) bad('The registration must list what the rate covers.');
  if (!data.payment_labels.includes(reg.payment_label)) bad('The registration uses an unknown payment label.');
  if (data.payments.length !== 1) bad('A registration has exactly one payment.');
  const pay = data.payments[0];
  if (pay.id !== reg.payment_id || pay.registration_id !== reg.id || pay.label !== reg.payment_label || pay.amount_cents !== reg.rate.amount_cents ||
    pay.currency !== reg.rate.currency || ms(pay.at) !== completed) bad('Payment ' + pay.id + ' does not match the registration.');
}

function letters(data) {
  const conf = data.conference, reg = data.registration, list = data.letters, requests = data.correction_requests;
  if (!list.length) {
    if (requests.length) bad('A correction needs an issued letter.');
    return;
  }
  const ids = new Set();
  list.forEach((l, i) => {
    if (ids.has(l.id)) bad('Duplicate letter ID.');
    ids.add(l.id);
    timeline(l, l.id, l.issued_at);
    if (i && ms(l.issued_at) < ms(list[i - 1].issued_at)) bad('Letters must be in issue order.');
    if (l.registration_id !== reg.id) bad('Letter ' + l.id + ' belongs to another registration.');
    if (l.name_on_letter !== k.nameOnLetter(l.details) || !d.validDate(l.details.date_of_birth)) bad('Letter ' + l.id + ' prints a name that differs from its details.');
    if (l.due_on !== k.dueOn(data, l.counted_from, l.business_days) || k.businessDate(data, l.issued_at) < l.due_on) bad('Letter ' + l.id + ' was issued before its business-day due date.');
    const last = i === list.length - 1;
    if (last ? l.status !== 'current' || l.superseded_by !== null : l.status !== 'superseded' || l.superseded_by !== list[i + 1].id) bad('Only the newest letter is current.');
    if (i === 0) {
      if (l.kind !== 'original' || l.id !== k.letterId(conf) || l.correction_id !== null) bad('The first letter is the original ' + k.letterId(conf) + '.');
      if (l.business_days !== conf.letter_business_days || l.counted_from !== k.businessDate(data, reg.completed_at)) bad('The letter must follow the letter business-day rule from the registration date.');
      return;
    }
    const request = requests.find(r => r.id === l.correction_id);
    if (l.kind !== 'corrected' || l.id !== k.correctedLetterId(conf, i) || !request || request.issued_letter_id !== l.id) bad('Letter ' + l.id + ' must be the corrected letter of its request.');
    if (l.business_days !== request.business_days || l.counted_from !== request.counted_from || ms(l.issued_at) !== ms(request.issued_at)) bad('Letter ' + l.id + ' must follow its correction request.');
    if (!same(l.details, {...list[i - 1].details, ...request.fields})) bad('Letter ' + l.id + ' must apply exactly the requested corrections.');
  });
  if (!same(list.at(-1).details, data.attendee.details)) bad('The current letter must use the attendee details on file.');
}

function corrections(data) {
  const conf = data.conference, list = data.correction_requests, letterList = data.letters;
  list.forEach((r, i) => {
    timeline(r, r.id, r.at);
    if (r.id !== k.correctionId(conf, i + 1)) bad('Correction requests are numbered ' + k.correctionId(conf, 1) + ', -2, …');
    if (i && ms(r.at) < ms(list[i - 1].at)) bad('Correction requests must be in time order.');
    const index = letterList.findIndex(l => l.id === r.letter_id), next = letterList[index + 1];
    if (index < 0 || ms(letterList[index].issued_at) > ms(r.at) || (next && ms(next.issued_at) <= ms(r.at))) bad('Correction ' + r.id + ' must correct the letter that was current when it was requested.');
    const keys = Object.keys(r.fields);
    if (!keys.length) bad('Correction ' + r.id + ' changes nothing.');
    for (const key of keys) {
      if (key === 'surname' && r.fields.surname !== r.fields.surname.toUpperCase()) bad('Corrected surnames are stored in capitals.');
      if (key === 'date_of_birth' && !d.validDate(r.fields.date_of_birth)) bad('Correction ' + r.id + ' has an invalid date of birth.');
      const printed = key === 'surname' ? letterList[index].details.surname.toUpperCase() : letterList[index].details[key];
      if (r.fields[key] === printed) bad('Correction ' + r.id + ' repeats a printed value.');
    }
    if (r.business_days !== conf.correction_business_days || r.counted_from !== k.businessDate(data, r.at) ||
      r.expected_on !== k.dueOn(data, r.counted_from, r.business_days)) bad('Correction ' + r.id + ' does not follow the correction business-day rule.');
    const issued = r.status === 'issued';
    if (issued !== (r.issued_letter_id !== null) || issued !== (r.issued_at !== null)) bad('Only an issued correction names its letter and time.');
    if (!issued && (i !== list.length - 1 || next)) bad('Only the last correction can be pending, and no letter follows it.');
    if (issued && (!next || next.id !== r.issued_letter_id)) bad('Correction ' + r.id + ' must be issued as the letter that follows the one it corrects.');
  });
}

function validateSeed(ctx, data) {
  bound(ctx, data);
  if (data.mail_account_id !== null && !ctx.binding.accounts.some(a => a.app_id === 'mail' && a.account_id === data.mail_account_id &&
      a.owner_person_id === data.owner_person_id)) bad('The Mail account must be bound to the attendee.');
  calendar(data);
  conference(data);
  timeline(data.attendee, 'attendee', data.attendee.created_at);
  if (!d.validDate(data.attendee.details.date_of_birth)) bad('The attendee date of birth is invalid.');
  paperAndRegistration(data);
  letters(data);
  corrections(data);
  const ids = new Set(records(data).map(r => r.id));
  if (ids.size !== records(data).length) bad('Duplicate record ID.');
  if (new Set(data.payments.map(p => p.id)).size !== data.payments.length) bad('Duplicate payment ID.');
  for (const n of data.notices) {
    const ok = {registration:() => data.registration?.id === n.ref.object_id, invitation_letter:() => data.letters.some(l => l.id === n.ref.object_id),
      paper:() => data.paper.id === n.ref.object_id}[n.ref.object_type]();
    if (!ok) bad('Notice ' + n.id + ' refers to an unknown object.');
    if (!same(n.message, message(data, n))) bad('Notice ' + n.id + ' Mail message does not match the notice.');
  }
  if (new Set(data.events.map(e => e.event_id)).size !== data.events.length) bad('Duplicate applied event ID.');
}

const records = data => [data.paper, ...(data.registration ? [data.registration] : []), ...data.letters, ...data.correction_requests, ...data.notices];
module.exports = {validateSeed, records, objects:data => [data.conference.id, ...records(data).map(r => r.id), ...data.payments.map(p => p.id)],
  references:() => [], assetReferences:() => []};
