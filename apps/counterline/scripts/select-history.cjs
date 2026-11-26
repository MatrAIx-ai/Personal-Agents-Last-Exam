'use strict';
// Rebuild a family's state as of a given time by replaying its logged actions through Counterline's own
// code. Only records that existed then are present, each in the state it had then; a help article shows its
// revision current then, and one first published later is left out. A task uses this to load history before its first session without exposing later
// records (docs/submission-evidence.md, section 4).
//
// Usage: node scripts/select-history.cjs <family> <as-of RFC 3339 time> [out.json]
//        node scripts/select-history.cjs --verify      (replay to the window's end equals seed.json)
const fs = require('node:fs');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const binding = require('../fixtures/binding.json');
const DIR = path.resolve(__dirname, '../datasets');

function select(family, asOf) {
  const cut = Date.parse(asOf);
  if (!Number.isFinite(cut)) throw Error('as-of must be an RFC 3339 time');
  let data = JSON.parse(fs.readFileSync(path.join(DIR, family, 'base.json'), 'utf8'));
  const {actions} = JSON.parse(fs.readFileSync(path.join(DIR, family, 'actions.json'), 'utf8'));
  for (const a of actions) {
    if (Date.parse(a.at) > cut) break;
    const ctx = {app_id: 'counterline', role: a.type === 'event' ? 'infra' : 'agent', virtual_now: a.at, binding: structuredClone(binding)};
    data = a.type === 'tool' ? plugin.handleTool(ctx, data, a.name, structuredClone(a.args)).data : plugin.applyEvent(ctx, data, structuredClone(a.event));
  }
  data.help_articles = data.help_articles.map(a => {
    const revisions = a.revisions.filter(r => Date.parse(r.at) <= cut);
    if (!revisions.length) return null;
    const last = revisions[revisions.length - 1];
    return { ...a, revisions, updated_at: last.at, body: last.body };
  }).filter(Boolean);
  plugin.validateSeed({app_id: 'counterline', role: 'infra', virtual_now: asOf, binding}, data);
  return data;
}

if (require.main === module) {
  if (process.argv[2] === '--verify') {
    const {END} = require('./generate-dataset.cjs');
    for (const family of ['card-issuer', 'internet-provider']) {
      const replayed = JSON.stringify(select(family, END), null, 1) + '\n';
      const seed = fs.readFileSync(path.join(DIR, family, 'seed.json'), 'utf8');
      if (replayed !== seed) { console.error(`${family}: replay differs from seed.json`); process.exit(1); }
    }
    console.log('Replay to the window end equals seed.json for both families.');
  } else {
    const [family, asOf, out] = process.argv.slice(2);
    const text = JSON.stringify(select(family, asOf), null, 1) + '\n';
    if (out) fs.writeFileSync(out, text); else process.stdout.write(text);
  }
}
module.exports = {select};
