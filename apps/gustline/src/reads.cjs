'use strict';
const {fail, copy, place: getPlace, rule: getRule, effectiveStatus} = require('./common.cjs');
const {render, ms, instantOf, addDays} = require('./time.cjs');
const {FIELDS, DAILY_FIELDS, DEFAULT_PROVIDER, PROVIDERS, LIMITS, INFORMATIONAL_EVENTS} = require('./catalog.cjs');
const aqi = require('./aqi.cjs');
const solar = require('./solar.cjs');

const view = p => ({place_id: p.place_id, name: p.name, time_zone: p.time_zone});

// Latest issuance for a provider and zone at the virtual time (newest issued_at wins).
function currentIssuance(data, zoneId, provider, now) {
  return data.issuances.filter(i => i.zone_id === zoneId && i.provider === provider && Date.parse(i.issued_at) <= Date.parse(now))
    .sort((a, b) => Date.parse(b.issued_at) - Date.parse(a.issued_at))[0] || null;
}
function currentAirIssuance(data, areaId, now) {
  return data.air_issuances.filter(i => i.air_area_id === areaId && Date.parse(i.issued_at) <= Date.parse(now))
    .sort((a, b) => Date.parse(b.issued_at) - Date.parse(a.issued_at))[0] || null;
}

// Render one record's measured fields in the account's units; absent fields are reported as null.
function convert(record, fields, units) {
  const out = {};
  for (const [key, spec] of Object.entries(fields)) {
    const value = record[key];
    if (units === 'us' && spec.us) out[spec.us] = typeof value === 'number' ? spec.convert(value) : null;
    else out[key] = value === undefined ? null : value;
  }
  return out;
}

function forecastGet(ctx, data, args) {
  const now = ctx.virtual_now, p = getPlace(data, args.place_id), provider = args.provider || DEFAULT_PROVIDER;
  const from = ms(args.from), to = ms(args.to);
  if (from > to) fail('invalid_window', 'The window must not end before it starts.');
  const issuance = currentIssuance(data, p.zone_id, provider, now);
  if (!issuance) fail('no_issuance', 'No forecast from this provider has been issued for this place yet.');
  const units = data.settings.units;
  let periods;
  if (args.granularity === 'hourly') {
    const horizon = Math.min(ms(issuance.valid_to), ms(issuance.issued_at) + LIMITS.hourly_hours * 3600e3);
    if (to > horizon || from < ms(issuance.valid_from)) fail('outside_horizon', 'The window is outside the current issuance.');
    periods = issuance.hourly.filter(h => ms(h.start) >= from && ms(h.start) <= to)
      .map(h => ({start: render(h.start, p.time_zone), ...convert(h, FIELDS, units)}));
  } else {
    const firstDate = render(from, p.time_zone).slice(0, 10), lastDate = render(to, p.time_zone).slice(0, 10);
    if (lastDate > addDays(render(issuance.issued_at, p.time_zone).slice(0, 10), LIMITS.daily_days)) fail('outside_horizon', 'The window is beyond the daily horizon.');
    periods = issuance.daily.filter(d => d.date >= firstDate && d.date <= lastDate).map(d => ({date: d.date, ...convert(d, DAILY_FIELDS, units)}));
  }
  const notProvided = [...new Set(periods.flatMap(per => Object.keys(per).filter(k => per[k] === null)))].sort();
  const others = Object.keys(PROVIDERS).filter(x => x !== provider && currentIssuance(data, p.zone_id, x, now));
  return {place: view(p), provider, issuance_id: issuance.issuance_id, issued_at: render(issuance.issued_at, p.time_zone),
    as_of: render(now, p.time_zone), units, granularity: args.granularity, periods, products: copy(issuance.products || []),
    not_provided: notProvided, other_providers_available: others};
}

