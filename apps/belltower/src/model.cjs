'use strict';
// Record consistency, object IDs and the states that are derived from stored records and
// the supplied time. Core owns persistence, versions and policy.
const { fail, ms, unique, byId, sameSet, validTimeZone, writtenOffset, minutesOf } = require('./util.cjs');

const RANK = { routine: 0, important: 1, urgent: 2 };
const KIND_OF = { original: 'item.published', update: 'item.updated', correction: 'item.corrected', retraction: 'item.retracted' };
const LIMITS = { follows: 20, clippings: 100 };

// ---- lookups --------------------------------------------------------------
// Chain of area IDs from the city down to `id`. A valid tree is three levels deep; the
// guard is for records that have not been validated yet.
function pathOf(areas, id) {
  const path = [];
  for (let a = areas.get(id), guard = 0; a && guard < 8; a = a.parent_id === null ? null : areas.get(a.parent_id), guard++) path.unshift(a.id);
  return path;
}
function index(data) {
  const areas = byId(data.areas);
  return {
    sources: byId(data.sources), areas, paths: new Map(data.areas.map(a => [a.id, pathOf(areas, a.id)])),
    items: byId(data.items), follows: byId(data.follows), clippings: byId(data.clippings),
  };
}
// Two areas overlap when they are the same area or one contains the other.
const overlap = (ix, a, b) => ix.paths.get(a).includes(b) || ix.paths.get(b).includes(a);

const latest = item => item.revisions[item.revisions.length - 1];
// Revisions are numbered from 1 in the order they were published, so a number is a position.
const revisionOf = (item, number) => item.revisions[number - 1];
// The revision that carries a revision's headline, topics, areas and priority: itself, or for
// a retraction, which has no text of its own, the revision before it.
const contentOf = (item, revision) => (revision.type === 'retraction' ? item.revisions[revision.number - 2] : revision);

// ---- derived states -------------------------------------------------------------
// Time-based states are never stored. A public notice's effect follows its effective period
// and a notification is held until its release time. Every read, every event and the
// Infra-run sender derive them from the supplied time in this one place.
const itemStatus = item => (latest(item).type === 'retraction' ? 'retracted' : item.revisions.some(r => r.type === 'correction') ? 'corrected' : 'current');
function effectOf(revision, now) {
  const e = revision.effective;
  if (!e) return null;
  return now < ms(e.start) ? 'upcoming' : e.end === null || now < ms(e.end) ? 'in_effect' : 'ended';
}
const notificationState = (notification, now) => (notification.superseded_by !== undefined ? 'superseded' : ms(notification.release_at) > now ? 'held' : 'released');
// The newest revision the account was shown, or null when the item has no read mark.
const lastRead = (data, itemId) => data.read_marks.reduce((max, m) => (m.item_id === itemId && m.revision > max ? m.revision : max), 0) || null;

// A rule matches a revision when every filter the rule has is met. A paused rule matches
// nothing. A retraction is matched with the topics, areas and priority of the revision before it.
function ruleMatches(ix, rule, item, revision) {
  if (rule.paused) return false;
  const c = contentOf(item, revision);
  return (rule.source_ids.length === 0 || rule.source_ids.includes(item.source_id))
    && (rule.topics.length === 0 || c.topics.some(t => rule.topics.includes(t)))
    && RANK[c.priority] >= RANK[rule.min_priority]
    && (rule.area_ids.length === 0 || c.area_ids.some(a => rule.area_ids.some(b => overlap(ix, a, b))));
}
// Two rules with the same filters match exactly the same revisions.
const sameFilters = (a, b) => sameSet(a.source_ids, b.source_ids) && sameSet(a.area_ids, b.area_ids) && sameSet(a.topics, b.topics) && a.min_priority === b.min_priority;

// Whether a wall time (minutes after midnight) lies inside the quiet period, which may wrap past midnight.
function quietAt(quiet, minutes) {
  const start = minutesOf(quiet.start), end = minutesOf(quiet.end);
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}
// What is wrong with a set of preferences, or null. The daily digest is released at the digest
// time, so that time cannot lie inside the quiet hours.
function preferencesProblem(p) {
  if (!validTimeZone(p.timezone)) return { code: 'invalid_timezone', message: 'Unknown time zone ' + p.timezone + '. Use an IANA name such as America/Chicago.' };
  if (p.quiet_hours.start === p.quiet_hours.end) return { code: 'invalid_arguments', message: 'Quiet hours cannot start and end at the same time.' };
  if (p.quiet_hours.enabled && quietAt(p.quiet_hours, minutesOf(p.digest_time))) {
    return { code: 'invalid_arguments', message: 'The digest time ' + p.digest_time + ' lies inside the quiet hours (' + p.quiet_hours.start + ' to ' + p.quiet_hours.end + ').' };
  }
  return null;
}

