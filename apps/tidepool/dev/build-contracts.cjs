'use strict';
// Maintainer script (not run by tests or the verifier). Regenerates schemas/seed.schema.json,
// schemas/events.schema.json and tools.json from one set of field definitions.
// Usage, from the package directory: node dev/build-contracts.cjs
const fs = require('node:fs'), path = require('node:path');
const out = path.resolve(__dirname, '..');
const APP = 'tidepool';

const ID = {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
const TIME = {type: 'string', format: 'date-time'};
const text = (max, min = 1) => ({type: 'string', minLength: min, maxLength: max});
const int = (minimum, maximum) => ({type: 'integer', minimum, ...(maximum === undefined ? {} : {maximum})});
const BOOL = {type: 'boolean'};
const obj = (properties, required = Object.keys(properties)) => ({type: 'object', properties, required, additionalProperties: false});
const arr = (items, maxItems, extra = {}) => ({type: 'array', items, maxItems, ...extra});
const nullable = s => ({anyOf: [s, {type: 'null'}]});
const VERSION = obj({epoch: int(1), revision: int(0)});
const ANY = {anyOf: [{type: 'object'}, {type: 'array'}, {type: 'string'}, {type: 'number'}, {type: 'boolean'}, {type: 'null'}]};

const AVAILABILITY = {enum: ['available', 'removed']};
const PLAN_ID = {enum: ['individual', 'duo', 'family']};
const ITEM_TYPE = {enum: ['track', 'episode']};
const DOWNLOAD_TYPE = {enum: ['track', 'album', 'episode']};
const SAVE_TYPE = {enum: ['track', 'album']};
const PROGRESS_STATE = {enum: ['unplayed', 'in_progress', 'played']};
const VISIBILITY = {enum: ['private', 'shared', 'collaborative']};
const START_REASON = {enum: ['user', 'autoplay', 'queue', 'voice']};
const END_REASON = {enum: ['completed', 'paused', 'stopped', 'skipped', 'interrupted']};
const DOWNLOAD_STATUS = {enum: ['queued', 'downloaded', 'needs_check', 'removed']};
const REMOVED_REASON = {enum: ['removed_by_agent', 'cancelled', 'auto_delete', 'auto_download_limit', 'item_removed', 'member_removed']};
const SPEED = {type: 'number', minimum: 0.5, maximum: 3};
const SECONDS = int(0, 86400);
const BYTES = int(0, 1e12);
const CENTS = int(0, 10000000);

// ---------------------------------------------------------------- seed records
const CHAPTER = obj({title: text(120), start_s: SECONDS});
const episodeFields = {
  episode_id: ID, show_id: ID, number: int(1, 100000), title: text(200), published_at: TIME,
  duration_s: int(1, 86400), end_of_content_s: int(1, 86400), chapters: arr(CHAPTER, 40), notes: text(2000),
  bytes: int(1, 1e10), explicit: BOOL,
};
const ARTIST = obj({artist_id: ID, name: text(200), bio: text(1000)});
const ALBUM = obj({album_id: ID, artist_id: ID, title: text(200), released: {type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$'},
  track_ids: arr(ID, 100, {minItems: 1, uniqueItems: true}), availability: AVAILABILITY});
const TRACK = obj({track_id: ID, album_id: ID, artist_id: ID, title: text(200), duration_s: int(1, 7200), explicit: BOOL,
  clean_version_id: nullable(ID), bytes: int(1, 1e9), availability: AVAILABILITY});
const SHOW = obj({show_id: ID, title: text(200), publisher: text(200), description: text(1000), explicit: BOOL, availability: AVAILABILITY});
const EPISODE = obj({...episodeFields, availability: AVAILABILITY});
const PLAN = obj({plan_id: PLAN_ID, name: text(60), max_members: int(1, 6), monthly_price_cents: CENTS, rank: int(1, 3)});
const MEMBER = obj({member_id: ID, person_id: ID, display_name: text(100), role: {enum: ['manager', 'member']},
  age_group: {enum: ['adult', 'teen', 'child']}, status: {enum: ['active', 'removed']}, explicit_filter: BOOL,
  joined_at: TIME, removed_at: nullable(TIME)});
const INVITATION = obj({invitation_id: ID, person_id: ID, invited_by: ID, invited_at: TIME, explicit_filter: BOOL,
  status: {enum: ['open', 'accepted', 'declined']}, responded_at: nullable(TIME)});
const BILLING = obj({
  currency: {const: 'USD'}, anchor: TIME,
  timeline: arr(obj({plan_id: PLAN_ID, from: TIME, set_at: TIME, change: {enum: ['start', 'upgrade', 'downgrade']}}), 500, {minItems: 1}),
  adjustments: arr(obj({adjustment_id: ID, invoice_id: ID, amount_cents: CENTS, reason: {const: 'upgrade_proration'},
    from_plan_id: PLAN_ID, to_plan_id: PLAN_ID, created_at: TIME}), 500),
  payments: arr(obj({invoice_id: ID, outcome: {enum: ['paid', 'declined']}, at: TIME, amount_cents: CENTS}), 2000),
});
const DEVICE = obj({device_id: ID, member_id: ID, name: text(100), kind: {enum: ['phone', 'earbuds', 'smart_speaker', 'car', 'tablet', 'computer']},
  storage_cap_bytes: BYTES, auto_download: BOOL, last_checkin_at: TIME, registered_at: TIME});
const sessionFields = {
  session_id: ID, member_id: ID, device_id: ID, item_type: ITEM_TYPE, item_id: ID, started_at: TIME,
  start_reason: START_REASON, speed: SPEED, start_position_s: SECONDS, end_position_s: SECONDS, end_reason: END_REASON,
};
const SESSION = obj({...sessionFields, ended_at: TIME, speaker_hint: nullable(text(100))});
const PROGRESS = obj({member_id: ID, episode_id: ID, state: PROGRESS_STATE, position_s: SECONDS, updated_at: TIME,
  played_at: nullable(TIME), set_by: {enum: ['session', 'agent']},
  replaced: nullable(obj({state: PROGRESS_STATE, position_s: SECONDS}))});
const PLAY = obj({member_id: ID, track_id: ID, count: int(1), last_played_at: TIME});
const FOLLOW = obj({member_id: ID, show_id: ID, followed_at: TIME, auto_download_count: int(0, 10), auto_delete_days: nullable(int(1, 90))});
const UPNEXT = obj({member_id: ID, list_version: int(1), updated_at: TIME, episode_ids: arr(ID, 100, {uniqueItems: true})});
const DOWNLOAD = obj({download_id: ID, member_id: ID, device_id: ID, item_type: DOWNLOAD_TYPE, item_id: ID, bytes: int(1, 1e10),
  source: {enum: ['manual', 'auto']}, requested_at: TIME, completes_at: TIME, auto_delete_at: nullable(TIME),
  removed_at: nullable(TIME), removed_reason: nullable(REMOVED_REASON)});
const SAVED = obj({member_id: ID, item_type: SAVE_TYPE, item_id: ID, saved_at: TIME});
const PLAYLIST_TRACK = obj({track_id: ID, added_by: ID, added_at: TIME});
const PLAYLIST = obj({playlist_id: ID, owner_member_id: ID, name: text(100), description: text(300, 0), visibility: VISIBILITY,
  collaborators: arr(ID, 6, {uniqueItems: true}), tracks: arr(PLAYLIST_TRACK, 500), track_version: int(1),
  created_at: TIME, updated_at: TIME, origin: {enum: ['seed', 'agent']}});
const NOTICE = obj({notice_id: ID, member_id: ID, created_at: TIME, kind: {enum: ['episode_published', 'playlist_edited', 'payment_declined']},
  text: text(500), object_type: {enum: ['episode', 'playlist', 'invoice']}, object_id: ID, event_id: ID});
// later_history_removed: the stored records, by family, that a change at an earlier clock removed or replaced
// (see src/visible.cjs). Optional, so rows written before it existed stay valid.
const ACTIVITY_FIELDS = {seq: int(1), at: TIME, actor: {enum: ['agent', 'event']}, action: text(60), object_type: text(40), object_id: ID,
  member_id: nullable(ID), replaced: ANY, request_id: nullable(ID), event_id: nullable(ID)};
const ACTIVITY = obj({...ACTIVITY_FIELDS, later_history_removed: nullable({type: 'object', additionalProperties: {type: 'array'}})}, Object.keys(ACTIVITY_FIELDS));

const seed = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:pale:tidepool:seed:1',
  ...obj({
    account_id: ID, owner_person_id: ID,
    family: obj({family_id: ID, name: text(100), created_at: TIME}),
    members: arr(MEMBER, 50, {minItems: 1}), invitations: arr(INVITATION, 200),
    plans: arr(PLAN, 3, {minItems: 3}), billing: BILLING,
    artists: arr(ARTIST, 500), albums: arr(ALBUM, 1000), tracks: arr(TRACK, 5000), shows: arr(SHOW, 200), episodes: arr(EPISODE, 5000),
    devices: arr(DEVICE, 50), sessions: arr(SESSION, 10000), progress: arr(PROGRESS, 10000), plays: arr(PLAY, 10000),
    follows: arr(FOLLOW, 1000), upnext: arr(UPNEXT, 50), downloads: arr(DOWNLOAD, 5000), library: arr(SAVED, 5000),
    playlists: arr(PLAYLIST, 500), notifications: arr(NOTICE, 5000), activity: arr(ACTIVITY, 20000), next_seq: int(1),
  }),
};

// ---------------------------------------------------------------- events
const OPS = arr(obj({op: {enum: ['add', 'remove', 'move']}, track_id: ID, position: int(1, 500)}, ['op', 'track_id']), 50, {minItems: 1});
const ev = (operation, payload) => obj({event_id: ID, at: TIME, operation: {const: operation}, payload});
const events = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:pale:tidepool:events:1',
  oneOf: [
    ev('listening.record', obj({...sessionFields, speaker_hint: text(100)}, Object.keys(sessionFields))),
    ev('episode.publish', obj(episodeFields)),
    ev('catalog.update', obj({item_type: {enum: ['track', 'album', 'show', 'episode']}, item_id: ID, availability: {const: 'removed'}, explicit: BOOL},
      ['item_type', 'item_id'])),
    ev('playlist.edit', {oneOf: [
      obj({playlist_id: ID, author_member_id: ID, operations: OPS}),
      obj({playlist_ref: obj({owner_member_id: ID, name: text(100)}), author_member_id: ID, operations: OPS}),
    ]}),
    ev('device.checkin', obj({device_id: ID})),
    ev('billing.payment_result', obj({invoice_id: ID, outcome: {enum: ['paid', 'declined']}})),
    ev('family.invite_response', obj({invitee_person_id: ID, response: {enum: ['accepted', 'declined']}})),
  ],
};

