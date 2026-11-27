'use strict';

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

function nextId(list, key, prefix) {
  let n = (list ? list.length : 0) + 1;
  const existing = new Set((list || []).map((item) => item[key]));
  while (existing.has(`${prefix}_${n}`)) n++;
  return `${prefix}_${n}`;
}

function checkBlockOverlaps(blocks) {
  const sorted = [...blocks].sort((a, b) => a.start_offset_minutes - b.start_offset_minutes);
  for (let i = 0; i < sorted.length - 1; i++) {
    const currentEnd = sorted[i].start_offset_minutes + sorted[i].duration_minutes;
    if (currentEnd > sorted[i + 1].start_offset_minutes) {
      throw fail('routine_conflict', 'Template blocks overlap internally.');
    }
  }
}

function getDailySummary(data, params) {
  const { date } = params;
  const summary = data.daily_summaries.find((s) => s.date === date);
  if (!summary) {
    const maxDate = data.daily_summaries.reduce((m, s) => (s.date > m ? s.date : m), '2025-01-01');
    if (date < '2025-01-01' || date > maxDate) {
      throw fail('date_out_of_range', `Date ${date} is outside seeded range (2025-01-01..${maxDate}).`);
    }
    throw fail('not_found', `No summary found for date ${date}.`);
  }
  return { summary };
}

function listMetrics(data, params) {
  const { metric_type, start_date, end_date } = params;
  if (start_date > end_date) {
    throw fail('invalid_input', 'start_date must not be after end_date.');
  }
  const filtered = data.daily_summaries.filter(
    (s) => s.date >= start_date && s.date <= end_date
  );

  const series = filtered.map((item) => {
    if (item.status === 'no_data') {
      return { date: item.date, status: 'no_data', reason: item.reason || 'device_not_worn' };
    }
    let value = null;
    if (metric_type === 'sleep') value = item.metrics?.sleep ?? null;
    else if (metric_type === 'recovery') value = item.metrics?.recovery ?? null;
    else if (metric_type === 'strain') value = item.metrics?.day_strain ?? null;
    else if (metric_type === 'body_weight') value = item.metrics?.body_weight_kg ?? null;

    return { date: item.date, status: 'valid', [metric_type]: value };
  });

  return { metric_type, series };
}

function listWorkouts(data, params = {}) {
  let list = data.workouts || [];
  if (params.status) {
    list = list.filter((w) => w.status === params.status);
  }
  if (params.start_date) {
    list = list.filter((w) => {
      const d = (w.scheduled_at || w.logged_at || '').slice(0, 10);
      return d && d >= params.start_date;
    });
  }
  if (params.end_date) {
    list = list.filter((w) => {
      const d = (w.scheduled_at || w.logged_at || '').slice(0, 10);
      return d && d <= params.end_date;
    });
  }
  return { workouts: list };
}

function planWorkout(data, params, ctx) {
  const workout_id = nextId(data.workouts, 'workout_id', 'wkt');
  const record = {
    workout_id,
    activity_type: params.activity_type,
    scheduled_at: params.scheduled_at,
    duration_minutes: params.duration_minutes,
    status: 'planned',
    created_at: ctx.virtual_now
  };
  data.workouts.push(record);
  return { workout: record };
}

function logWorkout(data, params, ctx) {
  const workout_id = nextId(data.workouts, 'workout_id', 'wkt');
  const record = {
    workout_id,
    activity_type: params.activity_type,
    duration_minutes: params.duration_minutes,
    perceived_exertion: params.perceived_exertion,
    status: 'completed',
    logged_at: ctx.virtual_now
  };
  if (params.avg_hr !== undefined && params.avg_hr !== null) {
    record.avg_hr = params.avg_hr;
  }
  data.workouts.push(record);
  return { workout: record };
}

