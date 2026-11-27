'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const seedFixture = require('../fixtures/seed.json');
const houseFixture = require('../fixtures/seeds/household_suburban_house.json');
const flatFixture = require('../fixtures/seeds/household_shared_flat.json');
const plugin = require('../plugin.cjs');
const reviewerView = require('../gui/src/view.js');

test('Hearth Business Rules & Workflows', async (t) => {
  let state;

  t.beforeEach(() => {
    state = JSON.parse(JSON.stringify(seedFixture));
  });

  await t.test('Workflow 1: furniture placement, storage, and item_already_disposed', () => {
    const ctx = { virtual_now: '2026-02-01T10:00:00Z' };

    // Store item -> stored
    const stored = plugin.handleTool(ctx, state, 'hearth.store_item', {
      item_id: 'item_desk_01',
      storage_room_id: 'room_basement_storage',
      expected_version: { epoch: 1, revision: 0 },
      request_id: 'req_store_1',
    });
    assert.equal(stored.result.item.status, 'stored');
    assert.equal(stored.result.item.coordinates, null);
    state = stored.data;

    // Move stored item back to active room -> active
    const moved = plugin.handleTool(ctx, state, 'hearth.update_item_placement', {
      item_id: 'item_desk_01',
      room_id: 'room_bedroom_2',
      coordinates: [100, 180],
      expected_version: { epoch: 1, revision: 1 },
      request_id: 'req_move_1',
    });
    assert.equal(moved.result.item.status, 'active');
    assert.deepEqual(moved.result.item.coordinates, [100, 180]);
    state = moved.data;

    // Dispose item -> disposed
    const disposed = plugin.handleTool(ctx, state, 'hearth.dispose_item', {
      item_id: 'item_desk_01',
      reason: 'Broken leg',
      expected_version: { epoch: 1, revision: 2 },
      request_id: 'req_disp_1',
    });
    assert.equal(disposed.result.item.status, 'disposed');
    state = disposed.data;

    // Attempting to move the disposed item must throw item_already_disposed
    assert.throws(
      () =>
        plugin.handleTool(ctx, state, 'hearth.update_item_placement', {
          item_id: 'item_desk_01',
          room_id: 'room_living',
          coordinates: [10, 10],
          expected_version: { epoch: 1, revision: 3 },
          request_id: 'req_move_2',
        }),
      (err) => err.code === 'item_already_disposed'
    );
  });

  await t.test('Workflow 2: maintenance lifecycle, degraded/broken condition, and invalid_issue_state', () => {
    const ctx = { virtual_now: '2026-02-01T10:00:00Z' };

    const rep = plugin.handleTool(ctx, state, 'hearth.report_maintenance_issue', {
      appliance_id: 'item_refrigerator_01',
      description: 'Compressor buzzing',
      severity: 'minor',
      expected_version: { epoch: 1, revision: 0 },
      request_id: 'req_rep_1',
    });
    const issueId = rep.result.issue.id;
    state = rep.data;
    assert.equal(state.inventory.find((i) => i.id === 'item_refrigerator_01').condition, 'degraded');

    const sched = plugin.handleTool(ctx, state, 'hearth.schedule_maintenance', {
      issue_id: issueId,
      scheduled_date: '2026-02-03',
      service_contact_id: 'contact_tech_01',
      expected_version: { epoch: 1, revision: 1 },
      request_id: 'req_sched_1',
    });
    assert.equal(sched.result.issue.status, 'scheduled');
    state = sched.data;

    const res1 = plugin.handleTool(ctx, state, 'hearth.resolve_maintenance_issue', {
      issue_id: issueId,
      resolution_notes: 'Replaced relay',
      cost_usd: 85.0,
      expected_version: { epoch: 1, revision: 2 },
      request_id: 'req_res_1',
    });
    assert.equal(res1.result.issue.status, 'resolved');
    state = res1.data;
    assert.equal(state.inventory.find((i) => i.id === 'item_refrigerator_01').condition, 'operational');

    assert.throws(
      () =>
        plugin.handleTool(ctx, state, 'hearth.resolve_maintenance_issue', {
          issue_id: issueId,
          resolution_notes: 'Duplicate fix attempt',
          cost_usd: 10.0,
          expected_version: { epoch: 1, revision: 3 },
          request_id: 'req_res_2',
        }),
      (err) => err.code === 'invalid_issue_state'
    );
  });

  await t.test('Workflow 3: budget_exceeded, approval, cancellation, and pure-read expiry', () => {
    const ctx1 = { virtual_now: '2026-03-01T10:00:00Z' };

    // Over budget (cap 2000, spent 350 -> available 1650)
    assert.throws(
      () =>
        plugin.handleTool(ctx1, state, 'hearth.request_purchase', {
          item_name: 'Luxury Designer Sofa',
          category: 'furniture',
          target_room_id: 'room_living',
          cost_usd: 1700.0,
          expected_version: { epoch: 1, revision: 0 },
          request_id: 'req_over_1',
        }),
      (err) => err.code === 'budget_exceeded'
    );

    // Valid purchase + cancel
    const reqCancel = plugin.handleTool(ctx1, state, 'hearth.request_purchase', {
      item_name: 'Desk Lamp',
      category: 'decor',
      target_room_id: 'room_bedroom_2',
      cost_usd: 50.0,
      expected_version: { epoch: 1, revision: 0 },
      request_id: 'req_lamp_1',
    });
    state = reqCancel.data;
    assert.equal(state.budget.reserved, 50.0);

    const cancelled = plugin.handleTool(ctx1, state, 'hearth.cancel_purchase', {
      purchase_id: reqCancel.result.purchase.id,
      expected_version: { epoch: 1, revision: 1 },
      request_id: 'req_cancel_1',
    });
    state = cancelled.data;
    assert.equal(cancelled.result.purchase.status, 'cancelled');
    assert.equal(state.budget.reserved, 0);

    // Valid purchase + approval event
    const reqApprove = plugin.handleTool(ctx1, state, 'hearth.request_purchase', {
      item_name: 'Standing Mat',
      category: 'decor',
      target_room_id: 'room_bedroom_2',
      cost_usd: 75.0,
      expected_version: { epoch: 1, revision: 2 },
      request_id: 'req_mat_1',
    });
    state = reqApprove.data;
    const beforeCount = state.inventory.length;
    state = plugin.applyEvent(ctx1, state, {
      event_id: 'evt_approve_mat',
      at: '2026-03-01T12:00:00Z',
      operation: 'hearth.purchase_approval',
      payload: {
        purchase_id: reqApprove.result.purchase.id,
        decision: 'approved',
        decided_by_person_id: 'person_jane_01',
      },
    });
    assert.equal(state.inventory.length, beforeCount + 1);
    assert.equal(state.budget.spent, 425.0);
    assert.equal(state.budget.reserved, 0);

    // Purchase expiry: pure read derives expired without mutating; next write commits it
    const reqExp = plugin.handleTool(ctx1, state, 'hearth.request_purchase', {
      item_name: 'Guest Futon',
      category: 'furniture',
      target_room_id: 'room_bedroom_2',
      cost_usd: 300.0,
      expected_version: { epoch: 1, revision: 3 },
      request_id: 'req_futon_1',
    });
    state = reqExp.data;
    assert.equal(state.budget.reserved, 300.0);

    const ctx2 = { virtual_now: '2026-03-04T10:00:00Z' };
    const beforeRead = JSON.stringify(state);
    const propertyRead = plugin.handleTool(ctx2, state, 'hearth.get_property', {});
    assert.equal(propertyRead.result.budget.spent, 425.0);
    assert.equal(JSON.stringify(propertyRead.data), beforeRead);

    const reportRes = plugin.handleTool(ctx2, state, 'hearth.report_maintenance_issue', {
      appliance_id: 'item_refrigerator_01',
      description: 'Door seal loose',
      severity: 'minor',
      expected_version: { epoch: 1, revision: 4 },
      request_id: 'req_rep_2',
    });
    const expPurchase = reportRes.data.purchases.find((p) => p.id === reqExp.result.purchase.id);
    assert.equal(expPurchase.status, 'expired');
    assert.equal(reportRes.data.budget.reserved, 0);
    assert.equal(reportRes.data.budget.spent, 425.0);
  });

  await t.test('Workflow 4: resident profile audit and resident_not_found', () => {
    const ctx = { virtual_now: '2026-02-01T10:00:00Z' };
    const res = plugin.handleTool(ctx, state, 'hearth.get_resident_profile', {
      person_id: 'person_jane_01',
    });
    assert.equal(res.result.resident.person_id, 'person_jane_01');
    assert.ok(res.result.resident.rules.length > 0);

    assert.throws(
      () => plugin.handleTool(ctx, state, 'hearth.get_resident_profile', { person_id: 'unknown_person' }),
      (err) => err.code === 'resident_not_found'
    );
  });

  await t.test('Milestone 3: all 3 household seeds are valid, 30-60 items, dated >= 2025-01-01', () => {
    const minTime = Date.parse('2025-01-01T00:00:00Z');
    for (const seed of [seedFixture, houseFixture, flatFixture]) {
      plugin.validateSeed({}, seed);
      assert.ok(seed.inventory.length >= 30 && seed.inventory.length <= 60);
      for (const item of seed.inventory) {
        assert.ok(Date.parse(item.created_at) >= minTime);
      }
    }
  });

  await t.test('Milestone 4: reviewer renderer escapes untrusted HTML', () => {
    const html = reviewerView.render([{ id: 'x1', name: '<img src=x onerror="alert(1)">' }]);
    assert.ok(!html.includes('<img'));
    assert.ok(html.includes('&lt;img'));
  });
});
