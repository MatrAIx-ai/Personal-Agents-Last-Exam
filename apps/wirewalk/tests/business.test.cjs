'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const plugin = require('../plugin.cjs');
const board = require('./board-image.cjs');
const {fixture} = require('./harness.cjs');
const minimal = require('../fixtures/minimal.json');
const scenario = require('../examples/scenario.json');
const wildfire = require('../examples/wildfire-events.json');
const darioSeed = require('../examples/task-data/seed.json');
const darioBinding = require('../examples/task-data/binding.json');
const ids = list => list.map(x => x.id);
function unchanged(f, fn, pattern) {const before = f.data; assert.throws(fn, pattern); assert.deepEqual(f.data, before);}
function event(overrides = {}, payload = {}) {
  const e = structuredClone(scenario);
  Object.assign(e, overrides); Object.assign(e.payload, payload);
  for (const [k, v] of Object.entries(payload)) if (v === undefined) delete e.payload[k];
  return e;
}
const fire = id => wildfire.find(e => e.payload.id === id);
const SUNDAY = '2026-10-11T14:30:00-07:00', MONDAY = '2026-10-12T18:00:00-07:00';
const UNAVAILABLE = /Post is not available in Wirewalk/;

test('reads are side-effect free', () => {
  const f = fixture(), before = f.data;
  for (const [name, args] of [['wirewalk.feed.list', {}], ['wirewalk.search', {query: 'green line'}], ['wirewalk.post.get', {id: 'p05'}],
    ['wirewalk.thread.get', {id: 'p05'}], ['wirewalk.account.get', {id: 'green-line-ops'}], ['wirewalk.bookmarks.list', {}]]) f.call(name, args);
  assert.deepEqual(f.data, before);
});

test('the feed is newest first with post ID breaking ties, and each row carries its relationship and stable link', () => {
  const f = fixture();
  const feed = f.call('wirewalk.feed.list', {});
  assert.equal(feed.as_of, '2026-10-10T21:10:00-07:00');
  assert.equal(feed.total, 18, 'Only the 18 posts published by 21:10 are public');
  assert.deepEqual(ids(feed.posts).slice(0, 6), ['p18', 'p17', 'p16', 'p15', 'p14', 'p13']);
  const repost = feed.posts.find(p => p.id === 'p17');
  assert.equal(repost.text, null);
  assert.deepEqual([repost.source.id, repost.source.author_id, repost.source.link], ['p09', 'june-okoro', 'https://wirewalk.example/@june-okoro/posts/p09']);
  const quote = feed.posts.find(p => p.id === 'p07');
  assert.equal(quote.quoted.id, 'p05');
  assert.equal(quote.link, 'https://wirewalk.example/@corvale-scanner/posts/p07');
  assert.equal(feed.posts.find(p => p.id === 'p15').parent.id, 'p07');
  assert.deepEqual(f.call('wirewalk.feed.list', {limit: 50}).posts.length, 18);
  assert.equal(feed.next_cursor, null, 'Everything fits on the first page of 20');
});

test('an unknown post and a post that is not public yet get the same unavailable response', () => {
  const f = fixture();
  unchanged(f, () => f.call('wirewalk.post.get', {id: 'p19'}), UNAVAILABLE); // published later by the scenario event
  unchanged(f, () => f.call('wirewalk.post.get', {id: 'p29'}), UNAVAILABLE); // seeded for Monday
  unchanged(f, () => f.call('wirewalk.post.get', {id: 'p999'}), UNAVAILABLE);
  unchanged(f, () => f.call('wirewalk.thread.get', {id: 'p29'}), UNAVAILABLE);
  unchanged(f, () => f.call('wirewalk.bookmarks.add', {id: 'p29'}), UNAVAILABLE);
  unchanged(f, () => f.call('wirewalk.account.get', {id: 'nobody'}), /Account is not available/);
  assert.equal(f.call('wirewalk.search', {query: 'Alder Glass'}).total, 0, 'Monday\'s posts do not leak through search');
  assert.equal(f.call('wirewalk.account.get', {id: 'odile-park'}).account.post_count, 0);
});

test('post.publish adds the operator reply from the event time onward; the approved example applies verbatim', () => {
  const f = fixture();
  assert.equal(f.call('wirewalk.post.get', {id: 'p12'}).post.counts.replies, 0);
  f.event(scenario);
  const reply = f.call('wirewalk.post.get', {id: 'p19'}).post;
  assert.equal(reply.published_at, scenario.at);
  assert.deepEqual([reply.kind, reply.author.id, reply.parent.id, reply.text], ['reply', 'green-line-ops', 'p12', scenario.payload.text]);
  assert.equal(reply.link, 'https://wirewalk.example/@green-line-ops/posts/p19');
  const parent = f.call('wirewalk.post.get', {id: 'p12'}).post;
  assert.deepEqual([parent.counts.replies, ids(parent.replies)], [1, ['p19']]);
  assert.deepEqual(ids(f.call('wirewalk.thread.get', {id: 'p12'}).posts), ['p12', 'p19']);
  assert.equal(f.call('wirewalk.feed.list', {limit: 1}).posts[0].id, 'p19');
  // A second event with the same post ID (Core already deduplicates the same event ID) is rejected.
  unchanged(f, () => f.event(event({event_id: 'rail-reply-02', at: '2026-10-10T21:13:00-07:00'})), /already published/);
  assert.equal(f.data.posts.filter(p => p.id === 'p19').length, 1, 'One reply');
});

