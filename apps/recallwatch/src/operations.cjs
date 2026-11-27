'use strict';

const c = require('./common.cjs');

function findById(list, id, label) {
  const found = list.find((r) => r.id === id);
  if (!found) c.fail('not_found', `${label} not found: ${id}`);
  return found;
}

function checkAssetWarning(ctx, assetId) {
  if (!assetId) return null;
  if (ctx && ctx.assets && typeof ctx.assets.read === 'function') {
    try {
      ctx.assets.read(assetId);
      return null;
    } catch (err) {
      if (err && (err.code === 'unavailable' || err.code === 'not_available' || err.code === 'not_found')) {
        return `ASSET_MISSING: optional label asset ${assetId} is not materialized`;
      }
      throw err;
    }
  }
  const catalog = ctx && ctx.resources && Array.isArray(ctx.resources.assets) ? ctx.resources.assets : null;
  if (!catalog) return null;
  const desc = catalog.find((a) => a.asset_id === assetId);
  if (!desc || (desc.availability && desc.availability.status !== 'ready')) {
    return `ASSET_MISSING: optional label asset ${assetId} is not materialized`;
  }
  return null;
}

function handleTool(ctx, data, name, args) {
  const now = c.nowOf(ctx);

  // --- Recalls ---
  if (name === 'recallwatch.recall.search') {
    const q = (args.query || '').trim().toLowerCase();
    const items = data.recalls.filter((r) => {
      if (args.upc && r.upc !== args.upc) return false;
      if (args.brand && r.brand.toLowerCase() !== args.brand.toLowerCase()) return false;
      if (args.category && r.category !== args.category) return false;
      if (args.severity && r.severity !== args.severity) return false;
      if (args.hazard && !r.hazard.toLowerCase().includes(args.hazard.toLowerCase())) return false;
      if (args.status && r.status !== args.status) return false;
      if (args.lot_code && !c.isLotAffected(r, args.lot_code)) return false;
      if (q) {
        const hay = `${r.id} ${r.brand} ${r.product_name} ${r.upc} ${r.hazard} ${r.summary}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    return { data, result: { items: c.copy(items) } };
  }

  if (name === 'recallwatch.recall.get') {
    const item = findById(data.recalls, args.id, 'Recall notice');
    const lot_check = args.lot_code
      ? { lot_code: args.lot_code, exposure_status: c.evaluateRecallForLot(item, args.lot_code, now) }
      : null;
    const asset_warning = checkAssetWarning(ctx, item.label_asset_id);
    return { data, result: { item: c.copy(item), lot_check, asset_warning } };
  }

  // --- Inventory ---
  if (name === 'recallwatch.inventory.list') {
    const q = (args.query || '').trim().toLowerCase();
    const items = data.inventory.filter((it) => {
      if (!args.include_archived && it.status === 'archived') return false;
      if (args.holder_person_ref && it.holder_person_ref !== args.holder_person_ref) return false;
      if (q) {
        const hay = `${it.id} ${it.brand} ${it.product_name} ${it.upc} ${it.lot_code} ${it.location_note}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const exposures = items.map((it) => c.evaluateItemExposure(data, it, now));
    return { data, result: { items: c.copy(items), exposures } };
  }

  if (name === 'recallwatch.inventory.get') {
    const item = findById(data.inventory, args.id, 'Inventory item');
    return { data, result: { item: c.copy(item), exposure: c.evaluateItemExposure(data, item, now) } };
  }

  if (name === 'recallwatch.inventory.check_exposure') {
    const targets = args.item_id
      ? [findById(data.inventory, args.item_id, 'Inventory item')]
      : data.inventory.filter((it) => it.status !== 'archived');
    const exposures = targets.map((it) => c.evaluateItemExposure(data, it, now));
    return { data, result: { evaluated_at: now, exposures } };
  }

  if (name === 'recallwatch.inventory.register') {
    if (ctx && ctx.binding && Array.isArray(ctx.binding.people)) {
      if (!ctx.binding.people.some((p) => p.person_id === args.holder_person_ref)) {
        c.fail('validation_error', `Unknown holder_person_ref: ${args.holder_person_ref}`);
      }
    }
    const id = c.nextId('item', data.inventory, args.id);
    const item = {
      id,
      account_id: data.account_id,
      brand: args.brand,
      product_name: args.product_name,
      upc: args.upc,
      category: args.category,
      lot_code: args.lot_code,
      purchase_date: args.purchase_date,
      holder_person_ref: args.holder_person_ref,
      location_note: args.location_note,
      status: 'registered',
      disposal_note: '',
      created_at: now,
      updated_at: now,
      history: [{ at: now, action: 'registered' }],
    };
    data.inventory.push(item);
    return { data, result: { id, exposure: c.evaluateItemExposure(data, item, now) } };
  }

  if (name === 'recallwatch.inventory.update') {
    const item = findById(data.inventory, args.id, 'Inventory item');
    if (item.status === 'archived') {
      c.fail('invalid_state', 'Archived inventory items cannot be edited.');
    }
    const patch = args.patch || {};
    if (patch.holder_person_ref && ctx && ctx.binding && Array.isArray(ctx.binding.people)) {
      if (!ctx.binding.people.some((p) => p.person_id === patch.holder_person_ref)) {
        c.fail('validation_error', `Unknown holder_person_ref: ${patch.holder_person_ref}`);
      }
    }
    for (const key of ['lot_code', 'location_note', 'holder_person_ref', 'disposal_note', 'status']) {
      if (patch[key] !== undefined) item[key] = patch[key];
    }
    c.stamp(item, now, 'updated');
    return { data, result: { id: item.id, exposure: c.evaluateItemExposure(data, item, now) } };
  }

  if (name === 'recallwatch.inventory.archive') {
    const item = findById(data.inventory, args.id, 'Inventory item');
    if (item.status === 'archived') {
      c.fail('invalid_state', `Inventory item is already archived: ${item.id}`);
    }
    item.status = 'archived';
    if (args.disposal_note !== undefined) item.disposal_note = args.disposal_note;
    c.stamp(item, now, 'archived', args.disposal_note || undefined);
    return { data, result: { id: item.id } };
  }

  // --- Watchlists ---
  if (name === 'recallwatch.watchlist.list') {
    const items = data.watchlists.filter((w) => args.include_deleted || w.status !== 'deleted');
    const effective_statuses = items.map((w) => ({
      id: w.id,
      effective_status: c.effectiveWatchlistStatus(w, now),
    }));
    return { data, result: { items: c.copy(items), effective_statuses } };
  }

  if (name === 'recallwatch.watchlist.create') {
    const id = c.nextId('wl', data.watchlists, args.id);
    const rule = {
      id,
      account_id: data.account_id,
      label: args.label,
      brand: args.brand ?? null,
      upc: args.upc ?? null,
      category: args.category ?? null,
      hazard_tag: args.hazard_tag ?? null,
      min_severity: args.min_severity,
      status: 'active',
      pause_until: null,
      delivery_mode: args.delivery_mode || 'immediate',
      created_at: now,
      updated_at: now,
      history: [{ at: now, action: 'created' }],
    };
    data.watchlists.push(rule);
    return { data, result: { id } };
  }

  if (name === 'recallwatch.watchlist.update') {
    const rule = findById(data.watchlists, args.id, 'Watchlist rule');
    if (rule.status === 'deleted') c.fail('not_found', `Watchlist rule is deleted: ${rule.id}`);
    const patch = args.patch || {};
    for (const key of ['label', 'min_severity', 'status', 'pause_until', 'delivery_mode']) {
      if (patch[key] !== undefined) rule[key] = patch[key];
    }
    if (rule.status !== 'paused') rule.pause_until = null;
    c.stamp(rule, now, 'updated');
    return { data, result: { id: rule.id } };
  }

  if (name === 'recallwatch.watchlist.delete') {
    const rule = findById(data.watchlists, args.id, 'Watchlist rule');
    if (rule.status === 'deleted') c.fail('not_found', `Watchlist rule already deleted: ${rule.id}`);
    rule.status = 'deleted';
    rule.pause_until = null;
    c.stamp(rule, now, 'deleted');
    return { data, result: { id: rule.id } };
  }

  // --- Remedy Claims ---
  if (name === 'recallwatch.claim.list') {
    const items = data.claims.filter((cl) => {
      if (args.status && cl.status !== args.status) return false;
      if (args.recall_id && cl.recall_id !== args.recall_id) return false;
      if (args.item_id && cl.item_id !== args.item_id) return false;
      return true;
    });
    return { data, result: { items: c.copy(items) } };
  }

  if (name === 'recallwatch.claim.get') {
    const item = findById(data.claims, args.id, 'Remedy claim');
    return { data, result: { item: c.copy(item) } };
  }

  if (name === 'recallwatch.claim.preview') {
    const recall = findById(data.recalls, args.recall_id, 'Recall notice');
    const item = findById(data.inventory, args.item_id, 'Inventory item');
    const preview = c.evaluateClaimEligibility(data, {
      recall,
      item,
      remedy_type: args.remedy_type,
      proof_ref: args.proof_ref ?? null,
      virtualNow: now,
    });
    return { data, result: preview };
  }

  if (name === 'recallwatch.claim.create_draft') {
    const recall = findById(data.recalls, args.recall_id, 'Recall notice');
    const item = findById(data.inventory, args.item_id, 'Inventory item');
    const existing = c.findActiveClaim(data, recall.id, item.id);
    if (existing) {
      c.fail('duplicate_active_claim', `Active claim ${existing.id} already exists for item ${item.id} and recall ${recall.id}.`);
    }
    const proofCheck = c.validateProofRef(args.proof_ref ?? null);
    if (!proofCheck.valid) c.fail('proof_reference_invalid', 'Malformed proof_ref object.');
    const id = c.nextId('clm', data.claims, args.id);
    const claim = {
      id,
      account_id: data.account_id,
      recall_id: recall.id,
      item_id: item.id,
      lot_code: item.lot_code,
      remedy_type: args.remedy_type,
      status: 'draft',
      proof_ref: args.proof_ref ? c.copy(args.proof_ref) : null,
      recipient_person_ref: args.recipient_person_ref ?? item.holder_person_ref,
      recipient_name: args.recipient_name || '',
      shipping_address: args.shipping_address || '',
      payout_method: args.payout_method || '',
      notes: args.notes || '',
      claim_receipt_id: null,
      decision_amount_cents: null,
      decision_note: '',
      created_at: now,
      updated_at: now,
      submitted_at: null,
      history: [{ at: now, action: 'created_draft' }],
    };
    data.claims.push(claim);
    return { data, result: { id } };
  }

  if (name === 'recallwatch.claim.update_draft') {
    const claim = findById(data.claims, args.id, 'Remedy claim');
    if (claim.status !== 'draft') {
      c.fail('invalid_state_transition', `claim.update_draft only edits draft claims; use claim.amend for submitted claims (current: ${claim.status}).`);
    }
    const patch = args.patch || {};
    if (patch.proof_ref !== undefined) {
      const proofCheck = c.validateProofRef(patch.proof_ref);
      if (!proofCheck.valid) c.fail('proof_reference_invalid', 'Malformed proof_ref object.');
    }
    for (const key of ['remedy_type', 'proof_ref', 'recipient_person_ref', 'recipient_name', 'shipping_address', 'payout_method', 'notes']) {
      if (patch[key] !== undefined) claim[key] = patch[key] === null ? null : c.copy(patch[key]);
    }
    c.stamp(claim, now, 'updated_draft');
    return { data, result: { id: claim.id } };
  }

  if (name === 'recallwatch.claim.amend') {
    const claim = findById(data.claims, args.id, 'Remedy claim');
    if (!['draft', 'submitted'].includes(claim.status)) {
      c.fail('invalid_state_transition', `Cannot amend claim in status: ${claim.status}`);
    }
    const patch = args.patch || {};
    if (patch.proof_ref !== undefined) {
      const proofCheck = c.validateProofRef(patch.proof_ref);
      if (!proofCheck.valid) c.fail('proof_reference_invalid', 'Malformed proof_ref object.');
    }
    for (const key of ['proof_ref', 'recipient_person_ref', 'recipient_name', 'shipping_address', 'payout_method', 'notes']) {
      if (patch[key] !== undefined) claim[key] = patch[key] === null ? null : c.copy(patch[key]);
    }
    c.stamp(claim, now, `amended_${claim.status}`);
    return { data, result: { id: claim.id } };
  }

  if (name === 'recallwatch.claim.submit') {
    const claim = findById(data.claims, args.id, 'Remedy claim');
    if (claim.status !== 'draft') {
      c.fail('invalid_state_transition', `Only draft claims can be submitted (current: ${claim.status}).`);
    }
    const recall = findById(data.recalls, claim.recall_id, 'Recall notice');
    const item = findById(data.inventory, claim.item_id, 'Inventory item');
    const check = c.evaluateClaimEligibility(data, {
      recall,
      item,
      remedy_type: claim.remedy_type,
      proof_ref: claim.proof_ref,
      virtualNow: now,
      excludeClaimId: claim.id,
    });
    if (!check.eligible) {
      const first = check.reasons[0];
      c.fail(first.toLowerCase(), `Claim cannot be submitted: ${check.reasons.join(', ')}`);
    }
    claim.lot_code = item.lot_code;
    claim.status = 'submitted';
    claim.submitted_at = now;
    claim.claim_receipt_id = `rcpt-${claim.id}`;
    c.stamp(claim, now, 'submitted');
    return { data, result: { id: claim.id, claim_receipt_id: claim.claim_receipt_id } };
  }

  if (name === 'recallwatch.claim.withdraw') {
    const claim = findById(data.claims, args.id, 'Remedy claim');
    if (c.TERMINAL_CLAIM_STATUSES.has(claim.status)) {
      c.fail('invalid_state_transition', `Cannot withdraw claim in terminal status: ${claim.status}`);
    }
    claim.status = 'withdrawn';
    c.stamp(claim, now, 'withdrawn', args.reason || undefined);
    return { data, result: { id: claim.id } };
  }

  c.fail('unknown_tool', `Unknown RecallWatch operation: ${name}`);
}

module.exports = { handleTool };
