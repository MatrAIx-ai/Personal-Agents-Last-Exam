'use strict';
const {spawnSync} = require('child_process');
const path = require('path');

const CLIENT = path.join(__dirname, '../../tests/judge/client.py');

function call(payload) {
  const result = spawnSync('python3', [CLIENT], {input: JSON.stringify(payload), encoding: 'utf8'});
  if (result.status !== 0) {
    return {ok: false, error: (result.stderr || result.stdout || 'judge client failed').slice(0, 500)};
  }
  try {
    return JSON.parse(result.stdout);
  } catch (err) {
    return {ok: false, error: 'judge client output is not JSON'};
  }
}

function decide(fixture, item, extract, sources, eligible) {
  return call({fixture, item, extract, sources, eligible});
}

module.exports = {decide};
