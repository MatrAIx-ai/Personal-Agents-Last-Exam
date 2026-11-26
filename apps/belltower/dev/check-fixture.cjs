#!/usr/bin/env node
'use strict';
// Authoring-time consistency check of fixtures/minimal.json, never run by the App or the host.
//   node dev/check-fixture.cjs
// It does not use the App's business code: every rule below is worked out again from the
// stored records, so a mistake in src/ cannot hide a mistake in the fixture. It checks
// revision numbers and publication order, that every based_on names a revision published
// and received no later than the one that names it, effective periods, an area tree
// without cycles, the notification log against the delivery rules, the account's own
// records, and the counts the approved plan gives for this fixture.
// It reads only files of this package.
const path = require('node:path');

const instant = value => Date.parse(value);
// Wall clock of `tz` at instant `t`: [YYYY-MM-DD, minutes after midnight].
function wall(t, tz) {
  const p = {};
  for (const part of new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(t))) p[part.type] = part.value;
  return [p.year + '-' + p.month + '-' + p.day, (+p.hour % 24) * 60 + +p.minute];
}
const minutes = hhmm => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);
// The first whole minute at or after `t` at which the wall clock of `tz` shows `hhmm` (searched minute by minute over two days).
function nextWall(t, tz, hhmm) {
  for (let m = Math.ceil(t / 60000) * 60000, end = m + 49 * 3600000; m <= end; m += 60000) if (wall(m, tz)[1] === minutes(hhmm)) return m;
  return NaN;
}

