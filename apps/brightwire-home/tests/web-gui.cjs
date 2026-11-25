'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {start} = require('../../../runtime/web/server.cjs');
const {Client} = require('../../../runtime/client.cjs');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '../../..');
const registry = path.join(root, 'apps.registry.json');
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-gui-'));
const updateShots = process.argv.includes('--update-screenshots');
const shots = updateShots
  ? path.join(__dirname, '../contribution')
  : fs.mkdtempSync(path.join(os.tmpdir(), 'bw-gui-shots-'));

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

async function settled(page, check, label) {
  return until(async () => {
    const busy = await page.locator('body').getAttribute('data-busy');
    const text = await page.locator('#status').innerText();
    return (busy ? 'busy ' : '') + text;
  }, text => !text.startsWith('busy') && check(text), label);
}

async function loadSeed(infra, name) {
  const data = require(path.join(__dirname, '../fixtures', name + '.json'));
  const binding = require(path.join(__dirname, '../fixtures', 'binding-' + name + '.json'));
  const opened = await infra.call('env.snapshot');
  const loaded = await infra.call('env.load_seed', {
    expected_version: opened.version,
    request_id: 'gui-seed-' + name,
    virtual_now: data.committed_through,
    data,
    binding,
    policies: opened.snapshot.policies,
    bundle: opened.snapshot.resources.bundle
  });
  if (loaded.status !== 'ready') throw new Error(name + ' seed ' + JSON.stringify(loaded));
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
  const infra = new Client('brightwire-home', 'infra', 'bw-gui', stateDir, 'bw-gui-infra', {registry, initialProfile: 'sandbox'});
  const browser = await chromium.launch({headless: true});
  const page = await browser.newPage({viewport: {width: 1280, height: 800}});
  const notes = [];
  let failLists = 0;
  await page.route('**/api/call', async route => {
    const body = route.request().postDataJSON();
    if (failLists && body && body.name === 'brightwire-home.devices.list') {
      failLists -= 1;
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
  let unlockCalls = 0;
  page.on('request', request => {
    if (!request.url().includes('/api/call')) return;
    const body = request.postData() || '';
    if (body.includes('brightwire-home.devices.command') && body.includes('"unlock"')) unlockCalls += 1;
  });
  try {
    await reader.initialize();
    await infra.initialize();
    await page.goto(host.accessUrl);
    await page.waitForSelector('[data-device-id="light-living"]');
    notes.push('page loaded from the access link');
    await page.locator('[data-field="brightness"]').fill('37');
    await page.locator('[data-action="set-brightness"]').click();
    await settled(page, text => text.includes('applied'), 'brightness status');
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

    await page.locator('[data-section="routines"]').click();
    await page.locator('[data-run-routine="rt-front-0700"]').click();
    await settled(page, text => text.includes('confirmation_required') && text.includes('cf-1'), 'routine result');
    const routineError = await page.locator('#status').getAttribute('data-error');
    if (routineError !== 'true') throw new Error('routine confirmation was shown as success');
    const routineRow = await page.locator('[data-outcome="confirmation_required"]').innerText();
    if (!routineRow.includes('lock-front') || !routineRow.includes('cf-1')) throw new Error('routine row ' + routineRow);
    notes.push('run now showed confirmation_required cf-1');

    await page.locator('[data-section="home"]').click();
    await page.waitForSelector('[data-panel="home"]');
    const minimalLock = await page.locator('[data-field="lock"]').inputValue();
    if (minimalLock !== 'lock-front') throw new Error('minimal lock selector ' + minimalLock);
    await page.locator('[data-mode="away"]').click();
    await settled(page, text => text.includes('applied'), 'mode status');
    const mode = await reader.call('brightwire-home.modes.get', {});
    if (mode.home_mode !== 'away') throw new Error('MCP mode ' + mode.home_mode);
    await page.locator('[data-action="create-code"]').click();
    await settled(page, text => text.includes('Digits'), 'guest code status');
    const codes = await reader.call('brightwire-home.access_codes.list', {});
    const guest = codes.codes.find(item => item.holder_name === 'Guest');
    if (!guest || !guest.locks.includes('lock-front')) throw new Error('MCP guest code ' + JSON.stringify(guest));
    notes.push('Home mode and guest code used lock-front');

    const before = await infra.call('env.snapshot');
    const beforeConfirmations = before.snapshot.data.confirmations.length;
    const beforeNotices = before.snapshot.data.notices.length;
    await page.locator('[data-section="rooms"]').click();
    await page.locator('button[data-device-id="lock-front"]').click();
    failLists = 1;
    unlockCalls = 0;
    await page.locator('[data-action="unlock"]').click();
    await settled(page, text => text.includes('confirmation_required') && text.includes('could not be refreshed'), 'unlock status');
    const marked = await page.locator('#status').getAttribute('data-error');
    if (marked !== 'true') throw new Error('confirmation_required was shown as success');
    const lock = await reader.call('brightwire-home.devices.get', {device_id: 'lock-front'});
    if (lock.device.observed.lock !== 'locked') throw new Error('Unlock was applied without approval');
    notes.push('unlock showed confirmation_required and the lock stayed locked');
    await page.screenshot({path: path.join(shots, 'gui-confirmation.png')});
    await page.locator('[data-action="unlock"]').click();
    await settled(page, text => text.includes('confirmation_required') && !text.includes('could not be refreshed'), 'unlock retry');
    if (unlockCalls !== 1) throw new Error('unlock was sent ' + unlockCalls + ' times');
    const after = await infra.call('env.snapshot');
    const addedConfirmations = after.snapshot.data.confirmations.length - beforeConfirmations;
    const addedNotices = after.snapshot.data.notices.length - beforeNotices;
    if (addedConfirmations !== 1 || addedNotices !== 1) {
      throw new Error('retry added confirmations ' + addedConfirmations + ' notices ' + addedNotices);
    }
    notes.push('a failed refresh then a retry kept one confirmation and one notice');

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
    if (reset.status !== 403) throw new Error('env.reset returned ' + reset.status);
    if (hidden.status !== 404) throw new Error('hidden path returned ' + hidden.status);
    notes.push('env.reset returned 403 and /management returned 404');
    const scenes = await page.locator('[data-section="scenes"]').click().then(() => page.locator('[data-scene-id]').count());
    const routines = await page.locator('[data-section="routines"]').click().then(() => page.locator('[data-routine-id]').count());
    if (!scenes || !routines) throw new Error('Scenes or routines were not listed');
    notes.push('scene and routine controls are listed');

    await loadSeed(infra, 'household-b');
    await page.reload();
    await page.waitForSelector('[data-device-id="lock-mom-front"]');
    await page.locator('[data-section="home"]').click();
    await page.waitForSelector('[data-panel="home"]');
    const ruthLock = await page.locator('[data-field="lock"]').inputValue();
    if (ruthLock !== 'lock-mom-front') throw new Error('household B lock selector ' + ruthLock);
    await page.locator('[data-mode="away"]').click();
    await settled(page, text => text.includes('applied'), 'household B mode');
    const ruthMode = await reader.call('brightwire-home.modes.get', {});
    if (ruthMode.home_mode !== 'away') throw new Error('household B mode ' + ruthMode.home_mode);
    await page.locator('[data-action="create-code"]').click();
    await settled(page, text => text.includes('Digits'), 'household B code');
    const ruthCodes = await reader.call('brightwire-home.access_codes.list', {});
    const ruthGuest = ruthCodes.codes.find(item => item.holder_name === 'Guest');
    if (!ruthGuest || !ruthGuest.locks.includes('lock-mom-front')) throw new Error('household B code ' + JSON.stringify(ruthGuest));
    notes.push('household B Home controls used lock-mom-front');

    await loadSeed(infra, 'household-c');
    await page.reload();
    await page.locator('button[data-device-id="c-camera-porch"]').click();
    await page.locator('[data-action="share-camera"]').click();
    await settled(page, text => text.includes('applied'), 'camera share');
    await page.waitForSelector('[data-action="stop-share"]');
    const sessionId = await page.locator('[data-action="stop-share"]').getAttribute('data-session-id');
    await page.locator('[data-action="stop-share"]').click();
    await settled(page, text => text.includes('applied'), 'camera stop');
    await until(() => page.locator('[data-action="stop-share"]').count().then(String), text => text === '0', 'stop button cleared');
    const camera = await reader.call('brightwire-home.devices.get', {device_id: 'c-camera-porch'});
    const session = camera.device.sessions.find(item => item.session_id === sessionId);
    if (!session || session.status !== 'ended') throw new Error('camera session ' + JSON.stringify(camera.device.sessions));
    notes.push('household C stopped camera share ' + sessionId);

    const summary = {
      node: process.version,
      browser: browser.version(),
      screenshots: shots,
      host: 'node runtime/web/server.cjs --registry apps.registry.json --app brightwire-home --run bw-gui --profile sandbox',
      notes
    };
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await browser.close();
    await reader.close();
    await infra.close();
    await host.close();
    fs.rmSync(stateDir, {recursive: true, force: true});
    if (!updateShots) fs.rmSync(shots, {recursive: true, force: true});
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
