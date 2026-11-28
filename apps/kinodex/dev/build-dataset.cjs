'use strict';
// Maintainer script (not run by the verifier). Builds the Kinodex evaluation dataset in data/evaluation/:
// the shared catalog and Dana Marsh's account covering 2025-01-01 through 2026-12-31 (America/Los_Angeles).
// It starts from fixtures/minimal.json and keeps every fixture record, ID and date. The fixture draws its
// public and diary review texts and its generated episode synopses from short phrase lists, so those texts
// are rewritten here, one per record, for that title, rating and date. It then adds dated records: Dana's
// alerts, corrections, notices and lists across both years, parental-guide updates, one season that starts
// in November and one added in December, and public reviews to Dec. 30, 2026. Dana's private history
// ends at the fixture clock; catalog records after it appear when the run clock reaches them.
// Deterministic: the same script writes the same bytes. Usage, from the package directory:
//   node dev/build-dataset.cjs
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const pkg = path.resolve(__dirname, '..');
const outDir = path.join(pkg, 'data/evaluation');
const read = file => JSON.parse(fs.readFileSync(path.join(pkg, file), 'utf8'));
const fixture = read('fixtures/minimal.json'), binding = read('fixtures/binding.json');
const CLOCK = read('fixtures/clock.json').initial_time; // 2026-12-01T09:00:00-08:00: Dana's history ends here
const plugin = require('../plugin.cjs'), c = require('../src/catalog.cjs'), rules = require('../src/rules.cjs');
const {compile} = require('../tests/schema-validator.cjs');
const DATASET_VERSION = '1.0.0', GENERATOR_SEED = 20250101, TIME_ZONE = 'America/Los_Angeles', WINDOW = ['2025-01-01', '2026-12-31'];

// ---------- deterministic helpers ----------
let state = GENERATOR_SEED;
const rand = () => {state |= 0; state = state + 0x6D2B79F5 | 0; let t = Math.imul(state ^ state >>> 15, 1 | state);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296;};
const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = list => list[Math.floor(rand() * list.length)];
const chance = p => rand() < p;
const shuffle = list => {const a = [...list]; for (let i = a.length - 1; i > 0; i--) {const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]];} return a;};
const pad = (n, w = 2) => String(n).padStart(w, '0');
const slug = id => id.replace(/^tt-/, '');

