'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { createRecorder } = require('./recorder.cjs');

const PREVIEW = 'plateway.checkout.preview';
const PREVIEW_ARGS = { address_id: 'a-1', card_id: 'c-1', when: { mode: 'asap' }, tip_cents: 0 };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const pageCall = (page, name, args) => page.evaluate(async ({ name, args }) => {
  const { csrf } = await (await fetch('/session')).json();
  const r = await fetch('/api/call', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pale-CSRF': csrf }, body: JSON.stringify({ name, arguments: args }) });
  try { return { http: r.status, body: await r.json() }; } catch { return { http: r.status, body: null }; }
}, { name, args }).catch(() => null);

const settled = page => page.waitForFunction(() => { const s = document.getElementById('status'); return document.querySelector('#app').getAttribute('aria-busy') === 'false' && (s.textContent === 'All changes saved' || s.dataset.error === 'true'); });

const firstLine = e => String(e && e.message || e).split('\n')[0];

async function closeEach(steps) {
  const problems = [];
  for (const [what, fn] of steps) {
    try {
      const left = await fn();
      if (Array.isArray(left)) problems.push(...left.map(x => what + ': ' + x));
    } catch (e) { problems.push(what + ': ' + firstLine(e)); }
  }
  return problems;
}

function resources() {
  const servers = [], routes = [];
  const unroute = async r => {
    if (r.removed) return;
    await r.page.unroute(r.url, r.handler);
    const before = r.hits;
    await r.page.evaluate(() => fetch('/api/call', { method: 'POST', body: '{}' }).then(x => x.text(), () => null));
    if (r.hits !== before) throw Error('the route ' + r.url + ' still intercepts requests after unroute');
    r.removed = true;
  };
  return {
    servers, routes, unroute,
    async server(handler) {
      const s = http.createServer(handler);
      servers.push(s);
      await new Promise(resolve => s.listen(0, '127.0.0.1', resolve));
      return s;
    },
    async route(page, url, handler) {
      const r = { page, url, hits: 0, removed: false };
      r.handler = route => { r.hits += 1; return handler(route); };
      await page.route(url, r.handler);
      routes.push(r);
      return r;
    },
    async close() {
      const problems = [];
      for (const r of [...routes].reverse()) {
        if (r.removed) continue;
        if (r.page.isClosed()) { problems.push('the page closed before the route ' + r.url + ' was removed'); continue; }
        try { await unroute(r); } catch (e) { problems.push('removing the route ' + r.url + ' failed: ' + firstLine(e)); }
      }
      for (const s of servers) {
        if (s.listening) {
          if (s.closeAllConnections) s.closeAllConnections();
          try { await new Promise((resolve, reject) => s.close(e => e ? reject(e) : resolve())); } catch (e) { problems.push('closing an HTTP server failed: ' + firstLine(e)); }
        }
        if (s.listening) problems.push('an HTTP server is still listening');
      }
      return problems;
    }
  };
}

const barrier = (names, ms = 5000) => {
  const state = { arrived: 0, distinct: new Set(), released: false, timedOut: false };
  let release, timer = null;
  const gate = new Promise(resolve => { release = resolve; });
  const handler = async route => {
    let name = null;
    try { name = route.request().postDataJSON().name; } catch { name = null; }
    if (!names.includes(name)) { await route.continue().catch(() => {}); return; }
    if (state.released || state.timedOut) { await route.abort('failed').catch(() => {}); return; }
    state.arrived += 1;
    state.distinct.add(name);
    if (state.distinct.size === names.length) { state.released = true; clearTimeout(timer); release(true); }
    else if (!timer) timer = setTimeout(() => { state.timedOut = true; release(false); }, ms);
    if (await gate) await route.continue().catch(() => {});
    else await route.abort('failed').catch(() => {});
  };
  return { handler, state };
};
const together = gate => assert.ok(gate.state.released && !gate.state.timedOut && gate.state.arrived === 2 && gate.state.distinct.size === 2, 'The two calls did not both reach the barrier before either was released');
const overlapped = (a, b) => Math.max(a.dispatchedAt, b.dispatchedAt) < Math.min(a.closedAt, b.closedAt);

const delays = list => {
  const queue = [...list];
  return async route => {
    let name = null;
    try { name = route.request().postDataJSON().name; } catch { name = null; }
    if (name === PREVIEW && queue.length) await sleep(queue.shift());
    await route.continue().catch(() => {});
  };
};

const brokenReply = (req, res) => {
  req.resume();
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '500' });
    res.write('{"status":');
    setTimeout(() => res.socket.destroy(), 100);
  });
};

