'use strict';
// Maintainer script (not run by tests or the verifier). Builds the Dayline evaluation dataset in
// data/evaluation/: one reader seed covering 2025-01-01 through 2026-12-31 that keeps the 25 fixture
// editions, Ana's fixture history and the fixture front pages verbatim and adds two years of
// coverage around them. Deterministic: the same script writes the same bytes.
// Usage, from the package directory: node dev/build-dataset.cjs
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const pkg = path.resolve(__dirname, '..');
const outDir = path.join(pkg, 'data/evaluation');
const fixture = JSON.parse(fs.readFileSync(path.join(pkg, 'fixtures/minimal.json'), 'utf8'));
const DATASET_VERSION = '1.0.0';
const CLOCK = '2026-10-14T07:00:00-07:00'; // the fixture clock: Ana's history ends here, the catalog runs on
const FIXTURE_START = Date.parse('2026-10-12T00:00:00-07:00'); // generated editions skip the fixture window

// ---------- deterministic helpers ----------
let state = 20250101;
const rng = () => {state |= 0; state = state + 0x6D2B79F5 | 0; let t = Math.imul(state ^ state >>> 15, 1 | state);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296;};
const int = (a, b) => a + Math.floor(rng() * (b - a + 1));
const pick = list => list[Math.floor(rng() * list.length)];
const chance = p => rng() < p;
const shuffle = list => {const a = [...list]; for (let i = a.length - 1; i > 0; i--) {const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]];} return a;};
const pad = n => String(n).padStart(2, '0');
const money = n => n.toLocaleString('en-US');

// Calendar in America/Los_Angeles. DST: second Sunday of March to first Sunday of November.
const DAY = 86400000;
const ymd = ms => new Date(ms).toISOString().slice(0, 10);
const dateMs = d => Date.parse(d + 'T00:00:00Z');
const weekday = d => new Date(dateMs(d)).getUTCDay(); // 0 Sunday
const nthSunday = (y, m, n) => {let d = 1; while (new Date(Date.UTC(y, m - 1, d)).getUTCDay() !== 0) d++; return d + 7 * (n - 1);};
function laOffset(d) {
  const [y, m, day] = d.split('-').map(Number), md = m * 100 + day;
  return md >= 300 + nthSunday(y, 3, 2) && md < 1100 + nthSunday(y, 11, 1) ? '-07:00' : '-08:00';
}
const la = (d, hm) => `${d}T${hm}:00${laOffset(d)}`;
function formatLA(ms) {
  for (const off of ['-07:00', '-08:00']) {
    const hours = Number(off.slice(1, 3)), local = new Date(ms - hours * 3600000).toISOString();
    if (laOffset(local.slice(0, 10)) === off) return local.slice(0, 19) + off;
  }
  throw Error('unreachable');
}
const days = (from, to) => {const out = []; for (let t = dateMs(from); t <= dateMs(to); t += DAY) out.push(ymd(t)); return out;};
const addDays = (d, n) => ymd(dateMs(d) + n * DAY);
const MONTHS = ['Jan.', 'Feb.', 'March', 'April', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAYS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const ap = d => {const [, m, day] = d.split('-').map(Number); return `${MONTHS[m - 1]} ${day}`;};
const es = d => {const [, m, day] = d.split('-').map(Number); return `${day} de ${MONTHS_ES[m - 1]}`;};
const dayName = d => WEEKDAYS[weekday(d)];
const monthName = m => ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1];

// ---------- records ----------
const editions = [], stories = new Map(), ids = new Set();
function story(story_id, title) {
  if (!stories.has(story_id)) stories.set(story_id, {story_id, title, created_at: null});
  return story_id;
}
const BYLINES = {
  tallywire: ['Dana Ruiz, Tallywire', 'Joon Park, Tallywire', 'Tallywire staff', 'Hannah Velez, Tallywire'],
  'valley-daily': ['Priya Natarajan', 'Owen Marsh', 'Mara Bell', 'Teresa Quill'],
  'harbor-ledger': ['Nate Alvarez', 'Celia Hart', 'Harbor Ledger staff'],
  'capitol-courier': ['Lena Okafor', 'Marcus Webb', 'Ivy Lindqvist'],
  'national-standard': ['Grace Holloway', 'Samuel Price', 'Ruth Adeyemi', 'Daniel Osei'],
  'el-faro': ['Lucía Fernández', 'Martín Ocampo', 'Redacción El Faro'],
};
const OUTLET_TZ = {'el-faro': '-03:00'};
// published_at is the publisher's local time; added_at (when Dayline shows it) is one to three minutes later.
function add({id, story_id, outlet, section, geography, language = 'en', date, time, headline, byline, text, credits = []}) {
  if (ids.has(id)) throw Error('duplicate edition ' + id);
  let published_at;
  if (OUTLET_TZ[outlet]) {
    const ms = Date.parse(la(date, time));
    const local = new Date(ms - 3 * 3600000).toISOString().slice(0, 19);
    published_at = local + OUTLET_TZ[outlet];
  } else published_at = la(date, time);
  const added_at = formatLA(Date.parse(published_at) + int(1, 3) * 60000);
  if (Date.parse(added_at) >= FIXTURE_START && Date.parse(added_at) <= Date.parse(CLOCK)) return null;
  ids.add(id);
  const e = {edition_id: id, story_id, outlet_id: outlet, section, geography, language, headline,
    byline: byline ?? pick(BYLINES[outlet]), text, credits, published_at, added_at};
  editions.push(e);
  return e;
}
const later = (t, minutes) => {const [h, m] = t.split(':').map(Number); const x = Math.min(h * 60 + m + minutes, 23 * 60 + 50); return pad(Math.floor(x / 60)) + ':' + pad(x % 60);};
// A member paper republishes a dispatch word for word, with credit.
function reprint(source, outlet, minutes, headline, credit, geography = source.geography) {
  if (!source) return null;
  const t = source.published_at.slice(11, 16);
  return add({id: source.edition_id + '-' + outlet.split('-')[0], story_id: source.story_id, outlet, section: source.section,
    geography, date: source.published_at.slice(0, 10), time: later(t, minutes), headline, byline: source.byline,
    text: source.text, credits: [{edition_id: source.edition_id, credit}]});
}
const cite = (e, credit) => e ? [{edition_id: e.edition_id, credit}] : [];

// ---------- beat: Harbor City Gulls (sports) ----------
const GULLS = {
  hitters: ['Leo Ortega', 'Danny Cho', 'Mateo Ruiz', 'Jonah Pike', 'Kenji Sato', 'Andre Moss', 'Wes Calloway', 'Felix Romero'],
  pitchers: ['Sam Kessler', 'Eli Brandt', 'Tomás Vega', 'Ray Whitfield', 'Colin Ashby'],
  relievers: ['Nico Baptiste', 'Gabe Lindell', 'Arturo Salas'],
};
const OPPONENTS = [
  {city: 'Ridgeview', name: 'Owls', park: 'Ridgeview'}, {city: 'Lakeport', name: 'Herons', park: 'Lakeport'},
  {city: 'Cinder Bay', name: 'Pelicans', park: 'Cinder Bay'}, {city: 'Northgate', name: 'Foxes', park: 'Northgate'},
  {city: 'Kestrel Point', name: 'Otters', park: 'Kestrel Point'}, {city: 'Granby', name: 'Millers', park: 'Granby'},
];
const HITS = ['a two-run double', 'a solo homer', 'a bases-loaded single', 'a sacrifice fly', 'a three-run homer',
  'an RBI triple', 'a two-out single', 'a run-scoring groundout'];
function gullsSeason(year, open, close, playoffs, tail) {
  let wins = 0, losses = 0;
  const schedule = [];
  let d = open, series = 0;
  while (d <= close) {
    const opp = OPPONENTS[series % OPPONENTS.length], home = series % 2 === 0;
    for (let g = 0; g < 3; g++) schedule.push({date: addDays(d, g), opp, home, game: g});
    // A day off after every second series.
    d = addDays(d, series % 2 === 1 ? 4 : 3); series++;
  }
  // The fixture fixes the end of the 2026 season; replace the generated games from that point.
  if (tail) schedule.splice(0, schedule.length, ...schedule.filter(g => g.date < tail.from), ...tail.games);
  const weeks = new Set();
  for (const g of schedule) {
    if (g.fixture) {g.won ? wins++ : losses++; continue;} // played in the fixture's own editions
    if (Date.parse(la(g.date, '23:00')) >= FIXTURE_START && Date.parse(la(g.date, '00:00')) <= Date.parse(CLOCK) + DAY) continue;
    const us = int(0, 8), them = int(0, 7) === us ? int(0, 7) : int(0, 7);
    const extra = us === them; const ours = extra ? us + 1 : us;
    const won = extra ? chance(0.55) : ours > them;
    const [gs, os] = won ? [Math.max(ours, them + 1), Math.min(them, ours)] : [Math.min(ours, them), Math.max(them, ours + 1)];
    won ? wins++ : losses++;
    const where = g.home ? 'at Pier Park' : `in ${g.opp.city}`;
    const vs = g.home ? `${g.opp.name} at Gulls` : `Gulls at ${g.opp.name}`;
    const sid = story(`gulls-${g.date}`, `${vs}, ${ap(g.date)}`);
    const starter = pick(GULLS.pitchers), hero = pick(GULLS.hitters), hit = pick(HITS), inning = extra ? int(10, 11) : int(1, 9);
    const time = g.home ? (weekday(g.date) === 0 ? '13:05' : '19:05') : (weekday(g.date) === 0 ? '13:10' : '19:10');
    const stamp = g.date.replace(/-/g, '');
    // Series openers get a scoreboard-free preview; most games get a recap, some also a wire brief.
    if (g.game === 0 && chance(0.7)) {
      add({id: `gulls-${stamp}-preview`, story_id: sid, outlet: 'harbor-ledger', section: 'sports', geography: 'harbor-city',
        date: g.date, time: '11:' + pad(int(0, 50)), byline: 'Nate Alvarez',
        headline: pick([`Gulls open ${g.home ? 'homestand' : 'road trip'} against ${g.opp.city}`, `${starter} gets the ball as Gulls meet the ${g.opp.name}`, `Gulls and ${g.opp.name} begin three-game set ${where}`]),
        text: `The Harbor City Gulls ${g.home ? 'host' : 'visit'} the ${g.opp.city} ${g.opp.name} ${where} ${dayName(g.date)}, ${ap(g.date)}, first pitch at ${time === '13:05' || time === '13:10' ? '1:' + time.slice(3) + ' p.m.' : '7:' + time.slice(3) + ' p.m.'} local time. ${starter} starts for Harbor City. ` +
          pick([`${hero} has hit safely in ${int(4, 11)} of his last ${int(12, 14)} games.`, `Manager Tom Ferrante said ${pick(GULLS.hitters)} would get a day off in the series.`, `The Gulls have ${pick(['won', 'lost'])} ${int(2, 4)} of their last five meetings with ${g.opp.city}.`, `${pick(GULLS.relievers)} is available after two days off.`]) +
          ` Harbor City ${wins + losses ? `is ${wins}-${losses}` : 'opens its season'} ${pick(['entering the series', 'going in', 'before the first game'])}, and the series continues ${dayName(addDays(g.date, 1))} and ${dayName(addDays(g.date, 2))}.`});
    }
    if (!chance(0.5)) continue;
    const lead = won
      ? `${hero} hit ${hit} in the ${ordinal(inning)} inning and the Harbor City Gulls beat the ${g.opp.city} ${g.opp.name} ${gs}-${os} ${where} on ${dayName(g.date)}${extra ? ' in extra innings' : ''}.`
      : `The ${g.opp.city} ${g.opp.name} beat the Harbor City Gulls ${os}-${gs} ${where} on ${dayName(g.date)}${extra ? ' in extra innings' : ''}, despite ${hero}'s ${hit.replace(/^an? /, '')} in the ${ordinal(inning)}.`;
    const detail = pick([
      `${starter} ${won ? 'allowed' : 'gave up'} ${int(1, 5)} runs over ${int(4, 7)} innings.`,
      `${starter} struck out ${int(3, 10)} and walked ${int(0, 4)}.`,
      `${pick(GULLS.relievers)} pitched a scoreless ${ordinal(int(7, 9))}.`,
      `${pick(GULLS.hitters)} finished with ${int(2, 4)} hits.`]);
    const tail = `Harbor City is ${wins}-${losses}.` + (g.game < 2 ? ` The teams play again ${dayName(addDays(g.date, 1))}.` : '');
    const recap = add({id: `gulls-${stamp}-recap`, story_id: sid, outlet: 'harbor-ledger', section: 'sports', geography: 'harbor-city',
      date: g.date, time: g.home || weekday(g.date) === 0 ? (weekday(g.date) === 0 ? '16:' + pad(int(20, 55)) : '22:' + pad(int(10, 50))) : '22:' + pad(int(15, 55)),
      byline: 'Nate Alvarez',
      headline: won ? pick([`${hero.split(' ')[1]} leads Gulls past ${g.opp.name}, ${gs}-${os}`, `Gulls top ${g.opp.name} ${gs}-${os}`, `${hero.split(' ')[1]}'s ${hit.split(' ').slice(-1)[0]} lifts Gulls over ${g.opp.city}`])
        : pick([`${g.opp.name} hold off Gulls, ${os}-${gs}`, `Gulls fall to ${g.opp.name} ${os}-${gs}`, `${g.opp.city} beats Harbor City ${os}-${gs}`]),
      text: `${lead} ${detail} ${tail}`});
    if (recap && chance(0.4)) {
      add({id: `gulls-${stamp}-wire`, story_id: sid, outlet: 'tallywire', section: 'sports', geography: 'harbor-city',
        date: g.date, time: later(recap.published_at.slice(11, 16), int(8, 20)), byline: 'Tallywire staff',
        headline: won ? `Gulls beat ${g.opp.name} ${gs}-${os}` : `${g.opp.name} beat Gulls ${os}-${gs}`,
        text: lead.replace(/ on (Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)/, ' on $1 night').replace('night in extra', 'in extra') + ` Harbor City is ${wins}-${losses}.`});
    }
    // A weekly, scoreboard-free schedule note in the existing schedule story group.
    const week = Math.floor((dateMs(g.date) - dateMs(open)) / (7 * DAY));
    if (!weeks.has(week) && weekday(g.date) === 1) {
      weeks.add(week);
      const next = schedule.filter(x => x.date > g.date).slice(0, 3);
      if (next.length) {
        add({id: `gulls-schedule-${stamp}`, story_id: story('gulls-schedule', 'Gulls schedule'), outlet: 'harbor-ledger',
          section: 'sports', geography: 'harbor-city', date: g.date, time: '06:' + pad(int(20, 40)), byline: 'Harbor Ledger Sports Desk',
          headline: `Gulls schedule: ${next[0].home ? 'home against the ' + next[0].opp.name : 'at ' + next[0].opp.city} this week`,
          text: `The Harbor City Gulls' next games: ` + next.map(x => `${dayName(x.date)}, ${ap(x.date)}: ${x.home ? 'vs.' : 'at'} ${x.opp.city} ${x.opp.name}`).join('; ') +
            `. Home games start at 7:05 p.m. (1:05 p.m. on Sundays) at Pier Park. Every game airs on Coastline Sports Network; radio coverage is on KHRB 1090 AM.`});
      }
    }
  }
  if (playoffs) playoffs(wins, losses);
  return {wins, losses};
}
const ordinal = n => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');

