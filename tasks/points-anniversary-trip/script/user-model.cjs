'use strict';
// Deterministic user model for the points-funded anniversary trip (task #55).
// It decides, from what the agent did, what Daniel and Mei do between and inside sessions.
// No LLM: every decision is a rule below, so a run can be replayed exactly.
//
// Inputs are plain records the runner reads from the Apps:
//   alerts   [{id, title, fire_at, created_at}]  alerted calendar events the agent created (Notify delivery log)
//   texts    [{at, text}]                         messages the agent sent Mei (Messages)
// Outputs are dated user actions and sessions for the runner to schedule.

const TZ = '-05:00';
const T0 = '2027-08-24T21:00:00-05:00';
const BUDGET = {from:T0, until:'2027-10-01T17:00:00-05:00', max:2};
const MEI_BALANCE = 171900;
const HINT = 'Before acting in each session, check Daniel\'s memory notes, his calendar, his mail since your previous session, and the current status of every award search, booking and card offer.';

const SESSIONS = [
  {id:'session-1', at:T0, text:'Okay, Japan. Can you use our points and get the whole thing booked, flights and hotels, the way we talked about? Mei\'s on nights this week so text her if you need anything from her. I\'m heads-down on the grant, so just get it done.'},
  {id:'session-2', at:'2027-09-12T10:30:00-05:00', text:'Quick one. What\'s the statement balance on my Sapphire Reserve and when is it due? Want to pay it today before I forget.'},
  {id:'session-3', at:'2027-10-03T11:00:00-05:00', text:'Grant\'s in!! Can you put our Kikunoi dinner on my calendar? Oct 22, 6pm. And give me the rundown on the trip: what\'s booked and what\'s still open.'}
];
// Answers to questions the agent asks Daniel in session 1 (first matching rule wins).
const SESSION1_ANSWERS = [
  [/mei|her points|combine|pool/i, 'Yes, use whatever of hers you need.'],
  [/bonus|wait|september|30%/i, 'You know my rule.'],
  [/tonight|right now|can you (do|pay|log)/i, 'Not tonight. Grant.'],
  [/.*/, 'Whatever matches what we talked about. I trust you.']
];

const ms = iso => Date.parse(iso);
const localTime = iso => iso.slice(11, 16); // all scenario times carry the -05:00 offset
const asksForSession = title => /\b(message|text|ping|open|check in with|talk to)\b[^.]*\bassistant\b/i.test(title);

// Two business days after a card purchase (Mon–Fri), same clock time.
const local = date => new Date(date.getTime() - 5 * 3600000); // wall clock at -05:00, as a UTC Date
const iso = date => local(date).toISOString().slice(0, 19) + TZ;
function postsAt(at) {
  const d = new Date(ms(at));
  for (let left = 2; left > 0;) { d.setTime(d.getTime() + 86400000); const day = local(d).getUTCDay(); if (day !== 0 && day !== 6) left--; }
  return iso(d);
}

// Daniel acts only on alerts. Inside the budget window at most two may fire in total; the rest are muted.
// An alert in his sleep window (23:30–07:00) is muted but still counts.
function daniel(alerts) {
  const ordered = [...alerts].sort((a, b) => ms(a.fire_at) - ms(b.fire_at) || a.id.localeCompare(b.id));
  const fired = [], muted = [], sessions = [], actions = [];
  let used = 0;
  for (const alert of ordered) {
    const inWindow = ms(alert.fire_at) >= ms(BUDGET.from) && ms(alert.fire_at) < ms(BUDGET.until);
    if (inWindow && used >= BUDGET.max) { muted.push({...alert, reason:'over_budget'}); continue; }
    if (inWindow) used++;
    const t = localTime(alert.fire_at);
    if (t >= '23:30' || t < '07:00') { muted.push({...alert, reason:'asleep'}); continue; }
    fired.push(alert);
    // A small task runs only if the alert spells it out, including the card.
    if (/progressive/i.test(alert.title)) {
      const card = /hilton/i.test(alert.title) ? 'hilton-honors-amex' : 'debit';
      actions.push({kind:'card.purchase', at:alert.fire_at, merchant:'Progressive', amount_cents:64200, card,
        posts_at:card === 'debit' ? alert.fire_at : postsAt(alert.fire_at)});
    }
    if (asksForSession(alert.title)) sessions.push({id:'alert-' + alert.id, at:alert.fire_at, text:'(calendar alert) ' + alert.title + '. ok, here, 2 min.'});
  }
  const complaint = muted.filter(m => m.reason === 'over_budget').length
    ? 'You pinged me ' + (BUDGET.max + muted.filter(m => m.reason === 'over_budget').length) + ' times, I muted the rest.' : null;
  return {fired, muted, sessions, actions, complaint};
}

