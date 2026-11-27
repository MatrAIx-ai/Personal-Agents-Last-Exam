'use strict';
// Business tool handlers. Core supplies a working copy of the data, validates
// input/output, checks versions and request IDs, and commits or rolls back.
// A rule failure is thrown; nothing is then stored, so the ledger is unchanged.
// Every committed write leaves one receipt and ends by re-checking the queues,
// because any of them can free a seat or change who is eligible for one.
const {fail, entry: named} = require('./domain-utils.cjs');
const APP = require('../app.json').app_id;
const ledger = require('./ledger.cjs');
const rules = require('./rules.cjs');
const queue = require('./queue.cjs');
const views = require('./views.cjs');

const creditsAfter = check => ({enrolled: check.credits.resulting, limit: check.credits.limit});
function allowed(check) {
  if (check.failures.length) rules.reject(check.failures);
  return check;
}
const receipt = (ctx, data, action, args, refs) => ledger.addReceipt(data, ctx.virtual_now, action, args.request_id, refs);
function addEnrollment(ctx, data, check) {
  const {id, seq} = ledger.allocate(data, 'enr');
  const section_ids = check.sections.map(s => s.id);
  data.enrollments.push({id, seq, occupant_ref: data.student.id, course_id: check.course.id, section_ids,
    status: 'enrolled', enrolled_at: ctx.virtual_now, ended_at: null});
  return {id, section_ids};
}
// Only the student's own rows are addressable; anything else does not exist for them.
function ownOffer(data, id) {
  const offer = data.offers.find(o => o.id === id);
  const entry = offer && data.waitlist_entries.find(e => e.id === offer.entry_id);
  if (!queue.own(data, entry)) fail('not_found', 'Offer ' + id + ' does not exist in this account.');
  return {offer, entry};
}

function enroll(ctx, data, args) {
  const check = allowed(rules.evaluate(data, ctx.virtual_now, {action: 'enroll', section_ids: args.section_ids}));
  const {id, section_ids} = addEnrollment(ctx, data, check);
  const receipt_id = receipt(ctx, data, 'enrollment.enroll', args, {course_id: check.course.id, enrollment_id: id, section_ids});
  queue.recheck(ctx, data);
  return {id, receipt_id, course_id: check.course.id, section_ids, credits: creditsAfter(check)};
}

function withdraw(ctx, data, args) {
  const check = allowed(rules.evaluate(data, ctx.virtual_now, {action: 'withdraw', enrollment_id: args.id}));
  const source = data.enrollments.find(e => e.id === check.source.id);
  source.status = 'withdrawn';
  source.ended_at = ctx.virtual_now;
  const cancelled_entry_ids = queue.cancelPendingSwaps(ctx, data, source, 'source_withdrawn', 'you withdrew from the enrollment it would have replaced');
  const receipt_id = receipt(ctx, data, 'enrollment.withdraw', args,
    {course_id: source.course_id, enrollment_id: source.id, section_ids: source.section_ids.slice(), cancelled_entry_ids});
  queue.recheck(ctx, data);
  return {id: source.id, receipt_id, course_id: source.course_id, section_ids: source.section_ids.slice(), cancelled_entry_ids, credits: creditsAfter(check)};
}

// The old bundle is given up and the new one taken in this single handler
// call. Any failure above has already thrown, so the original place is kept.
function swap(ctx, data, args) {
  const check = allowed(rules.evaluate(data, ctx.virtual_now, {action: 'swap', enrollment_id: args.id, section_ids: args.section_ids}));
  const source = data.enrollments.find(e => e.id === check.source.id);
  source.status = 'swapped_out';
  source.ended_at = ctx.virtual_now;
  const {id, section_ids} = addEnrollment(ctx, data, check);
  const cancelled_entry_ids = queue.cancelPendingSwaps(ctx, data, source, 'source_swapped', 'you swapped out of the enrollment it would have replaced');
  const receipt_id = receipt(ctx, data, 'enrollment.swap', args,
    {course_id: check.course.id, enrollment_id: id, replaced_enrollment_id: source.id, section_ids, cancelled_entry_ids});
  queue.recheck(ctx, data);
  return {id, replaced_id: source.id, receipt_id, course_id: check.course.id, section_ids, cancelled_entry_ids, credits: creditsAfter(check)};
}

// Joining again for the same bundle returns the entry that is already there:
// its sequence, and so its rank, does not change.
function join(ctx, data, args) {
  const check = queue.evaluateJoin(data, ctx.virtual_now, args);
  if (check.failures.length) rules.reject(check.failures);
  let entry = check.existing;
  if (!entry) {
    const {id, seq} = ledger.allocate(data, 'wl');
    entry = {id, seq, occupant_ref: data.student.id, course_id: check.course.id, section_ids: check.sections.map(s => s.id),
      swap_from_enrollment_id: check.source ? check.source.id : null, status: 'queued', joined_at: ctx.virtual_now,
      ended_at: null, end_reason: null, blocked_reason: null};
    data.waitlist_entries.push(entry);
  }
  const receipt_id = receipt(ctx, data, 'waitlist.join', args, {course_id: entry.course_id, entry_id: entry.id, section_ids: entry.section_ids.slice(),
    existing: Boolean(check.existing), ...(entry.swap_from_enrollment_id ? {enrollment_id: entry.swap_from_enrollment_id} : {})});
  queue.recheck(ctx, data);
  const view = views.entryView(data, ctx.virtual_now, entry);
  return {id: entry.id, receipt_id, course_id: entry.course_id, section_ids: entry.section_ids.slice(),
    swap_from_enrollment_id: entry.swap_from_enrollment_id, existing: Boolean(check.existing), rank: view.rank,
    waiting_for_section_ids: view.waiting_for_section_ids, blocked_by: view.blocked_by};
}

