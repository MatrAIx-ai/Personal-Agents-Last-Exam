'use strict';
// Coverage of the delivered Keelcard fixtures and the December 2026 staged events.
// Run from the repo root: node apps/keelcard/examples/coverage-report.cjs
// Run from the package: node examples/coverage-report.cjs
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const pkg = path.join(__dirname, '..');
const ZONE = 'America/New_York';
const START = '2025-01-01';
const END = '2026-12-31';
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const weekday = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, weekday: 'long' });

function months() {
  const rows = [];
  for (let year = 2025; year <= 2026; year += 1) {
    for (let month = 1; month <= 12; month += 1) rows.push(year + '-' + String(month).padStart(2, '0'));
  }
  return rows;
}

function dayOf(iso) {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  return fmt.format(new Date(parsed));
}

function emptyMonth() {
  return { requests: 0, approved: 0, captured: 0, declined: 0, dates: new Set() };
}

function summarize(label, rel, rows, meta) {
  const calendar = months();
  const byMonth = Object.fromEntries(calendar.map(month => [month, emptyMonth()]));
  const dates = new Set();
  const excluded = [];
  const perCard = {};
  for (const row of rows) {
    const date = dayOf(row.at);
    if (!date) {
      excluded.push({ id: row.id, kind: row.kind, at: row.at, reason: 'invalid_date' });
      continue;
    }
    if (date < START || date > END) {
      excluded.push({ id: row.id, kind: row.kind, at: row.at, date, reason: 'out_of_window' });
      continue;
    }
    if (row.kind === 'settle') continue;
    const bucket = byMonth[date.slice(0, 7)];
    if (row.kind === 'authorization') {
      bucket.requests += 1;
      bucket.approved += 1;
    } else if (row.kind === 'decline') {
      bucket.requests += 1;
      bucket.declined += 1;
    } else if (row.kind === 'capture') {
      bucket.captured += 1;
    }
    bucket.dates.add(date);
    dates.add(date);
    if (row.card) {
      if (!perCard[row.card]) {
        perCard[row.card] = {
          requests: 0, approved: 0, captured: 0, declined: 0, dates: new Set(),
          byMonth: Object.fromEntries(calendar.map(month => [month, emptyMonth()]))
        };
      }
      const card = perCard[row.card];
      const cardBucket = card.byMonth[date.slice(0, 7)];
      if (row.kind === 'authorization') {
        card.requests += 1;
        card.approved += 1;
        cardBucket.requests += 1;
        cardBucket.approved += 1;
      } else if (row.kind === 'decline') {
        card.requests += 1;
        card.declined += 1;
        cardBucket.requests += 1;
        cardBucket.declined += 1;
      } else if (row.kind === 'capture') {
        card.captured += 1;
        cardBucket.captured += 1;
      }
      card.dates.add(date);
      cardBucket.dates.add(date);
    }
  }
  const sorted = [...dates].sort();
  const cards = {};
  for (const [cardId, card] of Object.entries(perCard)) {
    const cardDates = [...card.dates].sort();
    const days = cardDates.map(date => weekday.format(new Date(date + 'T12:00:00Z')));
    cards[cardId] = {
      requests: card.requests,
      approved: card.approved,
      captured: card.captured,
      declined: card.declined,
      distinct_dates: card.dates.size,
      earliest: cardDates[0] || null,
      latest: cardDates[cardDates.length - 1] || null,
      weekdays: [...new Set(days)],
      by_month: Object.fromEntries(calendar.map(month => [month, {
        requests: card.byMonth[month].requests,
        approved: card.byMonth[month].approved,
        captured: card.byMonth[month].captured,
        declined: card.byMonth[month].declined,
        dates: card.byMonth[month].dates.size
      }]))
    };
  }
  return {
    label,
    file: rel,
    sha256: meta.sha256,
    bytes: meta.bytes,
    account: meta.account || null,
    initial_clock: meta.initial_clock || null,
    counts: meta.counts,
    distinct_dates: dates.size,
    earliest: sorted[0] || null,
    latest: sorted[sorted.length - 1] || null,
    months_with_activity: calendar.filter(month => byMonth[month].dates.size).length,
    by_month: Object.fromEntries(calendar.map(month => [month, {
      requests: byMonth[month].requests,
      approved: byMonth[month].approved,
      captured: byMonth[month].captured,
      declined: byMonth[month].declined,
      dates: byMonth[month].dates.size
    }])),
    per_card: cards,
    statements: meta.statements,
    exclusions: excluded,
    sample: meta.sample
  };
}

