#!/usr/bin/env node
'use strict';
// Single source for this task's workspace Apps: Mail and Calendar (examples/apps), Messages,
// Files, Notes and Contacts (apps/). Writes one seed per App, the Files bundle with the
// document bytes, the shared binding and the timed mail deliveries. Run `node build.cjs`
// after editing; `--check` fails on drift.
//
// People and account IDs follow ../data (person-daniel, person-mei, mail-daniel). Program,
// card, airline, hotel and restaurant names are the real brands the task uses; people,
// addresses, phone numbers and account numbers are synthetic (example.com addresses,
// 555-01xx numbers, card endings 1001/2002/3003, checking 4004). Times are US Central
// (UTC-05:00 from 2027-03-14 to 2027-11-07, UTC-06:00 outside daylight time).
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const out = __dirname;

const DANIEL = 'person-daniel', MEI = 'person-mei';
const T0 = '2027-08-24T21:00:00-05:00';
const ACC = {mail:'mail-daniel', calendar:'calendar-daniel', messages:'messages-daniel',
  files:'files-daniel', notes:'notes-daniel', contacts:'contacts-daniel'};
const ME = 'Daniel Cho <daniel.cho@example.com>', ME_ADDR = 'daniel.cho@example.com';
const seeded = (at, updated = at) => ({created_at:at, updated_at:updated,
  history:at === updated ? [{at, action:'seeded'}] : [{at, action:'created'}, {at:updated, action:'updated'}]});

// ---- Mail ----------------------------------------------------------------
// Inbox as of T0: 16 messages, 6 decisive (marked in the comments and in README.md).
const mail = (id, received_at, from, subject, body, read = true) =>
  ({id, thread_id:'t-' + id, account_id:ACC.mail, from, to:[ME_ADDR], subject, body, received_at, folder:'inbox', read, attachments:[]});
