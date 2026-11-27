'use strict';
// Deterministic fixture build. PNGs are bundled inputs, not fetched or generated at runtime.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const write = (file, value) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), JSON.stringify(value, null, 2) + '\n');
};
const app = 'reelpulse';
const account = 'reelpulse-creator';
const owner = 'person-creator';
const clock = '2026-11-19T18:00:00Z';
const metrics = (views = 0, saves = 0, completions = 0, unfollows = 0, not_interested = 0) =>
  ({ views, saves, completions, unfollows, not_interested });
const posts = [];
function post(id, title, options = {}) {
  const p = { id, title, account_id: account, caption: '', format: 'reel',
    topic_angle: title, day_slot: 'Sun 10:00', slot_id: id,
    status: 'draft', audience: null, paid_partnership: false, sponsor_id: null,
    tags: [], asset_ids: [], created_at: clock, updated_at: clock,
    scheduled_at: null, published_at: null, schedule_reverted_reason: null, pinned_comment_id: null,
    metrics: metrics(), revisions: [], moderation_history: [], comments: [], ...options };
  posts.push(p);
  return p;
}
const hike = post('post-hike-carousel', 'Weekend ridge hike', {
  format: 'carousel', caption: 'Three stops from the weekend route.', tags: ['#weekendwalk'],
  asset_ids: ['hike-slide-01', 'hike-slide-02', 'hike-slide-03'],
});
const grinder = post('post-draft-grinder-reel', 'Coffee gear: burr grinder dial-in', {
  caption: 'Dial-in comparison and workflow.', tags: ['#CoffeeGear', '#CompetitorBrand'],
  sponsor_id: 'sp-roastcraft-q4', asset_ids: ['coffee-cover-01', 'coffee-frame-02'],
});
const latte = post('post-draft-latte-carousel', 'Oat milk microfoam', {
  format: 'carousel', sponsor_id: 'sp-oat-lab', asset_ids: ['latte-slide-01', 'latte-slide-02'],
});
post('post-sched-matcha-reel', 'Whisk cadence', {
  status: 'scheduled', audience: 'subscribers', scheduled_at: '2026-11-26T18:00:00Z',
  asset_ids: ['matcha-cover-01'],
});
const storage = post('post-draft-storage', 'Small-kitchen storage setup', { sponsor_id: 'sp-storage' });
post('post-draft-journal', 'Weekend brew journal', { format: 'carousel' });
const groups = [
  ['tue-grinder', 'Grinder setup', 'Tue 09:00', 'slot-tue-grinder', 3, metrics(2000, 60, 1400, 2, 6)],
  ['thu-clean', 'Cleaning in five minutes', 'Thu 09:00', 'slot-thu-clean', 3, metrics(1000, 30, 600, 2, 4)],
  ['sat-clickbait', 'Mystery reveal', 'Sat 18:00', 'slot-sat-clickbait', 2, metrics(10000, 100, 4000, 110, 290)],
  ['mon-water', 'Water chemistry', 'Mon 12:00', 'slot-mon-water', 2, metrics(800, 4, 160, 2, 10), 'carousel', 'mon-carousel'],
  ['wed-filter', 'Paper filter comparison', 'Wed 15:00', 'slot-wed-filter', 2, metrics(600, 3, 120, 2, 7), 'carousel', 'wed-carousel'],
  ['fri-shot', 'Bottomless portafilter', 'Fri 11:00', 'slot-fri-shot', 1, metrics(1200, 12, 360, 4, 20), 'reel', 'fri-espresso'],
  ['sun-canister', 'Vacuum canister', 'Sun 10:00', 'slot-sun-canister', 1, metrics(500, 15, 250, 1, 4), 'reel', 'sun-storage'],
];
const discussions = [
  ['Is the burr alignment different with light roast?', 'I lowered the setting by two clicks.', 'Does the original burr fit the newer body?', 'What changes on a stepless dial?'],
  ['Can I use a nylon brush instead?', 'My gasket needed a longer rinse.', 'Does this work on a hand grinder?', 'Thanks for including the purge step.'],
  ['Was the blue bag the decaf?', 'Would have liked to see the grind setting.', 'I guessed washed Ethiopian.', 'Can you show the same beans as a filter brew?'],
  ['What hardness do you aim for?', 'My tap water reads around 80 ppm.', 'Is bicarbonate required?', 'That explains the chalky finish.'],
  ['Which paper drains more slowly?', 'I fold the seam before rinsing.', 'Have you tested the unbleached version?', 'The two brews looked comparable.'],
  ['Did you adjust the dose?', 'This solved the spray on mine.', 'Was that a 20 g basket?', 'Please show how you distribute the grounds.'],
  ['How often do you vent the jar?', 'I only fill mine halfway.', 'Does a freezer bag work too?', 'Thanks for testing after a week.'],
];
for (const [g, [key, topic, day_slot, slot_id, n, counts, format = 'reel', assetPrefix = key]] of groups.entries()) {
  for (let i = 1; i <= n; i++) {
    const id = `post-pub-${key}-${i}`;
    const stamp = new Date(Date.UTC(2026, 2 + (g + i * 2) % 8, 4 + g * 2 + i, 17)).toISOString();
    const last = new Date(Date.parse(stamp) + 4 * 3600000).toISOString();
    const asset = `${assetPrefix}-${String(i).padStart(2, '0')}`;
    const factor = i === 2 ? 2 : 1;
    const comments = discussions[g].map((text, j) => ({
      id: `c-${key}-${i}-${j + 1}`, author: ['Rina', 'Sam', 'Noor', 'Dev'][j], author_role: 'follower',
      text: j === 2 && i === 1 ? 'Claim a free grinder at prizes.invalid now' : text,
      created_at: new Date(Date.parse(stamp) + (j + 1) * 1800000).toISOString(),
      hidden: false, pinned: false, parent_comment_id: null,
    }));
    post(id, `${topic} · ${i}`, {
      caption: `${topic} — workshop session ${i}.`, format, topic_angle: topic, day_slot, slot_id,
      status: 'published', audience: 'public', tags: ['#brewworkshop'],
      asset_ids: fs.existsSync(path.join(root, 'assets', asset + '.png')) ? [asset] : [],
      created_at: stamp, updated_at: last, published_at: stamp,
      metrics: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v * factor])), comments,
    });
  }
}
const members = [
  { person_id: 'person-maya', display_name: 'Maya Lin', badge_label: 'Maya Lin', circle: 'close_friends', sharing: 'close_friends_only' },
  { person_id: 'person-jordan', display_name: 'Jordan Park', badge_label: 'Jordan Park', circle: 'subscribers', sharing: 'public_allowed' },
];
const sponsors = [
  [grinder, 'Roastcraft', 'November burr grinder demo', '2026-11-20T20:00:00Z', true, 'ROAST15'],
  [latte, 'Oat Lab', 'Microfoam recipe', '2026-11-27T20:00:00Z', false, null],
  [storage, 'Shelf & Seal', 'Small-space storage', '2026-12-03T20:00:00Z', true, null],
].map(([p, brand, campaign, earliest_publish_at, approved, promo_code]) => ({
  id: p.sponsor_id, post_id: p.id, brand, campaign, earliest_publish_at, approved, promo_code,
  disclosure_required: true, forbidden_tags: ['#competitorbrand'], updated_at: clock,
}));
const seed = {
  account_id: account, owner_person_id: owner, timezone: 'America/Los_Angeles',
  circles: { close_friends: ['person-maya'], subscribers: ['person-jordan'], members }, sponsors, posts,
};
const tools = require('../tools.json');
const allow = tools.map(t => t.name);
const assets = posts.flatMap(p => p.asset_ids.map(asset_id => {
  const file = `assets/${asset_id}.png`;
  const bytes = fs.readFileSync(path.join(root, file));
  return {
    schema_version: 'pale.asset-descriptor.v1', asset_id, scope: { level: 'package', app_id: app },
    roles: ['content.inline'], subjects: [{ app_id: app, account_id: account, object_type: 'post', object_id: p.id }],
    mime_type: 'image/png', availability: { status: 'ready' },
    storage: { adapter: 'storage.file', path: file, packaging: 'bundled' },
    provenance: { dataset_id: 'reelpulse-synthetic', source_ids: ['synthetic-media'] },
    publication: 'public', access: { audience: ['agent'], rule: 'parent_object' },
    presentation: { alt_text: `${p.format === 'reel' ? 'Reel' : 'Carousel'} still` },
    media: { image: { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } },
    extensions: [], integrity: { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') },
  };
}));
const assert = require('node:assert/strict');
assert.equal(posts.length, 20);
assert.ok(assets.length >= 20 && assets.length <= 24);
assert.ok(assets.reduce((n, a) => n + a.integrity.bytes, 0) < 500 * 1024);
const source = (source_id, description, method) => ({
  source_id, description, kind: 'synthetic', uri: null, license: 'MIT', usage: 'permitted',
  collection: null, generation: { method, tool: 'ReelPulse fixture authoring', tool_version: '1.0.0', seed: null, parameters: {} },
});
write('fixtures/minimal.json', seed);
write('fixtures/clock.json', { initial_time: clock });
write('fixtures/binding.json', { people: [{ person_id: owner, name: 'Avery Vale' }, ...members.map(m => ({ person_id: m.person_id, name: m.display_name }))],
  accounts: [{ app_id: app, account_id: account, owner_person_id: owner }], objects: { [app]: posts.map(p => p.id) } });
write('fixtures/policies.json', { scenario: { allow, constraints: {} }, sandbox: { allow, constraints: {} } });
write('contribution/assets.catalog.json', { schema_version: 'pale.asset-catalog.v1', catalog_id: 'reelpulse-assets',
  app_id: app, dataset_ref: 'dataset.json', assets, extensions: [] });
write('contribution/dataset.json', {
  schema_version: 'pale.dataset.v1', dataset_id: 'reelpulse-synthetic', version: '1.0.0',
  description: 'Fictional creator history and illustrated PNG assets. No external sources.',
  record_source_ids: ['synthetic-records'], sources: [
    source('synthetic-records', 'Authored synthetic creator records and discussions.', 'manual'),
    source('synthetic-media', 'Original code-drawn PNGs with invented subjects and readable test cues.', 'procedural'),
  ], transformations: ['Assigned stable IDs and account-scoped asset parents.'],
  expected_counts: { records: posts.length, assets: assets.length },
  quality_policy: { duplicate_records: 'reject', duplicate_assets: 'reject', missing_assets: 'reject' },
  review: { status: 'pending', reviewer: null, notes: 'Independent visual and provenance review remains open.' },
});
write('examples/scenario.json', { event_id: 'shift-roastcraft-embargo', at: '2026-11-19T22:20:00Z',
  operation: 'reelpulse.sponsor.update', payload: { sponsor_id: grinder.sponsor_id, post_id: grinder.id,
    earliest_publish_at: '2026-11-22T20:00:00Z' } });
write('tests/cases.json', { read: { name: 'reelpulse.posts.get', args: { id: hike.id } } });
