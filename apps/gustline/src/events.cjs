'use strict';
// Infra-applied events. Tasks choose content and timing; Gustline defines each event's effect.
// Core exposes the event's `at` as ctx.virtual_now while this runs, and rejects backwards time.
const {fail, copy, log, effectiveStatus} = require('./common.cjs');
const {ms} = require('./time.cjs');
const {currentIssuance, currentAirIssuance} = require('./reads.cjs');
const rules = require('./rules.cjs');

const OBSERVED = ['temp_c', 'feels_like_c', 'dew_point_c', 'precip_mm', 'wind_kph', 'gust_kph', 'wind_dir_deg', 'visibility_km', 'humidity_pct'];
const notLater = (value, at, what) => { if (ms(value) > ms(at)) fail('invalid_event', what + ' is later than the event time.'); };
const exists = (list, key, value, what) => { if (!list.some(x => x[key] === value)) fail('invalid_event', 'Unknown ' + what + '.'); };

function forecastIssued(ctx, data, p) {
  notLater(p.issued_at, ctx.virtual_now, 'issued_at');
  exists(data.zones, 'zone_id', p.zone_id, 'forecast zone');
  if (data.issuances.some(i => i.issuance_id === p.issuance_id)) fail('invalid_event', 'Issuance ID already exists.');
  const current = currentIssuance(data, p.zone_id, p.provider, ctx.virtual_now);
  if (current && ms(p.issued_at) <= ms(current.issued_at)) fail('stale_issuance', 'An issuance at least as new is already current.');
  if (ms(p.valid_from) >= ms(p.valid_to)) fail('invalid_event', 'Issuance validity window is empty.');
  if (p.hourly.some(h => ms(h.start) < ms(p.valid_from) || ms(h.start) >= ms(p.valid_to))) fail('invalid_event', 'Hourly period outside the validity window.');
  data.issuances.push(copy(p));
  rules.forecastRules(ctx, data, p);
  return data;
}

function observationRecorded(ctx, data, p) {
  notLater(p.observed_at, ctx.virtual_now, 'observed_at');
  exists(data.stations, 'station_id', p.station_id, 'station');
  if (data.observations.some(o => o.observation_id === p.observation_id) ||
      data.observations.some(o => o.revisions.some(r => r.observation_id === p.observation_id))) fail('invalid_event', 'Observation ID already exists.');
  const values = Object.fromEntries(OBSERVED.filter(k => typeof p[k] === 'number').map(k => [k, p[k]]));
  let record;
  if (p.correction_of) {
    record = data.observations.find(o => o.observation_id === p.correction_of);
    if (!record) fail('observation_not_found', 'The corrected observation does not exist.');
    if (record.station_id !== p.station_id || ms(record.observed_at) !== ms(p.observed_at)) fail('invalid_event', 'A correction must keep the station and observation time.');
    const previous = Object.fromEntries(OBSERVED.filter(k => typeof record[k] === 'number').map(k => [k, record[k]]));
    record.revisions.push({observation_id: record.observation_id, values: previous});
    for (const k of OBSERVED) delete record[k];
    Object.assign(record, values, {observation_id: p.observation_id, corrected: true});
  } else {
    if (data.observations.some(o => o.station_id === p.station_id && ms(o.observed_at) === ms(p.observed_at))) {
      fail('invalid_event', 'An observation for this time exists; send a correction instead.');
    }
    record = {observation_id: p.observation_id, station_id: p.station_id, observed_at: p.observed_at, ...values, corrected: false, revisions: []};
    data.observations.push(record);
  }
  rules.observationRules(ctx, data, 'weather', record);
  return data;
}

function airObservationRecorded(ctx, data, p) {
  notLater(p.observed_at, ctx.virtual_now, 'observed_at');
  exists(data.monitors, 'monitor_id', p.monitor_id, 'monitor');
  if (data.air_observations.some(o => o.observation_id === p.observation_id)) fail('invalid_event', 'Observation ID already exists.');
  if (data.air_observations.some(o => o.monitor_id === p.monitor_id && ms(o.observed_at) === ms(p.observed_at))) fail('invalid_event', 'An observation for this hour exists.');
  data.air_observations.push(copy(p));
  rules.observationRules(ctx, data, 'air', p);
  return data;
}

function airForecastIssued(ctx, data, p) {
  notLater(p.issued_at, ctx.virtual_now, 'issued_at');
  exists(data.air_areas, 'air_area_id', p.air_area_id, 'air area');
  if (data.air_issuances.some(i => i.issuance_id === p.issuance_id)) fail('invalid_event', 'Issuance ID already exists.');
  const current = currentAirIssuance(data, p.air_area_id, ctx.virtual_now);
  if (current && ms(p.issued_at) <= ms(current.issued_at)) fail('stale_issuance', 'An air-quality issuance at least as new is already current.');
  data.air_issuances.push(copy(p));
  rules.airForecastRules(ctx, data, p);
  return data;
}

function alertPublished(ctx, data, p) {
  const {alert_id, ...version} = copy(p);
  notLater(version.issued_at, ctx.virtual_now, 'issued_at');
  if (ms(version.onset) >= ms(version.expires)) fail('invalid_event', 'An alert must expire after its onset.');
  let alert = data.alerts.find(a => a.alert_id === alert_id);
  if (version.msg_type === 'alert') {
    if (alert) fail('stale_alert_version', 'This alert already exists; send an update.');
    if (version.version !== 1) fail('stale_alert_version', 'A new alert starts at version 1.');
    alert = {alert_id, versions: [version]};
    data.alerts.push(alert);
  } else {
    if (!alert) fail('alert_reference_unknown', 'The alert being updated or cancelled does not exist.');
    const latest = alert.versions[alert.versions.length - 1];
    if (latest.msg_type === 'cancel') fail('stale_alert_version', 'The alert is already cancelled.');
    if (version.version !== latest.version + 1) fail('stale_alert_version', 'The version must follow the latest version.');
    alert.versions.push(version);
  }
  rules.alertRules(ctx, data, alert);
  return data;
}

// Generated by Infra from the Messaging result for one notification.
function deliveryRecorded(ctx, data, p) {
  const n = data.notifications.find(x => x.notification_id === p.notification_id);
  if (!n) fail('notification_not_found', 'Notification does not exist.');
  if (effectiveStatus(n, ctx.virtual_now) !== 'pending_delivery') fail('notification_not_pending', 'Notification is not waiting for delivery.');
  const stop = p.stop_run === true;
  n.outcome = {status: p.status, code: p.code, stop_run: stop, router_event_id: p.router_event_id, recorded_at: ctx.virtual_now};
  if (p.status === 'committed') n.status = 'delivered';
  else if (p.status === 'rejected' && !stop && p.code !== 'idempotency_conflict') n.status = 'delivery_failed';
  else n.status = 'pending_delivery'; // halting or unknown outcomes wait for reconciliation
  return data;
}

const HANDLERS = {
  'weather.forecast_issued': forecastIssued,
  'weather.observation_recorded': observationRecorded,
  'air.observation_recorded': airObservationRecorded,
  'air.forecast_issued': airForecastIssued,
  'alert.published': alertPublished,
  'notification.delivery_recorded': deliveryRecorded
};

function applyEvent(ctx, data, event) {
  const handler = HANDLERS[event.operation];
  if (!handler) fail('invalid_event', 'Unsupported operation.');
  const out = handler(ctx, data, event.payload);
  log(ctx, 'gustline.event_applied', {operation: event.operation, event_id: event.event_id});
  return out;
}

module.exports = {applyEvent};
