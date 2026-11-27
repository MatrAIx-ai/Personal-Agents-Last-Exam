"""Generate original M1 scene, schemas and metadata. No Python runtime dependency."""
import json,hashlib,shutil,subprocess
from pathlib import Path
APP=Path(__file__).resolve().parents[1];ROOT=APP.parents[1]
for n in ['schemas','fixtures','assets','contribution','gui/src','tests','examples']:(APP/n).mkdir(parents=True,exist_ok=True)
def write(p,v):(APP/p).write_text(json.dumps(v,indent=2)+'\n')
def load(p):return json.loads((ROOT/p).read_text())
def obj(p,r=None):return dict(type='object',properties=p,required=list(p) if r is None else r,additionalProperties=False)
def arr(i):return dict(type='array',items=i,maxItems=200)
def ref(n):return {'$ref':'seed.schema.json#/$defs/'+n}
def nullable(s):return {'anyOf':[s,{'type':'null'}]}
S=dict(type='string',minLength=1,maxLength=160);T=dict(type='string',maxLength=5000);N=dict(type='integer',minimum=0,maximum=9000000000000);V=dict(type='integer',minimum=1);B=dict(type='boolean');DT=dict(type='string',format='date-time');DAY=dict(type='string',pattern=r'^\d{4}-\d{2}-\d{2}$');JSON={}
keys=['drivers','vehicle','annual_mileage','garaging','vehicle_use','ownership','current_policy','monitoring_consent'];ckeys=['bi_per_person_cents','bi_per_accident_cents','property_damage_cents','collision_deductible_cents','comprehensive_deductible_cents','um_per_person_cents','um_per_accident_cents','medical_payments_cents','rental_daily_cents','rental_total_cents','rental_days','roadside_limit_cents','gap','pip']
values={'drivers':arr(obj({'person_id':S,'name':S,'years_licensed':N,'accidents':N,'violations':N,'excluded':B})),'vehicle':obj({'year':V,'make':S,'model':S,'vin':S}),'annual_mileage':N,'garaging':obj({'city':S,'state':S,'zip':S}),'vehicle_use':{'enum':['personal','commute','business']},'ownership':{'enum':['owned','financed','leased']},'current_policy':obj({'ends_on':DAY,'continuous_months':N,'lapse_days':N,'lender_requirements':arr(S)}),'monitoring_consent':B}
facts=obj({k:obj({'value':nullable(v),'status':{'enum':['confirmed','unknown']},'source_ref':nullable(S),'observed_at':DT}) for k,v in values.items()})
coverage=obj({k:obj({'status':{'enum':['requested','not_requested','offered','excluded','not_offered','unknown','not_applicable']},'value':nullable(B if k=='gap' else N)}) for k in ckeys})
rule=obj({'revision':V,'published_at':DT,'effective_at':DT,'required_fields':arr({'enum':keys+['coverage']}),'base_premium_cents':N,'low_mileage_threshold':N,'low_mileage_discount_cents':N,'installment_fee_cents':N,'rental_available':B,'collision_deductible_cents':nullable(N),'ask_mileage':B})
terms=obj({'starts_on':DAY,'term_months':V,'terms':coverage,'stage':{'enum':['conditional','written','estimate']},'premium_cents':N,'fees_cents':N,'taxes_cents':N,'total_cents':N,'installments_cents':arr(N),'discounts':arr(obj({'name':S,'amount_cents':N,'status':{'enum':['conditional','applied','not_applied']},'condition':T,'source_ref':S})),'conditions':arr(T)})
D={'version':obj({'epoch':V,'revision':N}),
 'source':obj({'id':S,'at':DT,'title':S,'facts':obj({k:nullable(v) for k,v in values.items()},[])}),
 'profile':obj({'id':S,'revision':V,'at':DT,'fields':facts,'source_ref':S}),
 'coverage':obj({'id':S,'revision':V,'at':DT,'starts_on':DAY,'term_months':V,'source_ref':S,'terms':coverage}),
 'provider':obj({'id':S,'name':S,'legal_entity':S,'description':T,'rules':arr(rule)}),
 'grant':obj({'id':S,'provider_id':S,'profile_revision':V,'fields':arr({'enum':keys+['coverage']}),'purpose':{'const':'quote'},'expires_at':DT,'revoked':B,'source_ref':S}),
 'preview':obj({'id':S,'kind':{'enum':['application','reply']},'provider_id':S,'profile_revision':V,'coverage_revision':V,'rule_revision':V,'grant_id':S,'application_id':nullable(S),'application_revision':N,'request_id':nullable(S),'payload':obj({**values,'coverage':obj({'starts_on':DAY,'term_months':V,'terms':coverage})},[]),'expires_at':DT}),
 'application_version':obj({'revision':V,'profile_revision':V,'coverage_revision':V,'rule_revision':V,'disclosure_id':S,'queue_id':S,'submitted_at':DT}),
 'application':obj({'id':S,'provider_id':S,'revision':V,'status':{'enum':['pending','needs_info','quoted','declined','withdrawn']},'versions':arr(ref('application_version')),'withdrawn_at':nullable(DT)}),
 'disclosure':obj({'id':S,'application_id':S,'application_revision':V,'provider_id':S,'profile_revision':V,'coverage_revision':V,'grant_id':S,'purpose':{'const':'quote'},'kind':{'enum':['application','reply']},'request_id':nullable(S),'payload':obj({**values,'coverage':obj({'starts_on':DAY,'term_months':V,'terms':coverage})},[]),'at':DT}),
 'request':obj({'id':S,'provider_id':S,'application_id':S,'application_revision':V,'fields':arr({'enum':keys+['coverage']}),'question':T,'reply_by':DT,'status':{'enum':['open','answered']},'disclosure_id':nullable(S),'source_ref':S}),
 'quote':obj({'id':S,'provider_id':S,'application_id':S,'application_revision':V,'profile_revision':V,'coverage_revision':V,'quote_id':S,'quote_revision':V,'issued_at':DT,'expires_at':DT,'source_ref':S,'terms':terms,'document_id':S,'terms_document_id':S,'document_sha256':S}),
 'document':obj({'id':S,'kind':{'enum':['quote_pdf','quote_terms','declaration']},'owner_id':S,'source_ref':S,'at':DT,'asset_id':S,'sha256':S,'mime_type':S,'bytes':N}),
 'note':obj({'text':T,'source_ref':S}),
 'comparison_version':obj({'revision':V,'at':DT,'quote_ids':arr(S),'notes':arr(ref('note')),'statuses':arr(obj({'quote_id':S,'status':S}))}),
 'comparison':obj({'id':S,'name':S,'versions':arr(ref('comparison_version'))}),
 'notice':obj({'id':S,'object_id':S,'at':DT,'title':S,'text':T})}
