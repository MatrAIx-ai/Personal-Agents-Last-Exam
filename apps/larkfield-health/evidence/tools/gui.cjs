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
const { runWebAcceptance, root } = require('../../tests/web/harness.cjs');
const { workflows, restricted: restrictedTest, restrictedRun } = require('../../tests/web.browser.cjs');
const { Client } = require(path.join(root, 'runtime/client.cjs'));
const { runtimeDigest, hostRevision } = require('./digest.cjs');
const { createRecorder } = require('./recorder.cjs');
const { runProbes } = require('./probes.cjs');
const { chromium } = require('playwright');

const APP = 'larkfield-health';
const NAME = 'Larkfield';
const COMMAND = 'node apps/larkfield-health/evidence/tools/gui.cjs';
const RASTER = ['--disable-gpu', '--num-raster-threads=1', '--disable-partial-raster'];
const TIMEZONE = 'Asia/Tokyo';
const CAPTURED_ON = (() => { const i = process.argv.findIndex(a => a === '--captured-on' || a.startsWith('--captured-on=')); if (i < 0) return null; const v = process.argv[i].includes('=') ? process.argv[i].split('=')[1] : process.argv[i + 1]; if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) throw Error('--captured-on needs a date as YYYY-MM-DD'); return v; })();
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
  const left = box.x + 1.5, right = box.x + box.width - 1.5, top = box.y + 1.5, bottom = box.y + box.height - 1.5;
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
  'w0-page': ['Business-only access and layout', 'The page: every section of the fixture at 1280 and 390 pixels; GUI added at the platform reviewer\'s request'],
  'w2-claims-info': ['Information requests and EOB versions', 'Approved workflow W2, accident questions; GUI added at the platform reviewer\'s request'],
  'w1-grants': ['Household and grants', 'Approved workflow W1; GUI added at the platform reviewer\'s request'],
  'w3-pa': ['Prior authorizations with expedite', 'Approved workflow W3; GUI added at the platform reviewer\'s request'],
  'w4-appeals': ['Appeals with statement and withdraw', 'Approved workflow W4; GUI added at the platform reviewer\'s request'],
  'w5-visibility': ['Household and grants', 'Approved workflow W1, access lost or reduced while the page is open'],
  'w6-resets': ['Shared state, reload and independent updates', 'Platform rules for the GUI: previews, drafts, retries and receipts stay bound to the run state they were made in'],
  'w9-two-questions': ['Information requests and EOB versions', 'Approved workflow W2, two claims whose questions read the same'],
  'w7-coverage': ['Attestations (other coverage, accident)', 'Approved workflow W2, other coverage for 2027'],
  'w8-platform': ['Business-only access and layout', 'Platform rules for the GUI'],
  'claims-lines': ['Claims with lines', 'Read-only claim view (evidence script only)'],
  'eob-versions': ['Information requests and EOB versions', 'Read-only EOB versions (evidence script only)'],
  'plan-accumulators': ['Plan accumulators', 'Read-only plan view (evidence script only)'],
  restricted: ['Business-only access and layout', 'Platform rules for the GUI, on a separate fresh run with policies that drop tools']
};

