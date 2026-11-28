#!/usr/bin/env node
'use strict';

/**
 * Reproducible Environment dataset coverage calculator for QuestShelf
 * (per docs/submission-evidence.md §3 & "Reproducible count").
 *
 * Avoids double-counting: shelves[].updated_at is only counted when not already
 * represented by the final shelves[].play_history[].at entry, and polls[].closes_at
 * is excluded as a planned deadline rather than an observed occurrence.
 *
 * Usage:
 *   node scripts/coverage.cjs [--seed datasets/eval-2025-2026/seed.json] [--write]
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const APP_ROOT = path.resolve(__dirname, '..');
const TZ = 'America/Los_Angeles';
const WINDOW_START = '2025-01-01';
const WINDOW_END = '2026-12-31';
const FMT = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

function parseArgs(argv) {
  const out = { seed: 'datasets/eval-2025-2026/seed.json', write: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--seed' && argv[i + 1]) out.seed = argv[++i];
    else if (argv[i] === '--write') out.write = true;
  }
  return out;
}

function toDay(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return FMT.format(new Date(ms));
}

function computeCoverage(seedRelPath) {
  const seedAbs = path.resolve(APP_ROOT, seedRelPath);
  const raw = fs.readFileSync(seedAbs);
  const sha256 = crypto.createHash('sha256').update(raw).digest('hex');
  const data = JSON.parse(raw.toString('utf8'));

  const userSources = {
    'shelves.play_history.at': { field: 'shelves[].play_history[].at', category: 'user_activity', count: 0, dates: new Set() },
    'shelves.updated_at': { field: 'shelves[].updated_at (only when no play_history match)', category: 'user_activity', count: 0, dates: new Set() },
    'friends.owned_games.added_at': { field: 'friends[].owned_games[].added_at', category: 'user_activity', count: 0, dates: new Set() },
    'polls.created_at': { field: 'polls[].created_at', category: 'user_activity', count: 0, dates: new Set() },
    'polls.votes.voted_at': { field: 'polls[].votes[].voted_at', category: 'user_activity', count: 0, dates: new Set() },
    'polls.closed_at': { field: 'polls[].closed_at', category: 'user_activity', count: 0, dates: new Set() },
    'preferences.updated_at': { field: 'preferences.updated_at', category: 'user_activity', count: 0, dates: new Set() },
  };
  const catalogSources = {
    'games.updated_at': { field: 'games[].updated_at', category: 'catalog_metadata', count: 0, dates: new Set() },
  };
  const allSources = { ...userSources, ...catalogSources };

  const months = [];
  for (let y = 2025; y <= 2026; y++) {
    for (let m = 1; m <= 12; m++) months.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  const monthly = Object.fromEntries(months.map(m => [m, {
    month: m,
    user_activity_events: 0,
    user_activity_dates: new Set(),
    catalog_records: 0,
    all_events: 0,
    all_dates: new Set(),
    real_events: 0,
    synthetic_events: 0,
  }]));

  const globalUserDates = new Set();
  const globalAllDates = new Set();
  const uniqueUserTimestamps = new Set();
  const uniqueAllTimestamps = new Set();
  const excluded = [];
  let invalidDates = 0;
  let skippedDuplicateShelfUpdatedAt = 0;

  function record(sourceKey, iso, recordId) {
    if (iso === null || iso === undefined) return;
    const day = toDay(iso);
    if (!day) {
      invalidDates += 1;
      excluded.push({ source: sourceKey, record_id: recordId, value: iso, reason: 'invalid_date' });
      return;
    }
    if (day < WINDOW_START || day > WINDOW_END) {
      excluded.push({ source: sourceKey, record_id: recordId, value: iso, day, reason: 'out_of_window' });
      return;
    }
    const src = allSources[sourceKey];
    src.count += 1;
    src.dates.add(day);
    const m = monthly[day.slice(0, 7)];
    m.all_events += 1;
    m.synthetic_events += 1;
    m.all_dates.add(day);
    globalAllDates.add(day);
    uniqueAllTimestamps.add(iso);
    if (src.category === 'user_activity') {
      m.user_activity_events += 1;
      m.user_activity_dates.add(day);
      globalUserDates.add(day);
      uniqueUserTimestamps.add(iso);
    } else {
      m.catalog_records += 1;
    }
  }

  for (const g of data.games) record('games.updated_at', g.updated_at, g.id);
  for (const s of data.shelves) {
    if (Array.isArray(s.play_history) && s.play_history.length > 0) {
      s.play_history.forEach((h, i) => record('shelves.play_history.at', h.at, `${s.game_id}#${i}`));
      const lastAt = s.play_history[s.play_history.length - 1].at;
      if (s.updated_at !== lastAt) {
        record('shelves.updated_at', s.updated_at, s.game_id);
      } else {
        skippedDuplicateShelfUpdatedAt += 1;
      }
    } else {
      record('shelves.updated_at', s.updated_at, s.game_id);
    }
  }
  record('preferences.updated_at', data.preferences.updated_at, 'preferences');
  for (const f of data.friends) {
    for (const og of f.owned_games) {
      if (og.added_at) record('friends.owned_games.added_at', og.added_at, `${f.friend_id}:${og.game_id}`);
    }
  }
  for (const p of data.polls) {
    record('polls.created_at', p.created_at, p.poll_id);
    if (p.closed_at) record('polls.closed_at', p.closed_at, p.poll_id);
    for (const v of p.votes) record('polls.votes.voted_at', v.voted_at, `${p.poll_id}:${v.voter_id}`);
  }

  const userDatesSorted = [...globalUserDates].sort();
  const allDatesSorted = [...globalAllDates].sort();
  const monthlySummary = months.map(m => ({
    month: m,
    user_activity_events: monthly[m].user_activity_events,
    user_activity_distinct_dates: monthly[m].user_activity_dates.size,
    catalog_records: monthly[m].catalog_records,
    total_events: monthly[m].all_events,
    total_distinct_dates: monthly[m].all_dates.size,
    real_events: monthly[m].real_events,
    synthetic_events: monthly[m].synthetic_events,
  }));
  const userGaps = monthlySummary.filter(r => r.user_activity_events === 0).map(r => r.month);
  const allGaps = monthlySummary.filter(r => r.total_events === 0).map(r => r.month);

  return {
    app_id: 'questshelf',
    scope: 'environment_evaluation_dataset',
    source_file: seedRelPath,
    source_sha256: sha256,
    provenance: '100% synthetic (MIT); no scraped store data or real personal history; no real anchor required',
    counting_time_zone: TZ,
    coverage_window: { start: WINDOW_START, end: WINDOW_END },
    recommended_virtual_now: '2026-12-31T12:00:00-08:00',
    excluded_fields: [
      { field: 'polls[].closes_at', reason: 'Planned deadline, not an observed occurrence/activity timestamp.' },
      { field: 'shelves[].updated_at (when equal to last play_history[].at)', count_skipped: skippedDuplicateShelfUpdatedAt, reason: 'Already represented by the final play_history[].at entry; skipped to avoid double-counting.' },
    ],
    out_of_window_or_invalid_records: excluded.length,
    invalid_dates: invalidDates,
    user_activity_summary: {
      total_events: Object.values(userSources).reduce((a, s) => a + s.count, 0),
      unique_timestamps: uniqueUserTimestamps.size,
      global_deduplicated_distinct_dates: userDatesSorted.length,
      earliest_date: userDatesSorted[0] || null,
      latest_date: userDatesSorted[userDatesSorted.length - 1] || null,
      months_covered: 24 - userGaps.length,
      months_total: 24,
      gaps: userGaps,
    },
    all_sources_summary: {
      total_events: Object.values(allSources).reduce((a, s) => a + s.count, 0),
      unique_timestamps: uniqueAllTimestamps.size,
      global_deduplicated_distinct_dates: allDatesSorted.length,
      earliest_date: allDatesSorted[0] || null,
      latest_date: allDatesSorted[allDatesSorted.length - 1] || null,
      months_covered: 24 - allGaps.length,
      months_total: 24,
      gaps: allGaps,
    },
    per_source: Object.fromEntries(
      Object.entries(allSources).map(([k, s]) => [k, {
        date_field: s.field,
        category: s.category,
        event_count: s.count,
        distinct_dates: s.dates.size,
      }])
    ),
    monthly: monthlySummary,
    representative_records: {
      earliest_user_activity: data.shelves[0].play_history[0],
      sample_drop_with_reasons: data.shelves.find(s => s.game_id === 'game-ashen-depths').play_history.at(-1),
      sample_completion: data.shelves.find(s => s.game_id === 'game-clockwork-isle').play_history.at(-1),
      sample_friend_library_addition: data.friends[0].owned_games[0],
      sample_cancelled_poll: data.polls.find(p => p.winner_game_ids.length === 0 && p.status === 'closed'),
      sample_tie_poll: data.polls.find(p => p.winner_game_ids.length > 1),
      active_open_poll: {
        poll_id: data.polls.at(-1).poll_id,
        title: data.polls.at(-1).title,
        created_at: data.polls.at(-1).created_at,
        closes_at: data.polls.at(-1).closes_at,
        votes: data.polls.at(-1).votes.length,
      },
    },
  };
}

function renderMarkdown(report) {
  const skippedShelf = report.excluded_fields[1]?.count_skipped ?? 0;
  const lines = [
    '# QuestShelf Environment Dataset Coverage Report (2025–2026)',
    '',
    '> Reproducible output generated by `node scripts/coverage.cjs --write` from `apps/questshelf`.',
    '',
    '## Scope & Provenance',
    '',
    `- **Dataset file:** \`${report.source_file}\``,
    `- **SHA-256:** \`${report.source_sha256}\``,
    `- **Provenance:** ${report.provenance}`,
    `- **Declared time zone:** \`${report.counting_time_zone}\``,
    `- **Coverage window:** \`${report.coverage_window.start}\` through \`${report.coverage_window.end}\` (inclusive)`,
    `- **Minimum recommended clock (\`env.load_seed\`):** \`${report.recommended_virtual_now}\``,
    `- **Excluded fields (no double-counting):** \`polls[].closes_at\` (planned deadline) and ${skippedShelf} \`shelves[].updated_at\` mirrors already counted in \`shelves[].play_history[].at\`.`,
    `- **Out-of-window / invalid timestamps:** \`${report.out_of_window_or_invalid_records}\` (invalid: \`${report.invalid_dates}\`)`,
    '',
    '## Global Deduplicated Coverage',
    '',
    '| Scope | Timestamped events | Unique timestamps | Global deduplicated distinct dates | Earliest date | Latest date | Months covered | Gaps |',
    '| --- | ---: | ---: | ---: | --- | --- | --- | --- |',
    `| **User activity only** (play history, friend libraries, polls, preferences) | ${report.user_activity_summary.total_events} | ${report.user_activity_summary.unique_timestamps} | **${report.user_activity_summary.global_deduplicated_distinct_dates}** | ${report.user_activity_summary.earliest_date} | ${report.user_activity_summary.latest_date} | **${report.user_activity_summary.months_covered}/24** | ${report.user_activity_summary.gaps.length ? report.user_activity_summary.gaps.join(', ') : 'None'} |`,
    `| **All sources** (user activity + catalog \`games[].updated_at\`) | ${report.all_sources_summary.total_events} | ${report.all_sources_summary.unique_timestamps} | **${report.all_sources_summary.global_deduplicated_distinct_dates}** | ${report.all_sources_summary.earliest_date} | ${report.all_sources_summary.latest_date} | **${report.all_sources_summary.months_covered}/24** | ${report.all_sources_summary.gaps.length ? report.all_sources_summary.gaps.join(', ') : 'None'} |`,
    '',
    '## Per-Source Breakdown',
    '',
    '| Source | Authoritative date field | Category | Events | Distinct dates | Provenance |',
    '| --- | --- | --- | ---: | ---: | --- |',
  ];
  for (const [k, s] of Object.entries(report.per_source)) {
    lines.push(`| \`${k}\` | \`${s.date_field}\` | ${s.category} | ${s.event_count} | ${s.distinct_dates} | synthetic |`);
  }
  lines.push(
    '',
    '## Month-by-Month Coverage (2025-01 through 2026-12)',
    '',
    '| Month | User-activity events | User-activity distinct dates | Catalog records | Total events | Total distinct dates | Real | Synthetic |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  );
  for (const m of report.monthly) {
    lines.push(`| ${m.month} | ${m.user_activity_events} | ${m.user_activity_distinct_dates} | ${m.catalog_records} | ${m.total_events} | ${m.total_distinct_dates} | ${m.real_events} | ${m.synthetic_events} |`);
  }
  lines.push(
    '',
    '## Reproduction & Loading Commands',
    '',
    '```bash',
    '# Regenerate dataset deterministically and recompute coverage',
    'cd apps/questshelf',
    'node scripts/build-eval-dataset.cjs',
    'node scripts/coverage.cjs',
    '',
    '# Load via Infra env.load_seed and query through real Agent MCP (tested in tests/mcp.test.cjs)',
    'node --test tests/mcp.test.cjs',
    '```',
    '',
  );
  return lines.join('\n');
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const report = computeCoverage(args.seed);
  if (args.write) {
    const evDir = path.join(APP_ROOT, 'evidence');
    fs.mkdirSync(evDir, { recursive: true });
    fs.writeFileSync(path.join(evDir, 'coverage.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
    fs.writeFileSync(path.join(evDir, 'coverage.md'), renderMarkdown(report), 'utf8');
  }
  console.log(JSON.stringify({
    source_file: report.source_file,
    source_sha256: report.source_sha256,
    user_activity_summary: report.user_activity_summary,
    all_sources_summary: report.all_sources_summary,
    per_source: report.per_source,
  }, null, 2));
}

module.exports = { computeCoverage, renderMarkdown };
