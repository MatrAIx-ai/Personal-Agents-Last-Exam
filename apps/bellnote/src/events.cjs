'use strict';
// Incoming events from the office, the cafeteria and the other guardian. Each is handled at its
// own time (ctx.virtual_now === event.at in runtime 1.6.0). Any business refusal is reported as
// invalid_event and Core rolls back data and clock.
const c = require('./common.cjs');
const attendance = require('./attendance.cjs'), forms = require('./forms.cjs'), pickup = require('./pickup.cjs');
const lunch = require('./lunch.cjs'), account = require('./account.cjs');
const HANDLERS = {
  'bellnote.attendance.marked': [attendance.marked, p => p.child_id],
  'bellnote.absence.reviewed': [attendance.reviewed, p => p.report_id],
  'bellnote.form.published': [forms.published, p => p.form_id],
  'bellnote.form.changed': [forms.changed, p => p.form_id],
  'bellnote.form.answered': [forms.answered, p => p.form_id],
  'bellnote.pickup.person_reviewed': [pickup.reviewed, p => p.pickup_person_id],
  'bellnote.dismissal.recorded': [pickup.recorded, p => p.change_id],
  'bellnote.lunch.charged': [lunch.charged, p => p.transaction_id],
  'bellnote.school.day_changed': [account.dayChanged, p => p.school_id]
};
function applyEvent(ctx, data, event) {
  const entry = HANDLERS[event.operation];
  if (!entry) c.fail('invalid_event', 'Unsupported Bellnote event.');
  if (ctx.virtual_now !== undefined && Date.parse(ctx.virtual_now) !== Date.parse(event.at)) c.fail('invalid_event', 'The event must be handled at its own time.');
  try {
    const row = c.activity(ctx, data, {actor: 'event', action: 'event.' + event.operation.slice('bellnote.'.length), object_id: entry[1](event.payload), event_id: event.event_id});
    entry[0](ctx, data, event, row);
    c.log(ctx, 'bellnote.event_prepared', {event_id: event.event_id, operation: event.operation});
    return data;
  } catch (e) {
    if (e.code === 'invalid_event') throw e;
    c.fail('invalid_event', e.message);
  }
}
module.exports = {applyEvent, EVENT_TYPES: Object.keys(HANDLERS)};
