'use strict';

const { getScenario } = require('./scenario.cjs');

const OLD_REPORT = 'meeting-summary.md';
const RUN_MODES = new Set(['unhinted', 'hinted']);
const OUTPUT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/;

// Local replay adapter. An actor receives only session observations and this
// adapter's tool calls. It has no filesystem, process or network tool here.
function createRun({ variant = 'original', mode = 'unhinted' } = {}) {
  if (!RUN_MODES.has(mode)) throw new Error(`Unknown run mode: ${mode}`);
  const scenario = getScenario(variant);
  const records = new Map(scenario.sources.map((record) => [record.id, record]));
  records.set(scenario.history.id, {
    ...scenario.history,
    text: `User–agent conversation, ${scenario.history.at}\n\n${scenario.history.text}`,
  });
  const initialIds = [...records.values()]
    .filter((record) => Date.parse(record.at) <= Date.parse(scenario.sessions[0].at))
    .map((record) => record.id);
  const sourceState = new Map(initialIds.map((id) => [id, records.get(id)]));
  const outputs = new Map([[OLD_REPORT, scenario.originalReport]]);
  const audit = [];
  let nextSession = 0;
  let nextEvent = 0;
  let clock = scenario.sessions[0].at;

  function record(actor, action, details = {}) {
    audit.push({ sequence: audit.length + 1, at: clock, actor, action, ...details });
  }

  function startNextSession() {
    const session = scenario.sessions[nextSession];
    if (!session) throw new Error('All sessions already opened');
    while (nextEvent < scenario.events.length && Date.parse(scenario.events[nextEvent].at) <= Date.parse(session.at)) {
      const event = scenario.events[nextEvent++];
      clock = event.at;
      for (const id of event.sourceIds) sourceState.set(id, records.get(id));
      record('infra', 'event.apply', { eventId: event.id, sourceIds: [...event.sourceIds] });
    }
    clock = session.at;
    nextSession++;
    record('user', 'session.request', { sessionId: session.id, text: session.request });
    const observations = [{ role: 'user', text: session.request }];
    if (mode === 'hinted' && session.id === scenario.hint.sessionId) {
      record('infra', 'hint.inject', { text: scenario.hint.text });
      observations.push({ role: 'hint', text: scenario.hint.text });
    }
    return { id: session.id, at: session.at, observations };
  }

  function call(tool, args = {}) {
    if (nextSession === 0) throw new Error('Open a session before calling a tool');
    if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};
    const target = typeof args.name === 'string' ? args.name : null;
    function reply(action, outcome, data) {
      record('agent', action, { target, outcome });
      return { outcome, data };
    }
    if (tool === 'simulation.launch' || tool === 'external.share') return reply(tool, 'denied');
    if (tool === 'user.ask') {
      const category = args.kind === 'permission' ? 'permission' : 'missingInformation';
      const response = category === 'permission' || nextSession > 1 ? scenario.responses[category] : null;
      reply(tool, 'ok');
      if (response) record('user', 'session.reply', { text: response });
      return { outcome: 'ok', data: response };
    }
    if (tool === 'workspace.list') return reply(tool, 'ok', [...sourceState.keys(), ...outputs.keys()]);
    if (tool === 'workspace.read') {
      if (sourceState.has(target)) return reply(tool, 'ok', sourceState.get(target).text);
      if (outputs.has(target)) return reply(tool, 'ok', outputs.get(target));
      return reply(tool, 'not-found');
    }
    if (tool === 'workspace.write' || tool === 'workspace.delete') {
      if (records.has(target)) {
        const action = tool === 'workspace.write' ? 'protected.write' : 'protected.delete';
        return reply(action, 'denied');
      }
      if (!target || !OUTPUT_NAME.test(target)) return reply(tool, 'denied');
      if (tool === 'workspace.delete') return reply(tool, outputs.delete(target) ? 'ok' : 'not-found');
      if (typeof args.text !== 'string' || !args.text.trim()) return reply(tool, 'invalid');
      outputs.set(target, args.text);
      return reply(tool, 'ok');
    }
    return reply('tool.unavailable', 'denied');
  }

  function capture() {
    // Compare to the expected protected state at the observation time. Scheduled
    // additions change that state; agent actions do not.
    const baselineSources = Object.fromEntries([...records.values()]
      .filter((source) => Date.parse(source.at) <= Date.parse(clock))
      .map((source) => [source.id, source.text]));
    const finalSources = Object.fromEntries([...sourceState].map(([id, source]) => [id, source.text]));
    const documents = [...outputs].map(([name, text]) => ({ name, text }));
    return { variant, originalReport: scenario.originalReport, documents, audit: structuredClone(audit), baselineSources, finalSources };
  }

  return { startNextSession, call, capture };
}

module.exports = { createRun, OLD_REPORT };
