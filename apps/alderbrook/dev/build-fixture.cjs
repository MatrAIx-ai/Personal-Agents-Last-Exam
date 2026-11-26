'use strict';
// Writes fixtures/minimal.json. It replays a scripted history through the App's own hooks, so the App accepted every step of it.
// Run `node dev/build-fixture.cjs` after a change, or `node dev/build-fixture.cjs --check` to compare with the committed file. Never used at run time.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const plugin = require('../plugin.cjs');
const time = require('../src/time.cjs');
const {compile} = require('../tests/schema-validator.cjs');
const {counts} = require('./check-fixture.cjs');
const base = require('./base.json');
const root = path.resolve(__dirname, '..');
const APP = require('../app.json').app_id, ZONE = base.insurer.timezone, CLOCK = require('../fixtures/clock.json').initial_time;
const PROMISED = {policies: 2, vehicles: 2, listed_people: 4, claims: 9, requests: 14, estimates: 12, lines: 46, determinations: 15, disputes: 5,
  offers: 4, payments: 11, rentals: 3, evidence: 60, notifications: 22};

// A local time such as '2026-03-23 08:50', with the UTC offset that the insurer's zone has on that date.
function at(local) {
  for (const offset of ['-04:00', '-05:00']) {
    const value = local.replace(' ', 'T') + ':00' + offset;
    if (time.iso(Date.parse(value), ZONE) === value) return value;
  }
  throw new Error('Not a local time in ' + ZONE + ': ' + local);
}
// One step of the history: a write of the policyholder (`call`) or an act of the insurer, a shop or the lender (`event`). '@label' stands for the ID that a labelled step made.
const steps = [];
const call = (when, name, args, label) => steps.push({when: at(when), name, args, label});
const event = (when, name, args, label) => steps.push({when: at(when), name, args, label, event: true});
const item = kind => (tag, dated, description, reference) => [tag, {kind, dated: at(dated), description, ...(reference ? {reference} : {})}];
const photo = item('photo'), receipt = item('receipt'), report = item('report'), statement = item('statement'), other = item('other');
const line = (text, amount) => ({text, amount});
const ok = (id, amount, reason) => ({line_id: id, status: 'approved', amount, ...(reason ? {reason} : {})});
const no = (id, reason) => ({line_id: id, status: 'denied', reason});
// The steps of one claim. `tag` is the label of the claim, and its parts are labelled `tag.name`.
function story(tag) {
  const ref = name => '@' + tag + (name ? '.' + name : ''), refs = names => names.map(ref);
  return {
    file: (when, policy, coverage, subject, loss, description, more) => call(when, 'claims.file', {id: policy, coverage, subject_id: subject, loss_at: at(loss), description, ...more}, tag),
    update: (when, changes) => call(when, 'claims.update', {id: ref(), ...changes}),
    evidence: (when, ...items) => call(when, 'claims.add_evidence', {id: ref(), items: items.map(([, record]) => record)}, items.map(([name]) => tag + '.' + name)),
    withdraw: when => call(when, 'claims.withdraw', {id: ref()}),
    request: (when, name, by, due, asks) => event(when, 'request.issued', {claim_id: ref(), asks: Object.entries(asks).map(([key, text]) => ({key, text})),
      ...(due ? {due_at: at(due)} : {}), issued_by: by}, tag + '.' + name),
    respond: (when, name, answers) => call(when, 'requests.respond', {id: ref(name),
      answers: Object.entries(answers).map(([key, [text, ...evidence]]) => ({key, text, evidence_ids: refs(evidence)}))}),
    submit: (when, kind, shop, lines) => call(when, 'estimates.submit', {id: ref(), kind, shop_name: shop, lines}),
    estimate: (when, kind, source, shop, lines) => event(when, 'estimate.submitted', {claim_id: ref(), kind, source, ...(shop ? {shop_name: shop} : {}), lines}),
    decide: (when, by, note, lines) => event(when, 'determination.issued', {claim_id: ref(), lines, issued_by: by, note}),
    dispute: (when, name, lineId, reason, evidence) => call(when, 'determinations.dispute', {id: lineId, claim_id: ref(), reason, evidence_ids: refs(evidence)}, tag + '.' + name),
    decided: (when, name, decision, by, note, changed) => event(when, 'dispute.decided', {dispute_id: ref(name), decision, ...(changed ? {line: changed} : {}), decided_by: by, note}),
    payee: (when, payee) => call(when, 'payee.set', {id: ref(), payee}),
    offer: (when, name, valuation, respondBy, basis) => event(when, 'offer.issued', {claim_id: ref(), valuation, ...(respondBy ? {respond_by: at(respondBy)} : {}),
      issued_by: IMANI, basis}, tag + '.' + name),
    accept: (when, name) => call(when, 'offers.accept', {id: ref(name)}),
    reject: (when, name, reason, evidence) => call(when, 'offers.reject', {id: ref(name), reason, evidence_ids: refs(evidence)}),
    rent: (when, name, start, rate) => call(when, 'rental.start', {id: ref(), start_at: at(start), daily_rate: rate}, tag + '.' + name),
    returned: (when, name, end) => call(when, 'rental.end', {id: ref(name), end_at: at(end)}),
    pay: (when, kind, amount, reference, payee) => event(when, 'payment.issued', {claim_id: ref(), kind, amount, ...(payee ? {payee} : {}), reference}),
    repaired: (when, by, invoiceTotal) => event(when, 'repair.completed', {claim_id: ref(), reported_by: by, final_invoice_total: invoiceTotal}),
    close: (when, outcome, note) => event(when, 'claim.closed', {claim_id: ref(), outcome, note})
  };
}
const AUTO = 'pol-auto-01', RENT = 'pol-rent-01', CRV = 'veh-01', CAMRY = 'veh-02', HOME = 'addr-01';
const IMANI = 'Adjuster R. Imani', OKAFOR = 'Adjuster T. Okafor', BRANDT = 'Claims supervisor L. Brandt';
const LAKESHORE = 'Lakeshore Collision Center', CORNER = 'Corner Auto Body';
const listed = person => ({kind: 'listed', person_id: person});

