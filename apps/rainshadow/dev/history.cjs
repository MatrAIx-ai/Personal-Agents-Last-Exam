'use strict';
// Authoring-time data for dev/build-fixture.cjs, never run by the App or the host.
//
// The long-range part of the fixture's scripted history: from New Year's Day 2025 to the
// week before the three detailed days that close the fixture (18 to 20 November
// 2026). It is synthetic like the rest: one account's use of the app over two winters and
// two summers, written as a plain timeline and replayed through the App's own business
// functions, so that every notice, watch evaluation and activity row follows the App rules.
//
// What the timeline holds:
//   - the account: places saved and removed with the seasons, an alert rule paused each
//     spring and resumed each autumn, and four preference changes;
//   - 27 watches with the thresholds this person keeps coming back to (drives over the pass,
//     Saturday hikes at the lake, her mother's walks in smoke season, one harbor weekend),
//     each with the forecast issuances it was evaluated against and one observation;
//   - 46 alert threads through the seasons, some updated or cancelled, some acknowledged.
//
// Archive forecast numbers come from the closed-form toy model below (no random numbers, no
// observed weather). An archive weather issuance has 24 hourly and 5 daily rows; the three
// detailed days keep 48 and 7. Archive records carry dated IDs (iss-pfo-wren-20250523-15).
const { HOUR, DAY, isoAt, localDate, localMinutes, localToInstant, addDays } = require('../src/util.cjs');

const A = 'America/Denver', B = 'America/Los_Angeles';
const at = (date, hhmm, tz) => localToInstant(date, hhmm, tz);
const iso = (date, hhmm, tz) => isoAt(at(date, hhmm, tz), tz);
const round5 = v => Math.round(v / 5) * 5;
const round1 = v => Math.round(v * 10) / 10;
const bump = (t, center, widthHours) => Math.exp(-((((t - center) / HOUR) / widthHours) ** 2));
const compact = date => date.replace(/-/g, '');

// ---- archive forecast model ------------------------------------------------------------
// Seasonal swing in degrees C per place, written so that it is zero in late November: the
// archive then meets the model of the three detailed days without a jump.
const SWING = { wren: 9, quill: 10, cinder: 9, brindle: 3.5, marrow: 3.5, tamsin: 7 };
function dayOfYear(date) {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / DAY) + 1;
}
const seasonal = (key, date) => SWING[key] * (Math.cos((2 * Math.PI * (dayOfYear(date) - 200)) / 365) + 0.5346);

// One weather system per issuance: `center` (instant) and `width` (hours) place it, `pop` is
// the precipitation probability it adds at its peak, `thunder` the share of that probability
// that is thunder, `wind` and `gust` what it adds in km/h, `cool` how far it lowers the
// temperature and `warm` a flat shift for the whole issuance. Without `center` the weather is calm.
function archSample(P, key, t, sys) {
  const p = P[key], date = localDate(t, p.tz), hour = localMinutes(t, p.tz) / 60, day = Math.cos((2 * Math.PI * (hour - 15)) / 24);
  const s = sys.center === undefined ? 0 : bump(t, sys.center, sys.width ?? 4);
  const pop = Math.min(100, round5((sys.base ?? 5) + (sys.pop ?? 0) * s));
  const thunder = round5(pop * (pop >= 30 ? sys.thunder ?? 0.1 : 0.1));
  const wind = Math.round(p.wind + 4 * day + (sys.wind ?? 0) * s);
  const temp = round1(p.base + seasonal(key, date) + (sys.warm ?? 0) + p.amp * day - (sys.cool ?? 3) * s);
  // Precipitation falls as snow at 1 degree C or below and as sleet up to 2.5.
  const wet = temp <= 1 ? 'snow' : temp <= 2.5 ? 'sleet' : null;
  const daytime = hour >= 7 && hour < 18;
  const sky = thunder >= 30 ? 'thunderstorm' : pop >= 70 ? wet ?? 'heavy_rain' : pop >= 50 ? wet ?? 'rain' : pop >= 30 ? 'mostly_cloudy' : pop >= 15 ? 'partly_cloudy' : daytime ? 'mostly_clear' : 'clear';
  return {
    start: isoAt(t, p.tz), temp_c: temp, apparent_temp_c: round1(temp - (wind > 20 ? (wind - 20) * 0.12 : 0) - (pop >= 60 ? 0.5 : 0)), pop,
    precip_mm: pop >= 30 ? round1((pop - 20) * 0.03) : 0, wind_kph: wind, gust_kph: Math.round(wind * 1.6 + (sys.gust ?? 0) * s), thunder_prob: thunder, sky,
  };
}

