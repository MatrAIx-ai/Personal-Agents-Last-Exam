'use strict';
// Maintainer script (not run by tests or the verifier). Builds the public catalog, Dana's account
// (fixtures/minimal.json), Ines's account (examples/task-data/seed.json), the approved example events,
// bindings, policies and dataset counts from one authored source plus a seeded generator, so the
// output is byte-for-byte reproducible. Usage, from the package directory: node dev/build-fixtures.cjs
const fs = require('node:fs'), path = require('node:path');
const out = path.resolve(__dirname, '..');
const tools = require('../tools.json');

// ---- Deterministic helpers ----------------------------------------------------------------
function rng(seed) {
  let a = seed >>> 0;
  return () => {a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296;};
}
const GENERATOR_SEED = 20261201;
const R = rng(GENERATOR_SEED);
const pick = list => list[Math.floor(R() * list.length)];
const int = (lo, hi) => lo + Math.floor(R() * (hi - lo + 1));
const chance = p => R() < p;
function shuffle(list) {const a = list.slice(); for (let i = a.length - 1; i > 0; i--) {const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]];} return a;}
const pad = (n, w) => String(n).padStart(w, '0');
const slug = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const day = (iso, n) => {const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);};
const Z = (date, time = '08:00') => date + 'T' + time + ':00Z';
const PT = (date, time = '00:00') => date + 'T' + time + ':00-08:00';
const PDT = (date, time = '00:00') => date + 'T' + time + ':00-07:00';
const CLOCK = '2026-12-01T09:00:00-08:00';

// ---- Services -----------------------------------------------------------------------------
const services = [
  {service_id: 'brightreel', name: 'Brightreel', regions: ['US', 'UK', 'CA'], offer_types: ['subscription', 'rent', 'buy']},
  {service_id: 'northcast', name: 'Northcast', regions: ['US', 'UK', 'CA'], offer_types: ['subscription', 'free_with_ads']},
  {service_id: 'plumvale', name: 'Plumvale', regions: ['US', 'CA'], offer_types: ['subscription']},
  {service_id: 'kettlewing', name: 'Kettlewing', regions: ['UK', 'CA'], offer_types: ['subscription', 'rent']},
  {service_id: 'tinlark', name: 'Tinlark Store', regions: ['US', 'UK', 'CA'], offer_types: ['rent', 'buy']},
  {service_id: 'openfern', name: 'Openfern', regions: ['US', 'UK'], offer_types: ['free_with_ads']},
];
const CURRENCY = {US: 'USD', UK: 'GBP', CA: 'CAD'};
const CERTS = {
  film: {US: ['G', 'PG', 'PG-13', 'R'], UK: ['U', 'PG', '12A', '15', '18'], CA: ['G', 'PG', '14A', '18A']},
  series: {US: ['TV-Y7', 'TV-G', 'TV-PG', 'TV-14', 'TV-MA'], UK: ['U', 'PG', '12', '15', '18'], CA: ['G', 'PG', '14A', '18A']},
};
const LEVEL = {G: 0, U: 0, 'TV-Y7': 0, 'TV-G': 0, PG: 1, 'TV-PG': 1, 'PG-13': 2, '12A': 2, '12': 2, '14A': 2, 'TV-14': 2, R: 3, '15': 3, '18A': 3, 'TV-MA': 3, '18': 3};
const certFor = (kind, region, level) => CERTS[kind][region].find(c => LEVEL[c] === level) || CERTS[kind][region][Math.min(level, CERTS[kind][region].length - 1)];

// ---- Word lists for generated, invented names and short original text ----------------------
const PLACE_A = ['Brask', 'Corv', 'Dravel', 'Esk', 'Fallow', 'Grist', 'Hethel', 'Ivel', 'Juniver', 'Kestle', 'Lorrow', 'Mallin', 'Nether', 'Ostle',
  'Quarrow', 'Rusk', 'Sallow', 'Tarrin', 'Ulver', 'Vesp', 'Wendle', 'Yarrow', 'Zenn', 'Abber'];
const PLACE_B = ['brook', 'mere', 'holt', 'wick', 'ford', 'stead', 'moor', 'gate', 'ridge', 'haven', 'dale', 'thorpe', 'combe', 'fold', 'wyn'];
const FILM_PATTERNS = ['The {P} Letters', '{P} Crossing', 'Night at {P}', 'The Last Ferry to {P}', '{P} Summer', 'Return to {P}', 'The {P} Accord',
  'A Winter in {P}', 'The {P} Signal', 'Under {P} Bridge', 'The Orchards of {P}', '{P} Station', 'The {P} Inheritance', 'Lights over {P}',
  'The {P} Choir', 'Far from {P}', 'The Bells of {P}', '{P} Road', 'The {P} Ledger', 'Saints of {P}'];
const SERIES_PATTERNS = ['{P}', '{P} General', 'Station {P}', '{P} Nights', 'The {P} Circuit', '{P} Academy', 'Inspector {P}', 'Little {P}'];
const FIRST = ['Ada', 'Bastian', 'Celia', 'Desmond', 'Elsa', 'Felix', 'Greta', 'Hugo', 'Ilse', 'Jonah', 'Katya', 'Leon', 'Marta', 'Nico', 'Opal',
  'Pavel', 'Rosa', 'Silas', 'Tilde', 'Ugo', 'Vera', 'Walter', 'Yara', 'Zeno', 'Agnes', 'Bruno', 'Clara', 'Dmitri', 'Edith', 'Frank', 'Gemma',
  'Hector', 'Irene', 'Joel', 'Lena', 'Milo', 'Nadia', 'Oscar', 'Petra', 'Ruben', 'Sofia', 'Theo', 'Una', 'Viktor', 'Wanda', 'Xavier', 'Yusuf',
  'Zora', 'Amos', 'Beatrix', 'Casper', 'Delia', 'Emil', 'Flora', 'Gideon', 'Hazel', 'Isak', 'June', 'Kofi', 'Lior'];
const SUR_A = ['Ar', 'Bel', 'Cor', 'Dal', 'Ev', 'Far', 'Gil', 'Har', 'Ing', 'Jor', 'Kin', 'Lyn', 'Mor', 'Nev', 'Os', 'Pry', 'Quil', 'Ren', 'Sor',
  'Tre', 'Ul', 'Vay', 'Wex', 'Yeo'];
const SUR_B = ['ley', 'mont', 'wick', 'ston', 'ridge', 'worth', 'by', 'cott', 'dell', 'field', 'hurst', 'lowe', 'more', 'nall', 'rick', 'sey', 'ton', 'wood'];
const GENRES = ['Drama', 'Comedy', 'Thriller', 'Mystery', 'Romance', 'Family', 'Adventure', 'Science fiction', 'Documentary', 'Animation', 'Crime', 'Western'];
const WHO = ['a retired ferry pilot', 'a young surveyor', 'two estranged brothers', 'a night-shift nurse', 'a stubborn orchard keeper', 'a choir teacher',
  'a lighthouse mechanic', 'a former chess champion', 'a radio host', 'three schoolfriends', 'a widowed baker', 'a junior detective', 'a travelling projectionist',
  'a mapmaker', 'a reluctant mayor', 'a tugboat crew'];
const GOAL = ['tries to save the town cinema', 'searches for a missing letter', 'reopens a flooded mine', 'plans one last river race', 'restores a broken clock tower',
  'hides a runaway horse', 'competes in a regional bake-off', 'uncovers a decades-old land swindle', 'drives an old bus across the border', 'organises a winter fair',
  'looks after a neighbour\'s farm', 'tracks a stolen painting'];
const SNAG = ['A storm closes the only road.', 'An old rival arrives with a better offer.', 'The deadline is the end of the month.', 'Nobody in town agrees on what happened.',
  'The money runs out halfway.', 'A secret from the past keeps surfacing.', 'The ice is thinner than anyone thought.', 'Every clue points to a friend.'];
const EP_ACTION = ['A visitor brings news that changes the plan.', 'An argument at the harbour turns into a wager.', 'A night search ends at the old quarry.',
  'Two friends fall out over a borrowed car.', 'The festival committee faces a vote.', 'A letter arrives twenty years late.', 'A storm traps everyone in the hall.',
  'An inspection threatens to close the station.', 'A rival team arrives early.', 'Someone has been reading the logbook.'];
