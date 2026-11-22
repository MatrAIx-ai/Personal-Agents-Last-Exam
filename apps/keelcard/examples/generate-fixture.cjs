'use strict';
// Builds fixture (a): Grace Adeyemi's household cards, 14 months of Saturday
// FreshCart captures, and the earlier snack capture. Output is deterministic.
const { zonedToIso, addDays, luhnOk } = require('../src/domain-utils.cjs');
const { postLedger, settleDue } = require('../src/ledger.cjs');
const { contentKey } = require('../src/decisions.cjs');

const ZONE = 'America/New_York';
const GROCERY_NUMBER = '9417220000014417';
const SNACK_NUMBER = '9417000000088821';

function saturdaySeries(startYear, startMonth, startDay, untilYear, untilMonth, untilDay) {
  const dates = [];
  const until = Date.parse(zonedToIso(untilYear, untilMonth, untilDay, 8, 12, 0, ZONE));
  let year = startYear;
  let month = startMonth;
  let day = startDay;
  for (let guard = 0; guard < 80; guard += 1) {
    const iso = zonedToIso(year, month, day, 8, 12, 0, ZONE);
    if (Date.parse(iso) > until) break;
    dates.push(iso);
    const next = new Date(Date.UTC(year, month - 1, day + 7));
    year = next.getUTCFullYear();
    month = next.getUTCMonth() + 1;
    day = next.getUTCDate();
  }
  return dates;
}

function authFrom({ id, key, card, merchant, amount, at, status, merchantRef }) {
  const merchant_ref = merchantRef || { app_id: 'freshcart', account_id: 'fc-grace', object_type: 'order', object_id: key.split(':')[2] };
  return {
    authorization_id: id,
    authorization_key: key,
    content_key: contentKey({
      authorization_key: key,
      card: { number: card.number, expiry: card.expiry, security_code: card.security_code },
      merchant: { merchant_id: merchant.merchant_id, name: merchant.name, category: merchant.category },
      amount_cents: amount,
      currency: 'USD',
      merchant_ref
    }),
    card_id: card.card_id,
    merchant_id: merchant.merchant_id,
    merchant_name: merchant.name,
    category: merchant.category,
    amount_cents: amount,
    currency: 'USD',
    merchant_ref,
    source_event_id: 'seed-' + id,
    decided_at: at,
    limits_in_force: {
      per_transaction: card.limits.per_transaction,
      per_day: card.limits.per_day,
      per_month: card.limits.per_month,
      lifetime: card.limits.lifetime
    },
    redelivered_at: [],
    decision: 'approved',
    decline_code: null,
    status,
    hold_cents: 0,
    captured_cents: amount,
    refunded_cents: 0,
    expires_at: addDays(at, 7),
    captured_at: at,
    expired_at: null,
    reversed_at: null,
    settled_at: null,
    capture_key: 'cap-' + id,
    reverse_reason: null
  };
}

