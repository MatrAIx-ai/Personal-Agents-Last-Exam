"""Deterministic original Claimline scene and App-owned schemas. Standard library only."""
import copy,hashlib,json,shutil
from pathlib import Path
APP=Path(__file__).resolve().parents[1]
ROOT=APP.parents[1]
for name in ['schemas','fixtures','assets','contribution','examples','tests','gui/src']:(APP/name).mkdir(parents=True,exist_ok=True)
def write(name,value):(APP/name).write_text(json.dumps(value,indent=2)+'\n')
def load(name):return json.loads((ROOT/name).read_text())
def obj(props,required=None):return {'type':'object','properties':props,'required':list(props) if required is None else required,'additionalProperties':False}
def arr(items):return {'type':'array','items':items}
def ref(name):return {'$ref':'seed.schema.json#/$defs/'+name}
def nullable(s):return {'anyOf':[s,{'type':'null'}]}
S={'type':'string','minLength':1,'maxLength':200};TEXT={'type':'string','maxLength':4000};DATE={'type':'string','format':'date-time'};DAY={'type':'string','pattern':'^\\d{4}-\\d{2}-\\d{2}$'};N={'type':'integer','minimum':0,'maximum':9_000_000_000_000};V={'type':'integer','minimum':1,'maximum':1000000};B={'type':'boolean'}
CAT={'enum':['airfare','hotel','ground_transport','meals','conference','parking','toll','rail','personal','other']};PAY={'enum':['company_card','personal_card','cash']};HASH={'type':'string','pattern':'^[a-f0-9]{64}$'}
D={}
D['version']=obj({'epoch':V,'revision':N})
D['file_ref']=obj({'app_id':{'const':'files'},'id':S,'number':V,'sha256':HASH})
D['part']=obj({'category':CAT,'label':S,'date':DAY,'amount_cents':N,'personal':B})
D['trip']=obj({'id':S,'name':S,'purpose':TEXT,'start_date':DAY,'end_date':DAY,'cost_center':S,'source_ref':S,'revision':V})
D['charge_history']=obj({'source_revision':V,'status':{'enum':['pending','settled','refunded']},'amount_cents':N,'refund_cents':N,'at':DATE,'source_ref':S})
D['charge']=obj({'id':S,'lineage_id':S,'source_revision':V,'merchant':S,'date':DAY,'amount_cents':N,'refund_cents':N,'status':{'enum':['pending','settled','refunded']},'payment_type':PAY,'source_ref':S,'history':arr(ref('charge_history'))})
D['source']=obj({'id':S,'source_id':S,'source_revision':V,'merchant':S,'date':DAY,'amount_cents':N,'status':{'enum':['ready','voided']},'available_at':DATE,'available_until':DATE,'source_ref':S,'asset_id':S,'sha256':HASH,'byte_length':N,'items':arr(ref('part'))})
D['receipt']=obj({'id':S,'source_record_id':S,'source_id':S,'source_revision':V,'sha256':HASH,'asset_id':S,'byte_length':N,'registered_at':DATE,'file_ref':nullable(ref('file_ref'))})
D['line']=obj({'id':S,'report_id':S,'charge_id':nullable(S),'charge_revision':nullable(V),'receipt_id':nullable(S),'merchant':S,'date':DAY,'amount_cents':N,'category':CAT,'payment_type':PAY,'purpose':TEXT,'purpose_source_ref':TEXT,'attendees':arr(S),'cost_center':S,'itemizations':arr(ref('part')),'personal':B,'explanation':TEXT,'revision':V})
D['totals']=obj({k:N for k in ['gross_cents','company_paid_cents','employee_claim_cents','personal_liability_cents']})
D['snapshot']=obj({'revision':V,'submitted_at':DATE,'first_submitted_at':DATE,'trip':ref('trip'),'policy_ids':arr(S),'lines':arr(ref('line')),'totals':ref('totals')})
D['report']=obj({'id':S,'trip_id':S,'name':S,'status':{'enum':['draft','submitted','returned','approved','partially_approved','rejected','discarded']},'revision':V,'line_ids':arr(S),'snapshots':arr(ref('snapshot')),'first_submitted_at':nullable(DATE),'amend_by':nullable(DATE)})
D['reply']=obj({'at':DATE,'text':TEXT,'source_ref':S})
D['request']=obj({'id':S,'report_id':nullable(S),'recipient':S,'question':S,'status':{'enum':['open','answered','cancelled']},'at':DATE,'replies':arr(ref('reply'))})
D['policy']=obj({'id':S,'policy_id':S,'revision':V,'published_at':DATE,'effective_from':DAY,'effective_until':nullable(DAY),'timezone':S,'receipt_required_cents':N,'meal_limit_cents':N,'submit_days':V,'source_ref':S,'description':TEXT})
D['approval_map']={'type':'object','additionalProperties':N}
D['review']=obj({'id':S,'report_id':S,'report_revision':V,'decision':{'enum':['returned','approved','partially_approved','rejected']},'reason':S,'approved_line_amounts':ref('approval_map'),'at':DATE,'source_ref':S})
D['payment_history']=obj({'at':DATE,'status':{'enum':['scheduled','paid','failed']},'source_ref':S})
D['payment']=obj({'id':S,'report_id':S,'report_revision':V,'amount_cents':N,'status':{'enum':['scheduled','paid','failed']},'source_ref':S,'history':arr(ref('payment_history'))})
D['notice']=obj({'id':S,'report_id':S,'report_revision':V,'kind':S,'at':DATE,'title':S,'body':TEXT})
D['finding']=obj({'line_id':nullable(S),'code':S,'message':S,'severity':{'const':'error'}})
D['preview']=obj({'report_id':S,'report_revision':V,'totals':ref('totals'),'findings':arr(ref('finding')),'can_submit':B,'policy_ids':arr(S)})
D['payment_summary']=obj({k:N for k in ['approved_employee_cents','paid_cents','scheduled_cents','outstanding_cents','unreserved_cents']})
groups={'trips':'trip','charges':'charge','receipt_sources':'source','receipts':'receipt','lines':'line','reports':'report','requests':'request','policies':'policy','reviews':'review','payments':'payment','notices':'notice'}
seed=obj({'account_id':S,'owner_person_id':S,'employee_name':S,'company_name':S,'next_id':V,**{key:arr(ref(value)) for key,value in groups.items()}});seed['$defs']=D;seed['$schema']='https://json-schema.org/draft/2020-12/schema'
write('schemas/seed.schema.json',seed)
for name in ['state','resources','bundle','quality','asset-catalog','asset-descriptor','dataset','attachment-transfer']:shutil.copyfile(ROOT/'apps/files/schemas'/f'{name}.schema.json',APP/'schemas'/f'{name}.schema.json')
state=json.loads((APP/'schemas/state.schema.json').read_text());state['properties']['app_id']={'const':'claimline'};state['properties']['package_version']={'const':'0.1.0'};write('schemas/state.schema.json',state)
def schema(props,required=None):return obj(props,required)
file={'$ref':'attachment-transfer.schema.json'}
tools=[]
def tool(name,description,props,output,write_effect=False,required=None):
 name=name.replace('expense.','claimline.',1)
 inp=obj(props,required)
 if write_effect:inp['properties'].update({'request_id':S,'expected_version':ref('version')});inp['required']+=['request_id','expected_version']
 out=obj({'status':S,'app_id':S,'version':ref('version'),**output},['status','app_id','version',*output]);out['properties']['duplicate']=B
 tools.append({'name':name,'description':description,'scope':name,'resource_target':'current account','inputSchema':inp,'outputSchema':out,'read_only':not write_effect})
