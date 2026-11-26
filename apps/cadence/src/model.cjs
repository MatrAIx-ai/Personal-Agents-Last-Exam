'use strict';
// Seed validation and the data-relationship hooks Core calls. Reports facts about records; grants nothing.
const c = require('./common.cjs');
const {fail, parse, HELD} = c;

function timeline(created, updated, history, what) {
  if (parse(created) > parse(updated)) fail('invalid_seed', what + ': timestamps are reversed.');
  let previous = parse(created);
  for (const h of history) {
    const at = parse(h.at);
    if (!Number.isFinite(at) || at < previous || at > parse(updated)) fail('invalid_seed', what + ': history is out of order.');
    previous = at;
  }
  if (!history.length || previous !== parse(updated)) fail('invalid_seed', what + ': history must end with the last update.');
}

function validateSeed(ctx, data) {
  c.references(ctx, data);
  const seen = new Map();
  const unique = (id, what) => {if (seen.has(id)) fail('invalid_seed', 'Duplicate ID ' + id + ' (' + what + ' and ' + seen.get(id) + ').'); seen.set(id, what);};
  const plans = new Map();
  for (const p of data.plans) {unique(p.plan_id, 'plan'); plans.set(p.plan_id, p); if (p.kind === 'trial' && p.credits_per_period !== 0) fail('invalid_seed', 'Plan ' + p.plan_id + ': a trial carries no credits.');}
  const methods = new Set();
  for (const m of data.payment_methods) {unique(m.payment_method_id, 'payment method'); methods.add(m.payment_method_id);}
  const a = data.account;
  if (!plans.has(a.plan_id)) fail('invalid_seed', 'Account names unknown plan ' + a.plan_id + '.');
  if (a.payment_method_id !== null && !methods.has(a.payment_method_id)) fail('invalid_seed', 'Account names an unknown payment method.');
  const kind = plans.get(a.plan_id).kind, onTrial = kind === 'trial' && a.status !== 'cancelled';
  if (kind === 'trial' ? !['trial', 'cancel_at_period_end', 'cancelled'].includes(a.status) : a.status === 'trial') fail('invalid_seed', 'Account status and plan kind disagree about the trial.');
  if (onTrial !== (a.trial_end !== null)) fail('invalid_seed', 'A trial account needs trial_end; a paid or cancelled account must not have it.');
  if (a.period_start >= a.renewal_date) fail('invalid_seed', 'Account renewal_date must follow period_start.');
  if (a.pending_change && a.pending_change.action === 'change' && !plans.has(a.pending_change.plan_id)) fail('invalid_seed', 'Pending change names unknown plan.');
  if ((a.status === 'cancel_at_period_end') !== (a.pending_change !== null && a.pending_change.action === 'cancel')) fail('invalid_seed', 'cancel_at_period_end and a pending cancellation go together.');
  timeline(a.history[0] ? a.history[0].at : a.updated_at, a.updated_at, a.history, 'Account');
  const studios = new Map();
  for (const s of data.studios) {
    unique(s.studio_id, 'studio'); studios.set(s.studio_id, s);
    if ((s.rating === null) !== (s.review_count === 0)) fail('invalid_seed', 'Studio ' + s.studio_id + ': a rating needs reviews and reviews need a rating.');
  }
  const instructors = new Map();
  for (const i of data.instructors) {unique(i.instructor_id, 'instructor'); instructors.set(i.instructor_id, i); if (!studios.has(i.studio_id)) fail('invalid_seed', 'Instructor ' + i.instructor_id + ' names unknown studio.');}
  const instances = new Map();
  for (const x of data.class_instances) {
    unique(x.class_instance_id, 'class'); instances.set(x.class_instance_id, x);
    const s = studios.get(x.studio_id);
    if (!s) fail('invalid_seed', 'Class ' + x.class_instance_id + ' names unknown studio ' + x.studio_id + '.');
    if (!s.rooms.includes(x.room)) fail('invalid_seed', 'Class ' + x.class_instance_id + ' is in a room ' + s.name + ' does not have.');
    if (x.instructor_id !== null && (!instructors.has(x.instructor_id) || instructors.get(x.instructor_id).studio_id !== x.studio_id)) fail('invalid_seed', 'Class ' + x.class_instance_id + ' names an instructor from another studio.');
    if (parse(x.start) >= parse(x.end)) fail('invalid_seed', 'Class ' + x.class_instance_id + ' ends before it starts.');
    if ((x.rating === null) !== (x.review_count === 0)) fail('invalid_seed', 'Class ' + x.class_instance_id + ': a rating needs reviews and reviews need a rating.');
    if ((x.status === 'cancelled') !== (x.cancellation_reason !== null)) fail('invalid_seed', 'Class ' + x.class_instance_id + ': cancelled classes carry a reason and only they do.');
    timeline(x.created_at, x.updated_at, x.history, 'Class ' + x.class_instance_id);
  }
  const byRoom = new Map();
  for (const x of data.class_instances) {
    if (x.status !== 'scheduled') continue;
    const key = x.studio_id + '/' + x.room, list = byRoom.get(key) || [];
    for (const y of list) if (c.overlap(x, y)) fail('invalid_seed', 'Classes ' + x.class_instance_id + ' and ' + y.class_instance_id + ' overlap in the same room.');
    list.push(x); byRoom.set(key, list);
  }
  const held = new Map();
  const reservations = new Map();
  for (const r of data.reservations) {
    unique(r.reservation_id, 'reservation'); reservations.set(r.reservation_id, r);
    const x = instances.get(r.class_instance_id);
    if (!x) fail('invalid_seed', 'Reservation ' + r.reservation_id + ' is on an unknown class.');
    if (r.status === 'booked' && x.status !== 'scheduled') fail('invalid_seed', 'Reservation ' + r.reservation_id + ' is booked on a cancelled class.');
    if (HELD.has(r.status) && (r.price.kind === 'credits') !== (r.credits_charged > 0)) fail('invalid_seed', 'Reservation ' + r.reservation_id + ': credits charged must match a credit price.');
    if ((r.status === 'rescheduled') !== (r.replaced_by !== null)) fail('invalid_seed', 'Reservation ' + r.reservation_id + ': rescheduled reservations link to their replacement.');
    if (r.rating !== null && r.status !== 'attended') fail('invalid_seed', 'Reservation ' + r.reservation_id + ': only attended classes carry a rating.');
    if (HELD.has(r.status)) held.set(x.class_instance_id, (held.get(x.class_instance_id) || 0) + 1);
    timeline(r.booked_at, r.updated_at, r.history, 'Reservation ' + r.reservation_id);
  }
  for (const r of data.reservations) {
    if (r.replaced_by !== null && !reservations.has(r.replaced_by)) fail('invalid_seed', 'Reservation ' + r.reservation_id + ' is replaced by unknown ' + r.replaced_by + '.');
    if (r.replaces !== null && !reservations.has(r.replaces)) fail('invalid_seed', 'Reservation ' + r.reservation_id + ' replaces unknown ' + r.replaces + '.');
  }
  for (const [id, n] of held) {const x = instances.get(id); if (n > 1) fail('invalid_seed', 'Class ' + id + ' holds more than one reservation for this account.'); if (x.external_bookings + n > x.capacity) fail('invalid_seed', 'Class ' + id + ': bookings exceed capacity.');}
  for (const w of data.waitlist) {
    unique(w.waitlist_entry_id, 'waitlist entry');
    if (!instances.has(w.class_instance_id)) fail('invalid_seed', 'Waitlist entry ' + w.waitlist_entry_id + ' names unknown class.');
    if ((w.status === 'offered') !== (w.offer !== null && w.status === 'offered')) fail('invalid_seed', 'Waitlist entry ' + w.waitlist_entry_id + ': an offered entry must carry its offer.');
    if (w.status === 'waiting' && w.offer !== null) fail('invalid_seed', 'Waitlist entry ' + w.waitlist_entry_id + ': a waiting entry has no open offer.');
    if (w.offer) unique(w.offer.offer_id, 'offer');
    if (w.reservation_id !== null && !reservations.has(w.reservation_id)) fail('invalid_seed', 'Waitlist entry ' + w.waitlist_entry_id + ' names unknown reservation.');
    timeline(w.created_at, w.updated_at, w.history, 'Waitlist entry ' + w.waitlist_entry_id);
  }
  for (const p of data.previews) {
    unique(p.preview_id, 'preview');
    if (parse(p.created_at) >= parse(p.expires_at)) fail('invalid_seed', 'Preview ' + p.preview_id + ' expires before it was created.');
    if ((p.kind === 'booking') !== ('class_instance_id' in p.payload) || (p.kind === 'cancel') !== ('reservation_id' in p.payload) || (p.kind === 'plan') !== ('action' in p.payload)) fail('invalid_seed', 'Preview ' + p.preview_id + ': payload does not match its kind.');
  }
  for (const r of data.receipts) {unique(r.receipt_id, 'receipt'); if (r.payment_method_id !== null && !methods.has(r.payment_method_id)) fail('invalid_seed', 'Receipt ' + r.receipt_id + ' names an unknown payment method.');}
}

// Business records of this instance (dataset counts and asset ownership).
const records = data => [...data.studios, ...data.instructors, ...data.class_instances, ...data.reservations, ...data.waitlist, ...data.receipts];
const KEYS = ['studio_id', 'instructor_id', 'class_instance_id', 'reservation_id', 'waitlist_entry_id', 'receipt_id'];
const objects = data => records(data).map(r => r[KEYS.find(k => k in r)]);
const assetReferences = data => data.studios.filter(s => s.image_asset_id !== null).map(s => ({asset_id:s.image_asset_id, object_id:s.studio_id, object_type:'studio'}));

module.exports = {validateSeed, records, objects, references:() => [], assetReferences};
