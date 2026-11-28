'use strict';
// Maintainer script (not run by tests or the verifier). Builds the Tidepool evaluation dataset in
// data/evaluation/: the Raman-Ellis family seed covering 2025-01-01 through 2026-12-31. It keeps every
// fixture record verbatim except three that the 2025 story extends (see STORY_CHANGES) and adds two
// years of coverage around them: Priya's own year on the Individual plan before the family upgrade,
// the shows' back catalogues on their fixture schedules, and episodes published after the dataset
// clock. Deterministic: the same script writes the same bytes.
// Usage, from the package directory: node dev/build-dataset.cjs
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const pkg = path.resolve(__dirname, '..');
const outDir = path.join(pkg, 'data/evaluation');
const read = file => JSON.parse(fs.readFileSync(path.join(pkg, file), 'utf8'));
const fixture = read('fixtures/minimal.json');
const plugin = require(path.join(pkg, 'plugin.cjs'));
const {compile} = require(path.join(pkg, 'tests/schema-validator.cjs'));

const DATASET_VERSION = '1.0.0';
const SEED = 20250103;
const CLOCK = read('fixtures/clock.json').initial_time; // the fixture clock: family history ends here, the catalogue runs on
const ACCOUNT_START = '2025-01-03T00:00:00-08:00'; // Priya opens her account on the Individual plan
const FAMILY_START = fixture.billing.anchor; // 2026-01-03: the Family plan starts and the others join
const WINDOW = ['2025-01-01', '2026-12-31'];

// ---------- deterministic helpers ----------
let state = SEED;
const rng = () => {state |= 0; state = state + 0x6D2B79F5 | 0; let t = Math.imul(state ^ state >>> 15, 1 | state);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296;};
const int = (a, b) => a + Math.floor(rng() * (b - a + 1));
const pick = list => list[Math.floor(rng() * list.length)];
const chance = p => rng() < p;
const pad = n => String(n).padStart(2, '0');

