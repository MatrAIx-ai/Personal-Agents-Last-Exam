'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const view = require('../gui/src/view.js');
const publisher = require('../src/publisher.cjs');

const root = path.resolve(__dirname, '..');
const baseSeed = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/minimal.json'), 'utf8'));
const baseBinding = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/binding.json'), 'utf8'));
const baseAssets = JSON.parse(fs.readFileSync(path.join(root, 'contribution/assets.catalog.json'), 'utf8'));

function fresh(virtual_now = '2026-11-18T12:00:00+00:00') {
  return {
    ctx: { binding: structuredClone(baseBinding), resources: structuredClone(baseAssets), virtual_now },
    data: structuredClone(baseSeed),
  };
}

test('seed validates cleanly and reads are side-effect free', () => {
  const { ctx, data } = fresh();
  plugin.validateSeed(ctx, data);
  const before = JSON.stringify(data);
  const search = plugin.handleTool(ctx, data, 'recallwatch.recall.search', { severity: 'class_i', lot_code: 'LOT-26B' }).result;
  assert.equal(search.items.length, 1);
  assert.equal(search.items[0].id, 'RW-2026-014');

  const detail = plugin.handleTool(ctx, data, 'recallwatch.recall.get', { id: 'RW-2026-014', lot_code: 'LOT-26Z' }).result;
  assert.equal(detail.lot_check.exposure_status, 'unaffected');
  assert.equal(detail.asset_warning, null);

  // Missing optional label asset returns structured warning instead of throwing
  const missingAsset = plugin.handleTool(ctx, data, 'recallwatch.recall.get', { id: 'RW-2026-020' }).result;
  assert.ok(missingAsset.asset_warning && missingAsset.asset_warning.startsWith('ASSET_MISSING:'));
  assert.equal(JSON.stringify(data), before);
});

test('lot-level exposure matching separates affected vs unaffected identical UPC items and archived items', () => {
  const { ctx, data } = fresh();
  const res = plugin.handleTool(ctx, data, 'recallwatch.inventory.check_exposure', {}).result;
  const byId = Object.fromEntries(res.exposures.map((e) => [e.item_id, e]));
  assert.equal(byId['item-oat-daycare'].exposure_status, 'matched_active');
  assert.equal(byId['item-oat-pantry'].exposure_status, 'unaffected');
  assert.equal(byId['item-fan-dev'].exposure_status, 'matched_active');
  assert.equal(byId['item-fan-priya'].exposure_status, 'unaffected');
  assert.equal(byId['item-spray-expired'].exposure_status, 'matched_remedy_expired');
  assert.equal(byId['item-highchair-archived'], undefined);

  // Archiving removes item from active exposure alerts
  plugin.handleTool(ctx, data, 'recallwatch.inventory.archive', { id: 'item-oat-daycare', disposal_note: 'Discarded' });
  const afterArchive = plugin.handleTool(ctx, data, 'recallwatch.inventory.get', { id: 'item-oat-daycare' }).result;
  assert.equal(afterArchive.exposure.exposure_status, 'archived');
});

