'use strict';
// Business tests for the approved Gustline workflows (proposal §2 core examples and error paths).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const {fixture} = require('./harness.cjs');
const {issuance, forecastEvent, airEvent, alertEvent, alert, deliveryEvent} = require('./helpers.cjs');
const aqi = require('../src/aqi.cjs');

const unchanged = (f, fn, code) => { const before = f.data; assert.throws(fn, e => e.code === code || new RegExp(code).test(e.message)); assert.deepEqual(f.data, before); };
// Seeded history (2025 onward) is replayed from alerts, forecasts and observations whose IDs start with
// `h-` or `al-h-`; most tests look only at what happens during the test.
const history = n => /^(h-|al-h-)/.test(n.source ? n.source.id : n.alert_id);
const list = (f, status) => f.call('gustline.notifications.list', status ? {status} : {}).notifications.filter(n => !history(n));
const alerts = (f, place) => f.call('gustline.alerts.list', {place_id: place}).alerts.filter(a => !history(a));

test('generated contracts and fixtures match their generators', () => {
  require('../scripts/build-contracts.cjs').build({check: true});
  require('../scripts/generate-fixtures.cjs').build({check: true});
});

test('Mail wire schema copy is byte-identical to the receiver-owned schema', {skip: !fs.existsSync(path.resolve(__dirname, '../../../examples/apps/mail'))}, () => {
  const ours = fs.readFileSync(path.resolve(__dirname, '../schemas/mail-router-message.schema.json'));
  const mail = fs.readFileSync(path.resolve(__dirname, '../../../examples/apps/mail/schemas/router-message.schema.json'));
  assert.ok(ours.equals(mail));
});

// ---- Workflow 1: places and settings ----
test('W1 places, saved places and settings', () => {
  const f = fixture();
  assert.equal(f.call('gustline.places.search', {query: 'dune'}).places[0].place_id, 'pl-dunes');
  const {saved_place_id} = f.call('gustline.saved_places.add', {place_id: 'pl-dunes', label: 'Dune Flats'});
  assert.equal(saved_place_id, 'sp-3');
  unchanged(f, () => f.call('gustline.saved_places.add', {place_id: 'pl-dunes', label: 'Other'}), 'duplicate_saved_place');
  unchanged(f, () => f.call('gustline.saved_places.add', {place_id: 'nowhere', label: 'X'}), 'place_not_found');
  f.call('gustline.saved_places.rename', {saved_place_id, label: 'The dunes'});
  assert.equal(f.call('gustline.saved_places.list').saved_places.find(s => s.saved_place_id === saved_place_id).label, 'The dunes');
  f.call('gustline.saved_places.remove', {saved_place_id});
  unchanged(f, () => f.call('gustline.settings.update', {time_zone: 'Mars/Olympus'}), 'invalid_preferences');
  assert.equal(f.call('gustline.settings.update', {units: 'us'}).settings.units, 'us');
});

test('W1 a saved place used by a paused rule cannot be removed until the rule is deleted', () => {
  const f = fixture();
  f.call('gustline.rules.pause', {rule_id: 'rule-1'});
  unchanged(f, () => f.call('gustline.saved_places.remove', {saved_place_id: 'sp-1'}), 'saved_place_in_use');
  f.call('gustline.rules.delete', {rule_id: 'rule-1'});
  f.call('gustline.saved_places.remove', {saved_place_id: 'sp-1'});
  assert.equal(f.data.settings.default_saved_place_id, null);
});

// ---- Workflow 2: forecasts, observations, daylight ----
test('W2 forecast.get answers from the issuance current at virtual time, inclusive of the end hour', () => {
  const f = fixture();
  const r = f.call('gustline.forecast.get', {place_id: 'pl-dunes', from: '2027-10-08T09:00:00-06:00', to: '2027-10-08T19:00:00-06:00', granularity: 'hourly', provider: 'regional_office'});
  assert.equal(r.issuance_id, 'fc-ro-dunes-0500');
  assert.equal(r.periods.length, 11);
  assert.ok(r.periods.every(p => p.start.endsWith('-06:00')));
  assert.deepEqual(r.other_providers_available, ['gustline']);
  assert.equal(r.as_of, '2027-10-08T10:30:00-06:00');
  unchanged(f, () => f.call('gustline.forecast.get', {place_id: 'pl-dunes', from: '2027-10-08T09:00:00-06:00', to: '2027-10-11T16:00:00-06:00', granularity: 'hourly'}), 'outside_horizon');
  unchanged(f, () => f.call('gustline.forecast.get', {place_id: 'pl-dunes', from: '2027-10-08T19:00:00-06:00', to: '2027-10-08T09:00:00-06:00', granularity: 'hourly'}), 'invalid_window');
  unchanged(f, () => f.call('gustline.forecast.get', {place_id: 'pl-home', from: '2027-10-08T12:00:00-07:00', to: '2027-10-08T13:00:00-07:00', granularity: 'hourly', provider: 'regional_office'}), 'no_issuance');
});

