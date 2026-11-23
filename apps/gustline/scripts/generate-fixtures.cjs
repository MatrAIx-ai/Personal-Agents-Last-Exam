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

// ---- Scenario packs: each is a seed plus chronological events a task can load and schedule ----
const rule = (id, saved, kind, extra) => ({rule_id: id, saved_place_id: saved, kind, metric: null, comparator: null, threshold: null,
  provider: 'gustline', look_ahead_hours: null, window: null, alert_events: [], min_severity: null, notify_on_clear: false,
  delivery: 'mail', quiet_hours: null, severe_override: false, status: 'active', created_at: extra.created_at, revision: 1,
  history: [{revision: 1, at: extra.created_at, action: 'created', changes: {}}], ...extra});
const place = (id, name, kind, lat, lon, elev, tz, zone, extra = {}) => ({place_id: id, name, kind, latitude: lat, longitude: lon,
  elevation_m: elev, time_zone: tz, zone_id: zone, air_area_id: null, station_id: null, monitor_id: null, external_ref: null, ...extra});
const base = (account, owner, tz) => ({account_id: account, owner_person_id: owner, settings: {units: 'us', time_zone: tz, default_saved_place_id: 'sp-1'},
  zones: [], air_areas: [], stations: [], monitors: [], places: [], saved_places: [], issuances: [], air_issuances: [],
  observations: [], air_observations: [], alerts: [], rules: [], notifications: []});
let eventSeq = 0;
const ev = (at, operation, payload) => ({event_id: 'ev-' + String(++eventSeq).padStart(4, '0'), at, operation, payload});
const sortEvents = list => list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.event_id < b.event_id ? -1 : 1));
const alertMsg = (id, version, type, issuedAt, fields) => ({alert_id: id, version, msg_type: type, issued_at: issuedAt,
  urgency: 'expected', certainty: 'likely', ...(version > 1 ? {references: [{alert_id: id, version: version - 1}]} : {}), ...fields});
const versionOf = ({alert_id, ...v}) => v; // seed stores versions without the alert_id

function issuanceAt(rand, id, provider, zone, tz, issuedMs, hours, profile, days = 3) {
  const start = issuedMs + H, list = hourly(rand, start, hours, tz, profile);
  return {issuance_id: id, provider, zone_id: zone, issued_at: render(issuedMs, tz), valid_from: render(start, tz),
    valid_to: render(start + hours * H, tz), hourly: list, daily: daily(list, tz, days, headline), products: profile.products || []};
}

function stationObs(rand, station, tz, endMs, count, mean) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const t = endMs - i * H, hour = +render(t, tz).slice(11, 13), temp = round(mean + 7 * Math.sin((hour - 9) / 24 * 2 * Math.PI) + rand() - 0.5);
    out.push({observation_id: `ob-${station.slice(3)}-${count - 1 - i}`, station_id: station, observed_at: render(t, tz), temp_c: temp,
      dew_point_c: round(temp - 8 - rand() * 3), wind_kph: round(8 + rand() * 6), gust_kph: round(16 + rand() * 8), precip_mm: 0,
      humidity_pct: Math.round(40 + rand() * 15), corrected: false, revisions: []});
  }
  return out;
}

