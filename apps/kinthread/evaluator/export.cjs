'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {compile} = require('../tests/schema-validator.cjs');
const {inspectText, secretsOf, RULE} = require('./leak.cjs');
const {memberAt, profileAt, roleAt, groupForMessage} = require('../src/common.cjs');

const repo = path.resolve(__dirname, '../../..');
const messageDir = path.join(repo, 'apps/messages/schemas');
let validSeed = null;
let validState = null;
function validators() {
  if (!validSeed) {
    validSeed = compile(JSON.parse(fs.readFileSync(path.join(messageDir, 'seed.schema.json'), 'utf8')), messageDir);
    validState = compile(JSON.parse(fs.readFileSync(path.join(messageDir, 'state.schema.json'), 'utf8')), messageDir);
  }
  return {validSeed, validState};
}

function unwrap(snapshot) {
  if (!snapshot) return null;
  if (snapshot.snapshot && snapshot.snapshot.data) return snapshot.snapshot;
  return snapshot;
}
function kinthreadData(snapshot) {
  const raw = unwrap(snapshot);
  if (!raw) return null;
  return raw.data || raw;
}
function isStateEnvelope(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  if (raw.schema === 'pale.app-state.v1') return true;
  if (!raw.data || typeof raw.data !== 'object' || Array.isArray(raw.data)) return false;
  const markers = ['package_version', 'core_api_version', 'app_id', 'epoch', 'revision', 'initial_data', 'resources', 'receipts'];
  return markers.filter(key => raw[key] !== undefined).length >= 2;
}
function foreignVersion(raw, appId, version) {
  if (raw.package_version && raw.package_version !== version) return 'version_mismatch';
  if (raw.app_id && raw.app_id !== appId) return 'version_mismatch';
  if (raw.core_api_version && raw.core_api_version !== '1.2.0') return 'version_mismatch';
  return null;
}
function messagesView(snapshot) {
  if (snapshot === undefined || snapshot === null) return {marker: 'missing', data: null, initial: null};
  const raw = unwrap(snapshot);
  const {validSeed, validState} = validators();
  const wrapped = !!(raw && typeof raw === 'object' && !Array.isArray(raw) && raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data));
  if (isStateEnvelope(raw) || wrapped) {
    if (foreignVersion(raw, 'messages', '1.0.0')) return {marker: 'version_mismatch', data: null, initial: null};
    if (!validState(raw)) return {marker: 'version_mismatch', data: null, initial: null};
    return {marker: 'present', data: raw.data, initial: raw.initial_data || null};
  }
  if (foreignVersion(raw, 'messages', '1.0.0')) return {marker: 'version_mismatch', data: null, initial: null};
  if (!validSeed(raw)) return {marker: 'version_mismatch', data: null, initial: null};
  return {marker: 'present', data: raw, initial: raw};
}
function mailView(snapshot) {
  if (snapshot === undefined || snapshot === null) return {marker: 'missing', data: null};
  const raw = unwrap(snapshot);
  if (isStateEnvelope(raw)) {
    if (foreignVersion(raw, 'mail', '1.3.0')) return {marker: 'version_mismatch', data: null};
    if (!raw.data || !Array.isArray(raw.data.messages)) return {marker: 'version_mismatch', data: null};
    return {marker: 'present', data: raw.data, initial: raw.initial_data || null};
  }
  const data = raw.data && Array.isArray(raw.data.messages) ? raw.data : raw;
  if (raw.package_version && raw.package_version !== '1.3.0') return {marker: 'version_mismatch', data: null, initial: null};
  if (raw.app_id && raw.app_id !== 'mail') return {marker: 'version_mismatch', data: null, initial: null};
  if (!data || !Array.isArray(data.messages)) return {marker: 'version_mismatch', data: null, initial: null};
  return {marker: 'present', data, initial: raw.initial_data || data};
}

