'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const assert = require('node:assert/strict');
const appDir = path.resolve(__dirname, '..', '..');
const FINAL = path.join(appDir, 'evidence', 'gui');
let OUT = null;
let scratch = null;
let OPTS = { date: null };
const { runWebAcceptance, root } = require('../../tests/web/harness.cjs');
const { workflows, restrictedRun } = require('../../tests/web.browser.cjs');
const { Client } = require(path.join(root, 'runtime/client.cjs'));
const { runtimeDigest, hostRevision } = require('./digest.cjs');
const { createRecorder } = require('./recorder.cjs');
const { runProbes } = require('./probes.cjs');
const { options } = require('./options.cjs');
const { chromium } = require('playwright');

const APP = 'mendwell-pharmacy';
const COMMAND = 'node apps/mendwell-pharmacy/evidence/tools/gui.cjs';
const RASTER = ['--disable-gpu', '--num-raster-threads=1', '--disable-partial-raster'];
const TIMEZONE = 'Asia/Tokyo';
const read = file => JSON.parse(fs.readFileSync(path.join(appDir, file), 'utf8'));
const TOOLS = read('tools.json');
const WRITES = new Set(TOOLS.filter(x => (x.inputSchema.required || []).includes('request_id')).map(x => x.name));
const PREVIEWS = new Set(TOOLS.filter(x => x.name.endsWith('.preview')).map(x => x.name));
const FIXTURE = read('fixtures/minimal.json');
const POLICIES = read('fixtures/policies.json');
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const vstr = v => v.epoch + '.' + v.revision;
const OUTLINE = [217, 72, 15];

function decodePng(buf) {
  let p = 8, w = 0, h = 0, depth = 0, type = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), kind = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (kind === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; if (data[12]) throw Error('interlaced PNG'); }
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8 || ![2, 6].includes(type)) throw Error('unsupported PNG (bit depth ' + depth + ', colour type ' + type + ')');
  const bpp = type === 6 ? 4 : 3, stride = w * bpp, raw = zlib.inflateSync(Buffer.concat(idat)), out = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), o = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[o + x - bpp] : 0, b = y ? out[o - stride + x] : 0, c = x >= bpp && y ? out[o - stride + x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[o + x] = v & 255;
    }
  }
  return { w, h, px: (x, y) => { const i = y * stride + x * bpp; return [out[i], out[i + 1], out[i + 2]]; } };
}

function outlineShown(png, box, viewport) {
  const img = decodePng(png), sx = img.w / viewport.width, sy = img.h / viewport.height;
  const left = box.x - 3.5, right = box.x + box.width + 3.5, top = box.y - 3.5, bottom = box.y + box.height + 3.5;
  const sides = { top: [], bottom: [], left: [], right: [] };
  for (let x = left + 12; x <= right - 12; x += 3) { sides.top.push([x, top]); sides.bottom.push([x, bottom]); }
  for (let y = top + 12; y <= bottom - 12; y += 3) { sides.left.push([left, y]); sides.right.push([right, y]); }
  const seen = {};
  for (const [side, points] of Object.entries(sides)) {
    let inside = 0, hit = 0;
    for (const [x, y] of points) {
      const px = Math.floor(x * sx), py = Math.floor(y * sy);
      if (px < 0 || py < 0 || px >= img.w || py >= img.h) continue;
      inside += 1;
      if (img.px(px, py).every((v, i) => Math.abs(v - OUTLINE[i]) <= 24)) hit += 1;
    }
    seen[side] = { inside, hit };
  }
  const full = Object.keys(seen).filter(k => seen[k].inside >= 8 && seen[k].hit >= 0.8 * seen[k].inside);
  return { sides: seen, full, ok: full.length > 0 };
}

const SCOPES = {
  'w1-grants': ['Household access and grants', 'Approved workflow W1; GUI added at the platform reviewer\'s request'],
  'w2-prescriptions': ['Prescriptions, renewals and fill requests', 'Approved workflow W2; GUI added at the platform reviewer\'s request'],
  'w3-claims': ['Fills, insurance claims and plan requests', 'Approved workflow W3; GUI added at the platform reviewer\'s request'],
  'w1-lost-visibility': ['Household access and grants', 'Approved workflow W1, access changes while the page is open'],
  'w4-holds': ['Holds and store changes', 'Approved workflow W4; GUI added at the platform reviewer\'s request'],
  'w5-collection': ['Prepay, pickup by someone else and cancellation', 'Approved workflow W5; GUI added at the platform reviewer\'s request'],
  platform: ['Business-only access and layout', 'Platform rules for the GUI'],
  account: ['Account and stores', 'Read-only account view (evidence script only)'],
  restricted: ['Resets, reloads and policy', 'Platform rules for the GUI, on a separate fresh run']
};

