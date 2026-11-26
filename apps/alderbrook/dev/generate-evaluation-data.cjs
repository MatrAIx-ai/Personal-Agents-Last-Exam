'use strict';
// Writes the synthetic evaluation dataset in data/evaluation/: one seed and one binding per policyholder account, and manifest.json.
// Every claim is a scripted story of policyholder writes and insurer events. The story is replayed through the App's own hooks, so the App accepted every step.
// Usage: node dev/generate-evaluation-data.cjs [--check]. With --check it writes nothing and fails when a committed file differs. Never used at run time.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const plugin = require('../plugin.cjs');
const time = require('../src/time.cjs');
const views = require('../src/views.cjs');
const {compile} = require('../tests/schema-validator.cjs');
const S = require('./evaluation-scenarios.cjs');

const ROOT = path.resolve(__dirname, '..'), OUT = path.join(ROOT, 'data/evaluation'), APP = 'alderbrook';
const VERSION = '1.0.0', SEED = 20251231, ACCOUNTS = 36, ZONE = 'America/New_York';
// Every seed is read at the end of the coverage window, so the whole window is history. A task can cut an earlier seed with dev/select-evaluation-seed.cjs.
const CLOCK = '2027-01-01T00:00:00-05:00';
const FIRST_FILING = '2024-11-04', LAST_FILING = '2026-12-28';
const RULES = {notice_days: 30, request_response_days: 10, dispute_window_days: 30, offer_response_days: 7, rental_grace_days: 5};
const DAY = time.DAY_MS, HOUR = 3600000, MINUTE = 60000;

// A small PRNG (mulberry32), so a rerun gives the same files on every Node version.
function prng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: list => list[Math.floor(next() * list.length)],
    chance: p => next() < p,
    amount: (lo, hi) => Math.round((lo + next() * (hi - lo)) * 100) / 100,
    weighted(pairs) {
      let roll = next() * pairs.reduce((sum, [, w]) => sum + w, 0);
      for (const [value, w] of pairs) { roll -= w; if (roll < 0) return value; }
      return pairs[pairs.length - 1][0];
    },
    some(list, lo, hi) {
      const pool = [...list], out = [];
      for (let n = r.int(lo, Math.min(hi, pool.length)); n > 0; n--) out.push(pool.splice(Math.floor(next() * pool.length), 1)[0]);
      return out;
    }
  };
  return r;
}
const cents = value => Math.round(value * 100), money = value => Math.round(value) / 100;
const fmt = value => value.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});

// Days are numbers of calendar days since 1970-01-01 in the insurer's zone.
const dayOf = instant => time.dayNumber(time.localDay(instant, ZONE));
const dayText = day => time.dayString(day);
const weekday = day => new Date(day * DAY).getUTCDay();
const HOLIDAYS = new Set(['2024-11-11', '2024-11-28', '2024-11-29', '2024-12-25', '2025-01-01', '2025-01-20', '2025-02-17', '2025-05-26', '2025-06-19', '2025-07-04',
  '2025-09-01', '2025-11-11', '2025-11-27', '2025-11-28', '2025-12-25', '2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19', '2026-07-03',
  '2026-09-07', '2026-11-11', '2026-11-26', '2026-11-27', '2026-12-25', '2027-01-01']);
