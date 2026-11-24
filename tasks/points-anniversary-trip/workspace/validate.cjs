#!/usr/bin/env node
'use strict';
// Checks every workspace seed against its App, in three steps per App:
//   1. the App's seed schema (schemas/seed.schema.json);
//   2. the App's validateSeed(ctx, data), with ctx {app_id, binding, virtual_now};
//   3. env.load_seed through the public runtime with this folder's binding and asset bundle,
//      then the agent's list/read surface (Files: every document's bytes).
// It also delivers every item of mail-timeline.json through Mail's mail.deliver event, in order,
// with the placeholders filled from example values, and checks the files are in sync with build.cjs.
//
//   node tasks/points-anniversary-trip/workspace/validate.cjs --root <checkout with runtime/, apps/ and examples/apps/>
const fs = require('node:fs');
const path = require('node:path');
const {build, bundle, T0} = require('./build.cjs');

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const root = path.resolve(arg('--root') || path.resolve(__dirname, '../../..'));
const APPS = {mail:'examples/apps/mail', calendar:'examples/apps/calendar', messages:'apps/messages',
  files:'apps/files', notes:'apps/notes', contacts:'apps/contacts'};
const need = [...Object.values(APPS), 'apps/files/tests/schema-validator.cjs', 'runtime/core/runtime.cjs', 'apps.registry.json'];
for (const n of need) if (!fs.existsSync(path.join(root, n))) {
  console.error('Missing ' + n + ' under ' + root + '. Pass --root <checkout with runtime/, apps/ and examples/apps/>.'); process.exit(2);
}
const read = name => JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8'));
const binding = read('binding.json');
let failures = 0;
const report = (label, ok, detail = '') => { if (!ok) failures++; console.log((ok ? 'PASS ' : 'FAIL ') + label + (detail ? ' - ' + detail : '')); };
const attempt = (label, fn) => { try { const detail = fn(); report(label, true, detail || ''); } catch (e) { report(label, false, e.code ? e.code + ': ' + e.message : e.message); } };

attempt('build.cjs --check', () => build({check:true}));

const {compile} = require(path.join(root, 'apps/files/tests/schema-validator.cjs'));
const {createRuntime} = require(path.join(root, 'runtime/core/runtime.cjs'));
const runtime = createRuntime({registryFile:path.join(root, 'apps.registry.json')});
const states = {};
for (const [app, dir] of Object.entries(APPS)) {
  const pkg = path.join(root, dir), data = read(app + '.seed.json');
  const plugin = require(path.join(pkg, 'plugin.cjs'));
  const schema = JSON.parse(fs.readFileSync(path.join(pkg, 'schemas/seed.schema.json'), 'utf8'));
  report(app + ': seed schema', compile(schema, path.join(pkg, 'schemas'))(data));
  attempt(app + ': validateSeed', () => plugin.validateSeed({app_id:app, binding, virtual_now:T0}, data));
  attempt(app + ': env.load_seed', () => {
    let s = runtime.create(app, 'task-55-' + app);
    const assets = app === 'files' ? read('files.bundle.json') : bundle(app, data, plugin);
    const out = runtime.execute(s, 'infra', 'env.load_seed', {expected_version:runtime.version(s), data, binding,
      policies:runtime.configs.get(app).policies, bundle:assets, virtual_now:T0, request_id:'load-' + app});
    if (out.result.status !== 'ready') throw new Error(JSON.stringify(out.result));
    if (!out.result.quality.automated_pass) throw new Error('quality checks failed');
    s = states[app] = out.state;
    const tool = app === 'mail' ? 'mail.search' : app + '.list', listed = runtime.execute(s, 'agent', tool, {}).result;
    if (listed.status !== 'ok') throw new Error(tool + ': ' + JSON.stringify(listed).slice(0, 200));
    const count = (listed.items || listed.messages || listed.events || []).length;
    if (count !== plugin.records(data).length) throw new Error(tool + ' returned ' + count + ' records');
    let extra = '';
    if (app === 'files') {
      const docs = data.files.filter(f => f.kind === 'file');
      for (const f of docs) {
        const r = runtime.execute(s, 'agent', 'files.read', {id:f.id}).result;
        if (r.status !== 'ok' || !r.file) throw new Error('files.read ' + f.id + ': ' + JSON.stringify(r).slice(0, 200));
      }
      extra = ', files.read ok for ' + docs.length + ' documents';
    }
    return plugin.records(data).length + ' records loaded; ' + out.result.quality.counts.assets + ' assets; ' + tool + ' returns ' + count + extra;
  });
}

// Timed mail: fill placeholders with the example values and deliver in order after the seed.
const timeline = read('mail-timeline.json');
const examples = {booking_ref:'K7Q2M9', posted:'1,410.00', remaining:'590.00'};
const fill = value => JSON.parse(JSON.stringify(value).replace(/\{(booking_ref|posted|remaining)\}/g, (_, k) => examples[k]));
attempt('mail-timeline: ' + timeline.events.length + ' deliveries', () => {
  let s = states.mail, previous = Date.parse(T0);
  if (!s) throw new Error('Mail seed did not load');
  for (const item of timeline.events) {
    const event = fill(item.event);
    if (Date.parse(event.at) < previous) throw new Error(event.event_id + ' is out of order');
    previous = Date.parse(event.at);
    const left = JSON.stringify(event).match(/\{[a-z_]+\}/);
    if (left) throw new Error(event.event_id + ' has an undeclared placeholder ' + left[0]);
    const out = runtime.execute(s, 'infra', 'env.apply_event', {expected_version:runtime.version(s), event});
    if (out.result.status !== 'committed') throw new Error(event.event_id + ': ' + JSON.stringify(out.result));
    s = out.state;
  }
  return 'mailbox holds ' + s.data.messages.length + ' messages after the last delivery';
});

console.log(failures ? failures + ' check(s) failed.' : 'All workspace checks passed.');
process.exitCode = failures ? 1 : 0;
