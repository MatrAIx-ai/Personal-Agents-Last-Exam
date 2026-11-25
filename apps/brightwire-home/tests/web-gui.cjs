'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {start} = require('../../../runtime/web/server.cjs');
const {Client} = require('../../../runtime/client.cjs');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '../../..');
const registry = path.join(root, 'apps.registry.json');
const stateDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bw-gui-'));
const shots = path.join(__dirname, '../contribution');

async function until(read, check, label) {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < 8000) {
    last = await read();
    if (check(last)) return last;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(label + ': ' + last);
}

async function main() {
  const host = await start({
    app: 'brightwire-home',
    registry,
    run: 'bw-gui',
    stateDir,
    profile: 'sandbox'
  });
  const reader = new Client('brightwire-home', 'agent', 'bw-gui', stateDir, 'bw-gui-reader', {registry});
  const browser = await chromium.launch({headless: true});
  const page = await browser.newPage({viewport: {width: 1280, height: 800}});
  const notes = [];
  try {
    await reader.initialize();
    await page.goto(host.accessUrl);
    await page.waitForSelector('[data-device-id="light-living"]');
    notes.push('page loaded from the access link');
    await page.locator('[data-field="brightness"]').fill('37');
    await page.locator('[data-action="set-brightness"]').click();
    await until(() => page.locator('#status').innerText(), text => text.includes('applied'), 'brightness status');
    const afterWrite = await reader.call('brightwire-home.devices.get', {device_id: 'light-living'});
    if (afterWrite.device.observed.brightness !== 37) throw new Error('MCP readback brightness ' + afterWrite.device.observed.brightness);
    notes.push('browser set brightness 37 and MCP read it back');
    await page.screenshot({path: path.join(shots, 'gui-rooms.png')});
    await page.reload();
    await page.waitForSelector('[data-device-state="light-living"]');
    const reloaded = await page.locator('[data-device-state="light-living"]').innerText();
    if (!reloaded.includes('brightness 37')) throw new Error('Reload lost brightness: ' + reloaded);
    notes.push('reload kept brightness 37');
    const version = afterWrite.version;
    await reader.call('brightwire-home.devices.command', {
      device_id: 'light-living',
      command: 'set_brightness',
      args: {brightness: 55},
      expected_version: version,
      request_id: 'mcp-brightness-55'
    });
    await page.locator('[data-action="refresh"]').click();
    await until(
      () => page.locator('[data-device-state="light-living"]').innerText(),
      text => text.includes('brightness 55'),
      'refreshed brightness'
    );
    notes.push('MCP brightness 55 appeared after Refresh');
    await page.locator('button[data-device-id="lock-front"]').click();
    await page.locator('[data-action="unlock"]').click();
    await until(() => page.locator('#status').innerText(), text => text.includes('confirmation_required'), 'unlock status');
    const marked = await page.locator('#status').getAttribute('data-error');
    if (marked !== 'true') throw new Error('confirmation_required was shown as success');
    const lock = await reader.call('brightwire-home.devices.get', {device_id: 'lock-front'});
    if (lock.device.observed.lock !== 'locked') throw new Error('Unlock was applied without approval');
    notes.push('unlock showed confirmation_required and the lock stayed locked');
    await page.screenshot({path: path.join(shots, 'gui-confirmation.png')});
    const cookies = await page.context().cookies();
    const cookie = cookies.map(item => item.name + '=' + item.value).join('; ');
    const sessionBody = await fetch(host.url + '/session', {headers: {cookie}});
    const sessionJson = await sessionBody.json();
    const reset = await fetch(host.url + '/api/call', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', cookie, 'X-Pale-CSRF': sessionJson.csrf, Origin: host.url},
      body: JSON.stringify({name: 'env.reset', arguments: {}})
    });
    const hidden = await fetch(host.url + '/management', {headers: {cookie}});
    const session = {reset: reset.status, resetBody: await reset.json(), hidden: hidden.status};
    if (session.reset !== 403) throw new Error('env.reset returned ' + session.reset);
    if (session.hidden !== 404) throw new Error('hidden path returned ' + session.hidden);
    notes.push('env.reset returned 403 and /management returned 404');
    const scenes = await page.locator('[data-section="scenes"]').click().then(() => page.locator('[data-scene-id]').count());
    const routines = await page.locator('[data-section="routines"]').click().then(() => page.locator('[data-routine-id]').count());
    if (!scenes || !routines) throw new Error('Scenes or routines were not listed');
    notes.push('scene and routine controls are listed');
    const summary = {
      node: process.version,
      browser: browser.version(),
      host: 'node runtime/web/server.cjs --registry apps.registry.json --app brightwire-home --run bw-gui --profile sandbox',
      notes
    };
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await browser.close();
    await reader.close();
    await host.close();
    fs.rmSync(stateDir, {recursive: true, force: true});
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