test('post.publish checks authors and referenced posts before committing; failures change nothing', () => {
  const f = fixture(), code = {code: 'invalid_event'};
  unchanged(f, () => f.event(event({}, {author_id: 'nobody'})), /unknown author/);
  unchanged(f, () => f.event(event({}, {parent_id: 'p999'})), /unknown post p999/);
  unchanged(f, () => f.event(event({}, {parent_id: 'p29'})), /published after it/); // replying to a post not public yet
  unchanged(f, () => f.event(event({}, {parent_id: 'p06'})), /points to a repost/);
  unchanged(f, () => f.event(event({}, {parent_id: undefined})), /needs parent_id/);
  unchanged(f, () => f.event(event({}, {quoted_id: 'p05'})), /cannot have quoted_id/);
  unchanged(f, () => f.event(event({}, {text: '   '})), /needs text/);
  unchanged(f, () => f.event(event({}, {kind: 'repost', parent_id: undefined, source_id: 'p05'})), /no text/);
  unchanged(f, () => f.event(event({}, {kind: 'repost', parent_id: undefined, text: undefined, source_id: 'p05', author_id: 'devin-hart'})), /already reposted p05/);
  unchanged(f, () => f.event(event({}, {id: 'p05'})), /already published/);
  unchanged(f, () => f.event(event({}, {links: [{url: 'https://a.example/x', title: 'A', description: ''}, {url: 'https://a.example/x', title: 'B', description: ''}]})), code);
  unchanged(f, () => f.event(event({}, {links: [{url: 'https://real-site.com/x', title: 'A', description: ''}]})), /Event schema/);
  unchanged(f, () => f.event(event({operation: 'post.delete'})), /Event schema/);
  unchanged(f, () => f.event(event({}, {media: []})), /Event schema/);
  assert.throws(() => plugin.applyEvent({...f.ctx, virtual_now: scenario.at}, f.data, event({}, {author_id: 'nobody'})), code);
});

test('from a search hit, follow a quote to its source and read the later replies', () => {
  const f = fixture();
  f.event(scenario);
  const hit = f.call('wirewalk.search', {query: 'canceled', kind: 'quote'}).posts;
  assert.deepEqual(ids(hit), ['p09', 'p07']);
  const source = f.call('wirewalk.post.get', {id: hit[1].quoted.id}).post;
  assert.equal(source.id, 'p05');
  assert.deepEqual(source.media, [{asset_id: 'fennick-board-crop', alt_text: minimal.posts[4].media[0].alt_text}]);
  assert.deepEqual([ids(source.quotes), source.reposted_by.map(r => r.account_id), ids(source.replies)],
    [['p07', 'p08', 'p09'], ['devin-hart'], ['p10']]);
  const thread = f.call('wirewalk.thread.get', {id: 'p05'});
  assert.deepEqual(thread.posts.map(p => [p.id, p.depth, p.relation]), [['p05', 0, 'focus'], ['p10', 1, 'reply'], ['p11', 2, 'reply']]);
  assert.match(thread.posts[1].text, /cuts off the destination/);
  // Opening a reply shows its ancestors; opening a repost opens its source's conversation.
  assert.deepEqual(f.call('wirewalk.thread.get', {id: 'p11'}).posts.map(p => p.relation), ['ancestor', 'ancestor', 'focus']);
  assert.equal(f.call('wirewalk.thread.get', {id: 'p06'}).focus_id, 'p05');
  // The operator's answer is in the question's conversation, not the photo's.
  assert.ok(!ids(thread.posts).includes('p19'));
  assert.match(f.call('wirewalk.thread.get', {id: 'p12'}).posts[1].text, /Only the 11:40 pm eastbound is canceled/);
});

test('the cropped photo and its alt text agree, and every image reference resolves to a catalogued file', () => {
  const catalog = require('../contribution/assets.catalog.json'), pkg = path.resolve(__dirname, '..');
  const post = minimal.posts.find(p => p.media.length);
  const lines = board.linesFromAltText(post.media[0].alt_text);
  assert.deepEqual(lines, ['11:40 PM GREEN LINE', 'CANCELED']);
  const file = fs.readFileSync(path.join(pkg, catalog.assets[0].storage.path)), decoded = board.decode(file), expected = board.render(lines);
  assert.deepEqual([decoded.width, decoded.height], [expected.width, expected.height]);
  assert.ok(decoded.rgb.equals(expected.rgb), 'The PNG shows exactly the lines in the alt text');
  assert.ok(file.length < 128 * 1024, 'Under 128 KiB');
  assert.equal(catalog.assets[0].presentation.alt_text, post.media[0].alt_text);
  assert.doesNotMatch(post.media[0].alt_text, /eastbound|westbound/i, 'The alt text describes only what the crop shows');
  const problems = assetProblems(minimal, catalog, pkg);
  assert.deepEqual(problems, []);
  const broken = structuredClone(catalog);
  broken.assets[0].integrity.sha256 = '0'.repeat(64);
  assert.match(assetProblems(minimal, broken, pkg).join(), /checksum/);
  broken.assets[0].storage.path = 'assets/missing.png';
  assert.match(assetProblems(minimal, broken, pkg).join(), /missing file/);
  const orphan = structuredClone(minimal);
  orphan.posts[4].media[0].asset_id = 'not-catalogued';
  assert.match(assetProblems(orphan, catalog, pkg).join(), /not catalogued/);
  assert.match(assetProblems(darioSeed, catalog, pkg).join(), /owned by/, 'A reader seed needs a catalog bound to its own account');
  assert.deepEqual(assetProblems(darioSeed, require('../examples/task-data/assets.catalog.json'), pkg), []);
});

