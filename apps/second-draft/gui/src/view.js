(function (root, factory) {
  const view = factory();
  if (typeof module === 'object' && module.exports) module.exports = view;
  else { root.PaleAppViews = root.PaleAppViews || {}; root.PaleAppViews['second-draft'] = view; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // Read-only reviewer renderer. It is built only from Agent-visible read-tool results, so the evaluator-only
  // activity log and the integrity checker's judgments can never reach a page. All text is escaped.
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const VIEWS = ['assignments', 'draft', 'history', 'plan'];
  // call(name, args) returns a read result (or a promise of one). One assignment is shown in detail: the given
  // one, else the first open assignment with a draft.
  async function collect(call, {assignment_id} = {}) {
    const model = {assignments: await call('second-draft.assignments.list', {}), policies: await call('second-draft.policies.get', {}),
      messages: await call('second-draft.messages.list', {}), preferences: await call('second-draft.preferences.get', {})};
    const list = model.assignments.assignments;
    const chosen = assignment_id || (list.find(a => a.status === 'open' && a.latest_version_id) || list.find(a => a.latest_version_id) || list[0] || {}).id;
    model.assignment_id = chosen || null;
    if (!chosen) return model;
    model.draft = await call('second-draft.drafts.get', {assignment_id: chosen});
    model.comments = await call('second-draft.comments.list', {assignment_id: chosen});
    model.checklist = await call('second-draft.checklist.get', {assignment_id: chosen});
    model.versions = [];
    for (const v of (await call('second-draft.drafts.list', {assignment_id: chosen})).versions) {
      model.versions.push({...v, authorship: (await call('second-draft.drafts.get', {assignment_id: chosen, version_id: v.id})).draft.authorship});
    }
    return model;
  }
  const table = (head, rows) => '<table><thead><tr>' + head.map(h => '<th>' + escape(h) + '</th>').join('') + '</tr></thead><tbody>' +
    rows.map(r => '<tr>' + r.map(c => '<td>' + escape(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
  const section = (id, title, body) => '<section data-view="' + id + '" aria-label="' + escape(title) + '"><h2>' + escape(title) + '</h2>' + body + '</section>';
  const share = a => Object.entries(a || {}).map(([who, pct]) => who + ' ' + pct.toFixed(1) + '%').join(', ');

  function assignments(m) {
    return section('assignments', 'Assignments and AI policies',
      '<p>As of ' + escape(m.assignments.as_of) + ' (' + escape(m.preferences.time_zone) + ')</p>' +
      table(['Course', 'Allowed assistant actions now', 'Policy changes'], m.policies.courses.map(c =>
        [c.title + ' (' + c.course_id + ')', c.allowed.join(', ') || 'none', String(c.history.length)])) +
      '<p>Student\'s own rules: ' + escape(m.preferences.assistant_rules.allowed.join(', ') || 'none') + '. ' + escape(m.preferences.assistant_rules.note) + '</p>' +
      table(['Assignment', 'Course', 'Due', 'Status', 'Latest version', 'Criteria'], m.assignments.assignments.map(a =>
        [a.title + ' (' + a.id + ')', a.course_id, a.due_at + ' ' + a.due_day, a.status, a.latest_version_id || '—', a.criteria.map(c => c.id).join(', ')])));
  }
  function draft(m) {
    const d = m.draft && m.draft.draft;
    if (!d) return section('draft', 'Draft and comments', '<p>No draft yet.</p>');
    const byParagraph = new Map();
    for (const c of m.comments.comments) byParagraph.set(c.paragraph_id, [...(byParagraph.get(c.paragraph_id) || []), c]);
    const body = d.paragraphs.map(p => '<div class="paragraph" data-paragraph="' + escape(p.id) + '"><h3>' + escape(p.id) + '</h3><p>' +
      p.sentences.map(s => '<span data-author="' + escape(s.author) + '">' + escape(s.text) + '</span>').join(' ') + '</p>' +
      (byParagraph.get(p.id) || []).map(c => '<aside data-comment="' + escape(c.id) + '"><strong>' + escape(c.from) + ' · ' + escape(c.status) +
        (c.version_id === d.id ? '' : ' · on ' + escape(c.version_id)) + '</strong> “' + escape(c.quote) + '”: ' + escape(c.text) +
        (c.replies.length ? ' (' + c.replies.length + ' repl' + (c.replies.length === 1 ? 'y' : 'ies') + ')' : '') + '</aside>').join('') + '</div>').join('');
    const pending = m.draft.suggestions.filter(s => s.status === 'pending');
    return section('draft', 'Draft and comments', '<p>' + escape(m.assignment_id) + ', version ' + escape(d.id) + ' (' + escape(d.saved_by) + ', ' + escape(d.saved_at) + '); authorship: ' +
      escape(share(d.authorship)) + '</p>' + body + '<p>Pending suggestions: ' + pending.length + '</p>' +
      (pending.length ? table(['Suggestion', 'Paragraph', 'Quote', 'Replacement', 'Kind'], pending.map(s => [s.id, s.paragraph_id, s.quote, s.replacement, s.kind])) : ''));
  }
  function history(m) {
    if (!m.versions) return section('history', 'Version history', '<p>No draft yet.</p>');
    return section('history', 'Version history', table(['Version', 'Number', 'Saved', 'Saved by', 'Paragraphs', 'Authorship'], m.versions.map(v =>
      [v.id, String(v.number), v.saved_at, v.saved_by + (v.suggestion_id ? ' (' + v.suggestion_id + ')' : ''), v.paragraph_ids.join(', '), share(v.authorship)])));
  }
  function plan(m) {
    const items = m.checklist && m.checklist.checklist ? m.checklist.checklist.items : [];
    return section('plan', 'Checklist and messages', (items.length ? table(['#', 'Item', 'Comments', 'Criteria', 'Done'], items.map((x, i) =>
      [String(i + 1), x.text, x.comment_ids.join(', '), x.criterion_ids.join(', '), x.done ? 'yes' : 'no'])) : '<p>No checklist.</p>') +
      (m.messages.messages.length ? table(['Message', 'Course', 'From', 'At', 'Text'], m.messages.messages.map(x => [x.id, x.course_id, x.author, x.at, x.text])) : '<p>No messages.</p>'));
  }
  const RENDER = {assignments, draft, history, plan};
  function render(model, {views = VIEWS} = {}) {
    return '<article class="second-draft-reviewer">' + views.map(v => RENDER[v](model)).join('') + '</article>';
  }
  return {VIEWS, collect, render, escape};
});
