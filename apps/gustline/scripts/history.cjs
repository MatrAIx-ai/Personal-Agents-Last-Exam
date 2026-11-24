'use strict';
// Account history from 2025-01-01 up to the start of a fixture or pack. Saved places and rules date from
// January 2025; past official alerts are kept; past notifications are produced by replaying synthetic
// alerts, short forecasts and observations through Gustline's own event handlers, in time order. The
// short forecasts and observations used for the replay are not kept: like a real service, the account
// keeps its alerts and notifications, not every superseded issuance.
const plugin = require('../plugin.cjs');
const {render, instantOf, addDays, parts} = require('../src/time.cjs');
const {METRICS} = require('../src/catalog.cjs');
const {CATEGORIES} = require('../src/aqi.cjs');

const H = 3600e3;
const SEASONAL = {winter: ['winter_storm_warning', 'wind_advisory'], spring: ['wind_advisory', 'flood_watch'],
  summer: ['heat_advisory', 'severe_thunderstorm_watch'], autumn: ['wind_advisory', 'flood_watch']};
const NAMES = {flood_watch: 'Flood Watch', flood_warning: 'Flood Warning', severe_thunderstorm_watch: 'Severe Thunderstorm Watch',
  severe_thunderstorm_warning: 'Severe Thunderstorm Warning', heat_advisory: 'Heat Advisory', excessive_heat_warning: 'Excessive Heat Warning',
  wind_advisory: 'Wind Advisory', winter_storm_warning: 'Winter Storm Warning', red_flag_warning: 'Red Flag Warning',
  air_quality_alert: 'Air Quality Alert', smoke_advisory: 'Smoke Advisory', area_closure: 'Area Closure'};
// Quiet values for every hourly field; the rule's own field is pushed past its threshold at one hour.
const BASE = {temp_c: 18, feels_like_c: 18, dew_point_c: 9, precip_prob_pct: 10, precip_mm: 0, thunder_prob_pct: 5, wind_kph: 10,
  gust_kph: 20, wind_dir_deg: 200, cloud_pct: 30, visibility_km: 16, uv_index: 3, humidity_pct: 45};

const season = month => (month <= 2 || month === 12 ? 'winter' : month <= 5 ? 'spring' : month <= 8 ? 'summer' : 'autumn');
function months(until) {
  const out = [];
  // Rules and saved places date from January; replayed activity starts in February.
  for (let [y, m] = [2025, 2]; `${y}-${String(m).padStart(2, '0')}-01` < until.slice(0, 10); m = m === 12 ? 1 : m + 1, y += m === 1 ? 1 : 0) {
    out.push({y, m, ym: `${y}-${String(m).padStart(2, '0')}`});
  }
  return out;
}
const pickDay = (rand, ym, weekdays) => {
  for (let i = 0; i < 20; i++) {
    const d = `${ym}-${String(3 + Math.floor(rand() * 24)).padStart(2, '0')}`;
    if (!weekdays || weekdays.includes(parts(instantOf(d, '12:00', 'UTC'), 'UTC').weekday)) return d;
  }
  return null;
};
const beyond = (rule, metric = METRICS[rule.metric]) => {
  const step = Math.max(2, Math.round((metric.max - metric.min) * 0.03));
  return Math.min(metric.max, Math.max(metric.min, rule.comparator === 'gte' ? rule.threshold + step : rule.threshold - step));
};

// Events for one rule in one month, or [] when that month has none.
function ruleEvents(rand, data, rule, {ym}) {
  if (rule.kind === 'official_alert') return []; // alert rules hear the zone's past alerts
  const saved = data.saved_places.find(s => s.saved_place_id === rule.saved_place_id), place = data.places.find(p => p.place_id === saved.place_id);
  const tz = place.time_zone, w = rule.window;
  if (w && w.type === 'absolute') return [];
  const day = pickDay(rand, ym, w ? w.days : null);
  if (!day) return [];
  const targetHour = w ? w.start.slice(0, 2) + ':00' : '15:00', target = instantOf(day, targetHour, tz), issued = target - 18 * H;
  const id = `h-${rule.rule_id}-${ym}`;
  if (rule.kind === 'forecast_threshold' && rule.metric === 'aqi_forecast_category') {
    if (!place.air_area_id) return [];
    return [{at: render(issued + 2 * 60e3, tz), operation: 'air.forecast_issued', payload: {issuance_id: id, air_area_id: place.air_area_id,
      issued_at: render(issued, tz), days: [{date: day, aqi_category: CATEGORIES[Math.min(5, rule.threshold)], dominant_pollutant: 'pm25'}]}}];
  }
  if (rule.kind === 'forecast_threshold') {
    const field = METRICS[rule.metric].field, start = issued + H, hourly = [];
    for (let i = 0; i < 36; i++) {
      const t = start + i * H;
      hourly.push({start: render(t, tz), ...BASE, [field]: t === target ? beyond(rule) : BASE[field]});
    }
    return [{at: render(issued + 2 * 60e3, tz), operation: 'weather.forecast_issued', payload: {issuance_id: id, provider: rule.provider,
      zone_id: place.zone_id, issued_at: render(issued, tz), valid_from: render(start, tz), valid_to: render(start + 36 * H, tz), hourly, daily: [], products: []}}];
  }
  if (rule.metric === 'aqi') {
    if (!place.monitor_id) return [];
    return [{at: render(target + 5 * 60e3, tz), operation: 'air.observation_recorded',
      payload: {observation_id: id, monitor_id: place.monitor_id, observed_at: render(target, tz), pm25_ugm3: 125}}];
  }
  if (!place.station_id) return [];
  return [{at: render(target + 5 * 60e3, tz), operation: 'weather.observation_recorded',
    payload: {observation_id: id, station_id: place.station_id, observed_at: render(target, tz), [METRICS[rule.metric].field]: beyond(rule)}}];
}