// The checks Core applies at registration and on load, restated for App-only evidence.
function assetProblems(seed, catalog, dir) {
  const problems = [], byId = new Map(catalog.assets.map(a => [a.asset_id, a]));
  for (const ref of plugin.assetReferences(seed)) {
    const a = byId.get(ref.asset_id);
    if (!a) {problems.push(ref.asset_id + ' is not catalogued'); continue;}
    const owner = a.subjects[0];
    if (owner.account_id !== seed.account_id || owner.object_id !== ref.object_id || owner.object_type !== 'post') problems.push(ref.asset_id + ' is owned by ' + JSON.stringify(owner));
    const file = path.join(dir, a.storage.path);
    if (!fs.existsSync(file)) {problems.push(ref.asset_id + ' has a missing file'); continue;}
    const bytes = fs.readFileSync(file);
    if (bytes.length !== a.integrity.bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== a.integrity.sha256) problems.push(ref.asset_id + ' fails its checksum');
    if (bytes.readUInt32BE(16) !== a.media.image.width || bytes.readUInt32BE(20) !== a.media.image.height) problems.push(ref.asset_id + ' has wrong dimensions');
  }
  return problems;
}

test('a cursor stays on its original result set when another post arrives at the same timestamp; a fresh search sees it', () => {
  const f = fixture({virtual_now: SUNDAY});
  for (const id of ['p22', 'p23', 'p24', 'p25']) f.event(fire(id));
  const first = f.call('wirewalk.search', {author_id: 'tamsen-oem', limit: 2});
  assert.deepEqual([ids(first.posts), first.total, first.as_of], [['p25', 'p24'], 4, '2026-10-11T18:05:00-07:00']);
  f.event(fire('p26')); // the repeated Pine Hollow order, also at 18:05
  const second = f.call('wirewalk.search', {author_id: 'tamsen-oem', limit: 2, cursor: first.next_cursor});
  assert.deepEqual([ids(second.posts), second.total, second.next_cursor], [['p21', 'p20'], 4, null]);
  const fresh = f.call('wirewalk.search', {author_id: 'tamsen-oem', limit: 2});
  assert.deepEqual([ids(fresh.posts), fresh.total], [['p26', 'p25'], 5], 'Equal timestamps: the higher post ID first');
  // The cursor is tied to its query and cannot be edited or replayed against another one.
  unchanged(f, () => f.call('wirewalk.search', {author_id: 'tessa-lu', limit: 2, cursor: first.next_cursor}), /cursor/);
  unchanged(f, () => f.call('wirewalk.feed.list', {limit: 2, cursor: first.next_cursor}), /cursor/);
  unchanged(f, () => f.call('wirewalk.search', {author_id: 'tamsen-oem', cursor: 'bm90LWEtY3Vyc29y'}), {code: 'invalid_arguments'});
});

test('a same-timestamp arrival that sorts inside the remaining pages is still kept out of the traversal', () => {
  // p245 shares 18:05 with p25 but has a lower ID, so it sorts right after p25: without the boundary it would lead page 2.
  const f = fixture({virtual_now: SUNDAY});
  for (const id of ['p22', 'p23', 'p24', 'p25']) f.event(fire(id));
  const first = f.call('wirewalk.search', {author_id: 'tamsen-oem', limit: 1});
  assert.deepEqual(ids(first.posts), ['p25']);
  f.event({event_id: 'lower-id-1805', at: fire('p25').at, operation: 'post.publish',
    payload: {id: 'p245', kind: 'original', author_id: 'tamsen-oem', text: '6:05 pm: Shelter open at Lakeview High School.'}});
  const rest = f.call('wirewalk.search', {author_id: 'tamsen-oem', limit: 5, cursor: first.next_cursor});
  assert.deepEqual([ids(rest.posts), rest.total], [['p24', 'p21', 'p20'], 4]);
  assert.deepEqual(ids(f.call('wirewalk.search', {author_id: 'tamsen-oem', limit: 2}).posts), ['p25', 'p245']);
});

test('a cursor is pinned to its own first page: a forged count or a differently refilled feed is refused', () => {
  const f = fixture();
  f.event(scenario);
  const first = f.call('wirewalk.feed.list', {limit: 5});
  const decoded = JSON.parse(Buffer.from(first.next_cursor, 'base64url').toString('utf8'));
  assert.deepEqual([decoded.n, decoded.b], [19, 'p19']);
  const forged = Buffer.from(JSON.stringify({...decoded, n: 10}), 'utf8').toString('base64url');
  unchanged(f, () => f.call('wirewalk.feed.list', {limit: 5, cursor: forged}), {code: 'invalid_arguments'});
  // Another instance (or this one after a reset) that received a different post at the same time.
  const other = fixture();
  other.event(event({event_id: 'other-reply'}, {id: 'p19b'}));
  unchanged(other, () => other.call('wirewalk.feed.list', {limit: 5, cursor: first.next_cursor}), {code: 'invalid_arguments'});
  assert.equal(f.call('wirewalk.feed.list', {limit: 5, cursor: first.next_cursor}).total, 19);
});