test('W2 a later issuance is never visible before its event, and supersedes after it', () => {
  const f = fixture();
  const ask = () => f.call('gustline.forecast.get', {place_id: 'pl-home', from: '2027-10-08T12:00:00-07:00', to: '2027-10-08T14:00:00-07:00', granularity: 'hourly'});
  assert.equal(ask().issuance_id, 'fc-gl-cedar-0500');
  f.event(forecastEvent('2027-10-08T11:02:00-07:00', issuance({id: 'fc-gl-cedar-1100', issued: '2027-10-08T11:00:00-07:00'})));
  assert.equal(ask().issuance_id, 'fc-gl-cedar-1100');
  const history = f.call('gustline.forecast.history', {place_id: 'pl-home', kind: 'weather'}).issuances;
  assert.deepEqual(history.map(i => [i.issuance_id, i.status]), [['fc-gl-cedar-1100', 'current'], ['fc-gl-cedar-0500', 'superseded']]);
  unchanged(f, () => f.event(forecastEvent('2027-10-08T11:30:00-07:00', issuance({id: 'fc-old', issued: '2027-10-08T10:00:00-07:00'}))), 'stale_issuance');
  unchanged(f, () => f.event(forecastEvent('2027-10-08T11:30:00-07:00', issuance({id: 'fc-future', issued: '2027-10-08T12:00:00-07:00'}))), 'invalid_event');
});

test('W2 daily periods, US units and fields a provider does not forecast', () => {
  const f = fixture();
  f.call('gustline.settings.update', {units: 'us'});
  f.event(forecastEvent('2027-10-08T11:02:00-07:00', issuance({id: 'fc-gl-cedar-1100', issued: '2027-10-08T11:00:00-07:00'})));
  const r = f.call('gustline.forecast.get', {place_id: 'pl-home', from: '2027-10-08T12:00:00-07:00', to: '2027-10-08T12:00:00-07:00', granularity: 'hourly'});
  assert.equal(r.periods[0].temp_f, 64.4);
  assert.ok(r.not_provided.includes('uv_index'));
  const d = f.call('gustline.forecast.get', {place_id: 'pl-dunes', from: '2027-10-08T00:00:00-06:00', to: '2027-10-10T00:00:00-06:00', granularity: 'daily'});
  assert.ok(d.periods.length >= 2 && 'high_f' in d.periods[0]);
});

test('W2 observations: corrections keep the earlier value; future windows are refused', () => {
  const f = fixture();
  f.event({event_id: 'ev-corr', at: '2027-10-08T09:40:00-07:00', operation: 'weather.observation_recorded',
    payload: {observation_id: 'ob-cedar-0800c', station_id: 'st-cedar', observed_at: '2027-10-08T08:00:00-07:00', correction_of: 'ob-cedar-0800', temp_c: 17.9}});
  const rows = f.call('gustline.observations.get', {place_id: 'pl-home', from: '2027-10-08T06:00:00-07:00', to: '2027-10-08T09:00:00-07:00'}).observations;
  assert.equal(rows.length, 4);
  const corrected = rows.find(r => r.observed_at === '2027-10-08T08:00:00-07:00');
  assert.equal(corrected.corrected, true);
  assert.equal(corrected.temp_c, 17.9);
  assert.equal(corrected.revisions[0].observation_id, 'ob-cedar-0800');
  unchanged(f, () => f.call('gustline.observations.get', {place_id: 'pl-home', from: '2027-10-08T06:00:00-07:00', to: '2027-10-08T11:00:00-07:00'}), 'not_yet_observed');
  unchanged(f, () => f.event({event_id: 'ev-bad', at: '2027-10-08T09:45:00-07:00', operation: 'weather.observation_recorded',
    payload: {observation_id: 'ob-x', station_id: 'st-cedar', observed_at: '2027-10-08T07:00:00-07:00', correction_of: 'nope', temp_c: 1}}), 'observation_not_found');
});

test('W2 daylight comes from the NOAA algorithm in the place\'s local time', () => {
  const r = fixture().call('gustline.astro.get', {place_id: 'pl-dunes', date: '2027-10-08'});
  assert.match(r.sunrise, /^2027-10-08T07:\d\d:\d\d-06:00$/);
  assert.match(r.sunset, /^2027-10-08T18:\d\d:\d\d-06:00$/);
  assert.ok(r.civil_dawn < r.sunrise && r.sunset < r.civil_dusk);
});

// ---- Workflow 3: air quality ----
test('W3 AQI is computed from concentrations with a recorded table and averaging basis', () => {
  assert.equal(aqi.index('pm25', 48.2), 132);
  assert.equal(aqi.index('pm25', 35.4), 100);
  assert.equal(aqi.index('pm25', 35.5), 101);
  const f = fixture();
  f.event(require('../examples/scenario.json'));
  const r = f.call('gustline.air.current', {place_id: 'pl-school'});
  assert.equal(r.aqi, 132);
  assert.equal(r.category, 'unhealthy_for_sensitive_groups');
  assert.equal(r.dominant_pollutant, 'pm25');
  assert.equal(r.aqi_table, 'epa-2024');
  assert.equal(r.pollutants.pm25.averaging, 'hourly');
  assert.equal(r.pollutants.o3.averaging, '8h_rolling');
  assert.equal(r.stale, false);
  f.advance('2027-10-08T13:30:00-07:00');
  assert.equal(f.call('gustline.air.current', {place_id: 'pl-school'}).stale, true);
  unchanged(f, () => f.call('gustline.air.current', {place_id: 'pl-dunes'}), 'no_monitor_for_place');
  assert.equal(f.call('gustline.air.forecast', {place_id: 'pl-school', from_date: '2027-10-08', to_date: '2027-10-08'}).days.length, 1);
});

