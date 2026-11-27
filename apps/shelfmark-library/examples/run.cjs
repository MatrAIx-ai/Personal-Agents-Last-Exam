'use strict';

const fs = require('node:fs');
const path = require('node:path');
const plugin = require('../plugin.cjs');

const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/minimal.json'), 'utf8'));
const clock = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/clock.json'), 'utf8'));
const scenario = JSON.parse(fs.readFileSync(path.join(__dirname, 'scenario.json'), 'utf8'));

let data = structuredClone(seed);
const ctx = { virtual_now: clock.now };

// 1. Dispute Leo's erroneous fine for already-returned book ln-301
const disputed = plugin.handleTool(ctx, data, 'shelfmark-library.fine.dispute', {
  fine_id: 'fin-201',
  reason: 'Returned in Westside drop box on 2026-10-16',
  expected_version: { epoch: 1, revision: 0 },
  request_id: 'ex-dispute-1',
});
data = disputed.data;

// 2. Apply scenario.json event (hold.ready_for_pickup via composite key) + branch.closure
ctx.virtual_now = scenario.at;
data = plugin.applyEvent(ctx, data, scenario);
ctx.virtual_now = '2026-11-20T07:00:00+00:00';
data = plugin.applyEvent(ctx, data, {
  event_id: 'evt-lib-002',
  at: '2026-11-20T07:00:00+00:00',
  operation: 'branch.closure',
  payload: {
    branch_id: 'br-westside',
    closed_until: '2026-11-22T09:00:00+00:00',
    reason: 'HVAC maintenance',
  },
});

// 3. Apply dispute resolution event to unblock Leo's card
data = plugin.applyEvent(ctx, data, {
  event_id: 'evt-lib-004',
  at: '2026-11-20T12:00:00+00:00',
  operation: 'fine.dispute_decided',
  payload: {
    fine_id: 'fin-201',
    decision: 'waived',
    note: 'Westside drop-box return confirmed on 2026-10-16',
  },
});

const cards = plugin.handleTool(ctx, data, 'shelfmark-library.card.list', { card_id: 'card-leo' }).result.cards[0];
const hold = plugin.handleTool(ctx, data, 'shelfmark-library.hold.get', { hold_id: 'hld-402' }).result.hold;
const booking = plugin.handleTool(ctx, data, 'shelfmark-library.room.list_bookings', {}).result.bookings.find((b) => b.id === 'rmb-201');

console.log(
  JSON.stringify(
    {
      hold_id: hold.id,
      hold_status: hold.status,
      extended_pickup_expires_at: hold.pickup_expires_at,
      westside_booking_status: booking.status,
      westside_booking_late_cancel: booking.late_cancellation,
      leo_card_status: cards.card_status,
      leo_open_fines_cents: cards.open_fines_cents,
    },
    null,
    2
  )
);