const KEYS = { people: 'person_id', prescribers: 'prescriber_id', drugs: 'drug_id', plans: 'plan_id', stores: 'store_id', cards: 'card_id', prescriptions: 'rx_id', fills: 'fill_id', claims: 'claim_id', authorizations: 'authorization_id', charges: 'charge_id', grants: 'grant_id', plan_requests: 'plan_request_id', renewals: 'renewal_id', approvals: 'approval_id', notices: 'notice_id' };
const compact = v => { const s = JSON.stringify(v); return s !== undefined && s.length <= 160 ? v : '(changed, ' + (s === undefined ? 0 : s.length) + ' characters)'; };
function changes(before, after) {
  const out = {};
  for (const key of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    const a = before ? before[key] : undefined, b = after ? after[key] : undefined;
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (!Array.isArray(a) || !Array.isArray(b)) { out[key] = compact(b); continue; }
    const idOf = (r, i) => (r && typeof r === 'object' && KEYS[key] && r[KEYS[key]]) || (r && typeof r === 'object' && r.drug_id && r.plan_id ? r.plan_id + '/' + r.drug_id : '#' + i);
    const ma = new Map(a.map((r, i) => [idOf(r, i), r])), mb = new Map(b.map((r, i) => [idOf(r, i), r]));
    const added = [...mb.keys()].filter(k => !ma.has(k)), removed = [...ma.keys()].filter(k => !mb.has(k));
    const changed = {};
    for (const [k, r] of mb) {
      if (!ma.has(k) || JSON.stringify(ma.get(k)) === JSON.stringify(r)) continue;
      const fields = {};
      for (const f of new Set([...Object.keys(ma.get(k)), ...Object.keys(r)])) if (JSON.stringify(ma.get(k)[f]) !== JSON.stringify(r[f])) fields[f] = compact(r[f]);
      changed[k] = fields;
    }
    const entry = {};
    if (added.length) entry.added = key === 'notices' ? added.map(k => k + ' ' + mb.get(k).kind + ' to ' + mb.get(k).recipient_id) : added.map(k => { const r = mb.get(k); return k + (r.state ? ' ' + r.state : r.status ? ' ' + r.status : ''); });
    if (removed.length) entry.removed = removed;
    if (Object.keys(changed).length) entry.changed = changed;
    out[key] = entry;
  }
  return out;
}

const PICK = ['state', 'status', 'view', 'scope', 'patient_id', 'grantee_id', 'store_id', 'quantity', 'amount_due_cents', 'decision', 'reason', 'token', 'new_rx_id', 'fills_remaining', 'expires_at'];
const idOfAny = x => { const k = Object.keys(x).find(k => /_id$/.test(k)); return k ? x[k] : null; };
const isVersion = v => !!v && typeof v === 'object' && !Array.isArray(v) && Number.isInteger(v.epoch) && Number.isInteger(v.revision);
const brief = x => {
  if (!x || typeof x !== 'object') return x;
  if (isVersion(x)) return vstr(x);
  if (Array.isArray(x)) return x.length + ' item(s)' + (x.length ? ': ' + x.slice(0, 15).map(r => (r && typeof r === 'object' ? [idOfAny(r), r.state || r.status || r.scope].filter(Boolean).join(' ') : String(r))).join(', ') + (x.length > 15 ? ', …' : '') : '');
  const o = {};
  const id = idOfAny(x);
  if (id) o.id = id;
  for (const k of PICK) if (x[k] !== undefined && (typeof x[k] !== 'object' || x[k] === null)) o[k] = x[k];
  if (isVersion(x.version)) o.version = vstr(x.version);
  return o;
};
const digestRead = r => (r && typeof r === 'object' && !Array.isArray(r) ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Array.isArray(v) || (v && typeof v === 'object') ? brief(v) : v])) : r);
const removedTools = policies => { const out = new Set(); for (const [role, p] of Object.entries(POLICIES)) for (const n of p.allow || []) if (!((policies[role] || {}).allow || []).includes(n)) out.add(n); return [...out]; };
const summarize = (tool, args) => {
  if (tool !== 'env.load_seed') return args;
  const out = { ...args };
  if (args.data) out.data = JSON.stringify(args.data) === JSON.stringify(FIXTURE) ? 'fixtures/minimal.json (seed ' + FIXTURE.seed_id + ')' : 'a seed of ' + JSON.stringify(args.data).length + ' characters, SHA-256 ' + sha(JSON.stringify(args.data));
  if (args.policies) { const gone = removedTools(args.policies); out.policies = 'fixtures/policies.json' + (gone.length ? ' without ' + gone.join(', ') : ''); }
  if (args.binding) out.binding = 'binding of ' + (args.binding.accounts || []).length + ' accounts';
  return out;
};

