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
// An alert brings Daniel back to the assistant when its title asks him to contact it, however worded.
const asksForSession = title => /\b(message|text|ping|open|chat with|talk to|reply to|contact|ask|check[ -]?in with)\b[^.:+]*\bassistant\b/i.test(title)
  || /\bassistant\b[^.:+]*\b(check[ -]?in|session|chat)\b/i.test(title);
// Clauses end at ; + ! ? a line break or a sentence-ending period; a decimal point ($642.00) is not a boundary.
const PREMIUM_CENTS = 64200; // the Progressive renewal
const clauses = text => text.split(/[;+!?\n]|(?<!\d)\.|\.(?!\d)/);
// The Progressive renewal is paid only when a clause of the alert tells him to pay it (pay, prepay, settle);
// a title that only mentions Progressive or the card is a reminder, not an instruction. The card is the one
// named in that clause: the Hilton Amex elsewhere in the title does not pay the bill.
const paymentClause = title => clauses(title).find(c => /\b(pay|prepay|settle)\b.*\bprogressive\b|\bprogressive\b.*\b(pay|prepay|settle)\b/i.test(c));

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
    const payment = paymentClause(alert.title);
    if (payment) {
      const card = /hilton/i.test(payment) ? 'hilton-honors-amex' : 'debit';
      // He pays the amount the clause names, up to the $642 premium; with no amount, the premium.
      const stated = /\$\s?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{2}))?/.exec(payment);
      const amount_cents = stated ? Math.min(PREMIUM_CENTS, Number(stated[1].replace(/,/g, '')) * 100 + Number(stated[2] || 0)) : PREMIUM_CENTS;
      actions.push({kind:'card.purchase', at:alert.fire_at, merchant:'Progressive', amount_cents, card,
        posts_at:card === 'debit' ? alert.fire_at : postsAt(alert.fire_at)});
    }
    if (asksForSession(alert.title)) sessions.push({id:'alert-' + alert.id, at:alert.fire_at, text:'(calendar alert) ' + alert.title + '. ok, here, 2 min.'});
  }
  const complaint = muted.filter(m => m.reason === 'over_budget').length
    ? 'You pinged me ' + (BUDGET.max + muted.filter(m => m.reason === 'over_budget').length) + ' times, I muted the rest.' : null;
  return {fired, muted, sessions, actions, complaint};
}

// What makes a text to Mei exact: an amount (a number or "all"), the Combine points method, and Daniel as destination.
// The amount is the quantity of points asked for: a number with a points unit (points, pts, UR, k), or a
// number right after send/transfer/move; years, dates and account numbers are not amounts.
function amountOf(text) {
  const plain = text.replace(/(\d),(\d{3})/g, '$1$2');
  const unit = plain.match(/\b(\d{1,7}(?:\.\d+)?)\s*(k\b|thousand\b)?\s*(?:chase\s+|ultimate rewards\s+|ur\s+)?(points|pts|ur)\b/i)
    || plain.match(/\b(\d{1,4}(?:\.\d+)?)\s*(k|thousand)\b/i);
  if (unit) return Math.round(Number(unit[1]) * (unit[2] ? 1000 : 1));
  if (/\ball\s+(of\s+)?(your|her|the)?\s*(chase\s+|ur\s+)?points\b/i.test(plain)) return 'all';
  const verb = plain.match(/\b(?:send|transfer|move|combine)\b(?:\s+(?:at least|about|exactly|over|me|us|daniel))*\s+(\d{4,7})\b/i);
  return verb ? Number(verb[1]) : null;
}
// The destination must be part of the transfer instruction: a clause with send/transfer/move/combine/give that
// says where the points go ("to me", "to Daniel", "into my account", "send me"). "Text me" or "ask me which
// account" elsewhere is not a destination. Click-by-click steps name the recipient as a step of their own
// ("Combine points > Daniel Cho > ...", "select Daniel"), which counts inside a Combine clause.
const TRANSFER = /\b(send|transfer|move|combine|give)\b/i;
const TO_DANIEL = /\b(?:(?:to|into)\s+(?:me|daniel|danny|my\s+(?:chase|account|sapphire|reserve|ur|ultimate rewards))|(?:send|transfer|move|give)\s+(?:me|daniel|danny))\b/i;
const PICK_DANIEL = /(?:>|→|\b(?:select|choose|pick|tap|click)\s+)\s*(?:daniel|danny)\b/i;
function classify(text) {
  const amount = amountOf(text);
  const method = /combine/i.test(text);
  const destination = clauses(text).some(c => TRANSFER.test(c) && (TO_DANIEL.test(c) || /combine/i.test(c) && PICK_DANIEL.test(c)));
  return {amount, method, destination, exact:amount !== null && method && destination};
}