const EP_SPOILER = ['The season ends with a death in the family.', 'The culprit is revealed to be the station chief.', 'A main character leaves town for good.',
  'The finale reveals who started the fire.'];
const GUIDE_TEXT = {
  violence: {mild: ['Brief scuffles with no injuries shown.', 'A shove and a fall played for laughs.'], moderate: ['Fistfights leave characters bruised and bleeding.', 'A shooting happens off screen; the aftermath is shown.'],
    severe: ['A prolonged and bloody fight.', 'Graphic injuries are shown in close-up.']},
  language: {mild: ['Occasional mild insults.', 'A few uses of mild language.'], moderate: ['Frequent moderate swearing.', 'Several strong words in arguments.'], severe: ['Constant strong language.', 'Strong language throughout.']},
  sexual_content: {mild: ['A couple kisses briefly.', 'Mild flirting.'], moderate: ['A sex scene is implied; no nudity.', 'Sexual references in dialogue.'], severe: ['A sex scene with partial nudity.', 'Explicit sexual references.']},
  frightening: {mild: ['A few tense moments in the dark.', 'Brief jump scares.'], moderate: ['Sustained tension and peril.', 'A frightening chase through a forest.'], severe: ['Intense scenes of terror.', 'Disturbing images of injury.']},
  substances: {mild: ['Adults drink at a party.', 'A character smokes a pipe.'], moderate: ['A character is drunk in several scenes.', 'Drug use is discussed.'], severe: ['Drug use is shown.', 'Heavy drinking throughout.']},
};
const SUMMARY = {
  violence: {none: 'No violence.', mild: 'Mild, brief violence.', moderate: 'Some realistic violence.', severe: 'Strong, graphic violence.'},
  language: {none: 'No bad language.', mild: 'Mild language.', moderate: 'Moderate swearing.', severe: 'Frequent strong language.'},
  sexual_content: {none: 'No sexual content.', mild: 'Brief romance.', moderate: 'Implied sexual content.', severe: 'Explicit sexual content.'},
  frightening: {none: 'Nothing frightening.', mild: 'A few tense moments.', moderate: 'Sustained peril.', severe: 'Intense and disturbing scenes.'},
  substances: {none: 'No drinking or drug use.', mild: 'Some social drinking.', moderate: 'Drunkenness and references to drugs.', severe: 'Drug use is shown.'},
};
const SPOILER_ITEMS = {violence: 'A main character is killed near the end.', frightening: 'The final scene reveals the ghost was the narrator.',
  language: 'The last line of the film is an angry outburst at the villain.', substances: 'The hero turns out to have been poisoned.', sexual_content: 'The ending shows the couple together after all.'};
const HANDLES = ['reelwren', 'nightowlfilms', 'quietrowseat', 'saltwatercritic', 'tallgrassviewer', 'balconyfront', 'popcornledger', 'thirdactdan', 'lanternreader',
  'harbourreels', 'midweekmatinee', 'filmfolder', 'castlistcass', 'lowlightlou', 'creditsroll', 'secondreel', 'orchardcinema', 'matineemargo', 'framebyfrank', 'tidaltv'];
const REVIEW_TEXT = ['Gentle and well acted, though the middle drags.', 'Beautifully shot; the score does a lot of work.', 'I wanted to like it more than I did.',
  'Funny, warm and a little too long.', 'A slow start that pays off.', 'The cast is great but the script is thin.', 'Perfect for a rainy afternoon.',
  'Tense from the first scene to the last.', 'Some lovely moments, some clumsy ones.', 'Not for everyone, but it stayed with me.'];
const SPOILER_REVIEW = ['I did not see the ending coming: the sister was behind it all along.', 'Shame they killed off the best character in the final act.',
  'The twist with the letter makes the whole first half make sense.'];

// ---- Named titles (from the approved proposal and the acceptance plan) ----------------------
const seasonsOf = (list) => list.map(([season_number, name, added_at]) => ({season_number, name, added_at}));
const rel = (date, us, uk, ca) => [{region: 'US', date, certification: us}, {region: 'UK', date: day(date, 7), certification: uk}, {region: 'CA', date, certification: ca}];
const NAMED = [
  {title_id: 'tt-lantern-hill', kind: 'film', name: 'Lantern Hill', year: 2025, genres: ['Family', 'Drama'],
    synopsis: 'A ten-year-old spends the summer on her grandmother\'s hill farm and sets out to revive the valley\'s old lantern festival.',
    editions: [{edition_id: 'ed-lantern-hill-theatrical', label: 'Theatrical', runtime_minutes: 104}], releases: rel('2025-10-17', 'PG', 'PG', 'PG'), seasons: []},
  {title_id: 'tt-fieldglass', kind: 'film', name: 'Fieldglass', year: 2024, genres: ['Drama', 'Mystery'],
    synopsis: 'A birdwatcher with a borrowed pair of binoculars sees something across the marsh that the police will not believe.',
    editions: [{edition_id: 'ed-fieldglass-theatrical', label: 'Theatrical', runtime_minutes: 97}], releases: rel('2024-04-19', 'PG-13', '12A', 'PG'), seasons: []},
  {title_id: 'tt-copper-sky', kind: 'film', name: 'Copper Sky', year: 2023, genres: ['Adventure', 'Drama'],
    synopsis: 'Two balloonists attempt a record crossing of a desert basin while a dust storm builds behind them.',
    editions: [{edition_id: 'ed-copper-sky-theatrical', label: 'Theatrical', runtime_minutes: 112}], releases: rel('2023-08-04', 'PG-13', '12A', 'PG'), seasons: []},
  {title_id: 'tt-quiet-harbour', kind: 'film', name: 'Quiet Harbour', year: 2022, genres: ['Romance', 'Drama'],
    synopsis: 'A ferry captain and a visiting architect spend one off-season week arguing about whether the old harbour should be rebuilt.',
    editions: [{edition_id: 'ed-quiet-harbour-theatrical', label: 'Theatrical', runtime_minutes: 101}], releases: rel('2022-11-11', 'PG', 'PG', 'PG'), seasons: []},
  {title_id: 'tt-salt-year', kind: 'film', name: 'Salt Year', year: 2025, genres: ['Drama'],
    synopsis: 'Two sisters run their late father\'s salt works for one last season before the land is sold.',
    editions: [{edition_id: 'ed-salt-year-theatrical', label: 'Theatrical', runtime_minutes: 118}, {edition_id: 'ed-salt-year-extended', label: 'Extended', runtime_minutes: 142}],
    releases: rel('2025-05-09', 'PG-13', '12A', 'PG'), seasons: []},
  {title_id: 'tt-wrenfield-clock', kind: 'film', name: 'The Wrenfield Clock', year: 2019, genres: ['Mystery', 'Family'],
    synopsis: 'A clockmaker\'s apprentice finds that the town clock has been running eleven minutes slow on purpose.',
    editions: [{edition_id: 'ed-wrenfield-clock-theatrical', label: 'Theatrical', runtime_minutes: 95}], releases: rel('2019-03-22', 'PG', 'PG', 'PG'), seasons: []},
  {title_id: 'tt-pellmoor-junction', kind: 'film', name: 'Pellmoor Junction', year: 2026, genres: ['Comedy', 'Drama'],
    synopsis: 'Snowed in at a rural rail junction, eight strangers have one night to decide who gets the last seat on the morning train.',
    editions: [{edition_id: 'ed-pellmoor-junction-theatrical', label: 'Theatrical', runtime_minutes: 108}], releases: rel('2026-05-15', 'PG-13', '12A', 'PG'), seasons: []},
  {title_id: 'tt-ambervane', kind: 'film', name: 'Ambervane', year: 2026, genres: ['Science fiction'],
    synopsis: 'An engineer on a weather station notices the forecasts have started arriving a day before the weather.',
    editions: [{edition_id: 'ed-ambervane-theatrical', label: 'Theatrical', runtime_minutes: 116}], releases: rel('2026-02-20', 'PG-13', '12A', 'PG'), seasons: []},
  {title_id: 'tt-marrow-bay', kind: 'film', name: 'Marrow Bay', year: 2021, genres: ['Thriller'],
    synopsis: 'A marine biologist counting seals on a remote island finds a boat that should not be there.',
    editions: [{edition_id: 'ed-marrow-bay-theatrical', label: 'Theatrical', runtime_minutes: 99}], releases: rel('2021-09-24', 'R', '15', '14A'), seasons: []},
  {title_id: 'tt-harbor-lights', kind: 'series', name: 'Harbor Lights', year: 2025, genres: ['Mystery', 'Drama'],
    synopsis: 'A harbourmaster returns to her coastal hometown after twenty years and finds its lighthouse dark and its council hiding something.',
    editions: [{edition_id: 'ed-harbor-lights-series', label: 'Series', runtime_minutes: 52}], releases: rel('2025-09-05', 'TV-14', '12', '14A'),
    seasons: seasonsOf([[1, 'Season 1', Z('2025-09-01')], [2, 'Season 2', Z('2026-09-01')]])},
  {title_id: 'tt-pocket-comets', kind: 'series', name: 'Pocket Comets', year: 2026, genres: ['Animation', 'Family'],
    synopsis: 'Three friends build a backyard observatory and keep finding small comets that need returning to the sky.',
    editions: [{edition_id: 'ed-pocket-comets-series', label: 'Series', runtime_minutes: 22}], releases: rel('2026-02-06', 'TV-Y7', 'U', 'G'),
    seasons: seasonsOf([[1, 'Season 1', Z('2026-02-01')]])},
];
const named = Object.fromEntries(NAMED.map(t => [t.title_id, t]));