function archDaily(P, key, date, sys) {
  const p = P[key], start = at(date, '00:00', p.tz), hours = [];
  for (let h = 0; h < 30; h++) hours.push(archSample(P, key, start + h * HOUR, sys));
  const dayHours = hours.slice(0, 24), temps = dayHours.map(r => r.temp_c);
  const popDay = Math.max(...hours.slice(6, 18).map(r => r.pop)), popNight = Math.max(...hours.slice(18, 30).map(r => r.pop));
  const top = Math.max(popDay, popNight), storms = hours.slice(6, 30).some(r => r.thunder_prob >= 30), windy = Math.max(...dayHours.map(r => r.wind_kph)) >= 30;
  const high = Math.max(...temps), low = Math.min(...temps);
  // Snow in the wording when the hours that carry the precipitation are cold enough for it.
  const wet = hours.slice(6, 30).filter(r => r.pop >= 30), snow = wet.length ? wet.reduce((sum, r) => sum + r.temp_c, 0) / wet.length <= 2.5 : high <= 2;
  let headline, summary;
  if (storms && top >= 60) { headline = popDay >= 30 ? 'Strong storms, ' + popDay + '%' : 'Storms at night, ' + popNight + '%'; summary = popNight > popDay ? 'Storms develop late in the day.' : 'Storms through the day.'; }
  else if (top >= 50) { headline = (snow ? 'Snow likely, ' : 'Rain likely, ') + top + '%'; summary = popNight > popDay ? (snow ? 'Snow arrives in the evening.' : 'Rain arrives in the evening.') : snow ? 'Periods of snow.' : 'Periods of rain.'; }
  else if (top >= 30) { headline = (snow ? 'Chance of snow showers, ' : 'Chance of showers, ') + top + '%'; summary = snow ? 'A few snow showers are possible.' : 'A few showers are possible.'; }
  else if (high <= 3) { headline = 'Cold and dry'; summary = windy ? 'Dry, cold and windy.' : 'Dry and cold with light winds.'; }
  else if (high >= 30) { headline = 'Hot and dry'; summary = windy ? 'Hot, dry and breezy.' : 'Hot with light winds.'; }
  else { headline = top >= 15 ? 'Partly cloudy' : 'Mostly sunny'; summary = windy ? 'Dry and breezy.' : 'Dry with light winds.'; }
  return { date, headline, summary, high_c: high, low_c: low, pop_day: popDay, pop_night: popNight };
}

const SHORT = { 'src-pfo': 'pfo', 'src-skyline': 'sky' };
function archIssuance(P, key, sourceId, date, hhmm, sys) {
  const p = P[key], t0 = at(date, hhmm, p.tz), hourly = [], daily = [];
  for (let h = 0; h < 24; h++) hourly.push(archSample(P, key, t0 + h * HOUR, sys));
  for (let d = 0; d < 5; d++) daily.push(archDaily(P, key, addDays(date, d), sys));
  return { issuance_id: 'iss-' + SHORT[sourceId] + '-' + key + '-' + compact(date) + '-' + hhmm.slice(0, 2), source_id: sourceId, place_id: p.id, issued_at: isoAt(t0, p.tz), hourly, daily };
}
function archAir(P, key, date, values) {
  const p = P[key], t0 = at(date, '10:00', p.tz);
  return {
    issuance_id: 'aq-' + key + '-' + compact(date) + '-10', source_id: 'src-aqb', place_id: p.id, issued_at: isoAt(t0, p.tz),
    daily: values.map((aqi, d) => ({ date: addDays(date, d), aqi, pollutant: aqi > 50 ? 'pm25' : 'ozone' })),
  };
}
function archObservation(P, key, date, hhmm, sys, change = {}) {
  const p = P[key], t = at(date, hhmm, p.tz), r = archSample(P, key, t - (t % HOUR), sys);
  return {
    observation_id: 'ob-' + key + '-' + compact(date) + '-' + hhmm.slice(0, 2), place_id: p.id, source_id: 'src-pfo', observed_at: isoAt(t, p.tz),
    temp_c: round1(r.temp_c + 0.3), wind_kph: r.wind_kph, gust_kph: r.gust_kph, conditions: r.sky, humidity: (p.tz === A ? 36 : 68) + (r.pop >= 50 ? 22 : r.pop >= 30 ? 12 : 4), ...change,
  };
}

// ---- alert wording ---------------------------------------------------------------------
const WORDING = {
  'Winter Weather Advisory': ['winter', 'moderate', 'Snow showers and slick roads are expected over the pass.', 'Slow down and allow extra travel time.'],
  'Winter Storm Warning': ['winter', 'severe', 'Heavy snow and blowing snow will make travel over the pass very difficult.', 'Travel only if you must. Carry chains, warm clothing and food.'],
  'Blizzard Warning': ['winter', 'extreme', 'Heavy snow with gusts over 80 km/h will bring whiteout conditions on the pass.', 'Do not travel. If you are stranded, stay with your vehicle.'],
  'Wind Advisory': ['wind', 'moderate', 'Strong gusts are expected.', 'Secure loose objects and use caution with high-profile vehicles.'],
  'High Wind Warning': ['wind', 'severe', 'Damaging gusts are expected in the high country and over the pass.', 'Avoid travel in high-profile vehicles and watch for falling branches.'],
  'Coastal Flood Advisory': ['flood', 'moderate', 'High tides may flood low roads and parking areas along the bay shore.', 'Do not drive through flooded roads. Move vehicles from low parking areas.'],
  'Flood Watch': ['flood', 'moderate', 'Snowmelt and rain may raise creeks and flood low crossings.', 'Be ready to move to higher ground.'],
  'Flash Flood Warning': ['flood', 'severe', 'Heavy rain is causing rapid rises in creeks and washes.', 'Move to higher ground now. Do not cross flowing water.'],
  'Severe Thunderstorm Watch': ['storm', 'moderate', 'Conditions favor storms with large hail and damaging gusts.', 'Have a way to get warnings and a place to shelter.'],
  'Severe Thunderstorm Warning': ['storm', 'severe', 'A storm with large hail and damaging gusts is moving through the basin.', 'Move indoors and stay away from windows.'],
  'Heat Advisory': ['temperature', 'moderate', 'Afternoon temperatures will be well above normal.', 'Drink water, rest in the shade and check on older neighbors.'],
  'Freeze Warning': ['temperature', 'moderate', 'Temperatures near or below freezing are expected.', 'Protect tender plants and outdoor pipes.'],
  'Cold Weather Advisory': ['temperature', 'minor', 'Very cold air will settle in overnight.', 'Dress in layers and limit time outdoors.'],
  'Red Flag Warning': ['fire', 'severe', 'Dry air and gusty winds will let any fire spread quickly.', 'Avoid anything that can start a fire outdoors.'],
  'Air Quality Alert': ['air_quality', 'moderate', 'Wildfire smoke is expected to reach levels that are unhealthy for sensitive groups.', 'People with heart or lung disease, older adults and children should limit time outdoors.'],
  'Dense Fog Advisory': ['other', 'minor', 'Patchy dense fog may reduce visibility.', 'Use low beams and leave extra following distance.'],
};
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// 'Friday 6 PM', 'Saturday noon', 'Sunday midnight' for a local date and wall time.
function spoken(date, hhmm) {
  const [y, m, d] = date.split('-').map(Number), [h, min] = hhmm.split(':').map(Number);
  const day = WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  if (min === 0 && h === 0) return day + ' midnight';
  if (min === 0 && h === 12) return day + ' noon';
  return day + ' ' + (h % 12 === 0 ? 12 : h % 12) + (min ? ':' + String(min).padStart(2, '0') : '') + (h < 12 ? ' AM' : ' PM');
}

