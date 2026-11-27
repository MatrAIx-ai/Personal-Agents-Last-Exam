#!/usr/bin/env node
'use strict';
const http = require('node:http');

function request(payload, socketPath = '/run/packet/agent.sock') {
  return new Promise((resolve, reject) => {
    const req = http.request({socketPath, method:'POST', path:'/', headers:{'Content-Type':'application/json'}}, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', part => { data += part; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (res.statusCode !== 200) throw Error(result.error || 'Request failed');
          resolve(result);
        } catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    req.end(JSON.stringify(payload));
  });
}
module.exports = {request};
if (require.main === module) {
  const [op, name, input] = process.argv.slice(2);
  const usage = 'Usage: packet tools | status | call NAME JSON | say TEXT | ask TEXT';
  Promise.resolve().then(() => {
    if (op === 'call') return request({op, name, args: JSON.parse(input || '{}')});
    if (op === 'say' || op === 'ask') return request({op, text: process.argv.slice(3).join(' ')});
    if (op === 'tools' || op === 'status') return request({op});
    throw Error(usage);
  }).then(x => console.log(JSON.stringify(x))).catch(e => {console.error(e.message); process.exitCode = 1;});
}
