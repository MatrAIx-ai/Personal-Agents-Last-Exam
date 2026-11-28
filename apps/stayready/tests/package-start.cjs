'use strict';
// Exercise the documented CLI from the App directory, not an imported Host
// helper or the repository-root npm scripts.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const app = path.resolve(__dirname, '..');
const runtime = process.env.PALE_RUNTIME_ROOT || path.resolve(app, '../../runtime');
const output = process.env.STAYREADY_REPORT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'stayready-start-report-'));
const state = fs.mkdtempSync(path.join(os.tmpdir(), 'stayready-cli-state-'));
const args = [path.join(runtime, 'web/server.cjs'), '--app', 'stayready', '--registry', 'web.registry.json', '--run', 'package-start', '--state-dir', state, '--port', '0'];
const child = spawn(process.execPath, args, { cwd: app, stdio: ['ignore', 'pipe', 'pipe'] });
const report = { schema: 'stayready.package-start.v1', command: 'node ../../runtime/web/server.cjs --app stayready --registry web.registry.json --run package-start --state-dir TEMP --port 0',
  cwd: 'apps/stayready', node: process.version, checks: [], passed: false };
let timer;
async function main() {
  try {
    const access = await new Promise((resolve, reject) => {
      let text = '', errors = '';
      timer = setTimeout(() => reject(Error('Host did not start: ' + errors)), 20000);
      child.stdout.on('data', bytes => { text += bytes; const match = /Open (http:\/\/127\.0\.0\.1:\d+\/#access=\S+)/.exec(text); if (match) resolve(new URL(match[1])); });
      child.stderr.on('data', bytes => { errors += bytes; });
      child.once('error', reject); child.once('exit', code => reject(Error('Host exited before startup: ' + code + ' ' + errors)));
    });
    clearTimeout(timer);
    const page = await fetch(access.origin + '/');
    assert.equal(page.status, 200); assert.match(await page.text(), /StayReady/);
    report.checks.push('Documented CLI serves the actual StayReady page using the package registry');
    const session = await fetch(access.origin + '/session', { method: 'POST', headers: { Origin: access.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: access.hash.slice('#access='.length) }) });
    assert.equal(session.status, 200);
    const { csrf } = await session.json();
    const cookie = session.headers.get('set-cookie').split(';')[0];
    const tools = await fetch(access.origin + '/api/tools', { headers: { Cookie: cookie } }).then(r => r.json());
    assert(tools.tools.some(t => t.name === 'stayready.inspect'));
    assert(tools.tools.every(t => !t.name.startsWith('env.')));
    report.checks.push('Actual Host session discovers business tools without management tools');
    const inspected = await fetch(access.origin + '/api/call', { method: 'POST', headers: { Origin: access.origin, Cookie: cookie, 'Content-Type': 'application/json', 'X-Pale-CSRF': csrf }, body: JSON.stringify({ name: 'stayready.inspect', arguments: {} }) }).then(r => r.json());
    assert.equal(inspected.status, 'ok'); assert.equal(inspected.view.property.timezone, 'Europe/London');
    assert.equal(inspected.view.stay.guest_person_ids.length, 2);
    report.checks.push('CLI-started public bridge retrieves the actual bound hotel state');
    report.observed = { timezone: inspected.view.property.timezone, property: inspected.view.property.name, version: inspected.version };
    report.passed = true;
  } finally {
    clearTimeout(timer);
    await new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      const limit = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000);
      child.once('exit', () => { clearTimeout(limit); resolve(); }); child.kill('SIGTERM');
    });
    fs.rmSync(state, { recursive: true, force: true });
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'package-start.json'), JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
