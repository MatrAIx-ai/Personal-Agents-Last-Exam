'use strict';
// An upper bound on what practice can do under learner rule v1, used to prove that some targets cannot all be
// reached in the time left (scenario s3). It drops every effect that slows learning, so it can only be optimistic:
//
//   - no forgetting between now and a session or between sessions (R = 1),
//   - full prerequisite credit (P = 1, so the factor φ + (1 − φ)·P is 1),
//   - after the last session, forgetting at the slowest possible rate (S = max_stability_days) for the shortest
//     possible time (from the latest window end before the assessment).
//
// With R = 1 and P = 1 a session of d minutes leaves 1 − m multiplied by (1 − λ·d/60), so reaching a level needs
// Σ −ln(1 − λ·d_j/60) ≥ ln((1 − L₀)/(1 − τ)). minMinutes finds the fewest whole minutes in blocks of [a, b] minutes
// that achieve this (exact dynamic programme over block lengths); capacity counts the minutes the student's rules
// leave before the assessment.
const {ms, shift, local, clock} = require('../../src/time.cjs');
const {isoAt} = require('./baseline.cjs');

function minMinutes(level, target, lambda, a, b) {
  if (target >= 1) return Infinity;
  const need = Math.log((1 - level) / (1 - target));
  if (need <= 0) return 0;
  const gain = d => (lambda * d / 60 >= 1 ? Infinity : -Math.log(1 - lambda * d / 60));
  const best = [0];
  for (let D = 1; D <= 5000; D++) {
    let v = -Infinity;
    for (let d = a; d <= Math.min(b, D); d++) if (best[D - d] > -Infinity) v = Math.max(v, best[D - d] + gain(d));
    best[D] = v;
    if (v >= need) return D;
  }
  return Infinity;
}

// Study windows left between `now` and `until` under the rules: [{start, end, minutes}] per day, with the day's
// minutes capped by the daily cap (done blocks that day count against it).
function windows(data, now, until) {
  const p = data.preferences, zone = data.student.time_zone, out = [];
  for (let day = local(now, zone).date, i = 0; i < 60; i++) {
    const noon = isoAt(day, 720, zone);
    if (ms(isoAt(day, 0, zone)) >= ms(until)) break;
    const weekday = local(noon, zone).weekday;
    if (!p.rest_days.includes(weekday)) {
      let minutes = 0, first = null, last = null;
      for (const w of p.available_hours.filter(x => x.day === weekday)) {
        const from = Math.max(ms(isoAt(day, clock(w.from), zone)), ms(now));
        const to = Math.min(ms(clock(w.to) === 1440 ? shift(isoAt(day, 0, zone), 1440) : isoAt(day, clock(w.to), zone)), ms(until));
        if (to <= from) continue;
        minutes += (to - from) / 60000;
        first = first === null ? from : Math.min(first, from);
        last = last === null ? to : Math.max(last, to);
      }
      const done = data.plan.filter(b => b.done && local(b.start, zone).date === day).reduce((t, b) => t + b.minutes, 0);
      minutes = Math.min(minutes, Math.max(0, p.daily_cap_minutes - done));
      if (minutes > 0) out.push({date: day, first: new Date(first).toISOString(), last: new Date(last).toISOString(), minutes});
    }
    day = local(shift(noon, 1440), zone).date;
  }
  return out;
}

module.exports = {minMinutes, windows};
