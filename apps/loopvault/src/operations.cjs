'use strict';
const {
  fail,
  copy,
  round4,
  findSkill,
  findVersion,
  lineageChain,
  policyCheck,
} = require('./model.cjs');
const { log } = require('./diagnostics.cjs');

function handleTool(ctx, data, name, args) {
  if (name === 'loopvault.skills.list') {
    const items = data.skills.map(s => {
      const prod = findVersion(s, s.production_version_id);
      const check = policyCheck(s, prod, data.policy);
      const latest = s.versions[s.versions.length - 1];
      const openAlerts = data.alerts.filter(a => a.skill_id === s.id && a.status === 'open').length;
      return {
        id: s.id,
        name: s.name,
        auto_run: s.auto_run,
        production_version_id: s.production_version_id,
        latest_version_id: latest.version_id,
        compliance_status: check.allowed ? 'compliant' : 'non_compliant',
        open_alerts_count: openAlerts,
        asset_ids: copy(s.asset_ids),
      };
    });
    log(ctx, 'loopvault.skills.list', { count: items.length });
    return { data, result: { skills: items } };
  }

  if (name === 'loopvault.skills.get') {
    const s = findSkill(data, args.skill_id);
    const prod = findVersion(s, s.production_version_id);
    const check = policyCheck(s, prod, data.policy);
    const runId = ctx.run_id || 'demo';
    const resource_uris = (s.asset_ids || []).map(aid => `pale://${runId}/loopvault/assets/${aid}`);
    const pending_approvals = data.approval_requests.filter(r => r.skill_id === s.id && r.status === 'pending_approval');
    const rejected_reviews = data.version_reviews.filter(r => r.skill_id === s.id);
    return {
      data,
      result: {
        skill: {
          ...copy(s),
          compliance_status: check.allowed ? 'compliant' : 'non_compliant',
          production_violations: check.violations,
        },
        pending_approvals: copy(pending_approvals),
        version_reviews: copy(rejected_reviews),
        resource_uris,
      },
    };
  }

  if (name === 'loopvault.skills.lineage') {
    const s = findSkill(data, args.skill_id);
    const startId = args.version_id || s.production_version_id;
    const chain = lineageChain(s, startId);
    const diffs = [];
    for (let i = 0; i < chain.length - 1; i++) {
      const child = chain[i];
      const parent = chain[i + 1];
      diffs.push({
        from_version_id: parent.version_id,
        to_version_id: child.version_id,
        added_rule_tags: child.rule_tags.filter(t => !parent.rule_tags.includes(t)),
        removed_rule_tags: parent.rule_tags.filter(t => !child.rule_tags.includes(t)),
        added_scopes: child.tool_scopes.filter(sc => !parent.tool_scopes.includes(sc)),
        removed_scopes: parent.tool_scopes.filter(sc => !child.tool_scopes.includes(sc)),
        cost_delta_usd: round4(child.projected_monthly_cost_usd - parent.projected_monthly_cost_usd),
        dev_delta: round4(child.eval_summary.dev_pass_rate - parent.eval_summary.dev_pass_rate),
        holdout_delta: round4(child.eval_summary.holdout_pass_rate - parent.eval_summary.holdout_pass_rate),
        critical_alert_recall_delta: round4(child.eval_summary.critical_alert_recall - parent.eval_summary.critical_alert_recall),
      });
    }
    return {
      data,
      result: {
        skill_id: s.id,
        production_version_id: s.production_version_id,
        chain: chain.map(v => copy(v)),
        diffs,
      },
    };
  }

  if (name === 'loopvault.evals.get_report') {
    let rep;
    if (args.report_id) {
      rep = data.eval_reports.find(r => r.report_id === args.report_id);
    } else if (args.skill_id && args.version_id) {
      const matches = data.eval_reports.filter(r => r.skill_id === args.skill_id && r.version_id === args.version_id);
      rep = matches[matches.length - 1];
    } else {
      fail('invalid_arguments', 'Provide report_id or both skill_id and version_id.');
    }
    if (!rep) fail('not_found', 'Evaluation report not found.');
    return { data, result: { report: copy(rep) } };
  }

  if (name === 'loopvault.asset.read') {
    const s = findSkill(data, args.skill_id);
    if (!s.asset_ids.includes(args.asset_id)) {
      fail('not_available', 'Asset does not belong to this skill.');
    }
    if (!ctx.assets?.read) fail('unsupported_capability', 'Asset reader is required.');
    return { data, result: { file: ctx.assets.read(args.asset_id) } };
  }

  if (name === 'loopvault.policy.get') {
    return { data, result: { policy: copy(data.policy) } };
  }

  if (name === 'loopvault.policy.check') {
    const s = findSkill(data, args.skill_id);
    const v = findVersion(s, args.version_id);
    const check = policyCheck(s, v, data.policy);
    return { data, result: check };
  }

  if (name === 'loopvault.alerts.list') {
    const list = data.alerts.filter(a => {
      if (args.skill_id && a.skill_id !== args.skill_id) return false;
      if (args.status && a.status !== args.status) return false;
      return true;
    });
    return { data, result: { alerts: copy(list) } };
  }

  if (name === 'loopvault.skills.create_candidate') {
    const s = findSkill(data, args.skill_id);
    const parent = findVersion(s, args.parent_id);
    const vid = args.version_id || `v${s.versions.length + 1}`;
    if (s.versions.some(v => v.version_id === vid)) {
      fail('conflict', `Version ${vid} already exists on ${s.id}`);
    }
    const ruleTags = copy(args.rule_tags || parent.rule_tags);
    const hasBroadMute = ruleTags.includes('broad_mute_regex');
    const newVersion = {
      version_id: vid,
      parent_id: parent.version_id,
      rule_summary: args.rule_summary,
      rule_tags: ruleTags,
      tool_scopes: copy(args.tool_scopes),
      projected_monthly_cost_usd: args.projected_monthly_cost_usd,
      eval_summary: {
        dev_pass_rate: parent.eval_summary.dev_pass_rate,
        holdout_pass_rate: parent.eval_summary.holdout_pass_rate,
        critical_alert_recall: hasBroadMute ? 0.65 : Math.max(parent.eval_summary.critical_alert_recall, 0.96),
      },
      created_at: ctx.virtual_now,
    };
    s.versions.push(newVersion);
    log(ctx, 'loopvault.skills.create_candidate', { skill_id: s.id, version_id: vid });
    return { data, result: { skill_id: s.id, candidate: copy(newVersion) } };
  }

  if (name === 'loopvault.evals.run') {
    const s = findSkill(data, args.skill_id);
    const v = findVersion(s, args.version_id);
    const existing = data.eval_reports.filter(r => r.skill_id === s.id && r.version_id === v.version_id);
    const base = existing[existing.length - 1];
    const reportId = `rep-${s.id.replace('skill-', '')}-${v.version_id}-${data.eval_reports.length + 1}`;
    const gap = round4(v.eval_summary.dev_pass_rate - v.eval_summary.holdout_pass_rate);
    const report = {
      report_id: reportId,
      skill_id: s.id,
      version_id: v.version_id,
      dev_pass_rate: v.eval_summary.dev_pass_rate,
      holdout_pass_rate: v.eval_summary.holdout_pass_rate,
      goodhart_gap: gap,
      critical_alert_recall: v.eval_summary.critical_alert_recall,
      failed_case_ids: base ? copy(base.failed_case_ids) : [],
      projected_monthly_cost_usd: v.projected_monthly_cost_usd,
      ran_at: ctx.virtual_now,
    };
    data.eval_reports.push(report);
    log(ctx, 'loopvault.evals.run', { skill_id: s.id, version_id: v.version_id, report_id: reportId });
    return { data, result: { report: copy(report) } };
  }

  if (name === 'loopvault.deploy.promote') {
    const s = findSkill(data, args.skill_id);
    const v = findVersion(s, args.version_id);
    const rep = data.eval_reports.find(r => r.report_id === args.eval_report_id);
    if (!rep || rep.skill_id !== s.id || rep.version_id !== v.version_id) {
      fail('not_found', 'Matching eval_report_id not found for this skill and version.');
    }
    if (s.production_version_id === v.version_id) {
      return {
        data,
        result: {
          skill_id: s.id,
          production_version_id: s.production_version_id,
          already_active: true,
        },
      };
    }
    const check = policyCheck(s, v, data.policy);
    if (!check.allowed) {
      fail('policy_violation', 'Promotion blocked by workspace policy: ' + check.violations.join(', '));
    }
    const prev = s.production_version_id;
    s.production_version_id = v.version_id;
    data.deployments.push({
      deployment_id: `dep-${data.deployments.length + 1}`,
      action: 'promote',
      skill_id: s.id,
      from_version_id: prev,
      to_version_id: v.version_id,
      eval_report_id: rep.report_id,
      alert_id: null,
      reason: args.reason,
      at: ctx.virtual_now,
    });
    log(ctx, 'loopvault.deploy.promote', { skill_id: s.id, from: prev, to: v.version_id });
    return {
      data,
      result: {
        skill_id: s.id,
        production_version_id: s.production_version_id,
        already_active: false,
      },
    };
  }

  if (name === 'loopvault.deploy.mark_rejected') {
    const s = findSkill(data, args.skill_id);
    findVersion(s, args.version_id);
    if (s.production_version_id === args.version_id) {
      fail('invalid_state', 'Cannot mark currently active production version as rejected_regression.');
    }
    const entry = {
      skill_id: s.id,
      version_id: args.version_id,
      status: 'rejected_regression',
      evidence: args.evidence,
      reviewed_at: ctx.virtual_now,
    };
    const idx = data.version_reviews.findIndex(r => r.skill_id === s.id && r.version_id === args.version_id);
    if (idx >= 0) data.version_reviews[idx] = entry;
    else data.version_reviews.push(entry);
    log(ctx, 'loopvault.deploy.mark_rejected', { skill_id: s.id, version_id: args.version_id });
    return { data, result: { review: copy(entry) } };
  }

  if (name === 'loopvault.deploy.request_approval') {
    const s = findSkill(data, args.skill_id);
    const v = findVersion(s, args.version_id);
    const check = policyCheck(s, v, data.policy);
    const reqEntry = {
      approval_id: `appr-${data.approval_requests.length + 1}`,
      skill_id: s.id,
      version_id: v.version_id,
      actor: data.owner_person_id,
      status: 'pending_approval',
      violations: check.violations,
      note: args.note,
      requested_at: ctx.virtual_now,
    };
    data.approval_requests.push(reqEntry);
    log(ctx, 'loopvault.deploy.request_approval', { skill_id: s.id, version_id: v.version_id });
    return {
      data,
      result: {
        approval: copy(reqEntry),
        production_version_id: s.production_version_id,
      },
    };
  }

  if (name === 'loopvault.deploy.rollback') {
    const s = findSkill(data, args.skill_id);
    const targetVersion = findVersion(s, args.target_version_id);
    if (args.alert_id) {
      const al = data.alerts.find(a => a.alert_id === args.alert_id && a.skill_id === s.id);
      if (!al) fail('not_found', 'Alert not found for skill: ' + args.alert_id);
    }
    if (s.production_version_id === args.target_version_id) {
      return {
        data,
        result: {
          skill_id: s.id,
          production_version_id: s.production_version_id,
          already_active: true,
        },
      };
    }
    const chain = lineageChain(s, s.production_version_id);
    const isAncestor = chain.slice(1).some(v => v.version_id === args.target_version_id);
    if (!isAncestor) {
      fail('invalid_arguments', `Target ${args.target_version_id} is not an ancestor of production ${s.production_version_id}.`);
    }
    const check = policyCheck(s, targetVersion, data.policy);
    if (!check.allowed) {
      fail('policy_violation', 'Rollback target violates current workspace policy: ' + check.violations.join(', '));
    }
    const prev = s.production_version_id;
    s.production_version_id = args.target_version_id;
    data.deployments.push({
      deployment_id: `dep-${data.deployments.length + 1}`,
      action: 'rollback',
      skill_id: s.id,
      from_version_id: prev,
      to_version_id: args.target_version_id,
      eval_report_id: null,
      alert_id: args.alert_id || null,
      reason: args.reason,
      at: ctx.virtual_now,
    });
    log(ctx, 'loopvault.deploy.rollback', { skill_id: s.id, from: prev, to: args.target_version_id });
    return {
      data,
      result: {
        skill_id: s.id,
        from_version_id: prev,
        production_version_id: s.production_version_id,
        already_active: false,
      },
    };
  }

  if (name === 'loopvault.alerts.ack') {
    const alert = data.alerts.find(a => a.alert_id === args.alert_id);
    if (!alert) fail('not_found', 'Alert not found: ' + args.alert_id);
    if (args.remediated_version_id) {
      const s = findSkill(data, alert.skill_id);
      findVersion(s, args.remediated_version_id);
    }
    alert.status = 'acknowledged';
    alert.acknowledged_at = ctx.virtual_now;
    alert.resolution_note = args.resolution_note;
    alert.remediated_version_id = args.remediated_version_id || null;
    log(ctx, 'loopvault.alerts.ack', { alert_id: alert.alert_id });
    return { data, result: { alert: copy(alert) } };
  }

  fail('unknown_tool', 'Unknown tool: ' + name);
}

module.exports = { handleTool };
