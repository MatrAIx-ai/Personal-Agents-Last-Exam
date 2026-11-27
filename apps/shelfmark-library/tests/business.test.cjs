'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const publisher = require('../src/publisher.cjs');
const view = require('../gui/src/view.js');

const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/minimal.json'), 'utf8'));
const clock = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/clock.json'), 'utf8'));

function fresh() {
  return {
    data: structuredClone(seed),
    ctx: {
      virtual_now: clock.now,
      binding: { account_id: 'acct-maya', owner_person_id: 'person-maya' },
      assets: {
        read(assetId) {
          if (assetId === 'asset-missing-map') {
            const err = new Error('missing');
            err.code = 'unavailable';
            throw err;
          }
          return Buffer.from('ok');
        },
      },
    },
  };
}

test('seed validation passes, enforces >= 2026-01-01 date floor, and counts 54 records', () => {
  const { ctx, data } = fresh();
  plugin.validateSeed(ctx, data);
  assert.equal(plugin.records(data).length, 54);
  const bad = structuredClone(data);
  bad.loans[0].checked_out_at = '2025-12-31T23:59:59+00:00';
  assert.throws(() => plugin.validateSeed(ctx, bad), (e) => e.code === 'validation_error');
});

test('catalog search validates branch_id and catalog.get surfaces ASSET_MISSING via ctx.assets.read()', () => {
  const { ctx, data } = fresh();
  const res = plugin.handleTool(ctx, data, 'shelfmark-library.catalog.search', { format: 'library_of_things' });
  assert.equal(res.result.total, 3);
  assert.throws(
    () => plugin.handleTool(ctx, data, 'shelfmark-library.catalog.search', { branch_id: 'br-nonexistent' }),
    (e) => e.code === 'validation_error'
  );
  const harbor = plugin.handleTool(ctx, data, 'shelfmark-library.catalog.get', { title_id: 'ttl-911' });
  assert.equal(harbor.result.asset_warnings.length, 1);
  assert.equal(harbor.result.asset_warnings[0].code, 'ASSET_MISSING');
  assert.throws(
    () => plugin.handleTool(ctx, data, 'shelfmark-library.catalog.get', { title_id: 'ttl-nope' }),
    (e) => e.code === 'not_found'
  );
});

