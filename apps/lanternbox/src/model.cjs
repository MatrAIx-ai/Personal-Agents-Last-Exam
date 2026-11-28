'use strict';
const {fail, ms, fold, FLOOR, OFFSET} = require('./util.cjs');
const d = require('./derive.cjs');
const bad = message => fail('invalid_seed', message);

function validateSeed(ctx, data) {
  const bound = ctx.binding.accounts.filter(a => a.app_id === ctx.app_id && a.account_id === data.account_id);
  if (bound.length !== 1) bad('The seed account_id must be the lanternbox account declared in the run binding.');
  const now = ms(ctx.virtual_now), floor = ms(FLOOR);
  // Catalog dates may lie anywhere; records of what the household did must fall between 2025-01-01 and the current time.
  const offset = (value, label) => { if (value !== null && !OFFSET.test(value)) bad(label + ' needs a UTC offset.'); };
  const past = (value, label) => { offset(value, label); if (ms(value) < floor) bad(label + ' is before 2025-01-01.'); if (ms(value) > now) bad(label + ' is after the current time.'); };
  const unique = (ids, label) => { if (new Set(ids).size !== ids.length) bad('Duplicate ' + label + ' ID.'); };
  unique(data.plans.map(p => p.plan_id), 'plan');
  const plans = new Set(data.plans.map(p => p.plan_id));
  const a = data.account;
  if (!plans.has(a.plan_id)) bad('The account names an unknown plan.');
  offset(a.paid_through, 'paid_through');
  if (a.pending) {
    past(a.pending.requested_at, 'Pending change request time'); offset(a.pending.due_at, 'Pending change due time');
    if (a.pending.kind === 'downgrade' ? !plans.has(a.pending.plan_id) || d.plan(data, a.pending.plan_id).price_cents >= d.plan(data, a.plan_id).price_cents : a.pending.plan_id !== null) bad('The pending change does not fit the plans.');
  }
  unique(data.profiles.map(p => p.profile_id), 'profile');
  const profiles = new Map(data.profiles.map(p => [p.profile_id, p])), names = new Set();
  const owner = profiles.get(a.owner_profile_id);
  if (!owner) bad('The owner profile does not exist.');
  // The Agent acts as the account holder: the owner profile belongs to the account owner in the binding.
  if (owner.person_id !== null && owner.person_id !== bound[0].owner_person_id) bad('The owner profile carries a person_id other than the account owner\'s.');
  const limit = d.plan(data, a.pending?.kind === 'downgrade' ? a.pending.plan_id : a.plan_id).max_profiles;
  if (data.profiles.length > limit) bad('More profiles than the plan allows.');
  const people = data.profiles.map(p => p.person_id).filter(Boolean);
  if (new Set(people).size !== people.length) bad('Two profiles share a person_id.');
  for (const p of data.profiles) {
    if (p.kind === 'kids' && d.rank(p.maturity_ceiling) > d.rank('7+')) bad('A kids profile cannot have a ceiling above 7+.');
    if (names.has(fold(p.name))) bad('Two profiles share a name.'); names.add(fold(p.name));
    if (p.person_id !== null && !ctx.binding.people.some(x => x.person_id === p.person_id)) bad('A profile person_id is not in the run binding.');
    past(p.created_at, 'Profile creation time');
  }
  unique(data.titles.map(t => t.title_id), 'title');
  const playable = new Map();
  for (const t of data.titles) {
    offset(t.available_from, 'available_from'); offset(t.available_until, 'available_until');
    if (t.available_until !== null && ms(t.available_until) <= ms(t.available_from)) bad('A title ends before it starts.');
    if (t.kind === 'film' ? t.runtime_seconds === null || t.seasons.length > 0 : t.runtime_seconds !== null) bad('A film has a runtime and no seasons; a series has seasons and no runtime.');
    unique(t.seasons.map(s => s.number), 'season');
    for (const s of t.seasons) { unique(s.episodes.map(e => e.number), 'episode number'); for (const e of s.episodes) offset(e.released_at, 'Episode release time'); }
    for (const p of d.playables(t)) { if (playable.has(p.playable_id)) bad('Duplicate playable ID.'); playable.set(p.playable_id, p); }
  }
  unique(data.devices.map(x => x.device_id), 'device');
  const devices = new Set(data.devices.map(x => x.device_id));
  for (const x of data.devices) { past(x.first_seen_at, 'Device first use'); past(x.last_used_at, 'Device last use'); }
  const rows = new Set();
  for (const r of data.progress) {
    const p = playable.get(r.playable_id);
    if (!profiles.has(r.profile_id) || !p || p.title_id !== r.title_id) bad('A progress row names an unknown profile or playable.');
    if (r.position_seconds > p.runtime_seconds) bad('Progress beyond a playable\'s runtime.');
    const key = r.profile_id + '\n' + r.playable_id; if (rows.has(key)) bad('Two progress rows for one profile and playable.'); rows.add(key);
    past(r.updated_at, 'Progress time');
  }
  unique(data.history.map(h => h.history_id), 'history');
  for (const h of data.history) {
    const p = playable.get(h.playable_id);
    if (!profiles.has(h.profile_id) || !devices.has(h.device_id) || !p || p.title_id !== h.title_id) bad('A history row names an unknown profile, device or playable.');
    if (h.seconds_watched > p.runtime_seconds) bad('A viewing longer than its playable.');
    past(h.started_at, 'Viewing start'); past(h.recorded_at, 'Viewing record time');
  }
  const listed = new Set(), titles = new Set(data.titles.map(t => t.title_id));
  for (const w of data.watchlist) {
    if (!profiles.has(w.profile_id) || !titles.has(w.title_id)) bad('A watchlist entry names an unknown profile or title.');
    const key = w.profile_id + '\n' + w.title_id; if (listed.has(key)) bad('A title is listed twice for one profile.'); listed.add(key);
    past(w.added_at, 'Watchlist time');
  }
  unique(data.charges.map(c => c.charge_id), 'charge');
  for (const c of data.charges) { if (!plans.has(c.plan_id) || ms(c.period_end) <= ms(c.period_start)) bad('A charge names an unknown plan or an empty period.'); past(c.at, 'Charge time'); offset(c.period_start, 'Charge period'); offset(c.period_end, 'Charge period'); }
  unique(data.notifications.map(n => n.notification_id), 'notification');
  for (const n of data.notifications) past(n.at, 'Notification time');
  let seq = 0;
  for (const row of data.activity) { if (row.seq !== ++seq) bad('Activity rows must be numbered from 1 without gaps.'); past(row.at, 'Activity time'); }
}
// Core counts and addresses App objects through these two hooks; they describe the same records.
const records = data => [...data.profiles, ...data.titles, ...data.devices, ...data.charges];
const objects = data => [...data.profiles.map(p => p.profile_id), ...data.titles.map(t => t.title_id), ...data.devices.map(x => x.device_id), ...data.charges.map(c => c.charge_id)];
module.exports = {validateSeed, records, objects, references: () => []};
