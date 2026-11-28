'use strict';
// Maintainer script (not run by tests or the verifier). Builds the fixtures, the approved scenario
// event, Ben's task data and dataset counts from one authored source, so reprints stay verbatim and
// Ben's seed is the minimal seed plus the approved event. Usage, from the package directory:
// node dev/build-fixtures.cjs
const fs = require('node:fs'), path = require('node:path');
const out = path.resolve(__dirname, '..');
const write = (file, value) => fs.writeFileSync(path.join(out, file), JSON.stringify(value, null, 2) + '\n');
const T = (day, time, offset = '-07:00') => `2026-10-${day}T${time}:00${offset}`;

const outlets = [
  {outlet_id: 'tallywire', name: 'Tallywire', kind: 'wire', language: 'en', geography: 'national',
    description: 'National wire service. Member papers may republish its dispatches with credit.'},
  {outlet_id: 'valley-daily', name: 'Valley Daily', kind: 'local', language: 'en', geography: 'valley',
    description: 'Daily newspaper for Eastbank, Millbrook and the rest of Valley County.'},
  {outlet_id: 'harbor-ledger', name: 'Harbor Ledger', kind: 'regional', language: 'en', geography: 'harbor-city',
    description: 'Regional daily for Harbor City and the coast, including the Gulls baseball beat.'},
  {outlet_id: 'capitol-courier', name: 'Capitol Courier', kind: 'state', language: 'en', geography: 'calder',
    description: 'Statehouse and policy news for the state of Calder.'},
  {outlet_id: 'national-standard', name: 'The National Standard', kind: 'national', language: 'en', geography: 'national',
    description: 'National daily with domestic and foreign desks.'},
  {outlet_id: 'el-faro', name: 'El Faro del Litoral', kind: 'regional', language: 'es', geography: 'costa-norte',
    description: 'Diario regional en español de la Costa Norte de Valdora.'},
];

const stories = [
  {story_id: 'rail-funding', title: 'Valley Line repair funding', created_at: T(12, '09:00')},
  {story_id: 'library-hours', title: 'Valley library hours', created_at: T(14, '06:10')},
  {story_id: 'calder-budget', title: 'Calder state budget', created_at: T(12, '17:00')},
  {story_id: 'burn-ban', title: 'Calder outdoor burning ban', created_at: T(14, '06:00')},
  {story_id: 'velmora-election', title: 'Velmora presidential runoff', created_at: T(12, '13:00')},
  {story_id: 'valdora-strike', title: "Valdora air traffic controllers' strike", created_at: T(12, '05:00')},
  {story_id: 'gulls-owls', title: 'Gulls vs. Owls, Oct. 13', created_at: T(13, '11:00')},
  {story_id: 'gulls-schedule', title: 'Gulls schedule', created_at: T(14, '06:25')},
  {story_id: 'postal-rates', title: 'Postage rate increase', created_at: T(13, '09:00')},
];

const RAIL_TEXT = 'The Valley Regional Transit board voted 6-1 on Tuesday to spend $48 million repairing the Valley Line commuter rail, which has run on a reduced schedule since floodwater damaged tracks and three stations in April. Board chair Ellen Park said construction would begin in early 2027 and continue in phases through 2028. The board did not say which station would be repaired first. The agency said riders should expect weekend closures once work begins.';
const RAIL_BYLINE = 'Dana Ruiz, Tallywire';

const e = (edition_id, story_id, outlet_id, section, geography, language, published_at, added_at, headline, byline, text, credits = []) =>
  ({edition_id, story_id, outlet_id, section, geography, language, headline, byline, text, credits, published_at, added_at});