// (A) Desert park storm day: two providers, three issuances each, a Flood Watch issued then updated, a park closure.
function desertPack() {
  eventSeq = 0;
  const rand = prng(SEED + 1), DEN = 'America/Denver', CHI = 'America/Chicago', s = base('gustline-kai', 'person-kai', CHI), events = [];
  s.zones = [{zone_id: 'z-dunes', name: 'Dune Flats', time_zone: DEN}, {zone_id: 'z-rivergate', name: 'Rivergate', time_zone: CHI}];
  s.stations = [{station_id: 'st-dunes', name: 'Dune Flats Visitor Center', zone_id: 'z-dunes'}, {station_id: 'st-rivergate', name: 'Rivergate Municipal Airport', zone_id: 'z-rivergate'}];
  s.places = [place('pl-dunes', 'Dune Flats Park', 'park', 32.780, -106.172, 1216, DEN, 'z-dunes', {station_id: 'st-dunes'}),
    place('pl-alamo', 'Alamo Springs', 'city', 32.900, -105.960, 1310, DEN, 'z-dunes', {station_id: 'st-dunes'}),
    place('pl-rivergate', 'Rivergate', 'city', 30.270, -97.740, 150, CHI, 'z-rivergate', {station_id: 'st-rivergate'})];
  for (const iso of ['2026-09-10T17:00:00-05:00', '2026-09-11T05:00:00-05:00', '2026-09-11T11:00:00-05:00']) {
    s.issuances.push(issuanceAt(rand, 'fc-gl-riv-' + iso.slice(5, 13).replace(/[-T]/g, ''), 'gustline', 'z-rivergate', CHI, Date.parse(iso), 24, {mean: 30, amp: 6, wind: 10}, 1));
  }
  s.observations.push(...stationObs(rand, 'st-rivergate', CHI, Date.parse('2026-09-11T15:00:00-05:00'), 48, 30));
  s.saved_places = [{saved_place_id: 'sp-1', place_id: 'pl-dunes', label: 'Dune Flats', created_at: '2026-09-09T19:00:00-05:00'}];
  // Storms build in the afternoon; each later issuance brings the onset earlier.
  const storm = (onset, peak) => h => (h >= onset && h <= 20 ? peak : h >= onset - 2 && h < onset ? 25 : 6);
  const issue = (id, provider, iso, onset, peak, text) => issuanceAt(rand, id, provider, 'z-dunes', DEN, Date.parse(iso), 72,
    {mean: 27, amp: 8, wind: 12, storm: storm(onset, peak), products: [{kind: 'outlook', text}]});
  s.issuances.push(issue('fc-ro-0911-0500', 'regional_office', '2026-09-11T05:00:00-06:00', 17, 45, 'Isolated storms possible late Saturday.'));
  s.issuances.push(issue('fc-gl-0911-0900', 'gustline', '2026-09-11T09:00:00-06:00', 17, 40, 'Afternoon storms Saturday.'));
  for (const [id, provider, iso, onset, peak, text] of [
    ['fc-gl-0911-1500', 'gustline', '2026-09-11T15:00:00-06:00', 16, 55, 'Storms Saturday afternoon and evening.'],
    ['fc-ro-0911-1700', 'regional_office', '2026-09-11T17:00:00-06:00', 15, 60, 'Strong storms this evening Saturday; locally heavy rain.'],
    ['fc-gl-0911-2100', 'gustline', '2026-09-11T21:00:00-06:00', 15, 65, 'Strong storms Saturday from mid-afternoon.'],
    ['fc-ro-0912-0500', 'regional_office', '2026-09-12T05:00:00-06:00', 14, 70, 'Storms develop earlier, after 2 PM; flash flooding possible.']]) {
    events.push(ev(render(Date.parse(iso) + 2 * 60e3, DEN), 'weather.forecast_issued', issue(id, provider, iso, onset, peak, text)));
  }
  for (let i = 0; i < 48; i++) {
    const t = Date.parse('2026-09-09T15:00:00-06:00') + i * H, hour = +render(t, DEN).slice(11, 13), temp = round(27 + 8 * Math.sin((hour - 9) / 24 * 2 * Math.PI) + rand() - 0.5);
    const o = {observation_id: 'ob-dunes-' + i, station_id: 'st-dunes', observed_at: render(t, DEN), temp_c: temp, dew_point_c: round(temp - 12 - rand() * 3),
      wind_kph: round(8 + rand() * 6), gust_kph: round(16 + rand() * 8), precip_mm: 0, humidity_pct: Math.round(20 + rand() * 10)};
    s.observations.push({...o, corrected: false, revisions: []});
  }
  const flood = {issuer: 'Dune Flats Weather Office', event: 'flood_watch', severity: 'moderate', areas: {zone_ids: ['z-dunes']},
    headline: 'Flood Watch for Dune Flats', instruction: 'Avoid low areas and washes if storms develop.'};
  events.push(ev('2026-09-11T19:00:00-06:00', 'alert.published', alertMsg('cl-dunes-drive', 1, 'alert', '2026-09-11T19:00:00-06:00', {
    issuer: 'Dune Flats Park Service', event: 'area_closure', severity: 'minor', areas: {place_ids: ['pl-dunes']},
    onset: '2026-09-12T16:00:00-06:00', expires: '2026-09-12T22:00:00-06:00', headline: 'Dunes Drive closes at 4 PM Saturday for range testing'})));
  events.push(ev('2026-09-11T20:30:00-06:00', 'alert.published', alertMsg('fw-dunes', 1, 'alert', '2026-09-11T20:30:00-06:00', {
    ...flood, onset: '2026-09-12T15:00:00-06:00', expires: '2026-09-13T00:00:00-06:00'})));
  events.push(ev('2026-09-12T05:30:00-06:00', 'alert.published', alertMsg('fw-dunes', 2, 'update', '2026-09-12T05:30:00-06:00', {
    ...flood, onset: '2026-09-12T13:00:00-06:00', expires: '2026-09-13T06:00:00-06:00', headline: 'Flood Watch for Dune Flats now starts at 1 PM'})));
  s.rules = [rule('rule-1', 'sp-1', 'forecast_threshold', {metric: 'thunder_prob_pct', comparator: 'gte', threshold: 30, look_ahead_hours: 48,
      window: {type: 'absolute', from: '2026-09-12T09:00:00-06:00', to: '2026-09-12T16:00:00-06:00'}, notify_on_clear: true,
      quiet_hours: {start: '22:00', end: '06:30'}, created_at: '2026-09-09T19:05:00-05:00'}),
    rule('rule-2', 'sp-1', 'official_alert', {alert_events: ['flood_watch', 'flood_warning', 'area_closure'], created_at: '2026-09-09T19:06:00-05:00'})];
  return {seed: s, now: '2026-09-11T14:00:00-06:00', binding: {people: [{person_id: 'person-kai', name: 'Kai Morgan'}],
    accounts: [{app_id: 'gustline', account_id: 'gustline-kai', owner_person_id: 'person-kai'}], objects: {gustline: ['pl-dunes', 'pl-alamo', 'pl-rivergate']}},
    events: sortEvents(events)};
}

