'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const {fixture} = require('./harness.cjs');
const T = 'cadence.';
function unchanged(f, fn, pattern) {const before = f.data; assert.throws(fn, pattern); assert.deepEqual(f.data, before);}
const code = (fn, expected) => {try {fn(); assert.fail('expected ' + expected);} catch (e) {assert.equal(e.code, expected, e.message); return e.message;}};
const ev = (event_id, at, operation, payload) => ({event_id, at, operation, payload});
const flagOn = d => {d.settings.require_user_confirmation = true;};
const creditsPlan = (credits = 5) => d => {Object.assign(d.account, {plan_id:'plan-8-credits', status:'active', credits_remaining:credits, trial_end:null, period_start:'2026-12-01', renewal_date:'2026-12-31'});};

test('standalone seed: reads describe the fixture and change nothing', () => {
  const f = fixture(), before = f.data;
  const a = f.call(T + 'account.get', {}).account;
  assert.equal(a.plan.id, 'plan-trial'); assert.equal(a.plan.status, 'trial'); assert.equal(a.plan.trial_days_left, 7); assert.equal(a.plan.renews_to.plan_id, 'plan-8-credits');
  assert.deepEqual(a.summary, {credits_remaining:0, upcoming_reservations:3, waitlist_entries:1, trial_days_left:7, signed_out:false});
  const plan = f.call(T + 'plan.get', {});
  assert.equal(plan.receipts.length, 19); assert.equal(plan.plan.payment_method.last4, '2210');
  assert.equal(f.call(T + 'payment_methods.list', {}).payment_methods.filter(m => m.is_default).length, 1);
  const wednesday = f.call(T + 'classes.search', {date:'2026-12-09'}).classes;
  assert.ok(wednesday.length > 5 && wednesday.every(x => x.start.startsWith('2026-12-09')) && wednesday.some(x => x.id === 'ci-7750'));
  assert.ok(f.call(T + 'classes.search', {type:'sauna'}).classes.every(x => x.type === 'sauna' && x.price.kind === 'not_available'));
  assert.ok(f.call(T + 'classes.search', {included_only:true}).classes.every(x => x.price.kind === 'included'));
  assert.ok(f.call(T + 'classes.search', {date:'2026-12-09', time_of_day:'evening'}).classes.every(x => Number(x.start.slice(11, 13)) >= 17));
  const listed = f.call(T + 'classes.search', {include_full:false}).classes;
  assert.ok(listed.some(x => x.id === 'ci-7740') && listed.every(x => x.spots_left > 0 || x.my_waitlist_entry_id || x.my_reservation_id), 'full classes are hidden unless the member holds a place');
  assert.deepEqual(f.call(T + 'classes.get', {id:'ci-7745'}).class.price, {kind:'not_available', credits:0, reason:'premium_excluded'});
  assert.deepEqual(f.call(T + 'classes.get', {id:'ci-7722'}).class.price, {kind:'not_available', credits:0, reason:'repeat_visit'});
  assert.deepEqual(f.call(T + 'classes.get', {id:'ci-7752'}).class.price, {kind:'included', credits:0, reason:null});
  const full = f.call(T + 'classes.get', {id:'ci-7740'}).class;
  assert.equal(full.spots_left, 0); assert.equal(full.my_waitlist_entry_id, 'wl-311');
  assert.equal(f.call(T + 'classes.get', {id:'ci-7720'}).class.my_reservation_id, 'rsv-2001');
  assert.equal(f.call(T + 'studios.get', {id:'studio-ironworks'}).studio.visited, true);
  assert.equal(f.call(T + 'studios.get', {id:'studio-keel'}).studio.visited, false);
  assert.equal(f.call(T + 'studios.get', {id:'studio-willow'}).studio.rating_label, 'No ratings yet');
  const img = f.call(T + 'studios.image', {id:'studio-ironworks'}).file;
  assert.equal(img.mime_type, 'image/png'); assert.equal(crypto.createHash('sha256').update(Buffer.from(img.base64, 'base64')).digest('hex'), img.sha256);
  code(() => f.call(T + 'studios.image', {id:'studio-willow'}), 'no_image');
  const upcoming = f.call(T + 'reservations.list', {status:'upcoming'}).reservations;
  assert.equal(upcoming.length, 3); assert.ok(upcoming.every(r => !r.conflict));
  assert.equal(Date.parse(f.call(T + 'reservations.get', {id:'rsv-2041'}).reservation.cancel_by), Date.parse('2026-12-10T05:30:00-05:00'));
  assert.equal(f.call(T + 'reservations.list', {status:'attended'}).reservations.length, before.reservations.filter(r => r.status === 'attended').length);
  assert.ok(before.reservations.some(r => r.booked_at < '2025-03-01'), 'history starts in January 2025');
  const wl = f.call(T + 'waitlist.list', {}).entries[0];
  assert.equal(wl.status, 'waiting'); assert.equal(wl.position, 1); assert.equal(wl.class.studio_name, 'Haven Yoga');
  assert.deepEqual(f.data, before);
});

