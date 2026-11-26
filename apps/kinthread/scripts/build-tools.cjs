'use strict';
const fs = require('node:fs');
const path = require('node:path');
const id = {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
const version = {type: 'object', properties: {epoch: {type: 'integer', minimum: 1}, revision: {type: 'integer', minimum: 0}}, required: ['epoch', 'revision'], additionalProperties: false};
const request = {type: 'string', minLength: 1, maxLength: 150};
const notice = {anyOf: [id, {type: 'null'}]};
function obj(properties, required) {
  return {type: 'object', properties, required, additionalProperties: false};
}
function read(name, description, properties, required) {
  return tool(name, description, true, obj(properties, required), out('ok', required, properties));
}
function write(name, description, properties, required, resultProps, resultRequired) {
  const props = {expected_version: version, request_id: request, ...properties};
  return tool(name, description, false, obj(props, ['expected_version', 'request_id', ...required]), out('committed', resultRequired, resultProps));
}
function out(status, required, properties) {
  return obj({status: {const: status}, app_id: {const: 'kinthread'}, version, ...properties}, ['status', 'app_id', 'version', ...required]);
}
function tool(name, description, readOnly, inputSchema, outputSchema) {
  return {name, description, read_only: readOnly, scope: name, resource_target: 'current account', inputSchema, outputSchema};
}
const loose = {type: 'object'};
const looseList = {type: 'array'};
const group = ['group_id', id];
const tools = [
  read('kinthread.groups.list', 'List groups visible to the bound account.', {}, []),
  read('kinthread.groups.get', 'Read one group, its members and its role matrix.', {group_id: id}, ['group_id']),
  read('kinthread.members.list', 'List members, including people who have left, with name and role history.', {group_id: id}, ['group_id']),
  read('kinthread.members.get', 'Read one member, including display-name and avatar history.', {group_id: id, person_id: id}, ['group_id', 'person_id']),
  tool('kinthread.members.lookup', 'Find members by person id, handle or display name. Display-name lookup is NFKC and case folded and returns every match.', true, {type: 'object', oneOf: [
    obj({group_id: id, person_id: id}, ['group_id', 'person_id']),
    obj({group_id: id, handle: {type: 'string', minLength: 1, maxLength: 41}}, ['group_id', 'handle']),
    obj({group_id: id, display_name: {type: 'string', minLength: 1, maxLength: 80}}, ['group_id', 'display_name'])
  ]}, out('ok', ['group_id', 'matches'], {group_id: id, matches: looseList})),
  read('kinthread.roles.get', 'Read the permission matrix for a group.', {group_id: id}, ['group_id']),
  read('kinthread.vault.list', 'List vault items with masked field values.', {group_id: id}, ['group_id']),
  read('kinthread.vault.item.get', 'Read one vault item with masked field values.', {group_id: id, vault_item_id: id}, ['group_id', 'vault_item_id']),
  read('kinthread.vault.access.list', 'List grants. Expiry is computed from the run clock and is not stored.', {group_id: id}, ['group_id']),
  read('kinthread.notes.get', 'Read the pinned care note.', {group_id: id}, ['group_id']),
  read('kinthread.notes.history', 'Read every version of the pinned care note.', {group_id: id}, ['group_id']),
  read('kinthread.checklist.list', 'List checklist items.', {group_id: id}, ['group_id']),
  read('kinthread.activity.list', 'List group activity lines.', {group_id: id}, ['group_id'])
];
function fixReadOutputs(list) {
  const shapes = {
    'kinthread.groups.list': [['groups'], {groups: looseList}],
    'kinthread.groups.get': [['group'], {group: loose}],
    'kinthread.members.list': [['group_id', 'members'], {group_id: id, members: looseList}],
    'kinthread.members.get': [['member'], {member: loose}],
    'kinthread.roles.get': [['group_id', 'roles'], {group_id: id, roles: looseList}],
    'kinthread.vault.list': [['group_id', 'items'], {group_id: id, items: looseList}],
    'kinthread.vault.item.get': [['item'], {item: loose}],
    'kinthread.vault.access.list': [['group_id', 'grants'], {group_id: id, grants: looseList}],
    'kinthread.notes.get': [['note'], {note: loose}],
    'kinthread.notes.history': [['note_id', 'versions'], {note_id: id, versions: looseList}],
    'kinthread.checklist.list': [['group_id', 'items'], {group_id: id, items: looseList}],
    'kinthread.activity.list': [['group_id', 'items'], {group_id: id, items: looseList}]
  };
  for (const item of list) {
    if (!item.read_only || !shapes[item.name]) continue;
    const [required, properties] = shapes[item.name];
    item.outputSchema = out('ok', required, properties);
  }
}
fixReadOutputs(tools);
const settings = {type: 'object', properties: {announce_profile_changes: {type: 'boolean'}, admins_only_settings: {type: 'boolean'}}, additionalProperties: false};
tools.push(
  write('kinthread.members.add', 'Add a bound person to a group. The assistant acts as the account owner.', {group_id: id, person_id: id, handle: {type: 'string', minLength: 1, maxLength: 41}, display_name: {type: 'string', minLength: 1, maxLength: 80}, role: {type: 'string', minLength: 1, maxLength: 40}, kind: {enum: ['person', 'assistant', 'business']}, avatar_asset_id: {anyOf: [id, {type: 'null'}]}}, ['group_id', 'person_id', 'handle', 'display_name', 'role'], {group_id: id, person_id: id, notice_id: notice}, ['group_id', 'person_id', 'notice_id']),
  write('kinthread.members.remove', 'Remove a member and revoke that person\'s active grants.', {group_id: id, person_id: id}, ['group_id', 'person_id'], {group_id: id, person_id: id, notice_id: notice}, ['group_id', 'person_id', 'notice_id']),
  write('kinthread.groups.settings.update', 'Update group settings at the observed settings version.', {group_id: id, expected_object_version: {type: 'integer', minimum: 1}, settings}, ['group_id', 'expected_object_version', 'settings'], {group_id: id, settings_version: {type: 'integer'}, notice_id: notice}, ['group_id', 'settings_version', 'notice_id']),
  write('kinthread.assistant_label.update', 'Set the label shown on the assistant\'s activity lines.', {label: {type: 'string', minLength: 1, maxLength: 80}}, ['label'], {label: {type: 'string'}, notice_id: notice}, ['label', 'notice_id']),
  write('kinthread.roles.set', 'Change a member\'s role. A role change can leave a Mail notice pending until the task runner publishes it.', {group_id: id, person_id: id, role: {type: 'string', minLength: 1, maxLength: 40}}, ['group_id', 'person_id', 'role'], {group_id: id, person_id: id, role: {type: 'string'}, notice_id: notice}, ['group_id', 'person_id', 'role', 'notice_id']),
  write('kinthread.ownership.transfer', 'Transfer ownership. Only the current owner can do this.', {group_id: id, person_id: id}, ['group_id', 'person_id'], {group_id: id, owner_person_id: id, notice_id: notice}, ['group_id', 'owner_person_id', 'notice_id']),
  write('kinthread.vault.reveal', 'Return one cleartext field and record the reveal.', {group_id: id, vault_item_id: id, field: {type: 'string', minLength: 1, maxLength: 40}}, ['group_id', 'vault_item_id', 'field'], {group_id: id, vault_item_id: id, field: {type: 'string'}, value: {type: 'string'}, reveal_id: id}, ['group_id', 'vault_item_id', 'field', 'value', 'reveal_id']),
  write('kinthread.vault.access.grant', 'Grant view, reveal or manage on a vault item.', {group_id: id, vault_item_id: id, person_id: id, level: {enum: ['view', 'reveal', 'manage']}, expires_at: {anyOf: [{type: 'string', format: 'date-time'}, {type: 'null'}]}}, ['group_id', 'vault_item_id', 'person_id', 'level'], {group_id: id, grant_id: id, notice_id: notice}, ['group_id', 'grant_id', 'notice_id']),
  write('kinthread.vault.access.revoke', 'Revoke a vault grant.', {group_id: id, grant_id: id}, ['group_id', 'grant_id'], {group_id: id, grant_id: id, notice_id: notice}, ['group_id', 'grant_id', 'notice_id']),
  write('kinthread.vault.item.update', 'Edit one vault field at the observed item version.', {group_id: id, vault_item_id: id, field: {type: 'string', minLength: 1, maxLength: 40}, value: {type: 'string', minLength: 1, maxLength: 400}, expected_object_version: {type: 'integer', minimum: 1}}, ['group_id', 'vault_item_id', 'field', 'value', 'expected_object_version'], {group_id: id, vault_item_id: id, object_version: {type: 'integer'}, notice_id: notice}, ['group_id', 'vault_item_id', 'object_version', 'notice_id']),
  write('kinthread.notes.update', 'Replace the pinned care note at the observed note version.', {group_id: id, text: {type: 'string', maxLength: 8000}, expected_object_version: {type: 'integer', minimum: 1}}, ['group_id', 'text', 'expected_object_version'], {group_id: id, note_id: id, object_version: {type: 'integer'}, notice_id: notice}, ['group_id', 'note_id', 'object_version', 'notice_id']),
  write('kinthread.checklist.add', 'Add a checklist item.', {group_id: id, text: {type: 'string', minLength: 1, maxLength: 400}, assignee: {anyOf: [id, {type: 'null'}]}, due_at: {anyOf: [{type: 'string', format: 'date-time'}, {type: 'null'}]}}, ['group_id', 'text'], {group_id: id, item_id: id, item_status: {type: 'string'}, notice_id: notice}, ['group_id', 'item_id', 'item_status', 'notice_id']),
  write('kinthread.checklist.complete', 'Mark a checklist item done.', {group_id: id, item_id: id}, ['group_id', 'item_id'], {group_id: id, item_id: id, item_status: {type: 'string'}, notice_id: notice}, ['group_id', 'item_id', 'item_status', 'notice_id']),
  write('kinthread.checklist.reopen', 'Reopen a done checklist item.', {group_id: id, item_id: id}, ['group_id', 'item_id'], {group_id: id, item_id: id, item_status: {type: 'string'}, notice_id: notice}, ['group_id', 'item_id', 'item_status', 'notice_id']),
  write('kinthread.checklist.remove', 'Remove a checklist item.', {group_id: id, item_id: id}, ['group_id', 'item_id'], {group_id: id, item_id: id, item_status: {type: 'string'}, notice_id: notice}, ['group_id', 'item_id', 'item_status', 'notice_id'])
);
const target = path.join(__dirname, '..', 'tools.json');
fs.writeFileSync(target, JSON.stringify(tools, null, 2) + '\n');
console.log('Wrote ' + tools.length + ' tools.');
