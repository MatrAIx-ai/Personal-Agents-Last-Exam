'use strict';
// Reads: account, plan, payment methods, class search and detail, studios, reservations and the waitlist.
const c = require('./common.cjs');
const {fail, copy, parse} = c;

function studioSummary(data, s) {return {studio_id:s.studio_id, name:s.name, neighborhood:s.neighborhood, distance_km:s.distance_km, rating:s.rating, review_count:s.review_count, rating_label:c.ratingLabel(s), image_asset_id:s.image_asset_id};}
function classView(data, x, nowMs) {
  const s = c.studio(data, x.studio_id), i = c.instructor(data, x.instructor_id);
  const mine = data.reservations.find(r => r.class_instance_id === x.class_instance_id && c.HELD.has(r.status)) || null;
  const wl = data.waitlist.find(w => w.class_instance_id === x.class_instance_id && ['waiting', 'offered'].includes(w.status)) || null;
  return {id:x.class_instance_id, ...copy(x), studio:studioSummary(data, s), instructor:i ? {instructor_id:i.instructor_id, name:i.name} : null, price:c.price(data, x), spots_left:c.spotsLeft(data, x),
    rating_label:c.ratingLabel(x), cancel_by:c.cancelBy(data, x), my_reservation_id:mine ? mine.reservation_id : null, my_waitlist_entry_id:wl ? wl.waitlist_entry_id : null, visited_studio:c.visitedStudio(data, x.studio_id)};
}
function classSummary(data, x) {
  const s = c.studio(data, x.studio_id), i = c.instructor(data, x.instructor_id);
  return {class_instance_id:x.class_instance_id, title:x.title, type:x.type, start:x.start, end:x.end, status:x.status, studio_id:s.studio_id, studio_name:s.name, neighborhood:s.neighborhood, instructor_name:i ? i.name : null};
}
function paymentView(data, m) {return {id:m.payment_method_id, ...copy(m), is_default:data.account.payment_method_id === m.payment_method_id};}
function planView(data, nowMs) {
  const a = data.account, p = c.activePlan(data), f = c.formatter(data);
  const renews = a.pending_change && a.pending_change.action === 'change' ? c.plan(data, a.pending_change.plan_id) : (a.status === 'trial' ? data.plans.find(x => x.kind === 'credits') || null : p);
  const daysLeft = a.trial_end ? Math.max(0, Math.round((parse(a.trial_end + 'T00:00:00Z') - parse(f.day(nowMs) + 'T00:00:00Z')) / 86400000)) : null;
  return {id:p.plan_id, ...copy(p), status:a.status, credits_remaining:a.credits_remaining, period_start:a.period_start, renewal_date:a.renewal_date, trial_end:a.trial_end, trial_days_left:daysLeft,
    pending_change:copy(a.pending_change), payment_method:a.payment_method_id === null ? null : paymentView(data, c.paymentMethod(data, a.payment_method_id)), trial_reminder_sent_at:a.trial_reminder_sent_at,
    renews_to:a.status === 'cancel_at_period_end' || a.status === 'cancelled' || !renews ? null : {plan_id:renews.plan_id, name:renews.name, price_cents:renews.price_cents}};
}
function summary(data, nowMs) {
  const plan = planView(data, nowMs);
  return {credits_remaining:data.account.credits_remaining, upcoming_reservations:c.myBookedUpcoming(data, nowMs).length, waitlist_entries:data.waitlist.filter(w => ['waiting', 'offered'].includes(w.status)).length, trial_days_left:plan.trial_days_left, signed_out:data.account.signed_out};
}
const account = (ctx, data) => {const nowMs = c.now(ctx); return {account:{member:copy(data.account.member), plan:planView(data, nowMs), summary:summary(data, nowMs), settings:copy(data.settings)}};};
const planGet = (ctx, data) => ({plan:planView(data, c.now(ctx)), receipts:copy(data.receipts).sort((a, b) => parse(a.at) - parse(b.at))});
const paymentMethods = (ctx, data) => ({payment_methods:data.payment_methods.map(m => paymentView(data, m))});

