'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fixture } = require('./harness.cjs');
const S = require('./seeds.cjs');
const plugin = require('../plugin.cjs');
const { compile } = require('./schema-validator.cjs');
const binding = require('../fixtures/binding.json');

const P = 'larkfield-health.';
const T0 = '2026-11-18T12:00:00-05:00';
const eventValid = compile(require('../schemas/events.schema.json'), path.join(__dirname, '..', 'schemas'));
const helpers = S.edit(structuredClone(binding), b => b.people.push({ person_id: 'p-7', name: 'Outside Helper' }));
let n = 0;
const ev = (f, operation, payload, at = f.ctx.virtual_now) => f.event({ event_id: 'e15-' + (++n), at, operation, payload });
const ok = (f, token, by) => ev(f, 'user.confirmed', { token, confirmed_by: by || f.data().owner_person_id });
const tick = f => assert.equal(ok(f, 'tok-7c1e').status, 'committed');
const change = (f, args) => f.call(P + 'grants.change.preview', args);
function settle(f, args) { const pv = change(f, args); assert.equal(pv.status, 'ok', JSON.stringify(pv)); ok(f, pv.preview.token); const out = f.call(P + 'grants.change.confirm', { ...args, token: pv.preview.token }); assert.equal(out.status, 'committed', JSON.stringify(out)); return out.grant; }
const grant = (f, id) => f.data().grants.find(g => g.grant_id === id);
const active = (o = {}) => ({ grant_id: 'gr-2', member_id: 'm-2', grantor_id: 'm-2', grantee_id: 'm-1', scope: 'act', expires_at: null, status: 'active', ...o });
function holder(seed, person, b = binding) {
  const s = structuredClone(seed), bb = structuredClone(b);
  s.account_id = 'larkfield-' + person; s.owner_person_id = person;
  bb.accounts = [{ app_id: 'larkfield-health', account_id: s.account_id, owner_person_id: person }];
  return { seed: s, binding: bb };
}
const ctxAt = (now, b = binding) => ({ app_id: 'larkfield-health', run_id: 'unit', role: 'agent', virtual_now: now, binding: structuredClone(b) });
function reopen(f) {
  const data = JSON.parse(JSON.stringify(f.data()));
  for (const later of [f.ctx.virtual_now, new Date(Date.parse(f.ctx.virtual_now) + 400 * 86400000).toISOString()]) assert.doesNotThrow(() => plugin.validateSeed(ctxAt(later, f.ctx.binding), data), later);
}

