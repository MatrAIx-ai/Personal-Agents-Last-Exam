'use strict';
// Maintainer script (not run by tests or the verifier). Regenerates schemas/seed.schema.json,
// schemas/events.schema.json and tools.json from one set of field definitions.
// Usage, from the package directory: node dev/build-contracts.cjs
const fs = require('node:fs'), path = require('node:path');
const out = path.resolve(__dirname, '..');
const APP = 'dayline';

const ID = {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
const TIME = {type: 'string', format: 'date-time'};
const text = (max, min = 1) => ({type: 'string', minLength: min, maxLength: max});
const LANG = {type: 'string', pattern: '^[a-z]{2,3}(-[A-Z]{2})?$'};
const obj = (properties, required = Object.keys(properties)) => ({type: 'object', properties, required, additionalProperties: false});
const arr = (items, maxItems, extra = {}) => ({type: 'array', items, maxItems, ...extra});
const nullable = s => ({anyOf: [s, {type: 'null'}]});
const VERSION = obj({epoch: {type: 'integer', minimum: 1}, revision: {type: 'integer', minimum: 0}});

const CREDIT = obj({edition_id: ID, credit: text(300)});
const editionFields = {
  edition_id: ID, story_id: ID, outlet_id: ID, section: ID, geography: ID, language: LANG,
  headline: text(300), byline: text(200), text: text(20000),
  credits: arr(CREDIT, 20), published_at: TIME,
};
const OUTLET = obj({outlet_id: ID, name: text(200),
  kind: {enum: ['wire', 'local', 'regional', 'state', 'national', 'international']},
  language: LANG, geography: ID, description: text(1000, 0)});
const STORY = obj({story_id: ID, title: text(200), created_at: TIME});
const EDITION = obj({...editionFields, added_at: TIME});
const FRONT_PAGE = obj({front_page_id: ID, title: text(100), kind: {enum: ['region', 'section']},
  entries: arr(ID, 200, {uniqueItems: true})});

const seed = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:pale:dayline:seed:1',
  ...obj({
    account_id: ID, owner_person_id: ID,
    outlets: arr(OUTLET, 200), stories: arr(STORY, 500), editions: arr(EDITION, 2000),
    front_pages: arr(FRONT_PAGE, 50),
    reading_history: arr(obj({edition_id: ID, read_at: TIME}), 5000),
    reading_list: arr(obj({edition_id: ID, saved_at: TIME}), 1000),
  }),
};

const publishPayload = obj({...editionFields, front_page: ID, position: {type: 'integer', minimum: 1, maximum: 200}},
  Object.keys(editionFields));
const events = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:pale:dayline:events:1',
  ...obj({event_id: ID, at: TIME, operation: {const: 'edition.publish'}, payload: publishPayload}),
};

const SUMMARY_FIELDS = {
  edition_id: ID, story_id: ID, outlet_id: ID, outlet_name: text(200), section: ID, geography: ID,
  language: LANG, headline: text(300), byline: text(200), published_at: TIME,
  read: {type: 'boolean'}, saved: {type: 'boolean'},
};
const SUMMARY = obj(SUMMARY_FIELDS);
const FULL = obj({...SUMMARY_FIELDS, text: text(20000), credits: arr(CREDIT, 20), added_at: TIME,
  read_at: nullable(TIME), saved_at: nullable(TIME)});
const LIMIT = max => ({type: 'integer', minimum: 1, maximum: max});

// Every write receipt: null, or how many stored entries dated after the clock the write replaced, by list.
// Only counts, because the receipt goes to the Agent. This happens only when a seed that runs past its clock
// is loaded early.
const LATER = nullable({type: 'object', additionalProperties: {type: 'integer', minimum: 1}});
const LATER_NOTE = ' later_history_removed is null unless the loaded data holds an entry for this edition dated after the clock, which this change replaced; it then counts it by list.';
function tool(name, description, readOnly, input, output, required = Object.keys(input)) {
  const inputSchema = readOnly ? obj(input, required)
    : obj({...input, expected_version: VERSION, request_id: ID}, [...required, 'expected_version', 'request_id']);
  const outputSchema = obj({status: {const: readOnly ? 'ok' : 'committed'}, app_id: {const: APP}, version: VERSION, ...output,
    ...(readOnly ? {} : {later_history_removed: LATER})});
  if (!readOnly) description += LATER_NOTE;
  return {name, description, read_only: readOnly, scope: name, resource_target: 'current account', inputSchema, outputSchema};
}

