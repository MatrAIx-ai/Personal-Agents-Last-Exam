'use strict';
const assert=require('node:assert/strict');
const {fixture}=require('../tests/harness.cjs');
const app=fixture();
app.event(require('./scenario.json'));
const condition={stay_id:'stay-1',service:'late_arrival',person_ids:['person-1','person-2'],arrival_at:'2026-12-02T00:20:00Z'};
app.call('stayready.need.save',{need_id:'need-arrival',conditions:condition,source_ids:['source-arrival']});
const {preview}=app.call('stayready.request.preview',{need_id:'need-arrival',action:'arrange'});
const request=app.call('stayready.request.submit',{need_id:'need-arrival',action:'arrange',preview_token:preview.preview_token});
// This JSON is fixed before the request exists. The App resolves its business selector.
app.event(require('./hotel-reply.json'));
assert.equal(app.data.requests.find(r=>r.id===request.hotel_request_id).status,'confirmed');
assert.equal(app.data.commitments.length,2);
assert.ok(app.data.requests.every(r=>r.disclosures.every(d=>d.field!=='private_background')));
console.log(JSON.stringify({example:'stayready',mode:'App-only business functions',request,commitments:app.data.commitments,history:app.data.history.map(h=>({operation:h.operation,outcome:h.outcome,target_id:h.target_id}))},null,2));
console.log('PASS: explicit arrival arrangement through a fixed hotel event. Real MCP/permissions/persistence and browser checks are separate evidence.');
