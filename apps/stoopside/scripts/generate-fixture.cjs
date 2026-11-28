#!/usr/bin/env node
'use strict';
// Deterministic generator for fixtures/minimal.json and fixtures/binding.json.
// The people, groups, upcoming events, sheets and the posts the example checks
// rely on are written out below by hand, and the background texts, replies and
// past-event descriptions are in fixtures/text/maple-street.json; past RSVPs,
// join dates, event lead times and background post dates and authors are drawn
// from a fixed-seed generator at waking hours (fixture-builder.cjs timeKit).
// Every date is on or after
// 2025-01-01 and the clock starts 2027-03-01 09:00 EST.
// Run: node scripts/generate-fixture.cjs        (writes the fixtures)
//      node scripts/generate-fixture.cjs --check (fails on drift)
const fs = require('node:fs');
const path = require('node:path');

// mulberry32: a small fixed-seed PRNG so the output never changes between runs.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rand = rng(20270301);   // reset at the start of each build()
const pick = list => list[Math.floor(rand() * list.length)];
// Fisher-Yates with the fixed-seed PRNG (Array.sort with a random comparator
// is not stable across Node versions).
const shuffle = list => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};
const OFF = '-05:00';
const at = (date, time = '09:00') => `${date}T${time}:00${OFF}`;
const ms = s => Date.parse(s);
const iso = t => new Date(t - 5 * 3600000).toISOString().slice(0, 19) + OFF;
const DAY = 86400000, HOUR = 3600000;
const pad = (n, w = 4) => String(n).padStart(w, '0');

// ---- People and members ------------------------------------------------------
// [member number, everyday name, display name, bio, groups {group: role}]
const P = 'g-parents', G = 'g-garden', B = 'g-block', RUN = 'g-runclub';
const PEOPLE = [
  [1, 'Dana Okafor', 'Dana O.', 'Two kids at Maple St School. I host the block cleanups.', {[P]: 'member', [G]: 'member', [B]: 'co_organizer'}],
  [2, 'Priya Shah', 'Priya Shah', 'PTA chair. Ask me about the book fair.', {[P]: 'organizer', [G]: 'member'}],
  [3, 'Sam Okafor', 'Sam O.', 'Usually behind a grill.', {[P]: 'member'}],
  [4, 'Gus Petrakis', 'Gus P.', 'Third-grade parent and volunteer coordinator.', {[P]: 'co_organizer'}],
  [5, 'Harold Brennan', 'Hal B.', 'Garden coordinator. Plot 1, the one with the scarecrow.', {[G]: 'organizer'}],
  [6, 'Joan Whitfield', 'Joan W.', 'Block captain since 2019.', {[B]: 'organizer'}],
  [7, 'Luis Ortega', 'Luis O.', 'Run club founder. Slow miles, good company.', {[RUN]: 'organizer'}],
  [8, 'Margaret Olsen', 'Peggy O.', 'Roses, compost and crosswords.', {[G]: 'member', [B]: 'member'}],
  [9, 'Marcus Lee', 'Marcus Lee', 'Plot 7. Peppers mostly.', {[G]: 'member'}],
  [10, 'Rachel Kim', 'Rae K.', 'Kindergarten parent, room helper on Fridays.', {[P]: 'event_host'}],
  [11, 'Tomasz Nowak', 'Tom N.', 'Coach for the Saturday kids run.', {[P]: 'member', [RUN]: 'event_host'}],
  [12, 'Kemi Adebayo', 'Kemi A.', 'Corner house with the big maple.', {[B]: 'event_host'}],
  [13, 'Theodore Brandt', 'Theo B.', 'Has a van, will haul.', {[B]: 'member'}],
  [14, 'Grace Liu', 'Grace L.', 'Second-grade parent, amateur baker.', {[B]: 'member', [P]: 'member'}],
  [15, 'Robert Fitzgerald', 'Fitz', 'Marathoner in training. Lives on Elm.', {[RUN]: 'member', [B]: 'member'}],
  [16, 'Imani Clarke', 'Imani C.', 'Bees, mostly.', {[B]: 'member', [G]: 'member'}],
  [17, 'Oscar Delgado', 'Oscar D.', 'Fourth-grade parent.', {[P]: 'member'}],
  [18, 'Ellen Park', 'Ellie P.', 'New to the street in 2025.', {[B]: 'member'}],
  [19, 'Yusuf Haddad', 'Yusuf H.', 'Early mornings only.', {[RUN]: 'member'}],
  [20, 'Ana Ruiz', 'Ana R.', 'Plot 3, herbs and too much mint.', {[G]: 'member'}],
  [21, 'Deborah Stein', 'Debbie S.', 'Retired teacher, crossing guard on Tuesdays.', {[P]: 'member', [B]: 'member'}],
  [22, 'Kwame Mensah', 'Kwame M.', 'Plot 11 and the Tuesday 5K.', {[RUN]: 'member', [G]: 'member'}],
  [23, 'Lucy Brennan', 'Lucy B.', 'Plot 2, next to my dad.', {[G]: 'member', [P]: 'member'}],
  [24, 'Patrick Walsh', 'Paddy W.', 'Snow shovel lender.', {[B]: 'member'}],
  [25, 'Sofia Romano', 'Sofia R.', 'Art club volunteer.', {[P]: 'member'}],
  [26, 'Nikhil Rao', 'Nik R.', 'Runs with a stroller.', {[RUN]: 'member', [P]: 'member'}],
  [27, 'Birdie Adeyemi', 'Wren Adeyemi', 'Seed swaps, sourdough and the occasional banjo.', {[B]: 'member', [G]: 'member'}],
  [28, 'Hannah Cho', 'Hannah C.', 'Library volunteer.', {[P]: 'member'}],
  [29, 'Elizabeth Moreau', 'Libby M.', 'Plot 9. Squash every year, no regrets.', {[G]: 'member'}],
  [30, 'Daniel Avila', 'Dan A.', 'Trail runner.', {[RUN]: 'member'}],
  [31, 'Nell Fischer', 'Nell F.', 'Plot 14, flowers for the school office.', {[G]: 'member'}],
  [32, 'Victor Osei', 'Victor O.', 'Fixes bikes on the stoop on Sundays.', {[B]: 'member'}],
  [33, 'Catherine Byrne', 'Kit B.', 'Parent of twins. Runs to stay sane.', {[P]: 'member', [RUN]: 'member'}],
  [34, 'Jamal Wright', 'Jamal W.', 'Elm Ave, blue door.', {[B]: 'member', [RUN]: 'member'}],
  [35, 'Mei Tanaka', 'Mei T.', 'Plot 5. Greens and more greens.', {[G]: 'member'}],
  [36, 'Frances Doyle', 'Frankie D.', 'Dog walker, knows every dog on the block.', {[B]: 'member'}],
  [37, 'Arturo Vega', 'Arturo V.', 'Fifth-grade parent.', {[P]: 'member'}],
  [38, 'Zoe Kaplan', 'Zoe K.', 'Plot 12 and the long runs.', {[G]: 'member', [RUN]: 'member'}],
  [39, 'William Hart', 'Bill H.', 'Toolshed keeper.', {[B]: 'member', [G]: 'member'}],
  [40, 'Leila Nasser', 'Leila N.', 'First-grade parent.', {[P]: 'member'}],
  [41, 'Beatriz Ramos', 'Bea R.', 'Moved here in spring 2026.', {[RUN]: 'member'}],
  [42, 'Owen Pryce', 'Owen P.', 'Track Tuesdays.', {[RUN]: 'member'}],
  [43, 'Rosa Jimenez', 'Rosa J.', 'Book fair helper.', {[P]: 'member'}],
  [44, 'Christopher Bell', 'CB', 'Corner of Maple and Elm.', {[B]: 'member'}],
  [45, 'Amara Eze', 'Amara E.', 'Plot 6, beans.', {[G]: 'member'}],
  [46, 'Felix Wagner', 'Felix W.', 'Third-grade parent.', {[P]: 'member'}],
  [47, 'Isabel Cruz', 'Izzy C.', 'Plot 8 and the block newsletter.', {[G]: 'member', [B]: 'member'}],
  [48, 'Marco Bianchi', 'Marco B.', 'Half marathons.', {[RUN]: 'member'}],
  [49, 'Tess Holloway', 'Tess H.', 'Pre-K parent.', {[P]: 'member'}],
  [50, 'Abdul Karim', 'Abdul K.', 'Ground-floor neighbor at 22 Maple.', {[B]: 'member'}],
  [51, 'Julia Novak', 'Jules N.', 'Parent and plot 10.', {[P]: 'member', [G]: 'member'}],
  [52, 'Ben Adler', 'Ben A.', 'New runner, be patient.', {[RUN]: 'member'}],
  [53, 'Carmen Silva', 'Carmen S.', 'Plot 4.', {[G]: 'member'}],
  [54, 'Henry Lowe', 'Hank L.', 'Retired, always home for deliveries.', {[B]: 'member'}],
  [55, 'Ivy Chen', 'Ivy C.', 'Second-grade parent.', {[P]: 'member'}],
  [56, 'Rafael Duarte', 'Rafa D.', 'Runs to the garden and back.', {[RUN]: 'member', [G]: 'member'}],
  [57, 'Naomi Fisher', 'Naomi F.', 'Kindergarten parent.', {[P]: 'member'}],
  [58, 'Quinn Murphy', 'Quinn M.', 'Elm Ave.', {[B]: 'member'}],
  [59, 'Simone Laurent', 'Simone L.', 'Plot 13.', {[G]: 'member'}],
  [60, 'Diego Fuentes', 'Diego F.', 'Fourth-grade parent, Sunday runs.', {[P]: 'member', [RUN]: 'member'}],
  [61, 'Martha Gill', 'Mattie G.', 'Porch plants and porch gossip.', {[B]: 'member'}],
  [62, 'Leo Sato', 'Leo S.', 'First-grade parent.', {[P]: 'member'}],
  [63, 'Ruth Abrams', 'Ru A.', 'Plot 15.', {[G]: 'member'}],
  [64, 'Kofi Asante', 'Kofi A.', 'Maple St since 2010.', {[B]: 'member'}],
];
const mid = n => 'm-' + pad(n, 3);
const personId = name => 'person-' + name.toLowerCase().split(' ')[0] + '-' + name.toLowerCase().split(' ')[1];

