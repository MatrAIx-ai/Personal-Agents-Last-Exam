'use strict';
// NOAA solar position algorithm (public domain, NOAA Global Monitoring Laboratory solar calculator).
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;

// Minutes after 00:00 UTC on `date` when the sun's centre crosses `zenith` degrees; null if it never does.
function event(date, lat, lon, zenith, rising) {
  const [y, m, d] = date.split('-').map(Number);
  const jd = Date.UTC(y, m - 1, d) / 86400000 + 2440587.5 + 0.5; // Julian day at 12:00 UTC
  const t = (jd - 2451545.0) / 36525;
  const l0 = (280.46646 + t * (36000.76983 + 0.0003032 * t)) % 360;
  const mAnom = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c = Math.sin(rad(mAnom)) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(rad(2 * mAnom)) * (0.019993 - 0.000101 * t) + Math.sin(rad(3 * mAnom)) * 0.000289;
  const omega = 125.04 - 1934.136 * t, lambda = l0 + c - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(rad(omega));
  const decl = deg(Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lambda))));
  const yv = Math.tan(rad(eps / 2)) ** 2;
  const eqTime = 4 * deg(yv * Math.sin(2 * rad(l0)) - 2 * e * Math.sin(rad(mAnom)) +
    4 * e * yv * Math.sin(rad(mAnom)) * Math.cos(2 * rad(l0)) - 0.5 * yv * yv * Math.sin(4 * rad(l0)) -
    1.25 * e * e * Math.sin(2 * rad(mAnom)));
  const cosH = Math.cos(rad(zenith)) / (Math.cos(rad(lat)) * Math.cos(rad(decl))) - Math.tan(rad(lat)) * Math.tan(rad(decl));
  if (cosH < -1 || cosH > 1) return null;
  const ha = deg(Math.acos(cosH)) * (rising ? 1 : -1);
  return 720 - 4 * (lon + ha) - eqTime;
}

// Sunrise, sunset and civil twilight as instants (ms) for the local calendar date of a place.
function day(date, lat, lon) {
  const base = Date.parse(date + 'T00:00:00Z');
  const at = (zenith, rising) => {
    const min = event(date, lat, lon, zenith, rising);
    return min === null ? null : base + Math.round(min * 60) * 1000;
  };
  return {civil_dawn: at(96, true), sunrise: at(90.833, true), sunset: at(90.833, false), civil_dusk: at(96, false)};
}

module.exports = {day};
