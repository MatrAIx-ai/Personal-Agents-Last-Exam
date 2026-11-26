'use strict';
const { fail, copy } = require('./model.cjs');
const { log } = require('./diagnostics.cjs');

const VALID_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);
const POLICY_KEYS = new Set([
  'max_monthly_budget_usd',
  'auto_run_requires_read_only',
  'allowed_write_scopes',
  'min_holdout_pass_rate',
  'max_goodhart_gap',
]);

function applyEvent(ctx, data, event) {
  if (event.operation === 'loopvault.run.regression_alert') {
    const pl = event.payload || {};
    if (!pl.alert_id || !pl.skill_id || !pl.metric || !pl.summary) {
      fail('invalid_event', 'Missing required fields in regression_alert.');
    }
    if (!VALID_SEVERITIES.has(pl.severity)) {
      fail('invalid_event', 'Invalid severity: ' + pl.severity);
    }
    if (typeof pl.observed_value !== 'number' || !Number.isFinite(pl.observed_value) ||
        typeof pl.threshold !== 'number' || !Number.isFinite(pl.threshold)) {
      fail('invalid_event', 'observed_value and threshold must be finite numbers.');
    }
    if (data.alerts.some(a => a.alert_id === pl.alert_id)) {
      fail('invalid_event', 'Duplicate alert_id: ' + pl.alert_id);
    }
    const skill = data.skills.find(s => s.id === pl.skill_id);
    if (!skill) fail('invalid_event', 'Unknown skill_id: ' + pl.skill_id);

    const versionId = pl.version_id || skill.production_version_id;
    if (!skill.versions.some(v => v.version_id === versionId)) {
      fail('invalid_event', `Unknown version_id ${versionId} on skill ${skill.id}`);
    }

    data.alerts.push({
      alert_id: pl.alert_id,
      skill_id: skill.id,
      version_id: versionId,
      severity: pl.severity,
      metric: pl.metric,
      observed_value: pl.observed_value,
      threshold: pl.threshold,
      summary: pl.summary,
      status: 'open',
      created_at: event.at,
      acknowledged_at: null,
      resolution_note: null,
      remediated_version_id: null,
    });
    log(ctx, 'loopvault.event.regression_alert', { alert_id: pl.alert_id, skill_id: skill.id, version_id: versionId });
    return data;
  }

  if (event.operation === 'loopvault.policy.update') {
    const pl = event.payload || {};
    const keys = Object.keys(pl);
    if (keys.length === 0) fail('invalid_event', 'policy.update payload cannot be empty.');
    for (const k of keys) {
      if (!POLICY_KEYS.has(k)) fail('invalid_event', 'Unknown policy field: ' + k);
    }
    if (pl.max_monthly_budget_usd !== undefined && (typeof pl.max_monthly_budget_usd !== 'number' || !Number.isFinite(pl.max_monthly_budget_usd) || pl.max_monthly_budget_usd < 0)) {
      fail('invalid_event', 'max_monthly_budget_usd must be a non-negative number.');
    }
    if (pl.auto_run_requires_read_only !== undefined && typeof pl.auto_run_requires_read_only !== 'boolean') {
      fail('invalid_event', 'auto_run_requires_read_only must be boolean.');
    }
    if (pl.allowed_write_scopes !== undefined && (!Array.isArray(pl.allowed_write_scopes) || !pl.allowed_write_scopes.every(x => typeof x === 'string' && x.length > 0))) {
      fail('invalid_event', 'allowed_write_scopes must be an array of non-empty strings.');
    }
    if (pl.min_holdout_pass_rate !== undefined && (typeof pl.min_holdout_pass_rate !== 'number' || pl.min_holdout_pass_rate < 0 || pl.min_holdout_pass_rate > 1)) {
      fail('invalid_event', 'min_holdout_pass_rate must be in [0, 1].');
    }
    if (pl.max_goodhart_gap !== undefined && (typeof pl.max_goodhart_gap !== 'number' || pl.max_goodhart_gap < 0 || pl.max_goodhart_gap > 1)) {
      fail('invalid_event', 'max_goodhart_gap must be in [0, 1].');
    }

    // Apply validated updates without silently rolling back active production pointers
    for (const k of keys) {
      data.policy[k] = copy(pl[k]);
    }
    data.policy.updated_at = event.at;
    log(ctx, 'loopvault.event.policy_update', { updated_keys: keys });
    return data;
  }

  fail('invalid_event', 'Unsupported operation: ' + event.operation);
}

module.exports = { applyEvent };
