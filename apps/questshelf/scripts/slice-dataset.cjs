#!/usr/bin/env node
'use strict';

/**
 * Temporal slice utility for QuestShelf's 2025-2026 evaluation dataset (MIT License).
 * Rewinds shelves, preferences, friend libraries, polls, and catalog timestamps to an
 * arbitrary ISO-8601 cutoff so Task scenarios can load a consistent pre-cutoff slice
 * at any virtual_now without leaking future history or blocking poll/shelf writes.
 *
 * Usage:
 *   node scripts/slice-dataset.cjs --cutoff 2026-11-20T09:00:00-08:00 [--seed datasets/eval-2025-2026/seed.json] [--output /tmp/slice.json]
 */
const fs = require('node:fs');
const path = require('node:path');

const APP_ROOT = path.resolve(__dirname, '..');
const plugin = require(path.join(APP_ROOT, 'plugin.cjs'));
const { compile } = require(path.join(APP_ROOT, 'tests', 'schema-validator.cjs'));

function parseArgs(argv) {
  const out = { seed: 'datasets/eval-2025-2026/seed.json', cutoff: null, output: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--seed' && argv[i + 1]) out.seed = argv[++i];
    else if (argv[i] === '--cutoff' && argv[i + 1]) out.cutoff = argv[++i];
    else if (argv[i] === '--output' && argv[i + 1]) out.output = argv[++i];
  }
  return out;
}

function sliceSeed(seed, cutoffIso) {
  const cutoffMs = Date.parse(cutoffIso);
  if (!Number.isFinite(cutoffMs)) {
    throw new Error('Invalid --cutoff ISO-8601 timestamp: ' + cutoffIso);
  }
  const out = structuredClone(seed);

  // 1. Keep all 20 catalog games (preserving binding/asset references), clamping future patch timestamps
  for (const g of out.games) {
    if (Date.parse(g.updated_at) > cutoffMs) {
      g.updated_at = cutoffIso;
    }
  }

  // 2. Rewind shelves to their latest play_history entry <= cutoff; drop games not yet acquired
  const nextShelves = [];
  for (const s of out.shelves) {
    if (Array.isArray(s.play_history) && s.play_history.length > 0) {
      const kept = s.play_history.filter(h => Date.parse(h.at) <= cutoffMs);
      if (kept.length === 0) continue;
      const last = kept[kept.length - 1];
      nextShelves.push({
        game_id: s.game_id,
        status: last.status,
        owned_platforms: structuredClone(s.owned_platforms),
        hours_logged: last.hours_logged,
        rating: last.rating,
        drop_reasons: structuredClone(last.drop_reasons),
        note: last.note,
        updated_at: last.at,
        play_history: kept,
      });
    } else if (Date.parse(s.updated_at) <= cutoffMs) {
      nextShelves.push(s);
    }
  }
  out.shelves = nextShelves;

  // 3. Rewind friend libraries to purchases made <= cutoff
  for (const f of out.friends) {
    f.owned_games = f.owned_games.filter(og => !og.added_at || Date.parse(og.added_at) <= cutoffMs);
  }

  // 4. Keep polls created <= cutoff; filter votes <= cutoff; rewind polls not yet closed at cutoff
  const nextPolls = [];
  for (const p of out.polls) {
    if (Date.parse(p.created_at) > cutoffMs) continue;
    const keptVotes = p.votes.filter(v => Date.parse(v.voted_at) <= cutoffMs);
    const closedBeforeCutoff = p.status === 'closed' && p.closed_at !== null && Date.parse(p.closed_at) <= cutoffMs;
    if (closedBeforeCutoff) {
      nextPolls.push({ ...p, votes: keptVotes });
    } else {
      nextPolls.push({
        ...p,
        status: 'open',
        votes: keptVotes,
        winner_game_ids: [],
        closed_at: null,
      });
    }
  }
  out.polls = nextPolls;

  // 5. Rewind preferences chronologically to match shelf history up to cutoff
  const droppedAtCutoff = new Set();
  let prefUpdatedAt = cutoffIso;
  let latestPrefMs = -Infinity;
  for (const s of out.shelves) {
    if (s.status === 'dropped') {
      for (const r of s.drop_reasons) droppedAtCutoff.add(r);
      const ms = Date.parse(s.updated_at);
      if (ms > latestPrefMs) { latestPrefMs = ms; prefUpdatedAt = s.updated_at; }
    }
  }
  const hasNeonShelved = out.shelves.some(
    s => s.game_id === 'game-neon-drift-99' && s.play_history && s.play_history.length >= 3
  );
  const hasFrostHold = out.shelves.some(
    s => s.game_id === 'game-frost-protocol' && s.play_history && s.play_history.length >= 3
  );
  const muted = [];
  if (hasNeonShelved) muted.push('arcade_racer');
  if (droppedAtCutoff.has('horror')) muted.push('horror');
  if (droppedAtCutoff.has('first_person_motion_sickness')) muted.push('first_person');

  out.preferences = {
    preferred_platforms: structuredClone(seed.preferences.preferred_platforms),
    muted_tags: muted,
    not_interested: hasNeonShelved ? ['game-neon-drift-99'] : [],
    avoid_reasons: [...droppedAtCutoff].filter(r => r === 'first_person_motion_sickness' || r === 'horror'),
    min_hud_font_pt: hasFrostHold ? 14 : null,
    updated_at: Date.parse(seed.preferences.updated_at) <= cutoffMs ? seed.preferences.updated_at : prefUpdatedAt,
  };

  return out;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.cutoff) {
    console.error('Usage: node scripts/slice-dataset.cjs --cutoff <ISO-8601> [--seed datasets/eval-2025-2026/seed.json] [--output <path>]');
    process.exit(1);
  }
  const seedAbs = path.resolve(APP_ROOT, args.seed);
  const seed = JSON.parse(fs.readFileSync(seedAbs, 'utf8'));
  const binding = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'fixtures', 'binding.json'), 'utf8'));
  const seedValidator = compile(
    JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'schemas', 'seed.schema.json'), 'utf8')),
    path.join(APP_ROOT, 'schemas')
  );

  const sliced = sliceSeed(seed, args.cutoff);
  if (!seedValidator(sliced)) {
    throw new Error('Sliced seed failed schemas/seed.schema.json validation');
  }
  plugin.validateSeed({ binding, virtual_now: args.cutoff }, sliced);

  const jsonText = JSON.stringify(sliced, null, 2) + '\n';
  if (args.output) {
    fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
    fs.writeFileSync(path.resolve(args.output), jsonText, 'utf8');
    console.log(JSON.stringify({
      cutoff: args.cutoff,
      output: args.output,
      shelves: sliced.shelves.length,
      play_history_entries: sliced.shelves.reduce((n, s) => n + (s.play_history ? s.play_history.length : 0), 0),
      polls: sliced.polls.length,
      open_polls: sliced.polls.filter(p => p.status === 'open').length,
      validate_seed: 'PASS',
    }, null, 2));
  } else {
    process.stdout.write(jsonText);
  }
}

module.exports = { sliceSeed };