function fixtureRows(data) {
  const rows = [];
  for (const auth of data.authorizations || []) {
    rows.push({ kind: 'authorization', id: auth.authorization_id, card: auth.card_id, at: auth.decided_at });
    if (auth.captured_at) rows.push({ kind: 'capture', id: auth.authorization_id, card: auth.card_id, at: auth.captured_at });
  }
  for (const decline of data.declines || []) {
    rows.push({ kind: 'decline', id: decline.authorization_id, card: decline.card_id, at: decline.decided_at });
  }
  for (const request of data.change_requests || []) {
    rows.push({ kind: 'change_request', id: request.change_request_id, card: request.card_id, at: request.created_at });
  }
  return rows;
}

function sampleAuthorization(data) {
  const auth = [...(data.authorizations || [])].sort((a, b) => Date.parse(a.decided_at) - Date.parse(b.decided_at))[0];
  if (!auth) return null;
  return {
    kind: 'authorization',
    id: auth.authorization_id,
    decided_at: auth.decided_at,
    merchant_name: auth.merchant_name,
    amount_cents: auth.amount_cents,
    decision: auth.decision
  };
}

function readFixture(rel) {
  const buf = fs.readFileSync(path.join(pkg, rel));
  const data = JSON.parse(buf);
  const statements = (data.statements || []).map(statement => ({
    statement_id: statement.statement_id,
    period_start: statement.period_start,
    period_end: statement.period_end,
    issued_at: statement.issued_at,
    effective_at: statement.effective_at,
    entries: statement.entry_ids.length
  }));
  const sample = sampleAuthorization(data);
  if (!sample && data.change_requests && data.change_requests[0]) {
    const request = data.change_requests[0];
    return {
      data,
      rows: fixtureRows(data),
      meta: {
        sha256: crypto.createHash('sha256').update(buf).digest('hex'),
        bytes: buf.length,
        account: data.account_id,
        initial_clock: data.initial_clock,
        counts: {
          requests: (data.authorizations || []).length + (data.declines || []).length,
          approved: (data.authorizations || []).length,
          captured: (data.authorizations || []).filter(auth => auth.captured_at).length,
          declined: (data.declines || []).length,
          statements: statements.length,
          change_requests: (data.change_requests || []).length
        },
        statements,
        sample: {
          kind: 'change_request',
          id: request.change_request_id,
          created_at: request.created_at,
          field: request.field,
          from_cents: request.from_cents,
          to_cents: request.to_cents,
          status: request.status
        }
      }
    };
  }
  return {
    data,
    rows: fixtureRows(data),
    meta: {
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      bytes: buf.length,
      account: data.account_id,
      initial_clock: data.initial_clock,
      counts: {
        requests: (data.authorizations || []).length + (data.declines || []).length,
        approved: (data.authorizations || []).length,
        captured: (data.authorizations || []).filter(auth => auth.captured_at).length,
        declined: (data.declines || []).length,
        statements: statements.length,
        change_requests: (data.change_requests || []).length
      },
      statements,
      sample
    }
  };
}

function decemberRows(events) {
  const rows = [];
  const cardByKey = {};
  for (const event of events) {
    if (event.operation === 'authorization.request') {
      const declined = event.payload.merchant.category === 'telecom';
      cardByKey[event.payload.authorization_key] = event.payload.card.card_id;
      rows.push({
        kind: declined ? 'decline' : 'authorization',
        id: event.event_id,
        card: event.payload.card.card_id,
        at: event.at,
        merchant_name: event.payload.merchant.name,
        amount_cents: event.payload.amount_cents
      });
    } else if (event.operation === 'authorization.capture') {
      rows.push({
        kind: 'capture',
        id: event.event_id,
        card: cardByKey[event.payload.authorization_key] || null,
        at: event.at
      });
    } else if (event.operation === 'ledger.settle_due') {
      rows.push({ kind: 'settle', id: event.event_id, at: event.at, card: null });
    }
  }
  return rows;
}

