#!/usr/bin/env node
'use strict';
// Check (f), permissions and retries, for every gated write on every seed,
// through real Core over MCP.
//   browse: discovery lists the 15 allowed tools; each of the seven gated
//     writes returns permission_denied with the state hash unchanged and a
//     deny row in Core's audit; a retry with the same request ID is denied
//     again (nothing was stored); previews, vehicles.add and
//     transponders.assign still commit.
//   full: each gated write commits; a retry with the same request ID returns
//     the first result with duplicate: true; the same request ID with other
//     arguments is idempotency_conflict; the pre-commit version is
//     stale_version; a confirm on a used preview is preview_used, and a second
//     withdrawal or end is invalid_state. None of the refusals changes the hash.
// Run from a full checkout: node apps/crossway/tests/permission-checks.cjs
const assert = require('node:assert/strict');
const {hash, platform, loadSeed, MAIL, SEEDS} = require('./platform-lib.cjs');

const GATED = ['account.topup.confirm', 'notices.pay.confirm', 'disputes.confirm', 'account.replenish.set', 'vehicles.end', 'vehicles.update', 'disputes.withdraw'];
const P = 'crossway.';

// Valid arguments per seed; `prepare` makes the preview or dispute a gated write needs.
const CASES = {
  dani: {card: 'card-dani-visa', end: ['v-0002', '2026-09-28', '2026-09-29'], update: 'v-0004', pay: ['n-0016'],
    dispute: {notice_id: 'n-0017', reason: 'sold_or_not_in_possession', transfer_date: '2026-09-28', evidence: [MAIL('mail-dani', 'm-11133')]},
    add: {plate: 'TST4100', class: 1, label: 'Test car'}, assign: {transponder_id: 'tp-0001', vehicle_id: 'v-0004'}},
  marisol: {card: 'card-marisol-visa', end: ['v-0003', '2026-01-20', '2026-01-21'], update: 'v-0001', pay: ['n-0008'],
    dispute: {notice_id: 'n-0007', reason: 'sold_or_not_in_possession', transfer_date: '2026-01-20', evidence: [MAIL('mail-marisol', 'm-21107')]},
    add: {plate: 'TST4200', class: 1, label: 'Test car'}, assign: {transponder_id: 'tp-0001', vehicle_id: 'v-0004'}},
  theo: {card: 'card-theo-amex', end: ['v-0003', '2026-04-30', '2026-05-01'], update: 'v-0002', pay: ['n-0008'],
    dispute: {notice_id: 'n-0006', reason: 'sold_or_not_in_possession', transfer_date: '2026-04-30', evidence: [MAIL('mail-theo', 'm-31042')]},
    add: {plate: 'TST4300', class: 1, label: 'Test car'}, assign: {transponder_id: 'tp-0003', vehicle_id: 'v-0005'}},
  priya: {card: 'card-priya-visa', end: ['v-0002', '2026-11-14', '2026-11-15'], update: 'v-0001', pay: ['n-0009'],
    dispute: {notice_id: 'n-0008', reason: 'sold_or_not_in_possession', transfer_date: '2026-11-14', evidence: [MAIL('mail-priya', 'm-41206')]},
    add: {plate: 'TST4400', class: 1, label: 'Test car'}, assign: {transponder_id: 'tp-0002', vehicle_id: 'v-0004'}},
};

