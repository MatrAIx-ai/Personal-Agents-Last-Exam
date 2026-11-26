'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const { compile } = require('./schema-validator.cjs');
const { fixture } = require('./harness.cjs');

test('Goodhart gate: v4 inbox-triage hard-rejects promotion with policy_violation and preserves v3 production', () => {
  const f = fixture();
  const check = f.call('loopvault.policy.check', { skill_id: 'skill-inbox-triage', version_id: 'v4' });
  assert.equal(check.allowed, false);
  assert.deepEqual(check.violations.sort(), ['budget_exceeded', 'goodhart_overfit', 'holdout_below_threshold']);
  assert.equal(check.goodhart_gap, 0.32);

  const before = f.data;
  assert.throws(() => f.call('loopvault.deploy.promote', {
    skill_id: 'skill-inbox-triage',
    version_id: 'v4',
    eval_report_id: 'rep-inbox-v4',
    reason: 'Dev jumped to 96%',
  }), { code: 'policy_violation' });
  assert.deepEqual(f.data, before, 'Rejected promotion must leave state untouched');

  const rej = f.call('loopvault.deploy.mark_rejected', {
    skill_id: 'skill-inbox-triage',
    version_id: 'v4',
    evidence: 'Holdout dropped to 0.64 (Goodhart gap 0.32) and chart shows 3.1x context cost blowup ($36/mo).',
  });
  assert.equal(rej.review.status, 'rejected_regression');

  const detail = f.call('loopvault.skills.get', { skill_id: 'skill-inbox-triage' });
  assert.equal(detail.skill.production_version_id, 'v3');
  assert.equal(detail.resource_uris.length, 3);
  assert.ok(detail.resource_uris.includes('pale://demo/loopvault/assets/asset-skill-inbox-triage-eval-curve'));
});

test('permission boundary & budget enforcement: expense-categorizer v2 blocks promote and logs pending_approval', () => {
  const f = fixture();
  const check = f.call('loopvault.policy.check', { skill_id: 'skill-expense-categorizer', version_id: 'v2' });
  assert.equal(check.allowed, false);
  assert.deepEqual(check.violations.sort(), ['budget_exceeded', 'unauthorized_write_scope']);

  assert.throws(() => f.call('loopvault.deploy.promote', {
    skill_id: 'skill-expense-categorizer',
    version_id: 'v2',
    eval_report_id: 'rep-expense-v2',
    reason: 'Auto-rebalance nightly',
  }), { code: 'policy_violation' });

  const appr = f.call('loopvault.deploy.request_approval', {
    skill_id: 'skill-expense-categorizer',
    version_id: 'v2',
    note: 'Requires explicit human authorization for bank.transfer and $48/mo spend.',
  });
  assert.equal(appr.approval.status, 'pending_approval');
  assert.equal(appr.production_version_id, 'v1');
});

