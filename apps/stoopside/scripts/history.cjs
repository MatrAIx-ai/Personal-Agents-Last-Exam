'use strict';
// History helpers shared by both fixture generators (generate-fixture.cjs for
// Maple St, fixture-builder.cjs for Riverside and Hillcrest):
//   postSchedule   how many background posts a group gets in a month (0 to 3)
//                  and on which days, over the whole month
//   replyCount     how many replies a post gets (most none, some threads of 2-3)
//   pastRsvpCount  how many members answer a past event, scaled to its size
//   fixJoins       moves a join earlier when a hand-written row shows the member
//                  acting in the group before the generated join date
//   changeHistory  later revisions on past records: changed RSVPs, edited and
//                  deleted posts, moved and cancelled events
// Every row these helpers add gets a placeholder commit sequence; the
// generators renumber all rows in time order afterwards.
const DAY = 86400000, HOUR = 3600000, MINUTE = 60000;
const ms = s => Date.parse(s);
const PLACEHOLDER = 1e9;
let placeholder = PLACEHOLDER;
const nextSeq = () => ++placeholder;

// Weighted choice of an index.
function weighted(rand, weights) {
  let x = rand() * weights.reduce((a, b) => a + b, 0), i = 0;
  while (x >= weights[i]) x -= weights[i++];
  return i;
}

// Background posts in one group and month: 0 to 3, mostly 1 or 2, on any day.
// `busy` raises the odds in a group's busy season. Returns instants.
function postSchedule({K, rand, month, offMs, busy = false}) {
  const n = weighted(rand, busy ? [0.08, 0.34, 0.38, 0.2] : [0.18, 0.47, 0.27, 0.08]);
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out = [];
  for (let i = 0; i < n; i++) {
    const day = 1 + Math.floor(rand() * days);
    out.push(K.awakeOn(Date.UTC(y, m - 1, day, 12) - offMs));
  }
  return out.sort((a, b) => a - b);
}

// Replies to one post: about a third get any, a few get a short thread.
const replyCount = rand => weighted(rand, [0.66, 0.2, 0.09, 0.05]);

// Members who answer a past event: scaled to its capacity and the pool, at
// least four when the pool allows.
function pastRsvpCount(rand, capacity, poolSize) {
  const places = capacity * (0.3 + 0.55 * rand());
  return Math.min(poolSize, Math.max(4, Math.round(places / 1.6)));
}

// Last membership state of a member in a group at instant t ('member', 'left',
// 'removed', 'pending' or null before the first row).
function stateAt(m, t) {
  let s = null;
  for (const v of m.revisions) if (ms(v.at) <= t) s = v.state;
  return s;
}

// Moves generated joins earlier where the member acts in the group before the
// join (a hand-written RSVP, claim, post, hosted event or swap). The new join
// is a waking-hours time one to twenty days before the first act, never before
// the group exists; the member record is created before the new first join.
// `everyday` maps member IDs to everyday first names: a post that names a
// member of its group (by that name or the first word of the display name)
// counts as the member being there, as a welcome or a thank-you does.
function fixJoins(data, K, {iso, fixed = () => false, everyday = {}}) {
  const first = new Map();
  const note = (g, m, at) => {
    const k = g + '|' + m, t = ms(at);
    if (!first.has(k) || t < first.get(k)) first.set(k, t);
  };
  const ev = new Map(data.events.map(e => [e.id, e]));
  for (const r of data.rsvps) for (const v of r.revisions) note(ev.get(r.event_id).group_id, r.member_id, v.at);
  for (const e of data.events) for (const h of e.host_member_ids) note(e.group_id, h, e.created_at);
  for (const s of data.sheets) for (const v of s.revisions) note(ev.get(s.event_id).group_id, v.member_id, v.at);
  for (const p of data.posts) note(p.group_id, p.author_member_id, p.created_at);
  const word = n => new RegExp('(^|[^A-Za-z])' + n + '([^A-Za-z]|$)');
  const names = data.members.map(m => [m.id, [...new Set([everyday[m.id], m.display_name.split(' ')[0]].filter(n => n && /^[A-Z][a-z]{2,}$/.test(n)))].map(word)]);
  const mentioned = new Set();
  for (const p of data.posts) for (const [id, res] of names) {
    if (id === p.author_member_id || !res.some(re => re.test(p.text))) continue;
    const m = data.memberships.find(x => x.group_id === p.group_id && x.member_id === id);
    if (!m || fixed(m)) continue;
    note(p.group_id, id, p.created_at);
    mentioned.add(p.group_id + '|' + id);
  }
  for (const w of data.swaps) {
    const g = ev.get(data.sheets.find(s => s.id === w.sheet_id).event_id).group_id;
    note(g, w.from_member_id, w.proposed_at);
  }
  const moved = [];
  for (const m of data.memberships) {
    const act = first.get(m.group_id + '|' + m.member_id);
    if (act === undefined || m.state === 'pending' || ms(m.created_at) < act - 30 * MINUTE) continue;
    if (stateAt(m, act) !== null && stateAt(m, act) !== 'member' && mentioned.has(m.group_id + '|' + m.member_id)) continue;
    if (fixed(m)) throw new Error(`${m.member_id} acts in ${m.group_id} before the fixed join ${m.created_at}`);
    const group = data.groups.find(g => g.id === m.group_id);
    const lo = Math.max(ms(group.created_at) + HOUR, act - 20 * DAY), hi = act - HOUR;
    if (!(hi > lo)) throw new Error(`no room to move ${m.member_id}'s join to ${m.group_id} before ${iso(act)}`);
    const t = iso(K.between(lo, hi));
    moved.push(`${m.member_id} ${m.group_id} ${m.created_at} -> ${t}`);
    m.created_at = t;
    m.revisions[0].at = t;
    for (const v of m.revisions.slice(1)) if (ms(v.at) <= ms(t)) throw new Error(`${m.id} revision ${v.at} precedes the moved join`);
  }
  for (const mem of data.members) {
    const joins = data.memberships.filter(m => m.member_id === mem.id).map(m => ms(m.created_at));
    const firstJoin = Math.min(...joins);
    if (ms(mem.created_at) >= firstJoin - 30 * MINUTE) mem.created_at = iso(K.between(firstJoin - 3 * DAY, firstJoin - 2 * HOUR));
  }
  return moved;
}

