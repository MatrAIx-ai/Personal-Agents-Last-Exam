'use strict';
// W3: who may collect each child, restrictions, and one-day dismissal changes.
const c = require('./common.cjs');
const {notify, longDate} = require('./notify.cjs');
const MODE_TEXT = {guardian_pickup: 'collected by a guardian', bus: 'the bus', after_care: 'after-care', walker: 'walking home'};

const digits = phone => String(phone || '').replace(/\D/g, '');
function changeView(ctx, data, d) {
  const s = c.schoolOf(data, d.child_id), info = c.dayInfo(data, s, d.date);
  const moot = info.kind === 'closed' && d.status === 'active';
  const phase = info.dismissal_at ? (c.passed(ctx, info.dismissal_at) ? 'past' : 'upcoming') : 'past';
  return {...c.copy(d), status: moot ? 'moot' : d.status, stored_status: d.status, phase, moot,
    person_display_name: d.person_id ? c.displayName(data, d.person_id) : null,
    cutoff_at: info.dismissal_change_cutoff_at || null,
    cutoff_passed: info.dismissal_change_cutoff_at ? c.passed(ctx, info.dismissal_change_cutoff_at) : true};
}
const activeChange = (data, childId, date) => data.dismissal_changes.find(d => d.child_id === childId && d.date === date && d.status === 'active') || null;
function describe(data, d) {
  if (!d) return null;
  return d.mode === 'pickup' ? 'collected by ' + c.displayName(data, d.person_id) : MODE_TEXT[d.mode];
}

function get(ctx, data, args) {
  const kid = c.child(data, args.id);
  c.requireRight(data, kid.id, 'custodial');
  const {start, end} = c.windowOf(ctx, data, args, 0, 14), s = c.school(data, kid.school_id);
  const guardians = data.guardian_links.filter(l => l.child_id === kid.id && l.can_pickup).map(l => ({person_id: l.person_id,
    display_name: c.displayName(data, l.person_id), relationship: l.relationship, is_me: l.person_id === data.owner_person_id}));
  const pickup_people = data.pickup_people.filter(p => p.child_id === kid.id).map(c.copy);
  const restrictions = data.restrictions.filter(r => r.child_id === kid.id).map(r => ({id: r.id, person_id: r.person_id,
    display_name: c.displayName(data, r.person_id), note: c.RESTRICTION_NOTE}));
  const changes = data.dismissal_changes.filter(d => d.child_id === kid.id && d.date >= start && d.date <= end).map(d => changeView(ctx, data, d));
  const days = c.time.eachDate(start, end).map(date => c.dayInfo(data, s, date)).filter(i => i.school_day || i.kind === 'closed').map(i => {
    const d = i.school_day ? activeChange(data, kid.id, i.date) : null;
    return {date: i.date, kind: i.kind, dismissal_local: i.dismissal_local || null, cutoff_at: i.dismissal_change_cutoff_at || null,
      plan: !i.school_day ? null : d ? {source: 'dismissal_change', change_id: d.id, mode: d.mode, person_id: d.person_id}
        : {source: 'default', change_id: null, mode: kid.default_dismissal, person_id: null}};
  });
  return {child_id: kid.id, default_dismissal: kid.default_dismissal, start, end, guardians, pickup_people, restrictions,
    dismissal_changes: changes, days};
}