test('validateSeed rejects bookings over capacity, room overlaps, dangling references, duplicate IDs and rating mismatches', () => {
  const f = fixture();
  const broken = mutate => {const d = f.data; mutate(d); return () => plugin.validateSeed(f.ctx, d);};
  assert.throws(broken(d => {d.class_instances.find(x => x.class_instance_id === 'ci-7720').capacity = 1;}), /exceed capacity/);
  assert.throws(broken(d => {const a = d.class_instances.find(x => x.class_instance_id === 'ci-7750'), b = d.class_instances.find(x => x.class_instance_id === 'ci-7752'); b.studio_id = a.studio_id; b.room = a.room; b.start = a.start; b.end = a.end; b.instructor_id = a.instructor_id;}), /overlap in the same room/);
  assert.throws(broken(d => {d.reservations[0].class_instance_id = 'ci-missing';}), /unknown class/);
  assert.throws(broken(d => {d.studios[1].studio_id = d.studios[0].studio_id;}), /Duplicate ID/);
  assert.throws(broken(d => {d.studios[0].rating = null;}), /rating needs reviews/);
  assert.throws(broken(d => {d.account.trial_end = null;}), /trial_end/);
  unchanged(f, () => f.call(T + 'classes.get', {id:'ci-missing'}), /does not exist/);
  unchanged(f, () => f.call(T + 'classes.search', {time_of_day:'night'}), /Input schema/);
});

test('booking: preview and confirm an included class; overlap, premium, repeat-visit, full and horizon refusals change nothing', () => {
  const f = fixture();
  const p = f.call(T + 'reservations.preview', {class_instance_id:'ci-7752'});
  assert.deepEqual(p.price, {kind:'included', credits:0, reason:null}); assert.equal(p.spots_left, 6); assert.equal(p.approval_required, false);
  const r = f.call(T + 'reservations.confirm', {id:p.id});
  assert.equal(r.outcome, 'booked'); assert.equal(r.credits_charged, 0);
  assert.equal(f.call(T + 'classes.get', {id:'ci-7752'}).class.my_reservation_id, r.id);
  assert.equal(f.call(T + 'reservations.list', {status:'upcoming'}).reservations.length, 4);
  unchanged(f, () => f.call(T + 'reservations.confirm', {id:p.id}), /does not exist/);
  code(() => f.call(T + 'reservations.preview', {class_instance_id:'ci-7752'}), 'invalid_state');
  const wed = f.call(T + 'reservations.confirm', {id:f.call(T + 'reservations.preview', {class_instance_id:'ci-7750'}).id});
  assert.ok(code(() => f.call(T + 'reservations.preview', {class_instance_id:'ci-7751'}), 'overlap').includes(wed.id));
  assert.ok(code(() => f.call(T + 'reservations.preview', {class_instance_id:'ci-7745'}), 'not_included').includes('premium'));
  assert.ok(code(() => f.call(T + 'reservations.preview', {class_instance_id:'ci-7722'}), 'not_included').includes('first visit'));
  assert.ok(code(() => f.call(T + 'reservations.preview', {class_instance_id:'ci-7740'}), 'class_full').includes('waitlist.join'));
  const far = f.data.class_instances.find(x => x.status === 'scheduled' && x.start > '2026-12-15' && x.studio_id === 'studio-haven');
  const g = fixture({patch:d => {const x = d.class_instances.find(y => y.class_instance_id === far.class_instance_id); x.start = '2026-12-22T10:00:00-05:00'; x.end = '2026-12-22T11:00:00-05:00';}});
  code(() => g.call(T + 'reservations.preview', {class_instance_id:far.class_instance_id}), 'outside_horizon');
});

