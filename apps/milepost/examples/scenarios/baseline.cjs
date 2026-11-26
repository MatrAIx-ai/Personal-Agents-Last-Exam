'use strict';
// Scripted baseline for the reference scenarios. It uses only Agent tools and their results (no snapshot, no
// evaluator data, no plan checker), so its score shows what a fixed rule achieves without reading the request.
//
//   planFor(call, assessmentId)   1. remove planned blocks that break a study rule or come after the assessment,
//                                 2. remove blocks that its target skill does not need (the projection stays at target),
//                                 3. add blocks for the short skill with the smallest gap in the earliest free slot,
//                                 4. if some skills cannot all be reached, drop the furthest one and its blocks; repeat.
//   recordMissed(call, from, to)  records a student report for every missed block that started in [from, to).
//
// `call(name, args)` returns a tool result (the test harness, or an MCP client that adds expected_version and
// request_id). Both functions return what they did.
const {ms, shift, local, clock} = require('../../src/time.cjs');

const DAY = 1440;

// The ISO time for a local date and minute in the student's time zone (offsets tried around New York's).
function isoAt(date, minutes, zone) {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0'), mm = String(minutes % 60).padStart(2, '0');
  for (const offset of ['-05:00', '-04:00', '-06:00', '-07:00', '-08:00', '+00:00', '+01:00', '+02:00']) {
    const iso = `${date}T${hh}:${mm}:00${offset}`, l = local(iso, zone);
    if (l.date === date && l.minutes === minutes) return iso;
  }
  return null;
}

async function read(call) {
  const prefs = await call('milepost.preferences.get', {});
  const plan = await call('milepost.plan.list', {});
  return {now: plan.as_of, zone: prefs.time_zone, rules: prefs.preferences, blocks: plan.blocks};
}

// Rule checks from what the Agent can read: rest days, available windows, block length, daily cap.
function breaks(state, block, others) {
  const {rules, zone} = state, s = local(block.start, zone), e = local(block.end, zone);
  if (rules.rest_days.includes(s.weekday)) return true;
  const end = e.date === s.date ? e.minutes : e.minutes === 0 ? DAY : Infinity;
  if (!rules.available_hours.some(w => w.day === s.weekday && clock(w.from) <= s.minutes && end <= clock(w.to))) return true;
  if (block.minutes < rules.block_minutes.min || block.minutes > rules.block_minutes.max) return true;
  const day = others.filter(b => b.status !== 'missed' && local(b.start, zone).date === s.date).reduce((t, b) => t + b.minutes, 0);
  return day > rules.daily_cap_minutes;
}

// The earliest free slot before `until`: inside a window, not before now, clear of other blocks, under the cap.
function freeSlot(state, until) {
  const {rules, zone, now, blocks} = state;
  const live = blocks.filter(b => b.status !== 'missed');
  for (let day = local(now, zone).date, i = 0; i < 60; i++, day = local(shift(isoAt(day, 720, zone), DAY), zone).date) {
    const noon = isoAt(day, 720, zone);
    if (!noon || ms(isoAt(day, 0, zone)) >= ms(until)) break;
    const weekday = local(noon, zone).weekday;
    if (rules.rest_days.includes(weekday)) continue;
    const used = live.filter(b => local(b.start, zone).date === day).reduce((t, b) => t + b.minutes, 0);
    const capLeft = rules.daily_cap_minutes - used;
    if (capLeft < rules.block_minutes.min) continue;
    for (const w of rules.available_hours.filter(x => x.day === weekday).sort((a, b) => clock(a.from) - clock(b.from))) {
      let t = clock(w.from);
      const nowLocal = local(now, zone);
      if (nowLocal.date === day) t = Math.max(t, Math.ceil(nowLocal.minutes / 5) * 5);
      const busy = live.filter(b => local(b.start, zone).date === day).map(b => [local(b.start, zone).minutes, local(b.start, zone).minutes + b.minutes]).sort((a, b) => a[0] - b[0]);
      for (const [from, to] of [...busy, [clock(w.to), clock(w.to)]]) {
        if (to <= t) continue;
        const room = Math.min(from, clock(w.to)) - t;
        const minutes = Math.min(rules.block_minutes.max, room, capLeft);
        if (minutes >= rules.block_minutes.min) {
          const start = isoAt(day, t, zone);
          if (start && ms(shift(start, minutes)) <= ms(until)) return {start, minutes};
        }
        t = Math.max(t, to);
      }
    }
  }
  return null;
}