// What is wrong with one revision of `item`, as the end of a sentence, or null. Shared by the
// seed rules and the event handlers, so history and new arrivals are held to the same rules.
const TEXT = ['headline', 'body', 'topics', 'area_ids', 'priority'];
function revisionProblem(ix, item, r) {
  if (r.type === 'retraction') {
    if (r.note === undefined) return 'is a retraction and needs the publisher\'s note.';
    if ([...TEXT, 'effective', 'based_on'].some(key => r[key] !== undefined)) return 'is a retraction: it carries the publisher\'s note and no text, topics, areas, priority, effective period or basis.';
    return null;
  }
  if (TEXT.some(key => r[key] === undefined)) return 'needs a headline, a body, topics, areas and a priority.';
  if (r.type === 'correction' && r.note === undefined) return 'is a correction and needs the publisher\'s note.';
  if (r.type !== 'correction' && r.note !== undefined) return 'carries a publisher\'s note, which only a correction or a retraction has.';
  const unknown = r.area_ids.find(a => !ix.areas.has(a));
  if (unknown !== undefined) return 'names an unknown area (' + unknown + ').';
  if (r.effective !== undefined) {
    if (item.kind !== 'notice') return 'has an effective period, which only a public notice has.';
    if (r.effective.end !== null && !(ms(r.effective.end) > ms(r.effective.start))) return 'has an effective period that does not end after it starts.';
  }
  if (r.based_on !== undefined) {
    if (r.based_on.item_id === item.id) return 'cannot name its own item as its basis.';
    const basis = ix.items.get(r.based_on.item_id), used = basis && basis.revisions.find(x => x.number === r.based_on.revision);
    if (!used) return 'names a basis that does not exist (' + r.based_on.item_id + ' revision ' + r.based_on.revision + ').';
    if (ms(used.received_at) > ms(r.received_at)) return 'names a basis that had not been received yet (' + r.based_on.item_id + ' revision ' + r.based_on.revision + ').';
  }
  return null;
}

