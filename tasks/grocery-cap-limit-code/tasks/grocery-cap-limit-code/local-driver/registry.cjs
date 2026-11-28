'use strict';

const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const taskRoot = path.resolve(__dirname, '..');
const packageRoot = path.resolve(taskRoot, '../..');
const repoRoot = path.resolve(packageRoot, '../..');
const APP_PATHS = [
  'tasks/grocery-cap-limit-code/.deps/keelcard',
  'examples/apps/mail',
  'tasks/grocery-cap-limit-code/tasks/grocery-cap-limit-code/environment/apps/freshcart',
  'tasks/grocery-cap-limit-code/tasks/grocery-cap-limit-code/environment/apps/webstub'
];

function prepareRun(label) {
  const token = String(label || 'run').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  const id = token + '-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');
  const runRoot = path.join(packageRoot, '.runs', id);
  fs.mkdirSync(runRoot, { recursive: true });
  for (const rel of APP_PATHS) {
    const dest = path.join(runRoot, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    execFileSync('cp', ['-al', path.join(repoRoot, rel), dest]);
  }
  const registryFile = path.join(runRoot, 'registry.json');
  fs.writeFileSync(registryFile, JSON.stringify({
    schema_version: 1,
    initial_time: '2026-11-18T09:00:00-08:00',
    apps: [
      { app_id: 'keelcard', version: '1.0.0', path: APP_PATHS[0] },
      { app_id: 'mail', version: '1.3.0', path: APP_PATHS[1] },
      { app_id: 'freshcart', version: '1.0.0', path: APP_PATHS[2] },
      { app_id: 'webstub', version: '1.0.0', path: APP_PATHS[3] }
    ]
  }, null, 2));
  return { runRoot, registryFile, stateDir: path.join(runRoot, 'state'), repoRoot };
}

function routerConfig(registryFile, publisher) {
  const merchants = publisher === 'freshcart';
  const body = {
    schema_version: 2,
    registry: path.relative(repoRoot, registryFile).replaceAll('\\', '/'),
    publishers: [{
      app_id: merchants ? 'freshcart' : 'keelcard',
      account_id: merchants ? 'fc-grace' : 'kc-adeyemi',
      owner_person_id: 'person-grace',
      package_root: merchants
        ? 'tasks/grocery-cap-limit-code/.deps/keelcard/examples/test-merchant'
        : 'tasks/grocery-cap-limit-code/.deps/keelcard',
      contribution_ref: 'contribution/contribution.json',
      allowed_recipients: merchants
        ? [{ app_id: 'keelcard', account_id: 'kc-adeyemi', channel: 'channel.card.authorization' }]
        : [{ app_id: 'mail', account_id: 'mail-grace', channel: 'channel.email' }]
    }],
    authentication: { mode: 'trusted-stdio' }
  };
  const config = path.join(path.dirname(registryFile), (merchants ? 'merchant' : 'mail') + '.router.json');
  fs.writeFileSync(config, JSON.stringify(body, null, 2));
  return config;
}

module.exports = { prepareRun, routerConfig, packageRoot, repoRoot, taskRoot };
