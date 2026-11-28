'use strict';
const fs = require('node:fs');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const { ms, toIso } = require('../src/time.cjs');
const { project } = require('../src/operations.cjs');
const { relation, fillAccess } = require('../src/authority.cjs');
const { money } = require('../src/util.cjs');
const lib = require('./lib.cjs');
const notes = require('./notes.cjs');
const { STAY, HARBOR } = require('./generate.cjs');
const { asOf, TERMINAL } = require('./as-of.cjs');
const { ZONE, FIRST, LAST, START, END, REFERENCE, FILES } = lib;

const OUT = { json: 'dataset/COVERAGE.json', md: 'dataset/COVERAGE.md' };
const METHOD = ['dataset/lib.cjs', 'dataset/notes.cjs', 'dataset/generate.cjs', 'dataset/as-of.cjs', 'dataset/coverage.cjs'];
const INSTANTS = ['2026-01-01', REFERENCE, '2026-12-15', END];
const timerInstant = files => {
  const steps = new Set(files.replay.steps.map(s => ms(s.at)));
  const returned = files.full.fills.find(f => f.state === 'returned_to_stock' && !steps.has(ms(f.closed_at)) && !steps.has(ms(f.closed_at) + 1));
  return toIso(ms(returned.closed_at) + 1);
};
const instantsOf = files => [timerInstant(files), ...INSTANTS.map(lib.instant)].sort((a, b) => ms(a) - ms(b));
const GAP_DAYS = 7;
const KINDS = [...lib.KINDS.map(k => ({ ...k, source: FILES.full })), { kind: 'replay_step', source: FILES.replay, list: 'steps', id: 'steps[].id', date_field: 'at' }];
const ROLES = {
  [FILES.base]: 'Seed at the window start ' + START + ': the household, prescribers, drugs with their 24 facts paraphrased from the cited DailyMed labels, plans, cash prices, stores (stock before the restocks) and cards; no records.',
  [FILES.replay]: 'Every committed step in time order: the household members\' tool calls and Infra events, each with its time.',
  [FILES.full]: 'Seed at ' + END + ', the state after every step with the timers due before that instant committed: all records of the window, with the same catalog and label facts.',
};
const plural = kind => kind + 's';
const PEOPLE = { 'p-1': 'Sam', 'p-2': 'Alex', 'p-3': 'Mia', 'p-4': 'Elena' };

function inventory(files) {
  const items = [...lib.dated(files.full).map(i => ({ ...i, source: FILES.full })), ...files.replay.steps.map(s => ({ kind: 'replay_step', id: s.id, at: s.at, source: FILES.replay, action: s.operation || s.tool }))];
  const invalid = items.filter(i => !lib.validInstant(i.at));
  const dated = items.filter(i => !invalid.includes(i)).map(i => ({ ...i, date: lib.dateOf(i.at) }));
  const outside = dated.filter(i => i.date < FIRST || i.date > LAST);
  return { invalid, outside, counted: dated.filter(i => i.date >= FIRST && i.date <= LAST) };
}

function span(list) {
  const dates = [...new Set(list.map(i => i.date))].sort();
  return { distinct_dates: dates.length, earliest: dates[0] || null, latest: dates[dates.length - 1] || null };
}

function gaps(dates) {
  const out = [];
  let run = null;
  for (let d = FIRST; d <= LAST; d = lib.addDays(d, 1)) {
    if (!dates.has(d)) { run = run || { from: d, to: d }; run.to = d; continue; }
    if (run) out.push(run);
    run = null;
  }
  if (run) out.push(run);
  return out.map(r => {
    let days = 0;
    for (let d = r.from; d <= r.to; d = lib.addDays(d, 1)) days++;
    const trip = notes.TRIPS.find(x => x.from <= r.to && x.to >= r.from);
    const reason = trip ? 'Overlaps the ' + trip.what + ' (' + trip.from + ' to ' + trip.to + ', ' + trip.people.map(p => PEOPLE[p]).join(', ') + '), when the travellers make no counter visits; otherwise no refill falls due.' : 'No refill falls due and no prescription, renewal or grant change happens in these days; the household\'s supplies last 30 or 90 days.';
    return { kind: 'days_without_records', from: r.from, to: r.to, days, reason };
  }).filter(g => g.days >= GAP_DAYS);
}

function labels(full) {
  const declared = lib.read('contribution/dataset.json');
  return declared.sources.filter(s => s.kind === 'reused').map(s => {
    const drug = full.drugs.find(d => d.facts.some(f => f.source.url === s.uri));
    const rxs = full.prescriptions.filter(r => r.drug_id === drug.drug_id), fills = full.fills.filter(f => rxs.some(r => r.rx_id === f.rx_id));
    const dates = fills.filter(f => lib.validInstant(f.requested_at)).map(f => lib.dateOf(f.requested_at)).sort();
    return {
      source_id: s.source_id, drug_id: drug.drug_id, generic_name: drug.generic_name, facts: drug.facts.length, url: s.uri, read_on: (s.description.match(/read on (\d{4}-\d{2}-\d{2})/) || [])[1] || null,
      prescriptions: rxs.length, fills: fills.length, first_fill: dates[0] || null, last_fill: dates[dates.length - 1] || null, used: rxs.length > 0,
    };
  });
}

