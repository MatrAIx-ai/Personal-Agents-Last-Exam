import {mount,el,date,tag,textBlock,metadata,download} from '/shared/client.js';
// CivicDesk: App-owned pages served by the shared Web Host over the fixed Agent MCP connection: docket search, the docket
// page with its period in the agency's time zone, corrections and documents, the comment form with validation, the review
// step with the acknowledgment, the receipt, and my comments with status. Every control calls the same civicdesk.* tools
// an agent would, under the same policy; nothing here touches Infra operations.
const T='civicdesk.';
const pane=()=>document.querySelector('.detail');
const mark=id=>{for(const b of document.querySelectorAll('#records [data-record-id]'))b.setAttribute('aria-pressed',String(b.dataset.recordId===id));};
let uiRef=null,pendingDetail=null;
const scheduleDetail=fn=>{pendingDetail=fn;};
const params=new URLSearchParams(location.hash.slice(1));
const toBytes=f=>Uint8Array.from(atob(f.base64),ch=>ch.charCodeAt(0));
const sheet=new CSSStyleSheet();
sheet.replaceSync(`
body[data-app=civicdesk]{--accent:#4a5a9c;--soft:#eceef9}
body[data-app=civicdesk] .record{display:block}
body[data-page=mine] .collection-count{display:none}
.page .notice{background:#fff7e6;border:1px solid #f0d9a8;border-radius:10px;padding:10px 14px;margin:0 0 12px;font-size:13px;line-height:1.5}
.docket-row,.cmt-row{display:flex;flex-direction:column;gap:4px;width:100%;text-align:left}
.tag.warn{background:#fdecec;color:#9b2c2c}.tag.good{background:#e3f6ea;color:#1f6b45}
.group-title{margin:14px 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6e7c91}
.plain{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:6px;font-size:13px}
.paper{padding:28px 36px;display:flex;flex-direction:column;gap:14px}
.facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 24px}
.history{padding-left:18px;font-size:13px;line-height:1.6;margin:0}.history time{color:#6e7c91;font-size:12px}
.flow .field{display:flex;flex-direction:column;gap:6px}.flow textarea,.flow input,.flow select{padding:8px 10px;border:1px solid #dce1e9;border-radius:8px;font:inherit}.flow textarea{min-height:160px}.flow h3{margin:12px 0 4px}
.flow label.check{display:flex;gap:8px;align-items:flex-start;font-size:13px}.flow label.check input{width:auto}
.problems{color:#9b2c2c;font-size:13px;margin:0;padding-left:18px}
.review{background:var(--soft);border-radius:10px;padding:12px 14px;white-space:pre-wrap;font-size:14px;line-height:1.6}
.form-error:empty{display:none}
`);
document.adoptedStyleSheets=[...document.adoptedStyleSheets,sheet];
const tz=()=>uiRef&&uiRef.aux&&uiRef.aux.timezone?uiRef.aux.timezone:undefined;
const when=v=>new Intl.DateTimeFormat('en-US',{timeZone:tz(),month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(v));
const STATUS={open:'Open',extended:'Extended',closed:'Closed'};

export const config={
 id:'civicdesk',title:'CivicDesk',description:'Public comments on proposed rules.',
 list:T+'dockets.search',collection:'dockets',queryField:'query',listArgs:{status:'all'},get:T+'dockets.get',item:'docket',
 heading:d=>d.title,subtitle:d=>d.agency.acronym+' · '+STATUS[d.status],
 labels:{},actions:[],
 symbol:'§',searchLabel:'Search dockets, agencies, rules',initialSection:['open','closing','all','mine'].includes(params.get('page'))?params.get('page'):'open',
 empty:'No dockets match.',
 load:async ui=>{
  uiRef=ui;
  const aux={mine:null,error:null,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone};
  try{aux.mine=await ui.call(T+'comments.list_mine',{});}catch(e){aux.error=e.message;}
  return aux;
 },
 sections:()=>[
  {id:'open',label:'Open for comment',symbol:'◉',filter:d=>d.status!=='closed'},
  {id:'closing',label:'Closing soon',symbol:'⏱',filter:d=>d.closing_soon},
  {id:'all',label:'All dockets',symbol:'▤',filter:()=>true},
  {id:'mine',label:'My comments',symbol:'✎',filter:()=>false,count:false}
 ],
 sort:(a,b)=>(a.status==='closed')-(b.status==='closed')||(a.status==='closed'?Date.parse(b.closes_at)-Date.parse(a.closes_at):Date.parse(a.closes_at)-Date.parse(b.closes_at)),
 renderList:(shown,ui)=>{document.body.dataset.page=ui.section;if(pendingDetail){const f=pendingDetail;pendingDetail=null;setTimeout(()=>f().catch(ui.error),0);}
  return el('div',{class:'page'},ui.aux.error?el('div',{class:'notice',role:'alert'},ui.aux.error):null,ui.section==='mine'?mine(ui):dockets(shown,ui));},
 emptyView:ui=>ui.section==='mine'?el('div',{class:'empty'},el('h3',{},'Select a draft or comment')):el('div',{class:'empty'},el('h3',{},'Pick a docket'),el('p',{},'Each docket shows its deadline in the agency’s time zone.')),
 view:(d,ui)=>docket(d,ui)
};

// ---- dockets ----
function dockets(shown,ui){
 if(!shown.length)return el('div',{class:'empty'},el('h3',{},'No dockets match'),el('p',{},config.empty));
 return el('div',{},shown.map(d=>ui.record(d,el('div',{class:'docket-row'},
  el('div',{class:'row-top'},el('strong',{},d.agency.name),el('time',{},d.status==='closed'?'Closed '+date(d.closes_at):'Closes '+date(d.closes_at))),
  el('span',{class:'record-title'},d.docket_id+' · '+d.title),
  el('div',{class:'row-bottom'},d.status==='closed'?tag('Closed'):d.closing_soon?el('span',{class:'tag warn'},d.days_left+' day'+(d.days_left===1?'':'s')+' left'):el('span',{class:'tag good'},STATUS[d.status]),d.extended_from?tag('Extended'):null,d.corrections?tag(d.corrections+' correction'+(d.corrections===1?'':'s')):null,
   d.my_comment_ids.length?tag('Commented'):d.my_draft_id?tag('Draft'):null,el('small',{},d.document_count+' document'+(d.document_count===1?'':'s')))))));
}
function docket(d,ui){
 const actions=[];
 if(d.status!=='closed'&&ui.has(T+'comments.draft'))actions.push(el('button',{type:'button',class:'primary',onclick:()=>commentForm(ui,d,d.my_draft_id?(ui.aux.mine.drafts.find(x=>x.id===d.my_draft_id)||null):null)},d.my_draft_id?'Continue your draft':'Comment on this docket'));
 return el('article',{class:'paper'},
  el('div',{class:'reader-heading'},el('span',{class:'kicker'},d.agency.name+' ('+d.agency.acronym+') · docket '+d.docket_id),el('h2',{},d.title)),
  el('div',{class:'tags'},d.status==='closed'?tag('Closed'):el('span',{class:'tag good'},STATUS[d.status]),d.closing_soon?el('span',{class:'tag warn'},'Closing soon'):null,d.extended_from?tag('Extended from '+date(d.extended_from)):null),
  el('div',{class:'facts'},metadata('Comment period closes',d.closes_at_local),metadata('Opened',date(d.opened_at)),metadata('Agency time zone',d.agency.timezone),metadata('Public comments',String(d.public_comment_count))),
  el('div',{class:'actions'},...actions),
  el('h3',{},'Summary'),textBlock(d.summary),
  d.supplementary_information?el('div',{},el('h3',{},'Supplementary information'),textBlock(d.supplementary_information)):null,
  d.corrections.length?el('div',{},el('h3',{},'Corrections'),el('ol',{class:'history'},d.corrections.map(c=>el('li',{},el('time',{},when(c.at)),' ',c.text)))):null,
  el('h3',{},'Documents'),el('div',{class:'actions'},d.documents.map(x=>el('button',{type:'button',onclick:()=>downloadDocument(ui,d.id,x.id).catch(ui.error)},x.title+' ('+(x.mime_type==='application/pdf'?'PDF':'text')+', '+x.bytes+' bytes)'))),
  d.my_comment_ids.length?el('div',{},el('h3',{},'Your comments on this docket'),el('div',{class:'actions'},d.my_comment_ids.map(id=>el('button',{type:'button',onclick:()=>openComment(ui,id).catch(ui.error)},id)))):null,
  el('p',{class:'note-foot'},'Submitted comments are public and cannot be withdrawn.'));
}
async function downloadDocument(ui,docketId,documentId){
 const r=await ui.call(T+'dockets.documents',{id:docketId});
 const x=r.documents.find(y=>y.id===documentId);if(!x)throw new Error('Document not found');
 download(x.file.filename||documentId+(x.mime_type==='application/pdf'?'.pdf':'.txt'),x.file.mime_type,toBytes(x.file));
}

// ---- comment form, review, submit ----
function commentForm(ui,d,draft){
 const p=pane(),alert=el('p',{role:'alert',class:'form-error'}),problems=el('ul',{class:'problems'}),result=el('div',{});
 const text=el('textarea',{'data-field':'text','aria-label':'Comment text'},draft?draft.text:'');
 const kind=el('select',{'data-field':'kind','aria-label':'How you appear'},el('option',{value:'anonymous'},'Anonymous'),el('option',{value:'named'},'Under my name'));
 if(draft)kind.value=draft.submitter.kind;
 const name=el('input',{type:'text','data-field':'name',placeholder:'Your name as it will appear',value:draft&&draft.submitter.name?draft.submitter.name:''});
 const supplemental=el('input',{type:'checkbox','data-field':'supplemental'});if(draft&&draft.supplemental)supplemental.checked=true;
 const submitter=()=>({kind:kind.value,name:kind.value==='named'?(name.value||null):null,organization:null});
 const showProblems=list=>{problems.replaceChildren(...list.map(x=>el('li',{},x.message)));};
 const save=el('button',{type:'button'},'Save draft'),review=el('button',{type:'button',class:'primary'},'Review and submit');
 let current=draft;
 // Each write observes the version the previous write returned, so several saves in a row need no page refresh in between.
 const version=async()=>current&&current.version?current.version:(await ui.call(T+'comments.list_mine',{})).version;
 const saveDraft=async()=>{const args={docket_id:d.id,text:text.value,submitter:submitter(),supplemental:supplemental.checked,expected_version:await version(),request_id:'web-'+crypto.randomUUID()};if(current)args.id=current.id;const out=await ui.call(T+'comments.draft',args);current={id:out.id,version:out.version,text:text.value,submitter:submitter(),supplemental:supplemental.checked,problems:out.problems,ready:out.ready};showProblems(out.problems);return out;};
 save.onclick=async()=>{alert.textContent='';try{const out=await saveDraft();result.replaceChildren(el('p',{class:'notice',role:'status'},'Draft '+out.id+' saved'+(out.ready?' and ready to submit.':' with '+out.problems.length+' problem'+(out.problems.length===1?'':'s')+' to fix.')));}catch(e){alert.textContent=e.message;}};
 review.onclick=async()=>{alert.textContent='';try{const out=await saveDraft();if(!out.ready){result.replaceChildren(el('p',{class:'notice',role:'alert'},'Fix the problems above before submitting.'));return;}reviewStep(ui,d,current);}catch(e){alert.textContent=e.message;}};
 p.dataset.selectedId=d.id;
 p.replaceChildren(el('article',{class:'paper flow'},el('div',{class:'reader-heading'},el('span',{class:'kicker'},'Docket '+d.id+' · closes '+d.closes_at_local),el('h2',{},'Comment on: '+d.title)),
  el('label',{class:'field'},el('span',{},'Your comment'),text),el('label',{class:'field'},el('span',{},'How you appear on the public record'),kind),el('label',{class:'field'},el('span',{},'Name (named submissions only)'),name),
  el('label',{class:'check'},supplemental,el('span',{},'This is a supplemental comment adding to one I already submitted on this docket')),
  problems,el('div',{class:'form-actions'},save,review),alert,result));
}
function reviewStep(ui,d,draft){
 const p=pane(),alert=el('p',{role:'alert',class:'form-error'});
 const ack=el('input',{type:'checkbox','data-field':'acknowledged'});
 const submit=el('button',{type:'button',class:'primary'},'Submit comment');
 submit.onclick=async()=>{alert.textContent='';try{
  const out=await ui.call(T+'comments.submit',{id:draft.id,acknowledged:ack.checked,expected_version:draft.version||(await ui.call(T+'comments.list_mine',{})).version,request_id:'web-'+crypto.randomUUID()});
  await ui.navigate('mine');scheduleDetail(()=>showComment(ui,out.id,'Submitted. Tracking number '+out.tracking_number+'.'));await ui.refresh();
 }catch(e){alert.textContent=e.message;}};
 p.replaceChildren(el('article',{class:'paper flow'},el('div',{class:'reader-heading'},el('span',{class:'kicker'},'Docket '+d.id+' · '+(draft.submitter.kind==='anonymous'?'anonymous':'under the name '+draft.submitter.name)+(draft.supplemental?' · supplemental':'')),el('h2',{},'Review before submitting')),
  el('div',{class:'review'},draft.text),el('p',{},'Deadline: '+d.closes_at_local+'. '+draft.text.trim().length+' characters.'),
  el('label',{class:'check'},ack,el('span',{},'I acknowledge that this comment becomes part of the public record for docket '+d.id+' and cannot be withdrawn.')),
  el('div',{class:'form-actions'},el('button',{type:'button',onclick:()=>commentForm(ui,d,draft)},'Back to editing'),ui.has(T+'comments.submit')?submit:el('p',{class:'notice'},'Submitting is withheld for this account and policy.')),alert));
}

// ---- my comments ----
function mine(ui){
 const m=ui.aux.mine;
 if(!m)return el('div',{class:'empty'},el('h3',{},'Comments are not available'),el('p',{},ui.aux.error||'Loading…'));
 const draftRow=r=>el('button',{type:'button',class:'record cmt-row','data-record-id':r.id,'aria-pressed':'false',onclick:()=>showDraft(ui,r.id).catch(ui.error)},el('div',{class:'row-top'},el('strong',{},r.docket_id),el('time',{},date(r.updated_at))),el('span',{class:'record-title'},r.docket_title),el('div',{class:'row-bottom'},tag('Draft'),r.ready?el('span',{class:'tag good'},'Ready'):el('span',{class:'tag warn'},r.problems.length+' problem'+(r.problems.length===1?'':'s'))));
 const row=x=>el('button',{type:'button',class:'record cmt-row','data-record-id':x.id,'aria-pressed':'false',onclick:()=>showComment(ui,x.id).catch(ui.error)},el('div',{class:'row-top'},el('strong',{},x.docket_id),el('time',{},date(x.submitted_at))),el('span',{class:'record-title'},x.docket_title),el('div',{class:'row-bottom'},x.status==='posted'?el('span',{class:'tag good'},'Posted'):x.status==='returned'?el('span',{class:'tag warn'},'Returned'):tag('Received'),el('small',{},x.tracking_number)));
 return el('div',{},el('h3',{class:'group-title'},'Drafts'),...(m.drafts.length?m.drafts.map(draftRow):[el('p',{class:'snippet'},'No drafts.')]),el('h3',{class:'group-title'},'Submitted'),...(m.comments.length?m.comments.map(row):[el('p',{class:'snippet'},'No comments yet.')]));
}
async function openComment(ui,id){await ui.navigate('mine');await showComment(ui,id);}
async function showDraft(ui,id){
 const r=ui.aux.mine.drafts.find(x=>x.id===id);if(!r)return;mark(id);
 const d=(await ui.call(T+'dockets.get',{id:r.docket_id})).docket;
 commentForm(ui,d,r);
}
async function showComment(ui,id,notice=null){
 const x=(await ui.call(T+'comments.status',{id})).comment,receipt=(await ui.call(T+'comments.receipt',{id})).receipt;
 mark(id);
 const p=pane();p.dataset.selectedId=id;
 p.replaceChildren(el('article',{class:'paper'},notice?el('p',{class:'notice',role:'status'},notice):null,
  el('div',{class:'reader-heading'},el('span',{class:'kicker'},'Receipt · '+x.agency.name+' · docket '+x.docket_id),el('h2',{},'Tracking number '+x.tracking_number)),
  el('div',{class:'tags'},x.status==='posted'?el('span',{class:'tag good'},'Posted'):x.status==='returned'?el('span',{class:'tag warn'},'Returned'):tag('Received'),tag(x.submitter.kind==='anonymous'?'Anonymous':'Named: '+x.submitter.name),x.supplemental?tag('Supplemental'):null),
  el('div',{class:'facts'},metadata('Submitted',receipt.submitted_at_local),metadata('Docket',x.docket_title),metadata('Text SHA-256',x.text_sha256.slice(0,16)+'…'),metadata('Return reason',x.return_reason||'—')),
  el('h3',{},'Comment as submitted'),el('div',{class:'review'},x.text),
  el('h3',{},'History'),el('ol',{class:'history'},x.history.map(h=>el('li',{},el('time',{},when(h.at)),' ',el('strong',{},h.action.replace(/_/g,' ')),h.detail?' — '+h.detail:''))),
  x.notices.length?el('div',{},el('h3',{},'Notices'),el('ul',{class:'plain'},x.notices.map(n=>el('li',{},n.kind+' notice: '+n.status+' · '+when(n.at))))):null,
  el('div',{class:'actions'},el('button',{type:'button',onclick:async()=>{await ui.navigate('open');await ui.select(x.docket_id);}},'Open docket '+x.docket_id)),
  el('p',{class:'note-foot'},'A submitted comment is public and cannot be withdrawn.')));
}

await mount(config);
if(uiRef&&params.get('docket'))uiRef.select(params.get('docket')).catch(uiRef.error);
if(uiRef&&params.get('comment'))showComment(uiRef,params.get('comment')).catch(uiRef.error);
