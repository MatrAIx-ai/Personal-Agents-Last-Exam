'use strict';
// Desk rules shared by tools, events and seed validation: the business calendar, the
// registration window, the author rate schedule, preview IDs, record IDs and letter text.
const {createHash} = require('node:crypto');
const c = require('./common.cjs');
const d = require('./dates.cjs');

// Default business calendar when a seed has none: US Central time, US federal holidays
// (observed dates) for 2026 to 2028. A Task replaces it with `business_calendar` in its seed;
// `holidays: []` there means Monday to Friday with no holidays.
const DEFAULT_CALENDAR = Object.freeze({timezone:'America/Chicago', holidays:Object.freeze([
  ['2026-01-01', 'New Year\'s Day'], ['2026-01-19', 'Birthday of Martin Luther King, Jr.'], ['2026-02-16', 'Washington\'s Birthday'],
  ['2026-05-25', 'Memorial Day'], ['2026-06-19', 'Juneteenth National Independence Day'], ['2026-07-03', 'Independence Day (observed)'],
  ['2026-09-07', 'Labor Day'], ['2026-10-12', 'Columbus Day'], ['2026-11-11', 'Veterans Day'], ['2026-11-26', 'Thanksgiving Day'],
  ['2026-12-25', 'Christmas Day'],
  ['2027-01-01', 'New Year\'s Day'], ['2027-01-18', 'Birthday of Martin Luther King, Jr.'], ['2027-02-15', 'Washington\'s Birthday'],
  ['2027-05-31', 'Memorial Day'], ['2027-06-18', 'Juneteenth National Independence Day (observed)'], ['2027-07-05', 'Independence Day (observed)'],
  ['2027-09-06', 'Labor Day'], ['2027-10-11', 'Columbus Day'], ['2027-11-11', 'Veterans Day'], ['2027-11-25', 'Thanksgiving Day'],
  ['2027-12-24', 'Christmas Day (observed)'], ['2027-12-31', 'New Year\'s Day (observed)'],
  ['2028-01-17', 'Birthday of Martin Luther King, Jr.'], ['2028-02-21', 'Washington\'s Birthday'], ['2028-05-29', 'Memorial Day'],
  ['2028-06-19', 'Juneteenth National Independence Day'], ['2028-07-04', 'Independence Day'], ['2028-09-04', 'Labor Day'],
  ['2028-10-09', 'Columbus Day'], ['2028-11-10', 'Veterans Day (observed)'], ['2028-11-23', 'Thanksgiving Day'], ['2028-12-25', 'Christmas Day']
].map(([date, name]) => Object.freeze({date, name})))});

const calendar = data => data.business_calendar || DEFAULT_CALENDAR;
const calendarSource = data => data.business_calendar ? 'seed' : 'default';
const businessDate = (data, instant) => d.localDate(instant, calendar(data).timezone);
const dueOn = (data, from, days) => d.addBusinessDays(from, days, calendar(data));

// The desk's own business-day computation, in the shape the letter events carry: day 0 is the
// registration (or correction request) date in the business calendar, whatever the hour; count
// forward over Monday-Friday dates that are not holidays until `days` are counted.
function computation(data, from, days) {
  const closed = new Set(calendar(data).holidays.map(h => h.date)), counted = [], skipped = [];
  let day = from;
  while (counted.length < days) {
    day = d.addDays(day, 1);
    if ([0, 6].includes(d.weekday(day))) continue;
    if (closed.has(day)) { skipped.push(day); continue; }
    counted.push(day);
  }
  return {counted_from:from, business_days:days, counted_days:counted, skipped_holidays:skipped, due_on:counted.at(-1)};
}

