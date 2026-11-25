#!/usr/bin/env node
'use strict';
// Real-MCP walkthrough of the approved Wirewalk workflows through the public runtime.
// Wirewalk runs from a prepared copy of this package. The train and wildfire runs add the real Mail
// 1.3.0 package (a sending mailbox and the user's separate inbox) and Messaging from this checkout,
// and the train runs add the real Calendar 1.3.0 package. Nothing from Mail or Calendar is copied
// into this package; their seeds are assembled here, as a task would supply them.
// A scripted reference agent acts at each turn from what it can read; its replies are reference
// evidence for the data and tools, not model-agent trials. The host relays each committed Sent
// record with Mail's own notification builder and checks the actual inbox record and receipt.
// Prints a JSON evidence report: every call joined to run, App, account, connection, request/event
// ID, status, duplicate flag and Core version. `--write-mail-wire` regenerates examples/mail-wire.json.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

function checkoutRoot() {
  if (process.env.PALE_RUNTIME_ROOT) return path.dirname(path.resolve(process.env.PALE_RUNTIME_ROOT));
  let dir = __dirname;
  while (!fs.existsSync(path.join(dir, 'runtime/launch.cjs'))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw Error('Run inside the public PALE checkout, or set PALE_RUNTIME_ROOT to its runtime directory.');
    dir = parent;
  }
  return dir;
}
const root = checkoutRoot(), runtime = path.join(root, 'runtime');
const {prepare} = require(path.join(runtime, 'prepare.cjs'));
const {Client} = require(path.join(runtime, 'client.cjs'));
const {digestTree} = require(path.join(runtime, 'verify.cjs'));
const {create: createRouter} = require(path.join(runtime, 'messaging/src/router.cjs'));
// Scenario dependencies from the checkout, used through their public interfaces and Mail's own builder.
const MAIL = path.join(root, 'examples/apps/mail'), CALENDAR = path.join(root, 'examples/apps/calendar');
const mailPublisher = require(path.join(MAIL, 'src/publisher.cjs'));
const MAIL_REGISTRY = path.join(root, 'examples/registry.mail.json'), CALENDAR_REGISTRY = path.join(root, 'examples/registry.calendar.json');
const pkg = path.resolve(__dirname, '..');
const load = file => JSON.parse(fs.readFileSync(path.join(pkg, file), 'utf8'));
const copy = value => structuredClone(value);
const WRITE_WIRE = process.argv.includes('--write-mail-wire');

const T = (day, time) => `2026-10-${day}T${time}:00-07:00`;
const instant = value => Date.parse(value);
const clock = ms => {const d = new Date(ms - 7 * 3600e3); let h = d.getUTCHours() % 12 || 12; return h + ':' + String(d.getUTCMinutes()).padStart(2, '0') + ' ' + (d.getUTCHours() < 12 ? 'am' : 'pm');};
const PERSON = 'person-priya', USER_ADDRESS = 'priya@pale.example';
const SENDER = {account_id: 'mail-assistant', address: 'mail-assistant@pale.example'}, INBOX = {account_id: 'mail-priya', address: USER_ADDRESS};
// One synthetic user bound to Wirewalk, Calendar and both mailboxes, as the task binding would do.
const BINDING = {people: [{person_id: PERSON, name: 'Priya Raman'}], accounts: [
  {app_id: 'wirewalk', account_id: 'ww-priya', owner_person_id: PERSON},
  {app_id: 'calendar', account_id: 'calendar-priya', owner_person_id: PERSON},
  {app_id: 'mail', account_id: SENDER.account_id, owner_person_id: PERSON},
  {app_id: 'mail', account_id: INBOX.account_id, owner_person_id: PERSON}], objects: {}};
const allow = list => ({scenario: {allow: list, constraints: {}}, sandbox: {allow: list, constraints: {}}});

