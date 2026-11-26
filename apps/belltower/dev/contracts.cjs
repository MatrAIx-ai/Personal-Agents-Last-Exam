'use strict';
// Single source for Belltower's business contracts. `node dev/build.cjs` writes
// tools.json, schemas/seed.schema.json, schemas/events.schema.json and
// schemas/state.schema.json from this file; `--check` reports drift.
// Only keywords supported by the public schema validator are used.

const APP = 'belltower';
const VERSION = '1.0.0';
const CORE_API = '1.2.0';

const TOPIC = ['water', 'power', 'roads', 'transit', 'schools', 'libraries', 'health', 'safety', 'weather', 'government', 'community', 'business'];
const PRIORITY = ['routine', 'important', 'urgent'];
const SOURCE_KIND = ['official', 'newsroom', 'aggregator'];
const AREA_LEVEL = ['city', 'district', 'neighbourhood'];
const ITEM_KIND = ['article', 'notice'];
const REVISION_TYPE = ['original', 'update', 'correction', 'retraction'];
const ITEM_STATUS = ['current', 'corrected', 'retracted'];
// Never stored: a public notice's effect follows its effective period and the environment clock.
const EFFECT = ['upcoming', 'in_effect', 'ended'];
const DELIVERY = ['immediate', 'digest'];
const CORRECTIONS = ['as_item', 'immediate'];
const RELATION = ['copy', 'report'];
const NOTIFICATION_KIND = ['item.published', 'item.updated', 'item.corrected', 'item.retracted'];
// `held` and `released` are never stored: they follow the release time and the environment clock.
const NOTIFICATION_STATE = ['held', 'released', 'superseded'];
const REASON = ['follow', 'earlier_notification', 'watched_clipping'];
const LIMITS = { follows: 20, clippings: 100 };
// Belltower has no clock event: time is the environment's (an event's own `at`, or Core's env.advance_time).
const EVENTS = NOTIFICATION_KIND.map(x => APP + '.' + x);

