'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../plugin.cjs');
const {fixture} = require('./harness.cjs');
const scenario = require('../examples/scenario.json');
const benSeed = require('../examples/task-data/seed.json');
const benBinding = require('../examples/task-data/binding.json');
const ids = list => list.map(x => x.edition_id);
const local = f => ids(f.call('dayline.front_page.get', {front_page_id: 'local'}).entries);
function unchanged(f, fn, pattern) {const before = f.data; assert.throws(fn, pattern); assert.deepEqual(f.data, before);}
function event(overrides = {}, payload = {}) {
  const e = structuredClone(scenario);
  Object.assign(e, overrides); Object.assign(e.payload, payload);
  for (const [k, v] of Object.entries(payload)) if (v === undefined) delete e.payload[k];
  return e;
}

test('reads are side-effect free; opening an edition leaves the reading history intact', () => {
  const f = fixture(), before = f.data;
  for (const [name, args] of [['dayline.outlets.list', {}], ['dayline.front_pages.list', {}],
    ['dayline.front_page.get', {front_page_id: 'world'}], ['dayline.search', {query: 'rail'}],
    ['dayline.story.get', {story_id: 'rail-funding'}], ['dayline.edition.get', {edition_id: 'rail-local-1'}],
    ['dayline.history.list', {}], ['dayline.saved.list', {}]]) f.call(name, args);
  assert.deepEqual(f.data, before);
  const opened = f.call('dayline.edition.get', {edition_id: 'rail-local-1'}).edition;
  assert.equal(opened.read, false); assert.equal(opened.read_at, null);
  assert.deepEqual(ids(f.call('dayline.history.list', {}).entries.map(e => e.edition)),
    ['rail-wire-1', 'strike-standard-1', 'gulls-preview-1', 'budget-courier-0']);
});

test('front pages list editions in editorial order with private read/saved flags', () => {
  const f = fixture();
  assert.deepEqual(f.call('dayline.front_pages.list', {}).front_pages.map(p => p.front_page_id),
    ['local', 'state', 'national', 'world', 'sports']);
  const page = f.call('dayline.front_page.get', {front_page_id: 'local'});
  assert.deepEqual(page.entries.map(e => e.position), [1, 2, 3, 4, 5]);
  assert.deepEqual(ids(page.entries), ['library-1', 'rail-local-1', 'burnban-valley-1', 'rail-harbor-1', 'gulls-valley-1']);
  assert.equal(page.entries[0].outlet_name, 'Valley Daily');
  assert.equal(f.call('dayline.front_page.get', {front_page_id: 'world', limit: 2}).entries.length, 2);
  const world = f.call('dayline.front_page.get', {front_page_id: 'world'}).entries;
  assert.equal(world.find(e => e.edition_id === 'strike-standard-1').read, true);
  assert.equal(world.find(e => e.edition_id === 'election-standard-1').read, false);
  assert.equal(f.call('dayline.front_page.get', {front_page_id: 'national'}).entries[0].saved, true);
  unchanged(f, () => f.call('dayline.front_page.get', {front_page_id: 'opinion'}), /Front page does not exist/);
});

