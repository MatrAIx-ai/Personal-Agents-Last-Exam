'use strict';
// App-owned helpers. No persistence, authentication or platform runtime.
const crypto = require('node:crypto');
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
const copy = value => structuredClone(value);
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/;
const CATEGORIES = Object.freeze([
  'grocery', 'restaurants', 'travel', 'telecom', 'domains_hosting', 'digital_goods',
  'crypto', 'gift_cards', 'healthcare', 'utilities', 'entertainment', 'education',
  'transport', 'general_merchandise'
]);
const LIMIT_FIELDS = Object.freeze(['per_transaction', 'per_day', 'per_month', 'lifetime']);
const ALERT_FIELDS = Object.freeze(['declines', 'receipts', 'codes', 'card_events', 'disputes']);
const DISPUTE_REASONS = Object.freeze([
  'unauthorized_by_cardholder', 'duplicate_charge', 'incorrect_amount', 'goods_not_received', 'cancelled_recurring'
]);
const DECLINE_PHRASES = Object.freeze({
  card_not_found: 'the card was not found',
  card_details_mismatch: 'the card details do not match',
  card_paused: 'the card is paused',
  card_closed: 'the card is closed',
  single_use_spent: 'the single-use card has already been used',
  merchant_not_allowed: 'the merchant is not allowed on this card',
  category_blocked: 'that spending category is blocked',
  merchant_blocked: 'that merchant is blocked',
  exceeds_transaction_limit: 'exceeds per-transaction limit',
  exceeds_daily_limit: 'exceeds the daily limit',
  exceeds_monthly_limit: 'exceeds the monthly limit',
  exceeds_lifetime_limit: 'exceeds the lifetime limit',
  insufficient_funds: 'the funding balance cannot cover it'
});

function luhnOk(number) {
  if (!/^\d{16}$/.test(number) || number[0] !== '9') return false;
  let sum = 0;
  let alt = false;
  for (let i = number.length - 1; i >= 0; i -= 1) {
    let n = number.charCodeAt(i) - 48;
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function luhnComplete(fifteen) {
  if (!/^\d{15}$/.test(fifteen) || fifteen[0] !== '9') fail('invalid_arguments', 'Card prefix must be 15 digits starting with 9.');
  for (let check = 0; check <= 9; check += 1) {
    const candidate = fifteen + String(check);
    if (luhnOk(candidate)) return candidate;
  }
  fail('invalid_arguments', 'No Luhn check digit exists for that prefix.');
}

function money(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return sign + '$' + Math.floor(abs / 100) + '.' + String(abs % 100).padStart(2, '0');
}

function nextSerial(rows, field, prefix) {
  let n = 1;
  const used = new Set(rows.map(row => row[field]));
  while (used.has(prefix + String(n).padStart(4, '0'))) n += 1;
  return prefix + String(n).padStart(4, '0');
}

function codeDigits() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function references(ctx, data) {
  const person = ctx.binding.people.some(p => p.person_id === data.owner_person_id);
  const account = ctx.binding.accounts.some(a => a.app_id === ctx.app_id && a.account_id === data.account_id && a.owner_person_id === data.owner_person_id);
  if (!person || !account) fail('invalid_seed', 'Account and owner must exist in the supplied binding.');
}

function parts(iso, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  const bag = {};
  for (const part of fmt.formatToParts(new Date(iso))) {
    if (part.type !== 'literal') bag[part.type] = part.value;
  }
  let hour = Number(bag.hour);
  let day = Number(bag.day);
  if (hour === 24) hour = 0;
  return { year: Number(bag.year), month: Number(bag.month), day, hour, minute: Number(bag.minute), second: Number(bag.second) };
}

function zonedToIso(year, month, day, hour, minute, second, timeZone) {
  let utc = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 4; i += 1) {
    const seen = parts(new Date(utc).toISOString(), timeZone);
    const asUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second);
    const diff = asUtc - Date.UTC(year, month - 1, day, hour, minute, second);
    if (diff === 0) break;
    utc -= diff;
  }
  return new Date(utc).toISOString();
}

function offsetOf(iso) {
  const match = String(iso).match(/(Z|[+-]\d{2}:\d{2})$/);
  return match ? match[1] : 'Z';
}

function isoWithOffset(ms, offset) {
  const sign = offset === 'Z' ? 0 : (offset[0] === '-' ? -1 : 1);
  const hours = offset === 'Z' ? 0 : Number(offset.slice(1, 3));
  const minutes = offset === 'Z' ? 0 : Number(offset.slice(4, 6));
  const shifted = new Date(ms + sign * (hours * 60 + minutes) * 60000);
  const iso = shifted.toISOString();
  const fraction = iso.slice(19, 23) === '.000' ? '' : iso.slice(19, 23);
  return iso.slice(0, 19) + fraction + (offset === 'Z' ? 'Z' : offset);
}

function addMinutes(iso, minutes) {
  return isoWithOffset(Date.parse(iso) + minutes * 60000, offsetOf(iso));
}

function addHours(iso, hours) {
  return addMinutes(iso, hours * 60);
}

function addDays(iso, days) {
  return addMinutes(iso, days * 24 * 60);
}

function nextCivilDay(year, month, day) {
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

function dayWindow(iso, timeZone) {
  const p = parts(iso, timeZone);
  const start = zonedToIso(p.year, p.month, p.day, 0, 0, 0, timeZone);
  const next = nextCivilDay(p.year, p.month, p.day);
  const end = zonedToIso(next.year, next.month, next.day, 0, 0, 0, timeZone);
  return { start, end };
}

function monthWindow(iso, timeZone) {
  const p = parts(iso, timeZone);
  const start = zonedToIso(p.year, p.month, 1, 0, 0, 0, timeZone);
  const nextMonth = p.month === 12 ? 1 : p.month + 1;
  const nextYear = p.month === 12 ? p.year + 1 : p.year;
  const end = zonedToIso(nextYear, nextMonth, 1, 0, 0, 0, timeZone);
  return { start, end };
}

function clockLabel(iso, timeZone) {
  const p = parts(iso, timeZone);
  const suffix = p.hour >= 12 ? 'PM' : 'AM';
  let hour = p.hour % 12;
  if (hour === 0) hour = 12;
  return hour + ':' + String(p.minute).padStart(2, '0') + ' ' + suffix;
}

function due(now, deadline) {
  return Date.parse(now) >= Date.parse(deadline);
}

module.exports = {
  fail, copy, ID, CATEGORIES, LIMIT_FIELDS, ALERT_FIELDS, DISPUTE_REASONS, DECLINE_PHRASES, luhnOk, luhnComplete, money,
  nextSerial, codeDigits, references, parts, zonedToIso, addMinutes, addHours, addDays,
  dayWindow, monthWindow, clockLabel, due, isoWithOffset
};
