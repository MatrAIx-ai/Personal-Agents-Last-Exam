#!/usr/bin/env node
'use strict';
// Real-MCP walkthrough of the three approved Dayline workflows through the public runtime.
// Two readers run as two Dayline instances with separate state roots: each loads the same public
// catalog, Infra applies the same edition.publish to both, and private state stays separate.
// A scripted reference agent answers each request from what its reader can see; these replies are
// reference evidence for the data and tools, not model-agent trials. Code assembles the morning
// briefing from tool output. The travel and sports replies use hand-written wording: outlet names,
// the saved edition ID and the converted game time are filled in from tool results, and checks
// compare each reply's facts with the editions the reader opened. Prints a JSON evidence report
// with every call joined to run, account, connection and request/event ID.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

function runtimeRoot() {
  if (process.env.PALE_RUNTIME_ROOT) return path.resolve(process.env.PALE_RUNTIME_ROOT);
  let dir = __dirname;
  while (!fs.existsSync(path.join(dir, 'runtime/launch.cjs'))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw Error('Run inside the public PALE checkout, or set PALE_RUNTIME_ROOT to its runtime directory.');
    dir = parent;
  }
  return path.join(dir, 'runtime');
}
const runtime = runtimeRoot();
const {prepare} = require(path.join(runtime, 'prepare.cjs'));
const {Client} = require(path.join(runtime, 'client.cjs'));
const {digestTree} = require(path.join(runtime, 'verify.cjs'));
const pkg = path.resolve(__dirname, '..');
const load = file => JSON.parse(fs.readFileSync(path.join(pkg, file), 'utf8'));
const copy = value => structuredClone(value);
const RUN = 'morning';
const READER_TIME_ZONE = 'America/Los_Angeles'; // Supplied by the task's user context, not by Dayline.
const SPOILER = /\b\d+-\d+\b|\bwins?\b|\bwon\b|\bbeat\b|\blost\b|walk-?off|extra innings|\bpast the\b/i;