const officeDay = day => weekday(day) !== 0 && weekday(day) !== 6 && !HOLIDAYS.has(dayText(day));
// A local wall time as an instant. Hours 1 to 3 are never used, so a clock change never hides a time.
function wall(day, hour, minute) {
  const [y, m, d] = dayText(day).split('-').map(Number);
  for (const offset of [4, 5]) {
    const instant = Date.UTC(y, m - 1, d, hour, minute) + offset * HOUR;
    if (time.iso(instant, ZONE).slice(11, 16) === String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0')) return instant;
  }
  throw new Error('No local time ' + dayText(day) + ' ' + hour + ':' + minute);
}
const hourOf = instant => Number(time.iso(instant, ZONE).slice(11, 13));
const iso = instant => time.iso(instant, ZONE);

// The insurer, the shops and the lenders work on office days. A step `n` office days later falls between 9:00 and 16:59.
function office(rng, from, lo, hi) {
  let day = dayOf(from), left = rng.int(lo, hi);
  if (left === 0 && officeDay(day) && hourOf(from) < 15) {
    const start = Math.max(from + rng.int(20, 150) * MINUTE, wall(day, 9, rng.int(0, 59)));
    if (hourOf(start) < 17) return start;
  }
  if (left === 0) left = 1;
  while (left > 0) { day++; if (officeDay(day)) left--; }
  return wall(day, rng.int(9, 16), rng.int(0, 59));
}
// The policyholder acts at any day, between 7:00 and 22:59.
function person(rng, from, loHours, hiHours) {
  const at = from + (rng.int(Math.round(loHours * 60), Math.round(hiHours * 60)) + rng.int(1, 9)) * MINUTE;
  const hour = hourOf(at);
  if (hour >= 7 && hour < 23) return at;
  const day = dayOf(at) + (hour >= 23 ? 1 : 0);
  return Math.max(at, wall(day, rng.int(7, 9), rng.int(0, 59)));
}
// The same instant if it is between 7:00 and 20:59, else an earlier evening time between 17:00 and 20:59.
function awake(rng, at) {
  const hour = hourOf(at);
  if (hour >= 7 && hour < 21) return at;
  return Math.min(at - MINUTE, wall(dayOf(at) - (hour < 7 ? 1 : 0), rng.int(17, 20), rng.int(0, 59)));
}
const soon = (rng, from) => from + rng.int(2, 12) * MINUTE;

// People, places and parties. All of them are fictional.
const FIRST = ['Avery', 'Jordan', 'Maya', 'Daniel', 'Priya', 'Marcus', 'Elena', 'Tomas', 'Grace', 'Omar', 'Hannah', 'Luis', 'Nadia', 'Caleb', 'Sofia', 'Andre',
  'Leah', 'Victor', 'Imani', 'Peter', 'Rosa', 'Kevin', 'Aisha', 'Ben', 'Mei', 'Ruth', 'Samuel', 'Tara', 'Owen', 'Fatima', 'Noah', 'Clara', 'Diego', 'Erin',
  'Hassan', 'Julia', 'Malik', 'Nora', 'Ravi', 'Sara', 'Theo', 'Vera', 'Wes', 'Yara', 'Zoe', 'Adam', 'Bianca', 'Colin', 'Dmitri', 'Esther', 'Farid', 'Gemma', 'Hugo', 'Ines',
  'Jonah', 'Keiko', 'Lena', 'Mateo', 'Nell', 'Oscar', 'Paloma', 'Quentin', 'Rhea', 'Silas', 'Tess', 'Uma', 'Vikram', 'Willa'];
const LAST = ['Okonkwo', 'Bergstrom', 'Delgado', 'Fairbanks', 'Gallagher', 'Hollis', 'Iverson', 'Jablonski', 'Kowalczyk', 'Lindgren', 'Moreau', 'Nakashima',
  'Ostrowski', 'Pellegrino', 'Quintero', 'Rasmussen', 'Sandoval', 'Thibodeau', 'Underhill', 'Vasquez', 'Whitfield', 'Yamamoto', 'Zielinski', 'Abernathy',
  'Brightwater', 'Castellano', 'Donnelly', 'Esposito', 'Fitzgerald', 'Galloway', 'Haddad', 'Ingram', 'Kerrigan', 'Lombardi', 'Mbeki', 'Novak', 'Oyelaran', 'Prescott'];
// Other drivers. These names share no first or last name with the policyholders above.
const OTHER_FIRST = ['Dale', 'Marta', 'Gordon', 'Irene', 'Felix', 'Lorraine', 'Hector', 'Wanda', 'Russell', 'Dolores', 'Glen', 'Bernice', 'Curtis', 'Agnes', 'Lionel', 'Paula',
  'Warren', 'Stella', 'Roland', 'Joyce', 'Floyd', 'Miriam', 'Edgar', 'Rhonda', 'Vernon', 'Celia'];
const OTHER_LAST = ['Whitcomb', 'Pruitt', 'Mendez', 'Albright', 'Kessler', 'Dunmore', 'Rourke', 'Sorensen', 'Tolliver', 'Vance', 'Hartley', 'Quinlan', 'Barlow', 'Espinoza', 'Coyle',
  'Fenwick', 'Gatling', 'Holbrook', 'Ivanova', 'Jessup', 'Kincaid', 'Larkin', 'Mabry', 'Northcutt', 'Oakes', 'Pennington', 'Radford', 'Stroud', 'Thorne', 'Upton'];
const CITIES = [
  {city: 'Rochester', zip: '146', streets: ['Monroe Avenue', 'Park Avenue', 'East Avenue', 'Lyell Avenue', 'Dewey Avenue', 'University Avenue'],
    shops: ['Lakeshore Collision Center', 'Corner Auto Body', 'Genesee Street Auto Body', 'Highland Paint and Body']},
  {city: 'Buffalo', zip: '142', streets: ['Elmwood Avenue', 'Hertel Avenue', 'Delaware Avenue', 'Niagara Street', 'Bailey Avenue'],
    shops: ['Niagara Frontier Collision', 'Hertel Auto Body', 'Queen City Paint and Dent']},
  {city: 'Syracuse', zip: '132', streets: ['James Street', 'Westcott Street', 'Erie Boulevard', 'Salina Street', 'Genesee Street'],
    shops: ['Onondaga Collision Works', 'Westcott Auto Body', 'Salt City Body Shop']},
  {city: 'Albany', zip: '122', streets: ['Lark Street', 'Madison Avenue', 'Central Avenue', 'Western Avenue', 'Delaware Avenue'],
    shops: ['Capital District Collision', 'Lark Street Auto Body', 'Hudson Valley Paint and Body']},
  {city: 'Ithaca', zip: '148', streets: ['State Street', 'Aurora Street', 'Cayuga Street', 'Meadow Street'], shops: ['Cayuga Collision', 'Six Mile Creek Auto Body']}
];
const GLASS = ['ClearView Auto Glass', 'Empire Mobile Glass', 'Finger Lakes Glass Service'];
const RESTORERS = ['Flower City Restoration', 'Dry Out Restoration Services', 'Northstar Cleaning and Restoration'];
const LENDERS = ['Harbor Credit Union', 'Genesee Valley Auto Finance', 'Lakeview Federal Credit Union', 'Finger Lakes Community Bank', 'Empire Auto Credit'];
// Staff surnames are not used by any policyholder or other driver.
const ADJUSTERS = ['Adjuster R. Achterberg', 'Adjuster T. Okafor', 'Adjuster M. Castillo', 'Adjuster D. Brennan', 'Adjuster S. Vu', 'Adjuster K. Adeyemi', 'Adjuster J. Lindqvist'];
const SUPERVISORS = ['Claims supervisor L. Brandt', 'Claims supervisor P. Ferrante', 'Claims supervisor A. Nakamura'];
const CARS = [['Honda', 'CR-V', 33000], ['Honda', 'Civic', 26000], ['Honda', 'Accord', 30000], ['Toyota', 'Camry', 30000], ['Toyota', 'Corolla', 24000],
  ['Toyota', 'RAV4', 33000], ['Toyota', 'Highlander', 42000], ['Subaru', 'Outback', 34000], ['Subaru', 'Forester', 32000], ['Subaru', 'Crosstrek', 28000],
  ['Ford', 'Escape', 30000], ['Ford', 'F-150', 45000], ['Chevrolet', 'Equinox', 30000], ['Chevrolet', 'Malibu', 26000], ['Hyundai', 'Elantra', 23000],
  ['Hyundai', 'Tucson', 30000], ['Kia', 'Sorento', 34000], ['Nissan', 'Rogue', 30000], ['Mazda', 'CX-5', 31000], ['Jeep', 'Grand Cherokee', 42000],
  ['Volkswagen', 'Jetta', 24000], ['Volkswagen', 'Tiguan', 31000]];

function household(rng, index, used) {
  let last;
  do last = rng.pick(LAST); while (used.has(last));
  used.add(last);
  const names = rng.some(FIRST, 3, 3), slug = text => text.toLowerCase().replace(/[^a-z]+/g, '-');
  const owner = {person_id: 'person-' + slug(names[0]) + '-' + slug(last), name: names[0] + ' ' + last};
  const partner = rng.chance(0.55) ? {person_id: 'person-' + slug(names[1]) + '-' + slug(last), name: names[1] + ' ' + last} : null;
  const teen = rng.chance(0.25) ? {person_id: 'person-' + slug(names[2]) + '-' + slug(last), name: names[2] + ' ' + last} : null;
  const place = rng.pick(CITIES);
  return {index, last, owner, partner, teen, place, account_id: 'alderbrook-' + slug(last), hasAuto: rng.chance(0.85), hasRenters: rng.chance(0.55),
    address: rng.int(12, 980) + ' ' + rng.pick(place.streets) + ', Apt ' + rng.int(1, 6) + rng.pick(['A', 'B', 'C', 'D']) + ', ' + place.city + ', NY ' + place.zip + String(rng.int(1, 99)).padStart(2, '0')};
}

// The policy terms that cover the history: one-year terms from late 2023 to past the clock. Each term is its own policy record with its own item IDs.
function terms(rng) {
  const month = rng.int(1, 12), day = rng.int(1, 28), out = [];
  for (let year = 2023; year <= 2026; year++) {
    const start = wall(time.dayNumber(year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0')), 0, 0);
    const end = wall(time.dayNumber((year + 1) + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0')), 0, 0);
    if (end > Date.parse('2024-10-01T00:00:00-04:00') && start < Date.parse(CLOCK)) out.push({start, end, tag: String(year).slice(2) + String(month).padStart(2, '0')});
  }
  return out;
}
function car(rng, newest) {
  const [make, model, base] = rng.pick(CARS), year = rng.int(newest - 11, newest);
  return {year, make, model, base, lender: year >= newest - 4 && rng.chance(0.6) ? rng.pick(LENDERS) : null};
}
// The value of a car on a day, from its new price and its age.
const value = (rng, vehicle, day) => Math.round(vehicle.base * Math.pow(0.87, Math.max(0, Number(dayText(day).slice(0, 4)) - vehicle.year)) * (0.93 + rng.next() * 0.14));

function plan(index) {
  const rng = prng(SEED + index * 7919), used = new Set();
  // The household names come from one stream, so every account has its own last name.
  const names = prng(SEED);
  let h = null;
  for (let i = 0; i <= index; i++) h = household(names, i, used);
  if (!h.hasAuto && !h.hasRenters) h.hasAuto = true;
  const people = [h.owner, h.partner, h.teen].filter(Boolean);
  const account = {...h, rng, people, policies: [], stories: [], emails: rng.chance(0.6)};
  if (h.hasAuto) {
    const slots = Array.from({length: rng.weighted([[1, 4], [2, 5], [3, 1]])}, () => ({cars: [{...car(rng, 2023), from: -Infinity, totaled: Infinity}]}));
    account.auto = {number: 'AB-AUTO-' + rng.int(200000, 299999), terms: terms(rng), slots, collision: rng.pick([500, 500, 1000]), comprehensive: rng.pick([250, 250, 500]),
      rental: rng.chance(0.65) ? {daily_cap: rng.pick([30, 40, 40, 50]), max_days: 30} : null};
  }
  if (h.hasRenters) account.renters = {number: 'AB-RENT-' + rng.int(100000, 199999), terms: terms(rng), deductible: rng.pick([250, 500, 500, 1000]), limit: rng.pick([15000, 20000, 25000, 40000])};
  const count = rng.weighted([[1, 30], [2, 40], [3, 22], [4, 8]]), filings = [];
  for (let n = 0; n < count; n++) {
    const kind = pickKind(rng, account);
    let day = null;
    for (let tries = 0; tries < 50 && day === null; tries++) {
      const candidate = seasonalDay(rng, kind);
      if (filings.every(other => Math.abs(other - candidate) >= 45)) day = candidate;
    }
    if (day !== null) { filings.push(day); account.stories.push({kind, day}); }
  }
  // Every account has at least one claim filed inside the window, not only a claim of late 2024.
  const windowStart = time.dayNumber('2025-01-01');
  while (filings.every(day => day < windowStart)) {
    const kind = pickKind(rng, account), day = seasonalDay(rng, kind);
    if (day >= windowStart && filings.every(other => Math.abs(other - day) >= 45)) { filings.push(day); account.stories.push({kind, day}); }
  }
  account.stories.sort((a, b) => a.day - b.day);
  account.stories.forEach((story, n) => { story.tag = 'c' + (n + 1); });
  for (const story of account.stories) story.steps = STORIES[S.SCENARIOS[story.kind].story](account, story, S.SCENARIOS[story.kind]);
  account.policies = policies(account);
  return account;
}
// A scenario that the account's policies allow, by the base weight of each scenario.
function pickKind(rng, account) {
  return rng.weighted(Object.entries(S.SCENARIOS).filter(([, sc]) => account[sc.policy === 'auto' ? 'auto' : 'renters']).map(([id, sc]) => [id, sc.weight]));
}
// A filing day in the window, weighted by the scenario's months.
function seasonalDay(rng, kind) {
  const weights = S.SCENARIOS[kind].months, first = time.dayNumber(FIRST_FILING), last = time.dayNumber(LAST_FILING);
  for (;;) {
    const day = rng.int(first, last), month = Number(dayText(day).slice(5, 7));
    if (rng.next() * 22 < weights[month - 1]) return day;
  }
}
function termOf(list, instant) { return list.find(term => instant >= term.start && instant < term.end); }
// A vehicle slot whose car of that term is not totaled at the loss time. A total loss replaces the car from the next term on.
const carAt = (slot, at) => slot.cars.filter(c => c.from <= at).pop();
const carOfTerm = (account, slot, at) => carAt(slot, termOf(account.auto.terms, at).start);
function slotFor(rng, account, at) {
  const free = account.auto.slots.map((slot, i) => [slot, i]).filter(([slot]) => carOfTerm(account, slot, at).totaled > at);
  return free.length ? rng.pick(free) : null;
}
function vehicleId(account, slotIndex, at) {
  const term = termOf(account.auto.terms, at), slot = account.auto.slots[slotIndex], n = slot.cars.indexOf(carAt(slot, term.start));
  return 'veh-' + (slotIndex + 1) + (n ? 'r' + n : '') + '-' + term.tag;
}
function policies(account) {
  const out = [], named = {person_id: account.owner.person_id, name: account.owner.name};
  const person = (p, role) => ({person_id: p.person_id, name: p.name, role});
  if (account.auto) {
    for (const term of account.auto.terms) {
      out.push({id: 'pol-auto-' + term.tag, kind: 'auto', number: account.auto.number, term: {start: iso(term.start), end: iso(term.end)}, named_insured: named,
        listed_people: [person(account.owner, 'named_insured'), ...[account.partner, account.teen].filter(Boolean).map(p => person(p, 'driver'))],
        vehicles: account.auto.slots.map((slot, i) => {
          const c = carAt(slot, term.start);
          return {id: vehicleId(account, i, term.start), year: c.year, make: c.make, model: c.model, lienholder: c.lender ? {name: c.lender} : null};
        }),
        insured_address: null,
        coverages: [{type: 'collision', deductible: account.auto.collision, limit: null}, {type: 'comprehensive', deductible: account.auto.comprehensive, limit: null}],
        rental_benefit: account.auto.rental ? {...account.auto.rental} : null});
    }
  }
  if (account.renters) {
    for (const term of account.renters.terms) {
      out.push({id: 'pol-rent-' + term.tag, kind: 'renters', number: account.renters.number, term: {start: iso(term.start), end: iso(term.end)}, named_insured: named,
        listed_people: [person(account.owner, 'named_insured'), ...(account.partner ? [person(account.partner, 'household_member')] : [])],
        vehicles: [], insured_address: {id: 'addr-' + term.tag, line: account.address},
        coverages: [{type: 'personal_property', deductible: account.renters.deductible, limit: account.renters.limit}], rental_benefit: null});
    }
  }
  return out;
}

// One claim story. Its cursor `t` only moves forward. Arguments may be functions of the replay state `r`, for IDs that the App or a past step made.
function builder(account, story) {
  const rng = account.rng, tag = story.tag, steps = [];
  const b = {
    rng, tag, steps, t: 0, evidenceCount: 0,
    call(name, args, label) { steps.push({at: b.t, actor: 'agent', name, args, label, claim: tag}); },
    event(name, args, label) { steps.push({at: b.t, actor: 'event', name, args, label, claim: tag}); },
    office(lo, hi) { b.t = office(rng, b.t, lo, hi); return b; },
    person(lo, hi) { b.t = person(rng, b.t, lo, hi); return b; },
    soon() { b.t = soon(rng, b.t); return b; },
    evidence(items) {
      const tags = items.map(() => tag + '.e' + (++b.evidenceCount));
      // An item is never dated after the moment it is added. Only a record of the scene within 2 hours of the loss may be dated at night.
      const added = b.t, loss = Date.parse(steps[0].args.loss_at);
      const when = dated => {
        const at = Math.min(dated, added - MINUTE);
        if (at - loss <= 2 * HOUR && at >= loss) return at;
        const evening = awake(rng, at);
        if (evening >= loss || at < loss) return evening;
        // An evening before the loss does not fit, so the item is dated the next morning, or kept at night when it was added before then.
        const morning = wall(dayOf(at) + (hourOf(at) >= 21 ? 1 : 0), 7, rng.int(0, 50));
        return morning < added ? morning : at;
      };
      b.call('claims.add_evidence', {id: r => r.id(tag), items: items.map(([kind, dated, description, reference]) => ({kind, dated: iso(when(dated)), description,
        ...(reference ? {reference} : {})}))}, tags);
      return tags;
    },
    request(by, asks, due) {
      const label = tag + '.r' + steps.filter(s => s.name === 'request.issued').length;
      b.event('request.issued', {claim_id: r => r.id(tag), asks: Object.entries(asks).map(([key, text]) => ({key, text})), ...(due ? {due_at: iso(due)} : {}), issued_by: by}, label);
      return label;
    },
    respond(label, answers) {
      b.call('requests.respond', {id: r => r.id(label), answers: Object.entries(answers).map(([key, [text, evidence = []]]) => ({key, text, ...(evidence.length ? {evidence_ids: r => r.ids(evidence)} : {})}))});
    },
    // An estimate from a shop or an adjuster. Its lines get `ln-NN` IDs in replay.
    estimate(kind, source, shop, lines) {
      const index = b.estimates++;
      b.event('estimate.submitted', {claim_id: r => r.id(tag), kind, source, ...(shop ? {shop_name: shop} : {}), lines: lines.map(([text, amount]) => ({text, amount}))});
      return index;
    },
    submit(kind, shop, lines) {
      const index = b.estimates++;
      b.call('estimates.submit', {id: r => r.id(tag), kind, shop_name: shop, lines: lines.map(([text, amount]) => ({text, amount}))});
      return index;
    },
    // decisions: [estimate index, line index, 'approved' | 'denied', amount or reason, reason]
    decide(by, note, decisions) {
      b.event('determination.issued', {claim_id: r => r.id(tag), issued_by: by, note,
        lines: decisions.map(([k, j, status, x, reason]) => status === 'approved'
          ? {line_id: r => r.line(tag, k, j), status, amount: x, ...(reason ? {reason} : {})}
          : {line_id: r => r.line(tag, k, j), status, reason: x})});
    },
    dispute(k, j, reason, evidence) {
      const label = tag + '.d' + steps.filter(s => s.name === 'determinations.dispute').length;
      b.call('determinations.dispute', {id: r => r.line(tag, k, j), claim_id: r => r.id(tag), reason, ...(evidence.length ? {evidence_ids: r => r.ids(evidence)} : {})}, label);
      return label;
    },
    decided(label, decision, by, note, line) {
      b.event('dispute.decided', {dispute_id: r => r.id(label), decision, ...(line ? {line} : {}), decided_by: by, note});
    },
    pay(kind, amount, reference, payee) {
      b.event('payment.issued', {claim_id: r => r.id(tag), kind, amount, ...(payee ? {payee} : {}), reference});
    },
    offer(valuation, payoff, basis, by, due) {
      const label = tag + '.o' + steps.filter(s => s.name === 'offer.issued').length;
      b.event('offer.issued', {claim_id: r => r.id(tag), valuation, ...(payoff !== null ? {lienholder_payoff: payoff} : {}), ...(due ? {respond_by: iso(due)} : {}), issued_by: by, basis}, label);
      return label;
    },
    close(outcome, note) { b.event('claim.closed', {claim_id: r => r.id(tag), outcome, note}); },
    estimates: 0
  };
  return b;
}
const eft = rng => rng.chance(0.85) ? 'EFT ' + rng.int(60000, 99999) : 'Check ' + rng.int(200000, 299999);
// Still due and rental amounts are read from the replay state, so a payment always fits the money summary.
const stillDue = r => r.summary().still_due;
const policyAt = (list, prefix, at) => prefix + termOf(list, at).tag;
const listed = p => ({kind: 'listed', person_id: p.person_id});
const firstName = p => p.name.split(' ')[0];
const sideOf = text => text.replace(/\{side\}/g, '');
// What the shop billed at the end: its price for every line whose standing decision is approved. It is never below the approved total.
const invoice = (r, tag) => money(r.claimOf(tag).estimates.flatMap(e => e.lines).filter(l => l.decisions.length && l.decisions[l.decisions.length - 1].status === 'approved')
  .reduce((sum, l) => sum + cents(l.amount), 0));

// The loss time and the time the policyholder learns of it, by the scenario's rule. The loss day is up to `maxDays` before the filing day.
function lossFor(rng, sc, story, maxDays = 3) {
  for (let back = rng.int(0, maxDays); ; back++) {
    const day = story.day - back, wd = weekday(day), month = Number(dayText(day).slice(5, 7));
    const pick = (h1, h2) => wall(day, rng.int(h1, h2), rng.int(0, 59));
    switch (sc.loss) {
      case 'day': return {loss: pick(8, 19), found: null};
      case 'commute': return {loss: pick(7, 18), found: null};
      case 'afternoon': return {loss: pick(13, 18), found: null};
      case 'storm': return {loss: pick(13, 21), found: null};
      case 'evening': return {loss: pick(17, 20), found: null};
      case 'dusk': {
        const [h, m] = S.SUNSET[month - 1], at = wall(day, h, m) + rng.int(-10, 40) * MINUTE;
        return {loss: at, found: null};
      }
      case 'overnight': {
        const late = rng.chance(0.5), loss = late ? wall(day - 1, 23, rng.int(0, 59)) : wall(day, rng.int(4, 5), rng.int(0, 59));
        return {loss, found: wall(day, rng.int(6, 7), rng.int(45, 59))};
      }
      case 'workday':
        if (wd >= 1 && wd <= 5 && officeDay(day)) return {loss: wall(day, rng.int(9, 15), rng.int(0, 59)), found: wall(day, rng.int(17, 19), rng.int(0, 59))};
        break;
      case 'weekend':
        if (wd === 0) return {loss: wall(day - 1, rng.int(11, 20), rng.int(0, 59)), found: wall(day, rng.int(17, 20), rng.int(0, 59))};
        break;
      default: throw new Error('Unknown loss rule ' + sc.loss);
    }
  }
}
function fileAfter(rng, known, story) {
  const target = wall(story.day, rng.int(7, 21), rng.int(0, 59));
  return target > known ? target : person(rng, known, 1, 6);
}
function words(rng, account, sc, extra = {}) {
  const drivers = account.people, driver = sc.driver ? rng.pick(drivers) : null;
  return {driver, w: {who: driver ? firstName(driver) : '', street: rng.pick(account.place.streets), city: account.place.city, side: rng.pick(['left', 'right']),
    highway: rng.pick(S.HIGHWAYS), ...extra}};
}
const policeNumber = (rng, account, day) => account.place.city.slice(0, 3).toUpperCase() + 'PD-' + dayText(day).slice(2, 4) + '-' + rng.int(10000, 99999);
const carName = vehicle => vehicle.year + ' ' + vehicle.make + ' ' + vehicle.model;
// Lines of one claim from the scenario: the required lines and some of the others, with one side for the whole claim.
// Lines keep the scenario's order, and paint materials come only with a paint line.
function linesOf(rng, sc, side, lo, hi) {
  const pool = [...(sc.required || []), ...(sc.area || [])], picked = [...(sc.required || []), ...rng.some(sc.area || [], lo, hi)];
  const kept = picked.filter(t => t.rule !== 'materials' || picked.some(p => p.rule === 'paint')).sort((a, b) => pool.indexOf(a) - pool.indexOf(b));
  return kept.map(t => ({t, text: t.text.replace('{side}', side), amount: rng.amount(t.lo, t.hi)}));
}

// A repair on the auto policy. Every line, cut, denial and dispute comes from the scenario.
function vehicleRepair(account, story, sc) {
  const b = builder(account, story), rng = b.rng, shop = rng.pick(account.place.shops), adjuster = rng.pick(ADJUSTERS);
  const {loss, found} = lossFor(rng, sc, story), known = found || loss, slot = slotFor(rng, account, loss);
  if (!slot) return [];
  const vehicle = carOfTerm(account, slot[0], loss), {driver, w} = words(rng, account, sc), description = rng.pick(sc.texts)(w);
  const police = rng.chance(sc.police) ? policeNumber(rng, account, story.day) : null, knownDriver = sc.driver && rng.chance(0.7);
  b.t = fileAfter(rng, known, story);
  b.call('claims.file', {id: policyAt(account.auto.terms, 'pol-auto-', loss), coverage: sc.coverage, subject_id: vehicleId(account, slot[1], loss), loss_at: iso(loss), description,
    ...(police ? {police_report_number: police} : {}), ...(knownDriver ? {driver: listed(driver)} : {})}, b.tag);
  const photos = b.soon().evidence([...sc.photos.map(text => ['photo', known + rng.int(5, 60) * MINUTE, text]),
    ...(police ? [['report', known + rng.int(2, 20) * HOUR, 'Police report for the loss.', police]] : [])]);
  let rentalLabel = null;
  if (account.auto.rental && sc.rental !== false && rng.chance(0.45)) {
    b.person(2, 30);
    rentalLabel = b.tag + '.rental';
    b.call('rental.start', {id: r => r.id(b.tag), start_at: iso(Math.max(b.t - rng.int(5, 40) * MINUTE, loss + HOUR)), daily_rate: rng.amount(32, 62)}, rentalLabel);
  }
  // The adjuster asks for what the file lacks.
  const asks = {};
  if (sc.driver && !knownDriver) asks.driver = 'Who was driving, and is that person listed on the policy?';
  if (sc.other) asks.other_party = 'The name and the insurer of the other driver.';
  if (rng.chance(0.4)) asks.photos = 'Photos of the damage from four sides.';
  if (sc.parked) asks.parked = 'Where was the car parked, and was it locked?';
  if (rng.chance(0.25)) asks.statement = 'A short statement about how the loss happened.';
  if (!Object.keys(asks).length) asks.photos = 'Photos of the damage from four sides.';
  b.office(0, 1);
  const late = rng.chance(0.1), request = b.request(adjuster, asks, rng.chance(0.5) ? wall(dayOf(b.t) + 10, 17, 0) : null);
  b.person(late ? 24 * 11 : 2, late ? 24 * 14 : 40);
  if (asks.driver) b.call('claims.update', {id: r => r.id(b.tag), driver: listed(driver)});
  const writer = driver || account.owner, more = [];
  if (asks.photos) more.push(['photo', b.t - rng.int(10, 600) * MINUTE, 'Photos of the car from four sides.']);
  if (asks.statement) more.push(['statement', b.t - rng.int(10, 120) * MINUTE, 'Statement by ' + writer.name + ' about the loss.']);
  const extra = more.length ? b.soon().evidence(more) : [];
  const answers = {};
  if (asks.driver) answers.driver = [driver.name + ' was driving. ' + firstName(driver) + ' is listed on the policy.'];
  if (asks.other_party) answers.other_party = [rng.pick(['The other driver is ', 'The driver of the other car is ']) + rng.pick(OTHER_FIRST) + ' ' + rng.pick(OTHER_LAST) + ', insured with ' +
    rng.pick(['Northgate Insurance', 'Seneca Mutual', 'Keystone Auto Insurance', 'Brookfield General']) + '.', police ? [photos[photos.length - 1]] : []];
  if (asks.photos) answers.photos = ['The photos are attached.', [extra[0], photos[0]].filter(Boolean)];
  if (asks.parked) answers.parked = ['It was parked on ' + w.street + ', near our building. It was locked.'];
  if (asks.statement) answers.statement = ['My statement is attached.', [extra[extra.length - 1]]];
  b.soon().respond(request, answers);
  if (rng.chance(0.55)) b.person(1, 30).call('payee.set', {id: r => r.id(b.tag), payee: {kind: 'shop', name: shop}});
  // The first estimate and its written decision.
  b.office(1, 5);
  const deductible = cents(sc.coverage === 'collision' ? account.auto.collision : account.auto.comprehensive), [lo, hi] = sc.count || [2, 4];
  let lines;
  do lines = linesOf(rng, sc, w.side, lo, hi);
  while (lines.reduce((sum, l) => sum + cents(l.amount), 0) < deductible * 1.6);
  const source = sc.source || 'shop', e0 = b.estimate('initial', source, source === 'shop' ? shop : null, lines.map(l => [l.text, l.amount]));
  b.office(1, 4);
  const rules = S.DECISIONS;
  lines.forEach((l, j) => {
    const roll = rng.next();
    if (j > 0 && roll >= 0.8 && roll < 0.92 && rules[l.t.rule].cut) Object.assign(l, {status: 'approved', approved: money(cents(l.amount) * rng.int(60, 90) / 100), reason: rules[l.t.rule].cut, rule: l.t.rule});
    else if (j > 0 && roll >= 0.92 && l.t.old) Object.assign(l, {status: 'denied', reason: rules.old.deny, rule: 'old'});
    else Object.assign(l, {status: 'approved', approved: l.amount});
  });
  // If the cuts would leave nothing above the deductible, the adjuster approves the lines as estimated.
  if (lines.reduce((sum, l) => sum + (l.status === 'approved' ? cents(l.approved) : 0), 0) - deductible < 2500) {
    for (const l of lines) Object.assign(l, {status: 'approved', approved: l.amount, reason: undefined, rule: undefined});
  }
  const decided = lines.filter(l => l.reason);
  b.decide(adjuster, decided.length ? 'Most lines are approved. The reasons for the others are on each line.' : 'Approved as estimated.',
    lines.map((l, j) => l.status === 'approved' ? [e0, j, 'approved', l.approved, l.reason] : [e0, j, 'denied', l.reason]));
  b.office(1, 3).pay('repair', stillDue, eft(rng));
  // A dispute answers the reason of the decision it disputes, and only when about 25.00 or more is at stake.
  let disputed = null;
  const worth = decided.filter(l => rules[l.rule].dispute && cents(l.amount) - (l.status === 'approved' ? cents(l.approved) : 0) >= 2500);
  if (worth.length && rng.chance(0.4)) {
    const l = rng.pick(worth), j = lines.indexOf(l), rule = rules[l.rule], context = {shop, car: carName(vehicle)};
    b.person(18, 24 * 6);
    const proof = b.evidence([[l.rule === 'old' ? 'photo' : 'other', l.rule === 'old' ? loss - rng.int(10, 60) * DAY : b.t - rng.int(30, 300) * MINUTE, rule.evidence(context)]]);
    disputed = {label: b.soon().dispute(e0, j, rule.dispute, proof), line: l, rule};
  }
  // A supplement after the shop takes the damaged parts off. Its lines come from the hidden damage of the same scenario.
  if (sc.hidden.length && rng.chance(0.4)) {
    b.office(2, 6);
    // Hidden damage sits behind a part already in the claim, or behind a line picked before it in this supplement.
    const added = [];
    for (const t of rng.some(sc.hidden, 1, 3).sort((x, y) => sc.hidden.indexOf(x) - sc.hidden.indexOf(y))) {
      if (!t.needs || [...lines.filter(l => l.status === 'approved').map(l => l.text), ...added.map(a => a[0])].some(text => t.needs.test(text))) added.push([t.text.replace('{side}', w.side), rng.amount(t.lo, t.hi)]);
    }
    if (added.length) {
      const e1 = b.estimate('supplement', 'shop', shop, added);
      b.office(1, 3).decide(adjuster, 'Supplement approved as estimated.', added.map((row, j) => [e1, j, 'approved', row[1]]));
      b.office(1, 3).pay('repair', stillDue, eft(rng));
    }
  }
  if (disputed) {
    b.office(3, 8);
    const changed = rng.chance(0.5);
    b.decided(disputed.label, changed ? 'changed' : 'upheld', rng.pick(SUPERVISORS), changed ? disputed.rule.changed : disputed.rule.upheld,
      changed ? {status: 'approved', amount: disputed.line.amount} : null);
    if (changed) b.office(1, 3).pay('repair', stillDue, eft(rng));
  }
  b.office(2, 8).event('repair.completed', {claim_id: r => r.id(b.tag), reported_by: shop, final_invoice_total: r => invoice(r, b.tag)});
  if (rentalLabel) {
    b.person(1, 20).call('rental.end', {id: r => r.id(rentalLabel), end_at: iso(b.t - rng.int(5, 30) * MINUTE)});
    b.office(2, 5).pay('rental', r => r.rentalOwed(b.tag), eft(rng));
  }
  b.office(2, 6).close('paid', 'All approved amounts are paid.');
  return b.steps;
}

// A cracked windshield: one glass shop, one quick decision. Below the deductible the claim closes with no payment.
function glass(account, story, sc) {
  const b = builder(account, story), rng = b.rng, shop = rng.pick(GLASS), adjuster = rng.pick(ADJUSTERS);
  const {loss} = lossFor(rng, sc, story, 6), slot = slotFor(rng, account, loss);
  if (!slot) return [];
  const {w} = words(rng, account, sc);
  b.t = fileAfter(rng, loss, story);
  b.call('claims.file', {id: policyAt(account.auto.terms, 'pol-auto-', loss), coverage: sc.coverage, subject_id: vehicleId(account, slot[1], loss), loss_at: iso(loss), description: rng.pick(sc.texts)(w)}, b.tag);
  b.soon().evidence([['photo', loss + rng.int(30, 600) * MINUTE, sc.photos[0]]]);
  if (rng.chance(0.7)) b.person(0.5, 20).call('payee.set', {id: r => r.id(b.tag), payee: {kind: 'shop', name: shop}});
  b.office(1, 3);
  const lines = linesOf(rng, sc, w.side, 0, 2), e0 = b.estimate('initial', 'shop', shop, lines.map(l => [l.text, l.amount]));
  const total = lines.reduce((sum, l) => sum + cents(l.amount), 0), under = total - cents(account.auto.comprehensive) < 2500;
  b.office(0, 2).decide(adjuster, under ? 'Approved as estimated. The total is not more than the comprehensive deductible, so no payment is due.' : 'Approved as estimated.',
    lines.map((l, j) => [e0, j, 'approved', l.amount]));
  if (under) {
    b.office(1, 4).close('denied', 'The approved amount is not more than the deductible, so no payment is due.');
    return b.steps;
  }
  b.office(1, 3).pay('repair', stillDue, eft(rng));
  b.office(0, 3).event('repair.completed', {claim_id: r => r.id(b.tag), reported_by: shop, final_invoice_total: r => invoice(r, b.tag)});
  b.office(1, 4).close('paid', 'All approved amounts are paid.');
  return b.steps;
}

// A small scrape that ends below the deductible. The shop estimate is approved, and nothing is paid.
function underDeductible(account, story, sc) {
  const b = builder(account, story), rng = b.rng, shop = rng.pick(account.place.shops), adjuster = rng.pick(ADJUSTERS);
  const {loss} = lossFor(rng, sc, story), slot = slotFor(rng, account, loss), {driver, w} = words(rng, account, sc);
  if (!slot) return [];
  b.t = fileAfter(rng, loss, story);
  b.call('claims.file', {id: policyAt(account.auto.terms, 'pol-auto-', loss), coverage: sc.coverage, subject_id: vehicleId(account, slot[1], loss), loss_at: iso(loss),
    description: rng.pick(sc.texts)(w), driver: listed(driver)}, b.tag);
  b.soon().evidence([['photo', loss + rng.int(10, 120) * MINUTE, sc.photos[0]]]);
  const total = cents(account.auto.collision) * rng.int(45, 92) / 100, paint = Math.round(total * rng.int(15, 25) / 100);
  const lines = [[sc.required[0].text, money(Math.round(total) - paint)], [sc.required[1].text, money(paint)]];
  b.office(1, 4);
  const e0 = b.estimate('initial', 'shop', shop, lines);
  b.office(1, 3).decide(adjuster, 'Approved as estimated. The total is not more than the collision deductible, so no payment is due.', lines.map((row, j) => [e0, j, 'approved', row[1]]));
  b.office(2, 6).close('denied', 'The approved amount is not more than the deductible, so no payment is due.');
  return b.steps;
}

// A total loss: one or more settlement offers, a payoff to the lender when the car has a loan, and the rental benefit.
function totalLoss(account, story, sc) {
  const b = builder(account, story), rng = b.rng, adjuster = rng.pick(ADJUSTERS);
  const {loss, found} = lossFor(rng, sc, story), known = found || loss, slot = slotFor(rng, account, loss);
  if (!slot) return [];
  const [slotRow, slotIndex] = slot, vehicle = carOfTerm(account, slotRow, loss), {driver, w} = words(rng, account, sc), description = rng.pick(sc.texts)(w);
  const police = rng.chance(sc.police) ? policeNumber(rng, account, story.day) : null;
  b.t = fileAfter(rng, known, story);
  b.call('claims.file', {id: policyAt(account.auto.terms, 'pol-auto-', loss), coverage: sc.coverage, subject_id: vehicleId(account, slotIndex, loss), loss_at: iso(loss),
    description, ...(police ? {police_report_number: police} : {}), ...(sc.driver ? {driver: listed(driver)} : {})}, b.tag);
  if (police) b.soon().evidence([['report', known + rng.int(2, 10) * HOUR, 'Police report for the loss.', police]]);
  if (sc.stolen) {
    // The car is found days later. Only then are there photos of it.
    const days = rng.int(2, 4);
    b.t = Math.max(b.t + HOUR, wall(dayOf(loss) + days, rng.int(9, 16), rng.int(0, 59)));
    b.call('claims.update', {id: r => r.id(b.tag), description: description + sc.found({days: days + ' days'})});
  }
  const shotAt = sc.stolen ? b.t - rng.int(30, 120) * MINUTE : known + rng.int(20, 120) * MINUTE;
  b.soon().evidence(sc.photos.map(text => ['photo', shotAt + rng.int(0, 20) * MINUTE, text]));
  let rentalLabel = null;
  if (account.auto.rental && rng.chance(0.7)) {
    b.person(3, 30);
    rentalLabel = b.tag + '.rental';
    b.call('rental.start', {id: r => r.id(b.tag), start_at: iso(Math.max(b.t - rng.int(5, 40) * MINUTE, loss + HOUR)), daily_rate: rng.amount(34, 58)}, rentalLabel);
  }
  b.office(0, 2);
  const request = b.request(adjuster, {title: vehicle.lender ? 'The name of your lender and your loan account number.' : 'Is the title in your name, and is there a loan on the car?',
    mileage: 'The mileage of the car before the loss.', keys: 'How many keys do you have for the car?'}, null);
  const miles = Math.max(4000, (Number(dayText(dayOf(loss)).slice(0, 4)) - vehicle.year) * rng.int(9000, 14000) + rng.int(0, 6000));
  b.person(4, 48).respond(request, {
    title: [vehicle.lender ? 'The lender is ' + vehicle.lender + '. The loan account number ends in ' + rng.int(1000, 9999) + '.' : 'Yes. The title is in my name, and there is no loan.'],
    mileage: ['About ' + miles.toLocaleString('en-US') + ' miles.'], keys: [sc.stolen ? 'Two keys. Both are still at home.' : rng.pick(['Two keys.', 'One key. The second key was lost last year.'])]});
  const day = dayOf(loss), worth = value(rng, vehicle, day);
  if (rng.chance(0.5)) b.office(1, 4).estimate('initial', 'adjuster', null, linesOf(rng, sc, w.side, 1, 3).map(l => [l.text, l.amount]));
  const deductible = cents(sc.coverage === 'collision' ? account.auto.collision : account.auto.comprehensive);
  const payoff = vehicle.lender ? money(cents(worth) * rng.int(40, 112) / 100) : null;
  const basis = v => 'Actual cash value of ' + fmt(v) + ' from three comparable vehicles within 100 miles, at ' + miles.toLocaleString('en-US') + ' miles.';
  b.office(2, 7);
  let offer = b.offer(worth, payoff, basis(worth), adjuster, null), accepted = worth;
  const route = rng.weighted([['accept', 45], ['reject', 40], ['expire', 15]]);
  if (route === 'reject') {
    b.person(10, 72);
    const listings = b.evidence([['other', b.t - rng.int(30, 200) * MINUTE, 'Dealer listing of a ' + carName(vehicle) + ' of the same trim, with similar miles.'],
      ['other', b.t - rng.int(30, 200) * MINUTE, 'A second dealer listing of a ' + carName(vehicle) + ' of the same trim.']]);
    const first = offer;
    b.soon().call('offers.reject', {id: r => r.id(first), reason: 'The comparable vehicles are a lower trim level. Two dealer listings of the same trim are higher.', evidence_ids: r => r.ids(listings)});
    accepted = money(cents(worth) * rng.int(103, 109) / 100);
    b.office(2, 5);
    offer = b.offer(accepted, payoff, 'Revised with comparable vehicles of the same trim level. ' + basis(accepted), adjuster, null);
  } else if (route === 'expire') {
    b.t += 8 * DAY;
    b.office(1, 3);
    offer = b.offer(worth, payoff, 'The earlier offer expired with no answer. It is issued again with the same valuation.', adjuster, null);
  }
  const final = offer;
  b.person(4, 60).call('offers.accept', {id: r => r.id(final)});
  if (rentalLabel) b.person(1, 30).call('rental.end', {id: r => r.id(rentalLabel), end_at: iso(b.t - rng.int(5, 30) * MINUTE)});
  const net = Math.max(0, cents(accepted) - deductible), toLender = payoff === null ? 0 : Math.min(net, cents(payoff));
  b.office(2, 5);
  if (toLender > 0) b.pay('settlement', r => r.summary().settlement.still_due_to_lienholder, eft(rng), {kind: 'lienholder', name: vehicle.lender});
  if (net - toLender >= 2500) b.office(0, 2).pay('settlement', r => r.summary().settlement.still_due_to_me, eft(rng), {kind: 'policyholder'});
  if (rentalLabel) b.office(1, 4).pay('rental', r => r.rentalOwed(b.tag), eft(rng));
  b.office(2, 6).close('paid', toLender && toLender < cents(payoff) ? 'The settlement is paid. The loan balance above the settlement is between you and your lender.' : 'The settlement is paid.');
  // The car is replaced from the next policy term on.
  vehicle.totaled = loss;
  slotRow.cars.push({...car(rng, Number(dayText(day).slice(0, 4))), from: b.t, totaled: Infinity});
  return b.steps;
}

// Personal property on the renters policy: a list of items, the actual cash value of each, and sometimes a dispute.
function renters(account, story, sc) {
  const b = builder(account, story), rng = b.rng, adjuster = rng.pick(ADJUSTERS);
  const {loss, found} = lossFor(rng, sc, story), known = found || loss, police = sc.police ? policeNumber(rng, account, story.day) : null;
  // A bought item has an age. Its proof is its own receipt (dated near the day it was bought), a photo of it at home, or nothing.
  // An item with no proof is denied, and every other item is approved. The amounts are drawn again until the claim pays at least 25.00 or nothing.
  const pool = S.ITEMS[sc.pool], required = pool.filter(i => (sc.required || []).includes(i[0])), deductible = cents(account.renters.deductible), rules = S.DECISIONS;
  const chosen = [...required, ...rng.some(pool.filter(i => !required.includes(i)), Math.max(0, sc.count[0] - required.length), sc.count[1] - required.length)];
  const items = chosen.map(([text, lo, hi, kind]) => {
    const years = kind === 'service' ? 0 : rng.int(1, 7), shown = (sc.shown || []).includes(text);
    const proof = kind === 'service' || shown ? null : rng.chance(0.55) ? 'receipt' : rng.chance(0.7) ? 'photo' : 'none';
    return {text, kind, lo, hi, years, proof, name: text.split(',')[0].toLowerCase(),
      bought: years ? wall(dayOf(loss) - years * 365 + rng.int(-45, 45), rng.int(10, 19), rng.int(0, 59)) : null};
  });
  const acv = item => item.kind === 'worn' ? money(Math.max(cents(item.amount) * 0.3, cents(item.amount) * (1 - 0.1 * item.years))) : item.amount;
  let approved = 0;
  for (let tries = 0; tries < 40; tries++) {
    for (const item of items) item.amount = rng.amount(item.lo, item.hi);
    approved = items.filter(i => i.proof !== 'none').reduce((sum, i) => sum + cents(acv(i)), 0);
    if (approved - deductible >= 2500 || approved <= deductible) break;
  }
  const named = items.filter(i => i.kind !== 'service').map(i => 'the ' + i.name);
  const join = list => list.length > 1 ? list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1] : list.join('');
  b.t = fileAfter(rng, known, story);
  b.call('claims.file', {id: policyAt(account.renters.terms, 'pol-rent-', loss), coverage: 'personal_property', subject_id: 'addr-' + termOf(account.renters.terms, loss).tag,
    loss_at: iso(loss), description: rng.pick(sc.texts)({items: join(named)}), ...(police ? {police_report_number: police} : {})}, b.tag);
  const first = b.soon().evidence([...sc.photos.map(text => ['photo', known + rng.int(10, 90) * MINUTE, text]),
    ...(police ? [['report', known + rng.int(2, 20) * HOUR, 'Police report for the theft.', police]] : []),
    ...(sc.report ? [['report', known + rng.int(3, 30) * HOUR, sc.report]] : [])]);
  b.office(0, 2);
  const request = b.request(adjuster, {items: 'A list of the damaged or stolen items, with the year you bought each one.', proof: 'Receipts, photos or card statements that show you owned the items.'},
    rng.chance(0.5) ? wall(dayOf(b.t) + 10, 17, 0) : null);
  b.person(10, 24 * 5);
  const by = kind => items.filter(i => i.proof === kind);
  const lists = b.evidence([['statement', b.t - rng.int(20, 200) * MINUTE, 'List of the items with the year of purchase.'],
    ...by('receipt').map(item => ['receipt', item.bought, 'Receipt for the ' + item.name + '.']),
    ...by('photo').map(item => ['photo', wall(dayOf(loss) - rng.int(30, 400), rng.int(12, 19), rng.int(0, 59)), 'Photo of the ' + item.name + ' at home, taken before the loss.'])]);
  const the = list => join(list.map(i => 'the ' + i.name)), one = kind => by(kind).length === 1;
  const proofText = [by('receipt').length ? (one('receipt') ? 'The receipt for ' + the(by('receipt')) + ' is attached.' : 'Receipts for ' + the(by('receipt')) + ' are attached.') : '',
    by('photo').length ? (one('photo') ? 'A photo of ' + the(by('photo')) + ' at home is attached.' : 'Photos of ' + the(by('photo')) + ' at home are attached.') : '',
    by('none').length ? 'I have no receipt or photo for ' + join(by('none').map(i => 'the ' + i.name)) + '.' : ''].filter(Boolean).join(' ') || 'The photos of the loss show the items.';
  b.soon().respond(request, {items: ['The list is attached.', [lists[0]]], proof: [proofText, lists.length > 1 ? lists.slice(1) : first.slice(0, 1)]});
  const restorer = sc.restorer ? rng.pick(RESTORERS) : null;
  const years = n => n + (n === 1 ? ' year' : ' years');
  const lines = items.map(item => [item.text + (item.years ? ', bought ' + years(item.years) + ' ago' : ''), item.amount]);
  // A restoration company sends its own estimate. Otherwise the policyholder lists store prices.
  const e0 = restorer ? (b.office(1, 3), b.estimate('initial', 'shop', restorer, lines)) : (b.person(4, 72), b.submit('initial', 'Replacement prices from store websites', lines));
  b.office(2, 6);
  const decisions = items.map((item, j) => item.proof === 'none' ? [e0, j, 'denied', rules.unproven.deny]
    : item.kind === 'worn' ? [e0, j, 'approved', acv(item), rules.worn.cut(years(item.years))] : [e0, j, 'approved', item.amount]);
  const note = decisions.some(d => d[2] === 'denied') ? 'Items with proof are approved at their actual cash value. Items with no proof are denied.'
    : decisions.some(d => d[4]) ? 'Items are approved at their actual cash value: the price less wear for their years of use.' : 'Approved as listed.';
  const pays = approved - deductible >= 2500;
  b.decide(adjuster, note + (!pays && approved ? ' The total is not more than the deductible, so no payment is due.' : ''), decisions);
  if (pays) b.office(1, 3).pay('repair', stillDue, eft(rng));
  const worn = decisions.filter(d => d[4] && cents(rules.worn.raised(items[d[1]].amount, items[d[1]].years)) - cents(d[3]) >= 2500);
  if (worn.length && pays && rng.chance(0.35)) {
    const [k, j] = rng.pick(worn);
    b.person(20, 24 * 8);
    const quote = b.evidence([['other', b.t - rng.int(20, 200) * MINUTE, rules.worn.evidence({item: items[j].name})]]);
    const dispute = b.soon().dispute(k, j, rules.worn.dispute, quote);
    b.office(3, 9);
    const changed = rng.chance(0.35);
    b.decided(dispute, changed ? 'changed' : 'upheld', rng.pick(SUPERVISORS), changed ? rules.worn.changed : rules.worn.upheld,
      changed ? {status: 'approved', amount: rules.worn.raised(items[j].amount, items[j].years)} : null);
    if (changed) b.office(1, 3).pay('repair', stillDue, eft(rng));
  }
  b.office(2, 7);
  if (pays) b.close('paid', 'All approved amounts are paid.');
  else b.close('denied', approved ? 'The approved amount is not more than the deductible, so no payment is due.' : 'No item was approved, so no payment is due.');
  return b.steps;
}

// A claim that the insurer denies by a policy exclusion, with the scenario's own question, answer and dispute.
function denied(account, story, sc) {
  const b = builder(account, story), rng = b.rng, adjuster = rng.pick(ADJUSTERS), auto = sc.policy === 'auto';
  const {loss} = lossFor(rng, sc, story), {driver, w} = words(rng, account, sc);
  let lines, e0;
  b.t = fileAfter(rng, loss, story);
  if (auto) {
    const slot = slotFor(rng, account, loss);
    if (!slot) return [];
    b.call('claims.file', {id: policyAt(account.auto.terms, 'pol-auto-', loss), coverage: sc.coverage, subject_id: vehicleId(account, slot[1], loss), loss_at: iso(loss),
      description: sc.texts[0](w), driver: listed(driver)}, b.tag);
  } else {
    b.call('claims.file', {id: policyAt(account.renters.terms, 'pol-rent-', loss), coverage: 'personal_property', subject_id: 'addr-' + termOf(account.renters.terms, loss).tag, loss_at: iso(loss),
      description: sc.texts[0](w)}, b.tag);
  }
  b.soon().evidence([['photo', loss + rng.int(10, 90) * MINUTE, sc.photos[0]]]);
  const key = Object.keys(sc.ask)[0];
  b.office(0, 2);
  const request = b.request(adjuster, sc.ask, null);
  b.person(5, 60).respond(request, {[key]: [sc.answer(w)]});
  if (auto) {
    lines = linesOf(rng, {area: sc.area}, w.side, 3, 4).map(l => [l.text, l.amount]);
    e0 = b.office(1, 4).estimate('initial', 'shop', rng.pick(account.place.shops), lines);
  } else {
    lines = S.ITEMS[sc.pool].map(([text, lo, hi]) => [text, rng.amount(lo, hi)]);
    e0 = b.person(4, 48).submit('initial', 'Replacement prices from store websites', lines);
  }
  b.office(1, 4).decide(adjuster, sc.denial.deny, lines.map((row, j) => [e0, j, 'denied', sc.denial.deny]));
  if (rng.chance(0.4)) {
    b.person(24, 24 * 7);
    const proof = b.evidence([['other', b.t - rng.int(20, 200) * MINUTE, sc.denial.evidence(w)]]);
    const dispute = b.soon().dispute(e0, 0, sc.denial.dispute(w), proof);
    b.office(3, 8).decided(dispute, 'upheld', rng.pick(SUPERVISORS), sc.denial.upheld);
  }
  b.office(2, 6).close('denied', sc.denial.deny);
  return b.steps;
}

// The policyholder withdraws: the cost is small, the item was found, or the other driver's insurer pays.
function withdrawn(account, story, sc) {
  const b = builder(account, story), rng = b.rng, auto = sc.policy === 'auto', {loss} = lossFor(rng, sc, story), {w} = words(rng, account, sc);
  b.t = fileAfter(rng, loss, story);
  if (auto) {
    const slot = slotFor(rng, account, loss);
    if (!slot) return [];
    b.call('claims.file', {id: policyAt(account.auto.terms, 'pol-auto-', loss), coverage: sc.coverage, subject_id: vehicleId(account, slot[1], loss), loss_at: iso(loss), description: sc.texts[0](w)}, b.tag);
  } else {
    b.call('claims.file', {id: policyAt(account.renters.terms, 'pol-rent-', loss), coverage: 'personal_property', subject_id: 'addr-' + termOf(account.renters.terms, loss).tag, loss_at: iso(loss),
      description: sc.texts[0](w)}, b.tag);
  }
  const dated = sc.photoDaysBefore ? wall(dayOf(loss) - rng.int(...sc.photoDaysBefore), rng.int(12, 19), rng.int(0, 59)) : loss + rng.int(20, 120) * MINUTE;
  b.soon().evidence([['photo', dated, sc.photos[0]]]);
  if (sc.ask && rng.chance(0.6)) b.office(0, 2).request(rng.pick(ADJUSTERS), sc.ask, null);
  b.person(24, 24 * 12).call('claims.withdraw', {id: r => r.id(b.tag)});
  return b.steps;
}

// No answer from the policyholder: two requests, then the claim closes with no response.
function noResponse(account, story, sc) {
  const b = builder(account, story), rng = b.rng, adjuster = rng.pick(ADJUSTERS), {loss, found} = lossFor(rng, sc, story);
  const text = rng.pick(sc.texts)(), thing = /phone/.test(text) ? 'phone' : 'tablet';
  b.t = fileAfter(rng, found || loss, story);
  b.call('claims.file', {id: policyAt(account.renters.terms, 'pol-rent-', loss), coverage: 'personal_property', subject_id: 'addr-' + termOf(account.renters.terms, loss).tag, loss_at: iso(loss),
    description: text}, b.tag);
  b.office(0, 2).request(adjuster, {police_report: 'The police report number for the theft.', proof: 'The order confirmation for the ' + thing + '.'}, null);
  b.t += 11 * DAY;
  b.office(0, 2).request(adjuster, {police_report: 'Second request: the police report number for the theft.'}, null);
  b.t += 11 * DAY;
  b.office(1, 4).close('no_response', 'No answer was received to two requests.');
  return b.steps;
}

const STORIES = {repair: vehicleRepair, glass, underDeductible, total: totalLoss, renters, denied, withdrawn, noResponse};

function binding(account) {
  return {people: account.people.map(p => ({person_id: p.person_id, name: p.name})),
    accounts: [{app_id: APP, account_id: account.account_id, owner_person_id: account.owner.person_id}, {app_id: 'mail', account_id: 'mail-' + account.account_id.slice(APP.length + 1), owner_person_id: account.owner.person_id}],
    objects: {}};
}

const SCHEMAS = path.join(ROOT, 'schemas');
let validators = null;
function schemas() {
  if (!validators) {
    validators = {seed: compile(require('../schemas/seed.schema.json'), SCHEMAS), event: compile(require('../schemas/events.schema.json'), SCHEMAS),
      inputs: new Map(require('../tools.json').map(tool => [tool.name, compile(tool.inputSchema, ROOT)]))};
  }
  return validators;
}
const pad = (number, size = 4) => String(number).padStart(size, '0');
const EVENT_IDS = {'request.issued': ['info_request_id', 'req-'], 'estimate.submitted': ['estimate_id', 'est-'], 'determination.issued': ['determination_id', 'det-'],
  'offer.issued': ['offer_id', 'off-'], 'payment.issued': ['payment_id', 'pay-']};

// Replays the steps of one account that come before `until`, through the App's hooks. The result is the seed in its state at `until`.
// A policy term that starts after `until` is left out, because it does not exist yet.
function replay(account, until = CLOCK) {
  const v = schemas(), stop = Date.parse(until), bind = binding(account);
  const ctx = (role, now) => Object.freeze({app_id: APP, role, virtual_now: now, binding: structuredClone(bind)});
  let data = {account_id: account.account_id, owner_person_id: account.owner.person_id,
    insurer: {name: 'Alderbrook Mutual', timezone: ZONE, rules: {...RULES}}, preferences: {timezone: ZONE, email_notices: account.emails},
    policies: structuredClone(account.policies.filter(p => Date.parse(p.term.start) <= stop)), claims: [], notifications: [], activity: []};
  const ids = {}, counters = {}, done = {writes: 0, events: 0, held_back: 0};
  const claimOf = tag => data.claims.find(claim => claim.id === ids[tag]);
  const r = {
    id: label => ids[label] || assert.fail('Unknown label ' + label),
    ids: labels => labels.map(r.id),
    claimOf,
    line: (tag, k, j) => claimOf(tag).estimates[k].lines[j].id,
    summary: () => views.summary(data, claimOf(r.tag), r.now),
    rentalOwed(tag) {
      const claim = claimOf(tag), benefit = data.policies.find(p => p.id === claim.policy_id).rental_benefit, rows = views.rentals(data, claim, r.now);
      const owed = claim.rentals.reduce((sum, rental) => sum + rows.get(rental.id).covered_days * Math.min(cents(rental.daily_rate), cents(benefit.daily_cap)), 0);
      return money(owed - claim.payments.filter(p => p.kind === 'rental').reduce((sum, p) => sum + cents(p.amount), 0));
    }
  };
  const resolve = value => typeof value === 'function' ? resolve(value(r)) : Array.isArray(value) ? value.map(resolve)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, item]) => [k, resolve(item)])) : value;
  const steps = account.stories.flatMap(story => story.steps).map((step, order) => ({...step, order})).sort((a, b) => a.at - b.at || a.order - b.order);
  for (const step of steps) {
    if (step.at >= stop) { done.held_back++; continue; }
    const when = iso(step.at);
    Object.assign(r, {tag: step.claim, now: step.at});
    try {
      const args = resolve(step.args);
      if (step.name === 'payment.issued') assert.ok(args.amount >= 25, 'A payment of ' + args.amount + ' is too small to look real');
      if (step.actor === 'event') {
        const [field, prefix] = EVENT_IDS[step.name] || [];
        if (field) args[field] = prefix + pad(counters[prefix] = (counters[prefix] || 0) + 1);
        if (step.name === 'estimate.submitted') {
          const first = claimOf(step.claim).estimates.reduce((n, e) => n + e.lines.length, 0) + 1;
          args.lines = args.lines.map((row, index) => ({line_id: 'ln-' + pad(first + index, 2), ...row}));
        }
        const incoming = {event_id: 'ev-' + account.account_id.slice(APP.length + 1) + '-' + pad(++done.events), at: when, operation: APP + '.' + step.name, payload: args};
        assert.ok(v.event(incoming), 'Event schema');
        data = plugin.applyEvent(ctx('infra', when), data, incoming);
        if (step.label) ids[step.label] = args[field];
      } else {
        const name = APP + '.' + step.name, full = {...args, expected_version: {epoch: 1, revision: done.writes + done.events}, request_id: 'eval-' + pad(++done.writes)};
        assert.ok(v.inputs.get(name)(full), 'Input schema of ' + name);
        const out = plugin.handleTool(ctx('agent', when), data, name, full);
        data = out.data;
        if (Array.isArray(step.label)) step.label.forEach((label, index) => { ids[label] = out.result.evidence_ids[index]; });
        else if (step.label) ids[step.label] = out.result.id;
      }
      plugin.validateSeed(ctx('infra', when), data);
    } catch (error) {
      error.message = account.account_id + ' ' + step.claim + ' ' + step.name + ' at ' + when + ': ' + error.message;
      throw error;
    }
  }
  assert.ok(v.seed(data), 'Seed schema of ' + account.account_id);
  plugin.validateSeed(ctx('infra', until), data);
  return {data, binding: bind, writes: done.writes, events: done.events, held_back: done.held_back, claims: ids};
}

