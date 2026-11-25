'use strict';
// Maintainer script (not run by tests or the verifier). Builds the fixtures, example events, the
// second family's task data and dataset counts from one authored source. Listening history is expanded
// from hand-written routines by fixed arithmetic (no randomness), and progress, play counts and
// downloads are derived from that history so they agree with it. Usage, from the package directory:
// node dev/build-fixtures.cjs
const fs = require('node:fs'), path = require('node:path');
const assert = require('node:assert/strict');
const out = path.resolve(__dirname, '..');
const write = (file, value) => {fs.mkdirSync(path.dirname(path.join(out, file)), {recursive: true}); fs.writeFileSync(path.join(out, file), JSON.stringify(value, null, 2) + '\n');};
const MB = 1000000;

// ---------------------------------------------------------------- time
// Pacific time: PDT (-07:00) from Mar. 8 to Oct. 31, 2026; PST (-08:00) otherwise.
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
const offset = date => date >= '2026-03-08' && date <= '2026-10-31' ? '-07:00' : '-08:00';
const T = (date, time) => date + 'T' + time + (time.length === 5 ? ':00' : '') + offset(date);
const addDays = (date, n) => {const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return ymd(d);};
const plusSeconds = (ts, s) => {
  const ms = Date.parse(ts) + s * 1000, off = ts.slice(-6), sign = off[0] === '-' ? -1 : 1;
  const local = new Date(ms + sign * (Number(off.slice(1, 3)) * 60 + Number(off.slice(4))) * 60000);
  return local.toISOString().slice(0, 19) + off;
};
const before = (a, b) => Date.parse(a) < Date.parse(b);
const CLOCK = '2026-11-24T19:00:00-08:00';

// ---------------------------------------------------------------- catalog: music
const artists = [
  ['saltline', 'Saltline Arcade', 'Four-piece guitar band from a fictional port town; loud choruses and louder lyrics.'],
  ['marrow', 'Marrow & Finch', 'Folk duo writing about rivers, kitchens and long drives.'],
  ['halcyon', 'Halcyon Tramline', 'Instrumental electronic project built from field recordings of city transit.'],
  ['juno', 'Juno Halvorsen-Pike', 'Singer-songwriter with piano ballads and one very fast song per album.'],
  ['kestrel', 'Kestrel Junction', 'Country-leaning band known for sing-along road songs.'],
  ['copperleaf', 'The Copperleaf Static', 'Garage rock trio; the radio edits are a family favourite.'],
  ['mbali', 'Mbali Okonjo-Strand', 'Soul singer whose second album is mostly about trains.'],
  ['lowtide', 'Lowtide Cartography', 'Ambient composer who titles every piece after an imaginary map.'],
  ['gutterglow', 'Gutterglow Kids', 'Hip-hop collective; most albums ship with a clean edit.'],
  ['tamsin', 'Tamsin Vey & the Overpass', 'Bright pop band with a drummer who sings harmony.'],
].map(([slug, name, bio]) => ({artist_id: 'art-' + slug, name, bio}));
const ALBUMS = [
  ['saltline', 1, 'Harbor Lights Out', '2024-05-10', 8], ['saltline', 2, 'Low Ceiling Weather', '2026-02-20', 7],
  ['marrow', 1, 'Kitchen Window Songs', '2023-09-15', 7], ['marrow', 2, 'The River Keeps the Score', '2025-11-07', 7],
  ['halcyon', 1, 'Night Bus Atlas', '2025-03-14', 7],
  ['juno', 1, 'Paper Boats in March', '2022-03-04', 7], ['juno', 2, 'Small Hours, Big Rooms', '2025-08-22', 7],
  ['kestrel', 1, 'Mile Marker Hymns', '2024-06-28', 8],
  ['copperleaf', 1, 'Basement Weather Report', '2023-04-21', 7], ['copperleaf', 2, 'Fuse Box Lullabies', '2026-01-30', 7],
  ['mbali', 1, 'Platform Nine Blues', '2024-10-11', 7],
  ['lowtide', 1, 'Maps of Quiet Coasts', '2025-01-17', 8],
  ['gutterglow', 1, 'Corner Store Prophets', '2024-02-02', 7], ['gutterglow', 2, 'Streetlight Homework', '2025-10-03', 7],
  ['tamsin', 1, 'Overpass Summer', '2025-06-06', 7],
];
const WORDS_A = ['Copper', 'Paper', 'Harbor', 'Midnight', 'Glass', 'Velvet', 'Borrowed', 'Northern', 'Hollow', 'Lantern', 'Silver', 'Rusted'];
const WORDS_B = ['Lights', 'Avenue', 'Weather', 'Signals', 'Rooms', 'Tides', 'Letters', 'Engines', 'Gardens', 'Echoes'];
const EXPLICIT_WITH_CLEAN = ['saltline-02', 'saltline-05', 'saltline-07', 'saltline-11', 'gutterglow-01', 'gutterglow-03', 'gutterglow-04',
  'gutterglow-06', 'gutterglow-09', 'gutterglow-12', 'copperleaf-04', 'copperleaf-08'];
const EXPLICIT_NO_CLEAN = ['saltline-14', 'gutterglow-10', 'tamsin-05'];
const albums = [], tracks = [];
let titleIndex = 0;
const perArtist = {};
for (const [slug, n, title, released, count] of ALBUMS) {
  const album = {album_id: 'alb-' + slug + '-' + n, artist_id: 'art-' + slug, title, released, track_ids: [], availability: 'available'};
  for (let i = 0; i < count; i++) {
    const num = perArtist[slug] = (perArtist[slug] || 0) + 1, key = slug + '-' + pad(num);
    const combo = (titleIndex++ * 7) % 120;
    const duration = 150 + ((titleIndex * 37) % 181);
    const explicit = EXPLICIT_WITH_CLEAN.includes(key) || EXPLICIT_NO_CLEAN.includes(key);
    const track = {track_id: 'tr-' + key, album_id: album.album_id, artist_id: album.artist_id,
      title: WORDS_A[combo % 12] + ' ' + WORDS_B[Math.floor(combo / 12)], duration_s: duration, explicit,
      clean_version_id: EXPLICIT_WITH_CLEAN.includes(key) ? 'tr-' + key + 'c' : null, bytes: duration * 20000, availability: 'available'};
    tracks.push(track); album.track_ids.push(track.track_id);
  }
  albums.push(album);
}
for (const key of EXPLICIT_WITH_CLEAN) {
  const t = tracks.find(x => x.track_id === 'tr-' + key);
  tracks.push({...t, track_id: t.track_id + 'c', explicit: false, clean_version_id: null});
}
assert.equal(new Set(tracks.filter(t => !t.track_id.endsWith('c')).map(t => t.title)).size, 108, 'Track titles are unique');

