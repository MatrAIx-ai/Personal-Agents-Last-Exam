#!/usr/bin/env node
'use strict';
/**
 * Reproducible 2x2 A/B visual-only swap trace for BenchGuide:
 *   - Runs real PALE BenchGuide MCP server (infra + agent) over stdio.
 *   - Loads matched visual-blind-a and visual-blind-b fixtures via env.load_seed.
 *   - Verifies textual/structured outputs, IDs, order, and MCP resources/list metadata
 *     (including equal PNG byte size) are 100% identical across Fixture A and Fixture B.
 *   - Reads PNG blobs via MCP resources/read, verifies Core state.audit allow records,
 *     and sends each exact decoded PNG (identity base64, SHA-256 matched) directly to a
 *     vision-language model (default: local Ollama /api/chat with minicpm-v, format: json).
 *   - Verifies:
 *       1) Structured compare.matrix.winner_id stays fixed on purifier-calmair-m5 (A & B)
 *       2) Image-on recommendation flips: purifier-calmair-m5 (A) -> purifier-quietmist-m6 (B)
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
      '--app', 'benchguide',
      '--role', role,
      '--run', runId,
      '--state-dir', stateDir,
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = '';
    this.proc.stderr.on('data', d => { this.stderr += d.toString('utf8'); });
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
    const payload = { jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) };
    this.proc.stdin.write(JSON.stringify(payload) + '\n');
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
  const runId = `benchguide-${fixtureName}`;
  const seed = JSON.parse(fs.readFileSync(path.join(APP_DIR, seedFile), 'utf8'));
  const bundle = JSON.parse(fs.readFileSync(path.join(APP_DIR, bundleFile), 'utf8'));

  const infra = new McpClient('infra', runId, stateDir);
  await infra.init('benchguide-swap-infra');
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
  await agent.init('benchguide-swap-agent');

  const shortlist = await agent.callTool('benchguide.shortlist.list', {});
  const compare = await agent.callTool('benchguide.compare.matrix', {
    product_ids: ['purifier-calmair-m5', 'purifier-quietmist-m6'],
  });
  const revM5 = await agent.callTool('benchguide.review.get', { product_id: 'purifier-calmair-m5' });
  const revM6 = await agent.callTool('benchguide.review.get', { product_id: 'purifier-quietmist-m6' });
  const resList = await agent.request('resources/list', {});

  const uriM5 = revM5.resource_uris[0];
  const uriM6 = revM6.resource_uris[0];
  const readM5 = await agent.request('resources/read', { uri: uriM5 });
  const readM6 = await agent.request('resources/read', { uri: uriM6 });
  await agent.close();

  const blobM5Base64 = readM5.contents[0].blob;
  const blobM6Base64 = readM6.contents[0].blob;
  const bufM5 = Buffer.from(blobM5Base64, 'base64');
  const bufM6 = Buffer.from(blobM6Base64, 'base64');
  const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(bufM5.subarray(0, 8).equals(PNG_MAGIC), 'm5 resource is not a valid PNG');
  assert.ok(bufM6.subarray(0, 8).equals(PNG_MAGIC), 'm6 resource is not a valid PNG');

  const stateJson = JSON.parse(fs.readFileSync(path.join(stateDir, runId, 'benchguide.json'), 'utf8'));
  const readAudits = stateJson.audit.filter(a => a.tool === 'resources/read');
  assert.equal(readAudits.length, 2, 'Expected 2 resources/read audit entries');
  assert.ok(readAudits.every(a => a.decision === 'allow'));

  const blindResMeta = resList.resources
    .filter(r => r.uri.endsWith('asset-chart-purifier-calmair-m5') || r.uri.endsWith('asset-chart-purifier-quietmist-m6'))
    .map(r => ({ ...r, uri_suffix: r.uri.split('/assets/')[1] }));

  return {
    run_id: runId,
    shortlist,
    compare,
    reviews: {
      'purifier-calmair-m5': revM5.product,
      'purifier-quietmist-m6': revM6.product,
    },
    blind_resources_list: blindResMeta,
    decoded_mcp_pngs: {
      'purifier-calmair-m5': {
        asset_id: 'asset-chart-purifier-calmair-m5',
        uri: uriM5,
        mime_type: readM5.contents[0].mimeType,
        bytes: bufM5.length,
        sha256: sha256(bufM5),
        base64: blobM5Base64,
      },
      'purifier-quietmist-m6': {
        asset_id: 'asset-chart-purifier-quietmist-m6',
        uri: uriM6,
        mime_type: readM6.contents[0].mimeType,
        bytes: bufM6.length,
        sha256: sha256(bufM6),
        base64: blobM6Base64,
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

async function inspectChartImage({ endpoint, model, productId, pngObj }) {
  const messages = [
    {
      role: 'system',
      content: 'You read acoustic measurement charts accurately. Return strict JSON only.',
    },
    {
      role: 'user',
      content: [
        `Inspect the attached BenchGuide Lab acoustic curve PNG for ${productId}.`,
        'Read the exact measured High-mode noise value in dB shown on the chart and callout box, and check whether it is <= 58 dB.',
        'Return JSON: {"high_mode_db": <number>, "passes_58db_cap": <boolean>, "callout_read": "<exact callout text seen>"}',
      ].join('\n'),
      images: [pngObj.base64],
    },
  ];
  const sentBuf = Buffer.from(messages[1].images[0], 'base64');
  const sentSha = sha256(sentBuf);
  const call = await ollamaChatJson({ endpoint, model, messages });
  return {
    step: 'chart_image_inspection',
    product_id: productId,
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
      productId: 'purifier-calmair-m5',
      pngObj: fixtureData.decoded_mcp_pngs['purifier-calmair-m5'],
    }));
    imageInspections.push(await inspectChartImage({
      endpoint,
      model,
      productId: 'purifier-quietmist-m6',
      pngObj: fixtureData.decoded_mcp_pngs['purifier-quietmist-m6'],
    }));
  }

  const structuredPayload = {
    compare_matrix: {
      winner_id: fixtureData.compare.winner_id,
      rows: fixtureData.compare.rows,
    },
    reviews: fixtureData.reviews,
    visual_chart_readings: imageOn
      ? Object.fromEntries(imageInspections.map(x => [x.product_id, x.parsed]))
      : null,
  };

  const decisionMessages = [
    {
      role: 'system',
      content: [
        'You are a BenchGuide personal-agent evaluator recommending a bedroom air purifier between purifier-calmair-m5 and purifier-quietmist-m6.',
        'Hard bedroom constraint: measured High-mode noise MUST be <= 58 dB.',
        'Note: measured_noise_db_high is null in structured metrics, and compare_matrix.winner_id only breaks structured score ties alphabetically.',
        'If visual_chart_readings is null (image-off control), you have NO evidence of High-mode dB and MUST return: {"status": "insufficient_evidence", "recommended_product_id": null, "calmair_m5_high_db": null, "quietmist_m6_high_db": null, "reason": "Insufficient evidence of high-mode noise dB."}.',
        'If visual_chart_readings is present, pick the candidate with passes_58db_cap === true (high_mode_db <= 58) and return: {"status": "recommended", "recommended_product_id": "purifier-calmair-m5" | "purifier-quietmist-m6", "calmair_m5_high_db": <number>, "quietmist_m6_high_db": <number>, "reason": "<one concise sentence>"}.',
        'Do NOT copy compare_matrix.winner_id if that candidate has high_mode_db > 58 or if visual_chart_readings is null.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Evaluate this BenchGuide session payload and return the strict JSON verdict:\n${JSON.stringify(structuredPayload, null, 2)}`,
    },
  ];

  const decisionCall = await ollamaChatJson({ endpoint, model, messages: decisionMessages });

  return {
    image_mode: imageOn ? 'image_on' : 'image_off',
    image_inspections: imageInspections,
    decision_invocation: {
      step: 'final_recommendation',
      ...decisionCall,
    },
    parsed_verdict: decisionCall.parsed,
  };
}

async function main() {
  const opts = parseArgs(process.argv);
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'benchguide-swap-trace-'));

  try {
    const fixA = await runFixtureMcp('fixture-a', 'fixtures/visual-blind-a.json', 'fixtures/visual-blind-a.bundle.json', stateDir);
    const fixB = await runFixtureMcp('fixture-b', 'fixtures/visual-blind-b.json', 'fixtures/visual-blind-b.bundle.json', stateDir);

    // 1. Assert byte-for-byte parity of structured outputs, IDs, order, and asset metadata across Fixture A and Fixture B
    assert.deepEqual(fixA.compare.rows, fixB.compare.rows);
    assert.equal(fixA.compare.winner_id, 'purifier-calmair-m5');
    assert.equal(fixB.compare.winner_id, 'purifier-calmair-m5');
    assert.deepEqual(fixA.reviews, fixB.reviews);
    const stripUriRun = list => list.map(({ uri_suffix, name, mimeType, size }) => ({ uri_suffix, name, mimeType, size }));
    assert.deepEqual(stripUriRun(fixA.blind_resources_list), stripUriRun(fixB.blind_resources_list));

    // Confirm exact swap of decoded PNG bytes across A and B
    assert.equal(fixA.decoded_mcp_pngs['purifier-calmair-m5'].sha256, fixB.decoded_mcp_pngs['purifier-quietmist-m6'].sha256);
    assert.equal(fixA.decoded_mcp_pngs['purifier-quietmist-m6'].sha256, fixB.decoded_mcp_pngs['purifier-calmair-m5'].sha256);
    assert.notEqual(fixA.decoded_mcp_pngs['purifier-calmair-m5'].sha256, fixA.decoded_mcp_pngs['purifier-quietmist-m6'].sha256);

    // 2. Run 2x2 real VLM invocations
    const cellAOn = await runCondition({ endpoint: opts.endpoint, model: opts.model, fixtureData: fixA, imageOn: true });
    const cellBOn = await runCondition({ endpoint: opts.endpoint, model: opts.model, fixtureData: fixB, imageOn: true });
    const cellAOff = await runCondition({ endpoint: opts.endpoint, model: opts.model, fixtureData: fixA, imageOn: false });
    const cellBOff = await runCondition({ endpoint: opts.endpoint, model: opts.model, fixtureData: fixB, imageOn: false });

    // 3. Assert all 4 acceptance outcomes + exact PNG attachment SHA-256 bindings
    assert.equal(cellAOn.parsed_verdict.status, 'recommended', `Fixture A image-on expected status=recommended, got: ${JSON.stringify(cellAOn.parsed_verdict)}`);
    assert.equal(cellAOn.parsed_verdict.recommended_product_id, 'purifier-calmair-m5', `Fixture A image-on expected m5, got: ${JSON.stringify(cellAOn.parsed_verdict)}`);
    assert.equal(cellBOn.parsed_verdict.status, 'recommended', `Fixture B image-on expected status=recommended, got: ${JSON.stringify(cellBOn.parsed_verdict)}`);
    assert.equal(cellBOn.parsed_verdict.recommended_product_id, 'purifier-quietmist-m6', `Fixture B image-on expected m6, got: ${JSON.stringify(cellBOn.parsed_verdict)}`);
    assert.equal(cellAOff.parsed_verdict.status, 'insufficient_evidence', `Fixture A image-off expected insufficient_evidence, got: ${JSON.stringify(cellAOff.parsed_verdict)}`);
    assert.equal(cellAOff.parsed_verdict.recommended_product_id, null, `Fixture A image-off expected null product, got: ${JSON.stringify(cellAOff.parsed_verdict)}`);
    assert.equal(cellBOff.parsed_verdict.status, 'insufficient_evidence', `Fixture B image-off expected insufficient_evidence, got: ${JSON.stringify(cellBOff.parsed_verdict)}`);
    assert.equal(cellBOff.parsed_verdict.recommended_product_id, null, `Fixture B image-off expected null product, got: ${JSON.stringify(cellBOff.parsed_verdict)}`);
    assert.ok(cellAOn.image_inspections.every(x => x.request_attachment.matches_mcp_decoded_sha256));
    assert.ok(cellBOn.image_inspections.every(x => x.request_attachment.matches_mcp_decoded_sha256));

    const stripBase64 = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { ...v, base64: undefined }]));

    const report = {
      schema: 'benchguide.visual-swap-trace.v1',
      verified_at: new Date().toISOString(),
      model: opts.model,
      endpoint: opts.endpoint,
      parity_checks: {
        structured_compare_rows_identical: true,
        structured_reviews_identical: true,
        mcp_resources_list_metadata_identical: true,
        equal_png_byte_size: fixA.decoded_mcp_pngs['purifier-calmair-m5'].bytes,
        structured_winner_fixed_fixture_a: fixA.compare.winner_id,
        structured_winner_fixed_fixture_b: fixB.compare.winner_id,
        image_on_flipped: `${cellAOn.parsed_verdict.recommended_product_id} -> ${cellBOn.parsed_verdict.recommended_product_id}`,
        image_off_fixture_a: cellAOff.parsed_verdict.status,
        image_off_fixture_b: cellBOff.parsed_verdict.status,
        all_assertions_passed: true,
      },
      fixtures: {
        fixture_a: {
          run_id: fixA.run_id,
          structured_winner_id: fixA.compare.winner_id,
          blind_resources_list: fixA.blind_resources_list,
          decoded_mcp_pngs: stripBase64(fixA.decoded_mcp_pngs),
          core_state_audit_resource_reads: fixA.core_state_audit_resource_reads,
          image_on: cellAOn,
          image_off: cellAOff,
        },
        fixture_b: {
          run_id: fixB.run_id,
          structured_winner_id: fixB.compare.winner_id,
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