function updateWorkout(data, params) {
  const workout = data.workouts.find((w) => w.workout_id === params.workout_id);
  if (!workout) {
    throw fail('not_found', `Workout ${params.workout_id} not found.`);
  }
  if (params.status) {
    if (workout.status !== 'planned' && params.status !== workout.status) {
      throw fail('invalid_transition', `Cannot transition workout from ${workout.status} to ${params.status}.`);
    }
    workout.status = params.status;
  }
  if (params.duration_minutes !== undefined) workout.duration_minutes = params.duration_minutes;
  if (params.perceived_exertion !== undefined) workout.perceived_exertion = params.perceived_exertion;
  if (params.avg_hr !== undefined) workout.avg_hr = params.avg_hr;

  return { workout };
}

function listGoals(data, params = {}, ctx) {
  const goals = (data.goals || []).map((g) => {
    if (g.status === 'active' && g.due_date && ctx?.virtual_now && g.due_date < ctx.virtual_now) {
      return { ...g, status: 'missed', derived: true };
    }
    return g;
  });

  if (params.status) {
    return { goals: goals.filter((g) => g.status === params.status) };
  }
  return { goals };
}

function createGoal(data, params, ctx) {
  if (params.target_value <= 0) {
    throw fail('invalid_target_value', 'target_value must be greater than zero.');
  }
  const goal_id = nextId(data.goals, 'goal_id', 'goal');
  const goal = {
    goal_id,
    title: params.title,
    metric_type: params.metric_type,
    target_value: params.target_value,
    status: 'active',
    created_at: ctx.virtual_now
  };
  if (params.due_date) goal.due_date = params.due_date;
  data.goals.push(goal);
  return { goal };
}

function updateGoal(data, params) {
  const goal = data.goals.find((g) => g.goal_id === params.goal_id);
  if (!goal) {
    throw fail('not_found', `Goal ${params.goal_id} not found.`);
  }
  if (params.status) {
    if (goal.status !== 'active' && params.status !== goal.status) {
      throw fail('invalid_transition', `Cannot transition goal from ${goal.status} to ${params.status}.`);
    }
    goal.status = params.status;
  }
  if (params.target_value !== undefined) {
    if (params.target_value <= 0) {
      throw fail('invalid_target_value', 'target_value must be greater than zero.');
    }
    goal.target_value = params.target_value;
  }
  return { goal };
}

function listRoutineTemplates(data, params = {}) {
  let list = data.routine_templates || [];
  if (params.status) {
    list = list.filter((r) => r.status === params.status);
  }
  return { routine_templates: list };
}

function createRoutineTemplate(data, params, ctx) {
  const blocks = params.blocks || [];
  checkBlockOverlaps(blocks);
  const routine_id = nextId(data.routine_templates, 'routine_id', 'rtn');
  const template = {
    routine_id,
    title: params.title,
    status: 'draft',
    blocks,
    created_at: ctx.virtual_now
  };
  data.routine_templates.push(template);
  return { routine_template: template };
}

function updateRoutineTemplate(data, params) {
  const template = data.routine_templates.find((r) => r.routine_id === params.routine_id);
  if (!template) {
    throw fail('not_found', `Routine ${params.routine_id} not found.`);
  }
  if (params.blocks) {
    checkBlockOverlaps(params.blocks);
    template.blocks = params.blocks;
  }
  if (params.title) template.title = params.title;
  if (params.status) {
    const allowed = {
      draft: ['draft', 'active', 'archived'],
      active: ['active', 'archived'],
      archived: ['archived']
    };
    if (!allowed[template.status]?.includes(params.status)) {
      throw fail('invalid_transition', `Cannot transition routine template from ${template.status} to ${params.status}.`);
    }
    template.status = params.status;
  }
  return { routine_template: template };
}

function listNotifications(data) {
  return { notifications: data.notifications || [] };
}

module.exports = {
  getDailySummary,
  listMetrics,
  listWorkouts,
  planWorkout,
  logWorkout,
  updateWorkout,
  listGoals,
  createGoal,
  updateGoal,
  listRoutineTemplates,
  createRoutineTemplate,
  updateRoutineTemplate,
  listNotifications
};
