'use strict';
// The visibility function and the visibility record.
//
// canSee(world, member_id, ref) is the one rule for who can see a group, event,
// post or sheet. `world` answers questions about memberships, RSVP answers,
// posts and events at one point in history:
//
//   - currentWorld(data) answers them for the current committed state. Tools
//     (posts.list, events.list, visibility.view_as) use it.
//   - record(data) replays the committed history in commit-sequence order and
//     calls canSee after every change, which yields, for each object and
//     member, the intervals in which the object was visible, plus every delivery.
//
// Rules (also on the help page):
//   group  - every group is listed to everyone (discovery).
//   event  - members of its group (membership state `member`).
//   sheet  - whoever can see its event.
//   post   - members of its group, while the post and its root are not
//            deleted, and by audience: `group` everyone; `hosts_only` group
//            hosts (organizer, co-organizer, event host); `event_guests` the
//            event's hosts and members whose RSVP is `yes` or
//            `needs_reconfirm` at that moment. Comments use their root's
//            audience; announcements are always `group`. The author of a post,
//            and the author of a comment's root post, always see it.
//
// Agent reads and writes do not move the clock, so an interval can start and
// end at the same clock time. Intervals are bounded by commit sequence numbers
// (from_seq inclusive, to_seq exclusive); every interval in the record spans
// at least one committed state, and any interval counts as shown.
const R = require('./rules.cjs');

function isMember(world, groupId, memberId) {
  const m = world.membership(groupId, memberId);
  return Boolean(m && m.state === 'member');
}

function rootPost(world, p) {
  let x = p;
  for (let i = 0; x && x.parent_id && i < 20; i++) x = world.post(x.parent_id);
  return x;
}

function canSee(world, memberId, ref) {
  if (ref.type === 'group') return world.group(ref.id) !== null;
  if (ref.type === 'event') {
    const e = world.event(ref.id);
    return Boolean(e) && isMember(world, e.group_id, memberId);
  }
  if (ref.type === 'sheet') {
    const s = world.sheet(ref.id);
    return Boolean(s) && canSee(world, memberId, {type: 'event', id: s.event_id});
  }
  if (ref.type !== 'post') return false;
  const p = world.post(ref.id);
  if (!p || p.state === 'deleted') return false;
  const root = rootPost(world, p);
  if (!root || root.state === 'deleted' || !isMember(world, p.group_id, memberId)) return false;
  if (p.author_member_id === memberId || root.author_member_id === memberId) return true;
  const audience = root.kind === 'announcement' ? 'group' : root.audience;
  if (audience === 'group') return true;
  if (audience === 'hosts_only') return R.isGroupHost(world.membership(p.group_id, memberId).role);
  const e = world.event(root.event_id);
  return Boolean(e) && (e.host_member_ids.includes(memberId) || R.GUEST.has(world.rsvpAnswer(e.id, memberId)));
}

// Guest lists follow the event, and hide_rsvps limits them to the event's
// hosts and the group's organizers and co-organizers.
function canSeeGuests(world, memberId, eventId) {
  if (!canSee(world, memberId, {type: 'event', id: eventId})) return false;
  const e = world.event(eventId), g = world.group(e.group_id);
  if (!g.hide_rsvps) return true;
  const role = world.membership(e.group_id, memberId).role;
  return e.host_member_ids.includes(memberId) || R.rank(role) >= R.rank('co_organizer');
}

// Organizers and co-organizers always see the member directory; others only
// when hide_from_member_list is off.
function canSeeDirectory(world, memberId, groupId) {
  if (!isMember(world, groupId, memberId)) return false;
  const g = world.group(groupId), role = world.membership(groupId, memberId).role;
  return !g.hide_from_member_list || R.rank(role) >= R.rank('co_organizer');
}

function currentWorld(data) {
  const groups = new Map(data.groups.map(g => [g.id, g]));
  const events = new Map(data.events.map(e => [e.id, e]));
  const posts = new Map(data.posts.map(p => [p.id, p]));
  const sheets = new Map(data.sheets.map(s => [s.id, s]));
  const memberships = new Map(data.memberships.map(m => [m.group_id + '|' + m.member_id, m]));
  const rsvps = new Map(data.rsvps.map(r => [r.event_id + '|' + r.member_id, r]));
  return {
    group: id => groups.get(id) || null,
    event: id => events.get(id) || null,
    post: id => posts.get(id) || null,
    sheet: id => sheets.get(id) || null,
    membership: (g, m) => memberships.get(g + '|' + m) || null,
    rsvpAnswer: (e, m) => rsvps.get(e + '|' + m)?.answer || null,
  };
}

// ---- The visibility record --------------------------------------------------

function facts(data) {
  const out = [];
  for (const m of data.memberships) for (const v of m.revisions) out.push({seq: v.seq, at: v.at, kind: 'membership', record: m, v});
  for (const r of data.rsvps) for (const v of r.revisions) out.push({seq: v.seq, at: v.at, kind: 'rsvp', record: r, v});
  for (const p of data.posts) for (const v of p.revisions) out.push({seq: v.seq, at: v.at, kind: 'post', record: p, v});
  for (const e of data.events) for (const v of e.revisions) out.push({seq: v.seq, at: v.at, kind: 'event', record: e, v});
  return out.sort((a, b) => a.seq - b.seq);
}

