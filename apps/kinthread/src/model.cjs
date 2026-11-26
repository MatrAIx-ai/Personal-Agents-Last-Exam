'use strict';
const c = require('./common.cjs');

function timeOk(value, now, code) {
  const t = c.at(value, code);
  if (t > now) c.fail(code, 'History is dated after the seed clock.');
  return t;
}
function ordered(rows, now, code) {
  let prev = -Infinity;
  for (const row of rows) {
    const t = timeOk(row.at, now, code);
    if (t < prev) c.fail(code, 'History times go backwards.');
    prev = t;
  }
}
function unique(rows, field, code) {
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row[field])) c.fail(code, 'Duplicate ' + field + '.');
    seen.add(row[field]);
  }
}

function validateSeed(ctx, data) {
  c.references(ctx, data);
  const now = c.at(ctx.virtual_now, 'invalid_seed');
  if (!data.assistant_label || data.assistant_label.length > 80) c.fail('invalid_seed', 'Assistant label is missing.');
  if (!Array.isArray(data.assistant_permissions) || data.assistant_permissions.some(power => !c.POWERS.includes(power))) c.fail('invalid_seed', 'Unknown assistant permission.');
  if (new Set(data.assistant_permissions).size !== data.assistant_permissions.length) c.fail('invalid_seed', 'Duplicate assistant permission.');
  ordered(data.label_history, now, 'invalid_seed');
  if (!data.label_history.length || data.label_history[data.label_history.length - 1].label !== data.assistant_label) c.fail('invalid_seed', 'Label history must end at the current label.');
  for (const key of ['notice', 'reveal', 'activity', 'change', 'grant', 'checklist']) {
    if (!Number.isInteger(data.seq[key]) || data.seq[key] < 1) c.fail('invalid_seed', 'Id counter is missing.');
  }
  unique(data.groups, 'group_id', 'invalid_seed');
  unique(data.notices, 'notice_id', 'invalid_seed');
  for (const notice of data.notices) {
    if (!c.NOTICE_TYPES.includes(notice.notice_type)) c.fail('invalid_seed', 'Unknown notice type.');
    timeOk(notice.created_at, now, 'invalid_seed');
    if (!data.groups.some(group => group.group_id === notice.group_id)) c.fail('invalid_seed', 'Notice names an unknown group.');
    if (notice.recipient_person_id !== data.owner_person_id) c.fail('invalid_seed', 'Notices are addressed to the account owner.');
    if (notice.status === 'pending_delivery' && notice.delivery) c.fail('invalid_seed', 'A pending notice has no delivery result.');
    if (notice.status === 'recorded' && !notice.delivery) c.fail('invalid_seed', 'A recorded notice needs a delivery result.');
    if (notice.delivery && notice.delivery.recorded_at) timeOk(notice.delivery.recorded_at, now, 'invalid_seed');
  }
  for (const group of data.groups) {
    timeOk(group.created_at, now, 'invalid_seed');
    const updated = timeOk(group.updated_at, now, 'invalid_seed');
    if (updated < c.at(group.created_at, 'invalid_seed')) c.fail('invalid_seed', 'Group timestamps are reversed.');
    if (!group.messages_conversation_id) c.fail('invalid_seed', 'Group needs a Messages conversation id.');
    unique(group.role_matrix, 'role', 'invalid_seed');
    if (!group.role_matrix.some(row => row.role === 'owner')) c.fail('invalid_seed', 'Role matrix needs an owner role.');
    for (const row of group.role_matrix) {
      if (row.permissions.some(power => !c.POWERS.includes(power))) c.fail('invalid_seed', 'Unknown permission.');
      if (new Set(row.permissions).size !== row.permissions.length) c.fail('invalid_seed', 'Duplicate permission.');
    }
    const owners = group.members.filter(member => member.membership === 'member' && member.role === 'owner');
    if (owners.length !== 1) c.fail('invalid_seed', 'A group has exactly one active owner.');
    unique(group.members, 'person_id', 'invalid_seed');
    unique(group.members, 'handle', 'invalid_seed');
    for (const member of group.members) {
      if (!c.boundPerson(ctx, member.person_id) || !c.boundPerson(ctx, member.added_by)) c.fail('invalid_seed', 'Member person is not in the binding.');
      if (!c.KINDS.includes(member.kind)) c.fail('invalid_seed', 'Unknown member kind.');
      if (!c.roleRow(group, member.role)) c.fail('invalid_seed', 'Member role is not in the matrix.');
      if (member.display_name.normalize('NFC') !== member.display_name) c.fail('invalid_seed', 'Display names are stored in NFC.');
      if (!/^[a-z][a-z0-9-]{1,40}$/.test(member.handle)) c.fail('invalid_seed', 'Handle is not a lowercase token.');
      const joined = timeOk(member.joined_at, now, 'invalid_seed');
      if (member.membership === 'member' && member.left_at) c.fail('invalid_seed', 'Active members have no left time.');
      if (member.membership !== 'member') {
        if (!member.left_at || timeOk(member.left_at, now, 'invalid_seed') < joined) c.fail('invalid_seed', 'Closed membership needs a later left time.');
      }
      if (Array.isArray(member.membership_intervals) && member.membership_intervals.length) {
        let prev = -Infinity;
        for (const row of member.membership_intervals) {
          const start = timeOk(row.joined_at, now, 'invalid_seed');
          if (start < prev) c.fail('invalid_seed', 'Membership intervals go backwards.');
          if (row.left_at) {
            const end = timeOk(row.left_at, now, 'invalid_seed');
            if (end < start) c.fail('invalid_seed', 'A membership interval ends before it starts.');
            prev = end;
          } else prev = start;
        }
        const last = member.membership_intervals[member.membership_intervals.length - 1];
        if (last.joined_at !== member.joined_at || (last.left_at || null) !== (member.left_at || null)) c.fail('invalid_seed', 'The latest membership interval must match the current join and leave times.');
      }
      ordered(member.profile_history, now, 'invalid_seed');
      ordered(member.role_history, now, 'invalid_seed');
      const profile = member.profile_history[member.profile_history.length - 1];
      const role = member.role_history[member.role_history.length - 1];
      if (!profile || profile.display_name !== member.display_name || profile.avatar_asset_id !== member.avatar_asset_id) c.fail('invalid_seed', 'Profile history must end at the current profile.');
      if (!role || role.role !== member.role) c.fail('invalid_seed', 'Role history must end at the current role.');
    }
    unique(group.vault_items, 'vault_item_id', 'invalid_seed');
    for (const item of group.vault_items) {
      if (!c.ITEM_KINDS.includes(item.kind) || !Number.isInteger(item.version) || item.version < 1) c.fail('invalid_seed', 'Vault item is incomplete.');
      unique(item.fields, 'name', 'invalid_seed');
      for (const field of item.fields) {
        if (!c.CLASSIFICATIONS.includes(field.classification) || typeof field.leak_check !== 'boolean') c.fail('invalid_seed', 'Vault field is incomplete.');
        if (!field.history.length) c.fail('invalid_seed', 'Vault field needs history.');
        ordered(field.history, now, 'invalid_seed');
        if (field.history[field.history.length - 1].value !== field.value) c.fail('invalid_seed', 'Vault history must end at the current value.');
      }
    }
    unique(group.grants, 'grant_id', 'invalid_seed');
    for (const grant of group.grants) {
      if (!group.vault_items.some(item => item.vault_item_id === grant.vault_item_id)) c.fail('invalid_seed', 'Grant names an unknown item.');
      if (!c.memberRow(group, grant.person_id)) c.fail('invalid_seed', 'Grant names an unknown member.');
      if (!c.LEVELS.includes(grant.level)) c.fail('invalid_seed', 'Unknown grant level.');
      timeOk(grant.granted_at, now, 'invalid_seed');
      if (grant.revoked_at) timeOk(grant.revoked_at, now, 'invalid_seed');
    }
    unique(group.reveals, 'reveal_id', 'invalid_seed');
    for (const reveal of group.reveals) {
      const item = group.vault_items.find(row => row.vault_item_id === reveal.vault_item_id);
      if (!item || !item.fields.some(field => field.name === reveal.field)) c.fail('invalid_seed', 'Reveal names an unknown field.');
      if (!['revealed', 'vault_access_denied', 'grant_expired'].includes(reveal.outcome)) c.fail('invalid_seed', 'Unknown reveal outcome.');
      timeOk(reveal.at, now, 'invalid_seed');
    }
    const note = group.note;
    if (!note.history.length || note.history[note.history.length - 1].version !== note.version || note.history[note.history.length - 1].text !== note.text) c.fail('invalid_seed', 'Note history must end at the current text.');
    let expected = 1;
    let prev = -Infinity;
    for (const row of note.history) {
      if (row.version !== expected) c.fail('invalid_seed', 'Note versions must be contiguous from 1.');
      const t = timeOk(row.at, now, 'invalid_seed');
      if (t < prev) c.fail('invalid_seed', 'Note history times go backwards.');
      prev = t;
      expected += 1;
    }
    timeOk(note.updated_at, now, 'invalid_seed');
    unique(group.checklist, 'item_id', 'invalid_seed');
    for (const item of group.checklist) {
      if (!['open', 'done', 'reopened', 'removed'].includes(item.status)) c.fail('invalid_seed', 'Unknown checklist status.');
      if (item.due_at) c.at(item.due_at, 'invalid_seed');
      ordered(item.history, now, 'invalid_seed');
    }
    unique(group.activity, 'activity_id', 'invalid_seed');
    ordered(group.activity, now, 'invalid_seed');
    unique(group.changes, 'change_id', 'invalid_seed');
    ordered(group.changes, now, 'invalid_seed');
    if (!Number.isInteger(group.settings_version) || group.settings_version < 1) c.fail('invalid_seed', 'Settings version is missing.');
  }
}

function records(data) {
  return data.groups;
}
function objects(data) {
  return data.groups.map(group => group.group_id);
}
function assetReferences(data) {
  const refs = [];
  for (const group of data.groups) {
    const seen = new Set();
    const add = asset_id => {
      if (!asset_id || seen.has(asset_id)) return;
      seen.add(asset_id);
      refs.push({asset_id, object_id: group.group_id, object_type: 'group'});
    };
    for (const member of group.members) {
      add(member.avatar_asset_id);
      for (const row of member.profile_history) add(row.avatar_asset_id);
    }
    for (const item of group.vault_items) add(item.card_asset_id);
  }
  return refs;
}

module.exports = {validateSeed, records, objects, references: () => [], assetReferences};