test('a cursor also keeps out seeded posts that become public after the first page', () => {
  const f = fixture();
  const first = f.call('wirewalk.feed.list', {limit: 10});
  f.ctx.virtual_now = '2026-10-11T09:30:00-07:00'; // as Infra's env.advance_time would
  const rest = f.call('wirewalk.feed.list', {limit: 10, cursor: first.next_cursor});
  assert.deepEqual([rest.total, rest.as_of, rest.posts.length], [18, '2026-10-10T21:10:00-07:00', 8]);
  assert.ok(!ids(rest.posts).includes('p20'));
  assert.equal(f.call('wirewalk.feed.list', {limit: 1}).posts[0].id, 'p20');
  // After a reset the clock is earlier than the cursor's boundary, so the old cursor is refused.
  // The cursor counts only the 18 public posts, never the seeded weekend posts; a forged count is refused.
  const decoded = JSON.parse(Buffer.from(first.next_cursor, 'base64url').toString('utf8'));
  assert.deepEqual([decoded.n, decoded.t], [18, '2026-10-10T21:10:00-07:00']);
  const forged = Buffer.from(JSON.stringify({...decoded, n: 37}), 'utf8').toString('base64url');
  unchanged(f, () => f.call('wirewalk.feed.list', {limit: 10, cursor: forged}), {code: 'invalid_arguments'});
  const reset = fixture();
  unchanged(reset, () => reset.call('wirewalk.feed.list', {limit: 10, cursor: f.call('wirewalk.feed.list', {limit: 10}).next_cursor}), /cursor/);
});

test('search: word starts, accents and case ignored, alt text and link cards searchable, reposts only in filter-only searches', () => {
  const f = fixture({virtual_now: MONDAY});
  assert.deepEqual(ids(f.call('wirewalk.search', {query: 'CANCEL'}).posts), ['p12', 'p09', 'p07', 'p05']);
  assert.deepEqual(ids(f.call('wirewalk.search', {query: '11:40 PM'}).posts), ['p05', 'p01'], 'p05 matches through its image alt text');
  assert.deepEqual(ids(f.call('wirewalk.search', {query: 'Fénnick'}).posts), ids(f.call('wirewalk.search', {query: 'fennick'}).posts));
  assert.deepEqual(ids(f.call('wirewalk.search', {query: 'eastbound'}).posts), ['p12', 'p01']);
  assert.equal(f.call('wirewalk.search', {query: 'bound'}).total, 0, '"bound" does not match inside "eastbound"');
  assert.deepEqual(ids(f.call('wirewalk.search', {query: 'investor relations'}).posts), ['p28'], 'Link card descriptions are searchable');
  assert.equal(f.call('wirewalk.search', {query: 'repeat orders'}).total, 1, 'Reposts carry no text of their own');
  const reposts = f.call('wirewalk.search', {kind: 'repost', since: '2026-10-12T00:00:00-07:00'});
  assert.equal(reposts.total, 12);
  assert.deepEqual(ids(f.call('wirewalk.search', {author_id: 'tamsen-oem', until: '2026-10-11T12:00:00-07:00'}).posts), ['p20']);
  const page = f.call('wirewalk.search', {kind: 'repost', limit: 5});
  assert.equal(page.posts.length, 5); assert.ok(page.next_cursor);
  unchanged(f, () => f.call('wirewalk.search', {limit: 0}), /Input schema/);
  unchanged(f, () => f.call('wirewalk.search', {query: '!!!'}), /no letters or digits/);
  assert.equal(f.call('wirewalk.search', {query: '   '}).total, f.call('wirewalk.feed.list', {}).total, 'A blank query is a filter-only search');
  unchanged(f, () => f.call('wirewalk.search', {since: '2026-10-12T00:00:00-07:00', until: '2026-10-11T00:00:00-07:00'}), /since is later than until/);
  unchanged(f, () => f.call('wirewalk.search', {query: 'x', account_id: 'ww-dario'}), /Input schema/);
});

test('bookmarks: add once, remove, retry-safe results, latest write first', () => {
  const f = fixture();
  assert.deepEqual(f.call('wirewalk.bookmarks.add', {id: 'p05'}), {post_id: 'p05', bookmarked: true, changed: true});
  assert.deepEqual(f.call('wirewalk.bookmarks.add', {id: 'p05'}), {post_id: 'p05', bookmarked: true, changed: false});
  f.call('wirewalk.bookmarks.add', {id: 'p12'});
  const list = f.call('wirewalk.bookmarks.list', {}).bookmarks;
  assert.deepEqual(list.map(b => b.post.id), ['p12', 'p05', 'p01'], 'Same session clock: the later write comes first');
  assert.equal(list[0].saved_at, f.ctx.virtual_now);
  assert.equal(f.call('wirewalk.post.get', {id: 'p05'}).post.saved_at, f.ctx.virtual_now);
  assert.equal(f.call('wirewalk.feed.list', {}).posts.find(p => p.id === 'p05').bookmarked, true);
  assert.deepEqual(f.call('wirewalk.bookmarks.remove', {id: 'p05'}), {post_id: 'p05', bookmarked: false, changed: true});
  assert.deepEqual(f.call('wirewalk.bookmarks.remove', {id: 'p05'}), {post_id: 'p05', bookmarked: false, changed: false});
  unchanged(f, () => f.call('wirewalk.bookmarks.remove', {id: 'p999'}), UNAVAILABLE);
  unchanged(f, () => f.call('wirewalk.bookmarks.add', {id: 'p05', role: 'infra'}), /Input schema/);
  assert.deepEqual(f.data.bookmarks.map(b => b.post_id), ['p01', 'p12']);
});