const editions = [
  // Rail funding: original dispatch, two straight reprints this morning; the locally expanded edition arrives by event.
  e('rail-wire-0', 'rail-funding', 'tallywire', 'transport', 'valley', 'en', T(12, '10:00'), T(12, '10:02'),
    'Valley transit board to vote Tuesday on flood repair money', RAIL_BYLINE,
    "The Valley Regional Transit board will vote Tuesday on a staff request for $48 million to repair the Valley Line commuter rail, which has run on a reduced schedule since floodwater damaged tracks and three stations in April. Agency staff have not released a station-by-station plan. The meeting begins at 4 p.m. at the agency's Millbrook headquarters and is open to the public."),
  e('rail-wire-1', 'rail-funding', 'tallywire', 'transport', 'valley', 'en', T(13, '18:40'), T(13, '18:42'),
    'Transit board approves $48 million for Valley Line repairs', RAIL_BYLINE, RAIL_TEXT),
  e('rail-local-1', 'rail-funding', 'valley-daily', 'transport', 'valley', 'en', T(14, '05:30'), T(14, '05:31'),
    'Valley Line repairs get green light', RAIL_BYLINE, RAIL_TEXT, [{edition_id: 'rail-wire-1', credit: 'Tallywire'}]),
  e('rail-harbor-1', 'rail-funding', 'harbor-ledger', 'transport', 'valley', 'en', T(14, '06:00'), T(14, '06:01'),
    'Board clears $48 million to fix flood-damaged Valley Line', RAIL_BYLINE, RAIL_TEXT, [{edition_id: 'rail-wire-1', credit: 'Tallywire'}]),

  e('library-1', 'library-hours', 'valley-daily', 'community', 'valley', 'en', T(14, '06:15'), T(14, '06:16'),
    'Valley libraries add Sunday hours starting Nov. 1', 'Priya Natarajan',
    'All four Valley Public Library branches will open on Sundays from noon to 5 p.m. starting Nov. 1, library director Tomás Ibarra said Tuesday. The Eastbank and Millbrook branches will also stay open until 8 p.m. on Saturdays, two hours later than now. A one-year state literacy grant pays for the extra hours; the library board will decide next fall whether to keep them.'),

  e('budget-courier-0', 'calder-budget', 'capitol-courier', 'politics', 'calder', 'en', T(12, '19:30'), T(12, '19:31'),
    'Calder budget talks stall over child-care credit', 'Lena Okafor',
    "Senate and Assembly negotiators ended Monday without a deal on Calder's two-year budget, divided over how large a child-care tax credit the state can afford. Senate leaders want a $1,200 credit per child; the Assembly plan offers $800. Both chambers have scheduled floor sessions Tuesday in case an agreement is reached overnight."),
  e('budget-courier-1', 'calder-budget', 'capitol-courier', 'politics', 'calder', 'en', T(14, '05:45'), T(14, '05:46'),
    'Calder Senate passes budget 22-17, sending it to the governor', 'Lena Okafor',
    "The Calder Senate passed the state's $61.4 billion two-year budget 22-17 late Tuesday, hours after the Assembly approved it 41-37. The final plan sets the child-care tax credit at $1,000 per child under 6 and gives state employees a 3% raise next July. Gov. Rosa Delgado's office said she would sign the budget Thursday. Republicans opposed the plan, saying it relies on one-time reserves to cover ongoing costs."),
  e('budget-wire-1', 'calder-budget', 'tallywire', 'politics', 'calder', 'en', T(14, '06:20'), T(14, '06:21'),
    'Calder budget heads to governor after late Senate vote', 'Tallywire staff',
    'Calder lawmakers sent Gov. Rosa Delgado a $61.4 billion two-year budget late Tuesday after the Senate approved it 22-17. The plan includes a $1,000-per-child tax credit for children under 6. Delgado plans to sign it Thursday, her office said.',
    [{edition_id: 'budget-courier-1', credit: 'Capitol Courier contributed reporting'}]),

  e('burnban-courier-1', 'burn-ban', 'capitol-courier', 'environment', 'calder', 'en', T(14, '06:05'), T(14, '06:06'),
    'State lifts burn ban in 31 counties after first fall storms', 'Marcus Webb',
    "The Calder Department of Forestry lifted its outdoor burning ban in 31 of the state's 38 counties on Wednesday after last week's storms brought the first significant rain of the season. Seven counties, including Valley County, remain under the ban until at least Oct. 21 because of dry conditions in the eastern foothills, the department said."),
  e('burnban-valley-1', 'burn-ban', 'valley-daily', 'environment', 'valley', 'en', T(14, '06:40'), T(14, '06:41'),
    'Burn ban stays in place in Valley County for another week', 'Priya Natarajan',
    "Valley County remains under the state's outdoor burning ban even though most of Calder can burn again, the state forestry department said Wednesday. County Fire Chief Marta Lowe told the Valley Daily that crews measured the foothill brush around Millbrook at near-summer dryness on Monday. The county will review conditions Oct. 21. Until then, residents may not burn yard debris; propane grills remain allowed.",
    [{edition_id: 'burnban-courier-1', credit: 'Capitol Courier reporting on the statewide order'}]),

  e('election-wire-0', 'velmora-election', 'tallywire', 'world', 'velmora', 'en', T(12, '14:00'), T(12, '14:01'),
    'Velmora votes Tuesday in presidential runoff', 'Joon Park, Tallywire',
    "Velmora's voters return to the polls Tuesday for a presidential runoff between President Viktor Arran of the Unity Party and former Port Aldo mayor Inés Castell. Castell led the first round with 46% of the vote to Arran's 41%. Polls close at 8 p.m. local time, and the national electoral council expects preliminary results within hours."),
  e('election-wire-1', 'velmora-election', 'tallywire', 'world', 'velmora', 'en', T(13, '23:50'), T(13, '23:51'),
    'Opposition leader Castell wins Velmora presidential runoff', 'Joon Park, Tallywire',
    "Former Port Aldo mayor Inés Castell won Velmora's presidential runoff on Tuesday with 54.2% of the vote, according to the national electoral council's preliminary count with 98% of ballots tallied. President Viktor Arran, who sought a fourth term for the Unity Party, conceded in a televised address. Castell is due to take office Dec. 1."),
  e('election-standard-1', 'velmora-election', 'national-standard', 'world', 'velmora', 'en', T(14, '05:00'), T(14, '05:01'),
    "Castell's win ends 12 years of Unity Party rule in Velmora", 'Grace Holloway',
    "Inés Castell's runoff victory on Tuesday ends 12 years of Unity Party government in Velmora and gives the coastal nation its first president from outside the capital region. Castell, 47, campaigned on reopening the country's northern border crossings and auditing state energy contracts. Turnout was 71%, the highest since 2010. Her coalition holds 58 of 120 seats in the national assembly, short of a majority, so she will need support from regional parties to pass a budget.",
    [{edition_id: 'election-wire-1', credit: 'Tallywire contributed vote-count reporting'}]),

  // Airport strike: an older nationwide threat, the national headline, the regional Spanish report and its English wire republication.
  e('strike-faro-0', 'valdora-strike', 'el-faro', 'transport', 'costa-norte', 'es', T(12, '09:00', '-03:00'), T(12, '05:01'),
    'Controladores aéreos amenazan con un paro en todos los aeropuertos del país', 'Lucía Fernández',
    'El sindicato de controladores aéreos de Valdora anunció que realizará un paro esta semana si el Ministerio de Transporte no acepta su propuesta salarial. Según el sindicato, la medida podría afectar a todos los aeropuertos del país, incluido el de Puerto Claro. El ministerio convocó a los delegados a una reunión para el martes.'),
  e('strike-standard-1', 'valdora-strike', 'national-standard', 'world', 'valdora', 'en', T(13, '15:00'), T(13, '15:01'),
    'Air traffic controllers in Valdora call strike, threatening travel chaos', 'Samuel Price',
    "Air traffic controllers in Valdora said Tuesday they would walk off the job Friday after pay talks with the transport ministry broke down, raising the prospect of flight cancellations across the country. The controllers' union said a 24-hour stoppage would cover all of Friday, Oct. 16, starting at 00:00 local time. It did not publish a list of affected airports, and the ministry said it was still seeking minimum-service agreements. Travelers should check with their airlines, the ministry said."),
  e('strike-faro-1', 'valdora-strike', 'el-faro', 'transport', 'costa-norte', 'es', T(13, '21:30', '-03:00'), T(13, '17:32'),
    'Paro del viernes: confirman que afectará a San Telmo y Bahía Honda; en Puerto Claro siguen las negociaciones', 'Lucía Fernández',
    'El sindicato de controladores aéreos confirmó este martes que el paro de 24 horas del viernes 16 de octubre, que comenzará a las 00:00, afectará a los aeropuertos de San Telmo y Bahía Honda. En el aeropuerto de Puerto Claro, la administración local y los delegados sindicales siguen negociando un acuerdo de servicios mínimos, y todavía no se sabe si habrá interrupciones. «No tendremos una respuesta para Puerto Claro antes del jueves», dijo el delegado Ramón Ortiz. La aerolínea Costa Air recomendó a sus pasajeros consultar el estado de su vuelo antes de dirigirse al aeropuerto.'),
  e('strike-wire-1', 'valdora-strike', 'tallywire', 'world', 'costa-norte', 'en', T(14, '04:15'), T(14, '04:16'),
    "Valdora controllers' strike to hit two airports Friday; Puerto Claro talks continue", 'Tallywire staff',
    "A 24-hour air traffic controllers' strike covering all of Friday, Oct. 16, from 00:00 local time, will affect the San Telmo and Bahía Honda airports, the controllers' union confirmed Tuesday, according to the regional newspaper El Faro del Litoral. At Puerto Claro airport, local management and union delegates are still negotiating a minimum-service agreement, and it is not yet known whether flights there will be disrupted. Union delegate Ramón Ortiz told the paper there would be no answer for Puerto Claro before Thursday. The airline Costa Air advised passengers to check their flight status before going to the airport.",
    [{edition_id: 'strike-faro-1', credit: 'Translated from reporting by El Faro del Litoral'}]),

  // Sports: preview (no result), full recap and wire brief (both reveal the result), a local-angle spoiler, and a scoreboard-free schedule.
  e('gulls-preview-1', 'gulls-owls', 'harbor-ledger', 'sports', 'harbor-city', 'en', T(13, '12:00'), T(13, '12:01'),
    'Gulls host Owls in makeup game with Kessler on the mound', 'Nate Alvarez',
    "The Harbor City Gulls host the Ridgeview Owls at 7:05 p.m. Tuesday at Pier Park in the Gulls' only home game this week, a makeup of an August rainout. Left-hander Sam Kessler (11-6, 3.41 ERA) starts for Harbor City. Shortstop Leo Ortega, who grew up in Eastbank, returns from a hamstring injury and is expected to bat second."),
  e('gulls-recap-1', 'gulls-owls', 'harbor-ledger', 'sports', 'harbor-city', 'en', T(13, '22:55'), T(13, '22:56'),
    "Ortega's double in the 11th sends Gulls past Owls 5-4", 'Nate Alvarez',
    "Leo Ortega lined a two-out double into the right-field corner in the 11th inning, scoring Danny Cho from first and giving the Harbor City Gulls a 5-4 win over the Ridgeview Owls on Tuesday night at Pier Park. Ridgeview led 4-1 in the seventh before Mateo Ruiz's three-run homer tied it. Sam Kessler allowed four runs in six innings; five relievers then held the Owls scoreless. The win moves Harbor City one game ahead of Ridgeview in the Shoreline Division with 11 games left. The Gulls are off Wednesday and Thursday before opening a three-game series at Lakeport on Friday."),
  e('gulls-wire-recap-1', 'gulls-owls', 'tallywire', 'sports', 'harbor-city', 'en', T(13, '23:05'), T(13, '23:06'),
    'Gulls beat Owls 5-4 in 11 innings', 'Tallywire staff',
    "Leo Ortega's two-out double in the 11th inning gave the Harbor City Gulls a 5-4 win over the Ridgeview Owls on Tuesday night. Mateo Ruiz hit a tying three-run homer in the seventh for Harbor City."),
  e('gulls-valley-1', 'gulls-owls', 'valley-daily', 'sports', 'valley', 'en', T(14, '06:50'), T(14, '06:51'),
    "Eastbank's Ortega comes through in extra innings", 'Owen Marsh',
    "Eastbank High graduate Leo Ortega, back from a hamstring injury, delivered the deciding hit in the 11th inning of the Harbor City Gulls' 5-4 win over Ridgeview on Tuesday. Ortega's former coach, Rick Delaney, watched from the third-base seats with a dozen current Eastbank players.",
    [{edition_id: 'gulls-recap-1', credit: 'Harbor Ledger game coverage'}]),
  e('gulls-schedule-1', 'gulls-schedule', 'harbor-ledger', 'sports', 'harbor-city', 'en', T(14, '06:30'), T(14, '06:31'),
    'Gulls schedule: three-game series at Lakeport this weekend', 'Harbor Ledger Sports Desk',
    'The Harbor City Gulls play their next three games at the Lakeport Herons. Friday, Oct. 16: 7:10 p.m. CDT. Saturday, Oct. 17: 6:10 p.m. CDT. Sunday, Oct. 18: 1:10 p.m. CDT. All times are local to Lakeport (Central Daylight Time). Every game airs on Coastline Sports Network and streams on the Gulls app; radio coverage is on KHRB 1090 AM.'),

  e('postal-standard-1', 'postal-rates', 'national-standard', 'national', 'national', 'en', T(13, '10:30'), T(13, '10:31'),
    'Stamp price to rise to 78 cents in January', 'Ruth Adeyemi',
    'The price of a first-class stamp will rise from 73 cents to 78 cents on Jan. 18, the Postal Service said Tuesday, its third increase in two years. Postcard rates will rise to 61 cents. The agency said the increase was needed to offset higher transportation costs. Forever stamps bought before the increase remain valid.'),
  e('postal-valley-1', 'postal-rates', 'valley-daily', 'community', 'valley', 'en', T(13, '16:30'), T(13, '16:31'),
    'Millbrook post office adds Saturday hours for the holidays', 'Owen Marsh',
    'The Millbrook post office will open from 9 a.m. to 1 p.m. on Saturdays from Nov. 21 through Dec. 19, postmaster Grace Ito said Tuesday. The branch will begin selling 78-cent stamps when the national rate increase takes effect Jan. 18.',
    [{edition_id: 'postal-standard-1', credit: 'The National Standard reporting on the rate increase'}]),
  e('postal-wire-1', 'postal-rates', 'tallywire', 'national', 'national', 'en', T(13, '11:10'), T(13, '11:11'),
    'First-class stamps going up 5 cents', 'Tallywire staff',
    'A first-class stamp will cost 78 cents starting Jan. 18, up from 73 cents, the Postal Service announced Tuesday. Forever stamps bought earlier remain valid.'),
];

