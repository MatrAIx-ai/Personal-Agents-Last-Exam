'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const seed = require('../fixtures/seed.json');
const binding = require('../fixtures/binding.json');
const scenario = require('../examples/scenario.json');

const ctx = {
  app_id: 'health-hub',
  role: 'agent',
  binding,
  virtual_now: '2026-01-01T09:00:00Z'
};

test('validateSeed enforces binding and 2025-01-01 earliest date', () => {
  assert.equal(plugin.validateSeed(ctx, structuredClone(seed)).valid, true);

  const pre2025 = structuredClone(seed);
  pre2025.daily_summaries.push({ date: '2024-12-31', status: 'no_data', reason: 'device_not_worn' });
  assert.throws(() => plugin.validateSeed(ctx, pre2025), (e) => e.code === 'invalid_seed');

  const unbound = structuredClone(seed);
  unbound.account_id = 'unbound-account';
  assert.throws(() => plugin.validateSeed(ctx, unbound), (e) => e.code === 'invalid_seed');
});

test('biometric reads and explicit no_data gaps work without mutation', () => {
  const data = structuredClone(seed);
  const dec28 = plugin.handleTool(ctx, data, 'health-hub.get_daily_summary', { date: '2025-12-28' });
  assert.equal(dec28.result.summary.status, 'valid');
  assert.ok(dec28.result.summary.metrics.sleep.sleep_score > 0);

  const gap = plugin.handleTool(ctx, data, 'health-hub.get_daily_summary', { date: '2025-10-14' });
  assert.equal(gap.result.summary.status, 'no_data');
  assert.equal(gap.result.summary.reason, 'device_not_worn');

  assert.throws(
    () => plugin.handleTool(ctx, data, 'health-hub.get_daily_summary', { date: '2027-01-01' }),
    (e) => e.code === 'date_out_of_range'
  );

  const series = plugin.handleTool(ctx, data, 'health-hub.list_metrics', {
    metric_type: 'recovery',
    start_date: '2025-10-13',
    end_date: '2025-10-16'
  });
  assert.equal(series.result.series.length, 4);
  assert.equal(series.result.series[1].status, 'no_data');
});

test('workout lifecycle transitions and filtering', () => {
  let data = structuredClone(seed);
  const planned = plugin.handleTool(ctx, data, 'health-hub.plan_workout', {
    activity_type: 'cycling',
    scheduled_at: '2026-01-02T16:00:00Z',
    duration_minutes: 60
  });
  data = planned.data;
  assert.equal(planned.result.workout.status, 'planned');

  const updated = plugin.handleTool(ctx, data, 'health-hub.update_workout', {
    workout_id: planned.result.workout.workout_id,
    status: 'completed',
    avg_hr: 148
  });
  data = updated.data;
  assert.equal(updated.result.workout.status, 'completed');
  assert.equal(updated.result.workout.avg_hr, 148);

  assert.throws(
    () => plugin.handleTool(ctx, data, 'health-hub.update_workout', {
      workout_id: planned.result.workout.workout_id,
      status: 'cancelled'
    }),
    (e) => e.code === 'invalid_transition'
  );

  const logged = plugin.handleTool(ctx, data, 'health-hub.log_workout', {
    activity_type: 'running',
    duration_minutes: 35,
    perceived_exertion: 7,
    avg_hr: 155
  });
  assert.equal(logged.result.workout.status, 'completed');
});

test('goals lifecycle, target validation, and lazy missed derivation', () => {
  let data = structuredClone(seed);
  assert.throws(
    () => plugin.handleTool(ctx, data, 'health-hub.create_goal', {
      title: 'Invalid',
      metric_type: 'sleep',
      target_value: -5
    }),
    (e) => e.code === 'invalid_target_value'
  );

  const created = plugin.handleTool(ctx, data, 'health-hub.create_goal', {
    title: 'Overdue Test',
    metric_type: 'sleep',
    target_value: 480,
    due_date: '2025-12-31T23:59:59Z'
  });
  data = created.data;

  const beforeSnap = JSON.stringify(data);
  const listed = plugin.handleTool(ctx, data, 'health-hub.list_goals', {});
  assert.equal(JSON.stringify(data), beforeSnap, 'list_goals must not mutate state');
  const derived = listed.result.goals.find((g) => g.goal_id === created.result.goal.goal_id);
  assert.equal(derived.status, 'missed');
  assert.equal(derived.derived, true);

  const abandoned = plugin.handleTool(ctx, data, 'health-hub.update_goal', {
    goal_id: created.result.goal.goal_id,
    status: 'abandoned'
  });
  assert.equal(abandoned.result.goal.status, 'abandoned');
});

test('routine templates detect overlaps and enforce draft -> active -> archived', () => {
  let data = structuredClone(seed);
  assert.throws(
    () => plugin.handleTool(ctx, data, 'health-hub.update_routine_template', {
      routine_id: seed.routine_templates[0].routine_id,
      blocks: [
        { block_id: 'a', name: 'Block 1', start_offset_minutes: 0, duration_minutes: 30 },
        { block_id: 'b', name: 'Block 2', start_offset_minutes: 20, duration_minutes: 30 }
      ]
    }),
    (e) => e.code === 'routine_conflict'
  );

  const created = plugin.handleTool(ctx, data, 'health-hub.create_routine_template', {
    title: 'Evening Wind Down',
    blocks: [
      { block_id: 'b1', name: 'Stretch', start_offset_minutes: 0, duration_minutes: 15 },
      { block_id: 'b2', name: 'Read', start_offset_minutes: 15, duration_minutes: 30 }
    ]
  });
  data = created.data;
  assert.equal(created.result.routine_template.status, 'draft');

  const activated = plugin.handleTool(ctx, data, 'health-hub.update_routine_template', {
    routine_id: created.result.routine_template.routine_id,
    status: 'active'
  });
  assert.equal(activated.result.routine_template.status, 'active');
});

test('applyEvent ingests daily sync and persists low_recovery notification', () => {
  const data = structuredClone(seed);
  const after = plugin.applyEvent({ ...ctx, role: 'infra', virtual_now: scenario.at }, data, scenario);
  assert.equal(after.daily_summaries.length, seed.daily_summaries.length + 1);
  const notifs = plugin.handleTool(ctx, after, 'health-hub.list_notifications', {});
  assert.ok(notifs.result.notifications.some((n) => n.type === 'low_recovery'));
});

test('all 5 persona fixtures pass validateSeed', () => {
  const personasDir = path.join(__dirname, '../fixtures/personas');
  const files = fs.readdirSync(personasDir).filter((f) => f.endsWith('.json'));
  assert.equal(files.length, 5);
  for (const file of files) {
    const pSeed = JSON.parse(fs.readFileSync(path.join(personasDir, file), 'utf8'));
    const pCtx = {
      binding: {
        people: [{ person_id: pSeed.owner_person_id, name: 'Test' }],
        accounts: [{ app_id: 'health-hub', account_id: pSeed.account_id, owner_person_id: pSeed.owner_person_id }],
        objects: {}
      }
    };
    assert.equal(plugin.validateSeed(pCtx, pSeed).valid, true);
    assert.equal(pSeed.daily_summaries.length, 365);
    assert.equal(pSeed.daily_summaries[0].date, '2025-01-01');
  }
});
