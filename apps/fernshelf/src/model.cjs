'use strict';
// Record consistency (validateSeed), the records/objects Core counts, and media relationships.
// The seed is history: everything in it has already happened. validateSeed runs on every load and
// after every committed write or event, so it checks invariants, not the current clock.
const c = require('./common.cjs');

function bad(message) { c.fail('invalid_seed', message); }
function validateSeed(ctx, data) {
  // The account and its owner must be declared by the run's trusted binding.
  if (!ctx.binding.people.some(p => p.person_id === data.owner_person_id) ||
    !ctx.binding.accounts.some(a => a.app_id === ctx.app_id && a.account_id === data.account_id && a.owner_person_id === data.owner_person_id)) {
    bad('Accounts and people must be declared in the trusted binding.');
  }
  const unique = (list, key, what) => {
    const seen = new Set();
    for (const x of list) { if (seen.has(x[key])) bad('Duplicate ' + what + ' ID ' + x[key]); seen.add(x[key]); }
    return seen;
  };
  const people = unique(data.people, 'person_id', 'person');
  if (people.has(data.owner_person_id)) bad('The account holder is not listed among other people.');
  const knownPerson = id => people.has(id) || id === data.owner_person_id;
  const labels = unique(data.labels, 'id', 'label');
  for (const l of data.labels) if (l.person_id !== null && !knownPerson(l.person_id)) bad('Label ' + l.id + ' names an unknown person.');
  unique(data.stacks, 'id', 'stack'); unique(data.albums, 'id', 'album'); unique(data.links, 'id', 'link');
  unique(data.views, 'id', 'view'); unique(data.removals, 'id', 'removal request'); unique(data.notifications, 'id', 'notification');
  // Items and contributions share one ID space.
  const itemIds = unique(data.items, 'id', 'item'), contributionAlbum = new Map();
  for (const album of data.albums) for (const k of album.contributions) {
    if (itemIds.has(k.id) || contributionAlbum.has(k.id)) bad('Duplicate item ID ' + k.id);
    contributionAlbum.set(k.id, album);
  }
  const ts = c.ms, items = new Map(data.items.map(i => [i.id, i]));
  const checkLabels = (list, owner) => { for (const l of list) if (!labels.has(l)) bad(owner + ' carries unknown label ' + l); };
  for (const i of data.items) {
    checkLabels(i.people, 'Item ' + i.id);
    if (ts(i.taken_at) > ts(i.added_at)) bad('Item ' + i.id + ' was taken after it was added.');
    if (i.state === 'active' && (i.trashed_at || i.purge_at || i.purged_at)) bad('Active item ' + i.id + ' has trash times.');
    if (i.state === 'trashed' && (!i.trashed_at || !i.purge_at || i.purged_at || ts(i.purge_at) <= ts(i.trashed_at))) bad('Trashed item ' + i.id + ' needs trashed_at and a later purge_at.');
    if (i.state === 'purged' && (!i.purged_at || i.file !== null)) bad('Purged item ' + i.id + ' needs purged_at and no file.');
    if (!i.backed_up && i.file !== null) bad('Item ' + i.id + ' is not backed up but has a file.');
    if (i.kind === 'video' && i.file !== null) bad('Video ' + i.id + ' has an image file; videos are metadata only.');
    if ((i.source === 'saved_from_share') !== (i.saved_from !== null)) bad('Item ' + i.id + ': saved_from goes with source saved_from_share.');
    if (i.saved_from && contributionAlbum.get(i.saved_from.contribution_id)?.id !== i.saved_from.album_id) bad('Item ' + i.id + ' was saved from an unknown contribution.');
    for (const r of i.removal_history) if (!data.removals.some(q => q.id === r.removal_id && q.state === 'honored')) bad('Item ' + i.id + ' has a removal_history row without an honoured request.');
  }
  const stackOf = new Map();
  for (const s of data.stacks) {
    for (const id of s.item_ids) {
      if (!items.has(id)) bad('Stack ' + s.id + ' names unknown item ' + id);
      if (stackOf.has(id)) bad('Item ' + id + ' is in two stacks.');
      stackOf.set(id, s.id);
    }
    const active = s.item_ids.filter(id => items.get(id).state === 'active');
    if (s.cover_id === null ? active.length > 0 : !active.includes(s.cover_id)) bad('Stack ' + s.id + ' needs an active cover among its items (none only when it has no active item).');
  }
  for (const album of data.albums) {
    const members = new Set();
    for (const m of album.members) {
      if (!people.has(m.person_id)) bad('Album ' + album.id + ' has unknown member ' + m.person_id);
      if (members.has(m.person_id)) bad('Album ' + album.id + ' lists ' + m.person_id + ' twice.');
      members.add(m.person_id);
      const okTimes = {invited: !m.joined_at && !m.ended_at, joined: !!m.joined_at && !m.ended_at, declined: !m.joined_at && !!m.ended_at,
        left: !!m.ended_at, removed: !!m.ended_at}[m.status];
      if (!okTimes) bad('Member ' + m.person_id + ' of ' + album.id + ': joined_at and ended_at do not match status ' + m.status + '.');
    }
    const held = new Set();
    for (const id of album.item_ids) {
      if (held.has(id)) bad('Album ' + album.id + ' holds ' + id + ' twice.');
      held.add(id);
      const item = items.get(id);
      if (item) {
        if (!item.backed_up) bad('Item ' + id + ' is not backed up but sits in album ' + album.id);
        if (item.state === 'purged') bad('Purged item ' + id + ' still sits in album ' + album.id);
      } else if (contributionAlbum.get(id) !== album || album.contributions.find(k => k.id === id).removed_at) bad('Album ' + album.id + ' holds unknown item ' + id);
    }
    for (const k of album.contributions) {
      checkLabels(k.people, 'Contribution ' + k.id);
      const m = album.members.find(x => x.person_id === k.person_id);
      if (!m) bad('Contribution ' + k.id + ' comes from someone who is not a member.');
      if (!k.removed_at && (!held.has(k.id) || m.status !== 'joined')) bad('Present contribution ' + k.id + ' must sit in the album and come from a joined member.');
      if (!!k.removed_at !== !!k.removed_reason) bad('Contribution ' + k.id + ': removed_at goes with removed_reason.');
    }
  }
  const albums = new Map(data.albums.map(a => [a.id, a]));
  for (const l of data.links) {
    const album = albums.get(l.album_id);
    if (!album) bad('Link ' + l.id + ' shows unknown album ' + l.album_id);
    if (l.expires_at && ts(l.expires_at) <= ts(l.created_at)) bad('Link ' + l.id + ' expires before it was created.');
    if (!!l.revoked_at !== !!l.revoke_reason) bad('Link ' + l.id + ': revoked_at goes with revoke_reason.');
    if (album.deleted_at && !l.revoked_at) bad('Link ' + l.id + ' of deleted album ' + album.id + ' is not revoked.');
  }
  const links = new Map(data.links.map(l => [l.id, l]));
  for (const v of data.views) {
    const album = albums.get(v.surface.album_id);
    if (!album) bad('View ' + v.id + ' names unknown album.');
    if (v.surface.type === 'link' ? links.get(v.surface.link_id)?.album_id !== album.id : v.surface.link_id !== null) bad('View ' + v.id + ' names an unknown link.');
    if (v.viewer.anonymous === (v.viewer.person_id !== null)) bad('View ' + v.id + ' needs either a person or anonymous.');
    if (v.viewer.anonymous && v.surface.type === 'album') bad('View ' + v.id + ': an album is viewed by its members, not anonymously.');
    if (v.viewer.person_id && !people.has(v.viewer.person_id)) bad('View ' + v.id + ' names an unknown viewer.');
    for (const id of [...v.viewed_item_ids, ...v.saved_item_ids]) if (!items.has(id) && !contributionAlbum.has(id)) bad('View ' + v.id + ' names unknown item ' + id);
    for (const id of v.saved_item_ids) if (!v.viewed_item_ids.includes(id)) bad('View ' + v.id + ' saves an item it did not show.');
  }
  for (const r of data.removals) {
    if (!people.has(r.from_person_id)) bad('Removal request ' + r.id + ' comes from an unknown person.');
    for (const id of r.item_ids) if (!items.has(id) && !contributionAlbum.has(id)) bad('Removal request ' + r.id + ' names unknown item ' + id);
    if (JSON.stringify(r.not_removable) !== JSON.stringify(r.item_ids.filter(id => !items.has(id)))) bad('Removal request ' + r.id + ': not_removable must list exactly the items that are not mine.');
    if ((r.scope.type === 'album') !== (r.scope.album_id !== null) || (r.scope.album_id && !albums.has(r.scope.album_id))) bad('Removal request ' + r.id + ' has an invalid scope.');
    if ((r.state === 'honored') !== (r.cleared !== null && r.honored_at !== null)) bad('Removal request ' + r.id + ': an honoured request records its cleared surfaces and time.');
    if ((r.state === 'withdrawn') !== (r.withdrawn_at !== null)) bad('Removal request ' + r.id + ': withdrawn_at goes with withdrawn.');
    const last = r.answers[r.answers.length - 1];
    if ((r.state === 'honored' || r.state === 'declined') !== !!last || (last && last.decision !== (r.state === 'honored' ? 'honor' : 'decline'))) bad('Removal request ' + r.id + ': its answers do not match its state.');
    if (r.state === 'honored') for (const id of r.item_ids) if (items.has(id) && !items.get(id).removal_history.some(h => h.removal_id === r.id)) bad('Item ' + id + ' lacks the removal_history row of ' + r.id);
  }
  let seq = 0;
  for (const a of data.activity) { if (a.seq <= seq) bad('Activity rows must have increasing seq.'); seq = a.seq; }
}

// Records counted by Core (bundle quality checks) and objects that can parent media or references.
const records = data => [...data.items, ...data.stacks, ...data.labels, ...data.albums, ...data.links, ...data.views, ...data.removals, ...data.notifications];
const objects = data => [data.account_id, ...data.items.map(i => i.id), ...data.albums.flatMap(a => [a.id, ...a.contributions.map(k => k.id)]),
  ...data.stacks.map(s => s.id), ...data.labels.map(l => l.id), ...data.links.map(l => l.id), ...data.views.map(v => v.id), ...data.removals.map(r => r.id),
  ...data.notifications.map(n => n.id)];
// An item's image file is parented by the item. A purged item keeps no file reference.
const assetReferences = data => data.items.filter(i => i.file !== null).map(i => ({asset_id: i.file, object_id: i.id, object_type: 'item'}));
module.exports = {validateSeed, records, objects, references: () => [], assetReferences};
