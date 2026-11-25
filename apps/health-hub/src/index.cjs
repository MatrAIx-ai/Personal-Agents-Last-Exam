const operations = require("./operations.cjs");

/**
 * Six Core Registry Hooks required by the MatrAIx platform:
 * 1. validateSeed(seed, ctx)
 * 2. handleTool(name, params, ctx)
 * 3. applyEvent(event, ctx)
 * 4. records(ctx)
 * 5. objects(ctx)
 * 6. references(ctx)
 */

function validateSeed(seed) {
  if (!seed || typeof seed !== "object") {
    throw new Error("Seed must be a non-null object");
  }
  if (!seed.account_id || !seed.owner_person_id) {
    throw new Error("Seed missing required account_id or owner_person_id");
  }
  if (!Array.isArray(seed.daily_summaries)) {
    throw new Error("Seed missing required array: daily_summaries");
  }

  // Validate earliest historical data constraint (on or after 2025-01-01)
  for (const s of seed.daily_summaries) {
    if (s.date < "2025-01-01") {
      throw new Error(`Historical data date ${s.date} is prior to allowed threshold 2025-01-01`);
    }
  }

  return { valid: true };
}

function handleTool(name, params, ctx) {
  const state = ctx.state;
  switch (name) {
    case "health-hub.get_daily_summary":
      return operations.getDailySummary(state, params);
    case "health-hub.list_metrics":
      return operations.listMetrics(state, params);
    case "health-hub.list_workouts":
      return operations.listWorkouts(state, params);
    case "health-hub.plan_workout":
      return operations.planWorkout(state, params, ctx);
    case "health-hub.log_workout":
      return operations.logWorkout(state, params, ctx);
    case "health-hub.update_workout":
      return operations.updateWorkout(state, params);
    case "health-hub.list_goals":
      return operations.listGoals(state, params, ctx);
    case "health-hub.create_goal":
      return operations.createGoal(state, params, ctx);
    case "health-hub.update_goal":
      return operations.updateGoal(state, params);
    case "health-hub.list_routine_templates":
      return operations.listRoutineTemplates(state, params);
    case "health-hub.create_routine_template":
      return operations.createRoutineTemplate(state, params, ctx);
    case "health-hub.update_routine_template":
      return operations.updateRoutineTemplate(state, params);
    case "health-hub.list_notifications":
      return operations.listNotifications(state);
    default:
      return { status: "unknown_tool", message: `Tool ${name} not recognized` };
  }
}

function applyEvent(event, ctx) {
  const state = ctx.state;
  if (event.operation === "health-hub.ingest_daily_sync") {
    const payload = event.payload;
    const existingIndex = state.daily_summaries.findIndex((s) => s.date === payload.date);

    const summaryRecord = {
      date: payload.date,
      status: "valid",
      metrics: {
        sleep: payload.sleep,
        recovery: payload.recovery,
        day_strain: payload.day_strain,
        body_weight_kg: payload.body_weight_kg || null
      }
    };

    if (existingIndex >= 0) {
      state.daily_summaries[existingIndex] = summaryRecord;
    } else {
      state.daily_summaries.push(summaryRecord);
    }

    // Persist lifecycle notifications during write/event cycle
    if (!state.notifications) state.notifications = [];

    // Low recovery alert
    if (payload.recovery && payload.recovery.recovery_score < 35) {
      state.notifications.push({
        notification_id: `notif_${Date.now()}_rec`,
        created_at: event.at,
        type: "low_recovery",
        message: `Recovery score is ${payload.recovery.recovery_score}%. Consider scaling back exertion.`
      });
    }

    // Check goals that passed their due date and commit status
    if (Array.isArray(state.goals)) {
      for (const g of state.goals) {
        if (g.status === "active" && g.due_date && g.due_date < event.at) {
          g.status = "missed";
          state.notifications.push({
            notification_id: `notif_${Date.now()}_goal`,
            created_at: event.at,
            type: "missed_goal",
            message: `Goal '${g.title}' missed deadline ${g.due_date}.`
          });
        }
      }
    }

    return { status: "ok", applied: true };
  }

  return { status: "unsupported_event", message: `Event operation ${event.operation} unsupported` };
}

function records(ctx) {
  const state = ctx.state;
  return [
    ...(state.daily_summaries || []).map((r) => ({ type: "daily_summary", ...r })),
    ...(state.workouts || []).map((r) => ({ type: "workout", ...r })),
    ...(state.goals || []).map((r) => ({ type: "goal", ...r })),
    ...(state.routine_templates || []).map((r) => ({ type: "routine_template", ...r })),
    ...(state.notifications || []).map((r) => ({ type: "notification", ...r }))
  ];
}

function objects(ctx) {
  const state = ctx.state;
  return {
    daily_summaries: state.daily_summaries || [],
    workouts: state.workouts || [],
    goals: state.goals || [],
    routine_templates: state.routine_templates || [],
    notifications: state.notifications || []
  };
}

function references(ctx) {
  const state = ctx.state;
  const refs = [];
  if (state.owner_person_id) {
    refs.push({ type: "person", id: state.owner_person_id });
  }
  for (const w of state.workouts || []) {
    if (w.linked_calendar_event_id) {
      refs.push({ type: "calendar_event", id: w.linked_calendar_event_id });
    }
  }
  return refs;
}

module.exports = {
  validateSeed,
  handleTool,
  applyEvent,
  records,
  objects,
  references
};
