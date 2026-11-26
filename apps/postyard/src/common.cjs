'use strict';
const crypto = require('node:crypto');
const APP = 'postyard';
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/;
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const HANDLE = /^[A-Za-z0-9][A-Za-z0-9_]{0,39}$/;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function copy(value) { return structuredClone(value); }
function nfc(value) { return String(value).normalize('NFC'); }
function instant(value, code = 'invalid_arguments') {
  const n = Date.parse(value);
  if (!Number.isFinite(n)) fail(code, 'A timestamp is required.');
  return n;
}
const SERIAL = /^[1-9][0-9]*$/;
const FULL_FOLD = {
  '\u00DF': 'ss',
  '\u0130': 'i\u0307',
  '\u1E9E': 'ss',
  '\uFB00': 'ff',
  '\uFB01': 'fi',
  '\uFB02': 'fl',
  '\uFB03': 'ffi',
  '\uFB04': 'ffl',
  '\uFB05': 'st',
  '\uFB06': 'st'
};
function chars(value) { return Array.from(String(value)).length; }
function caseFold(text) {
  let folded = '';
  for (const ch of String(text).normalize('NFKC')) folded += FULL_FOLD[ch] || ch.toLowerCase();
  return folded.replace(/\s+/g, ' ').trim();
}
function speechHash(text) {
  return crypto.createHash('sha256').update(caseFold(text), 'utf8').digest('hex');
}
function fold(value) {
  return caseFold(value).normalize('NFD').replace(/\p{M}/gu, '');
}
function serialNumber(id, accountId, mark) {
  const prefix = accountId + ':' + mark;
  if (!id.startsWith(prefix)) return null;
  const rest = id.slice(prefix.length);
  if (!SERIAL.test(rest)) return null;
  const number = Number(rest);
  if (!Number.isSafeInteger(number) || String(number) !== rest) return null;
  return number;
}
function accountById(data, id) {
  return data.accounts.find(item => item.account_id === id) || null;
}
function accountByHandle(data, handle) {
  const key = String(handle || '').toLowerCase();
  return data.accounts.find(item => item.handle.toLowerCase() === key) || null;
}
function self(data) {
  const account = accountById(data, data.account_id);
  if (!account) fail('invalid_seed', 'The bound account is missing.');
  return account;
}
function confirms(data) { return data.settings.owner_confirmation === true; }
function followersOf(data, accountId) {
  const account = accountById(data, accountId);
  return account ? account.follower_count : 0;
}
function publicUrl(account, slug) {
  return 'https://postyard.example/@' + account.handle + '/' + slug;
}
function noteUrl(account, id) {
  return 'https://postyard.example/@' + account.handle + '/notes/' + id;
}
function nextSerial(data, accountId, kind) {
  const mark = kind === 'post' ? 'post' : 'note';
  const row = data.counters[accountId];
  if (!row || !Number.isInteger(row[mark])) fail('invalid_seed', 'This account has no id counter.');
  const id = accountId + (kind === 'post' ? ':p' : ':n') + String(row[mark] + 1);
  if (!ID.test(id)) fail('invalid_arguments', 'The next id does not fit the object id pattern.');
  row[mark] += 1;
  return id;
}
function nextReceipt(data) {
  let max = 0;
  for (const row of data.receipts) {
    const match = /^pr-(\d+)$/.exec(row.receipt_id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return 'pr-' + String(max + 1).padStart(4, '0');
}
function tagsOf(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20 || value.some(item => typeof item !== 'string' || !item.trim() || item.length > 40)) {
    fail('invalid_arguments', 'Tags must be a short list of labels.');
  }
  return [...new Set(value.map(item => nfc(item.trim())))];
}
function requireText(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || chars(value) > max) fail('invalid_arguments', label + ' is required.');
  return nfc(value);
}
function requireSlug(value) {
  if (typeof value !== 'string' || !SLUG.test(value)) fail('invalid_arguments', 'A slug is required.');
  return value;
}
module.exports = {
  APP, ID, SLUG, HANDLE, SERIAL, fail, copy, nfc, instant, chars, caseFold, speechHash, fold,
  serialNumber, accountById, accountByHandle, self, confirms, followersOf, publicUrl, noteUrl,
  nextSerial, nextReceipt, tagsOf, requireText, requireSlug
};
