(function(root, factory) {
  const view = factory();
  if (typeof module === 'object' && module.exports) module.exports = view;
  else { root.PaleAppViews = root.PaleAppViews || {}; root.PaleAppViews.forkyard = view; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
  function render(records) {
    const items = Array.isArray(records) ? records : [];
    return '<section aria-label="forkyard records">' + items.map(item =>
      '<article data-record-id="' + escape(item.repo || item.account_id || item.release_id || item.comment_id) + '"><h3>' +
      escape(item.repo || item.handle || item.title || item.comment_id) + '</h3><pre>' + escape(JSON.stringify(item, null, 2)) + '</pre></article>'
    ).join('') + '</section>';
  }
  function renderPullThread(pull, reviews, comments, timeline) {
    const reviewRows = (reviews || []).map(item => '<li><p>' + escape(item.author_account_id) + ' ' + escape(item.state) + '</p><p>' + escape(item.body) + '</p></li>').join('');
    const commentRows = (comments || []).map(item => '<li data-comment-id="' + escape(item.comment_id) + '">' + escape(item.body) + '</li>').join('');
    const timeRows = (timeline || []).map(item => '<li>' + escape(item.at) + ' ' + escape(item.kind) + ' ' + escape(item.text) + '</li>').join('');
    return '<article data-view="pull-thread"><h2>' + escape(pull && pull.title) + '</h2><p>' + escape(pull && (pull.repo + '#' + pull.number)) + '</p><p>' + escape(pull && pull.body) + '</p><h3>Reviews</h3><ul>' + reviewRows + '</ul><h3>Comments</h3><ul>' + commentRows + '</ul><h3>Timeline</h3><ol>' + timeRows + '</ol></article>';
  }
  function renderProfile(account, links, activity) {
    const linkRows = (links || (account && account.links) || []).map(item => '<li>' + escape(item) + '</li>').join('');
    const rows = (activity || []).map(item => '<li>' + escape(item.type || item.kind || '') + ' ' + escape(item.title || item.message || item.text || '') + '</li>').join('');
    return '<article data-view="profile"><h2>' + escape(account && (account.display_name || account.handle)) + '</h2><p>' + escape(account && account.handle) + '</p><p>' + escape(account && account.bio) + '</p><h3>Links</h3><ul>' + linkRows + '</ul><h3>Recent public activity</h3><ol>' + rows + '</ol></article>';
  }
  function countOf(value) {
    return Array.isArray(value) ? value.length : 0;
  }
  function renderEvidenceSummary(doc) {
    return '<article data-view="evidence-summary"><p>' + escape(doc && doc.schema) + '</p><p>revisions ' + countOf(doc && doc.revisions) + '</p><p>subjects ' + countOf(doc && doc.subjects) + '</p><p>links ' + countOf(doc && doc.links) + '</p><p>run ' + escape(doc && doc.run_id) + '</p></article>';
  }
  return {render, renderPullThread, renderProfile, renderEvidenceSummary};
});
