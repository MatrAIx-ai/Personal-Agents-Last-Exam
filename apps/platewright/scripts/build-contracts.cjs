#!/usr/bin/env node
'use strict';
// Authoring-time generator for Platewright's own contracts: tools.json, schemas/seed.schema.json and
// schemas/events.schema.json are written from the definitions below so
// every record shape is stated once. `--check` reports drift instead of writing (run by the tests).
// schemas/state.schema.json is the provided Core state envelope with this App's identity; the shared
// platform schema copies (bundle, dataset, ...) are kept in sync by the repository's `npm run contracts:check`.
const fs = require('node:fs'), path = require('node:path');
const C = require('../src/common.cjs');
const {UNIT_NAMES, UNIT_SYSTEMS} = require('../src/units.cjs');
const app = require('../app.json');
const root = path.resolve(__dirname, '..');

const ID = {type: 'string', pattern: C.ID_PATTERN.source};
const DATE = {type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$'};
const SLOT = {type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}:(' + C.MEALS.join('|') + ')$'};
const TS = {type: 'string', format: 'date-time'};
const BOOL = {type: 'boolean'}, NUM = {type: 'number'}, POS = {type: 'number', minimum: 0};
const INT = (min = 0, max) => ({type: 'integer', minimum: min, ...(max !== undefined ? {maximum: max} : {})});
const str = (max = 200, min = 1) => ({type: 'string', minLength: min, maxLength: max});
const nul = s => ({anyOf: [s, {type: 'null'}]});
const arr = (items, extra = {}) => ({type: 'array', items, ...extra});
const en = values => ({enum: [...values]});
const UNIT = en(UNIT_NAMES);
const ACTOR = en(['seed', 'agent', 'event']);
function obj(properties, optional = [], open = false) {
  return {type: 'object', properties, required: Object.keys(properties).filter(k => !optional.includes(k)), additionalProperties: open};
}
const VERSION = obj({epoch: INT(1), revision: INT(0)});

// ---- Seed records -------------------------------------------------------------------------------
const defs = {};
const ref = name => ({$ref: 'seed.schema.json#/$defs/' + name});
defs.household = obj({name: str(120), time_zone: str(64), week_start: en(C.WEEKDAYS), unit_system: en(UNIT_SYSTEMS),
  leftover_max_days: INT(0, 14), use_soon_days: INT(0, 30)});
defs.nutrition = obj(Object.fromEntries(C.NUTRIENTS.map(n => [n, POS])));
defs.ingredient = obj({id: ID, name: str(120), aliases: arr(str(120), {maxItems: 20}), category: str(60),
  allergens: arr(en(C.ALLERGENS), {uniqueItems: true}), may_contain: arr(en(C.ALLERGENS), {uniqueItems: true}),
  flags: arr(en(C.FLAGS), {uniqueItems: true}), tags: arr(str(40), {uniqueItems: true, maxItems: 20}),
  measures: arr(en(['mass', 'volume', 'count']), {minItems: 1, uniqueItems: true}),
  density_g_per_ml: nul({type: 'number', minimum: 0.01}), piece_g: nul({type: 'number', minimum: 0.01}),
  buy_unit: UNIT, whole_pieces: BOOL, nutrition_per_100g: ref('nutrition')});
defs.rule = obj({id: ID, from_ingredient_id: ID, to_ingredient_id: ID, ratio: NUM, methods: arr(en(C.METHODS), {minItems: 1, uniqueItems: true}), note: str(300)});
const targetProps = {allergen: en(C.ALLERGENS), strict: BOOL, ingredient_id: ID, flag: en(C.FLAGS), tag: str(40),
  diet: en(Object.keys(C.DIETS)), nutrient: en(C.NUTRIENTS), max: NUM};
const TARGET_KEYS = Object.keys(targetProps);
defs.constraint_body = obj({kind: en(C.KINDS), ...targetProps, effective_from: nul(DATE), expires_on: nul(DATE), note: nul(str(500))}, TARGET_KEYS);
defs.constraint = obj({id: ID, kind: en(C.KINDS), ...targetProps, effective_from: nul(DATE), expires_on: nul(DATE), note: nul(str(500)),
  set_by: nul(ID), ended_at: nul(TS),
  history: arr(obj({at: TS, actor: ACTOR, by: nul(ID), action: en(['created', 'replaced', 'ended']), note: nul(str(500)),
    request_id: nul(ID), event_id: nul(ID), previous: nul(ref('constraint_body'))}), {minItems: 1, maxItems: 500})}, TARGET_KEYS);
defs.guest_constraint = obj({kind: en(C.KINDS), ...targetProps, note: nul(str(500))}, TARGET_KEYS);
defs.guest = obj({guest_id: ID, name: str(120), constraints: arr(ref('guest_constraint'), {maxItems: 20})});
defs.member = obj({person_id: ID, display_name: str(120), portion_factor: {type: 'number', minimum: 0.25, maximum: 4},
  constraints: arr(ref('constraint'), {maxItems: 100})});
defs.line = obj({ingredient_id: ID, quantity: NUM, unit: UNIT, optional: BOOL, note: nul(str(200))});
const contentProps = {title: str(200), servings: NUM, lines: arr(ref('line'), {minItems: 1, maxItems: 40}),
  method_tags: arr(en(C.METHODS), {minItems: 1, uniqueItems: true}), steps: arr(str(1000), {minItems: 1, maxItems: 40}),
  tags: arr(str(40), {uniqueItems: true, maxItems: 20}), active_minutes: nul(INT(0, 10000)), total_minutes: nul(INT(0, 10000))};
defs.content = obj(contentProps);
const ORIGIN = {at: TS, actor: ACTOR, by: nul(ID), request_id: nul(ID), event_id: nul(ID)};
defs.origin = obj(ORIGIN);
defs.swap = obj({line: INT(0), from_ingredient_id: ID, to_ingredient_id: ID, ratio: NUM, rule_id: nul(ID), custom: BOOL});
defs.variant = obj({base_recipe_id: ID, base_revision: INT(1), swaps: arr(ref('swap'), {minItems: 1}), unverified: BOOL});
defs.recipe = obj({id: ID, ...contentProps, archived: BOOL, revision: INT(1),
  revisions: arr(obj({revision: INT(1), ...ORIGIN, content: ref('content')}), {minItems: 1, maxItems: 500}),
  variant: nul(ref('variant')), origin: ref('origin'),
  history: arr(obj({...ORIGIN, action: en(['created', 'revised', 'archived', 'restored']), revision: INT(1)}), {minItems: 1, maxItems: 1000})});
defs.dish = {anyOf: [obj({recipe_id: ID, servings: nul(NUM)}), obj({leftovers_of: SLOT, recipe_id: ID, portions: NUM})]};
defs.slot = obj({id: SLOT, date: DATE, meal: en(C.MEALS), state: en(['planned', 'cleared', 'cooked', 'skipped']),
  dishes: arr(ref('dish'), {maxItems: 10}), attendees: arr(ID, {uniqueItems: true, maxItems: 20}), guests: arr(ref('guest'), {maxItems: 20}),
  note: nul(str(500)),
  cooked: nul(obj({at: TS, portions: arr(obj({recipe_id: ID, revision: INT(1), made: POS, eaten: POS})), deducted: BOOL,
    short: arr(obj({ingredient_id: ID, quantity: NUM, unit: UNIT, reason: en(['not_in_pantry', 'no_conversion', 'not_enough', 'expired'])}))})),
  updated_at: TS,
  history: arr(obj({...ORIGIN, action: en(['set', 'replaced', 'cleared', 'cooked', 'skipped', 'guest_added', 'guest_changed', 'guest_removed']),
    dishes: arr(ref('dish')), attendees: arr(ID), guest_ids: arr(ID)}), {minItems: 1, maxItems: 500})});
defs.pantry_item = obj({ingredient_id: ID, quantity: POS, unit: UNIT, use_by: nul(DATE), updated_at: TS,
  history: arr(obj({...ORIGIN, action: en(['seed', 'set', 'event', 'cooked']), quantity: POS, unit: UNIT, use_by: nul(DATE), slot_id: nul(SLOT)}), {maxItems: 500})});
const LINE_ROW = obj({...ORIGIN, action: en(['derived', 'added', 'changed', 'ticked', 'unticked', 'excluded', 'included', 'surplus', 'needed_again'])});
defs.shopping_line = obj({id: ID, kind: en(['derived', 'manual']), ingredient_id: nul(ID), text: nul(str(200)), quantity: nul(POS), unit: nul(UNIT),
  exact: nul(POS), needed_total: nul(POS), from_pantry: nul(POS), state: en(['needed', 'ticked', 'excluded']), excluded_reason: nul(str(300)),
  surplus: BOOL, slots: arr(SLOT), first_needed: nul(DATE), origin: ref('origin'), history: arr(LINE_ROW, {minItems: 1, maxItems: 200})});
defs.shopping = obj({id: ID, start: DATE, end: DATE, generated_at: TS, generation: INT(1), fingerprint: str(64, 64), next_line: INT(1),
  lines: arr(ref('shopping_line'), {maxItems: 1000}),
  optional_lines: arr(obj({ingredient_id: ID, name: str(120), quantity: POS, unit: UNIT, exact: POS, slot_id: SLOT, recipe_id: ID})),
  expiring_before_use: arr(obj({ingredient_id: ID, name: str(120), quantity: POS, unit: UNIT, use_by: DATE, first_needed: DATE})),
  stock_not_counted: arr(obj({ingredient_id: ID, name: str(120), quantity: POS, unit: UNIT, needed_unit: UNIT, reason: {const: 'no_conversion'}}))});
defs.notification = obj({id: ID, at: TS, kind: en(C.EVENT_KINDS), event_id: ID, by: nul(ID), object_id: ID, title: str(300), body: str(2000)});
defs.activity = obj({seq: INT(1), at: TS, actor: en(['agent', 'event']), by: nul(ID), action: str(80), object_id: ID, request_id: nul(ID), event_id: nul(ID)});

const list = (name, max = 5000) => arr(ref(name), {maxItems: max});
const seed = {$schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Platewright household seed',
  description: 'One household seen from one account: reference tables (ingredients, substitution rules) and household records with their history. Generated by scripts/build-contracts.cjs.',
  ...obj({account_id: ID, owner_person_id: ID, household: ref('household'), members: list('member', 20), ingredients: list('ingredient', 1000),
    substitution_rules: list('rule', 500), recipes: list('recipe', 1000), plan: list('slot', 2000), pantry: list('pantry_item', 1000),
    shopping: nul(ref('shopping')), notifications: list('notification', 5000), activity: list('activity', 20000)}),
  $defs: defs};

// Inlines $refs so published tool and event schemas are self-contained.
function inline(schema) {
  if (Array.isArray(schema)) return schema.map(inline);
  if (!schema || typeof schema !== 'object') return schema;
  if (schema.$ref) return inline(defs[schema.$ref.split('/').pop()]);
  return Object.fromEntries(Object.entries(schema).map(([k, v]) => [k, inline(v)]));
}

// The published seed schema is self-contained as well: Core validates the whole seed (and the state's
// data and initial_data) on every call, and its validator resolves a file $ref on the file system each
// time it meets one, which made validation about four times slower than with the definitions inlined.
const SEED_PUBLISHED = (({$defs, ...rest}) => inline(rest))(seed);

// ---- Inputs shared by tools and events ---------------------------------------------------------------
// Constraint and guest inputs take plain strings for what they name, so the App can answer
// invalid_constraint for anything that is not in its tables.
const CONSTRAINT_INPUT = obj({id: ID, kind: en(C.KINDS), allergen: str(60), strict: BOOL, ingredient_id: ID, flag: str(60), tag: str(40),
  diet: str(60), nutrient: str(60), max: NUM, effective_from: nul(DATE), expires_on: nul(DATE), note: str(500)},
  ['id', 'allergen', 'strict', 'ingredient_id', 'flag', 'tag', 'diet', 'nutrient', 'max', 'effective_from', 'expires_on']);
const GUEST_CONSTRAINT_INPUT = obj({kind: en(C.KINDS), allergen: str(60), strict: BOOL, ingredient_id: ID, flag: str(60), tag: str(40),
  diet: str(60), nutrient: str(60), max: NUM, note: str(500)}, ['allergen', 'strict', 'ingredient_id', 'flag', 'tag', 'diet', 'nutrient', 'max', 'note']);
const GUEST_INPUT = obj({guest_id: ID, name: str(120), constraints: arr(GUEST_CONSTRAINT_INPUT, {maxItems: 20})}, ['constraints']);
const LINE_INPUT = obj({ingredient_id: ID, quantity: NUM, unit: UNIT, optional: BOOL, note: str(200)}, ['optional', 'note']);
const CONTENT_INPUT = {title: str(200), servings: NUM, lines: arr(LINE_INPUT, {minItems: 1, maxItems: 40}),
  method_tags: arr(en(C.METHODS), {minItems: 1, uniqueItems: true}), steps: arr(str(1000), {minItems: 1, maxItems: 40}),
  tags: arr(str(40), {uniqueItems: true, maxItems: 20}), active_minutes: nul(INT(0, 10000)), total_minutes: nul(INT(0, 10000))};
const DISH_INPUT = {anyOf: [obj({recipe_id: ID, servings: NUM}, ['servings']), obj({leftovers_of: SLOT, recipe_id: ID, portions: NUM}, ['recipe_id'])]};
const SWAP_INPUT = obj({ingredient_id: ID, line: INT(0), rule_id: ID, to_ingredient_id: ID, ratio: NUM}, ['line', 'rule_id', 'to_ingredient_id', 'ratio']);
const SHOP_ADD = {ingredient_id: ID, text: str(200), quantity: NUM, unit: UNIT};
// Tool inputs also take null where the matching read returns null, so a record read from the App can
// be sent back unchanged: null means "none", as the App stores it (no note; a line without an
// ingredient, a text, a quantity or a unit). Events keep the shapes above.
const orNull = (schema, keys) => ({...schema, properties: {...schema.properties, ...Object.fromEntries(keys.map(k => [k, nul(schema.properties[k])]))}});
const GUEST_TOOL_INPUT = {...GUEST_INPUT, properties: {...GUEST_INPUT.properties, constraints: arr(orNull(GUEST_CONSTRAINT_INPUT, ['note']), {maxItems: 20})}};
const CONTENT_TOOL_INPUT = {...CONTENT_INPUT, lines: arr(orNull(LINE_INPUT, ['note']), {minItems: 1, maxItems: 40})};
const SHOP_TOOL = Object.fromEntries(Object.entries(SHOP_ADD).map(([k, v]) => [k, nul(v)]));

// ---- Events ------------------------------------------------------------------------------------------
const BY = {by: ID};
const event = (name, payload, optional = []) => obj({event_id: ID, at: TS, operation: {const: 'platewright.' + name}, payload: obj(payload, [...optional, 'by'])});
const eventAlternatives = [
  event('member.updated', {member_id: ID, action: {const: 'set'}, constraint: CONSTRAINT_INPUT, ...BY}),
  event('member.updated', {member_id: ID, action: {const: 'remove'}, constraint_id: ID, note: str(500), ...BY}, ['note']),
  event('recipe.added', {recipe: obj({id: ID, ...CONTENT_INPUT}, ['tags', 'active_minutes', 'total_minutes']), ...BY}),
  event('plan.changed', {id: SLOT, action: {const: 'set'}, dishes: arr(DISH_INPUT, {minItems: 1, maxItems: 10}), attendees: arr(ID, {maxItems: 20}),
    guests: arr(GUEST_INPUT, {maxItems: 20}), note: str(500), ...BY}, ['attendees', 'guests', 'note']),
  event('plan.changed', {id: SLOT, action: {const: 'clear'}, ...BY}),
  event('guest.changed', {id: SLOT, action: {const: 'set'}, guest: GUEST_INPUT, ...BY}),
  event('guest.changed', {id: SLOT, action: {const: 'remove'}, guest_id: ID, ...BY}),
  event('pantry.changed', {items: arr(obj({ingredient_id: ID, quantity: NUM, unit: UNIT, use_by: nul(DATE)}, ['use_by']), {minItems: 1, maxItems: 100}),
    note: str(500), ...BY}, ['note']),
  event('shopping.changed', {action: {const: 'tick'}, line_id: ID, ...BY}),
  event('shopping.changed', {action: {const: 'add'}, ...SHOP_ADD, ...BY}, ['ingredient_id', 'text', 'quantity', 'unit'])
];
const events = {$schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Platewright incoming events',
  description: 'Core envelope (event_id, at with a UTC offset, operation, payload) for the six events. Generated by scripts/build-contracts.cjs.',
  anyOf: eventAlternatives};

// ---- Tools -------------------------------------------------------------------------------------------
const PAGE = {limit: INT(1, 100), offset: INT(0)};
const RECIPE_SUMMARY = obj({id: ID, title: str(200), state: en(['active', 'archived']), revision: INT(1), servings: NUM, method_tags: arr(en(C.METHODS)),
  tags: arr(str(40)), active_minutes: nul(INT(0)), total_minutes: nul(INT(0)), contains: arr(en(C.ALLERGENS)), may_contain: arr(en(C.ALLERGENS)),
  flags: arr(en(C.FLAGS)), allergens_only_in_optional_lines: arr(en(C.ALLERGENS)), variant_of: nul(ID)});
const SHOWN_LINE = obj({line: INT(0), ingredient_id: ID, name: str(120), optional: BOOL, note: nul(str(200)), quantity: NUM, unit: UNIT, exact: NUM,
  as_written: obj({quantity: NUM, unit: UNIT})});
const LINE_REF = obj({line: INT(0), ingredient_id: ID, unit: UNIT}, ['unit']);
const NUTRITION_VIEW = {nutrition: nul(ref('nutrition')), nutrition_exact: nul(ref('nutrition')), missing_for: arr(LINE_REF), optional_excluded: arr(LINE_REF)};
const VERDICT = en(['unsafe', 'may_contain', 'unsuitable', 'over_limit', 'disliked', 'ok_if_omitted', 'ok']);
// Every nested shape a task author relies on is typed, with additionalProperties: false.
const LINE_SEEN = obj({line: INT(0), ingredient_id: ID, optional: BOOL});
const FINDING = obj({verdict: VERDICT, reason: en(['contains_allergen', 'may_contain_allergen', 'medical_ingredient', 'medical_flag', 'diet_flag', 'over_limit', 'disliked_ingredient', 'disliked_tag']),
  constraint_id: nul(ID), kind: en(C.KINDS), lines: arr(LINE_SEEN),
  allergen: en(C.ALLERGENS), strict: BOOL, ingredient_id: ID, flag: en(C.FLAGS), diet: en(Object.keys(C.DIETS)), flags: arr(en(C.FLAGS)), tag: str(40),
  nutrient: en(C.NUTRIENTS), max: NUM, value: NUM, portion_factor: NUM},
['allergen', 'strict', 'ingredient_id', 'flag', 'diet', 'flags', 'tag', 'nutrient', 'max', 'value', 'portion_factor']);
const UNCHECKED = obj({constraint_id: nul(ID), nutrient: en(C.NUTRIENTS), reason: {const: 'nutrition_unknown'}});
const PERSON_VERDICT = obj({kind: en(['member', 'guest']), id: ID, name: str(120), verdict: VERDICT, findings: arr(FINDING), omit_lines: arr(LINE_SEEN), unchecked: arr(UNCHECKED)});
const CONSTRAINT = inline(ref('constraint'));
const MEMBER_VIEW = obj({person_id: ID, display_name: str(120), portion_factor: NUM, account_holder: BOOL,
  constraints: arr({...CONSTRAINT, properties: {...CONSTRAINT.properties, state: en(['scheduled', 'active', 'expired', 'ended'])}, required: [...CONSTRAINT.required, 'state']})});
const RULE_VIEW = obj({...inline(ref('rule')).properties, to_name: str(120), to_allergens: arr(en(C.ALLERGENS)), to_may_contain: arr(en(C.ALLERGENS)),
  to_flags: arr(en(C.FLAGS)), applicable: BOOL, reason: nul(str(300))});
const FLAG_KEYS = {dish: INT(0), recipe_id: ID, kind: en(['member', 'guest']), id: ID, name: str(120), verdict: VERDICT,
  dishes: arr(obj({dish: INT(0), recipe_id: ID, verdict: VERDICT, findings: arr(FINDING), omit_lines: arr(LINE_SEEN)})),
  base_recipe_id: ID, base_revision: INT(1), base_current_revision: INT(1), leftovers_of: SLOT, planned: NUM, available: NUM, age_days: INT(0), leftover_max_days: INT(0),
  constraint_id: nul(ID), nutrient: en(C.NUTRIENTS), missing_for: arr(LINE_REF)};
const FLAG = obj({type: en(['person', 'archived_recipe', 'stale_base', 'leftover_short', 'leftover_expired', 'limit_unchecked']), ...FLAG_KEYS}, Object.keys(FLAG_KEYS));
const SLOT_SEED = inline(ref('slot'));
const SLOT_VIEW = obj({id: SLOT, date: DATE, meal: en(C.MEALS), state: SLOT_SEED.properties.state, phase: en(['upcoming', 'past']),
  attendees: arr(ID), guests: arr(ref('guest')), note: nul(str(500)), default_servings: NUM,
  dishes: arr(obj({dish: INT(0), kind: en(['recipe', 'leftovers']), recipe_id: ID, title: str(200), servings: NUM, servings_source: en(['default', 'explicit']),
    leftovers_of: SLOT, portions: NUM}, ['servings', 'servings_source', 'leftovers_of', 'portions'])),
  leftovers: arr(obj({recipe_id: ID, portions_left: NUM, taken_by: arr(obj({slot_id: SLOT, portions: NUM})), unclaimed: NUM, usable_until: DATE})),
  cooked: SLOT_SEED.properties.cooked, flags: arr(FLAG), history: SLOT_SEED.properties.history, updated_at: TS});
const LINE_SEED = inline(ref('shopping_line')), LIST_SEED = inline(ref('shopping'));
const LINE_VIEW = {...LINE_SEED, properties: {...LINE_SEED.properties, name: nul(str(200))}, required: [...LINE_SEED.required, 'name']};
const SHOPPING_VIEW = nul({...LIST_SEED, properties: {...LIST_SEED.properties, stale: BOOL, lines: arr(LINE_VIEW)}, required: [...LIST_SEED.required, 'stale']});
const PANTRY_VIEW = obj({ingredient_id: ID, name: str(120), quantity: POS, unit: UNIT, use_by: nul(DATE), state: en(['in_stock', 'out']),
  freshness: en(['fresh', 'use_soon', 'expired', 'no_date']), days_left: nul({type: 'integer'}), updated_at: TS, history: inline(ref('pantry_item')).properties.history});

const T = [];
function tool(name, description, input, output, {read = false, optional = [], target = 'current household'} = {}) {
  const inputSchema = obj(read ? input : {...input, expected_version: VERSION, request_id: ID}, optional);
  const outputSchema = obj({status: {const: read ? 'ok' : 'committed'}, app_id: {const: app.app_id}, version: VERSION, ...output});
  T.push({name: 'platewright.' + name, description, read_only: read, scope: 'platewright.' + name, resource_target: target,
    inputSchema: inline(inputSchema), outputSchema: inline(outputSchema)});
}
const PAGE_OUT = {total: INT(0), offset: INT(0), next_offset: nul(INT(0))};

// Reads (11)
tool('household.get', 'Read the household settings and each member (or one member, by id) with their constraints and each constraint\'s state on a date (default today, in the household time zone).',
  {id: ID, date: DATE}, {household: ref('household'), today: DATE, date: DATE, account_holder: ID, members: arr(MEMBER_VIEW)}, {read: true, optional: ['id', 'date']});
tool('ingredients.search', 'Search the ingredient table by name or alias, allergen-free, diet, tag or content flag. Each row has allergens, may-contain, flags, units, density or weight per piece and nutrition per 100 g.',
  {query: str(200, 0), allergen_free: arr(str(60), {maxItems: 9}), diet: str(60), tag: str(40), flag: str(60), ...PAGE},
  {items: arr(ref('ingredient')), ...PAGE_OUT}, {read: true, optional: ['query', 'allergen_free', 'diet', 'tag', 'flag', 'limit', 'offset']});
tool('recipes.search', 'Search recipes by text, ingredient, tags, total time, allergen-free (strict: also leaves out may-contain) and diet; archived recipes only when include_archived is true. Filters look at every line, optional ones included.',
  {query: str(200, 0), ingredient_id: ID, tags: arr(str(40), {maxItems: 10}), max_total_minutes: INT(0), allergen_free: arr(str(60), {maxItems: 9}), strict: BOOL,
    diet: arr(str(60), {maxItems: 7}), include_archived: BOOL, ...PAGE},
  {items: arr(RECIPE_SUMMARY), ...PAGE_OUT}, {read: true, optional: ['query', 'ingredient_id', 'tags', 'max_total_minutes', 'allergen_free', 'strict', 'diet', 'include_archived', 'limit', 'offset']});
tool('recipes.get', 'Read a recipe (or an earlier revision) at any number of servings (1 to 200) and in a unit system (recipe = as written, metric, us); `units` asks for one ingredient in a given unit. Each shown quantity carries its exact value. Includes per-serving nutrition, revisions and, for a variant, its base and whether the base has moved on.',
  {id: ID, servings: NUM, unit_system: en(UNIT_SYSTEMS), units: {type: 'object', additionalProperties: UNIT}, revision: INT(1)},
  {recipe: obj({id: ID, title: str(200), state: en(['active', 'archived']), revision: INT(1), revision_shown: INT(1), base_servings: NUM, servings: NUM,
    unit_system: en(UNIT_SYSTEMS), lines: arr(SHOWN_LINE), method_tags: arr(en(C.METHODS)), steps: arr(str(1000)), tags: arr(str(40)),
    active_minutes: nul(INT(0)), total_minutes: nul(INT(0)), contains: arr(en(C.ALLERGENS)), may_contain: arr(en(C.ALLERGENS)), flags: arr(en(C.FLAGS)),
    allergens_only_in_optional_lines: arr(en(C.ALLERGENS)), ...NUTRITION_VIEW,
    revisions: arr(obj({revision: INT(1), at: TS, actor: ACTOR, by: nul(ID)})), history: inline(ref('recipe')).properties.history,
    variant: nul(obj({...inline(ref('variant')).properties, base_title: str(200), base_current_revision: INT(1), stale_base: BOOL})), origin: ref('origin')})},
  {read: true, optional: ['servings', 'unit_system', 'units', 'revision']});
tool('recipes.check', 'Check a recipe for members (default: all) and guests on the date of the meal (default today): one verdict per person (unsafe, may_contain, unsuitable, over_limit, disliked, ok_if_omitted or ok) with the lines behind it. Constraints apply as they stand on that date. Not medical advice.',
  {id: ID, date: DATE, members: arr(ID, {uniqueItems: true, maxItems: 20}), guests: arr(GUEST_TOOL_INPUT, {maxItems: 20}), revision: INT(1)},
  {recipe_id: ID, revision: INT(1), date: DATE, ...NUTRITION_VIEW, verdicts: arr(PERSON_VERDICT)}, {read: true, optional: ['date', 'members', 'guests', 'revision']});
tool('substitutions.list', 'List the substitution rules for an ingredient (ingredient_id) or for each line of a recipe (id), with whether each rule applies to the recipe\'s method tags and why not.',
  {id: ID, ingredient_id: ID}, {recipe_id: nul(ID), ingredient_id: nul(ID), rules: arr(RULE_VIEW), lines: arr(obj({line: INT(0), ingredient_id: ID, name: str(120), rules: arr(RULE_VIEW)}))},
  {read: true, optional: ['id', 'ingredient_id']});
tool('recipes.variant.preview', 'Preview a recipe with swaps (by rule_id, or a custom to_ingredient_id with a ratio from 0.01 to 100; each swapped quantity must stay between 0.001 and 1,000,000): returns exactly the content recipes.variant.create would save, its nutrition, and the check before and after the swaps. Writes nothing.',
  {id: ID, swaps: arr(SWAP_INPUT, {minItems: 1, maxItems: 20}), title: str(200), date: DATE, members: arr(ID, {uniqueItems: true, maxItems: 20}), guests: arr(GUEST_TOOL_INPUT, {maxItems: 20})},
  {base_recipe_id: ID, base_revision: INT(1), title: str(200), unverified: BOOL, swaps: arr(ref('swap')), content: ref('content'), lines: arr(SHOWN_LINE),
    ...NUTRITION_VIEW, date: DATE, base_check: arr(PERSON_VERDICT), check: arr(PERSON_VERDICT),
    changes: arr(obj({kind: en(['member', 'guest']), id: ID, from: VERDICT, to: VERDICT}))},
  {read: true, optional: ['title', 'date', 'members', 'guests']});
tool('plan.get', 'Read the meal plan for a window (start/end dates, default the current week, at most 42 days): each slot with its state, phase (upcoming/past), dishes and servings, attendees, guests, leftovers, history and flags (person verdicts, archived_recipe, stale_base, leftover_short, leftover_expired).',
  {start: DATE, end: DATE}, {start: DATE, end: DATE, today: DATE, slots: arr(SLOT_VIEW)}, {read: true, optional: ['start', 'end']});
tool('pantry.list', 'Read the pantry with each item\'s freshness (fresh, use_soon, expired, no_date) and days left on today\'s date; used-up items only with include_out.',
  {freshness: en(['fresh', 'use_soon', 'expired', 'no_date']), include_out: BOOL}, {today: DATE, use_soon_days: INT(0), items: arr(PANTRY_VIEW)}, {read: true, optional: ['freshness', 'include_out']});
tool('shopping.get', 'Read the current shopping list (or null): derived lines with the slots they are for, manual lines, ticks, exclusions, surplus lines, optional lines, stock expiring before use, and whether the list is stale.',
  {}, {list: SHOPPING_VIEW}, {read: true});
tool('notifications.list', 'List notifications (what other household members did), optionally by date window and kind.',
  {start: DATE, end: DATE, kind: en(C.EVENT_KINDS)}, {notifications: arr(ref('notification'))}, {read: true, optional: ['start', 'end', 'kind']});

// Writes (11)
tool('recipes.create', 'Save a new recipe at revision 1 (servings 1 to 200; every quantity between 0.001 and 1,000,000 and in a unit its ingredient is measured in).',
  CONTENT_TOOL_INPUT, {id: ID, state: en(['active']), revision: INT(1)}, {optional: ['tags', 'active_minutes', 'total_minutes']});
tool('recipes.update', 'Edit a recipe through patch, which adds a revision; patch.archived archives (true) or restores (false) it without a new revision. Servings and quantities follow recipes.create. An archived recipe can only be restored; a variant can only be archived or restored.',
  {id: ID, patch: obj({...CONTENT_TOOL_INPUT, archived: BOOL}, [...Object.keys(CONTENT_TOOL_INPUT), 'archived'])},
  {id: ID, state: en(['active', 'archived']), revision: INT(1), new_revision: BOOL});
tool('recipes.variant.create', 'Save a recipe with swaps as a new variant recipe that records its base, the base revision and the swaps; a custom swap marks it unverified. Saves exactly what recipes.variant.preview shows, with the same ratio and quantity bounds.',
  {id: ID, swaps: arr(SWAP_INPUT, {minItems: 1, maxItems: 20}), title: str(200)},
  {id: ID, state: en(['active']), revision: INT(1), base_recipe_id: ID, base_revision: INT(1), unverified: BOOL}, {optional: ['title']});
tool('members.constraint.set', 'Add a constraint to a member (id = the member\'s person_id), or replace one by constraint.id; it is kept with its dates, its note and a history row. Omitted dates default to today and no expiry for a new constraint and are kept on a replacement.',
  {id: ID, constraint: orNull(CONSTRAINT_INPUT, ['note'])}, {id: ID, member_id: ID, state: en(['scheduled', 'active', 'expired', 'ended']), action: en(['created', 'replaced'])});
tool('members.constraint.remove', 'End a member\'s scheduled or active constraint from now (id = the member\'s person_id); its history is kept.',
  {id: ID, constraint_id: ID, note: str(500)}, {id: ID, member_id: ID, state: {const: 'ended'}, ended_at: TS}, {optional: ['note']});
tool('plan.slot.set', 'Set a slot (id = date:meal) with dishes (a recipe at servings, default from the attendees\' portion factors plus one per guest, or portions of leftovers, at most 200, from an earlier slot), attendees (default all members) and guests with their constraints; it replaces the slot. No dishes clears it. A dish that is wrong for someone is planned and flagged, not refused.',
  {id: SLOT, dishes: arr(DISH_INPUT, {maxItems: 10}), attendees: arr(ID, {maxItems: 20}), guests: arr(GUEST_TOOL_INPUT, {maxItems: 20}), note: nul(str(500))},
  {id: SLOT, state: en(['planned', 'cleared']), default_servings: NUM, flags: arr(FLAG)}, {optional: ['attendees', 'guests', 'note'], target: 'current household plan'});
tool('plan.slot.mark', 'Mark a planned slot cooked (not before its date; records portions made (at most 200) and eaten per recipe, default its servings and its attendees\' portions; deduct_pantry takes the exact quantities from the pantry, never below zero, and returns what was short) or skipped.',
  {id: SLOT, status: en(['cooked', 'skipped']), portions: arr(obj({recipe_id: ID, made: NUM, eaten: NUM}, ['made', 'eaten']), {maxItems: 10}), deduct_pantry: BOOL},
  {id: SLOT, state: en(['cooked', 'skipped']), portions: arr(obj({recipe_id: ID, revision: INT(1), made: NUM, eaten: NUM})), deducted: BOOL,
    short: SLOT_SEED.properties.cooked.anyOf[0].properties.short}, {optional: ['portions', 'deduct_pantry'], target: 'current household plan'});
tool('pantry.set', 'Set the pantry quantity of an ingredient (id = ingredient_id) in a unit it is measured in, and optionally its use-by date (null: none). Quantity 0 marks it used up; at most 1,000,000.',
  {id: ID, quantity: NUM, unit: UNIT, use_by: nul(DATE)},
  {id: ID, state: en(['in_stock', 'out']), quantity: POS, unit: UNIT, use_by: nul(DATE), freshness: en(['fresh', 'use_soon', 'expired', 'no_date']), days_left: nul({type: 'integer'})},
  {optional: ['use_by']});
tool('shopping.generate', 'Generate (or regenerate) the shopping list for a window of at most 28 days from the planned slots and the pantry. Manual lines, ticks and exclusions survive; derived lines no longer needed are dropped, or kept as surplus when ticked.',
  {start: DATE, end: DATE}, {id: ID, state: {const: 'current'}, start: DATE, end: DATE, generation: INT(1), line_count: INT(0),
    added: arr(ID), kept: arr(ID), dropped: arr(ID), surplus: arr(ID)});
tool('shopping.item.set', 'Without id: add a manual line (ingredient_id or text, quantity up to 1,000,000, unit). With id: change a manual line, tick or untick a line, or exclude a derived line with a reason (or include it again).',
  {id: ID, ...SHOP_TOOL, ticked: BOOL, excluded: BOOL, reason: str(300)}, {id: ID, state: en(['needed', 'ticked', 'excluded']), kind: en(['derived', 'manual'])},
  {optional: ['id', 'ingredient_id', 'text', 'quantity', 'unit', 'ticked', 'excluded', 'reason']});
tool('shopping.item.remove', 'Remove a manual line; a derived line is excluded instead (derived_line).',
  {id: ID}, {id: ID, state: {const: 'removed'}, kind: {const: 'manual'}});

function outputs() {
  return {
    'tools.json': T,
    'schemas/seed.schema.json': SEED_PUBLISHED,
    'schemas/events.schema.json': events
  };
}
function build({check = false} = {}) {
  const drift = [];
  for (const [file, value] of Object.entries(outputs())) {
    const text = JSON.stringify(value, null, 2) + '\n', target = path.join(root, file);
    if (check) { if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) drift.push(file); }
    else fs.writeFileSync(target, text);
  }
  return drift;
}
module.exports = {build};
if (require.main === module) {
  const drift = build({check: process.argv.includes('--check')});
  if (drift.length) { console.error('Generated contract drift: ' + drift.join(', ')); process.exitCode = 1; }
  else console.log(process.argv.includes('--check') ? 'Generated contracts match.' : 'Contracts written.');
}
