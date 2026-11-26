'use strict';
const {speechHash, accountById, fold} = require('../src/common.cjs');
const {parseLinks, subjectHits} = require('../src/subjects.cjs');
const {reachOf, revisionReach} = require('../src/store.cjs');

const READS = new Set([
  'postyard.blog.posts.list', 'postyard.blog.posts.get', 'postyard.notes.feed', 'postyard.notes.get',
  'postyard.notes.search', 'postyard.notifications.list', 'postyard.people.get', 'postyard.people.search',
  'postyard.people.posts'
]);

function textOf(revision) {
  const parts = [revision.title, revision.body];
  if (revision.correction_note) parts.push(revision.correction_note);
  if (revision.tags && revision.tags.length) parts.push(revision.tags.join(' '));
  return parts.join('\n\n');
}

function noteEvidenceText(note) {
  return note.text;
}

function provenanceOf(requestId, eventId) {
  if (eventId) return 'event_receipt';
  if (requestId) return 'request_receipt';
  return 'unknown';
}

function exportEvidence({snapshot, execution = []} = {}) {
  if (!snapshot || !snapshot.data) throw new Error('exportEvidence requires an Infra snapshot.');
  const data = snapshot.data;
  const audit = snapshot.audit || [];
  const now = snapshot.virtual_now || data.seed_clock;
  const revisions = [];
  const subjects = [];
  const links = [];

  function addRevision(row) {
    const revision_id = (row.post_id || row.note_id || row.object_id) + ':' + row.revision;
    const record = {
      revision_id,
      surface: row.surface,
      repo: null,
      number: null,
      object_id: row.object_id,
      post_id: row.post_id || null,
      note_id: row.note_id || null,
      actor_account_id: row.actor_account_id,
      person_id: row.person_id,
      text: row.text,
      text_sha256: speechHash(row.text),
      at: row.at,
      request_id: row.request_id,
      event_id: row.event_id,
      revision: row.revision,
      reply_to: row.reply_to || null,
      deleted: row.deleted,
      version: committedVersion(snapshot, row),
      publication_end: row.publication_end || null,
      post_reach: row.post_reach === undefined ? null : row.post_reach,
      provenance: provenanceOf(row.request_id, row.event_id),
      reach_at_export: row.reach_at_export,
      reach_at_unpublish: row.reach_at_unpublish
    };
    revisions.push(record);
    const surface = row.subject_surface;
    for (const hit of subjectHits(data, row.text, surface, row.addressed || null, {links: row.extra_links, mentions: row.mentions})) {
      subjects.push({revision_id, person_id: hit.person_id, surface, match: hit.match});
    }
    for (const link of row.links || parseLinks(row.text)) {
      links.push({
        revision_id,
        kind: link.kind,
        url: link.url,
        app_id: link.app_id,
        object_type: link.object_type,
        object_id: link.object_id,
        ...(link.forkyard_object_id ? {forkyard_object_id: link.forkyard_object_id} : {}),
        ...(link.handle ? {handle: link.handle} : {})
      });
    }
    const account = accountById(data, row.actor_account_id);
    if (account && row.public_url) {
      links.push({
        revision_id,
        kind: 'external',
        url: row.public_url,
        app_id: 'postyard',
        object_type: row.surface === 'blog' ? 'post' : 'note',
        object_id: row.object_id,
        handle: account.handle
      });
    }
  }

  for (const post of data.posts) {
    const account = accountById(data, post.account_id);
    for (const revision of post.revisions) {
      const receipt = data.receipts.find(item => item.object_type === 'post' && item.object_id === post.id && item.revision === revision.revision);
      if (!receipt) continue;
      const intervals = (post.exposures || []).filter(item => item.revision === revision.revision);
      const unpublish = intervals.find(item => item.ended_by === 'unpublish');
      const latest = intervals.length ? intervals[intervals.length - 1] : null;
      const later = data.receipts
        .filter(item => item.object_type === 'post' && item.object_id === post.id && item.revision > revision.revision)
        .sort((a, b) => Date.parse(a.published_at) - Date.parse(b.published_at))[0];
      const closedEnd = latest && latest.end ? latest.end : (!latest && later ? later.published_at : null);
      const storedEnd = closedEnd || (post.status === 'unpublished' && post.public_revision === revision.revision ? post.unpublished_at : null);
      addRevision({
        surface: 'blog',
        subject_surface: 'blog',
        object_id: revision.slug,
        post_id: post.id,
        actor_account_id: post.account_id,
        person_id: account ? account.person_id : null,
        text: textOf(revision),
        at: receipt.published_at,
        request_id: receipt.request_id,
        event_id: receipt.event_id,
        revision: revision.revision,
        deleted: post.status === 'unpublished',
        public_url: receipt.public_url,
        reach_at_export: revisionReach(data, now, post, revision.revision),
        post_reach: reachOf(data, now, post, 'post'),
        reach_at_unpublish: unpublish ? unpublish.reach_at_end : null,
        publication_end: storedEnd || null
      });
    }
  }
  for (const note of data.notes) {
    const receipt = data.receipts.find(item => item.object_type === 'note' && item.object_id === note.id);
    if (!receipt && note.status !== 'deleted') continue;
    if (!receipt) continue;
    const account = accountById(data, note.account_id);
    addRevision({
      surface: note.kind === 'reply' ? 'reply' : note.kind === 'repost' ? 'repost' : 'note',
      subject_surface: note.kind === 'reply' ? 'reply_to_subject' : 'note',
      object_id: note.id,
      note_id: note.id,
      actor_account_id: note.account_id,
      person_id: account ? account.person_id : null,
      text: noteEvidenceText(note),
      links: noteLinks(note),
      extra_links: note.links || [],
      mentions: note.mentions || [],
      addressed: note.reply_to ? addressAccount(data, note.reply_to) : null,
      reply_to: note.reply_to || null,
      at: receipt.published_at,
      request_id: receipt.request_id,
      event_id: receipt.event_id,
      revision: 1,
      deleted: note.status === 'deleted',
      public_url: receipt.public_url,
      reach_at_export: reachOf(data, now, note, 'note'),
      reach_at_unpublish: note.deleted_at ? reachOf(data, note.deleted_at, note, 'note') : null,
      publication_end: note.deleted_at || null
    });
  }

  const attention = attentionRows(data, snapshot, execution);
  const attempts = attemptRows(snapshot, execution, audit);
  return {
    schema: 'urn:pale:public-speech-evidence:1',
    run_id: snapshot.run_id || 'postyard',
    app_id: 'postyard',
    account_id: data.account_id,
    epoch: snapshot.epoch || 1,
    person_id: data.owner_person_id,
    revisions,
    subjects,
    links,
    attention,
    attempts,
    pressure: []
  };
}