function describe(seed, f, label) {
  const rx = seed.prescriptions.find(r => r.rx_id === f.rx_id), drug = seed.drugs.find(d => d.drug_id === rx.drug_id);
  const claims = seed.claims.filter(c => c.fill_id === f.fill_id).map(c => c.claim_id + ' ' + c.result + (c.reason ? ' ' + c.reason + (c.eligible_on ? ' (eligible ' + c.eligible_on + ')' : '') : ' ' + money(c.copay_cents)));
  const requests = seed.plan_requests.filter(r => r.fill_id === f.fill_id).map(r => r.plan_request_id + ' ' + r.reason + ' ' + r.state + (r.note ? ': ' + r.note : ''));
  const charge = f.charge_id && seed.charges.find(c => c.charge_id === f.charge_id);
  const auth = f.authorization_id && seed.authorizations.find(a => a.authorization_id === f.authorization_id);
  return {
    example: label, fill_id: f.fill_id, patient: rx.patient_id + ' ' + seed.people.find(p => p.person_id === rx.patient_id).name, drug: drug.generic_name + ' ' + drug.strength, quantity: f.quantity, store_id: f.store_id,
    requested_at: f.requested_at, state: f.state + (f.cancellation ? ' (' + f.cancellation.reason + ', from ' + f.cancellation.stage + ')' : ''), timeline: f.timeline.map(e => e.at + ' ' + e.state),
    claims, plan_requests: requests, cash: f.cash ? money(f.cash.price_cents) : null, amount_due: f.amount_due_cents === null ? null : money(f.amount_due_cents),
    payment: charge ? charge.method + ' ' + money(charge.amount_cents) + (f.cash ? ' (cash price)' : '') + ' by ' + charge.payer_id + ' on ' + charge.card_id : auth ? 'prepayment ' + auth.state + ' ' + money(auth.amount_cents) : null,
    refusals: f.refusals.map(r => r.at + ' ' + r.reason + ' (' + r.collector_id + ')'), notes: f.notes.map(n => n.at + ' ' + n.text),
    notices: seed.notices.filter(n => n.subject.type === 'fill' && n.subject.id === f.fill_id).map(n => n.notice_id + ' ' + n.kind + ' to ' + n.recipient_id + ' (' + n.audience + ')'),
  };
}

function supplyOnHand(seed, steps) {
  const hand = lib.onHand(seed, steps).map(x => x.days).filter(x => x !== null).sort((a, b) => a - b);
  return { requests: hand.length, min: hand[0], median: hand[Math.floor(hand.length / 2)], max: hand.at(-1), too_soon: seed.claims.filter(c => c.reason === 'refill_too_soon').length, claims: seed.claims.length };
}

function replaced(seed) {
  const day = 86400000;
  return seed.prescriptions.filter(r => r.fills_remaining === 0 && r.state === 'active' && !['d-albuterol-90', 'd-amoxicillin-250-5'].includes(r.drug_id) && !seed.renewals.some(n => n.rx_id === r.rx_id)).map(r => {
    const last = seed.fills.filter(f => f.rx_id === r.rx_id && f.state === 'collected').sort((a, b) => ms(b.closed_at) - ms(a.closed_at))[0];
    const next = seed.prescriptions.filter(x => x.patient_id === r.patient_id && x.drug_id === r.drug_id && ms(x.received_at) > ms(r.received_at)).sort((a, b) => ms(a.received_at) - ms(b.received_at))[0];
    return { rx_id: r.rx_id, patient_id: r.patient_id, drug_id: r.drug_id, last_refill_collected: last ? last.closed_at : null, replaced_by: next ? next.rx_id : null, replacement_received: next ? next.received_at : null, days_between: last && next ? Math.round((ms(next.received_at) - ms(last.closed_at)) / day) + 0 : null };
  });
}

function representative(seed, steps) {
  const cards = new Map(steps.filter(s => s.operation === 'fill.collection_attempted').map(s => [s.payload.fill_id + ' ' + s.at, s.payload.card_id]));
  const refill = f => { const rx = seed.prescriptions.find(r => r.rx_id === f.rx_id); return seed.fills.some(g => g !== f && g.state === 'collected' && ms(g.closed_at) < ms(f.requested_at) && seed.prescriptions.find(r => r.rx_id === g.rx_id).patient_id === rx.patient_id && seed.prescriptions.find(r => r.rx_id === g.rx_id).drug_id === rx.drug_id); };
  const moved = new Set(steps.filter(s => s.tool === lib.P + 'fills.change_store').map(s => s.args.fill_id));
  const used = new Set();
  const claimOf = f => seed.claims.filter(c => c.fill_id === f.fill_id);
  const requests = f => seed.plan_requests.filter(r => r.fill_id === f.fill_id);
  const find = (label, test) => { const f = seed.fills.find(x => !used.has(x.fill_id) && test(x)); if (!f) return null; used.add(f.fill_id); return describe(seed, f, label); };
  const charge = f => f.charge_id && seed.charges.find(c => c.charge_id === f.charge_id);
  const plain = f => f.state === 'collected' && claimOf(f).length === 1 && !f.refusals.length && !f.notes.length;
  return [
    find('first fill of the window', () => true),
    find('last fill of the window', f => f === seed.fills[seed.fills.length - 1]),
    find('first fill after the reference clock', f => ms(f.requested_at) >= ms(REFERENCE)),
    find('routine refill paid at the counter', f => plain(f) && refill(f) && charge(f) && charge(f).method === 'counter'),
    find('collected with nothing due', f => plain(f) && f.amount_due_cents === 0),
    find('prepaid online, captured at pickup', f => f.state === 'collected' && charge(f) && charge(f).method === 'capture'),
    find('drug the plan does not cover, paid at the cash price', f => f.cash && claimOf(f).some(c => c.reason === 'not_covered')),
    find('prior authorization denied, then approved', f => requests(f).some(r => r.state === 'denied' && r.reason === 'prior_auth_required') && f.state === 'collected'),
    find('prior authorization withdrawn and sent again', f => requests(f).some(r => r.state === 'withdrawn') && f.state === 'collected'),
    find('early refill before a trip', f => requests(f).some(r => notes.TRAVEL.includes(r.note) && r.state === 'approved')),
    find('early refill denied, waited for the eligible date', f => requests(f).some(r => r.reason === 'refill_too_soon' && r.state === 'denied') && !f.cash),
    find('lost supply', f => requests(f).some(r => r.note === notes.LOST)),
    find('quantity above the plan limit, changed', f => claimOf(f).some(c => c.reason === 'quantity_limit')),
    find('waited for stock, moved to another store', f => f.timeline.some(e => e.state === 'waiting_stock') && moved.has(f.fill_id)),
    find('waited for stock until a restock', f => f.timeline.some(e => e.state === 'waiting_stock') && !moved.has(f.fill_id) && f.state === 'collected'),
    find('held during review', f => f.notes.some(n => notes.REVIEW_HOLDS.some(h => h[0] === n.text))),
    find('held while ready, refused at the counter while held', f => f.refusals.some(r => r.reason === 'on_hold')),
    find('declined card at the counter', f => f.refusals.some(r => r.reason === 'payment_failed' && cards.get(f.fill_id + ' ' + r.at) === 'card-2')),
    find('expired card at the counter', f => f.refusals.some(r => r.reason === 'payment_failed' && cards.get(f.fill_id + ' ' + r.at) === 'card-4')),
    find('arrived after closing', f => f.refusals.some(r => r.reason === 'store_closed')),
    find('arrived before the fill was ready', f => f.refusals.some(r => r.reason === 'not_ready')),
    find('collector not authorized after a revocation', f => f.refusals.some(r => r.reason === 'collector_not_authorized')),
    find('returned to stock after the pickup warning', f => f.state === 'returned_to_stock'),
    find('prepaid, then cancelled when ready', f => f.cancellation && seed.authorizations.some(a => a.fill_id === f.fill_id && a.state === 'voided')),
    ((f) => f && describe(seed, f, 'cancelled when its prescription expired ' + (f.notes.length % 2 === 1 ? 'while on the pharmacist\'s hold "' + f.notes.at(-1).text + '"' : 'while ' + f.cancellation.stage.replace(/_/g, ' ') + (claimOf(f).at(-1) && claimOf(f).at(-1).reason ? ' (' + claimOf(f).at(-1).reason.replace(/_/g, ' ') + ')' : ''))))(seed.fills.find(f => !used.has(f.fill_id) && f.cancellation && f.cancellation.reason === 'rx_expired')),
  ].filter(Boolean);
}