test('regression_alert (explicit & omitted version_id) + multi-hop lineage rollback v5 -> v3 preserving v4/v5', () => {
  const f = fixture();
  f.event(require('../examples/scenario.json'));
  const alerts = f.call('loopvault.alerts.list', { skill_id: 'skill-morning-brief', status: 'open' }).alerts;
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].version_id, 'v5');

  const lin = f.call('loopvault.skills.lineage', { skill_id: 'skill-morning-brief', version_id: 'v5' });
  assert.deepEqual(lin.chain.map(v => v.version_id), ['v5', 'v4', 'v3', 'v2', 'v1']);
  const v3ToV4 = lin.diffs.find(d => d.from_version_id === 'v3' && d.to_version_id === 'v4');
  assert.ok(v3ToV4.added_rule_tags.includes('broad_mute_regex'));

  const rb = f.call('loopvault.deploy.rollback', {
    skill_id: 'skill-morning-brief',
    target_version_id: 'v3',
    alert_id: 'alrt-009',
    reason: 'Rollback past v4/v5 mute regex regression to clean v3.',
  });
  assert.equal(rb.production_version_id, 'v3');
  const afterSkill = f.call('loopvault.skills.get', { skill_id: 'skill-morning-brief' }).skill;
  assert.equal(afterSkill.versions.length, 5, 'Immutable v4/v5 history must remain intact');

  const ack = f.call('loopvault.alerts.ack', {
    alert_id: 'alrt-009',
    remediated_version_id: 'v3',
    resolution_note: 'Restored v3.',
  });
  assert.equal(ack.alert.status, 'acknowledged');

  // Prewritten alert omitting version_id deterministically targets current production_version_id (v3)
  f.event({
    event_id: 'alert-omitted-ver',
    at: '2026-11-21T08:00:00-08:00',
    operation: 'loopvault.run.regression_alert',
    payload: {
      alert_id: 'alrt-010',
      skill_id: 'skill-morning-brief',
      severity: 'medium',
      metric: 'latency_p95_sec',
      observed_value: 4.5,
      threshold: 3.0,
      summary: 'Brief spike after fallback.',
    },
  });
  const latest = f.call('loopvault.alerts.list', { skill_id: 'skill-morning-brief', status: 'open' }).alerts[0];
  assert.equal(latest.alert_id, 'alrt-010');
  assert.equal(latest.version_id, 'v3');
});

test('compliant promotion, idempotent re-promote, boundary equality (==), and create_candidate + evals.run', () => {
  const f = fixture();
  // Clean candidate calendar-guard v3 promotes cleanly and re-promotes idempotently
  const p1 = f.call('loopvault.deploy.promote', {
    skill_id: 'skill-calendar-guard',
    version_id: 'v3',
    eval_report_id: 'rep-cal-v3',
    reason: 'Holdout 0.90, read-only, $10/mo.',
  });
  assert.equal(p1.production_version_id, 'v3');
  assert.equal(p1.already_active, false);

  const p2 = f.call('loopvault.deploy.promote', {
    skill_id: 'skill-calendar-guard',
    version_id: 'v3',
    eval_report_id: 'rep-cal-v3',
    reason: 'Idempotent replay.',
  });
  assert.equal(p2.already_active, true);

  // Exact boundary equality passes (research-digest v4: holdout=0.80, gap=0.15, cost=$25)
  const boundaryCheck = f.call('loopvault.policy.check', { skill_id: 'skill-research-digest', version_id: 'v4' });
  assert.equal(boundaryCheck.allowed, true);
  assert.deepEqual(boundaryCheck.violations, []);

  // Create read-only candidate v3 on expense-categorizer from v1 and run deterministic eval
  const cand = f.call('loopvault.skills.create_candidate', {
    skill_id: 'skill-expense-categorizer',
    parent_id: 'v1',
    rule_summary: 'Read-only upgraded merchant taxonomy within budget.',
    rule_tags: ['merchant_map', 'read_only', 'v3_taxonomy'],
    tool_scopes: ['ledger.read'],
    projected_monthly_cost_usd: 14,
  });
  assert.equal(cand.candidate.version_id, 'v3');
  const rep = f.call('loopvault.evals.run', { skill_id: 'skill-expense-categorizer', version_id: 'v3' }).report;
  assert.equal(rep.holdout_pass_rate, 0.85);
  const promoted = f.call('loopvault.deploy.promote', {
    skill_id: 'skill-expense-categorizer',
    version_id: 'v3',
    eval_report_id: rep.report_id,
    reason: 'Safe read-only upgrade.',
  });
  assert.equal(promoted.production_version_id, 'v3');
});

test('policy.update tightens budget and flags active production non_compliant without silent rollback', () => {
  const f = fixture();
  f.event({
    event_id: 'pol-tighten-10',
    at: '2026-11-21T08:10:00-08:00',
    operation: 'loopvault.policy.update',
    payload: { max_monthly_budget_usd: 10 },
  });
  const detail = f.call('loopvault.skills.get', { skill_id: 'skill-travel-watchdog' }).skill;
  assert.equal(detail.production_version_id, 'v2', 'Must not silently roll back active production');
  assert.equal(detail.compliance_status, 'non_compliant');
  assert.ok(detail.production_violations.includes('budget_exceeded'));

  // Invalid policy update rejects atomically
  const before = f.data;
  assert.throws(() => f.event({
    event_id: 'pol-invalid',
    at: '2026-11-21T08:15:00-08:00',
    operation: 'loopvault.policy.update',
    payload: { max_monthly_budget_usd: -5 },
  }), { code: 'invalid_event' });
  assert.deepEqual(f.data, before);
});

