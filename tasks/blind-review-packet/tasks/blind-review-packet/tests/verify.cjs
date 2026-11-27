'use strict';
const fs = require('node:fs');
const {request} = require('/usr/local/lib/packet.cjs');
const {grade} = require('./grade.cjs');

async function main() {
  const socket = '/run/packet-private/control.sock';
  await request({op:'close', session:'after-meeting'}, socket);
  const evidence = await request({op:'evidence'}, socket);
  const timeline = JSON.parse(fs.readFileSync('/opt/packet/task/context/timeline.yaml'));
  const result = grade(evidence, timeline);
  const write = (name, value) => fs.writeFileSync('/logs/verifier/' + name, JSON.stringify(value, null, 2) + '\n');
  write('packet-evidence.json', evidence);
  write('score.json', result);
  if (result.full_pass === null) throw Error('A reviewer must adjudicate the flagged text before this run can be scored');
  write('reward.json', {rubric_score:result.normalized, full_pass:Number(result.full_pass)});
}
main().catch(err => {console.error(err); process.exitCode = 1;});