async function stops(fn, expected) {
  let message = null;
  try { await fn(); } catch (e) { message = String(e.message).split('\n')[0]; }
  assert.equal(message, expected, 'A recorder probe did not stop with the expected message');
  return message;
}

const find = (R, label, owner) => R.records().filter(r => r.label === label && (!owner || r.owner.label === owner));
const one = (R, label, owner) => { const list = find(R, label, owner); assert.equal(list.length, 1, 'Expected exactly one ' + label + (owner ? ' in ' + owner : '') + ', found ' + list.length); return list[0]; };
const nothing = () => {};
const untilDispatched = async (R, label, count) => { for (let i = 0; find(R, label).length < count; i++) { if (i > 400) throw Error('A probe request was never dispatched'); await sleep(10); } };

const AFTER_LAST = 'dispatched after the last sequence closed';
const RATE = 'plateway.orders.rate';
const truthy = async () => true;

const PROBES = [
  {
    probe: 'outside-step page read',
    does: 'After a sequence closes and before the next one begins, the page sends plateway.account.get',
    run: async ({ page, R }) => {
      await R.begin('probe');
      await R.closeSequence();
      await pageCall(page, 'plateway.account.get', {});
      await R.quiet();
      const stopped_with = await stops(async () => R.verify(), 'Recorder error: plateway.account.get (page read) dispatched with no active step (after sequence probe closed)');
      one(R, 'plateway.account.get (page read)', 'no active step');
      return { stopped_with };
    }
  },
  {
    probe: 'outside-step second-Agent call',
    does: 'After a sequence closes and before the next one begins, the second Agent client calls plateway.restaurants.search',
    run: async ({ R }) => {
      await R.begin('probe');
      await R.closeSequence();
      const stopped_with = await stops(() => R.agentRead('plateway.restaurants.search', { address_id: 'a-1' }), 'Recorder error: plateway.restaurants.search (second Agent read) dispatched with no active step (after sequence probe closed)');
      const rec = one(R, 'plateway.restaurants.search (second Agent read)', 'no active step');
      assert.deepEqual([rec.terminal, rec.outcomes], ['not sent', 0]);
      return { stopped_with, sent: false };
    }
  },
  {
    probe: 'refusal caught after the last sequence',
    does: 'After the last sequence closes the page sends plateway.account.get, then an Infra read is refused and the caller catches the refusal; the teardown check must still report both',
    run: async ({ page, R }) => {
      await R.begin('probe');
      await R.finish();
      await pageCall(page, 'plateway.account.get', {});
      await R.quiet();
      const both = 'Recorder error: env.snapshot (Infra inspector read) ' + AFTER_LAST + '; plateway.account.get (page read) ' + AFTER_LAST;
      let caught = null;
      try { await R.version(); } catch (e) { caught = firstLine(e); }
      assert.equal(caught, both);
      const stopped_with = await stops(async () => R.verify(), both);
      assert.deepEqual(R.leftovers().slice().sort(), ['env.snapshot (Infra inspector read) ' + AFTER_LAST, 'plateway.account.get (page read) ' + AFTER_LAST]);
      return { stopped_with, caught_by_the_caller: true, still_reported_at_teardown: 2 };
    }
  },
  {
    probe: 'forced call concurrent with a preview',
    does: 'A route holds a preview and a forced plateway.orders.rate call until both are in flight; inside a step both are recorded once each, and after the next step is frozen both stop the script',
    run: async ({ page, R, res }) => {
      await R.begin('probe');
      const v = await R.version();
      const forcedArgs = k => ({ order_id: 'o-10', stars: 5, expected_version: v, request_id: 'probe-forced-' + k });
      const gate = barrier([PREVIEW, RATE]);
      const held = await res.route(page, '**/api/call', gate.handler);
      await Promise.allSettled([pageCall(page, PREVIEW, PREVIEW_ARGS), R.forced(RATE, forcedArgs(1))]);
      together(gate);
      let kept = null;
      await R.step({ check: truthy, record: x => { kept = x; } });
      const first = [one(R, PREVIEW + ' (page preview)', 'probe step 1'), one(R, RATE + ' (forced call)', 'probe step 1')];
      assert.ok(overlapped(...first), 'The preview and the forced call were not in flight at the same time');
      assert.deepEqual(kept.calls.map(c => c.kind).sort(), ['forced call', 'preview']);
      await res.unroute(held);
      const gate2 = barrier([PREVIEW, RATE]);
      await res.route(page, '**/api/call', gate2.handler);
      const stopped_with = await stops(() => R.step({ check: truthy, capture: () => Promise.allSettled([pageCall(page, PREVIEW, PREVIEW_ARGS), R.forced(RATE, forcedArgs(2))]) }),
        'Recorder error: plateway.checkout.preview (page preview) dispatched after probe step 2 was frozen; plateway.orders.rate (forced call) dispatched after probe step 2 was frozen');
      await R.quiet();
      together(gate2);
      const second = [one(R, PREVIEW + ' (page preview)', 'probe step 2'), one(R, RATE + ' (forced call)', 'probe step 2')];
      assert.ok(overlapped(...second), 'The two calls after the freeze were not in flight at the same time');
      return { stopped_with, held_until_both_arrived: true, in_flight_together: true, recorded_in_open_step: ['forced call', 'preview'] };
    }
  },
  {
    probe: 'forced token moved to another call',
    does: 'The page moves the header token issued for a forced plateway.orders.rate call onto a preview, so the rating leaves without it',
    run: async ({ page, R }) => {
      await R.begin('probe');
      await page.evaluate(() => {
        const original = window.fetch;
        let stolen = null;
        window.fetch = (url, init = {}) => {
          const headers = { ...(init.headers || {}) };
          let name = null;
          try { name = JSON.parse(init.body).name; } catch { name = null; }
          if (headers['X-Evidence-Forced'] && name === 'plateway.orders.rate') { stolen = headers['X-Evidence-Forced']; delete headers['X-Evidence-Forced']; return original(url, { ...init, headers }); }
          if (stolen && name === 'plateway.checkout.preview') { headers['X-Evidence-Forced'] = stolen; stolen = null; return original(url, { ...init, headers }); }
          return original(url, init);
        };
      });
      const v = await R.version();
      await R.forced(RATE, { order_id: 'o-10', stars: 4, expected_version: v, request_id: 'probe-moved' });
      await pageCall(page, PREVIEW, PREVIEW_ARGS);
      await R.quiet();
      const stopped_with = await stops(async () => R.verify(), 'Recorder error: the forced call plateway.orders.rate was not seen leaving the page; the forced-call token probe-1 was sent with plateway.checkout.preview and other arguments than the plateway.orders.rate call it was issued for');
      one(R, RATE + ' (page write)', 'probe step 1');
      one(R, PREVIEW + ' (page preview)', 'probe step 1');
      assert.equal(R.records().filter(r => r.label.endsWith('(forced call)')).length, 0);
      return { stopped_with, classified_as_forced: 0 };
    }
  },
  {
    probe: 'state change between the check and the freeze',
    does: 'The page commits plateway.cart.add_item while the step\'s check runs',
    run: async ({ page, R }) => {
      await R.begin('probe');
      const v = await R.version();
      let recorded = false;
      const stopped_with = await stops(() => R.step({ check: async () => { await pageCall(page, 'plateway.cart.add_item', { item_id: 'mi-3', option_ids: [], quantity: 1, expected_version: v, request_id: 'probe-during-check' }); return true; }, record: () => { recorded = true; } }),
        'Recorder error: probe step 1: the App\'s version changed between the step\'s check and its freeze');
      assert.equal(one(R, 'plateway.cart.add_item (page write)', 'probe step 1').entry.result.status, 'committed');
      assert.equal(recorded, false);
      return { stopped_with, step_recorded: false };
    }
  },
  {
    probe: 'write during the step\'s preparation',
    does: 'After the step is frozen and while it waits before the screenshot, the page sends plateway.cart.add_item',
    run: async ({ page, R }) => {
      await R.begin('probe');
      const v = await R.version();
      let recorded = false;
      const stopped_with = await stops(() => R.step({ check: truthy, prepare: async () => { await page.waitForTimeout(100); await pageCall(page, 'plateway.cart.add_item', { item_id: 'mi-3', option_ids: [], quantity: 1, expected_version: v, request_id: 'probe-during-prepare' }); }, record: () => { recorded = true; } }),
        'Recorder error: plateway.cart.add_item (page write) dispatched after probe step 1 was frozen');
      assert.equal(recorded, false);
      return { stopped_with, step_recorded: false };
    }
  },
  {
    probe: 'write after the screenshot',
    does: 'Right after the step\'s screenshot the page sends plateway.cart.add_item',
    run: async ({ page, R, shots }) => {
      await R.begin('probe');
      const v = await R.version();
      let kept = null;
      const stopped_with = await stops(() => R.step({ check: truthy, record: x => { kept = x; }, capture: async () => {
        await page.screenshot({ path: path.join(shots, 'probe.png') });
        await pageCall(page, 'plateway.cart.add_item', { item_id: 'mi-3', option_ids: [], quantity: 1, expected_version: v, request_id: 'probe-late-write' });
      } }), 'Recorder error: plateway.cart.add_item (page write) dispatched after probe step 1 was frozen');
      assert.ok(!kept.calls.some(c => c.kind === 'write'), 'The late write counted toward the step');
      assert.deepEqual(kept.version, v, 'The step version moved with the late write');
      assert.equal(one(R, 'plateway.cart.add_item (page write)').terminal, 'reply');
      return { stopped_with, frozen_write_set: kept.calls.length, frozen_version_kept: true };
    }
  },
  {
    probe: 'duplicate terminal event',
    does: 'A preview finishes and its requestfinished event is delivered a second time',
    run: async ({ page, R }) => {
      await R.begin('probe');
      const [req] = await Promise.all([page.waitForRequest(r => r.url().endsWith('/api/call') && r.postDataJSON().name === PREVIEW), pageCall(page, PREVIEW, PREVIEW_ARGS)]);
      await R.quiet();
      page.emit('requestfinished', req);
      const stopped_with = await stops(() => R.step({ check: truthy }), 'Recorder error: plateway.checkout.preview (page preview), started in probe step 1, received a second terminal outcome (reply after reply)');
      const rec = one(R, PREVIEW + ' (page preview)');
      assert.deepEqual([rec.outcomes, rec.terminal], [2, 'reply']);
      return { stopped_with, outcomes_seen: 2, kept_outcome: 'reply' };
    }
  },
  {
    probe: 'failure after headers',
    does: 'A preview is answered with HTTP 200 headers and the start of a JSON body, then the connection closes',
    run: async ({ page, R, res }) => {
      await R.begin('probe');
      const server = await res.server(brokenReply);
      await res.route(page, '**/api/call', route => route.continue({ url: 'http://127.0.0.1:' + server.address().port + '/api/call' }).catch(() => {}));
      await pageCall(page, PREVIEW, PREVIEW_ARGS);
      await R.quiet();
      await sleep(300);
      const stopped_with = await stops(() => R.step({ check: truthy }), 'Recorder error: plateway.checkout.preview (page preview), started in probe step 1, failed after its headers (HTTP 200): net::ERR_CONTENT_LENGTH_MISMATCH');
      const rec = one(R, PREVIEW + ' (page preview)');
      assert.equal(rec.outcomes, 1, 'The failed request received more than one terminal outcome');
      assert.deepEqual({ http: rec.entry.http, result: rec.entry.result, failure: rec.entry.failure }, { http: 200, result: null, failure: 'net::ERR_CONTENT_LENGTH_MISMATCH' });
      return { stopped_with, outcomes_seen: 1, recorded: { http: 200, result: null, failure: 'net::ERR_CONTENT_LENGTH_MISMATCH' } };
    }
  },
  {
    probe: 'request during sealing',
    does: 'A preview delayed 600 ms is sent during the capture, and a second one delayed 1200 ms is sent 150 ms into sealing',
    run: async ({ page, R, res }) => {
      await R.begin('probe');
      await res.route(page, '**/api/call', delays([600, 1200]));
      let second = null;
      const label = PREVIEW + ' (page preview)';
      const stopped_with = await stops(() => R.step({ check: truthy, capture: async () => {
        pageCall(page, PREVIEW, PREVIEW_ARGS);
        await untilDispatched(R, label, 1);
        setTimeout(() => { second = pageCall(page, PREVIEW, PREVIEW_ARGS); }, 150);
      } }), 'Recorder error: plateway.checkout.preview (page preview) dispatched after probe step 1 was frozen; plateway.checkout.preview (page preview) dispatched while probe step 1 was being sealed');
      const both = find(R, label, 'probe step 1');
      assert.equal(both.length, 2);
      assert.ok(both.every(r => r.terminal === 'reply' && r.closed), 'Sealing ended before both replies were in');
      await second;
      return { stopped_with, replies_in_before_sealed: 2 };
    }
  },
  {
    probe: 'call after the last sequence',
    does: 'Inside a step the second Agent client empties the cart, adds one Tom Yum Soup and asks for a checkout preview; after the last sequence closes the page sends the same preview, which succeeds',
    run: async ({ page, R }) => {
      await R.begin('probe');
      for (const line of (await R.agentRead('plateway.cart.get', {})).lines) await R.agentWrite('plateway.cart.remove_item', { line_id: line.id });
      assert.equal((await R.agentWrite('plateway.cart.add_item', { item_id: 'mi-3', option_ids: [], quantity: 1 })).status, 'committed');
      let expected = null;
      await R.step({ check: async () => { expected = await R.agentRead(PREVIEW, PREVIEW_ARGS); return true; } });
      assert.equal(expected.status, 'ok', 'The preview the probe compares against is not a real one');
      assert.ok(expected.token && expected.total_cents > 0 && expected.lines.length === 1, 'The preview the probe compares against is not a real one');
      await R.finish();
      await pageCall(page, PREVIEW, PREVIEW_ARGS);
      await R.quiet();
      const stopped_with = await stops(async () => R.verify(), 'Recorder error: plateway.checkout.preview (page preview) ' + AFTER_LAST);
      const rec = one(R, PREVIEW + ' (page preview)', 'no active step');
      assert.equal(rec.entry.result.status, 'ok');
      assert.deepEqual({ http: rec.entry.http, result: rec.entry.result }, { http: 200, result: expected }, 'The recorded reply is not the App\'s exact answer');
      return { stopped_with, recorded_reply: 'HTTP 200, status ok with a token and a total for one Tom Yum Soup, identical to the App\'s answer to the same preview through the second Agent client' };
    }
  },
  {
    probe: 'second Agent close fails once',
    does: 'Closing the second Agent client fails the first time; the caller catches the failure, later checks must still report it, and a second close must reach the same client',
    agentClient: Base => class extends Base { async close() { if (!this.failedOnce) { this.failedOnce = true; throw Error('injected close failure'); } return super.close(); } },
    run: async ({ R }) => {
      await R.begin('probe');
      await R.agentRead('plateway.restaurants.search', { address_id: 'a-1' });
      await R.step({ check: truthy });
      await R.finish();
      const message = 'Recorder error: closing the second Agent client failed: injected close failure';
      let caught = null;
      try { await R.close(); } catch (e) { caught = firstLine(e); }
      assert.equal(caught, message);
      const stopped_with = await stops(async () => R.verify(), message);
      assert.deepEqual(R.leftovers(), ['closing the second Agent client failed: injected close failure']);
      assert.equal(R.agentClosed(), false);
      await R.close();
      assert.equal(R.agentClosed(), true, 'A second close did not reach the client');
      return { stopped_with, still_reported_after_the_catch: true, closed_on_retry: true };
    }
  },
  {
    probe: 'cleanup after a failed step',
    does: 'The cleanup used by every probe and by the probe suite runs three steps; the first throws and the third reports something left open',
    run: async () => {
      const ran = [];
      const problems = await closeEach([['first', async () => { ran.push('first'); throw Error('injected failure'); }], ['second', async () => { ran.push('second'); }], ['third', async () => { ran.push('third'); return ['left open']; }]]);
      assert.deepEqual(ran, ['first', 'second', 'third'], 'A cleanup step was skipped after an earlier one failed');
      assert.deepEqual(problems, ['first: injected failure', 'third: left open']);
      return { stopped_with: 'Cleanup problems: ' + problems.join('; '), steps_attempted: ran.length };
    }
  },
  {
    probe: 'barrier waits for both distinct calls',
    does: 'Two previews reach the overlap barrier first; it must stay closed until the forced plateway.orders.rate call arrives',
    run: async ({ page, R, res }) => {
      await R.begin('probe');
      const v = await R.version();
      const gate = barrier([PREVIEW, RATE]);
      await res.route(page, '**/api/call', gate.handler);
      const previews = [pageCall(page, PREVIEW, PREVIEW_ARGS), pageCall(page, PREVIEW, PREVIEW_ARGS)];
      for (let i = 0; gate.state.arrived < 2; i++) { if (i > 400) throw Error('The two previews never reached the barrier'); await sleep(10); }
      await sleep(200);
      assert.deepEqual([gate.state.released, gate.state.distinct.size], [false, 1], 'Two previews opened the barrier without the rating call');
      await Promise.allSettled([...previews, R.forced(RATE, { order_id: 'o-10', stars: 5, expected_version: v, request_id: 'probe-gate' })]);
      assert.deepEqual([gate.state.released, gate.state.timedOut, gate.state.distinct.size], [true, false, 2]);
      await R.step({ check: truthy });
      return { stopped_with: 'The barrier stayed closed with two previews held, and opened when the rating call arrived', held_before_the_rating: 2 };
    }
  },
  {
    probe: 'late reply',
    does: 'A preview is delayed 1500 ms and the step allows 300 ms for outstanding replies',
    run: async ({ page, R, res }) => {
      await R.begin('probe');
      await res.route(page, '**/api/call', delays([1500]));
      const sent = pageCall(page, PREVIEW, PREVIEW_ARGS);
      await untilDispatched(R, PREVIEW + ' (page preview)', 1);
      const stopped_with = await stops(() => R.step({ check: truthy, limit: 300 }), 'Recorder error: still outstanding after 300 ms: plateway.checkout.preview (page preview), started in probe step 1');
      await sent;
      await R.quiet();
      const rec = one(R, PREVIEW + ' (page preview)');
      assert.ok(rec.terminal === 'reply' && rec.entry.http === 200 && rec.owner.label === 'probe step 1', 'The late reply was not recorded under its request');
      return { stopped_with, reply_recorded_under_its_request: true };
    }
  },
  {
    probe: 'second-Agent call after the screenshot',
    does: 'Right after the step\'s screenshot the second Agent client calls plateway.restaurants.search',
    run: async ({ page, R, shots }) => {
      await R.begin('probe');
      const stopped_with = await stops(() => R.step({ check: truthy, capture: async () => {
        await page.screenshot({ path: path.join(shots, 'probe.png') });
        await R.agentRead('plateway.restaurants.search', { address_id: 'a-1' });
      } }), 'Recorder error: plateway.restaurants.search (second Agent read) dispatched after probe step 1 was frozen');
      assert.equal(one(R, 'plateway.restaurants.search (second Agent read)').terminal, 'not sent');
      return { stopped_with, sent: false };
    }
  }
];