tool('expense.workspace.get','Read the employee workspace and visible business records.',{}, {'workspace':{'$ref':'seed.schema.json'}})
tool('expense.trips.list','List trip context.',{}, {'trips':arr(ref('trip'))})
trip_props={k:v for k,v in D['trip']['properties'].items() if k not in ['id','revision']}
tool('expense.trips.create','Create sourced trip context.',trip_props,{'trip':ref('trip')},True)
tool('expense.trips.update','Edit unfrozen trip context.',{'id':S,'patch':obj(trip_props,[])},{'trip':ref('trip')},True)
tool('expense.charges.list','Read pending/settled/refunded card lineage.',{}, {'charges':arr(ref('charge'))})
tool('expense.receipts.list','List available merchant originals and saved versions.',{}, {'sources':arr(ref('source')),'receipts':arr(ref('receipt'))})
tool('expense.receipts.download','Download an available original with its source/hash.',{'id':S},{'source':ref('source'),'file':file})
tool('expense.receipts.read','Read saved original bytes even after merchant expiry.',{'id':S},{'receipt':ref('receipt'),'file':file})
tool('expense.receipts.register','Save an obtained original; preserve its hash and optional Files version.',{'source_record_id':S,'file':file,'file_ref':nullable(ref('file_ref'))},{'receipt':ref('receipt')},True,['source_record_id','file'])
candidate=obj({'line_id':S,'charge_id':nullable(S),'merchant':S,'date':DAY,'amount_cents':N})
tool('expense.matches.preview','Suggest exact merchant/date/amount matches without changing associations.',{'receipt_id':S},{'receipt_id':S,'candidates':arr(candidate),'source':ref('source')})
for name in ['confirm','separate']:tool('expense.matches.'+name,'Explicitly '+name+' an evidence association.',{'line_id':S,**({'receipt_id':S} if name=='confirm' else {})},{'line':ref('line')},True)
line_props={k:v for k,v in D['line']['properties'].items() if k not in ['id','revision','receipt_id','charge_revision','itemizations','cost_center']}
tool('expense.lines.create','Create an expense linked to a draft report.',line_props,{'line':ref('line')},True,['report_id','merchant','date','amount_cents','category','payment_type','purpose','purpose_source_ref'])
patch_props={k:v for k,v in line_props.items() if k not in ['report_id','charge_id']}
tool('expense.lines.update','Edit an expense in a draft or returned report.',{'id':S,'patch':obj(patch_props,[])},{'line':ref('line')},True)
tool('expense.lines.itemize','Split hotel/tax/personal items while preserving the original total.',{'id':S,'items':arr(ref('part'))},{'line':ref('line')},True)
tool('expense.requests.create','Record an employee or merchant clarification request.',{'report_id':nullable(S),'recipient':S,'question':S},{'request':ref('request')},True,['recipient','question'])
tool('expense.requests.cancel','Cancel an outstanding request without deleting its history.',{'id':S},{'request':ref('request')},True)
tool('expense.policy.get','Read published policy versions and effective dates.',{}, {'policies':arr(ref('policy'))})
tool('expense.reports.list','List employee reports.',{}, {'reports':arr(ref('report'))})
tool('expense.reports.get','Read a report, findings, frozen revisions, review and payment totals.',{'id':S},{'report':ref('report'),'preview':ref('preview'),'payment':ref('payment_summary'),'reviews':arr(ref('review'))})
tool('expense.reports.create','Create a draft report for a trip.',{'trip_id':S,'name':S},{'report':ref('report')},True)
tool('expense.reports.preview','Read policy findings and company/employee/personal totals.',{'id':S},{'preview':ref('preview')})
for action in ['submit','withdraw','discard']:tool('expense.reports.'+action,action.capitalize()+' a report under its lifecycle rules.',{'id':S},{'report':ref('report')},True)
tool('expense.reports.export','Export a frozen report revision as original JSON bytes.',{'id':S,'revision':V},{'file':file},required=['id'])
tool('expense.payments.list','Read actual payment histories and approved/paid/outstanding amounts.',{}, {'payments':arr(ref('payment')),'reviews':arr(ref('review')),'summaries':arr(obj({'report_id':S,**D['payment_summary']['properties']}))})
tool('expense.notices.list','Read source-owned stable Mail notification envelopes for Infra routing.',{}, {'notices':arr(obj({'notice':ref('notice'),'message':{'type':'object'}}))})
def tool_refs(value):
 if isinstance(value,list):return [tool_refs(v) for v in value]
 if isinstance(value,dict):return {k:('schemas/'+v if k=='$ref' and not v.startswith('schemas/') else tool_refs(v)) for k,v in value.items()}
 return value