function collectDates(rows) {
  const dates = new Set();
  const excluded = [];
  for (const row of rows) {
    if (row.kind === 'settle') {
      const date = dayOf(row.at);
      if (!date) excluded.push({ id: row.id, kind: row.kind, at: row.at, reason: 'invalid_date' });
      else if (date < START || date > END) excluded.push({ id: row.id, kind: row.kind, at: row.at, date, reason: 'out_of_window' });
      continue;
    }
    const date = dayOf(row.at);
    if (!date) continue;
    if (date < START || date > END) continue;
    dates.add(date);
  }
  return dates;
}

function buildCoverage() {
  const calendar = months();
  const household = readFixture('fixtures/minimal.json');
  const freelancer = readFixture('fixtures/freelancer.json');
  const delegate = readFixture('fixtures/delegate.json');
  const eventPath = 'examples/events/freelancer-2026-12.json';
  const eventBuf = fs.readFileSync(path.join(pkg, eventPath));
  const events = JSON.parse(eventBuf);
  const stagedRows = decemberRows(events);
  const stagedSample = stagedRows.find(row => row.kind === 'authorization');
  const sources = {
    a: summarize('household', 'fixtures/minimal.json', household.rows, household.meta),
    b: summarize('freelancer', 'fixtures/freelancer.json', freelancer.rows, freelancer.meta),
    c: summarize('delegate', 'fixtures/delegate.json', delegate.rows, delegate.meta),
    december: summarize('december_staged', eventPath, stagedRows, {
      sha256: crypto.createHash('sha256').update(eventBuf).digest('hex'),
      bytes: eventBuf.length,
      account: 'kc-okonkwo',
      initial_clock: null,
      counts: {
        basis: 'scheduled',
        events: events.length,
        requests: stagedRows.filter(row => row.kind === 'authorization' || row.kind === 'decline').length,
        approved: stagedRows.filter(row => row.kind === 'authorization').length,
        captured: stagedRows.filter(row => row.kind === 'capture').length,
        declined: stagedRows.filter(row => row.kind === 'decline').length,
        settle: stagedRows.filter(row => row.kind === 'settle').length
      },
      statements: [],
      sample: stagedSample ? {
        kind: 'authorization.request',
        id: stagedSample.id,
        at: stagedSample.at,
        merchant_name: stagedSample.merchant_name,
        amount_cents: stagedSample.amount_cents
      } : null
    })
  };
  const seedDates = new Set([...collectDates(household.rows), ...collectDates(freelancer.rows), ...collectDates(delegate.rows)]);
  const withDecember = new Set([...seedDates, ...collectDates(stagedRows)]);
  const seedSorted = [...seedDates].sort();
  const bothSorted = [...withDecember].sort();
  const byMonth = month => bothSorted.filter(date => date.startsWith(month)).length;
  return {
    zone: ZONE,
    window: [START, END],
    date_fields: {
      authorization: 'authorizations[].decided_at',
      capture: 'authorizations[].captured_at',
      decline: 'declines[].decided_at',
      change_request: 'change_requests[].created_at'
    },
    sources,
    global: {
      seeds: {
        distinct_dates: seedSorted.length,
        earliest: seedSorted[0] || null,
        latest: seedSorted[seedSorted.length - 1] || null,
        months_with_activity: calendar.filter(month => seedSorted.some(date => date.startsWith(month))).length,
        empty_months: calendar.filter(month => !seedSorted.some(date => date.startsWith(month)))
      },
      seeds_plus_december: {
        distinct_dates: bothSorted.length,
        earliest: bothSorted[0] || null,
        latest: bothSorted[bothSorted.length - 1] || null,
        months_with_activity: calendar.filter(month => bothSorted.some(date => date.startsWith(month))).length,
        empty_months: calendar.filter(month => !bothSorted.some(date => date.startsWith(month))),
        dates_by_month: Object.fromEntries(calendar.map(month => [month, byMonth(month)]))
      }
    }
  };
}

