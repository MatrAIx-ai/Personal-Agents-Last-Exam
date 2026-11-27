'use strict';
const operations = require('./operations.cjs');

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

function validateSeed(ctx, data) {
  if (!data || typeof data !== 'object') {
    throw fail('invalid_seed', 'Seed must be a non-null object.');
  }
  if (!data.account_id || !data.owner_person_id) {
    throw fail('invalid_seed', 'Seed missing required account_id or owner_person_id.');
  }
  if (ctx && ctx.binding) {
    const bound = (ctx.binding.accounts || []).some(
      (a) => a.app_id === 'health-hub' && a.account_id === data.account_id && a.owner_person_id === data.owner_person_id
    );
    if (!bound) {
      throw fail('invalid_seed', 'Account or owner_person_id is not bound in runtime binding.');
    }
  }
  if (!Array.isArray(data.daily_summaries)) {
    throw fail('invalid_seed', 'Seed missing required array: daily_summaries.');
  }

  const seenDates = new Set();
  for (const s of data.daily_summaries) {
    if (s.date < '2025-01-01') {
      throw fail('invalid_seed', `Historical data date ${s.date} is prior to allowed threshold 2025-01-01.`);
    }
    if (seenDates.has(s.date)) {
      throw fail('invalid_seed', `Duplicate daily summary date: ${s.date}`);
    }
    seenDates.add(s.date);
  }

  const checkUniqueIds = (list, key, label) => {
    const seen = new Set();
    for (const item of list || []) {
      if (seen.has(item[key])) {
        throw fail('invalid_seed', `Duplicate ${label} id: ${item[key]}`);
      }
      seen.add(item[key]);
    }
  };
  checkUniqueIds(data.workouts, 'workout_id', 'workout');
  checkUniqueIds(data.goals, 'goal_id', 'goal');
  checkUniqueIds(data.routine_templates, 'routine_id', 'routine_template');

  return { valid: true };
}

function handleTool(ctx, data, name, args) {
  let result;
  switch (name) {
    case 'health-hub.get_daily_summary':
      result = operations.getDailySummary(data, args);
      break;
    case 'health-hub.list_metrics':
      result = operations.listMetrics(data, args);
      break;
    case 'health-hub.list_workouts':
      result = operations.listWorkouts(data, args);
      break;
    case 'health-hub.plan_workout':
      result = operations.planWorkout(data, args, ctx);
      break;
    case 'health-hub.log_workout':
      result = operations.logWorkout(data, args, ctx);
      break;
    case 'health-hub.update_workout':
      result = operations.updateWorkout(data, args);
      break;
    case 'health-hub.list_goals':
      result = operations.listGoals(data, args, ctx);
      break;
    case 'health-hub.create_goal':
      result = operations.createGoal(data, args, ctx);
      break;
    case 'health-hub.update_goal':
      result = operations.updateGoal(data, args);
      break;
    case 'health-hub.list_routine_templates':
      result = operations.listRoutineTemplates(data, args);
      break;
    case 'health-hub.create_routine_template':
      result = operations.createRoutineTemplate(data, args, ctx);
      break;
    case 'health-hub.update_routine_template':
      result = operations.updateRoutineTemplate(data, args);
      break;
    case 'health-hub.list_notifications':
      result = operations.listNotifications(data);
      break;
    default:
      throw fail('unknown_tool', `Tool ${name} not recognized.`);
  }
  return { data, result };
}

function applyEvent(ctx, data, event) {
  if (event.operation !== 'health-hub.ingest_daily_sync') {
    throw fail('invalid_event', `Event operation ${event.operation} unsupported.`);
  }

  const payload = event.payload;
  const existingIndex = data.daily_summaries.findIndex((s) => s.date === payload.date);

  const summaryRecord = {
    date: payload.date,
    status: 'valid',
    metrics: {
      sleep: payload.sleep,
      recovery: payload.recovery,
      day_strain: payload.day_strain,
      body_weight_kg: payload.body_weight_kg ?? null
    }
  };

  if (existingIndex >= 0) {
    data.daily_summaries[existingIndex] = summaryRecord;
  } else {
    data.daily_summaries.push(summaryRecord);
  }

  if (!Array.isArray(data.notifications)) data.notifications = [];

  if (payload.recovery && payload.recovery.recovery_score < 35) {
    data.notifications.push({
      notification_id: `notif_${event.event_id}_rec`,
      created_at: event.at,
      type: 'low_recovery',
      message: `Recovery score is ${payload.recovery.recovery_score}%. Consider scaling back exertion.`
    });
  }

  if (Array.isArray(data.goals)) {
    for (const g of data.goals) {
      if (g.status === 'active' && g.due_date && g.due_date < event.at) {
        g.status = 'missed';
        data.notifications.push({
          notification_id: `notif_${event.event_id}_goal_${g.goal_id}`,
          created_at: event.at,
          type: 'missed_goal',
          message: `Goal '${g.title}' missed deadline ${g.due_date}.`
        });
      }
    }
  }

  return data;
}

function records(data) {
  return [
    ...(data.daily_summaries || []).map((r) => ({ type: 'daily_summary', ...r })),
    ...(data.workouts || []).map((r) => ({ type: 'workout', ...r })),
    ...(data.goals || []).map((r) => ({ type: 'goal', ...r })),
    ...(data.routine_templates || []).map((r) => ({ type: 'routine_template', ...r })),
    ...(data.notifications || []).map((r) => ({ type: 'notification', ...r }))
  ];
}

function objects(data) {
  return [
    ...(data.daily_summaries || []).map((r) => `summary:${r.date}`),
    ...(data.workouts || []).map((r) => r.workout_id),
    ...(data.goals || []).map((r) => r.goal_id),
    ...(data.routine_templates || []).map((r) => r.routine_id),
    ...(data.notifications || []).map((r) => r.notification_id)
  ];
}

function references() {
  return [];
}

function assetReferences() {
  return [];
}

module.exports = {
  validateSeed,
  handleTool,
  applyEvent,
  records,
  objects,
  references,
  assetReferences
};
