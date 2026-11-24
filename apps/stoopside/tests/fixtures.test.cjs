'use strict';
// M2 checks over every fixture: the fixture checker, (f) visibility invariants
// after each fixture's example scenario, and (g) hidden values.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {fixture} = require('./harness.cjs');
const {checkFixture, loadFixtures, aliased} = require('../scripts/check-fixtures.cjs');
const VIS = require('../src/visibility.cjs');
const R = require('../src/rules.cjs');
const plugin = require('../plugin.cjs');

const FIXTURES = loadFixtures();
const open = fx => fixture({seed: fx.data, binding: fx.binding, now: fx.clock, logging: false});

// ---- Fixture checker -------------------------------------------------------------

for (const fx of FIXTURES) {
  test(`fixture checker: ${fx.key} passes every check`, () => {
    const r = checkFixture(fx);
    for (const c of r.checks) assert.ok(c.pass, `${fx.key} ${c.name}: ${c.problems.join('; ')}`);
    assert.deepEqual(r.checks.map(c => c.name), ['shape', 'seed_valid', 'unique_ids', 'ordered_dates', 'capacity', 'mail_emails', 'name_links', 'stale_default', 'scenario_applies']);
  });
}

test('fixture checker: each check catches a broken copy of the fixture', () => {
  const fx = FIXTURES[1];
  const broken = (fn, name) => {
    const copy = structuredClone(fx);
    fn(copy);
    const c = checkFixture(copy).checks.find(x => x.name === name);
    assert.equal(c.pass, false, name);
  };
  broken(f => { f.data.posts[3].id = f.data.posts[2].id; }, 'unique_ids');
  broken(f => { f.data.events.find(e => e.id === 'e-0203').capacity = 5; }, 'capacity');
  broken(f => { f.data.events.find(e => e.id === 'e-0203').capacity = 13; }, 'capacity');   // a waitlisted RSVP would now fit
  broken(f => { f.mail.messages[0].from = 'someone.else@example.net'; }, 'mail_emails');
  broken(f => { f.mail.address = 'nadia@example.org'; }, 'mail_emails');
  broken(f => { f.mail.messages = f.mail.messages.filter(m => !/Kwabena/.test(m.body)); }, 'name_links');
  broken(f => { f.scenario[3].at = '2026-04-01T09:00:00-06:00'; }, 'ordered_dates');
  broken(f => { f.data.posts[0].created_at = '2024-12-30T09:00:00-06:00'; }, 'ordered_dates');
  broken(f => { for (const r of f.data.rsvps) if (r.member_id === 'm-001') { r.guests = 0; r.children = 0; r.revisions.at(-1).guests = 0; r.revisions.at(-1).children = 0; } }, 'stale_default');
  broken(f => { f.scenario[0].payload.member_id = 'm-999'; }, 'scenario_applies');
  broken(f => { f.data.members = f.data.members.slice(0, 50); }, 'shape');
  assert.equal(aliased('Birdie Adeyemi', 'Wren Adeyemi'), true);
  assert.equal(aliased('Tomasz Nowak', 'Tom N.'), false);
  assert.equal(aliased('Harold Brennan', 'Hal B.'), true);
});

test('fixture and example dates on every fixture: history from 2025-01-01, clock and scenario events from 2026-01-01', () => {
  const floor = Date.parse('2025-01-01T00:00:00Z'), task = Date.parse('2026-01-01T00:00:00Z');
  const stamps = value => [...JSON.stringify(value).matchAll(/\d{4}-\d{2}-\d{2}(T[0-9:.]+(Z|[+-]\d{2}:\d{2}))?/g)].map(m => m[0]);
  for (const fx of FIXTURES) {
    for (const [what, value] of [['seed', fx.data], ['binding', fx.binding], ['Mail seed', fx.mail], ['scenario', fx.scenario]]) {
      for (const s of stamps(value)) assert.ok(Date.parse(s.length === 10 ? s + 'T00:00:00Z' : s) >= floor, `${fx.key} ${what}: ${s} is before 2025-01-01`);
    }
    assert.ok(Date.parse(fx.clock) >= task, `${fx.key} clock`);
    for (const e of fx.scenario) assert.ok(Date.parse(e.at) >= task && Date.parse(e.at) >= Date.parse(fx.clock), `${fx.key} ${e.event_id}`);
    // History covers the start of 2026 (reviewer suggestion): rows in January and February 2026.
    const early = stamps(fx.data).filter(s => s.startsWith('2026-01') || s.startsWith('2026-02'));
    assert.ok(early.length > 20, `${fx.key} has history in early 2026`);
  }
});

