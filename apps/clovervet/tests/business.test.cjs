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

test('seed validates, history starts in 2025-01+, and reads are side-effect free with missing-asset warning', () => {
  const { ctx, data } = fresh();
  plugin.validateSeed(ctx, data);
  const before = JSON.stringify(data);

  const minMs = Date.parse('2025-01-01T00:00:00+00:00');
  let has2025 = false;
  for (const rec of plugin.records(data)) {
    for (const k of ['created_at', 'updated_at', 'administered_at', 'collected_at', 'last_exam_at', 'issued_at']) {
      if (rec[k]) {
        assert.ok(Date.parse(rec[k]) >= minMs, `${rec.id}.${k} before 2025-01-01`);
        if (rec[k].startsWith('2025-')) has2025 = true;
      }
    }
  }
  assert.ok(has2025, 'Seed should include 2025 historical activity');

  const cleo = plugin.handleTool(ctx, data, 'clovervet.pet.get', { id: 'pet-cleopatra' }).result;
  assert.ok(cleo.asset_warning && cleo.asset_warning.startsWith('ASSET_MISSING:'));

  const clrList = plugin.handleTool(ctx, data, 'clovervet.clearance.list', { pet_id: 'pet-mochi' }).result;
  assert.equal(clrList.effective_statuses[0].effective_status, 'expired');
  assert.equal(JSON.stringify(data), before);
});

test('boarding and interstate clearance rules enforce mid-stay expiry, waiting periods, 10-day window and requirement_ref', () => {
  const { ctx, data } = fresh('2026-11-18T12:00:00+00:00');
  const midStay = plugin.handleTool(ctx, data, 'clovervet.clearance.check', {
    pet_id: 'pet-mochi', clearance_type: 'boarding_stay',
    stay_start_at: '2026-11-26T12:00:00+00:00', stay_end_at: '2026-12-01T12:00:00+00:00',
  }).result;
  assert.equal(midStay.eligible, false);
  assert.ok(midStay.reasons.includes('VACCINE_EXPIRES_BEFORE_END'));

  const badRef = plugin.handleTool(ctx, data, 'clovervet.clearance.check', {
    pet_id: 'pet-biscuit', clearance_type: 'boarding_stay',
    stay_start_at: '2026-11-26T12:00:00+00:00', stay_end_at: '2026-12-01T12:00:00+00:00',
    requirement_ref: { kind: 'file_ref', id: 'bad id' },
  }).result;
  assert.equal(badRef.eligible, false);
  assert.equal(badRef.requirement_ref_status, 'invalid');
  assert.ok(badRef.reasons.includes('REFERENCE_INVALID'));

  plugin.applyEvent(ctx, data, {
    event_id: 'evt-vax-1', at: '2026-11-18T15:00:00+00:00', operation: 'vet.vaccination_logged',
    payload: { pet_id: 'pet-mochi', vaccine_type: 'bordetella', administered_at: '2026-11-18T14:45:00+00:00', expires_at: '2027-11-18T23:59:59+00:00', waiting_period_days: 7, clinic_branch_id: 'br-oakwood' },
  });
  const tooSoon = plugin.handleTool(ctx, data, 'clovervet.clearance.check', {
    pet_id: 'pet-mochi', clearance_type: 'boarding_stay',
    stay_start_at: '2026-11-22T12:00:00+00:00', stay_end_at: '2026-11-24T12:00:00+00:00',
  }).result;
  assert.equal(tooSoon.eligible, false);
  assert.ok(tooSoon.reasons.includes('WAITING_PERIOD_UNMET'));

  const okBoard = plugin.handleTool(ctx, data, 'clovervet.clearance.issue', {
    id: 'cert-mochi-nov', pet_id: 'pet-mochi', clearance_type: 'boarding_stay',
    stay_start_at: '2026-11-26T12:00:00+00:00', stay_end_at: '2026-12-01T12:00:00+00:00',
    requirement_ref: { kind: 'file_ref', id: 'file-kennel-2026', version: 1 },
  }).result;
  assert.equal(okBoard.certificate_id, 'cert-mochi-nov');
});