function gulls() {
  gullsSeason(2025, '2025-04-04', '2025-10-19', (w, l) => {
    const sid = story('gulls-2025-postseason', 'Gulls 2025 postseason');
    add({id: 'gulls-20251022-semis', story_id: sid, outlet: 'harbor-ledger', section: 'sports', geography: 'harbor-city', date: '2025-10-22', time: '22:40', byline: 'Nate Alvarez',
      headline: 'Gulls eliminated by Owls in division semifinal',
      text: `The Ridgeview Owls ended the Harbor City Gulls' season with a 3-1 win in the deciding game of their division semifinal on Wednesday. The Gulls finished the regular season ${w}-${l}. Manager Tom Ferrante said Leo Ortega's hamstring would be examined again in the offseason.`});
    add({id: 'gulls-20251104-offseason', story_id: sid, outlet: 'harbor-ledger', section: 'sports', geography: 'harbor-city', date: '2025-11-04', time: '09:15', byline: 'Celia Hart',
      headline: 'Gulls keep Ferrante for 2026, add pitching coach',
      text: 'The Harbor City Gulls extended manager Tom Ferrante through the 2026 season and hired former reliever Dale Whitcomb as pitching coach, general manager Rhea Song said Tuesday. Pier Park will get new lights before opening day.'});
  });
  // Fixture facts: Oct. 13 home makeup win over Ridgeview, off Oct. 14-15, three games at Lakeport Oct. 16-18,
  // 11 games left after Oct. 13.
  const [owls, herons, pelicans, foxes] = OPPONENTS;
  const series = (from, opp, home, n = 3) => Array.from({length: n}, (_, game) => ({date: addDays(from, game), opp, home, game}));
  const tail2026 = {from: '2026-10-12', games: [{date: '2026-10-13', opp: owls, home: true, game: 0, fixture: true, won: true},
    ...series('2026-10-16', herons, false), ...series('2026-10-20', foxes, true), ...series('2026-10-23', pelicans, false), ...series('2026-10-27', owls, true, 2)]};
  gullsSeason(2026, '2026-04-10', '2026-10-28', () => {
    const sid = story('gulls-2026-postseason', 'Gulls 2026 postseason');
    add({id: 'gulls-20261030-clinch', story_id: sid, outlet: 'harbor-ledger', section: 'sports', geography: 'harbor-city', date: '2026-10-30', time: '07:30', byline: 'Nate Alvarez',
      headline: 'Gulls open division series at Pier Park on Monday',
      text: 'The Harbor City Gulls will open a best-of-five Shoreline Division series against the Ridgeview Owls at Pier Park on Monday, Nov. 2, at 7:05 p.m. Games 3 and, if needed, 4 are in Ridgeview. Tickets go on sale Friday at 10 a.m.'});
    add({id: 'gulls-20261106-series', story_id: sid, outlet: 'harbor-ledger', section: 'sports', geography: 'harbor-city', date: '2026-11-06', time: '22:30', byline: 'Nate Alvarez',
      headline: 'Gulls win division series in four games',
      text: 'Sam Kessler struck out nine over seven innings and the Harbor City Gulls beat the Ridgeview Owls 4-2 on Friday to win their Shoreline Division series three games to one. Harbor City plays the Lakeport Herons for the league title starting Nov. 13.'});
    add({id: 'gulls-20261120-final', story_id: sid, outlet: 'harbor-ledger', section: 'sports', geography: 'harbor-city', date: '2026-11-20', time: '22:45', byline: 'Nate Alvarez',
      headline: 'Herons beat Gulls in Game 6 to take league title',
      text: 'The Lakeport Herons won the league championship with a 6-3 win over the Harbor City Gulls in Game 6 on Friday in Lakeport. Leo Ortega had two hits in his final game of the season. The Gulls report for spring training in February.'});
    add({id: 'gulls-20261210-offseason', story_id: sid, outlet: 'harbor-ledger', section: 'sports', geography: 'harbor-city', date: '2026-12-10', time: '10:05', byline: 'Celia Hart',
      headline: 'Ortega signs two-year extension with Gulls',
      text: 'Shortstop Leo Ortega, the Eastbank High graduate whose extra-inning double beat Ridgeview in October, signed a two-year contract extension with the Harbor City Gulls on Thursday. Terms were not disclosed.'});
  }, tail2026);
}