function check(data = require('../fixtures/minimal.json')) {
  const problems = [], bad = message => problems.push(message);
  const tz = data.preferences.timezone, quiet = data.preferences.quiet_hours;

  // Areas: one tree, three levels, no cycle.
  const areas = new Map(data.areas.map(a => [a.id, a])), depth = { city: 0, district: 1, neighbourhood: 2 };
  for (const a of data.areas) {
    const seen = new Set();
    let steps = 0;
    for (let x = a; x; x = x.parent_id === null ? null : areas.get(x.parent_id), steps++) { if (seen.has(x.id)) { bad('Area ' + a.id + ' is in a cycle.'); break; } seen.add(x.id); }
    if (steps - 1 !== depth[a.level]) bad('Area ' + a.id + ' is not at the depth of its level.');
    if (a.parent_id !== null && !areas.has(a.parent_id)) bad('Area ' + a.id + ' has an unknown parent.');
  }
  if (data.areas.filter(a => a.level === 'city').length !== 1) bad('The fixture has one city.');

  // Items: numbering, order of publication and arrival, the shape of each type, periods and links.
  const sources = new Set(data.sources.map(s => s.id)), items = new Map(data.items.map(i => [i.id, i]));
  for (const item of data.items) {
    if (!sources.has(item.source_id)) bad('Item ' + item.id + ' has an unknown source.');
    item.revisions.forEach((r, i) => {
      const what = 'Item ' + item.id + ' revision ' + r.number + ' ', before = item.revisions[i - 1];
      if (r.number !== i + 1) bad(what + 'is out of sequence.');
      if ((i === 0) !== (r.type === 'original')) bad(what + 'has the wrong type for its position.');
      if (before && before.type === 'retraction') bad(what + 'follows a retraction.');
      if (instant(r.published_at) > instant(r.received_at)) bad(what + 'was published after it was received.');
      if (before && (instant(r.published_at) < instant(before.published_at) || instant(r.received_at) < instant(before.received_at))) bad(what + 'is earlier than the revision before it.');
      const retraction = r.type === 'retraction';
      if (retraction !== (r.headline === undefined) || retraction !== (r.body === undefined) || retraction !== (r.topics === undefined)) bad(what + 'has the wrong fields for its type.');
      if ((r.type === 'correction' || retraction) !== (r.note !== undefined)) bad(what + 'has a note exactly when it is a correction or a retraction.');
      for (const a of r.area_ids || []) if (!areas.has(a)) bad(what + 'names an unknown area.');
      if (r.effective) {
        if (item.kind !== 'notice') bad(what + 'has an effective period on an article.');
        if (r.effective.end !== null && instant(r.effective.end) <= instant(r.effective.start)) bad(what + 'has a period that does not end after it starts.');
      }
      if (item.kind === 'notice' && !retraction && !r.effective) bad(what + 'is a public notice without an effective period.');
      if (r.based_on) {
        const basis = items.get(r.based_on.item_id), used = basis && basis.revisions[r.based_on.revision - 1];
        if (!used || basis === item) bad(what + 'has no valid basis.');
        else if (instant(used.published_at) > instant(r.published_at) || instant(used.received_at) > instant(r.received_at)) bad(what + 'is earlier than its basis.');
      }
    });
  }

  // The account's own records.
  const revisionAt = (id, n) => (items.get(id) ? items.get(id).revisions[n - 1] : undefined);
  for (const m of data.read_marks) { const r = revisionAt(m.item_id, m.revision); if (!r || instant(m.read_at) < instant(r.received_at)) bad('Read mark of ' + m.item_id + ' revision ' + m.revision + ' is not possible.'); }
  for (const c of data.clippings) {
    const first = c.history.length ? c.history[0].revision : c.revision, r = revisionAt(c.item_id, first);
    if (!r || instant(c.created_at) < instant(r.received_at)) bad('Clipping ' + c.id + ' was made before the revision it first held.');
  }
  for (const f of data.follows) if ([...f.source_ids].some(x => !sources.has(x)) || f.area_ids.some(x => !areas.has(x))) bad('Follow rule ' + f.id + ' names an unknown source or area.');

  // The notification log against the delivery rules. The account's preferences did not change
  // after the first notification was written, so every release time follows from the stored ones.
  const lastChange = Math.max(0, ...data.activity.filter(a => a.action === 'preferences.update').map(a => instant(a.at)));
  const priorityOf = (item, n) => (item.revisions[n - 1].type === 'retraction' ? item.revisions[n - 2] : item.revisions[n - 1]).priority;
  const lastFor = new Map();
  for (const n of data.notifications) {
    const item = items.get(n.item_id), r = revisionAt(n.item_id, n.revision), created = instant(n.created_at), what = 'Notification ' + n.id + ' ';
    if (!r) { bad(what + 'names an unknown revision.'); continue; }
    if (created !== instant(r.received_at)) bad(what + 'was not written when its revision arrived.');
    if (created < lastChange) bad(what + 'is older than the last change of preferences; this check cannot follow it.');
    const [, minute] = wall(created, tz), start = minutes(quiet.start), end = minutes(quiet.end);
    const inQuiet = quiet.enabled && (start < end ? minute >= start && minute < end : minute >= start || minute < end);
    const expected = n.delivery === 'digest' ? nextWall(created, tz, data.preferences.digest_time)
      : inQuiet && priorityOf(item, n.revision) !== 'urgent' ? nextWall(created + 1, tz, quiet.end) : created;
    if (instant(n.release_at) !== expected) bad(what + 'has release time ' + n.release_at + ', which its delivery does not give.');
    const earlier = lastFor.get(n.item_id);
    if (earlier) {
      const held = instant(earlier.release_at) > created;
      if (held !== (earlier.superseded_by === n.id) || held !== (n.supersedes === earlier.id)) bad(what + 'and ' + earlier.id + ' disagree about superseding.');
      if (n.revision !== earlier.revision + 1) bad(what + 'skips a revision of an item the account was told about.');
    }
    if (n.wire && (n.wire.id !== n.id || n.wire.time !== n.release_at || n.wire.data.content.title !== n.title || n.wire.data.content.body.text !== n.body || n.wire.data.source_object.object_id !== n.item_id)) bad(what + 'and its wire message disagree.');
    lastFor.set(n.item_id, n);
  }
  // Every row of the activity log names a record that exists or existed, in time order.
  let at = -Infinity;
  for (const row of data.activity) { if (instant(row.at) < at) bad('Activity row ' + row.seq + ' is out of time order.'); at = instant(row.at); }

  // The counts the approved plan gives for this fixture.
  const clock = instant(require('../fixtures/clock.json').initial_time);
  const revisions = data.items.flatMap(item => item.revisions.map(r => ({ item, r }))), type = t => revisions.filter(x => x.r.type === t).length;
  const based = data.items.filter(item => item.revisions[0].based_on), relation = rel => based.filter(item => item.revisions[0].based_on.relation === rel).length;
  // A copy or report that arrived after the revision it names had already been corrected.
  const afterCorrection = based.filter(item => { const b = item.revisions[0].based_on, basis = items.get(b.item_id); return basis.revisions.some(x => x.type === 'correction' && x.number > b.revision && instant(x.received_at) <= instant(item.revisions[0].received_at)); }).length;
  const state = n => (n.superseded_by ? 'superseded' : instant(n.release_at) > clock ? 'held' : 'released');
  const counts = {
    cities: data.areas.filter(a => a.level === 'city').length, areas: data.areas.length, levels: new Set(data.areas.map(a => a.level)).size,
    sources: data.sources.length, official: data.sources.filter(s => s.kind === 'official').length, newsrooms: data.sources.filter(s => s.kind === 'newsroom').length, aggregators: data.sources.filter(s => s.kind === 'aggregator').length,
    items: data.items.length, revisions: revisions.length, notices: data.items.filter(i => i.kind === 'notice').length, updates: type('update'), corrections: type('correction'), retractions: type('retraction'),
    copies: relation('copy'), reports: relation('report'), after_correction: afterCorrection,
    follow_rules: data.follows.length, read_marks: data.read_marks.length, clippings: data.clippings.length,
    clippings_behind: data.clippings.filter(c => c.revision !== items.get(c.item_id).revisions.length).length, clippings_with_history: data.clippings.filter(c => c.history.length).length,
    notifications: data.notifications.length, held: data.notifications.filter(n => state(n) === 'held').length, released: data.notifications.filter(n => state(n) === 'released').length,
    superseded: data.notifications.filter(n => state(n) === 'superseded').length, bytes: Buffer.byteLength(JSON.stringify(data, null, 2) + '\n'),
  };
  const planned = {
    cities: 1, areas: 9, levels: 3, sources: 6, official: 2, newsrooms: 2, aggregators: 2, items: 48, revisions: 70, notices: 12, updates: 11, corrections: 8, retractions: 3,
    copies: 10, reports: 6, after_correction: 3, follow_rules: 5, read_marks: 14, clippings: 4, clippings_behind: 1, clippings_with_history: 1, notifications: 12,
  };
  for (const [key, value] of Object.entries(planned)) if (counts[key] !== value) bad('The plan gives ' + value + ' for ' + key + '; the fixture has ' + counts[key] + '.');
  if (!(counts.held >= 1 && counts.released >= 1 && counts.superseded >= 1)) bad('The fixture needs held, released and superseded notifications.');
  if (!(counts.bytes < 1048576)) bad('The fixture must stay under 1 MB.');
  for (const row of revisions) if (instant(row.r.received_at) > clock) bad('Item ' + row.item.id + ' revision ' + row.r.number + ' arrives after the fixture clock.');
  return { problems, counts };
}

if (require.main === module) {
  const { problems, counts } = check();
  console.log(JSON.stringify(counts, null, 2));
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
  console.log('fixtures/minimal.json at ' + path.basename(path.resolve(__dirname, '..')) + ': consistent with the delivery rules and the plan\'s counts.');
}
module.exports = { check };