// clm-0001. Water from the unit above. Paid. One dispute was upheld, and one line was corrected after its payment, so 50.00 is overpaid.
const water = story('water');
water.file('2026-03-23 08:50', RENT, 'personal_property', HOME, '2026-03-21 06:40',
  'A supply line burst in the unit above, 4B, early on Saturday. Water came through the living room ceiling and soaked the sofa, the rug, the television and two bookcases.');
water.evidence('2026-03-23 08:58',
  photo('ceiling', '2026-03-21 07:05', 'Living room ceiling with a wide water stain and wet drywall.'),
  photo('sofa', '2026-03-21 07:08', 'Soaked sofa and wool rug under the leak.'),
  photo('media', '2026-03-21 07:12', 'Television and soundbar on the wet media console.'),
  photo('books', '2026-03-21 07:20', 'Two bookcases with wet books on the lower shelves.'),
  report('manager', '2026-03-21 15:30', 'Incident report from the building manager, Larch Street Properties: burst supply line in unit 4B.', 'LSP-IR-2026-031'));
water.request('2026-03-24 10:15', 'r1', OKAFOR, '2026-04-03 17:00', {
  cause: 'What caused the water, and did the building manager confirm it in writing?',
  items: 'A list of the damaged items, with the year you bought each one.'});
water.evidence('2026-03-25 19:22', statement('list', '2026-03-25 19:00', 'List of the damaged items with the year of purchase, written by Jordan Ellis.'));
water.respond('2026-03-25 19:30', 'r1', {
  cause: ['A supply line under the kitchen sink of unit 4B burst. The incident report of the building manager is attached.', 'manager'],
  items: ['The list is attached. The sofa is from 2020, the rug from 2022, the television from 2024 and the soundbar from 2025.', 'list']});
water.submit('2026-03-26 18:05', 'initial', 'Flower City Restoration', [
  line('Sofa, three seats, fabric: replace', 1150), line('Wool rug, 5 by 8 feet: replace', 320), line('Television, 50 inch: replace', 479.99),
  line('Soundbar: replace', 199), line('Media console, oak veneer: replace', 265), line('Two bookcases and their books: dry and clean', 385.5)]);
water.decide('2026-03-31 14:20', OKAFOR, 'The sofa is approved at its actual cash value: 30 percent off for six years of use. The television and the soundbar wait for proof of purchase.',
  [ok('ln-p01', 805, 'Actual cash value after six years of use.'), ok('ln-p02', 320), ok('ln-p05', 265), ok('ln-p06', 385.5)]);
water.request('2026-03-31 14:25', 'r2', OKAFOR, null, {tv_receipt: 'Proof of purchase for the television.', soundbar_receipt: 'Proof of purchase for the soundbar.'});
water.evidence('2026-04-02 20:10',
  receipt('tv', '2024-11-29 13:40', 'Order confirmation for the television from East End Electronics, 479.99.', 'EEE-448120'),
  receipt('soundbar', '2025-01-12 16:05', 'Card statement line for the soundbar, 199.00.'));
water.respond('2026-04-02 20:16', 'r2', {
  tv_receipt: ['The order confirmation is attached.', 'tv'],
  soundbar_receipt: ['I have no receipt. The attached card statement shows the purchase.', 'soundbar']});
water.evidence('2026-04-03 09:01', other('sofa_price', '2026-04-03 08:50', 'Web page of the same sofa model at today\'s price, 1,150.00.'));
water.dispute('2026-04-03 09:05', 'd1', 'ln-p01','A new sofa of the same kind costs 1,150.00 today. The policy should pay what it costs to replace it.', ['sofa_price']);
water.decide('2026-04-07 11:30', OKAFOR, 'Proof of purchase is accepted for both items.', [ok('ln-p03', 479.99), ok('ln-p04', 199)]);
water.pay('2026-04-08 15:45', 'repair', 2204.49, 'EFT 70114');
water.decided('2026-04-10 10:20', 'd1', 'upheld', BRANDT, 'This policy pays the actual cash value of furniture, not the price of a new one. The decision stands.');
water.estimate('2026-04-14 17:40', 'supplement', 'shop', 'Flower City Restoration', [
  line('Coats and bedding from the hall closet: dry cleaning', 142.8), line('Floor lamp, shorted by water: replace', 89), line('Dehumidifier, rented for 4 days', 96)]);
water.decide('2026-04-17 13:10', OKAFOR, 'Two lines are approved. The dehumidifier dried the building, not your belongings.',
  [ok('ln-07', 142.8), ok('ln-08', 89), no('ln-09', 'Drying the building is for the owner of the building. It is not personal property.')]);