for n in ['quote','request']:D[n]['properties']['display_status']=S
groups={k:v for k,v in zip(['sources','profiles','coverages','providers','grants','previews','applications','disclosures','requests','quotes','documents','comparisons','notices'],['source','profile','coverage','provider','grant','preview','application','disclosure','request','quote','document','comparison','notice'])}
seed=obj({'account_id':S,'owner_person_id':S,'jurisdiction':{'const':'CL-DEMO'},'next_id':V,**{k:arr(ref(v)) for k,v in groups.items()}});seed.update({'$defs':D,'$schema':'https://json-schema.org/draft/2020-12/schema'});write('schemas/seed.schema.json',seed)
for n in ['state','resources','bundle','quality','asset-catalog','asset-descriptor','dataset','attachment-transfer']:shutil.copyfile(ROOT/'apps/files/schemas'/f'{n}.schema.json',APP/'schemas'/f'{n}.schema.json')
state=load('apps/files/schemas/state.schema.json');state['properties']['app_id']={'const':'coverline'};state['properties']['package_version']={'const':'0.1.0'};write('schemas/state.schema.json',state)
tools=[]
def tool(n,desc,p,out,w=False,required=None):
 inp=obj(p,required)
 if w:inp['properties'].update(request_id=S,expected_version=ref('version'));inp['required']+=['request_id','expected_version']
 output=obj({'status':S,'app_id':S,'version':ref('version'),**out},['status','app_id','version',*out]);output['properties']['duplicate']=B
 tools.append(dict(name='coverline.'+n,description=desc,scope='coverline.'+n,resource_target='current account',inputSchema=inp,outputSchema=output,read_only=not w))
