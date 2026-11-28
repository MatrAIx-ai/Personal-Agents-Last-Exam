'use strict';
// Maintainer script (not run by tests or the verifier). Regenerates schemas/seed.schema.json,
// schemas/events.schema.json and tools.json from one set of field definitions.
// Usage, from the package directory: node dev/build-contracts.cjs
// Schemas are fully inlined (no $ref): Core embeds the seed and event schemas in its Infra tool inputs.
const fs = require('node:fs'), path = require('node:path');
const out = path.resolve(__dirname, '..');
const APP = 'kinodex';

// Tool inputs use a strict ID pattern; bulk seed records use a cheap length check and
// validateSeed checks the same pattern once per ID (the schema validator compiles a RegExp per value).
const ID = {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
const SID = {type: 'string', minLength: 1, maxLength: 100};
const TIME = {type: 'string', format: 'date-time'};
const DATE = {type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'};
const BOOL = {type: 'boolean'};
const INT = (minimum = 0, maximum) => ({type: 'integer', minimum, ...(maximum === undefined ? {} : {maximum})});
const NUM = {type: 'number'};
const text = (max, min = 1) => ({type: 'string', minLength: min, maxLength: max});
const obj = (properties, required = Object.keys(properties)) => ({type: 'object', properties, required, additionalProperties: false});
const arr = (items, maxItems, extra = {}) => ({type: 'array', items, maxItems, ...extra});
const nullable = s => ({anyOf: [s, {type: 'null'}]});
const VERSION = obj({epoch: INT(1), revision: INT(0)});
const ANY = {};

const REGION = {enum: ['US', 'UK', 'CA']};
// Region arguments are plain strings so an unknown region reaches the App and returns not_found.
const REGION_ARG = text(10);
const OFFER_TYPE = {enum: ['subscription', 'rent', 'buy', 'free_with_ads']};
const AVAILABILITY = {enum: ['upcoming', 'available', 'leaving_soon', 'ended']};
const SEVERITY = {enum: ['none', 'mild', 'moderate', 'severe']};
const CATEGORIES = ['violence', 'language', 'sexual_content', 'frightening', 'substances'];
const VISIBILITY = {enum: ['private', 'friends', 'public']};
const ALERT_KIND = {enum: ['available_on_my_services', 'price_below', 'new_season']};
const FIELD = {enum: ['release_date', 'runtime', 'credit', 'certification', 'guide_item']};
const CORRECTION_STATUS = {enum: ['submitted', 'needs_info', 'approved', 'declined', 'withdrawn']};
const DECISION = {enum: ['approved', 'declined', 'needs_info']};
const ROLE = {enum: ['director', 'writer', 'actor', 'composer', 'cinematographer', 'editor', 'producer']};
const OPERATIONS = ['offer.publish', 'offer.end', 'title.update', 'correction.decision'];
const GUIDE_REASON = {enum: ['seed', 'published_update', 'correction_approved']};

// ---- Seed records -------------------------------------------------------------------------
const SERVICE = obj({service_id: SID, name: text(80), regions: arr(REGION, 3, {minItems: 1, uniqueItems: true}),
  offer_types: arr(OFFER_TYPE, 4, {minItems: 1, uniqueItems: true})});
const EDITION = obj({edition_id: SID, label: text(60), runtime_minutes: INT(1, 1000)});
const RELEASE = obj({region: REGION, date: DATE, certification: text(10)});
const SEASON = obj({season_number: INT(1, 100), name: text(120), added_at: TIME});
const TITLE = obj({title_id: SID, kind: {enum: ['film', 'series']}, name: text(200), year: INT(1900, 2100),
  genres: arr(text(40), 6), synopsis: text(1000), editions: arr(EDITION, 6, {minItems: 1}),
  releases: arr(RELEASE, 3, {minItems: 1}), seasons: arr(SEASON, 50)});
const EPISODE_FIELDS = {episode_id: SID, number: INT(1, 500), name: text(200), synopsis: text(1000), air_date: DATE, runtime_minutes: INT(1, 1000)};
const EPISODE = obj({episode_id: SID, title_id: SID, season_number: INT(1, 100), ...EPISODE_FIELDS});
const PERSON = obj({person_id: SID, name: text(120)});
const CREDIT = obj({credit_id: SID, title_id: SID, person_id: SID, role: ROLE, character: nullable(text(120)), billing_order: INT(1, 500)});
const ITEM = obj({item_id: SID, text: text(500), spoiler: BOOL});
const CATEGORY = obj({severity: SEVERITY, summary: text(300), items: arr(ITEM, 20)});
const GUIDE_VERSION = obj({version: INT(1, 1000), reason: GUIDE_REASON, published_at: TIME,
  categories: obj(Object.fromEntries(CATEGORIES.map(c => [c, CATEGORY])))});
const GUIDE = obj({title_id: SID, versions: arr(GUIDE_VERSION, 100, {minItems: 1})});
const OFFER_FIELDS = {offer_id: SID, title_id: SID, edition_id: nullable(SID), service_id: SID, region: REGION, type: OFFER_TYPE,
  price: nullable(NUM), currency: nullable({enum: ['USD', 'GBP', 'CAD']}), quality: {enum: ['SD', 'HD', '4K']},
  available_from: TIME, available_until: nullable(TIME)};
const OFFER = obj(OFFER_FIELDS);
const PUBLIC_REVIEW = obj({review_id: SID, title_id: SID, author: text(60), rating: NUM, text: text(2000), contains_spoilers: BOOL, posted_at: TIME});
const ACCOUNT = obj({region: REGION, time_zone: text(60), service_ids: arr(SID, 6, {uniqueItems: true}), settings_version: INT(1), updated_at: TIME});
const WATCHLIST = obj({version: INT(1), title_ids: arr(SID, 500, {uniqueItems: true}), updated_at: TIME});
const REVIEW = obj({text: text(5000), contains_spoilers: BOOL, visibility: VISIBILITY});
const DIARY = obj({entry_id: SID, title_id: SID, episode_ids: arr(SID, 50, {uniqueItems: true}), edition_id: nullable(SID),
  watched_on: DATE, rewatch: BOOL, watched_with: arr(SID, 20, {uniqueItems: true}), rating: nullable(NUM),
  review: nullable(REVIEW), logged_at: TIME, updated_at: TIME});
const LIST = obj({list_id: SID, name: text(120), description: text(1000, 0), visibility: VISIBILITY, version: INT(1),
  title_ids: arr(SID, 500, {uniqueItems: true}), created_at: TIME, updated_at: TIME});
const OFFER_SNAPSHOT = obj({offer_id: SID, service_id: SID, region: REGION, type: OFFER_TYPE, price: nullable(NUM),
  currency: nullable({enum: ['USD', 'GBP', 'CAD']}), available_from: TIME, available_until: nullable(TIME)});
const TRIGGER = obj({at: TIME, cause: {enum: ['event', 'services.update']}, event_id: nullable(SID), operation: nullable({enum: OPERATIONS}),
  request_id: nullable(text(200)), offer: nullable(OFFER_SNAPSHOT), season_number: nullable(INT(1, 100)), notice_id: nullable(SID)});
const ALERT_FIELDS = {alert_id: SID, kind: ALERT_KIND, title_id: SID, offer_type: nullable({enum: ['rent', 'buy']}), threshold: nullable(NUM),
  expires_at: nullable(TIME), created_at: TIME, updated_at: TIME, known_seasons: arr(INT(1, 100), 100), trigger: nullable(TRIGGER)};
const ALERT = obj({...ALERT_FIELDS, status: {enum: ['active', 'triggered', 'deleted']}});
const TARGET = {anyOf: [obj({edition_id: SID}), obj({region: REGION}), obj({credit_id: SID}), obj({item_id: SID})]};
const CREDIT_PATCH = obj({role: ROLE, character: text(120), billing_order: INT(1, 500)}, []);
const ITEM_PATCH = obj({text: text(500), spoiler: BOOL}, []);
const PROPOSED = {anyOf: [text(20), INT(1, 1000), CREDIT_PATCH, ITEM_PATCH]};
const DECISION_RECORD = obj({decision: DECISION, note: nullable(text(1000)), decided_at: TIME, event_id: SID});
const CORRECTION_FIELDS = {correction_id: SID, title_id: SID, field: FIELD, target: TARGET, proposed_value: PROPOSED, current_value: ANY,
  evidence: text(2000), status: CORRECTION_STATUS, submitted_at: TIME, updated_at: TIME, amended_at: nullable(TIME),
  withdrawn_at: nullable(TIME), decisions: arr(DECISION_RECORD, 10)};
const CORRECTION = obj(CORRECTION_FIELDS);
const NOTICE = obj({notice_id: SID, at: TIME, kind: {enum: ['alert_triggered', 'correction_decided', 'guide_updated']}, title_id: SID,
  alert_id: nullable(SID), correction_id: nullable(SID), guide_version: nullable(INT(1)), event_id: SID, text: text(500)});
const ACTIVITY = obj({seq: INT(1), at: TIME, actor: {enum: ['agent', 'event']}, action: text(60), request_id: nullable(text(200)),
  event_id: nullable(SID), object_type: {enum: ['account', 'watchlist', 'diary_entry', 'list', 'alert', 'correction', 'offer', 'title']},
  object_id: SID, replaced: ANY, effects: obj({alert_ids: arr(SID, 500), notice_ids: arr(SID, 500)}),
  // Stored records dated after the clock that the change removed or replaced (src/rules.cjs reportLater).
  // Optional, so rows written before it existed stay valid.
  later_history_removed: nullable({type: 'object', additionalProperties: {type: 'array'}})},
  ['seq', 'at', 'actor', 'action', 'request_id', 'event_id', 'object_type', 'object_id', 'replaced', 'effects']);

const seed = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:pale:kinodex:seed:1',
  ...obj({
    account_id: SID, owner_person_id: SID,
    services: arr(SERVICE, 20), titles: arr(TITLE, 2000), episodes: arr(EPISODE, 5000), people: arr(PERSON, 5000),
    credits: arr(CREDIT, 20000), guides: arr(GUIDE, 2000), offers: arr(OFFER, 10000), public_reviews: arr(PUBLIC_REVIEW, 5000),
    account: ACCOUNT, watchlist: WATCHLIST, diary: arr(DIARY, 5000), lists: arr(LIST, 200), alerts: arr(ALERT, 1000),
    corrections: arr(CORRECTION, 1000), notices: arr(NOTICE, 5000), activity: arr(ACTIVITY, 20000),
  }),
};

// ---- Events -------------------------------------------------------------------------------
const CATEGORY_DELTA = obj({severity: SEVERITY, summary: text(300), add_items: arr(ITEM, 20), remove_items: arr(SID, 20, {uniqueItems: true})}, []);
const GUIDE_DELTA = obj({version: INT(2, 1000), reason: {enum: ['published_update', 'correction_approved']},
  categories: obj(Object.fromEntries(CATEGORIES.map(c => [c, CATEGORY_DELTA])), [])});
const NEW_EPISODE = obj(EPISODE_FIELDS);
const ADDED_EPISODE = obj({season_number: INT(1, 100), ...EPISODE_FIELDS});
const event = (operation, payload) => obj({event_id: ID, at: TIME, operation: {const: operation}, payload});
const events = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:pale:kinodex:events:1',
  anyOf: [
    event('offer.publish', obj(OFFER_FIELDS, ['offer_id', 'title_id', 'service_id', 'region', 'type', 'quality', 'available_from'])),
    event('offer.end', obj({offer_id: ID})),
    event('title.update', obj({title_id: ID,
      add_seasons: arr(obj({season_number: INT(1, 100), name: text(120), episodes: arr(NEW_EPISODE, 100)}), 10),
      add_episodes: arr(ADDED_EPISODE, 100), release_dates: arr(obj({region: REGION, date: DATE, certification: text(10)}, ['region', 'date']), 3),
      guide_version: GUIDE_DELTA}, ['title_id'])),
    event('correction.decision', obj({correction_ref: obj({title_id: ID, field: FIELD, target: TARGET}, ['title_id', 'field']),
      decision: DECISION, note: text(1000)}, ['correction_ref', 'decision'])),
  ],
};

