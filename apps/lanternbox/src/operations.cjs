'use strict';
const {fail, copy, ms, fold, log} = require('./util.cjs');
const d = require('./derive.cjs');
const c = require('./common.cjs');
const APP = c.APP;
const HINT = {profile: ' lanternbox.profiles.list returns valid profile IDs.', title: ' lanternbox.catalog.search returns valid title IDs.', playable: ' lanternbox.titles.get returns valid playable IDs.',
  device: ' lanternbox.devices.list returns valid device IDs.', history: ' lanternbox.history.list returns valid history row IDs.', plan: ' lanternbox.plans.list returns valid plan IDs.'};
const page = (rows, args, fallback) => rows.slice(args.offset || 0, (args.offset || 0) + (args.limit || fallback));
const SETTINGS = ['name', 'maturity_ceiling', 'autoplay', 'notify_new_episodes', 'notify_leaving'];

function scope(ctx, data) {
  const now = ctx.virtual_now, account = d.account(data, now);
  const profile = id => data.profiles.find(p => p.profile_id === id) || fail('not_found', 'No such profile.' + HINT.profile);
  const title = id => data.titles.find(t => t.title_id === id) || fail('not_found', 'No such title.' + HINT.title);
  const playable = id => d.findPlayable(data, id) || fail('not_found', 'No such playable.' + HINT.playable);
  const device = id => data.devices.find(x => x.device_id === id) || fail('not_found', 'No such device.' + HINT.device);
  // Suspended and cancelled accounts can still be read; they cannot be changed.
  const active = () => { if (account.inactive) fail('account_inactive', 'The account reads ' + account.status + ' at ' + now + '; it can be read but not changed.'); };
  const allowed = (p, t) => { if (!d.canSee(p, t)) fail('restricted', 'The title is rated ' + t.maturity + ', above this profile\'s ceiling of ' + p.maturity_ceiling + '.'); };
  const summary = t => { const all = d.playables(t);
    return {title_id: t.title_id, kind: t.kind, name: t.name, maturity: t.maturity, genres: copy(t.genres), availability: d.availability(t, now), available_from: t.available_from, available_until: t.available_until,
      runtime_seconds: t.runtime_seconds, season_count: t.seasons.length, episode_count: t.kind === 'series' ? all.length : 0}; };
  const progressOf = (profileId, playableId) => { const r = data.progress.find(r => r.profile_id === profileId && r.playable_id === playableId);
    return r ? {position_seconds: r.position_seconds, completed: r.completed, set_by: r.set_by, updated_at: r.updated_at} : null; };
  const where = playableId => { const {title: t, playable: p} = d.findPlayable(data, playableId);
    return {title: t, playable: p, fields: {title_id: t.title_id, title_name: t.name, playable_id: p.playable_id, playable_name: p.name, season: p.season, number: p.number}}; };
  const profileView = p => ({...copy(p), is_owner: p.profile_id === data.account.owner_profile_id});
  const counts = id => ({history_rows: data.history.filter(h => h.profile_id === id).length, progress_rows: data.progress.filter(r => r.profile_id === id).length, watchlist_entries: data.watchlist.filter(w => w.profile_id === id).length});
  return {now, account, profile, title, playable, device, active, allowed, summary, progressOf, where, profileView, counts};
}