// ---------- beat: Valley Line and Valley Regional Transit ----------
function transit() {
  const fares = story('valley-line-fares-2025', 'Valley Line fare increase');
  const a = add({id: 'transit-20250114-hearing', story_id: fares, outlet: 'valley-daily', section: 'transport', geography: 'valley', date: '2025-01-14', time: '06:10', byline: 'Priya Natarajan',
    headline: 'Transit agency proposes first Valley Line fare increase since 2019',
    text: 'Valley Regional Transit staff have proposed raising the base Valley Line fare from $2.50 to $2.75 on July 1, the first increase since 2019. Monthly passes would rise from $80 to $88. The board will hold a public hearing Feb. 11 at the Millbrook headquarters; written comments are due Feb. 7.'});
  add({id: 'transit-20250211-hearing', story_id: fares, outlet: 'valley-daily', section: 'transport', geography: 'valley', date: '2025-02-11', time: '21:30', byline: 'Priya Natarajan',
    headline: 'Riders crowd hearing on proposed Valley Line fare increase',
    text: 'About 90 riders spoke at Tuesday night\'s Valley Regional Transit hearing on a 25-cent fare increase, most of them asking the board to keep the monthly pass at $80. Several Alder Creek riders said trains already run too rarely after 8 p.m. The board will vote March 11.', credits: cite(a, 'Earlier Valley Daily reporting on the proposal')});
  const v = add({id: 'transit-20250311-vote', story_id: fares, outlet: 'tallywire', section: 'transport', geography: 'valley', date: '2025-03-11', time: '19:20', byline: 'Dana Ruiz, Tallywire',
    headline: 'Valley transit board raises fare to $2.75, keeps monthly pass at $84',
    text: 'The Valley Regional Transit board voted 5-2 on Tuesday to raise the base Valley Line fare to $2.75 on July 1. After a hearing in which riders objected to the pass increase, the board set the monthly pass at $84 instead of the proposed $88. Reduced fares for seniors and students stay at $1.25.'});
  reprint(v, 'valley-daily', 45, 'Valley Line fare going up to $2.75 in July', 'Tallywire');
  add({id: 'transit-20250701-fare', story_id: fares, outlet: 'valley-daily', section: 'transport', geography: 'valley', date: '2025-07-01', time: '05:45', byline: 'Owen Marsh',
    headline: 'New Valley Line fares take effect today',
    text: 'The base Valley Line fare is $2.75 starting Tuesday, and the monthly pass is $84. Ticket machines at all 11 stations were updated overnight, Valley Regional Transit said. Passes bought in June remain valid through July 31.'});
  const service = story('valley-line-service', 'Valley Line service changes');
  for (const [d, h, t] of [
    ['2025-06-02', 'Valley Line adds late trains for summer', 'Valley Regional Transit will add two weekday trains leaving Millbrook at 9:40 and 10:40 p.m. from June 9 through Aug. 29. The agency said evening ridership rose 14% last summer.'],
    ['2025-09-16', 'Valley Line ridership tops pre-pandemic level for first time', 'The Valley Line carried 1.21 million riders from January through August, 3% more than in the same months of 2019, Valley Regional Transit reported Tuesday. Weekend ridership grew fastest, up 9% from last year.'],
    ['2025-11-18', 'Valley Line holiday schedule announced', 'Valley Line trains will run on a Sunday schedule on Thanksgiving, Christmas Day and New Year\'s Day. Extra trains will serve the Holiday Lights Parade in Millbrook on Dec. 6, the agency said.'],
    ['2026-02-10', 'Transit agency orders six new railcars', 'The Valley Regional Transit board approved a $31 million order for six railcars on Tuesday, replacing cars that entered service in 1998. The first two are due in late 2027.'],
  ]) add({id: `transit-${d.replace(/-/g, '')}-service`, story_id: service, outlet: 'valley-daily', section: 'transport', geography: 'valley', date: d, time: '06:' + pad(int(0, 30)), headline: h, text: t});
  // The April 2026 flood behind the October vote.
  const flood = story('valley-floods-2026', 'Valley flooding, April 2026');
  const f1 = add({id: 'flood-20260407-rain', story_id: flood, outlet: 'valley-daily', section: 'environment', geography: 'valley', date: '2026-04-07', time: '05:50', byline: 'Teresa Quill',
    headline: 'Alder Creek over its banks after record April rain',
    text: 'Alder Creek rose above flood stage overnight after 4.8 inches of rain fell on Valley County in 36 hours, the most for any April storm on record. Valley Regional Transit suspended Valley Line service between Millbrook and Eastbank before dawn, and the county opened a shelter at the Millbrook fairgrounds.'});
  const f2 = add({id: 'flood-20260408-damage', story_id: story('rail-funding', 'Valley Line repair funding'), outlet: 'tallywire', section: 'transport', geography: 'valley', date: '2026-04-08', time: '16:20', byline: 'Dana Ruiz, Tallywire',
    headline: 'Floodwater damaged Valley Line tracks and three stations, agency says',
    text: 'Floodwater from Alder Creek washed out about 600 feet of Valley Line track and flooded the Eastbank, Alder Creek and Riverside stations, Valley Regional Transit said Wednesday. Trains will run every 40 minutes between Millbrook and Harbor City, with buses replacing trains east of Millbrook until repairs are made.', credits: cite(f1, 'Valley Daily reporting')});
  reprint(f2, 'harbor-ledger', 30, 'Valley Line flood damage will cut service for months', 'Tallywire');
  const repair = 'rail-funding';
  for (const [d, h, t, outlet] of [
    ['2026-04-21', 'Buses replace Valley Line trains east of Millbrook', 'Shuttle buses now run every 20 minutes between Millbrook and Eastbank, stopping near each closed station. The trip takes about 25 minutes longer than the train, the agency said.', 'valley-daily'],
    ['2026-05-19', 'Valley Line repairs could cost $40 million to $55 million', 'An engineering review puts Valley Line flood repairs at $40 million to $55 million, Valley Regional Transit staff told the board Tuesday. Federal disaster aid could cover part of the track work but not the stations, staff said.', 'valley-daily'],
    ['2026-06-16', 'Transit board delays decision on Valley Line repairs', 'The Valley Regional Transit board postponed a vote on Valley Line repairs until fall so staff can apply for federal disaster aid. Riders at the meeting urged the board to repair Eastbank first because its bus replacement is the slowest.', 'valley-daily'],
    ['2026-08-11', 'Federal aid will cover $17 million of Valley Line repairs', 'The federal disaster agency approved $17 million toward rebuilding Valley Line track damaged in April, Valley Regional Transit said Tuesday. The agency will ask its board to borrow the rest of the estimated cost.', 'tallywire'],
    ['2026-09-22', 'Staff request $48 million for Valley Line repairs', 'Valley Regional Transit staff asked the board Tuesday to approve $48 million for Valley Line flood repairs, using $17 million in federal aid and $31 million in bonds. The board scheduled its vote for Oct. 13.', 'valley-daily'],
    ['2026-11-17', 'Transit agency seeks bids to rebuild Valley Line track', 'Valley Regional Transit opened bidding Tuesday for the track portion of the Valley Line repairs. Bids are due Jan. 12, and the board expects to award the contract in February.', 'valley-daily'],
    ['2026-12-08', 'Valley Line weekend closures to start in March', 'Valley Line trains will not run east of Millbrook on eight weekends between March and June 2027 while crews rebuild the Eastbank station platform, the first of the three flooded stations to be repaired, the agency said Tuesday.', 'valley-daily'],
  ]) add({id: `rail-${d.replace(/-/g, '')}`, story_id: repair, outlet, section: 'transport', geography: 'valley', date: d, time: '06:' + pad(int(5, 35)), headline: h, text: t});
}

// ---------- beat: Calder state politics ----------
const BILLS = [
  {id: 'housing-permits', title: 'Calder housing permit bill', subject: 'speed up permits for homes near transit', number: 'SB 112'},
  {id: 'water-rights', title: 'Calder groundwater bill', subject: 'require metering of large agricultural wells', number: 'AB 406'},
  {id: 'wildfire-insurance', title: 'Calder wildfire insurance bill', subject: 'limit insurer cancellations in high fire-risk areas', number: 'SB 58'},
  {id: 'school-meals', title: 'Calder school meals bill', subject: 'provide free breakfast in every public school', number: 'AB 219'},
  {id: 'minimum-wage', title: 'Calder minimum wage bill', subject: 'raise the state minimum wage to $18 by 2027', number: 'SB 301'},
  {id: 'broadband', title: 'Calder rural broadband bill', subject: 'fund fiber lines to 40,000 rural homes', number: 'AB 77'},
  {id: 'tenant-notice', title: 'Calder rent notice bill', subject: 'require 90 days\' notice for rent increases over 5%', number: 'AB 512'},
  {id: 'ebike-rules', title: 'Calder e-bike safety bill', subject: 'set an age limit of 14 for riding e-bikes', number: 'SB 260'},
];
const LAWMAKERS = ['Sen. Paula Reyes', 'Sen. Gordon Pratt', 'Assemblymember Nadia Farouk', 'Assemblymember Chris Lyle', 'Sen. Martin Oyelaran', 'Assemblymember June Halvorsen'];
function calder() {
  for (const year of [2025, 2026]) {
    const bills = shuffle(BILLS).slice(0, 5);
    for (const [i, b] of bills.entries()) {
      const sid = story(`calder-${b.id}-${year}`, `${b.title}, ${year}`);
      const author = pick(LAWMAKERS);
      const intro = addDays(`${year}-01-${pad(int(12, 28))}`, i * 3);
      const committee = addDays(intro, int(30, 60)), floor = addDays(committee, int(25, 45)), second = addDays(floor, int(20, 40));
      const fate = chance(0.7);
      const steps = [
        [intro, `Bill would ${b.subject}`, `${author} introduced ${b.number} on ${dayName(intro)}, a bill that would ${b.subject}. ${pick(['Supporters include several county governments.', 'A similar bill died in committee two years ago.', 'The governor\'s office has not taken a position.'])}`],
        [committee, `${b.number} clears first committee`, `A Calder ${pick(['Senate', 'Assembly'])} committee voted ${int(6, 9)}-${int(2, 4)} on ${dayName(committee)} to advance ${b.number}, which would ${b.subject}. ${pick(['Business groups asked for a delayed start date.', 'Amendments narrowed the bill to larger counties.', 'Opponents said the cost estimate was too low.'])}`],
        [floor, `${pick(['Senate', 'Assembly'])} passes ${b.number}`, `The ${pick(['Senate', 'Assembly'])} passed ${b.number} ${int(21, 26)}-${int(12, 17)} on ${dayName(floor)}. The bill would ${b.subject}. It now goes to the other chamber.`],
        [second, fate ? `Gov. Delgado signs ${b.number}` : `${b.number} stalls in second chamber`, fate
          ? `Gov. Rosa Delgado signed ${b.number} on ${dayName(second)}. The law will ${b.subject.replace(/^(require|provide|raise|limit|speed up|fund|set)/, m => m)} starting ${pick(['Jan. 1', 'July 1'])}, ${year + 1}.`
          : `${b.number}, which would ${b.subject}, did not get a vote before the committee deadline ${dayName(second)} and is dead for the year, ${author.replace(/^(Sen\.|Assemblymember) /, '')} said.`],
      ];
      for (const [k, [d, h, t]] of steps.entries()) {
        if (d.slice(0, 4) !== String(year)) continue;
        const e = add({id: `calder-${b.id}-${year}-${k}`, story_id: sid, outlet: 'capitol-courier', section: 'politics', geography: 'calder', date: d, time: pick(['06:15', '12:40', '17:30', '19:05']), headline: h, text: t});
        if (e && k === 3 && fate) reprint(e, 'tallywire', int(20, 60), `Calder governor signs ${b.number}`, 'Capitol Courier');
      }
    }
  }
  // The two-year budget that passes in the fixture on Oct. 13-14, 2026.
  const budget = 'calder-budget';
  for (const [d, outlet, h, t] of [
    ['2026-01-09', 'capitol-courier', 'Delgado proposes $61 billion two-year budget', 'Gov. Rosa Delgado proposed a $61.2 billion two-year budget on Friday that includes an $800 child-care tax credit and a 2% raise for state workers. Senate leaders said the credit was too small.'],
    ['2026-03-17', 'capitol-courier', 'Senate plan doubles child-care credit to $1,200', 'Senate budget writers released a plan Tuesday with a $1,200 child-care tax credit per child under 6, paid for in part by drawing $2.1 billion from state reserves. Assembly leaders called the reserve draw risky.'],
    ['2026-06-30', 'capitol-courier', 'Calder misses budget deadline; stopgap keeps state running', 'Calder lawmakers missed the June 30 budget deadline for the first time since 2011. Both chambers approved a 90-day stopgap that keeps agencies open at current spending through Sept. 30.'],
    ['2026-09-29', 'capitol-courier', 'Second stopgap extends Calder spending to Oct. 31', 'With the child-care credit still unresolved, lawmakers passed a second stopgap Tuesday that extends current spending through Oct. 31. The Senate and Assembly plans are $400 per child apart.'],
    ['2026-10-15', 'capitol-courier', 'Delgado signs budget with $1,000 child-care credit', 'Gov. Rosa Delgado signed Calder\'s $61.4 billion two-year budget on Thursday, ending a stalemate that required two stopgap measures. The $1,000 child-care credit for children under 6 can be claimed on 2026 returns.'],
  ]) {
    const e = add({id: `budget-${d.replace(/-/g, '')}`, story_id: budget, outlet, section: 'politics', geography: 'calder', date: d, time: '17:' + pad(int(0, 40)), headline: h, text: t});
    if (e && d === '2026-10-15') reprint(e, 'tallywire', 25, 'Calder governor signs two-year budget', 'Capitol Courier');
  }
  // November 2026 legislative elections.
  const elex = story('calder-elections-2026', 'Calder legislative elections, Nov. 2026');
  for (const [d, h, t] of [
    ['2026-09-08', 'Calder ballots go out Oct. 5 for November legislative races', 'County election offices will mail ballots for the Nov. 3 legislative election starting Oct. 5. All 80 Assembly seats and 19 of 38 Senate seats are on the ballot.'],
    ['2026-11-04', 'Democrats keep both chambers in Calder', 'Democrats kept control of the Calder Senate and Assembly in Tuesday\'s election, according to early returns, though the Assembly margin narrowed by three seats. Counting will continue through the week.'],
    ['2026-12-07', 'New Calder Legislature sworn in', 'The new Calder Legislature was sworn in Monday. Assembly Speaker Ana Whitford said the first priority would be wildfire insurance, after a bill on cancellations stalled this year.'],
  ]) add({id: `elex-${d.replace(/-/g, '')}`, story_id: elex, outlet: 'capitol-courier', section: 'politics', geography: 'calder', date: d, time: '06:' + pad(int(0, 45)), headline: h, text: t});
}

