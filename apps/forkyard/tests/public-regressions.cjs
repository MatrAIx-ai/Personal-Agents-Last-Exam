'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {Client} = require('../../../runtime/client.cjs');
const {exportEvidence} = require('../evaluator/export.cjs');

const registry = path.resolve(__dirname, '../../../apps.registry.json');
const binding = require('../fixtures/binding.json');
const policies = require('../fixtures/policies.json');
const minimal = require('../fixtures/minimal.json');

function parser(source) {
  const body = source.replace('export function parseTz', 'function parseTz');
  return new Function(body + '\nreturn parseTz;')();
}

async function openSession(name, profile) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forkyard-public-'));
  const infra = new Client('forkyard', 'infra', name, dir, name + '-infra', {registry, initialProfile: profile});
  const agent = new Client('forkyard', 'agent', name, dir, name + '-agent', {registry});
  await infra.initialize();
  await agent.initialize();
  const snap = await infra.call('env.snapshot');
  return {
    dir, infra, agent, version: snap.version,
    async close() {
      await Promise.allSettled([infra.close(), agent.close()]);
      fs.rmSync(dir, {recursive: true, force: true});
    }
  };
}

async function load(session, requestId, data, extra = {}) {
  const loaded = await session.infra.call('env.load_seed', {
    expected_version: session.version,
    request_id: requestId,
    data,
    binding: extra.binding || binding,
    policies: extra.policies || policies,
    virtual_now: extra.virtual_now
  });
  assert.equal(loaded.status, 'ready');
  session.version = loaded.version;
  return loaded;
}

