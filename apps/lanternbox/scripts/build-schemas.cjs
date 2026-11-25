#!/usr/bin/env node
'use strict';
// Generates tools.json, schemas/seed.schema.json and schemas/events.schema.json from one description,
// so the three files cannot drift apart. Run with --check to compare without writing.
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const APP = 'lanternbox';

const ID = {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
const TS = {type: 'string', format: 'date-time'};
const BOOL = {type: 'boolean'};
const INT = {type: 'integer'};
const nul = s => ({anyOf: [s, {type: 'null'}]});
const text = (max, min = 1) => ({type: 'string', minLength: min, maxLength: max});
const obj = (properties, required = Object.keys(properties)) => ({type: 'object', properties, required, additionalProperties: false});
const arr = (items, maxItems = 1000, extra = {}) => ({type: 'array', items, maxItems, ...extra});
const count = {type: 'integer', minimum: 0};
const cents = {type: 'integer', minimum: 0, maximum: 1000000};
const RATING = {enum: ['all', '7+', '13+', '16+', '18+']};
const KIND = {enum: ['adult', 'kids']};
const DEVICE_KIND = {enum: ['tv', 'phone', 'tablet', 'computer', 'console', 'other']};
const AVAILABILITY = {enum: ['upcoming', 'available', 'leaving_soon', 'expired']};
const NOTIFICATION_KINDS = ['episode.released', 'title.leaving', 'payment.failed', 'plan.changed', 'device.new'];
const runtime = {type: 'integer', minimum: 60, maximum: 86400};

// ---- stored records (seed and state) ----
const plan = obj({plan_id: ID, name: text(40), price_cents: cents, max_profiles: {type: 'integer', minimum: 1, maximum: 10}, quality: text(40)});
const settings = {name: text(40), maturity_ceiling: RATING, autoplay: BOOL, notify_new_episodes: BOOL, notify_leaving: BOOL};
const profile = obj({profile_id: ID, ...settings, kind: KIND, person_id: nul(ID), created_at: TS});
const episode = obj({playable_id: ID, number: {type: 'integer', minimum: 1}, name: text(120), runtime_seconds: runtime, released_at: TS});
const season = obj({number: {type: 'integer', minimum: 1}, episodes: arr(episode, 60)});
const titleBase = {title_id: ID, kind: {enum: ['film', 'series']}, name: text(120), maturity: RATING, genres: arr(text(30), 6, {uniqueItems: true}), synopsis: nul(text(400)), available_from: TS, available_until: nul(TS), runtime_seconds: nul(runtime)};
const title = obj({...titleBase, seasons: arr(season, 20)});
const progress = obj({profile_id: ID, playable_id: ID, title_id: ID, position_seconds: count, completed: BOOL, set_by: {enum: ['playback', 'agent']}, updated_at: TS});
const history = obj({history_id: ID, profile_id: ID, device_id: ID, playable_id: ID, title_id: ID, started_at: TS, seconds_watched: count, hidden: BOOL, recorded_at: TS});
const watch = obj({profile_id: ID, title_id: ID, added_at: TS});
const device = obj({device_id: ID, name: text(60), kind: DEVICE_KIND, status: {enum: ['signed_in', 'signed_out']}, first_seen_at: TS, last_used_at: TS});
const charge = obj({charge_id: ID, period_start: TS, period_end: TS, amount_cents: cents, expected_amount_cents: nul(cents), plan_id: ID, result: {enum: ['paid', 'failed']}, reason: nul(text(60)), at: TS});
const notification = obj({notification_id: ID, kind: {enum: NOTIFICATION_KINDS}, at: TS, profile_id: nul(ID), title_id: nul(ID), playable_id: nul(ID), device_id: nul(ID), charge_id: nul(ID), text: text(300)});
const activity = obj({seq: {type: 'integer', minimum: 1}, at: TS, actor: {enum: ['agent', 'event']}, action: text(80), object_id: nul(ID), profile_id: nul(ID), request_id: nul(text(100)), event_id: nul(ID),
  replaced: nul({type: 'object'}), removed: nul({type: 'object'})});
const pending = obj({kind: {enum: ['downgrade', 'cancel']}, plan_id: nul(ID), due_at: TS, requested_at: TS});
const seed = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:pale:lanternbox:seed:1',
  ...obj({
    account_id: ID,
    account: obj({owner_profile_id: ID, plan_id: ID, paid_through: TS, pending: nul(pending)}),
    plans: arr(plan, 10), profiles: arr(profile, 10), titles: arr(title, 500), progress: arr(progress, 20000), history: arr(history, 20000), watchlist: arr(watch, 5000),
    devices: arr(device, 50), charges: arr(charge, 500), notifications: arr(notification, 5000), activity: arr(activity, 40000),
    counters: obj({profile: count, history: count, charge: count, notification: count})
  })
};

