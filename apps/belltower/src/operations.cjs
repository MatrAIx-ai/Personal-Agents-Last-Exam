'use strict';
// Tool dispatch. Handlers work on the copy Core supplies; a read never changes it.
const { fail } = require('./util.cjs');
const items = require('./items.cjs'), follows = require('./follows.cjs'), reading = require('./reading.cjs'), notifications = require('./notifications.cjs');
const { log } = require('./diagnostics.cjs');

const handlers = {
  'sources.list': items.sources, 'areas.list': items.areas, 'items.list': items.list, 'items.get': items.get,
  'follows.list': follows.list, 'reading.list': reading.marks, 'clippings.list': reading.clippings,
  'notifications.list': notifications.list, 'preferences.get': notifications.getPreferences,
  'follows.create': follows.create, 'follows.update': follows.update, 'follows.remove': follows.remove, 'preferences.update': notifications.updatePreferences,
  'reading.mark': reading.mark, 'clippings.add': reading.add, 'clippings.update': reading.update, 'clippings.remove': reading.remove,
};

function handleTool(ctx, data, name, args = {}) {
  const short = String(name).startsWith('belltower.') ? name.slice(10) : '', handler = handlers[short];
  if (!handler) fail('not_found', 'Unknown Belltower tool ' + name + '.');
  const result = handler(ctx, data, args);
  log(ctx, 'belltower.' + short.replace(/\./g, '_') + '.prepared', typeof result.id === 'string' ? { object_id: result.id } : {});
  return { data, result };
}

module.exports = { handleTool, tools: Object.keys(handlers) };
