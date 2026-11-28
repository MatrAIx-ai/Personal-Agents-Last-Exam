'use strict';

function fail(code, message) {
  throw Object.assign(new Error(message), {code});
}

function snippet(text, query) {
  const hay = text.toLowerCase();
  const needle = query.toLowerCase();
  const at = hay.indexOf(needle);
  if (at < 0) return text.slice(0, 180);
  const start = Math.max(0, at - 60);
  return text.slice(start, start + 180);
}

function handleTool(ctx, data, name, args) {
  if (name === 'web.search') {
    const query = String(args.query || '').trim();
    if (!query) fail('invalid_arguments', 'A search query is required.');
    const needle = query.toLowerCase();
    const hits = data.pages.filter(page => (page.title + '\n' + page.text).toLowerCase().includes(needle)).slice(0, 8)
      .map(page => ({id: page.id, url: page.url, title: page.title, kind: page.kind, snippet: snippet(page.text, query)}));
    return {data, result: {query, hits}};
  }
  if (name === 'web.open') {
    const page = data.pages.find(item => item.url === args.url || item.id === args.url);
    if (!page) fail('not_found', 'That page is not in the fixed corpus.');
    return {data, result: {page: {id: page.id, url: page.url, title: page.title, kind: page.kind, text: page.text}}};
  }
  fail('not_found', 'Unknown tool');
}

module.exports = {handleTool};