test('booking: a preview goes stale when the class changes or expires, and a full class points to the waitlist', () => {
  const f = fixture();
  const p = f.call(T + 'reservations.preview', {class_instance_id:'ci-7750'});
  f.event(ev('evt-4001', '2026-12-06T18:10:00-05:00', 'classes.capacity_changed', {class_instance_id:'ci-7750', capacity:12}));
  assert.ok(code(() => f.call(T + 'reservations.confirm', {id:p.id}), 'preview_stale').includes('spot'));
  const q = f.call(T + 'reservations.preview', {class_instance_id:'ci-7750'});
  f.event(ev('evt-4002', '2026-12-06T18:11:00-05:00', 'classes.capacity_changed', {class_instance_id:'ci-7750', capacity:10}));
  assert.ok(code(() => f.call(T + 'reservations.confirm', {id:q.id}), 'preview_stale').includes('waitlist.join'));
  const s = f.call(T + 'reservations.preview', {class_instance_id:'ci-7752'});
  f.ctx.virtual_now = '2026-12-06T18:35:00-05:00';
  assert.ok(code(() => f.call(T + 'reservations.confirm', {id:s.id}), 'preview_stale').includes('expired'));
  unchanged(f, () => f.event(ev('evt-4003', '2026-12-06T18:40:00-05:00', 'classes.capacity_changed', {class_instance_id:'ci-7750', capacity:5})), /capacity_below_bookings|cannot drop/);
});

test('cancellation: free inside the window; late cancellation needs a preview, charges the fee or forfeits credits, and a declined card is refused', () => {
  const f = fixture();
  const booked = f.call(T + 'reservations.confirm', {id:f.call(T + 'reservations.preview', {class_instance_id:'ci-7752'}).id});
  const early = f.call(T + 'reservations.cancel', {id:booked.id, reason:'Schedule change'});
  assert.equal(early.outcome, 'cancelled'); assert.equal(early.fee_cents, 0);
  assert.equal(f.call(T + 'reservations.get', {id:booked.id}).reservation.status, 'cancelled');
  f.ctx.virtual_now = '2026-12-10T08:00:00-05:00';
  assert.equal(f.call(T + 'reservations.get', {id:'rsv-2041'}).reservation.would_be_late, true);
  assert.ok(code(() => f.call(T + 'reservations.cancel', {id:'rsv-2041'}), 'late_cancellation').includes('$15.00'));
  const pv = f.call(T + 'reservations.cancel_preview', {id:'rsv-2041'});
  assert.equal(pv.late, true); assert.equal(pv.fee_cents, 1500); assert.equal(pv.credits_returned, 0);
  const late = f.call(T + 'reservations.cancel', {id:'rsv-2041', preview_id:pv.id, reason:'Sick'});
  assert.equal(late.outcome, 'late_cancelled'); assert.equal(late.fee_cents, 1500);
  const receipts = f.call(T + 'plan.get', {}).receipts;
  assert.equal(receipts[receipts.length - 1].kind, 'late_fee'); assert.equal(receipts.length, 20);
  const g = fixture({patch:d => {d.account.payment_method_id = 'pm-amex-0931';}});
  g.ctx.virtual_now = '2026-12-08T10:00:00-05:00';
  const pv2 = g.call(T + 'reservations.cancel_preview', {id:'rsv-2002'});
  unchanged(g, () => g.call(T + 'reservations.cancel', {id:'rsv-2002', preview_id:pv2.id}), /declined/);
  const h = fixture({patch:creditsPlan(5)});
  const paid = h.call(T + 'reservations.confirm', {id:h.call(T + 'reservations.preview', {class_instance_id:'ci-7752'}).id});
  assert.equal(paid.credits_charged, 2); assert.equal(h.call(T + 'account.get', {}).account.summary.credits_remaining, 3);
  h.ctx.virtual_now = '2026-12-11T10:00:00-05:00';
  const pv3 = h.call(T + 'reservations.cancel_preview', {id:paid.id});
  assert.equal(pv3.fee_cents, 0); assert.equal(pv3.credits_returned, 0);
  assert.equal(h.call(T + 'reservations.cancel', {id:paid.id, preview_id:pv3.id}).outcome, 'late_cancelled');
  assert.equal(h.call(T + 'account.get', {}).account.summary.credits_remaining, 3);
});