water.pay('2026-04-21 12:00', 'repair', 231.8, 'EFT 70391');
water.evidence('2026-04-24 19:15', receipt('rug', '2022-10-08 11:25', 'Receipt for the wool rug from Hearth and Loom, 270.00.', 'HL-20221008-77'));
water.decide('2026-04-28 10:40', OKAFOR, 'The rug is now approved at its receipt price of 270.00. The payment of 8 April included 50.00 more than this.',
  [ok('ln-p02', 270, 'The receipt shows a price of 270.00.')]);
water.close('2026-05-05 09:30', 'paid', 'All approved amounts are paid. Alderbrook Mutual will not collect the 50.00 that was paid above the corrected rug amount.');

// clm-0002. A stolen bicycle. Closed with no response: the police report number never came, and the lines were never decided.
const bike = story('bike');
bike.file('2026-05-18 12:35', RENT, 'personal_property', HOME, '2026-05-16 07:30',
  'My bicycle was stolen from the locked bike room in the basement of 48 Larch Street. The cable lock was cut. I found this on Saturday morning.');
bike.evidence('2026-05-18 12:41',
  photo('lock', '2026-05-16 07:35', 'Cut cable lock on the floor of the bike room.'),
  photo('bicycle', '2025-07-04 10:15', 'The bicycle in summer 2025: a grey hybrid with a rear rack.'));
bike.request('2026-05-19 09:40', 'r1', OKAFOR, '2026-05-29 17:00', {
  police_report: 'The police report number for the theft.',
  proof: 'Proof that you owned the bicycle: a receipt, a serial number or a registration.'});
bike.submit('2026-05-20 18:20', 'initial', 'Genesee Cycle Works', [line('Hybrid bicycle, same model: replace', 849.99), line('U-lock with cable: replace', 64.95)]);
bike.respond('2026-05-21 08:15', 'r1', {proof: ['I have no receipt. I bought the bicycle second hand in 2024. The attached photo shows it.', 'bicycle']});
bike.request('2026-06-02 10:05', 'r2', OKAFOR, null, {police_report: 'Second request: the police report number. A theft claim cannot be decided without it.'});
bike.request('2026-06-12 09:20', 'r3', OKAFOR, '2026-06-22 17:00', {police_report: 'Last request: the police report number. With no answer by 22 June, the claim will be closed.'});
bike.close('2026-06-23 09:15', 'no_response', 'No police report number was received after three requests.');

// clm-0003. Hail on the CR-V. A total loss, and the owner keeps the car. Four offers: superseded, expired, rejected and accepted.
const hail = story('hail');
hail.file('2026-07-17 08:40', AUTO, 'comprehensive', CRV, '2026-07-16 17:20',
  'A hail storm hit while the car was parked at Cobbs Hill Park. There are dents on the hood, the roof, the trunk lid and the doors. The windshield and the rear glass are broken.');
hail.evidence('2026-07-17 08:47',
  photo('panels', '2026-07-16 17:45', 'Hood and roof with many hail dents.'),
  photo('windshield', '2026-07-16 17:47', 'Broken windshield.'),
  photo('rear_glass', '2026-07-16 17:48', 'Broken rear glass.'),
  report('storm', '2026-07-16 20:00', 'Weather service storm report: hail up to 1.75 inches in Rochester on 16 July.'));
hail.request('2026-07-17 13:30', 'r1', IMANI, '2026-07-24 17:00', {
  photos: 'Photos of every damaged panel and of both broken windows.',
  odometer: 'The odometer reading, with a photo.',
  drivable: 'Can the car be driven safely?'});
hail.evidence('2026-07-17 18:45', photo('odometer', '2026-07-17 18:40', 'Odometer reading: 58,214 miles.'));
hail.respond('2026-07-17 18:52', 'r1', {
  photos: ['The photos are attached.', 'panels', 'windshield', 'rear_glass'],
  odometer: ['58,214 miles. The photo is attached.', 'odometer'],
  drivable: ['No. Both windows are broken, and the car is parked at home.']});
hail.rent('2026-07-18 09:00', 'rental', '2026-07-18 08:30', 44);
hail.estimate('2026-07-21 11:15', 'initial', 'adjuster', null, [
  line('Hood panel: replace and paint', 1780), line('Roof panel: replace and paint', 4890), line('Trunk lid: replace and paint', 1465.5),
  line('Windshield: replace, and recalibrate the camera', 1189.75), line('Rear glass: replace', 742.3),
  line('Four doors and both front fenders: paintless dent repair', 3960), line('Rear quarter panel, right: repair and paint', 1320)]);
hail.decide('2026-07-22 15:40', IMANI, 'The glass is approved so that the car can be made safe. The body lines wait for the total loss review.',
  [ok('ln-04', 1189.75), ok('ln-05', 742.3), no('ln-07', 'The dent and the rust on this panel are older than the storm. They show in the photos of the June policy inspection.')]);
hail.evidence('2026-07-23 08:14', photo('quarter', '2026-07-02 18:30', 'Right rear quarter panel on 2 July, with no dent.'));
hail.dispute('2026-07-23 08:20', 'd1', 'ln-07', 'The right rear panel had no dent before the storm. The June photo shows a reflection, not a dent.', ['quarter']);
hail.request('2026-07-27 10:00', 'r2', IMANI, null, {
  keep: 'If the car is a total loss, do you want to keep it? If you keep it, its salvage value is taken off the settlement.',
  title: 'Is the title in your name, with no loan on the car?'});
hail.respond('2026-07-27 19:05', 'r2', {
  keep: ['Yes. I want to keep the car and have it repaired myself.'],
  title: ['Yes. The title is in my name, and there is no loan.']});
