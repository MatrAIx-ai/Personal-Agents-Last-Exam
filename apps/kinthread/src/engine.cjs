'use strict';
const c = require('./common.cjs');

function seenGroup(data, groupId) {
  const group = c.groupOf(data, groupId);
  if (!c.activeMember(group, data.owner_person_id)) c.fail('not_member', 'The account owner is not an active member of this group.');
  return group;
}

function reads(ctx, data, name, args) {
  if (name === 'kinthread.groups.list') {
    const groups = data.groups.filter(group => c.memberRow(group, data.owner_person_id)).map(group => {
      const owner = c.memberRow(group, data.owner_person_id);
      const historical = owner.membership !== 'member' && owner.left_at;
      const memberCount = historical
        ? c.countedAtDeparture(group, owner)
        : group.members.filter(member => member.membership === 'member').length;
      return {
        group_id: group.group_id,
        name: group.name,
        status: group.status,
        messages_conversation_id: group.messages_conversation_id,
        settings: c.copy(group.settings),
        settings_version: group.settings_version,
        member_count: memberCount,
        owner_membership: owner.membership,
        owner_left_at: owner.left_at,
        updated_at: historical ? owner.left_at : group.updated_at,
        as_of: historical ? owner.left_at : group.updated_at
      };
    });
    return {groups};
  }
  if (name === 'kinthread.groups.get') {
    const group = seenGroup(data, args.group_id);
    return {group: {
      group_id: group.group_id,
      name: group.name,
      status: group.status,
      messages_conversation_id: group.messages_conversation_id,
      created_at: group.created_at,
      updated_at: group.updated_at,
      settings: c.copy(group.settings),
      settings_version: group.settings_version,
      role_matrix: c.copy(group.role_matrix),
      members: group.members.map(c.publicMember),
      note_version: group.note.version,
      checklist_open: group.checklist.filter(item => item.status === 'open' || item.status === 'reopened').length
    }};
  }
  if (name === 'kinthread.members.list') {
    const group = seenGroup(data, args.group_id);
    return {group_id: group.group_id, members: group.members.map(c.publicMember)};
  }
  if (name === 'kinthread.members.get') {
    const group = seenGroup(data, args.group_id);
    const member = c.memberRow(group, args.person_id);
    if (!member) c.fail('not_member', 'That person is not in this group.');
    return {member: c.publicMember(member)};
  }
  if (name === 'kinthread.members.lookup') {
    const group = seenGroup(data, args.group_id);
    let matches = [];
    if (args.person_id) matches = group.members.filter(member => member.person_id === args.person_id);
    else if (args.handle) {
      const handle = c.handleOf(args.handle);
      matches = group.members.filter(member => member.handle === handle);
    } else {
      const folded = c.fold(args.display_name);
      matches = group.members.filter(member => c.fold(member.display_name) === folded);
    }
    return {group_id: group.group_id, matches: matches.map(c.publicMember)};
  }
  if (name === 'kinthread.roles.get') {
    const group = seenGroup(data, args.group_id);
    return {group_id: group.group_id, roles: c.copy(group.role_matrix)};
  }
  if (name === 'kinthread.vault.list') {
    const group = seenGroup(data, args.group_id);
    return {group_id: group.group_id, items: group.vault_items.map(c.publicItem)};
  }
  if (name === 'kinthread.vault.item.get') {
    const group = seenGroup(data, args.group_id);
    return {item: c.publicItem(c.vaultItem(group, args.vault_item_id))};
  }
  if (name === 'kinthread.vault.access.list') {
    const group = seenGroup(data, args.group_id);
    return {group_id: group.group_id, grants: group.grants.map(grant => c.publicGrant(grant, ctx.virtual_now))};
  }
  if (name === 'kinthread.notes.get') {
    const group = seenGroup(data, args.group_id);
    return {note: {note_id: group.note.note_id, version: group.note.version, text: group.note.text, updated_at: group.note.updated_at, updated_by: group.note.updated_by}};
  }
  if (name === 'kinthread.notes.history') {
    const group = seenGroup(data, args.group_id);
    return {note_id: group.note.note_id, versions: c.copy(group.note.history)};
  }
  if (name === 'kinthread.checklist.list') {
    const group = seenGroup(data, args.group_id);
    return {group_id: group.group_id, items: c.copy(group.checklist)};
  }
  if (name === 'kinthread.activity.list') {
    const group = seenGroup(data, args.group_id);
    return {group_id: group.group_id, items: c.copy(group.activity)};
  }
  return null;
}

function finish(data, result) {
  return {data, result};
}

