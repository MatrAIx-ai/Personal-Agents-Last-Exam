#!/usr/bin/env node
'use strict';
// Real-MCP walkthrough of the approved Kinodex workflows through the public runtime.
// - Dana (US; Brightreel, Northcast) and Ines (UK; Northcast, Kettlewing) are two Kinodex instances
//   loaded with the same public catalog. Infra applies every catalog event to both, and the three
//   example requests run against both accounts with different right answers.
// - A controls instance and an account-change instance cover the acceptance controls, Core retries,
//   stale versions, policy constraints, failed events, clock-only changes and reset.
// A scripted reference agent answers each request from what its account saw; these replies are reference
// evidence for the data and tools, not model-agent trials. Prints a JSON evidence report with every call
// joined to run, account, connection and request/event ID.
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
const RUN = 'december';
const PT = (date, time) => date + 'T' + time + ':00-08:00';
// Supplied by each task's user context, not by Kinodex.
const CONTEXT = {
  'kinodex-dana': {utc_offset_hours: -8, child: 'Mira', companion: 'person-jules', companion_name: 'Jules'},
  'kinodex-ines': {utc_offset_hours: 0, child: 'her nephew', companion: 'person-tomas', companion_name: 'Tomas'},
};
const TRIP = {flight_date: '2026-11-26', films: ['Salt Year', 'The Wrenfield Clock', 'Pellmoor Junction'], series: 'Harbor Lights',
  episodes: [[1, 1, '2026-11-27'], [1, 2, '2026-11-28']], runtime_claim: {title: 'Salt Year', minutes: 142}};
const SPOILER = /barn|burn|fire|trapped|flames/i;