const HARBOR_EPISODES = [
  [1, 1, 'Low Tide', 'Harbourmaster Wren Calder comes home to Saltmere and finds the lighthouse dark.', '2025-09-05'],
  [1, 2, 'Signal Fires', 'A fishing boat goes missing in fog and Wren clashes with the council over the old beacon.', '2025-09-12'],
  [1, 3, 'The Keeper\'s Log', 'Wren finds pages torn from her father\'s logbook for the night the ferry sank.', '2025-09-19'],
  [1, 4, 'Undertow', 'The missing captain turns up alive with a story that does not match the tide charts.', '2025-09-26'],
  [1, 5, 'Breakwater', 'Wren learns that the council chair paid to keep the lighthouse dark.', '2025-10-03'],
  [1, 6, 'Harbor Lights', 'Wren relights the beacon and proves her father\'s ferry was sabotaged by the council chair.', '2025-10-10'],
  [2, 1, 'New Moorings', 'A year later, a developer arrives with plans for the empty harbour sheds.', '2026-09-04'],
  [2, 2, 'Slack Water', 'Wren\'s deputy is offered a job by the developer.', '2026-09-11'],
  [2, 3, 'Ballast', 'Divers find crates hidden under the old ferry pier.', '2026-09-18'],
  [2, 4, 'Riptide', 'The deputy disappears the night before the planning vote.', '2026-09-25'],
  [2, 5, 'Spring Tide', 'The crates are traced to Wren\'s own family boatyard.', '2026-10-02'],
  [2, 6, 'Landfall', 'Wren\'s brother confesses and the development is cancelled.', '2026-10-09'],
];
const COMET_EPISODES = [
  [1, 1, 'First Light', 'Pip, Odo and Fern finish building their backyard observatory.', '2026-02-06'],
  [1, 2, 'The Shy Comet', 'A tiny comet hides in the garden shed and will not come out.', '2026-02-13'],
  [1, 3, 'Tail Feathers', 'The friends try to fix a comet whose tail has come loose.', '2026-02-20'],
  [1, 4, 'Moonlight Picnic', 'A picnic under the full moon turns into a rescue.', '2026-02-27'],
  [1, 5, 'Star Swap', 'Odo trades his telescope for a map that may be fake.', '2026-03-06'],
  [1, 6, 'The Big Cloud', 'A week of clouds means no comets, until Fern has an idea.', '2026-03-13'],
  [1, 7, 'Lost Orbit', 'A comet loses its way home and Pip has to guide it.', '2026-03-20'],
  [1, 8, 'Sky Return', 'The friends release every comet at once and the observatory is nearly lost.', '2026-03-27'],
];

// ---- Generate the catalog -----------------------------------------------------------------
const titles = [], usedNames = new Set(NAMED.map(t => t.name));
const places = shuffle(PLACE_A.flatMap(a => PLACE_B.map(b => a + b)));
let placeAt = 0;
function newName(patterns) {
  for (;;) {const name = pick(patterns).replace('{P}', places[placeAt++ % places.length]); if (!usedNames.has(name)) {usedNames.add(name); return name;}}
}
const genFilms = 151, genSeries = 22;
for (let i = 0; i < genFilms + genSeries; i++) {
  const kind = i < genFilms ? 'film' : 'series';
  const name = newName(kind === 'film' ? FILM_PATTERNS : SERIES_PATTERNS);
  const year = kind === 'film' ? int(1978, 2026) : int(2012, 2026);
  const date = year + '-' + pad(int(1, year === 2026 ? 9 : 12), 2) + '-' + pad(int(1, 28), 2);
  const genres = shuffle(GENRES).slice(0, int(1, 3));
  const level = genres.includes('Family') || genres.includes('Animation') ? int(0, 1) : int(1, 3);
  const id = 'tt-' + slug(name);
  const runtime = kind === 'film' ? int(82, 158) : int(22, 58);
  const editions = [{edition_id: 'ed-' + slug(name) + (kind === 'film' ? '-theatrical' : '-series'), label: kind === 'film' ? 'Theatrical' : 'Series', runtime_minutes: runtime}];
  const t = {title_id: id, kind, name, year, genres,
    synopsis: 'In ' + places[(placeAt + 7) % places.length] + ', ' + pick(WHO) + ' ' + pick(GOAL) + '. ' + pick(SNAG),
    editions, releases: [], seasons: []};
  for (const region of ['US', 'UK', 'CA']) t.releases.push({region, date: region === 'UK' ? day(date, int(0, 21)) : date, certification: certFor(kind, region, level)});
  t.level = level; titles.push(t);
}
// 39 generated films get a second edition; with Salt Year that makes 40 titles with two editions.
const SECOND = [['Extended', 18, 34], ['Director\'s cut', 6, 22], ['Restored', 0, 3]];
for (const t of titles.filter(t => t.kind === 'film').slice(0, 39)) {
  const [label, lo, hi] = pick(SECOND), base = t.editions[0];
  t.editions.push({edition_id: base.edition_id.replace('-theatrical', '-' + slug(label)), label, runtime_minutes: base.runtime_minutes + int(lo, hi)});
}
const allTitles = [...NAMED.map(t => ({...t, level: LEVEL[t.releases[0].certification]})), ...titles];
const byId = new Map(allTitles.map(t => [t.title_id, t]));
const films = titles.filter(t => t.kind === 'film'), series = titles.filter(t => t.kind === 'series');

// Episodes: the two named series, then 22 generated series with about 280 episodes.
const episodes = [];
const addEpisode = (t, s, n, name, synopsis, air_date, runtime) =>
  episodes.push({episode_id: 'ep-' + t.title_id.slice(3) + '-s' + s + 'e' + n, title_id: t.title_id, season_number: s, number: n, name, synopsis, air_date, runtime_minutes: runtime});
for (const [s, n, name, syn, date] of HARBOR_EPISODES) addEpisode(named['tt-harbor-lights'], s, n, name, syn, date, 52);
for (const [s, n, name, syn, date] of COMET_EPISODES) addEpisode(named['tt-pocket-comets'], s, n, name, syn, date, 22);
const EP_NAMES = ['Arrivals', 'The Vote', 'Crosswind', 'Open House', 'Night Shift', 'Thaw', 'Inventory', 'The Long Table', 'Fault Lines', 'Homecoming',
  'Dead Reckoning', 'The Audit', 'Lanterns', 'Second Chances', 'Close Call', 'Headwind'];
let episodeBudget = 280;
series.forEach((t, i) => {
  const remaining = series.length - i, seasons = Math.max(1, Math.min(3, Math.round(episodeBudget / remaining / 6)));
  const start = t.releases[0].date;
  for (let s = 1; s <= seasons; s++) {
    const count = Math.max(4, Math.min(8, Math.round(episodeBudget / remaining / seasons)));
    const seasonStart = s === 1 ? start : day(start, 365 * (s - 1));
    if (seasonStart > '2026-10-31') break;
    t.seasons.push({season_number: s, name: 'Season ' + s, added_at: Z(day(seasonStart, -5))});
    for (let n = 1; n <= count; n++) {
      const air = day(seasonStart, 7 * (n - 1));
      const spoiler = n === count;
      addEpisode(t, s, n, pick(EP_NAMES), (spoiler ? pick(EP_SPOILER) : pick(EP_ACTION)), air, t.editions[0].runtime_minutes);
      episodeBudget--;
    }
  }
});

