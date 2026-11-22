'use strict';
// Record consistency for seeds, events and every committed write.
const {fail, references} = require('./domain-utils.cjs');
const R = require('./rules.cjs');
const {ms, nights: nightList} = require('./clock.cjs');

function unique(list, what) {
  const seen = new Set();
  for (const item of list) {
    if (seen.has(item.id)) fail('invalid_seed', `Duplicate ${what} ID ${item.id}.`);
    seen.add(item.id);
  }
  return seen;
}

function validateSeed(ctx, data) {
  references(ctx, data);
  const policies = unique(data.policies, 'policy');
  for (const p of data.policies) {
    if (!p.rungs.length || p.rungs[p.rungs.length - 1].ends !== null) fail('invalid_seed', 'The last refund rung must be open-ended.');
    let previous = Infinity;
    for (const rung of p.rungs.slice(0, -1)) {
      if (rung.ends === null) fail('invalid_seed', 'Only the last refund rung may be open-ended.');
      const key = rung.ends.days_before * 1440 - (Number(rung.ends.time.slice(0, 2)) * 60 + Number(rung.ends.time.slice(3)));
      if (!(key < previous)) fail('invalid_seed', 'Refund rungs must end in time order.');
      previous = key;
    }
  }
  const facilities = unique(data.facilities, 'facility');
  for (const f of data.facilities) if (!policies.has(f.policy_id)) fail('invalid_seed', 'Facility policy is missing.');
  const sites = unique(data.sites, 'site');
  for (const s of data.sites) if (!facilities.has(s.facility_id)) fail('invalid_seed', 'Site facility is missing.');
  const cards = unique(data.wallet.cards, 'card');
  if (!cards.has(data.wallet.default_card_id)) fail('invalid_seed', 'Default card is missing.');
  const people = new Set(ctx.binding.people.map(p => p.person_id));
  for (const c of data.wallet.cards) if (c.holder_person_id !== null && !people.has(c.holder_person_id)) fail('invalid_seed', 'Cardholder is not in the binding.');
  const equipment = unique(data.equipment, 'equipment');
  if (data.default_equipment_id !== null && !equipment.has(data.default_equipment_id)) fail('invalid_seed', 'Default equipment is missing.');
  const companions = unique(data.companions, 'companion');
  for (const c of data.companions) if (c.person_id !== null && !people.has(c.person_id)) fail('invalid_seed', 'Companion person is not in the binding.');
  unique(data.holds, 'hold');
  for (const h of data.holds) {
    if (!sites.has(h.site_id)) fail('invalid_seed', 'Hold site is missing.');
    if (JSON.stringify(h.nights) !== JSON.stringify(nightList(h.arrival, h.departure))) fail('invalid_seed', 'Hold nights do not match its dates.');
  }
  unique(data.reservations, 'reservation');
  const live = new Map();
  for (const r of data.reservations) {
    const s = R.site(data, r.site_id);
    if (s.facility_id !== r.facility_id) fail('invalid_seed', 'Reservation site and facility disagree.');
    if (!policies.has(r.policy_id) || !cards.has(r.card_id)) fail('invalid_seed', 'Reservation policy or card is missing.');
    if (JSON.stringify(r.nights) !== JSON.stringify(nightList(r.arrival, r.departure))) fail('invalid_seed', 'Reservation nights do not match its dates.');
    if (r.nightly_cents.length !== r.nights.length || r.nightly_cents.reduce((a, b) => a + b, 0) !== r.total_cents) fail('invalid_seed', 'Reservation amounts do not add up.');
    if (r.primary_occupant.kind === 'companion' && !companions.has(r.primary_occupant.id) && !r.companions.some(c => c.id === r.primary_occupant.id)) {
      fail('invalid_seed', 'Primary occupant is not a known companion.');
    }
    let previous = ms(r.created_at);
    for (const h of r.history) {
      if (ms(h.at) < previous) fail('invalid_seed', 'Reservation history is out of order.');
      previous = ms(h.at);
    }
    if (R.LIVE.has(r.state)) {
      for (const d of r.nights) {
        const key = r.site_id + '|' + d;
        if (live.has(key)) fail('invalid_seed', `Two live reservations hold site ${r.site_id} on ${d}.`);
        live.set(key, r.id);
      }
    }
  }
  unique(data.previews, 'preview');
  unique(data.payments, 'payment');
  for (const p of data.payments) {
    if (!cards.has(p.card_id) || !data.reservations.some(r => r.id === p.reservation_id)) fail('invalid_seed', 'Payment card or reservation is missing.');
  }
  unique(data.alerts, 'alert');
  for (const a of data.alerts) {
    if (!facilities.has(a.facility_id) || a.site_ids.some(id => !sites.has(id))) fail('invalid_seed', 'Alert facility or site is missing.');
    if (!(ms(a.from) < ms(a.to))) fail('invalid_seed', 'Alert window must end after it starts.');
  }
  unique(data.closures, 'closure');
  for (const c of data.closures) {
    if (!facilities.has(c.facility_id) || c.site_ids.some(id => !sites.has(id)) || !(c.from < c.to)) fail('invalid_seed', 'Invalid closure.');
  }
  unique(data.claims, 'claim');
  for (const c of data.claims) if (!sites.has(c.site_id)) fail('invalid_seed', 'Claim site is missing.');
  unique(data.notices, 'notice');
}

const records = data => data.reservations;
const objects = data => [...data.facilities, ...data.sites, ...data.reservations].map(x => x.id);

module.exports = {validateSeed, records, objects, references: () => [], assetReferences: () => []};
