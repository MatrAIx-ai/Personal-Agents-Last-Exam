#!/usr/bin/env node
'use strict';
// Single source for the PALE #49 workspace seeds ("visa-bound conference trip").
//
//   node build.cjs          write every generated file next to this script
//   node build.cjs --check  rebuild in memory; exit 1 if any file on disk differs
//
// Everything here is fictional: the persona, North Plains University, SCDA,
// Northline (U.S. carrier), Aeris (non-U.S. carrier), the people and the
// documents. Immigration documents are SPECIMEN text with no real passport,
// visa, SEVIS or account numbers. Addresses use reserved example.* domains.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const OUT = __dirname;
const VIRTUAL_NOW = '2027-02-08T20:30:00-06:00';
const TZ = 'America/Chicago';

// ---------------------------------------------------------------------------
// Time helpers: "YYYY-MM-DDTHH:MM" local wall time -> ISO with the zone offset.
function offsetMinutes(tz, utcMs) {
  const name = new Intl.DateTimeFormat('en-US', {timeZone: tz, timeZoneName: 'longOffset'})
    .formatToParts(new Date(utcMs)).find(p => p.type === 'timeZoneName').value;
  const m = /GMT(?:([+-])(\d{2}):(\d{2}))?/.exec(name);
  return m[1] ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}
function at(local, tz = TZ) {
  const naive = Date.parse(local + ':00Z');
  let off = offsetMinutes(tz, naive);
  off = offsetMinutes(tz, naive - off * 60000);
  const sign = off < 0 ? '-' : '+';
  const abs = Math.abs(off);
  return local + ':00' + sign + String(Math.floor(abs / 60)).padStart(2, '0') + ':' + String(abs % 60).padStart(2, '0');
}
const ct = local => at(local, TZ);
const paris = local => at(local, 'Europe/Paris');

// ---------------------------------------------------------------------------
// MRZ (ICAO 9303) check digit: weights 7,3,1; 0-9 as is, A-Z = 10..35, '<' = 0.
function mrzCheck(s) {
  const value = c => c === '<' ? 0 : /[0-9]/.test(c) ? Number(c) : c.charCodeAt(0) - 55;
  return String([...s].reduce((sum, c, i) => sum + value(c) * [7, 3, 1][i % 3], 0) % 10);
}
const pad = (s, n) => (s + '<'.repeat(n)).slice(0, n);
const VISA = {number: 'X58S1A2', nationality: 'CHN', birth: '980312', sex: 'M', expiry: '270501', optional: 'F1SHA'};
const MRZ_LINE1 = pad('VNUSAZHAO<<MINGYU', 44);
const MRZ_DOC = pad(VISA.number, 9);
const MRZ_LINE2 = MRZ_DOC + mrzCheck(MRZ_DOC) + VISA.nationality + VISA.birth + mrzCheck(VISA.birth) +
  VISA.sex + VISA.expiry + mrzCheck(VISA.expiry) + pad(VISA.optional, 16);

// ---------------------------------------------------------------------------
// People and accounts.
const PEOPLE = [
  {person_id: 'person-mingyu', name: 'Mingyu Zhao'},
  {person_id: 'person-hartmann', name: 'Elise Hartmann'},
  {person_id: 'person-hao', name: 'Hao Chen'},
  {person_id: 'person-jordan', name: 'Jordan Patel'},
  {person_id: 'person-priya', name: 'Priya Raman'},
  {person_id: 'person-lin', name: 'Lin Wei'}
];
const OWNER = 'person-mingyu';
const ACCOUNT = {mail: 'mail-mingyu', calendar: 'calendar-mingyu', files: 'files-mingyu', notes: 'notes-mingyu', contacts: 'contacts-mingyu'};
// Task-owned Apps: the account is bound here; its seed is the App's own fixture
// (Roomline: apps/hotel/fixtures/minimal.json, account roomline-mingyu).
const TASK_ACCOUNTS = [{app_id: 'roomline', account_id: 'roomline-mingyu', owner_person_id: OWNER}];
const ME = 'mingyu.zhao@npu.example.org';
const ADDR = {
  hartmann: 'elise.hartmann@npu.example.org',
  hao: 'hao.chen@npu.example.org',
  jordan: 'jordan.patel@npu.example.org',
  priya: 'priya.raman@npu.example.org',
  lin: 'lin.wei@mail.example.net',
  chairs: 'program-chairs@scda2027.example.org',
  submissions: 'submissions@scda2027.example.org',
  confdesk: 'noreply@confdesk.scda2027.example.org',
  registration: 'registration@scda2027.example.org',
  northline: 'notifications@northline.example.com',
  northlinePromo: 'offers@northline.example.com',
  aeris: 'news@aeris.example.com',
  isso: 'isso@npu.example.org',
  gradOffice: 'ee-grad@npu.example.org',
  eeDept: 'ee-news@npu.example.org',
  rec: 'campusrec@npu.example.org',
  bank: 'alerts@firstprairie.example.com',
  health: 'studenthealth@npu.example.org',
  amazon: 'shipment-tracking@shop.example.com',
  library: 'library@npu.example.org',
  lease: 'leasing@riverside-apts.example.com',
  lab: 'mixedsignal-lab@lists.npu.example.org',
  dental: 'reminders@lakeview-dental.example.com'
};

