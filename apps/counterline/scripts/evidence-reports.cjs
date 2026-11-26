'use strict';
// Runs the dependency demonstrations, the runtime and dataset checks, the fixture checks, the recognizer
// diagnostic and the public verifier (with the pinned Mail package), and writes each result with the
// versions it ran against to evidence/reports/. Run from a full checkout:
//   node apps/counterline/scripts/evidence-reports.cjs
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), {execFileSync} = require('node:child_process');
const {pkg, root} = require('../examples/lib/run.cjs');
const OUT = path.join(pkg, 'evidence/reports');
const git = args => { try { return execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim(); } catch { return null; } };
const env = () => ({node: process.version, platform: `${os.platform()} ${os.arch()}`, app_version: require('../app.json').version,
  core_api: require('../app.json').core_api_version, mail_version: require(path.join(root, 'examples/apps/mail/app.json')).version,
  commit: git(['rev-parse', '--short', 'HEAD']),
  // The App code these results came from is the commit above when nothing outside evidence/ is modified.
  code_matches_commit: git(['status', '--porcelain', '--', 'apps/counterline', ':!apps/counterline/evidence']) === ''});

async function main() {
  fs.mkdirSync(OUT, {recursive: true});
  const written = [];
  const save = (name, command, result) => {
    fs.writeFileSync(path.join(OUT, name + '.json'), JSON.stringify({command, ran_at: new Date().toISOString(), environment: env(), result}, null, 2) + '\n');
    written.push(name);
  };
  save('settlement-join', 'node apps/counterline/examples/join/run.cjs', await require('../examples/join/run.cjs').main());
  save('mail-integration', 'node apps/counterline/examples/mail-integration/run.cjs', await require('../examples/mail-integration/run.cjs').main());
  save('runtime-check', 'node apps/counterline/examples/runtime-check.cjs', await require('../examples/runtime-check.cjs').main());
  save('dataset-load', 'node apps/counterline/scripts/check-dataset.cjs', await require('./check-dataset.cjs').main());
  save('fixtures', 'node apps/counterline/scripts/check-fixtures.cjs', require('./check-fixtures.cjs').main());
  const diag = require('./text-diagnostic.cjs').run();
  save('recognizer-diagnostic', 'node apps/counterline/scripts/text-diagnostic.cjs', {summary: diag.summary, differences: diag.differences});
  const tmp = path.join(os.tmpdir(), `counterline-verify-${process.pid}.json`);
  try { execFileSync('npm', ['run', '-s', 'app:verify', '--', '--app', 'apps/counterline', '--with', 'examples/apps/mail', '--output', tmp], {cwd: root, stdio: 'ignore'}); } catch { /* the report records failures */ }
  const v = JSON.parse(fs.readFileSync(tmp, 'utf8')); fs.rmSync(tmp, {force: true});
  const statuses = []; (function walk(o) { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (typeof o.status === 'string' && ['passed', 'failed', 'skipped', 'not_run'].includes(o.status)) statuses.push(o); Object.values(o).forEach(walk); } })(v);
  const count = s => statuses.filter(x => x.status === s).length;
  save('public-verifier', 'npm run app:verify -- --app apps/counterline --with examples/apps/mail', {passed: count('passed'), failed: count('failed'), skipped: count('skipped'), not_run: count('not_run'), report: v});
  return written;
}
if (require.main === module) main().then(w => console.log('Wrote evidence/reports/: ' + w.map(n => n + '.json').join(', '))).catch(e => { console.error(e); process.exit(1); });