test('hold placement, duplicate hold, blocked card, suspension preserving queue rank, and branch redirect', () => {
  const { ctx, data } = fresh();
  // Blocked child card cannot place hold
  assert.throws(
    () => plugin.handleTool(ctx, data, 'shelfmark-library.hold.place', {
      title_id: 'ttl-904',
      card_id: 'card-leo',
      pickup_branch_id: 'br-westside',
      expected_version: 1,
      request_id: 'req-1',
    }),
    (e) => e.code === 'ACCOUNT_BLOCKED'
  );

  // Place valid hold on card-maya
  const placed = plugin.handleTool(ctx, data, 'shelfmark-library.hold.place', {
    title_id: 'ttl-904',
    card_id: 'card-maya',
    pickup_branch_id: 'br-westside',
    expected_version: 1,
    request_id: 'req-2',
  });
  const hid = placed.result.hold_id;
  assert.equal(placed.result.hold.queue_position, 1);

  // Duplicate hold rejected
  assert.throws(
    () => plugin.handleTool(ctx, data, 'shelfmark-library.hold.place', {
      title_id: 'ttl-904',
      card_id: 'card-maya',
      pickup_branch_id: 'br-central',
      expected_version: 2,
      request_id: 'req-3',
    }),
    (e) => e.code === 'DUPLICATE_HOLD'
  );

  // Suspend preserves queue_position
  const susp = plugin.handleTool(ctx, data, 'shelfmark-library.hold.suspend', {
    hold_id: hid,
    resume_at: '2026-11-28T09:00:00+00:00',
    expected_version: 2,
    request_id: 'req-4',
  });
  assert.equal(susp.result.hold.status, 'suspended');
  assert.equal(susp.result.hold.queue_position, 1);

  // hold.ready_for_pickup rejects suspended hold before resume_at
  assert.throws(
    () => plugin.applyEvent(ctx, data, {
      event_id: 'evt-susp-fail',
      at: '2026-11-20T10:00:00+00:00',
      operation: 'hold.ready_for_pickup',
      payload: { hold_id: hid, pickup_expires_at: '2026-11-23T17:00:00+00:00' },
    }),
    (e) => e.code === 'invalid_event'
  );

  // Redirect branch while suspended, then resume
  plugin.handleTool(ctx, data, 'shelfmark-library.hold.change_branch', {
    hold_id: hid,
    pickup_branch_id: 'br-oakridge',
    expected_version: 3,
    request_id: 'req-5',
  });
  plugin.handleTool(ctx, data, 'shelfmark-library.hold.resume', {
    hold_id: hid,
    expected_version: 4,
    request_id: 'req-6',
  });

  // hold.ready_for_pickup rejects wrong pickup_branch_id after redirect
  assert.throws(
    () => plugin.applyEvent(ctx, data, {
      event_id: 'evt-reroute-fail',
      at: '2026-11-20T11:00:00+00:00',
      operation: 'hold.ready_for_pickup',
      payload: { hold_id: hid, pickup_branch_id: 'br-westside', pickup_expires_at: '2026-11-23T17:00:00+00:00' },
    }),
    (e) => e.code === 'invalid_event'
  );

  // Composite key match on redirected branch succeeds
  plugin.applyEvent(ctx, data, {
    event_id: 'evt-ready-ok',
    at: '2026-11-20T11:30:00+00:00',
    operation: 'hold.ready_for_pickup',
    payload: {
      title_id: 'ttl-904',
      card_id: 'card-maya',
      pickup_branch_id: 'br-oakridge',
      pickup_expires_at: '2026-11-24T17:00:00+00:00',
    },
  });
  const got = plugin.handleTool(ctx, data, 'shelfmark-library.hold.get', { hold_id: hid });
  assert.equal(got.result.hold.status, 'ready_for_pickup');

  // Cannot suspend ready_for_pickup hold
  assert.throws(
    () => plugin.handleTool(ctx, data, 'shelfmark-library.hold.suspend', {
      hold_id: hid,
      resume_at: '2026-11-29T09:00:00+00:00',
      expected_version: 5,
      request_id: 'req-7',
    }),
    (e) => e.code === 'invalid_state_transition'
  );
});

test('virtual-time read derivations do not mutate state until write or event', () => {
  const { ctx, data } = fresh();
  ctx.virtual_now = '2026-11-26T10:00:00+00:00';
  const holds = plugin.handleTool(ctx, data, 'shelfmark-library.hold.list', {}).result.holds;
  const h401 = holds.find((h) => h.id === 'hld-401');
  const h404 = holds.find((h) => h.id === 'hld-404');
  assert.equal(h401.effective_status, 'expired');
  assert.equal(h401.status, 'ready_for_pickup'); // unmutated on read
  assert.equal(h404.effective_status, 'queued');
  assert.equal(h404.status, 'suspended'); // unmutated on read

  const loans = plugin.handleTool(ctx, data, 'shelfmark-library.loan.list', {}).result.loans;
  const l302 = loans.find((l) => l.id === 'ln-302');
  assert.equal(l302.effective_status, 'overdue');
  assert.equal(l302.status, 'active'); // unmutated on read
});