tool('workspace.get','Read current observations and immutable history; no provider future-event queue.',{}, {'workspace':{'$ref':'seed.schema.json'},'now':DT})
tool('profile.get','Read immutable profile revisions and obtained sources.',{}, {'profiles':arr(ref('profile')),'sources':arr(ref('source'))})
tool('profile.update','Append source-backed profile facts; this never issues new disclosure consent.',{'fields':obj(facts['properties'],[]),'source_ref':S},{'profile':ref('profile')},True)
tool('coverage.get','Read requested coverage revisions separately from offered terms.',{}, {'coverages':arr(ref('coverage'))})
tool('coverage.update','Append an explicit sourced coverage request.',{'starts_on':DAY,'term_months':V,'terms':coverage,'source_ref':S},{'coverage':ref('coverage')},True)
for name,params,out in [('list',{}, {'providers':arr(ref('provider'))}),('get',{'id':S},{'provider':ref('provider')})]:tool('providers.'+name,'Read published fictional provider requirements/rules.',params,out)
tool('grants.list','Read provider/field/purpose/profile-bound grants from trusted user decisions.',{}, {'grants':arr(ref('grant'))})
tool('disclosures.preview','Store the exact consented payload and immutable source revisions.',{'provider_id':S,'grant_id':S,'fields':arr({'enum':keys+['coverage']}),'application_id':S,'information_request_id':S},{'preview':ref('preview')},True,['provider_id','grant_id'])
tool('applications.submit','Commit one local provider queue entry and immutable disclosure.',{'preview_id':S},{'application':ref('application'),'disclosure':ref('disclosure')},True)
for op in ['applications.amend','quotes.requote']:tool(op,'Commit an application revision through a current exact disclosure preview.',{'id':S,'preview_id':S},{'application':ref('application'),'disclosure':ref('disclosure')},True)
tool('applications.withdraw','Withdraw while preserving all earlier disclosures and quotes.',{'id':S},{'application':ref('application')},True)
tool('requests.list','Read provider questions and strict deadlines.',{}, {'requests':arr(ref('request'))})
tool('requests.reply','Commit exactly the question’s fields under current consent and source versions.',{'id':S,'preview_id':S},{'request':ref('request'),'disclosure':ref('disclosure')},True)
tool('quotes.list','Read exact offer versions and derived expiry/history status.',{}, {'quotes':arr(ref('quote'))})
tool('quotes.get','Read actual offered terms separately from the requested coverage.',{'id':S},{'quote':ref('quote'),'requested':ref('coverage')})
tool('documents.get','Download original PDF/JSON bytes under document-parent authority.',{'id':S},{'document':ref('document'),'file':{'$ref':'attachment-transfer.schema.json'}})
tool('comparisons.create','Pin actual quote versions and sourced notes.',{'name':S,'quote_ids':arr(S),'notes':arr(ref('note'))},{'comparison':ref('comparison')},True,['name','quote_ids'])
tool('comparisons.update','Append an optimistic comparison version without changing past collections.',{'id':S,'comparison_revision':V,'quote_ids':arr(S),'notes':arr(ref('note'))},{'comparison':ref('comparison')},True,['id','comparison_revision','quote_ids'])
tool('comparisons.get','Read all pinned collection revisions.',{'id':S},{'comparison':ref('comparison')})
tool('comparisons.export','Export a frozen manifest and exact original PDF/JSON bytes in a JSON bundle.',{'id':S,'revision':V},{'file':{'$ref':'attachment-transfer.schema.json'}},required=['id'])
tool('notices.list','Read stable source-owned Mail envelopes for trusted routing.',{}, {'notices':arr(obj({'notice':ref('notice'),'message':{'type':'object'},'attachment_message':nullable({'type':'object'})}))})
def toolrefs(x):
 if isinstance(x,list):return [toolrefs(v) for v in x]
 if isinstance(x,dict):return {k:('schemas/'+v if k=='$ref' and not v.startswith('schemas/') else toolrefs(v)) for k,v in x.items()}
 return x