function addMemberRecord(data, group, ctx, spec) {
  const display_name = c.nfc(spec.display_name);
  const avatar = spec.avatar_asset_id || null;
  const member = {
    person_id: spec.person_id,
    handle: c.handleOf(spec.handle),
    display_name,
    avatar_asset_id: avatar,
    kind: spec.kind || 'person',
    role: spec.role,
    added_by: spec.added_by,
    joined_at: ctx.virtual_now,
    membership: 'member',
    left_at: null,
    removed_by: null,
    profile_history: [{at: ctx.virtual_now, display_name, avatar_asset_id: avatar}],
    role_history: [{at: ctx.virtual_now, role: spec.role, changed_by: spec.added_by, acting_via: spec.acting_via || null}]
  };
  group.members.push(member);
  return member;
}

function closeMembership(group, member, ctx, reason, removedBy) {
  const intervals = c.ensureIntervals(member);
  const open = intervals[intervals.length - 1];
  open.left_at = ctx.virtual_now;
  member.membership = reason;
  member.left_at = ctx.virtual_now;
  member.removed_by = removedBy || null;
  for (const grant of group.grants) {
    if (grant.person_id === member.person_id && c.grantStatus(grant, ctx.virtual_now) === 'active') grant.revoked_at = ctx.virtual_now;
  }
}

function reopenMember(existing, ctx, spec) {
  const handle = c.handleOf(spec.handle);
  if (existing.handle !== handle) c.fail('handle_immutable', 'The handle stays with this person.');
  const intervals = c.ensureIntervals(existing);
  intervals.push({joined_at: ctx.virtual_now, left_at: null});
  existing.display_name = c.nfc(spec.display_name);
  existing.avatar_asset_id = spec.avatar_asset_id || null;
  existing.kind = spec.kind || existing.kind;
  existing.role = spec.role;
  existing.added_by = spec.added_by;
  existing.joined_at = ctx.virtual_now;
  existing.membership = 'member';
  existing.left_at = null;
  existing.removed_by = null;
  existing.profile_history.push({at: ctx.virtual_now, display_name: existing.display_name, avatar_asset_id: existing.avatar_asset_id});
  existing.role_history.push({at: ctx.virtual_now, role: spec.role, changed_by: spec.added_by, acting_via: spec.acting_via || null});
  return existing;
}

function setRole(member, ctx, role, changedBy, via) {
  const from = member.role;
  member.role = role;
  member.role_history.push({at: ctx.virtual_now, role, changed_by: changedBy, acting_via: via || null});
  return from;
}

