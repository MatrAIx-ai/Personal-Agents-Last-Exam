'use strict';
// Record consistency for seeds, events and every committed write.
const {fail, references} = require('./domain-utils.cjs');
const R = require('./rules.cjs');
const {ms} = require('./clock.cjs');

function unique(list, what, key = x => x.id) {
  const seen = new Set();
  for (const item of list) {
    if (seen.has(key(item))) fail('invalid_seed', `Duplicate ${what} ${key(item)}.`);
    seen.add(key(item));
  }
  return seen;
}

// Revisions are in commit order, never go back in time, and the record's
// current fields equal its latest revision.
function revisions(record, what, fields, seqs, nextSeq) {
  let previousSeq = -1, previousAt = -Infinity;
  for (const v of record.revisions) {
    if (!(v.seq > previousSeq) || ms(v.at) < previousAt) fail('invalid_seed', `${what} ${record.id} revisions are out of order.`);
    if (seqs.has(v.seq) || v.seq >= nextSeq) fail('invalid_seed', `Commit sequence ${v.seq} is reused or not below next_seq.`);
    seqs.add(v.seq);
    previousSeq = v.seq;
    previousAt = ms(v.at);
  }
  const last = record.revisions.at(-1);
  if (!last) fail('invalid_seed', `${what} ${record.id} has no revisions.`);
  for (const [field, key] of fields) {
    if (JSON.stringify(record[field]) !== JSON.stringify(last[key])) fail('invalid_seed', `${what} ${record.id} ${field} does not match its latest revision.`);
  }
}

// A seed is the account's history up to the clock: a load whose clock is
// earlier than any recorded row would show the Agent records from its future
// (posts, RSVPs, members, mail) and is refused. Build an earlier start with
// `node scripts/generate-fixture.cjs --cutoff`, which keeps a coherent prefix.
function historyBefore(ctx, data) {
  if (typeof ctx.virtual_now !== 'string') return;
  const now = ms(ctx.virtual_now);
  const late = (what, id, at) => {
    if (at !== null && at !== undefined && ms(at) > now) {
      fail('invalid_seed', `The clock ${ctx.virtual_now} is earlier than the seed's history: ${what} ${id} is dated ${at}. Load the seed at or after its last record, or build a cut-off with scripts/generate-fixture.cjs --cutoff.`);
    }
  };
  for (const g of data.groups) late('group', g.id, g.created_at);
  for (const m of data.members) late('member', m.id, m.created_at);
  for (const [what, list] of [['membership', data.memberships], ['event', data.events], ['RSVP', data.rsvps], ['post', data.posts], ['sheet', data.sheets]]) {
    for (const x of list) {
      late(what, x.id, x.created_at);
      for (const v of x.revisions) late(what, x.id, v.at);
    }
  }
  for (const w of data.swaps) { late('swap', w.id, w.proposed_at); late('swap', w.id, w.decided_at); }
  for (const d of data.deliveries) late('delivery', d.id, d.at);
  for (const p of data.previews) late('preview', p.id, p.created_at);
  for (const n of data.notices) late('notice', n.id, n.created_at);
}