test('credit plans: insufficient credits, charges, reschedule within the studio and the price_changed refusal', () => {
  const f = fixture({patch:creditsPlan(5)});
  assert.ok(code(() => f.call(T + 'reservations.preview', {class_instance_id:'ci-7745'}), 'insufficient_credits').includes('8 credits'));
  const r = f.call(T + 'reservations.confirm', {id:f.call(T + 'reservations.preview', {class_instance_id:'ci-7750'}).id});
  assert.equal(r.credits_charged, 2); assert.equal(f.data.account.credits_remaining, 3);
  const other = f.data.class_instances.find(x => x.studio_id === 'studio-pulse' && x.type === 'hiit' && x.class_instance_id !== 'ci-7750' && x.status === 'scheduled' && x.start >= '2026-12-14');
  const moved = f.call(T + 'reservations.reschedule', {id:r.id, class_instance_id:other.class_instance_id});
  assert.equal(moved.replaces, r.id); assert.equal(f.data.account.credits_remaining, 3);
  assert.equal(f.call(T + 'reservations.get', {id:r.id}).reservation.status, 'rescheduled');
  const dearer = f.data.class_instances.find(x => x.studio_id === 'studio-pulse' && x.type === 'boxing' && x.status === 'scheduled' && x.start > '2026-12-07');
  code(() => f.call(T + 'reservations.reschedule', {id:moved.id, class_instance_id:dearer.class_instance_id}), 'price_changed');
  code(() => f.call(T + 'reservations.reschedule', {id:moved.id, class_instance_id:'ci-7752'}), 'invalid_arguments');
});

test('check-in and ratings respect their windows and update the class rating', () => {
  const f = fixture();
  const r = f.call(T + 'reservations.confirm', {id:f.call(T + 'reservations.preview', {class_instance_id:'ci-7752'}).id});
  f.ctx.virtual_now = '2026-12-11T16:00:00-05:00';
  code(() => f.call(T + 'reservations.checkin', {id:r.id}), 'checkin_window');
  f.ctx.virtual_now = '2026-12-11T17:05:00-05:00';
  assert.equal(f.call(T + 'reservations.checkin', {id:r.id}).outcome, 'attended');
  code(() => f.call(T + 'reservations.rate', {id:r.id, rating:5}), 'too_early');
  f.ctx.virtual_now = '2026-12-11T18:20:00-05:00';
  const before = f.call(T + 'classes.get', {id:'ci-7752'}).class.review_count;
  assert.equal(f.call(T + 'reservations.rate', {id:r.id, rating:5, review:'Great coaching.'}).outcome, 'rated');
  assert.equal(f.call(T + 'classes.get', {id:'ci-7752'}).class.review_count, before + 1);
  code(() => f.call(T + 'reservations.rate', {id:r.id, rating:4}), 'already_rated');
  code(() => f.call(T + 'reservations.rate', {id:'rsv-2041', rating:4}), 'not_attended');
});

