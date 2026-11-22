'use strict';
// Incoming events: what managers and coworkers do. Time is the environment's: Pegboard has
// no timers, no scheduler and no clock event. An event is handled at its own time T
// (`event.at`, which the host also supplies as ctx.virtual_now while the handler runs): a
// handoff whose cut-off has passed by T is expired and takes no answer or decision, and a
// notification written at T is held or released by the quiet hours at T.
// Managers are not checked against the policy: a posting, a change and a decision are
// applied as given, and the account holder's shifts carry flags where the result breaks it.
const { fail, ms, isoAt, localDate, addDays, validDate, weekdayOf, WEEKDAYS, HOUR } = require('./util.cjs');
const { validateSeed, objects, index, zoneOf, hoursOf, shiftWeek, shiftState, shiftPhase, handoffState, handoffPending, timeOffState, cutoffOf, namedShifts, pendingFor } = require('./model.cjs');
const { record, notify } = require('./notifications.cjs');
const { step, settle } = require('./handoffs.cjs');
const { firstName, positionText, sentence, shiftText, dayText, clock } = require('./present.cjs');
const { log } = require('./diagnostics.cjs');

const APP = 'pegboard.';
const reject = message => fail('invalid_event', message);
const newId = (data, id) => { if (objects(data).includes(id)) reject('ID ' + id + ' is already in use.'); };
const person = (ix, id, what) => { if (!ix.people.has(id)) reject('Unknown person ' + id + ' (' + what + ').'); };
const holdsPosition = (data, ix, shift) => ix.people.get(data.owner_person_id).position_ids.includes(shift.position_id);
function timing(start, end, what) {
  if (!(ms(end) > ms(start))) reject(what + ' does not end after it starts.');
  if ((ms(end) - ms(start)) / HOUR > 16) reject(what + ' is longer than 16 hours.');
}
const reason = p => (p.reason ? ' Reason given: ' + sentence(p.reason) : '');
const quoted = (label, text) => (text ? ' ' + label + ': ' + sentence(text) : '');

// Pending handoffs that name a changed shift no longer describe what was agreed: they become void.
function voidHandoffs(data, ix, shift, event, T, verb) {
  const me = data.owner_person_id, who = firstName(ix, event.payload.changed_by);
  for (const handoff of data.handoffs.filter(h => handoffPending(h, T) && namedShifts(h).includes(shift.id))) {
    step(handoff, { at: event.at, actor: 'manager', action: 'voided', state: 'void', event_id: event.event_id, person_id: event.payload.changed_by, note: 'Shift ' + shift.id + ' was ' + verb + ' by the manager.' });
    record(data, { at: event.at, actor: 'event', action: 'handoff.voided', object_id: handoff.id, event_id: event.event_id, details: { shift_id: shift.id } });
    notify(data, event.at, {
      kind: 'handoff.updated', object: { type: 'handoff', id: handoff.id }, shifts: namedShifts(handoff).map(x => ix.shifts.get(x)),
      title: (handoff.requester_id === me ? 'Your ' : firstName(ix, handoff.requester_id) + '\'s ') + handoff.kind + ' request is void',
      body: who + ' ' + verb + ' ' + shiftText(data, ix, shift) + ', so the pending ' + handoff.kind + ' request ' + handoff.id + ' no longer applies. Nothing changed hands.',
    }, event.event_id);
  }
}
function openShiftNotice(data, ix, shift, event) {
  if (!data.preferences.open_shift_notices || !holdsPosition(data, ix, shift)) return;
  notify(data, event.at, {
    kind: 'open_shift.posted', object: { type: 'shift', id: shift.id }, shifts: [shift],
    title: 'Open shift: ' + dayText(localDate(ms(shift.start), zoneOf(data))) + ', ' + clock(data, shift.start) + ' to ' + clock(data, shift.end),
    body: 'An open shift is available: ' + shiftText(data, ix, shift) + ' (' + hoursOf(shift) + ' hours). Open Pegboard to check whether you can pick it up.',
  }, event.event_id);
}
function handoffNotice(data, ix, handoff, event, title, body) {
  notify(data, event.at, { kind: 'handoff.updated', object: { type: 'handoff', id: handoff.id }, shifts: namedShifts(handoff).map(x => ix.shifts.get(x)), title, body }, event.event_id);
}
function findHandoff(ix, id) {
  const handoff = ix.handoffs.get(id);
  if (!handoff) reject('Unknown handoff ' + id + '.');
  return handoff;
}
// The shifts an approval moves must still be held as the handoff states. A manager's change
// voids the handoff first, so this only fails for an inconsistent script.
function stillFits(handoff, ix) {
  const shift = ix.shifts.get(handoff.shift_id), other = handoff.other_shift_id === null ? null : ix.shifts.get(handoff.other_shift_id);
  return handoff.kind === 'pickup' ? shiftState(shift) === 'open'
    : shiftState(shift) === 'assigned' && shift.assignee === handoff.requester_id && (!other || (shiftState(other) === 'assigned' && other.assignee === handoff.counterpart_id));
}
function approve(data, ix, handoff, event, row) {
  if (!stillFits(handoff, ix)) reject('Handoff ' + handoff.id + ' cannot be approved: its shifts are no longer held as it states.');
  step(handoff, row);
  for (const shift of settle(data, ix, handoff, event.at, { event_id: event.event_id })) {
    record(data, { at: event.at, actor: 'event', action: 'shift.reassigned', object_id: shift.id, event_id: event.event_id, details: { handoff_id: handoff.id, assignee: shift.assignee } });
  }
}