// ---------------------------------------------------------------------------
// Mail: inbox as of 2027-02-08T20:30:00-06:00 (25 messages).
// role: relevant = cited by a rubric item; context = request background; noise.
const SCDA_TITLE = 'Learned Placement Priors for Analog Layout Migration';
const INBOX = [
  {id: 'msg-lin-munich', role: 'context', thread: 'lin-munich', from: ADDR.lin, when: '2027-02-08T18:02', read: true,
    subject: '!!!!!',
    body: `Saw your post, congrats on SCDA!! You HAVE to come to Munich. I'm around the whole second half of April and the first half of May, thesis is due in June so I'm not going anywhere. My couch is yours but fair warning, it's a very small couch. Tell me dates when you have them.

Lin`},
  {id: 'msg-aeris-promo', role: 'noise', thread: 'aeris-promo', from: ADDR.aeris, when: '2027-02-07T10:30', read: false,
    subject: 'New: nonstop Minneapolis - Munich from $698',
    body: `Our new nonstop service starts April 1. Fly direct from Minneapolis to Munich and connect onward across Europe on the Aeris network.

Basic fares are non-refundable and cannot be changed. Flex fares are fully refundable.

Aeris is a German airline. Flights shown are operated and marketed by Aeris.`},
  {id: 'msg-northline-promo', role: 'noise', thread: 'northline-promo-feb', from: ADDR.northlinePromo, when: '2027-02-06T09:15', read: false,
    subject: 'Spring fares to Europe from $598',
    body: `Explore Paris, Amsterdam, Lyon and more this spring. Book by February 28.

Basic fares are non-refundable and cannot be changed. Flex fares are fully refundable with free changes.`},
  {id: 'msg-scda-accept', role: 'relevant', thread: 'scda-214', from: ADDR.chairs, when: '2027-02-05T16:47', read: true,
    event_ref: 'evt-scda-2027',
    subject: 'SCDA 2027 decision: Paper #214 ACCEPTED',
    body: `Dear Mingyu Zhao,

Congratulations! Your paper #214, "${SCDA_TITLE}", has been accepted to SCDA 2027, the Symposium on Circuit Design Automation, April 26-29, 2027, at the Centre des Congres de Lyon, France.

Program
Your talk is scheduled in Session 9B (Analog Layout) on Thursday, April 29, 2027, 16:00-17:30 Lyon time (UTC+02:00). Every accepted paper must be presented in person by an author.

Next steps
- Camera-ready due: March 8, 2027.
- Author registration opens in ConfDesk on Monday, February 22, 2027 at 09:00 US Central (16:00 Lyon time) and closes on Monday, March 15, 2027 at 23:59 US Central. Author rate: USD 720, non-refundable. At least one author must register; papers without a registered author by the deadline will be removed from the proceedings.
- Visa invitation letters are generated in ConfDesk and issued within 10 business days of a completed registration.
- If a letter needs a correction, request it in ConfDesk (My registration > Visa letter > Request correction). Corrected letters are issued within 12 business days of the request. The registration desk cannot change letters by email.
- Authors who cannot travel because of visa restrictions may request a pre-recorded presentation with live remote Q&A by April 1, 2027.

The full registration terms are posted on the registration page.

SCDA 2027 Program Chairs`},
  {id: 'msg-jordan-room', role: 'noise', thread: 'jordan-room', from: ADDR.jordan, when: '2027-02-04T15:02', read: true,
    subject: 'congrats + hotel?',
    body: `Congrats!! I'm going too (poster). Want to split a room in Lyon? I'm probably flying in on the 25th. No pressure.

Jordan`},
  {id: 'msg-campus-rec', role: 'noise', thread: 'campus-rec', from: ADDR.rec, when: '2027-02-03T11:20', read: false,
    subject: 'Spring intramural registration is open',
    body: `Volleyball, broomball and indoor soccer leagues are open for registration until February 15. Free agents welcome.`},
  {id: 'msg-bank-statement', role: 'noise', thread: 'bank-jan', from: ADDR.bank, when: '2027-02-01T08:00', read: false,
    subject: 'Your January statement is ready',
    body: `Your January statement for your First Prairie student checking account is available in online banking. We will never ask for your password by email.`},
  {id: 'msg-qual-confirmed', role: 'relevant', thread: 'qual', from: ADDR.gradOffice, when: '2027-01-27T14:33', read: true,
    event_ref: 'evt-qual-oral',
    subject: 'Qualifying exam schedule confirmed',
    body: `Dear Mingyu,

Your oral qualifying exam is confirmed for Thursday, March 18, 2027, 9:00-11:00 am, Room 4-210, Engineering Hall. Please send your committee your written report by March 4.

EE Graduate Office`},
  {id: 'msg-health-travel', role: 'noise', thread: 'health-travel', from: ADDR.health, when: '2027-01-22T09:40', read: true,
    subject: 'Planning international travel?',
    body: `Reminder: the student health plan provides emergency coverage abroad only for trips under 30 days and does not issue the insurance certificates that some visa applications require. Consider purchasing separate travel medical insurance.`},
  {id: 'msg-hartmann-nsf', role: 'relevant', thread: 'hartmann-scda', from: ADDR.hartmann, when: '2027-01-19T10:02', read: true,
    subject: 'Re: SCDA',
    body: `If it gets in, put the travel on the NSF grant (the CCF one, not startup funds). Economy, keep every receipt.

E.H.`},
  {id: 'msg-ee-newsletter', role: 'noise', thread: 'ee-newsletter-jan', from: ADDR.eeDept, when: '2027-01-15T16:20', read: true,
    subject: 'Graduate newsletter - January',
    body: `Spring seminar lineup, new GPU cluster accounts, and a reminder that TA swap requests go through the course coordinator at least two weeks in advance.`},
  {id: 'msg-amazon-hub', role: 'noise', thread: 'amazon-hub', from: ADDR.amazon, when: '2027-01-10T17:45', read: true,
    subject: 'Your order has shipped',
    body: `Your package with "USB-C Hub 7-in-1" is on its way. Estimated delivery: Wednesday, January 13.`},
  {id: 'msg-library-due', role: 'noise', thread: 'library', from: ADDR.library, when: '2026-12-14T09:30', read: true,
    subject: 'Item due soon: "Analog Integrated Circuit Design"',
    body: `Due December 21. Renew online.`},
  {id: 'msg-hartmann-venue', role: 'noise', thread: 'hartmann-venue', from: ADDR.hartmann, when: '2026-12-02T11:11', read: true,
    subject: 'Re: where to submit',
    body: `SCDA is fine. If DATE had been earlier I'd have said DATE. Either way submit by the 1st.

E.H.`},
  {id: 'msg-scda-received', role: 'noise', thread: 'scda-214', from: ADDR.submissions, when: '2026-12-01T23:58', read: true,
    subject: 'Submission #214 received',
    body: `Your submission #214, "${SCDA_TITLE}", has been received. Decisions will be sent by February 5, 2027.`},
  {id: 'msg-lease', role: 'noise', thread: 'lease', from: ADDR.lease, when: '2026-11-05T13:10', read: true,
    subject: 'Lease renewal options for 2027-2028',
    body: `Please let us know by March 1 whether you plan to renew your lease for 2027-2028.`},
  {id: 'msg-isso-opt', role: 'noise', thread: 'isso-opt', from: ADDR.isso, when: '2026-10-30T08:15', read: true,
    subject: 'OPT and CPT workshops this November',
    body: `Information sessions for students planning internships next summer. Sign up in the ISSO portal.`},
  {id: 'msg-lab-dinner', role: 'noise', thread: 'lab-dinner', from: ADDR.lab, when: '2026-10-24T19:02', read: true,
    subject: 'Friday group dinner',
    body: `Hot pot at 7. Reply if you're in.`},
  {id: 'msg-hao-221g', role: 'relevant', thread: 'hao-back', from: ADDR.hao, when: '2026-10-21T12:05', read: true,
    subject: "Re: I'm back!!",
    body: `Finally landed yesterday. Four months in 221(g) administrative processing, missed the whole summer of experiments. Do NOT renew in the spring if you can avoid it, lol.

Hao`},
  {id: 'msg-northline-toronto', role: 'context', thread: 'northline-toronto', from: ADDR.northline, when: '2026-09-29T10:14', read: true,
    subject: 'Your trip to Toronto has been cancelled',
    body: `As requested, your trip MSP-YYZ on Thursday, October 8, 2026 has been cancelled.

Your Basic fare is non-refundable. Unused taxes and fees of USD 41.60 will be returned to the original form of payment.`},
  {id: 'msg-isso-monthly', role: 'relevant', thread: 'isso-monthly-sep', from: ADDR.isso, when: '2026-09-22T10:00', read: true,
    subject: 'ISSO Monthly: tax workshops, OPT info sessions and more',
    body: `Hi everyone,

- Tax workshop: October 14, 4-5:30 pm, Coffman Hall.
- OPT info session: October 20, online.
- Travel signatures: a travel signature on your I-20 is required to re-enter the US after a temporary trip abroad. Signatures are valid for 12 months from the date signed (6 months on OPT). Request a new one through the ISSO portal form "Travel Signature Request". Please allow 5 business days.
- Reminder: update your US address within 10 days of moving.
- Coffee hour: every Wednesday at 3 pm in the ISSO lounge.

International Student & Scholar Office`},
  {id: 'msg-isso-fall', role: 'context', thread: 'isso-fall', from: ADDR.isso, when: '2026-08-14T09:00', read: true,
    subject: 'Fall reminders for continuing students',
    body: `Welcome back! A few reminders as the semester starts:
1. Register full-time by the end of the second week of classes.
2. Keep your local address current in the student portal.
3. On-campus employment is limited to 20 hours per week during the semester.
4. Health insurance waivers are due September 15.
5. Your visa stamp is an entry document. It may expire while you are in the US; you remain in status as long as your I-20 is valid. You need an unexpired visa to re-enter the US after travel abroad (except certain short trips to Canada or Mexico). Under current State Department policy, students should apply for a new visa in their country of nationality or residence.
6. Tax filing season begins in February; watch for our workshops.
7. Report any change in your program end date to ISSO.`},
  {id: 'msg-northline-change-2', role: 'relevant', thread: 'northline-june', from: ADDR.northline, when: '2026-06-08T03:41', read: false,
    subject: 'Schedule change to your trip',
    body: `We have made another change to your trip.

Flight NL 288, Shanghai (PVG) to Minneapolis (MSP), Sunday, June 14, 2026
Previous: departs 15:45, connection in Seattle
New: departs 17:20, connection in Detroit

No action is needed if the new schedule works for you. To choose another flight at no cost, use Manage Trip.`},
  {id: 'msg-northline-change-1', role: 'relevant', thread: 'northline-june', from: ADDR.northline, when: '2026-06-04T02:15', read: false,
    subject: 'Schedule change to your trip',
    body: `We have changed the schedule of your trip.

Flight NL 288, Shanghai (PVG) to Minneapolis (MSP), Sunday, June 14, 2026
Previous: departs 13:10
New: departs 15:45

No action is needed if the new schedule works for you. To choose another flight at no cost, use Manage Trip.`},
  {id: 'msg-northline-receipt', role: 'context', thread: 'northline-june', from: ADDR.northline, when: '2026-06-03T15:40', read: true,
    subject: 'Your updated trip receipt',
    body: `Thank you for flying Northline. Your trip has been changed as requested.

NL 288 Shanghai (PVG) - Minneapolis (MSP), Sunday, June 14, 2026 (was Thursday, June 11)
Change fee: USD 0 (Flex fare). Fare difference: USD 64.00.`}
];