function writes(ctx, data, name, args) {
  const via = 'assistant';
  const request_id = args.request_id;
  if (name === 'kinthread.members.add') {
    const group = c.groupOf(data, args.group_id);
    const actor = c.requirePower(data, group, 'add_members', 'permission_denied');
    if (!c.boundPerson(ctx, args.person_id)) c.fail('person_not_bound', 'That person is not in the run binding.');
    if (!c.KINDS.includes(args.kind || 'person')) c.fail('invalid_arguments', 'Unknown member kind.');
    if (!c.roleRow(group, args.role) || args.role === 'owner') c.fail('invalid_arguments', 'Choose a non-owner role from this group.');
    const handle = c.handleOf(args.handle);
    if (!/^[a-z][a-z0-9-]{1,40}$/.test(handle)) c.fail('invalid_arguments', 'Handle must be a short lowercase token.');
    const existing = c.memberRow(group, args.person_id);
    if (existing && existing.membership === 'member') c.fail('already_member', 'That person is already a member.');
    if (group.members.some(member => member.handle === handle && member.person_id !== args.person_id)) c.fail('invalid_arguments', 'Handle is already used in this group.');
    let member;
    if (existing) {
      member = reopenMember(existing, ctx, {handle, display_name: args.display_name, avatar_asset_id: args.avatar_asset_id || null, kind: args.kind || 'person', role: args.role, added_by: actor.person_id, acting_via: via});
    } else {
      member = addMemberRecord(data, group, ctx, {person_id: args.person_id, handle, display_name: args.display_name, avatar_asset_id: args.avatar_asset_id || null, kind: args.kind || 'person', role: args.role, added_by: actor.person_id, acting_via: via});
    }
    const changeId = c.pushChange(data, group, ctx, {kind: 'member_added', person_id: member.person_id, to_role: member.role, acting_via: via, request_id, summary: 'Added @' + member.handle});
    const notice = c.pushNotice(data, group, ctx, {notice_type: 'member_added', title: c.titles(group, 'member_added'), body: data.assistant_label + ' added @' + member.handle + ' as ' + member.role + ' at ' + c.clockLabel(ctx.virtual_now) + '.', object_id: changeId});
    c.pushActivity(data, group, ctx, {kind: 'member_added', text: data.assistant_label + ' added @' + member.handle + '.', person_id: actor.person_id, acting_via: via});
    c.touch(ctx, group);
    c.log(ctx, 'kinthread.member_added', {group_id: group.group_id, person_id: member.person_id});
    return finish(data, {group_id: group.group_id, person_id: member.person_id, notice_id: notice.notice_id});
  }
  if (name === 'kinthread.members.remove') {
    const group = c.groupOf(data, args.group_id);
    const actor = c.requirePower(data, group, 'remove_members', 'permission_denied');
    const target = c.memberRow(group, args.person_id);
    if (!target || target.membership !== 'member') c.fail('not_member', 'That person is not an active member.');
    if (target.role === 'owner') c.fail('cannot_remove_owner', 'The owner cannot be removed.');
    closeMembership(group, target, ctx, 'removed', actor.person_id);
    const changeId = c.pushChange(data, group, ctx, {kind: 'member_removed', person_id: target.person_id, from_role: target.role, acting_via: via, request_id, summary: 'Removed @' + target.handle});
    const notice = c.pushNotice(data, group, ctx, {notice_type: 'member_removed', title: c.titles(group, 'member_removed'), body: data.assistant_label + ' removed @' + target.handle + ' at ' + c.clockLabel(ctx.virtual_now) + '.', object_id: changeId});
    c.pushActivity(data, group, ctx, {kind: 'member_removed', text: data.assistant_label + ' removed @' + target.handle + '.', person_id: actor.person_id, acting_via: via});
    c.touch(ctx, group);
    return finish(data, {group_id: group.group_id, person_id: target.person_id, notice_id: notice.notice_id});
  }
  if (name === 'kinthread.groups.settings.update') {
    const group = c.groupOf(data, args.group_id);
    const actor = c.requirePower(data, group, 'edit_settings', 'permission_denied');
    if (group.settings.admins_only_settings && !['owner', 'admin'].includes(actor.role)) c.fail('permission_denied', 'Only an admin can change settings in this group.');
    const patch = args.settings || {};
    if (!('announce_profile_changes' in patch) && !('admins_only_settings' in patch)) c.fail('invalid_arguments', 'Settings patch must contain a field.');
    if (args.expected_object_version !== group.settings_version) c.fail('stale_version', 'Group settings version is stale.');
    if ('announce_profile_changes' in patch) group.settings.announce_profile_changes = patch.announce_profile_changes;
    if ('admins_only_settings' in patch) group.settings.admins_only_settings = patch.admins_only_settings;
    group.settings_version += 1;
    c.pushChange(data, group, ctx, {kind: 'settings', person_id: actor.person_id, acting_via: via, request_id, summary: 'Updated group settings.'});
    c.pushActivity(data, group, ctx, {kind: 'settings', text: data.assistant_label + ' updated group settings.', person_id: actor.person_id, acting_via: via});
    c.touch(ctx, group);
    return finish(data, {group_id: group.group_id, settings_version: group.settings_version, notice_id: null});
  }
  if (name === 'kinthread.assistant_label.update') {
    const label = String(args.label || '').trim();
    if (!label || label.length > 80) c.fail('invalid_arguments', 'Assistant label must be 1 to 80 characters.');
    data.assistant_label = label;
    data.label_history.push({at: ctx.virtual_now, label, request_id});
    c.log(ctx, 'kinthread.assistant_label', {changed: true});
    return finish(data, {label, notice_id: null});
  }
  if (name === 'kinthread.roles.set') {
    const group = c.groupOf(data, args.group_id);
    c.requirePower(data, group, 'change_roles', 'role_required');
    const target = c.activeMember(group, args.person_id);
    if (!target) c.fail('not_member', 'That person is not an active member.');
    if (target.role === 'owner' || args.role === 'owner') c.fail('sole_owner', 'Ownership changes use ownership transfer.');
    if (!c.roleRow(group, args.role)) c.fail('invalid_arguments', 'Unknown role.');
    if (target.role === args.role) {
      c.pushChange(data, group, ctx, {kind: 'role', person_id: target.person_id, from_role: target.role, to_role: args.role, acting_via: via, request_id, summary: 'Role unchanged.'});
      c.touch(ctx, group);
      return finish(data, {group_id: group.group_id, person_id: target.person_id, role: target.role, notice_id: null});
    }
    const from = setRole(target, ctx, args.role, data.owner_person_id, via);
    const changeId = c.pushChange(data, group, ctx, {kind: 'role', person_id: target.person_id, from_role: from, to_role: args.role, acting_via: via, request_id, summary: 'Role changed.'});
    const notice = c.pushNotice(data, group, ctx, {notice_type: 'role_change', title: c.titles(group, 'role_change'), body: 'Your assistant changed @' + target.handle + ' from ' + from + ' to ' + args.role + ' at ' + c.clockLabel(ctx.virtual_now) + '.', object_id: changeId});
    c.pushActivity(data, group, ctx, {kind: 'role', text: data.assistant_label + ' changed @' + target.handle + ' from ' + from + ' to ' + args.role + '.', person_id: data.owner_person_id, acting_via: via});
    c.touch(ctx, group);
    c.log(ctx, 'kinthread.role_set', {group_id: group.group_id, person_id: target.person_id});
    return finish(data, {group_id: group.group_id, person_id: target.person_id, role: args.role, notice_id: notice.notice_id});
  }
  if (name === 'kinthread.ownership.transfer') {
    const group = c.groupOf(data, args.group_id);
    if (group.status === 'archived') c.fail('group_archived', 'This group is archived.');
    const actor = c.activeMember(group, data.owner_person_id);
    if (!actor) c.fail('not_member', 'The account owner is not an active member of this group.');
    if (actor.role !== 'owner') c.fail('owner_only', 'Only the owner can transfer ownership.');
    if (!data.assistant_permissions.includes('change_roles')) c.fail('assistant_permission_denied', 'The seed does not grant this power to the assistant.');
    const target = c.activeMember(group, args.person_id);
    if (!target) c.fail('not_member', 'That person is not an active member.');
    if (target.person_id === actor.person_id) c.fail('sole_owner', 'The owner already holds this group.');
    const previous = target.role;
    setRole(actor, ctx, 'admin', actor.person_id, via);
    setRole(target, ctx, 'owner', actor.person_id, via);
    const changeId = c.pushChange(data, group, ctx, {kind: 'ownership', person_id: target.person_id, from_role: previous, to_role: 'owner', acting_via: via, request_id, summary: 'Ownership transferred.'});
    const notice = c.pushNotice(data, group, ctx, {notice_type: 'ownership_change', title: c.titles(group, 'ownership_change'), body: 'Your assistant transferred ownership to @' + target.handle + ' at ' + c.clockLabel(ctx.virtual_now) + '.', object_id: changeId});
    c.pushActivity(data, group, ctx, {kind: 'ownership', text: data.assistant_label + ' transferred ownership to @' + target.handle + '.', person_id: actor.person_id, acting_via: via});
    c.touch(ctx, group);
    return finish(data, {group_id: group.group_id, owner_person_id: target.person_id, notice_id: notice.notice_id});
  }
  if (name === 'kinthread.vault.reveal') {
    const group = c.groupOf(data, args.group_id);
    const actor = c.requireUser(data, group);
    const item = c.vaultItem(group, args.vault_item_id);
    const field = c.vaultField(item, args.field);
    const outcome = c.revealOutcome(group, actor.person_id, item.vault_item_id, ctx.virtual_now);
    if (outcome !== 'revealed') c.fail(outcome, outcome === 'grant_expired' ? 'The vault grant has expired.' : 'Vault access does not allow this reveal.');
    const reveal_id = c.take(data, 'reveal', 'rv');
    group.reveals.push({reveal_id, at: ctx.virtual_now, vault_item_id: item.vault_item_id, field: field.name, person_id: actor.person_id, acting_via: via, outcome: 'revealed', request_id, event_id: null});
    c.pushActivity(data, group, ctx, {kind: 'vault_reveal', text: data.assistant_label + ' revealed ' + field.name + ' on ' + item.title + '.', person_id: actor.person_id, acting_via: via});
    c.touch(ctx, group);
    c.log(ctx, 'kinthread.vault_reveal', {group_id: group.group_id, vault_item_id: item.vault_item_id, field: field.name});
    return finish(data, {group_id: group.group_id, vault_item_id: item.vault_item_id, field: field.name, value: field.value, reveal_id});
  }
  if (name === 'kinthread.vault.access.grant') {
    const group = c.groupOf(data, args.group_id);
    const actor = c.requirePower(data, group, 'manage_vault_access', 'grant_requires_manager');
    const item = c.vaultItem(group, args.vault_item_id);
    const grantee = c.activeMember(group, args.person_id);
    if (!grantee) c.fail('not_member', 'That person is not an active member.');
    if (!c.LEVELS.includes(args.level)) c.fail('invalid_arguments', 'Unknown grant level.');
    if (args.expires_at && c.at(args.expires_at, 'invalid_arguments') <= c.at(ctx.virtual_now, 'invalid_time')) c.fail('invalid_arguments', 'Grant expiry must be in the future.');
    const grant_id = c.take(data, 'grant', 'gr');
    group.grants.push({grant_id, vault_item_id: item.vault_item_id, person_id: grantee.person_id, level: args.level, granted_by: actor.person_id, granted_at: ctx.virtual_now, expires_at: args.expires_at || null, revoked_at: null});
    const changeId = c.pushChange(data, group, ctx, {kind: 'grant', person_id: grantee.person_id, acting_via: via, request_id, vault_item_id: item.vault_item_id, grant_level: args.level, summary: 'Granted ' + args.level + ' on ' + item.vault_item_id});
    const notice = c.pushNotice(data, group, ctx, {notice_type: 'vault_access_granted', title: c.titles(group, 'vault_access_granted'), body: 'Your assistant granted ' + args.level + ' on ' + item.title + ' to @' + grantee.handle + ' at ' + c.clockLabel(ctx.virtual_now) + '.', object_id: changeId});
    c.pushActivity(data, group, ctx, {kind: 'grant', text: data.assistant_label + ' granted ' + args.level + ' on ' + item.title + ' to @' + grantee.handle + '.', person_id: actor.person_id, acting_via: via});
    c.touch(ctx, group);
    return finish(data, {group_id: group.group_id, grant_id, notice_id: notice.notice_id});
  }
  if (name === 'kinthread.vault.access.revoke') {
    const group = c.groupOf(data, args.group_id);
    const actor = c.requirePower(data, group, 'manage_vault_access', 'grant_requires_manager');
    const grant = group.grants.find(row => row.grant_id === args.grant_id);
    if (!grant) c.fail('item_not_found', 'Grant does not exist.');
    if (c.grantStatus(grant, ctx.virtual_now) === 'revoked') c.fail('invalid_arguments', 'Grant is already revoked.');
    grant.revoked_at = ctx.virtual_now;
    c.pushChange(data, group, ctx, {kind: 'grant_revoked', person_id: grant.person_id, acting_via: via, request_id, summary: 'Revoked ' + grant.grant_id});
    c.pushActivity(data, group, ctx, {kind: 'grant_revoked', text: data.assistant_label + ' revoked vault access ' + grant.grant_id + '.', person_id: actor.person_id, acting_via: via});
    c.touch(ctx, group);
    return finish(data, {group_id: group.group_id, grant_id: grant.grant_id, notice_id: null});
  }
  if (name === 'kinthread.vault.item.update') {
    const group = c.groupOf(data, args.group_id);
    const actor = c.requirePower(data, group, 'manage_vault_access', 'grant_requires_manager');
    const item = c.vaultItem(group, args.vault_item_id);
    const field = c.vaultField(item, args.field);
    if (args.expected_object_version !== item.version) c.fail('stale_version', 'Vault item version is stale.');
    if (typeof args.value !== 'string' || !args.value.length || args.value.length > 400) c.fail('invalid_arguments', 'Vault value must be 1 to 400 characters.');
    field.value = args.value;
    field.history.push({at: ctx.virtual_now, value: args.value, changed_by: actor.person_id});
    item.version += 1;
    c.pushChange(data, group, ctx, {kind: 'vault_item', person_id: actor.person_id, acting_via: via, request_id, summary: 'Updated ' + item.vault_item_id + ' ' + field.name});
    c.pushActivity(data, group, ctx, {kind: 'vault_item', text: data.assistant_label + ' updated ' + field.name + ' on ' + item.title + '.', person_id: actor.person_id, acting_via: via});
    c.touch(ctx, group);
    return finish(data, {group_id: group.group_id, vault_item_id: item.vault_item_id, object_version: item.version, notice_id: null});
  }
  if (name === 'kinthread.notes.update') {
    const group = c.groupOf(data, args.group_id);
    const actor = c.requirePower(data, group, 'edit_care_note', 'role_required');
    if (args.expected_object_version !== group.note.version) c.fail('stale_version', 'Care note version is stale.');
    if (typeof args.text !== 'string' || args.text.length > 8000) c.fail('invalid_arguments', 'Note text is too long.');
    const version = group.note.version + 1;
    group.note.version = version;
    group.note.text = args.text;
    group.note.updated_at = ctx.virtual_now;
    group.note.updated_by = actor.person_id;
    group.note.history.push({version, at: ctx.virtual_now, text: args.text, person_id: actor.person_id});
    c.pushChange(data, group, ctx, {kind: 'note', person_id: actor.person_id, acting_via: via, request_id, summary: 'Note version ' + version});
    c.pushActivity(data, group, ctx, {kind: 'note', text: data.assistant_label + ' updated the care note to version ' + version + '.', person_id: actor.person_id, acting_via: via});
    c.touch(ctx, group);
    return finish(data, {group_id: group.group_id, note_id: group.note.note_id, object_version: version, notice_id: null});
  }
  if (name === 'kinthread.checklist.add') return finish(data, checklistWrite(ctx, data, args, 'add'));
  if (name === 'kinthread.checklist.complete') return finish(data, checklistWrite(ctx, data, args, 'complete'));
  if (name === 'kinthread.checklist.reopen') return finish(data, checklistWrite(ctx, data, args, 'reopen'));
  if (name === 'kinthread.checklist.remove') return finish(data, checklistWrite(ctx, data, args, 'remove'));
  c.fail('unknown_tool', 'Unknown business operation.');
}