// ---------- beat: weather, wildfire and burn bans ----------
function environment() {
  for (const year of [2025, 2026]) {
    const fire = story(year === 2026 ? 'burn-ban' : 'burn-ban-2025', year === 2026 ? 'Calder outdoor burning ban' : 'Calder outdoor burning ban, 2025');
    const start = year === 2025 ? '2025-06-20' : '2026-06-12';
    add({id: `burnban-${year}-start`, story_id: fire, outlet: 'capitol-courier', section: 'environment', geography: 'calder', date: start, time: '10:30', byline: 'Marcus Webb',
      headline: `Statewide burn ban begins ${dayName(start)}`,
      text: `The Calder Department of Forestry banned outdoor burning in all 38 counties starting ${dayName(start)}, ${ap(start)}, citing ${year === 2025 ? 'a dry spring and early heat' : 'heavy grass growth after the April storms'}. Campfires remain allowed in designated fire rings in state parks.`});
    for (let k = 0; k < 5; k++) {
      const d = addDays(start, 18 + k * int(14, 20));
      const name = pick(['Cedar Ridge', 'Sawmill Canyon', 'Pinto Flats', 'Larkspur', 'Hollis Grade', 'Dry Fork', 'Bracken Hill', 'Copper Gulch']) + ' Fire';
      const acres = int(200, 9000);
      const sid = story(`fire-${year}-${k}`, `${name}, ${year}`);
      const e = add({id: `fire-${year}-${k}`, story_id: sid, outlet: 'valley-daily', section: 'environment', geography: 'valley', date: d, time: '07:' + pad(int(0, 50)), byline: 'Teresa Quill',
        headline: `${name} grows to ${money(acres)} acres; ${pick(['evacuation warnings lifted', 'some roads closed', 'crews hold the east flank'])}`,
        text: `The ${name} in the eastern foothills had burned ${money(acres)} acres by ${dayName(d)} morning and was ${int(10, 80)}% contained, Calder Department of Forestry said. ${pick(['No homes have been lost.', 'Two outbuildings were destroyed.', 'Smoke may reach Millbrook in the afternoon.'])} ${pick(['Highway 9 remains closed between Pine Hollow and the county line.', 'An evacuation center is open at Eastbank High School.', 'The cause is under investigation.'])}`});
      if (e && chance(0.5)) {
        add({id: `fire-${year}-${k}-update`, story_id: sid, outlet: 'valley-daily', section: 'environment', geography: 'valley', date: addDays(d, int(2, 4)), time: '06:' + pad(int(10, 50)), byline: 'Teresa Quill',
          headline: `${name} fully contained`, text: `Crews fully contained the ${name} on ${dayName(addDays(d, 2))} after it burned ${money(acres + int(50, 800))} acres. Calder Department of Forestry said ${pick(['a downed power line', 'a vehicle fire on Highway 9', 'lightning'])} started it.`, credits: cite(e, 'Earlier Valley Daily coverage')});
      }
    }
    if (year === 2025) {
      add({id: 'burnban-2025-end', story_id: fire, outlet: 'capitol-courier', section: 'environment', geography: 'calder', date: '2025-10-24', time: '11:00', byline: 'Marcus Webb',
        headline: 'Burn ban lifted statewide after soaking storm', text: 'The Calder Department of Forestry lifted its burn ban in all 38 counties on Friday after a storm brought 1 to 3 inches of rain to the foothills. Residents still need a permit to burn piles larger than 4 feet across.'});
    } else {
      add({id: 'burnban-20261021-valley', story_id: fire, outlet: 'valley-daily', section: 'environment', geography: 'valley', date: '2026-10-21', time: '12:10', byline: 'Priya Natarajan',
        headline: 'Valley County burn ban ends after review', text: 'The state forestry department lifted the burn ban in Valley County and four other foothill counties on Wednesday after another round of rain. Residents may burn yard debris on permissive burn days; check the county air district line each morning.'});
    }
  }
  // Seasonal weather briefs.
  const wx = story('valley-weather', 'Valley weather');
  for (const [d, h, t] of [
    ['2026-10-05', 'First fall storm to bring up to an inch of rain', 'The first Pacific storm of the fall will reach Valley County on Tuesday night, Oct. 6, with up to an inch of rain in Millbrook and more in the foothills by Thursday. It would be the first significant rain since May.'],
    ['2026-10-08', 'Storms soak the valley; second system due Friday', 'Valley County picked up 0.6 to 1.4 inches of rain from Tuesday night through Thursday morning, Oct. 8, and a second, weaker storm is due Friday. The county air district lifted its no-burn advisory for wood stoves, but the state burn ban on outdoor fires stays in place.'],
  ]) add({id: `wx-${d.replace(/-/g, '')}`, story_id: wx, outlet: 'valley-daily', section: 'weather', geography: 'valley', date: d, time: '05:30', byline: 'Teresa Quill', headline: h, text: t});
  for (const d of days('2025-01-01', '2026-12-31')) {
    const m = Number(d.slice(5, 7));
    if (!chance([0.11, 0.1, 0.09, 0.08, 0.05, 0.07, 0.1, 0.1, 0.07, 0.07, 0.09, 0.11][m - 1])) continue;
    if (d >= '2026-09-25' && d <= '2026-10-13') continue; // pinned below: the fixture's first fall storms
    const winter = [11, 12, 1, 2, 3].includes(m), summer = [6, 7, 8, 9].includes(m);
    const hi = winter ? int(48, 62) : summer ? int(88, 107) : int(64, 82);
    const when = `${dayName(d)}, ${ap(d)}`;
    const [h, t] = winter ? pick([
      [`Storm to bring ${int(1, 3)} inches of rain to the valley`, `A Pacific storm will reach Valley County on the night of ${when}, with ${int(1, 3)} inches of rain expected by ${dayName(addDays(d, 2))}. Snow levels will drop to ${money(int(3, 5) * 1000)} feet in the eastern foothills. Highs will stay near ${hi}.`],
      [`Frost advisory for low-lying parts of Valley County`, `Temperatures could fall to ${int(27, 32)} degrees around Alder Creek and Riverside before sunrise on ${dayName(addDays(d, 1))}, ${ap(addDays(d, 1))}. The weather service advised covering sensitive plants and bringing pets inside.`],
      [`Dense fog slows morning commute`, `Visibility dropped below a quarter mile on Highway 9 and in Millbrook on the morning of ${when}. Fog is expected again ${dayName(addDays(d, 1))} before a dry, cool weekend with highs near ${hi}.`]])
      : summer ? pick([
        [`Heat advisory as valley highs near ${hi}`, `The weather service issued a heat advisory for Valley County from ${when}, through ${dayName(addDays(d, 2))}, with highs of ${hi - 2} to ${hi}. Cooling centers at the Eastbank and Millbrook libraries will stay open until 8 p.m.`],
        [`Smoke from foothill fire brings air quality alert`, `The county air district issued an air quality alert for ${when}, as smoke drifted west from the foothills and the air quality index reached ${int(121, 190)} in ${pick(['Millbrook', 'Eastbank', 'Pine Hollow', 'Riverside'])}. ${pick(['Officials advised limiting time outdoors', 'Schools moved recess indoors', 'Outdoor youth games were postponed'])}; the alert is expected to end ${dayName(addDays(d, 1))} as winds shift.`],
        [`Cooler air arrives after a week of triple digits`, `Highs will fall from ${hi} on ${when}, to the low 80s by ${dayName(addDays(d, 2))} as an onshore breeze returns. Overnight lows near 60 will be the coolest in two weeks.`]])
      : pick([
        [`Mild, dry week ahead with highs near ${hi}`, `High pressure will keep Valley County dry from ${when}, through ${dayName(addDays(d, 5))}, with highs of ${hi - 3} to ${hi} and light winds. Pollen counts will be high.`],
        [`Gusty winds could topple trees ${dayName(addDays(d, 1))}`, `North winds gusting to ${int(35, 55)} mph are expected on the afternoon of ${dayName(addDays(d, 1))}, ${ap(addDays(d, 1))}. Valley Power said crews are on standby for outages in Eastbank and Pine Hollow.`],
        [`Showers return after dry spell`, `Light showers will reach the valley ${dayName(addDays(d, 1))}, ${ap(addDays(d, 1))}, with ${pick(['a quarter inch', 'a tenth of an inch', 'up to a third of an inch'])} of rain or less. Highs will dip to the mid-60s before warming again.`]]);
    add({id: `wx-${d.replace(/-/g, '')}`, story_id: wx, outlet: 'valley-daily', section: 'weather', geography: 'valley', date: d, time: '05:' + pad(int(10, 50)), byline: 'Teresa Quill', headline: h, text: t});
  }
}