const tools = [
  tool('dayline.outlets.list',
    'List the publishers and desks whose editions Dayline carries, with their kind, language and home geography.',
    true, {}, {outlets: arr(OUTLET, 200)}),
  tool('dayline.front_pages.list',
    'List the regional and section front pages Dayline\'s editors maintain.',
    true, {}, {front_pages: arr(obj({front_page_id: ID, title: text(100), kind: {enum: ['region', 'section']}, entry_count: {type: 'integer', minimum: 0}}), 50)}),
  tool('dayline.front_page.get',
    'Read one front page in editorial order (position 1 is the lead; all entries unless limit is given). Entries show headline, outlet, byline, story group and whether this reader has read or saved each edition. Does not mark anything read.',
    true, {front_page_id: ID, limit: LIMIT(200)},
    {front_page: obj({front_page_id: ID, title: text(100), kind: {enum: ['region', 'section']}}),
      entries: arr(obj({position: {type: 'integer', minimum: 1}, ...SUMMARY_FIELDS}), 200)},
    ['front_page_id']),
  tool('dayline.search',
    'Search published editions by words in the headline, text, byline, credits, outlet or story title (case- and accent-insensitive; every query word must match the start of a word, so "air" finds "airport" but not "repair"), with optional exact-match filters and an inclusive published_after/published_before window. Returns up to limit (default 20) editions, newest publication first; total counts every match. Does not mark anything read.',
    true, {query: text(200, 0), outlet_id: ID, section: ID, geography: ID, language: LANG, story_id: ID,
      published_after: TIME, published_before: TIME, limit: LIMIT(50)},
    {total: {type: 'integer', minimum: 0}, editions: arr(SUMMARY, 50)}, []),
  tool('dayline.story.get',
    'Open an editor-assigned story group: every published edition filed under it, oldest publication first. The group is a navigation aid; use each edition\'s text and credits to see who reported what.',
    true, {story_id: ID}, {story: obj({story_id: ID, title: text(200)}), editions: arr(SUMMARY, 2000)}),
  tool('dayline.edition.get',
    'Read one edition in full: text, byline, publisher-disclosed credits, publication time and this reader\'s read/saved status. Reading on the reader\'s behalf does not add it to their reading history.',
    true, {edition_id: ID}, {edition: FULL}),
  tool('dayline.history.list',
    'List this reader\'s private reading history, most recent first (default limit 50).',
    true, {limit: LIMIT(200)}, {entries: arr(obj({read_at: TIME, edition: SUMMARY}), 5000)}, []),
  tool('dayline.saved.list',
    'List the editions on this reader\'s private reading list, most recently saved first.',
    true, {}, {entries: arr(obj({saved_at: TIME, edition: SUMMARY}), 1000)}),
  tool('dayline.history.mark_read',
    'Record in the reader\'s private history that they have read an edition. Marking an edition that is already in the history changes nothing.',
    false, {edition_id: ID}, {edition_id: ID, read: {const: true}, changed: {type: 'boolean'}}),
  tool('dayline.saved.add',
    'Save an edition to the reader\'s private reading list. Returns only the edition ID and save status (never the headline). Saving an edition that is already saved leaves one entry.',
    false, {edition_id: ID}, {edition_id: ID, saved: {const: true}, changed: {type: 'boolean'}}),
  tool('dayline.saved.remove',
    'Remove an edition from the reader\'s private reading list. Fails if the edition is not on the list.',
    false, {edition_id: ID}, {edition_id: ID, saved: {const: false}, changed: {const: true}}),
];

const write = (file, value) => fs.writeFileSync(path.join(out, file), JSON.stringify(value, null, 2) + '\n');
write('schemas/seed.schema.json', seed);
write('schemas/events.schema.json', events);
write('tools.json', tools);
console.log('wrote', tools.length, 'tools');
