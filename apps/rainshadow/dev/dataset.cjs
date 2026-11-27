#!/usr/bin/env node
'use strict';
// Authoring-time script, never run by the App or the host.
//   node dev/dataset.cjs          write datasets/full-window/{seed.json,clock.json,dataset.json}
//   node dev/dataset.cjs --check  exit 1 if the committed files differ from a fresh build
// Builds the full-window evaluation dataset: the fixture's scripted history (January 2025 to
// 20 November 2026, dev/history.cjs and the three detailed days of dev/build-fixture.cjs),
// continued to 31 December 2026, with the steady records a weather app keeps in between:
// the Regional Air Board's daily air-quality forecast for Marrowby (the account holder's
// mother's town), a forecast-office issuance for Quillmere every other Monday, and the
// advisories the office issues for the zones nobody in the account has saved. Everything is
// replayed in time order through the App's own business functions, like the fixture.
// Deterministic: a seeded generator for the steady records, no wall clock. Every place, zone,
// source and person is fictional, and no number is observed weather.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { fixture, plugin } = require('../tests/harness.cjs');
const { HOUR, isoAt, localToInstant, addDays } = require('../src/util.cjs');
const { alertStatus, watchOpen } = require('../src/model.cjs');
const fx = require('./build-fixture.cjs'), H = require('./history.cjs');

const SEED = 20250103, VERSION = '1.0.0';
const ROOT = path.resolve(__dirname, '..'), OUT = path.join(ROOT, 'datasets/full-window');
const A = 'America/Denver', B = 'America/Los_Angeles';
const at = (date, hhmm, tz) => localToInstant(date, hhmm, tz);
const iso = (date, hhmm, tz) => isoAt(at(date, hhmm, tz), tz);
const START = '2025-01-01', END = '2026-12-31', CLOCK = iso(END, '20:00', A);
const { P } = fx;
const compact = date => date.replace(/-/g, '');

