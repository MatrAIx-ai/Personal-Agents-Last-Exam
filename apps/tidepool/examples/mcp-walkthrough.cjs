#!/usr/bin/env node
'use strict';
// Real-MCP walkthrough of the approved Tidepool workflows through the public runtime. Each family
// member's account is its own App instance loaded with the same family seed (Priya, Sam, Kai); Infra
// applies each scenario event to the instances that need it. A scripted reference agent answers the
// three example requests and the plan question from what its account can see; these replies are
// reference evidence for the data and tools, not model-agent trials. Prints a JSON evidence report
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
const plugin = require(path.join(pkg, 'plugin.cjs'));
const RUN = 'family-week';
const MIN = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
const MB = bytes => Math.round(bytes / 1e6) + ' MB';

async function main() {
  const packageSha256 = digestTree(pkg);
  const prepared = prepare(pkg);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tidepool-walkthrough-'));
  const clients = [], checks = [], trace = [], observations = {}, replies = {};
  let managementCall = null;
  const ok = (label, condition) => {assert.ok(condition, label); checks.push(label);};
  const equal = (label, actual, expected) => {assert.deepEqual(actual, expected, label); checks.push(label);};

  // Every call goes through here so the trace joins run, account, connection and request/event IDs.
  async function open(account, role, stateDir, label = path.basename(stateDir)) {
    const client = new Client('tidepool', role, RUN, stateDir, 'tidepool-walkthrough', {registry: prepared.registry});
    clients.push(client); await client.initialize();
    const connection = account + '/' + role + '#' + clients.length;
    return {
      raw: client,
      async call(name, args = {}) {
        const result = await client.call(name, args);
        trace.push({seq: trace.length + 1, run: RUN, instance: label, account, connection, tool: name,
          request_id: args.request_id ?? null, event_id: args.event?.event_id ?? null,
          status: result.status, duplicate: result.duplicate === true, version: result.version ?? null});
        return result;
      },
    };
  }
  async function instance(label, account, data, binding, policies, {virtualNow, dataset} = {}) {
    const stateDir = path.join(temp, label);
    const infra = await open(account, 'infra', stateDir), agent = await open(account, 'agent', stateDir);
    const s = await infra.call('env.snapshot');
    const bundle = copy(s.snapshot.resources.bundle);
    bundle.dataset = dataset ? copy(dataset) : {...bundle.dataset, expected_counts: {...bundle.dataset.expected_counts, records: plugin.records(data).length}};
    const loaded = await infra.call('env.load_seed', {expected_version: s.version, request_id: 'load-' + label, data, binding, policies, bundle,
      ...(virtualNow ? {virtual_now: virtualNow} : {})});
    assert.equal(loaded.status, 'ready', JSON.stringify(loaded));
    const me = data.members.find(m => m.person_id === data.owner_person_id).member_id;
    return {label, account, me, infra, agent, writes: 0};
  }
  const snap = async r => (await r.infra.call('env.snapshot')).snapshot;
  const version = async r => (await r.infra.call('env.snapshot')).version;
  async function write(r, name, args) {
    return r.agent.call(name, {...args, expected_version: await version(r), request_id: r.label + '-w' + (++r.writes)});
  }
  async function event(r, e) {
    return r.infra.call('env.apply_event', {expected_version: await version(r), event: e});
  }
  const advance = async (r, to) => r.infra.call('env.advance_time', {expected_version: await version(r), request_id: r.label + '-clock-' + to, virtual_now: to});
  const downloads = async r => (await r.agent.call('tidepool.downloads.list', {id: r.me, include_removed: true})).downloads;
  const newest = list => {const out = {}; for (const d of list) if (!(d.item_id in out)) out[d.item_id] = d.status; return out;};
  // family.get's counts for the signed-in member agree with downloads.list at the same clock.
  async function consistent(r) {
    const listed = (await r.agent.call('tidepool.downloads.list', {id: r.me})).downloads;
    const counts = (await r.agent.call('tidepool.family.get', {})).members.find(m => m.member_id === r.me).downloads;
    const expect = {queued: 0, downloaded: 0, needs_check: 0, bytes: 0};
    for (const d of listed) {expect[d.status]++; expect.bytes += d.bytes;}
    assert.deepEqual(counts, expect);
    return counts;
  }
  // A clock step with no event: reads change, no activity row is written, Core audits only the clock.
  async function timeOnly(r, to, label, inspect) {
    const before = await snap(r);
    const result = await advance(r, to);
    const after = await snap(r);
    equal(label + ': env.advance_time commits', [result.status, result.advanced], ['committed', true]);
    equal(label + ': business data and activity rows are unchanged', after.data, before.data);
    equal(label + ': Core audits only the clock change', after.audit.slice(before.audit.length).map(x => [x.tool, x.decision]), [['env.advance_time', 'allow']]);
    return inspect();
  }
  async function failedEvent(r, e, code, label) {
    const before = await snap(r);
    const result = await event(r, e);
    const after = await snap(r);
    equal(label + ': env.apply_event returns applied false with ' + code, [result.status, result.applied], [code, false]);
    const row = after.audit[after.audit.length - 1];
    equal(label + ': Core audit has a deny row with reason ' + code, [row.tool, row.decision, row.reason, row.trace.event_id], ['env.apply_event', 'deny', code, e.event_id]);
    equal(label + ': business data and clock are unchanged', [after.data, after.virtual_now], [before.data, before.virtual_now]);
    equal(label + ': env.event_status has no receipt', (await r.infra.call('env.event_status', {event_id: e.event_id})).receipt, null);
  }
  // A rejected write: the App error code, and business data and version exactly as before.
  async function control(r, name, args, code, label) {
    const before = await r.infra.call('env.snapshot');
    const result = await write(r, name, args);
    const after = await r.infra.call('env.snapshot');
    equal(label + ' returns ' + code + ' and changes nothing', [result.status, after.snapshot.data, after.version], [code, before.snapshot.data, before.version]);
  }
  // Activity rows join Core receipts on request_id / event_id; one row per committed write or event.
  async function joins(r) {
    const s = await snap(r);
    const mine = trace.filter(t => t.instance === r.label && t.status === 'committed' && !t.duplicate);
    const committed = mine.filter(t => t.connection.includes('/agent'));
    const events = mine.filter(t => t.tool === 'env.apply_event');
    const ownRows = s.data.activity;
    equal(r.label + ': one activity row per committed write', ownRows.filter(x => x.actor === 'agent').map(x => x.request_id), committed.map(t => t.request_id));
    equal(r.label + ': one activity row per applied event', ownRows.filter(x => x.actor === 'event').map(x => x.event_id), events.map(t => t.event_id));
    for (const row of ownRows) {
      const key = row.request_id ? 'request:' + row.request_id : 'event:' + row.event_id;
      assert.ok(s.receipts[key], 'receipt for ' + key);
    }
    ok(r.label + ': every activity row joins a Core receipt by request_id or event_id', true);
    return {activity_rows: ownRows.length, agent_rows: committed.length, event_rows: events.length};
  }

  try {
    const minimal = load('fixtures/minimal.json'), binding = load('fixtures/binding.json'), writePolicies = load('examples/task-data/policies.json');
    const as = key => ({...copy(minimal), account_id: 'tidepool-' + key, owner_person_id: 'person-' + key});
    const ev = id => load('examples/events/' + id + '.json');
    const scenario = load('examples/scenario.json');

    // ------------------------------------------------------------ package defaults
    const defaultDir = path.join(temp, 'default');
    await open('tidepool-priya', 'infra', defaultDir); // Infra initializes a run before an Agent connects.
    const defaultAgent = await open('tidepool-priya', 'agent', defaultDir);
    const defaultTools = (await defaultAgent.raw.request('tools/list')).result.tools;
    ok('Default scenario policy exposes the 16 read tools only', defaultTools.length === 16 && defaultTools.every(t => t.annotations.readOnlyHint));
    equal('Default policy denies writes', (await defaultAgent.call('tidepool.library.save', {id: 'mem-priya', item_type: 'track', item_id: 'tr-juno-01',
      expected_version: {epoch: 1, revision: 0}, request_id: 'denied-save'})).status, 'permission_denied');
    equal('Agent cannot inject events', (await defaultAgent.call('env.apply_event', {})).status, 'permission_denied');
    equal('Agent cannot advance the clock', (await defaultAgent.call('env.advance_time', {})).status, 'permission_denied');

    // ------------------------------------------------------------ instances: Priya, Sam, Kai
    const priya = await instance('priya', 'tidepool-priya', minimal, binding, writePolicies);
    const sam = await instance('sam', 'tidepool-sam', as('sam'), binding, writePolicies);
    const kai = await instance('kai', 'tidepool-kai', as('kai'), binding, writePolicies);
    const loadedPriya = await snap(priya);
    const writeTools = (await priya.agent.raw.request('tools/list')).result.tools;
    ok('Task policy exposes all 33 tidepool.* tools', writeTools.length === 33 && writeTools.every(t => t.name.startsWith('tidepool.')));

    // ------------------------------------------------------------ W2: the kitchen speaker, under Priya's account
    const beforeKitchen = await snap(priya);
    const kitchenArgs = {expected_version: await version(priya), event: scenario};
    managementCall = {method: 'tools/call', params: {name: 'env.apply_event', arguments: copy(kitchenArgs)}};
    equal('priya: kitchen-fieldnotes-113 (approved example) commits', (await priya.infra.call('env.apply_event', kitchenArgs)).status, 'committed');
    equal('sam: the same event commits on Sam\'s instance', (await event(sam, scenario)).status, 'committed');
    const afterKitchen = await snap(priya);
    const changed = afterKitchen.data.progress.filter(p => JSON.stringify(p) !== JSON.stringify(beforeKitchen.data.progress.find(q => q.member_id === p.member_id && q.episode_id === p.episode_id)));
    equal('Kitchen-speaker listening.record changes only Priya\'s progress on 113', changed.map(p => [p.member_id, p.episode_id, p.state]), [['mem-priya', 'ep-fieldnotes-113', 'played']]);
    equal('Sam\'s stored progress on 113 is untouched', afterKitchen.data.progress.find(p => p.member_id === 'mem-sam' && p.episode_id === 'ep-fieldnotes-113'),
      beforeKitchen.data.progress.find(p => p.member_id === 'mem-sam' && p.episode_id === 'ep-fieldnotes-113'));
    equal('Sam\'s own account still reads 113 in progress at 600 s', (await sam.agent.call('tidepool.progress.get', {id: 'mem-sam', episode_ids: ['ep-fieldnotes-113']})).progress[0].position_s, 600);
    ok('Sam\'s history has no kitchen-speaker sessions', !(await sam.agent.call('tidepool.history.list', {id: 'mem-sam', limit: 200})).sessions.some(s => s.device_id === 'dev-kitchen-speaker'));
    equal('The event moves the clock to its time', afterKitchen.virtual_now, scenario.at);
    const committedVersion = await version(priya);
    const replay = await priya.infra.call('env.apply_event', kitchenArgs);
    ok('Resending byte-identical env.apply_event arguments is a duplicate with no new version',
      replay.duplicate === true && JSON.stringify(await version(priya)) === JSON.stringify(committedVersion) && JSON.stringify(replay.version) === JSON.stringify(committedVersion));
    const conflict = copy(scenario); conflict.payload.end_position_s = 1200;
    equal('Reusing an event ID with different content is an idempotency conflict', (await event(priya, conflict)).status, 'idempotency_conflict');
    for (const r of [priya, kai]) equal(r.label + ': family-car-noor-add commits', (await event(r, ev('family-car-noor-add'))).status, 'committed');
    equal('kitchen-fieldnotes-114 commits', (await event(priya, ev('kitchen-fieldnotes-114'))).status, 'committed');
    await advance(priya, '2026-11-24T21:00:00-08:00');

    // ------------------------------------------------------------ Example request 1: commute on earbuds
    const me = (await priya.agent.call('tidepool.members.list', {})).members.find(m => m.is_you);
    equal('members.list marks Priya as the signed-in member', me.member_id, 'mem-priya');
    const history = (await priya.agent.call('tidepool.history.list', {id: 'mem-priya', limit: 10})).sessions;
    const kitchen = history.filter(s => s.device_id === 'dev-kitchen-speaker' && s.started_at >= '2026-11-24');
    equal('Priya\'s history shows the two kitchen sessions tonight', kitchen.map(s => s.item_id), ['ep-fieldnotes-114', 'ep-fieldnotes-113']);
    const halfway = history.find(s => s.device_id === 'dev-priya-earbuds' && s.end_reason === 'paused');
    const p112 = (await priya.agent.call('tidepool.progress.get', {id: 'mem-priya', episode_ids: [halfway.item_id]})).progress[0];
    equal('The episode she stopped on her earbuds is 112 at 31:10', [halfway.item_id, p112.state, MIN(p112.position_s)], ['ep-fieldnotes-112', 'in_progress', '31:10']);
    const item112 = (await priya.agent.call('tidepool.catalog.get_item', {item_id: 'ep-fieldnotes-112'})).item;
    equal('catalog.get_item shows 112 with chapters, its end marker and Priya\'s position', [item112.chapters.length, item112.end_of_content_s < item112.duration_s, item112.progress.position_s], [3, true, 1870]);
    equal('An unknown catalog ID returns not_found', (await priya.agent.call('tidepool.catalog.get_item', {item_id: 'tr-missing'})).status, 'not_found');
    const harbor = (await priya.agent.call('tidepool.shows.get_episodes', {show_id: 'show-harborhours', limit: 1})).episodes[0];
    equal('The new Harbor Hours episode is 52 minutes', [harbor.episode_id, harbor.duration_s / 60], ['ep-harborhours-088', 52]);
    const queue = await priya.agent.call('tidepool.upnext.get', {id: 'mem-priya'});
    const upArgs = {id: 'mem-priya', episode_ids: ['ep-fieldnotes-112', 'ep-harborhours-088', ...queue.entries.map(e => e.episode_id).filter(id => !['ep-fieldnotes-112', 'ep-harborhours-088'].includes(id))],
      expected_list_version: queue.list_version, expected_version: await version(priya), request_id: 'priya-upnext'};
    const setQueue = await priya.agent.call('tidepool.upnext.set', upArgs);
    equal('upnext.set commits list version 2', [setQueue.status, setQueue.list_version], ['committed', 2]);
    ok('An identical retry of upnext.set is a duplicate', (await priya.agent.call('tidepool.upnext.set', upArgs)).duplicate === true);
    equal('Reusing the request ID with another list is an idempotency conflict', (await priya.agent.call('tidepool.upnext.set', {...upArgs, episode_ids: ['ep-harborhours-088']})).status, 'idempotency_conflict');
    equal('A stale expected_version is rejected', (await priya.agent.call('tidepool.upnext.set', {...upArgs, request_id: 'priya-upnext-stale', expected_list_version: 2})).status, 'stale_version');
    equal('A stale Up Next list version is rejected', (await write(priya, 'tidepool.upnext.set', {id: 'mem-priya', episode_ids: [], expected_list_version: 1})).status, 'list_version_mismatch');
    const phone = (await priya.agent.call('tidepool.devices.list', {id: 'mem-priya'})).devices.find(d => d.device_id === 'dev-priya-phone');
    ok('Her phone has about 300 MB free (' + MB(phone.free_bytes) + ')', Math.abs(phone.free_bytes - 300e6) < 5e6);
    const follows = (await priya.agent.call('tidepool.follows.list', {id: 'mem-priya'})).follows;
    equal('Auto-download is off for Harbor Hours on her account', follows.find(f => f.show_id === 'show-harborhours').auto_download_count, 0);
    const got = [];
    for (const item_id of ['ep-fieldnotes-112', 'ep-harborhours-088']) got.push(await write(priya, 'tidepool.downloads.add', {id: 'mem-priya', device_id: 'dev-priya-phone', item_type: 'episode', item_id}));
    equal('Both downloads are queued with space reserved', got.map(d => [d.status, d.download_status]), [['committed', 'queued'], ['committed', 'queued']]);
    const queuedCounts = await consistent(priya);
    const done = await timeOnly(priya, '2026-11-24T21:01:00-08:00', 'Download completion', async () => {
      const s = newest(await downloads(priya));
      return {s, counts: await consistent(priya)};
    });
    equal('At their completion time both read as downloaded', [done.s['ep-fieldnotes-112'], done.s['ep-harborhours-088']], ['downloaded', 'downloaded']);
    equal('family.get and downloads.list agree before and after completion', [queuedCounts.queued, done.counts.queued, done.counts.downloaded - queuedCounts.downloaded], [2, 0, 2]);
    const up = await priya.agent.call('tidepool.upnext.get', {id: 'mem-priya'});
    const firstTwo = up.entries.slice(0, 2), runtime1x = firstTwo.reduce((s, e) => s + e.remaining_s, 0);
    const p113 = (await priya.agent.call('tidepool.progress.get', {id: 'mem-priya', episode_ids: ['ep-fieldnotes-113', 'ep-fieldnotes-114']})).progress;
    equal('Played state from the kitchen sessions is left as it was', p113.map(p => p.state), ['played', 'played']);
    replies.commute = 'Up Next now starts with Field Notes 112 at ' + MIN(firstTwo[0].position_s) + ' (' + MIN(firstTwo[0].remaining_s) + ' left), then the new Harbor Hours episode (' +
      MIN(firstTwo[1].remaining_s) + '). Both are downloaded to your phone, so they will play without signal. Together they run ' + MIN(runtime1x) +
      ' at 1x, longer than your 40-minute ride, so Harbor Hours will carry over to the trip home. Note: the kitchen speaker played Field Notes 113 and 114 under your account this evening, so they show as played; I left them that way. Want me to mark them unplayed?';
    ok('Commute reply: 112 at 31:10 first, both downloaded, runs past 40 minutes, kitchen played state untouched',
      /Field Notes 112 at 31:10/.test(replies.commute) && /downloaded to your phone/.test(replies.commute) && runtime1x > 40 * 60 && /left them that way/.test(replies.commute));

    // Next morning she finishes 112 on the train; its download is now due for auto-delete in two days.
    equal('Priya finishes 112 on the morning train (train-fieldnotes-112-end)', (await event(priya, ev('train-fieldnotes-112-end'))).status, 'committed');
    equal('The 112 download is due for auto-delete two days after she played it',
      (await priya.agent.call('tidepool.downloads.list', {id: 'mem-priya'})).downloads.find(d => d.item_id === 'ep-fieldnotes-112').auto_delete_at, '2026-11-27T08:00:00-08:00');

    // ------------------------------------------------------------ Example request 2: a clean road-trip playlist
    const roadtrip = ev('roadtrip-noor-add-1');
    await failedEvent(priya, roadtrip, 'target_not_found', 'playlist.edit before "Road trip" exists');
    const ideas = (await priya.agent.call('tidepool.playlists.list', {id: 'mem-priya'})).playlists.find(p => p.owner_member_id === 'mem-sam');
    const sams = (await priya.agent.call('tidepool.playlists.get', {id: 'mem-priya', playlist_id: ideas.playlist_id})).playlist.tracks;
    const picks = sams.filter(t => !t.explicit || t.clean_version_id).map(t => t.explicit ? t.clean_version_id : t.track_id);
    const leftOut = sams.filter(t => t.explicit && !t.clean_version_id);
    const created = await write(priya, 'tidepool.playlists.create', {id: 'mem-priya', name: 'Road trip', description: 'Thanksgiving drive. Add songs Kai can hear too.',
      visibility: 'collaborative', collaborators: ['mem-sam', 'mem-noor', 'mem-kai'], track_ids: picks});
    equal('Agent creates the collaborative "Road trip" owned by Priya', [created.status, created.owner_member_id, created.collaborators, created.track_count],
      ['committed', 'mem-priya', ['mem-sam', 'mem-noor', 'mem-kai'], 5]);
    const retried = await event(priya, roadtrip);
    equal('The same event_id retried after the playlist exists commits', [retried.status, retried.event_id], ['committed', 'roadtrip-noor-add-1']);
    const road = (await priya.agent.call('tidepool.playlists.get', {id: 'mem-priya', playlist_id: created.playlist_id})).playlist;
    equal('Noor\'s track lands at position 4 with her as author and one new version', [road.track_version, road.tracks[3].track_id, road.tracks[3].added_by, road.tracks[3].explicit],
      [2, 'tr-saltline-07', 'mem-noor', true]);
    const notice = (await priya.agent.call('tidepool.notifications.list', {id: 'mem-priya', limit: 1})).notifications[0];
    equal('A notice is written for Priya', [notice.kind, notice.object_id, notice.event_id], ['playlist_edited', created.playlist_id, 'roadtrip-noor-add-1']);
    const swap = await write(priya, 'tidepool.playlists.update_tracks', {id: 'mem-priya', playlist_id: created.playlist_id, expected_track_version: road.track_version,
      operations: [{op: 'remove', track_id: 'tr-saltline-07'}, {op: 'add', track_id: road.tracks[3].clean_version_id, position: 4}]});
    equal('The agent replaces Noor\'s explicit addition with its clean version in place', [swap.status, swap.track_ids[3]], ['committed', 'tr-saltline-07c']);
    const kaiFilter = (await priya.agent.call('tidepool.members.list', {})).members.find(m => m.member_id === 'mem-kai').explicit_filter;
    equal('Kai\'s explicit filter is unchanged', kaiFilter, true);
    replies.road_trip = 'Created "Road trip" (owner: you; Sam, Noor and Kai can add songs). From Sam\'s ideas I used the clean versions of ' +
      sams.filter(t => t.explicit && t.clean_version_id).map(t => t.title).join(' and ') + ', kept the other three, and left out ' + leftOut.map(t => t.title).join(', ') +
      ' because it has no clean version. On ' + roadtrip.at.slice(0, 10) + ' Noor added "' + road.tracks[3].title + '", which is explicit; I swapped in its clean version in the same spot. Kai\'s explicit filter is still on.';
    ok('Road-trip reply names the clean swaps, the left-out track and Noor\'s replaced addition', /clean versions/.test(replies.road_trip) && /left out/.test(replies.road_trip) && /Noor added/.test(replies.road_trip));
    // The other two lookup failures.
    await write(priya, 'tidepool.playlists.create', {id: 'mem-priya', name: ' road TRIP ', visibility: 'private'});
    await failedEvent(priya, {...copy(roadtrip), event_id: 'roadtrip-noor-add-2'}, 'ambiguous_target', 'Two of Priya\'s playlists named "road trip"');
    await failedEvent(priya, {...copy(roadtrip), event_id: 'focus-noor-add', payload: {playlist_id: 'pl-priya-focus', author_member_id: 'mem-noor',
      operations: [{op: 'add', track_id: 'tr-saltline-07'}]}}, 'not_collaborator', 'Noor editing Priya\'s private playlist');


    // ------------------------------------------------------------ W5: invitations, plan limits, member removal
    const invite = await write(priya, 'tidepool.members.invite', {id: 'person-ana'});
    equal('Priya invites Ana; the invitation holds a slot', [invite.status, invite.invitation_status, invite.slots.open_invitations, invite.slots.available], ['committed', 'open', 1, 1]);
    equal('Inviting Ana again returns already_invited', (await write(priya, 'tidepool.members.invite', {id: 'person-ana'})).status, 'already_invited');
    equal('Inviting Sam returns already_member', (await write(priya, 'tidepool.members.invite', {id: 'person-sam'})).status, 'already_member');
    equal('Ana declines by event', (await event(priya, ev('invite-ana-decline'))).status, 'committed');
    equal('The declined invitation frees its slot', (await priya.agent.call('tidepool.family.get', {})).slots.available, 2);
    await failedEvent(priya, {...ev('invite-ana-decline'), event_id: 'ana-no-invite', at: '2026-11-26T20:30:00-08:00'}, 'target_not_found', 'A response with no open invitation');
    await write(priya, 'tidepool.members.invite', {id: 'person-ana'});
    // ------------------------------------------------------------ auto-delete window, by time alone
    const del = await timeOnly(priya, '2026-11-27T08:00:00-08:00', 'Auto-delete window', async () => ({s: newest(await downloads(priya)), counts: await consistent(priya)}));
    equal('Field Notes 112 (played on the train, auto-delete after 2 days) is removed; Harbor Hours 88 stays', [del.s['ep-fieldnotes-112'], del.s['ep-harborhours-088']], ['removed', 'downloaded']);
    equal('family.get reflects the auto-delete', del.counts.downloaded, done.counts.downloaded - 1);
    equal('Ana accepts by event (approved example)', (await event(priya, ev('invite-ana-accept'))).status, 'committed');
    const fam = await priya.agent.call('tidepool.family.get', {});
    equal('Ana is an active member', fam.members.find(m => m.person_id === 'person-ana').status, 'active');
    const duo = (await priya.agent.call('tidepool.plan.preview_change', {plan_id: 'duo'})).quote;
    equal('Family -> Duo is quoted as refused for five members', [duo.allowed, duo.blocked_by, duo.members_counted], [false, 'too_many_members', 5]);
    equal('Family -> Duo is refused on confirm', (await write(priya, 'tidepool.plan.confirm_change', {id: 'mem-priya', plan_id: 'duo'})).status, 'too_many_members');
    equal('No plan change to revoke', (await write(priya, 'tidepool.plan.revoke_change', {id: 'mem-priya'})).status, 'no_pending_change');
    equal('plan.confirm_change naming another member returns forbidden', (await write(priya, 'tidepool.plan.confirm_change', {id: 'mem-sam', plan_id: 'duo'})).status, 'forbidden');
    const shown = fam.members.find(m => m.member_id === 'mem-noor').if_removed;
    const removed = await write(priya, 'tidepool.members.remove', {id: 'mem-noor'});
    const returned = Object.fromEntries(Object.keys(shown).map(k => [k, removed[k]]));
    equal('members.remove returns the counts family.get showed beforehand (all six fields)', [Object.keys(shown).length, returned], [6, shown]);
    equal('Noor\'s removal ends 2 collaborations and hides her shared playlist from the family', [shown.collaborations_ended, shown.owned_playlist_ids], [2, ['pl-noor-after-school']]);
    ok('Her shared playlist has left Priya\'s view', !(await priya.agent.call('tidepool.playlists.list', {id: 'mem-priya'})).playlists.some(p => p.playlist_id === 'pl-noor-after-school'));
    observations.member_removal = {member_id: 'mem-noor', family_get_if_removed: shown, members_remove_result: returned};
    replies.family_plan = 'Ana is in: she accepted and is now a member, so the family uses ' + (fam.slots.active_members) + ' of 6 Family slots. ' +
      'Duo is not possible: it allows 2 members and the family has ' + duo.members_counted + '. ' +
      'Removing Noor ended ' + removed.downloads_removed + ' downloads (' + MB(removed.bytes_freed) + ') and her editing access to ' + removed.collaborations_ended + ' shared playlist' + (removed.collaborations_ended === 1 ? '' : 's') +
      ', and her own shared playlist "After school" is no longer visible to the family.';
    observations.priya_joins = await joins(priya);

    // ------------------------------------------------------------ Sam's account and Kai's account
    equal('Sam\'s account changing Kai\'s filter returns forbidden', (await write(sam, 'tidepool.filters.update', {id: 'mem-kai', patch: {explicit_filter: false}})).status, 'forbidden');
    equal('Sam\'s account cannot read Priya\'s history', (await sam.agent.call('tidepool.history.list', {id: 'mem-priya'})).status, 'forbidden');
    // Sam manages his own follows, library and playlist through his account.
    equal('Sam follows Kettle Theory', (await write(sam, 'tidepool.follows.add', {id: 'mem-sam', show_id: 'show-kettletheory', auto_download_count: 1})).changed, true);
    const samSettings = await write(sam, 'tidepool.follows.update_settings', {id: 'mem-sam', show_id: 'show-kettletheory', patch: {auto_delete_days: 3}});
    equal('Sam sets auto-delete, getting the replaced settings back', [samSettings.status, samSettings.replaced], ['committed', {auto_download_count: 1, auto_delete_days: null}]);
    equal('Sam unfollows Overtime Almanac and keeps its download', (await write(sam, 'tidepool.follows.remove', {id: 'mem-sam', show_id: 'show-overtimealmanac'})).downloads_kept, 1);
    equal('Sam saves an album', (await write(sam, 'tidepool.library.save', {id: 'mem-sam', item_type: 'album', item_id: 'alb-marrow-2'})).status, 'committed');
    equal('Sam unsaves a track', (await write(sam, 'tidepool.library.unsave', {id: 'mem-sam', item_type: 'track', item_id: 'tr-tamsin-04'})).saved, false);
    const renamed = await write(sam, 'tidepool.playlists.update_settings', {id: 'mem-sam', playlist_id: 'pl-road-trip-ideas', patch: {name: 'Road trip ideas (Thanksgiving)'}});
    equal('Sam, as owner, renames his shared playlist', [renamed.status, renamed.name, renamed.replaced], ['committed', 'Road trip ideas (Thanksgiving)', {name: 'Road trip ideas'}]);
    observations.sam_joins = await joins(sam);
    const kaiSearch = (await kai.agent.call('tidepool.catalog.search', {query: 'Gutterglow', item_type: 'track', limit: 50})).results;
    const filtered = kaiSearch.filter(t => t.explicit);
    ok('Kai\'s search marks explicit tracks filtered', filtered.length > 0 && filtered.every(t => t.filtered));
    ok('Kai\'s search returns each filtered track\'s clean version next to it',
      filtered.filter(t => t.clean_version_id).every(t => kaiSearch[kaiSearch.indexOf(t) + 1].track_id === t.clean_version_id));
    const kaiCar = (await kai.agent.call('tidepool.playlists.get', {id: 'mem-kai', playlist_id: 'pl-family-car'})).playlist;
    equal('Kai\'s account skips the explicit track Noor added; it stays in the playlist', kaiCar.tracks.filter(t => t.skipped_for_you).map(t => [t.track_id, t.added_by]), [['tr-gutterglow-04', 'mem-noor']]);
    equal('A collaborator changing visibility returns forbidden', (await write(kai, 'tidepool.playlists.update_settings', {id: 'mem-kai', playlist_id: 'pl-family-car',
      patch: {visibility: 'private'}})).status, 'forbidden');
    replies.kai_search = 'Gutterglow Kids: ' + filtered.filter(t => t.clean_version_id).length + ' explicit tracks have clean versions you can play; ' +
      filtered.filter(t => !t.clean_version_id).length + ' (' + filtered.filter(t => !t.clean_version_id).map(t => t.title).join(', ') + ') has none and stays filtered on your account.';

    // ------------------------------------------------------------ per-member narrowing through Core policy
    const narrow = await instance('narrow', 'tidepool-priya', minimal, binding, load('examples/policies/narrow-members.json'));
    equal('Policy narrowing: filters.update for Noor is permission_denied', (await write(narrow, 'tidepool.filters.update', {id: 'mem-noor', patch: {explicit_filter: true}})).status, 'permission_denied');
    equal('Policy narrowing: filters.update for Kai commits', (await write(narrow, 'tidepool.filters.update', {id: 'mem-kai', patch: {explicit_filter: true}})).status, 'committed');
    equal('Policy narrowing: members.remove for anyone is permission_denied', (await write(narrow, 'tidepool.members.remove', {id: 'mem-noor'})).status, 'permission_denied');
    equal('Policy narrowing: plan.confirm_change (now taking id) is permission_denied', (await write(narrow, 'tidepool.plan.confirm_change', {id: 'mem-priya', plan_id: 'individual'})).status, 'permission_denied');
    const narrowAudit = (await snap(narrow)).audit.filter(x => x.decision === 'deny').map(x => [x.tool, x.reason, x.input.id]);
    equal('Core audit records the policy denials with the member id', narrowAudit, [['tidepool.filters.update', 'permission_denied', 'mem-noor'], ['tidepool.members.remove', 'permission_denied', 'mem-noor'], ['tidepool.plan.confirm_change', 'permission_denied', 'mem-priya']]);

    // ------------------------------------------------------------ Example request 3: before a flight (fresh instance at 21:00)
    const trip = await instance('trip', 'tidepool-priya', minimal, binding, writePolicies, {virtualNow: '2026-11-24T21:00:00-08:00'});
    // W2 main path over MCP: a session to the end marks 112 played; the agent sets it back to 31:10.
    equal('A listening.record to the end of 112 commits', (await event(trip, ev('train-fieldnotes-112-end'))).status, 'committed');
    equal('112 now reads played for Priya', (await trip.agent.call('tidepool.progress.get', {id: 'mem-priya', episode_ids: ['ep-fieldnotes-112']})).progress[0].state, 'played');
    const sessionsBefore = (await snap(trip)).data.sessions.length;
    const back = await write(trip, 'tidepool.progress.set', {id: 'mem-priya', episode_id: 'ep-fieldnotes-112', state: 'in_progress', position_s: 1870});
    equal('progress.set back to 31:10 records set_by agent and the replaced value', [back.status, back.position_s, back.set_by, back.replaced],
      ['committed', 1870, 'agent', {state: 'played', position_s: 0}]);
    const backRow = (await snap(trip)).data;
    equal('progress.set adds no session and its activity row keeps the replaced value', [backRow.sessions.length, backRow.activity[backRow.activity.length - 1].replaced],
      [sessionsBefore, {state: 'played', position_s: 0}]);
    await control(trip, 'tidepool.progress.set', {id: 'mem-priya', episode_id: 'ep-fieldnotes-112', state: 'in_progress', position_s: 2521}, 'invalid_position', 'A position beyond the duration');
    await control(trip, 'tidepool.progress.set', {id: 'mem-priya', episode_id: 'ep-fieldnotes-999', state: 'played'}, 'not_found', 'An unknown episode');
    const queueVersion = (await trip.agent.call('tidepool.upnext.get', {id: 'mem-priya'})).list_version;
    await control(trip, 'tidepool.upnext.set', {id: 'mem-priya', episode_ids: ['ep-lanternledger-003'], expected_list_version: queueVersion}, 'unavailable', 'Queueing a removed episode');
    // The reference agent first tries the queue and both albums: the second album does not fit.
    const tripQueue = (await trip.agent.call('tidepool.upnext.get', {id: 'mem-priya'})).entries;
    const albums = (await trip.agent.call('tidepool.library.list', {id: 'mem-priya', item_type: 'album'})).items;
    equal('Two saved albums', albums.length, 2);
    for (const e of tripQueue) await write(trip, 'tidepool.downloads.add', {id: 'mem-priya', device_id: 'dev-priya-phone', item_type: 'episode', item_id: e.episode_id});
    equal('Album ' + albums[0].item_id + ' fits', (await write(trip, 'tidepool.downloads.add', {id: 'mem-priya', device_id: 'dev-priya-phone', item_type: 'album', item_id: albums[0].item_id})).status, 'committed');
    await control(trip, 'tidepool.downloads.add', {id: 'mem-priya', device_id: 'dev-priya-phone', item_type: 'album', item_id: albums[1].item_id}, 'storage_full', 'The second album before any removal');
    const followed = new Set((await trip.agent.call('tidepool.follows.list', {id: 'mem-priya'})).follows.map(f => f.show_id));
    const list = (await trip.agent.call('tidepool.downloads.list', {id: 'mem-priya', device_id: 'dev-priya-phone'})).downloads;
    const stale = list.filter(d => d.item_type === 'episode' && d.played && !followed.has(minimal.episodes.find(e => e.episode_id === d.item_id).show_id));
    equal('Played downloads from the two unfollowed shows', [...new Set(stale.map(d => d.context_title))].sort(), ['Overtime Almanac', 'Static & Signal']);
    let freed = 0;
    for (const d of stale) freed += (await write(trip, 'tidepool.downloads.remove', {id: 'mem-priya', download_id: d.download_id})).bytes_freed;
    equal('After the removals the second album downloads', (await write(trip, 'tidepool.downloads.add', {id: 'mem-priya', device_id: 'dev-priya-phone', item_type: 'album', item_id: albums[1].item_id})).status, 'committed');
    const tripPhone = (await trip.agent.call('tidepool.devices.list', {id: 'mem-priya'})).devices.find(d => d.device_id === 'dev-priya-phone');
    const tripFamily = await trip.agent.call('tidepool.family.get', {});
    const tripDuo = (await trip.agent.call('tidepool.plan.preview_change', {plan_id: 'duo'})).quote;
    const dueLocal = new Date(tripPhone.offline_check_due_at).toLocaleString('en-US', {timeZone: 'America/Los_Angeles', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit'});
    replies.before_flight = 'Removed ' + stale.length + ' played episodes of Overtime Almanac and Static & Signal, which you no longer follow (' + MB(freed) + '). Downloaded your ' +
      tripQueue.length + ' Up Next episodes and both saved albums to your phone. Your phone last checked in 24 days ago: downloads need it online by ' + dueLocal +
      ' Pacific, which falls during your trip, so connect to Wi-Fi once in Lisbon. The plan stays Family (' + '$' + (tripFamily.plan.monthly_price_cents / 100).toFixed(2) +
      '/month): the ' + tripFamily.slots.available + ' unused slots carry no separate charge, and Duo allows only ' + tripDuo.new_limit + ' of your ' + tripDuo.members_counted + ' members.';
    ok('Before-flight reply: removal, downloads, the day-30 check during the trip, plan stays Family with no charge for unused slots',
      stale.length === 15 && /November 30/.test(dueLocal) && tripFamily.plan.plan_id === 'family' && tripFamily.slots.available === 2 && !tripDuo.allowed);
    // 30-day offline check, then period end, by time alone.
    const offline = await timeOnly(trip, '2026-11-30T19:00:00-08:00', '30-day offline check', async () => ({rows: (await trip.agent.call('tidepool.downloads.list', {id: 'mem-priya', device_id: 'dev-priya-phone'})).downloads,
      counts: await consistent(trip)}));
    ok('Past the 30-day check every phone download reads needs_check', offline.rows.length > 0 && offline.rows.every(d => d.status === 'needs_check' && d.status_reasons.includes('offline_check_overdue')));
    equal('family.get counts the needs_check downloads', offline.counts.needs_check, offline.rows.length);
    const period = await timeOnly(trip, '2026-12-03T09:00:00-08:00', 'Billing period end', async () => {
      equal('Billing period end: family.get and downloads.list still agree', await consistent(trip), offline.counts);
      return (await trip.agent.call('tidepool.family.get', {})).billing;
    });
    equal('After period end with no payment event: new period, Family, invoice pending, account active',
      [period.period_start, period.current_invoice.invoice_id, period.current_invoice.plan_id, period.current_invoice.amount_cents, period.current_invoice.status, period.status],
      ['2026-12-03T00:00:00-08:00', 'inv-2026-12-03', 'family', 1799, 'pending', 'active']);
    observations.trip_joins = await joins(trip);

    // ------------------------------------------------------------ W5 billing on the second family (task data, loaded directly)
    const leila = await instance('leila', 'tidepool-leila', load('examples/task-data/seed.json'), load('examples/task-data/binding.json'), writePolicies,
      {dataset: load('examples/task-data/dataset.json')});
    const lb = (await leila.agent.call('tidepool.family.get', {})).billing;
    equal('Leila\'s account has payment due within its grace period', [lb.status, lb.payment_due.grace_ends_at, lb.payment_due.grace_expired], ['payment_due', '2026-11-27T09:00:00-05:00', false]);
    equal('An upgrade is refused while payment is due', (await write(leila, 'tidepool.plan.confirm_change', {id: 'mem-leila', plan_id: 'duo'})).status, 'payment_due');
    const grace = await timeOnly(leila, '2026-11-27T09:00:00-05:00', 'Payment grace period end', async () => ({billing: (await leila.agent.call('tidepool.family.get', {})).billing,
      rows: (await leila.agent.call('tidepool.downloads.list', {id: 'mem-leila'})).downloads, counts: await consistent(leila)}));
    ok('After the grace period downloads read needs_check and family.get says grace expired',
      grace.billing.payment_due.grace_expired && grace.rows.every(d => d.status === 'needs_check' && d.status_reasons.includes('payment_grace_expired')) && grace.counts.needs_check === grace.rows.length);
    equal('New downloads wait for payment', (await write(leila, 'tidepool.downloads.add', {id: 'mem-leila', device_id: 'dev-leila-phone', item_type: 'track', item_id: 'tr-juno-01'})).status, 'payment_due');
    equal('Payment succeeds by event', (await event(leila, load('examples/task-data/events/leila-november-paid.json'))).status, 'committed');
    ok('Downloads are available again', (await leila.agent.call('tidepool.downloads.list', {id: 'mem-leila'})).downloads.every(d => d.status === 'downloaded'));
    await advance(leila, '2026-11-28T10:05:00-05:00');
    const quote = (await leila.agent.call('tidepool.plan.preview_change', {plan_id: 'duo'})).quote;
    const upgrade = await write(leila, 'tidepool.plan.confirm_change', {id: 'mem-leila', plan_id: 'duo'});
    equal('Upgrade applies at once; the charge equals the quote (221 cents prorated onto the next invoice)',
      [upgrade.status, upgrade.plan_id, upgrade.proration_cents, upgrade.next_invoice], ['committed', 'duo', 221, quote.next_invoice]);
    const downgrade = await write(leila, 'tidepool.plan.confirm_change', {id: 'mem-leila', plan_id: 'individual'});
    equal('Downgrade is scheduled for period end', [downgrade.change, downgrade.effective_at, downgrade.next_invoice.amount_cents], ['downgrade', '2026-12-15T00:00:00-05:00', 1320]);
    equal('The scheduled downgrade can be revoked', (await write(leila, 'tidepool.plan.revoke_change', {id: 'mem-leila'})).revoked.plan_id, 'individual');
    equal('Revoking again returns no_pending_change', (await write(leila, 'tidepool.plan.revoke_change', {id: 'mem-leila'})).status, 'no_pending_change');
    await write(leila, 'tidepool.plan.confirm_change', {id: 'mem-leila', plan_id: 'individual'});
    const keep = await write(leila, 'tidepool.plan.confirm_change', {id: 'mem-leila', plan_id: 'duo'});
    equal('Choosing the plan in effect keeps it and revokes the scheduled downgrade', [keep.status, keep.change, keep.scheduled_change, keep.revoked_change.plan_id], ['committed', 'none', null, 'individual']);
    equal('Choosing it again, with nothing scheduled, is refused', (await write(leila, 'tidepool.plan.confirm_change', {id: 'mem-leila', plan_id: 'duo'})).status, 'invalid_arguments');
    await write(leila, 'tidepool.plan.confirm_change', {id: 'mem-leila', plan_id: 'individual'});
    const leilaCounts = await consistent(leila);
    const rolled = await timeOnly(leila, '2026-12-15T09:00:00-05:00', 'Period end with a downgrade', async () => {
      equal('Period end with a downgrade: family.get and downloads.list still agree', await consistent(leila), leilaCounts);
      return leila.agent.call('tidepool.family.get', {});
    });
    equal('After period end the downgrade is in effect and the new invoice bills Individual plus the proration',
      [rolled.plan.plan_id, rolled.billing.current_invoice.invoice_id, rolled.billing.current_invoice.amount_cents, rolled.billing.current_invoice.status, rolled.billing.status],
      ['individual', 'inv-2026-12-15', 1320, 'pending', 'active']);
    observations.billing_examples = {upgrade_quote: quote, upgrade_receipt_version: upgrade.version, after_period_end: rolled.billing};
    observations.leila_joins = await joins(leila);

    // ------------------------------------------------------------ snapshot before reset, then reset
    const beforeReset = await priya.infra.call('env.snapshot');
    observations.snapshot_before_reset = {account: 'tidepool-priya', version: beforeReset.version, virtual_now: beforeReset.snapshot.virtual_now,
      members: beforeReset.snapshot.data.members.map(m => m.member_id + ':' + m.status), playlists: beforeReset.snapshot.data.playlists.length,
      activity_rows: beforeReset.snapshot.data.activity.length, receipts: Object.keys(beforeReset.snapshot.receipts).length, audit_rows: beforeReset.snapshot.audit.length};
    equal('Reset returns ready', (await priya.infra.call('env.reset', {expected_version: beforeReset.version})).status, 'ready');
    const afterReset = await snap(priya);
    equal('Reset restores the loaded family, history and catalog', afterReset.data, loadedPriya.data);
    equal('Reset restores the loaded clock', afterReset.virtual_now, loadedPriya.virtual_now);
    ok('Resetting Priya\'s instance leaves Sam\'s instance as it was', (await snap(sam)).data.sessions.some(s => s.session_id === 'ls-2207'));

    const counts = {};
    for (const row of trace) {
      const key = row.duplicate ? 'duplicate_replay' : row.status;
      counts[key] = (counts[key] || 0) + 1;
    }
    console.log(JSON.stringify({
      app: 'tidepool', package_sha256: packageSha256, runtime: require(path.join(runtime, 'package.json')).version, node: process.version, passed: true,
      checks, reference_replies: replies, observations, management_call_example: managementCall,
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
