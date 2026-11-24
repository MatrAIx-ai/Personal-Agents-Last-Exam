#!/usr/bin/env node
'use strict';
// (e) Replay through real Core, over each fixture's full example scenario.
// Run from a full checkout: node apps/stoopside/tests/replay-checks.cjs
//
// For every fixture (fixtures/index.json), three runs load the same seed with
// env.load_seed and apply the same events in order with env.apply_event, then
// move the clock four days past the last event and make one write, so every
// deadline that fell due (offer and reconfirmation expiry, swap expiry, sheet
// locks, Monday digests) is committed:
//   jump         events only; the clock moves with each event's `at`, then one
//                env.advance_time jump to the end
//   steps        env.advance_time in 5-hour steps up to each event and to the
//                end, with an Agent read after every step
//   steps_write  the same steps with an Agent write after every step
//                (profile.update with the unchanged bio), so due items are
//                committed at each step instead of at the next event
// All three must give byte-identical business data (SHA-256 over canonical
// JSON of snapshot.data), identical deliveries and notices, and the same
// visibility-record hash.
//
// It also loads each fixture's companion Mail seed into real Mail 1.3.0 with
// env.load_seed and reads every message back with mail.get.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const app = path.resolve(__dirname, '..');
const root = path.resolve(app, '../..');
const {prepare} = require(path.join(root, 'runtime/prepare.cjs'));
const {Client} = require(path.join(root, 'runtime/client.cjs'));
const VIS = require('../src/visibility.cjs');

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
const sha = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');
const read = file => JSON.parse(fs.readFileSync(path.join(app, file), 'utf8'));
const STEP = 5 * 3600000, TAIL = 4 * 86400000;

// The fixture's own bundle: the package dataset with this fixture as the record source.
function bundle(fx, data) {
  const dataset = read('contribution/dataset.json');
  dataset.record_source_ids = [fx.key];
  dataset.expected_counts = {records: data.events.length, assets: 0};
  return {dataset, catalog: read('contribution/assets.catalog.json'), blobs: {}};
}

