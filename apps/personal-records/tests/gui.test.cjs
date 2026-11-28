const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HTML_PATH = path.join(__dirname, '../gui/index.html');
const CSS_PATH = path.join(__dirname, '../gui/style.css');
const JS_PATH = path.join(__dirname, '../gui/app.js');

test('Milestone 3: GUI Asset Completeness & Structure', () => {
  assert.ok(fs.existsSync(HTML_PATH), 'gui/index.html must exist');
  assert.ok(fs.existsSync(CSS_PATH), 'gui/style.css must exist');
  assert.ok(fs.existsSync(JS_PATH), 'gui/app.js must exist');

  const html = fs.readFileSync(HTML_PATH, 'utf-8');

  // Verify core views exist in DOM
  assert.ok(html.includes('id="view-library"'), 'HTML must contain Document Library view');
  assert.ok(html.includes('id="view-viewer"'), 'HTML must contain Document & Passage Viewer view');
  assert.ok(html.includes('id="view-graph"'), 'HTML must contain Relationship Graph view');
  assert.ok(html.includes('id="view-proposals"'), 'HTML must contain Proposal Review view');

  // Verify key UI elements
  assert.ok(html.includes('id="search-input"'), 'HTML must contain FTS search input');
  assert.ok(html.includes('id="caller-session-toggle"'), 'HTML must contain user/agent actor selector');
});

test('Milestone 3: Passage Citation Highlighting & CSS Selectors', () => {
  const css = fs.readFileSync(CSS_PATH, 'utf-8');
  assert.ok(css.includes('mark.passage-highlight'), 'CSS must define passage highlight styles');

  const js = fs.readFileSync(JS_PATH, 'utf-8');
  assert.ok(js.includes('renderHighlightedPassages'), 'JS must implement passage highlight rendering');
  assert.ok(js.includes('passage-highlight'), 'JS must attach passage-highlight class to citations');
});

test('Milestone 3: Proposal Review & Confirmation Tool Binding', () => {
  const js = fs.readFileSync(JS_PATH, 'utf-8');

  // Verify MCP tool bindings
  assert.ok(js.includes("records.search"), 'JS must call records.search');
  assert.ok(js.includes("records.get_document"), 'JS must call records.get_document');
  assert.ok(js.includes("records.confirm_update"), 'JS must call records.confirm_update');

  // Verify user confirmation path
  assert.ok(js.includes("confirmProposal"), 'JS must define confirmProposal handler');
  assert.ok(js.includes("callerRole"), 'JS must propagate callerRole for trusted session gating');
});