// ---- builders -------------------------------------------------------------
const str = (min = 1, max = 200) => ({ type: 'string', minLength: min, maxLength: max });
// Record IDs use the character set Mail accepts for object references, so any record can be named in a notification.
const id = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$' };
const idArg = str(1, 100);
// Caller-chosen request and event IDs are stored as given.
const callRef = str(1, 100);
const ts = { type: 'string', format: 'date-time' };
const hhmm = { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' };
const bool = { type: 'boolean' };
const int = (min, max) => ({ type: 'integer', minimum: min, ...(max === undefined ? {} : { maximum: max }) });
const en = (...values) => ({ enum: values });
const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const arr = (items, extra = {}) => ({ type: 'array', items, ...extra });
const nullable = schema => ({ anyOf: [{ type: 'null' }, schema] });
const describe = (schema, description) => ({ ...schema, description });

// ---- stored records (seed / state data) -------------------------------------
const revisionNumber = int(1, 999);
const headline = str(1, 180);
const body = str(1, 8000);
const note = str(1, 1000);
const topics = arr(en(...TOPIC), { minItems: 1, maxItems: TOPIC.length, uniqueItems: true });
const areaIds = arr(id, { minItems: 1, maxItems: 20, uniqueItems: true });
// What a public notice announces: from `start` until `end`; `end` is null for an open-ended notice.
const effective = obj({ start: ts, end: nullable(ts) });
// The publisher's own statement of what a revision copied or reported on: one revision of another item.
const basedOn = obj({ item_id: id, revision: revisionNumber, relation: en(...RELATION) });

const source = obj({ id, name: str(1, 120), kind: en(...SOURCE_KIND) });
const area = obj({ id, name: str(1, 120), level: en(...AREA_LEVEL), parent_id: nullable(id) });
// A retraction carries its number, its two times and the publisher's note, and nothing else. Every
// other revision carries the full text, topics, areas and priority; a correction also carries the note.
const revision = obj({
  number: revisionNumber, type: en(...REVISION_TYPE), published_at: ts, received_at: ts, note,
  headline, body, topics, area_ids: areaIds, priority: en(...PRIORITY), effective, based_on: basedOn,
}, ['number', 'type', 'published_at', 'received_at']);
const item = obj({ id, source_id: id, kind: en(...ITEM_KIND), revisions: arr(revision, { minItems: 1, maxItems: 50 }) });

const quietHours = obj({ enabled: bool, start: hhmm, end: hhmm });
const preferences = obj({ timezone: str(1, 64), quiet_hours: quietHours, digest_time: hhmm, corrections: en(...CORRECTIONS), email_notices: bool });
const follow = obj({
  id, source_ids: arr(id, { maxItems: 20, uniqueItems: true }), area_ids: arr(id, { maxItems: 20, uniqueItems: true }),
  topics: arr(en(...TOPIC), { maxItems: TOPIC.length, uniqueItems: true }), min_priority: en(...PRIORITY), delivery: en(...DELIVERY),
  paused: bool, created_at: ts, updated_at: ts,
}, ['id', 'source_ids', 'area_ids', 'topics', 'min_priority', 'delivery', 'paused', 'created_at']);
// A read mark has no ID of its own: it is named by its item and revision.
const readMark = obj({ item_id: id, revision: revisionNumber, read_at: ts });
// An opaque reference the Agent supplies, for example a Calendar event. Belltower stores it and never dereferences it.
const linkedObject = obj({ app_id: str(1, 100), object_type: str(1, 100), object_id: str(1, 150) });
// One row for every earlier version of a clipping: what it held until `replaced_at`.
const clippingVersion = obj({ replaced_at: ts, revision: revisionNumber, note, linked_object: linkedObject, watch: bool, request_id: callRef }, ['replaced_at', 'revision', 'watch']);
const clipping = obj({
  id, item_id: id, revision: revisionNumber, note, linked_object: linkedObject, watch: bool, created_at: ts,
  history: arr(clippingVersion, { maxItems: 200 }),
}, ['id', 'item_id', 'revision', 'watch', 'created_at', 'history']);
const notification = obj({
  id, seq: int(0), kind: en(...NOTIFICATION_KIND), item_id: id, revision: revisionNumber, created_at: ts, release_at: ts,
  delivery: en(...DELIVERY), reasons: arr(en(...REASON), { minItems: 1, maxItems: REASON.length, uniqueItems: true }),
  matched_follow_ids: arr(id, { maxItems: LIMITS.follows, uniqueItems: true }), supersedes: id, superseded_by: id, superseded_at: ts,
  title: str(1, 200), body: str(1, 2000), cause: obj({ event_id: callRef }, []), wire: { type: 'object' },
}, ['id', 'kind', 'item_id', 'revision', 'created_at', 'release_at', 'delivery', 'reasons', 'matched_follow_ids', 'title', 'body']);
const activity = obj({
  seq: int(1), at: ts, actor: en('agent', 'event'), action: str(1, 80), object_id: str(1, 150),
  request_id: callRef, event_id: callRef, details: { type: 'object' },
}, ['seq', 'at', 'actor', 'action', 'object_id']);

const seed = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Belltower world and account records',
  description: 'History accepted by env.load_seed and kept as App data. World records (sources, an area tree, items with every revision) and one reader account (preferences, follow rules, read marks, clippings with their history, notifications, activity). Everything in a seed has already been published and received; new information arrives only through events. Time-based states are not stored: a public notice carries its effective period and a notification its release time, and both are read against the environment clock.',
  ...obj({
    account_id: id, owner_person_id: id,
    sources: arr(source, { minItems: 1, maxItems: 200 }), areas: arr(area, { minItems: 1, maxItems: 500 }), items: arr(item, { maxItems: 5000 }),
    preferences, follows: arr(follow, { maxItems: LIMITS.follows }), read_marks: arr(readMark, { maxItems: 20000 }),
    clippings: arr(clipping, { maxItems: LIMITS.clippings }), notifications: arr(notification, { maxItems: 10000 }), activity: arr(activity, { maxItems: 50000 }),
  }),
};

