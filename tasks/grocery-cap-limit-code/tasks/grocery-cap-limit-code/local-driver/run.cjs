'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { runScenario } = require('./driver.cjs');

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

async function main() {
  if (process.env.PALE_AGENT_CMD) {
    throw new Error('PALE_AGENT_CMD names the future model command. This stand-in validates replay plans and does not launch that command.');
  }
  const planPath = arg('--plan');
  if (!planPath) throw new Error('Usage: node run.cjs --plan file.json --out dir [--hinted] [--run-id id]');
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const outDir = path.resolve(arg('--out', path.join('demo/grocery-cap-limit-code/evidence/runs', plan.id)));
  const state = await runScenario({
    plan,
    hinted: process.argv.includes('--hinted'),
    runId: arg('--run-id', 'gcl-' + plan.id),
    outDir
  });
  process.stdout.write(JSON.stringify({ run_id: state.run_id, variant: state.variant, delivery: state.delivery, error: state.error, events: state.events_delivered }) + '\n');
}

main().catch(error => {
  process.stderr.write(error.stack + '\n');
  process.exit(1);
});