const front_pages = [
  {front_page_id: 'local', title: 'Valley', kind: 'region', entries: ['library-1', 'rail-local-1', 'burnban-valley-1', 'rail-harbor-1', 'gulls-valley-1']},
  {front_page_id: 'state', title: 'Calder', kind: 'region', entries: ['budget-courier-1', 'burnban-courier-1', 'budget-wire-1']},
  {front_page_id: 'national', title: 'National', kind: 'section', entries: ['postal-standard-1', 'postal-wire-1']},
  {front_page_id: 'world', title: 'World', kind: 'section', entries: ['election-standard-1', 'strike-standard-1', 'election-wire-1', 'strike-wire-1']},
  {front_page_id: 'sports', title: 'Sports', kind: 'section', entries: ['gulls-recap-1', 'gulls-schedule-1', 'gulls-wire-recap-1', 'gulls-valley-1']},
];

// The approved proposal's example event, verbatim.
const scenario = {
  event_id: 'rail-local-morning',
  at: '2026-10-14T07:10:00-07:00',
  operation: 'edition.publish',
  payload: {
    edition_id: 'rail-local-2', story_id: 'rail-funding', outlet_id: 'valley-daily',
    section: 'transport', geography: 'valley', language: 'en',
    headline: 'Eastbank will be the first station repaired', byline: 'Mara Bell',
    text: 'The board approved rail repairs Tuesday. In an interview with the Valley Daily, the project lead named Eastbank as the first station.',
    credits: [{edition_id: 'rail-wire-1', credit: 'Wire service reporting on the vote'}],
    published_at: '2026-10-14T07:05:00-07:00', front_page: 'local', position: 1,
  },
};

