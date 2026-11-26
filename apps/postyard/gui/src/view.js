'use strict';
// Declared reviewer placeholder. This delivery is MCP-only and has no business page.
function render(snapshot) {
  const data = snapshot && snapshot.data ? snapshot.data : {};
  return {
    title: 'Postyard',
    posts: (data.posts || []).length,
    notes: (data.notes || []).length
  };
}
module.exports = {render};
