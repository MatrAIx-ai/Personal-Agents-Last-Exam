'use strict';

const c = require('./common.cjs');

function applyEvent(ctx, data, event) {
  const op = event.operation;
  const p = event.payload || {};
  const at = event.at;
  c.parseMs(at);
  c.syncVirtualExpirations(data, at);

  if (op === 'waitlist.spot_opened') {
    const enr = data.enrollments.find((x) => x.id === p.enrollment_id);
    if (!enr) c.fail('invalid_event', `Unknown enrollment_id: ${p.enrollment_id}`);
    if (enr.status !== 'waitlisted') {
      c.fail('invalid_event', `Cannot issue offer for enrollment in status: ${enr.status}`);
    }
    enr.status = 'offer_pending';
    enr.offer_expires_at = p.offer_expires_at;
    c.stamp(enr, at, 'offer_issued', p.note || `Expires ${p.offer_expires_at}`);
    return data;
  }

  if (op === 'facility.weather_closure') {
    const fac = data.facilities.find((x) => x.id === p.facility_id);
    if (!fac) c.fail('invalid_event', `Unknown facility_id: ${p.facility_id}`);
    fac.status = 'closed_weather';
    fac.closed_until = p.closed_until;
    fac.closure_reason = p.reason;
    const untilMs = c.parseMs(p.closed_until);
    for (const s of data.court_slots) {
      if (s.facility_id === fac.id && c.parseMs(s.starts_at) <= untilMs) {
        s.status = 'closed_weather';
      }
    }
    for (const b of data.court_bookings) {
      if (b.facility_id === fac.id && b.status === 'confirmed' && c.parseMs(b.starts_at) <= untilMs) {
        b.status = 'credited_closure';
        b.refunded_cents = b.fee_paid_cents;
        data.household_credit_cents += b.fee_paid_cents;
        c.stamp(b, at, 'credited_closure', p.reason);
      }
    }
    return data;
  }

  if (op === 'member.waiver_status_changed') {
    const member = data.members.find((m) => m.person_ref === p.person_ref);
    if (!member) c.fail('invalid_event', `Unknown person_ref: ${p.person_ref}`);
    const existing = member.waivers.find((w) => w.waiver_type === p.waiver_type);
    if (existing) {
      existing.status = p.status;
      existing.updated_at = at;
    } else {
      member.waivers.push({ waiver_type: p.waiver_type, status: p.status, updated_at: at });
    }
    return data;
  }

  if (op === 'program.schedule_changed') {
    const prg = data.programs.find((x) => x.id === p.program_id);
    if (!prg) c.fail('invalid_event', `Unknown program_id: ${p.program_id}`);
    prg.schedule_text = p.new_time_slot;
    prg.penalty_free_until = p.penalty_free_until;
    c.stamp(prg, at, 'schedule_changed', `Moved to ${p.new_time_slot}`);
    return data;
  }

  c.fail('invalid_event', `Unsupported Trailhead event operation: ${op}`);
}

module.exports = { applyEvent };
