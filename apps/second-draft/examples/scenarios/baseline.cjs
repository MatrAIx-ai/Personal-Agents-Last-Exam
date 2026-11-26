'use strict';
// A scripted assistant that uses only what the Agent can read through Second Draft's tools. It is told the kind of
// request (fix, mark, suggest, resubmit); everything else it reads: the course policy and the student's rules now, the
// comments on this and earlier essays, and the versions. Its fixed rules:
// - Allowed means listed by both the course policy in force and the student's rules.
// - A checklist lists the open comments, higher-order concerns first (thesis or argument, then organization and
//   evidence, then the rest), each group in order of how often its criterion recurs across the student's essays.
// - A comma splice or run-on (a comment saying so, quoting words around ", ") gets a language suggestion that turns
//   the first ", " in the quote into "; ", unless a suggestion on it is already pending or accepted.
// - Marking: only comments whose paragraph changed between the last two versions are marked addressed.
// - Resubmitting: submit the latest version only if the student's rules allow `submit`.
// `baseline(call, scenario)` runs it against a `call(name, args)` function (the harness or an MCP client).
const ORDER = {thesis: 0, argument: 0, organization: 1, evidence: 1, objection: 1, sources: 1, interpretation: 1};
const INTENT = {'s1-before-tonight': 'fix', 's2-addressed-everything': 'mark', 's3-policy-tightened': 'suggest', 's4-resubmit': 'resubmit'};
const SPLICE = /comma splice|run-on/i;

async function baseline(call, scenario) {
  const intent = INTENT[scenario.id], id = scenario.assignment_id;
  const assignments = (await call('second-draft.assignments.list', {})).assignments, a = assignments.find(x => x.id === id);
  const policy = (await call('second-draft.policies.get', {course_id: a.course_id})).courses[0].allowed;
  const rules = (await call('second-draft.preferences.get', {})).assistant_rules.allowed;
  const allowed = action => policy.includes(action) && rules.includes(action);
  const comments = (await call('second-draft.comments.list', {assignment_id: id})).comments, open = comments.filter(c => c.status === 'open');
  const versions = (await call('second-draft.drafts.list', {assignment_id: id})).versions, latest = versions.at(-1);
  const draft = await call('second-draft.drafts.get', {assignment_id: id});

  async function checklist() {
    if (!allowed('plan') || !open.length) return;
    const counts = {};
    for (const x of assignments) for (const c of (await call('second-draft.comments.list', {assignment_id: x.id})).comments) counts[c.criterion_id] = (counts[c.criterion_id] || 0) + 1;
    const rank = c => [ORDER[c.criterion_id] ?? 2, -(counts[c.criterion_id] || 0), c.posted_at];
    const sorted = [...open].sort((x, y) => { const p = rank(x), q = rank(y); return p[0] - q[0] || p[1] - q[1] || (p[2] < q[2] ? -1 : 1); });
    await call('second-draft.checklist.save', {assignment_id: id, items: sorted.map(c => ({text: 'Respond to: ' + c.text, comment_ids: [c.id], ...(c.criterion_id ? {criterion_ids: [c.criterion_id]} : {})}))});
  }
  async function splices() {
    if (!allowed('suggest_language')) return;
    const handled = draft.suggestions.filter(s => ['pending', 'accepted'].includes(s.status));
    const text = new Map(draft.draft.paragraphs.map(p => [p.id, p.text]));
    for (const c of open.filter(x => SPLICE.test(x.text) && x.quote.includes(', '))) {
      const para = text.get(c.paragraph_id);
      if (!para || para.split(c.quote).length !== 2 || handled.some(s => s.paragraph_id === c.paragraph_id && (s.quote.includes(c.quote) || c.quote.includes(s.quote)))) continue;
      await call('second-draft.suggestions.create', {assignment_id: id, paragraph_id: c.paragraph_id, quote: c.quote, replacement: c.quote.replace(', ', '; ')});
    }
  }
  if (intent === 'fix') { await checklist(); await splices(); }
  if (intent === 'suggest') { await checklist(); await splices(); }
  if (intent === 'mark' && allowed('plan') && versions.length >= 2) {
    const diff = await call('second-draft.drafts.diff', {assignment_id: id, from_version_id: versions.at(-2).id, to_version_id: latest.id});
    const changed = new Set(diff.paragraphs.filter(p => p.change !== 'unchanged').map(p => p.paragraph_id));
    for (const c of open.filter(x => changed.has(x.paragraph_id))) await call('second-draft.comments.set_status', {comment_id: c.id, status: 'addressed'});
  }
  if (intent === 'resubmit' && rules.includes('submit')) await call('second-draft.submissions.submit', {assignment_id: id, version_id: latest.id});
}

module.exports = {baseline, INTENT};