write('tools.json',tool_refs(tools))
event_props={
 'expense.charge_recorded':obj({'charge_id':S,'source_revision':V,'status':{'enum':['pending','settled','refunded']},'amount_cents':N,'refund_cents':N,'source_ref':S,'lineage_id':S,'merchant':S,'date':DAY,'payment_type':PAY},['charge_id','source_revision','status','source_ref']),
 'expense.receipt_delivered':obj({'source_id':S,'source_revision':V,'status':{'enum':['ready','voided']},'merchant':S,'date':DAY,'amount_cents':N,'available_until':DATE,'source_ref':S,'items':arr(ref('part')),'file':file},['source_id','source_revision','source_ref']),
 'expense.request_replied':obj({'request_id':S,'text':S,'source_ref':S}),
 'expense.policy_published':obj({'policy':ref('policy')}),
 'expense.review_recorded':obj({'report_id':S,'report_revision':V,'decision':D['review']['properties']['decision'],'reason':S,'approved_line_amounts':ref('approval_map'),'amend_by':DATE,'source_ref':S},['report_id','report_revision','decision','reason','source_ref']),
 'expense.payment_recorded':obj({'payment_id':S,'report_id':S,'report_revision':V,'amount_cents':N,'status':D['payment']['properties']['status'],'source_ref':S})}
