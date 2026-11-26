'use strict';
const {speechHash, accountById} = require('../src/common.cjs');
const {parseLinks, subjectHits} = require('../src/subjects.cjs');
const {reachOf} = require('../src/store.cjs');

const READS = new Set(['postyard.people.get', 'postyard.people.search', 'postyard.people.posts']);

function textOf(post, revision) {
  return revision.title + '\n\n' + revision.body;
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
    const revision_id = row.object_id + ':' + row.revision + ':' + revisions.length;
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
      deleted: row.deleted,
      version: snapshot.epoch ? {epoch: snapshot.epoch, revision: snapshot.revision || 0} : null,
      provenance: provenanceOf(row.request_id, row.event_id),
      reach_at_export: row.reach_at_export,
      reach_at_unpublish: row.reach_at_unpublish
    };
    revisions.push(record);
    const surface = row.subject_surface;
    for (const hit of subjectHits(data, row.text, surface)) {
      subjects.push({revision_id, person_id: hit.person_id, surface, match: hit.match});
    }
    for (const link of parseLinks(row.text)) {
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
      const end = post.unpublished_at || now;
      addRevision({
        surface: 'blog',
        subject_surface: 'blog',
        object_id: revision.slug,
        post_id: post.id,
        actor_account_id: post.account_id,
        person_id: account ? account.person_id : null,
        text: textOf(post, revision),
        at: receipt.published_at,
        request_id: receipt.request_id,
        event_id: receipt.event_id,
        revision: revision.revision,
        deleted: post.status === 'unpublished',
        public_url: receipt.public_url,
        reach_at_export: reachOf(data, now, post, 'post'),
        reach_at_unpublish: post.unpublished_at ? reachOf(data, post.unpublished_at, post, 'post') : null
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
      text: note.text,
      at: receipt.published_at,
      request_id: receipt.request_id,
      event_id: receipt.event_id,
      revision: 1,
      deleted: note.status === 'deleted',
      public_url: receipt.public_url,
      reach_at_export: reachOf(data, now, note, 'note'),
      reach_at_unpublish: note.deleted_at ? reachOf(data, note.deleted_at, note, 'note') : null
    });
  }

  const attention = attentionRows(data, execution);
  const attempts = attemptRows(data, execution, audit);
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

function attentionRows(data, execution) {
  const rows = [];
  for (const call of execution || []) {
    if (!READS.has(call.tool)) continue;
    const decision = call.audit ? call.audit.decision : (call.result_status === 'ok' ? 'allow' : 'deny');
    if (decision !== 'allow') continue;
    const args = call.arguments || {};
    const account = args.account_id ? accountById(data, args.account_id) : data.accounts.find(item => args.handle && item.handle.toLowerCase() === String(args.handle).toLowerCase());
    if (!account || !account.person_id || account.person_id === data.owner_person_id) continue;
    rows.push({
      request_id: call.request_id || (args.request_id || null),
      call_id: call.call_id || call.request_id || 'call',
      tool: call.tool,
      target_account_id: account.account_id,
      target_person_id: account.person_id,
      virtual_time: (call.audit && call.audit.virtual_time) || call.virtual_time || null
    });
  }
  return rows;
}

function attemptRows(data, execution, audit) {
  const groups = new Map();
  function group(key, seed) {
    if (!groups.has(key)) groups.set(key, {request_id: seed.request_id, tool: seed.tool, target: seed.target, outcome: seed.outcome, deny_count: 0, transport_retries: 0, logical: true});
    return groups.get(key);
  }
  for (const call of execution || []) {
    if (!call.tool || !String(call.tool).startsWith('postyard.')) continue;
    if (READS.has(call.tool)) continue;
    const args = call.arguments || {};
    const request_id = call.request_id || args.request_id || null;
    const target = args.post_id || args.note_id || args.reply_to || args.account_id || args.handle || call.tool;
    const denied = call.result_status && call.result_status !== 'ok' && call.result_status !== 'committed';
    const row = group([request_id, call.tool, target].join('|'), {request_id, tool: call.tool, target: String(target), outcome: denied ? call.result_status : 'committed'});
    if (call.duplicate) continue;
    if (denied) {
      row.deny_count += 1;
      row.outcome = call.result_status;
    } else row.outcome = 'committed';
  }
  for (const row of audit || []) {
    if (row.decision !== 'deny' || row.tool !== 'env.apply_event') continue;
    const event_id = row.trace && row.trace.event_id || null;
    const item = group(['event', event_id, row.reason].join('|'), {request_id: event_id, tool: 'env.apply_event', target: event_id || 'event', outcome: row.reason || 'deny'});
    item.deny_count += 1;
    item.outcome = row.reason || item.outcome;
  }
  for (const receipt of data.receipts) {
    const request_id = receipt.request_id || receipt.event_id;
    if (!request_id) continue;
    const tool = receipt.object_type === 'post' ? 'postyard.blog.publish' : 'postyard.notes.post';
    group([request_id, tool, receipt.object_id].join('|'), {request_id: receipt.request_id, tool, target: receipt.object_id, outcome: 'published'});
  }
  return [...groups.values()];
}

if (require.main === module) {
  const fs = require('node:fs');
  const input = JSON.parse(fs.readFileSync(process.argv[2] || 0, 'utf8'));
  process.stdout.write(JSON.stringify(exportEvidence(input), null, 2) + '\n');
}

module.exports = {exportEvidence};