// ---- Workflow 4: official alerts ----
test('W4 alert chains: update extends, unknown cancel is refused, status is derived without writes', () => {
  const f = fixture();
  const before = f.call('gustline.alerts.get', {alert_id: 'aqa-77'}).alert;
  assert.equal(before.status, 'active');
  f.event(alertEvent('2027-10-08T10:00:00-07:00', {alert_id: 'aqa-77', version: 2, msg_type: 'update', references: [{alert_id: 'aqa-77', version: 1}],
    issued_at: '2027-10-08T10:00:00-07:00', issuer: 'Cedar Basin Air District', event: 'smoke_advisory', severity: 'moderate', urgency: 'expected',
    certainty: 'likely', areas: {air_area_ids: ['aa-cedar']}, onset: '2027-10-08T00:00:00-07:00', expires: '2027-10-11T00:00:00-07:00',
    headline: 'Smoke advisory extended through Sunday'}));
  const a = f.call('gustline.alerts.get', {alert_id: 'aqa-77'}).alert;
  assert.equal(a.latest_version, 2);
  assert.equal(a.chain.length, 2);
  unchanged(f, () => f.event(alertEvent('2027-10-08T10:10:00-07:00', alert({alert_id: 'aqa-99', version: 2, msg_type: 'cancel', issued_at: '2027-10-08T10:10:00-07:00'}))), 'alert_reference_unknown');
  unchanged(f, () => f.event(alertEvent('2027-10-08T10:10:00-07:00', {...alert({alert_id: 'aqa-77', version: 2, msg_type: 'update', issued_at: '2027-10-08T10:10:00-07:00'})})), 'stale_alert_version');
  f.advance('2027-10-11T00:00:00-07:00');
  assert.equal(alerts(f, 'pl-school')[0].status, 'expired');
});

test('W4 area_closure is informational', () => {
  const f = fixture();
  f.event(alertEvent('2027-10-08T10:00:00-07:00', alert({alert_id: 'cl-1', event: 'area_closure', issuer: 'Dune Flats Park Service',
    areas: {place_ids: ['pl-dunes']}, issued_at: '2027-10-08T10:00:00-07:00', headline: 'Dunes closed for range testing'})));
  const a = alerts(f, 'pl-dunes')[0];
  assert.equal(a.informational, true);
  assert.equal(a.status, 'upcoming');
});

// ---- Workflow 5: rules and notifications ----
test('W5 observation rule: one notification per window occurrence, none outside the window', () => {
  const f = fixture();
  f.event(require('../examples/scenario.json'));                                   // Fri 10:00 AQI 132
  let n = list(f);
  assert.equal(n.length, 1);
  assert.equal(n[0].status, 'pending_delivery');
  assert.equal(n[0].trigger_key, 'rule-1|2027-10-08T07:00:00-07:00|met');
  assert.equal(n[0].title, "AQI 132 at Kids' school");
  f.event(airEvent('2027-10-08T11:05:00-07:00', '2027-10-08T11:00:00-07:00', 55.0));  // same occurrence
  assert.equal(list(f).length, 1);
  f.event(airEvent('2027-10-09T10:05:00-07:00', '2027-10-09T10:00:00-07:00', 60.0));  // Saturday: outside weekday window
  assert.equal(list(f).length, 1);
  f.event(airEvent('2027-10-11T08:05:00-07:00', '2027-10-11T08:00:00-07:00', 60.0));  // Monday: new occurrence
  n = list(f);
  assert.equal(n.length, 2);
  assert.equal(n[1].trigger_key, 'rule-1|2027-10-11T07:00:00-07:00|met');
});

test('W5 quiet hours hold a forecast notification; the clock releases it; same ID throughout', () => {
  const f = fixture();
  const gust = t => (t === Date.parse('2027-10-09T17:00:00-07:00') ? 62 : 20);
  f.event(forecastEvent('2027-10-08T23:10:00-07:00', issuance({id: 'fc-2310', issued: '2027-10-08T23:00:00-07:00', gust})));
  let n = list(f);
  assert.equal(n.length, 1);
  assert.equal(n[0].status, 'held_quiet_hours');
  assert.equal(n[0].release_at, '2027-10-09T07:00:00-07:00');
  assert.equal(n[0].time, '2027-10-09T07:00:00-07:00');
  const id = n[0].notification_id;
  f.event(forecastEvent('2027-10-09T05:02:00-07:00', issuance({id: 'fc-0500', issued: '2027-10-09T05:00:00-07:00', gust})));
  assert.equal(list(f).length, 1);
  f.advance('2027-10-09T07:00:00-07:00');                 // env.advance_time: no App code runs
  n = list(f);
  assert.equal(n[0].status, 'pending_delivery');
  assert.equal(n[0].notification_id, id);
  assert.equal(f.data.notifications.filter(n => !history(n))[0].status, 'held_quiet_hours'); // stored record unchanged; status is derived
});

