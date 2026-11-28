'use strict';
// Deterministic fixture builder shared by the Riverside and Hillcrest fixtures
// (scripts/fixtures/*.cjs). A spec lists people, groups, events, sheets, swaps,
// key posts and the companion Mail threads by hand, and scripts/fixtures/text/
// holds the background texts, replies and past-event descriptions (each used
// once); past RSVPs, background members' group joins, event lead times and the
// monthly background post dates come from a fixed-seed generator with
// waking-hours times (see timeKit). The Maple St fixture keeps
// its own generator (scripts/generate-fixture.cjs), which uses the same
// helpers.
//
// Every history row gets a commit sequence number in time order, so the
// visibility record replays the history in the order it happened.

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

const DAY = 86400000, HOUR = 3600000;
const pad = (n, w = 4) => String(n).padStart(w, '0');
const ms = s => Date.parse(s);
const ascii = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const emailOf = everyday => ascii(everyday).toLowerCase().replace(/[^a-z ]/g, '').trim().split(/\s+/).join('.') + '@example.net';
const personOf = everyday => 'person-' + ascii(everyday).toLowerCase().replace(/[^a-z ]/g, '').trim().split(/\s+/).join('-');
const mid = n => 'm-' + pad(n, 3);

// When people act in a group app, by local hour: almost nothing overnight,
// a morning rise, a lunch bump and the evening peak. Minutes are uniform.
const HOUR_WEIGHTS = [0, 0, 0, 0, 0, 0, 0.15, 0.6, 1.0, 1.0, 0.9, 0.9, 1.2, 1.0, 0.8, 0.8, 0.9, 1.1, 1.4, 1.6, 1.7, 1.4, 0.8, 0.3];
const WEIGHT_SUM = HOUR_WEIGHTS.reduce((a, b) => a + b, 0);

// Time helpers over a fixed-seed PRNG and a fixed UTC offset (in ms).
function timeKit(rand, offMs) {
  const minuteOfDay = () => {
    let x = rand() * WEIGHT_SUM, h = 0;
    while (x >= HOUR_WEIGHTS[h]) x -= HOUR_WEIGHTS[h++];
    return h * 60 + Math.floor(rand() * 60);
  };
  const midnight = t => Math.floor((t + offMs) / DAY) * DAY - offMs;
  // A waking-hours instant on the local day that contains t.
  const awakeOn = t => midnight(t) + minuteOfDay() * 60000;
  // A waking-hours instant strictly between lo and hi, with the day drawn by
  // `shape` (a map from [0,1) to [0,1)). Short or night-only windows fall back
  // to a uniform minute inside the window.
  const between = (lo, hi, shape = x => x) => {
    for (let i = 0; i < 12; i++) {
      const t = awakeOn(lo + shape(rand()) * (hi - lo));
      if (t > lo && t < hi) return t;
    }
    return lo + Math.max(1, Math.floor(rand() * Math.max(1, (hi - lo) / 60000))) * 60000;
  };
  const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
  // Event lead times vary: big events are posted weeks ahead, small ones days
  // to a few weeks. RSVPs open when the event is posted or a few days later
  // and close a few hours to two days before the start. A hand-written user
  // RSVP (userAt) must fall inside the window.
  // `floor` is the earliest instant the event can be posted: after the group
  // exists and its host has joined.
  const eventWindow = (start, capacity, userAt, floor = -Infinity) => {
    const lead = (capacity >= 80 ? int(24, 55) : int(7, 30)) * DAY;
    let open = awakeOn(start - lead);
    if (open < floor + HOUR) open = between(floor + HOUR, Math.max(floor + 2 * HOUR, Math.min(start - 3 * DAY, floor + 4 * DAY)));
    if (userAt && open >= userAt - HOUR) open = between(Math.max(floor + HOUR, userAt - int(3, 9) * DAY), userAt - HOUR);
    let created = rand() < 0.55 ? open - int(0, 40) * 60000 : awakeOn(open - int(1, 4) * DAY);
    if (created < floor) created = between(floor, open);
    const close = start - [2, 3, 6, 12, 24, 24, 24, 48][Math.floor(rand() * 8)] * HOUR;
    return {created, open, close};
  };
  // Most answers come in the first days after RSVPs open; a second, smaller
  // wave comes in the last days before they close.
  const answerTime = (w, clock) => {
    const hi = Math.min(w.close, clock);
    return rand() < 0.7 ? between(w.open, hi, x => 0.45 * x * x) : between(w.open, hi, x => 0.6 + 0.4 * x);
  };
  return {minuteOfDay, midnight, awakeOn, between, int, eventWindow, answerTime};
}