// ---------------------------------------------------------------- tool outputs
const PROGRESS_VIEW = obj({state: PROGRESS_STATE, position_s: SECONDS});
const TRACK_VIEW = obj({item_type: {const: 'track'}, track_id: ID, title: text(200), artist_id: ID, artist_name: text(200),
  album_id: ID, album_title: text(200), duration_s: int(1), explicit: BOOL, clean_version_id: nullable(ID), filtered: BOOL,
  availability: AVAILABILITY, bytes: int(1)});
const ALBUM_VIEW = obj({item_type: {const: 'album'}, album_id: ID, title: text(200), artist_id: ID, artist_name: text(200),
  released: {type: 'string'}, track_count: int(0), duration_s: int(0), bytes: int(0), explicit_tracks: int(0), availability: AVAILABILITY});
const ARTIST_VIEW = obj({item_type: {const: 'artist'}, artist_id: ID, name: text(200), album_count: int(0)});
const SHOW_VIEW = obj({item_type: {const: 'show'}, show_id: ID, title: text(200), publisher: text(200), explicit: BOOL,
  availability: AVAILABILITY, episode_count: int(0), latest_episode_id: nullable(ID), following: BOOL});
const EPISODE_VIEW = obj({item_type: {const: 'episode'}, episode_id: ID, show_id: ID, show_title: text(200), number: int(1),
  title: text(200), published_at: TIME, duration_s: int(1), explicit: BOOL, filtered: BOOL, availability: AVAILABILITY,
  bytes: int(1), progress: PROGRESS_VIEW});