function read(s, data, name, args) {
  const now = s.now;
  if (name === 'account.get') { const a = data.account, v = s.account, last = data.charges.at(-1) || null;
    return {account: {account_id: data.account_id, owner_profile_id: a.owner_profile_id, status: v.status, plan_id: v.plan_id, paid_through: a.paid_through, pending: copy(a.pending), profile_count: data.profiles.length,
      profile_limit: v.profile_limit, suspends_at: v.suspends_at, next_charge: v.next_charge, last_charge: copy(last)}, now}; }
  if (name === 'plans.list') { const current = d.plan(data, s.account.plan_id), a = data.account;
    return {plans: data.plans.map(p => { const move = p.plan_id === current.plan_id ? 'none' : p.price_cents > current.price_cents ? 'upgrade' : 'downgrade', blockers = [];
      if (s.account.inactive) blockers.push('account_inactive');
      if (a.pending?.kind === 'cancel') blockers.push('pending_cancellation');
      if (move === 'none' && a.pending?.kind !== 'downgrade') blockers.push('same_plan');
      if (move === 'downgrade' && data.profiles.length > p.max_profiles) blockers.push('too_many_profiles: ' + data.profiles.length + ' profiles, ' + p.max_profiles + ' allowed');
      return {...copy(p), current: move === 'none', move, can_move_now: blockers.length === 0, blockers, takes_effect: blockers.length ? null : move === 'downgrade' && ms(now) < ms(a.paid_through) ? a.paid_through : now}; })}; }
  if (name === 'billing.history') return {charges: page(data.charges, args, 50).map(copy), total: data.charges.length};
  if (name === 'profiles.list') return {profiles: data.profiles.map(s.profileView)};
  if (name === 'profiles.get') { const p = s.profile(args.id); return {profile: s.profileView(p), counts: s.counts(p.profile_id)}; }
  if (name === 'catalog.search') {
    const viewer = args.id ? s.profile(args.id) : null, q = fold(args.query || '');
    const rows = data.titles.filter(t => (!viewer || d.canSee(viewer, t)) && (!args.kind || t.kind === args.kind) && (!args.genre || t.genres.map(fold).includes(fold(args.genre))) && (!args.maturity || t.maturity === args.maturity) &&
      (!args.availability || d.availability(t, now) === args.availability) && (!q || [t.name, t.synopsis || '', ...t.genres].some(v => fold(v).includes(q)))).sort((a, b) => a.name.localeCompare(b.name) || a.title_id.localeCompare(b.title_id));
    return {titles: page(rows, args, 25).map(s.summary), total: rows.length};
  }
  if (name === 'titles.get') {
    const t = s.title(args.title_id), viewer = args.id ? s.profile(args.id) : null;
    if (viewer) s.allowed(viewer, t);
    const seasons = [...t.seasons].sort((a, b) => a.number - b.number).map(season => ({number: season.number, episodes: [...season.episodes].sort((a, b) => a.number - b.number).map(e =>
      ({...copy(e), released: ms(e.released_at) <= ms(now), progress: viewer ? s.progressOf(viewer.profile_id, e.playable_id) : null}))}));
    return {title: {...s.summary(t), synopsis: t.synopsis, seasons, viewed_as: viewer ? viewer.profile_id : null, progress: viewer && t.kind === 'film' ? s.progressOf(viewer.profile_id, t.title_id) : null,
      next_up: viewer ? d.nextUp(data, t, viewer.profile_id, now) : null}};
  }
  // Rows for titles above the profile's ceiling are left out, never deleted: they return when the ceiling is raised.
  const visible = (p, titleId) => d.canSee(p, data.titles.find(t => t.title_id === titleId));
  if (name === 'progress.list') { const p = s.profile(args.id);
    const rows = data.progress.filter(r => r.profile_id === p.profile_id && visible(p, r.title_id) && (!args.state || (args.state === 'completed' ? r.completed : !r.completed && r.position_seconds > 0)))
      .sort((a, b) => ms(b.updated_at) - ms(a.updated_at) || a.playable_id.localeCompare(b.playable_id));
    return {progress: page(rows, args, 50).map(r => { const w = s.where(r.playable_id); return {profile_id: r.profile_id, ...w.fields, runtime_seconds: w.playable.runtime_seconds, position_seconds: r.position_seconds, completed: r.completed, set_by: r.set_by, updated_at: r.updated_at}; }), total: rows.length}; }
  if (name === 'history.list') { const p = s.profile(args.id);
    if (args.from && args.to && ms(args.to) < ms(args.from)) fail('invalid_window', 'The window ends before it starts.');
    const names = new Map(data.devices.map(x => [x.device_id, x.name]));
    const rows = data.history.filter(h => h.profile_id === p.profile_id && visible(p, h.title_id) && (args.include_hidden || !h.hidden) && (!args.from || ms(h.started_at) >= ms(args.from)) && (!args.to || ms(h.started_at) <= ms(args.to)))
      .sort((a, b) => ms(b.started_at) - ms(a.started_at) || a.history_id.localeCompare(b.history_id));
    return {history: page(rows, args, 50).map(h => ({history_id: h.history_id, profile_id: h.profile_id, device_id: h.device_id, device_name: names.get(h.device_id), ...s.where(h.playable_id).fields, started_at: h.started_at,
      seconds_watched: h.seconds_watched, hidden: h.hidden, recorded_at: h.recorded_at})), total: rows.length}; }
  if (name === 'watchlist.list') { const p = s.profile(args.id);
    return {watchlist: data.watchlist.filter(w => w.profile_id === p.profile_id && visible(p, w.title_id)).sort((a, b) => ms(a.added_at) - ms(b.added_at) || a.title_id.localeCompare(b.title_id))
      .map(w => ({...copy(w), title: s.summary(data.titles.find(t => t.title_id === w.title_id))}))}; }
  if (name === 'devices.list') return {devices: data.devices.map(copy)};
  if (name === 'notifications.list') { const rows = data.notifications.filter(n => !args.since || ms(n.at) >= ms(args.since)); return {notifications: page(rows, args, 50).map(copy), total: rows.length}; }
  return null;
}

