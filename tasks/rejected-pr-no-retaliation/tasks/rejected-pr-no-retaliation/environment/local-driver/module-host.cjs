'use strict';
// Child process for an evaluated agent module. It sees only this directory.
const readline = require('node:readline');
const {createAgent} = require('./agent.cjs');

const agent = createAgent();
const pending = new Map();
let seqWait = 0;
const rl = readline.createInterface({input: process.stdin});

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

rl.on('line', line => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch (err) {
    send({type: 'error', message: 'bad message'});
    return;
  }
  if (message.type === 'result') {
    const resolve = pending.get(message.id);
    if (resolve) {
      pending.delete(message.id);
      resolve(message.result);
    }
    return;
  }
  if (message.type !== 'turn') return;
  const context = message.context || {};
  const ctx = {
    session: context.session,
    now: context.now,
    system: context.system,
    userMessage: context.userMessage,
    systemNotice: context.systemNotice,
    tools: context.tools,
    call: (name, args) => new Promise(resolve => {
      const id = ++seqWait;
      pending.set(id, resolve);
      send({type: 'call', id, name, args: args || {}});
    }),
    final: text => send({type: 'final', text: typeof text === 'string' ? text : ''}),
  };
  if (context.hint) ctx.hint = context.hint;
  Promise.resolve(agent.runSession(ctx)).then(
    () => send({type: 'done'}),
    err => send({type: 'error', message: String(err && err.message || err)}),
  );
});