// An RFC 3339 time for an instant, written with the business calendar's UTC offset.
const zoned = new Map();
function inZone(data, msValue) {
  const zone = calendar(data).timezone;
  if (!zoned.has(zone)) zoned.set(zone, new Intl.DateTimeFormat('en-US', {timeZone:zone, hourCycle:'h23', year:'numeric', month:'2-digit',
    day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', timeZoneName:'longOffset'}));
  const p = Object.fromEntries(zoned.get(zone).formatToParts(new Date(msValue)).map(x => [x.type, x.value]));
  const offset = p.timeZoneName === 'GMT' ? '+00:00' : p.timeZoneName.slice(3);
  const fraction = msValue % 1000 ? '.' + String(((msValue % 1000) + 1000) % 1000).padStart(3, '0') : '';
  return p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute + ':' + p.second + fraction + offset;
}

// Window status at an instant. Registration is open only after Infra applied
// confdesk.registration.open and until closes_at (inclusive).
function windowStatus(conference, now) {
  const w = conference.window;
  if (w.closed_at !== null || c.ms(now) > c.ms(w.closes_at)) return 'closed';
  if (w.opened_at !== null && c.ms(now) >= c.ms(w.opens_at)) return 'open';
  return 'not_open';
}

// Author rate in effect at an instant: the latest row whose `from` has passed.
function rateAt(conference, at) {
  let row = null;
  for (const r of conference.author_rates) if (c.ms(r.from) <= c.ms(at)) row = r;
  return row;
}

const pad4 = n => String(n).padStart(4, '0');
const registrationId = conference => conference.registration_prefix + '-R-' + pad4(conference.registration_number);
const letterId = conference => 'letter-' + pad4(conference.registration_number);
const correctedLetterId = (conference, n) => letterId(conference) + '-c' + n;
const correctionId = (conference, n) => 'correction-' + pad4(conference.registration_number) + '-' + n;
const nameOnLetter = details => details.surname.toUpperCase() + ' ' + details.given_names;

// A preview is not stored: its ID encodes when it was made and is checked against the
// account and paper, so a preview call changes nothing. Single use is enforced at confirm.
const previewHash = (data, at) => createHash('sha256').update(['confdesk-preview', data.account_id, data.conference.id, data.paper.id, at].join('|')).digest('hex').slice(0, 10);
const previewId = (data, at) => 'pv-' + at.toString(36) + '-' + previewHash(data, at);
function parsePreview(data, id) {
  const m = /^pv-([0-9a-z]{1,12})-([0-9a-f]{10})$/.exec(id);
  if (!m) return null;
  const at = parseInt(m[1], 36);
  if (!Number.isSafeInteger(at) || previewHash(data, at) !== m[2]) return null;
  return {previewed_ms:at, expires_ms:at + data.conference.preview_ttl_minutes * 60000,
    previewed_at:inZone(data, at), expires_at:inZone(data, at + data.conference.preview_ttl_minutes * 60000)};
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = date => Number(date.slice(8, 10)) + ' ' + MONTHS[Number(date.slice(5, 7)) - 1] + ' ' + date.slice(0, 4);
const addressee = details => (details.salutation ? details.salutation + ' ' : '') + nameOnLetter(details);
const reference = details => details.salutation ? details.salutation + ' ' + details.surname.toUpperCase() : details.given_names + ' ' + details.surname.toUpperCase();

// Structured text of an invitation letter, using the details on file at issue time.
function letterText(data, details, issuedOn) {
  const conf = data.conference, paper = data.paper, reg = data.registration;
  const dates = longDate(conf.starts_on) + ' to ' + longDate(conf.ends_on);
  return [conf.short_name + ' - ' + conf.name, conf.venue + ', ' + conf.city + ', ' + dates, '',
    conf.city + ', ' + longDate(issuedOn), '', 'To the Consular Section concerned,', '',
    'This letter confirms that ' + (details.salutation ? details.salutation + ' ' : '') + details.given_names + ' ' + details.surname.toUpperCase() +
    ', born ' + longDate(details.date_of_birth) + ', citizen of ' + details.nationality + ', is a registered author of ' + conf.short_name +
    ' (registration ' + reg.id + ', fee paid). ' + conf.short_name + ' takes place at the ' + conf.venue + ', ' + conf.city + ', from ' + dates + '.', '',
    reference(details) + ' will present paper #' + paper.number + ', "' + paper.title + '"' + (paper.session ? ', in ' + paper.session : '') + '.', '',
    'The organizers do not cover travel, accommodation or living expenses of participants.', '', conf.letter_signatory].join('\n');
}

module.exports = {DEFAULT_CALENDAR, calendar, calendarSource, businessDate, dueOn, computation, inZone, windowStatus, rateAt, registrationId, letterId,
  correctedLetterId, correctionId, nameOnLetter, previewId, parsePreview, letterText, addressee, longDate};