test('two reader instances share the public history but keep bookmarks separate', () => {
  const priya = fixture(), dario = fixture({seed: darioSeed, binding: darioBinding, virtual_now: MONDAY});
  for (const e of [scenario, ...wildfire]) priya.event(e);
  const publicPart = d => ({accounts: d.accounts, posts: d.posts});
  assert.deepEqual(publicPart(dario.data), publicPart(priya.data), 'Dario\'s history is the minimal seed plus the example events');
  priya.ctx.virtual_now = MONDAY;
  assert.deepEqual(dario.call('wirewalk.bookmarks.list', {}).bookmarks.map(b => b.post.id), ['p31', 'p29']);
  assert.deepEqual(priya.call('wirewalk.bookmarks.list', {}).bookmarks.map(b => b.post.id), ['p01']);
  priya.call('wirewalk.bookmarks.add', {id: 'p31'});
  dario.call('wirewalk.bookmarks.remove', {id: 'p29'});
  assert.deepEqual(dario.call('wirewalk.bookmarks.list', {}).bookmarks.map(b => b.post.id), ['p31']);
  assert.deepEqual(priya.call('wirewalk.bookmarks.list', {}).bookmarks.map(b => b.post.id), ['p31', 'p01']);
  assert.equal(dario.call('wirewalk.post.get', {id: 'p01'}).post.bookmarked, false);
  assert.throws(() => plugin.validateSeed(priya.ctx, darioSeed), /binding/);
});

test('train storyline: unofficial claims first, then the operator names the direction', () => {
  const f = fixture();
  // Both last trains leave at 11:40, so the schedule plus the cropped board cannot tell which one is canceled.
  assert.match(f.call('wirewalk.post.get', {id: 'p01'}).post.text, /last eastbound and the last westbound Green Line trains both leave Fennick St at 11:40 pm/);
  const photo = f.call('wirewalk.post.get', {id: 'p05'}).post;
  assert.equal(photo.quotes.length, 3, 'Three accounts quote the photo');
  assert.deepEqual(photo.quotes.map(q => q.author_id), ['corvale-scanner', 'devin-hart', 'june-okoro']);
  const before = f.call('wirewalk.search', {author_id: 'green-line-ops'}).posts;
  assert.ok(!before.some(p => /cancel/i.test(p.text)), 'Before 21:12 the operator has said nothing about a cancellation');
  f.event(scenario);
  const after = f.call('wirewalk.search', {author_id: 'green-line-ops', query: 'canceled'}).posts;
  assert.deepEqual(ids(after), ['p19']);
  assert.match(after[0].text, /Last eastbound is 10:55 pm\. Westbound service is on schedule\./);
});

test('wildfire storyline: the 2 pm baseline, a recirculated bulletin, the upgrade, the repeat and the post after the cutoff', () => {
  const f = fixture({virtual_now: SUNDAY});
  const county = () => f.call('wirewalk.search', {author_id: 'tamsen-oem'}).posts;
  assert.match(county()[0].text, /2:00 pm: EVACUATION WARNING for Pine Hollow .* Lakeview: no evacuation notice/);
  assert.equal(county()[0].links[0].url, 'https://alerts.tamsen-county.example/cinder-fork/2026-10-11-1400');
  f.event(fire('p22')); f.event(fire('p23'));
  const bulletin = f.call('wirewalk.post.get', {id: 'p21'}).post;
  assert.deepEqual([bulletin.counts.reposts, bulletin.counts.quotes], [1, 1]);
  assert.equal(county()[0].id, 'p21', 'The recirculation adds no county post');
  f.event(fire('p24'));
  assert.match(county()[0].text, /4:20 pm: EVACUATION ORDER for Pine Hollow/);
  f.event(fire('p25')); f.event(fire('p26'));
  assert.deepEqual(ids(county()).slice(0, 2), ['p26', 'p25']);
  assert.match(f.call('wirewalk.post.get', {id: 'p26'}).post.text, /remains in effect/);
  assert.equal(f.call('wirewalk.post.get', {id: 'p26'}).post.parent.id, 'p24');
  f.event(fire('p27'));
  assert.equal(county()[0].published_at, '2026-10-11T20:15:00-07:00');
});

