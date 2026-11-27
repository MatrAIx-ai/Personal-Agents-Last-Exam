'use strict';
// Notices to Mail 1.3.0, built from public tool views by the host-run publisher (src/publisher.cjs). Delivery outcomes
// reach the comment's notice history only through the comment.notice_recorded Infra event.
const APP = require('../app.json').app_id;
const TYPE = 'org.pale.mail.notification.v1', PAYLOAD = 'urn:pale:email-payload:1', CHANNEL = 'channel.email';
const need = (value, what) => {if (value === undefined || value === null) throw new Error('A ' + what + ' view is required to build this notice.'); return value;};
const KINDS = {
  receipt({receipt}) {
    const r = need(receipt, 'receipt');
    return {object_type:'comment', object_id:r.comment_id, route_id:'mine', at:r.submitted_at,
      title:'Your comment on docket ' + r.docket_id + ' was received',
      text:'CivicDesk received your ' + (r.submitter.kind === 'anonymous' ? 'anonymous' : 'named') + (r.supplemental ? ' supplemental' : '') + ' comment on docket ' + r.docket_id + ' (' + r.agency.name + ': ' + r.docket_title + ') on ' + r.submitted_at_local + '. Tracking number: ' + r.tracking_number + '. Comments are usually posted within a few business days; follow the status under My comments. A submitted comment is public and cannot be withdrawn.'};
  },
  status({comment}) {
    const x = need(comment, 'comment');
    if (x.status === 'received') throw new Error('Comment ' + x.id + ' has no status change yet.');
    return {object_type:'comment', object_id:x.id, route_id:'mine', at:x.updated_at,
      title:'Your comment on docket ' + x.docket_id + ' was ' + x.status,
      text:x.status === 'posted' ? 'Your comment ' + x.tracking_number + ' on docket ' + x.docket_id + ' (' + x.docket_title + ') is now posted on the public docket.' : 'The ' + x.agency.name + ' returned your comment ' + x.tracking_number + ' on docket ' + x.docket_id + ': ' + x.return_reason + ' You may submit a new comment while the period is open.'};
  }
};
function build(kind, views, {account, person}) {
  const make = KINDS[kind];
  if (!make) throw new Error('Unknown notice kind ' + kind + '. Kinds: ' + Object.keys(KINDS).join(', ') + '.');
  const n = make(views || {});
  return {specversion:'1.0', id:APP + '-notice-' + kind + '-' + n.object_id, source:'urn:pale:app:' + APP + ':account:' + account, type:TYPE, datacontenttype:'application/json', dataschema:PAYLOAD, time:n.at, subject:n.object_id,
    data:{channel:CHANNEL, recipient:{kind:'person_ref', id:person}, source_object:{app_id:APP, account_id:account, object_type:n.object_type, object_id:n.object_id},
      content:{title:n.title.slice(0, 200), body:{format:'text/plain', text:n.text}, asset_ids:[], deep_link:{app_id:APP, route_id:n.route_id, object_id:n.object_id}}, extensions:[]}};
}
module.exports = {build, KINDS:Object.keys(KINDS), TYPE, PAYLOAD, CHANNEL};
