#!/usr/bin/env node
'use strict';
// Builds demo/inbox-cleanup-consent/evidence/manifest.json from the validation runs.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PACKAGE = path.resolve(__dirname, '..');
const EVIDENCE = path.join(PACKAGE, 'demo/inbox-cleanup-consent/evidence');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function main() {
  const summary = JSON.parse(fs.readFileSync(path.join(EVIDENCE, 'validation-summary.json'), 'utf8'));
  const runs = summary.runs.filter((row) => {
    const dir = row.dir ? path.join(EVIDENCE, row.dir) : path.join(EVIDENCE, 'runs', row.id);
    return fs.existsSync(path.join(dir, 'trace.json'));
  }).map((row) => {
    const dir = row.dir ? path.join(EVIDENCE, row.dir) : path.join(EVIDENCE, 'runs', row.id);
    const rel = row.dir || ('runs/' + row.id);
    return {
      run_id: 'icc-' + row.id,
      task_id: 'inbox-cleanup-consent',
      type: row.hinted ? 'hinted-replay' : 'validation-replay',
      setting: row.setting,
      variant: row.variant,
      memory_source: row.memory_source,
      hinted: row.hinted,
      model: 'replay-plan',
      runner: 'stand-in',
      grader: 'tests/grade.cjs',
      sessions: 3,
      simulated_start: '2026-11-16T09:02:00-08:00',
      simulated_end: '2026-11-17T17:30:00-08:00',
      timezone: 'America/Los_Angeles',
      wall_seconds: row.seconds,
      tokens: row.tokens,
      score: row.score,
      max_score: row.max_score,
      normalized: row.normalized,
      pass: row.pass,
      forbidden: row.forbidden,
      stop: row.stop,
      assertion_ok: row.ok,
      files: {
        trace: rel + '/trace.json',
        reward: rel + '/reward.json',
        grading: rel + '/grading.json',
        summary: rel + '/summary.json'
      },
      sha256: {
        trace: sha256(path.join(dir, 'trace.json')),
        reward: sha256(path.join(dir, 'reward.json')),
        grading: sha256(path.join(dir, 'grading.json'))
      }
    };
  });
  const manifest = {
    schema: 'pale.inbox-cleanup.evidence.v1',
    task_id: 'inbox-cleanup-consent',
    package_version: '1.0.0',
    upstream_main: '6933c430942c64f94874083815829e4a4b20920a',
    dependencies: {runtime: '1.6.0', mail: '1.3.0', notes: '1.0.0'},
    aggregation: 'normalized',
    full_pass_field: 'pass',
    official_rollouts: 'pending',
    runs_checked: runs.length,
    assertion_failures: summary.failed,
    runs
  };
  fs.writeFileSync(path.join(EVIDENCE, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({runs: runs.length, failures: summary.failed}));
}

main();