function forecastHistory(ctx, data, args) {
  const now = ctx.virtual_now, p = getPlace(data, args.place_id);
  let list;
  if (args.kind === 'weather') {
    const provider = args.provider || DEFAULT_PROVIDER, current = currentIssuance(data, p.zone_id, provider, now);
    list = data.issuances.filter(i => i.zone_id === p.zone_id && i.provider === provider).map(i => ({
      issuance_id: i.issuance_id, provider, issued_at: render(i.issued_at, p.time_zone),
      valid_from: render(i.valid_from, p.time_zone), valid_to: render(i.valid_to, p.time_zone),
      status: current && current.issuance_id === i.issuance_id ? 'current' : 'superseded',
      hourly_count: i.hourly.length, daily_count: i.daily.length}));
  } else {
    if (!p.air_area_id) fail('no_issuance', 'This place has no air-quality area.');
    const current = currentAirIssuance(data, p.air_area_id, now);
    list = data.air_issuances.filter(i => i.air_area_id === p.air_area_id).map(i => ({
      issuance_id: i.issuance_id, issued_at: render(i.issued_at, p.time_zone),
      status: current && current.issuance_id === i.issuance_id ? 'current' : 'superseded', days: copy(i.days)}));
  }
  list.sort((a, b) => ms(b.issued_at) - ms(a.issued_at));
  return {place: view(p), as_of: render(now, p.time_zone), issuances: list};
}

function observationsGet(ctx, data, args) {
  const now = ctx.virtual_now, p = getPlace(data, args.place_id);
  if (!p.station_id) fail('no_station_for_place', 'This place has no observing station.');
  const from = ms(args.from), to = ms(args.to);
  if (from > to) fail('invalid_window', 'The window must not end before it starts.');
  if (to > ms(now)) fail('not_yet_observed', 'Part of the window is after the current virtual time.');
  const units = data.settings.units;
  const rows = data.observations.filter(o => o.station_id === p.station_id && ms(o.observed_at) >= from && ms(o.observed_at) <= to)
    .sort((a, b) => ms(a.observed_at) - ms(b.observed_at))
    .map(o => ({observation_id: o.observation_id, observed_at: render(o.observed_at, p.time_zone), ...convert(o, FIELDS, units),
      corrected: o.corrected, revisions: o.revisions.map(r => ({observation_id: r.observation_id, values: convert(r.values, FIELDS, units)}))}))
    .map(row => { for (const k of Object.keys(row)) if (row[k] === null) delete row[k]; return row; });
  return {place: view(p), station_id: p.station_id, as_of: render(now, p.time_zone), units, observations: rows};
}

function astroGet(ctx, data, args) {
  const p = getPlace(data, args.place_id);
  // Compute for the UTC date nearest local noon so the local calendar date matches.
  const noon = instantOf(args.date, '12:00', p.time_zone), utcDate = new Date(noon).toISOString().slice(0, 10);
  const d = solar.day(utcDate, p.latitude, p.longitude);
  const fmt = v => (v === null ? null : render(v, p.time_zone));
  return {place: view(p), date: args.date, civil_dawn: fmt(d.civil_dawn), sunrise: fmt(d.sunrise), sunset: fmt(d.sunset), civil_dusk: fmt(d.civil_dusk)};
}

function airCurrent(ctx, data, args) {
  const now = ctx.virtual_now, p = getPlace(data, args.place_id);
  if (!p.monitor_id) fail('no_monitor_for_place', 'This place has no air-quality monitor.');
  const result = aqi.compute(data.air_observations.filter(o => o.monitor_id === p.monitor_id), ms(now));
  if (!result) fail('no_observation', 'The monitor has not reported yet.');
  return {place: view(p), monitor_id: p.monitor_id, as_of: render(now, p.time_zone), ...result,
    observed_at: render(result.observed_at, p.time_zone),
    stale: ms(now) - ms(result.observed_at) > LIMITS.stale_air_hours * 3600e3};
}

function airForecast(ctx, data, args) {
  const now = ctx.virtual_now, p = getPlace(data, args.place_id);
  if (!p.air_area_id) fail('no_issuance', 'This place has no air-quality area.');
  if (args.from_date > args.to_date) fail('invalid_window', 'The window must not end before it starts.');
  const issuance = currentAirIssuance(data, p.air_area_id, now);
  if (!issuance) fail('no_issuance', 'No air-quality forecast has been issued for this area yet.');
  return {place: view(p), air_area_id: p.air_area_id, issuance_id: issuance.issuance_id, issued_at: render(issuance.issued_at, p.time_zone),
    as_of: render(now, p.time_zone), days: copy(issuance.days.filter(d => d.date >= args.from_date && d.date <= args.to_date)),
    narrative: issuance.narrative || null};
}