const handlers = {
  'schedule.published'(data, event, T) {
    const p = event.payload, ix = index(data), zone = zoneOf(data), me = data.owner_person_id;
    if (!validDate(p.week_start) || weekdayOf(p.week_start) !== WEEKDAYS.indexOf(data.workplace.week_start)) reject('week_start must be a ' + data.workplace.week_start + '.');
    if (p.posted_by !== undefined) person(ix, p.posted_by, 'posted_by');
    const ids = new Set(objects(data)), weekEnd = addDays(p.week_start, 7), alreadyPosted = ix.weeks.has(p.week_start), added = [];
    for (const s of p.shifts) {
      if (ids.has(s.shift_id)) reject('ID ' + s.shift_id + ' is already in use.');
      ids.add(s.shift_id);
      if (!ix.locations.has(s.location_id) || !ix.positions.has(s.position_id)) reject('Shift ' + s.shift_id + ' names an unknown location or position.');
      if (s.assignee !== null) person(ix, s.assignee, 'assignee of ' + s.shift_id);
      timing(s.start, s.end, 'Shift ' + s.shift_id);
      const day = localDate(ms(s.start), zone);
      if (day < p.week_start || day >= weekEnd) reject('Shift ' + s.shift_id + ' does not start in the week of ' + p.week_start + '.');
      added.push({
        id: s.shift_id, location_id: s.location_id, position_id: s.position_id, start: s.start, end: s.end, assignee: s.assignee,
        history: [{ at: event.at, by: 'schedule', event_id: event.event_id, ...(p.posted_by ? { changed_by: p.posted_by } : {}), change: { posted: { from: null, to: s.assignee } } }],
      });
    }
    if (!alreadyPosted) data.weeks.push({ week_start: p.week_start, posted_at: event.at });
    data.shifts.push(...added);
    record(data, { at: event.at, actor: 'event', action: 'schedule.published', object_id: p.week_start, event_id: event.event_id, details: { shifts: added.length, first_posting: !alreadyPosted } });
    const mine = added.filter(s => s.assignee === me);
    if (mine.length) {
      notify(data, event.at, {
        kind: 'schedule.published', object: { type: 'week', id: p.week_start }, shifts: mine,
        title: (alreadyPosted ? 'Shifts added to' : 'Schedule posted for') + ' the week of ' + dayText(p.week_start),
        body: (alreadyPosted ? 'Shifts were added to' : 'The schedule is posted for') + ' the week of ' + dayText(p.week_start) + '. You have ' + mine.length + (mine.length === 1 ? ' new shift' : ' new shifts')
          + ': ' + mine.map(s => dayText(localDate(ms(s.start), zone)) + ' ' + clock(data, s.start) + ' to ' + clock(data, s.end)).join('; ') + '. Open Pegboard to see your week.',
      }, event.event_id);
    }
    if (alreadyPosted) for (const s of added.filter(x => x.assignee === null)) openShiftNotice(data, index(data), s, event);
    return p.week_start;
  },

  'shift.changed'(data, event, T) {
    const p = event.payload, ix = index(data), me = data.owner_person_id, shift = ix.shifts.get(p.shift_id), change = p.change;
    if (!shift) reject('Unknown shift ' + p.shift_id + '.');
    if (shiftState(shift) === 'cancelled') reject('Shift ' + shift.id + ' is cancelled and cannot change.');
    if (shiftPhase(shift, T) === 'ended') reject('Shift ' + shift.id + ' has ended and cannot change.');
    if (!Object.keys(change).length) reject('change names no field.');
    person(ix, p.changed_by, 'changed_by');
    if (change.position_id !== undefined && !ix.positions.has(change.position_id)) reject('Unknown position ' + change.position_id + '.');
    if (change.location_id !== undefined && !ix.locations.has(change.location_id)) reject('Unknown location ' + change.location_id + '.');
    if (change.assignee !== undefined && change.assignee !== null) person(ix, change.assignee, 'assignee');
    timing(change.start ?? shift.start, change.end ?? shift.end, 'Shift ' + shift.id);
    const before = { ...shift }, wasMine = shift.assignee === me, wasOpen = shift.assignee === null, was = shiftText(data, ix, shift), diff = {};
    const zone = zoneOf(data), wasDay = localDate(ms(before.start), zone), wasAt = ix.locations.get(before.location_id).name;
    for (const key of ['start', 'end', 'position_id', 'location_id', 'assignee']) {
      if (change[key] !== undefined && change[key] !== shift[key]) { diff[key] = { from: shift[key], to: change[key] }; shift[key] = change[key]; }
    }
    if (!Object.keys(diff).length) reject('The change leaves shift ' + shift.id + ' as it is.');
    if (!ix.weeks.has(shiftWeek(data, shift))) reject('Shift ' + shift.id + ' would start in a week that has not been posted.');
    shift.history.push({ at: event.at, by: 'manager', event_id: event.event_id, changed_by: p.changed_by, ...(p.reason ? { reason: p.reason } : {}), change: diff });
    record(data, { at: event.at, actor: 'event', action: 'shift.changed', object_id: shift.id, event_id: event.event_id, details: { fields: Object.keys(diff) } });
    const isMine = shift.assignee === me, who = firstName(ix, p.changed_by);
    if (wasMine || isMine) {
      const kind = !wasMine ? 'assigned' : !isMine ? 'unassigned' : 'changed';
      // What changed on a shift that was and stays mine, field by field.
      const day = localDate(ms(shift.start), zone), hours = s => clock(data, s.start) + ' to ' + clock(data, s.end), parts = [];
      if (diff.start || diff.end) parts.push(day === wasDay ? 'it now runs ' + hours(shift) + ' (was ' + hours(before) + ')' : 'it now runs ' + hours(shift) + ' on ' + dayText(day) + ' (was ' + hours(before) + ' on ' + dayText(wasDay) + ')');
      if (diff.position_id) parts.push('the position is now ' + positionText(ix, shift) + ' (was ' + positionText(ix, before) + ')');
      if (diff.location_id) parts.push('it is now at ' + ix.locations.get(shift.location_id).name + ' (was ' + wasAt + ')');
      const mine = 'Your ' + dayText(wasDay).split(' ')[0] + ' shift at ' + wasAt;
      const title = {
        assigned: 'New shift on ' + dayText(day), unassigned: 'You are off the shift on ' + dayText(wasDay),
        changed: mine + (diff.start && day === wasDay ? ' now starts at ' + clock(data, shift.start) : diff.end && parts.length === 1 && day === wasDay ? ' now ends at ' + clock(data, shift.end) : ' has changed'),
      }[kind];
      const text = {
        assigned: who + ' assigned you ' + shiftText(data, ix, shift) + '.', unassigned: who + ' took you off ' + was + '.',
        changed: who + ' changed your ' + positionText(ix, before) + ' shift on ' + dayText(wasDay) + ' at ' + wasAt + ': ' + parts.join('; ') + '.',
      }[kind];
      notify(data, event.at, {
        kind: 'shift.changed', change: kind, object: { type: 'shift', id: shift.id }, shifts: isMine ? [shift] : [before],
        title, body: text + reason(p) + ' Open Pegboard to see your week and your options.',
      }, event.event_id);
    } else if (!wasOpen && shift.assignee === null) openShiftNotice(data, ix, shift, event);
    voidHandoffs(data, ix, shift, event, T, 'changed');
    return shift.id;
  },

  'shift.cancelled'(data, event, T) {
    const p = event.payload, ix = index(data), shift = ix.shifts.get(p.shift_id);
    if (!shift) reject('Unknown shift ' + p.shift_id + '.');
    if (shiftState(shift) === 'cancelled') reject('Shift ' + shift.id + ' is already cancelled.');
    if (shiftPhase(shift, T) === 'ended') reject('Shift ' + shift.id + ' has ended and cannot be cancelled.');
    person(ix, p.changed_by, 'changed_by');
    shift.cancelled_at = event.at;
    shift.history.push({ at: event.at, by: 'manager', event_id: event.event_id, changed_by: p.changed_by, ...(p.reason ? { reason: p.reason } : {}), change: { cancelled: { from: false, to: true } } });
    record(data, { at: event.at, actor: 'event', action: 'shift.cancelled', object_id: shift.id, event_id: event.event_id });
    if (shift.assignee === data.owner_person_id) {
      notify(data, event.at, {
        kind: 'shift.changed', change: 'cancelled', object: { type: 'shift', id: shift.id }, shifts: [shift],
        title: 'Your shift on ' + dayText(localDate(ms(shift.start), zoneOf(data))) + ' is cancelled',
        body: firstName(ix, p.changed_by) + ' cancelled ' + shiftText(data, ix, shift) + '.' + reason(p) + ' It no longer counts in your hours.',
      }, event.event_id);
    }
    voidHandoffs(data, ix, shift, event, T, 'cancelled');
    return shift.id;
  },

  'handoff.received'(data, event, T) {
    const p = event.payload, ix = index(data), me = data.owner_person_id, trade = p.kind === 'trade';
    newId(data, p.handoff_id);
    person(ix, p.from_person_id, 'from_person_id');
    if (p.from_person_id === me) reject('A coworker\'s request cannot come from the account holder.');
    if (trade !== (p.your_shift_id !== undefined)) reject('A trade names your_shift_id and a cover does not.');
    const theirs = ix.shifts.get(p.their_shift_id), yours = trade ? ix.shifts.get(p.your_shift_id) : null;
    if (!theirs || yours === undefined) reject('Unknown shift.');
    if (shiftState(theirs) !== 'assigned' || theirs.assignee !== p.from_person_id) reject('Shift ' + theirs.id + ' is not assigned to ' + p.from_person_id + '.');
    if (yours && (shiftState(yours) !== 'assigned' || yours.assignee !== me)) reject('Shift ' + yours.id + ' is not assigned to the account holder.');
    const named = yours ? [theirs, yours] : [theirs], cutoff = cutoffOf(data, named);
    if (named.some(s => T >= ms(s.start)) || T >= cutoff) reject('The cut-off for this handoff has passed.');
    for (const s of named) if (pendingFor(data, s.id, T)) reject('Shift ' + s.id + ' already has a pending handoff.');
    const handoff = {
      id: p.handoff_id, kind: p.kind, requester_id: p.from_person_id, counterpart_id: me, shift_id: theirs.id, other_shift_id: yours ? yours.id : null,
      ...(p.message ? { message: p.message } : {}), state: 'awaiting_me', cutoff_at: isoAt(cutoff, zoneOf(data)), created_at: event.at,
      history: [{ at: event.at, actor: 'coworker', action: 'received', state: 'awaiting_me', event_id: event.event_id, person_id: p.from_person_id }],
    };
    data.handoffs.push(handoff);
    record(data, { at: event.at, actor: 'event', action: 'handoff.received', object_id: handoff.id, event_id: event.event_id, details: { kind: p.kind } });
    const who = firstName(ix, p.from_person_id);
    notify(data, event.at, {
      kind: 'handoff.received', object: { type: 'handoff', id: handoff.id }, shifts: named,
      title: who + (trade ? ' asks to trade shifts with you' : ' asks you to cover a shift'),
      body: who + (trade ? ' asks to trade: you would take ' + shiftText(data, ix, theirs) + ', and ' + who + ' would take ' + shiftText(data, ix, yours) + '.' : ' asks you to take ' + shiftText(data, ix, theirs) + '.')
        + quoted('Message', p.message) + ' Answer in Pegboard before ' + dayText(localDate(cutoff, zoneOf(data))) + ' ' + isoAt(cutoff, zoneOf(data)).slice(11, 16) + '.',
    }, event.event_id);
    return handoff.id;
  },

  'handoff.answered'(data, event, T) {
    const p = event.payload, ix = index(data), handoff = findHandoff(ix, p.handoff_id), state = handoffState(handoff, T);
    if (state !== 'awaiting_coworker') reject('Handoff ' + handoff.id + ' is ' + state + '; it is not waiting for a coworker\'s answer.');
    const who = firstName(ix, handoff.counterpart_id), note = p.message ? { note: p.message } : {}, row = { at: event.at, actor: 'coworker', event_id: event.event_id, person_id: handoff.counterpart_id, ...note };
    // The event's own row comes first, then one row for each of its effects.
    const next = p.answer === 'decline' ? 'declined' : data.workplace.policy.manager_approval ? 'awaiting_manager' : 'approved';
    record(data, { at: event.at, actor: 'event', action: 'handoff.answered', object_id: handoff.id, event_id: event.event_id, details: { answer: p.answer, state: next } });
    if (next === 'approved') approve(data, ix, handoff, event, { ...row, action: 'accepted', state: next });
    else step(handoff, { ...row, action: p.answer === 'decline' ? 'declined' : 'accepted', state: next });
    handoffNotice(data, ix, handoff, event, who + (p.answer === 'decline' ? ' declined' : ' accepted') + ' your ' + handoff.kind + ' request',
      who + (p.answer === 'decline' ? ' declined your ' + handoff.kind + ' request ' + handoff.id + '. The shift is still yours.'
        : ' accepted your ' + handoff.kind + ' request ' + handoff.id + '. ' + (handoff.state === 'approved' ? 'No approval is needed: the change is done.' : 'It now waits for the manager; the shift is still yours until it is approved.'))
        + quoted('Message', p.message));
    return handoff.id;
  },

  'handoff.decided'(data, event, T) {
    const p = event.payload, ix = index(data), handoff = findHandoff(ix, p.handoff_id), state = handoffState(handoff, T);
    if (state !== 'awaiting_manager') reject('Handoff ' + handoff.id + ' is ' + state + '; it is not waiting for the manager.');
    person(ix, p.decided_by, 'decided_by');
    const row = { at: event.at, actor: 'manager', event_id: event.event_id, person_id: p.decided_by, ...(p.note ? { note: p.note } : {}) };
    handoff.decided_by = p.decided_by;
    if (p.note) handoff.note = p.note;
    record(data, { at: event.at, actor: 'event', action: 'handoff.decided', object_id: handoff.id, event_id: event.event_id, details: { decision: p.decision } });
    if (p.decision === 'approve') approve(data, ix, handoff, event, { ...row, action: 'approved', state: 'approved' });
    else step(handoff, { ...row, action: 'denied', state: 'denied' });
    const who = firstName(ix, p.decided_by), askedByMe = handoff.requester_id === data.owner_person_id;
    const done = {
      cover: () => (askedByMe ? 'the shift is now ' + firstName(ix, handoff.counterpart_id) + '\'s' : 'the shift is now yours'), trade: () => 'both shifts changed hands',
      release: () => 'the shift is now open and no longer yours', pickup: () => 'the shift is yours',
    }[handoff.kind]();
    handoffNotice(data, ix, handoff, event, 'Your ' + handoff.kind + ' was ' + (p.decision === 'approve' ? 'approved' : 'denied'),
      who + (p.decision === 'approve' ? ' approved ' + handoff.kind + ' ' + handoff.id + ': ' + done + '.' : ' denied ' + handoff.kind + ' ' + handoff.id + '. Nothing changed hands.') + quoted('Note', p.note));
    return handoff.id;
  },

  'handoff.withdrawn'(data, event, T) {
    const p = event.payload, ix = index(data), handoff = findHandoff(ix, p.handoff_id), state = handoffState(handoff, T);
    if (handoff.requester_id === data.owner_person_id) reject('Handoff ' + handoff.id + ' was asked for by the account holder; a coworker cannot withdraw it.');
    if (!handoffPending(handoff, T)) reject('Handoff ' + handoff.id + ' is ' + state + ' and cannot be withdrawn.');
    step(handoff, { at: event.at, actor: 'coworker', action: 'withdrawn', state: 'cancelled', event_id: event.event_id, person_id: handoff.requester_id, ...(p.message ? { note: p.message } : {}) });
    record(data, { at: event.at, actor: 'event', action: 'handoff.withdrawn', object_id: handoff.id, event_id: event.event_id });
    const who = firstName(ix, handoff.requester_id);
    handoffNotice(data, ix, handoff, event, who + ' withdrew the ' + handoff.kind + ' request', who + ' withdrew ' + handoff.kind + ' request ' + handoff.id + '. Nothing changed hands.' + quoted('Message', p.message));
    return handoff.id;
  },

  'time_off.decided'(data, event, T) {
    const p = event.payload, ix = index(data), entry = ix.timeOff.get(p.time_off_id);
    if (!entry) reject('Unknown time-off entry ' + p.time_off_id + '.');
    const state = timeOffState(data, entry, T);
    if (state !== 'pending') reject('Time-off entry ' + entry.id + ' is ' + state + '; it is not waiting for a decision.');
    person(ix, p.decided_by, 'decided_by');
    entry.state = p.decision === 'approve' ? 'approved' : 'denied';
    entry.decided_at = event.at; entry.decided_by = p.decided_by;
    if (p.note) entry.note = p.note;
    entry.history.push({ at: event.at, actor: 'manager', action: entry.state, state: entry.state, event_id: event.event_id, person_id: p.decided_by, ...(p.note ? { note: p.note } : {}) });
    record(data, { at: event.at, actor: 'event', action: 'time_off.decided', object_id: entry.id, event_id: event.event_id, details: { decision: p.decision } });
    const range = entry.start_date === entry.end_date ? dayText(entry.start_date) : dayText(entry.start_date) + ' to ' + dayText(entry.end_date);
    notify(data, event.at, {
      kind: 'time_off.decided', object: { type: 'time_off', id: entry.id }, shifts: [],
      title: 'Time off ' + entry.state + ': ' + range,
      body: firstName(ix, p.decided_by) + ' ' + entry.state + ' your time off for ' + range + '.' + quoted('Note', p.note),
    }, event.event_id);
    return entry.id;
  },
};

function applyEvent(ctx, data, event) {
  const name = String(event.operation).startsWith(APP) ? event.operation.slice(APP.length) : '', handler = handlers[name];
  if (!handler) reject('Unknown Pegboard event ' + event.operation + '.');
  const objectId = handler(data, event, ms(event.at));
  // Anything an event would leave inconsistent is the event's fault, not the seed's.
  try { validateSeed(ctx, data); } catch (e) { if (e.code === 'invalid_seed') reject(e.message); throw e; }
  log(ctx, 'pegboard.event.prepared', { operation: event.operation, object_id: objectId });
  return data;
}

module.exports = { applyEvent };