test('waitlist: join only full classes, offers book the class, expire when unanswered, and can be declined or left', () => {
  const f = fixture();
  code(() => f.call(T + 'waitlist.join', {class_instance_id:'ci-7740'}), 'invalid_state');
  code(() => f.call(T + 'waitlist.join', {class_instance_id:'ci-7752'}), 'not_full');
  f.event(ev('evt-4010', '2026-12-06T18:30:00-05:00', 'waitlist.promoted', {waitlist_entry_id:'wl-311', offer_expires_at:'2026-12-06T22:00:00-05:00'}));
  assert.equal(f.call(T + 'waitlist.list', {}).entries[0].status, 'offered');
  const accepted = f.call(T + 'waitlist.accept', {id:'wl-311'});
  assert.equal(accepted.outcome, 'booked');
  assert.deepEqual(f.call(T + 'reservations.get', {id:accepted.reservation_id}).reservation.price, {kind:'included', credits:0, reason:null});
  const g = fixture();
  g.event(ev('evt-4011', '2026-12-06T18:30:00-05:00', 'waitlist.promoted', {waitlist_entry_id:'wl-311', offer_expires_at:'2026-12-06T19:00:00-05:00'}));
  g.ctx.virtual_now = '2026-12-06T19:30:00-05:00';
  assert.equal(g.call(T + 'waitlist.list', {}).entries[0].status, 'expired');
  code(() => g.call(T + 'waitlist.accept', {id:'wl-311'}), 'offer_expired');
  const h = fixture();
  h.event(ev('evt-4012', '2026-12-06T18:30:00-05:00', 'waitlist.promoted', {waitlist_entry_id:'wl-311', offer_expires_at:'2026-12-06T22:00:00-05:00'}));
  assert.equal(h.call(T + 'waitlist.decline', {id:'wl-311'}).outcome, 'declined');
  const full = h.data.class_instances.find(x => x.status === 'scheduled' && x.start > '2026-12-07' && x.class_instance_id !== 'ci-7740' && !x.premium && x.external_bookings === x.capacity);
  const joined = full ? h.call(T + 'waitlist.join', {class_instance_id:full.class_instance_id}) : null;
  if (joined) assert.equal(h.call(T + 'waitlist.leave', {id:joined.id}).outcome, 'left');
  unchanged(h, () => h.event(ev('evt-4013', '2026-12-06T18:31:00-05:00', 'waitlist.promoted', {waitlist_entry_id:'wl-311', offer_expires_at:'2026-12-06T22:00:00-05:00'})), /not waiting/);
});

test('plan: change and cancel previews, scheduled changes, declined cards, renewals and the trial reminder', () => {
  const f = fixture();
  const p = f.call(T + 'plan.preview', {action:'change', plan_id:'plan-8-credits'});
  assert.equal(p.effective_on, '2026-12-13'); assert.equal(p.charge_cents, 5900); assert.equal(p.credit_change, 8);
  const changed = f.call(T + 'plan.change', {id:p.id});
  assert.equal(changed.outcome, 'scheduled'); assert.equal(f.call(T + 'plan.get', {}).plan.pending_change.plan_id, 'plan-8-credits');
  code(() => f.call(T + 'plan.preview', {action:'cancel'}), 'change_pending');
  f.event(ev('evt-4020', '2026-12-11T09:00:00-05:00', 'plan.trial_ending', {account_id:'acct-amara', trial_end:'2026-12-13'}));
  assert.ok(f.call(T + 'plan.get', {}).plan.trial_reminder_sent_at);
  unchanged(f, () => f.event(ev('evt-4021', '2026-12-13T00:05:00-05:00', 'plan.renewed', {account_id:'acct-amara', plan_id:'plan-20-credits', renewal_date:'2027-01-12'})), /scheduled change/);
  f.event(ev('evt-4022', '2026-12-13T00:05:00-05:00', 'plan.renewed', {account_id:'acct-amara', plan_id:'plan-8-credits', renewal_date:'2027-01-12'}));
  const plan = f.call(T + 'plan.get', {});
  assert.equal(plan.plan.status, 'active'); assert.equal(plan.plan.credits_remaining, 8); assert.equal(plan.plan.renewal_date, '2027-01-12'); assert.equal(plan.receipts[plan.receipts.length - 1].kind, 'renewal');
  const g = fixture();
  const c = g.call(T + 'plan.preview', {action:'cancel'});
  assert.equal(c.effective_on, '2026-12-13'); assert.ok(c.note.includes('cancelled at its end'));
  assert.equal(g.call(T + 'plan.cancel', {id:c.id}).outcome, 'cancel_at_period_end');
  assert.equal(g.call(T + 'account.get', {}).account.plan.renews_to, null);
  g.event(ev('evt-4023', '2026-12-13T00:05:00-05:00', 'plan.renewed', {account_id:'acct-amara', plan_id:'plan-8-credits', renewal_date:'2027-01-12'}));
  assert.equal(g.call(T + 'plan.get', {}).plan.status, 'cancelled');
  assert.deepEqual(g.call(T + 'classes.get', {id:'ci-7752'}).class.price, {kind:'not_available', credits:0, reason:'plan_cancelled'});
  const h = fixture({patch:d => {d.account.payment_method_id = 'pm-amex-0931';}});
  code(() => h.call(T + 'plan.preview', {action:'change', plan_id:'plan-20-credits'}), 'payment_declined');
  code(() => h.call(T + 'plan.preview', {action:'change', plan_id:'plan-nope'}), 'unknown_plan');
  code(() => h.call(T + 'plan.preview', {action:'change', plan_id:'plan-trial'}), 'same_plan');
  const k = fixture({patch:creditsPlan(5)});
  code(() => k.call(T + 'plan.preview', {action:'change', plan_id:'plan-8-credits'}), 'same_plan');
  code(() => k.call(T + 'plan.preview', {action:'change', plan_id:'plan-trial'}), 'invalid_arguments');
});