function noteLinks(note) {
  const links = parseLinks(note.text);
  for (const url of note.links || []) {
    for (const link of parseLinks(url)) if (!links.some(item => item.url === link.url)) links.push(link);
  }
  return links;
}

function addressAccount(data, id) {
  const note = data.notes.find(item => item.id === id);
  if (note) return {account_id: note.account_id};
  const post = data.posts.find(item => item.id === id);
  return post ? {account_id: post.account_id} : null;
}

function versionOf(entry) {
  return entry && entry.result && entry.result.version ? entry.result.version : null;
}

function committedVersion(snapshot, row) {
  const core = snapshot.receipts || {};
  if (row.event_id) {
    const eventVersion = versionOf(core['event:' + row.event_id]);
    if (eventVersion) return eventVersion;
  }
  if (row.request_id) {
    const requestVersion = versionOf(core['request:' + row.request_id]);
    if (requestVersion) return requestVersion;
  }
  const rows = snapshot.audit || [];
  const eventMatch = row.event_id && rows.find(item => item.decision === 'allow' && item.after && (
    (item.trace && item.trace.event_id === row.event_id) || (item.input && item.input.event_id === row.event_id)
  ));
  if (eventMatch) return {epoch: eventMatch.after.epoch, revision: eventMatch.after.revision};
  const requestMatch = row.request_id && rows.find(item => item.decision === 'allow' && item.after && (
    (item.input && item.input.request_id === row.request_id) || item.request_id === row.request_id
  ));
  return requestMatch ? {epoch: requestMatch.after.epoch, revision: requestMatch.after.revision} : null;
}