const sequences = [];
const outlines = [];
const recorders = [];
const extra = { probes: null, start: null };

function stableIds(context) {
  return context.addInitScript(prefix => {
    const next = () => { const m = document.cookie.match(/(?:^|; )evidence_request_ids=(\d+)/); const n = (m ? Number(m[1]) : 0) + 1; document.cookie = 'evidence_request_ids=' + n + '; path=/; SameSite=Strict'; return n; };
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => prefix + '-' + String(next()).padStart(4, '0') });
  }, 'evidence');
}

function instrument(t, session) {
  const { page } = t;
  const R = createRecorder({ app: APP, page, infra: t.infra, host: t.host, Client, session, writes: WRITES, previews: PREVIEWS, summarize, digest: digestRead, limit: 30000 });
  recorders.push({ session, R });
  let stepChecks = [];
  const et = { ...t };
  et.check = (name, ok) => { const r = t.check(name, ok); stepChecks.push(name); return r; };
  et.agent = (name, args = {}) => R.hostCall(APP + '.' + name, args);
  et.business = (name, args) => R.forced(name, args);
  et.confirm = (token, by) => R.confirmed(token, by, () => t.confirm(token, by));
  et.host = { ...t.host, client: { call: (name, args) => R.hostCall(name, args), request: method => R.hostDiscovery(method) } };
  const chosen = test => {
    const pick = { payload: null };
    pick.test = p => { const ok = test(p); if (ok && pick.payload === null) pick.payload = JSON.stringify(p); return ok; };
    pick.match = (req, body) => !!body && pick.payload !== null && JSON.stringify(body) === pick.payload;
    return pick;
  };
  et.dropAfterCommit = match => { const c = chosen(match); R.induce(c.match, 'the evidence harness forwarded this call to Mendwell, kept its committed reply and dropped the connection before the page saw it', true); return t.dropAfterCommit(c.test); };
  et.dropBeforeSend = match => { const c = chosen(match); R.induce(c.match, 'the evidence harness dropped this call before it reached Mendwell'); return t.dropBeforeSend(c.test); };
  et.beforeForward = (match, during, failNext = false) => {
    if (!failNext) return t.beforeForward(match, during, failNext);
    const c = chosen(typeof failNext === 'function' ? failNext : () => failNext === true);
    R.induce(c.match, 'the evidence harness dropped this call before it reached Mendwell, after the change it applies while the page reads');
    return t.beforeForward(match, during, c.test);
  };
  et.failNextDiscovery = () => { R.induce(req => req.method() === 'GET' && new URL(req.url()).pathname === '/api/tools', 'the evidence harness dropped this tool discovery before it reached the Host'); return t.failNextDiscovery(); };
  let previous = null, seq = null, n = 0;

  const run = async (workflow, index, step, last) => {
    if (index === 0) {
      if (!previous) await stableIds(page.context());
      await R.begin(workflow.seq);
      const [name, scope] = SCOPES[workflow.id] || [workflow.title, 'GUI'];
      seq = { id: workflow.seq, title: workflow.title.replace(/^W\d\s+/, ''), workflow: name, scope, run: t.host.run, summary: workflow.summary || '', evidence_only: !!workflow.evidenceOnly, steps: [] };
      sequences.push(seq);
      n = 0;
      fs.mkdirSync(path.join(OUT, workflow.seq), { recursive: true });
      if (!previous) {
        const s0 = await t.snapshot();
        previous = s0.data;
        if (session === 'main') extra.start = { virtual_now: s0.virtual_now, seed_id: s0.data.seed_id, account_id: s0.data.account_id, owner_person_id: s0.data.owner_person_id, time_zone: s0.data.time_zone };
      }
    }
    stepChecks = [];
    const summary = String(await step.run(t) || '').split(t.stateDir).join('<the Web Host state directory>').split(os.tmpdir()).join('<temporary directory>');
    await t.settled();
    n += 1;
    const file = path.join(workflow.seq, String(n).padStart(2, '0') + '-' + step.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) + '.png');
    const checks = stepChecks.slice();
    let outlined = null, box = null;
    await R.step({
      check: async () => checks.length > 0,
      observe: data => { const c = changes(previous, data); previous = data; return c; },
      prepare: async () => {
        await t.idle();
        await page.mouse.move(1, 1);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(400);
        await page.evaluate(() => scrollTo(0, 0));
        const loc = page.locator(step.focus).first();
        assert.ok(await loc.count(), seq.title + ', step ' + n + ': the element the step checks (' + step.focus + ') is not on the page');
        await loc.scrollIntoViewIfNeeded();
        outlined = await loc.elementHandle();
        await outlined.evaluate(e => { e.dataset.evidenceOutline = e.style.outline || ''; e.style.outline = '3px solid #d9480f'; e.style.outlineOffset = '2px'; });
        box = await loc.boundingBox();
        const vp = page.viewportSize();
        assert.ok(box && await loc.isVisible() && box.y < vp.height && box.y + box.height > 0 && box.x < vp.width && box.x + box.width > 0, seq.title + ', step ' + n + ': the element the step checks (' + step.focus + ') is not on screen');
      },
      record: ({ version, snapshot: s, observed, calls }) => {
        seq.steps.push({ step: n, title: step.title, action: step.action, expected: step.expected, result: 'as expected', submits: calls.some(c => (c.kind === 'write' || c.kind === 'forced call') && c.reached_host !== false), checked_element: step.focus, observed: { summary: summary || '', changes_since_previous_step: observed }, version: vstr(version), virtual_now: s.virtual_now, mcp_calls: calls, acceptance_checks: checks, screenshot: file });
      },
      capture: async () => {
        const png = await page.screenshot({ path: path.join(OUT, file), animations: 'disabled' });
        const shown = outlineShown(png, box, page.viewportSize());
        assert.ok(shown.ok, seq.title + ', step ' + n + ': the outline of the checked element (' + step.focus + ') is not in the screenshot (' + JSON.stringify(shown.sides) + ')');
        outlines.push({ screenshot: file, sides_drawn: shown.full });
        if (outlined) await outlined.evaluate(e => { e.style.outline = e.dataset.evidenceOutline; e.style.outlineOffset = ''; delete e.dataset.evidenceOutline; }).catch(() => {});
      }
    });
    if (last) { await R.finish(); await R.close(); }
    return summary;
  };
  return { R, et, run };
}