// ---------------------------------------------------------------- catalog: podcasts
const SHOWS = {
  fieldnotes: {title: 'Field Notes', publisher: 'Wren Hollow Audio', explicit: false,
    description: 'Short walks with a sound recordist and a guest naturalist, one habitat at a time.',
    subjects: ['night herons of the estuary', 'a beaver dam after rain', 'urban crows at dusk', 'moss on a north-facing wall', 'tide pool hermit crabs',
      'the dawn chorus in July', 'bats over the reservoir', 'a salt marsh at low tide', 'lichens on gravestones', 'wasps that build with paper',
      'the first frost in the orchard', 'migrating geese overhead', 'fungi after the September rain', 'a creek in drought', 'owls in the cemetery oaks',
      'the sound of ice forming', 'starlings over the pier', 'a meadow mowed too early', 'otters returning to the harbor', 'winter wrens']},
  harborhours: {title: 'Harbor Hours', publisher: 'Pierlight Media', explicit: false,
    description: 'Weekly stories from the docks, ferries and night shifts of a working harbor town.',
    subjects: ['the last ferry captain', 'a lighthouse with no keeper', 'night shift at the fish market', 'the crane operators', 'a tugboat family',
      'the harbor pilot exam', 'a sunken barge mystery', 'the bridge that opens at 3 a.m.', 'rope makers on Quay Street', 'the seawall vote',
      'a ferry strike in 1974', 'container ship sleep schedules', 'the oyster beds', 'a radio operator\'s logbook', 'storm week',
      'the dockside choir', 'smugglers\' tunnels that were never there', 'the new terminal', 'a harbor seal named Doris', 'fog horns and the people who miss them',
      'lifeboat volunteers', 'the welders\' union', 'a shipyard closes', 'the floating library']},
  kettletheory: {title: 'Kettle Theory', publisher: 'Small Batch Studios', explicit: false,
    description: 'The chemistry behind weeknight cooking, explained while something is on the stove.',
    subjects: ['why onions brown', 'sourdough starters', 'cast iron seasoning', 'brown butter', 'salting pasta water', 'emulsions that break',
      'the perfect boiled egg', 'rice that does not stick', 'resting meat', 'baking soda and baking powder', 'freezing bread', 'pickling in a hurry',
      'stock from scraps', 'caramel without fear', 'yeast in the cold', 'crispy roast potatoes', 'tofu that soaks up flavor', 'why bread goes stale',
      'whipping cream by hand', 'soup that tastes like more', 'rescuing a sauce', 'dry brining', 'a better grilled cheese']},
  overtimealmanac: {title: 'Overtime Almanac', publisher: 'Long Ball Audio', explicit: false,
    description: 'Odd records, forgotten seasons and one listener argument settled each week.',
    subjects: ['the longest rain delay', 'a goalkeeper who scored twice', 'the 19-inning game', 'mascots that were fired', 'a marathon run backwards',
      'the umpire who wore glasses', 'stadiums built on landfill', 'a curling dynasty', 'the team that forfeited for fog', 'coaches who never smiled',
      'the slowest triple', 'a bowling perfect game on live radio', 'women\'s baseball in 1948', 'the shortest boxing match', 'ice hockey in a heatwave',
      'jerseys that changed rules', 'a horse race with no finish line', 'the commentator who quit live', 'trick plays that worked once', 'the draft-day trade',
      'season review']},
  staticsignal: {title: 'Static & Signal', publisher: 'Relay Point Podcasts', explicit: false,
    description: 'A plain-language look at the gadgets, networks and apps in an ordinary week.',
    subjects: ['why phone batteries swell', 'mesh routers', 'passkeys', 'e-ink tablets', 'the end of a satellite', 'repairable laptops', 'spam calls',
      'smart plugs that phone home', 'ham radio for beginners', 'cloud photo storage', 'fiber to the street', 'password managers', 'eSIMs',
      'old game consoles', 'drone rules', 'right to repair', 'subscription creep', 'electric bike batteries', 'car software updates',
      'printers that refuse ink', 'the year in gadgets']},
  lanternledger: {title: 'The Lantern Ledger', publisher: 'Fogbound Audio', explicit: false,
    description: 'Monthly long-form stories about small historical mysteries and the archivists who solve them.',
    subjects: ['the missing parish register', 'a lighthouse keeper\'s second diary', 'the bank that opened for one day', 'a map with an extra island',
      'the 1911 census error', 'a portrait with the wrong name', 'the stolen church bell', 'letters in a piano', 'the town that changed its clocks',
      'a ship that arrived twice', 'the last telegram']},
  bedtimebramble: {title: 'Bedtime Bramble', publisher: 'Little Owl Audio', explicit: false,
    description: 'Gentle bedtime stories about a hedgehog, a badger and their very small village.',
    subjects: ['the lost acorn', 'the badger\'s birthday', 'a very windy night', 'the snail race', 'the moon in the pond', 'the hedgehog learns to whistle',
      'the bridge made of leaves', 'a picnic in the rain', 'the owl who could not sleep', 'the first snow', 'the lantern parade', 'the borrowed scarf',
      'the quietest drum', 'the hedgehog\'s new boots', 'a lost kite', 'the badger bakes bread', 'the longest day', 'the river picnic',
      'the night of falling stars']},
  loudlibrary: {title: 'Loud Library', publisher: 'Hallpass Radio', explicit: true,
    description: 'Two college students review books, games and music with no bleeps.',
    subjects: ['books we were forced to read', 'the worst game sequels', 'graphic novels for beginners', 'concert ticket chaos', 'fan fiction, seriously',
      'study playlists ranked', 'the summer reading list', 'horror novels for cowards', 'music festivals on a budget', 'debut albums of the year',
      'library late fees', 'gift guide for people who read']},
};
// [show, first date, step in days, first number, count, duration base, duration spread]
const SCHEDULE = [
  ['fieldnotes', '2026-07-18', 7, 96, 19, 2160, 420], ['harborhours', '2026-01-06', 14, 65, 24, 2880, 600],
  ['kettletheory', '2026-01-08', 14, 31, 23, 1920, 360], ['overtimealmanac', '2026-01-05', 14, 101, 21, 2520, 480],
  ['staticsignal', '2026-01-14', 14, 51, 21, 2280, 420], ['lanternledger', '2026-01-02', 30, 1, 11, 3720, 300],
  ['bedtimebramble', '2026-03-15', 14, 1, 19, 840, 240], ['loudlibrary', '2026-01-09', 28, 21, 12, 2700, 600],
];
const PATTERNS = {
  fieldnotes: s => s[0].toUpperCase() + s.slice(1), harborhours: s => s[0].toUpperCase() + s.slice(1),
  kettletheory: s => s[0].toUpperCase() + s.slice(1), overtimealmanac: s => s[0].toUpperCase() + s.slice(1),
  staticsignal: s => s[0].toUpperCase() + s.slice(1), lanternledger: s => s[0].toUpperCase() + s.slice(1),
  bedtimebramble: s => s[0].toUpperCase() + s.slice(1), loudlibrary: s => s[0].toUpperCase() + s.slice(1),
};
const FIXED_EPISODES = {
  'ep-fieldnotes-112': {duration_s: 2520, end_of_content_s: 2450},
  'ep-fieldnotes-113': {duration_s: 2265, end_of_content_s: 2190},
  'ep-fieldnotes-114': {duration_s: 2400, end_of_content_s: 2330},
  'ep-harborhours-088': {duration_s: 3120, end_of_content_s: 3050},
};
const shows = [], episodes = [];
for (const [slug, first, step, start, count, base, spread] of SCHEDULE) {
  const s = SHOWS[slug];
  shows.push({show_id: 'show-' + slug, title: s.title, publisher: s.publisher, description: s.description, explicit: s.explicit, availability: 'available'});
  for (let i = 0; i < count; i++) {
    const number = start + i, id = 'ep-' + slug + '-' + String(number).padStart(3, '0');
    const fixed = FIXED_EPISODES[id] || {};
    const duration = fixed.duration_s ?? base + ((i * 113) % spread);
    const subject = s.subjects[i];
    const date = addDays(first, i * step);
    episodes.push({episode_id: id, show_id: 'show-' + slug, number, title: PATTERNS[slug](subject), published_at: T(date, '05:00'),
      duration_s: duration, end_of_content_s: fixed.end_of_content_s ?? duration - 60 - (i % 4) * 15,
      chapters: [{title: 'Opening', start_s: 0}, {title: PATTERNS[slug](subject), start_s: 90 + (i % 3) * 30},
        {title: slug === 'bedtimebramble' ? 'Goodnight' : 'Listener notes', start_s: Math.floor(duration * 0.8)}],
      notes: s.description.replace(/\.$/, '') + '. This episode: ' + subject + '.', bytes: duration * 16000, explicit: s.explicit,
      availability: 'available'});
  }
}
// One episode was pulled by its publisher after a rights dispute; it stays readable in history.
episodes.find(e => e.episode_id === 'ep-lanternledger-003').availability = 'removed';
const episode = id => episodes.find(e => e.episode_id === id);
assert.ok(episode('ep-harborhours-088').published_at === '2026-11-24T05:00:00-08:00', 'Harbor Hours 88 is new on Nov. 24');
assert.ok(episode('ep-fieldnotes-114').published_at === '2026-11-21T05:00:00-08:00', 'Field Notes 114 is out by Nov. 21');