write('schemas/events.schema.json',{'oneOf':[obj({'event_id':S,'at':DATE,'operation':{'const':name},'payload':payload}) for name,payload in event_props.items()]})
manifest=load('apps/files/app.json');manifest.update({'app_id':'claimline','version':'0.1.0','maintainer':{'contact':'@genglinliu; upstream PR #42'},'event_types':list(event_props),'capabilities':{'modes':['synthetic'],'resources':True,'ui':'App-owned SAP Concur-inspired GUI through the public Web Host','real_delivery':False},'limitations':['Simulated employer/employee, USD and one reviewer stage; no real payments.','Trusted Infra supplies reviews, payment proofs and source corrections.','First runnable conference scene; advanced OCR, FX, ERP, live cards, optional Finance bridge and additional scenes are deferred.']})
write('app.json',manifest)
(APP/'service.cjs').write_text((ROOT/'apps/files/service.cjs').read_text().replace("fixedApp:'files'","fixedApp:'claimline'"))
(APP/'LICENSE').write_text((ROOT/'LICENSE').read_text())
write('package.json',{'name':'pale-claimline','version':'0.1.0','private':True,'engines':{'node':'>=18'},'license':'MIT','scripts':{'test':'node --test tests/business.test.cjs','example':'node examples/run.cjs','test:runtime':'node --test tests/runtime.test.cjs','example:connected':'node examples/run-connected.cjs','test:browser':'node tests/browser.cjs'}})
c=load('apps/files/contribution/contribution.json');c['app_id']='claimline';c['app_categories']=['external'];c['events']['accepts']=[{**c['events']['accepts'][0],'type':name} for name in event_props];c['events']['emits']=[];c['shared_data']['cross_app_references']=True;c['notification_channels']=['channel.email'];c['messaging']['publishes']=load('examples/workflows/delivery-to-mail/delivery/contribution/contribution.json')['messaging']['publishes'];c['messaging']['publishes']=[p for p in c['messaging']['publishes'] if p['channel']=='channel.email'];c['messaging']['receives']=[]
write('contribution/contribution.json',c)
shutil.copyfile(ROOT/'examples/apps/mail/schemas/router-message.schema.json',APP/'schemas/router-message.schema.json')
gui=load('apps/files/contribution/gui.json');gui.pop('renderer_ref',None);gui.update({'status':'declared','surface_id':'claimline-reviewer','state_connection':{'app_ids':['claimline'],'adapter':'pale.mcp_bridge','authoritative_state':'app_runtime'},'routes':[{'route_id':name,'path':'/#'+name,'asset_bindings':[]} for name in ['reports','expenses','receipts','payments','policy']]});gui['extensions']=[{'namespace':'pale.web','version':'1','required':False,'data':{'page':'gui/index.html','controller':'gui/src/app.js','stylesheet':'gui/src/style.css','audience':['agent','user'],'host':'runtime/web/server.cjs','transport':'agent-mcp-bridge','status':'implemented'}}];write('contribution/gui.json',gui)
binding=load('examples/apps/mail/fixtures/binding.json');binding['accounts'].append({'app_id':'claimline','account_id':'claimline-maya','owner_person_id':'person-maya'});binding['accounts'].append({'app_id':'files','account_id':'files-maya','owner_person_id':'person-maya'});write('fixtures/binding.json',binding)
write('fixtures/policies.json',{'scenario':{'allow':[t['name'] for t in tools if t['read_only']],'constraints':{}},'sandbox':{'allow':[t['name'] for t in tools],'constraints':{}}})
write('registry.json',{'schema_version':1,'initial_time':'2026-11-09T09:00:00-08:00','apps':[{'app_id':'claimline','version':'0.1.0','path':'.'}]})
write('fixtures/clock.json',{'initial_time':'2026-11-09T09:00:00-08:00'})
data={'account_id':'claimline-maya','owner_person_id':'person-maya','employee_name':'Maya Chen','company_name':'Northstar Labs','next_id':100,**{key:[] for key in groups}}
data['trips']=[{'id':'trip-1','name':'Product Design Summit · Chicago','purpose':'Attend the product design conference and meet the Atlas project team.','start_date':'2026-11-01','end_date':'2026-11-05','cost_center':'ATLAS-240','source_ref':'employee-trip-brief','revision':1}]
for revision,start,end,limit,published in [(1,'2026-10-01','2026-11-07',7500,'2026-10-01T09:00:00-07:00'),(2,'2026-11-08',None,6500,'2026-11-08T09:00:00-08:00')]:data['policies'].append({'id':'travel-v'+str(revision),'policy_id':'travel','revision':revision,'published_at':published,'effective_from':start,'effective_until':end,'timezone':'America/Los_Angeles','receipt_required_cents':2500,'meal_limit_cents':limit,'submit_days':30,'source_ref':'employer-travel-policy-'+str(revision),'description':'Attach originals for expenses of $25 or more. Hotel items must sum to the original. Record meal attendees and explain meals above the limit. Personal items are not reimbursed; company-card business costs are centrally paid. Submit within 30 calendar days after travel.'})
entries=[('Lakefront House Hotel','2026-11-05',90000,'hotel','company_card'),('Aurora Air','2026-11-01',42000,'airfare','company_card'),('Cedar Table','2026-11-02',9600,'meals','personal_card'),('Union Cafe','2026-11-03',5400,'meals','personal_card'),('Orchard Kitchen','2026-11-04',6100,'meals','personal_card'),('City Ride','2026-11-01',4400,'ground_transport','personal_card'),('Metro Rail','2026-11-02',3200,'rail','company_card'),('City Ride','2026-11-05',2800,'ground_transport','cash'),('Summit Parking','2026-11-03',1800,'parking','company_card'),('Airport Parking','2026-11-05',1200,'parking','cash')]
assets=[]
def asset(asset_id,object_id,object_type,filename,body):
 b=body.encode();(APP/'assets'/filename).write_bytes(b);digest=hashlib.sha256(b).hexdigest();assets.append({'schema_version':'pale.asset-descriptor.v1','asset_id':asset_id,'scope':{'level':'package','app_id':'claimline'},'roles':['content.attachment'],'subjects':[{'app_id':'claimline','account_id':'claimline-maya','object_type':object_type,'object_id':object_id}],'mime_type':'text/plain','availability':{'status':'ready'},'storage':{'adapter':'storage.file','path':'assets/'+filename,'packaging':'bundled'},'integrity':{'bytes':len(b),'sha256':digest},'provenance':{'dataset_id':'claimline-conference','source_ids':['authored']},'publication':'public','access':{'audience':['agent'],'rule':'parent_object'},'media':{},'extensions':[]});return digest,len(b)