// ---- seed / state validation ------------------------------------------------------------------
// None of these rules reads the clock: a seed is valid or not whatever time it is loaded at.
function validateSeed(ctx, data) {
  const bad = message => fail('invalid_seed', message);
  const person = ctx.binding.people.some(p => p.person_id === data.owner_person_id);
  const account = ctx.binding.accounts.some(a => a.app_id === ctx.app_id && a.account_id === data.account_id && a.owner_person_id === data.owner_person_id);
  if (!person || !account) bad('Account and owner must be declared in the supplied binding.');

  if (!unique(objects(data))) bad('Record IDs must be unique across sources, areas, items, follow rules, clippings and notifications.');
  // Every stored instant carries its UTC offset. The seed schema already asks for it; the
  // rule is repeated here so that it does not depend on who validated the shape.
  for (const [where, value] of timestamps(data)) if (typeof value !== 'string' || writtenOffset(value) === null || Number.isNaN(ms(value))) bad(where + ': a timestamp needs its UTC offset.');

  // Levels only go down from a city, so the tree has no cycle.
  const areas = byId(data.areas), above = { city: null, district: 'city', neighbourhood: 'district' };
  for (const a of data.areas) {
    const parent = a.parent_id === null ? null : areas.get(a.parent_id);
    if (parent === undefined) bad('Area ' + a.id + ' names an unknown parent.');
    if ((parent ? parent.level : null) !== above[a.level]) bad('Area ' + a.id + ': a city has no parent, a district lies in a city and a neighbourhood lies in a district.');
  }
  const ix = index(data);

  for (const item of data.items) {
    if (!ix.sources.has(item.source_id)) bad('Item ' + item.id + ' names an unknown source.');
    let previous = null;
    item.revisions.forEach((r, i) => {
      const what = 'Item ' + item.id + ' revision ' + r.number;
      if (r.number !== i + 1) bad('Item ' + item.id + ': revisions are numbered from 1 in the order they were published.');
      if ((i === 0) !== (r.type === 'original')) bad(what + ': revision 1 is the original, and no later revision is.');
      if (previous && previous.type === 'retraction') bad('Item ' + item.id + ': no revision can follow a retraction.');
      if (ms(r.published_at) > ms(r.received_at)) bad(what + ' cannot be published after it was received.');
      if (previous && ms(r.published_at) < ms(previous.published_at)) bad(what + ' cannot be published before the revision it follows.');
      if (previous && ms(r.received_at) < ms(previous.received_at)) bad(what + ' cannot be received before the revision it follows.');
      previous = r;
    });
  }
  // A basis is looked up by number, so the text rules run once every item is known to be numbered.
  for (const item of data.items) for (const r of item.revisions) { const problem = revisionProblem(ix, item, r); if (problem) bad('Item ' + item.id + ' revision ' + r.number + ' ' + problem); }
  const revisionAt = (itemId, number) => { const item = ix.items.get(itemId); return item ? revisionOf(item, number) : undefined; };

  const preferences = preferencesProblem(data.preferences);
  if (preferences) bad(preferences.message);

  data.follows.forEach((rule, i) => {
    if (rule.source_ids.some(x => !ix.sources.has(x)) || rule.area_ids.some(x => !ix.areas.has(x))) bad('Follow rule ' + rule.id + ' names an unknown source or area.');
    if (!rule.source_ids.length && !rule.area_ids.length && !rule.topics.length) bad('Follow rule ' + rule.id + ' needs a source, an area or a topic.');
    if (data.follows.slice(0, i).some(other => sameFilters(other, rule))) bad('Follow rule ' + rule.id + ' has the same sources, areas, topics and minimum priority as another rule.');
    if (rule.updated_at !== undefined && ms(rule.updated_at) < ms(rule.created_at)) bad('Follow rule ' + rule.id + ' cannot be changed before it was created.');
  });

  const marked = new Set();
  for (const m of data.read_marks) {
    const what = m.item_id + ' revision ' + m.revision, revision = revisionAt(m.item_id, m.revision);
    if (!revision) bad('A read mark names an unknown item or revision (' + what + ').');
    if (marked.has(what)) bad('A revision can be marked as read once (' + what + ').');
    marked.add(what);
    if (ms(m.read_at) < ms(revision.received_at)) bad('A revision cannot be read before it was received (' + what + ').');
  }

  const clipped = new Set();
  for (const c of data.clippings) {
    if (!ix.items.has(c.item_id)) bad('Clipping ' + c.id + ' names an unknown item.');
    if (clipped.has(c.item_id)) bad('Item ' + c.item_id + ' has two clippings.');
    clipped.add(c.item_id);
    // Oldest first; the last version is what the clipping holds now. Each was taken when the
    // clipping was made or when the version before it was replaced.
    let taken = ms(c.created_at), held = 0;
    for (const v of [...c.history, c]) {
      const revision = revisionAt(c.item_id, v.revision);
      if (!revision) bad('Clipping ' + c.id + ' names a revision its item does not have.');
      if (v.revision < held) bad('Clipping ' + c.id + ': its history cannot move back to an earlier revision.');
      if (ms(revision.received_at) > taken) bad('Clipping ' + c.id + ' cannot hold revision ' + v.revision + ' before it was received.');
      held = v.revision;
      if (v !== c) {
        if (ms(v.replaced_at) < taken) bad('Clipping ' + c.id + ': history rows are in time order, after the clipping was made.');
        taken = ms(v.replaced_at);
      }
    }
  }

  // The log follows the notification rules: one notification for a revision, written when it
  // arrived; once an item has one, every later revision has one; and the one before is
  // superseded exactly when it was still held as the next was written.
  const lastFor = new Map();
  let written = -Infinity;
  for (const n of data.notifications) {
    const what = 'Notification ' + n.id, revision = revisionAt(n.item_id, n.revision), earlier = lastFor.get(n.item_id);
    if (!revision) bad(what + ' names an unknown item or revision.');
    if (n.kind !== KIND_OF[revision.type]) bad(what + ': its kind does not fit the revision it describes.');
    if (ms(n.created_at) !== ms(revision.received_at)) bad(what + ' must be created at the time its revision was received.');
    if (ms(n.release_at) < ms(n.created_at)) bad(what + ': the release time cannot be before the creation time.');
    if (ms(n.created_at) < written) bad('Notifications are stored in the order they were written.');
    written = ms(n.created_at);
    if (n.reasons.includes('follow') !== (n.matched_follow_ids.length > 0)) bad(what + ': the reason follow goes with at least one matching rule, and only then.');
    if (n.reasons.includes('earlier_notification') !== (earlier !== undefined)) bad(what + ': the reason earlier_notification goes with an earlier notification for the same item, and only then.');
    if (earlier) {
      if (n.revision !== earlier.revision + 1) bad(what + ': once an item has a notification, every later revision has exactly one.');
      if (earlier.delivery === 'immediate' && n.delivery !== 'immediate') bad(what + ' keeps the immediate delivery of the notification before it.');
      if (ms(earlier.release_at) > ms(n.created_at)) {
        if (earlier.superseded_by !== n.id || n.supersedes !== earlier.id || earlier.superseded_at === undefined || ms(earlier.superseded_at) !== ms(n.created_at)) bad('Notification ' + earlier.id + ' was still held when ' + n.id + ' was written, so it is superseded by it at that time.');
      } else if (earlier.superseded_by !== undefined || earlier.superseded_at !== undefined || n.supersedes !== undefined) bad('Notification ' + earlier.id + ' was released before ' + n.id + ' was written, so it is not superseded.');
    } else if (n.supersedes !== undefined) bad(what + ' cannot supersede anything: it is the first for its item.');
    lastFor.set(n.item_id, n);
  }
  for (const n of lastFor.values()) if (n.superseded_by !== undefined || n.superseded_at !== undefined) bad('Notification ' + n.id + ' is the last for its item, so nothing supersedes it.');

  let seq = 0;
  for (const row of data.activity) {
    if (row.seq <= seq) bad('Activity rows must have increasing sequence numbers.');
    seq = row.seq;
  }
}

