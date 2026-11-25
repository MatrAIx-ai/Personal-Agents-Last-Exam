#!/usr/bin/env node
'use strict';
// Builds fixtures/minimal.json. The catalog and the plans are written directly; everything the household
// did (viewings, lists, profiles, devices, plan changes, charges) is replayed through the App's own
// handlers, so every history row, progress row, notification and activity row is one the App produced.
// Run with --check to rebuild in memory and compare byte for byte.
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const plugin = require('../plugin.cjs');
const derive = require('../src/derive.cjs');
const binding = require('../fixtures/binding.json');
const CLOCK = require('../fixtures/clock.json').initial_time;
const APP = 'lanternbox';

let state = 0x1a47e2b0;
const rand = () => { state |= 0; state = state + 0x6D2B79F5 | 0; let t = Math.imul(state ^ state >>> 15, 1 | state); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = rows => rows[int(0, rows.length - 1)];
const shuffle = rows => { const a = [...rows]; for (let i = a.length - 1; i > 0; i--) { const j = int(0, i); [a[i], a[j]] = [a[j], a[i]]; } return a; };
// Local times are Eastern; the offset follows the calendar through Node's built-in Intl.
const zone = new Intl.DateTimeFormat('en-US', {timeZone: 'America/New_York', timeZoneName: 'longOffset'});
function iso(utcMs) {
  const offset = zone.formatToParts(new Date(utcMs)).find(p => p.type === 'timeZoneName').value.replace('GMT', '') || '+00:00';
  const minutes = (offset[0] === '-' ? -1 : 1) * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
  return new Date(utcMs + minutes * 60000).toISOString().slice(0, 19) + offset;
}
const at = text => Date.parse(text), DAY = 86400000, MIN = 60000;
const local = (y, m, d, h = 0, min = 0) => { let utc = Date.UTC(y, m - 1, d, h + 5, min); if (iso(utc).slice(11, 16) !== String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0')) utc -= 3600000; return utc; };   // Eastern wall time

// ---- plans and catalog (all names invented) ----
const plans = [{plan_id: 'basic', name: 'Basic', price_cents: 999, max_profiles: 2, quality: 'HD'}, {plan_id: 'standard', name: 'Standard', price_cents: 1599, max_profiles: 4, quality: 'Full HD'},
  {plan_id: 'premium', name: 'Premium', price_cents: 2299, max_profiles: 5, quality: '4K'}];
const FILMS = [['Paper Kites', '7+', ['family', 'drama']], ['The Lamplighter\'s Almanac', '13+', ['drama']], ['Salt on the Ferry Road', '16+', ['thriller']], ['Nine Winters in Varrow', '16+', ['drama']],
  ['A Field Guide to Leaving', '13+', ['romance', 'drama']], ['The Quiet Semaphore', '13+', ['mystery']], ['Marigold Station', '7+', ['family', 'adventure']], ['Understory', '18+', ['thriller']],
  ['Tin Roof Sonata', '13+', ['drama', 'romance']], ['Kestrel Over Low Water', '13+', ['documentary']], ['Borrowed Thunder', '16+', ['thriller']], ['The Orchard at Milepost 9', '13+', ['mystery', 'drama']],
  ['Half Past the Moon', 'all', ['animation', 'family']], ['Wren and the Weather Machine', 'all', ['animation', 'adventure']], ['The Biscuit Tin Expedition', 'all', ['family', 'adventure']],
  ['Captain Pim and the Paper Sea', 'all', ['animation', 'family']], ['Moss, Stone, Lantern', '7+', ['documentary']], ['The Last Bus to Ellery', '13+', ['comedy', 'drama']], ['Small Hours Radio', '16+', ['drama']],
  ['The Understudy\'s Winter', '13+', ['comedy']], ['Copper Wire Lullaby', '16+', ['science fiction']], ['Seven Doors Down the Quay', '16+', ['mystery']], ['Juniper Rules', '7+', ['comedy', 'family']],
  ['The Long Division of Summer', '13+', ['drama']], ['Night Shift at the Aviary', '16+', ['comedy']], ['Brine', '18+', ['thriller']], ['The Honest Burglar of Thistle Row', '7+', ['comedy', 'family']],
  ['The Afterlight Shift', '18+', ['science fiction', 'thriller']], ['Gravel Hymn', '18+', ['drama']], ['The Clockmender\'s Holiday', '7+', ['family', 'comedy']], ['Otter Club', 'all', ['animation', 'family']],
  ['Pepper and the Midnight Garden', 'all', ['animation', 'adventure']], ['The Tallest Hat in Quillby', '7+', ['comedy', 'family']], ['Dandelion Courier', '13+', ['adventure']], ['What the Tide Kept', '16+', ['mystery', 'drama']],
  ['Ashgrove Protocol', '18+', ['thriller', 'science fiction']], ['The Velvet Ledger', '18+', ['drama', 'mystery']], ['Hollow Reed', '16+', ['drama']], ['Cold Harbour Arithmetic', '16+', ['documentary']], ['A Map of Small Mercies', '13+', ['drama']]];
const SERIES = [['Harbor Lights', '13+', ['drama', 'mystery'], [8, 5]], ['The Greenhouse Mysteries', '13+', ['mystery'], [6, 6]], ['Tumblewick Farm', 'all', ['animation', 'family'], [8, 8, 6]], ['North of Varrow', '16+', ['drama'], [6, 6]],
  ['Beacon Row', '16+', ['thriller'], [8, 4]], ['The Pocket Detectives', '7+', ['family', 'mystery'], [8, 8]], ['Lantern Street', '13+', ['comedy'], [8, 8, 8]], ['Underfloor', '18+', ['thriller'], [6]],
  ['Bramble and Co.', 'all', ['animation', 'family'], [8, 8]], ['Salt Marsh Division', '16+', ['mystery', 'drama'], [6, 6]], ['The Night Bakers', '7+', ['documentary', 'comedy'], [6, 6]],
  ['Quillby Junior Explorers', '7+', ['family', 'adventure'], [8, 6]], ['The Ferry Clerks', '16+', ['drama'], [8]], ['Third Bell Shift', '13+', ['comedy', 'drama'], [8, 8]], ['The Almanac Hour', '7+', ['documentary'], [6, 6]],
  ['Paperweight Court', '18+', ['drama'], [6, 6]], ['Low Country Tides', '13+', ['romance', 'drama'], [8, 6]], ['Wickerby Hall', '13+', ['mystery', 'comedy'], [6, 6, 6]], ['The Understory Files', '16+', ['science fiction'], [8]],
  ['Static Bloom', '18+', ['science fiction', 'thriller'], [6, 4]]];
const EPISODES = ['First Light', 'The Long Way Round', 'Borrowed Keys', 'A Small Favour', 'Crosswinds', 'What the Map Left Out', 'Second Thoughts', 'The Lost Hour', 'Paper Trail', 'Open Water', 'Night Ferry', 'Half Measures',
  'The Quiet Room', 'Left at the Lighthouse', 'Old Debts', 'A Fair Exchange', 'Still Waters', 'The Missing Page', 'Under the Arches', 'Company', 'Fog Signal', 'Seven Lanterns', 'The Other Key', 'Slack Water', 'An Honest Mistake',
  'Wrong Platform', 'The Understudy', 'Last Orders', 'Breadcrumbs', 'High Ground', 'A Change in the Weather', 'Loose Threads', 'The Locked Drawer', 'Homecoming', 'Two Truths', 'Ebb', 'Closing Time', 'The Visitor', 'Salt and Iron', 'Morning After'];
const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^(the|a)-/, '').replace(/^-|-$/g, '').split('-').slice(0, 2).join('-');
const titles = [];
const ENDS = {'Kestrel Over Low Water': local(2026, 6, 30, 23, 59), 'Borrowed Thunder': local(2026, 10, 31, 23, 59), 'Tin Roof Sonata': local(2026, 11, 28, 23, 59), 'The Last Bus to Ellery': local(2026, 12, 31, 23, 59),
  'Small Hours Radio': local(2027, 1, 31, 23, 59), 'Otter Club': local(2027, 3, 15, 23, 59)};
const STARTS = {'Hollow Reed': local(2026, 11, 27, 3), 'Cold Harbour Arithmetic': local(2026, 12, 11, 3)};   // two films still upcoming at the fixture time
FILMS.forEach(([name, maturity, genres], i) => titles.push({title_id: 'ttl-' + slug(name), kind: 'film', name, maturity, genres, synopsis: null,
  available_from: iso(STARTS[name] ?? local(2022 + i % 4, 1 + (i * 5) % 12, 1 + (i * 7) % 27, 3)), available_until: ENDS[name] ? iso(ENDS[name]) : null, runtime_seconds: (['all', '7+'].includes(maturity) ? int(74, 98) : int(88, 134)) * 60, seasons: []}));
let pool = 0;
SERIES.forEach(([name, maturity, genres, counts], i) => {
  const id = 'ttl-' + slug(name), short = slug(name).split('-')[0], kids = ['all', '7+'].includes(maturity) && genres.includes('family');
  // Seasons end before the fixture time, except three series that are still releasing weekly in November 2026.
  const lastSeasonStart = {'Harbor Lights': local(2026, 10, 16, 3), 'Beacon Row': local(2026, 11, 6, 3), 'Static Bloom': local(2026, 10, 30, 3)}[name];
  const seasons = counts.map((n, s) => {
    const start = s === counts.length - 1 && lastSeasonStart ? lastSeasonStart : local(2023 + Math.floor((i + s * 3) / 5) % 3, 1 + (i * 3 + s * 5) % 12, 2 + (i * 5) % 24, 3) ;
    return {number: s + 1, episodes: Array.from({length: n}, (_, e) => ({playable_id: 'ep-' + short + '-s' + (s + 1) + 'e' + String(e + 1).padStart(2, '0'), number: e + 1, name: EPISODES[(pool++ * 7 + i) % EPISODES.length],
      runtime_seconds: name === 'Harbor Lights' && s === 1 && e === 4 ? 2820 : (kids ? int(11, 24) : int(24, 58)) * 60, released_at: iso(start + e * 7 * DAY)}))};
  });
  // Harbor Lights season 2, episodes 1-5, arrive as events below (so their notifications exist); the last Beacon Row and Static Bloom episodes are still unreleased.
  if (name === 'Harbor Lights') seasons[1].episodes = [];
  const first = Math.min(...seasons.flatMap(s => s.episodes).map(e => at(e.released_at)));
  titles.push({title_id: id, kind: 'series', name, maturity, genres, synopsis: null, available_from: iso(first), available_until: null, runtime_seconds: null, seasons});
});
const SYNOPSES = {'ttl-harbor-lights': 'A ferry town keeps its own counsel, until a keeper\'s logbook turns up forty years late.', 'ttl-paper-kites': 'Two cousins spend a windless summer trying to fly the kite their grandfather never finished.',
  'ttl-night-bakers': 'Six bakeries, one night each: what a town eats at dawn and who makes it.', 'ttl-tumblewick-farm': 'A goat, a goose and a very small tractor run the farm while the farmer naps.'};
for (const t of titles) t.synopsis = SYNOPSES[t.title_id] ?? null;
const T = name => titles.find(t => t.name === name);

// ---- starting records: the account on Basic with its two adult profiles ----
const start = local(2025, 1, 2, 10);
let data = {account_id: 'lanternbox-okoro', account: {owner_profile_id: 'prof-sana', plan_id: 'basic', paid_through: iso(local(2025, 1, 3)), pending: null}, plans,
  profiles: [{profile_id: 'prof-sana', name: 'Sana', maturity_ceiling: '18+', autoplay: true, notify_new_episodes: true, notify_leaving: true, kind: 'adult', person_id: 'person-sana', created_at: iso(start)},
    {profile_id: 'prof-dele', name: 'Dele', maturity_ceiling: '18+', autoplay: false, notify_new_episodes: true, notify_leaving: false, kind: 'adult', person_id: 'person-dele', created_at: iso(start + 5 * MIN)}],
  titles, progress: [], history: [], watchlist: [], devices: [], charges: [], notifications: [], activity: [], counters: {profile: 0, history: 0, charge: 0, notification: 0}};

// ---- replay through the App ----
let calls = 0, events = 0;
const rename = {};
const ctx = (ms, role = 'agent') => ({app_id: APP, role, virtual_now: iso(ms), binding});
function tool(ms, name, args) {
  const out = plugin.handleTool(ctx(ms), structuredClone(data), APP + '.' + name, {...args, request_id: 'hist-' + String(++calls).padStart(4, '0'), expected_version: {epoch: 1, revision: calls}});
  plugin.validateSeed(ctx(ms), out.data); data = out.data; return out.result;
}
function event(ms, name, payload) {
  const e = {event_id: 'hist-ev-' + String(++events).padStart(4, '0'), at: iso(ms), operation: APP + '.' + name, payload};
  const next = plugin.applyEvent(ctx(ms, 'infra'), structuredClone(data), e); plugin.validateSeed(ctx(ms), next); data = next;
}
const queue = [];
let order = 0;
const plan = (ms, run) => queue.push({ms, order: order++, run});
const profileId = name => data.profiles.find(p => p.name === name).profile_id;

// devices, in the order the household first used them
[['dev-livingroom-tv', 'Living-room TV', 'tv', start + 20 * MIN], ['dev-old-laptop', 'Old laptop', 'computer', start + 45 * MIN], ['dev-sana-phone', 'Sana\'s phone', 'phone', local(2025, 1, 4, 8, 12)],
  ['dev-dele-laptop', 'Dele\'s laptop', 'computer', local(2025, 1, 5, 19, 30)], ['dev-kids-tablet', 'Kids\' tablet', 'tablet', local(2025, 3, 10, 16, 40)]]
  .forEach(([device_id, name, kind, ms]) => plan(ms, () => event(ms, 'device.signed_in', {device_id, name, kind})));
plan(local(2025, 9, 1, 9, 15), () => tool(local(2025, 9, 1, 9, 15), 'devices.sign_out', {id: 'dev-old-laptop'}));
// plan and profiles: an upgrade to Standard, then a kids profile and a relative's profile
plan(local(2025, 3, 10, 16, 20), () => tool(local(2025, 3, 10, 16, 20), 'plan.change', {id: 'standard'}));
plan(local(2025, 3, 10, 16, 25), () => { rename[tool(local(2025, 3, 10, 16, 25), 'profiles.create', {profile: {name: 'Timi', kind: 'kids', autoplay: false}}).id] = 'prof-timi'; });
plan(local(2025, 6, 1, 11, 5), () => { rename[tool(local(2025, 6, 1, 11, 5), 'profiles.create', {profile: {name: 'Auntie Bisi', kind: 'adult', maturity_ceiling: '16+', person_id: 'person-bisi', notify_leaving: false}}).id] = 'prof-bisi'; });
// charges: monthly on the 3rd; April 2026 fails once and is paid two days later
for (let k = 0; k < 23; k++) {
  const y = 2025 + Math.floor(k / 12), m = 1 + k % 12, startMs = local(y, m, 3), endMs = local(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 3), label = y + '-' + String(m).padStart(2, '0');
  const charge = (ms, result, id, reason) => plan(ms, () => event(ms, 'billing.charged', {charge_id: id, period_start: data.account.paid_through, period_end: iso(endMs), amount_cents: derive.account(data, iso(ms)).next_charge.amount_cents, result, ...(reason ? {reason} : {})}));
  if (label === '2026-04') { charge(startMs + 250 * MIN, 'failed', 'chg-' + label + '-a', 'card_declined'); charge(startMs + 2 * DAY + 600 * MIN, 'paid', 'chg-' + label + '-b'); }
  else charge(startMs + 250 * MIN, 'paid', 'chg-' + label);
}
// Harbor Lights season 2 arrives weekly; a film gets an end date
const WEEKS = [[10, 16], [10, 23], [10, 30], [11, 6], [11, 13]];
[['ep-harbor-s2e01', 'Return Fare', 2940], ['ep-harbor-s2e02', 'The Keeper\'s Log', 2760], ['ep-harbor-s2e03', 'Dead Reckoning', 3000], ['ep-harbor-s2e04', 'Spring Tide', 2880], ['ep-harbor-s2e05', 'Leading Lights', 2820]]
  .forEach(([playable_id, name, runtime_seconds], i) => { const when = local(2026, WEEKS[i][0], WEEKS[i][1], 3);
    plan(when, () => event(when, 'catalog.episode_released', {title_id: 'ttl-harbor-lights', season: 2, episode: {playable_id, number: i + 1, name, runtime_seconds}})); });
plan(local(2026, 9, 20, 9), () => event(local(2026, 9, 20, 9), 'catalog.leaving_set', {title_id: T('Borrowed Thunder').title_id, available_until: iso(local(2026, 10, 31, 23, 59))}));
T('Borrowed Thunder').available_until = null;

// ---- viewings ----
const DEVICES = {Sana: ['dev-livingroom-tv', 'dev-livingroom-tv', 'dev-sana-phone'], Dele: ['dev-dele-laptop', 'dev-dele-laptop', 'dev-livingroom-tv'], Timi: ['dev-kids-tablet', 'dev-kids-tablet', 'dev-kids-tablet', 'dev-livingroom-tv'], 'Auntie Bisi': ['dev-livingroom-tv']};
const FOLLOWS = {Sana: ['The Greenhouse Mysteries', 'Lantern Street', 'Salt Marsh Division', 'Low Country Tides', 'Paperweight Court'], Dele: ['North of Varrow', 'Beacon Row', 'Third Bell Shift', 'The Understory Files', 'Static Bloom'],
  Timi: ['Tumblewick Farm', 'The Pocket Detectives', 'Bramble and Co.', 'Quillby Junior Explorers']};
const RESERVED = new Set(['Harbor Lights', 'The Night Bakers', 'Paper Kites']);
function watch(ms, who, playableId, runtime, {partial = null, device} = {}) {
  const position = partial ?? runtime, end = ms + Math.ceil(position / 60) * MIN;
  plan(end, () => event(end, 'playback.recorded', {profile_id: profileId(who), device_id: device || pick(DEVICES[who].filter(id => data.devices.some(d => d.device_id === id && d.status === 'signed_in'))), playable_id: playableId, started_at: iso(ms), position_seconds: position, completed: partial === null}));
}
function session(ms, who) {
  // Chosen when the session starts, from what this profile may see and has not finished.
  plan(ms, () => {
    const p = data.profiles.find(x => x.name === who), now = iso(ms);
    const open = t => derive.canSee(p, t) && ['available', 'leaving_soon'].includes(derive.availability(t, now));
    let choice = null;
    if (rand() < 0.68) for (const name of shuffle(FOLLOWS[who])) { const t = T(name), next = open(t) && derive.nextUp(data, t, p.profile_id, now); if (next) { choice = derive.findPlayable(data, next.playable_id).playable; break; } }
    if (!choice) { const films = data.titles.filter(t => t.kind === 'film' && !RESERVED.has(t.name) && open(t) && (who !== 'Timi' || t.genres.includes('family') || t.genres.includes('animation')) &&
      !data.progress.some(r => r.profile_id === p.profile_id && r.playable_id === t.title_id && r.completed)); if (films.length) choice = derive.playables(pick(films))[0]; }
    if (!choice) return;
    const partial = rand() < 0.14 ? Math.round(choice.runtime_seconds * (0.2 + rand() * 0.55) / 60) * 60 : null;
    watch(ms, who, choice.playable_id, choice.runtime_seconds, {partial});
  });
}
const evening = (from, to, earliest, latest) => { const day = at(iso(from).slice(0, 10) + 'T00:00:00Z') + int(0, Math.floor((to - from) / DAY)) * DAY; const d = new Date(day); return local(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), int(earliest, latest), pick([0, 5, 10, 20, 30, 40, 45, 50])); };
for (let i = 0; i < 128; i++) session(evening(local(2025, 1, 5), local(2026, 11, 15), 19, 21), 'Sana');
for (let i = 0; i < 108; i++) session(evening(local(2025, 1, 6), local(2026, 11, 15), 20, 22), 'Dele');
for (let i = 0; i < 92; i++) session(evening(local(2025, 3, 12), local(2026, 11, 15), 15, 18), 'Timi');
// Harbor Lights: both adults watched season 1; in season 2 Sana is through episode 5 and Dele through episode 3.
T('Harbor Lights').seasons[0].episodes.forEach((e, i) => { watch(local(2025, 5, 2 + i * 3, 20, 30), 'Sana', e.playable_id, e.runtime_seconds, {device: 'dev-livingroom-tv'}); watch(local(2025, 5, 3 + i * 3, 21, 10), 'Dele', e.playable_id, e.runtime_seconds, {device: 'dev-dele-laptop'}); });
[[2940, [10, 17, 20, 40], [10, 18, 21, 15]], [2760, [10, 24, 20, 35], [10, 25, 21, 15]], [3000, [10, 31, 20, 50], [11, 1, 21, 15]], [2880, [11, 7, 20, 45], null]].forEach(([runtime, sana, dele], i) => {
  watch(local(2026, ...sana), 'Sana', 'ep-harbor-s2e0' + (i + 1), runtime, {device: 'dev-livingroom-tv'});
  if (dele) watch(local(2026, ...dele), 'Dele', 'ep-harbor-s2e0' + (i + 1), runtime, {device: 'dev-dele-laptop'}); });
plan(at('2026-11-14T21:42:00-05:00'), () => event(at('2026-11-14T21:42:00-05:00'), 'playback.recorded', {profile_id: 'prof-sana', device_id: 'dev-livingroom-tv', playable_id: 'ep-harbor-s2e05', started_at: '2026-11-14T20:55:00-05:00', position_seconds: 2790, completed: true}));
// Auntie Bisi watches in short sittings: 31 viewings of 9 playables (three films, six episodes of The Night Bakers).
const bisi = [...['The Clockmender\'s Holiday', 'Moss, Stone, Lantern', 'Juniper Rules'].map(n => derive.playables(T(n))[0]), ...derive.playables(T('The Night Bakers')).slice(0, 6)];
[4, 4, 4, 3, 3, 3, 3, 3, 4].forEach((sittings, i) => { const first = local(2025, 6, 8, 14, 30) + i * 55 * DAY;
  for (let s = 0; s < sittings; s++) { const ms = first + s * (2 + i % 3) * DAY + s * 20 * MIN, share = (s + 1) / sittings;
    watch(ms, 'Auntie Bisi', bisi[i].playable_id, bisi[i].runtime_seconds, {partial: s === sittings - 1 && i !== 8 ? null : Math.round(bisi[i].runtime_seconds * Math.min(0.9, share * 0.85) / 60) * 60}); } });

// ---- watchlists (the account holder keeps them through the App): 8, 6, 4 and 4 entries ----
const LISTS = {Sana: ['Paper Kites', 'Tin Roof Sonata', 'The Quiet Semaphore', 'Wickerby Hall', 'The Last Bus to Ellery', 'Harbor Lights', 'A Map of Small Mercies', 'The Almanac Hour'],
  Dele: ['Harbor Lights', 'Copper Wire Lullaby', 'The Ferry Clerks', 'The Afterlight Shift', 'Small Hours Radio', 'Dandelion Courier'], Timi: ['Otter Club', 'Half Past the Moon', 'Marigold Station', 'Captain Pim and the Paper Sea'],
  'Auntie Bisi': ['The Night Bakers', 'The Almanac Hour', 'The Tallest Hat in Quillby', 'Moss, Stone, Lantern']};
Object.entries(LISTS).forEach(([who, names], w) => names.forEach((name, i) => { const ms = Math.max(local(2025, 6, 2, 12), at(T(name).available_from) + DAY) + (w * 9 + i * 37) * DAY % (300 * DAY) + (10 + i) * 61 * MIN;
  plan(ms, () => tool(ms, 'watchlist.add', {id: profileId(who), title_id: T(name).title_id})); }));
// One viewing hidden by the account holder, and one episode she saw elsewhere marked as watched by hand.
plan(local(2026, 2, 9, 8, 30), () => { const row = data.history.find(h => h.profile_id === 'prof-sana' && !h.hidden); tool(local(2026, 2, 9, 8, 30), 'history.hide', {id: 'prof-sana', history_id: row.history_id, hidden: true}); });
plan(local(2026, 11, 16, 8, 10), () => tool(local(2026, 11, 16, 8, 10), 'progress.set', {id: 'prof-sana', playable_id: derive.playables(T('The Almanac Hour'))[0].playable_id, patch: {completed: true}}));

// ---- run ----
while (queue.length) { queue.sort((a, b) => a.ms - b.ms || a.order - b.order); const next = queue.shift(); if (next.ms >= at(CLOCK)) throw Error('History reaches past the fixture clock: ' + iso(next.ms)); next.run(); }

// ---- history IDs replace the run counters, which start again from zero ----
data.history.forEach((h, i) => { rename[h.history_id] = 'hst-' + String(i + 1).padStart(4, '0'); });
data.notifications.forEach((n, i) => { rename[n.notification_id] = 'ntf-' + String(i + 1).padStart(3, '0'); });
let text = JSON.stringify(data);
for (const [from, to] of Object.entries(rename).sort((a, b) => b[0].length - a[0].length)) text = text.split('"' + from + '"').join('"' + to + '"');
data = JSON.parse(text);
data.counters = {profile: 0, history: 0, charge: 0, notification: 0};
plugin.validateSeed({app_id: APP, virtual_now: CLOCK, binding}, data);

const count = (rows, key) => rows.reduce((m, r) => (m[r[key]] = (m[r[key]] || 0) + 1, m), {});
const summary = {plans: data.plans.length, profiles: data.profiles.map(p => p.profile_id + ':' + p.kind + ':' + p.maturity_ceiling), titles: count(data.titles, 'kind'), episodes: data.titles.flatMap(t => derive.playables(t)).filter(p => p.season !== null).length,
  ratings: count(data.titles, 'maturity'), with_end_date: data.titles.filter(t => t.available_until !== null).length, history: count(data.history, 'profile_id'), progress: count(data.progress, 'profile_id'), watchlist: count(data.watchlist, 'profile_id'),
  devices: data.devices.length, charges: data.charges.length, notifications: count(data.notifications, 'kind'), activity: data.activity.length, account: data.account,
  first_record: data.activity[0].at, last_record: data.activity.at(-1).at};
const dataset = JSON.parse(fs.readFileSync(path.join(root, 'contribution/dataset.json'), 'utf8'));
dataset.expected_counts = {records: plugin.records(data).length, assets: 0};
const files = {'fixtures/minimal.json': JSON.stringify(data, null, 1) + '\n', 'contribution/dataset.json': JSON.stringify(dataset, null, 2) + '\n'};
let drift = false;
for (const [name, body] of Object.entries(files)) {
  const file = path.join(root, name);
  if (process.argv.includes('--check')) { if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== body) { drift = true; console.error('Generated file drift: ' + name); } }
  else fs.writeFileSync(file, body);
}
if (drift) process.exitCode = 1; else console.log(JSON.stringify(summary, null, 1));