// ---- incoming events ------------------------------------------------------------
const envelope = (operation, payload) => obj({ event_id: str(1, 100), at: ts, operation: { const: operation }, payload });
const content = { number: revisionNumber, published_at: ts, headline, body, topics, area_ids: areaIds, priority: en(...PRIORITY), effective, based_on: basedOn };
const full = ['number', 'published_at', 'headline', 'body', 'topics', 'area_ids', 'priority'];
const events = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Belltower incoming events',
  description: 'Events Infra may apply with env.apply_event: what sources publish. Each is handled at its own `at`, which becomes the revision\'s received_at. There is no clock event: Infra moves time with an event or with Core\'s env.advance_time, which runs no App code.',
  type: 'object',
  oneOf: [
    envelope(EVENTS[0], obj({ item_id: id, source_id: id, kind: en(...ITEM_KIND), revision: obj(content, full) })),
    envelope(EVENTS[1], obj({ item_id: id, revision: obj(content, full) })),
    envelope(EVENTS[2], obj({ item_id: id, revision: obj({ ...content, note }, [...full, 'note']) })),
    envelope(EVENTS[3], obj({ item_id: id, revision: obj({ number: revisionNumber, published_at: ts, note }) })),
  ],
};

// ---- tool results ---------------------------------------------------------------------
const version = obj({ epoch: int(1), revision: int(0) });
const sourceOut = obj({ ...source.properties, items: int(0) });
const areaOut = obj({ ...area.properties, path: arr(id, { minItems: 1 }) });
// One revision as a read returns it. A retraction has no text of its own: its headline, topics, areas and
// priority are those of the revision before it, and its body and effective period are null.
const revisionFields = {
  revision: revisionNumber, type: en(...REVISION_TYPE), headline, topics, area_ids: areaIds, priority: en(...PRIORITY),
  note: nullable(note), published_at: ts, received_at: ts, effective: nullable(effective), effect: nullable(en(...EFFECT)), based_on: nullable(basedOn),
};
const account = { last_read_revision: nullable(revisionNumber), changed_since_read: bool, clipping_id: nullable(id) };
const itemBrief = obj({
  id, source_id: id, kind: en(...ITEM_KIND), status: en(...ITEM_STATUS), ...revisionFields,
  matched_revisions: arr(revisionNumber, { minItems: 1, uniqueItems: true }), ...account,
});
const revisionRow = obj({ revision: revisionNumber, type: en(...REVISION_TYPE), published_at: ts, received_at: ts, note: nullable(note), effective: nullable(effective) });
const reference = obj({ item_id: id, source_id: id, revision: revisionNumber, relation: en(...RELATION), used_revision: revisionNumber, published_at: ts, received_at: ts });
const itemDetail = obj({
  id, source_id: id, source_name: str(1, 120), source_kind: en(...SOURCE_KIND), kind: en(...ITEM_KIND), status: en(...ITEM_STATUS), latest_revision: revisionNumber,
  ...revisionFields, is_latest: bool, body: nullable(body), revisions: arr(revisionRow, { minItems: 1 }), referenced_by: arr(reference),
  read_revisions: arr(revisionNumber, { uniqueItems: true }), ...account,
});
const followOut = obj({
  id, state: en('active', 'paused'), source_ids: follow.properties.source_ids, area_ids: follow.properties.area_ids, topics: follow.properties.topics,
  min_priority: en(...PRIORITY), delivery: en(...DELIVERY), created_at: ts, updated_at: nullable(ts),
});
const markOut = obj({ item_id: id, revision: revisionNumber, read_at: ts, is_latest: bool, latest_revision: revisionNumber });
const clippingOut = obj({
  id, item_id: id, revision: revisionNumber, latest_revision: revisionNumber, is_current: bool, state: en('current', 'behind'), note: nullable(note),
  linked_object: nullable(linkedObject), watch: bool, created_at: ts, updated_at: nullable(ts), history: clipping.properties.history,
});
const notificationOut = obj({
  id, kind: en(...NOTIFICATION_KIND), state: en(...NOTIFICATION_STATE), item_id: id, revision: revisionNumber, created_at: ts, release_at: ts,
  delivery: en(...DELIVERY), reasons: notification.properties.reasons, matched_follow_ids: notification.properties.matched_follow_ids,
  supersedes: nullable(id), superseded_by: nullable(id), title: str(1, 200), body: str(1, 2000), email_prepared: bool,
});
const preferencesOut = obj({ ...preferences.properties, in_quiet_hours: bool, next_digest_at: ts });