// ---------------------------------------------------------------- family
const PEOPLE = [['priya', 'Priya Raman'], ['sam', 'Sam Ellis'], ['noor', 'Noor Raman-Ellis'], ['kai', 'Kai Raman-Ellis'],
  ['ana', 'Ana Raman'], ['jules', 'Jules Okoro'], ['omar', 'Omar Haddad-Lee']];
const binding = {
  people: PEOPLE.map(([id, name]) => ({person_id: 'person-' + id, name})),
  accounts: ['priya', 'sam', 'noor', 'kai'].map(id => ({app_id: 'tidepool', account_id: 'tidepool-' + id, owner_person_id: 'person-' + id})),
  objects: {},
};
const ANCHOR = '2026-01-03T00:00:00-08:00';
const members = [
  ['priya', 'Priya', 'manager', 'adult', false], ['sam', 'Sam', 'member', 'adult', false],
  ['noor', 'Noor', 'member', 'teen', false], ['kai', 'Kai', 'member', 'child', true],
].map(([id, name, role, age, filter]) => ({member_id: 'mem-' + id, person_id: 'person-' + id, display_name: name, role, age_group: age,
  status: 'active', explicit_filter: filter, joined_at: ANCHOR, removed_at: null}));
const plans = [
  {plan_id: 'individual', name: 'Individual', max_members: 1, monthly_price_cents: 1099, rank: 1},
  {plan_id: 'duo', name: 'Duo', max_members: 2, monthly_price_cents: 1499, rank: 2},
  {plan_id: 'family', name: 'Family', max_members: 6, monthly_price_cents: 1799, rank: 3},
];
const monthlyPayments = (anchorDate, months, price, time) => Array.from({length: months}, (_, k) => {
  const d = new Date(anchorDate + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + k);
  const date = ymd(d);
  return {invoice_id: 'inv-' + date, outcome: 'paid', at: T(date, time), amount_cents: price};
});
const devices = [
  {device_id: 'dev-priya-phone', member_id: 'mem-priya', name: 'Priya\'s phone', kind: 'phone', storage_cap_bytes: 0, auto_download: true,
    last_checkin_at: '2026-10-31T20:00:00-07:00', registered_at: T('2026-01-03', '09:00')},
  {device_id: 'dev-priya-earbuds', member_id: 'mem-priya', name: 'Priya\'s earbuds', kind: 'earbuds', storage_cap_bytes: 0, auto_download: false,
    last_checkin_at: T('2026-11-23', '07:40'), registered_at: T('2026-03-15', '10:00')},
  {device_id: 'dev-kitchen-speaker', member_id: 'mem-priya', name: 'Kitchen speaker', kind: 'smart_speaker', storage_cap_bytes: 0, auto_download: false,
    last_checkin_at: T('2026-11-24', '07:00'), registered_at: T('2026-01-04', '17:00')},
  {device_id: 'dev-sam-phone', member_id: 'mem-sam', name: 'Sam\'s phone', kind: 'phone', storage_cap_bytes: 8000 * MB, auto_download: true,
    last_checkin_at: T('2026-11-23', '22:10'), registered_at: T('2026-01-03', '11:00')},
  {device_id: 'dev-family-car', member_id: 'mem-sam', name: 'Family car', kind: 'car', storage_cap_bytes: 2000 * MB, auto_download: false,
    last_checkin_at: T('2026-11-22', '16:30'), registered_at: T('2026-02-01', '12:00')},
  {device_id: 'dev-noor-phone', member_id: 'mem-noor', name: 'Noor\'s phone', kind: 'phone', storage_cap_bytes: 6000 * MB, auto_download: true,
    last_checkin_at: T('2026-11-20', '21:00'), registered_at: T('2026-01-05', '16:00')},
];

