// apps/health-hub/test/gui-browser.test.cjs
const assert = require("assert");
const fs = require("fs");
const path = require("path");

console.log("Running GUI Browser Asset & Render Checks...");

const htmlContent = fs.readFileSync(path.join(__dirname, "../gui/index.html"), "utf-8");
const jsContent = fs.readFileSync(path.join(__dirname, "../gui/app.js"), "utf-8");
const cssContent = fs.readFileSync(path.join(__dirname, "../gui/style.css"), "utf-8");

// 1. Verify link and script tags are correctly pointing to flat gui/ files
assert.ok(htmlContent.includes('<link rel="stylesheet" href="style.css">'), "Must link style.css without src/");
assert.ok(htmlContent.includes('<script src="app.js"></script>'), "Must load app.js without src/");

// 2. Verify all required view panels and metric containers exist in HTML
const requiredElements = [
  'id="val-recovery"',
  'id="val-sleep"',
  'id="val-strain"',
  'id="val-weight"',
  'id="biometrics-tbody"',
  'id="workouts-tbody"',
  'id="goals-list"',
  'id="routines-container"',
  'id="notification-list"'
];

requiredElements.forEach((el) => {
  assert.ok(htmlContent.includes(el), `Missing essential DOM element in index.html: ${el}`);
});
console.log("✓ All essential DOM containers present in gui/index.html");

// 3. Verify app.js defines the render logic matching our schemas
assert.ok(jsContent.includes("renderApp"), "app.js must define renderApp function");
assert.ok(jsContent.includes("no_data"), "app.js must handle no_data status");
assert.ok(jsContent.includes("device_not_worn"), "app.js must handle device_not_worn reason");
assert.ok(jsContent.includes("recovery_score"), "app.js must display recovery_score");

console.log("✓ GUI render logic verified successfully!");
