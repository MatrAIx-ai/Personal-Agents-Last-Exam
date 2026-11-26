'use strict';
// Learner rule v1 (milepost-learner/1), as pinned in proposals/environment/practice-platform.md.
// Adapted from LearnerAgentBench's TransparentLearnerModel (commit ff3807a): one skill per session;
// posted results, removal and the replay order are Milepost additions. Pure functions only.
const VERSION = 'milepost-learner/1';
const DAY_MS = 86400000;
const ms = iso => Date.parse(iso);

function retention(state, at, p) {
  if (state.t0 === null) return 1;
  const days = Math.max(0, (ms(at) - ms(state.t0)) / DAY_MS);
  return Math.pow(p.retention_base, days / state.S);
}

function level(state, at, p) {
  return state.m * retention(state, at, p);
}

// A practice session of `minutes` that ended at `at`; `prereq` is the lowest prerequisite level at its start.
function practice(state, minutes, at, prereq, p) {
  const R = retention(state, at, p), a = state.m * R;
  const effectiveness = p.prerequisite_floor + (1 - p.prerequisite_floor) * Math.max(0, Math.min(1, prereq));
  const m = Math.min(1, a + p.learning_rate * (minutes / 60) * (1 - a) * effectiveness);
  const S = Math.min(p.max_stability_days, Math.max(p.min_stability_days, state.S * (1 + p.stability_growth + p.spacing_bonus * (1 - R))));
  return {m, S, t0: at, last_practised_at: at};
}

// A posted result sets the level at its own time; stability and the last-practised time are unchanged.
function result(state, value, at) {
  return {m: value, S: state.S, t0: at, last_practised_at: state.last_practised_at};
}

// Entries are applied in time order: sessions at their end, results at their posting, a result after a
// session at the same instant, then by ID.
function order(a, b) {
  return ms(a.at) - ms(b.at) || (a.kind === 'result') - (b.kind === 'result') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

// model: {params, prerequisites: Map(skill -> [skill]), baseline: Map(skill -> {m,S,t0,last_practised_at}),
//         entries: Map(skill -> [{kind:'session'|'result', id, at, minutes?, value?}])}
function evaluator(model) {
  const memo = new Map();
  function stateAt(skill, at) {
    const key = skill + '|' + ms(at);
    if (memo.has(key)) return memo.get(key);
    let state = {...model.baseline.get(skill)};
    const list = (model.entries.get(skill) || []).filter(e => ms(e.at) <= ms(at)).sort(order);
    for (const e of list) {
      if (e.kind === 'session') {
        const start = new Date(ms(e.at) - e.minutes * 60000).toISOString();
        const prereqs = model.prerequisites.get(skill) || [];
        const P = prereqs.length ? Math.min(...prereqs.map(id => level(stateAt(id, start), start, model.params))) : 1;
        state = practice(state, e.minutes, e.at, P, model.params);
      } else state = result(state, e.value, e.at);
    }
    memo.set(key, state);
    return state;
  }
  return {stateAt, levelAt: (skill, at) => level(stateAt(skill, at), at, model.params)};
}

const round3 = x => Math.round(x * 1000) / 1000;
module.exports = {VERSION, retention, level, practice, result, order, evaluator, round3};