test('W5 a held notification is withdrawn when the condition clears before release', () => {
  const f = fixture();
  f.event(forecastEvent('2027-10-08T23:10:00-07:00', issuance({id: 'fc-2310', issued: '2027-10-08T23:00:00-07:00',
    gust: t => (t === Date.parse('2027-10-09T17:00:00-07:00') ? 62 : 20)})));
  f.event(forecastEvent('2027-10-09T05:02:00-07:00', issuance({id: 'fc-0500', issued: '2027-10-09T05:00:00-07:00', gust: () => 30})));
  const n = list(f);
  assert.equal(n.find(x => x.phase === 'met').status, 'withdrawn');
  assert.equal(n.filter(x => x.phase === 'cleared').length, 0, 'the person never heard "met", so no "cleared" follows');
});

test('W5 a hazard that returns after a withdrawal is notified again; a held "cleared" is withdrawn', () => {
  const f = fixture(), at17 = t => t === Date.parse('2027-10-09T17:00:00-07:00');
  f.event(forecastEvent('2027-10-08T23:10:00-07:00', issuance({id: 'fc-a', issued: '2027-10-08T23:00:00-07:00', gust: t => (at17(t) ? 62 : 20)})));
  f.event(forecastEvent('2027-10-09T03:02:00-07:00', issuance({id: 'fc-b', issued: '2027-10-09T03:00:00-07:00', gust: () => 30})));
  f.event(forecastEvent('2027-10-09T05:02:00-07:00', issuance({id: 'fc-c', issued: '2027-10-09T05:00:00-07:00', gust: t => (at17(t) ? 70 : 20)})));
  f.advance('2027-10-09T07:00:00-07:00');
  const pending = list(f, 'pending_delivery');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].phase, 'met');
  assert.equal(pending[0].trigger_key, 'rule-2|2027-10-09|met|2');
  assert.match(pending[0].title, /70/);
  // After a "met" the person has heard, clearing notifies (notify_on_clear) and a return notifies again.
  f.event(forecastEvent('2027-10-09T08:02:00-07:00', issuance({id: 'fc-d', issued: '2027-10-09T08:00:00-07:00', gust: () => 30})));
  f.event(forecastEvent('2027-10-09T09:02:00-07:00', issuance({id: 'fc-e', issued: '2027-10-09T09:00:00-07:00', gust: t => (at17(t) ? 66 : 20)})));
  assert.deepEqual(list(f).filter(n => n.status !== 'withdrawn').map(n => n.trigger_key),
    ['rule-2|2027-10-09|met|2', 'rule-2|2027-10-09|cleared', 'rule-2|2027-10-09|met|3']);
});

test('W5 a rule without a window notifies once per evaluation, for the first date that meets it', () => {
  const f = fixture();
  f.event(forecastEvent('2027-10-08T10:02:00-07:00', issuance({id: 'fc-wide', issued: '2027-10-08T10:00:00-07:00', gust: () => 60})));
  const n = list(f);
  assert.equal(n.length, 1);
  assert.equal(n[0].trigger_key, 'rule-2|2027-10-08|met');
});

test('W5 window occurrences across midnight and across the end of DST', () => {
  const {occurrence} = require('../src/rules.cjs'), LA = 'America/Los_Angeles';
  const night = {window: {type: 'recurring', days: [1, 2, 3, 4, 5, 6, 7], start: '22:00', end: '06:00'}};
  assert.equal(occurrence(night, LA, Date.parse('2027-10-09T01:30:00-07:00')), '2027-10-08T22:00:00-07:00', 'after midnight belongs to the start date');
  assert.equal(occurrence(night, LA, Date.parse('2027-11-07T01:30:00-08:00')), '2027-11-06T22:00:00-07:00', 'repeated hour after the DST change');
  assert.equal(occurrence(night, LA, Date.parse('2027-11-07T23:00:00-08:00')), '2027-11-07T22:00:00-08:00');
  const {render, instantOf} = require('../src/time.cjs');
  assert.equal(render(instantOf('2027-03-14', '02:30', LA), LA), '2027-03-14T03:00:00-07:00', 'a skipped time moves forward');
  assert.equal(render(instantOf('2027-11-07', '01:30', LA), LA), '2027-11-07T01:30:00-07:00', 'a repeated time uses its first instance');
});

test('W5 alert rules: watch and warning on one day are two notifications; update notifies; cancel only with notify_on_clear', () => {
  const f = fixture();
  f.call('gustline.rules.create', {saved_place_id: 'sp-2', kind: 'official_alert', alert_events: ['flood_watch', 'flood_warning'], delivery: 'mail'});
  f.event(alertEvent('2027-10-08T10:00:00-07:00', alert({alert_id: 'fw-1', issued_at: '2027-10-08T10:00:00-07:00'})));
  f.event(alertEvent('2027-10-08T15:00:00-07:00', alert({alert_id: 'fwn-2', event: 'flood_warning', issued_at: '2027-10-08T15:00:00-07:00', headline: 'Flood warning'})));
  assert.deepEqual(list(f).map(n => n.trigger_key), ['rule-3|fw-1|1', 'rule-3|fwn-2|1']);
  f.event(alertEvent('2027-10-08T16:00:00-07:00', alert({alert_id: 'fwn-2', version: 2, msg_type: 'update', event: 'flood_warning', issued_at: '2027-10-08T16:00:00-07:00', headline: 'Flood warning extended'})));
  f.event(alertEvent('2027-10-08T17:00:00-07:00', alert({alert_id: 'fwn-2', version: 3, msg_type: 'cancel', event: 'flood_warning', issued_at: '2027-10-08T17:00:00-07:00', headline: 'Flood warning cancelled'})));
  assert.equal(list(f).length, 3);
});