// Mail delivered later by the runner (env.apply_event, operation mail.deliver).
const NL_CHANGE_BODY = `Dear MINGYU ZHAO,

We have changed the schedule of your return flight on trip {{record_locator}}.

Original: NL 95, Friday, April 30, 2027, Lyon (LYS) 10:15 - Minneapolis (MSP) 16:50, 1 stop
New:      NL 95R, Friday, April 30, 2027, Lyon (LYS) 16:20 - Minneapolis (MSP) Saturday, May 1, 2027 08:10, 1 stop with an overnight connection

If the new schedule does not work for you, you can switch at no cost in Manage Trip to one of these alternatives until Friday, March 12, 2027, 23:59 US Central:
- NL 97, Friday, April 30, 2027, Lyon (LYS) 06:30 - Minneapolis (MSP) 21:45, 1 stop
- AE 3391, Friday, April 30, 2027, Lyon (LYS) 11:00 - Minneapolis (MSP) 14:20, 1 stop, operated and marketed by our partner Aeris

After that date, changes follow your fare rules and are subject to availability. If you take no action, you will travel on the new schedule.

Northline Airlines`;

function letterBody(corrected) {
  const name = corrected ? 'ZHAO' : 'ZHOU';
  return `${corrected ? 'Your corrected' : 'Your'} visa invitation letter for SCDA 2027 is below. It is also available as a PDF in ConfDesk under My registration > Visa letter.

--------------------------------------------------------------
SCDA 2027 - Symposium on Circuit Design Automation
Centre des Congres de Lyon, France, 26-29 April 2027

Lyon, {{letter_date}}

To the Consular Section concerned,

This letter confirms that Mr. Mingyu ${name}, born 12 March 1998, citizen of the People's Republic of China, passport number as entered at registration, is a registered author of SCDA 2027 (registration {{registration_id}}, fee paid). SCDA 2027 takes place at the Centre des Congres de Lyon, France, from 26 to 29 April 2027.

Mr. ${name} will present paper #214, "${SCDA_TITLE}", in Session 9B on Thursday 29 April 2027, 16:00-17:30.

The organizers do not cover travel, accommodation or living expenses of participants.

Prof. Claire Moreau
General Chair, SCDA 2027
--------------------------------------------------------------

Please check every detail against your passport. If anything is incorrect, use Request correction under My registration > Visa letter in ConfDesk. This mailbox is not monitored and replies are not processed. Corrected letters are issued within 12 business days of the request.`;
}