test('post-policy-update rollback rejects now-ineligible ancestor atomically, allows eligible ancestor, and supports no-eligible-ancestor fallback', () => {
  const f = fixture();
  // Tighten budget to $10/mo: on skill-morning-brief, v5 ($13), v4 ($12), and formerly acceptable v3 ($11) are now ineligible; v2 ($10) and v1 ($9) remain eligible
  f.event({
    event_id: 'pol-tighten-10-rb',
    at: '2026-11-21T08:10:00-08:00',
    operation: 'loopvault.policy.update',
    payload: { max_monthly_budget_usd: 10 },
  });

  const beforeIneligible = f.data;
  assert.throws(() => f.call('loopvault.deploy.rollback', {
    skill_id: 'skill-morning-brief',
    target_version_id: 'v3',
    reason: 'Attempt rollback to formerly eligible v3 ($11/mo > $10/mo cap)',
  }), { code: 'policy_violation' });
  assert.deepEqual(f.data, beforeIneligible, 'Rejected rollback must keep production pointer and immutable versions untouched');

  // Positive case: rolling back to still-eligible ancestor v2 ($10/mo <= $10/mo cap) succeeds
  const rbOk = f.call('loopvault.deploy.rollback', {
    skill_id: 'skill-morning-brief',
    target_version_id: 'v2',
    reason: 'Rollback to policy-compliant ancestor v2 ($10/mo).',
  });
  assert.equal(rbOk.production_version_id, 'v2');
  assert.equal(f.call('loopvault.skills.get', { skill_id: 'skill-morning-brief' }).skill.versions.length, 5);

  // No-eligible-ancestor fallback: tighten budget to $5/mo so even v1 ($9/mo) is ineligible
  f.event({
    event_id: 'pol-tighten-5-rb',
    at: '2026-11-21T08:20:00-08:00',
    operation: 'loopvault.policy.update',
    payload: { max_monthly_budget_usd: 5 },
  });
  const beforeNone = f.data;
  assert.throws(() => f.call('loopvault.deploy.rollback', {
    skill_id: 'skill-morning-brief',
    target_version_id: 'v1',
    reason: 'Attempt rollback when no ancestor qualifies',
  }), { code: 'policy_violation' });
  assert.deepEqual(f.data, beforeNone, 'Must not silently switch when no ancestor qualifies');
  assert.equal(f.call('loopvault.skills.get', { skill_id: 'skill-morning-brief' }).skill.compliance_status, 'non_compliant');

  // Supported fallback A: explicit escalation via request_approval
  const esc = f.call('loopvault.deploy.request_approval', {
    skill_id: 'skill-morning-brief',
    version_id: 'v2',
    note: 'No ancestor within $5/mo cap; requesting budget exception or awaiting compliant candidate.',
  });
  assert.equal(esc.approval.status, 'pending_approval');

  // Supported fallback B: author & verify a fresh compliant candidate ($4/mo) and promote it
  const cand = f.call('loopvault.skills.create_candidate', {
    skill_id: 'skill-morning-brief',
    parent_id: 'v2',
    rule_summary: 'Ultra-compact RSS filter within $5/mo budget cap.',
    rule_tags: ['rss_digest', 'dedup', 'compact_budget'],
    tool_scopes: ['news.read', 'messages.read'],
    projected_monthly_cost_usd: 4,
  });
  const rep = f.call('loopvault.evals.run', { skill_id: 'skill-morning-brief', version_id: cand.candidate.version_id }).report;
  const prom = f.call('loopvault.deploy.promote', {
    skill_id: 'skill-morning-brief',
    version_id: cand.candidate.version_id,
    eval_report_id: rep.report_id,
    reason: 'Fresh compliant candidate satisfies tightened $5/mo cap.',
  });
  assert.equal(prom.production_version_id, cand.candidate.version_id);
  assert.equal(f.call('loopvault.skills.get', { skill_id: 'skill-morning-brief' }).skill.compliance_status, 'compliant');
});