// People and credits: about 900 invented people and 2,500 credits.
const people = [], usedPeople = new Set();
while (people.length < 900) {
  const name = pick(FIRST) + ' ' + pick(SUR_A) + pick(SUR_B);
  if (usedPeople.has(name)) continue;
  usedPeople.add(name); people.push({person_id: 'pp-' + pad(people.length + 1, 4), name});
}
const credits = [];
let personCursor = 0;
const nextPerson = () => people[(personCursor++ < people.length ? personCursor - 1 : int(0, people.length - 1))].person_id;
const character = () => pick(FIRST) + ' ' + pick(SUR_A) + pick(SUR_B);
for (const t of allTitles) {
  const crew = [['director', 1], ['writer', int(1, 2)], ['composer', 1], ['cinematographer', t.kind === 'film' ? 1 : 0], ['editor', chance(0.5) ? 1 : 0], ['producer', chance(0.4) ? 1 : 0]];
  let billing = 1;
  const cast = int(7, 9);
  for (let i = 0; i < cast; i++) credits.push({title_id: t.title_id, person_id: nextPerson(), role: 'actor', character: character(), billing_order: billing++});
  for (const [role, n] of crew) for (let i = 0; i < n; i++) credits.push({title_id: t.title_id, person_id: nextPerson(), role, character: null, billing_order: billing++});
}
credits.forEach((c, i) => {c.credit_id = 'cr-' + pad(i + 1, 5);});
const creditRows = credits.map(c => ({credit_id: c.credit_id, title_id: c.title_id, person_id: c.person_id, role: c.role, character: c.character, billing_order: c.billing_order}));
// The pending correction targets a character name on Pellmoor Junction.
const pellmoorLead = creditRows.find(c => c.title_id === 'tt-pellmoor-junction' && c.role === 'actor' && c.billing_order === 2);
pellmoorLead.character = 'Marta Kesling';

// Parental guides: every title has version 1; about 60 titles carry a later version from 2026.
const emptyCategory = c => ({severity: 'none', summary: SUMMARY[c].none, items: []});
function guideV1(t) {
  const categories = {};
  let n = 0;
  for (const c of ['violence', 'language', 'sexual_content', 'frightening', 'substances']) {
    const sev = t.level === 0 ? (chance(0.5) ? 'none' : 'mild') : pick(['none', 'mild', 'mild', 'moderate', t.level >= 3 ? 'severe' : 'moderate'].slice(0, 2 + t.level));
    if (sev === 'none') {categories[c] = emptyCategory(c); continue;}
    const items = [{item_id: 'gi-' + t.title_id.slice(3) + '-' + (++n), text: pick(GUIDE_TEXT[c][sev]), spoiler: false}];
    if (chance(0.18)) items.push({item_id: 'gi-' + t.title_id.slice(3) + '-' + (++n), text: SPOILER_ITEMS[c], spoiler: true});
    categories[c] = {severity: sev, summary: SUMMARY[c][sev], items};
  }
  return categories;
}
const guides = [];
const lanternV1 = {
  violence: {severity: 'mild', summary: 'Brief scuffles between children and a fall from a ladder.', items: [{item_id: 'gi-lh-ladder', text: 'A boy falls from a hayloft ladder and sprains his wrist.', spoiler: false}]},
  language: {severity: 'mild', summary: 'Occasional mild insults.', items: []},
  sexual_content: {severity: 'none', summary: 'No sexual content.', items: []},
  frightening: {severity: 'mild', summary: 'A few tense moments in the dark.', items: [{item_id: 'gi-lh-storm', text: 'A night thunderstorm knocks out the farm\'s power.', spoiler: false}]},
  substances: {severity: 'mild', summary: 'Adults drink wine at the festival supper.', items: []},
};
const harborV1 = {
  violence: {severity: 'moderate', summary: 'Some realistic violence.', items: [{item_id: 'gi-hl-fight', text: 'A fight on the quay leaves a fisherman with a broken nose.', spoiler: false},
    {item_id: 'gi-hl-sabotage', text: 'The season 1 finale reveals the ferry was sabotaged and its crew drowned.', spoiler: true}]},
  language: {severity: 'mild', summary: 'Mild language.', items: []},
  sexual_content: {severity: 'mild', summary: 'Brief romance.', items: []},
  frightening: {severity: 'moderate', summary: 'Sustained peril at sea.', items: [{item_id: 'gi-hl-storm', text: 'A long sequence of a small boat caught in a storm.', spoiler: false}]},
  substances: {severity: 'mild', summary: 'Some social drinking.', items: []},
};
for (const t of allTitles) {
  const published = Z(day(t.releases[0].date, -30));
  const categories = t.title_id === 'tt-lantern-hill' ? lanternV1 : t.title_id === 'tt-harbor-lights' ? harborV1 : guideV1(t);
  guides.push({title_id: t.title_id, versions: [{version: 1, reason: 'seed', published_at: published, categories}]});
}
for (const t of allTitles) {
  const v1 = guides.find(x => x.title_id === t.title_id).versions[0].categories;
  if (t.level < 3 || Object.values(v1).some(cat => cat.severity === 'moderate' || cat.severity === 'severe')) continue;
  const name = v1.violence.severity !== 'none' ? 'violence' : 'language';
  v1[name].severity = 'moderate'; v1[name].summary = SUMMARY[name].moderate;
  v1[name].items.push({item_id: 'gi-' + t.title_id.slice(3) + '-m', text: GUIDE_TEXT[name].moderate[0], spoiler: false});
}
const guideOf = new Map(guides.map(g => [g.title_id, g]));
function addGuideVersion(titleId, at, reason, mutate) {
  const g = guideOf.get(titleId), prev = g.versions[g.versions.length - 1], categories = structuredClone(prev.categories);
  mutate(categories, titleId);
  g.versions.push({version: prev.version + 1, reason, published_at: at, categories});
}
function bump(categories, titleId) {
  const c = pick(['violence', 'language', 'frightening', 'substances']), order = ['none', 'mild', 'moderate', 'severe'];
  const sev = order[Math.min(3, order.indexOf(categories[c].severity) + 1)];
  categories[c].severity = sev; categories[c].summary = SUMMARY[c][sev];
  const n = Object.values(categories).reduce((m, x) => m + x.items.length, 0) + 10;
  categories[c].items.push({item_id: 'gi-' + titleId.slice(3) + '-' + n, text: pick(GUIDE_TEXT[c][sev === 'none' ? 'mild' : sev]), spoiler: false});
}

// ---- Watchlists, households and diary pools ------------------------------------------------
const stableFilms = films.filter(t => t.releases[0].date < '2024-06-01');
const danaWatch = shuffle(stableFilms).slice(0, 8), danaSeries = series.slice(0, 2);
// Dana's 14-title watchlist: three leaving titles among eleven that are not leaving this week.
const g = [...danaWatch, ...danaSeries];
const danaWatchlist = [g[0].title_id, 'tt-fieldglass', g[1].title_id, g[2].title_id, 'tt-copper-sky', g[3].title_id, 'tt-harbor-lights', g[4].title_id,
  'tt-quiet-harbour', g[5].title_id, g[8].title_id, g[6].title_id, g[9].title_id, g[7].title_id];
const inesExtra = shuffle(stableFilms.filter(t => !danaWatch.includes(t))).slice(0, 6);
const inesWatchlist = [inesExtra[0].title_id, 'tt-copper-sky', inesExtra[1].title_id, 'tt-fieldglass', 'tt-quiet-harbour', 'tt-harbor-lights',
  inesExtra[2].title_id, inesExtra[3].title_id, g[0].title_id, inesExtra[4].title_id];
// About 60 later guide versions, all dated in 2026; one is the watchlist title behind Dana's guide notice.
const watchGuideTitle = g[0].title_id;
addGuideVersion(watchGuideTitle, Z('2026-09-12', '17:00'), 'published_update', bump);
for (const t of shuffle(titles.filter(t => t.title_id !== watchGuideTitle)).slice(0, 59)) {
  addGuideVersion(t.title_id, Z('2026-' + pad(int(1, 11), 2) + '-' + pad(int(1, 28), 2), '16:00'), chance(0.35) ? 'correction_approved' : 'published_update', bump);
}