function printSource(source) {
  console.log('');
  console.log(source.label + ' ' + source.file);
  console.log('sha256 ' + source.sha256 + ' bytes ' + source.bytes);
  if (source.account) console.log('account ' + source.account + (source.initial_clock ? ' clock ' + source.initial_clock : ''));
  console.log('counts ' + JSON.stringify(source.counts));
  console.log('distinct_dates ' + source.distinct_dates + ' ' + source.earliest + ' to ' + source.latest + ' months ' + source.months_with_activity);
  console.log('exclusions ' + (source.exclusions.length ? JSON.stringify(source.exclusions) : 'none'));
  const cards = {};
  for (const [cardId, card] of Object.entries(source.per_card)) {
    const { by_month, ...rest } = card;
    cards[cardId] = rest;
  }
  console.log('per_card ' + JSON.stringify(cards));
  if (source.per_card['card-4417']) {
    console.log('card-4417 month    req appr capt decl dates');
    for (const [month, row] of Object.entries(source.per_card['card-4417'].by_month)) {
      if (!row.dates && !row.requests && !row.captured) continue;
      console.log('card-4417', month, String(row.requests).padStart(4), String(row.approved).padStart(4), String(row.captured).padStart(4), String(row.declined).padStart(4), String(row.dates).padStart(5));
    }
  }
  console.log('sample ' + JSON.stringify(source.sample));
  console.log('month    req appr capt decl dates');
  for (const [month, row] of Object.entries(source.by_month)) {
    console.log(month, String(row.requests).padStart(4), String(row.approved).padStart(4), String(row.captured).padStart(4), String(row.declined).padStart(4), String(row.dates).padStart(5));
  }
  if (source.statements.length) {
    console.log('statements ' + source.statements.map(statement => statement.statement_id + ' issued ' + statement.issued_at).join('; '));
  }
}

function itemsOf(result, key) {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result[key])) return result[key];
  if (result && Array.isArray(result.items)) return result.items;
  return [];
}

function partitionBundle(sourceId, data) {
  const dataset = structuredClone(require(path.join(pkg, 'contribution/dataset.json')));
  const source = dataset.sources.find(item => item.source_id === sourceId);
  if (!source) throw new Error('dataset.json has no source ' + sourceId);
  const declared = source.generation && source.generation.parameters ? source.generation.parameters.cards : undefined;
  if (declared !== data.cards.length) throw new Error(sourceId + ' card count does not match dataset.json');
  dataset.sources = [source];
  dataset.record_source_ids = [sourceId];
  dataset.expected_counts = { records: data.cards.length, assets: 0 };
  const catalog = structuredClone(require(path.join(pkg, 'contribution/assets.catalog.json')));
  return { dataset, catalog, blobs: {} };
}

function provenanceOf(model, state) {
  const snap = model.execute(state, 'infra', 'env.snapshot', {}).result.snapshot;
  const dataset = snap.resources.bundle.dataset;
  const source = dataset.sources[0] || null;
  return {
    dataset_id: dataset.dataset_id,
    record_source_ids: dataset.record_source_ids,
    source_id: source && source.source_id,
    kind: source && source.kind,
    tool: source && source.generation && source.generation.tool,
    records: dataset.expected_counts.records
  };
}

function statementsClosedBy(statements, settleAt) {
  const last = statements[statements.length - 1];
  const match = last && /^stmt-(\d{4})-(\d{2})$/.exec(last.statement_id);
  if (!match || !settleAt) return [];
  const { parts } = require('../src/domain-utils.cjs');
  const end = parts(settleAt, ZONE);
  let year = Number(match[1]);
  let month = Number(match[2]);
  const ids = [];
  while (ids.length < 36) {
    month += 1;
    if (month === 13) { month = 1; year += 1; }
    if (year > end.year || (year === end.year && month >= end.month)) break;
    ids.push('stmt-' + year + '-' + String(month).padStart(2, '0'));
  }
  return ids;
}