test('W5 a severe alert bypasses quiet hours only with severe_override; a newer version withdraws a held one', () => {
  const f = fixture();
  f.call('gustline.rules.create', {saved_place_id: 'sp-2', kind: 'official_alert', delivery: 'mail', quiet_hours: {start: '22:00', end: '07:00'}, severe_override: true});
  f.call('gustline.rules.create', {saved_place_id: 'sp-2', kind: 'official_alert', delivery: 'mail', quiet_hours: {start: '22:00', end: '07:00'}});
  f.event(alertEvent('2027-10-08T23:30:00-07:00', alert({alert_id: 'sv-1', event: 'severe_thunderstorm_warning', severity: 'severe', issued_at: '2027-10-08T23:30:00-07:00', headline: 'Severe thunderstorm warning'})));
  const byRule = Object.fromEntries(list(f).map(n => [n.rule_id, n.status]));
  assert.deepEqual(byRule, {'rule-3': 'pending_delivery', 'rule-4': 'held_quiet_hours'});
  f.event(alertEvent('2027-10-08T23:50:00-07:00', alert({alert_id: 'sv-1', version: 2, msg_type: 'update', event: 'severe_thunderstorm_warning', severity: 'severe', issued_at: '2027-10-08T23:50:00-07:00', headline: 'Warning updated'})));
  const r4 = list(f).filter(n => n.rule_id === 'rule-4');
  assert.deepEqual(r4.map(n => n.status), ['withdrawn', 'held_quiet_hours']);
});

test('W5 rule limit and missing rules', () => {
  const g = fixture();
  unchanged(g, () => g.call('gustline.rules.get', {rule_id: 'rule-99'}), 'rule_not_found');
  for (let i = 0; i < 23; i++) g.call('gustline.rules.create', {saved_place_id: 'sp-1', kind: 'official_alert'});
  unchanged(g, () => g.call('gustline.rules.create', {saved_place_id: 'sp-1', kind: 'official_alert'}), 'rule_limit');
});

test('W1 the saved-place limit is 20', () => {
  const seed = structuredClone(require('../fixtures/minimal.json'));
  for (let i = 3; i <= 20; i++) seed.saved_places.push({saved_place_id: 'sp-' + i, place_id: 'pl-dunes', label: 'Spot ' + i, created_at: '2027-09-02T08:00:00-07:00'});
  const f = fixture({seed});
  unchanged(f, () => f.call('gustline.saved_places.add', {place_id: 'pl-dunes', label: 'One more'}), 'saved_place_limit');
});

test('W5 a deleted rule is a tombstone: its ID is never reused and its unsent notices are withdrawn', () => {
  const f = fixture();
  f.event(require('../examples/scenario.json'));
  f.call('gustline.rules.delete', {rule_id: 'rule-1'});
  assert.equal(list(f)[0].status, 'withdrawn');
  assert.equal(f.call('gustline.rules.get', {rule_id: 'rule-1'}).rule.status, 'deleted');
  unchanged(f, () => f.call('gustline.rules.update', {rule_id: 'rule-1', patch: {threshold: 120}}), 'rule_not_found');
  const {rule_id} = f.call('gustline.rules.create', {saved_place_id: 'sp-1', kind: 'observation_threshold', metric: 'aqi', comparator: 'gte', threshold: 120, delivery: 'mail'});
  assert.equal(rule_id, 'rule-3');
  f.event(airEvent('2027-10-08T11:05:00-07:00', '2027-10-08T11:00:00-07:00', 60.0));
  assert.equal(list(f).filter(n => n.rule_id === 'rule-3').length, 1, 'the new rule notifies');
});

test('W4 updates must reference the latest version and keep the event; cancel notifies only with notify_on_clear', () => {
  const f = fixture();
  f.call('gustline.rules.create', {saved_place_id: 'sp-2', kind: 'official_alert', delivery: 'in_app', notify_on_clear: true});
  f.event(alertEvent('2027-10-08T10:00:00-07:00', alert({alert_id: 'fw-9', issued_at: '2027-10-08T10:00:00-07:00'})));
  unchanged(f, () => f.event(alertEvent('2027-10-08T10:10:00-07:00', {...alert({alert_id: 'fw-9', version: 2, msg_type: 'update', issued_at: '2027-10-08T10:10:00-07:00'}), references: [{alert_id: 'zzz-1', version: 9}]})), 'alert_reference_unknown');
  unchanged(f, () => f.event(alertEvent('2027-10-08T10:10:00-07:00', alert({alert_id: 'fw-9', version: 2, msg_type: 'update', event: 'flood_warning', issued_at: '2027-10-08T10:10:00-07:00'}))), 'invalid_event');
  f.event(alertEvent('2027-10-08T10:20:00-07:00', {...alert({alert_id: 'fw-9', version: 3, msg_type: 'cancel', issued_at: '2027-10-08T10:20:00-07:00'}), references: [{alert_id: 'fw-9', version: 1}]}));
  assert.deepEqual(list(f).map(n => n.phase), ['alert', 'cancel'], 'a version gap is allowed; cancel notifies with notify_on_clear');
});

