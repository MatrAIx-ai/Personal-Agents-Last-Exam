'use strict';
// Pure derivations. Handlers call these, and a grader may call them on a snapshot's data with the clock.
// Nothing here is stored: availability, account status, the plan in effect and next_up follow virtual time.
const {ms, shift} = require('./util.cjs');
const RATINGS = ['all', '7+', '13+', '16+', '18+'];
const LEAVING_DAYS = 14, GRACE_DAYS = 7, DAY_MS = 86400000;
const rank = rating => RATINGS.indexOf(rating);
// A profile sees a title only if the title's rating is at or below its ceiling.
const canSee = (profile, title) => rank(title.maturity) <= rank(profile.maturity_ceiling);

// upcoming before available_from; expired at or after available_until; leaving_soon within 14 days of it.
function availability(title, now) {
  const t = ms(now);
  if (t < ms(title.available_from)) return 'upcoming';
  if (title.available_until === null) return 'available';
  if (t >= ms(title.available_until)) return 'expired';
  return t >= ms(title.available_until) - LEAVING_DAYS * DAY_MS ? 'leaving_soon' : 'available';
}
// Every playable of a title in order: a film is its own playable (its ID is the title ID).
function playables(title) {
  if (title.kind === 'film') return [{playable_id: title.title_id, title_id: title.title_id, season: null, number: null, name: title.name, runtime_seconds: title.runtime_seconds, released_at: title.available_from}];
  return [...title.seasons].sort((a, b) => a.number - b.number).flatMap(s => [...s.episodes].sort((a, b) => a.number - b.number)
    .map(e => ({playable_id: e.playable_id, title_id: title.title_id, season: s.number, number: e.number, name: e.name, runtime_seconds: e.runtime_seconds, released_at: e.released_at})));
}
function findPlayable(data, playableId) {
  for (const title of data.titles) { const p = playables(title).find(p => p.playable_id === playableId); if (p) return {title, playable: p}; }
  return null;
}
const isReleased = (playable, now) => ms(playable.released_at) <= ms(now);
// The first released episode, in order, that the profile has not completed. Null for a film or when every released episode is completed.
function nextUp(data, title, profileId, now) {
  if (title.kind !== 'series') return null;
  const done = new Set(data.progress.filter(p => p.profile_id === profileId && p.title_id === title.title_id && p.completed).map(p => p.playable_id));
  const next = playables(title).find(p => isReleased(p, now) && !done.has(p.playable_id));
  return next ? {playable_id: next.playable_id, season: next.season, number: next.number, name: next.name} : null;
}
const plan = (data, id) => data.plans.find(p => p.plan_id === id);
// The account as it reads at `now`. Stored: plan_id, paid_through and at most one pending change with its due time.
//  - a pending downgrade takes effect by time at its due time (paid_through when it was asked for);
//  - a pending cancellation ends the account at paid_through;
//  - with no paid charge the account reads past_due from paid_through and suspended 7 days later.
function account(data, now) {
  const a = data.account, t = ms(now), pending = a.pending;
  const downgradeDue = pending?.kind === 'downgrade' && t >= ms(pending.due_at);
  const planId = downgradeDue ? pending.plan_id : a.plan_id;
  const paid = t < ms(a.paid_through);
  const status = paid ? 'active' : pending?.kind === 'cancel' ? 'cancelled' : t < ms(a.paid_through) + GRACE_DAYS * DAY_MS ? 'past_due' : 'suspended';
  // The profile limit is the pending downgrade's as soon as one exists, so a household cannot grow past the plan it is moving to.
  const limitPlan = pending?.kind === 'downgrade' ? pending.plan_id : planId;
  // The next charge is for the period that starts at paid_through, at the price of the plan in effect then.
  const nextPlan = pending?.kind === 'downgrade' ? pending.plan_id : a.plan_id;
  const next = pending?.kind === 'cancel' ? null : {period_start: a.paid_through, plan_id: nextPlan, amount_cents: plan(data, nextPlan).price_cents};
  return {status, plan_id: planId, profile_limit: plan(data, limitPlan).max_profiles, inactive: status === 'suspended' || status === 'cancelled',
    suspends_at: status === 'past_due' ? shift(a.paid_through, GRACE_DAYS) : null, next_charge: next};
}
module.exports = {RATINGS, LEAVING_DAYS, GRACE_DAYS, rank, canSee, availability, playables, findPlayable, isReleased, nextUp, plan, account};
