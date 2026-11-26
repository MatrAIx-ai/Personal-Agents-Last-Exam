#!/usr/bin/env node
'use strict';
// Agent trials on the reference scenarios with any OpenAI-compatible chat endpoint that supports tool calls
// (for example a local Ollama). A usability check of the environment, not a model comparison.
//
//   node apps/milepost/trials/run.cjs --scenario s1-cells-exam [--variant base] [--seeds 1,2,3]
//        [--model qwen2.5:7b-instruct] [--base-url http://127.0.0.1:11434/v1] [--temperature 0.6]
//        [--max-steps 25] [--out apps/milepost/trials/results]
//
// Run from the public PALE checkout (or set PALE_RUNTIME_ROOT). Each run starts the App through the public runtime,
// lets Infra load the scenario bundle and apply its setup, then gives the model the Agent's tools and the student's
// request. The harness fills `expected_version` (the latest version it has seen) and a fresh `request_id` for each
// write, so the model sees only business arguments; Core still checks both. Writes per run: trace.jsonl (every
// model reply and tool call), snapshot.json (env.snapshot at the end), result.json (grade and summary).
const fs = require('node:fs'), path = require('node:path');
const {grade} = require('../examples/scenarios/grade.cjs');
const {local} = require('../src/time.cjs');

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const opt = {
  scenario: args.scenario, variant: args.variant || 'base', seeds: (args.seeds || '1,2,3').split(',').map(Number),
  model: args.model || 'qwen2.5:7b-instruct', baseUrl: (args['base-url'] || 'http://127.0.0.1:11434/v1').replace(/\/$/, ''),
  temperature: Number(args.temperature ?? 0.6), maxSteps: Number(args['max-steps'] || 25),
  out: path.resolve(args.out || path.join(__dirname, 'results'))
};
const APP = path.resolve(__dirname, '..');
function runtimeRoot() {
  if (process.env.PALE_RUNTIME_ROOT) return path.resolve(process.env.PALE_RUNTIME_ROOT);
  for (let dir = APP; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'runtime/launch.cjs'))) return path.join(dir, 'runtime');
    if (path.dirname(dir) === dir) throw new Error('Run inside the public PALE checkout or set PALE_RUNTIME_ROOT.');
  }
}
const {prepare} = require(path.join(runtimeRoot(), 'prepare.cjs'));
const {Client} = require(path.join(runtimeRoot(), 'client.cjs'));

const HIDDEN = ['expected_version', 'request_id'];
const toModelName = name => name.replace(/\./g, '__');
const MAX_RESULT_CHARS = 6000, MAX_CONTEXT_CHARS = 30000;

function systemPrompt(spec, student, zone) {
  return [
    `You are a study assistant for ${student}, a student on the Milepost practice platform. You act for the student through the platform's tools.`,
    `The current time is ${spec.ask_at}, a ${({Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday'})[local(spec.ask_at, zone).weekday]} (time zone ${zone}). Write times as ISO 8601 with the UTC offset, for example 2027-03-09T19:00:00-05:00.`,
    'Use the tools to read what you need and to make the changes the student asks for. When you are done, reply to the student in plain text without calling a tool.'
  ].join('\n');
}

async function chat(messages, tools, seed) {
  const started = Date.now();
  const response = await fetch(opt.baseUrl + '/chat/completions', {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({model: opt.model, messages, tools, temperature: opt.temperature, seed, max_tokens: 900})});
  if (!response.ok) throw new Error(`Model endpoint ${response.status}: ${await response.text()}`);
  const body = await response.json();
  return {message: body.choices[0].message, usage: body.usage || null, ms: Date.now() - started};
}

// Keep the request and the latest tool results; shorten older results when the conversation grows too long.
function fit(messages) {
  let size = JSON.stringify(messages).length;
  for (let i = 2; size > MAX_CONTEXT_CHARS && i < messages.length - 4; i++) {
    if (messages[i].role === 'tool' && !messages[i].content.startsWith('[older result')) {
      size -= messages[i].content.length;
      messages[i].content = '[older result shortened to save context; call the tool again if needed]';
      size += messages[i].content.length;
    }
  }
}