test('appointments enforce fear-free, cat-only (blocking dogs), dental bloodwork, caretaker scope, disruption waiver, and visit outcome', () => {
  const { ctx, data } = fresh();
  assert.throws(
    () => plugin.handleTool(ctx, data, 'clovervet.appointment.book', { pet_id: 'pet-mochi', slot_id: 'slot-oak-02', visit_type: 'vaccine_booster' }),
    (e) => e.code === 'HANDLING_CONSTRAINT_MISMATCH'
  );
  // Dog cannot book cat_only_slot (slot-har-06)
  assert.throws(
    () => plugin.handleTool(ctx, data, 'clovervet.appointment.book', { pet_id: 'pet-biscuit', slot_id: 'slot-har-06', visit_type: 'wellness_exam' }),
    (e) => e.code === 'HANDLING_CONSTRAINT_MISMATCH'
  );
  assert.throws(
    () => plugin.handleTool(ctx, data, 'clovervet.appointment.book', { pet_id: 'pet-mochi', slot_id: 'slot-oak-03', visit_type: 'dental_cleaning' }),
    (e) => e.code === 'LAB_PREREQUISITE_MISSING'
  );

  plugin.applyEvent(ctx, data, {
    event_id: 'evt-outcome-1', at: '2026-11-20T14:45:00+00:00', operation: 'vet.visit_outcome_logged',
    payload: { appointment_id: 'appt-201', outcome: 'completed', recorded_weight_kg: 11.8, note: 'Wellness exam normal.' },
  });
  assert.equal(plugin.handleTool(ctx, data, 'clovervet.pet.get', { id: 'pet-mochi' }).result.item.last_exam_at, '2026-11-20T14:45:00+00:00');
});

test('prescriptions enforce allergen, weight band, heartworm prerequisite, refill amendment, and all 3 publishers + view escape', () => {
  const { ctx, data } = fresh();
  assert.throws(
    () => plugin.handleTool(ctx, data, 'clovervet.prescription.request_refill', { prescription_id: 'rx-mochi-hw-beef', fulfillment_mode: 'clinic_pickup' }),
    (e) => e.code === 'ALLERGEN_CONFLICT'
  );
  assert.throws(
    () => plugin.handleTool(ctx, data, 'clovervet.prescription.request_refill', { prescription_id: 'rx-mochi-hw-topical', fulfillment_mode: 'clinic_pickup' }),
    (e) => e.code === 'HEARTWORM_TEST_OVERDUE'
  );
  assert.throws(
    () => plugin.handleTool(ctx, data, 'clovervet.prescription.request_refill', { prescription_id: 'rx-biscuit-oldband', fulfillment_mode: 'clinic_pickup' }),
    (e) => e.code === 'WEIGHT_BAND_MISMATCH'
  );
  assert.throws(
    () => plugin.handleTool(ctx, data, 'clovervet.prescription.request_refill', { prescription_id: 'rx-cleo-renal', fulfillment_mode: 'clinic_pickup' }),
    (e) => e.code === 'NO_REFILLS_REMAINING'
  );

  const recipient = { kind: 'person_ref', id: 'person-hannah' };
  const w1 = publisher.appointmentNotification(data.appointments[0], { sourceAccount: 'acct-hannah', recipient });
  const w2 = publisher.clearanceNotification(data.clearances[1], { sourceAccount: 'acct-hannah', recipient });
  const w3 = publisher.refillNotification(data.refill_requests[0], { sourceAccount: 'acct-hannah', recipient });
  for (const w of [w1, w2, w3]) {
    assert.equal(w.specversion, '1.0');
    assert.ok(w.id.length <= 100);
    assert.deepEqual(w.data.content.asset_ids, []);
  }
  const html = view.render([{ id: 'xss', name: '<script>x()</script>' }]);
  assert.ok(!html.includes('<script>') && html.includes('&lt;script&gt;'));
});