test('session: an expired session refuses every operation until the restore event', () => {
  const f = fixture();
  f.event(ev('evt-4030', '2026-12-06T18:55:00-05:00', 'account.session_expired', {account_id:'acct-amara'}));
  assert.ok(code(() => f.call(T + 'account.get', {}), 'signed_out').includes('session_restored'));
  code(() => f.call(T + 'classes.search', {}), 'signed_out');
  unchanged(f, () => f.event(ev('evt-4031', '2026-12-06T18:56:00-05:00', 'account.session_expired', {account_id:'acct-amara'})), /already expired/);
  f.event(ev('evt-4032', '2026-12-06T19:06:00-05:00', 'account.session_restored', {account_id:'acct-amara'}));
  assert.equal(f.call(T + 'account.get', {}).account.summary.signed_out, false);
  unchanged(f, () => f.event(ev('evt-4033', '2026-12-06T19:07:00-05:00', 'account.session_restored', {account_id:'acct-amara'})), /not expired/);
});

test('events: studio schedule changes, cancellations and capacity changes have the declared effects', () => {
  const f = fixture();
  f.event(ev('evt-4040', '2026-12-07T09:00:00-05:00', 'classes.schedule_changed', {class_instance_id:'ci-7731', new_start:'2026-12-10T18:00:00-05:00', new_instructor_id:null}));
  const moved = f.call(T + 'reservations.get', {id:'rsv-2041'}).reservation;
  assert.equal(moved.time_changed, true); assert.equal(moved.class.start, '2026-12-10T18:00:00-05:00'); assert.equal(moved.conflict, false);
  unchanged(f, () => f.event(ev('evt-4041', '2026-12-07T09:01:00-05:00', 'classes.schedule_changed', {class_instance_id:'ci-7731', new_start:null, new_instructor_id:null})), /needs a new start/);
  unchanged(f, () => f.event(ev('evt-4042', '2026-12-07T10:00:00-05:00', 'classes.capacity_changed', {class_instance_id:'ci-7731', capacity:3})), /cannot drop/);
  f.event(ev('evt-4043', '2026-12-08T11:05:00-05:00', 'classes.cancelled_by_studio', {class_instance_id:'ci-7731', reason:'instructor_unavailable'}));
  const cancelled = f.call(T + 'reservations.get', {id:'rsv-2041'}).reservation;
  assert.equal(cancelled.status, 'cancelled_by_studio'); assert.equal(cancelled.class.status, 'cancelled');
  assert.equal(f.call(T + 'reservations.list', {status:'upcoming'}).reservations.length, 1);   // Monday's class is past at the event's clock
  unchanged(f, () => f.event(ev('evt-4044', '2026-12-08T11:06:00-05:00', 'classes.cancelled_by_studio', {class_instance_id:'ci-7731', reason:'again'})), /already cancelled/);
  code(() => f.call(T + 'reservations.preview', {class_instance_id:'ci-7731'}), 'invalid_state');
  unchanged(f, () => f.event(ev('evt-4045', '2026-12-08T12:00:00-05:00', 'nope.operation', {})), /Event schema/);
  const g = fixture({patch:creditsPlan(5)});
  const paid = g.call(T + 'reservations.confirm', {id:g.call(T + 'reservations.preview', {class_instance_id:'ci-7750'}).id});
  g.event(ev('evt-4046', '2026-12-07T09:00:00-05:00', 'classes.cancelled_by_studio', {class_instance_id:'ci-7750', reason:'instructor_unavailable'}));
  assert.equal(g.call(T + 'account.get', {}).account.summary.credits_remaining, 5);
  assert.equal(g.call(T + 'reservations.get', {id:paid.id}).reservation.credits_charged, 0);
});

