#!/usr/bin/env node
'use strict';
// Agent trials with a coding-agent CLI as the whole agent (Claude Code or Codex), connected to Second Draft over MCP.
// Unlike run.cjs, the agent calls the real Agent tools itself, including expected_version and request_id.
//
//   node apps/second-draft/trials/agent-cli.cjs --agent claude|codex --scenario ID [--variant base] [--runs 3]
//        [--model M] [--effort E] [--codex-bin PATH] [--timeout-min 30] [--out apps/second-draft/trials/agents]
//
// Isolation: each run uses an empty working directory and a fresh configuration directory (CLAUDE_CONFIG_DIR or
// CODEX_HOME) that holds only a link to the existing login and, for Codex, a config with the shell, browser,
// plugin, app and memory features off. The agent therefore sees no user instructions, memories or plugins and has
// no tool except Second Draft's. Every trace is checked for other tool use; a run that used any is marked invalid.
// The system prompt is the one run.cjs gives the local model.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {spawn} = require('node:child_process');
const {grade} = require('../examples/scenarios/grade.cjs');
const {systemPrompt} = require('./run.cjs');
const {setupOf} = require('../scripts/build-scenarios.cjs');

const APP = path.resolve(__dirname, '..');
const RUNTIME = (() => {
  if (process.env.PALE_RUNTIME_ROOT) return path.resolve(process.env.PALE_RUNTIME_ROOT);
  for (let dir = APP; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'runtime/launch.cjs'))) return path.join(dir, 'runtime');
    if (path.dirname(dir) === dir) throw new Error('Run inside the public PALE checkout or set PALE_RUNTIME_ROOT.');
  }
})();
const {prepare} = require(path.join(RUNTIME, 'prepare.cjs'));
const {Client} = require(path.join(RUNTIME, 'client.cjs'));

const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const opt = {agent: arg('agent'), scenario: arg('scenario'), variant: arg('variant', 'base'), runs: Number(arg('runs', 3)),
  model: arg('model'), effort: arg('effort'), codexBin: arg('codex-bin'), timeoutMin: Number(arg('timeout-min', 30)),
  first: Number(arg('first-run', 1)), out: path.resolve(arg('out', path.join(__dirname, 'agents')))};
const HOME = os.homedir();
const scrub = text => text.split(HOME).join('~');

function codexBinary() {
  if (opt.codexBin) return opt.codexBin;
  const ext = path.join(HOME, '.vscode/extensions');
  const found = fs.existsSync(ext) ? fs.readdirSync(ext).filter(d => d.startsWith('openai.chatgpt-')).sort().reverse()
    .map(d => path.join(ext, d, 'bin/linux-x86_64/codex')).find(p => fs.existsSync(p)) : null;
  return found || 'codex';
}

function run(cmd, args, {cwd, env, timeoutMs}) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, {cwd, env: {...process.env, ...env}, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.on('data', b => { stdout += b; });
    child.stderr.on('data', b => { stderr += b; });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
    child.on('close', code => { clearTimeout(timer); resolve({code, stdout, stderr, timedOut}); });
  });
}
const version = async (cmd, args) => (await run(cmd, args, {cwd: os.tmpdir(), env: {}, timeoutMs: 20000})).stdout.trim().split('\n')[0];