test('T15 grants.change: a new grant on a pair, an update of its scope or expiry with the same ID, an unchanged request refused, a revocation, and a regrant after it ended', () => {
  const f = fixture({ seed: S.base(), binding: helpers });
  const args = { action: 'grant', member_id: 'm-1', grantee_id: 'm-2', scope: 'view' };
  const pv = change(f, args);
  assert.match(pv.preview.token, /^tok-grant-pair-m-1-[0-9a-f]{32}$/);
  assert.deepEqual([pv.preview.required_confirmer, pv.preview.changes], ['m-1', { grant_id: null, before: null, after: { scope: 'view', expires_at: null, state: 'active' } }]);
  ok(f, pv.preview.token);
  const g1 = f.call(P + 'grants.change.confirm', { ...args, token: pv.preview.token }).grant;
  assert.deepEqual(g1, { grant_id: 'gr-1', grant_version: 0, member_id: 'm-1', grantor_id: 'm-1', grantee_id: 'm-2', scope: 'view', created_at: T0, expires_at: null, revoked_at: null, state: 'active' });
  f.advance(1);
  const up = change(f, { ...args, scope: 'act', expires_at: '2027-01-01T05:00:00Z' });
  assert.match(up.preview.token, /^tok-grant-grant-gr-1-[0-9a-f]{32}$/);
  assert.deepEqual(up.preview.changes, { grant_id: 'gr-1', before: { scope: 'view', expires_at: null, state: 'active' }, after: { scope: 'act', expires_at: '2027-01-01T00:00:00-05:00', state: 'active' } });
  const g2 = settle(f, { ...args, scope: 'act', expires_at: '2027-01-01T05:00:00Z' });
  assert.deepEqual([g2.grant_id, g2.grant_version, g2.scope, g2.expires_at, g2.created_at], ['gr-1', 1, 'act', '2027-01-01T00:00:00-05:00', T0]);
  assert.deepEqual(change(f, { ...args, scope: 'act', expires_at: '2027-01-01T00:00:00-05:00' }), { status: 'invalid_state', message: 'Grant gr-1 already gives this access with this expiry.' });
  assert.equal(settle(f, { ...args, scope: 'act' }).expires_at, null);
  assert.equal(grant(f, 'gr-1').grant_version, 2);
  assert.deepEqual(change(f, { ...args, expires_at: f.ctx.virtual_now }), { status: 'invalid_state', message: 'The expiry ' + f.ctx.virtual_now + ' is not after the current time.' });
  assert.equal(change(f, { ...args, expires_at: new Date(Date.parse(f.ctx.virtual_now) + 1).toISOString() }).status, 'ok');
  const rv = change(f, { action: 'revoke', grant_id: 'gr-1' });
  assert.deepEqual(rv.preview.changes, { grant_id: 'gr-1', before: { scope: 'act', expires_at: null, state: 'active' }, after: { scope: 'act', expires_at: null, state: 'revoked' } });
  assert.match(rv.preview.token, /^tok-revoke-grant-gr-1-[0-9a-f]{32}$/);
  const g3 = settle(f, { action: 'revoke', grant_id: 'gr-1' });
  assert.deepEqual([g3.state, g3.revoked_at, g3.grant_version, grant(f, 'gr-1').status], ['revoked', '2026-11-18T12:01:00-05:00', 3, 'revoked']);
  assert.deepEqual(change(f, { action: 'revoke', grant_id: 'gr-1' }), { status: 'invalid_state', message: 'Grant gr-1 has already ended (revoked).' });
  f.advance(1);
  const again = settle(f, args);
  assert.deepEqual([again.grant_id, again.grant_version, again.state], ['gr-2', 0, 'active']);
  const minor = settle(f, { action: 'grant', member_id: 'm-3', grantee_id: 'p-7', scope: 'view', expires_at: '2026-12-01T00:00:00-05:00' });
  assert.deepEqual([minor.grant_id, minor.grantor_id], ['gr-3', 'm-1']);
  f.setNow('2026-12-01T00:00:00-05:00');
  assert.deepEqual(change(f, { action: 'revoke', grant_id: 'gr-3' }), { status: 'invalid_state', message: 'Grant gr-3 has already ended (expired).' });
  assert.equal(change(f, { action: 'grant', member_id: 'm-3', grantee_id: 'p-7', scope: 'act' }).preview.changes.grant_id, null);
  reopen(f);
});

test('T15 local grant IDs skip an event-supplied gr-2: the next local grant is gr-1 and the one after gr-3', () => {
  const f = fixture({ seed: S.base(), binding: helpers });
  assert.equal(ev(f, 'grant.changed', active({ grant_id: 'gr-2', member_id: 'm-1', grantor_id: 'm-1', grantee_id: 'm-2', scope: 'view' })).status, 'committed');
  assert.equal(f.data().issued.gr, undefined);
  assert.equal(settle(f, { action: 'grant', member_id: 'm-1', grantee_id: 'p-7', scope: 'view' }).grant_id, 'gr-1');
  assert.equal(settle(f, { action: 'grant', member_id: 'm-3', grantee_id: 'p-7', scope: 'act' }).grant_id, 'gr-3');
  assert.deepEqual([f.data().issued.gr, f.data().grants.map(g => g.grant_id)], ['3', ['gr-2', 'gr-1', 'gr-3']]);
  reopen(f);
});

test('T15 grant changes need the member or a guardian: a view or act grantee is refused, and a guardian grants for the minor', () => {
  const act = fixture({ seed: S.granted(S.base(), 'm-2', 'act') });
  for (const args of [{ action: 'grant', member_id: 'm-2', grantee_id: 'm-3', scope: 'view' }, { action: 'revoke', grant_id: 'gr-h1' }]) assert.equal(change(act, args).status, 'not_authorized', JSON.stringify(args));
  const m2 = fixture(holder(S.granted(S.base(), 'm-2', 'act'), 'm-2'));
  assert.equal(settle(m2, { action: 'revoke', grant_id: 'gr-h1' }).state, 'revoked');
  assert.equal(settle(m2, { action: 'grant', member_id: 'm-3', grantee_id: 'm-1', scope: 'act' }).grantor_id, 'm-2');
  reopen(m2);
});