async function project(call, assessmentId) {
  const p = await call('milepost.plan.project', {assessment_id: assessmentId});
  return new Map(p.skills.map(s => [s.skill_id, s]));
}

async function planFor(call, assessmentId) {
  const done = {removed: [], added: [], dropped: []};
  const assessment = (await call('milepost.assessments.list', {})).assessments.find(a => a.id === assessmentId);
  const targets = new Set(assessment.targets.map(t => t.skill_id));
  const remove = async b => { await call('milepost.plan.remove_block', {id: b.id}); done.removed.push(b.id); };
  // 1. Planned blocks that break a rule, and blocks for this assessment's skills that end after it.
  let state = await read(call);
  for (const b of state.blocks.filter(x => x.status === 'planned')) {
    const others = state.blocks.filter(x => x.id !== b.id);
    if (breaks(state, b, [...others, b]) || (targets.has(b.skill_id) && ms(b.end) > ms(assessment.date))) await remove(b);
  }
  // 2. Blocks a target skill does not need: remove the latest first while the projection stays at target.
  state = await read(call);
  for (const b of state.blocks.filter(x => x.status === 'planned' && targets.has(x.skill_id)).reverse()) {
    const before = await project(call, assessmentId);
    if (!before.get(b.skill_id).reaches_target) continue;  // still short: keep it
    await call('milepost.plan.remove_block', {id: b.id});
    const p = await project(call, assessmentId);
    if ([...p.values()].some(s => !s.reaches_target && before.get(s.skill_id).reaches_target)) {
      await call('milepost.plan.add_block', {skill_id: b.skill_id, start: b.start, minutes: b.minutes});
    } else done.removed.push(b.id);
  }
  // 3-4. Fill the smallest gaps first; if not everything fits, drop the furthest skill and try again.
  const dropped = new Set();
  for (;;) {
    let p = await project(call, assessmentId);
    for (;;) {
      const short = [...p.values()].filter(s => !dropped.has(s.skill_id) && !s.reaches_target)
        .sort((a, b) => (a.target - a.projected_level) - (b.target - b.projected_level));
      if (!short.length) return done;
      state = await read(call);
      const slot = freeSlot(state, assessment.date);
      if (!slot) break;
      const r = await call('milepost.plan.add_block', {skill_id: short[0].skill_id, start: slot.start, minutes: slot.minutes});
      done.added.push(r.id);
      p = await project(call, assessmentId);
    }
    const short = [...p.values()].filter(s => !dropped.has(s.skill_id) && !s.reaches_target)
      .sort((a, b) => (b.target - b.projected_level) - (a.target - a.projected_level));
    const worst = short[0].skill_id;
    dropped.add(worst); done.dropped.push(worst);
    state = await read(call);
    for (const b of state.blocks.filter(x => x.status === 'planned' && x.skill_id === worst && ms(x.end) <= ms(assessment.date))) await remove(b);
  }
}

async function recordMissed(call, from, to) {
  const recorded = [];
  for (const b of (await call('milepost.plan.list', {})).blocks) {
    if (b.status !== 'missed' || ms(b.start) < ms(from) || ms(b.start) >= ms(to)) continue;
    const r = await call('milepost.practice.record', {skill_id: b.skill_id, minutes: b.minutes, ended_at: b.end});
    recorded.push(r.id);
  }
  return {recorded};
}

module.exports = {planFor, recordMissed, freeSlot, isoAt};