// ---- tool inputs --------------------------------------------------------------------------
const cursor = describe(str(1, 100), 'Opaque value from next_cursor of the previous page.');
const nextCursor = nullable(str(1, 100));
const write = { expected_version: describe(version, 'Version from the latest result you read. A stale version is rejected with stale_version.'), request_id: describe(str(1, 100), 'Unique ID for this write. Repeating it with the same input returns the stored result. This is Core\'s idempotency key, not a record ID.') };
const ruleFilters = {
  source_ids: describe(follow.properties.source_ids, 'Sources to follow; leave out or empty for any source.'),
  area_ids: describe(follow.properties.area_ids, 'Areas to follow. A revision matches when one of its areas is one of these, lies inside one of them or contains one of them. Leave out or empty for any area.'),
  topics: describe(follow.properties.topics, 'Topics to follow; leave out or empty for any topic.'),
  min_priority: describe(en(...PRIORITY), 'Lowest priority that matches: routine (everything), important, or urgent.'),
  delivery: describe(en(...DELIVERY), 'immediate: notify when the revision arrives (held over quiet hours unless it is urgent). digest: notify at the next daily digest time.'),
};
const linkedArg = describe(linkedObject, 'A reference to what relies on this item, for example { app_id: "calendar", object_type: "event", object_id: "..." }. Stored as given and never opened.');

const READ = 'belltower.read', WRITE = 'belltower.write';
const tool = (name, read_only, resource_target, description, input, required, output, outputRequired = Object.keys(output)) => ({
  name: APP + '.' + name, description, scope: read_only ? READ : WRITE, resource_target, read_only,
  input: { ...input, ...(read_only ? {} : write) },
  required: [...required, ...(read_only ? [] : ['expected_version', 'request_id'])],
  output, outputRequired,
});