test('T15 grant.changed creates with the full payload, updates scope and expiry, clears an expiry with null, and refuses changed parties, past expiries and a second live grant', () => {
  const f = fixture({ seed: S.base(), binding: helpers });
  ev(f, 'grant.changed', active());
  assert.deepEqual(grant(f, 'gr-2'), { grant_id: 'gr-2', grant_version: 0, member_id: 'm-2', grantor_id: 'm-2', grantee_id: 'm-1', scope: 'act', created_at: T0, expires_at: null, status: 'active', revoked_at: null });
  ev(f, 'grant.changed', active({ scope: 'view' }));
  ev(f, 'grant.changed', active({ scope: 'view', expires_at: '2027-01-01T05:00:00Z' }));
  assert.deepEqual([grant(f, 'gr-2').scope, grant(f, 'gr-2').expires_at, grant(f, 'gr-2').grant_version], ['view', '2027-01-01T00:00:00-05:00', 2]);
  const before = f.data();
  assert.equal(ev(f, 'grant.changed', active({ scope: 'view', expires_at: '2027-01-01T00:00:00-05:00' })).status, 'committed');
  assert.deepEqual(f.data().grants, before.grants);
  ev(f, 'grant.changed', active({ scope: 'view', expires_at: null }));
  assert.deepEqual([grant(f, 'gr-2').expires_at, grant(f, 'gr-2').grant_version], [null, 3]);
  const now = f.data();
  for (const [payload, why] of [
    [active({ grantee_id: 'm-3' }), 'Grant gr-2 has grantee_id m-1; an event cannot change it.'], [active({ member_id: 'm-1', grantor_id: 'm-1', grantee_id: 'p-7' }), 'Grant gr-2 has member_id m-2; an event cannot change it.'], [active({ grantor_id: 'm-1' }), 'Grantor m-1 may not grant access to m-2.'],
    [active({ expires_at: T0 }), 'The expiry ' + T0 + ' is not after the event time.'], [active({ expires_at: '2026-11-18T11:59:59-05:00' }), 'The expiry 2026-11-18T11:59:59-05:00 is not after the event time.'],
    [active({ grant_id: 'gr-9' }), 'Grant gr-2 is already live for m-2 and m-1; update it instead.'], [active({ grant_id: 'gr-9', grantee_id: 'm-2' }), 'A member cannot be their own grantee.'],
    [active({ grant_id: 'gr-9', grantor_id: 'm-1', grantee_id: 'p-7' }), 'Grantor m-1 may not grant access to m-2.'], [active({ grant_id: 'gr-9', member_id: 'm-3', grantor_id: 'm-3', grantee_id: 'p-7' }), 'Grantor m-3 may not grant access to m-3.'],
  ]) assert.deepEqual(ev(f, 'grant.changed', payload), { status: 'invalid_event', message: why }, JSON.stringify(payload));
  assert.deepEqual(f.data(), now);
  assert.equal(ev(f, 'grant.changed', active({ grant_id: 'gr-9', member_id: 'm-3', grantor_id: 'm-2', grantee_id: 'p-7', scope: 'view', expires_at: '2026-11-18T12:00:00.001-05:00' })).status, 'committed');
  assert.ok(!eventValid({ event_id: 'x', at: T0, operation: 'grant.changed', payload: { grant_id: 'gr-2', member_id: 'm-2', grantor_id: 'm-2', grantee_id: 'm-1', scope: 'act', status: 'active' } }));
  reopen(f);
});

test('T15 grant.changed keeps the stored grantor: an update naming the minor\'s other guardian is invalid_event', () => {
  const f = fixture({ seed: S.granted(S.base(), 'm-3', 'view', null, 'm-2') });
  assert.equal(grant(f, 'gr-h1').grantor_id, 'm-1');
  const before = f.data();
  assert.deepEqual(ev(f, 'grant.changed', { grant_id: 'gr-h1', member_id: 'm-3', grantor_id: 'm-2', grantee_id: 'm-2', scope: 'act', expires_at: null, status: 'active' }), { status: 'invalid_event', message: 'Grant gr-h1 has grantor_id m-1; an event cannot change it.' });
  assert.deepEqual(f.data(), before);
});