const failingClose = times => Base => class extends Base { async close() { this.failures = (this.failures || 0) + 1; if (this.failures <= times) throw Error('injected close failure'); return super.close(); } };
const FAILING_CLOSES = [
  { probe: 'probe failure with an Agent close that fails once', times: 1, cleanup: 'second Agent client: close failed 1 time (Recorder error: closing the second Agent client failed: injected close failure)' },
  { probe: 'probe failure with an Agent close that keeps failing', times: 99, cleanup: 'second Agent client: close failed 3 times (Recorder error: closing the second Agent client failed: injected close failure); second Agent client: killed after 3 failed closes' }
].map(x => ({ ...x, agentClient: failingClose(x.times), run: async ({ R, keep }) => {
  await R.begin('probe');
  await R.agentRead('plateway.restaurants.search', { address_id: 'a-1' });
  keep.agent = true;
  assert.fail('deliberate assertion failure inside a probe');
} }));

const FAILING = {
  probe: 'assertion failure inside a probe',
  run: async ({ page, R, res, keep }) => {
    await R.begin('probe');
    keep.server = await res.server(brokenReply);
    keep.route = await res.route(page, '**/api/call', route => route.continue().catch(() => {}));
    await R.agentRead('plateway.restaurants.search', { address_id: 'a-1' });
    keep.agent = true;
    assert.fail('deliberate assertion failure inside a probe');
  }
};

