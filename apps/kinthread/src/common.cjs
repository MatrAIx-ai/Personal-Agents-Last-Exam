'use strict';
const {fail, copy, references} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');

const POWERS = ['add_members', 'remove_members', 'change_roles', 'edit_settings', 'edit_care_note', 'manage_vault_access'];
const NOTICE_TYPES = ['role_change', 'ownership_change', 'member_added', 'member_removed', 'vault_access_granted'];
const KINDS = ['person', 'assistant', 'business'];
const LEVELS = ['view', 'reveal', 'manage'];
const ITEM_KINDS = ['id_document', 'login', 'code', 'card_image', 'note'];
const CLASSIFICATIONS = ['secret', 'private', 'normal'];

function at(value, code, message) {
  const t = Date.parse(value);
  if (!Number.isFinite(t)) fail(code, message || 'Time is not a valid instant.');
  return t;
}
function nfc(value) {
  return String(value).normalize('NFC');
}
function fold(value) {
  return nfc(value).normalize('NFKC').toLocaleLowerCase('en-US');
}
function handleOf(value) {
  const raw = String(value || '').trim();
  return raw.startsWith('@') ? raw.slice(1) : raw;
}
function clockOk(ctx, instant, code) {
  if (at(instant, code || 'invalid_time') < at(ctx.virtual_now, 'invalid_time')) return;
  if (at(instant, code || 'invalid_time') > at(ctx.virtual_now, 'invalid_time')) fail(code || 'invalid_time', 'The run clock must not precede this record.');
}
function notBefore(ctx, instant) {
  if (at(instant, 'invalid_time') > at(ctx.virtual_now, 'invalid_time')) fail('invalid_time', 'The run clock must not precede the last record update.');
}
function groupOf(data, groupId) {
  const group = data.groups.find(item => item.group_id === groupId);
  if (!group) fail('not_member', 'Group is not in this account.');
  return group;
}
function memberRow(group, personId) {
  return group.members.find(item => item.person_id === personId) || null;
}
function activeMember(group, personId) {
  const member = memberRow(group, personId);
  if (!member || member.membership !== 'member') return null;
  return member;
}
function roleRow(group, role) {
  return group.role_matrix.find(item => item.role === role) || null;
}
function hasPower(group, member, power) {
  const row = roleRow(group, member.role);
  return !!(row && row.permissions.includes(power));
}
function boundPerson(ctx, personId) {
  return ctx.binding.people.some(person => person.person_id === personId);
}
function requireUser(data, group) {
  if (group.status === 'archived') fail('group_archived', 'This group is archived.');
  const member = activeMember(group, data.owner_person_id);
  if (!member) fail('not_member', 'The account owner is not an active member of this group.');
  return member;
}
function requirePower(data, group, power, missingCode) {
  const member = requireUser(data, group);
  if (!hasPower(group, member, power)) fail(missingCode || 'permission_denied', 'This role does not include that permission.');
  if (!data.assistant_permissions.includes(power)) fail('assistant_permission_denied', 'The seed does not grant this power to the assistant.');
  return member;
}
function grantStatus(grant, now) {
  const t = at(now, 'invalid_time');
  if (grant.revoked_at && at(grant.revoked_at, 'invalid_seed') <= t) return 'revoked';
  if (grant.expires_at && t >= at(grant.expires_at, 'invalid_seed')) return 'expired';
  return 'active';
}
function revealGrants(group, personId, itemId) {
  return group.grants.filter(grant => grant.vault_item_id === itemId && grant.person_id === personId && (grant.level === 'reveal' || grant.level === 'manage'));
}
function revealOutcome(group, personId, itemId, now) {
  const grants = revealGrants(group, personId, itemId);
  if (!grants.length) return 'vault_access_denied';
  if (grants.some(grant => grantStatus(grant, now) === 'active')) return 'revealed';
  if (grants.some(grant => grantStatus(grant, now) === 'expired')) return 'grant_expired';
  return 'vault_access_denied';
}
function vaultItem(group, itemId) {
  const item = group.vault_items.find(row => row.vault_item_id === itemId);
  if (!item) fail('item_not_found', 'Vault item does not exist.');
  return item;
}
function vaultField(item, name) {
  const field = item.fields.find(row => row.name === name);
  if (!field) fail('field_not_found', 'Vault field does not exist.');
  return field;
}
function mask(value) {
  const text = String(value);
  return text.slice(-2);
}
function take(data, key, prefix) {
  const n = data.seq[key];
  if (!Number.isInteger(n) || n < 1) fail('invalid_seed', 'Id counter is missing.');
  data.seq[key] = n + 1;
  return prefix + '-' + String(n).padStart(4, '0');
}
function touch(ctx, group) {
  notBefore(ctx, group.updated_at);
  group.updated_at = ctx.virtual_now;
}
function pushActivity(data, group, ctx, row) {
  const activity_id = take(data, 'activity', 'act');
  group.activity.push({
    activity_id,
    at: ctx.virtual_now,
    kind: row.kind,
    text: row.text,
    person_id: row.person_id,
    acting_via: row.acting_via || null,
    label: row.acting_via === 'assistant' ? data.assistant_label : null
  });
  return activity_id;
}
function pushChange(data, group, ctx, row) {
  const change_id = take(data, 'change', 'ch');
  group.changes.push({
    change_id,
    at: ctx.virtual_now,
    kind: row.kind,
    person_id: row.person_id || null,
    from_role: row.from_role || null,
    to_role: row.to_role || null,
    acting_via: row.acting_via || null,
    request_id: row.request_id || null,
    event_id: row.event_id || null,
    summary: row.summary
  });
  return change_id;
}
function pushNotice(data, group, ctx, row) {
  const notice_id = take(data, 'notice', 'nt');
  const notice = {
    notice_id,
    notice_type: row.notice_type,
    status: 'pending_delivery',
    created_at: ctx.virtual_now,
    group_id: group.group_id,
    recipient_person_id: data.owner_person_id,
    title: row.title,
    body: row.body,
    object_type: row.notice_type,
    object_id: row.object_id,
    delivery: null
  };
  data.notices.push(notice);
  return notice;
}
function titles(group, type) {
  return {
    role_change: 'Kinthread: a role changed in ' + group.name,
    ownership_change: 'Kinthread: ownership changed in ' + group.name,
    member_added: 'Kinthread: a member was added in ' + group.name,
    member_removed: 'Kinthread: a member left ' + group.name,
    vault_access_granted: 'Kinthread: vault access changed in ' + group.name
  }[type];
}
function clockLabel(instant) {
  return instant.slice(11, 16);
}
function memberAt(group, personId, instant) {
  const member = memberRow(group, personId);
  if (!member) return null;
  const t = at(instant, 'invalid_event');
  if (at(member.joined_at, 'invalid_seed') > t) return null;
  if (member.left_at && at(member.left_at, 'invalid_seed') <= t) return null;
  return member;
}
function profileAt(member, instant) {
  const t = at(instant, 'invalid_event');
  let chosen = null;
  for (const row of member.profile_history) {
    if (at(row.at, 'invalid_seed') <= t) chosen = row;
  }
  return chosen;
}
function roleAt(member, instant) {
  const t = at(instant, 'invalid_event');
  let chosen = null;
  for (const row of member.role_history) {
    if (at(row.at, 'invalid_seed') <= t) chosen = row;
  }
  return chosen;
}
function publicMember(member) {
  return {
    person_id: member.person_id,
    handle: member.handle,
    display_name: member.display_name,
    folded_display_name: fold(member.display_name),
    avatar_asset_id: member.avatar_asset_id,
    kind: member.kind,
    role: member.role,
    added_by: member.added_by,
    joined_at: member.joined_at,
    membership: member.membership,
    left_at: member.left_at,
    removed_by: member.removed_by,
    profile_history: copy(member.profile_history),
    role_history: copy(member.role_history)
  };
}
function publicField(field) {
  return {name: field.name, classification: field.classification, leak_check: field.leak_check, masked: mask(field.value)};
}
function publicItem(item) {
  return {
    vault_item_id: item.vault_item_id,
    kind: item.kind,
    title: item.title,
    version: item.version,
    card_asset_id: item.card_asset_id,
    fields: item.fields.map(publicField)
  };
}
function publicGrant(grant, now) {
  return {
    grant_id: grant.grant_id,
    vault_item_id: grant.vault_item_id,
    person_id: grant.person_id,
    level: grant.level,
    granted_by: grant.granted_by,
    granted_at: grant.granted_at,
    expires_at: grant.expires_at,
    revoked_at: grant.revoked_at,
    status: grantStatus(grant, now)
  };
}

module.exports = {
  POWERS, NOTICE_TYPES, KINDS, LEVELS, ITEM_KINDS, CLASSIFICATIONS,
  fail, copy, references, log, at, nfc, fold, handleOf, clockOk, notBefore,
  groupOf, memberRow, activeMember, roleRow, hasPower, boundPerson,
  requireUser, requirePower, grantStatus, revealOutcome, vaultItem, vaultField, mask, take, touch,
  pushActivity, pushChange, pushNotice, titles, clockLabel, memberAt, profileAt, roleAt,
  publicMember, publicField, publicItem, publicGrant
};
