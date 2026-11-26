'use strict';
// The story templates of the evaluation data: merchants, trips, disputes, offers and the issuer's own formulas.
// dev/generate-dataset.cjs draws every part of a story from inside one template. dev/check-evaluation.cjs checks the delivered records against the same tables.
// Every name here is fictional.

const ALL = [0, 1, 2, 3, 4, 5, 6], WEEKDAYS = [1, 2, 3, 4, 5], WEEKEND = [0, 6];
// A merchant: its category for points (dining and travel earn 2 points a dollar), its template, its amount range, its local hours and days.
// `pending` merchants send a hold first. Fuel holds 150.00 and posts lower; dining posts the bill with a tip.
const M = (template, category, low, high, hours, days = ALL, extra = {}) => ({template, category, low, high, hours, days, ...extra});
const MERCHANTS = {
  'Greenway Market': M('groceries', 'grocery', 45, 165, [['09:00', '19:00']]),
  'Fairfield Grocers': M('groceries', 'grocery', 45, 165, [['09:00', '19:00']]),
  'Northgate Fuel': M('fuel', 'fuel', 32, 68, [['06:00', '21:00']], ALL, {pending: true, hold: 150}),
  'Ridgeline Gas': M('fuel', 'fuel', 32, 68, [['06:00', '21:00']], ALL, {pending: true, hold: 150}),
  'Harbor Lane Bistro': M('dining', 'dining', 14, 92, [['11:30', '14:00'], ['18:00', '21:30']], ALL, {pending: true, tip: [15, 22]}),
  'Corner Slice': M('dining', 'dining', 14, 92, [['11:30', '14:00'], ['18:00', '21:30']], ALL, {pending: true, tip: [15, 22]}),
  'Juniper Noodle House': M('dining', 'dining', 14, 92, [['11:30', '14:00'], ['18:00', '21:30']], ALL, {pending: true, tip: [15, 22]}),
  'Copperleaf Coffee': M('coffee', 'dining', 3.75, 8.4, [['07:00', '11:00']]),
  'Bayline Transit': M('transit', 'travel', 5.8, 5.8, [['07:00', '09:30']], WEEKDAYS),
  'Lumen Rides': M('rideshare', 'travel', 9, 34, [['07:00', '23:30']]),
  'Tidewater Pharmacy': M('errands', 'other', 8, 60, [['09:00', '20:00']]),
  'Fernhill Hardware': M('errands', 'other', 12, 140, [['09:00', '17:00']], WEEKEND),
  'Quillstone Books': M('errands', 'other', 11, 46, [['10:00', '20:00']]),
  'Barkley Pet Supply': M('errands', 'other', 19, 78, [['10:00', '19:00']]),
  'Parcelbox Online': M('online', 'other', 18, 240, [['07:00', '23:00']]),
  'Brightcart': M('online', 'other', 18, 240, [['07:00', '23:00']]),
  'Voltage Row Electronics': M('electronics', 'other', 600, 1400, [['10:00', '20:00']]),
  'Hollis Auto Repair': M('car_repair', 'other', 2400, 3200, [['08:00', '17:00']], WEEKDAYS),
  // Subscriptions: a fixed day of the month, a fixed price and a fixed posting time. They post directly, with no hold.
  'Ironworks Gym': M('subscription', 'other', 60, 60, [['05:10', '05:10']], ALL, {day: 2, prices: [['2024-12-01', 60]]}),
  'Streamlet TV': M('subscription', 'other', 15.99, 17.99, [['04:30', '04:30']], ALL, {day: 5, prices: [['2024-12-01', 15.99], ['2026-07-01', 17.99]]}),
  'Reelhouse Plus': M('subscription', 'other', 11.99, 11.99, [['03:50', '03:50']], ALL, {day: 9, prices: [['2024-12-01', 11.99]]}),
  'Cloudnest Storage': M('subscription', 'other', 2.99, 2.99, [['03:20', '03:20']], ALL, {day: 11, prices: [['2024-12-01', 2.99]]}),
  'Kestrel Mobile': M('subscription', 'other', 85, 85, [['05:45', '05:45']], ALL, {day: 18, prices: [['2024-12-01', 85]]}),
  // A yearly plan with a short, unclear name on the statement.
  'NVL*Ostrander Digital': M('yearly_plan', 'other', 129, 129, [['04:20', '04:20']]),
  // Trips: flights bought ahead, hotels with a hold at check-in, and places at the destination.
  'Skyway Air': M('flight', 'travel', 240, 720, [['07:00', '23:00']]),
  'Bluecrest Airlines': M('flight', 'travel', 240, 720, [['07:00', '23:00']]),
  'Larch Hotel Midtown': M('hotel', 'travel', 149, 239, [['15:00', '21:00']], ALL, {pending: true, extra: 100}),
  'Saltmarsh Inn': M('hotel', 'travel', 149, 239, [['15:00', '21:00']], ALL, {pending: true, extra: 100}),
  'Pier Nine Grill': M('trip_dining', 'dining', 14, 92, [['11:30', '14:00'], ['18:00', '21:30']], ALL, {pending: true, tip: [15, 22]}),
  'Lantern Street Cafe': M('trip_dining', 'dining', 14, 92, [['11:30', '14:00'], ['18:00', '21:30']], ALL, {pending: true, tip: [15, 22]}),
  'Saltgrass Taqueria': M('trip_dining', 'dining', 14, 92, [['11:30', '14:00'], ['18:00', '21:30']], ALL, {pending: true, tip: [15, 22]}),
  'Cityloop Metro': M('trip_transit', 'travel', 2.75, 8.25, [['07:00', '22:00']])
};
const LUNCH = [14, 38], DINNER = [30, 92];
const HOTEL_CHECKOUT = ['07:00', '11:30'];
const BATCH = ['01:00', '06:59'];