function validateSeed(ctx, data) {
  references(ctx, data);
  historyBefore(ctx, data);
  const people = new Set(ctx.binding.people.map(p => p.person_id));
  const seqs = new Set();
  const groups = unique(data.groups, 'group');
  for (const g of data.groups) ms(g.digest_through);
  const members = unique(data.members, 'member');
  unique(data.members.map(m => m.email.toLowerCase()), 'member email', x => x);
  for (const m of data.members) if (!people.has(m.person_id)) fail('invalid_seed', `Member ${m.id} person is not in the binding.`);
  unique(data.members, 'member person', m => m.person_id);
  const user = data.members.find(m => m.id === data.user_member_id);
  if (!user || user.person_id !== data.owner_person_id) fail('invalid_seed', 'The user member must belong to the account owner.');
  unique(data.memberships, 'membership');
  unique(data.memberships, 'membership pair', m => m.group_id + '|' + m.member_id);
  for (const m of data.memberships) {
    if (!groups.has(m.group_id) || !members.has(m.member_id)) fail('invalid_seed', `Membership ${m.id} names an unknown group or member.`);
    revisions(m, 'Membership', [['state', 'state'], ['role', 'role']], seqs, data.next_seq);
  }
  for (const g of data.groups) {
    if (!data.memberships.some(m => m.group_id === g.id && m.state === 'member' && m.role === 'organizer')) fail('invalid_seed', `Group ${g.id} needs an organizer.`);
  }
  const events = unique(data.events, 'event');
  for (const e of data.events) {
    if (!groups.has(e.group_id)) fail('invalid_seed', `Event ${e.id} group is missing.`);
    if (!(ms(e.start) < ms(e.end)) || !(ms(e.rsvp_open) < ms(e.rsvp_close)) || ms(e.rsvp_close) > ms(e.end)) fail('invalid_seed', `Event ${e.id} times are inconsistent.`);
    if (!e.host_member_ids.length || e.host_member_ids.some(id => !members.has(id))) fail('invalid_seed', `Event ${e.id} hosts are missing.`);
    revisions(e, 'Event', [['state', 'state']], seqs, data.next_seq);
    if (e.revisions[0].action !== 'created') fail('invalid_seed', `Event ${e.id} must start with a created revision.`);
  }
  unique(data.rsvps, 'RSVP');
  unique(data.rsvps, 'RSVP pair', r => r.event_id + '|' + r.member_id);
  for (const r of data.rsvps) {
    if (!events.has(r.event_id) || !members.has(r.member_id)) fail('invalid_seed', `RSVP ${r.id} names an unknown event or member.`);
    revisions(r, 'RSVP', [['answer', 'answer'], ['guests', 'guests'], ['children', 'children']], seqs, data.next_seq);
    if ((r.answer === 'offered') !== (r.offer_expires_at !== null) || (r.answer === 'needs_reconfirm') !== (r.reconfirm_by !== null)) {
      fail('invalid_seed', `RSVP ${r.id} due times do not match its answer.`);
    }
    if (['waitlist', 'offered'].includes(r.answer) && r.waitlisted_at === null) fail('invalid_seed', `RSVP ${r.id} needs waitlisted_at.`);
  }
  for (const e of data.events) {
    if (R.taken(data, e) > e.capacity) fail('invalid_seed', `Event ${e.id} has more places taken than its capacity.`);
  }
  const posts = unique(data.posts, 'post');
  for (const p of data.posts) {
    if (!groups.has(p.group_id) || !members.has(p.author_member_id)) fail('invalid_seed', `Post ${p.id} names an unknown group or author.`);
    if (p.event_id !== null && (!events.has(p.event_id) || R.event(data, p.event_id).group_id !== p.group_id)) fail('invalid_seed', `Post ${p.id} event is not in its group.`);
    if (p.parent_id !== null && (!posts.has(p.parent_id) || R.post(data, p.parent_id).group_id !== p.group_id)) fail('invalid_seed', `Post ${p.id} parent is not in its group.`);
    if (p.kind === 'comment' ? p.parent_id === null : p.parent_id !== null) fail('invalid_seed', `Post ${p.id}: only comments have a parent.`);
    if (p.audience === 'event_guests' && R.rootOf(data, p).event_id === null) fail('invalid_seed', `Post ${p.id} event_guests needs an event.`);
    if (p.kind === 'announcement' && p.audience !== 'group') fail('invalid_seed', `Announcement ${p.id} must use the group audience.`);
    revisions(p, 'Post', [['state', 'state']], seqs, data.next_seq);
  }
  unique(data.digests, 'digest');
  for (const d of data.digests) if (!groups.has(d.group_id) || d.post_ids.some(id => !posts.has(id))) fail('invalid_seed', `Digest ${d.id} is inconsistent.`);
  const sheets = unique(data.sheets, 'sheet');
  for (const s of data.sheets) {
    if (!events.has(s.event_id)) fail('invalid_seed', `Sheet ${s.id} event is missing.`);
    unique(s.slots, 'slot');
    for (const slot of s.slots) {
      if (slot.claims.length > slot.quantity || new Set(slot.claims).size !== slot.claims.length || slot.claims.some(id => !members.has(id))) {
        fail('invalid_seed', `Sheet ${s.id} slot ${slot.id} claims are inconsistent.`);
      }
    }
    for (const v of s.revisions) {
      if (seqs.has(v.seq) || v.seq >= data.next_seq) fail('invalid_seed', `Commit sequence ${v.seq} is reused or not below next_seq.`);
      seqs.add(v.seq);
    }
  }
  unique(data.swaps, 'swap');
  for (const w of data.swaps) {
    const s = sheets.has(w.sheet_id) ? R.sheet(data, w.sheet_id) : null;
    if (!s || !s.slots.some(x => x.id === w.give_slot) || !s.slots.some(x => x.id === w.want_slot) || !members.has(w.from_member_id) || !members.has(w.to_member_id)) {
      fail('invalid_seed', `Swap ${w.id} is inconsistent.`);
    }
  }
  unique(data.deliveries, 'delivery');
  for (const d of data.deliveries) {
    if (!members.has(d.recipient_member_id)) fail('invalid_seed', `Delivery ${d.id} recipient is unknown.`);
    if (seqs.has(d.seq) || d.seq >= data.next_seq) fail('invalid_seed', `Commit sequence ${d.seq} is reused or not below next_seq.`);
    seqs.add(d.seq);
  }
  unique(data.previews, 'preview');
  unique(data.notices, 'notice');
}

// Records counted by the dataset declaration: events.
const records = data => data.events;
const objects = data => [...data.groups, ...data.events, ...data.posts, ...data.sheets].map(x => x.id);

module.exports = {validateSeed, records, objects, references: () => [], assetReferences: () => []};