test('T15 expiries are stored in the plan\'s local spelling and compared as instants: a new grant given in UTC stores local time; a seeded UTC expiry equals the same local instant in a preview and in grant.changed', () => {
  const f = fixture({ seed: S.base() });
  const out = settle(f, { action: 'grant', member_id: 'm-1', grantee_id: 'm-2', scope: 'view', expires_at: '2027-01-01T05:00:00Z' });
  assert.deepEqual([out.expires_at, grant(f, 'gr-1').expires_at], ['2027-01-01T00:00:00-05:00', '2027-01-01T00:00:00-05:00']);
  const g = fixture({ seed: S.granted(S.base(), 'm-1', 'view', '2027-01-01T05:00:00Z', 'm-2') });
  assert.deepEqual(change(g, { action: 'grant', member_id: 'm-1', grantee_id: 'm-2', scope: 'view', expires_at: '2027-01-01T00:00:00-05:00' }), { status: 'invalid_state', message: 'Grant gr-h1 already gives this access with this expiry.' });
  const before = g.data();
  assert.equal(ev(g, 'grant.changed', { grant_id: 'gr-h1', member_id: 'm-1', grantor_id: 'm-1', grantee_id: 'm-2', scope: 'view', expires_at: '2027-01-01T00:00:00-05:00', status: 'active' }).status, 'committed');
  assert.deepEqual(g.data().grants, before.grants);
});

test('T17 an in-place update token binds the live grant, and a pair token the pair\'s ended grants: a grant.changed expiry after the preview, or an ended grant recreated with other content after a same-seed reset, makes it stale_preview with the approval unused', () => {
  const f = fixture({ seed: S.granted(S.base(), 'm-1', 'view', null, 'm-2') });
  const args = { action: 'grant', member_id: 'm-1', grantee_id: 'm-2', scope: 'act' };
  const pv = change(f, args);
  assert.equal(pv.preview.changes.grant_id, 'gr-h1');
  ok(f, pv.preview.token);
  assert.equal(ev(f, 'grant.changed', { grant_id: 'gr-h1', member_id: 'm-1', grantor_id: 'm-1', grantee_id: 'm-2', scope: 'view', expires_at: '2027-01-01T00:00:00-05:00', status: 'active' }).status, 'committed');
  const before = f.data();
  assert.equal(f.call(P + 'grants.change.confirm', { ...args, token: pv.preview.token }).status, 'stale_preview');
  assert.deepEqual([f.data().grants, f.data().approvals[0].used_at], [before.grants, null]);
  const ended = scope => S.granted(S.base(), 'm-1', scope, '2026-11-10T00:00:00-05:00', 'm-2');
  const pair = { action: 'grant', member_id: 'm-1', grantee_id: 'm-2', scope: 'view' };
  const token = change(fixture({ seed: ended('view') }), pair).preview.token;
  assert.match(token, /^tok-grant-pair-m-1-[0-9a-f]{32}$/);
  const b = fixture({ seed: ended('act') });
  ok(b, token);
  assert.equal(b.call(P + 'grants.change.confirm', { ...pair, token }).status, 'stale_preview');
  assert.deepEqual([b.data().grants, b.data().approvals[0].used_at], [ended('act').grants, null]);
  const c = fixture({ seed: ended('view') });
  ok(c, token);
  assert.equal(c.call(P + 'grants.change.confirm', { ...pair, token }).status, 'committed');
});