function compute(files = lib.load()) {
  const { invalid, outside, counted } = inventory(files);
  const records = counted.filter(i => i.source === FILES.full);
  const after = i => ms(i.at) >= ms(REFERENCE);
  const all = new Set(counted.map(i => i.date));
  const monthly = lib.months().map(month => {
    const inMonth = counted.filter(i => i.date.startsWith(month)), mine = inMonth.filter(i => i.source === FILES.full);
    const row = { month };
    for (const k of KINDS) row[plural(k.kind)] = inMonth.filter(i => i.kind === k.kind).length;
    return { ...row, records: mine.length, distinct_dates: new Set(mine.map(i => i.date)).size, distinct_dates_with_replay_log: new Set(inMonth.map(i => i.date)).size, records_after_reference_clock: mine.filter(after).length, real: 0, synthetic: mine.length };
  });
  const perDate = Object.fromEntries([...all].sort().map(d => [d, { records: 0, fills: 0, replay_steps: 0 }]));
  for (const i of counted) { if (i.source === FILES.full) perDate[i.date].records++; if (i.kind === 'fill') perDate[i.date].fills++; if (i.kind === 'replay_step') perDate[i.date].replay_steps++; }
  const bytes = lib.bytesOf(files);
  const sources = [FILES.base, FILES.replay, FILES.full].map(file => ({ file, role: ROLES[file], kind: file === FILES.replay ? 'synthetic' : 'mixed', bytes: Buffer.byteLength(bytes[file]), sha256: lib.digestOf(bytes[file]) }));
  const kinds = KINDS.map(k => { const list = counted.filter(i => i.kind === k.kind); return { ...k, records: list.length, ...span(list) }; });
  const full = files.full, used = labels(full);
  const catalogCount = full.people.length + full.prescribers.length + full.drugs.length + full.plans.length + full.stores.length + full.cards.length;
  return {
    schema: 'mendwell-pharmacy.coverage.v1',
    scope: 'Environment dataset coverage of the Mendwell delivery dataset ' + files.replay.dataset_id + ', whole window. Not a Task history report: a Task reports its own selection after its first-session cutoff (dataset/as-of.cjs).',
    dataset_id: files.replay.dataset_id,
    time_zone: ZONE,
    window: { from: FIRST, to: LAST },
    reference_clock: REFERENCE,
    reproduce: ['node dataset/generate.cjs --check', 'node dataset/coverage.cjs --check'],
    counting: 'Every timestamp is ISO 8601 with its offset; each is converted to its calendar date in ' + ZONE + ' before counting. Date-only fields (a prescription\'s written_on, a claim\'s eligible_on) are not occurrence dates and are not counted. A date counts once however many records or sources fall on it. A required occurrence date (received_at, requested_at, created_at or at) that is missing or not a valid ISO 8601 instant with the offset in force, and a record outside the window, is excluded from the count and listed by ID; closed_at and revoked_at are required only of closed fills and revoked grants. ' + (invalid.length || outside.length ? invalid.length + ' invalid or missing and ' + outside.length + ' outside the window, listed in invalid and outside.' : 'There are none.'),
    sources,
    method: METHOD.map(file => ({ file, sha256: lib.sha256(file) })),
    record_kinds: kinds,
    exclusions: [
      { records: 'people[], prescribers[], drugs[], plans[], stores[] and cards[] in ' + FILES.full, count: catalogCount, reason: 'Household and catalog rows with no occurrence date; their dated changes are replay steps (store.restocked) and records (grants). Store stock is the only catalog field that changes in the window.' },
      { records: 'cash_prices in ' + FILES.full, count: Object.keys(full.cash_prices).length, reason: 'Price table per drug, no occurrence date.' },
      { records: FILES.base, count: 0, reason: 'Holds only the household and catalog at the window start; no dated records.' },
      { records: 'approvals', count: 0, reason: 'A confirmation (user.confirmed) is applied with the prepayment or grant change it confirms and is not kept, because seeds carry no approvals; the confirmed step itself is in ' + FILES.replay + '.' },
    ],
    invalid_dates: invalid.length,
    invalid: invalid.map(i => ({ kind: i.kind, id: i.id, at: i.at })),
    outside_window: outside.length,
    outside: outside.map(i => ({ kind: i.kind, id: i.id, at: i.at })),
    totals: { records: records.length + invalid.filter(i => i.source === FILES.full).length + outside.filter(i => i.source === FILES.full).length, counted: records.length, replay_steps: counted.filter(i => i.kind === 'replay_step').length, app_records: plugin.records(full).length, fills: full.fills.length, notices: full.notices.length },
    distinct_dates: {
      coverage: span(records).distinct_dates,
      coverage_basis: 'Counted over the records loaded into the App (' + FILES.full + '), which Agents and Infra read back.',
      coverage_note: 'The global count over both sources adds ' + (all.size - span(records).distinct_dates) + ' days on which the replay log holds steps but no App record is dated.',
      by_source: { [FILES.full]: span(records).distinct_dates, [FILES.replay]: span(counted.filter(i => i.source === FILES.replay)).distinct_dates },
      by_kind: Object.fromEntries(kinds.map(k => [k.kind, k.distinct_dates])),
      global: all.size,
    },
    earliest: span(counted).earliest,
    latest: span(counted).latest,
    provenance: {
      real: 0, synthetic: records.length, mixed: 0,
      note: 'Every dated record and step is synthetic, written by the App while dataset/generate.cjs replayed it; none was collected or observed, including those dated at or after the reference clock.',
      label_facts: {
        kind: 'reused',
        facts: used.reduce((s, l) => s + l.facts, 0),
        counted_as_real: used.filter(l => l.used).reduce((s, l) => s + l.facts, 0),
        rule: 'The drug facts are short paraphrases of public DailyMed labels, read on 2026-11-23 and cited by section in contribution/dataset.json. They sit in the drug catalog, carry no occurrence date and are not counted as dated records. A label\'s facts count as real data in use only when the dataset holds a prescription of that drug, because rx.get returns them with that prescription (shown by the loading demonstration); the table lists the prescriptions and fills per label.',
        labels: used,
      },
    },
    partitions: [
      { partition: 'synthetic, dated before the reference clock', from: START, to: REFERENCE, records: records.filter(i => !after(i)).length, replay_steps: counted.filter(i => i.kind === 'replay_step' && !after(i)).length },
      { partition: 'synthetic, dated at or after the reference clock: generated, never observed', from: REFERENCE, to: END, records: records.filter(after).length, replay_steps: counted.filter(i => i.kind === 'replay_step' && after(i)).length },
    ],
    monthly,
    months_without_fills: monthly.filter(m => m.fills === 0).map(m => m.month),
    household: {
      trips: notes.TRIPS,
      elena_at_maple_avenue: { from: STAY[0], to: STAY[1] },
      household_at_harbor_street: { from: HARBOR[0], to: HARBOR[1] },
      replaced_without_renewal: replaced(full),
      supply_on_hand: supplyOnHand(full, files.replay.steps),
      supply_method: lib.LOSS_METHOD,
      supply_gaps: lib.supplyGaps(full),
      renewal_requests: Object.fromEntries(['approved', 'denied', 'withdrawn', 'pending'].map(state => [state, full.renewals.filter(r => r.state === state).length])),
      prior_authorizations: { requests: full.plan_requests.filter(r => r.reason === 'prior_auth_required').length, fills: new Set(full.plan_requests.filter(r => r.reason === 'prior_auth_required').map(r => r.fill_id)).size },
    },
    gaps: [
      { kind: 'real_data_anchor', period: '2026-11', status: 'stated gap, pending maintainer agreement', reason: 'There is no real pharmacy record to collect: prescriptions, fills, claims and payments are a real patient\'s protected health information, the reference product shows them only inside a signed-in account, and the approved proposal (PR #63, https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/c7ddf519b029cebe1c93c5bed50edb889cf34deb/proposals/environment/mendwell-pharmacy.md at the approved revision) excludes real patient data (line 12) and data collection (line 102: "N/A: no crawling or copied content; record public workflow references"). The only real source data are the DailyMed label facts read on 2026-11-23, which are reference content in the catalog, not pharmacy activity; every dated record of the window is synthetic.' },
      { kind: 'mail_history', status: 'stated gap', reason: 'The ' + full.notices.length + ' notices are in the App\'s own notice log only; the dataset holds no Mail history for them. Mail is optional, and the Mail sender treats notices present in a loaded seed as history.' },
      ...gaps(new Set(records.map(i => i.date))),
    ],
    dates: perDate,
    representative: representative(full, files.replay.steps),
  };
}

