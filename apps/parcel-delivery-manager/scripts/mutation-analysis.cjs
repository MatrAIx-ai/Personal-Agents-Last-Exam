#!/usr/bin/env node
'use strict';
// Mutation analysis of the business code. It changes src/ in one place at a time (an operator
// flipped, a statement removed) and runs the App-only tests against each change. A change the
// tests do not notice is printed: it is either behaviour no test pins down, or a check that
// another rule already guarantees. Work is done on temporary copies; the package is not touched.
// Usage: node scripts/mutation-analysis.cjs [workers]      (about four minutes with 6 workers)
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), {spawn} = require('node:child_process');
const pkg = path.resolve(__dirname, '..'), work = fs.mkdtempSync(path.join(os.tmpdir(), 'parcel-mutation-')), workers = process.argv[2] || '6';
const FILES = ['changes', 'common', 'credentials', 'events', 'grants', 'model', 'operations', 'time', 'views'].map(f => 'src/' + f + '.cjs');
const OPS = [
  ['=== → !==', /===/g, '!=='], ['!== → ===', /!==/g, '==='],
  ['<= → <', /<=/g, '<'], ['>= → >', />=/g, '>'],
  ['< → <=', /(?<![=<>!-])<(?![=<])/g, '<='], ['> → >=', /(?<![=<>!-])>(?![=>])/g, '>='],
  ['&& → ||', /&&/g, '||'], ['|| → &&', /\|\|/g, '&&'],
  ['true → false', /\btrue\b/g, 'false'], ['false → true', /\bfalse\b/g, 'true'],
  ['+ 1 → + 0', /\+ 1\b/g, '+ 0'], ['drop !', /!(?=[a-zA-Z_(])/g, ''], ['?? → &&', /\?\?/g, '&&']
];
// Blank out strings and comments so operators inside them are not mutated.
function mask(text) {
  return text.replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
}
const mutants = [];
for (const file of FILES) {
  const text = fs.readFileSync(path.join(pkg, file), 'utf8'), masked = mask(text), lineOf = i => text.slice(0, i).split('\n').length;
  for (const [name, pattern, replacement] of OPS) {
    for (const m of masked.matchAll(pattern)) mutants.push({file, op: name, line: lineOf(m.index), mutated: text.slice(0, m.index) + replacement + text.slice(m.index + m[0].length)});
  }
  // Delete one side-effect statement: a call or an assignment on its own line.
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (!/^\s+(?:[A-Za-z_$][\w$.]*\([^;]*\);|[A-Za-z_$][\w$.\[\]']* [+-]?= [^;]+;)\s*$/.test(mask(line)) || /^\s*(const|let|return|module\.exports)/.test(line)) return;
    mutants.push({file, op: 'delete statement', line: i + 1, mutated: [...lines.slice(0, i), line.replace(/\S.*/, ';'), ...lines.slice(i + 1)].join('\n')});
  });
}
for (const m of mutants) m.source = fs.readFileSync(path.join(pkg, m.file), 'utf8').split('\n')[m.line - 1].trim().slice(0, 200), m.result = m.mutated.split('\n')[m.line - 1].trim().slice(0, 200);
const n = Number(workers), results = [];
let next = 0, done = 0;
function runOne(dir, m) {
  return new Promise(resolve => {
    const target = path.join(dir, m.file), original = fs.readFileSync(path.join(pkg, m.file), 'utf8');
    fs.writeFileSync(target, m.mutated);
    const child = spawn(process.execPath, ['--test', 'tests/_nofuzz.test.cjs'], {cwd: dir, stdio: ['ignore', 'pipe', 'pipe']});
    let out = '';
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
    child.on('exit', code => {
      clearTimeout(timer); fs.writeFileSync(target, original);
      const status = code === 0 ? 'survived' : /SyntaxError/.test(out) ? 'invalid' : code === null ? 'timeout' : 'killed';
      resolve({file: m.file, line: m.line, op: m.op, source: m.source, result: m.result, status});
    });
  });
}
async function worker(i) {
  const dir = path.join(work, 'w' + i);
  fs.rmSync(dir, {recursive: true, force: true}); fs.cpSync(pkg, dir, {recursive: true});
  // The same suite as tests/business.test.cjs without the random walk, which would dominate the run time.
  fs.writeFileSync(path.join(dir, 'tests/_nofuzz.test.cjs'), fs.readFileSync(path.join(dir, 'tests/business.test.cjs'), 'utf8').replace("require('./fuzz.test.cjs');\n", ''));
  while (next < mutants.length) { const m = mutants[next++]; results.push(await runOne(dir, m)); if (++done % 100 === 0) console.error(done + '/' + mutants.length); }
}
(async () => {
  console.error('mutants: ' + mutants.length);
  await Promise.all(Array.from({length: n}, (_, i) => worker(i)));
  const count = s => results.filter(r => r.status === s).length;
  const valid = results.length - count('invalid');
  const summary = {mutants: results.length, invalid: count('invalid'), killed: count('killed') + count('timeout'), survived: count('survived'),
    score: ((count('killed') + count('timeout')) / valid * 100).toFixed(1) + '%'};
  for (const r of results.filter(x => x.status === 'survived').sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) console.log('SURVIVED ' + r.file + ':' + r.line + ' [' + r.op + ']  ' + r.source);
  console.log(JSON.stringify(summary));
  fs.rmSync(work, {recursive: true, force: true});
})();
