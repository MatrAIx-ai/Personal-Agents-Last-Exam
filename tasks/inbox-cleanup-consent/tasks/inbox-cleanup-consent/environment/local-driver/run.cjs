#!/usr/bin/env node
'use strict';
// Stand-in runner CLI.
//   node run.cjs --plan PLAN.json --setting A --variant main --out run.json
//   node run.cjs --agent-module MOD.cjs --setting A --variant main --out run.json
// PALE_AGENT_COMMAND is the seam for a later model command. This CLI does not launch one.
const fs = require('node:fs');
const path = require('node:path');
const {Driver} = require('./driver.cjs');

function args(argv) {
  const out = {setting: 'A', variant: 'main', memory: 'notes', hinted: false};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--hinted') out.hinted = true;
    else if (a.startsWith('--')) out[a.slice(2)] = argv[i += 1];
  }
  return out;
}

function planAgent(file) {
  const plan = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cursor = {s1: 0, s2: 0, s3: 0};
  return {
    name: plan.name,
    plan,
    next(session) {
      const steps = plan.sessions[session] || [];
      if (cursor[session] >= steps.length) return null;
      const step = steps[cursor[session]];
      cursor[session] += 1;
      return step;
    }
  };
}

async function main() {
  const o = args(process.argv.slice(2));
  if (!o['agent-module'] && process.env.PALE_AGENT_MODULE) o['agent-module'] = process.env.PALE_AGENT_MODULE;
  if (!o.out || !(o.plan || o['agent-module'])) {
    console.error('usage: run.cjs (--plan PLAN.json | --agent-module MOD.cjs) --out RUN.json --setting A|B --variant main|no-reply|clarification [--memory notes|memory] [--hinted] [--run-id ID]');
    process.exit(2);
  }
  if (!['A', 'B'].includes(o.setting)) throw new Error('setting must be A or B');
  if (!['main', 'no-reply', 'clarification'].includes(o.variant)) throw new Error('unknown variant');
  const agent = o.plan ? planAgent(path.resolve(o.plan)) : require(path.resolve(o['agent-module'])).createAgent();
  if (agent.plan && !agent.plan.settings.includes(o.setting)) throw new Error(agent.plan.name + ' does not declare setting ' + o.setting);
  if (agent.plan && agent.plan.variant !== o.variant) throw new Error(agent.plan.name + ' is variant ' + agent.plan.variant);
  const runId = (o['run-id'] || ('icc-' + (agent.name || 'run') + '-' + o.setting)).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  const driver = new Driver({
    setting: o.setting,
    variant: o.variant,
    memory: o.memory,
    hinted: o.hinted,
    runId,
    agent
  });
  const trace = await driver.execute();
  fs.mkdirSync(path.dirname(path.resolve(o.out)), {recursive: true});
  fs.writeFileSync(o.out, JSON.stringify(trace));
  console.log(JSON.stringify({
    run_id: trace.run_id,
    label: trace.label,
    setting: trace.setting,
    variant: trace.variant,
    memory_source: trace.memory_source,
    hinted: trace.hinted,
    stop: !!trace.stop,
    tool_calls: trace.tool_calls.length,
    tokens: trace.token_measurements,
    out: o.out
  }));
}

main().catch((err) => {
  console.error(err.stack || err);
  process.exit(1);
});