// The account and its issuer. The first year's fee is waived, so the fee posts on the anniversary from the second year on.
const ACCOUNT = {id: 'brindle-riley', owner: 'person-riley', member_name: 'Riley Hart', opened_at: '2024-12-02T10:30:00-05:00', credit_limit: 9000,
  closing_day: 27, due_day: 22, annual_fee: 550, fee_day: '12-02', first_fee_year: 2025, returned_payment_fee: 29};
const BANKS = {old: 'Checking ending 4410', new: 'Checking ending 2087'};
const RETURN_REASON = 'The bank account was closed.';
// Interest: 24.24 percent a year, one twelfth on the amount left unpaid at the due time.
const APR_HUNDREDTHS = 2424;
const interestCents = unpaid => Math.round(unpaid * APR_HUNDREDTHS / 120000);
// The issuer's minimum due: 0 for no balance, the whole balance below 35.00, else 1 percent plus the interest and fees of the cycle, at least 35.00.
function minimumCents(balance, feesAndInterest) {
  if (balance <= 0) return 0;
  if (balance < 3500) return balance;
  return Math.min(balance, Math.max(3500, Math.round(balance / 100) + feesAndInterest));
}
// Points for a cycle: 2 a whole dollar of net dining and travel purchases, 1 a whole dollar of the rest.
const earnedPoints = (doubleCents, singleCents) => 2 * Math.floor(Math.max(0, doubleCents) / 100) + Math.floor(Math.max(0, singleCents) / 100);
const DOUBLE = new Set(['dining', 'travel']);

// New York bank holidays: no issuer or bank decision on these days.
const HOLIDAYS = ['2024-12-25', '2025-01-01', '2025-01-20', '2025-02-17', '2025-05-26', '2025-06-19', '2025-07-04', '2025-09-01', '2025-10-13', '2025-11-11',
  '2025-11-27', '2025-12-25', '2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19', '2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26',
  '2026-12-25', '2027-01-01'];