const TIMELINE = [
  {id: 'tl-dental-reminder', role: 'noise', kind: 'fixed', from: ADDR.dental, when: '2027-02-11T07:30', thread: 'dental',
    subject: 'Appointment reminder: Friday 9:00 am',
    body: `This is a reminder of your cleaning appointment on Friday, February 12 at 9:00 am at Lakeview Dental. Reply C to confirm.`},
  {id: 'tl-scda-camera-ready', role: 'noise', kind: 'fixed', from: ADDR.chairs, when: '2027-02-16T11:05', thread: 'scda-214',
    subject: 'SCDA 2027 camera-ready instructions and copyright form',
    body: `Dear authors,

Camera-ready papers are due on March 8, 2027 (anywhere on earth). Please use the updated template, complete the copyright form in the submission system, and keep the paper within 6 pages plus references.

SCDA 2027 Program Chairs`},
  {id: 'tl-scda-registration-open', role: 'relevant', kind: 'fixed', from: ADDR.chairs, when: '2027-02-22T09:00', thread: 'scda-registration',
    subject: 'SCDA 2027 author registration is now open',
    body: `Dear authors,

Author registration for SCDA 2027 is now open in ConfDesk: https://confdesk.scda2027.example.org

- Deadline: Monday, March 15, 2027, 23:59 US Central. Papers without a registered author by then will be removed from the proceedings.
- Author rate: USD 720. The author fee is non-refundable and there is no refundable option.
- Visa invitation letters are generated in ConfDesk and issued within 10 business days of a completed registration. Corrections must be requested in ConfDesk and are issued within 12 business days of the request.

SCDA 2027 Program Chairs`},
  {id: 'tl-lab-mock-quals', role: 'noise', kind: 'fixed', from: ADDR.lab, when: '2027-02-26T16:40', thread: 'lab-mock-quals',
    subject: 'Mock quals sign-up',
    body: `Anyone with a qual this spring: put your name on the sheet in the lab and we'll run a mock with the usual suspects. Snacks provided.

Priya`},
  {id: 'tl-lease-reminder', role: 'noise', kind: 'fixed', from: ADDR.lease, when: '2027-03-01T09:00', thread: 'lease',
    subject: 'Reminder: lease renewal decision due today',
    body: `This is a reminder that your decision on renewing for 2027-2028 is due today. Reply to this email or stop by the office.`},
  {id: 'tl-northline-schedule-change', role: 'relevant', kind: 'conditional', from: ADDR.northline, when: '2027-03-05T19:22', thread: 'northline-scda',
    condition: 'Delivered only if, at 2027-03-05T19:22:00-06:00, Mingyu holds a Northline booking (record locator {{record_locator}}) whose return is NL 95 on 2027-04-30. Infra applies the same change to that booking in the flights App at the same instant.',
    template: {record_locator: 'record locator of the booking that contains NL 95 (reference run: KQ8V3P)'},
    example_values: {record_locator: 'KQ8V3P'},
    subject: 'Schedule change for your trip {{record_locator}}',
    body: NL_CHANGE_BODY},
  {id: 'tl-scda-letter-misspelled', role: 'relevant', kind: 'rule', from: ADDR.confdesk, thread: 'scda-letter',
    rule: {after: 'completed author registration in ConfDesk', business_days: 10, local_time: '10:00', time_zone: TZ, business_day_definition: 'Monday to Friday; no holidays are observed'},
    reference: {registration_completed_at: '2027-02-22T09:05:00-06:00', deliver_at: '2027-03-08T10:00:00-06:00'},
    condition: 'Delivered only after a completed author registration. The letter always misspells the surname as ZHOU.',
    template: {registration_id: 'ConfDesk registration ID', letter_date: 'delivery date written as "8 March 2027"'},
    example_values: {registration_id: 'SCDA27-R-0388', letter_date: '8 March 2027'},
    subject: 'SCDA 2027 visa invitation letter - registration {{registration_id}}',
    body: letterBody(false)},
  {id: 'tl-northline-promo-mar', role: 'noise', kind: 'fixed', from: ADDR.northlinePromo, when: '2027-03-09T08:15', thread: 'northline-promo-mar',
    subject: 'Summer fares to Asia from $899',
    body: `Shanghai, Seoul and Tokyo this summer. Book by March 31. Basic fares are non-refundable and cannot be changed.`},
  {id: 'tl-scda-letter-corrected', role: 'relevant', kind: 'rule', from: ADDR.confdesk, thread: 'scda-letter',
    rule: {after: 'letter.request_correction accepted by ConfDesk', business_days: 12, local_time: '10:00', time_zone: TZ, business_day_definition: 'Monday to Friday; no holidays are observed'},
    reference: {correction_requested_at: '2027-03-10T18:10:00-06:00', deliver_at: '2027-03-26T10:00:00-05:00'},
    condition: 'Delivered only if a correction was requested through ConfDesk letter.request_correction. Email to the conference does not trigger it.',
    template: {registration_id: 'ConfDesk registration ID', letter_date: 'delivery date written as "26 March 2027"'},
    example_values: {registration_id: 'SCDA27-R-0388', letter_date: '26 March 2027'},
    subject: 'SCDA 2027 corrected visa invitation letter - registration {{registration_id}}',
    body: letterBody(true)},
  {id: 'tl-scda-paper-removed', role: 'relevant', kind: 'conditional', from: ADDR.chairs, when: '2027-03-16T07:10', thread: 'scda-214',
    condition: 'Delivered only if no author registration for paper #214 was completed by 2027-03-15T23:59:00-05:00.',
    subject: 'SCDA 2027: paper #214 removed from the proceedings',
    body: `Dear Mingyu Zhao,

No author registration for paper #214, "${SCDA_TITLE}", was completed by the deadline of March 15, 2027, 23:59 US Central. As announced, the paper has been removed from the SCDA 2027 program and proceedings.

SCDA 2027 Program Chairs`}
];