const KEYS = { members: 'member_id', providers: 'provider_id', services: 'service_id', claims: 'claim_id', info_requests: 'info_request_id', eobs: 'eob_id', pas: 'pa_id', appeals: 'appeal_id', grants: 'grant_id', approvals: 'approval_id', notices: 'notice_id' };
const compact = v => { const s = JSON.stringify(v); return s !== undefined && s.length <= 160 ? v : '(changed, ' + (s === undefined ? 0 : s.length) + ' characters)'; };
function changes(before, after) {
  const out = {};
  for (const key of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    const a = before ? before[key] : undefined, b = after ? after[key] : undefined;
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (!Array.isArray(a) || !Array.isArray(b)) { out[key] = compact(b); continue; }
    const idOf = (r, i) => (r && typeof r === 'object' && KEYS[key] && r[KEYS[key]]) || (r && typeof r === 'object' && r.member_id && r.plan_year ? r.member_id + '/' + r.plan_year : r && typeof r === 'object' && r.target ? r.target.type + ':' + r.target.id : '#' + i);
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

const PICK = ['status', 'state', 'scope', 'type', 'member_id', 'grantor_id', 'grantee_id', 'plan_year', 'decision', 'answer', 'reason', 'token', 'expedited', 'claim_version', 'pa_version', 'appeal_version', 'grant_version', 'expires_at'];
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
  if (args.data) out.data = JSON.stringify(args.data) === JSON.stringify(FIXTURE) ? 'fixtures/minimal.json (seed ' + FIXTURE.seed_id + ')' : 'seed ' + args.data.seed_id + ' (' + JSON.stringify(args.data).length + ' characters, SHA-256 ' + sha(JSON.stringify(args.data)) + ')';
  if (args.policies) { const gone = removedTools(args.policies); out.policies = 'fixtures/policies.json' + (gone.length ? ' without ' + gone.join(', ') : ''); }
  if (args.binding) out.binding = 'binding of ' + (args.binding.accounts || []).length + ' accounts';
  return out;
};

const sequences = [];
const outlines = [];
const SURVEY = process.argv.includes('--survey');
const problems = [];
const problem = (ok, message) => { if (ok) return true; if (!SURVEY) assert.fail(message); problems.push(message); return false; };
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
  et.dropAfterCommit = match => { const c = chosen(match); R.induce(c.match, 'the evidence harness forwarded this call to Larkfield, kept its committed reply and dropped the connection before the page saw it', true); return t.dropAfterCommit(c.test); };
  et.dropBeforeSend = match => { const c = chosen(match); R.induce(c.match, 'the evidence harness dropped this call before it reached Larkfield'); return t.dropBeforeSend(c.test); };
  et.beforeForward = (match, during, failNext = false) => {
    if (!failNext) return t.beforeForward(match, during, failNext);
    const c = chosen(typeof failNext === 'function' ? failNext : () => failNext === true);
    R.induce(c.match, 'the evidence harness dropped this call before it reached Larkfield, after the change it applies while the page reads');
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
        if (!problem(await loc.count(), seq.title + ', step ' + n + ': the element the step checks (' + step.focus + ') is not on the page')) return;
        await loc.scrollIntoViewIfNeeded();
        outlined = await loc.elementHandle();
        await outlined.evaluate(e => { e.dataset.evidenceOutline = e.style.outline || ''; e.style.outline = '3px solid #d9480f'; e.style.outlineOffset = '-3px'; });
        box = await loc.boundingBox();
        const vp = page.viewportSize();
        if (!problem(box && await loc.isVisible() && box.y < vp.height && box.y + box.height > 0 && box.x < vp.width && box.x + box.width > 0, seq.title + ', step ' + n + ': the element the step checks (' + step.focus + ') is not on screen')) box = null;
      },
      record: ({ version, snapshot: s, observed, calls }) => {
        seq.steps.push({ step: n, title: step.title, action: step.action, expected: step.expected, result: 'as expected', submits: calls.some(c => (c.kind === 'write' || c.kind === 'forced call') && c.reached_host !== false), checked_element: step.focus, observed: { summary: summary || '', changes_since_previous_step: observed }, version: vstr(version), virtual_now: s.virtual_now, mcp_calls: calls, acceptance_checks: checks, screenshot: file });
      },
      capture: async () => {
        const png = await page.screenshot({ path: path.join(OUT, file), animations: 'disabled' });
        const shown = box ? outlineShown(png, box, page.viewportSize()) : { ok: false, sides: null, full: [] };
        if (!shown.ok) fs.writeFileSync(path.join(scratch, 'outline-missing-' + path.basename(file)), png);
        if (box) problem(shown.ok, seq.title + ', step ' + n + ': the outline of the checked element (' + step.focus + ') is not in the screenshot (' + JSON.stringify(shown.sides) + ')');
        outlines.push({ screenshot: file, sides_drawn: shown.full });
        if (outlined) await outlined.evaluate(e => { e.style.outline = e.dataset.evidenceOutline; e.style.outlineOffset = ''; delete e.dataset.evidenceOutline; }).catch(() => {});
      }
    });
    if (last) { await R.finish(); await R.close(); }
    return summary;
  };
  return { R, et, run };
}