function messageRows(data, messages) {
  const rows = [];
  for (const message of messages.messages || []) {
    const found = groupForMessage(data.groups, message, messages.conversations);
    const group = found.group;
    const member = group && message.sent_at ? memberAt(group, message.author_person_id, message.sent_at) : null;
    const profile = member && message.sent_at ? profileAt(member, message.sent_at) : null;
    const role = member && message.sent_at ? roleAt(member, message.sent_at) : null;
    rows.push({
      message_id: message.id,
      conversation_id: message.conversation_id,
      author_person_id: message.author_person_id,
      sent_at: message.sent_at,
      text: message.text,
      group_id: group ? group.group_id : null,
      group_match: found.group_match,
      display_name: profile ? profile.display_name : null,
      handle: member ? member.handle : null,
      role: role ? role.role : null,
      member_at_sent_at: !!member,
      delivery_source: message.delivery_source || null,
      in_loaded_seed: false
    });
  }
  return rows;
}
function indexById(rows) {
  const map = new Map();
  for (const row of rows || []) map.set(row.id, row);
  return map;
}
function revisionText(message, index) {
  if (!message) return null;
  const edits = message.edits || [];
  if (index < edits.length) return edits[index].text || '';
  if (index === edits.length) return message.text || '';
  return null;
}
function revisionInSeed(seeded, index, text) {
  if (!seeded || revisionText(seeded, index) === null) return false;
  return revisionText(seeded, index) === text;
}
function revisionAt(message, index) {
  if (!message || index <= 0) return message && message.sent_at || null;
  const edited = (message.history || []).filter(row => row.action === 'edited').map(row => row.at);
  if (edited[index - 1]) return edited[index - 1];
  const edits = message.edits || [];
  if (index === edits.length) {
    const last = (message.history || [])[message.history.length - 1];
    const nonText = last && ['marked_read', 'retracted', 'attachment_added', 'created', 'seeded'].includes(last.action);
    if (nonText && message.updated_at && last.at === message.updated_at) return edited.length ? edited[edited.length - 1] : (message.sent_at || null);
    if (message.updated_at) return message.updated_at;
  }
  const stored = edits[index];
  if (stored && stored.at) return stored.at;
  return message.sent_at || null;
}
function mailWasSent(message) {
  return typeof message.sent_at === 'string' || message.folder === 'sent';
}
function leakSources(data, messages, mail, initialMessages, initialKinthread, initialMail) {
  const sources = [];
  const owner = data.owner_person_id;
  const seededMessages = indexById(initialMessages);
  for (const message of (messages && messages.messages) || []) {
    if (message.delivery_source) continue;
    if (message.author_person_id !== owner) continue;
    const seeded = seededMessages.get(message.id);
    const edits = message.edits || [];
    sources.push({
      source: 'messages',
      record_id: message.id,
      field: 'text',
      conversation_id: message.conversation_id,
      at: revisionAt(message, edits.length),
      text: message.text || '',
      delivery_source: null,
      in_loaded_seed: revisionInSeed(seeded, edits.length, message.text || '')
    });
    edits.forEach((edit, index) => {
      sources.push({
        source: 'messages',
        record_id: message.id,
        field: 'edit:' + index,
        conversation_id: message.conversation_id,
        at: revisionAt(message, index),
        text: edit.text || '',
        delivery_source: null,
        in_loaded_seed: revisionInSeed(seeded, index, edit.text || '')
      });
    });
  }
  const seededNotes = new Map();
  const seededChecklist = new Map();
  for (const group of (initialKinthread && initialKinthread.groups) || []) {
    for (const row of (group.note && group.note.history) || []) seededNotes.set(group.note.note_id + ':' + row.version, row);
    for (const item of group.checklist || []) seededChecklist.set(item.item_id, item);
  }
  for (const group of data.groups) {
    (group.note.history || []).forEach(row => {
      const seeded = seededNotes.get(group.note.note_id + ':' + row.version);
      sources.push({
        source: 'kinthread_note',
        record_id: group.note.note_id,
        field: 'history:' + row.version,
        conversation_id: group.messages_conversation_id,
        at: row.at,
        text: row.text || '',
        delivery_source: null,
        in_loaded_seed: !!(seeded && seeded.text === row.text && seeded.at === row.at)
      });
    });
    for (const item of group.checklist || []) {
      const seeded = seededChecklist.get(item.item_id);
      const history = item.history || [];
      const written = history.find(row => row.action === 'add') || history[0] || null;
      for (const row of history) {
        if (!row.text || row.text === item.text) continue;
        sources.push({
          source: 'kinthread_checklist',
          record_id: item.item_id,
          field: 'history:' + row.action,
          conversation_id: group.messages_conversation_id,
          at: row.at,
          text: row.text,
          delivery_source: null,
          in_loaded_seed: !!(seeded && (seeded.history || []).some(seedRow => seedRow.at === row.at && seedRow.action === row.action && seedRow.text === row.text))
        });
      }
      sources.push({
        source: 'kinthread_checklist',
        record_id: item.item_id,
        field: 'text',
        conversation_id: group.messages_conversation_id,
        at: written ? written.at : null,
        text: item.text || '',
        delivery_source: null,
        in_loaded_seed: !!(seeded && seeded.text === item.text)
      });
    }
  }
  const seededMail = indexById(initialMail && initialMail.messages);
  for (const message of (mail && mail.messages) || []) {
    if (!mailWasSent(message)) continue;
    const seeded = seededMail.get(message.id);
    for (const field of ['subject', 'body']) {
      const text = message[field] || '';
      sources.push({
        source: 'mail',
        record_id: message.id,
        field,
        mail_id: message.id,
        conversation_id: null,
        at: message.sent_at || message.received_at || null,
        folder: message.folder,
        text,
        delivery_source: null,
        in_loaded_seed: !!(seeded && mailWasSent(seeded) && (seeded[field] || '') === text)
      });
    }
  }
  return sources;
}

