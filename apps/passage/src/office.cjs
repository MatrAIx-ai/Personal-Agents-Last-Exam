'use strict';
// Office rules shared by tools, events and seed validation: the N-business-day processing
// rule, the holiday table and signature validity. All dates are dates at the office.
const c = require('./common.cjs');
const d = require('./dates.cjs');

// Default office closures (a typical US university calendar). Used only when the seed has no
// `holidays` array; a seed that lists `holidays: []` means Monday to Friday with no holidays.
const DEFAULT_HOLIDAYS = [
  ['2026-01-01', 'New Year\'s Day'], ['2026-01-19', 'Martin Luther King Jr. Day'], ['2026-05-25', 'Memorial Day'],
  ['2026-06-19', 'Juneteenth'], ['2026-07-03', 'Independence Day (observed)'], ['2026-09-07', 'Labor Day'],
  ['2026-11-26', 'Thanksgiving Day'], ['2026-11-27', 'Day after Thanksgiving'], ['2026-12-24', 'Winter closure'], ['2026-12-25', 'Christmas Day'],
  ['2027-01-01', 'New Year\'s Day'], ['2027-01-18', 'Martin Luther King Jr. Day'], ['2027-05-31', 'Memorial Day'],
  ['2027-06-18', 'Juneteenth (observed)'], ['2027-07-05', 'Independence Day (observed)'], ['2027-09-06', 'Labor Day'],
  ['2027-11-25', 'Thanksgiving Day'], ['2027-11-26', 'Day after Thanksgiving'], ['2027-12-24', 'Christmas Day (observed)'], ['2027-12-31', 'New Year\'s Day (observed)'],
  ['2028-01-17', 'Martin Luther King Jr. Day'], ['2028-05-29', 'Memorial Day'], ['2028-06-19', 'Juneteenth'],
  ['2028-07-04', 'Independence Day'], ['2028-09-04', 'Labor Day'], ['2028-11-23', 'Thanksgiving Day'],
  ['2028-11-24', 'Day after Thanksgiving'], ['2028-12-25', 'Christmas Day']
].map(([date, name]) => ({date, name}));

const holidays = data => data.holidays ?? DEFAULT_HOLIDAYS;
const today = (data, at) => d.localDate(at, data.office.timezone);

// The App's own business-day computation: day 0 is the submission date (whatever the hour);
// count forward over Monday-Friday dates that are not holidays until `days` are counted.
function computation(data, submittedOn, days = data.rules.processing_business_days) {
  const closed = new Set(holidays(data).map(h => h.date)), counted = [], skipped = [];
  let day = submittedOn;
  for (let guard = 0; counted.length < days; guard++) {
    if (guard > 400) c.fail('invalid_state', 'The holiday table leaves no business days to count.');
    day = d.addDays(day, 1);
    const w = d.weekday(day);
    if (w === 0 || w === 6) continue;
    if (closed.has(day)) { skipped.push(day); continue; }
    counted.push(day);
  }
  return {submitted_on:submittedOn, business_days:days, counted_days:counted, skipped_holidays:skipped, due_on:counted.at(-1)};
}

const validUntil = (data, signedOn) => d.addMonths(signedOn, data.rules.signature_validity_months);

// valid on dates before valid_until; lapsed from 00:00 office time on valid_until.
function signatureStatus(data, sig, at) {
  const now = today(data, at), lapsed = now >= sig.valid_until;
  return {...c.copy(sig), status:lapsed ? 'lapsed' : 'valid', days_until_lapse:lapsed ? 0 : d.daysBetween(now, sig.valid_until)};
}
const currentSignature = (data, documentId) => data.signatures.filter(s => s.document_id === documentId)
  .sort((a, b) => c.ms(a.issued_at) - c.ms(b.issued_at) || a.id.localeCompare(b.id)).at(-1) || null;

module.exports = {DEFAULT_HOLIDAYS, holidays, today, computation, validUntil, signatureStatus, currentSignature};