// ---- events ----
const profileRef = {profile_id: ID, profile_name: text(40)};
const eventPayloads = {
  'playback.recorded': obj({...profileRef, device_id: ID, playable_id: ID, started_at: TS, position_seconds: INT, completed: BOOL, seconds_watched: INT}, ['device_id', 'playable_id', 'started_at', 'position_seconds', 'completed']),
  'catalog.title_added': obj({title: obj({...titleBase, seasons: arr(season, 20)}, ['title_id', 'kind', 'name', 'maturity', 'genres', 'available_from'])}),
  'catalog.episode_released': obj({title_id: ID, season: {type: 'integer', minimum: 1}, episode: obj({playable_id: ID, number: {type: 'integer', minimum: 1}, name: text(120), runtime_seconds: runtime})}),
  'catalog.leaving_set': obj({title_id: ID, available_until: TS}),
  'billing.charged': obj({charge_id: ID, period_start: TS, period_end: TS, amount_cents: cents, result: {enum: ['paid', 'failed']}, reason: text(60)}, ['period_start', 'period_end', 'amount_cents', 'result']),
  'device.signed_in': obj({device_id: ID, name: text(60), kind: DEVICE_KIND})
};
const events = {oneOf: Object.entries(eventPayloads).map(([name, payload]) => obj({event_id: ID, at: TS, operation: {const: APP + '.' + name}, payload}))};

// ---- tool results ----
const progressView = obj({position_seconds: count, completed: BOOL, set_by: {enum: ['playback', 'agent']}, updated_at: TS});
const summary = {title_id: ID, kind: {enum: ['film', 'series']}, name: text(120), maturity: RATING, genres: arr(text(30), 6), availability: AVAILABILITY, available_from: TS, available_until: nul(TS),
  runtime_seconds: nul(runtime), season_count: count, episode_count: count};
const titleSummary = obj(summary);
const episodeView = obj({playable_id: ID, number: INT, name: text(120), runtime_seconds: runtime, released_at: TS, released: BOOL, progress: nul(progressView)});
const nextUp = obj({playable_id: ID, season: INT, number: INT, name: text(120)});
const titleFull = obj({...summary, synopsis: nul(text(400)), seasons: arr(obj({number: INT, episodes: arr(episodeView, 60)}), 20), viewed_as: nul(ID), progress: nul(progressView), next_up: nul(nextUp)});
const profileView = obj({profile_id: ID, ...settings, kind: KIND, person_id: nul(ID), created_at: TS, is_owner: BOOL});
const removed = obj({history_rows: count, progress_rows: count, watchlist_entries: count});
const where = {title_id: ID, title_name: text(120), playable_id: ID, playable_name: text(120), season: nul(INT), number: nul(INT)};
const progressRow = obj({profile_id: ID, ...where, runtime_seconds: runtime, position_seconds: count, completed: BOOL, set_by: {enum: ['playback', 'agent']}, updated_at: TS});
const historyRow = obj({history_id: ID, profile_id: ID, device_id: ID, device_name: text(60), ...where, started_at: TS, seconds_watched: count, hidden: BOOL, recorded_at: TS});
const pendingView = nul(obj({kind: {enum: ['downgrade', 'cancel']}, plan_id: nul(ID), due_at: TS, requested_at: TS}));
const accountView = obj({account_id: ID, owner_profile_id: ID, status: {enum: ['active', 'past_due', 'suspended', 'cancelled']}, plan_id: ID, paid_through: TS, pending: pendingView, profile_count: count, profile_limit: count,
  suspends_at: nul(TS), next_charge: nul(obj({period_start: TS, plan_id: ID, amount_cents: cents})), last_charge: nul(charge)});