// ---------------------------------------------------------------------------
// Calendar: 2027-01-19 to 2027-06-10. No event here was created by the assistant.
function calendarEvents() {
  const events = [];
  const add = (id, title, startLocal, endLocal, opts = {}) => {
    const tz = opts.tz || TZ;
    events.push({
      id, uid: id + '@cal.npu.example.org', account_id: ACCOUNT.calendar, calendar_id: 'cal-mingyu', title,
      start: at(startLocal, tz), end: at(endLocal, tz), timezone: tz,
      organizer_person_id: opts.organizer || OWNER, attendees: opts.attendees || [OWNER],
      location: opts.location || '', status: 'confirmed', sequence: 0, attachments: []
    });
  };
  const day = d => new Date(Date.parse(d + 'T12:00:00Z'));
  const iso = d => d.toISOString().slice(0, 10);
  const springBreak = d => d >= '2027-03-22' && d <= '2027-03-26';
  for (let d = day('2027-01-18'); iso(d) <= '2027-05-13'; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = iso(d), dow = d.getUTCDay();
    if (springBreak(date)) continue;
    if ((dow === 2 || dow === 4) && date >= '2027-01-19')
      add('evt-ta-' + date, 'TA: EE 3101 discussion sections', date + 'T14:30', date + 'T16:20', {location: 'Engineering Hall 1-125'});
    if (dow === 1 && date >= '2027-01-25' && date <= '2027-05-10')
      add('evt-group-' + date, 'Group meeting', date + 'T10:00', date + 'T11:30',
        {organizer: 'person-hartmann', attendees: ['person-hartmann', OWNER, 'person-hao', 'person-jordan', 'person-priya'], location: 'Engineering Hall 5-301'});
  }
  add('evt-dentist', 'Dentist', '2027-02-12T09:00', '2027-02-12T10:00', {location: 'Lakeview Dental'});
  add('evt-hotpot', 'Hot pot with the lab', '2027-02-19T19:00', '2027-02-19T21:00', {attendees: [OWNER, 'person-hao', 'person-jordan', 'person-priya'], location: 'Golden Pot, Dinkytown'});
  add('evt-seminar', 'Department seminar: "Mixed-signal verification at scale"', '2027-02-24T16:00', '2027-02-24T17:00', {location: 'Engineering Hall 3-180'});
  add('evt-lease-decision', 'Tell Riverside about lease renewal', '2027-03-01T12:00', '2027-03-01T12:15');
  add('evt-qual-report', 'Qual written report due to committee', '2027-03-04T17:00', '2027-03-04T17:30');
  add('evt-camera-ready', 'SCDA camera-ready due', '2027-03-08T18:00', '2027-03-08T18:30');
  add('evt-mock-qual', 'Mock qual with Hao and Priya', '2027-03-12T13:00', '2027-03-12T15:00', {attendees: [OWNER, 'person-hao', 'person-priya'], location: 'Engineering Hall 5-301'});
  add('evt-qual-oral', 'Qualifying exam (oral)', '2027-03-18T09:00', '2027-03-18T11:00', {attendees: [OWNER, 'person-hartmann'], location: 'Engineering Hall 4-210'});
  add('evt-spring-break', 'Spring break (university)', '2027-03-22T00:00', '2027-03-27T00:00');
  add('evt-midterm-proctor', 'TA: EE 3101 midterm 2 proctoring', '2027-04-09T18:00', '2027-04-09T20:00', {location: 'Engineering Hall 1-125'});
  add('evt-scda-2027', 'SCDA 2027, Lyon', '2027-04-26T08:30', '2027-04-29T18:00', {tz: 'Europe/Paris', location: 'Centre des Congres de Lyon'});
  add('evt-scda-talk', 'SCDA talk: Session 9B (paper #214)', '2027-04-29T16:00', '2027-04-29T17:30', {tz: 'Europe/Paris', location: 'Centre des Congres de Lyon'});
  add('evt-last-class', 'Last day of classes', '2027-05-14T08:00', '2027-05-14T09:00');
  add('evt-trip-home', 'Trip home? (no details)', '2027-06-10T09:00', '2027-06-10T10:00');
  return events.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Notes: 14 assistant-memory notes (5 decisive, 9 not).
const NOTES = [
  {id: 'note-aisle-seats', role: 'distractor', when: '2027-01-29T21:10', title: 'Seat preference',
    body: 'Mingyu prefers aisle seats on flights over 4 hours.'},
  {id: 'note-gym-classes', role: 'distractor', when: '2027-01-12T07:45', title: 'Gym suggestions',
    body: 'Mingyu asked me to stop suggesting gym classes before 8 am.'},
  {id: 'note-grocery-list', role: 'distractor', when: '2026-12-03T18:20', title: 'Grocery list location',
    body: 'Mingyu: "Can you keep my grocery list in the Notes app instead of email from now on?"'},
  {id: 'note-hartmann-travel', role: 'distractor', when: '2026-11-18T16:05', title: 'Conference travel arrangements',
    body: 'Mingyu said Prof. Hartmann wants conference travel arranged by Mingyu directly, not through the department admin.'},
  {id: 'note-alerts-only', role: 'decisive', when: '2026-11-02T22:40', title: 'Chat excerpt, 2026-11-02',
    body: 'Chat excerpt (after missing a TA meeting he had agreed to in chat): "Honestly, if it\'s not in my calendar with an alert, it doesn\'t exist. Don\'t count on me remembering anything from chat."'},
  {id: 'note-no-consulate-before-qual', role: 'decisive', when: '2026-10-21T20:15', title: 'Chat excerpt, 2026-10-21',
    body: 'Chat excerpt (Mingyu forwarded Hao\'s email "Re: I\'m back!!" and added): "lol yeah. Not going near a consulate before my qual, and I\'m TA-ing all spring anyway. Summer."'},
  {id: 'note-frequent-flyer', role: 'distractor', when: '2026-09-30T19:00', title: 'Frequent-flyer profile',
    body: 'Mingyu\'s frequent-flyer number is saved in his Northline profile.'},
  {id: 'note-visa-delay-ticket', role: 'decisive', when: '2026-09-29T11:02', title: 'Chat excerpt, 2026-09-29',
    body: 'Chat excerpt (about the Toronto workshop he cancelled when his Canadian visa did not arrive in time): "They won\'t refund. That\'s the second time a visa delay ate a non-refundable ticket."'},
  {id: 'note-coffee', role: 'distractor', when: '2026-08-20T15:30', title: 'Afternoon meetings',
    body: 'Mingyu does not drink coffee after 3 pm; suggest tea places for afternoon meetings.'},
  {id: 'note-hotel-walking', role: 'distractor', when: '2026-07-12T10:25', title: 'Conference hotels',
    body: 'Mingyu likes hotels within walking distance of the venue at conferences.'},
  {id: 'note-french-consulate', role: 'distractor (lure)', when: '2026-07-02T17:50', title: 'Schengen visa, July 2026',
    body: 'Mingyu got a Schengen visa from the French consulate in Chicago for the Paris workshop and said the process was "super smooth, would use them again."'},
  {id: 'note-northline-changes', role: 'decisive', when: '2026-06-16T09:35', title: 'Chat excerpt, 2026-06-16',
    body: 'Chat excerpt (back from the June trip): "Northline changed my flight twice and I only found out at the gate. Their schedule-change emails are useless if nobody reads them."'},
  {id: 'note-paperwork-landing', role: 'decisive', when: '2026-06-02T13:20', title: 'Chat excerpt, 2026-06-02',
    body: 'Chat excerpt (rebooking the June flight back from Shanghai): "Move me to the 14th. Last time I landed the same day my paperwork ran out and I am not doing that again with anything immigration-related."'},
  {id: 'note-visa-one-year', role: 'distractor (supporting clue)', when: '2026-05-10T20:05', title: 'Chat excerpt, 2026-05-10',
    body: 'Chat excerpt: "Visa came back from the Shanghai consulate. One year again, same as last time. EE things."'}
];

// ---------------------------------------------------------------------------
// Contacts.
const CONTACTS = [
  {id: 'contact-hartmann', person: 'person-hartmann', name: 'Prof. Elise Hartmann', emails: [ADDR.hartmann], phones: ['+1 612-555-0141'],
    org: 'North Plains University, Electrical Engineering', groups: ['lab', 'advisor'], notes: 'PhD advisor. PI on the lab\'s NSF grant.', when: '2026-05-04T09:00'},
  {id: 'contact-hao', person: 'person-hao', name: 'Hao Chen', emails: [ADDR.hao], phones: ['+1 612-555-0167'],
    org: 'North Plains University, Mixed-Signal Lab', groups: ['lab'], notes: 'Labmate.', when: '2026-05-04T09:05'},
  {id: 'contact-jordan', person: 'person-jordan', name: 'Jordan Patel', emails: [ADDR.jordan], phones: ['+1 612-555-0178'],
    org: 'North Plains University, Mixed-Signal Lab', groups: ['lab'], notes: 'Labmate. Also going to SCDA 2027 (poster).', when: '2026-05-04T09:06'},
  {id: 'contact-priya', person: 'person-priya', name: 'Priya Raman', emails: [ADDR.priya], phones: ['+1 612-555-0183'],
    org: 'North Plains University, Mixed-Signal Lab', groups: ['lab'], notes: 'Labmate. Runs the mock quals.', when: '2026-05-04T09:07'},
  {id: 'contact-lin', person: 'person-lin', name: 'Lin Wei', emails: [ADDR.lin], phones: ['+49 89 99998 123'],
    org: 'PhD student, Munich', groups: ['friends'], notes: 'Lives in Munich. Offered a place to stay in late April and early May 2027.', when: '2026-07-14T12:00'},
  {id: 'contact-scda-desk', person: null, name: 'SCDA 2027 Registration Desk', emails: [ADDR.registration], phones: [],
    org: 'SCDA 2027 (ConfDesk)', groups: ['conference'], notes: 'Registration, invoices and visa invitation letters are handled in the ConfDesk portal (https://confdesk.scda2027.example.org). Letter corrections must be requested there.', when: '2027-02-05T17:05'},
  {id: 'contact-isso', person: null, name: 'International Student & Scholar Office', emails: [ADDR.isso], phones: ['+1 612-555-0100'],
    org: 'North Plains University', groups: ['university'], notes: 'Travel signatures through the ISSO portal form "Travel Signature Request".', when: '2026-05-04T09:10'},
  {id: 'contact-grad-office', person: null, name: 'EE Graduate Office', emails: [ADDR.gradOffice], phones: ['+1 612-555-0122'],
    org: 'North Plains University, Electrical Engineering', groups: ['university'], notes: '', when: '2026-05-04T09:12'}
];

// ---------------------------------------------------------------------------
// Files: folders plus synthetic text documents (bytes are assets).
const SPECIMEN = '[SPECIMEN - synthetic test document, not a real travel document]';
const DOCS = [
  {id: 'file-passport-bio', role: 'supporting', parent: 'folder-immigration', name: 'passport_bio_SPECIMEN.txt', when: '2026-05-12T21:00',
    source: 'Synthetic SPECIMEN scan text (passport biographical page)',
    text: `${SPECIMEN}
PEOPLE'S REPUBLIC OF CHINA - PASSPORT - biographical page (scan, text layer)
SPECIMEN  SPECIMEN  SPECIMEN

Type: P            Country code: CHN
Passport No.: [SPECIMEN - not shown]
Surname: ZHAO
Given names: MINGYU
Nationality: CHINESE
Sex: M
Date of birth: 12 MAR 1998
Place of birth: JIANGSU
Date of issue: 12 JUN 2021
Date of expiry: 11 JUN 2031
Authority: [SPECIMEN]

SPECIMEN  SPECIMEN  SPECIMEN
${SPECIMEN}
`},
  {id: 'file-us-visa', role: 'decisive', parent: 'folder-immigration', name: 'us_visa_photo_SPECIMEN.txt', when: '2026-05-10T20:00',
    source: 'Synthetic SPECIMEN phone photo of the visa page, automatic OCR text',
    text: `${SPECIMEN}
Phone photo of the visa page in the passport. Automatic OCR text; some fields unreadable.
SPECIMEN  SPECIMEN  SPECIMEN

UNITED STATES OF AMERICA - NONIMMIGRANT VISA
Issuing Post Name: SHANGHAI        Control Number: 2026[unreadable]
Surname: ZHAO
Given Name: MINGYU
Visa Type/Class: R  F1             Entries: M
Passport Number: [SPECIMEN - not shown]
Sex: M        Birth Date: 12MAR1998
Nationality: CHN
Issue Date: 02MAY2026              Expiration Date: [glare - unreadable]
Annotation: SEVIS ID [redacted]  NORTH PLAINS UNIVERSITY

Machine-readable zone (OCR):
${MRZ_LINE1}
${MRZ_LINE2}

SPECIMEN  SPECIMEN  SPECIMEN
${SPECIMEN}
`},
  {id: 'file-i20-travel', role: 'decisive', parent: 'folder-immigration', name: 'i20_page2_travel_endorsement_SPECIMEN.txt', when: '2026-05-12T21:05',
    source: 'Synthetic SPECIMEN scan text (Form I-20 page 2)',
    text: `${SPECIMEN}
Form I-20, Certificate of Eligibility for Nonimmigrant Student Status - page 2 (scan, text layer)
SPECIMEN  SPECIMEN  SPECIMEN

Student: ZHAO, MINGYU          SEVIS ID: [redacted]
School: North Plains University
Program: Doctorate, Electrical Engineering
Program start date: 08/21/2023   Program end date: 05/31/2028

Travel Endorsement
"This page, when properly endorsed, may be used for re-entry of the student to attend the same school after a temporary absence from the United States."

Designated School Official: [signed]
Title: International Student Advisor
Date: 03/09/2026

SPECIMEN  SPECIMEN  SPECIMEN
${SPECIMEN}
`},
  {id: 'file-schengen-2026', role: 'supporting (lure)', parent: 'folder-immigration', name: 'schengen_visa_FR_2026_SPECIMEN.txt', when: '2026-07-02T17:40',
    source: 'Synthetic SPECIMEN scan text (Schengen visa sticker)',
    text: `${SPECIMEN}
Schengen visa sticker (scan, text layer)
SPECIMEN  SPECIMEN  SPECIMEN

VISA  Type: C
Issued in: CHICAGO (FRANCE)
Valid for: ETATS SCHENGEN
From: 03-07-2026   Until: 21-07-2026
Duration of stay: 10 days   Number of entries: 1
Surname, name: ZHAO MINGYU
Passport number: [SPECIMEN - not shown]
Remarks: CONFERENCE / WORKSHOP

SPECIMEN  SPECIMEN  SPECIMEN
${SPECIMEN}
`},
  {id: 'file-travel-policy', role: 'decisive', parent: 'folder-lab', name: 'NPU_Travel_Policy_2026_excerpt.txt', when: '2026-08-20T10:00',
    source: 'Synthetic policy excerpt paraphrasing public Fly America guidance',
    text: `NORTH PLAINS UNIVERSITY - TRAVEL POLICY (effective July 1, 2026)
Excerpt, sections 3-6

3. Booking. Travelers may book directly with airlines or through the university travel portal. Keep itemized receipts and boarding passes.

4. Airfare.
4.1 Economy class is required for all flights.
4.2 Refundable or changeable fares are reimbursable when the traveler documents a business reason, for example a pending visa or an unconfirmed program schedule.
4.3 Fly America. Trips charged to federally sponsored awards (for example NSF, NIH, DOE, DoD) are subject to the Fly America Act: international air travel must be on U.S. flag air carriers. A flight operated by a foreign carrier is allowed only when it is sold under a U.S. carrier's flight number (code share). Airfare that does not comply cannot be charged to the award unless the award's principal investigator approves an exception in writing before the ticket is purchased.
4.4 Personal days. Personal days before or after the business portion of a trip may be booked on the same ticket. The award reimburses that ticket up to the cost of a comparison round trip between the traveler's home airport and the business destination (for a conference, the conference city) on the business dates, in the same class and fare type, quoted at the time of booking. The traveler pays any difference. Keep the comparison quote with the receipt. Section 4.3 applies to the whole ticket.

5. Lodging. Reimbursed at actual cost up to the federal per-diem rate for the location, for business nights only.

6. Meals. Per diem, reduced for meals provided by a conference.
`},
  {id: 'file-consulate-de', role: 'decisive', parent: 'folder-visa-info', name: 'Schengen_visa_guidance_Germany_Chicago.txt', when: '2026-06-15T22:10',
    source: 'Synthetic summary paraphrasing public Schengen short-stay guidance',
    text: `Consulate General of Germany, Chicago - Schengen short-stay visa (type C)
Guidance for applicants residing in the consular district (includes Minnesota). Saved from the consulate website.

Where to apply
Apply at the consulate of the Schengen country that is your main destination. If your trip covers more than one Schengen country, the main destination is the country where you will spend the most nights. If the number of nights is equal, apply at the consulate of the country you will enter first. We cannot accept applications for trips whose main destination is another Schengen country.

When to apply
No earlier than 6 months and no later than 15 calendar days before your trip. A decision is normally made within 15 calendar days of the appointment; in individual cases this can be extended up to 45 days.

Appointments
Appointments are booked online only and are free of charge. The visa fee (EUR 90) is paid at the appointment.

What to bring (students residing in the US)
- Passport
- Current Form I-20 with a valid travel signature
- I-94 record
- Flight reservation
- Proof of accommodation for every night
- Travel medical insurance certificate (minimum EUR 30,000 coverage)
- Proof of funds
- For conference attendance: the official invitation letter from the organizer
Names on all supporting documents must match the passport exactly. Applications missing a required document are refused or must be rebooked.
`},
  {id: 'file-consulate-fr', role: 'decisive', parent: 'folder-visa-info', name: 'Schengen_visa_guidance_France_Chicago.txt', when: '2026-06-15T22:05',
    source: 'Synthetic summary paraphrasing public Schengen short-stay guidance',
    text: `Consulate General of France, Chicago - Schengen short-stay visa (type C)
Guidance for applicants residing in the consular district (includes Minnesota). Saved from the consulate website.

Competent consulate
You must apply at the consulate of the Schengen country that is your main destination. When a trip covers several Schengen countries, the main destination is the country of the longest stay, counted in nights. If the number of nights is the same, apply at the consulate of the first country of entry. Applications for which France is not the competent country are not accepted.

Timing
Apply no earlier than 6 months and no later than 15 calendar days before departure. Processing normally takes 15 calendar days from the appointment and may be extended up to 45 days.

Appointments and fees
Appointments are booked online. The appointment is free; the visa fee (EUR 90) is paid at the appointment.

Required documents (students residing in the US)
- Passport
- Form I-20 with a valid travel signature
- I-94 record
- Flight reservation
- Proof of accommodation for the entire stay
- Travel medical insurance certificate (minimum EUR 30,000 coverage)
- Proof of sufficient funds
- For a conference: the official invitation letter from the organizer
The applicant's name must be spelled exactly as in the passport on all documents. Incomplete applications are refused or must be rebooked.
`},
  {id: 'file-scda-terms', role: 'decisive', parent: 'folder-scda27', name: 'SCDA2027_registration_terms.txt', when: '2027-02-05T17:10',
    source: 'Synthetic conference registration terms',
    text: `SCDA 2027 - Symposium on Circuit Design Automation
Centre des Congres de Lyon, France, April 26-29, 2027
Registration terms (saved from the registration page)

1. Registration is handled in ConfDesk (https://confdesk.scda2027.example.org). Author registration opens Monday, February 22, 2027 at 09:00 US Central (16:00 Lyon time) and closes Monday, March 15, 2027 at 23:59 US Central.
2. Each accepted paper requires at least one author registration at the author rate by the deadline. Papers without a registered author are removed from the program and proceedings.
3. Author rate: USD 720. The author fee is non-refundable and non-transferable. There is no refundable author rate.
4. Visa invitation letters are generated in ConfDesk and issued within 10 business days of a completed registration.
5. Corrections to a letter must be requested in ConfDesk (My registration > Visa letter > Request correction). Corrected letters are issued within 12 business days of the request. Requests sent by email are not processed.
6. Every accepted paper must be presented in person by an author in its assigned session. Authors who cannot travel because of visa restrictions may request a pre-recorded presentation with live remote Q&A by April 1, 2027.
7. The organizers do not cover travel, accommodation or living expenses.
`},
  {id: 'file-camera-ready', role: 'noise', parent: 'folder-scda27', name: 'SCDA27_camera_ready_checklist.txt', when: '2027-02-06T14:20',
    source: 'Synthetic lab document',
    text: `SCDA 2027 camera-ready checklist (paper #214)
- Address reviewer 2's comment on the migration baseline
- Re-run Table 3 with the fixed seed
- Copyright form in the submission system
- 6 pages plus references, updated template
- Due March 8, 2027 (anywhere on earth)
`},
  {id: 'file-group-notes', role: 'noise', parent: 'folder-lab', name: 'group_meeting_notes_2027-02-01.md', when: '2027-02-01T11:40',
    source: 'Synthetic lab document',
    text: `# Group meeting, 2027-02-01

- Hao: tape-out review moved to March; needs layout help in week 9.
- Jordan: SCDA poster submitted; waiting on decision.
- Mingyu: SCDA decision due Feb 5; qual report draft to Prof. Hartmann by Feb 20.
- Priya: mock quals in early March, sign-up sheet in the lab.
- Lab cluster maintenance Feb 13, 8 am - noon.
`},
  {id: 'file-lease', role: 'noise', parent: 'folder-personal', name: 'lease_2026-2027_summary.txt', when: '2026-08-01T12:00',
    source: 'Synthetic personal document',
    text: `Riverside Apartments - lease summary
Term: August 1, 2026 to July 31, 2027
Renewal decision due: March 1, 2027
Rent due on the 1st; maintenance requests through the resident portal.
`},
  {id: 'file-health-card', role: 'noise', parent: 'folder-personal', name: 'health_insurance_card_2026_summary.txt', when: '2026-08-25T09:30',
    source: 'Synthetic personal document',
    text: `North Plains University Student Health Plan 2026-2027
Member: MINGYU ZHAO    Member ID: [SPECIMEN - not shown]
Coverage: August 15, 2026 to August 14, 2027
Emergency coverage abroad: trips under 30 days only. Visa insurance certificates are not issued.
`}
];
const FOLDERS = [
  {id: 'folder-documents', parent: null, name: 'Documents', when: '2026-05-10T19:55'},
  {id: 'folder-personal', parent: 'folder-documents', name: 'Personal', when: '2026-05-10T19:56'},
  {id: 'folder-immigration', parent: 'folder-personal', name: 'Immigration', when: '2026-05-10T19:57'},
  {id: 'folder-visa-info', parent: 'folder-personal', name: 'Visa info', when: '2026-06-15T22:00'},
  {id: 'folder-lab', parent: 'folder-documents', name: 'Lab', when: '2026-05-10T19:58'},
  {id: 'folder-scda27', parent: 'folder-lab', name: 'SCDA27', when: '2027-02-05T17:08'}
];

// ---------------------------------------------------------------------------
// Builders.
const historyOf = stampAt => ({created_at: stampAt, updated_at: stampAt, history: [{at: stampAt, action: 'seeded'}]});
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const assetIdFor = fileId => 'asset-' + fileId.replace(/^file-/, '');

function mailMessage(m, received) {
  const msg = {id: m.id, thread_id: m.thread, account_id: ACCOUNT.mail, from: m.from, to: [ME], subject: m.subject, body: m.body,
    received_at: received, folder: 'inbox', read: m.read ?? false, attachments: []};
  if (m.event_ref) msg.event_ref = {app_id: 'calendar', account_id: ACCOUNT.calendar, object_id: m.event_ref};
  return msg;
}

function build() {
  const out = {};
  const mail = {account_id: ACCOUNT.mail, owner_person_id: OWNER, address: ME,
    messages: INBOX.map(m => mailMessage(m, ct(m.when))).sort((a, b) => Date.parse(b.received_at) - Date.parse(a.received_at))};
  const calendar = {account_id: ACCOUNT.calendar, owner_person_id: OWNER, calendar_id: 'cal-mingyu', timezone: TZ, events: calendarEvents()};
  const notes = {account_id: ACCOUNT.notes, owner_person_id: OWNER, notes: NOTES.map(n => ({
    id: n.id, account_id: ACCOUNT.notes, ...historyOf(ct(n.when)), title: n.title, body: n.body,
    tags: ['memory'], pinned: false, archived: false, trashed: false, attachments: [], revisions: []}))};
  const contacts = {account_id: ACCOUNT.contacts, owner_person_id: OWNER, contacts: CONTACTS.map(c => ({
    id: c.id, account_id: ACCOUNT.contacts, ...historyOf(ct(c.when)), display_name: c.name, person_id: c.person,
    emails: c.emails, phones: c.phones, organization: c.org, groups: c.groups, notes: c.notes, archived: false}))};
  const files = {account_id: ACCOUNT.files, owner_person_id: OWNER, files: [
    ...FOLDERS.map(f => ({id: f.id, account_id: ACCOUNT.files, ...historyOf(ct(f.when)), name: f.name, parent_id: f.parent, kind: 'folder', trashed: false, versions: []})),
    ...DOCS.map(d => ({id: d.id, account_id: ACCOUNT.files, ...historyOf(ct(d.when)), name: d.name, parent_id: d.parent, kind: 'file', trashed: false,
      versions: [{number: 1, asset_id: assetIdFor(d.id), at: ct(d.when), source: d.source}]}))]};

  const seeds = {mail, calendar, files, notes, contacts};
  const objectsOf = {mail: mail.messages.map(x => x.id), calendar: calendar.events.map(x => x.id), files: files.files.map(x => x.id),
    notes: notes.notes.map(x => x.id), contacts: contacts.contacts.map(x => x.id)};
  const binding = {
    people: PEOPLE,
    accounts: [...Object.entries(ACCOUNT).map(([app_id, account_id]) => ({app_id, account_id, owner_person_id: OWNER})), ...TASK_ACCOUNTS],
    objects: objectsOf
  };
  for (const [app, seed] of Object.entries(seeds)) out[app + '.seed.json'] = seed;
  out['binding.json'] = binding;

  // Asset bundles (dataset + catalog + base64 blobs) for env.load_seed / env.validate_bundle.
  const fileAssets = DOCS.map(d => ({d, bytes: Buffer.from(d.text, 'utf8')}));
  for (const [app, seed] of Object.entries(seeds)) {
    const datasetId = 'pale49-' + app;
    const assets = app === 'files' ? fileAssets.map(({d, bytes}) => ({
      schema_version: 'pale.asset-descriptor.v1', asset_id: assetIdFor(d.id), scope: {level: 'package', app_id: 'files'},
      roles: ['content.attachment'], subjects: [{app_id: 'files', account_id: ACCOUNT.files, object_type: 'file', object_id: d.id}],
      mime_type: 'text/plain', availability: {status: 'ready'},
      storage: {adapter: 'storage.file', path: 'assets/files/' + d.name, packaging: 'bundled'},
      integrity: {bytes: bytes.length, sha256: sha(bytes)}, provenance: {dataset_id: datasetId, source_ids: ['authored']},
      publication: 'public', access: {audience: ['agent'], rule: 'parent_object'}, media: {}, extensions: []})) : [];
    out['bundles/' + app + '.bundle.json'] = {
      dataset: {schema_version: 'pale.dataset.v1', dataset_id: datasetId, version: '1.0.0',
        description: 'PALE task #49 (visa-bound conference trip): hand-authored synthetic ' + app + ' records for Mingyu Zhao.',
        record_source_ids: ['authored'],
        sources: [{source_id: 'authored', kind: 'synthetic', description: 'Hand-authored fictional records; no external collection, no real identifiers.',
          uri: null, license: 'MIT', usage: 'permitted', collection: null,
          generation: {method: 'manual', tool: 'wt49/tasks/visa-bound-conference-trip/workspace/build.cjs', tool_version: '1.0.0', seed: null, parameters: {}}}],
        transformations: ['Local wall times converted to ISO 8601 with the America/Chicago or Europe/Paris offset.'],
        expected_counts: {records: objectsOf[app].length, assets: assets.length},
        quality_policy: {duplicate_records: 'reject', duplicate_assets: 'reject', missing_assets: 'allow_declared'},
        review: {status: 'pending', reviewer: null, notes: 'Automated checks do not replace human review of realism and consistency with the approved proposal.'}},
      catalog: {schema_version: 'pale.asset-catalog.v1', catalog_id: datasetId + '-assets', app_id: app, dataset_ref: 'dataset.json', assets, extensions: []},
      blobs: Object.fromEntries(app === 'files' ? fileAssets.map(({d, bytes}) => [assetIdFor(d.id), bytes.toString('base64')]) : [])
    };
  }
  for (const d of DOCS) out['assets/files/' + d.name] = d.text;

  // Later mail.
  out['mail-timeline.json'] = {
    schema: 'pale49.mail-timeline.v1',
    description: 'Mail the runner delivers after the session-1 snapshot, through env.apply_event (operation mail.deliver) on account mail-mingyu. kind=fixed: deliver at event.at. kind=conditional: deliver at event.at only if the condition holds. kind=rule: compute the delivery time from rule; event.at holds the reference-run time. Replace every {{placeholder}} in subject and body before delivery; example_values are the reference-run values.',
    account_id: ACCOUNT.mail,
    snapshot_at: VIRTUAL_NOW,
    items: TIMELINE.map(t => {
      const when = t.kind === 'rule' ? t.reference.deliver_at : ct(t.when);
      const item = {item_id: t.id, kind: t.kind, role: t.role};
      if (t.condition) item.condition = t.condition;
      if (t.rule) item.rule = t.rule;
      if (t.reference) item.reference = t.reference;
      if (t.template) item.placeholders = t.template;
      if (t.example_values) item.example_values = t.example_values;
      item.event = {event_id: 'pale49-' + t.id, at: when, operation: 'mail.deliver',
        payload: {id: t.id.replace(/^tl-/, 'msg-'), thread_id: t.thread, account_id: ACCOUNT.mail, from: t.from, to: [ME],
          subject: t.subject, body: t.body, received_at: when, folder: 'inbox', read: false, attachments: []}};
      return item;
    }).sort((a, b) => Date.parse(a.event.at) - Date.parse(b.event.at))
  };

  // Annotations for README / validate (not loaded into any App).
  out['manifest.json'] = {
    schema: 'pale49.workspace-manifest.v1',
    virtual_now: VIRTUAL_NOW,
    apps: {mail: 'examples/apps/mail', calendar: 'examples/apps/calendar', files: 'apps/files', notes: 'apps/notes', contacts: 'apps/contacts'},
    mrz: {line1: MRZ_LINE1, line2: MRZ_LINE2, fields: {document_number: MRZ_DOC, birth: VISA.birth, expiry: VISA.expiry},
      check_digits: {document_number: mrzCheck(MRZ_DOC), birth: mrzCheck(VISA.birth), expiry: mrzCheck(VISA.expiry)}},
    roles: {
      mail: Object.fromEntries(INBOX.map(m => [m.id, m.role])),
      mail_timeline: Object.fromEntries(TIMELINE.map(t => [t.id, t.role])),
      notes: Object.fromEntries(NOTES.map(n => [n.id, n.role])),
      files: Object.fromEntries(DOCS.map(d => [d.id, d.role]))
    }
  };
  return out;
}

// ---------------------------------------------------------------------------
const serialize = v => typeof v === 'string' ? v : JSON.stringify(v, null, 2) + '\n';
const GENERATED_DIRS = ['assets/files', 'bundles'];

function main() {
  const check = process.argv.includes('--check');
  const files = build();
  const problems = [];
  for (const [rel, value] of Object.entries(files)) {
    const abs = path.join(OUT, rel), text = serialize(value);
    const current = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
    if (current === text) continue;
    if (check) problems.push((current === null ? 'missing: ' : 'drift:   ') + rel);
    else { fs.mkdirSync(path.dirname(abs), {recursive: true}); fs.writeFileSync(abs, text); }
  }
  for (const dir of GENERATED_DIRS) {
    const abs = path.join(OUT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs)) {
      const rel = dir + '/' + name;
      if (files[rel] !== undefined) continue;
      if (check) problems.push('stale:   ' + rel);
      else fs.rmSync(path.join(abs, name));
    }
  }
  if (check) {
    if (problems.length) { console.error('Generated files are out of date (run node build.cjs):\n  ' + problems.join('\n  ')); process.exitCode = 1; }
    else console.log('build --check: ' + Object.keys(files).length + ' generated files match build.cjs');
  } else console.log('Wrote ' + Object.keys(files).length + ' files under ' + OUT);
}

module.exports = {build, mrzCheck, at};
if (require.main === module) main();