test('W5 a held alert notice is withdrawn when a newer version no longer matches the rule', () => {
  const f = fixture();
  f.call('gustline.rules.create', {saved_place_id: 'sp-2', kind: 'official_alert', min_severity: 'moderate', delivery: 'mail', quiet_hours: {start: '22:00', end: '07:00'}});
  f.event(alertEvent('2027-10-08T23:00:00-07:00', alert({alert_id: 'wa-1', event: 'wind_advisory', issued_at: '2027-10-08T23:00:00-07:00', headline: 'Wind advisory'})));
  assert.equal(list(f)[0].status, 'held_quiet_hours');
  f.event(alertEvent('2027-10-08T23:30:00-07:00', alert({alert_id: 'wa-1', version: 2, msg_type: 'update', event: 'wind_advisory', severity: 'minor', issued_at: '2027-10-08T23:30:00-07:00', headline: 'Wind advisory downgraded'})));
  assert.deepEqual(list(f).map(n => n.status), ['withdrawn']);
});

test('W2 a correction can name the original observation ID', () => {
  const f = fixture();
  const corr = (id, of, at, temp) => ({event_id: 'ev-' + id, at, operation: 'weather.observation_recorded',
    payload: {observation_id: id, station_id: 'st-cedar', observed_at: '2027-10-08T08:00:00-07:00', correction_of: of, temp_c: temp}});
  f.event(corr('ob-c1', 'ob-cedar-0800', '2027-10-08T09:40:00-07:00', 17.9));
  f.event(corr('ob-c2', 'ob-cedar-0800', '2027-10-08T09:45:00-07:00', 18.1));
  const row = f.call('gustline.observations.get', {place_id: 'pl-home', from: '2027-10-08T08:00:00-07:00', to: '2027-10-08T08:00:00-07:00'}).observations[0];
  assert.equal(row.temp_c, 18.1);
  assert.equal(row.revisions.length, 2);
});

test('W3 reads state that PM AQI is hourly, not NowCast', () => {
  const f = fixture();
  f.event(require('../examples/scenario.json'));
  assert.match(f.call('gustline.air.current', {place_id: 'pl-school'}).basis, /not EPA NowCast/);
  assert.match(list(f)[0].body, /not NowCast/);
  assert.match(require('../tools.json').find(t => t.name === 'gustline.air.current').description, /not EPA NowCast/);
});

test('W2 forecast history lists three issuances with two superseded (desert pack)', () => {
  const d = path.resolve(__dirname, '../examples/packs/desert-storm');
  const {virtual_now, events} = require(path.join(d, 'events.json'));
  const f = fixture({seed: require(path.join(d, 'seed.json')), now: virtual_now, binding: require(path.join(d, 'binding.json'))});
  for (const e of events) f.event(e);
  const h = f.call('gustline.forecast.history', {place_id: 'pl-dunes', kind: 'weather', provider: 'regional_office'}).issuances;
  assert.deepEqual(h.map(i => i.status), ['current', 'superseded', 'superseded']);
});

test('fixtures: history runs from January 2025; the task timeline starts in 2026; packs stay under 400 KB', () => {
  const packs = ['desert-storm', 'smoke-week', 'commuter-week'];
  const seeds = [['minimal', require('../fixtures/minimal.json'), require('../fixtures/clock.json').initial_time],
    ...packs.map(p => [p, require(`../examples/packs/${p}/seed.json`), require(`../examples/packs/${p}/events.json`).virtual_now])];
  const walk = v => typeof v === 'string' ? (/^\d{4}-\d{2}-\d{2}T/.test(v) ? [v] : []) : v && typeof v === 'object' ? Object.values(v).flatMap(walk) : [];
  for (const [name, seed, now] of seeds) {
    const times = walk(seed).map(Date.parse);
    assert.ok(Math.min(...times) >= Date.parse('2025-01-01T00:00:00Z'), name + ': nothing before 2025-01-01');
    assert.ok(Math.min(...times) < Date.parse('2025-02-01T00:00:00Z'), name + ': history reaches January 2025');
    assert.ok(Date.parse(now) >= Date.parse('2026-01-01T00:00:00Z'), name + ': the task timeline starts in 2026');
    assert.ok(seed.notifications.some(n => history(n) && Date.parse(n.created_at) < Date.parse('2026-01-01T00:00:00Z')), name + ': 2025 activity');
  }
  for (const p of packs) {
    const dir = path.resolve(__dirname, '../examples/packs', p);
    const bytes = fs.readdirSync(dir).reduce((sum, f) => sum + fs.statSync(path.join(dir, f)).size, 0);
    assert.ok(bytes < 400 * 1024, p + ' is ' + bytes + ' bytes');
  }
});