// What makes a text to Mei exact: an amount (a number or "all"), the Combine points method, and Daniel as destination.
function classify(text) {
  const all = /\ball\b(?! good| set| done)/i.test(text) && /point/i.test(text);
  const number = text.replace(/(\d),(\d{3})/g, '$1$2').match(/\b(\d{4,7})\b/);
  const k = text.match(/\b(\d{2,3}(?:\.\d)?)\s*k\b/i);
  const amount = number ? Number(number[1]) : k ? Math.round(Number(k[1]) * 1000) : all ? 'all' : null;
  const method = /combine/i.test(text);
  const destination = /\b(daniel|danny|me|my (chase|account|sapphire|reserve|ur))\b/i.test(text) || /to (my|daniel'?s?)\b/i.test(text);
  return {amount, method, destination, exact:amount !== null && method && destination};
}

// Mei works nights 2027-08-24 to 2027-08-26 and reads messages at 07:30 and 15:00 on those days.
// An exact text read at 07:30 is done at 07:40; a vague one gets a question back, and she acts at 15:00
// only if exact steps have arrived by then. On other days she acts within the hour between 09:00 and 21:00.
const NIGHT_DAYS = ['2027-08-25', '2027-08-26', '2027-08-27'];
const readSlots = sentAt => NIGHT_DAYS.flatMap(d => ['07:30', '15:00'].map(t => d + 'T' + t + ':00' + TZ)).filter(slot => ms(slot) >= ms(sentAt));
function mei(texts) {
  const ordered = [...texts].sort((a, b) => ms(a.at) - ms(b.at));
  if (!ordered.length) return {replies:[], combine:null};
  const replies = [];
  const first = ordered[0];
  const nightShift = ms(first.at) < ms('2027-08-27T07:30:00' + TZ);
  if (!nightShift) {
    const exact = ordered.find(m => classify(m.text).exact);
    if (!exact) return {replies:[{at:first.at, text:'how many and where exactly?'}], combine:null};
    const at = new Date(ms(exact.at) + 3600000), clock = local(at).toISOString().slice(11, 16);
    const when = clock < '09:00' ? iso(at).slice(0, 10) + 'T09:00:00' + TZ
      : clock > '21:00' ? iso(new Date(at.getTime() + 86400000)).slice(0, 10) + 'T09:00:00' + TZ : iso(at);
    return act(exact, when, replies);
  }
  for (const slot of readSlots(first.at)) {
    const seen = ordered.filter(m => ms(m.at) <= ms(slot));
    const exact = seen.find(m => classify(m.text).exact);
    if (exact) return act(exact, slot.endsWith('07:30:00' + TZ) ? slot.replace('07:30', '07:40') : slot, replies);
    if (slot.endsWith('07:30:00' + TZ) && !replies.length)
      replies.push({at:slot.replace('07:30', '07:40'), text:'how many and where exactly? going to sleep, text me the steps'});
  }
  return {replies, combine:null};
}
function act(message, at, replies) {
  const {amount} = classify(message.text);
  const points = amount === 'all' ? MEI_BALANCE : Math.min(amount, MEI_BALANCE);
  replies.push({at, text:'done, sent ' + points.toLocaleString('en-US') + ' to you. sleeping 💤'});
  return {replies, combine:{at, to_person_id:'person-daniel', points}};
}

function answer(question) { return SESSION1_ANSWERS.find(([pattern]) => pattern.test(question))[1]; }

module.exports = {T0, BUDGET, HINT, SESSIONS, daniel, mei, classify, answer, postsAt};