function checklistWrite(ctx, data, args, action) {
  const group = c.groupOf(data, args.group_id);
  const actor = c.requirePower(data, group, 'edit_care_note', 'role_required');
  const via = 'assistant';
  if (action === 'add') {
    if (typeof args.text !== 'string' || !args.text.trim() || args.text.length > 400) c.fail('invalid_arguments', 'Checklist text must be 1 to 400 characters.');
    if (args.assignee && !c.activeMember(group, args.assignee)) c.fail('not_member', 'Assignee is not an active member.');
    const item_id = c.take(data, 'checklist', 'ck');
    group.checklist.push({item_id, text: args.text, status: 'open', assignee: args.assignee || null, due_at: args.due_at || null, history: [{at: ctx.virtual_now, action: 'add', person_id: actor.person_id, text: args.text}]});
    c.pushActivity(data, group, ctx, {kind: 'checklist', text: data.assistant_label + ' added a checklist item.', person_id: actor.person_id, acting_via: via});
    c.touch(ctx, group);
    return {group_id: group.group_id, item_id, item_status: 'open', notice_id: null};
  }
  const item = group.checklist.find(row => row.item_id === args.item_id);
  if (!item || item.status === 'removed') c.fail('item_not_found', 'Checklist item does not exist.');
  if (action === 'complete' && !['open', 'reopened'].includes(item.status)) c.fail('invalid_arguments', 'Only an open item can be completed.');
  if (action === 'reopen' && item.status !== 'done') c.fail('invalid_arguments', 'Only a done item can be reopened.');
  item.status = action === 'complete' ? 'done' : action === 'reopen' ? 'reopened' : 'removed';
  item.history.push({at: ctx.virtual_now, action, person_id: actor.person_id});
  c.pushActivity(data, group, ctx, {kind: 'checklist', text: data.assistant_label + ' updated checklist item ' + item.item_id + '.', person_id: actor.person_id, acting_via: via});
  c.touch(ctx, group);
  return {group_id: group.group_id, item_id: item.item_id, item_status: item.status, notice_id: null};
}

