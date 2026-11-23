'use strict';

const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {mkdtempSync, rmSync} = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {performance} = require('node:perf_hooks');
const {getScenario} = require('./scenario.cjs');

const BASELINE = 'a4bce023953061483c41de5a287ba5e43f4a5648';
const ACCOUNT = 'research-files';
const OWNER = 'synthetic-researcher';
const DATASET = 'research-results-provenance-files-smoke';
const REPORT = 'group-meeting-summary';
const INPUT = 'research-inputs';
const OUTPUT = 'internal-reports';

function textFile(filename, contents) {
  const bytes = Buffer.from(contents, 'utf8');
  return {
    filename,
    mime_type: 'text/plain',
    base64: bytes.toString('base64'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function record({id, at, name, parentId = null, assetId}) {
  return {
    id,
    name,
    account_id: ACCOUNT,
    created_at: at,
    updated_at: at,
    history: [{at, action: 'seeded'}],
    parent_id: parentId,
    kind: assetId ? 'file' : 'folder',
    trashed: false,
    versions: assetId ? [{number: 1, asset_id: assetId, at, source: 'Synthetic fixture'}] : [],
  };
}

function fixture(scenario, ids) {
  const descriptors = [];
  const blobs = {};
  const files = [
    record({id: INPUT, name: 'Research inputs', at: scenario.sources[0].at}),
    record({id: OUTPUT, name: 'Internal reports', at: scenario.originalReportAt}),
  ];

  const add = (id, at, text, parentId) => {
    const assetId = `${id}-text`;
    const file = textFile(`${id}.txt`, text);
    files.push(record({id, at, name: file.filename, parentId, assetId}));
    descriptors.push({
      schema_version: 'pale.asset-descriptor.v1',
      asset_id: assetId,
      scope: {level: 'task', app_id: 'files', task_id: 'research-results-provenance'},
      roles: ['content.attachment'],
      subjects: [{app_id: 'files', account_id: ACCOUNT, object_type: 'file', object_id: id}],
      mime_type: file.mime_type,
      availability: {status: 'ready'},
      storage: {
        adapter: 'storage.inline', packaging: 'bundled', path: file.filename,
        inline_base64: file.base64,
      },
      integrity: {bytes: Buffer.byteLength(text, 'utf8'), sha256: file.sha256},
      provenance: {dataset_id: DATASET, source_ids: ['authored']},
      publication: 'public',
      access: {audience: ['agent'], rule: 'parent_object'},
      media: {},
      extensions: [],
    });
    blobs[assetId] = file.base64;
  };

  add(scenario.history.id, scenario.history.at, scenario.history.text, INPUT);
  add(REPORT, scenario.originalReportAt, scenario.originalReport, OUTPUT);
  for (const id of ids) {
    const source = scenario.sources.find(item => item.id === id);
    assert(source, `Unknown scenario source: ${id}`);
    add(id, source.at, source.text, INPUT);
  }

  return {
    data: {account_id: ACCOUNT, owner_person_id: OWNER, files},
    bundle: {
      dataset: {
        schema_version: 'pale.dataset.v1', dataset_id: DATASET, version: '1.0.0',
        description: 'Synthetic research records used in the Files App integration smoke test.',
        record_source_ids: ['authored'],
        sources: [{
          source_id: 'authored', kind: 'synthetic', description: 'Hand-authored scenario fixtures.',
          uri: null, license: 'MIT', usage: 'permitted', collection: null,
          generation: {method: 'manual', tool: 'Task authoring', tool_version: '1.0.0', seed: null, parameters: {}},
        }],
        transformations: ['Mirror text scenario records into the Files App for an integration smoke test.'],
        expected_counts: {records: files.length, assets: descriptors.length},
        quality_policy: {duplicate_records: 'reject', duplicate_assets: 'reject', missing_assets: 'allow_declared'},
        review: {status: 'pending', reviewer: null, notes: 'Local integration evidence only.'},
      },
      catalog: {
        schema_version: 'pale.asset-catalog.v1', catalog_id: DATASET, app_id: 'files',
        dataset_ref: 'dataset.json', assets: descriptors, extensions: [],
      },
      blobs,
    },
  };
}

function protectedSnapshot(snapshot) {
  return snapshot.data.files.filter(item => item.parent_id === INPUT).map(item => ({
    item,
    bytes: item.versions.map(version => snapshot.resources.bundle.blobs[version.asset_id]),
  }));
}

async function runFilesSmoke(upstreamRoot) {
  const root = path.resolve(upstreamRoot);
  const {Client} = require(path.join(root, 'runtime/client.cjs'));
  const scenario = getScenario('original');
  const stateParent = path.resolve(os.tmpdir());
  const statePrefix = 'pale-pr34-files-';
  const stateDir = mkdtempSync(path.join(stateParent, statePrefix));
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const clients = [];
  const options = {registry: path.join(root, 'apps.registry.json')};
  const sessions = [];
  const receipts = [];
  try {
    for (const role of ['infra', 'agent']) {
      const client = new Client('files', role, 'research-files-smoke', stateDir, `pr34-${role}`, options);
      clients.push(client);
      await client.initialize();
    }
    const [infra, agent] = clients;
    const snapshot = async () => {
      const response = await infra.call('env.snapshot');
      assert.equal(response.status, 'ok');
      return response;
    };
    const read = async (id, number) => {
      const response = await agent.call('files.read', number ? {id, number} : {id});
      assert.equal(response.status, 'ok');
      return Buffer.from(response.file.base64, 'base64').toString('utf8');
    };

    const initialIds = scenario.sources.filter(source => Date.parse(source.at) <= Date.parse(scenario.sessions[0].at))
      .map(source => source.id);
    const initial = fixture(scenario, initialIds);
    const reportPolicy = {
      allow: ['files.get', 'files.list', 'files.put', 'files.read'],
      constraints: {'files.put': {ids: [REPORT]}},
    };
    const loaded = await infra.call('env.load_seed', {
      ...initial,
      expected_version: (await snapshot()).version,
      request_id: 'pr34-files-seed',
      virtual_now: scenario.sessions[0].at,
      binding: {
        people: [{person_id: OWNER, name: 'Synthetic researcher'}],
        accounts: [{app_id: 'files', account_id: ACCOUNT, owner_person_id: OWNER}],
        objects: {files: initial.data.files.map(item => item.id)},
      },
      policies: {scenario: reportPolicy, sandbox: reportPolicy},
    });
    assert.equal(loaded.status, 'ready', JSON.stringify(loaded));
    const seeded = await snapshot();
    assert.equal(seeded.snapshot.virtual_now, scenario.sessions[0].at);
    assert.deepEqual(seeded.snapshot.data, initial.data);
    assert.equal(await read(REPORT), scenario.originalReport);
    assert.equal(await read(scenario.history.id), scenario.history.text);
    assert.equal((await agent.call('files.read', {id: 'A-replacement'})).status, 'not_found');
    const tools = (await agent.request('tools/list')).result.tools.map(tool => tool.name).sort();
    assert.deepEqual(tools, ['files.get', 'files.list', 'files.put', 'files.read']);

    async function replayTimeline(capture) {
      const visibleIds = [...initialIds];
      let eventIndex = 0;
      for (const session of scenario.sessions) {
        while (eventIndex < scenario.events.length && Date.parse(scenario.events[eventIndex].at) < Date.parse(session.at)) {
          const event = scenario.events[eventIndex++];
          for (const id of event.sourceIds) {
            visibleIds.push(id);
            const updated = fixture(scenario, visibleIds);
            const receipt = await infra.call('env.apply_event', {
              expected_version: (await snapshot()).version,
              event: {
                event_id: `${event.id}-${id}`,
                at: event.at,
                operation: 'files.upsert',
                payload: updated.data.files.find(item => item.id === id),
              },
              bundle: updated.bundle,
            });
            assert.equal(receipt.status, 'committed', JSON.stringify(receipt));
            assert.equal(receipt.trace.applied_at, event.at);
            assert.equal(await read(id), scenario.sources.find(source => source.id === id).text);
            if (capture) receipts.push({eventId: receipt.event_id, at: receipt.trace.applied_at});
          }
        }
        const current = await snapshot();
        if (current.snapshot.virtual_now !== session.at) {
          const clock = await infra.call('env.advance_time', {
            expected_version: current.version, virtual_now: session.at, request_id: `clock-${session.id}`,
          });
          assert.equal(clock.status, 'committed', JSON.stringify(clock));
        }
        const atSession = await snapshot();
        assert.equal(atSession.snapshot.virtual_now, session.at);
        assert.deepEqual(atSession.snapshot.data, fixture(scenario, visibleIds).data);
        if (capture) sessions.push({sessionId: session.id, at: session.at, visibleSourceIds: [...visibleIds]});
      }
      assert.equal(eventIndex, scenario.events.length);
      return snapshot();
    }

    const final = await replayTimeline(true);
    const protectedBefore = protectedSnapshot(final.snapshot);
    const reportText = [
      'Files integration smoke test output.',
      'Verify that the existing internal report can be revised and read back under the task policy.',
    ].join('\n');
    const updatedReport = textFile(`${REPORT}.txt`, reportText);
    const denied = await agent.call('files.put', {
      id: 'A-old', file: updatedReport, expected_version: final.version, request_id: 'protected-write-probe',
    });
    assert.equal(denied.status, 'permission_denied');
    const forbiddenReset = await agent.call('env.reset', {expected_version: final.version});
    assert.equal(forbiddenReset.status, 'permission_denied');
    const written = await agent.call('files.put', {
      id: REPORT, file: updatedReport, expected_version: final.version, request_id: 'report-write-probe',
    });
    assert.equal(written.status, 'committed', JSON.stringify(written));
    assert.equal(await read(REPORT), reportText);
    assert.equal(await read(REPORT, 1), scenario.originalReport);
    const after = await snapshot();
    assert.deepEqual(protectedSnapshot(after.snapshot), protectedBefore);
    const audit = after.snapshot.audit.filter(entry => entry.actor === 'agent' && entry.tool === 'files.put');
    assert.deepEqual(audit.map(entry => ({
      decision: entry.decision, id: entry.input.id, changed: entry.state_changed, at: entry.virtual_time,
    })), [
      {decision: 'deny', id: 'A-old', changed: false, at: scenario.sessions.at(-1).at},
      {decision: 'allow', id: REPORT, changed: true, at: scenario.sessions.at(-1).at},
    ]);
    assert(after.snapshot.audit.some(entry =>
      entry.actor === 'agent' && entry.tool === 'env.reset' && entry.decision === 'deny'));

    const reset = await infra.call('env.reset', {expected_version: after.version});
    assert.equal(reset.status, 'ready');
    const restored = await snapshot();
    assert.equal(restored.snapshot.virtual_now, seeded.snapshot.virtual_now);
    assert.deepEqual(restored.snapshot.data, seeded.snapshot.data);
    assert.deepEqual(restored.snapshot.resources.bundle, seeded.snapshot.resources.bundle);
    const replayed = await replayTimeline(false);
    assert.deepEqual(replayed.snapshot.data, final.snapshot.data);
    assert.deepEqual(replayed.snapshot.resources.bundle, final.snapshot.resources.bundle);

    return {
      evidenceType: 'Local public Core / Files integration smoke test; no model calls',
      documentedUpstreamBaseline: BASELINE,
      coreRuntime: require(path.join(root, 'runtime/package.json')).version,
      coreApi: after.snapshot.core_api_version,
      filesApp: after.snapshot.package_version,
      node: process.version,
      startedAt,
      wallDurationMs: Math.round(performance.now() - start),
      checks: {
        seedValidated: loaded.quality.automated_pass,
        futureRecordUnavailableBeforeEvent: true,
        eventsAndClockReplayed: true,
        agentCannotReset: true,
        protectedWriteDeniedAndSnapshotsMatch: true,
        internalReportWritableAndPriorVersionReadable: true,
        trustedResetRestoresSeedAndClock: true,
      },
      sessions,
      receipts,
      audit,
      limitations: [
        'The history text is mirrored into Files solely to exercise synthetic file reads; the official task history interface is not exercised.',
        'The Files policy permits edits only to an existing report ID. Task-specific output-folder writes and other action denials require a task adapter.',
        'The report text is a smoke-test payload. End-to-end grading and agent evaluation are separate.',
      ],
    };
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    assert.equal(path.dirname(path.resolve(stateDir)), stateParent);
    assert(path.basename(stateDir).startsWith(statePrefix));
    rmSync(stateDir, {recursive: true, force: true});
  }
}

if (require.main === module) {
  const upstreamRoot = process.argv[2] || path.resolve(__dirname, '../../reference', `Personal-Agents-Last-Exam-${BASELINE}`);
  runFilesSmoke(upstreamRoot).then(evidence => {
    console.log(JSON.stringify(evidence, null, 2));
  }).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {runFilesSmoke};
