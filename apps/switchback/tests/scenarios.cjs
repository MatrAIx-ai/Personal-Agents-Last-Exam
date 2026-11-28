'use strict';
// The anchor scenarios behind check (a) and check (b): a reference run, a
// do-nothing run and wrong runs for each workflow, over the example checks.
const assert = require('node:assert/strict');
const {fixture} = require('./harness.cjs');
const {evaluate} = require('./checks.cjs');

const code = c => e => e.code === c;
function book(f, site, arrival, departure, previewArgs = {}) {
  const hold = f.call('cart.hold', {site_id: site, arrival, departure}).hold;
  const preview = f.call('reservations.preview', {hold_id: hold.id, ...previewArgs}).preview;
  return f.call('reservations.confirm', {preview_id: preview.id});
}

const SCENARIOS = {
  lake_weekend: {
    checks: ['electric', 'fits_trailer', 'own_card'],
    writes: ['electric', 'fits_trailer', 'own_card'],
    reference(f) {
      const e = f.call('equipment.save', {label: 'New trailer', kind: 'trailer', length_ft: 26, make_default: true}).equipment;
      const pick = f.call('sites.search', {facility_id: 'cedar-flat', arrival: '2027-06-25', departure: '2027-06-27',
        electric_min_amps: 30, min_vehicle_ft: e.length_ft, available_only: true}).sites[0];
      book(f, pick.id, '2027-06-25', '2027-06-27', {card_id: 'card-dana-visa'});
    },
    wrong: {
      saved_defaults(f) { book(f, 'cf-B14', '2027-06-25', '2027-06-27'); },
      site_lacking_attribute(f) {
        f.call('equipment.save', {label: 'New trailer', kind: 'trailer', length_ft: 26, make_default: true});
        book(f, 'cf-C07', '2027-06-25', '2027-06-27', {card_id: 'card-dana-visa'});
      },
    },
    fails: {saved_defaults: ['electric', 'fits_trailer', 'own_card'], site_lacking_attribute: ['fits_trailer']},
  },
  free_window: {
    checks: ['full_refund'], writes: ['full_refund'],
    reference(f) {
      f.at('2027-06-29T17:00:00-07:00');
      f.call('reservations.cancel.confirm', {preview_id: f.call('reservations.cancel.preview', {reservation_id: 'res-0002'}).preview.id});
    },
    wrong: {
      cancel_one_rung_late(f) {
        f.at('2027-06-29T18:30:00-07:00');
        f.call('reservations.cancel.confirm', {preview_id: f.call('reservations.cancel.preview', {reservation_id: 'res-0002'}).preview.id});
      },
    },
    fails: {cancel_one_rung_late: ['full_refund']},
  },
  delayed_drive: {
    checks: ['kept_after_delay'], writes: ['kept_after_delay'], end: '2027-06-19T08:00:00-07:00',
    reference(f) { f.at('2027-06-18T19:00:00-07:00'); f.call('reservations.late_arrival', {reservation_id: 'res-0001'}); },
    wrong: {
      no_late_notice(f) { f.at('2027-06-18T19:00:00-07:00'); },
      cancel_in_last_rung(f) {
        f.at('2027-06-18T19:00:00-07:00');
        f.call('reservations.cancel.confirm', {preview_id: f.call('reservations.cancel.preview', {reservation_id: 'res-0001'}).preview.id});
      },
    },
    fails: {no_late_notice: ['kept_after_delay'], cancel_in_last_rung: ['kept_after_delay']},
  },
  closure: {
    checks: ['no_action_after_closure'], writes: [],
    setup(f) { f.event(require('../examples/scenario.json')); },
    reference() {},
    wrong: {
      attempted_cancel(f) {
        assert.throws(() => f.call('reservations.cancel.preview', {reservation_id: 'res-0001'}), code('already_cancelled'));
      },
    },
    fails: {attempted_cancel: ['no_action_after_closure']},
  },
  restriction: {
    checks: ['kept_through_alert'], writes: [],
    setup(f) {
      f.event({event_id: 'smoke', at: '2027-06-28T08:00:00-07:00', operation: 'switchback.alert.posted', payload: {alert_id: 'al-9',
        kind: 'smoke_advisory', facility_id: 'lakeshore', site_ids: [], from: '2027-07-01T00:00:00-07:00', to: '2027-07-04T00:00:00-07:00', text: 'Smoke from a distant fire; air unhealthy for sensitive groups.'}});
    },
    reference() {},
    wrong: {
      cancel_on_restriction(f) {
        f.call('reservations.cancel.confirm', {preview_id: f.call('reservations.cancel.preview', {reservation_id: 'res-0002'}).preview.id});
      },
    },
    fails: {cancel_on_restriction: ['kept_through_alert']},
  },
};

// Runs one scenario and returns the end state and trace an evaluator sees.
function endState(s, fn) {
  const f = fixture();
  if (s.setup) s.setup(f);
  fn(f);
  if (s.end) f.at(s.end);
  return {data: f.view(), trace: f.trace};
}

function run(s, fn) {
  const {data, trace} = endState(s, fn);
  return evaluate(s.checks, data, trace);
}

module.exports = {SCENARIOS, run, endState, book};