test('edition.publish inserts at the requested position, keeps relative order and is visible on commit', () => {
  const f = fixture();
  const before = local(f);
  f.event(scenario);
  assert.deepEqual(local(f), ['rail-local-2', ...before]);
  const added = f.call('dayline.edition.get', {edition_id: 'rail-local-2'}).edition;
  // The publisher timestamp (07:05) is earlier than the commit (07:10); the edition is still visible.
  assert.equal(added.published_at, '2026-10-14T07:05:00-07:00');
  assert.equal(added.added_at, scenario.at);
  assert.deepEqual(added.credits, [{edition_id: 'rail-wire-1', credit: 'Wire service reporting on the vote'}]);
  assert.equal(f.call('dayline.search', {query: 'Eastbank first station'}).editions[0].edition_id, 'rail-local-2');
  // Appending at length + 1 and inserting in the middle are both supported.
  f.event(event({event_id: 'tail', at: '2026-10-14T07:20:00-07:00'}, {edition_id: 'rail-local-3', position: 7}));
  assert.equal(local(f).at(-1), 'rail-local-3');
  f.event(event({event_id: 'middle', at: '2026-10-14T07:25:00-07:00'}, {edition_id: 'rail-local-4', position: 3}));
  assert.deepEqual(local(f).slice(0, 4), ['rail-local-2', 'library-1', 'rail-local-4', 'rail-local-1']);
  // An edition may be published without front-page placement.
  f.event(event({event_id: 'unplaced', at: '2026-10-14T07:30:00-07:00'}, {edition_id: 'rail-local-5', front_page: undefined, position: undefined}));
  assert.ok(!local(f).includes('rail-local-5'));
  assert.ok(ids(f.call('dayline.story.get', {story_id: 'rail-funding'}).editions).includes('rail-local-5'));
});

test('an unknown story, outlet, credited edition or placement fails the whole update', () => {
  const f = fixture();
  unchanged(f, () => f.event(event({}, {story_id: 'missing-story'})), /Unknown story/);
  unchanged(f, () => f.event(event({}, {outlet_id: 'missing-outlet'})), /Unknown outlet/);
  unchanged(f, () => f.event(event({}, {credits: [{edition_id: 'rail-wire-9', credit: 'Wire'}]})), /Credited source edition/);
  unchanged(f, () => f.event(event({}, {front_page: 'opinion'})), /Unknown front page/);
  unchanged(f, () => f.event(event({}, {position: 7})), /past the end/);
  unchanged(f, () => f.event(event({}, {position: undefined})), /together/);
  unchanged(f, () => f.event(event({}, {edition_id: 'rail-wire-1'})), /already published/);
  unchanged(f, () => f.event(event({operation: 'edition.retract'})), /Event schema/);
  f.event(scenario);
  unchanged(f, () => f.event(event({event_id: 'republish', at: '2026-10-14T07:20:00-07:00'})), /already published/);
});

test('one story group holds the pre-vote preview, the original dispatch, two straight reprints and the locally expanded edition', () => {
  const f = fixture();
  f.event(scenario);
  const group = f.call('dayline.story.get', {story_id: 'rail-funding'});
  assert.equal(group.story.title, 'Valley Line repair funding');
  assert.deepEqual(ids(group.editions), ['rail-wire-0', 'rail-wire-1', 'rail-local-1', 'rail-harbor-1', 'rail-local-2']);
  const full = id => f.call('dayline.edition.get', {edition_id: id}).edition;
  const original = full('rail-wire-1');
  for (const reprint of ['rail-local-1', 'rail-harbor-1']) {
    const e = full(reprint);
    assert.equal(e.text, original.text, 'Straight reprints copy the dispatch verbatim');
    assert.notEqual(e.headline, original.headline, 'Reprints run under new headlines');
    assert.deepEqual(e.credits.map(c => c.edition_id), ['rail-wire-1']);
  }
  const withInterview = group.editions.map(e => full(e.edition_id)).filter(e => /interview/i.test(e.text));
  assert.deepEqual(ids(withInterview), ['rail-local-2'], 'Only the expanded edition credits the station interview');
});