// ---- Offers -------------------------------------------------------------------------------
const offers = [];
const offer = (title_id, service_id, region, type, price, available_from, available_until = null, quality = 'HD', edition_id = null) =>
  offers.push({offer_id: null, title_id, edition_id, service_id, region, type, price: price === null ? null : price, currency: price === null ? null : CURRENCY[region],
    quality, available_from, available_until});
// Named offers. Dana is in the US with Brightreel and Northcast; Ines is in the UK with Northcast and Kettlewing.
offer('tt-lantern-hill', 'brightreel', 'US', 'subscription', null, PDT('2026-06-01'), PT('2026-12-05', '23:59'));
offer('tt-lantern-hill', 'brightreel', 'US', 'rent', 3.99, PT('2026-01-15'));
offer('tt-lantern-hill', 'kettlewing', 'UK', 'subscription', null, PDT('2026-09-01'));
offer('tt-lantern-hill', 'tinlark', 'UK', 'rent', 2.99, PT('2026-01-15'));
offer('tt-lantern-hill', 'northcast', 'CA', 'subscription', null, PDT('2026-07-01'));
offer('tt-fieldglass', 'brightreel', 'US', 'subscription', null, PT('2026-02-01'), PT('2026-12-02', '23:59'));
offer('tt-fieldglass', 'northcast', 'US', 'subscription', null, PDT('2026-08-01'));
offer('tt-fieldglass', 'kettlewing', 'UK', 'subscription', null, PDT('2026-05-01'), '2026-12-03T23:59:00Z');
offer('tt-fieldglass', 'tinlark', 'UK', 'rent', 3.49, PT('2026-01-10'));
offer('tt-fieldglass', 'plumvale', 'CA', 'subscription', null, PT('2026-03-01'));
offer('tt-copper-sky', 'brightreel', 'US', 'subscription', null, PDT('2026-04-01'), PT('2026-12-04', '23:59'));
offer('tt-copper-sky', 'brightreel', 'US', 'rent', 4.99, PT('2026-01-05'));
offer('tt-copper-sky', 'openfern', 'US', 'free_with_ads', null, PDT('2026-09-01'), null, 'SD');
offer('tt-copper-sky', 'northcast', 'UK', 'subscription', null, PDT('2026-06-15'));
offer('tt-copper-sky', 'plumvale', 'CA', 'subscription', null, PT('2026-02-01'));
offer('tt-quiet-harbour', 'brightreel', 'US', 'subscription', null, PDT('2026-05-01'), PT('2026-12-06', '23:59'));
offer('tt-quiet-harbour', 'plumvale', 'US', 'subscription', null, PDT('2026-10-01'));
offer('tt-quiet-harbour', 'tinlark', 'US', 'rent', 3.49, PT('2026-01-20'));
offer('tt-quiet-harbour', 'northcast', 'UK', 'subscription', null, PDT('2026-04-01'));
offer('tt-quiet-harbour', 'kettlewing', 'CA', 'subscription', null, PDT('2026-04-01'));
offer('tt-salt-year', 'northcast', 'US', 'subscription', null, PDT('2026-03-15'), null, 'HD', 'ed-salt-year-theatrical');
offer('tt-salt-year', 'tinlark', 'US', 'rent', 5.99, PDT('2026-03-15'), null, '4K', 'ed-salt-year-extended');
offer('tt-salt-year', 'tinlark', 'US', 'buy', 17.99, PDT('2026-03-15'), null, '4K', 'ed-salt-year-extended');
offer('tt-salt-year', 'kettlewing', 'UK', 'subscription', null, PDT('2026-04-01'), null, 'HD', 'ed-salt-year-theatrical');
offer('tt-salt-year', 'brightreel', 'CA', 'subscription', null, PDT('2026-04-01'));
offer('tt-wrenfield-clock', 'northcast', 'US', 'subscription', null, PT('2026-01-01'));
offer('tt-wrenfield-clock', 'northcast', 'UK', 'subscription', null, PT('2026-01-01'));
offer('tt-wrenfield-clock', 'openfern', 'UK', 'free_with_ads', null, PDT('2026-06-01'), null, 'SD');
offer('tt-pellmoor-junction', 'brightreel', 'US', 'subscription', null, PDT('2026-09-15'));
offer('tt-pellmoor-junction', 'tinlark', 'US', 'rent', 5.99, PDT('2026-07-01'));
offer('tt-pellmoor-junction', 'kettlewing', 'UK', 'rent', 4.99, PDT('2026-07-08'));
offer('tt-ambervane', 'northcast', 'US', 'subscription', null, PT('2026-12-03'));
offer('tt-ambervane', 'tinlark', 'US', 'rent', 4.99, PT('2026-04-01'));
offer('tt-ambervane', 'kettlewing', 'UK', 'subscription', null, PDT('2026-05-01'));
offer('tt-marrow-bay', 'brightreel', 'US', 'subscription', null, PDT('2026-06-10'), PT('2026-12-09', '23:59'));
offer('tt-marrow-bay', 'tinlark', 'US', 'rent', 3.99, PT('2026-02-01'));
offer('tt-marrow-bay', 'northcast', 'UK', 'subscription', null, PDT('2026-06-10'));
offer('tt-harbor-lights', 'northcast', 'US', 'subscription', null, PDT('2025-09-05'));
offer('tt-harbor-lights', 'kettlewing', 'UK', 'subscription', null, PDT('2025-09-12'));
offer('tt-harbor-lights', 'northcast', 'CA', 'subscription', null, PDT('2025-09-05'));
offer('tt-pocket-comets', 'northcast', 'US', 'subscription', null, PT('2026-02-06'));
offer('tt-pocket-comets', 'northcast', 'UK', 'subscription', null, PT('2026-02-13'));
offer('tt-pocket-comets', 'openfern', 'US', 'free_with_ads', null, PDT('2026-06-01'), null, 'SD');
// The seeded triggered alert for Dana fired on this offer's arrival in April 2026.
const alertedTitle = g[10] || stableFilms.find(t => !danaWatch.includes(t) && !inesExtra.includes(t));
offer(alertedTitle.title_id, 'northcast', 'US', 'subscription', null, Z('2026-04-14', '15:00'));

// Generated offers never start or end between 2026-11-15 and 2026-12-31, so only the named
// titles change availability during the December scenario.
const SUB = {US: ['brightreel', 'northcast', 'plumvale'], UK: ['brightreel', 'northcast', 'kettlewing'], CA: ['brightreel', 'northcast', 'plumvale', 'kettlewing']};
const RENT = {US: ['tinlark', 'brightreel'], UK: ['tinlark', 'brightreel', 'kettlewing'], CA: ['tinlark', 'brightreel', 'kettlewing']};
const early = () => Z('2026-' + pad(int(1, 10), 2) + '-' + pad(int(1, 28), 2));
const late = () => Z('2027-' + pad(int(1, 9), 2) + '-' + pad(int(1, 28), 2));
const price = (lo, hi, region) => Math.round((lo + R() * (hi - lo)) * (region === 'CA' ? 1.25 : 1)) - 0.01;
for (const t of [...titles].filter(t => t !== alertedTitle)) {
  const releasedBy2026 = t.releases[0].date < '2026-01-01';
  for (const region of ['US', 'UK', 'CA']) {
    const regional = region === 'US' || chance(0.88);
    if (!regional) continue;
    const drawn = releasedBy2026 ? Z('2025-' + pad(int(1, 12), 2) + '-' + pad(int(1, 28), 2)) : Z(day(t.releases[0].date, 30));
    const released = Z(t.releases.find(r => r.region === region).date);
    const from = drawn < released ? released : drawn; // no offer before the regional release
    // A subscription window: ended earlier in 2026, current, or upcoming in 2027.
    const shape = pick(['ended-then-current', 'current', 'current', 'ended', 'upcoming', 'none']);
    const svc = pick(SUB[region]);
    if (shape === 'ended-then-current' || shape === 'ended') {
      const end = early(), ended = from < end; // skip a window that would close before the title was released
      if (ended) offer(t.title_id, svc, region, 'subscription', null, from, end);
      if (shape === 'ended-then-current') {
        const next = pick(SUB[region].filter(s => s !== svc)), until = chance(0.3) ? late() : null;
        offer(t.title_id, next, region, 'subscription', null, ended ? end : from, until);
      }
    } else if (shape === 'current') offer(t.title_id, svc, region, 'subscription', null, from, chance(0.25) ? late() : null);
    else if (shape === 'upcoming') offer(t.title_id, svc, region, 'subscription', null, late(), null);
    // Rentals and purchases, sometimes with a price change during 2026.
    if (chance(0.8)) {
      const store = pick(RENT[region]), start = from < '2026-01-01' ? Z('2026-01-02') : from;
      if (chance(0.25)) {
        const change = early(), before = price(4, 6, region), after = price(2, 4, region);
        if (start < change) {offer(t.title_id, store, region, 'rent', before, start, change); offer(t.title_id, store, region, 'rent', after, change);}
        else offer(t.title_id, store, region, 'rent', after, start);
      }
      else offer(t.title_id, store, region, 'rent', price(3, 6, region), start);
      if (store !== 'kettlewing' && chance(0.7)) offer(t.title_id, store, region, 'buy', price(10, 20, region), start, null, chance(0.3) ? '4K' : 'HD');
    }
    if (region !== 'CA' && chance(0.12)) offer(t.title_id, region === 'US' && chance(0.5) ? 'northcast' : 'openfern', region, 'free_with_ads', null, from, null, 'SD');
  }
}
offers.forEach((o, i) => {o.offer_id = 'of-' + pad(i + 1, 5);});
for (const o of offers) {
  if (o.available_until !== null && o.available_until < o.available_from) throw Error('bad window ' + o.offer_id);
}