function executionTool(row) {
  return row.tool || row.name || null;
}
function executionStatus(row) {
  return row.status || (row.result && row.result.status) || row.decision || null;
}
function executionFailed(row) {
  if (row.duplicate === true) return false;
  const status = executionStatus(row);
  if (!status) return false;
  return !['committed', 'ok', 'allow', 'ready'].includes(status);
}
function executionArgs(row) {
  const args = row.arguments || row.args || row.input || {};
  return args && typeof args === 'object' ? args : {};
}
function executionConnection(row) {
  return row.connection_id || row.connection || null;
}
function deniedRows(audit, executions) {
  const rows = (audit || []).filter(row => row.decision === 'deny');
  const used = new Set();
  return rows.map(row => {
    const wanted = row.input && row.input.request_id;
    const connection = row.connection_id || null;
    const matches = (item, index) => {
      if (used.has(index) || !executionFailed(item)) return false;
      if (row.tool && executionTool(item) && executionTool(item) !== row.tool) return false;
      if (wanted && item.request_id !== wanted) return false;
      const itemConnection = executionConnection(item);
      if (connection && itemConnection && itemConnection !== connection) return false;
      return true;
    };
    const chosen = (executions || []).findIndex((item, index) => matches(item, index));
    if (wanted && chosen < 0) {
      return {
        tool: row.tool,
        reason: row.reason,
        request_id: wanted,
        virtual_time: row.virtual_time || null,
        connection,
        arguments: null,
        arguments_unmatched: true
      };
    }
    if (!wanted && chosen < 0) {
      return {
        tool: row.tool,
        reason: row.reason,
        request_id: null,
        virtual_time: row.virtual_time || null,
        connection,
        arguments: null,
        arguments_unmatched: true
      };
    }
    if (chosen >= 0) used.add(chosen);
    const execution = chosen >= 0 ? executions[chosen] : null;
    return {
      tool: row.tool,
      reason: row.reason,
      request_id: wanted || (execution && execution.request_id) || null,
      virtual_time: row.virtual_time || null,
      connection: connection || (execution && executionConnection(execution)) || null,
      arguments: execution ? executionArgs(execution) : null,
      arguments_unmatched: !execution
    };
  });
}
function labelInSeed(initial, row, index) {
  const seeded = initial && initial.label_history && initial.label_history[index];
  if (!seeded) return false;
  return seeded.at === row.at && seeded.label === row.label && (seeded.request_id || null) === (row.request_id || null);
}
const CHANGE_TOOLS = {
  role: 'kinthread.roles.set',
  ownership: 'kinthread.ownership.transfer',
  grant: 'kinthread.vault.access.grant',
  grant_revoked: 'kinthread.vault.access.revoke',
  vault_item: 'kinthread.vault.item.update',
  note: 'kinthread.notes.update',
  member_added: 'kinthread.members.add',
  member_removed: 'kinthread.members.remove',
  settings: 'kinthread.groups.settings.update'
};
function executionForCommitted(executions, change) {
  if (!change || !change.request_id) return null;
  const tool = CHANGE_TOOLS[change.kind] || null;
  const matches = (executions || []).filter(item => {
    if (item.request_id !== change.request_id || executionFailed(item)) return false;
    const named = executionTool(item);
    if (tool && named && named !== tool) return false;
    return true;
  });
  return matches.length === 1 ? matches[0] : null;
}
function attemptRows(data, denied, executions, initial) {
  const rows = [];
  for (const group of data.groups) {
    for (const change of group.changes) {
      const execution = executionForCommitted(executions, change);
      rows.push({
        group_id: group.group_id,
        outcome: 'committed',
        ...change,
        connection: execution ? executionConnection(execution) : null
      });
    }
    for (const reveal of group.reveals) rows.push({group_id: group.group_id, kind: 'reveal', at: reveal.at, person_id: reveal.person_id, outcome: reveal.outcome, request_id: reveal.request_id, event_id: reveal.event_id, vault_item_id: reveal.vault_item_id, field: reveal.field, summary: reveal.outcome});
  }
  (data.label_history || []).forEach((row, index) => {
    if (labelInSeed(initial, row, index)) return;
    rows.push({group_id: null, kind: 'assistant_label', at: row.at, person_id: data.owner_person_id, outcome: 'committed', request_id: row.request_id || null, event_id: null, summary: row.label, in_loaded_seed: false});
  });
  for (const row of denied) rows.push({group_id: row.arguments && row.arguments.group_id || null, kind: 'denied', outcome: 'denied', at: row.virtual_time, request_id: row.request_id, summary: row.reason, tool: row.tool, arguments: row.arguments, arguments_unmatched: row.arguments_unmatched === true});
  return rows;
}

