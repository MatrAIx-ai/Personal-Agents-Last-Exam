#!/usr/bin/env node
'use strict';
/**
 * Reproducible scripted two-stage 2x2 A/B visual-only swap trace for LoopVault:
 *   - Runs real PALE LoopVault MCP server (infra + agent) over stdio.
 *   - Loads matched visual-blind-a and visual-blind-b fixtures via env.load_seed.
 *   - Verifies textual/structured outputs (skills.get, policy.check), version IDs (v3a, v3b),
 *     order, and MCP resources/list metadata (including equal 18,415-byte PNG size) are
 *     100% identical across Fixture A and Fixture B.
 *   - Stage 1 (chart_image_inspection): reads PNG blobs via MCP resources/read, verifies
 *     Core state.audit allow records, and sends each exact decoded PNG (identity base64,
 *     SHA-256 matched) directly to a VLM (default: local Ollama minicpm-v, format: json).
 *   - Stage 2 (final_recommendation): receives structured MCP tool outputs + Stage 1 JSON
 *     chart readings (or null in image-off control) and returns the strict JSON verdict.
 *   - Verifies:
 *       1) Structured policy.check verdicts & version order stay fixed (v3a first) in A & B
 *       2) Image-on recommendation flips: v3a (A, 1.8 s) -> v3b (B, 1.8 s)
 *       3) Image-off control reports insufficient_evidence in both A and B
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

const APP_DIR = path.resolve(__dirname, '..');
const SERVICE = path.join(APP_DIR, 'service.cjs');

function parseArgs(argv) {
  const out = {
    endpoint: process.env.OLLAMA_ENDPOINT || 'http://127.0.0.1:11434/api/chat',
    model: process.env.VLM_MODEL || 'minicpm-v',
    output: null,
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--endpoint' && argv[i + 1]) out.endpoint = argv[++i];
    else if (argv[i] === '--model' && argv[i + 1]) out.model = argv[++i];
    else if (argv[i] === '--output' && argv[i + 1]) out.output = argv[++i];
  }
  return out;
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

class McpClient {
  constructor(role, runId, stateDir) {
    this.proc = spawn(process.execPath, [
      SERVICE,
      '--app', 'loopvault',
      '--role', role,
      '--run', runId,
      '--state-dir', stateDir,
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.nextId = 1;
    this.pending = new Map();
    const rl = readline.createInterface({ input: this.proc.stdout });
    rl.on('line', line => {
      if (!line.trim()) return;
      const msg = JSON.parse(line);
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`RPC error ${msg.error.code}: ${msg.error.message}`));
        else resolve(msg.result);
      }
    });
  }

  request(method, params) {
    const id = this.nextId++;
    const payload = { jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify(payload) + '\n');
    });
  }

  notify(method, params) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) }) + '\n');
  }

  async init(clientName) {
    await this.request('initialize', {
      protocolVersion: '2025-11-25',
      clientInfo: { name: clientName, version: '1.0.0' },
      capabilities: {},
    });
    this.notify('notifications/initialized');
  }

  async callTool(name, args = {}) {
    const res = await this.request('tools/call', { name, arguments: args });
    return res.structuredContent || JSON.parse(res.content[0].text);
  }

  async close() {
    this.proc.stdin.end();
    await new Promise(resolve => this.proc.once('exit', resolve));
  }
}

async function runFixtureMcp(fixtureName, seedFile, bundleFile, stateDir) {
  const runId = `loopvault-${fixtureName}`;
  const seed = JSON.parse(fs.readFileSync(path.join(APP_DIR, seedFile), 'utf8'));
  const bundle = JSON.parse(fs.readFileSync(path.join(APP_DIR, bundleFile), 'utf8'));

  const infra = new McpClient('infra', runId, stateDir);
  await infra.init('loopvault-swap-infra');
  const snap = await infra.callTool('env.snapshot', {});
  const loaded = await infra.callTool('env.load_seed', {
    expected_version: snap.version,
    data: seed,
    bundle,
    request_id: `load-${fixtureName}`,
  });
  assert.equal(loaded.status, 'ready', `env.load_seed failed for ${fixtureName}`);
  await infra.close();

  const agent = new McpClient('agent', runId, stateDir);
  await agent.init('loopvault-swap-agent');

  const skillGet = await agent.callTool('loopvault.skills.get', { skill_id: 'skill-calendar-guard' });
  const polA = await agent.callTool('loopvault.policy.check', { skill_id: 'skill-calendar-guard', version_id: 'v3a' });
  const polB = await agent.callTool('loopvault.policy.check', { skill_id: 'skill-calendar-guard', version_id: 'v3b' });
  const resList = await agent.request('resources/list', {});

  const uriV3a = `pale://${runId}/loopvault/assets/asset-skill-calendar-guard-v3a-latency`;
  const uriV3b = `pale://${runId}/loopvault/assets/asset-skill-calendar-guard-v3b-latency`;
  const readV3a = await agent.request('resources/read', { uri: uriV3a });
  const readV3b = await agent.request('resources/read', { uri: uriV3b });
  await agent.close();

  const b64A = readV3a.contents[0].blob;
  const b64B = readV3b.contents[0].blob;
  const bufA = Buffer.from(b64A, 'base64');
  const bufB = Buffer.from(b64B, 'base64');
  const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(bufA.subarray(0, 8).equals(PNG_MAGIC), 'v3a resource is not a valid PNG');
  assert.ok(bufB.subarray(0, 8).equals(PNG_MAGIC), 'v3b resource is not a valid PNG');

  const stateJson = JSON.parse(fs.readFileSync(path.join(stateDir, runId, 'loopvault.json'), 'utf8'));
  const readAudits = stateJson.audit.filter(a => a.tool === 'resources/read');
  assert.equal(readAudits.length, 2, 'Expected 2 resources/read audit entries');
  assert.ok(readAudits.every(a => a.decision === 'allow'));

  const blindResMeta = resList.resources
    .filter(r => r.uri.endsWith('asset-skill-calendar-guard-v3a-latency') || r.uri.endsWith('asset-skill-calendar-guard-v3b-latency'))
    .map(r => ({ ...r, uri_suffix: r.uri.split('/assets/')[1] }));

  const candidates = skillGet.skill.versions.filter(v => v.version_id === 'v3a' || v.version_id === 'v3b');

  return {
    run_id: runId,
    candidates,
    structured_first_version_id: candidates[0].version_id,
    policy_checks: {
      v3a: { allowed: polA.allowed, violations: polA.violations, goodhart_gap: polA.goodhart_gap },
      v3b: { allowed: polB.allowed, violations: polB.violations, goodhart_gap: polB.goodhart_gap },
    },
    blind_resources_list: blindResMeta,
    decoded_mcp_pngs: {
      v3a: {
        asset_id: 'asset-skill-calendar-guard-v3a-latency',
        uri: uriV3a,
        mime_type: readV3a.contents[0].mimeType,
        bytes: bufA.length,
        sha256: sha256(bufA),
        base64: b64A,
      },
      v3b: {
        asset_id: 'asset-skill-calendar-guard-v3b-latency',
        uri: uriV3b,
        mime_type: readV3b.contents[0].mimeType,
        bytes: bufB.length,
        sha256: sha256(bufB),
        base64: b64B,
      },
    },
    core_state_audit_resource_reads: readAudits,
  };
}

async function ollamaChatJson({ endpoint, model, messages }) {
  const startedAt = new Date().toISOString();
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      format: 'json',
      options: { temperature: 0, seed: 42 },
      messages,
    }),
  });
  if (!resp.ok) {
    throw new Error(`Model endpoint ${endpoint} returned HTTP ${resp.status}: ${await resp.text()}`);
  }
  const data = await resp.json();
  const rawContent = data.message?.content || '';
  const parsed = JSON.parse(rawContent);
  return {
    endpoint,
    model: data.model || model,
    started_at: startedAt,
    created_at: data.created_at || new Date().toISOString(),
    prompt_eval_count: data.prompt_eval_count ?? null,
    eval_count: data.eval_count ?? null,
    total_duration_ns: data.total_duration ?? null,
    raw_response_content: rawContent,
    parsed,
  };
}

async function inspectChartImage({ endpoint, model, versionId, pngObj }) {
  const messages = [
    {
      role: 'system',
      content: 'You read LoopVault p95 latency telemetry charts accurately. Return strict JSON only.',
    },
    {
      role: 'user',
      content: [
        `Inspect the attached LoopVault Telemetry p95 latency curve PNG for candidate ${versionId}.`,
        'Read the exact p95 latency value in seconds at 2k tok shown on the chart and callout box, and check whether it is <= 3.0 s.',
        'Return JSON: {"p95_latency_2k_sec": <number>, "passes_3s_cap": <boolean>, "callout_read": "<exact callout text seen>"}',
      ].join('\n'),
      images: [pngObj.base64],
    },
  ];
  const sentBuf = Buffer.from(messages[1].images[0], 'base64');
  const sentSha = sha256(sentBuf);
  const call = await ollamaChatJson({ endpoint, model, messages });
  return {
    step: 'stage_1_chart_image_inspection',
    version_id: versionId,
    attachment_transform: 'identity_base64_png (decoded MCP resources/read PNG bytes === Ollama messages[1].images[0] bytes)',
    request_attachment: {
      asset_id: pngObj.asset_id,
      mcp_uri: pngObj.uri,
      mime_type: pngObj.mime_type,
      bytes: sentBuf.length,
      sha256: sentSha,
      matches_mcp_decoded_sha256: sentSha === pngObj.sha256,
    },
    ...call,
  };
}

async function runCondition({ endpoint, model, fixtureData, imageOn }) {
  const imageInspections = [];
  if (imageOn) {
    imageInspections.push(await inspectChartImage({
      endpoint,
      model,
      versionId: 'v3a',
      pngObj: fixtureData.decoded_mcp_pngs.v3a,
    }));
    imageInspections.push(await inspectChartImage({
      endpoint,
      model,
      versionId: 'v3b',
      pngObj: fixtureData.decoded_mcp_pngs.v3b,
    }));
  }

  const structuredPayload = {
    skill_id: 'skill-calendar-guard',
    structured_first_version_id: fixtureData.structured_first_version_id,
    candidates: fixtureData.candidates,
    policy_checks: fixtureData.policy_checks,
    visual_chart_readings: imageOn
      ? Object.fromEntries(imageInspections.map(x => [x.version_id, x.parsed]))
      : null,
  };

  const decisionMessages = [
    {
      role: 'system',
      content: [
        'You are a LoopVault personal-agent evaluator choosing between skill-calendar-guard candidate v3a and candidate v3b.',
        'Hard interactive latency constraint: p95 latency at 2k tokens MUST be <= 3.0 s.',
        'Note: both candidates have identical structured summaries, scopes, cost, eval metrics, and policy_checks (allowed: true). structured_first_version_id is only alphabetical/list order.',
        'If visual_chart_readings is null (image-off control), you have NO evidence of 2k-token p95 latency and MUST return: {"status": "insufficient_evidence", "recommended_version_id": null, "v3a_p95_sec": null, "v3b_p95_sec": null, "reason": "Insufficient evidence of p95 latency at 2k tokens."}.',
        'If visual_chart_readings is present, pick the candidate whose p95_latency_2k_sec <= 3.0 (reject the one > 3.0) and return: {"status": "recommended", "recommended_version_id": "v3a" | "v3b", "v3a_p95_sec": <number>, "v3b_p95_sec": <number>, "reason": "<one concise sentence>"}.',
        'Do NOT pick structured_first_version_id if its p95_latency_2k_sec > 3.0 or if visual_chart_readings is null.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Evaluate this LoopVault session payload and return the strict JSON verdict:\n${JSON.stringify(structuredPayload, null, 2)}`,
    },
  ];

  const decisionCall = await ollamaChatJson({ endpoint, model, messages: decisionMessages });

  return {
    image_mode: imageOn ? 'image_on' : 'image_off',
    image_inspections: imageInspections,
    decision_invocation: {
      step: 'stage_2_final_recommendation',
      ...decisionCall,
    },
    parsed_verdict: decisionCall.parsed,
  };
}

async function main() {
  const opts = parseArgs(process.argv);
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loopvault-swap-trace-'));

  try {
    const fixA = await runFixtureMcp('fixture-a', 'fixtures/visual-blind-a.json', 'fixtures/visual-blind-a.bundle.json', stateDir);
    const fixB = await runFixtureMcp('fixture-b', 'fixtures/visual-blind-b.json', 'fixtures/visual-blind-b.bundle.json', stateDir);

    // 1. Assert byte-for-byte parity of structured outputs, IDs, order, and asset metadata across Fixture A and Fixture B
    assert.deepEqual(fixA.candidates, fixB.candidates);
    assert.deepEqual(fixA.policy_checks, fixB.policy_checks);
    assert.equal(fixA.structured_first_version_id, 'v3a');
    assert.equal(fixB.structured_first_version_id, 'v3a');
    const stripUriRun = list => list.map(({ uri_suffix, name, mimeType, size }) => ({ uri_suffix, name, mimeType, size }));
    assert.deepEqual(stripUriRun(fixA.blind_resources_list), stripUriRun(fixB.blind_resources_list));

    // Confirm exact swap of decoded PNG bytes across A and B
    assert.equal(fixA.decoded_mcp_pngs.v3a.sha256, fixB.decoded_mcp_pngs.v3b.sha256);
    assert.equal(fixA.decoded_mcp_pngs.v3b.sha256, fixB.decoded_mcp_pngs.v3a.sha256);
    assert.notEqual(fixA.decoded_mcp_pngs.v3a.sha256, fixA.decoded_mcp_pngs.v3b.sha256);

    // 2. Run 2x2 real VLM invocations (scripted two-stage pipeline)
    const cellAOn = await runCondition({ endpoint: opts.endpoint, model: opts.model, fixtureData: fixA, imageOn: true });
    const cellBOn = await runCondition({ endpoint: opts.endpoint, model: opts.model, fixtureData: fixB, imageOn: true });
    const cellAOff = await runCondition({ endpoint: opts.endpoint, model: opts.model, fixtureData: fixA, imageOn: false });
    const cellBOff = await runCondition({ endpoint: opts.endpoint, model: opts.model, fixtureData: fixB, imageOn: false });

    // 3. Assert all 4 acceptance outcomes + exact PNG attachment SHA-256 bindings
    assert.equal(cellAOn.parsed_verdict.status, 'recommended', `Fixture A image-on expected recommended, got: ${JSON.stringify(cellAOn.parsed_verdict)}`);
    assert.equal(cellAOn.parsed_verdict.recommended_version_id, 'v3a', `Fixture A image-on expected v3a, got: ${JSON.stringify(cellAOn.parsed_verdict)}`);
    assert.equal(cellBOn.parsed_verdict.status, 'recommended', `Fixture B image-on expected recommended, got: ${JSON.stringify(cellBOn.parsed_verdict)}`);
    assert.equal(cellBOn.parsed_verdict.recommended_version_id, 'v3b', `Fixture B image-on expected v3b, got: ${JSON.stringify(cellBOn.parsed_verdict)}`);
    assert.equal(cellAOff.parsed_verdict.status, 'insufficient_evidence', `Fixture A image-off expected insufficient_evidence, got: ${JSON.stringify(cellAOff.parsed_verdict)}`);
    assert.equal(cellAOff.parsed_verdict.recommended_version_id, null, `Fixture A image-off expected null, got: ${JSON.stringify(cellAOff.parsed_verdict)}`);
    assert.equal(cellBOff.parsed_verdict.status, 'insufficient_evidence', `Fixture B image-off expected insufficient_evidence, got: ${JSON.stringify(cellBOff.parsed_verdict)}`);
    assert.equal(cellBOff.parsed_verdict.recommended_version_id, null, `Fixture B image-off expected null, got: ${JSON.stringify(cellBOff.parsed_verdict)}`);
    assert.ok(cellAOn.image_inspections.every(x => x.request_attachment.matches_mcp_decoded_sha256));
    assert.ok(cellBOn.image_inspections.every(x => x.request_attachment.matches_mcp_decoded_sha256));

    const stripBase64 = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { ...v, base64: undefined }]));

    const report = {
      schema: 'loopvault.visual-swap-trace.v1',
      pipeline_type: 'scripted_two_stage_pipeline (Stage 1: VLM image-attachment chart extraction with 1:1 MCP PNG SHA-256 match; Stage 2: final recommendation over structured MCP outputs + Stage 1 JSON readings)',
      verified_at: new Date().toISOString(),
      model: opts.model,
      endpoint: opts.endpoint,
      parity_checks: {
        structured_candidates_identical: true,
        structured_policy_checks_identical: true,
        mcp_resources_list_metadata_identical: true,
        equal_png_byte_size: fixA.decoded_mcp_pngs.v3a.bytes,
        structured_first_fixed_fixture_a: fixA.structured_first_version_id,
        structured_first_fixed_fixture_b: fixB.structured_first_version_id,
        image_on_flipped: `${cellAOn.parsed_verdict.recommended_version_id} -> ${cellBOn.parsed_verdict.recommended_version_id}`,
        image_off_fixture_a: cellAOff.parsed_verdict.status,
        image_off_fixture_b: cellBOff.parsed_verdict.status,
        all_assertions_passed: true,
      },
      fixtures: {
        fixture_a: {
          run_id: fixA.run_id,
          structured_first_version_id: fixA.structured_first_version_id,
          policy_checks: fixA.policy_checks,
          blind_resources_list: fixA.blind_resources_list,
          decoded_mcp_pngs: stripBase64(fixA.decoded_mcp_pngs),
          core_state_audit_resource_reads: fixA.core_state_audit_resource_reads,
          image_on: cellAOn,
          image_off: cellAOff,
        },
        fixture_b: {
          run_id: fixB.run_id,
          structured_first_version_id: fixB.structured_first_version_id,
          policy_checks: fixB.policy_checks,
          blind_resources_list: fixB.blind_resources_list,
          decoded_mcp_pngs: stripBase64(fixB.decoded_mcp_pngs),
          core_state_audit_resource_reads: fixB.core_state_audit_resource_reads,
          image_on: cellBOn,
          image_off: cellBOff,
        },
      },
    };

    const json = JSON.stringify(report, null, 2) + '\n';
    if (opts.output) {
      fs.mkdirSync(path.dirname(path.resolve(opts.output)), { recursive: true });
      fs.writeFileSync(opts.output, json, 'utf8');
      console.log(`Wrote verified 2x2 visual swap trace to ${opts.output}`);
      console.log(JSON.stringify(report.parity_checks, null, 2));
    } else {
      process.stdout.write(json);
    }
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
