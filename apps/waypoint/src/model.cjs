'use strict';
// Seed and state consistency. Core runs validateSeed after every load, tool call and event,
// so an invariant here can never be broken by a later write.
const {references:bound} = require('./domain-utils.cjs');
const {fail, ms} = require('./common.cjs');

function timeline(record, label) {
  if (ms(record.created_at) > ms(record.updated_at)) fail('invalid_seed', label + ' timestamps are reversed.');
  let previous = ms(record.created_at);
  for (const entry of record.history) {
    const at = ms(entry.at);
    if (!Number.isFinite(at) || at < previous || at > ms(record.updated_at)) fail('invalid_seed', 'Invalid history timeline for ' + label + '.');
    previous = at;
  }
  if (!record.history.length || previous !== ms(record.updated_at)) fail('invalid_seed', label + ' history must include the last update.');
}

// Points a partner credits for a transfer: the ratio, then the bonus, rounded down.
function credited(ratio, basePoints, bonusPct) {
  return Math.floor(basePoints * ratio.to * (100 + bonusPct) / (ratio.from * 100));
}

// The bonus that applies to a transfer to this partner at `at`, if any.
function activeBonus(data, partnerId, at) {
  return data.bonuses.find(b => b.partner_id === partnerId && ms(b.starts_at) <= ms(at) && ms(at) < ms(b.ends_at)) || null;
}

function account(ctx, appId, accountId) {
  return ctx.binding.accounts.find(a => a.app_id === appId && a.account_id === accountId);
}