// ---------- calendar in America/Los_Angeles (DST: second Sunday of March to first Sunday of November) ----------
const DAY = 86400000;
const ymd = ms => new Date(ms).toISOString().slice(0, 10);
const dateMs = d => Date.parse(d + 'T00:00:00Z');
const addDays = (d, n) => ymd(dateMs(d) + n * DAY);
const weekday = d => new Date(dateMs(d)).getUTCDay();
const nthWeekday = (y, m, wd, n) => {let d = 1; while (new Date(Date.UTC(y, m - 1, d)).getUTCDay() !== wd) d++; return d + 7 * (n - 1);};
const lastWeekday = (y, m, wd) => {let d = new Date(Date.UTC(y, m, 0)).getUTCDate(); while (new Date(Date.UTC(y, m - 1, d)).getUTCDay() !== wd) d--; return d;};
function laOffset(d) {
  const [y, m, day] = d.split('-').map(Number), md = m * 100 + day;
  return md >= 300 + nthWeekday(y, 3, 0, 2) && md < 1100 + nthWeekday(y, 11, 0, 1) ? '-07:00' : '-08:00';
}
const la = (d, hm) => `${d}T${hm}:00${laOffset(d)}`;
const Z = (d, hm = '08:00') => `${d}T${hm}:00Z`;
const localDay = new Intl.DateTimeFormat('en-CA', {timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'});
const dateOf = iso => localDay.format(Date.parse(iso));
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const md = d => MONTHS[Number(d.slice(5, 7)) - 1] + ' ' + Number(d.slice(8, 10));
const dayName = d => WEEKDAYS[weekday(d)];
const eveningTime = () => pad(int(18, 23)) + ':' + pad(int(0, 11) * 5);

// ---------- the fixture's own word lists (dev/build-fixtures.cjs) ----------
const WHO = ['a retired ferry pilot', 'a young surveyor', 'two estranged brothers', 'a night-shift nurse', 'a stubborn orchard keeper', 'a choir teacher',
  'a lighthouse mechanic', 'a former chess champion', 'a radio host', 'three schoolfriends', 'a widowed baker', 'a junior detective', 'a travelling projectionist',
  'a mapmaker', 'a reluctant mayor', 'a tugboat crew'];
const PLURAL_WHO = new Set(['two estranged brothers', 'three schoolfriends']);
const PLURAL_VERB = {tries: 'try', searches: 'search', reopens: 'reopen', plans: 'plan', restores: 'restore', hides: 'hide', competes: 'compete', uncovers: 'uncover',
  drives: 'drive', organises: 'organise', looks: 'look', tracks: 'track'};
const HANDLES = ['reelwren', 'nightowlfilms', 'quietrowseat', 'saltwatercritic', 'tallgrassviewer', 'balconyfront', 'popcornledger', 'thirdactdan', 'lanternreader',
  'harbourreels', 'midweekmatinee', 'filmfolder', 'castlistcass', 'lowlightlou', 'creditsroll', 'secondreel', 'orchardcinema', 'matineemargo', 'framebyfrank', 'tidaltv'];
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

// ---------- the seed and lookups ----------
const seed = structuredClone(fixture);
const titleOf = new Map(seed.titles.map(t => [t.title_id, t]));
const personName = new Map(seed.people.map(p => [p.person_id, p.name]));
const creditsOf = new Map();
for (const cr of seed.credits) (creditsOf.get(cr.title_id) || creditsOf.set(cr.title_id, []).get(cr.title_id)).push(cr);
for (const list of creditsOf.values()) list.sort((a, b) => a.billing_order - b.billing_order);
const cast = id => creditsOf.get(id).filter(cr => cr.role === 'actor').map(cr => ({name: personName.get(cr.person_id), character: cr.character}));
const crew = (id, role) => creditsOf.get(id).filter(cr => cr.role === role).map(cr => personName.get(cr.person_id));
const first = full => full.split(' ')[0];
const usRelease = t => t.releases.find(x => x.region === 'US').date;
const guideOf = new Map(seed.guides.map(g => [g.title_id, g]));
const guideAt = (id, iso) => guideOf.get(id).versions.filter((v, i) => i === 0 || Date.parse(v.published_at) <= Date.parse(iso)).at(-1);
const NAMED = ['tt-lantern-hill', 'tt-fieldglass', 'tt-copper-sky', 'tt-quiet-harbour', 'tt-salt-year', 'tt-wrenfield-clock', 'tt-pellmoor-junction',
  'tt-ambervane', 'tt-marrow-bay', 'tt-harbor-lights', 'tt-pocket-comets'];
// Titles the December scenario, the example events or the fixture's own account records rely on: no new
// account records, guide versions or reviews are added for them.
const reserved = new Set([...NAMED, ...seed.watchlist.title_ids, ...seed.alerts.map(a => a.title_id), ...seed.corrections.map(x => x.title_id),
  ...seed.notices.map(n => n.title_id), ...seed.lists.flatMap(l => l.title_ids)]);
const usedForAccount = new Set();
const free = t => !reserved.has(t.title_id) && !usedForAccount.has(t.title_id);

// ---------- text helpers ----------
const words = text => text.toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean);
const shingles = text => {const w = words(text), s = new Set(); for (let i = 0; i + 5 <= w.length; i++) s.add(w.slice(i, i + 5).join(' ')); return s;};
const jaccard = (a, b) => {if (!a.size || !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n);};
const prose = []; // every authored text written or kept, so no two are near-identical
const keep = text => {prose.push({text, set: shingles(text)}); return text;};
// Draws until the text shares under half its word 5-grams with every earlier text.
function distinct(make) {
  let best = null;
  for (let i = 0; i < 60; i++) {
    const text = make(), set = shingles(text);
    let worst = 0;
    for (const p of prose) {if (p.text === text) {worst = 1; break;} worst = Math.max(worst, jaccard(set, p.set)); if (worst >= 0.5) break;}
    if (worst < 0.5) return keep(text);
    if (!best || worst < best.worst) best = {text, worst};
  }
  if (best.worst >= 1) throw Error('Could not write a distinct text: ' + best.text);
  return keep(best.text);
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const GENRE_NOUN = {Drama: 'drama', Comedy: 'comedy', Thriller: 'thriller', Mystery: 'mystery', Romance: 'romance', Family: 'family film', Adventure: 'adventure',
  'Science fiction': 'science fiction film', Documentary: 'documentary', Animation: 'animated film', Crime: 'crime film', Western: 'western'};
const genreNoun = t => (t.kind === 'series' ? t.genres[0].toLowerCase() + ' series' : GENRE_NOUN[t.genres[0]]);

// What a reviewer can say about a title: its setting, premise and an ending to spoil.
const GOAL = {
  'tries to save the town cinema': ['the town cinema', A => `the cinema closes anyway, and ${A} reopens it as a summer drive-in in the last scene`],
  'searches for a missing letter': ['the missing letter', (A, B) => `the letter was in ${B}'s coat pocket the whole time`],
  'reopens a flooded mine': ['the flooded mine', (A, B) => `${B} is killed when the lower gallery floods a second time`],
  'plans one last river race': ['the river race', (A, B) => `${A} loses the race on purpose so that ${B} can win`],
  'restores a broken clock tower': ['the clock tower', (A, B) => `${B} stopped the clock years ago to hide the date of the fire`],
  'hides a runaway horse': ['the runaway horse', (A, B) => `the horse belonged to ${B} all along`],
  'competes in a regional bake-off': ['the bake-off', (A, B) => `${A} pulls out before the final so that ${B} can enter`],
  'uncovers a decades-old land swindle': ['the land swindle', (A, B) => `${B}, the kindly council clerk, forged the deeds`],
  'drives an old bus across the border': ['the bus journey', A => `the bus never makes it, and ${A} walks the last mile`],
  'organises a winter fair': ['the winter fair', A => `the storm cancels the fair and ${A} holds it in the church hall`],
  'looks after a neighbour\'s farm': ['the neighbour\'s farm', A => `the neighbour never comes back, and ${A} keeps the farm`],
  'tracks a stolen painting': ['the stolen painting', (A, B) => `${B} painted the forgery that hung in the gallery`],
};
const NAMED_FACTS = {
  'tt-lantern-hill': {place: 'the hill farm', thing: 'the lantern festival', premise: 'a girl reviving her valley\'s lantern festival', reveal: () => 'the lanterns finally go up over the valley in the last scene'},
  'tt-fieldglass': {place: 'the marsh', thing: 'the sighting across the marsh', premise: 'a birdwatcher nobody believes', reveal: () => 'the boat she saw was being sunk for the insurance money'},
  'tt-copper-sky': {place: 'the desert basin', thing: 'the balloon crossing', premise: 'two balloonists racing a dust storm', reveal: () => 'they come down a few miles short of the record'},
  'tt-quiet-harbour': {place: 'the old harbour', thing: 'the harbour rebuild', premise: 'a ferry captain and an architect arguing over a harbour', reveal: () => 'the captain signs off on the rebuild in the end'},
  'tt-salt-year': {place: 'the salt works', thing: 'the last salt season', premise: 'two sisters running their father\'s salt works', reveal: () => 'the land sale falls through and the younger sister keeps the works'},
  'tt-wrenfield-clock': {place: 'Wrenfield', thing: 'the slow town clock', premise: 'an apprentice and a town clock running slow on purpose', reveal: () => 'the mayor slowed the clock to cover a robbery'},
  'tt-ambervane': {place: 'the weather station', thing: 'the early forecasts', premise: 'forecasts that arrive a day before the weather', reveal: () => 'the engineer has been sending the forecasts herself'},
  'tt-marrow-bay': {place: 'the island', thing: 'the stray boat', premise: 'a seal counter who finds a boat that should not be there', reveal: () => 'the boat belongs to her missing research partner'},
  'tt-harbor-lights': {place: 'Saltmere', thing: 'the dark lighthouse', premise: 'a harbourmaster coming home to a dark lighthouse', reveal: () => 'the council chair sabotaged the ferry in season 1'},
  'tt-pocket-comets': {place: 'the backyard observatory', thing: 'the runaway comets', premise: 'three friends returning lost comets to the sky', reveal: () => 'the friends release every comet at once in the last episode'},
};
function facts(t) {
  if (NAMED_FACTS[t.title_id]) return NAMED_FACTS[t.title_id];
  const m = /^In ([^,]+), (.+?)\. /.exec(t.synopsis), who = WHO.find(w => m[2].startsWith(w + ' ')), goal = m[2].slice(who.length + 1);
  const verb = PLURAL_WHO.has(who) ? goal.replace(/^\w+/, v => PLURAL_VERB[v]) : goal;
  const [thing, reveal] = GOAL[goal];
  return {place: m[1], thing, premise: who + ' who ' + verb, reveal};
}
function spoilerOf(t, iso) {
  const people = cast(t.title_id), A = first(people[0].character), B = first(people[1].character);
  const item = Object.values(guideAt(t.title_id, iso).categories).flatMap(x => x.items).find(i => i.spoiler);
  const fromGuide = item && {
    'A main character is killed near the end.': `${B} dies near the end`,
    'The final scene reveals the ghost was the narrator.': `the narrator turns out to be the ghost`,
    'The last line of the film is an angry outburst at the villain.': `${A} finally tells ${B} exactly what everyone thinks of them`,
    'The hero turns out to have been poisoned.': `${A} has been poisoned the whole time`,
    'The ending shows the couple together after all.': `${A} and ${B} end up together after all`,
  }[item.text];
  return fromGuide || facts(t).reveal(A, B);
}

// ---------- 1. Public reviews: one text per review ----------
function holiday(d) {
  const [y, m, dd] = d.split('-').map(Number), tg = nthWeekday(y, 11, 4, 4), memorial = lastWeekday(y, 5, 1), labor = nthWeekday(y, 9, 1, 1);
  if (m === 1 && dd === 1) return `Watched it on New Year's Day to start ${y} slowly.`;
  if (m === 2 && dd === 14) return `Our Valentine's Day pick for ${y}.`;
  if (m === 5 && dd >= memorial - 2 && dd <= memorial) return `Memorial Day weekend watch, ${md(d)}.`;
  if (m === 7 && dd === 4) return `Watched it on the Fourth of July while the fireworks went off outside.`;
  if (m === 9 && dd >= labor - 2 && dd <= labor) return `Labor Day weekend, ${md(d)}, the last lazy afternoon of summer.`;
  if (m === 10 && dd === 31) return `Halloween night ${y}, porch light off.`;
  if (m === 10 && dd >= 25) return `Halloween-week pick on ${dayName(d)} ${md(d)}.`;
  if (m === 11 && dd === tg) return `Thanksgiving ${y}, after the dishes were done.`;
  if (m === 11 && dd > tg && dd <= tg + 3) return `Thanksgiving weekend watch, ${md(d)}.`;
  if (m === 12 && dd === 24) return `Christmas Eve ${y}, once the presents were wrapped.`;
  if (m === 12 && dd === 25) return `Christmas Day ${y}, the traditional afternoon film.`;
  if (m === 12 && dd >= 26 && dd <= 30) return `Watched it on ${md(d)}, in the quiet week between Christmas and New Year.`;
  if (m === 12 && dd === 31) return `New Year's Eve ${y}, waiting for midnight.`;
  return null;
}
const arrivedOn = (t, d) => seed.offers.filter(o => o.title_id === t.title_id && o.region === 'US' && (o.type === 'subscription' || o.type === 'free_with_ads'))
  .map(o => ({o, from: dateOf(o.available_from)})).filter(x => x.from <= d && x.from >= addDays(d, -14)).sort((a, b) => a.from.localeCompare(b.from))[0];
const serviceName = id => seed.services.find(s => s.service_id === id).name;
function opener(t, d) {
  const options = [], since = (dateMs(d) - dateMs(usRelease(t))) / DAY, age = Number(d.slice(0, 4)) - t.year, noun = t.kind === 'film' ? 'film' : 'series';
  if (since >= 0 && since <= 13) options.push(...(t.kind === 'film'
    ? [`Caught it on ${dayName(d)}, ${md(d)}, ${since === 0 ? 'its opening day' : 'in its first week out'}.`, `Went to ${/^[AEIOU]/.test(md(d)) ? 'an' : 'a'} ${md(d)} screening the week it opened.`, `Saw it ${since <= 3 ? 'on opening weekend' : 'in its second week'} (${md(d)}).`]
    : [`Watched the first episodes the week it premiered (${md(d)}).`, `Started it on ${md(d)}, a few days after the premiere.`]));
  const arrival = arrivedOn(t, d);
  if (arrival) {
    const s = serviceName(arrival.o.service_id);
    options.push(`${s} added it on ${md(arrival.from)}, so I finally watched it on ${md(d)}.`, `Streamed it on ${s} on ${md(d)}, a few days after it arrived there.`, `Picked it from ${s}'s new arrivals on ${md(d)}.`);
  }
  const h = holiday(d);
  if (h) options.push(h, h);
  if (age >= 8) options.push(`Rewatched it on ${md(d)}, ${age} years after it came out.`, `Finally saw this ${t.year} ${noun} on ${md(d)}.`, `${cap(String(age))} years on, I gave it a first look on ${dayName(d)}, ${md(d)}.`);
  const month = Number(d.slice(5, 7));
  options.push(`${dayName(d)} night pick, ${md(d)}.`, `Watched it on ${dayName(d)}, ${md(d)}.`, `Put it on after work on ${dayName(d)}, ${md(d)}.`, `Late show at home on ${md(d)}.`,
    `${md(d)}: a long-delayed watch from my list.`, ...(month <= 3 || month >= 11 ? [`Rainy ${dayName(d)} afternoon, ${md(d)}.`] : [`Warm ${dayName(d)} evening, ${md(d)}, windows open.`]));
  return pick(options);
}
const band = r => (r >= 4.5 ? 'great' : r >= 3.5 ? 'good' : r >= 2.5 ? 'mixed' : r >= 1.5 ? 'poor' : 'bad');
function verdict(t, rating) {
  const f = facts(t), [lead, second] = cast(t.title_id), director = crew(t.title_id, 'director')[0], runtime = t.editions[0].runtime_minutes;
  const L = lead.name, C = first(lead.character), S = second.name, C2 = first(second.character), g = genreNoun(t), it = t.kind === 'film' ? 'film' : 'show';
  const len = t.kind === 'film' ? `${runtime} minutes` : `${runtime}-minute episodes`;
  return pick({
    great: [`${L} is superb as ${C}, and ${director} never lets ${len} drag.`, `Everything about the story of ${f.thing} works, and ${L} gives ${C} real weight.`,
      `One of the best ${t.kind === 'series' ? g : g + 's'} I have seen in years; ${L} and ${S} are perfectly matched.`, `${director} makes ${f.place} feel lived in, and ${L}'s ${C} is unforgettable.`,
      `I did not expect a ${it} about ${f.premise} to move me this much.`, `Gripping from start to finish, and ${S} steals scenes as ${C2}.`],
    good: [`${L} makes ${C} easy to root for, even when the business with ${f.thing} thins out.`, `A solid ${g}: the middle sags, but the last stretch about ${f.thing} lands.`,
      `${S} is the surprise as ${C2}; ${L} is as reliable as ever.`, `Well made and warm, if a little long at ${len}.`,
      `The ${f.place} setting does a lot of the work, and ${director} keeps it moving.`, `Better than I expected from a ${it} about ${f.premise}.`],
    mixed: [`${L} is fine as ${C}, but ${len} is a lot for a ${it} about ${f.premise}.`, `Half of it works: ${f.thing} is a good hook, the subplot with ${C2} is not.`,
      `Nice to look at, and ${f.place} is lovely, but the script never trusts the audience.`, `${S} is wasted as ${C2}, and the ending is rushed.`,
      `A decent ${g}, though I had forgotten most of it by the next morning.`, `${director} has a good eye, but the pacing is all over the place.`],
    poor: [`Despite ${L}, the ${it} about ${f.premise} never gets going.`, `Everything about ${f.thing} is predictable from the first ten minutes.`,
      `${cap(len)} felt like three hours; ${C} makes the same mistake again and again.`, `I wanted more of ${S}'s ${C2} and much less of everything else.`,
      `A flat ${g}. ${director} seems unsure what tone to aim for.`],
    bad: [`I gave up caring about ${C} halfway through.`, `A mess: the story of ${f.thing} goes nowhere and ${L} looks bored.`,
      `Switched it off at the hour mark and only finished it out of stubbornness.`, `Nothing about ${f.place} or the people in it rings true.`],
  }[band(rating)]);
}
const SEVERITY_WORD = {mild: 'mild', moderate: 'moderate', severe: 'strong'};
const CATEGORY_WORD = {violence: 'the violence', language: 'the language', sexual_content: 'the sexual content', frightening: 'the scary material', substances: 'the drinking and drug content'};
function extra(t, rating, iso) {
  const options = [], f = facts(t), [, second] = cast(t.title_id), director = crew(t.title_id, 'director')[0];
  const guide = guideAt(t.title_id, iso), strong = Object.entries(guide.categories).filter(([, x]) => x.severity === 'moderate' || x.severity === 'severe');
  if (strong.length) {
    const [name, x] = pick(strong), item = x.items.find(i => !i.spoiler);
    options.push(`Parents: the guide rates ${CATEGORY_WORD[name]} ${SEVERITY_WORD[x.severity]}${item ? ' (' + item.text.charAt(0).toLowerCase() + item.text.slice(1, -1) + ')' : ''}.`);
  }
  else options.push(`Fine for older kids; the guide lists nothing worse than ${Object.entries(guide.categories).some(([, x]) => x.severity === 'mild') ? 'mild material' : 'a raised eyebrow'}.`);
  const other = seed.credits.find(cr => cr.role === 'director' && personName.get(cr.person_id) === director && cr.title_id !== t.title_id);
  if (other) options.push(`${director} also made ${titleOf.get(other.title_id).name}, and this one is ${rating >= 3.5 ? 'better' : 'not as good'}.`);
  const composer = crew(t.title_id, 'composer')[0], cine = crew(t.title_id, 'cinematographer')[0];
  if (composer && rating >= 3) options.push(`${composer}'s score is worth hearing on its own.`);
  if (cine && rating >= 2.5) options.push(`${cine}'s photography of ${f.place} is the highlight.`);
  const CUT = {Extended: 'extended cut', 'Director\'s cut': 'director\'s cut', Restored: 'restored version'};
  if (t.editions.length > 1) options.push(`The ${CUT[t.editions[1].label]} runs ${t.editions[1].runtime_minutes} minutes; ${rating >= 3.5 ? 'worth the extra time' : 'stick to the theatrical cut'}.`);
  const on = seed.offers.find(o => o.title_id === t.title_id && o.region === 'US' && o.type === 'subscription' && c.isCurrent(c.availability(o, Date.parse(iso))));
  if (on) options.push(`It is on ${serviceName(on.service_id)} in the US right now.`);
  if (second) options.push(`${second.name} deserved a bigger part.`);
  return pick(options);
}
function publicText(t, rating, spoiler, iso) {
  const d = dateOf(iso);
  return distinct(() => [opener(t, d), verdict(t, rating), ...(chance(0.6) ? [extra(t, rating, iso)] : []), ...(spoiler ? [`Spoiler: ${spoilerOf(t, iso)}.`] : [])].join(' '));
}

// ---------- 2. Dana's diary reviews ----------
function companions(e) {
  const jules = e.watched_with.includes('person-jules'), mira = e.watched_with.includes('person-mira'), d = e.watched_on;
  if (jules && mira) return pick([`Family night on ${md(d)}.`, `All three of us on ${dayName(d)}, ${md(d)}.`, `Watched with Jules and Mira on ${md(d)}.`]);
  if (jules) return pick([`Jules chose this one (${md(d)}).`, `Watched with Jules on ${dayName(d)}, ${md(d)}.`, `${dayName(d)} night with Jules.`]);
  if (mira) return pick([`Mira picked it on ${md(d)}.`, `Watched with Mira on ${dayName(d)}.`, `A ${dayName(d)} afternoon film with Mira.`]);
  return pick([`Watched on my own on ${dayName(d)}, ${md(d)}.`, `A solo ${dayName(d)} night.`, `On my own on ${md(d)}, after everyone was in bed.`]);
}
function danaText(e) {
  const t = titleOf.get(e.title_id), f = facts(t), [lead] = cast(t.title_id), runtime = t.editions[0].runtime_minutes, L = lead.name;
  const iso = e.logged_at, guide = guideAt(t.title_id, iso), scary = ['moderate', 'severe'].includes(guide.categories.frightening.severity);
  const v = {
    great: [`One of my favourites this year; ${L} is wonderful.`, `Loved the story of ${f.thing} from start to finish.`, `I will be thinking about ${f.place} for a while.`],
    good: [`${L} was the best thing in it.`, `Good, if a bit long at ${runtime} minutes.`, `A warm one; the ending with ${f.thing} got me.`, `Well paced, and ${f.place} looks beautiful.`],
    mixed: [`Fine, but I will not remember much of it.`, `The scenes in ${f.place} were lovely; the rest dragged.`, `${L} tries hard, but the script is thin.`],
    poor: [`Did not work for me; the plot about ${f.thing} goes nowhere.`, `Too long and too pleased with itself.`, `Even ${L} could not save it.`],
    bad: [`We switched off at the halfway mark.`, `A rare miss for ${L}.`],
  }[band(e.rating)];
  const parts = [companions(e), pick(v)];
  if (e.rewatch) parts.push(pick(['Better the second time.', 'Second time through and it holds up.']));
  if (e.watched_with.includes('person-mira')) parts.push(scary ? pick(['Too scary for Mira in places.', `Mira hid behind a cushion for the ${f.thing} scenes.`]) : pick(['Mira laughed all the way through.', 'Mira wants to watch it again.', 'Mira lost interest after an hour.']));
  else if (e.watched_with.includes('person-jules')) parts.push(pick(['Jules liked it more than I did.', 'Jules fell asleep before the end.', 'Jules wants to see it again.', 'Jules guessed the ending early.']));
  if (e.review.contains_spoilers) parts.push(`(Spoiler: ${spoilerOf(t, iso)}.)`);
  return parts.join(' ');
}

// ---------- 3. Episode synopses for the generated series ----------
const SERIES_TYPE = name => (/^Inspector /.test(name) ? 'police' : / General$/.test(name) ? 'hospital' : / Academy$/.test(name) ? 'school' : / Circuit$/.test(name) ? 'racing'
  : / Nights$/.test(name) ? 'nights' : /^Station /.test(name) ? 'rescue' : /^Little /.test(name) ? 'village' : 'town');
const ACTIONS = {
  police: ['is called to a body found in the {place} reservoir', 'reopens a twenty-year-old disappearance after a ring turns up at a pawnshop', 'questions the night porter at the {place} hotel about a missing guest',
    'traces a burned-out van to a farm outside {place}', 'learns that the only witness to a hit-and-run has left the country', 'goes undercover at a livestock auction',
    'is ordered to drop a fraud case that leads to the council', 'investigates a museum break-in where nothing was taken', 'searches the moor for a missing hiker in thick fog',
    'interviews a teenager who confessed too quickly', 'links three house fires to one insurance broker', 'is suspended after a suspect is hurt in custody',
    'follows an anonymous letter to the old quarry', 'works a poisoning at a wedding reception', 'tracks lead stolen from the church roof to a scrapyard',
    'reinterviews the family of a drowned fisherman', 'finds a page missing from the evidence log', 'chases a lead onto a ferry that sails at dawn',
    'questions a retired judge about an old acquittal', 'breaks up a betting ring at the greyhound track', 'finds a car in the canal with the engine still warm',
    'is sent to guard a witness in a seaside caravan', 'reopens the case that ended a predecessor\'s career', 'gets a confession that does not match the evidence'],
  hospital: ['runs the emergency department alone through a power cut', 'treats a cyclist whose injuries do not match his story', 'fights the board over closing the {place} maternity ward',
    'faces a complaint from the family of a patient sent home too early', 'handles a coach crash on the bypass', 'spots a poisoning in three children from the same school',
    'covers a double shift after flu takes half the nurses', 'operates on a surgeon from the rival hospital', 'finds a newborn left in the hospital chapel',
    'questions a drug-trial result that looks too good', 'nurses a stubborn farmer who refuses an operation', 'is offered a post in the city and keeps it quiet',
    'treats a patient who insists he is someone else', 'loses a patient on the operating table and has to tell the family', 'is called to a farm accident in the {place} hills',
    'clashes with a consultant over a risky operation', 'treats twins with the same rare condition', 'keeps the ward running through a heatwave',
    'finds out a locum has been working without a licence', 'delivers a baby in the hospital car park', 'reopens the old {place} cottage hospital for a week',
    'looks into a run of missing medicines'],
  school: ['is blamed when the exam papers leak a week early', 'coaches the debate team to its first regional final', 'finds a pupil sleeping in the music block',
    'stages the school play after the lead breaks a leg', 'fights the governors over closing the boarding house', 'leads a field trip that goes wrong in the hills',
    'catches a teacher selling coursework', 'runs parents\' evening on the night of a storm', 'finds the old school logbooks in a flooded cellar',
    'is challenged to a chess match by the head', 'organises the leavers\' ball with no budget', 'settles a feud between two boarding houses',
    'takes over the class nobody else will teach', 'tracks down a pupil who has stopped coming to school', 'runs sports day in a heatwave',
    'defends a pupil accused of cheating', 'judges the {place} science fair'],
  racing: ['crashes in qualifying at the {place} hairpin', 'signs a teenage driver the sponsors do not trust', 'rebuilds the gearbox overnight before the opening race',
    'loses the main sponsor to a rival garage', 'finishes fourth in the rain on worn tyres', 'finds a cut fuel line minutes before the start',
    'faces a stewards\' inquiry over a late overtake', 'tests the new car on the airfield at dawn', 'takes the team to its first race abroad',
    'is offered a works drive and has to tell the team', 'nurses a failing engine home on the last lap', 'hires a mechanic straight out of a scrapyard',
    'races the {place} street circuit for the first time', 'has to choose between two drivers for the last seat'],
  nights: ['takes a late-show call from a woman who says she saw the ferry sink', 'keeps the all-night diner open through a blackout', 'drives the night bus through a flooded underpass',
    'plays a record that revives an old feud', 'broadcasts from the lighthouse when the studio floods', 'covers the graveyard shift at the taxi office',
    'searches the harbour at 3 a.m. for a caller who has gone quiet', 'hosts a phone-in about the closing of the {place} pier', 'finds a stranger asleep in the radio van',
    'runs the late show with a broken transmitter', 'meets a listener who has written in every night for a year', 'is offered the breakfast slot and turns it down',
    'gets a request for a song nobody has played since 1987', 'keeps a caller talking until the ambulance arrives'],
  rescue: ['launches the lifeboat to a yacht aground on the {place} sands', 'searches the cliffs for a dog walker missing since dusk', 'trains two new volunteers in a gale',
    'faces an inspection that could close the station', 'tows a broken trawler home through the night', 'pulls a boy from the harbour after a dare',
    'argues with the coastguard over a call that was ignored', 'raises money for a new engine at the summer fete', 'answers a mayday from a fishing boat with no lights',
    'stands the crew down after a hoax call', 'searches the estuary for two missing kayakers', 'pulls a stranded horse from the mudflats',
    'escorts a burning ferry into {place} harbour', 'loses the boathouse roof in a storm', 'recovers a capsized dinghy with nobody aboard'],
  village: ['enters the village show with a giant marrow', 'loses the prize goose before the church fete', 'runs the village shop for a week',
    'builds a raft for the river race', 'tries to win back the cricket trophy', 'hides a stray dog from the vicar', 'plans a surprise party that everyone finds out about',
    'stages a nativity with a real donkey', 'campaigns to save the village bus', 'holds a midsummer picnic in the rain', 'judges the scarecrow competition',
    'takes charge of the village pantomime', 'rescues a cat from the bell tower', 'starts a feud over the allotments', 'runs the tombola at the summer fair'],
  town: ['reopens her late father\'s boatyard', 'clashes with the developer who bought the mill', 'learns the truth about the 1990 flood', 'takes in an estranged nephew',
    'stands for the town council', 'finds old letters under the chapel floor', 'loses the farm tenancy', 'joins the search for a missing fishing boat',
    'buys back the family boat at auction', 'revives the regatta after a ten-year gap', 'finds her mother\'s name in the old shipping register',
    'takes the night shift at the fish market', 'sits on a jury in a case against a neighbour', 'rebuilds the sea wall with volunteers', 'finds the lighthouse keeper\'s diary'],
};
const SUBPLOTS = ['{B} is offered a job in the city', '{B} hides a debt from everyone', '{B} starts seeing an old flame', '{B} moves back in with family',
  '{B} sells the family car to cover the rent', '{B} is caught lying about the night of the fire', '{B} takes driving lessons at last', '{B} looks after a sick parent',
  '{B} plans a wedding nobody wants', '{B} gets a letter from a brother long thought dead', '{B} enters the pub quiz to win a holiday', '{B} adopts a three-legged dog',
  '{B} learns to sail', '{B} applies for a transfer', '{B} finds a stash of cash in the attic', '{B} is snubbed at the awards dinner', '{B} gives up smoking, again',
  '{B} confronts a noisy neighbour', '{B} hides an injury from the others', '{B} reconnects with an estranged daughter', '{B} buys a failing café',
  '{B} starts night classes', '{B} is followed by a reporter', '{B} falls out with the landlord', '{B} trains for the {place} half marathon', '{B} inherits a narrowboat'];
const BOSS = {police: 'station chief', hospital: 'medical director', school: 'chair of governors', racing: 'team principal', nights: 'station manager', rescue: 'station coxswain', village: 'parish council chair', town: 'harbour master'};
const FINALE = {
  'The season ends with a death in the family.': (A, B) => `and the season ends at the funeral of ${B}'s mother`,
  'The culprit is revealed to be the station chief.': (A, B, type) => `and the culprit turns out to be ${B}, the ${BOSS[type]}`,
  'A main character leaves town for good.': (A, B, type, place) => `and ${B} leaves ${place} for good in the last scene`,
  'The finale reveals who started the fire.': (A, B) => `and the finale reveals that ${B} started the fire`,
};
const EXTRA_EPISODE_NAMES = ['Low Water', 'The Long Weekend', 'Cold Open', 'Paper Trail', 'Last Orders', 'Black Ice', 'The Night Ferry', 'Spare Keys', 'Common Ground',
  'Hold Fast', 'Small Hours', 'The Quiet Room', 'Loose Ends', 'First Frost', 'Open Season', 'Fair Weather', 'The Visitor', 'Clean Break', 'Night Rounds', 'Turning Point',
  'Old Ground', 'Snowbound', 'Running Late', 'Safe Harbour', 'High Water', 'Dry Run', 'The Interview', 'Side Roads', 'Fresh Tracks', 'The Handover', 'Long Shot',
  'Back Lanes', 'The Last Shift', 'Overtime', 'Tidemark', 'Short Notice'];
const usedPairs = new Set();
function episodeText(t, ep, finaleOf) {
  const type = SERIES_TYPE(t.name), place = facts(t).place, people = cast(t.title_id).slice(0, 5).map(p => first(p.character));
  const A = ep.number % 3 === 2 ? people[1] : people[0], others = people.filter(x => x !== A);
  return distinct(() => {
    let action, sub, B = pick(others);
    for (let i = 0; i < 40; i++) {
      action = pick(ACTIONS[type]); sub = pick(SUBPLOTS);
      if (!usedPairs.has(t.title_id + action) && !usedPairs.has(action + sub)) break;
    }
    usedPairs.add(t.title_id + action); usedPairs.add(action + sub);
    const fill = s => s.replace('{place}', place).replace('{B}', B);
    if (finaleOf) return `${A} ${fill(action)}, ${FINALE[finaleOf](A, B, type, place)}.`;
    return `${A} ${fill(action)}, while ${fill(sub)}.`;
  });
}
function renameDuplicates(t, eps) {
  const seen = new Set(eps.map(e => e.name)), taken = new Set();
  for (const ep of eps) {
    if (!taken.has(ep.name)) {taken.add(ep.name); continue;}
    ep.name = pick(EXTRA_EPISODE_NAMES.filter(n => !seen.has(n))); seen.add(ep.name); taken.add(ep.name);
  }
}

// ---- Rewrite the repeated fixture texts. Records keep their IDs, dates, ratings and flags. ----
const KEEP_REVIEW = new Set(['rv-lh-01']); // the authored Lantern Hill barn review (test T07, request 1)
const authoredDiary = new Set(fixture.diary.filter(e => e.review && e.review.text === 'Still the cosiest mystery I know. The clock tower set is wonderful.').map(e => e.entry_id));
for (const id of KEEP_REVIEW) keep(seed.public_reviews.find(x => x.review_id === id).text);
for (const e of seed.diary) if (authoredDiary.has(e.entry_id)) keep(e.review.text);
for (const t of seed.titles) keep(t.synopsis);
for (const ep of seed.episodes) if (ep.title_id === 'tt-harbor-lights' || ep.title_id === 'tt-pocket-comets') keep(ep.synopsis);
const rewritten = {public_reviews: 0, diary_reviews: 0, episode_synopses: 0, episode_names: 0};
for (const t of seed.titles.filter(x => x.kind === 'series' && !NAMED.includes(x.title_id))) {
  const eps = seed.episodes.filter(e => e.title_id === t.title_id).sort((a, b) => a.season_number - b.season_number || a.number - b.number);
  const before = eps.map(e => e.name);
  renameDuplicates(t, eps);
  rewritten.episode_names += eps.filter((e, i) => e.name !== before[i]).length;
  for (const ep of eps) {
    const finale = Object.keys(FINALE).includes(ep.synopsis) ? ep.synopsis : null;
    ep.synopsis = episodeText(t, ep, finale); rewritten.episode_synopses++;
  }
}
for (const rv of seed.public_reviews) {
  if (KEEP_REVIEW.has(rv.review_id)) continue;
  rv.text = publicText(titleOf.get(rv.title_id), rv.rating, rv.contains_spoilers, rv.posted_at); rewritten.public_reviews++;
}
for (const e of seed.diary) {
  if (!e.review || authoredDiary.has(e.entry_id)) continue;
  e.review.text = distinct(() => danaText(e)); rewritten.diary_reviews++;
}

// ---------- 4. Catalog additions ----------
// Two generated series continue: Sallowstead General's third season, added Nov. 8 with weekly episodes to
// Dec. 18, and Inspector Junivergate's third, added Dec. 4 (after the clock) with episodes to Dec. 30.
const added = {seasons: [], episodes: [], guide_versions: [], public_reviews: [], alerts: [], corrections: [], notices: [], lists: []};
function addSeason(titleId, n, addedOn, airDates) {
  const t = titleOf.get(titleId), eps = seed.episodes.filter(e => e.title_id === titleId), names = new Set(eps.map(e => e.name));
  t.seasons.push({season_number: n, name: 'Season ' + n, added_at: Z(addedOn)});
  added.seasons.push({title_id: titleId, season_number: n, added_at: Z(addedOn)});
  const at = seed.episodes.indexOf(eps.at(-1)) + 1, fresh = [];
  airDates.forEach((air, i) => {
    const name = pick(EXTRA_EPISODE_NAMES.filter(x => !names.has(x))); names.add(name);
    const ep = {episode_id: 'ep-' + slug(titleId) + '-s' + n + 'e' + (i + 1), title_id: titleId, season_number: n, number: i + 1, name, synopsis: '', air_date: air, runtime_minutes: t.editions[0].runtime_minutes};
    ep.synopsis = episodeText(t, ep, i === airDates.length - 1 ? 'A main character leaves town for good.' : null);
    fresh.push(ep);
  });
  seed.episodes.splice(at, 0, ...fresh);
  added.episodes.push(...fresh.map(e => e.episode_id));
}
addSeason('tt-sallowstead-general', 3, '2026-11-08', ['2026-11-13', '2026-11-20', '2026-11-27', '2026-12-04', '2026-12-11', '2026-12-18']);
addSeason('tt-inspector-junivergate', 3, '2026-12-04', ['2026-12-09', '2026-12-16', '2026-12-23', '2026-12-30']);
for (const id of ['tt-sallowstead-general', 'tt-inspector-junivergate']) usedForAccount.add(id);

// Parental-guide updates: one a month in 2025 (the fixture's updates all fall in 2026) and three in December 2026.
function addGuideVersion(titleId, at, reason, mutate) {
  const g = guideOf.get(titleId), prev = g.versions.at(-1), categories = structuredClone(prev.categories);
  if (Date.parse(at) < Date.parse(prev.published_at)) throw Error('Guide version out of order for ' + titleId);
  mutate(categories, titleId, at);
  g.versions.push({version: prev.version + 1, reason, published_at: at, categories});
  added.guide_versions.push({title_id: titleId, version: prev.version + 1, published_at: at});
  return prev.version + 1;
}
function bump(categories, titleId, at) {
  const name = pick(['violence', 'language', 'frightening', 'substances'].filter(x => categories[x].severity !== 'severe')), order = ['none', 'mild', 'moderate', 'severe'];
  const sev = order[order.indexOf(categories[name].severity) + 1];
  categories[name].severity = sev; categories[name].summary = SUMMARY[name][sev];
  categories[name].items.push({item_id: 'gi-' + slug(titleId) + '-u' + at.slice(0, 10).replace(/-/g, ''), text: pick(GUIDE_TEXT[name][sev]), spoiler: false});
}
const onlyV1 = shuffle(seed.titles.filter(t => t.kind === 'film' && free(t) && guideOf.get(t.title_id).versions.length === 1 && usRelease(t) < '2024-01-01'));
let cursor = 0;
const nextFilm = test => {for (; cursor < onlyV1.length; cursor++) if (free(onlyV1[cursor]) && (!test || test(onlyV1[cursor]))) {const t = onlyV1[cursor++]; usedForAccount.add(t.title_id); return t;} throw Error('No title left');};
for (let m = 2; m <= 12; m++) addGuideVersion(nextFilm().title_id, Z(`2025-${pad(m)}-${pad(int(3, 26))}`, '16:00'), 'published_update', bump);
for (const d of ['2026-12-07', '2026-12-15', '2026-12-22']) addGuideVersion(nextFilm().title_id, Z(d, '17:00'), 'published_update', bump);

// ---------- 5. Dana's account history across both years ----------
const account = {region: seed.account.region, service_ids: seed.account.service_ids};
const view = iso => c.index(c.visible(seed, iso));
const matchAt = (alert, iso) => rules.matchOffer(view(iso), {...seed, account: {...seed.account, ...account}}, alert, Date.parse(iso));
const nid = () => 'nt-' + pad(seed.notices.length + 1);
function notice(fields) {
  const n = {notice_id: nid(), at: fields.at, kind: fields.kind, title_id: fields.title_id, alert_id: fields.alert_id ?? null, correction_id: fields.correction_id ?? null,
    guide_version: fields.guide_version ?? null, event_id: fields.event_id, text: fields.text};
  seed.notices.push(n); added.notices.push(n.notice_id);
  return n.notice_id;
}
const evening = d => la(d, pad(int(19, 22)) + ':' + pad(int(0, 11) * 5));
function alert(fields) {
  const a = {offer_type: null, threshold: null, expires_at: null, known_seasons: [], trigger: null, alert_id: 'al-' + pad(seed.alerts.length + 1), ...fields};
  a.updated_at = a.updated_at ?? a.created_at;
  seed.alerts.push(a); added.alerts.push(a.alert_id); usedForAccount.add(a.title_id);
  return a;
}
const snap = o => ({offer_id: o.offer_id, service_id: o.service_id, region: o.region, type: o.type, price: o.price, currency: o.currency,
  available_from: o.available_from, available_until: o.available_until});
function fire(a, offer, season, eventId, operation, at) {
  a.status = 'triggered'; a.updated_at = at;
  a.trigger = {at, cause: 'event', event_id: eventId, operation, request_id: null, offer: offer && snap(offer), season_number: season, notice_id: null};
  a.trigger.notice_id = notice({at, kind: 'alert_triggered', title_id: a.title_id, alert_id: a.alert_id, event_id: eventId, text: rules.noticeText(view(at), a, offer, season)});
}
// a. "Tell me when it is on my services": a US subscription on Brightreel or Northcast starts, delivered by offer.publish at its start.
const mineSub = o => o.region === 'US' && o.type === 'subscription' && account.service_ids.includes(o.service_id);
const arrivals = seed.offers.filter(o => mineSub(o) && o.available_from >= '2025-02-15' && o.available_from < '2026-11-15' && free(titleOf.get(o.title_id)))
  .filter(o => !seed.offers.some(x => x !== o && x.title_id === o.title_id && mineSub(x) && Date.parse(x.available_from) <= Date.parse(o.available_from)))
  .sort((a, b) => a.available_from.localeCompare(b.available_from));
const wanted = ['2025-03', '2025-06', '2025-08', '2025-11', '2026-01', '2026-05', '2026-07', '2026-10'];
for (const month of wanted) {
  const o = arrivals.find(x => dateOf(x.available_from).startsWith(month) && free(titleOf.get(x.title_id)));
  if (!o) continue;
  const created = evening(addDays(dateOf(o.available_from), -int(12, 45)));
  const a = alert({kind: 'available_on_my_services', title_id: o.title_id, status: 'active', created_at: created});
  if (matchAt(a, created)) throw Error('Rule would be already_true at creation: ' + a.alert_id);
  if (matchAt(a, o.available_from)?.offer_id !== o.offer_id) throw Error('Rule would not match its offer: ' + a.alert_id);
  fire(a, o, null, 'offer-' + slug(o.title_id) + '-' + o.service_id + '-us', 'offer.publish', o.available_from);
}
// b. Price drops: a US rental that gets cheaper; the rule's threshold sits between the old and the new price.
const drops = seed.offers.filter(o => o.region === 'US' && o.type === 'rent' && o.available_until !== null && free(titleOf.get(o.title_id)))
  .map(o => [o, seed.offers.find(x => x.title_id === o.title_id && x.service_id === o.service_id && x.region === 'US' && x.type === 'rent' && x.available_from === o.available_until && x.price < o.price)])
  .filter(([, b]) => b && b.available_from < '2026-11-15').sort((x, y) => x[1].available_from.localeCompare(y[1].available_from));
for (const [before, after] of drops.filter((x, i) => i % Math.max(1, Math.floor(drops.length / 3)) === 0).slice(0, 3)) {
  if (!free(titleOf.get(after.title_id))) continue;
  const threshold = Math.ceil(after.price), created = evening(addDays(dateOf(after.available_from), -int(15, 50)));
  if (Date.parse(created) < Date.parse(before.available_from) || !(before.price >= threshold)) continue;
  const a = alert({kind: 'price_below', title_id: after.title_id, offer_type: 'rent', threshold, status: 'active', created_at: created});
  if (matchAt(a, created)) throw Error('Price rule would be already_true at creation: ' + a.alert_id);
  if (matchAt(a, after.available_from)?.offer_id !== after.offer_id) throw Error('Price rule would not match its offer: ' + a.alert_id);
  fire(a, after, null, 'offer-' + slug(after.title_id) + '-' + after.service_id + '-us-rent-' + dateOf(after.available_from).slice(0, 7).replace('-', ''), 'offer.publish', after.available_from);
}
// c. New seasons, delivered by title.update when each season was added.
for (const [titleId, n, created] of [['tt-mallinmere-nights', 2, '2025-10-26'], ['tt-sallowstead-general', 3, '2025-07-12']]) {
  const t = titleOf.get(titleId), s = t.seasons.find(x => x.season_number === n);
  const a = alert({kind: 'new_season', title_id: titleId, status: 'active', created_at: evening(created), known_seasons: t.seasons.filter(x => x.season_number < n).map(x => x.season_number)});
  usedForAccount.add(titleId);
  fire(a, null, n, 'season-' + slug(titleId) + '-' + n, 'title.update', s.added_at);
}
// d. Rules that ran out, were deleted, or are still waiting at the clock (nothing matched them).
const noArrival = (t, from, to) => !seed.offers.some(o => o.title_id === t.title_id && mineSub(o) && Date.parse(o.available_from) < Date.parse(to) &&
  (o.available_until === null || Date.parse(o.available_until) > Date.parse(from)));
for (const [created, until, status, deletedOn] of [['2025-04-09', '2025-07-31', 'active', null], ['2025-08-20', null, 'deleted', '2025-10-03'],
  ['2026-01-14', '2026-03-31', 'active', null], ['2026-06-02', null, 'deleted', '2026-07-19'], ['2026-09-27', '2027-03-31', 'active', null]]) {
  const from = evening(created), to = until ? la(until, '23:59') : CLOCK;
  const t = nextFilm(x => noArrival(x, from, until ? to : '2027-04-01T00:00:00Z'));
  alert({kind: 'available_on_my_services', title_id: t.title_id, status, created_at: from, expires_at: until ? to : null, updated_at: deletedOn ? evening(deletedOn) : from});
}

// e. Corrections, decided by correction.decision events with the notices the App writes.
const FIELD_LABEL = {runtime: 'runtime', release_date: 'release date', certification: 'certification', credit: 'credit', guide_item: 'parental guide'};
function decide(co, decision, note, at, n) {
  const eventId = co.correction_id + '-decision' + (n ? '-' + n : '');
  let version = null;
  if (decision === 'approved' && co.field === 'guide_item') {
    version = addGuideVersion(co.title_id, at, 'correction_approved', cats => {
      for (const cat of Object.values(cats)) for (const item of cat.items) if (item.item_id === co.target.item_id) Object.assign(item, structuredClone(co.proposed_value));
    });
  }
  co.decisions.push({decision, note, decided_at: at, event_id: eventId});
  co.status = decision; co.updated_at = at;
  const what = {approved: 'was approved', declined: 'was declined', needs_info: 'needs more information'}[decision];
  const text = 'Your ' + FIELD_LABEL[co.field] + ' correction for ' + titleOf.get(co.title_id).name + ' (' + Object.values(co.target)[0] + ') ' + what + (note ? ': ' + note : '.')
    + (version ? ' The parental guide is now at version ' + version + '.' : '');
  notice({at, kind: 'correction_decided', title_id: co.title_id, correction_id: co.correction_id, guide_version: version, event_id: eventId, text});
}
function correction(t, field, target, proposed, evidence, submitted) {
  const current = rules.currentValue(view(submitted), t.title_id, field, target);
  const co = {amended_at: null, withdrawn_at: null, decisions: [], correction_id: 'co-' + pad(seed.corrections.length + 1), title_id: t.title_id, field, target,
    proposed_value: proposed, current_value: current, evidence, status: 'submitted', submitted_at: submitted, updated_at: submitted};
  seed.corrections.push(co); added.corrections.push(co.correction_id); usedForAccount.add(t.title_id);
  return co;
}
const BETTER_ITEM = {
  'Occasional mild insults.': 'Occasional mild insults, and one strong word in the final argument.',
  'A few uses of mild language.': 'A few uses of mild language, mostly from the grandfather.',
  'Brief scuffles with no injuries shown.': 'Brief scuffles; one boy gets a bloody nose in the school yard.',
  'A shove and a fall played for laughs.': 'A man is shoved off a jetty into the harbour, played for laughs.',
  'A few tense moments in the dark.': 'A few tense moments in a dark cellar; a dog barks suddenly.',
  'Brief jump scares.': 'Two jump scares, both in the attic scene.',
  'Adults drink at a party.': 'Adults drink champagne at a wedding party; nobody is drunk.',
  'A character smokes a pipe.': 'The grandfather smokes a pipe in several scenes.',
  'A couple kisses briefly.': 'A couple kisses briefly at the station.',
  'Mild flirting.': 'Mild flirting between the two leads at a dance.',
};
const guideItemTitle = () => nextFilm(t => Object.values(guideOf.get(t.title_id).versions[0].categories).some(x => x.items.some(i => !i.spoiler && BETTER_ITEM[i.text])));
const itemOf = t => Object.values(guideOf.get(t.title_id).versions.at(-1).categories).flatMap(x => x.items).find(i => !i.spoiler && BETTER_ITEM[i.text]);
{
  // A runtime correction, declined.
  const t = nextFilm(x => x.editions.length === 1), ed = t.editions[0], at = evening('2025-02-19'), long = ed.runtime_minutes + 6;
  const on = seed.offers.find(o => o.title_id === t.title_id && o.region === 'US' && c.isCurrent(c.availability(o, Date.parse(at))));
  const co = correction(t, 'runtime', {edition_id: ed.edition_id}, long,
    `${on ? serviceName(on.service_id) + '\'s player' : 'The DVD case'} shows ${Math.floor(long / 60)} h ${long % 60} min for this film.`, at);
  decide(co, 'declined', 'The longer time on streaming players includes a trailer after the credits.', Z('2025-03-04', '17:00'));
}
{
  // A parental-guide item that understated a scene, approved: the guide gains a version.
  const t = guideItemTitle(), item = itemOf(t);
  const co = correction(t, 'guide_item', {item_id: item.item_id}, {text: BETTER_ITEM[item.text]}, 'I watched it with my daughter; the item does not describe the scene that matters.', evening('2025-05-11'));
  decide(co, 'approved', 'Checked against the film; the item now names the scene.', Z('2025-05-27', '17:00'));
}
{
  // A release date that was really a festival screening, declined.
  const t = nextFilm(), us = t.releases.find(x => x.region === 'US');
  const co = correction(t, 'release_date', {region: 'US'}, addDays(us.date, -9), `It premiered at a festival on ${md(addDays(us.date, -9))}, ${us.date.slice(0, 4)}.`, evening('2025-09-02'));
  decide(co, 'declined', 'Kinodex lists the first public release, not festival screenings.', Z('2025-09-16', '16:00'));
}
{
  // A UK certification correction that Dana withdrew the next morning.
  const t = nextFilm(x => x.releases.find(r => r.region === 'UK').certification !== '12A');
  const uk = t.releases.find(x => x.region === 'UK'), other = c.CERTIFICATIONS.UK.find(x => x !== uk.certification && ['PG', '12A', '15'].includes(x));
  const co = correction(t, 'certification', {region: 'UK'}, other, `A UK friend says the cinema poster showed ${other}.`, evening('2025-11-18'));
  co.status = 'withdrawn'; co.withdrawn_at = la('2025-11-19', '08:10'); co.updated_at = co.withdrawn_at;
}
{
  // A guide item that needed more information, amended once, then approved.
  const t = guideItemTitle(), item = itemOf(t);
  const co = correction(t, 'guide_item', {item_id: item.item_id}, {text: BETTER_ITEM[item.text]}, 'The item leaves out the scene that upset Mira.', evening('2026-01-21'));
  decide(co, 'needs_info', 'Which scene do you mean? Please describe it.', Z('2026-01-28', '17:00'));
  co.evidence = `The scene about an hour in: ${BETTER_ITEM[item.text].replace(/\.$/, '').toLowerCase()}.`;
  co.amended_at = evening('2026-01-31'); co.status = 'submitted'; co.updated_at = co.amended_at;
  co.current_value = rules.currentValue(view(co.amended_at), t.title_id, 'guide_item', co.target);
  decide(co, 'approved', 'Thanks for the detail; the item is updated.', Z('2026-02-10', '17:00'), 2);
  co.decisions[0].event_id = co.correction_id + '-decision-1';
  seed.notices.find(n => n.correction_id === co.correction_id && n.text.includes('needs more information')).event_id = co.correction_id + '-decision-1';
}
{
  // A character name spelling, declined.
  const t = nextFilm(), cr = creditsOf.get(t.title_id).find(x => x.role === 'actor' && x.billing_order === 3);
  const misspelt = cr.character.replace(/([aeiou])([^aeiou ])/, '$1$2$2');
  const co = correction(t, 'credit', {credit_id: cr.credit_id}, {character: misspelt}, `The end credits spell it ${misspelt}.`, evening('2026-08-16'));
  decide(co, 'declined', 'The production\'s cast list confirms the current spelling.', Z('2026-08-27', '16:00'));
}

// f. Lists, made on one evening each and not edited since.
const released = (t, d) => t.releases.every(x => x.date <= d);
function list(name, description, visibility, created, test, n) {
  const titles = shuffle(seed.titles.filter(t => t.kind === 'film' && !NAMED.includes(t.title_id) && released(t, created) && test(t))).slice(0, n).map(t => t.title_id);
  const at = evening(created);
  seed.lists.push({list_id: 'ls-' + pad(seed.lists.length + 1), name, description, visibility, version: 1, title_ids: titles, created_at: at, updated_at: at});
  added.lists.push('ls-' + pad(seed.lists.length));
}
list('Summer holiday films', 'For the long evenings in July.', 'private', '2025-06-21', t => t.genres.some(g => ['Adventure', 'Comedy', 'Family'].includes(g)), 7);
list('Halloween with Jules', 'Scary enough for Jules, not for Mira.', 'friends', '2025-10-11', t => t.genres.some(g => ['Thriller', 'Mystery', 'Crime'].includes(g)), 6);
list('Watch with Mira next', 'Family films the guide rates mild or less.', 'private', '2026-04-18',
  t => t.genres.includes('Family') && Object.values(guideOf.get(t.title_id).versions[0].categories).every(x => ['none', 'mild'].includes(x.severity)), 6);
// New notices are numbered in time order after the fixture's four.
seed.notices.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.notice_id.localeCompare(b.notice_id));
const fixtureNotices = new Set(fixture.notices.map(n => n.notice_id));
const renumber = new Map(seed.notices.filter(n => !fixtureNotices.has(n.notice_id)).map((n, i) => [n.notice_id, 'nt-' + pad(fixture.notices.length + 1 + i)]));
for (const a of seed.alerts) if (a.trigger && renumber.has(a.trigger.notice_id)) a.trigger.notice_id = renumber.get(a.trigger.notice_id);
for (const n of seed.notices) if (renumber.has(n.notice_id)) n.notice_id = renumber.get(n.notice_id);

// ---------- 6. Public reviews from mid-October to the end of 2026 ----------
// About one review every two days, as in the fixture; the reviews after the clock appear as time passes.
const recent = seed.titles.filter(t => usRelease(t) >= '2025-01-01' && !NAMED.includes(t.title_id));
let rvn = seed.public_reviews.length;
for (let d = '2026-10-15'; d <= '2026-12-31'; d = addDays(d, int(1, 3))) {
  const at = la(d, eveningTime()), date = d, month = Number(d.slice(5, 7));
  let t;
  if (d >= '2026-11-14' && d <= '2026-12-26' && chance(0.18)) t = titleOf.get('tt-sallowstead-general');
  else if (d >= '2026-12-10' && chance(0.15)) t = titleOf.get('tt-inspector-junivergate');
  else if (chance(0.35)) t = pick(recent);
  else if (month === 12 && chance(0.4)) t = pick(seed.titles.filter(x => x.genres.includes('Family') && !NAMED.includes(x.title_id)));
  else t = pick(seed.titles.filter(x => !NAMED.includes(x.title_id) && x.title_id !== 'tt-pellmoor-junction'));
  if (usRelease(t) > date) continue;
  const rating = int(2, 10) / 2, spoiler = chance(0.12);
  seed.public_reviews.push({review_id: 'rv-' + pad(++rvn, 4), title_id: t.title_id, author: pick(HANDLES), rating,
    text: publicText(t, rating, spoiler, at), contains_spoilers: spoiler, posted_at: at});
  added.public_reviews.push('rv-' + pad(rvn, 4));
}

// ---------- 7. US rental and purchase history before the fixture's own offers ----------
// The fixture opens no offer before 2025, and its rentals and purchases of older titles all start on
// 2026-01-02, so many of Dana's 2025 diary entries fell on days when the title could not be watched in the
// US at all. Each title therefore gets an earlier US rental window on one store, usually with a purchase
// window: from its digital release (45 days after the US release) or, for older titles, a day between
// January 2023 and August 2024. It closes when the title's first fixture rental or purchase in the US
// opens, or, for a title with none, on a day in October or early November 2026 when the store drops it.
// A title of the December scenario only gets a window that closes before its first fixture US offer of any
// type. Every window closes before 2026-11-15 and the dataset clock, and ended offers are not listed by
// default, so what the scenario and the dataset clock show is unchanged. A separate random stream, drawn
// only here, keeps every record written above byte-identical.
let historyState = GENERATOR_SEED + 7;
const r7 = () => {historyState |= 0; historyState = historyState + 0x6D2B79F5 | 0; let x = Math.imul(historyState ^ historyState >>> 15, 1 | historyState);
  x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296;};
const int7 = (a, b) => a + Math.floor(r7() * (b - a + 1));
const firstOpen = list => list.map(o => o.available_from).sort((a, b) => Date.parse(a) - Date.parse(b))[0];
let nextOffer = Math.max(...seed.offers.map(o => Number(o.offer_id.slice(3)))) + 1;
const historyOffers = [];
for (const t of seed.titles) {
  const fixtureUS = seed.offers.filter(o => o.title_id === t.title_id && o.region === 'US'), digital = addDays(usRelease(t), 45);
  const until = NAMED.includes(t.title_id) ? firstOpen(fixtureUS)
    : firstOpen(fixtureUS.filter(o => o.type === 'rent' || o.type === 'buy')) ?? la(addDays('2026-10-01', int7(0, 40)), '23:59');
  if (!until) continue;
  const from = Z(digital >= '2023-01-01' ? digital : addDays('2023-01-01', int7(0, 600))); // older titles: a day from Jan. 2023 to Aug. 2024
  if (Date.parse(from) >= Date.parse(until) || Date.parse(until) > Date.parse('2026-11-15T00:00:00Z')) continue;
  const store = int7(0, 1) ? 'tinlark' : 'brightreel', rent = int7(399, 599) / 100, add = (type, price, quality) => {
    const o = {offer_id: 'of-' + pad(nextOffer++, 5), title_id: t.title_id, edition_id: null, service_id: store, region: 'US', type, price,
      currency: 'USD', quality, available_from: from, available_until: until};
    seed.offers.push(o); historyOffers.push(o);
  };
  add('rent', Math.floor(rent) + 0.99, 'HD');
  if (int7(1, 10) <= 7) add('buy', int7(12, 19) + 0.99, int7(1, 10) <= 3 ? '4K' : 'HD');
}
added.offers = historyOffers.map(o => o.offer_id);
// Every diary entry is watchable on its date in the US (an offer of any type is open), or falls within 60
// days of the US release, when it could still be in cinemas.
const openOn = (o, d) => dateOf(o.available_from) <= d && (o.available_until === null || dateOf(o.available_until) > d);
const unwatchable = seed.diary.filter(e => {
  const t = titleOf.get(e.title_id), since = (dateMs(e.watched_on) - dateMs(usRelease(t))) / DAY;
  return !(since >= 0 && since <= 60) && !seed.offers.some(o => o.title_id === e.title_id && o.region === 'US' && openOn(o, e.watched_on));
});
if (unwatchable.length) throw Error('Diary entries with no US offer on watched_on: ' + unwatchable.map(e => e.entry_id).join(', '));
// No seeded rule may match a history window: price rules stay above it, and the others match subscriptions only.
for (const a of seed.alerts) {
  const end = a.trigger ? a.trigger.at : a.status === 'deleted' ? a.updated_at : a.expires_at;
  const clash = historyOffers.find(o => o.title_id === a.title_id && a.kind === 'price_below' && o.type === a.offer_type && o.price < a.threshold
    && Date.parse(o.available_from) < Date.parse(end ?? '2100-01-01T00:00:00Z') && Date.parse(o.available_until) > Date.parse(a.created_at));
  if (clash) throw Error('History offer ' + clash.offer_id + ' would match rule ' + a.alert_id);
}

// ---------- check, write ----------
const ctx = {app_id: 'kinodex', binding, virtual_now: CLOCK};
if (!compile(require('../schemas/seed.schema.json'), path.join(pkg, 'schemas'))(seed)) throw Error('The dataset does not match schemas/seed.schema.json');
plugin.validateSeed(ctx, seed);
const privateAfterClock = [...seed.diary.map(e => e.logged_at), ...seed.lists.map(l => l.created_at), ...seed.alerts.map(a => a.created_at),
  ...seed.corrections.map(x => x.submitted_at), ...seed.notices.map(n => n.at)].filter(x => Date.parse(x) > Date.parse(CLOCK));
if (privateAfterClock.length) throw Error('Dana\'s history must end at the clock: ' + privateAfterClock.join(', '));

// One record per line keeps the file reviewable in a diff and compact enough for one env.load_seed call.
function lines(value) {
  const parts = Object.entries(value).map(([k, v]) => Array.isArray(v) && v.length && typeof v[0] === 'object'
    ? `  ${JSON.stringify(k)}: [\n${v.map(x => '    ' + JSON.stringify(x)).join(',\n')}\n  ]`
    : `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  return '{\n' + parts.join(',\n') + '\n}\n';
}
fs.mkdirSync(outDir, {recursive: true});
const seedText = lines(seed);
fs.writeFileSync(path.join(outDir, 'seed.json'), seedText);
const write = (file, value) => fs.writeFileSync(path.join(outDir, file), JSON.stringify(value, null, 2) + '\n');
write('clock.json', {initial_time: CLOCK});
write('binding.json', binding);
write('policies.json', read('fixtures/policies.json'));
const base = read('contribution/dataset.json');
// Current-state objects (account settings, watchlist, lists) are stored once, as of their last change, and
// are not rewound to an earlier clock. The dataset reads exactly as stored from the latest of those stamps.
const VALID_FROM = [seed.account.updated_at, seed.watchlist.updated_at, ...seed.lists.map(l => l.updated_at)]
  .sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1);
write('dataset.json', {
  ...base, dataset_id: 'kinodex-evaluation-2025-2026', version: DATASET_VERSION,
  description: 'Synthetic evaluation catalog and one viewer account (Dana Marsh, US) covering 2025-01-01 through 2026-12-31 (America/Los_Angeles): the fixture catalog and account with one review or synopsis text per record, plus parental-guide updates, new seasons, public reviews to Dec. 30, 2026, and two years of alerts, corrections, notices and lists. Dana\'s history ends at the fixture clock (2026-12-01 09:00 -08:00). Loadable with env.load_seed at any clock in the window; Kinodex shows only the records that exist at the clock. The account settings, watchlist and lists are current state, stored as of their last change and not rewound, so the dataset reads exactly as stored from ' + VALID_FROM + ' (generation.parameters.current_state_valid_from); a Task that starts earlier supplies its own watchlist, list and settings state. expected_counts.records counts titles (plugin.records).',
  record_source_ids: ['authored', 'generated'],
  sources: [base.sources[0], {
    source_id: 'generated', kind: 'synthetic',
    description: 'Template-generated fictional review texts, episode synopses, guide updates, seasons and account history written by dev/build-dataset.cjs from the fixture\'s titles, people and word lists. All titles, people, services and reviews are invented; nothing was collected from real websites.',
    uri: null, license: 'MIT', usage: 'permitted', collection: null,
    generation: {method: 'template', tool: 'dev/build-dataset.cjs', tool_version: DATASET_VERSION, seed: GENERATOR_SEED,
      parameters: {window: WINDOW, time_zone: TIME_ZONE, clock: CLOCK, current_state_valid_from: VALID_FROM, base: 'fixtures/minimal.json',
        outputs: {'seed.json': {sha256: crypto.createHash('sha256').update(seedText).digest('hex'), bytes: Buffer.byteLength(seedText)}}}},
  }],
  transformations: [
    'Every fixture record is kept with its ID, dates, ratings and flags. Public review texts (except rv-lh-01), Dana\'s diary review texts (except her Wrenfield Clock review) and the synopses of the generated series\' episodes are rewritten, one text per record, because the fixture draws them from short phrase lists; repeated episode names within a series are renamed.',
    'Added records: guide versions, two seasons with their episodes, public reviews from 2026-10-15 to 2026-12-30, and Dana\'s alerts, corrections, notices and lists. Alert triggers, decision notices and guide versions are written as the App\'s events would write them.',
    'Added US rental and purchase windows before the fixture\'s own offers (' + historyOffers.length + ' offers, from a separate random stream): each opens at the title\'s digital release (45 days after the US release) or, for older titles, between January 2023 and August 2024, and closes when the fixture\'s first US rental or purchase opens, or in October or early November 2026. Every diary entry is then watchable in the US on its date or falls within 60 days of the US release (checked). The windows close before the dataset clock and before any seeded rule could match them (checked).',
  ],
  expected_counts: {records: seed.titles.length, assets: 0},
});
const summary = {rewritten, added: Object.fromEntries(Object.entries(added).map(([k, v]) => [k, v.length])),
  counts: {titles: seed.titles.length, episodes: seed.episodes.length, public_reviews: seed.public_reviews.length, diary: seed.diary.length, alerts: seed.alerts.length,
    corrections: seed.corrections.length, notices: seed.notices.length, lists: seed.lists.length, guide_versions: seed.guides.reduce((n, g) => n + g.versions.length, 0)},
  bytes: Buffer.byteLength(seedText), compact_bytes: Buffer.byteLength(JSON.stringify(seed))};
console.log(JSON.stringify(summary, null, 1));