// Tool calls, other tool use, final message and usage from each CLI's event stream.
const statusOf = text => { try { return JSON.parse(text).status; } catch { return null; } };
// Claude Code exposes MCP tools as mcp__<server>__<name> with characters outside [A-Za-z0-9_-] replaced by "_".
const CLAUDE_NAMES = new Map(require('../tools.json').map(t => ['mcp__second-draft__' + t.name.replace(/[^A-Za-z0-9_-]/g, '_'), t.name]));
function parseClaude(stdout) {
  const out = {calls: [], other: [], blocked: [], final: null, usage: null, offered: null};
  for (const line of stdout.split('\n').filter(Boolean)) {
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.type === 'system' && e.subtype === 'init') out.offered = e.tools;
    if (e.type === 'assistant') for (const c of e.message.content || []) {
      if (c.type !== 'tool_use') continue;
      if (CLAUDE_NAMES.has(c.name)) out.calls.push({id: c.id, tool: CLAUDE_NAMES.get(c.name), arguments: c.input});
      else out.other.push(c.name);
    }
    if (e.type === 'user') for (const c of e.message.content || []) {
      if (c.type !== 'tool_result') continue;
      const call = out.calls.find(x => x.id === c.tool_use_id), text = Array.isArray(c.content) ? c.content.map(x => x.text || '').join('') : String(c.content || '');
      if (call) call.status = c.is_error ? 'error' : statusOf(text);
      if (call && c.is_error && /permission|approv|not allowed|denied/i.test(text)) out.blocked.push(call.tool);
    }
    if (e.type === 'result') { out.final = e.result ?? null; out.usage = {...e.usage, total_cost_usd: e.total_cost_usd, num_turns: e.num_turns, duration_ms: e.duration_ms}; }
  }
  return out;
}
function parseCodex(stdout) {
  const out = {calls: [], other: [], blocked: [], final: null, usage: {input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0}, offered: null};
  for (const line of stdout.split('\n').filter(Boolean)) {
    let e; try { e = JSON.parse(line); } catch { continue; }
    const item = e.item || {};
    if (e.type === 'item.completed' && item.type === 'mcp_tool_call') {
      if (item.server === 'second-draft') {
        const text = (item.result?.content || []).map(x => x.text || '').join('');
        out.calls.push({tool: item.tool, arguments: item.arguments, status: item.error ? 'error' : statusOf(text)});
        if (item.error && /approv|permission|denied/i.test(JSON.stringify(item.error))) out.blocked.push(item.tool);
      } else out.other.push(`${item.server}.${item.tool}`);
    } else if (e.type === 'item.completed' && !['agent_message', 'reasoning', 'error'].includes(item.type)) out.other.push(item.type);
    if (e.type === 'item.completed' && item.type === 'agent_message') out.final = item.text;
    if (e.type === 'turn.completed' && e.usage) for (const k of Object.keys(out.usage)) out.usage[k] += e.usage[k] || 0;
  }
  return out;
}