test('markets storyline: two bookmarked analysts, one figure, a dozen reposts of one source', () => {
  const f = fixture({seed: darioSeed, binding: darioBinding, virtual_now: MONDAY});
  const marks = f.call('wirewalk.bookmarks.list', {}).bookmarks.map(b => b.post);
  assert.deepEqual(marks.map(p => p.author.id), ['ravi-castellano', 'odile-park']);
  const thread = id => f.call('wirewalk.thread.get', {id}).posts.map(p => p.text).join(' ');
  for (const id of ['p29', 'p31']) {
    assert.match(thread(id), /12%/); assert.match(thread(id), /reorder rate/);
    assert.match(thread(id), /isn't out yet|hasn't been reported/);
  }
  assert.match(thread('p29'), /repeat orders/); assert.match(thread('p31'), /distributors filled their shelves early/);
  assert.match(f.call('wirewalk.post.get', {id: 'p28'}).post.text, /unit shipments rose 12%/);
  const reposts = f.call('wirewalk.search', {kind: 'repost', since: '2026-10-12T00:00:00-07:00'}).posts;
  assert.equal(reposts.length, 12);
  assert.deepEqual([...new Set(reposts.map(r => r.source.author_id))], ['odile-park'], 'Twelve reposts, one independent source');
  assert.equal(new Set(reposts.map(r => r.author.id)).size, 6);
  assert.equal(f.call('wirewalk.post.get', {id: 'p29'}).post.reposted_by.length, 6);
  assert.equal(f.call('wirewalk.search', {query: 'reorder rate'}).posts.every(p => ['odile-park', 'ravi-castellano'].includes(p.author.id)), true);
  assert.ok(!f.data.posts.some(p => /reorder rate (was|is|came in|of) \d/i.test(p.text || '')), 'No post reports the reorder rate');
});

test('account inspection counts only public posts', () => {
  const f = fixture({virtual_now: SUNDAY});
  const ops = f.call('wirewalk.account.get', {id: 'tamsen-oem', limit: 1});
  assert.deepEqual([ops.account.kind, ops.account.post_count, ids(ops.recent_posts)], ['organization', 2, ['p21']]);
  assert.equal(ops.account.link, 'https://wirewalk.example/@tamsen-oem');
  f.event(fire('p22')); f.event(fire('p23')); f.event(fire('p24'));
  assert.equal(f.call('wirewalk.account.get', {id: 'tamsen-oem'}).account.post_count, 3);
});

test('seed validation rejects inconsistent histories and bookmarks', () => {
  const f = fixture();
  const reject = (mutate, pattern) => {const bad = f.data; mutate(bad); assert.throws(() => plugin.validateSeed(f.ctx, bad), pattern);};
  const post = (d, id) => d.posts.find(p => p.id === id);
  reject(d => d.posts.push(structuredClone(d.posts[0])), /Duplicate post ID/);
  reject(d => d.accounts.push(structuredClone(d.accounts[0])), /Duplicate account ID/);
  reject(d => {post(d, 'p05').author_id = 'nobody';}, /unknown author/);
  reject(d => {post(d, 'p05').published_at = '2015-01-01T00:00:00-08:00';}, /before its author joined/);
  reject(d => {post(d, 'p10').parent_id = 'p12';}, /published after it/);
  reject(d => {post(d, 'p10').parent_id = 'p06';}, /points to a repost/);
  reject(d => {post(d, 'p07').parent_id = 'p05';}, /cannot have parent_id/);
  reject(d => {post(d, 'p06').text = 'Me too';}, /no text/);
  reject(d => {post(d, 'p17').source_id = 'p05';}, /already reposted p05/);
  reject(d => {post(d, 'p05').media[0].alt_text = ' ';}, /alt text/);
  reject(d => {post(d, 'p02').media = structuredClone(post(d, 'p05').media);}, /Duplicate image asset/);
  reject(d => {post(d, 'p20').links.push(structuredClone(post(d, 'p20').links[0]));}, /repeats a link/);
  reject(d => {
    const a = post(d, 'p10'), b = post(d, 'p11');
    a.published_at = b.published_at; a.parent_id = 'p11';
  }, /cycle/);
  reject(d => d.bookmarks.push({post_id: 'p999', saved_at: '2026-10-10T21:00:00-07:00'}), /unknown post/);
  reject(d => d.bookmarks.push({post_id: 'p01', saved_at: '2026-10-10T21:00:00-07:00'}), /Duplicate bookmark/);
  reject(d => {d.bookmarks[0].saved_at = '2026-10-10T14:00:00-07:00';}, /precedes the post/);
  reject(d => {d.account_id = 'ww-other';}, /binding/);
});

test('a seed loads under an earlier run clock; its posts simply stay hidden until the clock reaches them', () => {
  // Core validates package fixtures at registration, so seed dates are not compared with the run clock.
  const early = fixture({virtual_now: '2026-01-01T00:00:00Z'});
  assert.equal(early.call('wirewalk.feed.list', {}).total, 0);
  assert.deepEqual(early.call('wirewalk.bookmarks.list', {}).bookmarks, []);
  unchanged(early, () => early.call('wirewalk.bookmarks.add', {id: 'p01'}), UNAVAILABLE);
  // An account that joins after the clock is hidden like a future post.
  const seed = structuredClone(minimal);
  seed.accounts.push({id: 'late-joiner', display_name: 'Late Joiner', kind: 'person', bio: '', location: null, joined_at: '2026-10-12T00:00:00-07:00'});
  const f = fixture({seed});
  unchanged(f, () => f.call('wirewalk.account.get', {id: 'late-joiner'}), /Account is not available/);
  assert.equal(f.call('wirewalk.account.get', {id: 'odile-park'}).account.post_count, 0);
});

