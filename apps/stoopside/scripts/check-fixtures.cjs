#!/usr/bin/env node
'use strict';
// Fixture checker (proposal section 4, "Synthetic data and assets"). For each
// fixture in fixtures/index.json it confirms:
//   shape            3-4 groups, 60-90 members (20-35% aliased), 25-40 events,
//                    6-10 sheets, 15-25 Mail threads, 12-20 scenario events
//   seed_valid       the seed schema and validateSeed with the fixture's binding
//   unique_ids       IDs unique per collection and across object types; slot
//                    IDs per sheet; emails, person IDs and Mail message IDs
//   ordered_dates    history from 2025-01-01 up to the clock; the clock and
//                    every scenario event from 2026-01-01; revisions, threads
//                    and scenario events in time order; event times consistent
//   coherent_history nobody acts in a group before joining it or after leaving;
//                    events are posted after their group exists and by a member;
//                    RSVPs fall in the RSVP window after the posting; sheet
//                    claims fall between the posting and the lock; swaps trade
//                    slots both sides held
//   capacity         places taken never exceed capacity; guests within the
//                    limit; no waitlisted RSVP would fit; sheet claims within
//                    quantity
//   mail_emails      the mailbox address is the user's member email; every
//                    @example.net address in the Mail seed is a member's email
//   name_links       every aliased member has an agent-visible name link: the
//                    user's member export, a post the user can see, or a Mail
//                    message, using both names
//   stale_default    a group where the user's latest RSVP (the one
//                    rsvps.preview pre-fills) is over 11 months old, with
//                    guests or children, and an upcoming event in that group
//                    the user has not answered
//   scenario_applies every scenario event applies in order through applyEvent
// Run: node scripts/check-fixtures.cjs   (prints one line per fixture; exits 1 on failure)
const fs = require('node:fs');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const R = require('../src/rules.cjs');
const V = require('../src/visibility.cjs');
const {compile} = require('../tests/schema-validator.cjs');

const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const seedValid = compile(read('schemas/seed.schema.json'), path.join(root, 'schemas'));
const ms = s => Date.parse(s);
const HISTORY_FLOOR = ms('2025-01-01T00:00:00Z'), TASK_FLOOR = ms('2026-01-01T00:00:00Z');

// A member is aliased when the first word of their display name and their
// everyday first name are not prefixes of each other ("Wren" for Birdie,
// "Hal" for Harold; "Tom" for Tomasz is not aliased). A search by the
// everyday name then misses them.
const word = s => s.toLowerCase().replace(/[^a-z]/g, '');
function aliased(everyday, display) {
  const a = word(everyday.split(/\s+/)[0]), b = word(display.split(/\s+/)[0]);
  return !(a.startsWith(b) || b.startsWith(a));
}
const hasWord = (text, w) => new RegExp('(^|[^A-Za-z])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^A-Za-z]|$)', 'i').test(text);

function months(t, n) {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());
}

