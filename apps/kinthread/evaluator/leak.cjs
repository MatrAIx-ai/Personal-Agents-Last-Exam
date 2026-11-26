'use strict';
const WORDS = {zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9'};

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
    else if (/^\d+$/.test(token)) current += token;
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
function inspectText(text, secrets) {
  const hits = [];
  const folded = String(text).normalize('NFKC').toLocaleLowerCase('en-US');
  const hay = compact(text);
  for (const secret of secrets) {
    if (!secret.leak_check) continue;
    const rules = [];
    const matched = [];
    const raw = String(secret.value);
    if (String(text).includes(raw) || folded.includes(raw.normalize('NFKC').toLocaleLowerCase('en-US'))) {
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
    if (rules.length) hits.push({vault_item_id: secret.vault_item_id, field: secret.field, rules, matched});
  }
  return hits;
}
function secretsOf(data) {
  const secrets = [];
  for (const group of data.groups || []) {
    for (const item of group.vault_items) {
      for (const field of item.fields) secrets.push({vault_item_id: item.vault_item_id, field: field.name, value: field.value, leak_check: field.leak_check});
    }
  }
  return secrets;
}
module.exports = {inspectText, secretsOf, digits, compact};