const PUBLICATION = new Set([
  'postyard.blog.publish', 'postyard.blog.schedule', 'postyard.blog.edit_published', 'postyard.blog.unpublish',
  'postyard.notes.post', 'postyard.notes.reply', 'postyard.notes.repost', 'postyard.notes.schedule'
]);

function requestOf(call) {
  return call.request_id || (call.arguments && call.arguments.request_id) || null;
}

function requestMatches(row, requestId) {
  if (!requestId) return false;
  if (row.request_id && row.request_id === requestId) return true;
  if (row.input && row.input.request_id === requestId) return true;
  return false;
}

function sameRun(snapshot, call) {
  if (call.run_id && snapshot.run_id && call.run_id !== snapshot.run_id) return false;
  if (call.account_id && snapshot.data && call.account_id !== snapshot.data.account_id) return false;
  if (call.epoch && snapshot.epoch && call.epoch !== snapshot.epoch) return false;
  return true;
}

function returnedAccounts(data, call) {
  const result = call.result || {};
  const listed = result.accounts || (result.structuredContent && result.structuredContent.accounts) || null;
  if (Array.isArray(listed)) {
    return listed.map(item => {
      if (item && item.account_id) return accountById(data, item.account_id);
      if (typeof item === 'string') return accountById(data, item);
      return null;
    }).filter(Boolean);
  }
  const args = call.arguments || {};
  if (call.tool === 'postyard.people.search') {
    const needle = fold(args.query || '');
    if (!needle) return [];
    return data.accounts.filter(account => fold(account.handle).includes(needle) || fold(account.display_name).includes(needle));
  }
  const account = args.account_id
    ? accountById(data, args.account_id)
    : data.accounts.find(item => args.handle && item.handle.toLowerCase() === String(args.handle).toLowerCase());
  return account ? [account] : [];
}

function callSeq(call) {
  return call.seq || (call.audit && call.audit.seq) || null;
}

function callConnection(call) {
  return call.connection_id || (call.audit && call.audit.connection_id) || null;
}

function pairAudit(call, audit, used) {
  const requestId = requestOf(call);
  if (requestId) {
    const hit = audit.find(row => !used.has(row) && row.tool === call.tool && requestMatches(row, requestId));
    if (hit) return hit;
  }
  const seq = callSeq(call);
  if (seq !== null && seq !== undefined) {
    const hit = audit.find(row => !used.has(row) && row.seq === seq && row.tool === call.tool);
    if (hit) return hit;
  }
  const connection = callConnection(call);
  const virtual = call.virtual_time || (call.audit && call.audit.virtual_time) || null;
  if (!connection && !virtual) return null;
  return audit.find(row => !used.has(row) && row.tool === call.tool
    && (!connection || row.connection_id === connection)
    && (!virtual || row.virtual_time === virtual)) || null;
}

function attentionRows(data, snapshot, execution) {
  const rows = [];
  const audit = snapshot.audit || [];
  const used = new Set();
  for (const call of execution || []) {
    if (!READS.has(call.tool) || !sameRun(snapshot, call)) continue;
    const paired = pairAudit(call, audit, used);
    if (paired) used.add(paired);
    const allowed = paired
      ? paired.decision === 'allow'
      : !audit.length && call.audit && call.audit.decision === 'allow' && call.result_status !== 'permission_denied';
    if (!allowed) continue;
    for (const account of returnedAccounts(data, call)) {
      if (!account.person_id || account.person_id === data.owner_person_id) continue;
      rows.push({
        request_id: requestOf(call),
        call_id: call.call_id || requestOf(call) || 'call',
        tool: call.tool,
        target_account_id: account.account_id,
        target_person_id: account.person_id,
        virtual_time: (call.audit && call.audit.virtual_time) || call.virtual_time || null
      });
    }
  }
  return rows;
}

function receiptTarget(data, receipt) {
  if (receipt.object_type === 'note') {
    const note = data.notes.find(item => item.id === receipt.object_id);
    if (note && note.reply_to) return note.reply_to;
    if (note && note.repost_of) return note.repost_of.object_id;
  }
  return receipt.object_id;
}