test('claim preview and submit enforce exact lot, proof_ref, inclusive deadline, and duplicate guard', () => {
  const { ctx, data } = fresh('2026-12-02T23:59:59+00:00');
  // Valid proof_ref at exact deadline boundary (inclusive <=)
  const okPreview = plugin.handleTool(ctx, data, 'recallwatch.claim.preview', {
    recall_id: 'RW-2026-014',
    item_id: 'item-oat-daycare',
    remedy_type: 'refund',
    proof_ref: { kind: 'file_ref', id: 'file-receipt-oat-01', version: 1 },
  }).result;
  assert.equal(okPreview.eligible, true);

  // Missing required proof_ref
  const noProof = plugin.handleTool(ctx, data, 'recallwatch.claim.preview', {
    recall_id: 'RW-2026-014',
    item_id: 'item-oat-daycare',
    remedy_type: 'refund',
    proof_ref: null,
  }).result;
  assert.equal(noProof.eligible, false);
  assert.ok(noProof.reasons.includes('PROOF_REQUIRED'));

  // Invalid proof_ref structure
  const badProof = plugin.handleTool(ctx, data, 'recallwatch.claim.preview', {
    recall_id: 'RW-2026-014',
    item_id: 'item-oat-daycare',
    remedy_type: 'refund',
    proof_ref: { kind: 'file_ref', id: 'bad id with spaces' },
  }).result;
  assert.equal(badProof.eligible, false);
  assert.ok(badProof.reasons.includes('PROOF_REFERENCE_INVALID'));

  // Unaffected lot rejected
  const unaffected = plugin.handleTool(ctx, data, 'recallwatch.claim.preview', {
    recall_id: 'RW-2026-014',
    item_id: 'item-oat-pantry',
    remedy_type: 'refund',
    proof_ref: { kind: 'file_ref', id: 'file-receipt-oat-02', version: 1 },
  }).result;
  assert.equal(unaffected.eligible, false);
  assert.ok(unaffected.reasons.includes('LOT_NOT_AFFECTED'));

  // Create draft and submit at exact deadline boundary succeeds
  const created = plugin.handleTool(ctx, data, 'recallwatch.claim.create_draft', {
    id: 'clm-oat-1',
    recall_id: 'RW-2026-014',
    item_id: 'item-oat-daycare',
    remedy_type: 'refund',
    proof_ref: { kind: 'file_ref', id: 'file-receipt-oat-01', version: 1 },
  }).result;
  assert.equal(created.id, 'clm-oat-1');

  // Duplicate active claim for same item & recall is blocked
  assert.throws(
    () =>
      plugin.handleTool(ctx, data, 'recallwatch.claim.create_draft', {
        recall_id: 'RW-2026-014',
        item_id: 'item-oat-daycare',
        remedy_type: 'refund',
      }),
    (err) => err.code === 'duplicate_active_claim'
  );

  const submitted = plugin.handleTool(ctx, data, 'recallwatch.claim.submit', { id: 'clm-oat-1' }).result;
  assert.equal(submitted.claim_receipt_id, 'rcpt-clm-oat-1');

  // 1 second past deadline fails with remedy_window_expired
  const late = fresh('2026-12-03T00:00:00+00:00');
  plugin.handleTool(late.ctx, late.data, 'recallwatch.claim.create_draft', {
    id: 'clm-oat-late',
    recall_id: 'RW-2026-014',
    item_id: 'item-oat-daycare',
    remedy_type: 'refund',
    proof_ref: { kind: 'file_ref', id: 'file-receipt-oat-01', version: 1 },
  });
  assert.throws(
    () => plugin.handleTool(late.ctx, late.data, 'recallwatch.claim.submit', { id: 'clm-oat-late' }),
    (err) => err.code === 'remedy_window_expired'
  );
});

test('claim.update_draft and claim.amend support Task #156 draft and submitted address redirection', () => {
  const { ctx, data } = fresh();
  // Create draft for Dev's affected fan, update draft, submit, then amend shipping_address on submitted claim
  plugin.handleTool(ctx, data, 'recallwatch.claim.create_draft', {
    id: 'clm-fan-dev',
    recall_id: 'RW-2026-017',
    item_id: 'item-fan-dev',
    remedy_type: 'replacement',
    proof_ref: { kind: 'file_ref', id: 'file-receipt-88', version: 1 },
    recipient_person_ref: 'person-dev',
    recipient_name: 'Dev Nair',
    shipping_address: '14 Elm St, Unit 2, Exampleton, NY 10000',
  });
  plugin.handleTool(ctx, data, 'recallwatch.claim.update_draft', {
    id: 'clm-fan-dev',
    patch: { notes: 'Confirmed authorization from holder' },
  });
  plugin.handleTool(ctx, data, 'recallwatch.claim.submit', { id: 'clm-fan-dev' });

  // Submitted claim cannot use claim.update_draft, must use claim.amend
  assert.throws(
    () => plugin.handleTool(ctx, data, 'recallwatch.claim.update_draft', { id: 'clm-fan-dev', patch: { notes: 'nope' } }),
    (err) => err.code === 'invalid_state_transition'
  );
  plugin.handleTool(ctx, data, 'recallwatch.claim.amend', {
    id: 'clm-fan-dev',
    patch: { shipping_address: '22 Dock Rd, Parcel Desk, Exampleton, NY 10000' },
  });
  const amended = plugin.handleTool(ctx, data, 'recallwatch.claim.get', { id: 'clm-fan-dev' }).result.item;
  assert.equal(amended.status, 'submitted');
  assert.equal(amended.shipping_address, '22 Dock Rd, Parcel Desk, Exampleton, NY 10000');

  // Terminal claims (approved_refund, withdrawn) cannot be amended or withdrawn
  assert.throws(
    () => plugin.handleTool(ctx, data, 'recallwatch.claim.amend', { id: 'clm-approved-kibble', patch: { notes: 'late' } }),
    (err) => err.code === 'invalid_state_transition'
  );
  assert.throws(
    () => plugin.handleTool(ctx, data, 'recallwatch.claim.withdraw', { id: 'clm-withdrawn-highchair' }),
    (err) => err.code === 'invalid_state_transition'
  );
});