// ---------- beat: local government, schools, library and community ----------
const COUNCILS = [
  {id: 'eastbank', name: 'Eastbank City Council', city: 'Eastbank', outlet: 'valley-daily', geography: 'valley', mayor: 'Mayor Hollis Grant'},
  {id: 'millbrook', name: 'Millbrook City Council', city: 'Millbrook', outlet: 'valley-daily', geography: 'valley', mayor: 'Mayor Denise Arceo'},
  {id: 'harbor', name: 'Harbor City Council', city: 'Harbor City', outlet: 'harbor-ledger', geography: 'harbor-city', mayor: 'Mayor Victor Lam'},
];
const APPOINTEES = ['Alma Reyes', 'Graham Okoye', 'Sylvie Duran', 'Peter Nakamura', 'Lorraine Fisk', 'Hector Vail', 'Imani Brooks', 'Ruth Calderwood', 'Owen Petrakis'];
const AGENDA = [
  c => {const what = pick(['new playground', 'skate park', 'dog park', 'splash pad']), park = pick(['Riverside Park', 'Oak Street Park', 'Linden Green', 'Bayview Park']); return [`${c.city} approves ${what} for ${park}`, `The ${c.name} voted ${int(4, 5)}-${int(0, 1)} to spend $${money(int(25, 120) * 10000)} on a ${what} at ${park}, with construction starting ${pick(['next spring', 'in the fall', 'after the summer'])}. ${pick(['Residents asked for more shade and a public restroom.', 'Neighbors asked the city to keep the existing trees.', 'A parent group raised $40,000 toward the cost.'])}`];},
  c => {const pct = int(3, 9); return [`${c.city} water rates to rise ${pct}% in July`, `The ${c.name} approved a ${pct}% water rate increase to pay for pipe replacement. A typical household will pay about $${(pct * 0.9 + int(0, 9) / 10).toFixed(2)} more a month. ${pick([`The city plans to replace ${int(2, 9)} miles of pipe a year through 2030.`, `Some mains under ${pick(['Oak Street', 'the downtown core', 'Harbor Boulevard', 'Mill Road'])} date to the 1940s, staff said.`, `Low-income households can apply for a 30% discount.`])}`];},
  c => [`${c.city} adds protected bike lanes on ${pick(['Main Street', 'Third Avenue', 'Harbor Boulevard', 'College Way'])}`, `The ${c.name} approved protected bike lanes on a ${int(1, 3)}-mile stretch, removing ${int(30, 120)} parking spaces. ${c.mayor} said the city would add parking on side streets. Work begins ${pick(['in April', 'this summer', 'next month'])}.`],
  c => {const item = pick(['short-term rental limits', 'a leaf blower ban', 'downtown parking meters', 'sidewalk vending permits', 'a plastic bag fee']); return [`${c.name} delays vote on ${item}`, `After ${pick(['two hours', 'nearly three hours', '90 minutes'])} of public comment on ${item}, the ${c.name} postponed its vote to ${pick(['next month', 'its next meeting', 'January'])} and asked staff to meet with ${pick(['neighborhood groups', 'business owners', 'landlords'])}. ${int(20, 70)} people signed up to speak.`];},
  c => [`${c.city} approves ${int(40, 220)}-unit apartment building ${pick(['near the station', 'on the old cannery site', 'downtown', 'on Elm Street'])}`, `The ${c.name} voted ${int(3, 5)}-${int(0, 2)} to approve the project, ${int(10, 25)}% of whose units will rent below market rate. Neighbors had asked for a shorter building.`],
  c => [`${c.city} budget adds ${int(2, 6)} firefighters`, `The ${c.name} adopted a $${int(40, 190)} million budget that adds firefighters and extends library hours. ${c.mayor} called it "a careful budget in an uncertain year."`],
  c => {const n = int(8, 25), [a, b] = shuffle(['Oak Street', 'Third Avenue', 'Cedar Lane', 'Harbor Boulevard', 'Mill Road', 'Elm Street', 'Station Way', 'Pacific Avenue']); return [`${c.city} to repave ${n} streets this summer`, `The ${c.name} approved a $${money(int(180, 600) * 10000)} contract to repave ${n} streets, starting with ${a} and ${b}. The city will post a street-by-street schedule online; residents will get door hangers 72 hours before work.`];},
  c => {const post = pick(['police chief', 'city manager', 'fire chief', 'parks director']), who = APPOINTEES.pop(); return [`${c.city} names new ${post}`, `The ${c.name} confirmed ${who}, ${pick(['a 20-year veteran of the department', 'formerly of Cinder Bay', 'the interim ' + post + ' since spring'])}, as ${post}. ${c.mayor} praised the choice.`];},
];
const agendaLeft = new Map();
function community() {
  for (const c of COUNCILS) {
    for (const d of days('2025-01-06', '2026-12-21')) {
      // Councils meet on the first and third Tuesday; about half the meetings make the paper.
      const day = Number(d.slice(8, 10));
      if (weekday(d) !== 2 || !((day <= 7) || (day >= 15 && day <= 21)) || !chance(0.5)) continue;
      const key = c.id + d.slice(0, 4);
      if (!agendaLeft.has(key)) agendaLeft.set(key, shuffle(AGENDA.map((_, i) => i)));
      const left = agendaLeft.get(key);
      if (!left.length) continue;
      const [h, t] = AGENDA[left.pop()](c);
      add({id: `council-${c.id}-${d.replace(/-/g, '')}`, story_id: story(`council-${c.id}-${d.slice(0, 7)}`, `${c.name}, ${monthName(Number(d.slice(5, 7)))} ${d.slice(0, 4)}`),
        outlet: c.outlet, section: 'local-government', geography: c.geography, date: addDays(d, 1), time: '05:' + pad(int(15, 55)), headline: h, text: `${t} The council met ${dayName(d)}, ${ap(d)}.`});
    }
  }
  // Schools.
  const schools = story('valley-schools', 'Valley Unified schools');
  for (const [d, h, t] of [
    ['2025-01-15', 'Valley Unified weighs closing Pine Hollow Elementary', 'Valley Unified trustees will study closing Pine Hollow Elementary, where enrollment has fallen to 140 students. A decision is expected in March.'],
    ['2025-03-12', 'Trustees keep Pine Hollow Elementary open for now', 'The Valley Unified board voted 4-1 to keep Pine Hollow Elementary open through at least June 2027 while it tries a dual-language program to attract families.'],
    ['2025-06-06', 'Eastbank High graduates 412', 'Eastbank High School graduated 412 seniors Friday at the Millbrook fairgrounds. Valedictorian Rosa Ibarra will study engineering in the fall.'],
    ['2025-08-13', 'Valley Unified starts school year with new bell times', 'Valley Unified classes begin Wednesday, with middle schools starting 30 minutes later than last year under a state law on school start times.'],
    ['2025-11-20', 'Valley Unified to ask voters for $95 million school bond', 'The Valley Unified board voted to put a $95 million bond on the June 2026 ballot to replace portable classrooms and upgrade heating at nine schools.'],
    ['2026-06-03', 'School bond passes with 58% of the vote', 'Valley Unified\'s $95 million school bond passed with 58% of the vote, above the 55% it needed, according to final county results.'],
    ['2026-06-05', 'Eastbank High graduates 398', 'Eastbank High School graduated 398 seniors Friday. Principal Gail Rourke said the class earned $2.1 million in scholarships.'],
    ['2026-08-12', 'First day of school brings new Pine Hollow dual-language classes', 'Pine Hollow Elementary opened Wednesday with 186 students, up from 140 a year ago, after adding Spanish-English classes in kindergarten and first grade.'],
    ['2026-12-15', 'Bond projects to start with Millbrook Middle roof', 'The first projects paid for by the June school bond will replace the Millbrook Middle School roof over spring break, Valley Unified said.'],
  ]) add({id: `schools-${d.replace(/-/g, '')}`, story_id: schools, outlet: 'valley-daily', section: 'education', geography: 'valley', date: d, time: '06:' + pad(int(0, 45)), byline: 'Owen Marsh', headline: h, text: t});
  // Library: the Sunday-hours plan announced in the fixture.
  for (const [d, h, t, sid] of [
    ['2025-06-10', 'Summer reading program starts Saturday at all four branches', 'The Valley Public Library summer reading program runs June 14 through Aug. 9. Children who read 20 books get a free pass to the county fair.', 'library-summer-2025'],
    ['2025-09-23', 'Library wins state literacy grant', 'The Valley Public Library received a one-year, $640,000 state literacy grant, director Tomás Ibarra said Tuesday. The board will decide this winter how to spend it.', 'library-hours'],
    ['2026-02-18', 'Library board plans Sunday hours with grant money', 'The Valley Public Library board voted to use most of its state literacy grant to open all four branches on Sundays, starting in the fall, director Tomás Ibarra said.', 'library-hours'],
    ['2026-06-09', 'Summer reading program adds teen book club', 'The Valley Public Library summer reading program, June 13 through Aug. 8, adds a weekly teen book club at the Eastbank branch.', 'library-summer-2026'],
    ['2026-11-02', 'Libraries open on Sunday for the first time', 'All four Valley Public Library branches opened on a Sunday for the first time on Nov. 1. The Eastbank branch counted 312 visitors between noon and 5 p.m.', 'library-hours'],
  ]) add({id: `library-${d.replace(/-/g, '')}`, story_id: story(sid, sid === 'library-hours' ? 'Valley library hours' : `Library summer reading, ${d.slice(0, 4)}`), outlet: 'valley-daily', section: 'community', geography: 'valley', date: d, time: '06:' + pad(int(0, 45)), byline: 'Priya Natarajan', headline: h, text: t});
  // Annual events.
  for (const year of [2025, 2026]) {
    const fair = story(`county-fair-${year}`, `Valley County Fair, ${year}`);
    add({id: `fair-${year}-preview`, story_id: fair, outlet: 'valley-daily', section: 'community', geography: 'valley', date: `${year}-07-29`, time: '06:20',
      headline: `Valley County Fair opens ${year === 2025 ? 'Aug. 7' : 'Aug. 6'} with new livestock barn`, text: `The ${year === 2025 ? '96th' : '97th'} Valley County Fair runs ${year === 2025 ? 'Aug. 7-17' : 'Aug. 6-16'} at the Millbrook fairgrounds. Admission is $12 for adults and free for children under 6. ${year === 2025 ? 'A new livestock barn replaces one damaged by a 2023 storm.' : 'The demolition derby returns after a two-year break.'}`});
    add({id: `fair-${year}-wrap`, story_id: fair, outlet: 'valley-daily', section: 'community', geography: 'valley', date: `${year}-08-${year === 2025 ? 18 : 17}`, time: '06:10',
      headline: `Fair attendance ${year === 2025 ? 'tops 210,000' : 'dips in heat wave'}`, text: year === 2025 ? 'The 96th Valley County Fair drew 211,400 people over 11 days, the fair board said, the most since 2018. The 4-H steer auction raised a record $1.3 million.' : 'Attendance at the 97th Valley County Fair fell to 196,800 as afternoon highs topped 100 degrees on six of its 11 days, the fair board said. The returning demolition derby sold out both nights.'});
    const parade = story(`holiday-parade-${year}`, `Millbrook Holiday Lights Parade, ${year}`);
    add({id: `parade-${year}`, story_id: parade, outlet: 'valley-daily', section: 'community', geography: 'valley', date: `${year}-12-0${year === 2025 ? 2 : 1}`, time: '06:00',
      headline: `Holiday Lights Parade returns to Millbrook ${year === 2025 ? 'Saturday' : 'this weekend'}`, text: `The Millbrook Holiday Lights Parade steps off at 6 p.m. ${year === 2025 ? 'Saturday, Dec. 6' : 'Saturday, Dec. 5'}, on Main Street with ${int(60, 80)} entries. Main Street closes to traffic from 4 p.m.; extra Valley Line trains run until 10 p.m.`});
    const lantern = story(`lantern-festival-${year}`, `Harbor City Lantern Festival, ${year}`);
    add({id: `lantern-${year}`, story_id: lantern, outlet: 'harbor-ledger', section: 'community', geography: 'harbor-city', date: `${year}-02-${year === 2025 ? '05' : '11'}`, time: '07:00', byline: 'Celia Hart',
      headline: `Lantern Festival lights up the waterfront ${year === 2025 ? 'Saturday' : 'this weekend'}`, text: `The Harbor City Lantern Festival returns to the waterfront ${year === 2025 ? 'Feb. 8-9' : 'Feb. 14-15'}, with ${int(800, 1200)} lanterns made by schools and neighborhood groups. Pier Park lots open at 4 p.m.; parking is $10.`});
  }
  // Businesses.
  const biz = story('valley-business', 'Valley business');
  const SHOPS = ['a bakery', 'a bike shop', 'a ramen restaurant', 'a hardware store', 'a bookstore', 'a coffee roaster', 'a taqueria', 'a climbing gym', 'a pharmacy', 'a brewery', 'a used-record store', 'a plant nursery'];
  for (const d of days('2025-01-01', '2026-12-31')) {
    if (!chance(0.045)) continue;
    const shop = pick(SHOPS), town = pick(['Eastbank', 'Millbrook', 'Pine Hollow', 'Riverside', 'Alder Creek']), opening = chance(0.65);
    const owner = pick(['Maya Lindgren', 'Tariq Haddad', 'Lucy Fontaine', 'Ben Achebe', 'Rosa Medina', 'Kurt Vollmer', 'Nina Castell-Ward', 'Ollie Tran', 'Grace Muñoz']);
    add({id: `biz-${d.replace(/-/g, '')}`, story_id: biz, outlet: 'valley-daily', section: 'business', geography: 'valley', date: d, time: '07:' + pad(int(0, 55)), byline: 'Mara Bell',
      headline: opening ? `${cap(shop.replace(/^an? /, ''))} opens on ${town}'s ${pick(['Main Street', 'Front Street', 'Mill Road', 'Station Way'])}` : `${town} ${shop.replace(/^an? /, '')} to close after ${int(8, 41)} years`,
      text: opening ? `${owner} opened ${shop} in ${town} on ${dayName(d)}, in a space that had been empty since ${int(2021, 2024)}. ${pick(['Hours are 7 a.m. to 3 p.m., Tuesday through Sunday.', 'The owner said she had saved for six years to open it.', 'It is the third new business on the block this year.'])}`
        : `${owner} said ${shop} in ${town} will close ${pick(['at the end of the month', 'in two weeks', 'after the holidays'])}, citing ${pick(['a rent increase', 'retirement', 'the loss of foot traffic during road work'])}. ${pick(['Gift cards will be honored until closing day.', 'The building has been sold.', 'Regulars have organized a farewell party.'])}`});
  }
}
const cap = s => s[0].toUpperCase() + s.slice(1);

