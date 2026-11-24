'use strict';
// Web smoke test: starts the repository's shared Web Host (runtime/web/server.cjs) for this App on
// a fresh run, opens the session the way the page does (access token, cookie, CSRF token) and
// drives the same HTTP API the page uses. Every write is checked through a separate Agent MCP
// connection to the same run. No npm dependency. Run from the package folder:
//   node --test tests/web-smoke.cjs [--runtime DIR]
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const locate = require('../scripts/locate.cjs');
const runtime = locate.runtimeDir(), {start} = require(path.join(runtime, 'web/server.cjs')), {Client} = require(path.join(runtime, 'client.cjs'));
const pkg = locate.packageDir, registry = path.join(pkg, 'web.registry.json');
const tools = require('../tools.json'), catalog = require('../contribution/assets.catalog.json');

async function open(profile, run) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fernshelf-web-'));
  const host = await start({app: 'fernshelf', registry, run, stateDir, profile});
  const token = new URL(host.accessUrl).hash.slice('#access='.length);
  const res = await fetch(host.url + '/session', {method: 'POST', headers: {Origin: host.url, 'Content-Type': 'application/json'}, body: JSON.stringify({token})});
  assert.equal(res.status, 200, 'session from the access token');
  const {csrf} = await res.json(), cookie = res.headers.get('set-cookie').split(';')[0];
  assert.match(res.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const get = (p, headers = {Cookie: cookie}) => fetch(host.url + p, {headers});
  const post = (p, value, headers = {}) => fetch(host.url + p, {method: 'POST', headers: {Origin: host.url, Cookie: cookie, 'X-Pale-CSRF': csrf, 'Content-Type': 'application/json', ...headers}, body: JSON.stringify(value)});
  const call = async (name, args = {}) => { const r = await post('/api/call', {name, arguments: args}); assert.equal(r.status, 200, name); return r.json(); };
  let mcp = null;
  const independent = async () => { if (!mcp) { mcp = new Client('fernshelf', 'agent', run, stateDir, 'fernshelf-web-smoke-check', {registry}); await mcp.initialize(); } return mcp; };
  const close = async () => { if (mcp) await mcp.close(); await host.close(); fs.rmSync(stateDir, {recursive: true, force: true}); };
  return {host, cookie, csrf, get, post, call, independent, close};
}
// The page sends the version it observed with a write and a fresh request ID (reused on retry).
const write = async (s, name, args, version, request_id = 'web-' + crypto.randomUUID()) => s.call(name, {...args, expected_version: version, request_id});

