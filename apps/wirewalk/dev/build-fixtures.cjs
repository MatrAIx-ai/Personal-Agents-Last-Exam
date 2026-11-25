'use strict';
// Maintainer script (not run by tests or the verifier). Builds the fixtures, the approved scenario
// event, the wildfire event schedule, the second reader's task data, the board image, both asset
// catalogs and the dataset counts from one authored source. Usage, from the package directory:
// node dev/build-fixtures.cjs
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const board = require('../tests/board-image.cjs');
const out = path.resolve(__dirname, '..');
const write = (file, value) => fs.writeFileSync(path.join(out, file), JSON.stringify(value, null, 2) + '\n');
const T = (day, time) => `2026-10-${day}T${time}:00-07:00`;

const account = (id, display_name, kind, bio, location, joined_at) => ({id, display_name, kind, bio, location, joined_at});
const accounts = [
  account('green-line-ops', 'Green Line Service', 'organization', 'Service updates for the Green Line light rail, run by Corvale Regional Transit.', 'Corvale', '2019-10-01T09:00:00-07:00'),
  account('corvale-scanner', 'Corvale Scanner', 'organization', 'Volunteers relaying what riders and neighbors report around Corvale. Not affiliated with any agency.', 'Corvale', '2021-03-14T10:00:00-07:00'),
  account('mika-sorensen', 'Mika Sorensen', 'person', 'Night-shift nurse. Green Line regular.', 'Corvale', '2022-06-02T19:30:00-07:00'),
  account('devin-hart', 'Devin Hart', 'person', 'Concerts, bikes and the occasional stock tip.', 'Corvale', '2020-11-20T08:15:00-08:00'),
  account('june-okoro', 'June Okoro', 'person', 'Teacher. Reposts what I want to remember.', null, '2023-01-09T12:00:00-08:00'),
  account('tessa-lu', 'Tessa Lu', 'person', 'Pine Hollow born and raised. Usually on the Green Line.', 'Pine Hollow', '2021-08-30T17:45:00-07:00'),
  account('hal-reyes', 'Hal Reyes', 'person', 'Retired machinist. Long-term investor.', 'Lakeview', '2018-04-22T09:10:00-07:00'),
  account('quinn-maddox', 'Quinn Maddox', 'person', 'Small-cap investor. Not investment advice.', null, '2022-02-17T07:30:00-08:00'),
  account('pine-hollow-neighbors', 'Pine Hollow Neighbors', 'organization', 'Community group for Pine Hollow residents. Volunteer-run.', 'Pine Hollow', '2020-05-01T10:00:00-07:00'),
  account('tamsen-oem', 'Tamsen County Emergency Management', 'organization', 'Official emergency information for Tamsen County: evacuation warnings, orders and shelters.', 'Tamsen County', '2017-07-11T09:00:00-07:00'),
  account('alder-glass', 'Alder Glass', 'organization', 'Architectural glass for homes and commercial buildings. Investor news and company updates.', null, '2016-09-05T08:00:00-07:00'),
  account('odile-park', 'Odile Park', 'person', 'Independent equity analyst covering glass and building materials.', null, '2019-10-02T06:00:00-07:00'),
  account('ravi-castellano', 'Ravi Castellano', 'person', 'Building-products analyst. I follow distributor inventories.', null, '2020-01-15T06:30:00-08:00'),
  account('brindlemark-desk', 'Brindlemark Markets Desk', 'organization', 'Market headlines and earnings dates. Shares what traders are reading.', null, '2021-05-20T05:00:00-07:00'),
];

const link = (url, title, description) => ({url, title, description});
const ALERTS = 'https://alerts.tamsen-county.example/cinder-fork/';
const alert = (stamp, label) => [link(ALERTS + stamp, 'Cinder Fork Fire update, ' + label, 'Tamsen County Emergency Management alert page')];
const BOARD_ALT = 'Cropped photo of a station departure board. Two lines are visible: "11:40 PM GREEN LINE" and "CANCELED".';
const BOARD_ASSET = 'fennick-board-crop';

// Field order matches what post.publish stores.
function p(id, kind, author_id, published_at, body = {}) {
  const post = {id, kind, author_id};
  for (const key of ['text', 'parent_id', 'quoted_id', 'source_id']) if (body[key] !== undefined) post[key] = body[key];
  return {...post, links: body.links || [], media: body.media || [], published_at};
}
const original = (id, author, at, text, extra = {}) => p(id, 'original', author, at, {text, ...extra});
const reply = (id, author, at, parent_id, text, extra = {}) => p(id, 'reply', author, at, {text, parent_id, ...extra});
const quote = (id, author, at, quoted_id, text) => p(id, 'quote', author, at, {text, quoted_id});
const repost = (id, author, at, source_id) => p(id, 'repost', author, at, {source_id});

