"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const { chromium } = require("playwright");
const runtime =
  process.env.PALE_RUNTIME_ROOT || path.resolve(__dirname, "../../../runtime");
const { start } = require(path.join(runtime, "web/server.cjs")),
  { Client } = require(path.join(runtime, "client.cjs")),
  { digestTree } = require(path.join(runtime, "verify.cjs"));
const app = path.resolve(__dirname, ".."),
  out =
    process.env.SPACEBOOK_REPORT_DIR ||
    path.resolve(app, "../../.artifacts/spacebook");
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "spacebook-browser-")),
    browser = await chromium.launch({ headless: true }),
    checks = [],
    sequences = [];
  const report = {
    package_sha256: digestTree(app),
    node: process.version,
    browser: browser.version(),
    at: new Date().toISOString(),
    viewport: { width: 1360, height: 900 },
    checks,
    sequences,
    passed: false,
  };
  let host, infra, context;
  const check = (name, value = true) => {
    assert.ok(value, name);
    checks.push(name);
  };
  try {
    host = await start({
      app: "spacebook",
      registry: path.join(app, "registry.json"),
      stateDir,
      run: "browser-spacebook",
      profile: "sandbox",
    });
    infra = new Client(
      "spacebook",
      "infra",
      host.run,
      stateDir,
      "spacebook-browser-inspector",
      { registry: host.registry },
    );
    await infra.initialize();
    context = await browser.newContext({ viewport: report.viewport });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const ready = () => page.locator("#app[aria-busy=false]").waitFor();
    const snapshot = async () =>
      (await infra.call("env.snapshot")).snapshot.data;
    const shot = async (name) => {
      await page.screenshot({
        path: path.join(out, name + ".png"),
        fullPage: true,
      });
      const s = await infra.call("env.snapshot");
      sequences.push({
        name,
        file: name + ".png",
        version: s.version,
        bookings: s.snapshot.data.bookings,
        holds: s.snapshot.data.holds,
      });
    };
    const click = async (name) => {
      await page.getByRole("button", { name, exact: true }).click();
      await ready();
    };
    const submit = async (name) => {
      await page
        .locator("dialog")
        .getByRole("button", { name, exact: true })
        .click();
      await page.locator("dialog").waitFor({ state: "hidden" });
      await ready();
    };
    await page.goto(host.accessUrl);
    await ready();
    check(
      "GUI loads via public Host",
      (await page.getByRole("heading", { name: "SpaceBook" }).count()) === 1,
    );
    await shot("01-search");
    await page.locator('[data-record-id="room-cedar"]').click();
    await ready();
    await shot("02-resource");
    await click("Hold this room");
    await page.getByLabel("Meeting title").fill("Team planning");
    await page.getByLabel("Camera One", { exact: true }).check();
    await shot("03-hold-form");
    await submit("Create hold");
    let h = (await snapshot()).holds[0];
    check(
      "Browser creates actual bundle hold",
      h.room_id === "room-cedar" && h.equipment_ids[0] === "equipment-1",
    );
    await page.locator('[data-record-id="' + h.id + '"]').click();
    await shot("04-hold-review");
    await click("Confirm booking");
    await submit("Confirm booking");
    let b = (await snapshot()).bookings[0];
    check(
      "Browser confirmation persists one booking",
      b.status === "confirmed",
    );
    await page.locator('[data-record-id="' + b.id + '"]').click();
    await ready();
    await shot("05-confirmed");
    // Form captures an observed version; concurrent MCP update must not be overwritten.
    await click("Change booking");
    let s = await infra.call("env.snapshot");
    await infra.call("env.apply_event", {
      expected_version: s.version,
      event: require("../examples/scenario.json"),
    });
    await page
      .locator("dialog")
      .getByRole("button", { name: "Save replacement", exact: true })
      .click();
    await page.locator('dialog [data-code="stale_version"]').waitFor();
    check(
      "Stale GUI form preserves independent outage",
      (await snapshot()).bookings[0].status === "disrupted",
    );
    await shot("06-stale");
    await page
      .locator("dialog")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await click("Refresh");
    await click("My bookings");
    await page.locator('[data-record-id="' + b.id + '"]').click();
    await ready();
    await shot("07-disrupted");
    await click("Change booking");
    await page
      .locator("dialog")
      .getByRole("button", { name: "Save replacement", exact: true })
      .click();
    await page.locator('dialog [data-code="resource_unavailable"]').waitFor();
    check(
      "Unavailable GUI replacement preserves disruption",
      (await snapshot()).bookings.length === 1,
    );
    await shot("08-unavailable");
    await page.getByLabel("Room", { exact: true }).selectOption("room-willow");
    await submit("Save replacement");
    let replacement = (await snapshot()).bookings.find(
      (x) => x.status === "confirmed",
    );
    check(
      "Browser replacement is atomic",
      replacement.previous_id === b.id &&
        (await snapshot()).bookings.filter((x) => x.status === "confirmed")
          .length === 1,
    );
    await page.locator('[data-record-id="' + replacement.id + '"]').click();
    await ready();
    await shot("09-replaced");
    await page.reload();
    await ready();
    await click("My bookings");
    await page.locator('[data-record-id="' + replacement.id + '"]').click();
    await ready();
    check(
      "Reload displays saved replacement",
      (await page.locator(".detail").innerText()).includes("Willow"),
    );
    await click("Cancel booking");
    await submit("Cancel booking");
    check(
      "Browser cancellation releases reservation",
      (await snapshot()).bookings.find((x) => x.id === replacement.id)
        .status === "cancelled",
    );
    await shot("10-cancelled");
    await click("Activity & notices");
    const notice = (await snapshot()).notifications.at(-1);
    await page.locator('[data-record-id="' + notice.id + '"]').click();
    await click("Mark read");
    await submit("Mark read");
    check(
      "Read flag explicit and persisted",
      (await snapshot()).notifications.find((n) => n.id === notice.id).read,
    );
    await shot("11-notices");
    // Lost acknowledgement retries must preserve request identity.
    await click("Find a room");
    await page.locator('[data-record-id="room-willow"]').click();
    await ready();
    await click("Hold this room");
    await page.getByLabel("Meeting title").fill("Retry hold");
    let dropped = false;
    await page.route("**/api/call", async (route) => {
      const p = route.request().postDataJSON();
      if (!dropped && p.name === "spacebook.holds.create") {
        dropped = true;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    });
    await page
      .locator("dialog")
      .getByRole("button", { name: "Create hold", exact: true })
      .click();
    await page.locator('dialog [data-code="request_failed"]').waitFor();
    await submit("Create hold");
    await page.unroute("**/api/call");
    check(
      "Lost-response retry has one hold",
      (await snapshot()).holds.filter((x) => x.title === "Retry hold")
        .length === 1,
    );
    h = (await snapshot()).holds.find((x) => x.title === "Retry hold");
    await page.locator('[data-record-id="' + h.id + '"]').click();
    await click("Confirm booking");
    s = await infra.call("env.snapshot");
    await infra.call("env.advance_time", {
      expected_version: s.version,
      virtual_now: h.expires_at,
      request_id: "browser-expiry",
    });
    await page
      .locator("dialog")
      .getByRole("button", { name: "Confirm booking", exact: true })
      .click();
    await page.locator('dialog [data-code="stale_version"]').waitFor();
    await page
      .locator("dialog")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await click("Refresh");
    await click("My holds");
    await page.locator('[data-record-id="' + h.id + '"]').click();
    check(
      "Expired hold shown and confirmation unavailable",
      (await page.locator(".detail").innerText()).includes("expired") &&
        (await page
          .getByRole("button", { name: "Confirm booking", exact: true })
          .count()) === 0,
    );
    await shot("12-expired");
    await click("Find a room");
    await page.locator('[data-record-id="room-willow"]').click();
    await ready();
    await click("Hold this room");
    await page
      .getByLabel("Meeting title")
      .fill('<img src=x onerror="window.injected=true">');
    await submit("Create hold");
    h = (await snapshot()).holds.at(-1);
    await page.locator('[data-record-id="' + h.id + '"]').click();
    check(
      "Untrusted title rendered as text",
      !(await page.evaluate(() => window.injected)),
    );
    await click("Release hold");
    await submit("Release hold");
    check(
      "Browser release commits",
      (await snapshot()).holds.find((x) => x.id === h.id).status === "released",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await click("Find a room");
    await shot("13-mobile");
    check(
      "Mobile page has no horizontal overflow",
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    check("No browser JavaScript errors", errors.length === 0);
    report.passed = true;
  } catch (e) {
    report.error = e.stack;
    process.exitCode = 1;
  } finally {
    await context?.close();
    await infra?.close();
    await host?.close();
    await browser.close();
    fs.rmSync(stateDir, { recursive: true, force: true });
    fs.writeFileSync(
      path.join(out, "browser.json"),
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
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
