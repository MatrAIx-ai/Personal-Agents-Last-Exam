'use strict';
// Agent tools. A transfer or combine is a local commit: points leave the balance now and the
// transfer is `pending` until the host delivers its message and records the outcome (events.cjs).
const c = require('./common.cjs');
const {credited, activeBonus} = require('./model.cjs');
const {outbound} = require('./messaging.cjs');

function bonusState(b, now) {
  return c.ms(now) < c.ms(b.starts_at) ? 'upcoming' : c.ms(now) < c.ms(b.ends_at) ? 'active' : 'ended';
}

function debit(ctx, data, t, kind, description) {
  const row = c.post(ctx, data, {kind, points:-t.base_points, description, ref:{kind:t.kind === 'partner_transfer' ? 'transfer' : 'combine', id:t.id}});
  t.debit_ledger_id = row.id;
}

function newTransfer(ctx, data, fields) {
  return {id:c.nextId(data, fields.kind === 'partner_transfer' ? 'transfer' : 'combine'), ...fields, status:'pending',
    debit_ledger_id:'pending', refund_ledger_id:null, receipt:null, rejection:null, settled_at:null,
    created_at:ctx.virtual_now, updated_at:ctx.virtual_now, history:[]};
}

function transfer(ctx, data, args) {
  const p = c.find(data.partners, args.partner_id, 'Partner');
  if (args.points < p.minimum || args.points % p.increment) {
    c.fail('invalid_amount', 'Transfers to ' + p.name + ' are at least ' + p.minimum + ' points in multiples of ' + p.increment + '.');
  }
  if (args.points > data.balance) c.fail('insufficient_points', 'The balance is ' + data.balance + ' points.');
  const bonus = activeBonus(data, p.id, ctx.virtual_now), pct = bonus ? bonus.percent : 0;
  const t = newTransfer(ctx, data, {kind:'partner_transfer', partner_id:p.id, to_person_id:null,
    recipient:{app_id:p.app_id, account_id:p.recipient_account_id}, member_number:p.member_number, ratio:c.copy(p.ratio),
    base_points:args.points, bonus_pct:pct, points:credited(p.ratio, args.points, pct), available_at:c.addMinutes(ctx.virtual_now, p.delay_minutes)});
  debit(ctx, data, t, 'transfer_out', 'Transfer to ' + p.name);
  c.stamp(ctx, t, 'transfer_requested', {partner_id:p.id});
  data.transfers.push(t);
  return {id:t.id, transfer_status:t.status, points:t.points, bonus_pct:t.bonus_pct, available_at:t.available_at};
}

function combine(ctx, data, args) {
  if (args.to_person_id === data.owner_person_id) c.fail('invalid_arguments', 'Choose another household member.');
  const m = data.household.find(x => x.person_id === args.to_person_id);
  if (!m) c.fail('permission_denied', 'Points can be combined only with a member of this household.');
  if (args.points > data.balance) c.fail('insufficient_points', 'The balance is ' + data.balance + ' points.');
  const t = newTransfer(ctx, data, {kind:'household_combine', partner_id:null, to_person_id:m.person_id,
    recipient:{app_id:'waypoint', account_id:m.waypoint_account_id}, member_number:null, ratio:{from:1, to:1},
    base_points:args.points, bonus_pct:0, points:args.points, available_at:ctx.virtual_now});
  debit(ctx, data, t, 'combine_out', 'Combined to ' + m.name);
  c.stamp(ctx, t, 'combine_requested');
  data.transfers.push(t);
  return {id:t.id, transfer_status:t.status, points:t.points, bonus_pct:0, available_at:t.available_at};
}

function handleTool(ctx, data, name, args) {
  if (name === 'waypoint.balance') {
    const pending = data.transfers.filter(t => t.status === 'pending').reduce((sum, t) => sum + t.base_points, 0);
    return {data, result:{member_person_id:data.owner_person_id, balance:data.balance, pending_points:pending,
      household:c.copy(data.household), ledger:c.copy(data.ledger)}};
  }
  if (name === 'waypoint.partners') {
    return {data, result:{items:data.partners.map(p => {
      const b = activeBonus(data, p.id, ctx.virtual_now);
      return {...c.copy(p), bonus_pct_now:b ? b.percent : 0, active_bonus_id:b ? b.id : null};
    })}};
  }
  if (name === 'waypoint.bonuses') {
    const items = data.bonuses.map(b => ({...c.copy(b), state:bonusState(b, ctx.virtual_now)}))
      .sort((a, b) => c.ms(a.starts_at) - c.ms(b.starts_at) || a.id.localeCompare(b.id));
    return {data, result:{items}};
  }
  if (name === 'waypoint.transfers.list') {
    const items = data.transfers.filter(t => (!args.status || t.status === args.status) && (!args.kind || t.kind === args.kind))
      .sort((a, b) => c.ms(b.created_at) - c.ms(a.created_at) || b.id.localeCompare(a.id));
    return {data, result:{items:c.copy(items)}};
  }
  if (name === 'waypoint.transfers.get') return {data, result:{item:c.copy(c.find(data.transfers, args.id, 'Transfer'))}};
  if (name === 'waypoint.transfer.outbound') return {data, result:{message:outbound(ctx, data, c.find(data.transfers, args.id, 'Transfer'))}};
  if (name === 'waypoint.transfer') return {data, result:transfer(ctx, data, args)};
  if (name === 'waypoint.combine') return {data, result:combine(ctx, data, args)};
  c.fail('unknown_tool', 'Unknown waypoint operation.');
}

module.exports = {handleTool};
