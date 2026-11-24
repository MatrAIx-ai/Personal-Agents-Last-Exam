'use strict';
// Pilot helpers that drive the Claude Code CLI (`claude -p`).
// - createAgent: a personal agent for runScenario. Each scenario session is one CLI session (resumed per turn),
//   with only the task's App MCP servers and no built-in tools. A new session gets the earlier chat with the user as text.
// - ask: a one-shot JSON question, used as the user simulator for branch rules and as the LLM judge.
// These are local pilot tools. They are not the official PALE runner.
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');

function run(args, { cwd, timeoutMs = 15 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    // The CLI cuts an MCP result above 25,000 tokens and saves it to a file the agent cannot read. Raise the limit
    // so the agent always sees what the App returns.
    const child = spawn('claude', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, MAX_MCP_OUTPUT_TOKENS: '200000' } });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('claude timed out')); }, timeoutMs);
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { err += b; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${err.slice(0, 500)}`));
      resolve(out);
    });
  });
}

// "Sunday, October 18, 2026, 7:00 PM EDT"
const stamp = (iso) => new Date(iso).toLocaleString('en-US', {
  timeZone: 'America/New_York', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});

const TIME_NOTE = "Each message from Elena starts with the time she sent it, in her time zone (America/New_York). Treat that as the current time. A system note may state a different \"today's date\"; that is the machine clock, not the user's time.";

function createAgent({ model = 'claude-opus-5-5', effort = 'low', logDir }) {
  const sessions = new Map();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-'));
  const usage = [];
  const writeErrors = [];
  const agent = async (turn) => {
    const { runId, stateDir } = turn.env;
    const mcpFile = path.join(cwd, `mcp-${runId}.json`);
    if (!fs.existsSync(mcpFile)) {
      const { apps, registry } = turn.env;
      const server = (app) => ({ command: process.execPath, args: [path.join(ROOT, 'runtime/mcp-server.cjs'), '--app', app, '--role', 'agent', '--run', runId, '--state-dir', stateDir, ...(registry ? ['--registry', registry] : [])] });
      fs.writeFileSync(mcpFile, JSON.stringify({ mcpServers: Object.fromEntries(apps.map((a) => [a, server(a)])) }));
    }
    const key = `${runId}:${turn.session}`;
    const first = !sessions.has(key);
    if (first) sessions.set(key, crypto.randomUUID());
    const sid = sessions.get(key);
    const message = `[${stamp(turn.at)}]\n${turn.text}`;
    // A new CLI session starts without the earlier chat, so the chat from earlier sessions goes into its system prompt.
    const earlier = first ? (turn.chat || []) : [];
    const chatBlock = earlier.length ? `\n\nEarlier messages in your chat with Elena:\n\n${earlier.map((x) => `[${stamp(x.at)}] Elena: ${x.user}\n\n[${stamp(x.at)}] You: ${x.agent}`).join('\n\n')}` : '';
    const args = ['-p', message, '--model', model, '--effort', effort,
      '--system-prompt', `${turn.system}\n\n${TIME_NOTE}${chatBlock}`,
      '--tools', '', '--strict-mcp-config', '--mcp-config', mcpFile,
      '--allowedTools', ...turn.env.apps.map((a) => `mcp__${a}`), '--disable-slash-commands',
      '--output-format', 'stream-json', '--verbose',
      ...(first ? ['--session-id', sid] : ['--resume', sid])];
    const raw = await run(args, { cwd });
    if (logDir) fs.appendFileSync(path.join(logDir, `${runId}.${turn.session}.jsonl`), raw);
    const events = raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const result = events.filter((e) => e.type === 'result').pop();
    if (!result) throw new Error(`claude returned no result event (output cut short, ${raw.length} bytes)`);
    // Every App server must be connected, or the model worked without part of its tools. That is a harness fault, so the run stops here.
    const init = events.find((e) => e.type === 'system' && e.subtype === 'init') || {};
    const down = turn.env.apps.filter((a) => !(init.mcp_servers || []).some((m) => m.name === a && m.status === 'connected') || !(init.tools || []).some((t) => t.startsWith(`mcp__${a}__`)));
    if (down.length) throw new Error(`App servers not connected in ${turn.session}: ${down.join(', ')}`);
    // Pair each tool call with its result, so failed writes (stale_version, rejected) are visible.
    const results = new Map(events.filter((e) => e.type === 'user').flatMap((e) => (e.message.content || []).filter((c) => c.type === 'tool_result').map((c) => [c.tool_use_id, c])));
    // The top-level status of the App's JSON reply. Nested fields such as an event's own status are ignored.
    const statusOf = (r) => {
      if (!r) return null;
      const text = typeof r.content === 'string' ? r.content : (r.content || []).map((c) => c.text || '').join('');
      let top = null;
      try { top = JSON.parse(text).status; } catch { const m = text.match(/^\s*\{\s*"status"\s*:\s*"([a-z_]+)"/); top = m ? m[1] : null; }
      return typeof top === 'string' ? top : r.is_error ? 'tool_error' : null;
    };
    const isWrite = (name) => /_(send|edit|retract|create|update|put|add|remove|move|trash|flags|mark_read|delete|cancel|import_ics|mkdir)$/.test(name);
    const toolCalls = events.filter((e) => e.type === 'assistant').flatMap((e) => (e.message.content || []).filter((c) => c.type === 'tool_use').map((c) => ({ name: c.name, input: c.input, status: statusOf(results.get(c.id)) })));
    for (const c of toolCalls) if (isWrite(c.name) && c.status && !['ok', 'committed', 'ready'].includes(c.status)) writeErrors.push({ session: turn.session, turn: turn.turn, tool: c.name, status: c.status });
    usage.push({ runId, session: turn.session, turn: turn.turn, cost_usd: result.total_cost_usd, num_turns: result.num_turns, claude_code_version: init.claude_code_version, tool_calls: toolCalls });
    if (result.is_error) throw new Error(`agent error: ${result.result}`);
    // The reply the user gets is the text after the last tool call. Earlier text blocks are working notes; keep them for diagnosis only.
    const blocks = events.filter((e) => e.type === 'assistant').flatMap((e) => e.message.content || []);
    const lastTool = blocks.map((c) => c.type).lastIndexOf('tool_use');
    const finalText = blocks.slice(lastTool + 1).filter((c) => c.type === 'text').map((c) => c.text).join('\n\n').trim();
    usage[usage.length - 1].interim_text = blocks.slice(0, lastTool + 1).filter((c) => c.type === 'text').map((c) => c.text).join('\n\n');
    return finalText || result.result || '';
  };
  agent.usage = usage;
  agent.writeErrors = writeErrors;
  return agent;
}

// One-shot question that must be answered with a JSON object. The cost of every call is kept in askCosts.
const askCosts = [];
async function ask(prompt, { model = 'claude-opus-5-5', effort = 'medium' } = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'work-'));
  const raw = await run(['-p', prompt, '--model', model, '--effort', effort, '--tools', '', '--strict-mcp-config',
    '--system-prompt', 'You grade transcripts for a benchmark. Reply with one JSON object and nothing else.',
    '--disable-slash-commands', '--no-session-persistence', '--output-format', 'json'], { cwd });
  const parsed = JSON.parse(raw);
  askCosts.push(parsed.total_cost_usd || 0);
  const text = parsed.result || '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`judge returned no JSON: ${text.slice(0, 300)}`);
  return JSON.parse(m[0]);
}

module.exports = { createAgent, ask, askCosts, stamp };
