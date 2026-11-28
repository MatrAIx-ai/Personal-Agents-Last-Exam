'use strict';
// Helpers for tests/schema-equivalence.test.cjs: resolve the file references of the seed schema as
// written in scripts/build-contracts.cjs (with `$defs`), and make deterministic mutated copies of a
// seed (fields deleted, added and retyped at every depth) to run through both schema forms.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Replace every `seed.schema.json#/<pointer>` reference by the node the pointer names in `doc`,
// recursively, and drop `$defs`. Written independently of the builder's own inlining.
function resolveRefs(doc) {
  const pointer = ref => {
    const [file, fragment] = ref.split('#');
    if (file !== 'seed.schema.json' || !fragment || !fragment.startsWith('/')) throw new Error('Unexpected reference ' + ref);
    let node = doc;
    for (const part of fragment.slice(1).split('/')) {
      node = node[part.replace(/~1/g, '/').replace(/~0/g, '~')];
      if (node === undefined) throw new Error('Unresolved reference ' + ref);
    }
    return node;
  };
  const walk = (node, depth = 0) => {
    if (depth > 50) throw new Error('Reference cycle');
    if (Array.isArray(node)) return node.map(x => walk(x, depth + 1));
    if (!node || typeof node !== 'object') return node;
    if (typeof node.$ref === 'string') {
      if (Object.keys(node).length !== 1) throw new Error('A reference with sibling keywords');
      return walk(pointer(node.$ref), depth + 1);
    }
    const out = {};
    for (const [k, v] of Object.entries(node)) if (!(node === doc && k === '$defs')) out[k] = walk(v, depth + 1);
    return out;
  };
  return walk(doc);
}

// The schema as it was published with `$defs`, written to a temporary folder under the name its own
// references use, so Core's validator resolves them from the file system exactly as before.
function withDefsOnDisk(schema) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bellnote-seed-defs-'));
  fs.writeFileSync(path.join(dir, 'seed.schema.json'), JSON.stringify(schema, null, 2) + '\n');
  return {dir, cleanup: () => fs.rmSync(dir, {recursive: true, force: true})};
}

// Small deterministic generator (mulberry32).
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// Every location in the document: [parent, key, depth].
function locations(doc) {
  const out = [];
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object') return;
    for (const k of Array.isArray(node) ? node.keys() : Object.keys(node)) { out.push([node, k, depth]); walk(node[k], depth + 1); }
  };
  walk(doc, 1);
  return out;
}
const POOL = [null, 0, -1, 1, 1.5, 10000001, -10000001, '', 'x', 'X'.repeat(301), 'X'.repeat(5001), true, false, [], {}, [1], {a: 1},
  'bad id!', '2026-13-01', '2026-02-30', '2026-11-17', '24:00', '07:30', '2026-11-17T25:00:00Z', '2026-11-17T08:00:00', '2026-11-17T08:00:00-08:00',
  'absent', 'peanut', 'bus', 'card', 'present', 'closed', 'Z9-ok'];
const OPS = ['delete', 'add', 'retype', 'swap', 'duplicate', 'nudge'];
// `count` mutated copies of `seed`, each with one change at a random location (every depth is reached:
// locations are drawn per depth first, then uniformly within it).
function mutants(seed, count, seedNumber = 1) {
  const next = rng(seedNumber), pick = a => a[Math.floor(next() * a.length)], out = [];
  const byDepth = new Map();
  for (const loc of locations(seed)) { if (!byDepth.has(loc[2])) byDepth.set(loc[2], []); byDepth.get(loc[2]).push(loc); }
  const depths = [...byDepth.keys()];
  for (let i = 0; i < count; i++) {
    const copy = structuredClone(seed), [, key, depth] = pick(byDepth.get(pick(depths)));
    // Find the same location in the copy.
    const loc = locations(copy).filter(l => l[2] === depth && l[1] === key);
    const [parent, k] = pick(loc), op = OPS[i % OPS.length], value = parent[k];
    if (op === 'delete') { if (Array.isArray(parent)) parent.splice(k, 1); else delete parent[k]; }
    else if (op === 'add') { if (value && typeof value === 'object' && !Array.isArray(value)) value['extra_' + (i % 7)] = pick(POOL); else if (Array.isArray(value)) value.push(structuredClone(pick(POOL))); else parent[k] = pick(POOL); }
    else if (op === 'retype') parent[k] = structuredClone(pick(POOL));
    else if (op === 'swap') { const [p2, k2] = pick(locations(copy)); parent[k] = structuredClone(p2[k2]); }
    else if (op === 'duplicate') { if (Array.isArray(parent)) parent.push(structuredClone(value)); else if (Array.isArray(value) && value.length) value.push(structuredClone(value[0])); else parent[k] = structuredClone(value); }
    else if (typeof value === 'number') parent[k] = pick([value + 1, value - 1, -value, value + 0.5]);
    else if (typeof value === 'string') parent[k] = pick([value + ' ', value.slice(1), value.toUpperCase(), value + value]);
    else parent[k] = pick(POOL);
    out.push(copy);
  }
  return out;
}
module.exports = {resolveRefs, withDefsOnDisk, mutants};
