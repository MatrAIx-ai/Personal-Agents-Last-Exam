'use strict';
const WALL_CLOCK = 'host wall-clock time, left out so that repeated captures are identical';
const withoutWallClock = r => r && r.trace ? { ...r, trace: { ...r.trace, ...(r.trace.received_at !== undefined ? { received_at: WALL_CLOCK } : {}), ...(r.trace.processed_at !== undefined ? { processed_at: WALL_CLOCK } : {}) } } : r;
const PAGE = 'the page in the browser (POST /api/call)';
const FORCED = 'the page\'s business session, sent directly to /api/call';
const AGENT = 'second Agent MCP client';
const INFRA = 'Infra MCP client';
const firstLine = e => String(e && e.message || e).split('\n')[0];

function createRecorder({ page, infra, host, Client, session, writes, previews, limit = 10000 }) {
  const errors = [], records = [], owners = [], byRequest = new Map(), forcedTokens = new Map();
  const limbo = { label: 'no active step', kind: 'none', recs: [], pending: new Set(), dispatched: 0, frozen: false, sealing: false, sealed: false };
  let current = null, last = 'the start', closed = false, seqId = null, n = 0, other = null, lastAgent = null, requests = 0, forcedCount = 0, tick = 0;

  const owner = (label, kind) => { const b = { label, kind, recs: [], pending: new Set(), dispatched: 0, frozen: false, sealing: false, sealed: false }; owners.push(b); current = b; return b; };
  const fail = message => { errors.push(message); };
  const raise = () => { if (errors.length) throw Error('Recorder error: ' + [...errors].sort().join('; ')); };
  const stop = message => { fail(message); raise(); };

  const own = rec => {
    const b = current;
    rec.dispatchedAt = ++tick;
    if (!b) {
      rec.owner = limbo;
      limbo.recs.push(rec);
      limbo.pending.add(rec);
      fail(rec.label + (closed ? ' dispatched after the last sequence closed' : ' dispatched with no active step (after ' + last + ')'));
      return false;
    }
    rec.owner = b;
    b.recs.push(rec);
    b.dispatched += 1;
    b.pending.add(rec);
    if (b.sealing) { fail(rec.label + ' dispatched while ' + b.label + ' was being sealed'); return false; }
    if (b.frozen) { fail(rec.label + ' dispatched after ' + b.label + ' was frozen'); return false; }
    return true;
  };

  const record = (label, entry, resultKey = 'result') => {
    let done;
    const settled = new Promise(resolve => { done = resolve; });
    const rec = { label, entry, resultKey, settled, done, owner: null, status: null, terminal: null, outcomes: 0, closed: false, dispatchedAt: null, closedAt: null };
    records.push(rec);
    return rec;
  };

  const claim = (rec, outcome) => {
    rec.outcomes += 1;
    if (rec.terminal) { fail(rec.label + ', started in ' + rec.owner.label + ', received a second terminal outcome (' + outcome + ' after ' + rec.terminal + ')'); return false; }
    rec.terminal = outcome;
    return true;
  };

  const complete = (rec, { http, result, failure }) => {
    if (rec.entry) {
      if ('http' in rec.entry) rec.entry.http = http === undefined ? null : http;
      rec.entry[rec.resultKey] = failure === undefined ? result : null;
      if (failure !== undefined) rec.entry.failure = failure;
    }
    if (failure !== undefined) fail(rec.label + ', started in ' + rec.owner.label + ', failed ' + (http ? 'after its headers (HTTP ' + http + ')' : 'before any reply') + ': ' + failure);
    if (rec.owner.sealed) fail('the outcome of ' + rec.label + ' arrived after ' + rec.owner.label + ' was sealed');
    rec.closed = true;
    rec.closedAt = ++tick;
    rec.owner.pending.delete(rec);
    rec.done();
  };

  const classify = req => {
    let url;
    try { url = new URL(req.url()); } catch { return null; }
    if (req.method() === 'GET' && url.pathname === '/api/tools') return record('GET /api/tools (page discovery)', null);
    if (req.method() !== 'POST' || url.pathname !== '/api/call') return null;
    let body = null;
    try { body = req.postDataJSON(); } catch { body = null; }
    const name = body && typeof body.name === 'string' ? body.name : 'an unreadable call';
    const args = body ? body.arguments : null;
    const token = req.headers()['x-evidence-forced'];
    if (token !== undefined) {
      const f = forcedTokens.get(token);
      if (!f) fail('the unknown forced-call token ' + token + ' was sent with ' + name);
      else if (f.seen) fail('the forced-call token ' + token + ' was sent a second time, with ' + name);
      else if (name !== f.tool || JSON.stringify(args) !== f.args) fail('the forced-call token ' + token + ' was sent with ' + name + ' and other arguments than the ' + f.tool + ' call it was issued for');
      else {
        f.seen = true;
        return record(name + ' (forced call)', { client: FORCED, kind: 'forced call', tool: name, arguments: args, http: null, result: null });
      }
    }
    const kind = writes.has(name) ? 'write' : previews.has(name) ? 'preview' : 'read';
    return record(name + ' (page ' + kind + ')', kind === 'read' ? null : { client: PAGE, kind, tool: name, arguments: args, http: null, result: null });
  };

  page.on('request', req => {
    const rec = classify(req);
    if (!rec) return;
    byRequest.set(req, rec);
    own(rec);
  });
  page.on('response', res => {
    const rec = byRequest.get(res.request());
    if (rec && !rec.terminal) rec.status = res.status();
  });
  page.on('requestfinished', async req => {
    const rec = byRequest.get(req);
    if (!rec || !claim(rec, 'reply')) return;
    let res = null;
    try {
      res = await req.response();
      if (!res) throw Error('no response');
      complete(rec, { http: res.status(), result: rec.entry ? await res.json() : undefined });
    } catch (e) {
      complete(rec, { http: res ? res.status() : rec.status, failure: 'the reply body could not be read: ' + firstLine(e) });
    }
  });
  page.on('requestfailed', req => {
    const rec = byRequest.get(req);
    if (!rec || !claim(rec, 'failure')) return;
    complete(rec, { http: rec.status, failure: req.failure() ? req.failure().errorText : 'failed' });
  });

  const mcp = async ({ label, entry, resultKey, view = r => r, send }) => {
    const rec = record(label, entry, resultKey);
    if (!own(rec)) {
      rec.terminal = 'not sent';
      rec.closed = true;
      rec.closedAt = ++tick;
      rec.owner.pending.delete(rec);
      rec.done();
      raise();
    }
    let r;
    try { r = await send(); }
    catch (e) { if (claim(rec, 'failure')) complete(rec, { failure: firstLine(e) }); raise(); throw e; }
    if (claim(rec, 'reply')) complete(rec, { result: view(r) });
    return r;
  };

  const infraSend = infra.call.bind(infra);
  const infraCall = (tool, args, { shown, view } = {}) => {
    if (tool === 'env.snapshot') return mcp({ label: 'env.snapshot (Infra inspector read)', entry: null, send: () => infraSend(tool, args) });
    const kind = tool === 'env.apply_event' ? 'event' : tool === 'env.advance_time' ? 'clock' : 'management';
    return mcp({ label: tool + ' (Infra ' + kind + ')', entry: { client: INFRA, kind, tool, arguments: shown || args, result: null }, view: view || (kind === 'management' ? r => r : withoutWallClock), send: () => infraSend(tool, args) });
  };
  infra.call = (tool, args) => infraCall(tool, args);
  const version = async () => (await infra.call('env.snapshot')).version;

  const agent = async () => {
    if (!other) { other = new Client('plateway', 'agent', host.run, host.stateDir, 'evidence-second-agent', { registry: host.registry }); lastAgent = other; await other.initialize(); }
    return other;
  };
  const agentRead = async (tool, args, pick = x => x) => {
    const c = await agent();
    return mcp({ label: tool + ' (second Agent read)', entry: { client: AGENT, kind: 'read', tool, arguments: args, result_summary: null }, resultKey: 'result_summary', view: pick, send: () => c.call(tool, args) });
  };
  const agentWrite = async (tool, args) => {
    const v = await version();
    const full = { ...args, request_id: 'evidence-' + session + '-' + (++requests), expected_version: v };
    const c = await agent();
    return mcp({ label: tool + ' (second Agent write)', entry: { client: AGENT, kind: 'write', tool, arguments: full, result: null }, send: () => c.call(tool, full) });
  };
  const event = async ev => {
    const r = await infra.call('env.apply_event', { expected_version: await version(), event: ev });
    if (r.status !== 'committed') throw Error('Infra event ' + ev.event_id + ': ' + JSON.stringify(r));
    return r;
  };
  const advance = async at => {
    const r = await infra.call('env.advance_time', { expected_version: await version(), virtual_now: at, request_id: 'evidence-clock-' + at });
    if (r.status !== 'committed') throw Error('Clock advance: ' + JSON.stringify(r));
    return r;
  };
  const management = async (tool, args, shown, view) => infraCall(tool, { expected_version: await version(), ...args }, { shown, view });
  const forced = async (tool, args) => {
    const token = session + '-' + (++forcedCount);
    forcedTokens.set(token, { tool, args: JSON.stringify(args), seen: false });
    const r = await page.evaluate(async ({ name, args, token }) => {
      const { csrf } = await (await fetch('/session')).json();
      const res = await fetch('/api/call', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pale-CSRF': csrf, 'X-Evidence-Forced': token }, body: JSON.stringify({ name, arguments: args }) });
      return { http: res.status, body: await res.json() };
    }, { name: tool, args, token });
    if (!forcedTokens.get(token).seen) fail('the forced call ' + tool + ' was not seen leaving the page');
    return r;
  };

  const drain = async (b, ms = limit) => {
    const until = Date.now() + ms;
    while (b.pending.size) {
      const pending = [...b.pending], left = until - Date.now();
      if (left <= 0) stop('still outstanding after ' + ms + ' ms: ' + pending.map(p => p.label + ', started in ' + b.label).join('; '));
      let timer;
      await Promise.race([Promise.all(pending.map(p => p.settled)), new Promise(resolve => { timer = setTimeout(resolve, left); })]);
      clearTimeout(timer);
    }
    raise();
  };

  const closeCurrent = async () => {
    const b = current;
    if (!b) { raise(); return null; }
    await drain(b);
    b.frozen = true;
    b.sealing = true;
    await drain(b);
    b.sealed = true;
    current = null;
    if (b.kind === 'step') {
      last = 'sequence ' + seqId + ' closed';
      for (const rec of b.recs) fail(rec.label + ' made after the last step of ' + seqId + ', outside any step');
    } else if (b.kind === 'setup') {
      last = 'the setup closed';
      for (const rec of b.recs.filter(r => r.entry)) fail(rec.label + ' made during the setup, outside any step');
    } else last = b.label + ' closed';
    raise();
    return b;
  };

  const begin = async id => {
    if (closed) stop('sequence ' + id + ' began after the last sequence closed');
    await closeCurrent();
    seqId = id;
    n = 1;
    owner(id + ' step 1', 'step');
  };

  const step = async ({ check, observe = () => null, prepare = async () => {}, record: keep = () => {}, capture = async () => {}, limit: ms = limit }) => {
    const b = current;
    if (!b || b.kind !== 'step') stop('a step was recorded outside a sequence');
    const checked = await version();
    const ok = await check();
    let frozen;
    for (let i = 0; ; i++) {
      await drain(b, ms);
      const before = b.dispatched;
      frozen = await infra.call('env.snapshot');
      if (!b.pending.size && b.dispatched === before + 1) break;
      if (i === 5) stop(b.label + ' kept dispatching calls while its state was read');
    }
    b.frozen = true;
    if (JSON.stringify(frozen.version) !== JSON.stringify(checked)) fail(b.label + ': the App\'s version changed between the step\'s check and its freeze');
    raise();
    const calls = b.recs.filter(r => r.entry).map(r => r.entry);
    const observed = await observe(frozen.snapshot.data, frozen.snapshot);
    await prepare();
    raise();
    keep({ ok, version: frozen.version, snapshot: frozen.snapshot, observed, calls });
    await capture();
    b.sealing = true;
    await drain(b, ms);
    b.sealed = true;
    raise();
    n += 1;
    owner(seqId + ' step ' + n, 'step');
  };

  const aside = async (label, fn) => {
    if (closed) stop(label + ' began after the last sequence closed');
    await closeCurrent();
    owner(label, 'aside');
    const out = await fn();
    const b = await closeCurrent();
    return { out, calls: b.recs.filter(r => r.entry).map(r => r.entry) };
  };

  const finish = async () => { await closeCurrent(); closed = true; };
  const quiet = async (ms = limit) => {
    const until = Date.now() + ms;
    while (records.some(r => !r.closed) && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 20));
  };
  const leftovers = () => [...errors, ...records.filter(r => !r.closed).map(r => r.label + ', started in ' + (r.owner ? r.owner.label : 'nothing') + ', never finished')];
  const agentClosed = () => !lastAgent || lastAgent.child.exitCode !== null || lastAgent.child.signalCode !== null;
  const kill = async () => {
    if (agentClosed()) return;
    const c = lastAgent;
    const exited = new Promise(resolve => c.child.once('exit', resolve));
    c.child.kill('SIGKILL');
    let timer;
    await Promise.race([exited, new Promise(resolve => { timer = setTimeout(resolve, 2000); })]);
    clearTimeout(timer);
    if (agentClosed()) other = null;
  };
  const close = async () => {
    if (!other) return;
    const c = other;
    try { await c.close(); } catch (e) { stop('closing the second Agent client failed: ' + firstLine(e)); }
    if (c.child.exitCode === null && c.child.signalCode === null) stop('the second Agent client is still running after close');
    other = null;
  };

  owner('the setup', 'setup');
  return { begin, step, aside, finish, closeSequence: closeCurrent, agentRead, agentWrite, event, advance, management, forced, verify: raise, quiet, leftovers, close, records: () => records, owners: () => owners, agentClosed, kill, version };
}

module.exports = { createRecorder, withoutWallClock, WALL_CLOCK };
