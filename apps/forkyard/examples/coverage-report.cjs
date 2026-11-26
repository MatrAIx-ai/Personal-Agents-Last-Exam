'use strict';
// Coverage over the shipped seeds and the December 2026 staged events.
// Usage: node examples/coverage-report.cjs [--json] [--load]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ZONE = 'America/Los_Angeles';
const START = '2025-01-01';
const END = '2026-12-31';
const fmt = new Intl.DateTimeFormat('en-CA', {timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit'});
const dayOf = iso => fmt.format(new Date(iso));
const months = [];
for (let year = 2024; year <= 2026; year += 1) {
  for (let month = 1; month <= 12; month += 1) months.push(year + '-' + String(month).padStart(2, '0'));
}
const windowMonths = months.filter(month => month >= '2025-01');
const seeds = {
  default: 'fixtures/minimal.json',
  a_rejected_pr: 'examples/task-data/rejected-pr/seed.json',
  b_locked_project: 'examples/task-data/locked-project/seed.json',
  c_owner_library: 'examples/task-data/owner-library/seed.json',
  release_attribution: 'examples/task-data/release-attribution/seed.json'
};
const PRIMARY = new Set(['commit', 'pull_opened', 'pull_merged', 'pull_closed', 'review', 'review_comment', 'release']);
const DECEMBER = 'examples/events/owner-library-2026-12/events.json';

function dateProblem(source, kind, id, at) {
  if (at === null || at === undefined || at === '') return {source, kind, id, reason: 'missing', value: null};
  if (Number.isNaN(Date.parse(at))) return {source, kind, id, reason: 'malformed', value: at};
  return null;
}

function rowsOf(data, source, problems) {
  const rows = [];
  const add = (kind, id, at, repo, required) => {
    const problem = dateProblem(source, kind, id, at);
    if (problem && (required || problem.reason === 'malformed')) problems.push(problem);
    if (!problem && at) rows.push({kind, id, at, repo});
  };
  for (const commit of data.commits || []) add('commit', commit.sha, commit.committed_at, commit.repo, true);
  for (const pull of data.pulls || []) {
    add('pull_opened', pull.repo + '#' + pull.number, pull.created_at, pull.repo, true);
    add('pull_merged', pull.repo + '#' + pull.number, pull.merged_at, pull.repo, false);
    if (!pull.merged_at) add('pull_closed', pull.repo + '#' + pull.number, pull.closed_at, pull.repo, false);
  }
  for (const review of data.reviews || []) add('review', review.review_id, review.submitted_at || review.created_at, review.repo, true);
  for (const comment of data.comments || []) add(comment.review_id ? 'review_comment' : 'comment', comment.comment_id, comment.created_at, comment.repo, false);
  for (const release of data.releases || []) {
    if (release.status === 'published') add('release', release.release_id, release.published_at, release.repo, true);
    else add('release_draft', release.release_id, release.created_at, release.repo, false);
  }
  for (const tag of data.tags || []) add('tag', tag.repo + '@' + tag.name, tag.created_at, tag.repo, false);
  for (const issue of data.issues || []) {
    add('issue_opened', issue.repo + '#' + issue.number, issue.created_at, issue.repo, false);
    add('issue_closed', issue.repo + '#' + issue.number, issue.closed_at, issue.repo, false);
  }
  for (const check of data.checks || []) add('check', check.sha + ':' + check.name, check.completed_at, check.repo, false);
  for (const entry of data.timeline || []) add('timeline', entry.entry_id, entry.at, entry.repo, false);
  return rows;
}

function eventRows(events) {
  const primaryOps = new Set(['commits.pushed_by_other', 'pull.review_submitted']);
  return events.map(event => ({
    kind: event.operation,
    id: event.event_id,
    at: event.at,
    repo: event.payload && event.payload.repo,
    primary: primaryOps.has(event.operation)
  }));
}

function summarize(rows, primaryOf) {
  const byKindAll = {};
  const byKindIn = {};
  const byMonth = {};
  const datesAll = new Set();
  const datesPrim = new Set();
  let pre = 0;
  let post = 0;
  const preByMonth = {};
  const allDates = rows.map(row => dayOf(row.at)).sort();
  for (const row of rows) {
    const date = dayOf(row.at);
    const primary = primaryOf(row);
    byKindAll[row.kind] = (byKindAll[row.kind] || 0) + 1;
    const month = date.slice(0, 7);
    if (!byMonth[month]) byMonth[month] = {primary: 0, other: 0, dates: new Set()};
    if (primary) byMonth[month].primary += 1;
    else byMonth[month].other += 1;
    byMonth[month].dates.add(date);
    if (date < START) {
      pre += 1;
      preByMonth[month] = (preByMonth[month] || 0) + 1;
      continue;
    }
    if (date > END) { post += 1; continue; }
    byKindIn[row.kind] = (byKindIn[row.kind] || 0) + 1;
    datesAll.add(date);
    if (primary) datesPrim.add(date);
  }
  const sorted = [...datesAll].sort();
  return {
    records_total: rows.length,
    earliest_any: allDates[0] || null,
    latest_any: allDates[allDates.length - 1] || null,
    excluded_before_2025: pre,
    excluded_before_2025_by_month: preByMonth,
    excluded_after_2026: post,
    by_kind_all: byKindAll,
    by_kind_in_window: byKindIn,
    distinct_dates_in_window: datesAll.size,
    distinct_dates_primary_in_window: datesPrim.size,
    earliest_in_window: sorted[0] || null,
    latest_in_window: sorted[sorted.length - 1] || null,
    window_months_with_activity: windowMonths.filter(month => byMonth[month] && [...byMonth[month].dates].some(date => date >= START && date <= END)).length,
    by_month: Object.fromEntries(months.filter(month => byMonth[month]).map(month => [month, {primary: byMonth[month].primary, other: byMonth[month].other, dates: byMonth[month].dates.size}])),
    datesAll,
    datesPrim
  };
}

function buildCoverage(dir) {
  const out = {zone: ZONE, window: [START, END], primary_fields: ['commits.committed_at', 'pulls.created_at', 'pulls.merged_at', 'pulls.closed_at', 'reviews.created_at', 'review comments created_at', 'releases.published_at'], seeds: {}, problems: []};
  const globalAll = new Set();
  const globalPrim = new Set();
  let excluded = 0;
  let libraryDates = new Set();
  for (const [label, rel] of Object.entries(seeds)) {
    const buf = fs.readFileSync(path.join(dir, rel));
    const data = JSON.parse(buf);
    const rows = rowsOf(data, rel, out.problems);
    const summary = summarize(rows, row => PRIMARY.has(row.kind));
    for (const date of summary.datesAll) globalAll.add(date);
    for (const date of summary.datesPrim) globalPrim.add(date);
    excluded += summary.excluded_before_2025;
    if (label === 'c_owner_library') libraryDates = summary.datesAll;
    const {datesAll, datesPrim, ...rest} = summary;
    out.seeds[label] = {
      file: rel,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      bytes: buf.length,
      repos: data.repositories.map(item => item.repo),
      ...rest
    };
    if (label === 'c_owner_library') {
      out.seeds[label].by_repo = {};
      for (const repo of out.seeds[label].repos) {
        const part = summarize(rows.filter(row => row.repo === repo), row => PRIMARY.has(row.kind));
        delete part.datesAll;
        delete part.datesPrim;
        out.seeds[label].by_repo[repo] = part;
      }
    }
  }
  const decemberBuf = fs.readFileSync(path.join(dir, DECEMBER));
  const december = JSON.parse(decemberBuf);
  for (const event of december) {
    const problem = dateProblem(DECEMBER, event.operation || 'event', event.event_id, event.at);
    if (problem) out.problems.push(problem);
  }
  const decemberSummary = summarize(eventRows(december.filter(event => !dateProblem(DECEMBER, event.operation || 'event', event.event_id, event.at))), row => row.primary);
  const {datesAll: decDates, datesPrim: decPrim, ...decRest} = decemberSummary;
  out.december_events = {
    file: DECEMBER,
    sha256: crypto.createHash('sha256').update(decemberBuf).digest('hex'),
    events: december.length,
    note: 'Staged scenario events. They are applied after env.advance_time and are not seed history.',
    ...decRest
  };
  const libraryWithDecember = new Set([...libraryDates, ...decDates]);
  out.owner_library_with_december = {
    distinct_dates_in_window: libraryWithDecember.size,
    note: 'Dates from the owner library seed plus the December staged events.'
  };
  const withAll = new Set([...globalAll, ...decDates]);
  const withPrim = new Set([...globalPrim, ...decPrim]);
  const sorted = [...globalAll].sort();
  const sortedWith = [...withAll].sort();
  out.global = {
    distinct_dates_in_window: globalAll.size,
    distinct_dates_primary_in_window: globalPrim.size,
    excluded_before_2025: excluded,
    earliest: sorted[0] || null,
    latest: sorted[sorted.length - 1] || null,
    window_months_with_activity: windowMonths.filter(month => sorted.some(date => date.startsWith(month))).length,
    empty_window_months: windowMonths.filter(month => !sorted.some(date => date.startsWith(month))),
    by_month_dates: Object.fromEntries(windowMonths.filter(month => sorted.some(date => date.startsWith(month))).map(month => [month, sorted.filter(date => date.startsWith(month)).length]))
  };
  out.global_with_december = {
    distinct_dates_in_window: withAll.size,
    distinct_dates_primary_in_window: withPrim.size,
    earliest: sortedWith[0] || null,
    latest: sortedWith[sortedWith.length - 1] || null,
    window_months_with_activity: windowMonths.filter(month => sortedWith.some(date => date.startsWith(month))).length,
    empty_window_months: windowMonths.filter(month => !sortedWith.some(date => date.startsWith(month))),
    by_month_dates: Object.fromEntries(windowMonths.filter(month => sortedWith.some(date => date.startsWith(month))).map(month => [month, sortedWith.filter(date => date.startsWith(month)).length]))
  };
  return out;
}

function printReport(out) {
  console.log('zone ' + out.zone + ', window ' + out.window[0] + '..' + out.window[1] + '; primary = commit, PR opened/merged/closed, review, review comment, published release');
  console.log('Account, repository and branch timestamps are not counted.');
  for (const [label, seed] of Object.entries(out.seeds)) {
    console.log('\n' + label + ': ' + seed.file + ' repos=' + seed.repos.join(',') + ' sha256=' + seed.sha256);
    console.log('records ' + seed.records_total + ' any-range ' + seed.earliest_any + '..' + seed.latest_any + '; excluded pre-2025 ' + seed.excluded_before_2025 + ', post-2026 ' + seed.excluded_after_2026);
    console.log('all kinds ' + JSON.stringify(seed.by_kind_all));
    console.log('in window ' + JSON.stringify(seed.by_kind_in_window));
    console.log('in-window distinct dates ' + seed.distinct_dates_in_window + ' (primary-only ' + seed.distinct_dates_primary_in_window + ') ' + seed.earliest_in_window + '..' + seed.latest_in_window + '; window months with activity ' + seed.window_months_with_activity + '/24');
    console.log('month   primary other dates');
    for (const [month, row] of Object.entries(seed.by_month)) console.log(month, String(row.primary).padStart(6), String(row.other).padStart(5), String(row.dates).padStart(5), month < '2025-01' ? '(excluded)' : '');
    if (seed.by_repo) {
      for (const [repo, part] of Object.entries(seed.by_repo)) {
        console.log('  ' + repo + ' records ' + part.records_total + ' dates ' + part.distinct_dates_in_window + ' (primary ' + part.distinct_dates_primary_in_window + ') excluded pre-2025 ' + part.excluded_before_2025 + ' ' + part.earliest_in_window + '..' + part.latest_in_window);
        console.log('  kinds ' + JSON.stringify(part.by_kind_all));
        for (const [month, row] of Object.entries(part.by_month)) console.log('  ' + month, String(row.primary).padStart(6), String(row.other).padStart(5), String(row.dates).padStart(5), month < '2025-01' ? '(excluded)' : '');
      }
    }
  }
  const december = out.december_events;
  console.log('\ndecember: ' + december.file + ' events ' + december.events + ' dates ' + december.distinct_dates_in_window + ' (primary ' + december.distinct_dates_primary_in_window + ') excluded pre-2025 ' + december.excluded_before_2025);
  console.log('kinds ' + JSON.stringify(december.by_kind_all));
  console.log('\nglobal', JSON.stringify(out.global));
  console.log('owner_library_with_december', JSON.stringify(out.owner_library_with_december));
  console.log('global_with_december', JSON.stringify(out.global_with_december));
  if (out.problems.length) console.error('malformed or missing required dates\n' + JSON.stringify(out.problems, null, 2));
}

async function loadOwnerLibrary(repoRoot, dir) {
  const {createRuntime} = require(path.join(repoRoot, 'runtime/core/runtime.cjs'));
  const model = createRuntime({registryFile: path.join(repoRoot, 'apps.registry.json')});
  let state = model.create('forkyard', 'cov-lib', 'scenario');
  let step = model.execute(state, 'infra', 'env.load_seed', {
    expected_version: model.version(state),
    request_id: 'load-lib',
    data: require(path.join(dir, 'examples/task-data/owner-library/seed.json')),
    binding: require(path.join(dir, 'examples/task-data/owner-library/binding.json')),
    policies: require(path.join(dir, 'examples/task-data/owner-library/policies.json')),
    virtual_now: '2026-11-18T09:00:00-08:00'
  });
  if (step.result.status !== 'ready') throw new Error('load failed: ' + JSON.stringify(step.result));
  state = step.state;
  const call = (name, args) => model.execute(state, 'agent', name, args).result;
  const out = {load: 'ready'};
  let ok = true;
  for (const repo of ['tomasreyes/notebook', 'tomasreyes/fieldbook']) {
    const commits = [];
    let cursor = null;
    let page;
    do {
      page = call('forkyard.commits.list', {repo, ref: 'main', limit: 100, ...(cursor ? {cursor} : {})});
      if (!page || page.status !== 'ok') { ok = false; break; }
      commits.push(...((page && (page.items || page.commits)) || []));
      cursor = page && page.next_cursor;
    } while (cursor);
    const pulls = call('forkyard.pulls.list', {repo});
    const releases = call('forkyard.releases.list', {repo});
    const pullRows = (pulls && (pulls.pulls || pulls.items)) || [];
    const releaseRows = (releases && (releases.releases || releases.items)) || [];
    const states = {};
    for (const pull of pullRows) states[pull.state] = (states[pull.state] || 0) + 1;
    if (!page || page.status !== 'ok') ok = false;
    if (!pulls || pulls.status !== 'ok') ok = false;
    if (!releases || releases.status !== 'ok') ok = false;
    out[repo] = {
      commits_status: page && page.status,
      commits_on_main: commits.length,
      pulls_status: pulls && pulls.status,
      pulls: pullRows.length,
      pull_states: states,
      releases_status: releases && releases.status,
      releases: releaseRows.length
    };
  }
  const events = require(path.join(dir, DECEMBER));
  const applied = [];
  let index = 0;
  for (const event of events) {
    const moved = model.execute(state, 'infra', 'env.advance_time', {expected_version: model.version(state), request_id: 'adv-' + index, virtual_now: event.at});
    if (moved.result.status !== 'committed') {
      ok = false;
      applied.push({event_id: event.event_id, operation: event.operation, status: moved.result.status, advance_status: moved.result.status, message: moved.result.message || null});
      index += 1;
      continue;
    }
    state = moved.state;
    const appliedEvent = model.execute(state, 'infra', 'env.apply_event', {expected_version: model.version(state), event});
    if (appliedEvent.result.status !== 'committed') ok = false;
    applied.push({event_id: event.event_id, operation: event.operation, status: appliedEvent.result.status, message: appliedEvent.result.message || null});
    if (appliedEvent.state) state = appliedEvent.state;
    index += 1;
  }
  out.december = applied;
  return {report: out, ok};
}

module.exports = {buildCoverage, loadOwnerLibrary};

if (require.main === module) {
  const dir = path.join(__dirname, '..');
  const report = buildCoverage(dir);
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
  const datesBroken = report.problems.length > 0;
  if (process.argv.includes('--load')) {
    const repoRoot = path.resolve(dir, '../..');
    loadOwnerLibrary(repoRoot, dir).then(result => {
      console.log('\n--load');
      console.log(JSON.stringify(result.report, null, 2));
      if (datesBroken || !result.ok) process.exit(1);
    }).catch(error => {
      console.error(error);
      process.exit(1);
    });
  } else if (datesBroken) process.exit(1);
}