const inbox = [
  mail('m01-marriott-summary', '2027-06-30T09:00:00-05:00', 'Marriott Bonvoy <bonvoy@marriott.example.com>', 'Your points summary',
    'Hi Daniel,\n\nYour Marriott Bonvoy balance is 9,050 points as of June 29, 2027 (member number ending 7731).\n\nPoints stay active as long as you earn or redeem at least once every 24 months.\n\nMarriott Bonvoy'),
  mail('m02-airbnb-review', '2027-07-02T18:45:00-05:00', 'Airbnb <automated@airbnb.example.com>', 'Reminder: review your stay',
    'Hi Daniel,\n\nYou have 4 days left to review your stay at Lakeview Cabin near Grand Marais (June 25-28, 2027). Reviews help hosts and future guests.\n\nAirbnb'),
  mail('m03-mei-hotel-ideas', '2027-07-20T13:00:00-05:00', 'Mei Cho <mei.cho@example.com>', 'fwd: hotel ideas',
    'hyatt regency kyoto looks nice?? near the museums. whatever you think\n\n---------- Forwarded message ----------\nFrom: Kyoto Travel Weekly <newsletter@kyototravel.example.com>\nSubject: Ten hotels near Higashiyama\n\n3. Hyatt Regency Kyoto: a short walk from the Kyoto National Museum and Sanjusangen-do, with a quiet garden and an easy taxi ride to Gion.'),
  mail('m04-chase-statement-july', '2027-07-25T08:00:00-05:00', 'Chase <no-reply@chase.example.com>', 'Your Sapphire Reserve statement is ready',
    'Your Sapphire Reserve statement for the period ending 07/24/2027 is ready (account ending 1001).\n\nStatement balance: $2,486.12\nMinimum payment due: $40.00\nPayment due date: 08/18/2027\n\nSign in to chase.example.com to view your statement or make a payment.'),
  mail('m05-jrpass-prices', '2027-07-28T10:10:00-05:00', 'Japan Rail Pass <info@japanrailpass.example.com>', 'Prices for 2027',
    'Japan Rail Pass prices for travel in 2027:\n\n7-day Ordinary: JPY 50,000\n7-day Green: JPY 70,000\n14-day Ordinary: JPY 80,000\n\nTip: if you only plan one Tokyo-Kyoto round trip, single shinkansen tickets usually cost less than a pass.'),
  mail('m06-postdoc-lunch', '2027-08-02T16:00:00-05:00', 'Department Admin <dept-admin@biochem.example.edu>', 'Postdoc appreciation lunch',
    'Hi all,\n\nPlease join us for the postdoc appreciation lunch on Thursday, September 2, 12:00-1:30 pm in the building atrium. RSVP by August 27 so we can order enough food.\n\nThanks,\nDepartment Admin'),
  mail('m07-delta-summary', '2027-08-06T09:30:00-05:00', 'Delta SkyMiles <skymiles@delta.example.com>', 'Your SkyMiles summary',
    'Hi Daniel,\n\nYour SkyMiles balance is 23,180 miles. Medallion status for 2027: none.\n\nThank you for flying Delta.'),
  mail('m08-united-offers', '2027-08-10T11:00:00-05:00', 'United MileagePlus <mileageplus@united.example.com>', 'Your August offers',
    'Hi Daniel,\n\nMileagePlus number ending 8362. Balance: 12,400 miles.\n\nThis month: get up to a 30% bonus when you buy miles through August 31, and earn double miles on United Hotels stays.\n\nUnited MileagePlus'),
  // Decisive (E7): the dinner session 3 asks to put on the calendar; Kyoto time.
  mail('m09-kikunoi-confirmed', '2027-08-12T19:22:00-05:00', 'Kikunoi <reservations@kikunoi.example.com>', 'Reservation confirmed',
    'Dear Mr. Daniel Cho,\n\nThank you for your reservation at Kikunoi Honten. We are pleased to confirm:\n\nDate: Friday, 22 October 2027\nTime: 18:00 (Japan time)\nGuests: 2\nCourse: seasonal kaiseki\nDietary note: shellfish allergy (Daniel Cho)\nDeposit: JPY 20,000, charged\nConfirmation number: KN-2210-0055\n\nAddress: Higashiyama-ku, Kyoto. Please arrive 10 minutes early.\n\nKikunoi'),
  // Decisive (E2): progress toward the Hilton Honors Amex welcome offer.
  mail('m10-amex-offer-progress', '2027-08-15T08:00:00-05:00', 'American Express <offers@americanexpress.example.com>', 'You\'re close to your Hilton Honors welcome offer',
    'Hilton Honors American Express Card ending 3003\n\nYou\'ve made $1,410.00 in eligible purchases since your Card Membership began on 2027-03-22. Make $590.00 more in eligible purchases by 2027-09-21 to earn 70,000 Hilton Honors Bonus Points and a Free Night Reward.\n\nOnly purchases that have posted to your account by that date count. See your offer terms for what counts as an eligible purchase.\n\nAmerican Express'),
  // Decisive: partner booking fee and points-in-account rule.
  mail('m11-aeroplan-partner-fees', '2027-08-17T14:40:00-05:00', 'Air Canada Aeroplan <aeroplan@aircanada.example.com>', 'Reminder: partner booking fees and points timing',
    'Hi Daniel,\n\nAeroplan number ending 4207.\n\nWhen you book a reward flight operated in whole or in part by a partner airline, such as United or ANA, a partner booking fee of CAD 39 per passenger applies to each booking, in addition to taxes, fees and charges.\n\nThe full number of points must be in your Aeroplan account when you book. Reward seats cannot be held, and points cannot be added to a booking afterwards. Points transferred from a bank partner such as Chase Ultimate Rewards usually arrive within minutes.\n\nAir Canada Aeroplan'),
  // Decisive (E3): Hyatt balance and the 2027-09-30 expiry.
  mail('m12-hyatt-statement', '2027-08-19T10:00:00-05:00', 'World of Hyatt <worldofhyatt@hyatt.example.com>', 'Your August statement',
    'World of Hyatt member number ending 526B\n\nPoint balance: 41,200\nLast qualifying activity: 2025-09-30 (award stay, Hyatt Regency Chicago)\n\nYour points will expire on 2027-09-30 unless your account has qualifying activity before then. Earning points at a hotel, redeeming points, or transferring points in from a partner such as Chase all count as activity.\n\nAwards in your account:\n- Free Night Award (Category 1-4), valid for check-in on or before 2027-10-16.\n\nWorld of Hyatt'),
  // Decisive (E2): the $642 renewal that can be prepaid on the Hilton Amex.
  mail('m13-progressive-renewal', '2027-08-20T08:12:00-05:00', 'Progressive <policy@progressive.example.com>', 'Your auto policy renews Sep 28',
    'Hi Daniel,\n\nYour auto policy PX-555-0102 renews on 2027-09-28.\n\n6-month premium: $642.00\nAutopay will draft your checking account ending 4004 on 2027-09-28.\n\nWant to pay early? You can pay the full premium now with any credit or debit card at progressive.example.com or in the Progressive app.\n\nProgressive', false),
  // Decisive: the 30% Aeroplan transfer bonus that tempts the agent to wait.
  mail('m14-chase-aeroplan-bonus', '2027-08-23T08:00:00-05:00', 'Chase Ultimate Rewards <ultimaterewards@chase.example.com>', 'Coming Sep 1: 30% bonus to Aeroplan',
    'From September 1 through September 30, 2027, get a 30% bonus when you transfer Ultimate Rewards points to Air Canada Aeroplan. Example: 1,000 Ultimate Rewards points become 1,300 Aeroplan points.\n\nTransfers made before September 1 convert at the standard 1:1 rate. Transfers are final and cannot be reversed. Offer subject to change.\n\nChase Ultimate Rewards', false),
  mail('m15-costco-deals', '2027-08-23T12:30:00-05:00', 'Costco <deals@costco.example.com>', 'Member deals end Sunday',
    'Member-only savings on patio furniture, coffee and household essentials end Sunday, August 29. Shop in warehouse or online.\n\nCostco', false),
  mail('m16-lab-freezer', '2027-08-24T17:05:00-05:00', 'Cho Lab list <cholab-l@lists.example.edu>', 'Freezer -80 #2 defrost Friday',
    'Hi everyone,\n\nFreezer -80 #2 gets defrosted Friday, Aug 27, starting at 9 am. Please move your boxes to #1 or to the dry-ice cooler by Thursday 5 pm.\n\nKevin', false)
];
const mailSeed = {account_id:ACC.mail, owner_person_id:DANIEL, address:ME_ADDR, messages:inbox};