function classesSearch(ctx, data, args) {
  const nowMs = c.now(ctx), f = c.formatter(data), q = (args.query || '').toLocaleLowerCase();
  const from = args.from ? parse(args.from) : nowMs, to = args.to ? parse(args.to) : from + c.days(14);
  if (!(from < to)) fail('invalid_arguments', 'The window must end after it starts.');
  const hourBand = {morning:[0, 12], afternoon:[12, 17], evening:[17, 24]}[args.time_of_day] || null;
  const views = data.class_instances.filter(x => {
    if (x.status !== 'scheduled' || parse(x.start) <= nowMs || parse(x.start) < from || parse(x.start) >= to) return false;
    if (args.type && x.type !== args.type) return false;
    if (args.studio_id && x.studio_id !== args.studio_id) return false;
    const s = c.studio(data, x.studio_id), i = c.instructor(data, x.instructor_id);
    if (args.neighborhood && s.neighborhood.toLocaleLowerCase() !== args.neighborhood.toLocaleLowerCase()) return false;
    if (args.date && f.day(parse(x.start)) !== args.date) return false;
    if (hourBand) {const h = f.hour(parse(x.start)); if (h < hourBand[0] || h >= hourBand[1]) return false;}
    if (args.include_premium === false && x.premium) return false;
    if (q && ![x.title, x.type, s.name, s.neighborhood, i ? i.name : ''].join(' ').toLocaleLowerCase().includes(q)) return false;
    return true;
  }).map(x => classView(data, x, nowMs)).filter(v => (args.include_full || v.spots_left > 0 || v.my_reservation_id || v.my_waitlist_entry_id) && (!args.included_only || v.price.kind === 'included'));
  views.sort((a, b) => parse(a.start) - parse(b.start) || a.studio.name.localeCompare(b.studio.name));
  return {classes:views};
}
const classesGet = (ctx, data, args) => ({class:classView(data, c.instance(data, args.id), c.now(ctx))});
function studiosGet(ctx, data, args) {
  const s = c.studio(data, args.id), nowMs = c.now(ctx);
  const upcoming = data.class_instances.filter(x => x.studio_id === s.studio_id && x.status === 'scheduled' && parse(x.start) > nowMs).sort((a, b) => parse(a.start) - parse(b.start)).map(x => classView(data, x, nowMs));
  return {studio:{id:s.studio_id, ...copy(s), rating_label:c.ratingLabel(s), visited:c.visitedStudio(data, s.studio_id), upcoming, instructors:copy(data.instructors.filter(i => i.studio_id === s.studio_id))}};
}
function studiosImage(ctx, data, args) {
  const s = c.studio(data, args.id);
  if (s.image_asset_id === null) fail('no_image', s.name + ' has no image; show a placeholder.');
  if (!ctx.assets?.read) fail('unsupported_capability', 'An asset reader is required.');
  const {media, ...file} = ctx.assets.read(s.image_asset_id);
  return {studio_id:s.studio_id, file};
}
function reservationView(data, r, nowMs) {
  const x = c.instance(data, r.class_instance_id);
  const others = c.myBookedUpcoming(data, nowMs).filter(o => o.reservation_id !== r.reservation_id && c.overlap(c.instance(data, o.class_instance_id), x));
  const booked = r.status === 'booked' && parse(x.end) > nowMs;
  return {id:r.reservation_id, ...copy(r), class:classSummary(data, x), conflict:booked && others.length > 0, conflict_with:booked && others.length ? others[0].reservation_id : null, cancel_by:c.cancelBy(data, x),
    would_be_late:booked && nowMs > parse(c.cancelBy(data, x)), can_check_in:booked && nowMs >= parse(x.start) - c.minutes(data.settings.checkin_opens_minutes) && nowMs <= parse(x.end)};
}
function reservationsList(ctx, data, args) {
  const nowMs = c.now(ctx), status = args.status || 'all';
  const keep = v => {
    const upcoming = v.status === 'booked' && parse(v.class.end) > nowMs;
    if (status === 'all') return true;
    if (status === 'upcoming') return upcoming;
    if (status === 'past') return !upcoming;
    if (status === 'cancelled') return ['cancelled', 'late_cancelled', 'cancelled_by_studio'].includes(v.status);
    return v.status === status;
  };
  return {reservations:data.reservations.map(r => reservationView(data, r, nowMs)).filter(keep).sort((a, b) => parse(a.class.start) - parse(b.class.start))};
}
const reservationsGet = (ctx, data, args) => ({reservation:reservationView(data, c.reservation(data, args.id), c.now(ctx))});
function waitlistView(data, e, nowMs) {
  const expired = e.status === 'offered' && parse(e.offer.offer_expires_at) < nowMs;
  return {id:e.waitlist_entry_id, ...copy(e), status:expired ? 'expired' : e.status, class:classSummary(data, c.instance(data, e.class_instance_id)), position:['waiting', 'offered'].includes(e.status) && !expired ? 1 : 0};
}
const waitlistList = (ctx, data) => {const nowMs = c.now(ctx); return {entries:data.waitlist.map(e => waitlistView(data, e, nowMs)).sort((a, b) => parse(b.created_at) - parse(a.created_at))};};

module.exports = {studioSummary, classView, classSummary, planView, paymentView, summary, account, planGet, paymentMethods, classesSearch, classesGet, studiosGet, studiosImage, reservationView, reservationsList, reservationsGet, waitlistView, waitlistList};
