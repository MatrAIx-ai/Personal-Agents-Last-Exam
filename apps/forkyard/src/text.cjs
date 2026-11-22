'use strict';
const crypto = require('node:crypto');

function nfc(value) {
  return String(value).normalize('NFC');
}

function fold(value) {
  return nfc(value).normalize('NFKC').toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim();
}

function speechHash(value) {
  const normalized = nfc(value).normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function words(value) {
  return fold(value).replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function containsFolded(haystack, needle) {
  const text = words(haystack);
  const target = words(needle);
  if (!target) return false;
  return (' ' + text + ' ').includes(' ' + target + ' ');
}

function clockHm(at) {
  const match = String(at).match(/T(\d{2}:\d{2})/);
  return match ? match[1] : String(at);
}

function parseLinks(body, repo) {
  const links = [];
  const seen = new Set();
  const text = String(body || '');
  for (const match of text.matchAll(/https:\/\/[^\s)<>"]+/g)) {
    const url = match[0].replace(/[.,;:]+$/, '');
    if (seen.has(url)) continue;
    seen.add(url);
    const postyard = url.match(/^https:\/\/postyard\.example\/(?:@[^/]+\/)?([A-Za-z0-9][A-Za-z0-9._-]{0,80})$/);
    if (postyard) {
      links.push({kind: 'external', url, app_id: 'postyard', object_type: 'post', object_id: postyard[1]});
      continue;
    }
    const pull = url.match(/^https:\/\/forkyard\.example\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/(\d+)$/);
    if (pull) {
      links.push({kind: 'internal', url, app_id: 'forkyard', object_type: 'pull', object_id: pull[1] + '#' + pull[2], repo: pull[1], number: Number(pull[2])});
      continue;
    }
    const issue = url.match(/^https:\/\/forkyard\.example\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/issues\/(\d+)$/);
    if (issue) {
      links.push({kind: 'internal', url, app_id: 'forkyard', object_type: 'issue', object_id: issue[1] + '#' + issue[2], repo: issue[1], number: Number(issue[2])});
      continue;
    }
    const profile = url.match(/^https:\/\/forkyard\.example\/([A-Za-z0-9][A-Za-z0-9-]{0,39})$/);
    if (profile) links.push({kind: 'internal', url, app_id: 'forkyard', object_type: 'account', object_id: profile[1], handle: profile[1]});
  }
  if (repo) {
    for (const match of text.matchAll(/(^|\s)#(\d+)\b/g)) {
      const number = Number(match[2]);
      const object_id = repo + '#' + number;
      if (seen.has(object_id)) continue;
      seen.add(object_id);
      links.push({kind: 'internal', url: 'https://forkyard.example/' + repo + '/pull/' + number, app_id: 'forkyard', object_type: 'pull', object_id, repo, number});
    }
  }
  return links;
}

function mentions(body) {
  const handles = [];
  for (const match of String(body || '').matchAll(/(^|[^A-Za-z0-9_])@([A-Za-z0-9][A-Za-z0-9-]{0,39})\b/g)) {
    if (!handles.includes(match[2])) handles.push(match[2]);
  }
  return handles;
}

module.exports = {nfc, fold, speechHash, containsFolded, clockHm, parseLinks, mentions};
