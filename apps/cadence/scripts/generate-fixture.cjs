'use strict';
// Deterministic fixture generator. Narrative content is authored here; schedules, capacities and the member's
// history are computed. Same seed, same bytes. Also draws the studio images (plain PNG writer, no library).
//   node apps/cadence/scripts/generate-fixture.cjs
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const TZ = 'America/New_York';
const offset = day => (day >= '2025-03-09' && day < '2025-11-01') || (day >= '2026-03-08' && day < '2026-11-01') ? '-04:00' : '-05:00';
const T = (day, hm) => day + 'T' + hm + ':00' + offset(day);
const NOW = '2026-12-06T18:00:00-05:00';
let state = 20261206;
const rand = () => {state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648;};
const pick = list => list[Math.floor(rand() * list.length)];
const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const addMinutes = (iso, n) => {const d = iso.slice(0, 10), h = Number(iso.slice(11, 13)), m = Number(iso.slice(14, 16)) + h * 60 + n; return T(d, String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'));};
const hist = entries => entries.map(([at, action, detail]) => detail === undefined ? {at, action} : {at, action, detail});
const ACCOUNT = 'acct-amara', PERSON = 'person-amara';

const data = {
  account_id:ACCOUNT, owner_person_id:PERSON,
  settings:{require_user_confirmation:false, preview_ttl_minutes:20, timezone:TZ, booking_horizon_days:14, late_cancel_hours:12, late_cancel_fee_cents:1500, checkin_opens_minutes:30},
  plans:[
    {plan_id:'plan-trial', name:'Free Trial Week', kind:'trial', credits_per_period:0, period_days:7, price_cents:0, premium_allowed:false,
      rules:['Your first visit at each studio during the trial is included.', 'Premium classes and sauna sessions are not included.', 'A second visit at the same studio needs a credit plan.', 'The trial ends on its end date; unless you cancel before then it renews into 8 Credits at $59.00.']},
    {plan_id:'plan-8-credits', name:'8 Credits', kind:'credits', credits_per_period:8, period_days:30, price_cents:5900, premium_allowed:true, rules:['8 credits every 30 days; unused credits do not roll over.', 'Premium classes cost more credits.', 'Cancel free up to 12 hours before a class; after that the credits are forfeited.']},
    {plan_id:'plan-20-credits', name:'20 Credits', kind:'credits', credits_per_period:20, period_days:30, price_cents:12900, premium_allowed:true, rules:['20 credits every 30 days; unused credits do not roll over.', 'Premium classes cost more credits.', 'Cancel free up to 12 hours before a class; after that the credits are forfeited.']}
  ],
  payment_methods:[{payment_method_id:'pm-visa-2210', brand:'Visa', last4:'2210', status:'ok'}, {payment_method_id:'pm-amex-0931', brand:'American Express', last4:'0931', status:'declined'}],
  account:null, studios:[], instructors:[], class_instances:[], reservations:[], waitlist:[], previews:[], receipts:[]
};

// ---- studios and instructors (fictional; interaction patterns only) ----------
const STUDIOS = [
  ['studio-ironworks', 'Ironworks Strength', 'Harbor Point', '14 Chandler Wharf', 1.8, 4.7, 212, ['strength', 'hiit'], ['Main floor', 'Rack room'], ['Showers', 'Lockers', 'Chalk'], 'Barbell-first strength coaching in a converted foundry.'],
  ['studio-stillpoint', 'Still Point Yoga', 'Maple Hill', '220 Linden Avenue', 2.4, 4.9, 318, ['yoga', 'meditation'], ['Studio A', 'Studio B'], ['Mats', 'Tea bar', 'Showers'], 'Slow flow, yin and guided meditation in a quiet upstairs loft.'],
  ['studio-granite', 'Granite Barbell', 'Northgate', '9 Quarry Lane', 4.1, 4.6, 97, ['strength', 'hiit'], ['Platform hall'], ['Lockers', 'Chalk', 'Parking'], 'Small-group strength on lifting platforms; coaches cap classes at twelve.'],
  ['studio-pulse', 'Pulse Conditioning', 'Riverside', '77 Mill Street', 3.0, 4.5, 441, ['hiit', 'boxing', 'run_club'], ['Turf', 'Ring'], ['Showers', 'Towels', 'Lockers'], 'Interval conditioning, boxing fundamentals and a Saturday run club.'],
  ['studio-riverside-yoga', 'Riverside Yoga Collective', 'Riverside', '101 Mill Street', 3.1, 4.8, 156, ['yoga', 'pilates'], ['River room'], ['Mats', 'Showers'], 'Vinyasa and mat pilates with the river outside the windows.'],
  ['studio-tidal', 'Tidal Cycling', 'Harbor Point', '31 Pier Road', 1.5, 4.4, 503, ['cycling'], ['Spin deck'], ['Showers', 'Shoe rental', 'Towels'], 'Rhythm rides on the pier; forty bikes.'],
  ['studio-fold', 'The Fold Pilates', 'Old Town', '8 Cooper Square', 2.9, 4.9, 88, ['pilates', 'barre'], ['Reformer room', 'Mat room'], ['Lockers', 'Water'], 'Reformer and mat pilates; reformer sessions are premium.'],
  ['studio-cinder', 'Cinder Sauna & Recovery', 'Old Town', '12 Cooper Square', 3.0, 4.7, 74, ['sauna', 'meditation'], ['Sauna suite', 'Quiet room'], ['Towels', 'Cold plunge', 'Showers'], 'Infrared sauna sessions and breathwork; sessions are premium.'],
  ['studio-northgate-barre', 'Northgate Barre', 'Northgate', '40 Ridge Street', 4.3, 4.3, 129, ['barre', 'pilates'], ['Barre room'], ['Mats', 'Lockers'], 'Low-impact barre with a strength bias.'],
  ['studio-meridian', 'Meridian Boxing Club', 'Maple Hill', '5 Depot Street', 2.7, 4.6, 260, ['boxing', 'hiit'], ['Bag room', 'Ring'], ['Gloves', 'Wraps', 'Showers'], 'Heavy-bag rounds and footwork classes; beginners welcome.'],
  ['studio-lantern', 'Lantern Dance Studio', 'Old Town', '66 Market Street', 3.2, 4.2, 61, ['dance', 'barre'], ['Floor one'], ['Mirrors', 'Water'], 'Open-level contemporary and hip-hop classes.'],
  ['studio-summit', 'Summit Run Club', 'Northgate', '2 Overlook Road', 4.8, 4.5, 145, ['run_club', 'hiit'], ['Trailhead'], ['Bag drop', 'Water'], 'Group runs from the overlook trailhead; hills on Thursdays.'],
  ['studio-anchor', 'Anchor Strength Lab', 'Riverside', '15 Foundry Row', 3.3, 4.8, 190, ['strength', 'hiit'], ['Lab'], ['Showers', 'Chalk'], 'Kettlebell and barbell strength in small groups.'],
  ['studio-haven', 'Haven Yoga', 'Northgate', '19 Ridge Street', 4.4, 4.4, 203, ['yoga', 'meditation'], ['Sun room', 'Moon room'], ['Mats', 'Blankets', 'Tea bar'], 'Hatha, restorative and candlelit evening flows.'],
  ['studio-spoke', 'Spoke & Sprint', 'Maple Hill', '88 Linden Avenue', 2.6, 4.1, 334, ['cycling', 'hiit'], ['Studio'], ['Showers', 'Shoe rental'], 'Power-based cycling with heart-rate zones on screen.'],
  ['studio-crosscut', 'Crosscut Conditioning', 'Harbor Point', '27 Chandler Wharf', 1.9, 4.6, 120, ['hiit', 'strength', 'boxing'], ['Floor', 'Cage'], ['Showers', 'Lockers', 'Towels'], 'Circuit conditioning; Friday classes run long.'],
  ['studio-ember', 'Ember Hot Yoga', 'Old Town', '3 Market Street', 3.4, 4.7, 277, ['yoga'], ['Hot room'], ['Showers', 'Towels', 'Mats'], 'Heated vinyasa at 95 degrees; bring water.'],
  ['studio-willow', 'Willow Pilates & Barre', 'Maple Hill', '12 Depot Street', 2.8, null, 0, ['pilates', 'barre'], ['Studio'], ['Mats'], 'Opened in November 2026; no ratings yet.'],
  ['studio-cadence-house', 'Cadence House', 'Harbor Point', '1 Pier Road', 1.2, 4.0, 52, ['dance', 'meditation', 'yoga'], ['Great room'], ['Water', 'Lockers'], 'Community studio with donation-style evening classes.'],
  ['studio-keel', 'Keel Rowing Fitness', 'Riverside', '3 Boathouse Lane', 3.6, 4.5, 98, ['hiit', 'strength'], ['Boathouse'], ['Showers', 'Lockers'], 'Erg intervals and rowing-based strength.']
];
const FIRST = ['Maya', 'Jonah', 'Priya', 'Tomas', 'Elena', 'Marcus', 'Aisha', 'Noel', 'Hana', 'Devin', 'Lucia', 'Kofi', 'Ingrid', 'Rafael', 'Sana', 'Theo', 'Mei', 'Oscar', 'Nadia', 'Felix'];
const LAST = ['Reyes', 'Okafor', 'Lindqvist', 'Nakamura', 'Haddad', 'Bello', 'Castellanos', 'Whitfield', 'Mendes', 'Singh', 'Park', 'Dubois', 'Farah', 'Ivanova', 'Quinn', 'Sato', 'Brennan', 'Adeyemi', 'Rossi', 'Zhang'];
STUDIOS.forEach(([studio_id, name, neighborhood, address, distance_km, rating, review_count, types, rooms, amenities, description], i) => {
  data.studios.push({studio_id, name, neighborhood, address, distance_km, rating, review_count, amenities, rooms, image_asset_id:['studio-willow', 'studio-cadence-house'].includes(studio_id) ? null : 'img-' + studio_id.slice(7), description});
  for (let k = 0; k < 2; k++) data.instructors.push({instructor_id:'ins-' + studio_id.slice(7) + '-' + (k + 1), name:FIRST[(i * 2 + k) % FIRST.length] + ' ' + LAST[(i * 3 + k * 7) % LAST.length], studio_id, specialties:types.slice(0, 2)});
});
const TITLES = {strength:['Strength 60', 'Barbell Basics', 'Kettlebell Strength'], hiit:['HIIT 45', 'Conditioning Circuit', 'Metcon 30'], yoga:['Vinyasa Flow', 'Slow Flow', 'Restorative Yoga'], pilates:['Mat Pilates', 'Reformer Pilates'], cycling:['Rhythm Ride 45', 'Power Hour'],
  barre:['Barre Sculpt', 'Barre Burn'], boxing:['Boxing Fundamentals', 'Bag Rounds'], dance:['Open Hip-Hop', 'Contemporary Flow'], sauna:['Infrared Sauna Session', 'Sauna & Breathwork'], meditation:['Guided Meditation', 'Breathwork 30'], run_club:['Group Run 5K', 'Hill Repeats']};
const PREMIUM = new Set(['Reformer Pilates', 'Infrared Sauna Session', 'Sauna & Breathwork', 'Power Hour']);
const DURATION = {strength:60, hiit:45, yoga:60, pilates:50, cycling:45, barre:50, boxing:60, dance:60, sauna:40, meditation:30, run_club:60};
const COST = type => ({sauna:6, pilates:4, cycling:3, strength:3, boxing:3, hiit:2, yoga:2, barre:2, dance:2, meditation:1, run_club:1}[type]);
let ciN = 10000;   // generated classes; the named classes below keep fixed ci-77xx IDs
function klass(studio, day, hm, type, title, extra = {}) {
  const start = T(day, hm), end = addMinutes(start, DURATION[type]);
  const premium = PREMIUM.has(title);
  const id = 'ci-' + (ciN++);
  const inst = data.instructors.filter(i => i.studio_id === studio.studio_id);
  const x = {class_instance_id:id, studio_id:studio.studio_id, room:studio.rooms[Math.floor(rand() * studio.rooms.length)], title, type, instructor_id:pick(inst).instructor_id, start, end,
    capacity:type === 'cycling' ? 40 : type === 'sauna' ? 6 : 12 + Math.floor(rand() * 8), external_bookings:0, premium, credit_cost:COST(type) + (premium ? 4 : 0), rating:null, review_count:0, status:'scheduled',
    cancellation_reason:null, time_changed_from:null, created_at:T(addDays(day, -21), '09:00'), updated_at:T(addDays(day, -21), '09:00'), history:hist([[T(addDays(day, -21), '09:00'), 'scheduled']]), ...extra};
  const r1 = rand(), r2 = rand(), r3 = rand(), r4 = rand();
  if (!('rating' in extra)) {if (r1 < 0.85 || studio.rating === null) {x.review_count = 3 + Math.floor(r2 * 60); x.rating = Math.round((3.6 + r3 * 1.4) * 10) / 10;} else {x.review_count = 0; x.rating = null;}}
  if (!('external_bookings' in extra)) x.external_bookings = Math.min(x.capacity, Math.floor(r4 * x.capacity * 0.9));
  data.class_instances.push(x);
  return x;
}
// Two weeks of schedule from Monday, December 7: every studio runs its types at its own template times; rooms never double-book because each studio gets one slot per start time.
const SLOTS = ['06:30', '07:30', '12:15', '16:30', '17:30', '18:30', '19:30'];
const WINDOW_DAYS = []; for (let d = 0; d < 14; d++) WINDOW_DAYS.push(addDays('2026-12-07', d));
for (const [studio_id, , , , , , , types] of STUDIOS) {
  const studio = data.studios.find(s => s.studio_id === studio_id);
  for (const day of WINDOW_DAYS) {
    const dow = new Date(Date.parse(day + 'T12:00:00Z')).getUTCDay();
    const slots = dow === 0 ? [] : dow === 6 ? [pick(['08:00', '09:30', '11:00'])] : SLOTS.filter(() => rand() < 0.15);
    let roomTurn = 0;
    for (const hm of slots) {
      const type = pick(types), title = pick(TITLES[type]);
      const x = klass(studio, day, hm, type, title);
      x.room = studio.rooms[roomTurn++ % studio.rooms.length];
    }
  }
}
// Keep rooms consistent: two classes in one room must not overlap; walk each room and drop overlaps.
for (const s of data.studios) for (const room of s.rooms) {
  const list = data.class_instances.filter(x => x.studio_id === s.studio_id && x.room === room).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  let last = null;
  for (const x of list) {if (last && Date.parse(x.start) < Date.parse(last.end)) x.status = 'drop'; else last = x;}
}
data.class_instances = data.class_instances.filter(x => x.status !== 'drop');

// Named classes the proposal, the schedule and the tests refer to (fixed IDs and times).
const named = (id, studioId, day, hm, type, title, extra) => {const s = data.studios.find(x => x.studio_id === studioId); const x = klass(s, day, hm, type, title, extra); x.class_instance_id = id; x.room = s.rooms[0]; return x;};
const strength60 = named('ci-7731', 'studio-granite', '2026-12-10', '17:30', 'strength', 'Strength 60', {capacity:12, external_bookings:9});
const sunriseYoga = named('ci-7740', 'studio-haven', '2026-12-12', '08:00', 'yoga', 'Vinyasa Flow', {capacity:14, external_bookings:14});          // full: the waitlist class
const reformer = named('ci-7745', 'studio-fold', '2026-12-09', '18:30', 'pilates', 'Reformer Pilates', {capacity:8, external_bookings:3});       // premium: excluded from the trial
const sauna = named('ci-7746', 'studio-cinder', '2026-12-11', '19:30', 'sauna', 'Infrared Sauna Session', {capacity:6, external_bookings:2, rating:4.9, review_count:140});
const wedHiit = named('ci-7750', 'studio-pulse', '2026-12-09', '17:30', 'hiit', 'HIIT 45', {capacity:16, external_bookings:10});
const wedBoxing = named('ci-7751', 'studio-meridian', '2026-12-09', '18:00', 'boxing', 'Boxing Fundamentals', {capacity:12, external_bookings:5}); // overlaps ci-7750
const friRow = named('ci-7752', 'studio-keel', '2026-12-11', '17:30', 'hiit', 'Conditioning Circuit', {capacity:10, external_bookings:4});
const monStrength = named('ci-7720', 'studio-ironworks', '2026-12-07', '18:30', 'strength', 'Strength 60', {capacity:14, external_bookings:11});
const tueYoga = named('ci-7721', 'studio-stillpoint', '2026-12-08', '17:00', 'yoga', 'Slow Flow', {capacity:16, external_bookings:9});
const monRepeat = named('ci-7722', 'studio-ironworks', '2026-12-09', '18:30', 'strength', 'Barbell Basics', {capacity:14, external_bookings:6});   // repeat visit at Ironworks: credits on a trial
data.class_instances = data.class_instances.filter(y => y.class_instance_id === 'ci-7731' || !(y.studio_id === 'studio-granite' && y.start.startsWith('2026-12-10') && y.start.slice(11, 13) >= '16'));
for (const x of [strength60, sunriseYoga, reformer, sauna, wedHiit, wedBoxing, friRow, monStrength, tueYoga, monRepeat]) {
  // The named classes win their room: drop any generated class that overlaps them in the same room.
  data.class_instances = data.class_instances.filter(y => y === x || !(y.studio_id === x.studio_id && y.room === x.room && Date.parse(x.start) < Date.parse(y.end) && Date.parse(y.start) < Date.parse(x.end)));
}

// ---- the member: a returning member on a win-back trial -----------------------
let rsvN = 1000, rcN = 1;
const ATTENDED = [['studio-ironworks', 'strength', 'Strength 60', '18:30'], ['studio-pulse', 'hiit', 'HIIT 45', '17:30'], ['studio-stillpoint', 'yoga', 'Vinyasa Flow', '17:00'], ['studio-tidal', 'cycling', 'Rhythm Ride 45', '06:30'], ['studio-haven', 'yoga', 'Restorative Yoga', '19:30']];
function attended(day, [studioId, type, title, hm]) {
  const s = data.studios.find(x => x.studio_id === studioId), x = klass(s, day, hm, type, title, {capacity:14});
  x.created_at = T(addDays(day, -14), '09:00'); x.updated_at = x.created_at; x.history = hist([[x.created_at, 'scheduled']]);
  const booked = T(addDays(day, -3 - Math.floor(rand() * 4)), '20:' + String(10 + Math.floor(rand() * 40)));
  const endMs = Date.parse(x.end), rated = rand() < 0.4;
  const r = {reservation_id:'rsv-' + (rsvN++), class_instance_id:x.class_instance_id, status:'attended', price:{kind:'credits', credits:x.credit_cost, reason:null}, credits_charged:x.credit_cost, fee_cents:0, time_changed:false,
    booked_at:booked, updated_at:x.end, checked_in_at:addMinutes(x.start, -10), rating:rated ? 4 + (rand() < 0.6 ? 1 : 0) : null, review:null, replaced_by:null, replaces:null, cancellation_reason:null,
    history:hist([[booked, 'booked', x.credit_cost + ' credits charged'], [addMinutes(x.start, -10), 'checked_in'], ...(rated ? [[x.end, 'rated', '']] : [])])};
  if (!rated) r.updated_at = r.checked_in_at; else r.history[r.history.length - 1].detail = r.rating + ' of 5';
  data.reservations.push(r);
}
// Membership on 8 Credits from January 10, 2025 to July 9, 2026: about six visits a month, monthly receipts.
const accountHistory = [[T('2025-01-10', '19:12'), 'joined', '8 Credits']];
let period = '2025-01-10';
while (period < '2026-07-01') {
  const next = addDays(period, 30);
  data.receipts.push({receipt_id:'rcpt-' + String(rcN++).padStart(3, '0'), at:T(period, '00:05'), kind:'renewal', amount_cents:5900, description:'8 Credits, ' + period + ' to ' + addDays(next, -1), payment_method_id:'pm-visa-2210'});
  if (period !== '2025-01-10') accountHistory.push([T(period, '00:05'), 'renewed', '8 Credits for $59.00; 8 credits']);
  const visits = 4 + Math.floor(rand() * 3);
  const days = new Set();
  while (days.size < visits) days.add(addDays(period, 1 + Math.floor(rand() * 27)));
  for (const day of [...days].sort()) attended(day, pick(ATTENDED));
  period = next;
}
accountHistory.push([T('2026-07-05', '08:40'), 'cancellation_scheduled', 'Moving over the summer; the plan ends at the period end'], [T('2026-07-09', '00:05'), 'cancelled', 'The plan ended at the period end and did not renew'], [T('2026-12-06', '09:00'), 'trial_started', 'Free Trial Week until 2026-12-13; renews into 8 Credits']);
data.receipts.push({receipt_id:'rcpt-' + String(rcN++).padStart(3, '0'), at:T('2026-12-06', '09:00'), kind:'trial_start', amount_cents:0, description:'Free Trial Week, 2026-12-06 to 2026-12-12', payment_method_id:'pm-visa-2210'});
data.account = {member:{name:'Amara Bello', email:'amara.bello@example.com', home_neighborhood:'Maple Hill'}, plan_id:'plan-trial', status:'trial', credits_remaining:0, period_start:'2026-12-06', renewal_date:'2026-12-13', trial_end:'2026-12-13',
  pending_change:null, payment_method_id:'pm-visa-2210', trial_reminder_sent_at:null, signed_out:false, updated_at:T('2026-12-06', '09:00'), history:hist(accountHistory)};
// This week's trial bookings: Monday strength at Ironworks, Tuesday yoga at Still Point, Thursday Strength 60 at Granite Barbell (the proposal's cancellation example).
const included = {kind:'included', credits:0, reason:null};
const book = (id, x, at) => data.reservations.push({reservation_id:id, class_instance_id:x.class_instance_id, status:'booked', price:included, credits_charged:0, fee_cents:0, time_changed:false, booked_at:at, updated_at:at, checked_in_at:null, rating:null, review:null, replaced_by:null, replaces:null, cancellation_reason:null, history:hist([[at, 'booked', 'Included in your plan']])});
book('rsv-2001', monStrength, T('2026-12-06', '09:20')); book('rsv-2002', tueYoga, T('2026-12-06', '09:24')); book('rsv-2041', strength60, T('2026-12-06', '09:31'));
data.waitlist.push({waitlist_entry_id:'wl-311', class_instance_id:sunriseYoga.class_instance_id, status:'waiting', offer:null, reservation_id:null, created_at:T('2026-12-06', '09:40'), updated_at:T('2026-12-06', '09:40'), history:hist([[T('2026-12-06', '09:40'), 'joined']])});
for (const x of data.class_instances) x.external_bookings = Math.min(x.external_bookings, x.capacity - data.reservations.filter(r => r.class_instance_id === x.class_instance_id && ['booked', 'attended', 'no_show'].includes(r.status)).length);

// ---- studio images: a plain PNG writer (RGB, no filter) drawing a geometric mark per studio ----
const crcTable = Array.from({length:256}, (_, n) => {let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;});
const crc32 = buf => {let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0;};
function chunk(type, body) {const len = Buffer.alloc(4); len.writeUInt32BE(body.length); const td = Buffer.concat([Buffer.from(type, 'latin1'), body]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]);}
function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {raw[y * (width * 3 + 1)] = 0; for (let x = 0; x < width; x++) {const [r, g, b] = pixel(x, y); const o = y * (width * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;}}
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, {level:9})), chunk('IEND', Buffer.alloc(0))]);
}
const PALETTES = [[[31, 111, 139], [233, 243, 247]], [[120, 72, 150], [243, 239, 248]], [[51, 124, 99], [237, 246, 241]], [[176, 92, 60], [250, 240, 235]], [[60, 117, 176], [237, 245, 252]], [[146, 110, 40], [250, 246, 232]]];
fs.mkdirSync(path.join(root, 'assets'), {recursive:true});
for (const f of fs.readdirSync(path.join(root, 'assets'))) if (f.endsWith('.png')) fs.unlinkSync(path.join(root, 'assets', f));
const catalog = {schema_version:'pale.asset-catalog.v1', catalog_id:'cadence-assets', app_id:'cadence', dataset_ref:'dataset.json', assets:[], extensions:[]};
data.studios.forEach((s, i) => {
  if (s.image_asset_id === null) return;
  const [fg, bg] = PALETTES[i % PALETTES.length], W = 160, H = 100, cx = 40 + (i * 23) % 80, cy = 50, r = 22 + (i % 3) * 6;
  const bytes = png(W, H, (x, y) => {const inCircle = (x - cx) ** 2 + (y - cy) ** 2 <= r * r, band = Math.floor((x + y + i * 7) / 20) % 2 === 0 && y > 70; return inCircle || band ? fg : bg;});
  const file = 'assets/' + s.studio_id.slice(7) + '.png';
  fs.writeFileSync(path.join(root, file), bytes);
  catalog.assets.push({schema_version:'pale.asset-descriptor.v1', asset_id:s.image_asset_id, scope:{level:'package', app_id:'cadence'}, roles:['content.inline'], subjects:[{app_id:'cadence', account_id:ACCOUNT, object_type:'studio', object_id:s.studio_id}],
    mime_type:'image/png', availability:{status:'ready'}, storage:{adapter:'storage.file', path:file, packaging:'bundled'}, provenance:{dataset_id:'cadence-amara', source_ids:['generated']}, publication:'public',
    access:{audience:['agent'], rule:'parent_object'}, presentation:{alt_text:s.name + ' studio mark'}, media:{image:{width:W, height:H}}, extensions:[], integrity:{bytes:bytes.length, sha256:crypto.createHash('sha256').update(bytes).digest('hex')}});
});