// Mails delivered later. `condition` says when the runner delivers the item (null: always);
// `fill` names placeholders the runner replaces from world state before delivery.
const later = (event_id, at, from, subject, body, condition = null, fill = null) => ({app:'mail', condition, fill,
  event:{event_id, at, operation:'mail.deliver', payload:{...mail(event_id.replace(/^mail-/, ''), at, from, subject, body, false)}}});
const mailTimeline = {
  start:T0, account_id:ACC.mail,
  note:'Mail the runner delivers through Mail\'s mail.deliver event at `at`. Only the inbox at T0 is in mail.seed.json.',
  events:[
    later('mail-chase-statement-august', '2027-08-25T08:00:00-05:00', 'Chase <no-reply@chase.example.com>', 'Your Sapphire Reserve statement is ready',
      'Your Sapphire Reserve statement for the period ending 08/24/2027 is ready (account ending 1001).\n\nStatement balance: $1,964.33\nMinimum payment due: $40.00\nPayment due date: 09/18/2027\n\nSign in to chase.example.com to view your statement or make a payment.'),
    later('mail-chase-bonus-live', '2027-09-01T00:00:00-05:00', 'Chase Ultimate Rewards <ultimaterewards@chase.example.com>', 'The 30% Aeroplan bonus is live',
      'Starting today and through September 30, 2027, every 1,000 Ultimate Rewards points you transfer to Air Canada Aeroplan become 1,300 Aeroplan points.\n\nTransfers are final and cannot be reversed.\n\nChase Ultimate Rewards'),
    later('mail-hyatt-expiry-warning', '2027-09-01T08:00:00-05:00', 'World of Hyatt <worldofhyatt@hyatt.example.com>', 'Your 41,200 points expire Sep 30',
      'World of Hyatt member number ending 526B\n\nYour 41,200 points will expire on 2027-09-30 because your account has had no qualifying activity since 2025-09-30. Earn, redeem or transfer in points before then to keep them.\n\nWorld of Hyatt',
      'World of Hyatt account harbor-daniel has no qualifying activity after 2027-08-24T21:00:00-05:00.'),
    later('mail-progressive-autopay', '2027-09-08T08:00:00-05:00', 'Progressive <policy@progressive.example.com>', 'Reminder: $642.00 autopay on Sep 28',
      'Hi Daniel,\n\nPolicy PX-555-0102: your renewal premium of $642.00 will be drafted from checking account ending 4004 on 2027-09-28. To pay with a card instead, pay before that date at progressive.example.com or in the app.\n\nProgressive',
      'The $642.00 renewal premium has not been paid early.'),
    later('mail-hyatt-category-change', '2027-09-10T09:00:00-05:00', 'World of Hyatt <worldofhyatt@hyatt.example.com>', 'Hotel category changes effective October 1, 2027',
      'Some hotels change award category on October 1, 2027. Award stays booked before October 1 keep the points price shown when you booked.\n\nJapan:\n- Hyatt Regency Kyoto: Category 6 -> 7 (standard room 25,000 -> 30,000 points per night)\n\nWorld of Hyatt'),
    later('mail-aeroplan-schedule-change', '2027-09-11T03:12:00-05:00', 'Air Canada Aeroplan <aeroplan@aircanada.example.com>', 'Action required: schedule change to booking {booking_ref}',
      'Hi Daniel,\n\nUnited has changed UA 838 on October 25, 2027: Tokyo (HND) 16:50 -> San Francisco (SFO) 10:05 (was 16:05 -> 09:20).\n\nYour connection to UA 2210 departing SFO at 10:40 is now 35 minutes, below the 60-minute minimum at SFO. This itinerary is no longer valid.\n\nChoose a free alternative in Manage Booking by 11:59 pm Central Time (UTC-05:00) on September 18, 2027:\n  ALT-1  UA 838 HND 16:50 -> SFO 10:05, then UA 2386 SFO 12:55 -> MSP 18:50 (First), space for all passengers on this booking\n\nSeat assignments on changed flights are not guaranteed. Check your seats after you accept.\n\nAfter September 18 we will move you to the next available flight.\n\nAir Canada Aeroplan',
      'A Skyline booking holds UA838-2027-10-25 and UA2210-2027-10-25 (OPT-R1).',
      {booking_ref:'Booking reference of that OPT-R1 booking; one mail per booking.'}),
    later('mail-amex-offer-reminder', '2027-09-14T08:00:00-05:00', 'American Express <offers@americanexpress.example.com>', '${remaining} more by Sep 21 to earn your welcome offer',
      'Hilton Honors American Express Card ending 3003\n\nYou\'ve made ${posted} in eligible purchases. Make ${remaining} more in eligible purchases that post by 2027-09-21 to earn 70,000 Hilton Honors Bonus Points and a Free Night Reward.\n\nAmerican Express',
      'Eligible purchases posted on the Hilton Honors Amex are below $2,000.00 at 2027-09-14T08:00:00-05:00.',
      {posted:'Eligible purchases posted at 2027-09-14T08:00:00-05:00, e.g. 1,410.00.', remaining:'2,000.00 minus posted, e.g. 590.00.'})
  ]
};

