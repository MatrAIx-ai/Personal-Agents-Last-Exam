#!/usr/bin/env node
'use strict';
// Authoring-time consistency check of fixtures/minimal.json, independent of the script
// that wrote it. `node dev/check-fixture.cjs` prints problems and exits 1 if there are any.
// It checks the promised scale, the span of the history (January 2025 to the fixture clock,
// nothing earlier, no empty month), contiguous hours, value ranges, date and offset alignment
// per place, and that each daily row agrees with the hourly rows of the same local date.
// The last three days hold full issuances (48 hourly and 7 daily rows) from every source for
// every place; the archive before them holds shorter ones (24 and 5).
// It cannot check realism or that names are fictional: that stays a human review item.
const path = require('node:path');
const { HOUR, ms, isoAt, localDate, addDays, writtenOffset, offsetMinutes } = require('../src/util.cjs');
const { alertStatus } = require('../src/model.cjs');

function check(data = require('../fixtures/minimal.json'), clock = require('../fixtures/clock.json').initial_time) {
  const problems = [], expect = (ok, message) => { if (!ok) problems.push(message); };
  const places = new Map(data.places.map(p => [p.id, p])), sources = new Map(data.sources.map(s => [s.id, s]));
  const weather = data.issuances.filter(i => sources.get(i.source_id).kind === 'weather'), air = data.issuances.filter(i => sources.get(i.source_id).kind === 'air_quality');
  // The last three days are kept in full; everything before them is the archive.
  const LAST_DAYS = ms('2026-11-18T00:00:00-07:00'), HISTORY_START = ms('2025-01-01T00:00:00-07:00'), now = ms(clock);
  const recent = text => ms(text) >= LAST_DAYS, count = (list, when, late) => list.filter(x => recent(when(x)) === late).length;
  const issuedAt = i => i.issued_at, observedAt = o => o.observed_at, firstSent = a => a.messages[0].sent_at;

  // Scale: the last three days as promised in the proposal, and the archive behind them.
  const scale = {
    'time zones': [new Set(data.places.map(p => p.timezone)).size, 2], regions: [new Set(data.places.map(p => p.region)).size, 2], places: [data.places.length, 6], zones: [data.zones.length, 8],
    'weather sources': [data.sources.filter(s => s.kind === 'weather').length, 2], 'air-quality sources': [data.sources.filter(s => s.kind === 'air_quality').length, 1],
    'weather issuances of the last three days': [count(weather, issuedAt, true), 36], 'air-quality issuances of the last three days': [count(air, issuedAt, true), 18],
    'observations of the last three days': [count(data.observations, observedAt, true), 12], 'alert threads of the last three days': [count(data.alerts, firstSent, true), 6],
    'archive weather issuances': [count(weather, issuedAt, false), 45], 'archive air-quality issuances': [count(air, issuedAt, false), 12],
    'archive observations': [count(data.observations, observedAt, false), 27], 'archive alert threads': [count(data.alerts, firstSent, false), 46],
    'saved places': [data.saved_places.length, 3], acknowledgements: [data.acknowledgements.length, 23], watches: [data.watches.length, 30], notices: [data.notices.length, 66],
    'watches open at the clock': [data.watches.filter(w => !w.cancelled_at && ms(w.end) > now).length, 2], 'cancelled watches': [data.watches.filter(w => w.cancelled_at).length, 1],
  };
  for (const [name, [actual, wanted]] of Object.entries(scale)) expect(actual === wanted, name + ': ' + actual + ', expected ' + wanted);
  for (const p of data.places) for (const s of data.sources) {
    expect(data.issuances.filter(i => i.place_id === p.id && i.source_id === s.id && recent(i.issued_at)).length === 3, 'three issuances per source and place in the last three days: ' + s.id + ' / ' + p.id);
  }
  expect(data.zones.every(z => data.places.some(p => p.zone_ids.includes(z.id)) || data.alerts.some(a => a.zone_ids.includes(z.id))), 'every zone is used');

  // Span: the history starts in January 2025, nothing is dated earlier, and no month is empty.
  const dated = [
    ...data.issuances.map(i => [i.id, i.issued_at]), ...data.observations.map(o => [o.id, o.observed_at]), ...data.alerts.flatMap(a => a.messages.map(m => [m.message_id, m.sent_at])),
    ...data.saved_places.map(s => ['saved ' + s.place_id, s.saved_at]), ...data.acknowledgements.map(a => ['acknowledgement of ' + a.message_id, a.acknowledged_at]),
    ...data.watches.map(w => [w.id, w.created_at]), ...data.notices.map(n => [n.id, n.created_at]), ...data.activity.map(a => ['activity ' + a.seq, a.at]),
  ];
  for (const [what, when] of dated) expect(ms(when) >= HISTORY_START && ms(when) <= now, what + ': dated between 2025-01-01 and the fixture clock');
  const months = new Set(data.activity.map(a => a.at.slice(0, 7))), wanted = [];
  for (let y = 2025, m = 1; y < 2026 || m <= 11; m === 12 ? (y++, m = 1) : m++) wanted.push(y + '-' + String(m).padStart(2, '0'));
  expect(data.activity.length > 0 && data.activity[0].at.startsWith('2025-01'), 'the history starts in January 2025');
  for (const month of wanted) expect(months.has(month), month + ': the history has activity in every month');

  for (const i of weather) {
    const tz = places.get(i.place_id).timezone, t0 = ms(i.issued_at), [hours, days] = recent(i.issued_at) ? [48, 7] : [24, 5];
    expect(i.hourly.length === hours && i.daily.length === days, i.id + ': ' + hours + ' hourly and ' + days + ' daily rows');
    expect(writtenOffset(i.issued_at) === offsetMinutes(t0, tz), i.id + ': issued_at is written in the place offset');
    expect(ms(i.hourly[0].start) === t0, i.id + ': the first hour is the issue hour');
    i.hourly.forEach((r, n) => {
      expect(ms(r.start) === t0 + n * HOUR && r.start === isoAt(t0 + n * HOUR, tz), i.id + ': contiguous local hours at row ' + n);
      expect(r.gust_kph >= r.wind_kph && r.apparent_temp_c <= r.temp_c && r.thunder_prob <= r.pop && r.pop % 5 === 0 && (r.pop >= 30) === (r.precip_mm > 0), i.id + ': value relations at ' + r.start);
    });
    i.daily.forEach((d, n) => {
      expect(d.date === addDays(localDate(t0, tz), n), i.id + ': contiguous local dates at row ' + n);
      const rows = i.hourly.filter(r => localDate(ms(r.start), tz) === d.date), temps = rows.map(r => r.temp_c);
      expect(temps.every(v => v >= d.low_c && v <= d.high_c), i.id + ' ' + d.date + ': hourly temperatures lie within the daily low and high');
      if (rows.length === 24) expect(Math.max(...temps) === d.high_c && Math.min(...temps) === d.low_c, i.id + ' ' + d.date + ': daily high and low match the hourly rows');
      const local = r => new Date(ms(r.start) + offsetMinutes(ms(r.start), tz) * 60000).getUTCHours(), daytime = rows.filter(r => local(r) >= 6 && local(r) < 18);
      expect(daytime.every(r => r.pop <= d.pop_day), i.id + ' ' + d.date + ': daytime hours do not exceed pop_day');
      if (daytime.length === 12) expect(Math.max(...daytime.map(r => r.pop)) === d.pop_day, i.id + ' ' + d.date + ': pop_day matches the daytime hours');
      const number = /(\d+)%/.exec(d.headline);
      if (number) expect([d.pop_day, d.pop_night].includes(+number[1]), i.id + ' ' + d.date + ': the headline percentage is one of the daily probabilities');
    });
  }
  for (const i of air) {
    const tz = places.get(i.place_id).timezone;
    expect(!i.hourly && i.daily.length === 3 && i.daily.every((d, n) => d.date === addDays(localDate(ms(i.issued_at), tz), n)), i.id + ': three contiguous daily air-quality rows');
  }
  for (const o of data.observations) expect(writtenOffset(o.observed_at) === offsetMinutes(ms(o.observed_at), places.get(o.place_id).timezone) && ms(o.observed_at) <= ms(clock), o.id + ': observed before the clock, in the place offset');
  expect(data.issuances.every(i => ms(i.issued_at) <= ms(clock)), 'every issuance is issued at or before the clock');

  const statuses = new Set(data.alerts.map(a => alertStatus(a, ms(clock)))), types = new Set(data.alerts.flatMap(a => a.messages.map(m => m.type)));
  expect(['upcoming', 'active', 'expired', 'cancelled'].every(s => statuses.has(s)), 'alert threads cover every status at the clock');
  expect(['alert', 'update', 'cancel'].every(t => types.has(t)), 'alert threads cover every message type');

  expect(data.activity.every((a, n) => a.seq === n + 1), 'activity sequence is 1..n');
  expect(data.activity.every((a, n) => n === 0 || ms(a.at) >= ms(data.activity[n - 1].at)), 'activity time does not go back');
  expect(data.activity.every(a => ['agent', 'event'].includes(a.actor)), 'activity rows come from Agent writes and events only');
  // Email copies were turned on once; a notice carries a wire message exactly when it was written after that.
  const emailOn = data.activity.filter(a => a.action === 'preferences.update' && a.details.changed_fields.includes('email_notices'));
  expect(emailOn.length === 1 && emailOn[0].at.startsWith('2026-02-07'), 'email copies were turned on once, on 2026-02-07');
  for (const n of data.notices) {
    expect(ms(n.release_at) >= ms(n.created_at) && ms(n.release_at) <= ms(clock), n.id + ': released by the fixture clock');
    expect((n.wire !== undefined) === (emailOn.length === 1 && ms(n.created_at) >= ms(emailOn[0].at)), n.id + ': a wire message exactly when email copies were on');
    if (n.wire !== undefined) expect(n.wire.id === n.id && n.wire.time === n.release_at && n.wire.data.content.title === n.title && n.wire.data.content.body.text === n.body, n.id + ': a wire message that matches the notice and is dated at its release time');
    expect(data.activity.some(a => a.action === 'notice.created' && a.object_id === n.id && a.seq === n.seq), n.id + ': has its activity row');
  }
  expect(data.notices.some(n => ms(n.release_at) > ms(n.created_at)), 'one notice was written in quiet hours and released later');
  expect(data.notices.some(n => n.severity === 'extreme' && n.release_at === n.created_at && n.created_at.slice(11, 13) >= '22'), 'one notice for an extreme alert was written at night and not held');
  for (const kind of ['alert.issued', 'alert.updated', 'alert.cancelled', 'watch.triggered', 'watch.cleared']) expect(data.notices.some(n => n.kind === kind && !recent(n.created_at)), 'the archive has a notice of kind ' + kind);
  for (const w of data.watches) {
    expect((w.aq_source_id !== undefined) === w.conditions.some(c => c.variable === 'aqi'), w.id + ': an air-quality source exactly when it has an aqi condition');
    expect(data.activity.some(a => a.action === 'watches.create' && a.object_id === w.id && a.seq === w.seq), w.id + ': has its activity row');
    expect(ms(w.created_at) < ms(w.end) && ms(w.end) - ms(w.start) <= 10 * 24 * HOUR, w.id + ': created before its window ends, and the window is at most ten days');
  }
  for (const a of data.acknowledgements) expect(data.activity.some(r => r.action === 'alerts.acknowledge' && r.object_id === a.alert_id && r.at === a.acknowledged_at && r.details.message_id === a.message_id), 'acknowledgement of ' + a.message_id + ': has its activity row');
  return problems;
}

module.exports = { check };
if (require.main === module) {
  const problems = check();
  for (const p of problems) console.error('PROBLEM: ' + p);
  if (problems.length) process.exit(1);
  console.log('fixtures/minimal.json is consistent (' + path.basename(__filename) + ').');
}
