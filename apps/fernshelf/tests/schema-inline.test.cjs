'use strict';
// The published seed schema (schemas/seed.schema.json) is the builder's seed schema with its named
// definitions inlined. These tests show the two mean the same thing: (1) resolving every reference of
// the definitions form gives the published schema exactly; (2) the repository's schema validator gives
// the same answer for both forms on the package fixtures and on a few thousand mutated copies of them
// (fields deleted, added, retyped and swapped at every depth). FERNSHELF_MUTATIONS sets the number of
// mutated copies per fixture (default 1200).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {compile} = require('./schema-validator.cjs');
const {seed} = require('../scripts/build-contracts.cjs');
const pkg = path.resolve(__dirname, '..');
const published = JSON.parse(fs.readFileSync(path.join(pkg, 'schemas/seed.schema.json'), 'utf8'));
const MUTATIONS = Number(process.env.FERNSHELF_MUTATIONS || 1200);

// Resolve "seed.schema.json#/<JSON pointer>" references by walking the pointer from the document root,
// independently of the builder's own inlining. A $ref object must carry nothing else and no definition
// may refer to itself through a chain, otherwise inlining would not be equivalent.
function resolveRefs(doc) {
  const pointer = key => {
    const [file, fragment] = key.split('#');
    assert.equal(file, 'seed.schema.json', 'only references into the seed schema itself: ' + key);
    assert.ok(fragment.startsWith('/'), key);
    let target = doc;
    for (const part of fragment.slice(1).split('/')) target = target[part.replace(/~1/g, '/').replace(/~0/g, '~')];
    assert.ok(target !== undefined, 'unknown reference ' + key);
    return target;
  };
  const walk = (s, chain) => {
    if (Array.isArray(s)) return s.map(x => walk(x, chain));
    if (!s || typeof s !== 'object') return s;
    if (Object.hasOwn(s, '$ref')) {
      assert.deepEqual(Object.keys(s), ['$ref'], 'a reference with sibling keywords: ' + s.$ref);
      assert.ok(!chain.includes(s.$ref), 'cyclic reference ' + s.$ref);
      return walk(pointer(s.$ref), [...chain, s.$ref]);
    }
    return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, walk(v, chain)]));
  };
  const {$defs, ...rest} = doc;
  return walk(rest, []);
}

test('the published seed schema is the definitions form with every reference resolved', () => {
  assert.ok(seed.$defs && JSON.stringify(seed).includes('"$ref"'), 'the builder keeps the definitions form');
  const text = JSON.stringify(published);
  assert.ok(!text.includes('"$ref"') && !text.includes('"$defs"'), 'the published schema has no $ref and no $defs');
  assert.deepStrictEqual(published, resolveRefs(seed));
});

// Deterministic mutations (xorshift32 with a fixed seed).
function rng(seedValue) {
  let x = seedValue >>> 0 || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}
const clone = v => JSON.parse(JSON.stringify(v));
function paths(v, at = [], out = []) {
  out.push(at);
  if (Array.isArray(v)) v.forEach((x, i) => paths(x, [...at, i], out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) paths(x, [...at, k], out);
  return out;
}
const REPLACEMENTS = [null, 0, -1, 1.5, 1e14, '', ' ', 'x', 'it m07', 'x'.repeat(2001), true, false, [], {}, [1], {a: 1},
  '2026-11-20T09:00:00Z', '2026-11-20T09:00:00', '2026-02-30T09:00:00Z', '2026-11-20', 'sha256:' + 'a'.repeat(64), 'sha256:xyz',
  'seed', 'agent', 'event', 'photo', 'video', 'active', 'trashed', 'purged', 'honor', 'joined', 'link', 'album', 'full', 80, 81];
function mutate(doc, random, all) {
  const d = clone(doc), list = paths(d).filter(p => p.length > 0);
  const p = list[Math.floor(random() * list.length)], key = p[p.length - 1];
  let parent = d; for (const k of p.slice(0, -1)) parent = parent[k];
  const op = Math.floor(random() * 6);
  if (op === 0) { if (Array.isArray(parent)) parent.splice(key, 1); else delete parent[key]; }
  else if (op === 1) {
    const target = parent[key];
    if (target && typeof target === 'object' && !Array.isArray(target)) target['extra_' + Math.floor(random() * 3)] = REPLACEMENTS[Math.floor(random() * REPLACEMENTS.length)];
    else if (Array.isArray(target) && target.length) target.push(clone(target[Math.floor(random() * target.length)]));
    else parent[key] = REPLACEMENTS[Math.floor(random() * REPLACEMENTS.length)];
  } else if (op === 2 || op === 3) parent[key] = clone(REPLACEMENTS[Math.floor(random() * REPLACEMENTS.length)]);
  else {
    // A value from elsewhere in the same fixture: type-correct in its own place, often not in this one.
    let from = doc; for (const k of all[Math.floor(random() * all.length)]) from = from[k];
    parent[key] = clone(from);
  }
  return d;
}

// A smaller copy of the reference fixture that keeps, for each list, the records of every distinct
// shape (which fields are null, empty or filled), so the mutations reach every record form it has.
function shapes(reference) {
  const sig = v => Array.isArray(v) ? '[' + (v.length ? sig(v[0]) : '') + ']' : v && typeof v === 'object' ? '{' + Object.keys(v).map(k => k + ':' + sig(v[k])).join(',') + '}' : v === null ? 'n' : typeof v;
  const out = clone(reference);
  for (const [k, v] of Object.entries(out)) if (Array.isArray(v)) {
    const seen = new Set(); out[k] = v.filter(r => { const s = sig(r); if (seen.has(s)) return false; seen.add(s); return true; });
  }
  return out;
}

test('Core\'s validator agrees on both forms for the fixtures and for mutated copies', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fernshelf-seed-'));
  try {
    fs.writeFileSync(path.join(dir, 'seed.schema.json'), JSON.stringify(seed));
    const byRefs = compile(seed, dir), inlined = compile(published, path.join(pkg, 'schemas'));
    const reference = JSON.parse(fs.readFileSync(path.join(pkg, 'fixtures/reference.json'), 'utf8'));
    const minimal = JSON.parse(fs.readFileSync(path.join(pkg, 'fixtures/minimal.json'), 'utf8'));
    for (const f of [reference, minimal]) { assert.equal(byRefs(f), true); assert.equal(inlined(f), true); }
    let checked = 0, refused = 0;
    for (const [n, base] of [[1, minimal], [2, shapes(reference)]]) {
      const random = rng(0x5eed0000 + n), all = paths(base).filter(p => p.length > 0);
      for (let i = 0; i < MUTATIONS; i++) {
        const d = mutate(base, random, all), a = byRefs(d), b = inlined(d);
        assert.equal(b, a, 'the two forms disagree on mutation ' + i + ' of fixture ' + n);
        checked++; if (!a) refused++;
      }
    }
    // Most mutations must be ones the schema refuses, or the comparison would show little.
    assert.ok(refused > checked / 2, refused + ' of ' + checked + ' refused');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