hail.offer('2026-07-29 14:00', 'o1', 14320, '2026-08-05 17:00',
  'The repair cost of 15,347.55 is above 75 percent of the value. Actual cash value of 17,900.00 from three comparable vehicles within 100 miles, at 85,214 miles. Less 3,580.00 salvage value, because the owner keeps the vehicle.');
hail.offer('2026-07-31 11:30', 'o2', 14920, null,
  'Corrected for the odometer reading of 58,214 miles. Actual cash value of 18,650.00 from the same three comparable vehicles. Less 3,730.00 salvage value, because the owner keeps the vehicle.');
hail.returned('2026-08-06 10:05', 'rental', '2026-08-06 10:00');
hail.offer('2026-08-10 10:20', 'o3', 14920, '2026-08-17 17:00', 'The offer of 31 July expired with no answer. It is issued again with the same valuation.');
hail.evidence('2026-08-11 20:30',
  other('listing_a', '2026-08-11 19:50', 'Dealer listing: 2021 Honda CR-V EX-L, 55,100 miles, 20,400.00, Henrietta.'),
  other('listing_b', '2026-08-11 19:55', 'Dealer listing: 2021 Honda CR-V EX-L, 61,800 miles, 19,900.00, Victor.'));
hail.reject('2026-08-11 20:38', 'o3', 'The comparable vehicles in the valuation are a lower trim level. Two dealer listings of the same trim and mileage are near 20,000.00.', ['listing_a', 'listing_b']);
hail.pay('2026-08-12 12:00', 'rental', 640, 'EFT 71866');
hail.offer('2026-08-14 13:15', 'o4', 15480, '2026-08-21 17:00',
  'Revised with two comparable vehicles of the same trim level. Actual cash value of 19,350.00. Less 3,870.00 salvage value, because the owner keeps the vehicle.');
hail.accept('2026-08-15 09:05', 'o4');
hail.pay('2026-08-19 12:00', 'settlement', 15230, 'EFT 72050', {kind: 'policyholder'});
hail.close('2026-08-25 09:45', 'paid', 'The settlement is paid. The owner keeps the vehicle.');

// clm-0004. The Camry was hit at a crossing. Repaired and paid, with two supplements, a changed dispute, one payment to the wrong payee and two rental periods.
const crash = story('crash');
crash.file('2026-08-24 09:20', AUTO, 'collision', CAMRY, '2026-08-22 11:35',
  'Another car ran the stop sign at Park Avenue and Berkeley Street and hit the right front of my car. The car was towed from the scene.', {police_report_number: 'RPD-26-083317'});
crash.evidence('2026-08-24 09:27',
  photo('front', '2026-08-22 11:50', 'Right front corner: bumper, headlamp and fender.'),
  photo('wheel', '2026-08-22 11:52', 'Right front wheel pushed back in the wheel arch.'),
  photo('other_car', '2026-08-22 11:55', 'The other car and its plate.'),
  report('police', '2026-08-22 13:10', 'Police accident report for the collision at Park Avenue and Berkeley Street.', 'RPD-26-083317'));
crash.request('2026-08-24 14:10', 'r1', IMANI, '2026-09-03 17:00', {
  driver: 'Who was driving, and is that person listed on the policy?',
  photos: 'Photos of the damage from four sides.',
  other_party: 'The name and the insurer of the other driver.'});
crash.update('2026-08-24 19:00', {driver: listed('person-priya')});
crash.evidence('2026-08-24 19:06',
  photo('sides', '2026-08-24 18:20', 'Left side and rear of the car at the shop, with no damage.'),
  statement('priya', '2026-08-23 20:00', 'Statement by Priya Ellis about the collision.'));
crash.respond('2026-08-24 19:12', 'r1', {
  driver: ['Priya Ellis was driving. She is a listed driver on the policy.', 'priya'],
  photos: ['The photos are attached.', 'front', 'wheel', 'sides'],
  other_party: ['Dale Whitcomb, insured with Northgate Insurance. Both are in the police report.', 'police']});
crash.payee('2026-08-25 08:10', {kind: 'shop', name: LAKESHORE});
crash.rent('2026-08-25 08:45', 'rental_a', '2026-08-25 08:30', 38);
crash.estimate('2026-08-27 16:20', 'initial', 'shop', LAKESHORE, [
  line('Front bumper cover: replace and paint', 1145), line('Headlamp assembly, right, adaptive LED: replace', 868.4), line('Fender, right front: replace and paint', 1236.75),
  line('Radiator support: repair', 540), line('Alloy wheel, right front: replace', 612), line('Towing from the scene, sublet', 135)]);
crash.request('2026-08-28 09:30', 'r2', IMANI, null, {wheel: 'Was the right front wheel damaged before this collision, for example by a curb?'});
crash.respond('2026-08-28 18:15', 'r2', {wheel: ['It had light curb marks on the rim. It was not bent or cracked before the collision.']});
crash.decide('2026-08-31 10:30', IMANI, 'Five lines are approved. The headlamp is priced as an aftermarket part. The wheel is denied.', [
  ok('ln-01', 1145), ok('ln-02', 655, 'Priced as an aftermarket part of like kind and quality.'), ok('ln-03', 1236.75), ok('ln-04', 540),
  no('ln-05', 'The wheel shows curb wear from before the loss. The photos show no damage from this collision.'), ok('ln-06', 135)]);
