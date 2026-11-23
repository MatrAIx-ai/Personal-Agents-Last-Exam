'use strict';
// Read-only App catalog shipped with the package (App state). Tasks cannot change it.
const CATALOG_VERSION = 'gustline-catalog-1';

const PROVIDERS = {
  gustline: {name: 'Gustline model', schedule: 'every 6 hours'},
  regional_office: {name: 'Regional Weather Office', schedule: '05:00 and 17:00 local'}
};
const DEFAULT_PROVIDER = 'gustline';

// Hourly forecast and observation fields: metric storage units and their US rendering.
const FIELDS = {
  temp_c: {us: 'temp_f', convert: v => Math.round((v * 9 / 5 + 32) * 10) / 10},
  feels_like_c: {us: 'feels_like_f', convert: v => Math.round((v * 9 / 5 + 32) * 10) / 10},
  dew_point_c: {us: 'dew_point_f', convert: v => Math.round((v * 9 / 5 + 32) * 10) / 10},
  precip_prob_pct: {}, thunder_prob_pct: {}, cloud_pct: {}, humidity_pct: {}, wind_dir_deg: {}, uv_index: {},
  precip_mm: {us: 'precip_in', convert: v => Math.round(v / 25.4 * 100) / 100},
  wind_kph: {us: 'wind_mph', convert: v => Math.round(v / 1.609344 * 10) / 10},
  gust_kph: {us: 'gust_mph', convert: v => Math.round(v / 1.609344 * 10) / 10},
  visibility_km: {us: 'visibility_mi', convert: v => Math.round(v / 1.609344 * 10) / 10}
};
const DAILY_FIELDS = {
  high_c: {us: 'high_f', convert: FIELDS.temp_c.convert},
  low_c: {us: 'low_f', convert: FIELDS.temp_c.convert},
  precip_prob_pct: {}, headline: {}, day_text: {}, night_text: {}
};

// Rule metrics: which rule kinds may use them, the data field they read and their valid threshold range.
const METRICS = {
  temp_max_c: {kinds: ['forecast_threshold'], field: 'temp_c', min: -60, max: 60},
  temp_min_c: {kinds: ['forecast_threshold'], field: 'temp_c', min: -60, max: 60},
  temp_c: {kinds: ['observation_threshold'], field: 'temp_c', min: -60, max: 60},
  feels_like_c: {kinds: ['forecast_threshold', 'observation_threshold'], field: 'feels_like_c', min: -70, max: 70},
  precip_prob_pct: {kinds: ['forecast_threshold'], field: 'precip_prob_pct', min: 0, max: 100},
  precip_mm: {kinds: ['forecast_threshold', 'observation_threshold'], field: 'precip_mm', min: 0, max: 500},
  thunder_prob_pct: {kinds: ['forecast_threshold'], field: 'thunder_prob_pct', min: 0, max: 100},
  gust_kph: {kinds: ['forecast_threshold', 'observation_threshold'], field: 'gust_kph', min: 0, max: 400},
  uv_index: {kinds: ['forecast_threshold'], field: 'uv_index', min: 0, max: 20},
  aqi: {kinds: ['observation_threshold'], field: 'aqi', min: 0, max: 500},
  aqi_forecast_category: {kinds: ['forecast_threshold'], field: 'aqi_category', min: 1, max: 6}
};

const ALERT_EVENTS = ['flood_watch', 'flood_warning', 'severe_thunderstorm_watch', 'severe_thunderstorm_warning',
  'heat_advisory', 'excessive_heat_warning', 'wind_advisory', 'winter_storm_warning', 'red_flag_warning',
  'air_quality_alert', 'smoke_advisory', 'area_closure'];
// area_closure is informational: it never changes bookings in another App.
const INFORMATIONAL_EVENTS = ['area_closure'];
const SEVERITIES = ['minor', 'moderate', 'severe', 'extreme'];

const LIMITS = {saved_places: 20, rules: 25, hourly_hours: 72, daily_days: 7, stale_air_hours: 3, look_ahead_max: 72};

module.exports = {CATALOG_VERSION, PROVIDERS, DEFAULT_PROVIDER, FIELDS, DAILY_FIELDS, METRICS, ALERT_EVENTS,
  INFORMATIONAL_EVENTS, SEVERITIES, LIMITS};