// ---- Groups -----------------------------------------------------------------
const GROUPS = [
  {id: P, name: 'Maple St School Parents', description: 'Parents and carers of Maple St School students: events, volunteering and school news.', created: '2025-01-06', requires_approval: false, hide_from_member_list: false, hide_rsvps: false},
  {id: G, name: 'Elm Ave Community Garden', description: 'Plot holders and friends of the Elm Ave garden. Work days, potlucks and the seed swap.', created: '2025-01-08', requires_approval: false, hide_from_member_list: true, hide_rsvps: false},
  {id: B, name: 'Maple St Block Association', description: 'Neighbors on the 100 and 200 blocks of Maple St: cleanups, the block party and street news.', created: '2025-01-10', requires_approval: false, hide_from_member_list: false, hide_rsvps: true},
  {id: RUN, name: 'Linden Park Run Club', description: 'Easy-paced group runs around Linden Park. New members are approved by an organizer.', created: '2025-01-12', requires_approval: true, hide_from_member_list: false, hide_rsvps: false},
];

// ---- Past events --------------------------------------------------------------
// [group, date, start, hours, title, venue, capacity, guest_limit]
const PAST = [
  [P, '2025-02-08', '10:00', 3, 'Winter carnival setup crew', 'Maple St School gym', 40, 1],
  [P, '2025-05-17', '11:00', 4, 'End-of-year picnic', 'Linden Park east field', 120, 3],
  [P, '2025-09-06', '15:00', 2, 'Back-to-school ice cream social', 'Maple St School yard', 150, 3],
  [P, '2025-10-25', '16:00', 3, 'Fall harvest party', 'Maple St School gym', 120, 3],
  [P, '2025-12-13', '10:00', 2, 'Holiday craft morning', 'Maple St branch library', 40, 2],
  [P, '2026-03-14', '09:00', 4, 'Pi Day bake sale', 'Maple St School lobby', 60, 3],
  [P, '2026-06-13', '09:00', 5, 'Field day volunteers', 'Maple St School field', 50, 1],
  [P, '2026-10-24', '16:00', 3, 'Fall harvest party', 'Maple St School gym', 120, 3],
  [G, '2025-03-22', '09:00', 4, 'Bed prep work day', 'Elm Ave garden', 30, 1],
  [G, '2025-05-03', '10:00', 3, 'Plant sale', 'Elm Ave garden gate', 60, 2],
  [G, '2025-07-19', '17:00', 2, 'Tomato tasting', 'Elm Ave garden shed', 30, 1],
  [G, '2025-09-27', '10:00', 3, 'Seed swap', 'Elm Ave garden shed', 40, 1],
  [G, '2026-03-28', '09:00', 4, 'Spring work day', 'Elm Ave garden', 30, 1],
  [G, '2026-06-20', '17:00', 3, 'Solstice potluck', 'Elm Ave garden', 30, 2],
  [G, '2026-09-26', '10:00', 3, 'Seed swap', 'Elm Ave garden shed', 40, 1],
  [G, '2026-11-07', '10:00', 2, 'Garlic planting', 'Elm Ave garden', 25, 1],
  [B, '2025-04-12', '09:00', 3, 'Spring cleanup', 'Elm Ave lot', 40, 3],
  [B, '2025-06-21', '14:00', 6, 'Block party', '100 block of Maple St', 200, 4],
  [B, '2025-10-18', '10:00', 3, 'Leaf raking day', 'Maple St', 40, 2],
  [B, '2026-04-18', '09:00', 3, 'Spring cleanup', 'Elm Ave lot', 40, 3],
  [B, '2026-06-27', '14:00', 6, 'Block party', '100 block of Maple St', 200, 4],
  [B, '2026-10-17', '10:00', 2, 'Bulb planting', 'Maple St median', 30, 2],
  [B, '2027-01-23', '18:30', 2, 'Winter meeting', 'Maple St branch library community room', 50, 0],
  [RUN, '2025-03-01', '08:00', 2, 'Season opener 5K', 'Linden Park boathouse', 50, 1],
  [RUN, '2025-06-07', '18:30', 2, 'Track night', 'Maple St School track', 30, 0],
  [RUN, '2025-09-13', '07:30', 2, 'Hill repeats', 'Linden Park north hill', 30, 0],
  [RUN, '2026-01-10', '08:00', 2, 'Frosty miles', 'Linden Park boathouse', 40, 0],
  [RUN, '2026-04-11', '07:30', 2, 'Spring 10K group run', 'Linden Park boathouse', 50, 1],
  [RUN, '2026-08-15', '06:30', 2, 'Sunrise run', 'River path at Elm Ave', 30, 0],
  [RUN, '2026-11-14', '08:00', 2, 'Turkey trot practice', 'Linden Park boathouse', 40, 0],
];

