'use strict';
// App-owned generator: one definition source for the seed schema, event schema and tools.json.
// Run `node scripts/build-contracts.cjs` after editing; `--check` fails on drift (used by the tests).
const fs = require('node:fs'), path = require('node:path');
const {PROVIDERS, ALERT_EVENTS, SEVERITIES, METRICS, LIMITS} = require('../src/catalog.cjs');
const {CATEGORIES} = require('../src/aqi.cjs');
const root = path.resolve(__dirname, '..');
const SEED = 'schemas/seed.schema.json#/$defs/';

const id = {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
const time = {type: 'string', format: 'date-time'};
const date = {type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$'};
const hhmm = {type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$'};
const text = (max, min = 1) => ({type: 'string', minLength: min, maxLength: max});
const num = (minimum, maximum) => ({type: 'number', minimum, maximum});
const int = (minimum, maximum) => ({type: 'integer', minimum, maximum});
const nullable = s => ({anyOf: [s, {type: 'null'}]});
const arr = (items, maxItems = 1000, extra = {}) => ({type: 'array', items, maxItems, ...extra});
const obj = (properties, required = Object.keys(properties), additional = false) =>
  ({type: 'object', properties, required, additionalProperties: additional});
const ref = name => ({$ref: SEED + name});
const localRef = name => ({$ref: 'seed.schema.json#/$defs/' + name}); // file-relative: Core inlines the seed schema
const enumOf = values => ({enum: values});

const hourlyFields = {temp_c: num(-90, 70), feels_like_c: num(-100, 80), dew_point_c: num(-90, 50),
  precip_prob_pct: int(0, 100), precip_mm: num(0, 1000), thunder_prob_pct: int(0, 100),
  wind_kph: num(0, 500), gust_kph: num(0, 500), wind_dir_deg: int(0, 360), cloud_pct: int(0, 100),
  visibility_km: num(0, 200), uv_index: num(0, 20), humidity_pct: int(0, 100)};
const observedFields = {temp_c: hourlyFields.temp_c, feels_like_c: hourlyFields.feels_like_c,
  dew_point_c: hourlyFields.dew_point_c, precip_mm: hourlyFields.precip_mm, wind_kph: hourlyFields.wind_kph,
  gust_kph: hourlyFields.gust_kph, wind_dir_deg: hourlyFields.wind_dir_deg, visibility_km: hourlyFields.visibility_km,
  humidity_pct: hourlyFields.humidity_pct};
const window = {anyOf: [
  obj({type: {const: 'recurring'}, days: arr(int(1, 7), 7, {minItems: 1, uniqueItems: true}), start: hhmm, end: hhmm}),
  obj({type: {const: 'absolute'}, from: time, to: time}),
  {type: 'null'}]};
const quiet = nullable(obj({start: hhmm, end: hhmm}));
const metric = enumOf(Object.keys(METRICS));

// Definitions shared by the seed, events and tool outputs (all local refs resolve inside seed.schema.json).
const defs = {
  id, time, date,
  external_ref: obj({app_id: id, account_id: id, object_id: id}),
  settings: obj({units: enumOf(['metric', 'us']), time_zone: text(64), default_saved_place_id: nullable(id)}),
  zone: obj({zone_id: id, name: text(120), time_zone: text(64)}),
  air_area: obj({air_area_id: id, name: text(120)}),
  station: obj({station_id: id, name: text(120), zone_id: id}),
  monitor: obj({monitor_id: id, name: text(120), air_area_id: id}),
  place: obj({place_id: id, name: text(120), kind: enumOf(['city', 'park', 'campground', 'venue', 'airport', 'address']),
    latitude: num(-90, 90), longitude: num(-180, 180), elevation_m: num(-500, 9000), time_zone: text(64), zone_id: id,
    air_area_id: nullable(id), station_id: nullable(id), monitor_id: nullable(id), external_ref: nullable(localRef('external_ref'))},
    ['place_id', 'name', 'kind', 'latitude', 'longitude', 'elevation_m', 'time_zone', 'zone_id', 'air_area_id', 'station_id', 'monitor_id']),
  saved_place: obj({saved_place_id: id, place_id: id, label: text(80), created_at: time}),
  hourly: obj({start: time, ...hourlyFields}, ['start']),
  daily: obj({date, high_c: hourlyFields.temp_c, low_c: hourlyFields.temp_c, precip_prob_pct: int(0, 100),
    headline: text(200), day_text: text(2000), night_text: text(2000)}, ['date']),
  product: obj({kind: enumOf(['outlook', 'discussion']), text: text(5000)}),
  issuance: obj({issuance_id: id, provider: enumOf(Object.keys(PROVIDERS)), zone_id: id, issued_at: time,
    valid_from: time, valid_to: time, hourly: arr(localRef('hourly'), 168), daily: arr(localRef('daily'), 7),
    products: arr(localRef('product'), 10)}, ['issuance_id', 'provider', 'zone_id', 'issued_at', 'valid_from', 'valid_to', 'hourly', 'daily']),
  air_day: obj({date, aqi_category: enumOf(CATEGORIES), aqi: int(0, 500), dominant_pollutant: enumOf(['pm25', 'pm10', 'o3'])}, ['date', 'aqi_category']),
  air_issuance: obj({issuance_id: id, air_area_id: id, issued_at: time, days: arr(localRef('air_day'), 7, {minItems: 1}),
    narrative: text(2000)}, ['issuance_id', 'air_area_id', 'issued_at', 'days']),
  observation_revision: obj({observation_id: id, values: obj(observedFields, [])}),
  observation: obj({observation_id: id, station_id: id, observed_at: time, ...observedFields, corrected: {type: 'boolean'},
    revisions: arr(localRef('observation_revision'), 50)}, ['observation_id', 'station_id', 'observed_at', 'corrected', 'revisions']),
  air_observation: obj({observation_id: id, monitor_id: id, observed_at: time, pm25_ugm3: num(0, 2000),
    pm10_ugm3: num(0, 5000), o3_ppb: num(0, 1000)}, ['observation_id', 'monitor_id', 'observed_at']),
  alert_version: obj({version: int(1, 1000), msg_type: enumOf(['alert', 'update', 'cancel']), issued_at: time,
    issuer: text(120), event: enumOf(ALERT_EVENTS), severity: enumOf(SEVERITIES),
    urgency: enumOf(['immediate', 'expected', 'future', 'past', 'unknown']),
    certainty: enumOf(['observed', 'likely', 'possible', 'unlikely', 'unknown']),
    areas: obj({zone_ids: arr(id, 50), air_area_ids: arr(id, 50), place_ids: arr(id, 50)}, []),
    onset: time, expires: time, headline: text(300), description: text(5000), instruction: text(2000),
    references: arr(obj({alert_id: id, version: int(1, 1000)}), 50)},
    ['version', 'msg_type', 'issued_at', 'issuer', 'event', 'severity', 'urgency', 'certainty', 'areas', 'onset', 'expires', 'headline']),
  alert: obj({alert_id: id, versions: arr(localRef('alert_version'), 1000, {minItems: 1})}),
  rule_window: window,
  rule: obj({rule_id: id, saved_place_id: id, kind: enumOf(['forecast_threshold', 'observation_threshold', 'official_alert']),
    metric: nullable(metric), comparator: nullable(enumOf(['gte', 'lte'])), threshold: nullable(num(-1000, 1000)),
    provider: enumOf(Object.keys(PROVIDERS)), look_ahead_hours: nullable(int(1, LIMITS.look_ahead_max)),
    window: localRef('rule_window'), alert_events: arr(enumOf(ALERT_EVENTS), ALERT_EVENTS.length, {uniqueItems: true}),
    min_severity: nullable(enumOf(SEVERITIES)), notify_on_clear: {type: 'boolean'}, delivery: enumOf(['mail', 'in_app']),
    quiet_hours: quiet, severe_override: {type: 'boolean'}, status: enumOf(['active', 'paused']),
    created_at: time, revision: int(1, 100000),
    history: arr(obj({revision: int(1, 100000), at: time, action: text(40), changes: {type: 'object'}}), 1000)}),
  notification: obj({notification_id: id, rule_id: id, trigger_key: text(300),
    phase: enumOf(['met', 'cleared', 'alert', 'update', 'cancel']),
    source: obj({kind: enumOf(['issuance', 'observation', 'air_observation', 'air_issuance', 'alert']), id, version: nullable(int(1, 1000))}),
    created_at: time, release_at: nullable(time), delivery: enumOf(['mail', 'in_app']),
    status: enumOf(['in_app', 'held_quiet_hours', 'pending_delivery', 'delivered', 'delivery_failed', 'withdrawn']),
    title: text(200), body: text(2000), time, recipient_person_id: id,
    outcome: nullable(obj({status: enumOf(['committed', 'rejected', 'unknown', 'halted']), code: nullable(text(80)),
      stop_run: {type: 'boolean'}, router_event_id: nullable(text(120)), recorded_at: time})),
    acknowledged_at: nullable(time)})
};

const seed = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:pale:gustline:seed:1',
  title: 'Gustline account and world data', ...obj({
    account_id: id, owner_person_id: id, settings: localRef('settings'),
    zones: arr(localRef('zone'), 200), air_areas: arr(localRef('air_area'), 200),
    stations: arr(localRef('station'), 200), monitors: arr(localRef('monitor'), 200), places: arr(localRef('place'), 500),
    saved_places: arr(localRef('saved_place'), LIMITS.saved_places), issuances: arr(localRef('issuance'), 2000),
    air_issuances: arr(localRef('air_issuance'), 2000), observations: arr(localRef('observation'), 20000),
    air_observations: arr(localRef('air_observation'), 20000), alerts: arr(localRef('alert'), 1000),
    rules: arr(localRef('rule'), LIMITS.rules), notifications: arr(localRef('notification'), 20000)}),
  $defs: defs
};

const envelope = (operation, payload) => obj({event_id: id, at: time, operation: {const: operation}, payload});
const events = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:pale:gustline:events:1',
  title: 'Infra-applied Gustline events (tasks choose content and timing)',
  anyOf: [
    envelope('weather.forecast_issued', {$ref: 'seed.schema.json#/$defs/issuance'}),
    envelope('weather.observation_recorded', obj({observation_id: id, station_id: id, observed_at: time,
      correction_of: id, ...observedFields}, ['observation_id', 'station_id', 'observed_at'])),
    envelope('air.observation_recorded', {$ref: 'seed.schema.json#/$defs/air_observation'}),
    envelope('air.forecast_issued', {$ref: 'seed.schema.json#/$defs/air_issuance'}),
    envelope('alert.published', obj({alert_id: id, ...defs.alert_version.properties}, ['alert_id', ...defs.alert_version.required])),
    envelope('notification.delivery_recorded', obj({notification_id: id, status: enumOf(['committed', 'rejected', 'unknown', 'halted']),
      code: nullable(text(80)), stop_run: {type: 'boolean'}, router_event_id: nullable(text(120))}, ['notification_id', 'status', 'code', 'router_event_id']))
  ]
};

// ---- tools ----
const version = obj({epoch: int(1), revision: int(0)});
const writeIn = (properties, required = []) => obj({...properties, expected_version: version, request_id: id}, [...required, 'expected_version', 'request_id']);
const readOut = properties => obj({status: {const: 'ok'}, app_id: {const: 'gustline'}, version, ...properties});
const writeOut = properties => obj({status: {const: 'committed'}, app_id: {const: 'gustline'}, version, ...properties});
const loose = (properties, required) => obj(properties, required, true);
const asOf = {as_of: time};
const ruleInput = {saved_place_id: id, kind: defs.rule.properties.kind, metric, comparator: enumOf(['gte', 'lte']),
  threshold: num(-1000, 1000), provider: enumOf(Object.keys(PROVIDERS)), look_ahead_hours: int(1, LIMITS.look_ahead_max),
  window, alert_events: defs.rule.properties.alert_events, min_severity: enumOf(SEVERITIES),
  notify_on_clear: {type: 'boolean'}, delivery: enumOf(['mail', 'in_app']), quiet_hours: quiet, severe_override: {type: 'boolean'}};
const placeView = loose({place_id: id, name: text(120), time_zone: text(64)}, ['place_id', 'name', 'time_zone']);
const tool = (name, description, read_only, inputSchema, outputSchema) =>
  ({name: 'gustline.' + name, description, read_only, scope: 'gustline.' + name, resource_target: 'current account', inputSchema, outputSchema});

const tools = [
  tool('places.search', 'Search the seeded gazetteer by name. No geocoding service.', true,
    obj({query: text(120, 0)}, []), readOut({places: arr(ref('place'), 500)})),
  tool('places.get', 'Get one place with its forecast zone, air area, station and monitor.', true,
    obj({place_id: id}), readOut({place: ref('place')})),
  tool('saved_places.list', 'List the account\'s saved places and their labels.', true,
    obj({}, []), readOut({saved_places: arr(loose({saved_place_id: id, place_id: id, label: text(80)}, ['saved_place_id', 'place_id', 'label']), LIMITS.saved_places)})),
  tool('settings.get', 'Read units, the person\'s own time zone and the default saved place.', true,
    obj({}, []), readOut({settings: ref('settings')})),
  tool('forecast.get', 'Forecast periods for a place from the issuance current at the run\'s virtual time, rendered in the place\'s local time.', true,
    obj({place_id: id, from: time, to: time, granularity: enumOf(['hourly', 'daily']), provider: enumOf(Object.keys(PROVIDERS))}, ['place_id', 'from', 'to', 'granularity']),
    readOut({place: placeView, provider: enumOf(Object.keys(PROVIDERS)), issuance_id: id, issued_at: time, ...asOf, units: enumOf(['metric', 'us']),
      granularity: enumOf(['hourly', 'daily']), periods: arr({type: 'object'}, 168), products: arr(ref('product'), 10),
      not_provided: arr(text(40), 20), other_providers_available: arr(enumOf(Object.keys(PROVIDERS)), 5)})),
  tool('forecast.history', 'List weather or air-quality issuances for a place, newest first, with their supersession status.', true,
    obj({place_id: id, kind: enumOf(['weather', 'air']), provider: enumOf(Object.keys(PROVIDERS))}, ['place_id', 'kind']),
    readOut({place: placeView, ...asOf, issuances: arr(loose({issuance_id: id, issued_at: time, status: enumOf(['current', 'superseded'])}, ['issuance_id', 'issued_at', 'status']), 2000)})),
  tool('observations.get', 'Observations from the place\'s station between two times, with corrections and earlier values.', true,
    obj({place_id: id, from: time, to: time}), readOut({place: placeView, station_id: id, ...asOf, units: enumOf(['metric', 'us']), observations: arr({type: 'object'}, 2000)})),
  tool('astro.get', 'Sunrise, sunset and civil twilight for a place and local date (NOAA solar algorithm).', true,
    obj({place_id: id, date}), readOut({place: placeView, date, civil_dawn: nullable(time), sunrise: nullable(time), sunset: nullable(time), civil_dusk: nullable(time)})),
  tool('air.current', 'Current AQI at a place from its monitor: per-pollutant values, averaging basis, category and staleness.', true,
    obj({place_id: id}), readOut({place: placeView, monitor_id: id, ...asOf, observation_id: id, observed_at: time, aqi: nullable(int(0, 500)),
      category: nullable(enumOf(CATEGORIES)), dominant_pollutant: nullable(enumOf(['pm25', 'pm10', 'o3'])), pollutants: {type: 'object'},
      not_provided: arr(text(20), 5), aqi_table: text(40), stale: {type: 'boolean'}})),
  tool('air.forecast', 'Daily AQI category forecast for a place from the current air-quality issuance.', true,
    obj({place_id: id, from_date: date, to_date: date}), readOut({place: placeView, air_area_id: id, issuance_id: id, issued_at: time, ...asOf,
      days: arr(ref('air_day'), 7), narrative: nullable(text(2000))})),
  tool('alerts.list', 'Official alerts affecting a place, with status derived at the run\'s virtual time.', true,
    obj({place_id: id, status: enumOf(['upcoming', 'active', 'expired', 'cancelled'])}, ['place_id']),
    readOut({place: placeView, ...asOf, alerts: arr({type: 'object'}, 1000)})),
  tool('alerts.get', 'One alert with its full version chain, or one version.', true,
    obj({alert_id: id, version: int(1, 1000)}, ['alert_id']), readOut({...asOf, alert: {type: 'object'}})),
  tool('rules.list', 'List personal alert rules.', true, obj({}, []), readOut({rules: arr(ref('rule'), LIMITS.rules)})),
  tool('rules.get', 'One rule with its revision history.', true, obj({rule_id: id}), readOut({rule: ref('rule')})),
  tool('notifications.list', 'Notifications with their delivery status derived at the run\'s virtual time.', true,
    obj({status: defs.notification.properties.status}, []), readOut({...asOf, notifications: arr(ref('notification'), 20000)})),
  tool('saved_places.add', 'Save a place under the person\'s own label.', false,
    writeIn({place_id: id, label: text(80)}, ['place_id', 'label']), writeOut({saved_place_id: id})),
  tool('saved_places.rename', 'Change a saved place\'s label.', false,
    writeIn({saved_place_id: id, label: text(80)}, ['saved_place_id', 'label']), writeOut({saved_place_id: id})),
  tool('saved_places.remove', 'Remove a saved place that no rule refers to.', false,
    writeIn({saved_place_id: id}, ['saved_place_id']), writeOut({saved_place_id: id})),
  tool('settings.update', 'Change units, the person\'s time zone or the default saved place.', false,
    writeIn({units: enumOf(['metric', 'us']), time_zone: text(64), default_saved_place_id: nullable(id)}), writeOut({settings: ref('settings')})),
  tool('rules.create', 'Create a personal alert rule.', false,
    writeIn(ruleInput, ['saved_place_id', 'kind']), writeOut({rule_id: id, revision: int(1)})),
  tool('rules.update', 'Change fields of a rule; the rule keeps a revision history.', false,
    writeIn({rule_id: id, patch: obj(Object.fromEntries(Object.entries(ruleInput).filter(([k]) => k !== 'kind')), [])}, ['rule_id', 'patch']),
    writeOut({rule_id: id, revision: int(1)})),
  tool('rules.pause', 'Pause a rule; it is not evaluated while paused.', false, writeIn({rule_id: id}, ['rule_id']), writeOut({rule_id: id, revision: int(1)})),
  tool('rules.resume', 'Resume a paused rule from the next event, with no retroactive notification.', false,
    writeIn({rule_id: id}, ['rule_id']), writeOut({rule_id: id, revision: int(1)})),
  tool('rules.delete', 'Delete a rule. Its notifications are kept.', false, writeIn({rule_id: id}, ['rule_id']), writeOut({rule_id: id})),
  tool('notifications.acknowledge', 'Mark a notification as read.', false,
    writeIn({notification_id: id}, ['notification_id']), writeOut({notification_id: id, acknowledged_at: time}))
];

function build({check = false} = {}) {
  const outputs = {'schemas/seed.schema.json': seed, 'schemas/events.schema.json': events, 'tools.json': tools};
  for (const [file, value] of Object.entries(outputs)) {
    const expected = JSON.stringify(value, null, 2) + '\n', target = path.join(root, file);
    if (check) { if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== expected) throw new Error('Generated contract drift: ' + file); }
    else fs.writeFileSync(target, expected);
  }
  return {tools: tools.length};
}
module.exports = {build};
if (require.main === module) console.log(JSON.stringify(build({check: process.argv.includes('--check')})));