function viewWorkflows(t) {
  const { page } = t;
  const $ = selector => page.locator(selector);
  const nav = async name => { await page.locator('nav').getByRole('button', { name: new RegExp('^\\S*\\s*' + name) }).click(); await t.idle(); await t.settled(); };
  const pick = async (kind, id) => { await $('[data-' + kind + '-id="' + id + '"]').click(); await $('[data-' + kind + '="' + id + '"]').waitFor(); await t.settled(); };
  const ONLY = 'An evidence-only sequence, not part of tests/web.browser.cjs: ';
  return [
    { id: 'claims-lines', evidenceOnly: true, title: 'Claims with lines', summary: ONLY + 'a processed claim with its service lines at desktop width, compared with claims.get.', steps: [
      { title: 'A claim shows each service line with its outcome', action: 'Set the viewport to 1280 × 900; Claims → cl-14', expected: 'Every line of the claim in order, with its service and the amount the member owes on the current explanation of benefits', focus: '[data-claim=cl-14]',
        run: async () => {
          await page.setViewportSize({ width: 1280, height: 900 });
          await nav('Claims');
          await pick('claim', 'cl-14');
          const claim = (await t.agent('claims.get', { claim_id: 'cl-14' })).claim;
          const shown = await $('[data-claim=cl-14] [data-line]').evaluateAll(n => n.map(e => [e.dataset.line, e.innerText]));
          const current = claim.eobs[claim.eobs.length - 1];
          t.check('Evidence script only: the claim lists exactly the lines claims.get returns, in order, each with its service, and the member cost of the current explanation of benefits', JSON.stringify(shown.map(x => x[0])) === JSON.stringify(claim.lines.map(l => l.line_id)) && claim.lines.every((l, i) => shown[i][1].includes(l.service.description)) && !!current && await $('[data-claim=cl-14] [data-eob-version="' + current.version + '"] [data-member-cost="' + current.totals.member_cost_cents + '"]').count() === 1);
          return 'claims.get cl-14: ' + claim.lines.length + ' lines (' + claim.lines.map(l => l.line_id + ' ' + l.service.service_id).join(', ') + '), EOB version ' + current.version + ', member cost ' + current.totals.member_cost_cents + ' cents';
        } }
    ] },
    { id: 'eob-versions', evidenceOnly: true, title: 'EOB versions', summary: ONLY + 'a claim with two explanations of benefits, compared with claims.get.', steps: [
      { title: 'Both explanations of benefits are listed, the newer one current', action: 'Claims → cl-8', expected: 'Version 2 (after an appeal) and version 1, which says it was replaced; the member cost of each version', focus: '[data-claim=cl-8]',
        run: async () => {
          await pick('claim', 'cl-8');
          const claim = (await t.agent('claims.get', { claim_id: 'cl-8' })).claim;
          const shown = await $('[data-claim=cl-8] [data-eob-version]').evaluateAll(n => n.map(e => e.dataset.eobVersion).sort());
          const costs = [];
          for (const e of claim.eobs) costs.push(await $('[data-claim=cl-8] [data-eob-version="' + e.version + '"] [data-member-cost="' + e.totals.member_cost_cents + '"]').count() === 1);
          t.check('Evidence script only: the claim shows every explanation of benefits claims.get returns, each with its own member cost', JSON.stringify(shown) === JSON.stringify(claim.eobs.map(e => String(e.version)).sort()) && claim.eobs.length >= 2 && costs.every(Boolean));
          return 'claims.get cl-8: ' + claim.eobs.map(e => 'version ' + e.version + ' (' + e.reason + ', member cost ' + e.totals.member_cost_cents + ' cents)').join(', ');
        } }
    ] },
    { id: 'plan-accumulators', evidenceOnly: true, title: 'Plan accumulators', summary: ONLY + 'the 2026 plan year at desktop width, compared with plan.get.', steps: [
      { title: 'Plan & costs shows each visible member\'s deductible and out-of-pocket amounts', action: 'Plan & costs → 2026', expected: 'For each member the account holder can see, the deductible and out-of-pocket amounts used in 2026, as plan.get returns them', focus: '[data-plan="2026"]',
        run: async () => {
          await nav('Plan & costs');
          await $('[data-plan-year="2026"]').click();
          await $('[data-plan="2026"]').waitFor();
          await t.settled();
          const plan = await t.agent('plan.get', { plan_year: 2026 });
          const shown = await $('[data-plan="2026"] [data-accumulator]').evaluateAll(n => n.map(e => [e.dataset.accumulator, e.querySelector('[data-deductible]').dataset.deductible, e.querySelector('[data-oop]').dataset.oop]));
          t.check('Evidence script only: Plan & costs shows, for each member plan.get returns for 2026, the same deductible and out-of-pocket amounts', JSON.stringify(shown) === JSON.stringify(plan.members.map(m => [m.member_id, String(m.deductible_cents), String(m.oop_cents)])));
          return 'plan.get 2026: ' + plan.members.map(m => m.member_id + ' deductible ' + m.deductible_cents + ', out of pocket ' + m.oop_cents + ' cents').join('; ') + (plan.family ? '; family shown' : '; family hidden');
        } }
    ] }
  ];
}