// More answers for past events that drew few: members who joined while RSVPs
// were open answer too, until the event reaches its size-scaled share or the
// group runs out of members. New RSVPs are numbered after the last one.
function topUpRsvps(data, {K, rand, iso, clock, children = () => false, skipEvent = () => false}) {
  const user = data.user_member_id;
  let next = Math.max(...data.rsvps.map(r => Number(r.id.slice(2)))) + 1, added = 0;
  const places = r => 1 + r.guests + r.children;
  for (const e of data.events) {
    if (ms(e.start) >= clock || skipEvent(e) || e.state !== 'published') continue;
    const open = ms(e.rsvp_open), close = Math.min(ms(e.rsvp_close), clock);
    const answered = new Set(data.rsvps.filter(r => r.event_id === e.id).map(r => r.member_id));
    const pool = data.memberships.filter(m => m.group_id === e.group_id && m.member_id !== user && !answered.has(m.member_id) && m.state !== 'pending'
      && ms(m.created_at) < close - 12 * HOUR && stateAt(m, close) === 'member').sort((a, b) => a.member_id.localeCompare(b.member_id));
    const target = pastRsvpCount(rand, e.capacity, answered.size + pool.length);
    let taken = data.rsvps.filter(r => r.event_id === e.id && r.answer === 'yes').reduce((a, r) => a + places(r), 0);
    for (const m of pool) {
      if (answered.size >= target) break;
      if (rand() < (e.capacity >= 80 ? 0.1 : 0.35)) continue;
      const lo = Math.max(open, ms(m.created_at) + HOUR);
      const yes = rand() < 0.8, guests = yes ? Math.min(e.guest_limit, Math.floor(rand() * (e.capacity >= 80 ? 3 : 2))) : 0;
      // Families bring children to the big outdoor events of any group.
      const kids = yes && (children(e.group_id) || e.capacity >= 120) ? Math.floor(rand() * 3) : 0;
      if (yes && taken + 1 + guests + kids > e.capacity) continue;
      const at = iso(K.between(lo, close, x => 0.45 * x * x + 0.55 * x));
      const answer = yes ? 'yes' : 'no';
      data.rsvps.push({id: 'r-' + String(next++).padStart(4, '0'), event_id: e.id, member_id: m.member_id, answer, guests, children: kids,
        created_at: at, updated_at: at, waitlisted_at: null, offer_expires_at: null, reconfirm_by: null,
        revisions: [{seq: nextSeq(), at, answer, guests, children: kids, reason: 'rsvp'}]});
      if (yes) taken += 1 + guests + kids;
      answered.add(m.member_id);
      added++;
    }
  }
  data.rsvps.sort((a, b) => a.id.localeCompare(b.id));
  return added;
}