async function runOne(probe, env, keep = {}) {
  const res = resources();
  const shots = fs.mkdtempSync(path.join(os.tmpdir(), 'plateway-probe-shots-'));
  let context = null, infra = null, R = null, result, error = null;
  try {
    infra = new env.Client('plateway', 'infra', env.host.run, env.host.stateDir, 'recorder-probe-inspector', { registry: env.host.registry });
    await infra.initialize();
    context = await env.browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    keep.page = page;
    R = createRecorder({ page, infra, host: env.host, Client: probe.agentClient ? probe.agentClient(env.Client) : env.Client, session: 'probe', writes: env.writes, previews: env.previews });
    keep.recorder = R;
    await page.goto(env.host.accessUrl);
    await page.locator('[data-restaurant-id]').first().waitFor();
    await settled(page);
    result = await probe.run({ page, R, res, shots, keep });
  } catch (e) { error = e; }
  const problems = await closeEach([
    ['probe resources', () => res.close()],
    ['second Agent client', async () => {
      if (!R) return [];
      const failures = [], notes = [];
      for (let attempt = 0; attempt < 3 && !R.agentClosed(); attempt++) {
        try { await R.close(); } catch (e) { failures.push(firstLine(e)); }
      }
      if (failures.length) notes.push('close failed ' + failures.length + (failures.length === 1 ? ' time' : ' times') + ' (' + failures[0] + ')');
      if (!R.agentClosed()) { await R.kill(); notes.push(R.agentClosed() ? 'killed after ' + failures.length + ' failed closes' : 'still running after kill'); }
      return notes;
    }],
    ['inspector client', async () => { if (infra) await infra.close(); }],
    ['browser context', async () => { if (context) await context.close(); if (keep.page && !keep.page.isClosed()) throw Error('the probe page is still open'); }],
    ['screenshot folder', async () => { fs.rmSync(shots, { recursive: true, force: true }); if (fs.existsSync(shots)) throw Error('still present'); }]
  ]);
  keep.problems = problems;
  if (error) {
    if (problems.length) error.message += ' (cleanup also failed: ' + problems.join('; ') + ')';
    throw error;
  }
  if (problems.length) throw Error('Probe cleanup failed (' + probe.probe + '): ' + problems.join('; '));
  return result;
}