// The user's past RSVPs: [group, date, guests, children, answered]. The latest
// one in Maple St School Parents is the Pi Day bake sale, answered 2026-03-07.
const USER_PAST = [
  [P, '2025-05-17', 1, 2, '2025-05-10T19:40'], [P, '2025-10-25', 1, 2, '2025-10-12T21:05'], [P, '2026-03-14', 1, 2, '2026-03-07T20:15'],
  [G, '2025-09-27', 0, 0, '2025-09-20T08:30'], [G, '2026-06-20', 1, 0, '2026-06-11T18:45'], [G, '2026-09-26', 0, 0, '2026-09-19T09:10'],
  [B, '2025-04-12', 1, 2, '2025-04-01T20:00'], [B, '2025-06-21', 1, 2, '2025-06-08T12:30'], [B, '2026-04-18', 1, 2, '2026-04-05T19:00'],
  [B, '2026-06-27', 1, 2, '2026-06-14T10:20'], [B, '2027-01-23', 0, 0, '2027-01-12T21:30'],
];

// ---- Hand-written text -------------------------------------------------------
// Background post texts (one per group, month of year and year covered), the
// reply pool and the past events' descriptions live in fixtures/text/.
const TEXT = require('./fixtures/text/maple-street.json');

function build() {
  rand = rng(20270301);
  const K = require('./fixture-builder.cjs').timeKit(() => rand(), -5 * 3600000);
  const textUse = {};
  let replyPool = [];
  // Hand-written RSVP orders keep their order; the times are spread over the
  // same span at waking hours instead of fixed steps.
  const spreads = {};
  const spread = (first, n, stepH) => spreads[first + '|' + n + '|' + stepH] ||= (() => {
    const lo = ms(first), hi = lo + Math.max(1, n - 1) * stepH * HOUR;
    return Array.from({length: n}, () => K.between(lo - 1, hi)).sort((a, b) => a - b);
  })();
  const replyText = () => { if (!replyPool.length) replyPool = shuffle(TEXT.replies); return replyPool.pop(); };
  const data = {account_id: 'st-dana', owner_person_id: 'person-dana-okafor', user_member_id: 'm-001', next_seq: 1,
    groups: [], members: [], memberships: [], events: [], rsvps: [], posts: [], digests: [], sheets: [], swaps: [],
    deliveries: [], previews: [], notices: []};
  const facts = [];  // {at, order, apply(seq)} assigned seq in time order at the end
  const fact = (atTime, apply) => facts.push({at: atTime, n: facts.length, apply});

  for (const g of GROUPS) {
    data.groups.push({id: g.id, name: g.name, description: g.description, utc_offset: OFF, tz_label: 'EST',
      requires_approval: g.requires_approval, hide_from_member_list: g.hide_from_member_list, hide_rsvps: g.hide_rsvps,
      created_at: at(g.created, '12:00'), digest_through: at('2027-03-01', '08:00')});
  }
  const joinDay = {};
  for (const [n, everyday, display, bio, groups] of PEOPLE) {
    const id = mid(n);
    // Founders join the day the group is made; others over the first months,
    // at waking-hours times.
    const joins = Object.entries(groups).map(([g, role]) => {
      let joined = role === 'organizer' ? at(GROUPS.find(x => x.id === g).created, '12:30')
        : iso(K.awakeOn(ms(at('2025-02-01', '12:00')) + K.int(0, 119) * DAY));
      if (n === 41) joined = at('2026-05-09', '10:00');   // Bea moved here in spring 2026
      if (n === 27 && g === B) joined = at('2025-08-02', '11:00');
      return [g, role, joined];
    });
    const firstJoin = Math.min(...joins.map(j => ms(j[2])));
    data.members.push({id, display_name: display, bio, email: everyday.toLowerCase().replace(' ', '.') + '@example.net',
      person_id: n === 1 ? 'person-dana-okafor' : personId(everyday), created_at: iso(K.between(firstJoin - 3 * DAY, firstJoin - HOUR))});
    for (const [g, role, joined] of joins) {
      joinDay[g + '|' + id] = joined;
      const msRow = {id: 'ms-' + pad(data.memberships.length + 1), group_id: g, member_id: id, state: 'member',
        role: role === 'organizer' ? 'organizer' : 'member', created_at: joined, revisions: []};
      data.memberships.push(msRow);
      fact(msRow.created_at, seq => msRow.revisions.push({seq, at: msRow.created_at, state: 'member', role: msRow.role, reason: 'joined'}));
      if (role !== 'member' && role !== 'organizer') {
        // Promotions happen later and are revisions of their own.
        const promoted = n === 1 ? '2025-11-15T10:00:00' + OFF : n === 12 ? '2026-02-01T09:00:00' + OFF : '2025-06-01T09:00:00' + OFF;
        fact(promoted, seq => { msRow.role = role; msRow.revisions.push({seq, at: promoted, state: 'member', role, reason: 'promoted'}); });
      }
    }
  }
  // Historical leavers and a removal; the user's pending run-club request.
  const leave = (g, n, when, state) => {
    const m = data.memberships.find(x => x.group_id === g && x.member_id === mid(n));
    fact(when, seq => { m.state = state; m.revisions.push({seq, at: when, state, role: m.role, reason: state === 'left' ? 'left' : 'removed'}); });
  };
  leave(P, 46, '2026-08-30T17:00:00' + OFF, 'left');
  leave(B, 58, '2026-05-02T12:00:00' + OFF, 'removed');
  const pending = {id: 'ms-' + pad(data.memberships.length + 1), group_id: RUN, member_id: 'm-001', state: 'pending', role: 'member',
    created_at: '2027-02-25T21:10:00' + OFF, revisions: []};
  data.memberships.push(pending);
  fact(pending.created_at, seq => pending.revisions.push({seq, at: pending.created_at, state: 'pending', role: 'member', reason: 'join'}));

  const members = (g, when) => data.memberships.filter(m => m.group_id === g && ms(m.created_at) <= ms(when) &&
    !(m.group_id === P && m.member_id === 'm-046' && ms(when) >= ms('2026-08-30T17:00:00' + OFF)) &&
    !(m.group_id === B && m.member_id === 'm-058' && ms(when) >= ms('2026-05-02T12:00:00' + OFF)) &&
    !(m.group_id === RUN && m.member_id === 'm-001')).map(m => m.member_id);
  const roleAt = g => data.memberships.filter(m => m.group_id === g && m.role === 'organizer').map(m => m.member_id)[0];

  // ---- Events ------------------------------------------------------------------
  let eventNo = 81, rsvpNo = 1;
  const addEvent = (e, created) => {
    data.events.push(e);
    fact(created, seq => e.revisions.push({seq, at: created, action: 'created', state: 'published', fields: {}, notify: null, actor: e.created_by}));
    return e;
  };
  const addRsvp = (e, member, answer, guests, children, when, extra = {}) => {
    const r = {id: 'r-' + pad(rsvpNo++), event_id: e.id, member_id: member, answer, guests, children, created_at: when, updated_at: when,
      waitlisted_at: answer === 'waitlist' ? when : null, offer_expires_at: null, reconfirm_by: null, revisions: [], ...extra};
    data.rsvps.push(r);
    fact(when, seq => r.revisions.push({seq, at: when, answer, guests, children, reason: 'rsvp'}));
    return r;
  };
  const pastEvents = [...PAST].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  for (const [g, date, start, hours, title, venue, capacity, guestLimit] of pastEvents) {
    const s = at(date, start), host = roleAt(g);
    const mineAt = USER_PAST.find(([ug, ud]) => ug === g && ud === date);
    const w = K.eventWindow(ms(s), capacity, mineAt && ms(at(mineAt[4].slice(0, 10), mineAt[4].slice(11))));
    const description = TEXT.descriptions[g + '|' + date];
    if (!description) throw new Error(`no description for ${g} ${date} ${title}`);
    const e = {id: 'e-' + pad(eventNo++), group_id: g, title, description, start: s,
      end: iso(ms(s) + hours * 3600000), venue, capacity, guest_limit: guestLimit, rsvp_open: iso(w.open),
      rsvp_close: iso(w.close), host_member_ids: [host], state: 'published', created_by: host, created_at: iso(w.created), revisions: []};
    addEvent(e, e.created_at);
    const pool = members(g, e.rsvp_open).filter(m => m !== 'm-001');
    const count = Math.min(pool.length, 5 + Math.floor(rand() * 8));
    const chosen = shuffle(pool).slice(0, count).sort();
    let used = 0;
    for (const m of chosen) {
      const yes = rand() < 0.82, guests = yes ? Math.min(guestLimit, Math.floor(rand() * 2)) : 0;
      const children = yes && g === P ? Math.floor(rand() * 3) : 0;
      if (yes && used + 1 + guests + children > capacity) continue;
      if (yes) used += 1 + guests + children;
      const when = iso(K.answerTime(w, ms(at('2027-03-01'))));
      addRsvp(e, m, yes ? 'yes' : 'no', guests, children, when);
    }
    const mine = USER_PAST.find(([ug, ud]) => ug === g && ud === date);
    if (mine) addRsvp(e, 'm-001', 'yes', mine[2], mine[3], at(mine[4].slice(0, 10), mine[4].slice(11)));
  }

  // ---- Upcoming events (hand-written) --------------------------------------------
  const upcoming = (id, g, title, description, start, end, venue, capacity, guestLimit, open, close, hosts, created) => addEvent({id, group_id: g, title,
    description, start, end, venue, capacity, guest_limit: guestLimit, rsvp_open: open, rsvp_close: close, host_member_ids: hosts,
    state: 'published', created_by: hosts[0], created_at: created, revisions: []}, created);
  const e117 = upcoming('e-0117', G, 'Spring potluck', 'Bring a dish to share. Plates and tables provided.', at('2027-03-13', '12:00'), at('2027-03-13', '15:00'),
    'Elm Ave garden shed', 24, 2, at('2027-02-15'), at('2027-03-12', '18:00'), ['m-005'], at('2027-02-13', '10:00'));
  const e118 = upcoming('e-0118', RUN, 'Saturday long run', '8 to 10 miles at conversation pace.', at('2027-03-06', '07:30'), at('2027-03-06', '09:30'),
    'Linden Park boathouse', 30, 0, at('2027-02-20'), at('2027-03-05', '20:00'), ['m-007'], at('2027-02-18', '09:00'));
  const e121 = upcoming('e-0121', P, 'Spring fling family dance', 'Music, crafts and pizza for families. Children need a place too; babies under two do not count.',
    at('2027-03-20', '16:00'), at('2027-03-20', '19:00'), 'Maple St School gym', 80, 2, at('2027-02-20'), at('2027-03-19', '12:00'), ['m-002', 'm-010'], at('2027-02-18', '11:00'));
  const e125 = upcoming('e-0125', P, 'Book fair volunteers', 'Two-hour shifts at the book fair tables.', at('2027-03-25', '08:00'), at('2027-03-25', '15:00'),
    'Maple St School library', 12, 0, at('2027-02-25'), at('2027-03-24', '12:00'), ['m-002'], at('2027-02-23', '09:00'));
  const e127 = upcoming('e-0127', G, 'Seed starting workshop', 'Trays, soil and seeds provided.', at('2027-03-27', '10:00'), at('2027-03-27', '12:00'),
    'Elm Ave garden shed', 16, 1, at('2027-02-27'), at('2027-03-26', '12:00'), ['m-005'], at('2027-02-26', '09:00'));
  const e130 = upcoming('e-0130', B, 'June social: planning meeting', 'Planning for the June social. Volunteers and hosts.', at('2027-03-10', '19:00'), at('2027-03-10', '20:30'),
    'Joan\'s porch, 14 Maple St', 10, 0, at('2027-02-25'), at('2027-03-10', '12:00'), ['m-006', 'm-001'], at('2027-02-24', '18:00'));
  const e140 = upcoming('e-0140', B, 'Spring cleanup', 'Litter pick and bulb weeding. Gloves and bags provided; carpools leave from the lot.', at('2027-03-20', '09:00'), at('2027-03-20', '12:00'),
    'Elm Ave lot', 40, 3, at('2027-02-20'), at('2027-03-19', '18:00'), ['m-001', 'm-012'], at('2027-02-12', '20:00'));

  // e-0117: full (24 places), then a waitlist of three.
  const potluck = [['m-005', 0, 0], ['m-009', 1, 0], ['m-002', 0, 2], ['m-008', 0, 0], ['m-016', 1, 0], ['m-022', 0, 0], ['m-023', 0, 2],
    ['m-027', 0, 0], ['m-029', 0, 0], ['m-035', 1, 0], ['m-038', 0, 0], ['m-039', 1, 0], ['m-045', 0, 0], ['m-047', 0, 0], ['m-051', 1, 0]];
  potluck.forEach(([m, g, c], i, all) => addRsvp(e117, m, 'yes', g, c, iso(spread(at('2027-02-15', '10:00'), all.length, 7)[i])));
  for (const m of ['m-053', 'm-056', 'm-063']) addRsvp(e117, m, 'no', 0, 0, at('2027-02-19', '12:00'));
  rsvpNo = 451;
  addRsvp(e117, 'm-001', 'waitlist', 1, 0, at('2027-02-20', '19:30'));
  addRsvp(e117, 'm-020', 'waitlist', 1, 0, at('2027-02-22', '08:15'));
  addRsvp(e117, 'm-031', 'waitlist', 0, 0, at('2027-02-24', '17:40'));
  rsvpNo = 470;
  // e-0121: some families already in.
  [['m-002', 1, 2], ['m-010', 1, 1], ['m-004', 1, 2], ['m-014', 1, 1], ['m-017', 1, 3], ['m-025', 0, 2], ['m-028', 1, 2], ['m-040', 1, 1], ['m-055', 1, 2]]
    .forEach(([m, g, c], i, all) => addRsvp(e121, m, 'yes', g, c, iso(spread(at('2027-02-20', '12:00'), all.length, 11)[i])));
  [['m-002', 0, 0], ['m-004', 0, 0], ['m-043', 0, 0], ['m-028', 0, 0]].forEach(([m], i, all) => addRsvp(e125, m, 'yes', 0, 0, iso(spread(at('2027-02-25', '12:00'), all.length, 9)[i])));
  [['m-005', 0, 0], ['m-035', 0, 0], ['m-029', 1, 0]].forEach(([m, g], i, all) => addRsvp(e127, m, 'yes', g, 0, iso(spread(at('2027-02-27', '12:00'), all.length, 5)[i])));
  [['m-007', 0, 0], ['m-019', 0, 0], ['m-030', 0, 0], ['m-038', 0, 0], ['m-042', 0, 0], ['m-048', 0, 0]].forEach(([m], i, all) => addRsvp(e118, m, 'yes', 0, 0, iso(spread(at('2027-02-20', '10:00'), all.length, 13)[i])));
  // e-0130: the planning meeting; Wren (m-027) has not joined it.
  ['m-006', 'm-001', 'm-012', 'm-014', 'm-016', 'm-018'].forEach((m, i, all) => addRsvp(e130, m, 'yes', 0, 0, iso(spread(at('2027-02-25', '12:00'), all.length, 6)[i])));
  addRsvp(e130, 'm-024', 'no', 0, 0, at('2027-02-26', '20:00'));
  // e-0140: the cleanup the user co-hosts.
  [['m-001', 1, 2], ['m-012', 0, 0], ['m-013', 0, 0], ['m-016', 1, 0], ['m-006', 0, 0], ['m-021', 0, 0], ['m-032', 1, 1], ['m-034', 0, 0],
    ['m-047', 0, 0], ['m-054', 0, 0], ['m-064', 1, 0]].forEach(([m, g, c], i, all) => addRsvp(e140, m, 'yes', g, c, iso(spread(at('2027-02-20', '09:30'), all.length, 8)[i])));
  addRsvp(e140, 'm-036', 'no', 0, 0, at('2027-02-24', '07:50'));

  // ---- Sign-up sheets ---------------------------------------------------------
  const byTitle = (g, title, year) => data.events.find(e => e.group_id === g && e.title === title && e.start.startsWith(year));
  const sheet = (id, e, title, lock, slots, claimAt) => {
    const s = {id, event_id: e.id, title, lock_at: lock, slots: slots.map(([sid, label, q, claims]) => ({id: sid, label, quantity: q, claims: []})), revisions: []};
    data.sheets.push(s);
    slots.forEach(([sid, , , claims], i) => claims.forEach((m, j) => {
      const when = iso(spread(claimAt, slots.reduce((a, x) => a + x[3].length, 0) + 1, 4)[slots.slice(0, i).reduce((a, x) => a + x[3].length, 0) + j]);
      fact(when, seq => { s.slots.find(x => x.id === sid).claims.push(m); s.revisions.push({seq, at: when, action: 'claim', slot_id: sid, member_id: m, reason: 'claim'}); });
    }));
    return s;
  };
  sheet('s-0011', byTitle(B, 'Block party', '2026'), 'Block party sign-ups', at('2026-06-26', '20:00'),
    [['grill', 'Grill shift', 2, ['m-006', 'm-024']], ['tables', 'Folding tables', 4, ['m-001', 'm-013', 'm-050']], ['games', 'Kids games', 2, ['m-021']]], at('2026-06-08', '10:00'));
  sheet('s-0015', byTitle(G, 'Solstice potluck', '2026'), 'Solstice potluck dishes', at('2026-06-19', '18:00'),
    [['mains', 'Mains', 4, ['m-005', 'm-009']], ['salads', 'Salads', 4, ['m-001', 'm-035', 'm-020']], ['desserts', 'Desserts', 3, ['m-027']]], at('2026-06-02', '09:00'));
  sheet('s-0019', byTitle(B, 'Bulb planting', '2026'), 'Bulb planting supplies', at('2026-10-16', '18:00'),
    [['trowels', 'Trowels', 4, ['m-012', 'm-039']], ['bulbs', 'Bulb pickup', 1, ['m-006']]], at('2026-10-01', '09:00'));
  const s22 = sheet('s-0022', e140, 'Spring cleanup sign-ups', at('2027-03-18', '20:00'),
    [['carpool-1', 'Carpool seat block from the Elm Ave lot (driver 1)', 1, ['m-001']], ['carpool-2', 'Carpool seat block from the Elm Ave lot (driver 2)', 1, ['m-013']],
      ['coffee', 'Coffee urn and cups', 1, ['m-001']], ['snacks', 'Snacks', 2, ['m-013']], ['gloves', 'Spare gloves', 2, ['m-016']], ['bags', 'Extra trash bags', 3, []]],
    at('2027-02-21', '10:00'));
  sheet('s-0024', e117, 'Potluck dishes', at('2027-03-12', '18:00'),
    [['mains', 'Mains', 4, ['m-005', 'm-009', 'm-035']], ['salads', 'Salads', 4, ['m-016', 'm-029']], ['desserts', 'Desserts', 4, ['m-027', 'm-047']], ['drinks', 'Drinks', 3, ['m-039']]],
    at('2027-02-16', '09:00'));
  sheet('s-0026', e121, 'Spring fling helpers', at('2027-03-19', '12:00'),
    [['setup', 'Setup crew (15:00)', 4, ['m-004', 'm-017']], ['pizza', 'Pizza pickup', 1, ['m-010']], ['cleanup', 'Cleanup crew', 4, ['m-002']]], at('2027-02-21', '09:00'));
  // Swaps: one accepted last summer; one pending now (Theo offers snacks for the user's coffee).
  data.swaps.push({id: 'sw-0003', sheet_id: 's-0011', from_member_id: 'm-013', to_member_id: 'm-021', give_slot: 'tables', want_slot: 'games',
    state: 'declined', proposed_at: at('2026-06-15', '18:00'), expires_at: at('2026-06-17', '18:00'), decided_at: at('2026-06-16', '08:00')});
  data.swaps.push({id: 'sw-0005', sheet_id: s22.id, from_member_id: 'm-013', to_member_id: 'm-001', give_slot: 'snacks', want_slot: 'coffee',
    state: 'proposed', proposed_at: at('2027-02-28', '17:30'), expires_at: at('2027-03-02', '17:30'), decided_at: null});

  // ---- Posts ----------------------------------------------------------------
  let postNo = 1;
  const addPost = (g, author, when, text, extra = {}) => {
    const p = {id: 'p-' + pad(postNo++), group_id: g, kind: 'post', audience: 'group', event_id: null, parent_id: null, author_member_id: author,
      text, state: 'published', created_at: when, updated_at: when, revisions: [], ...extra};
    data.posts.push(p);
    fact(when, seq => p.revisions.push({seq, at: when, state: 'published', text}));
    return p;
  };
  const months = [];
  for (let y = 2025, m = 2; y < 2027 || m <= 2; m === 12 ? (y++, m = 1) : m++) months.push(`${y}-${pad(m, 2)}`);
  const background = [];
  for (const month of months) {
    for (const g of [P, G, B, RUN]) {
      const when = iso(K.awakeOn(ms(at(`${month}-${pad(1 + Math.floor(rand() * 27), 2)}`, '12:00'))));
      const pool = members(g, when);
      const k = g + '|' + month.slice(5), n = textUse[k] = (textUse[k] || 0) + 1;
      const text = TEXT.texts[g][month.slice(5)][n - 1];
      if (!text) throw new Error(`no background text ${n} for ${g} in month ${month.slice(5)}`);
      background.push([g, pick(pool), when, text]);
    }
  }
  background.sort((a, b) => ms(a[2]) - ms(b[2]) || a[0].localeCompare(b[0]));
  for (const [g, author, when, text] of background) {
    const p = addPost(g, author, when, text);
    const others = members(g, when).filter(m => m !== author);
    if (rand() < 0.25 && others.length) {
      const pool = others;
      addPost(g, pick(pool), iso(K.between(ms(when) + 20 * 60000, ms(when) + 2 * DAY, x => x * x)), replyText(),
        {kind: 'comment', parent_id: p.id});
    }
  }
  postNo = 300;
  addPost(G, 'm-005', at('2026-10-03', '18:20'), 'Huge thanks to Birdie (Wren on here) for running the seed swap again. The bean jars are on the shed shelf.');
  addPost(B, 'm-006', at('2026-12-05', '10:00'), 'Winter meeting is January 23 at the library. Agenda: the June social and the spring cleanup.', {kind: 'announcement'});
  addPost(B, 'm-001', at('2027-02-10', '20:05'), 'Spring cleanup is March 20. The sign-up sheet for carpools, coffee and supplies is on the event page.', {kind: 'announcement'});
  addPost(G, 'm-005', at('2027-02-16', '09:00'), 'Potluck guests: please bring a serving spoon with your dish. Tables are on me.', {audience: 'event_guests', event_id: 'e-0117'});
  addPost(B, 'm-012', at('2027-02-18', '21:10'), 'Hosts: the city drops off bags and grabbers on the 19th. I will be home to receive them.', {audience: 'hosts_only', event_id: 'e-0140'});
  addPost(P, 'm-002', at('2027-02-21', '07:45'), 'Spring fling RSVPs are open. Babies under two do not need a place, but please count everyone else.');
  addPost(B, 'm-006', at('2027-02-26', '19:30'), 'Thanks to everyone who came to the winter meeting. Notes are on the June social planning event.', {event_id: 'e-0130'});
  data.posts.sort((a, b) => ms(a.created_at) - ms(b.created_at) || a.id.localeCompare(b.id));

  // ---- Commit sequence and deliveries -------------------------------------------
  facts.sort((a, b) => ms(a.at) - ms(b.at) || a.n - b.n);
  let seq = 1;
  for (const f of facts) f.apply(seq++);
  data.next_seq = seq;
  data.events.sort((a, b) => a.id.localeCompare(b.id));
  data.rsvps.sort((a, b) => a.id.localeCompare(b.id));
  // Deliveries are recorded for posts from 2027-01-01 on (older notification
  // history was not imported); recipients follow the app's own audience rule.
  const T = require('../src/transitions.cjs');
  for (const p of data.posts.filter(x => ms(x.created_at) >= ms(at('2027-01-01', '00:00')))) {
    for (const r of T.postRecipients(data, p)) {
      data.deliveries.push({id: 'dl-' + pad(data.deliveries.length + 1), seq: data.next_seq++, at: p.created_at, recipient_member_id: r,
        object_type: 'post', object_id: p.id, channel: p.kind === 'announcement' ? 'email' : 'in_app', reason: p.kind});
    }
  }
  // Renumber every commit-sequenced row in time order, so a delivery follows
  // the post it delivers.
  const rows = [...data.memberships, ...data.events, ...data.rsvps, ...data.posts, ...data.sheets].flatMap(x => x.revisions).concat(data.deliveries);
  rows.sort((a, b) => ms(a.at) - ms(b.at) || a.seq - b.seq).forEach((row, i) => { row.seq = i + 1; });
  data.next_seq = rows.length + 1;

  const binding = {
    people: data.members.map(m => ({person_id: m.person_id, name: PEOPLE.find(x => mid(x[0]) === m.id)[1]})),
    accounts: [
      {app_id: 'stoopside', account_id: 'st-dana', owner_person_id: 'person-dana-okafor'},
      {app_id: 'mail', account_id: 'mail-dana', owner_person_id: 'person-dana-okafor'},
    ],
    objects: {groups: GROUPS.map(g => g.id), events: ['e-0117', 'e-0118', 'e-0121', 'e-0125', 'e-0127', 'e-0130', 'e-0140'], sheets: ['s-0022', 's-0024', 's-0026']},
  };
  return {data, binding};
}

