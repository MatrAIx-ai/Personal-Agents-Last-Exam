'use strict';
// Agent-facing tool dispatch. Reads return the data unchanged; writes change the working copy
// that Core validates and commits (with its own request_id / expected_version checks).
const c = require('./common.cjs');
const attendance = require('./attendance.cjs'), forms = require('./forms.cjs'), pickup = require('./pickup.cjs');
const lunch = require('./lunch.cjs'), account = require('./account.cjs');
const READS = {
  'bellnote.children.list': account.children,
  'bellnote.schools.get': account.schoolGet,
  'bellnote.attendance.list': attendance.list,
  'bellnote.absences.list': attendance.reports,
  'bellnote.forms.list': forms.list,
  'bellnote.forms.get': forms.get,
  'bellnote.pickup.get': pickup.get,
  'bellnote.lunch.account_get': lunch.accountGet,
  'bellnote.menu.list': lunch.menu,
  'bellnote.payments.list': account.payments,
  'bellnote.notifications.list': account.notifications,
  'bellnote.preferences.get': account.preferences
};
const WRITES = {
  'bellnote.absences.report': attendance.report,
  'bellnote.absences.cancel': attendance.cancel,
  'bellnote.forms.respond': forms.respond,
  'bellnote.forms.withdraw': forms.withdraw,
  'bellnote.pickup.person_add': pickup.addPerson,
  'bellnote.pickup.person_remove': pickup.removePerson,
  'bellnote.dismissal.set': pickup.set,
  'bellnote.dismissal.cancel': pickup.cancel,
  'bellnote.lunch.topup': lunch.topup,
  'bellnote.lunch.settings_update': lunch.settings,
  'bellnote.preferences.update': account.updatePreferences
};
function handleTool(ctx, data, name, args) {
  if (READS[name]) return {data, result: READS[name](ctx, data, args)};
  if (WRITES[name]) {
    const result = WRITES[name](ctx, data, args);
    c.log(ctx, 'bellnote.write_prepared', {tool: name, object_id: result.id});
    return {data, result};
  }
  c.fail('unknown_tool', 'Unknown Bellnote operation.');
}
module.exports = {handleTool, READS, WRITES};