for i,(merchant,date,amount,category,payment) in enumerate(entries,1):
 items=[{'category':'hotel','label':'Four room nights','date':date,'amount_cents':72000,'personal':False},{'category':'hotel','label':'Room taxes','date':date,'amount_cents':9000,'personal':False},{'category':'parking','label':'Business parking','date':date,'amount_cents':5000,'personal':False},{'category':'personal','label':'Personal minibar','date':date,'amount_cents':4000,'personal':True}] if i==1 else []
 body=f'NORTHSTAR LABS · SYNTHETIC DEVELOPMENT RECEIPT\n\n{merchant}\nReceipt: DEMO-{i:03d}\nDate: {date}\nCurrency: USD\nPayment: {payment}\n\n'+''.join(f'{part["label"]:<24} ${part["amount_cents"]/100:.2f}\n' for part in items)+f'\nTOTAL USD ${amount/100:.2f}\n\nOriginal electronic merchant record. Fictional; not a real purchase.\n'
 source_id='merchant-'+str(i);record_id=source_id+'-v1';sha,length=asset('original-'+str(i),record_id,'receipt_source','receipt-'+str(i)+'.txt',body)
 data['receipt_sources'].append({'id':record_id,'source_id':source_id,'source_revision':1,'merchant':merchant,'date':date,'amount_cents':amount,'status':'ready','available_at':date+'T21:00:00-08:00','available_until':'2026-12-05T23:59:59-08:00','source_ref':'merchant-original-'+str(i),'asset_id':'original-'+str(i),'sha256':sha,'byte_length':length,'items':items})
 charge={'id':'charge-'+str(i),'lineage_id':'card-transaction-'+str(i),'source_revision':1,'merchant':merchant,'date':date,'amount_cents':amount,'refund_cents':0,'status':'settled','payment_type':payment,'source_ref':'card-source-'+str(i),'history':[{'source_revision':1,'status':'settled','amount_cents':amount,'refund_cents':0,'at':date+'T22:00:00-08:00','source_ref':'card-source-'+str(i)}]};data['charges'].append(charge)
 if i<=4:
  asset('saved-'+str(i),'receipt-'+str(i),'receipt','saved-'+str(i)+'.txt',body)
  data['receipts'].append({'id':'receipt-'+str(i),'source_record_id':record_id,'source_id':source_id,'source_revision':1,'sha256':sha,'asset_id':'saved-'+str(i),'byte_length':length,'registered_at':'2026-11-06T10:00:00-08:00','file_ref':None})
 data['lines'].append({'id':'line-'+str(i),'report_id':'report-1','charge_id':charge['id'],'charge_revision':1,'receipt_id':'receipt-'+str(i) if i<=4 else None,'merchant':merchant,'date':date,'amount_cents':amount,'category':category,'payment_type':payment,'purpose':'Atlas project conference travel and team meetings.','purpose_source_ref':'employee-trip-brief','attendees':['Maya Chen','Alex Rivera'] if category=='meals' else [],'cost_center':'ATLAS-240','itemizations':[],'personal':False,'explanation':'','revision':1})