async function main() {
  const packageSha256 = digestTree(pkg);
  const prepared = prepare(pkg);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kinodex-walkthrough-'));
  const clients = [], checks = [], trace = [], observations = {}, replies = {};
  const ok = (label, condition) => {assert.ok(condition, label); checks.push(label);};
  const equal = (label, actual, expected) => {assert.deepEqual(actual, expected, label); checks.push(label);};

  // Every call goes through here so the trace joins run, account, connection and request/event IDs,
  // and each instance tracks its current Core version from the latest non-duplicate result.
  async function open(r, role, stateDir) {
    const client = new Client('kinodex', role, RUN, stateDir, 'kinodex-walkthrough', {registry: prepared.registry});
    clients.push(client); await client.initialize();
    const connection = r.account + '/' + r.label + '/' + role + '#' + clients.length;
    return {
      raw: client,
      async call(name, args = {}) {
        const result = await client.call(name, args);
        trace.push({seq: trace.length + 1, run: RUN, instance: r.label, account: r.account, connection, tool: name,
          request_id: args.request_id ?? null, event_id: args.event?.event_id ?? null,
          status: result.status, duplicate: result.duplicate === true, version: result.version ?? null});
        if (result.version && result.duplicate !== true) r.v = result.version;
        return result;
      },
    };
  }
  async function instance(label, account, {data, binding, policies, dataset, virtualNow}) {
    const r = {label, account, v: null}, dir = path.join(temp, label);
    r.infra = await open(r, 'infra', dir); r.agent = await open(r, 'agent', dir);
    const s = await r.infra.call('env.snapshot');
    const bundle = copy(s.snapshot.resources.bundle);
    if (dataset) bundle.dataset = dataset;
    const loaded = await r.infra.call('env.load_seed', {expected_version: s.version, request_id: 'load-' + label, data, binding, policies, bundle,
      ...(virtualNow ? {virtual_now: virtualNow} : {})});
    assert.equal(loaded.status, 'ready', JSON.stringify(loaded));
    return r;
  }
  let sequence = 0;
  const write = (r, name, args) => r.agent.call(name, {...args, expected_version: r.v, request_id: r.label + '-w' + (++sequence)});
  const snapshot = async r => (await r.infra.call('env.snapshot')).snapshot;
  const advance = async (r, to) => {
    const out = await r.infra.call('env.advance_time', {expected_version: r.v, request_id: r.label + '-clock-' + to, virtual_now: to});
    assert.equal(out.status, 'committed', JSON.stringify(out));
    return out;
  };
  let managementCall = null;
  const applyEvent = async (r, event) => {
    const args = {expected_version: r.v, event};
    if (!managementCall) managementCall = {method: 'tools/call', params: {name: 'env.apply_event', arguments: copy(args)}};
    return r.infra.call('env.apply_event', args);
  };
  const catalog = d => ({services: d.services, titles: d.titles, episodes: d.episodes, people: d.people, credits: d.credits, guides: d.guides,
    offers: d.offers, public_reviews: d.public_reviews});
  const weekEnd = (now, offset) => {
    const local = new Date(Date.parse(now) + offset * 3600e3), sunday = (7 - local.getUTCDay()) % 7;
    return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + sunday, 23, 59, 59) - offset * 3600e3;
  };
  const dayName = (iso, offset) => new Date(Date.parse(iso) + offset * 3600e3).toLocaleDateString('en-US', {weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC'});
  const money = (o) => ({USD: '$', GBP: '£', CAD: 'CA$'}[o.currency] + o.price.toFixed(2));

  // ---- Scripted reference agent -------------------------------------------------------------
  async function findTitle(r, name) {
    return (await r.agent.call('kinodex.titles.search', {query: name})).titles.find(t => t.name === name).title_id;
  }
  // Request 2, session 1: which watchlist titles leave the person's subscriptions this week.
  async function leavingThisWeek(r) {
    const ctx = CONTEXT[r.account], wl = await r.agent.call('kinodex.watchlist.get');
    const s = await r.agent.call('kinodex.offers.search', {title_ids: wl.items.map(i => i.title_id), on_my_services: true});
    const end = weekEnd(s.as_of, ctx.utc_offset_hours);
    const leaving = s.results.filter(x => x.my_subscriptions.status === 'leaving_soon' && Date.parse(x.my_subscriptions.available_until) <= end)
      .sort((a, b) => Date.parse(a.my_subscriptions.available_until) - Date.parse(b.my_subscriptions.available_until));
    const kept = s.results.filter(x => x.my_subscriptions.status === 'available' && x.offers.some(o => o.type === 'subscription' && o.availability === 'leaving_soon'));
    const notes = [], mineServices = (await r.agent.call('kinodex.account.get')).account.service_ids;
    for (const x of leaving) {
      const subscribedElsewhere = (await r.agent.call('kinodex.offers.for_title', {title_id: x.title_id})).result.offers
        .filter(o => o.type === 'subscription' && o.region !== s.region && mineServices.includes(o.service_id) && o.availability !== 'ended');
      notes.push(x.name + ' leaves ' + x.offers.find(o => o.type === 'subscription').service_name + ' on ' + dayName(x.my_subscriptions.available_until, ctx.utc_offset_hours) +
        (subscribedElsewhere.length ? ' (its ' + subscribedElsewhere.map(o => o.service_name + ' offer is ' + o.region).join(', ') + '-only)' : ''));
    }
    const keptText = kept.map(x => x.name + ' leaves ' + x.offers.find(o => o.availability === 'leaving_soon').service_name + ' on ' +
      dayName(x.offers.find(o => o.availability === 'leaving_soon').available_until, ctx.utc_offset_hours) + ' but stays on ' +
      x.offers.filter(o => o.type === 'subscription' && o.availability === 'available').map(o => o.service_name).join(' and ') + ', which you also have, so you keep it.');
    const order = [...leaving.map(x => x.title_id), ...wl.items.map(i => i.title_id).filter(id => !leaving.some(x => x.title_id === id))];
    // Skip the save when the leaving titles are already at the top (the App would return no_change).
    const saved = JSON.stringify(order) === JSON.stringify(wl.items.map(i => i.title_id)) ? null
      : await write(r, 'kinodex.watchlist.save', {title_ids: order, expected_watchlist_version: wl.watchlist_version});
    const text = ['Leaving your services this week: ' + notes.join('; ') + '.', ...keptText,
      'I moved ' + leaving.map(x => x.name).join(' and ') + ' to the top of your watchlist and will check again on Monday.'].join(' ');
    return {before: wl, leaving: leaving.map(x => x.title_id), kept: kept.map(x => x.title_id), saved, order, text};
  }
  // Request 2, session 2 (Monday): recheck and set one return alert per title that was lost.
  async function mondayCheck(r, first, oldVersion) {
    const wl = await r.agent.call('kinodex.watchlist.get');
    const fresh = wl.version;
    const stale = await r.agent.call('kinodex.alerts.create', {kind: 'available_on_my_services', title_id: first.leaving[0], expected_version: oldVersion, request_id: r.label + '-stale-alert'});
    const s = await r.agent.call('kinodex.offers.search', {title_ids: [...first.leaving, ...first.kept], on_my_services: true});
    const lost = s.results.filter(x => first.leaving.includes(x.title_id) && x.my_subscriptions.status === 'none');
    const alerts = [];
    for (const x of lost) alerts.push(await write(r, 'kinodex.alerts.create', {kind: 'available_on_my_services', title_id: x.title_id}));
    const still = s.results.filter(x => first.kept.includes(x.title_id));
    const text = lost.map(x => x.name).join(' and ') + (lost.length > 1 ? ' have' : ' has') + ' now left your subscriptions' +
      (lost.some(x => x.offers.some(o => o.type === 'rent')) ? ' (' + lost.filter(x => x.offers.some(o => o.type === 'rent')).map(x => x.name + ' can still be rented on ' + x.offers.find(o => o.type === 'rent').service_name).join('; ') + ')' : '') +
      '. I set ' + (lost.length > 1 ? 'an alert for each' : 'an alert') + ' and will tell you when ' + (lost.length > 1 ? 'one is' : 'it is') + ' included with your subscriptions again.' +
      (still.length ? ' ' + still.map(x => x.name + ' is still on ' + x.offers.filter(o => o.type === 'subscription').map(o => o.service_name).join(' and ')).join('; ') + '.' : '');
    return {watchlist: wl, fresh, stale, lost: lost.map(x => x.title_id), alerts, text};
  }
  // Request 2, follow-up session: read the notices written by the restoring event.
  async function followUp(r, since) {
    const notices = (await r.agent.call('kinodex.notices.list', {since, kind: 'alert_triggered'})).notices;
    const alerts = (await r.agent.call('kinodex.alerts.list', {status: 'triggered'})).alerts.filter(a => notices.some(n => n.alert_id === a.alert_id));
    const text = alerts.map(a => {
      const service = notices.find(n => n.alert_id === a.alert_id).text.match(/your (.+) subscription/)[1];
      return 'Good news: ' + a.title_name + ' is back on ' + service + ' — it is included with your ' + service + ' subscription again (since ' + dayName(a.trigger.at, CONTEXT[r.account].utc_offset_hours) + ').';
    }).join(' ');
    return {notices, alerts, text};
  }
  // Request 1: is the film OK for a child tonight?
  async function okForChild(r) {
    const ctx = CONTEXT[r.account], id = await findTitle(r, 'Lantern Hill');
    const t = (await r.agent.call('kinodex.titles.get', {title_id: id, hide_spoilers: true})).title;
    const g = t.guide, v1 = (await r.agent.call('kinodex.guide.get', {title_id: id, version: 1, hide_spoilers: true})).guide;
    const changed = ['frightening', 'violence'].filter(c => g.categories[c].severity !== v1.categories[c].severity);
    const offers = (await r.agent.call('kinodex.offers.for_title', {title_id: id})).result;
    const region = (await r.agent.call('kinodex.account.get')).account.region;
    const sub = offers.my_subscriptions, rent = offers.offers.filter(o => o.region === region && o.type === 'rent' && o.availability !== 'ended' && o.availability !== 'upcoming')
      .sort((a, b) => a.price - b.price)[0];
    const subService = offers.offers.find(o => o.on_my_services && o.type === 'subscription' && o.availability !== 'upcoming')?.service_name;
    const local = new Date(Date.parse(sub.available_until || '2100-01-01T00:00:00Z') + ctx.utc_offset_hours * 3600e3).toISOString().slice(11, 16);
    const label = {frightening: 'frightening scenes', violence: 'violence'};
    const text = 'Lantern Hill is rated ' + t.certification + ' in the ' + region + ', but its parental guide was updated on ' + dayName(g.published_at, ctx.utc_offset_hours) +
      ' (version ' + g.version + '): ' + changed.map(c => label[c] + ' went from ' + v1.categories[c].severity + ' to ' + g.categories[c].severity).join(' and ') +
      ', and the frightening-scenes summary now says "' + g.categories.frightening.summary.replace(/\.$/, '') + '". ' +
      (g.categories.frightening.withheld_items ? 'One frightening-scenes detail is marked as a spoiler, so I have left it out. ' : '') +
      (sub.status === 'leaving_soon' ? 'It is included with ' + subService + ' until ' + local + ' tonight; after midnight it is rent-only at ' + money(rent) + '.'
        : sub.status === 'available' ? 'It is on your ' + subService + ' subscription with no end date, so there is no rush.' : 'It is not on your services; renting costs ' + money(rent) + '.');
    return {title: t, guide: g, v1, offers, text};
  }
  // Request 3: log the trip in the person's own rating style; no correction when the edition exists.
  async function logTrip(r) {
    const ctx = CONTEXT[r.account];
    const diary = (await r.agent.call('kinodex.diary.list', {limit: 500})).entries;
    const ratings = diary.map(e => e.rating).filter(x => x !== null);
    const step = ratings.every(Number.isInteger) ? 1 : 0.5, max = Math.max(...ratings), min = Math.min(...ratings);
    const mean = ratings.reduce((s, x) => s + x, 0) / ratings.length;
    const fit = x => Math.min(max, Math.max(min, Math.round(x / step) * step));
    const logged = [], notes = [];
    let correctionNeeded = false;
    for (const name of TRIP.films) {
      const id = await findTitle(r, name), prior = diary.filter(e => e.title_id === id);
      let edition_id;
      if (name === TRIP.runtime_claim.title) {
        const editions = (await r.agent.call('kinodex.titles.get', {title_id: id})).title.editions;
        const match = editions.find(e => e.runtime_minutes === TRIP.runtime_claim.minutes);
        if (match) {edition_id = match.edition_id; notes.push(name + ' is listed as a ' + editions.map(e => e.runtime_minutes + '-minute ' + e.label.toLowerCase()).join(' and a ') +
          ' edition; the airline showed the ' + match.label.toLowerCase() + ' edition, so the runtime is not wrong and I did not submit a correction.');}
        else correctionNeeded = true;
      }
      const pub = (await r.agent.call('kinodex.reviews.list', {title_id: id, source: 'public'})).reviews.map(x => x.rating);
      const rating = prior.length ? prior[0].rating : fit(pub.length ? mean + (pub.reduce((s, x) => s + x, 0) / pub.length - 3) : mean);
      const out = await write(r, 'kinodex.diary.log', {title_id: id, ...(edition_id ? {edition_id} : {}), watched_on: TRIP.flight_date, rewatch: prior.length > 0,
        watched_with: [ctx.companion], rating});
      logged.push(out.entry);
      if (prior.length) notes.push(name + ' is marked as a rewatch (first logged ' + prior[prior.length - 1].watched_on + ').');
    }
    const series = await findTitle(r, TRIP.series), episodes = (await r.agent.call('kinodex.episodes.list', {title_id: series})).episodes;
    for (const [s, n, date] of TRIP.episodes) {
      const ep = episodes.find(e => e.season_number === s && e.number === n);
      logged.push((await write(r, 'kinodex.diary.log', {title_id: series, episode_ids: [ep.episode_id], watched_on: date, watched_with: [ctx.companion], rating: fit(mean)})).entry);
    }
    const text = 'Logged ' + logged.length + ' entries with ' + ctx.companion_name + ': ' + logged.map(e => e.title_name + (e.episodes.length ? ' S' + e.episodes[0].season_number + 'E' + e.episodes[0].number : '') +
      ' (' + e.rating + ')').join(', ') + '. Ratings use your usual ' + (step === 1 ? 'whole-star' : 'half-star') + ' scale. ' + notes.join(' ');
    return {logged, correctionNeeded, style: {step, min, max, mean: Math.round(mean * 100) / 100}, text};
  }

  try {
    // ---- Package defaults: the Agent sees reads only; writes need a task policy ----------------
    const d = {label: 'default', account: 'kinodex-dana', v: null}, defaultDir = path.join(temp, 'default');
    d.infra = await open(d, 'infra', defaultDir); // Infra initializes a run before an Agent connects.
    d.agent = await open(d, 'agent', defaultDir);
    const defaultTools = (await d.agent.raw.request('tools/list')).result.tools.map(t => t.name);
    ok('Default scenario policy exposes the 18 read tools only', defaultTools.length === 18 && defaultTools.every(n => require(path.join(pkg, 'tools.json')).find(t => t.name === n).read_only));
    equal('Default policy denies agent writes', (await d.agent.call('kinodex.watchlist.save', {title_ids: [], expected_version: {epoch: 1, revision: 0}, request_id: 'denied'})).status, 'permission_denied');
    for (const name of ['env.apply_event', 'env.load_seed', 'env.reset', 'env.snapshot', 'env.advance_time']) {
      equal('Agent cannot call ' + name, (await d.agent.call(name, {})).status, 'permission_denied');
    }

    // ---- Two accounts, one catalog ---------------------------------------------------------
    const writes = load('examples/task-data/policies.json');
    const dana = await instance('dana', 'kinodex-dana', {data: load('fixtures/minimal.json'), binding: load('fixtures/binding.json'), policies: writes});
    const ines = await instance('ines', 'kinodex-ines', {data: load('examples/task-data/seed.json'), binding: load('examples/task-data/binding.json'), policies: writes,
      dataset: load('examples/task-data/dataset.json')});
    const loadedDana = await snapshot(dana);
    equal('Both accounts load the same catalog at the fixture clock', [catalog((await snapshot(ines)).data), loadedDana.virtual_now], [catalog(loadedDana.data), load('fixtures/clock.json').initial_time]);

    // Session 1, Tue Dec 1 09:00: request 2 (leaving this week), then request 3 (log the trip).
    const r2 = {}, r3 = {};
    for (const r of [dana, ines]) {
      r2[r.account] = await leavingThisWeek(r);
      r2[r.account].session1Version = r.v;
      r3[r.account] = await logTrip(r);
    }
    const D2 = r2['kinodex-dana'], I2 = r2['kinodex-ines'];
    equal('Dana: Copper Sky and Quiet Harbour leave her services this week', D2.leaving, ['tt-copper-sky', 'tt-quiet-harbour']);
    equal('Dana: Fieldglass leaves Brightreel but stays on Northcast', D2.kept, ['tt-fieldglass']);
    ok('Dana: the reply names both titles and explains Fieldglass', /Copper Sky/.test(D2.text) && /Quiet Harbour/.test(D2.text) && /Fieldglass leaves Brightreel .* stays on Northcast/.test(D2.text) && /Northcast offer is UK-only/.test(D2.text));
    equal('Dana: the watchlist is saved once at watchlist_version 2', [D2.saved.status, D2.saved.watchlist_version], ['committed', 2]);
    const danaWl = (await dana.agent.call('kinodex.watchlist.get')).items.map(i => i.title_id);
    equal('Dana: those two first, the rest in their original order', danaWl, ['tt-copper-sky', 'tt-quiet-harbour', ...D2.before.items.map(i => i.title_id).filter(id => !D2.leaving.includes(id))]);
    equal('Ines (UK): only Fieldglass leaves her services this week', I2.leaving, ['tt-fieldglass']);
    equal('Ines: her watchlist moves from watchlist_version 4 to 5', I2.saved.watchlist_version, 5);
    replies.request_2_session_1 = {'kinodex-dana': D2.text, 'kinodex-ines': I2.text};

    const D3 = r3['kinodex-dana'], I3 = r3['kinodex-ines'];
    for (const [r, R3, companion] of [[dana, D3, 'person-jules'], [ines, I3, 'person-tomas']]) {
      ok(r.account + ': five new diary entries on the trip dates with the companion in watched_with', R3.logged.length === 5 &&
        R3.logged.every(e => e.watched_with.includes(companion) && e.watched_on >= '2026-11-26' && e.watched_on <= '2026-11-28'));
      equal(r.account + ': the Salt Year entry names the extended edition', R3.logged.find(e => e.title_id === 'tt-salt-year').edition_id, 'ed-salt-year-extended');
      equal(r.account + ': no correction is submitted', [R3.correctionNeeded, (await snapshot(r)).data.corrections.length],
        [false, (r === dana ? load('fixtures/minimal.json') : load('examples/task-data/seed.json')).corrections.length]);
    }
    equal('Dana: The Wrenfield Clock (seen Nov 2025) is the one rewatch', D3.logged.filter(e => e.rewatch).map(e => e.title_id), ['tt-wrenfield-clock']);
    ok('Dana: half-star ratings, none 5, in her usual spread', D3.style.step === 0.5 && D3.style.max === 4.5 && D3.logged.every(e => Number.isInteger(e.rating * 2) && e.rating < 5) &&
      new Set(D3.logged.slice(0, 3).map(e => e.rating)).size > 1);
    equal('Ines: Salt Year (seen in 2025) is her rewatch, in whole stars', [I3.logged.filter(e => e.rewatch).map(e => e.title_id), I3.logged.every(e => Number.isInteger(e.rating))], [['tt-salt-year'], true]);
    replies.request_3 = {'kinodex-dana': D3.text, 'kinodex-ines': I3.text};
    observations.rating_style = {'kinodex-dana': D3.style, 'kinodex-ines': I3.style};

    // Fri Dec 4 18:00: the approved title.update example, applied by Infra to both accounts.
    const scenario = load('examples/scenario.json');
    for (const r of [dana, ines]) {
      const applied = await applyEvent(r, scenario);
      equal(r.account + ': lantern-hill-guide-v2 commits', applied.status, 'committed');
      const after = await r.infra.call('env.snapshot');
      equal(r.account + ': the event moves the clock to its time', after.snapshot.virtual_now, scenario.at);
      ok(r.account + ': replaying the identical event is a duplicate with no new version', (await r.infra.call('env.apply_event', {expected_version: after.version, event: scenario})).duplicate === true &&
        JSON.stringify((await r.infra.call('env.snapshot')).version) === JSON.stringify(after.version));
    }
    const changed = copy(scenario); changed.payload.guide_version.categories.violence.severity = 'severe';
    equal('Reusing an event ID with different content is an idempotency conflict', (await dana.infra.call('env.apply_event', {expected_version: dana.v, event: changed})).status, 'idempotency_conflict');

    // Sat Dec 5 19:00: request 1 (is Lantern Hill OK for a child tonight?).
    const before1 = {dana: (await snapshot(dana)).data, ines: (await snapshot(ines)).data};
    for (const r of [dana, ines]) await advance(r, PT('2026-12-05', '19:00'));
    const D1 = await okForChild(dana), I1 = await okForChild(ines);
    equal('Lantern Hill: version 2 is current, version 1 rated violence and frightening mild', [D1.guide.version, D1.v1.categories.violence.severity, D1.v1.categories.frightening.severity], [2, 'mild', 'mild']);
    ok('Dana\'s reply: moderate frightening scenes, sustained child peril, no barn detail', /frightening scenes went from mild to moderate/.test(D1.text) && /Sustained child peril/.test(D1.text) && !SPOILER.test(D1.text));
    ok('Dana\'s reply: Brightreel until 23:59 tonight, then $3.99 to rent', /Brightreel until 23:59 tonight/.test(D1.text) && /rent-only at \$3\.99/.test(D1.text) && /rated PG in the US/.test(D1.text));
    ok('Ines\'s reply: UK certificate PG and on her Kettlewing subscription with no end date', /rated PG in the UK/.test(I1.text) && /Kettlewing subscription with no end date/.test(I1.text) && !SPOILER.test(I1.text));
    ok('The spoiler-safe read withheld exactly the flagged barn item', D1.guide.categories.frightening.withheld_items === 1 && !SPOILER.test(JSON.stringify(D1.title)));
    equal('Request 1 changes no diary, rating or watchlist (Dana)', (await snapshot(dana)).data, before1.dana);
    equal('Request 1 changes nothing for Ines', (await snapshot(ines)).data, before1.ines);
    replies.request_1 = {'kinodex-dana': D1.text, 'kinodex-ines': I1.text};

    // Mon Dec 7 09:00: request 2, session 2. The Agent reads the new Core version before writing.
    for (const r of [dana, ines]) await advance(r, PT('2026-12-07', '09:00'));
    const D2b = await mondayCheck(dana, D2, D2.session1Version), I2b = await mondayCheck(ines, I2, I2.session1Version);
    ok('Session 2 reads a newer Core version than session 1 (clock and event moved it) while watchlist_version stays 2',
      D2b.fresh.revision > D2.session1Version.revision && D2b.watchlist.watchlist_version === 2);
    equal('A write with session 1\'s Core version is stale and stores nothing', [D2b.stale.status, (await snapshot(dana)).data.alerts.length], ['stale_version', load('fixtures/minimal.json').alerts.length + D2b.alerts.length]);
    equal('Dana: one available_on_my_services rule each for Copper Sky and Quiet Harbour, none for Fieldglass',
      D2b.alerts.map(a => [a.status, a.alert.title_id, a.alert.kind, a.alert.status]), [['committed', 'tt-copper-sky', 'available_on_my_services', 'active'], ['committed', 'tt-quiet-harbour', 'available_on_my_services', 'active']]);
    equal('Ines: one rule, for Fieldglass', I2b.alerts.map(a => a.alert.title_id), ['tt-fieldglass']);
    equal('The watchlist stays at version 2', (await dana.agent.call('kinodex.watchlist.get')).watchlist_version, 2);
    replies.request_2_session_2 = {'kinodex-dana': D2b.text, 'kinodex-ines': I2b.text};

    // Dec 8: US ads on Northcast (subscribed) leave the rule active. Dec 10: the restoring events.
    const notices0 = (await snapshot(dana)).data.notices.length;
    for (const r of [dana, ines]) equal(r.account + ': copper-sky-northcast-ads commits', (await applyEvent(r, load('examples/events/copper-sky-northcast-ads.json'))).status, 'committed');
    const afterAds = (await snapshot(dana)).data;
    equal('A US free_with_ads offer on Northcast plus the UK-only subscription and the Openfern ads leave the rule active with no notice',
      [afterAds.alerts.find(a => a.title_id === 'tt-copper-sky' && a.created_at === PT('2026-12-07', '09:00')).status, afterAds.notices.length], ['active', notices0]);
    for (const r of [dana, ines]) {
      equal(r.account + ': copper-sky-northcast-return commits', (await applyEvent(r, load('examples/events/copper-sky-northcast-return.json'))).status, 'committed');
      equal(r.account + ': fieldglass-uk-return commits', (await applyEvent(r, load('examples/events/fieldglass-uk-return.json'))).status, 'committed');
    }
    for (const r of [dana, ines]) await advance(r, PT('2026-12-10', '19:00'));
    const D2c = await followUp(dana, PT('2026-12-07', '09:00')), I2c = await followUp(ines, PT('2026-12-07', '09:00'));
    equal('Dana: one stored notice, for Copper Sky', D2c.notices.map(n => [n.title_id, n.event_id]), [['tt-copper-sky', 'copper-sky-northcast-return']]);
    equal('Dana: the rule is triggered and keeps the Northcast offer that fired it', [D2c.alerts[0].status, D2c.alerts[0].trigger.offer.service_id, D2c.alerts[0].trigger.offer.region, D2c.alerts[0].trigger.cause],
      ['triggered', 'northcast', 'US', 'event']);
    ok('Dana\'s follow-up reply names Copper Sky and Northcast', /Copper Sky is back on Northcast/.test(D2c.text));
    ok('Ines\'s follow-up reply names Fieldglass and Northcast', /Fieldglass is back on Northcast/.test(I2c.text) && I2c.notices.length === 1);
    replies.request_2_follow_up = {'kinodex-dana': D2c.text, 'kinodex-ines': I2c.text};
    // A second matching event writes no additional alert notice.
    const again = load('examples/events/copper-sky-northcast-return.json');
    again.event_id = 'copper-sky-northcast-4k'; again.at = PT('2026-12-11', '06:00'); again.payload.offer_id = 'of-copper-sky-northcast-us-4k'; again.payload.quality = '4K';
    again.payload.available_from = again.at;
    for (const r of [dana, ines]) equal(r.account + ': a second Copper Sky Northcast offer commits', (await applyEvent(r, again)).status, 'committed');
    equal('The second matching event adds no alert notice', (await snapshot(dana)).data.notices.filter(n => n.kind === 'alert_triggered').length, D2c.notices.length + load('fixtures/minimal.json').notices.filter(n => n.kind === 'alert_triggered').length);
    const finalDana = await snapshot(dana), finalInes = await snapshot(ines);
    equal('Both instances still carry identical catalogs after the same events', catalog(finalInes.data), catalog(finalDana.data));
    ok('Dana\'s and Ines\'s account state stays separate', finalDana.data.diary.length !== finalInes.data.diary.length && finalInes.data.alerts.every(a => a.title_id !== 'tt-copper-sky'));
    // Evaluator joins: one activity row per committed write or event, each joined to a Core receipt.
    const committed = trace.filter(t => t.instance === 'dana' && t.status === 'committed' && !t.duplicate && (t.tool === 'env.apply_event' || t.tool.startsWith('kinodex.')));
    equal('Dana: one activity row per committed write or event (none for replays, failures, reads or the clock)', finalDana.data.activity.length, committed.length);
    ok('Every activity row joins to a Core receipt by request_id or event_id', finalDana.data.activity.every(a =>
      finalDana.receipts[a.request_id ? 'request:' + a.request_id : 'event:' + a.event_id]));
    observations.request_2 = {dana_watchlist_after_session_1: danaWl, dana_alerts: finalDana.data.alerts.filter(a => a.created_at >= PT('2026-12-07', '00:00')).map(a => ({alert_id: a.alert_id, title_id: a.title_id, status: a.status, trigger: a.trigger})),
      ines_alerts: finalInes.data.alerts.map(a => ({alert_id: a.alert_id, title_id: a.title_id, status: a.status}))};
    observations.dana_activity = finalDana.data.activity.map(a => [a.seq, a.at, a.actor, a.action, a.request_id || a.event_id, a.object_id, a.effects]);

    // Snapshot before reset, then reset to the loaded data and clock.
    observations.snapshot_before_reset = {account: 'kinodex-dana', version: dana.v, virtual_now: finalDana.virtual_now, diary: finalDana.data.diary.length,
      alerts: finalDana.data.alerts.length, notices: finalDana.data.notices.length, activity: finalDana.data.activity.length,
      receipts: Object.keys(finalDana.receipts).length, audit_rows: finalDana.audit.length};
    equal('Reset returns ready', (await dana.infra.call('env.reset', {expected_version: dana.v})).status, 'ready');
    const afterReset = await snapshot(dana);
    equal('Reset restores the loaded catalog and account', afterReset.data, loadedDana.data);
    equal('Reset restores the loaded clock', afterReset.virtual_now, loadedDana.virtual_now);
    ok('Resetting Dana leaves Ines\'s instance unchanged', JSON.stringify((await snapshot(ines)).data) === JSON.stringify(finalInes.data));

    // ---- Controls instance: constraints, retries, W3-W5 controls, clock-only changes ----------
    const constrained = copy(writes);
    constrained.scenario.constraints = {'kinodex.diary.update': {fields: ['rating', 'review']}, 'kinodex.alerts.update': {fields: ['expires_at']}};
    const c = await instance('controls', 'kinodex-dana', {data: load('fixtures/minimal.json'), binding: load('fixtures/binding.json'), policies: constrained});
    const entry = (await c.agent.call('kinodex.diary.list', {title_id: 'tt-wrenfield-clock'})).entries[0].entry_id;
    equal('A task constraint on patch fields denies a watched_on edit', (await write(c, 'kinodex.diary.update', {id: entry, patch: {watched_on: '2025-11-15'}})).status, 'permission_denied');
    equal('The same tool accepts a permitted field', (await write(c, 'kinodex.diary.update', {id: entry, patch: {rating: 4.5}})).status, 'committed');
    const logArgs = {title_id: 'tt-harbor-lights', episode_ids: ['ep-harbor-lights-s1e1'], watched_on: '2026-11-27', watched_with: ['person-jules'], rating: 3.5,
      expected_version: c.v, request_id: 'controls-log-e1'};
    const first = await c.agent.call('kinodex.diary.log', logArgs), activity1 = (await snapshot(c)).data.activity.length;
    const retry = await c.agent.call('kinodex.diary.log', copy(logArgs));
    ok('A byte-identical retry returns the stored receipt marked duplicate, with no second entry', retry.duplicate === true && retry.id === first.id && (await snapshot(c)).data.activity.length === activity1);
    equal('The same request_id with different input is an idempotency conflict', (await c.agent.call('kinodex.diary.log', {...logArgs, rating: 4})).status, 'idempotency_conflict');
    equal('A stale Core expected_version is rejected', (await c.agent.call('kinodex.watchlist.save', {title_ids: ['tt-salt-year'], expected_version: logArgs.expected_version, request_id: 'controls-stale'})).status, 'stale_version');
    equal('A stale watchlist_version (App field) is rejected separately', (await write(c, 'kinodex.watchlist.save', {title_ids: ['tt-salt-year'], expected_watchlist_version: 7})).status, 'object_version_conflict');
    equal('A future watched_on returns invalid_date', (await write(c, 'kinodex.diary.log', {title_id: 'tt-salt-year', watched_on: '2026-12-02'})).status, 'invalid_date');
    equal('A rating of 3.3 returns invalid_rating', (await write(c, 'kinodex.diary.log', {title_id: 'tt-salt-year', watched_on: '2026-11-26', rating: 3.3})).status, 'invalid_rating');
    // hide_spoilers boundary follows the diary, including after a delete.
    const e2 = await write(c, 'kinodex.diary.log', {title_id: 'tt-harbor-lights', episode_ids: ['ep-harbor-lights-s1e2'], watched_on: '2026-11-28', watched_with: ['person-jules'], rating: 4});
    const shown = async () => (await c.agent.call('kinodex.titles.get', {title_id: 'tt-harbor-lights', hide_spoilers: true})).title.episodes.filter(e => e.synopsis !== null).map(e => e.episode_id);
    equal('Harbor Lights with hide_spoilers: synopses up to S1E2 only', await shown(), ['ep-harbor-lights-s1e1', 'ep-harbor-lights-s1e2']);
    const removed = await write(c, 'kinodex.diary.delete', {id: e2.id});
    equal('Deleting the entry returns the rating and review it removed', [removed.removed.rating, removed.removed.review], [4, null]);
    equal('After the delete the boundary moves back to S1E1', await shown(), ['ep-harbor-lights-s1e1']);
    const mira = await c.agent.call('kinodex.episodes.list', {title_id: 'tt-pocket-comets', hide_spoilers: true, as_of_person: 'person-mira'});
    const danaComets = await c.agent.call('kinodex.episodes.list', {title_id: 'tt-pocket-comets', hide_spoilers: true});
    equal('Mira\'s boundary comes from Dana\'s entries with Mira in watched_with (episode 4; Dana\'s is 5)',
      [mira.spoiler_boundary.furthest_episode.number, danaComets.spoiler_boundary.furthest_episode.number], [4, 5]);
    // W4 controls.
    const already = await write(c, 'kinodex.alerts.create', {kind: 'available_on_my_services', title_id: 'tt-copper-sky'});
    ok('While Brightreel still carries Copper Sky, the rule returns already_true with the offer and stores nothing',
      already.status === 'already_true' && /offer of-\d+ \(Brightreel, subscription, US/.test(already.message) && !(await snapshot(c)).data.alerts.some(a => a.title_id === 'tt-copper-sky' && a.status !== 'deleted' && a.created_at > '2026-11'));
    const amber = await write(c, 'kinodex.alerts.create', {kind: 'available_on_my_services', title_id: 'tt-ambervane'});
    equal('An upcoming Northcast offer does not make the Ambervane rule already_true', amber.alert.status, 'active');
    equal('A second identical rule returns duplicate_alert', (await write(c, 'kinodex.alerts.create', {kind: 'available_on_my_services', title_id: 'tt-ambervane'})).status, 'duplicate_alert');
    equal('price_below on subscription-only Fieldglass returns invalid_threshold', (await write(c, 'kinodex.alerts.create', {kind: 'price_below', title_id: 'tt-fieldglass', offer_type: 'rent', threshold: 3})).status, 'invalid_threshold');
    const expiring = await write(c, 'kinodex.alerts.create', {kind: 'price_below', title_id: 'tt-salt-year', offer_type: 'buy', threshold: 10, expires_at: PT('2026-12-06', '12:00')});
    // W5: submit corrections while the clock is at Dec 1.
    const submit = (target, value) => write(c, 'kinodex.corrections.submit', {title_id: 'tt-salt-year', field: 'runtime', target, proposed_value: value, evidence: 'The in-flight edition ran 142 minutes.'});
    const theatrical = await submit({edition_id: 'ed-salt-year-theatrical'}, 142);
    equal('142 minutes for the theatrical edition of Salt Year is accepted (submitted, current 118)', [theatrical.status, theatrical.correction.status, theatrical.correction.current_value], ['committed', 'submitted', 118]);
    equal('142 minutes for the extended edition returns no_change', (await submit({edition_id: 'ed-salt-year-extended'}, 142)).status, 'no_change');
    equal('A second open correction for the same title, field and edition returns already_submitted', (await submit({edition_id: 'ed-salt-year-theatrical'}, 140)).status, 'already_submitted');
    const guideCorrection = await write(c, 'kinodex.corrections.submit', {title_id: 'tt-harbor-lights', field: 'guide_item', target: {item_id: 'gi-hl-storm'},
      proposed_value: {spoiler: true}, evidence: 'The storm scene shows who survives the ferry sinking.'});
    // Clock alone (Dec 3 10:00): offers, the leaving window and alert expiry change in reads only.
    const atDec1 = await snapshot(c);
    await advance(c, PT('2026-12-03', '10:00'));
    const ambervaneNow = (await c.agent.call('kinodex.offers.for_title', {title_id: 'tt-ambervane', region: 'US'})).result;
    const marrow = (await c.agent.call('kinodex.offers.search', {query: 'marrow bay', on_my_services: true})).results[0];
    const listed = Object.fromEntries((await c.agent.call('kinodex.alerts.list')).alerts.map(a => [a.alert_id, a.status]));
    const fieldglass = (await c.agent.call('kinodex.offers.search', {title_ids: ['tt-fieldglass'], on_my_services: true})).results[0];
    equal('By the clock alone: Ambervane is available on Northcast, but its rule stays active (item 2)', [ambervaneNow.my_subscriptions.status, listed[amber.id]], ['available', 'active']);
    equal('By the clock alone: Fieldglass\'s Brightreel offer passes its end time (Northcast remains), Marrow Bay enters the seven-day window and al-04 reaches expires_at',
      [fieldglass.offers.map(o => o.service_id), fieldglass.my_subscriptions.status, marrow.my_subscriptions.status, listed['al-04']], [['northcast'], 'available', 'leaving_soon', 'expired']);
    const atDec3 = await snapshot(c);
    equal('Time passing writes no activity row, notice or stored status', [atDec3.data.activity, atDec3.data.notices, atDec3.data.alerts], [atDec1.data.activity, atDec1.data.notices, atDec1.data.alerts]);
    equal('An expired rule cannot be updated (not_active)', (await write(c, 'kinodex.alerts.update', {id: 'al-04', patch: {expires_at: null}})).status, 'not_active');
    // The task delivers the started offer with offer.publish at its start time; the rule fires once.
    equal('ambervane-northcast-start commits', (await applyEvent(c, load('examples/events/ambervane-northcast-start.json'))).status, 'committed');
    const amberRule = (await c.agent.call('kinodex.alerts.list', {title_id: 'tt-ambervane'})).alerts[0];
    equal('The Ambervane rule is triggered by the event, with one notice', [amberRule.status, amberRule.trigger.event_id, (await c.agent.call('kinodex.notices.list', {since: PT('2026-12-03', '00:00')})).notices.length],
      ['triggered', 'ambervane-northcast-start', 1]);
    equal('A triggered rule cannot be updated (not_active)', (await write(c, 'kinodex.alerts.update', {id: amber.id, patch: {expires_at: null}})).status, 'not_active');
    // needs_info -> amend once -> approved guide correction adds a guide version and a notice.
    const hl = {title_id: 'tt-harbor-lights', field: 'guide_item', target: {item_id: 'gi-hl-storm'}};
    equal('A needs_info decision commits', (await applyEvent(c, {event_id: 'hl-storm-needs-info', at: PT('2026-12-04', '10:00'), operation: 'correction.decision',
      payload: {correction_ref: hl, decision: 'needs_info', note: 'Which episode?'}})).status, 'committed');
    const amended = await write(c, 'kinodex.corrections.amend', {id: guideCorrection.id, patch: {evidence: 'Season 1, episode 6: the storm scene shows who survives.'}});
    equal('The needs_info correction is amended once and returns to submitted', amended.correction.status, 'submitted');
    equal('The approval commits', (await applyEvent(c, {event_id: 'hl-storm-approved', at: PT('2026-12-05', '10:00'), operation: 'correction.decision', payload: {correction_ref: hl, decision: 'approved'}})).status, 'committed');
    const hlGuide = (await c.agent.call('kinodex.guide.get', {title_id: 'tt-harbor-lights'})).guide;
    equal('The approved guide correction adds guide version 2', [hlGuide.version, hlGuide.reason], [2, 'correction_approved']);
    const hlNotices = (await c.agent.call('kinodex.notices.list', {since: PT('2026-12-04', '00:00')})).notices.map(n => [n.kind, n.event_id]);
    equal('One notice per decision, plus a guide_updated notice because Harbor Lights is on the watchlist', hlNotices,
      [['guide_updated', 'hl-storm-approved'], ['correction_decided', 'hl-storm-approved'], ['correction_decided', 'hl-storm-needs-info']]);
    // An event at a rule's expiry time: the price drop lands exactly at expires_at and fires nothing.
    const buy = load('fixtures/minimal.json').offers.find(o => o.title_id === 'tt-salt-year' && o.type === 'buy');
    equal('A Salt Year purchase price drop (Tinlark US, $17.99 to $9.99) at the rule\'s expires_at commits', (await applyEvent(c, {event_id: 'salt-year-buy-drop', at: PT('2026-12-06', '12:00'), operation: 'offer.publish', payload: {...buy, price: 9.99}})).status, 'committed');
    const expiredRule = (await c.agent.call('kinodex.alerts.list', {title_id: 'tt-salt-year'})).alerts.find(a => a.alert_id === expiring.id);
    equal('The rule stays expired and the event writes no alert notice', [expiredRule.status, expiredRule.trigger, (await snapshot(c)).data.notices.filter(n => n.event_id === 'salt-year-buy-drop').length], ['expired', null, 0]);
    // The approved proposal's correction.decision example, verbatim.
    const decision = load('examples/events/salt-year-runtime-decision.json');
    equal('salt-year-runtime-decision (verbatim) commits', (await applyEvent(c, decision)).status, 'committed');
    const salt = (await c.agent.call('kinodex.corrections.list', {title_id: 'tt-salt-year'})).corrections[0];
    equal('The agent\'s correction keeps the decision, note and decision time', [salt.correction_id, salt.status, salt.decisions[0].note, salt.decisions[0].decided_at],
      [theatrical.id, 'declined', decision.payload.note, decision.at]);
    equal('Withdrawing a decided correction returns already_decided', (await write(c, 'kinodex.corrections.withdraw', {id: theatrical.id})).status, 'already_decided');
    const beforeMiss = await snapshot(c);
    const miss = await applyEvent(c, {...copy(decision), event_id: 'salt-year-runtime-decision-2', at: PT('2026-12-09', '11:00')});
    equal('A decision with no open correction fails with target_not_found and applied: false', [miss.status, miss.applied], ['target_not_found', false]);
    const afterMiss = await snapshot(c), deny = afterMiss.audit[afterMiss.audit.length - 1];
    equal('Core audit records a deny row with that reason, the data and clock are unchanged and no receipt is stored',
      [deny.tool, deny.decision, deny.reason, afterMiss.data, afterMiss.virtual_now, afterMiss.receipts['event:salt-year-runtime-decision-2']],
      ['env.apply_event', 'deny', 'target_not_found', beforeMiss.data, beforeMiss.virtual_now, undefined]);
    equal('The failed event can be retried later with the same event_id', (await c.infra.call('env.event_status', {event_id: 'salt-year-runtime-decision-2'})).receipt, null);
    observations.controls = {constraints: constrained.scenario.constraints, already_true_message: already.message,
      corrections: afterMiss.data.corrections.filter(x => x.submitted_at > '2026-11-30').map(x => ({correction_id: x.correction_id, field: x.field, target: x.target, status: x.status, decisions: x.decisions}))};

    // ---- Account-change runs (Mon Dec 7): adding a service, then (after reset) switching region ----
    const a = await instance('account-runs', 'kinodex-dana', {data: load('fixtures/minimal.json'), binding: load('fixtures/binding.json'), policies: writes,
      virtualNow: PT('2026-12-07', '09:00')});
    const loadedA = await snapshot(a);
    const runVariant = async (label, patch) => {
      const rule = await write(a, 'kinodex.alerts.create', {kind: 'available_on_my_services', title_id: 'tt-quiet-harbour'});
      const notices = (await snapshot(a)).data.notices.length;
      const args = {patch, expected_version: a.v, request_id: 'account-' + label};
      const out = await a.agent.call('kinodex.services.update', args);
      const stored = (await snapshot(a)).data;
      const trig = stored.alerts.find(x => x.alert_id === rule.id).trigger;
      equal(label + ': services.update triggers the active Quiet Harbour rule', [out.status, out.triggered_alerts.map(x => x.alert_id)], ['committed', [rule.id]]);
      equal(label + ': the rule keeps the matching offer, the services.update cause and the request ID', [trig.cause, trig.request_id, trig.offer.offer_id, trig.notice_id],
        ['services.update', 'account-' + label, out.triggered_alerts[0].offer_id, null]);
      equal(label + ': no notice is written', stored.notices.length, notices);
      const replay = await a.agent.call('kinodex.services.update', copy(args));
      ok(label + ': an identical retry is a duplicate and does not trigger again', replay.duplicate === true &&
        JSON.stringify((await snapshot(a)).data.alerts) === JSON.stringify(stored.alerts) && (await snapshot(a)).data.activity.length === stored.activity.length);
      return {rule: rule.id, offer: trig.offer, settings_version: out.settings_version};
    };
    const added = await runVariant('add-plumvale', {service_ids: ['brightreel', 'northcast', 'plumvale']});
    equal('Adding Plumvale matches the Plumvale US subscription', [added.offer.service_id, added.offer.region], ['plumvale', 'US']);
    const staleArgs = {patch: {region: 'UK'}, expected_version: {epoch: loadedA.epoch, revision: loadedA.revision}, request_id: 'account-stale'};
    const beforeStale = await snapshot(a);
    equal('A stale account update is rejected', (await a.agent.call('kinodex.services.update', staleArgs)).status, 'stale_version');
    equal('It preserves the prior region, subscriptions, rule state and notices', (await snapshot(a)).data, beforeStale.data);
    observations.account_run_1 = {account: beforeStale.data.account, triggered: added};
    equal('Reset between runs returns ready', (await a.infra.call('env.reset', {expected_version: a.v})).status, 'ready');
    const resetA = await snapshot(a);
    equal('Reset restores the loaded account and clock (Dec 7 09:00)', [resetA.data, resetA.virtual_now], [loadedA.data, PT('2026-12-07', '09:00')]);
    const switched = await runVariant('switch-uk', {region: 'UK'});
    equal('Switching to the UK matches the Northcast UK subscription', [switched.offer.service_id, switched.offer.region], ['northcast', 'UK']);
    observations.account_run_2 = {triggered: switched};
    const beforeRegion = await snapshot(a);
    equal('An unknown region returns not_found and changes nothing', [(await write(a, 'kinodex.services.update', {patch: {region: 'FR'}})).status, (await snapshot(a)).data], ['not_found', beforeRegion.data]);

    const counts = {};
    for (const row of trace) {
      const key = row.duplicate ? 'duplicate_replay' : row.status;
      counts[key] = (counts[key] || 0) + 1;
    }
    console.log(JSON.stringify({
      app: 'kinodex', package_sha256: packageSha256, runtime: require(path.join(runtime, 'package.json')).version, node: process.version, passed: true,
      checks, reference_replies: replies, task_context: {accounts: CONTEXT, trip: TRIP}, observations, management_call_example: managementCall,
      trace_summary: {calls: trace.length, by_outcome: counts, note: 'Duplicate replays are counted once as duplicate_replay; denials keep their status.'},
      trace,
    }, null, 2));
  } finally {
    await Promise.allSettled(clients.map(x => x.close()));
    prepared.cleanup();
    fs.rmSync(temp, {recursive: true, force: true});
  }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
