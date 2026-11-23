'use strict';
const {fail, references: ownerReferences} = require('./domain-utils.cjs');
const {validZone} = require('./time.cjs');
const {METRICS} = require('./catalog.cjs');

const unique = (list, key, what) => {
  const seen = new Set();
  for (const item of list) {
    if (seen.has(item[key])) fail('invalid_seed', 'Duplicate ' + what + ' ID ' + item[key] + '.');
    seen.add(item[key]);
  }
  return seen;
};
const notAfter = (value, now, what) => {
  if (Date.parse(value) > Date.parse(now)) fail('invalid_seed', what + ' is dated after the current virtual time.');
};

// Rule consistency shared by seed validation and the rule write tools.
function validateRule(data, r) {
  if (!data.saved_places.some(s => s.saved_place_id === r.saved_place_id)) fail('saved_place_not_found', 'Saved place does not exist.');
  if (r.kind === 'official_alert') {
    if (r.metric !== null || r.threshold !== null || r.comparator !== null) fail('invalid_rule', 'Alert rules take events and a minimum severity, not a metric.');
  } else {
    const m = METRICS[r.metric];
    if (!m || !m.kinds.includes(r.kind)) fail('invalid_rule', 'Metric does not fit the rule kind.');
    if (r.comparator === null || typeof r.threshold !== 'number' || r.threshold < m.min || r.threshold > m.max) fail('invalid_rule', 'Threshold is missing or out of range.');
    if (r.kind === 'forecast_threshold' && r.look_ahead_hours === null) fail('invalid_rule', 'Forecast rules need look_ahead_hours.');
    if (r.alert_events.length || r.min_severity !== null) fail('invalid_rule', 'Only alert rules take events or a minimum severity.');
  }
  if (r.window && r.window.type === 'absolute' && Date.parse(r.window.from) >= Date.parse(r.window.to)) fail('invalid_rule', 'Window must end after it starts.');
}

// Called by Core at load, after each write and during each event (with ctx.virtual_now set to the event time).
function validateSeed(ctx, data) {
  ownerReferences(ctx, data);
  const now = ctx.virtual_now;
  if (!validZone(data.settings.time_zone)) fail('invalid_seed', 'Unknown account time zone.');
  const zones = unique(data.zones, 'zone_id', 'zone'), areas = unique(data.air_areas, 'air_area_id', 'air area');
  const stations = unique(data.stations, 'station_id', 'station'), monitors = unique(data.monitors, 'monitor_id', 'monitor');
  const places = unique(data.places, 'place_id', 'place');
  for (const z of data.zones) if (!validZone(z.time_zone)) fail('invalid_seed', 'Unknown zone time zone.');
  for (const s of data.stations) if (!zones.has(s.zone_id)) fail('invalid_seed', 'Station refers to an unknown zone.');
  for (const m of data.monitors) if (!areas.has(m.air_area_id)) fail('invalid_seed', 'Monitor refers to an unknown air area.');
  for (const p of data.places) {
    if (!validZone(p.time_zone) || !zones.has(p.zone_id) || (p.air_area_id && !areas.has(p.air_area_id)) ||
        (p.station_id && !stations.has(p.station_id)) || (p.monitor_id && !monitors.has(p.monitor_id))) {
      fail('invalid_seed', 'Place ' + p.place_id + ' refers to an unknown zone, area, station, monitor or time zone.');
    }
    if (p.external_ref) {
      const r = p.external_ref;
      // Checked like Mail's event_ref: the account and object must appear in the run binding.
      if (!ctx.binding.accounts.some(a => a.app_id === r.app_id && a.account_id === r.account_id) ||
          !ctx.binding.objects[r.app_id]?.includes(r.object_id)) fail('invalid_seed', 'Cross-App reference is not in the task binding.');
    }
  }
  unique(data.saved_places, 'saved_place_id', 'saved place');
  for (const s of data.saved_places) {
    if (!places.has(s.place_id)) fail('invalid_seed', 'Saved place refers to an unknown place.');
    notAfter(s.created_at, now, 'Saved place');
  }
  if (data.settings.default_saved_place_id && !data.saved_places.some(s => s.saved_place_id === data.settings.default_saved_place_id)) {
    fail('invalid_seed', 'Default saved place does not exist.');
  }
  unique(data.issuances, 'issuance_id', 'issuance');
  for (const i of data.issuances) {
    if (!zones.has(i.zone_id)) fail('invalid_seed', 'Issuance refers to an unknown zone.');
    if (Date.parse(i.valid_from) >= Date.parse(i.valid_to)) fail('invalid_seed', 'Issuance validity window is empty.');
    notAfter(i.issued_at, now, 'Issuance ' + i.issuance_id);
  }
  unique(data.air_issuances, 'issuance_id', 'air issuance');
  for (const i of data.air_issuances) {
    if (!areas.has(i.air_area_id)) fail('invalid_seed', 'Air issuance refers to an unknown area.');
    notAfter(i.issued_at, now, 'Air issuance ' + i.issuance_id);
  }
  unique(data.observations, 'observation_id', 'observation');
  for (const o of data.observations) {
    if (!stations.has(o.station_id)) fail('invalid_seed', 'Observation refers to an unknown station.');
    notAfter(o.observed_at, now, 'Observation ' + o.observation_id);
  }
  unique(data.air_observations, 'observation_id', 'air observation');
  for (const o of data.air_observations) {
    if (!monitors.has(o.monitor_id)) fail('invalid_seed', 'Air observation refers to an unknown monitor.');
    notAfter(o.observed_at, now, 'Air observation ' + o.observation_id);
  }
  unique(data.alerts, 'alert_id', 'alert');
  for (const a of data.alerts) {
    a.versions.forEach((v, i) => {
      if (v.version !== i + 1) fail('invalid_seed', 'Alert versions must run 1, 2, 3, …');
      if ((i === 0) !== (v.msg_type === 'alert')) fail('invalid_seed', 'Only the first version of an alert is msg_type alert.');
      if (i > 0 && a.versions[i - 1].msg_type === 'cancel') fail('invalid_seed', 'A cancelled alert cannot be updated.');
      notAfter(v.issued_at, now, 'Alert version');
    });
  }
  unique(data.rules, 'rule_id', 'rule');
  for (const r of data.rules) { validateRule(data, r); notAfter(r.created_at, now, 'Rule'); }
  unique(data.notifications, 'notification_id', 'notification');
  for (const n of data.notifications) {
    notAfter(n.created_at, now, 'Notification');
    if (n.recipient_person_id !== data.owner_person_id) fail('invalid_seed', 'Notifications go to the account owner.');
  }
}

module.exports = {
  validateSeed, validateRule,
  // Business records the account owns or the task loaded, and their IDs (the same set, as Core expects).
  records: data => [...data.places, ...data.saved_places, ...data.rules, ...data.notifications, ...data.alerts],
  objects: data => [...data.places.map(p => p.place_id), ...data.saved_places.map(s => s.saved_place_id),
    ...data.rules.map(r => r.rule_id), ...data.notifications.map(n => n.notification_id), ...data.alerts.map(a => a.alert_id)],
  references: data => data.places.filter(p => p.external_ref).map(p => p.external_ref)
};