const TOOLS = [
  tool('sources.list', true, 'sources',
    'List the sources Belltower carries, with their kind: official (a public body that issues notices), newsroom, or aggregator (it republishes other sources). items is the number of items from that source. Belltower does not rank sources and does not say which one is right. No side effects.',
    { kind: describe(en(...SOURCE_KIND), 'Only sources of this kind.') }, [], { sources: arr(sourceOut) }),
  tool('areas.list', true, 'areas',
    'List the areas items are tagged with. Areas form a tree of three levels: city, district, neighbourhood. path is the chain from the city down to the area. With id, only that area and the areas inside it are returned. Errors: not_found. No side effects.',
    { id: describe(idArg, 'Area ID: return this area and every area inside it.') }, [], { areas: arr(areaOut) }),
  tool('items.list', true, 'items',
    'List or search items (articles and public notices), newest first. Each entry shows the item as it stands now: its latest revision number, type (original, update, correction or retraction), headline, topics, areas, priority and times, with status current, corrected or retracted. The filters start/end, area_id, topic, min_priority and query are checked against every revision, earlier ones included, and an item is listed when at least one of its revisions passes all of them; matched_revisions names those revisions, so a claim that was later corrected can still be found and is shown as belonging to an earlier revision. Without such a filter matched_revisions lists every revision. start and end select revisions by received_at, the time they reached Belltower. query is plain word matching in headline and body: every word of the query must appear as a whole word, in any letter case. Belltower does not group copies into one story and does not label anything as outdated: a copy names what it copied in based_on. Reading or listing an item never marks it as read. Errors: not_found (an unknown source or area), invalid_window (end is not after start). No match returns an empty list. No side effects.',
    {
      start: describe(ts, 'Only revisions received at or after this time, ISO 8601 with a UTC offset.'), end: describe(ts, 'Only revisions received before this time, ISO 8601 with a UTC offset.'),
      source_id: describe(idArg, 'Only items from this source.'), area_id: describe(idArg, 'Only revisions tagged with this area, with an area inside it or with an area that contains it.'),
      topic: describe(en(...TOPIC), 'Only revisions with this topic.'), kind: describe(en(...ITEM_KIND), 'Only articles or only public notices.'),
      min_priority: describe(en(...PRIORITY), 'Only revisions with at least this priority.'), status: describe(en(...ITEM_STATUS), 'Only items with this status.'),
      query: describe(str(1, 200), 'Words to look for in the headline and body of every revision.'),
      changed_since_read: describe(bool, 'true: only items with a revision newer than the newest one marked as read. false: only items without one (never read, or read at the latest revision).'),
      limit: describe(int(1, 100), 'Page size; 20 by default.'), cursor,
    }, [], { items: arr(itemBrief), next_cursor: nextCursor }),
  tool('items.get', true, 'item',
    'Read one item. Returns its latest revision unless revision is given, and always names what was returned: revision, type and is_latest. revisions lists every revision of the item with its number, type, times and, for a correction or a retraction, the publisher\'s note. Every revision has published_at (as its publisher states it) and received_at (when it reached Belltower); a public notice also has the effective period it announces, and effect (upcoming, in_effect or ended) follows that period and the current time. A retraction has no body: it carries the publisher\'s note, and the earlier revisions stay readable by number. based_on is the publisher\'s own statement of which revision of which other item this revision copied or reported on; referenced_by lists every revision of other items that names this item as its basis, each with the revision it used (used_revision) and its own times. Belltower states these links and draws no conclusion from them. last_read_revision, read_revisions and changed_since_read come from the account\'s read marks; reading an item here does not create one (use reading.mark). Errors: not_found (an unknown item, or a revision number the item does not have). No side effects.',
    { id: describe(idArg, 'Item ID.'), revision: describe(revisionNumber, 'Revision number to return; the latest when left out.') }, ['id'], { item: itemDetail }),
  tool('follows.list', true, 'current account',
    'List the account\'s follow rules. A rule matches a revision when every filter it has is met: the item\'s source is one of its sources, one of the revision\'s topics is one of its topics, the priority is at least min_priority, and one of the revision\'s areas overlaps one of its areas (the same area, or one contains the other). A paused rule matches nothing. No side effects.',
    { state: describe(en('active', 'paused'), 'Only active or only paused rules.') }, [], { follows: arr(followOut) }),
  tool('reading.list', true, 'current account',
    'List the account\'s read marks, newest first: which revision of which item the person was shown, and when. is_latest says whether that revision is still the item\'s latest. A read mark exists only when reading.mark was called or the loaded history had it; reading items does not create marks. id filters by item. Errors: not_found. No side effects.',
    { id: describe(idArg, 'Item ID: only marks of this item.'), limit: describe(int(1, 100), 'Page size; 20 by default.'), cursor }, [],
    { marks: arr(markOut), next_cursor: nextCursor }),
  tool('clippings.list', true, 'current account',
    'List the account\'s clippings, newest first. A clipping holds one revision of an item with a note, an optional reference to what relies on it (linked_object) and a watch setting. is_current is false (state behind) when the item has a newer revision than the one the clipping holds. history lists the earlier versions of the clipping: the revision, note, reference and watch setting it held until replaced_at. id filters by item. Errors: not_found. No side effects.',
    { id: describe(idArg, 'Item ID: only the clipping of this item.'), state: describe(en('current', 'behind'), 'Only clippings in this state.') }, [],
    { clippings: arr(clippingOut) }),
  tool('notifications.list', true, 'current account',
    'List the notifications Belltower wrote for this account, newest first. One is written when a revision arrives (a new item included) and an active follow rule matches it, or the account was already notified about that item, or it watches a clipping of it. kind follows the revision: item.published, item.updated, item.corrected or item.retracted. reasons says why it was written (follow, earlier_notification, watched_clipping) and matched_follow_ids names the rules that match this revision, possibly none. Every notification has a release time. State is held before that time, released from then on, and superseded when a later revision of the same item arrived while it was still held: a superseded notification was never released, and superseded_by names the one that replaced it. id filters by item; start and end select by the time a notification was created. Errors: not_found, invalid_window (end is not after start). No side effects.',
    {
      id: describe(idArg, 'Item ID: only notifications about this item.'), kind: describe(en(...NOTIFICATION_KIND), 'Only notifications of this kind.'),
      state: describe(en(...NOTIFICATION_STATE), 'Only notifications in this state, as of now.'),
      start: describe(ts, 'Only notifications created at or after this time, ISO 8601 with a UTC offset.'), end: describe(ts, 'Only notifications created before this time, ISO 8601 with a UTC offset.'),
      limit: describe(int(1, 100), 'Page size; 20 by default.'), cursor,
    }, [],
    { notifications: arr(notificationOut), next_cursor: nextCursor }),
  tool('preferences.get', true, 'current account',
    'Read the account preferences: time zone, quiet hours, the daily digest time, how corrections and retractions are delivered (as_item: like the item\'s other notifications; immediate: at once) and whether notifications are also prepared as email. in_quiet_hours and next_digest_at are worked out for the current time. No side effects.',
    {}, [], { preferences: preferencesOut }),

  tool('follows.create', false, 'current account',
    'Create a follow rule from any of a list of sources, a list of areas and a list of topics, with a minimum priority and a delivery. At least one source, area or topic is needed. The rule applies to revisions that arrive from now on; nothing is notified for what was already published. The result id is the new rule. Errors: not_found (an unknown source or area), already_following (a rule with the same sources, areas, topics and minimum priority exists: change that one with follows.update), limit_exceeded (the account already has ' + LIMITS.follows + ' rules), invalid_arguments (no source, area or topic).',
    { ...ruleFilters }, ['delivery'], { id, follow: followOut }),
  tool('follows.update', false, 'follow rule',
    'Change a follow rule: its filters, its delivery, or paused (true pauses it, false resumes it). Only the fields present in patch change; a list replaces the old list. Later notifications follow the change; notifications already written keep their release time. Pausing a rule stops discovery through it. It does not withdraw notifications already written, and a later revision of an item the account was already notified about still notifies. id is the rule ID. Errors: not_found (the rule, or an unknown source or area), already_following (the change would make it the same as another rule), invalid_arguments (an empty patch, or a rule left with no source, area or topic).',
    { id: describe(idArg, 'Follow rule ID.'), patch: describe(obj({ ...ruleFilters, paused: describe(bool, 'true pauses the rule; false resumes it.') }, []), 'The fields to change.') }, ['id', 'patch'],
    { id, follow: followOut }),
  tool('follows.remove', false, 'follow rule',
    'Remove a follow rule. From then on it brings no notification for a new item or for an item the account was not notified about before. Notifications already written stay, and a later revision of an item the account was already notified about still notifies. id is the rule ID. Errors: not_found.',
    { id: describe(idArg, 'Follow rule ID.') }, ['id'], { id, remaining: int(0) }),
  tool('preferences.update', false, 'current account',
    'Change account preferences. Only the fields present in patch change. Quiet hours hold a new immediate notification until they end, unless the revision is urgent; a digest notification is released at the next daily digest time. Notifications already written keep their release time. Turning email_notices off stops new email copies; the notification log is still written. Errors: invalid_timezone, invalid_arguments (an empty patch, quiet hours that start and end at the same time, or a digest time inside the quiet hours).',
    {
      patch: describe(obj({
        timezone: describe(str(1, 64), 'IANA time zone, for example America/Chicago.'),
        quiet_hours: describe(obj({ enabled: bool, start: hhmm, end: hhmm }, []), 'Any of enabled, start and end (HH:MM in the account time zone); fields left out keep their value.'),
        digest_time: describe(hhmm, 'Daily digest time, HH:MM in the account time zone. It cannot lie inside the quiet hours.'),
        corrections: describe(en(...CORRECTIONS), 'as_item: a correction or retraction is delivered like the item\'s other notifications. immediate: it is delivered at once.'),
        email_notices: describe(bool, 'Whether a new notification is also prepared as an email message for Mail.'),
      }, []), 'The fields to change.'),
    }, ['patch'], { id, preferences: preferencesOut }),
  tool('reading.mark', false, 'item',
    'Record that the person was shown an item at one revision. Without revision the item\'s latest revision is marked. The mark keeps the revision and the current time, and items then show changed_since_read when a newer revision exists. id is the item ID. Errors: not_found (an unknown item, or a revision the item does not have), already_read (that revision is already marked).',
    { id: describe(idArg, 'Item ID.'), revision: describe(revisionNumber, 'The revision that was read; the latest when left out.') }, ['id'], { id, mark: markOut }),
  tool('clippings.add', false, 'item',
    'Clip an item at its latest revision, with an optional note, an optional reference to what relies on it and a choice to watch it. A watched clipping brings a notification with immediate delivery for every later revision of that item, also when no follow rule matches. id is the item ID; the result id is the new clipping. Errors: not_found, already_clipped (the item already has a clipping: change it with clippings.update), limit_exceeded (the account already has ' + LIMITS.clippings + ' clippings).',
    { id: describe(idArg, 'Item ID.'), note: describe(note, 'Why this item was kept.'), linked_object: linkedArg, watch: describe(bool, 'Whether later revisions of the item notify the account; false when left out.') }, ['id'],
    { id, clipping: clippingOut }),
  tool('clippings.update', false, 'clipping',
    'Change a clipping: move it to a newer revision of its item, change its note or its reference, or turn watching on or off. Only the fields present in patch change; note or linked_object set to null removes it. The version it held before is kept in its history. Ending a watch stops the notifications that depended on the watch alone; it does not stop later revisions of an item the account was already notified about. id is the clipping ID. Errors: not_found (the clipping, or a revision the item does not have), invalid_revision (the revision is not newer than the one the clipping holds), invalid_arguments (an empty patch).',
    {
      id: describe(idArg, 'Clipping ID.'),
      patch: describe(obj({
        revision: describe(revisionNumber, 'A newer revision of the item for the clipping to hold.'), note: describe(nullable(note), 'New note, or null to remove it.'),
        linked_object: describe(nullable(linkedObject), 'New reference, or null to remove it.'), watch: describe(bool, 'Whether later revisions of the item notify the account.'),
      }, []), 'The fields to change.'),
    }, ['id', 'patch'], { id, clipping: clippingOut }),
  tool('clippings.remove', false, 'clipping',
    'Remove a clipping with its history. The item and its read marks are not touched. id is the clipping ID. Errors: not_found.',
    { id: describe(idArg, 'Clipping ID.') }, ['id'], { id, remaining: int(0) }),
];