// Later revisions on past records, so history is not a set of single rows.
// `skipPost`, `skipEvent` and `skipRsvp` keep hand-written records unchanged.
function changeHistory(data, {K, rand, iso, clock, edits = {}, skipPost = () => false, skipEvent = () => false, skipRsvp = () => false,
  moves = 2, cancels = 1}) {
  const user = data.user_member_id, out = {rsvps: 0, edited: 0, deleted: 0, moved: [], cancelled: []};
  const ev = new Map(data.events.map(e => [e.id, e]));
  const places = r => 1 + r.guests + r.children;
  const taken = e => data.rsvps.filter(r => r.event_id === e.id && ['yes', 'offered', 'needs_reconfirm'].includes(r.answer)).reduce((a, r) => a + places(r), 0);
  const past = data.events.filter(e => ms(e.start) < clock && !skipEvent(e));

  // Changed RSVPs: about one in eight past answers is revised before RSVPs close.
  for (const r of data.rsvps) {
    const e = ev.get(r.event_id);
    if (r.member_id === user || skipRsvp(r) || !past.includes(e) || r.revisions.length !== 1 || rand() >= 0.13) continue;
    const lo = ms(r.created_at) + 2 * HOUR, hi = Math.min(ms(e.rsvp_close), clock) - HOUR;
    if (!(hi - lo > 6 * HOUR)) continue;
    let next;
    if (r.answer === 'yes') next = rand() < 0.5 ? {answer: 'no', guests: 0, children: 0}
      : {answer: 'yes', guests: r.guests > 0 ? r.guests - 1 : Math.min(e.guest_limit, 1), children: r.children};
    else if (r.answer === 'no') next = {answer: 'yes', guests: 0, children: 0};
    else continue;
    if (next.answer === 'yes' && next.guests === r.guests && r.answer === 'yes') continue;
    const delta = (next.answer === 'yes' ? 1 + next.guests + next.children : 0) - (r.answer === 'yes' ? places(r) : 0);
    if (delta > 0 && taken(e) + delta > e.capacity) continue;
    const at = iso(K.between(lo, hi, x => x * x));
    Object.assign(r, next, {updated_at: at});
    r.revisions.push({seq: nextSeq(), at, ...next, reason: 'rsvp'});
    out.rsvps++;
  }

  // Edited posts: the hand-written edits (original text -> edited text).
  for (const p of data.posts) {
    const text = edits[p.text];
    if (!text || skipPost(p)) continue;
    const at = iso(Math.min(K.between(ms(p.created_at) + 10 * MINUTE, ms(p.created_at) + DAY, x => x * x), clock - HOUR));
    p.text = text; p.state = 'edited'; p.updated_at = at;
    p.revisions.push({seq: nextSeq(), at, state: 'edited', text});
    out.edited++;
  }
  // Deleted posts: a few top-level background posts with no replies, removed
  // by their authors within days.
  const replied = new Set(data.posts.filter(p => p.parent_id).map(p => p.parent_id));
  for (const p of data.posts) {
    if (p.kind !== 'post' || p.parent_id || replied.has(p.id) || p.author_member_id === user || skipPost(p) || p.state !== 'published' || rand() >= 0.035) continue;
    const at = iso(K.between(ms(p.created_at) + HOUR, Math.min(ms(p.created_at) + 5 * DAY, clock - HOUR)));
    p.state = 'deleted'; p.updated_at = at;
    p.revisions.push({seq: nextSeq(), at, state: 'deleted', text: p.text});
    out.deleted++;
  }

  // Moved events: a past event's start and end shift by half an hour or an
  // hour a few days ahead, with the guests told.
  const candidates = past.filter(e => e.revisions.length === 1 && e.state === 'published');
  const chosen = [];
  for (let i = 0; i < moves && candidates.length; i++) chosen.push(candidates.splice(Math.floor(rand() * candidates.length), 1)[0]);
  for (const e of chosen) {
    const shift = [30, -30, 60, 30][Math.floor(rand() * 4)] * MINUTE;
    const lo = ms(e.created_at) + DAY, hi = Math.min(ms(e.start) - DAY, ms(e.rsvp_close) - HOUR);
    if (!(hi > lo)) continue;
    const at = iso(K.between(lo, hi));
    const off = e.start.slice(19);
    const shiftIso = t => iso(ms(t) + shift).slice(0, 19) + off;
    const fields = {start: shiftIso(e.start), end: shiftIso(e.end)}, previous = {start: e.start, end: e.end};
    if (!(ms(e.rsvp_close) <= ms(fields.end))) continue;
    Object.assign(e, fields);
    e.revisions.push({seq: nextSeq(), at, action: 'edited', state: 'published', fields, notify: 'guests', actor: e.created_by, previous});
    out.moved.push(e.id);
  }
  // Cancelled events: a small past event called off after its last answer.
  const small = candidates.filter(e => e.capacity <= 40 && !data.sheets.some(s => s.event_id === e.id)
    && !data.rsvps.some(r => r.event_id === e.id && r.member_id === user) && !data.posts.some(p => p.event_id === e.id));
  for (let i = 0; i < cancels && small.length; i++) {
    const e = small.splice(Math.floor(rand() * small.length), 1)[0];
    const last = Math.max(ms(e.created_at), ...data.rsvps.filter(r => r.event_id === e.id).flatMap(r => r.revisions.map(v => ms(v.at))));
    const hi = Math.min(ms(e.start) - 2 * HOUR, ms(e.rsvp_close));
    if (!(hi - last > 3 * HOUR)) { i--; continue; }
    const at = iso(K.between(last + HOUR, hi));
    e.state = 'cancelled';
    e.revisions.push({seq: nextSeq(), at, action: 'cancelled', state: 'cancelled', fields: {}, notify: 'guests', actor: e.created_by, previous: {}});
    out.cancelled.push(e.id);
  }
  return out;
}

module.exports = {postSchedule, replyCount, pastRsvpCount, fixJoins, topUpRsvps, changeHistory, stateAt, weighted, DAY, HOUR, MINUTE};