// The four trips. A transfer of points goes before two of them. The December 2025 hotel charges one night too many (dispute path `wrong_amount`).
const TRIPS = [
  {key: 'summer-2025', from: '2025-07-18', to: '2025-07-23', airline: 'Skyway Air', hotel: 'Saltmarsh Inn', transfer: {partner_id: 'skyway', points: 15000, pays: 'flight'}},
  {key: 'december-2025', from: '2025-12-19', to: '2025-12-21', airline: 'Bluecrest Airlines', hotel: 'Larch Hotel Midtown', dispute: 'wrong_amount'},
  {key: 'summer-2026', from: '2026-07-10', to: '2026-07-15', airline: 'Skyway Air', hotel: 'Larch Hotel Midtown', transfer: {partner_id: 'larch', points: 10000, pays: 'night'}},
  {key: 'december-2026', from: '2026-12-18', to: '2026-12-22', airline: 'Bluecrest Airlines', hotel: 'Saltmarsh Inn'}
];
// Points moved to a partner pay for part of a trip: an award ticket, where the card pays only the taxes and fees, or one hotel night.
const AWARD = {fees: [11.2, 86.4], flight_note: 'Taxes and fees for an award ticket paid with Skyway Miles',
  night_note: '{paid} nights at {rate} and 1 night paid with Larch Hotels Rewards points'};
const TRIP_PLACES = {dining: ['Pier Nine Grill', 'Lantern Street Cafe', 'Saltgrass Taqueria'], transit: 'Cityloop Metro', ride: 'Lumen Rides'};

// The eight disputes: reason, path, and every text the cardholder and the issuer write. `{...}` parts are filled from the story.
const DISPUTES = {
  not_received: {reason: 'not_received', path: 'resolved_for_me',
    note: 'The order of {order} never arrived. {merchant} promised delivery by {promised} and has not answered my emails.',
    credit: 'We added a temporary credit while we ask the merchant for proof of delivery.',
    end: 'The merchant did not show proof of delivery.'},
  not_received_open: {reason: 'not_received', path: 'open',
    note: 'My order of {order} has not arrived. {merchant} promised delivery by {promised}, and the tracking page has not changed since then.',
    credit: 'We added a temporary credit while we ask the merchant for proof of delivery.'},
  duplicate_charge: {reason: 'duplicate_charge', path: 'withdrawn_refunded',
    note: '{merchant} charged my dinner of {day} twice. The second charge is a copy.',
    withdraw: '{merchant} refunded the second charge.'},
  wrong_amount: {reason: 'wrong_amount', path: 'resolved_for_me',
    note: '{merchant} charged {charged} nights, but I stayed {nights} nights, {from} to {to}. My booking shows {nights} nights at {rate} a night.',
    credit: 'We added a temporary credit for the extra night while we review your claim.',
    end: 'The hotel confirmed a stay of {nights} nights.'},
  not_as_described: {reason: 'not_as_described', path: 'resolved_for_merchant',
    note: 'The laptop was sold as new, but it arrived as a used unit with scratches and a worn battery. {merchant} would not take it back.',
    credit: 'We added a temporary credit while we ask the merchant about the condition of the laptop.',
    end: 'The merchant showed its product page, which listed the laptop as refurbished.'},
  credit_not_processed: {reason: 'credit_not_processed', path: 'closed_matched',
    note: 'My membership was frozen for {month}. {merchant} promised to refund the fee of {day} in full, but it refunded only {first}.',
    credit: 'We added a temporary credit for the part that was not refunded while we review your claim.',
    end: '{merchant} refunded the rest of the fee, so we took back the temporary credit.'},
  not_recognized: {reason: 'not_recognized', path: 'withdrawn_reversed',
    note: 'I do not recognize this charge of {amount} from {merchant} on {day}.',
    credit: 'We added a temporary credit while we ask the merchant for the details of this charge.',
    withdraw: 'I found it. It is the yearly plan of my photo editing app.',
    reversal: 'You withdrew your dispute, so we took back the temporary credit.'},
  cancelled_recurring: {reason: 'cancelled_recurring', path: 'resolved_for_me',
    note: 'I cancelled {merchant} on {cancelled}. It still charged me {amount} on {day}.',
    credit: 'We added a temporary credit while we ask the merchant about your cancellation.',
    end: 'The merchant confirmed that the plan was cancelled before this charge.'}
};
// Notes on merchant refunds.
const REFUNDS = {
  full_return: 'Return of your order of {day}',
  partial_return: 'Refund for one returned item of your order of {day}',
  flight: 'Your flight of {day} was cancelled by the airline. This is a full refund.',
  duplicate: 'Refund of the second charge for your dinner of {day}',
  gym_first: 'Part of the refund of the fee of {day}',
  gym_rest: 'Rest of the refund of the fee of {day}',
  television: 'Return of the television bought on {day}'
};