test('T15 grant.changed revokes a grant in force, ignores a revocation of an ended one, never reactivates one, and refuses revocation extras that differ from storage', () => {
  const s = S.granted(S.granted(S.base(), 'm-2', 'view', '2026-11-18T12:30:00-05:00'), 'm-3', 'act', null, 'p-7');
  const f = fixture({ seed: s, binding: helpers });
  const before = f.data();
  for (const [extra, why] of [[{ member_id: 'm-3' }, 'Grant gr-h1 has member_id m-2; a revocation cannot change it.'], [{ grantor_id: 'm-1' }, 'Grant gr-h1 has grantor_id m-2; a revocation cannot change it.'], [{ grantee_id: 'p-7' }, 'Grant gr-h1 has grantee_id m-1; a revocation cannot change it.'],
    [{ scope: 'act' }, 'Grant gr-h1 has scope view; a revocation cannot change it.'], [{ expires_at: null }, 'A revocation of grant gr-h1 cannot change its expiry.'], [{ expires_at: '2026-11-18T12:31:00-05:00' }, 'A revocation of grant gr-h1 cannot change its expiry.']]) {
    assert.deepEqual(ev(f, 'grant.changed', { grant_id: 'gr-h1', status: 'revoked', ...extra }), { status: 'invalid_event', message: why });
  }
  assert.deepEqual(f.data(), before);
  ev(f, 'grant.changed', { grant_id: 'gr-h2', member_id: 'm-3', grantor_id: 'm-1', grantee_id: 'p-7', scope: 'act', expires_at: null, status: 'revoked' });
  assert.deepEqual([grant(f, 'gr-h2').status, grant(f, 'gr-h2').revoked_at, grant(f, 'gr-h2').grant_version], ['revoked', T0, 1]);
  const done = f.data();
  ev(f, 'grant.changed', { grant_id: 'gr-h2', status: 'revoked' });
  assert.deepEqual(f.data().grants, done.grants);
  assert.deepEqual(ev(f, 'grant.changed', { grant_id: 'gr-h2', member_id: 'm-3', grantor_id: 'm-1', grantee_id: 'p-7', scope: 'act', expires_at: null, status: 'active' }), { status: 'invalid_event', message: 'Grant gr-h2 has ended (revoked) and is never reactivated; grant again with a new grant_id.' });
  f.setNow('2026-11-18T12:30:00-05:00');
  ev(f, 'grant.changed', { grant_id: 'gr-h1', status: 'revoked', expires_at: '2026-11-18T17:30:00Z' });
  assert.equal(grant(f, 'gr-h1').status, 'active');
  assert.equal(ev(f, 'grant.changed', active({ grant_id: 'gr-h1', scope: 'view' })).message, 'Grant gr-h1 has ended (expired) and is never reactivated; grant again with a new grant_id.');
  assert.equal(ev(f, 'grant.changed', active({ grant_id: 'gr-5', scope: 'view' })).status, 'committed');
  assert.equal(ev(f, 'grant.changed', active({ grant_id: 'gr-6', member_id: 'm-3', grantor_id: 'm-2', grantee_id: 'p-7' })).status, 'committed');
  reopen(f);
});

test('T15 an act grant enables filing and a downgrade to view removes it; a revocation before the confirm is not_authorized and leaves the approval unused', () => {
  const f = fixture({ seed: S.granted(S.deniedPa(), 'm-2', 'act') });
  const file = { target_type: 'pa', target_id: 'pa-3', statement: 'Please review.' };
  const pv = f.call(P + 'appeals.file.preview', file);
  assert.equal(pv.status, 'ok');
  ok(f, pv.preview.token);
  ev(f, 'grant.changed', active({ grant_id: 'gr-h1', scope: 'view' }));
  assert.deepEqual(f.call(P + 'appeals.file.confirm', { ...file, token: pv.preview.token }), { status: 'not_authorized', message: 'The account holder is not authorized to act on this member\'s plan records.' });
  assert.equal(f.call(P + 'pa.get', { pa_id: 'pa-3' }).status, 'ok');
  ev(f, 'grant.changed', active({ grant_id: 'gr-h1', scope: 'act' }));
  ev(f, 'grant.changed', { grant_id: 'gr-h1', status: 'revoked' });
  assert.deepEqual([f.call(P + 'appeals.file.confirm', { ...file, token: pv.preview.token }).status, f.call(P + 'pa.get', { pa_id: 'pa-3' }).status, f.data().approvals[0].used_at, f.data().appeals], ['not_authorized', 'not_authorized', null, []]);
  ev(f, 'grant.changed', active({ grant_id: 'gr-3' }));
  assert.equal(f.call(P + 'appeals.file.confirm', { ...file, token: pv.preview.token }).status, 'committed');
  reopen(f);
});

