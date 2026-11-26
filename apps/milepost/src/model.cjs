'use strict';
// Record consistency, object IDs and the learner-rule inputs derived from one student's data.
const {fail, copy, references} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');
const {ms, shift, clock, overlaps, DAYS} = require('./time.cjs');
const learner = require('./learner.cjs');

const COLLECTIONS = ['courses', 'units', 'skills', 'assessments', 'results', 'practice', 'plan'];
const invalid = message => fail('invalid_seed', message);

function records(data) {
  return COLLECTIONS.flatMap(name => data[name]);
}
function objects(data) {
  return records(data).map(r => r.id);
}
function nextId(data, prefix) {
  const ids = new Set(objects(data));
  let n = 1;
  while (ids.has(prefix + '-' + n)) n++;
  return prefix + '-' + n;
}
function byId(list, id, code = 'not_found', what = 'Object', lister = null) {
  const item = list.find(x => x.id === id);
  if (!item) fail(code, what + ' does not exist for this student.' + (lister ? ` ${lister} lists the valid IDs.` : ''));
  return item;
}
const sessionInterval = s => ({start: shift(s.ended_at, -s.minutes), end: s.ended_at});
const blockInterval = b => ({start: b.start, end: shift(b.start, b.minutes)});
function blockStatus(block, now) {
  if (block.done) return 'done';
  return ms(blockInterval(block).end) <= ms(now) ? 'missed' : 'planned';
}
const resultFor = (data, assessmentId) => data.results.find(r => r.assessment_id === assessmentId) || null;

// Learner-rule inputs. `extra` holds hypothetical sessions, used only by projections.
function learnerModel(data, extra = []) {
  const entries = new Map(data.skills.map(s => [s.id, []]));
  for (const s of [...data.practice, ...extra]) entries.get(s.skill_id).push({kind: 'session', id: s.id, at: s.ended_at, minutes: s.minutes});
  for (const r of data.results) for (const x of r.levels) entries.get(x.skill_id).push({kind: 'result', id: r.id, at: r.posted_at, value: x.level});
  return learner.evaluator({
    params: data.evaluator.learner_params,
    prerequisites: new Map(data.skills.map(s => [s.id, s.prerequisites])),
    baseline: new Map(data.mastery.map(r => [r.skill_id, {m: r.level, S: r.stability_days, t0: r.as_of, last_practised_at: r.last_practised_at}])),
    entries
  });
}