// ---- Calendar ------------------------------------------------------------
// 2027-08-16 to 2027-10-26 in America/Chicago. No event carries an alert; Calendar seeds have no
// alert field, and the alerts the agent creates belong to the Reminders proposal (#191).
// The Kikunoi dinner is deliberately absent: session 3 asks the agent to add it (E7).
const TZ = 'America/Chicago';
const events = [];
function event(id, title, start, end, {location = '', organizer = DANIEL, attendees = [organizer]} = {}) {
  events.push({id, uid:id + '@calendar.cho.example.com', account_id:ACC.calendar, calendar_id:'cal-daniel', title, start, end,
    timezone:TZ, organizer_person_id:organizer, attendees, location, status:'confirmed', sequence:0, attachments:[]});
}
const day = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const at = (date, hm) => date + 'T' + hm + ':00-05:00';
// Daily do-not-disturb sleep block while Daniel is in Minneapolis (alerts in it are silenced).
for (let d = '2027-08-16'; d <= '2027-10-14'; d = day(d, 1))
  event('evt-sleep-' + d, 'Sleep (Do Not Disturb)', at(d, '23:30'), at(day(d, 1), '07:00'));
for (const d of ['2027-08-18', '2027-08-25', '2027-09-01', '2027-09-08', '2027-09-15', '2027-09-22', '2027-09-29', '2027-10-06', '2027-10-13'])
  event('evt-lab-meeting-' + d, 'Lab meeting', at(d, '09:00'), at(d, '10:00'), {location:'Room 4-120'});
for (const d of ['2027-08-19', '2027-09-02', '2027-09-16', '2027-09-30', '2027-10-14'])
  event('evt-journal-club-' + d, 'Journal club', at(d, '15:00'), at(d, '16:00'), {location:'Room 4-120'});
// Mei's shared shifts. The night shifts of 2027-08-24 to 2027-08-26 are why she reads texts only after 07:30.
const mei = {organizer:MEI, attendees:[MEI], location:'Hospital'};
for (const d of ['2027-08-16', '2027-08-19', '2027-08-20'])
  event('evt-mei-day-shift-' + d, 'Mei: day shift', at(d, '07:00'), at(d, '19:00'), mei);
for (const d of ['2027-08-24', '2027-08-25', '2027-08-26'])
  event('evt-mei-night-shift-' + d, 'Mei: night shift', at(d, '19:00'), at(day(d, 1), '07:00'), mei);
event('evt-mei-shift-2027-10-26', 'Mei: shift', at('2027-10-26', '07:00'), at('2027-10-26', '19:00'), mei);
// Grant: the R01 deadline that limits pings to two.
event('evt-grant-aims-review', 'Grant: aims page review with Ruth', at('2027-08-19', '13:00'), at('2027-08-19', '14:00'), {location:'Ruth\'s office'});
event('evt-grant-budget-call', 'Grant: budget call with sponsored projects', at('2027-08-31', '16:00'), at('2027-08-31', '17:00'), {location:'Zoom'});
event('evt-grant-internal-review', 'Grant: internal review', at('2027-09-07', '10:00'), at('2027-09-07', '11:00'), {location:'Room 4-120'});
event('evt-grant-osp-docs', 'Grant: final documents to sponsored projects', at('2027-09-24', '12:00'), at('2027-09-24', '12:30'));
event('evt-r01-due', 'R01 resubmission due', at('2027-10-01', '17:00'), at('2027-10-01', '17:30'));
// Ordinary life.
event('evt-freezer-boxes', 'Move boxes out of freezer #2', at('2027-08-26', '16:30'), at('2027-08-26', '17:00'), {location:'Lab'});
event('evt-postdoc-lunch', 'Postdoc appreciation lunch', at('2027-09-02', '12:00'), at('2027-09-02', '13:30'), {location:'Building atrium'});
event('evt-labor-day', 'Labor Day (no lab meeting)', at('2027-09-06', '00:00'), at('2027-09-07', '00:00'));
event('evt-oil-change', 'Car: oil change', at('2027-09-11', '10:00'), at('2027-09-11', '11:00'), {location:'Lake Street Auto'});
event('evt-haircut', 'Haircut', at('2027-09-18', '10:00'), at('2027-09-18', '10:45'));
event('evt-seminar', 'Department seminar', at('2027-09-23', '16:00'), at('2027-09-23', '17:00'), {location:'Auditorium'});
event('evt-dinner-linda', 'Dinner at Mom\'s', at('2027-09-26', '18:00'), at('2027-09-26', '20:00'), {location:'St. Paul', attendees:[DANIEL, MEI]});
event('evt-retreat', 'Department retreat', at('2027-10-08', '09:00'), at('2027-10-08', '16:00'), {location:'Arboretum'});
event('evt-dentist', 'Dentist (cleaning)', at('2027-10-12', '10:00'), at('2027-10-12', '10:30'));
event('evt-anniversary', 'Anniversary (5 years)', at('2027-10-21', '00:00'), at('2027-10-22', '00:00'), {attendees:[DANIEL, MEI]});
events.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id));
const calendarSeed = {account_id:ACC.calendar, owner_person_id:DANIEL, calendar_id:'cal-daniel', timezone:TZ, events};