// ---- (f) Visibility invariants on every fixture ----------------------------------------

for (const fx of FIXTURES) {
  test(`(f) ${fx.key}: after the scenario, hosts_only stays with hosts, nothing is visible after removal, and the record agrees with canSee now`, () => {
    const f = open(fx);
    for (const e of fx.scenario) f.event(e);
    const data = f.view(), rec = VIS.record(data), world = VIS.currentWorld(data);
    let hostsOnly = 0;
    for (const p of data.posts) {
      const root = R.rootOf(data, p);
      if (root.audience !== 'hosts_only' || root.kind === 'announcement') continue;
      hostsOnly++;
      for (const r of rec.rows.filter(x => x.object_type === 'post' && x.object_id === p.id && x.intervals.length)) {
        const m = data.memberships.find(x => x.group_id === p.group_id && x.member_id === r.member_id);
        // Each interval starts while the member holds a host role (or is an author).
        for (const i of r.intervals) {
          const role = m.revisions.filter(v => v.seq <= i.from_seq).at(-1)?.role;
          assert.ok(R.isGroupHost(role) || [p.author_member_id, root.author_member_id].includes(r.member_id), `${p.id} shown to ${r.member_id}`);
        }
      }
    }
    assert.ok(hostsOnly >= 2, 'the fixture has hosts_only posts');
    const removed = data.memberships.filter(m => m.state === 'removed');
    assert.ok(removed.length >= 2, 'the fixture has removed members');
    for (const m of removed) {
      const at = m.revisions.filter(v => v.state === 'removed').at(-1).seq;
      const objects = new Set([...data.posts, ...data.events].filter(x => x.group_id === m.group_id).map(x => x.id)
        .concat(data.sheets.filter(s => R.event(data, s.event_id).group_id === m.group_id).map(s => s.id)));
      for (const r of rec.rows.filter(x => x.member_id === m.member_id && objects.has(x.object_id))) {
        for (const i of r.intervals) assert.ok(i.to_seq !== null && i.to_seq <= at && i.from_seq < at, `${r.object_id} visible to ${m.member_id} after removal`);
      }
    }
    // The record's open intervals are exactly what canSee answers now.
    const members = data.members.map(m => m.id);
    for (const [type, list] of [['event', data.events], ['post', data.posts], ['sheet', data.sheets]]) {
      for (const x of list) {
        for (const m of members) {
          const row = rec.rows.find(r => r.object_type === type && r.object_id === x.id && r.member_id === m);
          const openNow = Boolean(row && row.intervals.some(i => i.to === null));
          assert.equal(openNow, VIS.canSee(world, m, {type, id: x.id}), `${type} ${x.id} for ${m}`);
        }
      }
    }
  });
}

// ---- (g) Hidden values --------------------------------------------------------------

// Every read tool the Agent has, over every object the user can reach, plus
// view_as for a spread of members, and the three previews.
// Reads go straight to the tool handler on one copy of the state (reads never
// change it); previews go through the harness, which also checks schemas.
function sweep(f, {writes = false} = {}) {
  const out = [], stored = f.data, ctx = {...f.ctx, log: undefined};
  const call = (name, args) => {
    try {
      const tool = 'stoopside.' + name;
      const result = ['rsvps.preview', 'events.preview_change', 'posts.preview'].includes(name) ? f.call(name, args) : plugin.handleTool(ctx, stored, tool, args).result;
      out.push({name, args, result});
    } catch (e) { out.push({name, args, error: e.code, message: e.message}); }
  };
  const data = f.view(), user = data.user_member_id, world = VIS.currentWorld(data);
  call('groups.list', {});
  call('profile.get', {});
  call('help.get', {});
  for (const g of data.groups) {
    call('groups.get', {group_id: g.id});
    if (!R.isMember(data, g.id, user)) continue;
    call('members.search', {group_id: g.id, query: ''});
    call('members.export', {group_id: g.id});
    call('events.list', {group_id: g.id, include_past: true});
    call('posts.list', {group_id: g.id});
  }
  const now = Date.parse(f.ctx.virtual_now);
  const upcoming = data.events.filter(e => VIS.canSee(world, user, {type: 'event', id: e.id}) && Date.parse(e.end) > now - 30 * 86400000);
  for (const e of data.events.filter(x => VIS.canSee(world, user, {type: 'event', id: x.id}))) call('events.get', {event_id: e.id});
  for (const s of data.sheets.filter(x => VIS.canSee(world, user, {type: 'sheet', id: x.id}))) call('signups.get', {sheet_id: s.id});
  const sample = data.members.filter((m, i) => i % 12 === 0 || data.memberships.some(x => x.member_id === m.id && x.state === 'removed')).map(m => m.id);
  const recent = data.posts.filter(p => Date.parse(p.created_at) > now - 60 * 86400000);
  for (const m of sample) {
    for (const ref of [...data.groups.map(g => ['group', g.id]), ...upcoming.map(e => ['event', e.id]), ...data.sheets.map(s => ['sheet', s.id]), ...recent.map(p => ['post', p.id])]) {
      call('visibility.view_as', {member_id: m, object_type: ref[0], object_id: ref[1]});
    }
  }
  if (writes) {
    for (const e of upcoming.filter(x => Date.parse(x.start) > now)) {
      call('rsvps.preview', {event_id: e.id, answer: 'yes'});
      if (e.host_member_ids.includes(user)) call('events.preview_change', {change: 'edit', event_id: e.id, fields: {venue: 'Somewhere else'}, notify: 'guests'});
    }
    for (const g of data.groups.filter(x => R.isMember(data, x.id, user))) call('posts.preview', {group_id: g.id, kind: 'post', audience: 'group', text: 'Hello'});
  }
  return out;
}

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