// ---- Public reviews -------------------------------------------------------------------------
const publicReviews = [];
for (const t of allTitles) {
  if (t.title_id === 'tt-pellmoor-junction' || chance(0.3)) continue;
  for (let i = 0, n = int(1, 2); i < n; i++) {
    const spoiler = chance(0.12), released = t.releases[0].date;
    const posted = released > '2026-06-01' ? day(released, int(5, 60)) : day('2025-01-01', int(0, 650));
    publicReviews.push({review_id: 'rv-' + pad(publicReviews.length + 1, 4), title_id: t.title_id, author: pick(HANDLES), rating: int(2, 10) / 2,
      text: spoiler ? pick(SPOILER_REVIEW) : pick(REVIEW_TEXT), contains_spoilers: spoiler, posted_at: Z(posted < released ? released : posted, '19:00')});
  }
}
publicReviews.push({review_id: 'rv-lh-01', title_id: 'tt-lantern-hill', author: 'quietrowseat', rating: 4,
  text: 'Lovely, but the barn sequence near the end was too much for my seven-year-old.', contains_spoilers: true, posted_at: PT('2025-10-20', '21:00')});

// ---- Diaries ------------------------------------------------------------------------------
const epOf = t => episodes.filter(e => e.title_id === t);
function ratingsBag(counts) {return shuffle(Object.entries(counts).flatMap(([r, n]) => Array(n).fill(Number(r))));}
function diary(owner, entries, bag, people, poolFilms, poolSeries, start, end, size, rng) {
  const out = entries.slice();
  const days = [];
  for (let d = start; d <= end; d = day(d, 1)) days.push(d);
  const pickDays = shuffle(days).slice(0, size - out.length).sort();
  const seriesProgress = new Map();
  for (const watched_on of pickDays) {
    const useSeries = chance(0.22);
    let title_id, episode_ids = [];
    if (useSeries) {
      const candidates = poolSeries.filter(t => epOf(t.title_id).some(e => e.air_date <= watched_on));
      if (!candidates.length) continue;
      const t = pick(candidates), eps = epOf(t.title_id).filter(e => e.air_date <= watched_on), at = seriesProgress.get(t.title_id) || 0;
      if (at >= eps.length) continue;
      seriesProgress.set(t.title_id, at + 1); title_id = t.title_id; episode_ids = [eps[at].episode_id];
    } else {
      const candidates = poolFilms.filter(t => t.releases.every(r => r.date <= watched_on));
      title_id = pick(candidates).title_id;
    }
    const t = byId.get(title_id), family = t.genres.includes('Family') || t.genres.includes('Animation');
    const watched_with = rng(family);
    out.push({title_id, episode_ids, edition_id: null, watched_on, rewatch: false, watched_with, rating: null, review: null});
  }
  out.sort((a, b) => a.watched_on.localeCompare(b.watched_on));
  const seen = new Set();
  for (const e of out) {
    const key = e.title_id + '|' + e.episode_ids.join(',');
    if (e.rewatch === false && seen.has(key)) e.rewatch = true;
    seen.add(key);
  }
  let r = 0;
  out.forEach((e, i) => {
    e.entry_id = 'de-' + pad(i + 1, 4);
    if (e.rating === null) e.rating = bag[r++];
    if (e.review === null && e.episode_ids.length === 0 && chance(0.2)) {
      const spoiler = chance(0.15);
      e.review = {text: spoiler ? pick(SPOILER_REVIEW) : pick(REVIEW_TEXT), contains_spoilers: spoiler, visibility: pick(['private', 'friends', 'public'])};
    }
    e.logged_at = Z(day(e.watched_on, 1), '05:30'); e.updated_at = e.logged_at;
  });
  return out.map(e => ({entry_id: e.entry_id, title_id: e.title_id, episode_ids: e.episode_ids, edition_id: e.edition_id, watched_on: e.watched_on,
    rewatch: e.rewatch, watched_with: e.watched_with, rating: e.rating, review: e.review, logged_at: e.logged_at, updated_at: e.updated_at}));
}
const danaFixed = [
  {title_id: 'tt-wrenfield-clock', episode_ids: [], edition_id: 'ed-wrenfield-clock-theatrical', watched_on: '2025-11-14', rewatch: false, watched_with: ['person-jules'], rating: 4,
    review: {text: 'Still the cosiest mystery I know. The clock tower set is wonderful.', contains_spoilers: false, visibility: 'friends'}},
  ...COMET_EPISODES.slice(0, 4).map(([s, n], i) => ({title_id: 'tt-pocket-comets', episode_ids: ['ep-pocket-comets-s1e' + n], edition_id: null,
    watched_on: ['2026-10-03', '2026-10-10', '2026-10-17', '2026-10-24'][i], rewatch: false, watched_with: ['person-jules', 'person-mira'], rating: [3.5, 3, 3.5, 4][i], review: null})),
  {title_id: 'tt-pocket-comets', episode_ids: ['ep-pocket-comets-s1e5'], edition_id: null, watched_on: '2026-11-07', rewatch: false, watched_with: ['person-jules'], rating: 3.5, review: null},
];
// Dana: 250 rated entries, half stars, never 5, mean 3.4 (the six fixed entries sum to 21.5).
const danaBag = ratingsBag({1.5: 5, 2: 12, 2.5: 24, 3: 54, 3.5: 64, 4: 63, 4.5: 22});
const avoid = new Set([...NAMED.map(t => t.title_id), ...danaWatchlist]);
const danaFilms = films.filter(t => !avoid.has(t.title_id)), danaSeriesPool = series.filter(t => !avoid.has(t.title_id));
const danaDiary = diary('person-dana', danaFixed, danaBag, null, danaFilms, danaSeriesPool, '2025-01-03', '2026-11-22', 250,
  family => family ? (chance(0.7) ? ['person-jules', 'person-mira'] : ['person-mira']) : (chance(0.45) ? ['person-jules'] : []));
// Ines: 60 entries in whole stars, including 5s, mean about 3.8. She saw Salt Year's theatrical edition in 2025.
const inesFixed = [{title_id: 'tt-salt-year', episode_ids: [], edition_id: 'ed-salt-year-theatrical', watched_on: '2025-06-21', rewatch: false, watched_with: ['person-tomas'], rating: 4, review: null}];
const inesBag = ratingsBag({1: 1, 2: 3, 3: 16, 4: 25, 5: 14});
const inesFilms = films.filter(t => !avoid.has(t.title_id) && !inesWatchlist.includes(t.title_id));
const inesDiary = diary('person-ines', inesFixed, inesBag, null, inesFilms, danaSeriesPool, '2025-02-01', '2026-11-20', 60, () => (chance(0.4) ? ['person-tomas'] : []));

// ---- Dana's account state -----------------------------------------------------------------
const of = (title, service, region, type) => offers.find(o => o.title_id === title && o.service_id === service && o.region === region && o.type === type);
const snap = o => ({offer_id: o.offer_id, service_id: o.service_id, region: o.region, type: o.type, price: o.price, currency: o.currency,
  available_from: o.available_from, available_until: o.available_until});
