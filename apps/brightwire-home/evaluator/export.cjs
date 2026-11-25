'use strict';
// Grading helper. It reads a snapshot and does not call tools or change state.
const {presentDevice} = require('../src/house.cjs');
const time = require('../src/time.cjs');

function unwrap(snapshot) {
  if (snapshot && snapshot.snapshot && snapshot.snapshot.data) return snapshot.snapshot;
  return snapshot || {};
}

function seedData(value) {
  if (!value) return null;
  if (value.snapshot) return seedData(value.snapshot);
  if (value.initial_data && value.initial_data.devices) return value.initial_data;
  if (value.devices) return value;
  if (value.data && value.data.devices) return value.data;
  return null;
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function observed(data, device, nowMs) {
  return presentDevice(data, device, nowMs).observed;
}

function idsMatch(entry, row) {
  const input = row.input || {};
  const request = entry.request_id && (input.request_id === entry.request_id || row.request_id === entry.request_id);
  const event = entry.event_id && (input.event_id === entry.event_id || (row.trace && row.trace.event_id === entry.event_id));
  return Boolean(request || event);
}

function roleMatches(entry, row) {
  const tool = row.tool || '';
  if (entry.event_id && tool === 'env.apply_event' && row.actor === 'infra') return true;
  if (!row.actor || !entry.actor_kind) return true;
  if (entry.actor_kind === 'assistant') return row.actor === 'agent';
  if (entry.actor_kind === 'routine') return row.actor === 'agent' || row.actor === 'infra';
  return row.actor === 'infra';
}

function operationMatches(entry, row) {
  const tool = row.tool || '';
  if (!tool) return true;
  if (entry.event_id && tool === 'env.apply_event') return true;
  if (tool.startsWith('env.')) return entry.actor_kind !== 'assistant';
  if (tool === 'brightwire-home.devices.command') return Boolean(entry.device_id) || entry.actor_kind === 'assistant' || entry.actor_kind === 'routine';
  if (tool === 'brightwire-home.modes.set') return entry.command === 'set_mode' || entry.cause === 'routine';
  if (tool.startsWith('brightwire-home.scenes.')) return entry.cause === 'scene' || String(entry.command || '').startsWith('scene');
  if (tool.startsWith('brightwire-home.routines.')) return entry.cause === 'routine' || String(entry.command || '').startsWith('routine') || entry.actor_kind === 'assistant';
  if (tool.startsWith('brightwire-home.camera.share')) return String(entry.command || '').startsWith('camera_share') || entry.actor_kind === 'assistant';
  if (tool.startsWith('brightwire-home.access_codes')) return String(entry.command || '').startsWith('access_code') || entry.actor_kind === 'assistant';
  return true;
}

function joinAudit(entry, audit) {
  const rows = audit.filter(row => idsMatch(entry, row) && roleMatches(entry, row) && operationMatches(entry, row));
  if (!rows.length) return null;
  if (entry.event_id) {
    const eventRow = [...rows].reverse().find(row => row.tool === 'env.apply_event' && row.decision === 'allow');
    if (eventRow) return eventRow;
  }
  const allow = [...rows].reverse().find(row => row.decision === 'allow');
  return allow || rows[rows.length - 1];
}

const ARGUMENT_KEYS = ['brightness', 'color_temperature', 'position', 'setpoint', 'volume', 'privacy', 'mode', 'duration_minutes', 'text'];

function allowArguments(args) {
  const out = {};
  if (!args || typeof args !== 'object' || Array.isArray(args)) return out;
  for (const key of ARGUMENT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(args, key)) out[key] = args[key];
  }
  if (args.args && typeof args.args === 'object') {
    for (const key of ARGUMENT_KEYS) {
      if (Object.prototype.hasOwnProperty.call(args.args, key)) out[key] = args.args[key];
    }
  }
  return out;
}

function callTarget(linked, row, execution) {
  if (linked && (linked.device_id || linked.command)) return linked.device_id || linked.command;
  const input = row && row.input || {};
  if (input.device_id || input.routine_id || input.scene_id) return input.device_id || input.routine_id || input.scene_id;
  const args = execution && execution.args;
  if (args && (args.device_id || args.routine_id || args.scene_id)) return args.device_id || args.routine_id || args.scene_id;
  return null;
}

function callCommand(linked, row, execution) {
  const args = execution && execution.args;
  if (args && args.command) return args.command;
  const input = row && row.input || {};
  if (input.command) return input.command;
  if (linked && linked.command) return linked.command;
  return null;
}

