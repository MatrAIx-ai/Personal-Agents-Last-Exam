'use strict';

const {
  fail,
  parseIso,
  addHours,
  commitDueTransitions,
  recomputeCardStatus,
} = require('./common.cjs');

function applyEvent(ctx, data, event) {
  const at = event.at;
  parseIso(at, 'event.at');
  commitDueTransitions(data, at);
  const p = event.payload || {};

  switch (event.operation) {
    case 'hold.ready_for_pickup': {
      if (!p.pickup_expires_at) {
        throw fail('invalid_event', 'hold.ready_for_pickup requires payload.pickup_expires_at.');
      }
      parseIso(p.pickup_expires_at, 'payload.pickup_expires_at');

      let hold = null;
      if (p.hold_id) {
        hold = (data.holds || []).find((h) => h.id === p.hold_id) || null;
        if (!hold) {
          throw fail('invalid_event', `hold.ready_for_pickup could not find hold '${p.hold_id}'.`, { hold_id: p.hold_id });
        }
        if (hold.status === 'suspended') {
          throw fail('invalid_event', `Hold '${hold.id}' is suspended until ${hold.resume_at} and cannot become ready_for_pickup.`, {
            hold_id: hold.id,
            status: hold.status,
          });
        }
        if (hold.status !== 'queued') {
          throw fail('invalid_event', `Hold '${hold.id}' is in status '${hold.status}' (expected 'queued').`, {
            hold_id: hold.id,
            status: hold.status,
          });
        }
        if (p.pickup_branch_id && hold.pickup_branch_id !== p.pickup_branch_id) {
          throw fail('invalid_event', `Hold '${hold.id}' was re-routed to '${hold.pickup_branch_id}', not '${p.pickup_branch_id}'.`, {
            hold_id: hold.id,
            actual_branch_id: hold.pickup_branch_id,
            event_branch_id: p.pickup_branch_id,
          });
        }
      } else if (p.title_id && p.card_id && p.pickup_branch_id) {
        const candidates = (data.holds || [])
          .filter((h) => h.status === 'queued' && h.title_id === p.title_id && h.card_id === p.card_id && h.pickup_branch_id === p.pickup_branch_id)
          .sort((a, b) => Date.parse(a.placed_at) - Date.parse(b.placed_at));
        hold = candidates[0] || null;
        if (!hold) {
          throw fail('invalid_event', 'No active queued hold matches {title_id, card_id, pickup_branch_id}.', {
            title_id: p.title_id,
            card_id: p.card_id,
            pickup_branch_id: p.pickup_branch_id,
          });
        }
      } else {
        throw fail('invalid_event', 'hold.ready_for_pickup requires hold_id or {title_id, card_id, pickup_branch_id}.');
      }

      hold.status = 'ready_for_pickup';
      hold.ready_at = at;
      hold.pickup_expires_at = p.pickup_expires_at;
      hold.history = hold.history || [];
      hold.history.push({ at, action: 'ready_for_pickup', event_id: event.event_id, pickup_expires_at: p.pickup_expires_at });
      const title = (data.titles || []).find((t) => t.id === hold.title_id);
      if (title && title.queued_patrons > 0) title.queued_patrons -= 1;
      return data;
    }

    case 'hold.checked_out': {
      if (!p.loan_id || !p.due_at) {
        throw fail('invalid_event', 'hold.checked_out requires payload.loan_id and payload.due_at.');
      }
      parseIso(p.due_at, 'payload.due_at');
      if ((data.loans || []).some((l) => l.id === p.loan_id)) {
        throw fail('invalid_event', `Loan '${p.loan_id}' already exists.`);
      }
      let hold = null;
      if (p.hold_id) {
        hold = (data.holds || []).find((h) => h.id === p.hold_id) || null;
      } else if (p.title_id && p.card_id) {
        hold = (data.holds || []).find((h) => h.status === 'ready_for_pickup' && h.title_id === p.title_id && h.card_id === p.card_id) || null;
      }
      if (!hold || hold.status !== 'ready_for_pickup') {
        throw fail('invalid_event', 'hold.checked_out requires an active ready_for_pickup hold.');
      }
      hold.status = 'checked_out';
      hold.history = hold.history || [];
      hold.history.push({ at, action: 'checked_out', event_id: event.event_id, loan_id: p.loan_id });
      const loan = {
        id: p.loan_id,
        title_id: hold.title_id,
        card_id: hold.card_id,
        branch_id: hold.pickup_branch_id,
        checked_out_at: at,
        due_at: p.due_at,
        returned_at: null,
        returned_branch_id: null,
        status: 'active',
        renewals_used: 0,
        note: p.note || null,
        history: [{ at, action: 'checked_out', event_id: event.event_id, hold_id: hold.id }],
      };
      data.loans.push(loan);
      return data;
    }

    case 'loan.returned': {
      const loan = (data.loans || []).find((l) => l.id === p.loan_id);
      if (!loan) throw fail('invalid_event', `Loan '${p.loan_id}' not found.`);
      if (loan.status === 'returned') throw fail('invalid_event', `Loan '${loan.id}' is already returned.`);
      if (p.branch_id && !(data.branches || []).some((b) => b.id === p.branch_id)) {
        throw fail('invalid_event', `Unknown branch '${p.branch_id}'.`);
      }
      loan.status = 'returned';
      loan.returned_at = at;
      loan.returned_branch_id = p.branch_id || loan.branch_id;
      loan.note = p.note || loan.note;
      loan.history = loan.history || [];
      loan.history.push({ at, action: 'returned', event_id: event.event_id, branch_id: loan.returned_branch_id, note: p.note || null });
      return data;
    }

    case 'loan.queue_pressure': {
      const title = (data.titles || []).find((t) => t.id === p.title_id);
      if (!title) throw fail('invalid_event', `Title '${p.title_id}' not found.`);
      if (!Number.isInteger(p.queued_patrons) || p.queued_patrons < 0) {
        throw fail('invalid_event', 'queued_patrons must be a non-negative integer.');
      }
      title.queued_patrons = p.queued_patrons;
      return data;
    }

    case 'fine.assess': {
      if (!p.fine_id || !p.card_id || !Number.isInteger(p.amount_cents) || p.amount_cents <= 0 || !p.reason) {
        throw fail('invalid_event', 'fine.assess requires fine_id, card_id, positive integer amount_cents, and reason.');
      }
      const card = (data.managed_cards || []).find((c) => c.id === p.card_id);
      if (!card) throw fail('invalid_event', `Card '${p.card_id}' not found.`);
      if ((data.fines || []).some((f) => f.id === p.fine_id)) {
        throw fail('invalid_event', `Fine '${p.fine_id}' already exists.`);
      }
      const fine = {
        id: p.fine_id,
        card_id: card.id,
        loan_id: p.loan_id || null,
        amount_cents: p.amount_cents,
        reason: p.reason,
        status: 'open',
        assessed_at: at,
        paid_at: null,
        payment_receipt_id: null,
        dispute_reason: null,
        dispute_note: null,
        decision_note: null,
        history: [{ at, action: 'assessed', event_id: event.event_id, amount_cents: p.amount_cents }],
      };
      data.fines.push(fine);
      const cardStatus = recomputeCardStatus(data, card.id);
      return data;
    }

    case 'fine.dispute_decided': {
      if (!p.fine_id || !['waived', 'open'].includes(p.decision)) {
        throw fail('invalid_event', 'fine.dispute_decided requires fine_id and decision ("waived" or "open").');
      }
      const fine = (data.fines || []).find((f) => f.id === p.fine_id);
      if (!fine) throw fail('invalid_event', `Fine '${p.fine_id}' not found.`);
      if (fine.status !== 'disputed') {
        throw fail('invalid_event', `Fine '${fine.id}' is in status '${fine.status}'; dispute decision requires 'disputed' status.`, {
          fine_id: fine.id,
          status: fine.status,
        });
      }
      fine.status = p.decision;
      fine.decision_note = p.note || null;
      fine.history = fine.history || [];
      fine.history.push({ at, action: 'dispute_decided', event_id: event.event_id, decision: p.decision, note: p.note || null });
      const cardStatus = recomputeCardStatus(data, fine.card_id);
      return data;
    }

    case 'branch.closure': {
      if (!p.branch_id || !p.closed_until) {
        throw fail('invalid_event', 'branch.closure requires branch_id and closed_until.');
      }
      const closedUntilMs = parseIso(p.closed_until, 'payload.closed_until');
      const branch = (data.branches || []).find((b) => b.id === p.branch_id);
      if (!branch) throw fail('invalid_event', `Branch '${p.branch_id}' not found.`);
      branch.closed_until = p.closed_until;
      branch.closure_reason = p.reason || 'Temporary branch closure';

      const extendedHoldIds = [];
      const newDeadline = addHours(p.closed_until, 48);
      for (const hold of data.holds || []) {
        if (hold.pickup_branch_id !== branch.id || hold.status !== 'ready_for_pickup') continue;
        hold.closure_event_ids = hold.closure_event_ids || [];
        if (hold.closure_event_ids.includes(event.event_id)) continue;
        if (!hold.pickup_expires_at || Date.parse(hold.pickup_expires_at) <= closedUntilMs) {
          hold.pickup_expires_at = newDeadline;
          hold.closure_event_ids.push(event.event_id);
          hold.history = hold.history || [];
          hold.history.push({
            at,
            action: 'pickup_extended_branch_closure',
            event_id: event.event_id,
            new_pickup_expires_at: newDeadline,
          });
          extendedHoldIds.push(hold.id);
        }
      }

      const cancelledBookingIds = [];
      const eventStartMs = Date.parse(at);
      for (const b of data.room_bookings || []) {
        if (b.branch_id !== branch.id || b.status !== 'confirmed') continue;
        const bStart = Date.parse(b.start_at);
        const bEnd = Date.parse(b.end_at);
        if (bStart < closedUntilMs && bEnd > eventStartMs) {
          b.status = 'cancelled';
          b.late_cancellation = false;
          b.waived_by_closure = true;
          b.note = `Cancelled due to branch closure: ${branch.closure_reason}`;
          b.history = b.history || [];
          b.history.push({ at, action: 'cancelled_branch_closure', event_id: event.event_id });
          cancelledBookingIds.push(b.id);
        }
      }

      return data;
    }

    case 'room_booking.no_show': {
      const booking = (data.room_bookings || []).find((b) => b.id === p.booking_id);
      if (!booking) throw fail('invalid_event', `Booking '${p.booking_id}' not found.`);
      if (booking.status !== 'confirmed') {
        throw fail('invalid_event', `Booking '${booking.id}' is in status '${booking.status}' (expected 'confirmed').`);
      }
      booking.status = 'no_show';
      booking.note = p.note || 'Room unoccupied past check-in window';
      booking.history = booking.history || [];
      booking.history.push({ at, action: 'no_show', event_id: event.event_id, note: booking.note });
      return data;
    }

    default:
      throw fail('invalid_event', `Unsupported ShelfMark event operation '${event.operation}'.`, { operation: event.operation });
  }
}

module.exports = { applyEvent };
