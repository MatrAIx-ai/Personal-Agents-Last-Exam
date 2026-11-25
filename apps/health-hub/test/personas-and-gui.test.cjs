// apps/health-hub/test/personas-and-gui.test.cjs
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const plugin = require("../src/index.cjs");

console.log("Verifying Personas Generator and GUI Artifacts...");

// 1. Run Persona Generator
require("../scripts/generate_personas.cjs");

// 2. Validate all 5 generated personas against validateSeed hook
const personasDir = path.join(__dirname, "../fixtures/personas");
const personaFiles = fs.readdirSync(personasDir).filter((f) => f.endsWith(".json"));

assert.strictEqual(personaFiles.length, 5, "Must generate exactly 5 persona profiles");

personaFiles.forEach((file) => {
  const seed = JSON.parse(fs.readFileSync(path.join(personasDir, file), "utf-8"));
  const res = plugin.validateSeed(seed);
  assert.strictEqual(res.valid, true, `Seed validation failed for ${file}`);
  assert.strictEqual(seed.daily_summaries.length, 365, `${file} should have 365 days of 2025 history`);

  // Assert start date invariant
  assert.strictEqual(seed.daily_summaries[0].date, "2025-01-01");
});
console.log("✓ All 5 personas validated against validateSeed hook (365 days each)");

// 3. Verify Task #117 compliance (Elena has the 2-day physio gap in Oct 2025)
const elena = JSON.parse(fs.readFileSync(path.join(personasDir, "person_endurance_01.json"), "utf-8"));
const gap1 = elena.daily_summaries.find((s) => s.date === "2025-10-14");
const gap2 = elena.daily_summaries.find((s) => s.date === "2025-10-15");
assert.strictEqual(gap1.status, "no_data");
assert.strictEqual(gap1.reason, "device_not_worn");
assert.strictEqual(gap2.status, "no_data");
console.log("✓ Task #117 explicit 2-day gap requirement verified");

// 4. Verify Task #52 compliance (Sophia has continuous body-weight tracking)
const sophia = JSON.parse(fs.readFileSync(path.join(personasDir, "person_deskworker_03.json"), "utf-8"));
const withWeight = sophia.daily_summaries.filter((s) => s.metrics && s.metrics.body_weight_kg > 0);
assert.strictEqual(withWeight.length > 300, true);
console.log("✓ Task #52 body-weight logging requirement verified");

// 5. Verify GUI Manifest and Assets
const guiManifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../contribution/gui.json"), "utf-8"));
assert.strictEqual(guiManifest.app_id, "health-hub");
assert.strictEqual(fs.existsSync(path.join(__dirname, "../gui/index.html")), true);
assert.strictEqual(fs.existsSync(path.join(__dirname, "../gui/app.js")), true);
assert.strictEqual(fs.existsSync(path.join(__dirname, "../gui/style.css")), true);
console.log("✓ GUI manifest and assets verified");

console.log("\nAll milestone 3 and 4 checks passed cleanly!");