async function main() {
  const packageSha256 = digestTree(pkg);
  const prepared = prepare(pkg);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wirewalk-walkthrough-'));
  const clients = [], checks = [], trace = [], replies = {}, observations = {};
  const evidence = {turns: [], deliveries: [], messaging_receipts: {}, snapshots_before_reset: []};
  const ok = (label, condition) => {assert.ok(condition, label); checks.push(label);};
  const equal = (label, actual, expected) => {assert.deepEqual(actual, expected, label); checks.push(label);};
  let managementCall = null, connections = 0;

  // Every call goes through here so the trace joins run, App, account, connection and request/event IDs.
  const label = (app, account, role) => app + '/' + account + '/' + role + '#' + (++connections);
  function traced(client, run, app, account, connection) {
    return {
      raw: client, run, app, account, seen: null,
      async call(name, args = {}) {
        const result = await client.call(name, args);
        trace.push({seq: trace.length + 1, run, app, account, connection, tool: name, request_id: args.request_id ?? null,
          event_id: args.event?.event_id ?? result.event_id ?? null, cloud_event_id: args.message?.id ?? null,
          status: result.status, duplicate: result.duplicate === true, version: result.version ?? null});
        if (this.seen && app === 'wirewalk') for (const m of JSON.stringify(result).matchAll(/"(?:id|repost_id)":"(p\d+)"/g)) this.seen.add(m[1]);
        return result;
      },
    };
  }
  async function open(app, account, role, run, stateDir, registry) {
    // Core records the MCP client name as each audit row's client_name, so audit rows join to the trace by connection.
    const connection = label(app, account, role), client = new Client(app, role, run, stateDir, connection, {registry});
    clients.push(client); await client.initialize();
    return traced(client, run, app, account, connection);
  }
  // Retain Core's audit rows before a reset clears them, each joined to the one trace row it records.
  function retainAudit(snapshot, run, account) {
    const mine = trace.filter(t => t.run === run && t.app === 'wirewalk' && t.account === account && !t.duplicate), used = new Set();
    return snapshot.snapshot.audit.map(r => {
      const row = {seq: r.seq, actor: r.actor, tool: r.tool, decision: r.decision, reason: r.reason ?? null, before: r.before ?? null, after: r.after ?? null,
        virtual_time: r.virtual_time ?? null, client_name: r.client_name, request_id: r.input?.request_id ?? null,
        event_id: r.input?.event_id ?? r.trace?.event_id ?? null, status: r.result?.status ?? null};
      const match = mine.find(t => !used.has(t.seq) && t.connection === row.client_name && t.tool === row.tool && t.request_id === row.request_id &&
        (row.event_id === null || t.event_id === row.event_id) && t.status === row.status);
      if (match) used.add(match.seq);
      return {...row, trace_seq: match ? match.seq : null};
    });
  }
  const version = async c => (await c.call('env.snapshot')).version;
  async function loadSeed(infra, args) {
    const s = await infra.call('env.snapshot');
    const loaded = await infra.call('env.load_seed', {expected_version: s.version, request_id: 'load-' + infra.account, ...args});
    assert.equal(loaded.status, 'ready', infra.app + ' ' + JSON.stringify(loaded));
    return s;
  }
  // Wirewalk instance: the package bundle, rebound to the reader's own account when it differs.
  async function wirewalk(run, dir, data, {policies = load('fixtures/policies.json'), binding = BINDING, virtualNow, dataset, catalog} = {}) {
    const infra = await open('wirewalk', data.account_id, 'infra', run, dir, prepared.registry);
    const snap = (await infra.call('env.snapshot')).snapshot.resources.bundle;
    // A supplied dataset is used as shipped; the package dataset is recounted for the seed being loaded.
    const bundle = {dataset: dataset ? copy(dataset) : {...copy(snap.dataset), expected_counts: {records: data.posts.length, assets: 1}},
      catalog: copy(catalog || snap.catalog), blobs: snap.blobs};
    await loadSeed(infra, {data, binding, policies, bundle, ...(virtualNow ? {virtual_now: virtualNow} : {})});
    return {infra, agent: await open('wirewalk', data.account_id, 'agent', run, dir, prepared.registry)};
  }
  // Mail and Calendar instances from their own registries, with run-assembled seeds and empty asset catalogs.
  async function personal(app, registry, run, dir, data, records, policies, virtualNow) {
    const infra = await open(app, data.account_id, 'infra', run, dir, registry);
    const s = (await infra.call('env.snapshot')).snapshot.resources.bundle;
    const dataset = {...copy(s.dataset), dataset_id: 'wirewalk-scenario-' + app, description: 'Run-assembled ' + app + ' state for the Wirewalk walkthrough.',
      expected_counts: {records, assets: 0}};
    const bundle = {dataset, catalog: {schema_version: 'pale.asset-catalog.v1', catalog_id: 'wirewalk-scenario-' + app, app_id: app,
      dataset_ref: 'dataset.json', assets: [], extensions: []}, blobs: {}};
    await loadSeed(infra, {data, binding: BINDING, policies, bundle, virtual_now: virtualNow});
    return {infra, agent: await open(app, data.account_id, 'agent', run, dir, registry)};
  }
  const mailbox = (who, messages = []) => ({account_id: who.account_id, owner_person_id: PERSON, address: who.address, messages});
  const calendarSeed = direction => {
    const event = (id, title, start, end, location) => ({id, uid: id + '@pale.example', account_id: 'calendar-priya', calendar_id: 'cal-priya',
      title, start, end, timezone: 'America/Los_Angeles', organizer_person_id: PERSON, attendees: [PERSON], location, status: 'confirmed', sequence: 0, attachments: []});
    return {account_id: 'calendar-priya', owner_person_id: PERSON, calendar_id: 'cal-priya', timezone: 'America/Los_Angeles', events: [
      event('evt-show', 'Concert at Quillfeather Hall', T(10, '20:00'), T(10, '23:00'), 'Quillfeather Hall'),
      event('evt-ride', 'Ride home: Green Line ' + direction + ' from Fennick St (15-minute walk from the hall)', T(10, '23:15'), T(10, '23:45'), 'Fennick St station')]};
  };

  // One run: Wirewalk (+ Calendar), the sending mailbox, the user's inbox and a Messaging publisher
  // connection for the sending mailbox. `grant: false` leaves the recipient grant out; `ack: 'lost'`
  // uses an in-process Router whose receiver acknowledgement is lost after the inbox commits.
  async function assemble(run, {data, virtualNow, calendar = null, grant = true, ack = 'normal'}) {
    const dir = path.join(temp, run), a = {run, dir, relayed: new Set(), deliveries: [], halted: false, sends: 0};
    a.ww = await wirewalk(run, path.join(dir, 'wirewalk'), data, {virtualNow});
    if (calendar) a.cal = await personal('calendar', CALENDAR_REGISTRY, run, path.join(dir, 'calendar'), calendar, calendar.events.length,
      allow(['calendar.list', 'calendar.get']), virtualNow);
    a.sender = await personal('mail', MAIL_REGISTRY, run, path.join(dir, 'sender'), mailbox(SENDER), 0,
      allow(['mail.search', 'mail.get', 'mail.draft.create', 'mail.send']), virtualNow);
    // The user's inbox: Infra reads it for grading; the user-side Agent connection only reads.
    a.inbox = await personal('mail', MAIL_REGISTRY, run, path.join(dir, 'inbox'), mailbox(INBOX), 0, allow(['mail.search', 'mail.get']), virtualNow);
    const config = {schema_version: 2, registry: 'examples/registry.mail.json', receiver_state_namespace: 'inbox', authentication: {mode: 'trusted-stdio'},
      publishers: [{app_id: 'mail', account_id: SENDER.account_id, owner_person_id: PERSON, package_root: 'examples/apps/mail',
        contribution_ref: 'contribution/contribution.json', allowed_recipients: grant ? [{app_id: 'mail', account_id: INBOX.account_id, channel: 'channel.email'}] : []}]};
    a.config = path.join(dir, 'router.json'); fs.writeFileSync(a.config, JSON.stringify(config));
    a.grants = copy(config.publishers[0].allowed_recipients);
    if (ack === 'lost') {
      // In-process Router, so the receiver client's acknowledgement can be dropped after the inbox commits.
      const router = await createRouter({config: a.config, publisher: 'mail', run, stateDir: dir});
      clients.push(router);
      a.loseNextAck = true;
      a.router = traced({call: async (name, args) => {
        if (!a.loseNextAck) return router.call(name, args);
        const original = Client.prototype.call;
        Client.prototype.call = async function (tool, toolArgs) {
          const result = await original.call(this, tool, toolArgs);
          if (tool === 'env.apply_event') throw Error('Simulated lost acknowledgement');
          return result;
        };
        try {return await router.call(name, args);} finally {Client.prototype.call = original; a.loseNextAck = false;}
      }}, run, 'messaging', SENDER.account_id, label('messaging', SENDER.account_id, 'publisher'));
    } else {
      const connection = label('messaging', SENDER.account_id, 'publisher');
      const router = new Client(null, null, null, null, connection, {commandArgs:
        [path.join(runtime, 'messaging/service.cjs'), '--config', a.config, '--publisher', 'mail', '--run', run, '--state-dir', dir]});
      clients.push(router); await router.initialize();
      a.router = traced(router, run, 'messaging', SENDER.account_id, connection);
    }
    a.infras = [a.ww.infra, ...(a.cal ? [a.cal.infra] : []), a.sender.infra, a.inbox.infra];
    return a;
  }
  // Infra's session barrier: apply due Wirewalk events, then bring every App in the run to the turn time.
  async function advance(a, at, events = []) {
    for (const event of events) {
      const args = {expected_version: await version(a.ww.infra), event};
      if (!managementCall) managementCall = {method: 'tools/call', params: {name: 'env.apply_event', arguments: copy(args)}};
      equal(a.run + ': ' + event.event_id + ' commits', (await a.ww.infra.call('env.apply_event', args)).status, 'committed');
    }
    for (const infra of a.infras) {
      const r = await infra.call('env.advance_time', {expected_version: await version(infra), request_id: 'turn-' + at, virtual_now: at});
      assert.equal(r.status, 'committed', JSON.stringify(r));
    }
  }
  // The host's relay: each committed Sent record becomes Mail's own wire message and goes through
  // Messaging. An unknown acknowledgement halts the run for reconciliation; nothing is retried.
  async function relay(a) {
    const sent = (await a.sender.infra.call('env.snapshot')).snapshot.data.messages.filter(m => m.folder === 'sent' && !a.relayed.has(m.id));
    for (const record of sent) {
      if (a.halted) break;
      const wire = mailPublisher.notification(record, {sourceAccount: SENDER.account_id, recipient: INBOX});
      const request_id = a.run + '-relay-' + record.id, receipt = await a.router.call('router.publish', {request_id, message: wire});
      a.relayed.add(record.id);
      a.deliveries.push({record, wire, request_id, receipt});
      if (receipt.status === 'unknown' || receipt.stop_run) a.halted = true;
    }
  }
  async function inboxMessages(a) {return (await a.inbox.infra.call('env.snapshot')).snapshot.data.messages;}
  // The scripted agent's memory between turns is its own Sent folder.
  async function sentSubjects(a) {
    const sent = (await a.sender.agent.call('mail.search', {folder: 'sent'})).messages;
    return sent.map(m => [Number(/\d+$/.exec(m.id)[0]), m.subject]).sort((x, y) => x[0] - y[0]).map(x => x[1]);
  }
  async function sendEmail(a, subject, body) {
    const v = (await a.sender.agent.call('mail.search', {folder: 'drafts'})).version;
    const draft = await a.sender.agent.call('mail.draft.create', {to: [USER_ADDRESS], subject, body, expected_version: v, request_id: a.run + '-draft-' + (++a.sends)});
    assert.equal(draft.status, 'committed', JSON.stringify(draft));
    const sent = await a.sender.agent.call('mail.send', {id: draft.id, expected_version: draft.version, request_id: a.run + '-send-' + draft.id});
    assert.equal(sent.status, 'committed', JSON.stringify(sent));
    return draft.id;
  }
  // Sentences of a post, without thread markers like "1/2"; "Jan. 1" does not end a sentence.
  const sentences = text => text.replace(/^\d+\/\d+\s+/, '').replace(/\s+\d+\/\d+$/, '').split(/(?<=[a-z0-9%'"]\.)\s+(?=[A-Z@])/);
  function turnRecord(a, at, decision, email = null) {
    const row = {run: a.run, at, visible_post_ids: [...a.ww.agent.seen].sort(), decision, email};
    evidence.turns.push(row); a.ww.agent.seen = null; return row;
  }

  // Train: read the ride direction from Calendar, the operator's latest statement from Wirewalk.
  async function trainTurn(a, at) {
    a.ww.agent.seen = new Set();
    const listed = (await a.cal.agent.call('calendar.list', {start: T(10, '00:00'), end: T(11, '06:00')})).events;
    const ride = (await a.cal.agent.call('calendar.get', {id: listed.find(e => /^Ride home:/.test(e.title)).id})).event;
    const show = listed.find(e => /^Concert/.test(e.title));
    const direction = /Green Line (eastbound|westbound)/.exec(ride.title)[1], walk = Number(/(\d+)-minute walk/.exec(ride.title)[1]);
    const operator = (await a.ww.agent.call('wirewalk.search', {author_id: 'green-line-ops', query: 'last'})).posts;
    const claims = (await a.ww.agent.call('wirewalk.search', {query: 'last Green Line canceled'})).posts.filter(p => p.author.id !== 'green-line-ops');
    for (const p of claims.filter(c => c.quoted || c.source)) await a.ww.agent.call('wirewalk.post.get', {id: (p.quoted || p.source).id});
    let statement = null;
    for (const p of operator) {
      const m = new RegExp('last ' + direction + '[^.]*?(\\d{1,2}):(\\d{2}) pm', 'i').exec(p.text);
      if (m) {statement = {post: p, departs: instant(T(10, String(Number(m[1]) + 12) + ':' + m[2]))}; break;}
    }
    const leaveBy = statement.departs - walk * 60e3, early = leaveBy < instant(show.end);
    const already = (await sentSubjects(a)).some(s => /^Leave the show/.test(s));
    if (!early || already) {
      return turnRecord(a, at, (early ? 'already alerted' : 'no change: ' + direction + ' last train ' + clock(statement.departs) + ' per ' + statement.post.id) +
        (claims.length ? '; unofficial claims seen: ' + claims.map(c => c.id).join(',') : ''));
    }
    const subject = 'Leave the show by ' + clock(leaveBy) + ' for the last ' + direction + ' train';
    const body = 'The Green Line operator posted at ' + clock(instant(statement.post.published_at)) + ': "' + statement.post.text + '" ' +
      statement.post.link + '\nThe last ' + direction + ' train now leaves Fennick St at ' + clock(statement.departs) + '. Fennick St is a ' + walk +
      '-minute walk from Quillfeather Hall and the concert ends at ' + clock(instant(show.end)) + ', so leave by ' + clock(leaveBy) + '.';
    const id = await sendEmail(a, subject, body);
    return turnRecord(a, at, 'email: operator statement ' + statement.post.id, {message_id: id, subject});
  }

  // Wildfire: the user saw the 2 pm bulletin. Alert on a county status change for either area until the
  // user's cutoff (8 pm in the request; the cutoff control run uses 9 pm).
  const AREAS = ['Pine Hollow', 'Lakeview'];
  // A county post's status for an area: an area-wide warning or order, a single zone's change, or "no notice".
  function status(text, area) {
    const m = new RegExp('EVACUATION (ORDER|WARNING) for ' + area).exec(text);
    if (m) return 'EVACUATION ' + m[1];
    const zone = new RegExp(area + ' zone ([A-Z]+-\\d+) is (?:downgraded|upgraded) to an EVACUATION (ORDER|WARNING)').exec(text);
    if (zone) return 'EVACUATION ' + zone[2] + ' for zone ' + zone[1];
    return new RegExp(area + ': no evacuation notice').test(text) ? 'no notice' : null;
  }
  async function wildfireTurn(a, at, cutoff = T(11, '20:00')) {
    a.ww.agent.seen = new Set();
    await a.ww.agent.call('wirewalk.feed.list', {limit: 20});
    const county = (await a.ww.agent.call('wirewalk.search', {author_id: 'tamsen-oem', since: T(11, '14:00')})).posts;
    const others = (await a.ww.agent.call('wirewalk.search', {query: 'Pine Hollow', since: T(11, '14:00')})).posts.filter(p => p.author.id !== 'tamsen-oem');
    for (const p of others) await a.ww.agent.call('wirewalk.post.get', {id: p.id});
    if (instant(at) > instant(cutoff)) return turnRecord(a, at, 'after the ' + clock(instant(cutoff)) + ' cutoff: no email');
    // Memory between turns: the 2 pm baseline, then whatever this mailbox already reported, oldest first.
    const known = {}, baseline = county.find(p => p.id === 'p21');
    for (const area of AREAS) known[area] = status(baseline.text, area);
    for (const subject of await sentSubjects(a)) {
      for (const part of subject.replace(/^Cinder Fork Fire: /, '').split('; ')) {
        const m = /^(.+?) now under an (.+)$/.exec(part);
        if (m && AREAS.includes(m[1])) known[m[1]] = m[2];
      }
    }
    const changes = [];
    for (const area of AREAS) {
      const mentions = county.filter(p => status(p.text, area) !== null), latest = mentions[0];
      if (!latest || status(latest.text, area) === known[area]) continue;
      // Cite the post that issued the current status, and the latest restatement if there is one.
      let issued = latest;
      for (const p of mentions) {if (status(p.text, area) !== status(latest.text, area)) break; issued = p;}
      changes.push({area, status: status(latest.text, area), issued, latest});
    }
    if (!changes.length) return turnRecord(a, at, 'no change since ' + Object.entries(known).map(([k, v]) => k + ' ' + v).join(', '));
    const subject = 'Cinder Fork Fire: ' + changes.map(c => c.area + ' now under an ' + c.status).join('; ');
    const body = changes.map(c => c.area + ' (' + (c.area === 'Pine Hollow' ? 'your parents' : 'you') + '): ' + c.status + ', issued by Tamsen County at ' +
      clock(instant(c.issued.published_at)) + ': "' + c.issued.text + '" ' + c.issued.link + (c.latest !== c.issued ? ' (repeated at ' + clock(instant(c.latest.published_at)) + ': ' + c.latest.link + ')' : '')).join('\n');
    const id = await sendEmail(a, subject, body);
    return turnRecord(a, at, 'email: ' + changes.map(c => c.area + ' ' + c.issued.id).join(', '), {message_id: id, subject});
  }

  // Delivery checks against the actual inbox record, receipt and receiver event status.
  async function checkDelivered(a, delivery) {
    const {record, wire, receipt} = delivery, inbox = await inboxMessages(a), received = inbox.find(m => m.id === receipt.event_id);
    const status = (await a.inbox.infra.call('env.event_status', {event_id: receipt.event_id})).receipt;
    const shown = (await a.inbox.agent.call('mail.get', {id: receipt.event_id})).message;
    equal(a.run + ': receipt names the inbox account and Mail\'s CloudEvents identity',
      [receipt.status, receipt.target, receipt.cloud_event.id, receipt.cloud_event.source, receipt.cloud_event.time],
      ['committed', {app_id: 'mail', account_id: INBOX.account_id}, 'mail-' + record.id, 'urn:pale:app:mail:account:' + SENDER.account_id, record.sent_at]);
    equal(a.run + ': the inbox record matches the sent record (recipient, sender, content, unread)',
      [received.to, received.from, received.subject, received.body, received.folder, received.read],
      [[USER_ADDRESS], SENDER.address, record.subject, record.body, 'inbox', false]);
    equal(a.run + ': the inbox received it at the synchronized turn time', [received.received_at, receipt.applied_at], [record.sent_at, record.sent_at]);
    equal(a.run + ': the user reads the same record through Mail', shown.body, record.body);
    equal(a.run + ': Core\'s receiver receipt joins to the delivery', [status.status, status.event_id, status.trace.cloud_event.id], ['committed', receipt.event_id, wire.id]);
    evidence.deliveries.push({run: a.run, source: {app: 'mail', account: SENDER.account_id, message_id: record.id, sent_at: record.sent_at},
      wire: {source: wire.source, id: wire.id, time: wire.time, recipient: wire.data.recipient}, publish_request_id: delivery.request_id,
      receipt: {status: receipt.status, event_id: receipt.event_id, target: receipt.target, version: receipt.version, applied_at: receipt.applied_at},
      inbox: {id: received.id, received_at: received.received_at, subject: received.subject}, receiver_event_status: {status: status.status, version: status.version ?? null}});
    return received;
  }
  function keepReceipts(a) {
    const file = path.join(a.dir, a.run, 'messaging.receipts.jsonl');
    const rows = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
    evidence.messaging_receipts[a.run] = rows.map(r => ({request_id: r.request_id ?? null, status: r.result?.status ?? r.status ?? null,
      code: r.result?.code ?? r.code ?? null, event_id: r.result?.event_id ?? r.event_id ?? null, duplicate: r.result?.duplicate === true || r.duplicate === true}));
  }

  try {
    // Scenario dependencies only: the walkthrough refuses to run against other Mail or Calendar versions.
    equal('The scenario dependencies in this checkout are Mail 1.3.0 and Calendar 1.3.0',
      [require(path.join(MAIL, 'app.json')).version, require(path.join(CALENDAR, 'app.json')).version], ['1.3.0', '1.3.0']);
    const minimal = load('fixtures/minimal.json'), scenario = load('examples/scenario.json'), fires = load('examples/wildfire-events.json');
    const fire = id => fires.find(e => e.payload.id === id);

    // Package defaults: the Agent sees reads only and no management tools.
    const defaults = await wirewalk('defaults', path.join(temp, 'defaults'), minimal, {binding: load('fixtures/binding.json')});
    const tools = (await defaults.agent.raw.request('tools/list')).result.tools.map(t => t.name);
    equal('Default scenario policy exposes the six read tools', tools, ['wirewalk.feed.list', 'wirewalk.search', 'wirewalk.post.get',
      'wirewalk.thread.get', 'wirewalk.account.get', 'wirewalk.bookmarks.list']);
    equal('Default policy denies bookmark writes', (await defaults.agent.call('wirewalk.bookmarks.add', {id: 'p05',
      expected_version: await version(defaults.infra), request_id: 'denied-bookmark'})).status, 'permission_denied');
    equal('The Agent cannot inject public posts', (await defaults.agent.call('env.apply_event', {expected_version: await version(defaults.infra), event: scenario})).status, 'permission_denied');
    const resources = (await defaults.agent.raw.request('resources/list')).result;
    observations.agent_resources = {listed: resources?.resources?.length ?? null, note: 'No platform resource-access registration for wirewalk; the alt text carries the image text.'};
    // Core's own asset checks: a bundle without the image bytes, or a post naming an uncatalogued image, is refused.
    const s0 = await defaults.infra.call('env.snapshot'), bundle0 = s0.snapshot.resources.bundle;
    const noBytes = await defaults.infra.call('env.load_seed', {expected_version: s0.version, request_id: 'load-without-bytes', data: minimal, bundle: {...copy(bundle0), blobs: {}}});
    const orphan = copy(minimal); orphan.posts[4].media[0].asset_id = 'not-catalogued';
    const noAsset = await defaults.infra.call('env.load_seed', {expected_version: s0.version, request_id: 'load-uncatalogued-image', data: orphan, bundle: copy(bundle0)});
    equal('A missing image file or an uncatalogued image reference fails validation', [noBytes.status, noAsset.status], ['invalid_bundle', 'invalid_bundle']);
    equal('Rejected loads leave the instance unchanged', (await defaults.infra.call('env.snapshot')).snapshot.data, s0.snapshot.data);

    // ---- Train: the same feed, two saved itineraries.
    const train = {};
    for (const direction of ['eastbound', 'westbound']) {
      const a = train[direction] = await assemble('train-' + direction.slice(0, 4), {data: minimal, virtualNow: T(10, '21:10'), calendar: calendarSeed(direction)});
      if (direction === 'eastbound') {
        equal('Before injection the operator reply is unavailable', (await a.ww.agent.call('wirewalk.post.get', {id: 'p19'})).status, 'not_found');
        const future = await a.ww.agent.call('wirewalk.post.get', {id: 'p29'}), unknownPost = await a.ww.agent.call('wirewalk.post.get', {id: 'p999'});
        equal('A seeded post dated after the clock and an unknown ID get the same response', [future.status, future.message], [unknownPost.status, unknownPost.message]);
        a.loadedSnapshot = await a.ww.infra.call('env.snapshot');
      }
      await trainTurn(a, T(10, '21:10'));
      await advance(a, T(10, '21:13'), [scenario]);
      await trainTurn(a, T(10, '21:13')); await relay(a);
      await advance(a, T(10, '22:30'));
      await trainTurn(a, T(10, '22:30')); await relay(a);
      await advance(a, T(10, '23:00'));
      keepReceipts(a);
    }
    const east = train.eastbound, west = train.westbound;
    const eastTurns = evidence.turns.filter(t => t.run === 'train-east');
    equal('Eastbound: no email before the operator replies, one at the first turn after it, none later',
      eastTurns.map(t => Boolean(t.email)), [false, true, false]);
    ok('Eastbound: the turn before the reply saw the photo and its quotes but no operator statement',
      ['p05', 'p07', 'p08', 'p09'].every(id => eastTurns[0].visible_post_ids.includes(id)) && !eastTurns[0].visible_post_ids.includes('p19'));
    ok('Eastbound: the alert turn saw the operator reply p19', eastTurns[1].visible_post_ids.includes('p19'));
    const eastInbox = await inboxMessages(east);
    equal('Eastbound inbox holds exactly one email', eastInbox.length, 1);
    const eastMail = await checkDelivered(east, east.deliveries[0]);
    ok('The eastbound email gives the 10:55 pm train and the 10:40 pm leave-by time and links the operator post',
      /10:55 pm/.test(eastMail.body) && /leave by 10:40 pm/.test(eastMail.body) && eastMail.body.includes('https://wirewalk.example/@green-line-ops/posts/p19') &&
      /Leave the show by 10:40 pm/.test(eastMail.subject));
    equal('Westbound inbox is empty through the end of the show', await inboxMessages(west), []);
    equal('Westbound sent nothing', (await west.sender.infra.call('env.snapshot')).snapshot.data.messages, []);
    replies.train = {eastbound: {subject: eastMail.subject, body: eastMail.body}, westbound: null};

    // The wire fixture: Mail's builder applied to the committed Sent record.
    const wire = east.deliveries[0].wire;
    if (WRITE_WIRE) fs.writeFileSync(path.join(pkg, 'examples/mail-wire.json'), JSON.stringify(wire, null, 2) + '\n');
    equal('The live wire message equals examples/mail-wire.json', wire, load('examples/mail-wire.json'));
    equal('The wire names sender account, explicit recipient account, source message ID and event time',
      [wire.data.source_object.account_id, wire.data.recipient, wire.data.source_object.object_id, wire.time, wire.data.content.body.format],
      [SENDER.account_id, {kind: 'app_account_ref', app_id: 'mail', id: INBOX.account_id}, 'draft-1', T(10, '21:13'), 'text/plain']);

    // Duplicates: the same request, and the same CloudEvent under a new request ID, both return the first receipt.
    const first = east.deliveries[0].receipt;
    const again = await east.router.call('router.publish', {request_id: east.deliveries[0].request_id, message: wire});
    const sameEvent = await east.router.call('router.publish', {request_id: 'train-east-relay-retry', message: wire});
    const changedWire = copy(wire); changedWire.data.content.body.text += ' (edited)';
    const conflict = await east.router.call('router.publish', {request_id: east.deliveries[0].request_id, message: changedWire});
    equal('Relaying the same message twice is a duplicate with the original receipt',
      [again.duplicate, again.event_id, sameEvent.duplicate, sameEvent.event_id], [true, first.event_id, true, first.event_id]);
    equal('Changed content under a used request ID is rejected', conflict.code, 'idempotency_conflict');
    equal('Duplicates and the conflict add no inbox record', (await inboxMessages(east)).length, 1);
    keepReceipts(east);

    // Reset evidence: retain the snapshot, then reset Wirewalk; the injected reply disappears.
    equal('After injection the reply is visible', (await east.ww.agent.call('wirewalk.post.get', {id: 'p19'})).post.parent.id, 'p12');
    const beforeReset = await east.ww.infra.call('env.snapshot');
    evidence.snapshots_before_reset.push({run: 'train-east', app: 'wirewalk', account: 'ww-priya', version: beforeReset.version,
      virtual_now: beforeReset.snapshot.virtual_now, posts: beforeReset.snapshot.data.posts.length, bookmarks: beforeReset.snapshot.data.bookmarks.map(b => b.post_id),
      event_receipts: Object.keys(beforeReset.snapshot.receipts).filter(k => !k.startsWith('clock:')), audit: retainAudit(beforeReset, 'train-east', 'ww-priya')});
    ok('train-east: every retained Core audit row joins one trace row by connection, tool, request/event ID and status',
      evidence.snapshots_before_reset[0].audit.length > 0 && evidence.snapshots_before_reset[0].audit.every(r => r.trace_seq !== null));
    equal('Wirewalk reset returns ready', (await east.ww.infra.call('env.reset', {expected_version: beforeReset.version})).status, 'ready');
    const afterReset = (await east.ww.infra.call('env.snapshot')).snapshot;
    equal('Reset restores the loaded history and bookmarks', afterReset.data, east.loadedSnapshot.snapshot.data);
    equal('Reset restores the loaded clock', afterReset.virtual_now, T(10, '21:10'));
    equal('After reset the reply is unavailable again', (await east.ww.agent.call('wirewalk.post.get', {id: 'p19'})).status, 'not_found');
    equal('Resetting Wirewalk leaves the delivered email in the inbox', (await inboxMessages(east)).length, 1);

    // Refused grant: a Sent record exists, the inbox stays empty.
    const denied = await assemble('train-east-denied', {data: minimal, virtualNow: T(10, '21:10'), calendar: calendarSeed('eastbound'), grant: false});
    await advance(denied, T(10, '21:13'), [scenario]);
    await trainTurn(denied, T(10, '21:13')); await relay(denied);
    equal('Without a grant Messaging refuses the delivery', denied.deliveries.map(d => d.receipt.code), ['recipient_not_authorized']);
    equal('The sending mailbox still has its Sent record', (await denied.sender.infra.call('env.snapshot')).snapshot.data.messages.map(m => m.folder), ['sent']);
    equal('The denied inbox is empty', await inboxMessages(denied), []);
    keepReceipts(denied);

    // Unknown acknowledgement: the inbox commits but the Router cannot confirm it; the run halts.
    const lost = await assemble('train-east-lostack', {data: minimal, virtualNow: T(10, '21:10'), calendar: calendarSeed('eastbound'), ack: 'lost'});
    await advance(lost, T(10, '21:13'), [scenario]);
    await trainTurn(lost, T(10, '21:13')); await relay(lost);
    const unknown = lost.deliveries[0].receipt;
    equal('A lost acknowledgement is reported as unknown with the attempted event ID and no commit time',
      [unknown.status, unknown.code, unknown.stop_run, typeof unknown.event_id, unknown.committed_at], ['unknown', 'receiver_unconfirmed', true, 'string', undefined]);
    ok('The runner halts the run instead of retrying', lost.halted);
    const reconciled = (await lost.inbox.infra.call('env.event_status', {event_id: unknown.event_id})).receipt;
    equal('Reconciliation: the receiver did commit the attempted event', [reconciled.status, (await inboxMessages(lost)).map(m => m.id)], ['committed', [unknown.event_id]]);
    const retry = await lost.router.call('router.publish', {request_id: lost.deliveries[0].request_id, message: lost.deliveries[0].wire});
    equal('A retry after the halt is refused and adds nothing', [retry.status, retry.code, (await inboxMessages(lost)).length], ['halted', 'run_halted', 1]);
    keepReceipts(lost);

    // ---- Wildfire: two areas, turns after each listed update, and a delayed-turn variant.
    const sunday = {data: minimal, virtualNow: T(11, '14:30')};
    const wf = await assemble('wildfire', sunday);
    await wildfireTurn(wf, T(11, '14:30'));
    for (const [at, ids] of [[T(11, '15:11'), ['p22', 'p23']], [T(11, '16:21'), ['p24']], [T(11, '18:06'), ['p25', 'p26']], [T(11, '20:16'), ['p27']]]) {
      await advance(wf, at, ids.map(fire));
      await wildfireTurn(wf, at); await relay(wf);
    }
    keepReceipts(wf);
    const wfTurns = evidence.turns.filter(t => t.run === 'wildfire');
    equal('Wildfire: emails only after the 4:20 order and the 6:05 Lakeview warning', wfTurns.map(t => Boolean(t.email)), [false, false, true, true, false]);
    ok('Wildfire: the 3:10 turn saw the repost and the quote of the 2 pm bulletin and sent nothing', ['p22', 'p23'].every(id => wfTurns[1].visible_post_ids.includes(id)));
    ok('Wildfire: the 6:06 turn saw the repeated Pine Hollow order and did not re-alert it', wfTurns[3].visible_post_ids.includes('p26') && !/Pine Hollow/.test(wfTurns[3].email.subject));
    ok('Wildfire: the 8:16 turn saw the 8:15 post and sent nothing after the cutoff', wfTurns[4].visible_post_ids.includes('p27') && !wfTurns[4].email);
    const wfInbox = await inboxMessages(wf);
    equal('Wildfire inbox holds exactly two emails', wfInbox.length, 2);
    for (const d of wf.deliveries) await checkDelivered(wf, d);
    ok('First email: the Pine Hollow order, its county post and 4:20 pm issue time',
      /Pine Hollow now under an EVACUATION ORDER/.test(wfInbox[0].subject) && wfInbox[0].body.includes('/@tamsen-oem/posts/p24') && /at 4:20 pm/.test(wfInbox[0].body) && !/Lakeview/.test(wfInbox[0].subject));
    ok('Second email: the Lakeview warning, its county post and 6:05 pm issue time',
      /Lakeview now under an EVACUATION WARNING/.test(wfInbox[1].subject) && wfInbox[1].body.includes('/@tamsen-oem/posts/p25') && /at 6:05 pm/.test(wfInbox[1].body) && !/Pine Hollow/.test(wfInbox[1].subject));
    replies.wildfire = wfInbox.map(m => ({received_at: m.received_at, subject: m.subject, body: m.body}));

    // Delayed-turn variant: the runner resumes the agent once, at 6:10 pm, after both county bulletins.
    const late = await assemble('wildfire-delayed', sunday);
    await advance(late, T(11, '18:10'), ['p22', 'p23', 'p24', 'p25', 'p26'].map(fire));
    await wildfireTurn(late, T(11, '18:10')); await relay(late);
    keepReceipts(late);
    const lateInbox = await inboxMessages(late);
    equal('Delayed turn: the agent is resumed once and sends one email', [evidence.turns.filter(t => t.run === 'wildfire-delayed').length, lateInbox.length], [1, 1]);
    await checkDelivered(late, late.deliveries[0]);
    ok('Delayed turn: the one email gives the latest status and source for each area',
      /Pine Hollow now under an EVACUATION ORDER; Lakeview now under an EVACUATION WARNING/.test(lateInbox[0].subject) &&
      lateInbox[0].body.includes('/posts/p24') && lateInbox[0].body.includes('/posts/p26') && lateInbox[0].body.includes('/posts/p25'));
    replies.wildfire_delayed = {subject: lateInbox[0].subject, body: lateInbox[0].body};

    // Cutoff variant and its control: identical runs and agent; only the user's cutoff differs (8 pm vs 9 pm).
    // The 8:15 pm post changes Pine Hollow's status, so the control must email it; the variant must not.
    const cutoffRuns = {};
    for (const [run, cutoff] of [['wildfire-cutoff', T(11, '20:00')], ['wildfire-cutoff-control', T(11, '21:00')]]) {
      const c = cutoffRuns[run] = await assemble(run, sunday);
      await advance(c, T(11, '18:10'), ['p22', 'p23', 'p24', 'p25', 'p26'].map(fire));
      await wildfireTurn(c, T(11, '18:10'), cutoff); await relay(c);
      await advance(c, T(11, '20:16'), [fire('p27')]);
      await wildfireTurn(c, T(11, '20:16'), cutoff); await relay(c);
      keepReceipts(c);
    }
    const cut = cutoffRuns['wildfire-cutoff'], control = cutoffRuns['wildfire-cutoff-control'];
    const cutTurn = evidence.turns.filter(t => t.run === 'wildfire-cutoff')[1];
    ok('Cutoff variant: the 8:16 pm turn saw the 8:15 post (p27) and sent nothing; the inbox keeps only the 6:10 email',
      cutTurn.visible_post_ids.includes('p27') && !cutTurn.email && (await inboxMessages(cut)).length === 1);
    const controlInbox = await inboxMessages(control);
    ok('Cutoff control: with a 9 pm cutoff the same 8:16 pm turn emails the Pine Hollow zone change from p27',
      controlInbox.length === 2 && /Pine Hollow now under an EVACUATION WARNING for zone PH-2/.test(controlInbox[1].subject) &&
      controlInbox[1].body.includes('/@tamsen-oem/posts/p27') && /at 8:15 pm/.test(controlInbox[1].body) && !/Lakeview/.test(controlInbox[1].subject));
    await checkDelivered(control, control.deliveries[1]);
    replies.wildfire_cutoff_control = {subject: controlInbox[1].subject, body: controlInbox[1].body};

    // ---- Markets: two reader instances in one run; Infra applies the shared publications to both.
    const dario = load('examples/task-data/seed.json'), eventIds = new Set([scenario, ...fires].map(e => e.payload.id));
    const darioStart = {...copy(dario), posts: dario.posts.filter(p => !eventIds.has(p.id))};
    const writes = load('examples/task-data/policies.json');
    const mp = await wirewalk('markets', path.join(temp, 'markets-priya'), minimal, {policies: writes});
    const md = await wirewalk('markets', path.join(temp, 'markets-dario'), darioStart, {policies: writes, binding: load('examples/task-data/binding.json'),
      dataset: {...load('examples/task-data/dataset.json'), expected_counts: {records: darioStart.posts.length, assets: 1}},
      catalog: load('examples/task-data/assets.catalog.json')});
    const darioLoaded = await md.infra.call('env.snapshot');
    for (const r of [mp, md]) {
      for (const event of [scenario, ...fires]) assert.equal((await r.infra.call('env.apply_event', {expected_version: await version(r.infra), event})).status, 'committed');
      equal(r.infra.account + ': clock advanced to Monday 18:00', (await r.infra.call('env.advance_time', {expected_version: await version(r.infra),
        request_id: 'monday', virtual_now: T(12, '18:00')})).status, 'committed');
    }
    const publicPart = d => ({accounts: d.accounts, posts: d.posts});
    equal('Both reader instances carry the same public history', publicPart((await md.infra.call('env.snapshot')).snapshot.data),
      publicPart((await mp.infra.call('env.snapshot')).snapshot.data));
    equal('Dario\'s live state equals examples/task-data/seed.json', (await md.infra.call('env.snapshot')).snapshot.data, dario);
    const direct = await wirewalk('markets-direct', path.join(temp, 'markets-direct'), dario, {policies: writes, binding: load('examples/task-data/binding.json'),
      virtualNow: T(12, '18:00'), dataset: load('examples/task-data/dataset.json'), catalog: load('examples/task-data/assets.catalog.json')});
    equal('examples/task-data loads directly with its own dataset (shipped counts) and catalog', (await direct.infra.call('env.snapshot')).snapshot.data, dario);

    md.agent.seen = new Set();
    const marks = (await md.agent.call('wirewalk.bookmarks.list')).bookmarks.map(b => b.post);
    const analysts = [];
    for (const mark of marks) {
      const thread = (await md.agent.call('wirewalk.thread.get', {id: mark.id})).posts.filter(p => p.author.id === mark.author.id);
      const reposts = [];
      for (const p of thread) reposts.push(...(await md.agent.call('wirewalk.post.get', {id: p.id})).post.reposted_by);
      analysts.push({name: mark.author.display_name, id: mark.author.id, link: mark.link, text: thread.map(p => p.text).join(' '),
        sentences: thread.flatMap(p => sentences(p.text)), reposts});
    }
    const allReposts = (await md.agent.call('wirewalk.search', {kind: 'repost', since: T(12, '00:00'), limit: 50})).posts;
    const company = (await md.agent.call('wirewalk.search', {author_id: 'alder-glass', query: 'shipments'})).posts[0];
    const read = id => analysts.find(x => x.id === id);
    const odile = read('odile-park'), ravi = read('ravi-castellano'), darioPosts = (await md.infra.call('env.snapshot')).snapshot.data.posts;
    ok('Both bookmarked threads start from the same 12% shipment rise and name the reorder rate',
      analysts.every(x => /12%/.test(x.text) && /reorder rate/.test(x.text)) && /12%/.test(company.text));
    const sources = [...new Set(allReposts.map(p => p.source.author_id))];
    equal('All twelve reposts trace to one analyst', [allReposts.length, sources, odile.reposts.length, ravi.reposts.length], [12, ['odile-park'], 12, 0]);
    // Scripted reference agent: every claim in the reply is a sentence the tools returned, quoted verbatim and
    // picked by what it says (the reading, the reorder figure, "not out yet"). The checks confirm each quote
    // against that analyst's own posts in Infra's snapshot, not against this template's wording.
    const pick = (list, pattern) => list.find(x => pattern.test(x)) || null;
    for (const x of analysts) {
      x.reading = pick(x.sentences, /\bread\b/i);
      x.deciding = pick(x.sentences, /reorder/i);
      x.unreported = pick(x.sentences, /isn't out yet|hasn't been reported|not (been )?reported/i);
    }
    const figureSentence = pick(sentences(company.text), /\d+%/), figure = /\d+%/.exec(figureSentence)[0];
    const sourcePosts = [...new Set(allReposts.map(p => p.source.id))].sort(), sourceNames = [...new Set(allReposts.map(p => p.source.author_name))];
    replies.markets = [
      'Shared figure: ' + company.author.display_name + ' posted "' + figureSentence + '" (' + company.link + ').',
      ...analysts.map(x => x.name + ' (' + x.link + ') reads it this way: "' + x.reading + '"'),
      'What would settle it, in their own words: ' + analysts.map(x => x.name + ': "' + x.deciding + '"').join(' '),
      'Neither has that number yet: ' + analysts.map(x => x.name + ': "' + x.unreported + '"').join(' ') + ' Listen for it on the call.',
      'The ' + allReposts.length + ' reposts in the feed all point to ' + sourceNames.join(', ') + '\'s thread (' + sourcePosts.join(', ') +
        '): one source, not ' + allReposts.length + '.',
    ].join('\n');
    const own = id => darioPosts.filter(p => p.author_id === id).map(p => p.text);
    ok('Markets reply: each analyst\'s reading, deciding figure and "not reported yet" are quoted from that analyst\'s own posts',
      analysts.every(x => [x.reading, x.deciding, x.unreported].every(q => q && own(x.id).some(t => t.includes(q)) && replies.markets.includes('"' + q + '"'))));
    ok('Markets reply: the two readings differ, and both analysts name the reorder figure as what would settle it',
      odile.reading !== ravi.reading && analysts.every(x => /reorder/i.test(x.deciding)) && replies.markets.includes(odile.link) && replies.markets.includes(ravi.link));
    ok('Markets reply: the shared figure is quoted from the company post and appears in both threads',
      own('alder-glass').some(t => t.includes(figureSentence)) && analysts.every(x => x.text.includes(figure)) && replies.markets.includes(company.link));
    equal('Markets reply: the reposts are counted from tool output as one source', [sourcePosts, sourceNames, allReposts.length], [['p29', 'p30'], ['Odile Park'], 12]);
    turnRecord({run: 'markets', ww: md}, T(12, '18:00'), 'reply only (no other App)');

    // Bookmarks: idempotent retries, conflicts, stale versions, concurrent writes and account isolation.
    const v0 = await version(md.infra);
    const addArgs = {id: 'p28', expected_version: v0, request_id: 'dario-bookmark-p28'};
    const added = await md.agent.call('wirewalk.bookmarks.add', addArgs);
    equal('Bookmark add returns the post ID and status only', [added.status, added.post_id, added.bookmarked, added.changed, 'text' in added], ['committed', 'p28', true, true, false]);
    ok('A byte-identical retry returns the original result as a duplicate', (await md.agent.call('wirewalk.bookmarks.add', copy(addArgs))).duplicate === true);
    equal('Reusing the request ID for another post is rejected', (await md.agent.call('wirewalk.bookmarks.add', {...addArgs, id: 'p32'})).status, 'idempotency_conflict');
    const marksBeforeStale = (await md.infra.call('env.snapshot')).snapshot.data.bookmarks;
    equal('A stale expected_version is rejected', (await md.agent.call('wirewalk.bookmarks.add', {id: 'p32', expected_version: v0, request_id: 'dario-stale'})).status, 'stale_version');
    equal('The stale write leaves the bookmark set unchanged', (await md.infra.call('env.snapshot')).snapshot.data.bookmarks, marksBeforeStale);
    const second = await open('wirewalk', 'ww-dario', 'agent', 'markets', path.join(temp, 'markets-dario'), prepared.registry);
    const v1 = await version(md.infra);
    const raced = await Promise.all([md.agent.call('wirewalk.bookmarks.add', {id: 'p30', expected_version: v1, request_id: 'race-a'}),
      second.call('wirewalk.bookmarks.add', {id: 'p32', expected_version: v1, request_id: 'race-b'})]);
    equal('Two writes against one observed version: one commits, one is stale', raced.map(r => r.status).sort(), ['committed', 'stale_version']);
    const afterRace = (await md.infra.call('env.snapshot')).snapshot.data.bookmarks.map(b => b.post_id);
    equal('Only the committed write\'s bookmark exists', afterRace.filter(id => id === 'p30' || id === 'p32'), [raced[0].status === 'committed' ? 'p30' : 'p32']);
    // The next turn: Infra advances the clock and the agent reconnects; the bookmarks are still there.
    equal('Infra advances Dario\'s clock for the next turn', (await md.infra.call('env.advance_time', {expected_version: await version(md.infra),
      request_id: 'next-turn', virtual_now: T(12, '18:30')})).status, 'committed');
    const nextTurn = await open('wirewalk', 'ww-dario', 'agent', 'markets', path.join(temp, 'markets-dario'), prepared.registry);
    equal('Bookmarks persist into the next turn on a new Agent connection', (await nextTurn.call('wirewalk.bookmarks.list')).bookmarks.map(b => b.post.id).sort(), afterRace.slice().sort());
    const removeArgs = {id: 'p28', expected_version: await version(md.infra), request_id: 'dario-unbookmark-p28'};
    const removed = await md.agent.call('wirewalk.bookmarks.remove', removeArgs);
    equal('Removing a bookmark', [removed.bookmarked, removed.changed], [false, true]);
    const removeRetry = await md.agent.call('wirewalk.bookmarks.remove', copy(removeArgs));
    equal('A byte-identical retry of the removal returns the original result as a duplicate', [removeRetry.duplicate, removeRetry.changed], [true, true]);
    const marksBeforeStaleRemove = (await md.infra.call('env.snapshot')).snapshot.data.bookmarks;
    const staleRemove = await md.agent.call('wirewalk.bookmarks.remove', {id: 'p29', expected_version: v0, request_id: 'dario-stale-remove'});
    equal('A stale removal is rejected and leaves the bookmark set unchanged',
      [staleRemove.status, (await md.infra.call('env.snapshot')).snapshot.data.bookmarks], ['stale_version', marksBeforeStaleRemove]);
    equal('Bookmarking an unknown post gets the unavailable response', (await md.agent.call('wirewalk.bookmarks.add', {id: 'p999',
      expected_version: await version(md.infra), request_id: 'dario-missing'})).status, 'not_found');
    const darioMarks = (await md.agent.call('wirewalk.bookmarks.list')).bookmarks.map(b => b.post.id);
    equal('Priya\'s instance never sees Dario\'s bookmarks', (await mp.agent.call('wirewalk.bookmarks.list')).bookmarks.map(b => b.post.id), ['p01']);
    equal('The bookmark tools take no account argument', (await mp.agent.call('wirewalk.bookmarks.list', {account_id: 'ww-dario'})).status, 'invalid_arguments');
    // Event idempotency on Priya's instance.
    const replay = await mp.infra.call('env.apply_event', {expected_version: await version(mp.infra), event: scenario});
    const changed = copy(scenario); changed.payload.text = 'A different reply under the same event ID';
    const reused = await mp.infra.call('env.apply_event', {expected_version: await version(mp.infra), event: changed});
    const badParent = copy(scenario); badParent.event_id = 'bad-parent'; badParent.at = T(12, '18:00'); badParent.payload.id = 'p90'; badParent.payload.parent_id = 'p999';
    const beforeBad = await mp.infra.call('env.snapshot');
    const invalid = await mp.infra.call('env.apply_event', {expected_version: beforeBad.version, event: badParent});
    equal('Replaying an event ID is deduplicated; changed content under it is a conflict; an unknown parent is invalid',
      [replay.duplicate, reused.status, invalid.status], [true, 'idempotency_conflict', 'invalid_event']);
    equal('The invalid event leaves data unchanged', (await mp.infra.call('env.snapshot')).snapshot.data, beforeBad.snapshot.data);
    equal('Replaying leaves one reply', (await mp.infra.call('env.snapshot')).snapshot.data.posts.filter(p => p.id === 'p19').length, 1);
    // Dario's reset restores his loaded bookmarks and clock; Priya keeps her history.
    const darioBefore = await md.infra.call('env.snapshot');
    evidence.snapshots_before_reset.push({run: 'markets', app: 'wirewalk', account: 'ww-dario', version: darioBefore.version, virtual_now: darioBefore.snapshot.virtual_now,
      posts: darioBefore.snapshot.data.posts.length, bookmarks: darioBefore.snapshot.data.bookmarks.map(b => b.post_id),
      event_receipts: Object.keys(darioBefore.snapshot.receipts).filter(k => !k.startsWith('clock:')), audit: retainAudit(darioBefore, 'markets', 'ww-dario')});
    const darioAudit = evidence.snapshots_before_reset[1].audit;
    ok('markets: every retained Core audit row for Dario joins one trace row, across all his connections',
      darioAudit.length > 0 && darioAudit.every(r => r.trace_seq !== null) && new Set(darioAudit.map(r => r.client_name)).size >= 3);
    ok('The denied attempts stay distinguishable in the audit: stale, conflicting and unknown-post bookmark writes, and the stale removal',
      ['stale_version', 'idempotency_conflict', 'not_found'].every(st => darioAudit.some(r => r.tool === 'wirewalk.bookmarks.add' && r.status === st)) &&
      darioAudit.some(r => r.tool === 'wirewalk.bookmarks.remove' && r.status === 'stale_version' && r.decision === 'deny'));
    equal('Successful replays added no audit row: one committed audit row each for an add and a removal the trace shows twice',
      ['dario-bookmark-p28', 'dario-unbookmark-p28'].map(id => [darioAudit.filter(r => r.request_id === id && r.status === 'committed').length,
        trace.filter(t => t.request_id === id && t.status === 'committed').length]), [[1, 2], [1, 2]]);
    equal('Dario reset returns ready', (await md.infra.call('env.reset', {expected_version: darioBefore.version})).status, 'ready');
    const darioAfter = (await md.infra.call('env.snapshot')).snapshot;
    equal('Reset restores Dario\'s loaded history, bookmarks and clock', [darioAfter.data, darioAfter.virtual_now],
      [darioLoaded.snapshot.data, darioLoaded.snapshot.virtual_now]);
    equal('Resetting Dario leaves Priya\'s instance intact', (await mp.infra.call('env.snapshot')).snapshot.data.posts.length, 44);
    observations.bookmarks = {dario_before_reset: darioMarks, dario_after_reset: darioAfter.data.bookmarks.map(b => b.post_id)};

    // ---- Paging: a cursor keeps its result set when another post arrives at the same timestamp.
    const pg = await wirewalk('paging', path.join(temp, 'paging'), minimal, {virtualNow: T(11, '14:30')});
    for (const id of ['p22', 'p23', 'p24', 'p25']) assert.equal((await pg.infra.call('env.apply_event', {expected_version: await version(pg.infra), event: fire(id)})).status, 'committed');
    const page1 = await pg.agent.call('wirewalk.search', {author_id: 'tamsen-oem', limit: 2});
    assert.equal((await pg.infra.call('env.apply_event', {expected_version: await version(pg.infra), event: fire('p26')})).status, 'committed');
    const page2 = await pg.agent.call('wirewalk.search', {author_id: 'tamsen-oem', limit: 2, cursor: page1.next_cursor});
    const fresh = await pg.agent.call('wirewalk.search', {author_id: 'tamsen-oem', limit: 2});
    equal('The cursor continues its original set; a fresh search leads with the post that arrived at the same 18:05 timestamp',
      [page1.posts.map(p => p.id), page2.posts.map(p => p.id), page2.total, fresh.posts.map(p => p.id), fresh.total],
      [['p25', 'p24'], ['p21', 'p20'], 4, ['p26', 'p25'], 5]);
    observations.paging = {first_page: page1.posts.map(p => p.id + ' ' + p.published_at), as_of: page1.as_of, after_same_time_event: page2.posts.map(p => p.id),
      fresh: fresh.posts.map(p => p.id + ' ' + p.published_at)};

    // Counting: a logical write is counted once however often it is replayed; denials keep their status.
    const counts = {}, logical = new Set();
    for (const row of trace) {
      const key = row.duplicate ? 'duplicate_replay' : row.status;
      counts[key] = (counts[key] || 0) + 1;
      const id = row.request_id ?? row.event_id;
      if (row.status === 'committed' && !row.duplicate && id) logical.add([row.run, row.app, row.account, id].join('|'));
    }
    const eastPublish = trace.filter(r => r.run === 'train-east' && r.tool === 'router.publish' && r.status === 'committed');
    equal('train-east: three committed publish responses (two of them replays) count as one logical delivery',
      [eastPublish.length, eastPublish.filter(r => r.duplicate).length, [...logical].filter(k => k.startsWith('train-east|messaging|')).length], [3, 2, 1]);
    const report = {
      app: 'wirewalk', package_sha256: packageSha256, runtime: require(path.join(runtime, 'package.json')).version, node: process.version,
      dependencies_used: {mail: require(path.join(MAIL, 'app.json')).version, calendar: require(path.join(CALENDAR, 'app.json')).version, messaging: 'runtime/messaging'},
      passed: true, checks, reference_replies: replies, observations,
      evidence: {...evidence, mail_wire_fixture: 'examples/mail-wire.json',
        joins: 'Trace rows join Core audit rows by run/app/account, connection (= audit client_name), tool, request_id or event_id and status (snapshots_before_reset[].audit[].trace_seq); Wirewalk history joins by event receipt and published_at; a delivery joins Mail Sent record -> CloudEvents source+id -> Messaging receipt event_id/target/version -> inbox record id (= event_id) -> receiver env.event_status.'},
      management_call_example: managementCall,
      trace_summary: {calls: trace.length, by_outcome: counts, logical_committed_writes: logical.size,
        note: 'A logical write is one committed (run, app, account, request_id or event_id); duplicate replays are listed as duplicate_replay and add none; denials keep their status.'},
      trace,
    };
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
    fs.rmSync(temp, {recursive: true, force: true});
  }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