test('Fernshelf page on the shared Web Host (sandbox profile)', async t => {
  const s = await open('sandbox', 'fernshelf-web-smoke');
  try {
    await t.test('page, controller and shared static files are served', async () => {
      const page = await (await s.get('/')).text(), controller = await (await s.get('/app.js')).text();
      assert.match(page, /<title>Fernshelf · PALE<\/title>/);
      assert.match(page, /<script type="module" src="\/app.js">/);
      assert.equal(controller, fs.readFileSync(path.join(pkg, 'gui/src/app.js'), 'utf8'));
      for (const t of tools) assert.ok(controller.includes("'" + t.name + "'"), 'controller names ' + t.name);
      for (const view of ['Photos', 'Albums', 'Sharing', 'Requests', 'Storage', 'Activity', 'Trash']) assert.ok(controller.includes("'" + view + "'"), view);
      assert.equal((await s.get('/shared/client.js')).status, 200);
      assert.equal((await s.get('/shared/style.css')).status, 200);
      const csp = (await s.get('/')).headers.get('content-security-policy');
      assert.match(csp, /default-src 'self'; script-src 'self'; style-src 'self'/);
      assert.doesNotMatch(controller, /innerHTML|insertAdjacentHTML|outerHTML|eval\(|new Function|document\.write|fetch\(/, 'no markup sinks, code evaluation or remote fetch in the controller');
    });

    await t.test('hidden paths, fixture and state downloads and Infra routes are refused', async () => {
      for (const p of ['/gui/src/app.js', '/gui/src/view.js', '/gui/index.html', '/fixtures/reference.json', '/fixtures/policies.json', '/web.registry.json',
        '/assets/it-2611-0931.png', '/app.json', '/tools.json', '/src/derive.cjs', '/.state/', '/state.json', '/api/snapshot', '/api/infra', '/api/reset',
        '/api/events', '/shared/../server.cjs', '/%2e%2e/app.json']) {
        const r = await s.get(p);
        assert.ok([403, 404].includes(r.status), p + ' -> ' + r.status);
        assert.doesNotMatch(await r.text(), /"initial_data"|"policies"|"items":\[/, p);
      }
      assert.equal((await s.get('/app.js?download=1')).status, 403, 'query strings are refused');
      for (const name of ['env.snapshot', 'env.reset', 'env.load_seed', 'env.apply_event', 'env.advance_time', 'env.event_status', 'env.validate_bundle']) {
        const r = await s.post('/api/call', {name, arguments: {}});
        assert.equal(r.status, 403, name);
        assert.deepEqual(await r.json(), {error: 'Business operation not permitted'});
      }
      assert.equal((await s.post('/api/call', {name: 'fernshelf.account.get', arguments: {}, role: 'infra'})).status, 400, 'no client-selected role');
    });

    await t.test('session and CSRF are required', async () => {
      assert.equal((await s.get('/api/tools', {})).status, 401, 'discovery without the session cookie');
      const anon = await fetch(s.host.url + '/api/call', {method: 'POST', headers: {Origin: s.host.url, 'Content-Type': 'application/json', 'X-Pale-CSRF': s.csrf}, body: JSON.stringify({name: 'fernshelf.account.get', arguments: {}})});
      assert.equal(anon.status, 401, 'call without the session cookie');
      assert.equal((await s.post('/api/call', {name: 'fernshelf.account.get', arguments: {}}, {'X-Pale-CSRF': 'wrong'})).status, 403, 'wrong CSRF token');
      assert.equal((await s.post('/api/call', {name: 'fernshelf.account.get', arguments: {}}, {Origin: 'http://evil.example'})).status, 403, 'cross-origin');
      assert.equal((await s.post('/api/call', {name: 'fernshelf.account.get', arguments: {}}, {'Content-Type': 'text/plain'})).status, 403, 'not JSON');
      const bad = await fetch(s.host.url + '/session', {method: 'POST', headers: {Origin: s.host.url, 'Content-Type': 'application/json'}, body: JSON.stringify({token: 'guess'})});
      assert.equal(bad.status, 403, 'a wrong access token opens no session');
    });

    await t.test('discovery lists only the Agent-visible fernshelf.* tools', async () => {
      const listed = (await (await s.get('/api/tools')).json()).tools.map(x => x.name).sort();
      assert.deepEqual(listed, tools.map(x => x.name).sort());
      assert.ok(listed.every(n => n.startsWith('fernshelf.')));
    });

    await t.test('read views: library, albums, sharing, requests, storage, activity and image bytes', async () => {
      const account = await s.call('fernshelf.account.get');
      assert.equal(account.account.display_name, 'Maya Fenwick');
      const page1 = await s.call('fernshelf.items.search', {limit: 200}), page2 = await s.call('fernshelf.items.search', {limit: 200, cursor: page1.next_cursor});
      assert.equal(page1.rows.length + page2.rows.length, page1.total, 'the Photos view pages through every row');
      const trashed = await s.call('fernshelf.items.search', {limit: 200, state: 'trashed'});
      assert.equal(trashed.total, 16, 'Trash view: 20 seeded, 4 past retention read as purged');
      const albums = await s.call('fernshelf.albums.list');
      assert.equal(albums.albums.length, 12);
      const reunion = await s.call('fernshelf.albums.get', {id: 'al-reunion-2026'});
      assert.equal(reunion.album.members.filter(m => m.status === 'joined').length, 4);
      assert.equal(reunion.album.links[0].id, 'ln-0012');
      const removals = await s.call('fernshelf.removals.list');
      assert.equal(removals.removals.filter(r => r.state === 'pending').length, 2);
      const storage = await s.call('fernshelf.storage.summary');
      assert.equal(storage.storage.used_bytes, 13950000000);
      assert.equal((await s.call('fernshelf.notifications.list')).notifications.length, 18);
      const exposure = await s.call('fernshelf.exposure.get', {id: 'it-2611-0931'});
      assert.deepEqual(exposure.visible_to, ['person-kofi', 'person-omar', 'person-ruth', 'person-theo']);
      const bytes = await s.call('fernshelf.items.read', {id: 'it-2611-0931'});
      const expected = catalog.assets.find(a => a.asset_id === 'img-it-2611-0931');
      assert.equal(bytes.file.mime_type, 'image/png');
      assert.equal(crypto.createHash('sha256').update(Buffer.from(bytes.file.base64, 'base64')).digest('hex'), expected.integrity.sha256);
      assert.equal((await s.call('fernshelf.items.read', {id: 'it-2611-0957'})).status, 'no_file', 'an item without a file gets the placeholder');
    });

    let album, version;
    await t.test('W2: create an album, add items, rename (independent MCP read)', async () => {
      version = (await s.call('fernshelf.account.get')).version;
      const created = await write(s, 'fernshelf.albums.create', {title: 'Web picks'}, version);
      assert.equal(created.status, 'committed');
      album = created.id;
      const added = await write(s, 'fernshelf.albums.update', {id: album, add_ids: ['it-2611-0931', 'it-2611-0943']}, created.version);
      const renamed = await write(s, 'fernshelf.albums.update', {id: album, title: 'Web picks, November'}, added.version);
      version = renamed.version;
      const mcp = await s.independent(), seen = await mcp.call('fernshelf.albums.get', {id: album});
      assert.equal(seen.album.title, 'Web picks, November');
      assert.deepEqual(seen.album.entries.map(e => e.id), ['it-2611-0931', 'it-2611-0943']);
      assert.deepEqual(seen.version, version);
    });

    await t.test('W3: invite, create and revoke a link (independent MCP read)', async () => {
      const invited = await write(s, 'fernshelf.albums.members.invite', {id: album, person_id: 'person-iris', role: 'viewer'}, version);
      assert.equal(invited.member_status, 'invited');
      const link = await write(s, 'fernshelf.links.create', {id: album, expires_at: '2026-12-31T12:00:00-08:00'}, invited.version);
      assert.equal(link.state, 'active');
      const revoked = await write(s, 'fernshelf.links.revoke', {id: link.id}, link.version);
      version = revoked.version;
      const seen = (await (await s.independent()).call('fernshelf.albums.get', {id: album})).album;
      assert.equal(seen.members.find(m => m.person_id === 'person-iris').status, 'invited');
      assert.equal(seen.links.find(l => l.id === link.id).state, 'revoked');
    });

    await t.test('W4: honour a pending removal request (independent MCP read)', async () => {
      const pending = (await s.call('fernshelf.removals.list', {state: 'pending'})).removals.find(r => r.scope.type === 'album');
      const exposure = await s.call('fernshelf.exposure.get', {id: pending.item_ids[0]});
      assert.ok(exposure.albums.some(a => a.album_id === pending.scope.album_id), 'the detail pane shows where it is visible before answering');
      const honored = await write(s, 'fernshelf.removals.respond', {id: pending.id, decision: 'honor', note: 'Taken out from the web page.'}, version);
      assert.equal(honored.state, 'honored');
      assert.ok(Array.isArray(honored.already_seen));
      version = honored.version;
      const mcp = await s.independent();
      assert.equal((await mcp.call('fernshelf.removals.list', {state: 'honored'})).removals.find(r => r.id === pending.id).answers.at(-1).note, 'Taken out from the web page.');
      const album2 = (await mcp.call('fernshelf.albums.get', {id: pending.scope.album_id})).album;
      assert.ok(!album2.entries.some(e => pending.item_ids.includes(e.id)));
    });

    await t.test('W5 and W2: favourite, trash, restore and purge (independent MCP read)', async () => {
      const fav = await write(s, 'fernshelf.items.update', {id: 'it-2611-0943', patch: {favorite: true, caption: '<img src=x onerror=alert(1)> kept as text'}}, version);
      const trashed = await write(s, 'fernshelf.items.trash', {ids: ['it-2611-0943', 'it-2610-0249']}, fav.version);
      const restored = await write(s, 'fernshelf.items.restore', {ids: ['it-2611-0943']}, trashed.version);
      const purged = await write(s, 'fernshelf.items.purge', {ids: ['it-2610-0249'], confirm: true}, restored.version);
      assert.ok(purged.freed_bytes > 0);
      version = purged.version;
      const mcp = await s.independent();
      const item = (await mcp.call('fernshelf.items.get', {id: 'it-2611-0943'})).item;
      assert.equal(item.favorite, true);
      assert.equal(item.caption, '<img src=x onerror=alert(1)> kept as text');
      assert.equal(item.state, 'active');
      assert.equal((await mcp.call('fernshelf.items.get', {id: 'it-2610-0249'})).item.state, 'purged');
      assert.equal((await mcp.call('fernshelf.items.read', {id: 'it-2610-0249'})).status, 'gone');
    });

    await t.test('refusals carry the App code and message', async () => {
      const r1 = await write(s, 'fernshelf.albums.delete', {id: 'al-reunion-2026'}, version);
      assert.equal(r1.status, 'confirm_required');
      assert.match(r1.message, /joined members or an active link/);
      const r2 = await write(s, 'fernshelf.albums.update', {id: album, add_ids: ['it-2611-0931']}, version);
      assert.equal(r2.status, 'already_in_album');
      assert.ok(r2.message.length > 0);
      const after = await (await s.independent()).call('fernshelf.albums.get', {id: 'al-reunion-2026'});
      assert.equal(after.album.deleted_at, null);
      assert.deepEqual(after.version, version, 'refusals change nothing');
    });

    await t.test('a stale form is refused and leaves the concurrent change', async () => {
      const opened = version; // the version the form saw
      const mcp = await s.independent();
      const other = await mcp.call('fernshelf.items.update', {id: 'it-2611-0931', patch: {caption: 'Changed elsewhere'}, expected_version: opened, request_id: 'outside-edit'});
      assert.equal(other.status, 'committed');
      const stale = await write(s, 'fernshelf.items.update', {id: 'it-2611-0931', patch: {caption: 'Changed in the page'}}, opened);
      assert.equal(stale.status, 'stale_version');
      assert.equal((await mcp.call('fernshelf.items.get', {id: 'it-2611-0931'})).item.caption, 'Changed elsewhere');
      version = other.version;
    });

    await t.test('a retry with the same request ID commits once', async () => {
      const id = 'web-' + crypto.randomUUID();
      const first = await write(s, 'fernshelf.albums.create', {title: 'Retried album'}, version, id);
      const again = await write(s, 'fernshelf.albums.create', {title: 'Retried album'}, version, id);
      assert.equal(first.status, 'committed');
      assert.equal(again.id, first.id);
      assert.deepEqual(again.version, first.version);
      const list = (await (await s.independent()).call('fernshelf.albums.list')).albums;
      assert.equal(list.filter(a => a.title === 'Retried album').length, 1);
    });
  } finally { await s.close(); }
});

test('restricted profile: reads only, writes denied by the Host and Core', async () => {
  const s = await open('scenario', 'fernshelf-web-smoke-restricted');
  try {
    const listed = (await (await s.get('/api/tools')).json()).tools.map(x => x.name);
    assert.deepEqual(listed.sort(), tools.filter(x => x.read_only).map(x => x.name).sort());
    const version = (await s.call('fernshelf.account.get')).version;
    for (const name of ['fernshelf.albums.create', 'fernshelf.items.trash', 'fernshelf.removals.respond']) {
      const r = await s.post('/api/call', {name, arguments: {title: 'x', ids: ['it-2611-0931'], id: 'rr-0001', decision: 'honor', expected_version: version, request_id: 'denied-1'}});
      assert.equal(r.status, 403, name);
    }
    // The controller draws write controls only for discovered tools (ui.has).
    const controller = await (await s.get('/app.js')).text();
    assert.match(controller, /\{label:'New album',tool:T\.create/, 'New album is a catalog action; the shared mount draws it only when discovered');
    for (const t of tools.filter(x => !x.read_only && x.name !== 'fernshelf.albums.create')) {
      const key = Object.entries({update: 'items.update', trash: 'items.trash', restore: 'items.restore', purge: 'items.purge', create: 'albums.create', edit: 'albums.update', remove: 'albums.delete', invite: 'albums.members.invite', member: 'albums.members.update', save: 'albums.save_item', link: 'links.create', revoke: 'links.revoke', respond: 'removals.respond'}).find(([, v]) => 'fernshelf.' + v === t.name)[0];
      assert.match(controller, new RegExp('can\\(T\\.' + key + '\\)'), t.name + ' control is gated on discovery');
    }
    assert.equal((await s.call('fernshelf.items.read', {id: 'it-2611-0931'})).status, 'ok', 'image bytes stay readable');
  } finally { await s.close(); }
});