// ---- Agent-facing views ---------------------------------------------------------------------
const TITLE_SUMMARY_FIELDS = {title_id: SID, kind: {enum: ['film', 'series']}, name: text(200), year: INT(1900, 2100), genres: arr(text(40), 6),
  certification: nullable(text(10)), on_watchlist: BOOL};
const TITLE_SUMMARY = obj(TITLE_SUMMARY_FIELDS);
const VIEW_ITEM = obj({item_id: SID, text: text(500), spoiler: BOOL});
const VIEW_CATEGORY = obj({severity: SEVERITY, summary: text(300), items: arr(VIEW_ITEM, 20), withheld_items: INT(0)});
const GUIDE_VIEW = obj({title_id: SID, version: INT(1), reason: GUIDE_REASON, published_at: TIME, current_version: INT(1), spoilers_hidden: BOOL,
  categories: obj(Object.fromEntries(CATEGORIES.map(c => [c, VIEW_CATEGORY]))),
  versions: arr(obj({version: INT(1), reason: GUIDE_REASON, published_at: TIME}), 100)});
const EPISODE_VIEW = obj({episode_id: SID, season_number: INT(1), number: INT(1), name: text(200), air_date: DATE, runtime_minutes: INT(1),
  synopsis: nullable(text(1000)), synopsis_withheld: BOOL});