// (B) Smoke week: two air areas, five days of hourly PM2.5/O3, daily air forecasts, a smoke advisory issued, extended and cancelled.
function smokePack() {
  eventSeq = 0;
  const rand = prng(SEED + 2), LA = 'America/Los_Angeles', s = base('gustline-marcus', 'person-marcus', LA), events = [];
  s.zones = [{zone_id: 'z-cedar', name: 'Cedar Basin', time_zone: LA}, {zone_id: 'z-north', name: 'North Shore', time_zone: LA}];
  s.stations = [{station_id: 'st-cedar-rs', name: 'Cedar Basin Ranger Station', zone_id: 'z-cedar'}];
  s.air_areas = [{air_area_id: 'aa-cedar', name: 'Cedar Basin Air District'}, {air_area_id: 'aa-north', name: 'North Shore Air District'}];
  s.monitors = [{monitor_id: 'mon-cedar', name: 'Cedar Basin - Ranger Station', air_area_id: 'aa-cedar'},
    {monitor_id: 'mon-north', name: 'North Shore - Marina', air_area_id: 'aa-north'}];
  s.places = [place('pl-camp-cedar', 'Cedar Basin Campground', 'campground', 38.910, -120.040, 1900, LA, 'z-cedar', {air_area_id: 'aa-cedar', monitor_id: 'mon-cedar'}),
    place('pl-camp-north', 'North Shore Campground', 'campground', 39.240, -120.030, 1910, LA, 'z-north', {air_area_id: 'aa-north', monitor_id: 'mon-north'}),
    place('pl-trailhead', 'North Shore Trailhead', 'park', 39.250, -120.050, 1950, LA, 'z-north', {air_area_id: 'aa-north', monitor_id: 'mon-north'}),
    place('pl-home-oak', 'Oak Hollow', 'city', 38.580, -121.490, 9, LA, 'z-cedar', {station_id: 'st-cedar-rs'})];
  s.saved_places = [{saved_place_id: 'sp-1', place_id: 'pl-camp-cedar', label: 'Campsite', created_at: '2027-09-20T20:00:00-07:00'},
    {saved_place_id: 'sp-2', place_id: 'pl-home-oak', label: 'Home', created_at: '2027-09-20T20:00:00-07:00'}];
  const now = Date.parse('2027-10-04T08:00:00-07:00'), start = Date.parse('2027-10-03T08:00:00-07:00');
  s.places[0].station_id = 'st-cedar-rs';
  s.observations.push(...stationObs(rand, 'st-cedar-rs', LA, now, 48, 16));
  for (const iso of ['2027-10-04T05:00:00-07:00', '2027-10-05T05:00:00-07:00', '2027-10-06T05:00:00-07:00']) {
    const iss = issuanceAt(rand, 'fc-gl-cedar-' + iso.slice(5, 10).replace('-', ''), 'gustline', 'z-cedar', LA, Date.parse(iso), 48, {mean: 17, amp: 8, wind: 9}, 2);
    if (Date.parse(iso) <= now) s.issuances.push(iss); else events.push(ev(render(Date.parse(iso) + 2 * 60e3, LA), 'weather.forecast_issued', iss));
  }
  for (const mon of ['mon-cedar', 'mon-north']) {
    for (let i = 0; i < 120; i++) {
      const t = start + i * H, day = i / 24;
      // Smoke reaches the basin from the evening of Oct 7 and clears on Oct 9.
      const smoke = mon === 'mon-cedar' && t >= Date.parse('2027-10-07T18:00:00-07:00') ? 45 + 30 * Math.sin(Math.min(1, (t - Date.parse('2027-10-07T18:00:00-07:00')) / (18 * H)) * Math.PI / 2) : 0;
      const o = {observation_id: `ao-${mon.slice(4)}-${i}`, monitor_id: mon, observed_at: render(t, LA),
        pm25_ugm3: round(6 + rand() * 5 + smoke), o3_ppb: round(22 + 10 * Math.sin((+render(t, LA).slice(11, 13) - 9) / 24 * 2 * Math.PI) + rand() * 3)};
      if (t <= now) s.air_observations.push(o); else events.push(ev(render(t + 5 * 60e3, LA), 'air.observation_recorded', o));
      void day;
    }
  }
  const cat = (area, date) => area === 'aa-cedar' && (date === '2027-10-08') ? 'unhealthy_for_sensitive_groups' : area === 'aa-cedar' && date === '2027-10-09' ? 'moderate' : 'good';
  for (let d = 0; d < 5; d++) {
    const issued = Date.parse('2027-10-03T13:30:00-07:00') + d * 24 * H, firstDate = render(issued, LA).slice(0, 10);
    for (const area of ['aa-cedar', 'aa-north']) {
      const days = [0, 1, 2].map(k => addDays(firstDate, k + 1)).map(date => ({date, aqi_category: cat(area, date), dominant_pollutant: 'pm25'}));
      const iss = {issuance_id: `af-${area.slice(3)}-${firstDate}`, air_area_id: area, issued_at: render(issued, LA), days,
        narrative: area === 'aa-cedar' ? 'Smoke from a fire to the south may settle in the basin late in the week.' : 'Good air quality expected.'};
      if (issued <= now) s.air_issuances.push(iss); else events.push(ev(render(issued + 30 * 60e3, LA), 'air.forecast_issued', iss));
    }
  }
  const smoke = {issuer: 'Cedar Basin Air District', event: 'smoke_advisory', severity: 'moderate', areas: {air_area_ids: ['aa-cedar']},
    instruction: 'People with asthma or heart disease should limit time outdoors.'};
  events.push(ev('2027-10-04T14:00:00-07:00', 'alert.published', alertMsg('aqa-cedar-smoke', 1, 'alert', '2027-10-04T14:00:00-07:00', {
    ...smoke, onset: '2027-10-08T00:00:00-07:00', expires: '2027-10-10T00:00:00-07:00', headline: 'Smoke advisory for Cedar Basin, Oct 8-9'})));
  events.push(ev('2027-10-06T09:00:00-07:00', 'alert.published', alertMsg('aqa-cedar-smoke', 2, 'update', '2027-10-06T09:00:00-07:00', {
    ...smoke, onset: '2027-10-07T18:00:00-07:00', expires: '2027-10-11T00:00:00-07:00', headline: 'Smoke advisory extended through Sunday'})));
  events.push(ev('2027-10-08T07:30:00-07:00', 'alert.published', alertMsg('aqa-cedar-smoke', 3, 'cancel', '2027-10-08T07:30:00-07:00', {
    ...smoke, onset: '2027-10-07T18:00:00-07:00', expires: '2027-10-11T00:00:00-07:00', headline: 'Smoke advisory cancelled after a wind shift'})));
  s.rules = [rule('rule-1', 'sp-1', 'observation_threshold', {metric: 'aqi', comparator: 'gte', threshold: 101,
      window: {type: 'absolute', from: '2027-10-08T00:00:00-07:00', to: '2027-10-10T00:00:00-07:00'}, created_at: '2027-09-20T20:05:00-07:00'}),
    rule('rule-2', 'sp-1', 'forecast_threshold', {metric: 'aqi_forecast_category', comparator: 'gte', threshold: 3, look_ahead_hours: 72,
      quiet_hours: {start: '21:00', end: '07:00'}, created_at: '2027-09-20T20:06:00-07:00'})];
  return {seed: s, now: render(now, LA), binding: {people: [{person_id: 'person-marcus', name: 'Marcus Webb'}],
    accounts: [{app_id: 'gustline', account_id: 'gustline-marcus', owner_person_id: 'person-marcus'}], objects: {gustline: ['pl-camp-cedar', 'pl-camp-north', 'pl-trailhead', 'pl-home-oak']}},
    events: sortEvents(events)};
}