// Calendar in America/Los_Angeles. DST: second Sunday of March to first Sunday of November.
const DAY = 86400000;
const ymd = ms => new Date(ms).toISOString().slice(0, 10);
const dateMs = d => Date.parse(d + 'T00:00:00Z');
const weekday = d => new Date(dateMs(d)).getUTCDay();
const addDays = (d, n) => ymd(dateMs(d) + n * DAY);
const nthSunday = (y, m, n) => {let d = 1; while (new Date(Date.UTC(y, m - 1, d)).getUTCDay() !== 0) d++; return d + 7 * (n - 1);};
function laOffset(d) {
  const [y, m, day] = d.split('-').map(Number), md = m * 100 + day;
  return md >= 300 + nthSunday(y, 3, 2) && md < 1100 + nthSunday(y, 11, 1) ? '-07:00' : '-08:00';
}
const la = (d, hm) => `${d}T${hm.length === 5 ? hm + ':00' : hm}${laOffset(d)}`;
// Seconds later in the same UTC offset as the start, as dev/build-fixtures.cjs writes session ends.
function plusSeconds(ts, s) {
  const ms = Date.parse(ts) + s * 1000, off = ts.slice(-6), sign = off[0] === '-' ? -1 : 1;
  return new Date(ms + sign * (Number(off.slice(1, 3)) * 60 + Number(off.slice(4))) * 60000).toISOString().slice(0, 19) + off;
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const longDate = d => {const [y, m, day] = d.split('-').map(Number); return `${WEEKDAYS[weekday(d)]}, ${MONTHS[m - 1]} ${day}, ${y}`;};
const cap = s => s[0].toUpperCase() + s.slice(1);
const before = (a, b) => Date.parse(a) < Date.parse(b);

// ---------- catalogue: episodes on the fixture schedules ----------
// Each show keeps the cadence, weekday and 05:00 release of its fixture episodes. Numbers count back
// from the first fixture episode; nothing before 2025-01-01 is added (the fixture also starts mid-run).
const SHOW = Object.fromEntries(fixture.shows.map(s => [s.show_id.slice(5), s]));
const DURATION = {fieldnotes: [2160, 420], harborhours: [2880, 600], kettletheory: [1920, 360], overtimealmanac: [2520, 480],
  staticsignal: [2280, 420], lanternledger: [3720, 300], bedtimebramble: [840, 240], loudlibrary: [2700, 600]};
// Subjects in release order. Field Notes walks follow the seasons; the others follow the calendar.
const SUBJECTS = {
  fieldnotes: [
    // 2025
    'wigeon whistling on the flooded meadow', 'a frozen canal and the ducks that wait it out', 'redwings stripping the hawthorn hedge',
    'a winter roost of pied wagtails in the station car park', 'snowdrops in the churchyard and the first bumblebee queen',
    'great crested grebes beginning to pair on the reservoir', 'tracks in fresh snow at the edge of the wood', 'a heron colony rebuilding its nests',
    'frogspawn in the allotment pond', 'toads crossing the lane after dark', 'blackthorn blossom and early hoverflies',
    'a sand martin colony returning to the quarry face', 'skylarks above the lambing fields', 'bluebells under the beech hanger',
    'the first chiffchaff in the willow carr', 'newts in a garden pond after midnight', 'counting heron chicks from the far bank',
    'cuckoos calling across the heath', 'mayflies hatching on the chalk stream', 'a peregrine pair on the cathedral spire',
    'swifts screaming over the terraced streets', 'orchids on a railway embankment', 'nightjars churring on the common at dusk',
    'a grey seal pup count from the dunes', 'glow-worms along a disused railway path', 'dragonflies patrolling the gravel pit',
    'butterflies on a brownfield site', 'a beach clean and the crabs it uncovered', 'grasshoppers in an uncut roadside verge',
    'swallows feeding fledglings in the barn', 'shearwaters off the headland at first light', 'moths at the lamp on a meteor night',
    'heather in bloom and the bees that work it', 'wading birds returning to the estuary', 'blackberry season along the towpath',
    'spider webs in the morning dew', 'house martins gathering on the wires', 'a red deer rut heard from the valley floor',
    'salmon leaping at the weir', 'jays burying acorns for the winter', 'pink-footed geese arriving at dusk',
    'a starling murmuration over the reed bed', 'ink caps and puffballs in the park', 'fieldfares in the orchard',
    'a fox earth on the edge of the golf course', 'seals hauled out on the sandbank', 'beetles under the leaf litter',
    'a wintering flock of golden plover', 'a long-eared owl roost in the scrub', 'holly, ivy and the birds that eat their berries',
    'the shortest days on the salt marsh', 'a winter bird count in the back garden',
    // 2026, up to the first fixture episode (96, July 18)
    'moorhens walking on the frozen mill pond', 'mistle thrushes defending a single tree', 'a gull roost on the reservoir at sunset',
    'catkins on the hazel coppice', 'a barn owl hunting the rough grass', 'tawny owls calling in February', 'rooks repairing the rookery',
    'a flooded water meadow from the footbridge', 'the first lesser celandines on the bank', 'drumming woodpeckers in the old orchard',
    'adders basking on the heath', 'the equinox tide on the mudflats', 'wood anemones in the coppice', 'a dipper nesting under the road bridge',
    'swallows back over the farmyard', 'cowslips on the downland', 'a nightingale in the thicket', 'beavers at dusk on the river',
    'damselflies on the canal', 'a rookery at fledging time', 'kittiwakes on the town sea wall', 'elderflower and the insects it feeds',
    'a hay meadow before the cut', 'bats leaving a church roof', 'the longest evening on the cliffs', 'stag beetles in a city garden',
    'a river in a heatwave', 'puffins rafting off the island'],
  harborhours: [
    'ice on the inner basin', 'a net mender\'s winter', 'the harbor master\'s tide tables', 'the divers who inspect the piers',
    'the first cruise ship of the season', 'a boatyard apprentice\'s first hull', 'cleaning the lighthouse lens', 'the women who ran the fish auction',
    'pilot boats in a spring gale', 'the dredger that never stops', 'the regatta committee', 'mackerel season on the breakwater',
    'the customs officer\'s notebook', 'the night ferry\'s galley cook', 'a summer of jellyfish', 'the harbor swim', 'deckhands on the gravel barges',
    'the chandlery that sells everything', 'a container lost overboard', 'the coastguard watch room', 'the fish smokery on the east quay',
    'the harbor\'s ghost stories', 'a minute\'s silence on the fishing fleet', 'buoy painters before winter', 'the tug crews\' Christmas rota',
    'lights on the trawlers',
    // after the dataset clock
    'the ice plant at the fish dock', 'the harbor at the turn of the year'],
  kettletheory: [
    'marmalade and the setting point', 'why beans need soaking', 'chocolate that seizes', 'pancake batter that rests', 'the science of a crisp salad',
    'egg whites that whip and egg whites that will not', 'asparagus and how fast it ages', 'hot cross buns and enriched dough', 'marinades that do nothing',
    'rhubarb, sugar and acid', 'charcoal versus gas', 'strawberries that bleed', 'ice cream without a machine', 'tomatoes in the fridge',
    'why corn loses its sweetness', 'jam from the freezer', 'zucchini gluts and water content', 'apples that brown and apples that do not',
    'slow cookers and food safety', 'pumpkin seeds and the roasting curve', 'pie crust and cold butter', 'caramel apples and sugar stages',
    'mushrooms and the water they hide', 'a turkey that cooks evenly', 'gingerbread that keeps its shape', 'cooking for a crowd without panic',
    // after the dataset clock
    'gravy that does not split', 'fudge and the soft-ball stage', 'roasting chestnuts without the bang'],
  overtimealmanac: [
    'the snow game that nobody could see', 'a relay team that dropped its baton twice', 'referees who went on strike', 'the slowest marathon on record',
    'a chess match that lasted a weekend', 'the pitcher who threw with both hands', 'a cycling race stopped by a level crossing',
    'the cricket match stopped by bees', 'clearances off the crossbar', 'a rowing race where both boats sank', 'the stadium clock that ran backwards',
    'tennis matches that went past midnight', 'the rugby team with two captains', 'a ski jump in the rain', 'the golfer who played the wrong ball',
    'a boxing bout in a ballroom', 'umpires and the low sun', 'a basketball game decided by one free throw', 'pigeons on the pitch',
    'the swimming pool that was too short', 'season review, 2025'],
  staticsignal: [
    'new-year phone resolutions', 'two-factor codes by text message', 'smart thermostats in a cold snap', 'what a firmware update does',
    'Wi-Fi in a thick-walled house', 'backing up a family photo library', 'smartwatches and sleep scores', 'parental controls that work',
    'robot vacuums and floor maps', 'phone cameras and night mode', 'USB-C everywhere', 'travel adapters and power banks', 'streaming at the cabin',
    'solar chargers', 'back-to-school laptops', 'video doorbells and the neighbors', 'battery health settings', 'secondhand phones',
    'voice assistants that mishear', 'keeping an old tablet useful', 'the year in gadgets, 2025'],
  loudlibrary: [
    'books we abandoned at page fifty', 'co-op games that ended friendships', 'audiobooks at double speed', 'the best album covers',
    'exam season survival reading', 'graduation playlists', 'beach reads that are actually good', 'video game soundtracks',
    'books that became bad movies', 'the indie game backlog', 'spooky reads for October', 'albums to study to (we disagree)', 'the year in reading, 2025',
    // after the dataset clock
    'what we read in 2026'],
  lanternledger: ['the census page that was left blank', 'the parish that skipped a Christmas'],
  bedtimebramble: ['the hedgehog counts the snowflakes', 'the badger\'s midwinter soup'],
};
// [show, first new number, last new number]: 2025 back catalogue and the run after the dataset clock.
// Overtime Almanac and Static & Signal run January to October with a break, as in 2026. Lantern Ledger
// and Bedtime Bramble start at episode 1 in 2026. Field Notes stops at 114 so that the shipped example event
// examples/events/fieldnotes-115-publish.json still applies to the dataset.
const RUNS = [['fieldnotes', 16, 95], ['harborhours', 39, 64], ['harborhours', 89, 90], ['kettletheory', 5, 30], ['kettletheory', 54, 56],
  ['overtimealmanac', 80, 100], ['staticsignal', 30, 50], ['loudlibrary', 8, 20], ['loudlibrary', 33, 33], ['lanternledger', 12, 13],
  ['bedtimebramble', 20, 21]];
// Release dates from the fixture cadence. The 2025 seasons of Overtime Almanac and Static & Signal start
// on the same weekday as their 2026 seasons.
const CADENCE = {fieldnotes: 7, harborhours: 14, kettletheory: 14, loudlibrary: 28, lanternledger: 30, bedtimebramble: 14, overtimealmanac: 14, staticsignal: 14};
const SEASON_2025 = {overtimealmanac: [80, '2025-01-06'], staticsignal: [30, '2025-01-15']};
function releaseDate(slug, number) {
  if (SEASON_2025[slug] && number <= 100 && number < SEASON_2025[slug][0] + 21) return addDays(SEASON_2025[slug][1], (number - SEASON_2025[slug][0]) * CADENCE[slug]);
  const ref = fixture.episodes.filter(e => e.show_id === 'show-' + slug).sort((a, b) => a.number - b.number);
  const base = number < ref[0].number ? ref[0] : ref[ref.length - 1];
  return addDays(base.published_at.slice(0, 10), (number - base.number) * CADENCE[slug]);
}

const GUESTS = {
  harborhours: [['Doreen Mallory', 'who has worked the quay for forty years'], ['Kwame Asante', 'a second-generation pilot'], ['Ellie Tran', 'a deckhand'],
    ['Gareth Pryce', 'a retired harbor master'], ['Rosa Lindgren', 'a boatyard owner'], ['Iqbal Shah', 'a ferry engineer'], ['Bridget Coyle', 'a lifeboat helm'],
    ['Tomasz Nowak', 'a crane driver'], ['Hannah Ilori', 'a marine surveyor'], ['Pete Corrigan', 'a trawler skipper']],
  kettletheory: [['Mira Okonkwo', 'a food scientist'], ['Jonah Feld', 'a pastry chef'], ['Lucia Brennan', 'a home-economics teacher'], ['Arjun Mehta', 'a test-kitchen cook'],
    ['Sofie Dahl', 'a jam maker'], ['Malik Rahman', 'a butcher'], ['Yuki Saito', 'a restaurant cook']],
  overtimealmanac: [['Colm Baxter', 'a sports statistician'], ['Renata Silva', 'a former referee'], ['Abe Lindholm', 'a club historian'], ['Priscilla Moe', 'a radio commentator'],
    ['Dmitri Volkov', 'a groundskeeper'], ['Nadia Haddad', 'a sports archivist']],
  staticsignal: [['Lorna Fitch', 'a repair-shop owner'], ['Ben Adebayo', 'a network engineer'], ['Clara Voss', 'a privacy researcher'], ['Raj Iyer', 'a phone reviewer'],
    ['Tess Morrow', 'a school IT technician']],
  loudlibrary: [['Jess', 'Theo']],
  lanternledger: [['Philippa Grant', 'a county archivist'], ['Owusu Mensah', 'a parish records volunteer']],
  bedtimebramble: [['Aunt Juniper', 'the narrator']],
};
// Field Notes guests by what the walk is about (first match wins).
const FIELD_GUESTS = [
  [/\bbats?\b/, [['Dev Kapoor', 'a bat survey volunteer']]],
  [/ink cap|puffball|fung/, [['Martha Penhale', 'a mycologist']]],
  [/wigeon|duck|redwing|wagtail|grebe|heron|martin|skylark|chiffchaff|cuckoo|peregrine|swift|nightjar|swallow|shearwater|wading|\bjays?\b|geese|starling|fieldfare|plover|owl|thrush|gull|rook|woodpecker|dipper|nightingale|kittiwake|puffin|moorhen|bird/,
    [['Ines Achterberg', 'a county bird recorder'], ['Sami Haddou', 'a seabird counter'], ['Hugo Brandt', 'a falconer'], ['Joel Amara', 'a reserve warden']]],
  [/\bbees?\b|bumblebee|hoverfl|mayfl|glow-worm|dragonfl|butterfl|grasshopper|moth|spider|beetle|damselfl|insect/,
    [['Noemi Farkas', 'an entomologist'], ['Agnes Lindqvist', 'a moth recorder']]],
  [/snowdrop|blackthorn|bluebell|orchid|heather|blackberr|holly|catkin|celandine|anemone|cowslip|elderflower|hay meadow/,
    [['Maren Holt', 'a botanist'], ['Lena Sorensen', 'a hedgelayer']]],
  [/canal|frogspawn|toad|newt|seal|crab|salmon|salt marsh|mudflat|river|beaver|weir|tide/,
    [['Tobias Mwangi', 'a freshwater ecologist'], ['Ade Bankole', 'a river keeper'], ['Shira Patel', 'a marine biologist'], ['Felix Odum', 'a beach ranger'], ['Rosalind Tey', 'a retired lock keeper']]],
  [/./, [['Callum Rees', 'a wildlife sound archivist'], ['Joel Amara', 'a reserve warden']]],
];
GUESTS.fieldnotes = subject => FIELD_GUESTS.find(([pattern]) => pattern.test(subject))[1];
const SEGMENTS = {
  fieldnotes: 'On the walk', harborhours: 'On the quay', kettletheory: 'At the stove', overtimealmanac: 'The argument', staticsignal: 'Listener question',
  loudlibrary: 'Hot takes', lanternledger: 'In the archive', bedtimebramble: 'The story',
};
const ARGUMENTS = ['whether a draw is better than a loss on penalties', 'the best mascot of all time', 'whether walking is a sport', 'the greatest comeback ever',
  'whether darts needs a dress code', 'the worst kit colour', 'whether a tie should go to the runner', 'the most overrated stadium food'];
const QUESTIONS = ['how long a phone should last', 'whether to turn off Bluetooth', 'why the printer needs an account', 'how to share a calendar with a teenager',
  'what to do with an old router', 'whether airplane mode saves battery', 'how many chargers a house needs'];

const episodes = [];
const fixtureIds = new Set(fixture.episodes.map(e => e.episode_id));
for (const [slug, from, to] of RUNS) {
  const show = SHOW[slug], subjects = SUBJECTS[slug];
  for (let number = from; number <= to; number++) {
    const used = episodes.filter(e => e.show_id === show.show_id).length, subject = subjects[used];
    assert.ok(subject, 'subject for ' + slug + ' ' + number);
    const id = 'ep-' + slug + '-' + String(number).padStart(3, '0'), date = releaseDate(slug, number);
    assert.ok(!fixtureIds.has(id), 'new episode ' + id);
    const [base, spread] = DURATION[slug], duration = base + int(0, spread - 1);
    const [guest, role] = pick(typeof GUESTS[slug] === 'function' ? GUESTS[slug](subject) : GUESTS[slug]);
    const recorded = addDays(date, -int(2, 9));
    const detail = {
      fieldnotes: `Recorded on ${longDate(recorded)}, with ${guest}, ${role}.`,
      harborhours: `Told by ${guest}, ${role}, and reported in the week before ${longDate(date)}.`,
      kettletheory: `Tested in the studio kitchen on ${longDate(recorded)}, with ${guest}, ${role}.`,
      overtimealmanac: `With ${guest}, ${role}. This week's listener argument: ${pick(ARGUMENTS)}. Recorded ${longDate(recorded)}.`,
      staticsignal: `With ${guest}, ${role}, answering a listener question about ${pick(QUESTIONS)}. Recorded ${longDate(recorded)}.`,
      loudlibrary: `Jess and Theo recorded this one on ${longDate(recorded)}. Contains strong language.`,
      lanternledger: `With ${guest}, ${role}. Research notes and sources for the ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)} episode are in the show notes archive.`,
      bedtimebramble: `Read by ${guest}, ${role}, for ${longDate(date)}.`,
    }[slug];
    const title = cap(subject), i = number;
    episodes.push({episode_id: id, show_id: show.show_id, number, title, published_at: la(date, '05:00'), duration_s: duration,
      end_of_content_s: duration - 60 - (i % 4) * 15,
      chapters: [{title: 'Opening', start_s: 0}, {title, start_s: 90 + (i % 3) * 30}, {title: SEGMENTS[slug], start_s: Math.floor(duration * 0.45)},
        {title: slug === 'bedtimebramble' ? 'Goodnight' : 'Listener notes', start_s: Math.floor(duration * 0.8)}],
      notes: `${show.description} This episode: ${subject}. ${detail}`, bytes: duration * 16000, explicit: show.explicit, availability: 'available'});
  }
}
for (const [slug, list] of Object.entries(SUBJECTS)) assert.equal(episodes.filter(e => e.show_id === 'show-' + slug).length, list.length, 'every subject used: ' + slug);
const allEpisodes = [...fixture.episodes, ...episodes];
const episode = id => allEpisodes.find(e => e.episode_id === id);
const ordered = list => [...list].sort((a, b) => Date.parse(a.published_at) - Date.parse(b.published_at) || a.episode_id.localeCompare(b.episode_id));

// ---------- Priya's year on the Individual plan (2025) ----------
// She streams on her old phone (no Tidepool downloads) and replaces it with the fixture phone on
// Jan. 3, 2026, when the family joins. Harbor Hours on the commute, Kettle Theory while cooking,
// Overtime Almanac at lunch, Static & Signal on Sunday evenings, albums on Saturday mornings.
const OLD_PHONE = {device_id: 'dev-priya-oldphone', member_id: 'mem-priya', name: 'Priya\'s old phone', kind: 'phone', storage_cap_bytes: 0,
  auto_download: false, last_checkin_at: la('2026-01-03', '08:30'), registered_at: la('2025-01-03', '08:10')};
const VACATION = ['2025-08-02', '2025-08-17']; // two weeks away in August: nothing played
const away = d => d >= VACATION[0] && d <= VACATION[1];
const tracks = new Map(fixture.tracks.map(t => [t.track_id, t]));
const sessions = [];
let sessionNo = 0;
function listen(type, id, date, hm, start, end, reason, speed = 1, endReason) {
  const item = type === 'episode' ? episode(id) : tracks.get(id);
  const started = la(date, hm), listened = Math.ceil((end - start) / speed);
  assert.ok(!away(date), 'nothing played on vacation');
  const s = {session_id: 'ls-' + String(++sessionNo).padStart(4, '0'), member_id: 'mem-priya', device_id: OLD_PHONE.device_id, item_type: type, item_id: id,
    started_at: started, start_reason: reason, speed, start_position_s: start, end_position_s: end,
    end_reason: endReason || (type === 'episode' && end >= item.end_of_content_s ? 'completed' : end === item.duration_s ? 'completed' : 'paused'),
    ended_at: plusSeconds(started, listened + 40), speaker_hint: null};
  sessions.push(s);
  return s;
}
const of2025 = slug => ordered(episodes.filter(e => e.show_id === 'show-' + slug && e.published_at < '2026'));
const pubDate = e => e.published_at.slice(0, 10);
// Harbor Hours: the morning after release on the commute; every third one over two mornings.
of2025('harborhours').forEach((e, i, list) => {
  const day = addDays(pubDate(e), 1);
  if (away(day) || away(addDays(day, 1))) return;
  if (i === list.length - 1) {listen('episode', e.episode_id, addDays(pubDate(e), 4), '10:30', 0, 1320, 'user', 1, 'paused'); return;} // Dec. 27: unfinished
  if (chance(0.08)) return;
  if (i % 3 === 0) {
    listen('episode', e.episode_id, day, '07:4' + int(0, 4), 0, 1500, 'user', 1, 'paused');
    listen('episode', e.episode_id, addDays(day, 1), '07:4' + int(0, 4), 1500, e.end_of_content_s + 20, 'queue');
  } else listen('episode', e.episode_id, day, '07:4' + int(0, 4), 0, e.end_of_content_s + 20, 'user', i % 4 === 1 ? 1.2 : 1);
});
// Kettle Theory: the evening it comes out, while cooking; not on Thanksgiving or Christmas.
for (const e of of2025('kettletheory')) {
  const day = pubDate(e);
  if (away(day) || ['2025-11-27', '2025-12-25'].includes(day) || !chance(0.82)) continue;
  listen('episode', e.episode_id, day, '18:' + pad(int(20, 40)), 0, e.duration_s, pick(['user', 'user', 'queue']));
}
// Overtime Almanac: Thursday lunch; Static & Signal: Sunday evening, a couple left half-finished.
for (const e of of2025('overtimealmanac')) {
  const day = addDays(pubDate(e), 3);
  if (!away(day) && chance(0.76)) listen('episode', e.episode_id, day, '12:' + pad(int(10, 20)), 0, e.duration_s, 'user', pick([1, 1, 1.25]));
}
of2025('staticsignal').forEach((e, i) => {
  const day = addDays(pubDate(e), 4);
  if (away(day) || !chance(0.72)) return;
  const half = i === 6 || i === 15;
  listen('episode', e.episode_id, day, '21:' + pad(int(5, 15)), 0, half ? Math.floor(e.duration_s * 0.4) : e.duration_s, 'queue', 1, half ? 'paused' : undefined);
});
// Albums on Saturday mornings, and each new album she likes on its release weekend. Her fixture play
// counts are left as they are: none of the tracks she later plays on the kitchen speaker appear here.
const albums = new Map(fixture.albums.map(a => [a.album_id, a]));
const fixturePlays = new Set(fixture.plays.filter(p => p.member_id === 'mem-priya').map(p => p.track_id));
const TASTE = ['alb-lowtide-1', 'alb-halcyon-1', 'alb-juno-1', 'alb-juno-2', 'alb-marrow-1', 'alb-marrow-2', 'alb-mbali-1', 'alb-kestrel-1', 'alb-tamsin-1'];
const playable = (albumId, date) => albums.get(albumId).released <= addDays(date, -1);
function albumMorning(date, albumId, count) {
  const ids = albums.get(albumId).track_ids.filter(id => !fixturePlays.has(id) && !tracks.get(id).explicit);
  let at = la(date, '09:' + pad(int(30, 55))), first = int(0, Math.max(0, ids.length - count));
  for (let k = 0; k < count && first + k < ids.length; k++) {
    const t = tracks.get(ids[first + k]), skip = k > 0 && chance(0.12);
    const s = listen('track', t.track_id, date, at.slice(11, 19), 0, skip ? Math.floor(t.duration_s / 2) : t.duration_s, k ? 'autoplay' : 'user', 1, skip ? 'skipped' : undefined);
    at = plusSeconds(s.ended_at, 5);
  }
}
const RELEASE_WEEKENDS = new Map(['alb-lowtide-1', 'alb-halcyon-1', 'alb-tamsin-1', 'alb-juno-2', 'alb-marrow-2']
  .map(id => [addDays(albums.get(id).released, 1), id]));
for (let d = '2025-01-04'; d <= '2025-12-27'; d = addDays(d, 7)) {
  if (away(d)) continue;
  if (RELEASE_WEEKENDS.has(d)) {albumMorning(d, RELEASE_WEEKENDS.get(d), 5); continue;}
  if (Math.round((dateMs(d) - dateMs('2025-01-04')) / DAY / 7) % 2 === 1 || chance(0.2)) continue;
  const options = TASTE.filter(id => playable(id, d));
  albumMorning(d, pick(options), int(2, 4));
}
sessions.sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
sessions.forEach((s, i) => {s.session_id = 'ls-' + String(i + 1).padStart(4, '0');});

// Progress and play counts follow from the sessions (latest session wins), as in dev/build-fixtures.cjs.
const progress = new Map(), plays = new Map();
for (const s of sessions) {
  if (s.item_type === 'track') {
    const key = s.member_id + '/' + s.item_id, p = plays.get(key) || {member_id: s.member_id, track_id: s.item_id, count: 0};
    p.count++; p.last_played_at = s.ended_at; plays.set(key, p);
    continue;
  }
  const e = episode(s.item_id), played = s.end_position_s >= e.end_of_content_s;
  progress.set(s.item_id, {member_id: s.member_id, episode_id: s.item_id, state: played ? 'played' : 'in_progress', position_s: played ? 0 : s.end_position_s,
    updated_at: s.ended_at, played_at: played ? s.ended_at : null, set_by: 'session', replaced: null});
}

// ---------- billing: twelve Individual invoices, one declined and paid two days later ----------
const payments2025 = [], notices2025 = [];
for (let m = 1; m <= 12; m++) {
  const date = `2025-${pad(m)}-03`, id = 'inv-' + date;
  if (m === 7) {
    const declined = la(date, '02:10'), grace = plusSeconds(declined, 7 * 86400);
    payments2025.push({invoice_id: id, outcome: 'declined', at: declined, amount_cents: 1099});
    payments2025.push({invoice_id: id, outcome: 'paid', at: la('2025-07-05', '18:20'), amount_cents: 1099});
    notices2025.push({notice_id: 'notice-h15', member_id: 'mem-priya', created_at: declined, kind: 'payment_declined',
      text: `Payment of $10.99 for the period starting ${date} was declined. Pay by ${grace} to keep downloads available offline.`,
      object_type: 'invoice', object_id: id, event_id: 'history-charge-' + id});
  } else payments2025.push({invoice_id: id, outcome: 'paid', at: la(date, '02:10'), amount_cents: 1099});
}

// ---------- assemble ----------
// The three fixture records the 2025 story changes. Everything else is copied verbatim.
const STORY_CHANGES = {
  'family.created_at': [fixture.family.created_at, ACCOUNT_START],
  'members[mem-priya].joined_at': [fixture.members[0].joined_at, ACCOUNT_START],
  'billing.anchor and billing.timeline': ['family from ' + FAMILY_START + ' (start)', 'individual from ' + ACCOUNT_START + ' (start), family from ' + FAMILY_START + ' (upgrade)'],
};
assert.equal(fixture.members[0].member_id, 'mem-priya');
const seed = {
  account_id: fixture.account_id, owner_person_id: fixture.owner_person_id,
  family: {...fixture.family, created_at: ACCOUNT_START},
  members: fixture.members.map(m => m.member_id === 'mem-priya' ? {...m, joined_at: ACCOUNT_START} : m),
  invitations: fixture.invitations, plans: fixture.plans,
  billing: {...fixture.billing, anchor: ACCOUNT_START,
    timeline: [{plan_id: 'individual', from: ACCOUNT_START, set_at: ACCOUNT_START, change: 'start'}, {...fixture.billing.timeline[0], change: 'upgrade'}],
    payments: [...payments2025, ...fixture.billing.payments]},
  artists: fixture.artists, albums: fixture.albums, tracks: fixture.tracks, shows: fixture.shows,
  episodes: ordered(allEpisodes),
  devices: [OLD_PHONE, ...fixture.devices],
  sessions: [...sessions, ...fixture.sessions],
  progress: [...progress.values(), ...fixture.progress],
  plays: [...plays.values(), ...fixture.plays],
  follows: fixture.follows, upnext: fixture.upnext, downloads: fixture.downloads, library: fixture.library, playlists: fixture.playlists,
  notifications: [...notices2025, ...fixture.notifications],
  activity: fixture.activity, next_seq: fixture.next_seq,
};

// ---------- checks ----------
const binding = read('fixtures/binding.json');
assert.ok(compile(read('schemas/seed.schema.json'), path.join(pkg, 'schemas'))(seed), 'seed schema');
plugin.validateSeed({app_id: 'tidepool', binding, virtual_now: CLOCK}, seed);
const clock = Date.parse(CLOCK);
for (const s of sessions) {
  const item = s.item_type === 'episode' ? episode(s.item_id) : tracks.get(s.item_id);
  if (s.item_type === 'episode') assert.ok(before(item.published_at, s.started_at), s.session_id + ' plays an episode after its release');
  else assert.ok(albums.get(item.album_id).released < s.started_at.slice(0, 10), s.session_id + ' plays a track after its album release');
  assert.ok(Date.parse(s.started_at) >= Date.parse(OLD_PHONE.registered_at) && Date.parse(s.ended_at) <= Date.parse(OLD_PHONE.last_checkin_at), 'old phone in use');
}
for (const [a, b] of sessions.slice(1).map((s, i) => [sessions[i], s])) assert.ok(!before(b.started_at, a.ended_at), 'sessions do not overlap: ' + b.session_id);
for (const p of plays.keys()) assert.ok(!fixture.plays.some(x => x.member_id === 'mem-priya' && x.track_id === plays.get(p).track_id), 'fixture play counts unchanged');
for (const p of progress.values()) assert.ok(!fixture.progress.some(x => x.member_id === p.member_id && x.episode_id === p.episode_id), 'fixture progress unchanged');
// Family records end at the dataset clock; only episodes run on to the end of 2026.
const familyTimes = [...seed.sessions.map(s => s.ended_at), ...seed.downloads.map(d => d.requested_at), ...seed.billing.payments.map(p => p.at),
  ...seed.notifications.map(n => n.created_at), ...seed.devices.map(d => d.last_checkin_at), ...seed.library.map(l => l.saved_at)];
assert.ok(familyTimes.every(t => Date.parse(t) <= clock), 'family history ends at the dataset clock');
assert.ok(seed.episodes.every(e => e.published_at.slice(0, 10) >= WINDOW[0] && e.published_at.slice(0, 10) <= WINDOW[1] || fixtureIds.has(e.episode_id)), 'episodes in the window');

// One record per line keeps the file reviewable in a diff and compact enough for one env.load_seed call.
function lines(value) {
  const parts = Object.entries(value).map(([k, v]) => Array.isArray(v) && v.length && typeof v[0] === 'object'
    ? `  ${JSON.stringify(k)}: [\n${v.map(x => '    ' + JSON.stringify(x)).join(',\n')}\n  ]`
    : `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  return '{\n' + parts.join(',\n') + '\n}\n';
}
fs.mkdirSync(outDir, {recursive: true});
const seedText = lines(seed);
assert.deepEqual(JSON.parse(seedText), seed);
fs.writeFileSync(path.join(outDir, 'seed.json'), seedText);
const write = (file, value) => fs.writeFileSync(path.join(outDir, file), JSON.stringify(value, null, 2) + '\n');
write('clock.json', {initial_time: CLOCK});
write('binding.json', binding);
write('policies.json', read('fixtures/policies.json'));
const base = read('contribution/dataset.json');
write('dataset.json', {
  ...base, dataset_id: 'tidepool-evaluation-2025-2026', version: DATASET_VERSION,
  description: 'Synthetic evaluation seed for the Raman-Ellis family covering 2025-01-01 through 2026-12-31 (America/Los_Angeles): Priya\'s year on the Individual plan, the family\'s 2026 on the Family plan (the fixture history, verbatim), and the shows\' episodes on their schedules through December 2026. Loadable with env.load_seed at any clock in the window; Tidepool shows only records dated at or before the clock.',
  record_source_ids: ['authored', 'generated'],
  sources: [base.sources[0], {
    source_id: 'generated', kind: 'synthetic',
    description: 'Template-generated fictional episodes, listening sessions, payments and one notice written by dev/build-dataset.cjs on the fixture schedules. Shows, artists, albums, tracks and people are the fixture\'s; guests and narrators are invented personal names; nothing was collected from real services.',
    uri: null, license: 'MIT', usage: 'permitted', collection: null,
    generation: {method: 'template', tool: 'dev/build-dataset.cjs', tool_version: DATASET_VERSION, seed: SEED,
      parameters: {window: WINDOW, time_zone: 'America/Los_Angeles', clock: CLOCK, account_start: ACCOUNT_START,
        outputs: {'seed.json': {bytes: Buffer.byteLength(seedText), sha256: crypto.createHash('sha256').update(seedText).digest('hex')}}}},
  }],
  transformations: [
    'Every fixture record is copied verbatim except three that the 2025 story extends: family.created_at and Priya\'s joined_at move to 2025-01-03 (the account opens on the Individual plan), and billing gains an Individual start on 2025-01-03 before the fixture\'s Family entry, which becomes an upgrade at the Jan. 3, 2026 renewal. The billing calendar (the 3rd of each month, 00:00 PST) and every 2026 invoice are unchanged. The upgrade carries no proration, as the fixture\'s paid 1799-cent February invoice requires; plan.confirm_change at exactly 00:00 on Jan. 3 would add 700 cents (it prorates the whole new period), one minute earlier 0.',
    'Priya\'s 2025 sessions are expanded from weekly routines with a fixed random seed; her 2025 progress and play counts are derived from them and share no key with the fixture\'s.',
    'Episodes extend each show\'s fixture cadence backwards to 2025-01-01 and forwards to 2026-12-31; Field Notes stops at 114 so that examples/events/fieldnotes-115-publish.json still applies.',
  ],
  expected_counts: {records: plugin.records(seed).length, assets: 0},
});
// The file must validate as a bundle dataset, so a task can pass it to env.load_seed as is.
assert.ok(compile(read('schemas/dataset.schema.json'), path.join(pkg, 'schemas'))(read('data/evaluation/dataset.json')), 'dataset.json schema');
console.log({episodes: seed.episodes.length, new_episodes: episodes.length, sessions_2025: sessions.length, progress_2025: progress.size, plays_2025: plays.size,
  records: plugin.records(seed).length, bytes: Buffer.byteLength(seedText), compact_bytes: Buffer.byteLength(JSON.stringify(seed)), story_changes: Object.keys(STORY_CHANGES)});
