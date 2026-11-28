'use strict';
// Maintainer script (not run by tests or the verifier). Builds the Wirewalk evaluation dataset in
// data/evaluation/: one reader seed covering 2025-01-01 through 2026-12-31 (America/Los_Angeles).
// It keeps the 14 fixture accounts, the 37 fixture posts and Priya Raman's fixture bookmark verbatim
// and adds two years of public posts, nine accounts and Priya's earlier bookmarks around them, so the
// fixture storylines have a past and a future. The seven event posts (examples/scenario.json and
// examples/wildfire-events.json) stay events: they apply on top of this seed exactly as on the fixture.
// Deterministic: the same script writes the same bytes. Usage, from the package directory:
//   node dev/build-dataset.cjs
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const pkg = path.resolve(__dirname, '..');
const outDir = path.join(pkg, 'data/evaluation');
const load = file => JSON.parse(fs.readFileSync(path.join(pkg, file), 'utf8'));
const fixture = load('fixtures/minimal.json');
const EVENTS = [load('examples/scenario.json'), ...load('examples/wildfire-events.json')];
const DATASET_VERSION = '1.0.0', RNG_SEED = 20261010;
const CLOCK = load('fixtures/clock.json').initial_time; // Priya's bookmarks end here; public posts run on
// The authored storylines own Saturday to Monday, Oct. 10-12, 2026: nothing generated falls inside.
const STORY_FROM = Date.parse('2026-10-10T00:00:00-07:00'), STORY_TO = Date.parse('2026-10-13T00:00:00-07:00');

