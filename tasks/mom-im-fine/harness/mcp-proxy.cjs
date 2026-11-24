#!/usr/bin/env node
'use strict';
// Pilot-only stdio proxy in front of runtime/mcp-server.cjs.
// The Claude Code CLI replaces any tool result above 50,000 characters with a short preview and a file path.
// The pilot agent has no file tools, so a full Messages list (about 51 KB here) would be lost to it.
// A server can raise that limit per tool with _meta["anthropic/maxResultSizeChars"] in tools/list.
// This proxy adds that key and passes everything else through unchanged.
//   node mcp-proxy.cjs <path to mcp-server.cjs> [server args ...]
const { spawn } = require('node:child_process');
const LIMIT = 400000;
const child = spawn(process.execPath, process.argv.slice(2), { stdio: ['pipe', 'pipe', 'inherit'] });
process.stdin.pipe(child.stdin);
function forward(line) {
  let out = line;
  try {
    const msg = JSON.parse(line);
    if (msg && msg.result && Array.isArray(msg.result.tools)) {
      for (const tool of msg.result.tools) tool._meta = { ...(tool._meta || {}), 'anthropic/maxResultSizeChars': LIMIT };
      out = JSON.stringify(msg);
    }
  } catch { /* not JSON: pass through */ }
  process.stdout.write(out + '\n');
}
// Lines end at "\n" only, and the proxy stops after the server's last byte is forwarded.
let buffer = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) { forward(buffer.slice(0, i)); buffer = buffer.slice(i + 1); }
});
child.stdout.on('close', () => { if (buffer) forward(buffer); process.stdout.write('', () => process.exit(child.exitCode === null ? 0 : child.exitCode)); });
