'use strict';
// Commits time effects that fell due before the current write or event.
// Reads never call this on stored data; they compute the same view on a copy.
//
// Due items are processed one at a time in due-time order, and each is stamped
// with its own due time, not the commit time. An expired waitlist offer passes
// the place on at the expiry instant, so the next member's claim deadline is
// counted from that instant. A single clock jump across several deadlines
// therefore commits the same chain as several small steps would.
const R = require('./rules.cjs');
const {ms, iso, label, nextMonday8, DAY} = require('./clock.cjs');
const {notify, deliver} = require('./notices.cjs');
const {setRsvp, allocate, groupRecipients, groupOf} = require('./transitions.cjs');
const {nextId} = require('./ids.cjs');

const ORDER = {offer_expired: 0, reconfirm_expired: 1, swap_expired: 2, digest: 3};

function dueItems(data, now) {
  const due = [];
  for (const r of data.rsvps) {
    const e = R.event(data, r.event_id);
    if (e.state === 'cancelled') continue;
    if (r.answer === 'offered' && ms(r.offer_expires_at) <= now) due.push({t: ms(r.offer_expires_at), kind: 'offer_expired', id: r.id, r, e});
    if (r.answer === 'needs_reconfirm' && ms(r.reconfirm_by) <= now) due.push({t: ms(r.reconfirm_by), kind: 'reconfirm_expired', id: r.id, r, e});
  }
  for (const w of data.swaps) {
    if (w.state === 'proposed' && ms(w.expires_at) <= now) due.push({t: ms(w.expires_at), kind: 'swap_expired', id: w.id, w});
  }
  for (const g of data.groups) {
    const t = nextMonday8(ms(g.digest_through), g.utc_offset);
    if (t <= now) due.push({t, kind: 'digest', id: g.id, g});
  }
  return due.sort((a, b) => a.t - b.t || ORDER[a.kind] - ORDER[b.kind] || a.id.localeCompare(b.id));
}

function digest(data, g, t) {
  const at = iso(t, g.utc_offset), from = t - R.DIGEST_DAYS * DAY;
  g.digest_through = at;
  const posts = data.posts.filter(p => p.group_id === g.id && p.parent_id === null && p.audience === 'group' &&
    p.state !== 'deleted' && ms(p.created_at) >= from && ms(p.created_at) < t)
    .sort((a, b) => ms(a.created_at) - ms(b.created_at) || a.id.localeCompare(b.id));
  if (!posts.length) return;
  const d = {id: nextId(data.digests, 'dg'), group_id: g.id, due_at: at, post_ids: posts.map(p => p.id)};
  data.digests.push(d);
  const recipients = groupRecipients(data, g.id);
  deliver(data, {at, recipients, object_type: 'digest', object_id: d.id, channel: 'email', reason: 'digest'});
  if (!recipients.includes(data.user_member_id)) return;
  const name = id => R.member(data, id).display_name;
  notify(data, {at, kind: 'digest', object_type: 'digest', object_id: d.id,
    title: `${g.name}: ${posts.length} ${posts.length === 1 ? 'post' : 'posts'} this week`,
    fields: [['Group', g.name], ['Week ending', label(t, g)],
      ...posts.map(p => [`${p.id}`, `${name(p.author_member_id)}: ${p.text.slice(0, 120)}`])]});
}

function settle(ctx, data) {
  const now = ms(ctx.virtual_now);
  for (let guard = 0; guard < 10000; guard++) {
    const item = dueItems(data, now)[0];
    if (!item) return data;
    if (item.kind === 'digest') {
      digest(data, item.g, item.t);
      continue;
    }
    if (item.kind === 'swap_expired') {
      item.w.state = 'expired';
      item.w.decided_at = iso(item.t, groupOf(data, R.event(data, R.sheet(data, item.w.sheet_id).event_id)).utc_offset);
      continue;
    }
    const at = iso(item.t, groupOf(data, item.e).utc_offset);
    setRsvp(data, item.r, at, {answer: item.kind === 'offer_expired' ? 'expired' : 'no'}, item.kind);
    allocate(data, item.e, at);
  }
  throw new Error('settle did not converge');
}

module.exports = {settle, dueItems};
