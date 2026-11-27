'use strict';
// Rule evaluation. Runs only inside business event handlers ("now" is the event's `at`), never on reads
// or clock movement. Each notification is identified by its trigger key.
const {log, notificationId, effectiveStatus} = require('./common.cjs');
const {parts, instantOf, render, windowDate, quietRelease, ms, addDays} = require('./time.cjs');
const {METRICS, SEVERITIES} = require('./catalog.cjs');
const aqi = require('./aqi.cjs');
const {affects} = require('./reads.cjs');

const LABELS = {temp_max_c: ['High temperature', '°C'], temp_min_c: ['Low temperature', '°C'], temp_c: ['Temperature', '°C'],
  feels_like_c: ['Feels-like temperature', '°C'], precip_prob_pct: ['Chance of precipitation', '%'], precip_mm: ['Precipitation', ' mm'],
  thunder_prob_pct: ['Chance of thunder', '%'], gust_kph: ['Gust', ' kph'], uv_index: ['UV index', ''], aqi: ['AQI', ''],
  aqi_forecast_category: ['AQI forecast category', '']};
const CATEGORY_TEXT = {good: 'Good', moderate: 'Moderate', unhealthy_for_sensitive_groups: 'Unhealthy for Sensitive Groups',
  unhealthy: 'Unhealthy', very_unhealthy: 'Very Unhealthy', hazardous: 'Hazardous'};

