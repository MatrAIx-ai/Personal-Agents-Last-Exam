'use strict';
// Events Infra applies through env.apply_event. The handler reads the event's time as now (Core sets ctx.virtual_now to it).
const c = require('./common.cjs');
const {fail, parse} = c;
const HANDLERS = {
  'docket.period_extended'(ctx, data, p) {
    const d = c.docket(data, p.docket_id);
    if (parse(p.new_closes_at) <= parse(d.closes_at)) fail('invalid_event', 'An extension must move the closing of ' + d.docket_id + ' later than ' + d.closes_at + '.');
    if (parse(p.new_closes_at) <= c.now(ctx)) fail('invalid_event', 'The new closing instant is already in the past.');
    d.extended_from = d.extended_from ?? d.closes_at; d.closes_at = p.new_closes_at;
    c.stamp(ctx, d, 'docket_id', 'period_extended', 'Now closes ' + c.closesLocal(data, d) + (p.reason ? '; ' + p.reason : ''));
  },
  'docket.correction_published'(ctx, data, p) {
    const d = c.docket(data, p.docket_id);
    d.corrections.push({at:ctx.virtual_now, text:p.text});
    c.stamp(ctx, d, 'docket_id', 'correction_published', p.text.slice(0, 200));
  },
  'comment.status_changed'(ctx, data, p) {
    const x = c.comment(data, p.comment_id);
    if (x.status !== 'received') fail('invalid_event', 'Comment ' + x.comment_id + ' is already ' + x.status + '.');
    if (p.status === 'returned' && !p.reason) fail('invalid_event', 'A returned comment needs the agency\'s reason.');
    x.status = p.status; x.return_reason = p.status === 'returned' ? p.reason : null;
    c.stamp(ctx, x, 'comment_id', p.status, p.reason || null);
  },
  'comment.notice_recorded'(ctx, data, p) {
    const x = c.comment(data, p.comment_id);
    x.notices.push({kind:p.kind, status:p.status, at:ctx.virtual_now, event_id:p.event_id});
    c.stamp(ctx, x, 'comment_id', 'notice_' + p.status, p.kind + ' notice' + (p.event_id ? ' ' + p.event_id : ''));
  }
};
function applyEvent(ctx, data, event) {
  const handler = HANDLERS[event.operation];
  if (!handler) fail('invalid_event', 'Unsupported operation.');
  handler(ctx, data, event.payload);
  c.log(ctx, c.PREFIX + 'event_applied', {event_id:event.event_id, operation:event.operation});
  return data;
}
module.exports = {applyEvent};
