'use strict';
// Builds fixtures (b) and (c). Amounts, dates and card numbers are deterministic.
const fs = require('node:fs');
const path = require('node:path');
const { zonedToIso, luhnComplete, luhnOk, CATEGORIES, addDays } = require('../src/domain-utils.cjs');
const { postLedger, settleDue } = require('../src/ledger.cjs');
const { contentKey } = require('../src/decisions.cjs');

const ZONE = 'America/New_York';
const root = path.join(__dirname, '..');

function cardNumber(serial) {
  const number = luhnComplete('9418' + String(serial).padStart(11, '0'));
  if (!luhnOk(number)) throw new Error('Scale card number failed Luhn');
  return number;
}

const MERCHANT_NAMES = {
  grocery: ['Larkfield Grocer', 'Millstone Market', 'Hearthlane Provisions', 'Bramble and Rye'],
  restaurants: ['Copper Kettle Table', 'Sable Oven', 'Northwharf Diner', 'Pebble and Thyme'],
  travel: ['Copperline Rail', 'Lantern Pier Bookings', 'Highmeadow Inns', 'Marrowtide Travel'],
  telecom: ['Quietwire Voice', 'Harborline Mobile', 'Fieldnote Wireless', 'Pineswitch Calling'],
  domains_hosting: ['Oakbinder Hosting', 'Ledgerlane Domains', 'Stackwell Pages', 'Nimbus Shelf'],
  digital_goods: ['Inkroom Software', 'Quillbit Apps', 'Paperlantern Tools', 'Vellum Keys'],
  crypto: ['Saltvault Desk', 'Pebblemint Counter', 'Driftledger Exchange', 'Mosskey Tokens'],
  gift_cards: ['Ribbonwell Cards', 'Parcelnote Gifts', 'Kindling Cards', 'Boxwood Vouchers'],
  healthcare: ['Willowmere Clinic', 'Fernbridge Care', 'Quietroom Pharmacy', 'Marrowpine Health'],
  utilities: ['Hillwater Power', 'Cinderpipe Gas', 'Lanternwell Electric', 'Brookmeter Utilities'],
  entertainment: ['Footlight Rooms', 'Marquee Hollow', 'Reel and Rafter', 'Nightorchard Tickets'],
  education: ['Chalklane Lessons', 'Maplestem Courses', 'Harbor Primer', 'Quillyard School'],
  transport: ['Waymarker Transit', 'Cobble Cab', 'Ferry and Furlong', 'Milepost Rides'],
  general_merchandise: ['Thimble and Crate', 'Oddment Hall', 'Sundry and Spoke', 'Woolbin General', 'Kettlehouse Goods', 'Parcel and Peg', 'Drygoods Loft', 'Buttonwell Store']
};

function merchants() {
  const rows = [];
  let serial = 1;
  for (const category of CATEGORIES) {
    const names = MERCHANT_NAMES[category];
    const count = category === 'general_merchandise' ? 8 : 4;
    if (!names || names.length !== count) throw new Error('Merchant names do not match ' + category);
    for (let n = 1; n <= count; n += 1) {
      rows.push({
        merchant_id: 'm-' + String(serial).padStart(2, '0'),
        name: names[n - 1],
        category
      });
      serial += 1;
    }
  }
  if (rows.length !== 60) throw new Error('Expected 60 merchants');
  return rows;
}

function makeCard(spec) {
  return {
    account_id: spec.account_id,
    type: spec.type,
    nickname: spec.nickname,
    last_four: spec.number.slice(-4),
    number: spec.number,
    expiry: spec.expiry,
    security_code: spec.security_code,
    status: spec.status || 'active',
    paused_by: null,
    closure_reason: spec.closure_reason || null,
    merchant_lock: null,
    categories: spec.categories || [],
    limits: spec.limits,
    funding_source: 'local',
    created_at: spec.created_at,
    updated_at: spec.updated_at || spec.created_at,
    closed_at: spec.closed_at || null,
    card_id: spec.card_id
  };
}