module.exports = function history({ P, step, event, agent, message }) {
  const issue = (key, sourceId, date, hhmm, sys) => event(at(date, hhmm, P[key].tz), P[key].tz, 'forecast.issued', archIssuance(P, key, sourceId, date, hhmm, sys));
  const air = (key, date, values) => event(at(date, '10:00', P[key].tz), P[key].tz, 'forecast.issued', archAir(P, key, date, values));
  const observe = (key, date, hhmm, sys, change) => event(at(date, hhmm, P[key].tz), P[key].tz, 'observation.recorded', archObservation(P, key, date, hhmm, sys, change));
  const me = (date, hhmm, name, args) => agent(at(date, hhmm, A), A, name, args); // the account holder acts on Denver time
  const watchOf = (app, label, start) => {
    const found = app.data.watches.find(w => w.label === label && w.start === start);
    if (!found) throw Error('History: no watch "' + label + '" starting ' + start);
    return found;
  };
  // The scripted outcome of every step is checked while the history is replayed.
  const expect = (date, hhmm, tz, label, start, status) => step(at(date, hhmm, tz) + 1, app => {
    const w = watchOf(app, label, start), actual = w.cancelled_at ? 'cancelled' : w.evaluation.status;
    if (actual !== status) throw Error('History drift: watch "' + label + '" ' + start + ' is ' + actual + ' after ' + date + ' ' + hhmm + ', scripted ' + status);
  });

  // An alert thread: the first message, then updates and at most one cancel, then acknowledgements.
  //   onset / ends: [date, hhmm] in the thread's own time zone.
  function thread(id, tz, [date, hhmm], eventName, zones, onset, ends, more = {}) {
    const [category, severity, description, instruction] = WORDING[eventName];
    const source = more.source ?? (category === 'air_quality' ? 'src-aqb' : 'src-pfo');
    const fields = (name, sev, on, off, extra = {}) => ({
      event: name, severity: sev, urgency: extra.urgency ?? 'expected', certainty: extra.certainty ?? 'likely', onset: iso(on[0], on[1], tz), ends: iso(off[0], off[1], tz),
      headline: extra.headline ?? name + ' from ' + spoken(on[0], on[1]) + ' to ' + spoken(off[0], off[1]), description: extra.description ?? WORDING[name][2], instruction: extra.instruction ?? WORDING[name][3],
    });
    let t = at(date, hhmm, tz), n = 1, name = eventName, sev = more.severity ?? severity, on = onset, off = ends;
    event(t, tz, 'alert.issued', { alert_id: id, source_id: source, category, zone_ids: zones, message: message(id + '-m1', 'alert', t, tz, fields(name, sev, on, off, { ...more, description: more.description ?? description, instruction: more.instruction ?? instruction })) });
    for (const u of more.updates ?? []) {
      t = at(u.at[0], u.at[1], tz); n += 1;
      name = u.event ?? name; sev = u.severity ?? (u.event ? WORDING[u.event][1] : sev); on = u.onset ?? on; off = u.ends ?? off;
      event(t, tz, 'alert.updated', { alert_id: id, message: message(id + '-m' + n, 'update', t, tz, fields(name, sev, on, off, { urgency: u.urgency, certainty: u.certainty, description: u.description, instruction: u.instruction, headline: u.headline ?? (u.event ? name + ' until ' + spoken(off[0], off[1]) : name + ' now lasts until ' + spoken(off[0], off[1])) })) });
    }
    if (more.cancel) {
      t = at(more.cancel.at[0], more.cancel.at[1], tz); n += 1;
      event(t, tz, 'alert.cancelled', { alert_id: id, message: message(id + '-m' + n, 'cancel', t, tz, { headline: name + ' cancelled', description: more.cancel.description }) });
    }
    // Acknowledgements are the account holder's: [date, hhmm (Denver), message number].
    for (const [d, h, m] of more.acks ?? []) me(d, h, 'alerts.acknowledge', { id, message_id: id + '-m' + m });
  }

  // ---- the account ---------------------------------------------------------------------
  const MOM = P.marrow.id, CABIN = P.cinder.id, LAKE = P.wren.id, HARBOR = P.brindle.id;
  // New Year's Day 2025: the account's first two places.
  me('2025-01-01', '10:12', 'places.save', { id: MOM, label: 'Mom\'s house', alert_rule: { categories: ['flood', 'storm', 'wind', 'temperature', 'air_quality'], min_severity: 'minor' } });
  me('2025-01-01', '10:15', 'places.save', { id: CABIN, label: 'Ski cabin road', alert_rule: { categories: ['winter', 'wind'], min_severity: 'moderate' } });
  // A notice at 3 am: quiet hours go on that morning.
  me('2025-01-25', '08:30', 'preferences.update', { patch: { quiet_hours: { enabled: true } } });
  me('2025-04-12', '10:00', 'places.update', { id: CABIN, patch: { alert_rule: { paused: true } } }); // end of the ski season
  me('2025-05-17', '08:40', 'places.save', { id: LAKE, label: 'Lake loop' });
  me('2025-06-14', '09:00', 'preferences.update', { patch: { default_source_id: 'src-skyline' } });
  me('2025-07-02', '18:30', 'places.save', { id: HARBOR, label: 'Harbor weekend' });
  me('2025-07-07', '09:00', 'places.remove', { id: HARBOR });
  // Skyline kept Saturday dry while a storm crossed the lake at noon: back to the forecast office.
  me('2025-08-17', '09:20', 'preferences.update', { patch: { default_source_id: 'src-pfo' } });
  me('2025-10-26', '17:00', 'places.remove', { id: LAKE }); // end of the hiking season
  me('2025-11-22', '09:30', 'places.update', { id: CABIN, patch: { alert_rule: { paused: false } } });
  // After a blizzard warning in the night: alerts go to the inbox as well.
  me('2026-02-07', '10:15', 'preferences.update', { patch: { email_notices: true } });
  me('2026-04-11', '10:20', 'places.update', { id: CABIN, patch: { alert_rule: { paused: true } } });
  me('2026-05-09', '08:15', 'places.save', { id: LAKE, label: 'Lake loop' });
  me('2026-10-18', '16:40', 'places.remove', { id: LAKE });
  me('2026-11-10', '19:20', 'places.save', { id: LAKE, label: 'Saturday hike' });
  me('2026-11-12', '08:05', 'places.update', { id: CABIN, patch: { alert_rule: { paused: false } } });

  // ---- drives over Cinderhorn Pass -----------------------------------------------------
  // A Friday drive up after work, watched for gusts. `first` and `second` are the 03:00 and
  // 15:00 issuances of the day: [wind, gust] the system adds. The watch is created before work.
  function drive(date, threshold, first, second, outcome, more = {}) {
    const start = iso(date, '15:00', A), end = iso(date, '20:00', A), label = more.label ?? 'Drive up Friday';
    const sys = ([wind, gust]) => ({ center: at(date, '17:00', A), width: 5, wind, gust, pop: more.pop ?? 20, base: 10, cool: 2 });
    issue('cinder', 'src-pfo', date, '03:00', sys(first));
    me(date, '06:50', 'watches.create', { id: CABIN, label, start, end, conditions: [{ variable: 'wind_gust', op: 'gte', value: threshold, unit: 'km/h' }] });
    expect(date, '06:50', A, label, start, outcome[0]);
    if (more.cancelAt) me(date, more.cancelAt, 'watches.cancel', app => ({ id: watchOf(app, label, start).id }));
    issue('cinder', 'src-pfo', date, '15:00', sys(second));
    expect(date, '15:00', A, label, start, outcome[1]);
    observe('cinder', date, '17:20', sys(second), more.seen);
  }
  drive('2025-01-10', 70, [2, 2], [6, 7], ['clear', 'clear'], { pop: 55 });                       // 66 km/h at the summit with the watch set at 70
  drive('2025-01-24', 70, [3, 3], [9, 10], ['clear', 'triggered'], { pop: 70 });
  drive('2025-02-14', 60, [1, 0], [2, 2], ['clear', 'clear'], { pop: 35 });                       // the threshold comes down to 60 and stays there
  drive('2025-03-21', 60, [0, 0], [1, 1], ['clear', 'clear']);
  drive('2025-12-05', 60, [1, 1], [2, 1], ['clear', 'clear'], { pop: 40 });
  drive('2025-12-19', 60, [6, 7], [10, 12], ['triggered', 'cancelled'], { pop: 45, cancelAt: '12:00' }); // high wind warning: the trip is called off at noon
  drive('2026-01-16', 60, [2, 1], [5, 5], ['clear', 'triggered'], { pop: 50 });
  drive('2026-02-27', 60, [0, 1], [1, 0], ['clear', 'clear']);
  drive('2026-03-20', 60, [3, 3], [5, 6], ['clear', 'triggered'], { pop: 25 });

  // 7 March 2025: gusts on Friday, so the drive moves to Saturday morning and the watch with it.
  {
    const date = '2025-03-07', next = '2025-03-08', label = 'Drive up Friday', start = iso(date, '15:00', A), moved = iso(next, '08:00', A);
    const windy = { center: at(date, '18:00', A), width: 6, wind: 6, gust: 8, pop: 30, base: 10, cool: 2 };
    issue('cinder', 'src-pfo', date, '03:00', { ...windy, wind: 5, gust: 5 });
    me(date, '06:50', 'watches.create', { id: CABIN, label, start, end: iso(date, '20:00', A), conditions: [{ variable: 'wind_gust', op: 'gte', value: 60, unit: 'km/h' }] });
    expect(date, '06:50', A, label, start, 'triggered');
    me(date, '12:10', 'watches.update', app => ({ id: watchOf(app, label, start).id, patch: { label: 'Drive up Saturday', start: moved, end: iso(next, '12:00', A) } }));
    expect(date, '12:10', A, 'Drive up Saturday', moved, 'no_data');
    issue('cinder', 'src-pfo', date, '15:00', windy);
    expect(date, '15:00', A, 'Drive up Saturday', moved, 'clear');
    issue('cinder', 'src-pfo', next, '03:00', { ...windy, wind: 1, gust: 1 });
    observe('cinder', next, '09:40', { ...windy, wind: 1, gust: 1 });
  }
  // 6 and 7 February 2026: a Saturday drive under a winter storm warning that becomes a blizzard warning overnight.
  {
    const eve = '2026-02-06', date = '2026-02-07', label = 'Drive up Saturday', start = iso(date, '08:00', A);
    const storm = { center: at(date, '04:00', A), width: 9, wind: 10, gust: 14, pop: 80, base: 10, cool: 4 };
    const spent = { ...storm, center: at(eve, '22:00', A), width: 5 }; // by 3 am the worst has passed
    issue('cinder', 'src-pfo', eve, '15:00', storm);
    me(eve, '19:00', 'watches.create', { id: CABIN, label, start, end: iso(date, '12:00', A), conditions: [{ variable: 'wind_gust', op: 'gte', value: 60, unit: 'km/h' }] });
    expect(eve, '19:00', A, label, start, 'triggered');
    issue('cinder', 'src-pfo', date, '03:00', spent);
    expect(date, '03:00', A, label, start, 'clear');
    observe('cinder', date, '09:10', spent);
  }

  // ---- Saturday hikes at Wren Lake -----------------------------------------------------
  // The watch she always sets: 10:00 to 13:00, 40 % rain or 20 % thunder. `first` is the
  // issuance of the evening before, `second` the one of the morning; [hour the storms peak,
  // peak probability, share that is thunder]. Created on Friday evening.
  function hike(date, source, first, second, outcome, more = {}) {
    const eve = addDays(date, -1), from = more.from ?? '10:00', to = more.to ?? '13:00', label = more.label ?? 'Lake loop';
    const start = iso(date, from, A), end = iso(date, to, A), [h1, h2] = source === 'src-pfo' ? ['15:00', '03:00'] : ['18:00', '06:00'];
    const sys = ([peak, pop, thunder]) => ({ center: at(date, peak, A), width: 3, pop, thunder, wind: 6, gust: 8, cool: 4 });
    issue('wren', source, eve, h1, sys(first));
    me(eve, more.createdAt ?? '19:40', 'watches.create', { id: LAKE, ...(more.label ? { label } : {}), start, end, conditions: [{ variable: 'pop', value: 40 }, { variable: 'thunder_prob', value: 20 }] });
    expect(eve, more.createdAt ?? '19:40', A, label, start, outcome[0]);
    issue('wren', source, date, h2, sys(second));
    expect(date, h2, A, label, start, outcome[1]);
    if (more.other) for (const [src, d, h, s] of more.other) issue('wren', src, d, h, sys(s));
    observe('wren', date, more.seenAt ?? '12:10', sys(more.actual ?? second), more.seen);
  }
  hike('2025-05-24', 'src-pfo', ['17:00', 55, 0.45], ['17:00', 60, 0.45], ['clear', 'clear']);
  hike('2025-06-21', 'src-skyline', ['17:00', 60, 0.45], ['13:00', 70, 0.45], ['clear', 'triggered']);
  hike('2025-07-19', 'src-skyline', ['13:00', 55, 0.45], ['18:00', 55, 0.45], ['triggered', 'clear']);
  // 16 August 2025: Skyline keeps the morning dry, the forecast office does not, and it storms at noon.
  hike('2025-08-16', 'src-skyline', ['19:00', 45, 0.45], ['19:00', 40, 0.45], ['clear', 'clear'], {
    other: [['src-pfo', '2025-08-15', '15:00', ['14:00', 60, 0.45]], ['src-pfo', '2025-08-16', '03:00', ['12:00', 75, 0.45]]], actual: ['12:00', 75, 0.45],
  });
  hike('2025-09-27', 'src-pfo', ['20:00', 30, 0.1], ['20:00', 25, 0.1], ['clear', 'clear'], { from: '09:00', to: '15:00', label: 'Ridge route' });
  hike('2026-05-23', 'src-pfo', ['18:00', 45, 0.45], ['18:00', 40, 0.45], ['clear', 'clear']);
  hike('2026-06-27', 'src-pfo', ['16:00', 50, 0.45], ['12:00', 35, 0.6], ['clear', 'triggered']); // dry thunderstorms: 20 % thunder with 35 % rain
  hike('2026-09-12', 'src-pfo', ['19:00', 35, 0.45], ['19:00', 30, 0.45], ['clear', 'clear']);
  // 1 August 2026: storms by late morning, so the hike starts at seven and the watch moves with it.
  {
    const eve = '2026-07-31', date = '2026-08-01', start = iso(date, '10:00', A), early = iso(date, '07:00', A);
    const sys = { center: at(date, '12:00', A), width: 3, pop: 65, thunder: 0.45, wind: 6, gust: 8, cool: 4 };
    issue('wren', 'src-pfo', eve, '15:00', sys);
    me(eve, '19:40', 'watches.create', { id: LAKE, start, end: iso(date, '13:00', A), conditions: [{ variable: 'pop', value: 40 }, { variable: 'thunder_prob', value: 20 }] });
    expect(eve, '19:40', A, 'Lake loop', start, 'triggered');
    me(eve, '20:10', 'watches.update', app => ({ id: watchOf(app, 'Lake loop', start).id, patch: { label: 'Lake loop, early start', start: early, end: iso(date, '10:00', A) } }));
    expect(eve, '20:10', A, 'Lake loop, early start', early, 'clear');
    issue('wren', 'src-pfo', date, '03:00', sys);
    expect(date, '03:00', A, 'Lake loop, early start', early, 'clear');
    observe('wren', date, '09:30', sys);
  }

  // ---- one harbor weekend, on Pacific time ------------------------------------------------
  {
    const eve = '2025-07-04', date = '2025-07-05', label = 'Ferry Saturday', start = iso(date, '08:00', B);
    const breezy = { center: at(date, '14:00', B), width: 6, wind: 9, gust: 6, base: 5, cool: 1 };
    issue('brindle', 'src-skyline', eve, '18:00', breezy);
    agent(at(eve, '19:00', B), A, 'watches.create', { id: HARBOR, label, start, end: iso(date, '11:00', B), conditions: [{ variable: 'wind_speed', value: 30 }, { variable: 'alert', category: 'wind' }] });
    expect(eve, '19:00', B, label, start, 'triggered'); // the wind advisory covers the crossing
    expect(date, '05:30', B, label, start, 'clear');     // and is cancelled before dawn
    issue('brindle', 'src-skyline', date, '06:00', { ...breezy, wind: 6 });
    observe('brindle', date, '08:20', { ...breezy, wind: 6 });
  }

  // ---- her mother's walks in smoke season ---------------------------------------------------
  // The watch: 08:00 to 18:00 at Marrowby, AQI 101 or an air-quality alert. `first` and
  // `second` are the Regional Air Board's daily values from the day before and from the day.
  function walk(date, createdAt, first, second, outcome) {
    const eve = addDays(date, -1), label = 'Mom\'s walk', start = iso(date, '08:00', B);
    air('marrow', eve, first);
    me(eve, createdAt, 'watches.create', { id: MOM, label, start, end: iso(date, '18:00', B), conditions: [{ variable: 'aqi', value: 101 }, { variable: 'alert', category: 'air_quality', min_severity: 'moderate' }] });
    expect(eve, createdAt, A, label, start, outcome[0]);
    air('marrow', date, second);
    expect(date, '10:00', B, label, start, outcome[1]);
    observe('marrow', date, '09:30', { base: 5 }, { conditions: second[0] > 100 ? 'smoke' : second[0] > 50 ? 'haze' : 'mostly_clear' });
  }
  walk('2025-08-22', '19:00', [128, 135, 96], [118, 84, 60], ['triggered', 'triggered']);
  walk('2025-09-05', '18:30', [104, 110, 71], [62, 48, 41], ['triggered', 'clear']);
  walk('2025-09-19', '12:00', [142, 155, 120], [140, 97, 66], ['triggered', 'triggered']);
  walk('2026-07-31', '17:00', [88, 95, 90], [112, 99, 74], ['triggered', 'triggered']);
  walk('2026-08-21', '16:00', [92, 88, 70], [64, 52, 45], ['triggered', 'clear']);
  walk('2026-09-18', '18:00', [66, 72, 58], [108, 94, 61], ['clear', 'triggered']);

  // ---- alert threads through the seasons ---------------------------------------------------
  const PASS = ['z-cinder'], HIGH = ['z-quill-high', 'z-cinder'], COAST = ['z-saltgrass-coast'], BAY = ['z-marrow'];
  thread('al-20250102-1', B, ['2025-01-02', '14:00'], 'Coastal Flood Advisory', BAY, ['2025-01-03', '08:00'], ['2025-01-03', '14:00'], { acks: [['2025-01-02', '16:30', 1]] });
  thread('al-20250109-1', A, ['2025-01-09', '09:00'], 'Winter Weather Advisory', HIGH, ['2025-01-10', '12:00'], ['2025-01-11', '06:00'], { acks: [['2025-01-09', '12:40', 1]] });
  thread('al-20250124-1', A, ['2025-01-24', '13:00'], 'Winter Storm Warning', PASS, ['2025-01-24', '20:00'], ['2025-01-25', '16:00'], {
    updates: [{ at: ['2025-01-25', '03:05'], ends: ['2025-01-25', '22:00'], certainty: 'observed', description: 'Snow is falling faster than forecast and will last into Saturday evening.' }], acks: [['2025-01-24', '13:30', 1]],
  });
  thread('al-20250205-1', B, ['2025-02-05', '16:00'], 'Wind Advisory', COAST, ['2025-02-06', '04:00'], ['2025-02-06', '16:00'], { description: 'Southwest gusts are expected along the coast.' });
  thread('al-20250213-1', A, ['2025-02-13', '10:00'], 'Winter Weather Advisory', PASS, ['2025-02-14', '06:00'], ['2025-02-14', '20:00'], { acks: [['2025-02-13', '18:15', 1]] });
  thread('al-20250227-1', B, ['2025-02-27', '09:30'], 'Coastal Flood Advisory', BAY, ['2025-02-28', '08:00'], ['2025-02-28', '14:00'], { acks: [['2025-02-27', '12:05', 1]] });
  thread('al-20250306-1', A, ['2025-03-06', '15:00'], 'High Wind Warning', HIGH, ['2025-03-07', '10:00'], ['2025-03-08', '00:00'], { acks: [['2025-03-06', '17:30', 1]] });
  thread('al-20250319-1', A, ['2025-03-19', '08:00'], 'Dense Fog Advisory', ['z-quill-valley'], ['2025-03-19', '08:00'], ['2025-03-19', '11:00'], { urgency: 'immediate', certainty: 'observed' });
  thread('al-20250408-1', B, ['2025-04-08', '11:00'], 'Wind Advisory', COAST, ['2025-04-08', '18:00'], ['2025-04-09', '06:00'], { description: 'Northwest gusts are expected along the coast.' });
  thread('al-20250422-1', A, ['2025-04-22', '14:00'], 'Winter Weather Advisory', PASS, ['2025-04-23', '00:00'], ['2025-04-23', '12:00'], { description: 'A late-season storm will bring wet snow to the pass.' });
  thread('al-20250520-1', A, ['2025-05-20', '10:00'], 'Flood Watch', ['z-wren'], ['2025-05-21', '00:00'], ['2025-05-23', '00:00'], {
    urgency: 'future', certainty: 'possible', updates: [{ at: ['2025-05-22', '09:00'], ends: ['2025-05-24', '06:00'], urgency: 'future', certainty: 'possible', description: 'Warm nights keep the creeks high into Saturday morning.' }],
  });
  thread('al-20250610-1', A, ['2025-06-10', '15:30'], 'Severe Thunderstorm Watch', ['z-wren', 'z-quill-valley'], ['2025-06-10', '16:00'], ['2025-06-10', '22:00'], {
    urgency: 'future', certainty: 'possible', cancel: { at: ['2025-06-10', '19:00'], description: 'Storms stayed east of the basin and the threat has ended.' },
  });
  thread('al-20250626-1', B, ['2025-06-26', '12:00'], 'Heat Advisory', ['z-saltgrass-inland', 'z-tamsin'], ['2025-06-27', '11:00'], ['2025-06-28', '20:00']);
  thread('al-20250704-1', B, ['2025-07-04', '13:00'], 'Wind Advisory', COAST, ['2025-07-05', '06:00'], ['2025-07-05', '16:00'], {
    description: 'Northwest gusts are expected along the coast and across the harbor.', cancel: { at: ['2025-07-05', '05:30'], description: 'Winds stayed below advisory levels overnight.' },
  });
  thread('al-20250718-1', A, ['2025-07-18', '14:30'], 'Severe Thunderstorm Warning', ['z-wren'], ['2025-07-18', '14:30'], ['2025-07-18', '16:30'], { urgency: 'immediate', certainty: 'observed' });
  thread('al-20250729-1', A, ['2025-07-29', '16:00'], 'Flash Flood Warning', ['z-quill-valley'], ['2025-07-29', '16:00'], ['2025-07-29', '19:00'], { urgency: 'immediate', certainty: 'observed' });
  thread('al-20250812-1', A, ['2025-08-12', '11:00'], 'Red Flag Warning', ['z-quill-high', 'z-wren'], ['2025-08-12', '12:00'], ['2025-08-13', '21:00']);
  thread('al-20250820-1', B, ['2025-08-20', '09:00'], 'Air Quality Alert', COAST, ['2025-08-20', '12:00'], ['2025-08-22', '12:00'], {
    updates: [{ at: ['2025-08-21', '08:00'], severity: 'severe', ends: ['2025-08-22', '20:00'], certainty: 'observed', headline: 'Air Quality Alert extended to Friday 8 PM; smoke is now unhealthy', description: 'Monitors along the coast report unhealthy smoke levels.', instruction: 'Everyone should limit time outdoors; keep windows closed.' }],
    acks: [['2025-08-20', '11:30', 1], ['2025-08-21', '10:10', 2]],
  });
  thread('al-20250904-1', B, ['2025-09-04', '10:00'], 'Air Quality Alert', COAST, ['2025-09-04', '12:00'], ['2025-09-05', '22:00'], {
    cancel: { at: ['2025-09-05', '06:00'], description: 'Onshore winds cleared the smoke earlier than forecast.' }, acks: [['2025-09-04', '12:20', 1]],
  });
  thread('al-20250918-1', B, ['2025-09-18', '07:30'], 'Air Quality Alert', ['z-saltgrass-coast', 'z-saltgrass-inland'], ['2025-09-18', '08:00'], ['2025-09-20', '08:00'], {
    severity: 'severe', certainty: 'observed', description: 'Smoke from fires inland has reached unhealthy levels along the coast.', instruction: 'Everyone should limit time outdoors; keep windows closed.', acks: [['2025-09-18', '09:45', 1]],
  });
  thread('al-20250926-1', A, ['2025-09-26', '13:00'], 'Freeze Warning', ['z-wren'], ['2025-09-27', '01:00'], ['2025-09-27', '09:00'], { urgency: 'future' });
  thread('al-20251014-1', B, ['2025-10-14', '05:00'], 'Dense Fog Advisory', COAST, ['2025-10-14', '05:00'], ['2025-10-14', '10:00'], { urgency: 'immediate', certainty: 'observed' });
  thread('al-20251021-1', A, ['2025-10-21', '15:00'], 'Winter Weather Advisory', HIGH, ['2025-10-22', '00:00'], ['2025-10-22', '14:00'], { description: 'The first snow of the season is expected over the pass.' });
  thread('al-20251126-1', A, ['2025-11-26', '10:00'], 'Winter Storm Warning', PASS, ['2025-11-27', '00:00'], ['2025-11-28', '06:00'], {
    updates: [{ at: ['2025-11-27', '15:00'], ends: ['2025-11-28', '12:00'], certainty: 'observed', description: 'Heavy snow continues over the pass through Friday morning.' }],
  });
  thread('al-20251204-1', A, ['2025-12-04', '12:00'], 'Winter Weather Advisory', PASS, ['2025-12-04', '20:00'], ['2025-12-05', '12:00'], { acks: [['2025-12-04', '18:20', 1]] });
  thread('al-20251218-1', A, ['2025-12-18', '09:00'], 'High Wind Warning', HIGH, ['2025-12-19', '06:00'], ['2025-12-20', '03:00'], { acks: [['2025-12-18', '12:15', 1]] });
  thread('al-20251223-1', B, ['2025-12-23', '15:00'], 'Coastal Flood Advisory', BAY, ['2025-12-24', '07:00'], ['2025-12-24', '13:00'], { acks: [['2025-12-23', '17:40', 1]] });
  thread('al-20260108-1', B, ['2026-01-08', '10:00'], 'Wind Advisory', COAST, ['2026-01-08', '16:00'], ['2026-01-09', '04:00'], { description: 'South gusts are expected along the coast ahead of a front.' });
  thread('al-20260115-1', A, ['2026-01-15', '14:00'], 'Winter Weather Advisory', PASS, ['2026-01-16', '02:00'], ['2026-01-16', '18:00'], { acks: [['2026-01-15', '18:05', 1]] });
  thread('al-20260128-1', A, ['2026-01-28', '08:00'], 'Cold Weather Advisory', ['z-quill-valley', 'z-quill-high'], ['2026-01-28', '22:00'], ['2026-01-29', '10:00'], { urgency: 'future' });
  thread('al-20260205-1', A, ['2026-02-05', '13:00'], 'Winter Storm Warning', PASS, ['2026-02-06', '10:00'], ['2026-02-07', '10:00'], {
    updates: [{ at: ['2026-02-06', '23:30'], event: 'Blizzard Warning', ends: ['2026-02-07', '04:00'], urgency: 'immediate', certainty: 'observed' }], acks: [['2026-02-05', '18:10', 1]],
  });
  thread('al-20260226-1', A, ['2026-02-26', '09:00'], 'Winter Weather Advisory', PASS, ['2026-02-26', '18:00'], ['2026-02-27', '09:00'], { acks: [['2026-02-26', '12:30', 1]] });
  thread('al-20260319-1', A, ['2026-03-19', '11:00'], 'Wind Advisory', ['z-quill-high'], ['2026-03-20', '12:00'], ['2026-03-21', '00:00'], { description: 'West winds with strong gusts are expected in the high country.', acks: [['2026-03-19', '18:45', 1]] });
  thread('al-20260330-1', B, ['2026-03-30', '16:00'], 'Coastal Flood Advisory', BAY, ['2026-03-31', '09:00'], ['2026-03-31', '15:00'], { acks: [['2026-03-30', '18:30', 1]] });
  thread('al-20260421-1', B, ['2026-04-21', '09:00'], 'Wind Advisory', COAST, ['2026-04-21', '15:00'], ['2026-04-22', '03:00'], { description: 'Northwest gusts are expected along the coast.' });
  thread('al-20260521-1', A, ['2026-05-21', '14:00'], 'Flood Watch', ['z-wren'], ['2026-05-22', '00:00'], ['2026-05-23', '06:00'], { urgency: 'future', certainty: 'possible' });
  thread('al-20260616-1', A, ['2026-06-16', '15:00'], 'Severe Thunderstorm Watch', ['z-wren', 'z-quill-valley'], ['2026-06-16', '15:30'], ['2026-06-16', '21:00'], {
    urgency: 'future', certainty: 'possible', cancel: { at: ['2026-06-16', '18:40'], description: 'The storms weakened before reaching the basin.' },
  });
  thread('al-20260709-1', B, ['2026-07-09', '12:00'], 'Heat Advisory', ['z-saltgrass-inland', 'z-saltgrass-coast'], ['2026-07-10', '11:00'], ['2026-07-11', '20:00']);
  thread('al-20260730-1', B, ['2026-07-30', '08:00'], 'Air Quality Alert', COAST, ['2026-07-30', '10:00'], ['2026-08-01', '10:00'], {
    updates: [{ at: ['2026-07-31', '07:00'], severity: 'severe', certainty: 'observed', headline: 'Air Quality Alert: smoke along the coast is now unhealthy', description: 'Monitors along the coast report unhealthy smoke levels.', instruction: 'Everyone should limit time outdoors; keep windows closed.' }],
    acks: [['2026-07-30', '10:25', 1], ['2026-07-31', '09:05', 2]],
  });
  thread('al-20260811-1', A, ['2026-08-11', '13:00'], 'Red Flag Warning', ['z-quill-high', 'z-wren'], ['2026-08-11', '14:00'], ['2026-08-12', '21:00']);
  thread('al-20260820-1', B, ['2026-08-20', '09:00'], 'Air Quality Alert', COAST, ['2026-08-20', '12:00'], ['2026-08-21', '21:00'], {
    cancel: { at: ['2026-08-21', '05:00'], description: 'A wind shift carried the smoke offshore overnight.' }, acks: [['2026-08-20', '11:15', 1]],
  });
  thread('al-20260911-1', A, ['2026-09-11', '15:00'], 'Severe Thunderstorm Warning', ['z-wren'], ['2026-09-11', '15:00'], ['2026-09-11', '17:00'], { urgency: 'immediate', certainty: 'observed' });
  thread('al-20260917-1', B, ['2026-09-17', '10:00'], 'Air Quality Alert', ['z-saltgrass-inland'], ['2026-09-17', '12:00'], ['2026-09-19', '12:00'], { description: 'Smoke is expected to settle in the inland valleys.' });
  thread('al-20261006-1', B, ['2026-10-06', '05:00'], 'Dense Fog Advisory', COAST, ['2026-10-06', '05:00'], ['2026-10-06', '10:00'], { urgency: 'immediate', certainty: 'observed' });
  thread('al-20261027-1', A, ['2026-10-27', '14:00'], 'Winter Weather Advisory', PASS, ['2026-10-28', '00:00'], ['2026-10-28', '12:00'], { description: 'The first snow of the season is expected over the pass.' });
  thread('al-20261105-1', B, ['2026-11-05', '09:00'], 'Coastal Flood Advisory', BAY, ['2026-11-06', '08:00'], ['2026-11-06', '14:00'], { acks: [['2026-11-05', '12:10', 1]] });
};
