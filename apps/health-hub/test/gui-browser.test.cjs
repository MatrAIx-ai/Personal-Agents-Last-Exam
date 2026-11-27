'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { start } = require('../../../runtime/web/server.cjs');
const { prepare } = require('../../../runtime/prepare.cjs');

async function main() {
  console.log('Running GUI Browser Asset & Web Host Integration Checks...');

  const htmlContent = fs.readFileSync(path.join(__dirname, '../gui/index.html'), 'utf-8');
  const jsContent = fs.readFileSync(path.join(__dirname, '../gui/app.js'), 'utf-8');

  assert.ok(htmlContent.includes('<link rel="stylesheet" href="/shared/style.css">'), 'Must link /shared/style.css');
  assert.ok(htmlContent.includes('<script src="/app.js"></script>'), 'Must load /app.js');

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
  for (const el of requiredElements) {
    assert.ok(htmlContent.includes(el), `Missing essential DOM element in index.html: ${el}`);
  }
  assert.ok(jsContent.includes('renderApp'), 'app.js must define renderApp function');
  assert.ok(jsContent.includes('no_data'), 'app.js must handle no_data status');
  assert.ok(jsContent.includes('device_not_worn'), 'app.js must handle device_not_worn reason');

  // Verify live runtime/web/server.cjs host integration
  const prepared = prepare(path.resolve(__dirname, '..'));
  const stateDir = path.join(prepared.root, 'web-state');

  let host;
  try {
    host = await start({ app: 'health-hub', registry: prepared.registry, stateDir, profile: 'sandbox' });
    const pageRes = await fetch(host.url + '/');
    assert.equal(pageRes.status, 200);
    const appJsRes = await fetch(host.url + '/app.js');
    assert.equal(appJsRes.status, 200);
    const cssRes = await fetch(host.url + '/shared/style.css');
    assert.equal(cssRes.status, 200);

    const token = new URLSearchParams(host.accessUrl.split('#')[1]).get('access');
    const sessionRes = await fetch(host.url + '/session', {
      method: 'POST',
      headers: { Origin: host.url, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    assert.equal(sessionRes.status, 200);
    const cookie = sessionRes.headers.get('set-cookie').split(';')[0];
    const { csrf } = await sessionRes.json();
    const headers = { Origin: host.url, 'Content-Type': 'application/json', Cookie: cookie, 'X-Pale-CSRF': csrf };

    const toolsRes = await fetch(host.url + '/api/tools', { headers: { Cookie: cookie } });
    assert.equal(toolsRes.status, 200);
    const { tools } = await toolsRes.json();
    assert.equal(tools.length, 13);

    const metricsRes = await fetch(host.url + '/api/call', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'health-hub.list_metrics',
        arguments: { metric_type: 'recovery', start_date: '2025-10-14', end_date: '2025-10-15' }
      })
    });
    const metricsJson = await metricsRes.json();
    assert.equal(metricsJson.status, 'ok');
    assert.equal(metricsJson.series[0].status, 'no_data');

    const planRes = await fetch(host.url + '/api/call', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'health-hub.plan_workout',
        arguments: {
          activity_type: 'swimming',
          scheduled_at: '2026-01-03T07:00:00Z',
          duration_minutes: 40,
          expected_version: metricsJson.version,
          request_id: 'gui-test-plan-1'
        }
      })
    });
    const planJson = await planRes.json();
    assert.equal(planJson.status, 'committed');
    assert.equal(planJson.workout.activity_type, 'swimming');
    console.log('✓ Web host GUI routes and MCP bridge calls verified!');
  } finally {
    await host?.close();
    prepared.cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
