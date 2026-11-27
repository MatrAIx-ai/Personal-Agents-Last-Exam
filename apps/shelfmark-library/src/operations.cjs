'use strict';

const {
  fail,
  parseIso,
  addHours,
  addDays,
  nowOf,
  nextId,
  effectiveHoldStatus,
  effectiveLoanStatus,
  isBranchClosedAt,
  commitDueTransitions,
  cardUnpaidBalanceCents,
  recomputeCardStatus,
  assetWarning,
} = require('./common.cjs');

function findById(list, id, label) {
  const item = (list || []).find((x) => x.id === id);
  if (!item) throw fail('not_found', `${label} '${id}' was not found.`, { label, id });
  return item;
}

function enrichHold(data, hold, virtualNow) {
  const title = (data.titles || []).find((t) => t.id === hold.title_id);
  const branch = (data.branches || []).find((b) => b.id === hold.pickup_branch_id);
  return {
    ...hold,
    effective_status: effectiveHoldStatus(hold, virtualNow),
    title_name: title ? title.title : null,
    pickup_branch_name: branch ? branch.name : null,
  };
}

function enrichLoan(data, loan, virtualNow) {
  const title = (data.titles || []).find((t) => t.id === loan.title_id);
  return {
    ...loan,
    effective_status: effectiveLoanStatus(loan, virtualNow),
    title_name: title ? title.title : null,
    max_renewals: title ? title.max_renewals : 0,
    queued_patrons: title ? title.queued_patrons : 0,
  };
}