function accountWorkflow(t) {
  const { page } = t;
  return { id: 'account', evidenceOnly: true, title: 'Account and stores', summary: 'An evidence-only step, not part of tests/web.browser.cjs: the read-only Account section at desktop width, compared with the App\'s own reads.', steps: [
    { title: 'Account shows the holder, cards and stores', action: 'Set the viewport back to 1280 × 900 and open Account', expected: 'The holder and the time zone, each of the holder\'s cards masked with its expiry month, and the three stores with address, weekly hours and whether each is open now, as cards.list and stores.list return them', focus: '[data-list=account]',
      run: async () => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.locator('nav').getByRole('button', { name: /Account/ }).click();
        await t.idle();
        await t.settled();
        const cards = (await t.agent('cards.list')).cards, stores = (await t.agent('stores.list')).stores;
        const shownCards = await page.locator('[data-list=account] [data-card-id]').evaluateAll(n => n.map(e => e.dataset.cardId));
        const shownStores = await page.locator('[data-store]').evaluateAll(n => n.map(e => [e.dataset.store, e.innerText.includes('Open now')]));
        t.check('Evidence script only: Account names the holder and lists exactly the cards cards.list returns and the stores stores.list returns, each with its open-now state', (await page.locator('[data-list=account] .record-title').first().innerText()).trim() === 'Alex Rivera' && JSON.stringify(shownCards) === JSON.stringify(cards.map(c => c.card_id)) && JSON.stringify(shownStores) === JSON.stringify(stores.map(s => [s.store_id, s.open_now])));
        return 'cards.list: ' + cards.map(c => c.card_id + ' •••• ' + c.last4 + ' ' + String(c.exp_month).padStart(2, '0') + '/' + c.exp_year).join(', ') + '; stores.list: ' + stores.map(s => s.store_id + (s.open_now ? ' open' : ' closed')).join(', ');
      } }
  ] };
}