function validateSeed(ctx, data) {
  references(ctx, data);
  const now = ctx.virtual_now;
  const ids = new Set();
  for (const id of objects(data)) {
    if (ids.has(id)) invalid('Every object ID must be unique.');
    ids.add(id);
  }
  const courses = new Set(data.courses.map(c => c.id)), units = new Map(data.units.map(u => [u.id, u]));
  const skills = new Map(data.skills.map(s => [s.id, s]));
  for (const u of data.units) if (!courses.has(u.course_id)) invalid('A unit refers to an unknown course.');
  for (const s of data.skills) {
    if (!units.has(s.unit_id)) invalid('A skill refers to an unknown unit.');
    if (s.prerequisites.some(p => p === s.id || !skills.has(p))) invalid('A prerequisite is missing or refers to the skill itself.');
  }
  const visiting = new Set(), done = new Set();
  const visit = id => {
    if (visiting.has(id)) invalid('Skill prerequisites cannot form a cycle.');
    if (done.has(id)) return;
    visiting.add(id); skills.get(id).prerequisites.forEach(visit); visiting.delete(id); done.add(id);
  };
  for (const id of skills.keys()) visit(id);

  const mastery = new Map();
  for (const r of data.mastery) {
    if (!skills.has(r.skill_id) || mastery.has(r.skill_id)) invalid('Each skill needs exactly one mastery record.');
    if ((r.as_of !== null && ms(r.as_of) > ms(now)) || (r.last_practised_at !== null && (r.as_of === null || ms(r.last_practised_at) > ms(r.as_of)))) {
      invalid('Mastery times must not be in the future or after the time the level refers to.');
    }
    mastery.set(r.skill_id, r);
  }
  if (mastery.size !== skills.size) invalid('Each skill needs exactly one mastery record.');
  const notBefore = (skillId, at) => {
    const base = mastery.get(skillId).as_of;
    if (base !== null && ms(at) < ms(base)) invalid('History cannot precede the seeded mastery record.');
  };

  const assessments = new Map();
  for (const a of data.assessments) {
    const targets = new Set();
    for (const t of a.targets) {
      if (!skills.has(t.skill_id) || targets.has(t.skill_id)) invalid('Assessment targets need known, distinct skills.');
      targets.add(t.skill_id);
    }
    if (ms(a.created_at) > ms(a.updated_at) || ms(a.updated_at) > ms(now)) invalid('Assessment timestamps are out of order.');
    assessments.set(a.id, {a, targets});
  }
  const assessed = new Set();
  for (const r of data.results) {
    const entry = assessments.get(r.assessment_id);
    if (!entry || assessed.has(r.assessment_id)) invalid('A result needs a known assessment, at most once.');
    assessed.add(r.assessment_id);
    if (ms(r.posted_at) < ms(entry.a.date) || ms(r.posted_at) > ms(now)) invalid('A result is posted before its assessment or in the future.');
    const seen = new Set();
    for (const x of r.levels) {
      if (!entry.targets.has(x.skill_id) || seen.has(x.skill_id)) invalid('A result may only report the assessment target skills, once each.');
      seen.add(x.skill_id); notBefore(x.skill_id, r.posted_at);
    }
  }

  const blocks = new Map(data.plan.map(b => [b.id, b]));
  for (const b of data.plan) {
    if (!skills.has(b.skill_id)) invalid('A study block refers to an unknown skill.');
    if (ms(b.created_at) > ms(b.updated_at) || ms(b.updated_at) > ms(now)) invalid('Study block timestamps are out of order.');
  }
  const plan = [...data.plan].sort((x, y) => ms(x.start) - ms(y.start));
  for (let i = 1; i < plan.length; i++) if (overlaps(blockInterval(plan[i - 1]), blockInterval(plan[i]))) invalid('Study blocks cannot overlap.');

  const namedBlocks = new Set();
  for (const s of data.practice) {
    if (!skills.has(s.skill_id)) invalid('A practice session refers to an unknown skill.');
    if (ms(s.ended_at) > ms(s.recorded_at) || ms(s.recorded_at) > ms(now)) invalid('A practice session cannot end after it was recorded or in the future.');
    notBefore(s.skill_id, sessionInterval(s).start);
    if (s.source === 'student_report' && s.block_id !== null) invalid('Student-reported practice is not linked to a study block.');
    if (s.block_id !== null) {
      const b = blocks.get(s.block_id);
      if (!b || b.skill_id !== s.skill_id || namedBlocks.has(b.id)) invalid('A completed session must name one study block of the same skill.');
      namedBlocks.add(b.id);
    }
  }
  for (const b of data.plan) if (b.done !== namedBlocks.has(b.id)) invalid('A study block is done exactly when a completed session names it.');
  const sessions = [...data.practice].sort((x, y) => ms(x.ended_at) - ms(y.ended_at));
  for (let i = 1; i < sessions.length; i++) if (overlaps(sessionInterval(sessions[i - 1]), sessionInterval(sessions[i]))) invalid('Practice sessions cannot overlap.');

  const p = data.preferences;
  if (p.block_minutes.min > p.block_minutes.max) invalid('The shortest block cannot be longer than the longest.');
  for (const w of p.available_hours) if (!(clock(w.from) < clock(w.to))) invalid('Each available window must end after it starts.');
  if (p.rest_days.some(d => !DAYS.includes(d))) invalid('Unknown rest day.');
  const q = data.evaluator.learner_params;
  if (q.min_stability_days > q.max_stability_days) invalid('Stability bounds are reversed.');
  for (const r of data.mastery) if (r.stability_days < q.min_stability_days || r.stability_days > q.max_stability_days) invalid('Seeded stability is outside the student bounds.');
}

function logEntry(ctx, data, operation, args, objectId, details) {
  data.evaluator.activity_log.push({seq: data.evaluator.activity_log.length + 1, at: ctx.virtual_now, operation,
    request_id: args.request_id, expected_version: copy(args.expected_version), object_id: objectId, details: copy(details)});
  log(ctx, operation, {object_id: objectId});
}

module.exports = {COLLECTIONS, records, objects, nextId, byId, sessionInterval, blockInterval, blockStatus, resultFor,
  learnerModel, validateSeed, logEntry, references: () => []};
