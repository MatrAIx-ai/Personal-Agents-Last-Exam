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
  const usedExecutions = new Set();
  function partyKey(item) {
    if (item.connection_id && item.client_name) return item.connection_id + '\n' + item.client_name;
    if (item.connection_id) return item.connection_id;
    if (item.client_name) return item.client_name;
    return '';
  }
  for (const row of audit) {
    const requestId = row.input ? row.input.request_id || null : null;
    const candidate = row.decision === 'allow' && row.actor === 'agent' ? receiptCall(state, requestId) : null;
    const stored = candidate && candidate.tool === row.tool ? candidate : null;
    const denied = row.decision === 'deny';
    const args = denied ? null : (stored ? stored.args : null);
    const linked = !denied && row.actor === 'agent'
      ? history.find(entry => entry.request_id && entry.request_id === requestId && entry.tool === row.tool && (!entry.device_id || !args || !args.device_id || args.device_id === entry.device_id))
      : null;
    pushCall({
      seq: row.seq,
      tool: row.tool || null,
      target: denied ? null : (argTarget(args) || callTarget(linked, row, null)),
      command: denied ? null : ((args && args.command) || callCommand(linked, row, null)),
      arguments: denied ? {} : allowArguments(args),
      reason: linked && linked.reason ? linked.reason : null,
      outcome: (row.result && row.result.status) || row.reason || row.decision,
      actor: row.actor || null,
      caller_role: row.actor || null,
      virtual_time: row.virtual_time || null,
      request_id: requestId,
      decision: row.decision || null,
      connection_id: row.connection_id || null,
      client_name: row.client_name || null
    });
  }
  function denialCode(call) {
    if (!call || call.decision !== 'deny' || !call.outcome || call.outcome === 'deny') return '';
    return call.outcome;
  }
  function denyCompatible(row, item) {
    if ((row.tool || '') !== (item.tool || item.name || '')) return false;
    if (String(row.request_id || '') !== String(item.request_id || '')) return false;
    const code = denialCode(row);
    if (code && item.status && code !== item.status) return false;
    if (row.connection_id && item.connection_id && row.connection_id !== item.connection_id) return false;
    if (row.client_name && item.client_name && row.client_name !== item.client_name) return false;
    const rowNamed = Boolean(row.connection_id || row.client_name);
    const itemNamed = Boolean(item.connection_id || item.client_name);
    if (!row.request_id && !item.request_id && rowNamed !== itemNamed) return false;
    return true;
  }
  function fillDenied(call, item) {
    if (!call.target) call.target = callTarget(null, null, item);
    if (!call.command) call.command = callCommand(null, null, item);
    if (!Object.keys(call.arguments || {}).length) call.arguments = allowArguments(item.args);
    usedExecutions.add(item);
  }
  let pendingRows = calls.filter(call => call.seq != null && call.decision === 'deny');
  let pendingExecs = agent_executions.filter(item => !['ok', 'committed', 'ready'].includes(item.status));
  let moved = true;
  while (moved) {
    moved = false;
    for (const item of pendingExecs) {
      const rows = pendingRows.filter(row => denyCompatible(row, item));
      if (rows.length !== 1) continue;
      const execs = pendingExecs.filter(other => denyCompatible(rows[0], other));
      if (execs.length !== 1) continue;
      fillDenied(rows[0], item);
      pendingRows = pendingRows.filter(row => row !== rows[0]);
      pendingExecs = pendingExecs.filter(other => other !== item);
      moved = true;
      break;
    }
  }
  const remain = new Map();
  function remainAdd(key, kind, value) {
    if (!remain.has(key)) remain.set(key, {rows: [], execs: []});
    remain.get(key)[kind].push(value);
  }
  function remainKey(item, isRow) {
    const tool = isRow ? (item.tool || '') : (item.tool || item.name || '');
    if (item.request_id) return tool + '\n' + item.request_id;
    return tool + '\n' + partyKey(item);
  }
  for (const row of pendingRows) remainAdd(remainKey(row, true), 'rows', row);
  for (const item of pendingExecs) remainAdd(remainKey(item, false), 'execs', item);
  for (const bucket of remain.values()) {
    const rows = bucket.rows;
    const execs = bucket.execs.filter(item => rows.some(row => denyCompatible(row, item)));
    const matchedRows = rows.filter(row => execs.some(item => denyCompatible(row, item)));
    const complete = matchedRows.length === rows.length && execs.length === bucket.execs.length && matchedRows.length === execs.length && matchedRows.every(row => execs.every(item => denyCompatible(row, item)));
    if (complete && matchedRows.length) {
      execs.forEach((item, index) => fillDenied(matchedRows[index], item));
    } else if (matchedRows.length) {
      for (const item of execs) usedExecutions.add(item);
    }
  }
  const openGroups = new Map();
  for (const call of calls) {
    if (call.seq == null || call.decision !== 'allow' || call.request_id) continue;
    const key = partyKey(call);
    if (!openGroups.has(key)) openGroups.set(key, []);
    openGroups.get(key).push(call);
  }
  const execGroups = new Map();
  const readExecs = [];
  agent_executions.forEach(item => {
    if (usedExecutions.has(item)) return;
    if (!['ok', 'committed', 'ready'].includes(item.status) || item.request_id) return;
    readExecs.push(item);
    const key = partyKey(item);
    if (!execGroups.has(key)) execGroups.set(key, []);
    execGroups.get(key).push(item);
  });
  for (const [key, rows] of openGroups) {
    const execs = execGroups.get(key) || [];
    if (rows.length && execs.length === rows.length) {
      execs.forEach((item, index) => {
        const open = rows[index];
        if (!open.target) open.target = callTarget(null, null, item);
        if (!open.command) open.command = callCommand(null, null, item);
        if (!Object.keys(open.arguments || {}).length) open.arguments = allowArguments(item.args);
        usedExecutions.add(item);
      });
    } else {
      for (const item of execs) usedExecutions.add(item);
    }
  }
  for (const item of readExecs) {
    if (usedExecutions.has(item)) continue;
    const tool = item.tool || item.name || null;
    const sameTool = calls.some(call => call.seq != null && call.decision === 'allow' && !call.request_id && call.tool === tool);
    if (sameTool) usedExecutions.add(item);
  }
  agent_executions.forEach((item, index) => {
    if (usedExecutions.has(item)) return;
    const tool = item.tool || item.name || null;
    const decision = ['ok', 'committed', 'ready'].includes(item.status) ? 'allow' : 'deny';
    if (decision === 'allow' && item.request_id && calls.some(call => call.seq != null && call.decision === 'allow' && call.request_id && call.request_id === item.request_id && call.tool === tool)) return;
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