function loadQueries(options = {}) {
  const runtimeFile = path.resolve(pkg, '../../runtime/core/runtime.cjs');
  if (!fs.existsSync(runtimeFile)) {
    return { skipped: true, ok: true, reason: 'Public runtime is not beside the package, so the load query was skipped.' };
  }
  const { createRuntime } = require(runtimeFile);
  const model = createRuntime({ registryFile: path.resolve(pkg, '../../apps.registry.json') });
  const policies = require(path.join(pkg, 'fixtures/policies.json'));
  const stages = {};
  const runId = options.runId || 'cov';
  function open(label, seedRel, bindingRel, sourceId) {
    const data = require(path.join(pkg, seedRel));
    let state = model.create('keelcard', runId + '-' + label, 'sandbox');
    const loaded = model.execute(state, 'infra', 'env.load_seed', {
      expected_version: model.version(state),
      request_id: runId + '-load-' + label,
      data,
      binding: require(path.join(pkg, bindingRel)),
      policies,
      bundle: partitionBundle(sourceId, data),
      virtual_now: data.initial_clock
    });
    if (loaded.result.status !== 'ready') throw new Error(label + ' load failed: ' + JSON.stringify(loaded.result).slice(0, 400));
    state = loaded.state;
    const call = name => model.execute(state, 'agent', name, {}).result;
    const transactions = itemsOf(call('keelcard.transactions.list'), 'transactions');
    const declines = itemsOf(call('keelcard.declines.list'), 'declines');
    const statements = itemsOf(call('keelcard.statements.list'), 'statements');
    const provenance = provenanceOf(model, state);
    return { state, transactions, declines, statements, provenance };
  }
  const household = open('a', 'fixtures/minimal.json', 'fixtures/binding.json', 'authored');
  stages.a = {
    transactions: household.transactions.length,
    declines: household.declines.length,
    statements: household.statements.length,
    first_transaction: household.transactions[0] ? {
      id: household.transactions[0].authorization_id,
      decided_at: household.transactions[0].decided_at,
      merchant_name: household.transactions[0].merchant_name,
      amount_cents: household.transactions[0].amount_cents
    } : null,
    last_statements: household.statements.slice(-3).map(statement => statement.statement_id),
    provenance: household.provenance
  };
  const freelancer = open('b', 'fixtures/freelancer.json', 'fixtures/freelancer-binding.json', 'freelancer');
  stages.b = {
    transactions: freelancer.transactions.length,
    declines: freelancer.declines.length,
    statements: freelancer.statements.length,
    first_transaction: freelancer.transactions[0] ? {
      id: freelancer.transactions[0].authorization_id,
      decided_at: freelancer.transactions[0].decided_at,
      merchant_name: freelancer.transactions[0].merchant_name,
      amount_cents: freelancer.transactions[0].amount_cents
    } : null,
    last_statements: freelancer.statements.slice(-3).map(statement => statement.statement_id),
    provenance: freelancer.provenance
  };
  let state = freelancer.state;
  const events = options.events || require(path.join(pkg, 'examples/events/freelancer-2026-12.json'));
  const receipts = [];
  let ok = true;
  const problems = [];
  events.forEach((event, index) => {
    const advanced = model.execute(state, 'infra', 'env.advance_time', {
      expected_version: model.version(state),
      request_id: runId + '-adv-' + index,
      virtual_now: event.at
    });
    const advance = advanced.result.status;
    if (advance !== 'committed') {
      ok = false;
      problems.push(event.event_id + ' advance ' + advance);
      receipts.push({ event_id: event.event_id, operation: event.operation, advance, apply: null, message: advanced.result.message || null });
      return;
    }
    state = advanced.state;
    const result = model.execute(state, 'infra', 'env.apply_event', {
      expected_version: model.version(state),
      event
    });
    const apply = result.result.status;
    if (apply === 'committed' && result.state) state = result.state;
    else {
      ok = false;
      problems.push(event.event_id + ' ' + (result.result.message || apply));
    }
    receipts.push({ event_id: event.event_id, operation: event.operation, advance, apply, message: result.result.message || null });
  });
  const wanted = {};
  const committed = {};
  for (const event of events) wanted[event.operation] = (wanted[event.operation] || 0) + 1;
  for (const receipt of receipts) {
    if (receipt.apply === 'committed') committed[receipt.operation] = (committed[receipt.operation] || 0) + 1;
  }
  for (const [operation, count] of Object.entries(wanted)) {
    if ((committed[operation] || 0) !== count) {
      ok = false;
      problems.push(operation + ' committed ' + (committed[operation] || 0) + ' of ' + count);
    }
  }
  const call = name => model.execute(state, 'agent', name, {}).result;
  const transactions = itemsOf(call('keelcard.transactions.list'), 'transactions');
  const declines = itemsOf(call('keelcard.declines.list'), 'declines');
  const statements = itemsOf(call('keelcard.statements.list'), 'statements');
  const settle = [...events].reverse().find(event => event.operation === 'ledger.settle_due' && receipts.some(receipt => receipt.event_id === event.event_id && receipt.apply === 'committed'));
  const expectedStatements = settle ? statementsClosedBy(freelancer.statements, settle.at) : [];
  const actualNew = statements.map(statement => statement.statement_id).filter(id => !freelancer.statements.some(statement => statement.statement_id === id));
  if (settle && JSON.stringify(actualNew) !== JSON.stringify(expectedStatements)) {
    ok = false;
    problems.push('statements ' + actualNew.join(',') + ' expected ' + expectedStatements.join(','));
  }
  if (!settle && actualNew.length) {
    ok = false;
    problems.push('statements changed without a committed settle');
  }
  const provenance = provenanceOf(model, state);
  if (household.provenance.source_id !== 'authored' || household.provenance.kind !== 'synthetic' || household.provenance.records !== 2) {
    ok = false;
    problems.push('household provenance ' + JSON.stringify(household.provenance));
  }
  if (freelancer.provenance.source_id !== 'freelancer' || freelancer.provenance.kind !== 'synthetic' || freelancer.provenance.records !== 6) {
    ok = false;
    problems.push('freelancer provenance ' + JSON.stringify(freelancer.provenance));
  }
  if (provenance.source_id !== 'freelancer' || provenance.kind !== 'synthetic' || provenance.dataset_id === 'keelcard-runtime-import') {
    ok = false;
    problems.push('provenance after events ' + JSON.stringify(provenance));
  }
  stages.b_after_december = {
    basis: 'committed',
    receipts,
    committed,
    problems,
    approved_delta: transactions.length - freelancer.transactions.length,
    decline_delta: declines.length - freelancer.declines.length,
    statement_delta: statements.length - freelancer.statements.length,
    transactions: transactions.length,
    declines: declines.length,
    statements: statements.length,
    last_statements: statements.slice(-3).map(statement => statement.statement_id),
    clock: state.virtual_now,
    provenance
  };
  return { skipped: false, ok, stages };
}

