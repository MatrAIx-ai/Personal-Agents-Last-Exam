'use strict';
// Agent-visible read results. Every field is listed explicitly: evaluator-only records
// (data.evaluator: learner parameters and the activity log) and stability values never appear here.
const {ms, local} = require('./time.cjs');
const {VERSION, round3} = require('./learner.cjs');
const m = require('./model.cjs');
const {fail} = require('./domain-utils.cjs');

const ids = list => new Set(list.map(x => x.id));
const byTime = key => (a, b) => ms(a[key]) - ms(b[key]) || (a.id < b.id ? -1 : 1);

function courses(data, now) {
  return {as_of: now, courses: data.courses.map(c => ({id: c.id, title: c.title,
    units: data.units.filter(u => u.course_id === c.id).sort((a, b) => a.position - b.position).map(u => ({id: u.id, title: u.title,
      position: u.position, skill_ids: data.skills.filter(s => s.unit_id === u.id).map(s => s.id)}))}))};
}
function skills(data, now, courseId) {
  if (courseId !== undefined && !ids(data.courses).has(courseId)) fail('not_found', 'Course does not exist for this student. milepost.courses.list lists the valid IDs.');
  const unitCourse = new Map(data.units.map(u => [u.id, u.course_id]));
  return {as_of: now, skills: data.skills.filter(s => courseId === undefined || unitCourse.get(s.unit_id) === courseId)
    .map(s => ({id: s.id, title: s.title, course_id: unitCourse.get(s.unit_id), unit_id: s.unit_id, prerequisites: [...s.prerequisites]}))};
}
function mastery(data, now, skillIds) {
  const known = ids(data.skills);
  if (skillIds && skillIds.some(id => !known.has(id))) fail('not_found', 'Skill does not exist for this student. milepost.skills.list lists the valid IDs.');
  const model = m.learnerModel(data);
  return {as_of: now, rule_version: VERSION, skills: (skillIds || data.skills.map(s => s.id)).map(id => {
    const state = model.stateAt(id, now);
    return {skill_id: id, level: round3(model.levelAt(id, now)), last_practised_at: state.last_practised_at};
  })};
}
function assessments(data, now) {
  return {as_of: now, assessments: [...data.assessments].sort(byTime('date')).map(a => {
    const r = m.resultFor(data, a.id);
    return {id: a.id, title: a.title, date: a.date, day: local(a.date, data.student.time_zone).weekday, targets: a.targets.map(t => ({skill_id: t.skill_id, level: t.level})),
      status: r ? 'assessed' : 'scheduled', result: r ? {posted_at: r.posted_at, levels: r.levels.map(x => ({skill_id: x.skill_id, level: x.level}))} : null};
  })};
}
function practice(data, now, skillId) {
  if (skillId !== undefined && !ids(data.skills).has(skillId)) fail('not_found', 'Skill does not exist for this student. milepost.skills.list lists the valid IDs.');
  return {as_of: now, sessions: data.practice.filter(s => skillId === undefined || s.skill_id === skillId).sort(byTime('ended_at'))
    .map(s => ({id: s.id, skill_id: s.skill_id, minutes: s.minutes, started_at: m.sessionInterval(s).start, ended_at: s.ended_at,
      day: local(m.sessionInterval(s).start, data.student.time_zone).weekday, source: s.source, block_id: s.block_id}))};
}
function plan(data, now) {
  return {as_of: now, blocks: [...data.plan].sort(byTime('start')).map(b => ({id: b.id, skill_id: b.skill_id, start: b.start,
    end: m.blockInterval(b).end, day: local(b.start, data.student.time_zone).weekday, minutes: b.minutes, status: m.blockStatus(b, now)}))};
}
// Planned blocks that end after now and by `until` count as completed sessions at their end.
function plannedSessions(data, now, until) {
  return data.plan.filter(b => m.blockStatus(b, now) === 'planned')
    .map(b => ({id: b.id, skill_id: b.skill_id, minutes: b.minutes, ended_at: m.blockInterval(b).end}))
    .filter(s => ms(s.ended_at) > ms(now) && ms(s.ended_at) <= ms(until));
}
function projection(data, now, assessmentId) {
  const a = m.byId(data.assessments, assessmentId, 'not_found', 'Assessment', 'milepost.assessments.list');
  if (ms(a.date) <= ms(now)) fail('invalid_state', 'The assessment has already taken place.');
  const model = m.learnerModel(data, plannedSessions(data, now, a.date));
  return {assessment: a, levels: a.targets.map(t => ({skill_id: t.skill_id, level: model.levelAt(t.skill_id, a.date), target: t.level}))};
}
function project(data, now, assessmentId) {
  const p = projection(data, now, assessmentId);
  return {as_of: now, rule_version: VERSION, assessment_id: p.assessment.id, date: p.assessment.date,
    skills: p.levels.map(x => ({skill_id: x.skill_id, projected_level: round3(x.level), target: x.target, reaches_target: x.level >= x.target}))};
}
function preferences(data, now) {
  const p = data.preferences;
  return {as_of: now, time_zone: data.student.time_zone, preferences: {
    available_hours: p.available_hours.map(w => ({day: w.day, from: w.from, to: w.to})), daily_cap_minutes: p.daily_cap_minutes,
    rest_days: [...p.rest_days], block_minutes: {min: p.block_minutes.min, max: p.block_minutes.max}}};
}

module.exports = {courses, skills, mastery, assessments, practice, plan, plannedSessions, projection, project, preferences};
