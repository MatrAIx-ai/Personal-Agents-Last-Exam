(function (root, factory) {
  const view = factory();
  if (typeof module === 'object' && module.exports) module.exports = view;
  else { root.PaleAppViews = root.PaleAppViews || {}; root.PaleAppViews.milepost = view; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // Read-only reviewer renderer. It is built only from Agent-visible read-tool results, so evaluator-only
  // records (learner parameters, activity log) can never reach a page. All text is escaped.
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const VIEWS = ['overview', 'skills', 'plan', 'practice'];
  const READS = {
    courses: ['milepost.courses.list', {}], skills: ['milepost.skills.list', {}], mastery: ['milepost.mastery.get', {}],
    assessments: ['milepost.assessments.list', {}], plan: ['milepost.plan.list', {}], practice: ['milepost.practice.list', {}],
    preferences: ['milepost.preferences.get', {}]
  };
  // call(name, args) returns a read result (or a promise of one).
  async function collect(call) {
    const model = {};
    for (const [key, [name, args]] of Object.entries(READS)) model[key] = await call(name, args);
    return model;
  }
  const level = x => (Math.round(x * 1000) / 1000).toFixed(3);
  const table = (head, rows) => '<table><thead><tr>' + head.map(h => '<th>' + escape(h) + '</th>').join('') + '</tr></thead><tbody>' +
    rows.map(r => '<tr>' + r.map(c => '<td>' + escape(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
  const section = (id, title, body) => '<section data-view="' + id + '" aria-label="' + escape(title) + '"><h2>' + escape(title) + '</h2>' + body + '</section>';

  function overview(m) {
    const levels = new Map(m.mastery.skills.map(s => [s.skill_id, s.level]));
    const upcoming = m.assessments.assessments.filter(a => a.status === 'scheduled');
    const counts = s => m.plan.blocks.filter(b => b.status === s).length;
    return section('overview', 'Overview',
      '<p>As of ' + escape(m.mastery.as_of) + ' (' + escape(m.preferences.time_zone) + ')</p>' +
      '<p>Courses: ' + escape(m.courses.courses.map(c => c.title).join(', ')) + '</p>' +
      '<p>Study blocks: ' + counts('planned') + ' planned, ' + counts('done') + ' done, ' + counts('missed') + ' missed. Practice sessions: ' + m.practice.sessions.length + '.</p>' +
      table(['Assessment', 'Date', 'Status', 'Skill', 'Current level', 'Target'], m.assessments.assessments.flatMap(a =>
        a.targets.map(t => [a.title + ' (' + a.id + ')', a.date, a.status, t.skill_id, level(levels.get(t.skill_id)), level(t.level)]))) +
      '<p>' + upcoming.length + ' scheduled assessment(s).</p>');
  }
  function skills(m) {
    const levels = new Map(m.mastery.skills.map(s => [s.skill_id, s]));
    return section('skills', 'Skills and mastery', '<p>Rule ' + escape(m.mastery.rule_version) + '</p>' +
      table(['Skill', 'ID', 'Course', 'Prerequisites', 'Level', 'Last practised'], m.skills.skills.map(s =>
        [s.title, s.id, s.course_id, s.prerequisites.join(', ') || '—', level(levels.get(s.id).level), levels.get(s.id).last_practised_at || '—'])));
  }
  function plan(m) {
    return section('plan', 'Plan', m.plan.blocks.length ? table(['Block', 'Skill', 'Start', 'End', 'Minutes', 'Status'],
      m.plan.blocks.map(b => [b.id, b.skill_id, b.start, b.end, String(b.minutes), b.status])) : '<p>No study blocks.</p>');
  }
  function practice(m) {
    return section('practice', 'Practice log', m.practice.sessions.length ? table(['Session', 'Skill', 'Started', 'Ended', 'Minutes', 'Source', 'Block'],
      m.practice.sessions.map(s => [s.id, s.skill_id, s.started_at, s.ended_at, String(s.minutes), s.source, s.block_id || '—'])) : '<p>No practice recorded.</p>');
  }
  const RENDER = {overview, skills, plan, practice};
  function render(model, {views = VIEWS} = {}) {
    return '<article class="milepost-reviewer">' + views.map(v => RENDER[v](model)).join('') + '</article>';
  }
  return {VIEWS, READS, collect, render, escape};
});
