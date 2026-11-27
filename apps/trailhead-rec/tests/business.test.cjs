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

test('seed validates, history starts in 2025-01+, search/emergency-contact update succeed, and pass expiry is derived on read', () => {
  const { ctx, data } = fresh();
  plugin.validateSeed(ctx, data);
  const before = JSON.stringify(data);

  const minMs = Date.parse('2025-01-01T00:00:00+00:00');
  let has2025 = false;
  for (const rec of plugin.records(data)) {
    for (const k of ['created_at', 'updated_at', 'issued_at']) {
      if (rec[k]) {
        assert.ok(Date.parse(rec[k]) >= minMs, `${rec.id}.${k} before 2025-01-01`);
        if (rec[k].startsWith('2025-')) has2025 = true;
      }
    }
  }
  assert.ok(has2025, 'Seed should include 2025 historical records');

  const search = plugin.handleTool(ctx, data, 'trailhead-rec.program.search', { category: 'aquatics', open_only: true }).result;
  assert.ok(search.items.some((p) => p.id === 'prg-lap-swim-am'));

  const missingCard = plugin.handleTool(ctx, data, 'trailhead-rec.program.get', { id: 'prg-pickleball-beg' }).result;
  assert.ok(missingCard.asset_warning && missingCard.asset_warning.startsWith('ASSET_MISSING:'));

  const hh = plugin.handleTool(ctx, data, 'trailhead-rec.household.get', {}).result;
  const passMap = Object.fromEntries(hh.effective_pass_statuses.map((p) => [p.id, p.effective_status]));
  assert.equal(passMap['pass-elena-lap'], 'expired');
  assert.equal(passMap['pass-marcus-gym'], 'active');
  assert.equal(JSON.stringify(data), before);

  plugin.handleTool(ctx, data, 'trailhead-rec.household.update_member', {
    person_ref: 'person-leo',
    patch: { emergency_contact: 'Marcus Vargas (555-0199)' },
  });
  assert.equal(data.members.find((m) => m.person_ref === 'person-leo').emergency_contact, 'Marcus Vargas (555-0199)');
});

test('24h waitlist offer increments enrolled_count, expires after deadline, blocks on withdrawn waiver, and waitlist.spot_opened works', () => {
  const okRun = fresh('2026-11-19T14:59:59+00:00');
  const prgBefore = okRun.data.programs.find((p) => p.id === 'prg-swim-l3-sat').enrolled_count;
  const accepted = plugin.handleTool(okRun.ctx, okRun.data, 'trailhead-rec.enrollment.accept_offer', { id: 'enr-205' }).result;
  assert.equal(accepted.fee_charged_cents, 6500);
  assert.equal(okRun.data.programs.find((p) => p.id === 'prg-swim-l3-sat').enrolled_count, prgBefore + 1);

  // waitlist.spot_opened event (exact proposal name)
  plugin.applyEvent(okRun.ctx, okRun.data, {
    event_id: 'evt-spot-1',
    at: '2026-11-19T15:00:00+00:00',
    operation: 'waitlist.spot_opened',
    payload: { enrollment_id: 'enr-207', offer_expires_at: '2026-11-20T15:00:00+00:00', note: 'Spot opened' },
  });
  assert.equal(okRun.data.enrollments.find((e) => e.id === 'enr-207').status, 'offer_pending');

  const lateRun = fresh('2026-11-19T15:00:01+00:00');
  assert.equal(plugin.handleTool(lateRun.ctx, lateRun.data, 'trailhead-rec.enrollment.get', { id: 'enr-205' }).result.effective_status, 'offer_expired');
  assert.throws(() => plugin.handleTool(lateRun.ctx, lateRun.data, 'trailhead-rec.enrollment.accept_offer', { id: 'enr-205' }), (e) => e.code === 'offer_expired');

  const wRun = fresh('2026-11-19T10:00:00+00:00');
  plugin.applyEvent(wRun.ctx, wRun.data, {
    event_id: 'evt-w-1', at: '2026-11-19T10:00:00+00:00', operation: 'member.waiver_status_changed',
    payload: { person_ref: 'person-leo', waiver_type: 'aquatics_allergy', status: 'withdrawn' },
  });
  assert.throws(() => plugin.handleTool(wRun.ctx, wRun.data, 'trailhead-rec.enrollment.accept_offer', { id: 'enr-205' }), (e) => e.code === 'waiver_consent_required');
});