crash.evidence('2026-09-01 12:04', other('letter', '2026-09-01 10:30', 'Letter from Lakeshore Collision Center: no aftermarket headlamp fits the adaptive LED unit of this model.'));
crash.dispute('2026-09-01 12:10', 'd1', 'ln-02', 'The shop says that no aftermarket headlamp fits the adaptive LED unit of this car. Its letter is attached.', ['letter']);
crash.pay('2026-09-02 11:00', 'repair', 3211.75, 'EFT 72514');
crash.returned('2026-09-03 09:10', 'rental_a', '2026-09-03 09:00');
crash.rent('2026-09-03 09:12', 'rental_b', '2026-09-03 09:00', 52.5);
crash.evidence('2026-09-03 18:00', receipt('rental_small', '2026-09-03 09:00', 'Rental invoice: compact car, 25 August to 3 September, 38.00 a day.', 'RA-1187204'));
crash.evidence('2026-09-04 12:30', photo('teardown', '2026-09-03 15:10', 'Photo from the shop after teardown: bent bumper reinforcement bar and crushed A/C condenser.'));
crash.estimate('2026-09-04 15:30', 'supplement', 'shop', LAKESHORE, [
  line('A/C condenser: replace', 486.2), line('Washer fluid reservoir: replace', 127.35), line('Front bumper reinforcement bar: replace', 398)]);
crash.decide('2026-09-08 09:50', IMANI, 'Supplement approved as estimated.', [ok('ln-07', 486.2), ok('ln-08', 127.35), ok('ln-09', 398)]);
crash.pay('2026-09-08 12:00', 'rental', 342, 'EFT 72688');
crash.decided('2026-09-09 14:00', 'd1', 'changed', BRANDT, 'The letter from the shop is accepted. The original part is approved.', {status: 'approved', amount: 868.4});
crash.pay('2026-09-10 12:00', 'repair', 1011.55, 'Check 204471', {kind: 'policyholder'});
crash.estimate('2026-09-11 17:10', 'supplement', 'shop', LAKESHORE, [
  line('Wheel alignment, four wheels, and radar sensor recalibration', 434.95), line('Paint blend, right front door', 312.5)]);
crash.decide('2026-09-15 10:15', IMANI, 'The alignment and the recalibration are approved. The paint blend is approved for 2.5 hours of labor.',
  [ok('ln-10', 434.95), ok('ln-11', 250, 'Blend time is limited to 2.5 hours at the agreed labor rate.')]);
crash.request('2026-09-15 10:20', 'r3', IMANI, '2026-09-22 17:00', {wheel_photos: 'Photos from the shop of the right front wheel with the tire off.'});
crash.evidence('2026-09-16 16:45', photo('crack', '2026-09-16 11:20', 'Photo from the shop: crack on the inner rim of the right front wheel, tire off.'));
crash.respond('2026-09-16 16:50', 'r3', {wheel_photos: ['The photo from the shop is attached. The inner rim is cracked.', 'crack']});
crash.decide('2026-09-17 09:30', IMANI, 'The photo shows a crack from the impact. The wheel is approved.', [ok('ln-05', 612)]);
crash.repaired('2026-09-18 16:00', LAKESHORE, 6296.15);
crash.returned('2026-09-19 10:10', 'rental_b', '2026-09-19 10:00');
crash.evidence('2026-09-19 18:30',
  receipt('rental_large', '2026-09-19 10:00', 'Rental invoice: mid-size SUV, 3 to 19 September, 52.50 a day.', 'RA-1191533'),
  receipt('invoice', '2026-09-18 16:00', 'Final invoice from Lakeshore Collision Center, 6,296.15.', 'LCC-0090417'));
crash.pay('2026-09-22 12:00', 'repair', 1510.35, 'EFT 73102');
crash.pay('2026-09-24 12:00', 'rental', 600, 'EFT 73190');
crash.close('2026-09-29 10:00', 'paid', 'All approved amounts are paid.');

// clm-0005. Sam hit a post in a delivery lane. Approved at first, then denied for paid delivery use. The dispute was upheld.
const post = story('post');
post.file('2026-09-28 08:30', AUTO, 'collision', CRV, '2026-09-26 19:45',
  'Sam Ellis hit a steel post while turning in a lot on Alexander Street. Damage to the left front fender and the left front door.', {driver: listed('person-sam')});
post.evidence('2026-09-28 08:36',
  photo('fender', '2026-09-26 20:05', 'Left front fender, pushed in.'),
  photo('door', '2026-09-26 20:06', 'Left front door with a long scrape and a dent.'),
  photo('post', '2026-09-27 09:30', 'The steel post at the corner of the lot.'),
  photo('lot', '2026-09-27 09:32', 'Wide view of the lot behind the restaurants on Alexander Street.'));
post.request('2026-09-28 13:00', 'r1', IMANI, '2026-10-08 17:00', {
  where: 'Where exactly did the loss happen, and at what time?',
  statement: 'A short statement from the driver about how it happened.'});
post.evidence('2026-09-29 21:05', statement('sam', '2026-09-29 20:40', 'Statement by Sam Ellis about how he hit the post.'));
post.respond('2026-09-29 21:10', 'r1', {
  where: ['In the lot behind Saffron House on Alexander Street, at about 19:45 on 26 September.'],
  statement: ['The statement by Sam Ellis is attached.', 'sam']});
post.estimate('2026-10-01 11:30', 'initial', 'shop', CORNER, [
  line('Fender, left front: replace and paint', 1084.6), line('Door shell, left front: repair and paint', 936),
  line('Mirror cover, left: replace', 78.45), line('Wheel opening molding, left front: replace', 112.9)]);