// Identity mapping: the restriction rule matches person_id, never a name. A supplied person_id is
// used as is; otherwise a phone number the school already holds resolves to that person's ID;
// otherwise a new school-held person record is created. The display name never decides identity.
function resolvePerson(ctx, data, args) {
  if (args.person_id) {
    if (!c.person(data, args.person_id)) c.fail('not_found', 'Person ' + args.person_id + ' is not known to the school.');
    return {person_id: args.person_id, created: false};
  }
  const phone = digits(args.phone);
  const match = data.people.find(p => p.phone && digits(p.phone) === phone);
  if (match) return {person_id: match.person_id, created: false};
  return {person_id: c.nextId(data.people, 'person-bn', 'person_id'), created: true};
}
function addPerson(ctx, data, args) {
  const kid = c.child(data, args.id);
  c.requireRight(data, kid.id, 'custodial');
  const {person_id, created} = resolvePerson(ctx, data, args);
  if (c.restricted(data, kid.id, person_id)) c.fail('restricted_person', 'The school office holds a restriction for this person and ' + kid.display_name + '.');
  if (c.guardianLink(data, kid.id, person_id)) c.fail('conflict', 'This person is already a guardian of ' + kid.display_name + '.');
  const existing = data.pickup_people.find(p => p.child_id === kid.id && p.person_id === person_id && ['pending_review', 'approved'].includes(p.status));
  if (existing) c.fail('conflict', 'This person is already on the list (' + existing.id + ', ' + existing.status + ').');
  if (created) data.people.push({person_id, display_name: args.name, phone: args.phone});
  const review = c.policy(data, c.school(data, kid.school_id)).pickup_person_review;
  const pp = {id: c.nextId(data.pickup_people, 'pp'), child_id: kid.id, person_id, display_name: args.name, relationship: args.relationship,
    phone: args.phone, status: review ? 'pending_review' : 'approved', added_by: data.owner_person_id, created_at: ctx.virtual_now,
    history: [{at: ctx.virtual_now, action: review ? 'added_pending_review' : 'added_approved', by: data.owner_person_id, request_id: args.request_id}]};
  data.pickup_people.push(pp);
  c.activity(ctx, data, {actor: 'agent', action: 'pickup.person_add', child_id: kid.id, object_id: pp.id, request_id: args.request_id});
  return {id: pp.id, child_id: kid.id, person_id, person_record: created ? 'created' : 'existing', status: pp.status};
}
function removePerson(ctx, data, args) {
  const pp = c.find(data.pickup_people, args.id, 'Pickup person');
  c.requireRight(data, pp.child_id, 'custodial');
  if (!['approved', 'pending_review'].includes(pp.status)) c.fail('invalid_state', 'This pickup person is already ' + pp.status + '.');
  const ahead = data.dismissal_changes.filter(d => d.child_id === pp.child_id && d.person_id === pp.person_id && d.status === 'active')
    .map(d => changeView(ctx, data, d)).filter(d => d.phase === 'upcoming' && !d.moot);
  if (ahead.length) c.fail('in_use', 'Named in dismissal change ' + ahead.map(d => d.id).join(', ') + '; cancel or replace it first.');
  pp.status = 'removed';
  pp.history.push({at: ctx.virtual_now, action: 'removed', by: data.owner_person_id, request_id: args.request_id});
  c.activity(ctx, data, {actor: 'agent', action: 'pickup.person_remove', child_id: pp.child_id, object_id: pp.id, request_id: args.request_id});
  return {id: pp.id, status: pp.status};
}
// Who may be named as the collector for this child: restriction first, then guardians, then the list.
function checkCollector(data, childId, personId, code) {
  const fail = (own, msg) => c.fail(code || own, msg);
  if (c.restricted(data, childId, personId)) fail('restricted_person', 'The school office holds a restriction for this person.');
  const g = c.guardianLink(data, childId, personId);
  if (g && g.can_pickup) return;
  const pp = data.pickup_people.filter(p => p.child_id === childId && p.person_id === personId);
  if (pp.some(p => p.status === 'approved')) return;
  if (pp.some(p => p.status === 'pending_review')) fail('pending_review', 'This person is still waiting for the office to approve them.');
  fail('not_authorized_person', 'This person is not an approved guardian or pickup person for this child.');
}
function replaceActive(ctx, data, childId, date, newId, source) {
  const prior = activeChange(data, childId, date);
  if (prior) {
    prior.status = 'replaced'; prior.replaced_by = newId;
    prior.history.push({at: ctx.virtual_now, action: 'replaced', by: newId, ...source});
  }
  return prior;
}
function set(ctx, data, args) {
  const kid = c.child(data, args.id);
  c.requireRight(data, kid.id, 'custodial');
  if (!c.time.validDate(args.date)) c.fail('invalid_arguments', 'date must be YYYY-MM-DD.');
  const info = c.schoolDay(data, c.school(data, kid.school_id), args.date);
  if (c.passed(ctx, info.dismissal_change_cutoff_at)) c.fail('too_late', 'The cut-off for changes on ' + args.date + ' passed at ' + info.dismissal_change_cutoff_at + '.');
  if ((args.mode === 'pickup') !== Boolean(args.person_id)) c.fail('invalid_arguments', 'A pickup change names exactly one person; other modes name none.');
  if (args.mode === 'pickup') checkCollector(data, kid.id, args.person_id);
  const id = c.nextId(data.dismissal_changes, 'dc');
  const prior = replaceActive(ctx, data, kid.id, args.date, id, {request_id: args.request_id});
  const d = {id, child_id: kid.id, date: args.date, mode: args.mode, person_id: args.person_id || null, note: args.note || null,
    recorded_by: data.owner_person_id, actor: 'agent', created_at: ctx.virtual_now, status: 'active', replaces: prior ? prior.id : null,
    replaced_by: null, request_id: args.request_id, event_id: null,
    history: [{at: ctx.virtual_now, action: 'set', by: data.owner_person_id, request_id: args.request_id}]};
  data.dismissal_changes.push(d);
  c.activity(ctx, data, {actor: 'agent', action: 'dismissal.set', child_id: kid.id, object_id: id, request_id: args.request_id});
  return {id, child_id: kid.id, date: args.date, status: 'active', replaced_id: prior ? prior.id : null, cutoff_at: info.dismissal_change_cutoff_at};
}
function cancel(ctx, data, args) {
  const d = c.find(data.dismissal_changes, args.id, 'Dismissal change');
  c.requireRight(data, d.child_id, 'custodial');
  const view = changeView(ctx, data, d);
  if (view.status !== 'active') c.fail('invalid_state', 'This dismissal change is ' + view.status + '.');
  if (view.cutoff_passed) c.fail('too_late', 'The cut-off for changes on ' + d.date + ' passed at ' + view.cutoff_at + '.');
  d.status = 'cancelled';
  d.history.push({at: ctx.virtual_now, action: 'cancelled', by: data.owner_person_id, request_id: args.request_id});
  c.activity(ctx, data, {actor: 'agent', action: 'dismissal.cancel', child_id: d.child_id, object_id: d.id, request_id: args.request_id});
  return {id: d.id, status: d.status, default_dismissal: c.child(data, d.child_id).default_dismissal};
}

