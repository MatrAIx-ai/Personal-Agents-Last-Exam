'use strict';
const {fail, copy, ms, fold, shift, log, HOLD_DAYS, DAY_MS} = require('./util.cjs');
const d = require('./derive.cjs');
const c = require('./common.cjs');
const APP = c.APP;
const ITEM_FIELDS = ['item_id', 'list_id', 'name', 'variant', 'price_cents', 'store', 'note', 'priority', 'quantity_wanted', 'status', 'created_at', 'updated_at'];
const HINT = {list: ' ribbonwell.lists.list returns valid list IDs.', item: ' ribbonwell.lists.get returns valid item IDs.', claim: ' ribbonwell.claims.list returns valid claim IDs.',
  exchange: ' ribbonwell.exchanges.list returns valid exchange IDs.', group: ' ribbonwell.groups.list returns valid group IDs.'};
const byTime = key => (a, b) => ms(a.created_at) - ms(b.created_at) || String(a[key]).localeCompare(String(b[key]));
const page = (rows, args, fallback) => rows.slice(args.offset || 0, (args.offset || 0) + (args.limit || fallback));

// Everything the handlers need to know about who is asking and what that member may see.
function scope(ctx, data) {
  const me = d.boundMember(ctx.binding, ctx.app_id, data);
  if (!me) fail('invalid_state', 'The run binding does not identify one member for this account.');
  const now = ctx.virtual_now, my = me.member_id;
  const groupIds = new Set(data.groups.filter(g => g.member_ids.includes(my)).map(g => g.group_id));
  const name = id => data.members.find(m => m.member_id === id)?.name ?? id;
  const ref = id => ({member_id: id, name: name(id)});
  const group = id => { const g = data.groups.find(g => g.group_id === id); if (!g || !groupIds.has(id)) fail('not_found', 'No such group for this member.' + HINT.group); return g; };
  const list = id => { const l = data.lists.find(l => l.list_id === id); if (!l || !groupIds.has(l.group_id)) fail('not_found', 'No such list in this member\'s groups.' + HINT.list); return l; };
  const item = id => { const i = data.items.find(i => i.item_id === id), l = i && data.lists.find(l => l.list_id === i.list_id);
    if (!i || !groupIds.has(l.group_id)) fail('not_found', 'No such item in this member\'s groups.' + HINT.item); return {item: i, list: l}; };
  const claim = id => { const x = data.claims.find(x => x.claim_id === id); if (!x || x.member_id !== my) fail('not_found', 'No such claim of this member.' + HINT.claim); return x; };
  const exchange = id => { const x = data.exchanges.find(x => x.exchange_id === id); if (!x || !groupIds.has(x.group_id)) fail('not_found', 'No such exchange in this member\'s groups.' + HINT.exchange); return x; };
  const kind = l => l.owner_member_id === my ? 'own' : l.managed_by === my ? 'managed' : 'other';
  const editor = l => { if (kind(l) === 'other') fail('not_list_editor', 'Only the list owner or its manager can change this list.'); return l; };
  const listView = l => ({list_id: l.list_id, owner_member_id: l.owner_member_id, owner_name: name(l.owner_member_id), group_id: l.group_id, managed_by: l.managed_by,
    occasion_name: l.occasion_name, occasion_date: l.occasion_date, created_at: l.created_at, view: kind(l), item_count: data.items.filter(i => i.list_id === l.list_id && i.status === 'listed').length});
  // The owner never learns about claims: an own-list item carries no claim field of any kind.
  const itemView = (i, l) => {
    const view = Object.fromEntries(ITEM_FIELDS.map(k => [k, i[k]]));
    if (kind(l) === 'own') return {...view, claims_hidden: true};
    const claims = data.claims.filter(x => x.item_id === i.item_id && d.isUnreleased(x)).sort(byTime('claim_id'));
    return {...view, claims_hidden: false, remaining: d.remaining(data, i, now), over_claimed: d.claimedQuantity(data, i.item_id, now) > i.quantity_wanted,
      claims: claims.map(x => ({claim_id: x.claim_id, member_id: x.member_id, member_name: name(x.member_id), quantity: x.quantity, status: d.claimStatus(x, now), reserved_until: x.reserved_until, mine: x.member_id === my}))};
  };
  const giftee = x => { const a = x.drawn_at && x.assignments.find(a => a.giver === my); return a ? a.receiver : null; };
  const overBudget = x => { if (x.for_exchange_id === null) return null; const e = data.exchanges.find(e => e.exchange_id === x.for_exchange_id), i = data.items.find(i => i.item_id === x.item_id);
    return !e || e.budget_cents === null || i.price_cents === null ? null : i.price_cents * x.quantity > e.budget_cents; };
  const claimView = x => { const i = data.items.find(i => i.item_id === x.item_id), l = data.lists.find(l => l.list_id === i.list_id);
    return {claim_id: x.claim_id, item_id: x.item_id, item_name: i.name, list_id: l.list_id, list_owner_member_id: l.owner_member_id, quantity: x.quantity, status: d.claimStatus(x, now), reserved_until: x.reserved_until,
      note: x.note, for_exchange_id: x.for_exchange_id, over_budget: overBudget(x), changed_fields: x.changed_fields, item_removed: i.status === 'removed', created_at: x.created_at, updated_at: x.updated_at}; };
  const blockers = x => {
    const out = [];
    if (x.organizer_member_id !== my) out.push('not_organizer');
    if (!['open', 'closed'].includes(d.exchangeStatus(x, now))) out.push('invalid_state');
    else if (x.participant_ids.length < 3) out.push('too_few_participants');
    else if (!d.drawAssignments(data.settings.draw_salt, x)) out.push('no_valid_draw');
    return out;
  };
  const exchangeView = x => { const g = giftee(x), b = blockers(x);
    return {exchange_id: x.exchange_id, group_id: x.group_id, organizer_member_id: x.organizer_member_id, name: x.name, budget_cents: x.budget_cents, join_by: x.join_by, exchange_date: x.exchange_date,
      status: d.exchangeStatus(x, now), participants: x.participant_ids.map(ref), joined: x.participant_ids.includes(my), is_organizer: x.organizer_member_id === my,
      exclusions: x.organizer_member_id === my ? copy(x.exclusions) : null, drawn_at: x.drawn_at, my_giftee: g ? ref(g) : null, draw_ready: b.length === 0, draw_blockers: b, created_at: x.created_at}; };
  // An exchange tag is allowed only for an item whose list owner is this member's giftee in that exchange.
  const checkGiftee = (exchangeId, ownerId) => { const x = exchange(exchangeId); if (giftee(x) !== ownerId) fail('not_my_giftee', 'The list owner is not this member\'s giftee in that exchange.'); };
  return {me, my, now, groupIds, name, ref, group, list, item, claim, exchange, kind, editor, listView, itemView, claimView, exchangeView, giftee, checkGiftee};
}

