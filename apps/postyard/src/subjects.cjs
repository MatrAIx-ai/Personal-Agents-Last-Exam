'use strict';
const {fold} = require('./common.cjs');

function mentions(text) {
  const found = [];
  for (const match of String(text).matchAll(/(^|[^\w])@([A-Za-z0-9_]+)/g)) {
    if (!found.includes(match[2])) found.push(match[2]);
  }
  return found;
}

function parseLinks(text) {
  const links = [];
  const seen = new Set();
  for (const match of String(text).matchAll(/https:\/\/[^\s)<>"]+/g)) {
    const url = match[0].replace(/[.,;:]+$/, '');
    if (seen.has(url)) continue;
    seen.add(url);
    const pull = url.match(/^https:\/\/forkyard\.example\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)$/);
    if (pull) {
      links.push({
        kind: 'external', url, app_id: 'forkyard', object_type: 'pull',
        object_id: pull[1] + '.' + pull[2] + '.' + pull[3],
        forkyard_object_id: pull[1] + '/' + pull[2] + '#' + pull[3]
      });
      continue;
    }
    const release = url.match(/^https:\/\/forkyard\.example\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/releases\/([A-Za-z0-9._-]+)$/);
    if (release) {
      links.push({
        kind: 'external', url, app_id: 'forkyard', object_type: 'release',
        object_id: release[1] + '.' + release[2] + '.' + release[3],
        forkyard_object_id: release[1] + '/' + release[2] + '#' + release[3]
      });
      continue;
    }
    const note = url.match(/^https:\/\/postyard\.example\/@([A-Za-z0-9_]+)\/notes\/([A-Za-z0-9][A-Za-z0-9_.:-]{0,99})$/);
    if (note) {
      links.push({kind: 'internal', url, app_id: 'postyard', object_type: 'note', object_id: note[2], handle: note[1]});
      continue;
    }
    const profile = url.match(/^https:\/\/postyard\.example\/@([A-Za-z0-9_]+)$/);
    if (profile) {
      links.push({kind: 'internal', url, app_id: 'postyard', object_type: 'profile', object_id: profile[1], handle: profile[1]});
      continue;
    }
    const post = url.match(/^https:\/\/postyard\.example\/@([A-Za-z0-9_]+)\/([A-Za-z0-9][A-Za-z0-9._-]{0,80})$/);
    if (post && post[2] !== 'notes') {
      links.push({kind: 'internal', url, app_id: 'postyard', object_type: 'post', object_id: post[2], handle: post[1]});
    }
  }
  return links;
}

function containsVariant(text, variant) {
  const hay = fold(text);
  const needle = fold(variant);
  if (!needle) return false;
  let from = 0;
  while (from <= hay.length) {
    const at = hay.indexOf(needle, from);
    if (at < 0) return false;
    const before = at === 0 || !/[\p{L}\p{N}]/u.test(hay[at - 1]);
    const afterIndex = at + needle.length;
    const after = afterIndex >= hay.length || !/[\p{L}\p{N}]/u.test(hay[afterIndex]);
    if (before && after) return true;
    from = at + needle.length;
  }
  return false;
}

function sameHandle(account, handle) {
  return !!(account && handle && account.handle.toLowerCase() === String(handle).toLowerCase());
}

function withoutUrls(text) {
  return String(text).replace(/https:\/\/[^\s)<>"]+/g, ' ');
}

function subjectHits(data, text, surface, addressed, extras) {
  const hits = [];
  const handles = mentions(withoutUrls(text));
  for (const name of (extras && extras.mentions) || []) {
    if (typeof name === 'string' && name && !handles.some(item => item.toLowerCase() === name.toLowerCase())) handles.push(name);
  }
  const links = parseLinks(text);
  for (const url of (extras && extras.links) || []) {
    for (const link of parseLinks(url)) if (!links.some(item => item.url === link.url)) links.push(link);
  }
  const addressedAccount = addressed && addressed.account_id
    ? data.accounts.find(item => item.account_id === addressed.account_id)
    : null;
  for (const subject of data.protected_subjects || []) {
    const account = data.accounts.find(item => item.account_id === subject.account_id);
    const matches = [];
    if (account && handles.some(handle => sameHandle(account, handle))) matches.push('handle');
    for (const variant of subject.name_variants || []) {
      if (containsVariant(text, variant)) matches.push('name');
    }
    for (const link of links) {
      if (!account || !sameHandle(account, link.handle)) continue;
      if (link.object_type === 'profile') matches.push('profile_link');
      if (link.object_type === 'post' || link.object_type === 'note') {
        const ownedPost = link.object_type === 'post' && data.posts.some(post => post.account_id === account.account_id && post.slug === link.object_id);
        const ownedNote = link.object_type === 'note' && data.notes.some(note => note.account_id === account.account_id && note.id === link.object_id);
        if (ownedPost || ownedNote) matches.push('object');
      }
    }
    for (const link of links) {
      for (const ref of subject.owned_refs || []) {
        if (link.app_id === ref.app_id && link.object_id === ref.object_id && (!link.handle || sameHandle(account, link.handle))) matches.push('object');
      }
    }
    if (addressedAccount && account && addressedAccount.account_id === account.account_id) matches.push('addressed');
    if (!matches.length) continue;
    hits.push({person_id: subject.person_id, surface, match: matches[0], matches});
  }
  return hits;
}

function forkyardObjectId(objectId) {
  const match = /^([A-Za-z0-9_.-]+)\.([A-Za-z0-9_.-]+)\.(\d+)$/.exec(objectId);
  if (!match) return objectId;
  return match[1] + '/' + match[2] + '#' + match[3];
}

module.exports = {mentions, parseLinks, containsVariant, subjectHits, forkyardObjectId};
