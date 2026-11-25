'use strict';
// Web smoke test: starts the real shared Web Host (runtime/web/server.cjs) for Bellnote on a fresh run,
// opens the session the way the page does, and checks static serving, refused routes, discovery, read
// views, versioned writes confirmed by an independent MCP client, refusals, stale versions, retries,
// the restricted profile and the session/CSRF boundary. Node 18+ built-ins only; no browser.
//   node --test tests/web-smoke.cjs [--runtime DIR]
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const locate = require('../scripts/locate.cjs');
const runtime = locate.runtimeDir();
const {start} = require(path.join(runtime, 'web/server.cjs')), {Client} = require(path.join(runtime, 'client.cjs'));
const registry = path.join(locate.packageDir, 'web.registry.json');
const WRITES = ['absences.report', 'absences.cancel', 'forms.respond', 'forms.withdraw', 'pickup.person_add', 'pickup.person_remove',
  'dismissal.set', 'dismissal.cancel', 'lunch.topup', 'lunch.settings_update', 'preferences.update'].map(n => 'bellnote.' + n);

async function open(profile, run) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bellnote-web-'));
  const host = await start({app: 'bellnote', registry, run, stateDir, profile});
  const origin = host.url, token = new URL(host.accessUrl).hash.slice('#access='.length);
  const res = await fetch(origin + '/session', {method: 'POST', headers: {Origin: origin, 'Content-Type': 'application/json'}, body: JSON.stringify({token})});
  assert.equal(res.status, 200);
  const {csrf} = await res.json(), cookie = res.headers.get('set-cookie').split(';')[0];
  const s = {host, origin, csrf, cookie, stateDir, token};
  s.get = (p, headers = {Cookie: cookie}) => fetch(origin + p, {headers});
  s.post = (p, body, headers = {}) => fetch(origin + p, {method: 'POST', headers: {Origin: origin, Cookie: cookie, 'X-Pale-CSRF': csrf, 'Content-Type': 'application/json', ...headers}, body: JSON.stringify(body)});
  // What the page's shared client sends: name + arguments; writes add the observed version and a request ID.
  s.call = async (name, args = {}) => { const r = await s.post('/api/call', {name, arguments: args}); assert.equal(r.status, 200, name); return r.json(); };
  s.version = async () => (await s.call('bellnote.preferences.get')).version;
  s.write = async (name, args, version, requestId = 'web-' + crypto.randomUUID()) => s.call(name, {...args, expected_version: version || await s.version(), request_id: requestId});
  s.close = async () => { await host.close(); fs.rmSync(stateDir, {recursive: true, force: true}); };
  return s;
}