const human = (instant, zone) => new Intl.DateTimeFormat('en-US', {timeZone: zone, weekday: 'short', month: 'short',
  day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short'}).format(new Date(instant));
// Lower-case a label for use mid-sentence, keeping acronyms such as AQI and UV.
const lower = label => (/^[A-Z]{2,}\b/.test(label) ? label : label[0].toLowerCase() + label.slice(1));
const compare = (rule, value) => typeof value === 'number' && (rule.comparator === 'gte' ? value >= rule.threshold : value <= rule.threshold);
const thresholdText = rule => rule.metric === 'aqi_forecast_category'
  ? `${CATEGORY_TEXT[aqi.CATEGORIES[rule.threshold - 1]]} or ${rule.comparator === 'gte' ? 'worse' : 'better'}`
  : `${lower(LABELS[rule.metric][0])} ${rule.threshold}${LABELS[rule.metric][1]} or ${rule.comparator === 'gte' ? 'higher' : 'lower'}`;
function windowText(rule) {
  const w = rule.window;
  if (!w) return '';
  if (w.type === 'absolute') return `, ${w.from} to ${w.to}`;
  const days = w.days.length === 5 && [1, 2, 3, 4, 5].every(d => w.days.includes(d)) ? 'weekdays'
    : w.days.map(d => ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d]).join(', ');
  return `, ${days} ${w.start}-${w.end}`;
}

// The window occurrence that contains an instant, as a stable key; null when outside the window.
function occurrence(rule, zone, instant) {
  const w = rule.window;
  if (!w) return parts(instant, zone).date;
  if (w.type === 'absolute') return instant >= ms(w.from) && instant < ms(w.to) ? w.from : null;
  const startDate = windowDate(instant, zone, w.start, w.end);
  if (!startDate) return null;
  const start = instantOf(startDate, w.start, zone);
  return w.days.includes(parts(start, zone).weekday) ? render(start, zone) : null;
}

function placeFor(data, rule) {
  const saved = data.saved_places.find(s => s.saved_place_id === rule.saved_place_id);
  return saved && {saved, place: data.places.find(p => p.place_id === saved.place_id)};
}

function withdrawHeld(data, predicate, now) {
  for (const n of data.notifications) {
    if (n.status === 'held_quiet_hours' && Date.parse(now) < Date.parse(n.release_at) && predicate(n)) n.status = 'withdrawn';
  }
}

function notify(ctx, data, rule, {key, phase, source, title, body, severe = false}) {
  if (data.notifications.some(n => n.trigger_key === key)) return null;
  const now = ctx.virtual_now, zone = data.settings.time_zone;
  let status = 'in_app', release = null;
  if (rule.delivery === 'mail') {
    release = quietRelease(ms(now), zone, rule.quiet_hours);
    if (release !== null && severe && rule.severe_override) release = null;
    status = release === null ? 'pending_delivery' : 'held_quiet_hours';
  }
  const n = {notification_id: notificationId(key), rule_id: rule.rule_id, trigger_key: key, phase, source,
    created_at: render(now, zone), release_at: release === null ? null : render(release, zone), delivery: rule.delivery, status,
    title: title.slice(0, 200), body: body.slice(0, 2000), time: render(release === null ? ms(now) : release, zone),
    recipient_person_id: data.owner_person_id, outcome: null, acknowledged_at: null};
  data.notifications.push(n);
  log(ctx, 'gustline.notification_created', {rule_id: rule.rule_id, notification_id: n.notification_id, status});
  return n;
}

// Threshold rules, per window occurrence. The person hears "met" once; repeated exceedances add nothing.
// When the condition stops being met: a met notice still held by quiet hours is withdrawn (the person never
// heard it, so no "cleared" follows); a met notice already released is followed by "cleared" if
// notify_on_clear. If the condition returns, a held "cleared" is withdrawn, and a new "met" is created only
// when the person last heard "cleared" or never heard "met". Repeats use keys met|2, cleared|2, ...
function settle(ctx, data, rule, place, met, evaluated, source, describe) {
  const now = ctx.virtual_now, prefix = rule.rule_id + '|';
  const history = occ => data.notifications.filter(n => n.rule_id === rule.rule_id && n.trigger_key.startsWith(prefix + occ + '|'));
  const key = (occ, phase) => { const n = history(occ).filter(x => x.phase === phase).length + 1; return prefix + occ + '|' + phase + (n > 1 ? '|' + n : ''); };
  const heard = n => n.status !== 'withdrawn' && effectiveStatus(n, now) !== 'held_quiet_hours';
  const held = n => n.status === 'held_quiet_hours' && effectiveStatus(n, now) === 'held_quiet_hours';
  for (const occ of new Set([...met.keys(), ...evaluated])) {
    const past = history(occ), lastHeard = past.filter(heard).at(-1), pendingMet = past.find(n => n.phase === 'met' && held(n));
    if (met.has(occ)) {
      for (const n of past) if (n.phase === 'cleared' && held(n)) n.status = 'withdrawn';
      if (pendingMet || (lastHeard && lastHeard.phase === 'met')) continue;
      notify(ctx, data, rule, {key: key(occ, 'met'), phase: 'met', source, ...describe(met.get(occ), true)});
    } else if (pendingMet) {
      pendingMet.status = 'withdrawn';
    } else if (lastHeard && lastHeard.phase === 'met' && rule.notify_on_clear) {
      notify(ctx, data, rule, {key: key(occ, 'cleared'), phase: 'cleared', source, ...describe({occ}, false)});
    }
  }
}

function forecastRules(ctx, data, issuance) {
  const at = ms(ctx.virtual_now);
  for (const rule of active(data, 'forecast_threshold')) {
    if (rule.metric === 'aqi_forecast_category' || rule.provider !== issuance.provider) continue;
    const ref = placeFor(data, rule);
    if (!ref || ref.place.zone_id !== issuance.zone_id) continue;
    const end = at + rule.look_ahead_hours * 3600e3, field = METRICS[rule.metric].field, met = new Map(), evaluated = new Set();
    // High and low temperature rules compare each occurrence's warmest or coolest forecast hour, so
    // "high at most X" means the whole period stays at or below X, not that one cool hour exists.
    const extreme = {temp_max_c: Math.max, temp_min_c: Math.min}[rule.metric], peaks = new Map();
    for (const h of issuance.hourly) {
      const t = ms(h.start);
      if (t < at || t >= end) continue;
      const occ = occurrence(rule, ref.place.time_zone, t);
      if (!occ) continue;
      evaluated.add(occ);
      if (extreme) {
        const cur = peaks.get(occ);
        if (typeof h[field] === 'number' && (!cur || extreme(cur.value, h[field]) !== cur.value)) peaks.set(occ, {occ, value: h[field], at: t});
      } else if (compare(rule, h[field]) && !met.has(occ) && (rule.window || met.size === 0)) met.set(occ, {occ, value: h[field], at: t});
    }
    for (const [occ, d] of peaks) if (compare(rule, d.value) && (rule.window || met.size === 0)) met.set(occ, d);
    settle(ctx, data, rule, ref.place, met, evaluated, {kind: 'issuance', id: issuance.issuance_id, version: null}, (d, isMet) => isMet ? {
      title: `${LABELS[rule.metric][0]} ${d.value}${LABELS[rule.metric][1]} forecast at ${ref.saved.label}`,
      body: `The ${issuance.provider} forecast issued ${human(ms(issuance.issued_at), ref.place.time_zone)} shows ${lower(LABELS[rule.metric][0])} ${d.value}${LABELS[rule.metric][1]} at ${human(d.at, ref.place.time_zone)} for ${ref.saved.label} (${ref.place.name}). Your rule: ${thresholdText(rule)} within ${rule.look_ahead_hours} h${windowText(rule)}.`
    } : {
      title: `${LABELS[rule.metric][0]} no longer forecast to reach your limit at ${ref.saved.label}`,
      body: `The ${issuance.provider} forecast issued ${human(ms(issuance.issued_at), ref.place.time_zone)} no longer meets your rule (${thresholdText(rule)}) for ${ref.saved.label}.`
    });
  }
}

function airForecastRules(ctx, data, issuance) {
  const at = ms(ctx.virtual_now);
  for (const rule of active(data, 'forecast_threshold')) {
    if (rule.metric !== 'aqi_forecast_category') continue;
    const ref = placeFor(data, rule);
    if (!ref || ref.place.air_area_id !== issuance.air_area_id) continue;
    const zone = ref.place.time_zone, end = at + rule.look_ahead_hours * 3600e3, met = new Map(), evaluated = new Set();
    for (const day of issuance.days) {
      const dayStart = instantOf(day.date, '00:00', zone), dayEnd = instantOf(addDays(day.date, 1), '00:00', zone);
      if (dayEnd <= at || dayStart >= end) continue;
      // The day's occurrence: its window instance on that date (or the date itself without a window).
      const probe = rule.window && rule.window.type === 'recurring' ? instantOf(day.date, rule.window.start, zone)
        : rule.window && rule.window.type === 'absolute' ? Math.max(dayStart, ms(rule.window.from)) : dayStart;
      const occ = probe < dayEnd ? occurrence(rule, zone, probe) : null;
      if (!occ) continue;
      if (compare(rule, aqi.categoryRank(day.aqi_category)) && !met.has(occ) && (rule.window || met.size === 0)) met.set(occ, {occ, day});
      evaluated.add(occ);
    }
    settle(ctx, data, rule, ref.place, met, evaluated, {kind: 'air_issuance', id: issuance.issuance_id, version: null}, (d, isMet) => isMet ? {
      title: `Air quality forecast ${CATEGORY_TEXT[d.day.aqi_category]} at ${ref.saved.label} on ${d.day.date}`,
      body: `The air-quality forecast issued ${human(ms(issuance.issued_at), zone)} expects ${CATEGORY_TEXT[d.day.aqi_category]} air at ${ref.saved.label} (${ref.place.name}) on ${d.day.date}${d.day.dominant_pollutant ? ' (' + d.day.dominant_pollutant.toUpperCase() + ')' : ''}. Your rule: ${thresholdText(rule)} within ${rule.look_ahead_hours} h${windowText(rule)}.`
    } : {
      title: `Air quality forecast no longer reaches your limit at ${ref.saved.label}`,
      body: `The air-quality forecast issued ${human(ms(issuance.issued_at), zone)} no longer meets your rule (${thresholdText(rule)}) for ${ref.saved.label}.`
    });
  }
}

function observationRules(ctx, data, kind, record) {
  for (const rule of active(data, 'observation_threshold')) {
    const ref = placeFor(data, rule);
    if (!ref) continue;
    const zone = ref.place.time_zone, t = ms(record.observed_at);
    let value, extra = '';
    if (rule.metric === 'aqi') {
      if (kind !== 'air' || ref.place.monitor_id !== record.monitor_id) continue;
      const computed = aqi.compute(data.air_observations.filter(o => o.monitor_id === record.monitor_id), t);
      if (!computed || computed.observation_id !== record.observation_id) continue;
      value = computed.aqi;
      extra = computed.category ? ` (${CATEGORY_TEXT[computed.category]}, ${computed.dominant_pollutant.toUpperCase().replace('PM25', 'PM2.5')})` : '';
    } else {
      if (kind !== 'weather' || ref.place.station_id !== record.station_id) continue;
      value = record[METRICS[rule.metric].field];
    }
    const occ = occurrence(rule, zone, t);
    if (!occ || typeof value !== 'number') continue;
    const met = compare(rule, value) ? new Map([[occ, {value}]]) : new Map();
    const label = rule.metric === 'aqi' ? 'Air quality' : LABELS[rule.metric][0];
    settle(ctx, data, rule, ref.place, met, new Set([occ]),
      {kind: kind === 'air' ? 'air_observation' : 'observation', id: record.observation_id, version: null}, (d, isMet) => isMet ? {
        title: rule.metric === 'aqi' ? `AQI ${d.value} at ${ref.saved.label}` : `${label} ${d.value}${LABELS[rule.metric][1]} at ${ref.saved.label}`,
        body: `${label} at ${ref.saved.label} reached ${rule.metric === 'aqi' ? 'AQI ' + d.value + extra + ' (hourly concentration, not NowCast)' : d.value + LABELS[rule.metric][1]} at ${human(t, zone)}. Your rule: ${thresholdText(rule)}${windowText(rule)}.`
      } : {
        title: `${label} back within your limit at ${ref.saved.label}`,
        body: `${label} at ${ref.saved.label} no longer meets your rule (${thresholdText(rule)}) as of ${human(t, zone)}.`
      });
  }
}

function alertRules(ctx, data, alert) {
  const version = alert.versions[alert.versions.length - 1];
  for (const rule of active(data, 'official_alert')) {
    // A newer version replaces a held notification for an earlier version, even if it no longer matches.
    withdrawHeld(data, n => n.rule_id === rule.rule_id && n.source.kind === 'alert' && n.source.id === alert.alert_id, ctx.virtual_now);
    const ref = placeFor(data, rule);
    if (!ref || !affects(version, ref.place)) continue;
    if (rule.alert_events.length && !rule.alert_events.includes(version.event)) continue;
    if (rule.min_severity && SEVERITIES.indexOf(version.severity) < SEVERITIES.indexOf(rule.min_severity)) continue;
    if (version.msg_type === 'cancel' && !rule.notify_on_clear) continue;
    const zone = ref.place.time_zone;
    notify(ctx, data, rule, {key: `${rule.rule_id}|${alert.alert_id}|${version.version}`, phase: version.msg_type,
      source: {kind: 'alert', id: alert.alert_id, version: version.version},
      severe: ['severe', 'extreme'].includes(version.severity),
      title: (version.msg_type === 'cancel' ? 'Cancelled: ' : version.msg_type === 'update' ? 'Updated: ' : '') + version.headline,
      body: `${version.issuer}: ${version.headline}. In effect ${human(ms(version.onset), zone)} to ${human(ms(version.expires), zone)} for ${ref.saved.label} (${ref.place.name}). Severity ${version.severity}.${version.instruction ? ' ' + version.instruction : ''}${version.event === 'area_closure' ? ' This notice is informational.' : ''}`});
  }
}

const active = (data, kind) => data.rules.filter(r => r.status === 'active' && r.kind === kind)
  .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || (a.rule_id < b.rule_id ? -1 : 1));

module.exports = {forecastRules, airForecastRules, observationRules, alertRules, occurrence, human};