// ---- events ----------------------------------------------------------------------------------
function reviewed(ctx, data, event, row) {
  const p = event.payload, pp = data.pickup_people.find(x => x.id === p.pickup_person_id);
  if (!pp) c.fail('invalid_event', 'Unknown pickup person.');
  const s = c.schoolOf(data, pp.child_id);
  if (!data.staff.some(x => x.id === p.reviewed_by && x.school_id === s.id)) c.fail('invalid_event', 'Unknown staff member for this school.');
  const from = {approve: 'pending_review', deny: 'pending_review', revoke: 'approved'}[p.decision];
  if (pp.status !== from) c.fail('invalid_event', 'The pickup person is ' + pp.status + ', not waiting for ' + p.decision + '.');
  if (p.decision === 'approve' && c.restricted(data, pp.child_id, pp.person_id)) c.fail('invalid_event', 'A restricted person cannot be approved.');
  pp.status = {approve: 'approved', deny: 'denied', revoke: 'removed'}[p.decision];
  pp.history.push({at: ctx.virtual_now, action: p.decision === 'revoke' ? 'revoked' : pp.status, by: p.reviewed_by, event_id: event.event_id});
  row.child_id = pp.child_id; row.object_id = pp.id;
  const kid = c.child(data, pp.child_id);
  const voided = [];
  if (p.decision === 'revoke') {
    for (const d of data.dismissal_changes.filter(x => x.child_id === pp.child_id && x.person_id === pp.person_id && x.status === 'active')) {
      const v = changeView(ctx, data, d);
      if (v.phase !== 'upcoming' || v.moot) continue;
      d.status = 'void';
      d.history.push({at: ctx.virtual_now, action: 'void', by: p.reviewed_by, event_id: event.event_id});
      voided.push(d);
      c.activity(ctx, data, {actor: 'event', action: 'effect.dismissal_change.void', child_id: d.child_id, object_id: d.id, event_id: event.event_id, cause_seq: row.seq});
    }
  }
  const verb = {approve: 'approved', deny: 'did not approve', revoke: 'removed'}[p.decision];
  notify(ctx, data, {kind: 'pickup.person_reviewed', child_id: pp.child_id, object_type: 'pickup_person', object_id: pp.id, event_id: event.event_id,
    cause_seq: row.seq, title: s.name + ': ' + pp.display_name + ' ' + verb + ' for ' + kid.display_name,
    body: 'The office ' + verb + ' ' + pp.display_name + ' as a person who may collect ' + kid.display_name + '.' +
      (voided.length ? ' ' + voided.length + ' dismissal change(s) naming them no longer apply.' : '')});
  for (const d of voided) {
    notify(ctx, data, {kind: 'dismissal.void', child_id: d.child_id, object_type: 'dismissal_change', object_id: d.id, event_id: event.event_id,
      cause_seq: row.seq, title: kid.display_name + "'s dismissal change for " + longDate(d.date) + ' no longer applies',
      body: 'The change for ' + longDate(d.date) + ' (collected by ' + pp.display_name + ') is void because the office removed ' + pp.display_name +
        ' from the list. ' + kid.display_name + "'s default way home applies unless a new change is made before the cut-off."});
  }
}
function recorded(ctx, data, event, row) {
  const p = event.payload;
  if (c.idTaken(data, p.change_id)) c.fail('invalid_event', 'Object ID ' + p.change_id + ' already exists.');
  const kid = data.children.find(x => x.id === p.child_id);
  if (!kid) c.fail('invalid_event', 'Unknown child.');
  const s = c.school(data, kid.school_id);
  const byGuardian = p.recorded_by !== data.owner_person_id && c.guardianLink(data, kid.id, p.recorded_by);
  const byStaff = data.staff.some(x => x.id === p.recorded_by && x.school_id === s.id);
  if (!byGuardian && !byStaff) c.fail('invalid_event', 'A dismissal change is recorded by another guardian of this child or by the school office.');
  if (byGuardian && !byGuardian.custodial) c.fail('invalid_event', 'That guardian cannot change who collects this child.');
  if (!c.dayInfo(data, s, p.date).school_day) c.fail('invalid_event', p.date + ' is not a school day.');
  if ((p.mode === 'pickup') !== Boolean(p.person_id)) c.fail('invalid_event', 'A pickup change names exactly one person.');
  if (p.mode === 'pickup') checkCollector(data, kid.id, p.person_id, 'invalid_event');
  const prior = replaceActive(ctx, data, kid.id, p.date, p.change_id, {event_id: event.event_id});
  const d = {id: p.change_id, child_id: kid.id, date: p.date, mode: p.mode, person_id: p.person_id || null, note: p.note || null,
    recorded_by: p.recorded_by, actor: 'event', created_at: ctx.virtual_now, status: 'active', replaces: prior ? prior.id : null,
    replaced_by: null, request_id: null, event_id: event.event_id,
    history: [{at: ctx.virtual_now, action: 'recorded', by: p.recorded_by, event_id: event.event_id}]};
  data.dismissal_changes.push(d);
  row.child_id = kid.id; row.object_id = d.id;
  const who = c.displayName(data, p.recorded_by);
  notify(ctx, data, {kind: 'dismissal.recorded', child_id: kid.id, object_type: 'dismissal_change', object_id: d.id, event_id: event.event_id,
    cause_seq: row.seq, title: who + ' changed ' + kid.display_name + "'s way home on " + longDate(p.date),
    body: who + ' recorded that ' + kid.display_name + ' will be ' + describe(data, d) + ' on ' + longDate(p.date) + '.' +
      (prior ? ' This replaces the earlier plan (' + describe(data, prior) + (prior.recorded_by === data.owner_person_id ? ', set by you' : '') + ').' : '')});
}
module.exports = {get, addPerson, removePerson, set, cancel, reviewed, recorded, changeView, activeChange, describe, checkCollector};