function storedTarget(data, requestId, fallback) {
  if (!data || !requestId) return fallback;
  const note = (data.notes || []).find(item => item.request_id === requestId || item.schedule_request_id === requestId);
  if (note) return note.reply_to || (note.repost_of && note.repost_of.object_id) || note.id;
  const post = (data.posts || []).find(item => (
    (item.pending && item.pending.request_id === requestId) || item.schedule_request_id === requestId
    || (data.receipts || []).some(receipt => receipt.request_id === requestId && receipt.object_id === item.id)
  ));
  return post ? post.id : fallback;
}

function attemptTarget(data, call, requestId) {
  const args = (call && call.arguments) || {};
  const named = args.reply_to || args.object_id || args.post_id || args.note_id || null;
  if (named) return String(named);
  const receipt = requestId && (data.receipts || []).find(item => item.request_id === requestId);
  if (receipt) return receiptTarget(data, receipt);
  return storedTarget(data, requestId, call ? call.tool : 'publication');
}

function attemptRows(snapshot, execution, audit) {
  const data = snapshot.data;
  const rows = audit || snapshot.audit || [];
  const groups = new Map();
  const used = new Set();
  function group(key, seed) {
    if (!groups.has(key)) groups.set(key, {request_id: seed.request_id, tool: seed.tool, target: seed.target, outcome: seed.outcome, deny_count: 0, transport_retries: 0, logical: true});
    return groups.get(key);
  }
  for (const call of execution || []) {
    if (!PUBLICATION.has(call.tool) || !sameRun(snapshot, call)) continue;
    const requestId = requestOf(call);
    const paired = pairAudit(call, rows, used);
    if (!paired) continue;
    used.add(paired);
    const target = attemptTarget(data, call, requestId);
    const denied = paired.decision === 'deny';
    const key = (requestId || (paired.trace && paired.trace.event_id) || 'call') + '|' + target;
    const item = group(key, {request_id: requestId, tool: call.tool, target: String(target), outcome: denied ? (paired.reason || 'deny') : 'committed'});
    if (call.duplicate) continue;
    if (denied) {
      item.deny_count += 1;
      if (item.outcome === 'committed') continue;
      item.outcome = paired.reason || item.outcome;
    } else item.outcome = 'committed';
  }
  function remember(requestId, tool, target) {
    const key = requestId + '|' + target;
    const item = group(key, {request_id: requestId, tool, target: String(target), outcome: 'committed'});
    item.outcome = 'committed';
  }
  for (const receipt of data.receipts || []) {
    if (!receipt.request_id) continue;
    const allow = rows.find(row => row.decision === 'allow' && PUBLICATION.has(row.tool) && requestMatches(row, receipt.request_id));
    if (!allow) continue;
    remember(receipt.request_id, allow.tool, receiptTarget(data, receipt));
  }
  for (const [id, core] of Object.entries(snapshot.receipts || {})) {
    if (!id.startsWith('request:')) continue;
    const requestId = id.slice('request:'.length);
    if (!core || !core.result) continue;
    const allow = rows.find(row => row.decision === 'allow' && PUBLICATION.has(row.tool) && requestMatches(row, requestId));
    if (!allow) continue;
    remember(requestId, allow.tool, storedTarget(data, requestId, allow.tool));
  }
  for (const row of rows) {
    if (row.decision !== 'deny' || row.tool !== 'env.apply_event') continue;
    const eventId = (row.trace && row.trace.event_id) || (row.input && row.input.event_id) || null;
    const item = group('event:' + eventId + '|' + (row.reason || 'deny'), {request_id: eventId, tool: 'env.apply_event', target: eventId || 'event', outcome: row.reason || 'deny'});
    item.deny_count += 1;
    item.outcome = row.reason || item.outcome;
  }
  return [...groups.values()];
}

if (require.main === module) {
  const fs = require('node:fs');
  const input = JSON.parse(fs.readFileSync(process.argv[2] || 0, 'utf8'));
  process.stdout.write(JSON.stringify(exportEvidence(input), null, 2) + '\n');
}

module.exports = {exportEvidence};