test('Bellnote web page on the shared Host: serving, boundary, reads, writes, conflicts and retries', async t => {
  const s = await open('sandbox', 'bellnote-web-smoke');
  const mcp = new Client('bellnote', 'agent', 'bellnote-web-smoke', s.stateDir, 'bellnote-web-smoke-check', {registry});
  try {
    await mcp.initialize();
    await t.test('page, controller and shared files are served', async () => {
      const page = await (await s.get('/')).text(), controller = await (await s.get('/app.js')).text();
      assert.match(page, /<title>Bellnote · PALE<\/title>/);
      assert.match(page, /src="\/app\.js"/);
      for (const view of ['Home', 'Attendance', 'Forms', 'Pickup & dismissal', 'Lunch', 'Notifications', 'Account']) assert.ok(controller.includes("'" + view + "'"), view);
      for (const tool of WRITES) assert.ok(controller.includes("'" + tool + "'"), tool);
      assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML|eval\(|new Function|fetch\(/.test(controller), 'controller renders text only and makes no requests of its own');
      // Business data lives only in the current view's reads: no module-level cache that outlives a refresh, and no
      // dependence on the Host's toolbar markup to learn when one happens.
      assert.ok(!/^(const|let|var) [\w$]+ *= *new (Weak)?(Map|Set)\(|\.toolbar button/m.test(controller), 'controller keeps no read results between refreshes');
      for (const p of ['/shared/client.js', '/shared/style.css']) assert.equal((await s.get(p)).status, 200, p);
    });
    await t.test('hidden paths, fixtures, state and Infra routes are refused', async () => {
      for (const p of ['/gui/index.html', '/gui/src/view.js', '/fixtures/reference.json', '/app.json', '/tools.json', '/src/model.cjs', '/web.registry.json',
        '/%2e%2e/fixtures/reference.json', '/.state', '/api/snapshot', '/api/infra', '/api/reset', '/api/events']) {
        const r = await s.get(p);
        assert.ok([403, 404].includes(r.status), p + ' -> ' + r.status);
      }
      for (const name of ['env.snapshot', 'env.reset', 'env.apply_event', 'env.load_seed', 'env.advance_time', 'env.event_status']) {
        const r = await s.post('/api/call', {name, arguments: {}});
        assert.equal(r.status, 403, name);
      }
      assert.equal((await s.post('/api/call', {name: 'bellnote.children.list', arguments: {}, role: 'infra'})).status, 400, 'no client-selected role');
    });
    await t.test('the session and CSRF token are required', async () => {
      assert.equal((await s.get('/api/tools', {})).status, 401);
      assert.equal((await fetch(s.origin + '/session', {method: 'POST', headers: {Origin: s.origin, 'Content-Type': 'application/json'}, body: JSON.stringify({token: 'nope'})})).status, 403);
      assert.equal((await s.post('/api/call', {name: 'bellnote.children.list', arguments: {}}, {'X-Pale-CSRF': 'wrong'})).status, 403);
      assert.equal((await s.post('/api/call', {name: 'bellnote.children.list', arguments: {}}, {Cookie: ''})).status, 401);
      assert.equal((await s.post('/api/call', {name: 'bellnote.children.list', arguments: {}}, {Origin: 'http://example.test'})).status, 403);
      assert.equal((await s.post('/api/call', {name: 'bellnote.children.list', arguments: {}}, {'Content-Type': 'text/plain'})).status, 403);
    });
    await t.test('discovery lists only the Agent-visible Bellnote tools', async () => {
      const r = await (await s.get('/api/tools')).json();
      const names = r.tools.map(x => x.name);
      assert.equal(names.length, 23);
      assert.ok(names.every(n => n.startsWith('bellnote.')));
      for (const w of WRITES) assert.ok(names.includes(w), w);
      assert.ok(r.tools.find(x => x.name === 'bellnote.absences.report').inputSchema.properties.expected_version, 'forms come from live schemas');
    });
    await t.test('read views get real data', async () => {
      const kids = (await s.call('bellnote.children.list')).children;
      assert.deepEqual(kids.map(k => k.id), ['child-theo', 'child-ines', 'child-nico']);
      assert.deepEqual(kids.map(k => k.lunch_account_id), ['lunch-theo', 'lunch-ines', 'lunch-nico']);
      assert.equal('default_dismissal' in kids[2], false, 'no way home for the non-custodial child');
      const form = (await s.call('bellnote.forms.get', {id: 'form-aquarium'})).form;
      assert.equal(form.version, 2); assert.equal(form.responses[0].effective_state, 'needs_review');
      const pickup = await s.call('bellnote.pickup.get', {id: 'child-theo'});
      assert.deepEqual(pickup.restrictions.map(r => r.display_name), ['Rex Halvorsen']);
      assert.equal((await s.call('bellnote.pickup.get', {id: 'child-nico'})).status, 'not_permitted', 'visibility holds through the page');
      const lunch = await s.call('bellnote.lunch.account_get', {id: 'lunch-ines'});
      assert.equal(lunch.account.balance_cents, 310); assert.ok(lunch.transactions.some(x => x.restricted_item));
      assert.ok((await s.call('bellnote.notifications.list')).notifications.length > 0);
      assert.ok((await s.call('bellnote.schools.get', {id: 'school-alder'})).days.length > 0);
    });
    await t.test('W1 report an absence; an independent MCP read sees it', async () => {
      const r = await s.write('bellnote.absences.report', {id: 'child-theo', kind: 'absent', start: '2026-11-18', reason: 'Dentist <b>visit</b>'});
      assert.equal(r.status, 'committed', JSON.stringify(r));
      const seen = (await mcp.call('bellnote.absences.list', {id: r.id})).reports[0];
      assert.equal(seen.state, 'submitted'); assert.deepEqual(seen.dates, ['2026-11-18']); assert.equal(seen.reason, 'Dentist <b>visit</b>');
    });
    await t.test('W2 sign the changed form again; MCP sees the signature and no second charge', async () => {
      const r = await s.write('bellnote.forms.respond', {id: 'form-aquarium', child_id: 'child-theo', action: 'sign', form_version: 2, answers: {'q-lunch': 'bring_own', 'q-emergency': '555-0100'}});
      assert.equal(r.status, 'committed', JSON.stringify(r));
      const resp = (await mcp.call('bellnote.forms.get', {id: 'form-aquarium'})).form.responses.find(x => x.child_id === 'child-theo');
      assert.equal(resp.state, 'signed'); assert.equal(resp.form_version, 2); assert.equal(resp.payment_ids.length, 1);
    });
    await t.test('W3 add a pickup person and change a way home; MCP sees both', async () => {
      const add = await s.write('bellnote.pickup.person_add', {id: 'child-ines', name: 'June Park', relationship: 'neighbor', phone: '555-0166'});
      assert.equal(add.status, 'committed', JSON.stringify(add));
      const set = await s.write('bellnote.dismissal.set', {id: 'child-ines', date: '2026-11-19', mode: 'pickup', person_id: 'person-maya', note: 'Dentist after school'});
      assert.equal(set.status, 'committed', JSON.stringify(set));
      const p = await mcp.call('bellnote.pickup.get', {id: 'child-ines'});
      assert.equal(p.pickup_people.find(x => x.id === add.id).status, 'pending_review');
      assert.deepEqual(p.days.find(d => d.date === '2026-11-19').plan, {source: 'dismissal_change', change_id: set.id, mode: 'pickup', person_id: 'person-maya'});
    });
    await t.test('W4 top up and change settings; MCP sees the balance and limits', async () => {
      const r = await s.write('bellnote.lunch.topup', {id: 'lunch-ines', amount_cents: 2000, payment_method_id: 'pm-0001'});
      assert.equal(r.status, 'committed', JSON.stringify(r));
      const u = await s.write('bellnote.lunch.settings_update', {id: 'lunch-ines', low_balance_threshold_cents: 800, daily_limit_cents: null});
      assert.equal(u.status, 'committed', JSON.stringify(u));
      const acct = (await mcp.call('bellnote.lunch.account_get', {id: 'lunch-ines'})).account;
      assert.equal(acct.balance_cents, 2310); assert.equal(acct.low_balance_threshold_cents, 800); assert.equal(acct.daily_limit_cents, null);
    });
    await t.test('refusals carry the App code and message and change nothing', async () => {
      const before = await s.version();
      const low = await s.write('bellnote.lunch.topup', {id: 'lunch-theo', amount_cents: 200}, before);
      assert.equal(low.status, 'amount_out_of_range'); assert.ok(low.message.length > 0);
      const nico = await s.write('bellnote.absences.report', {id: 'child-nico', kind: 'absent', start: '2026-11-18', reason: 'Ill'}, before);
      assert.equal(nico.status, 'not_permitted'); assert.ok(nico.message.length > 0);
      const rex = await s.write('bellnote.pickup.person_add', {id: 'child-theo', name: 'R. Halvorsen', relationship: 'uncle', phone: '555-0199', person_id: 'person-rex'}, before);
      assert.equal(rex.status, 'restricted_person');
      assert.deepEqual(await s.version(), before);
    });
    await t.test('a form opened before another change gets stale_version and writes nothing', async () => {
      const opened = await s.version();
      // Someone else (here an independent MCP write) changes the account while the form is open.
      const other = await mcp.call('bellnote.preferences.update', {email_notices: true, expected_version: opened, request_id: 'mcp-prefs-1'});
      assert.equal(other.status, 'committed');
      const stale = await s.write('bellnote.lunch.topup', {id: 'lunch-theo', amount_cents: 1000}, opened);
      assert.equal(stale.status, 'stale_version');
      assert.equal((await mcp.call('bellnote.lunch.account_get', {id: 'lunch-theo'})).account.balance_cents, 1250, 'nothing charged');
    });
    await t.test('retrying an unchanged form with the same request ID commits once', async () => {
      const v = await s.version(), id = 'web-' + crypto.randomUUID(), args = {id: 'lunch-theo', amount_cents: 1000, payment_method_id: 'pm-0001'};
      const a = await s.write('bellnote.lunch.topup', args, v, id), b = await s.write('bellnote.lunch.topup', args, v, id);
      assert.equal(a.status, 'committed'); assert.equal(b.status, 'committed'); assert.equal(b.id, a.id);
      assert.equal((await mcp.call('bellnote.lunch.account_get', {id: 'lunch-theo'})).account.balance_cents, 2250, 'one charge');
      const pays = (await mcp.call('bellnote.payments.list', {child_id: 'child-theo'})).payments.filter(p => p.request_id === id);
      assert.equal(pays.length, 1);
      const changed = await s.write('bellnote.lunch.topup', {...args, amount_cents: 1500}, v, id);
      assert.equal(changed.status, 'idempotency_conflict');
    });
  } finally { await mcp.close(); await s.close(); }
});

test('restricted (scenario) profile: discovery has only reads and the Host refuses writes', async () => {
  const s = await open('scenario', 'bellnote-web-scenario');
  try {
    const names = (await (await s.get('/api/tools')).json()).tools.map(x => x.name);
    assert.equal(names.length, 12);
    for (const w of WRITES) assert.ok(!names.includes(w), w);
    const r = await s.post('/api/call', {name: 'bellnote.lunch.topup', arguments: {id: 'lunch-ines', amount_cents: 2000, expected_version: {epoch: 1, revision: 0}, request_id: 'web-x'}});
    assert.equal(r.status, 403);
    assert.equal((await s.call('bellnote.children.list')).children.length, 3, 'reads still work');
  } finally { await s.close(); }
});