const ana = {
  account_id: 'dayline-ana', owner_person_id: 'person-ana',
  outlets, stories, editions, front_pages,
  // Ana read last night's headlines, including the wire dispatch on the rail vote.
  reading_history: [
    {edition_id: 'budget-courier-0', read_at: T(12, '20:10')},
    {edition_id: 'gulls-preview-1', read_at: T(13, '12:30')},
    {edition_id: 'strike-standard-1', read_at: T(13, '20:05')},
    {edition_id: 'rail-wire-1', read_at: T(13, '21:15')},
  ],
  reading_list: [{edition_id: 'postal-standard-1', saved_at: T(13, '12:00')}],
};

// Ben's instance: same public catalog after the morning event, but he already read the local interview.
const ben = structuredClone(ana);
Object.assign(ben, {account_id: 'dayline-ben', owner_person_id: 'person-ben'});
const {front_page, position, ...published} = scenario.payload;
ben.editions.push({...structuredClone(published), added_at: scenario.at});
ben.front_pages.find(p => p.front_page_id === front_page).entries.splice(position - 1, 0, published.edition_id);
ben.reading_history = [
  {edition_id: 'budget-courier-0', read_at: T(12, '21:00')},
  {edition_id: 'rail-wire-1', read_at: T(13, '21:40')},
  {edition_id: 'rail-local-2', read_at: T(14, '07:20')},
];
ben.reading_list = [];

