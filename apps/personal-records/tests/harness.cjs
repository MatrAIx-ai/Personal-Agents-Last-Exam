'use strict';
const fs = require('node:fs');
const path = require('node:path');
const plugin = require('../plugin.cjs');

function fixture() {
  const dir = path.resolve(__dirname, '..');
  let data = JSON.parse(fs.readFileSync(path.join(dir, 'fixtures/minimal.json'), 'utf8'));
  const binding = JSON.parse(fs.readFileSync(path.join(dir, 'fixtures/binding.json'), 'utf8'));
  const clock = JSON.parse(fs.readFileSync(path.join(dir, 'fixtures/clock.json'), 'utf8'));
  let virtual_now = clock.initial_time;

  return {
    get data() {
      return data;
    },
    get virtual_now() {
      return virtual_now;
    },
    call(name, args = {}) {
      const ctx = {
        app_id: 'personal-records',
        run_id: 'test-run',
        role: 'agent',
        binding,
        virtual_now
      };
      const out = plugin.handleTool(ctx, structuredClone(data), name, structuredClone(args));
      data = out.data;
      return out.result;
    },
    event(ev) {
      virtual_now = ev.at || virtual_now;
      const ctx = {
        app_id: 'personal-records',
        run_id: 'test-run',
        role: 'infra',
        binding,
        virtual_now
      };
      data = plugin.applyEvent(ctx, structuredClone(data), structuredClone(ev));
      return data;
    }
  };
}

module.exports = { fixture };