test('with require_user_confirmation on, gated writes wait for user.confirmed', () => {
  const f = fixture({patch:flagOn});
  const p = f.call(T + 'reservations.preview', {class_instance_id:'ci-7752'});
  assert.equal(p.approval_required, true);
  assert.ok(code(() => f.call(T + 'reservations.confirm', {id:p.id}), 'approval_required').includes(p.id));
  unchanged(f, () => f.event(ev('evt-4050', '2026-12-06T18:05:00-05:00', 'user.confirmed', {preview_id:'pv-book-404'})), /No live preview/);
  f.event(ev('evt-4051', '2026-12-06T18:06:00-05:00', 'user.confirmed', {preview_id:p.id}));
  assert.equal(f.call(T + 'reservations.confirm', {id:p.id}).outcome, 'booked');
  const c = f.call(T + 'plan.preview', {action:'change', plan_id:'plan-8-credits'});
  code(() => f.call(T + 'plan.change', {id:c.id}), 'approval_required');
  f.event(ev('evt-4052', '2026-12-06T18:07:00-05:00', 'user.confirmed', {preview_id:c.id}));
  assert.equal(f.call(T + 'plan.change', {id:c.id}).outcome, 'scheduled');
  const g = fixture({patch:d => {flagOn(d); creditsPlan(5)(d);}});
  g.event(ev('evt-4053', '2026-12-06T18:30:00-05:00', 'waitlist.promoted', {waitlist_entry_id:'wl-311', offer_expires_at:'2026-12-06T22:00:00-05:00'}));
  const offer = g.call(T + 'waitlist.list', {}).entries[0].offer;
  assert.ok(code(() => g.call(T + 'waitlist.accept', {id:'wl-311'}), 'approval_required').includes(offer.offer_id));
  g.event(ev('evt-4054', '2026-12-06T18:31:00-05:00', 'user.confirmed', {offer_id:offer.offer_id}));
  assert.equal(g.call(T + 'waitlist.accept', {id:'wl-311'}).outcome, 'booked');
});

