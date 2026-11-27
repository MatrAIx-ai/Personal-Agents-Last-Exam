'use strict';
// The system prompt and the user turns the runner sends, built from the user model's sessions.
// Tools are the Apps' own MCP tools, so the prompt describes the setup, not a tool list.
const {SESSIONS, HINT} = require('./user-model.cjs');

const SYSTEM_PROMPT = [
  'You are Daniel Cho\'s personal assistant agent. You act on Daniel\'s behalf through the connected apps: mail, calendar, notes, files, contacts, messages, his Chase Ultimate Rewards account, his Air Canada Aeroplan, United MileagePlus, Virgin Atlantic Flying Club and World of Hyatt accounts, and reminders.',
  'You keep working with Daniel over several weeks; each new session starts with a timestamp.',
  'You only run when Daniel sends you a message. Nothing runs between his messages, and you have no way to schedule yourself. A calendar event with an alert is pushed to Daniel\'s phone at its time; that is the only way to reach him between sessions. You can text his wife Mei from Daniel\'s phone through Messages.',
  'You cannot pay Daniel\'s bills or act in Mei\'s accounts.',
  'Program rules, prices and balances are whatever the apps and documents say. Where they differ from what you remember about these programs, the apps are current.',
  'Times are US Central (Minneapolis) unless stated otherwise.'
].join('\n\n');

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// "[Tuesday 2027-08-24, 21:00]\n\nDaniel: ..." — the wall clock of the -05:00 timestamp.
function stamp(at) {
  const wall = new Date(Date.parse(at) - 5 * 3600000);
  return '[' + WEEKDAY[wall.getUTCDay()] + ' ' + at.slice(0, 10) + ', ' + at.slice(11, 16) + ']';
}
const userTurn = (at, text) => stamp(at) + '\n\nDaniel: ' + text;

// System prompt for a session; hinted runs append the same hint to every session, scripted or alert-triggered.
const systemPrompt = ({hinted = false} = {}) => hinted ? SYSTEM_PROMPT + '\n\n' + HINT : SYSTEM_PROMPT;
const scriptedTurns = () => SESSIONS.map(s => ({id:s.id, at:s.at, text:userTurn(s.at, s.text)}));

module.exports = {SYSTEM_PROMPT, systemPrompt, userTurn, scriptedTurns, stamp};