async function main() {
  const p = await platform(), results = [];
  const ok = (name, condition) => { assert.ok(condition, name); results.push(name); };
  try {
    for (const {seed_id: id} of SEEDS) {
      const c = CASES[id];
      const infra = await p.open('infra', 'perm-' + id), agent = await p.open('agent', 'perm-' + id);
      const snap = async () => infra.call('env.snapshot');
      const h = async () => hash((await snap()).snapshot);
      let n = 0;
      const rid = () => `${id}-${++n}`;
      const call = (name, args) => agent.call(P + name, args);
      const commit = async (name, args) => {
        const out = await call(name, {expected_version: (await snap()).version, request_id: rid(), ...args});
        assert.equal(out.status, 'committed', `${id} ${name}: ${JSON.stringify(out)}`);
        return out;
      };
      // Arguments for each gated write, after making what it needs.
      const prepared = async name => {
        if (name === 'account.topup.confirm') return [{preview_id: (await commit('account.topup.preview', {amount_cents: 2000, card_id: c.card})).preview.id}, {preview_id: 'pv-0999'}];
        if (name === 'notices.pay.confirm') return [{preview_id: (await commit('notices.pay.preview', {notice_ids: c.pay, card_id: c.card})).preview.id}, {preview_id: 'pv-0999'}];
        if (name === 'disputes.confirm') return [{preview_id: (await commit('disputes.preview', c.dispute)).preview.id}, {preview_id: 'pv-0999'}];
        if (name === 'account.replenish.set') return [{enabled: true, card_id: c.card}, {enabled: true, card_id: c.card, amount_cents: 6000}];
        if (name === 'vehicles.end') return [{vehicle_id: c.end[0], end_date: c.end[1]}, {vehicle_id: c.end[0], end_date: c.end[2]}];
        if (name === 'vehicles.update') return [{vehicle_id: c.update, label: 'Corrected description'}, {vehicle_id: c.update, label: 'Another description'}];
        const d = (await call('disputes.get', {notice_id: c.dispute.notice_id})).dispute;
        return [{dispute_id: d.id}, {dispute_id: 'dp-0999'}];
      };

      // ---- browse ----
      await loadSeed(infra, id, 'browse');
      const listed = (await agent.request('tools/list')).result.tools.map(t => t.name);
      ok(`${id}/browse: discovery lists 15 tools and none of the gated writes`, listed.length === 15 && GATED.every(g => !listed.includes(P + g)));
      for (const name of GATED) {
        let [args] = name.endsWith('.confirm') ? await prepared(name).catch(() => [{preview_id: 'pv-0001'}]) : [null];
        if (!args) args = name === 'disputes.withdraw' ? {dispute_id: 'dp-0001'} : (await prepared(name))[0];
        const before = await snap(), request_id = rid();
        const denied = await call(name, {expected_version: before.version, request_id, ...args});
        const after = await snap();
        assert.equal(denied.status, 'permission_denied', `${id} ${name}`);
        assert.equal(hash(after.snapshot), hash(before.snapshot), `${id} ${name} hash`);
        const row = after.snapshot.audit.at(-1);
        assert.ok(row.tool === P + name && row.decision === 'deny', `${id} ${name} audit`);
        const again = await call(name, {expected_version: before.version, request_id, ...args});
        assert.ok(again.status === 'permission_denied' && !again.duplicate, `${id} ${name} retry`);
        assert.equal(await h(), hash(before.snapshot));
      }
      ok(`${id}/browse: all seven gated writes are permission_denied, audited, unchanged, and denied again on retry`, true);
      await commit('vehicles.add', c.add);
      await commit('transponders.assign', c.assign);
      ok(`${id}/browse: previews, vehicles.add and transponders.assign still commit`, true);

      // ---- full ----
      await loadSeed(infra, id, 'full');
      for (const name of GATED) {
        if (name === 'disputes.withdraw' && !(await call('notices.get', {notice_id: c.dispute.notice_id})).notice.dispute_id) {
          // Make a submitted dispute to withdraw (disputes.confirm above was on a reset state).
          await commit('disputes.confirm', {preview_id: (await commit('disputes.preview', c.dispute)).preview.id});
        }
        const [args, other] = await prepared(name);
        const v0 = (await snap()).version, request_id = rid();
        const first = await call(name, {expected_version: v0, request_id, ...args});
        assert.equal(first.status, 'committed', `${id} ${name}: ${JSON.stringify(first)}`);
        const base = await h();
        const retry = await call(name, {expected_version: v0, request_id, ...args});
        const {duplicate, ...same} = retry;
        assert.ok(duplicate === true, `${id} ${name} duplicate`);
        assert.deepEqual(same, first, `${id} ${name} retry returns the first result`);
        const conflict = await call(name, {expected_version: v0, request_id, ...other});
        assert.equal(conflict.status, 'idempotency_conflict', `${id} ${name} conflict`);
        const stale = await call(name, {expected_version: v0, request_id: rid(), ...args});
        assert.equal(stale.status, 'stale_version', `${id} ${name} stale`);
        if (name.endsWith('.confirm')) assert.equal((await call(name, {expected_version: (await snap()).version, request_id: rid(), ...args})).status, 'preview_used', `${id} ${name} used`);
        if (name === 'disputes.withdraw' || name === 'vehicles.end') assert.equal((await call(name, {expected_version: (await snap()).version, request_id: rid(), ...args})).status, 'invalid_state', `${id} ${name} twice`);
        assert.equal(await h(), base, `${id} ${name}: refusals change nothing`);
      }
      ok(`${id}/full: all seven gated writes commit; retry is a duplicate of the first result; conflict, stale, used and repeated calls are refused unchanged`, true);
      await infra.close();
      await agent.close();
    }
    console.log(JSON.stringify({app: 'crossway', check: '(f) permissions and retries', gated: GATED, passed: results}, null, 2));
  } finally {
    await p.close();
  }
}
main().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
