'use strict';
// Agent tool handlers. Writes work on Core's copy of the data; Core validates, versions and commits them.
const {fail, copy} = require('./domain-utils.cjs');
const {ms, overlaps, local} = require('./time.cjs');
const nowIs = (data, now) => ` It is now ${now}, ${local(now, data.student.time_zone).weekday}.`;
const m = require('./model.cjs');
const v = require('./views.cjs');

const READS = {
  'milepost.courses.list': (data, now) => v.courses(data, now),
  'milepost.skills.list': (data, now, args) => v.skills(data, now, args.course_id),
  'milepost.mastery.get': (data, now, args) => v.mastery(data, now, args.skill_ids),
  'milepost.assessments.list': (data, now) => v.assessments(data, now),
  'milepost.practice.list': (data, now, args) => v.practice(data, now, args.skill_id),
  'milepost.plan.list': (data, now) => v.plan(data, now),
  'milepost.plan.project': (data, now, args) => v.project(data, now, args.assessment_id),
  'milepost.preferences.get': (data, now) => v.preferences(data, now)
};

const skill = (data, id) => m.byId(data.skills, id, 'not_found', 'Skill', 'milepost.skills.list');
function checkBlock(data, block, now) {
  skill(data, block.skill_id);
  if (ms(block.start) < ms(now)) fail('past_block', 'A study block cannot start in the past.' + nowIs(data, now));
  const span = m.blockInterval(block);
  if (data.plan.some(b => b.id !== block.id && overlaps(span, m.blockInterval(b)))) fail('overlap', 'The block overlaps another study block.');
}
function plannedNotStarted(block, now, what) {
  if (m.blockStatus(block, now) !== 'planned') fail('invalid_state', 'Only planned blocks can be ' + what + '; done and missed blocks are history.');
}

const WRITES = {
  'milepost.practice.record'(ctx, data, args) {
    const now = ctx.virtual_now;
    skill(data, args.skill_id);
    if (ms(args.ended_at) > ms(now)) fail('invalid_time', 'A reported session cannot end in the future.' + nowIs(data, now));
    const session = {id: m.nextId(data, 'ses'), skill_id: args.skill_id, minutes: args.minutes, ended_at: args.ended_at,
      source: 'student_report', block_id: null, recorded_at: now};
    const base = data.mastery.find(r => r.skill_id === args.skill_id).as_of;
    if (base !== null && ms(m.sessionInterval(session).start) < ms(base)) fail('invalid_time', 'The session is earlier than the student record.');
    if (data.practice.some(s => overlaps(m.sessionInterval(session), m.sessionInterval(s)))) fail('overlap', 'The session overlaps a recorded session.');
    data.practice.push(session);
    m.logEntry(ctx, data, 'milepost.practice.record', args, session.id, {skill_id: session.skill_id, minutes: session.minutes, ended_at: session.ended_at});
    return session.id;
  },
  'milepost.practice.remove'(ctx, data, args) {
    const session = m.byId(data.practice, args.id, 'not_found', 'Practice session', 'milepost.practice.list');
    if (session.source !== 'student_report') fail('not_removable', 'Only student-reported practice can be removed.');
    data.practice = data.practice.filter(s => s.id !== session.id);
    m.logEntry(ctx, data, 'milepost.practice.remove', args, session.id, {skill_id: session.skill_id, minutes: session.minutes, ended_at: session.ended_at});
    return session.id;
  },
  'milepost.plan.add_block'(ctx, data, args) {
    const now = ctx.virtual_now;
    const block = {id: m.nextId(data, 'blk'), skill_id: args.skill_id, start: args.start, minutes: args.minutes,
      created_at: now, updated_at: now, done: false};
    checkBlock(data, block, now);
    data.plan.push(block);
    m.logEntry(ctx, data, 'milepost.plan.add_block', args, block.id, {skill_id: block.skill_id, start: block.start, minutes: block.minutes});
    return block.id;
  },
  'milepost.plan.update_block'(ctx, data, args) {
    const now = ctx.virtual_now;
    const block = m.byId(data.plan, args.id, 'not_found', 'Study block', 'milepost.plan.list');
    if (!Object.keys(args.patch).length) fail('invalid_arguments', 'The patch must change at least one field.');
    plannedNotStarted(block, now, 'changed');
    if (ms(block.start) < ms(now)) fail('invalid_state', 'A block that has started cannot be changed.');
    const before = copy(block);
    Object.assign(block, copy(args.patch), {updated_at: now});
    checkBlock(data, block, now);
    m.logEntry(ctx, data, 'milepost.plan.update_block', args, block.id, {before: {skill_id: before.skill_id, start: before.start, minutes: before.minutes},
      after: {skill_id: block.skill_id, start: block.start, minutes: block.minutes}});
    return block.id;
  },
  'milepost.plan.remove_block'(ctx, data, args) {
    const block = m.byId(data.plan, args.id, 'not_found', 'Study block', 'milepost.plan.list');
    plannedNotStarted(block, ctx.virtual_now, 'removed');
    data.plan = data.plan.filter(b => b.id !== block.id);
    m.logEntry(ctx, data, 'milepost.plan.remove_block', args, block.id, {skill_id: block.skill_id, start: block.start, minutes: block.minutes});
    return block.id;
  }
};

function handleTool(ctx, data, name, args) {
  if (READS[name]) return {data, result: READS[name](data, ctx.virtual_now, args)};
  if (!WRITES[name]) fail('unknown_tool', 'Unknown Milepost operation.');
  return {data, result: {id: WRITES[name](ctx, data, args)}};
}

module.exports = {handleTool, READS: Object.keys(READS), WRITES: Object.keys(WRITES)};
