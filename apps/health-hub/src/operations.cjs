/**
 * Business operations for Personal Health & Life Hub.
 * Strictly adheres to Core runtime conventions:
 * - Return { status: "ok", ... } on success.
 * - Return { status: "<error_type>", message: "..." } on failure.
 */

function getDailySummary(state, params) {
  const { date } = params;
  const summary = state.daily_summaries.find((s) => s.date === date);
  if (!summary) {
    return { status: "not_found", message: `No summary found for date ${date}` };
  }
  return { status: "ok", summary };
}

function listMetrics(state, params) {
  const { metric_type, start_date, end_date } = params;
  const filtered = state.daily_summaries.filter(
    (s) => s.date >= start_date && s.date <= end_date
  );

  const series = filtered.map((item) => {
    if (item.status === "no_data") {
      return { date: item.date, status: "no_data", reason: item.reason || "device_not_worn" };
    }
    let value = null;
    if (metric_type === "sleep") value = item.metrics?.sleep;
    else if (metric_type === "recovery") value = item.metrics?.recovery;
    else if (metric_type === "strain") value = item.metrics?.day_strain;
    else if (metric_type === "body_weight") value = item.metrics?.body_weight_kg;

    return { date: item.date, status: "valid", [metric_type]: value };
  });

  return { status: "ok", metric_type, series };
}

function listWorkouts(state, params) {
  let list = state.workouts;
  if (params.status) {
    list = list.filter((w) => w.status === params.status);
  }
  return { status: "ok", workouts: list };
}

function planWorkout(state, params, ctx) {
  const workout_id = `wkt_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const record = {
    workout_id,
    activity_type: params.activity_type,
    scheduled_at: params.scheduled_at,
    duration_minutes: params.duration_minutes,
    status: "planned",
    created_at: ctx.virtual_now
  };
  state.workouts.push(record);
  return { status: "ok", workout: record };
}

function logWorkout(state, params, ctx) {
  const workout_id = `wkt_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const record = {
    workout_id,
    activity_type: params.activity_type,
    duration_minutes: params.duration_minutes,
    perceived_exertion: params.perceived_exertion,
    avg_hr: params.avg_hr || null,
    status: "completed",
    logged_at: ctx.virtual_now
  };
  state.workouts.push(record);
  return { status: "ok", workout: record };
}

function updateWorkout(state, params) {
  const workout = state.workouts.find((w) => w.workout_id === params.workout_id);
  if (!workout) {
    return { status: "not_found", message: `Workout ${params.workout_id} not found` };
  }
  if (params.status) workout.status = params.status;
  if (params.duration_minutes !== undefined) workout.duration_minutes = params.duration_minutes;
  if (params.perceived_exertion !== undefined) workout.perceived_exertion = params.perceived_exertion;
  if (params.avg_hr !== undefined) workout.avg_hr = params.avg_hr;

  return { status: "ok", workout };
}

function listGoals(state, params, ctx) {
  // Derive "missed" status dynamically at read time without mutating stored state
  const goals = state.goals.map((g) => {
    if (g.status === "active" && g.due_date && g.due_date < ctx.virtual_now) {
      return { ...g, status: "missed", derived: true };
    }
    return g;
  });

  if (params.status) {
    return { status: "ok", goals: goals.filter((g) => g.status === params.status) };
  }
  return { status: "ok", goals };
}

function createGoal(state, params, ctx) {
  if (params.target_value <= 0) {
    return { status: "invalid_input", message: "target_value must be greater than zero" };
  }
  const goal_id = `goal_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const goal = {
    goal_id,
    title: params.title,
    metric_type: params.metric_type,
    target_value: params.target_value,
    status: "active",
    due_date: params.due_date || null,
    created_at: ctx.virtual_now
  };
  state.goals.push(goal);
  return { status: "ok", goal };
}

function updateGoal(state, params) {
  const goal = state.goals.find((g) => g.goal_id === params.goal_id);
  if (!goal) {
    return { status: "not_found", message: `Goal ${params.goal_id} not found` };
  }
  if (params.status) goal.status = params.status;
  if (params.target_value !== undefined) {
    if (params.target_value <= 0) {
      return { status: "invalid_input", message: "target_value must be positive" };
    }
    goal.target_value = params.target_value;
  }
  return { status: "ok", goal };
}

function listRoutineTemplates(state, params) {
  let list = state.routine_templates;
  if (params.status) {
    list = list.filter((r) => r.status === params.status);
  }
  return { status: "ok", routine_templates: list };
}

function createRoutineTemplate(state, params, ctx) {
  const routine_id = `rtn_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const template = {
    routine_id,
    title: params.title,
    status: "draft",
    blocks: params.blocks || [],
    created_at: ctx.virtual_now
  };
  state.routine_templates.push(template);
  return { status: "ok", routine_template: template };
}

function updateRoutineTemplate(state, params) {
  const template = state.routine_templates.find((r) => r.routine_id === params.routine_id);
  if (!template) {
    return { status: "not_found", message: `Routine ${params.routine_id} not found` };
  }
  if (params.title) template.title = params.title;
  if (params.status) template.status = params.status;
  if (params.blocks) {
    // Conflict check within template: check for internal overlapping blocks
    const sorted = [...params.blocks].sort((a, b) => a.start_offset_minutes - b.start_offset_minutes);
    for (let i = 0; i < sorted.length - 1; i++) {
      const currentEnd = sorted[i].start_offset_minutes + sorted[i].duration_minutes;
      if (currentEnd > sorted[i + 1].start_offset_minutes) {
        return { status: "routine_conflict", message: "Template blocks overlap internally" };
      }
    }
    template.blocks = params.blocks;
  }
  return { status: "ok", routine_template: template };
}

function listNotifications(state) {
  return { status: "ok", notifications: state.notifications || [] };
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
