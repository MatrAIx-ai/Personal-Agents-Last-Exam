'use strict';
const {copy, ms, fold, log, FLOOR} = require('./util.cjs');
const d = require('./derive.cjs');
const c = require('./common.cjs');
const APP = c.APP;
// Every rejection is invalid_event and leaves state unchanged; Infra reads the message with env.event_status.
const reject = message => c.fail('invalid_event', message);

// A date as a service message would print it, in the local time the timestamp itself carries: "October 31, 2026 at 11:59 PM".
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const readable = iso => { const h = Number(iso.slice(11, 13)); return MONTHS[Number(iso.slice(5, 7)) - 1] + ' ' + Number(iso.slice(8, 10)) + ', ' + iso.slice(0, 4) + ' at ' + (h % 12 || 12) + ':' + iso.slice(14, 16) + (h < 12 ? ' AM' : ' PM'); };
function applyEvent(ctx, data, event) {
  const name = event.operation.slice(APP.length + 1), p = event.payload, now = ctx.virtual_now, a = data.account;
  const done = fields => c.record(ctx, data, 'event', name, {event_id: event.event_id, ...fields});
  const title = id => data.titles.find(t => t.title_id === id) || reject('Unknown title.');
  // Profiles that follow a title: it is on their watchlist or they have progress on it, and they may see it.
  const followers = (t, setting) => data.profiles.filter(x => x[setting] && d.canSee(x, t) &&
    (data.watchlist.some(w => w.profile_id === x.profile_id && w.title_id === t.title_id) || data.progress.some(r => r.profile_id === x.profile_id && r.title_id === t.title_id && (t.kind === 'series' || !r.completed && r.position_seconds > 0))));

  if (name === 'playback.recorded') {
    // A profile is named by ID, or by its unique name so that a task can address a profile the Agent creates during the run.
    if ((p.profile_id === undefined) === (p.profile_name === undefined)) reject('Give exactly one of profile_id and profile_name.');
    const who = p.profile_id !== undefined ? data.profiles.find(x => x.profile_id === p.profile_id) : data.profiles.find(x => fold(x.name) === fold(p.profile_name));
    if (!who) reject(p.profile_id !== undefined ? 'Unknown profile.' : 'No profile has that name.');
    const device = data.devices.find(x => x.device_id === p.device_id) || reject('Unknown device.');
    if (device.status !== 'signed_in') reject('The device is signed out.');
    const found = d.findPlayable(data, p.playable_id) || reject('Unknown playable.'), t = found.title, e = found.playable;
    if (d.account(data, now).inactive) reject('The account reads ' + d.account(data, now).status + '; nothing can be watched.');
    if (!d.canSee(who, t)) reject('The title is restricted for the profile.');
    if (!['available', 'leaving_soon'].includes(d.availability(t, p.started_at)) || !d.isReleased(e, p.started_at)) reject('The title or episode is not available at that time.');
    if (ms(p.started_at) > ms(now)) reject('A viewing cannot start after the event.');
    if (ms(p.started_at) < ms(FLOOR)) reject('A viewing cannot start before 2025-01-01.');
    if (p.position_seconds < 0 || p.position_seconds > e.runtime_seconds) reject('The position is beyond the runtime.');
    const watched = p.seconds_watched ?? Math.min(e.runtime_seconds, Math.max(0, Math.round((ms(now) - ms(p.started_at)) / 1000)));
    if (watched < 0 || watched > e.runtime_seconds) reject('seconds_watched is beyond the runtime.');
    const old = data.progress.find(r => r.profile_id === who.profile_id && r.playable_id === e.playable_id);
    const replaced = old ? {position_seconds: old.position_seconds, completed: old.completed, set_by: old.set_by, updated_at: old.updated_at} : null;
    const row = {profile_id: who.profile_id, playable_id: e.playable_id, title_id: t.title_id, position_seconds: p.position_seconds, completed: p.completed, set_by: 'playback', updated_at: now};
    if (old) Object.assign(old, row); else data.progress.push(row);
    const id = c.nextId(data, 'history');
    data.history.push({history_id: id, profile_id: who.profile_id, device_id: device.device_id, playable_id: e.playable_id, title_id: t.title_id, started_at: p.started_at, seconds_watched: watched, hidden: false, recorded_at: now});
    device.last_used_at = now;
    done({object_id: id, profile_id: who.profile_id, replaced});
  } else if (name === 'catalog.title_added') {
    const f = p.title, ids = c.allIds(data), playableIds = new Set(data.titles.flatMap(t => d.playables(t).map(x => x.playable_id)));
    const t = {title_id: f.title_id, kind: f.kind, name: f.name, maturity: f.maturity, genres: copy(f.genres), synopsis: f.synopsis ?? null, available_from: f.available_from, available_until: f.available_until ?? null,
      runtime_seconds: f.runtime_seconds ?? null, seasons: copy(f.seasons ?? [])};
    if (ids.has(t.title_id) || playableIds.has(t.title_id)) reject('Duplicate title ID.');
    if (t.kind === 'film' ? t.runtime_seconds === null || t.seasons.length > 0 : t.runtime_seconds !== null) reject('A film has a runtime and no seasons; a series has seasons and no runtime.');
    if (t.available_until !== null && ms(t.available_until) <= ms(t.available_from)) reject('The title ends before it starts.');
    const own = d.playables(t).map(x => x.playable_id);
    if (new Set(own).size !== own.length || own.some(id => playableIds.has(id) || t.kind === 'series' && ids.has(id))) reject('Duplicate playable ID.');
    data.titles.push(t); done({object_id: t.title_id});
  } else if (name === 'catalog.episode_released') {
    const t = title(p.title_id);
    if (t.kind !== 'series') reject('Only a series has episodes.');
    if (data.titles.some(x => d.playables(x).some(y => y.playable_id === p.episode.playable_id)) || c.allIds(data).has(p.episode.playable_id)) reject('Duplicate playable ID.');
    let season = t.seasons.find(s => s.number === p.season);
    if (!season) { season = {number: p.season, episodes: []}; t.seasons.push(season); t.seasons.sort((x, y) => x.number - y.number); }
    if (season.episodes.some(e => e.number === p.episode.number)) reject('That season already has an episode with that number.');
    season.episodes.push({...copy(p.episode), released_at: now}); season.episodes.sort((x, y) => x.number - y.number);
    for (const x of followers(t, 'notify_new_episodes'))
      c.notify(ctx, data, 'episode.released', 'New episode of ' + t.name + ': season ' + p.season + ', episode ' + p.episode.number + ', "' + p.episode.name + '".', {profile_id: x.profile_id, title_id: t.title_id, playable_id: p.episode.playable_id});
    done({object_id: p.episode.playable_id});
  } else if (name === 'catalog.leaving_set') {
    const t = title(p.title_id);
    if (ms(p.available_until) <= ms(now)) reject('The end date is not after the event.');
    if (ms(p.available_until) <= ms(t.available_from)) reject('The title ends before it starts.');
    const replaced = {available_until: t.available_until}; t.available_until = p.available_until;
    for (const x of followers(t, 'notify_leaving')) c.notify(ctx, data, 'title.leaving', t.name + ' leaves Lanternbox on ' + readable(p.available_until) + '.', {profile_id: x.profile_id, title_id: t.title_id});
    done({object_id: t.title_id, replaced});
  } else if (name === 'billing.charged') {
    if (ms(p.period_start) !== ms(a.paid_through)) reject('The charge period does not start at the account\'s paid_through (' + a.paid_through + ').');
    if (ms(p.period_end) <= ms(p.period_start)) reject('The charge period is empty.');
    const id = p.charge_id !== undefined ? (c.allIds(data).has(p.charge_id) ? reject('Duplicate charge ID.') : p.charge_id) : c.nextId(data, 'charge');
    const view = d.account(data, now), before = {plan_id: a.plan_id, paid_through: a.paid_through, pending: copy(a.pending)};
    // The charge is for the period that starts at paid_through, on the plan in effect then.
    const expected = view.next_charge ?? {plan_id: a.plan_id, amount_cents: d.plan(data, a.plan_id).price_cents};
    data.charges.push({charge_id: id, period_start: p.period_start, period_end: p.period_end, amount_cents: p.amount_cents, expected_amount_cents: expected.amount_cents, plan_id: expected.plan_id, result: p.result, reason: p.reason ?? null, at: now});
    if (p.result === 'paid') {
      // A pending downgrade that is due is stored with the charge; a pending cancellation is cleared; the account is paid up again.
      if (a.pending?.kind === 'downgrade' && ms(now) >= ms(a.pending.due_at)) {
        const from = a.plan_id; a.plan_id = a.pending.plan_id; a.pending = null;
        c.notify(ctx, data, 'plan.changed', 'Your plan changed from ' + d.plan(data, from).name + ' to ' + d.plan(data, a.plan_id).name + '.', {charge_id: id});
      } else if (a.pending?.kind === 'cancel') a.pending = null;
      a.paid_through = p.period_end;
    } else c.notify(ctx, data, 'payment.failed', 'A payment of $' + (p.amount_cents / 100).toFixed(2) + ' could not be taken' + (p.reason ? ' (' + p.reason + ')' : '') + '.', {charge_id: id});
    done({object_id: id, replaced: before});
  } else if (name === 'device.signed_in') {
    const x = data.devices.find(x => x.device_id === p.device_id);
    if (x) {
      if (x.name !== p.name || x.kind !== p.kind) reject('Duplicate device ID: another device already uses it.');
      const replaced = {status: x.status}; x.status = 'signed_in'; x.last_used_at = now; done({object_id: x.device_id, replaced});
    } else {
      if (c.allIds(data).has(p.device_id)) reject('Duplicate ID.');
      data.devices.push({device_id: p.device_id, name: p.name, kind: p.kind, status: 'signed_in', first_seen_at: now, last_used_at: now});
      c.notify(ctx, data, 'device.new', 'New sign-in from ' + p.name + '.', {device_id: p.device_id});
      done({object_id: p.device_id});
    }
  } else reject('Unsupported operation.');
  log(ctx, APP + '.event_prepared', {event_id: event.event_id});
  return data;
}
module.exports = {applyEvent};
