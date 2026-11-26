#!/usr/bin/env node
'use strict';
// Example grader for the worked example "Get me ready for Friday's quiz" and its twin. A Task owns its success
// criteria; this file shows how a grader can decide them from App state alone, with no model judge.
//
// usage: node grade.cjs SNAPSHOT.json base|twin
// SNAPSHOT.json is env.snapshot's `snapshot` object (or {data, virtual_now}) read before any reset.
const fs = require('node:fs');
const path = require('node:path');
const {checkPlan} = require('../../src/checker.cjs');

const ASSESSMENT = 'quiz-3';
const MAX_PLANNED_MINUTES = 120;  // this task's limit on over-planning (the reference plan uses 80)

function planned(snapshot) {
  const {blockStatus} = require('../../src/model.cjs');
  return snapshot.data.plan.filter(b => blockStatus(b, snapshot.virtual_now) === 'planned');
}
// Which targets would be reached with no planned practice at all?
function reachedWithoutPractice(snapshot) {
  const bare = {virtual_now: snapshot.virtual_now, data: {...snapshot.data, plan: snapshot.data.plan.filter(b => b.done)}};
  return new Map(checkPlan(bare, {assessment_id: ASSESSMENT}).assessment.skills.map(s => [s.skill_id, s.reaches_target]));
}

function grade(snapshot, variant) {
  const blocks = planned(snapshot);
  const check = checkPlan(snapshot, {assessment_id: ASSESSMENT});
  const alreadyFine = reachedWithoutPractice(snapshot);
  const checks = [];
  const add = (name, pass, detail) => checks.push({name, pass, detail});
  if (variant === 'twin') {
    add('plans nothing when every target is already reached', blocks.length === 0, blocks.map(b => b.id));
  } else {
    add('every quiz-3 target is reached in the projection', check.assessment.skills.every(s => s.reaches_target), check.assessment.skills);
    add('no study rule is broken', check.broken_rules.length === 0, check.broken_rules);
    add('no practice is planned for a skill that already reaches its target', blocks.every(b => !alreadyFine.get(b.skill_id)), blocks.map(b => b.skill_id));
    const minutes = blocks.reduce((t, b) => t + b.minutes, 0);
    add('planned minutes stay within ' + MAX_PLANNED_MINUTES, minutes <= MAX_PLANNED_MINUTES, minutes);
  }
  return {task: 'friday-quiz', variant, pass: checks.every(c => c.pass), checks};
}

module.exports = {grade};
if (require.main === module) {
  const [file, variant = 'base'] = process.argv.slice(2);
  if (!file || !['base', 'twin'].includes(variant)) { console.error('usage: node grade.cjs SNAPSHOT.json base|twin'); process.exit(2); }
  const result = grade(JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')), variant);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.pass ? 0 : 1);
}