test('T17 pair tokens: an unrelated grantee\'s change keeps the token; a live grant expiring before the confirm, or a short-lived grant created and expired in between, makes it stale', () => {
  const f = fixture({ seed: S.base(), binding: helpers });
  const args = { action: 'grant', member_id: 'm-1', grantee_id: 'm-2', scope: 'view' };
  const pv = change(f, args);
  ev(f, 'grant.changed', active({ grant_id: 'gr-7', member_id: 'm-1', grantor_id: 'm-1', grantee_id: 'p-7' }));
  ok(f, pv.preview.token);
  assert.equal(f.call(P + 'grants.change.confirm', { ...args, token: pv.preview.token }).status, 'committed');
  const g = fixture({ seed: S.base(), binding: helpers });
  const first = change(g, args);
  ev(g, 'grant.changed', active({ grant_id: 'gr-8', member_id: 'm-1', grantor_id: 'm-1', grantee_id: 'm-2', scope: 'view', expires_at: '2026-11-18T12:10:00-05:00' }));
  g.setNow('2026-11-18T12:15:00-05:00');
  ok(g, first.preview.token);
  assert.equal(g.call(P + 'grants.change.confirm', { ...args, token: first.preview.token }).status, 'stale_preview');
  assert.equal(settle(g, args).grant_id, 'gr-1');
  const h = fixture({ seed: S.granted(S.base(), 'm-1', 'view', '2026-11-18T12:20:00-05:00', 'm-2'), binding: helpers });
  const up = change(h, { ...args, scope: 'act' });
  assert.equal(up.preview.changes.grant_id, 'gr-h1');
  h.setNow('2026-11-18T12:05:00-05:00');
  ok(h, up.preview.token);
  h.setNow('2026-11-18T12:25:00-05:00');
  assert.equal(h.call(P + 'grants.change.confirm', { ...args, scope: 'act', token: up.preview.token }).status, 'stale_preview');
  assert.equal(h.data().approvals[0].used_at, null);
  reopen(h);
});

test('T17 after a same-seed reset, a grant recreated with another expiry makes the old token stale_preview, the approval unused', () => {
  const seed = expires => S.granted(S.base(), 'm-1', 'view', expires, 'm-2');
  const a = fixture({ seed: seed('2027-01-01T00:00:00-05:00') });
  const token = change(a, { action: 'revoke', grant_id: 'gr-h1' }).preview.token;
  const b = fixture({ seed: seed('2027-02-01T00:00:00-05:00') });
  ok(b, token);
  assert.equal(b.call(P + 'grants.change.confirm', { action: 'revoke', grant_id: 'gr-h1', token }).status, 'stale_preview');
  assert.deepEqual([b.data().grants[0].status, b.data().approvals[0].used_at], ['active', null]);
  const c = fixture({ seed: seed('2027-01-01T00:00:00-05:00') });
  ok(c, token);
  assert.equal(c.call(P + 'grants.change.confirm', { action: 'revoke', grant_id: 'gr-h1', token }).status, 'committed');
});

test('T15 access by relation: no grant hides the spouse; view reads but cannot file; act files; a guardian acts for the minor; a caller seeing both adults but not the child gets individual totals only', () => {
  const s = S.deniedPa(S.deniedClaim());
  const none = fixture({ seed: s });
  assert.deepEqual([none.call(P + 'members.list').members.map(m => m.member_id), none.call(P + 'pa.get', { pa_id: 'pa-3' }).status], [['m-1', 'm-3'], 'not_authorized']);
  const view = fixture({ seed: S.granted(structuredClone(s), 'm-2', 'view') });
  const file = { target_type: 'pa', target_id: 'pa-3', statement: 'Please review.' };
  assert.deepEqual([view.call(P + 'pa.get', { pa_id: 'pa-3' }).status, view.call(P + 'appeals.file.preview', file).status], ['ok', 'not_authorized']);
  const act = fixture({ seed: S.granted(structuredClone(s), 'm-2', 'act') });
  assert.equal(act.call(P + 'appeals.file.preview', file).status, 'ok');
  const four = S.edit(S.granted(S.granted(S.ledger([{ member: 'm-1', year: 2025, deductible_cents: 40000 }, { member: 'm-2', year: 2025, deductible_cents: 30000 }, { member: 'm-3', year: 2026, deductible_cents: 20000 }]), 'm-1', 'view', null, 'm-4'), 'm-2', 'view', null, 'm-4'), x => {
    x.members.push({ member_id: 'm-4', name: 'Morgan Hale', relation: 'other', birth_date: '1958-04-02', is_minor: false, guardian_ids: [], enrolled_years: [2025, 2026] });
    for (const y of [2025, 2026]) { x.coverage.push({ member_id: 'm-4', plan_year: y, status: 'unknown', version: 0, attested_at: null }); x.accumulators.push({ member_id: 'm-4', plan_year: y, deductible_cents: 0, oop_cents: 0 }); }
    x.members.find(m => m.member_id === 'm-3').enrolled_years = [2026];
    x.coverage = x.coverage.filter(c => !(c.member_id === 'm-3' && c.plan_year !== 2026));
    x.accumulators = x.accumulators.filter(c => !(c.member_id === 'm-3' && c.plan_year !== 2026));
  });
  const b = S.edit(structuredClone(binding), x => x.people.push({ person_id: 'm-4', name: 'Morgan Hale' }));
  const m4 = fixture(holder(S.finalize(four), 'm-4', b));
  assert.deepEqual(m4.call(P + 'members.list').members.map(m => [m.member_id, m.powers]), [['m-1', ['view']], ['m-2', ['view']], ['m-4', ['self']]]);
  const y26 = m4.call(P + 'plan.get', { plan_year: 2026 });
  assert.deepEqual([y26.members.map(m => [m.member_id, m.deductible_cents]), y26.family], [[['m-1', 0], ['m-2', 0], ['m-4', 0]], null]);
  const y25 = m4.call(P + 'plan.get', { plan_year: 2025 });
  assert.deepEqual([y25.members.map(m => [m.member_id, m.deductible_cents]), y25.family], [[['m-1', 40000], ['m-2', 30000], ['m-4', 0]], { deductible_cents: 70000, oop_cents: 70000 }]);
  const guardian = fixture(holder(S.finalize(structuredClone(four)), 'm-1', b));
  assert.deepEqual(guardian.call(P + 'plan.get', { plan_year: 2026 }).family, null);
  assert.deepEqual(guardian.call(P + 'plan.get', { plan_year: 2026 }).members.map(m => m.member_id), ['m-1', 'm-3']);
});