const ITEM_VIEW = {anyOf: [TRACK_VIEW, ALBUM_VIEW, ARTIST_VIEW, SHOW_VIEW, EPISODE_VIEW]};
const ITEM_FULL = {anyOf: [
  obj({...TRACK_VIEW.properties, plays: int(0)}),
  obj({...ALBUM_VIEW.properties, tracks: arr(TRACK_VIEW, 100), saved: BOOL}),
  obj({...ARTIST_VIEW.properties, bio: text(1000), albums: arr(ALBUM_VIEW, 100)}),
  obj({...SHOW_VIEW.properties, description: text(1000)}),
  obj({...EPISODE_VIEW.properties, end_of_content_s: int(1), chapters: arr(CHAPTER, 40), notes: text(2000),
    played_at: nullable(TIME)}),
]};
const LINE = obj({kind: {enum: ['plan', 'upgrade_proration']}, plan_id: PLAN_ID, amount_cents: CENTS});
const INVOICE = obj({invoice_id: ID, period_start: TIME, period_end: TIME, plan_id: PLAN_ID, amount_cents: CENTS,
  lines: arr(LINE, 50), status: {enum: ['paid', 'declined', 'pending', 'upcoming']}});
const SCHEDULED = nullable(obj({plan_id: PLAN_ID, effective_at: TIME}));
const PLAN_VIEW = obj({plan_id: PLAN_ID, name: text(60), max_members: int(1), monthly_price_cents: CENTS, scheduled_change: SCHEDULED});
const PAYMENT_DUE = nullable(obj({invoice_id: ID, amount_cents: CENTS, declined_at: TIME, grace_ends_at: TIME, grace_expired: BOOL}));
const BILLING_VIEW = obj({status: {enum: ['active', 'payment_due']}, currency: {const: 'USD'}, period_start: TIME, period_end: TIME,
  current_invoice: INVOICE, next_invoice: INVOICE, payment_due: PAYMENT_DUE});