function mainWorkflows(t) {
  const { et, run } = instrument(t, 'main');
  const list = [...workflows(et), accountWorkflow(et)];
  return list.map((w, wi) => {
    w.seq = String(wi + 1).padStart(2, '0') + '-' + w.id;
    return { ...w, steps: w.steps.map((s, si) => ({ ...s, run: () => run(w, si, s, wi === list.length - 1 && si === w.steps.length - 1) })) };
  });
}

async function restricted(t) {
  const { et, run } = instrument(t, 'restricted');
  const w = restrictedRun(et);
  w.seq = String(sequences.length + 1).padStart(2, '0') + '-' + w.id;
  for (const [si, s] of w.steps.entries()) await run(w, si, s, si === w.steps.length - 1);
}

function publish(staging, final) {
  fs.mkdirSync(final, { recursive: true });
  for (const e of fs.readdirSync(final)) fs.rmSync(path.join(final, e), { recursive: true, force: true });
  fs.cpSync(staging, final, { recursive: true });
}

async function main() {
  OPTS = options(process.argv.slice(2));
  OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'mendwell-gui-capture-'));
  try { if (await capture()) publish(OUT, FINAL); }
  finally { fs.rmSync(OUT, { recursive: true, force: true }); }
}

async function capture() {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mendwell-gui-evidence-'));
  process.env.PALE_WEB_REPORT_DIR = scratch;
  extra.probes = await runProbes({ root, chromium, launchArgs: RASTER, writes: WRITES, previews: PREVIEWS });
  try { await runWebAcceptance({ app: APP, appDir, workflows: mainWorkflows, restricted, timezoneId: TIMEZONE, strictChecks: true, launchArgs: RASTER }); }
  finally { for (const r of recorders) await r.R.close().catch(() => {}); }
  const report = JSON.parse(fs.readFileSync(path.join(scratch, 'report.json'), 'utf8'));
  const leftover = recorders.flatMap(r => r.R.leftovers().map(e => r.session + ': ' + e));
  if (report.passed && leftover.length) { console.error('Recorder error during teardown: ' + leftover.join('; ')); process.exitCode = 1; return; }
  fs.rmSync(scratch, { recursive: true, force: true });
  if (!report.passed) { console.error(report.error); process.exitCode = 1; return; }
  const digest = runtimeDigest(appDir);
  const RUN_LEVEL = 'checked by tests/web/harness.cjs after the last step of the run, over the whole run, so it belongs to no step';
  const pending = sequences.flatMap(s => s.steps.flatMap(st => st.acceptance_checks.map(c => s.run + '\n' + c)));
  const runLevel = [];
  for (const [r, list] of [[APP + '-web', report.checks], [APP + '-web-restricted', report.restricted ? report.restricted.checks : []]]) for (const c of list) {
    const i = pending.indexOf(r + '\n' + c);
    if (i >= 0) pending.splice(i, 1);
    else runLevel.push({ run: r, check: c, when: RUN_LEVEL });
  }
  assert.deepEqual(pending, [], 'Checks listed with a step that the acceptance report does not contain');
  const run = {
    schema: 'mendwell.gui-evidence.v1', captured_on: OPTS.date || report.checked_at.slice(0, 10), command: COMMAND,
    rendering: 'Chromium launched with ' + RASTER.join(' ') + ' so repeated captures rasterize the same pixels; screenshots are taken with animations disabled',
    request_ids: 'The page draws its request IDs from crypto.randomUUID; the capture replaces that function in each page of the browser context with a counter kept in a cookie of the page\'s origin (web-evidence-0001, …), so IDs are stable between runs and across reloads and tabs; the browser storage that tests/web.browser.cjs checks stays untouched. The GUI source is unchanged.',
    confirmations: 'Confirmations are applied with dev/confirm.cjs, as tests/web.browser.cjs does; that helper draws its Infra event ID at random, so the recorded call shows a note in place of the ID (it is not stored in the App\'s data).',
    focus: 'In each screenshot the element the step checks is outlined in orange, a style added for the screenshot only.',
    app: APP, app_version: report.app_version,
    app_load_digest: { sha256: digest.sha256, files: digest.files, includes: digest.includes, excludes: digest.excludes, algorithm: digest.algorithm, command: 'node apps/mendwell-pharmacy/evidence/tools/digest.cjs' },
    host: { ...hostRevision(root), server: 'runtime/web/server.cjs (shared public Web Host)', registry: 'apps.registry.json' }, core_api_version: report.core_api_version,
    node: report.node, playwright: report.playwright, browser: report.browser, viewport: { desktop: '1280x900', phone: '390x844 (the last step of the platform sequence)' }, browser_timezone: report.browser_timezone, browser_locale: report.browser_locale,
    runs: [APP + '-web', APP + '-web-restricted'], profile: 'sandbox',
    account: { app_account: extra.start.account_id, owner_person: extra.start.owner_person_id, time_zone: extra.start.time_zone, seed_id: extra.start.seed_id, synthetic: true }, start_virtual_time: extra.start.virtual_now,
    steps_from: 'The steps are those of tests/web.browser.cjs, run unchanged inside the recorder: each step\'s action, expected result and checks come from that file, and every check it passes is listed with the step.',
    inspector: 'Infra MCP client on the same run (env.snapshot), as in tests/web.browser.cjs',
    agent_reads_and_writes: 'Agent calls of the test go through the Web Host\'s own business client (the session the page uses), called in-process; reads are summarized to identifiers, states and the fields the checks use, writes are listed raw',
    checks_passed: report.checks.length + (report.restricted ? report.restricted.checks.length : 0), evidence_only_checks: report.checks.filter(c => c.startsWith('Evidence script only')).length, run_level_checks: runLevel, recorder_probes: extra.probes,
    trace: 'Every call is owned when it is sent, by the step open at that moment: page reads and tool discovery in every tab of the browser context, page writes and previews, forced calls, Agent reads and writes through the Host\'s business client, Infra events, clock moves, seed loads, confirmations applied by dev/confirm.cjs and the inspector\'s own snapshot reads. A step opens when the previous one is sealed or its sequence begins, and its action runs inside it. A call sent with no owner stops the script, and a reply never changes ownership. A step is frozen before anything is taken from it: the recorder reads the version, runs the check, waits until nothing the step owns is outstanding and reads the App\'s state, and stops if the version changed since before the check; observations, version and virtual time come from that frozen state, the wait and scrolling before the screenshot come after it, and a call sent after the freeze stops the script and cannot count toward submits. Each call has exactly one terminal outcome, the reply or a failure with its HTTP status and error; a failure or a second outcome stops the script, except a failure the step declared beforehand as induced by the test (a connection dropped on purpose), which is listed with its cause and with reached_host (false when the call was dropped before it reached the Web Host, true when it was dropped after Mendwell committed it), and an induced failure that never happens is reported at teardown. A forced call carries a header token bound to the exact tool and arguments it was issued for; a token sent with any other call stops the script. Recorder errors are append-only, so a stop that a caller catches is still reported at teardown. Listed: page writes and previews with their raw arguments and raw reply (HTTP status and JSON body), unshortened; page reads answered with an HTTP status other than 200 or a status other than ok (a refusal, a record not visible to the account, a tool the policy omits), with their raw reply, which carries Mendwell\'s status and version; tool discoveries answered with an HTTP status other than 200; page reads and discoveries dropped on purpose; Agent writes and previews, Infra events, clock moves and forced calls raw, except the host wall-clock fields received_at and processed_at in Infra event receipts and the random event ID of dev/confirm.cjs, replaced by notes so repeated captures are identical; Agent reads summarized; seed loads by file name and the tools a policy omits. Not listed, but owned and waited for: page reads answered with HTTP 200 and status ok and tool discoveries answered with HTTP 200 (what the page loads at start, after each action and on Refresh), and the inspector\'s env.snapshot reads (their content is the step\'s observed state). A reply the test supplies or changes with Playwright (route.fulfill) is listed whatever its status and labelled: injected when the test built it and the call never reached the Web Host, so nothing in it was committed; relayed when it is the Web Host\'s own reply passed on unchanged; altered when the test changed it. A step counts as submitting only when it lists a write or forced call that reached the Web Host: an injected write, and a write dropped before it reached the Web Host (reached_host false), do not count. Before capturing, gui.cjs runs the recorder probes in evidence/tools/probes.cjs (recorder_probes); each makes the recorder stop with its exact expected message or shows the declared outcome.',
    console_errors: report.console_errors,
    outline_check: { rule: 'Every step names the element it checks; it must be on the page and on screen, and after the screenshot the PNG is decoded and points every 3 px along each side of the outline (3 px wide, 2 px outside the element), leaving out 12 px at each rounded corner, are sampled: at least one side must have 8 or more points inside the image, 80% or more of them in the outline colour #d9480f (each channel within 24); a side can be off screen or covered by a neighbouring pane when the element is larger than the view', screenshots_checked: outlines.length, all_four_sides_drawn: outlines.filter(o => o.sides_drawn.length === 4).length, fewer_sides_drawn: outlines.filter(o => o.sides_drawn.length < 4).map(o => o.screenshot + ' (' + o.sides_drawn.join(', ') + ')') },
    screenshots: sequences.reduce((a, s) => a + s.steps.length, 0), sequences: sequences.length
  };
  fs.writeFileSync(path.join(OUT, 'run.json'), JSON.stringify(run, null, 2) + '\n');
  fs.writeFileSync(path.join(OUT, 'sequences.json'), JSON.stringify({ schema: 'mendwell.gui-sequences.v1', runs: run.runs, account: run.account.app_account, sequences }, null, 2) + '\n');
  fs.writeFileSync(path.join(OUT, 'README.md'), markdown(run));
  console.log('evidence: ' + run.screenshots + ' screenshots in ' + sequences.length + ' sequences, ' + run.checks_passed + ' checks');
  return true;
}