const posts = [
  // Train, Saturday Oct. 10. The operator's reply (p19) arrives at 21:12 as examples/scenario.json.
  // Both last trains leave at 11:40, so the cropped board photo does not show which one is canceled.
  original('p01', 'green-line-ops', T(10, '15:00'), 'Saturday late service: the last eastbound and the last westbound Green Line trains both leave Fennick St at 11:40 pm.'),
  original('p02', 'corvale-scanner', T(10, '17:30'), 'Quillfeather Hall show tonight: doors at 7 pm, music until 11. Fennick St is the closest Green Line stop.'),
  original('p03', 'green-line-ops', T(10, '18:10'), 'Westbound Green Line trains are running about 5 minutes late because of a signal check at Ash Yard.'),
  reply('p04', 'green-line-ops', T(10, '18:40'), 'p03', 'The signal check at Ash Yard is finished. Westbound trains are back on schedule.'),
  original('p05', 'mika-sorensen', T(10, '21:05'), 'Board at Fennick St just switched to this. Last Green Line train tonight is canceled??',
    {media: [{asset_id: BOARD_ASSET, alt_text: BOARD_ALT}]}),
  repost('p06', 'devin-hart', T(10, '21:05'), 'p05'),
  quote('p07', 'corvale-scanner', T(10, '21:06'), 'p05', 'Riders report the last Green Line train tonight is canceled. Nothing from @green-line-ops yet.'),
  quote('p08', 'devin-hart', T(10, '21:06'), 'p05', 'Of course it\'s the night of the Quillfeather show. How is anyone getting home?'),
  quote('p09', 'june-okoro', T(10, '21:07'), 'p05', 'If you\'re at Quillfeather tonight, the last Green Line train is apparently canceled. Plan ahead.'),
  reply('p10', 'tessa-lu', T(10, '21:07'), 'p05', 'Which direction? The photo cuts off the destination column.'),
  reply('p11', 'mika-sorensen', T(10, '21:08'), 'p10', 'No idea, I only caught the bottom of the board.'),
  original('p12', 'tessa-lu', T(10, '21:08'), '@green-line-ops Is the last Green Line train canceled tonight? Eastbound, westbound or both?'),
  repost('p13', 'june-okoro', T(10, '21:09'), 'p07'),
  repost('p14', 'quinn-maddox', T(10, '21:09'), 'p09'),
  reply('p15', 'corvale-scanner', T(10, '21:09'), 'p07', 'Several people are asking which direction. We have asked Corvale Regional Transit.'),
  original('p16', 'hal-reyes', T(10, '21:10'), 'Anyone else at Quillfeather? Opening act ran long, main set just started.'),
  repost('p17', 'devin-hart', T(10, '21:10'), 'p09'),
  original('p18', 'pine-hollow-neighbors', T(10, '21:10'), 'Smoke over the ridge north of Pine Hollow tonight. The county says crews are on the Cinder Fork Fire; no evacuation notices.'),

  // Wildfire, Sunday Oct. 11. Later county updates arrive as examples/wildfire-events.json.
  original('p20', 'tamsen-oem', T(11, '09:00'), 'Cinder Fork Fire, 9:00 am: about 300 acres north of Pine Hollow, 0% contained. No evacuation notices. Updates here and on the county alert page.',
    {links: alert('2026-10-11-0900', 'Oct. 11, 9:00 am')}),
  original('p21', 'tamsen-oem', T(11, '14:00'), 'Cinder Fork Fire, 2:00 pm: EVACUATION WARNING for Pine Hollow (zones PH-1 and PH-2). Be ready to leave. Lakeview: no evacuation notice. Next update by 4:30 pm.',
    {links: alert('2026-10-11-1400', 'Oct. 11, 2:00 pm')}),

  // Markets, Monday Oct. 12, ahead of Alder Glass results on Tuesday.
  original('p28', 'alder-glass', T(12, '06:00'), 'Preliminary third-quarter update: unit shipments rose 12% from a year earlier. We report full results Tuesday, Oct. 13, with a call at 5:30 am PT.',
    {links: [link('https://investors.alder-glass.example/q3-preliminary', 'Alder Glass preliminary third-quarter shipments', 'Investor relations notice')]}),
  original('p29', 'odile-park', T(12, '08:15'), 'Alder Glass shipments rose 12%. I read that as real demand: the same installers keep coming back with repeat orders. 1/2'),
  reply('p30', 'odile-park', T(12, '08:17'), 'p29', '2/2 What would change my mind: a next-quarter reorder rate below last year\'s. That rate isn\'t out yet; it\'s the number I\'ll listen for on Tuesday\'s call.'),
  original('p31', 'ravi-castellano', T(12, '10:40'), 'Same 12% shipment rise, different read: distributors filled their shelves early, ahead of the Jan. 1 price increase. Shipments to distributors aren\'t sales to installers. 1/2'),
  reply('p32', 'ravi-castellano', T(12, '10:42'), 'p31', '2/2 If distributors stocked up, next-quarter reorders fall. If @odile-park is right, they hold. The reorder rate hasn\'t been reported; watch for it on the call.'),
];
// A dozen reposts of Odile Park's two-post thread: six accounts, two posts each, one independent source.
const reposters = ['brindlemark-desk', 'quinn-maddox', 'hal-reyes', 'june-okoro', 'devin-hart', 'mika-sorensen'];
reposters.forEach((author, i) => {
  posts.push(repost('p' + (33 + 2 * i), author, T(12, String(11 + i).padStart(2, '0') + ':05'), 'p29'));
  posts.push(repost('p' + (34 + 2 * i), author, T(12, String(11 + i).padStart(2, '0') + ':06'), 'p30'));
});

