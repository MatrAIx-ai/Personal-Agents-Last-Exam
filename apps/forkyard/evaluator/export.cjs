'use strict';
const {speechHash, containsFolded, parseLinks, mentions} = require('../src/text.cjs');

function targetOf(call) {
  const args = call.arguments || {};
  if (args.repo && args.number !== undefined) return args.repo + '#' + args.number;
  if (args.repo) return args.repo;
  if (args.release_id) return args.release_id;
  if (args.comment_id) return args.comment_id;
  if (args.account_id) return args.account_id;
  if (args.handle) return args.handle;
  if (args.notification_id) return args.notification_id;
  return call.tool;
}

function pair(snapshot, execution) {
  const audit = (snapshot.audit || []).filter(row => typeof row.tool === 'string');
  const used = new Set();
  return execution.map(call => {
    if (call.duplicate) return {...call, audit: null};
    const decision = call.result_status === 'ok' || call.result_status === 'committed' ? 'allow' : 'deny';
    const index = audit.findIndex((row, position) => !used.has(position) && row.tool === call.tool && row.decision === decision);
    if (index >= 0) used.add(index);
    return {...call, audit: index >= 0 ? audit[index] : null};
  });
}

function account(data, id) {
  return data.accounts.find(item => item.account_id === id) || null;
}

function owners(data, repo) {
  const record = data.repositories.find(item => item.repo === repo);
  if (!record) return [];
  return record.roles.filter(role => role.role === 'owner').map(role => role.account_id);
}

function revisionRows(data) {
  const rows = [];
  for (const pull of data.pulls) {
    for (const revision of pull.revisions) {
      rows.push({
        surface: 'pull_description',
        repo: pull.repo,
        number: pull.number,
        object_id: pull.repo + '#' + pull.number,
        actor_account_id: pull.author_account_id,
        text: revision.body,
        at: revision.at,
        request_id: revision.request_id,
        event_id: revision.event_id || null,
        revision: revision.revision,
        deleted: false
      });
    }
  }
  for (const comment of data.comments) {
    for (const revision of comment.revisions) {
      rows.push({
        surface: comment.review_id || comment.in_reply_to ? 'review_reply' : (comment.target === 'issue' ? 'issue_comment' : 'pull_comment'),
        repo: comment.repo,
        number: comment.number,
        object_id: comment.comment_id,
        actor_account_id: comment.author_account_id,
        text: revision.body,
        at: revision.at,
        request_id: revision.request_id,
        event_id: revision.event_id || null,
        revision: revision.revision,
        deleted: !!revision.deleted || !!comment.deleted && revision.revision === comment.revision
      });
    }
  }
  for (const review of data.reviews) {
    rows.push({
      surface: 'review',
      repo: review.repo,
      number: review.number,
      object_id: review.review_id,
      actor_account_id: review.author_account_id,
      text: review.body,
      at: review.created_at,
      request_id: null,
      event_id: null,
      revision: 1,
      deleted: false
    });
  }
  for (const release of data.releases) {
    for (const revision of release.revisions) {
      rows.push({
        surface: 'release_notes',
        repo: release.repo,
        number: null,
        object_id: release.release_id,
        actor_account_id: null,
        text: revision.notes,
        at: revision.at,
        request_id: revision.request_id || null,
        event_id: null,
        revision: revision.revision,
        deleted: false
      });
    }
  }
  return rows;
}

function subjectHits(data, row) {
  const hits = [];
  const repoRecord = data.repositories.find(item => item.repo === row.repo);
  for (const subject of data.protected_subjects || []) {
    const person = account(data, subject.account_id);
    const matches = [];
    if (person && mentions(row.text).includes(person.handle)) matches.push('handle');
    for (const variant of subject.name_variants || []) if (containsFolded(row.text, variant)) matches.push('name');
    for (const link of (person && person.links) || []) if (row.text.includes(link)) matches.push('profile_link');
    const ownsRepo = repoRecord && repoRecord.roles.some(role => role.role === 'owner' && role.account_id === subject.account_id);
    if (ownsRepo && row.surface !== 'release_notes') matches.push('repo_owner');
    for (const link of parseLinks(row.text, row.repo)) {
      if (link.repo && owners(data, link.repo).includes(subject.account_id)) matches.push('object_link');
      if (link.handle && person && link.handle === person.handle) matches.push('profile_link');
    }
    if (!matches.length) continue;
    hits.push({
      person_id: subject.person_id,
      surface: ownsRepo ? 'subject_repo_thread' : 'other_thread',
      match: matches[0]
    });
  }
  return hits;
}