const cell = v => String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const json = v => '`' + JSON.stringify(v).replace(/\|/g, '\\|').replace(/`/g, '\'') + '`';
const callText = c => c.client + ', ' + c.kind + ' `' + c.tool + '` ' + json(c.arguments) + ' → ' + (c.http !== undefined && c.http !== null ? 'HTTP ' + c.http + ' ' : '') + (c.induced ? 'failed on purpose (' + c.failure + '): ' + c.induced : c.failure ? 'failed: ' + c.failure : c.result_summary !== undefined ? 'summary ' + json(c.result_summary) : (c.injected ? '**injected reply** (' + c.injected + '): ' : c.relayed ? 'relayed reply (' + c.relayed + '): ' : c.altered ? '**altered reply** (' + c.altered + '): ' : '') + json(c.result));
function markdown(run) {
  const lines = ['# Mendwell GUI workflow sequences', '',
    'Generated by `' + run.command + '` (do not edit by hand). The steps are those of the browser acceptance `tests/web.browser.cjs`, run unchanged inside a recorder: each was performed with real controls in Chromium on the shared Web Host, and each step\'s action, expected result and checks come from that file. After each step the script read the App\'s persisted state through a separate Infra MCP client on the same run, then froze the step: it waited until no call the step made was outstanding, read the App\'s state and version, and stopped if the version had changed since before the check. The observations (the test\'s own reading of the state, and every record that changed since the previous step), version and virtual time below come from that frozen state; the script then scrolled the checked element into view (outlined in orange), checked that it is on screen, and only then took the screenshot; it then decoded the PNG and checked that the outline is in it (`outline_check` in `run.json`). Each step ends at its last check, so the screenshot shows the state the step asserts; restoring state for later steps is a step of its own. A failed check stops the script, so every step below is observed as expected. Every call is owned when it is sent, by the step open at that moment: page reads and tool discovery in every tab, the page\'s own writes and previews (`POST /api/call`), forced calls from the page\'s business session, Agent reads and writes through the Web Host\'s business client, Infra events, clock moves, seed loads, confirmations applied by `dev/confirm.cjs` and the inspector\'s own snapshot reads. A call sent with no owner, or after a step is frozen, stops the script; a submitting step lists a write or forced call that reached the Web Host. Each call has exactly one terminal outcome; a failure stops the script unless the step declared it beforehand as induced by the test (a connection dropped on purpose), in which case it is listed with its cause and `reached_host`: `false` when the call was dropped before it reached the Web Host (it does not count as submitting), `true` when the reply was dropped after Mendwell committed it. Page writes and previews are listed with the raw arguments (tokens and versions included, unshortened) and the raw reply. Agent writes and previews, Infra events, clock moves and forced calls are listed raw, except that the host wall-clock fields `received_at` and `processed_at` in Infra event receipts and the random event ID that `dev/confirm.cjs` draws are replaced by notes so that repeated captures are identical; Agent reads are summarized; seed loads are named by file and by the tools a policy omits; page reads that Mendwell refuses or answers with an HTTP error, and tool discoveries that fail, are listed with their raw reply (Mendwell\'s status and version included). Not listed, but owned and waited for: page reads answered with HTTP 200 and status `ok` and tool discoveries answered with HTTP 200 (what the page loads at start, after each action and on Refresh), and the inspector\'s own `env.snapshot` reads, whose content is the step\'s observed state. A reply the test supplies or changes with Playwright\'s `route.fulfill` is listed whatever its status and labelled: **injected** when the test built it and the call never reached the Web Host, so nothing in it was committed and the step does not count as submitting; relayed when it is the Web Host\'s own reply passed on unchanged; **altered** when the test changed it. Before capturing, the script runs the ' + run.recorder_probes.length + ' recorder probes in `evidence/tools/probes.cjs`; each must make the recorder stop with its exact expected message or show the declared outcome, and the results are in `run.json` (`recorder_probes`). The capture runs Chromium with software rasterization on one thread and replaces the page\'s random request IDs with a counter, so two runs on the same machine give the same screenshots and step data; on another machine or Chromium build, anti-aliased edges can differ by a few pixels.', '',
    '| Item | Value |', '| --- | --- |',
    '| App | mendwell-pharmacy ' + run.app_version + '; App load digest `' + run.app_load_digest.sha256 + '` over ' + run.app_load_digest.files + ' files in ' + run.app_load_digest.includes.map(x => '`' + x + '`').join(', ') + ' (`' + run.app_load_digest.command + '`) |',
    '| Host | public runtime ' + run.host.runtime_version + ' (runtime tree `' + run.host.runtime_tree_sha256 + '`), Core API ' + run.core_api_version + ', ' + run.host.server + ', registry ' + run.host.registry + ' |',
    '| Browser | ' + run.browser + ' (Playwright ' + run.playwright + '), viewport ' + run.viewport.desktop + ', then ' + run.viewport.phone + ', locale ' + run.browser_locale + ', browser time zone ' + run.browser_timezone + ' (the page shows the account\'s America/New_York) |',
    '| Node | ' + run.node + ' |',
    '| Runs and account | runs ' + run.runs.map(r => '`' + r + '`').join(' and ') + ', profile ' + run.profile + ', synthetic account `' + run.account.app_account + '` held by `' + run.account.owner_person + '`, seed `' + run.account.seed_id + '`, starting at ' + run.start_virtual_time + ' |',
    '| Captured | ' + run.captured_on + ', ' + run.sequences + ' sequences, ' + run.screenshots + ' steps, ' + run.checks_passed + ' checks passed (' + (run.checks_passed - run.evidence_only_checks) + ' from tests/web.browser.cjs, ' + run.evidence_only_checks + ' evidence script only; ' + (run.checks_passed - run.run_level_checks.length) + ' listed with their steps and ' + run.run_level_checks.length + ' run-level, below), unexpected console errors: ' + run.console_errors.unexpected.length + ' |', '',
    '## Run-level checks', '', 'Checked by `tests/web/harness.cjs` after the last step of each run, over the whole run, so they are listed here and not with a step.', '', '| Run | Check |', '| --- | --- |', ...run.run_level_checks.map(c => '| `' + c.run + '` | ' + cell(c.check) + ' |'), ''];
  for (const s of JSON.parse(fs.readFileSync(path.join(OUT, 'sequences.json'), 'utf8')).sequences) {
    lines.push('## ' + s.title, '', 'Workflow: ' + s.workflow + '. Scope: ' + s.scope + '. Run `' + s.run + '`.', '');
    if (s.summary) lines.push(s.summary, '');
    lines.push('| Step | Action | Expected | Checked element | Observed in the App (Infra MCP) | MCP calls in this step | Version | Virtual time | Checks passed (from `tests/web.browser.cjs` unless marked evidence script only) | Screenshot |', '| ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const st of s.steps) lines.push('| ' + st.step + ' | ' + cell(st.action) + ' | ' + cell(st.expected) + ' | `' + cell(st.checked_element) + '` | ' + cell(st.observed.summary) + (Object.keys(st.observed.changes_since_previous_step).length ? '<br>Changed records: ' + json(st.observed.changes_since_previous_step) : '<br>No record changed.') + ' | ' + (st.mcp_calls.length ? st.mcp_calls.map(callText).join('<br>') : 'none') + ' | ' + st.version + ' | ' + st.virtual_now + ' | ' + st.acceptance_checks.map(cell).join('<br>') + ' | [' + path.basename(st.screenshot, '.png') + '](' + st.screenshot + ') |');
    lines.push('');
  }
  return lines.join('\n');
}

if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { outlineShown, decodePng };