function handleTool(ctx, data, name, args = {}) {
  const virtualNow = nowOf(ctx);

  switch (name) {
    case 'shelfmark-library.catalog.search': {
      if (args.branch_id && !(data.branches || []).some((b) => b.id === args.branch_id)) {
        throw fail('validation_error', `Unknown branch_id '${args.branch_id}'.`, { branch_id: args.branch_id });
      }
      const q = args.query ? args.query.toLowerCase() : null;
      const author = args.author ? args.author.toLowerCase() : null;
      const subject = args.subject ? args.subject.toLowerCase() : null;
      const matches = (data.titles || []).filter((t) => {
        if (q && !`${t.title} ${t.author} ${t.description || ''} ${(t.subjects || []).join(' ')}`.toLowerCase().includes(q)) return false;
        if (author && !t.author.toLowerCase().includes(author)) return false;
        if (args.isbn && t.isbn !== args.isbn) return false;
        if (args.format && t.format !== args.format) return false;
        if (subject && !(t.subjects || []).some((s) => s.toLowerCase().includes(subject))) return false;
        if (args.branch_id && !(t.copies || []).some((c) => c.branch_id === args.branch_id)) return false;
        if (args.available_only) {
          const relevant = args.branch_id ? (t.copies || []).filter((c) => c.branch_id === args.branch_id) : (t.copies || []);
          if (!relevant.some((c) => c.status === 'available')) return false;
        }
        if (typeof args.max_queue_depth === 'number' && t.queued_patrons > args.max_queue_depth) return false;
        return true;
      });
      return {
        data,
        result: {
          virtual_now: virtualNow,
          branches: (data.branches || []).map((b) => ({
            id: b.id,
            name: b.name,
            closed_now: isBranchClosedAt(b, virtualNow),
            closed_until: b.closed_until,
          })),
          total: matches.length,
          titles: matches,
        },
      };
    }

    case 'shelfmark-library.catalog.get': {
      const title = findById(data.titles, args.title_id, 'title');
      const warnings = [];
      if (title.cover_asset_id) {
        const w = assetWarning(ctx, title.cover_asset_id);
        if (w) warnings.push(w);
      }
      const seenBranches = new Set();
      const branchSummary = [];
      for (const copy of title.copies || []) {
        if (seenBranches.has(copy.branch_id)) continue;
        seenBranches.add(copy.branch_id);
        const branch = (data.branches || []).find((b) => b.id === copy.branch_id);
        if (branch) {
          const w = assetWarning(ctx, branch.asset_id);
          if (w) warnings.push(w);
          branchSummary.push({
            branch_id: branch.id,
            branch_name: branch.name,
            closed_now: isBranchClosedAt(branch, virtualNow),
            closed_until: branch.closed_until,
            available_copies: (title.copies || []).filter((c) => c.branch_id === branch.id && c.status === 'available').length,
            total_copies: (title.copies || []).filter((c) => c.branch_id === branch.id).length,
          });
        }
      }
      return {
        data,
        result: {
          virtual_now: virtualNow,
          title,
          branches: branchSummary,
          asset_warnings: warnings,
        },
      };
    }

    case 'shelfmark-library.card.list': {
      let cards = data.managed_cards || [];
      if (args.card_id) {
        cards = [findById(cards, args.card_id, 'card')];
      }
      const enriched = cards.map((c) => {
        const bal = cardUnpaidBalanceCents(data, c.id);
        const activeHolds = (data.holds || []).filter((h) => {
          if (h.card_id !== c.id) return false;
          const st = effectiveHoldStatus(h, virtualNow);
          return st === 'queued' || st === 'suspended' || st === 'ready_for_pickup';
        }).length;
        const activeLoans = (data.loans || []).filter((l) => l.card_id === c.id && l.status !== 'returned').length;
        return {
          ...c,
          open_fines_cents: bal.open_cents,
          disputed_fines_cents: bal.disputed_cents,
          unpaid_fines_cents: bal.unpaid_cents,
          active_holds_count: activeHolds,
          active_loans_count: activeLoans,
        };
      });
      return {
        data,
        result: {
          virtual_now: virtualNow,
          account_id: data.account.account_id,
          owner_person_id: data.account.owner_person_id,
          household_daily_room_hours_quota: data.account.household_daily_room_hours_quota,
          cards: enriched,
        },
      };
    }

    case 'shelfmark-library.hold.list': {
      if (args.card_id) findById(data.managed_cards, args.card_id, 'card');
      if (args.branch_id) findById(data.branches, args.branch_id, 'branch');
      const items = (data.holds || [])
        .map((h) => enrichHold(data, h, virtualNow))
        .filter((h) => {
          if (args.card_id && h.card_id !== args.card_id) return false;
          if (args.branch_id && h.pickup_branch_id !== args.branch_id) return false;
          if (args.status && h.effective_status !== args.status) return false;
          return true;
        });
      return {
        data,
        result: {
          virtual_now: virtualNow,
          total: items.length,
          holds: items,
        },
      };
    }

    case 'shelfmark-library.hold.get': {
      const hold = findById(data.holds, args.hold_id, 'hold');
      const branch = (data.branches || []).find((b) => b.id === hold.pickup_branch_id);
      const warning = branch ? assetWarning(ctx, branch.asset_id) : null;
      return {
        data,
        result: {
          virtual_now: virtualNow,
          hold: enrichHold(data, hold, virtualNow),
          branch_asset_warning: warning,
        },
      };
    }

    case 'shelfmark-library.hold.place': {
      commitDueTransitions(data, virtualNow);
      const card = findById(data.managed_cards, args.card_id, 'card');
      if (card.card_status === 'blocked_fines') {
        throw fail('ACCOUNT_BLOCKED', `Card '${card.id}' is blocked due to unpaid fines reaching ${card.block_threshold_cents} cents.`, {
          card_id: card.id,
          card_status: card.card_status,
        });
      }
      const title = findById(data.titles, args.title_id, 'title');
      const branch = findById(data.branches, args.pickup_branch_id, 'branch');
      const duplicate = (data.holds || []).find(
        (h) => h.title_id === title.id && h.card_id === card.id && ['queued', 'suspended', 'ready_for_pickup'].includes(h.status)
      );
      if (duplicate) {
        throw fail('DUPLICATE_HOLD', `Card '${card.id}' already has an active hold '${duplicate.id}' on '${title.id}'.`, {
          existing_hold_id: duplicate.id,
        });
      }
      const activeCount = (data.holds || []).filter(
        (h) => h.card_id === card.id && ['queued', 'suspended', 'ready_for_pickup'].includes(h.status)
      ).length;
      if (activeCount >= card.max_holds) {
        throw fail('QUOTA_EXCEEDED', `Card '${card.id}' has reached its maximum of ${card.max_holds} active holds.`, {
          card_id: card.id,
          max_holds: card.max_holds,
        });
      }
      title.queued_patrons += 1;
      const holdId = nextId(data.holds, 'hld');
      const hold = {
        id: holdId,
        title_id: title.id,
        card_id: card.id,
        pickup_branch_id: branch.id,
        status: 'queued',
        queue_position: title.queued_patrons,
        placed_at: virtualNow,
        resume_at: null,
        ready_at: null,
        pickup_expires_at: null,
        closure_event_ids: [],
        history: [{ at: virtualNow, action: 'placed', pickup_branch_id: branch.id }],
      };
      data.holds.push(hold);
      return {
        data,
        result: {
          hold_id: hold.id,
          hold: enrichHold(data, hold, virtualNow),
        },
      };
    }

    case 'shelfmark-library.hold.suspend': {
      commitDueTransitions(data, virtualNow);
      const hold = findById(data.holds, args.hold_id, 'hold');
      const resumeMs = parseIso(args.resume_at, 'resume_at');
      if (resumeMs <= Date.parse(virtualNow)) {
        throw fail('validation_error', 'resume_at must be strictly after virtual_now.', {
          resume_at: args.resume_at,
          virtual_now: virtualNow,
        });
      }
      if (hold.status !== 'queued') {
        throw fail('invalid_state_transition', `Cannot suspend hold '${hold.id}' in status '${hold.status}'.`, {
          hold_id: hold.id,
          status: hold.status,
        });
      }
      hold.status = 'suspended';
      hold.resume_at = args.resume_at;
      hold.history = hold.history || [];
      hold.history.push({ at: virtualNow, action: 'suspended', resume_at: args.resume_at });
      return {
        data,
        result: {
          hold_id: hold.id,
          hold: enrichHold(data, hold, virtualNow),
        },
      };
    }

    case 'shelfmark-library.hold.resume': {
      commitDueTransitions(data, virtualNow);
      const hold = findById(data.holds, args.hold_id, 'hold');
      if (hold.status !== 'suspended') {
        throw fail('invalid_state_transition', `Cannot resume hold '${hold.id}' in status '${hold.status}'.`, {
          hold_id: hold.id,
          status: hold.status,
        });
      }
      hold.status = 'queued';
      hold.resume_at = null;
      hold.history = hold.history || [];
      hold.history.push({ at: virtualNow, action: 'resumed' });
      return {
        data,
        result: {
          hold_id: hold.id,
          hold: enrichHold(data, hold, virtualNow),
        },
      };
    }

    case 'shelfmark-library.hold.change_branch': {
      commitDueTransitions(data, virtualNow);
      const hold = findById(data.holds, args.hold_id, 'hold');
      const branch = findById(data.branches, args.pickup_branch_id, 'branch');
      if (hold.status !== 'queued' && hold.status !== 'suspended') {
        throw fail('invalid_state_transition', `Cannot redirect hold '${hold.id}' in status '${hold.status}'.`, {
          hold_id: hold.id,
          status: hold.status,
        });
      }
      const prev = hold.pickup_branch_id;
      hold.pickup_branch_id = branch.id;
      hold.history = hold.history || [];
      hold.history.push({ at: virtualNow, action: 'branch_changed', from_branch_id: prev, to_branch_id: branch.id });
      return {
        data,
        result: {
          hold_id: hold.id,
          hold: enrichHold(data, hold, virtualNow),
        },
      };
    }

    case 'shelfmark-library.hold.cancel': {
      commitDueTransitions(data, virtualNow);
      const hold = findById(data.holds, args.hold_id, 'hold');
      if (!['queued', 'suspended', 'ready_for_pickup'].includes(hold.status)) {
        throw fail('invalid_state_transition', `Cannot cancel hold '${hold.id}' in status '${hold.status}'.`, {
          hold_id: hold.id,
          status: hold.status,
        });
      }
      const wasQueued = hold.status === 'queued' || hold.status === 'suspended';
      hold.status = 'cancelled';
      hold.resume_at = null;
      hold.history = hold.history || [];
      hold.history.push({ at: virtualNow, action: 'cancelled', reason: args.reason || null });
      if (wasQueued) {
        const title = (data.titles || []).find((t) => t.id === hold.title_id);
        if (title && title.queued_patrons > 0) title.queued_patrons -= 1;
      }
      return {
        data,
        result: {
          hold_id: hold.id,
          hold: enrichHold(data, hold, virtualNow),
        },
      };
    }

    case 'shelfmark-library.loan.list': {
      if (args.card_id) findById(data.managed_cards, args.card_id, 'card');
      const items = (data.loans || [])
        .map((l) => enrichLoan(data, l, virtualNow))
        .filter((l) => {
          if (args.card_id && l.card_id !== args.card_id) return false;
          if (args.status && l.effective_status !== args.status) return false;
          return true;
        });
      return {
        data,
        result: {
          virtual_now: virtualNow,
          total: items.length,
          loans: items,
        },
      };
    }

    case 'shelfmark-library.loan.renew': {
      commitDueTransitions(data, virtualNow);
      const loan = findById(data.loans, args.loan_id, 'loan');
      if (loan.status === 'returned') {
        throw fail('invalid_state_transition', `Loan '${loan.id}' is already returned and cannot be renewed.`, {
          loan_id: loan.id,
        });
      }
      const card = findById(data.managed_cards, loan.card_id, 'card');
      if (card.card_status === 'blocked_fines') {
        throw fail('ACCOUNT_BLOCKED', `Card '${card.id}' is blocked due to unpaid fines.`, { card_id: card.id });
      }
      const title = findById(data.titles, loan.title_id, 'title');
      if (title.queued_patrons > 0) {
        throw fail('RENEWAL_BLOCKED_BY_HOLD', `Title '${title.id}' has ${title.queued_patrons} waiting patron(s); renewal is blocked.`, {
          loan_id: loan.id,
          title_id: title.id,
          queued_patrons: title.queued_patrons,
        });
      }
      if (loan.renewals_used >= title.max_renewals) {
        throw fail('RENEWAL_LIMIT_REACHED', `Loan '${loan.id}' has reached the maximum of ${title.max_renewals} renewal(s).`, {
          loan_id: loan.id,
          renewals_used: loan.renewals_used,
          max_renewals: title.max_renewals,
        });
      }
      const baseIso = Date.parse(loan.due_at) > Date.parse(virtualNow) ? loan.due_at : virtualNow;
      loan.due_at = addDays(baseIso, title.loan_days);
      loan.renewals_used += 1;
      loan.status = 'active';
      loan.history = loan.history || [];
      loan.history.push({ at: virtualNow, action: 'renewed', new_due_at: loan.due_at });
      return {
        data,
        result: {
          loan_id: loan.id,
          loan: enrichLoan(data, loan, virtualNow),
        },
      };
    }

    case 'shelfmark-library.fine.list': {
      if (args.card_id) findById(data.managed_cards, args.card_id, 'card');
      const items = (data.fines || []).filter((f) => {
        if (args.card_id && f.card_id !== args.card_id) return false;
        if (args.status && f.status !== args.status) return false;
        return true;
      });
      return {
        data,
        result: {
          virtual_now: virtualNow,
          total: items.length,
          fines: items,
        },
      };
    }

    case 'shelfmark-library.fine.preview_payment': {
      const card = findById(data.managed_cards, args.card_id, 'card');
      const targetIds = Array.isArray(args.fine_ids) && args.fine_ids.length > 0 ? args.fine_ids : null;
      let targets;
      if (targetIds) {
        targets = targetIds.map((id) => {
          const fine = findById(data.fines, id, 'fine');
          if (fine.card_id !== card.id) {
            throw fail('validation_error', `Fine '${fine.id}' does not belong to card '${card.id}'.`, { fine_id: fine.id, card_id: card.id });
          }
          if (fine.status !== 'open') {
            throw fail('invalid_state_transition', `Fine '${fine.id}' is in status '${fine.status}' and cannot be paid.`, { fine_id: fine.id, status: fine.status });
          }
          return fine;
        });
      } else {
        targets = (data.fines || []).filter((f) => f.card_id === card.id && f.status === 'open');
      }
      const payCents = targets.reduce((sum, f) => sum + f.amount_cents, 0);
      const currentBal = cardUnpaidBalanceCents(data, card.id);
      const remainingUnpaid = currentBal.unpaid_cents - payCents;
      return {
        data,
        result: {
          virtual_now: virtualNow,
          card_id: card.id,
          current_card_status: card.card_status,
          block_threshold_cents: card.block_threshold_cents,
          fines_covered: targets.map((f) => ({ id: f.id, amount_cents: f.amount_cents, reason: f.reason })),
          total_cents: payCents,
          remaining_unpaid_cents: remainingUnpaid,
          will_unblock_card: remainingUnpaid < card.block_threshold_cents,
        },
      };
    }

    case 'shelfmark-library.fine.pay': {
      commitDueTransitions(data, virtualNow);
      const card = findById(data.managed_cards, args.card_id, 'card');
      const targetIds = Array.isArray(args.fine_ids) && args.fine_ids.length > 0 ? args.fine_ids : null;
      let targets;
      if (targetIds) {
        targets = targetIds.map((id) => {
          const fine = findById(data.fines, id, 'fine');
          if (fine.card_id !== card.id) {
            throw fail('validation_error', `Fine '${fine.id}' does not belong to card '${card.id}'.`, { fine_id: fine.id, card_id: card.id });
          }
          if (fine.status !== 'open') {
            throw fail('invalid_state_transition', `Fine '${fine.id}' is in status '${fine.status}' and cannot be paid.`, { fine_id: fine.id, status: fine.status });
          }
          return fine;
        });
      } else {
        targets = (data.fines || []).filter((f) => f.card_id === card.id && f.status === 'open');
        if (targets.length === 0) {
          throw fail('invalid_state_transition', `Card '${card.id}' has no open fines to pay.`, { card_id: card.id });
        }
      }
      const receiptId = `rcpt-${args.request_id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'pay'}`;
      let totalPaid = 0;
      for (const fine of targets) {
        fine.status = 'paid';
        fine.paid_at = virtualNow;
        fine.payment_receipt_id = receiptId;
        fine.history = fine.history || [];
        fine.history.push({
          at: virtualNow,
          action: 'paid',
          amount_cents: fine.amount_cents,
          payment_method: args.payment_method || 'card_on_file',
          payment_receipt_id: receiptId,
        });
        totalPaid += fine.amount_cents;
      }
      const newStatus = recomputeCardStatus(data, card.id);
      const bal = cardUnpaidBalanceCents(data, card.id);
      return {
        data,
        result: {
          payment_receipt_id: receiptId,
          card_id: card.id,
          paid_fine_ids: targets.map((f) => f.id),
          total_paid_cents: totalPaid,
          remaining_unpaid_cents: bal.unpaid_cents,
          card_status: newStatus,
        },
      };
    }

    case 'shelfmark-library.fine.dispute': {
      commitDueTransitions(data, virtualNow);
      const fine = findById(data.fines, args.fine_id, 'fine');
      if (fine.status !== 'open') {
        throw fail('invalid_state_transition', `Fine '${fine.id}' is in status '${fine.status}' and cannot be disputed.`, {
          fine_id: fine.id,
          status: fine.status,
        });
      }
      fine.status = 'disputed';
      fine.dispute_reason = args.reason;
      fine.dispute_note = args.evidence_note || null;
      fine.history = fine.history || [];
      fine.history.push({ at: virtualNow, action: 'disputed', reason: args.reason, evidence_note: args.evidence_note || null });
      return {
        data,
        result: {
          fine_id: fine.id,
          fine,
        },
      };
    }

    case 'shelfmark-library.room.search': {
      if (args.branch_id) findById(data.branches, args.branch_id, 'branch');
      const startMs = args.start_at ? parseIso(args.start_at, 'start_at') : null;
      const endMs = args.end_at ? parseIso(args.end_at, 'end_at') : null;
      if ((startMs && !endMs) || (!startMs && endMs)) {
        throw fail('validation_error', 'Both start_at and end_at must be supplied together.');
      }
      if (startMs && endMs && endMs <= startMs) {
        throw fail('validation_error', 'end_at must be after start_at.');
      }
      const rooms = (data.rooms || [])
        .filter((r) => {
          if (args.branch_id && r.branch_id !== args.branch_id) return false;
          if (args.kind && r.kind !== args.kind) return false;
          if (typeof args.min_capacity === 'number' && r.capacity < args.min_capacity) return false;
          if (args.amenity && !(r.amenities || []).includes(args.amenity)) return false;
          return true;
        })
        .map((r) => {
          const branch = (data.branches || []).find((b) => b.id === r.branch_id);
          let available = true;
          if (startMs && endMs) {
            const overlaps = (data.room_bookings || []).some(
              (b) => b.room_id === r.id && b.status === 'confirmed' && Date.parse(b.start_at) < endMs && Date.parse(b.end_at) > startMs
            );
            const closedDuring = branch && branch.closed_until && Date.parse(branch.closed_until) > startMs;
            available = !overlaps && !closedDuring;
          }
          return { ...r, branch_name: branch ? branch.name : null, available_for_window: available };
        });
      return {
        data,
        result: {
          virtual_now: virtualNow,
          total: rooms.length,
          rooms,
        },
      };
    }

    case 'shelfmark-library.room.list_bookings': {
      if (args.card_id) findById(data.managed_cards, args.card_id, 'card');
      if (args.branch_id) findById(data.branches, args.branch_id, 'branch');
      const items = (data.room_bookings || []).filter((b) => {
        if (args.card_id && b.card_id !== args.card_id) return false;
        if (args.branch_id && b.branch_id !== args.branch_id) return false;
        if (args.status && b.status !== args.status) return false;
        return true;
      });
      return {
        data,
        result: {
          virtual_now: virtualNow,
          total: items.length,
          bookings: items,
        },
      };
    }

    case 'shelfmark-library.room.book': {
      commitDueTransitions(data, virtualNow);
      const card = findById(data.managed_cards, args.card_id, 'card');
      if (card.card_status === 'blocked_fines') {
        throw fail('ACCOUNT_BLOCKED', `Card '${card.id}' is blocked due to unpaid fines.`, { card_id: card.id });
      }
      const room = findById(data.rooms, args.room_id, 'room');
      const branch = findById(data.branches, room.branch_id, 'branch');
      const startMs = parseIso(args.start_at, 'start_at');
      const endMs = parseIso(args.end_at, 'end_at');
      if (endMs <= startMs) {
        throw fail('validation_error', 'end_at must be strictly after start_at.');
      }
      if (startMs < Date.parse(virtualNow)) {
        throw fail('validation_error', 'Cannot book a room slot in the past.', { start_at: args.start_at, virtual_now: virtualNow });
      }
      const durationMinutes = (endMs - startMs) / 60000;
      if (durationMinutes > room.max_duration_minutes) {
        throw fail('validation_error', `Booking exceeds room max duration of ${room.max_duration_minutes} minutes.`);
      }
      if (branch.closed_until && Date.parse(branch.closed_until) > startMs) {
        throw fail('BRANCH_CLOSED', `Branch '${branch.id}' is closed until ${branch.closed_until}.`, {
          branch_id: branch.id,
          closed_until: branch.closed_until,
        });
      }
      const conflict = (data.room_bookings || []).find(
        (b) => b.room_id === room.id && b.status === 'confirmed' && Date.parse(b.start_at) < endMs && Date.parse(b.end_at) > startMs
      );
      if (conflict) {
        throw fail('SLOT_CONFLICT', `Room '${room.id}' is already booked during the requested window (conflicts with '${conflict.id}').`, {
          conflicting_booking_id: conflict.id,
        });
      }
      if (room.kind === 'study_room') {
        const dayKey = args.start_at.slice(0, 10);
        const existingHours = (data.room_bookings || [])
          .filter((b) => {
            const bRoom = (data.rooms || []).find((r) => r.id === b.room_id);
            return b.status === 'confirmed' && bRoom && bRoom.kind === 'study_room' && b.start_at.slice(0, 10) === dayKey;
          })
          .reduce((sum, b) => sum + (Date.parse(b.end_at) - Date.parse(b.start_at)) / 3600000, 0);
        const requestedHours = durationMinutes / 60;
        if (existingHours + requestedHours > data.account.household_daily_room_hours_quota) {
          throw fail('QUOTA_EXCEEDED', `Booking exceeds daily household study-room quota of ${data.account.household_daily_room_hours_quota} hours.`, {
            existing_hours: existingHours,
            requested_hours: requestedHours,
            quota_hours: data.account.household_daily_room_hours_quota,
          });
        }
      }
      const bookingId = nextId(data.room_bookings, 'rmb');
      const code = `SM-${room.kind === 'museum_pass' ? 'PASS' : 'RM'}-${bookingId.split('-')[1]}`;
      const cutoff = addHours(args.start_at, -room.free_cancel_hours_before);
      const booking = {
        id: bookingId,
        room_id: room.id,
        branch_id: room.branch_id,
        card_id: card.id,
        start_at: args.start_at,
        end_at: args.end_at,
        free_cancel_cutoff_at: cutoff,
        status: 'confirmed',
        created_at: virtualNow,
        confirmation_code: code,
        purpose: args.purpose || null,
        late_cancellation: false,
        waived_by_closure: false,
        note: null,
        history: [{ at: virtualNow, action: 'confirmed' }],
      };
      data.room_bookings.push(booking);
      return {
        data,
        result: {
          booking_id: booking.id,
          booking_confirmation_code: booking.confirmation_code,
          booking,
        },
      };
    }

    case 'shelfmark-library.room.cancel': {
      commitDueTransitions(data, virtualNow);
      const booking = findById(data.room_bookings, args.booking_id, 'room_booking');
      if (booking.status !== 'confirmed') {
        throw fail('invalid_state_transition', `Booking '${booking.id}' is in status '${booking.status}' and cannot be cancelled.`, {
          booking_id: booking.id,
          status: booking.status,
        });
      }
      const isLate = Date.parse(virtualNow) > Date.parse(booking.free_cancel_cutoff_at);
      booking.status = 'cancelled';
      booking.late_cancellation = isLate;
      booking.note = args.reason || (isLate ? 'Cancelled past free-cancellation cutoff' : 'Cancelled within free window');
      booking.history = booking.history || [];
      booking.history.push({ at: virtualNow, action: 'cancelled', late_cancellation: isLate, reason: args.reason || null });
      return {
        data,
        result: {
          booking_id: booking.id,
          late_cancellation: isLate,
          booking,
        },
      };
    }

    default:
      throw fail('unknown_tool', `Unknown ShelfMark tool '${name}'.`, { tool: name });
  }
}

module.exports = { handleTool };
