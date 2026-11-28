'use strict';
// Builds a fixture as it stood at an earlier clock: a coherent prefix of its
// history. Every record created after the cut-off is dropped; every record kept
// loses the revisions after it and takes its fields from the last revision
// kept (an edited event gets its earlier times back from the edit's
// `previous`, a sheet's claims are replayed, a swap decided later is still
// proposed). Mail keeps the messages received by then. Events that start after
// the cut-off are upcoming, so a cut inside the history leaves real work: RSVPs
// still open, sheets not yet locked.
//   node scripts/generate-fixture.cjs --cutoff <fixture> <instant> [--out DIR]
const R = require('../src/rules.cjs');
const {ms, iso, nextMonday8, DAY} = require('../src/clock.cjs');

const upTo = (list, t) => list.filter(v => ms(v.at) <= t);

function replayClaims(sheet, revisions, swaps) {
  const slots = new Map(sheet.slots.map(s => [s.id, []]));
  for (const v of revisions) {
    const claims = slots.get(v.slot_id);
    if (v.action === 'claim') claims.push(v.member_id);
    else if (v.action === 'release') claims.splice(claims.indexOf(v.member_id), 1);
    else if (v.action === 'swap') {
      const w = swaps.find(x => x.id === v.reason);
      const other = v.member_id === w.to_member_id ? w.from_member_id : w.to_member_id;
      claims.splice(claims.indexOf(other), 1, v.member_id);
    } else throw new Error(`sheet ${sheet.id}: unknown revision ${v.action}`);
  }
  return slots;
}

function cut({data, binding, mail}, cutoff) {
  const T = ms(cutoff), d = structuredClone(data);
  const last = x => x.revisions.at(-1);
  // Memberships, members.
  d.memberships = d.memberships.filter(m => ms(m.created_at) <= T).map(m => {
    m.revisions = upTo(m.revisions, T);
    Object.assign(m, {state: last(m).state, role: last(m).role});
    return m;
  }).filter(m => m.revisions.length);
  const active = new Set(d.memberships.map(m => m.member_id));
  d.members = d.members.filter(m => ms(m.created_at) <= T && (active.has(m.id) || m.id === d.user_member_id));
  // Events: drop the unposted, roll back later edits.
  d.events = d.events.filter(e => ms(e.created_at) <= T).map(e => {
    for (const v of e.revisions.filter(x => ms(x.at) > T).reverse()) Object.assign(e, v.previous || {});
    e.revisions = upTo(e.revisions, T);
    e.state = last(e).state;
    return e;
  });
  const events = new Map(d.events.map(e => [e.id, e]));
  // RSVPs: answers given by the cut-off.
  d.rsvps = d.rsvps.filter(r => events.has(r.event_id) && ms(r.created_at) <= T).map(r => {
    const dropped = r.revisions.length;
    r.revisions = upTo(r.revisions, T);
    const v = last(r), e = events.get(r.event_id), off = d.groups.find(g => g.id === e.group_id).utc_offset;
    Object.assign(r, {answer: v.answer, guests: v.guests, children: v.children, updated_at: v.at});
    if (r.revisions.length !== dropped) {
      const since = [...r.revisions].reverse().find((x, i, all) => !['waitlist', 'offered'].includes(all[i + 1]?.answer) && x.answer === 'waitlist');
      r.waitlisted_at = ['waitlist', 'offered'].includes(v.answer) ? (since ? since.at : r.waitlisted_at) : null;
      r.offer_expires_at = v.answer === 'offered' ? iso(R.offerEnds(e, ms(v.at)), off) : null;
      r.reconfirm_by = v.answer === 'needs_reconfirm' ? iso(R.reconfirmEnds(e, ms(v.at)), off) : null;
    }
    return r;
  }).filter(r => r.revisions.length);
  // Posts: published by the cut-off, with the text and state then.
  d.posts = d.posts.filter(p => ms(p.created_at) <= T).map(p => {
    p.revisions = upTo(p.revisions, T);
    Object.assign(p, {state: last(p).state, text: last(p).text, updated_at: last(p).at});
    return p;
  });
  const posts = new Set(d.posts.map(p => p.id));
  d.posts = d.posts.filter(p => (!p.parent_id || posts.has(p.parent_id)) && (!p.event_id || events.has(p.event_id)));
  d.digests = d.digests.filter(x => ms(x.created_at || x.at || cutoff) <= T);
  // Sheets and swaps.
  d.swaps = d.swaps.filter(w => ms(w.proposed_at) <= T).map(w => (w.decided_at && ms(w.decided_at) > T ? {...w, state: 'proposed', decided_at: null} : w));
  d.sheets = d.sheets.filter(s => events.has(s.event_id)).map(s => {
    const kept = upTo(s.revisions, T), slots = replayClaims(s, kept, data.swaps);
    for (const slot of s.slots) slot.claims = slots.get(slot.id);
    s.revisions = kept;
    return s;
  });
  d.swaps = d.swaps.filter(w => d.sheets.some(s => s.id === w.sheet_id));
  d.deliveries = d.deliveries.filter(x => ms(x.at) <= T && posts.has(x.object_id));
  d.previews = d.previews.filter(x => ms(x.created_at) <= T);
  d.notices = d.notices.filter(x => ms(x.created_at) <= T);
  // The digest has run up to the last Monday 08:00 before the cut-off.
  for (const g of d.groups) if (ms(g.digest_through) > T) g.digest_through = iso(nextMonday8(T - 7 * DAY, g.utc_offset, false), g.utc_offset);
  // Commit sequence: the kept rows, renumbered in time order.
  const rows = [...d.memberships, ...d.events, ...d.rsvps, ...d.posts, ...d.sheets].flatMap(x => x.revisions).concat(d.deliveries);
  rows.sort((a, b) => ms(a.at) - ms(b.at) || a.seq - b.seq).forEach((row, i) => { row.seq = i + 1; });
  d.next_seq = rows.length + 1;
  const kept = new Set(d.members.map(m => m.person_id));
  const b = {...structuredClone(binding), people: binding.people.filter(p => kept.has(p.person_id)),
    objects: {groups: d.groups.map(g => g.id), events: d.events.filter(e => ms(e.start) > T).map(e => e.id), sheets: d.sheets.filter(s => ms(s.lock_at) > T).map(s => s.id)}};
  const m = {...structuredClone(mail), messages: mail.messages.filter(x => ms(x.received_at) <= T)};
  return {data: d, binding: b, mail: m};
}

// What the user can still do at the cut-off: events open for RSVPs in their
// groups, unlocked sheets, swaps waiting for their answer.
function actionable(data, cutoff) {
  const T = ms(cutoff), user = data.user_member_id;
  const mine = new Set(data.memberships.filter(m => m.member_id === user && m.state === 'member').map(m => m.group_id));
  return {
    rsvp_open: data.events.filter(e => mine.has(e.group_id) && e.state === 'published' && ms(e.rsvp_open) <= T && T < ms(e.rsvp_close)).map(e => e.id),
    upcoming: data.events.filter(e => mine.has(e.group_id) && ms(e.start) > T).map(e => e.id),
    open_sheets: data.sheets.filter(s => ms(s.lock_at) > T && mine.has(data.events.find(e => e.id === s.event_id).group_id)).map(s => s.id),
    swaps_for_user: data.swaps.filter(w => w.to_member_id === user && w.state === 'proposed' && ms(w.expires_at) > T).map(w => w.id),
  };
}

module.exports = {cut, actionable, replayClaims};
