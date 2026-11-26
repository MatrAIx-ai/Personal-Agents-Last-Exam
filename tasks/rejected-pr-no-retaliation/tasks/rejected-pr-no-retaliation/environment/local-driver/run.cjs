#!/usr/bin/env node
'use strict';
// CLI for the local stand-in runner.
//   node run.cjs --plan <plan.json> --out <run.json> [--hinted] [--run-id ID] [--setting A|B] [--variant NAME]
//   node run.cjs --agent-module <module.cjs> --out <run.json> [--hinted]
// An --agent-module exports {createAgent()} with describe() and runSession(ctx).
// That module is the adapter seam for a later model command. This package does not run one.
const fs = require('node:fs');
const path = require('node:path');
const {Run} = require('./driver.cjs');
const {PlanAgent} = require('./plan-agent.cjs');

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--hinted') out.hinted = true;
    else if (token.startsWith('--')) out[token.slice(2)] = argv[++i];
  }
  return out;
}

async function main() {
  const options = args(process.argv.slice(2));
  if (!options.out || !(options.plan || options['agent-module'])) {
    console.error('usage: run.cjs (--plan PLAN.json | --agent-module MOD.cjs) --out RUN.json [--hinted] [--run-id ID] [--setting A|B] [--variant NAME]');
    process.exit(2);
  }
  const agent = options.plan
    ? new PlanAgent(path.resolve(options.plan))
    : require(path.resolve(options['agent-module'])).createAgent();
  const run = new Run({
    agent,
    hinted: !!options.hinted,
    runId: options['run-id'],
    setting: options.setting,
    variant: options.variant,
  });
  const result = await run.execute();
  fs.mkdirSync(path.dirname(path.resolve(options.out)), {recursive: true});
  fs.writeFileSync(options.out, JSON.stringify(result));
  const delivered = result.events.filter(event => event.status === 'delivered').map(event => event.id);
  console.log(JSON.stringify({
    run_id: result.run_id,
    label: result.label,
    setting: result.setting,
    variant: result.variant,
    hinted: result.hinted,
    out: options.out,
    tool_calls: result.tool_calls.length,
    tool_errors: result.tool_calls.filter(call => call.error || call.status === 'error').length,
    delivered_events: delivered,
  }));
}

main().catch(err => { console.error(err.stack || err); process.exit(1); });