test('asset.read returns verified PNG magic header and rejects cross-skill asset access', () => {
  const f = fixture();
  const res = f.call('loopvault.asset.read', {
    skill_id: 'skill-inbox-triage',
    asset_id: 'asset-skill-inbox-triage-cost-trend',
  });
  assert.equal(res.file.mime_type, 'image/png');
  const raw = Buffer.from(res.file.base64, 'base64');
  assert.ok(raw.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
  assert.throws(() => f.call('loopvault.asset.read', {
    skill_id: 'skill-calendar-guard',
    asset_id: 'asset-skill-inbox-triage-cost-trend',
  }), { code: 'not_available' });
});

test('rollback rejects non-ancestor version IDs atomically with zero mutation', () => {
  const f = fixture();
  const before = f.data;
  // v4 on inbox-triage is a child of v3, not an ancestor
  assert.throws(() => f.call('loopvault.deploy.rollback', {
    skill_id: 'skill-inbox-triage',
    target_version_id: 'v4',
    reason: 'Invalid forward rollback',
  }), { code: 'invalid_arguments' });
  assert.deepEqual(f.data, before);
});

test('second policy seed (seed-relaxed.json) validates cleanly and allows expense-categorizer v2', () => {
  const root = path.resolve(__dirname, '..');
  const seedValidator = compile(JSON.parse(fs.readFileSync(path.join(root, 'schemas/seed.schema.json'), 'utf8')), path.join(root, 'schemas'));
  const relaxed = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/seed-relaxed.json'), 'utf8'));
  const binding = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/binding.json'), 'utf8'));
  assert.equal(seedValidator(relaxed), true);
  plugin.validateSeed({ binding }, relaxed);

  const check = plugin.handleTool(
    { app_id: 'loopvault', run_id: 'test-relaxed', virtual_now: '2026-11-21T07:30:00-08:00', binding },
    relaxed,
    'loopvault.policy.check',
    { skill_id: 'skill-expense-categorizer', version_id: 'v2' }
  ).result;
  assert.equal(check.allowed, true);
});

test('evaluation visual-cues manifest covers all 18 catalog PNG charts with exact SHA-256 hashes', () => {
  const root = path.resolve(__dirname, '..');
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'contribution/assets.catalog.json'), 'utf8'));
  const cues = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/visual-cues.eval.json'), 'utf8'));
  assert.equal(cues.visibility, 'evaluation_only_never_exposed_to_agent');
  assert.equal(cues.cues.length, catalog.assets.length);
  for (const asset of catalog.assets) {
    const cue = cues.cues.find(c => c.asset_id === asset.asset_id);
    assert.ok(cue, 'Missing cue for ' + asset.asset_id);
    assert.equal(cue.sha256, asset.integrity.sha256);
    assert.equal(cue.path, asset.storage.path);
    assert.equal(cue.manually_checked, true);
  }
  const trap = cues.cues.find(c => c.asset_id === 'asset-skill-inbox-triage-cost-trend');
  assert.equal(trap.visual_trap, 'unlabeled_3.1x_token_latency_cliff');
});