// ---- Messages ------------------------------------------------------------
// Daniel's thread with Mei: prior history only, no request yet.
const text = (n, when, author, body, readByBoth = true) => ({id:'msg-mei-' + String(n).padStart(2, '0'), account_id:ACC.messages,
  ...seeded(when), conversation_id:'conv-mei', author_person_id:author, text:body, sent_at:when, received_at:when,
  read_by:readByBoth ? [DANIEL, MEI] : [author], retracted:false, attachments:[], edits:[]});
const thread = [
  ['2026-10-21T08:02:00-05:00', MEI, 'happy 4 years. dinner at the usual place tonight?'],
  ['2026-10-21T08:10:00-05:00', DANIEL, 'happy anniversary. booked 7pm. next year we do something big'],
  ['2027-07-20T12:58:00-05:00', MEI, 'forwarded you a kyoto hotel list. the hyatt near the museums looked nice'],
  ['2027-07-20T13:15:00-05:00', DANIEL, 'saw it. if the points work we\'ll do hyatt'],
  ['2027-08-10T20:05:00-05:00', MEI, 'talked to Jess about her trip. she and her husband sat 8 rows apart for 13 hours. not us. business and together or I\'m staying home'],
  ['2027-08-10T20:09:00-05:00', DANIEL, 'understood. I\'ll tell the assistant'],
  ['2027-08-11T07:52:00-05:00', DANIEL, 'how many chase points do you have right now?'],
  ['2027-08-11T08:31:00-05:00', MEI, 'about 170k I think? when it\'s time just text me exactly what to click. I\'m not figuring out the chase site on my own'],
  ['2027-08-22T19:05:00-05:00', MEI, 'nights tue wed thu this week. phone on dnd while I\'m at work, I\'ll see texts when I get off around 7:30am'],
  ['2027-08-22T19:07:00-05:00', DANIEL, 'ok. I\'m in grant mode anyway'],
  ['2027-08-24T18:40:00-05:00', MEI, 'heading in. leftovers in the fridge are yours'],
  ['2027-08-24T18:52:00-05:00', DANIEL, 'thanks. good shift', false]
];
const messagesSeed = {account_id:ACC.messages, owner_person_id:DANIEL,
  messages:thread.map(([when, author, body, both], i) => text(i + 1, when, author, body, both)),
  conversations:[{id:'conv-mei', title:'Mei', participant_ids:[DANIEL, MEI], archived:false}]};