async function main() {
  const prepared = prepare(app, [path.join(root, 'examples/apps/mail')]);
  const stateDir = path.join(prepared.root, 'state'), clients = [], results = [], summary = {};
  const open = async (appId, role, run) => {
    const c = new Client(appId, role, run, stateDir, 'stoopside-replay', {registry: prepared.registry});
    clients.push(c); await c.initialize(); return c;
  };
  const ok = (name, condition) => { assert.ok(condition, name); results.push(name); };
  try {
    for (const entry of read('fixtures/index.json').fixtures) {
      const data = read(entry.seed), binding = read(entry.binding), scenario = read(entry.scenario), mailSeed = read(entry.mail_seed);
      const end = new Date(Date.parse(scenario.at(-1).at) + TAIL).toISOString();
      const runs = {};
      for (const mode of ['jump', 'steps', 'steps_write']) {
        const run = `replay-${entry.key}-${mode}`;
        const infra = await open('stoopside', 'infra', run), agent = await open('stoopside', 'agent', run);
        let s = await infra.call('env.snapshot');
        assert.equal((await infra.call('env.reset', {expected_version: s.version, profile: 'full'})).status, 'ready');
        s = await infra.call('env.snapshot');
        const loaded = await infra.call('env.load_seed', {expected_version: s.version, request_id: 'load-' + entry.key, data, binding,
          policies: read('fixtures/policies.json'), bundle: bundle(entry, data), virtual_now: entry.clock});
        assert.equal(loaded.status, 'ready', JSON.stringify(loaded));
        let version = (await infra.call('env.snapshot')).version, n = 0, reads = 0, writes = 0, advances = 0;
        const bio = data.members.find(m => m.id === data.user_member_id).bio;
        const stepTo = async target => {
          let now = Date.parse((await infra.call('env.snapshot')).snapshot.virtual_now);
          for (let t = now + STEP; mode !== 'jump' && t < Date.parse(target); t += STEP) {
            const moved = await infra.call('env.advance_time', {expected_version: version, request_id: `${run}-clock-${++n}`, virtual_now: new Date(t).toISOString()});
            assert.equal(moved.status, 'committed');
            version = moved.version; advances++;
            if (mode === 'steps') {
              assert.equal((await agent.call('stoopside.events.list', {})).status, 'ok');
              reads++;
            } else {
              const w = await agent.call('stoopside.profile.update', {expected_version: version, request_id: `${run}-write-${n}`, bio});
              assert.equal(w.status, 'committed', JSON.stringify(w));
              version = w.version; writes++;
            }
          }
        };
        for (const event of scenario) {
          await stepTo(event.at);
          const applied = await infra.call('env.apply_event', {expected_version: version, event});
          assert.equal(applied.status, 'committed', `${entry.key} ${event.event_id}: ${JSON.stringify(applied)}`);
          version = applied.version;
        }
        await stepTo(end);
        const moved = await infra.call('env.advance_time', {expected_version: version, request_id: `${run}-end`, virtual_now: end});
        assert.equal(moved.status, 'committed');
        const last = await agent.call('stoopside.profile.update', {expected_version: moved.version, request_id: `${run}-final`, bio});
        assert.equal(last.status, 'committed');
        const snap = (await infra.call('env.snapshot')).snapshot;
        runs[mode] = {state: sha(snap.data), record: sha(VIS.record(snap.data)), deliveries: sha(snap.data.deliveries), notices: sha(snap.data.notices),
          counts: {deliveries: snap.data.deliveries.length, notices: snap.data.notices.length, digests: snap.data.digests.length,
            offers: snap.data.deliveries.filter(d => d.reason === 'waitlist_offer').length},
          calls: {events: scenario.length, advances: advances + 1, reads, writes: writes + 1}};
        await infra.close(); await agent.close();
      }
      const same = k => runs.jump[k] === runs.steps[k] && runs.jump[k] === runs.steps_write[k];
      ok(`${entry.key}: one jump, small steps with reads and small steps with writes give byte-identical business data`, same('state'));
      ok(`${entry.key}: identical deliveries and notices`, same('deliveries') && same('notices'));
      ok(`${entry.key}: identical visibility record`, same('record'));
      ok(`${entry.key}: the scenario committed deliveries, notices and at least one digest`, runs.jump.counts.notices > 0 && runs.jump.counts.digests > 0);

      // The companion Mail seed loads into real Mail and reads back.
      const run = `mail-${entry.key}`;
      const mailInfra = await open('mail', 'infra', run), mailAgent = await open('mail', 'agent', run);
      const m0 = await mailInfra.call('env.snapshot');
      const mailDataset = JSON.parse(fs.readFileSync(path.join(root, 'examples/apps/mail/contribution/dataset.json'), 'utf8'));
      mailDataset.dataset_id = 'stoopside-companion-mail-' + entry.key;
      mailDataset.description = 'Companion Mail seed for the Stoopside ' + entry.key + ' fixture (synthetic).';
      mailDataset.expected_counts = {records: mailSeed.messages.length, assets: 0};
      const mailLoaded = await mailInfra.call('env.load_seed', {expected_version: m0.version, request_id: 'mail-' + entry.key, data: mailSeed, binding,
        policies: JSON.parse(fs.readFileSync(path.join(root, 'examples/apps/mail/fixtures/policies.json'), 'utf8')), virtual_now: entry.clock,
        bundle: {dataset: mailDataset, catalog: {schema_version: 'pale.asset-catalog.v1', catalog_id: 'stoopside-mail-' + entry.key, app_id: 'mail', dataset_ref: 'dataset.json', assets: [], extensions: []}, blobs: {}}});
      assert.equal(mailLoaded.status, 'ready', JSON.stringify(mailLoaded));
      let readBack = 0;
      for (const m of mailSeed.messages) {
        const got = await mailAgent.call('mail.get', {id: m.id});
        if (got.status === 'ok' && got.message.subject === m.subject && got.message.body === m.body && got.message.from === m.from) readBack++;
      }
      ok(`${entry.key}: the companion Mail seed loads into Mail 1.3.0 and every message reads back with mail.get`,
        mailLoaded.loaded === mailSeed.messages.length && readBack === mailSeed.messages.length);
      await mailInfra.close(); await mailAgent.close();
      summary[entry.key] = {state_sha256: runs.jump.state, visibility_record_sha256: runs.jump.record, ...runs.jump.counts,
        calls: Object.fromEntries(Object.entries(runs).map(([k, v]) => [k, v.calls]))};
    }
    console.log(JSON.stringify({app: 'stoopside', check: '(e) replay', fixtures: summary, passed: results}, null, 2));
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
  }
}
main().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