// ---- a small seeded generator ---------------------------------------------------------------
let state = SEED;
function rand() { state = (state + 0x6D2B79F5) | 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const pick = list => list[Math.floor(rand() * list.length)];
const chance = p => rand() < p;
const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

// ---- the steps: the fixture's, then the steady records, then the last six weeks ---------------
// A step is { t, group, order, run(app, id) }. The fixture's steps keep their own IDs
// (seed-ev-NNN, seed-req-NNN); the others are numbered per group.
function timeline() {
  state = SEED;
  const all = [], fixtureSteps = [...fx.steps].sort((a, b) => a.t - b.t || a.order - b.order);
  let n = 0;
  for (const s of fixtureSteps) all.push({ t: s.t, group: 0, order: all.length, id: s.numbered ? 'seed-ev-' + String(++n).padStart(3, '0') : null, run: s.run });
  const counters = { 1: 0, 2: 0 }, prefix = { 1: 'bg-ev-', 2: 'ext-ev-' };
  const push = (group, t, run, numbered = true) => all.push({ t, group, order: all.length, id: numbered ? prefix[group] + String(++counters[group]).padStart(4, '0') : null, run });
  const evt = group => (t, tz, operation, payload) => push(group, t, (app, id) => app.event({ event_id: id, at: isoAt(t, tz), operation: 'rainshadow.' + operation, payload }));
  const me = group => (t, name, args) => push(group, t, (app, id) => { app.advance(isoAt(t, A)); app.call(name, { ...(typeof args === 'function' ? args(app) : args), request_id: id.replace('-ev-', '-req-') }); });   // the account holder acts on Denver time
  background(evt(1), fixtureSteps, me(1));
  extension(evt(2), me(2), (t, run) => push(2, t, run, false));
  return all.sort((a, b) => a.t - b.t || a.group - b.group || a.order - b.order);
}

// An alert thread: the first message, updates, at most one cancel. Same wording as the history.
function threadOf(event) {
  return (id, tz, [date, hhmm], name, zones, onset, ends, more = {}) => {
    const [category, severity, description, instruction] = H.WORDING[name];
    const fields = (n, sev, on, off, extra = {}) => ({
      event: n, severity: sev, urgency: extra.urgency ?? 'expected', certainty: extra.certainty ?? 'likely', onset: iso(on[0], on[1], tz), ends: iso(off[0], off[1], tz),
      headline: extra.headline ?? n + ' from ' + H.spoken(on[0], on[1]) + ' to ' + H.spoken(off[0], off[1]), description: extra.description ?? H.WORDING[n][2], instruction: extra.instruction ?? H.WORDING[n][3],
    });
    let t = at(date, hhmm, tz), k = 1, sev = more.severity ?? severity, on = onset, off = ends, current = name;
    event(t, tz, 'alert.issued', { alert_id: id, source_id: more.source ?? (category === 'air_quality' ? 'src-aqb' : 'src-pfo'), category, zone_ids: zones, message: fx.message(id + '-m1', 'alert', t, tz, fields(current, sev, on, off, { ...more, description: more.description ?? description, instruction: more.instruction ?? instruction })) });
    for (const u of more.updates ?? []) {
      t = at(u.at[0], u.at[1], tz); k += 1; current = u.event ?? current; sev = u.severity ?? (u.event ? H.WORDING[u.event][1] : sev); on = u.onset ?? on; off = u.ends ?? off;
      event(t, tz, 'alert.updated', { alert_id: id, message: fx.message(id + '-m' + k, 'update', t, tz, fields(current, sev, on, off, { urgency: u.urgency, certainty: u.certainty, description: u.description, headline: u.headline ?? (u.event ? current + ' until ' + H.spoken(off[0], off[1]) : current + ' now lasts until ' + H.spoken(off[0], off[1])) })) });
    }
    if (more.cancel) { t = at(more.cancel.at[0], more.cancel.at[1], tz); k += 1; event(t, tz, 'alert.cancelled', { alert_id: id, message: fx.message(id + '-m' + k, 'cancel', t, tz, { headline: current + ' cancelled', description: more.cancel.description }) }); }
  };
}

// ---- steady records -----------------------------------------------------------------------------
// Smoke episodes along the coast, as the history's air-quality alerts describe them: [first, last, peak].
const SMOKE = [['2025-08-19', '2025-08-23', 135], ['2025-09-03', '2025-09-05', 110], ['2025-09-17', '2025-09-20', 150], ['2026-07-29', '2026-08-01', 120], ['2026-08-19', '2026-08-21', 95], ['2026-09-16', '2026-09-19', 105]];
function aqiOn(date) {
  const month = +date.slice(5, 7), smoke = SMOKE.find(([a, b]) => date >= a && date <= b);
  if (smoke) return Math.max(55, smoke[2] - between(0, 25));
  const base = month === 12 || month <= 2 ? 42 : month <= 5 ? 30 : month <= 9 ? 46 : 36;   // winter inversions, clean spring, summer ozone
  return Math.max(12, base + between(-12, 14));
}
function background(event, fixtureSteps, me) {
  // Times at which the scripted history already issues something (an air-quality forecast for Marrowby at 10:00, say).
  const taken = new Set(fixtureSteps.map(s => s.t));
  // 1. The Regional Air Board's weekly outlook for Marrowby: every Monday at 10:00, seven days.
  for (let date = '2025-01-06'; date <= '2026-12-28'; date = addDays(date, 7)) {
    const t = at(date, '10:00', B);
    if (taken.has(t)) continue;
    event(t, B, 'forecast.issued', H.archAir(P, 'marrow', date, Array.from({ length: 7 }, (_, d) => aqiOn(addDays(date, d)))));
  }
  //    And its outlook for Tamsin Heights, inland, where smoke and summer ozone settle: every
  //    other Thursday, in the weeks without a Quillmere issuance. (Issuances are capped at 400
  //    in a seed; this leaves room for a Task's own.)
  for (let date = '2025-01-16'; date <= '2026-12-24'; date = addDays(date, 14)) {
    const t = at(date, '10:00', B);
    if (taken.has(t)) continue;
    event(t, B, 'forecast.issued', H.archAir(P, 'tamsin', date, Array.from({ length: 7 }, (_, d) => Math.max(12, aqiOn(addDays(date, d)) + (+date.slice(5, 7) >= 6 && +date.slice(5, 7) <= 9 ? 8 : -4)))));
  }
  // 2. The forecast office's Quillmere issuance on every other Monday at 03:00 (24 hours, 5 days).
  for (let date = '2025-01-06'; date <= END; date = addDays(date, 14)) {
    const month = +date.slice(5, 7), summer = month >= 6 && month <= 8, winter = month === 12 || month <= 2;
    const sys = chance(0.4) ? { center: at(date, '03:00', A) + between(6, 60) * HOUR, width: between(3, 8), pop: between(35, 80), thunder: summer ? 0.45 : 0.1, wind: between(3, 9), gust: between(4, 12), cool: winter ? 5 : 3 } : { base: 5, warm: winter ? -1 : 0 };
    event(at(date, '03:00', A), A, 'forecast.issued', H.archIssuance(P, 'quill', 'src-pfo', date, '03:00', sys));
  }
  // 3. Routine advisories through the seasons, two or three a month: for the Quillmere valley and
  //    the inland heights, which no saved place covers, for Mom's bay shore and, in the ski
  //    season, for the pass. The last two reach the account as notices; she acknowledges some.
  const thread = threadOf(event), used = new Set();
  const winterRule = date => (date >= '2025-01-01' && date < '2025-04-12') || (date >= '2025-11-22' && date < '2026-04-11') || (date >= '2026-11-12' && date <= '2026-11-15');
  const KINDS = [
    [m => m === 12 || m <= 2, 'Dense Fog Advisory', ['z-quill-valley'], A, '05:00', 0, 5, { urgency: 'immediate', certainty: 'observed', description: 'Patchy dense fog may reduce visibility in the valley.' }],
    [m => m === 12 || m <= 2, 'Cold Weather Advisory', ['z-quill-valley', 'z-tamsin'], A, '14:00', 8, 12, { urgency: 'future' }],
    [m => m === 12 || m <= 3, 'Winter Weather Advisory', ['z-cinder'], A, '10:00', 10, 18, {}, winterRule],
    [m => m === 12 || m <= 3 || m === 11, 'Coastal Flood Advisory', ['z-marrow'], B, '14:00', 18, 6, {}],
    [m => m === 3 || m === 4 || m === 10 || m === 11, 'Freeze Warning', ['z-tamsin'], B, '13:00', 13, 8, { urgency: 'future', description: 'Temperatures near or below freezing are expected in the heights.' }],
    [m => m >= 3 && m <= 5, 'Wind Advisory', ['z-quill-valley'], A, '10:00', 4, 10, { description: 'West winds with strong gusts are expected in the valley.' }],
    [m => m >= 9 && m <= 11, 'Wind Advisory', ['z-marrow'], B, '09:00', 6, 12, { description: 'Gusty winds are expected along the bay shore.' }],
    [m => m >= 6 && m <= 8, 'Heat Advisory', ['z-saltgrass-inland', 'z-tamsin'], B, '12:00', 23, 33, {}],
    [m => m >= 6 && m <= 8, 'Severe Thunderstorm Warning', ['z-quill-valley'], A, '15:00', 0, 2, { urgency: 'immediate', certainty: 'observed', description: 'A storm with large hail and damaging gusts is moving through the valley.' }],
    [m => m >= 9 && m <= 11, 'Dense Fog Advisory', ['z-saltgrass-inland'], B, '05:30', 0, 4, { urgency: 'immediate', certainty: 'observed', description: 'Patchy dense fog may reduce visibility in the inland valleys.' }],
  ];
  for (let month = '2025-01'; month <= '2026-11'; month = addDays(month + '-28', 5).slice(0, 7)) {
    const m = +month.slice(5, 7);
    for (let i = between(3, 4); i > 0; i--) {
      const day = month + '-' + String(between(2, month === '2026-11' ? 14 : 27)).padStart(2, '0'), fits = KINDS.filter(k => k[0](m) && (!k[8] || k[8](day)));
      if (!fits.length) continue;
      const [, name, zones, tz, hhmm, leadHours, lengthHours, more] = pick(fits), id = 'al-' + compact(day) + '-' + (zones[0] === 'z-quill-valley' ? 3 : zones[0] === 'z-marrow' ? 4 : zones[0] === 'z-cinder' ? 5 : 6);
      if (used.has(id)) continue;
      used.add(id);
      const issued = at(day, hhmm, tz), onset = issued + leadHours * HOUR, end = onset + lengthHours * HOUR;
      const local = t => [isoAt(t, tz).slice(0, 10), isoAt(t, tz).slice(11, 16)];
      const cancel = name === 'Wind Advisory' && chance(0.3) ? { at: local(onset + 2 * HOUR), description: 'Winds stayed below advisory levels.' } : undefined;
      thread(id, tz, [day, hhmm], name, zones, local(onset), local(end), { ...more, ...(cancel ? { cancel } : {}) });
      // Alerts for her places reach her. As in the history, she acknowledges every flood alert for
      // her mother's house within hours, and no wind alert; pass alerts only when a drive is planned.
      if (name === 'Coastal Flood Advisory') {
        const when = Math.min(issued + between(1, 4) * HOUR, end - HOUR);
        me(when, 'alerts.acknowledge', app => { const a = app.data.alerts.find(x => x.id === id); return { id, message_id: a.messages.at(-1).message_id }; });
      }
    }
  }
}

// ---- 21 November to 31 December 2026 --------------------------------------------------------------
function extension(event, me, step) {
  const thread = threadOf(event);
  const issue = (key, source, date, hhmm, sys) => event(at(date, hhmm, P[key].tz), P[key].tz, 'forecast.issued', H.archIssuance(P, key, source, date, hhmm, sys));
  const observe = (key, date, hhmm, sys, change) => event(at(date, hhmm, P[key].tz), P[key].tz, 'observation.recorded', H.archObservation(P, key, date, hhmm, sys, change));
  const air = (key, date, values) => event(at(date, '10:00', P[key].tz), P[key].tz, 'forecast.issued', H.archAir(P, key, date, values));
  const watchOf = (app, label, start) => { const w = app.data.watches.find(x => x.label === label && x.start === start); if (!w) throw Error('No watch ' + label + ' ' + start); return w; };
  const ack = (date, hhmm, id) => me(at(date, hhmm, A), 'alerts.acknowledge', app => { const a = app.data.alerts.find(x => x.id === id); return { id, message_id: a.messages.at(-1).message_id }; });
  const CABIN = P.cinder.id, MOM = P.marrow.id, LAKE = P.wren.id, PASS = ['z-cinder'], HIGH = ['z-quill-high', 'z-cinder'], COAST = ['z-saltgrass-coast'], BAY = ['z-marrow'];

  // Saturday 21 November: the hike and Mom's walk the fixture's last afternoon set watches for.
  const storm = { center: at('2026-11-21', '20:00', A), width: 6, pop: 75, thunder: 0.1, wind: 8, gust: 10, cool: 3 };
  issue('wren', 'src-pfo', '2026-11-21', '03:00', storm);
  observe('wren', '2026-11-21', '12:10', storm);
  observe('marrow', '2026-11-21', '09:30', { base: 5 }, { conditions: 'mostly_clear' });
  air('marrow', '2026-11-21', [48, 41, 37]);
  observe('cinder', '2026-11-21', '21:30', storm, { conditions: 'snow' });
  // Thanksgiving week: a storm on the pass, and a walk with Mom on the coast.
  thread('al-20261124-1', A, ['2026-11-24', '13:00'], 'Winter Storm Warning', PASS, ['2026-11-25', '06:00'], ['2026-11-26', '18:00'], {
    updates: [{ at: ['2026-11-25', '15:00'], ends: ['2026-11-27', '06:00'], certainty: 'observed', description: 'Heavy snow continues over the pass through Thursday night.' }],
  });
  ack('2026-11-24', '18:05', 'al-20261124-1');
  const coastRain = { center: at('2026-11-26', '15:00', B), width: 5, pop: 60, thunder: 0.1, wind: 6, gust: 8, cool: 2 };
  issue('marrow', 'src-pfo', '2026-11-25', '15:00', coastRain);
  me(at('2026-11-25', '20:15', A), 'watches.create', { id: MOM, label: 'Thanksgiving walk', start: iso('2026-11-26', '10:00', B), end: iso('2026-11-26', '12:00', B), conditions: [{ variable: 'pop', value: 40 }] });
  issue('marrow', 'src-pfo', '2026-11-26', '03:00', { ...coastRain, center: at('2026-11-26', '13:00', B) });
  observe('marrow', '2026-11-26', '11:40', coastRain);
  // December on the pass and at home.
  thread('al-20261201-1', B, ['2026-12-01', '09:00'], 'Coastal Flood Advisory', BAY, ['2026-12-02', '08:00'], ['2026-12-02', '14:00'], { description: 'King tides may flood low roads and parking areas along the bay shore.' });
  ack('2026-12-01', '12:20', 'al-20261201-1');
  const breeze = { center: at('2026-12-04', '17:00', A), width: 5, wind: 2, gust: 2, pop: 30, base: 10, cool: 2 };
  issue('cinder', 'src-pfo', '2026-12-04', '03:00', breeze);
  me(at('2026-12-04', '06:50', A), 'watches.create', { id: CABIN, label: 'Drive up Friday', start: iso('2026-12-04', '15:00', A), end: iso('2026-12-04', '20:00', A), conditions: [{ variable: 'wind_gust', op: 'gte', value: 60, unit: 'km/h' }] });
  issue('cinder', 'src-pfo', '2026-12-04', '15:00', { ...breeze, wind: 3, gust: 3 });
  observe('cinder', '2026-12-04', '17:20', breeze);
  thread('al-20261208-1', A, ['2026-12-08', '05:00'], 'Dense Fog Advisory', ['z-quill-valley'], ['2026-12-08', '05:00'], ['2026-12-08', '10:00'], { urgency: 'immediate', certainty: 'observed' });
  thread('al-20261210-1', A, ['2026-12-10', '14:00'], 'Cold Weather Advisory', ['z-quill-valley', 'z-quill-high'], ['2026-12-11', '22:00'], ['2026-12-12', '10:00'], { urgency: 'future' });
  thread('al-20261214-1', A, ['2026-12-14', '13:00'], 'Winter Storm Warning', PASS, ['2026-12-15', '12:00'], ['2026-12-16', '18:00'], {
    updates: [{ at: ['2026-12-15', '22:00'], event: 'Blizzard Warning', ends: ['2026-12-16', '12:00'], urgency: 'immediate', certainty: 'observed' }],
  });
  // 18 December: gusts on Friday, so the drive moves to Saturday and the watch with it.
  const gusty = { center: at('2026-12-18', '18:00', A), width: 6, wind: 6, gust: 9, pop: 35, base: 10, cool: 2 };
  thread('al-20261217-1', A, ['2026-12-17', '11:00'], 'High Wind Warning', HIGH, ['2026-12-18', '12:00'], ['2026-12-19', '03:00']);
  ack('2026-12-17', '12:30', 'al-20261217-1');
  issue('cinder', 'src-pfo', '2026-12-18', '03:00', gusty);
  me(at('2026-12-18', '06:50', A), 'watches.create', { id: CABIN, label: 'Drive up Friday', start: iso('2026-12-18', '15:00', A), end: iso('2026-12-18', '20:00', A), conditions: [{ variable: 'wind_gust', op: 'gte', value: 60, unit: 'km/h' }] });
  me(at('2026-12-18', '12:05', A), 'watches.update', app => ({ id: watchOf(app, 'Drive up Friday', iso('2026-12-18', '15:00', A)).id, patch: { label: 'Drive up Saturday', start: iso('2026-12-19', '08:00', A), end: iso('2026-12-19', '12:00', A) } }));
  issue('cinder', 'src-pfo', '2026-12-18', '15:00', gusty);
  issue('cinder', 'src-pfo', '2026-12-19', '03:00', { ...gusty, wind: 1, gust: 1 });
  observe('cinder', '2026-12-19', '09:40', { ...gusty, wind: 1, gust: 1 });
  // Christmas at Mom's on the coast.
  thread('al-20261221-1', B, ['2026-12-21', '10:00'], 'Wind Advisory', COAST, ['2026-12-22', '04:00'], ['2026-12-22', '20:00'], { description: 'South gusts are expected along the coast ahead of a front.', cancel: { at: ['2026-12-22', '09:00'], description: 'The front weakened offshore and winds stayed below advisory levels.' } });
  thread('al-20261223-1', B, ['2026-12-23', '15:00'], 'Coastal Flood Advisory', BAY, ['2026-12-24', '07:00'], ['2026-12-24', '13:00']);
  ack('2026-12-23', '18:10', 'al-20261223-1');
  const showers = { center: at('2026-12-24', '17:00', B), width: 4, pop: 45, wind: 5, gust: 6, cool: 2 };
  issue('marrow', 'src-skyline', '2026-12-23', '18:00', showers);
  me(at('2026-12-23', '19:30', A), 'watches.create', { id: MOM, label: 'Christmas Eve walk', start: iso('2026-12-24', '13:00', B), end: iso('2026-12-24', '15:00', B), source_id: 'src-skyline', conditions: [{ variable: 'pop', value: 40 }] });
  issue('marrow', 'src-skyline', '2026-12-24', '06:00', { ...showers, center: at('2026-12-24', '19:00', B) });
  observe('marrow', '2026-12-24', '14:10', { ...showers, center: at('2026-12-24', '19:00', B) });
  // Notices at 22:15 over the holidays: quiet hours now start at 21:30.
  me(at('2026-12-27', '09:10', A), 'preferences.update', { patch: { quiet_hours: { enabled: true, start: '21:30', end: '07:00' } } });
  // The New Year storm, in effect at the clock, and the drive she watches for New Year's Day.
  thread('al-20261229-1', A, ['2026-12-29', '14:00'], 'Winter Storm Warning', PASS, ['2026-12-31', '12:00'], ['2027-01-01', '18:00'], {
    updates: [{ at: ['2026-12-31', '09:00'], ends: ['2027-01-02', '06:00'], description: 'Heavy snow will last into Saturday morning over the pass.' }],
  });
  ack('2026-12-29', '18:30', 'al-20261229-1');
  const newYear = { center: at('2027-01-01', '03:00', A), width: 10, wind: 9, gust: 13, pop: 85, base: 10, cool: 4 };
  issue('cinder', 'src-pfo', '2026-12-30', '15:00', newYear);
  me(at('2026-12-30', '19:45', A), 'watches.create', { id: CABIN, label: 'Drive up New Year\'s Day', start: iso('2027-01-01', '09:00', A), end: iso('2027-01-01', '13:00', A), conditions: [{ variable: 'wind_gust', op: 'gte', value: 60, unit: 'km/h' }, { variable: 'alert', category: 'winter', min_severity: 'severe' }] });
  // The last day: every place's air-quality forecast, and both sources for the four places she follows.
  for (const key of Object.keys(P)) air(key, END, [aqiOn(END), aqiOn(addDays(END, 1)), aqiOn(addDays(END, 2))].map(v => key === 'cinder' ? Math.max(12, v - 20) : v));
  for (const [key, sys] of [['cinder', newYear], ['quill', { ...newYear, wind: 2, gust: 2, pop: 70 }], ['wren', { ...newYear, wind: 3, gust: 3, pop: 65 }], ['marrow', { base: 5 }]]) {
    issue(key, 'src-pfo', END, '03:00', sys);
    issue(key, 'src-skyline', END, '06:00', { ...sys, ...(sys.pop ? { pop: sys.pop - 10 } : {}) });
    issue(key, 'src-pfo', END, '15:00', { ...sys, ...(sys.center ? { center: sys.center - 2 * HOUR } : {}) });
    observe(key, END, '17:50', sys);
  }
  me(at(END, '18:20', A), 'alerts.acknowledge', app => { const a = app.data.alerts.find(x => x.id === 'al-20261229-1'); return { id: a.id, message_id: a.messages.at(-1).message_id }; });
  step(at(END, '19:00', A), app => { const w = watchOf(app, 'Drive up New Year\'s Day', iso('2027-01-01', '09:00', A)); if (!watchOpen(w, at(END, '19:00', A))) throw Error('The New Year watch should be open at the clock.'); });
}

// ---- replay -----------------------------------------------------------------------------------
function build() {
  const app = fixture({ seed: fx.base(), now: iso(START, '00:00', A), binding: fx.binding, deferStateSchema: true });
  const steps = timeline(), stats = { fixture: 0, background: 0, extension: 0 };
  for (const s of steps) { s.run(app, s.id); if (s.id) stats[['fixture', 'background', 'extension'][s.group]]++; }
  app.advance(CLOCK);
  app.verify();
  return { data: app.data, stats };
}

function describe(data) {
  const T = Date.parse(CLOCK), by = (list, key) => Object.fromEntries(Object.entries(list.reduce((o, x) => (o[key(x)] = (o[key(x)] || 0) + 1, o), {})).sort(([a], [b]) => (a < b ? -1 : 1)));
  return {
    regions: 2, time_zones: [A, B], places: data.places.length, zones: data.zones.length, sources: data.sources.length,
    issuances: data.issuances.length, issuances_by_source: by(data.issuances, i => i.source_id), issuances_by_place: by(data.issuances, i => i.place_id),
    observations: data.observations.length, alerts: data.alerts.length, alert_messages: data.alerts.reduce((n, a) => n + a.messages.length, 0), alerts_by_status_at_clock: by(data.alerts, a => alertStatus(a, T)),
    saved_places_at_clock: data.saved_places.length, acknowledgements: data.acknowledgements.length, watches: data.watches.length, notices: data.notices.length, activity_rows: data.activity.length,
    window: [START, END], clock: CLOCK,
  };
}
function files() {
  const { data, stats } = build(), seed = JSON.stringify(data) + '\n', sha = crypto.createHash('sha256').update(seed).digest('hex');
  const dataset = {
    schema_version: 'pale.dataset.v1', dataset_id: 'rainshadow-full-window', version: VERSION,
    description: 'Full-window evaluation dataset for Rainshadow: an invented two-region world and one account\'s use of the app from 1 January 2025 to 31 December 2026 (the fixture\'s scripted history continued to the end of 2026), with the daily air-quality forecast for one place, a forecast issuance for another every other Monday, and the advisories for the zones the account does not save. Synthetic; separate from the smoke fixture (fixtures/minimal.json).',
    record_source_ids: ['rainshadow-full-window-generator'],
    sources: [{
      source_id: 'rainshadow-full-window-generator', kind: 'synthetic',
      description: 'Generated by dev/dataset.cjs: the scripted history of dev/history.cjs and dev/build-fixture.cjs (watches, alert threads, places, preferences, the three detailed days), a scripted continuation to 31 December 2026, and seeded steady records (daily air-quality forecasts for Marrowby, fortnightly Quillmere issuances, advisories for unsaved zones), all applied through the App\'s own events and tools. Forecast numbers come from closed-form toy models with seeded weather systems; no observed weather, no real place, source or person; nothing collected.',
      uri: null, license: 'MIT', usage: 'permitted', collection: null,
      generation: { method: 'scripted history plus seeded steady records, replayed through the App business functions (mulberry32 generator for the steady records)', tool: 'dev/dataset.cjs with dev/build-fixture.cjs and dev/history.cjs', tool_version: VERSION, seed: SEED, parameters: { ...describe(data), events: stats } },
    }],
    transformations: ['None: seed.json is the App state exactly as the replay leaves it, written as compact JSON (sha256 ' + sha + ').'],
    expected_counts: { records: plugin.objects(data).length, assets: 0 },
    quality_policy: { duplicate_records: 'reject', duplicate_assets: 'reject', missing_assets: 'allow_declared' },
    review: { status: 'pending', reviewer: null, notes: 'Automated checks (seed rules after every step, the state schema at the end, the scripted watch outcomes, dev/coverage.cjs, tests/dataset.integration.cjs) do not replace human review of realism: forecast numbers, alert wording, the account\'s two years, and that every place, source and person is fictional.' },
  };
  return { 'seed.json': seed, 'clock.json': JSON.stringify({ initial_time: CLOCK }, null, 2) + '\n', 'dataset.json': JSON.stringify(dataset, null, 2) + '\n' };
}

function main() {
  const out = files();
  if (process.argv.includes('--check')) {
    const bad = Object.entries(out).filter(([name, text]) => !fs.existsSync(path.join(OUT, name)) || fs.readFileSync(path.join(OUT, name), 'utf8') !== text).map(([n]) => n);
    if (bad.length) { console.error('datasets/full-window differs from dev/dataset.cjs: ' + bad.join(', ')); process.exit(1); }
    console.log('datasets/full-window matches dev/dataset.cjs.');
    return;
  }
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, text] of Object.entries(out)) fs.writeFileSync(path.join(OUT, name), text);
  console.log('Wrote datasets/full-window: seed.json ' + Buffer.byteLength(out['seed.json']) + ' bytes; ' + JSON.stringify(JSON.parse(out['dataset.json']).sources[0].generation.parameters.events));
}

module.exports = { build, CLOCK, START, END };
if (require.main === module) main();