const H = require('./history.cjs');
function shuffleWith(r, list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function build(spec) {
  // Each build uses the texts from the start (a process may build twice).
  for (const k of [...textUse.keys()]) if (k.startsWith(spec.key + '|')) textUse.delete(k);
  const rand = rng(spec.rngSeed);
  const pick = list => list[Math.floor(rand() * list.length)];
  const shuffle = list => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  const OFF = spec.offset;
  const offMs = (OFF[0] === '-' ? -1 : 1) * (Number(OFF.slice(1, 3)) * 60 + Number(OFF.slice(4, 6))) * 60000;
  const at = (date, time = '09:00') => `${date}T${time}:00${OFF}`;
  const iso = t => new Date(t + offMs).toISOString().slice(0, 19) + OFF;
  const clock = ms(spec.clock);
  const K = timeKit(rand, offMs);
  const description = (g, date, title) => {
    const d = (spec.descriptions || {})[g + '|' + date];
    if (!d) throw new Error(`${spec.key}: no description for ${g} ${date} ${title}`);
    return d;
  };

  const data = {account_id: spec.account_id, owner_person_id: personOf(spec.people.find(p => p[0] === 1)[1]), user_member_id: 'm-001', next_seq: 1,
    groups: [], members: [], memberships: [], events: [], rsvps: [], posts: [], digests: [], sheets: [], swaps: [],
    deliveries: [], previews: [], notices: []};
  const facts = [];
  const fact = (when, apply) => {
    if (ms(when) > clock) throw new Error(`${spec.key}: history row at ${when} is after the clock`);
    facts.push({at: when, n: facts.length, apply});
  };

  for (const g of spec.groups) {
    data.groups.push({id: g.id, name: g.name, description: g.description, utc_offset: OFF, tz_label: spec.tz,
      requires_approval: g.requires_approval, hide_from_member_list: g.hide_from_member_list, hide_rsvps: g.hide_rsvps,
      created_at: at(g.created, '12:00'), digest_through: spec.digestThrough});
  }
  const groupCreated = id => ms(at(spec.groups.find(g => g.id === id).created, '12:00'));

  // ---- Members and memberships ----------------------------------------------
  const joinedAt = {};
  for (const [n, everyday, display, bio, groups, opts = {}] of spec.people) {
    const id = mid(n);
    const first = Math.min(...Object.keys(groups).map(groupCreated));
    data.members.push({id, display_name: display, bio, email: emailOf(everyday), person_id: personOf(everyday), created_at: iso(K.between(first - 3 * DAY, first - 2 * HOUR))});
    for (const [g, role] of Object.entries(groups)) {
      let joined;
      if (opts.joined?.[g]) joined = at(...opts.joined[g].split(' '));
      else if (role === 'organizer') joined = iso(groupCreated(g) + 30 * 60000);
      else {
        // Hosts join in the group's first weeks. Members: about half in the
        // first months, the rest at any time up to a few weeks before the clock.
        const span = role === 'member' ? spec.joinSpanDays || 300 : 30;
        const late = (clock - groupCreated(g)) / DAY - 21;
        const day = role === 'member' && rand() < 0.45 && late > span ? span + Math.floor(rand() * (late - span)) : 1 + Math.floor(rand() * span);
        joined = iso(K.awakeOn(groupCreated(g) + day * DAY));
        // A member who later leaves joined at least a month before leaving
        // (whole days earlier, so the minute of day stays the drawn one).
        const leave = (spec.leavers || []).find(([lg, ln]) => lg === g && mid(ln) === id);
        if (leave) {
          const by = ms(at(...leave[2].split(' '))) - 30 * DAY;
          if (ms(joined) > by) joined = iso(ms(joined) - Math.ceil((ms(joined) - by) / DAY) * DAY);
        }
      }
      joinedAt[g + '|' + id] = joined;
      const row = {id: 'ms-' + pad(data.memberships.length + 1), group_id: g, member_id: id, state: 'member',
        role: role === 'organizer' ? 'organizer' : 'member', created_at: joined, revisions: []};
      data.memberships.push(row);
      fact(joined, seq => row.revisions.push({seq, at: joined, state: 'member', role: row.role, reason: 'joined'}));
      if (role !== 'member' && role !== 'organizer') {
        const promoted = opts.promoted?.[g] ? at(...opts.promoted[g].split(' ')) : iso(K.awakeOn(ms(joined) + K.int(12, 75) * DAY));
        fact(promoted, seq => { row.role = role; row.revisions.push({seq, at: promoted, state: 'member', role, reason: 'promoted'}); });
      }
    }
  }
  const ended = {};
  for (const [g, n, when, state] of spec.leavers || []) {
    const m = data.memberships.find(x => x.group_id === g && x.member_id === mid(n));
    const t = at(...when.split(' '));
    ended[g + '|' + mid(n)] = ms(t);
    fact(t, seq => { m.state = state; m.revisions.push({seq, at: t, state, role: m.role, reason: state === 'left' ? 'left' : 'removed'}); });
  }
  for (const [g, when] of spec.pending || []) {
    const t = at(...when.split(' '));
    const row = {id: 'ms-' + pad(data.memberships.length + 1), group_id: g, member_id: 'm-001', state: 'pending', role: 'member', created_at: t, revisions: []};
    data.memberships.push(row);
    fact(t, seq => row.revisions.push({seq, at: t, state: 'pending', role: 'member', reason: 'join'}));
  }
  // Members of a group at an instant (pending requests excluded).
  const members = (g, when) => data.memberships.filter(m => m.group_id === g && m.state !== 'pending' &&
    ms(m.created_at) <= ms(when) && !(ended[g + '|' + m.member_id] <= ms(when))).map(m => m.member_id);
  const organizer = g => data.memberships.find(m => m.group_id === g && m.role === 'organizer').member_id;

  // ---- Events and RSVPs --------------------------------------------------------
  // Past RSVPs are numbered from r-1001, apart from the hand-written ones.
  let eventNo = spec.firstEventNo, rsvpNo = 1001;
  const addEvent = e => {
    data.events.push(e);
    fact(e.created_at, seq => e.revisions.push({seq, at: e.created_at, action: 'created', state: 'published', fields: {}, notify: null, actor: e.created_by}));
    return e;
  };
  const addRsvp = (e, member, answer, guests, children, when) => {
    const r = {id: 'r-' + pad(rsvpNo++), event_id: e.id, member_id: member, answer, guests, children, created_at: when, updated_at: when,
      waitlisted_at: answer === 'waitlist' ? when : null, offer_expires_at: null, reconfirm_by: null, revisions: []};
    data.rsvps.push(r);
    fact(when, seq => r.revisions.push({seq, at: when, answer, guests, children, reason: 'rsvp'}));
    return r;
  };
  const past = [...spec.past].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  for (const [g, date, start, hours, title, venue, capacity, guestLimit, opts = {}] of past) {
    const s = at(date, start), host = opts.host ? mid(opts.host) : organizer(g);
    const mine = (spec.userPast || []).find(([ug, ud]) => ug === g && ud === date);
    const floor = Math.max(groupCreated(g) + DAY, ms(joinedAt[g + '|' + host]) + HOUR);
    const w = K.eventWindow(ms(s), capacity, mine && ms(at(...mine[4].split(' '))), floor);
    const e = addEvent({id: 'e-' + pad(eventNo++), group_id: g, title, description: opts.description || description(g, date, title), start: s,
      end: iso(ms(s) + hours * HOUR), venue, capacity, guest_limit: guestLimit, rsvp_open: iso(w.open),
      rsvp_close: iso(w.close), host_member_ids: [host], state: 'published', created_by: host, created_at: iso(w.created), revisions: []});
    const reserve = mine ? 1 + mine[2] + mine[3] : 0;
    const pool = members(g, e.rsvp_open).filter(m => m !== 'm-001');
    const count = H.pastRsvpCount(rand, capacity, pool.length);
    let used = 0;
    for (const m of shuffle(pool).slice(0, count).sort()) {
      const yes = rand() < 0.8, guests = yes ? Math.min(guestLimit, Math.floor(rand() * (capacity >= 80 ? 3 : 2))) : 0;
      const children = yes && spec.childGroups.includes(g) ? Math.floor(rand() * 3) : 0;
      if (yes && used + 1 + guests + children > capacity - reserve) continue;
      const when = iso(K.answerTime(w, clock));
      if (ended[g + '|' + m] <= ms(when)) continue;   // left the group before answering
      if (yes) used += 1 + guests + children;
      addRsvp(e, m, yes ? 'yes' : 'no', guests, children, when);
    }
    if (mine) {
      if (used + 1 + mine[2] + mine[3] > capacity) throw new Error(`${spec.key}: user RSVP does not fit ${e.id}`);
      addRsvp(e, 'm-001', 'yes', mine[2], mine[3], at(...mine[4].split(' ')));
    }
  }
  if ((spec.userPast || []).some(([ug, ud]) => !past.some(p => p[0] === ug && p[1] === ud))) throw new Error(`${spec.key}: user RSVP names no past event`);

  rsvpNo = spec.upcomingRsvpNo;
  for (const u of spec.upcoming) {
    const e = addEvent({id: u.id, group_id: u.g, title: u.title, description: u.description, start: u.start, end: u.end, venue: u.venue,
      capacity: u.capacity, guest_limit: u.guest_limit, rsvp_open: u.open, rsvp_close: u.close, host_member_ids: u.hosts.map(mid),
      state: 'published', created_by: mid(u.hosts[0]), created_at: u.created, revisions: []});
    // Hand-written answers keep their order; times without one are spread at
    // waking hours over the span the order covers.
    const lo = ms(u.open) + 3 * HOUR, hi = Math.min(lo + Math.max(1, u.rsvps.length - 1) * (u.stepHours || 7) * HOUR, clock);
    const times = u.rsvps.map(() => K.between(lo - 1, hi)).sort((a, b) => a - b);
    u.rsvps.forEach(([n, answer, guests, children, when], i) =>
      addRsvp(e, mid(n), answer, guests, children, when || iso(times[i])));
  }

  // ---- Sign-up sheets and swaps -------------------------------------------------
  const eventRef = ref => typeof ref === 'string' ? ref : data.events.find(e => e.group_id === ref[0] && e.title === ref[1] && e.start.startsWith(ref[2])).id;
  for (const [id, ref, title, lock, slots, claimAt] of spec.sheets) {
    const s = {id, event_id: eventRef(ref), title, lock_at: lock, slots: slots.map(([sid, label, q]) => ({id: sid, label, quantity: q, claims: []})), revisions: []};
    data.sheets.push(s);
    const total = slots.reduce((a, x) => a + x[3].length, 0);
    // Claims start once the event is posted (and not before the spec's date).
    const lo = Math.max(ms(claimAt), ms(data.events.find(e => e.id === s.event_id).created_at) + 2 * HOUR);
    const times = Array.from({length: total}, () => K.between(lo - 1, Math.min(lo + Math.max(1, total) * 4 * HOUR, ms(lock), clock))).sort((a, b) => a - b);
    let k = 0;
    slots.forEach(([sid, , , claims]) => claims.forEach(n => {
      const when = iso(times[k++]);
      fact(when, seq => { s.slots.find(x => x.id === sid).claims.push(mid(n)); s.revisions.push({seq, at: when, action: 'claim', slot_id: sid, member_id: mid(n), reason: 'claim'}); });
    }));
  }
  for (const w of spec.swaps || []) {
    data.swaps.push({id: w.id, sheet_id: w.sheet_id, from_member_id: mid(w.from), to_member_id: mid(w.to), give_slot: w.give_slot, want_slot: w.want_slot,
      state: w.state, proposed_at: w.proposed_at, expires_at: w.expires_at, decided_at: w.decided_at});
  }

  // ---- Posts -------------------------------------------------------------------
  let postNo = 1;
  const addPost = (g, author, when, text, extra = {}) => {
    const p = {id: 'p-' + pad(postNo++), group_id: g, kind: 'post', audience: 'group', event_id: null, parent_id: null, author_member_id: author,
      text, state: 'published', created_at: when, updated_at: when, revisions: [], ...extra};
    data.posts.push(p);
    fact(when, seq => p.revisions.push({seq, at: when, state: 'published', text}));
    return p;
  };
  const months = [];
  for (let t = ms(spec.historyFrom); t < clock; ) {
    const d = new Date(t);
    months.push(d.toISOString().slice(0, 7));
    t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  const background = [];
  // Replies come from the spec's pool without repeats until it runs out.
  let replyPool = [];
  // The reply order has its own PRNG, so the size of the pool never changes
  // the dates and authors drawn from the main one.
  const replyRand = rng(spec.rngSeed + 7);
  let replyRound = 0;
  const replyText = () => {
    if (!replyPool.length) {
      if (replyRound++ && !process.env.STOOPSIDE_TEXT_NEEDS) throw new Error(`${spec.key}: the reply pool (${spec.replies.length}) is used up`);
      if (replyRound > 1) NEEDS.push(`${spec.key} reply beyond ${spec.replies.length}`);
      replyPool = shuffleWith(replyRand, spec.replies);
    }
    return replyPool.pop();
  };
  for (const month of months) {
    for (const g of spec.groups.map(x => x.id)) {
      for (const t of H.postSchedule({K, rand, month, offMs, busy: (spec.busy?.[g] || []).includes(month.slice(5))})) {
        const when = iso(t);
        if (ms(when) < groupCreated(g) + DAY || ms(when) >= clock - DAY) continue;
        const pool = members(g, when);
        if (pool.length) background.push([g, pick(pool), when, monthText(spec, g, month)]);
      }
    }
  }
  background.sort((a, b) => ms(a[2]) - ms(b[2]) || a[0].localeCompare(b[0]));
  for (const [g, author, when, text] of background) {
    const p = addPost(g, author, when, text);
    let last = ms(when), people = members(g, when).filter(m => m !== author);
    for (let i = H.replyCount(rand); i > 0 && people.length; i--) {
      // A later reply is sometimes the post's author answering.
      const who = i < 3 && rand() < 0.3 && last !== ms(when) ? author : pick(people);
      const reply = K.between(last + 10 * 60000, last + (last === ms(when) ? 2 : 1.5) * DAY, x => x * x);
      if (reply >= clock) break;
      addPost(g, who, iso(reply), replyText(), {kind: 'comment', parent_id: p.id});
      people = people.filter(m => m !== who);
      last = reply;
    }
  }
  if (postNo > spec.firstPostNo) throw new Error(`${spec.key}: background posts reach p-${pad(postNo)}, past firstPostNo`);
  postNo = spec.firstPostNo;
  for (const [g, n, when, text, extra = {}] of spec.posts) {
    const x = {...extra};
    if (x.parent) { x.parent_id = x.parent; x.kind = 'comment'; delete x.parent; }
    addPost(g, mid(n), when, text, x);
  }
  data.posts.sort((a, b) => ms(a.created_at) - ms(b.created_at) || a.id.localeCompare(b.id));

  // ---- Commit sequence and deliveries -------------------------------------------
  facts.sort((a, b) => ms(a.at) - ms(b.at) || a.n - b.n);
  let seq = 1;
  for (const f of facts) f.apply(seq++);
  data.next_seq = seq;
  data.events.sort((a, b) => a.id.localeCompare(b.id));
  data.rsvps.sort((a, b) => a.id.localeCompare(b.id));
  const handEvents = new Set(spec.upcoming.map(u => u.id));
  const fixedJoin = m => Boolean(spec.people.find(x => mid(x[0]) === m.member_id)?.[5]?.joined?.[m.group_id]);
  H.fixJoins(data, K, {iso, fixed: fixedJoin, everyday: Object.fromEntries(spec.people.map(x => [mid(x[0]), x[1].split(' ')[0]]))});
  H.topUpRsvps(data, {K, rand, iso, clock, children: g => spec.childGroups.includes(g),
    skipEvent: e => handEvents.has(e.id) || data.sheets.some(s => s.event_id === e.id)});
  H.changeHistory(data, {K, rand, iso, clock, edits: spec.edits || {},
    skipPost: p => Number(p.id.slice(2)) >= spec.firstPostNo, skipEvent: e => handEvents.has(e.id) || data.sheets.some(s => s.event_id === e.id),
    skipRsvp: r => Number(r.id.slice(2)) < 1001});
  // Deliveries are recorded for posts from spec.deliveriesFrom on; older
  // notification history was not imported. Recipients follow the app's own rule.
  const T = require('../src/transitions.cjs');
  for (const p of data.posts.filter(x => ms(x.created_at) >= ms(spec.deliveriesFrom))) {
    for (const r of T.postRecipients(data, p)) {
      data.deliveries.push({id: 'dl-' + pad(data.deliveries.length + 1), seq: data.next_seq++, at: p.created_at, recipient_member_id: r,
        object_type: 'post', object_id: p.id, channel: p.kind === 'announcement' ? 'email' : 'in_app', reason: p.kind});
    }
  }
  const rows = [...data.memberships, ...data.events, ...data.rsvps, ...data.posts, ...data.sheets].flatMap(x => x.revisions).concat(data.deliveries);
  rows.sort((a, b) => ms(a.at) - ms(b.at) || a.seq - b.seq).forEach((row, i) => { row.seq = i + 1; });
  data.next_seq = rows.length + 1;

  const binding = {
    people: data.members.map(m => ({person_id: m.person_id, name: spec.people.find(x => mid(x[0]) === m.id)[1]})),
    accounts: [
      {app_id: 'stoopside', account_id: spec.account_id, owner_person_id: data.owner_person_id},
      {app_id: 'mail', account_id: spec.mail.account_id, owner_person_id: data.owner_person_id},
    ],
    objects: {groups: spec.groups.map(g => g.id), events: spec.upcoming.map(u => u.id), sheets: spec.sheets.map(s => s[0]).filter(id => {
      const s = data.sheets.find(x => x.id === id);
      return ms(s.lock_at) > clock;
    })},
  };
  return {data, binding, mail: mailSeed(spec, data)};
}

// Background text for a group in a month: spec.texts[group] lists, for each
// month of the year ('01' to '12'), one text per year the history covers, so
// no text recurs.
const textUse = new Map(), NEEDS = [];
function monthText(spec, g, month) {
  const key = spec.key + '|' + g + '|' + month.slice(5);
  const n = textUse.get(key) || 0;
  textUse.set(key, n + 1);
  const t = spec.texts[g][month.slice(5)]?.[n];
  if (!t) {
    if (process.env.STOOPSIDE_TEXT_NEEDS) { NEEDS.push(`${spec.key} ${g} ${month.slice(5)} #${n + 1}`); return `NEEDED ${spec.key} ${g} ${month} ${n + 1}`; }
    throw new Error(`${spec.key}: no background text ${n + 1} for ${g} in month ${month.slice(5)}`);
  }
  return t;
}

// The companion Mail seed: the user's mailbox before the clock. Threads are
// written by hand in the spec; message IDs are derived from thread IDs.
function mailSeed(spec, data) {
  const user = data.members.find(m => m.id === 'm-001');
  const messages = [];
  for (const t of spec.mail.threads) {
    t.messages.forEach((m, i) => {
      const address = x => (x === 'me' ? user.email : typeof x === 'string' ? x : data.members.find(y => y.id === mid(x)).email);
      const from = address(m.from), to = (m.to || ['me']).map(address);
      messages.push({id: `${t.id}-${i + 1}`, thread_id: t.id, account_id: spec.mail.account_id, from, to, subject: (i ? 'Re: ' : '') + t.subject,
        body: m.body, received_at: m.at, folder: m.from === 'me' ? 'sent' : (t.folder || 'inbox'), read: m.read !== false, attachments: []});
    });
  }
  messages.sort((a, b) => ms(a.received_at) - ms(b.received_at) || a.id.localeCompare(b.id));
  return {account_id: spec.mail.account_id, owner_person_id: data.owner_person_id, address: user.email, messages};
}

module.exports = {build, mailSeed, rng, timeKit, monthText, emailOf, personOf, mid, pad, NEEDS, shuffleWith};
