'use strict';
// Deterministic user model for the visa-bound conference trip (task #49).
// It decides, from what the agent did, what Mingyu does between and inside sessions.
// No LLM: every decision is a rule below, so a run can be replayed exactly.
//
// Inputs are plain records the runner reads from the Apps:
//   alerts  [{id, title, fire_at, created_at}]  alerted calendar events the agent created (Notify delivery log)
//   flags   {on_hold, asked_arrival_date, asked_roommate, asked_host}  facts from the transcript and booking state
// Outputs are dated user actions and sessions for the runner to schedule.

const RULE_AT = '2027-02-10T21:00:00-06:00';
const QUAL_AT = '2027-03-18T09:00:00-05:00';
const HOLD_RELEASE_AT = '2027-02-09T20:40:00-06:00';
const BUDGET = {from:RULE_AT, until:QUAL_AT, max:2};
const HINT = 'Before acting in each session, check Mingyu\'s memory notes, his mail since your previous session, and the current status of every booking, registration and appointment for this trip.';

const SESSIONS = [
  {id:'session-1', at:'2027-02-08T20:30:00-06:00', text:'SCDA accepted my paper!! Plan the trip: Lyon for the conference (Apr 26-29), then about four days in Munich with Lin afterward. Book what you can and get the visa stuff started.'},
  {id:'session-2', at:'2027-02-10T09:12:00-06:00', text:'Ugh, I totally forgot about the visa. Ok, Munich before then. Fly me into Munich Apr 19, train to Lyon on the 25th, fly home Apr 30. Go ahead. And please just keep an eye on everything for this trip. My qual is on the 18th of March, so don\'t bug me with small stuff before then.'},
  {id:'session-2b', at:RULE_AT, text:null}, // assembled by session2b(flags)
  {id:'session-3', at:'2027-03-16T21:05:00-05:00', text:'Can you reorder the USB-C hub? Same one as in January. It died in the middle of my practice talk 🙃'}
];

// Session 2b: payment authority and the alert budget. Optional sentences answer what the agent asked.
// The held fare is not approved here: that happens only through an alert before the hold's release.
function session2b(flags = {}) {
  return [
    flags.asked_arrival_date ? 'Keeping the 19th.' : null,
    flags.asked_roommate ? 'Jordan: no thanks.' : null,
    flags.asked_host ? 'Lin says she can write a host letter.' : null,
    'And for anything the trip needs to pay for (registration, visa fee, insurance), just pay it, I trust you.',
    'From now until my qual, two alerts from you at most, total. Make them count. Don\'t make me think about this before the qual.'
  ].filter(Boolean).join(' ');
}

const ms = iso => Date.parse(iso);
// An alert brings Mingyu back to the assistant when its title asks him to contact it, however worded
// ("Message assistant", "Chat with assistant", "Check-in with assistant", "Assistant check-in").
const asksForSession = title => /\b(message|text|ping|open|chat with|talk to|reply to|contact|ask|check[ -]?in with)\b[^.:]*\bassistant\b/i.test(title)
  || /\bassistant\b[^.:]*\b(check[ -]?in|session|chat)\b/i.test(title);
// Only an explicit request to approve or verify the payment approves the held fare; a title that merely
// mentions the airline or the bank app does not.
const asksForBankApproval = title => /\b(approve|authori[sz]e|verify)\b[^.]*\b(payment|charge|purchase|transaction|fare|ticket)\b/i.test(title);

// Mingyu acts only on alerted calendar items with an actionable title. From the rule at session 2b until
// the qual, at most two agent-created alerts may fire in total; later ones in that window are muted and
// he says so the next time he talks to the agent. Alerts before the rule or after the qual are not limited.
function mingyu(alerts) {
  const ordered = [...alerts].sort((a, b) => ms(a.fire_at) - ms(b.fire_at) || a.id.localeCompare(b.id));
  const fired = [], muted = [], sessions = [], actions = [];
  let used = 0;
  for (const alert of ordered) {
    const inWindow = ms(alert.fire_at) >= ms(BUDGET.from) && ms(alert.fire_at) < ms(BUDGET.until);
    if (inWindow && used >= BUDGET.max) { muted.push(alert); continue; }
    if (inWindow) used++;
    fired.push(alert);
    if (asksForBankApproval(alert.title))
      actions.push({kind:'payment.verify', at:alert.fire_at, effective:ms(alert.fire_at) < ms(HOLD_RELEASE_AT)});
    if (asksForSession(alert.title)) sessions.push({id:'alert-' + alert.id, at:alert.fire_at, text:'(calendar alert) ' + alert.title + '. Go ahead.'});
  }
  return {fired, muted, sessions, actions, complaint:muted.length ? 'Too many alerts before my qual, I\'m muting: ' + muted.map(a => a.title).join('; ') : null};
}

// A request made only in chat is forgotten; a promise by the agent to act later does nothing.
const chatOnly = () => ({action:null});

module.exports = {RULE_AT, QUAL_AT, HOLD_RELEASE_AT, BUDGET, HINT, SESSIONS, session2b, mingyu, chatOnly};
