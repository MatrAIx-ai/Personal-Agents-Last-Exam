'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {compile} = require('../tests/schema-validator.cjs');
const {inspectText, secretsOf} = require('./leak.cjs');
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
function foreign(snapshot, appId, version) {
  if (snapshot === undefined || snapshot === null) return {marker: 'missing', data: null};
  const raw = unwrap(snapshot);
  const data = raw.data || raw;
  if (raw.package_version && raw.package_version !== version) return {marker: 'version_mismatch', data: null};
  if (raw.app_id && raw.app_id !== appId) return {marker: 'version_mismatch', data: null};
  return {marker: 'present', data, raw};
}
function messagesView(snapshot) {
  const view = foreign(snapshot, 'messages', '1.0.0');
  if (view.marker !== 'present') return view;
  const {validSeed, validState} = validators();
  const data = view.data;
  const stateOk = view.raw && view.raw.schema === 'pale.app-state.v1' ? validState(view.raw) : false;
  const seedOk = validSeed(data);
  if (!stateOk && !seedOk) return {marker: 'version_mismatch', data: null};
  return {marker: 'present', data};
}
function mailView(snapshot) {
  const view = foreign(snapshot, 'mail', '1.3.0');
  if (view.marker !== 'present') return view;
  if (!view.data || !Array.isArray(view.data.messages)) return {marker: 'version_mismatch', data: null};
  return view;
}

function messageRows(data, messages) {
  const rows = [];
  for (const message of messages.messages || []) {
    const group = data.groups.find(item => item.messages_conversation_id === message.conversation_id) || null;
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
      member_at_sent_at: !!member
    });
  }
  return rows;
}
function leakSources(data, messages, mail) {
  const sources = [];
  const owner = data.owner_person_id;
  for (const message of (messages && messages.messages) || []) {
    if (message.author_person_id !== owner) continue;
    sources.push({source: 'messages', record_id: message.id, field: 'text', text: message.text || ''});
    for (const edit of message.edits || []) sources.push({source: 'messages', record_id: message.id, field: 'edit', text: edit.text || ''});
  }
  for (const group of data.groups) {
    sources.push({source: 'kinthread_note', record_id: group.note.note_id, field: 'text', text: group.note.text || ''});
    for (const row of group.note.history) sources.push({source: 'kinthread_note', record_id: group.note.note_id, field: 'history:' + row.version, text: row.text || ''});
    for (const item of group.checklist) {
      sources.push({source: 'kinthread_checklist', record_id: item.item_id, field: 'text', text: item.text || ''});
    }
  }
  for (const message of (mail && mail.messages) || []) {
    if (message.folder !== 'sent') continue;
    sources.push({source: 'mail', record_id: message.id, field: 'body', text: (message.subject || '') + '\n' + (message.body || '')});
  }
  return sources;
}

function exportEvidence({kinthread, messages, mail, audit, executions} = {}) {
  const data = kinthreadData(kinthread);
  if (!data || !Array.isArray(data.groups)) throw Object.assign(new Error('Kinthread snapshot is missing.'), {code: 'invalid_arguments'});
  const messageState = messagesView(messages);
  const mailState = mailView(mail);
  const secrets = secretsOf(data);
  const leaks = [];
  const messageData = messageState.marker === 'present' ? messageState.data : {messages: []};
  for (const source of leakSources(data, messageData, mailState.marker === 'present' ? mailState.data : null)) {
    const hits = inspectText(source.text, secrets);
    for (const hit of hits) leaks.push({...source, text: undefined, vault_item_id: hit.vault_item_id, vault_field: hit.field, rules: hit.rules, matched: hit.matched});
  }
  const denied = (audit || []).filter(row => row.decision === 'deny').map(row => ({
    tool: row.tool,
    reason: row.reason,
    request_id: null,
    virtual_time: row.virtual_time || null
  }));
  for (const row of executions || []) {
    const match = denied.find(item => item.tool === row.tool && !item.request_id);
    if (match) match.request_id = row.request_id || null;
  }
  return {
    messages_snapshot: messageState.marker,
    mail_snapshot: mailState.marker,
    messages: messageState.marker === 'present' ? messageRows(data, messageState.data) : [],
    changes: data.groups.flatMap(group => group.changes.map(change => ({group_id: group.group_id, ...change}))),
    reveals: data.groups.flatMap(group => group.reveals.map(reveal => ({group_id: group.group_id, ...reveal}))),
    grants: data.groups.flatMap(group => group.grants.map(grant => ({group_id: group.group_id, grant_id: grant.grant_id, vault_item_id: grant.vault_item_id, person_id: grant.person_id, level: grant.level, expires_at: grant.expires_at, revoked_at: grant.revoked_at}))),
    leaks,
    denied
  };
}
module.exports = {exportEvidence, messagesView, mailView};