const alerted = of(alertedTitle.title_id, 'northcast', 'US', 'subscription');
const lists = [
  {list_id: 'ls-01', name: 'Rainy Sunday films', description: 'Long, slow and comforting.', visibility: 'private', version: 1,
    title_ids: shuffle(danaFilms).slice(0, 8).map(t => t.title_id), created_at: Z('2025-03-02', '20:00'), updated_at: Z('2025-03-02', '20:00')},
  {list_id: 'ls-02', name: 'Family night with Mira', description: 'Checked against the parental guide first.', visibility: 'friends', version: 3,
    title_ids: ['tt-pocket-comets', 'tt-wrenfield-clock', ...films.filter(t => t.genres.includes('Family') && t.level <= 1).slice(0, 4).map(t => t.title_id)],
    created_at: Z('2025-06-14', '18:00'), updated_at: Z('2026-10-25', '18:30')},
  {list_id: 'ls-03', name: 'Best of 2025', description: 'My favourite first watches of the year.', visibility: 'public', version: 2,
    title_ids: [...new Set(danaDiary.filter(e => e.watched_on < '2026-01-01' && e.episode_ids.length === 0 && e.rating >= 4).map(e => e.title_id))].slice(0, 10),
    created_at: Z('2025-12-30', '21:00'), updated_at: Z('2026-01-04', '10:00')},
];
const correctionTitles = shuffle(films.filter(t => !avoid.has(t.title_id) && t.releases[0].date < '2020-01-01')).slice(0, 2);
const [releaseTitle, certTitle] = correctionTitles;
const usRelease = releaseTitle.releases.find(r => r.region === 'US');
const oldReleaseDate = usRelease.date;
usRelease.date = day(oldReleaseDate, -7); // Dana's approved correction moved the US date a week earlier.
for (const r of releaseTitle.releases) if (r.date < usRelease.date) r.date = usRelease.date;
const ukCert = certTitle.releases.find(r => r.region === 'UK');
ukCert.certification = '15';
const notices = [
  {notice_id: 'nt-01', at: Z('2026-04-14', '15:00'), kind: 'alert_triggered', title_id: alertedTitle.title_id, alert_id: 'al-01', correction_id: null, guide_version: null,
    event_id: 'offer-' + alertedTitle.title_id.slice(3) + '-northcast-us', text: alertedTitle.name + ' is now included with your Northcast subscription in the US.'},
  {notice_id: 'nt-02', at: Z('2026-03-20', '17:00'), kind: 'correction_decided', title_id: releaseTitle.title_id, alert_id: null, correction_id: 'co-01', guide_version: null,
    event_id: 'co-01-decision', text: 'Your release date correction for ' + releaseTitle.name + ' (US) was approved.'},
  {notice_id: 'nt-03', at: Z('2026-07-08', '16:00'), kind: 'correction_decided', title_id: certTitle.title_id, alert_id: null, correction_id: 'co-02', guide_version: null,
    event_id: 'co-02-decision', text: 'Your certification correction for ' + certTitle.name + ' (UK) was declined: The 15 certificate is the one issued for the cinema release.'},
  {notice_id: 'nt-04', at: Z('2026-09-12', '17:00'), kind: 'guide_updated', title_id: watchGuideTitle, alert_id: null, correction_id: null, guide_version: 2,
    event_id: 'guide-' + watchGuideTitle.slice(3) + '-v2', text: 'The parental guide for ' + byId.get(watchGuideTitle).name + ' was updated to version 2.'},
];
notices.sort((a, b) => a.at.localeCompare(b.at));
const alertFields = (o) => ({offer_type: null, threshold: null, expires_at: null, known_seasons: [], trigger: null, ...o});
const danaAlerts = [
  alertFields({alert_id: 'al-01', kind: 'available_on_my_services', title_id: alertedTitle.title_id, status: 'triggered', created_at: Z('2026-02-10', '20:00'), updated_at: Z('2026-04-14', '15:00'),
    trigger: {at: Z('2026-04-14', '15:00'), cause: 'event', event_id: 'offer-' + alertedTitle.title_id.slice(3) + '-northcast-us', operation: 'offer.publish', request_id: null,
      offer: snap(alerted), season_number: null, notice_id: 'nt-01'}}),
  alertFields({alert_id: 'al-02', kind: 'available_on_my_services', title_id: danaWatchlist[2], status: 'active', expires_at: PDT('2026-06-30', '23:59'),
    created_at: Z('2026-03-03', '19:00'), updated_at: Z('2026-03-03', '19:00')}),
  alertFields({alert_id: 'al-03', kind: 'price_below', title_id: danaWatchlist[3], offer_type: 'buy', threshold: 9, status: 'deleted',
    created_at: Z('2026-05-05', '19:00'), updated_at: Z('2026-08-01', '19:00')}),
  alertFields({alert_id: 'al-04', kind: 'price_below', title_id: 'tt-marrow-bay', offer_type: 'rent', threshold: 2.5, status: 'active', expires_at: PT('2026-12-02', '12:00'),
    created_at: Z('2026-11-02', '20:00'), updated_at: Z('2026-11-02', '20:00')}),
  alertFields({alert_id: 'al-05', kind: 'new_season', title_id: 'tt-pocket-comets', status: 'active', known_seasons: [1], created_at: Z('2026-10-25', '18:40'), updated_at: Z('2026-10-25', '18:40')}),
];
const correctionFields = o => ({amended_at: null, withdrawn_at: null, decisions: [], ...o});
const danaCorrections = [
  correctionFields({correction_id: 'co-01', title_id: releaseTitle.title_id, field: 'release_date', target: {region: 'US'}, proposed_value: usRelease.date, current_value: oldReleaseDate,
    evidence: 'The distributor\'s press kit and the premiere listing both give the earlier Friday.', status: 'approved', submitted_at: Z('2026-03-11', '20:00'), updated_at: Z('2026-03-20', '17:00'),
    decisions: [{decision: 'approved', note: 'Confirmed against the distributor listing.', decided_at: Z('2026-03-20', '17:00'), event_id: 'co-01-decision'}]}),
  correctionFields({correction_id: 'co-02', title_id: certTitle.title_id, field: 'certification', target: {region: 'UK'}, proposed_value: '12', current_value: '15',
    evidence: 'The home release box I own says 12.', status: 'declined', submitted_at: Z('2026-06-29', '20:00'), updated_at: Z('2026-07-08', '16:00'),
    decisions: [{decision: 'declined', note: 'The 15 certificate is the one issued for the cinema release.', decided_at: Z('2026-07-08', '16:00'), event_id: 'co-02-decision'}]}),
  correctionFields({correction_id: 'co-03', title_id: 'tt-pellmoor-junction', field: 'credit', target: {credit_id: pellmoorLead.credit_id}, proposed_value: {character: 'Marta Kessling'},
    current_value: {role: 'actor', character: 'Marta Kesling', billing_order: 2}, evidence: 'The end credits spell the character Kessling, with a double s.',
    status: 'submitted', submitted_at: Z('2026-11-20', '21:15'), updated_at: Z('2026-11-20', '21:15')}),
];

// ---- Assemble -----------------------------------------------------------------------------
const titleRows = allTitles.map(({level, ...t}) => t);
const catalog = {services, titles: titleRows, episodes, people, credits: creditRows, guides, offers, public_reviews: publicReviews};
const dana = {
  account_id: 'kinodex-dana', owner_person_id: 'person-dana', ...catalog,
  account: {region: 'US', time_zone: 'America/Los_Angeles', service_ids: ['brightreel', 'northcast'], settings_version: 3, updated_at: Z('2026-02-08', '19:00')},
  watchlist: {version: 1, title_ids: danaWatchlist, updated_at: Z('2026-11-15', '20:10')},
  diary: danaDiary, lists, alerts: danaAlerts, corrections: danaCorrections, notices, activity: [],
};
const ines = {
  account_id: 'kinodex-ines', owner_person_id: 'person-ines', ...catalog,
  account: {region: 'UK', time_zone: 'Europe/London', service_ids: ['northcast', 'kettlewing'], settings_version: 1, updated_at: Z('2025-02-01', '19:00')},
  watchlist: {version: 4, title_ids: inesWatchlist, updated_at: Z('2026-11-02', '21:00')},
  diary: inesDiary,
  lists: [{list_id: 'ls-01', name: 'Weekend picks', description: '', visibility: 'private', version: 1, title_ids: inesWatchlist.slice(0, 4),
    created_at: Z('2026-03-07', '10:00'), updated_at: Z('2026-03-07', '10:00')}],
  alerts: [], corrections: [], notices: [], activity: [],
};

