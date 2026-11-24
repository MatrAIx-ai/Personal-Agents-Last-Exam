'use strict';
// Workflow 1: secure messaging. Threads hold messages; staff replies arrive as events.
const c = require('./common.cjs');
const documents = require('./documents.cjs');
const {fail, copy, parse} = c;
const ACCEPTED = new Set(['application/pdf', 'image/png', 'image/jpeg', 'text/plain']);
const MAX_BYTES = 512 * 1024;
const LABEL = {clinic:'Clinic', nurse_line:'Nurse Line', billing_office:'Billing Office'};

function summary(t) {
  const last = t.messages[t.messages.length - 1] || null;
  return {thread_id:t.thread_id, subject:t.subject, recipient:copy(t.recipient), status:t.status, awaiting:t.awaiting, closed_reason:t.closed_reason,
    related:copy(t.related), opened_at:t.opened_at, updated_at:t.updated_at, message_count:t.messages.length,
    unread_count:t.messages.filter(m => !m.read).length, last_message_at:last ? last.at : null,
    last_message_preview:last ? last.body.replace(/\s+/g, ' ').trim().slice(0, 200) : '', last_author:last ? copy(last.author) : null};
}
function list(ctx, data, args) {
  const category = args.category || 'all', status = args.status || 'all', q = (args.query || '').toLocaleLowerCase();
  const threads = data.threads.filter(t => (category === 'all' || (t.recipient.category || 'clinic') === category) && (status === 'all' || t.status === status) &&
    (!args.unread_only || t.messages.some(m => !m.read)) &&
    (!q || [t.thread_id, t.subject, ...t.messages.map(m => m.body)].join(' ').toLocaleLowerCase().includes(q)));
  threads.sort((a, b) => parse(b.updated_at) - parse(a.updated_at));
  return {threads:threads.map(summary)};
}
const get = (ctx, data, args) => ({thread:copy(c.thread(data, args.id))});
const exportThread = (ctx, data, args) => {const t = c.thread(data, args.id); return {thread_id:t.thread_id, file:documents.exportThread(data, t)};};
function attachmentGet(ctx, data, args) {
  const {thread, message} = c.message(data, args.id);
  if (!message.attachments.includes(args.asset_id)) fail('not_available', 'Attachment ' + args.asset_id + ' does not belong to message ' + args.id + '.');
  if (!ctx.assets?.read) fail('unsupported_capability', 'An attachment reader is required.');
  const {media, ...file} = ctx.assets.read(args.asset_id);
  return {message_id:message.message_id, thread_id:thread.thread_id, file};
}

function addMessage(ctx, data, t, author, body, read) {
  const m = {message_id:c.nextId(data, 'msg'), at:ctx.virtual_now, author:copy(author), body, read, attachments:[]};
  t.messages.push(m);
  t.awaiting = author.role === 'patient' ? 'staff' : 'patient';
  return m;
}
// Documents are PDF, PNG, JPEG or plain text, at most 2 per message and 512 KiB each. Core stores the bytes once the record exists.
function attach(ctx, data, m, files) {
  if (!files || !files.length) return;
  if (files.length > 2) fail('attachment_invalid', 'At most 2 documents can be attached to one message.');
  for (const f of files) {
    if (!ACCEPTED.has(f.mime_type)) fail('attachment_invalid', f.filename + ': ' + f.mime_type + ' is not accepted. Attach a PDF, PNG, JPEG or plain-text document.');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(f.base64)) fail('attachment_invalid', f.filename + ': bytes are not valid base64.');
    const bytes = Buffer.from(f.base64, 'base64');
    if (bytes.length === 0 || bytes.length > MAX_BYTES) fail('attachment_invalid', f.filename + ' is ' + bytes.length + ' bytes; documents must be between 1 byte and 512 KiB.');
    if (c.sha256(bytes) !== f.sha256) fail('attachment_invalid', f.filename + ': the SHA-256 does not match the bytes.');
  }
  if (!ctx.assets?.add) fail('unsupported_capability', 'An attachment writer is required.');
  const ids = ctx.assets.add({object_type:'message', object_id:m.message_id, files:files.map(f => ({filename:f.filename, mime_type:f.mime_type, base64:f.base64, sha256:f.sha256}))});
  m.attachments = [...new Set([...m.attachments, ...ids])];
}
function openThread(ctx, data, {category, subject, body, attachments, related}) {
  const rel = {claim_id:related?.claim_id ?? null, appointment_id:related?.appointment_id ?? null};
  if (rel.claim_id !== null) c.claim(data, rel.claim_id);
  if (rel.appointment_id !== null) c.appointment(data, rel.appointment_id);
  const t = {thread_id:c.nextId(data, 'thr'), subject, recipient:{category, display_name:data.health_system.name + ' ' + LABEL[category]}, status:'open', awaiting:'staff',
    closed_reason:null, related:rel, opened_at:ctx.virtual_now, updated_at:ctx.virtual_now, history:[], messages:[]};
  data.threads.push(t);
  const m = addMessage(ctx, data, t, {role:'patient', display_name:data.patient.name}, body, true);
  attach(ctx, data, m, attachments);
  c.stamp(ctx, t, 'thread_id', 'thread_opened');
  return {id:t.thread_id, message_id:m.message_id};
}
function send(ctx, data, args) {
  c.draftGate(data, c.draftId({send:[args.recipient_category, args.subject, args.body, (args.attachments || []).map(f => f.sha256)]}), 'Sending this message');
  return openThread(ctx, data, {category:args.recipient_category, subject:args.subject, body:args.body, attachments:args.attachments, related:args.related});
}
function reply(ctx, data, args) {
  const t = c.thread(data, args.id);
  if (t.status === 'closed') fail('thread_closed', 'Thread ' + t.thread_id + ' was closed' + (t.closed_reason ? ' (' + t.closed_reason + ')' : '') + '; replies are not delivered. Start a new thread instead.');
  c.draftGate(data, c.draftId({reply:[args.id, args.body, (args.attachments || []).map(f => f.sha256)]}), 'Sending this reply');
  const m = addMessage(ctx, data, t, {role:'patient', display_name:data.patient.name}, args.body, true);
  attach(ctx, data, m, args.attachments);
  c.stamp(ctx, t, 'thread_id', 'patient_replied');
  return {id:t.thread_id, message_id:m.message_id};
}
function flags(ctx, data, args) {
  const {thread, message} = c.message(data, args.id);
  message.read = args.patch.read;
  c.log(ctx, c.PREFIX + 'message_flagged', {message_id:message.message_id, read:args.patch.read});
  return {id:message.message_id, thread_id:thread.thread_id};
}
module.exports = {list, get, exportThread, attachmentGet, send, reply, flags, addMessage, attach, openThread};