test('enrollment.transfer, court.booking.modify, dynamic weather-closure recovery, pass depletion, and past-slot guard work', () => {
  const { ctx, data } = fresh();

  // Transfer Elena's yoga enrollment (enr-206, $50) to Pilates ($55 -> +$5 delta)
  const creditBefore = data.household_credit_cents;
  const xfer = plugin.handleTool(ctx, data, 'trailhead-rec.enrollment.transfer', {
    id: 'enr-206', target_program_id: 'prg-pilates-core', new_enrollment_id: 'enr-elena-pilates',
  }).result;
  assert.equal(xfer.fee_delta_cents, 500);
  assert.equal(data.household_credit_cents, creditBefore - 500);
  assert.equal(data.enrollments.find((e) => e.id === 'enr-206').status, 'transferred');
  assert.equal(data.enrollments.find((e) => e.id === 'enr-elena-pilates').status, 'enrolled');

  // Consume Marcus's 1-visit pass at fac-fieldhouse -> pass becomes depleted
  const passBook = plugin.handleTool(ctx, data, 'trailhead-rec.court.book', {
    id: 'bkg-pass-1', slot_id: 'crt-fh-01', person_ref: 'person-marcus', use_pass_id: 'pass-marcus-court',
  }).result;
  assert.equal(passBook.fee_charged_cents, 0);
  assert.equal(data.passes.find((p) => p.id === 'pass-marcus-court').status, 'depleted');

  // Modify confirmed court booking bkg-302 from crt-fh-02 ($28) to crt-fh-05 ($15 -> -$13 credit)
  const mod = plugin.handleTool(ctx, data, 'trailhead-rec.court.booking.modify', {
    id: 'bkg-302', new_slot_id: 'crt-fh-05',
  }).result;
  assert.equal(mod.fee_delta_cents, -1300);
  assert.equal(data.court_slots.find((s) => s.id === 'crt-fh-02').status, 'open');

  // Weather closure closes fac-pinecourts until 2026-11-21T12:00:00+00:00, then reopens cleanly for 2026-11-23 slot crt-pine-08!
  plugin.applyEvent({ binding: baseBinding, virtual_now: '2026-11-20T08:00:00+00:00' }, data, {
    event_id: 'evt-wx-1', at: '2026-11-20T08:00:00+00:00', operation: 'facility.weather_closure',
    payload: { facility_id: 'fac-pinecourts', closed_until: '2026-11-21T12:00:00+00:00', reason: 'Rain' },
  });
  const afterClosureCtx = { binding: baseBinding, virtual_now: '2026-11-22T09:00:00+00:00' };
  const reopenedBook = plugin.handleTool(afterClosureCtx, data, 'trailhead-rec.court.book', {
    id: 'bkg-reopened', slot_id: 'crt-pine-08', person_ref: 'person-marcus',
  }).result;
  assert.equal(reopenedBook.id, 'bkg-reopened');

  // Booking a past slot fails with slot_in_past
  assert.throws(
    () => plugin.handleTool(afterClosureCtx, data, 'trailhead-rec.court.book', { slot_id: 'crt-pine-02', person_ref: 'person-marcus' }),
    (e) => e.code === 'slot_in_past'
  );

  // Publisher & XSS escape
  const wire = publisher.enrollmentNotification(data.enrollments[1], {
    sourceAccount: 'acct-elena', recipient: { kind: 'person_ref', id: 'person-elena' },
  });
  assert.equal(wire.specversion, '1.0');
  const html = view.render([{ id: 'xss', title: '<script>bad()</script>' }]);
  assert.ok(!html.includes('<script>') && html.includes('&lt;script&gt;'));
});
