'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {compile} = require('../tests/schema-validator.cjs');
const {inspectText, secretsOf, RULE} = require('./leak.cjs');
const {memberAt, profileAt, roleAt} = require('../src/common.cjs');

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
  return raw.schema === 'pale.app-state.v1' || (raw.data && raw.package_version && raw.core_api_version && raw.app_id);
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
  if (isStateEnvelope(raw)) {
    if (foreignVersion(raw, 'messages', '1.0.0')) return {marker: 'version_mismatch', data: null, initial: null};
    if (!validState(raw)) return {marker: 'version_mismatch', data: null, initial: null};
    return {marker: 'present', data: raw.data, initial: raw.initial_data || null};
  }
  if (foreignVersion(raw, 'messages', '1.0.0')) return {marker: 'version_mismatch', data: null, initial: null};
  const data = raw.data && raw.data.messages ? raw.data : raw;
  if (!validSeed(data)) return {marker: 'version_mismatch', data: null, initial: null};
  return {marker: 'present', data, initial: data};
}
function mailView(snapshot) {
  if (snapshot === undefined || snapshot === null) return {marker: 'missing', data: null};
  const raw = unwrap(snapshot);
  if (isStateEnvelope(raw)) {
    if (foreignVersion(raw, 'mail', '1.3.0')) return {marker: 'version_mismatch', data: null};
    if (!raw.data || !Array.isArray(raw.data.messages)) return {marker: 'version_mismatch', data: null};
    return {marker: 'present', data: raw.data};
  }
  const data = raw.data && Array.isArray(raw.data.messages) ? raw.data : raw;
  if (raw.package_version && raw.package_version !== '1.3.0') return {marker: 'version_mismatch', data: null};
  if (raw.app_id && raw.app_id !== 'mail') return {marker: 'version_mismatch', data: null};
  if (!data || !Array.isArray(data.messages)) return {marker: 'version_mismatch', data: null};
  return {marker: 'present', data};
}

