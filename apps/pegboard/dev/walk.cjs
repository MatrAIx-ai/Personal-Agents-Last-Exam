#!/usr/bin/env node
'use strict';
// Authoring-time check, never run by the App or the host.
//   node dev/walk.cjs [first seed] [last seed] [steps] [--report FILE]      default: seeds 1 to 10, 160 steps each
// A seeded random walk over every write, every event and the clock, starting from the package
// fixture. The harness validates each argument, result and resulting state, so the walk
// fails if the App ever accepts something that leaves its own records inconsistent, if a
// read changes data, or if a call fails with anything but a declared error. Every fourth
// step (`compareEvery`) it also compares reads with each other (hours against the listed
// shifts, flags against the weekly summary, pending handoffs against the shifts that name them).
// Deterministic: a fixed generator, no wall clock. It reads only files of this package.
const { fixture } = require('../tests/harness.cjs');
const { isoAt, addDays, localDate, localToInstant, pad } = require('../src/util.cjs');

const DECLARED = new Set(['not_found', 'not_yours', 'not_theirs', 'not_open', 'too_late', 'not_qualified', 'overlap', 'short_rest', 'over_hours', 'already_requested', 'shift_assigned', 'conflict', 'invalid_window', 'invalid_state', 'invalid_timezone', 'invalid_arguments', 'invalid_event']);
const PENDING = ['awaiting_coworker', 'awaiting_me', 'awaiting_manager'];
const WINDOW = { start: '2026-10-01T00:00:00-07:00', end: '2027-06-01T00:00:00-07:00' };
const HOUR = 3600000, MINUTE = 60000;