function read(s, data, name, args) {
  if (name === 'account.get') return {account: {account_id: data.account_id, member_id: s.my, name: s.me.name, person_id: s.me.person_id, notify_item_added: data.settings.notify_item_added,
    notify_exchange_activity: data.settings.notify_exchange_activity, group_ids: [...s.groupIds].sort()}, now: s.now};
  if (name === 'groups.list') return {groups: data.groups.filter(g => s.groupIds.has(g.group_id)).map(g => ({group_id: g.group_id, name: g.name, member_count: g.member_ids.length}))};
  if (name === 'groups.get') { const g = s.group(args.id);
    return {group: {group_id: g.group_id, name: g.name, members: g.member_ids.map(id => { const m = data.members.find(m => m.member_id === id); return {member_id: id, name: m.name, person_id: m.person_id, is_me: id === s.my}; })}}; }
  if (name === 'lists.list') {
    if (args.group_id) s.group(args.group_id);
    if (args.occasion_from && args.occasion_to && ms(args.occasion_to) < ms(args.occasion_from)) fail('invalid_window', 'The occasion window ends before it starts.');
    const dated = args.occasion_from || args.occasion_to;
    const rows = data.lists.filter(l => s.groupIds.has(l.group_id) && (!args.group_id || l.group_id === args.group_id) && (!args.owner_member_id || l.owner_member_id === args.owner_member_id) &&
      (!dated || l.occasion_date !== null && (!args.occasion_from || ms(l.occasion_date) >= ms(args.occasion_from)) && (!args.occasion_to || ms(l.occasion_date) <= ms(args.occasion_to))))
      .sort((a, b) => a.list_id.localeCompare(b.list_id));
    return {lists: page(rows, args, 50).map(s.listView), total: rows.length};
  }
  if (name === 'lists.get') { const l = s.list(args.id);
    return {list: s.listView(l), items: data.items.filter(i => i.list_id === l.list_id && (args.include_removed || i.status === 'listed')).sort(byTime('item_id')).map(i => s.itemView(i, l))}; }
  if (name === 'items.get') { const {item, list} = s.item(args.id); return {item: s.itemView(item, list), list: s.listView(list)}; }
  if (name === 'items.search') {
    if (args.group_id) s.group(args.group_id);
    const q = fold(args.query), lists = new Map(data.lists.filter(l => s.groupIds.has(l.group_id) && (!args.group_id || l.group_id === args.group_id)).map(l => [l.list_id, l]));
    const rows = data.items.filter(i => i.status === 'listed' && lists.has(i.list_id) && [i.name, i.variant, i.store, i.note].some(v => v !== null && fold(v).includes(q))).sort(byTime('item_id'));
    return {items: page(rows, args, 25).map(i => s.itemView(i, lists.get(i.list_id))), total: rows.length};
  }
  if (name === 'claims.list') { const rows = data.claims.filter(x => x.member_id === s.my).sort(byTime('claim_id')).map(s.claimView).filter(v => !args.status || v.status === args.status);
    return {claims: page(rows, args, 50), total: rows.length}; }
  if (name === 'exchanges.list') { if (args.group_id) s.group(args.group_id);
    return {exchanges: data.exchanges.filter(x => s.groupIds.has(x.group_id) && (!args.group_id || x.group_id === args.group_id)).sort(byTime('exchange_id')).map(s.exchangeView)}; }
  if (name === 'exchanges.get') return {exchange: s.exchangeView(s.exchange(args.id))};
  if (name === 'notifications.list') { const rows = data.notifications.filter(n => !args.since || ms(n.at) >= ms(args.since));
    return {notifications: page(rows, args, 50).map(copy), total: rows.length}; }
  return null;
}