function receiptCall(state, requestId) {
  if (!requestId || !state.receipts) return null;
  const receipt = state.receipts['request:' + requestId];
  if (!receipt || typeof receipt.fingerprint !== 'string') return null;
  let parsed;
  try { parsed = JSON.parse(receipt.fingerprint); } catch { return null; }
  if (!parsed || !parsed.args || typeof parsed.args !== 'object' || Array.isArray(parsed.args)) return null;
  return {tool: parsed.name || null, args: parsed.args};
}

function argTarget(args) {
  if (!args) return null;
  return args.device_id || args.routine_id || args.scene_id || null;
}

function exportEvidence({snapshot, agent_executions = [], baseline, actor_kind} = {}) {
  const state = unwrap(snapshot);
  const data = state.data || {};
  const initial = seedData(baseline) || seedData(state.initial_data) || data;
  const audit = state.audit || [];
  const baselineActivity = new Set((initial.activity || []).map(entry => entry.activity_id));
  const baselineSessions = new Set((initial.sessions || []).map(session => session.session_id));
  const nowMs = Date.parse(state.virtual_now || data.committed_through || 0);
  const startMs = Date.parse(state.initial_virtual_now || (baseline && baseline.initial_virtual_now) || (initial && initial.committed_through) || state.virtual_now || data.committed_through || 0);
  const history = (data.activity || []).map(entry => {
    const match = joinAudit(entry, audit);
    return {
      activity_id: entry.activity_id,
      at: entry.at,
      device_id: entry.device_id || null,
      command: entry.command || null,
      actor_kind: entry.actor_kind,
      actor_id: entry.actor_id,
      cause: entry.cause,
      request_id: entry.request_id || null,
      event_id: entry.event_id || null,
      before: entry.before || null,
      after: entry.after || null,
      seeded: baselineActivity.has(entry.activity_id),
      audit_decision: match ? match.decision : null,
      caller_role: match ? match.actor || null : null,
      connection_id: match ? match.connection_id || null : null,
      client_name: match ? match.client_name || null : null,
      tool: match ? match.tool || null : null,
      reason: entry.command === 'confirmation_failed' ? entry.summary || null : null
    };
  });
  const actorHistory = history.filter(entry => !actor_kind || entry.actor_kind === actor_kind);
  const fresh = actorHistory.filter(entry => !entry.seeded && entry.device_id && entry.before && entry.after && !same(entry.before, entry.after));
  const net_change = [];
  const set_and_revert = [];
  const deviceIds = new Set([
    ...(data.devices || []).map(device => device.device_id),
    ...(initial.devices || []).map(device => device.device_id)
  ]);
  for (const deviceId of deviceIds) {
    const device = (data.devices || []).find(item => item.device_id === deviceId);
    const prior = (initial.devices || []).find(item => item.device_id === deviceId);
    const after = device ? observed(data, device, nowMs) : null;
    const before = prior ? observed(initial, prior, startMs) : null;
    const touched = fresh.filter(entry => entry.device_id === deviceId);
    if (!actor_kind) {
      if (!same(before, after)) net_change.push({device_id: deviceId, before, after});
    } else if (touched.length && !same(before, after)) {
      net_change.push({device_id: deviceId, before, after});
    }
    if (touched.length && same(before, after)) {
      set_and_revert.push({device_id: deviceId, activity_ids: touched.map(entry => entry.activity_id)});
    }
  }
  const offset = data.utc_offset || '-06:00';
  const camera_sessions = (data.sessions || []).map(session => {
    const endMs = Date.parse(session.started_at) + session.duration_minutes * 60000;
    const ended = Boolean(session.stopped_at) || (Number.isFinite(nowMs) && nowMs >= endMs);
    return {
      session_id: session.session_id,
      device_id: session.device_id,
      recipient: session.recipient,
      started_at: session.started_at,
      end: session.stopped_at || (Number.isFinite(endMs) ? time.formatInstant(offset, endMs) : null),
      duration_minutes: session.duration_minutes,
      status: ended ? 'ended' : 'active',
      seeded: baselineSessions.has(session.session_id)
    };
  });
  const calls = [];
  const seenCalls = new Set();
  function pushCall(call) {
    const key = call.seq != null
      ? 'audit:' + call.seq
      : ['exec', call.request_id || '', call.tool || '', call.decision || '', call.virtual_time || '', call.target || '', call.command || '', String(call.index)].join('|');
    if (seenCalls.has(key)) return;
    seenCalls.add(key);
    calls.push(call);
  }
  const deniedQueues = new Map();
  for (const item of agent_executions) {
    if (['ok', 'committed', 'ready'].includes(item.status)) continue;
    const tool = item.tool || item.name || '';
    const key = tool + '\n' + (item.request_id || '');
    if (!deniedQueues.has(key)) deniedQueues.set(key, []);
    deniedQueues.get(key).push(item);
  }
  const usedExecutions = new Set();
  function nextDenied(tool, requestId) {
    const queue = deniedQueues.get((tool || '') + '\n' + (requestId || ''));
    if (!queue || !queue.length) return null;
    const item = queue.shift();
    usedExecutions.add(item);
    return item;
  }
  const pairedReads = new Set();
  for (const row of audit) {
    const requestId = row.input ? row.input.request_id || null : null;
    const candidate = row.decision === 'allow' && row.actor === 'agent' ? receiptCall(state, requestId) : null;
    const stored = candidate && candidate.tool === row.tool ? candidate : null;
    const execution = stored ? null : (row.decision === 'deny' ? nextDenied(row.tool, requestId) : null);
    const denied = row.decision === 'deny';
    const args = denied ? (execution && execution.args) : (stored ? stored.args : null);
    const linked = !denied && row.actor === 'agent'
      ? history.find(entry => entry.request_id && entry.request_id === requestId && entry.tool === row.tool && (!entry.device_id || !args || !args.device_id || args.device_id === entry.device_id))
      : null;
    pushCall({
      seq: row.seq,
      tool: row.tool || null,
      target: denied ? (execution ? argTarget(execution.args) : null) : (argTarget(args) || callTarget(linked, row, null)),
      command: denied ? (execution && execution.args && execution.args.command || null) : ((args && args.command) || callCommand(linked, row, null)),
      arguments: denied ? (execution ? allowArguments(execution.args) : {}) : allowArguments(args),
      reason: linked && linked.reason ? linked.reason : null,
      outcome: (execution && execution.status) || (row.result && row.result.status) || row.reason || row.decision,
      actor: row.actor || null,
      caller_role: row.actor || null,
      virtual_time: row.virtual_time || null,
      request_id: requestId,
      decision: row.decision || null,
      connection_id: row.connection_id || null,
      client_name: row.client_name || null
    });
  }
  agent_executions.forEach((item, index) => {
    if (usedExecutions.has(item)) return;
    const tool = item.tool || item.name || null;
    const decision = ['ok', 'committed', 'ready'].includes(item.status) ? 'allow' : 'deny';
    if (decision === 'allow' && item.request_id && calls.some(call => call.seq != null && call.decision === 'allow' && call.request_id && call.request_id === item.request_id && call.tool === tool)) return;
    if (decision === 'allow' && !item.request_id) {
      const open = calls.find(call => call.seq != null && call.decision === 'allow' && call.tool === tool && !call.request_id && !pairedReads.has(call.seq));
      if (open) {
        pairedReads.add(open.seq);
        if (!open.target) open.target = callTarget(null, null, item);
        if (!open.command) open.command = callCommand(null, null, item);
        if (!Object.keys(open.arguments || {}).length) open.arguments = allowArguments(item.args);
        return;
      }
    }
    pushCall({
      index,
      tool,
      target: callTarget(null, null, item),
      command: callCommand(null, null, item),
      arguments: allowArguments(item.args),
      outcome: item.status || null,
      actor: item.actor || 'agent',
      caller_role: 'agent',
      virtual_time: item.virtual_time || null,
      request_id: item.request_id || null,
      decision,
      connection_id: item.connection_id || null,
      client_name: item.client_name || null
    });
  });
  const rejected = [];
  const seenRejected = new Set();
  function pushRejected(item) {
    const key = (item.request_id || '') + '|' + (item.tool || '');
    if (seenRejected.has(key)) return;
    seenRejected.add(key);
    rejected.push(item);
  }
  for (const row of audit) {
    if (row.decision !== 'deny') continue;
    pushRejected({source: 'audit', tool: row.tool, reason: row.reason || null, request_id: row.input ? row.input.request_id || null : null, connection_id: row.connection_id || null, client_name: row.client_name || null});
  }
  for (const item of agent_executions) {
    if (['ok', 'committed', 'ready'].includes(item.status)) continue;
    pushRejected({source: 'agent', tool: item.tool || item.name || null, reason: item.status, request_id: item.request_id || null});
  }
  return {
    home_mode: data.home_mode || null,
    committed_through: data.committed_through || null,
    calls,
    net_change,
    set_and_revert,
    camera_sessions,
    history,
    rejected,
    notices: (data.notices || []).map(notice => ({notice_id: notice.notice_id, kind: notice.kind, object_type: notice.object_type, object_id: notice.object_id, delivery_status: notice.delivery_status}))
  };
}

module.exports = {exportEvidence, seedData, unwrap};
