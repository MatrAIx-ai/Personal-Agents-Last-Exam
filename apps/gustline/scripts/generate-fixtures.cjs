'use strict';
// Deterministic synthetic fixture generator. Same seed, same bytes. `--check` fails on drift.
const fs = require('node:fs'), path = require('node:path');
const {render, instantOf, addDays} = require('../src/time.cjs');
const root = path.resolve(__dirname, '..');
const SEED = 20271008;

function prng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const H = 3600e3;

// Plausible hourly weather: diurnal temperature, wind with gusts above it, dew point below temperature.
function hourly(rand, startMs, hours, zone, profile) {
  const out = [];
  for (let i = 0; i < hours; i++) {
    const t = startMs + i * H, hour = +render(t, zone).slice(11, 13);
    const temp = profile.mean + profile.amp * Math.sin((hour - 9) / 24 * 2 * Math.PI) + (rand() - 0.5);
    const wind = Math.max(0, profile.wind + (rand() - 0.5) * 6 + (profile.windPeak && hour >= profile.windPeak[0] && hour <= profile.windPeak[1] ? profile.windPeak[2] : 0));
    const storm = profile.storm ? profile.storm(hour) : 0;
    out.push({start: render(t, zone), temp_c: round(temp), feels_like_c: round(temp - wind / 20),
      dew_point_c: round(temp - 6 - rand() * 4), precip_prob_pct: Math.min(100, Math.round(5 + storm + rand() * 5)),
      precip_mm: storm > 50 ? round(storm / 40, 1) : 0, thunder_prob_pct: Math.round(storm * 0.7),
      wind_kph: round(wind), gust_kph: round(wind * 1.5 + rand() * 4), wind_dir_deg: Math.round(rand() * 359),
      cloud_pct: Math.min(100, Math.round(20 + storm * 0.8 + rand() * 10)), visibility_km: 16,
      uv_index: hour >= 8 && hour <= 17 ? round(Math.max(0, 7 * Math.sin((hour - 6) / 12 * Math.PI)), 1) : 0,
      humidity_pct: Math.min(100, Math.round(35 + storm * 0.4 + rand() * 10))});
  }
  return out;
}
function daily(hours, zone, days, headline) {
  const byDate = new Map();
  for (const h of hours) { const d = h.start.slice(0, 10); if (!byDate.has(d)) byDate.set(d, []); byDate.get(d).push(h); }
  return [...byDate.entries()].slice(0, days).map(([date, list]) => ({date, high_c: Math.max(...list.map(h => h.temp_c)),
    low_c: Math.min(...list.map(h => h.temp_c)), precip_prob_pct: Math.max(...list.map(h => h.precip_prob_pct)), headline: headline(list)}));
}
const headline = list => Math.max(...list.map(h => h.precip_prob_pct)) >= 40 ? 'Showers possible' : 'Mostly sunny';

