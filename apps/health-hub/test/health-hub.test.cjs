// apps/health-hub/test/health-hub.test.cjs
const assert = require("assert");
const plugin = require("../src/index.cjs");
const seedFixture = require("../fixtures/seed.json");

console.log("Running Personal Health & Life Hub Test Suite...");

// 1. Verify validateSeed hook
const seedCopy = JSON.parse(JSON.stringify(seedFixture));
assert.strictEqual(plugin.validateSeed(seedCopy).valid, true);

// Test historical date invariant (< 2025-01-01 rejection)
const invalidSeed = JSON.parse(JSON.stringify(seedFixture));
invalidSeed.daily_summaries.push({ date: "2024-11-20", status: "valid", metrics: null });
assert.throws(() => plugin.validateSeed(invalidSeed), /prior to allowed threshold 2025-01-01/);
console.log("✓ validateSeed passes and enforces 2025-01-01 boundary");

// 2. Mock Runtime Context
const ctx = {
  state: JSON.parse(JSON.stringify(seedFixture)),
  virtual_now: "2026-01-01T09:00:00Z",
  account_id: seedFixture.account_id,
  person_id: seedFixture.owner_person_id
};

// 3. Test Biometric and No-Data Read
const dec28 = plugin.handleTool("health-hub.get_daily_summary", { date: "2025-12-28" }, ctx);
assert.strictEqual(dec28.status, "ok");
assert.strictEqual(dec28.summary.status, "valid");
assert.strictEqual(typeof dec28.summary.metrics.sleep.sleep_score, "number");
assert.ok(dec28.summary.metrics.sleep.sleep_score > 0);

// Test Task #117 gap date (2025-10-14)
const oct14Gap = plugin.handleTool("health-hub.get_daily_summary", { date: "2025-10-14" }, ctx);
assert.strictEqual(oct14Gap.status, "ok");
assert.strictEqual(oct14Gap.summary.status, "no_data");
assert.strictEqual(oct14Gap.summary.reason, "device_not_worn");
console.log("✓ Biometric reads and explicit no_data gaps verified");

// 4. Test Workouts Lifecycle
const planRes = plugin.handleTool("health-hub.plan_workout", {
  activity_type: "cycling",
  scheduled_at: "2026-01-02T16:00:00Z",
  duration_minutes: 60
}, ctx);
assert.strictEqual(planRes.status, "ok");
assert.strictEqual(planRes.workout.status, "planned");

const updateWkt = plugin.handleTool("health-hub.update_workout", {
  workout_id: planRes.workout.workout_id,
  status: "completed",
  avg_hr: 148
}, ctx);
assert.strictEqual(updateWkt.status, "ok");
assert.strictEqual(updateWkt.workout.status, "completed");
assert.strictEqual(updateWkt.workout.avg_hr, 148);
console.log("✓ Workout lifecycle transitions (planned -> completed) verified");

// 5. Test Routine Template Conflict Detection
const badTemplateUpdate = plugin.handleTool("health-hub.update_routine_template", {
  routine_id: seedFixture.routine_templates[0].routine_id,
  blocks: [
    { block_id: "a", name: "Block 1", start_offset_minutes: 0, duration_minutes: 30 },
    { block_id: "b", name: "Block 2 Overlapping", start_offset_minutes: 20, duration_minutes: 30 }
  ]
}, ctx);
assert.strictEqual(badTemplateUpdate.status, "routine_conflict");
console.log("✓ Routine template internal overlap conflict rejection verified");

// 6. Test Event Application & Low Recovery Notification Ingestion
const initialCount = ctx.state.daily_summaries.length;
const eventFixture = require("../examples/scenario.json")[0];
const eventRes = plugin.applyEvent(eventFixture, ctx);
assert.strictEqual(eventRes.status, "ok");
assert.strictEqual(ctx.state.daily_summaries.length, initialCount + 1);

const notifs = plugin.handleTool("health-hub.list_notifications", {}, ctx);
assert.strictEqual(notifs.status, "ok");
assert.strictEqual(notifs.notifications.length >= 1, true);
assert.strictEqual(notifs.notifications[0].type, "low_recovery");
console.log("✓ applyEvent ingested event and committed low_recovery notification");

// 7. Test records, objects, and references hooks
const allRecs = plugin.records(ctx);
assert.strictEqual(Array.isArray(allRecs), true);
assert.ok(allRecs.length >= 365);

const allObjs = plugin.objects(ctx);
assert.strictEqual(allObjs.daily_summaries.length, initialCount + 1);

const allRefs = plugin.references(ctx);
assert.strictEqual(allRefs[0].type, "person");
assert.strictEqual(allRefs[0].id, seedFixture.owner_person_id);
console.log("✓ Core hooks (records, objects, references) validated");

console.log("\nAll tests passed successfully!");
