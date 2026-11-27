#!/usr/bin/env node
'use strict';
// Runs one evaluated adapter. The parent sends one JSON object per line and reads one JSON object back.
const fs = require('node:fs');
const readline = require('node:readline');

const file = process.env.PALE_AGENT_FILE;
if (!file || !fs.existsSync(file)) {
  process.stderr.write('missing agent file\n');
  process.exit(2);
}

const agent = require(file).createAgent();
process.stdout.write(JSON.stringify({ready: true, pid: process.pid}) + '\n');

const input = readline.createInterface({input: process.stdin, crlfDelay: Infinity});
input.on('line', (line) => {
  if (!line) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch (err) {
    process.stdout.write(JSON.stringify({error: 'bad request'}) + '\n');
    return;
  }
  if (message && message.bye) {
    process.exit(0);
  }
  Promise.resolve(agent.next(message)).then((step) => {
    process.stdout.write(JSON.stringify({step: step || null}) + '\n');
  }).catch((err) => {
    process.stdout.write(JSON.stringify({error: String(err && err.message || err)}) + '\n');
  });
});