post.decide('2026-10-02 09:20', IMANI, 'Approved as estimated.', [ok('ln-01', 1084.6), ok('ln-02', 936), ok('ln-03', 78.45), ok('ln-04', 112.9)]);
post.request('2026-10-05 15:10', 'r2', IMANI, null, {
  use: 'The lot is a pickup lane for delivery drivers. What was the car used for at the time of the loss?',
  account: 'Does the driver have an account with a delivery app?'});
post.respond('2026-10-06 20:25', 'r2', {
  use: ['Sam was picking up food orders for a delivery app that evening.'],
  account: ['Yes. Sam has had a driver account since August.']});
post.decide('2026-10-08 10:05', IMANI, 'The approval of 2 October is withdrawn. The policy excludes a loss during paid delivery use.',
  ['ln-01', 'ln-02', 'ln-03', 'ln-04'].map(id => no(id, 'The car was used for paid delivery at the time of the loss. The policy excludes this use.')));
post.evidence('2026-10-09 18:33',
  statement('sam_trip', '2026-10-09 17:50', 'Statement by Sam Ellis: his last delivery ended at 19:20, before the loss.'),
  other('trips', '2026-10-09 18:00', 'Screenshot of the trip list in the delivery app for 26 September.'));
post.dispute('2026-10-09 18:40', 'd1', 'ln-01', 'Sam had finished his last delivery and was leaving the lot. He was not on a paid trip at the time.', ['sam_trip', 'trips']);
post.decided('2026-10-16 10:00', 'd1', 'upheld', BRANDT, 'The trip list shows an active order from 19:38 to 20:02. The decision stands.');
post.close('2026-10-20 09:00', 'denied', 'The loss happened during paid delivery use, which the policy excludes.');

// clm-0006. A break-in at the apartment. Still open: one line pending, one denied, an open dispute and a request that is past its due time.
const theft = story('theft');
theft.file('2026-11-01 10:15', RENT, 'personal_property', HOME, '2026-10-31 20:30',
  'Someone came in through the fire escape window while we were out on Saturday evening. A laptop, a camera, a game console, a tablet, jewelry and cash were taken. A desk drawer was forced.');
theft.evidence('2026-11-01 10:24',
  photo('window', '2026-10-31 22:40', 'Fire escape window with the broken lock.'),
  photo('desk', '2026-10-31 22:45', 'Bedroom desk with the forced drawer.'),
  photo('shelf', '2026-10-31 22:48', 'Empty shelf where the game console and the camera were.'),
  statement('stolen', '2026-11-01 09:30', 'List of the stolen items, written by Jordan Ellis and Noor Haddad.'));
theft.update('2026-11-01 16:40', {police_report_number: 'RPD-26-104482'});
theft.evidence('2026-11-01 16:44', report('police', '2026-11-01 15:20', 'Police report for the break-in at 48 Larch Street, Apt 3B.', 'RPD-26-104482'));
theft.request('2026-11-02 11:00', 'r1', OKAFOR, '2026-11-12 17:00', {
  receipts: 'Proof of purchase for the laptop, the camera and the game console.',
  jewelry: 'A description of each piece of jewelry, with a photo or an appraisal if you have one.',
  entry: 'How did the person get in, and was the window locked?'});
theft.evidence('2026-11-03 20:40',
  receipt('laptop', '2025-09-02 14:10', 'Receipt for the laptop from East End Electronics, 1,299.00.', 'EEE-512077'),
  receipt('camera', '2024-05-18 11:30', 'Receipt for the camera with kit lens, 1,148.50.'),
  receipt('console', '2025-12-20 17:45', 'Receipt for the game console with two controllers, 589.97.'),
  photo('necklace', '2025-06-14 19:00', 'Noor Haddad wearing the gold necklace and the pearl earrings, June 2025.'));
theft.respond('2026-11-03 20:50', 'r1', {
  receipts: ['The three receipts are attached.', 'laptop', 'camera', 'console'],
  jewelry: ['A gold necklace, a pair of pearl earrings and an automatic wristwatch. A photo of the necklace and the earrings is attached.', 'necklace'],
  entry: ['Through the fire escape window. It was locked, and the lock was broken from outside.', 'window']});
theft.submit('2026-11-04 19:15', 'initial', 'East End Electronics', [
  line('Laptop, 14 inch: replace', 1299), line('Mirrorless camera with kit lens: replace', 1148.5), line('Game console with two controllers: replace', 589.97),
  line('Noise-cancelling headphones: replace', 279.99), line('Tablet, 11 inch: replace', 449)]);
theft.submit('2026-11-06 12:30', 'supplement', 'Marigold Jewelers', [
  line('Gold necklace, 18 inch: replace', 1450), line('Pearl earrings, one pair: replace', 380), line('Automatic wristwatch: replace', 925)]);
theft.decide('2026-11-09 14:30', OKAFOR, 'Three items are approved at their receipt prices. The headphones are denied. The tablet waits for proof of purchase.',
  [ok('ln-p01', 1299), ok('ln-p02', 1148.5), ok('ln-p03', 589.97), no('ln-p04', 'There is no proof that you owned this item, and it is not in the police report.')]);
