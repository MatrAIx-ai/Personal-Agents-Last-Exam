'use strict';
// Actual public Core and separate stdio MCP processes, not a local simulation.
const path = require('node:path');
const {driver, output} = require('../examples/runtime-support.cjs');
const {clone, later, blankWorkspace, filterCriteria, quoteEvent} = require('../examples/fixture-data.cjs');

async function run() {
  const d = driver();
  const {open, call, snapshot, write, event, load, eq, ok} = d;
  try {
    let agent = await open();
    const infra = await open('pricewatch', 'infra');
    const initial = await snapshot(infra);
    const initialData = clone(initial.snapshot.data);
    const criteria = filterCriteria(initialData);
    const args = {watch_key: 'runtime-filter', criteria, state: 'active'};
    const agentTools = (await agent.request('tools/list')).result.tools.map(tool => tool.name);
    eq('Read-only profile discovers only permitted business reads', agentTools.sort(),
      ['pricewatch.offers.list', 'pricewatch.watch.get', 'pricewatch.watch.list'].sort());
    const infraTools = (await infra.request('tools/list')).result.tools.map(tool => tool.name);
    ok('Infra discovers clock capability', infraTools.includes('env.advance_time'));
    for (const name of ['env.snapshot', 'env.reset', 'env.load_seed', 'env.apply_event', 'env.advance_time']) {
      eq('Agent cannot guess privileged ' + name, (await call(agent, name)).status, 'permission_denied');
    }
    eq('Read-only scenario profile rejects writes', (await call(agent, 'pricewatch.watch.upsert',
      {...args, expected_version: initial.version, request_id: 'scenario-denied'})).status, 'permission_denied');
    eq('Denied calls preserve business data', (await snapshot(infra)).snapshot.data, initialData);
    const baseline = await load(infra, blankWorkspace(initialData), {now: initial.snapshot.virtual_now});
    eq('Sandbox Agent discovers all four business operations',
      (await agent.request('tools/list')).result.tools.map(tool => tool.name).sort(),
      ['pricewatch.offers.list', 'pricewatch.watch.get', 'pricewatch.watch.list', 'pricewatch.watch.upsert'].sort());
    const baselineData = clone(baseline.snapshot.data);
    const baselineTime = baseline.snapshot.virtual_now;
    const firstArgs = {...args, expected_version: baseline.version, request_id: 'create-filter'};
    const first = await call(agent, 'pricewatch.watch.upsert', firstArgs);
    eq('Real MCP write commits', first.status, 'committed');
    ok('Write returns the actual server watch ID', typeof first.watch_id === 'string' && first.watch_id.length > 0);
    const firstState = await snapshot(infra);
    const replay = await call(agent, 'pricewatch.watch.upsert', firstArgs);
    eq('Exact write replay returns prior watch', replay.watch_id, first.watch_id);
    eq('Exact write replay returns original version', replay.version, first.version);
    eq('Exact write replay is marked duplicate', replay.duplicate, true);
    eq('Replay creates no business effect', (await snapshot(infra)).snapshot.data, firstState.snapshot.data);
    eq('Changed same-ID content conflicts', (await call(agent, 'pricewatch.watch.upsert', {
      ...firstArgs, criteria: {...criteria, ceiling_minor: criteria.ceiling_minor + 1}})).status, 'idempotency_conflict');
    eq('Changing same-ID expected version also conflicts', (await call(agent, 'pricewatch.watch.upsert', {
      ...firstArgs, expected_version: first.version})).status, 'idempotency_conflict');
    eq('A new request with old App version is stale', (await call(agent, 'pricewatch.watch.upsert', {
      ...firstArgs, request_id: 'stale-write'})).status, 'stale_version');
    const afterRejected = await snapshot(infra);
    eq('Rejected writes leave business data unchanged', afterRejected.snapshot.data, firstState.snapshot.data);
    ok('Denied attempts remain in Core audit', afterRejected.snapshot.audit.some(row => row.decision === 'deny' && row.reason === 'stale_version'));
    const noOp = await write(agent, infra, 'pricewatch.watch.upsert', args, 'business-noop');
    eq('Same-rule write is a business no-op', noOp.changed, false);
    eq('Business no-op preserves App records', (await snapshot(infra)).snapshot.data, afterRejected.snapshot.data);
    eq('Core still versions a successful no-op write', noOp.version.revision, afterRejected.version.revision + 1);

    const secondAgent = await open();
    const raceVersion = (await snapshot(infra)).version;
    const race = await Promise.all([
      call(agent, 'pricewatch.watch.upsert', {...args, criteria: {...criteria, ceiling_minor: 3100}, expected_version: raceVersion, request_id: 'race-a'}),
      call(secondAgent, 'pricewatch.watch.upsert', {...args, criteria: {...criteria, ceiling_minor: 3200}, expected_version: raceVersion, request_id: 'race-b'})
    ]);
    eq('Concurrent clients cannot silently overwrite', race.map(item => item.status).sort(), ['committed', 'stale_version']);
    await write(agent, infra, 'pricewatch.watch.upsert', args, 'restore-ceiling');

    const q1 = quoteEvent(baselineData, criteria, {id: 'runtime-q1-event', episode: 'runtime-q1', at: later(baselineTime, 60 * 60 * 1000)});
    const q1Arguments = {expected_version: (await snapshot(infra)).version, event: q1};
    const q1Receipt = await call(infra, 'env.apply_event', q1Arguments);
    eq('Trusted released quote commits', q1Receipt.status, 'committed');
    let view = await call(agent, 'pricewatch.watch.get', {watch_id: first.watch_id});
    eq('Matching quote creates one real candidate', view.watch.available_candidate_count, 1);
    eq('Candidate uses actual payable total', view.candidates[0].total_minor, 2700);
    const originalCandidate = view.candidates[0].id;
    const beforeEventReplay = await snapshot(infra);
    eq('Exact event replay returns prior receipt', (await call(infra, 'env.apply_event', q1Arguments)).duplicate, true);
    eq('Event replay does not duplicate records', (await snapshot(infra)).snapshot.data, beforeEventReplay.snapshot.data);
    const conflictingEvent = clone(q1Arguments);
    conflictingEvent.event.payload.item_total_minor = 2600;
    eq('Conflicting event ID is rejected by Core', (await call(infra, 'env.apply_event', conflictingEvent)).status, 'idempotency_conflict');
    const conflictingEpisode = clone(q1);
    conflictingEpisode.event_id = 'runtime-same-episode-new-event';
    conflictingEpisode.at = later(q1.at, 60 * 1000);
    conflictingEpisode.payload.item_total_minor = 2600;
    eq('New event ID cannot alter an immutable quote episode', (await call(infra, 'env.apply_event', {
      expected_version: (await snapshot(infra)).version, event: conflictingEpisode})).status, 'idempotency_conflict');
    eq('Rejected episode change preserves data and clock', [(await snapshot(infra)).snapshot.data, (await snapshot(infra)).snapshot.virtual_now],
      [beforeEventReplay.snapshot.data, beforeEventReplay.snapshot.virtual_now]);
    const futureQuote = quoteEvent(baselineData, criteria, {id: 'runtime-future', episode: 'runtime-future', at: later(q1.at, 2 * 60 * 1000)});
    futureQuote.payload.valid_from = later(futureQuote.at, 60 * 1000);
    eq('A future-start quote cannot be published early', (await call(infra, 'env.apply_event', {
      expected_version: (await snapshot(infra)).version, event: futureQuote})).status, 'invalid_event');
    const foreign = quoteEvent(baselineData, criteria, {id: 'runtime-foreign', episode: 'runtime-foreign', at: later(q1.at, 2 * 60 * 1000)});
    foreign.payload.account_id = baselineData.account_id + '-foreign';
    eq('Foreign-account quote is rejected', (await call(infra, 'env.apply_event', {
      expected_version: (await snapshot(infra)).version, event: foreign})).status, 'invalid_event');
    const beforeRead = await snapshot(infra);
    await call(agent, 'pricewatch.offers.list');
    await call(agent, 'pricewatch.watch.list');
    await call(agent, 'pricewatch.watch.get', {watch_id: first.watch_id});
    const afterRead = await snapshot(infra);
    eq('Business reads preserve data', afterRead.snapshot.data, beforeRead.snapshot.data);
    eq('Business reads preserve Core business version', afterRead.version, beforeRead.version);
    ok('Real Core records successful reads', afterRead.snapshot.audit.length > beforeRead.snapshot.audit.length);

    await write(agent, infra, 'pricewatch.watch.upsert', {...args, state: 'paused'}, 'pause');
    view = await call(agent, 'pricewatch.watch.get', {watch_id: first.watch_id});
    eq('Pause withdraws the previously available candidate', view.candidates.find(item => item.id === originalCandidate).status, 'withdrawn');
    const q2 = quoteEvent(baselineData, criteria, {id: 'runtime-q2-event', episode: 'runtime-q2', at: later(q1.at, 10 * 60 * 1000),
      validUntil: q1.payload.valid_until, total: 2400, supersedes: [q1.payload.offer_episode_id]});
    await event(infra, q2);
    view = await call(agent, 'pricewatch.watch.get', {watch_id: first.watch_id});
    eq('A new lower-price episode does not reactivate a paused watch', [view.watch.state, view.watch.available_candidate_count, view.candidates.length], ['paused', 0, 1]);

    const positiveInfra = await open('pricewatch', 'infra', 'active-control');
    const positiveAgent = await open('pricewatch', 'agent', 'active-control');
    await load(positiveInfra, baselineData, {now: baselineTime});
    const positiveBaseline = await snapshot(positiveInfra);
    eq('Control enables sandbox profile', (await call(positiveInfra, 'env.reset', {expected_version: positiveBaseline.version, profile: 'sandbox'})).status, 'ready');
    const positiveWatch = await write(positiveAgent, positiveInfra, 'pricewatch.watch.upsert', args, 'active-control-watch');
    await event(positiveInfra, q1); await event(positiveInfra, q2);
    const positiveView = await call(positiveAgent, 'pricewatch.watch.get', {watch_id: positiveWatch.watch_id});
    eq('Identical new episode is available in active-watch control', positiveView.watch.available_candidate_count, 1);
    eq('Active control references the new episode', positiveView.candidates.find(item => item.effective_status === 'available_in_app').offer_episode_id, q2.payload.offer_episode_id);

    await write(agent, infra, 'pricewatch.watch.upsert', args, 'explicit-resume');
    view = await call(agent, 'pricewatch.watch.get', {watch_id: first.watch_id});
    eq('Explicit resume re-evaluates the valid current quote', view.watch.available_candidate_count, 1);
    ok('Resume creates a new candidate rather than rewriting withdrawn history', view.candidates.some(item => item.id !== originalCandidate && item.effective_status === 'available_in_app'));
    await agent.close(); agent = await open();
    eq('A restarted MCP process sees committed business state', (await call(agent, 'pricewatch.watch.get', {watch_id: first.watch_id})).watch.id, first.watch_id);

    const peerInfra = await open('pricewatch', 'infra', 'untouched-run');
    eq('Another run retains its own fixture baseline', (await snapshot(peerInfra)).snapshot.data, initialData);
    const accountInfra = await open('pricewatch', 'infra', 'runtime-integration', path.join(d.prepared.root, 'account-b-state'));
    const accountAgent = await open('pricewatch', 'agent', 'runtime-integration', path.join(d.prepared.root, 'account-b-state'));
    const accountData = clone(baselineData); accountData.account_id = 'account-b';
    const binding = clone(initial.snapshot.binding);
    const firstAccount = binding.accounts.find(item => item.app_id === 'pricewatch' && item.account_id === baselineData.account_id);
    const owner = binding.people.find(item => item.person_id === firstAccount.owner_person_id);
    const secondOwnerId = owner.person_id + '-isolated';
    binding.people.push({...clone(owner), person_id: secondOwnerId});
    binding.accounts = binding.accounts.filter(item => item.app_id !== 'pricewatch');
    binding.accounts.push({...clone(firstAccount), account_id: accountData.account_id, owner_person_id: secondOwnerId});
    await load(accountInfra, accountData, {binding, now: baselineTime});
    eq('Another account instance cannot find the first account watch', (await call(accountAgent, 'pricewatch.watch.get', {watch_id: first.watch_id})).status, 'not_found');
    eq('Second account starts without copied watches', (await call(accountAgent, 'pricewatch.watch.list')).items.length, 0);
    eq('Account argument cannot impersonate another binding', (await call(agent, 'pricewatch.watch.get', {watch_id: first.watch_id, account_id: 'account-b'})).status, 'invalid_arguments');

    const beforeClock = await snapshot(infra);
    const advanceArgs = {expected_version: beforeClock.version, request_id: 'expiry-clock', virtual_now: q2.payload.valid_until};
    eq('Infra advances the actual public clock', (await call(infra, 'env.advance_time', advanceArgs)).status, 'committed');
    const afterClock = await snapshot(infra);
    eq('Clock advancement does not run a hidden App timer', afterClock.snapshot.data, beforeClock.snapshot.data);
    view = await call(agent, 'pricewatch.watch.get', {watch_id: first.watch_id});
    eq('Clock-only expiry is already non-actionable', view.watch.available_candidate_count, 0);
    ok('Clock-only expiry is projected without storing a transition', view.candidates.some(item => item.status === 'available_in_app' && item.effective_status === 'expired'));
    eq('Expiry read is pure', (await snapshot(infra)).snapshot.data, afterClock.snapshot.data);
    const expiryEvent = {event_id: 'runtime-expire', at: q2.payload.valid_until, operation: 'offer.expire_due', payload: {account_id: baselineData.account_id}};
    await event(infra, expiryEvent);
    view = await call(agent, 'pricewatch.watch.get', {watch_id: first.watch_id});
    eq('Explicit maintenance event commits one expiry', view.candidates.filter(item => item.status === 'expired').length, 1);
    const expiredTransitionCount = view.transitions.filter(item => item.kind === 'candidate_expired').length;
    await event(infra, {...expiryEvent, event_id: 'runtime-expire-again'});
    eq('A repeated expiry cause creates no extra transition', (await call(agent, 'pricewatch.watch.get', {watch_id: first.watch_id})).transitions.filter(item => item.kind === 'candidate_expired').length, expiredTransitionCount);
    eq('Old clock retry returns original receipt without rewinding', (await call(infra, 'env.advance_time', advanceArgs)).duplicate, true);
    const beforeReset = await snapshot(infra);
    eq('Reset returns ready', (await call(infra, 'env.reset', {expected_version: beforeReset.version})).status, 'ready');
    const reset = await snapshot(infra);
    eq('Reset restores loaded business baseline', reset.snapshot.data, baselineData);
    eq('Reset restores loaded clock', reset.snapshot.virtual_now, baselineTime);
    eq('Reset invalidates an earlier lifecycle epoch', (await call(agent, 'pricewatch.watch.upsert', {...args, expected_version: beforeReset.version, request_id: 'old-epoch'})).status, 'stale_version');
    eq('Reset leaves other run untouched', (await snapshot(peerInfra)).snapshot.data, initialData);
    eq('Reset leaves other account untouched', (await snapshot(accountInfra)).snapshot.data, accountData);

    const historical = clone(require('../fixtures/history.json'));
    const historicalBundle = clone(require('../fixtures/history-bundle.json'));
    const historyInfra = await open('pricewatch', 'infra', 'loaded-history');
    const historyAgent = await open('pricewatch', 'agent', 'loaded-history');
    const historyInitial = await snapshot(historyInfra);
    eq('Real Core accepts the authored historical bundle', (await call(historyInfra, 'env.load_seed', {
      expected_version: historyInitial.version, request_id: 'authored-history', data: historical,
      bundle: historicalBundle, virtual_now: baselineTime})).status, 'ready');
    const historyLoaded = await snapshot(historyInfra);
    eq('Loaded history exactly matches supplied business records', historyLoaded.snapshot.data, historical);
    eq('Historical watches are observable through Agent tools',
      (await call(historyAgent, 'pricewatch.watch.list', {limit: 100})).items.length, historical.watches.length);
    const historicalWatch = historical.watches[0];
    const historicalView = await call(historyAgent, 'pricewatch.watch.get', {watch_id: historicalWatch.id, limit: 100});
    eq('Historical transitions are not silently dropped', historicalView.transitions.length,
      historical.transitions.filter(item => item.watch_id === historicalWatch.id).length);
    eq('History profile can enable permitted business writes', (await call(historyInfra, 'env.reset', {
      expected_version: historyLoaded.version, profile: 'sandbox'})).status, 'ready');
    await write(historyAgent, historyInfra, 'pricewatch.watch.upsert', {
      watch_key: historicalWatch.watch_key, state: historicalWatch.state,
      criteria: {...historicalWatch.criteria, ceiling_minor: historicalWatch.criteria.ceiling_minor + 1}}, 'revise-historical-watch');
    const changedHistory = await snapshot(historyInfra);
    ok('A later session can revise a seeded historical watch', JSON.stringify(changedHistory.snapshot.data) !== JSON.stringify(historical));
    eq('Historical reset succeeds', (await call(historyInfra, 'env.reset', {expected_version: changedHistory.version})).status, 'ready');
    eq('Historical reset restores exact seed rather than package defaults', (await snapshot(historyInfra)).snapshot.data, historical);
    return d.report({mode: 'real stdio MCP / public Core'});
  } finally {await d.close();}
}

module.exports = {run};
if (require.main === module) output(run);