function write(ctx, s, data, name, args) {
  const now = s.now, a = data.account, done = (action, fields) => c.record(ctx, data, 'agent', action, {request_id: args.request_id, ...fields});
  const ceiling = (kind, level) => { if (kind === 'kids' && d.rank(level) > d.rank('7+')) fail('invalid_ceiling', 'A kids profile cannot have a ceiling above 7+.'); };
  const nameFree = (value, exceptId = null) => { if (data.profiles.some(p => p.profile_id !== exceptId && fold(p.name) === fold(value))) fail('name_taken', 'Another profile already has that name.'); };
  // A pending downgrade whose due time has passed is already in effect: store it before changing the plan again.
  const settle = () => { if (a.pending?.kind === 'downgrade' && ms(now) >= ms(a.pending.due_at)) { a.plan_id = a.pending.plan_id; a.pending = null; } };
  switch (name) {
    case 'watchlist.add': {
      s.active(); const p = s.profile(args.id), t = s.title(args.title_id); s.allowed(p, t);
      if (d.availability(t, now) === 'expired') fail('unavailable', 'The title left the catalog on ' + t.available_until + '.');
      if (data.watchlist.some(w => w.profile_id === p.profile_id && w.title_id === t.title_id)) fail('already_listed', 'The title is already on this profile\'s watchlist.');
      data.watchlist.push({profile_id: p.profile_id, title_id: t.title_id, added_at: now});
      done(name, {object_id: t.title_id, profile_id: p.profile_id}); return {id: p.profile_id, title_id: t.title_id};
    }
    case 'watchlist.remove': {
      s.active(); const p = s.profile(args.id), t = s.title(args.title_id);
      const index = data.watchlist.findIndex(w => w.profile_id === p.profile_id && w.title_id === t.title_id);
      if (index < 0) fail('not_listed', 'The title is not on this profile\'s watchlist.');
      const [gone] = data.watchlist.splice(index, 1);
      done(name, {object_id: t.title_id, profile_id: p.profile_id, replaced: {added_at: gone.added_at}}); return {id: p.profile_id, title_id: t.title_id};
    }
    case 'progress.set': {
      s.active(); const p = s.profile(args.id), {title: t, playable: e} = s.playable(args.playable_id), patch = args.patch; s.allowed(p, t);
      if (!Object.keys(patch).length) fail('invalid_arguments', 'The patch must contain position_seconds or completed.');
      const state = d.availability(t, now);
      if (state === 'expired' || state === 'upcoming') fail('unavailable', 'The title reads ' + state + ' at ' + now + '.');
      if (!d.isReleased(e, now)) fail('unavailable', 'The episode is released on ' + e.released_at + '; now is ' + now + '.');
      const completed = patch.completed ?? false, position = patch.position_seconds ?? (completed ? e.runtime_seconds : 0);
      if (!Number.isInteger(position) || position < 0 || position > e.runtime_seconds) fail('invalid_position', 'A position is from 0 to the runtime of ' + e.runtime_seconds + ' seconds.');
      const old = data.progress.find(r => r.profile_id === p.profile_id && r.playable_id === e.playable_id);
      const replaced = old ? {position_seconds: old.position_seconds, completed: old.completed, set_by: old.set_by, updated_at: old.updated_at} : {position_seconds: null, completed: null, set_by: null, updated_at: null};
      const row = {profile_id: p.profile_id, playable_id: e.playable_id, title_id: t.title_id, position_seconds: position, completed, set_by: 'agent', updated_at: now};
      if (old) Object.assign(old, row); else data.progress.push(row);
      // No history row: what was marked stays apart from what was watched.
      done(name, {object_id: e.playable_id, profile_id: p.profile_id, replaced}); return {id: p.profile_id, playable_id: e.playable_id, position_seconds: position, completed};
    }
    case 'history.hide': {
      s.active(); const p = s.profile(args.id), h = data.history.find(h => h.history_id === args.history_id && h.profile_id === p.profile_id);
      if (!h) fail('not_found', 'No such history row on this profile.' + HINT.history);
      const replaced = {hidden: h.hidden}; h.hidden = args.hidden;
      done(name, {object_id: h.history_id, profile_id: p.profile_id, replaced}); return {id: p.profile_id, history_id: h.history_id, hidden: h.hidden};
    }
    case 'profiles.create': {
      s.active(); const f = args.profile, level = f.maturity_ceiling ?? (f.kind === 'kids' ? '7+' : '18+');
      if (data.profiles.length >= s.account.profile_limit) fail('limit_reached', 'The plan allows ' + s.account.profile_limit + ' profiles' + (a.pending?.kind === 'downgrade' ? ' (the pending downgrade\'s limit)' : '') + '.');
      ceiling(f.kind, level); nameFree(f.name);
      const p = {profile_id: c.nextId(data, 'profile'), name: f.name.trim(), maturity_ceiling: level, autoplay: f.autoplay ?? true, notify_new_episodes: f.notify_new_episodes ?? true, notify_leaving: f.notify_leaving ?? true,
        kind: f.kind, person_id: f.person_id ?? null, created_at: now};
      if (p.person_id !== null && (!ctx.binding.people.some(x => x.person_id === p.person_id) || data.profiles.some(x => x.person_id === p.person_id))) fail('invalid_arguments', 'person_id must be a person in the run binding who has no profile yet.');
      data.profiles.push(p); done(name, {object_id: p.profile_id, profile_id: p.profile_id}); return {id: p.profile_id};
    }
    case 'profiles.update': {
      s.active(); const p = s.profile(args.id), patch = args.patch;
      if (!Object.keys(patch).length) fail('invalid_arguments', 'The patch must contain a field.');
      if ('maturity_ceiling' in patch) ceiling(p.kind, patch.maturity_ceiling);
      if ('name' in patch) nameFree(patch.name, p.profile_id);
      const replaced = Object.fromEntries(Object.keys(patch).map(k => [k, p[k]]));
      for (const k of SETTINGS) if (k in patch) p[k] = k === 'name' ? patch[k].trim() : patch[k];
      done(name, {object_id: p.profile_id, profile_id: p.profile_id, replaced}); return {id: p.profile_id};
    }
    case 'profiles.delete': {
      s.active(); const p = s.profile(args.id);
      if (p.profile_id === a.owner_profile_id) fail('owner_profile', 'The owner profile cannot be deleted.');
      const removed = s.counts(p.profile_id);
      data.history = data.history.filter(h => h.profile_id !== p.profile_id); data.progress = data.progress.filter(r => r.profile_id !== p.profile_id);
      data.watchlist = data.watchlist.filter(w => w.profile_id !== p.profile_id); data.profiles = data.profiles.filter(x => x.profile_id !== p.profile_id);
      // The same counts go to the result and to the activity row, so a grader can check what was deleted.
      done(name, {object_id: p.profile_id, profile_id: p.profile_id, replaced: {name: p.name, kind: p.kind, maturity_ceiling: p.maturity_ceiling, person_id: p.person_id}, removed}); return {id: p.profile_id, removed};
    }
    case 'devices.sign_out': {
      s.active(); const x = s.device(args.id);
      if (x.status !== 'signed_in') fail('invalid_state', 'The device is already signed out.');
      x.status = 'signed_out'; done(name, {object_id: x.device_id}); return {id: x.device_id};
    }
    case 'plan.change': {
      const target = d.plan(data, args.id) || fail('not_found', 'No such plan.' + HINT.plan);
      s.active();
      if (a.pending?.kind === 'cancel') fail('invalid_state', 'A cancellation is pending; undo it with lanternbox.plan.resume before changing the plan.');
      settle();
      const current = d.plan(data, a.plan_id), before = {plan_id: a.plan_id, pending: copy(a.pending)};
      let effect, at = now;
      if (target.plan_id === current.plan_id) {
        if (!a.pending) fail('same_plan', 'The account is already on ' + current.plan_id + '.');
        a.pending = null; effect = 'pending_cleared';
      } else if (target.price_cents > current.price_cents) { a.plan_id = target.plan_id; a.pending = null; effect = 'upgraded'; }
      else {
        if (data.profiles.length > target.max_profiles) fail('too_many_profiles', 'The account has ' + data.profiles.length + ' profiles and ' + target.plan_id + ' allows ' + target.max_profiles + '.');
        // The downgrade takes effect by time at paid_through (at once when that has already passed).
        a.pending = {kind: 'downgrade', plan_id: target.plan_id, due_at: a.paid_through, requested_at: now}; effect = 'downgrade_pending'; at = ms(now) < ms(a.paid_through) ? a.paid_through : now;
      }
      done(name, {object_id: target.plan_id, replaced: before}); return {id: target.plan_id, effect, effective_at: at};
    }
    case 'plan.cancel': {
      if (s.account.status === 'cancelled') fail('invalid_state', 'The account has already ended.');
      if (a.pending?.kind === 'cancel') fail('invalid_state', 'A cancellation is already pending.');
      settle();
      const before = {plan_id: a.plan_id, pending: copy(a.pending)};
      // One change can be pending: the cancellation replaces a pending downgrade.
      a.pending = {kind: 'cancel', plan_id: null, due_at: a.paid_through, requested_at: now};
      done(name, {object_id: data.account_id, replaced: before}); return {id: data.account_id, ends_at: ms(now) < ms(a.paid_through) ? a.paid_through : now};
    }
    case 'plan.resume': {
      if (s.account.status === 'cancelled') fail('invalid_state', 'The account has already ended; it cannot be resumed.');
      settle();
      if (!a.pending) fail('no_pending_change', 'There is no pending downgrade or cancellation to undo.');
      const before = {plan_id: a.plan_id, pending: copy(a.pending)}, cleared = a.pending.kind;
      a.pending = null; done(name, {object_id: data.account_id, replaced: before}); return {id: data.account_id, cleared};
    }
    default: fail('unknown_tool', 'Unknown business operation.');
  }
}

function handleTool(ctx, data, fullName, args) {
  const name = fullName.slice(APP.length + 1), s = scope(ctx, data);
  const result = read(s, data, name, args);
  if (result) return {data, result};
  const out = write(ctx, s, data, name, args);
  log(ctx, APP + '.' + name, {object_id: out.id});
  return {data, result: out};
}
module.exports = {handleTool};
