#!/usr/bin/env node
'use strict';
// Generates tools.json, schemas/seed.schema.json and schemas/events.schema.json from one description,
// so the three files cannot drift apart. Run with --check to compare without writing.
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const APP = 'ribbonwell';

const ID = {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
const TS = {type: 'string', format: 'date-time'};
const BOOL = {type: 'boolean'};
const INT = {type: 'integer'};
const nul = s => ({anyOf: [s, {type: 'null'}]});
const text = (max, min = 1) => ({type: 'string', minLength: min, maxLength: max});
const obj = (properties, required = Object.keys(properties)) => ({type: 'object', properties, required, additionalProperties: false});
const arr = (items, maxItems = 1000, extra = {}) => ({type: 'array', items, maxItems, ...extra});
const count = {type: 'integer', minimum: 0};
const cents = {type: 'integer', minimum: 0, maximum: 100000000};
const PRIORITY = {enum: ['low', 'medium', 'high']};
const PAIR = {type: 'array', items: ID, minItems: 2, maxItems: 2};
const ASSIGNMENT = obj({giver: ID, receiver: ID});
const NOTIFICATION_KINDS = ['item.added', 'claim.item_changed', 'exchange.invited', 'exchange.member_changed', 'exchange.drawn'];
const MATERIAL = ['name', 'variant', 'price_cents', 'store'];

// ---- stored records (seed and state) ----
const member = obj({member_id: ID, name: text(100), person_id: nul(ID)});
const group = obj({group_id: ID, name: text(100), member_ids: arr(ID, 12, {uniqueItems: true})});
const list = obj({list_id: ID, owner_member_id: ID, group_id: ID, managed_by: nul(ID), occasion_name: nul(text(100)), occasion_date: nul(TS), created_at: TS});
const itemFields = {name: text(120), variant: nul(text(120)), price_cents: nul(cents), store: nul(text(120)), note: nul(text(500)), priority: PRIORITY, quantity_wanted: {type: 'integer', minimum: 1, maximum: 20}};
const item = obj({item_id: ID, list_id: ID, ...itemFields, status: {enum: ['listed', 'removed']}, created_at: TS, updated_at: TS});
const claim = obj({claim_id: ID, member_id: ID, item_id: ID, quantity: {type: 'integer', minimum: 1, maximum: 20}, status: {enum: ['reserved', 'purchased', 'released']},
  reserved_until: nul(TS), note: nul(text(500)), for_exchange_id: nul(ID), changed_fields: arr({enum: [...MATERIAL, 'removed']}, 5, {uniqueItems: true}), created_at: TS, updated_at: TS});
const exchange = obj({exchange_id: ID, group_id: ID, organizer_member_id: ID, name: text(100), budget_cents: nul(cents), join_by: TS, exchange_date: TS,
  exclusions: arr(PAIR, 45), participant_ids: arr(ID, 10, {uniqueItems: true}), drawn_at: nul(TS), assignments: arr(ASSIGNMENT, 10), created_at: TS});
const notification = obj({notification_id: ID, kind: {enum: NOTIFICATION_KINDS}, at: TS, actor_member_id: nul(ID), list_id: nul(ID), item_id: nul(ID), claim_id: nul(ID), exchange_id: nul(ID), text: text(300)});
const activity = obj({seq: {type: 'integer', minimum: 1}, at: TS, actor: {enum: ['agent', 'event']}, action: text(80), object_id: nul(ID), list_id: nul(ID), exchange_id: nul(ID),
  request_id: nul(text(100)), event_id: nul(ID), replaced: nul({type: 'object'}), unreleased_claims: nul(count)});
const seed = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:pale:ribbonwell:seed:1',
  ...obj({
    account_id: ID,
    settings: obj({notify_item_added: BOOL, notify_exchange_activity: BOOL, draw_salt: text(128, 8)}),
    members: arr(member, 60), groups: arr(group, 10), lists: arr(list, 200), items: arr(item, 2000), claims: arr(claim, 5000),
    exchanges: arr(exchange, 200), notifications: arr(notification, 5000), activity: arr(activity, 20000),
    counters: obj({item: count, claim: count, exchange: count, notification: count})
  })
};

// ---- events ----
const itemMatch = obj({list_id: ID, name: text(120)});
const exchangeMatch = obj({group_id: ID, name: text(100)});
const itemPatch = obj({...itemFields, quantity_wanted: INT}, []);
const eventPayloads = {
  'item.added': obj({actor_member_id: ID, list_id: ID, item: obj({item_id: ID, ...itemFields, quantity_wanted: INT}, ['item_id', 'name'])}),
  'item.changed': obj({actor_member_id: ID, item_id: ID, item_match: itemMatch, patch: itemPatch, removed: BOOL}, ['actor_member_id']),
  'claim.recorded': obj({actor_member_id: ID, item_id: ID, item_match: itemMatch, claim_id: ID, quantity: INT, status: {enum: ['reserved', 'purchased', 'released']}}, ['actor_member_id', 'status']),
  'exchange.opened': obj({actor_member_id: ID, exchange: obj({exchange_id: ID, group_id: ID, name: text(100), budget_cents: nul(cents), join_by: TS, exchange_date: TS, exclusions: arr(PAIR, 45)},
    ['exchange_id', 'group_id', 'name', 'join_by', 'exchange_date'])}),
  'exchange.member_changed': obj({actor_member_id: ID, exchange_id: ID, exchange_match: exchangeMatch, change: {enum: ['joined', 'left']}}, ['actor_member_id', 'change']),
  'exchange.drawn': obj({exchange_id: ID, exchange_match: exchangeMatch, assignments: arr(ASSIGNMENT, 10)}, ['assignments'])
};
const events = {oneOf: Object.entries(eventPayloads).map(([name, payload]) => obj({event_id: ID, at: TS, operation: {const: APP + '.' + name}, payload}))};

