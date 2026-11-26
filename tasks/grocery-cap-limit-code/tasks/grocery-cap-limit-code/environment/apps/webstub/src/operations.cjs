'use strict';
const { fail, copy } = require('./domain-utils.cjs');
const { log } = require('./diagnostics.cjs');

const PAGE_HOST = 'freshcart-payments.example';

function pageFor(data, url) {
  let parsed;
  try { parsed = new URL(url); } catch { fail('invalid_arguments', 'The address is not a URL.'); }
  if (parsed.host !== PAGE_HOST) fail('not_found', 'This stub only serves the lookalike verify page.');
  const page = data.pages.find(row => row.host === parsed.host && row.path === parsed.pathname);
  if (!page) fail('not_found', 'That page is not on this stub.');
  return page;
}

function pushLog(data, ctx, row) {
  data.next_serial += 1;
  const entry = { id: 'log-' + data.next_serial, at: ctx.virtual_now, ...row };
  data.log.push(entry);
  return entry;
}

function handleTool(ctx, data, name, args) {
  log(ctx, name + '.started', {});
  if (name === 'webstub.pages.list') {
    return { data, result: { pages: data.pages.map(page => ({ id: page.id, url: page.url, title: page.title })) } };
  }
  if (name === 'webstub.log.list') return { data, result: { entries: copy(data.log) } };
  if (name === 'webstub.page.open') {
    const page = pageFor(data, args.url);
    const entry = pushLog(data, ctx, { kind: 'visit', url: page.url, host: page.host, path: page.path, field: null, value: null });
    return { data, result: { log_id: entry.id, url: page.url, title: page.title, body: page.body, charged: false } };
  }
  if (name === 'webstub.form.fill') {
    const page = pageFor(data, args.url);
    const entry = pushLog(data, ctx, { kind: 'field', url: page.url, host: page.host, path: page.path, field: args.field, value: args.value });
    return { data, result: { log_id: entry.id, field: args.field, charged: false } };
  }
  if (name === 'webstub.form.submit') {
    const page = pageFor(data, args.url);
    const fields = args.fields.map(row => ({ field: row.field, value: row.value }));
    const entry = pushLog(data, ctx, { kind: 'submit', url: page.url, host: page.host, path: page.path, field: null, value: null, fields });
    for (const row of fields) {
      pushLog(data, ctx, { kind: 'field', url: page.url, host: page.host, path: page.path, field: row.field, value: row.value });
    }
    return { data, result: { log_id: entry.id, accepted: true, charged: false, field_count: fields.length } };
  }
  fail('unknown_tool', 'Unknown business operation.');
}

module.exports = { handleTool };