test('Spanish and English airport-strike editions trace back to one regional report', () => {
  const f = fixture();
  const english = f.call('dayline.edition.get', {edition_id: 'strike-wire-1'}).edition;
  assert.deepEqual(english.credits.map(c => c.edition_id), ['strike-faro-1']);
  const spanish = f.call('dayline.edition.get', {edition_id: 'strike-faro-1'}).edition;
  assert.equal(spanish.language, 'es'); assert.equal(spanish.outlet_name, 'El Faro del Litoral');
  for (const place of ['San Telmo', 'Bahía Honda', 'Puerto Claro', 'Costa Air', 'Ramón Ortiz']) {
    assert.ok(spanish.text.includes(place) && english.text.includes(place), 'Both editions name ' + place);
  }
  assert.match(spanish.text, /viernes 16 de octubre/); assert.match(english.text, /Friday/);
  assert.match(spanish.text, /todavía no se sabe/); assert.match(english.text, /not yet known/);
  // Accent- and case-insensitive search finds the Spanish original and its translation.
  assert.deepEqual(ids(f.call('dayline.search', {query: 'bahia honda'}).editions).sort(), ['strike-faro-1', 'strike-wire-1']);
  assert.deepEqual(ids(f.call('dayline.search', {query: 'Puerto Claro', language: 'es'}).editions), ['strike-faro-1', 'strike-faro-0']);
  // The national headline names no airports; the story group links all four editions.
  assert.doesNotMatch(f.call('dayline.edition.get', {edition_id: 'strike-standard-1'}).edition.text, /San Telmo|Bahía Honda|Puerto Claro/);
  assert.deepEqual(ids(f.call('dayline.story.get', {story_id: 'valdora-strike'}).editions),
    ['strike-faro-0', 'strike-standard-1', 'strike-faro-1', 'strike-wire-1']);
});

test('saving twice leaves one bookmark and the result never echoes the headline', () => {
  const f = fixture();
  const first = f.call('dayline.saved.add', {edition_id: 'gulls-recap-1'});
  assert.deepEqual(first, {edition_id: 'gulls-recap-1', saved: true, changed: true, later_history_removed: null});
  assert.doesNotMatch(JSON.stringify(first), /Ortega|5-4|Owls/);
  assert.deepEqual(f.call('dayline.saved.add', {edition_id: 'gulls-recap-1'}), {edition_id: 'gulls-recap-1', saved: true, changed: false, later_history_removed: null});
  const saved = f.call('dayline.saved.list', {}).entries;
  assert.deepEqual(saved.map(s => s.edition.edition_id), ['gulls-recap-1', 'postal-standard-1']);
  assert.equal(saved[0].saved_at, f.ctx.virtual_now);
  assert.deepEqual(f.call('dayline.saved.remove', {edition_id: 'gulls-recap-1'}), {edition_id: 'gulls-recap-1', saved: false, changed: true, later_history_removed: null});
  unchanged(f, () => f.call('dayline.saved.remove', {edition_id: 'gulls-recap-1'}), /not on the reading list/);
  unchanged(f, () => f.call('dayline.saved.add', {edition_id: 'gulls-recap-9'}), /Edition does not exist/);
  assert.deepEqual(f.call('dayline.saved.list', {}).entries.map(s => s.edition.edition_id), ['postal-standard-1']);
});

test('marking read is explicit and idempotent', () => {
  const f = fixture();
  assert.deepEqual(f.call('dayline.history.mark_read', {edition_id: 'library-1'}), {edition_id: 'library-1', read: true, changed: true, later_history_removed: null});
  assert.deepEqual(f.call('dayline.history.mark_read', {edition_id: 'library-1'}), {edition_id: 'library-1', read: true, changed: false, later_history_removed: null});
  const history = f.call('dayline.history.list', {}).entries;
  assert.equal(history[0].edition.edition_id, 'library-1'); assert.equal(history[0].read_at, f.ctx.virtual_now);
  assert.equal(history.filter(h => h.edition.edition_id === 'library-1').length, 1);
  assert.equal(f.call('dayline.history.list', {limit: 2}).entries.length, 2);
  unchanged(f, () => f.call('dayline.history.mark_read', {edition_id: 'nope'}), /Edition does not exist/);
  unchanged(f, () => f.call('dayline.history.mark_read', {edition_id: 'library-1', role: 'infra'}), /Input schema/);
});