// ---------------------------------------------------------------- listening history (routines)
const sessions = [];
let sessionNo = 1000;
function listen(member, device, type, id, date, time, start, end, reason, speed = 1, endReason) {
  const item = type === 'episode' ? episode(id) : tracks.find(t => t.track_id === id);
  const started = T(date, time), listened = Math.ceil((end - start) / speed);
  sessions.push({session_id: 'ls-' + (++sessionNo), member_id: 'mem-' + member, device_id: 'dev-' + device, item_type: type, item_id: id,
    started_at: started, start_reason: reason, speed, start_position_s: start, end_position_s: end,
    end_reason: endReason || (type === 'episode' && end >= item.end_of_content_s ? 'completed' : end === item.duration_s ? 'completed' : 'paused'),
    ended_at: plusSeconds(started, listened + 40), speaker_hint: null});
}
const eps = slug => episodes.filter(e => e.show_id === 'show-' + slug);
const date = e => e.published_at.slice(0, 10);
// Priya: Harbor Hours on the morning commute, two days after release; every third one over two mornings.
eps('harborhours').filter(e => e.number < 88).forEach((e, i) => {
  const device = i % 2 ? 'priya-earbuds' : 'priya-phone';
  if (i % 3 === 0) {
    listen('priya', device, 'episode', e.episode_id, addDays(date(e), 1), '07:42', 0, 1500, 'user', 1, 'paused');
    listen('priya', device, 'episode', e.episode_id, addDays(date(e), 2), '07:41', 1500, e.end_of_content_s + 20, 'queue');
  } else listen('priya', device, 'episode', e.episode_id, addDays(date(e), 1), '07:40', 0, e.end_of_content_s + 20, 'user', i % 4 === 1 ? 1.2 : 1);
});
// Priya: Field Notes on earbuds; she stopped episode 112 at 31:10 on Sunday morning.
eps('fieldnotes').filter(e => e.number < 112).forEach((e, i) => listen('priya', 'priya-earbuds', 'episode', e.episode_id, addDays(date(e), 2), '08:05', 0, e.duration_s, i % 3 ? 'queue' : 'user'));
listen('priya', 'priya-earbuds', 'episode', 'ep-fieldnotes-112', '2026-11-22', '08:10', 0, 1870, 'queue', 1, 'paused');
// Priya's account on the kitchen speaker: Kettle Theory by voice on Thursday evenings.
eps('kettletheory').filter(e => e.number < 53).forEach(e => listen('priya', 'kitchen-speaker', 'episode', e.episode_id, date(e), '18:30', 0, e.duration_s, 'voice'));
// Priya: Overtime Almanac and Static & Signal on her phone until she unfollowed both in October.
eps('overtimealmanac').filter(e => e.number <= 114).forEach(e => listen('priya', 'priya-phone', 'episode', e.episode_id, addDays(date(e), 3), '12:15', 0, e.duration_s, 'user'));
eps('staticsignal').filter(e => e.number <= 62).forEach(e => listen('priya', 'priya-phone', 'episode', e.episode_id, addDays(date(e), 4), '21:10', 0, e.duration_s, 'queue'));
eps('lanternledger').filter(e => e.number <= 8).forEach(e => listen('priya', 'priya-phone', 'episode', e.episode_id, addDays(date(e), 5), '20:30', 0, e.duration_s, 'user'));
// Kitchen speaker music on Saturday mornings under Priya's account (autoplay after a voice request).
const kitchenTracks = ['tr-marrow-01', 'tr-marrow-03', 'tr-juno-04', 'tr-kestrel-02', 'tr-tamsin-02', 'tr-lowtide-01', 'tr-mbali-03', 'tr-marrow-09'];
for (let w = 0; w < 15; w++) {
  const d = addDays('2026-01-10', w * 21), id = kitchenTracks[w % kitchenTracks.length], t = tracks.find(x => x.track_id === id);
  listen('priya', 'kitchen-speaker', 'track', id, d, '09:15', 0, t.duration_s, w % 2 ? 'autoplay' : 'voice');
}
// Sam: music in the car, Overtime Almanac and Field Notes on his phone.
const carTracks = ['tr-kestrel-01', 'tr-kestrel-03', 'tr-kestrel-05', 'tr-copperleaf-02', 'tr-copperleaf-08c', 'tr-saltline-05', 'tr-tamsin-04', 'tr-mbali-01', 'tr-halcyon-02', 'tr-kestrel-07'];
for (let i = 0; i < 30; i++) {
  const id = carTracks[i % carTracks.length], t = tracks.find(x => x.track_id === id);
  listen('sam', 'family-car', 'track', id, addDays('2026-01-12', i * 10), '17:35', 0, i % 5 === 4 ? Math.floor(t.duration_s / 2) : t.duration_s, i % 3 ? 'autoplay' : 'user', 1, i % 5 === 4 ? 'skipped' : undefined);
}
eps('overtimealmanac').filter(e => e.number % 2 === 0).forEach(e => listen('sam', 'sam-phone', 'episode', e.episode_id, addDays(date(e), 1), '06:50', 0, e.duration_s, 'user', 1.5));
['ep-fieldnotes-110', 'ep-fieldnotes-111', 'ep-fieldnotes-112'].forEach((id, i) => listen('sam', 'sam-phone', 'episode', id, addDays(date(episode(id)), 3), '22:00', 0, episode(id).duration_s, 'user', 1.2));
listen('sam', 'sam-phone', 'episode', 'ep-fieldnotes-113', '2026-11-23', '21:40', 0, 600, 'user', 1.2, 'paused');
// Noor: music on her phone (explicit allowed for her account) and Loud Library.
const noorTracks = ['tr-gutterglow-01', 'tr-gutterglow-03', 'tr-saltline-07', 'tr-gutterglow-10', 'tr-saltline-02', 'tr-tamsin-01', 'tr-gutterglow-06',
  'tr-copperleaf-04', 'tr-saltline-14', 'tr-gutterglow-12'];
for (let i = 0; i < 25; i++) {
  const id = noorTracks[i % noorTracks.length], t = tracks.find(x => x.track_id === id);
  listen('noor', 'noor-phone', 'track', id, addDays('2026-01-07', i * 13), '16:20', 0, t.duration_s, i % 2 ? 'autoplay' : 'user');
}
eps('loudlibrary').filter(e => e.number <= 30).forEach(e => listen('noor', 'noor-phone', 'episode', e.episode_id, addDays(date(e), 1), '19:00', 0, e.duration_s, 'user', 1.25));
sessions.sort((x, y) => Date.parse(x.started_at) - Date.parse(y.started_at));
assert.ok(sessions.every(s => before(s.ended_at, CLOCK)), 'All sessions end before the fixture clock');

// Progress and play counts follow from the sessions (latest session wins).
function deriveProgress(list) {
  const progress = new Map(), plays = new Map();
  for (const s of list) {
    if (s.item_type === 'track') {
      const key = s.member_id + '/' + s.item_id, p = plays.get(key) || {member_id: s.member_id, track_id: s.item_id, count: 0};
      p.count++; p.last_played_at = s.ended_at; plays.set(key, p);
      continue;
    }
    const e = episodes.find(x => x.episode_id === s.item_id) || list.extraEpisodes?.get(s.item_id), played = s.end_position_s >= e.end_of_content_s;
    progress.set(s.member_id + '/' + s.item_id, {member_id: s.member_id, episode_id: s.item_id, state: played ? 'played' : 'in_progress',
      position_s: played ? 0 : s.end_position_s, updated_at: s.ended_at, played_at: played ? s.ended_at : null, set_by: 'session', replaced: null});
  }
  return {progress: [...progress.values()], plays: [...plays.values()]};
}
const {progress, plays} = deriveProgress(sessions);

