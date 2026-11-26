'use strict';
// Plan checker for Task graders (not an agent tool). Pure: it never changes its input.
//
// checkPlan(snapshot, {assessment_id} = {}) where `snapshot` is env.snapshot's `snapshot` object
// (or any object with `data` and `virtual_now`). Returns:
//   {rule_version, as_of, assessment: null | {id, date, skills: [{skill_id, level, target, reaches_target}]},
//    broken_rules: [{rule, block_ids, detail}]}
// `level` is shown to three decimals; `reaches_target` compares the unrounded level with the target.
// Only planned blocks (not done, not missed) are checked against the student's study rules; the daily cap
// also counts done blocks on the same local day. The result can include evaluator-only judgments, so return
// it to graders only.
const {VERSION, round3} = require('./learner.cjs');
const {local, clock} = require('./time.cjs');
const m = require('./model.cjs');
const v = require('./views.cjs');

function brokenRules(data, now) {
  const p = data.preferences, zone = data.student.time_zone, broken = [];
  const planned = data.plan.filter(b => m.blockStatus(b, now) === 'planned');
  const fits = b => {
    const s = local(b.start, zone), e = local(m.blockInterval(b).end, zone);
    // A block that crosses local midnight fits no window, except one that ends exactly at 24:00.
    const end = e.date === s.date ? e.minutes : e.minutes === 0 ? 1440 : Infinity;
    return p.available_hours.some(w => w.day === s.weekday && clock(w.from) <= s.minutes && end <= clock(w.to));
  };
  const add = (rule, blocks, detail) => blocks.length && broken.push({rule, block_ids: blocks.map(b => b.id), detail});
  add('rest_days', planned.filter(b => p.rest_days.includes(local(b.start, zone).weekday)), 'Planned on one of the student\'s rest days.');
  add('available_hours', planned.filter(b => !fits(b)), 'Outside the student\'s available hours.');
  add('block_minutes', planned.filter(b => b.minutes < p.block_minutes.min || b.minutes > p.block_minutes.max), 'Shorter or longer than the student\'s block length.');
  const days = new Map();
  for (const b of data.plan.filter(b => m.blockStatus(b, now) !== 'missed')) {
    const day = local(b.start, zone).date;
    days.set(day, [...(days.get(day) || []), b]);
  }
  const over = [...days.values()].filter(list => list.reduce((t, b) => t + b.minutes, 0) > p.daily_cap_minutes)
    .flatMap(list => list.filter(b => planned.includes(b)));
  add('daily_cap_minutes', over, 'The day\'s study blocks exceed the student\'s daily cap.');
  return broken;
}

function checkPlan(snapshot, {assessment_id} = {}) {
  const data = snapshot.data, now = snapshot.virtual_now;
  let assessment = null;
  if (assessment_id !== undefined) {
    const p = v.projection(data, now, assessment_id);
    assessment = {id: p.assessment.id, date: p.assessment.date, skills: p.levels.map(x => ({skill_id: x.skill_id,
      level: round3(x.level), target: x.target, reaches_target: x.level >= x.target}))};
  }
  return {rule_version: VERSION, as_of: now, assessment, broken_rules: brokenRules(data, now)};
}

module.exports = {checkPlan, brokenRules};