async function trial(spec, n) {
  const dir = path.join(APP, 'examples/scenarios', spec.id, opt.variant), read = f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const label = opt.agent === 'claude' ? 'claude-code' : 'codex';
  const outDir = path.join(opt.out, label, spec.id, `${opt.variant}-run${n}`);
  fs.mkdirSync(outDir, {recursive: true});
  const prepared = prepare(APP), state = path.join(prepared.root, 'state'), run_id = 'trial';
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'second-draft-agent-work-')), home = fs.mkdtempSync(path.join(os.tmpdir(), 'second-draft-agent-home-'));
  const started = Date.now();
  try {
    // Infra: load the scenario and apply its setup, then hand the run to the agent.
    let infra = new Client(prepared.app, 'infra', run_id, state, 'second-draft-agent-trials', {registry: prepared.registry, initialProfile: 'sandbox'});
    await infra.initialize();
    const seed = read('seed.json');
    const loaded = await infra.call('env.load_seed', {expected_version: (await infra.call('env.snapshot')).version, request_id: 'load', data: seed,
      binding: read('binding.json'), bundle: {dataset: read('dataset.json'), catalog: read('catalog.json'), blobs: {}}, virtual_now: spec.load_at});
    if (loaded.status !== 'ready') throw new Error('Load failed: ' + JSON.stringify(loaded));
    for (const [i, step] of setupOf(spec, opt.variant).entries()) {
      const expected_version = (await infra.call('env.snapshot')).version;
      const r = step.event ? await infra.call('env.apply_event', {expected_version, event: step.event})
        : await infra.call('env.advance_time', {expected_version, virtual_now: step.advance_to, request_id: 'setup-' + i});
      if (r.status !== 'committed') throw new Error('Setup failed: ' + JSON.stringify(r));
    }
    await infra.close();
    const server = {command: process.execPath, args: [path.join(RUNTIME, 'mcp-server.cjs'), '--app', 'second-draft', '--role', 'agent', '--run', run_id, '--state-dir', state, '--registry', prepared.registry]};
    const system = systemPrompt(spec, seed.student.display_name, seed.student.time_zone);
    let cmd, args, env, parse, cli;
    if (opt.agent === 'claude') {
      fs.symlinkSync(path.join(HOME, '.claude/.credentials.json'), path.join(home, '.credentials.json'));
      const cfg = path.join(home, 'mcp.json');
      fs.writeFileSync(cfg, JSON.stringify({mcpServers: {'second-draft': server}}));
      cmd = 'claude'; env = {CLAUDE_CONFIG_DIR: home}; parse = parseClaude; cli = await version('claude', ['--version']);
      args = ['-p', spec.request, '--system-prompt', system, '--mcp-config', cfg, '--strict-mcp-config', '--tools', '', '--allowedTools', 'mcp__second-draft',
        '--no-session-persistence', '--output-format', 'stream-json', '--verbose', ...(opt.model ? ['--model', opt.model] : []), ...(opt.effort ? ['--effort', opt.effort] : [])];
    } else {
      fs.symlinkSync(path.join(HOME, '.codex/auth.json'), path.join(home, 'auth.json'));
      const off = ['shell_tool', 'unified_exec', 'apps', 'plugins', 'hooks', 'browser_use', 'browser_use_external', 'in_app_browser', 'computer_use', 'memories'];
      fs.writeFileSync(path.join(home, 'config.toml'), [
        ...(opt.model ? [`model = ${JSON.stringify(opt.model)}`] : []), ...(opt.effort ? [`model_reasoning_effort = ${JSON.stringify(opt.effort)}`] : []),
        'approval_policy = "never"', 'sandbox_mode = "read-only"', '', '[features]', ...off.map(k => `${k} = false`), '',
        '[mcp_servers.second-draft]', `command = ${JSON.stringify(server.command)}`, `args = [${server.args.map(a => JSON.stringify(a)).join(', ')}]`,
        'default_tools_approval_mode = "approve"', ''].join('\n'));
      cmd = codexBinary(); env = {CODEX_HOME: home}; parse = parseCodex; cli = await version(cmd, ['--version']);
      args = ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '-C', work, `${system}\n\n${spec.request}`];
    }
    const res = await run(cmd, args, {cwd: work, env, timeoutMs: opt.timeoutMin * 60000});
    fs.writeFileSync(path.join(outDir, 'trace.jsonl'), scrub(res.stdout));
    if (res.stderr.trim()) fs.writeFileSync(path.join(outDir, 'stderr.txt'), scrub(res.stderr));
    const parsed = parse(res.stdout);
    infra = new Client(prepared.app, 'infra', run_id, state, 'second-draft-agent-trials', {registry: prepared.registry});
    await infra.initialize();
    const snapshot = (await infra.call('env.snapshot')).snapshot;
    await infra.close();
    fs.writeFileSync(path.join(outDir, 'snapshot.json'), JSON.stringify(snapshot, null, 2) + '\n');
    const graded = grade(snapshot, spec, opt.variant);
    const offeredOther = (parsed.offered || []).filter(t => !t.startsWith('mcp__second-draft__'));
    const summary = {agent: label, cli, model: opt.model || 'default', effort: opt.effort || 'default', scenario: spec.id, variant: opt.variant, run: n, request: spec.request,
      valid: parsed.other.length === 0 && parsed.blocked.length === 0 && offeredOther.length === 0 && !res.timedOut && res.code === 0,
      pass: graded.pass, failed_checks: graded.checks.filter(c => !c.pass).map(c => c.name), exit_code: res.code, timed_out: res.timedOut,
      seconds: Math.round((Date.now() - started) / 1000), tool_calls: parsed.calls.length,
      by_tool: parsed.calls.reduce((m, c) => ({...m, [c.tool]: (m[c.tool] || 0) + 1}), {}),
      by_status: parsed.calls.reduce((m, c) => ({...m, [c.status || 'unknown']: (m[c.status || 'unknown'] || 0) + 1}), {}),
      other_tool_use: parsed.other, blocked_by_cli: parsed.blocked, other_tools_offered: offeredOther, usage: parsed.usage, final_message: parsed.final, checks: graded.checks};
    fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(summary, null, 2) + '\n');
    return summary;
  } finally {
    fs.rmSync(home, {recursive: true, force: true});
    fs.rmSync(work, {recursive: true, force: true});
    prepared.cleanup();
  }
}

async function main() {
  if (!['claude', 'codex'].includes(opt.agent) || !opt.scenario) { console.error('usage: agent-cli.cjs --agent claude|codex --scenario ID [--runs N]'); process.exit(2); }
  const spec = JSON.parse(fs.readFileSync(path.join(APP, 'examples/scenarios', opt.scenario, 'scenario.json'), 'utf8'));
  for (let n = opt.first; n < opt.first + opt.runs; n++) {
    const s = await trial(spec, n);
    console.log(`${s.agent} ${s.model} ${s.scenario}/${s.variant} run ${n}: ${s.valid ? '' : 'INVALID '}${s.pass ? 'PASS' : 'FAIL'} ${s.failed_checks.join(',')} calls=${s.tool_calls} other=${s.other_tool_use.length} ${s.seconds}s`);
  }
}
if (require.main === module) main().catch(e => { console.error(e.stack || e.message); process.exit(1); });
