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
function speechHash(text) {
  const normalized = String(text).normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}
function fold(value) {
  return String(value).normalize('NFKC').toLocaleLowerCase('en').normalize('NFD').replace(/\p{M}/gu, '');
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
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('invalid_arguments', label + ' is required.');
  return nfc(value);
}
function requireSlug(value) {
  if (typeof value !== 'string' || !SLUG.test(value)) fail('invalid_arguments', 'A slug is required.');
  return value;
}
module.exports = {
  APP, ID, SLUG, HANDLE, fail, copy, nfc, instant, speechHash, fold,
  accountById, accountByHandle, self, confirms, followersOf, publicUrl, noteUrl,
  nextSerial, nextReceipt, tagsOf, requireText, requireSlug
};