function validateSeed(ctx, data) {
  bound(ctx, data);

  // Ledger: time order, unique IDs, running balance never negative, last entry equals the balance.
  let running = 0, previous = -Infinity;
  const ids = new Set();
  for (const row of data.ledger) {
    if (ids.has(row.id)) fail('invalid_seed', 'Duplicate ledger entry ' + row.id + '.');
    ids.add(row.id);
    if (!Number.isFinite(ms(row.at)) || ms(row.at) < previous) fail('invalid_seed', 'Ledger entries must be in time order.');
    previous = ms(row.at);
    running += row.points;
    if (running < 0 || row.balance_after !== running) fail('invalid_seed', 'Ledger running balance is wrong at ' + row.id + '.');
  }
  if (running !== data.balance) fail('invalid_seed', 'Balance must equal the ledger total.');

  // Partners route only to the member's own partner accounts.
  const partners = new Map();
  for (const p of data.partners) {
    if (partners.has(p.id)) fail('invalid_seed', 'Duplicate partner ' + p.id + '.');
    partners.set(p.id, p);
    const target = account(ctx, p.app_id, p.recipient_account_id);
    if (!target || target.owner_person_id !== data.owner_person_id) fail('invalid_seed', 'Partner ' + p.id + ' must route to an account the member owns.');
    if (p.minimum % p.increment) fail('invalid_seed', 'Partner ' + p.id + ' minimum must be a multiple of its increment.');
  }

  // Household: other people, each with their own Waypoint account.
  const household = new Map();
  for (const m of data.household) {
    if (m.person_id === data.owner_person_id || household.has(m.person_id)) fail('invalid_seed', 'Household lists the owner or a person twice.');
    if (!ctx.binding.people.some(p => p.person_id === m.person_id)) fail('invalid_seed', 'Household member is not a bound person.');
    const target = account(ctx, 'waypoint', m.waypoint_account_id);
    if (!target || target.owner_person_id !== m.person_id) fail('invalid_seed', 'Household member account must be their own Waypoint account.');
    household.set(m.person_id, m);
  }

  // Bonuses: known partner, a real window, no overlap for one partner.
  const records = new Set(ids);
  for (const b of data.bonuses) {
    if (records.has(b.id)) fail('invalid_seed', 'Duplicate ID ' + b.id + '.');
    records.add(b.id);
    timeline(b, b.id);
    if (!partners.has(b.partner_id)) fail('invalid_seed', 'Bonus ' + b.id + ' names an unknown partner.');
    if (ms(b.starts_at) >= ms(b.ends_at)) fail('invalid_seed', 'Bonus ' + b.id + ' window is empty.');
  }
  for (const a of data.bonuses) for (const b of data.bonuses) {
    if (a !== b && a.partner_id === b.partner_id && ms(a.starts_at) < ms(b.ends_at) && ms(b.starts_at) < ms(a.ends_at)) {
      fail('invalid_seed', 'Bonus windows for one partner overlap.');
    }
  }

  // Transfers: each debit, refund and outcome is consistent with the ledger and the route.
  const ledger = new Map(data.ledger.map(r => [r.id, r]));
  for (const t of data.transfers) {
    if (records.has(t.id)) fail('invalid_seed', 'Duplicate ID ' + t.id + '.');
    records.add(t.id);
    timeline(t, t.id);
    if (t.kind === 'partner_transfer') {
      const p = partners.get(t.partner_id);
      if (!p || t.to_person_id !== null || t.recipient.app_id !== p.app_id || t.recipient.account_id !== p.recipient_account_id) {
        fail('invalid_seed', 'Transfer ' + t.id + ' does not match its partner.');
      }
      if (t.points !== credited(t.ratio, t.base_points, t.bonus_pct)) fail('invalid_seed', 'Transfer ' + t.id + ' credit does not match ratio and bonus.');
    } else {
      const m = household.get(t.to_person_id);
      if (!m || t.partner_id !== null || t.recipient.app_id !== 'waypoint' || t.recipient.account_id !== m.waypoint_account_id ||
          t.member_number !== null || t.bonus_pct !== 0 || t.ratio.from !== 1 || t.ratio.to !== 1 || t.points !== t.base_points) fail('invalid_seed', 'Combine ' + t.id + ' does not match its household member.');
    }
    const debit = ledger.get(t.debit_ledger_id);
    const outKind = t.kind === 'partner_transfer' ? 'transfer_out' : 'combine_out';
    if (!debit || debit.kind !== outKind || debit.points !== -t.base_points || debit.ref?.id !== t.id || ms(debit.at) !== ms(t.created_at)) {
      fail('invalid_seed', 'Transfer ' + t.id + ' needs its matching debit.');
    }
    if (ms(t.available_at) < ms(t.created_at)) fail('invalid_seed', 'Transfer ' + t.id + ' is available before it was made.');
    const settled = t.status !== 'pending';
    if (settled !== (t.settled_at !== null) || (settled && ms(t.settled_at) < ms(t.available_at))) fail('invalid_seed', 'Transfer ' + t.id + ' settlement time is inconsistent.');
    if ((t.status === 'completed') !== (t.receipt !== null)) fail('invalid_seed', 'Only a completed transfer has a receipt.');
    if ((t.status === 'rejected') !== (t.rejection !== null && t.refund_ledger_id !== null)) fail('invalid_seed', 'Only a rejected transfer has a rejection and a refund.');
    if (t.status === 'rejected') {
      const refund = ledger.get(t.refund_ledger_id);
      if (!refund || refund.kind !== 'refund' || refund.points !== t.base_points || refund.ref?.id !== t.id) fail('invalid_seed', 'Transfer ' + t.id + ' refund is missing.');
    } else if (t.refund_ledger_id !== null) fail('invalid_seed', 'Only a rejected transfer is refunded.');
    if (t.receipt && (t.receipt.target_app_id !== t.recipient.app_id || t.receipt.target_account_id !== t.recipient.account_id)) {
      fail('invalid_seed', 'Transfer ' + t.id + ' receipt names another account.');
    }
  }
  for (const row of data.ledger) {
    if (['transfer_out','combine_out','refund'].includes(row.kind) && !data.transfers.some(t => t.id === row.ref?.id)) {
      fail('invalid_seed', 'Ledger entry ' + row.id + ' points to a missing transfer.');
    }
  }
}

module.exports = {validateSeed, credited, activeBonus, account,
  records:data => [...data.ledger, ...data.bonuses, ...data.transfers],
  objects:data => [...data.ledger, ...data.bonuses, ...data.transfers].map(r => r.id),
  references:() => [], assetReferences:() => []};