test('diagnostics carry IDs only and cannot change business results', () => {
  const on = fixture(), off = fixture({logging: false}), broken = fixture();
  broken.ctx.log = () => {throw Error('logger offline');};
  for (const f of [on, off, broken]) {f.event(scenario); f.call('wirewalk.bookmarks.add', {id: 'p19'});}
  assert.deepEqual(on.data, off.data); assert.deepEqual(broken.data, off.data);
  assert.deepEqual(on.logs.map(l => l.step), ['wirewalk.post_published', 'wirewalk.bookmarks.add']);
  assert.equal(off.logs.length, 0);
  assert.doesNotMatch(JSON.stringify(on.logs), /eastbound|10:55|text/);
});

test('task data ships a dataset and catalog whose counts and owner match its seed', () => {
  const pkg = require('../contribution/dataset.json'), dario = require('../examples/task-data/dataset.json');
  assert.equal(pkg.expected_counts.records, plugin.records(minimal).length);
  assert.equal(dario.expected_counts.records, plugin.records(darioSeed).length);
  assert.deepEqual({...dario, dataset_id: pkg.dataset_id, expected_counts: pkg.expected_counts}, pkg, 'Only the ID and counts differ');
  const catalog = require('../contribution/assets.catalog.json'), darioCatalog = require('../examples/task-data/assets.catalog.json');
  const normalize = c => {const x = structuredClone(c); x.catalog_id = 'id'; x.assets[0].subjects[0].account_id = 'acct'; x.assets[0].provenance.dataset_id = 'ds'; return x;};
  assert.deepEqual(normalize(darioCatalog), normalize(catalog), 'Only the catalog ID, owner account and dataset ID differ');
  assert.equal(darioCatalog.assets[0].provenance.dataset_id, dario.dataset_id);
});

test('a seed loaded before its latest record shows only the posts and bookmarks that existed at the clock', () => {
  // Dario's seed runs to 17:02 on Monday. At noon the analysts' threads are public, but four of the six
  // reposters have not reposted yet and Dario has not bookmarked anything.
  const NOON = '2026-10-12T12:00:00-07:00', f = fixture({seed: darioSeed, binding: darioBinding, virtual_now: NOON}), before = f.data;
  const now = Date.parse(NOON), shown = darioSeed.posts.filter(p => Date.parse(p.published_at) <= now);
  const feed = f.call('wirewalk.feed.list', {limit: 50});
  assert.equal(feed.total, shown.length);
  assert.deepEqual(ids(feed.posts).sort(), ids(shown).sort());
  for (const p of feed.posts) assert.ok(Date.parse(p.published_at) <= now);
  assert.deepEqual(ids(f.call('wirewalk.search', {kind: 'repost', since: '2026-10-12T00:00:00-07:00'}).posts), ['p34', 'p33']);
  assert.equal(f.call('wirewalk.post.get', {id: 'p29'}).post.reposted_by.length, 1);
  assert.equal(f.call('wirewalk.account.get', {id: 'mika-sorensen'}).account.post_count, 2, 'p05 and p11; the 16:05 reposts come later');
  assert.deepEqual(f.call('wirewalk.bookmarks.list', {}).bookmarks, [], 'Dario bookmarks the threads at 17:00 and 17:02');
  const p29 = f.call('wirewalk.post.get', {id: 'p29'}).post;
  assert.deepEqual([p29.bookmarked, p29.saved_at], [false, null]);
  for (const id of ['p35', 'p44']) {
    unchanged(f, () => f.call('wirewalk.post.get', {id}), UNAVAILABLE);
    unchanged(f, () => f.call('wirewalk.thread.get', {id}), UNAVAILABLE);
    unchanged(f, () => f.call('wirewalk.bookmarks.add', {id}), UNAVAILABLE);
    unchanged(f, () => f.call('wirewalk.bookmarks.remove', {id}), UNAVAILABLE);
  }
  assert.deepEqual(f.call('wirewalk.bookmarks.remove', {id: 'p31'}), {post_id: 'p31', bookmarked: false, changed: false},
    'The 17:02 bookmark does not exist yet, so there is nothing to remove');
  assert.deepEqual(f.data, before);
  // Time passing writes nothing; the later records appear because the clock reached them.
  f.ctx.virtual_now = MONDAY;
  assert.deepEqual(f.data, before);
  assert.equal(f.call('wirewalk.feed.list', {limit: 50}).total, darioSeed.posts.length);
  assert.equal(f.call('wirewalk.post.get', {id: 'p29'}).post.reposted_by.length, 6);
  assert.equal(f.call('wirewalk.post.get', {id: 'p44'}).post.source.id, 'p30');
  assert.deepEqual(f.call('wirewalk.bookmarks.list', {}).bookmarks.map(b => [b.post.id, b.saved_at]),
    [['p31', '2026-10-12T17:02:00-07:00'], ['p29', '2026-10-12T17:00:00-07:00']]);
});

