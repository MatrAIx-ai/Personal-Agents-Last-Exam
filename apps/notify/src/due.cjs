'use strict';
// Runner helper, not an MCP tool. Core 1.2 exposes only the fixed Infra lifecycle
// operations, so a runner discovers due reminders from `env.snapshot` and then fires
// each one with `env.apply_event` at its own time, in order.
function due(snapshotData, from, to) {
  const start = Date.parse(from), end = Date.parse(to);
  return snapshotData.reminders
    .filter(r => r.status === 'scheduled' && Date.parse(r.fire_at) >= start && Date.parse(r.fire_at) < end)
    .sort((a, b) => Date.parse(a.fire_at) - Date.parse(b.fire_at) || a.id.localeCompare(b.id))
    .map(r => ({reminder_id:r.id, fire_at:r.fire_at, actionable:r.actionable}));
}

// The event a runner applies for one due reminder. The ID is stable, so a retry is deduplicated by Core.
function fireEvent(reminder) {
  return {event_id:'fire-' + reminder.reminder_id, at:reminder.fire_at, operation:'notify.reminder.fire',
    payload:{reminder_id:reminder.reminder_id}};
}

module.exports = {due, fireEvent};