// The manifest seed: Hillcrest, whose clock is the shared apps.registry.json
// time (2026-11-18 09:00 PST), so Core can start it under that registry.
const MANIFEST = 'hillcrest';

// ---- All fixtures ---------------------------------------------------------------
// Maple St is built above (unchanged since M1). Riverside and Hillcrest come
// from scripts/fixture-builder.cjs with the hand-written specs in
// scripts/fixtures/. Each fixture has a binding, a companion Mail seed and a
// hand-written example scenario (examples/scenarios/<key>.json).
const FIXTURES = [
  {key: 'maple-street', seed: 'fixtures/minimal.json', binding: 'fixtures/binding.json', mail: 'fixtures/mail/maple-street.json',
    scenario: 'examples/scenarios/maple-street.json', clock: '2027-03-01T09:00:00-05:00', history_from: '2025-01-06', rng_seed: 20270301,
    tool: 'apps/stoopside/scripts/generate-fixture.cjs',
    description: 'Maple St: a school parents group, a community garden, a block association and a run club. Eastern time (UTC-05:00). The user is Dana Okafor (m-001).'},
  {key: 'riverside', seed: 'fixtures/riverside.json', binding: 'fixtures/riverside.binding.json', mail: 'fixtures/mail/riverside.json',
    scenario: 'examples/scenarios/riverside.json', spec: './fixtures/riverside.cjs', tool: 'apps/stoopside/scripts/fixture-builder.cjs',
    description: 'Riverside: a housing co-op, a kids\' soccer team and a book circle. Central time (UTC-06:00). The user is Nadia Haddad (m-001).'},
  {key: 'hillcrest', seed: 'fixtures/hillcrest.json', binding: 'fixtures/hillcrest.binding.json', mail: 'fixtures/mail/hillcrest.json',
    scenario: 'examples/scenarios/hillcrest.json', spec: './fixtures/hillcrest.cjs', tool: 'apps/stoopside/scripts/fixture-builder.cjs',
    description: 'Hillcrest: a community choir, a dog park group, a cycling club and the library friends. Pacific time (UTC-08:00). The user is Jonah Feld (m-001).'},
];

