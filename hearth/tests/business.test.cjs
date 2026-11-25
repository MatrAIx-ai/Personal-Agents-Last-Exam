const test = require('node:test');
const assert = require('node:assert/strict');
const seedFixture = require('../fixtures/seed.json');
const { handleToolCall, handleEvent } = require('../src/operations.cjs');

test('Hearth Business Rules', async (t) => {
  let state;

  t.beforeEach(() => {
    state = JSON.parse(JSON.stringify(seedFixture));
  });

  await t.test('Rule: item_already_disposed when moving or disposing a disposed item', () => {
    const ctx = { virtual_now: '2026-02-01T10:00:00Z' };

    // Dispose item
    const res1 = handleToolCall(
      'hearth.dispose_item',
      {
        item_id: 'item_desk_01',
        reason: 'Broken leg',
        expected_version: state.version,
        request_id: 'req_disp_1',
      },
      state,
      ctx
    );
    assert.equal(res1.result.success, true);
    assert.equal(res1.result.item.status, 'disposed');
    state = res1.state; // Chain state

    // Attempting to move the disposed item must return item_already_disposed
    const res2 = handleToolCall(
      'hearth.update_item_placement',
      {
        item_id: 'item_desk_01',
        room_id: 'room_living',
        coordinates: [10, 10],
        expected_version: res1.result.committed_version,
        request_id: 'req_move_2',
      },
      state,
      ctx
    );
    assert.equal(res2.result.error_code, 'item_already_disposed');
  });

  await t.test('Rule: invalid_issue_state when resolving already closed issue', () => {
    const ctx = { virtual_now: '2026-02-01T10:00:00Z' };

    // Report issue
    const rep = handleToolCall(
      'hearth.report_maintenance_issue',
      {
        appliance_id: 'item_refrigerator_01',
        description: 'Compressor buzzing',
        severity: 'minor',
        expected_version: state.version,
        request_id: 'req_rep_1',
      },
      state,
      ctx
    );
    assert.equal(rep.result.success, true);
    const issueId = rep.result.issue.id;
    state = rep.state; // Chain state

    // Resolve issue
    const res1 = handleToolCall(
      'hearth.resolve_maintenance_issue',
      {
        issue_id: issueId,
        resolution_notes: 'Replaced relay',
        cost_usd: 85.0,
        expected_version: rep.result.committed_version,
        request_id: 'req_res_1',
      },
      state,
      ctx
    );
    assert.equal(res1.result.success, true);
    state = res1.state; // Chain state

    // Attempting to resolve again must fail with invalid_issue_state
    const res2 = handleToolCall(
      'hearth.resolve_maintenance_issue',
      {
        issue_id: issueId,
        resolution_notes: 'Duplicate fix attempt',
        cost_usd: 10.0,
        expected_version: res1.result.committed_version,
        request_id: 'req_res_2',
      },
      state,
      ctx
    );
    assert.equal(res2.result.error_code, 'invalid_issue_state');
  });

  await t.test('Rule: budget_exceeded when purchase exceeds remaining cap', () => {
    const ctx = { virtual_now: '2026-02-01T10:00:00Z' };
    // Total cap is 2000, spent is 350 -> available is 1650
    const overBudgetRes = handleToolCall(
      'hearth.request_purchase',
      {
        item_name: 'Luxury Designer Sofa',
        category: 'furniture',
        target_room_id: 'room_living',
        cost_usd: 1700.0,
        expected_version: state.version,
        request_id: 'req_over_1',
      },
      state,
      ctx
    );
    assert.equal(overBudgetRes.result.error_code, 'budget_exceeded');
  });

  await t.test('Rule: expiry releases budget reservation and preserves total spent', () => {
    const ctx1 = { virtual_now: '2026-03-01T10:00:00Z' };

    // Request valid purchase of $300
    const req = handleToolCall(
      'hearth.request_purchase',
      {
        item_name: 'Guest Futon',
        category: 'furniture',
        target_room_id: 'room_bedroom_2',
        cost_usd: 300.0,
        expected_version: state.version,
        request_id: 'req_futon_1',
      },
      state,
      ctx1
    );
    assert.equal(req.result.success, true);
    state = req.state; // Chain state: budget.reserved is now 300

    // Advance virtual clock past 48 hours (to 72 hours later)
    const ctx2 = { virtual_now: '2026-03-04T10:00:00Z' };

    // Read tool must dynamically derive 'expired' without error
    const propertyRead = handleToolCall('hearth.get_property', {}, state, ctx2);
    assert.equal(propertyRead.result.budget.spent, 350.0); // original spent unchanged

    // A write operation commits the expiry and releases reserved budget
    const reportRes = handleToolCall(
      'hearth.report_maintenance_issue',
      {
        appliance_id: 'item_refrigerator_01',
        description: 'Light bulb out',
        severity: 'minor',
        expected_version: req.result.committed_version,
        request_id: 'req_rep_bulb',
      },
      state,
      ctx2
    );
    assert.equal(reportRes.result.success, true);
    // After committing derived state, the 300 reservation is released back to 0
    assert.equal(reportRes.state.budget.reserved, 0.0);
  });
});
