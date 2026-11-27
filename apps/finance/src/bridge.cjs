'use strict';
const path = require('node:path');
const {spawnSync} = require('node:child_process');

function pythonRequest(input, invoke = spawnSync) {
  // A killed computation cannot commit anything: Python has no independent
  // state, database, network calls or external effects. Retry the same immutable
  // JSON once on a startup/calculation timeout, within the MCP call budget.
  let result;
  for (let attempt = 0; attempt < 2; attempt++) {
    result = invoke('python3', ['-B', path.join(__dirname, 'ledger.py')], {
      input, encoding: 'utf8', timeout: 2000, maxBuffer: 32 * 1024 * 1024,
      env: {PATH: process.env.PATH || '', PYTHONDONTWRITEBYTECODE: '1'}
    });
    if (result.error?.code !== 'ETIMEDOUT') break;
  }
  if (result.error?.code === 'ETIMEDOUT') {
    throw Object.assign(new Error('Finance calculation timed out. Refresh the current state before retrying.'), {code: 'finance_timeout'});
  }
  if (result.error || result.status !== 0) {
    const missing = result.error?.code === 'ENOENT';
    throw Object.assign(new Error(missing ? 'Finance requires Python 3.11+ available as python3.' : 'Finance could not calculate a valid result.'),
      {code: missing ? 'finance_unavailable' : 'finance_failed'});
  }
  return result.stdout;
}

function business(ctx, data, operation) {
  const stdout = pythonRequest(JSON.stringify({ctx: {binding: ctx.binding, role: ctx.role, virtual_now: ctx.virtual_now}, data, ...operation}));
  let response;
  try { response = JSON.parse(stdout); }
  catch { throw Object.assign(new Error('Finance returned an invalid response.'), {code: 'invalid_plugin_result'}); }
  if (response.error) throw Object.assign(new Error(response.error.message), {code: response.error.code});
  return response;
}
module.exports = {business, pythonRequest};