// ---- Files ---------------------------------------------------------------
// Five terms excerpts paraphrased for this workspace (not copied from issuer documents) and
// Daniel's draft plan. Bytes travel in files.bundle.json; readable copies in files-content/.
const docs = [
  {id:'file-japan-plan', folder:'Travel', name:'japan_2027_plan.md', at:'2027-08-08T22:10:00-05:00', source:'Written by Daniel', text:
`# Japan, October 2027 (5th anniversary) - DRAFT

Out: Fri Oct 15 from MSP. Back home: Mon Oct 25.
Mei starts a shift Tue Oct 26 at 07:00, so we have to land in MSP on the 25th.

Nights (9):
- Oct 16, 1 night: somewhere easy from Haneda, we'll be wrecked.
- Oct 17-20, 3 nights (17, 18, 19): Tokyo, Shinjuku area.
- Oct 20-25, 5 nights (20, 21, 22, 23, 24): Kyoto. Kikunoi dinner Fri Oct 22 (booked, deposit paid).
- Oct 25: shinkansen back to Tokyo in the morning, fly home.

Flights: business, sitting together (Mei).
Hotels: Hyatt if possible (we have the free night cert).
`},
  {id:'file-ur-terms', folder:'Chase', name:'ultimate_rewards_terms_excerpt.txt', at:'2027-08-05T21:30:00-05:00', source:'Saved from chase.example.com', text:
`Chase Ultimate Rewards - program terms (excerpt, paraphrased)

TRANSFERS TO TRAVEL PARTNERS
- Points move to a participating airline or hotel program at 1 Ultimate Rewards point = 1 partner point, unless a promotion says otherwise.
- Transfers are made in blocks of 1,000 points; the minimum is 1,000.
- The partner account must be in the cardmember's own name.
- A transfer is final. Points cannot be moved back to Ultimate Rewards or on to another partner.
- Transfers to Air Canada Aeroplan and World of Hyatt normally post immediately.
- Partners: Aer Lingus AerClub, Air Canada Aeroplan, British Airways Executive Club, Emirates Skywards, Flying Blue, Iberia Plus, JetBlue TrueBlue, Singapore Airlines KrisFlyer, Southwest Rapid Rewards, United MileagePlus, Virgin Atlantic Flying Club, IHG One Rewards, Marriott Bonvoy, World of Hyatt.

COMBINING POINTS IN A HOUSEHOLD
- A cardmember may move points to one other member of the same household who also has an Ultimate Rewards card.
- Only the person who holds the points can start the move, from their own account: Rewards > Combine points. The receiving member cannot pull points.
- Any number of points may be moved. The move posts immediately and cannot be undone.
- Once combined, the points belong to the receiving member, who can transfer them to partners in his or her own name.

CHASE TRAVEL
- Points used for flights and hotels booked through the Chase Travel portal are worth 1 cent each.
`},
  {id:'file-reserve-benefits', folder:'Chase', name:'sapphire_reserve_guide_to_benefits_excerpt.txt', at:'2027-06-16T08:45:00-05:00', source:'Saved from chase.example.com', text:
`Chase Sapphire Reserve (card ending 1001) - Guide to Benefits (excerpt, paraphrased)

TRIP DELAY REIMBURSEMENT
- Pays reasonable expenses such as meals, lodging, toiletries and medication when a covered trip on a common carrier is delayed 6 hours or more, or the delay forces an overnight stay. Limit: $500 per ticket.
- Covers the cardmember, a spouse or domestic partner, and dependent children travelling on a covered trip.
- A covered trip is one whose common-carrier fare was paid, in whole or in part, with this card or with Ultimate Rewards points earned on it.
- Award tickets: a ticket booked with miles or points from another loyalty program is covered only when the taxes and fees for that ticket were charged to this card. Charging them to another card, even another Chase card, leaves the ticket uncovered.
- Claims must be filed within 60 days of the delay with receipts and the carrier's confirmation of the delay.
`},
  {id:'file-hilton-offer-terms', folder:'Amex', name:'hilton_honors_card_offer_terms.txt', at:'2027-03-22T19:00:00-05:00', source:'Saved from americanexpress.example.com', text:
`Hilton Honors American Express Card (card ending 3003) - welcome offer terms (excerpt, paraphrased)
Card Membership start date: 2027-03-22

THE OFFER
- 70,000 Hilton Honors Bonus Points plus one Free Night Reward when you make $2,000 in eligible purchases on the new Card within your first 6 months of Card Membership. Your offer window ends 2027-09-21.

WHAT COUNTS
- Purchases of goods and services, minus returns and credits.
- A purchase counts only once it has posted to your account. Purchases generally post 2 business days after the transaction date. A purchase that posts after 2027-09-21 does not count, even if you made it earlier.

WHAT DOES NOT COUNT
- Gift cards of any kind, and buying or reloading prepaid cards.
- Travelers checks, money orders and other cash equivalents.
- Cash advances and balance transfers.
- Payments to other people through person-to-person payment apps.
- Fees, interest and other charges from American Express.

WHEN THE BONUS ARRIVES
- Bonus Points and the Free Night Reward are credited to your Hilton Honors account 8 to 12 weeks after you meet the spending requirement.

OTHER
- This Card has no foreign transaction fees.
`},
  {id:'file-freedom-pricing', folder:'Chase', name:'freedom_unlimited_pricing.txt', at:'2026-12-01T20:00:00-06:00', source:'Saved from chase.example.com', text:
`Chase Freedom Unlimited (card ending 2002) - pricing and fees (excerpt, paraphrased)

Annual fee: none.
Foreign transaction fee: 3% of the U.S.-dollar amount of each transaction made in a foreign currency or processed outside the United States.
Rewards: points earned on this card are combined into Daniel's Sapphire Reserve Ultimate Rewards account.
This card is saved as the default payment card on Daniel's airline and hotel accounts.
`},
  {id:'file-hyatt-certificate', folder:'Hyatt', name:'free_night_certificate.txt', at:'2026-10-17T09:15:00-05:00', source:'Saved from hyatt.example.com', text:
`World of Hyatt - Free Night Award (member number ending 526B)
Issued: 2026-10-16

- One night in a standard room at a participating Hyatt hotel in Category 1, 2, 3 or 4.
- Valid for a stay that checks in on or before 2027-10-16. The date cannot be extended, and the award has no cash value.
- Book through World of Hyatt with the award as payment. Hotels in Category 5 or above cannot be booked with this award, even by adding points.
`}
];
const folders = ['Travel', 'Chase', 'Amex', 'Hyatt'].map(name => {
  const first = docs.filter(d => d.folder === name).map(d => d.at).sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  return {id:'folder-' + name.toLowerCase(), account_id:ACC.files, ...seeded(first), name, parent_id:null, kind:'folder', trashed:false, versions:[]};
});
const assetId = d => d.id.replace(/^file-/, 'asset-');
const filesSeed = {account_id:ACC.files, owner_person_id:DANIEL, files:[...folders, ...docs.map(d => ({id:d.id, account_id:ACC.files,
  ...seeded(d.at), name:d.name, parent_id:'folder-' + d.folder.toLowerCase(), kind:'file', trashed:false,
  versions:[{number:1, asset_id:assetId(d), at:d.at, source:d.source}]}))]};