function emit(report, options = {}) {
  const exitCode = report.load && report.load.ok === false ? 1 : 0;
  if (options.json) return { stdout: JSON.stringify(report), stderr: '', exitCode };
  const stderr = report.load && report.load.skipped ? report.load.reason : '';
  return { stdout: '', stderr, exitCode };
}

function main() {
  const report = buildCoverage();
  const asJson = process.argv.includes('--json');
  const withLoad = process.argv.includes('--load');
  if (withLoad) report.load = loadQueries();
  const written = emit(report, { json: asJson });
  if (asJson) {
    console.log(written.stdout);
  } else {
    if (written.stderr) console.error(written.stderr);
    console.log('zone ' + ZONE + ', window ' + START + ' to ' + END);
    console.log('date fields ' + JSON.stringify(report.date_fields));
    for (const source of Object.values(report.sources)) printSource(source);
    console.log('');
    console.log('global seeds ' + JSON.stringify(report.global.seeds));
    console.log('global seeds plus december ' + JSON.stringify(report.global.seeds_plus_december));
    if (withLoad) console.log('load ' + JSON.stringify(report.load, null, 2));
  }
  if (written.exitCode) process.exitCode = written.exitCode;
}

module.exports = { buildCoverage, loadQueries, emit, pkg };
if (require.main === module) main();