test('W5 rule writes: validation, revisions, pause and resume, delete keeps notifications', () => {
  const f = fixture();
  unchanged(f, () => f.call('gustline.rules.create', {saved_place_id: 'sp-1', kind: 'observation_threshold', metric: 'aqi', comparator: 'gte', threshold: 600}), 'invalid_rule');
  unchanged(f, () => f.call('gustline.rules.create', {saved_place_id: 'sp-1', kind: 'forecast_threshold', metric: 'aqi', comparator: 'gte', threshold: 100}), 'invalid_rule');
  unchanged(f, () => f.call('gustline.rules.create', {saved_place_id: 'sp-1', kind: 'official_alert', metric: 'aqi'}), 'invalid_rule');
  unchanged(f, () => f.call('gustline.rules.create', {saved_place_id: 'sp-9', kind: 'official_alert'}), 'saved_place_not_found');
  assert.equal(f.call('gustline.rules.update', {rule_id: 'rule-1', patch: {threshold: 151}}).revision, 2);
  assert.equal(f.call('gustline.rules.get', {rule_id: 'rule-1'}).rule.history.at(-1).changes.threshold, 151);
  f.call('gustline.rules.pause', {rule_id: 'rule-1'});
  unchanged(f, () => f.call('gustline.rules.pause', {rule_id: 'rule-1'}), 'already_paused');
  f.event(require('../examples/scenario.json'));
  assert.equal(list(f).length, 0, 'paused rules are not evaluated');
  f.call('gustline.rules.resume', {rule_id: 'rule-1'});
  unchanged(f, () => f.call('gustline.rules.resume', {rule_id: 'rule-1'}), 'not_paused');
  f.event(airEvent('2027-10-08T11:05:00-07:00', '2027-10-08T11:00:00-07:00', 80.0));
  assert.equal(list(f).length, 1, 'evaluated from the next event, no retroactive notification');
  f.call('gustline.rules.delete', {rule_id: 'rule-1'});
  assert.equal(list(f).length, 1);
  const {notification_id} = list(f)[0];
  assert.ok(f.call('gustline.notifications.acknowledge', {notification_id}).acknowledged_at);
});

test('W5 high and low temperature rules compare the warmest or coolest hour of each occurrence', () => {
  const f = fixture();
  // Every hour is 18 °C except one cool hour at 03:00: the high stays 18, so "high at most 15" is not met.
  const cool = t => (new Date(t).getUTCHours() === 10 ? 9 : 18);
  f.call('gustline.rules.create', {saved_place_id: 'sp-2', kind: 'forecast_threshold', metric: 'temp_max_c', comparator: 'lte', threshold: 15, look_ahead_hours: 24});
  f.call('gustline.rules.create', {saved_place_id: 'sp-2', kind: 'forecast_threshold', metric: 'temp_min_c', comparator: 'lte', threshold: 10, look_ahead_hours: 24});
  f.event(forecastEvent('2027-10-08T11:02:00-07:00', issuance({id: 'fc-cool', issued: '2027-10-08T11:00:00-07:00', temp: cool})));
  const fired = list(f).map(n => n.rule_id);
  assert.ok(!fired.includes('rule-3'), 'a single cool hour does not make the high 15 or lower');
  assert.ok(fired.includes('rule-4'), 'the low reaches 9');
  assert.match(list(f).find(n => n.rule_id === 'rule-4').title, /^Low temperature 9°C forecast/);
});

test('W5 notice text keeps acronyms in rule descriptions', () => {
  const f = fixture();
  f.event(require('../examples/scenario.json'));
  assert.match(list(f)[0].body, /Your rule: AQI 101 or higher/);
});

test('W5 delivery outcomes map to notification status', () => {
  const f = fixture();
  f.event(require('../examples/scenario.json'));
  const id = list(f)[0].notification_id;
  f.event(deliveryEvent('2027-10-08T10:06:00-07:00', id, 'unknown', 'receiver_unconfirmed', {stop_run: true}));
  assert.equal(list(f)[0].status, 'pending_delivery');
  f.event(deliveryEvent('2027-10-08T10:07:00-07:00', id, 'rejected', 'idempotency_conflict'));
  assert.equal(list(f)[0].status, 'pending_delivery');
  f.event(deliveryEvent('2027-10-08T10:08:00-07:00', id, 'committed'));
  assert.equal(list(f)[0].status, 'delivered');
  assert.equal(list(f)[0].outcome.router_event_id, 'router-abc');
  unchanged(f, () => f.event(deliveryEvent('2027-10-08T10:09:00-07:00', id, 'committed')), 'notification_not_pending');
  unchanged(f, () => f.event(deliveryEvent('2027-10-08T10:09:00-07:00', 'ntf-missing', 'committed')), 'notification_not_found');
  const g = fixture();
  g.event(require('../examples/scenario.json'));
  g.event(deliveryEvent('2027-10-08T10:06:00-07:00', list(g)[0].notification_id, 'rejected', 'recipient_not_authorized'));
  assert.equal(list(g)[0].status, 'delivery_failed');
  // Halting outcomes keep the notification pending, with the code stored for reconciliation.
  for (const [status, code] of [['rejected', 'receiver_rejected'], ['halted', 'run_halted']]) {
    const h = fixture();
    h.event(require('../examples/scenario.json'));
    h.event(deliveryEvent('2027-10-08T10:06:00-07:00', list(h)[0].notification_id, status, code, {stop_run: true}));
    assert.equal(list(h)[0].status, 'pending_delivery', status);
    assert.deepEqual([list(h)[0].outcome.status, list(h)[0].outcome.code, list(h)[0].outcome.stop_run], [status, code, true]);
  }
});