// Every stored instant, with the place it was found.
function timestamps(data) {
  const out = [];
  for (const item of data.items) {
    for (const r of item.revisions) {
      const where = 'Item ' + item.id + ' revision ' + r.number;
      out.push([where, r.published_at], [where, r.received_at]);
      if (r.effective) { out.push([where, r.effective.start]); if (r.effective.end !== null) out.push([where, r.effective.end]); }
    }
  }
  for (const f of data.follows) { out.push(['Follow rule ' + f.id, f.created_at]); if (f.updated_at !== undefined) out.push(['Follow rule ' + f.id, f.updated_at]); }
  for (const m of data.read_marks) out.push(['Read mark of ' + m.item_id, m.read_at]);
  for (const c of data.clippings) { out.push(['Clipping ' + c.id, c.created_at]); for (const v of c.history) out.push(['Clipping ' + c.id + ' history', v.replaced_at]); }
  for (const n of data.notifications) { out.push(['Notification ' + n.id, n.created_at], ['Notification ' + n.id, n.release_at]); if (n.superseded_at !== undefined) out.push(['Notification ' + n.id, n.superseded_at]); }
  for (const a of data.activity) out.push(['Activity row ' + a.seq, a.at]);
  return out;
}

// One object ID per record, so record-only imports count the same things. A revision is
// named by its item and number and a read mark by its item and revision; neither has an ID.
const records = data => [...data.sources, ...data.areas, ...data.items, ...data.follows, ...data.clippings, ...data.notifications];
function objects(data) { return records(data).map(x => x.id); }
// Belltower keeps no reference into another App: a clipping's linked_object is stored as given and never opened.
const references = () => [];
// Every ID a new record must not take: those in use, and those of removed rules and clippings
// that the activity log and the notification log still name.
function usedIds(data) {
  const out = objects(data);
  for (const row of data.activity) out.push(row.object_id);
  for (const n of data.notifications) out.push(...n.matched_follow_ids);
  return out;
}

module.exports = {
  validateSeed, records, objects, references, usedIds,
  RANK, KIND_OF, LIMITS, index, overlap, latest, revisionOf, contentOf, itemStatus, effectOf, notificationState, lastRead, ruleMatches, sameFilters,
  quietAt, preferencesProblem, revisionProblem,
};