write('tools.json',toolrefs(tools))
tuple_fields={'provider_id':S,'application_id':S,'application_revision':V}
events={
 'auto.grant_recorded':obj({'grant':ref('grant')}), 'auto.grant_revoked':obj({'grant_id':S,'source_ref':S}),
 'auto.profile_corrected':obj({'fields':obj({k:nullable(v) for k,v in values.items()},[]),'source_ref':S}),
 'auto.provider_rules_published':obj({'provider_id':S,'rule':rule,'source_ref':S}),
 'auto.information_requested':obj({**tuple_fields,'request_id':S,'fields':arr({'enum':keys+['coverage']}),'question':T,'reply_by':DT,'source_ref':S}),
 'auto.quote_delivered':obj({**tuple_fields,'profile_revision':V,'coverage_revision':V,'quote_id':S,'quote_revision':V,'issued_at':DT,'expires_at':DT,'terms':terms,'file':{'$ref':'attachment-transfer.schema.json'},'source_ref':S}),
 'auto.application_declined':obj({**tuple_fields,'reason':T,'source_ref':S})}
write('schemas/events.schema.json',{'$schema':'https://json-schema.org/draft/2020-12/schema','oneOf':[obj({'event_id':S,'at':DT,'operation':{'const':n},'payload':v}) for n,v in events.items()]})
app=load('apps/files/app.json');app.update(app_id='coverline',version='0.1.0',maintainer={'contact':'@genglinliu; upstream #46'},event_types=list(events),limitations=['M1: one synthetic owner/vehicle and two providers. Full four-provider/three-scene corpus and independent acceptance remain M2/M3.','No real insurance advice, purchase/binding, payment, credit inquiry or driving-data enrollment.']);app['capabilities']['ui']='Original Zebra-inspired quote comparison GUI';write('app.json',app)
c=load('apps/files/contribution/contribution.json');c.update(app_id='coverline',app_categories=['external']);c['events']['accepts']=[dict(type=n,schema_ref='schemas/events.schema.json',status='implemented') for n in events];c['shared_data']['cross_app_references']=True;c['notification_channels']=['channel.email','channel.email.attachments'];c['messaging']['publishes']=load('examples/workflows/delivery-to-mail/delivery/contribution/contribution.json')['messaging']['publishes'];write('contribution/contribution.json',c);shutil.copyfile(ROOT/'examples/apps/mail/schemas/router-message.schema.json',APP/'schemas/router-message.schema.json');shutil.copyfile(ROOT/'examples/apps/mail/schemas/router-attachments.schema.json',APP/'schemas/router-attachments.schema.json')
gui=load('apps/files/contribution/gui.json');gui.pop('renderer_ref',None);gui.update(surface_id='coverline-owner',state_connection=dict(app_ids=['coverline'],adapter='pale.mcp_bridge',authoritative_state='app_runtime'));gui['extensions'][0]['data']['stylesheet']='gui/src/style.css';write('contribution/gui.json',gui)
binding=load('examples/apps/mail/fixtures/binding.json');binding['accounts'] += [dict(app_id='coverline',account_id='coverline-maya',owner_person_id='person-maya'),dict(app_id='files',account_id='files-maya',owner_person_id='person-maya')];write('fixtures/binding.json',binding)
write('fixtures/policies.json',{p:dict(allow=[t['name'] for t in tools if p=='sandbox' or t['read_only']],constraints={}) for p in ['scenario','sandbox']})
now='2026-11-24T09:00:00-08:00';write('fixtures/clock.json',{'initial_time':now});write('registry.json',{'schema_version':1,'initial_time':now,'apps':[dict(app_id='coverline',version='0.1.0',path='.') ]})
write('package.json',dict(name='pale-coverline',version='0.1.0',private=True,license='MIT',engines={'node':'>=18'},scripts={'test':'node --test tests/*.test.cjs','example':'node examples/run.cjs','connected':'node examples/run-connected.cjs','demo':'node examples/serve-demo.cjs'}))
(APP/'service.cjs').write_text((ROOT/'apps/files/service.cjs').read_text().replace("fixedApp:'files'","fixedApp:'coverline'"));shutil.copyfile(ROOT/'apps/files/LICENSE',APP/'LICENSE')
data=dict(account_id='coverline-maya',owner_person_id='person-maya',jurisdiction='CL-DEMO',next_id=100,**{k:[] for k in groups})
facts0={'drivers':[{'person_id':'person-maya','name':'Maya Chen','years_licensed':14,'accidents':0,'violations':0,'excluded':False}],'vehicle':{'year':2021,'make':'Honda','model':'Civic','vin':'SYNTHETIC00000001'},'annual_mileage':12000,'garaging':{'city':'Los Angeles','state':'CA-DEMO','zip':'90026'},'vehicle_use':'commute','ownership':'owned','current_policy':{'ends_on':'2026-12-01','continuous_months':36,'lapse_days':0,'lender_requirements':[]},'monitoring_consent':False}
data['sources']=[dict(id='user-intake',at='2026-11-23T08:00:00-08:00',title='Trusted synthetic owner intake and declarations',facts=facts0),dict(id='odometer-note',at='2026-11-24T08:00:00-08:00',title='Owner-provided corrected mileage estimate',facts={'annual_mileage':15000}),dict(id='coverage-brief',at='2026-11-23T08:00:00-08:00',title='User requested coverage',facts={})]
data['profiles']=[dict(id='profile-v1',revision=1,at='2026-11-23T08:00:00-08:00',source_ref='user-intake',fields={k:dict(value=v,status='confirmed',source_ref='user-intake',observed_at='2026-11-23T08:00:00-08:00') for k,v in facts0.items()})]
limits=[10000000,30000000,10000000,50000,50000,10000000,30000000,500000,5000,150000,30,10000,False,None];requested={k:{'status':'not_applicable' if k=='pip' else 'requested','value':v} for k,v in zip(ckeys,limits)}
data['coverages']=[dict(id='coverage-v1',revision=1,at='2026-11-23T08:00:00-08:00',starts_on='2026-12-01',term_months=6,source_ref='coverage-brief',terms=requested)]
required=['drivers','vehicle','annual_mileage','garaging','vehicle_use','ownership','current_policy','coverage']
for letter,name,base,discount,fee,rental,deductible,ask in [('a','Harbor Mutual',65000,5000,500,True,None,True),('b','Juniper Auto',68000,2000,0,False,100000,False)]:
 pid='insurer-'+letter;data['providers'].append(dict(id=pid,name=name,legal_entity=name+' Demo Insurance Company',description='Fictional local provider; published deterministic six-month pricing rules.',rules=[dict(revision=1,published_at='2026-11-01T09:00:00-08:00',effective_at='2026-11-01T09:00:00-08:00',required_fields=required,base_premium_cents=base,low_mileage_threshold=12000,low_mileage_discount_cents=discount,installment_fee_cents=fee,rental_available=rental,collision_deductible_cents=deductible,ask_mileage=ask)]));data['grants'].append(dict(id='grant-'+letter,provider_id=pid,profile_revision=1,fields=required,purpose='quote',expires_at='2026-12-01T00:00:00-08:00',revoked=False,source_ref='trusted-user-decision-'+letter))