test('two reader instances share the public catalog but keep private state separate', () => {
  const ana = fixture(), ben = fixture({seed: benSeed, binding: benBinding, virtual_now: '2026-10-14T07:30:00-07:00'});
  ana.event(scenario);
  const publicPart = d => ({outlets: d.outlets, stories: d.stories, editions: d.editions, front_pages: d.front_pages});
  assert.deepEqual(publicPart(ben.data), publicPart(ana.data), 'Ben\'s catalog is the minimal seed plus the scenario event');
  ana.call('dayline.saved.add', {edition_id: 'gulls-recap-1'});
  assert.equal(ben.call('dayline.saved.list', {}).entries.length, 0);
  const benLocal = ben.call('dayline.front_page.get', {front_page_id: 'local'}).entries;
  assert.deepEqual(benLocal.slice(0, 3).map(e => [e.edition_id, e.read]), [['rail-local-2', true], ['library-1', false], ['rail-local-1', false]]);
  assert.equal(ana.call('dayline.front_page.get', {front_page_id: 'local'}).entries[0].read, false);
  // Seeds bound to a different account are rejected.
  assert.throws(() => plugin.validateSeed(ana.ctx, benSeed), /binding/);
});

test('seed validation rejects inconsistent catalogs and private state', () => {
  const f = fixture();
  const reject = (mutate, pattern) => {const bad = f.data; mutate(bad); assert.throws(() => plugin.validateSeed(f.ctx, bad), pattern);};
  reject(d => d.editions.push(structuredClone(d.editions[0])), /Duplicate edition/);
  reject(d => {d.editions[0].story_id = 'missing';}, /unknown story/);
  reject(d => {d.editions[0].outlet_id = 'missing';}, /unknown outlet/);
  reject(d => {d.editions[0].headline = '   ';}, /blank/);
  reject(d => {d.editions.find(e => e.edition_id === 'rail-wire-1').credits = [{edition_id: 'rail-local-1', credit: 'Loop'}];}, /later|cycle/);
  reject(d => {d.editions.find(e => e.edition_id === 'rail-local-1').credits.push({edition_id: 'rail-wire-1', credit: 'Again'});}, /repeats/);
  reject(d => {d.editions[0].published_at = d.editions[0].added_at = '2026-10-01T00:00:00-07:00';}, /before its story group/);
  reject(d => {d.editions[0].published_at = '2026-10-13T00:00:00-07:00';}, /dated after it was published/);
  reject(d => {d.front_pages[0].entries.push('missing');}, /unknown edition/);
  reject(d => {d.reading_history.push({edition_id: 'missing', read_at: '2026-10-14T06:00:00-07:00'});}, /unknown edition/);
  reject(d => {d.reading_history.push(structuredClone(d.reading_history[0]));}, /Duplicate/);
  reject(d => {d.reading_list[0].saved_at = '2026-10-01T00:00:00-07:00';}, /precedes/);
  reject(d => {d.account_id = 'other';}, /binding/);
});

test('a story group declared for a later event stays hidden until an edition is published to it', () => {
  const seed = structuredClone(require('../fixtures/minimal.json'));
  seed.stories.push({story_id: 'transit-strike', title: 'Valley transit strike', created_at: '2026-10-14T06:00:00-07:00'});
  const f = fixture({seed});
  unchanged(f, () => f.call('dayline.story.get', {story_id: 'transit-strike'}), /Story does not exist/);
  assert.equal(f.call('dayline.search', {query: 'transit strike'}).total, 0);
  f.event(event({event_id: 'strike-breaks'}, {edition_id: 'transit-strike-1', story_id: 'transit-strike', headline: 'Valley transit drivers set strike date', credits: []}));
  assert.deepEqual(ids(f.call('dayline.story.get', {story_id: 'transit-strike'}).editions), ['transit-strike-1']);
});