// ---------------------------------------------------------------- follows, Up Next, library
const follows = [
  ['priya', 'fieldnotes', '2026-07-18', 2, 2], ['priya', 'harborhours', '2026-01-03', 0, null], ['priya', 'kettletheory', '2026-01-03', 0, null],
  ['priya', 'lanternledger', '2026-01-03', 0, 7],
  ['sam', 'fieldnotes', '2026-08-01', 1, 3], ['sam', 'overtimealmanac', '2026-01-03', 1, null], ['sam', 'harborhours', '2026-03-01', 1, 2],
  ['noor', 'loudlibrary', '2026-01-05', 2, 5], ['kai', 'bedtimebramble', '2026-06-07', 0, null],
].map(([m, s, d, n, del]) => ({member_id: 'mem-' + m, show_id: 'show-' + s, followed_at: T(d, '09:00'), auto_download_count: n, auto_delete_days: del}));
const upnext = [
  {member_id: 'mem-priya', list_version: 1, updated_at: T('2026-11-20', '21:00'),
    episode_ids: ['ep-lanternledger-009', 'ep-lanternledger-010', 'ep-lanternledger-011', 'ep-kettletheory-052', 'ep-kettletheory-053']},
  {member_id: 'mem-sam', list_version: 3, updated_at: T('2026-11-23', '21:39'), episode_ids: ['ep-fieldnotes-113', 'ep-harborhours-088']},
];
const saved = (member, type, ids, day) => ids.map((id, i) => ({member_id: 'mem-' + member, item_type: type, item_id: id, saved_at: T(addDays(day, i * 9), '20:00')}));
const library = [
  ...saved('priya', 'album', ['alb-marrow-2', 'alb-lowtide-1'], '2026-02-11'),
  ...saved('priya', 'track', ['tr-marrow-01', 'tr-juno-04', 'tr-mbali-03', 'tr-halcyon-01', 'tr-kestrel-02', 'tr-tamsin-02', 'tr-lowtide-03', 'tr-juno-09'], '2026-01-20'),
  ...saved('sam', 'album', ['alb-kestrel-1', 'alb-copperleaf-2', 'alb-mbali-1'], '2026-02-02'),
  ...saved('sam', 'track', ['tr-kestrel-01', 'tr-copperleaf-08c', 'tr-saltline-05', 'tr-halcyon-02', 'tr-tamsin-04'], '2026-03-03'),
  ...saved('noor', 'track', noorTracks, '2026-01-15'),
  ...saved('noor', 'album', ['alb-gutterglow-2'], '2026-10-05'),
  ...saved('kai', 'track', ['tr-tamsin-01', 'tr-tamsin-03', 'tr-kestrel-05', 'tr-gutterglow-04c', 'tr-marrow-02'], '2026-06-20'),
];

// ---------------------------------------------------------------- downloads (derived from follows and listening)
const downloads = [];
let downloadNo = 100;
function download(member, device, type, id, at, source, extra = {}) {
  const bytes = type === 'album' ? albums.find(x => x.album_id === id).track_ids.reduce((s, t) => s + tracks.find(x => x.track_id === t).bytes, 0)
    : (type === 'episode' ? episode(id) : tracks.find(x => x.track_id === id)).bytes;
  const d = {download_id: 'dl-' + (++downloadNo), member_id: 'mem-' + member, device_id: 'dev-' + device, item_type: type, item_id: id, bytes, source,
    requested_at: at, completes_at: plusSeconds(at, 60), auto_delete_at: null, removed_at: null, removed_reason: null, ...extra};
  downloads.push(d);
  return d;
}
const published = id => plusSeconds(episode(id).published_at, 120);
// Priya's phone: played episodes of the two shows she unfollowed in October (no auto-delete applies).
for (const n of [107, 108, 109, 110, 111, 112, 113, 114]) download('priya', 'priya-phone', 'episode', 'ep-overtimealmanac-' + n, published('ep-overtimealmanac-' + n), 'auto');
for (const n of [56, 57, 58, 59, 60, 61, 62]) download('priya', 'priya-phone', 'episode', 'ep-staticsignal-0' + n, published('ep-staticsignal-0' + n), 'auto');
// Her phone last checked in on Oct. 31 at 20:00 and has requested nothing since, so no Field Notes
// episode after 111 is on it. Field Notes 110 arrived Oct. 24 and 111 on Oct. 31 (before the check-in);
// both were played and auto-deleted two days later (removed_at records it).
download('priya', 'priya-phone', 'episode', 'ep-fieldnotes-110', published('ep-fieldnotes-110'), 'auto');
download('priya', 'priya-phone', 'episode', 'ep-fieldnotes-111', published('ep-fieldnotes-111'), 'auto',
  {auto_delete_at: plusSeconds(progress.find(p => p.member_id === 'mem-priya' && p.episode_id === 'ep-fieldnotes-111').played_at, 2 * 86400)});
for (const id of ['tr-marrow-01', 'tr-juno-04', 'tr-mbali-03']) download('priya', 'priya-phone', 'track', id, T('2026-03-02', '20:10'), 'manual');
const PHONE_FILLER = ['tr-halcyon-01', 'tr-kestrel-02', 'tr-tamsin-02', 'tr-lowtide-03', 'tr-juno-09', 'tr-marrow-03', 'tr-mbali-01', 'tr-lowtide-01',
  'tr-halcyon-02', 'tr-kestrel-04', 'tr-juno-05', 'tr-tamsin-06'];
