'use strict';
// Scenario events applied by Infra with env.apply_event. Core sets ctx.virtual_now to event.at and rolls back
// both data and clock when a handler refuses an event.
const {fail, copy} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');
const {ms, clock, overlaps} = require('./time.cjs');
const m = require('./model.cjs');

const ref = (list, id, what) => m.byId(list, id, 'unknown_reference', what);
const bad = message => fail('invalid_value', message);

const HANDLERS = {
  'milepost.practice.completed'(data, at, p) {
    ref(data.skills, p.skill_id, 'Skill');
    let block = null;
    if (p.block_id !== undefined) {
      block = ref(data.plan, p.block_id, 'Study block');
      if (block.skill_id !== p.skill_id) bad('The completed session practises a different skill from its block.');
      if (block.done) bad('The study block is already done.');
    }
    const session = {id: m.nextId(data, 'ses'), skill_id: p.skill_id, minutes: p.minutes, ended_at: at,
      source: 'platform', block_id: block ? block.id : null, recorded_at: at};
    if (data.practice.some(s => overlaps(m.sessionInterval(session), m.sessionInterval(s)))) bad('The session overlaps a recorded session.');
    data.practice.push(session);
    if (block) Object.assign(block, {done: true, updated_at: at});
    return session.id;
  },
  'milepost.assessment.result_posted'(data, at, p) {
    const a = ref(data.assessments, p.assessment_id, 'Assessment');
    if (m.resultFor(data, a.id)) bad('A result has already been posted for this assessment.');
    if (ms(at) < ms(a.date)) bad('A result cannot be posted before the assessment.');
    const targets = new Set(a.targets.map(t => t.skill_id)), seen = new Set();
    for (const x of p.results) {
      ref(data.skills, x.skill_id, 'Skill');
      if (!targets.has(x.skill_id) || seen.has(x.skill_id)) bad('A result may only report the assessment target skills, once each.');
      seen.add(x.skill_id);
    }
    const result = {id: m.nextId(data, 'res'), assessment_id: a.id, posted_at: at, levels: copy(p.results)};
    data.results.push(result);
    return result.id;
  },
  'milepost.assessment.added'(data, at, p) {
    if (m.objects(data).includes(p.assessment_id)) fail('duplicate_id', 'An object with this ID already exists.');
    if (ms(p.date) <= ms(at)) bad('A new assessment must be dated after the event.');
    const seen = new Set();
    for (const t of p.targets) {
      ref(data.skills, t.skill_id, 'Skill');
      if (seen.has(t.skill_id)) bad('Assessment targets need distinct skills.');
      seen.add(t.skill_id);
    }
    data.assessments.push({id: p.assessment_id, title: p.title ?? p.assessment_id, date: p.date, targets: copy(p.targets),
      created_at: at, updated_at: at});
    return p.assessment_id;
  },
  'milepost.assessment.moved'(data, at, p) {
    const a = ref(data.assessments, p.assessment_id, 'Assessment');
    if (m.resultFor(data, a.id)) bad('An assessed assessment cannot be moved.');
    if (ms(p.date) <= ms(at)) bad('The new date must be after the event.');
    Object.assign(a, {date: p.date, updated_at: at});
    return a.id;
  },
  'milepost.preferences.changed'(data, at, p) {
    if (p.rule === 'available_hours' && p.value.some(w => !(clock(w.from) < clock(w.to)))) bad('Each available window must end after it starts.');
    if (p.rule === 'block_minutes' && p.value.min > p.value.max) bad('The shortest block cannot be longer than the longest.');
    data.preferences[p.rule] = copy(p.value);
    return p.rule;
  }
};

function applyEvent(ctx, data, event) {
  const handler = HANDLERS[event.operation];
  if (!handler) fail('invalid_event', 'Unsupported Milepost event.');
  const target = handler(data, event.at, event.payload);
  log(ctx, event.operation, {event_id: event.event_id, object_id: target});
  return data;
}

module.exports = {applyEvent, EVENTS: Object.keys(HANDLERS)};
