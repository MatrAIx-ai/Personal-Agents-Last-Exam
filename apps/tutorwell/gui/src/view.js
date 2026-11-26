(function (root, factory) {
  const view = factory();
  if (typeof module === 'object' && module.exports) module.exports = view;
  else { root.PaleAppViews = root.PaleAppViews || {}; root.PaleAppViews.tutorwell = view; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // Read-only reviewer renderer. It is built only from Agent-visible read-tool results, so the evaluator-only
  // activity log and the integrity checker's findings can never reach a page. All text is escaped.
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const VIEWS = ['services', 'slots', 'appointments', 'reports'];
  // call(name, args) returns a read result (or a promise of one).
  async function collect(call) {
    const names = ['services.list', 'tutors.list', 'slots.list', 'appointments.list', 'reports.list', 'profile.get'];
    const model = {};
    for (const name of names) model[name.split('.')[0]] = await call('tutorwell.' + name, {});
    return model;
  }
  const table = (head, rows) => '<table><thead><tr>' + head.map(h => '<th>' + escape(h) + '</th>').join('') + '</tr></thead><tbody>' +
    rows.map(r => '<tr>' + r.map(c => '<td>' + escape(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
  const section = (id, title, body) => '<section data-view="' + id + '" aria-label="' + escape(title) + '"><h2>' + escape(title) + '</h2>' + body + '</section>';
  const tutorName = (m, id) => (m.tutors.tutors.find(t => t.id === id) || {name: id}).name;
  const or = (value, fallback = '—') => value === null || value === undefined || value === '' ? fallback : value;

  function services(m) {
    const p = m.profile, s = m.services;
    return section('services', 'Services and centre rules',
      '<p>As of ' + escape(s.as_of) + ' (' + escape(p.time_zone) + '). Rules ' + escape(s.rule_version) + ': ' +
      escape(Object.entries(s.settings).map(([k, v]) => k + ' ' + v).join(', ')) + '.</p>' +
      '<ul>' + s.rules.map(x => '<li>' + escape(x) + '</li>').join('') + '</ul>' +
      table(['Service', 'Draft required', 'Skills', 'Tutors'], s.services.map(x => [x.title + ' (' + x.id + ')', x.requires_draft ? 'yes' : 'no',
        x.skills.map(k => k.title + ' (' + k.id + ')').join(', '), m.tutors.tutors.filter(t => t.service_id === x.id).map(t => t.name + ' (' + t.modes.join(', ') + ')').join('; ')])) +
      '<p>' + escape(p.display_name) + ': this week (from ' + escape(p.this_week.week_start) + ') ' + p.this_week.count + ' of ' + p.this_week.weekly_cap +
      ' appointments; no-shows in the last ' + p.no_shows.window_days + ' days: ' + p.no_shows.in_window + ' (limit ' + p.no_shows.limit + '); ' +
      (p.suspension ? 'suspended from ' + escape(p.suspension.from) + ' until ' + escape(p.suspension.until) + ' (' + escape(p.suspension.cause) + ', ' +
        escape(p.suspension.cause_appointment_id) + ')' : 'not suspended') + '.</p>' +
      table(['Accommodation', 'Consents to share'], p.accommodations.map(a => [a.title + ' (' + a.id + ')', a.consent_to_share ? 'yes' : 'no'])));
  }
  function slots(m) {
    const list = m.slots.slots;
    return section('slots', 'Open slots', list.length ? table(['Slot', 'Start', 'End', 'Tutor', 'Service', 'Mode'], list.map(s =>
      [s.id, s.weekday + ' ' + s.start, s.end, tutorName(m, s.tutor_id), s.service_id, s.mode])) : '<p>No open slots.</p>');
  }
  function appointments(m) {
    const list = m.appointments.appointments;
    return section('appointments', 'Appointments and intakes', list.length ? table(['Appointment', 'Start', 'Tutor', 'Status', 'Cutoff', 'Skills', 'Work',
      'Items', 'Draft', 'Questions', 'Shares accommodations', 'Report'], list.map(a => [a.id + ' (' + a.slot_id + ')', a.weekday + ' ' + a.start,
      tutorName(m, a.tutor_id), a.status + (a.cancelled_at ? ' at ' + a.cancelled_at : '') + (a.outcome_recorded_at ? ' (recorded ' + a.outcome_recorded_at + ')' : ''),
      or(a.cancellation_cutoff), a.intake.skill_ids.join(', '), a.intake.work_type, or(a.intake.item_refs.join(', ')), or(a.intake.draft_ref),
      or(a.intake.questions.join(' | ')), a.intake.share_accommodations ? 'yes' : 'no', or(a.report_id)])) : '<p>No appointments.</p>');
  }
  function reports(m) {
    const list = m.reports.reports;
    if (!list.length) return section('reports', 'Reports and follow-ups', '<p>No reports.</p>');
    return section('reports', 'Reports and follow-ups', list.map(r => '<div class="report" data-report="' + escape(r.id) + '"><h3>' + escape(r.id) + ' · ' +
      escape(r.appointment_id) + ' · ' + escape(r.posted_at) + '</h3><p>Covered: ' + escape(r.covered_skill_ids.join(', ')) + '. Next focus: ' + escape(or(r.next_focus)) + '.</p>' +
      (r.followups.length ? table(['Follow-up', 'Kind', 'Items', 'Minutes', 'Due', 'Status'], r.followups.map(f => [f.id, f.kind, or(f.item_refs.join(', ')), String(f.minutes),
        or(f.due_at), f.status + (f.done_at ? ' at ' + f.done_at : '')])) : '<p>No follow-ups.</p>') + '</div>').join(''));
  }
  const RENDER = {services, slots, appointments, reports};
  function render(model, {views = VIEWS} = {}) {
    return '<article class="tutorwell-reviewer">' + views.map(v => RENDER[v](model)).join('') + '</article>';
  }
  return {VIEWS, collect, render, escape};
});