function record(data) {
  const groups = new Map(data.groups.map(g => [g.id, g]));
  const events = new Map(), posts = new Map(), memberships = new Map(), rsvps = new Map();
  const sheetsByEvent = new Map(), sheetIndex = new Map(data.sheets.map(s => [s.id, s]));
  for (const s of data.sheets) sheetsByEvent.set(s.event_id, [...(sheetsByEvent.get(s.event_id) || []), s.id]);
  const world = {
    group: id => groups.get(id) || null,
    event: id => events.get(id) || null,
    post: id => posts.get(id) || null,
    sheet: id => (sheetIndex.has(id) && events.has(sheetIndex.get(id).event_id) ? sheetIndex.get(id) : null),
    membership: (g, m) => memberships.get(g + '|' + m) || null,
    rsvpAnswer: (e, m) => rsvps.get(e + '|' + m) || null,
  };
  const groupMembers = new Map();   // group -> member IDs with any membership row so far
  const groupObjects = new Map();   // group -> object refs created so far
  const byRootEvent = new Map();    // event -> post IDs whose root post is on it
  const descendants = new Map();    // post -> comment IDs
  const rows = new Map();
  const add = (map, key, value) => { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(value); };
  const row = (ref, m) => {
    const key = ref.type + ':' + ref.id + '|' + m;
    if (!rows.has(key)) rows.set(key, {object_type: ref.type, object_id: ref.id, member_id: m, intervals: [], deliveries: []});
    return rows.get(key);
  };
  const open = new Map();
  function evaluate(ref, m, f) {
    const key = ref.type + ':' + ref.id + '|' + m, visible = canSee(world, m, ref), current = open.get(key);
    if (visible && !current) {
      const interval = {from: f.at, from_seq: f.seq, to: null, to_seq: null};
      row(ref, m).intervals.push(interval);
      open.set(key, interval);
    } else if (!visible && current) {
      current.to = f.at;
      current.to_seq = f.seq;
      open.delete(key);
    }
  }
  const subtree = id => [id, ...[...(descendants.get(id) || [])].flatMap(subtree)];
  for (const f of facts(data)) {
    const rec = f.record;
    let refs = [], who = [];
    if (f.kind === 'membership') {
      memberships.set(rec.group_id + '|' + rec.member_id, {state: f.v.state, role: f.v.role});
      add(groupMembers, rec.group_id, rec.member_id);
      refs = [...(groupObjects.get(rec.group_id) || [])];
      who = [rec.member_id];
    } else if (f.kind === 'rsvp') {
      rsvps.set(rec.event_id + '|' + rec.member_id, f.v.answer);
      refs = [...(byRootEvent.get(rec.event_id) || [])].map(id => ({type: 'post', id}));
      who = [rec.member_id];
    } else if (f.kind === 'event') {
      if (!events.has(rec.id)) {
        add(groupObjects, rec.group_id, {type: 'event', id: rec.id});
        for (const s of sheetsByEvent.get(rec.id) || []) add(groupObjects, rec.group_id, {type: 'sheet', id: s});
      }
      events.set(rec.id, {id: rec.id, group_id: rec.group_id, host_member_ids: rec.host_member_ids, state: f.v.state});
      refs = [{type: 'event', id: rec.id}, ...(sheetsByEvent.get(rec.id) || []).map(id => ({type: 'sheet', id}))];
      who = [...(groupMembers.get(rec.group_id) || [])];
    } else {
      if (!posts.has(rec.id)) {
        add(groupObjects, rec.group_id, {type: 'post', id: rec.id});
        if (rec.parent_id) add(descendants, rec.parent_id, rec.id);
        let root = rec;
        while (root.parent_id) root = data.posts.find(x => x.id === root.parent_id);
        if (root.event_id) add(byRootEvent, root.event_id, rec.id);
      }
      posts.set(rec.id, {...rec, state: f.v.state});
      refs = subtree(rec.id).map(id => ({type: 'post', id}));
      who = [...(groupMembers.get(rec.group_id) || [])];
    }
    for (const ref of refs) for (const m of who) evaluate(ref, m, f);
  }
  // Deliveries, with a digest also counting as a delivery of each post in it.
  const digests = new Map(data.digests.map(d => [d.id, d]));
  for (const d of data.deliveries) {
    const entry = {at: d.at, seq: d.seq, channel: d.channel, reason: d.reason};
    row({type: d.object_type, id: d.object_id}, d.recipient_member_id).deliveries.push(entry);
    if (d.object_type === 'digest') {
      for (const id of digests.get(d.object_id)?.post_ids || []) {
        row({type: 'post', id}, d.recipient_member_id).deliveries.push({...entry, via: d.object_id});
      }
    }
  }
  const out = [...rows.values()].sort((a, b) => a.object_type.localeCompare(b.object_type) ||
    a.object_id.localeCompare(b.object_id) || a.member_id.localeCompare(b.member_id));
  return {schema: 'stoopside.visibility-record.v1', through_seq: data.next_seq - 1, rows: out};
}

// True when the member was ever shown or sent the object.
function shown(rec, type, id, memberId) {
  return rec.rows.some(r => r.object_type === type && r.object_id === id && r.member_id === memberId &&
    (r.intervals.length > 0 || r.deliveries.length > 0));
}

module.exports = {canSee, canSeeGuests, canSeeDirectory, currentWorld, record, shown};