// ---------- deterministic helpers ----------
let state = RNG_SEED;
const rng = () => {state |= 0; state = state + 0x6D2B79F5 | 0; let t = Math.imul(state ^ state >>> 15, 1 | state);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296;};
const int = (a, b) => a + Math.floor(rng() * (b - a + 1));
const pick = list => list[Math.floor(rng() * list.length)];
const chance = p => rng() < p;
const shuffle = list => {const a = [...list]; for (let i = a.length - 1; i > 0; i--) {const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]];} return a;};
const pad = n => String(n).padStart(2, '0');
const cap = s => s[0].toUpperCase() + s.slice(1);
const thousands = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// ---------- calendar in America/Los_Angeles (DST: second Sunday of March to first Sunday of November) ----------
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
function nthWeekday(y, m, wd, n) {
  if (n > 0) {const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); return `${y}-${pad(m)}-${pad(1 + (wd - first + 7) % 7 + 7 * (n - 1))}`;}
  const last = new Date(Date.UTC(y, m, 0)), d = last.getUTCDate() - (last.getUTCDay() - wd + 7) % 7;
  return `${y}-${pad(m)}-${pad(d)}`;
}
const MONTHS = ['Jan.', 'Feb.', 'March', 'April', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const year = d => Number(d.slice(0, 4)), month = d => Number(d.slice(5, 7)), dom = d => Number(d.slice(8, 10));
const ap = d => `${MONTHS[month(d) - 1]} ${dom(d)}`;
const dayName = d => WEEKDAYS[weekday(d)];
const full = d => `${dayName(d)}, ${ap(d)}`;
const span = (a, b) => month(a) === month(b) ? `${ap(a)}-${dom(b)}` : `${ap(a)}-${ap(b)}`;
const hm = (h, m) => pad(h) + ':' + pad(m);
const rtime = (h0, h1) => hm(int(h0, h1), int(0, 59));
const addMin = (t, k) => {const [h, m] = t.split(':').map(Number), x = Math.max(0, Math.min(h * 60 + m + k, 23 * 60 + 59)); return hm(Math.floor(x / 60), x % 60);};
const clock12 = t => {const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'am' : 'pm'}`;};
const season = d => ({12: 'winter', 1: 'winter', 2: 'winter', 3: 'spring', 4: 'spring', 5: 'spring', 6: 'summer', 7: 'summer', 8: 'summer'})[month(d)] || 'fall';
const ALL = days('2025-01-01', '2026-12-31');
const inStory = d => d >= '2026-10-10' && d <= '2026-10-12';

// ---------- text variety: identical texts are refused and near-duplicates are retried ----------
const words = text => text.toLowerCase().split(/[^\p{L}\p{N}%$.]+/u).filter(Boolean);
const gramsOf = text => {const w = words(text), s = new Set(); for (let i = 0; i + 5 <= w.length; i++) s.add(w.slice(i, i + 5).join(' ')); return s;};
const seenText = new Set(), gramIndex = new Map(), gramSets = [];
function similarity(text) {
  const s = gramsOf(text), hits = new Map();
  for (const g of s) for (const i of gramIndex.get(g) || []) hits.set(i, (hits.get(i) || 0) + 1);
  let best = 0;
  for (const [i, inter] of hits) best = Math.max(best, inter / (s.size + gramSets[i].size - inter));
  return best;
}
function remember(text) {
  seenText.add(text);
  const s = gramsOf(text), i = gramSets.length; gramSets.push(s);
  for (const g of s) {if (!gramIndex.has(g)) gramIndex.set(g, []); gramIndex.get(g).push(i);}
}
const fresh = text => typeof text === 'string' && !seenText.has(text) && similarity(text) < 0.6;
// Generated variants: up to twelve draws for a text unlike every earlier one, otherwise no post.
function choose(build) {for (let i = 0; i < 12; i++) {const t = build(); if (fresh(t)) return t;} return null;}

// ---------- accounts ----------
const account = (id, display_name, kind, bio, location, joined_at) => ({id, display_name, kind, bio, location, joined_at});
const NEW_ACCOUNTS = [
  account('corvale-transit', 'Corvale Regional Transit', 'organization', 'Corvale Regional Transit runs the Green Line and the county buses. Board news, fares and service changes. Live service alerts: @green-line-ops.', 'Corvale', '2014-02-03T09:00:00-08:00'),
  account('corvale-lantern', 'The Corvale Lantern', 'organization', 'Nonprofit local news for Corvale, Pine Hollow and Lakeview. Tips: news@corvale-lantern.example', 'Corvale', '2015-06-15T08:00:00-07:00'),
  account('tamsen-fire', 'Tamsen County Fire', 'organization', 'Incident updates, burn permits and defensible-space inspections from Tamsen County Fire. Evacuation notices come from @tamsen-oem.', 'Tamsen County', '2016-04-04T09:00:00-07:00'),
  account('quillfeather-hall', 'Quillfeather Hall', 'organization', 'All-ages music hall on Fennick St, two blocks from the Green Line. This week\'s lineup every Monday.', 'Corvale', '2018-03-01T12:00:00-08:00'),
  account('marisol-vega', 'Marisol Vega', 'person', 'Bike plus Green Line commuter from Lakeview. Asking for more bike parking at Fennick St since forever.', 'Lakeview', '2025-02-17T19:20:00-08:00'),
  account('nadia-ferrante', 'Nadia Ferrante', 'person', 'Transit and county government reporter at @corvale-lantern. Tips welcome.', 'Corvale', '2025-05-27T09:00:00-07:00'),
  account('beatrice-lam', 'Beatrice Lam', 'person', 'Retired librarian. Tomatoes, smoke maps and Pine Hollow Neighbors minutes.', 'Pine Hollow', '2025-07-22T14:10:00-07:00'),
  account('omar-haddad', 'Omar Haddad', 'person', 'I run a small coffee bar on Fennick St. Open late on Quillfeather show nights.', 'Corvale', '2026-01-09T08:45:00-08:00'),
  account('cinder-fork-recovery', 'Cinder Fork Recovery Center', 'organization', 'Tamsen County\'s center for residents affected by the Cinder Fork Fire: debris removal, rebuilding permits, insurance help and replacement documents.', 'Tamsen County', '2026-10-14T08:00:00-07:00'),
];
const accounts = [...structuredClone(fixture.accounts), ...NEW_ACCOUNTS];
const joined = new Map(accounts.map(a => [a.id, Date.parse(a.joined_at)]));
const active = (id, d) => joined.get(id) <= Date.parse(la(d, '00:00'));

// ---------- posts ----------
const posts = [], byId = new Map(), daySeq = new Map(), reposted = new Set(), tags = new Map();
for (const p of fixture.posts) {byId.set(p.id, p); if (p.text) remember(p.text);}
for (const e of EVENTS) if (e.payload.text) remember(e.payload.text);
// Field order matches what post.publish stores. IDs are w<yymmdd>-<n>, apart from the fixture's p01-p44.
function make(kind, author, at, body = {}) {
  const ms = Date.parse(at);
  if (ms >= STORY_FROM && ms < STORY_TO) return null;
  if (!joined.has(author)) throw Error('Unknown author ' + author);
  if (ms < joined.get(author)) return null;
  for (const key of ['parent_id', 'quoted_id', 'source_id']) {
    if (body[key] === undefined) continue;
    const target = byId.get(body[key]);
    if (!target || target.kind === 'repost' || Date.parse(target.published_at) > ms) throw Error('Bad reference ' + body[key]);
  }
  if (kind !== 'repost') {
    if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 1000) throw Error('Bad text for ' + author + ': ' + body.text);
    if (seenText.has(body.text)) throw Error('Duplicate text: ' + body.text);
    if (similarity(body.text) >= 0.8) throw Error('Near-duplicate text: ' + body.text);
    remember(body.text);
  }
  const key = at.slice(2, 10).replace(/-/g, ''), n = (daySeq.get(key) || 0) + 1;
  daySeq.set(key, n);
  const post = {id: `w${key}-${n}`, kind, author_id: author};
  for (const k of ['text', 'parent_id', 'quoted_id', 'source_id']) if (body[k] !== undefined) post[k] = body[k];
  Object.assign(post, {links: body.links || [], media: [], published_at: at});
  posts.push(post); byId.set(post.id, post);
  if (body.tag) tags.set(post.id, body.tag);
  return post;
}
const plus = (p, minutes) => formatLA(Date.parse(p.published_at) + minutes * 60000);
const say = (author, d, t, text, extra = {}) => text ? make('original', author, la(d, t), {text, ...extra}) : null;
const reply = (author, parent, minutes, text, extra = {}) => parent && text ? make('reply', author, plus(parent, minutes), {text, parent_id: parent.id, ...extra}) : null;
const quote = (author, source, minutes, text, extra = {}) => source && text ? make('quote', author, plus(source, minutes), {text, quoted_id: source.id, ...extra}) : null;
function repost(author, source, minutes) {
  if (!source || author === source.author_id || reposted.has(author + '\n' + source.id)) return null;
  const p = make('repost', author, plus(source, minutes), {source_id: source.id});
  if (p) reposted.add(author + '\n' + source.id);
  return p;
}
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60).replace(/-$/, '');
const lanternLink = (d, headline, dek) => [{url: `https://corvale-lantern.example/${d.slice(0, 4)}/${d.slice(5, 7)}/${dom(d)}/${slug(headline)}`, title: headline, description: dek}];
const alertLink = (path, title) => [{url: 'https://alerts.tamsen-county.example/' + path, title, description: 'Tamsen County Emergency Management alert page'}];
const transitLink = (path, title, description) => [{url: 'https://corvale-transit.example/' + path, title, description}];
// A Lantern story: the headline as the post, with its link card.
const lantern = (d, t, headline, dek, tag) => say('corvale-lantern', d, t, headline, {links: lanternLink(d, headline, dek), tag});
const RIDERS = ['mika-sorensen', 'tessa-lu', 'marisol-vega', 'june-okoro', 'devin-hart', 'omar-haddad'];
const riderOn = d => pick(RIDERS.filter(r => active(r, d)));

// ---------- beat: Quillfeather Hall (runs first so residents can talk about the shows) ----------
const GENRES = ['Balkan brass', 'bluegrass', 'Afrobeat', 'surf rock', 'string quartet', 'cumbia', 'jazz organ trio', 'Celtic fiddle',
  'punk', 'soul revue', 'klezmer', 'Delta blues', 'synth-pop', 'gospel choir', 'flamenco guitar', 'big band swing', 'indie folk', 'reggae',
  'honky-tonk', 'Brazilian choro', 'hip-hop showcase', 'singer-songwriter', 'zydeco', 'doom metal', 'mariachi', 'chamber choir',
  'garage rock', 'Irish session', 'ambient electronic', 'Western swing', 'Cape Verdean morna', 'barbershop', 'old-time string band',
  'Latin jazz', 'shoegaze', 'steel pan', 'cello rock', 'polka', 'Ethiopian jazz', 'roots rock'];
const an = g => (/^[aeiou]/i.test(g) ? 'an ' : 'a ') + g;
const FORMATS = [g => `${g} night`, g => `${an(g)} double bill`, g => `${g} with two Corvale openers`, g => `an album-release show (${g})`,
  g => `${an(g)} dance party`, g => `${g} from the community college music program`,
  g => `${g} plus an open jam after the set`, g => `${an(g)} tribute night`, g => `${g}, seated show`];
const shows = []; // {date, genre, line}
function quillfeather() {
  let genres = [];
  const DAYS = {4: 'Thu.', 5: 'Fri.', 6: 'Sat.'};
  for (const monday of ALL.filter(d => weekday(d) === 1)) {
    const md = monday.slice(5);
    if (md >= '12-20' && md <= '12-26') { // holiday closure
      say('quillfeather-hall', monday, '11:' + pad(int(0, 50)), `Quillfeather is closed from ${ap(monday)} through ${ap(addDays(monday, 13))} for the holidays and our yearly floor refinishing. ${year(monday) === 2025 ? 'See you in January.' : 'Back Jan. 7 with a full month of shows.'}`);
      continue;
    }
    if (md >= '12-27' || md <= '01-04') continue;
    if (monday.slice(5, 7) === '08' && dom(monday) >= 10 && dom(monday) <= 23) continue; // summer break
    const lines = [];
    let nights;
    if (monday === '2026-10-05') nights = [5, 6];
    else nights = shuffle([4, 5, 6]).slice(0, pick([1, 2, 2, 2, 3])).sort();
    for (const wd of nights) {
      const date = addDays(monday, wd - 1);
      let genre, line;
      if (date === '2026-10-10') {
        // The fixture's Saturday show (p02, p16): doors at 7, music until 11, an opener before the main set.
        genre = 'soul revue';
        line = `Sat. ${ap(date)}: soul revue with an opening set from the Corvale High jazz band. Doors 7 pm, music 8 to 11 pm. $22.`;
      } else {
        if (!genres.length) genres = shuffle(GENRES);
        genre = genres.pop();
        const doors = pick(['7 pm', '7 pm', '7:30 pm', '8 pm', '6 pm']), start = {'6 pm': '6:30', '7 pm': '8', '7:30 pm': '8:30', '8 pm': '9'}[doors];
        const end = doors === '6 pm' ? '9 pm' : pick(['10:30 pm', '11 pm', '11 pm', 'midnight']);
        const price = month(date) >= 11 && chance(0.3) ? 'Free with a canned-food donation' : '$' + pick([12, 15, 15, 18, 20, 22, 25]);
        line = `${DAYS[wd]} ${ap(date)}: ${pick(FORMATS)(genre)}. Doors ${doors}, music ${start} to ${end}. ${price}.`;
      }
      lines.push(line); shows.push({date, genre});
    }
    const tail = pick(['Fennick St is the closest Green Line stop.', 'Tickets at the door only.', 'Bike racks are on the 11th Ave side.',
      'Earplugs are free at the bar.', 'All shows all ages unless noted.', 'Coat check is back for the season.']);
    const p = say('quillfeather-hall', monday, '10:' + pad(int(0, 40)), `This week at Quillfeather Hall:\n${lines.join('\n')}\n${tail}`, {tag: 'quill-week'});
    if (p && chance(0.12)) {
      const s = shows[shows.length - 1];
      reply('quillfeather-hall', p, int(60 * 24, 60 * 24 * 3), choose(() => `${dayName(s.date)}'s ${s.genre} show is sold out. ${pick(['No tickets at the door, sorry.', 'Thank you, Corvale.', 'A few standing spots may open at 9.'])}`));
    }
  }
}
const showOn = d => shows.find(s => s.date === d);

// ---------- beat: Green Line operations ----------
const CAUSES = [
  ['a signal problem at Ash Yard', 'Signal crews have cleared the problem at Ash Yard'],
  ['a disabled train between Fennick St and Ash Yard', 'The disabled train is back at Ash Yard'],
  ['police activity at Fennick St station', 'Police have finished at Fennick St station'],
  ['a medical emergency on a train at Fennick St', 'The train held for a medical call at Fennick St is moving again'],
  ['a switch problem at Ash Yard', 'The Ash Yard switch is repaired'],
  ['a power problem on the overhead wire near Fennick St', 'Power is back on the overhead wire near Fennick St'],
  ['a car stopped on the tracks at the Ash Yard crossing', 'The car at the Ash Yard crossing has been towed'],
  ['a door fault on a train at Fennick St', 'The train with the door fault is out of service'],
  ['a person walking near the tracks east of Fennick St', 'Police say the person near the tracks has left the area'],
  ['an unplanned track inspection near Ash Yard', 'The track inspection near Ash Yard is finished'],
  ['a broken-down bus blocking the Fennick St station loop', 'The bus blocking the Fennick St loop has been towed'],
  ['heat speed restrictions', 'Heat speed restrictions are lifted for the evening', [6, 7, 8, 9]],
  ['slippery rail from wet leaves', 'The rail-cleaning train has finished', [10, 11, 12]],
  ['a tree branch on the overhead wire', 'Crews have removed the branch from the overhead wire', [11, 12, 1, 2, 3]],
];
const DELAY = [
  x => `${x.Dir} Green Line trains are running about ${x.n} minutes late because of ${x.cause}.`,
  x => `Delays of up to ${x.n} minutes in both directions after ${x.cause}. Trains are moving but holding briefly at Fennick St.`,
  x => `${x.Dir} Green Line: ${x.n}-minute delays because of ${x.cause}. ${x.Other} trains are on time.`,
  x => `If you are waiting for the ${clock12(x.t)} ${x.dir} train: it and the trains behind it are about ${x.n} minutes late because of ${x.cause}.`,
  x => `Trains are sharing one track between Fennick St and Ash Yard because of ${x.cause}. Expect ${x.n} to ${x.n + 5} minutes of delay in both directions.`,
];
const CLEARED = [
  x => `${x.fix}. ${x.Dir} trains are back on schedule as of ${clock12(x.t2)}.`,
  x => `Update ${clock12(x.t2)}: ${x.fix}. Delays should clear within ${x.k} minutes.`,
  x => `${x.fix}, and normal ${x.dir} service has resumed. Thanks for your patience this ${x.part}.`,
];
const CANCEL = [
  x => `The ${clock12(x.t)} ${x.dir} Green Line train from Fennick St is canceled because no operator is available. The next ${x.dir} train leaves at ${clock12(x.t2)}.`,
  x => `Canceled: the ${clock12(x.t)} ${x.dir} trip from Fennick St (operator shortage). Next ${x.dir} departure: ${clock12(x.t2)}.`,
  x => `We are short an operator this ${x.part}, so the ${clock12(x.t)} ${x.dir} train will not run. Regular service resumes with the ${clock12(x.t2)} departure.`,
];
const DEST = ['work', 'daycare pickup', 'a dentist appointment', 'a job interview', 'the bus to Pine Hollow', 'a doctor\'s appointment'];
const RIDER = [
  x => `Stuck on the ${x.dir} platform at Fennick St with about ${x.crowd} other people.`,
  x => `${pick(['Second', 'Third'])} time this week I'm late for ${pick(DEST)}. ${x.n} minutes is a lot when you have a bus to catch.`,
  x => `Is this why my ${clock12(x.t)} train sat at Ash Yard for ${x.k} minutes?`,
  x => `Any idea how long? I need to be at ${pick(DEST)} by ${clock12(addMin(x.t, int(25, 50)))}.`,
  x => `The sign at Fennick St still says on time for the ${clock12(addMin(x.t, int(3, 12)))}.`,
  x => `Thanks for posting. Walking to the bus instead; ${pick(['route 7', 'route 12', 'route 4'])} just pulled up.`,
];
function greenLine() {
  for (const d of ALL) {
    if (inStory(d)) continue;
    const wd = weekday(d), m = month(d);
    if (!chance(wd === 0 || wd === 6 ? 0.1 : 0.22)) continue;
    const hour = pick([6, 7, 7, 8, 8, 9, 12, 15, 16, 17, 17, 18, 19, 21]), t = hm(hour, int(0, 59));
    if (busBridge.has(d) || (busBridge.has(d + ' night') && hour >= 20)) continue;
    const dir = pick(['eastbound', 'westbound']), other = dir === 'eastbound' ? 'westbound' : 'eastbound';
    const part = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    const short = (d >= '2025-04-01' && d <= '2025-12-31') || d >= '2026-09-01' ? 0.3 : 0.07;
    if (chance(short)) {
      const x = {dir, t, t2: addMin(t, pick([15, 15, 20, 30])), part};
      const p = say('green-line-ops', d, addMin(t, -int(4, 20)), choose(() => pick(CANCEL)(x)), {tag: 'cancel'});
      if (p && chance(0.35)) reply(riderOn(d), p, int(2, 12), choose(() => pick(RIDER)({...x, n: int(15, 30), crowd: int(20, 60), k: int(5, 15)})));
      continue;
    }
    const c = pick(CAUSES.filter(x => !x[2] || x[2].includes(m)));
    const x = {dir, Dir: cap(dir), Other: cap(other), n: pick([4, 5, 6, 7, 8, 10, 10, 12, 15, 15, 20, 25]), cause: c[0], fix: c[1], t, part};
    const p = say('green-line-ops', d, t, choose(() => pick(DELAY)(x)), {tag: 'delay'});
    if (!p) continue;
    if (chance(0.3)) reply(riderOn(d), p, int(2, 14), choose(() => pick(RIDER)({...x, crowd: int(15, 80), k: int(4, 18)})));
    if (chance(0.55)) {
      const later = int(20, 80);
      reply('green-line-ops', p, later, choose(() => pick(CLEARED)({...x, t2: addMin(t, later), k: int(5, 15)})));
    }
    if (chance(0.06)) quote('corvale-scanner', p, int(3, 20), choose(() => `${pick(['Riders at Fennick St', 'Folks on the platform', 'Several riders'])} ${pick(['say the wait is longer than this', 'report packed trains', 'are asking about connections to route 7'])}. Official word ${pick(['below', 'here'])}.`));
  }
}

// Weekend track work: one weekend most months, with buses replacing trains.
const WORK = [
  ['replacing worn rail between Fennick St and Ash Yard', 'between Fennick St and Ash Yard'],
  ['upgrading the signals at Ash Yard', 'between Fennick St and Ash Yard'],
  ['repairing the platform edge at Fennick St', 'through Fennick St'],
  ['rebuilding the Ash Yard grade crossing', 'between Fennick St and Ash Yard'],
  ['replacing overhead wire east of Fennick St', 'east of Fennick St'],
  ['grinding rail through Ash Yard', 'between Fennick St and Ash Yard'],
  ['replacing wooden ties west of Ash Yard', 'west of Ash Yard'],
  ['testing the new signal system at Ash Yard', 'between Fennick St and Ash Yard'],
  ['installing platform lighting and cameras at Fennick St', 'through Fennick St'],
  ['inspecting the bridge east of Fennick St', 'east of Fennick St'],
];
const TRACK = [
  x => `Weekend track work, ${x.span}: crews are ${x.work}. Buses replace Green Line trains ${x.seg} from ${x.start} Friday until the last trip Sunday. Allow ${x.extra} extra minutes.`,
  x => `Planning a trip ${x.span}? No trains ${x.seg} that weekend while crews are ${x.work}. Shuttle buses run every ${x.every} minutes from ${x.start} Friday.`,
  x => `${cap(x.work)} means a bus bridge ${x.seg} on ${x.span}, starting at ${x.start} Friday. Trips take about ${x.extra} minutes longer than usual.`,
  x => `Track work notice for ${x.span}, ${x.seg}: we are ${x.work}. Buses take over at ${x.start} Friday, and trains return for Monday's first trip.`,
];
const busBridge = new Set(); // Friday night to Sunday of each track-work weekend: no trains on that segment
function trackWork() {
  let works = [];
  for (let y = 2025; y <= 2026; y++) for (let m = 1; m <= 12; m++) {
    if (m === 7 || m === 12) continue;
    // Not on the late-service weekends the operator posts about, nor the storyline weekend.
    let sat = nthWeekday(y, m, 6, pick([2, 3]));
    if (y === 2026 && m === 9) sat = '2026-09-26';
    else if (y === 2026 && m === 10) sat = '2026-10-24';
    else if (sat === '2026-04-11') sat = '2026-04-25';
    const sun = addDays(sat, 1), monday = addDays(sat, -5), friday = addDays(sat, -1);
    busBridge.add(friday + ' night').add(sat).add(sun);
    if (!works.length) works = shuffle(WORK);
    const [work, seg] = works.pop(), x = {work, seg, span: span(sat, sun), extra: pick([15, 20, 20, 25, 30]), start: pick(['9 pm', '9 pm', '10 pm', '8:30 pm']), every: pick([10, 12, 15])};
    const p = say('green-line-ops', monday, rtime(10, 12), choose(() => pick(TRACK)(x)),
      {links: transitLink(`service/track-work-${sat}`, `Track work ${span(sat, sun)}`, 'Bus bridge map and schedule'), tag: 'track-work'});
    const side = pick(['the 11th Ave side', 'the Fennick St side', 'the north curb', 'the bus loop']);
    reply('green-line-ops', p, Math.round((Date.parse(la(friday, rtime(14, 16))) - Date.parse(p.published_at)) / 60000), choose(() => pick([
      `Reminder: the bus bridge ${seg} starts at ${x.start} tonight and runs through ${full(sun)}. Shuttles stop on ${side} at Fennick St.`,
      `Starting tonight at ${x.start}: buses replace trains ${seg} through ${full(sun)}. Bikes ride free on the shuttles, ${pick([2, 3])} per bus.`,
      `This weekend's bus bridge (${span(sat, sun)}) is on as planned. Look for the orange signs on ${side} at Fennick St.`,
    ])));
    if (chance(0.35)) repost(pick(['june-okoro', 'corvale-scanner', 'tessa-lu']), p, int(30, 600));
  }
}

const HOLIDAYS = [
  [y => `${y}-01-01`, 'New Year\'s Day', 'Sunday'], [y => nthWeekday(y, 5, 1, -1), 'Memorial Day', 'Sunday'],
  [y => `${y}-07-04`, 'Independence Day', 'Saturday'], [y => nthWeekday(y, 9, 1, 1), 'Labor Day', 'Sunday'],
  [y => nthWeekday(y, 11, 4, 4), 'Thanksgiving', 'Sunday'], [y => `${y}-12-25`, 'Christmas Day', 'Sunday'],
];
function holidaySchedules() {
  for (let y = 2025; y <= 2026; y++) for (const [date, name, schedule] of HOLIDAYS) {
    const d = date(y), posted = name === 'New Year\'s Day' ? d : addDays(d, -int(2, 4));
    const first = hm(int(5, 6), pick([5, 10, 20, 35, 40])), last = name === 'Independence Day' ? hm(0, 0) : hm(int(22, 23), pick([10, 25, 40]));
    // One wording per year, so the two years' notices differ in more than the date.
    const notes = {
      'New Year\'s Day': [`Happy 2025. Trains run a Sunday schedule today, ${full(d)}; the first trains leave Fennick St at ${clock12(first)}.`,
        `New Year's Day, ${full(d)}: Sunday schedule all day. If you rode free last night, thank you for leaving the car at home.`],
      'Memorial Day': [`${full(d)} (Memorial Day): Green Line trains run a Sunday schedule, first trains at ${clock12(first)} and last trains at ${clock12(last)}.`,
        `Memorial Day weekend: Saturday and Sunday schedules as usual, and Monday, ${ap(d)}, runs on Sunday times. Ticket windows at Fennick St are closed Monday.`],
      'Independence Day': [`${full(d)}: a Saturday schedule plus extra trains after the fireworks. The last trains leave Fennick St at 12:40 am in both directions.`,
        `July 4 falls on a Saturday this year. Regular Saturday service, then four extra trains after the fireworks over the Lakeview marina; the last ones leave Fennick St at 12:55 am.`],
      'Labor Day': [`Labor Day, ${full(d)}: Sunday schedule on the Green Line. Customer service windows at Fennick St are closed.`,
        `No weekday service on ${full(d)} (Labor Day). Trains follow the Sunday timetable, and ticket machines work as usual.`],
      'Thanksgiving': [`${full(d)} (Thanksgiving): Sunday schedule, last trains at ${clock12(last)}. Friday is a regular weekday schedule.`,
        `Thanksgiving week: on ${full(d)} trains run Sunday times, and on Friday, Nov. 27, a Saturday schedule. Plan for full trains Wednesday evening.`],
      'Christmas Day': [`${full(d)}: Green Line trains run a Sunday schedule, ending early with the last trains at ${clock12(hm(21, pick([10, 25, 40])))}. Dec. 26 is a regular Friday schedule.`,
        `Christmas Day is a Friday this year. Sunday schedule on the 25th with an early finish around 10 pm, then a normal Saturday on the 26th, including late service.`],
    };
    say('green-line-ops', posted, rtime(8, 11), notes[name][y - 2025], {tag: 'holiday-schedule'});
  }
}

// ---------- beat: Corvale Regional Transit board, fares and the Saturday late-service pilot ----------
// [agenda, outcome, reporter's note or null, Lantern headline and dek or null]
const BOARD = [
  ['the 2025 service plan and a contract for 12 new bus shelters', 'Board adopted the 2025 service plan, 7-0, and approved 12 new bus shelters, four of them on Fennick St.', null, null],
  ['a proposed fare increase from $2.25 to $2.50 and dates for public hearings', 'Board set two hearings on the fare proposal: March 4 in Lakeview and March 6 in Pine Hollow. Written comments are open until March 31.', null,
    ['Transit board proposes first fare increase since 2019', 'A Green Line or bus ride would cost $2.50 from July 1 if the board approves it in April.']],
  ['a report on the fare hearings and the spring rider survey', 'Staff reported 214 public comments on the fare proposal, most asking for a cheaper monthly pass. The vote is set for April 10.', null, null],
  ['the fare vote', 'Board approved the fare increase to $2.50 from July 1, 5-2, and kept the monthly pass at $72 instead of raising it to $80.', null,
    ['Green Line and bus fares rise to $2.50 in July', 'The board kept the $72 monthly pass after riders pushed back at two hearings.']],
  ['operator hiring and overtime costs', 'Staff said the agency is 14 operators short. Board approved $9,000 hiring bonuses for new Green Line operators.', null,
    ['Transit agency is 14 operators short, offers $9,000 bonuses', 'Canceled Green Line trips have tripled since January, staff told the board.']],
  ['the 2025-26 budget', 'Board adopted a $148 million budget for 2025-26. Green Line hours stay the same; routes 4 and 12 gain Sunday service.', 'The budget assumes the operator shortage eases by winter. If it does not, the Sunday bus service is the first thing staff said they would delay.', null],
  ['the Fennick St station elevator contract', 'Board awarded a $6.2 million contract to replace both Fennick St elevators. Work starts in October and takes about a year; one elevator stays open at all times.', 'Fennick St has had at least one elevator out of service on 41 days this year, according to the staff report.',
    ['Fennick St elevators to be replaced, one at a time', 'The $6.2 million project starts in October and should finish in fall 2026.']],
  ['ridership after the new fares', 'July ridership fell 2% from June after the fare increase, about what staff expected for summer.', 'Monthly pass sales went up 9% in July. Riders who use the train every day switched to the pass, staff said.', null],
  ['a proposal for Saturday late Green Line service', 'Staff proposed running Saturday Green Line trains until about 11 pm as a pilot. Board asked for a cost estimate before voting.', 'Riders from Lakeview and Pine Hollow lined up for public comment on late Saturday trains. Most said they now drive to Fennick St shows or leave early.',
    ['Transit staff propose Saturday late trains as a pilot', 'Last Saturday trains now leave Fennick St around 10:40 pm. The pilot would run them until about 11.']],
  ['the late-service cost estimate and winter storm plans', 'A Saturday late-service pilot would cost about $410,000 a year, mostly operator overtime. Board will decide after the mid-year budget review.', 'Two directors said they support late trains but not before the agency hires enough operators to run the daytime schedule.', null],
  ['the mid-year budget review', 'Mid-year review shows fare revenue $1.1 million above plan. The late-service vote is set for February.', null, null],
  ['holiday service and the 2026 board calendar', 'Board approved free rides after 8 pm on New Year\'s Eve and elected a new chair for 2026.', null, null],
  ['an operator hiring update', 'The agency is now 6 operators short, down from 14 in May. Hiring bonuses continue through June.', 'Fewer canceled trips since November: 31 in December, compared with 112 in June, staff said.', null],
  ['the Saturday late-service pilot vote', 'Board approved a six-month Saturday late-service pilot, 6-1. From April 4, the last Saturday Green Line trains leave Fennick St at 11:10 pm in both directions.', 'The one no vote said the pilot should wait for the new trains. Staff said the current fleet can cover four more Saturday trips.',
    ['Saturday Green Line trains will run until 11:10 pm starting April 4', 'The six-month pilot costs about $205,000 and will be reviewed in August.']],
  ['the delivery schedule for new light-rail vehicles', 'The first of 8 new Green Line trains arrives in May for testing; all 8 should be in service by early 2027.', null, null],
  ['the first weekend of late service', 'About 190 riders boarded after 10 pm on April 4, the first Saturday of late service, staff said.', 'Staff said about half of the late riders on April 4 boarded at Fennick St, most of them after shows on Fennick St.', null],
  ['elevator work at Fennick St and a bus route survey', 'The first new Fennick St elevator opened this week. Staff launched a survey on redrawing three bus routes in Lakeview.', null, null],
  ['the 2026-27 budget', 'Board adopted a $156 million budget for 2026-27, with money to keep Saturday late service through December.', null,
    ['Transit budget keeps late Saturday trains through December', 'The $156 million budget also pays for night testing of the new Green Line trains.']],
  ['late-service ridership', 'Saturday late trains average 260 riders after 10 pm, more than the 150 the board set as its bar for keeping the pilot, staff said.', 'The busiest late trips are the last two departures from Fennick St; staff counts show about 70% of late riders board between 10:45 and 11:10 pm.', null],
  ['extending late service', 'Board extended the late-service pilot through December and moved the last Saturday trains from 11:10 pm to 11:40 pm starting Sept. 12.', 'The 11:40 pm trips will run on overtime until the agency hires four more operators, staff said.',
    ['Last Saturday Green Line trains move to 11:40 pm on Sept. 12', 'The board extended the late-service pilot through December.']],
  ['operator staffing for the later trains', 'Staff said the 11:40 pm Saturday trains need four more operators. Until they are hired, the late trips run on overtime and depend on volunteers.', 'I asked what happens if no one volunteers for a late trip. Staff said a supervisor would drive it if one is available.', null],
  ['winter storm plans and the elevator project', 'Board heard winter storm plans. The second Fennick St elevator is due to open in November.', null, null],
  ['making Saturday late service permanent', 'Board made Saturday late service permanent from January and asked for a report on the Oct. 10 cancellation, which staff blamed on an operator calling in sick with no backup.', 'Staff said a standby operator will be scheduled for every Saturday late trip from now on.',
    ['Saturday late trains become permanent; transit board wants answers on Oct. 10 cancellation', 'The canceled 11:40 pm eastbound left riders from a Quillfeather Hall show waiting at Fennick St.']],
  ['free New Year\'s Eve rides and the 2027 calendar', 'Free rides after 8 pm on New Year\'s Eve are back. Board elected its 2027 chair and set meetings for the second Thursday of each month.', null, null],
];
const boardOutcome = new Map();
function transitBoard() {
  let i = 0;
  for (let y = 2025; y <= 2026; y++) for (let m = 1; m <= 12; m++, i++) {
    const [agenda, outcome, note, story] = BOARD[i], thursday = nthWeekday(y, m, 4, 2), monday = addDays(thursday, -3);
    const a = say('corvale-transit', monday, rtime(9, 11), `Board of Directors meets ${full(thursday)}, at 6 pm in the Fennick St transit center: ${agenda}. Public comment is open in person and online.`,
      {links: transitLink(`board/${thursday}`, `Board meeting, ${ap(thursday)}, ${y}`, 'Agenda, staff reports and live stream'), tag: 'board'});
    const o = reply('corvale-transit', a, Math.round((Date.parse(la(thursday, rtime(20, 21))) - Date.parse(a.published_at)) / 60000), outcome, {tag: /late/.test(outcome) ? 'late-service' : 'board'});
    boardOutcome.set(thursday, o);
    if (note) quote('nadia-ferrante', o, int(4, 25), note) || say('corvale-lantern', thursday, '21:50', note);
    if (story) lantern(addDays(thursday, 1), rtime(6, 8), story[0], story[1], /late|Saturday/.test(story[0]) ? 'late-service' : 'lantern-transit');
    if (o && chance(0.25)) repost('june-okoro', o, int(30, 300));
  }
}

function lateService() {
  // The Saturday late-service pilot as riders and the operator saw it, and the Oct. 10 cancellation afterwards.
  const ops = (d, t, text, tag = 'late-service') => say('green-line-ops', d, t, text, {tag});
  const first = ops('2026-04-04', '09:30', 'Saturday late service starts tonight: the last eastbound and westbound Green Line trains leave Fennick St at 11:10 pm, 30 minutes later than before.');
  reply('marisol-vega', first, 42, 'Finally. No more leaving shows at 10:15 to make the last train.');
  const hal = reply('hal-reyes', first, 75, 'Does the 11:10 eastbound wait if the westbound is late? Asking for everyone at Quillfeather.');
  reply('green-line-ops', hal, 18, '@hal-reyes Trains leave on time and do not hold for each other, so give yourself a few minutes at Fennick St.');
  repost('devin-hart', first, 120); repost('june-okoro', first, 200);
  ops('2026-04-11', '19:20', 'Tonight\'s 11:10 pm trains will run with two extra cars after last Saturday\'s full opening night of late service.');
  const sept = ops('2026-09-12', '10:00', 'From tonight, the last Saturday Green Line trains leave Fennick St at 11:40 pm in both directions. Sunday through Friday schedules do not change.');
  reply('mika-sorensen', sept, 64, 'The 11:40 is going to save my Saturday night shifts. Thank you.');
  repost('quillfeather-hall', sept, 30);
  ops('2026-09-19', '21:30', 'Both 11:40 pm Saturday trains are running tonight. If you are coming from Quillfeather Hall, Fennick St is a five-minute walk.');
  ops('2026-10-03', '18:45', 'Saturday late service runs tonight as scheduled. The 11:10 and 11:40 pm departures from Fennick St stop at every station.');
  // After the fixture weekend: what happened to the 11:40 pm eastbound on Oct. 10.
  const why = lantern('2026-10-13', '07:10', 'Operator shortage canceled Saturday\'s last eastbound Green Line train, agency says', 'The 11:40 pm eastbound did not run because the scheduled operator called in sick and no standby was available, Corvale Regional Transit said.', 'lantern-transit');
  quote('nadia-ferrante', why, 20, 'The agency says it learned of the sick call at 8:55 pm. Its first post naming the canceled train went up at 9:12, after the photo of the station board had spread.');
  quote('tessa-lu', why, 95, 'Glad they answered within the night at least. The 10:55 was packed.');
  say('corvale-transit', '2026-10-14', '12:00', 'Statement on the Oct. 10 cancellation of the 11:40 pm eastbound Green Line train: we had no standby operator that night. Starting this Saturday, a standby operator is scheduled for every late trip.', {tag: 'late-service'});
  ops('2026-10-17', '19:30', 'Both 11:40 pm trains are running tonight, with a standby operator on duty at Ash Yard.');
  ops('2026-12-31', '08:00', 'Free rides on the Green Line from 8 pm tonight until the last trains, which leave Fennick St at 1:40 am. Happy New Year from the crews.');
  say('green-line-ops', '2025-12-31', '08:15', 'New Year\'s Eve: rides are free from 8 pm, and extra trains run until 1:30 am. The last trains leave Fennick St at 1:30 am in both directions.', {tag: 'holiday-schedule'});
  say('corvale-transit', '2025-12-29', '10:00', 'Free Green Line and bus rides after 8 pm on New Year\'s Eve, Wednesday, Dec. 31. Please ride instead of driving.');
  say('corvale-transit', '2026-12-28', '10:30', 'Free rides after 8 pm on New Year\'s Eve again this year, Thursday, Dec. 31. Late Green Line trains run until 1:40 am.');
  say('corvale-transit', '2025-06-24', '09:00', 'Reminder: fares change on July 1. A single ride is $2.50; the monthly pass stays at $72. Passes bought in June are good for their full month.', {tag: 'board'});
  say('corvale-transit', '2025-07-01', '06:00', 'New fares start today: $2.50 per ride, $1.25 reduced fare, $72 monthly pass. Transfers stay free for 90 minutes.');
  say('corvale-transit', '2026-05-19', '13:00', 'The first new Green Line train arrived at Ash Yard this morning. Night testing between Ash Yard and Fennick St starts in June; you may hear horn tests after midnight.');
  say('corvale-transit', '2026-11-19', '09:30', 'The second new Fennick St elevator is open. Both elevators now work for the first time since October 2025.');
  for (const [d, q, n] of [['2025-01-16', 'October to December 2024', '1.92 million'], ['2025-04-17', 'January to March', '1.88 million'], ['2025-07-17', 'April to June', '2.03 million'],
    ['2025-10-16', 'July to September', '1.97 million'], ['2026-01-15', 'October to December 2025', '2.01 million'], ['2026-04-16', 'January to March', '1.99 million'],
    ['2026-07-16', 'April to June', '2.14 million'], ['2026-10-15', 'July to September', '2.18 million']]) {
    say('corvale-transit', d, '11:00', `Ridership, ${q}: ${n} trips on the Green Line and buses. ${pick(['Green Line weekday trips grew fastest.', 'Saturday trips were up the most.', 'Bus routes 4 and 12 set records.', 'Weekday trains are back to their pre-2020 levels.'])}`);
  }
}

// ---------- beat: county emergency management and fire ----------
const HEAT = [['2025-06-24', 3, 104], ['2025-07-15', 4, 108], ['2025-08-05', 3, 103], ['2025-09-02', 3, 101],
  ['2026-06-16', 3, 102], ['2026-07-21', 4, 109], ['2026-08-11', 3, 105], ['2026-09-08', 3, 100]];
const heatDay = d => HEAT.some(([start, n]) => d >= start && d <= addDays(start, n - 1));
const TIPS = ['Sign up for county alerts by text or email on the alert page.', 'Keep a go-bag with medications, chargers and copies of documents.',
  'Make sure your house number can be read from the street.', 'Plan two ways out of your neighborhood.', 'Pets need a go-bag too: food, leash, carrier and vaccination records.',
  'Keep at least half a tank of gas during fire season.', 'Store three days of water, a gallon per person per day.', 'Practice your evacuation route with everyone in your household.',
  'Older neighbors may need a ride. Check on them when a warning is issued.', 'Know the difference: a WARNING means get ready, an ORDER means leave now.',
  'Clear dry leaves from gutters and roofs before the fall winds.', 'Have an N95 mask for each person for smoke days.', 'Keep a paper list of phone numbers in case your phone dies.',
  'Learn how to open your garage door by hand when the power is out.', 'Write down your insurance policy number and keep a copy away from home.',
  'Pick two meeting places: one near home and one outside your area.', 'Never run a generator indoors or in a garage.', 'Know where your gas and water shutoffs are.',
  'Back up important photos and documents online.', 'Keep sturdy shoes and a flashlight next to your bed.', 'Sign up for the county registry for residents who need help evacuating.',
  'Update your go-bag for the season: warm layers in winter, extra water in summer.', 'Save the county alert page on your phone\'s home screen.', 'Teach kids your evacuation zone name.'];
function county() {
  // Monthly alert-system test, first Wednesday at 10 am, each with a different tip.
  let i = 0;
  for (let y = 2025; y <= 2026; y++) for (let m = 1; m <= 12; m++) {
    const d = nthWeekday(y, m, 3, 1);
    let tip = TIPS[i++];
    if (y === 2025 && m === 6) tip = 'Know your zone. Pine Hollow is PH-1 and PH-2; Lakeview is LV-1, LV-2 and LV-3.';
    const p = say('tamsen-oem', d, '09:' + pad(int(30, 55)), `Monthly test of Tamsen County emergency alerts today, ${ap(d)}, at 10 am. No action needed. ${tip}`, {tag: 'tip'});
    if (chance(0.3)) repost(pick(['june-okoro', 'pine-hollow-neighbors', 'beatrice-lam']), p, int(20, 240));
  }
  // Evacuation zones, introduced in May 2025.
  const zones = say('tamsen-oem', '2025-05-06', '10:00', 'New: Tamsen County evacuation zones. Pine Hollow is PH-1 (north of the ridge road) and PH-2 (south of it). Lakeview is LV-1, LV-2 and LV-3; Corvale is CV-1 to CV-4. From now on, every warning and order names zones.',
    {links: alertLink('zones', 'Find your evacuation zone'), tag: 'zones'});
  quote('pine-hollow-neighbors', zones, 60, 'This is the map we asked for. County staff will walk through PH-1 and PH-2 at our meeting tonight, 7 pm at the fire station.');
  repost('tessa-lu', zones, 140); repost('june-okoro', zones, 300); repost('corvale-scanner', zones, 20);
  lantern('2025-05-07', '07:00', 'County adopts named evacuation zones for Pine Hollow, Lakeview and Corvale', 'Warnings and orders will name zones such as PH-1 and LV-3 instead of describing streets.', 'zones');
  say('tamsen-oem', '2025-05-20', '12:00', 'Not sure of your zone? Type your address into the zone finder on the alert page. Zone names are also painted on the curb at Pine Hollow and Lakeview fire stations.', {tag: 'zones'});
  // Heat: advisory the day before, and a closing post.
  const heatStories = [['HI°F and climbing: heat sends 11 people to Corvale emergency room', 'Cooling centers stay open through the end of the advisory; the county says to check on neighbors without air conditioning.'],
    ['Hottest July day in a decade: Corvale hits HI°F', 'The Green Line ran at reduced speed all afternoon, and the utility asked customers to cut power use from 4 to 9 pm.'],
    ['Third heat wave of the summer closes Lakeview pool early and fills cooling centers', 'Pool staff closed at 2 pm when the deck reached unsafe temperatures; the county opened a fourth cooling center.']];
  for (const [start, n, hi] of HEAT) {     const end = addDays(start, n - 1);
    const top = hi + int(1, 3), hours = pick(['10 am to 8 pm', '11 am to 9 pm', 'noon to 8 pm']);
    const p = say('tamsen-oem', addDays(start, -1), rtime(14, 16), choose(() => pick([
      `Heat advisory ${span(start, end)}: highs of ${hi} to ${top}°F in Corvale and Lakeview and about ${hi - int(3, 6)} in Pine Hollow. Cooling centers open ${hours} at the Lakeview library, the Corvale senior center and the Pine Hollow fire station.`,
      `HEAT ADVISORY from ${full(start)}, through ${full(end)}. Expect ${hi}°F or more in the valley and warm nights near ${int(68, 74)}. Cooling centers: Lakeview library, Corvale senior center, Pine Hollow fire station, ${hours}.`,
      `${n} hot days ahead: a heat advisory runs ${span(start, end)} with highs up to ${top}°F. Drink water, check on neighbors, and never leave kids or pets in a car. Cooling centers open ${hours}.`,
    ])), {tag: 'oem-warning'});
    repost(pick(['june-okoro', 'corvale-scanner', 'mika-sorensen']), p, int(10, 120));
    const visits = int(140, 520), center = pick(['the Lakeview library', 'the Corvale senior center', 'the Pine Hollow fire station']);
    say('tamsen-oem', end, rtime(17, 19), choose(() => pick([
      `The heat advisory ends at 8 pm tonight. ${visits} people used the county cooling centers since ${dayName(start)}. Thank you to the staff and volunteers who kept them open.`,
      `Cooler air arrives tonight and the heat advisory expires at 8 pm. Cooling centers logged ${visits} visits this week; the busiest was ${center}.`,
      `Last day of the heat advisory. Cooling centers close at ${pick(['8 pm', '9 pm'])} tonight after ${visits} visits since ${dayName(start)}, most of them at ${center}.`,
    ])));
    if (hi >= 105) {
      const [h, dek] = heatStories.shift();
      lantern(addDays(start, 1), rtime(6, 8), h.replace('HI', hi), dek, 'lantern-county');
    }
  }
  // Red flag warnings during fire season.
  for (const [d, from, to, wind, rh] of [['2025-06-19', '11 am Friday', '8 pm Saturday', 'north winds gusting to 35 mph', 11], ['2025-07-24', 'noon Friday', '9 pm Friday', 'gusty west winds to 30 mph', 13],
    ['2025-08-18', '10 am Tuesday', '8 pm Tuesday', 'north winds gusting to 40 mph', 9], ['2025-09-18', '11 am Friday', '8 pm Saturday', 'dry north winds to 35 mph', 10],
    ['2025-10-07', '5 am Wednesday', '6 pm Thursday', 'offshore winds gusting to 45 mph on the ridges', 7], ['2025-10-22', '10 am Thursday', '8 pm Thursday', 'north winds to 30 mph', 12],
    ['2026-06-25', '11 am Friday', '8 pm Friday', 'gusty west winds to 35 mph', 12], ['2026-07-30', 'noon Friday', '9 pm Saturday', 'north winds to 30 mph', 10],
    ['2026-08-27', '10 am Friday', '8 pm Saturday', 'north winds gusting to 40 mph', 9], ['2026-09-24', '11 am Friday', '9 pm Friday', 'dry offshore winds to 35 mph', 8],
    ['2026-10-08', '11 am Friday, Oct. 9', '8 pm Saturday, Oct. 10', 'north winds gusting to 40 mph', 8]]) {
    const p = say('tamsen-oem', d, rtime(12, 16), choose(() => pick([
      `Red flag warning from ${from} to ${to}: ${wind} and humidity as low as ${rh}%. No outdoor burning, and finish mowing dry grass before 10 am.`,
      `Fire weather: a red flag warning runs from ${from} to ${to}. Expect ${wind}, humidity near ${rh}%. One spark can start a fast fire; know your zone.`,
      `RED FLAG WARNING, ${from} to ${to}. ${cap(wind)}, humidity ${rh}% or lower. Have your go-bag by the door and your phone charged.`,
    ])), {tag: 'oem-warning'});
    repost('tamsen-fire', p, int(5, 30));
    if (chance(0.5)) repost(pick(['pine-hollow-neighbors', 'tessa-lu', 'beatrice-lam', 'corvale-scanner']), p, int(20, 200));
  }
  // The August 2025 vegetation fire above Lakeview: a warning for LV-3, lifted the same evening.
  const f1 = say('tamsen-fire', '2025-08-19', '13:40', 'Crews are on a vegetation fire east of the ridge road above Lakeview, about 15 acres and moving east, away from homes. Air tankers are on the way.');
  const w = say('tamsen-oem', '2025-08-19', '14:05', 'EVACUATION WARNING for Lakeview zone LV-3 because of a vegetation fire east of the ridge road. Be ready to leave. No other zones are affected.', {links: alertLink('2025-08-19-lv3', 'Lakeview LV-3 warning, Aug. 19'), tag: 'oem-warning'});
  repost('corvale-scanner', w, 3); repost('hal-reyes', w, 25); quote('marisol-vega', w, 31, 'LV-3 is the streets above the marina. We are LV-2 so just watching the smoke for now.');
  reply('tamsen-fire', f1, 170, 'Forward progress stopped at 46 acres. Crews will stay overnight to build containment line.');
  const lift = say('tamsen-oem', '2025-08-19', '17:45', 'The evacuation warning for Lakeview zone LV-3 is lifted. Thank you for being ready, and for keeping the ridge road clear for fire engines.', {tag: 'oem-warning'});
  repost('corvale-scanner', lift, 6);
  lantern('2025-08-20', '06:40', 'Fire above Lakeview stopped at 46 acres; warning for LV-3 lifted', 'It was the first evacuation notice issued under the county\'s new zone names.', 'lantern-fire');
  // Winter storms and other notices.
  for (const [d, text] of [
    ['2025-01-22', 'Wind advisory tonight through Thursday morning: gusts to 50 mph on the ridges above Pine Hollow. Expect downed branches and power outages.'],
    ['2025-02-13', 'Flood watch Friday and Saturday as an atmospheric river brings 3 to 5 inches of rain. Free sandbags at the county road yard on 9th Ave, 8 am to 6 pm.'],
    ['2025-03-06', 'Thunderstorms possible this afternoon, with small hail and gusty winds. If you hear thunder, get indoors.'],
    ['2025-08-28', 'Smoke from fires outside Tamsen County is reaching Corvale today. Air quality may be unhealthy for sensitive groups; keep windows closed if you can smell smoke.'],
    ['2025-09-02', 'September is preparedness month. This week: check your go-bag. Next week: sign up for alerts. The week after: walk your evacuation route.'],
    ['2025-11-20', 'Heavy rain tonight and Friday. Low spots on Lakeview Rd and 9th Ave flood first; do not drive through water over the road.'],
    ['2025-12-23', 'Wind and rain on Christmas Eve: gusts to 45 mph and 2 inches of rain. If you travel, leave early and check for road closures.'],
    ['2026-01-27', 'Freeze warning tonight: lows near 25°F in Pine Hollow. Bring pets inside and protect outdoor pipes. A warming center opens at the Corvale senior center at 6 pm.'],
    ['2026-02-17', 'Flood watch Wednesday night to Friday: 4 inches of rain possible on the ridge. Sandbags are at the county road yard on 9th Ave and the Pine Hollow fire station.'],
    ['2026-03-10', 'Strong winds this afternoon: gusts to 55 mph. Secure trash bins and patio furniture, and report downed lines to the utility.'],
    ['2026-04-18', 'Evacuation drill for Pine Hollow zones PH-1 and PH-2 this morning from 9 to 11. Sirens and test messages are part of the drill. No action needed if you are not taking part.'],
    ['2026-08-20', 'Smoke from out-of-county fires will settle over Corvale and Lakeview tonight. Run air purifiers, and limit time outdoors if you have asthma or heart disease.'],
    ['2026-09-01', 'Preparedness month starts today. Our one ask: find your zone and tell one neighbor theirs. Pine Hollow: PH-1 or PH-2. Lakeview: LV-1 to LV-3.'],
  ]) {
    const p = say('tamsen-oem', d, /drill/.test(text) ? '07:30' : rtime(8, 15), text, {tag: /zone|evacuation/i.test(text) ? 'zones' : 'oem-warning'});
    if (chance(0.4)) repost(pick(['corvale-scanner', 'june-okoro', 'pine-hollow-neighbors']), p, int(10, 180));
  }
  // Fire agency: burn permits, inspections, small fires.
  for (const [d, t, text] of [
    ['2025-04-08', '10:00', 'Chipper days in Pine Hollow on April 19 and 26: stack branches at the curb, cut ends facing the street, no more than 4 feet high. Co-hosted with @pine-hollow-neighbors.'],
    ['2025-05-12', '09:00', 'Defensible-space inspections start this week in Pine Hollow and Lakeview. Inspectors wear county vests and never ask for payment.'],
    ['2025-05-28', '10:30', 'Residential burn permits are suspended from June 1 for fire season. Agricultural burns need a separate permit and a no-wind day.'],
    ['2025-07-01', '11:00', 'Fireworks are illegal everywhere in unincorporated Tamsen County, including Pine Hollow. The show over the Lakeview marina on July 4 is the safe way to see them.'],
    ['2025-10-29', '10:00', 'Burn permits resume Nov. 1 after rain this week. Burn only on permissive burn days and keep a hose ready.'],
    ['2025-11-24', '12:00', 'Fire season is officially over for 2025. Crews responded to 63 vegetation fires this year; 58 were stopped under 10 acres.'],
    ['2025-12-09', '10:00', 'Real Christmas tree? Water it every day. A dry tree can be fully on fire in under a minute.'],
    ['2026-04-07', '10:00', 'Spring chipper days: Pine Hollow on April 25, Lakeview on May 2. Branches at the curb by 7 am.'],
    ['2026-05-11', '09:30', 'Defensible-space inspections begin May 18 in PH-1 and PH-2, then Lakeview in June. Five feet of bare ground around the house is the most important thing we check.'],
    ['2026-05-27', '10:00', 'Burn permits are suspended from June 1. It has been a dry spring; grass on the ridge is already curing.'],
    ['2026-07-01', '10:30', 'Reminder: no fireworks in unincorporated Tamsen County. Last year we had four grass fires on July 4 alone.'],
    ['2026-10-28', '11:00', 'Burn permits stay suspended until at least Nov. 15. We need real rain before anyone burns near the Cinder Fork burn area.'],
    ['2026-12-08', '10:00', 'Holiday lights: plug no more than three strands together, and turn them off when you go to bed.'],
  ]) say('tamsen-fire', d, t, text, {tag: 'tip'});
  const PLACES = ['along Lakeview Rd near the marina', 'off the ridge road above Pine Hollow', 'behind the Ash Yard maintenance shop', 'next to the highway on-ramp at 4th Ave',
    'in a field south of Pine Hollow', 'on the hillside east of Lakeview', 'near the county road yard on 9th Ave', 'along the Green Line tracks west of Ash Yard'];
  for (const d of ALL) {
    const m = month(d);
    if (m < 6 || m > 10 || inStory(d) || !chance(0.055)) continue;
    const acres = pick([0.25, 0.5, 1, 2, 3, 5, 8, 12]);
    say('tamsen-fire', d, rtime(11, 19), choose(() => `Crews stopped a ${acres < 1 ? acres === 0.5 ? 'half-acre' : 'quarter-acre' : acres + '-acre'} vegetation fire ${pick(PLACES)}. ${pick(['No homes were threatened.', 'Cause under investigation.', 'A mower blade hitting a rock started it.', 'Engines will stay a few hours to mop up.', 'Thanks to the neighbor who called it in fast.'])}`), {tag: 'small-fire'});
  }
}

// The Cinder Fork Fire after the fixture weekend, and the county's lead-in before it.
function cinderFork() {
  say('pine-hollow-neighbors', '2026-10-09', '16:30', 'The red flag warning is in effect until 8 pm Saturday. If you are in PH-1, park facing out, charge your phone and keep your go-bag by the door this weekend.', {tag: 'zones'});
  say('corvale-scanner', '2026-10-09', '18:20', 'Wind is picking up on the ridge above Pine Hollow. Lots of branches on the ridge road already.');
  const updates = [
    ['2026-10-13', '09:00', 'Cinder Fork Fire, Oct. 13, 9:00 am: 2,140 acres, 30% contained. Pine Hollow zone PH-1 remains under an EVACUATION ORDER; PH-2 remains under a WARNING. Lakeview: the warning is lifted for LV-1 and LV-2; LV-3 remains under a WARNING.'],
    ['2026-10-13', '18:00', 'Cinder Fork Fire, Oct. 13, 6:00 pm: 2,310 acres, 42% contained. No change to zones. A shelter remains open at the Corvale senior center.'],
    ['2026-10-14', '09:00', 'Cinder Fork Fire, Oct. 14, 9:00 am: 2,380 acres, 55% contained. Lakeview zone LV-3 warning is lifted. Pine Hollow PH-1 remains under an ORDER, PH-2 under a WARNING.'],
    ['2026-10-15', '10:00', 'Cinder Fork Fire, Oct. 15, 10:00 am: 68% contained. Pine Hollow PH-1 is downgraded to an EVACUATION WARNING; residents may return with ID from noon. PH-2: warning remains.'],
    ['2026-10-16', '17:00', 'Cinder Fork Fire, Oct. 16, 5:00 pm: 81% contained. All evacuation warnings for Pine Hollow are lifted. Expect fire engines on the ridge road for several more days.'],
    ['2026-10-20', '10:00', 'Cinder Fork Fire is 100% contained at 2,412 acres. 19 homes and 31 outbuildings in PH-1 were destroyed. No lives were lost.'],
  ];
  for (const [d, t, text] of updates) {
    const p = say('tamsen-oem', d, t, text, {links: alertLink(`cinder-fork/${d}-${t.replace(':', '')}`, `Cinder Fork Fire update, ${ap(d)}`), tag: 'oem-warning'});
    repost('pine-hollow-neighbors', p, int(5, 20)); if (chance(0.6)) repost('corvale-scanner', p, int(2, 15));
  }
  const center = say('cinder-fork-recovery', '2026-10-14', '08:30', 'The Cinder Fork Recovery Center opens today at the Pine Hollow fire station, 9 am to 6 pm daily. Bring ID if you need replacement documents or debris-removal forms.');
  repost('tamsen-oem', center, 15); repost('pine-hollow-neighbors', center, 22); repost('beatrice-lam', center, 60);
  say('cinder-fork-recovery', '2026-10-21', '10:00', 'Debris removal sign-up for PH-1 property owners closes Nov. 20. The county program is free; you do not need to hire anyone to clear the site.');
  say('cinder-fork-recovery', '2026-11-03', '09:00', 'Rebuilding permits: the county will waive plan-check fees for homes lost in the Cinder Fork Fire. Staff are at the recovery center Tuesdays and Thursdays.');
  say('cinder-fork-recovery', '2026-11-30', '11:00', 'The recovery center moves to Tuesdays and Saturdays only from Dec. 1. Insurance help sessions continue every Saturday at 10 am.');
  say('tamsen-oem', '2026-12-14', '15:00', 'Flood watch Tuesday night and Wednesday for the Cinder Fork burn area north of Pine Hollow. Burned slopes shed water fast; PH-1 residents should be ready to leave if mud starts to move.', {links: alertLink('cinder-fork/burn-area-flood-watch', 'Burn-area flood watch, Dec. 15-16'), tag: 'oem-warning'});
  say('tamsen-oem', '2026-12-16', '19:00', 'Flood watch for the Cinder Fork burn area has ended. Crews cleared two small debris flows on the ridge road; no homes were damaged.');
  say('tamsen-fire', '2026-10-13', '12:30', 'Thank you to the 14 engine crews from other counties working the Cinder Fork Fire. Several head home tomorrow as containment grows.');
  say('tamsen-fire', '2026-10-22', '10:00', 'Hot spots inside the Cinder Fork burn area will smoke for weeks. If you see flames outside the burn area, call it in.');
  for (const [d, t, h, dek] of [
    ['2026-10-13', '10:00', 'Cinder Fork Fire: Pine Hollow order stays in place; part of Lakeview warning lifted', 'The fire has burned about 2,140 acres north of Pine Hollow and is 30% contained.'],
    ['2026-10-15', '13:00', 'PH-1 residents begin returning to Pine Hollow as fire order is downgraded', 'Residents need ID to pass a checkpoint on the ridge road.'],
    ['2026-10-21', '06:30', '19 homes lost in the Cinder Fork Fire, county confirms', 'All were in zone PH-1, north of the ridge road. The fuel break built this summer slowed the fire\'s run toward PH-2, fire officials said.'],
    ['2026-11-05', '07:00', 'After the Cinder Fork Fire, Pine Hollow neighbors say the phone tree worked', 'Volunteers called 212 households in the first hour of the evacuation warning.'],
    ['2026-12-17', '07:00', 'Burn-area rain passes with two small debris flows and no damage', 'The county will keep sandbags at the Pine Hollow fire station through March.'],
  ]) lantern(d, t, h, dek, 'lantern-fire');
  const nadia = say('nadia-ferrante', '2026-10-13', '11:15', 'At the shelter at the Corvale senior center this morning: 64 people slept here last night, most from PH-1. Several told me they left with only what was in their go-bags.');
  reply('nadia-ferrante', nadia, 6, 'The county says PH-1 stays under an order at least through tomorrow. Questions I am asking: how many homes, and how fast the phone tree reached people.');
  say('beatrice-lam', '2026-10-14', '19:40', 'Back at my sister\'s in Lakeview tonight. PH-2 is still under a warning. Thank you to everyone on the phone tree who called me Sunday afternoon.');
  say('tessa-lu', '2026-10-16', '18:30', 'Pine Hollow warnings lifted. Drove up the ridge road with my parents. Our street is fine; the next one over is not.');
  say('pine-hollow-neighbors', '2026-10-17', '10:00', 'Meal train for PH-1 families who lost homes: sign up for a night at the recovery center desk or reply here. 19 families so far.');
  say('pine-hollow-neighbors', '2026-10-25', '12:00', 'Thank you, Corvale. Donations for Cinder Fork families are full for now; the recovery center will post what is still needed.');
}

// ---------- beat: Pine Hollow Neighbors ----------
const PHN = [
  ['winter road repairs and the county pothole list', 'Last night: the county will patch the worst 12 potholes on the ridge road by March. Send photos of others to the road department.'],
  ['the transit board\'s fare proposal', 'Thanks to the 40 people who came. We will ask the transit board to hold one of its fare hearings in Pine Hollow, not only in Corvale.'],
  ['spring chipper days and the proposed evacuation zones', 'Chipper days are April 19 and 26. The county says named evacuation zones are coming in May.'],
  ['the May cleanup on the ridge road', 'Cleanup is Saturday, May 10, 8 am at the fire station. Gloves and bags provided.'],
  ['the county\'s evacuation zones, with a county speaker', 'County staff explained the zones: PH-1 is north of the ridge road, PH-2 is south. Write your zone on your fridge.'],
  ['fire season prep and a go-bag swap', 'Go-bag swap was a hit: 30 bags checked, 12 neighbors signed up for the phone tree.'],
  ['the July 4 potluck and fireworks rules', 'Potluck is July 4 at 5 pm at the fire station. Reminder from the fire department: no fireworks anywhere in Pine Hollow.'],
  ['summer water use and the community garden', 'The community garden gets a drip system this month. Watering days are Tuesday and Saturday.'],
  ['what we learned from the LV-3 warning in August', 'Lakeview neighbors told us the LV-3 warning reached them by text within 4 minutes. Our phone tree needs more people in PH-1.'],
  ['the late-service proposal and bus route 7', 'We will ask the transit board for Saturday trains past 11 pm and a later route 7 bus to meet them.'],
  ['the holiday food drive', 'Food drive bins are at the fire station until Dec. 15. Canned protein and diapers are most needed.'],
  ['no meeting this month', null],
  ['slope repairs on the ridge road after the winter storms', 'The county will close the ridge road for slope repairs on weekdays in February, 9 am to 3 pm.'],
  ['the late-service vote on Feb. 12', 'Several of us will speak for the late-service pilot on Feb. 12. It would let us take the train home from Quillfeather shows.'],
  ['the April 18 evacuation drill for PH-1 and PH-2', 'Drill is April 18, 9 to 11 am. Practice leaving by both the ridge road and the south road.'],
  ['volunteer roles for the April 18 drill', 'We need 20 volunteers at the south road turn to count cars during the drill. Sign-up sheet is at the fire station.'],
  ['a debrief of the April 18 drill', 'Drill debrief: 140 households took part. The south road backed up for 20 minutes at the Lakeview Rd turn.'],
  ['defensible-space inspection results so far', 'Inspectors have visited 160 PH-1 homes since May 18. The most common fix is a wood fence touching the house.'],
  ['a cool room for heat days', 'The fire station community room will open as a cool room on heat-advisory days from noon to 7 pm.'],
  ['the neighborhood phone tree', 'The phone tree now covers 212 households. Each caller has 8 to 10 neighbors.'],
  ['a fire-season check-in and a phone tree test', 'Phone tree test reached 196 of 212 households in 50 minutes. We are fixing the gaps in PH-1.'],
  ['smoke-ready kits and the Saturday late trains', 'We gave out 60 smoke-ready kits: N95 masks and furnace filters for box fans.'],
  ['how the phone tree worked during the Cinder Fork Fire', 'Callers reached 212 households within the first hour of the Oct. 11 warning. Thank you all.'],
  ['rebuilding help for PH-1 neighbors', 'The recovery center explained debris removal and permit waivers. Next step: a list of local builders who will quote fairly.'],
];
function pineHollow() {
  let i = 0;
  for (let y = 2025; y <= 2026; y++) for (let m = 1; m <= 12; m++, i++) {
    const tuesday = nthWeekday(y, m, 2, 1), [topic, recap] = PHN[i];
    if (!recap) {
      say('pine-hollow-neighbors', addDays(tuesday, -2), rtime(16, 19), 'No monthly meeting in December. Holiday party Saturday, Dec. 13, 4 pm at the fire station. Bring a dish if you can.');
      continue;
    }
    say('pine-hollow-neighbors', addDays(tuesday, -2), rtime(16, 19), `Monthly meeting ${full(tuesday)}, 7 pm at the Pine Hollow fire station community room: ${topic}.`);
    const r = say('pine-hollow-neighbors', addDays(tuesday, 1), rtime(9, 12), recap);
    if (r && active('beatrice-lam', addDays(tuesday, 1)) && chance(0.5)) reply('beatrice-lam', r, int(30, 300), choose(() => `${pick(['Full minutes', 'Minutes and the sign-in sheet', 'Notes from the meeting'])} are pinned at the fire station ${pick(['door', 'bulletin board'])}. ${pick(['Ask me if you want a copy by email.', `${int(18, 46)} people came.`, 'Next month we need a volunteer to bring coffee.'])}`));
  }
  const LOST = ['Biscuit', 'Juniper', 'Moose', 'Pepper', 'Otis', 'Clementine', 'Rocket', 'Mabel', 'Ziggy', 'Banjo', 'Hazel', 'Tater', 'Nova', 'Waffles', 'Pickles', 'Sprocket'];
  for (const d of ALL) {
    if (inStory(d) || !chance(0.035)) continue;
    say('pine-hollow-neighbors', d, rtime(8, 20), choose(() => pick([
      (() => {const dog = chance(0.5); return `Lost ${dog ? 'dog' : 'cat'} near ${pick(['the trailhead lot', 'the fire station', 'the south road', 'the ridge road bend'])}: ${pick(dog ? DOGS : CATS)}, answers to ${pick(LOST)}.`;})(),
      `Road crew ${pick(['patching', 'grading', 'clearing ditches along'])} the ridge road ${pick(['today until 3', 'tomorrow morning', 'all week'])}. Expect one-lane traffic near ${pick(['the trailhead', 'the bend above PH-1', 'the water tank'])}.`,
      `Thank you to ${pick(['the neighbor', 'whoever'])} who ${pick(['returned the wheelbarrow', 'cleared the fallen oak branch', 'fixed the community garden gate', 'left lemons at the fire station'])}. ${pick(['This is why we live here.', 'Pine Hollow at its best.', 'You know who you are.'])}`,
      `Community garden ${pick(['work party', 'harvest share', 'compost day'])} on ${full(addDays(d, int(2, 6)))} at ${pick(['9 am', '10 am', '4 pm'])}.`,
    ])));
  }
}

// ---------- beat: Alder Glass, analysts and the markets desk ----------
const QUARTERS = [
  ['2025-01-14', 'Fourth-quarter 2024', 412, 3, 4, 59, 57], ['2025-04-08', 'First-quarter 2025', 389, 1, 2, 60, 58],
  ['2025-07-08', 'Second-quarter 2025', 436, 5, 6, 62, 59], ['2025-10-14', 'Third-quarter 2025', 451, 6, 7, 63, 60],
  ['2026-01-13', 'Fourth-quarter 2025', 430, 4, 5, 61, 59], ['2026-04-14', 'First-quarter 2026', 402, 3, 3, 60, 60],
  ['2026-07-14', 'Second-quarter 2026', 463, 6, 8, 62, 62], ['2026-10-13', 'Third-quarter 2026', 497, 10, 12, 57, 63],
];
function markets() {
  for (const [d, q, rev, up, ship, rate, before] of QUARTERS) {
    const qslug = q.toLowerCase().replace(/ /g, '-');
    say('brindlemark-desk', addDays(d, -4), rtime(6, 7), `Earnings next week: Alder Glass reports ${q.toLowerCase()} results ${full(d)}, before the open. Call at 5:30 am PT.`);
    const r = say('alder-glass', d, '05:00', `${q} results: revenue of $${rev} million, up ${up}% from a year earlier. Unit shipments rose ${ship}%. Installers' reorder rate for next quarter: ${rate}%, compared with ${before}% a year ago. Call at 5:30 am PT.`,
      {links: [{url: `https://investors.alder-glass.example/${qslug}-results`, title: `Alder Glass ${q.toLowerCase()} results`, description: 'Investor relations release'}]});
    const move = rate < before ? -int(7, 11) : rate > before ? int(2, 6) : pick([-1, 1]);
    quote('brindlemark-desk', r, int(100, 130), `Alder Glass shares ${move > 0 ? 'up' : 'down'} ${Math.abs(move)}% in early trading after ${q.toLowerCase()} results. ${rate < before ? `The reorder rate fell to ${rate}% from ${before}%, its first drop below the year-earlier level in two years.` : rate > before ? `Traders point to the reorder rate: ${rate}%, against ${before}% a year ago.` : `The reorder rate was flat at ${rate}%.`}`);
    const last = d === '2026-10-13';
    const odile = last ? null : say('odile-park', d, rtime(6, 7), choose(() => rate > before ? pick([
      `Alder Glass reorder rate ${rate}% vs ${before}% a year ago. Installers are coming back more often, which is the demand signal I care about.`,
      `${q} reorder rate at Alder Glass: ${rate}%, up from ${before}%. Repeat installers are the business, and they are ordering more often.`,
      `The number I watch at Alder Glass rose again: ${rate}% of installers reordering, against ${before}% last year.`,
    ]) : rate === before ? `Alder Glass reorder rate ${rate}%, the same as a year ago. Flat on the year: no sign of fading demand, and no acceleration either.`
      : `Alder Glass reorder rate ${rate}% vs ${before}% a year ago. Lower than last year, and that is the number I watch.`));
    if (odile && rate > before) reply('odile-park', odile, 4, choose(() => `Shipments up ${ship}% on top of that. ${pick(['I am staying with my view.', 'This is the quarter I would point skeptics to.', 'Still the cleanest demand story in building materials.', 'Revenue up ' + up + '% too.'])}`));
    const ravi = last ? null : say('ravi-castellano', d, rtime(7, 9), `Alder Glass: shipments up ${ship}%, reorder rate ${rate}%. ${rate < before ? 'This is what distributors stocking up early looks like once the shelves are full.' : ship >= 6 ? 'Good quarter, but my distributor calls say some of this is restocking, not new demand.' : 'Nothing here argues with the slow, steady story.'}`);
    if (chance(0.7)) reply(pick(['hal-reyes', 'quinn-maddox']), ravi || odile, int(15, 120), choose(() => pick([
      `${move > 0 ? 'Up' : 'Down'} ${Math.abs(move)}% and I am ${pick(['not selling a share', 'adding a little', 'holding'])}. ${pick(['Been in since 2009.', 'Long-term money.', 'Not investment advice.'])}`,
      `Reorder rate is the only number anyone talks about now. ${rate}% ${rate < before ? 'is not great' : 'is fine'}.`,
      `${pick(['Listened to the whole call.', 'Read the release twice.'])} The ${pick(['price increase', 'Corvale furnace', 'commercial business'])} got ${pick(['two questions', 'one question', 'no questions'])}, which surprised me.`,
    ])));
  }
  // Company news through the two years, including the Jan. 1 price increases Ravi Castellano points to.
  for (const [d, t, text, slugPath, title] of [
    ['2025-03-05', '06:00', 'We are investing $40 million in a new furnace at our Corvale plant. Construction starts in April; the furnace should be running by November.', 'news/corvale-furnace', 'Alder Glass announces Corvale furnace investment'],
    ['2025-05-20', '09:00', 'Our annual meeting is Thursday, May 22, at 9 am PT, online only. Shareholders of record on April 1 can vote.', 'annual-meeting-2025', 'Alder Glass 2025 annual meeting'],
    ['2025-09-16', '06:00', 'List prices for insulated and laminated glass will rise 5% on Jan. 1, 2026. Orders placed by Dec. 15 ship at current prices.', 'news/2026-pricing', 'Alder Glass 2026 price notice'],
    ['2025-11-18', '07:00', 'The new furnace at our Corvale plant is running. It uses about 20% less natural gas per ton of glass than the one it replaced.', 'news/corvale-furnace-online', 'New Corvale furnace in operation'],
    ['2026-02-10', '06:30', 'We are hiring 60 people at our Corvale plant this year: furnace operators, cutters and maintenance technicians. Starting pay begins at $27 an hour.', 'careers/corvale-2026', 'Corvale plant hiring'],
    ['2026-05-19', '09:00', 'Our annual meeting is Thursday, May 21, at 9 am PT, online. The board recommends a vote for all eight directors.', 'annual-meeting-2026', 'Alder Glass 2026 annual meeting'],
    ['2026-09-15', '06:00', 'List prices for insulated and laminated glass will rise 7% on Jan. 1, 2027. Orders placed by Dec. 15 ship at current prices.', 'news/2027-pricing', 'Alder Glass 2027 price notice'],
    ['2026-11-17', '06:00', 'Holiday schedule: our Corvale plant runs through Dec. 23 and restarts Jan. 4. Orders after Dec. 15 ship at 2027 prices.', 'news/holiday-schedule-2026', 'Holiday production schedule'],
  ]) {
    const p = say('alder-glass', d, t, text, {links: [{url: `https://investors.alder-glass.example/${slugPath}`, title, description: 'Company news'}]});
    if (/price/.test(title)) {
      quote('ravi-castellano', p, int(40, 120), d < '2026' ? 'Price increase on Jan. 1. Watch for distributors buying ahead in November and December, then a soft first quarter.'
        : 'Second year in a row: 7% on Jan. 1, 2027. Last time distributors pulled orders into the fourth quarter. I expect the same, only bigger.');
      repost('brindlemark-desk', p, int(10, 30));
    }
  }
  lantern('2025-03-05', '09:30', 'Alder Glass to build $40 million furnace at Corvale plant', 'The glassmaker employs about 480 people in Corvale.', 'lantern-business');
  lantern('2026-02-11', '07:00', 'Alder Glass to add 60 jobs at Corvale plant', 'The company says demand for insulated windows has held up for two years.', 'lantern-business');
  // Ravi Castellano's monthly distributor checks: inventories build ahead of each Jan. 1 price increase.
  const LEVEL = {'2025-01': ['normal', 'Most say January orders are seasonal and slow.'], '2025-02': ['normal', 'Two mention warmer weather pulling remodel work forward.'],
    '2025-03': ['a little below normal', 'Commercial jobs are taking glass faster than expected.'], '2025-04': ['normal', 'Nobody is worried, nobody is excited.'],
    '2025-05': ['normal', 'Lead times from Alder Glass are about three weeks.'], '2025-06': ['a little above normal', 'One big distributor bought ahead of summer.'],
    '2025-07': ['normal', 'Installers are busy; reorders steady.'], '2025-08': ['normal', 'Back-to-school is slow season for windows, as usual.'],
    '2025-09': ['normal', 'Everyone is reading the Jan. 1 price notice.'], '2025-10': ['above normal', 'Four of them are buying ahead of the price increase.'],
    '2025-11': ['above normal', 'Warehouses are full of insulated units at old prices.'], '2025-12': ['well above normal', 'Six say they bought two months of stock before Dec. 15.'],
    '2026-01': ['above normal', 'They are selling down the stock they bought in December.'], '2026-02': ['normal again', 'The pre-buying unwound faster than I thought.'],
    '2026-03': ['normal', 'Spring remodel season looks average.'], '2026-04': ['normal', 'Steady. Even boring.'],
    '2026-05': ['a little above normal', 'A few added stock for a summer apartment project in Lakeview.'], '2026-06': ['normal', 'Reorders from installers match last June.'],
    '2026-07': ['normal', 'Lead times have shortened to two weeks.'], '2026-08': ['a little above normal', 'Some are asking about 2027 pricing early.'],
    '2026-09': ['above normal', 'Nine say they are buying ahead of the Jan. 1 increase.'], '2026-10': ['well above normal', 'Highest stock levels since I started these calls in 2021.'],
    '2026-11': ['well above normal', 'Orders to Alder Glass have slowed sharply since the third-quarter call.'], '2026-12': ['above normal', 'They expect to sell down through February.']};
  for (const [ym, [level, note]] of Object.entries(LEVEL)) {
    const [y, m] = ym.split('-').map(Number), d = nthWeekday(y, m, 3, 1);
    const n = int(11, 14), k = Math.min(n, int(7, n));
    say('ravi-castellano', d, rtime(8, 10), `Distributor check, ${MONTH_NAMES[m - 1]} ${y}: ${k} of ${n} glass distributors I called say inventories are ${level}. ${note}`);
  }
  // Odile Park between results: installer visits.
  for (const d of ALL) {
    if (inStory(d) || !chance(0.035)) continue;
    say('odile-park', d, rtime(7, 18), choose(() => pick([
      `Installer visit ${pick(['in Lakeview', 'in Corvale', 'outside Pine Hollow', 'at a commercial site on 4th Ave'])} today: ${pick(['a two-week backlog', 'crews booked into next month', 'a slower month than spring', 'most jobs are replacement windows, not new homes'])}. ${pick(['Repeat customers are most of the work.', 'They reorder from Alder Glass every week or two.', 'No sign of a slowdown.', 'Prices are not a complaint yet.'])}`,
      `What I watch in glass, in order: reorder rate, lead times, then shipments. ${pick(['Lead times are about three weeks right now.', 'Lead times shortened this month.', 'Lead times have not moved since spring.'])}`,
      `Spoke with ${int(4, 9)} window installers this week. ${pick(['All said repeat orders are steady.', 'Two said customers are delaying jobs until spring.', 'Most said commercial work is busier than homes.'])}`,
    ])));
  }
  // The days after the Oct. 12 storyline: what the Tuesday call said.
  const oct13 = byId.get('p30'), ravi13 = byId.get('p32');
  quote('odile-park', oct13, 60 * 24 + 98, 'Following up on my own thread: the reorder rate came in at 57%, below last year\'s 63%. That is the number I said would change my mind. Ravi\'s reading looks right this quarter.');
  reply('ravi-castellano', ravi13, 60 * 24 + 113, 'Reorder rate 57% vs 63% a year ago. Distributors stocked up ahead of the Jan. 1 increase; installers did not reorder faster.');
  lantern('2026-10-13', '10:30', 'Alder Glass shipments rise 12%, but installers\' reorder rate falls', 'Shares fell after the company said its next-quarter reorder rate dropped to 57% from 63% a year earlier.', 'lantern-business');
  say('brindlemark-desk', '2026-10-14', '06:20', 'Alder Glass shares extend losses for a second day after Tuesday\'s results; two brokers cut their price targets.');
  say('quinn-maddox', '2026-10-13', '13:40', 'Sold half my Alder Glass this morning. Twelve percent shipment growth did not matter once the reorder rate came out. Not investment advice.');
  say('hal-reyes', '2026-10-13', '16:05', 'Seventeen years holding Alder Glass. A bad quarter is a bad quarter. Not selling.');
  // Brindlemark and the two investors between results.
  for (const d of ALL) {
    if (inStory(d) || weekday(d) === 0 || weekday(d) === 6) continue;
    if (chance(0.05)) say('brindlemark-desk', d, rtime(6, 13), choose(() => pick([
      `Building-materials stocks ${pick(['lead', 'lag'])} the market ${pick(['this morning', 'at midday'])}; Alder Glass ${pick(['up', 'down'])} ${int(1, 4)}.${int(0, 9)}%.`,
      `Homebuilder sentiment ${pick(['ticks up', 'slips', 'holds steady'])} in the monthly survey; ${pick(['window and door suppliers move with it', 'suppliers barely react', 'glass names outperform'])}.`,
      `What traders are reading ${dayName(d)}: ${pick(['mortgage rates', 'remodel spending', 'commercial construction permits', 'freight costs'])} and ${pick(['the glass price notices', 'distributor inventories', 'energy costs for furnaces', 'housing starts'])}.`,
    ])));
    if (chance(0.03)) say('quinn-maddox', d, rtime(7, 21), choose(() => pick([
      `Small caps ${pick(['up', 'down'])} ${int(1, 4)}.${int(0, 9)}% this week. ${pick(['Still not selling anything.', 'Added to two positions.', 'Cash is a position too.', 'Trimmed my winners.'])} Not investment advice.`,
      `Reading annual reports on a ${dayName(d)} night. ${pick(['The footnotes are where the bodies are buried.', 'Found one company with more cash than market value.', 'Inventory up 30% and nobody on the call asked about it.'])}`,
      `My watchlist is ${int(18, 40)} names now. ${pick(['Too many.', 'Cutting it in half this weekend.', 'Three of them are glass or window companies.'])}`,
    ])));
  }
}

// ---------- beat: the Corvale Lantern and its reporter ----------
const STORIES = [
  ['2025-01', 'Corvale council approves 40 new streetlights for Fennick St', 'The $1.3 million project replaces lights between 4th and 14th avenues by fall.'],
  ['2025-01', 'Lakeview Rd bridge inspection finds no major damage after storm', 'County engineers found worn expansion joints that will be repaired in spring.'],
  ['2025-01-29', 'Free tax help returns to the Lakeview library on Saturdays', 'Volunteers prepare simple returns from Feb. 1 to April 12; bring last year\'s return.'],
  ['2025-02', 'Tamsen County opens wildfire home-hardening grants', 'Homeowners in Pine Hollow and Lakeview can get up to $5,000 for ember-resistant vents and gutter guards.'],
  ['2025-03', 'New crosswalk signals coming to Lakeview Rd and 9th Ave after two crashes', 'The flashing signals should be in place before the school year ends.'],
  ['2025-03', 'Corvale water rates to rise 4% in July', 'The council approved the increase to pay for replacing water mains under Fennick St.'],
  ['2025-04', 'Lakeview marina reopens boat ramp after winter repairs', 'The ramp was closed for five months after storm damage in January.'],
  ['2025-04', 'Farmers market moves to the Fennick St plaza for the season', 'Saturday market hours are 8 am to 1 pm from May through October.'],
  ['2025-05', 'Corvale budget adds six firefighters and delays park upgrades', 'The city council will vote on the $212 million budget in June.'],
  ['2025-05', 'Pine Hollow fire station to get a backup generator', 'The station doubles as a cooling center and evacuation point.'],
  ['2025-06', 'Lakeview library extends Sunday hours through the summer', 'The branch opens noon to 5 pm on Sundays until Labor Day.'],
  ['2025-06', 'Corvale council bans gas leaf blowers starting in 2027', 'Landscapers can apply for rebates on electric equipment starting next year.'],
  ['2025-07', 'Tamsen County fair returns Aug. 6-10 with a new livestock barn', 'Advance tickets are $8; children under 6 get in free.'],
  ['2025-07', 'Corvale animal shelter waives adoption fees for July', 'The shelter is over capacity with 140 dogs and cats.'],
  ['2025-08-06', 'Lakeview middle school roof repairs will finish before classes start', 'Classes begin Aug. 13; the district says no rooms will be closed.'],
  ['2025-08-12', 'Tamsen County fair draws a record 61,000 visitors', 'Fair officials credited the cooler weather and the new evening concerts.'],
  ['2025-09-18', 'Downtown Corvale gets its first protected bike lane on 4th Ave', 'Concrete curbs separate the lane from traffic between Fennick St and 11th Ave.'],
  ['2025-09', 'County approves a fuel break on the ridge north of Pine Hollow', 'Crews will clear a 300-foot strip of brush next summer, paid for by a state grant.'],
  ['2025-10-03', 'Fennick St elevator replacement starts Monday', 'One elevator stays open throughout the yearlong project.'],
  ['2025-10', 'Corvale clinic adds evening hours for flu shots', 'The clinic on 9th Ave is open until 8 pm on Tuesdays and Thursdays through December.'],
  ['2025-11', 'Food bank sees record demand before Thanksgiving', 'The Corvale food bank served 2,900 households in the first two weeks of November.'],
  ['2025-11', 'County proposes fines of up to $1,000 for burning during a ban', 'Supervisors will vote in December after a public hearing.'],
  ['2025-12-02', 'Holiday lights parade on Fennick St set for Dec. 6', 'The parade starts at 5:30 pm at 4th Ave; Fennick St closes to cars from 4 pm.'],
  ['2025-12', 'Supervisors approve fines for burning during a burn ban', 'First-time violators will get a warning; repeat fines start at $250.'],
  ['2026-01', 'Corvale opens warming center during cold snap', 'The center at the senior center is open overnight while lows stay below 30°F.'],
  ['2026-01', 'Fennick St coffee bar plans late hours on show nights', 'Owner Omar Haddad says he would stay open until the last Saturday train if the transit board approves late service in February.'],
  ['2026-02', 'Ridge road reopens after slide repairs', 'The road above Pine Hollow was down to one lane for six weeks.'],
  ['2026-02-03', 'Free tax help is back at the Lakeview library, now on weeknights too', 'Volunteers will add Tuesday and Thursday evening sessions.'],
  ['2026-03', 'Quillfeather Hall marks 20 years on Fennick St', 'The hall has hosted about 3,000 shows since it opened in a former furniture store.'],
  ['2026-03', 'New apartments near Fennick St station get final approval', 'The 120-unit building will have 40 bike parking spaces and no car parking.'],
  ['2026-04', 'Lakeview Rd repaving will close lanes at night through August', 'Work runs 8 pm to 5 am, Sunday through Thursday.'],
  ['2026-04', 'Tamsen County hires its first full-time wildfire mitigation coordinator', 'The coordinator will run the fuel break project and the chipper program.'],
  ['2026-05', 'School district asks voters for $85 million bond in November', 'The money would replace roofs and heating systems at seven schools.'],
  ['2026-05', 'Fuel break work begins on the ridge north of Pine Hollow', 'Hand crews and goats will clear brush through August.'],
  ['2026-06', 'Green Line ridership tops pre-2020 levels for the first time', 'Weekday trips averaged 21,400 in May, the transit agency said.'],
  ['2026-06', 'Lakeview pool closes early for the season after a pump failure', 'The city says the pool will reopen next May after repairs.'],
  ['2026-07', 'Corvale schools set Aug. 12 start, with later bell times for middle schools', 'Middle schools will start at 8:30 am instead of 8.'],
  ['2026-07', 'Fuel break above Pine Hollow is half finished', 'Crews have cleared about 1.5 miles of the planned 3-mile strip.'],
  ['2026-08', 'Three candidates file for open county supervisor seat', 'The district includes Pine Hollow and most of Lakeview.'],
  ['2026-08-03', 'Tamsen County fair adds a cooling tent after last year\'s heat', 'The fair runs Aug. 5-9 at the county fairgrounds.'],
  ['2026-09', 'Fuel break north of Pine Hollow is finished', 'The 3-mile strip of cleared brush runs along the ridge above zone PH-1.'],
  ['2026-09', 'County warns of scam calls posing as emergency management', 'The county never asks for payment or bank details by phone.'],
  ['2026-10-20', 'Candidates for county supervisor debate wildfire preparedness', 'All three support more fuel breaks; they disagree on how to pay for them.'],
  ['2026-11-04', 'Lucia Hernandez wins county supervisor seat', 'Hernandez, a Lakeview nurse, will take office in January.'],
  ['2026-11-05', 'School bond passes with 61% of the vote', 'Roof work at the first three schools could start next summer.'],
  ['2026-11', 'Food bank adds a Pine Hollow pickup site for fire-affected families', 'The site at the fire station is open Wednesdays from 3 to 6 pm.'],
  ['2026-12-01', 'Holiday lights parade returns to Fennick St on Dec. 5', 'Organizers are collecting gift cards for Cinder Fork fire families along the route.'],
  ['2026-12', 'Corvale council approves late-night bus to meet Saturday trains', 'Route 7 will leave Fennick St at 11:50 pm on Saturdays starting in January.'],
];
function corvaleLantern() {
  for (const [ym, headline, dek] of STORIES) {
    let d = ym.length === 10 ? ym : null;
    while (!d || weekday(d) === 0 || weekday(d) === 6 || inStory(d) || (ym === '2026-10' && d < '2026-10-13')) d = `${ym.slice(0, 7)}-${pad(int(1, 28))}`;
    const tag = /Fennick St station|Green Line|bike|bus|transit/i.test(headline + dek) ? 'lantern-transit' : /fire|fuel break|evacuation|burn/i.test(headline) ? 'lantern-fire' : 'lantern-local';
    const p = lantern(d, rtime(6, 9), headline, dek, tag);
    if (p && chance(0.25)) repost(pick(['june-okoro', 'hal-reyes', 'tessa-lu', 'devin-hart', 'beatrice-lam', 'marisol-vega', 'omar-haddad']), p, int(30, 400));
  }
  // Nadia Ferrante's own posts between meetings.
  const NADIA = [
    x => `Covering the ${pick(['county supervisors', 'Corvale council', 'transit board'])} ${pick(['tonight', 'this afternoon'])}. ${pick(['The agenda is long.', 'Public comment could run late.', 'One item I am watching:'])} ${pick(['Fennick St crosswalks.', 'fire-season staffing.', 'operator overtime.', 'the bus shelter contract.', 'night work noise at Ash Yard.'])}`,
    x => `Records request update: ${pick(['the transit agency sent', 'the county sent', 'the city sent'])} ${int(40, 300)} pages on ${pick(['canceled train trips', 'elevator outages at Fennick St', 'cooling center use', 'fire inspection results', 'overtime pay'])}. Reading now.`,
    x => `If you ride the Green Line ${pick(['after 10 pm', 'before 6 am', 'on weekends', 'with a bike'])}, I would like to hear ${pick(['what works and what does not', 'how often your train is late', 'about the last time you were stranded'])}. ${pick(['Replies are open.', 'My messages are open.'])}`,
    x => `${pick(['Correction', 'Clarification'])} on my ${pick(['Tuesday', 'Wednesday', 'Thursday'])} story: ${pick(['the vote was 5-2, not 6-1.', 'the contract is $6.2 million, not $6.5 million.', 'the hearing is in Pine Hollow, not Lakeview.', 'the pilot starts in April, not March.'])} It has been fixed online.`,
  ];
  for (const d of ALL) {
    if (inStory(d) || !active('nadia-ferrante', d) || weekday(d) === 0 || !chance(0.045)) continue;
    say('nadia-ferrante', d, rtime(9, 19), choose(() => pick(NADIA)({d})));
  }
}

// ---------- beat: Corvale Scanner ----------
const CROSSINGS = ['Fennick St and 4th Ave', 'Fennick St and 11th Ave', '9th Ave by the Ash Yard crossing', 'the Pine Hollow Rd bridge', 'Lakeview Rd at the marina turnoff',
  '4th Ave and the highway on-ramp', 'Lakeview Rd near the middle school', 'the ridge road above Pine Hollow', 'the roundabout at 9th Ave and Lakeview Rd', '14th Ave and Fennick St'];
const AREAS = ['Lakeview', 'Pine Hollow', 'downtown Corvale', 'the north end of Corvale', 'the Fennick St area', 'Lakeview east of the marina'];
const STREETS = ['4th Ave', '9th Ave', '11th Ave', '14th Ave', 'Fennick St', 'Lakeview Rd', 'Pine Hollow Rd'];
const DOGS = ['black lab mix, red collar', 'small gray terrier, no collar', 'husky with one blue eye', 'senior beagle, a little deaf', 'brindle pit mix, very friendly', 'white poodle mix in a green sweater'];
const CATS = ['brown tabby with white paws', 'orange cat with a notched ear', 'black cat, yellow eyes, no collar', 'gray long-haired cat', 'calico with a pink collar'];
const CLOSURES = {'Lakeview Rd': ['the marina turnoff and 9th Ave', 'the middle school and the roundabout'], '9th Ave': ['Fennick St and the Ash Yard crossing', 'Lakeview Rd and the county road yard'],
  'Fennick St': ['4th and 6th Ave', '11th and 14th Ave'], 'Pine Hollow Rd': ['the bridge and the school', 'the trailhead and the water tank'], '4th Ave': ['Fennick St and the highway on-ramp', 'the bike lane and the library']};
function scanner() {
  for (const d of ALL) {
    if (inStory(d)) continue;
    const s = season(d), m = month(d), n = chance(0.25) ? 2 : 1;
    if (!chance(0.5)) continue;
    for (let k = 0; k < n; k++) {
      const t = rtime(6, 22), types = ['crash', 'crash', 'outage', 'fire', 'closure', 'weather', 'pet'];
      const show = showOn(d);
      if (show && Number(t.slice(0, 2)) >= 18) types.push('show', 'show');
      const type = pick(types);
      const text = choose(() => {
        switch (type) {
          case 'crash': return `${pick(['Crash', 'Collision', 'Wreck'])} at ${pick(CROSSINGS)}. ${pick(['Two cars, airbags out, no one trapped.', 'One car into a power pole.', 'A pickup on its side; fire crews on scene.', 'Minor, but both lanes are blocked for now.', 'A delivery van and a cyclist; medics are with the rider.', 'Three cars and one tow truck already there.'])} ${pick(['Use 6th Ave instead.', 'Expect delays toward Lakeview.', 'Traffic is getting by on the shoulder.', 'Avoid the area for the next hour.', 'Buses on route 7 are detouring.'])}`;
          case 'outage': return `About ${thousands(int(3, 60) * 100)} customers in ${pick(AREAS)} lost power at ${clock12(t)}${pick(s === 'winter' ? ['; wind took down a line', ' during the storm', ' after a tree fell on a line'] : [' after a car hit a pole', '; cause unknown', ' after a transformer blew', ' after a balloon hit a line'])}. The utility estimates power back by ${clock12(addMin(t, int(60, 240)))}.`;
          case 'fire': return `Fire crews at a ${pick(m >= 6 && m <= 10 ? ['small grass fire', 'garage fire', 'car fire', 'dumpster fire'] : ['kitchen fire', 'chimney fire', 'garage fire', 'car fire'])} on the ${int(1, 29)}00 block of ${pick(STREETS)}. ${pick(['Knocked down quickly; no injuries reported.', 'Smoke visible from Fennick St; crews say it is contained.', 'One person checked by medics.', 'Neighbors evacuated as a precaution, now back inside.'])}`;
          case 'closure': {const road = pick(Object.keys(CLOSURES)); return `${road} closed between ${pick(CLOSURES[road])} for ${pick(['a water main break', 'a sinkhole', 'a downed tree', 'a gas leak', 'an overnight paving job', 'a fallen power line'])}. ${pick(['Crews expect it to reopen this evening.', 'No estimate yet.', 'Detour through the side streets.', 'Should reopen by morning.'])}`;}
          case 'weather': return {winter: `${pick(['Thick fog', 'Black ice', 'Standing water', 'Hail'])} on ${pick(['Lakeview Rd', 'the ridge road', 'the highway near 4th Ave', 'Pine Hollow Rd'])} ${pick(['this morning', 'right now', 'tonight'])}. ${pick(['Slow down.', 'Visibility is under a block.', 'Saw two cars slide.', 'Take it easy out there.'])}`,
            spring: `${pick(['Hail', 'A downpour', 'Thunder and lightning', 'Gusty wind'])} in ${pick(['Lakeview', 'Pine Hollow', 'downtown Corvale'])} ${pick(['just now', 'for the last ten minutes', 'this afternoon'])}. ${pick(['Watch for branches.', 'Gutters overflowing on Fennick St.', 'Power flickering on the north side.'])}`,
            summer: `${heatDay(d) ? int(101, 110) : int(86, 97)}°F on the ${pick(['bank sign at Fennick St', 'thermometer at the Lakeview marina', 'dashboard on 9th Ave'])} at ${clock12(t)}. ${heatDay(d) ? pick(['Cooling centers are open.', 'Check on your neighbors.', 'The Green Line platforms have no shade, bring water.']) : pick(['Pool weather.', 'Shade at the bus stop is a luxury.', 'Ice cream truck is doing laps on Fennick St.'])}`,
            fall: `${pick(['Smoke smell', 'Haze', 'Ash falling', 'A wind gust knocked over the fruit stand'])} ${pick(['in Lakeview', 'near Pine Hollow', 'downtown', 'by the marina'])} ${pick(['this morning', 'right now', 'this afternoon'])}. ${pick(['No reported fire in the county; it is from outside.', 'County says no new fires nearby.', 'Keep an eye on the alert page.'])}`}[s];
          case 'pet': {const dog = chance(0.5), found = chance(0.5); return `${found ? 'Found' : 'Lost'} ${dog ? 'dog' : 'cat'} near ${pick(['the Fennick St plaza', 'the Lakeview marina', 'Ash Yard', '9th Ave park', 'the middle school'])}: ${pick(dog ? DOGS : CATS)}. ${pick(found ? ['Now at the county shelter.', 'Owner please reply.', 'Microchipped, the shelter is calling the owner.'] : ['Last seen heading toward the tracks.', 'Owner is checking the shelter daily.', 'Reward offered, reply here.'])}`;}
          case 'show': return `${pick(['Big line', 'Line around the block', 'Crowd'])} at Quillfeather Hall for the ${show.genre} show. ${pick(['Fennick St platform is busy, give yourself time.', 'Parking on 11th Ave is full.', 'Doors just opened.', 'Food trucks are out on Fennick St.'])}`;
        }
        return null;
      });
      say('corvale-scanner', d, type === 'show' ? rtime(18, 20) : t, text);
    }
  }
}

// ---------- beat: residents ----------
const SKY = {winter: ['Pink sky and frost on the railings', 'Fog so thick Ash Yard disappeared', 'A clear, freezing sunrise'], spring: ['Clear sky and a lot of birds', 'Rain clouds breaking up over the ridge', 'A double rainbow over Lakeview'],
  summer: ['Already 80 degrees at 7 am', 'Orange sun through the haze', 'A cool marine layer for once'], fall: ['Gold light on the ridge', 'Smoky sunrise', 'First cold morning of the year']};
const NURSE = {winter: ['flu shots still help in January.', 'never bring a grill indoors when the power is out. Carbon monoxide is quiet.', 'wet socks plus cold platforms equals misery. Pack spares.'],
  spring: ['allergy season: rinse your eyes, not just your nose.', 'bike helmets work. I would like to see fewer of you.', 'tick season is starting; check your dog and your kids.'],
  summer: ['drink water before you feel thirsty on heat days.', 'check on older neighbors without air conditioning.', 'the Green Line platform has no shade; bring a hat.'],
  fall: ['smoke days: an N95 that fits beats a surgical mask.', 'get your flu shot before Thanksgiving.', 'clocks change soon; check your smoke alarm batteries too.']};
const RESIDENTS = {
  'mika-sorensen': [0.08, [
    x => `Night ${int(2, 4)} of ${int(4, 5)} this week. The ${clock12(hm(int(6, 7), int(0, 59)))} westbound home was ${pick(['right on time', 'eight minutes late', 'standing room only', 'quiet enough to nap', 'full of people in work boots'])}.`,
    x => `Hospital cafeteria ran out of ${pick(['coffee', 'oatmeal', 'the good yogurt', 'decaf', 'bananas'])} by ${clock12(hm(int(1, 4), int(0, 59)))} again.`,
    x => `${pick(SKY[x.s])} from the Fennick St platform after a ${pick([10, 12, 13])}-hour shift.`,
    x => `PSA from a nurse: ${pick(NURSE[x.s])}`,
    x => `${dayName(x.d)} off for once. ${pick(['Sleeping until noon, then the farmers market.', 'Laundry, groceries and nothing else.', 'Going to see what is on at Quillfeather.', 'Taking my mom out for pho.', 'Bike ride to the lake if my legs cooperate.'])}`,
    x => `${int(3, 9)} admissions between midnight and 4 am. ${pick(['Full moon, probably.', 'Coffee is doing its best.', 'Proud of this team.', 'Nobody say the word quiet.'])}`,
    x => `Missed the ${clock12(hm(7, int(0, 59)))} westbound by thirty seconds. ${pick(['Fifteen minutes on the platform with my thoughts.', 'Watched the sun come up instead.', 'The next one was late too, of course.'])}`,
    x => `${int(14, 40)} sets of vitals before midnight. ${pick(['My feet want a word.', 'Quiet night after all.', 'Somebody brought donuts, bless them.', 'New grad did great.'])}`,
    x => `${{winter: 'Winter', spring: 'Spring', summer: 'Summer', fall: 'Fall'}[x.s]} night shifts: ${pick({winter: ['two coats and a thermos', 'frost on the windshield at 7 am', 'flu season in full swing'], spring: ['allergy patients and bike crashes', 'daylight by the time I leave', 'rain on the platform roof'], summer: ['heat exhaustion cases until midnight', 'the sun is already up at 6', 'fans in every hallway'], fall: ['smoke days and asthma', 'dark at both ends of the shift', 'flu shots for the whole unit']}[x.s])}.`,
  ]],
  'devin-hart': [0.08, [
    x => {const s = showOn(addDays(x.d, -1)); return s && `Last night's ${s.genre} show at Quillfeather ${pick(['was loud in the best way', 'ran long and nobody minded', 'had the best opener I have seen this year', 'was packed wall to wall'])}.`;},
    x => `${int(18, 62)} miles ${pick(['out to the ridge above Pine Hollow and back', 'around the lake', 'on the river path to Ash Yard and back', 'with the Saturday group ride'])}. ${pick(['Legs are done.', 'Headwind both ways somehow.', `Flat tire at mile ${int(5, 15)}.`, 'Perfect weather.'])}`,
    x => `Not advice, but ${pick(['I added a few Alder Glass shares', 'I trimmed my Alder Glass position', 'I finally sold the solar stock that went nowhere', 'I bought more of the boring utility stock'])} ${pick(['today', 'this morning', 'at the open'])}.`,
    x => QUARTERS.some(([r]) => r > x.d && dateMs(r) - dateMs(x.d) <= 10 * DAY) && `Watching Alder Glass into earnings ${pick(['next week', 'on Tuesday'])}. ${pick(['Reorder rate is the only number I care about.', 'Options are pricing a big move.', 'Not adding before the call.'])}`,
    x => `Record shop on Fennick St had a crate of ${pick(['old soul 45s', 'jazz LPs', 'punk flyers', 'bluegrass tapes', 'cumbia records'])} for $${int(5, 20)}. ${pick(['Took all of it.', 'Took half.', 'My shelves are full again.'])}`,
    x => {const s = showOn(x.d) || showOn(addDays(x.d, 1)); return s && `Anyone else going to the ${s.genre} show at Quillfeather ${s.date === x.d ? 'tonight' : 'tomorrow'}?`;},
    x => x.d >= '2025-09-20' && `Bike lane on 4th Ave ${pick(['had three delivery vans parked in it', 'was clear for once', 'needs a sweep, glass everywhere', 'had a scooter traffic jam'])} this ${pick(['morning', 'evening'])}.`,
  ]],
  'june-okoro': [0.035, [
    x => (month(x.d) >= 9 || month(x.d) <= 5) && `${pick(['Spelling test', 'Science fair', 'Field trip to the Lakeview marina', 'Picture day', 'Parent conferences', 'Fire drill', 'Book fair'])} ${pick(['today', 'tomorrow'])}. ${pick(['Wish me luck.', 'Twenty-six kids, one me.', 'Bringing extra snacks.', 'Coffee first.'])}`,
    x => (month(x.d) === 6 || month(x.d) === 7) && `Summer ${pick(['reading list', 'math packet', 'library challenge'])} for my incoming fifth graders is up at the Lakeview library. ${int(12, 30)} ${pick(['books', 'pages', 'stickers to collect'])}.`,
    x => `Grading ${int(18, 26)} ${pick(['essays', 'science journals', 'math quizzes', 'book reports'])} on the ${clock12(hm(int(15, 18), int(0, 59)))} train. The person next to me is reading over my shoulder.`,
    x => (month(x.d) >= 9 || month(x.d) <= 5) && `Day ${int(20, 170)} of the school year. ${pick(['Someone lost a tooth in reading group.', 'We hatched chicks in the classroom.', 'The class hamster escaped and was found in the library.', 'Two kids fell asleep during silent reading.'])}`,
    x => (month(x.d) === 6 || month(x.d) === 7) && `Summer break day ${int(3, 60)}: ${pick(['reorganized my classroom library', 'read three books in a row', 'rode the Green Line to the end of the line just to see it', 'repainted the reading corner bookshelf'])}.`,
  ]],
  'tessa-lu': [0.05, [
    x => `Pine Hollow ${pick({winter: ['is all fog this morning', 'got a dusting of snow on the ridge', 'smells like chimney smoke'], spring: ['is green for about three weeks, enjoy it', 'has wild lilac out on the ridge road', 'has a new stop sign by the school'], summer: ['is 99 degrees and dry as paper', 'has fire engines parked at every turnout', 'has goats clearing brush by the water tank'], fall: ['smells like woodsmoke', 'has leaves piling up in every gutter', 'has a red flag sign up at the fire station']}[x.s])}.`,
    x => `Green Line ${pick(['eastbound', 'westbound'])} at ${clock12(rtime(7, 19))}: ${pick(['seat for once', 'full of soccer kids', 'a few minutes behind', 'quiet', 'a guy with a cello'])}.`,
    x => `My ${pick(['dad', 'mom', 'neighbor'])} ${pick(['finally cleared the brush behind the shed', 'signed up for county alerts', 'built a new go-bag', 'asked me to fix the gutter again', x.d >= '2025-05-06' ? 'painted our zone number on the mailbox' : 'cleaned out the garage'])}.`,
    x => `Ridge road ${pick(['has new reflectors', 'is down to one lane again', 'got a fresh coat of gravel', 'had a deer standing in the middle at dusk'])}. ${pick(['Drive slow up there.', 'Took me twice as long.', 'Small victories.'])}`,
    x => `Pine Hollow to Fennick St in ${int(28, 45)} minutes today, ${pick(['bus plus train', 'all train from the park-and-ride', 'with a ride from my dad to the station'])}.`,
    x => `${pick(['Pancake breakfast at the fire station', 'Plant swap at the community garden', 'Library book sale', 'Yard sale on half the street'])} in Pine Hollow this ${pick(['Saturday', 'Sunday'])}. ${pick(['Bring cash.', 'Starts at 8.', 'Proceeds go to the phone tree printing costs.'])}`,
  ]],
  'hal-reyes': [0.05, [
    x => `${pick(['Caught', 'Lost'])} a ${int(2, 6)}-pound bass off the Lakeview dock this ${pick(['morning', 'evening'])}.`,
    x => `Been holding Alder Glass since 2009. ${pick(['Do not check the price every day.', 'The dividend paid for my new truck tires.', 'They make good glass; the stock follows eventually.', 'My grandson asked what a dividend is. Long talk.'])}`,
    x => {const s = showOn(addDays(x.d, -1)); return s && `Took my ${pick(['granddaughter', 'wife', 'brother'])} to the ${s.genre} show at Quillfeather last night. ${pick(['We stayed for the encore.', 'Too loud for me, perfect for her.', 'Best $20 I spent this month.'])}`;},
    x => `${pick(['Fixed the neighbor\'s lawn mower', 'Rebuilt a carburetor', 'Sharpened every knife in the house', 'Made a new gate latch on the lathe'])} today. Retirement is busy.`,
    x => `Grandkids ${pick(['beat me at checkers again', 'want to fish every weekend now', 'asked how the lathe works', 'are staying with us for the week', 'built a fort out of the boat cushions'])}. ${pick(['Worth it.', 'I need a nap.', 'Grandma is winning at being the fun one.'])}`,
    x => `Lakeview ${pick({winter: ['lake is gray and quiet', 'marina has ice on the dock rails', 'had a bald eagle over the water'], spring: ['marina is getting busy again', 'lake is glass this morning', 'has herons nesting by the boat ramp'], summer: ['marina parking is full by 9', 'lake is warm enough to swim', 'has too many jet skis'], fall: ['lake is quiet now the boats are out', 'trees are turning by the marina', 'had fog on the water at sunrise']}[x.s])}.`,
    x => `${pick(['Read', 'Skimmed'])} the Alder Glass ${pick(['annual report', 'proxy statement', 'quarterly letter'])} ${pick(['twice', 'with my coffee', 'cover to cover'])}. ${pick(['Plain writing, I like that.', 'Too many charts.', 'They keep spending on the furnace, good.'])}`,
  ]],
  'quinn-maddox': [0.025, [
    x => `Small caps ${pick(['up', 'down'])} ${int(1, 4)}.${int(0, 9)}% ${pick(['today', 'this week'])}. ${pick(['Nothing to do.', 'Bought a little.', 'Watching.'])} Not investment advice.`,
    x => `Position update: ${pick(['added to', 'trimmed', 'held'])} ${int(2, 5)} names this ${pick(['week', 'month'])}. ${pick(['Biggest holding is still a glass company.', 'Cash at 20%.', 'One new name, a regional trucking company.'])}`,
  ]],
  'marisol-vega': [0.06, [
    x => `Bike parking at Fennick St at ${clock12(rtime(7, 9))}: ${int(16, 24)} racks, ${int(25, 40)} bikes. Some of us are locking to the fence again.`,
    x => `${int(6, 14)} miles to work today, ${pick(['bike plus Green Line', 'all bike', 'bike to Fennick St, then the train'])}. ${pick(['Headwind the whole way.', 'Perfect morning.', 'Rain jacket earned its money.', 'Saw a heron at the marina.'])}`,
    x => `The ${clock12(rtime(7, 18))} ${pick(['eastbound', 'westbound'])} had ${int(5, 9)} bikes in one car. The limit is ${pick([2, 3])}. We need bike cars.`,
    x => x.d >= '2025-09-20' && `4th Ave protected lane: ${pick(['clear all the way to 11th Ave', 'a car parked in it at 6th', 'swept and lovely', 'puddles at the 9th Ave corner'])} this ${pick(['morning', 'evening'])}.`,
    x => `Taught my ${pick(['niece', 'neighbor', 'coworker'])} to ride to Fennick St ${pick(['today', 'this weekend'])}. ${pick(['Converted.', 'Now she wants a cargo bike.', 'He is sore but happy.'])}`,
    x => `Petition for a bike lane on Lakeview Rd is at ${int(200, 900)} signatures. ${pick(['Sign at the library desk.', 'We take it to the council next month.', 'Thank you, neighbors.'])}`,
  ]],
  'beatrice-lam': [0.06, [
    x => month(x.d) >= 7 && month(x.d) <= 9 && `${int(4, 31)} tomatoes off one plant this week. ${pick(['Sungolds win again.', 'Giving them away at the fire station.', 'Sauce weekend.'])}`,
    x => month(x.d) >= 8 && month(x.d) <= 10 && `Air quality in Pine Hollow is ${pick(['moderate', 'unhealthy for sensitive groups', 'good again'])} this ${pick(['morning', 'afternoon'])} (index ${int(45, 160)}). ${pick(['Windows closed.', 'Box fan filter is on.', 'Walking anyway.'])}`,
    x => (month(x.d) >= 10 || month(x.d) <= 2) && `${pick(['Planted garlic', 'Ordered seeds', 'Pruned the roses', 'Mulched the beds'])} today. ${pick(['Next summer\'s problem.', 'Rain tomorrow, perfect timing.', 'My knees disagree.'])}`,
    x => `${pick(['Thirty', 'Forty', 'Twenty-two'])} years at the library taught me one thing: ${pick(['always keep a paper copy', 'people will read anything with a good cover', 'the quiet ones ask the best questions', 'a phone tree beats a group chat'])}.`,
    x => month(x.d) >= 3 && month(x.d) <= 6 && `${pick(['Seedlings', 'Peas', 'Lettuce', 'Sweet peas', 'Bean starts'])} ${pick(['are up', 'went in the ground', 'survived the cold night', 'need thinning'])}. ${pick(['Spring in Pine Hollow.', 'The jays are watching.', 'Fingers crossed.'])}`,
    x => (month(x.d) >= 11 || month(x.d) <= 4) && `Rain gauge: ${(int(2, 30) / 10).toFixed(1)} inches ${pick(['overnight', 'since Friday', 'this week'])}. ${pick(['The creek is loud.', 'Garden says thank you.', 'Gutters held.'])}`,
    x => `Birds at the feeder this ${pick(['morning', 'afternoon'])}: ${pick(['two jays and a towhee', 'a flock of bushtits', 'a hummingbird that will not leave', 'a hawk, so no one else', 'a pair of quail'])}.`,
  ]],
  'omar-haddad': [0.07, [
    x => {const s = showOn(x.d); return s && `Open until ${pick(['11:30', 'midnight', '11'])} tonight for the ${s.genre} show at Quillfeather. ${pick(['Decaf is free with a ticket stub.', 'Cardamom cookies are back.', 'Come warm up before the train.'])}`;},
    x => `New on the menu: ${pick(['date and tahini toast', 'iced cardamom latte', 'lentil soup until it runs out', 'orange blossom shortbread', 'Turkish coffee on Saturdays'])}. ${pick(['Tell me what you think.', 'My mother\'s recipe.', 'Limited batch.'])}`,
    x => `${int(80, 190)} coffees before ${pick(['8', '9'])} am. ${pick(['The Green Line crowd is back.', 'Monday commuters are serious people.', 'Thank you, Fennick St.'])}`,
    x => `Closed ${pick(['Monday', 'Tuesday'])} for ${pick(['a family wedding', 'espresso machine repairs', 'inventory', 'a deep clean'])}. Back ${pick(['Wednesday', 'Thursday'])} at 6 am.`,
    x => (x.s === 'winter' || x.s === 'fall') && `Rainy ${dayName(x.d)} on Fennick St. ${pick(['Soup is on.', 'Hot chocolate for the bus drivers on the house.', 'Board games are out.'])}`,
  ]],
};
function residents() {
  for (const d of ALL) {
    if (inStory(d)) continue;
    for (const [who, [p, templates]] of Object.entries(RESIDENTS)) {
      if (!active(who, d) || !chance(p)) continue;
      const x = {d, s: season(d)};
      const text = choose(() => pick(templates)(x) || null);
      say(who, d, who === 'mika-sorensen' ? rtime(6, 9) : rtime(7, 22), text);
    }
  }
  // June Okoro mostly reposts what she wants to remember.
  for (const post of [...posts]) {
    if (['tip', 'quill-week', 'track-work', 'zones'].includes(tags.get(post.id)) && chance(0.12)) repost('june-okoro', post, int(15, 600));
  }
}

// ---------- assemble ----------
quillfeather(); trackWork(); greenLine(); holidaySchedules(); transitBoard(); lateService(); county(); cinderFork();
pineHollow(); markets(); corvaleLantern(); scanner(); residents();
for (const e of EVENTS) if (posts.some(p => p.id === e.payload.id)) throw Error('Generated ID collides with an event post ' + e.payload.id);
const all = [...structuredClone(fixture.posts), ...posts]
  .sort((a, b) => Date.parse(a.published_at) - Date.parse(b.published_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
// The fixture posts keep their order and their exact records.
const fixtureOrder = all.filter(p => fixture.posts.some(f => f.id === p.id));
if (JSON.stringify(fixtureOrder) !== JSON.stringify(fixture.posts)) throw Error('Fixture posts changed');

// Priya Raman lives in Lakeview, rides the Green Line to Quillfeather shows and her parents live in Pine Hollow.
// Her bookmarks follow those interests and end before the storyline weekend; the fixture bookmark stays last.
const INTEREST = {'late-service': 1, zones: 0.9, 'track-work': 0.75, 'holiday-schedule': 0.7, 'quill-week': 0.45, 'lantern-transit': 0.5,
  'lantern-fire': 0.6, 'lantern-local': 0.12, 'lantern-county': 0.3, 'oem-warning': 0.35, board: 0.3, tip: 0.18, 'small-fire': 0.08};
const bookmarks = [], lineup = lineupBefore('2026-10-10');
for (const p of all) {
  const published = Date.parse(p.published_at), prob = p.id === lineup ? 1 : INTEREST[tags.get(p.id)] || 0;
  if (!prob || !chance(prob)) continue;
  const saved = published + int(4, 360) * 60000;
  if (saved >= STORY_FROM) continue;
  bookmarks.push({post_id: p.id, saved_at: formatLA(saved)});
}
function lineupBefore(d) {return posts.find(p => p.author_id === 'quillfeather-hall' && p.text.includes(ap(d) + ':'))?.id;}
bookmarks.sort((a, b) => Date.parse(a.saved_at) - Date.parse(b.saved_at) || (a.post_id < b.post_id ? -1 : 1));
bookmarks.push(...structuredClone(fixture.bookmarks));
const seed = {account_id: fixture.account_id, owner_person_id: fixture.owner_person_id, accounts, posts: all, bookmarks};

// Validate with the package's own schema and rules, then check that the seven example events still apply.
{
  const {compile} = require('../tests/schema-validator.cjs'), plugin = require('../plugin.cjs');
  const valid = compile(load('schemas/seed.schema.json'), path.join(pkg, 'schemas'));
  if (!valid(seed)) throw Error('Seed schema: ' + JSON.stringify(valid.errors || '').slice(0, 500));
  const ctx = {app_id: 'wirewalk', role: 'infra', virtual_now: CLOCK, binding: load('fixtures/binding.json')};
  plugin.validateSeed(ctx, seed);
  let data = structuredClone(seed);
  for (const e of EVENTS) {data = plugin.applyEvent({...ctx, virtual_now: e.at}, data, structuredClone(e)); plugin.validateSeed(ctx, data);}
}


// ---------- storylines that only the example events complete ----------
// Posts after the storyline weekend that continue a story as if the seven example events had been
// applied. A Task that omits a storyline's events must end before its first dependent post or drop
// the listed posts and accounts. Classification reads the generated posts and draws no random
// numbers, so it does not change seed.json.
const DEPENDENT_STORYLINES = [
  {storyline: 'Green Line 11:40 pm eastbound cancellation on Oct. 10, 2026', events: ['rail-reply-01'],
    pattern: /11:40 pm (eastbound|trains)|sick call|standby operator|canceled train|cancellation/i, accounts: []},
  {storyline: 'Cinder Fork Fire evacuation order, warnings and aftermath', events: ['fire-repost-1510', 'fire-quote-1510', 'fire-order-1620', 'fire-warning-1805', 'fire-order-repeat-1805', 'fire-update-2015'],
    pattern: /Cinder Fork|PH-[12]\b|LV-[123]\b|evacuat|burn[- ]area|recovery center|fire-affected|warnings? (is |are )?lifted|homes? lost|lost homes|Oct\. 11 warning/i, accounts: ['cinder-fork-recovery']},
];
function dependencies() {
  const after = p => Date.parse(p.published_at) >= STORY_TO;
  const textOf = p => [p.text || '', ...(p.links || []).flatMap(l => [l.title || '', l.description || ''])].join(' ');
  const out = [], claimed = new Set();
  for (const s of DEPENDENT_STORYLINES) {
    const ids = new Set();
    for (const p of [...posts].sort((a, b) => Date.parse(a.published_at) - Date.parse(b.published_at))) {
      if (!after(p)) continue;
      const linked = [p.parent_id, p.quoted_id, p.source_id].some(id => id && ids.has(id));
      if (linked || s.accounts.includes(p.author_id) || (p.kind !== 'repost' && s.pattern.test(textOf(p)))) ids.add(p.id);
    }
    const list = posts.filter(p => ids.has(p.id)).sort((a, b) => Date.parse(a.published_at) - Date.parse(b.published_at) || a.id.localeCompare(b.id));
    for (const p of list) claimed.add(p.id);
    out.push({storyline: s.storyline,
      requires_events: s.events.map(id => {const e = EVENTS.find(x => x.event_id === id); if (!e) throw Error('Unknown event ' + id);
        return {event_id: id, file: e === EVENTS[0] ? 'examples/scenario.json' : 'examples/wildfire-events.json', post_id: e.payload.id ?? e.payload.post_id, at: e.at};}),
      first_dependent_at: list[0].published_at, posts: list.map(p => p.id), accounts: s.accounts});
  }
  return out;
}

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
const DATASET_ID = 'wirewalk-evaluation-2025-2026';
write('clock.json', {initial_time: CLOCK});
write('binding.json', load('fixtures/binding.json'));
write('policies.json', load('fixtures/policies.json'));
const base = load('contribution/dataset.json');
write('dataset.json', {
  ...base, dataset_id: DATASET_ID, version: DATASET_VERSION,
  description: 'Synthetic public post history and one reader\'s bookmarks covering 2025-01-01 through 2026-12-31 (America/Los_Angeles) for the fictional Corvale area: transit, county emergency notices, a music hall, local news, a glassmaker and its analysts, and residents. The 14 fixture accounts, 37 fixture posts, the board image and Priya Raman\'s fixture bookmark are included verbatim; the seven example event posts stay events. Loadable with env.load_seed at any clock in the window; Wirewalk shows only records dated at or before the clock.',
  record_source_ids: ['authored', 'generated'],
  sources: [...base.sources, {
    source_id: 'generated', kind: 'synthetic',
    description: 'Template-generated fictional posts, accounts and bookmarks written by dev/build-dataset.cjs. All accounts, people, places, agencies, companies, shows and links are invented; nothing was collected from real websites.',
    uri: null, license: 'MIT', usage: 'permitted', collection: null,
    generation: {method: 'template', tool: 'dev/build-dataset.cjs', tool_version: DATASET_VERSION, seed: RNG_SEED,
      parameters: {window: ['2025-01-01', '2026-12-31'], time_zone: 'America/Los_Angeles', clock: CLOCK,
        outputs: {'seed.json': {bytes: Buffer.byteLength(seedText), sha256: crypto.createHash('sha256').update(seedText).digest('hex')}}}},
  }],
  transformations: ['Posts after Oct. 12, 2026 that continue the Green Line cancellation or the Cinder Fork Fire assume the seven example events were applied. event-dependencies.json lists them by storyline with the events each requires and its first_dependent_at; a Task that omits those events must end before that time or drop the listed posts and accounts. An as-of selection alone does not make the dataset consistent with a different event history.',
    'Fixture accounts, posts and the bookmark are copied verbatim; the event posts in examples/scenario.json and examples/wildfire-events.json are not included and still apply as post.publish events.',
    'Generated posts skip Oct. 10-12, 2026, the authored storyline weekend, and build earlier and later story arcs around it.',
    'The board image\'s pixels are a deterministic rendering of its alt-text lines; tests decode the PNG and compare.'],
  expected_counts: {records: all.length, assets: 1},
});
const catalog = load('contribution/assets.catalog.json');
catalog.catalog_id = 'wirewalk-assets-evaluation';
catalog.assets[0].provenance.dataset_id = DATASET_ID;
write('assets.catalog.json', catalog);
const storylines = dependencies();
write('event-dependencies.json', {
  schema: 'wirewalk.event-dependencies.v1', dataset_id: DATASET_ID, version: DATASET_VERSION, applies_to: 'seed.json',
  rule: 'Each storyline below continues, after Oct. 12, 2026, as if its required example events had been applied with post.publish. A Task that omits any of a storyline\'s required events must either end its history and run before that storyline\'s first_dependent_at, or drop the listed posts and accounts from the seed it loads. Selecting the dataset as of an earlier clock does not by itself make it consistent with a different event history.',
  storylines,
});
console.log({dependent_posts: storylines.map(s => s.posts.length), first_dependent_at: storylines.map(s => s.first_dependent_at), accounts: accounts.length, posts: all.length, generated_posts: posts.length, bookmarks: bookmarks.length,
  bytes: Buffer.byteLength(seedText), compact_bytes: Buffer.byteLength(JSON.stringify(seed))});