test('loan renewal enforces queue pressure, renewal limit, and offline checkout/return events', () => {
  const { ctx, data } = fresh();
  // ln-302 has 0 queued patrons -> renews cleanly
  const r = plugin.handleTool(ctx, data, 'shelfmark-library.loan.renew', {
    loan_id: 'ln-302',
    expected_version: 1,
    request_id: 'ren-1',
  });
  assert.equal(r.result.loan.renewals_used, 1);

  // ln-303 has queued_patrons=2 -> RENEWAL_BLOCKED_BY_HOLD
  assert.throws(
    () => plugin.handleTool(ctx, data, 'shelfmark-library.loan.renew', {
      loan_id: 'ln-303',
      expected_version: 2,
      request_id: 'ren-2',
    }),
    (e) => e.code === 'RENEWAL_BLOCKED_BY_HOLD'
  );

  // ln-304 already at max_renewals -> RENEWAL_LIMIT_REACHED
  assert.throws(
    () => plugin.handleTool(ctx, data, 'shelfmark-library.loan.renew', {
      loan_id: 'ln-304',
      expected_version: 2,
      request_id: 'ren-3',
    }),
    (e) => e.code === 'RENEWAL_LIMIT_REACHED'
  );

  // hold.checked_out creates a new active loan, then loan.returned closes it
  plugin.applyEvent(ctx, data, {
    event_id: 'evt-co-1',
    at: '2026-11-19T14:00:00+00:00',
    operation: 'hold.checked_out',
    payload: { hold_id: 'hld-401', loan_id: 'ln-401', due_at: '2026-12-10T23:59:59+00:00' },
  });
  plugin.applyEvent(ctx, data, {
    event_id: 'evt-ret-1',
    at: '2026-11-25T15:00:00+00:00',
    operation: 'loan.returned',
    payload: { loan_id: 'ln-401', branch_id: 'br-central', note: 'Returned at Central' },
  });
  const ln401 = data.loans.find((l) => l.id === 'ln-401');
  assert.equal(ln401.status, 'returned');
});

test('fine dispute, dispute_decided rejection on undisputed fine, preview_payment, and card unblocking', () => {
  const { ctx, data } = fresh();
  // Reject fine.dispute_decided on undisputed fine
  assert.throws(
    () => plugin.applyEvent(ctx, data, {
      event_id: 'evt-bad-dec',
      at: '2026-11-19T10:00:00+00:00',
      operation: 'fine.dispute_decided',
      payload: { fine_id: 'fin-201', decision: 'waived' },
    }),
    (e) => e.code === 'invalid_event'
  );

  // Dispute fin-201, then waive via fine.dispute_decided -> Leo's balance drops from 1450 to 250 (< 1000) -> unblocks card!
  plugin.handleTool(ctx, data, 'shelfmark-library.fine.dispute', {
    fine_id: 'fin-201',
    reason: 'Returned via Westside drop box on 2026-10-16',
    expected_version: 1,
    request_id: 'disp-1',
  });
  plugin.applyEvent(ctx, data, {
    event_id: 'evt-waive-201',
    at: '2026-11-20T11:00:00+00:00',
    operation: 'fine.dispute_decided',
    payload: { fine_id: 'fin-201', decision: 'waived', note: 'Drop box verified' },
  });
  const leoAfterWaive = plugin.handleTool(ctx, data, 'shelfmark-library.card.list', { card_id: 'card-leo' }).result.cards[0];
  assert.equal(leoAfterWaive.card_status, 'active');
  assert.equal(leoAfterWaive.open_fines_cents, 250);

  // Preview and pay remaining open fine fin-202
  const preview = plugin.handleTool(ctx, data, 'shelfmark-library.fine.preview_payment', { card_id: 'card-leo' }).result;
  assert.equal(preview.total_cents, 250);
  assert.equal(preview.will_unblock_card, true);
  const paid = plugin.handleTool(ctx, data, 'shelfmark-library.fine.pay', {
    card_id: 'card-leo',
    fine_ids: ['fin-202'],
    expected_version: 2,
    request_id: 'pay-202',
  }).result;
  assert.equal(paid.total_paid_cents, 250);
  assert.equal(paid.remaining_unpaid_cents, 0);

  // Paying already-paid fine with new request_id fails
  assert.throws(
    () => plugin.handleTool(ctx, data, 'shelfmark-library.fine.pay', {
      card_id: 'card-leo',
      fine_ids: ['fin-202'],
      expected_version: 3,
      request_id: 'pay-202-again',
    }),
    (e) => e.code === 'invalid_state_transition'
  );
});