test('search filters, ordering and limits', () => {
  const f = fixture();
  const all = f.call('dayline.search', {});
  assert.equal(all.total, 25); assert.equal(all.editions.length, 20);
  const times = all.editions.map(e => Date.parse(e.published_at));
  assert.deepEqual(times, times.slice().sort((a, b) => b - a), 'Newest publication first');
  assert.deepEqual(ids(f.call('dayline.search', {outlet_id: 'capitol-courier', section: 'politics'}).editions), ['budget-courier-1', 'budget-courier-0']);
  assert.deepEqual(ids(f.call('dayline.search', {query: 'gulls', published_after: '2026-10-14T00:00:00-07:00'}).editions),
    ['gulls-valley-1', 'gulls-schedule-1']);
  assert.deepEqual(ids(f.call('dayline.search', {query: 'Contributed', published_before: '2026-10-14T06:00:00-07:00'}).editions), ['election-standard-1']);
  assert.equal(f.call('dayline.search', {query: 'rail', limit: 1}).editions.length, 1);
  assert.equal(f.call('dayline.search', {query: 'zeppelin'}).total, 0);
  unchanged(f, () => f.call('dayline.search', {limit: 0}), /Input schema/);
});

test('sports fixtures: preview and schedule are scoreboard-free; the full recap is distinct from the wire brief', () => {
  const f = fixture();
  const full = id => f.call('dayline.edition.get', {edition_id: id}).edition;
  for (const id of ['gulls-preview-1', 'gulls-schedule-1']) {
    const e = full(id), words = (e.headline + ' ' + e.text).replace(/\(\d+-\d+, [\d.]+ ERA\)/g, '');
    assert.doesNotMatch(words, /\b\d+-\d+\b|\bwin\b|\bwon\b|\bbeat\b|walk-off|past the Owls/i, id + ' reveals no result');
  }
  assert.match(full('gulls-recap-1').headline, /5-4/);
  assert.ok(full('gulls-recap-1').text.length > 2 * full('gulls-wire-recap-1').text.length, 'Full recap is the long one');
  assert.match(full('gulls-schedule-1').text, /Friday, Oct\. 16: 7:10 p\.m\. CDT/);
  assert.deepEqual(ids(f.call('dayline.front_page.get', {front_page_id: 'sports'}).entries),
    ['gulls-recap-1', 'gulls-schedule-1', 'gulls-wire-recap-1', 'gulls-valley-1']);
});

test('diagnostics carry IDs only and cannot change business results', () => {
  const on = fixture(), off = fixture({logging: false}), broken = fixture();
  broken.ctx.log = () => {throw Error('logger offline');};
  for (const f of [on, off, broken]) {f.event(scenario); f.call('dayline.saved.add', {edition_id: 'gulls-recap-1'});}
  assert.deepEqual(on.data, off.data); assert.deepEqual(broken.data, off.data);
  assert.deepEqual(on.logs.map(l => l.step), ['dayline.edition_published', 'dayline.saved.add']);
  assert.equal(off.logs.length, 0);
  assert.doesNotMatch(JSON.stringify(on.logs), /Eastbank|Ortega|headline|text/);
});

test('lists put the latest write first when writes share the session clock', () => {
  const f = fixture();
  f.call('dayline.saved.add', {edition_id: 'gulls-recap-1'});
  f.call('dayline.saved.add', {edition_id: 'library-1'});
  assert.deepEqual(f.call('dayline.saved.list', {}).entries.map(e => e.edition.edition_id), ['library-1', 'gulls-recap-1', 'postal-standard-1']);
  f.call('dayline.history.mark_read', {edition_id: 'strike-wire-1'});
  f.call('dayline.history.mark_read', {edition_id: 'budget-courier-1'});
  assert.deepEqual(ids(f.call('dayline.history.list', {limit: 3}).entries.map(e => e.edition)), ['budget-courier-1', 'strike-wire-1', 'rail-wire-1']);
});