// One past alert per zone in about half the months; alert rules' own events are preferred.
function alertEvents(rand, data, zone, {m, ym}) {
  if (rand() >= 0.5) return [];
  const wanted = data.rules.filter(r => r.kind === 'official_alert' && data.places.some(p => p.zone_id === zone.zone_id &&
    data.saved_places.some(s => s.saved_place_id === r.saved_place_id && s.place_id === p.place_id))).flatMap(r => r.alert_events);
  const pool = wanted.length && rand() < 0.7 ? wanted : SEASONAL[season(m)];
  const event = pool[Math.floor(rand() * pool.length)], day = pickDay(rand, ym, null), tz = zone.time_zone;
  const issued = instantOf(day, '09:00', tz), id = `al-h-${zone.zone_id.replace(/^z-/, '')}-${ym}`;
  return [{at: render(issued + 5 * 60e3, tz), operation: 'alert.published', payload: {alert_id: id, version: 1, msg_type: 'alert',
    issued_at: render(issued, tz), issuer: zone.name + ' Weather Office', event, severity: event.endsWith('warning') ? 'severe' : 'moderate',
    urgency: 'expected', certainty: 'likely', areas: {zone_ids: [zone.zone_id]}, onset: render(instantOf(day, '12:00', tz), tz),
    expires: render(instantOf(addDays(day, 1), '06:00', tz), tz), headline: `${NAMES[event]} for ${zone.name}`}}];
}

// Returns the seed with history merged in. `until` is the first date of the fixture's own activity.
function backfill(seed, binding, rand, until) {
  const created = (i, tz) => render(instantOf(`2025-01-0${2 + (i % 7)}`, '08:00', tz), tz);
  const tzOf = s => seed.places.find(p => p.place_id === s.place_id).time_zone;
  const saved = seed.saved_places.map((s, i) => ({...s, created_at: created(i, tzOf(s))}));
  const rules = seed.rules.map((r, i) => {
    const tz = tzOf(saved.find(s => s.saved_place_id === r.saved_place_id));
    const at = render(Date.parse(created(i, tz)) + (5 + i) * 60e3, tz);
    return {...r, created_at: at, history: r.history.map((h, k) => (k === 0 ? {...h, at} : h))};
  });
  let data = {...structuredClone(seed), saved_places: saved, rules: structuredClone(rules), issuances: [], air_issuances: [], observations: [],
    air_observations: [], alerts: [], notifications: []};
  const events = [];
  for (const month of months(until)) {
    for (const zone of data.zones) events.push(...alertEvents(rand, data, zone, month));
    for (const rule of data.rules) if (rule.status === 'active' && rand() < 0.5) events.push(...ruleEvents(rand, data, rule, month));
  }
  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (const [i, e] of events.entries()) {
    const ctx = {app_id: 'gustline', role: 'infra', virtual_now: e.at, binding};
    data = plugin.applyEvent(ctx, data, {event_id: 'h-' + i, ...e});
    plugin.validateSeed(ctx, data);
  }
  // Past notifications were sent or shown; about half were read a few hours later.
  const notifications = data.notifications.map((n, i) => {
    if (n.delivery !== 'mail') return {...n, acknowledged_at: rand() < 0.5 ? render(Date.parse(n.created_at) + 3 * H, seed.settings.time_zone) : null};
    return {...n, status: 'delivered', outcome: {status: 'committed', code: null, stop_run: false, router_event_id: 'router-h-' + String(i + 1).padStart(4, '0'), recorded_at: n.time},
      acknowledged_at: rand() < 0.5 ? render(Date.parse(n.time) + 3 * H, seed.settings.time_zone) : null};
  });
  return {...seed, saved_places: saved, rules, alerts: [...data.alerts, ...seed.alerts], notifications: [...notifications, ...seed.notifications]};
}

module.exports = {backfill};
