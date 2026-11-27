'use strict';

const { fail, parseIso } = require('./common.cjs');

const DATE_FLOOR_MS = Date.parse('2026-01-01T00:00:00+00:00');

function checkUnique(list, label) {
  const seen = new Set();
  for (const item of list || []) {
    if (seen.has(item.id)) {
      throw fail('duplicate_record', `Duplicate ${label} id '${item.id}'.`, { label, id: item.id });
    }
    seen.add(item.id);
  }
  return seen;
}

function checkDateFloor(iso, label) {
  if (iso == null) return;
  const ms = parseIso(iso, label);
  if (ms < DATE_FLOOR_MS) {
    throw fail('validation_error', `${label} '${iso}' predates 2026-01-01.`, { label, value: iso });
  }
}

function validateSeed(ctx, data) {
  if (!data || typeof data !== 'object') {
    throw fail('validation_error', 'Seed data must be an object.');
  }
  const branchIds = checkUnique(data.branches, 'branch');
  const titleIds = checkUnique(data.titles, 'title');
  const roomIds = checkUnique(data.rooms, 'room');
  const cardIds = checkUnique(data.managed_cards, 'managed_card');
  const loanIds = checkUnique(data.loans, 'loan');
  checkUnique(data.holds, 'hold');
  checkUnique(data.fines, 'fine');
  checkUnique(data.room_bookings, 'room_booking');

  if (ctx && ctx.binding && ctx.binding.account_id && data.account.account_id !== ctx.binding.account_id) {
    throw fail('validation_error', `Seed account_id '${data.account.account_id}' does not match binding '${ctx.binding.account_id}'.`);
  }

  for (const t of data.titles || []) {
    for (const c of t.copies || []) {
      if (!branchIds.has(c.branch_id)) {
        throw fail('validation_error', `Title '${t.id}' copy '${c.copy_id}' references unknown branch '${c.branch_id}'.`);
      }
    }
  }
  for (const r of data.rooms || []) {
    if (!branchIds.has(r.branch_id)) {
      throw fail('validation_error', `Room '${r.id}' references unknown branch '${r.branch_id}'.`);
    }
  }
  for (const card of data.managed_cards || []) {
    if (!branchIds.has(card.home_branch_id)) {
      throw fail('validation_error', `Card '${card.id}' references unknown home branch '${card.home_branch_id}'.`);
    }
  }
  for (const loan of data.loans || []) {
    if (!titleIds.has(loan.title_id)) throw fail('validation_error', `Loan '${loan.id}' references unknown title '${loan.title_id}'.`);
    if (!cardIds.has(loan.card_id)) throw fail('validation_error', `Loan '${loan.id}' references unknown card '${loan.card_id}'.`);
    if (!branchIds.has(loan.branch_id)) throw fail('validation_error', `Loan '${loan.id}' references unknown branch '${loan.branch_id}'.`);
    checkDateFloor(loan.checked_out_at, `loan.${loan.id}.checked_out_at`);
    checkDateFloor(loan.due_at, `loan.${loan.id}.due_at`);
    checkDateFloor(loan.returned_at, `loan.${loan.id}.returned_at`);
  }
  for (const hold of data.holds || []) {
    if (!titleIds.has(hold.title_id)) throw fail('validation_error', `Hold '${hold.id}' references unknown title '${hold.title_id}'.`);
    if (!cardIds.has(hold.card_id)) throw fail('validation_error', `Hold '${hold.id}' references unknown card '${hold.card_id}'.`);
    if (!branchIds.has(hold.pickup_branch_id)) throw fail('validation_error', `Hold '${hold.id}' references unknown branch '${hold.pickup_branch_id}'.`);
    checkDateFloor(hold.placed_at, `hold.${hold.id}.placed_at`);
    checkDateFloor(hold.resume_at, `hold.${hold.id}.resume_at`);
    checkDateFloor(hold.ready_at, `hold.${hold.id}.ready_at`);
    checkDateFloor(hold.pickup_expires_at, `hold.${hold.id}.pickup_expires_at`);
  }
  for (const fine of data.fines || []) {
    if (!cardIds.has(fine.card_id)) throw fail('validation_error', `Fine '${fine.id}' references unknown card '${fine.card_id}'.`);
    if (fine.loan_id && !loanIds.has(fine.loan_id)) throw fail('validation_error', `Fine '${fine.id}' references unknown loan '${fine.loan_id}'.`);
    checkDateFloor(fine.assessed_at, `fine.${fine.id}.assessed_at`);
    checkDateFloor(fine.paid_at, `fine.${fine.id}.paid_at`);
  }
  for (const b of data.room_bookings || []) {
    if (!roomIds.has(b.room_id)) throw fail('validation_error', `Room booking '${b.id}' references unknown room '${b.room_id}'.`);
    if (!branchIds.has(b.branch_id)) throw fail('validation_error', `Room booking '${b.id}' references unknown branch '${b.branch_id}'.`);
    if (!cardIds.has(b.card_id)) throw fail('validation_error', `Room booking '${b.id}' references unknown card '${b.card_id}'.`);
    checkDateFloor(b.created_at, `room_booking.${b.id}.created_at`);
    checkDateFloor(b.start_at, `room_booking.${b.id}.start_at`);
    checkDateFloor(b.end_at, `room_booking.${b.id}.end_at`);
  }
}

function records(data) {
  return [
    ...(data.branches || []),
    ...(data.titles || []),
    ...(data.rooms || []),
    ...(data.managed_cards || []),
    ...(data.loans || []),
    ...(data.holds || []),
    ...(data.fines || []),
    ...(data.room_bookings || []),
  ];
}

function objects(data) {
  return records(data).map((r) => r.id);
}

function references() {
  return [];
}

function assetReferences(data) {
  const refs = [];
  for (const b of data.branches || []) {
    if (b.asset_id) {
      refs.push({ asset_id: b.asset_id, object_type: 'branch', object_id: b.id });
    }
  }
  for (const t of data.titles || []) {
    if (t.cover_asset_id) {
      refs.push({ asset_id: t.cover_asset_id, object_type: 'title', object_id: t.id });
    }
  }
  return refs;
}

module.exports = { validateSeed, records, objects, references, assetReferences };