test('search matches the start of words, not substrings', () => {
  const f = fixture();
  const air = ids(f.call('dayline.search', {query: 'air'}).editions);
  assert.ok(air.includes('strike-wire-1'), '"airports" matches "air"');
  assert.ok(!air.some(id => id.startsWith('rail-')), '"repairing" does not match "air"');
  assert.deepEqual(ids(f.call('dayline.search', {query: 'aero'}).editions).sort(), ['strike-faro-0', 'strike-faro-1']);
  assert.deepEqual(ids(f.call('dayline.search', {query: 'puerto-claro'}).editions), ids(f.call('dayline.search', {query: 'Puerto Claro'}).editions));
});

test('a seed loaded before its latest record shows only what existed at the clock', () => {
  // Ben's seed runs to 07:20 on Oct. 14. At 18:00 on Oct. 13 the vote dispatch (added 18:42) is not in Dayline yet.
  const f = fixture({seed: benSeed, binding: benBinding, virtual_now: '2026-10-13T18:00:00-07:00'}), before = f.data;
  const now = Date.parse(f.ctx.virtual_now);
  const found = f.call('dayline.search', {limit: 50}).editions;
  assert.deepEqual(ids(found).sort(), benSeed.editions.filter(e => Date.parse(e.added_at) <= now).map(e => e.edition_id).sort());
  for (const e of found) assert.ok(Date.parse(f.call('dayline.edition.get', {edition_id: e.edition_id}).edition.added_at) <= now);
  assert.deepEqual(local(f), []);
  assert.equal(f.call('dayline.front_pages.list', {}).front_pages.find(p => p.front_page_id === 'local').entry_count, 0);
  assert.deepEqual(ids(f.call('dayline.front_page.get', {front_page_id: 'national'}).entries), ['postal-standard-1', 'postal-wire-1']);
  assert.deepEqual(ids(f.call('dayline.story.get', {story_id: 'rail-funding'}).editions), ['rail-wire-0']);
  assert.throws(() => f.call('dayline.story.get', {story_id: 'library-hours'}), {code: 'not_found'});
  assert.throws(() => f.call('dayline.edition.get', {edition_id: 'rail-wire-1'}), {code: 'not_found'});
  assert.deepEqual(ids(f.call('dayline.history.list', {}).entries.map(e => e.edition)), ['budget-courier-0']);
  unchanged(f, () => f.call('dayline.saved.add', {edition_id: 'rail-wire-1'}), {code: 'not_found'});
  unchanged(f, () => f.call('dayline.history.mark_read', {edition_id: 'rail-local-2'}), {code: 'not_found'});
  assert.deepEqual(f.data, before);
  // Time passing writes nothing; the later records appear because the clock reached them.
  f.ctx.virtual_now = '2026-10-14T07:20:00-07:00';
  assert.deepEqual(f.data, before);
  assert.equal(f.call('dayline.edition.get', {edition_id: 'rail-wire-1'}).edition.read, true);
  assert.deepEqual(local(f), ['rail-local-2', 'library-1', 'rail-local-1', 'burnban-valley-1', 'rail-harbor-1', 'gulls-valley-1']);
  assert.deepEqual(ids(f.call('dayline.history.list', {}).entries.map(e => e.edition)), ['rail-local-2', 'rail-wire-1', 'budget-courier-0']);
});

test('marking read before a seeded later read keeps one entry, dated now', () => {
  // Ben's seed says he read the vote dispatch at 21:40; at 19:00 he has not, so the agent's read replaces it.
  const f = fixture({seed: benSeed, binding: benBinding, virtual_now: '2026-10-13T19:00:00-07:00'});
  assert.equal(f.call('dayline.edition.get', {edition_id: 'rail-wire-1'}).edition.read, false);
  assert.equal(f.call('dayline.history.mark_read', {edition_id: 'rail-wire-1'}).changed, true);
  assert.deepEqual(f.data.reading_history.filter(h => h.edition_id === 'rail-wire-1'),
    [{edition_id: 'rail-wire-1', read_at: '2026-10-13T19:00:00-07:00'}]);
  assert.equal(f.call('dayline.history.mark_read', {edition_id: 'rail-wire-1'}).changed, false);
});

