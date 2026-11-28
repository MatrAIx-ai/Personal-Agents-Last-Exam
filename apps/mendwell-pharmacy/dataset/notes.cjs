'use strict';
const { ms, localDate, addDays, rxExpiry, weekdayOf, DAY } = require('../src/time.cjs');

const TRIPS = [
  { from: '2025-07-12', to: '2025-07-20', people: ['p-1', 'p-2', 'p-3'], what: 'family summer trip' },
  { from: '2025-10-04', to: '2025-10-12', people: ['p-4'], what: 'Elena visits her sister' },
  { from: '2026-05-23', to: '2026-06-01', people: ['p-1', 'p-2', 'p-3'], what: 'family trip' },
  { from: '2026-12-19', to: '2026-12-28', people: ['p-1', 'p-2', 'p-3'], what: 'holiday travel' },
];
const TRAVEL = ['Vacation supply', 'Extra supply before a family trip', 'Supply for travel'];
const LOST = 'Replacement for a lost supply';
const TRAVEL_LEAD_DAYS = 14, LOST_WINDOW_DAYS = 21;
const PA = { first: 'Prior authorization form sent by the prescriber', denied: 'Chart notes sent by the prescriber', withdrawn: 'Corrected prior authorization form sent by the prescriber' };
const RENEWAL = { expired: 'The prescription has expired', used: 'The last refill has been used' };
const REVIEW_HOLDS = [
  ['Pharmacist confirming the dose with the prescriber\'s office', 'The prescriber\'s office confirmed the dose'],
  ['Checking the prescription against the medication list on file', 'Medication list check completed'],
  ['Waiting for the prescriber to confirm the quantity', 'The prescriber confirmed the quantity'],
];
const READY_HOLDS = [
  ['Pharmacist double-checking the filled bottle against the label', 'Label check completed'],
  ['Counseling note added: speak with the pharmacist at pickup', 'Counseling note reviewed by the pharmacist'],
];

const PRESCRIBER_RELEASES = [REVIEW_HOLDS[0][1], REVIEW_HOLDS[2][1]];
const OFFICE_CLOSED = new Set([
  '2025-01-01', '2025-01-20', '2025-02-17', '2025-05-26', '2025-06-19', '2025-07-04', '2025-09-01', '2025-10-13', '2025-11-11', '2025-11-27', '2025-12-24', '2025-12-25',
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26', '2026-12-24', '2026-12-25',
]);
const officeDay = date => { const day = weekdayOf(date); return day >= 1 && day <= 5 && !OFFICE_CLOSED.has(date); };
const officeHours = iso => { const t = ms(iso), clock = iso.slice(11, 16); return officeDay(localDate(t)) && clock >= '09:00' && clock < '17:00'; };
const away = (person, date) => TRIPS.some(x => x.people.includes(person) && date >= x.from && date <= x.to);
const tripAhead = (person, iso) => {
  const day = localDate(ms(iso)), limit = addDays(day, TRAVEL_LEAD_DAYS);
  return TRIPS.find(x => x.people.includes(person) && x.from > day && x.from <= limit) || null;
};

