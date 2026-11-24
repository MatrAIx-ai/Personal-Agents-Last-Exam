'use strict';
// Builders for events used by the business tests.
const {render} = require('../src/time.cjs');
const H = 3600e3;
let seq = 0;

// A forecast issuance with `hours` hourly periods starting one hour after issue; `gust(t)` sets each gust.
function issuance({id, provider = 'gustline', zone = 'z-cedar', tz = 'America/Los_Angeles', issued, hours = 72, gust = () => 20, precip = () => 10, temp = () => 18}) {
  const start = Date.parse(issued) + H, hourly = [];
  for (let i = 0; i < hours; i++) {
    const t = start + i * H;
    hourly.push({start: render(t, tz), temp_c: temp(t), wind_kph: 12, gust_kph: gust(t), precip_prob_pct: precip(t)});
  }
  return {issuance_id: id, provider, zone_id: zone, issued_at: render(Date.parse(issued), tz), valid_from: render(start, tz),
    valid_to: render(start + hours * H, tz), hourly, daily: [{date: render(start, tz).slice(0, 10), high_c: 22, low_c: 12, precip_prob_pct: 30, headline: 'Breezy'}], products: []};
}
const forecastEvent = (at, payload) => ({event_id: 'ev-' + (++seq), at, operation: 'weather.forecast_issued', payload});
const airEvent = (at, observedAt, pm25, extra = {}) => ({event_id: 'ev-' + (++seq), at, operation: 'air.observation_recorded',
  payload: {observation_id: 'ao-' + seq, monitor_id: 'mon-cedar', observed_at: observedAt, pm25_ugm3: pm25, ...extra}});
const alertEvent = (at, payload) => ({event_id: 'ev-' + (++seq), at, operation: 'alert.published', payload});
const alert = (fields) => ({alert_id: 'al-1', version: 1, msg_type: 'alert', issuer: 'Cedar Basin Weather Office',
  event: 'flood_watch', severity: 'moderate', urgency: 'expected', certainty: 'likely', areas: {zone_ids: ['z-cedar']},
  onset: '2027-10-08T12:00:00-07:00', expires: '2027-10-09T12:00:00-07:00', headline: 'Flood watch for Cedar Basin',
  ...((fields.version || 1) > 1 ? {references: [{alert_id: fields.alert_id || 'al-1', version: (fields.version || 1) - 1}]} : {}), ...fields});
const deliveryEvent = (at, notificationId, status, code = null, extra = {}) => ({event_id: 'ev-' + (++seq), at,
  operation: 'notification.delivery_recorded', payload: {notification_id: notificationId, status, code, router_event_id: status === 'committed' ? 'router-abc' : null, ...extra}});

module.exports = {issuance, forecastEvent, airEvent, alertEvent, alert, deliveryEvent};
