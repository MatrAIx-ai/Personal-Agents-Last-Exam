'use strict';
const fs = require('node:fs');
const {Run, APPS} = require('./driver.cjs');

function summary(shot, web) {
  return {
    mail: shot.mail.snapshot.data.messages.length,
    notes: shot.notes.snapshot.data.notes.length,
    pulls: shot.forkyard.snapshot.data.pulls.map(pull => pull.number).sort((a, b) => a - b).length,
    now: shot.forkyard.snapshot.virtual_now,
    web: web.snapshot.data.pages.length,
  };
}

async function fresh() {
  const run = new Run({
    agent: {plan: {name: 'reset', setting: 'A', variant: 'main'}, describe() { return {name: 'reset'}; }, async runSession() {}},
    runId: 'rpr-reset-' + Math.random().toString(36).slice(2, 8),
  });
  await run.setup();
  return run;
}

function release(run) {
  return Promise.allSettled(run.clients.map(client => client.close())).then(() => {
    if (run.registryOwned && run.registryFile && fs.existsSync(run.registryFile)) fs.rmSync(run.registryFile, {force: true});
  });
}

async function main() {
  let first;
  let second;
  try {
  first = await fresh();
  const baseline = {};
  for (const app of APPS) baseline[app] = await first.snap(app);
  const before = summary(baseline, baseline.web);
  const mailShot = baseline.mail;
  const moved = await first.infra.mail.call('env.advance_time', {
    request_id: 'reset-probe-clock',
    expected_version: mailShot.version,
    virtual_now: '2026-02-10T08:30:00-08:00',
  });
  if (moved.status !== 'committed') throw new Error('clock move failed');
  const dirty = await first.snap('mail');
  const drafted = await first.agentConn.mail.call('mail.draft.create', {
    request_id: 'reset-probe-draft',
    expected_version: dirty.version,
    to: ['dana.whitfield@northwind-pay.example'],
    subject: 'Packet line',
    body: 'A draft created so reset can restore the mailbox.',
  });
  if (drafted.status !== 'committed') throw new Error('draft failed ' + JSON.stringify(drafted).slice(0, 300));
  const withDraft = await first.snap('mail');
  if (withDraft.snapshot.data.messages.length !== before.mail + 1) throw new Error('draft was not stored');
  const restored = await first.infra.mail.call('env.reset', {expected_version: withDraft.version});
  if (restored.status !== 'ready') throw new Error('reset failed ' + JSON.stringify(restored).slice(0, 300));
  const afterMail = await first.snap('mail');
  const afterFork = await first.snap('forkyard');
  await release(first);
  first = null;
  second = await fresh();
  const again = {};
  for (const app of APPS) again[app] = await second.snap(app);
  const after = summary(again, again.web);
  await release(second);
  second = null;
  const resourceBack = JSON.stringify(afterMail.snapshot.resources || {}) === JSON.stringify(baseline.mail.snapshot.resources || {});
  const mailBack = afterMail.snapshot.data.messages.length === before.mail && afterMail.snapshot.virtual_now === before.now && resourceBack;
  const pullsBack = afterFork.snapshot.data.pulls.length === before.pulls;
  if (!mailBack || !pullsBack || JSON.stringify(before) !== JSON.stringify(after)) {
    console.error(JSON.stringify({reset: 'fail', before, after, mailBack, pullsBack}));
    process.exit(1);
  }
  if (before.mail !== 18 || before.notes !== 4 || before.web !== 40 || before.now !== '2026-02-09T20:40:00-08:00') {
    console.error(JSON.stringify({reset: 'unexpected', before}));
    process.exit(1);
  }
  console.log(JSON.stringify({reset: 'pass', mail: before.mail, notes: before.notes, web: before.web, pulls: before.pulls, virtual_now: before.now, mutated_then_restored: true}));
  } finally {
    if (first) await release(first);
    if (second) await release(second);
  }
}

main().catch(async err => {
  console.error(err.stack || err);
  process.exit(1);
});