test('branch.closure extends each affected hold once and cancels study-room bookings without late penalty', () => {
  const { ctx, data } = fresh();
  plugin.applyEvent(ctx, data, {
    event_id: 'evt-close-ws',
    at: '2026-11-20T07:00:00+00:00',
    operation: 'branch.closure',
    payload: { branch_id: 'br-westside', closed_until: '2026-11-22T09:00:00+00:00', reason: 'HVAC maintenance' },
  });
  const h401 = data.holds.find((h) => h.id === 'hld-401');
  assert.equal(h401.pickup_expires_at, '2026-11-24T09:00:00.000+00:00');
  const b201 = data.room_bookings.find((b) => b.id === 'rmb-201');
  assert.equal(b201.status, 'cancelled');
  assert.equal(b201.late_cancellation, false);
  assert.equal(b201.waived_by_closure, true);

  // Slot conflict, daily quota, late cancel, and no_show
  const bNew = plugin.handleTool(ctx, data, 'shelfmark-library.room.book', {
    room_id: 'rm-central-a',
    card_id: 'card-maya',
    start_at: '2026-11-23T10:00:00+00:00',
    end_at: '2026-11-23T13:00:00+00:00',
    expected_version: 1,
    request_id: 'rm-book-1',
  }).result;
  assert.throws(
    () => plugin.handleTool(ctx, data, 'shelfmark-library.room.book', {
      room_id: 'rm-central-a',
      card_id: 'card-nora',
      start_at: '2026-11-23T11:00:00+00:00',
      end_at: '2026-11-23T12:00:00+00:00',
      expected_version: 2,
      request_id: 'rm-book-2',
    }),
    (e) => e.code === 'SLOT_CONFLICT'
  );
  // Exceeding 4h daily household study-room quota fails with QUOTA_EXCEEDED
  assert.throws(
    () => plugin.handleTool(ctx, data, 'shelfmark-library.room.book', {
      room_id: 'rm-central-b',
      card_id: 'card-nora',
      start_at: '2026-11-23T14:00:00+00:00',
      end_at: '2026-11-23T16:00:00+00:00',
      expected_version: 2,
      request_id: 'rm-book-3',
    }),
    (e) => e.code === 'QUOTA_EXCEEDED'
  );

  // room_booking.no_show transitions confirmed booking
  plugin.applyEvent(ctx, data, {
    event_id: 'evt-noshow-1',
    at: '2026-11-23T10:20:00+00:00',
    operation: 'room_booking.no_show',
    payload: { booking_id: bNew.booking_id, note: 'Unoccupied 20m past start' },
  });
  assert.equal(data.room_bookings.find((b) => b.id === bNew.booking_id).status, 'no_show');
});

test('publisher handles unknown_outcome with stop_run: true and reviewer view escapes HTML', async () => {
  const unknownRouter = {
    async call() {
      return { status: 'unknown' };
    },
  };
  const msg = publisher.branchClosureNotification('br-westside', {
    closedUntil: '2026-11-22T09:00:00+00:00',
    reason: 'HVAC',
    extendedHoldIds: ['hld-401'],
    cancelledBookingIds: ['rmb-201'],
    sourceAccount: 'acct-maya',
    recipient: { kind: 'person_ref', id: 'person-maya' },
    time: '2026-11-20T07:00:00+00:00',
  });
  const res = await publisher.deliverNotice({ router: unknownRouter, message: msg, requestId: 'req-unk' });
  assert.equal(res.stage, 'unknown_outcome');
  assert.equal(res.stop_run, true);

  const html = view.render([{ id: 'x', title: '<script>alert(1)</script>' }]);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});