theft.evidence('2026-11-10 18:20', receipt('locksmith', '2026-11-02 13:15', 'Invoice from Keyway Locksmith for a new window lock, 48.75.', 'KW-3391'));
theft.pay('2026-11-12 12:00', 'repair', 2787.47, 'EFT 75220');
theft.estimate('2026-11-13 15:20', 'supplement', 'adjuster', null, [
  line('Desk, forced drawer: repair', 165), line('Window lock, the tenant\'s own: replace', 48.75), line('Cash taken from the desk drawer', 400)]);
theft.decide('2026-11-16 10:45', OKAFOR, 'Jewelry is limited to 1,000.00 for each piece. The watch has no appraisal and is approved at the value of a comparable watch.', [
  ok('ln-p06', 1000, 'Jewelry is limited to 1,000.00 for each piece under this policy.'), ok('ln-p07', 380),
  ok('ln-p08', 600, 'No appraisal and no receipt. Approved at the value of a comparable watch.')]);
theft.evidence('2026-11-18 19:12',
  other('appraisal', '2026-11-18 15:30', 'Written appraisal of the wristwatch by Marigold Jewelers, 925.00.', 'MJ-A-2291'),
  photo('watch', '2025-12-25 12:00', 'Jordan Ellis wearing the wristwatch, December 2025.'));
theft.dispute('2026-11-18 19:20', 'd1', 'ln-p08','The jeweler has now appraised the watch at 925.00. The appraisal and a photo are attached.', ['appraisal', 'watch']);
theft.decide('2026-11-20 09:40', OKAFOR, 'The desk and the lock are approved. Cash is limited to 200.00.',
  [ok('ln-09', 165), ok('ln-10', 48.75), ok('ln-11', 200, 'Cash is limited to 200.00 under this policy.')]);
theft.request('2026-11-21 11:10', 'r2', OKAFOR, '2026-12-01 17:00', {
  tablet: 'Proof of purchase for the tablet, or its serial number.',
  headphones: 'Any proof that you owned the headphones.'});
theft.pay('2026-11-23 12:00', 'repair', 2393.75, 'EFT 75518');
theft.evidence('2026-11-24 20:05', photo('tablet_box', '2026-11-24 19:55', 'The box of the tablet, with its serial number.'));
theft.respond('2026-11-24 20:10', 'r2', {tablet: ['I have no receipt. The serial number is on the box in the attached photo.', 'tablet_box']});

// clm-0007 and clm-0009. Two new collision claims with no estimate yet.
const bumper = story('bumper');
bumper.file('2026-11-30 09:15', AUTO, 'collision', CRV, '2026-11-28 16:40',
  'Rear-ended at a stop light on Monroe Avenue. Damage to the rear bumper and the left tail lamp.', {police_report_number: 'RPD-26-118842', driver: listed('person-jordan')});
bumper.evidence('2026-11-30 09:22',
  photo('rear', '2026-11-28 16:50', 'Rear bumper, pushed in on the left side.'),
  photo('lamp', '2026-11-28 16:51', 'Broken left tail lamp.'),
  photo('other_car', '2026-11-28 16:55', 'The other car, its plate and the insurance card of its driver.'));
const ice = story('ice');
ice.file('2026-12-01 10:30', AUTO, 'collision', CAMRY, '2026-11-29 07:50',
  'Slid on ice into a guard rail on Route 490. Heavy damage to the front and the left side.', {driver: listed('person-priya')});
ice.evidence('2026-12-01 10:36',
  photo('front', '2026-11-29 08:05', 'Front of the car against the guard rail.'),
  photo('left', '2026-11-29 08:07', 'Left side: both doors and the rocker panel.'));

// clm-0008. A broken door mirror, already repaired. The approved total is under the deductible, so the claim was withdrawn.
const mirror = story('mirror');
mirror.file('2026-11-30 09:40', AUTO, 'comprehensive', CAMRY, '2026-11-07 07:15',
  'The left door mirror was broken off while the car was parked on Larch Street overnight. I had it replaced on 10 November.');
mirror.evidence('2026-11-30 09:46',
  photo('broken', '2026-11-07 07:20', 'Left door mirror hanging by its cable.'),
  receipt('invoice', '2026-11-10 15:40', 'Paid invoice from Park Avenue Auto Glass for the mirror, 212.40.', 'PAAG-7714'),
  photo('fitted', '2026-11-10 15:45', 'The new mirror, fitted.'));
mirror.submit('2026-11-30 09:52', 'initial', 'Park Avenue Auto Glass', [line('Door mirror assembly, left, heated: replace', 164.9), line('Labor: fit the mirror and paint its cover', 47.5)]);
mirror.decide('2026-12-01 09:10', IMANI, 'Both lines are approved as invoiced. The total of 212.40 is below your comprehensive deductible of 250.00, so no payment is due.',
  [ok('ln-p01', 164.9), ok('ln-p02', 47.5)]);
mirror.withdraw('2026-12-01 10:12');

// Email notices were off for eight days in November, so three of the notifications that the fixture keeps have no wire message.
call('2026-11-14 08:00', 'preferences.update', {email_notices: false});
call('2026-11-22 09:30', 'preferences.update', {email_notices: true});

// The ID field of each event that adds a part to a claim, with the prefix of its dense IDs and the list that holds the part.
const NEW = {'request.issued': ['info_request_id', 'req-', 'requests'], 'estimate.submitted': ['estimate_id', 'est-', 'estimates'],
  'determination.issued': ['determination_id', 'det-', 'determinations'], 'offer.issued': ['offer_id', 'off-', 'offers'], 'payment.issued': ['payment_id', 'pay-', 'payments']};