function minimal() {
  const rand = prng(SEED), LA = 'America/Los_Angeles', DEN = 'America/Denver';
  const issuedLA = Date.parse('2027-10-08T05:00:00-07:00'), issuedDen = Date.parse('2027-10-08T04:00:00-06:00');
  const issuance = (id, provider, zone, tz, issued, profile) => {
    const start = issued + H, hours = hourly(rand, start, 72, tz, profile);
    return {issuance_id: id, provider, zone_id: zone, issued_at: render(issued, tz), valid_from: render(start, tz),
      valid_to: render(start + 72 * H, tz), hourly: hours, daily: daily(hours, tz, 3, headline),
      products: [{kind: 'outlook', text: 'Dry and mild with smoke haze in the basin; breezier on Saturday afternoon.'}]};
  };
  const air = [];
  for (let h = 2; h <= 9; h++) air.push({observation_id: `ao-cedar-${String(h).padStart(2, '0')}00`, monitor_id: 'mon-cedar',
    observed_at: render(Date.parse('2027-10-08T00:00:00-07:00') + h * H, LA), pm25_ugm3: round(20 + h * 1.6 + rand() * 2), o3_ppb: round(26 + rand() * 6)});
  const obs = [];
  for (let h = 6; h <= 9; h++) obs.push({observation_id: `ob-cedar-${String(h).padStart(2, '0')}00`, station_id: 'st-cedar',
    observed_at: render(Date.parse('2027-10-08T00:00:00-07:00') + h * H, LA), temp_c: round(12 + h * 0.8), wind_kph: round(6 + rand() * 4),
    gust_kph: round(12 + rand() * 6), precip_mm: 0, humidity_pct: 55, corrected: false, revisions: []});
  return {
    account_id: 'gustline-ana', owner_person_id: 'person-ana',
    settings: {units: 'metric', time_zone: LA, default_saved_place_id: 'sp-1'},
    zones: [{zone_id: 'z-cedar', name: 'Cedar Basin', time_zone: LA}, {zone_id: 'z-dunes', name: 'Dune Flats', time_zone: DEN}],
    air_areas: [{air_area_id: 'aa-cedar', name: 'Cedar Basin Air District'}],
    stations: [{station_id: 'st-cedar', name: 'Cedar Basin Airport', zone_id: 'z-cedar'}, {station_id: 'st-dunes', name: 'Dune Flats Visitor Center', zone_id: 'z-dunes'}],
    monitors: [{monitor_id: 'mon-cedar', name: 'Cedar Basin - Library', air_area_id: 'aa-cedar'}],
    places: [
      {place_id: 'pl-school', name: 'Cedar Basin Elementary School', kind: 'venue', latitude: 38.551, longitude: -121.741, elevation_m: 16,
        time_zone: LA, zone_id: 'z-cedar', air_area_id: 'aa-cedar', station_id: 'st-cedar', monitor_id: 'mon-cedar', external_ref: null},
      {place_id: 'pl-home', name: 'Cedar Basin', kind: 'city', latitude: 38.544, longitude: -121.740, elevation_m: 15,
        time_zone: LA, zone_id: 'z-cedar', air_area_id: 'aa-cedar', station_id: 'st-cedar', monitor_id: 'mon-cedar', external_ref: null},
      {place_id: 'pl-dunes', name: 'Dune Flats Park', kind: 'park', latitude: 32.780, longitude: -106.172, elevation_m: 1216,
        time_zone: DEN, zone_id: 'z-dunes', air_area_id: null, station_id: 'st-dunes', monitor_id: null, external_ref: null}],
    saved_places: [{saved_place_id: 'sp-1', place_id: 'pl-school', label: "Kids' school", created_at: '2027-09-01T08:00:00-07:00'},
      {saved_place_id: 'sp-2', place_id: 'pl-home', label: 'Home', created_at: '2027-09-01T08:00:00-07:00'}],
    issuances: [
      issuance('fc-gl-cedar-0500', 'gustline', 'z-cedar', LA, issuedLA, {mean: 18, amp: 7, wind: 10, windPeak: [13, 18, 22]}),
      issuance('fc-gl-dunes-0400', 'gustline', 'z-dunes', DEN, issuedDen, {mean: 26, amp: 8, wind: 12, storm: h => (h >= 14 && h <= 19 ? 45 : 5)}),
      issuance('fc-ro-dunes-0500', 'regional_office', 'z-dunes', DEN, issuedDen + H, {mean: 26, amp: 8, wind: 12, storm: h => (h >= 13 && h <= 19 ? 55 : 8)})],
    air_issuances: [{issuance_id: 'af-cedar-1006', air_area_id: 'aa-cedar', issued_at: '2027-10-06T13:30:00-07:00',
      days: [{date: '2027-10-08', aqi_category: 'unhealthy_for_sensitive_groups', dominant_pollutant: 'pm25'},
        {date: '2027-10-09', aqi_category: 'moderate', dominant_pollutant: 'pm25'}],
      narrative: 'Smoke from a fire to the south is expected to settle in the basin on Friday.'}],
    observations: obs, air_observations: air,
    alerts: [{alert_id: 'aqa-77', versions: [{version: 1, msg_type: 'alert', issued_at: '2027-10-06T08:00:00-07:00',
      issuer: 'Cedar Basin Air District', event: 'smoke_advisory', severity: 'moderate', urgency: 'expected', certainty: 'likely',
      areas: {air_area_ids: ['aa-cedar']}, onset: '2027-10-08T00:00:00-07:00', expires: '2027-10-10T00:00:00-07:00',
      headline: 'Smoke advisory for Cedar Basin', instruction: 'Sensitive groups should limit time outdoors.'}]}],
    rules: [
      {rule_id: 'rule-1', saved_place_id: 'sp-1', kind: 'observation_threshold', metric: 'aqi', comparator: 'gte', threshold: 101,
        provider: 'gustline', look_ahead_hours: null, window: {type: 'recurring', days: [1, 2, 3, 4, 5], start: '07:00', end: '15:00'},
        alert_events: [], min_severity: null, notify_on_clear: false, delivery: 'mail', quiet_hours: {start: '22:00', end: '07:00'},
        severe_override: false, status: 'active', created_at: '2027-09-01T08:05:00-07:00', revision: 1,
        history: [{revision: 1, at: '2027-09-01T08:05:00-07:00', action: 'created', changes: {}}]},
      {rule_id: 'rule-2', saved_place_id: 'sp-2', kind: 'forecast_threshold', metric: 'gust_kph', comparator: 'gte', threshold: 50,
        provider: 'gustline', look_ahead_hours: 24, window: null, alert_events: [], min_severity: null, notify_on_clear: true,
        delivery: 'mail', quiet_hours: {start: '22:00', end: '07:00'}, severe_override: false, status: 'active',
        created_at: '2027-09-01T08:06:00-07:00', revision: 1,
        history: [{revision: 1, at: '2027-09-01T08:06:00-07:00', action: 'created', changes: {}}]}],
    notifications: []
  };
}

function build({check = false} = {}) {
  const outputs = {'fixtures/minimal.json': minimal()};
  for (const [file, value] of Object.entries(outputs)) {
    const expected = JSON.stringify(value, null, 2) + '\n', target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    if (check) { if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== expected) throw new Error('Generated fixture drift: ' + file); }
    else fs.writeFileSync(target, expected);
  }
  return Object.keys(outputs);
}
module.exports = {build, prng, hourly, daily};
if (require.main === module) console.log(JSON.stringify(build({check: process.argv.includes('--check')})));