function captured({ id, key, card, merchant, amount, at, merchantRef }) {
  const merchant_ref = merchantRef;
  return {
    authorization_id: id,
    authorization_key: key,
    content_key: contentKey({
      authorization_key: key,
      card: { card_id: card.card_id, number: card.number, expiry: card.expiry, security_code: card.security_code },
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
    limits_in_force: { ...card.limits },
    redelivered_at: [],
    decision: 'approved',
    decline_code: null,
    status: 'captured',
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

function freelancer() {
  const account = 'kc-okonkwo';
  const created = zonedToIso(2024, 12, 2, 9, 0, 0, ZONE);
  const limits = { per_transaction: 8000, per_day: 20000, per_month: 150000, lifetime: null };
  const travel = makeCard({ account_id: account, card_id: 'card-travel', type: 'category_locked', nickname: 'Travel', number: cardNumber(1), expiry: '2029-01', security_code: '201', categories: ['travel'], limits, created_at: created });
  const software = makeCard({ account_id: account, card_id: 'card-software', type: 'category_locked', nickname: 'Software', number: cardNumber(2), expiry: '2029-02', security_code: '202', categories: ['digital_goods'], limits, created_at: created });
  const hosting = makeCard({ account_id: account, card_id: 'card-hosting', type: 'category_locked', nickname: 'Hosting', number: cardNumber(3), expiry: '2029-03', security_code: '203', categories: ['domains_hosting'], limits, created_at: created });
  const telecom = makeCard({ account_id: account, card_id: 'card-telecom', type: 'category_locked', nickname: 'Telecom blocked', number: cardNumber(4), expiry: '2029-04', security_code: '204', categories: ['telecom'], limits, created_at: created });
  const trialAt = zonedToIso(2026, 3, 4, 10, 0, 0, ZONE);
  const trial = makeCard({ account_id: account, card_id: 'card-trial', type: 'single_use', nickname: 'Trial', number: cardNumber(5), expiry: '2029-05', security_code: '205', categories: [], limits: { per_transaction: 100, per_day: 100, per_month: 100, lifetime: 100 }, created_at: created, updated_at: trialAt, closed_at: trialAt, status: 'closed', closure_reason: 'single_use' });
  const general = makeCard({ account_id: account, card_id: 'card-general', type: 'general', nickname: 'General', number: cardNumber(6), expiry: '2029-06', security_code: '206', categories: [], limits: { per_transaction: 8000, per_day: 40000, per_month: 300000, lifetime: null }, created_at: created });
  const cards = [travel, software, hosting, telecom, trial, general];
  const directory = merchants();
  const data = {
    account_id: account,
    owner_person_id: 'person-amadi',
    initial_clock: zonedToIso(2026, 11, 18, 12, 0, 0, ZONE),
    time_zone: ZONE,
    verification: { mode: 'email_code', code_ttl_minutes: 10, max_attempts: 3, owner_window_hours: 24 },
    delegate: { may_reveal: true, card_ceiling_cents: 20000 },
    funding: { opening_balance_cents: 20000000, balance_cents: 20000000, currency: 'USD' },
    alerts: { declines: true, receipts: true, codes: true, card_events: true, disputes: true, decline_threshold_cents: null },
    category_blocks: ['telecom'],
    merchant_blocks: [],
    merchants: directory,
    cards,
    authorizations: [],
    declines: [],
    ledger: [],
    change_requests: [],
    control_changes: [],
    reveals: [],
    notices: [],
    fingerprints: cards.map(card => ({ card_id: card.card_id, number: card.number, expiry: card.expiry, security_code: card.security_code, last_four: card.last_four })),
    statements: [],
    disputes: [],
    refunds: [],
    top_ups: []
  };
  const posts = [];
  // Full-window history: 2025-01 through the clock month. Each merchant is used in roughly
  // two of every five months, on a varied day and hour, so dates spread across each month.
  const clockMs = Date.parse(data.initial_clock);
  const months = [];
  for (let y = 2025, m = 1; y < 2026 || (y === 2026 && m <= 11); m === 12 ? (y += 1, m = 1) : (m += 1)) months.push([y, m]);
  directory.forEach((merchant, index) => {
    const card = merchant.category === 'travel' ? travel : merchant.category === 'digital_goods' ? software : merchant.category === 'domains_hosting' ? hosting : merchant.category === 'telecom' ? telecom : general;
    months.forEach(([year, month], mi) => {
      if ((index * 7 + mi * 3) % 5 >= 2) return;
      const day = 1 + ((index * 11 + mi * 17) % 28);
      const hour = 8 + ((index + mi * 5) % 12);
      const minute = (index * 7 + mi * 13) % 60;
      const at = zonedToIso(year, month, day, hour, minute, 0, ZONE);
      if (Date.parse(at) >= clockMs) return;
      const ym = String(year) + String(month).padStart(2, '0');
      const amount = 1100 + ((index * 41 + mi * 17) % 1800);
      const id = 'auth-b-' + String(index + 1).padStart(2, '0') + '-' + ym;
      const key = 'vendor:kc-okonkwo:' + merchant.merchant_id + '-' + ym + ':1';
      const merchantRef = { app_id: 'vendor', account_id: 'kc-okonkwo', object_type: 'order', object_id: merchant.merchant_id + '-' + ym };
      if (merchant.category === 'telecom') {
        data.declines.push({
          authorization_id: id, authorization_key: key,
          content_key: contentKey({ authorization_key: key, card: { card_id: card.card_id, number: card.number, expiry: card.expiry, security_code: card.security_code }, merchant, amount_cents: amount, currency: 'USD', merchant_ref: merchantRef }),
          card_id: card.card_id, merchant_id: merchant.merchant_id, merchant_name: merchant.name, category: merchant.category,
          amount_cents: amount, currency: 'USD', merchant_ref: merchantRef, source_event_id: 'seed-' + id, decided_at: at,
          limits_in_force: { ...card.limits }, redelivered_at: [], decision: 'declined', decline_code: 'category_blocked', hold_cents: 0, status: 'declined'
        });
      } else {
        posts.push({ at, amount, id, card, auth: captured({ id, key, card, merchant, amount, at, merchantRef }) });
      }
    });
  });
  posts.push({
    at: trialAt, amount: 100, id: 'auth-trial', card: trial,
    auth: captured({
      id: 'auth-trial', key: 'vendor:kc-okonkwo:trial:1', card: trial,
      merchant: directory.find(item => item.category === 'digital_goods'), amount: 100, at: trialAt,
      merchantRef: { app_id: 'vendor', account_id: 'kc-okonkwo', object_type: 'order', object_id: 'trial' }
    })
  });
  posts.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
  for (const post of posts) {
    settleDue(data, post.at);
    data.authorizations.push(post.auth);
    postLedger(data, { at: post.at, kind: 'capture', direction: 'debit', amount_cents: post.amount, authorization_id: post.id, card_id: post.card.card_id });
  }
  settleDue(data, zonedToIso(2026, 11, 18, 12, 0, 0, ZONE));
  return data;
}

function delegateAccount() {
  const created = zonedToIso(2026, 11, 1, 9, 0, 0, ZONE);
  const number = cardNumber(7);
  const card = makeCard({
    account_id: 'kc-cole', card_id: 'card-cole', type: 'general', nickname: 'Delegate card',
    number, expiry: '2029-07', security_code: '307', categories: [],
    limits: { per_transaction: 5000, per_day: 10000, per_month: 20000, lifetime: null }, created_at: created
  });
  const opened = zonedToIso(2026, 11, 18, 8, 0, 0, ZONE);
  return {
    account_id: 'kc-cole',
    owner_person_id: 'person-nia',
    initial_clock: zonedToIso(2026, 11, 18, 10, 0, 0, ZONE),
    time_zone: ZONE,
    verification: { mode: 'owner_approval', code_ttl_minutes: 10, max_attempts: 3, owner_window_hours: 24 },
    delegate: { may_reveal: false, card_ceiling_cents: 20000 },
    funding: { opening_balance_cents: 500000, balance_cents: 500000, currency: 'USD' },
    alerts: { declines: true, receipts: true, codes: true, card_events: true, disputes: true, decline_threshold_cents: null },
    category_blocks: [],
    merchant_blocks: [],
    merchants: [{ merchant_id: 'm-freshcart', name: 'FreshCart', category: 'grocery' }],
    cards: [card],
    authorizations: [],
    declines: [],
    ledger: [],
    change_requests: [{
      change_request_id: 'cr-owner-1', card_id: card.card_id, field: 'per_transaction', merchant_id: null, category: null,
      from_cents: 5000, to_cents: 8000, status: 'pending_owner', mode: 'owner_approval', code: null, attempts: [],
      attempts_used: 0, max_attempts: 3, created_at: opened, expires_at: zonedToIso(2026, 11, 19, 8, 0, 0, ZONE),
      resolved_at: null, settled_at: null, notice_id: null
    }],
    control_changes: [],
    reveals: [],
    notices: [],
    fingerprints: [{ card_id: card.card_id, number: card.number, expiry: card.expiry, security_code: card.security_code, last_four: card.last_four }],
    statements: [],
    disputes: [],
    refunds: [],
    top_ups: []
  };
}

function cardForMerchant(data, merchant) {
  const id = merchant.category === 'travel' ? 'card-travel'
    : merchant.category === 'digital_goods' ? 'card-software'
    : merchant.category === 'domains_hosting' ? 'card-hosting'
    : merchant.category === 'telecom' ? 'card-telecom'
    : 'card-general';
  return data.cards.find(card => card.card_id === id);
}

function decemberEvents(data) {
  const mi = 23;
  const events = [];
  data.merchants.forEach((merchant, index) => {
    if ((index * 7 + mi * 3) % 5 >= 2) return;
    const day = 1 + ((index * 11 + mi * 17) % 28);
    const hour = 8 + ((index + mi * 5) % 12);
    const minute = (index * 7 + mi * 13) % 60;
    const at = zonedToIso(2026, 12, day, hour, minute, 0, ZONE);
    const amount = 1100 + ((index * 41 + mi * 17) % 1800);
    const ym = '202612';
    const key = 'vendor:kc-okonkwo:' + merchant.merchant_id + '-' + ym + ':1';
    const card = cardForMerchant(data, merchant);
    events.push({
      event_id: 'b-dec-req-' + String(index + 1).padStart(2, '0'),
      at,
      operation: 'authorization.request',
      payload: {
        authorization_key: key,
        amount_cents: amount,
        currency: 'USD',
        card: { card_id: card.card_id, number: card.number, expiry: card.expiry, security_code: card.security_code },
        merchant,
        merchant_ref: { app_id: 'vendor', account_id: 'kc-okonkwo', object_type: 'order', object_id: merchant.merchant_id + '-' + ym }
      }
    });
    if (merchant.category !== 'telecom') {
      events.push({
        event_id: 'b-dec-cap-' + String(index + 1).padStart(2, '0'),
        at: new Date(Date.parse(at) + 2 * 3600e3).toISOString(),
        operation: 'authorization.capture',
        payload: {
          authorization_key: key,
          capture_key: 'cap-b-' + String(index + 1).padStart(2, '0') + '-' + ym,
          amount_cents: amount
        }
      });
    }
  });
  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.event_id.localeCompare(b.event_id));
  events.push({ event_id: 'b-settle-2027-01', at: '2027-01-01T00:05:00-05:00', operation: 'ledger.settle_due', payload: {} });
  return events;
}

function main() {
  const data = freelancer();
  const delegate = delegateAccount();
  const december = decemberEvents(data);
  fs.mkdirSync(path.join(root, 'examples/events'), { recursive: true });
  fs.writeFileSync(path.join(root, 'examples/events/freelancer-2026-12.json'), JSON.stringify(december, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'fixtures/freelancer.json'), JSON.stringify(data) + '\n');
  fs.writeFileSync(path.join(root, 'fixtures/delegate.json'), JSON.stringify(delegate, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'fixtures/freelancer-binding.json'), JSON.stringify({
    people: [{ person_id: 'person-amadi', name: 'Amadi Okonkwo' }],
    accounts: [{ app_id: 'keelcard', account_id: 'kc-okonkwo', owner_person_id: 'person-amadi' }],
    objects: { keelcard: data.cards.map(card => card.card_id) }
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'fixtures/delegate-binding.json'), JSON.stringify({
    people: [{ person_id: 'person-nia', name: 'Nia Cole' }],
    accounts: [{ app_id: 'keelcard', account_id: 'kc-cole', owner_person_id: 'person-nia' }],
    objects: { keelcard: ['card-cole'] }
  }, null, 2) + '\n');
  console.log(JSON.stringify({
    merchants: data.merchants.length,
    cards: data.cards.length,
    authorizations: data.authorizations.length,
    declines: data.declines.length,
    statements: data.statements.length,
    balance_cents: data.funding.balance_cents,
    delegate_requests: delegate.change_requests.length,
    december_events: december.length
  }));
}

module.exports = { freelancer, delegateAccount, merchants, decemberEvents };
if (require.main === module) main();