function buildAll() {
  const B = require('./fixture-builder.cjs');
  return FIXTURES.map(f => {
    if (!f.spec) {
      const {data, binding} = build();
      return {...f, data, bindingData: binding, mailSeed: B.mailSeed({mail: require('./fixtures/maple-street-mail.cjs')}, data)};
    }
    const spec = require(f.spec);
    const out = B.build(spec);
    return {...f, data: out.data, bindingData: out.binding, mailSeed: out.mail, clock: spec.clock, history_from: spec.historyFrom.slice(0, 10), rng_seed: spec.rngSeed};
  });
}

// Provenance recorded for every source (docs/submission-evidence.md section 3).
const PROVENANCE = {
  kind: 'synthetic',
  real_records: 0,
  real_anchor: 'none: no record is collected from a real website or service, and the reviewer confirmed that synthetic data needs no real anchor',
  generation: 'Deterministic Node scripts (this generator, scripts/fixture-builder.cjs and the specs in scripts/fixtures/). No language model is called when the fixtures are generated; the same scripts always produce byte-identical files (a business test fails if a committed file is out of date).',
  language_model_assistance: 'The scripts and their hand-written text (people, display names, bios, group descriptions, event titles, venues and descriptions, key posts, background post texts and replies in scripts/fixtures/text/, Mail threads and scenario events) were written with the help of an AI coding assistant (Claude). Every background text and event description is used once. A fixed-seed generator draws past RSVPs, background members\' join dates, event lead times and RSVP windows, background post dates and authors, with times at waking hours and minute resolution.',
  human_review: 'pending: Rohan Pandey has not yet read every member and event row (see review.status)',
};

