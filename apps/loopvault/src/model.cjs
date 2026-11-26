'use strict';

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

function copy(v) { return structuredClone(v); }
function round4(n) { return Math.round(n * 10000) / 10000; }

function isWriteScope(scope) {
  return !(/\.(read|list|search)$/.test(scope));
}

function findSkill(data, skillId) {
  const s = data.skills.find(x => x.id === skillId);
  if (!s) fail('not_found', 'Skill not found: ' + skillId);
  return s;
}

function findVersion(skill, versionId) {
  const v = skill.versions.find(x => x.version_id === versionId);
  if (!v) fail('not_found', `Version ${versionId} not found on skill ${skill.id}`);
  return v;
}

function lineageChain(skill, startVersionId) {
  const chain = [];
  const seen = new Set();
  let cur = findVersion(skill, startVersionId);
  while (cur) {
    if (seen.has(cur.version_id)) fail('invalid_seed', 'Cycle detected in lineage DAG for ' + skill.id);
    seen.add(cur.version_id);
    chain.push(cur);
    if (!cur.parent_id) break;
    cur = findVersion(skill, cur.parent_id);
  }
  return chain;
}

function policyCheck(skill, version, policy) {
  const violations = [];
  if (version.projected_monthly_cost_usd > policy.max_monthly_budget_usd) {
    violations.push('budget_exceeded');
  }
  const hasBadWrite = version.tool_scopes.some(sc => {
    if (!isWriteScope(sc)) return false;
    if (skill.auto_run && policy.auto_run_requires_read_only) return true;
    return !policy.allowed_write_scopes.includes(sc);
  });
  if (hasBadWrite) violations.push('unauthorized_write_scope');

  const es = version.eval_summary;
  if (es.holdout_pass_rate < policy.min_holdout_pass_rate) {
    violations.push('holdout_below_threshold');
  }
  const gap = round4(es.dev_pass_rate - es.holdout_pass_rate);
  if (gap > policy.max_goodhart_gap) {
    violations.push('goodhart_overfit');
  }
  return {
    skill_id: skill.id,
    version_id: version.version_id,
    allowed: violations.length === 0,
    violations,
    goodhart_gap: gap,
  };
}

function validateSeed(ctx, data) {
  const accOk = ctx.binding.accounts.some(
    a => a.app_id === 'loopvault' && a.account_id === data.account_id && a.owner_person_id === data.owner_person_id
  );
  if (!accOk) fail('invalid_seed', 'Account or owner_person_id not bound in task binding.');

  const skillIds = new Set();
  for (const s of data.skills) {
    if (skillIds.has(s.id)) fail('invalid_seed', 'Duplicate skill ID: ' + s.id);
    skillIds.add(s.id);
    const vIds = new Set();
    for (const v of s.versions) {
      if (vIds.has(v.version_id)) fail('invalid_seed', `Duplicate version_id ${v.version_id} on ${s.id}`);
      vIds.add(v.version_id);
    }
    if (!vIds.has(s.production_version_id)) fail('invalid_seed', `Invalid production_version_id on ${s.id}`);
    const vMap = new Map(s.versions.map(v => [v.version_id, v]));
    for (const v of s.versions) {
      if (v.parent_id !== null) {
        if (!vIds.has(v.parent_id)) {
          fail('invalid_seed', `Unknown parent_id ${v.parent_id} on ${s.id}`);
        }
        const parent = vMap.get(v.parent_id);
        if (Date.parse(v.created_at) < Date.parse(parent.created_at)) {
          fail('invalid_seed', `Version ${s.id}:${v.version_id} created_at precedes parent ${v.parent_id}`);
        }
      }
      // Verify acyclic lineage
      lineageChain(s, v.version_id);
    }
  }

  const p = data.policy;
  if (p.max_monthly_budget_usd < 0) fail('invalid_seed', 'max_monthly_budget_usd must be >= 0');
  if (p.min_holdout_pass_rate < 0 || p.min_holdout_pass_rate > 1) fail('invalid_seed', 'Invalid min_holdout_pass_rate');
  if (p.max_goodhart_gap < 0 || p.max_goodhart_gap > 1) fail('invalid_seed', 'Invalid max_goodhart_gap');

  const repMap = new Map();
  for (const r of data.eval_reports) {
    if (repMap.has(r.report_id)) fail('invalid_seed', 'Duplicate report_id: ' + r.report_id);
    repMap.set(r.report_id, r);
    const s = findSkill(data, r.skill_id);
    const v = findVersion(s, r.version_id);
    if (Date.parse(r.ran_at) < Date.parse(v.created_at)) {
      fail('invalid_seed', `Eval report ${r.report_id} ran_at (${r.ran_at}) precedes ${r.skill_id}:${r.version_id} created_at (${v.created_at})`);
    }
  }

  const depIds = new Set();
  for (const dep of data.deployments || []) {
    if (depIds.has(dep.deployment_id)) fail('invalid_seed', 'Duplicate deployment_id: ' + dep.deployment_id);
    depIds.add(dep.deployment_id);
    const s = findSkill(data, dep.skill_id);
    findVersion(s, dep.from_version_id);
    const target = findVersion(s, dep.to_version_id);
    if (Date.parse(dep.at) < Date.parse(target.created_at)) {
      fail('invalid_seed', `Deployment ${dep.deployment_id} timestamp precedes target version ${dep.skill_id}:${dep.to_version_id}`);
    }
    if (dep.eval_report_id !== null && dep.eval_report_id !== undefined) {
      const rep = repMap.get(dep.eval_report_id);
      if (!rep) fail('invalid_seed', `Deployment ${dep.deployment_id} cites unknown eval_report_id ${dep.eval_report_id}`);
      if (rep.skill_id !== dep.skill_id || rep.version_id !== dep.to_version_id) {
        fail('invalid_seed', `Deployment ${dep.deployment_id} (${dep.skill_id}:${dep.to_version_id}) cites mismatched eval report ${rep.report_id} (${rep.skill_id}:${rep.version_id})`);
      }
      if (Date.parse(rep.ran_at) > Date.parse(dep.at)) {
        fail('invalid_seed', `Deployment ${dep.deployment_id} cites eval report ${rep.report_id} that ran after deployment`);
      }
    }
  }

  const alertIds = new Set();
  for (const a of data.alerts) {
    if (alertIds.has(a.alert_id)) fail('invalid_seed', 'Duplicate alert_id: ' + a.alert_id);
    alertIds.add(a.alert_id);
    const s = findSkill(data, a.skill_id);
    findVersion(s, a.version_id);
  }
}

function assetReferences(data) {
  return data.skills.flatMap(s =>
    [...new Set(s.asset_ids || [])].map(asset_id => ({ asset_id, object_id: s.id, object_type: 'skill' }))
  );
}

module.exports = {
  fail,
  copy,
  round4,
  isWriteScope,
  findSkill,
  findVersion,
  lineageChain,
  policyCheck,
  validateSeed,
  records: data => data.skills,
  objects: data => data.skills.map(s => s.id),
  references: () => [],
  assetReferences,
};