// The 16 offers: kind, numbers, terms and outcome, in the order they are issued. `answer` is the cardholder's choice.
const OFFERS = [
  {key: 'bonus-feb-2025', payout_note: 'Bonus points from the offer of February 2025', kind: 'bonus_points', points: 2000, issued: '2025-02-11 11:30', accept_by: '2025-03-31', answer: ['accept', '2025-02-13 20:15'], outcome: 'paid',
    terms: 'Get 2,000 bonus points after you accept this offer. The points post within 14 days.'},
  {key: 'spring-spend', payout_note: 'You spent 3,000.00 within 90 days of accepting the offer', group: 'spring-2025', kind: 'spend_credit', credit_amount: 300, spend_target: 3000, spend_days: 90, issued: '2025-03-11 10:45', accept_by: '2025-04-30',
    answer: ['accept', '2025-04-24 19:50'], outcome: 'paid',
    terms: 'Spend 3,000.00 in the 90 days after you accept and get a statement credit of 300.00. The credit posts within 20 days after you reach the target.'},
  {key: 'spring-bonus', group: 'spring-2025', kind: 'bonus_points', points: 10000, issued: '2025-03-11 10:45', accept_by: '2025-04-30', outcome: 'unavailable',
    terms: 'Get 10,000 bonus points after you accept this offer. The points post within 14 days.'},
  {key: 'dining-may-2025', kind: 'statement_credit', credit_amount: 25, issued: '2025-05-13 14:20', accept_by: '2025-06-15', outcome: 'expired',
    terms: 'Accept this offer and get a dining credit of 25.00 as a statement credit. The credit posts within 30 days.'},
  {key: 'everyday-aug-2025', kind: 'product_change', product_id: 'prd-everyday', issued: '2025-08-05 11:10', accept_by: '2025-09-05', answer: ['decline', '2025-08-07 21:00'],
    outcome: 'declined', terms: 'Change to Brindle Everyday, a card with no annual fee and no transfer partners.'},
  // The target is set from the usual spending of this cardholder, so only the television makes it reachable (dev/generate-dataset.cjs).
  {key: 'fall-spend', kind: 'spend_credit', credit_amount: 100, spend_target: null, spend_days: 60, issued: '2025-09-09 13:30', accept_by: '2025-10-10',
    answer: ['accept', '2025-09-10 19:40'], outcome: 'missed',
    terms: 'Spend {target} in the 60 days after you accept and get a statement credit of 100.00. The credit posts within 20 days after you reach the target.'},
  {key: 'retention-credit', payout_note: 'Thank you for keeping your Brindle Reserve card', group: 'retention-2025-12', kind: 'statement_credit', credit_amount: 150, issued: '2025-12-04 11:00', accept_by: '2026-01-08',
    answer: ['accept', '2025-12-09 20:30'], outcome: 'paid',
    terms: 'Keep your card and get a statement credit of 150.00 after you accept. The credit posts within 30 days.'},
  {key: 'retention-bonus', group: 'retention-2025-12', kind: 'bonus_points', points: 15000, issued: '2025-12-04 11:00', accept_by: '2026-01-08', outcome: 'unavailable',
    terms: 'Keep your card and get 15,000 bonus points after you accept. The points post within 14 days.'},
  {key: 'retention-change', group: 'retention-2025-12', kind: 'product_change', product_id: 'prd-everyday', issued: '2025-12-04 11:00', accept_by: '2026-01-08', outcome: 'unavailable',
    terms: 'Change to Brindle Everyday, a card with no annual fee and no transfer partners.'},
  {key: 'bonus-feb-2026', kind: 'bonus_points', points: 3000, issued: '2026-02-10 10:20', accept_by: '2026-03-15', outcome: 'expired',
    terms: 'Get 3,000 bonus points after you accept this offer. The points post within 14 days.'},
  {key: 'spend-apr-2026', kind: 'spend_credit', credit_amount: 200, spend_target: 2500, spend_days: 90, issued: '2026-04-14 15:00', accept_by: '2026-05-15',
    answer: ['decline', '2026-04-15 21:10'], outcome: 'declined',
    terms: 'Spend 2,500.00 in the 90 days after you accept and get a statement credit of 200.00. The credit posts within 20 days after you reach the target.'},
  {key: 'travel-jun-2026', payout_note: 'Travel credit from the offer of June 2026', kind: 'statement_credit', credit_amount: 50, issued: '2026-06-09 11:40', accept_by: '2026-07-31', answer: ['accept', '2026-06-10 19:05'], outcome: 'paid',
    terms: 'Accept this offer and get a travel credit of 50.00 as a statement credit. The credit posts within 30 days.'},
  {key: 'bonus-sep-2026', payout_note: 'Bonus points from the offer of September 2026', kind: 'bonus_points', points: 5000, issued: '2026-09-15 10:05', accept_by: '2026-10-31', answer: ['accept', '2026-09-17 20:45'], outcome: 'paid',
    terms: 'Get 5,000 bonus points after you accept this offer. The points post within 14 days.'},
  {key: 'retention-2026-credit', group: 'retention-2026-12', kind: 'statement_credit', credit_amount: 200, issued: '2026-12-04 11:00', accept_by: '2027-01-08', outcome: 'available',
    terms: 'Keep your card and get a statement credit of 200.00 after you accept. The credit posts within 30 days.'},
  {key: 'retention-2026-spend', group: 'retention-2026-12', kind: 'spend_credit', credit_amount: 400, spend_target: 4000, spend_days: 90, issued: '2026-12-04 11:00', accept_by: '2027-01-08',
    outcome: 'available',
    terms: 'Keep your card, spend 4,000.00 in the 90 days after you accept and get a statement credit of 400.00. The credit posts within 20 days after you reach the target.'},
  {key: 'retention-2026-change', group: 'retention-2026-12', kind: 'product_change', product_id: 'prd-everyday', issued: '2026-12-04 11:00', accept_by: '2027-01-08', outcome: 'available',
    terms: 'Change to Brindle Everyday, a card with no annual fee and no transfer partners.'}
];
// After acceptance: a credit posts 7 to 30 days later (spending offers 10 to 20 days after the target is met), bonus points 3 to 14 days later.
const PAYOUT_DAYS = {statement_credit: [7, 30], spend_credit: [10, 20], bonus_points: [3, 14]};

// Points the cardholder redeems as a statement credit.
const REDEMPTIONS = [{at: '2025-11-16 19:20', points: 10000}, {at: '2026-08-23 20:10', points: 15000}];

// The time windows of each actor, in local time. Batch postings run at night; decisions are made on business days.
const HOURS = {cardholder: ['07:00', '23:00'], batch: BATCH, issuer: ['09:00', '17:00'], offer: ['10:00', '16:00'], interest: ['23:00', '23:00'], statement: ['02:00', '02:00']};

const fill = (text, values) => text.replace(/\{(\w+)\}/g, (all, key) => key in values ? String(values[key]) : all);
module.exports = {ALL, WEEKDAYS, WEEKEND, MERCHANTS, LUNCH, DINNER, HOTEL_CHECKOUT, BATCH, ACCOUNT, BANKS, RETURN_REASON, interestCents, minimumCents, earnedPoints, DOUBLE,
  HOLIDAYS, TRIPS, AWARD, TRIP_PLACES, DISPUTES, REFUNDS, OFFERS, PAYOUT_DAYS, REDEMPTIONS, HOURS, fill};
