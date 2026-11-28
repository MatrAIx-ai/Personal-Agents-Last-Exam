'use strict';
// Helpers shared by the scripts that drive real Core over MCP: state hashing,
// seed loading, version-threaded writes, each seed's reference actions, and the
// sentinel form of each seed's example schedule.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const {seedFiles, SEEDS} = require('./harness.cjs');
const {loadArgs} = require('../scripts/seed-bundle.cjs');

const root = path.resolve(__dirname, '../../..');
const {prepare} = require(path.join(root, 'runtime/prepare.cjs'));
const {Client} = require(path.join(root, 'runtime/client.cjs'));

// SHA-256 over canonical JSON (sorted keys). The state hash covers the business
// data only: platform fields (run_id, epoch, revision, audit) are outside it.
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
const sha = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');
const hash = snapshot => sha(snapshot.data);

// One prepared runtime and the MCP clients opened on it.
async function platform() {
  const prepared = prepare(path.join(root, 'apps/crossway'));
  const stateDir = path.join(prepared.root, 'state'), clients = [];
  return {
    prepared,
    async open(role, run) {
      const c = new Client(prepared.app, role, run, stateDir, 'crossway-checks', {registry: prepared.registry});
      clients.push(c);
      await c.initialize();
      return c;
    },
    async close() {
      await Promise.allSettled(clients.map(c => c.close()));
      prepared.cleanup();
    },
  };
}

// Loads one indexed seed with its binding and clock, then resets into `profile`.
async function loadSeed(infra, id, profile = 'full') {
  const s = seedFiles(id);
  let snap = await infra.call('env.snapshot');
  const loaded = await infra.call('env.load_seed', {expected_version: snap.version, ...loadArgs(id), request_id: 'load-' + id});
  assert.equal(loaded.status, 'ready', 'load ' + id + ': ' + JSON.stringify(loaded));
  snap = await infra.call('env.snapshot');
  assert.equal((await infra.call('env.reset', {expected_version: snap.version, profile})).status, 'ready');
  snap = await infra.call('env.snapshot');
  assert.equal(snap.snapshot.virtual_now, s.now);
  assert.equal(loaded.quality.automated_pass, true, 'load ' + id + ' quality');
  return {seed: s, snapshot: snap, loaded};
}

// A session over one run: threads Core's version through agent writes and Infra
// clock and event calls, and keeps every agent-visible output.
function session(agent, infra, tag) {
  let n = 0;
  const outputs = [];
  const version = async () => (await infra.call('env.snapshot')).version;
  const s = {
    outputs,
    version,
    async read(name, args = {}) {
      const out = await agent.call('crossway.' + name, args);
      assert.equal(out.status, 'ok', name + ': ' + JSON.stringify(out));
      outputs.push(out);
      return out;
    },
    async write(name, args) {
      const out = await agent.call('crossway.' + name, {expected_version: await version(), request_id: `${tag}-${name}-${++n}`, ...args});
      assert.equal(out.status, 'committed', name + ': ' + JSON.stringify(out));
      outputs.push(out);
      return out;
    },
    async preview(kind, args) {
      const p = (await s.write(kind + '.preview', args)).preview;
      return s.write(kind + '.confirm', {preview_id: p.id});
    },
    async advance(to) {
      const out = await infra.call('env.advance_time', {expected_version: await version(), virtual_now: to, request_id: `${tag}-clock-${++n}`});
      assert.equal(out.status, 'committed', 'advance ' + to + ': ' + JSON.stringify(out));
      return out;
    },
    async event(e) {
      const out = await infra.call('env.apply_event', {expected_version: await version(), event: e});
      assert.equal(out.status, 'committed', 'event ' + e.event_id + ': ' + JSON.stringify(out));
      return out;
    },
  };
  return s;
}

const MAIL = (account_id, object_id) => ({app_id: 'mail', account_id, object_id});