function build() {
  if (!luhnOk(GROCERY_NUMBER) || !luhnOk(SNACK_NUMBER)) {
    throw new Error('Fixture card numbers must pass Luhn');
  }
  const freshcart = { merchant_id: 'm-freshcart', name: 'FreshCart', category: 'grocery' };
  const snacks = { merchant_id: 'm-corner-snacks', name: 'Corner Snacks', category: 'restaurants' };
  const linetalk = { merchant_id: 'm-linetalk', name: 'LineTalk', category: 'telecom' };
  const grocery = {
    card_id: 'card-4417',
    account_id: 'kc-adeyemi',
    type: 'merchant_locked',
    nickname: 'FreshCart groceries',
    last_four: '4417',
    number: GROCERY_NUMBER,
    expiry: '2028-09',
    security_code: '317',
    status: 'active',
    paused_by: null,
    closure_reason: null,
    merchant_lock: 'm-freshcart',
    categories: ['grocery'],
    limits: { per_transaction: 7500, per_day: 20000, per_month: 120000, lifetime: null },
    funding_source: 'local',
    created_at: zonedToIso(2025, 9, 13, 9, 0, 0, ZONE),
    updated_at: zonedToIso(2026, 11, 14, 8, 12, 0, ZONE),
    closed_at: null
  };
  const snack = {
    card_id: 'card-8821',
    account_id: 'kc-adeyemi',
    type: 'general',
    nickname: 'Household',
    last_four: '8821',
    number: SNACK_NUMBER,
    expiry: '2027-11',
    security_code: '441',
    status: 'active',
    paused_by: null,
    closure_reason: null,
    merchant_lock: null,
    categories: [],
    limits: { per_transaction: 50000, per_day: 50000, per_month: 200000, lifetime: null },
    funding_source: 'local',
    created_at: zonedToIso(2026, 3, 2, 9, 0, 0, ZONE),
    updated_at: zonedToIso(2026, 4, 12, 15, 4, 0, ZONE),
    closed_at: null
  };
  const data = {
    account_id: 'kc-adeyemi',
    owner_person_id: 'person-grace',
    time_zone: ZONE,
    verification: { mode: 'email_code', code_ttl_minutes: 10, max_attempts: 3, owner_window_hours: 24 },
    delegate: { may_reveal: true, card_ceiling_cents: 20000 },
    funding: { opening_balance_cents: 800000, balance_cents: 800000, currency: 'USD' },
    alerts: { declines: true, receipts: true, codes: true, card_events: true, disputes: true, decline_threshold_cents: null },
    category_blocks: [],
    merchant_blocks: [],
    merchants: [freshcart, snacks, linetalk, { merchant_id: 'm-harbor-domains', name: 'Harbor Domains', category: 'domains_hosting' }],
    cards: [grocery, snack],
    authorizations: [],
    declines: [],
    ledger: [],
    change_requests: [],
    control_changes: [],
    reveals: [],
    notices: [],
    fingerprints: [grocery, snack].map(card => ({
      card_id: card.card_id, number: card.number, expiry: card.expiry, security_code: card.security_code, last_four: card.last_four
    })),
    statements: [],
    disputes: [],
    refunds: [],
    top_ups: []
  };
  const weeks = saturdaySeries(2025, 9, 20, 2026, 11, 14);
  const posts = weeks.map((at, index) => {
    const amount = 4200 + ((index * 173) % 2800);
    const id = 'auth-w' + String(index + 1).padStart(2, '0');
    const key = 'freshcart:fc-grace:fc-week-' + String(index + 1).padStart(2, '0') + ':1';
    return { at, amount, id, card: grocery, auth: authFrom({ id, key, card: grocery, merchant: freshcart, amount, at, status: 'captured' }) };
  });
  const snackAt = zonedToIso(2026, 4, 12, 15, 4, 0, ZONE);
  posts.push({
    at: snackAt, amount: 21240, id: 'auth-snack', card: snack,
    auth: authFrom({
      id: 'auth-snack', key: 'corner-snacks:kc-adeyemi:snack-212:1', card: snack, merchant: snacks, amount: 21240, at: snackAt, status: 'captured',
      merchantRef: { app_id: 'keelcard', account_id: 'kc-adeyemi', object_type: 'order', object_id: 'snack-212' }
    })
  });
  posts.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
  for (const post of posts) {
    data.authorizations.push(post.auth);
    postLedger(data, { at: post.at, kind: 'capture', direction: 'debit', amount_cents: post.amount, authorization_id: post.id, card_id: post.card.card_id });
  }
  data.declines.push({
    authorization_id: 'auth-over',
    authorization_key: 'freshcart:fc-grace:fc-over-1:1',
    content_key: contentKey({
      authorization_key: 'freshcart:fc-grace:fc-over-1:1',
      card: { number: '9417220000014417', expiry: '2028-09', security_code: '317' },
      merchant: { merchant_id: 'm-freshcart', name: 'FreshCart', category: 'grocery' },
      amount_cents: 9000,
      currency: 'USD',
      merchant_ref: { app_id: 'freshcart', account_id: 'fc-grace', object_type: 'order', object_id: 'fc-over-1' }
    }),
    card_id: 'card-4417',
    merchant_id: 'm-freshcart',
    merchant_name: 'FreshCart',
    category: 'grocery',
    amount_cents: 9000,
    currency: 'USD',
    merchant_ref: { app_id: 'freshcart', account_id: 'fc-grace', object_type: 'order', object_id: 'fc-over-1' },
    source_event_id: 'seed-auth-over',
    decided_at: zonedToIso(2026, 10, 17, 11, 5, 0, ZONE),
    limits_in_force: { per_transaction: 7500, per_day: 20000, per_month: 120000, lifetime: null },
    redelivered_at: [],
    decision: 'declined',
    decline_code: 'exceeds_transaction_limit',
    hold_cents: 0,
    status: 'declined'
  });
  settleDue(data, zonedToIso(2026, 11, 18, 12, 0, 0, ZONE));
  return { data, weeks: weeks.length };
}

function main() {
  const fs = require('node:fs');
  const path = require('node:path');
  const { data, weeks } = build();
  const target = path.join(__dirname, '../fixtures/minimal.json');
  fs.writeFileSync(target, JSON.stringify(data, null, 2) + '\n');
  console.log(JSON.stringify({ weeks, cards: data.cards.length, authorizations: data.authorizations.length, ledger: data.ledger.length, statements: data.statements.length, balance_cents: data.funding.balance_cents }));
}

module.exports = { build, GROCERY_NUMBER, SNACK_NUMBER };
if (require.main === module) main();