function write(ctx, s, data, name, args) {
  const now = s.now, done = (action, fields) => c.record(ctx, data, 'agent', action, {request_id: args.request_id, ...fields});
  const patch = () => { if (!Object.keys(args.patch).length) fail('invalid_arguments', 'The patch must contain a field.'); return args.patch; };
  const quantity = q => { if (!c.quantityOk(q)) fail('invalid_quantity', 'A quantity is a whole number from 1 to 20.'); return q; };
  switch (name) {
    case 'lists.update': {
      const l = s.editor(s.list(args.id)), p = patch(), replaced = Object.fromEntries(Object.keys(p).map(k => [k, l[k]]));
      Object.assign(l, copy(p)); done(name, {object_id: l.list_id, list_id: l.list_id, replaced}); return {id: l.list_id};
    }
    case 'items.add': {
      const l = s.editor(s.list(args.id)), f = args.item, q = quantity(f.quantity_wanted ?? 1);
      if (c.listedNameTaken(data, l.list_id, f.name)) fail('name_taken', 'A listed item on this list already has that name.');
      const item = {item_id: c.nextId(data, 'item'), list_id: l.list_id, name: f.name, variant: f.variant ?? null, price_cents: f.price_cents ?? null, store: f.store ?? null, note: f.note ?? null,
        priority: f.priority ?? 'medium', quantity_wanted: q, status: 'listed', created_at: now, updated_at: now};
      data.items.push(item); done(name, {object_id: item.item_id, list_id: l.list_id}); return {id: item.item_id};
    }
    case 'items.update': {
      const {item, list} = s.item(args.id); s.editor(list); const p = patch();
      if (item.status !== 'listed') fail('invalid_state', 'Restore the item before changing it.');
      if ('quantity_wanted' in p) quantity(p.quantity_wanted);
      if ('name' in p && c.listedNameTaken(data, list.list_id, p.name, item.item_id)) fail('name_taken', 'A listed item on this list already has that name.');
      const {replaced, material} = c.applyItemPatch(item, copy(p)); item.updated_at = now;
      if (material.length) c.markClaims(data, item.item_id, material);
      done(name, {object_id: item.item_id, list_id: list.list_id, replaced}); return {id: item.item_id};
    }
    case 'items.remove': {
      const {item, list} = s.item(args.id); s.editor(list);
      if (item.status !== 'listed') fail('invalid_state', 'The item is already removed.');
      item.status = 'removed'; item.updated_at = now;
      // The count goes to the activity row only; the result is the same with and without claims.
      const touched = c.markClaims(data, item.item_id, ['removed']);
      done(name, {object_id: item.item_id, list_id: list.list_id, unreleased_claims: touched.length}); return {id: item.item_id};
    }
    case 'items.restore': {
      const {item, list} = s.item(args.id); s.editor(list);
      if (item.status !== 'removed') fail('invalid_state', 'Only a removed item can be restored.');
      if (c.listedNameTaken(data, list.list_id, item.name, item.item_id)) fail('name_taken', 'A listed item on this list already has that name.');
      item.status = 'listed'; item.updated_at = now; c.unmarkRemoved(data, item.item_id);
      done(name, {object_id: item.item_id, list_id: list.list_id}); return {id: item.item_id};
    }
    case 'claims.reserve': {
      const {item, list} = s.item(args.id);
      if (list.owner_member_id === s.my) fail('own_list', 'A member cannot claim an item on their own list.');
      if (item.status !== 'listed') fail('removed_item', 'The item was removed from its list.');
      if (data.claims.some(x => x.item_id === item.item_id && x.member_id === s.my && d.isUnreleased(x))) fail('already_claimed', 'This member already has an unreleased claim on the item; change it with ribbonwell.claims.update.');
      const q = quantity(args.quantity ?? 1);
      if (q > d.remaining(data, item, now)) fail('insufficient_quantity', 'More than is left: ' + d.remaining(data, item, now) + ' remaining.');
      if (args.for_exchange_id) s.checkGiftee(args.for_exchange_id, list.owner_member_id);
      const claim = {claim_id: c.nextId(data, 'claim'), member_id: s.my, item_id: item.item_id, quantity: q, status: 'reserved', reserved_until: shift(now, HOLD_DAYS), note: args.note ?? null,
        for_exchange_id: args.for_exchange_id ?? null, changed_fields: [], created_at: now, updated_at: now};
      data.claims.push(claim); done(name, {object_id: claim.claim_id, list_id: list.list_id, exchange_id: claim.for_exchange_id});
      return {id: claim.claim_id, reserved_until: claim.reserved_until};
    }
    case 'claims.update': {
      const claim = s.claim(args.id), p = patch(), item = data.items.find(i => i.item_id === claim.item_id), list = data.lists.find(l => l.list_id === item.list_id);
      if (claim.status === 'released') fail('invalid_state', 'A released claim cannot be changed; reserve again.');
      const wasActive = d.isActive(claim, now), q = 'quantity' in p ? quantity(p.quantity) : claim.quantity;
      let status = claim.status, until = claim.reserved_until;
      if (p.status === 'purchased') { if ('reserved_until' in p) fail('invalid_state', 'A purchased claim has no hold to extend.'); status = 'purchased'; until = null; }
      else if (p.status === 'reserved') { status = 'reserved'; until = p.reserved_until ?? (wasActive && claim.status === 'reserved' ? claim.reserved_until : shift(now, HOLD_DAYS)); }
      else if ('reserved_until' in p) { if (claim.status !== 'reserved') fail('invalid_state', 'A purchased claim has no hold to extend.'); until = p.reserved_until; }
      if ('reserved_until' in p && (ms(until) <= ms(now) || ms(until) > ms(now) + HOLD_DAYS * DAY_MS)) fail('invalid_window', 'A hold ends after now and at most 14 days ahead. Now is ' + now + '.');
      const willBeActive = status === 'purchased' || ms(until) > ms(now);
      // A claim that becomes active again or grows is checked like a new reservation.
      if (willBeActive && (!wasActive || q > claim.quantity) && q > d.remaining(data, item, now, claim.claim_id)) fail('insufficient_quantity', 'More than is left: ' + d.remaining(data, item, now, claim.claim_id) + ' remaining.');
      if (p.for_exchange_id) s.checkGiftee(p.for_exchange_id, list.owner_member_id);
      const replaced = Object.fromEntries(Object.keys(p).map(k => [k, claim[k]]));
      Object.assign(claim, {quantity: q, status, reserved_until: until, changed_fields: [], updated_at: now});
      if ('note' in p) claim.note = p.note;
      if ('for_exchange_id' in p) claim.for_exchange_id = p.for_exchange_id;
      done(name, {object_id: claim.claim_id, list_id: list.list_id, exchange_id: claim.for_exchange_id, replaced}); return {id: claim.claim_id};
    }
    case 'claims.release': {
      const claim = s.claim(args.id), item = data.items.find(i => i.item_id === claim.item_id);
      if (claim.status === 'released') fail('invalid_state', 'The claim is already released.');
      const replaced = {status: claim.status, reserved_until: claim.reserved_until};
      Object.assign(claim, {status: 'released', reserved_until: null, updated_at: now});
      done(name, {object_id: claim.claim_id, list_id: item.list_id, replaced}); return {id: claim.claim_id};
    }
    case 'exchanges.create': {
      const g = s.group(args.id), f = args.exchange;
      if (c.exchangeNameTaken(data, g.group_id, f.name)) fail('name_taken', 'An exchange in this group already has that name.');
      if (!c.windowOk(f.join_by, f.exchange_date)) fail('invalid_window', 'join_by must be before exchange_date.');
      const exclusions = c.cleanExclusions(g, f.exclusions ?? []);
      if (!exclusions) fail('invalid_exclusion', 'An exclusion names someone outside the group or pairs a member with themselves.');
      const x = {exchange_id: c.nextId(data, 'exchange'), group_id: g.group_id, organizer_member_id: s.my, name: f.name, budget_cents: f.budget_cents ?? null, join_by: f.join_by, exchange_date: f.exchange_date,
        exclusions, participant_ids: [], drawn_at: null, assignments: [], created_at: now};
      data.exchanges.push(x); done(name, {object_id: x.exchange_id, exchange_id: x.exchange_id}); return {id: x.exchange_id};
    }
    case 'exchanges.update': {
      const x = s.exchange(args.id), p = patch(), g = data.groups.find(g => g.group_id === x.group_id);
      if (x.organizer_member_id !== s.my) fail('not_organizer', 'Only the organizer can change an exchange.');
      if (!['open', 'closed'].includes(d.exchangeStatus(x, now))) fail('invalid_state', 'The exchange reads ' + d.exchangeStatus(x, now) + ' and can no longer change.');
      if ('name' in p && c.exchangeNameTaken(data, x.group_id, p.name, x.exchange_id)) fail('name_taken', 'An exchange in this group already has that name.');
      if (!c.windowOk(p.join_by ?? x.join_by, p.exchange_date ?? x.exchange_date)) fail('invalid_window', 'join_by must be before exchange_date.');
      const next = copy(p);
      if ('exclusions' in p) { next.exclusions = c.cleanExclusions(g, p.exclusions); if (!next.exclusions) fail('invalid_exclusion', 'An exclusion names someone outside the group or pairs a member with themselves.'); }
      const replaced = Object.fromEntries(Object.keys(p).map(k => [k, copy(x[k])]));
      Object.assign(x, next); done(name, {object_id: x.exchange_id, exchange_id: x.exchange_id, replaced}); return {id: x.exchange_id};
    }
    case 'exchanges.join': {
      const x = s.exchange(args.id);
      if (d.exchangeStatus(x, now) !== 'open') fail('joining_closed', 'Joining is closed: the exchange reads ' + d.exchangeStatus(x, now) + '. Now is ' + now + '.');
      if (x.participant_ids.includes(s.my)) fail('already_joined', 'This member has already joined.');
      if (x.participant_ids.length >= 10) fail('exchange_full', 'An exchange has at most 10 participants.');
      x.participant_ids.push(s.my); done(name, {object_id: x.exchange_id, exchange_id: x.exchange_id}); return {id: x.exchange_id};
    }
    case 'exchanges.leave': {
      const x = s.exchange(args.id);
      if (!x.participant_ids.includes(s.my)) fail('not_participant', 'This member has not joined the exchange.');
      if (!['open', 'closed'].includes(d.exchangeStatus(x, now))) fail('invalid_state', 'The exchange reads ' + d.exchangeStatus(x, now) + ' and can no longer change.');
      x.participant_ids = x.participant_ids.filter(id => id !== s.my); done(name, {object_id: x.exchange_id, exchange_id: x.exchange_id}); return {id: x.exchange_id};
    }
    case 'exchanges.draw': {
      const x = s.exchange(args.id);
      if (x.organizer_member_id !== s.my) fail('not_organizer', 'Only the organizer can run the draw.');
      if (!['open', 'closed'].includes(d.exchangeStatus(x, now))) fail('invalid_state', 'The exchange reads ' + d.exchangeStatus(x, now) + ' and cannot be drawn.');
      if (x.participant_ids.length < 3) fail('too_few_participants', 'A draw needs at least three participants.');
      const assignments = d.drawAssignments(data.settings.draw_salt, x);
      if (!assignments) fail('no_valid_draw', 'The exclusions leave no valid assignment.');
      x.assignments = assignments; x.drawn_at = now; done(name, {object_id: x.exchange_id, exchange_id: x.exchange_id});
      const g = s.giftee(x); return {id: x.exchange_id, my_giftee: g ? s.ref(g) : null};
    }
    default: fail('unknown_tool', 'Unknown business operation.');
  }
}

function handleTool(ctx, data, fullName, args) {
  const name = fullName.slice(APP.length + 1), s = scope(ctx, data);
  const result = read(s, data, name, args);
  if (result) return {data, result};
  const out = write(ctx, s, data, name, args);
  log(ctx, APP + '.' + name, {object_id: out.id});
  return {data, result: out};
}
module.exports = {handleTool, scope};