test('W5 a held notification cannot be delivered before release', () => {
  const f = fixture();
  f.event(forecastEvent('2027-10-08T23:10:00-07:00', issuance({id: 'fc-2310', issued: '2027-10-08T23:00:00-07:00',
    gust: t => (t === Date.parse('2027-10-09T17:00:00-07:00') ? 62 : 20)})));
  const id = list(f)[0].notification_id;
  unchanged(f, () => f.event(deliveryEvent('2027-10-08T23:20:00-07:00', id, 'committed')), 'notification_not_pending');
  f.advance('2027-10-09T07:00:00-07:00');
  f.event(deliveryEvent('2027-10-09T07:01:00-07:00', id, 'committed'));
  assert.equal(list(f)[0].status, 'delivered');
});

// ---- Seed checks and cross-App references ----
test('seed: future-dated history is rejected; external references must be in the binding', () => {
  const f = fixture(), bad = f.data;
  bad.issuances[0].issued_at = '2027-10-09T00:00:00-07:00';
  assert.throws(() => plugin.validateSeed(f.ctx, bad), /after the current virtual time/);
  const linked = f.data;
  linked.places[2].external_ref = {app_id: 'switchback', account_id: 'sb-ana', object_id: 'fac-dunes'};
  assert.throws(() => plugin.validateSeed(f.ctx, linked), /binding/);
  const ctx = {...f.ctx, binding: {...f.ctx.binding, accounts: [...f.ctx.binding.accounts, {app_id: 'switchback', account_id: 'sb-ana', owner_person_id: 'person-ana'}],
    objects: {...f.ctx.binding.objects, switchback: ['fac-dunes']}}};
  plugin.validateSeed(ctx, linked);
  assert.deepEqual(plugin.references(linked), [linked.places[2].external_ref]);
});

test('optional diagnostics cannot change business results', () => {
  const on = fixture(), off = fixture({logging: false});
  for (const f of [on, off]) f.event(require('../examples/scenario.json'));
  assert.deepEqual(on.data, off.data);
  assert.ok(on.logs.some(l => l.step === 'gustline.notification_created'));
});

// ---- Scenario packs: each loads as a seed and replays its events in order ----
for (const name of ['desert-storm', 'smoke-week', 'commuter-week']) {
  test(`pack ${name}: loads, replays every event, and stays physically consistent`, () => {
    const dirPack = path.resolve(__dirname, '../examples/packs', name);
    const seed = require(path.join(dirPack, 'seed.json')), {virtual_now, events} = require(path.join(dirPack, 'events.json'));
    for (const file of ['seed.json', 'events.json']) assert.ok(fs.statSync(path.join(dirPack, file)).size < 400 * 1024, file + ' under 400 KB');
    const f = fixture({seed, now: virtual_now, binding: require(path.join(dirPack, 'binding.json'))});
    for (const e of events) f.event(e);
    const data = f.data;
    for (const i of data.issuances) {
      for (const h of i.hourly) {
        assert.ok(h.gust_kph >= h.wind_kph, 'gust >= wind in ' + i.issuance_id);
        assert.ok(h.dew_point_c <= h.temp_c, 'dew point <= temperature in ' + i.issuance_id);
      }
      // Daily periods cover the first days of the hourly window, in order, with consistent highs and lows.
      const hourDates = [...new Set(i.hourly.map(h => h.start.slice(0, 10)))];
      assert.deepEqual(i.daily.map(d => d.date), hourDates.slice(0, i.daily.length), 'daily periods cover the hourly window');
      for (const d of i.daily) {
        const temps = i.hourly.filter(h => h.start.startsWith(d.date)).map(h => h.temp_c);
        assert.ok(d.high_c === Math.max(...temps) && d.low_c === Math.min(...temps), 'daily high/low match hourly ' + d.date);
      }
      // Every period's local offset matches its zone at that instant (correct across DST).
      const tz = data.zones.find(z => z.zone_id === i.zone_id).time_zone, {render} = require('../src/time.cjs');
      for (const h of i.hourly) assert.equal(render(h.start, tz), h.start, 'local time and offset ' + h.start);
    }
    for (const m of data.monitors) {
      const at = Date.parse(f.now), mine = data.air_observations.filter(o => o.monitor_id === m.monitor_id);
      if (!mine.length) continue;
      const r = aqi.compute(mine, at);
      assert.ok(Number.isInteger(r.aqi) && r.category === aqi.category(r.aqi), 'recomputed AQI and category agree');
    }
    assert.ok(data.notifications.some(n => !history(n) && !seed.notifications.some(x => x.notification_id === n.notification_id)), 'the pack exercises at least one rule');
  });
}