test('T16 a grant that arrives by grant.changed applies to reads from the event time, and a revocation ends them; a new viewer granted in the event that commits a timer gets no entry for it', () => {
  const s = S.received([S.line('ln-1', 1, 'svc-office-visit', '2026-11-16', 21000)]);
  Object.assign(s.coverage.find(c => c.member_id === 'm-2' && c.plan_year === 2026), { status: 'none', version: 1, attested_at: '2026-02-01T10:00:00-05:00' });
  const f = fixture({ seed: s, binding: helpers });
  assert.equal(f.call(P + 'claims.get', { claim_id: 'cl-2' }).status, 'not_authorized');
  f.setNow('2026-11-21T09:00:00-05:00');
  ev(f, 'grant.changed', active({ grant_id: 'gr-5', scope: 'view' }));
  ev(f, 'grant.changed', active({ grant_id: 'gr-6', grantee_id: 'p-7', scope: 'view' }));
  assert.deepEqual(f.data().notices.map(x => [x.kind, x.recipient_id, x.at]), [['notice.eob_available', 'm-2', '2026-11-20T23:59:00-05:00']]);
  assert.equal(f.call(P + 'claims.get', { claim_id: 'cl-2' }).claim.status, 'processed');
  ev(f, 'grant.changed', { grant_id: 'gr-5', status: 'revoked' });
  assert.deepEqual([f.call(P + 'claims.get', { claim_id: 'cl-2' }).status, f.call(P + 'members.list').members.map(m => m.member_id)], ['not_authorized', ['m-1', 'm-3']]);
  reopen(f);
});

test('T16 a minor\'s own notice goes to the minor alongside both guardians; a viewer revoked before a timer\'s due time gets none, one whose grant expires after it still does', () => {
  const s = S.granted(S.granted(S.paPending(), 'm-3', 'view', null, 'p-7'), 'm-3', 'view', '2026-12-02T08:00:00-05:00', 'm-4');
  const b = S.edit(structuredClone(helpers), x => x.people.push({ person_id: 'm-4', name: 'Morgan Hale' }));
  const f = fixture({ seed: s, binding: b });
  f.setNow('2026-11-30T09:00:00-05:00');
  ev(f, 'grant.changed', { grant_id: 'gr-h1', status: 'revoked' });
  f.setNow('2026-12-02T09:00:00-05:00');
  tick(f);
  assert.deepEqual(f.data().notices.map(x => [x.kind, x.recipient_id, x.at]), ['m-1', 'm-2', 'm-3', 'm-4'].map(r => ['notice.decision_overdue', r, '2026-12-01T23:59:00-05:00']));
  reopen(f);
});