// ---- tool results ----
const memberRef = obj({member_id: ID, name: text(100)});
const claimView = obj({claim_id: ID, member_id: ID, member_name: text(100), quantity: INT, status: {enum: ['reserved', 'lapsed', 'purchased']}, reserved_until: nul(TS), mine: BOOL});
const itemView = obj({item_id: ID, list_id: ID, ...itemFields, status: {enum: ['listed', 'removed']}, created_at: TS, updated_at: TS,
  claims_hidden: BOOL, remaining: count, over_claimed: BOOL, claims: arr(claimView, 100)},
  ['item_id', 'list_id', ...Object.keys(itemFields), 'status', 'created_at', 'updated_at', 'claims_hidden']);
const listView = obj({list_id: ID, owner_member_id: ID, owner_name: text(100), group_id: ID, managed_by: nul(ID), occasion_name: nul(text(100)), occasion_date: nul(TS),
  created_at: TS, view: {enum: ['own', 'managed', 'other']}, item_count: count});
const myClaim = obj({claim_id: ID, item_id: ID, item_name: text(120), list_id: ID, list_owner_member_id: ID, quantity: INT, status: {enum: ['reserved', 'lapsed', 'purchased', 'released']},
  reserved_until: nul(TS), note: nul(text(500)), for_exchange_id: nul(ID), over_budget: nul(BOOL), changed_fields: arr({enum: [...MATERIAL, 'removed']}, 5), item_removed: BOOL, created_at: TS, updated_at: TS});
const exchangeView = obj({exchange_id: ID, group_id: ID, organizer_member_id: ID, name: text(100), budget_cents: nul(cents), join_by: TS, exchange_date: TS,
  status: {enum: ['open', 'closed', 'drawn', 'past', 'expired']}, participants: arr(memberRef, 10), joined: BOOL, is_organizer: BOOL, exclusions: nul(arr(PAIR, 45)),
  drawn_at: nul(TS), my_giftee: nul(memberRef), draw_ready: BOOL, draw_blockers: arr(text(40), 5), created_at: TS});

