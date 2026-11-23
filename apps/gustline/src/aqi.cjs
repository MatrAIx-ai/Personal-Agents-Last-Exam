'use strict';
// U.S. EPA AQI breakpoints (Technical Assistance Document for the Reporting of Daily Air Quality,
// 2024 PM2.5 revision). Hourly PM concentrations are used directly: a documented simplification of NowCast.
const TABLE_VERSION = 'epa-2024';
const CATEGORIES = ['good', 'moderate', 'unhealthy_for_sensitive_groups', 'unhealthy', 'very_unhealthy', 'hazardous'];
const INDEX = [[0, 50], [51, 100], [101, 150], [151, 200], [201, 300], [301, 500]];
const BREAKPOINTS = {
  // µg/m³, truncated to 0.1
  pm25: {digits: 1, rows: [[0.0, 9.0], [9.1, 35.4], [35.5, 55.4], [55.5, 125.4], [125.5, 225.4], [225.5, 325.4]]},
  // µg/m³, truncated to an integer
  pm10: {digits: 0, rows: [[0, 54], [55, 154], [155, 254], [255, 354], [355, 424], [425, 604]]},
  // ppm, 8-hour mean, truncated to 0.001; the 8-hour table ends at 0.200 ppm
  o3: {digits: 3, rows: [[0.000, 0.054], [0.055, 0.070], [0.071, 0.085], [0.086, 0.105], [0.106, 0.200]]}
};

const truncate = (value, digits) => Math.floor(value * 10 ** digits + 1e-9) / 10 ** digits;

// AQI for one pollutant; null when the value is outside the table (reported in not_provided).
function index(pollutant, concentration) {
  const table = BREAKPOINTS[pollutant], c = truncate(concentration, table.digits);
  for (let i = 0; i < table.rows.length; i++) {
    const [lo, hi] = table.rows[i];
    if (c >= lo && c <= hi) {
      const [ilo, ihi] = INDEX[i];
      return Math.round((ihi - ilo) / (hi - lo) * (c - lo) + ilo);
    }
  }
  return null;
}

const category = aqi => aqi === null ? null : CATEGORIES[INDEX.findIndex(([lo, hi]) => aqi >= lo && aqi <= hi)];
const categoryRank = name => CATEGORIES.indexOf(name) + 1;

// AQI for the latest monitor observation at or before `at`. O3 uses the 8-hour rolling mean of the
// 8 hourly values ending at that hour; with fewer than 8 consecutive values it is not provided.
function compute(observations, at) {
  const sorted = observations.filter(o => Date.parse(o.observed_at) <= at)
    .sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
  const latest = sorted[sorted.length - 1];
  if (!latest) return null;
  const pollutants = {}, notProvided = [];
  if (typeof latest.pm25_ugm3 === 'number') pollutants.pm25 = {concentration: latest.pm25_ugm3, unit: 'ug/m3', averaging: 'hourly', aqi: index('pm25', latest.pm25_ugm3)};
  else notProvided.push('pm25');
  if (typeof latest.pm10_ugm3 === 'number') pollutants.pm10 = {concentration: latest.pm10_ugm3, unit: 'ug/m3', averaging: 'hourly', aqi: index('pm10', latest.pm10_ugm3)};
  else notProvided.push('pm10');
  const end = Date.parse(latest.observed_at), window = [];
  for (let h = 0; h < 8; h++) {
    const o = sorted.find(x => Date.parse(x.observed_at) === end - h * 3600e3 && typeof x.o3_ppb === 'number');
    if (o) window.push(o.o3_ppb);
  }
  if (window.length === 8) {
    const mean = window.reduce((a, b) => a + b, 0) / 8;
    pollutants.o3 = {concentration: Math.round(mean * 10) / 10, unit: 'ppb', averaging: '8h_rolling', aqi: index('o3', mean / 1000)};
  } else notProvided.push('o3');
  for (const [name, p] of Object.entries(pollutants)) if (p.aqi === null) { delete pollutants[name]; notProvided.push(name); }
  const entries = Object.entries(pollutants);
  const top = entries.reduce((best, cur) => (!best || cur[1].aqi > best[1].aqi ? cur : best), null);
  const aqi = top ? top[1].aqi : null;
  return {observation_id: latest.observation_id, observed_at: latest.observed_at, aqi, category: category(aqi),
    dominant_pollutant: top ? top[0] : null, pollutants, not_provided: notProvided.sort(), aqi_table: TABLE_VERSION};
}

module.exports = {TABLE_VERSION, CATEGORIES, index, category, categoryRank, compute};