async function runProbes({ root, chromium, launchArgs = [], writes, previews }) {
  const { start } = require(path.join(root, 'runtime/web/server.cjs'));
  const { Client } = require(path.join(root, 'runtime/client.cjs'));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plateway-recorder-probes-'));
  let host = null, browser = null, error = null;
  const results = [];
  try {
    host = await start({ app: 'plateway', stateDir, run: 'plateway-recorder-probes', profile: 'sandbox', registry: path.join(root, 'apps.registry.json') });
    browser = await chromium.launch({ headless: true, args: launchArgs });
    const env = { host, browser, Client, writes, previews };
    for (const probe of PROBES) results.push({ probe: probe.probe, does: probe.does, ...(await runOne(probe, env)) });
    const keep = {};
    let message = null;
    try { await runOne(FAILING, env, keep); } catch (e) { message = firstLine(e); }
    assert.equal(message, 'deliberate assertion failure inside a probe', 'The failing probe did not stop with its assertion');
    assert.deepEqual(keep.problems, [], 'Closing the failed probe\'s resources did not take effect: ' + keep.problems.join('; '));
    const closed = { http_server: !keep.server.listening, route: keep.route.removed, page: keep.page.isClosed(), second_agent: keep.agent === true && keep.recorder.agentClosed() };
    assert.deepEqual(closed, { http_server: true, route: true, page: true, second_agent: true }, 'A probe that failed an assertion left resources open');
    results.push({ probe: FAILING.probe, does: 'A probe opens an HTTP server, a route and a second Agent client, then fails an assertion', stopped_with: message, closed_in_finally: ['HTTP server (no longer listening)', 'route (removed, and a request afterwards no longer reaches it)', 'second Agent client (its process exited)', 'browser page (closed)'] });
    for (const f of FAILING_CLOSES) {
      const k = {};
      let m = null;
      try { await runOne(f, env, k); } catch (e) { m = firstLine(e); }
      assert.equal(m, 'deliberate assertion failure inside a probe (cleanup also failed: ' + f.cleanup + ')', 'The probe error does not carry its cleanup failures');
      assert.equal(k.recorder.agentClosed(), true, 'The second Agent client is still running after the probe teardown');
      results.push({ probe: f.probe, does: 'A probe fails an assertion while closing its second Agent client fails ' + (f.times === 1 ? 'once' : 'every time'), stopped_with: m, second_agent_exited: true });
    }
  } catch (e) { error = e; }
  const problems = await closeEach([
    ['probe browser', async () => { if (!browser) return; await browser.close(); if (browser.isConnected()) throw Error('still connected after close'); }],
    ['probe Host', async () => { if (host) await host.close(); }],
    ['probe state folder', async () => { fs.rmSync(stateDir, { recursive: true, force: true }); if (fs.existsSync(stateDir)) throw Error('still present'); }]
  ]);
  if (error) { if (problems.length) error.message += ' (cleanup also failed: ' + problems.join('; ') + ')'; throw error; }
  if (problems.length) throw Error('Probe suite cleanup failed: ' + problems.join('; '));
  return results;
}

module.exports = { runProbes };