// Each seed's reference actions: what a careful agent does for the holder, at
// the seed clock and, for one step, later in the schedule.
const ACTIONS = {
  dani: [
    {at: '2026-11-02T09:00:00-05:00', run: async s => {
      for (const id of ['n-0017', 'n-0018']) await s.preview('disputes', {notice_id: id, reason: 'sold_or_not_in_possession', transfer_date: '2026-09-28', evidence: [MAIL('mail-dani', 'm-11133')]});
      await s.preview('disputes', {notice_id: 'n-0015', reason: 'paid_by_rental_agency', agency_id: 'ag-swiftrent', evidence: [MAIL('mail-dani', 'm-11140')]});
      await s.preview('notices.pay', {notice_ids: ['n-0013', 'n-0014', 'n-0016'], card_id: 'card-dani-visa'});
      await s.write('vehicles.end', {vehicle_id: 'v-0002', end_date: '2026-09-28'});
      await s.write('vehicles.end', {vehicle_id: 'v-0003', end_date: '2026-08-15'});
      await s.write('account.replenish.set', {enabled: true, card_id: 'card-dani-visa'});
      await s.write('transponders.assign', {transponder_id: 'tp-0001', vehicle_id: 'v-0004'});
    }},
    {at: '2026-12-02T18:30:00-05:00', run: async s => {
      await s.preview('account.topup', {amount_cents: 5000, card_id: 'card-dani-visa'});
    }},
  ],
  marisol: [
    {at: '2026-03-09T09:00:00-04:00', run: async s => {
      await s.preview('account.topup', {amount_cents: 6000, card_id: 'card-marisol-visa'});
      await s.write('account.replenish.set', {enabled: true, card_id: 'card-marisol-visa'});
      await s.write('vehicles.end', {vehicle_id: 'v-0003', end_date: '2026-01-20'});
      for (const id of ['n-0005', 'n-0007']) await s.preview('disputes', {notice_id: id, reason: 'sold_or_not_in_possession', transfer_date: '2026-01-20', evidence: [MAIL('mail-marisol', 'm-21107')]});
      await s.preview('notices.pay', {notice_ids: ['n-0008', 'n-0009', 'n-0010'], card_id: 'card-marisol-visa'});
    }},
    {at: '2026-03-12T18:00:00-04:00', run: async s => {
      await s.write('vehicles.end', {vehicle_id: 'v-0004', end_date: '2026-03-12'});
    }},
  ],
  theo: [
    {at: '2026-06-15T09:00:00-04:00', run: async s => {
      await s.write('vehicles.end', {vehicle_id: 'v-0003', end_date: '2026-04-30'});
      for (const id of ['n-0006', 'n-0007']) await s.preview('disputes', {notice_id: id, reason: 'sold_or_not_in_possession', transfer_date: '2026-04-30', evidence: [MAIL('mail-theo', 'm-31042')]});
      await s.write('account.replenish.set', {enabled: true, card_id: 'card-theo-amex'});
      await s.preview('notices.pay', {notice_ids: ['n-0005', 'n-0008'], card_id: 'card-theo-amex'});
    }},
    {at: '2026-06-19T10:00:00-04:00', run: async s => {
      await s.write('vehicles.update', {vehicle_id: 'v-0005', possession_end: '2026-06-19'});
    }},
  ],
  priya: [
    {at: '2026-12-31T09:00:00-05:00', run: async s => {
      await s.write('account.replenish.set', {enabled: true, card_id: 'card-priya-visa'});
      await s.preview('account.topup', {amount_cents: 4000, card_id: 'card-priya-visa'});
      await s.write('vehicles.end', {vehicle_id: 'v-0002', end_date: '2026-11-14'});
      for (const id of ['n-0008', 'n-0011']) await s.preview('disputes', {notice_id: id, reason: 'sold_or_not_in_possession', transfer_date: '2026-11-14', evidence: [MAIL('mail-priya', 'm-41206')]});
      await s.write('transponders.assign', {transponder_id: 'tp-0002', vehicle_id: 'v-0004'});
      await s.preview('notices.pay', {notice_ids: ['n-0006', 'n-0009', 'n-0010', 'n-0012'], card_id: 'card-priya-visa'});
    }},
    {at: '2027-01-08T18:00:00-05:00', run: async s => {
      // The permanent plates arrived: the temporary plate ends and the tag moves to the new plate.
      await s.write('vehicles.end', {vehicle_id: 'v-0004', end_date: '2027-01-08'});
      await s.write('vehicles.add', {plate: 'PRC7781', class: 1, label: '2026 Honda CR-V', possession_start: '2027-01-08'});
      await s.write('transponders.assign', {transponder_id: 'tp-0002', vehicle_id: 'v-0005'});
    }},
  ],
};

// The schedule with sentinel strings in its pending payloads. `surfaces` lists
// sentinels a read may show once their event has fired (new toll IDs);
// `hidden` lists ones no read should ever show (event IDs, decision tables).
function sentinelSchedule(id) {
  const {schedule} = seedFiles(id);
  return schedule.events.map((e, k) => {
    const tag = `SNTL-${id}-${k + 1}`, ev = structuredClone(e), surfaces = [], hidden = [];
    ev.event_id = `${tag}-event`;
    hidden.push(ev.event_id);
    if (ev.operation === 'crossway.toll.posted') {
      ev.payload.toll_id = `${tag}-toll`;
      surfaces.push(ev.payload.toll_id);
    }
    if (ev.operation === 'crossway.dispute.decided') {
      // An extra entry no dispute can match: it leaves the outcome unchanged.
      const ref = {app_id: 'mail', account_id: `${tag}-account`, object_id: `${tag}-object`};
      ev.payload.grant_if.push({reason: 'not_my_plate', evidence: [ref]});
      hidden.push(ref.account_id, ref.object_id);
    }
    return {event: ev, surfaces, hidden, all: [...surfaces, ...hidden]};
  });
}

module.exports = {root, canonical, sha, hash, platform, loadSeed, session, ACTIONS, MAIL, sentinelSchedule, SEEDS, seedFiles};
