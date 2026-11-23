'use strict';
const none = () => ({ contains: [], may_contain: [] });
const week = spans => Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(d => [d, spans]));

function baseSeed() {
  return {
    seed_id: 'unit-seed-1',
    account_id: 'plateway-p-1',
    owner_person_id: 'p-1',
    time_zone: 'America/New_York',
    holder: { person_id: 'p-1', name: 'Jordan Lee' },
    zones: [{ id: 'z-1', name: 'Riverside' }, { id: 'z-2', name: 'Hillcrest' }, { id: 'z-9', name: 'Far Field' }],
    addresses: [
      { id: 'a-1', label: 'Home', line1: '12 Elm Street', zone_id: 'z-1' },
      { id: 'a-2', label: 'Office', line1: '400 Market Avenue', zone_id: 'z-2' },
      { id: 'a-9', label: 'Cabin', line1: '7 Pine Road', zone_id: 'z-9' },
    ],
    cards: [
      { id: 'c-1', brand: 'Orbit', last4: '4242', exp_month: 12, exp_year: 2028, behavior: 'approve' },
      { id: 'c-2', brand: 'Kestrel', last4: '0005', exp_month: 6, exp_year: 2029, behavior: 'decline' },
      { id: 'c-3', brand: 'Orbit', last4: '1881', exp_month: 10, exp_year: 2026, behavior: 'approve' },
    ],
    restaurants: [
      {
        id: 'r-1', name: 'Basil Row', cuisines: ['thai'], delivery_fee_cents: 299, prep_minutes: 20,
        zones: [{ zone_id: 'z-1', travel_minutes: 15 }, { zone_id: 'z-2', travel_minutes: 25 }],
        hours: week([['11:00', '21:00']]), paused: false, pause_reason: null, rating: { average: 4.6, count: 212 },
      },
      {
        id: 'r-2', name: 'Night Owl Noodles', cuisines: ['chinese', 'noodles'], delivery_fee_cents: 199, prep_minutes: 15,
        zones: [{ zone_id: 'z-1', travel_minutes: 20 }],
        hours: week([['17:00', '01:00']]), paused: false, pause_reason: null, rating: { average: 4.2, count: 87 },
      },
    ],
    dishes: [
      {
        id: 'mi-1', restaurant_id: 'r-1', name: 'Pad Thai', description: 'Rice noodles, egg, tofu, peanuts, bean sprouts.',
        price_cents: 607, available: true, allergens: { contains: ['egg', 'peanuts', 'soybeans'], may_contain: [] },
        option_groups: [{
          id: 'og-1', name: 'Spice level', required: true, min: 1, max: 1,
          options: [
            { id: 'op-1', name: 'Mild', price_delta_cents: 0, allergens: none() },
            { id: 'op-2', name: 'Hot', price_delta_cents: 0, allergens: none() },
          ],
        }, {
          id: 'og-2', name: 'Add protein', required: false, min: 0, max: 2,
          options: [
            { id: 'op-3', name: 'Shrimp', price_delta_cents: 300, allergens: { contains: ['crustacean shellfish'], may_contain: [] } },
            { id: 'op-4', name: 'Chicken', price_delta_cents: 200, allergens: none() },
          ],
        }],
      },
      {
        id: 'mi-2', restaurant_id: 'r-1', name: 'Green Curry', description: 'Coconut milk, eggplant, basil, rice.',
        price_cents: 1250, available: true, allergens: { contains: [], may_contain: ['tree nuts'] }, option_groups: [],
      },
      {
        id: 'mi-3', restaurant_id: 'r-2', name: 'Dan Dan Noodles', description: 'Wheat noodles, pork, chili oil, sesame.',
        price_cents: 1100, available: true, allergens: { contains: ['wheat', 'sesame', 'soybeans'], may_contain: ['peanuts'] }, option_groups: [],
      },
    ],
    cart: { restaurant_id: null, lines: [] },
    orders: [],
    notices: [],
  };
}

function deliveredOrder(overrides = {}) {
  return {
    id: 'o-21', restaurant_id: 'r-1', address_id: 'a-1', card_id: 'c-1', status: 'delivered', mode: 'asap',
    placed_at: '2026-12-03T18:00:00-05:00', delivery_at: null, release_at: null,
    submitted_at: '2026-12-03T18:00:00-05:00', accept_by: '2026-12-03T18:20:00-05:00',
    estimated_delivery_at: '2026-12-03T18:35:00-05:00', delivered_at: '2026-12-03T18:41:00-05:00',
    lines: [
      { id: 'ol-1', item_id: 'mi-1', name: 'Pad Thai', options: [{ id: 'op-1', name: 'Mild', price_delta_cents: 0 }], quantity: 1, label: null, unit_price_cents: 607, subtotal_cents: 607, tax_cents: 49, removed: false, removed_reason: null, removed_at: null, report: null },
      { id: 'ol-2', item_id: 'mi-1', name: 'Pad Thai', options: [{ id: 'op-2', name: 'Hot', price_delta_cents: 0 }], quantity: 1, label: 'For Sam', unit_price_cents: 607, subtotal_cents: 607, tax_cents: 49, removed: false, removed_reason: null, removed_at: null, report: null },
    ],
    fees: { delivery_cents: 299, service_cents: 146, small_order_cents: 0 },
    subtotal_cents: 1214, tax_cents: 98, tip_cents: 200, total_cents: 1957,
    charge: { card_id: 'c-1', amount_cents: 1957, at: '2026-12-03T18:00:00-05:00' },
    refunds: [],
    timeline: [
      { at: '2026-12-03T18:00:00-05:00', status: 'submitted', note: 'Order placed' },
      { at: '2026-12-03T18:41:00-05:00', status: 'delivered', note: 'Delivered' },
    ],
    cancellation: null, rating: null,
    ...overrides,
  };
}
module.exports = { baseSeed, deliveredOrder, week, none };