function monthlyOf(data) {
  const rows = Object.fromEntries(lib.months().map(m => [m, Object.fromEntries(lib.KINDS.map(k => [plural(k.kind), 0]))]));
  for (const i of lib.dated(data)) { const m = lib.dateOf(i.at).slice(0, 7); if (rows[m]) rows[m][plural(i.kind)]++; }
  return rows;
}

const visibleTo = (data, actor, at) => data.fills.filter(f => fillAccess(relation(data, actor, data.prescriptions.find(r => r.rx_id === f.rx_id).patient_id, ms(at)), f.fill_id) !== null).map(f => f.fill_id).sort();

async function demonstrate(runtimeDir, files) {
  const { prepare } = require(path.join(runtimeDir, 'prepare.cjs'));
  const { Client } = require(path.join(runtimeDir, 'client.cjs'));
  const prepared = prepare(lib.ROOT);
  const clients = [];
  const open = async role => {
    const c = new Client(prepared.app, role, 'dataset-load', path.join(prepared.root, 'state'), 'mendwell-dataset-load', { registry: prepared.registry });
    clients.push(c);
    await c.initialize();
    return c;
  };
  try {
    const infra = await open('infra'), agent = await open('agent');
    const version = async () => (await infra.call('env.snapshot')).version;
    const instants = [];
    for (const [i, text] of instantsOf(files).entries()) {
      const selection = asOf(text, files);
      const loaded = await infra.call('env.load_seed', { expected_version: await version(), request_id: 'dataset-load-' + (i + 1), data: selection.data, virtual_now: selection.virtual_now, bundle: selection.bundle });
      if (loaded.status !== 'ready') throw Error('env.load_seed at ' + selection.as_of + ': ' + loaded.status + ' ' + (loaded.message || ''));
      const household = (await agent.call(lib.P + 'household.list', {})).people;
      const listed = (await agent.call(lib.P + 'fills.list', {})).fills;
      const views = [];
      for (const f of listed) views.push((await agent.call(lib.P + 'fills.get', { fill_id: f.fill_id })).fill);
      const snapshot = (await infra.call('env.snapshot')).snapshot;
      const projected = project(selection.data, selection.virtual_now);
      const expectedVisible = visibleTo(selection.data, selection.data.owner_person_id, selection.virtual_now);
      const rxs = (await agent.call(lib.P + 'rx.list', {})).prescriptions;
      const newest = selection.data.prescriptions.filter(r => rxs.some(x => x.rx_id === r.rx_id)).sort((a, b) => ms(b.received_at) - ms(a.received_at))[0];
      const withFacts = newest ? (await agent.call(lib.P + 'rx.get', { rx_id: newest.rx_id })).prescription : null;
      const stock = (await agent.call(lib.P + 'stores.list', { drug_id: 'd-atorvastatin-40' })).stores.map(s => s.store_id + (s.in_stock ? ' in stock' : ' out of stock'));
      const readBack = monthlyOf(snapshot.data), expected = monthlyOf(selection.data);
      const openSeen = listed.filter(f => !TERMINAL.includes(f.state)).map(f => f.fill_id + ' ' + f.state);
      const openExpected = selection.open_fills.filter(o => expectedVisible.includes(o.fill_id)).map(o => o.fill_id + ' ' + o.status);
      const totals = Object.fromEntries(lib.KINDS.map(k => [plural(k.kind), Object.values(readBack).reduce((s, r) => s + r[plural(k.kind)], 0)]));
      let staged = null;
      if (selection.events.length) {
        const event = selection.events[0];
        const applied = await infra.call('env.apply_event', { expected_version: await version(), event });
        const p = event.payload, after = (await infra.call('env.snapshot')).snapshot.data;
        const target = p.fill_id ? 'fill ' + p.fill_id + ' ' + after.fills.find(f => f.fill_id === p.fill_id).state
          : p.rx_id && !p.renewal_id ? 'prescription ' + p.rx_id + ' ' + (after.prescriptions.some(r => r.rx_id === p.rx_id) ? 'stored' : 'missing')
            : p.renewal_id ? 'renewal ' + p.renewal_id + ' ' + after.renewals.find(r => r.renewal_id === p.renewal_id).state
              : p.plan_request_id ? 'plan request ' + p.plan_request_id + ' ' + after.plan_requests.find(r => r.plan_request_id === p.plan_request_id).state
                : p.grant_id ? 'grant ' + p.grant_id + ' ' + after.grants.find(g => g.grant_id === p.grant_id).status
                  : 'store ' + p.store_id + ' ' + p.drug_id + (after.stores.find(s => s.store_id === p.store_id).stock[p.drug_id] ? ' in stock' : ' out of stock');
        staged = { event_id: event.event_id, at: event.at, operation: event.operation, status: applied.status, target_after: target };
      }
      instants.push({
        as_of: selection.as_of,
        seed_id: selection.data.seed_id,
        load: { tool: 'env.load_seed', status: loaded.status, loaded_objects: loaded.loaded, bundle_dataset_id: loaded.quality.dataset_id, automated_checks: loaded.quality.automated_pass ? 'pass' : 'fail' },
        agent_clock: snapshot.virtual_now,
        steps_applied: selection.steps_applied,
        steps_withheld: selection.steps_withheld,
        timers_committed: selection.timers_committed.length,
        fills_in_selection: selection.data.fills.length,
        fills_listed_by_agent: listed.length,
        listed_ids_match_grants: JSON.stringify(listed.map(f => f.fill_id).sort()) === JSON.stringify(expectedVisible),
        states_match_app_reads: views.every(v => v.state === projected.fills.find(f => f.fill_id === v.fill_id).state),
        household_powers: household.map(p => p.person_id + ' ' + p.powers.join('+')),
        latest_requested_at: selection.data.fills.length ? selection.data.fills.map(f => f.requested_at).sort((a, b) => ms(b) - ms(a))[0] : null,
        open_fills: selection.open_fills.map(o => o.fill_id + ' ' + o.status),
        open_fills_seen_by_agent: openSeen,
        open_fills_match_core: JSON.stringify(openSeen) === JSON.stringify(openExpected),
        read_back: totals,
        monthly_read_back_matches_selection: JSON.stringify(readBack) === JSON.stringify(expected),
        drug_facts_shown: withFacts ? { rx_id: withFacts.rx_id, drug: withFacts.drug.generic_name, facts: withFacts.facts.length, publisher: withFacts.facts[0].source.publisher } : null,
        atorvastatin_stock: stock,
        staged_events_available: selection.events.length,
        first_staged_event: staged,
        ...(ms(selection.as_of) === ms(END) ? { monthly_read_back: readBack } : {}),
      });
    }
    const version_ = require(path.join(runtimeDir, 'package.json')).version;
    return { interface: 'Real Core ' + version_ + ' over MCP stdio: Infra loads each selection with env.load_seed (data, virtual_now and provenance bundle) and reads env.snapshot; the Agent, bound as the account holder p-2, reads ' + lib.P + 'household.list, fills.list, fills.get for every listed fill, rx.list, rx.get and stores.list; the first staged event, if any, is applied with env.apply_event.', runtime: version_, instants };
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
  }
}

