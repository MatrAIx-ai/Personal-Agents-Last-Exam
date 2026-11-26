'use strict';
// Leak rule kinthread.leak.v1.
// full_value: the field text, or the same text with Unicode case folding.
// digit_run: four or more consecutive digits of the field after spaces, tabs,
// hyphens, dots, and slashes are removed. A dot in "19.28" therefore matches
// the digits 1928. A colon or a comma is not removed.
// digit_words: those same digits written with number words (zero, oh, one,
// two, three, four, five, six, seven, eight, nine). Bare numerals are not
// joined across punctuation.
const WORDS = {zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9'};
const RULE = 'kinthread.leak.v1';

function compact(value) {
  return String(value).normalize('NFKC').replace(/[ \t\-\.\/]/g, '');
}
function digits(value) {
  return compact(value).replace(/\D/g, '');
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
  if (!at) return true;
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return true;
  if (secret.effective_from && Date.parse(secret.effective_from) > t) return false;
  if (secret.effective_until && Date.parse(secret.effective_until) <= t) return false;
  return true;
}
function inspectText(text, secrets, at) {
  const hits = [];
  const folded = String(text).normalize('NFKC').toLocaleLowerCase('en-US').replace(/\u00df/g, 'ss');
  const hay = compact(text);
  for (const secret of secrets) {
    if (!secret.leak_check || !applies(secret, at)) continue;
    const rules = [];
    const matched = [];
    const raw = String(secret.value);
    const rawFold = raw.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\u00df/g, 'ss');
    if (String(text).includes(raw) || folded.includes(rawFold)) {
      rules.push('full_value');
      matched.push(raw);
    }
    const body = digits(raw);
    const found = piece(body, hay);
    if (found) {
      rules.push('digit_run');
      matched.push(found);
    }
    let wordHit = null;
    for (const stream of wordStreams(text)) {
      wordHit = piece(body, stream);
      if (wordHit) break;
    }
    if (wordHit) {
      rules.push('digit_words');
      matched.push(wordHit);
    }
    if (rules.length) hits.push({vault_item_id: secret.vault_item_id, field: secret.field, rules, matched, value_at: secret.effective_from || null});
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
            effective_until: next ? next.at : null
          });
        });
      }
    }
  }
  return secrets;
}
module.exports = {inspectText, secretsOf, digits, compact, RULE};