test('edition.publish positions count only the front-page entries visible at the event time', () => {
  // At 06:05 the local page shows rail-local-1 (05:31) and rail-harbor-1 (06:01); the other three come later.
  const f = fixture({virtual_now: '2026-10-14T06:02:00-07:00'});
  assert.deepEqual(local(f), ['rail-local-1', 'rail-harbor-1']);
  f.event(event({at: '2026-10-14T06:05:00-07:00'}, {published_at: '2026-10-14T06:04:00-07:00', position: 2}));
  assert.deepEqual(local(f), ['rail-local-1', 'rail-local-2', 'rail-harbor-1']);
  unchanged(f, () => f.event(event({event_id: 'past-end', at: '2026-10-14T06:06:00-07:00'},
    {edition_id: 'rail-local-3', published_at: '2026-10-14T06:04:00-07:00', position: 5})), {code: 'invalid_event'});
  f.ctx.virtual_now = '2026-10-14T07:00:00-07:00';
  assert.deepEqual(local(f), ['library-1', 'rail-local-1', 'burnban-valley-1', 'rail-local-2', 'rail-harbor-1', 'gulls-valley-1']);
});

test('edition.publish rejects inconsistent timing and content with invalid_event', () => {
  const f = fixture();
  const code = {code: 'invalid_event'};
  unchanged(f, () => f.event(event({}, {published_at: '2026-10-14T07:30:00-07:00'})), code);
  unchanged(f, () => f.event(event({}, {published_at: '2026-10-13T18:00:00-07:00'})), /published later/);
  unchanged(f, () => f.event(event({}, {headline: '   '})), code);
  unchanged(f, () => f.event(event({}, {credits: [{edition_id: 'rail-wire-1', credit: 'A'}, {edition_id: 'rail-wire-1', credit: 'B'}]})), code);
});

test('task data ships a dataset whose record count matches its seed', () => {
  const pkg = require('../contribution/dataset.json'), ben = require('../examples/task-data/dataset.json');
  assert.equal(pkg.expected_counts.records, require('../fixtures/minimal.json').editions.length);
  assert.equal(ben.expected_counts.records, benSeed.editions.length);
  assert.deepEqual({...ben, dataset_id: pkg.dataset_id, expected_counts: pkg.expected_counts}, pkg, 'Only the ID and counts differ');
});

test('the evaluation dataset loads at any clock in its window and shows nothing dated later', () => {
  const evalSeed = require('../data/evaluation/seed.json'), evalBinding = require('../data/evaluation/binding.json');
  const meta = require('../data/evaluation/dataset.json');
  assert.equal(meta.expected_counts.records, evalSeed.editions.length);
  const {compile} = require('./schema-validator.cjs');
  assert.ok(compile(require('../schemas/dataset.schema.json'), require('node:path').resolve(__dirname, '../schemas'))(meta), 'dataset.json follows the dataset schema');
  assert.equal(meta.sources.find(s => s.source_id === 'generated').generation.parameters.outputs['seed.json'].sha256, require('node:crypto').createHash('sha256')
    .update(require('node:fs').readFileSync(require.resolve('../data/evaluation/seed.json'))).digest('hex'));
  const shown = at => evalSeed.editions.filter(e => Date.parse(e.added_at) <= Date.parse(at));
  for (const at of ['2025-03-15T12:00:00-07:00', '2025-12-31T23:59:00-08:00', require('../data/evaluation/clock.json').initial_time, '2026-12-31T23:59:00-08:00']) {
    const f = fixture({seed: evalSeed, binding: evalBinding, virtual_now: at, logging: false}), before = f.data, now = Date.parse(at);
    const found = f.call('dayline.search', {limit: 50});
    assert.equal(found.total, shown(at).length, 'search total at ' + at);
    for (const e of found.editions) assert.ok(Date.parse(f.call('dayline.edition.get', {edition_id: e.edition_id}).edition.added_at) <= now);
    const later = evalSeed.editions.find(e => Date.parse(e.added_at) > now);
    if (later) assert.throws(() => f.call('dayline.edition.get', {edition_id: later.edition_id}), {code: 'not_found'});
    const history = f.call('dayline.history.list', {limit: 200}).entries;
    assert.equal(history.length, Math.min(200, evalSeed.reading_history.filter(h => Date.parse(h.read_at) <= now).length));
    for (const h of history) assert.ok(Date.parse(h.read_at) <= now);
    for (const page of f.call('dayline.front_pages.list', {}).front_pages) {
      for (const entry of f.call('dayline.front_page.get', {front_page_id: page.front_page_id}).entries) {
        assert.ok(Date.parse(f.call('dayline.edition.get', {edition_id: entry.edition_id}).edition.added_at) <= now);
      }
    }
    assert.deepEqual(f.data, before, 'reads change nothing');
  }
  // At the dataset clock the reader sees the fixture's front pages and history.
  const atClock = fixture({seed: evalSeed, binding: evalBinding, logging: false});
  assert.deepEqual(local(atClock), require('../fixtures/minimal.json').front_pages[0].entries);
  assert.deepEqual(ids(atClock.call('dayline.history.list', {limit: 4}).entries.map(e => e.edition)),
    ['rail-wire-1', 'strike-standard-1', 'gulls-preview-1', 'budget-courier-0']);
});