test('bookmarking before a seeded later bookmark keeps one bookmark, dated now', () => {
  // Dario's seed says he bookmarks Odile Park's thread at 17:00; at noon he has not, so the agent's add replaces it.
  const NOON = '2026-10-12T12:00:00-07:00', f = fixture({seed: darioSeed, binding: darioBinding, virtual_now: NOON});
  assert.deepEqual(f.call('wirewalk.bookmarks.add', {id: 'p29'}), {post_id: 'p29', bookmarked: true, changed: true});
  assert.deepEqual(f.data.bookmarks.filter(b => b.post_id === 'p29'), [{post_id: 'p29', saved_at: NOON}]);
  assert.deepEqual(f.call('wirewalk.bookmarks.add', {id: 'p29'}), {post_id: 'p29', bookmarked: true, changed: false});
  assert.deepEqual(f.call('wirewalk.bookmarks.list', {}).bookmarks.map(b => b.post.id), ['p29']);
  f.ctx.virtual_now = MONDAY;
  assert.deepEqual(f.call('wirewalk.bookmarks.list', {}).bookmarks.map(b => [b.post.id, b.saved_at]),
    [['p31', '2026-10-12T17:02:00-07:00'], ['p29', NOON]]);
});

test('the evaluation dataset loads at any clock in its window and shows nothing dated later', () => {
  const evalSeed = require('../data/evaluation/seed.json'), evalBinding = require('../data/evaluation/binding.json');
  const meta = require('../data/evaluation/dataset.json'), catalog = require('../data/evaluation/assets.catalog.json');
  const clock = require('../data/evaluation/clock.json').initial_time;
  assert.equal(meta.expected_counts.records, plugin.records(evalSeed).length);
  assert.ok(require('./schema-validator.cjs').compile(require('../schemas/dataset.schema.json'), path.resolve(__dirname, '../schemas'))(meta), 'dataset.json follows the dataset schema');
  assert.equal(meta.sources.find(s => s.source_id === 'generated').generation.parameters.outputs['seed.json'].sha256, crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../data/evaluation/seed.json'))).digest('hex'));
  assert.equal(catalog.assets[0].provenance.dataset_id, meta.dataset_id);
  assert.equal(catalog.assets[0].subjects[0].account_id, evalSeed.account_id);
  // The fixture's accounts, posts and bookmark are in the dataset verbatim; the seven event posts are not.
  for (const p of minimal.posts) assert.deepEqual(evalSeed.posts.find(q => q.id === p.id), p);
  for (const a of minimal.accounts) assert.deepEqual(evalSeed.accounts.find(b => b.id === a.id), a);
  assert.deepEqual(evalSeed.bookmarks.at(-1), minimal.bookmarks[0]);
  for (const e of [scenario, ...wildfire]) assert.ok(!evalSeed.posts.some(p => p.id === e.payload.id));
  const upTo = (list, field, now) => list.filter(x => Date.parse(x[field]) <= now);
  for (const at of ['2025-03-15T12:00:00-07:00', '2025-12-31T23:59:00-08:00', clock, '2026-12-31T23:59:00-08:00']) {
    const f = fixture({seed: evalSeed, binding: evalBinding, virtual_now: at, logging: false}), before = f.data, now = Date.parse(at);
    const feed = f.call('wirewalk.feed.list', {limit: 50});
    assert.equal(feed.total, upTo(evalSeed.posts, 'published_at', now).length, 'feed total at ' + at);
    for (const p of feed.posts) assert.ok(Date.parse(p.published_at) <= now);
    const found = f.call('wirewalk.search', {query: 'Green Line', limit: 50});
    for (const p of found.posts) assert.ok(Date.parse(f.call('wirewalk.post.get', {id: p.id}).post.published_at) <= now);
    const later = evalSeed.posts.find(p => Date.parse(p.published_at) > now);
    if (later) {
      unchanged(f, () => f.call('wirewalk.post.get', {id: later.id}), UNAVAILABLE);
      unchanged(f, () => f.call('wirewalk.bookmarks.add', {id: later.id}), UNAVAILABLE);
    }
    const marks = f.call('wirewalk.bookmarks.list', {}).bookmarks;
    assert.equal(marks.length, upTo(evalSeed.bookmarks, 'saved_at', now).length, 'bookmarks at ' + at);
    for (const b of marks) assert.ok(Date.parse(b.saved_at) <= now);
    assert.equal(f.call('wirewalk.account.get', {id: 'green-line-ops'}).account.post_count,
      upTo(evalSeed.posts.filter(p => p.author_id === 'green-line-ops'), 'published_at', now).length);
    const recovery = evalSeed.accounts.find(a => a.id === 'cinder-fork-recovery');
    if (Date.parse(recovery.joined_at) > now) unchanged(f, () => f.call('wirewalk.account.get', {id: recovery.id}), /Account is not available/);
    else assert.equal(f.call('wirewalk.account.get', {id: recovery.id}).account.id, recovery.id);
    assert.deepEqual(f.data, before, 'reads change nothing');
  }
  // At the dataset clock the reader sees the fixture's Saturday evening, and the seven example events still apply.
  const f = fixture({seed: evalSeed, binding: evalBinding, virtual_now: clock, logging: false});
  assert.deepEqual(ids(f.call('wirewalk.feed.list', {limit: 6}).posts), ['p18', 'p17', 'p16', 'p15', 'p14', 'p13']);
  assert.deepEqual(f.call('wirewalk.bookmarks.list', {}).bookmarks[0].post.id, 'p01');
  for (const e of [scenario, ...wildfire]) f.event(e);
  assert.equal(f.call('wirewalk.post.get', {id: 'p19'}).post.parent.id, 'p12');
  f.ctx.virtual_now = MONDAY;
  assert.equal(f.call('wirewalk.post.get', {id: 'p29'}).post.reposted_by.length, 6);
});