function walk(seedNumber, steps, compareEvery = 4) {
  let x = seedNumber >>> 0, events = 0;
  const rnd = n => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x % n; };
  const pick = list => list[rnd(list.length)];
  // Some walks run under another policy, so that both approval paths and a short cut-off are covered.
  const seed = structuredClone(require('../fixtures/minimal.json'));
  if (seedNumber % 3 === 0) seed.workplace.policy.manager_approval = false;
  if (seedNumber % 2 === 0) seed.people[0].max_weekly_hours = null;
  if (seedNumber % 5 === 0) seed.workplace.policy.handoff_cutoff_hours = 2;
  const app = fixture({ seed }), zone = seed.workplace.timezone, boss = seed.people.find(p => p.role === 'manager').id, outcomes = {};

  for (let i = 0; i < steps; i++) {
    const d = app.data, now = Date.parse(app.now), me = d.owner_person_id, people = d.people.map(p => p.id);
    const upcoming = d.shifts.filter(s => Date.parse(s.start) > now && !s.cancelled_at);
    const mine = upcoming.filter(s => s.assignee === me), theirs = upcoming.filter(s => s.assignee && s.assignee !== me), open = upcoming.filter(s => s.assignee === null);
    const pending = d.handoffs.filter(h => PENDING.includes(h.state) && Date.parse(h.cutoff_at) > now);
    // Mostly a sensible choice, sometimes any record at all, so that refusals are walked too.
    const some = list => (list.length && rnd(5) ? pick(list).id : pick(d.shifts).id);
    const aHandoff = state => { const fit = pending.filter(h => !state || h.state === state); return fit.length && rnd(6) ? pick(fit).id : d.handoffs.length ? pick(d.handoffs).id : 'ho-none'; };
    const aTimeOff = () => (d.time_off.length ? pick(d.time_off).id : 'to-none');
    const soon = () => isoAt(now + (1 + rnd(90)) * MINUTE, zone), day = n => addDays(localDate(now, zone), n);
    const event = (name, payload) => app.event({ event_id: 'walk-' + seedNumber + '-' + (++events), at: soon(), operation: 'pegboard.' + name, payload });
    const actions = {
      'handoffs.cover': () => app.call('handoffs.cover', { id: some(mine), to_person_id: pick(people) }),
      'handoffs.trade': () => app.call('handoffs.trade', { id: some(mine), their_shift_id: some(theirs) }),
      'handoffs.release': () => app.call('handoffs.release', { id: some(mine) }),
      'handoffs.pickup': () => app.call('handoffs.pickup', { id: some(open) }),
      'handoffs.respond': () => app.call('handoffs.respond', { id: aHandoff('awaiting_me'), answer: pick(['accept', 'decline']) }),
      'handoffs.cancel': () => app.call('handoffs.cancel', { id: aHandoff() }),
      'time_off.request': () => { const first = 10 + rnd(40); return app.call('time_off.request', { start: day(first), end: day(first + rnd(4)) }); },
      'time_off.cancel': () => app.call('time_off.cancel', { id: aTimeOff() }),
      'availability.update': () => app.call('availability.update', { blocks: rnd(3) ? [{ weekday: pick(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']), start: pad(6 + rnd(4)) + ':00', end: pad(12 + rnd(8)) + ':00' }] : [] }),
      'preferences.update': () => app.call('preferences.update', { patch: pick([{ email_notices: !d.preferences.email_notices }, { open_shift_notices: !d.preferences.open_shift_notices }, { quiet_hours: { enabled: !d.preferences.quiet_hours.enabled } }, { timezone: pick(['America/New_York', 'America/Los_Angeles', 'Asia/Tokyo']) }]) }),
      'handoff.answered': () => event('handoff.answered', { handoff_id: aHandoff('awaiting_coworker'), answer: pick(['accept', 'accept', 'decline']) }),
      'handoff.decided': () => event('handoff.decided', { handoff_id: aHandoff('awaiting_manager'), decision: pick(['approve', 'approve', 'deny']), decided_by: boss }),
      'handoff.withdrawn': () => event('handoff.withdrawn', { handoff_id: aHandoff('awaiting_me') }),
      'handoff.received': () => {
        const asked = theirs.length ? pick(theirs) : null, trade = rnd(2) === 1 && mine.length > 0;
        return event('handoff.received', { handoff_id: 'ho-walk-' + seedNumber + '-' + i, kind: trade ? 'trade' : 'cover', from_person_id: asked ? asked.assignee : pick(people), their_shift_id: asked ? asked.id : pick(d.shifts).id, ...(trade ? { your_shift_id: pick(mine).id } : {}) });
      },
      'shift.changed': () => {
        const id = some(upcoming), s = d.shifts.find(q => q.id === id), by = (rnd(5) - 2) * HOUR;
        const change = pick([{ assignee: pick([...people, null]) }, { start: isoAt(Date.parse(s.start) + by, zone), end: isoAt(Date.parse(s.end) + by, zone) }, { position_id: pick(d.workplace.positions).id }, { location_id: pick(d.workplace.locations).id }]);
        return event('shift.changed', { shift_id: id, change, changed_by: boss });
      },
      'shift.cancelled': () => event('shift.cancelled', { shift_id: some(upcoming), changed_by: boss }),
      'time_off.decided': () => event('time_off.decided', { time_off_id: aTimeOff(), decision: pick(['approve', 'deny']), decided_by: boss }),
      'schedule.published': () => {
        const last = d.weeks.map(w => w.week_start).sort().pop(), week = rnd(3) ? last : addDays(last, 7), start = localToInstant(addDays(week, rnd(7)), pad(6 + rnd(12)) + ':00', zone);
        return event('schedule.published', { week_start: week, shifts: [{ shift_id: 'sh-walk-' + seedNumber + '-' + i, location_id: pick(d.workplace.locations).id, position_id: pick(d.workplace.positions).id, start: isoAt(start, zone), end: isoAt(start + (2 + rnd(8)) * HOUR, zone), assignee: pick([...people, null]) }] });
      },
      'env.advance_time': () => app.advance(isoAt(now + (1 + rnd(6)) * HOUR * (rnd(10) === 0 ? 12 : 1), zone)),
    };
    // Manager decisions and the clock come up twice as often as anything else.
    const names = [...Object.keys(actions), 'handoff.decided', 'shift.changed', 'env.advance_time'], name = pick(names);
    let outcome = 'ok';
    try { actions[name](); } catch (e) {
      if (!DECLARED.has(e.code)) throw Object.assign(new Error('seed ' + seedNumber + ', step ' + i + ', ' + name + ': ' + (e.code || e.name) + ' ' + e.message), { cause: e });
      outcome = e.code;
    }
    (outcomes[name] = outcomes[name] || {})[outcome] = (outcomes[name][outcome] || 0) + 1;
    if (i % compareEvery === compareEvery - 1) compare(app, 'seed ' + seedNumber + ', step ' + i);
  }
  return outcomes;
}

// Reads agree with each other and with the stored records, in whatever state the walk reached.
function compare(app, where) {
  const must = (ok, message) => { if (!ok) throw new Error(where + ': ' + message); };
  const data = app.data, clock = app.now;
  let listed = [], cursor;
  do {
    const page = app.call('shifts.list', { ...WINDOW, include_cancelled: true, limit: 200, ...(cursor ? { cursor } : {}) });
    listed = listed.concat(page.shifts); cursor = page.next_cursor;
  } while (cursor);
  must(listed.length === data.shifts.length && new Set(listed.map(s => s.id)).size === listed.length, 'shifts.list pages hold every shift once');
  const mine = listed.filter(s => s.is_mine), weeks = app.call('hours.summary', WINDOW).weeks;
  must(Math.abs(mine.reduce((t, s) => t + s.hours, 0) - weeks.reduce((t, w) => t + w.scheduled_hours, 0)) < 0.05, 'the weekly summaries add up to the hours of my listed shifts');
  for (const w of weeks) must(mine.some(s => s.week_start === w.week_start && s.flags.includes('over_hours')) === w.over_cap, 'over_hours flags and over_cap agree for the week of ' + w.week_start);
  must(listed.every(s => s.is_mine || s.flags.length === 0), 'only my shifts carry flags');
  const handoffs = [];
  do {
    const page = app.call('handoffs.list', { include_closed: true, limit: 100, ...(cursor ? { cursor } : {}) });
    handoffs.push(...page.handoffs); cursor = page.next_cursor;
  } while (cursor);
  must(handoffs.length === data.handoffs.length, 'handoffs.list pages hold every handoff');
  const pending = handoffs.filter(h => PENDING.includes(h.state));
  for (const s of listed) must((s.pending_handoff_id !== null) === pending.some(h => h.id === s.pending_handoff_id && [h.shift.id, h.other_shift && h.other_shift.id].includes(s.id)), 'pending_handoff_id of ' + s.id + ' names a pending handoff that names it');
  for (const h of pending) must(h.kind === 'pickup' ? h.shift.state === 'open' : h.shift.assignee === h.requester_id && (!h.other_shift || h.other_shift.assignee === h.counterpart_id), 'pending handoff ' + h.id + ' fits its shifts');
  for (const h of handoffs.slice(0, 5)) app.call('eligibility.check', { id: h.shift.id, person_id: h.counterpart_id || h.requester_id, ...(h.other_shift ? { give_shift_id: h.other_shift.id } : {}) });
  for (const read of ['workplace.get', 'team.list', 'availability.get', 'preferences.get']) app.call(read);
  must(app.call('time_off.list', { include_closed: true }).time_off.length === data.time_off.length, 'time_off.list holds every entry');
  must(app.call('notifications.list', { limit: 100 }).notifications.length === Math.min(100, data.notifications.length), 'notifications.list');
  must(data.activity.every((a, k) => a.seq === k + 1), 'activity rows are numbered without gaps');
  must(data.notifications.length === data.activity.filter(a => a.action === 'notification.created').length, 'one activity row for each notification');
  must(app.now === clock, 'reads do not move the clock');
}

module.exports = { walk };
if (require.main === module) {
  const argv = process.argv.slice(2), at = argv.indexOf('--report'), report = at === -1 ? null : argv.splice(at, 2)[1];
  const [first, last, steps] = [argv[0] || 1, argv[1] || 10, argv[2] || 160].map(Number), totals = {};
  for (let seed = first; seed <= last; seed++) {
    for (const [name, counts] of Object.entries(walk(seed, steps))) for (const [outcome, n] of Object.entries(counts)) (totals[name] = totals[name] || {})[outcome] = (totals[name][outcome] || 0) + n;
  }
  const sorted = Object.fromEntries(Object.keys(totals).sort().map(name => [name, Object.fromEntries(Object.entries(totals[name]).sort())]));
  for (const [name, counts] of Object.entries(sorted)) console.log(name.padEnd(20) + Object.entries(counts).map(([k, n]) => k + ' ' + n).join(', '));
  const walks = last - first + 1, summary = { schema: 'pegboard.walk.v1', app_version: require('../app.json').version, node: process.version, seeds: { first, last }, steps_per_walk: steps, operations: walks * steps, passed: true, outcomes: sorted };
  if (report) require('node:fs').writeFileSync(require('node:path').resolve(report), JSON.stringify(summary, null, 2) + '\n');
  console.log('PASS: ' + walks + ' walks of ' + steps + ' steps from seed ' + first + ' to ' + last + '; every state passed the seed rules and the schemas, and every refusal was a declared error.');
}
