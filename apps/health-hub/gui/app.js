'use strict';

let csrfToken = '';
let currentVersion = null;
let availableTools = new Set();
let pendingReqCounter = 0;
let lastState = null;

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const child of children.flat()) {
    if (child != null) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const BADGE_STYLES = {
  valid: { background: '#e7f6ec', color: '#1b6e3a' },
  completed: { background: '#e7f6ec', color: '#1b6e3a' },
  achieved: { background: '#e7f6ec', color: '#1b6e3a' },
  active: { background: '#e8f0fe', color: '#1f56b3' },
  planned: { background: '#e8f0fe', color: '#1f56b3' },
  draft: { background: '#f1f3f6', color: '#4b5563' },
  no_data: { background: '#fef3c7', color: '#92400e' },
  warning: { background: '#fef3c7', color: '#92400e' },
  skipped: { background: '#fef3c7', color: '#92400e' },
  missed: { background: '#fee2e2', color: '#991b1b' },
  cancelled: { background: '#f1f3f6', color: '#6b7280' },
  abandoned: { background: '#f1f3f6', color: '#6b7280' },
  archived: { background: '#f1f3f6', color: '#6b7280' }
};

function badge(text, variant) {
  const palette = BADGE_STYLES[variant] || { background: '#edf3ff', color: '#3269c9' };
  return el('span', {
    class: `badge badge-${variant}`,
    style: {
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: '999px',
      fontSize: '11px',
      fontWeight: '600',
      textTransform: 'capitalize',
      ...palette
    }
  }, text);
}

function applyLayoutStyles() {
  for (const panel of document.querySelectorAll('.view-panel')) {
    Object.assign(panel.style, { padding: '24px 28px', display: panel.hidden ? 'none' : 'flex', flexDirection: 'column', gap: '20px' });
  }
  const metricsGrid = document.getElementById('overview-metrics');
  if (metricsGrid) {
    Object.assign(metricsGrid.style, { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' });
  }
  const split = document.getElementById('overview-split');
  if (split) {
    Object.assign(split.style, { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' });
  }
  for (const card of document.querySelectorAll('.card')) {
    Object.assign(card.style, {
      background: '#fff',
      border: '1px solid #e7eaf0',
      borderRadius: '12px',
      padding: '20px',
      boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)'
    });
  }
  for (const val of document.querySelectorAll('.metric-val')) {
    Object.assign(val.style, { fontSize: '28px', fontWeight: '700', letterSpacing: '-0.02em', margin: '8px 0 4px', color: '#1e293b' });
  }
  for (const sub of document.querySelectorAll('.subtext')) {
    Object.assign(sub.style, { fontSize: '12px', color: '#64748b', margin: '0' });
  }
  for (const head of document.querySelectorAll('.card-head')) {
    Object.assign(head.style, { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '16px' });
  }
  for (const form of document.querySelectorAll('.inline-form')) {
    Object.assign(form.style, { display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-end', marginTop: '10px' });
    for (const lbl of form.querySelectorAll('label')) {
      Object.assign(lbl.style, { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontWeight: '600', color: '#475569', flex: '1 1 160px' });
    }
  }
  for (const wrap of document.querySelectorAll('.table-wrap')) {
    Object.assign(wrap.style, { overflowX: 'auto' });
  }
  for (const tbl of document.querySelectorAll('.data-table')) {
    Object.assign(tbl.style, { width: '100%', borderCollapse: 'collapse', fontSize: '13px' });
    for (const th of tbl.querySelectorAll('th')) {
      Object.assign(th.style, {
        textAlign: 'left',
        padding: '10px 12px',
        borderBottom: '1px solid #e7eaf0',
        background: '#f8fafc',
        fontSize: '11px',
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        color: '#64748b',
        whiteSpace: 'nowrap'
      });
    }
  }
  for (const list of document.querySelectorAll('.styled-list')) {
    Object.assign(list.style, { listStyle: 'none', padding: '0', margin: '12px 0 0', display: 'flex', flexDirection: 'column', gap: '10px' });
  }
  const routines = document.getElementById('routines-container');
  if (routines) {
    Object.assign(routines.style, { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px', marginTop: '14px' });
  }
}

function styleTableCells(tbody) {
  for (const tr of tbody.querySelectorAll('tr')) {
    for (const td of tr.querySelectorAll('td')) {
      Object.assign(td.style, { padding: '10px 12px', borderBottom: '1px solid #f1f3f7', verticalAlign: 'middle' });
    }
  }
}

function setStatus(message, isError = false) {
  const statusEl = document.getElementById('status');
  statusEl.textContent = message;
  if (isError) statusEl.dataset.error = 'true';
  else delete statusEl.dataset.error;
}

async function authenticate() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const token = hash.get('access');
  if (token) {
    history.replaceState(null, '', location.pathname);
    const res = await fetch('/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error || 'Session authentication failed');
    csrfToken = out.csrf;
    return;
  }
  const res = await fetch('/session');
  if (res.ok) {
    const out = await res.json();
    csrfToken = out.csrf;
  }
}

function isReadTool(name) {
  return [
    'health-hub.get_daily_summary',
    'health-hub.list_metrics',
    'health-hub.list_workouts',
    'health-hub.list_goals',
    'health-hub.list_routine_templates',
    'health-hub.list_notifications'
  ].includes(name);
}

async function callTool(name, args = {}) {
  const payload = { ...args };
  if (payload.expected_version === undefined && currentVersion && !isReadTool(name)) {
    payload.expected_version = currentVersion;
    payload.request_id = `web-${Date.now()}-${++pendingReqCounter}`;
  }
  const res = await fetch('/api/call', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Pale-CSRF': csrfToken
    },
    body: JSON.stringify({ name, arguments: payload })
  });
  const out = await res.json();
  if (!res.ok) throw new Error(out.error || 'Request failed');
  if (!['ok', 'committed', 'ready'].includes(out.status)) {
    throw new Error(out.message || out.status);
  }
  if (out.version) currentVersion = out.version;
  return out;
}

async function loadStateFromHost() {
  const toolsRes = await fetch('/api/tools');
  if (!toolsRes.ok) throw new Error('Failed to discover MCP tools');
  const discovered = await toolsRes.json();
  availableTools = new Set((discovered.tools || []).map((t) => t.name));

  const startDate = document.getElementById('metrics-start').value || '2025-10-10';
  const endDate = document.getElementById('metrics-end').value || '2026-12-31';

  const [sleepRes, recRes, strainRes, weightRes, wkRes, goalRes, rtnRes, notifRes] = await Promise.all([
    callTool('health-hub.list_metrics', { metric_type: 'sleep', start_date: startDate, end_date: endDate }),
    callTool('health-hub.list_metrics', { metric_type: 'recovery', start_date: startDate, end_date: endDate }),
    callTool('health-hub.list_metrics', { metric_type: 'strain', start_date: startDate, end_date: endDate }),
    callTool('health-hub.list_metrics', { metric_type: 'body_weight', start_date: startDate, end_date: endDate }),
    callTool('health-hub.list_workouts', {}),
    callTool('health-hub.list_goals', {}),
    callTool('health-hub.list_routine_templates', {}),
    callTool('health-hub.list_notifications', {})
  ]);

  const byDate = new Map();
  const ensure = (d) => {
    if (!byDate.has(d.date)) {
      byDate.set(d.date, { date: d.date, status: d.status, reason: d.reason, metrics: {} });
    }
    return byDate.get(d.date);
  };
  for (const s of sleepRes.series) {
    const row = ensure(s);
    if (s.status === 'valid') row.metrics.sleep = s.sleep;
  }
  for (const r of recRes.series) {
    const row = ensure(r);
    if (r.status === 'valid') row.metrics.recovery = r.recovery;
  }
  for (const st of strainRes.series) {
    const row = ensure(st);
    if (st.status === 'valid') row.metrics.day_strain = st.strain;
  }
  for (const w of weightRes.series) {
    const row = ensure(w);
    if (w.status === 'valid') row.metrics.body_weight_kg = w.body_weight;
  }

  return {
    owner_person_id: discovered.run || 'health-hub',
    daily_summaries: Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date)),
    workouts: wkRes.workouts || [],
    goals: goalRes.goals || [],
    routine_templates: rtnRes.routine_templates || [],
    notifications: notifRes.notifications || []
  };
}

function renderApp(state) {
  lastState = state;
  document.getElementById('user-badge').textContent = `Run: ${state.owner_person_id}`;

  const validSummaries = (state.daily_summaries || []).filter((s) => s.status === 'valid');
  const latest = validSummaries[validSummaries.length - 1];

  if (latest && latest.metrics) {
    const { sleep, recovery, day_strain, body_weight_kg } = latest.metrics;
    if (recovery) {
      document.getElementById('val-recovery').textContent = `${recovery.recovery_score}%`;
      document.getElementById('val-rhr').textContent = `RHR: ${recovery.resting_hr} bpm | HRV: ${recovery.hrv_rmssd} ms`;
    }
    if (sleep) {
      const hrs = Math.floor(sleep.duration_minutes / 60);
      const mins = sleep.duration_minutes % 60;
      document.getElementById('val-sleep').textContent = `${hrs}h ${mins}m`;
      document.getElementById('val-sleep-score').textContent = `Sleep Score: ${sleep.sleep_score}`;
    }
    document.getElementById('val-strain').textContent = day_strain != null ? `${day_strain}` : '--';
    document.getElementById('val-weight').textContent = body_weight_kg != null ? `${body_weight_kg} kg` : '-- kg';
    document.getElementById('val-latest-date').textContent = `Date: ${latest.date}`;
  }

  // Biometrics Table
  const tbody = document.getElementById('biometrics-tbody');
  tbody.replaceChildren();
  const recentDays = (state.daily_summaries || []).slice().reverse().slice(0, 30);

  for (const row of recentDays) {
    if (row.status === 'no_data') {
      const reasonLabel = row.reason === 'device_not_worn' ? 'Device Not Worn' : (row.reason || 'No Data');
      tbody.append(
        el('tr', { style: { background: '#fffbeb' } },
          el('td', {}, el('strong', {}, row.date)),
          el('td', {}, badge(`no_data (${reasonLabel})`, 'no_data')),
          el('td', {}, '--'),
          el('td', {}, '--'),
          el('td', {}, '--'),
          el('td', {}, '--'),
          el('td', {}, '--'),
          el('td', {}, '--')
        )
      );
    } else {
      const m = row.metrics || {};
      const rec = m.recovery || {};
      const slp = m.sleep || {};
      tbody.append(
        el('tr', {},
          el('td', {}, el('strong', {}, row.date)),
          el('td', {}, badge('Recorded', 'valid')),
          el('td', {}, rec.recovery_score != null ? `${rec.recovery_score}%` : '--'),
          el('td', {}, slp.duration_minutes != null ? `${Math.floor(slp.duration_minutes / 60)}h ${slp.duration_minutes % 60}m` : '--'),
          el('td', {}, rec.resting_hr != null ? `${rec.resting_hr} bpm` : '--'),
          el('td', {}, rec.hrv_rmssd != null ? `${rec.hrv_rmssd} ms` : '--'),
          el('td', {}, m.day_strain != null ? `${m.day_strain}` : '--'),
          el('td', {}, m.body_weight_kg != null ? `${m.body_weight_kg} kg` : '--')
        )
      );
    }
  }
  styleTableCells(tbody);

  // Workouts (filterable, newest first, top 30)
  const wkFilter = document.getElementById('workout-status-filter')?.value || '';
  const wkTbody = document.getElementById('workouts-tbody');
  const recentWorkoutsList = document.getElementById('recent-workouts-list');
  wkTbody.replaceChildren();
  recentWorkoutsList.replaceChildren();

  const allWorkouts = (state.workouts || []).slice().sort((a, b) =>
    (b.scheduled_at || b.logged_at || '').localeCompare(a.scheduled_at || a.logged_at || '')
  );
  const visibleWorkouts = (wkFilter ? allWorkouts.filter((w) => w.status === wkFilter) : allWorkouts).slice(0, 30);

  for (const w of visibleWorkouts) {
    const actionsCell = el('td', { style: { whiteSpace: 'nowrap' } });
    if (w.status === 'planned' && availableTools.has('health-hub.update_workout')) {
      actionsCell.append(
        el('button', {
          type: 'button',
          style: { padding: '4px 10px', fontSize: '11px', marginRight: '6px' },
          onclick: () => runAction(() => callTool('health-hub.update_workout', { workout_id: w.workout_id, status: 'completed' }))
        }, 'Complete'),
        el('button', {
          type: 'button',
          style: { padding: '4px 10px', fontSize: '11px' },
          onclick: () => runAction(() => callTool('health-hub.update_workout', { workout_id: w.workout_id, status: 'skipped' }))
        }, 'Skip')
      );
    }
    wkTbody.append(
      el('tr', {},
        el('td', { style: { fontFamily: 'monospace', fontSize: '12px', color: '#475569' } }, w.workout_id),
        el('td', {}, el('strong', {}, w.activity_type.replace(/_/g, ' '))),
        el('td', {}, badge(w.status, w.status)),
        el('td', {}, w.scheduled_at || w.logged_at || '--'),
        el('td', {}, `${w.duration_minutes} min`),
        el('td', {}, w.avg_hr ? `${w.avg_hr} bpm` : '--'),
        actionsCell
      )
    );
  }
  styleTableCells(wkTbody);

  for (const w of allWorkouts) {
    if (w.status === 'planned') {
      recentWorkoutsList.append(
        el('li', { style: { padding: '10px 12px', background: '#f8fafc', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          el('span', {}, el('strong', {}, w.activity_type.replace(/_/g, ' ')), ` (${w.duration_minutes}m)`),
          el('small', {}, w.scheduled_at)
        )
      );
    }
  }
  if (recentWorkoutsList.children.length === 0) {
    recentWorkoutsList.append(el('li', { class: 'empty-state', style: { color: '#64748b' } }, 'No upcoming planned workouts'));
  }

  // Goals
  const goalsList = document.getElementById('goals-list');
  goalsList.replaceChildren();
  for (const g of state.goals || []) {
    const btnGroup = el('div', { style: { display: 'flex', gap: '8px' } });
    if (g.status === 'active' && availableTools.has('health-hub.update_goal')) {
      btnGroup.append(
        el('button', {
          type: 'button',
          style: { padding: '4px 10px', fontSize: '12px' },
          onclick: () => runAction(() => callTool('health-hub.update_goal', { goal_id: g.goal_id, status: 'achieved' }))
        }, 'Mark Achieved'),
        el('button', {
          type: 'button',
          style: { padding: '4px 10px', fontSize: '12px' },
          onclick: () => runAction(() => callTool('health-hub.update_goal', { goal_id: g.goal_id, status: 'abandoned' }))
        }, 'Abandon')
      );
    }
    goalsList.append(
      el('li', { style: { padding: '14px 16px', border: '1px solid #e7eaf0', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' } },
        el('div', { class: 'goal-item' },
          el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' } },
            el('strong', {}, g.title),
            badge(g.status + (g.derived ? ' (derived)' : ''), g.status)
          ),
          el('p', { class: 'subtext', style: { fontSize: '12px', color: '#64748b' } }, `Target: ${g.target_value} (${g.metric_type}) · Due: ${g.due_date || 'Open'}`)
        ),
        btnGroup
      )
    );
  }

  // Routine Templates
  const routinesContainer = document.getElementById('routines-container');
  routinesContainer.replaceChildren();
  for (const rtn of state.routine_templates || []) {
    const blocksList = el('ol', { class: 'blocks-list', style: { paddingLeft: '18px', margin: '10px 0 14px', color: '#475569', fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '4px' } });
    for (const b of rtn.blocks || []) {
      blocksList.append(el('li', {}, `${b.name} (${b.duration_minutes}m @ +${b.start_offset_minutes}m)`));
    }
    const card = el('div', {
      class: 'card routine-card',
      style: { background: '#f8fafc', border: '1px solid #e7eaf0', borderRadius: '10px', padding: '16px' }
    },
      el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' } },
        el('h4', { style: { margin: '0', fontSize: '15px' } }, rtn.title),
        badge(rtn.status, rtn.status)
      ),
      blocksList
    );
    if (availableTools.has('health-hub.update_routine_template')) {
      if (rtn.status === 'draft') {
        card.append(el('button', {
          type: 'button',
          class: 'primary',
          style: { padding: '6px 12px', fontSize: '12px' },
          onclick: () => runAction(() => callTool('health-hub.update_routine_template', { routine_id: rtn.routine_id, status: 'active' }))
        }, 'Activate'));
      } else if (rtn.status === 'active') {
        card.append(el('button', {
          type: 'button',
          style: { padding: '6px 12px', fontSize: '12px' },
          onclick: () => runAction(() => callTool('health-hub.update_routine_template', { routine_id: rtn.routine_id, status: 'archived' }))
        }, 'Archive'));
      }
    }
    routinesContainer.append(card);
  }

  // Notifications
  const notifList = document.getElementById('notification-list');
  notifList.replaceChildren();
  if ((state.notifications || []).length > 0) {
    for (const n of state.notifications) {
      notifList.append(
        el('li', { style: { padding: '10px 12px', background: '#fef2f2', borderRadius: '8px', fontSize: '13px' } },
          badge(n.type.replace(/_/g, ' '), 'missed'),
          ` ${n.message} `,
          el('small', { style: { marginTop: '4px' } }, n.created_at)
        )
      );
    }
  } else {
    notifList.append(el('li', { class: 'empty-state', style: { color: '#64748b' } }, 'No active notifications'));
  }
}

async function refresh() {
  setStatus('Loading…');
  try {
    const state = await loadStateFromHost();
    renderApp(state);
    setStatus('All changes saved');
  } catch (err) {
    setStatus(err.message, true);
  }
}

async function runAction(fn) {
  try {
    setStatus('Saving…');
    await fn();
    await refresh();
  } catch (err) {
    setStatus(err.message, true);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  applyLayoutStyles();

  const navBtns = document.querySelectorAll('.nav-btn');
  const panels = document.querySelectorAll('.view-panel');
  const pageTitle = document.getElementById('page-title');

  navBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      navBtns.forEach((b) => b.removeAttribute('aria-current'));
      panels.forEach((p) => { p.hidden = true; p.style.display = 'none'; });
      btn.setAttribute('aria-current', 'page');
      const tabId = btn.getAttribute('data-tab');
      const target = document.getElementById(tabId);
      target.hidden = false;
      target.style.display = 'flex';
      pageTitle.textContent = btn.querySelector('span:last-child')?.textContent || btn.textContent;
    });
  });

  document.getElementById('refresh-btn').addEventListener('click', () => refresh());
  document.getElementById('metrics-filter-form').addEventListener('submit', (e) => {
    e.preventDefault();
    refresh();
  });
  document.getElementById('workout-status-filter').addEventListener('change', () => {
    if (lastState) renderApp(lastState);
  });

  document.getElementById('plan-workout-form').addEventListener('submit', (e) => {
    e.preventDefault();
    runAction(() => callTool('health-hub.plan_workout', {
      activity_type: document.getElementById('wkt-activity').value,
      scheduled_at: document.getElementById('wkt-scheduled').value,
      duration_minutes: Number(document.getElementById('wkt-duration').value)
    }));
  });

  document.getElementById('create-goal-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const due = document.getElementById('goal-due').value.trim();
    const args = {
      title: document.getElementById('goal-title').value,
      metric_type: document.getElementById('goal-metric').value,
      target_value: Number(document.getElementById('goal-target').value)
    };
    if (due) args.due_date = due;
    runAction(() => callTool('health-hub.create_goal', args));
  });

  document.getElementById('create-routine-form').addEventListener('submit', (e) => {
    e.preventDefault();
    runAction(() => callTool('health-hub.create_routine_template', {
      title: document.getElementById('rtn-title').value,
      blocks: [{
        block_id: 'blk_1',
        name: document.getElementById('rtn-block-name').value,
        start_offset_minutes: 0,
        duration_minutes: Number(document.getElementById('rtn-block-duration').value)
      }]
    }));
  });

  try {
    await authenticate();
    await refresh();
  } catch (err) {
    setStatus(err.message, true);
  }
});
