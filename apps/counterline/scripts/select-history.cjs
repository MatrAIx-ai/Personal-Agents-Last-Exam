'use strict';
// Rebuild a family's state at a given time by replaying its logged actions through Counterline's own code.
// Only records that existed then are present, each in the state it had then; a help article shows its revision
// current then, and one first published later is left out.
//
// Two boundary modes (docs/submission-evidence.md, section 4: history must precede the first session):
//   through (default): includes every action and revision dated at the time itself. Used to rebuild the
//                      delivered seed (--verify) and to inspect the state "as of" a moment.
//   before (--before): includes only what is dated strictly before the time. Use this for a task: pass the
//                      first session's start time, so nothing dated at that same instant is preloaded.
//                      Several actions can share one timestamp (59 timestamps in card-issuer carry more than
//                      one action, for example cs-0029 opened and closed at 2026-01-03T16:45:00-05:00).
//
// Usage: node scripts/select-history.cjs <family> <time> [out.json]              (through)
//        node scripts/select-history.cjs --before <family> <first-session time> [out.json]   (task mode)
//        node scripts/select-history.cjs --verify      (replay to the window's end equals seed.json)
const fs = require('node:fs');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const binding = require('../fixtures/binding.json');
const DIR = path.resolve(__dirname, '../datasets');

function select(family, asOf, { mode = 'through' } = {}) {
  const cut = Date.parse(asOf);
  if (!Number.isFinite(cut)) throw Error('as-of must be an RFC 3339 time');
  if (!['through', 'before'].includes(mode)) throw Error('mode must be through or before');
  const kept = at => mode === 'before' ? Date.parse(at) < cut : Date.parse(at) <= cut;
  let data = JSON.parse(fs.readFileSync(path.join(DIR, family, 'base.json'), 'utf8'));
  const {actions} = JSON.parse(fs.readFileSync(path.join(DIR, family, 'actions.json'), 'utf8'));
  for (const a of actions) {
    if (!kept(a.at)) break;
    const ctx = {app_id: 'counterline', role: a.type === 'event' ? 'infra' : 'agent', virtual_now: a.at, binding: structuredClone(binding)};
    data = a.type === 'tool' ? plugin.handleTool(ctx, data, a.name, structuredClone(a.args)).data : plugin.applyEvent(ctx, data, structuredClone(a.event));
  }
  data.help_articles = data.help_articles.map(a => {
    const revisions = a.revisions.filter(r => kept(r.at));
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
    const before = process.argv[2] === '--before';
    const [family, asOf, out] = process.argv.slice(before ? 3 : 2);
    const text = JSON.stringify(select(family, asOf, { mode: before ? 'before' : 'through' }), null, 1) + '\n';
    if (out) fs.writeFileSync(out, text); else process.stdout.write(text);
  }
}
module.exports = {select};