const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
function build() {
  const files = new Map(), accounts = [];
  for (let index = 0; index < ACCOUNTS; index++) {
    const account = plan(index), out = replay(account);
    const seedPath = 'accounts/' + account.account_id + '.seed.json', bindingPath = 'accounts/' + account.account_id + '.binding.json';
    const seedText = JSON.stringify(out.data) + '\n', bindingText = json(out.binding);
    files.set(seedPath, seedText);
    files.set(bindingPath, bindingText);
    accounts.push({account_id: account.account_id, provenance: 'synthetic', seed: seedPath, binding: bindingPath, virtual_now: CLOCK,
      seed_sha256: sha256(seedText), binding_sha256: sha256(bindingText), seed_bytes: Buffer.byteLength(seedText),
      policies: out.data.policies.length, claims: out.data.claims.length,
      claim_scenarios: account.stories.filter(s => out.claims[s.tag]).map(s => ({claim_id: out.claims[s.tag], scenario: s.kind})),
      writes: out.writes, events: out.events, steps_after_clock: out.held_back});
  }
  const manifest = {schema: 'alderbrook.evaluation-manifest.v1', dataset_id: 'alderbrook-evaluation', version: VERSION, provenance: 'synthetic',
    statement: 'Every record is synthetic. The insurer, the people, the shops, the lenders and the policies are fictional. No record was observed or collected.',
    generator: {tool: 'apps/alderbrook/dev/generate-evaluation-data.cjs', version: VERSION, prng: 'mulberry32', seed: SEED, accounts: ACCOUNTS,
      filing_window: {first: FIRST_FILING, last: LAST_FILING}, time_zone: ZONE, holidays_without_insurer_work: [...HOLIDAYS]},
    virtual_now: CLOCK, accounts};
  files.set('manifest.json', json(manifest));
  return files;
}

function main() {
  const check = process.argv.includes('--check'), files = build(), stale = [];
  for (const [name, text] of files) {
    const target = path.join(OUT, name);
    if (check) { if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) stale.push(name); continue; }
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, text);
  }
  const accounts = path.join(OUT, 'accounts'), known = new Set([...files.keys()]);
  const extra = fs.existsSync(accounts) ? fs.readdirSync(accounts).map(name => 'accounts/' + name).filter(name => !known.has(name)) : [];
  if (check && (stale.length || extra.length)) {
    console.error('Generated files are out of date: ' + [...stale, ...extra.map(name => name + ' (not generated)')].join(', '));
    process.exitCode = 1;
    return;
  }
  if (!check) for (const name of extra) fs.rmSync(path.join(OUT, name));
  const bytes = [...files.values()].reduce((sum, text) => sum + Buffer.byteLength(text), 0);
  console.log((check ? 'Checked ' : 'Wrote ') + files.size + ' files in data/evaluation (' + ACCOUNTS + ' accounts, ' + bytes + ' bytes), generator ' + VERSION + ', seed ' + SEED + '.');
}
if (require.main === module) main();
module.exports = {VERSION, SEED, ACCOUNTS, CLOCK, ZONE, plan, replay, binding};