function dataset(all, sha, scenarioSha) {
  const counts = f => ({groups: f.data.groups.length, members: f.data.members.length, events: f.data.events.length, rsvps: f.data.rsvps.length,
    posts: f.data.posts.length, sheets: f.data.sheets.length, mail_threads: new Set(f.mailSeed.messages.map(m => m.thread_id)).size,
    mail_messages: f.mailSeed.messages.length});
  return {
    schema_version: 'pale.dataset.v1',
    dataset_id: 'stoopside-community-groups',
    version: '0.4.0',
    description: 'Three synthetic community-group fixtures (Maple St, Riverside, Hillcrest), each with 3-4 groups, 60-90 members, 25-40 events, 6-10 sign-up sheets, RSVP and post history from January 2025, a companion Mail seed and an example scenario. The manifest seed is Hillcrest. For reproducible checks; not a benchmark task. All records are synthetic: no real group, person, post or message is used, nothing was crawled or collected, and there is no real-data anchor (the approved plan has no collection, and the reviewer confirmed that synthetic data is acceptable). Coverage of 2025-01-01 to 2026-12-31 by month and source is in evidence/coverage.md (scripts/coverage-report.cjs).',
    record_source_ids: [MANIFEST],
    sources: all.map(f => ({
      source_id: f.key,
      kind: 'synthetic',
      description: f.description + ' People, groups, events (titles, venues and descriptions), sheets, key posts, background post texts, replies and Mail threads are written by hand; a fixed-seed generator draws past RSVPs, join dates, event lead times and post dates and authors at waking hours. Workflow structure (groups, roles, events, RSVPs, waitlists) follows Meetup\'s public help pages; the claim window, post audiences, child counts, sign-up sheets, member export and view-as are Stoopside\'s own rules.',
      uri: null,
      license: 'CC0-1.0',
      usage: 'permitted',
      collection: null,
      generation: {method: 'scripted', tool: f.tool, tool_version: '0.4.0', seed: f.rng_seed,
        parameters: {provenance: PROVENANCE, fixture: f.seed, fixture_sha256: sha(f.data), binding: f.binding, binding_sha256: sha(f.bindingData), mail_seed: f.mail,
          mail_seed_sha256: sha(f.mailSeed), scenario: f.scenario, scenario_sha256: scenarioSha(f.scenario), history_from: f.history_from, clock: f.clock,
          counts: counts(f)}},
    })),
    transformations: [
      'Each fixture uses one fixed UTC offset (no daylight-saving change); IDs are stable across resets.',
      'Deliveries are recorded only for recent posts (Maple St from 2027-01-01, Riverside from 2026-03-01, Hillcrest from 2026-10-01); older notification history was not imported.',
      'The manifest seed is fixtures/hillcrest.json (clock 2026-11-18 09:00 PST, the shared registry time); Maple St and Riverside load with env.load_seed, their own binding and their own clock (see README). scripts/generate-fixture.cjs --cutoff builds any fixture as a coherent prefix at an earlier clock.',
    ],
    expected_counts: {records: all.find(f => f.key === MANIFEST).data.events.length, assets: 0},
    quality_policy: {duplicate_records: 'reject', duplicate_assets: 'reject', missing_assets: 'allow_declared'},
    review: {status: 'pending', reviewer: null, notes: 'Not yet hand-reviewed. The fixture text was drafted with AI assistance (see each source\'s generation.parameters.provenance); the human read-through of every member and event row by Rohan Pandey, which the approved plan promises, is still pending, as is the clean-checkout reproduction by a second person. Automated checks (scripts/check-fixtures.cjs) do not replace that read.'},
  };
}

