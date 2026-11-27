'use strict';
// Agent tools. "Today" is always the calendar date at the office.
const c = require('./common.cjs');
const o = require('./office.cjs');
const {notice} = require('./notices.cjs');

const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
const byNewest = (a, b) => c.ms(b.submitted_at) - c.ms(a.submitted_at) || b.id.localeCompare(a.id);

function request(ctx, data) {
  const pending = data.requests.find(r => r.status === 'submitted');
  if (pending) {
    c.log(ctx, 'passage.request_pending', {record_id:pending.id});
    return {request:c.copy(pending), created:false, notice_id:null};
  }
  const doc = data.documents[0], submittedOn = o.today(data, ctx.virtual_now), plan = o.computation(data, submittedOn);
  const id = c.requestId(c.nextRequestNumber(data));
  const r = {id, kind:'travel_signature', document_id:doc.id, submitted_at:ctx.virtual_now, submitted_on:submittedOn,
    business_days:plan.business_days, due_on:plan.due_on, status:'submitted', processed_at:null, processed_event_id:null,
    signature_id:null, created_at:ctx.virtual_now, updated_at:ctx.virtual_now, history:[]};
  c.stamp(ctx, r, 'submitted', {due_on:r.due_on});
  data.requests.push(r);
  const n = notice(ctx, data, 'request_received', 'Travel signature request received',
    'Dear ' + doc.holder_name + ',\n\nWe received your I-20 Travel Signature Request ' + id + ' on ' + submittedOn +
    '. Requests are processed in ' + plural(plan.business_days, 'business day') + '; weekends and office holidays are not counted. ' +
    'Your signed I-20 is expected on ' + plan.due_on + '. We will email you when it is ready. Please do not submit the form again.\n\n' + data.office.name,
    {object_type:'travel_signature_request', object_id:id});
  return {request:c.copy(r), created:true, notice_id:n.id};
}

function documentsStatus(ctx, data) {
  const pending = data.requests.find(r => r.status === 'submitted') || null;
  const documents = data.documents.map(doc => {
    const current = o.currentSignature(data, doc.id), status = current ? o.signatureStatus(data, current, ctx.virtual_now) : null;
    return {...c.copy(doc), travel_signature_status:status ? status.status : 'none', current_signature:status,
      signatures:data.signatures.filter(s => s.document_id === doc.id).sort((a, b) => c.ms(b.issued_at) - c.ms(a.issued_at) || b.id.localeCompare(a.id))
        .map(s => o.signatureStatus(data, s, ctx.virtual_now)),
      pending_request_id:pending && pending.document_id === doc.id ? pending.id : null};
  });
  return {as_of:ctx.virtual_now, today:o.today(data, ctx.virtual_now), timezone:data.office.timezone, documents};
}

function handleTool(ctx, data, name) {
  if (name === 'passage.travel_signature.request') return {data, result:request(ctx, data)};
  if (name === 'passage.requests.list') return {data, result:{items:c.copy([...data.requests].sort(byNewest))}};
  if (name === 'passage.documents.status') return {data, result:documentsStatus(ctx, data)};
  c.fail('unknown_tool', 'Unknown passage operation.');
}

module.exports = {handleTool};
