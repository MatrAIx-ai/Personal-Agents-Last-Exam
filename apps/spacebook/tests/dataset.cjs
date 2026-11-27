"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const runtime =
    process.env.PALE_RUNTIME_ROOT ||
    path.resolve(__dirname, "../../../runtime"),
  { prepare } = require(path.join(runtime, "prepare.cjs")),
  { Client } = require(path.join(runtime, "client.cjs")),
  { digestTree } = require(path.join(runtime, "verify.cjs"));
const app = path.resolve(__dirname, ".."),
  out =
    process.env.SPACEBOOK_REPORT_DIR ||
    path.resolve(app, "../../.artifacts/spacebook");
(async () => {
  const p = prepare(app),
    clients = [],
    checks = [];
  const report = {
    package_sha256: digestTree(app),
    at: new Date().toISOString(),
    checks,
    passed: false,
  };
  const check = (name, a, b) => {
    assert.deepEqual(a, b, name);
    checks.push(name);
  };
  try {
    for (const role of ["infra", "agent"]) {
      const c = new Client(
        "spacebook",
        role,
        "dataset",
        path.join(p.root, "state"),
        "spacebook-data-review",
        { registry: p.registry },
      );
      await c.initialize();
      clients.push(c);
    }
    const [infra, agent] = clients;
    const dataset = require("../datasets/evaluation.json");
    let s = await infra.call("env.snapshot");
    const bundle = structuredClone(s.snapshot.resources.bundle);
    bundle.dataset.expected_counts.records =
      require("../src/model.cjs").records(dataset).length;
    bundle.dataset.description =
      "Complete synthetic 2025–2026 SpaceBook evaluation dataset";
    const load = await infra.call("env.load_seed", {
      expected_version: s.version,
      request_id: "full-history",
      data: dataset,
      bundle,
      virtual_now: "2027-01-01T08:00:00Z",
    });
    check(
      "Full dataset loads with declared record count",
      load.status,
      "ready",
    );
    const rows = await agent.call("spacebook.bookings.list");
    check(
      "Agent retrieves every owned historical booking",
      rows.items.map((b) => b.id),
      dataset.bookings
        .filter((b) => b.owner_person_id === dataset.owner_person_id)
        .map((b) => b.id),
    );
    check(
      "Agent cannot see other owners",
      rows.items.every((b) => b.owner_person_id === dataset.owner_person_id),
      true,
    );
    const first = rows.items[0],
      last = rows.items.at(-1);
    check(
      "Earliest selected booking retrieves original history",
      (await agent.call("spacebook.bookings.get", { id: first.id })).item
        .history,
      first.history,
    );
    check(
      "Latest selected booking retrieves original history",
      (await agent.call("spacebook.bookings.get", { id: last.id })).item
        .history,
      last.history,
    );
    report.sample = { first, last };
    report.coverage = require("../datasets/coverage.json");
    s = await infra.call("env.snapshot");
    await infra.call("env.reset", { expected_version: s.version });
    check(
      "Reset restores loaded evaluation baseline",
      (await infra.call("env.snapshot")).snapshot.data,
      dataset,
    );
    for (const file of fs
      .readdirSync(path.join(app, "fixtures/scenarios"))
      .sort()) {
      const data = JSON.parse(
        fs.readFileSync(path.join(app, "fixtures/scenarios", file)),
      );
      s = await infra.call("env.snapshot");
      const fixtureBundle = structuredClone(s.snapshot.resources.bundle);
      fixtureBundle.dataset.expected_counts.records =
        require("../src/model.cjs").records(data).length;
      const result = await infra.call("env.load_seed", {
        expected_version: s.version,
        request_id: "fixture-" + file,
        data,
        bundle: fixtureBundle,
        virtual_now: require("../fixtures/clock.json").initial_time,
      });
      check("Scenario fixture loads: " + file, result.status, "ready");
    }
    report.passed = true;
  } catch (e) {
    report.error = e.stack;
    process.exitCode = 1;
  } finally {
    await Promise.allSettled(clients.map((c) => c.close()));
    p.cleanup();
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(
      path.join(out, "dataset.json"),
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
})();
