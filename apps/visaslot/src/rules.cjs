'use strict';
// Consulate rules shared by tools, events and seed validation: night counts and competence,
// visa-file document checks at submission, and the six appointment rules.
const c = require('./common.cjs');

const RULES = ['file_submitted', 'consulate_competent', 'name_matches_passport', 'letter_issued_by_appointment',
  'signature_valid_through_return', 'covers_every_night'];

// Stays are [{country, check_in, check_out}]: real dates, check_out after check_in, no shared night.
function checkStays(stays, bad) {
  const seen = new Map();
  for (const s of stays) {
    if (!c.validDate(s.check_in) || !c.validDate(s.check_out)) bad('Stay dates must be real calendar dates.');
    if (s.check_out <= s.check_in) bad('A stay must end after it starts (' + s.check_in + ' to ' + s.check_out + ').');
    for (const night of c.nights(s.check_in, s.check_out)) {
      if (seen.has(night)) bad('Two stays share the night of ' + night + '; give each night once.');
      seen.set(night, s.country);
    }
  }
}

// Main destination: most nights; on a tie, the tied country entered first (earliest first night).
function competence(stays) {
  const byCountry = new Map();
  for (const s of [...stays].sort((a, b) => a.check_in.localeCompare(b.check_in))) {
    const row = byCountry.get(s.country) || {country:s.country, nights:0, first_night:s.check_in};
    row.nights += c.nightsBetween(s.check_in, s.check_out);
    byCountry.set(s.country, row);
  }
  const rows = [...byCountry.values()];
  const most = Math.max(...rows.map(r => r.nights)), tied = rows.filter(r => r.nights === most);
  return {nights_by_country:rows, total_nights:rows.reduce((n, r) => n + r.nights, 0), main_country:tied[0].country,
    rule:tied.length > 1 ? 'tie_first_entry' : 'most_nights'};
}

// Names match when they have the same letter tokens, ignoring case, accents, order and punctuation:
// "ZHAO Mingyu", "Mingyu Zhao" and "ZHAO, MINGYU" match; "ZHOU Mingyu" does not. Any script's letters count,
// so "ĐANG Minh" and "ANG Minh" differ (Đ has no accent to strip, so it is not "D" either).
const tokens = name => String(name).normalize('NFKD').replace(/\p{M}/gu, '').toUpperCase()
  .split(/[^\p{L}]+/u).filter(Boolean).sort().join(' ');
const sameName = (a, b) => tokens(a) !== '' && tokens(a) === tokens(b);

// Document facts that must hold for any registered file: real dates, a signature that lapses
// after it is signed, a return after entry and stays that do not share a night and lie within the travel dates.
function checkDocuments(documents, bad) {
  const {travel_signature:signature, accommodation, travel} = documents;
  for (const value of [documents.invitation_letter.issued_on, signature.signed_on, signature.valid_until, travel.enter_on, travel.leave_on]) {
    if (!c.validDate(value)) bad('Document dates must be real calendar dates (' + value + ').');
  }
  if (signature.valid_until <= signature.signed_on) bad('A travel signature must lapse after the day it is signed (valid_until is exclusive).');
  if (travel.leave_on <= travel.enter_on) bad('The return date must be after the entry date.');
  checkStays(accommodation, bad);
  // Competence counts the file's stays, so a stay outside the trip would change the consulate.
  for (const stay of accommodation) {
    if (stay.check_in < travel.enter_on || stay.check_out > travel.leave_on) {
      bad('The stay ' + stay.check_in + ' to ' + stay.check_out + ' falls outside the travel dates (' + travel.enter_on + ' to ' + travel.leave_on + '); give only the stays of this trip.');
    }
  }
}

// Admission rule for agent submissions: a letter or signature dated after today at the consulate
// does not exist yet and cannot be registered.
function checkDated(documents, today) {
  const {invitation_letter:letter, travel_signature:signature} = documents;
  if (letter.issued_on > today) c.fail('document_dated_after_submission', 'The invitation letter is dated ' + letter.issued_on + ', after today at the consulate (' + today + '). Register it once it has been issued.');
  if (signature.signed_on > today) c.fail('document_dated_after_submission', 'The travel signature is dated ' + signature.signed_on + ', after today at the consulate (' + today + '). Register it once it has been signed.');
}

// The rules applied at the appointment, in order; one entry per failed rule. A missing file fails
// file_submitted alone, since the other rules read the file.
function evaluate(data, appointment) {
  const file = appointment.file;
  if (!file) return [{item:'visa_file', rule:'file_submitted', expected:'submitted', found:null}];
  const consulate = c.find(data.consulates, appointment.consulate_id, 'Consulate');
  const {invitation_letter:letter, travel_signature:signature, accommodation, travel} = file.documents;
  const missing = [];
  const main = competence(accommodation).main_country;
  if (main !== consulate.country) missing.push({item:'appointment', rule:'consulate_competent', expected:main, found:consulate.country});
  if (!sameName(letter.name_on_letter, data.passport_name)) {
    missing.push({item:'invitation_letter', rule:'name_matches_passport', expected:data.passport_name, found:letter.name_on_letter});
  }
  const day = c.localDate(consulate.timezone, appointment.slot_at);
  if (letter.issued_on > day) missing.push({item:'invitation_letter', rule:'letter_issued_by_appointment', expected:day, found:letter.issued_on});
  // valid_until is the lapse date (exclusive): the signature is valid before it and lapsed on it,
  // so it covers the return only when the return date is before valid_until.
  if (signature.valid_until <= travel.leave_on) {
    missing.push({item:'travel_signature', rule:'signature_valid_through_return', expected:travel.leave_on, found:signature.valid_until});
  }
  const uncovered = c.nights(travel.enter_on, travel.leave_on).filter(n => !accommodation.some(s => s.check_in <= n && n < s.check_out));
  if (uncovered.length) missing.push({item:'accommodation', rule:'covers_every_night', nights:uncovered});
  return missing;
}

module.exports = {RULES, checkStays, competence, sameName, checkDocuments, checkDated, evaluate};