const pad = (number, size = 4) => String(number).padStart(size, '0');
const ctx = (role, now) => Object.freeze({app_id: APP, role, virtual_now: now, binding: structuredClone(require('../fixtures/binding.json'))});
const seedValid = compile(require('../schemas/seed.schema.json'), path.join(root, 'schemas'));
// The checks that Core runs on a loaded seed and after every write and event.
function valid(data, now) {
  assert.ok(seedValid(data), 'Seed schema');
  plugin.validateSeed(ctx('infra', now), data);
}
function replay() {
  let data = {...structuredClone(base), claims: [], notifications: [], activity: []};
  const ids = {}, done = {writes: 0, events: 0};
  const inputs = new Map(require('../tools.json').map(tool => [tool.name, compile(tool.inputSchema, root)]));
  const eventValid = compile(require('../schemas/events.schema.json'), path.join(root, 'schemas'));
  const resolve = value => typeof value === 'string' ? (value.startsWith('@') ? ids[value.slice(1)] || assert.fail('Unknown label ' + value) : value)
    : Array.isArray(value) ? value.map(resolve) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v)])) : value;
  function apply(step, args) {
    const [field, prefix, part] = NEW[step.name] || [];
    // An estimate of the policyholder has an ID that the App made (est-p), so it is not counted here.
    if (field) args[field] = prefix + pad(data.claims.reduce((n, claim) => n + claim[part].filter(row => row.source !== 'policyholder').length, 0) + 1);
    // A line of an event takes the next place among all the lines of its claim.
    if (step.name === 'estimate.submitted') {
      const first = data.claims.find(claim => claim.id === args.claim_id).estimates.reduce((n, estimate) => n + estimate.lines.length, 0) + 1;
      args.lines = args.lines.map((row, index) => ({line_id: 'ln-' + pad(first + index, 2), ...row}));
    }
    const incoming = {event_id: 'ev-seed-' + pad(++done.events), at: step.when, operation: APP + '.' + step.name, payload: args};
    assert.ok(eventValid(incoming), 'Event schema');
    data = plugin.applyEvent(ctx('infra', step.when), data, incoming);
    if (step.label) ids[step.label] = args[field];
  }
  function write(step, args) {
    const name = APP + '.' + step.name, full = {...args, expected_version: {epoch: 1, revision: done.writes + done.events}, request_id: 'seed-' + pad(++done.writes)};
    assert.ok(inputs.get(name)(full), 'Input schema');
    const out = plugin.handleTool(ctx('agent', step.when), data, name, full);
    data = out.data;
    if (Array.isArray(step.label)) step.label.forEach((label, index) => { ids[label] = out.result.evidence_ids[index]; });
    else if (step.label) ids[step.label] = out.result.id;
  }
  // The sort is stable, and every step runs at its own time. So the clock only moves forward.
  for (const step of [...steps].sort((a, b) => Date.parse(a.when) - Date.parse(b.when))) {
    try {
      (step.event ? apply : write)(step, resolve(step.args));
      valid(data, step.when);
    } catch (error) { error.message = step.name + ' at ' + step.when + ': ' + error.message; throw error; }
  }
  return data;
}
// Calls `visit` for every timestamp in a value.
function stamps(value, visit) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) visit(value);
  else if (value && typeof value === 'object') for (const inner of Object.values(value)) stamps(inner, visit);
}
// What the plan promises of the fixture. A wrong count fails the build.
function promised(data) {
  const made = counts(data), covers = (values, wanted) => assert.deepEqual([...new Set(values)].sort(), [...wanted].sort());
  for (const [name, count] of Object.entries(PROMISED)) assert.equal(made[name], count, 'Count of ' + name);
  covers(data.claims.map(claim => claim.state), ['open', 'withdrawn', 'closed']);
  covers(data.claims.map(claim => claim.outcome).filter(Boolean), ['paid', 'denied', 'no_response']);
  covers(data.claims.map(claim => claim.path), ['repair', 'total_loss']);
  covers(data.claims.map(claim => claim.coverage), ['collision', 'comprehensive', 'personal_property']);
  covers(data.claims.flatMap(claim => claim.payments.map(payment => payment.kind)), ['repair', 'settlement', 'rental']);
  for (const key of ['account_id', 'owner_person_id', 'insurer', 'preferences', 'policies']) assert.deepEqual(data[key], base[key], 'The fixture keeps ' + key + ' of base.json');
  stamps(data, value => assert.equal(time.iso(Date.parse(value), ZONE), value, 'UTC offset of ' + value));
  stamps({...data, policies: []}, value => assert.ok(Date.parse(value) <= Date.parse(CLOCK), value + ' is after the clock'));
}
const data = replay();
// A seed may hold any part of its history. The fixture keeps the 22 newest notifications and every activity row.
data.notifications = data.notifications.slice(-PROMISED.notifications);
valid(data, CLOCK);
promised(data);
const target = path.join(root, 'fixtures/minimal.json'), text = JSON.stringify(data, null, 2) + '\n', check = process.argv.includes('--check');
if (check && (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text)) {
  console.error('Generated file is out of date: fixtures/minimal.json');
  process.exitCode = 1;
} else {
  if (!check) fs.writeFileSync(target, text);
  console.log((check ? 'Checked' : 'Wrote') + ' fixtures/minimal.json (' + data.claims.length + ' claims, ' + steps.length + ' steps, ' + Buffer.byteLength(text) + ' bytes).');
}