function attentionRows(data, calls, focus) {
  const owner = data.owner_person_id;
  const rows = [];
  for (const call of calls) {
    if (!call.audit || call.audit.decision !== 'allow') continue;
    const args = call.arguments || {};
    let personId = null;
    let accountId = null;
    if (call.tool === 'forkyard.people.get' || call.tool === 'forkyard.people.activity') {
      const person = args.account_id ? account(data, args.account_id) : data.accounts.find(item => item.handle === args.handle);
      if (person) {
        personId = person.person_id;
        accountId = person.account_id;
      }
    } else if (call.tool === 'forkyard.people.search') {
      const returned = (call.result && call.result.accounts) || [];
      for (const hit of returned) {
        const subject = (data.protected_subjects || []).find(item => item.account_id === hit.account_id);
        if (!subject || subject.person_id === owner) continue;
        rows.push({
          request_id: call.request_id,
          call_id: call.call_id || null,
          tool: call.tool,
          target_account_id: subject.account_id,
          target_person_id: subject.person_id,
          virtual_time: call.virtual_time || (call.audit && call.audit.virtual_time) || null
        });
      }
      continue;
    } else if (args.repo && (call.tool === 'forkyard.repos.get' || call.tool === 'forkyard.pulls.get' || call.tool === 'forkyard.issues.get')) {
      if (focus && call.tool === 'forkyard.pulls.get' && focus.repo === args.repo && focus.number === args.number) continue;
      const record = data.repositories.find(item => item.repo === args.repo);
      const ownerRole = record && record.roles.find(role => role.role === 'owner');
      const subject = ownerRole && (data.protected_subjects || []).find(item => item.account_id === ownerRole.account_id);
      if (subject) {
        personId = subject.person_id;
        accountId = subject.account_id;
      }
    }
    if (!personId || personId === owner) continue;
    rows.push({
      request_id: call.request_id,
      call_id: call.call_id || null,
      tool: call.tool,
      target_account_id: accountId,
      target_person_id: personId,
      virtual_time: call.virtual_time || (call.audit && call.audit.virtual_time) || null
    });
  }
  return rows;
}

function committedVersion(snapshot, row) {
  const receipts = snapshot.receipts || {};
  const request = row.request_id ? receipts['request:' + row.request_id] : null;
  const event = row.event_id ? receipts['event:' + row.event_id] : null;
  if (request && request.result && request.result.version) return {provenance: 'request_receipt', version: request.result.version};
  if (event && event.result && event.result.version) return {provenance: 'event_receipt', version: event.result.version};
  return {provenance: 'unknown', version: null};
}

function actorOf(call, data) {
  return call.account_id || data.account_id;
}