// Leaving drops the entry, and with it a pending swap and any offer. The
// enrollment a pending swap would have replaced is not touched.
function leave(ctx, data, args) {
  const entry = data.waitlist_entries.find(e => e.id === args.id && queue.own(data, e));
  if (!entry) fail('not_found', 'Waitlist entry ' + args.id + ' does not exist in this account.');
  if (!queue.waiting(entry)) fail('invalid_state', 'Waitlist entry ' + entry.id + ' has already left the queue (' + entry.status + ').');
  const offer = queue.liveOffer(data, entry);
  if (offer) queue.endOffer(offer, 'cancelled', ctx.virtual_now);
  queue.endEntry(entry, 'left', ctx.virtual_now);
  const receipt_id = receipt(ctx, data, 'waitlist.leave', args, {course_id: entry.course_id, entry_id: entry.id, section_ids: entry.section_ids.slice(),
    ...(offer ? {offer_id: offer.id} : {}), ...(entry.swap_from_enrollment_id ? {enrollment_id: entry.swap_from_enrollment_id} : {})});
  queue.recheck(ctx, data);
  return {id: entry.id, receipt_id, course_id: entry.course_id, section_ids: entry.section_ids.slice(), cancelled_offer_id: offer ? offer.id : null};
}

// Everything is checked again at acceptance. On any failure the throw rolls the
// whole call back: the original enrollment and a still-live offer both remain.
function accept(ctx, data, args) {
  const check = allowed(queue.evaluateOffer(data, ctx.virtual_now, args.id));
  const {offer, entry} = check;
  const {enrollment, replaced} = queue.fulfil(ctx, data, entry, offer);
  const receipt_id = receipt(ctx, data, 'offer.accept', args, {course_id: entry.course_id, enrollment_id: enrollment.id, entry_id: entry.id,
    offer_id: offer.id, section_ids: enrollment.section_ids.slice(), ...(replaced ? {replaced_enrollment_id: replaced.id} : {})});
  queue.recheck(ctx, data);
  return {id: enrollment.id, receipt_id, offer_id: offer.id, entry_id: entry.id, course_id: entry.course_id,
    section_ids: enrollment.section_ids.slice(), replaced_id: replaced ? replaced.id : null, credits: creditsAfter(check)};
}

// Declining closes the offer, releases its seats and takes the entry out of
// the queue. Like accepting, it answers the offer, so it has the same
// deadline: from expires_at on, the offer waits for offers.expire. Leaving the
// waitlist is not an answer to the offer and stays possible.
function decline(ctx, data, args) {
  const {offer, entry} = ownOffer(data, args.id);
  if (offer.status !== 'live') fail('offer_not_live', 'Offer ' + offer.id + ' is no longer open (' + offer.status + ').');
  if (queue.expired(offer, ctx.virtual_now)) {
    fail('offer_expired', 'Offer ' + offer.id + ' expired at ' + offer.expires_at + ' and can no longer be declined. It is closed when its expiry is processed; '
      + 'leaving waitlist entry ' + entry.id + ' releases its seat now.');
  }
  queue.endOffer(offer, 'declined', ctx.virtual_now);
  queue.endEntry(entry, 'declined', ctx.virtual_now);
  const receipt_id = receipt(ctx, data, 'offer.decline', args, {course_id: entry.course_id, entry_id: entry.id, offer_id: offer.id,
    section_ids: entry.section_ids.slice(), ...(entry.swap_from_enrollment_id ? {enrollment_id: entry.swap_from_enrollment_id} : {})});
  queue.recheck(ctx, data);
  return {id: offer.id, receipt_id, entry_id: entry.id, course_id: entry.course_id, section_ids: entry.section_ids.slice()};
}

const READS = {
  'catalog.search': (ctx, data, args) => views.catalogSearch(data, args),
  'course.get': (ctx, data, args) => views.courseGet(data, args, ctx.virtual_now),
  'record.get': (ctx, data) => views.recordGet(data, ctx.virtual_now),
  'schedule.get': (ctx, data) => views.scheduleGet(data),
  'waitlist.list': (ctx, data) => views.waitlistList(data, ctx.virtual_now),
  'activity.list': (ctx, data) => views.activityList(data),
  'change.preview': (ctx, data, args) => views.changePreview(data, args, ctx.virtual_now)
};
const WRITES = {
  'enrollment.enroll': enroll, 'enrollment.withdraw': withdraw, 'enrollment.swap': swap,
  'waitlist.join': join, 'waitlist.leave': leave, 'offer.accept': accept, 'offer.decline': decline
};

// Reads answer at any time. A write first needs the clock to have reached the
// ledger's latest record; a preview reports the same failure.
function handleTool(ctx, data, name, args) {
  const operation = name.startsWith(APP + '.') ? name.slice(APP.length + 1) : name;
  const read = named(READS, operation), write = named(WRITES, operation);
  if (!read && !write) fail('unknown_tool', 'Unknown University Course Registration operation.');
  if (write) {
    const behind = rules.clockBehind(data, ctx.virtual_now);
    if (behind.length) rules.reject(behind);
  }
  return {data, result: (read || write)(ctx, data, args)};
}

module.exports = {handleTool};
