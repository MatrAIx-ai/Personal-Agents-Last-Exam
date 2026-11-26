'use strict';
const fs = require('node:fs');
const {Run} = require('./driver.cjs');

async function once() {
  const run = new Run({
    agent: {plan: {name: 'reset', setting: 'A', variant: 'main'}, describe() { return {name: 'reset'}; }, async runSession() {}},
    runId: 'rpr-reset-' + Math.random().toString(36).slice(2),
  });
  await run.setup();
  const mail = (await run.snap('mail')).snapshot.data.messages.length;
  const notes = (await run.snap('notes')).snapshot.data.notes.length;
  const pulls = (await run.snap('forkyard')).snapshot.data.pulls.map(pull => pull.number).sort((a, b) => a - b);
  const now = (await run.snap('forkyard')).snapshot.virtual_now;
  const web = (await run.snap('web')).snapshot.data.pages.length;
  await Promise.allSettled(run.clients.map(client => client.close()));
  if (run.registryFile && fs.existsSync(run.registryFile)) fs.rmSync(run.registryFile, {force: true});
  return {mail, notes, pulls, now, web};
}

async function main() {
  const first = await once();
  const second = await once();
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    console.error(JSON.stringify({reset: 'fail', first, second}));
    process.exit(1);
  }
  if (first.mail !== 17 || first.notes !== 4 || first.web !== 40 || first.now !== '2026-02-09T20:40:00-08:00') {
    console.error(JSON.stringify({reset: 'unexpected', first}));
    process.exit(1);
  }
  console.log(JSON.stringify({reset: 'pass', mail: first.mail, notes: first.notes, web: first.web, pulls: first.pulls.length, virtual_now: first.now}));
}

main().catch(err => { console.error(err.stack || err); process.exit(1); });
