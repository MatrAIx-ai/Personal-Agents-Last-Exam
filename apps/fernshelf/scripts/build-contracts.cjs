#!/usr/bin/env node
'use strict';
// Authoring-time generator for Fernshelf's own contracts: tools.json, schemas/seed.schema.json,
// schemas/events.schema.json and schemas/state.schema.json come from the definitions below, so
// record shapes are written once. `--check` fails on drift (run by the business tests).
// Shared platform schema copies (bundle, dataset, ...) are kept in sync by the repository's
// `npm run contracts:check`; this script reads only files inside the package.
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const {KINDS} = require('../src/notify.cjs');
const app = require('../app.json');

const ID = {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
const TS = {type: 'string', format: 'date-time'};
const DATE = {type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$'};
const HASH = {type: 'string', pattern: '^sha256:[0-9a-f]{64}$'};
const BOOL = {type: 'boolean'};
const BYTES = {type: 'integer', minimum: 1, maximum: 1e13};
const PIXELS = {type: 'integer', minimum: 1, maximum: 100000};
const str = (max = 200, min = 1) => ({type: 'string', minLength: min, maxLength: max});
const nul = s => ({anyOf: [s, {type: 'null'}]});
const arr = (items, extra = {}) => ({type: 'array', items, ...extra});
const en = (...values) => ({enum: values});
function obj(properties, optional = [], open = false) {
  return {type: 'object', properties, required: Object.keys(properties).filter(k => !optional.includes(k)), additionalProperties: open};
}
const ref = name => ({$ref: 'seed.schema.json#/$defs/' + name});
const VERSION = obj({epoch: {type: 'integer', minimum: 1}, revision: {type: 'integer', minimum: 0}});
const KIND = en('photo', 'video');
const SOURCE = en('camera', 'screenshot', 'download', 'saved_from_share');
const LABELS = arr(ID, {uniqueItems: true, maxItems: 50});
const IDS_MANY = arr(ID, {uniqueItems: true, maxItems: 5000});

const defs = {};
defs.account = obj({display_name: str(120), plan: str(80), quota_bytes: BYTES, trash_retention_days: {type: 'integer', minimum: 1, maximum: 365},
  time_zone: str(64), email_notices: BOOL, opened_at: TS});
defs.person = obj({person_id: ID, display_name: str(120)});
defs.label = obj({id: ID, name: str(120), person_id: nul(ID)});
defs.place = obj({label: str(160), lat: nul({type: 'number', minimum: -90, maximum: 90}), lon: nul({type: 'number', minimum: -180, maximum: 180})});
defs.history_row = obj({at: TS, action: str(80), actor: en('seed', 'agent', 'event'), request_id: nul(ID), event_id: nul(ID), changes: {type: 'object'}}, ['changes']);
defs.removal_row = obj({removal_id: ID, person_id: ID, album_ids: arr(ID, {uniqueItems: true}), at: TS});
defs.item = obj({id: ID, kind: KIND, taken_at: TS, added_at: TS, place: nul(ref('place')), people: LABELS, caption: nul(str(2000)), source: SOURCE,
  favorite: BOOL, archived: BOOL, backed_up: BOOL, declared_bytes: BYTES, content_hash: nul(HASH), width: nul(PIXELS), height: nul(PIXELS),
  duration_ms: nul({type: 'integer', minimum: 1}), file: nul(ID), state: en('active', 'trashed', 'purged'), trashed_at: nul(TS), purge_at: nul(TS),
  purged_at: nul(TS), saved_from: nul(obj({album_id: ID, contribution_id: ID, person_id: ID})),
  removal_history: arr(ref('removal_row'), {maxItems: 100}), history: arr(ref('history_row'), {maxItems: 1000})});
defs.stack = obj({id: ID, kind: en('edit', 'burst', 'duplicate'), cover_id: nul(ID), item_ids: arr(ID, {minItems: 1, uniqueItems: true, maxItems: 100}), created_at: TS});
defs.contribution = obj({id: ID, person_id: ID, kind: KIND, taken_at: TS, place: nul(ref('place')), people: LABELS, caption: nul(str(2000)),
  declared_bytes: BYTES, content_hash: nul(HASH), width: nul(PIXELS), height: nul(PIXELS), added_at: TS, removed_at: nul(TS),
  removed_reason: nul(en('withdrawn', 'member_left', 'member_removed')), event_id: nul(ID)});
defs.member = obj({person_id: ID, role: en('viewer', 'contributor'), status: en('invited', 'joined', 'declined', 'left', 'removed'), invited_at: TS,
  joined_at: nul(TS), ended_at: nul(TS), history: arr(ref('history_row'), {maxItems: 200})});
defs.album = obj({id: ID, title: str(120), created_at: TS, created_by: en('seed', 'agent'), request_id: nul(ID), item_ids: IDS_MANY,
  members: arr(ref('member'), {maxItems: 100}), contributions: arr(ref('contribution'), {maxItems: 2000}), deleted_at: nul(TS)});
defs.link = obj({id: ID, album_id: ID, created_at: TS, expires_at: nul(TS), revoked_at: nul(TS), revoke_reason: nul(en('revoked', 'album_deleted')), request_id: nul(ID)});
defs.view = obj({id: ID, at: TS, surface: obj({type: en('link', 'album'), album_id: ID, link_id: nul(ID)}), viewer: obj({person_id: nul(ID), anonymous: BOOL}),
  viewed_item_ids: IDS_MANY, saved_item_ids: IDS_MANY, event_id: nul(ID), resolved_by_match: BOOL});
defs.answer = obj({decision: en('honor', 'decline'), note: nul(str(2000)), at: TS, request_id: nul(ID)});
defs.cleared = obj({item_id: ID, album_ids: arr(ID, {uniqueItems: true}), link_ids: arr(ID, {uniqueItems: true})});
defs.removal = obj({id: ID, from_person_id: ID, item_ids: arr(ID, {minItems: 1, uniqueItems: true, maxItems: 200}), not_removable: arr(ID, {uniqueItems: true}),
  scope: obj({type: en('album', 'everywhere'), album_id: nul(ID)}), message: nul(str(2000)), requested_at: TS, event_id: nul(ID),
  state: en('pending', 'honored', 'declined', 'withdrawn'), answers: arr(ref('answer'), {maxItems: 20}), cleared: nul(arr(ref('cleared'))),
  honored_at: nul(TS), withdrawn_at: nul(TS), withdraw_message: nul(str(2000))});
defs.notification = obj({id: ID, kind: en(...KINDS), at: TS, title: str(200), body: str(5000), object_type: str(60), object_id: ID, event_id: nul(ID),
  level: nul({anyOf: [{const: 80}, {const: 'full'}]}), wire: nul({type: 'object'})});
defs.activity = obj({seq: {type: 'integer', minimum: 1}, at: TS, actor: en('agent', 'event'), action: str(80), object_ids: arr(ID, {maxItems: 500}),
  request_id: nul(ID), event_id: nul(ID), warnings: arr({type: 'object'}, {maxItems: 500}), cause_seq: {type: 'integer', minimum: 1}, details: {type: 'object'}},
  ['cause_seq', 'details']);
const list = (def, max = 5000) => arr(ref(def), {maxItems: max});
const seed = {$schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Fernshelf account seed',
  description: 'One account holder\'s photo library with its history: items, stacks, people labels, albums with members and contributions, links with views and saves, removal requests, notifications and activity. Generated by scripts/build-contracts.cjs.',
  ...obj({account_id: ID, owner_person_id: ID, account: ref('account'), people: list('person', 500), labels: list('label', 200), items: list('item', 5000),
    stacks: list('stack', 1000), albums: list('album', 500), links: list('link', 500), views: list('view', 5000), removals: list('removal', 500),
    notifications: list('notification', 5000), activity: list('activity', 20000)}),
  $defs: defs};

// ---- events ------------------------------------------------------------------------------------
const MATCH = obj({person_id: ID, contains_item_ids: arr(ID, {minItems: 1, maxItems: 50, uniqueItems: true}), title: str(120)}, ['person_id', 'contains_item_ids', 'title']);
const PLACE_IN = obj({label: str(160), lat: {type: 'number', minimum: -90, maximum: 90}, lon: {type: 'number', minimum: -180, maximum: 180}}, ['lat', 'lon']);
const ITEMS_OR_ALL = {anyOf: [{const: 'all'}, arr(ID, {uniqueItems: true, maxItems: 500})]};
const albumRef = (rest, optional = []) => ({oneOf: [obj({album_id: ID, ...rest}, optional), obj({album_match: MATCH, ...rest}, optional)]});
const P = {};
P['item.added'] = obj({item_id: ID, kind: KIND, taken_at: TS, place: PLACE_IN, people: LABELS, caption: str(2000), source: en('camera', 'screenshot', 'download'),
  declared_bytes: BYTES, content_hash: HASH, width: PIXELS, height: PIXELS, duration_ms: {type: 'integer', minimum: 1},
  stack: obj({stack_id: ID, kind: en('edit', 'burst', 'duplicate')})}, ['place', 'people', 'caption', 'content_hash', 'width', 'height', 'duration_ms', 'stack']);
P['backup.resumed'] = obj({});
P['member.changed'] = albumRef({person_id: ID, change: en('join', 'decline', 'leave')});
const CONTRIB_IN = obj({item_id: ID, kind: KIND, taken_at: TS, place: PLACE_IN, people: LABELS, caption: str(2000), declared_bytes: BYTES, content_hash: HASH,
  width: PIXELS, height: PIXELS}, ['place', 'people', 'caption', 'content_hash', 'width', 'height']);
P['contribution.changed'] = albumRef({person_id: ID, add: arr(CONTRIB_IN, {maxItems: 50}), remove: arr(ID, {maxItems: 50, uniqueItems: true})}, ['add', 'remove']);
P['share.viewed'] = obj({view_id: ID,
  surface: {oneOf: [obj({type: {const: 'link'}, id: ID}), obj({type: {const: 'link'}, album_id: ID}), obj({type: {const: 'link'}, album_match: MATCH}),
    obj({type: {const: 'album'}, album_id: ID}), obj({type: {const: 'album'}, album_match: MATCH})]},
  viewer: {oneOf: [obj({person_id: ID}), obj({anonymous: {const: true}})]}, viewed_item_ids: ITEMS_OR_ALL, saved_item_ids: ITEMS_OR_ALL}, ['saved_item_ids']);
P['removal.requested'] = obj({removal_id: ID, from_person_id: ID, item_ids: arr(ID, {minItems: 1, maxItems: 200, uniqueItems: true}),
  scope: {oneOf: [obj({type: {const: 'album'}, album_id: ID}), obj({type: {const: 'album'}, album_match: MATCH}), obj({type: {const: 'everywhere'}})]},
  message: str(2000)}, ['message']);
P['removal.withdrawn'] = obj({removal_id: ID, message: str(2000)}, ['message']);
const operations = Object.keys(P).map(k => 'fernshelf.' + k);
const events = {$schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Fernshelf incoming events',
  description: 'What the device, album members, link viewers and people in the photos do, applied by Infra with env.apply_event. Generated by scripts/build-contracts.cjs.',
  type: 'object', properties: {event_id: ID, at: TS, operation: en(...operations), payload: {type: 'object'}}, required: ['event_id', 'at', 'operation', 'payload'],
  additionalProperties: false, anyOf: Object.entries(P).map(([k, payload]) => ({properties: {operation: {const: 'fernshelf.' + k}, payload}}))};

// ---- tools ---------------------------------------------------------------------------------------
// Published MCP schemas must be self-contained: inline every $ref.
function inline(schema) {
  if (Array.isArray(schema)) return schema.map(inline);
  if (!schema || typeof schema !== 'object') return schema;
  if (schema.$ref) return inline(defs[schema.$ref.split('/').pop()]);
  return Object.fromEntries(Object.entries(schema).map(([k, v]) => [k, inline(v)]));
}
const transfer = JSON.parse(fs.readFileSync(path.join(root, 'schemas/attachment-transfer.schema.json'), 'utf8'));
delete transfer.$id;
const any = (required = []) => ({type: 'object', required, additionalProperties: true});
const base = readOnly => ({status: {const: readOnly ? 'ok' : 'committed'}, app_id: {const: 'fernshelf'}, version: VERSION});
const BOUND = {anyOf: [DATE, TS]};
const WARNINGS = arr(obj({code: {const: 'removal_honored'}, item_id: ID, person_id: ID, removal_id: ID, honored_at: TS, message: str(400)}));
const MANY = arr(ID, {minItems: 1, maxItems: 500, uniqueItems: true});
const tools = [];
function tool(name, readOnly, description, input, output, optional = [], target = 'current account') {
  const inputSchema = readOnly ? obj(input, optional) : obj({...input, expected_version: VERSION, request_id: ID}, optional);
  tools.push({name: 'fernshelf.' + name, description, read_only: readOnly, scope: 'fernshelf.' + name, resource_target: target,
    inputSchema: inline(inputSchema), outputSchema: inline(obj({...base(readOnly), ...output}))});
}
// Reads
tool('account.get', true, 'Read the account: owner, plan and storage quota, trash retention, time zone, email notices, the people labels with how many active items carry each, and the people known to the library (members, viewers, requesters).',
  {}, {account: any(['account_id', 'owner_person_id', 'quota_bytes', 'trash_retention_days', 'time_zone', 'email_notices']),
    labels: arr(any(['id', 'name', 'person_id', 'item_count'])), people: arr(any(['person_id', 'display_name']))});
tool('storage.summary', true, 'Storage at the current time: quota, bytes used (backed-up items that are active or in the trash), bytes in the trash, bytes waiting to be backed up, bytes by kind and by source, duplicate_bytes (non-cover items of duplicate stacks and later-added copies with the same content_hash) and the largest active items. Purged items count nowhere. It recommends nothing.',
  {}, {storage: any(['quota_bytes', 'used_bytes', 'free_bytes', 'trash_bytes', 'pending_bytes', 'by_kind', 'by_source', 'duplicate_bytes', 'largest_items'])}, [], 'account');
tool('items.search', true, 'Search my items. Filters: start/end (capture time; a date means that local day in the account time zone, a date-time needs an offset), place (text in the place label), label_id (people label), album_id, kind, source, favorite, archived, backed_up, min_bytes, text (in the caption), state (active by default; trashed or purged). Stacks are collapsed to one row (the cover when it matches) with stack_size unless collapse_stacks is false. Newest capture first; page with limit and cursor.',
  {start: BOUND, end: BOUND, place: str(160), label_id: ID, album_id: ID, kind: KIND, source: SOURCE, favorite: BOOL, archived: BOOL, backed_up: BOOL,
    min_bytes: {type: 'integer', minimum: 0}, text: str(200), state: en('active', 'trashed', 'purged'), collapse_stacks: BOOL,
    limit: {type: 'integer', minimum: 1, maximum: 200}, cursor: {type: 'string', pattern: '^[0-9]{1,6}$'}},
  {rows: arr(any(['id', 'kind', 'taken_at', 'state', 'backed_up', 'declared_bytes', 'stack_id', 'stack_size', 'is_cover'])), total: {type: 'integer', minimum: 0},
    next_cursor: nul({type: 'string'})},
  ['start', 'end', 'place', 'label_id', 'album_id', 'kind', 'source', 'favorite', 'archived', 'backed_up', 'min_bytes', 'text', 'state', 'collapse_stacks', 'limit', 'cursor'], 'item');
tool('items.get', true, 'Read one of my items (id): metadata, state (active, trashed, purged) with purge_at, whether it is backed up, its file (if any), its history, the albums whose records hold it, its removal history and the removal requests about it, and, when it is in a stack, every version with its size, kind, state and whether it is the cover. A member\'s contribution is not my item: read it with albums.get.',
  {id: ID}, {item: any(['id', 'kind', 'state', 'taken_at', 'added_at', 'backed_up', 'declared_bytes', 'file', 'history', 'albums', 'removal_history', 'removal_requests', 'stack'])}, [], 'item');
tool('items.read', true, 'Read the image bytes of one of my items (id), as a file object (filename, mime_type, base64, sha256, media) that other tools accept. asset_id is optional and must be this item\'s file. Refused with no_file when the item has no file (videos, items not backed up) and gone once it is purged.',
  {id: ID, asset_id: ID}, {item_id: ID, asset_id: ID, file: transfer}, ['asset_id'], 'item');
tool('albums.list', true, 'List albums with state (private, shared, deleted), number of items shown, members by status and active links. Deleted albums only with include_deleted.',
  {include_deleted: BOOL}, {albums: arr(any(['id', 'title', 'state', 'item_count', 'members', 'active_links']))}, ['include_deleted'], 'album');
tool('albums.get', true, 'Read one album (id): its entries in order (my items and members\' contributions that it shows now), items held but hidden (in the trash), members with role and status, every contribution (present or removed), and its links with state, views and saves.',
  {id: ID}, {album: any(['id', 'title', 'state', 'entries', 'hidden_item_ids', 'members', 'contributions', 'links'])}, [], 'album');
tool('exposure.get', true, 'Where one item (id: my item or a member\'s contribution) is visible now: each album with an invited or joined member or an active link, with its joined members (who can see it) and its active links (anyone holding the link); for an item in the trash, the shared albums it would return to if restored; every recorded view and save; every removal request about it. This is exactly what removals.respond with honor would clear.',
  {id: ID}, {item_id: ID, mine: BOOL, state: str(20), visible: BOOL, visible_to: arr(ID), albums: arr(any(['album_id', 'title', 'members', 'links'])),
    returns_on_restore: arr(any(['album_id'])), views: arr(any(['view_id', 'at', 'surface', 'viewer'])), saves: arr(any(['view_id', 'at', 'surface', 'viewer'])),
    removal_requests: arr(any(['id', 'from_person_id', 'state']))}, [], 'item');
tool('removals.list', true, 'Removal requests in full (requester, items with not_removable ones marked, scope, message, state, answers, what an honour cleared), optionally filtered by state.',
  {state: en('pending', 'honored', 'declined', 'withdrawn')}, {removals: arr(any(['id', 'from_person_id', 'item_ids', 'not_removable', 'scope', 'state']))}, ['state'], 'removal_request');
tool('notifications.list', true, 'Notifications about what other people and the device did (album activity, removal requests and withdrawals, storage thresholds), optionally of one kind and in start..end.',
  {kind: en(...KINDS), start: BOUND, end: BOUND}, {notifications: arr(any(['id', 'kind', 'at', 'title', 'body', 'email_message_stored']))}, ['kind', 'start', 'end'], 'notification');
// Writes
const ITEM_OUT = any(['id', 'state']);
tool('items.update', false, 'Edit one of my items (id) with a patch: caption (null clears), favorite, archived, taken_at (corrected capture time, with offset), add_people / remove_people (people label IDs the account has), make_cover (make this item the cover of its stack). Refused for items in the trash (in_trash), purged (gone) or not mine (not_yours).',
  {id: ID, patch: obj({caption: nul(str(2000)), favorite: BOOL, archived: BOOL, taken_at: TS, add_people: arr(ID, {minItems: 1, maxItems: 50, uniqueItems: true}),
    remove_people: arr(ID, {minItems: 1, maxItems: 50, uniqueItems: true}), make_cover: {const: true}}, ['caption', 'favorite', 'archived', 'taken_at', 'add_people', 'remove_people', 'make_cover'])},
  {id: ID, state: str(20), changed: arr(str(40)), stack_id: nul(ID), cover_id: nul(ID)}, [], 'item');
tool('items.trash', false, 'Move 1 to 50 of my items (ids) to the trash. They leave every album view and link at once (album records are kept, so a restore brings them back), still count against the quota, and are purged when purge_at (now + the account\'s retention) passes. Trashing a stack\'s cover makes its newest active version the cover. All or nothing.',
  {ids: MANY}, {ids: arr(ID), items: arr(any(['id', 'state', 'purge_at'])), covers_changed: arr(any(['stack_id', 'cover_id']))}, [], 'item');
tool('items.restore', false, 'Restore 1 to 50 items (ids) from the trash; each returns to the albums it was in. Refused for a purged item (gone). Returns removal_honored warnings for items that become visible again to people who asked for their removal. All or nothing.',
  {ids: MANY}, {ids: arr(ID), items: arr(ITEM_OUT), warnings: WARNINGS}, [], 'item');
tool('items.purge', false, 'Delete 1 to 50 trashed items (ids) for good before the retention ends; this frees their bytes and cannot be undone, so confirm must be true. All or nothing.',
  {ids: MANY, confirm: BOOL}, {ids: arr(ID), items: arr(ITEM_OUT), freed_bytes: {type: 'integer', minimum: 0}}, ['confirm'], 'item');
tool('albums.create', false, 'Create an empty private album with a title.', {title: str(120)}, {id: ID, title: str(120), state: {const: 'private'}}, [], 'album');
tool('albums.update', false, 'Change one album (id): title, remove_ids and add_ids (my backed-up active items, up to 50 in all; added at the end), and order (item IDs already in the album, placed first in that order; the rest keep their order). All or nothing. Adding to an album that has members or an active link returns removal_honored warnings.',
  {id: ID, title: str(120), add_ids: arr(ID, {minItems: 1, maxItems: 500, uniqueItems: true}), remove_ids: arr(ID, {minItems: 1, maxItems: 500, uniqueItems: true}),
    order: arr(ID, {minItems: 1, maxItems: 500, uniqueItems: true})},
  {id: ID, state: str(20), title: str(120), item_ids: arr(ID), added: arr(ID), removed: arr(ID), warnings: WARNINGS}, ['title', 'add_ids', 'remove_ids', 'order'], 'album');
tool('albums.delete', false, 'Delete an album (id). Its items stay in the library and its links are revoked. An album that still has an invited or joined member or an active link needs confirm: true.',
  {id: ID, confirm: BOOL}, {id: ID, state: {const: 'deleted'}, revoked_link_ids: arr(ID)}, ['confirm'], 'album');
tool('albums.members.invite', false, 'Invite a person (person_id) to an album (id) as viewer or contributor; they are invited until they join or decline (an event). Returns removal_honored warnings for items the album shows.',
  {id: ID, person_id: ID, role: en('viewer', 'contributor')}, {id: ID, person_id: ID, member_status: {const: 'invited'}, state: str(20), warnings: WARNINGS}, [], 'album');
tool('albums.members.update', false, 'Change the role of an invited or joined member (person_id) of album id, or remove them (remove: true). A removed member\'s contributions leave the album.',
  {id: ID, person_id: ID, role: en('viewer', 'contributor'), remove: {const: true}},
  {id: ID, person_id: ID, member_status: str(20), role: str(20), state: str(20), contributions_removed: arr(ID)}, ['role', 'remove'], 'album');
tool('albums.save_item', false, 'Save a member\'s contribution (item_id) in album id into my library as my own item with source saved_from_share. Refused if it would pass the quota (over_quota).',
  {id: ID, item_id: ID}, {id: ID, item_id: ID, state: {const: 'active'}, source: {const: 'saved_from_share'}, declared_bytes: BYTES, used_bytes: {type: 'integer', minimum: 0}}, [], 'album');
tool('links.create', false, 'Create a link that shows album id to anyone who holds it, optionally until expires_at (must be in the future). Returns removal_honored warnings for items the album shows.',
  {id: ID, expires_at: TS}, {id: ID, album_id: ID, state: {const: 'active'}, expires_at: nul(TS), warnings: WARNINGS}, ['expires_at'], 'album');
tool('links.revoke', false, 'Revoke an active link (id). Views and saves already recorded stay recorded.',
  {id: ID}, {id: ID, album_id: ID, state: {const: 'revoked'}}, [], 'link');
tool('removals.respond', false, 'Answer a pending or declined removal request (id). honor removes the named items that are mine from the request\'s album (scope album) or from every album that has an invited or joined member or an active link (scope everywhere), and so from every link to those albums, and records a removal_history row on each item; decline records the note and changes nothing. The result lists what could not be undone: views and saves already recorded.',
  {id: ID, decision: en('honor', 'decline'), note: str(2000)},
  {id: ID, state: en('honored', 'declined'), cleared: arr(any(['item_id', 'album_ids', 'link_ids'])), not_removable: arr(ID),
    already_seen: arr(any(['item_id', 'views', 'saves']))}, ['note'], 'removal_request');

// ---- state envelope ------------------------------------------------------------------------------
const state = JSON.parse(fs.readFileSync(path.join(root, 'schemas/state.schema.json'), 'utf8'));
state.properties.package_version = {const: app.version};
state.properties.core_api_version = {const: app.core_api_version};
state.properties.app_id = {const: app.app_id};

const outputs = {'tools.json': tools, 'schemas/seed.schema.json': seed, 'schemas/events.schema.json': events, 'schemas/state.schema.json': state};
function build({check = false} = {}) {
  const drift = [];
  for (const [file, value] of Object.entries(outputs)) {
    const text = JSON.stringify(value, null, 2) + '\n', target = path.join(root, file);
    if (check) { if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) drift.push(file); }
    else fs.writeFileSync(target, text);
  }
  return drift;
}
module.exports = {build, operations, tools};
if (require.main === module) {
  const check = process.argv.includes('--check'), drift = build({check});
  if (drift.length) { console.error('Generated contract drift: ' + drift.join(', ')); process.exitCode = 1; }
  else console.log(check ? 'Fernshelf contracts match their source.' : 'Fernshelf contracts written.');
}