const BOUNDARY = obj({person_id: SID, furthest_episode: nullable(obj({episode_id: SID, season_number: INT(1), number: INT(1)}))});
const TITLE_FULL = obj({...TITLE_SUMMARY_FIELDS, synopsis: text(1000), editions: arr(EDITION, 6), releases: arr(RELEASE, 3),
  seasons: arr(obj({season_number: INT(1), name: text(120), episode_count: INT(0)}), 50), guide: GUIDE_VIEW,
  episodes: arr(EPISODE_VIEW, 1000), spoiler_boundary: nullable(BOUNDARY)});
const OFFER_VIEW = obj({...OFFER_FIELDS, service_name: text(80), availability: AVAILABILITY, on_my_services: BOOL});
const MY_SUBSCRIPTIONS = obj({status: {enum: ['available', 'leaving_soon', 'upcoming', 'none']}, available_until: nullable(TIME),
  service_ids: arr(SID, 20), next_available_from: nullable(TIME)});
const TITLE_OFFERS = obj({title_id: SID, name: text(200), kind: {enum: ['film', 'series']}, my_subscriptions: MY_SUBSCRIPTIONS, offers: arr(OFFER_VIEW, 200)});
const DIARY_VIEW = obj({entry_id: SID, title_id: SID, title_name: text(200), episodes: arr(obj({episode_id: SID, season_number: INT(1), number: INT(1)}), 50),
  edition_id: nullable(SID), watched_on: DATE, rewatch: BOOL, watched_with: arr(SID, 20), rating: nullable(NUM), review: nullable(REVIEW),
  logged_at: TIME, updated_at: TIME});