// Sam: newest Field Notes, Harbor Hours and Overtime Almanac; two albums for the car.
download('sam', 'sam-phone', 'episode', 'ep-fieldnotes-114', published('ep-fieldnotes-114'), 'auto');
download('sam', 'sam-phone', 'episode', 'ep-harborhours-088', published('ep-harborhours-088'), 'auto');
download('sam', 'sam-phone', 'episode', 'ep-overtimealmanac-121', published('ep-overtimealmanac-121'), 'auto');
download('sam', 'family-car', 'album', 'alb-kestrel-1', T('2026-02-01', '12:30'), 'manual');
download('sam', 'family-car', 'album', 'alb-copperleaf-2', T('2026-02-02', '12:30'), 'manual');
// Noor: the two newest Loud Library episodes and her saved album.
download('noor', 'noor-phone', 'episode', 'ep-loudlibrary-031', published('ep-loudlibrary-031'), 'auto');
download('noor', 'noor-phone', 'episode', 'ep-loudlibrary-032', published('ep-loudlibrary-032'), 'auto');
download('noor', 'noor-phone', 'album', 'alb-gutterglow-2', T('2026-10-05', '20:05'), 'manual');
// Played episodes under a follow with auto-delete get their due time from the play.
for (const d of downloads) {
  if (d.item_type !== 'episode' || d.removed_at || d.auto_delete_at) continue;
  const p = progress.find(x => x.member_id === d.member_id && x.episode_id === d.item_id);
  const f = follows.find(x => x.member_id === d.member_id && x.show_id === episode(d.item_id).show_id);
  if (p?.state === 'played' && f?.auto_delete_days) {
    // d days after it was played or downloaded, whichever is later (as src/account.cjs schedules it).
    d.auto_delete_at = plusSeconds(before(p.played_at, d.requested_at) ? d.requested_at : p.played_at, f.auto_delete_days * 86400);
  }
}
// Deletions due before the fixture clock are recorded, as a write or event at that time would have.
for (const d of downloads) if (d.auto_delete_at && before(d.auto_delete_at, CLOCK)) {d.removed_at = d.auto_delete_at; d.removed_reason = 'auto_delete';}
// Priya's phone: a 1 GB Tidepool storage cap. Saved tracks she downloaded in October bring her free
// space to about 300 MB: Up Next plus the first saved album fit, the second album does not.
const phone = devices.find(d => d.device_id === 'dev-priya-phone');
phone.storage_cap_bytes = 1000 * MB;
const phoneUsed = () => downloads.filter(d => d.device_id === 'dev-priya-phone' && !d.removed_at).reduce((s, d) => s + d.bytes, 0);
const albumBytes = id => albums.find(x => x.album_id === id).track_ids.reduce((s, t) => s + tracks.find(x => x.track_id === t).bytes, 0);
const queueBytes = ['ep-lanternledger-009', 'ep-lanternledger-010', 'ep-lanternledger-011', 'ep-kettletheory-052', 'ep-kettletheory-053']
  .reduce((s, id) => s + episode(id).bytes, 0);
const fits = queueBytes + albumBytes('alb-lowtide-1'), tooMuch = fits + albumBytes('alb-marrow-2');
for (const [i, id] of PHONE_FILLER.entries()) {
  const free = phone.storage_cap_bytes - phoneUsed(), bytes = tracks.find(t => t.track_id === id).bytes;
  if (free <= 302 * MB) break;
  if (free - bytes < fits) continue;
  download('priya', 'priya-phone', 'track', id, T(addDays('2026-10-03', i * 2), '21:00'), 'manual');
}
const phoneFree = phone.storage_cap_bytes - phoneUsed();
assert.ok(phoneFree >= fits && phoneFree < tooMuch && Math.abs(phoneFree - 300 * MB) < 20 * MB, 'Priya\'s phone has about 300 MB free: ' + phoneFree);
assert.ok(downloads.filter(d => d.device_id === 'dev-priya-phone').every(d => before(d.requested_at, '2026-10-31T20:00:00-07:00')), 'Nothing reaches Priya\'s phone after its check-in');

// ---------------------------------------------------------------- playlists
const entries = (ids, by, at) => ids.map((id, i) => ({track_id: id, added_by: 'mem-' + by, added_at: plusSeconds(at, i * 30)}));
const playlists = [
  {playlist_id: 'pl-family-car', owner_member_id: 'mem-priya', name: 'Family car songs', description: 'Songs everyone in the car can agree on.',
    visibility: 'collaborative', collaborators: ['mem-sam', 'mem-noor', 'mem-kai'],
    tracks: [...entries(['tr-kestrel-01', 'tr-marrow-02', 'tr-tamsin-01'], 'priya', T('2026-04-04', '10:00')),
      ...entries(['tr-halcyon-03', 'tr-kestrel-05'], 'sam', T('2026-04-05', '18:00')), ...entries(['tr-juno-02'], 'kai', T('2026-06-21', '17:00'))],
    track_version: 4, created_at: T('2026-04-04', '10:00'), updated_at: T('2026-06-21', '17:00'), origin: 'seed'},
  {playlist_id: 'pl-road-trip-ideas', owner_member_id: 'mem-sam', name: 'Road trip ideas', description: 'Sam\'s picks for the Thanksgiving drive.',
    visibility: 'shared', collaborators: [],
    tracks: entries(['tr-kestrel-02', 'tr-tamsin-03', 'tr-saltline-05', 'tr-copperleaf-08', 'tr-gutterglow-10', 'tr-marrow-04'], 'sam', T('2026-11-21', '21:15')),
    track_version: 2, created_at: T('2026-11-21', '21:10'), updated_at: T('2026-11-21', '21:18'), origin: 'seed'},
  {playlist_id: 'pl-priya-focus', owner_member_id: 'mem-priya', name: 'Focus', description: '', visibility: 'private', collaborators: [],
    tracks: entries(['tr-lowtide-01', 'tr-lowtide-02', 'tr-lowtide-03', 'tr-halcyon-01', 'tr-halcyon-04'], 'priya', T('2026-02-14', '09:00')),
    track_version: 1, created_at: T('2026-02-14', '09:00'), updated_at: T('2026-02-14', '09:00'), origin: 'seed'},
  {playlist_id: 'pl-noor-after-school', owner_member_id: 'mem-noor', name: 'After school', description: 'no skips', visibility: 'shared', collaborators: [],
    tracks: entries(['tr-gutterglow-01', 'tr-saltline-07', 'tr-gutterglow-06', 'tr-tamsin-02', 'tr-saltline-14'], 'noor', T('2026-09-08', '16:30')),
    track_version: 3, created_at: T('2026-09-08', '16:30'), updated_at: T('2026-10-02', '16:45'), origin: 'seed'},
  {playlist_id: 'pl-kai-favourites', owner_member_id: 'mem-kai', name: 'Kai\'s favourites', description: '', visibility: 'private', collaborators: [],
    tracks: entries(['tr-tamsin-01', 'tr-tamsin-03', 'tr-gutterglow-04c', 'tr-kestrel-05'], 'kai', T('2026-06-20', '18:00')),
    track_version: 1, created_at: T('2026-06-20', '18:00'), updated_at: T('2026-06-20', '18:00'), origin: 'seed'},
];

// ---------------------------------------------------------------- notices (recent publishes)
const notifications = [];
for (const e of episodes.filter(x => !before(x.published_at, '2026-11-01T00:00:00-07:00'))) {
  for (const f of follows.filter(x => x.show_id === e.show_id)) {
    const show = shows.find(s => s.show_id === e.show_id);
    const auto = downloads.find(d => d.member_id === f.member_id && d.item_id === e.episode_id && d.source === 'auto');
    const device = auto ? devices.find(d => d.device_id === auto.device_id).name : null;
    notifications.push({notice_id: 'notice-h' + (notifications.length + 1), member_id: f.member_id, created_at: e.published_at, kind: 'episode_published',
      text: 'New episode of ' + show.title + ': ' + e.title + '.' + (device ? ' Downloading to ' + device + '.' : ''), object_type: 'episode',
      object_id: e.episode_id, event_id: 'history-publish-' + e.episode_id});
  }
}

