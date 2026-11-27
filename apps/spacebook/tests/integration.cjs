"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const runtime =
  process.env.PALE_RUNTIME_ROOT || path.resolve(__dirname, "../../../runtime");
const { prepare } = require(path.join(runtime, "prepare.cjs")),
  { Client } = require(path.join(runtime, "client.cjs")),
  { digestTree } = require(path.join(runtime, "verify.cjs"));
const app = path.resolve(__dirname, ".."),
  out =
    process.env.SPACEBOOK_REPORT_DIR ||
    path.resolve(app, "../../.artifacts/spacebook");
async function main() {
  const prepared = prepare(app),
    clients = [],
    checks = [],
    trace = [];
  const report = {
    package_sha256: digestTree(app),
    runtime_version: require(path.join(runtime, "package.json")).version,
    node: process.version,
    at: new Date().toISOString(),
    checks,
    trace,
    passed: false,
  };
  const check = (name, a, b = true) => {
    assert.deepEqual(a, b, name);
    checks.push(name);
  };
  async function client(role, run = "integration") {
    const c = new Client(
      "spacebook",
      role,
      run,
      path.join(prepared.root, "state"),
      "spacebook-integration",
      { registry: prepared.registry },
    );
    clients.push(c);
    await c.initialize();
    return c;
  }
  try {
    const infra = await client("infra");
    let agent = await client("agent");
    const snap = () => infra.call("env.snapshot");
    let seq = 0;
    async function read(name, args = {}) {
      return agent.call("spacebook." + name, args);
    }
    async function write(name, args = {}) {
      const v = (await snap()).version;
      const full = {
        ...args,
        expected_version: v,
        request_id: "write-" + ++seq,
      };
      const result = await read(name, full);
      trace.push({ name, args: full, result });
      return { args: full, result };
    }
    async function event(e) {
      const args = { expected_version: (await snap()).version, event: e };
      const result = await infra.call("env.apply_event", args);
      trace.push({ event: e, result });
      return { args, result };
    }
    const initial = await snap();
    await infra.call("env.reset", {
      expected_version: initial.version,
      profile: "sandbox",
    });
    const bundle = {
      room_id: "room-cedar",
      equipment_ids: ["equipment-1"],
      title: "Eight-person planning",
      start_at: "2026-12-08T22:00:00Z",
      end_at: "2026-12-08T23:00:00Z",
    };
    const held = await write("holds.create", bundle);
    check("Bundle held", held.result.status, "committed");
    const confirmed = await write("holds.confirm", { id: held.result.item.id });
    check("Bundle confirmed", confirmed.result.item.status, "confirmed");
    const oldId = confirmed.result.item.id;
    const receiptKey = "request:" + confirmed.args.request_id,
      stored = (await snap()).snapshot.receipts[receiptKey];
    const block = await event(require("../examples/scenario.json"));
    check("Outage commits", block.result.status, "committed");
    check(
      "Current booking is disrupted",
      (await read("bookings.get", { id: oldId })).item.status,
      "disrupted",
    );
    check(
      "Entire bundle released",
      (
        await read("resources.get", {
          id: "equipment-1",
          start_at: bundle.start_at,
          end_at: bundle.end_at,
        })
      ).item.available,
    );
    const beforeReplay = await snap();
    const replay = await read("holds.confirm", confirmed.args);
    const { duplicate, ...original } = replay;
    check(
      "Replay returns original confirmation receipt",
      original,
      confirmed.result,
    );
    check("Replay marked duplicate", duplicate);
    const afterReplay = await snap();
    check(
      "Stored receipt unchanged",
      afterReplay.snapshot.receipts[receiptKey],
      stored,
    );
    check(
      "Replay does not mutate data",
      afterReplay.snapshot.data,
      beforeReplay.snapshot.data,
    );
    check(
      "Replay does not change version",
      afterReplay.version,
      beforeReplay.version,
    );
    check(
      "Fresh read still disrupted",
      (await read("bookings.get", { id: oldId })).item.status,
      "disrupted",
    );
    trace.push({
      name: "holds.confirm replay",
      result: replay,
      current: (await read("bookings.get", { id: oldId })).item,
    });
    const failed = await write("bookings.replace", { id: oldId, ...bundle });
    check(
      "Unavailable replacement rejected",
      failed.result.status,
      "resource_unavailable",
    );
    check(
      "Failed replacement preserves disrupted state and allocation",
      (await snap()).snapshot.data,
      beforeReplay.snapshot.data,
    );
    const changed = await write("bookings.replace", {
      ...bundle,
      id: oldId,
      room_id: "room-willow",
    });
    check("Valid replacement commits", changed.result.status, "committed");
    const newId = changed.result.item.id;
    check(
      "Replacement links old booking",
      changed.result.item.previous_id,
      oldId,
    );
    check(
      "Old booking superseded",
      (await read("bookings.get", { id: oldId })).item.status,
      "superseded",
    );
    await agent.close();
    agent = await client("agent");
    const rows = (await read("bookings.list")).items;
    check(
      "Reload retains exactly one active linked booking",
      rows.filter((b) => b.status === "confirmed").map((b) => b.id),
      [newId],
    );
    check(
      "Reload retains forward link",
      rows.find((b) => b.id === oldId).replacement_id,
      newId,
    );
    const final = await snap();
    check(
      "No active abandoned hold",
      final.snapshot.data.holds.filter((h) => h.status === "active").length,
      0,
    );
    const eventReplay = await infra.call("env.apply_event", block.args);
    check("Outage replay is deduplicated", eventReplay.duplicate);
    check(
      "Outage replay does not duplicate notices",
      (await snap()).snapshot.data,
      final.snapshot.data,
    );
    const stale = await read("bookings.cancel", {
      id: newId,
      expected_version: confirmed.result.version,
      request_id: "stale",
    });
    check("Stale write rejected", stale.status, "stale_version");
    const conflict = await read("holds.confirm", {
      ...confirmed.args,
      id: "changed",
    });
    check(
      "Request ID cannot be repurposed",
      conflict.status,
      "idempotency_conflict",
    );
    check(
      "Agent cannot inject outage",
      (await agent.call("env.apply_event", block.args)).status,
      "permission_denied",
    );
    // Concurrent clients observe the same version and race for the same resource.
    const peer = await client("agent");
    const v = (await snap()).version;
    const raceBundle = {
      ...bundle,
      room_id: "room-maple",
      equipment_ids: [],
      start_at: "2026-12-08T23:00:00Z",
      end_at: "2026-12-09T00:00:00Z",
    };
    const race = await Promise.all(
      [agent, peer].map((c, i) =>
        c.call("spacebook.holds.create", {
          ...raceBundle,
          expected_version: v,
          request_id: "race-" + i,
        }),
      ),
    );
    check(
      "One competing writer commits",
      race.filter((r) => r.status === "committed").length,
      1,
    );
    check(
      "Other competing writer receives stale version",
      race.filter((r) => r.status === "stale_version").length,
      1,
    );
    const occupied = race.find((r) => r.status === "committed");
    const activeBefore = (await snap()).snapshot.data;
    const failedConfirmed = await write("bookings.replace", {
      ...raceBundle,
      id: newId,
    });
    check(
      "Replacement into competing hold fails",
      failedConfirmed.result.status,
      "resource_unavailable",
    );
    check(
      "Confirmed original preserved on failure",
      (await snap()).snapshot.data,
      activeBefore,
    );
    const clock = await infra.call("env.advance_time", {
      expected_version: (await snap()).version,
      virtual_now: occupied.item.expires_at,
      request_id: "expiry-clock",
    });
    check("Virtual clock advances", clock.status, "committed");
    check(
      "Expired hold ceases blocking without event",
      (
        await read("resources.get", {
          id: "room-maple",
          start_at: raceBundle.start_at,
          end_at: raceBundle.end_at,
        })
      ).item.available,
    );
    check(
      "Expired confirmation rejected",
      (await write("holds.confirm", { id: occupied.item.id })).result.status,
      "invalid_state",
    );
    const otherInfra = await client("infra", "other-run");
    check(
      "Other run remains at its baseline",
      (await otherInfra.call("env.snapshot")).snapshot.data,
      initial.snapshot.data,
    );
    const reset = await infra.call("env.reset", {
      expected_version: (await snap()).version,
    });
    check("Reset commits", reset.status, "ready");
    check(
      "Reset restores baseline",
      (await snap()).snapshot.data,
      initial.snapshot.data,
    );
    check(
      "Reset clears request receipts",
      Object.keys((await snap()).snapshot.receipts).length,
      0,
    );
    report.passed = true;
  } catch (e) {
    report.error = e.stack;
    process.exitCode = 1;
  } finally {
    await Promise.allSettled(clients.map((c) => c.close()));
    prepared.cleanup();
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(
      path.join(out, "integration.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(
      JSON.stringify({
        passed: report.passed,
        checks: checks.length,
        error: report.error,
      }),
    );
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