# Use the actual in-process handlers to author current submitted applications and originals.
script=r'''
const fs=require('node:fs'),path=require('node:path');let data=JSON.parse(fs.readFileSync(0,'utf8'));const m=require('./src/model.cjs'),{handleTool}=require('./src/operations.cjs'),{applyEvent}=require('./src/events.cjs'),{makeReply}=require('./src/provider.cjs');const files=[];
const ctx={virtual_now:'2026-11-24T09:00:00-08:00',binding:require('./fixtures/binding.json'),assets:{add({object_id,files:incoming}){return incoming.map(file=>{const asset_id='original-'+object_id;files.push({asset_id,object_id,file});return asset_id;});}}};
function call(n,a){const out=handleTool(ctx,data,'coverline.'+n,a);data=out.data;return out.result;}
for(const provider of data.providers){const preview=call('disclosures.preview',{provider_id:provider.id,grant_id:provider.id==='insurer-a'?'grant-a':'grant-b'}).preview,app=call('applications.submit',{preview_id:preview.id}).application;if(provider.id==='insurer-a')data=applyEvent(ctx,data,{operation:'auto.information_requested',payload:{provider_id:provider.id,application_id:app.id,application_revision:1,request_id:'question-mileage',fields:['annual_mileage'],question:'Please confirm the annual mileage from the supplied owner intake.',reply_by:'2026-11-25T17:00:00-08:00',source_ref:'harbor-question-1'}});data=applyEvent(ctx,data,{operation:'auto.quote_delivered',payload:makeReply(ctx,data,data.applications.find(a=>a.id===app.id))});}
m.validateSeed(ctx,data);console.log(JSON.stringify({data,files}));
'''
generated=json.loads(subprocess.run(['node','-e',script],input=json.dumps(data),text=True,capture_output=True,cwd=APP,check=True).stdout);data=generated['data'];assets=[]
import base64
for item in generated['files']:
 f=item['file'];b=base64.b64decode(f['base64']);filename=f['filename'];(APP/'assets'/filename).write_bytes(b);assets.append(dict(schema_version='pale.asset-descriptor.v1',asset_id=item['asset_id'],scope=dict(level='package',app_id='coverline'),roles=['content.attachment'],subjects=[dict(app_id='coverline',account_id='coverline-maya',object_type='document',object_id=item['object_id'])],mime_type=f['mime_type'],availability=dict(status='ready'),storage=dict(adapter='storage.file',path='assets/'+filename,packaging='bundled'),integrity=dict(bytes=len(b),sha256=f['sha256']),provenance=dict(dataset_id='coverline-m1',source_ids=['authored']),publication='public',access=dict(audience=['agent'],rule='parent_object'),media={},extensions=[]))