const table = (head, rows) => ['| ' + head.join(' | ') + ' |', '| ' + head.map(() => '---').join(' | ') + ' |', ...rows.map(r => '| ' + r.join(' | ') + ' |')].join('\n');
function render(report) {
  const k = Object.fromEntries(report.record_kinds.map(x => [x.kind, x]));
  const label = kind => kind.replace(/_/g, ' ') + 's';
  const lines = [
    '# Mendwell delivery dataset: coverage',
    '',
    report.scope,
    '',
    '- Dataset: `' + report.dataset_id + '`; window ' + report.window.from + ' to ' + report.window.to + ' inclusive; time zone `' + report.time_zone + '`; reference clock (the fixture clock) `' + report.reference_clock + '`.',
    '- Reproduce: ' + report.reproduce.map(c => '`' + c + '`').join(', then ') + ' from `apps/mendwell-pharmacy`. This file and `COVERAGE.json` are written by `dataset/coverage.cjs`.',
    '- Counting: ' + report.counting,
    '- Smoke fixture and delivery dataset: `fixtures/minimal.json` and this dataset share the household and the catalog (equal at the fixture clock, store stock included, checked by `tests/t32-dataset.test.cjs`) but have independent histories. The fixture serves the business tests, the examples and the proposal\'s example events; the dataset serves evaluation, and Tasks select their history from it with `dataset/as-of.cjs`. Their IDs overlap but name different records: the dataset uses the App\'s own runtime series (`rx-1`, `f-1`, `cl-1`, `g-1`, `n-1`, …), while the fixture keeps its history in the `h` series and its task-timeline notices in the `t` series; the fixture\'s `f-15`, `rx-9`, `g-3` and the other IDs named by the proposal\'s example events are not the dataset\'s.',
    '',
    '## Sources',
    '',
    table(['File', 'Role', 'Kind', 'Bytes', 'SHA-256'], report.sources.map(s => ['`' + s.file + '`', s.role, s.kind, String(s.bytes), '`' + s.sha256 + '`'])),
    '',
    'Method: ' + report.method.map(m => '`' + m.file + '` (`' + m.sha256.slice(0, 16) + '…`)').join(', ') + '; full hashes in `COVERAGE.json`.',
    '',
    '## Record kinds, IDs and date fields',
    '',
    table(['Kind', 'Source', 'Found at', 'Stable ID', 'Date field', 'Dated entries', 'Distinct dates', 'Earliest', 'Latest'], report.record_kinds.map(x => [x.kind, '`' + x.source + '`', '`' + x.list + '`', '`' + x.id + '`', x.date_field, String(x.records), String(x.distinct_dates), x.earliest, x.latest])),
    '',
    'Excluded from date counts:',
    '',
    ...report.exclusions.map(e => '- ' + e.records + ' (' + e.count + '): ' + e.reason),
    '- Invalid or missing occurrence dates: ' + report.invalid_dates + (report.invalid.length ? ' (' + report.invalid.map(i => i.kind + ' ' + i.id).join(', ') + ')' : '') + '; records outside the window: ' + report.outside_window + (report.outside.length ? ' (' + report.outside.map(i => i.kind + ' ' + i.id).join(', ') + ')' : '') + '.',
    '',
    '## Totals',
    '',
    '- Dated entries in `' + FILES.full + '`: ' + report.totals.records + ' (one per record\'s occurrence date, plus the closing of each closed fill, each pharmacist note and the revocation of each revoked grant, which are dated changes of a record rather than records of their own), of which ' + report.totals.counted + ' have a valid occurrence date in the window (' + lib.KINDS.map(x => k[x.kind].records + ' ' + label(x.kind)).join(', ') + '). App records (`plugin.records`: people, prescribers, drugs, plans, stores, cards, prescriptions, fills and grants): ' + report.totals.app_records + '.',
    '- Replay steps in `' + FILES.replay + '`: ' + report.totals.replay_steps + '.',
    '- Coverage figure: **' + report.distinct_dates.coverage + '** distinct dates. ' + report.distinct_dates.coverage_basis + ' ' + report.distinct_dates.coverage_note + ' Per source: ' + Object.entries(report.distinct_dates.by_source).map(([f, n]) => '`' + f + '` ' + n).join(', ') + '; global deduplicated count over both sources: ' + report.distinct_dates.global + '.',
    '- Earliest date ' + report.earliest + ', latest date ' + report.latest + '. Months without a requested fill: ' + (report.months_without_fills.length ? report.months_without_fills.join(', ') : 'none') + '.',
    '',
    '## Real and synthetic',
    '',
    '- Files: `' + FILES.base + '` and `' + FILES.full + '` are mixed (synthetic household, catalog and records with the reused label facts in the drug catalog); `' + FILES.replay + '` is synthetic.',
    '- Dated entries: real ' + report.provenance.real + ', synthetic ' + report.provenance.synthetic + ', mixed ' + report.provenance.mixed + '. ' + report.provenance.note,
    '- Label facts (' + report.provenance.label_facts.facts + ', reused; ' + report.provenance.label_facts.counted_as_real + ' counted as real data in use): ' + report.provenance.label_facts.rule,
    '',
    table(['Label source', 'Drug', 'Facts', 'Read on', 'Prescriptions', 'Fills', 'First fill', 'Last fill', 'Counted as real'], report.provenance.label_facts.labels.map(l => ['`' + l.source_id + '`', l.generic_name + ' (`' + l.drug_id + '`)', String(l.facts), l.read_on, String(l.prescriptions), String(l.fills), l.first_fill || '—', l.last_fill || '—', l.used ? 'yes' : 'no'])),
    '',
    table(['Partition', 'From', 'To', 'Dated entries', 'Replay steps'], report.partitions.map(p => [p.partition, p.from, p.to, String(p.records), String(p.replay_steps)])),
    '',
    '## Monthly coverage',
    '',
    table(['Month', 'Prescriptions', 'Fills', 'Closings', 'Claims', 'Plan requests', 'Renewals', 'Prepayments', 'Charges', 'Refusals', 'Pharmacist notes', 'Grants', 'Notices', 'Dated entries', 'Replay steps', 'Distinct dates (entries)', 'Distinct dates (with replay log)', 'After reference clock', 'Real', 'Synthetic'],
      report.monthly.map(m => [m.month, m.prescriptions, m.fills, m.fill_closings, m.claims, m.plan_requests, m.renewals, m.authorizations, m.charges, m.refusals, m.pharmacist_notes, m.grants + m.grant_revocations, m.notices, m.records, m.replay_steps, m.distinct_dates, m.distinct_dates_with_replay_log, m.records_after_reference_clock, m.real, m.synthetic].map(String))),
    '',
    'Grants counts grants given and revoked. Per-date counts are in `COVERAGE.json` (`dates`).',
    '',
    '## Household calendar and simplifications',
    '',
    '- Trips (no counter visits by the travellers; early refills before them): ' + report.household.trips.map(t => t.from + ' to ' + t.to + ' (' + t.what + ')').join('; ') + '.',
    '- ' + report.household.replaced_without_renewal.filter(r => r.replaced_by).length + ' prescriptions whose last refill was collected in the 45 days before the yearly visit are not renewed: the prescriber writes the replacement at that visit (' + report.household.replaced_without_renewal.filter(r => r.replaced_by).map(r => r.rx_id + ' by ' + r.replaced_by + ', ' + r.days_between + ' days after the last refill').join('; ') + '). For a prescription used up or expired at any other time a renewal is requested, within two days of the last refill when it is used up (' + Object.entries(report.household.renewal_requests).map(([k, n]) => n + ' ' + k).join(', ') + ' renewal requests)' + (report.household.replaced_without_renewal.some(r => !r.replaced_by) ? '; ' + report.household.replaced_without_renewal.filter(r => !r.replaced_by).map(r => r.rx_id + ', used up on ' + r.last_refill_collected.slice(0, 10)).join(', ') + ', gets its renewal request after the window ends' : '') + '.',
    '- Supply method: ' + report.household.supply_method,
    '- Supply gaps: ' + (report.household.supply_gaps.length ? report.household.supply_gaps.length + ' (' + report.household.supply_gaps.map(g => g.key + ' ' + (g.kind === 'no_pickup' ? 'never collected' : g.days + ' days from ' + g.from + ' to ' + g.to + (g.after_loss ? ', after the lost supply ' + g.after_loss + ' until the replacement ' + g.fill_id + ' was collected' : ''))).join('; ') + ')' : 'none') + '; ' + (report.household.supply_gaps.every(g => g.after_loss) ? 'no other maintenance regimen runs out between pickups or before ' + LAST + '.' : 'see the list.'),
    '- Supply on hand when a refill is requested: ' + report.household.supply_on_hand.min + ' to ' + report.household.supply_on_hand.max + ' days, ' + report.household.supply_on_hand.median + ' at the median (' + report.household.supply_on_hand.requests + ' maintenance requests; a documented lost supply counts as nothing on hand); ' + report.household.supply_on_hand.too_soon + ' of ' + report.household.supply_on_hand.claims + ' claims are rejected as too soon.',
    '- Every donepezil fill goes through its own prior authorization (' + report.household.prior_authorizations.requests + ' requests for ' + report.household.prior_authorizations.fills + ' fills): in this App an approved request waives the rule for its own fill only, a simplification of real drug plans, where an approval usually covers a period of time.',
    '- Elena\'s fills at Maple Avenue (`st-1`) while she stays with the household: ' + report.household.elena_at_maple_avenue.from + ' to ' + report.household.elena_at_maple_avenue.to + '; the household\'s fills at Harbor Street (`st-2`): ' + report.household.household_at_harbor_street.from + ' to ' + report.household.household_at_harbor_street.to + '.',
    '',
    '## Gaps',
    '',
    ...report.gaps.map(g => g.kind === 'real_data_anchor' ? '- No real pharmacy records (' + g.period + ' anchor; ' + g.status + '): ' + g.reason : g.kind === 'mail_history' ? '- No Mail history (' + g.status + '): ' + g.reason : '- ' + g.from + ' to ' + g.to + ' (' + g.days + ' days without any App record): ' + g.reason),
    '',
    '## Representative records',
    '',
    table(['Example', 'Fill', 'Patient', 'Drug', 'Store', 'Requested', 'Outcome', 'Claims', 'Plan requests', 'Payment', 'Refusals', 'Pharmacist notes'], report.representative.map(r => [r.example, r.fill_id, r.patient, r.drug + ' × ' + r.quantity, r.store_id, r.requested_at, r.state, r.claims.join('; '), r.plan_requests.join('; ') || '—', r.payment || (r.cash ? 'cash ' + r.cash : '—'), r.refusals.join('; ') || '—', r.notes.join('; ') || '—'])),
    '',
    'Timelines and notices of these fills are in `COVERAGE.json` (`representative`).',
    '',
  ];
  if (report.loading) {
    const l = report.loading, last = l.instants[l.instants.length - 1];
    lines.push('## Loading and query demonstration', '', l.interface, '',
      table(['As of', 'Seed ID', 'env.load_seed', 'Core clock', 'Steps applied / withheld', 'Timers committed', 'Fills in selection / listed by the Agent', 'Listed as the grants allow', 'Fill states equal the App reads', 'Latest request'],
        l.instants.map(x => [x.as_of, '`' + x.seed_id + '`', x.load.status + ', ' + x.load.loaded_objects + ' objects, bundle `' + x.load.bundle_dataset_id + '`, automated checks ' + x.load.automated_checks, x.agent_clock,
          x.steps_applied + ' / ' + x.steps_withheld, String(x.timers_committed), x.fills_in_selection + ' / ' + x.fills_listed_by_agent, x.listed_ids_match_grants ? 'yes' : 'no', x.states_match_app_reads ? 'yes' : 'no', x.latest_requested_at || '—'])),
      '',
      table(['As of', 'Claims', 'Plan requests', 'Charges', 'Refusals', 'Grants', 'Notices', 'Monthly read-back equals the selection', 'Open fills (Agent sees the same)', 'Drug facts on rx.get', 'Atorvastatin stock', 'Staged events', 'First staged event applied'],
        l.instants.map(x => [x.as_of, x.read_back.claims, x.read_back.plan_requests, x.read_back.charges, x.read_back.refusals, x.read_back.grants, x.read_back.notices, x.monthly_read_back_matches_selection ? 'yes' : 'no', (x.open_fills.join(', ') || 'none') + (x.open_fills_match_core ? ' (yes)' : ' (no)'),
          x.drug_facts_shown ? x.drug_facts_shown.facts + ' facts of ' + x.drug_facts_shown.drug + ' (' + x.drug_facts_shown.rx_id + ', ' + x.drug_facts_shown.publisher + ')' : '—', x.atorvastatin_stock.join(', '), x.staged_events_available,
          x.first_staged_event ? x.first_staged_event.operation + ' at ' + x.first_staged_event.at + ': ' + x.first_staged_event.status + '; then ' + x.first_staged_event.target_after : '—'].map(String))),
      '', 'Record counts are read back from env.snapshot; the Agent sees the fills of the patients the account holder may see at that instant (own, a guardian\'s, and those shared with a view or refill grant), each through fills.get. The row at ' + (l.instants.find(x => x.timers_committed > 0) || last).as_of + ' cuts one millisecond after a fill\'s return deadline passed with no later step yet: the selection commits that return to stock (with its claim reversal and notices) at its due time, as the App\'s next write would, so the seed and Core\'s reads agree. rx.get shows the cited label facts with the most recently received prescription the account holder may see. At ' + last.as_of + ' the whole window is loaded; its monthly read-back (`loading.instants[].monthly_read_back` in `COVERAGE.json`) equals the monthly table above, which `dataset/coverage.cjs` checks.', '');
  }
  return lines.join('\n');
}

