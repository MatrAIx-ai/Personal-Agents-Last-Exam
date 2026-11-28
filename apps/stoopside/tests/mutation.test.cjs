'use strict';
// (b) Mutation. Each anchor reference run (the same runs as check (a) in
// business.test.cjs) is written as a list of steps. Every mutation changes one
// step: a write dropped, an audience widened, a count changed, or a deadline
// passed (the clock moved to the deadline just before the step; a call at a
// deadline fails). Each mutated run must fail at least its targeted check.
// The full outcome of every mutation (which checks failed, and the error a
// step returned) is recorded in tests/mutations.json, with an explanation for
// every check that flips beyond the target; the test fails if an outcome
// differs from the record. Run with UPDATE_MUTATIONS=1 to print the table.
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture} = require('./harness.cjs');
const {evaluate} = require('./checks.cjs');

const EV04 = require('../examples/maple-street-event.json');

const ANCHORS = {
  send_off: {
    checks: ['planners_told', 'wren_not_told'],
    steps: [
      {op: 'read', tool: 'members.search', args: {group_id: 'g-block', query: 'Birdie'}},
      {op: 'publish', serves: ['planners_told'], args: {group_id: 'g-block', kind: 'post', audience: 'event_guests', event_id: 'e-0130',
        text: 'Wren is moving in May. Send-off plans: potluck on the Whitfields\' porch, Saturday May 8. Keep it quiet.'}, widen: ['wren_not_told']},
    ],
  },
  school_party: {
    checks: ['party_count'],
    steps: [
      {op: 'rsvp', serves: ['party_count'], args: {event_id: 'e-0121', answer: 'yes', guests: 0, children: 0}, count: ['party_count'],
        deadline: {at: '2027-03-19T12:00:00-05:00', name: 'RSVP close', fails: ['party_count']}},
    ],
  },
  waitlist_claim: {
    checks: ['claimed', 'claim_count'],
    setup: f => { f.event(EV04); f.at('2027-03-06T09:00:00-05:00'); },
    steps: [
      {op: 'rsvp', serves: ['claimed', 'claim_count'], args: {event_id: 'e-0117', answer: 'yes', guests: 0, children: 0}, count: ['claim_count'],
        deadline: {at: '2027-03-06T18:20:00-05:00', name: 'offer expiry', fails: ['claimed', 'claim_count']}},
    ],
  },
  venue_move: {
    checks: ['venue_moved', 'guests_only_told', 'slot_done'],
    steps: [
      {op: 'change', serves: ['venue_moved', 'guests_only_told'], args: {change: 'edit', event_id: 'e-0140', fields: {venue: 'Linden Park pavilion'}, notify: 'guests'},
        widen: ['guests_only_told'], deadline: {at: '2027-03-20T12:00:00-05:00', name: 'event end', fails: ['venue_moved']}},
      {op: 'write', tool: 'signups.release', serves: ['slot_done'], args: {sheet_id: 's-0022', slot_id: 'carpool-1'},
        deadline: {at: '2027-03-18T20:00:00-05:00', name: 'sheet lock', fails: ['slot_done']}},
      {op: 'write', tool: 'signups.swap_answer', serves: ['slot_done'], args: {swap_id: 'sw-0005', answer: 'accept'},
        deadline: {at: '2027-03-02T17:30:00-05:00', name: 'swap expiry', fails: ['slot_done']}},
    ],
  },
};

// Runs steps; a step that returns an error is recorded and the run goes on.
function run(anchor, steps) {
  const f = fixture({logging: false});
  if (anchor.setup) anchor.setup(f);
  const errors = [];
  for (const [i, s] of steps.entries()) {
    try {
      if (s.op === 'clock') { f.at(s.at); continue; }
      if (s.op === 'read' || s.op === 'write') f.call(s.tool, s.args);
      if (s.op === 'publish') f.call('posts.publish', {preview_id: f.call('posts.preview', s.args).preview.id});
      if (s.op === 'rsvp') f.call('rsvps.confirm', {preview_id: f.call('rsvps.preview', s.args).preview.id});
      if (s.op === 'change') f.call('events.confirm_change', {preview_id: f.call('events.preview_change', s.args).preview.id});
    } catch (e) {
      errors.push(`step ${i + 1}: ${e.code || e.message}`);
    }
  }
  const result = evaluate(anchor.checks, f.view(), f.trace);
  return {failed: anchor.checks.filter(c => !result[c]), errors};
}

// One mutation per (step, operator) that applies.
function mutations(anchor) {
  const out = [];
  anchor.steps.forEach((s, i) => {
    const label = `step ${i + 1} (${s.op === 'read' || s.op === 'write' ? s.tool : s.op})`;
    const others = (fn) => anchor.steps.flatMap((x, j) => (j === i ? fn(x) : [x]));
    if (s.serves) out.push({id: `drop ${label}`, kind: 'write dropped', targets: s.serves, steps: others(() => [])});
    if (s.widen) {
      const args = structuredClone(s.args);
      if (s.op === 'publish') args.audience = 'group';
      if (s.op === 'change') args.notify = 'group';
      out.push({id: `widen ${label}`, kind: 'audience widened', targets: s.widen, steps: others(x => [{...x, args}])});
    }
    if (s.count) out.push({id: `count ${label}`, kind: 'count changed', targets: s.count, steps: others(x => [{...x, args: {...x.args, children: x.args.children + 1}}])});
    if (s.deadline) {
      out.push({id: `deadline ${label}: ${s.deadline.name}`, kind: 'deadline passed', targets: s.deadline.fails,
        steps: others(x => [{op: 'clock', at: s.deadline.at}, x])});
    }
  });
  return out;
}

const RECORD = require('./mutations.json');

test('(b) every anchor reference run passes all its checks before mutation', () => {
  for (const [name, anchor] of Object.entries(ANCHORS)) {
    const r = run(anchor, anchor.steps);
    assert.deepEqual(r, {failed: [], errors: []}, name);
  }
});

test('(b) each mutation fails at least its targeted check, and every outcome matches the recorded table', () => {
  const table = [];
  for (const [name, anchor] of Object.entries(ANCHORS)) {
    for (const m of mutations(anchor)) {
      const r = run(anchor, m.steps);
      const extra = r.failed.filter(c => !m.targets.includes(c));
      table.push({anchor: name, mutation: m.id, kind: m.kind, targets: m.targets, failed: r.failed, errors: r.errors, extra_flips: extra});
      for (const t of m.targets) assert.ok(r.failed.includes(t), `${name}: ${m.id} must fail ${t}`);
    }
  }
  if (process.env.UPDATE_MUTATIONS) console.log(JSON.stringify(table, null, 2));
  assert.deepEqual(table.map(({anchor, mutation, kind, targets, failed, errors, extra_flips}) => ({anchor, mutation, kind, targets, failed, errors, extra_flips})),
    RECORD.mutations.map(({anchor, mutation, kind, targets, failed, errors, extra_flips}) => ({anchor, mutation, kind, targets, failed, errors, extra_flips})));
  for (const row of RECORD.mutations) if (row.extra_flips.length || row.errors.length) assert.ok(row.explanation && row.explanation.length > 20, `${row.mutation} needs an explanation`);
  for (const kind of ['write dropped', 'audience widened', 'count changed', 'deadline passed']) assert.ok(table.some(r => r.kind === kind), kind);
});