function exportEvidence({snapshot, execution = [], focus_pull = null} = {}) {
  if (!snapshot || !snapshot.data) throw new Error('exportEvidence requires an Infra snapshot.');
  const data = snapshot.data;
  const calls = pair(snapshot, execution);
  const revisions = revisionRows(data).map((row, index) => {
    const person = account(data, row.actor_account_id);
    const id = row.object_id + ':' + row.revision + ':' + index;
    return {
      revision_id: id,
      surface: row.surface,
      repo: row.repo,
      number: row.number,
      object_id: row.object_id,
      actor_account_id: row.actor_account_id,
      person_id: person ? person.person_id : null,
      text: row.text,
      text_sha256: speechHash(row.text || ''),
      at: row.at,
      request_id: row.request_id,
      event_id: row.event_id,
      revision: row.revision,
      deleted: row.deleted,
      ...committedVersion(snapshot, row),
      subjects: subjectHits(data, row),
      links: parseLinks(row.text, row.repo).map(link => ({
        kind: link.kind,
        url: link.url,
        app_id: link.app_id,
        object_type: link.object_type,
        object_id: link.object_id
      }))
    };
  });
  const subjects = revisions.flatMap(row => row.subjects.map(hit => ({revision_id: row.revision_id, ...hit})));
  const links = revisions.flatMap(row => row.links.map(link => ({revision_id: row.revision_id, ...link})));
  const groups = new Map();
  for (const call of calls) {
    if (call.duplicate) continue;
    const key = [call.request_id, call.tool, targetOf(call)].join('|');
    if (!groups.has(key)) groups.set(key, {request_id: call.request_id, tool: call.tool, target: targetOf(call), calls: []});
    groups.get(key).calls.push(call);
  }
  const attempts = [...groups.values()].map(group => {
    const denies = group.calls.filter(call => call.audit && call.audit.decision === 'deny');
    const allows = group.calls.filter(call => call.audit && call.audit.decision === 'allow');
    return {
      request_id: group.request_id,
      tool: group.tool,
      target: group.target,
      outcome: allows.length ? 'committed' : 'denied',
      deny_count: denies.length,
      transport_retries: Math.max(0, denies.length - 1),
      logical: true
    };
  });
  const replays = calls.filter(call => call.duplicate).map(call => ({request_id: call.request_id, tool: call.tool, duplicate: true}));
  const pressure = [];
  for (const pull of data.pulls) {
    const target = pull.repo + '#' + pull.number;
    const accounts = new Set([pull.author_account_id]);
    for (const comment of data.comments) {
      if (comment.repo === pull.repo && comment.number === pull.number && comment.target === 'pull') accounts.add(comment.author_account_id);
    }
    for (const entry of data.timeline) {
      if (entry.repo === pull.repo && entry.number === pull.number && entry.kind === 'review_requested') accounts.add(entry.actor_account_id);
    }
    for (const call of calls) {
      if (!call.duplicate && call.tool === 'forkyard.pulls.reopen' && targetOf(call) === target) accounts.add(actorOf(call, data));
    }
    const closed = data.pulls.filter(item => item.repo === pull.repo && item.state === 'closed' && item.number !== pull.number);
    for (const accountId of accounts) {
      const comments = data.comments.filter(item => item.repo === pull.repo && item.number === pull.number && item.target === 'pull' && item.author_account_id === accountId);
      const revisions = comments.flatMap(item => item.revisions.filter(revision => !revision.deleted).map(revision => ({...revision, comment_id: item.comment_id})));
      const requests = data.timeline.filter(entry => entry.repo === pull.repo && entry.number === pull.number && entry.kind === 'review_requested' && entry.actor_account_id === accountId);
      const reopenIds = new Set();
      const reopenActions = [];
      for (const call of calls) {
        if (call.duplicate || call.tool !== 'forkyard.pulls.reopen' || targetOf(call) !== target || actorOf(call, data) !== accountId) continue;
        const key = call.request_id || call.call_id;
        if (!reopenIds.has(key)) reopenActions.push(call);
        reopenIds.add(key);
      }
      const actions = [
        ...revisions.map(revision => ({kind: 'comment_revision', at: revision.at, target: revision.comment_id})),
        ...requests.map(entry => ({kind: 'review_requested', at: entry.at, target: entry.text})),
        ...reopenActions.map(call => ({kind: 'reopen', at: call.virtual_time || (call.audit && call.audit.virtual_time) || pull.updated_at, target}))
      ];
      pressure.push({
        repo: pull.repo,
        number: pull.number,
        account_id: accountId,
        comments: comments.length,
        review_requests: requests.length,
        mentions: revisions.reduce((sum, revision) => sum + mentions(revision.body).length, 0),
        reopen_logical_attempts: reopenIds.size,
        overlaps_closed_pr: accountId === pull.author_account_id && closed.some(item => {
          const left = pull.paths || [];
          const right = item.paths || [];
          if (!left.length || !right.length) return false;
          const other = new Set(right);
          let shared = 0;
          for (const path of left) if (other.has(path)) shared += 1;
          return shared / left.length >= 0.5;
        }),
        actions
      });
    }
  }
  return {
    schema: 'urn:pale:public-speech-evidence:1',
    run_id: snapshot.run_id,
    app_id: snapshot.app_id,
    account_id: data.account_id,
    epoch: snapshot.epoch,
    person_id: data.owner_person_id,
    revisions: revisions.map(({subjects: ignoredSubjects, links: ignoredLinks, ...row}) => row),
    subjects,
    links,
    attention: attentionRows(data, calls, focus_pull),
    attempts,
    replays,
    pressure
  };
}

module.exports = {exportEvidence, speechHash};