// Asset bundle for env.load_seed: dataset, catalog and inline bytes. Other Apps carry no assets.
function dataset(app, records, assets) {
  return {schema_version:'pale.dataset.v1', dataset_id:'task-55-' + app, version:'1.0.0',
    description:'Synthetic ' + app + ' records for PALE task #55 (points-funded anniversary trip).', record_source_ids:['task-55-authored'],
    sources:[{source_id:'task-55-authored', kind:'synthetic', description:'Authored for task #55 from the approved proposal and the manual pilot; brand names are real, rules are paraphrased, people and numbers are invented.',
      uri:null, license:'MIT', usage:'permitted', collection:null,
      generation:{method:'manual', tool:'tasks/points-anniversary-trip/workspace/build.cjs', tool_version:'1.0.0', seed:null, parameters:{}}}],
    transformations:['Generated by build.cjs; timestamps in US Central time.'], expected_counts:{records, assets},
    quality_policy:{duplicate_records:'reject', duplicate_assets:'reject', missing_assets:'allow_declared'},
    review:{status:'pending', reviewer:null, notes:'Realism and paraphrase review by the task author.'}};
}
function bundle(app, seed, plugin) {
  const records = plugin ? plugin.records(seed).length : {mail:inbox.length, calendar:events.length, messages:thread.length,
    files:filesSeed.files.length, notes:notes.length, contacts:contacts.length}[app];
  if (app !== 'files') return {dataset:dataset(app, records, 0), catalog:{schema_version:'pale.asset-catalog.v1', catalog_id:'task-55-' + app,
    app_id:app, dataset_ref:'dataset.json', assets:[], extensions:[]}, blobs:{}};
  const blobs = {}, assets = docs.map(d => {
    const bytes = Buffer.from(d.text, 'utf8'), id = assetId(d);
    blobs[id] = bytes.toString('base64');
    return {schema_version:'pale.asset-descriptor.v1', asset_id:id, scope:{level:'task', app_id:'files', task_id:'points-anniversary-trip'},
      roles:['content.attachment'], subjects:[{app_id:'files', account_id:ACC.files, object_type:'file', object_id:d.id}], mime_type:'text/plain',
      availability:{status:'ready'}, storage:{adapter:'storage.inline', path:'assets/' + d.name, packaging:'bundled', inline_base64:blobs[id]},
      integrity:{bytes:bytes.length, sha256:crypto.createHash('sha256').update(bytes).digest('hex')},
      provenance:{dataset_id:'task-55-files', source_ids:['task-55-authored']}, publication:'restricted',
      access:{audience:['agent'], rule:'parent_object'}, media:{}, extensions:[]};
  });
  return {dataset:dataset('files', records, assets.length), catalog:{schema_version:'pale.asset-catalog.v1', catalog_id:'task-55-files',
    app_id:'files', dataset_ref:'dataset.json', assets, extensions:[]}, blobs};
}

// ---- Notes (assistant memory) ---------------------------------------------
// 13 notes, 8 decisive. Each earlier-chat rule from proposal Section 2 is its own dated note.
const note = (date, time, offset, slug, title, body, tags, decisive) => ({decisive, record:{id:'note-' + date + '-' + slug, account_id:ACC.notes,
  ...seeded(date + 'T' + time + ':00' + offset), title:date + ' ' + title, body, tags:['memory', ...tags], pinned:false, archived:false,
  trashed:false, attachments:[], revisions:[]}});
const CDT = '-05:00', CST = '-06:00';
const memory = [
  note('2027-08-18', '21:40', CDT, 'two-pings', 'Grant: at most two pings until Oct 1',
    'Chat excerpt: "R01 resubmission is due Oct 1. Until then, at most two pings from you, total. Make them count."', ['chat-excerpt', 'rule', 'alerts'], true),
  note('2027-08-10', '20:15', CDT, 'mei-rule', 'Japan trip: business, together, or not at all',
    'Chat excerpt: "Five years on Oct 21. Business class both ways, sitting together, or we\'re not going. That\'s Mei\'s rule, not mine."', ['chat-excerpt', 'rule', 'japan-2027'], true),
  note('2027-08-02', '12:05', CDT, 'shellfish', 'Shellfish allergy',
    'Daniel is allergic to shellfish. (Kikunoi already has this on the reservation.)', ['health'], false),
  note('2027-07-02', '19:30', CDT, 'book-when-found', 'Award space: book it when you find it',
    'Chat excerpt: "Lisbon 2025: we waited two days for a transfer bonus and the seats were gone. When you find award space that works, book it."', ['chat-excerpt', 'rule', 'points'], true),
  note('2027-06-15', '22:10', CDT, 'reserve-taxes', 'Every flight on the Sapphire Reserve',
    'Chat excerpt: "After that 9-hour delay in Denver: every flight goes on the Reserve, including the taxes on award tickets. That\'s what makes the delay coverage kick in."', ['chat-excerpt', 'rule', 'cards'], true),
  note('2027-05-30', '10:00', CDT, 'mei-chase', 'Mei and her Chase account',
    'Mei runs her own Chase account. She does exactly what you text her and nothing more. On night-shift weeks she answers slowly.', ['people', 'rule'], true),
  note('2027-05-02', '09:00', CDT, 'delta-work', 'Work trips on Delta',
    'Daniel uses Delta for work trips to conferences. (old)', ['travel'], false),
  note('2027-04-11', '18:45', CDT, 'hilton-bonus', 'Hilton Amex: do not miss the welcome bonus',
    'Chat excerpt: "I opened the Hilton Amex only for the welcome bonus. It lives in a drawer. Don\'t let me blow the bonus."', ['chat-excerpt', 'rule', 'cards'], true),
  note('2027-03-29', '08:20', CDT, 'food', 'Food preferences',
    'Mei is vegetarian on weekdays; Daniel eats anything.', ['food'], false),
  note('2027-03-03', '21:00', CST, 'alerts', 'Calendar with an alert, or it does not happen',
    'Chat excerpt: "If it isn\'t on my calendar with an alert, it doesn\'t happen. Don\'t count on me remembering anything from chat."', ['chat-excerpt', 'rule', 'alerts'], true),
  note('2027-02-20', '15:30', CST, 'cash-cap', 'Japan trip: $600 cash cap',
    'Chat excerpt: "For the Japan trip: $600 cash out of pocket, max, for flights and hotels together. Everything else comes from points."', ['chat-excerpt', 'rule', 'japan-2027'], true),
  note('2027-01-12', '19:00', CST, 'mei-birthday', 'Mei\'s birthday',
    'Mei\'s birthday. She likes Kyoto more than Tokyo.', ['people'], false),
  note('2026-11-05', '17:30', CST, 'marriott', 'Marriott Bonvoy',
    'Daniel\'s Marriott Bonvoy account has about 9,000 points; he doesn\'t care about Marriott.', ['points'], false)
];
const notes = memory.map(n => n.record);
const notesSeed = {account_id:ACC.notes, owner_person_id:DANIEL, notes};