test('notices: each kind builds a valid, deterministic Mail wire message from public views only', () => {
  const {compile} = require('./schema-validator.cjs');
  const dir = path.resolve(__dirname, '../schemas');
  const wire = compile(require('../schemas/router-message.schema.json'), dir), payload = compile(require('../schemas/email-payload.schema.json'), dir);
  const notices = require('../src/notices.cjs');
  const f = fixture();
  const booked = f.call(T + 'reservations.confirm', {id:f.call(T + 'reservations.preview', {class_instance_id:'ci-7752'}).id});
  f.event(ev('evt-4060', '2026-12-07T09:00:00-05:00', 'classes.schedule_changed', {class_instance_id:'ci-7721', new_start:'2026-12-08T17:30:00-05:00', new_instructor_id:null}));
  f.event(ev('evt-4061', '2026-12-08T11:05:00-05:00', 'classes.cancelled_by_studio', {class_instance_id:'ci-7731', reason:'instructor_unavailable'}));
  f.event(ev('evt-4062', '2026-12-09T08:00:00-05:00', 'waitlist.promoted', {waitlist_entry_id:'wl-311', offer_expires_at:'2026-12-09T20:00:00-05:00'}));
  const offered = f.call(T + 'waitlist.list', {}).entries.find(e => e.id === 'wl-311');   // captured while the offer is open
  f.event(ev('evt-4063', '2026-12-11T09:00:00-05:00', 'plan.trial_ending', {account_id:'acct-amara', trial_end:'2026-12-13'}));
  const account = f.call(T + 'account.get', {}).account, bind = {account:'acct-amara', person:'person-amara'};
  const trialPlan = f.call(T + 'plan.get', {}).plan;
  f.event(ev('evt-4064', '2026-12-13T00:05:00-05:00', 'plan.renewed', {account_id:'acct-amara', plan_id:'plan-8-credits', renewal_date:'2027-01-12'}));
  const after = f.call(T + 'plan.get', {});
  const views = {
    booking_confirmed:{account, reservation:f.call(T + 'reservations.get', {id:booked.id}).reservation},
    cancelled_by_studio:{account, reservation:f.call(T + 'reservations.get', {id:'rsv-2041'}).reservation},
    schedule_changed:{account, reservation:f.call(T + 'reservations.get', {id:'rsv-2002'}).reservation},
    waitlist_offer:{account, entry:offered},
    trial_ending:{account, plan:trialPlan},
    renewal_receipt:{account, plan:after.plan, receipt:after.receipts[after.receipts.length - 1]}
  };
  assert.deepEqual(Object.keys(views).sort(), [...notices.KINDS].sort());
  for (const kind of notices.KINDS) {
    const m = notices.build(kind, views[kind], bind);
    assert.ok(wire(m), kind + ': wire message'); assert.ok(payload(m.data), kind + ': payload');
    assert.deepEqual(notices.build(kind, views[kind], bind), m, kind + ': deterministic');
    assert.equal(m.source, 'urn:pale:app:cadence:account:acct-amara'); assert.deepEqual(m.data.recipient, {kind:'person_ref', id:'person-amara'});
  }
  const cancelled = notices.build('cancelled_by_studio', views.cancelled_by_studio, bind);
  assert.equal(cancelled.id, 'cadence-notice-cancelled-by-studio-rsv-2041');
  assert.ok(cancelled.data.content.title.startsWith('Cancelled by the studio: Strength 60 at Granite Barbell') && cancelled.data.content.body.text.includes('included in your plan'));
  assert.throws(() => notices.build('booking_confirmed', {account, reservation:views.cancelled_by_studio.reservation}, bind), /not booked/);
  assert.throws(() => notices.build('nope', views.trial_ending, bind), /Unknown notice kind/);
});

test('optional diagnostics cannot change business results', () => {
  const on = fixture(), off = fixture({logging:false});
  const scenario = require('../examples/scenario.json');
  on.event(scenario); off.event(scenario); assert.deepEqual(on.data, off.data);
  assert.ok(on.logs.length); assert.equal(off.logs.length, 0);
  assert.ok(on.logs.every(l => l.step.startsWith('cadence.')));
  const broken = fixture(); broken.ctx.log = () => {throw Error('logger offline');};
  broken.event(scenario); assert.deepEqual(broken.data, off.data);
});

test('generated contract files match scripts/contracts.cjs', () => {
  require('../scripts/build.cjs').build({check:true});
  const tools = require('../tools.json');
  assert.equal(tools.length, 24); assert.equal(tools.filter(t => t.read_only).length, 10);
  assert.ok(tools.every(t => t.name.startsWith('cadence.')));
  assert.ok(tools.filter(t => !t.read_only).every(t => t.inputSchema.required.includes('expected_version') && t.inputSchema.required.includes('request_id')));
});

test('reviewer renderer escapes untrusted content', () => {
  const view = require('../gui/src/view.js');
  const html = view.render([{id:'test', title:'<img src=x onerror=alert(1)>', text:'<script>bad</script>'}]);
  assert.ok(!html.includes('<img')); assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;'));
});