// The approved proposal's example event, verbatim.
const scenario = {event_id: 'rail-reply-01', at: '2026-10-10T21:12:00-07:00', operation: 'post.publish',
  payload: {id: 'p19', kind: 'reply', parent_id: 'p12', author_id: 'green-line-ops',
    text: 'Only the 11:40 pm eastbound is canceled. Last eastbound is 10:55 pm. Westbound service is on schedule.'}};
const publish = (event_id, at, payload) => ({event_id, at, operation: 'post.publish', payload});
const wildfire = [
  publish('fire-repost-1510', T(11, '15:10'), {id: 'p22', kind: 'repost', author_id: 'pine-hollow-neighbors', source_id: 'p21'}),
  publish('fire-quote-1510', T(11, '15:10'), {id: 'p23', kind: 'quote', author_id: 'tessa-lu', quoted_id: 'p21',
    text: 'Sharing again for anyone just checking in: Pine Hollow is under a warning, Lakeview has no notice.'}),
  publish('fire-order-1620', T(11, '16:20'), {id: 'p24', kind: 'original', author_id: 'tamsen-oem',
    text: 'Cinder Fork Fire, 4:20 pm: EVACUATION ORDER for Pine Hollow (zones PH-1 and PH-2). Leave now. Lakeview: no evacuation notice.',
    links: alert('2026-10-11-1620', 'Oct. 11, 4:20 pm')}),
  publish('fire-warning-1805', T(11, '18:05'), {id: 'p25', kind: 'original', author_id: 'tamsen-oem',
    text: 'Cinder Fork Fire, 6:05 pm: EVACUATION WARNING for Lakeview (zones LV-1, LV-2 and LV-3). Be ready to leave.',
    links: alert('2026-10-11-1805', 'Oct. 11, 6:05 pm')}),
  publish('fire-order-repeat-1805', T(11, '18:05'), {id: 'p26', kind: 'reply', author_id: 'tamsen-oem', parent_id: 'p24',
    text: '6:05 pm: The EVACUATION ORDER for Pine Hollow (zones PH-1 and PH-2) remains in effect.'}),
  publish('fire-update-2015', T(11, '20:15'), {id: 'p27', kind: 'original', author_id: 'tamsen-oem',
    text: 'Cinder Fork Fire, 8:15 pm: Pine Hollow zone PH-2 is downgraded to an EVACUATION WARNING. Zone PH-1 remains under an EVACUATION ORDER. Lakeview: the warning remains.',
    links: alert('2026-10-11-2015', 'Oct. 11, 8:15 pm')}),
];

const priya = {account_id: 'ww-priya', owner_person_id: 'person-priya', accounts, posts,
  // Priya bookmarked the operator's Saturday schedule before heading out.
  bookmarks: [{post_id: 'p01', saved_at: T(10, '15:05')}]};