const ALERT_VIEW = obj({...ALERT_FIELDS, status: {enum: ['active', 'triggered', 'expired', 'deleted']}, title_name: text(200)});
const CORRECTION_VIEW = obj({...CORRECTION_FIELDS, title_name: text(200)});
const LIST_ITEM = obj({position: INT(1), title_id: SID, name: text(200), kind: {enum: ['film', 'series']}, year: INT(1900, 2100)});
const LIMIT = max => INT(1, max);
const HIDE = {hide_spoilers: BOOL, as_of_person: ID};

// Every write receipt: null, or how many stored records dated after the clock the write removed or replaced,
// by family. Only counts, because the receipt goes to the Agent; the records are in the activity row.
// This happens only when a seed that runs past its clock is loaded early.
const LATER = nullable({type: 'object', additionalProperties: INT(1)});
function tool(name, description, readOnly, input, output, required = Object.keys(input)) {
  const inputSchema = readOnly ? obj(input, required)
    : obj({...input, expected_version: VERSION, request_id: ID}, [...required, 'expected_version', 'request_id']);
  const outputSchema = obj({status: {const: readOnly ? 'ok' : 'committed'}, app_id: {const: APP}, version: VERSION, ...output,
    ...(readOnly ? {} : {later_history_removed: LATER})});
  return {name, description, read_only: readOnly, scope: name, resource_target: 'current account', inputSchema, outputSchema};
}
const DIARY_PATCH = obj({edition_id: nullable(ID), watched_on: DATE, rewatch: BOOL, watched_with: arr(ID, 20, {uniqueItems: true}),
  rating: nullable(NUM), review: nullable(REVIEW)}, []);