// Later history replaced by a write at an earlier clock. Independent of src/operations.cjs: an entry is later
// history when its own time lies after the clock. The receipt must count exactly the later entries the write
// replaced or removed, and the ID-only diagnostics log must name their editions.
test('a write at an earlier clock that replaces a seeded later read or save counts it in the receipt', () => {
  const seed = require('../data/evaluation/seed.json'), binding = require('../data/evaluation/binding.json');
  const run = (at, name, edition_id) => {
    const f = fixture({seed, binding, virtual_now: at}), before = f.data, receipt = f.call(name, {edition_id}), after = f.data, lost = {};
    for (const [list, field] of [['reading_history', 'read_at'], ['reading_list', 'saved_at']]) {
      const kept = new Set(after[list].map(x => JSON.stringify(x)));
      const gone = before[list].filter(x => !kept.has(JSON.stringify(x)) && Date.parse(x[field]) > Date.parse(at));
      if (gone.length) lost[list] = gone;
    }
    const counts = Object.keys(lost).length ? Object.fromEntries(Object.entries(lost).map(([k, v]) => [k, v.length])) : null;
    assert.deepEqual(receipt.later_history_removed, counts, 'the receipt counts the later entries replaced');
    const named = Object.fromEntries(Object.entries(lost).map(([k, v]) => [k, v.map(x => x.edition_id)]));
    assert.deepEqual(f.logs.at(-1).details.later_history_removed, Object.keys(lost).length ? named : null, 'the log names their editions');
    return {receipt, after, lost};
  };
  // The Feb. 5, 2025 business brief was read at 22:58; marking it read at noon replaces that later read.
  const read = run('2025-02-05T12:00:00-08:00', 'dayline.history.mark_read', 'biz-20250205');
  assert.deepEqual(read.lost.reading_history.map(h => h.read_at), ['2025-02-05T22:58:00-08:00']);
  assert.equal(read.after.reading_history.find(h => h.edition_id === 'biz-20250205').read_at, '2025-02-05T12:00:00-08:00');
  // The Mar. 11, 2025 transit story was saved the next morning; saving it at midnight replaces that save.
  assert.deepEqual(run('2025-03-12T00:00:00-07:00', 'dayline.saved.add', 'transit-20250311-vote-valley').receipt.later_history_removed, {reading_list: 1});
  // An edition never read before reports null.
  assert.equal(run('2025-02-05T12:00:00-08:00', 'dayline.history.mark_read', 'snowpack-20250102').receipt.later_history_removed, null);
});