function checkFixture(fx) {
  const out = [];
  const add = (name, problems) => out.push({name, pass: problems.length === 0, problems: problems.slice(0, 10)});
  const {data, binding, mail, scenario, clock} = fx;
  const now = ms(clock), user = data.user_member_id;
  const everyday = new Map(binding.people.map(p => [p.person_id, p.name]));
  const nameOf = m => everyday.get(m.person_id);
  const aliasedMembers = data.members.filter(m => aliased(nameOf(m), m.display_name));

  // shape
  {
    const p = [], threads = new Set(mail.messages.map(m => m.thread_id)).size, share = aliasedMembers.length / data.members.length;
    const within = (what, n, lo, hi) => { if (n < lo || n > hi) p.push(`${what} ${n} not in ${lo}-${hi}`); };
    within('groups', data.groups.length, 3, 4);
    within('members', data.members.length, 60, 90);
    within('events', data.events.length, 25, 40);
    within('sheets', data.sheets.length, 6, 10);
    within('Mail threads', threads, 15, 25);
    within('scenario events', scenario.length, 12, 20);
    if (share < 0.2 || share > 0.35) p.push(`aliased share ${share.toFixed(2)} not in 0.20-0.35`);
    add('shape', p);
  }

  // seed_valid
  {
    const p = [];
    if (!seedValid(data)) p.push('seed schema');
    try { plugin.validateSeed({app_id: 'stoopside', binding}, data); } catch (e) { p.push(e.message); }
    if (!binding.accounts.some(a => a.app_id === 'mail' && a.account_id === mail.account_id && a.owner_person_id === mail.owner_person_id)) p.push('Mail account is not in the binding');
    if (mail.owner_person_id !== data.owner_person_id) p.push('Mail owner differs from the Stoopside owner');
    add('seed_valid', p);
  }

  // unique_ids
  {
    const p = [];
    const dup = (what, ids) => { const seen = new Set(); for (const id of ids) { if (seen.has(id)) p.push(`duplicate ${what} ${id}`); seen.add(id); } };
    for (const k of ['groups', 'members', 'memberships', 'events', 'rsvps', 'posts', 'sheets', 'swaps', 'deliveries', 'digests']) dup(k, data[k].map(x => x.id));
    dup('object', [...data.groups, ...data.events, ...data.posts, ...data.sheets].map(x => x.id));
    for (const s of data.sheets) dup(`slot in ${s.id}`, s.slots.map(x => x.id));
    dup('email', data.members.map(m => m.email.toLowerCase()));
    dup('person', data.members.map(m => m.person_id));
    dup('binding person', binding.people.map(x => x.person_id));
    dup('Mail message', mail.messages.map(m => m.id));
    dup('scenario event', scenario.map(e => e.event_id));
    dup('commit sequence', [...data.memberships, ...data.events, ...data.rsvps, ...data.posts, ...data.sheets].flatMap(x => x.revisions.map(v => v.seq)).concat(data.deliveries.map(d => d.seq)));
    add('unique_ids', p);
  }

  // ordered_dates
  {
    const p = [];
    const history = (what, t) => { if (!(ms(t) >= HISTORY_FLOOR && ms(t) <= now)) p.push(`${what} ${t} outside 2025-01-01..clock`); };
    if (!(now >= TASK_FLOOR)) p.push('clock before 2026-01-01');
    for (const k of ['groups', 'members', 'memberships', 'events', 'rsvps', 'posts']) for (const x of data[k]) history(`${k} ${x.id} created_at`, x.created_at);
    for (const x of [...data.memberships, ...data.events, ...data.rsvps, ...data.posts, ...data.sheets]) {
      let prev = -Infinity, prevSeq = -1;
      for (const v of x.revisions) {
        history(`${x.id} revision`, v.at);
        if (ms(v.at) < prev || v.seq <= prevSeq) p.push(`${x.id} revisions out of order`);
        prev = ms(v.at); prevSeq = v.seq;
      }
      if (x.created_at && x.revisions.length && ms(x.revisions[0].at) < ms(x.created_at)) p.push(`${x.id} revised before it was created`);
    }
    for (const d of data.deliveries) history(`delivery ${d.id}`, d.at);
    for (const w of data.swaps) { history(`swap ${w.id}`, w.proposed_at); if (w.decided_at) history(`swap ${w.id} decided`, w.decided_at); }
    for (const e of data.events) {
      if (!(ms(e.created_at) <= ms(e.rsvp_open) + 7 * 86400000 && ms(e.rsvp_open) < ms(e.rsvp_close) && ms(e.rsvp_close) <= ms(e.end) && ms(e.start) < ms(e.end))) p.push(`event ${e.id} times`);
    }
    for (const s of data.sheets) if (ms(s.lock_at) > ms(R.event(data, s.event_id).end)) p.push(`sheet ${s.id} locks after its event`);
    // Every seq-ordered row is also time-ordered.
    const rows = [...data.memberships, ...data.events, ...data.rsvps, ...data.posts, ...data.sheets].flatMap(x => x.revisions).concat(data.deliveries).sort((a, b) => a.seq - b.seq);
    for (let i = 1; i < rows.length; i++) if (ms(rows[i].at) < ms(rows[i - 1].at)) { p.push(`commit ${rows[i].seq} is earlier than commit ${rows[i - 1].seq}`); break; }
    for (const m of mail.messages) history(`Mail ${m.id}`, m.received_at);
    const threads = new Map();
    for (const m of mail.messages) threads.set(m.thread_id, [...(threads.get(m.thread_id) || []), m]);
    for (const [id, list] of threads) for (let i = 1; i < list.length; i++) if (ms(list[i].received_at) < ms(list[i - 1].received_at)) p.push(`thread ${id} out of order`);
    let prev = now;
    for (const e of scenario) {
      if (!(ms(e.at) >= TASK_FLOOR)) p.push(`scenario ${e.event_id} before 2026-01-01`);
      if (ms(e.at) < prev) p.push(`scenario ${e.event_id} is out of order or before the clock`);
      prev = ms(e.at);
    }
    add('ordered_dates', p);
  }

  // coherent_history: nobody acts in a group before they joined it or after
  // they left; nothing about an event happens before it was posted or before
  // its group existed; claims fall between the posting and the lock.
  {
    const p = [];
    const group = new Map(data.groups.map(g => [g.id, g])), event = new Map(data.events.map(e => [e.id, e]));
    const member = new Map(data.members.map(m => [m.id, m])), post = new Map(data.posts.map(x => [x.id, x]));
    const ships = new Map(data.memberships.map(m => [m.group_id + '|' + m.member_id, m]));
    // State of the membership at instant t, from its revisions.
    const inGroup = (g, m, t) => {
      const row = ships.get(g + '|' + m);
      if (!row) return false;
      let s = null;
      for (const v of row.revisions) if (ms(v.at) <= t) s = v.state;
      return s === 'member';
    };
    const need = (cond, msg) => { if (!cond) p.push(msg); };
    for (const m of data.memberships) {
      need(ms(m.created_at) >= ms(group.get(m.group_id).created_at), `${m.id} joins ${m.group_id} before the group exists`);
      if (member.has(m.member_id)) need(ms(member.get(m.member_id).created_at) <= ms(m.created_at), `${m.member_id} joins ${m.group_id} before the member record exists`);
      need(m.revisions[0].at === m.created_at, `${m.id} first revision is not its creation`);
    }
    for (const e of data.events) {
      const t = ms(e.created_at);
      need(t >= ms(group.get(e.group_id).created_at), `${e.id} is posted before its group exists`);
      need(inGroup(e.group_id, e.created_by, t), `${e.id} is posted by ${e.created_by} before they joined ${e.group_id}`);
      for (const h of e.host_member_ids) need(inGroup(e.group_id, h, Math.min(ms(e.start), now)), `${e.id} host ${h} is not in ${e.group_id} by the start`);
      need(t <= ms(e.rsvp_open), `${e.id} opens RSVPs before it is posted`);
      for (const v of e.revisions.slice(1)) need(ms(v.at) < ms(v.previous?.start || e.start), `${e.id} is changed after it started`);
    }
    for (const r of data.rsvps) {
      const e = event.get(r.event_id);
      for (const v of r.revisions) {
        const t = ms(v.at);
        need(t >= ms(e.created_at), `${r.id} answers ${e.id} before it was posted`);
        need(inGroup(e.group_id, r.member_id, t), `${r.id} by ${r.member_id} at ${v.at} while not a member of ${e.group_id}`);
        if (v.reason === 'rsvp') need(t >= ms(e.rsvp_open) && t < ms(e.rsvp_close), `${r.id} answers ${e.id} outside its RSVP window`);
      }
      const cancel = e.revisions.find(v => v.action === 'cancelled');
      if (cancel) need(r.revisions.every(v => ms(v.at) <= ms(cancel.at)), `${r.id} answers ${e.id} after it was cancelled`);
    }
    for (const x of data.posts) {
      const t = ms(x.created_at);
      need(t >= ms(group.get(x.group_id).created_at), `${x.id} is posted before its group exists`);
      need(inGroup(x.group_id, x.author_member_id, t), `${x.id} by ${x.author_member_id} while not a member of ${x.group_id}`);
      if (x.parent_id && post.has(x.parent_id)) need(t > ms(post.get(x.parent_id).created_at), `${x.id} replies before its parent`);
      if (x.event_id && event.has(x.event_id)) need(t >= ms(event.get(x.event_id).created_at), `${x.id} mentions ${x.event_id} before it was posted`);
      for (const v of x.revisions.slice(1)) need(ms(v.at) > t, `${x.id} is revised at its creation`);
    }
    for (const s of data.sheets) {
      const e = event.get(s.event_id);
      for (const v of s.revisions) {
        const t = ms(v.at);
        need(t >= ms(e.created_at), `${s.id} ${v.action} by ${v.member_id} before ${e.id} was posted`);
        need(t <= ms(s.lock_at), `${s.id} ${v.action} after the sheet locked`);
        need(inGroup(e.group_id, v.member_id, t), `${s.id} ${v.action} by ${v.member_id} while not a member of ${e.group_id}`);
      }
    }
    for (const w of data.swaps) {
      const s = data.sheets.find(x => x.id === w.sheet_id), e = event.get(s.event_id);
      need(ms(w.proposed_at) >= ms(e.created_at), `${w.id} is proposed before ${e.id} was posted`);
      const claimed = (m, slot) => s.revisions.some(v => v.action === 'claim' && v.member_id === m && v.slot_id === slot && ms(v.at) <= ms(w.proposed_at));
      need(claimed(w.from_member_id, w.give_slot), `${w.id} gives ${w.give_slot}, which ${w.from_member_id} had not claimed`);
      need(claimed(w.to_member_id, w.want_slot), `${w.id} wants ${w.want_slot}, which ${w.to_member_id} had not claimed`);
      if (w.decided_at) need(ms(w.decided_at) > ms(w.proposed_at), `${w.id} is decided before it was proposed`);
    }
    for (const d of data.deliveries) {
      const x = d.object_type === 'post' ? post.get(d.object_id) : null;
      if (x) need(ms(d.at) >= ms(x.created_at), `${d.id} delivers ${x.id} before it was posted`);
    }
    add('coherent_history', p);
  }

  // capacity
  {
    const p = [];
    for (const e of data.events) {
      const taken = R.taken(data, e);
      if (taken > e.capacity) p.push(`${e.id} takes ${taken} of ${e.capacity}`);
      const rs = data.rsvps.filter(r => r.event_id === e.id);
      for (const r of rs) {
        if (r.guests > e.guest_limit && r.answer !== 'no') p.push(`${r.id} has ${r.guests} guests, limit ${e.guest_limit}`);
        if (r.answer === 'no' && (r.guests || r.children) && r.revisions.length === 1) p.push(`${r.id} answers no with counts`);
      }
      const free = e.capacity - taken;
      if (R.eventState(e, now) === 'published' && now < ms(e.rsvp_close)) {
        for (const r of rs.filter(x => x.answer === 'waitlist')) if (R.places(r) <= free) p.push(`${r.id} is waitlisted but ${free} places are free`);
      }
    }
    for (const s of data.sheets) for (const slot of s.slots) if (slot.claims.length > slot.quantity) p.push(`${s.id}/${slot.id} over quantity`);
    add('capacity', p);
  }

  // mail_emails
  {
    const p = [], emails = new Map(data.members.map(m => [m.email.toLowerCase(), m]));
    const me = R.member(data, user);
    if (mail.address !== me.email) p.push(`mailbox ${mail.address} is not the user's member email ${me.email}`);
    for (const m of mail.messages) {
      if (m.account_id !== mail.account_id) p.push(`${m.id} account`);
      for (const a of [m.from, ...m.to]) {
        if (a.endsWith('@example.net') && !emails.has(a.toLowerCase())) p.push(`${m.id}: ${a} is not a member email`);
        if (!a.endsWith('@example.net') && !a.endsWith('.example.org')) p.push(`${m.id}: ${a} uses an unexpected domain`);
      }
      if (m.folder === 'sent' ? m.from !== mail.address : !m.to.includes(mail.address)) p.push(`${m.id} is not to or from the user`);
    }
    add('mail_emails', p);
  }

  // name_links
  {
    const p = [], world = V.currentWorld(data);
    const exportGroups = data.memberships.filter(m => m.member_id === user && m.state === 'member' && R.rank(m.role) >= R.rank('co_organizer')).map(m => m.group_id);
    const visiblePosts = data.posts.filter(x => V.canSee(world, user, {type: 'post', id: x.id}));
    for (const m of aliasedMembers) {
      const first = nameOf(m).split(/\s+/)[0], shown = m.display_name.split(/\s+/)[0];
      const both = text => hasWord(text, first) && hasWord(text, shown);
      const viaExport = exportGroups.some(g => R.isMember(data, g, m.id)) && m.email.startsWith(word(first) + '.');
      const viaPost = visiblePosts.some(x => both(x.text));
      const viaMail = mail.messages.some(x => both(x.subject + '\n' + x.body));
      if (!viaExport && !viaPost && !viaMail) p.push(`${m.id} (${m.display_name}) has no name link`);
    }
    add('name_links', p);
  }

  // stale_default
  {
    const cutoff = months(now, 11), hits = [];
    for (const g of data.groups) {
      if (!R.isMember(data, g.id, user)) continue;
      const latest = R.latestRsvpInGroup(data, g.id, user);
      if (!latest || ms(latest.updated_at) >= cutoff || latest.guests + latest.children === 0) continue;
      const open = data.events.filter(e => e.group_id === g.id && ms(e.start) > now && ms(e.rsvp_close) > now && !R.rsvpFor(data, e.id, user));
      if (open.length) hits.push(`${g.id}: ${latest.id} from ${latest.updated_at.slice(0, 10)} pre-fills guests ${latest.guests}, children ${latest.children} for ${open.map(e => e.id).join(', ')}`);
    }
    out.push({name: 'stale_default', pass: hits.length > 0, problems: hits.length ? [] : ['no stale default RSVP'], found: hits});
  }

  // scenario_applies
  {
    const p = [];
    let state = structuredClone(data);
    for (const e of scenario) {
      try {
        state = plugin.applyEvent({app_id: 'stoopside', role: 'infra', virtual_now: e.at, binding}, structuredClone(state), structuredClone(e));
        plugin.validateSeed({app_id: 'stoopside', binding}, state);
      } catch (err) { p.push(`${e.event_id}: ${err.code || ''} ${err.message}`); break; }
    }
    add('scenario_applies', p);
  }
  return {key: fx.key, aliased: aliasedMembers.length, members: data.members.length, checks: out};
}

function loadFixtures() {
  return read('fixtures/index.json').fixtures.map(f => ({key: f.key, clock: f.clock, data: read(f.seed), binding: read(f.binding), mail: read(f.mail_seed), scenario: read(f.scenario), files: f}));
}

module.exports = {checkFixture, loadFixtures, aliased};
if (require.main === module) {
  let ok = true;
  for (const fx of loadFixtures()) {
    const r = checkFixture(fx);
    const failed = r.checks.filter(c => !c.pass);
    ok = ok && !failed.length;
    console.log(`${r.key}: ${r.checks.length - failed.length}/${r.checks.length} checks pass (${r.aliased} of ${r.members} members aliased)` +
      (failed.length ? '\n  ' + failed.map(c => c.name + ': ' + c.problems.join('; ')).join('\n  ') : ''));
    for (const c of r.checks.filter(x => x.found)) for (const f of c.found) console.log(`  stale default ${f}`);
  }
  if (!ok) process.exitCode = 1;
}
