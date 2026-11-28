#!/usr/bin/env node
'use strict';
// CLI for the local stand-in runner.
//   node run.cjs --plan <plan.json> --out <run.json> [--hinted] [--run-id ID]
//   node run.cjs --agent-module <module.cjs> --out <run.json> [--hinted]
// An --agent-module must export {createAgent(): {name, describe?(), runSession(ctx)}} — the
// adapter seam where a GPT/Claude/Gemini model loop plugs in (none is shipped or run here).
const fs = require('node:fs'), path = require('node:path');
const {Run} = require('./driver.cjs');
const {PlanAgent} = require('./plan-agent.cjs');

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--hinted') o.hinted = true;
    else if (a.startsWith('--')) o[a.slice(2)] = argv[++i];
  }
  return o;
}
async function main() {
  const o = args(process.argv.slice(2));
  if (!o.out || !(o.plan || o['agent-module'])) {
    console.error('usage: run.cjs (--plan PLAN.json | --agent-module MOD.cjs) --out RUN.json [--hinted] [--run-id ID]');
    process.exit(2);
  }
  const agent = o.plan ? new PlanAgent(path.resolve(o.plan)) : require(path.resolve(o['agent-module'])).createAgent();
  const run = new Run({agent, hinted: !!o.hinted, runId: o['run-id']});
  const result = await run.execute();
  fs.mkdirSync(path.dirname(path.resolve(o.out)), {recursive: true});
  fs.writeFileSync(o.out, JSON.stringify(result, null, 1) + '\n');
  const d = result.events.filter(e => e.status === 'delivered').map(e => e.id);
  console.log(JSON.stringify({run_id: result.run_id, label: result.label, out: o.out, tool_calls: result.tool_calls.length,
    tool_errors: result.tool_calls.filter(c => c.error || c.status === 'error').length, delivered_events: d}));
}
main().catch(e => { console.error(e.stack || e); process.exit(1); });
