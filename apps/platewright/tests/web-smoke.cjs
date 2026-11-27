'use strict';
// Web smoke test: starts the repository's shared Web Host (runtime/web/server.cjs) for Platewright
// on a fresh run, with the package's own registry (web.registry.json), opens a session the way the
// browser does, and drives the page's backend: static files, refused paths, discovery, read views,
// writes confirmed by an independent Agent MCP connection to the same run, a refusal, a stale
// version, a retried request ID, the restricted profile and the session/CSRF boundary.
// No npm dependency.   node tests/web-smoke.cjs [--runtime DIR]
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const locate = require('../scripts/locate.cjs');
const runtime = locate.runtimeDir();
const {start} = require(path.join(runtime, 'web/server.cjs'));
const {Client} = require(path.join(runtime, 'client.cjs'));
const registry = path.join(locate.packageDir, 'web.registry.json');
const tools = require('../tools.json');
const P = 'platewright.';

async function session(host) {
  const post = (route, body, headers = {}) => fetch(host.url + route, {method: 'POST', headers: {Origin: host.url, 'Content-Type': 'application/json', ...headers}, body: JSON.stringify(body)});
  const login = await post('/session', {token: new URL(host.accessUrl).hash.slice('#access='.length)});
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0], {csrf} = await login.json();
  const headers = {Cookie: cookie, 'X-Pale-CSRF': csrf};
  const call = async (name, args = {}) => { const r = await post('/api/call', {name, arguments: args}, headers); assert.equal(r.status, 200, name); return r.json(); };
  return {post, cookie, csrf, headers, call};
}

