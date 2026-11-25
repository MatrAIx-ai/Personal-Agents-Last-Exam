#!/usr/bin/env node
'use strict';
// Real MCP checks on the pinned public runtime for what the public verifier does not exercise:
// a task seed with its own virtual_now and image files, items.read returning the stored bytes and
// refused for another parent, time moved with env.advance_time and no App event, failure atomicity
// (several refusals, a rejected event, an all-or-nothing multi-item call), replays of writes and
// of an event that named an album by album_match, stale versions, Agent attempts at Infra
// operations, reset restoring the loaded data, files and time, and the fallback with the
// items.read registration withheld. Core-side parts of T14/T15.
//   node scripts/real-mcp.cjs [--runtime DIR] [--output FILE]
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const locate = require('./locate.cjs');

async function run() {
  const runtime = locate.runtimeDir();
  const {prepare} = require(path.join(runtime, 'prepare.cjs')), {Client} = require(path.join(runtime, 'client.cjs'));
  const prepared = prepare(locate.packageDir), clients = [], checks = [], temp = [];
  const check = (name, cond, detail) => { assert.ok(cond, name + (detail !== undefined ? ': ' + JSON.stringify(detail).slice(0, 600) : '')); checks.push({name, status: 'passed'}); };
  const open = async (role, run = 'fernshelf-mcp', p = prepared, C = Client) => {
    const c = new C('fernshelf', role, run, path.join(p.root, 'state'), 'fernshelf-real-mcp', {registry: p.registry}); clients.push(c); await c.initialize(); return c;
  };
  const same = (a, b) => JSON.stringify(a.snapshot.data) === JSON.stringify(b.snapshot.data) && JSON.stringify(a.version) === JSON.stringify(b.version) &&
    a.snapshot.virtual_now === b.snapshot.virtual_now;
  try {
    const infra = await open('infra'), agent = await open('agent');
    const snap = async () => infra.call('env.snapshot');
    // Authority: the Agent connection lists no Infra operation and cannot call one by name.
    const listed = (await agent.request('tools/list')).result.tools.map(t => t.name);
    check('Agent discovery lists only the 10 fernshelf.* reads in the scenario profile', listed.length === 10 && listed.every(n => n.startsWith('fernshelf.')), listed);
    for (const name of ['env.apply_event', 'env.reset', 'env.advance_time', 'env.load_seed', 'env.snapshot', 'env.event_status', 'env.validate_bundle']) {
      check('Agent calling ' + name + ' is permission_denied', (await agent.call(name, {})).status === 'permission_denied');
    }
    check('A write outside the scenario profile is permission_denied', (await agent.call('fernshelf.albums.create', {title: 'x', request_id: 'p-1', expected_version: {epoch: 1, revision: 0}})).status === 'permission_denied');
    check('Infra connection exposes env.advance_time', (await infra.request('tools/list')).result.tools.some(t => t.name === 'env.advance_time'));
    // A task seed with its own clock and image files, in the sandbox profile.
    let s = await snap();
    check('Sandbox profile selected by Infra reset', (await infra.call('env.reset', {expected_version: s.version, profile: 'sandbox'})).status === 'ready');
    s = await snap();
    const seed = JSON.parse(fs.readFileSync(path.join(locate.packageDir, 'fixtures/reference.json'), 'utf8')), bundle = s.snapshot.resources.bundle;
    const loaded = await infra.call('env.load_seed', {expected_version: s.version, request_id: 'task-seed', data: seed, bundle, virtual_now: '2026-11-20T10:00:00-08:00'});
    check('Infra loads a task seed with virtual_now and 48 image files', loaded.status === 'ready' && loaded.quality.counts.ready_assets === 48, loaded.quality?.counts);
    s = await snap();
    check('Loaded clock and data are the task\'s', s.snapshot.virtual_now === '2026-11-20T10:00:00-08:00' && JSON.stringify(s.snapshot.data) === JSON.stringify(seed));
    const baseline = s;
    // A seed that names a file the bundle lacks is refused (Core answers invalid_bundle), state unchanged.
    const missing = structuredClone(seed); missing.items.find(i => i.id === 'it-2611-0952').file = 'img-not-in-bundle';
    const refusedLoad = await infra.call('env.load_seed', {expected_version: s.version, request_id: 'bad-seed', data: missing, bundle});
    check('A seed referencing a file the bundle lacks is refused', refusedLoad.status === 'invalid_bundle', refusedLoad.status);
    check('The refused load leaves state unchanged', same(await snap(), baseline));
    // items.read: the stored bytes; another item's asset refused by the App.
    const read = await agent.call('fernshelf.items.read', {id: 'it-2611-0931'});
    const entry = bundle.catalog.assets.find(a => a.asset_id === 'img-it-2611-0931');
    check('items.read returns the stored PNG and its catalogued SHA-256', read.status === 'ok' && read.file.sha256 === entry.integrity.sha256 &&
      crypto.createHash('sha256').update(Buffer.from(read.file.base64, 'base64')).digest('hex') === entry.integrity.sha256 && read.file.base64 === bundle.blobs['img-it-2611-0931']);
    check('items.read with another item\'s asset is refused', (await agent.call('fernshelf.items.read', {id: 'it-2611-0931', asset_id: 'img-it-2611-0934'})).status === 'not_found');
    const viaResource = await agent.request('resources/read', {uri: 'pale://fernshelf-mcp/fernshelf/assets/img-it-2611-0934'});
    check('Core resources/read serves an active item\'s file', !viaResource.error && viaResource.result.contents[0].mimeType === 'image/png');
    const trashedFile = seed.items.find(i => i.file && i.state === 'trashed' && Date.parse(i.purge_at) > Date.parse(s.snapshot.virtual_now));
    check('A trashed item\'s file is refused by items.read (in_trash)', (await agent.call('fernshelf.items.read', {id: trashedFile.id})).status === 'in_trash');
    const trashedResource = await agent.request('resources/read', {uri: 'pale://fernshelf-mcp/fernshelf/assets/' + trashedFile.file});
    check('...and by Core resources/read', !!trashedResource.error);
    // Reads: business data byte-identical; Core's audit may grow (one allowed row).
    s = await snap();
    const ex = await agent.call('fernshelf.exposure.get', {id: 'it-2611-0931'});
    let after = await snap();
    check('exposure.get lists Reunion 2026 with 4 joined members and ln-0012', ex.albums.length === 1 && ex.albums[0].visible_to.length === 4 && ex.albums[0].links[0].link_id === 'ln-0012');
    check('Read leaves business data byte-identical', JSON.stringify(after.snapshot.data) === JSON.stringify(s.snapshot.data));
    check('Read leaves the version unchanged while the audit grows by one row', JSON.stringify(after.version) === JSON.stringify(s.version) && after.snapshot.audit.length === s.snapshot.audit.length + 1);
    // A committed write, its replay and a conflicting reuse; a stale version.
    const seededRows = s.snapshot.data.activity.length, args = {title: 'For Dana', request_id: 'create-1', expected_version: s.version};
    const w = await agent.call('fernshelf.albums.create', args);
    check('albums.create commits with the next revision', w.status === 'committed' && w.version.revision === s.version.revision + 1 && w.state === 'private', w);
    s = await snap();
    check('One activity row for the committed write, after the seeded history', s.snapshot.data.activity.length === seededRows + 1 && s.snapshot.data.activity.at(-1).request_id === 'create-1' &&
      s.snapshot.data.activity.at(-1).seq === s.snapshot.data.activity.at(-2).seq + 1);
    const replay = await agent.call('fernshelf.albums.create', args);
    after = await snap();
    check('Exact replay returns the stored receipt marked duplicate and creates nothing', replay.duplicate === true && replay.id === w.id && same(after, s), replay);
    check('Same request_id with different input is idempotency_conflict', (await agent.call('fernshelf.albums.create', {...args, title: 'Other'})).status === 'idempotency_conflict');
    check('Stale expected_version is stale_version', (await agent.call('fernshelf.albums.create', {...args, request_id: 'create-2'})).status === 'stale_version');
    // Failure atomicity on real Core: refusals after reading several records leave data and version unchanged.
    const refusals = [
      ['fernshelf.albums.update', {id: w.id, add_ids: ['it-2611-0931', 'it-2611-0934', trashedFile.id]}, 'in_trash'],
      ['fernshelf.albums.delete', {id: 'al-reunion-2026'}, 'confirm_required'],
      ['fernshelf.items.trash', {ids: ['it-2611-0931', 'it-2611-0934', 'ct-omar-0007']}, 'not_yours'],
      ['fernshelf.items.purge', {ids: [trashedFile.id, 'it-2611-0931'], confirm: true}, 'invalid_state'],
      ['fernshelf.removals.respond', {id: 'rr-0001', decision: 'honor'}, 'invalid_state']];
    for (const [name, a, code] of refusals) {
      s = await snap();
      const r = await agent.call(name, {...a, request_id: 'refused-' + name, expected_version: s.version});
      after = await snap();
      check(name + ' refused with ' + code + ', nothing changed, one denial audit row', r.status === code && same(after, s) &&
        after.snapshot.audit.at(-1).decision === 'deny' && after.snapshot.audit.at(-1).reason === code, r);
    }
    // A rejected event: data, version and clock unchanged.
    s = await snap();
    const badEvent = await infra.call('env.apply_event', {expected_version: s.version, event: {event_id: 'ev-bad-1', at: '2026-11-20T10:30:00-08:00', operation: 'fernshelf.share.viewed',
      payload: {view_id: 'vw-bad', surface: {type: 'link', id: 'ln-0003'}, viewer: {anonymous: true}, viewed_item_ids: 'all'}}});
    after = await snap();
    check('A view of a revoked link is invalid_event and changes nothing, not even the clock', badEvent.status === 'invalid_event' && same(after, s), badEvent);
    // An all-or-nothing multi-item write that commits in one revision.
    s = await snap();
    const added = await agent.call('fernshelf.albums.update', {id: w.id, add_ids: ['it-2611-0931', 'it-2611-0942'], request_id: 'add-1', expected_version: s.version});
    check('A multi-item update commits in one revision', added.status === 'committed' && added.version.revision === s.version.revision + 1 && added.item_ids.length === 2);
    // An event that names the album made in the run by album_match; its replay keeps the first resolution.
    s = await snap();
    await agent.call('fernshelf.albums.members.invite', {id: w.id, person_id: 'person-dana', role: 'viewer', request_id: 'inv-1', expected_version: s.version});
    s = await snap();
    const join = {event_id: 'ev-fs-412', at: '2026-11-20T10:40:00-08:00', operation: 'fernshelf.member.changed', payload: {album_match: {person_id: 'person-dana'}, person_id: 'person-dana', change: 'join'}};
    const j1 = await infra.call('env.apply_event', {expected_version: s.version, event: join});
    s = await snap();
    const row = s.snapshot.data.activity.find(a => a.event_id === 'ev-fs-412');
    check('member.changed by album_match joins Dana in the album made in the run', j1.status === 'committed' && row.details.album_id === w.id &&
      s.snapshot.data.albums.find(a => a.id === w.id).members[0].status === 'joined');
    const second = await agent.call('fernshelf.albums.create', {title: 'Also for Dana', request_id: 'create-3', expected_version: s.version});
    s = await snap();
    await agent.call('fernshelf.albums.members.invite', {id: second.id, person_id: 'person-dana', role: 'viewer', request_id: 'inv-2', expected_version: s.version});
    s = await snap();
    const j2 = await infra.call('env.apply_event', {expected_version: s.version, event: join});
    after = await snap();
    check('Replaying the event returns the stored receipt and resolves nothing again', j2.duplicate === true && j2.event_id === 'ev-fs-412' && same(after, s) &&
      after.snapshot.data.albums.find(a => a.id === second.id).members[0].status === 'invited');
    check('env.event_status returns the first application\'s receipt', (await infra.call('env.event_status', {event_id: 'ev-fs-412'})).receipt.status === 'committed');
    check('The same event ID with other content is idempotency_conflict',
      (await infra.call('env.apply_event', {expected_version: s.version, event: {...join, payload: {...join.payload, change: 'decline'}}})).status === 'idempotency_conflict');
    check('An event dated before the App clock is invalid_event',
      (await infra.call('env.apply_event', {expected_version: s.version, event: {event_id: 'ev-old', at: '2026-11-20T09:00:00-08:00', operation: 'fernshelf.backup.resumed', payload: {}}})).status === 'invalid_event');
    // Time moved with env.advance_time and no App event.
    s = await snap();
    const storage0 = (await agent.call('fernshelf.storage.summary', {})).storage;
    const adv = await infra.call('env.advance_time', {request_id: 'clock-1', expected_version: s.version, virtual_now: '2027-01-01T09:00:00-08:00'});
    after = await snap();
    check('advance_time commits and changes no business data', adv.status === 'committed' && adv.advanced === true && JSON.stringify(after.snapshot.data) === JSON.stringify(s.snapshot.data));
    check('advance_time writes one audit row with the clock and no activity row', after.snapshot.audit.at(-1).clock?.to === '2027-01-01T09:00:00-08:00' &&
      after.snapshot.data.activity.length === s.snapshot.data.activity.length);
    const storage1 = (await agent.call('fernshelf.storage.summary', {})).storage;
    const purgedBytes = seed.items.filter(i => i.state === 'trashed' && i.backed_up && Date.parse(i.purge_at) > Date.parse('2026-11-20T10:00:00-08:00')).reduce((n, i) => n + i.declared_bytes, 0);
    check('storage.summary drops by the bytes of items whose purge_at passed', storage1.used_bytes === storage0.used_bytes - purgedBytes && storage1.trash_bytes === 0, [storage0.used_bytes, storage1.used_bytes, purgedBytes]);
    check('items.read of such an item is gone', (await agent.call('fernshelf.items.read', {id: trashedFile.id})).status === 'gone');
    const ex2 = await agent.call('fernshelf.exposure.get', {id: 'it-2611-0931'});
    check('exposure.get no longer lists the expired link ln-0012', ex2.albums.every(a => a.links.every(l => l.link_id !== 'ln-0012')));
    check('A view of the expired link is rejected', (await infra.call('env.apply_event', {expected_version: after.version, event: {event_id: 'ev-late', at: '2027-01-01T10:00:00-08:00',
      operation: 'fernshelf.share.viewed', payload: {view_id: 'vw-late', surface: {type: 'link', id: 'ln-0012'}, viewer: {anonymous: true}, viewed_item_ids: 'all'}}})).status === 'invalid_event');
    check('A retried clock request returns its receipt', (await infra.call('env.advance_time', {request_id: 'clock-1', expected_version: s.version, virtual_now: '2027-01-01T09:00:00-08:00'})).duplicate === true);
    // The next commit drops the stored file reference; reads are unchanged.
    const readBefore = await agent.call('fernshelf.items.get', {id: trashedFile.id});
    s = await snap();
    await agent.call('fernshelf.albums.create', {title: 'Next', request_id: 'create-4', expected_version: s.version});
    s = await snap();
    const readAfter = await agent.call('fernshelf.items.get', {id: trashedFile.id});
    check('The next commit stores the purge and drops the file reference; items.get reads the same', s.snapshot.data.items.find(i => i.id === trashedFile.id).file === null &&
      JSON.stringify(readAfter.item) === JSON.stringify(readBefore.item));
    // Reset restores the loaded seed, its files and its time.
    const reset = await infra.call('env.reset', {expected_version: s.version});
    after = await snap();
    check('Reset restores the loaded data and time', reset.status === 'ready' && JSON.stringify(after.snapshot.data) === JSON.stringify(seed) && after.snapshot.virtual_now === '2026-11-20T10:00:00-08:00');
    check('Reset restores the files: the trashed item reads in_trash again and an active one returns its bytes',
      (await agent.call('fernshelf.items.read', {id: trashedFile.id})).status === 'in_trash' && (await agent.call('fernshelf.items.read', {id: 'it-2611-0934'})).status === 'ok');
    check('Reset clears receipts: the old request ID can be used again', (await agent.call('fernshelf.albums.create', {...args, expected_version: after.version})).duplicate === undefined);
    // A separate run keeps the package seed.
    const other = await open('infra', 'fernshelf-other');
    check('A separate run keeps the package seed', JSON.stringify((await other.call('env.snapshot')).snapshot.data) === JSON.stringify(seed));
    // A task policy restricts items.get to one item: Core refuses the bytes of another parent.
    const pinfra = await open('infra', 'fernshelf-policy'), pagent = await open('agent', 'fernshelf-policy');
    const policies = JSON.parse(fs.readFileSync(path.join(locate.packageDir, 'fixtures/policies.json'), 'utf8'));
    policies.sandbox.constraints = {'fernshelf.items.get': {ids: ['it-2611-0934']}};
    let ps = await pinfra.call('env.snapshot');
    await pinfra.call('env.reset', {expected_version: ps.version, profile: 'sandbox'});
    ps = await pinfra.call('env.snapshot');
    check('Infra loads a task policy with an object constraint', (await pinfra.call('env.load_seed', {expected_version: ps.version, request_id: 'seed-policy', data: seed, bundle, policies, binding: ps.snapshot.binding})).status === 'ready');
    check('items.read of the allowed parent returns bytes', (await pagent.call('fernshelf.items.read', {id: 'it-2611-0934'})).status === 'ok');
    check('items.read of another parent is refused by Core (not_available)', (await pagent.call('fernshelf.items.read', {id: 'it-2611-0931'})).status === 'not_available');
    check('items.get outside the policy is permission_denied', (await pagent.call('fernshelf.items.get', {id: 'it-2611-0931'})).status === 'permission_denied');
    // Fallback: the same package on a runtime without runtime/registrations/fernshelf.json.
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'fernshelf-noreg-'));
    temp.push(copy);
    fs.cpSync(runtime, path.join(copy, 'runtime'), {recursive: true});
    fs.rmSync(path.join(copy, 'runtime/registrations/fernshelf.json'), {force: true});
    const noReg = require(path.join(copy, 'runtime/prepare.cjs')).prepare(locate.packageDir);
    temp.push(noReg.root);
    const NoRegClient = require(path.join(copy, 'runtime/client.cjs')).Client;
    const ninfra = await open('infra', 'fernshelf-noreg', noReg, NoRegClient);
    let ns = await ninfra.call('env.snapshot');
    await ninfra.call('env.reset', {expected_version: ns.version, profile: 'sandbox'});
    const nagent = await open('agent', 'fernshelf-noreg', noReg, NoRegClient);
    check('Without the registration, items.read is refused by Core (not_available)', (await nagent.call('fernshelf.items.read', {id: 'it-2611-0931'})).status === 'not_available');
    check('...and every other workflow still works (exposure.get, albums.create)', (await nagent.call('fernshelf.exposure.get', {id: 'it-2611-0931'})).status === 'ok' &&
      (await nagent.call('fernshelf.albums.create', {title: 'x', request_id: 'nr-1', expected_version: (await ninfra.call('env.snapshot')).version})).status === 'committed');
    ns = await ninfra.call('env.snapshot');
    const metadataOnly = JSON.parse(fs.readFileSync(path.join(locate.packageDir, 'fixtures/policies.metadata-only.json'), 'utf8'));
    check('Infra loads the metadata-only policies', (await ninfra.call('env.load_seed', {expected_version: ns.version, request_id: 'seed-meta', data: seed, bundle, policies: metadataOnly, binding: ns.snapshot.binding})).status === 'ready');
    const nagent2 = await open('agent', 'fernshelf-noreg', noReg, NoRegClient);
    const tools2 = (await nagent2.request('tools/list')).result.tools.map(t => t.name);
    check('With the metadata-only policies, items.read is withheld from discovery and refused', tools2.length === 22 && !tools2.includes('fernshelf.items.read') &&
      (await nagent2.call('fernshelf.items.read', {id: 'it-2611-0931'})).status === 'permission_denied');
    return {schema: 'fernshelf.real-mcp.v1', passed: true, runtime_version: JSON.parse(fs.readFileSync(path.join(runtime, 'package.json'), 'utf8')).version,
      core_api_version: prepared.model.registry.api, node: process.version, checks};
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
    for (const dir of temp) fs.rmSync(dir, {recursive: true, force: true});
  }
}
module.exports = {run};
if (require.main === module) {
  run().then(report => {
    const text = JSON.stringify(report, null, 2) + '\n', out = locate.option('output');
    if (out) { fs.mkdirSync(path.dirname(out), {recursive: true}); fs.writeFileSync(out, text); }
    console.log(text); console.log('PASS: ' + report.checks.length + ' Fernshelf real-MCP checks.');
  }).catch(e => { console.error(e); process.exitCode = 1; });
}