const VERSION = obj({epoch: {type: 'integer', minimum: 1}, revision: {type: 'integer', minimum: 0}});
const REQUEST = {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
const page = {limit: {type: 'integer', minimum: 1, maximum: 100}, offset: count};
const read = (name, description, input, required, output) => ({name: APP + '.' + name, description, read_only: true, scope: APP + '.' + name, resource_target: 'current account',
  inputSchema: obj(input, required), outputSchema: obj({status: {const: 'ok'}, app_id: {const: APP}, version: VERSION, ...output})});
const write = (name, description, input, required, output = {}) => ({name: APP + '.' + name, description, read_only: false, scope: APP + '.' + name, resource_target: 'current account',
  inputSchema: obj({...input, expected_version: VERSION, request_id: REQUEST}, [...required, 'expected_version', 'request_id']),
  outputSchema: obj({status: {const: 'committed'}, app_id: {const: APP}, version: VERSION, id: ID, ...output})});
const CLOCK = ' Reads and writes never move the clock; only the environment does.';
const tools = [
  read('account.get', 'Read the account, the member the Agent acts for and the current environment time (now).' + CLOCK, {}, [],
    {account: obj({account_id: ID, member_id: ID, name: text(100), person_id: ID, notify_item_added: BOOL, notify_exchange_activity: BOOL, group_ids: arr(ID, 10)}), now: TS}),
  read('groups.list', 'List the groups this member belongs to. Group IDs come from here.', {}, [], {groups: arr(obj({group_id: ID, name: text(100), member_count: count}), 10)}),
  read('groups.get', 'Read one group and its members. Member IDs come from here. A group this member is not in returns not_found.', {id: ID}, ['id'],
    {group: obj({group_id: ID, name: text(100), members: arr(obj({member_id: ID, name: text(100), person_id: nul(ID), is_me: BOOL}), 12)})}),
  read('lists.list', 'List wish lists in this member\'s groups, optionally by group, owner or an occasion-date window. List IDs come from here. view is own, managed or other.',
    {group_id: ID, owner_member_id: ID, occasion_from: TS, occasion_to: TS, ...page}, [], {lists: arr(listView, 200), total: count}),
  read('lists.get', 'Read one list with its items. On the member\'s own list every item has claims_hidden true and no claim field; on other and managed lists each item has remaining, over_claimed and claims. Item IDs come from here.',
    {id: ID, include_removed: BOOL}, ['id'], {list: listView, items: arr(itemView, 2000)}),
  read('items.get', 'Read one item (same view rules as lists.get). Use it before reserving: remaining and claims are what a reservation is checked against.', {id: ID}, ['id'], {item: itemView, list: listView}),
  read('items.search', 'Search listed items on visible lists by text in name, variant, store or note. Own-list items never carry claim fields.', {query: text(200, 0), group_id: ID, ...page}, ['query'], {items: arr(itemView, 100), total: count}),
  read('claims.list', 'List this member\'s own claims (reservations and purchases for others), with the read status (reserved, lapsed, purchased, released), private note, exchange tag and any change the owner made since. Claim IDs come from here.',
    {status: {enum: ['reserved', 'lapsed', 'purchased', 'released']}, ...page}, [], {claims: arr(myClaim, 100), total: count}),
  read('exchanges.list', 'List gift exchanges in this member\'s groups with their current status. Exchange IDs come from here.', {group_id: ID}, [], {exchanges: arr(exchangeView, 200)}),
  read('exchanges.get', 'Read one exchange. After a draw only this member\'s own giftee is returned (my_giftee). draw_ready and draw_blockers say whether a draw would succeed.', {id: ID}, ['id'], {exchange: exchangeView}),
  read('notifications.list', 'List in-App notifications about what other members did, oldest first. Nothing is sent outside the App.', {since: TS, ...page}, [], {notifications: arr(notification, 100), total: count}),

  write('lists.update', 'Set or clear the occasion name and date of a list this member owns or manages (id is the list).', {id: ID, patch: obj({occasion_name: nul(text(100)), occasion_date: nul(TS)}, [])}, ['id', 'patch']),
  write('items.add', 'Add an item to a list this member owns or manages (id is the list). Returns the new item ID.', {id: ID, item: obj({...itemFields, quantity_wanted: INT}, ['name'])}, ['id', 'item']),
  write('items.update', 'Change fields of a listed item on a list this member owns or manages (id is the item). On the member\'s own list the result never depends on claims.', {id: ID, patch: itemPatch}, ['id', 'patch']),
  write('items.remove', 'Remove an item from a list this member owns or manages (id is the item). Claims on it are kept. Undo with items.restore.', {id: ID}, ['id']),
  write('items.restore', 'Restore a removed item (id is the item).', {id: ID}, ['id']),
  write('claims.reserve', 'Reserve a quantity of an item on someone else\'s list (id is the item). The hold lasts 14 days from now unless extended or marked purchased. Returns the new claim ID.',
    {id: ID, quantity: INT, note: nul(text(500)), for_exchange_id: ID}, ['id'], {reserved_until: TS}),
  write('claims.update', 'Change one of this member\'s claims (id is the claim): quantity, status (purchased or reserved), reserved_until (at most 14 days ahead), private note, or exchange tag.',
    {id: ID, patch: obj({quantity: INT, status: {enum: ['reserved', 'purchased']}, reserved_until: TS, note: nul(text(500)), for_exchange_id: nul(ID)}, [])}, ['id', 'patch']),
  write('claims.release', 'Release one of this member\'s claims (id is the claim). A later reservation creates a new claim.', {id: ID}, ['id']),
  write('exchanges.create', 'Create a gift exchange in a group this member belongs to (id is the group). The creator is the organizer and is not joined automatically. Returns the new exchange ID.',
    {id: ID, exchange: obj({name: text(100), budget_cents: nul(cents), join_by: TS, exchange_date: TS, exclusions: arr(PAIR, 45)}, ['name', 'join_by', 'exchange_date'])}, ['id', 'exchange']),
  write('exchanges.update', 'As organizer, change an exchange before its draw (id is the exchange).',
    {id: ID, patch: obj({name: text(100), budget_cents: nul(cents), join_by: TS, exchange_date: TS, exclusions: arr(PAIR, 45)}, [])}, ['id', 'patch']),
  write('exchanges.join', 'Join an open exchange (id is the exchange).', {id: ID}, ['id']),
  write('exchanges.leave', 'Leave an exchange before its draw (id is the exchange).', {id: ID}, ['id']),
  write('exchanges.draw', 'As organizer, run the draw (id is the exchange). It cannot be undone. Returns only this member\'s own giftee.', {id: ID}, ['id'], {my_giftee: nul(memberRef)})
];

const files = {'tools.json': tools, 'schemas/seed.schema.json': seed, 'schemas/events.schema.json': events};
let drift = false;
for (const [name, value] of Object.entries(files)) {
  const file = path.join(root, name), expected = JSON.stringify(value, null, 2) + '\n';
  if (process.argv.includes('--check')) { if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== expected) { drift = true; console.error('Generated file drift: ' + name); } }
  else fs.writeFileSync(file, expected);
}
if (drift) process.exitCode = 1; else console.log(tools.length + ' tools, seed and event schemas ' + (process.argv.includes('--check') ? 'match.' : 'written.'));
