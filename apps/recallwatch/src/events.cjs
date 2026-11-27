'use strict';

const c = require('./common.cjs');

function applyEvent(ctx, data, event) {
  const op = event.operation;
  const p = event.payload || {};
  const at = event.at;
  c.parseMs(at);

  if (op === 'recall.publish') {
    if (data.recalls.some((r) => r.id === p.recall_id)) {
      c.fail('invalid_event', `Recall already exists: ${p.recall_id}`);
    }
    const notice = {
      id: p.recall_id,
      brand: p.brand,
      product_name: p.product_name || `${p.brand} Product`,
      upc: p.upc,
      category: p.category || 'snacks_groceries',
      severity: p.severity,
      hazard: p.hazard,
      summary: p.summary || `${p.brand} recall advisory (${p.hazard})`,
      status: 'active',
      affected_lots: c.copy(p.affected_lots),
      excluded_lots: c.copy(p.excluded_lots || []),
      remedy_types: c.copy(p.remedy_types),
      proof_required: p.proof_required !== undefined ? Boolean(p.proof_required) : true,
      published_at: at,
      updated_at: at,
      remedy_deadline_at: p.remedy_deadline_at,
      label_asset_id: p.label_asset_id ?? null,
      history: [{ at, action: 'published', note: `Event ${event.event_id}` }],
    };
    data.recalls.push(notice);
    return data;
  }

  if (op === 'recall.expand_lots') {
    const recall = data.recalls.find((r) => r.id === p.recall_id);
    if (!recall) c.fail('invalid_event', `Unknown recall_id: ${p.recall_id}`);
    if (recall.status === 'closed') c.fail('invalid_event', `Cannot expand closed recall: ${p.recall_id}`);
    for (const lot of p.added_lots) {
      if (!recall.affected_lots.includes(lot)) recall.affected_lots.push(lot);
      recall.excluded_lots = recall.excluded_lots.filter((l) => l !== lot);
    }
    if (p.remedy_deadline_at) recall.remedy_deadline_at = p.remedy_deadline_at;
    recall.status = 'expanded';
    c.stamp(recall, at, 'expanded_lots', p.reason);
    return data;
  }

  if (op === 'recall.amend_or_close') {
    const recall = data.recalls.find((r) => r.id === p.recall_id);
    if (!recall) c.fail('invalid_event', `Unknown recall_id: ${p.recall_id}`);
    if (Array.isArray(p.excluded_lots)) {
      for (const lot of p.excluded_lots) {
        if (!recall.excluded_lots.includes(lot)) recall.excluded_lots.push(lot);
      }
    }
    if (p.remedy_deadline_at) recall.remedy_deadline_at = p.remedy_deadline_at;
    recall.status = p.status;
    c.stamp(recall, at, p.status === 'closed' ? 'closed' : 'amended', p.reason || undefined);
    return data;
  }

  if (op === 'claim.decision') {
    const claim = data.claims.find((cl) => cl.id === p.claim_id);
    if (!claim) c.fail('invalid_event', `Unknown claim_id: ${p.claim_id}`);
    if (!['submitted', 'under_review'].includes(claim.status)) {
      c.fail('invalid_event', `Cannot decide claim in status: ${claim.status}`);
    }
    claim.status = p.decision;
    if (p.amount_cents !== undefined) claim.decision_amount_cents = p.amount_cents;
    claim.decision_note = p.note;
    c.stamp(claim, at, `decision:${p.decision}`, p.note);
    return data;
  }

  c.fail('invalid_event', `Unsupported RecallWatch event operation: ${op}`);
}

module.exports = { applyEvent };