const planView = obj({plan_id: ID, name: text(40), price_cents: cents, max_profiles: INT, quality: text(40), current: BOOL, move: {enum: ['none', 'upgrade', 'downgrade']}, can_move_now: BOOL, blockers: arr(text(60), 5), takes_effect: nul(TS)});

const VERSION = obj({epoch: {type: 'integer', minimum: 1}, revision: {type: 'integer', minimum: 0}});
const REQUEST = {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
const page = {limit: {type: 'integer', minimum: 1, maximum: 200}, offset: count};
const read = (name, description, input, required, output) => ({name: APP + '.' + name, description, read_only: true, scope: APP + '.' + name, resource_target: 'current account',
  inputSchema: obj(input, required), outputSchema: obj({status: {const: 'ok'}, app_id: {const: APP}, version: VERSION, ...output})});
const write = (name, description, input, required, output = {}) => ({name: APP + '.' + name, description, read_only: false, scope: APP + '.' + name, resource_target: 'current account',
  inputSchema: obj({...input, expected_version: VERSION, request_id: REQUEST}, [...required, 'expected_version', 'request_id']),
  outputSchema: obj({status: {const: 'committed'}, app_id: {const: APP}, version: VERSION, id: ID, ...output})});
const PROFILE = ' id is the profile; profile IDs come from lanternbox.profiles.list.';
const tools = [
  read('account.get', 'Read the account: status (active, past_due, suspended or cancelled), the plan in effect now, paid_through, any pending downgrade or cancellation, the profile count and limit, the next charge, and the current environment time (now). Reads and writes never move the clock; only the environment does.',
    {}, [], {account: accountView, now: TS}),
  read('plans.list', 'List the three plans and, for each, whether the account could move to it now and what blocks it (same_plan, too_many_profiles, account_inactive, pending_cancellation).', {}, [], {plans: arr(planView, 10)}),
  read('billing.history', 'List charges, oldest first, each with its period, amount, the amount expected for the plan in effect, and result.', {...page}, [], {charges: arr(charge, 200), total: count}),
  read('profiles.list', 'List the household\'s profiles with kind, maturity ceiling and settings. Profile IDs come from here.', {}, [], {profiles: arr(profileView, 10)}),
  read('profiles.get', 'Read one profile and the counts of history rows, progress rows and watchlist entries that deleting it would remove.' + PROFILE, {id: ID}, ['id'], {profile: profileView, counts: removed}),
  read('catalog.search', 'Search titles by text, kind, genre, maturity and availability (upcoming, available, leaving_soon, expired). With id (a profile) the result leaves out every title above that profile\'s ceiling. Title IDs come from here.',
    {query: text(200, 0), kind: {enum: ['film', 'series']}, genre: text(30), maturity: RATING, availability: AVAILABILITY, id: ID, ...page}, [], {titles: arr(titleSummary, 200), total: count}),
  read('titles.get', 'Read one title with its seasons and episodes. With id (a profile) each playable carries that profile\'s progress and a series carries next_up, the first released episode the profile has not completed; a title above the profile\'s ceiling returns restricted. Playable IDs come from here; a film\'s playable ID is its title ID.',
    {title_id: ID, id: ID}, ['title_id'], {title: titleFull}),
  read('progress.list', 'List one profile\'s progress rows, optionally only in_progress or completed. Titles above the profile\'s ceiling are left out.' + PROFILE, {id: ID, state: {enum: ['in_progress', 'completed']}, ...page}, ['id'], {progress: arr(progressRow, 200), total: count}),
  read('history.list', 'List one profile\'s viewing history, newest first. Hidden rows appear only with include_hidden. History is written only by recorded playback, never by progress.set. History row IDs come from here.' + PROFILE,
    {id: ID, include_hidden: BOOL, from: TS, to: TS, ...page}, ['id'], {history: arr(historyRow, 200), total: count}),
  read('watchlist.list', 'List one profile\'s watchlist with each title\'s current availability.' + PROFILE, {id: ID}, ['id'], {watchlist: arr(obj({profile_id: ID, title_id: ID, added_at: TS, title: titleSummary}), 500)}),
  read('devices.list', 'List the account\'s devices with sign-in status and last use. Device IDs come from here.', {}, [], {devices: arr(device, 50)}),
  read('notifications.list', 'List in-App notifications about what other people or the service did, oldest first. Nothing is sent outside the App.', {since: TS, ...page}, [], {notifications: arr(notification, 200), total: count}),

  write('watchlist.add', 'Add a title to one profile\'s watchlist. A title above the profile\'s ceiling returns restricted and one that has left the catalog returns unavailable; a title that is not out yet can be listed.' + PROFILE, {id: ID, title_id: ID}, ['id', 'title_id'], {title_id: ID}),
  write('watchlist.remove', 'Remove a title from one profile\'s watchlist.' + PROFILE, {id: ID, title_id: ID}, ['id', 'title_id'], {title_id: ID}),
  write('progress.set', 'Set one profile\'s progress on one playable: a position in seconds, completed, or back to the start (position 0). The row is marked set_by agent and no history row is written, so what was watched stays apart from what was marked.' + PROFILE,
    {id: ID, playable_id: ID, patch: obj({position_seconds: INT, completed: BOOL}, [])}, ['id', 'playable_id', 'patch'], {playable_id: ID, position_seconds: count, completed: BOOL}),
  write('history.hide', 'Hide or unhide one history row of a profile (hidden true or false). Progress is not affected.' + PROFILE, {id: ID, history_id: ID, hidden: BOOL}, ['id', 'history_id', 'hidden'], {history_id: ID, hidden: BOOL}),
  write('profiles.create', 'Create a profile. A kids profile cannot have a ceiling above 7+. Fails with limit_reached at the plan\'s profile limit (a pending downgrade\'s limit counts). Returns the new profile ID.',
    {profile: obj({...settings, kind: KIND, person_id: nul(ID)}, ['name', 'kind'])}, ['profile']),
  write('profiles.update', 'Change a profile\'s name, ceiling or settings. Lowering a ceiling deletes nothing: titles above it become invisible to the profile and return when it is raised.' + PROFILE, {id: ID, patch: obj(settings, [])}, ['id', 'patch']),
  write('profiles.delete', 'Delete a profile with its progress, history and watchlist. It cannot be undone; the result says how many rows were removed. The owner profile cannot be deleted. Read lanternbox.profiles.get first for the counts.' + PROFILE,
    {id: ID}, ['id'], {removed}),
  write('devices.sign_out', 'Sign a device out. id is the device; device IDs come from lanternbox.devices.list.', {id: ID}, ['id']),
  write('plan.change', 'Move the account to another plan. id is the plan; plan IDs come from lanternbox.plans.list. An upgrade applies at once. A downgrade is stored as pending and takes effect by time at paid_through; it is refused while the account has more profiles than the cheaper plan allows. Only one change can be pending: a second downgrade replaces the first, choosing the current plan clears it, and while a cancellation is pending the call returns invalid_state until lanternbox.plan.resume undoes it.',
    {id: ID}, ['id'], {effect: {enum: ['upgraded', 'downgrade_pending', 'pending_cleared']}, effective_at: TS}),
  write('plan.cancel', 'Cancel the subscription. The account stays active until paid_through and then reads cancelled. A pending downgrade is replaced by the cancellation.', {}, [], {ends_at: TS}),
  write('plan.resume', 'Undo a pending downgrade or cancellation while it is still pending.', {}, [], {cleared: {enum: ['downgrade', 'cancel']}})
];

const files = {'tools.json': tools, 'schemas/seed.schema.json': seed, 'schemas/events.schema.json': events};
let drift = false;
for (const [name, value] of Object.entries(files)) {
  const file = path.join(root, name), expected = JSON.stringify(value, null, 2) + '\n';
  if (process.argv.includes('--check')) { if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== expected) { drift = true; console.error('Generated file drift: ' + name); } }
  else fs.writeFileSync(file, expected);
}
if (drift) process.exitCode = 1; else console.log(tools.length + ' tools, seed and event schemas ' + (process.argv.includes('--check') ? 'match.' : 'written.'));