// Alert status from its latest message and the virtual time: cancelled, upcoming, active or expired.
function alertStatus(alert, now) {
  const latest = alert.versions[alert.versions.length - 1], t = Date.parse(now);
  if (latest.msg_type === 'cancel') return 'cancelled';
  if (t < Date.parse(latest.onset)) return 'upcoming';
  if (t < Date.parse(latest.expires)) return 'active';
  return 'expired';
}
const affects = (version, p) => (version.areas.zone_ids || []).includes(p.zone_id) ||
  (p.air_area_id && (version.areas.air_area_ids || []).includes(p.air_area_id)) || (version.areas.place_ids || []).includes(p.place_id);

function alertView(alert, now, zone, version) {
  const chosen = version ? alert.versions.find(v => v.version === version) : alert.versions[alert.versions.length - 1];
  if (!chosen) fail('alert_version_not_found', 'That version of the alert does not exist.');
  const r = v => ({...copy(v), issued_at: render(v.issued_at, zone), onset: render(v.onset, zone), expires: render(v.expires, zone)});
  return {alert_id: alert.alert_id, status: alertStatus(alert, now), latest_version: alert.versions.length,
    informational: INFORMATIONAL_EVENTS.includes(chosen.event), version: r(chosen), chain: alert.versions.map(r)};
}

function alertsList(ctx, data, args) {
  const now = ctx.virtual_now, p = getPlace(data, args.place_id);
  const alerts = data.alerts.filter(a => affects(a.versions[a.versions.length - 1], p))
    .map(a => alertView(a, now, p.time_zone)).filter(a => !args.status || a.status === args.status);
  return {place: view(p), as_of: render(now, p.time_zone), alerts};
}

function alertsGet(ctx, data, args) {
  const alert = data.alerts.find(a => a.alert_id === args.alert_id);
  if (!alert) fail('alert_not_found', 'Alert does not exist.');
  return {as_of: render(ctx.virtual_now, data.settings.time_zone), alert: alertView(alert, ctx.virtual_now, data.settings.time_zone, args.version)};
}

function read(ctx, data, name, args) {
  switch (name) {
    case 'gustline.places.search': {
      const q = (args.query || '').toLocaleLowerCase();
      return {places: copy(data.places.filter(p => p.name.toLocaleLowerCase().includes(q) || p.place_id.includes(q)))};
    }
    case 'gustline.places.get': return {place: copy(getPlace(data, args.place_id))};
    case 'gustline.saved_places.list': return {saved_places: data.saved_places.map(s => ({...copy(s),
      place_name: data.places.find(p => p.place_id === s.place_id).name}))};
    case 'gustline.settings.get': return {settings: copy(data.settings)};
    case 'gustline.forecast.get': return forecastGet(ctx, data, args);
    case 'gustline.forecast.history': return forecastHistory(ctx, data, args);
    case 'gustline.observations.get': return observationsGet(ctx, data, args);
    case 'gustline.astro.get': return astroGet(ctx, data, args);
    case 'gustline.air.current': return airCurrent(ctx, data, args);
    case 'gustline.air.forecast': return airForecast(ctx, data, args);
    case 'gustline.alerts.list': return alertsList(ctx, data, args);
    case 'gustline.alerts.get': return alertsGet(ctx, data, args);
    case 'gustline.rules.list': return {rules: copy(data.rules)};
    case 'gustline.rules.get': return {rule: copy(getRule(data, args.rule_id))};
    case 'gustline.notifications.list': {
      const now = ctx.virtual_now;
      const list = data.notifications.map(n => ({...copy(n), status: effectiveStatus(n, now)})).filter(n => !args.status || n.status === args.status);
      return {as_of: render(now, data.settings.time_zone), notifications: list};
    }
    default: return null;
  }
}

module.exports = {read, currentIssuance, currentAirIssuance, alertStatus, affects};
