'use strict';
const {copy, fold, shift, log, HOLD_DAYS} = require('./util.cjs');
const d = require('./derive.cjs');
const c = require('./common.cjs');
const APP = c.APP;
// Every rejection is invalid_event and leaves state unchanged; Infra reads the message with env.event_status.
const reject = message => c.fail('invalid_event', message);

function applyEvent(ctx, data, event) {
  const name = event.operation.slice(APP.length + 1), p = event.payload, now = ctx.virtual_now;
  const me = d.boundMember(ctx.binding, ctx.app_id, data);
  if (!me) reject('The run binding does not identify one member for this account.');
  const my = me.member_id, memberName = id => data.members.find(m => m.member_id === id)?.name ?? id;
  const inMyGroups = groupId => data.groups.find(g => g.group_id === groupId).member_ids.includes(my);
  const done = (fields) => c.record(ctx, data, 'event', name, {event_id: event.event_id, ...fields});
  const group = id => data.groups.find(g => g.group_id === id) || reject('Unknown group.');
  const actor = groupId => {
    const id = p.actor_member_id;
    if (!data.members.some(m => m.member_id === id)) reject('Unknown member.');
    // The Agent's tools are the only way the bound member acts.
    if (id === my) reject('The acting member is the account holder; the member acts only through the Agent\'s tools.');
    if (!group(groupId).member_ids.includes(id)) reject('The acting member is not in the group.');
    return id;
  };
  // An event may name a record by ID, or by a key that is known when the task is written.
  const oneOf = (id, match, label) => { if ((id === undefined) === (match === undefined)) reject('Give exactly one of ' + label + '_id and ' + label + '_match.'); };
  const findItem = () => {
    oneOf(p.item_id, p.item_match, 'item');
    const item = p.item_id !== undefined ? data.items.find(i => i.item_id === p.item_id)
      : data.items.find(i => i.list_id === p.item_match.list_id && i.status === 'listed' && fold(i.name) === fold(p.item_match.name));
    if (!item) reject(p.item_id !== undefined ? 'Unknown item.' : 'No listed item on that list has that name.');
    return {item, list: data.lists.find(l => l.list_id === item.list_id)};
  };
  const findExchange = () => {
    oneOf(p.exchange_id, p.exchange_match, 'exchange');
    const x = p.exchange_id !== undefined ? data.exchanges.find(x => x.exchange_id === p.exchange_id)
      : data.exchanges.find(x => x.group_id === p.exchange_match.group_id && fold(x.name) === fold(p.exchange_match.name));
    return x || reject(p.exchange_id !== undefined ? 'Unknown exchange.' : 'No exchange in that group has that name.');
  };
  const newId = id => { if (c.allIds(data).has(id)) reject('Duplicate ID.'); return id; };
  const editorOf = (list, id) => { if (list.owner_member_id !== id && list.managed_by !== id) reject('The acting member neither owns nor manages the list.'); };

  if (name === 'item.added') {
    const list = data.lists.find(l => l.list_id === p.list_id) || reject('Unknown list.');
    const who = actor(list.group_id), f = p.item; editorOf(list, who);
    const q = f.quantity_wanted ?? 1;
    if (!c.quantityOk(q)) reject('A quantity is a whole number from 1 to 20.');
    if (c.listedNameTaken(data, list.list_id, f.name)) reject('A listed item on this list already has that name.');
    data.items.push({item_id: newId(f.item_id), list_id: list.list_id, name: f.name, variant: f.variant ?? null, price_cents: f.price_cents ?? null, store: f.store ?? null, note: f.note ?? null,
      priority: f.priority ?? 'medium', quantity_wanted: q, status: 'listed', created_at: now, updated_at: now});
    if (data.settings.notify_item_added && inMyGroups(list.group_id))
      c.notify(ctx, data, 'item.added', memberName(who) + ' added "' + f.name + '" to ' + (who === list.owner_member_id ? 'their' : memberName(list.owner_member_id) + '\'s') + ' list.', {actor_member_id: who, list_id: list.list_id, item_id: f.item_id});
    done({object_id: f.item_id, list_id: list.list_id});
  } else if (name === 'item.changed') {
    const {item, list} = findItem(), who = actor(list.group_id); editorOf(list, who);
    if ((p.patch === undefined) === (p.removed === undefined)) reject('Give exactly one of patch and removed.');
    let material = [], replaced = null, counted = null;
    if (p.patch !== undefined) {
      if (item.status !== 'listed') reject('A removed item must be restored before it changes.');
      if (!Object.keys(p.patch).length) reject('The patch must contain a field.');
      if ('quantity_wanted' in p.patch && !c.quantityOk(p.patch.quantity_wanted)) reject('A quantity is a whole number from 1 to 20.');
      if ('name' in p.patch && c.listedNameTaken(data, list.list_id, p.patch.name, item.item_id)) reject('A listed item on this list already has that name.');
      ({replaced, material} = c.applyItemPatch(item, copy(p.patch)));
    } else if (p.removed) {
      if (item.status !== 'listed') reject('The item is already removed.');
      item.status = 'removed'; material = ['removed'];
    } else {
      if (item.status !== 'removed') reject('Only a removed item can be restored.');
      if (c.listedNameTaken(data, list.list_id, item.name, item.item_id)) reject('A listed item on this list already has that name.');
      item.status = 'listed'; c.unmarkRemoved(data, item.item_id);
    }
    item.updated_at = now;
    if (material.length) {
      const touched = c.markClaims(data, item.item_id, material), mine = touched.find(x => x.member_id === my);
      if (p.removed) counted = touched.length;
      // One notification per event, and only when the bound member holds an unreleased claim on the item.
      if (mine) c.notify(ctx, data, 'claim.item_changed', memberName(who) + (p.removed ? ' removed "' : ' changed "') + item.name + '", which you have claimed.',
        {actor_member_id: who, list_id: list.list_id, item_id: item.item_id, claim_id: mine.claim_id});
    }
    done({object_id: item.item_id, list_id: list.list_id, replaced, unreleased_claims: counted});
  } else if (name === 'claim.recorded') {
    const {item, list} = findItem(), who = actor(list.group_id);
    if (list.owner_member_id === who) reject('A list owner cannot claim their own item.');
    const existing = data.claims.find(x => x.item_id === item.item_id && x.member_id === who && d.isUnreleased(x));
    let claim = existing, replaced = existing ? {status: existing.status, quantity: existing.quantity, reserved_until: existing.reserved_until} : null;
    if (p.status === 'released') {
      if (!existing) reject('The acting member has no unreleased claim on the item.');
      Object.assign(existing, {status: 'released', reserved_until: null, updated_at: now});
    } else {
      if (item.status !== 'listed') reject('The item was removed from its list.');
      const q = p.quantity ?? existing?.quantity ?? 1;
      if (!c.quantityOk(q)) reject('A quantity is a whole number from 1 to 20.');
      if (q > d.remaining(data, item, now, existing?.claim_id ?? null)) reject('The claimed quantity is more than is left.');
      const fields = {quantity: q, status: p.status, reserved_until: p.status === 'reserved' ? shift(now, HOLD_DAYS) : null, changed_fields: [], updated_at: now};
      if (existing) Object.assign(existing, fields);
      else { claim = {claim_id: p.claim_id !== undefined ? newId(p.claim_id) : c.nextId(data, 'claim'), member_id: who, item_id: item.item_id, note: null, for_exchange_id: null, created_at: now, ...fields}; data.claims.push(claim); }
    }
    // No notification: a claim is never announced, least of all on the bound member's own list.
    done({object_id: claim.claim_id, list_id: list.list_id, replaced});
  } else if (name === 'exchange.opened') {
    const f = p.exchange, g = group(f.group_id), who = actor(g.group_id);
    if (c.exchangeNameTaken(data, g.group_id, f.name)) reject('An exchange in this group already has that name.');
    if (!c.windowOk(f.join_by, f.exchange_date)) reject('join_by must be before exchange_date.');
    const exclusions = c.cleanExclusions(g, f.exclusions ?? []);
    if (!exclusions) reject('An exclusion names someone outside the group or pairs a member with themselves.');
    data.exchanges.push({exchange_id: newId(f.exchange_id), group_id: g.group_id, organizer_member_id: who, name: f.name, budget_cents: f.budget_cents ?? null, join_by: f.join_by, exchange_date: f.exchange_date,
      exclusions, participant_ids: [who], drawn_at: null, assignments: [], created_at: now});
    if (g.member_ids.includes(my)) c.notify(ctx, data, 'exchange.invited', memberName(who) + ' opened the exchange "' + f.name + '" in ' + g.name + '.', {actor_member_id: who, exchange_id: f.exchange_id});
    done({object_id: f.exchange_id, exchange_id: f.exchange_id});
  } else if (name === 'exchange.member_changed') {
    const x = findExchange(), who = actor(x.group_id), status = d.exchangeStatus(x, now);
    if (p.change === 'joined') {
      if (status !== 'open') reject('Joining is closed: the exchange reads ' + status + '.');
      if (x.participant_ids.includes(who)) reject('The member has already joined.');
      if (x.participant_ids.length >= 10) reject('An exchange has at most 10 participants.');
      x.participant_ids.push(who);
    } else {
      if (!x.participant_ids.includes(who)) reject('The member has not joined the exchange.');
      if (!['open', 'closed'].includes(status)) reject('The exchange reads ' + status + ' and can no longer change.');
      x.participant_ids = x.participant_ids.filter(id => id !== who);
    }
    if (x.organizer_member_id === my && data.settings.notify_exchange_activity)
      c.notify(ctx, data, 'exchange.member_changed', memberName(who) + (p.change === 'joined' ? ' joined "' : ' left "') + x.name + '".', {actor_member_id: who, exchange_id: x.exchange_id});
    done({object_id: x.exchange_id, exchange_id: x.exchange_id});
  } else if (name === 'exchange.drawn') {
    const x = findExchange(), status = d.exchangeStatus(x, now);
    if (x.organizer_member_id === my) reject('The account holder organizes this exchange; its draw is run with ribbonwell.exchanges.draw.');
    if (!['open', 'closed'].includes(status)) reject('The exchange reads ' + status + ' and cannot be drawn.');
    if (!d.validAssignments(x, p.assignments)) reject('The assignments are not valid for the participants and exclusions.');
    x.assignments = copy(p.assignments); x.drawn_at = now;
    if (x.participant_ids.includes(my)) c.notify(ctx, data, 'exchange.drawn', 'Names were drawn for "' + x.name + '".', {actor_member_id: x.organizer_member_id, exchange_id: x.exchange_id});
    done({object_id: x.exchange_id, exchange_id: x.exchange_id});
  } else reject('Unsupported operation.');
  log(ctx, APP + '.event_prepared', {event_id: event.event_id});
  return data;
}
module.exports = {applyEvent};
