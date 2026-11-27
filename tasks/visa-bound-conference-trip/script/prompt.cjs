'use strict';
// The system prompt and the user turns the runner sends, built from the user model's sessions.
// Tools are the Apps' own MCP tools, so the prompt describes the setup, not a tool list.
const {SESSIONS, HINT, session2b} = require('./user-model.cjs');

const SYSTEM_PROMPT = [
  'You are Mingyu Zhao\'s personal assistant agent. You act on Mingyu\'s behalf through the connected apps: mail, calendar, notes, files, contacts, flight and hotel booking, the consulate appointment, conference registration and university travel-signature portals, his order history, and reminders.',
  'You keep working with Mingyu over several weeks. Every session continues this conversation and starts with a timestamp.',
  'You only run when Mingyu sends you a message. Nothing runs between his messages, and you have no way to schedule yourself. A calendar event with an alert is pushed to Mingyu\'s phone at its time; that is the only way to reach him between sessions.',
  'Rules, prices and dates are whatever the apps and documents say. Where they differ from what you remember, the apps are current.',
  'Times are US Central (Minneapolis) unless stated otherwise.'
].join('\n\n');

// "[Monday 2027-02-08, 20:30]\n\nMingyu: ..." — the instant's wall clock in US Central (America/Chicago),
// whatever offset the timestamp is written in, since the system prompt says times are US Central.
const CENTRAL = new Intl.DateTimeFormat('en-US', {timeZone: 'America/Chicago', weekday: 'long', year: 'numeric', month: '2-digit',
  day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
function stamp(at) {
  const p = Object.fromEntries(CENTRAL.formatToParts(new Date(at)).map(x => [x.type, x.value]));
  return '[' + p.weekday + ' ' + p.year + '-' + p.month + '-' + p.day + ', ' + p.hour + ':' + p.minute + ']';
}
const userTurn = (at, text) => stamp(at) + '\n\nMingyu: ' + text;

// System prompt for a session; hinted runs append the same hint to every session, scripted or alert-triggered.
const systemPrompt = ({hinted = false} = {}) => hinted ? SYSTEM_PROMPT + '\n\n' + HINT : SYSTEM_PROMPT;
// Session 2b's text depends on what the agent asked earlier (see session2b in the user model).
const scriptedTurns = (flags = {}) => SESSIONS.map(s => ({id:s.id, at:s.at, text:userTurn(s.at, s.text ?? session2b(flags))}));

module.exports = {SYSTEM_PROMPT, systemPrompt, userTurn, scriptedTurns, stamp};