function problems(seed, steps = null) {
  const out = [];
  const by = (list, key, id) => seed[list].find(r => r[key] === id);
  const patientOf = fillId => by('prescriptions', 'rx_id', by('fills', 'fill_id', fillId).rx_id);
  for (const pr of seed.plan_requests) {
    const rx = patientOf(pr.fill_id), label = 'plan request ' + pr.plan_request_id + ' (' + pr.note + ')';
    if (pr.reason === 'prior_auth_required') {
      const earlier = seed.plan_requests.filter(x => x.fill_id === pr.fill_id && ms(x.created_at) < ms(pr.created_at)).sort((a, b) => ms(a.created_at) - ms(b.created_at)).at(-1);
      const expected = !earlier ? PA.first : earlier.state === 'denied' ? PA.denied : earlier.state === 'withdrawn' ? PA.withdrawn : null;
      if (pr.note !== expected) out.push(label + ': a prior-authorization note must be ' + (expected ? '"' + expected + '"' : 'absent after a request that was neither denied nor withdrawn'));
      if (!officeHours(pr.created_at)) out.push(label + ': the prescriber sent it at ' + pr.created_at + ', outside office hours (Monday to Friday, 09:00 to 17:00, except U.S. federal holidays and December 24)');
    } else if (TRAVEL.includes(pr.note)) {
      if (!tripAhead(rx.patient_id, pr.created_at)) out.push(label + ': no trip of ' + rx.patient_id + ' starts within ' + TRAVEL_LEAD_DAYS + ' days');
    } else if (pr.note === LOST) {
      const recent = seed.fills.some(f => f.state === 'collected' && f.fill_id !== pr.fill_id && ms(f.closed_at) < ms(pr.created_at) && ms(pr.created_at) - ms(f.closed_at) <= LOST_WINDOW_DAYS * DAY && by('prescriptions', 'rx_id', f.rx_id).patient_id === rx.patient_id && by('prescriptions', 'rx_id', f.rx_id).drug_id === rx.drug_id);
      if (!recent) out.push(label + ': no supply of that drug was collected in the ' + LOST_WINDOW_DAYS + ' days before');
    } else out.push(label + ': an early-refill note must name a trip or a lost supply');
  }
  for (const rx of seed.prescriptions) if (!officeHours(rx.received_at)) out.push('prescription ' + rx.rx_id + ': written and sent at ' + rx.received_at + ', outside office hours');
  for (const pr of seed.plan_requests) if (pr.decision && !officeHours(pr.closed_at)) out.push('plan request ' + pr.plan_request_id + ': decided at ' + pr.closed_at + ', outside business hours');
  for (const rn of seed.renewals) if (['approved', 'denied'].includes(rn.state) && !officeHours(rn.closed_at)) out.push('renewal ' + rn.renewal_id + ': answered at ' + rn.closed_at + ', outside office hours');
  for (const rn of seed.renewals) {
    const rx = by('prescriptions', 'rx_id', rn.rx_id), t = ms(rn.created_at);
    const expired = t >= rxExpiry(rx.written_on);
    const used = rx.fills_authorized - seed.fills.filter(f => f.rx_id === rx.rx_id && f.state === 'collected' && ms(f.closed_at) <= t).length;
    const expected = expired ? RENEWAL.expired : used === 0 ? RENEWAL.used : null;
    if (rn.note !== expected) out.push('renewal ' + rn.renewal_id + ' (' + rn.note + '): ' + (expected ? 'the prescription calls for "' + expected + '"' : 'the prescription had fills left and had not expired'));
  }
  const holds = steps ? new Map(steps.filter(x => x.operation === 'fill.hold_placed' || x.operation === 'fill.hold_released').map(x => [x.payload.fill_id + ' ' + x.at + ' ' + x.payload.note, x.operation])) : null;
  for (const f of seed.fills) {
    for (let i = 0; i < f.notes.length; i += 2) {
      const pair = [...REVIEW_HOLDS, ...READY_HOLDS].find(p => p[0] === f.notes[i].text);
      if (!pair) { out.push('fill ' + f.fill_id + ': hold note "' + f.notes[i].text + '" is not a pharmacist hold note'); continue; }
      const stage = f.timeline.filter(e => ms(e.at) <= ms(f.notes[i].at)).at(-1).state;
      if (REVIEW_HOLDS.includes(pair) ? stage !== 'requested' : stage !== 'ready') out.push('fill ' + f.fill_id + ': hold note "' + pair[0] + '" placed while ' + stage);
      const release = f.notes[i + 1];
      if (release && PRESCRIBER_RELEASES.includes(release.text) && !officeHours(release.at)) out.push('fill ' + f.fill_id + ': "' + release.text + '" at ' + release.at + ', outside the prescriber\'s office hours');
      if (release && release.text !== pair[1]) out.push('fill ' + f.fill_id + ': release note "' + release.text + '" does not answer "' + pair[0] + '"');
      const ended = f.state === 'cancelled' && f.cancellation && ms(f.cancellation.at) >= ms(f.notes[i].at) && i === f.notes.length - 1;
      if (!release && !ended && !(f.hold && f.hold.note === pair[0] && f.hold.placed_at === f.notes[i].at)) out.push('fill ' + f.fill_id + ': hold "' + pair[0] + '" placed at ' + f.notes[i].at + ' has no release, yet the fill is not on that hold');
      if (holds && holds.get(f.fill_id + ' ' + f.notes[i].at + ' ' + f.notes[i].text) !== 'fill.hold_placed') out.push('fill ' + f.fill_id + ': hold note at ' + f.notes[i].at + ' has no fill.hold_placed event');
      if (holds && release && holds.get(f.fill_id + ' ' + release.at + ' ' + release.text) !== 'fill.hold_released') out.push('fill ' + f.fill_id + ': release note at ' + release.at + ' has no fill.hold_released event');
    }
    if (f.hold && (!f.notes.length || f.notes.length % 2 === 0 || f.notes.at(-1).text !== f.hold.note || f.notes.at(-1).at !== f.hold.placed_at)) out.push('fill ' + f.fill_id + ': the current hold is not its last note');
  }
  if (holds) for (const [key, operation] of holds) {
    const [fillId, at] = key.split(' '), f = seed.fills.find(x => x.fill_id === fillId);
    if (!f || !f.notes.some(n => n.at === at && key === fillId + ' ' + at + ' ' + n.text)) out.push(operation + ' for ' + fillId + ' at ' + at + ' left no note');
  }
  return out;
}

module.exports = { PRESCRIBER_RELEASES, OFFICE_CLOSED, officeDay, officeHours, TRIPS, TRAVEL, LOST, PA, RENEWAL, REVIEW_HOLDS, READY_HOLDS, TRAVEL_LEAD_DAYS, LOST_WINDOW_DAYS, away, tripAhead, problems };