const SLOTS = obj({limit: int(1), active_members: int(0), open_invitations: int(0), available: int(0), limit_after_scheduled_change: nullable(int(1))});
const IMPACT = obj({downloads_removed: int(0), bytes_freed: BYTES, collaborations_ended: int(0), playlist_ids: arr(ID, 500),
  owned_playlists_hidden: int(0), owned_playlist_ids: arr(ID, 500)});
const DOWNLOAD_COUNTS = obj({queued: int(0), downloaded: int(0), needs_check: int(0), bytes: BYTES});
const MEMBER_FIELDS = {member_id: ID, person_id: ID, display_name: text(100), role: {enum: ['manager', 'member']},
  age_group: {enum: ['adult', 'teen', 'child']}, status: {enum: ['active', 'removed']}, explicit_filter: BOOL, joined_at: TIME, is_you: BOOL};
const INVITATION_VIEW = obj({invitation_id: ID, person_id: ID, display_name: text(200), status: {enum: ['open', 'accepted', 'declined']},
  invited_at: TIME, responded_at: nullable(TIME), explicit_filter: BOOL});
const DEVICE_VIEW = obj({device_id: ID, name: text(100), kind: DEVICE.properties.kind, storage_cap_bytes: BYTES, used_bytes: BYTES,
  free_bytes: BYTES, offline_capable: BOOL, auto_download: BOOL, last_checkin_at: TIME, offline_check_due_at: TIME, offline_check_overdue: BOOL});
const SESSION_VIEW = obj({session_id: ID, device_id: ID, device_name: text(100), item_type: ITEM_TYPE, item_id: ID, title: text(200),
  context_title: text(200), started_at: TIME, ended_at: TIME, start_reason: START_REASON, speed: SPEED, start_position_s: SECONDS,
  end_position_s: SECONDS, end_reason: END_REASON, speaker_hint: nullable(text(100))});
const PROGRESS_ROW = obj({episode_id: ID, show_id: ID, title: text(200), duration_s: int(1), state: PROGRESS_STATE, position_s: SECONDS,
  played_at: nullable(TIME), updated_at: nullable(TIME), set_by: nullable({enum: ['session', 'agent']}),
  replaced: nullable(PROGRESS_VIEW)});
const DOWNLOAD_VIEW = obj({download_id: ID, device_id: ID, item_type: DOWNLOAD_TYPE, item_id: ID, title: text(200), context_title: text(200),
  bytes: int(1), source: {enum: ['manual', 'auto']}, status: DOWNLOAD_STATUS,
  status_reasons: arr({enum: ['offline_check_overdue', 'payment_grace_expired', ...REMOVED_REASON.enum]}, 4),
  requested_at: TIME, completes_at: TIME, auto_delete_at: nullable(TIME), removed_at: nullable(TIME), played: nullable(BOOL)});
const DEVICE_SPACE = obj({device_id: ID, storage_cap_bytes: BYTES, used_bytes: BYTES, free_bytes: BYTES});
const PLAYLIST_SUMMARY_FIELDS = {playlist_id: ID, name: text(100), description: text(300, 0), owner_member_id: ID, owner_name: text(100),
  visibility: VISIBILITY, your_role: {enum: ['owner', 'collaborator', 'viewer']}, collaborators: arr(ID, 6), track_count: int(0),
  track_version: int(1), updated_at: TIME};
const PLAYLIST_ENTRY = obj({position: int(1), track_id: ID, title: text(200), artist_name: text(200), duration_s: int(1), explicit: BOOL,
  clean_version_id: nullable(ID), availability: AVAILABILITY, added_by: ID, added_by_name: text(100), added_at: TIME, skipped_for_you: BOOL});
const NOTICE_VIEW = obj({notice_id: ID, kind: NOTICE.properties.kind, created_at: TIME, text: text(500), object_type: NOTICE.properties.object_type,
  object_id: ID, event_id: ID});
const QUOTE = obj({from_plan_id: PLAN_ID, to_plan_id: PLAN_ID, change: {enum: ['upgrade', 'downgrade', 'none']}, allowed: BOOL,
  blocked_by: nullable({enum: ['too_many_members', 'payment_due', 'same_plan', 'already_scheduled']}), effective_at: TIME,
  proration_cents: CENTS, members_counted: int(0), new_limit: int(1), replaces_scheduled_change: SCHEDULED, next_invoice: INVOICE});
const LIMIT = max => int(1, max);
const MEMBER_ID = {...ID, description: 'member_id of the family member this call affects (see family.get or members.list; is_you marks the signed-in member).'};