test('watchlist pause_until evaluates deterministically against virtual time and delete is strict', () => {
  const before = fresh('2026-11-19T08:59:59+00:00');
  const listBefore = plugin.handleTool(before.ctx, before.data, 'recallwatch.watchlist.list', {}).result;
  const effBefore = Object.fromEntries(listBefore.effective_statuses.map((e) => [e.id, e.effective_status]));
  assert.equal(effBefore['wl-pet-food'], 'paused');

  const after = fresh('2026-11-20T09:00:00+00:00');
  const listAfter = plugin.handleTool(after.ctx, after.data, 'recallwatch.watchlist.list', {}).result;
  const effAfter = Object.fromEntries(listAfter.effective_statuses.map((e) => [e.id, e.effective_status]));
  assert.equal(effAfter['wl-pet-food'], 'active');

  plugin.handleTool(after.ctx, after.data, 'recallwatch.watchlist.delete', { id: 'wl-pet-food' });
  assert.throws(
    () => plugin.handleTool(after.ctx, after.data, 'recallwatch.watchlist.delete', { id: 'wl-pet-food' }),
    (err) => err.code === 'not_found'
  );
});

test('all four Infra events apply deterministically and publisher builds valid CloudEvents envelope', () => {
  const { ctx, data } = fresh();
  plugin.applyEvent(ctx, data, {
    event_id: 'evt-pub-1',
    at: '2026-11-18T14:00:00+00:00',
    operation: 'recall.publish',
    payload: {
      recall_id: 'RW-2026-099',
      brand: 'AeroChef',
      upc: '998877665544',
      severity: 'class_ii',
      hazard: 'lid_gasket_leak',
      affected_lots: ['LOT-AC1'],
      remedy_types: ['repair_kit'],
      remedy_deadline_at: '2026-12-20T23:59:59+00:00',
    },
  });
  plugin.applyEvent(ctx, data, {
    event_id: 'evt-exp-1',
    at: '2026-11-18T15:00:00+00:00',
    operation: 'recall.expand_lots',
    payload: { recall_id: 'RW-2026-099', added_lots: ['LOT-AC2'], reason: 'Second shift affected' },
  });
  plugin.applyEvent(ctx, data, {
    event_id: 'evt-amd-1',
    at: '2026-11-18T16:00:00+00:00',
    operation: 'recall.amend_or_close',
    payload: { recall_id: 'RW-2026-099', status: 'amended', excluded_lots: ['LOT-AC2-REV2'] },
  });
  plugin.applyEvent(ctx, data, {
    event_id: 'evt-dec-1',
    at: '2026-11-18T17:00:00+00:00',
    operation: 'claim.decision',
    payload: { claim_id: 'clm-submitted-stroller', decision: 'approved_repair_kit', note: 'Kit dispatched' },
  });

  const decided = plugin.handleTool(ctx, data, 'recallwatch.claim.get', { id: 'clm-submitted-stroller' }).result.item;
  assert.equal(decided.status, 'approved_repair_kit');

  const wire = publisher.claimNotification(decided, {
    sourceAccount: 'acct-priya',
    recipient: { kind: 'person_ref', id: 'person-priya' },
  });
  assert.equal(wire.specversion, '1.0');
  assert.equal(wire.type, 'org.pale.mail.notification.v1');
  assert.equal(wire.dataschema, 'urn:pale:email-payload:1');
  assert.deepEqual(wire.data.content.asset_ids, []);
  assert.deepEqual(wire.data.extensions, []);
});

test('reviewer renderer escapes untrusted HTML content', () => {
  const html = view.render([{ id: 'rw-xss', product_name: '<script>alert(1)</script>' }]);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});
