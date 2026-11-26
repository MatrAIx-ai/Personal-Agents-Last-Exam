#!/usr/bin/env node
'use strict';
// State-only grader for the four reference scenarios. Each scenario.json lists the checks for its base and twin
// under `success`; this file defines them. It reads env.snapshot's `snapshot` (taken before any reset) and needs no
// model judge. What the Agent tells the student (for example which skills will not make it) is left to the Task.
//
// usage: node grade.cjs SNAPSHOT.json SCENARIO_ID base|twin      exit 0 = pass, 1 = fail, 2 = usage
const fs = require('node:fs');
const path = require('node:path');
const {checkPlan} = require('../../src/checker.cjs');
const {blockStatus} = require('../../src/model.cjs');
const {ms, local} = require('../../src/time.cjs');

const spec = id => JSON.parse(fs.readFileSync(path.join(__dirname, id, 'scenario.json'), 'utf8'));
const planned = snap => snap.data.plan.filter(b => blockStatus(b, snap.virtual_now) === 'planned');
const end = b => ms(b.start) + b.minutes * 60000;

function context(snapshot, scenario) {
  const id = scenario.assessment_id, ctx = {snapshot, scenario, planned: planned(snapshot)};
  if (id) {
    ctx.assessment = snapshot.data.assessments.find(a => a.id === id);
    ctx.targets = new Set(ctx.assessment.targets.map(t => t.skill_id));
    const now = checkPlan(snapshot, {assessment_id: id});
    ctx.projection = new Map(now.assessment.skills.map(s => [s.skill_id, s]));
    ctx.broken = now.broken_rules;
    const bare = {virtual_now: snapshot.virtual_now, data: {...snapshot.data, plan: snapshot.data.plan.filter(b => blockStatus(b, snapshot.virtual_now) !== 'planned')}};
    ctx.withoutPractice = new Map(checkPlan(bare, {assessment_id: id}).assessment.skills.map(s => [s.skill_id, s.reaches_target]));
  }
  return ctx;
}

const CHECKS = {
  all_targets_reached: c => {
    const short = [...c.projection.values()].filter(s => !s.reaches_target).map(s => s.skill_id);
    return [short.length === 0, short];
  },
  min_targets_reached: (c, k) => {
    const reached = [...c.projection.values()].filter(s => s.reaches_target).map(s => s.skill_id);
    return [reached.length >= k, reached];
  },
  no_broken_rules: c => [c.broken.length === 0, c.broken],
  // The student asked not to spend time on what they already know.
  no_unneeded_practice: c => {
    const waste = c.planned.filter(b => c.targets.has(b.skill_id) && c.withoutPractice.get(b.skill_id)).map(b => b.id);
    return [waste.length === 0, waste];
  },
  // Blocks only for the assessment's skills or their prerequisites.
  blocks_in_scope: c => {
    const skills = new Map(c.snapshot.data.skills.map(s => [s.id, s]));
    const scope = new Set([...c.targets].flatMap(id => [id, ...skills.get(id).prerequisites]));
    const out = c.planned.filter(b => !scope.has(b.skill_id)).map(b => b.id);
    return [out.length === 0, out];
  },
  // Every planned block is for one of the assessment's skills that reaches its target.
  only_reached_targets: c => {
    const waste = c.planned.filter(b => !c.targets.has(b.skill_id) || !c.projection.get(b.skill_id).reaches_target).map(b => b.id);
    return [waste.length === 0, waste];
  },
  nothing_after_assessment: c => {
    const late = c.planned.filter(b => c.targets.has(b.skill_id) && end(b) > ms(c.assessment.date)).map(b => b.id);
    return [late.length === 0, late];
  },
  max_planned_minutes: (c, n) => {
    const minutes = c.planned.reduce((t, b) => t + b.minutes, 0);
    return [minutes <= n, minutes];
  },
  // New student reports correspond one to one to the listed blocks: same skill, same local day, length within 10 minutes.
  reports_exactly: (c, blockIds) => {
    const {data} = c.snapshot, zone = data.student.time_zone, ask = ms(c.scenario.ask_at);
    const fresh = data.practice.filter(s => s.source === 'student_report' && ms(s.recorded_at) >= ask);
    const unmatched = [...fresh], missing = [];
    for (const id of blockIds) {
      const b = data.plan.find(x => x.id === id), day = local(b.start, zone).date;
      const i = unmatched.findIndex(s => s.skill_id === b.skill_id && local(s.ended_at, zone).date === day && Math.abs(s.minutes - b.minutes) <= 10);
      if (i < 0) missing.push(id); else unmatched.splice(i, 1);
    }
    return [missing.length === 0 && unmatched.length === 0, {missing, extra: unmatched.map(s => s.id)}];
  },
  no_plan_changes: c => {
    const writes = c.snapshot.data.evaluator.activity_log.filter(e => e.operation.startsWith('milepost.plan.')).map(e => e.request_id);
    return [writes.length === 0, writes];
  }
};

function grade(snapshot, scenario, variant) {
  if (typeof scenario === 'string') scenario = spec(scenario);
  const c = context(snapshot, scenario), checks = [];
  for (const item of scenario.success[variant]) {
    const [name, arg] = typeof item === 'string' ? [item, undefined] : Object.entries(item)[0];
    const [pass, detail] = CHECKS[name](c, arg);
    checks.push({name, pass, detail});
  }
  return {scenario: scenario.id, variant, pass: checks.every(x => x.pass), checks};
}

module.exports = {grade, CHECKS, context, spec};
if (require.main === module) {
  const [file, id, variant] = process.argv.slice(2);
  if (!file || !id || !['base', 'twin'].includes(variant)) { console.error('usage: node grade.cjs SNAPSHOT.json SCENARIO_ID base|twin'); process.exit(2); }
  const result = grade(JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')), id, variant);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.pass ? 0 : 1);
}