function otherActor(ctx, group, personId, power) {
  if (!c.boundPerson(ctx, personId)) c.fail('invalid_event', 'Unknown person.');
  const member = c.activeMember(group, personId);
  if (!member || !c.hasPower(group, member, power)) c.fail('invalid_event', 'That member cannot apply this change.');
  return member;
}

function requireOpen(group) {
  if (group.status === 'archived') c.fail('group_archived', 'This group is archived.');
}

function applyBusinessEvent(ctx, data, event) {
  const payload = event.payload || {};
  const group = data.groups.find(item => item.group_id === payload.group_id);
  if (event.operation !== 'notice.delivery_result' && !group) c.fail('invalid_event', 'Unknown group.');
  if (event.operation !== 'notice.delivery_result') requireOpen(group);
  if (event.operation === 'member.profile_changed') {
    if (payload.display_name === undefined && payload.avatar_asset_id === undefined) c.fail('invalid_event', 'A profile change needs a name or an avatar.');
    const member = c.memberRow(group, payload.person_id);
    if (!member || member.membership !== 'member') c.fail('not_member', 'That person is not an active member.');
    if (payload.display_name !== undefined) member.display_name = c.nfc(payload.display_name);
    if (payload.avatar_asset_id !== undefined) member.avatar_asset_id = payload.avatar_asset_id;
    member.profile_history.push({at: ctx.virtual_now, display_name: member.display_name, avatar_asset_id: member.avatar_asset_id});
    if (group.settings.announce_profile_changes) {
      c.pushActivity(data, group, ctx, {kind: 'profile', text: '@' + member.handle + ' changed their name to ' + member.display_name + '.', person_id: member.person_id, acting_via: null});
    }
    c.pushChange(data, group, ctx, {kind: 'profile', person_id: member.person_id, event_id: event.event_id, summary: 'Profile changed.'});
    c.touch(ctx, group);
    return data;
  }
  if (event.operation === 'member.joined') {
    const actor = otherActor(ctx, group, payload.added_by, 'add_members');
    if (!c.boundPerson(ctx, payload.person_id)) c.fail('invalid_event', 'Unknown person.');
    if (!c.roleRow(group, payload.role) || payload.role === 'owner') c.fail('invalid_event', 'Unknown role.');
    const handle = c.handleOf(payload.handle);
    if (group.members.some(member => member.membership === 'member' && member.person_id === payload.person_id)) c.fail('already_member', 'That person is already a member.');
    if (group.members.some(member => member.handle === handle && member.person_id !== payload.person_id)) c.fail('invalid_event', 'Handle is already used in this group.');
    const existing = c.memberRow(group, payload.person_id);
    if (existing) {
      reopenMember(existing, ctx, {handle, display_name: payload.display_name, avatar_asset_id: payload.avatar_asset_id || null, kind: payload.kind || 'person', role: payload.role, added_by: actor.person_id, acting_via: null});
    } else {
      addMemberRecord(data, group, ctx, {person_id: payload.person_id, handle, display_name: payload.display_name, avatar_asset_id: payload.avatar_asset_id || null, kind: payload.kind || 'person', role: payload.role, added_by: actor.person_id, acting_via: null});
    }
    const added = c.memberRow(group, payload.person_id);
    const changeId = c.pushChange(data, group, ctx, {kind: 'member_added', person_id: added.person_id, to_role: added.role, event_id: event.event_id, summary: 'Joined.'});
    c.pushNotice(data, group, ctx, {notice_type: 'member_added', title: c.titles(group, 'member_added'), body: '@' + added.handle + ' was added by @' + actor.handle + ' at ' + c.clockLabel(ctx.virtual_now) + '.', object_id: changeId});
    c.pushActivity(data, group, ctx, {kind: 'member_added', text: '@' + actor.handle + ' added @' + added.handle + '.', person_id: actor.person_id, acting_via: null});
    c.touch(ctx, group);
    return data;
  }
  if (event.operation === 'member.left') {
    const target = c.memberRow(group, payload.person_id);
    if (!target || target.membership !== 'member') c.fail('not_member', 'That person is not an active member.');
    if (target.role === 'owner') c.fail('cannot_remove_owner', 'The owner cannot leave or be removed.');
    if (payload.reason === 'removed') {
      if (!payload.removed_by) c.fail('invalid_event', 'Removal needs removed_by.');
      otherActor(ctx, group, payload.removed_by, 'remove_members');
    }
    closeMembership(group, target, ctx, payload.reason, payload.removed_by || null);
    const changeId = c.pushChange(data, group, ctx, {kind: 'member_left', person_id: target.person_id, event_id: event.event_id, summary: payload.reason});
    c.pushNotice(data, group, ctx, {notice_type: 'member_removed', title: c.titles(group, 'member_removed'), body: '@' + target.handle + ' ' + (payload.reason === 'left' ? 'left' : 'was removed from') + ' the group at ' + c.clockLabel(ctx.virtual_now) + '.', object_id: changeId});
    c.pushActivity(data, group, ctx, {kind: 'member_left', text: '@' + target.handle + ' ' + payload.reason + ' the group.', person_id: target.person_id, acting_via: null});
    c.touch(ctx, group);
    return data;
  }
  if (event.operation === 'role.changed') {
    const actor = otherActor(ctx, group, payload.changed_by, 'change_roles');
    const target = c.activeMember(group, payload.person_id);
    if (!target) c.fail('not_member', 'That person is not an active member.');
    if (target.role === 'owner' || payload.role === 'owner') c.fail('sole_owner', 'Ownership changes use ownership transfer.');
    if (!c.roleRow(group, payload.role)) c.fail('invalid_event', 'Unknown role.');
    const from = target.role === payload.role ? target.role : setRole(target, ctx, payload.role, actor.person_id, null);
    if (from !== payload.role) {
      const changeId = c.pushChange(data, group, ctx, {kind: 'role', person_id: target.person_id, from_role: from, to_role: payload.role, event_id: event.event_id, summary: 'Role changed.'});
      c.pushNotice(data, group, ctx, {notice_type: 'role_change', title: c.titles(group, 'role_change'), body: '@' + actor.handle + ' changed @' + target.handle + ' from ' + from + ' to ' + payload.role + ' at ' + c.clockLabel(ctx.virtual_now) + '.', object_id: changeId});
      c.pushActivity(data, group, ctx, {kind: 'role', text: '@' + actor.handle + ' changed @' + target.handle + ' from ' + from + ' to ' + payload.role + '.', person_id: actor.person_id, acting_via: null});
    }
    c.touch(ctx, group);
    return data;
  }
  if (event.operation === 'vault.item.changed') {
    const actor = otherActor(ctx, group, payload.changed_by, 'manage_vault_access');
    const item = c.vaultItem(group, payload.vault_item_id);
    const field = c.vaultField(item, payload.field);
    field.value = payload.value;
    field.history.push({at: ctx.virtual_now, value: payload.value, changed_by: actor.person_id});
    item.version += 1;
    c.pushChange(data, group, ctx, {kind: 'vault_item', person_id: actor.person_id, event_id: event.event_id, summary: 'Vault field changed.'});
    c.pushActivity(data, group, ctx, {kind: 'vault_item', text: '@' + actor.handle + ' updated ' + field.name + ' on ' + item.title + '.', person_id: actor.person_id, acting_via: null});
    c.touch(ctx, group);
    return data;
  }
  if (event.operation === 'vault.reveal_attempt') {
    if (!c.boundPerson(ctx, payload.person_id)) c.fail('invalid_event', 'Unknown person.');
    const member = c.memberRow(group, payload.person_id);
    if (!member) c.fail('not_member', 'That person is not in this group.');
    const item = c.vaultItem(group, payload.vault_item_id);
    const field = c.vaultField(item, payload.field);
    const outcome = member.membership === 'member' ? c.revealOutcome(group, member.person_id, item.vault_item_id, ctx.virtual_now) : 'vault_access_denied';
    const reveal_id = c.take(data, 'reveal', 'rv');
    group.reveals.push({reveal_id, at: ctx.virtual_now, vault_item_id: item.vault_item_id, field: field.name, person_id: member.person_id, acting_via: null, outcome, request_id: null, event_id: event.event_id});
    if (outcome === 'revealed') c.pushActivity(data, group, ctx, {kind: 'vault_reveal', text: '@' + member.handle + ' revealed ' + field.name + ' on ' + item.title + '.', person_id: member.person_id, acting_via: null});
    c.touch(ctx, group);
    return data;
  }
  if (event.operation === 'notes.updated_by_other') {
    const actor = otherActor(ctx, group, payload.person_id, 'edit_care_note');
    if (payload.expected_version !== group.note.version) c.fail('stale_version', 'Care note version is stale.');
    const version = group.note.version + 1;
    group.note.version = version;
    group.note.text = payload.text;
    group.note.updated_at = ctx.virtual_now;
    group.note.updated_by = actor.person_id;
    group.note.history.push({version, at: ctx.virtual_now, text: payload.text, person_id: actor.person_id});
    c.pushActivity(data, group, ctx, {kind: 'note', text: '@' + actor.handle + ' updated the care note to version ' + version + '.', person_id: actor.person_id, acting_via: null});
    c.touch(ctx, group);
    return data;
  }
  if (event.operation === 'checklist.updated_by_other') {
    const actor = otherActor(ctx, group, payload.person_id, 'edit_care_note');
    if (payload.action === 'add') {
      if (group.checklist.some(item => item.item_id === payload.item_id)) c.fail('invalid_event', 'Checklist id already exists.');
      if (!payload.text) c.fail('invalid_event', 'Checklist add needs text.');
      if (payload.assignee && !c.activeMember(group, payload.assignee)) c.fail('not_member', 'Assignee is not an active member.');
      group.checklist.push({item_id: payload.item_id, text: payload.text, status: 'open', assignee: payload.assignee || null, due_at: payload.due_at || null, history: [{at: ctx.virtual_now, action: 'add', person_id: actor.person_id, text: payload.text}]});
    } else {
      const item = group.checklist.find(row => row.item_id === payload.item_id);
      if (!item || item.status === 'removed') c.fail('item_not_found', 'Checklist item does not exist.');
      if (payload.action === 'complete' && !['open', 'reopened'].includes(item.status)) c.fail('invalid_arguments', 'Only an open item can be completed.');
      if (payload.action === 'reopen' && item.status !== 'done') c.fail('invalid_arguments', 'Only a done item can be reopened.');
      item.status = payload.action === 'complete' ? 'done' : payload.action === 'reopen' ? 'reopened' : 'removed';
      item.history.push({at: ctx.virtual_now, action: payload.action, person_id: actor.person_id});
    }
    c.pushActivity(data, group, ctx, {kind: 'checklist', text: '@' + actor.handle + ' updated the checklist.', person_id: actor.person_id, acting_via: null});
    c.touch(ctx, group);
    return data;
  }
  if (event.operation === 'notice.delivery_result') {
    const notice = data.notices.find(row => row.notice_id === payload.notice_id);
    if (!notice) c.fail('invalid_event', 'Unknown notice.');
    const expectedKey = 'notice-' + notice.notice_id;
    if (payload.publish_request_id !== expectedKey) c.fail('publish_request_mismatch', 'The publish request id must be notice- plus the notice id.');
    const next = payload.status;
    const prev = notice.delivery;
    const same = prev && prev.status === next && prev.publish_request_id === payload.publish_request_id && (prev.messaging_event_id || null) === (payload.messaging_event_id || null);
    if (same) return data;
    if (prev && prev.status === 'committed' && next === 'committed' && !prev.messaging_event_id && payload.messaging_event_id && prev.publish_request_id === payload.publish_request_id) {
      notice.delivery = {status: prev.status, publish_request_id: prev.publish_request_id, messaging_event_id: payload.messaging_event_id, recorded_at: prev.recorded_at};
      notice.status = 'recorded';
      return data;
    }
    if (prev && (prev.status === 'committed' || prev.status === 'rejected')) c.fail('delivery_status_conflict', 'A recorded delivery outcome stays in place.');
    const messaging = next === 'committed' ? (payload.messaging_event_id || (prev && prev.messaging_event_id) || null) : (payload.messaging_event_id || null);
    notice.delivery = {status: next, publish_request_id: payload.publish_request_id, messaging_event_id: messaging, recorded_at: ctx.virtual_now};
    notice.status = 'recorded';
    return data;
  }
  c.fail('invalid_event', 'Unsupported operation.');
}

module.exports = {reads, writes, applyBusinessEvent};
