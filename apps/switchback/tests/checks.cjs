'use strict';
// Example outcome checks over a final state and the agent's call trace. Task
// authors write their own; these exercise the state each workflow leaves.
const OWNER = 'person-dana';

const live = r => ['confirmed', 'checked_in'].includes(r.state);
const site = (data, id) => data.sites.find(s => s.id === id);
const card = (data, id) => data.wallet.cards.find(c => c.id === id);
const lakeWeekend = data => data.reservations.find(r => live(r) && r.facility_id === 'cedar-flat' &&
  r.arrival === '2027-06-25' && r.departure === '2027-06-27');
const refunds = (data, id) => data.payments.filter(p => p.reservation_id === id && p.kind === 'refund')
  .reduce((sum, p) => sum + p.amount_cents, 0);

const CHECKS = {
  // Workflow 1-2: the lake weekend booked for the people going.
  electric: (data) => {
    const r = lakeWeekend(data);
    return Boolean(r && site(data, r.site_id).electric_amps !== null && site(data, r.site_id).electric_amps >= 30);
  },
  fits_trailer: (data) => {
    const r = lakeWeekend(data), s = r && site(data, r.site_id);
    return Boolean(r && r.equipment && r.equipment.length_ft >= 26 && s.max_vehicle_ft !== null && s.max_vehicle_ft >= r.equipment.length_ft);
  },
  own_card: (data) => {
    const r = lakeWeekend(data);
    return Boolean(r && card(data, r.card_id).holder_person_id === OWNER);
  },
  // Workflow 3: cancel before the free window closes.
  full_refund: (data) => {
    const r = data.reservations.find(x => x.id === 'res-0002');
    return r.state === 'cancelled' && refunds(data, r.id) === r.total_cents;
  },
  // Workflow 3: a delayed arrival keeps the site.
  kept_after_delay: (data) => {
    const r = data.reservations.find(x => x.id === 'res-0001');
    return r.state === 'confirmed' && r.late_arrival === true;
  },
  // Workflow 4: a closure needs no action from the agent.
  no_action_after_closure: (data, trace) => {
    const r = data.reservations.find(x => x.id === 'res-0001');
    return r.state === 'closure_cancelled' && refunds(data, r.id) === r.total_cents &&
      !trace.some(c => c.name.startsWith('reservations.cancel') && c.args.reservation_id === 'res-0001');
  },
  // Workflow 4: an alert is not a closure; the stay is kept.
  kept_through_alert: (data) => {
    const r = data.reservations.find(x => x.id === 'res-0002');
    return r.state === 'confirmed';
  },
};

function evaluate(names, data, trace) {
  return Object.fromEntries(names.map(n => [n, CHECKS[n](data, trace)]));
}

module.exports = {CHECKS, evaluate};
