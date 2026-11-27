'use strict';
// W4: answering a removal request. honor removes the named items that are mine from the albums in
// scope that are shared with someone (an invited or joined member or an active link), and so from
// every link to them, in one step; decline records the note and changes nothing. What cannot be
// undone, the views and saves already recorded, is listed in the result.
const c = require('./common.cjs');
const d = require('./derive.cjs');
const {viewView} = require('./reads.cjs');

// The albums an honour would clear for a request at time t (also what exposure.get previews).
function targets(data, r, t) {
  if (r.scope.type === 'album') {
    const album = data.albums.find(a => a.id === r.scope.album_id);
    return album && d.isShared(data, album, t) ? [album] : [];
  }
  return data.albums.filter(a => d.isShared(data, a, t));
}

function respond(ctx, data, args) {
  const t = d.now(ctx), r = data.removals.find(x => x.id === args.id);
  if (!r) c.fail('not_found', 'No removal request ' + args.id + '.');
  if (r.state !== 'pending' && r.state !== 'declined') c.fail('invalid_state', 'Removal request ' + r.id + ' is ' + r.state + '; only a pending or declined request can be answered.');
  if (r.state === 'declined' && args.decision === 'decline') c.fail('invalid_state', 'Removal request ' + r.id + ' is already declined.');
  const answer = {decision: args.decision, note: args.note ?? null, at: ctx.virtual_now, request_id: args.request_id};
  const items = new Map(data.items.map(i => [i.id, i]));
  const mine = r.item_ids.filter(id => items.has(id));
  const alreadySeen = r.item_ids.map(id => {
    const views = data.views.filter(v => v.viewed_item_ids.includes(id)).map(v => viewView(data, v));
    return {item_id: id, views, saves: views.filter(v => v.saved_item_ids.includes(id))};
  }).filter(x => x.views.length);
  if (args.decision === 'decline') {
    r.state = 'declined';
    r.answers.push(answer);
    c.activity(ctx, data, {actor: 'agent', action: 'removals.respond', object_ids: [r.id, ...mine], request_id: args.request_id, details: {decision: 'decline'}});
    return {id: r.id, state: 'declined', cleared: [], not_removable: r.not_removable.slice(), already_seen: alreadySeen};
  }
  const albums = targets(data, r, t), cleared = [];
  for (const id of mine) {
    const from = albums.filter(a => a.item_ids.includes(id));
    const linkIds = from.flatMap(a => d.activeLinks(data, a.id, t).map(l => l.id));
    for (const a of from) a.item_ids = a.item_ids.filter(x => x !== id);
    const row = {item_id: id, album_ids: from.map(a => a.id), link_ids: linkIds};
    cleared.push(row);
    const item = items.get(id);
    item.removal_history.push({removal_id: r.id, person_id: r.from_person_id, album_ids: row.album_ids.slice(), at: ctx.virtual_now});
    c.history(ctx, item, 'removal_honored', {request_id: args.request_id, changes: {albums_cleared: row.album_ids.slice()}});
  }
  Object.assign(r, {state: 'honored', cleared, honored_at: ctx.virtual_now});
  r.answers.push(answer);
  c.activity(ctx, data, {actor: 'agent', action: 'removals.respond', object_ids: [r.id, ...mine], request_id: args.request_id,
    details: {decision: 'honor', cleared: c.copy(cleared), not_removable: r.not_removable.slice()}});
  return {id: r.id, state: 'honored', cleared: c.copy(cleared), not_removable: r.not_removable.slice(), already_seen: alreadySeen};
}
module.exports = {WRITES: {'fernshelf.removals.respond': respond}};