// (C) Commuter week: two issuances a day for seven days, heat and wind advisories, a severe thunderstorm warning.
function commuterPack() {
  eventSeq = 0;
  const rand = prng(SEED + 3), CHI = 'America/Chicago', s = base('gustline-priya', 'person-priya', CHI), events = [];
  s.settings.units = 'metric';
  s.zones = [{zone_id: 'z-metro', name: 'Lakeport Metro', time_zone: CHI}, {zone_id: 'z-maple', name: 'Maple Grove', time_zone: CHI}];
  s.air_areas = [{air_area_id: 'aa-metro', name: 'Lakeport Air Quality District'}];
  s.monitors = [{monitor_id: 'mon-metro', name: 'Lakeport - Elm Street', air_area_id: 'aa-metro'}];
  s.stations = [{station_id: 'st-metro', name: 'Lakeport Airport', zone_id: 'z-metro'}];
  s.places = [place('pl-home-ash', 'Ashby (home)', 'address', 41.880, -87.680, 180, CHI, 'z-metro', {station_id: 'st-metro'}),
    place('pl-work-loop', 'Harbor Office Park', 'address', 41.882, -87.630, 182, CHI, 'z-metro', {station_id: 'st-metro'}),
    place('pl-school-elm', 'Elm Street School', 'venue', 41.900, -87.660, 181, CHI, 'z-metro', {station_id: 'st-metro', air_area_id: 'aa-metro', monitor_id: 'mon-metro'}),
    place('pl-gym', 'Lakeside Fitness', 'venue', 41.890, -87.620, 179, CHI, 'z-metro', {station_id: 'st-metro', air_area_id: 'aa-metro', monitor_id: 'mon-metro'}),
    place('pl-maple-gran', 'Maple Grove (grandparents)', 'address', 41.790, -88.010, 215, CHI, 'z-maple')];
  s.saved_places = [{saved_place_id: 'sp-1', place_id: 'pl-home-ash', label: 'Home', created_at: '2027-06-01T08:00:00-05:00'},
    {saved_place_id: 'sp-2', place_id: 'pl-work-loop', label: 'Work', created_at: '2027-06-01T08:00:00-05:00'},
    {saved_place_id: 'sp-3', place_id: 'pl-school-elm', label: 'School', created_at: '2027-06-01T08:00:00-05:00'}];
  const now = Date.parse('2027-07-12T06:00:00-05:00');
  for (let i = 71; i >= 0; i--) {
    const t = now - i * H, hour = +render(t, CHI).slice(11, 13);
    s.air_observations.push({observation_id: 'ao-metro-' + (71 - i), monitor_id: 'mon-metro', observed_at: render(t, CHI),
      pm25_ugm3: round(8 + rand() * 6), o3_ppb: round(30 + 20 * Math.sin((hour - 9) / 24 * 2 * Math.PI) + rand() * 4)});
  }
  for (let k = 0; k < 7; k++) {
    const issued = Date.parse('2027-07-11T17:00:00-05:00') + k * 24 * H;
    const iss = issuanceAt(rand, 'fc-gl-maple-' + render(issued, CHI).slice(5, 10).replace('-', ''), 'gustline', 'z-maple', CHI, issued, 24, {mean: 28, amp: 7, wind: 9}, 1);
    if (issued <= now) s.issuances.push(iss); else events.push(ev(render(issued + 3 * 60e3, CHI), 'weather.forecast_issued', iss));
  }
  for (let k = 0; k < 14; k++) {
    const issued = Date.parse('2027-07-11T17:00:00-05:00') + k * 12 * H, dayIndex = Math.floor(k / 2);
    const heat = dayIndex >= 1 && dayIndex <= 3 ? 6 : 0, windy = dayIndex === 4 ? 18 : 0;
    const iss = issuanceAt(rand, `fc-gl-${render(issued, CHI).slice(0, 13).replace(/[-T:]/g, '')}`, 'gustline', 'z-metro', CHI, issued, 48,
      {mean: 27 + heat, amp: 6, wind: 11, windPeak: windy ? [6, 20, windy] : null, storm: dayIndex === 4 ? (h => (h >= 21 ? 60 : 10)) : null}, 2);
    if (issued <= now) s.issuances.push(iss); else events.push(ev(render(issued + 2 * 60e3, CHI), 'weather.forecast_issued', iss));
  }
  const office = 'Lakeport Weather Office';
  events.push(ev('2027-07-12T15:00:00-05:00', 'alert.published', alertMsg('hz-metro', 1, 'alert', '2027-07-12T15:00:00-05:00', {issuer: office,
    event: 'heat_advisory', severity: 'moderate', areas: {zone_ids: ['z-metro']}, onset: '2027-07-13T12:00:00-05:00', expires: '2027-07-15T20:00:00-05:00',
    headline: 'Heat Advisory Tuesday through Thursday', instruction: 'Check on older relatives and avoid strenuous activity in the afternoon.'})));
  events.push(ev('2027-07-15T16:00:00-05:00', 'alert.published', alertMsg('wa-metro', 1, 'alert', '2027-07-15T16:00:00-05:00', {issuer: office,
    event: 'wind_advisory', severity: 'minor', areas: {zone_ids: ['z-metro']}, onset: '2027-07-16T07:00:00-05:00', expires: '2027-07-16T19:00:00-05:00',
    headline: 'Wind Advisory Friday', instruction: 'Secure outdoor objects; cycling will be difficult.'})));
  events.push(ev('2027-07-16T22:30:00-05:00', 'alert.published', alertMsg('sv-metro', 1, 'alert', '2027-07-16T22:30:00-05:00', {issuer: office,
    event: 'severe_thunderstorm_warning', severity: 'severe', urgency: 'immediate', certainty: 'observed', areas: {zone_ids: ['z-metro']},
    onset: '2027-07-16T22:30:00-05:00', expires: '2027-07-16T23:30:00-05:00', headline: 'Severe Thunderstorm Warning until 11:30 PM',
    instruction: 'Move indoors away from windows.'})));
  const quiet = {start: '22:00', end: '06:30'};
  s.rules = [rule('rule-1', 'sp-2', 'forecast_threshold', {metric: 'gust_kph', comparator: 'gte', threshold: 40, look_ahead_hours: 24,
      window: {type: 'recurring', days: [1, 2, 3, 4, 5], start: '07:00', end: '09:00'}, quiet_hours: quiet, created_at: '2027-06-01T08:10:00-05:00'}),
    rule('rule-2', 'sp-3', 'forecast_threshold', {metric: 'feels_like_c', comparator: 'gte', threshold: 34, look_ahead_hours: 24,
      window: {type: 'recurring', days: [1, 2, 3, 4, 5], start: '15:00', end: '18:00'}, quiet_hours: quiet, created_at: '2027-06-01T08:11:00-05:00'}),
    rule('rule-3', 'sp-1', 'official_alert', {alert_events: ['heat_advisory', 'excessive_heat_warning'], quiet_hours: quiet, created_at: '2027-06-01T08:12:00-05:00'}),
    rule('rule-4', 'sp-1', 'official_alert', {alert_events: ['severe_thunderstorm_watch', 'severe_thunderstorm_warning', 'wind_advisory'],
      quiet_hours: quiet, severe_override: true, created_at: '2027-06-01T08:13:00-05:00'})];
  // Six notifications from the previous week, already delivered or read.
  const { notificationId } = require('../src/common.cjs');
  const past = [['rule-1', '2027-07-05T07:00:00-05:00', 'Gust 44.2 kph forecast at Work'], ['rule-1', '2027-07-07T07:00:00-05:00', 'Gust 41.0 kph forecast at Work'],
    ['rule-2', '2027-07-06T15:00:00-05:00', 'Feels-like temperature 35.1°C forecast at School'], ['rule-2', '2027-07-07T15:00:00-05:00', 'Feels-like temperature 34.4°C forecast at School'],
    ['rule-2', '2027-07-08T15:00:00-05:00', 'Feels-like temperature 36.0°C forecast at School'], ['rule-1', '2027-07-09T07:00:00-05:00', 'Gust 47.5 kph forecast at Work']];
  s.notifications = past.map(([ruleId, occ, title], i) => {
    const key = `${ruleId}|${occ}|met`, created = render(Date.parse(occ) - 13 * H, CHI);
    return {notification_id: notificationId(key), rule_id: ruleId, trigger_key: key, phase: 'met', source: {kind: 'issuance', id: 'fc-past-' + i, version: null},
      created_at: created, release_at: null, delivery: 'mail', status: 'delivered', title, body: title + '. Generated history.', time: created,
      recipient_person_id: 'person-priya', outcome: {status: 'committed', code: null, stop_run: false, router_event_id: 'router-past-' + i, recorded_at: created},
      acknowledged_at: i % 2 ? render(Date.parse(created) + 2 * H, CHI) : null};
  });
  return {seed: s, now: render(now, CHI), binding: {people: [{person_id: 'person-priya', name: 'Priya Nair'}],
    accounts: [{app_id: 'gustline', account_id: 'gustline-priya', owner_person_id: 'person-priya'}], objects: {gustline: ['pl-home-ash', 'pl-work-loop', 'pl-school-elm', 'pl-gym', 'pl-maple-gran']}},
    events: sortEvents(events)};
}

function packs() {
  const out = {};
  for (const [name, make] of [['desert-storm', desertPack], ['smoke-week', smokePack], ['commuter-week', commuterPack]]) {
    const p = make();
    out[`examples/packs/${name}/seed.json`] = p.seed;
    out[`examples/packs/${name}/binding.json`] = p.binding;
    out[`examples/packs/${name}/events.json`] = {virtual_now: p.now, events: p.events};
  }
  return out;
}

function build({check = false} = {}) {
  const outputs = {'fixtures/minimal.json': minimal(), ...packs()};
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