data['reports']=[{'id':'report-1','trip_id':'trip-1','name':'Chicago Product Design Summit','status':'draft','revision':1,'line_ids':[r['id'] for r in data['lines']],'snapshots':[],'first_submitted_at':None,'amend_by':None}]
write('fixtures/minimal.json',data)
dataset=load('apps/files/contribution/dataset.json');dataset.update({'dataset_id':'claimline-conference','version':'0.1.0','description':'Original fictional company, trip, charges and electronic receipts. No actual employer or purchase data.','expected_counts':{'records':sum(len(data[g]) for g in groups),'assets':len(assets)}});dataset['sources'][0].update({'description':'Deterministically authored fictional conference and receipt originals.','license':'CC0-1.0','generation':{'method':'deterministic script','tool':'Claimline build-package.py','tool_version':'0.1.0','seed':1,'parameters':{'scene':'conference-first-runnable'}}});dataset['quality_policy']['duplicate_assets']='allow';dataset['transformations']=['Saved originals intentionally preserve the source bytes under separate resource parents.','Amounts are integer USD cents; no live financial data.'];write('contribution/dataset.json',dataset)
write('contribution/assets.catalog.json',{'schema_version':'pale.asset-catalog.v1','catalog_id':'claimline-originals','app_id':'claimline','dataset_ref':'dataset.json','assets':assets,'extensions':[]})
write('tests/cases.json',{'read':{'name':'claimline.trips.list','args':{}}})
write('examples/scenario.json',{'event_id':'pending-adjustment','at':'2026-11-09T10:00:00-08:00','operation':'expense.charge_recorded','payload':{'charge_id':'charge-3','source_revision':2,'status':'settled','amount_cents':9600,'source_ref':'merchant-tip-confirmation'}})
print('Built Claimline first conference scene:',len(data['lines']),'expenses;',len(assets),'assets;',sum(a['integrity']['bytes'] for a in assets),'bytes.')