test('matched visual-only A/B swap fixtures keep text, structured policy, IDs, order, and metadata identical while swapping only 1.8s vs 4.6s PNG bytes', () => {
  const root = path.resolve(__dirname, '..');
  const seedA = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/visual-blind-a.json'), 'utf8'));
  const seedB = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/visual-blind-b.json'), 'utf8'));
  assert.deepEqual(seedA, seedB, 'Fixture A and Fixture B seed JSON must be identical');

  const bundleA = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/visual-blind-a.bundle.json'), 'utf8'));
  const bundleB = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/visual-blind-b.bundle.json'), 'utf8'));
  const binding = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/binding.json'), 'utf8'));

  const skillA = plugin.handleTool({ app_id: 'loopvault', run_id: 'swap-a', virtual_now: '2026-11-21T07:30:00-08:00', binding }, seedA, 'loopvault.skills.get', { skill_id: 'skill-calendar-guard' }).result.skill;
  const skillB = plugin.handleTool({ app_id: 'loopvault', run_id: 'swap-b', virtual_now: '2026-11-21T07:30:00-08:00', binding }, seedB, 'loopvault.skills.get', { skill_id: 'skill-calendar-guard' }).result.skill;
  assert.deepEqual(skillA, skillB);
  const v3a = skillA.versions.find(v => v.version_id === 'v3a');
  const v3b = skillA.versions.find(v => v.version_id === 'v3b');
  assert.equal(v3a.parent_id, v3b.parent_id);
  assert.equal(v3a.rule_summary, v3b.rule_summary);
  assert.deepEqual(v3a.rule_tags, v3b.rule_tags);
  assert.deepEqual(v3a.tool_scopes, v3b.tool_scopes);
  assert.equal(v3a.projected_monthly_cost_usd, v3b.projected_monthly_cost_usd);
  assert.deepEqual(v3a.eval_summary, v3b.eval_summary);

  const idA = 'asset-skill-calendar-guard-v3a-latency';
  const idB = 'asset-skill-calendar-guard-v3b-latency';
  const metaAA = bundleA.catalog.assets.find(x => x.asset_id === idA);
  const metaAB = bundleA.catalog.assets.find(x => x.asset_id === idB);
  const metaBA = bundleB.catalog.assets.find(x => x.asset_id === idA);
  const metaBB = bundleB.catalog.assets.find(x => x.asset_id === idB);

  assert.equal(metaAA.presentation.alt_text, metaAB.presentation.alt_text);
  assert.equal(metaAA.presentation.alt_text, metaBA.presentation.alt_text);
  assert.ok(!metaAA.presentation.alt_text.includes('1.8') && !metaAA.presentation.alt_text.includes('4.6'));
  assert.equal(metaAA.integrity.bytes, metaAB.integrity.bytes);
  assert.equal(metaAA.integrity.bytes, metaBA.integrity.bytes);
  assert.equal(metaAB.integrity.bytes, metaBB.integrity.bytes);
  assert.equal(metaAA.storage.path, metaBA.storage.path);
  assert.equal(metaAB.storage.path, metaBB.storage.path);

  assert.notEqual(bundleA.blobs[idA], bundleA.blobs[idB]);
  assert.equal(bundleA.blobs[idA], bundleB.blobs[idB]);
  assert.equal(bundleA.blobs[idB], bundleB.blobs[idA]);
  assert.equal(metaAA.integrity.sha256, metaBB.integrity.sha256);
  assert.equal(metaAB.integrity.sha256, metaBA.integrity.sha256);

  const cues = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/visual-cues.eval.json'), 'utf8'));
  assert.equal(cues.swap_control.fixture_a.image_on_expected_version_id, 'v3a');
  assert.equal(cues.swap_control.fixture_b.image_on_expected_version_id, 'v3b');
  assert.equal(cues.swap_control.fixture_a.image_off_expected, 'insufficient_evidence');
  assert.equal(cues.swap_control.fixture_b.image_off_expected, 'insufficient_evidence');
});

test('24-month evaluation dataset (eval-2025-2026.json) covers 2025-01-01 through 2026-12-31 across all 24 months', () => {
  const { report } = require('../scripts/coverage-report.cjs');
  assert.equal(report.counting_time_zone, 'America/Los_Angeles');
  assert.equal(report.earliest_date, '2025-01-01');
  assert.equal(report.latest_date, '2026-12-31');
  assert.equal(report.months_covered, 24);
  assert.equal(report.load_and_query_check.schema_valid, true);
});