test('Platewright through the shared Web Host: page, boundary, views, writes, refusals, retries and policy', {timeout: 120000}, async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'platewright-web-'));
  let host, other, restricted;
  try {
    host = await start({app: 'platewright', registry, run: 'web-smoke', stateDir, profile: 'sandbox'});
    // Page, controller and shared files are served; everything else is refused.
    const page = await (await fetch(host.url + '/')).text(), controller = await (await fetch(host.url + '/app.js')).text();
    assert.match(page, /<title>Platewright/);
    assert.match(page, /src="\/app.js"/);
    for (const t of tools) assert.ok(controller.includes("'" + t.name + "'"), 'the controller covers ' + t.name);
    for (const view of ['Meal plan', 'Recipes', 'Shopping list', 'Pantry', 'Household', 'Activity']) assert.ok(controller.includes("'" + view + "'"), view);
    assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML|eval\(|new Function|document\.write/.test(controller), 'the controller never turns data into markup or code');
    assert.ok(!/https?:\/\//.test(controller.replace(/^\s*\/\/.*$/mg, '')), 'no remote fetch');
    for (const f of ['/shared/client.js', '/shared/style.css']) assert.equal((await fetch(host.url + f)).status, 200, f);

    const s = await session(host);
    for (const route of ['/gui/src/view.js', '/gui/src/app.js', '/fixtures/reference.json', '/web.registry.json', '/tools.json', '/src/plan.cjs', '/.state/web-smoke/platewright.json', '/api/infra/platewright', '/api/snapshot'])
      assert.equal((await fetch(host.url + route, {headers: {Cookie: s.cookie}})).status, 404, route);
    assert.equal((await fetch(host.url + '/app.js?raw=1')).status, 403, 'query strings are refused');
    for (const name of ['env.snapshot', 'env.reset', 'env.load_seed', 'env.apply_event', 'env.advance_time', 'env.event_status'])
      assert.equal((await s.post('/api/call', {name, arguments: {}}, s.headers)).status, 403, name);
    assert.equal((await s.post('/api/call', {name: P + 'plan.get', arguments: {}, role: 'infra'}, s.headers)).status, 400, 'no client-selected role');

    // Session and CSRF.
    assert.equal((await fetch(host.url + '/api/tools')).status, 401, 'discovery needs the session');
    assert.equal((await s.post('/session', {token: 'not-the-token'})).status, 403);
    assert.equal((await s.post('/api/call', {name: P + 'plan.get', arguments: {}}, {Cookie: s.cookie})).status, 403, 'a write path without the CSRF token');
    assert.equal((await s.post('/api/call', {name: P + 'plan.get', arguments: {}}, {...s.headers, Origin: 'https://elsewhere.invalid'})).status, 403, 'a foreign origin');
    assert.equal((await fetch(host.url + '/api/call', {method: 'POST', headers: {Origin: host.url, 'Content-Type': 'text/plain', ...s.headers}, body: '{}'})).status, 403, 'JSON only');

    // Discovery lists exactly the 22 Agent tools.
    const listed = (await (await fetch(host.url + '/api/tools', {headers: {Cookie: s.cookie}})).json()).tools.map(t => t.name).sort();
    assert.deepEqual(listed, tools.map(t => t.name).sort());

    // Read views.
    const week = await s.call(P + 'plan.get', {});
    assert.deepEqual([week.status, week.start, week.end, week.slots.length > 10], ['ok', '2026-11-02', '2026-11-08', true]);
    const next = await s.call(P + 'plan.get', {start: '2026-11-09', end: '2026-11-15'});
    assert.deepEqual(next.slots.find(x => x.id === '2026-11-14:dinner').flags.filter(f => f.type === 'person').map(f => f.id + ':' + f.verdict), ['guest-ines:unsuitable', 'guest-maya:unsafe']);
    const list = (await s.call(P + 'shopping.get')).list;
    assert.deepEqual([list.stale, list.start, list.end], [true, '2026-11-09', '2026-11-15']);
    const pantry = await s.call(P + 'pantry.list', {include_out: true});
    assert.equal(pantry.items.length, 40);
    const household = await s.call(P + 'household.get');
    assert.deepEqual(household.members.map(m => m.display_name), ['Nora', 'Evan', 'Eli', 'Ada']);
    const recipe = (await s.call(P + 'recipes.get', {id: 'rec-green-curry', servings: 6})).recipe;
    assert.deepEqual(recipe.lines.slice(0, 2).map(l => [l.quantity, l.unit]), [[1050, 'ml'], [9, 'tbsp']]);

    // An independent Agent MCP connection to the same run confirms what the page writes.
    other = new Client('platewright', 'agent', 'web-smoke', stateDir, 'platewright-web-smoke-check', {registry});
    await other.initialize();
    let version = (await s.call(P + 'household.get')).version;
    const write = async (name, args) => { const r = await s.call(name, {...args, expected_version: version, request_id: 'web-' + name + '-' + version.revision}); assert.equal(r.status, 'committed', name + ' ' + JSON.stringify(r)); version = r.version; return r; };
    // W4: plan Monday's lunch for two members and a vegan guest (her name is kept as plain text).
    const slot = await write(P + 'plan.slot.set', {id: '2026-11-09:lunch', dishes: [{recipe_id: 'rec-red-lentil-soup'}], attendees: ['person-nora', 'person-eli'],
      guests: [{guest_id: 'guest-rosa', name: 'Rosa <b>&amp;</b>', constraints: [{kind: 'diet', diet: 'vegan'}]}]});
    const seen = (await other.call(P + 'plan.get', {start: '2026-11-09', end: '2026-11-09'})).slots.find(x => x.id === slot.id);
    assert.deepEqual([seen.state, seen.guests[0].name, seen.default_servings], ['planned', 'Rosa <b>&amp;</b>', 3]);
    // W5: eggs bought; tick a line on the list.
    await write(P + 'pantry.set', {id: 'ing-egg', quantity: 18, unit: 'each', use_by: '2026-11-28'});
    assert.equal((await other.call(P + 'pantry.list', {})).items.find(i => i.ingredient_id === 'ing-egg').quantity, 18);
    const needed = list.lines.find(l => l.state === 'needed' && l.kind === 'derived');
    await write(P + 'shopping.item.set', {id: needed.id, ticked: true});
    assert.equal((await other.call(P + 'shopping.get', {})).list.lines.find(l => l.id === needed.id).state, 'ticked');
    // W2: a new dislike for Evan from the 12th.
    const con = await write(P + 'members.constraint.set', {id: 'person-evan', constraint: {kind: 'dislike', ingredient_id: 'ing-cilantro', effective_from: '2026-11-12', note: 'Said so at dinner'}});
    assert.equal((await other.call(P + 'household.get', {id: 'person-evan'})).members[0].constraints.find(c => c.id === con.id).state, 'scheduled');
    // W1 and W3: a new recipe, then a variant of the curry.
    const created = await write(P + 'recipes.create', {title: 'Weeknight bean soup', servings: 4, method_tags: ['simmer'], steps: ['Simmer everything for 20 minutes.'],
      lines: [{ingredient_id: 'ing-black-beans-canned', quantity: 800, unit: 'g'}, {ingredient_id: 'ing-onion', quantity: 1, unit: 'each'}]});
    assert.equal((await other.call(P + 'recipes.get', {id: created.id})).recipe.title, 'Weeknight bean soup');
    const variant = await write(P + 'recipes.variant.create', {id: 'rec-green-curry', swaps: [{ingredient_id: 'ing-fish-sauce', rule_id: 'rule-fish-sauce-tamari'}], title: 'Curry with tamari for the weekend'});
    assert.equal((await other.call(P + 'recipes.get', {id: variant.id})).recipe.variant.base_recipe_id, 'rec-green-curry');

    // A refusal comes back with the App's code and message, and changes nothing.
    const before = await other.call(P + 'plan.get', {start: '2026-11-07', end: '2026-11-07'});
    const past = await s.call(P + 'plan.slot.set', {id: '2026-11-07:dinner', dishes: [{recipe_id: 'rec-dal'}], expected_version: version, request_id: 'web-past'});
    assert.equal(past.status, 'past_slot');
    assert.match(past.message, /has passed/);
    assert.deepEqual((await other.call(P + 'plan.get', {start: '2026-11-07', end: '2026-11-07'})).slots, before.slots);
    // A form opened before another change carries the old version: stale_version, nothing written.
    const stale = await s.call(P + 'pantry.set', {id: 'ing-lime', quantity: 6, unit: 'each', expected_version: {...version, revision: version.revision - 1}, request_id: 'web-stale'});
    assert.deepEqual([stale.status, stale.applied], ['stale_version', false]);
    assert.equal((await other.call(P + 'pantry.list', {})).items.find(i => i.ingredient_id === 'ing-lime').quantity, 2);
    // The same request ID sent again after a lost response commits once.
    const retryArgs = {text: 'Napkins', quantity: 1, unit: 'each'};
    const first = await s.call(P + 'shopping.item.set', {...retryArgs, expected_version: version, request_id: 'web-retry'});
    const again = await s.call(P + 'shopping.item.set', {...retryArgs, expected_version: version, request_id: 'web-retry'});
    assert.deepEqual([first.status, again.duplicate, again.id], ['committed', true, first.id]);
    assert.equal((await other.call(P + 'shopping.get', {})).list.lines.filter(l => l.text === 'Napkins').length, 1);
    await other.close(); other = null;
    await host.close(); host = null;

    // A fresh run under the restricted (scenario) profile: discovery offers reads only, writes are denied.
    restricted = await start({app: 'platewright', registry, run: 'web-smoke-restricted', stateDir, profile: 'scenario'});
    const r = await session(restricted);
    const visible = (await (await fetch(restricted.url + '/api/tools', {headers: {Cookie: r.cookie}})).json()).tools;
    assert.deepEqual(visible.map(t => t.name).sort(), tools.filter(t => t.read_only).map(t => t.name).sort());
    const v = (await r.call(P + 'plan.get', {})).version, eggs = (await r.call(P + 'pantry.list', {})).items.find(i => i.ingredient_id === 'ing-egg').quantity;
    const denied = await r.post('/api/call', {name: P + 'pantry.set', arguments: {id: 'ing-egg', quantity: 1, unit: 'each', expected_version: v, request_id: 'web-denied'}}, r.headers);
    assert.equal(denied.status, 403);
    assert.equal((await r.call(P + 'pantry.list', {})).items.find(i => i.ingredient_id === 'ing-egg').quantity, eggs);
  } finally {
    await other?.close(); await host?.close(); await restricted?.close();
    fs.rmSync(stateDir, {recursive: true, force: true});
  }
});
