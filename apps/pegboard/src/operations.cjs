'use strict';
// Tool dispatch. Handlers work on the copy Core supplies; a read never changes it.
const { fail } = require('./util.cjs');
const schedule = require('./schedule.cjs'), timeoff = require('./timeoff.cjs'), handoffs = require('./handoffs.cjs'), notifications = require('./notifications.cjs');
const { log } = require('./diagnostics.cjs');

const handlers = {
  'workplace.get': schedule.workplace, 'team.list': schedule.team, 'shifts.list': schedule.list, 'shifts.get': schedule.get,
  'hours.summary': schedule.hours, 'eligibility.check': schedule.check, 'availability.get': timeoff.getAvailability, 'time_off.list': timeoff.list,
  'handoffs.list': handoffs.list, 'handoffs.get': handoffs.get, 'notifications.list': notifications.list, 'preferences.get': notifications.getPreferences,
  'availability.update': timeoff.updateAvailability, 'time_off.request': timeoff.request, 'time_off.cancel': timeoff.cancel,
  'handoffs.cover': handoffs.cover, 'handoffs.trade': handoffs.trade, 'handoffs.release': handoffs.release, 'handoffs.pickup': handoffs.pickup,
  'handoffs.respond': handoffs.respond, 'handoffs.cancel': handoffs.cancel, 'preferences.update': notifications.updatePreferences,
};

function handleTool(ctx, data, name, args = {}) {
  const short = String(name).startsWith('pegboard.') ? name.slice(9) : '', handler = handlers[short];
  if (!handler) fail('not_found', 'Unknown Pegboard tool ' + name + '.');
  const result = handler(ctx, data, args);
  log(ctx, 'pegboard.' + short.replace(/\./g, '_') + '.prepared', typeof result.id === 'string' ? { object_id: result.id } : {});
  return { data, result };
}

module.exports = { handleTool, tools: Object.keys(handlers) };