// ---------- beat: national (The National Standard and Tallywire) ----------
function national() {
  let rate = 4.1, policy = 4.5;
  for (const d of days('2025-01-01', '2026-12-31')) {
    // Jobs report: first Friday of each month.
    if (weekday(d) === 5 && Number(d.slice(8, 10)) <= 7) {
      const change = [-0.1, 0, 0, 0.1][int(0, 3)]; rate = Math.round((rate + change) * 10) / 10;
      const jobs = int(-40, 260) * 1000, month = monthName(((Number(d.slice(5, 7)) + 10) % 12) + 1);
      const e = add({id: `jobs-${d.replace(/-/g, '')}`, story_id: story(`jobs-${d.slice(0, 7)}`, `Jobs report, ${month} ${month === 'December' ? Number(d.slice(0, 4)) - 1 : d.slice(0, 4)}`),
        outlet: 'national-standard', section: 'economy', geography: 'national', date: d, time: '06:' + pad(int(35, 55)), byline: pick(['Ruth Adeyemi', 'Daniel Osei']),
        headline: jobs < 0 ? `Employers cut ${money(-jobs)} jobs in ${month}` : `Employers added ${money(jobs)} jobs in ${month}; unemployment ${change > 0 ? 'rises to' : change < 0 ? 'falls to' : 'holds at'} ${rate}%`,
        text: `Employers ${jobs < 0 ? 'cut' : 'added'} ${money(Math.abs(jobs))} jobs in ${month}, the National Labor Office said ${dayName(d)}, and the unemployment rate ${change > 0 ? 'rose to' : change < 0 ? 'fell to' : 'held at'} ${rate}%. ${pick(['Health care and construction led the gains.', 'Manufacturing lost jobs for a third month.', 'Average hourly pay rose 0.3% from the month before.', 'Revisions lowered the previous two months by a combined 31,000.'])} ${pick(['Economists had expected a smaller change.', 'The report comes two weeks before the Reserve Council meets.', 'Part-time work accounted for most of the change.'])}`});
      if (e && chance(0.5)) reprint(e, 'tallywire', int(15, 40), `Unemployment ${change > 0 ? 'up' : change < 0 ? 'down' : 'steady'} at ${rate}% in ${month}`, 'The National Standard');
    }
    // Reserve Council meets eight times a year, on the third Wednesday of alternate-ish months.
    if (weekday(d) === 3 && Number(d.slice(8, 10)) >= 15 && Number(d.slice(8, 10)) <= 21 && [1, 3, 4, 6, 7, 9, 10, 12].includes(Number(d.slice(5, 7)))) {
      const move = pick([0, 0, -0.25, 0.25, 0]); policy = Math.round((policy + move) * 100) / 100;
      add({id: `reserve-${d.replace(/-/g, '')}`, story_id: story(`reserve-${d.slice(0, 7)}`, `Reserve Council rate decision, ${monthName(Number(d.slice(5, 7)))} ${d.slice(0, 4)}`),
        outlet: 'tallywire', section: 'economy', geography: 'national', date: d, time: '11:' + pad(int(5, 30)), byline: 'Tallywire staff',
        headline: move === 0 ? `Reserve Council holds key rate at ${policy}%` : `Reserve Council ${move > 0 ? 'raises' : 'cuts'} key rate to ${policy}%`,
        text: `The Reserve Council ${move === 0 ? 'left its benchmark rate at' : move > 0 ? 'raised its benchmark rate a quarter point to' : 'cut its benchmark rate a quarter point to'} ${policy}% at the end of its ${monthName(Number(d.slice(5, 7)))} meeting on ${dayName(d)}, ${ap(d)}. ${pick(['Governor Elaine Marchetti said inflation was easing more slowly than expected.', 'Two members voted for a different move.', 'The council said it would watch the job market closely.', 'Mortgage rates are likely to follow, analysts said.'])}`});
    }
  }
  const post = [
    ['2025-01-07', 'postal-rates-2025-jan', 'Postage increase, Jan. 2025', 'Stamp price rises to 71 cents on Jan. 19', 'A first-class stamp will cost 71 cents starting Jan. 19, up from 68 cents, the Postal Service reminded customers Tuesday. Forever stamps bought earlier remain valid.'],
    ['2025-04-09', 'postal-rates-2025-jul', 'Postage increase, July 2025', 'Stamp price to rise to 73 cents in July', 'A first-class stamp will cost 73 cents starting July 13, up from 71 cents, the Postal Service said Wednesday, its second increase this year. Package rates will rise 6%.'],
    ['2025-07-11', 'postal-rates-2025-jul', 'Postage increase, July 2025', '73-cent stamps take effect Sunday', 'The first-class stamp rises to 73 cents on Sunday, July 13. Postcards go to 56 cents. Forever stamps bought earlier remain valid.'],
    ['2026-07-14', 'postal-rates', 'Postage rate increase', 'Postal Service files notice of January rate change', 'The Postal Service filed notice Tuesday that it plans a January stamp price change and will announce the amount in October, after a regulatory review.'],
  ];
  for (const [d, sid, title, h, t] of post) add({id: `postal-${d.replace(/-/g, '')}`, story_id: story(sid, title), outlet: 'national-standard', section: 'national', geography: 'national', date: d, time: '10:' + pad(int(0, 50)), byline: 'Ruth Adeyemi', headline: h, text: t});
}

// ---------- beat: world (Velmora and Valdora) ----------
function world() {
  const vel = 'velmora-election';
  for (const [d, outlet, h, t] of [
    ['2025-05-20', 'national-standard', 'Velmora\'s Arran says he will seek a fourth term', 'President Viktor Arran of Velmora said Tuesday that he will run for a fourth term in next year\'s election, ending months of speculation. The Unity Party has governed since 2014.'],
    ['2025-11-11', 'tallywire', 'Former Port Aldo mayor Castell enters Velmora race', 'Inés Castell, who served two terms as mayor of the port city of Port Aldo, announced her presidential campaign Tuesday, promising to audit state energy contracts and reopen northern border crossings.'],
    ['2026-03-03', 'national-standard', 'Velmora sets Sept. 27 first round, Oct. 13 runoff', 'Velmora\'s national electoral council set the presidential first round for Sept. 27 and a runoff, if needed, for Oct. 13. Eleven candidates have registered.'],
    ['2026-06-23', 'tallywire', 'Castell leads Velmora poll for first time', 'A survey by the University of Port Aldo found Inés Castell at 38% and President Viktor Arran at 35% among likely voters, the first poll to show the challenger ahead.'],
    ['2026-09-28', 'tallywire', 'Castell and Arran head to runoff in Velmora', 'Inés Castell won 46% of the vote in Sunday\'s first round of Velmora\'s presidential election, short of the majority needed to win outright, and will face President Viktor Arran, who took 41%, in an Oct. 13 runoff.'],
    ['2026-12-01', 'national-standard', 'Castell sworn in as Velmora\'s president', 'Inés Castell was sworn in Tuesday as Velmora\'s president, the first from outside the Unity Party in 12 years. In her first decree she ordered an audit of state energy contracts.'],
    ['2026-12-16', 'tallywire', 'Velmora reopens two northern border crossings', 'Velmora reopened two northern border crossings that had been closed to cars since 2021, fulfilling a campaign promise by President Inés Castell two weeks after she took office.'],
  ]) {
    const e = add({id: `velmora-${d.replace(/-/g, '')}`, story_id: vel, outlet, section: 'world', geography: 'velmora', date: d, time: '03:' + pad(int(10, 50)), headline: h, text: t});
    if (e && outlet === 'tallywire' && chance(0.6)) reprint(e, 'national-standard', int(60, 120), h, 'Tallywire');
  }
  const strike = 'valdora-strike';
  for (const [d, outlet, lang, h, t] of [
    ['2026-08-18', 'el-faro', 'es', 'Controladores aéreos piden un aumento del 12%', 'El sindicato de controladores aéreos de Valdora presentó al Ministerio de Transporte un pedido de aumento salarial del 12% y advirtió que podría haber medidas de fuerza si no hay respuesta antes de octubre.'],
    ['2026-09-15', 'el-faro', 'es', 'Sin acuerdo en la primera reunión entre controladores y el ministerio', 'La primera reunión entre el sindicato de controladores y el Ministerio de Transporte terminó sin acuerdo. El ministerio ofreció un 6% en dos cuotas; el sindicato lo rechazó.'],
    ['2026-10-16', 'national-standard', 'en', 'Strike grounds flights at two Valdora airports', 'A 24-hour strike by air traffic controllers grounded flights at the San Telmo and Bahía Honda airports on Friday. Puerto Claro airport operated a reduced schedule under a last-minute minimum-service agreement.'],
    ['2026-10-23', 'el-faro', 'es', 'Controladores y ministerio firman un acuerdo salarial', 'El sindicato de controladores aéreos y el Ministerio de Transporte firmaron un acuerdo por un aumento del 9% en dos tramos. El sindicato levantó la amenaza de nuevos paros.'],
  ]) add({id: `strike-${d.replace(/-/g, '')}`, story_id: strike, outlet, section: outlet === 'el-faro' ? 'transport' : 'world', geography: outlet === 'el-faro' ? 'costa-norte' : 'valdora', language: lang, date: d, time: '06:' + pad(int(0, 50)), headline: h, text: t});
}