// Every write receipt: null, or how many stored records dated after the clock the write removed or replaced,
// by family. Only counts: the receipt goes to the Agent, and those records can belong to other members or
// describe the future. Their IDs and stored values are in the activity row. This happens only when a seed
// that runs past its clock is loaded early.
const LATER = nullable({type: 'object', additionalProperties: int(1)});
function tool(name, description, readOnly, input, output, required = Object.keys(input)) {
  const inputSchema = readOnly ? obj(input, required)
    : obj({...input, expected_version: VERSION, request_id: ID}, [...required, 'expected_version', 'request_id']);
  for (const key of ['status', 'app_id', 'version']) if (key in output) throw Error(name + ' output cannot redefine Core field ' + key);
  const outputSchema = obj({status: {const: readOnly ? 'ok' : 'committed'}, app_id: {const: APP}, version: VERSION, ...output,
    ...(readOnly ? {} : {later_history_removed: LATER})});
  const target = 'id' in input ? 'member named by id in the bound family account' : 'bound family account';
  return {name: APP + '.' + name, description, read_only: readOnly, scope: APP + '.' + name, resource_target: target, inputSchema, outputSchema};
}
const OWN = 'id must be the signed-in member; another member returns forbidden.';

const tools = [
  // ---------------------------------------------------------------- 16 reads
  tool('catalog.search',
    'Search the music and podcast catalog by words in titles, artist, album, show and publisher names (case- and accent-insensitive; each query word must match the start of a word). Optional item_type narrows to track, album, artist, show or episode. Removed items are left out. For a member with the explicit filter on, explicit items are marked filtered and a filtered track\'s clean version (same title and artist) is included. Returns up to limit (default 20) results; total counts every match.',
    true, {query: text(200), item_type: {enum: ['track', 'album', 'artist', 'show', 'episode']}, limit: LIMIT(50)},
    {total: int(0), results: arr(ITEM_VIEW, 50)}, ['query']),
  tool('catalog.get_item',
    'Read one catalog item by ID: a track, album (with its tracks), artist (with albums), show or episode (chapters, notes, end-of-content marker, and the signed-in member\'s progress). Removed items stay readable with availability "removed". Unknown IDs return not_found.',
    true, {item_id: ID}, {item: ITEM_FULL}),
  tool('shows.get_episodes',
    'List a show\'s episodes, newest first (default limit 30), with the signed-in member\'s progress on each.',
    true, {show_id: ID, limit: LIMIT(200)}, {show: SHOW_VIEW, total: int(0), episodes: arr(EPISODE_VIEW, 200)}, ['show_id']),
  tool('family.get',
    'Read the family account: members (download counts are shown for your own row, and for every member when you are the plan manager, with what removing each member would end), open invitations, member slots, the plan in effect now, any scheduled plan change, and billing as of now (current period, the current and next invoice, and payment-due state with its 7-day grace period).',
    true, {}, {family: obj({family_id: ID, name: text(100)}), you: ID, manager_member_id: ID, plan: PLAN_VIEW, billing: BILLING_VIEW,
      slots: SLOTS, members: arr(obj({...MEMBER_FIELDS, downloads: nullable(DOWNLOAD_COUNTS), if_removed: nullable(IMPACT)}), 50),
      invitations: arr(INVITATION_VIEW, 200)}),
  tool('members.list',
    'List family members (role, age group, status, explicit filter) and invitations. is_you marks the signed-in member, whose member_id is the id for member-scoped tools.',
    true, {}, {members: arr(obj(MEMBER_FIELDS), 50), invitations: arr(INVITATION_VIEW, 200)}),
  tool('devices.list',
    'List the devices signed in to a member\'s account, with Tidepool storage cap, used and free bytes, auto-download, and the 30-day offline check (last check-in and when downloads turn to needs_check). ' + OWN,
    true, {id: MEMBER_ID}, {devices: arr(DEVICE_VIEW, 50)}),
  tool('history.list',
    'List a member\'s listening sessions, newest first (default limit 50): device, item, start reason, speed, start and end positions, and any unverified speaker_hint. Sessions on a shared device appear under the account signed in on that device. ' + OWN,
    true, {id: MEMBER_ID, device_id: ID, item_type: ITEM_TYPE, since: TIME, until: TIME, limit: LIMIT(200)},
    {total: int(0), sessions: arr(SESSION_VIEW, 200)}, ['id']),
  tool('progress.get',
    'Read a member\'s episode progress (unplayed, in_progress with position, or played). Give episode_ids for specific episodes, show_id for one show, or neither for every episode with recorded progress (most recently updated first). Agent changes show set_by "agent" and the value they replaced. ' + OWN,
    true, {id: MEMBER_ID, episode_ids: arr(ID, 100, {minItems: 1, uniqueItems: true}), show_id: ID},
    {progress: arr(PROGRESS_ROW, 5000)}, ['id']),
  tool('follows.list',
    'List the shows a member follows with per-show auto-download (newest n episodes) and auto-delete (days after played) settings. ' + OWN,
    true, {id: MEMBER_ID}, {follows: arr(obj({show_id: ID, title: text(200), followed_at: TIME, auto_download_count: int(0, 10),
      auto_delete_days: nullable(int(1, 90)), latest_episode_id: nullable(ID), unplayed_count: int(0)}), 1000)}),
  tool('upnext.get',
    'Read a member\'s Up Next queue in order, with its list_version, each episode\'s progress and remaining time, download status per device, and the total remaining time at 1x speed. Remaining time is from the saved position for an in-progress episode, and the full duration for any other entry (a played episode plays again from the start). ' + OWN,
    true, {id: MEMBER_ID}, {list_version: int(1), updated_at: nullable(TIME), total_remaining_s: int(0),
      entries: arr(obj({position: int(1), episode_id: ID, show_title: text(200), title: text(200), duration_s: int(1), state: PROGRESS_STATE,
        position_s: SECONDS, remaining_s: int(0), availability: AVAILABILITY,
        downloads: arr(obj({device_id: ID, download_id: ID, status: DOWNLOAD_STATUS}), 50)}), 100)}),
  tool('downloads.list',
    'List a member\'s downloads with each one\'s current status: queued until its completion time, then downloaded; needs_check once the device is more than 30 days past its last check-in or a declined payment is past its grace period; removed when cancelled, removed, or auto-deleted. Removed downloads are left out unless include_removed is true. Also returns storage per device. ' + OWN,
    true, {id: MEMBER_ID, device_id: ID, status: DOWNLOAD_STATUS, include_removed: BOOL},
    {downloads: arr(DOWNLOAD_VIEW, 5000), devices: arr(DEVICE_SPACE, 50)}, ['id']),
  tool('library.list',
    'List a member\'s saved tracks and albums, most recently saved first. ' + OWN,
    true, {id: MEMBER_ID, item_type: SAVE_TYPE}, {items: arr(obj({item_type: SAVE_TYPE, item_id: ID, title: text(200), artist_name: text(200),
      saved_at: TIME, availability: AVAILABILITY, explicit: BOOL, filtered: BOOL, bytes: int(0)}), 5000)}, ['id']),
  tool('playlists.list',
    'List the playlists a member can see: their own, and other active members\' shared or collaborative playlists. your_role says whether the member owns, collaborates on or only views each one. ' + OWN,
    true, {id: MEMBER_ID}, {playlists: arr(obj(PLAYLIST_SUMMARY_FIELDS), 500)}),
  tool('playlists.get',
    'Read one playlist the member can see, with every track entry, who added it and when. A track that is explicit while the member\'s explicit filter is on stays in the playlist and is marked skipped_for_you. ' + OWN,
    true, {id: MEMBER_ID, playlist_id: ID}, {playlist: obj({...PLAYLIST_SUMMARY_FIELDS, created_at: TIME, tracks: arr(PLAYLIST_ENTRY, 500)})}),
  tool('notifications.list',
    'List a member\'s in-app notices, newest first (default limit 50): new episodes of followed shows, edits by others to their collaborative playlists, and declined payments (manager). ' + OWN,
    true, {id: MEMBER_ID, limit: LIMIT(200)}, {notifications: arr(NOTICE_VIEW, 200)}, ['id']),
  tool('plan.preview_change',
    'Quote a plan change without applying it, computed by the same rules plan.confirm_change would apply now: whether it is an upgrade (applies at once; the prorated price difference for the rest of the current period is added to the next invoice), a downgrade (scheduled for the end of the current period, refused if active members plus open invitations exceed the new limit) or none (the plan in effect, which revokes any scheduled change), whether it is allowed (blocked_by explains why not), and the resulting next invoice.',
    true, {plan_id: PLAN_ID}, {quote: QUOTE}),

  // ---------------------------------------------------------------- 17 writes
  tool('progress.set',
    'Set a member\'s progress on one episode: state unplayed, in_progress (position_s required, 1 to the episode duration) or played. Records set_by "agent" with the value it replaced and adds no listening session. A position beyond the duration returns invalid_position. ' + OWN,
    false, {id: MEMBER_ID, episode_id: ID, state: PROGRESS_STATE, position_s: SECONDS},
    {member_id: ID, episode_id: ID, state: PROGRESS_STATE, position_s: SECONDS, set_by: {const: 'agent'}, replaced: PROGRESS_VIEW,
      auto_delete_at: nullable(TIME)}, ['id', 'episode_id', 'state']),
  tool('follows.add',
    'Follow a show for a member, optionally with auto-download of the newest n episodes (0 = off, default 0) and auto-delete of played episodes after d days (default off). Auto-delete also applies to downloads of episodes already played, counted from when each was played or downloaded, whichever is later. Following a show already followed changes nothing; settings that differ from the existing follow return invalid_arguments (use follows.update_settings). ' + OWN,
    false, {id: MEMBER_ID, show_id: ID, auto_download_count: int(0, 10), auto_delete_days: nullable(int(1, 90))},
    {member_id: ID, show_id: ID, following: {const: true}, changed: BOOL, downloads_scheduled_for_auto_delete: int(0)}, ['id', 'show_id']),
  tool('follows.remove',
    'Unfollow a show for a member. The show\'s downloads are kept (and no longer auto-deleted) unless removed with downloads.remove. ' + OWN,
    false, {id: MEMBER_ID, show_id: ID}, {member_id: ID, show_id: ID, following: {const: false}, downloads_kept: int(0)}),
  tool('follows.update_settings',
    'Change a followed show\'s settings. patch may set auto_download_count (0-10) and auto_delete_days (1-90, or null for off). A new auto-delete window applies to already-played downloads of the show, counted from when each was played or downloaded, whichever is later; a window that has already passed removes them now. ' + OWN,
    false, {id: MEMBER_ID, show_id: ID, patch: obj({auto_download_count: int(0, 10), auto_delete_days: nullable(int(1, 90))}, [])},
    {member_id: ID, show_id: ID, auto_download_count: int(0, 10), auto_delete_days: nullable(int(1, 90)),
      replaced: obj({auto_download_count: int(0, 10), auto_delete_days: nullable(int(1, 90))}), downloads_scheduled_for_auto_delete: int(0)}),
  tool('upnext.set',
    'Replace a member\'s whole Up Next queue with episode_ids in order (an empty list clears it). expected_list_version must equal the list_version from upnext.get; otherwise the App returns list_version_mismatch (separate from Core\'s expected_version check). Returns the new list_version. Removed episodes return unavailable. ' + OWN,
    false, {id: MEMBER_ID, episode_ids: arr(ID, 100, {uniqueItems: true}), expected_list_version: int(1)},
    {member_id: ID, list_version: int(2), episode_ids: arr(ID, 100), replaced: arr(ID, 100)}),
  tool('downloads.add',
    'Download a track, album or episode to one of the member\'s devices. The item\'s bytes are reserved at once and the download completes one minute later (status queued until completes_at). Exceeding the device\'s free Tidepool storage returns storage_full and changes nothing; a removed item returns unavailable; a device without offline storage returns unavailable; a payment past its grace period returns payment_due. An item already on the device returns the existing download with changed false. ' + OWN,
    false, {id: MEMBER_ID, device_id: ID, item_type: DOWNLOAD_TYPE, item_id: ID},
    {member_id: ID, download_id: ID, device_id: ID, item_type: DOWNLOAD_TYPE, item_id: ID, bytes: int(1), download_status: DOWNLOAD_STATUS,
      completes_at: TIME, free_bytes_after: BYTES, changed: BOOL}),
  tool('downloads.remove',
    'Remove one of the member\'s downloads, or cancel it if still queued, releasing its reserved bytes. Returns the bytes freed. ' + OWN,
    false, {id: MEMBER_ID, download_id: ID}, {member_id: ID, download_id: ID, previous_status: DOWNLOAD_STATUS, bytes_freed: BYTES, free_bytes_after: BYTES}),
  tool('library.save',
    'Save a track or album to a member\'s library. Saving an item already saved changes nothing; a removed item returns unavailable. ' + OWN,
    false, {id: MEMBER_ID, item_type: SAVE_TYPE, item_id: ID}, {member_id: ID, item_type: SAVE_TYPE, item_id: ID, saved: {const: true}, changed: BOOL}),
  tool('library.unsave',
    'Remove a saved track or album from a member\'s library. Fails with not_found if it is not saved. ' + OWN,
    false, {id: MEMBER_ID, item_type: SAVE_TYPE, item_id: ID}, {member_id: ID, item_type: SAVE_TYPE, item_id: ID, saved: {const: false}}),
  tool('playlists.create',
    'Create a playlist owned by the member, with a name, visibility (private, shared or collaborative), optional collaborators (other active members; they can add, remove and reorder tracks while the playlist is collaborative) and optional starting tracks in order. Removed tracks return unavailable. ' + OWN,
    false, {id: MEMBER_ID, name: text(100), description: text(300, 0), visibility: VISIBILITY, collaborators: arr(ID, 6, {uniqueItems: true}),
      track_ids: arr(ID, 500, {uniqueItems: true})},
    {playlist_id: ID, owner_member_id: ID, name: text(100), visibility: VISIBILITY, collaborators: arr(ID, 6), track_count: int(0), track_version: int(1)},
    ['id', 'name', 'visibility']),
  tool('playlists.update_tracks',
    'Edit a playlist\'s tracks as the member (its owner, or a collaborator while it is collaborative). operations apply in order: add (track_id, optional 1-based position; past the end appends), remove (track_id) and move (track_id to position). Added tracks record the member as their author. Optional expected_track_version must equal the playlist\'s track_version (list_version_mismatch otherwise). A track already in the playlist returns invalid_arguments. Returns the new track_version. ' + OWN,
    false, {id: MEMBER_ID, playlist_id: ID, operations: OPS, expected_track_version: int(1)},
    {playlist_id: ID, track_version: int(2), track_count: int(0), track_ids: arr(ID, 500)}, ['id', 'playlist_id', 'operations']),
  tool('playlists.update_settings',
    'Change a playlist\'s settings as its owner. patch may set name, description, visibility and collaborators (the full new list). A collaborator or viewer returns forbidden. Removing a collaborator keeps the tracks they added. ' + OWN,
    false, {id: MEMBER_ID, playlist_id: ID, patch: obj({name: text(100), description: text(300, 0), visibility: VISIBILITY,
      collaborators: arr(ID, 6, {uniqueItems: true})}, [])},
    {playlist_id: ID, name: text(100), visibility: VISIBILITY, collaborators: arr(ID, 6), replaced: {type: 'object'}}),
  tool('members.invite',
    'Plan manager only: invite a person to the family. id is the invitee\'s person_id from the run binding. An open invitation holds a member slot (counted against the smaller plan while a downgrade is scheduled), so accepting it never exceeds the limit. Errors: already_member, already_invited, too_many_members, forbidden.',
    false, {id: {...ID, description: 'person_id of the person to invite'}, explicit_filter: BOOL},
    {invitation_id: ID, person_id: ID, invitation_status: {const: 'open'}, slots: SLOTS}, ['id']),
  tool('members.remove',
    'Plan manager only: remove a member (id) from the family. Their downloads are removed, their edit access to other members\' collaborative playlists ends (tracks they added stay), and their own shared and collaborative playlists leave the family view. Returns the same counts family.get showed under if_removed. The manager cannot remove themself (forbidden).',
    false, {id: MEMBER_ID}, {member_id: ID, member_status: {const: 'removed'}, ...IMPACT.properties}),
  tool('filters.update',
    'Plan manager only: change a member\'s explicit-content filter. id is the member whose filter changes; patch.explicit_filter is the new value. Returns the replaced value. Any other caller returns forbidden.',
    false, {id: MEMBER_ID, patch: obj({explicit_filter: BOOL})},
    {member_id: ID, explicit_filter: BOOL, replaced: obj({explicit_filter: BOOL}), changed: BOOL}),
  tool('plan.confirm_change',
    'Plan manager only (id is the manager\'s own member_id; any other member returns forbidden): change the family plan, using the same rules as plan.preview_change. An upgrade applies at once and adds its prorated difference to the next invoice (refused with payment_due while a payment is due); a downgrade is scheduled for the end of the current period and is refused with too_many_members if active members plus open invitations exceed the new limit. Choosing the plan already in effect keeps it: a scheduled change is revoked (revoked_change), and with none scheduled the call returns invalid_arguments, as does repeating a downgrade already scheduled.',
    false, {id: {...ID, description: 'member_id of the plan manager making the change (the signed-in member).'}, plan_id: PLAN_ID},
    {change: {enum: ['upgrade', 'downgrade', 'none']}, plan_id: PLAN_ID, effective_at: TIME,
      proration_cents: CENTS, scheduled_change: SCHEDULED, revoked_change: SCHEDULED, next_invoice: INVOICE}),
  tool('plan.revoke_change',
    'Plan manager only (id is the manager\'s own member_id; any other member returns forbidden): cancel the scheduled plan change before it takes effect. Returns no_pending_change if none is scheduled.',
    false, {id: {...ID, description: 'member_id of the plan manager making the change (the signed-in member).'}},
    {revoked: obj({plan_id: PLAN_ID, effective_at: TIME}), plan_id: PLAN_ID}),
];

if (tools.length !== 33 || tools.filter(t => t.read_only).length !== 16) throw Error('Expected 16 read and 17 write tools.');
const write = (file, value) => fs.writeFileSync(path.join(out, file), JSON.stringify(value, null, 2) + '\n');
write('schemas/seed.schema.json', seed);
write('schemas/events.schema.json', events);
write('tools.json', tools);
console.log('wrote', tools.length, 'tools');
