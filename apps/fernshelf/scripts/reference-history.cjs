'use strict';
// The reference library's history from the day the account was opened (2025-01-04) to the fixture
// clock, used by scripts/build-reference-fixture.cjs. It draws from its own fixed seed, so the
// records drawn by the builder keep their IDs and values. It adds:
//   - edits over time (captions, favourites, archived screenshots, the cover picked in a stack) as
//     `updated` history rows, at waking hours in the account's time zone;
//   - a few items trashed and restored, and eight photos trashed in 2025 and purged since
//     (four with items.purge, four when their retention ended);
//   - 2025 sharing: Trail days with a link that expired and an invitation Theo declined, Pip with a
//     link that was revoked and Mum joining and later leaving, their views and saves, and two
//     removal requests (one honoured, one declined);
//   - the time each album item was added to its album, all notifications (with the wording the
//     App itself writes), and the activity log, row for row as the App writes it for the same
//     writes and events (one item.added event per item, effect rows for backups, stacks, members,
//     contributions and notifications).
// Every date follows the App's rules as of that date: link windows, member status, retention,
// purge and the storage threshold. scripts/check-fixtures.cjs checks the result independently.
const {wireMessage} = require('../src/notify.cjs');

function extend(B) {
  const {items, stacks, albums, links, views, removals, people, base, ACCOUNT, OWNER, OPENED, CLOCK, QUOTA, RETENTION, ZONE,
    local, plus, days, before, H, R2, between2, photoBytes2} = B;
  const ms = Date.parse, need = (cond, what) => { if (!cond) throw Error('Reference history: ' + what); };
  const itemOf = new Map(items.map(i => [i.id, i]));
  const albumOf = id => albums.find(a => a.id === id);
  const inAnyAlbum = new Set(albums.flatMap(a => a.item_ids));
  const inStack = new Set(stacks.flatMap(s => s.item_ids));
  const viewed = new Set(views.flatMap(v => v.viewed_item_ids));
  const requested = new Set(removals.flatMap(r => r.item_ids));
  const clock = ms(CLOCK);

  // ---- 2025 sharing -----------------------------------------------------------------------------
  const pip = albumOf('al-pip'), trails = albumOf('al-trails');
  pip.created_at = local('2025-03-02T20:00:00');
  trails.created_at = local('2025-05-03T20:00:00');
  const addedBy = (list, at) => list.filter(id => itemOf.has(id) && before(itemOf.get(id).added_at, plus(at, -86400)));
  const member = (person_id, role, status, invited_at, joined_at = null, ended_at = null) => ({person_id, role, status, invited_at, joined_at, ended_at,
    history: [H(invited_at, 'invited'), ...(joined_at ? [H(joined_at, 'joined')] : []), ...(ended_at ? [H(ended_at, status)] : [])]});
  trails.members.push(member('person-theo', 'viewer', 'declined', local('2025-06-14T19:10:00'), null, local('2025-06-16T08:20:00')));
  pip.members.push(member('person-ruth', 'viewer', 'left', local('2025-07-20T18:05:00'), local('2025-07-21T07:45:00'), local('2025-12-01T21:00:00')));
  links.unshift(
    {id: 'ln-0001', album_id: 'al-trails', created_at: local('2025-06-14T19:00:00'), expires_at: local('2025-07-14T19:00:00'), revoked_at: null, revoke_reason: null, request_id: null},
    {id: 'ln-0002', album_id: 'al-pip', created_at: local('2025-07-20T18:00:00'), expires_at: null, revoked_at: local('2025-10-05T09:15:00'), revoke_reason: 'revoked', request_id: null});
  const trailsShown = addedBy(trails.item_ids, local('2025-06-14T19:00:00')), pipShown = addedBy(pip.item_ids, local('2025-07-20T18:00:00'));
  need(trailsShown.length >= 4 && pipShown.length >= 6, 'too few 2025 items in Trail days or Pip');
  const view = (id, at, surface, viewer, list, saved = []) => ({id, at, surface, viewer: viewer ? {person_id: viewer, anonymous: false} : {person_id: null, anonymous: true},
    viewed_item_ids: list, saved_item_ids: saved, event_id: null, resolved_by_match: false});
  const L = (link_id, album_id) => ({type: 'link', album_id, link_id}), A = album_id => ({type: 'album', album_id, link_id: null});
  // The honoured request below takes pipShown[2] out of Pip, so only earlier views show it.
  views.push(
    view('vw-0001', local('2025-06-15T08:30:00'), L('ln-0001', 'al-trails'), 'person-sam', trailsShown.slice(0, 4), [trailsShown[1]]),
    view('vw-0002', local('2025-06-21T21:05:00'), L('ln-0001', 'al-trails'), null, trailsShown.slice(1, 3)),
    view('vw-0011', local('2025-07-21T07:50:00'), A('al-pip'), 'person-ruth', pipShown.slice(0, 5)),
    view('vw-0012', local('2025-08-02T12:40:00'), L('ln-0002', 'al-pip'), 'person-theo', pipShown.slice(1, 4), [pipShown[3]]),
    view('vw-0013', local('2025-09-10T20:15:00'), L('ln-0002', 'al-pip'), null, [pipShown[0], pipShown[4]]));
  views.sort((a, b) => ms(a.at) - ms(b.at) || (a.id < b.id ? -1 : 1));
  const irisItem = pipShown[2], samItem = trailsShown[0];
  const honoredAt = local('2025-08-21T19:30:00');
  removals.push(
    {id: 'rr-0010', from_person_id: 'person-iris', item_ids: [irisItem], not_removable: [], scope: {type: 'everywhere', album_id: null},
      message: 'I am at the edge of the park picture with Pip. Could you keep that one off anything shared?', requested_at: local('2025-08-20T22:10:00'), event_id: null,
      state: 'honored', answers: [{decision: 'honor', note: 'Of course, it is down now.', at: honoredAt, request_id: null}],
      cleared: [{item_id: irisItem, album_ids: ['al-pip'], link_ids: ['ln-0002']}], honored_at: honoredAt, withdrawn_at: null, withdraw_message: null},
    {id: 'rr-0011', from_person_id: 'person-sam', item_ids: [samItem], not_removable: [], scope: {type: 'album', album_id: 'al-trails'},
      message: 'Can the muddy one of me come off the trail album?', requested_at: local('2025-06-16T18:40:00'), event_id: null, state: 'declined',
      answers: [{decision: 'decline', note: 'It is the only one from the top, so I am keeping it. The link ends next month.', at: local('2025-06-17T08:05:00'), request_id: null}],
      cleared: null, honored_at: null, withdrawn_at: null, withdraw_message: null});
  const iris = itemOf.get(irisItem);
  iris.removal_history.push({removal_id: 'rr-0010', person_id: 'person-iris', album_ids: ['al-pip'], at: honoredAt});
  iris.history.push(H(honoredAt, 'removal_honored', {changes: {albums_cleared: ['al-pip']}}));
  pip.item_ids = pip.item_ids.filter(id => id !== irisItem);

  // ---- edits over time ------------------------------------------------------------------------
  // What the account holder does happens between 07:00 and 23:00 in the account's time zone: a time
  // drawn in the night moves to 07:00 that morning (same minutes), or, if that is too late, to
  // 22:00 the evening before.
  const hourOf = t => Number(fmt(t, B).slice(11, 13));
  const waking = (t, lo = -Infinity, hi = Infinity) => {
    const h = hourOf(t);
    if (h >= 7 && h < 23) return t;
    const morning = t + ((h < 7 ? 7 : 31) - h) * 3600000, evening = t - ((h < 7 ? h + 24 : h) - 22) * 3600000;
    return morning < hi ? morning : evening >= lo ? evening : null;
  };
  const lastFor = it => (it.trashed_at ? ms(it.trashed_at) : clock) - 3600000;
  const updates = [];
  for (const it of items) {
    if (it.history[0].action === 'imported' && R2() < 0.5) continue;
    const fields = [];
    if (it.caption !== null && it.source === 'camera' && R2() < 0.55) fields.push(['caption', null, it.caption]);
    if (it.favorite) fields.push(['favorite', false, true]);
    if (it.archived) fields.push(['archived', false, true]);
    for (const [k, from, to] of fields) {
      const drawn = ms(plus(it.added_at, between2(2, 40) * 3600 + between2(0, 20) * 86400)), when = waking(drawn, ms(it.added_at), lastFor(it));
      if (when === null || when > lastFor(it)) continue;
      const at = fmt(when, B);
      it.history.push(H(at, 'updated', {changes: {[k]: {from, to}}}));
      updates.push({at, item: it, fields: [k]});
    }
  }

  // A stack's first item is its cover until the account holder picks another version: the cover
  // seen now was picked 25 minutes after the stack's last version arrived.
  for (const s of stacks) {
    const versions = s.item_ids.map(id => itemOf.get(id)).sort((a, b) => ms(a.added_at) - ms(b.added_at) || (a.id < b.id ? -1 : 1));
    if (versions[0].id === s.cover_id) continue;
    const last = Math.max(...versions.map(v => ms(v.added_at))), at = fmt(waking(last + 1500000, last), B), cover = itemOf.get(s.cover_id);
    need(ms(at) < clock, s.id + ' cover chosen before the clock');
    cover.history.push(H(at, 'updated', {changes: {cover: {from: versions[0].id, to: cover.id}}}));
    updates.push({at, item: cover, fields: ['make_cover'], stack: s});
  }

  // ---- trashed and restored, in 2025 ----------------------------------------------------------
  const quiet = it => it.state === 'active' && it.kind === 'photo' && !inAnyAlbum.has(it.id) && !inStack.has(it.id) && !viewed.has(it.id) && !requested.has(it.id) &&
    it.history.length === 1 && it.file === null && it.added_at.startsWith('2025') && ms(it.added_at) < ms(local('2025-11-01T00:00:00'));
  const restored = [];
  for (const it of base.filter(quiet).filter((_, k) => k % 11 === 3).slice(0, 5)) {
    const at = fmt(waking(ms(plus(it.added_at, between2(3, 30) * 86400 + between2(1, 5) * 3600))), B), back = fmt(waking(ms(plus(at, between2(1, 12) * 86400))), B);
    it.history.push(H(at, 'trashed'), H(back, 'restored'));
    restored.push({item: it, at, back});
  }
  need(restored.length === 5, 'five items trashed and restored');

  // ---- eight photos trashed in 2025 and purged since -------------------------------------------
  const purged = [];
  const outings2025 = base.filter(i => i.taken_at.startsWith('2025') && i.place && i.history[0].action === 'added');
  for (let k = 0; k < 8; k++) {
    const like = outings2025[(k * 13 + 5) % outings2025.length];
    const taken = plus(like.taken_at, 40 + k * 3), added = plus(taken, between2(60, 3000));
    const id = 'it-' + taken.slice(2, 4) + taken.slice(5, 7) + '-' + String(801 + k).padStart(4, '0');
    need(!itemOf.has(id), 'purged item ID ' + id + ' is new');
    const trashedAt = fmt(waking(ms(plus(added, between2(2, 60) * 86400 + between2(1, 8) * 3600))), B), purgeAt = days(trashedAt, RETENTION);
    const byHand = k < 4, purgedAt = byHand ? fmt(waking(ms(plus(trashedAt, between2(1, 6) * 86400))), B) : purgeAt;
    need(ms(purgeAt) < clock && ms(purgedAt) < clock, 'purge before the clock');
    const it = {id, kind: 'photo', taken_at: taken, added_at: added, place: null, people: [], caption: null, source: 'camera', favorite: false, archived: false,
      backed_up: true, declared_bytes: photoBytes2(), content_hash: null, width: 4032, height: 3024, duration_ms: null, file: null, state: 'purged',
      trashed_at: trashedAt, purge_at: purgeAt, purged_at: purgedAt, saved_from: null, removal_history: [],
      history: [H(added, 'added'), H(trashedAt, 'trashed'), ...(byHand ? [H(purgedAt, 'purged')] : [])]};
    items.push(it); itemOf.set(id, it);
    purged.push({item: it, byHand});
  }
  for (const it of items) it.history.sort((a, b) => ms(a.at) - ms(b.at));

  // ---- when each item entered each album ------------------------------------------------------
  // The latest moment an item can have entered an album: before any view of that album shows it,
  // before a removal request about it, and before it went to the trash.
  const entries = [];
  for (const a of albums) {
    const cleared = removals.filter(r => r.cleared).flatMap(r => r.cleared.filter(c => c.album_ids.includes(a.id)).map(c => ({id: c.item_id, r})));
    const mine = [...a.item_ids.filter(id => itemOf.has(id)), ...cleared.map(c => c.id)];
    const groups = new Map();
    for (const id of mine) {
      const it = itemOf.get(id), lo = Math.max(ms(a.created_at), ms(it.added_at));
      let hi = it.trashed_at ? ms(it.trashed_at) : clock;
      for (const v of views) if (v.surface.album_id === a.id && v.viewed_item_ids.includes(id)) hi = Math.min(hi, ms(v.at));
      for (const r of removals) if (r.item_ids.includes(id) && (r.scope.album_id === a.id || cleared.some(c => c.id === id && c.r === r))) hi = Math.min(hi, ms(r.requested_at));
      // Items the library already held go in two minutes after the album is created; later ones
      // within three days of being added, and always before anything that needs them there.
      let at = ms(it.added_at) <= ms(a.created_at) ? ms(a.created_at) + 120000 : Math.min(lo + between2(1, 72) * 3600000, hi - 60000);
      at = Math.max(lo, Math.floor(at / 60000) * 60000);
      at = waking(at, lo, hi) ?? at;
      need(at >= lo && at < hi, it.id + ' cannot have entered ' + a.id);
      if (!groups.has(at)) groups.set(at, {album: a, at, ids: []});
      groups.get(at).ids.push(id);
    }
    entries.push(...groups.values());
  }
  for (const g of entries) for (const id of g.ids) need(g.at >= Math.max(ms(g.album.created_at), ms(itemOf.get(id).added_at)), id + ' entered ' + g.album.id + ' too early');
  const enteredAt = new Map(entries.flatMap(g => g.ids.map(id => [g.album.id + '|' + id, g.at])));
  // What an album shows at time t, for the wording of a "joined" notification.
  const showsAt = (a, t) => {
    let n = 0;
    for (const [key, at] of enteredAt) {
      const [aid, id] = key.split('|');
      if (aid !== a.id || at > t) continue;
      const it = itemOf.get(id);
      if (it.trashed_at && ms(it.trashed_at) <= t) continue;
      if (it.removal_history.some(h => h.album_ids.includes(a.id) && ms(h.at) <= t)) continue;
      n++;
    }
    return n + a.contributions.filter(k => ms(k.added_at) <= t && (!k.removed_at || ms(k.removed_at) > t)).length;
  };

  // ---- the activity log -------------------------------------------------------------------------
  // Rows shaped exactly as the App writes them (src/events.cjs, src/library.cjs, src/albums.cjs,
  // src/removals.cjs, src/notify.cjs): the same actions, object IDs and details keys, each event's
  // row followed by one row per effect (cause_seq names the event's row), and one effect row for
  // each notification. Every item arrives through its own item.added event. The account holder's
  // own changes carry actor `agent`, as the plan defines the actor of every account write; what the
  // phone and other people did carries actor `event`. Seeded rows have neither a request_id nor an
  // event_id, which every row the App writes during a run has: that is how a grader tells them apart.
  const groups = [];
  const happen = (at, order, tie, rows, notes = []) => groups.push({at: ms(at), order, tie, rows, notes});
  const agent = (action, object_ids, details) => ({actor: 'agent', action, object_ids, ...(details ? {details} : {})});
  const event = (action, object_ids, details) => ({actor: 'event', action, object_ids, ...(details ? {details} : {})});
  const plural = (n, one) => n + ' ' + (n === 1 ? one : one + 's');
  const nameOf = id => people.find(p => p.person_id === id).display_name;
  // Bytes in use at time t: backed-up items added by t that were not purged by t.
  const goneAt = it => (it.state === 'purged' ? ms(it.purged_at) : it.state === 'trashed' && ms(it.purge_at) <= clock ? ms(it.purge_at) : Infinity);
  const usedAt = t => items.reduce((n, i) => n + (i.backed_up && ms(i.added_at) <= t && goneAt(i) > t ? i.declared_bytes : 0), 0);
  const eighty = used => ({kind: 'storage.threshold', level: 80, object_type: 'account', object_id: ACCOUNT, title: 'Your Fernshelf storage is 80% full',
    body: 'You are using ' + (used / 1e9).toFixed(2) + ' GB of your ' + (QUOTA / 1e9).toFixed(2) + ' GB. When it is full, new photos and videos wait on your device until there is space. Open Fernshelf to review storage and the trash.'});

  // Arrivals: one item.added event per item, its backup, its stack, and the 80% notice when that
  // item takes the used bytes over 80% of the quota.
  const arrivals = items.slice().sort((a, b) => ms(a.added_at) - ms(b.added_at) || (a.id < b.id ? -1 : 1));
  const stackOf = new Map(stacks.flatMap(s => s.item_ids.map(id => [id, s]))), firstOf = new Map();
  arrivals.forEach((it, k) => {
    need(it.backed_up && it.history[0].action === 'added', it.id + ' arrives backed up');
    const st = stackOf.get(it.id), t = ms(it.added_at);
    const later = arrivals.slice(k).filter(x => ms(x.added_at) === t).reduce((n, x) => n + x.declared_bytes, 0);
    const before = usedAt(t) - later, after = before + it.declared_bytes;
    const rows = [event('event.item.added', [it.id, ...(st ? [st.id] : [])], {declared_bytes: it.declared_bytes}),
      event('effect.item.backed_up', [it.id], {declared_bytes: it.declared_bytes})];
    if (st && !firstOf.has(st.id)) { firstOf.set(st.id, it.id); rows.push(event('effect.stack.created', [st.id, it.id], {kind: st.kind})); }
    else if (st) rows.push(event('effect.stack.joined', [st.id, it.id], {cover_id: firstOf.get(st.id)}));
    happen(it.added_at, 2, k, rows, before < 0.8 * QUOTA && after >= 0.8 * QUOTA ? [eighty(after)] : []);
  });
  // A stack is created by its first item; its later cover is the account holder's choice.
  for (const s of stacks) {
    s.created_at = arrivals.find(i => stackOf.get(i.id) === s).added_at;
    need(!s.item_ids.some(id => itemOf.get(id).trashed_at), s.id + ' has no version in the trash');
  }
  for (const u of updates) happen(u.at, 3, u.item.id, [agent('items.update', [u.item.id, ...(u.stack ? [u.stack.id] : [])], {fields: u.fields})]);
  for (const r of restored) {
    happen(r.at, 3, r.item.id, [agent('items.trash', [r.item.id], {purge_at: days(r.at, RETENTION), covers_changed: []})]);
    happen(r.back, 3, r.item.id, [agent('items.restore', [r.item.id])]);
  }
  for (const it of items.filter(i => i.trashed_at && !restored.some(r => r.item === i))) happen(it.trashed_at, 3, it.id, [agent('items.trash', [it.id], {purge_at: it.purge_at, covers_changed: []})]);
  for (const p of purged.filter(x => x.byHand)) happen(p.item.purged_at, 3, p.item.id, [agent('items.purge', [p.item.id], {freed_bytes: p.item.declared_bytes})]);
  for (const a of albums) happen(a.created_at, 4, a.id, [agent('albums.create', [a.id])]);
  for (const g of entries.sort((x, y) => x.at - y.at || (x.album.id < y.album.id ? -1 : 1))) {
    for (let k = 0; k < g.ids.length; k += 50) {
      const add = g.ids.slice(k, k + 50);
      happen(fmt(g.at, B), 5, g.album.id + k, [agent('albums.update', [g.album.id, ...add], {added: add, removed: []})]);
    }
  }
  for (const a of albums) {
    for (const m of a.members) {
      happen(m.invited_at, 6, a.id + m.person_id, [agent('albums.members.invite', [a.id, m.person_id], {role: m.role})]);
      const who = nameOf(m.person_id), change = (c, status, extra = []) => [event('event.member.changed', [a.id, m.person_id], {change: c, album_id: a.id, resolved_by_match: false}),
        event('effect.member.' + status, [a.id, m.person_id]), ...extra];
      if (m.joined_at) {
        happen(m.joined_at, 7, a.id + m.person_id, change('join', 'joined'), [{kind: 'album.activity', object_type: 'album', object_id: a.id, title: who + ' joined ' + a.title,
          body: who + ' accepted your invitation and can now see the ' + plural(showsAt(a, ms(m.joined_at)), 'item') + ' in the shared album ' + a.title + '.'}]);
      }
      if (m.status === 'declined') {
        happen(m.ended_at, 7, a.id + m.person_id, change('decline', 'declined'), [{kind: 'album.activity', object_type: 'album', object_id: a.id,
          title: who + ' declined your invitation to ' + a.title, body: who + ' declined your invitation to the album ' + a.title + '.'}]);
      }
      if (m.status === 'left') {
        const dropped = a.contributions.filter(k => k.person_id === m.person_id && k.removed_reason === 'member_left').map(k => k.id);
        happen(m.ended_at, 7, a.id + m.person_id, change('leave', 'left', dropped.length ? [event('effect.contributions.removed', [a.id, ...dropped], {reason: 'member_left'})] : []),
          [{kind: 'album.activity', object_type: 'album', object_id: a.id, title: who + ' left ' + a.title,
            body: who + ' left the shared album ' + a.title + '.' + (dropped.length ? ' The ' + plural(dropped.length, 'item') + ' they added left the album with them; anything you saved stays in your library.' : '')}]);
      }
    }
    const batches = new Map();
    for (const k of a.contributions) {
      need(!k.removed_reason || k.removed_reason === 'member_left', k.id + ' leaves only with its member');
      const key = k.person_id + '|' + k.added_at;
      if (!batches.has(key)) batches.set(key, []);
      batches.get(key).push(k);
    }
    for (const list of batches.values()) {
      const who = nameOf(list[0].person_id), ids = list.map(k => k.id), words = plural(list.length, list.every(k => k.kind === 'video') ? 'video' : list.every(k => k.kind === 'photo') ? 'photo' : 'item');
      happen(list[0].added_at, 8, a.id + list[0].person_id, [event('event.contribution.changed', [a.id, list[0].person_id, ...ids], {album_id: a.id, resolved_by_match: false, added: ids, removed: []}),
        event('effect.contributions.added', [a.id, ...ids])],
      [{kind: 'album.activity', object_type: 'album', object_id: a.id, title: who + ' added ' + words + ' in ' + a.title,
        body: who + ' added ' + words + ' in the shared album ' + a.title + '. Contributions are not in your library until you save them.'}]);
    }
  }
  for (const l of links) {
    happen(l.created_at, 6, l.id, [agent('links.create', [l.id, l.album_id])]);
    if (l.revoked_at) happen(l.revoked_at, 6, l.id, [agent('links.revoke', [l.id, l.album_id])]);
  }
  for (const v of views) {
    happen(v.at, 9, v.id, [event('event.share.viewed', [v.id, ...(v.surface.link_id ? [v.surface.link_id] : []), v.surface.album_id, ...v.viewed_item_ids],
      {surface: {...v.surface}, resolved_by_match: false, viewed: v.viewed_item_ids.length, saved: v.saved_item_ids.slice()})]);
  }
  for (const r of removals) {
    const who = nameOf(r.from_person_id), n = r.item_ids.length, where = r.scope.album_id ? 'the shared album ' + albumOf(r.scope.album_id).title : 'everywhere they are shared';
    happen(r.requested_at, 10, r.id, [event('event.removal.requested', [r.id, ...r.item_ids, ...(r.scope.album_id ? [r.scope.album_id] : [])],
      {scope: {...r.scope}, resolved_by_match: false, not_removable: r.not_removable.slice()})],
    [{kind: 'removal.requested', object_type: 'removal_request', object_id: r.id, title: who + ' asked you to take down ' + plural(n, 'photo'),
      body: who + ' asked that ' + plural(n, 'photo') + ' showing them be removed from ' + where + '.' + (r.message ? ' Their note: ' + r.message : '') +
        ' Open Fernshelf to see where each photo is visible and to answer the request.'}]);
    const mine = r.item_ids.filter(id => itemOf.has(id));
    for (const ans of r.answers) {
      happen(ans.at, 11, r.id, [agent('removals.respond', [r.id, ...mine], ans.decision === 'honor' ? {decision: 'honor', cleared: JSON.parse(JSON.stringify(r.cleared)),
        not_removable: r.not_removable.slice()} : {decision: 'decline'})]);
    }
    if (r.withdrawn_at) {
      happen(r.withdrawn_at, 11, r.id, [event('event.removal.withdrawn', [r.id], {})],
        [{kind: 'removal.withdrawn', object_type: 'removal_request', object_id: r.id, title: who + ' withdrew a removal request',
          body: who + ' withdrew their request to take down ' + plural(n, 'photo') + '.' + (r.withdraw_message ? ' Their note: ' + r.withdraw_message : '') + ' Nothing in your albums was changed.'}]);
    }
  }
  groups.sort((x, y) => x.at - y.at || x.order - y.order || (x.tie < y.tie ? -1 : x.tie > y.tie ? 1 : 0));
  const activity = [], notifications = [];
  const stub = {account_id: ACCOUNT, owner_person_id: OWNER};
  const push = (at, row, cause_seq) => {
    const seq = activity.length + 1;
    activity.push({seq, at, actor: row.actor, action: row.action, object_ids: row.object_ids, request_id: null, event_id: null, warnings: [],
      ...(cause_seq ? {cause_seq} : {}), ...(row.details ? {details: row.details} : {})});
    return seq;
  };
  for (const g of groups) {
    need(g.at <= clock, 'activity after the clock: ' + g.rows[0].action);
    const at = fmt(g.at, B), cause = push(at, g.rows[0]);
    for (const row of g.rows.slice(1)) push(at, row, cause);
    for (const note of g.notes) {
      const n = {id: 'ntf-' + String(notifications.length + 1).padStart(4, '0'), kind: note.kind, at, title: note.title, body: note.body,
        object_type: note.object_type, object_id: note.object_id, event_id: null, level: note.level ?? null, wire: null};
      n.wire = wireMessage(stub, n);
      notifications.push(n);
      push(at, {actor: 'event', action: 'effect.notification.written', object_ids: [n.id, n.object_id], details: {kind: n.kind, ...(n.level !== null ? {level: n.level} : {})}}, cause);
    }
  }
  return {activity, notifications, purged: purged.length, restored: restored.length, updates: updates.length};
}
// A millisecond instant as a timestamp with the account zone's offset (the builder's spelling).
const fmt = (t, B) => B.fromUtc(t);
module.exports = {extend};