const failure = obj({ status: { type: 'string' }, message: { type: 'string' }, applied: { const: false }, version, current_version: version }, ['status', 'message', 'applied', 'version']);
function toolsJson() {
  return TOOLS.map(t => ({
    name: t.name, description: t.description, scope: t.scope, resource_target: t.resource_target, read_only: t.read_only,
    inputSchema: obj(t.input, t.required),
    outputSchema: {
      type: 'object',
      anyOf: [
        obj({ status: en('ok', 'committed'), app_id: { const: APP }, version, duplicate: bool, ...t.output }, ['status', 'app_id', 'version', ...t.outputRequired]),
        failure,
      ],
    },
  }));
}

// Core state envelope, identical to the provided template apart from App identity.
function stateSchema(template) {
  const s = JSON.parse(JSON.stringify(template));
  s.properties.package_version = { const: VERSION };
  s.properties.core_api_version = { const: CORE_API };
  s.properties.app_id = { const: APP };
  return s;
}

module.exports = {
  APP, VERSION, CORE_API, TOPIC, PRIORITY, SOURCE_KIND, AREA_LEVEL, ITEM_KIND, REVISION_TYPE, ITEM_STATUS, EFFECT, DELIVERY, CORRECTIONS, RELATION,
  NOTIFICATION_KIND, NOTIFICATION_STATE, REASON, LIMITS, EVENTS, seed, events, toolsJson, stateSchema,
};
