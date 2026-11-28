#!/usr/bin/env node
'use strict';
// The assistant's chat with the user, as an MCP server over stdio.
// chat.send records what the assistant tells the user and returns the user's scripted reply, if the script has one.
// The verifier reads the chat log, so scoring does not depend on any one agent harness's own log format.
const fs = require('node:fs');
const readline = require('node:readline');
const { SESSION_FILE, CHAT_FILE, readJson, writeJson } = require('./lib.cjs');

const TOOLS = [
  {
    name: 'chat.send',
    description: 'Send a message to the user in your chat with them. This is the only way the user sees anything from you. Returns the user\'s reply when they answer; reply is null when they do not answer now.',
    inputSchema: { type: 'object', properties: { text: { type: 'string', minLength: 1, maxLength: 8000 } }, required: ['text'], additionalProperties: false },
  },
  {
    name: 'chat.history',
    description: 'Read your chat with the user, oldest first, including earlier sessions.',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
];

// A reply rule matches when every condition it names holds for the assistant's message.
function matches(rule, text) {
  const m = rule.match || {};
  if (m.question && !/\?/.test(text)) return false;
  if (m.pattern && !new RegExp(m.pattern, 'i').test(text)) return false;
  return true;
}

function send({ text }) {
  if (typeof text !== 'string' || !text.trim()) return { status: 'invalid', message: 'text is required' };
  const session = readJson(SESSION_FILE);
  if (!session.id) return { status: 'unavailable', message: 'No session is open.' };
  const chat = readJson(CHAT_FILE);
  const n = chat.messages.filter((x) => x.session === session.id && x.role === 'assistant').length + 1;
  chat.messages.push({ id: `${session.id}-a${n}`, session: session.id, at: session.at, role: 'assistant', text });
  let reply = null;
  const rule = (session.replies || []).find((r) => (session.used[r.id] || 0) < (r.max_uses || 1) && matches(r, text));
  if (rule) {
    session.used[rule.id] = (session.used[rule.id] || 0) + 1;
    reply = { text: rule.text, at: session.at };
    chat.messages.push({ id: `${session.id}-u${n}`, session: session.id, at: session.at, role: 'user', text: rule.text, rule: rule.id });
    writeJson(SESSION_FILE, session);
  }
  writeJson(CHAT_FILE, chat);
  return { status: 'delivered', reply, note: reply ? undefined : 'The user has not replied.' };
}

function history() {
  return { status: 'ok', messages: readJson(CHAT_FILE).messages.map(({ session, at, role, text }) => ({ session, at, role, text })) };
}

const out = (m) => process.stdout.write(JSON.stringify(m) + '\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let m;
  try { m = JSON.parse(line); } catch { out({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
  if (m.id === undefined) return;
  const reply = (result) => out({ jsonrpc: '2.0', id: m.id, result });
  if (m.method === 'initialize') {
    reply({
      protocolVersion: (m.params && m.params.protocolVersion) || '2025-11-25',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'pale-user-chat', version: '0.1.0' },
      instructions: 'Your chat with the user. Use chat.send for anything the user should read.',
    });
  } else if (m.method === 'ping') reply({});
  else if (m.method === 'tools/list') reply({ tools: TOOLS });
  else if (m.method === 'tools/call') {
    const name = m.params && m.params.name;
    let result;
    try {
      if (name === 'chat.send') result = send(m.params.arguments || {});
      else if (name === 'chat.history') result = history();
      else { out({ jsonrpc: '2.0', id: m.id, error: { code: -32602, message: `Unknown tool: ${name}` } }); return; }
    } catch (e) {
      result = { status: 'error', message: e.message };
    }
    reply({ content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: result.status === 'error' || result.status === 'invalid' });
  } else out({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `Unknown method: ${m.method}` } });
});
if (!fs.existsSync(CHAT_FILE)) process.stderr.write('pale-user-chat: no chat log yet; run pale-task.cjs init first.\n');