const catalog = {artists, albums, tracks, shows, episodes, plans};
const minimal = {
  account_id: 'tidepool-priya', owner_person_id: 'person-priya',
  family: {family_id: 'fam-raman-ellis', name: 'Raman-Ellis family', created_at: ANCHOR},
  members, invitations: [], plans,
  billing: {currency: 'USD', anchor: ANCHOR, timeline: [{plan_id: 'family', from: ANCHOR, set_at: ANCHOR, change: 'start'}], adjustments: [],
    payments: monthlyPayments('2026-01-03', 11, 1799, '02:10')},
  artists, albums, tracks, shows, episodes, devices, sessions, progress, plays, follows, upnext, downloads, library, playlists, notifications,
  activity: [], next_seq: 1,
};

// ---------------------------------------------------------------- events
const kitchen113 = {
  event_id: 'kitchen-fieldnotes-113', at: '2026-11-24T19:42:00-08:00', operation: 'listening.record',
  payload: {session_id: 'ls-2207', member_id: 'mem-priya', device_id: 'dev-kitchen-speaker', item_type: 'episode', item_id: 'ep-fieldnotes-113',
    started_at: '2026-11-24T19:05:00-08:00', start_reason: 'voice', speed: 1.0, start_position_s: 0, end_position_s: 2210, end_reason: 'completed'},
};
const events = {
  'kitchen-fieldnotes-114': {event_id: 'kitchen-fieldnotes-114', at: '2026-11-24T20:25:00-08:00', operation: 'listening.record',
    payload: {session_id: 'ls-2208', member_id: 'mem-priya', device_id: 'dev-kitchen-speaker', item_type: 'episode', item_id: 'ep-fieldnotes-114',
      started_at: '2026-11-24T19:43:00-08:00', start_reason: 'autoplay', speed: 1.0, start_position_s: 0, end_position_s: 2340, end_reason: 'completed',
      speaker_hint: 'Sam'}},
  'train-fieldnotes-112-end': {event_id: 'train-fieldnotes-112-end', at: '2026-11-25T08:00:00-08:00', operation: 'listening.record',
    payload: {session_id: 'ls-2209', member_id: 'mem-priya', device_id: 'dev-priya-phone', item_type: 'episode', item_id: 'ep-fieldnotes-112',
      started_at: '2026-11-25T07:45:00-08:00', start_reason: 'queue', speed: 1.0, start_position_s: 1870, end_position_s: 2500, end_reason: 'completed'}},
  'family-car-noor-add': {event_id: 'family-car-noor-add', at: '2026-11-24T19:50:00-08:00', operation: 'playlist.edit',
    payload: {playlist_id: 'pl-family-car', author_member_id: 'mem-noor', operations: [{op: 'add', track_id: 'tr-gutterglow-04', position: 3}]}},
  'roadtrip-noor-add-1': {event_id: 'roadtrip-noor-add-1', at: '2026-11-26T18:20:00-08:00', operation: 'playlist.edit',
    payload: {playlist_ref: {owner_member_id: 'mem-priya', name: 'Road trip'}, author_member_id: 'mem-noor',
      operations: [{op: 'add', track_id: 'tr-saltline-07', position: 4}]}},
  'invite-ana-decline': {event_id: 'invite-ana-decline', at: '2026-11-26T20:00:00-08:00', operation: 'family.invite_response',
    payload: {invitee_person_id: 'person-ana', response: 'declined'}},
  'invite-ana-accept': {event_id: 'invite-ana-accept', at: '2026-11-27T09:05:00-08:00', operation: 'family.invite_response',
    payload: {invitee_person_id: 'person-ana', response: 'accepted'}},
  'fieldnotes-115-publish': {event_id: 'fieldnotes-115-publish', at: '2026-11-28T05:00:00-08:00', operation: 'episode.publish',
    payload: {episode_id: 'ep-fieldnotes-115', show_id: 'show-fieldnotes', number: 115, title: 'Otters returning to the harbor', published_at: '2026-11-28T05:00:00-08:00',
      duration_s: 2340, end_of_content_s: 2270, chapters: [{title: 'Opening', start_s: 0}, {title: 'Otters returning to the harbor', start_s: 120},
        {title: 'Listener notes', start_s: 1870}], notes: 'Short walks with a sound recordist and a guest naturalist, one habitat at a time. This episode: otters returning to the harbor.',
      bytes: 2340 * 16000, explicit: false}},
  'catalog-remove-staticsignal-071': {event_id: 'catalog-remove-staticsignal-071', at: '2026-11-25T12:00:00-08:00', operation: 'catalog.update',
    payload: {item_type: 'episode', item_id: 'ep-staticsignal-071', availability: 'removed'}},
  'priya-phone-checkin': {event_id: 'priya-phone-checkin', at: '2026-11-25T07:30:00-08:00', operation: 'device.checkin',
    payload: {device_id: 'dev-priya-phone'}},
  'invoice-dec-declined': {event_id: 'invoice-dec-declined', at: '2026-12-03T09:00:00-08:00', operation: 'billing.payment_result',
    payload: {invoice_id: 'inv-2026-12-03', outcome: 'declined'}},
};

// ---------------------------------------------------------------- second family: one member, payment due
const SOLO_ANCHOR = '2026-01-15T00:00:00-05:00';
const soloBinding = {people: [{person_id: 'person-leila', name: 'Leila Haddad'}, {person_id: 'person-rafael', name: 'Rafael Haddad'}],
  accounts: [{app_id: 'tidepool', account_id: 'tidepool-leila', owner_person_id: 'person-leila'}], objects: {}};
const E = (d, time) => d + 'T' + time + ':00' + (d >= '2026-03-08' && d <= '2026-10-31' ? '-04:00' : '-05:00');
const soloSessions = [];
let soloNo = 5000;
eps('kettletheory').filter((e, i) => i % 2 === 0).forEach(e => {
  const started = E(addDays(date(e), 1), '12:30');
  soloSessions.push({session_id: 'ls-' + (++soloNo), member_id: 'mem-leila', device_id: 'dev-leila-phone', item_type: 'episode', item_id: e.episode_id,
    started_at: started, start_reason: 'user', speed: 1.5, start_position_s: 0, end_position_s: e.duration_s, end_reason: 'completed',
    ended_at: plusSeconds(started, Math.ceil(e.duration_s / 1.5) + 40), speaker_hint: null});
});
const soloDerived = deriveProgress(soloSessions);
const soloDownloads = [];
for (const id of ['ep-harborhours-086', 'ep-harborhours-087', 'ep-harborhours-088']) {
  soloDownloads.push({download_id: 'dl-leila-' + id.slice(-3), member_id: 'mem-leila', device_id: 'dev-leila-phone', item_type: 'episode', item_id: id,
    bytes: episode(id).bytes, source: 'auto', requested_at: published(id), completes_at: plusSeconds(published(id), 60), auto_delete_at: null,
    removed_at: null, removed_reason: null});
}
soloDownloads.push({download_id: 'dl-leila-album', member_id: 'mem-leila', device_id: 'dev-leila-phone', item_type: 'album', item_id: 'alb-juno-2',
  bytes: albums.find(a => a.album_id === 'alb-juno-2').track_ids.reduce((s, t) => s + tracks.find(x => x.track_id === t).bytes, 0), source: 'manual',
  requested_at: E('2026-09-02', '19:00'), completes_at: plusSeconds(E('2026-09-02', '19:00'), 60), auto_delete_at: null, removed_at: null, removed_reason: null});