for (const fx of FIXTURES) {
  test(`(g) ${fx.key}: no pending event payload, person_id, unlisted everyday name or out-of-export email in agent-visible output`, () => {
    const seedText = JSON.stringify(fx.data);
    // Values a pending event would reveal: text and names it introduces.
    const secret = e => ['text', 'display_name', 'venue', 'title', 'description', 'post_id', 'swap_id']
      .map(k => e.payload[k]).filter(v => typeof v === 'string' && v.length >= 6 && !seedText.includes(JSON.stringify(v).slice(1, -1)));
    const people = fx.binding.people;
    const unlisted = fx.data.members.map(m => ({m, name: people.find(p => p.person_id === m.person_id).name}))
      .filter(x => x.name.toLowerCase() !== x.m.display_name.toLowerCase());
    const f = open(fx);
    // Sweep before the scenario (every event pending), halfway, and at the end.
    const points = [0, Math.floor(fx.scenario.length / 2), fx.scenario.length];
    let applied = 0, calls = 0, pendingSeen = 0;
    for (const stop of points) {
      while (applied < stop) f.event(fx.scenario[applied++]);
      const outputs = sweep(f, {writes: stop === 0});
      calls += outputs.length;
      const pending = fx.scenario.slice(applied).flatMap(secret);
      pendingSeen += pending.length;
      for (const o of outputs) {
        const text = JSON.stringify(o);
        assert.doesNotMatch(text, /person-/, `${o.name} shows a person ID`);
        for (const p of people) assert.ok(!text.includes(p.person_id), `${o.name} shows ${p.person_id}`);
        for (const u of unlisted) assert.doesNotMatch(text, new RegExp(escape(u.name), 'i'), `${o.name} shows the everyday name of ${u.m.id}`);
        if (o.name !== 'members.export') assert.doesNotMatch(text, /@example\.(net|org)/, `${o.name} shows an email`);
        for (const v of pending) assert.ok(!text.includes(v), `${o.name} shows pending payload value "${v}"`);
      }
    }
    assert.ok(calls > 300, 'the sweep covers the reachable objects');
    assert.ok(pendingSeen > 10, 'the scenario has pending values to hide');
  });
}

test('(g) no outcome is random and IDs encode no role', () => {
  for (const file of fs.readdirSync(path.join(__dirname, '../src'))) {
    const src = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
    assert.doesNotMatch(src, /Math\.random|Date\.now\(|new Date\(\)|crypto|performance\.now/, `${file} uses a random or wall-clock value`);
  }
  for (const fx of FIXTURES) {
    for (const m of fx.data.members) assert.match(m.id, /^m-\d{3}$/);
    const ids = [...fx.data.groups, ...fx.data.events, ...fx.data.posts, ...fx.data.sheets, ...fx.data.memberships, ...fx.data.rsvps].map(x => x.id).join(' ');
    assert.doesNotMatch(ids, /organizer|host|admin|owner|user|member-/i);
  }
});