const root = path.resolve(__dirname, '..');
function write({check = false} = {}) {
  const all = buildAll();
  const json = value => JSON.stringify(value, null, 2) + '\n';
  const sha = value => require('node:crypto').createHash('sha256').update(json(value)).digest('hex');
  const scenarioSha = file => require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
  const manifest = all.find(f => f.key === MANIFEST);
  const files = {'fixtures/clock.json': {initial_time: manifest.clock}, 'contribution/dataset.json': dataset(all, sha, scenarioSha),
    'fixtures/index.json': {about: 'Generated by scripts/generate-fixture.cjs. One entry per fixture; the manifest seed (app.json) is ' + manifest.seed + ', whose clock is fixtures/clock.json.',
      fixtures: all.map(f => ({key: f.key, seed: f.seed, binding: f.binding, mail_seed: f.mail, scenario: f.scenario, clock: f.clock}))}};
  for (const f of all) Object.assign(files, {[f.seed]: f.data, [f.binding]: f.bindingData, [f.mail]: f.mailSeed});
  for (const [file, value] of Object.entries(files)) {
    const text = json(value), target = path.join(root, file);
    if (check) {
      if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) throw new Error('Fixture is out of date: ' + file);
    } else {
      fs.mkdirSync(path.dirname(target), {recursive: true});
      fs.writeFileSync(target, text);
    }
  }
  return {data: all[0].data, binding: all[0].bindingData, all};
}
module.exports = {build, buildAll, write, FIXTURES};
if (require.main === module) {
  const {all} = write({check: process.argv.includes('--check')});
  for (const f of all) {
    const d = f.data;
    console.log(JSON.stringify({fixture: f.key, members: d.members.length, memberships: d.memberships.length, events: d.events.length, rsvps: d.rsvps.length,
      posts: d.posts.length, sheets: d.sheets.length, deliveries: d.deliveries.length, next_seq: d.next_seq, mail_messages: f.mailSeed.messages.length}));
  }
}