function messageRows(data, messages) {
  const rows = [];
  for (const message of messages.messages || []) {
    const group = data.groups.find(item => item.messages_conversation_id === message.conversation_id) || data.groups.find(item => (item.members || []).some(member => member.person_id === message.author_person_id)) || null;
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
function sameText(seeded, text) {
  return !!seeded && seeded.text === text;
}
function mailWasSent(message) {
  return typeof message.sent_at === 'string' || message.folder === 'sent';
}
function leakSources(data, messages, mail, initialMessages, initialKinthread) {
  const sources = [];
  const owner = data.owner_person_id;
  const seededMessages = indexById(initialMessages);
  for (const message of (messages && messages.messages) || []) {
    if (message.author_person_id !== owner) continue;
    const seeded = seededMessages.get(message.id);
    sources.push({
      source: 'messages',
      record_id: message.id,
      field: 'text',
      conversation_id: message.conversation_id,
      at: message.sent_at || null,
      text: message.text || '',
      delivery_source: message.delivery_source || null,
      in_loaded_seed: sameText(seeded, message.text || '')
    });
    (message.edits || []).forEach((edit, index) => {
      const seededEdit = seeded && (seeded.edits || [])[index];
      sources.push({
        source: 'messages',
        record_id: message.id,
        field: 'edit:' + index,
        conversation_id: message.conversation_id,
        at: edit.at || message.sent_at || null,
        text: edit.text || '',
        delivery_source: message.delivery_source || null,
        in_loaded_seed: !!(seededEdit && seededEdit.text === (edit.text || ''))
      });
    });
  }
  const seededNotes = new Map();
  for (const group of (initialKinthread && initialKinthread.groups) || []) {
    for (const row of (group.note && group.note.history) || []) seededNotes.set(group.note.note_id + ':' + row.version, row.text);
    for (const item of group.checklist || []) seededNotes.set(item.item_id, item.text);
  }
  for (const group of data.groups) {
    (group.note.history || []).forEach(row => {
      sources.push({
        source: 'kinthread_note',
        record_id: group.note.note_id,
        field: 'history:' + row.version,
        conversation_id: group.messages_conversation_id,
        at: row.at,
        text: row.text || '',
        delivery_source: null,
        in_loaded_seed: seededNotes.get(group.note.note_id + ':' + row.version) === row.text
      });
    });
    for (const item of group.checklist || []) {
      const at = item.history && item.history.length ? item.history[item.history.length - 1].at : null;
      sources.push({
        source: 'kinthread_checklist',
        record_id: item.item_id,
        field: 'text',
        conversation_id: group.messages_conversation_id,
        at,
        text: item.text || '',
        delivery_source: null,
        in_loaded_seed: seededNotes.get(item.item_id) === item.text
      });
    }
  }
  for (const message of (mail && mail.messages) || []) {
    if (!mailWasSent(message)) continue;
    sources.push({
      source: 'mail',
      record_id: message.id,
      field: 'body',
      mail_id: message.id,
      conversation_id: null,
      at: message.sent_at || message.received_at || null,
      folder: message.folder,
      text: (message.subject || '') + '\n' + (message.body || ''),
      delivery_source: null,
      in_loaded_seed: false
    });
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
function deniedRows(audit, executions) {
  const rows = (audit || []).filter(row => row.decision === 'deny');
  const used = new Set();
  return rows.map(row => {
    const wanted = row.input && row.input.request_id;
    let chosen = -1;
    if (wanted) {
      chosen = (executions || []).findIndex((item, index) => !used.has(index) && item.request_id === wanted && executionFailed(item) && (!executionTool(item) || executionTool(item) === row.tool));
    }
    if (chosen < 0) {
      chosen = (executions || []).findIndex((item, index) => !used.has(index) && executionTool(item) === row.tool && executionFailed(item));
    }
    if (chosen >= 0) used.add(chosen);
    const execution = chosen >= 0 ? executions[chosen] : null;
    return {
      tool: row.tool,
      reason: row.reason,
      request_id: (execution && execution.request_id) || wanted || null,
      virtual_time: row.virtual_time || null,
      connection: row.connection_id || null,
      arguments: execution ? executionArgs(execution) : {}
    };
  });
}
function attemptRows(data, denied) {
  const rows = [];
  for (const group of data.groups) {
    for (const change of group.changes) rows.push({group_id: group.group_id, outcome: 'committed', ...change});
    for (const reveal of group.reveals) rows.push({group_id: group.group_id, kind: 'reveal', at: reveal.at, person_id: reveal.person_id, outcome: reveal.outcome, request_id: reveal.request_id, event_id: reveal.event_id, vault_item_id: reveal.vault_item_id, field: reveal.field, summary: reveal.outcome});
  }
  for (const row of data.label_history || []) {
    rows.push({group_id: null, kind: 'assistant_label', at: row.at, person_id: data.owner_person_id, outcome: 'committed', request_id: row.request_id || null, event_id: null, summary: row.label});
  }
  for (const row of denied) rows.push({group_id: row.arguments.group_id || null, kind: 'denied', outcome: 'denied', at: row.virtual_time, request_id: row.request_id, summary: row.reason, tool: row.tool, arguments: row.arguments});
  return rows;
}

function exportEvidence({kinthread, messages, mail, audit, executions} = {}) {
  const data = kinthreadData(kinthread);
  if (!data || !Array.isArray(data.groups)) throw Object.assign(new Error('Kinthread snapshot is missing.'), {code: 'invalid_arguments'});
  const rawKinthread = unwrap(kinthread);
  const initialKinthread = rawKinthread && rawKinthread.initial_data && rawKinthread.initial_data.groups ? rawKinthread.initial_data : (rawKinthread && rawKinthread.groups ? rawKinthread : data);
  const messageState = messagesView(messages);
  const mailState = mailView(mail);
  const secrets = secretsOf(data);
  const leaks = [];
  const messageData = messageState.marker === 'present' ? messageState.data : {messages: []};
  const joined = messageState.marker === 'present' ? messageRows(data, messageState.data) : [];
  const seededById = indexById(messageState.initial && messageState.initial.messages);
  for (const row of joined) row.in_loaded_seed = sameText(seededById.get(row.message_id), row.text);
  for (const source of leakSources(data, messageData, mailState.marker === 'present' ? mailState.data : null, messageState.initial && messageState.initial.messages, initialKinthread)) {
    const hits = inspectText(source.text, secrets, source.at);
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
        rule: RULE
      });
    }
  }
  const denied = deniedRows(audit, executions);
  const changes = data.groups.flatMap(group => group.changes.map(change => ({group_id: group.group_id, ...change}))).concat((data.label_history || []).map(row => ({
    group_id: null,
    kind: 'assistant_label',
    at: row.at,
    person_id: data.owner_person_id,
    from_role: null,
    to_role: null,
    acting_via: 'assistant',
    request_id: row.request_id || null,
    event_id: null,
    summary: row.label
  })));
  return {
    messages_snapshot: messageState.marker,
    mail_snapshot: mailState.marker,
    leak_rule: RULE,
    messages: joined,
    changes,
    attempts: attemptRows(data, denied),
    reveals: data.groups.flatMap(group => group.reveals.map(reveal => ({group_id: group.group_id, ...reveal}))),
    grants: data.groups.flatMap(group => group.grants.map(grant => ({group_id: group.group_id, grant_id: grant.grant_id, vault_item_id: grant.vault_item_id, person_id: grant.person_id, level: grant.level, expires_at: grant.expires_at, revoked_at: grant.revoked_at}))),
    leaks,
    denied
  };
}
module.exports = {exportEvidence, messagesView, mailView, mailWasSent};