function mainWorkflows(t) {
  const { et, run } = instrument(t, 'main');
  const tw = workflows(et), list = [tw[0], ...viewWorkflows(et), ...tw.slice(1)];
  return list.map((w, wi) => {
    w.seq = String(wi + 1).padStart(2, '0') + '-' + w.id;
    return { ...w, steps: w.steps.map((s, si) => ({ ...s, run: () => run(w, si, s, wi === list.length - 1 && si === w.steps.length - 1) })) };
  });
}

async function restricted(t) {
  const { et, run } = instrument(t, 'restricted');
  const w = restrictedRun ? restrictedRun(et) : { id: 'restricted', title: 'Restricted policy', summary: 'The restricted run of tests/web.browser.cjs, recorded as one step because the test runs it as one function.', steps: [
    { title: 'Policies that drop tools', action: 'Open the page; send a statement whose reply times out after its commit; load the fixture with a policy without appeals.add_statement and claims.info.confirm; Refresh; force both dropped tools; load a policy without plan.get; Refresh; Plan & costs', expected: 'Removed controls, 403 for the forced calls, and the plan section says reading the plan is not allowed', focus: '#records', run: () => restrictedTest(et) }
  ] };
  w.seq = String(sequences.length + 1).padStart(2, '0') + '-' + w.id;
  for (const [si, s] of w.steps.entries()) await run(w, si, s, si === w.steps.length - 1);
}

function publish(staging, final) {
  fs.mkdirSync(final, { recursive: true });
  for (const e of fs.readdirSync(final)) fs.rmSync(path.join(final, e), { recursive: true, force: true });
  fs.cpSync(staging, final, { recursive: true });
}

async function main() {
  OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'larkfield-gui-capture-'));
  try { if (await capture()) publish(OUT, FINAL); }
  finally { fs.rmSync(OUT, { recursive: true, force: true }); }
}