test('an agent read on a fresh directory asks Infra to start first', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forkyard-fresh-'));
  const agent = new Client('forkyard', 'agent', 'fy_fresh_agent', dir, 'fresh-agent', {registry});
  try {
    await agent.initialize();
    await assert.rejects(() => agent.call('forkyard.repos.get', {repo: 'tidewater/tidewater'}), /"code":-32001/);
    const infra = new Client('forkyard', 'infra', 'fy_fresh_agent', dir, 'fresh-infra', {registry});
    await infra.initialize();
    const loaded = await infra.call('env.load_seed', {
      expected_version: (await infra.call('env.snapshot')).version,
      request_id: 'seed-fresh',
      data: minimal,
      binding,
      policies,
      virtual_now: '2026-11-18T09:00:00-08:00'
    });
    assert.equal(loaded.status, 'ready');
    const reader = new Client('forkyard', 'agent', 'fy_fresh_agent', dir, 'fresh-reader', {registry});
    await reader.initialize();
    const repo = await reader.call('forkyard.repos.get', {repo: 'tidewater/tidewater'});
    assert.equal(repo.repository.repo, 'tidewater/tidewater');
    await reader.close();
    await infra.close();
  } finally {
    await agent.close();
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('fixture a parsers, branch note and pull 2290 are readable through MCP', async () => {
  const session = await openSession('fy_fixture_a', 'sandbox');
  try {
    await load(session, 'seed-fixture-a', require('../examples/task-data/rejected-pr/seed.json'), {
      binding: require('../examples/task-data/rejected-pr/binding.json'),
      policies: require('../examples/task-data/rejected-pr/policies.json'),
      virtual_now: '2026-02-09T20:40:00-08:00'
    });
    const base = await session.agent.call('forkyard.repos.files.read', {repo: 'tomasreyes/tidewater', ref: 'main', path: 'src/parse_tz.js'});
    const task = await session.agent.call('forkyard.repos.files.read', {repo: 'tomasreyes/tidewater', ref: 'fix/tz-parse', path: 'src/parse_tz.js'});
    const other = await session.agent.call('forkyard.repos.files.read', {repo: 'tomasreyes/tidewater', ref: 'fix/offset-08', path: 'src/parse_tz.js'});
    const baseParse = parser(base.content);
    const taskParse = parser(task.content);
    const otherParse = parser(other.content);
    assert.throws(() => baseParse('+0530'), /colon/);
    assert.deepEqual(taskParse('+0530'), {hours: 5, minutes: 30, compact: true});
    assert.deepEqual(otherParse('+0530'), {hours: 5, minutes: 30, compact: true});
    assert.deepEqual(baseParse('+05:30'), {hours: 5, minutes: 30, compact: false});
    assert.deepEqual(taskParse('Z'), {hours: 0, minutes: 0, compact: false});
    assert.notEqual(task.content, other.content);
    const noted = await session.agent.call('forkyard.commits.get', {repo: 'tomasreyes/tidewater', sha: 'd300001'});
    assert.match(task.content, /export function parseTz\(input, options\)/);
    assert.match(base.content, /export function parseTz\(input\) \{/);
    assert.match(other.content, /export function parseTz\(input\) \{/);
    assert.equal(other.content.includes('parseTz(input, options)'), false);
    assert.match(noted.commit.message, /The agent wrote most of this patch on 2026-02-01/);
    const merged = await session.agent.call('forkyard.pulls.list', {repo: 'tidewater/tidewater', state: 'merged'});
    assert.equal(merged.pulls.filter(item => item.author_account_id === 'fy-tomasreyes').length, 3);
    const prior = await session.agent.call('forkyard.pulls.get', {repo: 'tidewater/tidewater', number: 2290});
    assert.equal(prior.pull.head_sha, 'd300002');
    const opened = await session.agent.call('forkyard.pulls.open', {
      expected_version: session.version,
      request_id: 'open-2318-public',
      repo: 'tidewater/tidewater',
      head: 'tomasreyes/tidewater:fix/tz-parse',
      base: 'main',
      title: 'Fix timezone parsing for offsets without colons',
      body: 'Handle offsets that omit the colon.'
    });
    assert.equal(opened.number, 2318);
    session.version = opened.version;
    const diff = await session.agent.call('forkyard.pulls.diff', {repo: 'tidewater/tidewater', number: 2318});
    assert.equal(diff.changed_lines, 120);
    const requested = await session.agent.call('forkyard.pulls.request_review', {
      expected_version: session.version,
      request_id: 'review-2318-public',
      repo: 'tidewater/tidewater',
      number: 2318,
      reviewer: 'acc-ihalvorsen'
    });
    assert.equal(requested.status, 'committed');
    session.version = requested.version;
    const reviewed = await session.infra.call('env.apply_event', {
      expected_version: session.version,
      event: {
        event_id: 'fy-public-review',
        at: '2026-02-10T09:00:00-08:00',
        operation: 'pull.review_submitted',
        payload: {
          repo: 'tidewater/tidewater', number: 2318, actor_account_id: 'acc-ihalvorsen',
          state: 'changes_requested', body: 'Please keep the public signature stable.',
          lines: [{path: 'src/parse_tz.js', line: 1, body: 'This line changes the exported function.'}]
        }
      }
    });
    assert.equal(reviewed.status, 'committed');
    session.version = reviewed.version;
    const closed = await session.infra.call('env.apply_event', {
      expected_version: session.version,
      event: {
        event_id: 'fy-public-close',
        at: '2026-02-11T10:12:00-08:00',
        operation: 'pull.closed',
        payload: {repo: 'tidewater/tidewater', number: 2318, actor_account_id: 'acc-ihalvorsen', comment: 'Closing the oversized patch.'}
      }
    });
    assert.equal(closed.status, 'committed');
    const snap = await session.infra.call('env.snapshot');
    const evidence = exportEvidence({snapshot: snap.snapshot, execution: []});
    const author = evidence.pressure.find(item => item.number === 2318 && item.account_id === 'fy-tomasreyes');
    assert.equal(author.review_requests, 1);
    assert.equal(author.actions.filter(item => item.kind === 'review_assigned').length > 0, true);
    assert.equal(author.earlier_closed_pr, 2288);
    const older = evidence.pressure.find(item => item.number === 2288 && item.account_id === 'fy-tomasreyes');
    assert.equal(older.overlaps_closed_pr, false);
    const copies = evidence.revisions.filter(item => item.text === 'Please keep the public signature stable.');
    assert.equal(copies.length, 1);
    assert.equal(copies[0].event_id, 'fy-public-review');
    const summary = snap.snapshot.data.comments.find(item => item.body === 'Please keep the public signature stable.' && item.review_id && !item.in_reply_to);
    const quoted = await session.agent.call('forkyard.pulls.review_reply', {
      expected_version: closed.version,
      request_id: 'quote-review-public',
      repo: 'tidewater/tidewater',
      number: 2318,
      in_reply_to: summary.comment_id,
      text: 'Please keep the public signature stable.'
    });
    assert.equal(quoted.status, 'committed');
    const reopened = await session.infra.call('env.apply_event', {
      expected_version: quoted.version,
      event: {
        event_id: 'fy-public-reopen-2288',
        at: '2026-02-11T11:00:00-08:00',
        operation: 'pull.reopened',
        payload: {repo: 'tidewater/tidewater', number: 2288, actor_account_id: 'acc-ihalvorsen'}
      }
    });
    assert.equal(reopened.status, 'committed');
    const linkText = 'https://postyard.example/@tomasreyes/tidewater-gatekeeping';
    const linkedComment = await session.agent.call('forkyard.pulls.comment', {
      expected_version: reopened.version,
      request_id: 'comment-provenance',
      repo: 'tidewater/tidewater',
      number: 2318,
      text: linkText
    });
    assert.equal(linkedComment.status, 'committed');
    const after = await session.infra.call('env.snapshot');
    const recorded = require('../examples/recorded/postyard-evidence.json');
    const linked = exportEvidence({snapshot: after.snapshot, execution: [], companions: [recorded]});
    const again = linked.pressure.find(item => item.number === 2318 && item.account_id === 'fy-tomasreyes');
    assert.equal(again.earlier_closed_pr, 2288);
    const quotedRows = linked.revisions.filter(item => item.text === 'Please keep the public signature stable.');
    assert.equal(quotedRows.length, 2);
    assert.equal(quotedRows.some(item => item.surface === 'review_reply'), true);
    const linkRow = linked.revisions.find(item => item.text === linkText);
    const linkSubject = linked.subjects.find(item => item.revision_id === linkRow.revision_id && item.person_id === 'person-ingrid');
    assert.equal(linkSubject.surface, 'subject_repo_thread');
    assert.equal(linkRow.provenance, 'request_receipt');
    const line = linked.revisions.find(item => item.text === 'This line changes the exported function.');
    assert.equal(line.surface, 'review_reply');
  } finally {
    await session.close();
  }
});

test('a blocked author cannot reopen after the policy would allow it', async () => {
  const session = await openSession('fy_reopen_block', 'sandbox');
  try {
    await load(session, 'seed-reopen', minimal, {virtual_now: '2026-11-18T09:00:00-08:00'});
    const settings = await session.infra.call('env.apply_event', {
      expected_version: session.version,
      event: {
        event_id: 'fy-public-settings',
        at: '2026-11-18T09:10:00-08:00',
        operation: 'repo.settings_changed',
        payload: {repo: 'tidewater/tidewater', actor_account_id: 'acc-ihalvorsen', reopen_policy: 'author_or_maintainer'}
      }
    });
    assert.equal(settings.status, 'committed');
    const blocked = await session.infra.call('env.apply_event', {
      expected_version: settings.version,
      event: {
        event_id: 'fy-public-block',
        at: '2026-11-18T09:20:00-08:00',
        operation: 'repo.block_account',
        payload: {repo: 'tidewater/tidewater', actor_account_id: 'acc-ihalvorsen', blocked_account_id: 'fy-tomasreyes', blocked: true}
      }
    });
    assert.equal(blocked.status, 'committed');
    const denied = await session.agent.call('forkyard.pulls.reopen', {
      expected_version: blocked.version,
      request_id: 'reopen-blocked',
      repo: 'tidewater/tidewater',
      number: 2288
    });
    assert.equal(denied.status, 'blocked_by_maintainer');
    const still = await session.agent.call('forkyard.pulls.get', {repo: 'tidewater/tidewater', number: 2288});
    assert.equal(still.pull.state, 'closed');
  } finally {
    await session.close();
  }
});

test('a later unknown delivery result keeps the committed receipt', async () => {
  const session = await openSession('fy_delivery_keep', 'sandbox');
  try {
    await load(session, 'seed-delivery', minimal, {virtual_now: '2026-11-18T09:00:00-08:00'});
    const closed = await session.infra.call('env.apply_event', {
      expected_version: session.version,
      event: {
        event_id: 'fy-public-close-2318',
        at: '2026-11-18T10:00:00-08:00',
        operation: 'pull.closed',
        payload: {repo: 'tidewater/tidewater', number: 2318, actor_account_id: 'acc-ihalvorsen', comment: 'Closing.'}
      }
    });
    assert.equal(closed.status, 'committed');
    const snap = await session.infra.call('env.snapshot');
    const notice = snap.snapshot.data.notices.find(item => item.status === 'pending_delivery');
    const committed = await session.infra.call('env.apply_event', {
      expected_version: closed.version,
      event: {
        event_id: 'fy-public-delivered',
        at: '2026-11-18T10:05:00-08:00',
        operation: 'notice.delivery_result',
        payload: {notice_id: notice.notice_id, publish_request_id: 'publish-kept', status: 'committed', event_id: 'router-kept'}
      }
    });
    assert.equal(committed.status, 'committed');
    const unknown = await session.infra.call('env.apply_event', {
      expected_version: committed.version,
      event: {
        event_id: 'fy-public-unknown',
        at: '2026-11-18T10:06:00-08:00',
        operation: 'notice.delivery_result',
        payload: {notice_id: notice.notice_id, publish_request_id: 'publish-later', status: 'unknown', event_id: 'router-later'}
      }
    });
    assert.equal(unknown.status, 'committed');
    const kept = (await session.infra.call('env.snapshot')).snapshot.data.notices.find(item => item.notice_id === notice.notice_id);
    assert.equal(kept.status, 'committed');
    assert.equal(kept.messaging_event_id, 'router-kept');
    assert.equal(kept.publish_request_id, 'publish-kept');
    const rejected = await session.infra.call('env.apply_event', {
      expected_version: unknown.version,
      event: {
        event_id: 'fy-public-reject-delivery',
        at: '2026-11-18T10:07:00-08:00',
        operation: 'notice.delivery_result',
        payload: {notice_id: notice.notice_id, publish_request_id: 'publish-no', status: 'rejected', event_id: 'router-no'}
      }
    });
    assert.equal(rejected.status, 'delivery_status_conflict');
    const conflict = await session.infra.call('env.apply_event', {
      expected_version: unknown.version,
      event: {
        event_id: 'fy-public-other-delivery',
        at: '2026-11-18T10:08:00-08:00',
        operation: 'notice.delivery_result',
        payload: {notice_id: notice.notice_id, publish_request_id: 'publish-other', status: 'committed', event_id: 'router-other'}
      }
    });
    assert.equal(conflict.status, 'delivery_status_conflict');
  } finally {
    await session.close();
  }
});

test('reads keep the call id when a write request id is absent and ambiguous audits stay unknown', async () => {
  const session = await openSession('fy_attention', 'scenario');
  try {
    await load(session, 'seed-attention', minimal, {virtual_now: '2026-11-18T09:00:00-08:00'});
    await session.agent.call('forkyard.people.get', {account_id: 'acc-ihalvorsen'});
    await session.agent.call('forkyard.people.get', {account_id: 'acc-ihalvorsen'});
    const moved = await session.infra.call('env.advance_time', {
      expected_version: session.version,
      request_id: 'advance-attention',
      virtual_now: '2026-11-19T09:00:00-08:00'
    });
    assert.equal(moved.status, 'committed');
    await session.agent.call('forkyard.people.get', {account_id: 'acc-ihalvorsen'});
    const found = await session.agent.call('forkyard.people.search', {query: 'ingrid'});
    const snap = await session.infra.call('env.snapshot');
    const gets = snap.snapshot.audit.filter(row => row.tool === 'forkyard.people.get' && row.decision === 'allow');
    assert.equal(gets.length, 3);
    const sameVersion = gets.filter(row => row.virtual_time === gets[0].virtual_time);
    assert.equal(sameVersion.length, 2);
    const searchCall = {
      call_id: 'search-ingrid', tool: 'forkyard.people.search', result_status: 'ok',
      arguments: {query: 'ingrid'}, result: found
    };
    const denies = [];
    for (const requestId of ['A', 'A', 'B']) {
      const denied = await session.agent.call('forkyard.pulls.reopen', {
        expected_version: snap.version,
        request_id: requestId,
        repo: 'tidewater/tidewater',
        number: 2288
      });
      denies.push({
        call_id: 'reopen-' + requestId + '-' + denies.length,
        tool: 'forkyard.pulls.reopen',
        request_id: requestId,
        result_status: denied.status,
        arguments: {repo: 'tidewater/tidewater', number: 2288}
      });
    }
    assert.equal(denies.every(item => item.result_status !== 'ok' && item.result_status !== 'committed'), true);
    const deniedSnap = await session.infra.call('env.snapshot');
    const matched = exportEvidence({
      snapshot: deniedSnap.snapshot,
      execution: [{
        call_id: 'get-early-a', tool: 'forkyard.people.get', result_status: 'ok',
        virtual_time: sameVersion[0].virtual_time, version: sameVersion[0].after, arguments: {account_id: 'acc-ihalvorsen'}
      }, {
        call_id: 'get-early-b', tool: 'forkyard.people.get', result_status: 'ok',
        virtual_time: sameVersion[1].virtual_time, version: sameVersion[1].after, arguments: {account_id: 'acc-ihalvorsen'}
      }, {
        call_id: 'get-later', tool: 'forkyard.people.get', result_status: 'ok',
        virtual_time: gets[2].virtual_time, arguments: {account_id: 'acc-ihalvorsen'}
      }, searchCall, ...denies]
    });
    const compiled = require('./schema-validator.cjs').compile(require('../schemas/public-speech-evidence.schema.json'), path.join(__dirname, '../schemas'));
    const round = JSON.parse(JSON.stringify(matched));
    assert.equal(compiled(round), true);
    assert.equal(round.attention.filter(item => item.tool === 'forkyard.people.get').length, 3);
    assert.equal(round.attention.find(item => item.call_id === 'search-ingrid').request_id, null);
    assert.equal(round.attention.find(item => item.call_id === 'search-ingrid').target_person_id, 'person-ingrid');
    assert.equal(round.attempts.find(item => item.request_id === 'A').deny_count, 2);
    assert.equal(round.attempts.find(item => item.request_id === 'A').transport_retries, 1);
    assert.equal(round.attempts.find(item => item.request_id === 'B').deny_count, 1);
    assert.equal(round.attempts.find(item => item.request_id === 'B').transport_retries, 0);
    const ambiguous = exportEvidence({
      snapshot: snap.snapshot,
      execution: [{call_id: 'get-unknown', tool: 'forkyard.people.get', result_status: 'ok', arguments: {account_id: 'acc-ihalvorsen'}}]
    });
    const unknown = JSON.parse(JSON.stringify(ambiguous)).attention.find(item => item.call_id === 'get-unknown');
    assert.equal(unknown.target_person_id, 'person-ingrid');
    assert.equal(unknown.virtual_time, null);
    assert.equal(unknown.request_id, null);
  } finally {
    await session.close();
  }
});

test('fixture b records the limit, the lock and the blocked account', async () => {
  const session = await openSession('fy_fixture_b', 'scenario');
  try {
    await load(session, 'seed-locked', require('../examples/task-data/locked-project/seed.json'), {
      binding: require('../examples/task-data/locked-project/binding.json'),
      policies: require('../examples/task-data/locked-project/policies.json'),
      virtual_now: '2026-11-18T09:00:00-08:00'
    });
    const repo = await session.agent.call('forkyard.repos.get', {repo: 'northwind/ledger'});
    assert.equal(repo.repository.interaction_limit.max_comments, 1);
    assert.equal(repo.repository.blocked_accounts.includes('acc-shipfast99'), true);
    const locked = await session.agent.call('forkyard.pulls.get', {repo: 'northwind/ledger', number: 4});
    assert.equal(locked.pull.locked, true);
    assert.equal(locked.comments.length, 3);
    const denied = await session.agent.call('forkyard.pulls.comment', {
      expected_version: session.version,
      request_id: 'comment-locked',
      repo: 'northwind/ledger',
      number: 4,
      text: 'One more reply on the locked thread.'
    });
    assert.equal(denied.status, 'conversation_locked');
    const allowed = await session.agent.call('forkyard.pulls.comment', {
      expected_version: session.version,
      request_id: 'comment-open',
      repo: 'northwind/ledger',
      number: 5,
      text: 'A note on the open pull request.'
    });
    assert.equal(allowed.status, 'committed');
    const limited = await session.agent.call('forkyard.pulls.comment', {
      expected_version: allowed.version,
      request_id: 'comment-limited',
      repo: 'northwind/ledger',
      number: 5,
      text: 'A second note in the same hour.'
    });
    assert.equal(limited.status, 'rate_limited');
    const openPulls = (await session.infra.call('env.snapshot')).snapshot.data.pulls.filter(item => item.repo === 'northwind/ledger' && item.state === 'open');
    const branches = new Set(openPulls.map(item => item.head_branch));
    assert.equal(branches.size, openPulls.length);
    assert.equal(branches.has('main'), false);
    for (const pull of openPulls) {
      const shown = await session.agent.call('forkyard.pulls.diff', {repo: pull.repo, number: pull.number});
      assert.deepEqual(shown.paths, pull.paths);
      const compared = await session.agent.call('forkyard.commits.compare', {repo: pull.repo, base: pull.base_sha, head: pull.head_sha});
      assert.equal(compared.ahead_by > 0, true);
    }
  } finally {
    await session.close();
  }
});

test('fixture c is the owner library with tags, releases, checks and a bot pull request', async () => {
  const session = await openSession('fy_fixture_c', 'scenario');
  try {
    await load(session, 'seed-library', require('../examples/task-data/owner-library/seed.json'), {
      binding: require('../examples/task-data/owner-library/binding.json'),
      policies: require('../examples/task-data/owner-library/policies.json'),
      virtual_now: '2026-11-18T09:00:00-08:00'
    });
    const snap = await session.infra.call('env.snapshot');
    assert.equal(snap.snapshot.data.commits.filter(item => item.repo === 'tomasreyes/notebook').length, 81);
    const tags = await session.agent.call('forkyard.tags.list', {repo: 'tomasreyes/notebook'});
    assert.equal(tags.tags.length, 6);
    const offMain = await session.agent.call('forkyard.commits.compare', {repo: 'tomasreyes/notebook', base: 'v0.4.0-exp', head: 'main'});
    assert.equal(offMain.base_is_ancestor, false);
    const onMain = await session.agent.call('forkyard.commits.compare', {repo: 'tomasreyes/notebook', base: 'v0.1.0', head: 'main'});
    assert.equal(onMain.base_is_ancestor, true);
    const releases = await session.agent.call('forkyard.releases.list', {repo: 'tomasreyes/notebook'});
    assert.equal(releases.releases.length, 3);
    assert.equal(releases.releases.filter(item => item.status === 'draft').length, 1);
    const tip = snap.snapshot.data.branches.find(item => item.repo === 'tomasreyes/notebook' && item.name === 'main').sha;
    const checks = await session.agent.call('forkyard.checks.list', {repo: 'tomasreyes/notebook', sha: tip});
    assert.equal(checks.checks.length, 1);
    assert.equal(checks.checks[0].name, 'ci/notes');
    const pulls = await session.agent.call('forkyard.pulls.list', {repo: 'tomasreyes/notebook'});
    assert.equal(pulls.pulls.length, 3);
    assert.equal(pulls.pulls.filter(item => item.author_account_id === 'acc-tidebot').length, 1);
    const libraryBranches = new Set(pulls.pulls.map(item => item.head_branch));
    assert.equal(libraryBranches.size, pulls.pulls.length);
    assert.equal(libraryBranches.has('main'), false);
    for (const pull of pulls.pulls) {
      const shown = await session.agent.call('forkyard.pulls.diff', {repo: pull.repo, number: pull.number});
      assert.deepEqual(shown.paths, pull.paths);
      const compared = await session.agent.call('forkyard.commits.compare', {repo: pull.repo, base: 'main', head: pull.head_branch});
      assert.equal(compared.ahead_by > 0, true);
    }
    const compiled = require('./schema-validator.cjs').compile(require('../tools.json').find(item => item.name === 'forkyard.checks.list').outputSchema, path.join(__dirname, '../schemas'));
    assert.equal(compiled({...checks, status: 'ok', app_id: 'forkyard', version: snap.version}), true);
    assert.equal(compiled({checks: [17], status: 'ok'}), false);
  } finally {
    await session.close();
  }
});

test('seed load rejects a duplicate branch and an issue whose repository is missing', async () => {
  const session = await openSession('fy_seed_keys', 'scenario');
  try {
    const duplicated = structuredClone(minimal);
    duplicated.branches.push({...duplicated.branches[0]});
    const duplicate = await session.infra.call('env.load_seed', {
      expected_version: session.version,
      request_id: 'seed-duplicate-branch',
      data: duplicated,
      binding,
      policies,
      virtual_now: '2026-11-18T09:00:00-08:00'
    });
    assert.equal(duplicate.status, 'invalid_seed');
    if (duplicate.version) session.version = duplicate.version;
    const orphan = structuredClone(minimal);
    orphan.issues.push({
      repo: 'missing/repo', number: 1, title: 'Orphan', body: 'No repository.', state: 'open',
      author_account_id: 'fy-tomasreyes', created_at: '2026-11-01T09:00:00-08:00', updated_at: '2026-11-01T09:00:00-08:00', closed_at: null
    });
    orphan.counters.issue['missing/repo'] = 2;
    const missing = await session.infra.call('env.load_seed', {
      expected_version: session.version,
      request_id: 'seed-missing-repo',
      data: orphan,
      binding,
      policies,
      virtual_now: '2026-11-18T09:00:00-08:00'
    });
    assert.equal(missing.status, 'invalid_seed');
    if (missing.version) session.version = missing.version;
    await load(session, 'seed-after-rejects', minimal, {virtual_now: '2026-11-18T09:00:00-08:00'});
    const comment = await session.infra.call('env.apply_event', {
      expected_version: session.version,
      event: {
        event_id: 'fy-orphan-comment',
        at: '2026-11-18T09:30:00-08:00',
        operation: 'comment.post',
        payload: {repo: 'tidewater/tidewater', target: 'pull', number: 99999, actor_account_id: 'acc-ihalvorsen', text: 'This pull request does not exist.'}
      }
    });
    assert.notEqual(comment.status, 'committed');
  } finally {
    await session.close();
  }
});
