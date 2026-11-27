'use strict';
// Single source of truth for the CivicDesk data model and tool contracts. scripts/build.cjs renders the seed, events and
// state schemas, tools.json, fixtures/policies.json and the event_types in app.json from here. Edit this file, then build.
const APP = 'civicdesk';
const PREFIX = APP + '.';

const ID = {type:'string', pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
const DATE = {type:'string', format:'date-time'};
const DAY = {type:'string', pattern:'^\\d{4}-\\d{2}-\\d{2}$'};
const BOOL = {type:'boolean'};
const INT = (min = 0, max = 1000000) => ({type:'integer', minimum:min, maximum:max});
const TEXT = (max = 2000, min = 1) => ({type:'string', minLength:min, maxLength:max});
const ENUM = (...values) => ({enum:values});
const NULLABLE = schema => ({anyOf:[schema, {type:'null'}]});
const obj = (properties, required = Object.keys(properties)) => ({type:'object', properties, required, additionalProperties:false});
const arr = (items, extra = {}) => ({type:'array', items, ...extra});
const VERSION = obj({epoch:INT(1), revision:INT(0)});
const FILE_OUT = obj({filename:{type:'string', minLength:1, maxLength:160, pattern:'^[^\\\\/\\u0000-\\u001f\\u007f]+$'}, mime_type:ENUM('text/plain', 'application/pdf'), base64:{type:'string', maxLength:1398104}, sha256:{type:'string', pattern:'^[a-f0-9]{64}$'}});

// ---- record shapes ----------------------------------------------------------
const HISTORY = arr(obj({at:DATE, action:TEXT(80), detail:NULLABLE(TEXT(1000, 0))}, ['at', 'action']), {maxItems:1000});
const SETTINGS = obj({timezone:TEXT(60), min_comment_chars:INT(1, 1000), max_comment_chars:INT(100, 50000), closing_soon_days:INT(1, 60)});
const MEMBER = obj({name:TEXT(200), email:TEXT(200), organization:NULLABLE(TEXT(200))});
const AGENCY = obj({agency_id:ID, name:TEXT(200), acronym:TEXT(12), timezone:TEXT(60), description:TEXT(600, 0)});
const CORRECTION = obj({at:DATE, text:TEXT(2000)});
const DOCKET = obj({docket_id:ID, agency_id:ID, title:TEXT(300), summary:TEXT(6000), supplementary_information:TEXT(6000, 0), opened_at:DATE, closes_at:DATE, extended_from:NULLABLE(DATE),
  corrections:arr(CORRECTION, {maxItems:20}), document_ids:arr(ID, {maxItems:20, uniqueItems:true}), public_comment_count:INT(0), created_at:DATE, updated_at:DATE, history:HISTORY});
const DOC_KIND = ENUM('notice', 'supporting', 'analysis');
const DOCUMENT = obj({document_id:ID, docket_id:ID, title:TEXT(300), kind:DOC_KIND, mime_type:ENUM('text/plain', 'application/pdf'), asset_id:ID, bytes:INT(1), published_at:DATE});
const SUBMITTER = obj({kind:ENUM('named', 'anonymous'), name:NULLABLE(TEXT(200)), organization:NULLABLE(TEXT(200))});
const PROBLEM = obj({code:ENUM('too_short', 'too_long', 'name_required', 'period_closed', 'unknown_docket', 'possible_duplicate'), message:TEXT(500)});
const DRAFT = obj({draft_id:ID, docket_id:ID, text:TEXT(50000, 0), submitter:SUBMITTER, supplemental:BOOL, created_at:DATE, updated_at:DATE, history:HISTORY});
const COMMENT_STATUS = ENUM('received', 'posted', 'returned');
const NOTICE = obj({kind:ENUM('receipt', 'status'), status:ENUM('delivered', 'rejected', 'unknown'), at:DATE, event_id:NULLABLE(ID)});
const COMMENT = obj({comment_id:ID, docket_id:ID, draft_id:NULLABLE(ID), tracking_number:TEXT(40), text:TEXT(50000), text_sha256:{type:'string', pattern:'^[a-f0-9]{64}$'}, submitter:SUBMITTER, supplemental:BOOL,
  status:COMMENT_STATUS, return_reason:NULLABLE(TEXT(500)), submitted_at:DATE, updated_at:DATE, notices:arr(NOTICE, {maxItems:50}), history:HISTORY});
const SEED = {
  ...obj({account_id:ID, owner_person_id:ID, settings:SETTINGS, member:MEMBER, agencies:arr(AGENCY, {minItems:1, maxItems:20}), dockets:arr(DOCKET, {maxItems:500}), documents:arr(DOCUMENT, {maxItems:64}),
    drafts:arr(DRAFT, {maxItems:100}), comments:arr(COMMENT, {maxItems:500})}),
  $schema:'https://json-schema.org/draft/2020-12/schema', $id:'urn:pale:' + APP + ':seed:1'
};

// ---- events (applied by Infra through env.apply_event) ----------------------
const EVENTS = [
  ['docket.period_extended', obj({docket_id:ID, new_closes_at:DATE, reason:TEXT(500)}, ['docket_id', 'new_closes_at'])],
  ['docket.correction_published', obj({docket_id:ID, text:TEXT(2000)})],
  ['comment.status_changed', obj({comment_id:ID, status:ENUM('posted', 'returned'), reason:TEXT(500)}, ['comment_id', 'status'])],
  ['comment.notice_recorded', obj({comment_id:ID, kind:ENUM('receipt', 'status'), status:ENUM('delivered', 'rejected', 'unknown'), event_id:NULLABLE(ID)})]
];
const EVENT_SCHEMA = {$schema:'https://json-schema.org/draft/2020-12/schema', oneOf:EVENTS.map(([operation, payload]) => obj({event_id:ID, at:DATE, operation:{const:operation}, payload}))};

// ---- tool contracts (every view carries `id`, the value the matching `id` argument expects) ----
const PERIOD_STATUS = ENUM('open', 'extended', 'closed');
const AGENCY_SUMMARY = obj({agency_id:ID, name:TEXT(200), acronym:TEXT(12), timezone:TEXT(60)});
const DOCUMENT_SUMMARY = obj({id:ID, ...DOCUMENT.properties});
const DOCKET_VIEW = obj({id:ID, ...DOCKET.properties, agency:AGENCY_SUMMARY, status:PERIOD_STATUS, closes_at_local:TEXT(80), closing_soon:BOOL, days_left:NULLABLE(INT(0, 3660)), documents:arr(DOCUMENT_SUMMARY, {maxItems:20}),
  my_comment_ids:arr(ID, {maxItems:50}), my_draft_id:NULLABLE(ID)});
const DOCKET_SUMMARY = obj({id:ID, docket_id:ID, title:TEXT(300), agency:AGENCY_SUMMARY, status:PERIOD_STATUS, opened_at:DATE, closes_at:DATE, closes_at_local:TEXT(80), extended_from:NULLABLE(DATE), closing_soon:BOOL, days_left:NULLABLE(INT(0, 3660)),
  corrections:INT(0), document_count:INT(0), public_comment_count:INT(0), my_comment_ids:arr(ID, {maxItems:50}), my_draft_id:NULLABLE(ID)});
const DRAFT_VIEW = obj({id:ID, ...DRAFT.properties, problems:arr(PROBLEM, {maxItems:10}), ready:BOOL, docket_title:TEXT(300), docket_status:PERIOD_STATUS});
const COMMENT_VIEW = obj({id:ID, ...COMMENT.properties, docket_title:TEXT(300), agency:AGENCY_SUMMARY});
const RECEIPT = obj({comment_id:ID, tracking_number:TEXT(40), docket_id:ID, docket_title:TEXT(300), agency:AGENCY_SUMMARY, submitted_at:DATE, submitted_at_local:TEXT(80), submitter:SUBMITTER, supplemental:BOOL, text_sha256:{type:'string', pattern:'^[a-f0-9]{64}$'}, status:COMMENT_STATUS, text:TEXT(50000)});

const read = (name, description, input, output) => ({name:PREFIX + name, description, read_only:true, input, output});
const write = (name, description, input, output) => ({name:PREFIX + name, description, read_only:false, input, output});

const TOOLS = [
  read('dockets.search', 'Search proposed rules (dockets) by keyword, agency, period status and closing date. Each result carries the agency, the comment period with its closing time in the agency\'s time zone, whether it closes soon, and the member\'s own comments and draft on it.',
    obj({query:TEXT(200, 0), agency_id:ID, status:ENUM('open', 'extended', 'closed', 'all'), closing_after:DAY, closing_before:DAY}, []), obj({dockets:arr(DOCKET_SUMMARY, {maxItems:500})})),
  read('dockets.get', 'Read one docket: the rule summary and supplementary information, the comment period with its opening and closing instants in the agency\'s time zone, extensions and corrections with their dates, the supporting documents, and the member\'s comments and draft on it.',
    obj({id:ID}), obj({docket:DOCKET_VIEW})),
  read('dockets.documents', 'Read the supporting documents of one docket (id is the docket ID) with their bytes: filename, MIME type (UTF-8 text or text-based PDF), base64 and SHA-256, in the shape files.put and mail.attachment.add accept.',
    obj({id:ID}), obj({docket_id:ID, documents:arr(obj({...DOCUMENT_SUMMARY.properties, file:FILE_OUT}), {maxItems:20})})),
  read('comments.validate', 'Check a comment before drafting or submitting it, without changing anything: length limits, the name a named submission needs, whether the docket\'s period is open now, and whether it would be a possible duplicate of the member\'s own comment on that docket.',
    obj({docket_id:ID, text:TEXT(50000, 0), submitter:SUBMITTER, supplemental:BOOL}, ['docket_id', 'text', 'submitter']), obj({ok:BOOL, problems:arr(PROBLEM, {maxItems:10}), docket_status:PERIOD_STATUS, closes_at:DATE, closes_at_local:TEXT(80), characters:INT(0)})),
  read('comments.receipt', 'Read the receipt of a submitted comment (id is the comment ID): tracking number, docket, agency, submission time in the agency\'s time zone, how the member appears on the public record, and the SHA-256 of the submitted text.',
    obj({id:ID}), obj({receipt:RECEIPT})),
  read('comments.status', 'Read the current status of a submitted comment (id is the comment ID): received, posted, or returned with the agency\'s reason, with its history and the delivery outcomes of its notices.',
    obj({id:ID}), obj({comment:COMMENT_VIEW})),
  read('comments.list_mine', 'List the member\'s drafts and submitted comments with their status.',
    obj({status:ENUM('all', 'received', 'posted', 'returned')}, []), obj({drafts:arr(DRAFT_VIEW, {maxItems:100}), comments:arr(COMMENT_VIEW, {maxItems:500})})),

  write('comments.draft', 'Save a comment draft on a docket, or update the draft named by id. The draft is stored even with problems; the problems are returned so they can be fixed before submitting. Named submissions need a name; anonymous ones carry none. Errors: unknown_docket, invalid_state (a draft already submitted).',
    obj({id:ID, docket_id:ID, text:TEXT(50000, 0), submitter:SUBMITTER, supplemental:BOOL}, ['docket_id', 'text', 'submitter']), obj({id:ID, docket_id:ID, problems:arr(PROBLEM, {maxItems:10}), ready:BOOL, characters:INT(0)})),
  write('comments.submit', 'Submit the draft named by id to the agency. Requires acknowledged: true, the member\'s acknowledgment that a submitted comment is public and cannot be withdrawn. Errors: acknowledgment_required, period_closed (with the closing instant and time zone), invalid_draft (with the problems), possible_duplicate (a second non-supplemental submission on the same docket). Submitting the same draft again returns the existing receipt.',
    obj({id:ID, acknowledged:BOOL}), obj({id:ID, draft_id:ID, docket_id:ID, tracking_number:TEXT(40), submitted_at:DATE, outcome:ENUM('received', 'already_submitted')}))
];
function toolEntry(t) {
  const input = structuredClone(t.input);
  if (!t.read_only) {input.properties.expected_version = VERSION; input.properties.request_id = ID; input.required = [...input.required, 'expected_version', 'request_id'];}
  const output = structuredClone(t.output);
  output.properties = {status:{const:t.read_only ? 'ok' : 'committed'}, app_id:{const:APP}, version:VERSION, ...output.properties};
  output.required = ['status', 'app_id', 'version', ...output.required];
  return {name:t.name, description:t.description, read_only:t.read_only, scope:t.name, resource_target:'current account', inputSchema:input, outputSchema:output};
}
// Profiles a task can start from. The scenario profile withholds nothing: whether the agent may submit is the task policy's decision.
const POLICIES = {scenario:{allow:TOOLS.map(t => t.name), constraints:{}}, sandbox:{allow:TOOLS.map(t => t.name), constraints:{}}};
module.exports = {APP, PREFIX, SEED, EVENTS, EVENT_SCHEMA, TOOLS, toolEntry, POLICIES, shapes:{ID, DATE, DAY, FILE_OUT}};