async function main() {
  const packageSha256 = digestTree(pkg);
  const prepared = prepare(pkg);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dayline-walkthrough-'));
  const clients = [], checks = [], trace = [], observations = {}, replies = {};
  const ok = (label, condition) => {assert.ok(condition, label); checks.push(label);};
  const equal = (label, actual, expected) => {assert.deepEqual(actual, expected, label); checks.push(label);};

  // Every call goes through here so the trace joins run, account, connection and request/event IDs.
  async function open(account, role, stateDir) {
    const client = new Client('dayline', role, RUN, stateDir, 'dayline-walkthrough', {registry: prepared.registry});
    clients.push(client); await client.initialize();
    const connection = account + '/' + role + '#' + clients.length;
    return {
      raw: client,
      async call(name, args = {}) {
        const result = await client.call(name, args);
        trace.push({seq: trace.length + 1, run: RUN, account, connection, tool: name,
          request_id: args.request_id ?? null, event_id: args.event?.event_id ?? null,
          status: result.status, duplicate: result.duplicate === true, version: result.version ?? null});
        return result;
      },
    };
  }
  async function reader(account, stateDir, data, binding, policies, virtualNow) {
    const infra = await open(account, 'infra', stateDir), agent = await open(account, 'agent', stateDir);
    const s = await infra.call('env.snapshot');
    const bundle = copy(s.snapshot.resources.bundle);
    bundle.dataset.expected_counts.records = data.editions.length;
    const loaded = await infra.call('env.load_seed', {expected_version: s.version, request_id: 'load-' + account,
      data, binding, policies, bundle, ...(virtualNow ? {virtual_now: virtualNow} : {})});
    assert.equal(loaded.status, 'ready', JSON.stringify(loaded));
    return {account, infra, agent};
  }
  let sequence = 0;
  async function write(r, name, args) {
    const version = (await r.infra.call('env.snapshot')).version;
    return r.agent.call(name, {...args, expected_version: version, request_id: r.account + '-w' + (++sequence)});
  }
  const ids = list => list.map(e => e.edition_id);
  const catalog = d => ({outlets: d.outlets, stories: d.stories, editions: d.editions, front_pages: d.front_pages});

  // Scripted reference agent for the morning briefing: per requested section, take the first front-page
  // entry the reader has not read whose text is not a verbatim copy of an edition they already read.
  async function morningBriefing(r) {
    const history = new Set((await r.agent.call('dayline.history.list', {limit: 200})).entries.map(e => e.edition.edition_id));
    const picks = [];
    for (const page of ['local', 'state', 'world']) {
      for (const entry of (await r.agent.call('dayline.front_page.get', {front_page_id: page})).entries) {
        if (entry.read || picks.some(p => p.story_id === entry.story_id)) continue;
        const e = (await r.agent.call('dayline.edition.get', {edition_id: entry.edition_id})).edition;
        let repeatsRead = false;
        for (const credit of e.credits) {
          const source = (await r.agent.call('dayline.edition.get', {edition_id: credit.edition_id})).edition;
          if (history.has(source.edition_id) && source.text === e.text) repeatsRead = true;
        }
        if (repeatsRead) continue;
        picks.push({page, edition_id: e.edition_id, story_id: e.story_id, outlet: e.outlet_name, byline: e.byline, headline: e.headline,
          credits: e.credits.map(c => c.credit)});
        break;
      }
    }
    const label = {local: 'Valley', state: 'Calder', world: 'World'};
    const text = picks.map(p => label[p.page] + ': ' + p.headline + ' (' + p.outlet + ', ' + p.byline + ')' +
      (p.credits.length ? '; builds on ' + p.credits.join(', ') : '')).join('\n');
    return {picks, text};
  }

  try {
    // Package defaults: the Agent sees reads only; private writes need a task policy.
    const defaultDir = path.join(temp, 'default');
    await open('dayline-ana', 'infra', defaultDir); // Infra initializes a run before an Agent connects.
    const defaultAgent = await open('dayline-ana', 'agent', defaultDir);
    const defaultTools = (await defaultAgent.raw.request('tools/list')).result.tools.map(t => t.name);
    ok('Default scenario policy exposes the 8 read tools only', defaultTools.length === 8 && defaultTools.every(n => !/mark_read|saved\.(add|remove)/.test(n)));
    equal('Default policy denies private writes', (await defaultAgent.call('dayline.saved.add', {edition_id: 'gulls-recap-1',
      expected_version: {epoch: 1, revision: 0}, request_id: 'denied-save'})).status, 'permission_denied');
    equal('Agent cannot inject events', (await defaultAgent.call('env.apply_event', {})).status, 'permission_denied');

    // Two readers in separate instances. Both load the same 07:00 catalog; Ben has his own history.
    const minimal = load('fixtures/minimal.json'), benFinal = load('examples/task-data/seed.json');
    const writePolicies = load('examples/task-data/policies.json');
    const ana = await reader('dayline-ana', path.join(temp, 'ana'), minimal, load('fixtures/binding.json'), writePolicies);
    const benAt0700 = {...copy(minimal), account_id: benFinal.account_id, owner_person_id: benFinal.owner_person_id,
      // Ben's history before the 07:10 event: everything except the edition that event publishes.
      reading_history: benFinal.reading_history.filter(h => minimal.editions.some(e => e.edition_id === h.edition_id)),
      reading_list: copy(benFinal.reading_list)};
    const ben = await reader('dayline-ben', path.join(temp, 'ben'), benAt0700, load('examples/task-data/binding.json'), writePolicies);
    const loadedAnaSnapshot = await ana.infra.call('env.snapshot'), loadedAna = loadedAnaSnapshot.snapshot;

    // edition.publish at 07:10, applied by Infra to every reader instance in the run.
    const scenario = load('examples/scenario.json');
    let managementCall = null;
    for (const r of [ana, ben]) {
      const before = await r.infra.call('env.snapshot');
      const args = {expected_version: before.version, event: scenario};
      if (!managementCall) managementCall = {method: 'tools/call', params: {name: 'env.apply_event', arguments: copy(args)}};
      equal(r.account + ': edition.publish commits', (await r.infra.call('env.apply_event', args)).status, 'committed');
      const after = await r.infra.call('env.snapshot');
      equal(r.account + ': the event advances the clock to its time', after.snapshot.virtual_now, scenario.at);
      ok(r.account + ': replaying the identical event is deduplicated without a new version',
        (await r.infra.call('env.apply_event', args)).duplicate === true && JSON.stringify((await r.infra.call('env.snapshot')).version) === JSON.stringify(after.version));
    }
    const changed = copy(scenario); changed.payload.headline = 'A different headline under the same event ID';
    equal('Reusing an event ID with different content is an idempotency conflict',
      (await ana.infra.call('env.apply_event', {expected_version: (await ana.infra.call('env.snapshot')).version, event: changed})).status, 'idempotency_conflict');
    const badCredit = copy(scenario); badCredit.event_id = 'bad-credit'; badCredit.payload.edition_id = 'rail-local-9';
    badCredit.payload.credits = [{edition_id: 'missing-edition', credit: 'Wire'}];
    const beforeBad = await ana.infra.call('env.snapshot');
    equal('An event crediting an unknown edition fails', (await ana.infra.call('env.apply_event', {expected_version: beforeBad.version, event: badCredit})).status, 'invalid_event');
    const badPlacement = copy(scenario); badPlacement.event_id = 'bad-position'; badPlacement.payload.edition_id = 'rail-local-9';
    badPlacement.payload.position = 99;
    equal('An event placed past the end of a front page fails', (await ana.infra.call('env.apply_event', {expected_version: beforeBad.version, event: badPlacement})).status, 'invalid_event');
    equal('Failed events leave business state unchanged', (await ana.infra.call('env.snapshot')).snapshot.data, beforeBad.snapshot.data);
    equal('Both reader instances carry the same public catalog after the event',
      catalog((await ben.infra.call('env.snapshot')).snapshot.data), catalog((await ana.infra.call('env.snapshot')).snapshot.data));

    // Ben reads the expanded edition at 07:20; his state then equals the shipped task-data seed.
    const benVersion = (await ben.infra.call('env.snapshot')).version;
    equal('Infra advances Ben\'s clock to 07:20', (await ben.infra.call('env.advance_time', {expected_version: benVersion,
      request_id: 'ben-0720', virtual_now: '2026-10-14T07:20:00-07:00'})).status, 'committed');
    await write(ben, 'dayline.history.mark_read', {edition_id: 'rail-local-2'});
    equal('Ben\'s live state equals examples/task-data/seed.json', (await ben.infra.call('env.snapshot')).snapshot.data, benFinal);
    // The shipped task data also loads directly, as its README tells task authors to do.
    const direct = await open('dayline-ben', 'infra', path.join(temp, 'ben-direct'));
    const fresh = await direct.call('env.snapshot');
    const directLoad = await direct.call('env.load_seed', {expected_version: fresh.version, request_id: 'load-ben-direct', data: benFinal,
      binding: load('examples/task-data/binding.json'), policies: writePolicies, virtual_now: '2026-10-14T07:20:00-07:00',
      bundle: {...copy(fresh.snapshot.resources.bundle), dataset: load('examples/task-data/dataset.json')}});
    equal('examples/task-data loads directly with its own dataset at 07:20', directLoad.status, 'ready');
    equal('The directly loaded instance matches the rebuilt one', (await direct.call('env.snapshot')).snapshot.data,
      (await ben.infra.call('env.snapshot')).snapshot.data);

    // Workflow 1: morning briefing, answered for each reader from what that reader saw.
    const historyBefore = (await ana.infra.call('env.snapshot')).snapshot.data.reading_history;
    const local = (await ana.agent.call('dayline.front_page.get', {front_page_id: 'local'})).entries;
    equal('Valley page: expanded edition first, then library hours, then the reprint', ids(local).slice(0, 3), ['rail-local-2', 'library-1', 'rail-local-1']);
    equal('Rail story group: pre-vote preview, original dispatch, two reprints, expanded edition',
      ids((await ana.agent.call('dayline.story.get', {story_id: 'rail-funding'})).editions),
      ['rail-wire-0', 'rail-wire-1', 'rail-local-1', 'rail-harbor-1', 'rail-local-2']);
    const anaBrief = await morningBriefing(ana), benBrief = await morningBriefing(ben);
    equal('Ana\'s briefing: three distinct developments, led locally by the station interview',
      anaBrief.picks.map(p => p.edition_id), ['rail-local-2', 'budget-courier-1', 'election-standard-1']);
    ok('Ana\'s local item credits the Valley Daily interview', /Valley Daily, Mara Bell/.test(anaBrief.text) && /Eastbank/.test(anaBrief.text));
    equal('Ben already read the interview: his local lead is the library story',
      benBrief.picks.map(p => p.edition_id), ['library-1', 'budget-courier-1', 'election-standard-1']);
    ok('No briefing spends a slot on a reprint of the rail vote', ![...anaBrief.picks, ...benBrief.picks].some(p => ['rail-local-1', 'rail-harbor-1'].includes(p.edition_id)));
    equal('Reading for the briefing leaves Ana\'s history unchanged', (await ana.infra.call('env.snapshot')).snapshot.data.reading_history, historyBefore);
    replies.morning_briefing = {'dayline-ana': anaBrief.text, 'dayline-ben': benBrief.text};

    // Open one story from two sections: World (section "world") and a "transport" section search.
    const fromWorld = (await ana.agent.call('dayline.front_page.get', {front_page_id: 'world'})).entries.find(e => e.edition_id === 'strike-standard-1');
    const fromTransport = (await ana.agent.call('dayline.search', {section: 'transport', geography: 'costa-norte'})).editions[0];
    ok('One story is reached from the world and transport sections',
      fromWorld.section === 'world' && fromTransport.section === 'transport' && fromWorld.story_id === fromTransport.story_id);
    const strikeGroup = (await ana.agent.call('dayline.story.get', {story_id: fromWorld.story_id})).editions;
    equal('The strike story group spans both sections', [...new Set(strikeGroup.map(e => e.section))].sort(), ['transport', 'world']);
    observations.one_story_two_sections = {story_id: fromWorld.story_id, editions: strikeGroup.map(e => e.edition_id + ' (' + e.section + ', ' + e.language + ')')};

    // Workflow 2: family travel. Trace the newest English report to its Spanish source.
    const found = (await ana.agent.call('dayline.search', {query: 'Puerto Claro'})).editions;
    const english = (await ana.agent.call('dayline.edition.get', {edition_id: found[0].edition_id})).edition;
    const spanish = (await ana.agent.call('dayline.edition.get', {edition_id: english.credits[0].edition_id})).edition;
    ok('The newest Puerto Claro report is the English wire, crediting the Spanish regional report',
      english.edition_id === 'strike-wire-1' && spanish.edition_id === 'strike-faro-1' && spanish.language === 'es');
    ok('Both languages give the same window: all of Friday, Oct. 16 from 00:00 local time',
      /viernes 16 de octubre, que comenzará a las 00:00/.test(spanish.text) && /all of Friday, Oct\. 16, from 00:00 local time/.test(english.text));
    replies.family_travel = 'Confirmed: the air traffic controllers\' 24-hour stoppage covers all of Friday, Oct. 16 (from 00:00 local time) at San Telmo and Bahía Honda. ' +
      'Unresolved: at Puerto Claro, management and the union are still negotiating minimum service, and the union says there will be no answer before Thursday. ' +
      'Source: ' + spanish.outlet_name + ' (' + spanish.byline + '), republished in English by ' + english.outlet_name + '. ' +
      'I can\'t tell whether her flight will operate; she should check its status with the airline before leaving for the airport.';
    ok('Travel reply cites the regional report, names both airports and does not promise the flight',
      /El Faro del Litoral/.test(replies.family_travel) && /San Telmo/.test(replies.family_travel) && /Bahía Honda/.test(replies.family_travel) &&
      /Unresolved: at Puerto Claro/.test(replies.family_travel) && !/will (operate|fly|depart) (normally|as scheduled)|not affected/i.test(replies.family_travel));

    // Workflow 3: sports without spoilers. Save the full recap once, give the next game in the reader's time zone.
    const gameEditions = (await ana.agent.call('dayline.story.get', {story_id: 'gulls-owls'})).editions;
    const recaps = [];
    for (const e of gameEditions) recaps.push((await ana.agent.call('dayline.edition.get', {edition_id: e.edition_id})).edition);
    const fullRecap = recaps.filter(e => e.published_at > '2026-10-13T19').sort((a, b) => b.text.length - a.text.length)[0];
    const saveArgs = {edition_id: fullRecap.edition_id, expected_version: (await ana.infra.call('env.snapshot')).version, request_id: 'ana-save-recap'};
    const saved = await ana.agent.call('dayline.saved.add', saveArgs);
    equal('Save returns ID and status only', [saved.status, saved.edition_id, saved.saved, saved.changed, 'headline' in saved],
      ['committed', 'gulls-recap-1', true, true, false]);
    ok('Retrying an identical request is deduplicated', (await ana.agent.call('dayline.saved.add', saveArgs)).duplicate === true);
    equal('Reusing a request ID for a different edition is rejected',
      (await ana.agent.call('dayline.saved.add', {...saveArgs, edition_id: 'library-1'})).status, 'idempotency_conflict');
    equal('Saving again with a new request leaves one bookmark', (await write(ana, 'dayline.saved.add', {edition_id: 'gulls-recap-1'})).changed, false);
    await write(ana, 'dayline.saved.add', {edition_id: 'gulls-wire-recap-1'});
    equal('Removing the wire brief saved by mistake', (await write(ana, 'dayline.saved.remove', {edition_id: 'gulls-wire-recap-1'})).saved, false);
    equal('Stale expected_version is rejected', (await ana.agent.call('dayline.saved.add',
      {edition_id: 'library-1', expected_version: loadedAnaSnapshot.version, request_id: 'ana-stale'})).status, 'stale_version');
    const readingList = (await ana.agent.call('dayline.saved.list', {})).entries.map(e => e.edition.edition_id);
    equal('Reading list holds the full recap exactly once', readingList, ['gulls-recap-1', 'postal-standard-1']);
    const schedule = (await ana.agent.call('dayline.edition.get', {edition_id: 'gulls-schedule-1'})).edition;
    const match = /Friday, Oct\. 16: (\d+):(\d+) p\.m\. CDT/.exec(schedule.text);
    ok('Schedule lists the next game without a score', Boolean(match) && !SPOILER.test(schedule.headline + ' ' + schedule.text));
    const firstPitch = new Date('2026-10-16T' + String(Number(match[1]) + 12).padStart(2, '0') + ':' + match[2] + ':00-05:00');
    const nextGame = firstPitch.toLocaleString('en-US', {timeZone: READER_TIME_ZONE, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'});
    replies.sports = {text: 'Saved the full game recap to your reading list for later (edition ' + saved.edition_id + '). ' +
      'The Gulls play next on ' + nextGame + ', at Lakeport.', link_text: 'Full recap (saved for later)'};
    ok('Sports reply gives the next game in the reader\'s time zone and reveals no result',
      /Friday, October 16.*5:10\s?PM PDT/.test(replies.sports.text) && !SPOILER.test(replies.sports.text + ' ' + replies.sports.link_text) &&
      !replies.sports.text.includes(fullRecap.headline));
    observations.sports = {saved_edition_id: saved.edition_id, reading_list: readingList, schedule_source: schedule.edition_id};

    // Private state stays separate across the two instances.
    await write(ben, 'dayline.history.mark_read', {edition_id: 'library-1'});
    ok('Ben\'s write does not reach Ana', !(await ana.agent.call('dayline.history.list', {})).entries.some(e => e.edition.edition_id === 'library-1'));
    ok('Ana\'s saved recap does not reach Ben', (await ben.agent.call('dayline.saved.list', {})).entries.length === 0);

    // Retain Ana's snapshot before reset, then reset to the loaded data and clock.
    const beforeReset = await ana.infra.call('env.snapshot');
    observations.snapshot_before_reset = {account: 'dayline-ana', version: beforeReset.version, virtual_now: beforeReset.snapshot.virtual_now,
      editions: beforeReset.snapshot.data.editions.length, reading_list: beforeReset.snapshot.data.reading_list.map(s => s.edition_id),
      reading_history: beforeReset.snapshot.data.reading_history.map(h => h.edition_id),
      receipts: Object.keys(beforeReset.snapshot.receipts).length, audit_rows: beforeReset.snapshot.audit.length};
    equal('Reset returns ready', (await ana.infra.call('env.reset', {expected_version: beforeReset.version})).status, 'ready');
    const afterReset = (await ana.infra.call('env.snapshot')).snapshot;
    equal('Reset restores the loaded editions, history, bookmarks and front pages', afterReset.data, loadedAna.data);
    equal('Reset restores the loaded clock', afterReset.virtual_now, loadedAna.virtual_now);
    ok('Resetting Ana leaves Ben\'s history intact', (await ben.agent.call('dayline.history.list', {})).entries[0].edition.edition_id === 'library-1');

    const counts = {};
    for (const row of trace) {
      const key = row.duplicate ? 'duplicate_replay' : row.status;
      counts[key] = (counts[key] || 0) + 1;
    }
    console.log(JSON.stringify({
      app: 'dayline', package_sha256: packageSha256, runtime: require(path.join(runtime, 'package.json')).version,
      node: process.version, reader_time_zone: READER_TIME_ZONE, passed: true, checks,
      reference_replies: replies,
      reference_reply_sources: {
        morning_briefing: 'Assembled by code from each reader\'s front pages, reading history and credits.',
        family_travel: 'Hand-written wording. Outlet names come from dayline.edition.get; checks compare the facts with both editions.',
        sports: 'Hand-written wording. The edition ID comes from dayline.saved.add and the game time is converted from the schedule edition; checks reject any result.',
      },
      observations, management_call_example: managementCall,
      trace_summary: {calls: trace.length, by_outcome: counts, note: 'Duplicate replays are counted once as duplicate_replay; denials keep their status.'},
      trace,
    }, null, 2));
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
    fs.rmSync(temp, {recursive: true, force: true});
  }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