// ---------- beat: El Faro del Litoral (Spanish, Costa Norte) ----------
const BARRIOS = ['Puerto Claro', 'San Telmo', 'Bahía Honda', 'Punta Brava', 'Villa Marina'];
const CALLES = ['Mitre', 'Belgrano', 'San Martín', 'Rivadavia', 'Las Heras', 'Colón', 'Sarmiento', 'Moreno', 'Alsina', 'Brown'];
const esDay = d => `${WEEKDAYS_ES[weekday(d)]} ${es(d)}`;
function elFaro() {
  const sid = story('costa-norte', 'Costa Norte');
  const faro = (d, time, h, t, extra = {}) => add({id: `faro-${d.replace(/-/g, '')}-${extra.tag || 'n'}`, story_id: extra.story || sid, outlet: 'el-faro', section: 'region', geography: 'costa-norte', language: 'es', date: d, time, headline: h, text: t});
  const all = days('2025-01-01', '2026-12-31');
  // Monthly port report, first Monday: cruise season peaks in the southern summer.
  for (const d of all.filter(d => weekday(d) === 1 && Number(d.slice(8, 10)) <= 7)) {
    const m = Number(d.slice(5, 7)), prev = m === 1 ? 12 : m - 1, high = [12, 1, 2, 3].includes(prev);
    const ships = high ? int(14, 22) : int(2, 7), pax = ships * int(1300, 2100);
    faro(d, '05:10', `El puerto de Puerto Claro recibió ${ships} cruceros en ${MONTHS_ES[prev - 1]}`,
      `La administración portuaria informó este lunes que ${money(pax)} pasajeros de ${ships} cruceros desembarcaron en Puerto Claro durante ${MONTHS_ES[prev - 1]}. ${high ? 'Los comerciantes del casco histórico reportaron más ventas que en la temporada anterior.' : 'Fuera de temporada, el puerto concentra su actividad en la carga de contenedores.'}`, {tag: 'puerto'});
  }
  // Fishing seasons open on fixed dates every year.
  for (const year of [2025, 2026]) for (const [md, especie, barrio] of [['01-10', 'calamar', 'Punta Brava'], ['03-01', 'merluza', 'Puerto Claro'], ['11-15', 'langostino', 'Bahía Honda']]) {
    const d = `${year}-${md}`, fuel = int(4, 16);
    faro(d, '06:00', `Comienza la temporada de ${especie} en ${barrio}`,
      `La flota artesanal de ${barrio} salió el ${esDay(d)} para la apertura de la temporada de ${especie}. La cooperativa de pescadores espera ${pick(['capturas similares a las del año pasado', 'una temporada algo más corta', 'buenos precios en el mercado regional'])}, aunque el combustible subió un ${fuel}% desde ${year - 1}.`, {tag: especie});
  }
  // The Festival de la Corvina, once a year in February.
  for (const [year, d, n] of [[2025, '2025-02-17', 19000], [2026, '2026-02-16', 23000]]) {
    faro(d, '06:00', `El Festival de la Corvina reunió a ${money(n)} personas en Bahía Honda`,
      `La ${year === 2025 ? 'trigésima' : 'trigésima primera'} edición del festival reunió a unas ${money(n)} personas durante el fin de semana en Bahía Honda. Hubo concursos de pesca, música en vivo y puestos de comida de toda la Costa Norte; ${year === 2025 ? 'el premio mayor fue una corvina de 7,4 kilos' : 'la organización estrenó un escenario sobre la playa'}.`, {tag: 'festival', story: story(`corvina-${year}`, `Festival de la Corvina ${year}`)});
  }
  // Municipal elections, Oct. 26, 2025.
  const muni = story('costa-norte-municipales-2025', 'Elecciones municipales 2025');
  faro('2025-09-29', '05:30', 'Cinco listas competirán por la intendencia de Puerto Claro', 'La junta electoral oficializó cinco listas para las elecciones municipales del 26 de octubre. La actual intendenta, Silvina Arce, buscará un segundo mandato.', {tag: 'muni', story: muni});
  faro('2025-10-27', '04:30', 'Silvina Arce gana un segundo mandato en Puerto Claro', 'La intendenta Silvina Arce fue reelegida con el 44% de los votos, según el escrutinio provisorio. La participación fue del 68%, cuatro puntos menos que en 2021.', {tag: 'muni', story: muni});
  faro('2025-12-10', '05:30', 'Asumen los nuevos concejales de la Costa Norte', 'Los concejales electos en octubre asumieron este miércoles en los cinco municipios de la Costa Norte. En San Telmo, el oficialismo perdió la mayoría.', {tag: 'muni', story: muni});
  // Health centers open once each.
  for (const [i, barrio] of BARRIOS.entries()) {
    const d = addDays('2025-03-01', i * 131 + int(0, 30));
    faro(d, '13:20', `${barrio} inaugura una nueva sala de atención primaria`, `El centro de salud de ${barrio} abrirá de lunes a sábado de 8 a 20 horas y tendrá ${int(3, 8)} consultorios. La municipalidad invirtió ${int(120, 480)} millones de pesos en la obra, que comenzó en ${int(2023, 2024)}.`, {tag: 'salud'});
  }
  // Council votes: each measure once per town.
  const medidas = ['la peatonalización de la calle Mitre', 'un nuevo plan de residuos', 'la ampliación de la costanera', 'una tasa turística', 'un registro de alquileres temporarios', 'la compra de dos ambulancias', 'el arreglo del muelle de pescadores', 'nuevas ciclovías en el centro'];
  const combos = shuffle(BARRIOS.flatMap(b => medidas.map(m => [b, m])));
  let k = 0;
  for (const d of all.filter(d => weekday(d) === 4 && chance(0.45))) {
    const [b, m] = combos[k++ % combos.length], si = int(7, 11), no = int(1, 4);
    faro(d, '15:40', `El Concejo de ${b} aprueba ${m}`, `La medida fue aprobada el ${esDay(d)} por ${si} votos contra ${no}. ${pick(['Los comerciantes pidieron una etapa de prueba de seis meses.', 'Los vecinos podrán presentar objeciones durante 30 días.', 'Las obras comenzarían el año próximo.', 'La oposición pidió una consulta popular.'])}`, {tag: 'concejo'});
  }
  // Wind alerts and water cuts, each tied to its date and place.
  for (const d of all) {
    const m = Number(d.slice(5, 7));
    if (chance([5, 6, 7, 8, 9].includes(m) ? 0.07 : 0.03)) {
      const [a, b] = shuffle(BARRIOS);
      faro(d, '04:30', `Alerta por vientos de hasta ${int(60, 95)} km/h para el ${WEEKDAYS_ES[weekday(addDays(d, 1))]}`,
        `El servicio meteorológico emitió una alerta por ráfagas de hasta ${int(60, 95)} km/h para el ${esDay(addDays(d, 1))}. Prefectura suspendió la navegación de embarcaciones menores entre ${a} y ${b}${pick([', y recomendó asegurar toldos y carteles.', '. Las clases continúan con normalidad.', ', y el puerto demoró la salida de dos buques de carga.'])}`, {tag: 'viento'});
    } else if (chance(0.03)) {
      const b = pick(BARRIOS), c1 = pick(CALLES), c2 = pick(CALLES.filter(c => c !== c1)), cut = addDays(d, 2);
      faro(d, '13:20', `Corte de agua el ${WEEKDAYS_ES[weekday(cut)]} en ${b}`,
        `La cooperativa de agua anunció un corte el ${esDay(cut)} de ${pick(['8 a 14', '9 a 15', '22 a 6'])} horas entre las calles ${c1} y ${c2} de ${b}, por trabajos en la red. Recomendó a los vecinos reservar agua el día anterior.`, {tag: 'agua'});
    }
  }
  for (const d of ['2025-03-03', '2025-09-01', '2026-03-02', '2026-09-07']) {
    const line = pick(['14', '22', '7']), freq = int(12, 20);
    faro(d, '05:10', `La línea ${line} de colectivos cambia su frecuencia`, `Desde el ${es(addDays(d, 7))}, la línea ${line} entre Puerto Claro y San Telmo pasará cada ${freq} minutos en hora pico. La empresa sumará ${int(2, 6)} unidades con aire acondicionado.`, {tag: 'colectivos'});
  }
  // Tallywire translates a few El Faro reports, with credit.
  for (const e of editions.filter(e => e.outlet_id === 'el-faro' && /muni|corvina|puerto/.test(e.edition_id + e.story_id) && chance(0.35))) {
    const d = e.added_at.slice(0, 10);
    add({id: e.edition_id + '-wire', story_id: e.story_id, outlet: 'tallywire', section: 'world', geography: 'costa-norte', date: d, time: '17:' + pad(int(0, 50)), byline: 'Tallywire staff',
      headline: 'Valdora coast: ' + e.headline.replace(/^El /, '').slice(0, 70), text: `El Faro del Litoral, the Costa Norte regional newspaper, reported on ${dayName(d)}, ${ap(d)}: "${e.text.split('. ')[0]}." Tallywire translated the report from Spanish.`,
      credits: [{edition_id: e.edition_id, credit: 'Translated from reporting by El Faro del Litoral'}]});
  }
}

// ---------- beat: Calder agencies (Capitol Courier) ----------
function calderAgencies() {
  const all = days('2025-01-01', '2026-12-31');
  let rate = 5.2;
  for (const d of all.filter(d => weekday(d) === 5 && Number(d.slice(8, 10)) >= 15 && Number(d.slice(8, 10)) <= 21)) {
    const m = Number(d.slice(5, 7)), prev = m === 1 ? 12 : m - 1, ch = [-0.1, 0, 0, 0.1][int(0, 3)];
    rate = Math.round((rate + ch) * 10) / 10;
    add({id: `calder-jobs-${d.replace(/-/g, '')}`, story_id: story(`calder-jobs-${d.slice(0, 7)}`, `Calder jobs report, ${monthName(prev)}`), outlet: 'capitol-courier', section: 'economy', geography: 'calder', date: d, time: '12:' + pad(int(0, 40)), byline: 'Ivy Lindqvist',
      headline: `Calder unemployment ${ch > 0 ? 'rises to' : ch < 0 ? 'dips to' : 'holds at'} ${rate}% in ${monthName(prev)}`,
      text: `Calder's unemployment rate ${ch > 0 ? 'rose to' : ch < 0 ? 'fell to' : 'held at'} ${rate}% in ${monthName(prev)}, the state Employment Department said ${dayName(d)}. Employers ${pick(['added', 'added', 'cut'])} ${money(int(2, 18) * 500)} jobs; ${pick(['farm employment', 'construction', 'health care', 'state and local government', 'leisure and hospitality'])} ${pick(['led the change', 'saw the largest swing', 'was the only sector to shrink'])}.`});
  }
  for (const year of [2025, 2026]) for (const [md, pct] of [['01-02', int(40, 70)], ['02-01', int(55, 85)], ['03-02', int(60, 95)], ['04-01', int(55, 110)]]) {
    const d = `${year}-${md}`;
    add({id: `snowpack-${d.replace(/-/g, '')}`, story_id: story(`snowpack-${year}`, `Calder snowpack, ${year}`), outlet: 'capitol-courier', section: 'environment', geography: 'calder', date: d, time: '13:' + pad(int(0, 40)), byline: 'Marcus Webb',
      headline: `Snowpack at ${pct}% of average in ${md === '04-01' ? 'season-ending' : monthName(Number(md.slice(0, 2)))} survey`,
      text: `Surveyors measured the Calder snowpack at ${pct}% of the long-term average for ${ap(d)}, the Department of Water Resources said. ${pct < 70 ? 'Officials asked cities to plan for a dry summer.' : pct > 100 ? 'Reservoir managers said they may release water early to make room for runoff.' : 'Reservoirs are near normal for the date.'}`});
  }
  for (const [d, h, t] of [
    ['2025-01-02', 'Minimum wage rises to $16.50 in Calder', 'Calder\'s minimum wage rose to $16.50 an hour on Jan. 1, up 50 cents under the state\'s inflation adjustment. Tipped workers receive the same minimum.'],
    ['2025-06-27', 'State gas tax rises 2 cents on July 1', 'Calder\'s gas tax will rise 2 cents to 61.4 cents a gallon on July 1 under the annual inflation adjustment, the state tax board said.'],
    ['2025-11-13', 'State university trustees approve 4% tuition increase', 'Calder State University trustees approved a 4% tuition increase for fall 2026, about $290 a year for in-state undergraduates. Students protested outside the meeting.'],
    ['2026-01-02', 'Minimum wage rises to $17 in Calder', 'Calder\'s minimum wage rose to $17 an hour on Jan. 1. The minimum wage bill debated in the Legislature would add further increases.'],
    ['2026-03-24', 'Calder DMV adds Saturday hours at 12 offices', 'The Calder Department of Motor Vehicles will open 12 field offices on Saturdays from 8 a.m. to noon starting April 4 to cut appointment waits, which average 23 days.'],
    ['2026-06-26', 'Gas tax rises to 62.9 cents on July 1', 'Calder\'s gas tax will rise 1.5 cents to 62.9 cents a gallon on July 1, the state tax board said.'],
    ['2026-11-12', 'Trustees freeze state university tuition for 2027', 'Calder State University trustees voted to keep tuition flat for 2027-28, citing the new state budget\'s higher funding for public universities.'],
    ['2026-12-29', 'New Calder laws taking effect Jan. 1', 'A minimum wage increase to $17.50 and new limits on wildfire insurance cancellations are among the Calder laws that take effect Jan. 1, 2027.'],
  ]) add({id: `calder-misc-${d.replace(/-/g, '')}`, story_id: story(`calder-misc-${d.slice(0, 7)}`, h), outlet: 'capitol-courier', section: 'politics', geography: 'calder', date: d, time: '10:' + pad(int(0, 50)), headline: h, text: t});
}

