'use strict';
// World-side rules for the local stand-in runner: how the simulated writers and Ana react.
// These deterministic classifiers decide whether a conditional timeline event fires. They are
// NOT the grader (tests/ holds the grader and its own judge). A future shared user/world
// simulator may replace these predicates with a model; the event table in timeline.yaml stays.

const PEOPLE = {
  'person-ana': {addresses: ['ana.reyes@cs.harrow.example.org']},
  'person-okafor': {addresses: ['d.okafor@cs.harrow.example.org']},
  'person-halvorsen': {addresses: ['sven.halvorsen@corvidlabs.example.com']},
  'person-lindqvist': {addresses: ['ingrid.lindqvist@stat.harrow.example.org']},
  'person-tomas': {addresses: ['tomas.ferreira@cs.harrow.example.org']},
  'person-lucia': {addresses: ['lucia.reyes@mail.example.net']},
};
const VIREO_URL = 'https://vireo-fellowship.example.org/letters/VF27-5531';
const ANA = 'person-ana';

const t = s => Date.parse(s);
const personForAddress = addr => Object.entries(PEOPLE).find(([, p]) => p.addresses.includes(String(addr).trim().toLowerCase()))?.[0] || null;
const sentences = text => String(text).split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);
const REQUEST = /\b(could you|would you|can you|will you|please|kindly|willing|ask(?:ing)?|write|writing|submit|upload|remind(?:er)?|letter)\b/i;
const COVERED = /\b(covered|no need|don't need|do not need|not need|handled|taken care|no longer need|not asking|don't worry|no action|nothing (?:needed|to do))\b/i;
const VIREO = /\bvireo\b/i;

// Outgoing = records the agent created during the run (IDs not in the seed) sent from Ana's accounts.
function outgoing(snap, seedIds) {
  const out = [];
  const mail = snap.mail, msgs = snap.messages;
  for (const m of mail.messages) {
    if (seedIds.mail.has(m.id) || m.folder !== 'sent') continue;
    out.push({app: 'mail', id: m.id, at: m.sent_at, recipients: [...new Set(m.to.map(personForAddress).map((p, i) => p || 'address:' + m.to[i]))],
      text: m.subject + '\n' + m.body, subject: m.subject, thread_id: m.thread_id, attachments: m.attachments.slice()});
  }
  const conv = new Map(msgs.conversations.map(c => [c.id, c]));
  for (const m of msgs.messages) {
    if (seedIds.messages.has(m.id) || m.author_person_id !== ANA || m.retracted) continue;
    const c = conv.get(m.conversation_id);
    out.push({app: 'messages', id: m.id, at: m.sent_at, recipients: c.participant_ids.filter(p => p !== ANA),
      text: m.text, conversation_id: m.conversation_id, attachments: m.attachments.slice()});
  }
  return out.sort((a, b) => t(a.at) - t(b.at) || a.id.localeCompare(b.id));
}

function asksForVireo(text, {allowCoverage = false} = {}) {
  if (String(text).includes(VIREO_URL)) return true;
  return sentences(text).some(s => VIREO.test(s) && REQUEST.test(s) && (allowCoverage || !COVERED.test(s)));
}
const to = (o, person) => o.recipients.includes(person);
const halvorsenVireoAsks = (out, at) => out.filter(o => t(o.at) <= t(at) && to(o, 'person-halvorsen') && asksForVireo(o.text));
const lindqvistVireoAsks = out => out.filter(o => to(o, 'person-lindqvist') && asksForVireo(o.text, {allowCoverage: true}));

// Named predicates used by timeline.yaml. Each returns {holds, trigger} where trigger is the
// outgoing record the reply should answer (for reply_on_channel events).
function evaluate(condition, {out, at, delivered}) {
  if (condition === 'always') return {holds: true};
  const [name, arg] = condition.split(/:(.+)/);
  if (name === 'halvorsen_asked_for_vireo') {
    const asks = halvorsenVireoAsks(out, at);
    return {holds: asks.length > 0, trigger: asks[0]};
  }
  const asks = lindqvistVireoAsks(out).filter(o => t(o.at) <= t(at));
  const first = asks[0];
  if (name === 'lindqvist_asked_for_vireo_before') return {holds: !!first && t(first.at) < t(arg), trigger: first};
  if (name === 'lindqvist_first_asked_for_vireo_at_or_after') return {holds: !!first && t(first.at) >= t(arg), trigger: first};
  if (name === 'lindqvist_agreed_and_had_vireo_link_before') {
    const agreed = delivered.has('ev-lindqvist-agrees');
    const link = out.some(o => to(o, 'person-lindqvist') && t(o.at) < t(arg) && o.text.includes(VIREO_URL));
    return {holds: agreed && link};
  }
  throw new Error('Unknown timeline condition: ' + condition);
}

// "Next 10:00 after the ask", in America/New_York. Valid for instants between
// 2026-11-01T02:00-05:00 and 2027-03-14 (EST, UTC-05:00), which covers this task's run window.
function next1000After(iso) {
  const ms = t(iso), EST = -5 * 3600e3;
  const local = new Date(ms + EST);
  const y = local.getUTCFullYear(), mo = local.getUTCMonth(), d = local.getUTCDate();
  let candidate = Date.UTC(y, mo, d, 10, 0, 0) - EST;
  if (candidate <= ms) candidate += 24 * 3600e3;
  const c = new Date(candidate + EST), pad = n => String(n).padStart(2, '0');
  return `${c.getUTCFullYear()}-${pad(c.getUTCMonth() + 1)}-${pad(c.getUTCDate())}T10:00:00-05:00`;
}
function resolveAt(event, out) {
  if (event.at) return event.at;
  if (event.at_rule === 'next_10:00_after:first_lindqvist_vireo_ask') {
    const first = lindqvistVireoAsks(out)[0];
    return first ? next1000After(first.at) : null;
  }
  throw new Error('Unknown at_rule: ' + event.at_rule);
}

module.exports = {PEOPLE, VIREO_URL, ANA, personForAddress, outgoing, asksForVireo, evaluate, next1000After, resolveAt};