write('fixtures/minimal.json',data);dataset=load('apps/files/contribution/dataset.json');dataset.update(dataset_id='coverline-m1',version='0.1.0',description='Original synthetic two-provider auto quote scene; one owner/vehicle; no real underwriting or accounts.',expected_counts={'records':sum(len(data[k]) for k in groups),'assets':len(assets)});dataset['sources'][0].update(description='Authored synthetic owner/provider data and deterministic PDF/JSON originals.',license='CC0-1.0',generation=dict(method='deterministic script',tool='Coverline build-package.py and Node domain handlers',tool_version='0.1.0',seed=1,parameters={'scene':'m1'}));dataset['transformations']=['All prices and legal entities fictional; source revisions and written offer bytes preserved.'];write('contribution/dataset.json',dataset);write('contribution/assets.catalog.json',dict(schema_version='pale.asset-catalog.v1',catalog_id='coverline-originals',app_id='coverline',dataset_ref='dataset.json',assets=assets,extensions=[]))
write('tests/cases.json',{'read':{'name':'coverline.profile.get','args':{}}});write('examples/scenario.json',dict(event_id='owner-mileage-correction',at='2026-11-24T10:00:00-08:00',operation='auto.profile_corrected',payload={'fields':{'annual_mileage':15000},'source_ref':'trusted-correction-event'}))
print('Built Coverline M1:',len(data['providers']),'providers;',len(data['quotes']),'written originals;',sum(a['integrity']['bytes'] for a in assets),'bytes.')