// Dario's instance on Monday evening: the same public history after the train reply and the whole
// wildfire schedule, plus his own bookmarks on the two analyst threads.
const dario = structuredClone(priya);
Object.assign(dario, {account_id: 'ww-dario', owner_person_id: 'person-dario'});
for (const e of [scenario, ...wildfire]) {
  const {id, kind, author_id, links = [], ...rest} = e.payload;
  dario.posts.push(p(id, kind, author_id, e.at, {...rest, links}));
}
dario.bookmarks = [{post_id: 'p29', saved_at: T(12, '17:00')}, {post_id: 'p31', saved_at: T(12, '17:02')}];

const READS = ['wirewalk.feed.list', 'wirewalk.search', 'wirewalk.post.get', 'wirewalk.thread.get', 'wirewalk.account.get', 'wirewalk.bookmarks.list'];
const WRITES = ['wirewalk.bookmarks.add', 'wirewalk.bookmarks.remove'];
const policies = scenarioAllow => ({scenario: {allow: scenarioAllow, constraints: {}}, sandbox: {allow: [...READS, ...WRITES], constraints: {}}});

// The board image: rendered from the lines quoted in the alt text. Rewritten only when its pixels
// change, so the committed bytes (and checksum) stay stable across Node and zlib versions.
const assetFile = 'assets/' + BOARD_ASSET + '.png', raster = board.render(board.linesFromAltText(BOARD_ALT));
const existing = fs.existsSync(path.join(out, assetFile)) ? fs.readFileSync(path.join(out, assetFile)) : null;
if (!existing || !board.decode(existing).rgb.equals(raster.rgb)) fs.writeFileSync(path.join(out, assetFile), board.encode(raster));
const bytes = fs.readFileSync(path.join(out, assetFile));

const DATASET = 'wirewalk-public-history';
const catalog = (catalog_id, accountId, datasetId) => ({
  schema_version: 'pale.asset-catalog.v1', catalog_id, app_id: 'wirewalk', dataset_ref: 'dataset.json',
  assets: [{
    schema_version: 'pale.asset-descriptor.v1', asset_id: BOARD_ASSET, scope: {level: 'package', app_id: 'wirewalk'},
    roles: ['content.inline'], subjects: [{app_id: 'wirewalk', account_id: accountId, object_type: 'post', object_id: 'p05'}],
    mime_type: 'image/png', availability: {status: 'ready'},
    storage: {adapter: 'storage.file', path: assetFile, packaging: 'bundled'},
    integrity: {bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex')},
    provenance: {dataset_id: datasetId, source_ids: ['rendered-board']}, publication: 'public',
    access: {audience: ['agent'], rule: 'parent_object'}, presentation: {alt_text: BOARD_ALT},
    media: {image: {width: raster.width, height: raster.height}}, extensions: [],
  }],
  extensions: [],
});

write('fixtures/minimal.json', priya);
write('fixtures/clock.json', {initial_time: '2026-10-10T21:10:00-07:00'});
write('fixtures/binding.json', {people: [{person_id: 'person-priya', name: 'Priya Raman'}],
  accounts: [{app_id: 'wirewalk', account_id: 'ww-priya', owner_person_id: 'person-priya'}], objects: {}});
write('fixtures/policies.json', policies(READS));
write('examples/scenario.json', scenario);
write('examples/wildfire-events.json', wildfire);
write('examples/task-data/seed.json', dario);
write('examples/task-data/binding.json', {people: [{person_id: 'person-dario', name: 'Dario Mendes'}],
  accounts: [{app_id: 'wirewalk', account_id: 'ww-dario', owner_person_id: 'person-dario'}], objects: {}});
write('examples/task-data/policies.json', policies([...READS, ...WRITES]));
// Provenance stays in the package dataset; task data ships its own copy and catalog with matching counts.
const dataset = JSON.parse(fs.readFileSync(path.join(out, 'contribution/dataset.json'), 'utf8'));
dataset.expected_counts = {records: priya.posts.length, assets: 1};
write('contribution/dataset.json', dataset);
write('contribution/assets.catalog.json', catalog('wirewalk-assets', 'ww-priya', DATASET));
write('examples/task-data/dataset.json', {...dataset, dataset_id: DATASET + '-dario', expected_counts: {records: dario.posts.length, assets: 1}});
write('examples/task-data/assets.catalog.json', catalog('wirewalk-assets-dario', 'ww-dario', DATASET + '-dario'));
console.log({accounts: accounts.length, seed_posts: priya.posts.length, event_posts: 1 + wildfire.length,
  dario_posts: dario.posts.length, image: {bytes: bytes.length, width: raster.width, height: raster.height}});