const solo = {
  account_id: 'tidepool-leila', owner_person_id: 'person-leila',
  family: {family_id: 'fam-haddad', name: 'Leila\'s account', created_at: SOLO_ANCHOR},
  members: [{member_id: 'mem-leila', person_id: 'person-leila', display_name: 'Leila', role: 'manager', age_group: 'adult', status: 'active',
    explicit_filter: false, joined_at: SOLO_ANCHOR, removed_at: null}],
  invitations: [], plans,
  billing: {currency: 'USD', anchor: SOLO_ANCHOR, timeline: [{plan_id: 'individual', from: SOLO_ANCHOR, set_at: SOLO_ANCHOR, change: 'start'}], adjustments: [],
    payments: [...monthlyPayments('2026-01-15', 10, 1099, '03:00').map(p => ({...p, at: E(p.invoice_id.slice(4), '03:00')})),
      {invoice_id: 'inv-2026-11-15', outcome: 'declined', at: '2026-11-20T09:00:00-05:00', amount_cents: 1099}]},
  artists, albums, tracks, shows, episodes,
  devices: [{device_id: 'dev-leila-phone', member_id: 'mem-leila', name: 'Leila\'s phone', kind: 'phone', storage_cap_bytes: 4000 * MB, auto_download: true,
    last_checkin_at: '2026-11-22T08:00:00-05:00', registered_at: E('2026-01-15', '09:00')}],
  sessions: soloSessions, progress: soloDerived.progress, plays: soloDerived.plays,
  follows: [{member_id: 'mem-leila', show_id: 'show-harborhours', followed_at: E('2026-01-15', '09:10'), auto_download_count: 3, auto_delete_days: null},
    {member_id: 'mem-leila', show_id: 'show-kettletheory', followed_at: E('2026-01-15', '09:12'), auto_download_count: 0, auto_delete_days: null}],
  upnext: [{member_id: 'mem-leila', list_version: 1, updated_at: E('2026-11-20', '20:00'), episode_ids: ['ep-harborhours-087', 'ep-harborhours-088']}],
  downloads: soloDownloads,
  library: [{member_id: 'mem-leila', item_type: 'album', item_id: 'alb-juno-2', saved_at: E('2026-09-02', '18:55')}],
  playlists: [], notifications: [{notice_id: 'notice-h1', member_id: 'mem-leila', created_at: '2026-11-20T09:00:00-05:00', kind: 'payment_declined',
    text: 'Payment of $10.99 for the period starting 2026-11-15 was declined. Pay by 2026-11-27T09:00:00-05:00 to keep downloads available offline.',
    object_type: 'invoice', object_id: 'inv-2026-11-15', event_id: 'history-charge-inv-2026-11-15'}],
  activity: [], next_seq: 1,
};
const soloPaid = {event_id: 'leila-november-paid', at: '2026-11-28T10:00:00-05:00', operation: 'billing.payment_result',
  payload: {invoice_id: 'inv-2026-11-15', outcome: 'paid'}};

// ---------------------------------------------------------------- policies
const tools = require(path.join(out, 'tools.json')).map(t => t.name);
const reads = require(path.join(out, 'tools.json')).filter(t => t.read_only).map(t => t.name);
const policies = {scenario: {allow: reads, constraints: {}}, sandbox: {allow: tools, constraints: {}}};
const writePolicies = {scenario: {allow: tools, constraints: {}}, sandbox: {allow: tools, constraints: {}}};
// Per-member narrowing through Core: the manager tools that take a member as id. filters.update is
// limited to Kai's explicit filter; members.remove and plan.confirm_change may be called for no one.
const narrowPolicies = {scenario: {allow: tools, constraints: {'tidepool.filters.update': {ids: ['mem-kai'], fields: ['explicit_filter']},
  'tidepool.members.remove': {ids: []}, 'tidepool.plan.confirm_change': {ids: []}}}, sandbox: {allow: tools, constraints: {}}};

write('fixtures/minimal.json', minimal);
write('fixtures/binding.json', binding);
write('fixtures/policies.json', policies);
write('fixtures/clock.json', {initial_time: CLOCK});
// The approved example writes speed as 1.0; keep that spelling (the parsed value is the same).
write('examples/scenario.json', kitchen113);
fs.writeFileSync(path.join(out, 'examples/scenario.json'), fs.readFileSync(path.join(out, 'examples/scenario.json'), 'utf8').replace('"speed": 1,', '"speed": 1.0,'));
for (const [id, e] of Object.entries(events)) write('examples/events/' + id + '.json', e);
write('examples/policies/narrow-members.json', narrowPolicies);
write('examples/task-data/seed.json', solo);
write('examples/task-data/binding.json', soloBinding);
write('examples/task-data/policies.json', writePolicies);
write('examples/task-data/events/leila-november-paid.json', soloPaid);
const plugin = require(path.join(out, 'plugin.cjs'));
const dataset = JSON.parse(fs.readFileSync(path.join(out, 'contribution/dataset.json'), 'utf8'));
dataset.expected_counts.records = plugin.records(minimal).length;
write('contribution/dataset.json', dataset);
write('examples/task-data/dataset.json', {...dataset, dataset_id: 'tidepool-family-listening-leila',
  description: 'Hand-authored synthetic music and podcast catalog (the package catalog) and a one-member account, Leila Haddad, with listening history, downloads and billing from Jan. 15 to Nov. 24, 2026, and a declined November payment. Not a benchmark task.',
  expected_counts: {...dataset.expected_counts, records: plugin.records(solo).length}});
const fixtureBytes = ['fixtures/minimal.json', 'examples/task-data/seed.json'].map(f => fs.statSync(path.join(out, f)).size);
console.log({tracks: tracks.length, albums: albums.length, artists: artists.length, shows: shows.length, episodes: episodes.length,
  sessions: sessions.length, solo_sessions: soloSessions.length, downloads: downloads.length, records: plugin.records(minimal).length,
  priya_phone_cap_mb: phone.storage_cap_bytes / MB, fixture_bytes: fixtureBytes});