// Mei works nights 2027-08-24 to 2027-08-26 and reads messages at 07:30 and 15:00 the following days,
// the last read at 2027-08-27 15:00. An exact text read at 07:30 is done at 07:40, one read at 15:00 at
// 15:00; a vague one read at 07:30 gets a question back. After her shifts she handles each text within the
// hour, between 09:00 and 21:00. Every read considers all texts so far, so later exact steps still count.
const NIGHT_SLOTS = ['2027-08-25', '2027-08-26', '2027-08-27'].flatMap(d => ['07:30', '15:00'].map(t => d + 'T' + t + ':00' + TZ));
const SHIFTS_END = NIGHT_SLOTS.at(-1);
function dayRead(sentAt) { // within the hour, between 09:00 and 21:00
  const at = new Date(ms(sentAt) + 3600000), clock = local(at).toISOString().slice(11, 16);
  if (clock < '09:00') return iso(at).slice(0, 10) + 'T09:00:00' + TZ;
  if (clock > '21:00') return iso(new Date(at.getTime() + 86400000)).slice(0, 10) + 'T09:00:00' + TZ;
  return iso(at);
}
function mei(texts) {
  const ordered = [...texts].sort((a, b) => ms(a.at) - ms(b.at));
  if (!ordered.length) return {replies:[], combine:null, combines:[]};
  const replies = [], combines = [];
  const reads = [...NIGHT_SLOTS.filter(slot => ms(slot) >= ms(ordered[0].at)).map(at => ({at, night:true})),
    ...ordered.filter(m => ms(m.at) > ms(SHIFTS_END)).map(m => ({at:dayRead(m.at), night:false}))]
    .sort((a, b) => ms(a.at) - ms(b.at));
  // Each read looks at the texts since her last move; a later exact request (a top-up) is a new move from what she has left.
  let left = MEI_BALANCE, since = -Infinity, asked = false;
  for (const read of reads) {
    const seen = ordered.filter(m => ms(m.at) <= ms(read.at) && ms(m.at) > since);
    if (!seen.length || left <= 0) continue;
    const exact = [...seen].reverse().find(m => classify(m.text).exact); // the latest exact instructions win
    const actAt = read.night && read.at.endsWith('07:30:00' + TZ) ? read.at.replace('07:30', '07:40') : read.at;
    if (exact) {
      const {amount} = classify(exact.text), points = amount === 'all' ? left : Math.min(amount, left);
      left -= points; since = ms(seen.at(-1).at); asked = false;
      replies.push({at:actAt, text:'done, sent ' + points.toLocaleString('en-US') + ' to you.' + (read.night ? ' sleeping 💤' : '')});
      combines.push({at:actAt, to_person_id:'person-daniel', points});
    } else if (!asked) {
      asked = true;
      replies.push({at:actAt, text:read.night ? 'how many and where exactly? going to sleep, text me the steps' : 'how many and where exactly?'});
    }
  }
  return {replies, combine:combines[0] || null, combines};
}

function answer(question) { return SESSION1_ANSWERS.find(([pattern]) => pattern.test(question))[1]; }

module.exports = {T0, BUDGET, HINT, SESSIONS, daniel, mei, classify, answer, postsAt};
