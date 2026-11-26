'use strict';
const assert = require('node:assert/strict');
const { fixture } = require('../tests/harness.cjs');

const f = fixture();
f.event(require('./scenario.json'));
const alerts = f.call('loopvault.alerts.list', { skill_id: 'skill-morning-brief', status: 'open' }).alerts;
assert.equal(alerts.length, 1);
assert.equal(alerts[0].alert_id, 'alrt-009');

const lineage = f.call('loopvault.skills.lineage', { skill_id: 'skill-morning-brief', version_id: 'v5' });
const cleanAncestor = lineage.chain.find(v => v.eval_summary.critical_alert_recall >= 0.95);
assert.equal(cleanAncestor.version_id, 'v3');

const rb = f.call('loopvault.deploy.rollback', {
  skill_id: 'skill-morning-brief',
  target_version_id: cleanAncestor.version_id,
  alert_id: 'alrt-009',
  reason: 'Rolled back past broken v4/v5 mute regex to verified clean ancestor v3.',
});
assert.equal(rb.production_version_id, 'v3');

const ack = f.call('loopvault.alerts.ack', {
  alert_id: 'alrt-009',
  remediated_version_id: 'v3',
  resolution_note: 'Restored v3 with 1.00 critical alert recall.',
});
assert.equal(ack.alert.status, 'acknowledged');

console.log(JSON.stringify({
  app: 'loopvault',
  skill_id: 'skill-morning-brief',
  rolled_back_to: rb.production_version_id,
  alert_status: ack.alert.status,
}, null, 2));