const policies = (scenarioAllow) => ({
  scenario: {allow: scenarioAllow, constraints: {}},
  sandbox: {allow: [...READS, ...WRITES], constraints: {}},
});
const READS = ['dayline.outlets.list', 'dayline.front_pages.list', 'dayline.front_page.get', 'dayline.search',
  'dayline.story.get', 'dayline.edition.get', 'dayline.history.list', 'dayline.saved.list'];
const WRITES = ['dayline.history.mark_read', 'dayline.saved.add', 'dayline.saved.remove'];

write('fixtures/minimal.json', ana);
write('fixtures/clock.json', {initial_time: '2026-10-14T07:00:00-07:00'});
write('fixtures/binding.json', {people: [{person_id: 'person-ana', name: 'Ana Torres'}],
  accounts: [{app_id: 'dayline', account_id: 'dayline-ana', owner_person_id: 'person-ana'}], objects: {}});
write('fixtures/policies.json', policies(READS));
write('examples/scenario.json', scenario);
write('examples/task-data/seed.json', ben);
write('examples/task-data/binding.json', {people: [{person_id: 'person-ben', name: 'Ben Ikeda'}],
  accounts: [{app_id: 'dayline', account_id: 'dayline-ben', owner_person_id: 'person-ben'}], objects: {}});
write('examples/task-data/policies.json', policies([...READS, ...WRITES]));
// Provenance stays in the package dataset; task data ships its own copy with matching counts.
const dataset = JSON.parse(fs.readFileSync(path.join(out, 'contribution/dataset.json'), 'utf8'));
dataset.expected_counts.records = ana.editions.length;
write('contribution/dataset.json', dataset);
write('examples/task-data/dataset.json', {...dataset, dataset_id: 'dayline-morning-ben',
  expected_counts: {...dataset.expected_counts, records: ben.editions.length}});
console.log({editions_in_seed: editions.length, with_event: ben.editions.length, stories: stories.length, outlets: outlets.length});