const LIST_PATCH = obj({name: text(120), description: text(1000, 0), visibility: VISIBILITY, title_ids: arr(ID, 500, {uniqueItems: true})}, []);
const ALERT_PATCH = obj({threshold: NUM, expires_at: nullable(TIME)}, []);
const CORRECTION_PATCH = obj({proposed_value: PROPOSED, evidence: text(2000)}, []);
const RECEIPT_ID = {id: SID};

const tools = [
  // W1 titles, credits and guides
  tool('kinodex.titles.search',
    'Search the film and TV catalog by words in the title, synopsis or genres (case- and accent-insensitive; every query word must match the start of a word), with optional kind, genre and release-year filters. Returns up to limit (default 20) titles sorted by name, with the certification in the account\'s region and whether each is on the watchlist.',
    true, {query: text(200, 0), kind: {enum: ['film', 'series']}, genre: text(40), year_from: INT(1900, 2100), year_to: INT(1900, 2100), on_watchlist: BOOL, limit: LIMIT(100)},
    {total: INT(0), titles: arr(TITLE_SUMMARY, 100)}, []),
  tool('kinodex.titles.get',
    'Open one title: synopsis, editions with runtimes, release dates and certifications per region, seasons and episodes, and the current parental guide. hide_spoilers: true keeps each guide category\'s severity and spoiler-safe summary but withholds items flagged as spoilers, and withholds the synopses of episodes after the furthest episode logged in the diary. The boundary is the bound person\'s own diary by default; as_of_person uses the diary entries whose watched_with includes that person.',
    true, {title_id: ID, ...HIDE}, {title: TITLE_FULL}, ['title_id']),
  tool('kinodex.episodes.list',
    'List a series\' episodes in order (optionally one season) with air dates and runtimes. hide_spoilers and as_of_person work as in kinodex.titles.get.',
    true, {title_id: ID, season_number: INT(1, 100), ...HIDE}, {title_id: SID, spoiler_boundary: nullable(BOUNDARY), episodes: arr(EPISODE_VIEW, 1000)}, ['title_id']),
  tool('kinodex.people.get',
    'Open a person in the catalog with every credit they hold (title, role, character, billing order), newest title first.',
    true, {person_id: ID}, {person: PERSON, credits: arr(obj({credit_id: SID, title_id: SID, title_name: text(200), year: INT(1900, 2100),
      role: ROLE, character: nullable(text(120)), billing_order: INT(1)}), 500)}),
  tool('kinodex.credits.list',
    'List a title\'s credits in billing order, optionally only one role.',
    true, {title_id: ID, role: ROLE}, {title_id: SID, credits: arr(obj({credit_id: SID, person_id: SID, person_name: text(120), role: ROLE,
      character: nullable(text(120)), billing_order: INT(1)}), 500)}, ['title_id']),
  tool('kinodex.guide.get',
    'Read a title\'s parental guide: five categories (violence, language, sexual_content, frightening, substances), each with a severity (none, mild, moderate or severe), a spoiler-safe summary and items. Returns the current version by default and an earlier one with version; versions lists every version with its reason (seed, published_update or correction_approved). hide_spoilers: true withholds items flagged as spoilers and reports how many were withheld.',
    true, {title_id: ID, version: INT(1, 1000), hide_spoilers: BOOL}, {guide: GUIDE_VIEW}, ['title_id']),
  // W2 where to watch
  tool('kinodex.offers.search',
    'Find where titles can be watched. Offers are derived from the virtual clock: upcoming, available, leaving_soon (available, with available_until within 7 days) or ended. Filters: title_ids, query, region (default the account\'s region), types and availability (default excludes ended). on_my_services: true limits offers to the account\'s region and subscribed services. Each title also reports my_subscriptions, derived only from subscription offers on subscribed services in the account\'s region: available, leaving_soon (every such offer ends within 7 days), upcoming or none. Titles are returned in title_ids order, otherwise by name.',
    true, {title_ids: arr(ID, 500, {uniqueItems: true}), query: text(200, 0), region: REGION_ARG, on_my_services: BOOL, types: arr(OFFER_TYPE, 4, {uniqueItems: true}),
      availability: arr(AVAILABILITY, 4, {uniqueItems: true}), limit: LIMIT(500)},
    {region: REGION, on_my_services: BOOL, as_of: TIME, total: INT(0), results: arr(TITLE_OFFERS, 500)}, []),
  tool('kinodex.offers.for_title',
    'List every offer for one title across services and regions (or one region), with derived availability, price and quality, plus my_subscriptions for the account\'s region and services. Ended offers are included only with include_ended.',
    true, {title_id: ID, region: REGION_ARG, include_ended: BOOL}, {region: REGION, as_of: TIME, result: TITLE_OFFERS}, ['title_id']),
  tool('kinodex.services.list',
    'List the streaming, rental and free services Kinodex tracks, with their regions and offer types and whether the account subscribes to each. Kinodex only records subscriptions; it does not sell or start anything.',
    true, {}, {services: arr(obj({service_id: SID, name: text(80), regions: arr(REGION, 3), offer_types: arr(OFFER_TYPE, 4), subscribed: BOOL}), 20)}),
  tool('kinodex.account.get',
    'Read the account: region, subscribed services, settings_version (the App\'s own account-settings version, distinct from the Core expected_version), and the people who appear in its diary\'s watched_with with their entry counts.',
    true, {}, {account: obj({account_id: SID, owner_person_id: SID, region: REGION, service_ids: arr(SID, 6), settings_version: INT(1), updated_at: TIME}),
      people: arr(obj({person_id: SID, name: nullable(text(200)), owner: BOOL, diary_entries: INT(0)}), 50)}),
  // W3 watchlist, diary, ratings and lists
  tool('kinodex.watchlist.get',
    'Read the ordered watchlist and its watchlist_version (an App field that increases with each save; not the Core expected_version).',
    true, {}, {watchlist_version: INT(1), updated_at: TIME, items: arr(LIST_ITEM, 500)}),
  tool('kinodex.diary.list',
    'List diary entries, most recently watched first (entries logged in the same session keep their logging order, latest first). Filters: title_id, inclusive from/to dates, with_person (a person in watched_with) and limit (default 50).',
    true, {title_id: ID, from: DATE, to: DATE, with_person: ID, limit: LIMIT(500)}, {total: INT(0), entries: arr(DIARY_VIEW, 500)}, []),
  tool('kinodex.lists.list',
    'List the account\'s custom lists with their list_version (an App field) and size.',
    true, {}, {lists: arr(obj({list_id: SID, name: text(120), description: text(1000, 0), visibility: VISIBILITY, list_version: INT(1), count: INT(0), updated_at: TIME}), 200)}),
  tool('kinodex.lists.get',
    'Open one custom list with its titles in order.',
    true, {list_id: ID}, {list: obj({list_id: SID, name: text(120), description: text(1000, 0), visibility: VISIBILITY, list_version: INT(1),
      created_at: TIME, updated_at: TIME, items: arr(LIST_ITEM, 500)})}),
  tool('kinodex.reviews.list',
    'List reviews: the person\'s own diary reviews (source mine) and other people\'s public reviews (source public), newest first. hide_spoilers: true withholds the text of reviews marked contains_spoilers.',
    true, {title_id: ID, source: {enum: ['mine', 'public', 'all']}, hide_spoilers: BOOL, limit: LIMIT(200)},
    {reviews: arr(obj({review_id: SID, source: {enum: ['mine', 'public']}, title_id: SID, title_name: text(200), author: text(200), rating: nullable(NUM),
      contains_spoilers: BOOL, text: nullable(text(5000)), text_withheld: BOOL, visibility: VISIBILITY, posted_at: TIME}), 200)}, []),
  // W4 alerts
  tool('kinodex.alerts.list',
    'List alert rules, newest first. status is derived from the virtual clock: an active rule whose expires_at has been reached without a recorded trigger reads as expired. A triggered rule keeps the trigger: time, cause (event or services.update), event or request ID, and the matching offer or season.',
    true, {status: {enum: ['active', 'triggered', 'expired', 'deleted']}, title_id: ID}, {alerts: arr(ALERT_VIEW, 1000)}, []),
  // W5 corrections
  tool('kinodex.corrections.list',
    'List the corrections this account submitted, newest first, with target, proposed and current value, status and every decision with its note and time.',
    true, {status: CORRECTION_STATUS, title_id: ID}, {corrections: arr(CORRECTION_VIEW, 1000)}, []),
  tool('kinodex.notices.list',
    'List in-app notices, newest first: alerts triggered by an Infra event, decided corrections and new guide versions for watchlist titles. Optional since (inclusive), kind and limit (default 50).',
    true, {since: TIME, kind: {enum: ['alert_triggered', 'correction_decided', 'guide_updated']}, limit: LIMIT(500)}, {notices: arr(NOTICE, 500)}, []),

  // Writes
  tool('kinodex.services.update',
    'Change the account\'s region (US, UK or CA) and/or subscribed services (patch.region, patch.service_ids replace the stored values; an unknown service or region returns not_found). Optional expected_settings_version checks the App\'s settings_version (object_version_conflict if it differs). In the same write, active unexpired available_on_my_services and price_below rules that the new region or services satisfy become triggered with cause services.update, the matching offer and this request_id. This write emits no notice. A patch that changes nothing returns no_change.',
    false, {patch: obj({region: REGION_ARG, service_ids: arr(ID, 6, {uniqueItems: true})}, []), expected_settings_version: INT(1)},
    {...RECEIPT_ID, settings_version: INT(1), region: REGION, service_ids: arr(SID, 6), triggered_alerts: arr(obj({alert_id: SID, title_id: SID, offer_id: SID}), 500)}, ['patch']),
  tool('kinodex.watchlist.save',
    'Replace the whole ordered watchlist with title_ids. Returns the new watchlist_version. Optional expected_watchlist_version checks the App\'s watchlist_version (object_version_conflict if it differs). Saving the same order returns no_change.',
    false, {title_ids: arr(ID, 500, {uniqueItems: true}), expected_watchlist_version: INT(1)},
    {...RECEIPT_ID, watchlist_version: INT(1), count: INT(0)}, ['title_ids']),
  tool('kinodex.diary.log',
    'Log a viewing. Films may name an edition_id; series entries need episode_ids from that series. watched_on is a YYYY-MM-DD date that cannot be after today (the date of the virtual clock in the account\'s time zone) or before the title\'s earliest release in any region (or an episode\'s air date): invalid_date. rating is optional, in half stars from 0.5 to 5 (invalid_rating otherwise). watched_with lists other people\'s person_ids from the binding. review is optional, with contains_spoilers and visibility.',
    false, {title_id: ID, episode_ids: arr(ID, 50, {uniqueItems: true}), edition_id: ID, watched_on: DATE, rewatch: BOOL,
      watched_with: arr(ID, 20, {uniqueItems: true}), rating: NUM, review: REVIEW},
    {...RECEIPT_ID, entry: DIARY_VIEW}, ['title_id', 'watched_on']),
  tool('kinodex.diary.update',
    'Edit a diary entry: id plus patch with any of edition_id, watched_on, rewatch, watched_with, rating and review (null removes a rating or review). The same date and rating rules as kinodex.diary.log apply. A patch that changes nothing returns no_change.',
    false, {id: ID, patch: DIARY_PATCH}, {...RECEIPT_ID, changed_fields: arr(text(40), 10), entry: DIARY_VIEW}),
  tool('kinodex.diary.delete',
    'Delete a diary entry together with its rating and review, and return what was removed.',
    false, {id: ID}, {...RECEIPT_ID, removed: obj({title_id: SID, episode_ids: arr(SID, 50), watched_on: DATE, rating: nullable(NUM), review: nullable(REVIEW)})}),
  tool('kinodex.lists.create',
    'Create a custom list (list_version 1) with a name, optional description, visibility (default private) and ordered titles.',
    false, {name: text(120), description: text(1000, 0), visibility: VISIBILITY, title_ids: arr(ID, 500, {uniqueItems: true})},
    {...RECEIPT_ID, list_version: INT(1)}, ['name']),
  tool('kinodex.lists.save',
    'Change a custom list: id plus patch with any of name, description, visibility and title_ids (title_ids replaces the whole ordered set). Returns the new list_version. Optional expected_list_version checks the App\'s list_version (object_version_conflict if it differs). A patch that changes nothing returns no_change.',
    false, {id: ID, patch: LIST_PATCH, expected_list_version: INT(1)}, {...RECEIPT_ID, list_version: INT(1), changed_fields: arr(text(40), 4)}, ['id', 'patch']),
  tool('kinodex.lists.delete',
    'Delete a custom list.',
    false, {id: ID}, {...RECEIPT_ID, deleted: {const: true}}),
  tool('kinodex.alerts.create',
    'Create an alert rule for a title. available_on_my_services matches a currently available subscription offer in the account\'s region on a subscribed service (rentals, purchases, free_with_ads, upcoming, ended and other-region offers never match). price_below needs offer_type rent or buy and a threshold; it matches an available offer of that type in the account\'s region priced strictly below the threshold. new_season (series only) matches a season added after the rule was created. Optional expires_at must be in the future. Errors: already_true (an offer already matches; the message names it and no rule is stored), duplicate_alert (an active rule of the same kind exists for the title), invalid_threshold. Rules are evaluated only when an Infra event changes the title\'s offers, title or seasons, or when kinodex.services.update changes the region or subscriptions; an upcoming offer that starts by the clock alone does not fire a rule until then.',
    false, {kind: ALERT_KIND, title_id: ID, offer_type: {enum: ['rent', 'buy']}, threshold: NUM, expires_at: TIME},
    {...RECEIPT_ID, alert: ALERT_VIEW}, ['kind', 'title_id']),
  tool('kinodex.alerts.update',
    'Change an active, unexpired rule: id plus patch with threshold (price_below only) and/or expires_at (null clears it). A triggered, expired or deleted rule returns not_active and keeps its status and history.',
    false, {id: ID, patch: ALERT_PATCH}, {...RECEIPT_ID, alert: ALERT_VIEW}),
  tool('kinodex.alerts.delete',
    'Delete an active, unexpired rule (status deleted). Triggered, expired and deleted rules return not_active.',
    false, {id: ID}, {...RECEIPT_ID, alert: ALERT_VIEW}),
  tool('kinodex.corrections.submit',
    'Submit a correction. A correction targets a title, a field and the specific object: runtime needs target.edition_id, release_date and certification need target.region, credit needs target.credit_id and guide_item needs target.item_id (an item in the current guide version). proposed_value is a YYYY-MM-DD date, whole minutes, a certification label for that region, a credit patch {role, character, billing_order} or a guide-item patch {text, spoiler}. The evidence note is required. Errors: no_change (equal to that object\'s current value), already_submitted (an open correction exists for the same title, field and target).',
    false, {title_id: ID, field: FIELD, target: TARGET, proposed_value: PROPOSED, evidence: text(2000)}, {...RECEIPT_ID, correction: CORRECTION_VIEW}),
  tool('kinodex.corrections.amend',
    'Amend a correction in needs_info once (id plus patch with proposed_value and/or evidence); it returns to submitted. A submitted correction returns already_submitted; a decided or withdrawn one returns already_decided.',
    false, {id: ID, patch: CORRECTION_PATCH}, {...RECEIPT_ID, correction: CORRECTION_VIEW}),
  tool('kinodex.corrections.withdraw',
    'Withdraw an open (submitted or needs_info) correction. A decided or withdrawn correction returns already_decided.',
    false, {id: ID}, {...RECEIPT_ID, correction: CORRECTION_VIEW}),
];

const write = (file, value) => fs.writeFileSync(path.join(out, file), JSON.stringify(value, null, 2) + '\n');
write('schemas/seed.schema.json', seed);
write('schemas/events.schema.json', events);
write('tools.json', tools);
console.log('wrote', tools.length, 'tools (' + tools.filter(t => t.read_only).length + ' read, ' + tools.filter(t => !t.read_only).length + ' write)');