// One record per line keeps the large seed reviewable and diffable.
function serialize(value) {
  const lines = Object.entries(value).map(([k, v]) => {
    if (!Array.isArray(v) || !v.length) return '  ' + JSON.stringify(k) + ': ' + JSON.stringify(v);
    return '  ' + JSON.stringify(k) + ': [\n' + v.map(x => '    ' + JSON.stringify(x)).join(',\n') + '\n  ]';
  });
  return '{\n' + lines.join(',\n') + '\n}\n';
}
const write = (file, value) => fs.writeFileSync(path.join(out, file), JSON.stringify(value, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'fixtures/minimal.json'), serialize(dana));
fs.writeFileSync(path.join(out, 'examples/task-data/seed.json'), serialize(ines));

const binding = {people: [{person_id: 'person-dana', name: 'Dana Marsh'}, {person_id: 'person-jules', name: 'Jules Marsh'}, {person_id: 'person-mira', name: 'Mira Marsh'}],
  accounts: [{app_id: 'kinodex', account_id: 'kinodex-dana', owner_person_id: 'person-dana'}], objects: {}};
const inesBinding = {people: [{person_id: 'person-ines', name: 'Ines Calloway'}, {person_id: 'person-tomas', name: 'Tomas Calloway'}],
  accounts: [{app_id: 'kinodex', account_id: 'kinodex-ines', owner_person_id: 'person-ines'}], objects: {}};
write('fixtures/binding.json', binding);
write('examples/task-data/binding.json', inesBinding);
write('fixtures/clock.json', {initial_time: CLOCK});
const reads = tools.filter(t => t.read_only).map(t => t.name), all = tools.map(t => t.name);
write('fixtures/policies.json', {scenario: {allow: reads, constraints: {}}, sandbox: {allow: all, constraints: {}}});
write('examples/task-data/policies.json', {scenario: {allow: all, constraints: {}}, sandbox: {allow: all, constraints: {}}});

// Approved proposal examples (verbatim) plus the events the walkthrough and tests apply.
const lanternEvent = {event_id: 'lantern-hill-guide-v2', at: '2026-12-04T18:00:00-08:00', operation: 'title.update', payload: {title_id: 'tt-lantern-hill',
  guide_version: {version: 2, reason: 'correction_approved', categories: {violence: {severity: 'moderate'}, frightening: {severity: 'moderate', summary: 'Sustained child peril.',
    add_items: [{item_id: 'gi-lh-barn', text: 'A long sequence in which a child is trapped in a burning barn.', spoiler: true}]}}}}};
write('examples/scenario.json', lanternEvent);
fs.mkdirSync(path.join(out, 'examples/events'), {recursive: true});
write('examples/events/salt-year-runtime-decision.json', {event_id: 'salt-year-runtime-decision', at: '2026-12-09T10:30:00-08:00', operation: 'correction.decision',
  payload: {correction_ref: {title_id: 'tt-salt-year', field: 'runtime'}, decision: 'declined', note: 'The 142-minute runtime belongs to the extended edition, which is listed separately.'}});
write('examples/events/copper-sky-northcast-return.json', {event_id: 'copper-sky-northcast-return', at: '2026-12-10T06:00:00-08:00', operation: 'offer.publish',
  payload: {offer_id: 'of-copper-sky-northcast-us-2026-12', title_id: 'tt-copper-sky', service_id: 'northcast', region: 'US', type: 'subscription', quality: 'HD',
    available_from: '2026-12-10T06:00:00-08:00', available_until: null}});
write('examples/events/copper-sky-northcast-ads.json', {event_id: 'copper-sky-northcast-ads', at: '2026-12-08T06:00:00-08:00', operation: 'offer.publish',
  payload: {offer_id: 'of-copper-sky-northcast-fwa-us', title_id: 'tt-copper-sky', service_id: 'northcast', region: 'US', type: 'free_with_ads', quality: 'SD',
    available_from: '2026-12-08T06:00:00-08:00', available_until: null}});
write('examples/events/harbor-lights-season-3.json', {event_id: 'harbor-lights-season-3', at: '2026-12-11T08:00:00-08:00', operation: 'title.update',
  payload: {title_id: 'tt-harbor-lights', add_seasons: [{season_number: 3, name: 'Season 3', episodes: [{episode_id: 'ep-harbor-lights-s3e1', number: 1, name: 'Open Water',
    synopsis: 'Wren is asked to run the lighthouse as a museum and refuses.', air_date: '2027-01-08', runtime_minutes: 52}]}]}});
write('examples/events/ambervane-northcast-start.json', {event_id: 'ambervane-northcast-start', at: '2026-12-03T10:00:00-08:00', operation: 'offer.publish',
  payload: {...of('tt-ambervane', 'northcast', 'US', 'subscription')}});
write('examples/events/fieldglass-uk-return.json', {event_id: 'fieldglass-uk-return', at: '2026-12-10T06:00:00-08:00', operation: 'offer.publish',
  payload: {offer_id: 'of-fieldglass-northcast-uk-2026-12', title_id: 'tt-fieldglass', service_id: 'northcast', region: 'UK', type: 'subscription', quality: 'HD',
    available_from: '2026-12-10T06:00:00-08:00', available_until: null}});

// Dataset provenance. Records are titles (plugin.records); both seeds share the catalog.
const dataset = id => ({
  schema_version: 'pale.dataset.v1', dataset_id: id, version: '1.0.0',
  description: 'Hand-authored and seeded-generator synthetic film and TV catalog (titles, editions, episodes, people, credits, regional certifications, versioned parental guides, six services and their offers in three regions) plus one viewer account with a watchlist, diary, lists, alerts, corrections and notices, for a December 2026 scenario. expected_counts.records counts titles (plugin.records); the seed holds about 5,400 catalog records in all. Not a benchmark task.',
  record_source_ids: ['authored'],
  sources: [{source_id: 'authored', kind: 'synthetic',
    description: 'Original fictional text authored for this package by @byshail. All titles, people, services, prices, reviews and guide text are invented; no external film, TV, streaming or review data were collected, translated or adapted.',
    uri: null, license: 'MIT', usage: 'permitted', collection: null,
    generation: {method: 'scripted', tool: 'dev/build-fixtures.cjs', tool_version: '1.0.0', seed: GENERATOR_SEED, parameters: {}}}],
  transformations: ['Bulk catalog records are expanded from hand-written word lists by the deterministic script dev/build-fixtures.cjs; the named proposal titles, offers, guides and account histories are written by hand in the same script. Both account seeds share one catalog.'],
  expected_counts: {records: titleRows.length, assets: 0},
  quality_policy: {duplicate_records: 'reject', duplicate_assets: 'reject', missing_assets: 'allow_declared'},
  review: {status: 'pending', reviewer: null, notes: 'Automated checks do not replace human review of realism, variation, name collisions and reuse permissions.'},
});
write('contribution/dataset.json', dataset('kinodex-december'));
write('examples/task-data/dataset.json', dataset('kinodex-december-ines'));

const bytes = f => fs.statSync(path.join(out, f)).size;
const mean = list => list.reduce((s, x) => s + x, 0) / list.length;
console.log(JSON.stringify({titles: titleRows.length, films: titleRows.filter(t => t.kind === 'film').length, series: titleRows.filter(t => t.kind === 'series').length,
  episodes: episodes.length, people: people.length, credits: creditRows.length, two_editions: titleRows.filter(t => t.editions.length === 2).length,
  guide_versions: guides.reduce((n, x) => n + x.versions.length, 0), titles_with_later_versions: guides.filter(x => x.versions.length > 1).length,
  offers: offers.length, public_reviews: publicReviews.length, dana_diary: danaDiary.length, dana_mean: mean(danaDiary.map(e => e.rating)),
  ines_diary: inesDiary.length, ines_mean: mean(inesDiary.map(e => e.rating)),
  bytes: {minimal: bytes('fixtures/minimal.json'), ines: bytes('examples/task-data/seed.json'),
    minimal_compact: Buffer.byteLength(JSON.stringify(dana)), ines_compact: Buffer.byteLength(JSON.stringify(ines))}}, null, 1));
