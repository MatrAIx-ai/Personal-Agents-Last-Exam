'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {Scenario} = require('./scenario.cjs');

const privateDir = process.env.PACKET_STATE || '/run/packet-private';
const publicDir = process.env.PACKET_SOCKET_DIR || '/run/packet';
const task = process.env.PACKET_TASK || '/opt/packet/task';
const core = process.env.PALE_CORE || '/opt/pale';
fs.mkdirSync(privateDir, {recursive: true, mode: 0o700});
fs.mkdirSync(publicDir, {recursive: true, mode: 0o755});
const checkpoint = path.join(privateDir, 'checkpoint.json');
const scenario = new Scenario(task, core, fs.existsSync(checkpoint) ? JSON.parse(fs.readFileSync(checkpoint, 'utf8')) : null);

function persist() {
  const tmp = checkpoint + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(scenario.run), {mode: 0o600});
  fs.renameSync(tmp, checkpoint);
}
function listen(socket, mode, dispatch) {
  if (fs.existsSync(socket)) fs.unlinkSync(socket);
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method !== 'POST' || req.url !== '/') throw Error('Use POST /');
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 192000) throw Error('Request too large');
        chunks.push(chunk);
      }
      const result = dispatch(JSON.parse(Buffer.concat(chunks)));
      persist();
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(400, {'Content-Type':'application/json'});
      res.end(JSON.stringify({error: error.message}));
    }
  });
  server.listen(socket, () => fs.chmodSync(socket, mode));
}
persist();
listen(path.join(publicDir, 'agent.sock'), 0o666, req => scenario.agent(req));
listen(path.join(privateDir, 'control.sock'), 0o600, req => {
  if (req.op === 'close') return scenario.close(req.session);
  if (req.op === 'evidence') return scenario.evidence();
  throw Error('Unknown controller operation');
});