// ---- write -------------------------------------------------------------------
data.class_instances.sort((a, b) => a.start.localeCompare(b.start) || a.class_instance_id.localeCompare(b.class_instance_id));
data.reservations.sort((a, b) => a.booked_at.localeCompare(b.booked_at));
fs.writeFileSync(path.join(root, 'fixtures/minimal.json'), JSON.stringify(data, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'fixtures/clock.json'), JSON.stringify({initial_time:NOW}, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'fixtures/binding.json'), JSON.stringify({people:[{person_id:PERSON, name:'Amara Bello'}], accounts:[{app_id:'cadence', account_id:ACCOUNT, owner_person_id:PERSON}], objects:{cadence:require('../src/model.cjs').objects(data)}}, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'contribution/assets.catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
const datasetFile = path.join(root, 'contribution/dataset.json');
if (fs.existsSync(datasetFile)) {const d = JSON.parse(fs.readFileSync(datasetFile, 'utf8')); d.expected_counts = {records:require('../src/model.cjs').records(data).length, assets:catalog.assets.length}; fs.writeFileSync(datasetFile, JSON.stringify(d, null, 2) + '\n');}
const counts = {studios:data.studios.length, instructors:data.instructors.length, class_instances:data.class_instances.length, upcoming:data.class_instances.filter(x => x.start > NOW).length, reservations:data.reservations.length, receipts:data.receipts.length, assets:catalog.assets.length, bundle_bytes:catalog.assets.reduce((s, a) => s + a.integrity.bytes, 0), records:require('../src/model.cjs').records(data).length};
console.log('Wrote fixtures/minimal.json: ' + JSON.stringify(counts));
