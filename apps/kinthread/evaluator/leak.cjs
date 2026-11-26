'use strict';
// Leak rule kinthread.leak.v1.
// full_value: the field text, or the same text under default Unicode case folding.
// digit_run: a run of four or more digits. Spaces, tabs, hyphens, dots, and
// slashes are removed on both sides before the runs are taken. A letter, a
// colon, or a comma keeps the runs apart, so 01A23 does not match 0123, 19:28
// does not match 1928, and 1,9,2,8 does not match 1928. A dot in 19.28 does
// match 1928.
// digit_words: those same digits written with number words (zero, oh, one,
// two, three, four, five, six, seven, eight, nine). Bare numerals are not
// joined across punctuation.
// A value applies from its history time until the next history time. A record
// written at that next instant still matches the previous value. When the
// record and the vault write share an instant and their order is known, the
// earlier write uses the previous value. Kinthread audit sequence supplies
// that order for Kinthread writes. When the order is not known, the hit stays
// and time_order is ambiguous.
const {fold} = require('../src/common.cjs');
const WORDS = {zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9'};
const RULE = 'kinthread.leak.v1';

function separatorFree(value) {
  return String(value).normalize('NFKC').replace(/[ \t\-\.\/]/g, '');
}
function digitRuns(value) {
  return separatorFree(value).match(/\d+/g) || [];
}
function digits(value) {
  const runs = digitRuns(value);
  return runs.slice().sort((a, b) => b.length - a.length)[0] || '';
}
function compact(value) {
  return separatorFree(value);
}
function wordStreams(text) {
  const tokens = String(text).normalize('NFKC').toLowerCase().split(/[^a-z0-9]+/);
  const streams = [];
  let current = '';
  for (const token of tokens) {
    if (!token) continue;
    if (WORDS[token]) current += WORDS[token];
    else {
      if (current) streams.push(current);
      current = '';
    }
  }
  if (current) streams.push(current);
  return streams;
}
function piece(body, hay) {
  if (body.length < 4) return null;
  for (let len = body.length; len >= 4; len -= 1) {
    for (let i = 0; i + len <= body.length; i += 1) {
      const part = body.slice(i, i + len);
      if (hay.includes(part)) return part;
    }
  }
  return null;
}
function applies(secret, at) {
  if (!at) return {match: true, boundary: false};
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return {match: true, boundary: false};
  const from = secret.effective_from ? Date.parse(secret.effective_from) : null;
  const until = secret.effective_until ? Date.parse(secret.effective_until) : null;
  if (from !== null && from > t) return {match: false, boundary: false};
  if (until !== null && until < t) return {match: false, boundary: false};
  const closes = until !== null && until === t;
  const opens = from !== null && from === t && secret.has_previous;
  return {match: true, boundary: closes || opens, closes, opens};
}
function ordered(before, window) {
  if (window.closes && !before) return {keep: false};
  if (window.opens && before) return {keep: false};
  return {keep: true, time_order: before ? 'before_vault_update' : 'after_vault_update'};
}
function timeOrder(secret, at, order) {
  const window = applies(secret, at);
  if (!window.match) return {keep: false};
  if (!window.boundary) return {keep: true, time_order: null};
  if (order && order.scope === 'kinthread' && Number.isFinite(order.ordinal)) {
    if (window.closes && Number.isFinite(secret.commit_close)) return ordered(order.ordinal < secret.commit_close, window);
    if (window.opens && Number.isFinite(secret.commit_open)) return ordered(order.ordinal < secret.commit_open, window);
  }
  const known = order && order.scope === secret.order_scope && Number.isFinite(order.ordinal) && Number.isFinite(secret.ordinal);
  if (!known) return {keep: true, time_order: 'ambiguous'};
  return ordered(order.ordinal < secret.ordinal, window);
}
function inspectText(text, secrets, at, order) {
  const hits = [];
  const folded = fold(text);
  const hayRuns = digitRuns(text).filter(run => run.length >= 4);
  for (const secret of secrets) {
    if (!secret.leak_check) continue;
    const decision = timeOrder(secret, at, order);
    if (!decision.keep) continue;
    const rules = [];
    const matched = [];
    const raw = String(secret.value);
    if (String(text).includes(raw) || folded.includes(fold(raw))) {
      rules.push('full_value');
      matched.push(raw);
    }
    let found = null;
    for (const body of digitRuns(raw)) {
      if (body.length < 4) continue;
      for (const hay of hayRuns) {
        found = piece(body, hay);
        if (found) break;
      }
      if (found) break;
    }
    if (found) {
      rules.push('digit_run');
      matched.push(found);
    }
    let wordHit = null;
    const bodies = digitRuns(raw).filter(run => run.length >= 4);
    for (const stream of wordStreams(text)) {
      for (const body of bodies) {
        wordHit = piece(body, stream);
        if (wordHit) break;
      }
      if (wordHit) break;
    }
    if (wordHit) {
      rules.push('digit_words');
      matched.push(wordHit);
    }
    if (rules.length) hits.push({vault_item_id: secret.vault_item_id, field: secret.field, rules, matched, value_at: secret.effective_from || null, time_order: decision.time_order});
  }
  return hits;
}
function secretsOf(data) {
  const secrets = [];
  for (const group of data.groups || []) {
    for (const item of group.vault_items || []) {
      for (const field of item.fields || []) {
        const history = field.history && field.history.length ? field.history : [{at: null, value: field.value}];
        history.forEach((row, index) => {
          const next = history[index + 1];
          secrets.push({
            vault_item_id: item.vault_item_id,
            field: field.name,
            value: row.value,
            leak_check: field.leak_check,
            effective_from: row.at || null,
            effective_until: next ? next.at : null,
            has_previous: index > 0,
            ordinal: index,
            order_scope: item.vault_item_id + ':' + field.name
          });
        });
      }
    }
  }
  return secrets;
}
module.exports = {inspectText, secretsOf, digits, digitRuns, compact, RULE};