// ---------- beat: national economy and domestic news (The National Standard) ----------
function nationalMore() {
  const all = days('2025-01-01', '2026-12-31');
  let cpi = 2.9;
  for (const d of all.filter(d => weekday(d) === 3 && Number(d.slice(8, 10)) >= 10 && Number(d.slice(8, 10)) <= 16)) {
    const m = Number(d.slice(5, 7)), prev = m === 1 ? 12 : m - 1, ch = [-0.2, -0.1, 0, 0.1, 0.2][int(0, 4)];
    cpi = Math.round((cpi + ch) * 10) / 10;
    add({id: `cpi-${d.replace(/-/g, '')}`, story_id: story(`cpi-${d.slice(0, 7)}`, `Consumer prices, ${monthName(prev)}`), outlet: 'national-standard', section: 'economy', geography: 'national', date: d, time: '06:' + pad(int(30, 50)), byline: 'Daniel Osei',
      headline: `Prices up ${cpi}% from a year earlier in ${monthName(prev)}`,
      text: `Consumer prices rose ${cpi}% in the year to ${monthName(prev)}, ${ch > 0 ? 'up from' : ch < 0 ? 'down from' : 'the same as'} ${Math.round((cpi - ch) * 10) / 10}% the month before, the Statistics Bureau said ${dayName(d)}. ${pick(['Rent and car insurance rose fastest.', 'Gasoline prices fell for a second month.', 'Grocery prices rose 0.4% in the month alone.', 'Airfares dropped after the summer peak.'])}`});
  }
  for (const [d, q, g] of [['2025-01-30', 'fourth quarter of 2024', 2.3], ['2025-04-30', 'first quarter', 1.1], ['2025-07-30', 'second quarter', 2.6], ['2025-10-30', 'third quarter', 2.0], ['2026-01-29', 'fourth quarter of 2025', 1.7], ['2026-04-29', 'first quarter', 0.8], ['2026-07-30', 'second quarter', 2.1], ['2026-10-29', 'third quarter', 1.9]]) {
    add({id: `gdp-${d.replace(/-/g, '')}`, story_id: story(`gdp-${d.slice(0, 7)}`, `Economic growth, ${q}`), outlet: 'national-standard', section: 'economy', geography: 'national', date: d, time: '06:35', byline: 'Ruth Adeyemi',
      headline: `Economy grew at ${g}% rate in ${q.replace(/ of \d+/, '')}`, text: `The economy grew at a ${g}% annual rate in the ${q}, the Commerce Office said ${dayName(d)}. ${g < 1.2 ? 'Business investment fell, offsetting steady consumer spending.' : 'Consumer spending accounted for most of the growth.'}`});
  }
  for (const [d, h, t] of [
    ['2025-02-12', 'Winter storm closes interstates across the northern plains', 'Blowing snow closed more than 400 miles of interstate across three northern states on Wednesday, stranding hundreds of trucks. Forecasters expect wind chills near 40 below.'],
    ['2025-06-30', 'Record 71 million expected to travel for July 4 holiday', 'A record 71 million people are expected to travel at least 50 miles over the July 4 holiday week, the national motor club said. Gas averages $3.41 a gallon.'],
    ['2025-09-09', 'Senate passes six-year highway funding bill', 'The Senate passed a six-year, $410 billion highway and transit bill 71-27 on Tuesday. The House is expected to vote next month.'],
    ['2025-11-24', 'Thanksgiving air travel set to break record', 'Airport screeners expect to check 18.9 million passengers from the Tuesday before Thanksgiving through the following Monday, a record.'],
    ['2026-01-27', 'High court agrees to hear case on state data privacy laws', 'The high court agreed Monday to decide whether federal law overrides state data privacy rules, a case that could affect laws in 19 states. Arguments are expected in the fall.'],
    ['2026-05-18', 'Heat wave sets records across the south', 'Temperatures above 105 degrees set records in 40 cities across the south over the weekend. Power grid operators asked customers to conserve electricity in the evening.'],
    ['2026-07-01', 'Holiday travel forecast tops last year\'s record', 'About 72 million people plan to travel over the July 4 holiday, slightly more than last year\'s record, the national motor club said.'],
    ['2026-11-23', 'Thanksgiving travelers face storms in the middle of the country', 'A storm system is expected to bring heavy rain and snow to the central states on Wednesday, the busiest travel day before Thanksgiving, forecasters said.'],
    ['2026-12-21', 'Highway bill signed after two-year fight', 'The six-year highway and transit bill was signed into law Monday after the House and Senate settled differences over transit funding.'],
  ]) add({id: `nat-${d.replace(/-/g, '')}`, story_id: story(`nat-${d}`, h), outlet: 'national-standard', section: 'national', geography: 'national', date: d, time: '05:' + pad(int(10, 50)), byline: pick(['Samuel Price', 'Grace Holloway']), headline: h, text: t});
}


// ---------- beat: the holiday weeks ----------
function holidays() {
  for (const year of [2025, 2026]) {
    const sid = story(`holidays-${year}`, `Holiday season, ${year}`);
    for (const [md, outlet, section, geography, h, t] of [
      ['12-20', 'valley-daily', 'community', 'valley', `Toy drive collects ${year === 2025 ? '6,200' : '7,050'} gifts`, `The Valley County firefighters' toy drive collected ${year === 2025 ? '6,200' : '7,050'} gifts this month, ${year === 2025 ? 'about 400 more than last year' : 'a record'}. Families can pick them up at the Millbrook fairgrounds on Dec. 21 and 22.`],
      ['12-23', 'harbor-ledger', 'community', 'harbor-city', 'Pier Park ice rink stays open through New Year\'s Day', `The temporary ice rink at Pier Park will stay open from 10 a.m. to 10 p.m. daily through Jan. 1, ${year + 1}, except Christmas Day. Skate rental is $8.`],
      ['12-26', 'valley-daily', 'community', 'valley', 'Where to recycle your Christmas tree', `Valley County will collect Christmas trees at the curb on the first two pickup days of ${year + 1}. Remove lights, stands and tinsel; flocked trees go in the trash.`],
      ['12-29', 'capitol-courier', 'politics', 'calder', `The year at the Capitol: ${year === 2025 ? 'housing, water and a budget warning' : 'a late budget and a new Legislature'}`, year === 2025 ? 'Calder lawmakers spent 2025 on housing permits and groundwater rules, and ended the year warned that the next two-year budget would be tight, the legislative analyst said.' : 'Calder\'s 2026 ended with a budget signed three and a half months late and a Legislature sworn in with a narrower Assembly majority.'],
      ['12-31', 'harbor-ledger', 'community', 'harbor-city', 'New Year\'s Eve fireworks over the harbor at midnight', `Harbor City's New Year's Eve fireworks will launch from a barge at midnight. Harbor Boulevard closes to cars from 9 p.m. on Dec. 31 to 1 a.m. on Jan. 1, ${year + 1}; extra buses run until 2 a.m.`],
    ]) add({id: `holiday-${year}${md.replace('-', '')}`, story_id: sid, outlet, section, geography, date: `${year}-${md}`, time: '06:' + pad(int(0, 45)), headline: h, text: t});
  }
}

// ---------- assemble ----------
// Each beat draws from its own random stream, so changing one beat leaves the others' records unchanged.
for (const [i, beat] of [gulls, transit, calder, calderAgencies, environment, community, national, nationalMore, world, elFaro, holidays].entries()) {state = 20250101 + 7919 * (i + 1); beat();}
state = 20261014; // reading history
for (const e of fixture.editions) {if (ids.has(e.edition_id)) throw Error('generated ID collides with fixture ' + e.edition_id); editions.push(structuredClone(e)); ids.add(e.edition_id);}
for (const s of fixture.stories) if (!stories.has(s.story_id)) stories.set(s.story_id, {...s});
// A story group exists from ten minutes before its first edition (or its fixture time, if earlier).
for (const s of [...stories.values()]) {
  const own = editions.filter(e => e.story_id === s.story_id).map(e => Date.parse(e.added_at));
  if (!own.length) {stories.delete(s.story_id); continue;} // a group whose editions were all skipped
  const fx = fixture.stories.find(x => x.story_id === s.story_id);
  const first = Math.min(...own) - 10 * 60000;
  s.created_at = fx && Date.parse(fx.created_at) <= first ? fx.created_at : formatLA(first);
}
editions.sort((a, b) => Date.parse(a.added_at) - Date.parse(b.added_at) || a.edition_id.localeCompare(b.edition_id));

// Ana's history: the fixture reads and save stay verbatim; earlier reads follow her interests.
const clock = Date.parse(CLOCK);
const interests = {transport: 0.8, sports: 0.55, 'local-government': 0.6, politics: 0.5, world: 0.5, community: 0.6, environment: 0.6, weather: 0.35, education: 0.5, economy: 0.3, business: 0.4, national: 0.4, region: 0.05};
const reading_history = [], reading_list = [];
const readIds = new Set(fixture.reading_history.map(h => h.edition_id)), savedIds = new Set(fixture.reading_list.map(s => s.edition_id));
for (const e of editions) {
  const added = Date.parse(e.added_at);
  if (added >= FIXTURE_START || readIds.has(e.edition_id) || !chance(interests[e.section] ?? 0.1)) continue;
  // She reads with breakfast, in the evening, or the next morning.
  const local = formatLA(added), date = local.slice(0, 10), hour = Number(local.slice(11, 13));
  const [d, hm] = hour < 7 ? [date, pick(['07:', '08:']) + pad(int(0, 59))]
    : hour < 20 ? [date, pick(['20:', '21:', '22:']) + pad(int(0, 59))] : [addDays(date, 1), pick(['06:', '07:']) + pad(int(0, 59))];
  let t = Date.parse(la(d, hm));
  if (t < added) t = added + int(5, 90) * 60000;
  if (t >= FIXTURE_START) continue;
  reading_history.push({edition_id: e.edition_id, read_at: formatLA(t)}); readIds.add(e.edition_id);
  if (['transport', 'education', 'community', 'local-government', 'politics'].includes(e.section) && !savedIds.has(e.edition_id) && chance(0.12)) {
    reading_list.push({edition_id: e.edition_id, saved_at: formatLA(t + 60000)}); savedIds.add(e.edition_id);
  }
}
reading_history.sort((a, b) => Date.parse(a.read_at) - Date.parse(b.read_at));
reading_history.push(...structuredClone(fixture.reading_history));
reading_list.push(...structuredClone(fixture.reading_list));

const seed = {account_id: fixture.account_id, owner_person_id: fixture.owner_person_id, outlets: fixture.outlets,
  stories: [...stories.values()].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.story_id.localeCompare(b.story_id)),
  editions, front_pages: fixture.front_pages, reading_history, reading_list};

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
write('binding.json', JSON.parse(fs.readFileSync(path.join(pkg, 'fixtures/binding.json'), 'utf8')));
write('policies.json', JSON.parse(fs.readFileSync(path.join(pkg, 'fixtures/policies.json'), 'utf8')));
const base = JSON.parse(fs.readFileSync(path.join(pkg, 'contribution/dataset.json'), 'utf8'));
write('dataset.json', {
  ...base, dataset_id: 'dayline-evaluation-2025-2026', version: DATASET_VERSION,
  description: 'Synthetic evaluation catalog and one reader history covering 2025-01-01 through 2026-12-31 (America/Los_Angeles). Editions from six fictional outlets in English and Spanish; the 25 fixture editions, front pages and Ana Torres\'s fixture history are included verbatim. Loadable with env.load_seed at any clock in the window; Dayline shows only records dated at or before the clock.',
  record_source_ids: ['authored', 'generated'],
  sources: [base.sources[0], {
    source_id: 'generated', kind: 'synthetic',
    description: 'Template-generated fictional editions and reading history written by dev/build-dataset.cjs. All outlets, people, places, teams, companies and events are invented; nothing was collected from real websites.',
    uri: null, license: 'MIT', usage: 'permitted', collection: null,
    generation: {method: 'template', tool: 'dev/build-dataset.cjs', tool_version: DATASET_VERSION, seed: 20250101,
      parameters: {window: ['2025-01-01', '2026-12-31'], time_zone: 'America/Los_Angeles', clock: CLOCK,
        outputs: {'seed.json': {bytes: Buffer.byteLength(seedText), sha256: crypto.createHash('sha256').update(seedText).digest('hex')}}}},
  }],
  transformations: ['Fixture editions, stories, front pages, reading history and reading list are copied verbatim; story groups that the fixture shares gain earlier and later editions and an earlier created_at.',
    'Member papers republish some wire dispatches word for word, with a credit to the source edition.'],
  expected_counts: {records: editions.length, assets: 0},
});
console.log({editions: editions.length, stories: stories.size, reading_history: reading_history.length, reading_list: reading_list.length, bytes: Buffer.byteLength(seedText), compact_bytes: Buffer.byteLength(JSON.stringify(seed))});