async function trial(spec, seed) {
  const dir = path.join(APP, 'examples/scenarios', spec.id, opt.variant), read = f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const outDir = path.join(opt.out, spec.id, `${opt.variant}-seed${seed}`);
  fs.mkdirSync(outDir, {recursive: true});
  const trace = fs.createWriteStream(path.join(outDir, 'trace.jsonl'));
  const log = entry => trace.write(JSON.stringify(entry) + '\n');
  const prepared = prepare(APP), clients = [];
  const open = async (role, profile) => {
    const c = new Client(prepared.app, role, 'trial', path.join(prepared.root, 'state'), 'milepost-trials', {registry: prepared.registry, initialProfile: profile});
    clients.push(c); await c.initialize(); return c;
  };
  const started = Date.now();
  try {
    const infra = await open('infra', spec.assessment_id ? 'scenario' : 'sandbox'), agent = await open('agent');
    const seedData = read('seed.json');
    const loaded = await infra.call('env.load_seed', {expected_version: (await infra.call('env.snapshot')).version, request_id: 'load', data: seedData,
      binding: read('binding.json'), bundle: {dataset: read('dataset.json'), catalog: read('catalog.json'), blobs: {}}, virtual_now: spec.load_at});
    if (loaded.status !== 'ready') throw new Error('Load failed: ' + JSON.stringify(loaded));
    for (const [i, step] of spec.setup.entries()) {
      const expected_version = (await infra.call('env.snapshot')).version;
      const r = step.event ? await infra.call('env.apply_event', {expected_version, event: step.event})
        : await infra.call('env.advance_time', {expected_version, virtual_now: step.advance_to, request_id: 'setup-' + i});
      if (r.status !== 'committed') throw new Error('Setup failed: ' + JSON.stringify(r));
    }
    const listed = (await agent.request('tools/list')).result.tools;
    const byModelName = new Map(listed.map(t => [toModelName(t.name), t]));
    const tools = listed.map(t => {
      const props = Object.fromEntries(Object.entries(t.inputSchema.properties || {}).filter(([k]) => !HIDDEN.includes(k)));
      return {type: 'function', function: {name: toModelName(t.name), description: t.description,
        parameters: {type: 'object', properties: props, required: (t.inputSchema.required || []).filter(k => !HIDDEN.includes(k))}}};
    });
    let version = (await agent.call('milepost.plan.list')).version, writes = 0;
    const messages = [{role: 'system', content: systemPrompt(spec, seedData.student.display_name, seedData.student.time_zone)}, {role: 'user', content: spec.request}];
    log({type: 'start', scenario: spec.id, variant: opt.variant, seed, model: opt.model, temperature: opt.temperature, system: messages[0].content, request: spec.request, tools: tools.map(t => t.function.name)});
    let final = null, steps = 0;
    const calls = [];
    while (steps < opt.maxSteps) {
      steps++;
      fit(messages);
      const {message, usage, ms} = await chat(messages, tools, seed);
      log({type: 'model', step: steps, ms, usage, content: message.content, tool_calls: message.tool_calls || []});
      messages.push({role: 'assistant', content: message.content || '', ...(message.tool_calls?.length ? {tool_calls: message.tool_calls} : {})});
      if (!message.tool_calls?.length) { final = message.content || ''; break; }
      for (const tc of message.tool_calls) {
        const tool = byModelName.get(tc.function.name);
        let result, parsed = null;
        try { parsed = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments || '{}') : tc.function.arguments || {}; } catch { parsed = null; }
        if (!tool) result = {status: 'unknown_tool', message: `No tool named ${tc.function.name}.`};
        else if (parsed === null) result = {status: 'invalid_arguments', message: 'The arguments are not valid JSON.'};
        else {
          const full = tool.annotations?.readOnlyHint ? parsed : {...parsed, expected_version: version, request_id: `trial-${seed}-${++writes}`};
          try { result = await agent.call(tool.name, full); } catch (e) { result = {status: 'error', message: e.message}; }
          if (result && result.version) version = result.version;
        }
        calls.push({step: steps, tool: tool ? tool.name : tc.function.name, write: !!tool && !tool.annotations?.readOnlyHint, arguments: parsed, status: result?.status});
        log({type: 'tool', step: steps, tool: tool ? tool.name : tc.function.name, arguments: parsed, result});
        const text = JSON.stringify(result);
        messages.push({role: 'tool', tool_call_id: tc.id, content: text.length > MAX_RESULT_CHARS ? text.slice(0, MAX_RESULT_CHARS) + '…[truncated]' : text});
      }
    }
    const snapshot = (await infra.call('env.snapshot')).snapshot;
    fs.writeFileSync(path.join(outDir, 'snapshot.json'), JSON.stringify(snapshot, null, 2) + '\n');
    const graded = grade(snapshot, spec, opt.variant);
    const summary = {scenario: spec.id, variant: opt.variant, seed, model: opt.model, temperature: opt.temperature, pass: graded.pass,
      failed_checks: graded.checks.filter(c => !c.pass).map(c => c.name), steps, ended: final === null ? 'max_steps' : 'answer',
      tool_calls: calls.length, writes: calls.filter(c => c.write).length,
      refused: calls.filter(c => c.status && !['ok', 'committed'].includes(c.status)).length,
      by_tool: calls.reduce((m, c) => ({...m, [c.tool]: (m[c.tool] || 0) + 1}), {}), seconds: Math.round((Date.now() - started) / 1000),
      final_message: final, checks: graded.checks};
    fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(summary, null, 2) + '\n');
    log({type: 'end', pass: graded.pass, failed_checks: summary.failed_checks});
    return summary;
  } finally {
    trace.end();
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
  }
}

async function main() {
  const spec = JSON.parse(fs.readFileSync(path.join(APP, 'examples/scenarios', opt.scenario, 'scenario.json'), 'utf8'));
  for (const seed of opt.seeds) {
    const s = await trial(spec, seed);
    console.log(`${s.scenario}/${s.variant} seed ${seed}: ${s.pass ? 'PASS' : 'FAIL'} ${s.failed_checks.join(',')} steps=${s.steps} calls=${s.tool_calls} refused=${s.refused} ended=${s.ended} ${s.seconds}s`);
  }
}
if (require.main === module) main().catch(e => { console.error(e.stack || e.message); process.exit(1); });
module.exports = {trial, systemPrompt};