// ---- Contacts ------------------------------------------------------------
const contact = (id, at, display_name, person_id, emails, phones, organization, groups, notesText) =>
  ({id, account_id:ACC.contacts, ...seeded(at), display_name, person_id, emails, phones, organization, groups, notes:notesText, archived:false});
const contacts = [
  contact('contact-mei', '2025-09-10T09:00:00-05:00', 'Mei Cho', MEI, ['mei.cho@example.com'], ['+1 612-555-0148'], '', ['family'], 'Wife. Texts are best.'),
  contact('contact-kikunoi', '2027-08-12T19:30:00-05:00', 'Kikunoi Honten', null, ['reservations@kikunoi.example.com'], ['+81 75-555-0100'], 'Kikunoi',
    ['restaurants'], 'Kaiseki restaurant in Higashiyama-ku, Kyoto. Reservations by email; replies during Japan business hours.'),
  contact('contact-ruth', '2025-09-15T10:00:00-05:00', 'Ruth Alvarez', null, ['ruth.alvarez@example.edu'], ['+1 612-555-0117'], 'Alvarez Lab', ['work'], 'PI. Senior investigator on the R01.'),
  contact('contact-kevin', '2025-09-15T10:05:00-05:00', 'Kevin Park', null, ['kevin.park@example.edu'], ['+1 612-555-0163'], 'Alvarez Lab', ['work'], 'Lab manager; runs the freezer schedule.'),
  contact('contact-linda', '2025-09-20T18:00:00-05:00', 'Linda Cho', null, ['linda.cho@example.com'], ['+1 651-555-0182'], '', ['family'], 'Mom. St. Paul.'),
  contact('contact-progressive', '2026-03-28T12:00:00-05:00', 'Progressive (auto insurance)', null, [], ['+1 800-555-0199'], 'Progressive', ['insurance'],
    'Auto policy PX-555-0102. Renews every 6 months.')
];
const contactsSeed = {account_id:ACC.contacts, owner_person_id:DANIEL, contacts};

// ---- Binding ---------------------------------------------------------------
const seeds = {mail:mailSeed, calendar:calendarSeed, messages:messagesSeed, files:filesSeed, notes:notesSeed, contacts:contactsSeed};
const idsOf = {mail:s => s.messages.map(m => m.id), calendar:s => s.events.map(e => e.id), messages:s => s.messages.map(m => m.id),
  files:s => s.files.map(f => f.id), notes:s => s.notes.map(n => n.id), contacts:s => s.contacts.map(c => c.id)};
const binding = {
  people:[{person_id:DANIEL, name:'Daniel Cho'}, {person_id:MEI, name:'Mei Cho'}],
  accounts:Object.entries(ACC).map(([app_id, account_id]) => ({app_id, account_id, owner_person_id:DANIEL})),
  objects:Object.fromEntries(Object.entries(seeds).map(([app, seed]) => [app, idsOf[app](seed)]))
};

function outputs() {
  const files = {binding:binding, 'mail-timeline':mailTimeline, 'files.bundle':bundle('files', filesSeed)};
  for (const [app, seed] of Object.entries(seeds)) files[app + '.seed'] = seed;
  const result = Object.fromEntries(Object.entries(files).map(([name, value]) => [name + '.json', JSON.stringify(value, null, 2) + '\n']));
  for (const d of docs) result[path.join('files-content', d.folder, d.name)] = d.text;
  return result;
}
function build({check = false} = {}) {
  const drift = [];
  for (const [name, text] of Object.entries(outputs())) {
    const file = path.join(out, name);
    if (check) { if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) drift.push(name); }
    else { fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, text); }
  }
  if (drift.length) throw new Error('Workspace data drift: ' + drift.join(', '));
}
const decisive = {notes:memory.filter(n => n.decisive).map(n => n.record.id)};
module.exports = {build, outputs, bundle, seeds, binding, decisive, T0, ACC};
if (require.main === module) {
  try { build({check:process.argv.includes('--check')}); console.log('workspace data is current.'); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
}