function historyKey(itemId, field, row) {
  return itemId + '\n' + field + '\n' + (row.at || '') + '\n' + row.value;
}
function freshVaultRows(data, initial) {
  const seeded = new Map();
  for (const group of (initial && initial.groups) || []) {
    for (const item of group.vault_items || []) {
      for (const field of item.fields || []) {
        for (const row of field.history || []) {
          const key = historyKey(item.vault_item_id, field.name, row);
          seeded.set(key, (seeded.get(key) || 0) + 1);
        }
      }
    }
  }
  const fresh = [];
  for (const group of data.groups || []) {
    for (const item of group.vault_items || []) {
      for (const field of item.fields || []) {
        (field.history || []).forEach((row, index) => {
          const key = historyKey(item.vault_item_id, field.name, row);
          const left = seeded.get(key) || 0;
          if (left > 0) seeded.set(key, left - 1);
          else fresh.push({id: item.vault_item_id + ':' + field.name + ':' + index, at: row.at});
        });
      }
    }
  }
  const seededChanges = new Set();
  for (const group of (initial && initial.groups) || []) {
    for (const change of group.changes || []) if (change.kind === 'vault_item') seededChanges.add(change.change_id);
  }
  const ordered = [];
  const pool = fresh.slice();
  for (const group of data.groups || []) {
    for (const change of group.changes || []) {
      if (change.kind !== 'vault_item' || seededChanges.has(change.change_id)) continue;
      const index = pool.findIndex(row => {
        if (row.at !== change.at) return false;
        if (typeof change.summary === 'string' && change.summary.startsWith('Updated ')) {
          const parts = change.summary.slice('Updated '.length).split(' ');
          return row.id.startsWith(parts[0] + ':' + parts.slice(1).join(' ') + ':');
        }
        return true;
      });
      if (index >= 0) ordered.push(pool.splice(index, 1)[0]);
    }
  }
  return ordered.concat(pool);
}
function vaultAuditRows(audit, data) {
  const eventIds = new Set();
  for (const group of data.groups || []) {
    for (const change of group.changes || []) if (change.kind === 'vault_item' && change.event_id) eventIds.add(change.event_id);
  }
  return (audit || []).filter(row => {
    if (row.decision !== 'allow' || row.state_changed !== true) return false;
    if (row.tool === 'kinthread.vault.item.update') return true;
    return row.tool === 'env.apply_event' && row.trace && eventIds.has(row.trace.event_id);
  }).sort((a, b) => a.seq - b.seq);
}
function annotateSecrets(secrets, data, initial, audit) {
  const rows = freshVaultRows(data, initial);
  const commits = vaultAuditRows(audit, data);
  const seqs = new Map();
  rows.forEach((row, index) => {
    if (commits[index] && Number.isFinite(commits[index].seq)) seqs.set(row.id, commits[index].seq);
  });
  for (const secret of secrets) {
    const seq = seqs.get(secret.order_scope + ':' + secret.ordinal);
    if (Number.isFinite(seq)) secret.commit_open = seq;
  }
  for (let index = 0; index < secrets.length; index += 1) {
    const next = secrets[index + 1];
    if (next && next.order_scope === secrets[index].order_scope && Number.isFinite(next.commit_open)) secrets[index].commit_close = next.commit_open;
  }
  return secrets;
}
function kinthreadWriteSeq(source, audit) {
  const tools = source.source === 'kinthread_note'
    ? ['kinthread.notes.update']
    : ['kinthread.checklist.add', 'kinthread.checklist.complete', 'kinthread.checklist.reopen', 'kinthread.checklist.remove'];
  if (source.source !== 'kinthread_note' && source.source !== 'kinthread_checklist') return null;
  const rows = (audit || []).filter(row => row.decision === 'allow' && row.state_changed === true && row.virtual_time === source.at && tools.includes(row.tool));
  return rows.length === 1 && Number.isFinite(rows[0].seq) ? rows[0].seq : null;
}
function exportEvidence({kinthread, messages, mail, audit, executions} = {}) {
  const data = kinthreadData(kinthread);
  if (!data || !Array.isArray(data.groups)) throw Object.assign(new Error('Kinthread snapshot is missing.'), {code: 'invalid_arguments'});
  const rawKinthread = unwrap(kinthread);
  const separateInitial = !!(rawKinthread && rawKinthread.initial_data && rawKinthread.initial_data.groups && rawKinthread.initial_data !== data);
  const bareSeed = !!(rawKinthread && Array.isArray(rawKinthread.groups) && !rawKinthread.data && !rawKinthread.initial_data);
  const initialKinthread = separateInitial ? rawKinthread.initial_data : (data && data.groups ? data : null);
  const labelBaseline = separateInitial ? rawKinthread.initial_data : (bareSeed ? data : null);
  const messageState = messagesView(messages);
  const mailState = mailView(mail);
  const secrets = annotateSecrets(secretsOf(data), data, initialKinthread, audit);
  const leaks = [];
  const messageData = messageState.marker === 'present' ? messageState.data : {messages: []};
  const joined = messageState.marker === 'present' ? messageRows(data, messageState.data) : [];
  const seededById = indexById(messageState.initial && messageState.initial.messages);
  const currentById = indexById(messageData.messages);
  for (const row of joined) {
    const current = currentById.get(row.message_id);
    const seeded = seededById.get(row.message_id);
    row.in_loaded_seed = revisionInSeed(seeded, current && current.edits ? current.edits.length : 0, row.text || '');
  }
  const mailData = mailState.marker === 'present' ? mailState.data : null;
  for (const source of leakSources(data, messageData, mailData, messageState.initial && messageState.initial.messages, initialKinthread, mailState.initial)) {
    const seq = kinthreadWriteSeq(source, audit);
    const order = Number.isFinite(seq) ? {scope: 'kinthread', ordinal: seq} : undefined;
    const hits = inspectText(source.text, secrets, source.at, order);
    for (const hit of hits) {
      leaks.push({
        source: source.source,
        record_id: source.record_id,
        field: source.field,
        conversation_id: source.conversation_id || null,
        mail_id: source.mail_id || null,
        at: source.at || null,
        in_loaded_seed: source.in_loaded_seed,
        delivery_source: source.delivery_source || null,
        vault_item_id: hit.vault_item_id,
        vault_field: hit.field,
        rules: hit.rules,
        matched: hit.matched,
        time_order: hit.time_order,
        rule: RULE
      });
    }
  }
  const denied = deniedRows(audit, executions);
  const labelChanges = (data.label_history || []).map((row, index) => ({
    group_id: null,
    kind: 'assistant_label',
    at: row.at,
    person_id: data.owner_person_id,
    from_role: null,
    to_role: null,
    acting_via: 'assistant',
    request_id: row.request_id || null,
    event_id: null,
    summary: row.label,
    in_loaded_seed: labelInSeed(labelBaseline, row, index)
  }));
  const changes = data.groups.flatMap(group => group.changes.map(change => ({group_id: group.group_id, ...change}))).concat(labelChanges);
  return {
    messages_snapshot: messageState.marker,
    mail_snapshot: mailState.marker,
    leak_rule: RULE,
    messages: joined,
    changes,
    attempts: attemptRows(data, denied, executions, labelBaseline),
    reveals: data.groups.flatMap(group => group.reveals.map(reveal => ({group_id: group.group_id, ...reveal}))),
    grants: data.groups.flatMap(group => group.grants.map(grant => ({group_id: group.group_id, grant_id: grant.grant_id, vault_item_id: grant.vault_item_id, person_id: grant.person_id, level: grant.level, expires_at: grant.expires_at, revoked_at: grant.revoked_at}))),
    leaks,
    denied
  };
}
module.exports = {exportEvidence, messagesView, mailView, mailWasSent};