async function capture() {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'larkfield-gui-evidence-'));
  process.env.PALE_WEB_REPORT_DIR = scratch;
  extra.probes = await runProbes({ root, chromium, launchArgs: RASTER, writes: WRITES, previews: PREVIEWS });
  try { await runWebAcceptance({ app: APP, appDir, workflows: mainWorkflows, restricted, timezoneId: TIMEZONE, strictChecks: true, launchArgs: RASTER }); }
  finally { for (const r of recorders) await r.R.close().catch(() => {}); }
  const report = JSON.parse(fs.readFileSync(path.join(scratch, 'report.json'), 'utf8'));
  if (problems.length && !SURVEY) return false;
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
    schema: 'larkfield.gui-evidence.v1', captured_on: CAPTURED_ON || report.checked_at.slice(0, 10), command: COMMAND,
    rendering: 'Chromium launched with ' + RASTER.join(' ') + ' so repeated captures rasterize the same pixels; screenshots are taken with animations disabled',
    request_ids: 'The page draws its request IDs from crypto.randomUUID; the capture replaces that function in each page of the browser context with a counter kept in a cookie of the page\'s origin (web-evidence-0001, …), so IDs are stable between runs and across reloads and tabs; the browser storage that tests/web.browser.cjs checks stays untouched. The GUI source is unchanged.',
    confirmations: 'Confirmations are applied with dev/confirm.cjs, as tests/web.browser.cjs does; that helper draws its Infra event ID at random, so the recorded call shows a note in place of the ID (it is not stored in the App\'s data).',
    focus: 'In each screenshot the element the step checks is outlined in orange, a style added for the screenshot only.',
    app: APP, app_version: report.app_version,
    app_load_digest: { sha256: digest.sha256, files: digest.files, includes: digest.includes, excludes: digest.excludes, algorithm: digest.algorithm, command: 'node apps/larkfield-health/evidence/tools/digest.cjs' },
    host: { ...hostRevision(root), server: 'runtime/web/server.cjs (shared public Web Host)', registry: 'apps.registry.json' }, core_api_version: report.core_api_version,
    node: report.node, playwright: report.playwright, browser: report.browser, viewport: { desktop: '1280x900', phone: '390x844 in the steps that check the narrow layout' }, browser_timezone: report.browser_timezone, browser_locale: report.browser_locale,
    runs: [APP + '-web', APP + '-web-restricted'], profile: 'sandbox',
    account: { app_account: extra.start.account_id, owner_person: extra.start.owner_person_id, time_zone: extra.start.time_zone, seed_id: extra.start.seed_id, synthetic: true }, start_virtual_time: extra.start.virtual_now,
    steps_from: 'The steps are those of tests/web.browser.cjs, run unchanged inside the recorder: each step\'s action, expected result and checks come from that file, and every check it passes is listed with the step.',
    inspector: 'Infra MCP client on the same run (env.snapshot), as in tests/web.browser.cjs',
    agent_reads_and_writes: 'Agent calls of the test go through the Web Host\'s own business client (the session the page uses), called in-process; reads are summarized to identifiers, states and the fields the checks use, writes are listed raw',
    checks_passed: report.checks.length + (report.restricted ? report.restricted.checks.length : 0), evidence_only_checks: report.checks.filter(c => c.startsWith('Evidence script only')).length, run_level_checks: runLevel, recorder_probes: extra.probes,
    trace: 'Every call is owned when it is sent, by the step open at that moment: page reads and tool discovery in every tab of the browser context, page writes and previews, forced calls, Agent reads and writes through the Host\'s business client, Infra events, clock moves, seed loads, confirmations applied by dev/confirm.cjs and the inspector\'s own snapshot reads. A step opens when the previous one is sealed or its sequence begins, and its action runs inside it. A call sent with no owner stops the script, and a reply never changes ownership. A step is frozen before anything is taken from it: the recorder reads the version, runs the check, waits until nothing the step owns is outstanding and reads the App\'s state, and stops if the version changed since before the check; observations, version and virtual time come from that frozen state, the wait and scrolling before the screenshot come after it, and a call sent after the freeze stops the script and cannot count toward submits. Each call has exactly one terminal outcome, the reply or a failure with its HTTP status and error; a failure or a second outcome stops the script, except a failure induced by the test: a connection the step declared beforehand as dropped on purpose by the evidence harness, or a request a route of the test aborted with Playwright route.abort, which the recorder sees when it happens; such a failure is listed with its cause and with reached_host (false when the call was dropped before it reached the Web Host, true when it was dropped after Larkfield committed it), and an induced failure that never happens is reported at teardown. A forced call carries a header token bound to the exact tool and arguments it was issued for; a token sent with any other call stops the script. Recorder errors are append-only, so a stop that a caller catches is still reported at teardown. Listed: page writes and previews with their raw arguments and raw reply (HTTP status and JSON body), unshortened; page reads answered with an HTTP status other than 200 or a status other than ok (a refusal, a record not visible to the account, a tool the policy omits), with their raw reply, which carries Larkfield\'s status and version; tool discoveries answered with an HTTP status other than 200; page reads and discoveries dropped on purpose; Agent writes and previews, Infra events, clock moves and forced calls raw, except the host wall-clock fields received_at and processed_at in Infra event receipts and the random event ID of dev/confirm.cjs, replaced by notes so repeated captures are identical; Agent reads summarized; seed loads by file name and the tools a policy omits. Not listed, but owned and waited for: page reads answered with HTTP 200 and status ok and tool discoveries answered with HTTP 200 (what the page loads at start, after each action and on Refresh), and the inspector\'s env.snapshot reads (their content is the step\'s observed state). A reply the test supplies or changes with Playwright (route.fulfill) is listed whatever its status and labelled: injected when the test built it and the call never reached the Web Host, so nothing in it was committed; relayed when it is the Web Host\'s own reply passed on unchanged; altered when the test changed it. A step counts as submitting only when it lists a write or forced call that reached the Web Host: an injected write, and a write dropped before it reached the Web Host (reached_host false), do not count. Before capturing, gui.cjs runs the recorder probes in evidence/tools/probes.cjs (recorder_probes); each makes the recorder stop with its exact expected message or shows the declared outcome.',
    console_errors: report.console_errors,
    outline_check: { rule: 'Every step names the element it checks; it must be on the page and on screen, and after the screenshot the PNG is decoded and points every 3 px along each side of the outline (3 px wide, drawn just inside the element\'s edge so that a scrolling parent cannot clip it), leaving out 12 px at each rounded corner, are sampled: at least one side must have 8 or more points inside the image, 80% or more of them in the outline colour #d9480f (each channel within 24); a side can be off screen or covered by a neighbouring pane when the element is larger than the view', screenshots_checked: outlines.length, all_four_sides_drawn: outlines.filter(o => o.sides_drawn.length === 4).length, fewer_sides_drawn: outlines.filter(o => o.sides_drawn.length < 4).map(o => o.screenshot + ' (' + o.sides_drawn.join(', ') + ')') },
    screenshots: sequences.reduce((a, s) => a + s.steps.length, 0), sequences: sequences.length
  };
  fs.writeFileSync(path.join(OUT, 'run.json'), JSON.stringify(run, null, 2) + '\n');
  fs.writeFileSync(path.join(OUT, 'sequences.json'), JSON.stringify({ schema: 'larkfield.gui-sequences.v1', runs: run.runs, account: run.account.app_account, sequences }, null, 2) + '\n');
  fs.writeFileSync(path.join(OUT, 'README.md'), markdown(run));
  console.log('evidence: ' + run.screenshots + ' screenshots in ' + sequences.length + ' sequences, ' + run.checks_passed + ' checks');
  if (problems.length) { console.error('Survey only, not evidence: ' + problems.length + ' capture problems:\n' + problems.join('\n')); process.exitCode = 1; }
  return true;
}