async function report({ runtimeDir, files = lib.load() } = {}) {
  const out = compute(files);
  out.loading = await demonstrate(runtimeDir, files);
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const option = (name, fallback) => { const i = argv.lastIndexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
  const runtimeDir = path.resolve(option('--runtime', process.env.PALE_RUNTIME_ROOT || path.join(lib.ROOT, '..', '..', 'runtime')));
  const out = await report({ runtimeDir });
  const end = out.loading.instants[out.loading.instants.length - 1];
  const fresh = { [OUT.json]: lib.pretty(out), [OUT.md]: render(out) };
  const monthlyOk = out.monthly.every(m => Object.keys(end.monthly_read_back[m.month]).every(key => end.monthly_read_back[m.month][key] === m[key]));
  if (!monthlyOk) throw Error('The monthly counts read back through MCP differ from the computed coverage.');
  const failed = out.loading.instants.filter(x => x.load.automated_checks !== 'pass' || !x.listed_ids_match_grants || !x.states_match_app_reads || !x.open_fills_match_core || !x.monthly_read_back_matches_selection || x.agent_clock !== x.as_of);
  if (failed.length) throw Error('The loading demonstration failed at ' + failed.map(x => x.as_of).join(', ') + '.');
  if (argv.includes('--check')) {
    const differs = Object.keys(fresh).filter(rel => !fs.existsSync(lib.file(rel)) || fs.readFileSync(lib.file(rel), 'utf8') !== fresh[rel]);
    console.log(differs.length ? 'coverage report differs: ' + differs.join(', ') : 'coverage report is up to date: ' + out.totals.records + ' dated entries, ' + out.distinct_dates.coverage + ' distinct dates (' + out.distinct_dates.global + ' with the replay log), ' + out.earliest + ' to ' + out.latest);
    process.exitCode = differs.length ? 1 : 0;
    return;
  }
  for (const [rel, text] of Object.entries(fresh)) fs.writeFileSync(lib.file(rel), text);
  console.log(JSON.stringify({ records: out.totals.records, replay_steps: out.totals.replay_steps, distinct_dates: out.distinct_dates.coverage, with_replay_log: out.distinct_dates.global, earliest: out.earliest, latest: out.latest }));
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });
module.exports = { compute, render, monthlyOf, visibleTo, OUT, INSTANTS, instantsOf, KINDS };