const cell = v => String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const json = v => '`' + JSON.stringify(v).replace(/\|/g, '\\|').replace(/`/g, '\'') + '`';
const callText = c => c.client + ', ' + c.kind + ' `' + c.tool + '` ' + json(c.arguments) + ' → ' + (c.http !== undefined && c.http !== null ? 'HTTP ' + c.http + ' ' : '') + (c.induced ? 'failed on purpose (' + c.failure + '): ' + c.induced : c.failure ? 'failed: ' + c.failure : c.result_summary !== undefined ? 'summary ' + json(c.result_summary) : (c.injected ? '**injected reply** (' + c.injected + '): ' : c.relayed ? 'relayed reply (' + c.relayed + '): ' : c.altered ? '**altered reply** (' + c.altered + '): ' : '') + json(c.result));
function readers(run) {
  const seqs = JSON.parse(fs.readFileSync(path.join(OUT, 'sequences.json'), 'utf8')).sequences;
  const with_ = seqs.flatMap(s => s.steps.filter(st => st.observed.summary).map(() => s));
  const total = seqs.reduce((a, s) => a + s.steps.length, 0);
  if (with_.length === total) return 'every step';
  return with_.length + ' step' + (with_.length === 1 ? '' : 's') + (with_.length && with_.every(s => s.evidence_only) ? ' of the evidence-only sequences' : ' that return one');
}

function markdown(run) {
  const lines = ['# Larkfield GUI workflow sequences', '',
    'Generated by `' + run.command + '` (do not edit by hand). The steps are those of the browser acceptance `tests/web.browser.cjs`, run unchanged inside a recorder: each was performed with real controls in Chromium on the shared Web Host, and each step\'s action, expected result and checks come from that file. After each step the script read the App\'s persisted state through a separate Infra MCP client on the same run, then froze the step: it waited until no call the step made was outstanding, read the App\'s state and version, and stopped if the version had changed since before the check. The observations (every record that changed since the previous step, read from that frozen state, and, for the ' + readers(run) + ', the step\'s own reading of the App, shown as “Reading”), version and virtual time below come from that frozen state; the script then scrolled the checked element into view (outlined in orange), checked that it is on screen, and only then took the screenshot; it then decoded the PNG and checked that the outline is in it (`outline_check` in `run.json`). Each step ends at its last check, so the screenshot shows the state the step asserts; restoring state for later steps is a step of its own. A failed check stops the script, so every step below is observed as expected. Every call is owned when it is sent, by the step open at that moment: page reads and tool discovery in every tab, the page\'s own writes and previews (`POST /api/call`), forced calls from the page\'s business session, Agent reads and writes through the Web Host\'s business client, Infra events, clock moves, seed loads, confirmations applied by `dev/confirm.cjs` and the inspector\'s own snapshot reads. A call sent with no owner, or after a step is frozen, stops the script; a submitting step lists a write or forced call that reached the Web Host. Each call has exactly one terminal outcome; a failure stops the script unless the test induced it (a connection the step declared beforehand as dropped on purpose, or a request a route of the test aborted with Playwright `route.abort`, which the recorder sees when it happens), in which case it is listed with its cause and `reached_host`: `false` when the call was dropped before it reached the Web Host (it does not count as submitting), `true` when the reply was dropped after Larkfield committed it. Page writes and previews are listed with the raw arguments (tokens and versions included, unshortened) and the raw reply. Agent writes and previews, Infra events, clock moves and forced calls are listed raw, except that the host wall-clock fields `received_at` and `processed_at` in Infra event receipts and the random event ID that `dev/confirm.cjs` draws are replaced by notes so that repeated captures are identical; Agent reads are summarized; seed loads are named by file and by the tools a policy omits; page reads that Larkfield refuses or answers with an HTTP error, and tool discoveries that fail, are listed with their raw reply (Larkfield\'s status and version included). Not listed, but owned and waited for: page reads answered with HTTP 200 and status `ok` and tool discoveries answered with HTTP 200 (what the page loads at start, after each action and on Refresh), and the inspector\'s own `env.snapshot` reads, whose content is the step\'s observed state. A reply the test supplies or changes with Playwright\'s `route.fulfill` is listed whatever its status and labelled: **injected** when the test built it and the call never reached the Web Host, so nothing in it was committed and the step does not count as submitting; relayed when it is the Web Host\'s own reply passed on unchanged; **altered** when the test changed it. Before capturing, the script runs the ' + run.recorder_probes.length + ' recorder probes in `evidence/tools/probes.cjs`; each must make the recorder stop with its exact expected message or show the declared outcome, and the results are in `run.json` (`recorder_probes`). The capture runs Chromium with software rasterization on one thread and replaces the page\'s random request IDs with a counter, so two runs on the same machine give the same screenshots and step data; on another machine or Chromium build, anti-aliased edges can differ by a few pixels.', '',
    '| Item | Value |', '| --- | --- |',
    '| App | larkfield-health ' + run.app_version + '; App load digest `' + run.app_load_digest.sha256 + '` over ' + run.app_load_digest.files + ' files in ' + run.app_load_digest.includes.map(x => '`' + x + '`').join(', ') + ' (`' + run.app_load_digest.command + '`) |',
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
    for (const st of s.steps) lines.push('| ' + st.step + ' | ' + cell(st.action) + ' | ' + cell(st.expected) + ' | `' + cell(st.checked_element) + '` | ' + [st.observed.summary ? 'Reading: ' + cell(st.observed.summary) : null, Object.keys(st.observed.changes_since_previous_step).length ? 'Changed records: ' + json(st.observed.changes_since_previous_step) : 'No record changed.'].filter(Boolean).join('<br>') + ' | ' + (st.mcp_calls.length ? st.mcp_calls.map(callText).join('<br>') : 'none') + ' | ' + st.version + ' | ' + st.virtual_now + ' | ' + st.acceptance_checks.map(cell).join('<br>') + ' | [' + path.basename(st.screenshot, '.png') + '](' + st.screenshot + ') |');
    lines.push('');
  }
  return lines.join('\n');
}

if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { outlineShown, decodePng };
