"""Original deterministic Tablewise M1 package. Python is generation-only."""
import copy,hashlib,json,shutil
from pathlib import Path
APP=Path(__file__).resolve().parents[1]; ROOT=APP.parents[1]
for p in ['src','schemas','fixtures','assets','contribution','gui/src','tests','examples']:(APP/p).mkdir(parents=True,exist_ok=True)
def write(p,v):(APP/p).write_text(json.dumps(v,indent=2)+'\n')
def load(p):return json.loads((ROOT/p).read_text())
def obj(p,r=None):return dict(type='object',properties=p,required=list(p) if r is None else r,additionalProperties=False)
def arr(p):return dict(type='array',items=p,maxItems=500)
def ref(n):return {'$ref':'seed.schema.json#/$defs/'+n}
S=dict(type='string',minLength=1,maxLength=200); T=dict(type='string',maxLength=5000); N=dict(type='integer',minimum=0,maximum=9000000000000); V=dict(type='integer',minimum=1); B=dict(type='boolean'); DT=dict(type='string',format='date-time'); DAY=dict(type='string',pattern=r'^\d{4}-\d{2}-\d{2}$'); NULL={'type':'null'}
def optional(p):return {'anyOf':[p,NULL]}
D={
 'version':obj({'epoch':V,'revision':N}),
 'terms':obj({'revision':V,'menu_cents':N,'minimum_cents':N,'service_bps':N,'tax_bps':N,'deposit_cents':N,'late_fee_cents':N,'cancel_hours':N,'asset_id':S}),
 'venue':obj({'id':S,'name':S,'cuisine':S,'neighborhood':S,'description':T,'max_party_size':V,'accessible':optional(B),'outdoor':optional(B),'terms':ref('terms')}),
 'slot':obj({'id':S,'venue_id':S,'starts_at':DT,'duration_minutes':V,'capacity':V,'external_booked_seats':N,'release_at':DT}),
 'participant':obj({'person_id':S,'name':S,'status':{'enum':['invited','accepted','pending','declined']},'dietary_note':T,'audience':{'enum':['host','kitchen']},'source_ref':S}),
 'plan':obj({'id':S,'name':S,'party_size':V,'participants':arr(ref('participant')),'revision':V,'status':{'enum':['active','historical']},'created_at':DT}),
 'grant':obj({'id':S,'venues':arr(S),'date_from':DAY,'date_to':DAY,'max_party_size':V,'max_active_bookings':V,'max_active_holds':V,'max_charge_cents':N,'max_deposit_cents':N,'max_fee_exposure_cents':N,'expires_at':DT,'revoked':B,'source_ref':S}),
 'hold':obj({'id':S,'slot_id':S,'party_size':V,'expires_at':DT,'status':{'enum':['held','released','consumed']}}),
 'cost':obj({'food_cents':N,'service_cents':N,'tax_cents':N,'total_cents':N,'deposit_cents':N,'balance_cents':N}),
 'snapshot':obj({'slot_id':S,'venue_id':S,'starts_at':DT,'party_size':V,'terms':ref('terms'),'cost':ref('cost'),'free_cancel_until':DT}),
 'preview':obj({'id':S,'kind':{'enum':['book','change','cancel']},'reservation_id':optional(S),'reservation_revision':N,'hold_id':optional(S),'grant_id':S,'snapshot':ref('snapshot'),'charge_cents':N,'fee_cents':N,'refund_due_cents':N,'expires_at':DT,'used':B}),
 'reservation':obj({'id':S,'plan_id':S,'revision':V,'status':{'enum':['confirmed','cancelled','attended','no_show']},'snapshot':ref('snapshot'),'guaranteed_headcount':V,'confirmed_at':DT,'cancelled_at':optional(DT),'deposit_paid_cents':N,'fee_cents':N,'refund_due_cents':N,'refund_paid_cents':N,'history':arr(ref('snapshot'))}),
 'receipt':obj({'id':S,'reservation_id':S,'kind':S,'at':DT,'text':T,'sha256':S}),
 'inquiry':obj({'id':S,'venue_id':S,'plan_id':S,'party_size':V,'menu_request':T,'status':{'enum':['pending','quoted']},'created_at':DT}),
 'quote':obj({'id':S,'inquiry_id':S,'revision':V,'available':B,'guaranteed_headcount':V,'minimum_cents':N,'valid_until':DT,'dietary_reply':T,'source_ref':S}),
 'refund':obj({'id':S,'reservation_id':S,'amount_cents':N,'source_ref':S,'at':DT}),
 'notice':obj({'id':S,'reservation_id':S,'at':DT,'title':S,'text':T}),
 'history':obj({'id':S,'plan_name':S,'venue_id':S,'date':DAY,'party_size':V,'total_cents':N,'source_ref':S}),
}
groups={'venues':'venue','slots':'slot','plans':'plan','grants':'grant','holds':'hold','previews':'preview','reservations':'reservation','receipts':'receipt','inquiries':'inquiry','quotes':'quote','refunds':'refund','notices':'notice','history':'history'}
seed=obj({'account_id':S,'owner_person_id':S,'next_id':V,'overlap_policy':{'enum':['strict_gap','bounded_overlap']},**{k:arr(ref(v)) for k,v in groups.items()}});seed['$defs']=D;seed['$schema']='https://json-schema.org/draft/2020-12/schema';write('schemas/seed.schema.json',seed)
for n in ['state','resources','bundle','quality','asset-catalog','asset-descriptor','dataset','attachment-transfer']:shutil.copyfile(ROOT/'apps/files/schemas'/f'{n}.schema.json',APP/'schemas'/f'{n}.schema.json')
state=load('apps/files/schemas/state.schema.json');state['properties']['app_id']={'const':'tablewise'};state['properties']['package_version']={'const':'0.1.0'};write('schemas/state.schema.json',state)
tools=[]
def tool(n,desc,p,out,w=False,r=None):
 inp=obj(p,r)
 if w:inp['properties'].update(request_id=S,expected_version=ref('version'));inp['required']+=['request_id','expected_version']
 output=obj({'status':S,'app_id':S,'version':ref('version'),**out},['status','app_id','version',*out]);output['properties']['duplicate']=B
 tools.append(dict(name='tablewise.'+n,description=desc,scope='tablewise.'+n,resource_target='current account',inputSchema=inp,outputSchema=output,read_only=not w))
tool('workspace.get','Read the visible workspace; no future event queue.',{}, {'workspace':{'$ref':'seed.schema.json'},'now':DT})
tool('venues.search','Search fictional venue metadata; null means unknown.',{'query':T,'cuisine':T,'max_menu_cents':N},{'venues':arr(ref('venue'))},r=[])
tool('venues.get','Read published venue details and terms.',{'id':S},{'venue':ref('venue')})
tool('venues.document','Download original electronic venue menu and terms.',{'id':S},{'file':{'$ref':'attachment-transfer.schema.json'}})
tool('availability.get','Read released inventory; expired holds consume no seats.',{'venue_id':S,'date':DAY,'party_size':V},{'slots':arr(obj({'slot':ref('slot'),'status':S,'available_seats':N}))},r=['party_size'])
tool('plans.get','Read outing participants and expected attendance.',{}, {'plan':ref('plan'),'expected_attendance':N})
tool('plans.update','Edit outing name and intended party size; responses need trusted events.',{'name':S,'party_size':V},{'plan':ref('plan')},True,r=[])
tool('holds.create','Hold currently available seats for five virtual minutes.',{'slot_id':S,'party_size':V,'grant_id':S},{'hold':ref('hold')},True)
tool('holds.release','Release an unconsumed hold.',{'id':S},{'hold':ref('hold')},True)
tool('reservations.preview','Freeze exact booking price, terms and cancellation cutoff.',{'hold_id':S,'grant_id':S},{'preview':ref('preview')},True)
tool('reservations.confirm','Recheck and atomically confirm a preview and simulated deposit.',{'preview_id':S},{'reservation':ref('reservation'),'receipt':ref('receipt')},True)
tool('reservations.get','Read one reservation including frozen accepted terms and refund totals.',{'id':S},{'reservation':ref('reservation')})
tool('reservations.change_preview','Preview a new slot/headcount without changing the original.',{'id':S,'slot_id':S,'party_size':V,'grant_id':S},{'preview':ref('preview')},True)
tool('reservations.change_confirm','Commit an exact amendment; failures preserve the original.',{'preview_id':S},{'reservation':ref('reservation'),'receipt':ref('receipt')},True)
tool('reservations.cancel_preview','Preview the accepted fee, deposit credit and refund due.',{'id':S,'grant_id':S},{'preview':ref('preview')},True)
tool('reservations.cancel_confirm','Cancel once; actual refund remains pending for provider evidence.',{'preview_id':S},{'reservation':ref('reservation'),'receipt':ref('receipt')},True)
tool('inquiries.create','Request group/private dining; no booking or dietary promise is created.',{'venue_id':S,'party_size':V,'menu_request':T},{'inquiry':ref('inquiry')},True)
tool('inquiries.get','Read a group request and source-backed venue quote revisions.',{'id':S},{'inquiry':ref('inquiry'),'quotes':arr(ref('quote'))})
tool('receipts.get','Download exact original UTF-8 booking/amendment/cancellation receipt.',{'id':S},{'receipt':ref('receipt'),'file':{'$ref':'attachment-transfer.schema.json'}})
tool('notices.list','Read source-owned stable text and attachment messages for Infra delivery.',{}, {'notices':arr(obj({'notice':ref('notice'),'message':{'type':'object'},'attachment_message':{'type':'object'}}))})
def toolrefs(x):
 if isinstance(x,list):return [toolrefs(v) for v in x]
 if isinstance(x,dict):return {k:('schemas/'+v if k=='$ref' and not v.startswith('schemas/') else toolrefs(v)) for k,v in x.items()}
 return x
write('tools.json',toolrefs(tools))
events={
 'dining.inventory_changed':obj({'slot_id':S,'external_booked_seats':N,'source_ref':S}),
 'dining.authority_recorded':obj({'grant':ref('grant')}),
 'dining.authority_revoked':obj({'grant_id':S,'source_ref':S}),
 'dining.participant_replied':obj({'plan_id':S,'person_id':S,'status':{'enum':['accepted','pending','declined']},'source_ref':S}),
 'dining.venue_quoted':obj({'quote':ref('quote')}),
 'dining.terms_published':obj({'venue_id':S,'terms':ref('terms'),'source_ref':S}),
 'dining.refund_recorded':obj({'refund_id':S,'reservation_id':S,'amount_cents':N,'source_ref':S}),
 'dining.venue_cancelled':obj({'reservation_id':S,'reason':S,'source_ref':S}),
}
write('schemas/events.schema.json',{'$schema':'https://json-schema.org/draft/2020-12/schema','oneOf':[obj({'event_id':S,'at':DT,'operation':{'const':n},'payload':p}) for n,p in events.items()]})
app=load('apps/files/app.json');app.update(app_id='tablewise',version='0.1.0',maintainer={'contact':'@genglinliu; upstream PR #40'},event_types=list(events),limitations=['M1: search, holds, booking/change/cancel, inquiry, Mail. Waitlists, group quote booking, scoped sharing/contributions and additional scenes remain M2.','Fictional USD payments; no live restaurant service.']);app['capabilities']['ui']='Original OpenTable-inspired diner GUI';write('app.json',app)
c=load('apps/files/contribution/contribution.json');c.update(app_id='tablewise',app_categories=['external']);c['events']['accepts']=[dict(type=n,schema_ref='schemas/events.schema.json',status='implemented') for n in events];c['shared_data']['cross_app_references']=True;c['notification_channels']=['channel.email','channel.email.attachments'];c['messaging']['publishes']=load('examples/workflows/delivery-to-mail/delivery/contribution/contribution.json')['messaging']['publishes'];write('contribution/contribution.json',c)
for name in ['router-message','router-attachments']:shutil.copyfile(ROOT/'examples/apps/mail/schemas'/f'{name}.schema.json',APP/'schemas'/f'{name}.schema.json')
gui=load('apps/files/contribution/gui.json');gui.pop('renderer_ref',None);gui.update(surface_id='tablewise-diner',state_connection=dict(app_ids=['tablewise'],adapter='pale.mcp_bridge',authoritative_state='app_runtime'));gui['extensions'][0]['data']['stylesheet']='gui/src/style.css';write('contribution/gui.json',gui)
binding=load('examples/apps/mail/fixtures/binding.json');binding['accounts'].append(dict(app_id='tablewise',account_id='tablewise-maya',owner_person_id='person-maya'));write('fixtures/binding.json',binding)
write('fixtures/policies.json',{p:{'allow':[t['name'] for t in tools if p=='sandbox' or t['read_only']],'constraints':{}} for p in ['scenario','sandbox']})
now='2026-11-24T09:00:00-08:00';write('fixtures/clock.json',{'initial_time':now});write('registry.json',{'schema_version':1,'initial_time':now,'apps':[dict(app_id='tablewise',version='0.1.0',path='.') ]})
data=dict(account_id='tablewise-maya',owner_person_id='person-maya',next_id=100,overlap_policy='strict_gap',**{k:[] for k in groups});assets=[]
names=[('Juniper & Ash','Californian','Silver Lake',20000,2),('Casa Luma','Italian','Arts District',6000,12),('Sora Counter','Japanese','Little Tokyo',18500,2),('The Citrus Room','Mediterranean','Pasadena',8500,16),('Copper Finch','American','Los Feliz',7500,8),('Marée Kitchen','French','Santa Monica',12000,6)]
for i,(name,cuisine,area,price,cap) in enumerate(names,1):
 vid='venue-'+str(i);aid='menu-'+str(i);body=f'{name}\nFictional electronic menu and booking policy · v1\n\nSet menu per guest: USD {price/100:.2f}\nService: 20% of food; tax: 10% of food. Round each charge to nearest cent.\nMinimum food spend: USD {600 if i==2 else 0:.2f}\nDeposit per booking: USD 100.00. Late cancellation fee: USD 150.00 all-in.\nFree cancellation ends 24 hours before the sitting; equality is late.\nPublished booking release: explicit slot.release_at in America/Los_Angeles.\nAccessibility: '+('step-free entrance' if i%2 else 'unknown')+'\nNo kitchen accommodation is promised without a venue response.\nOriginal synthetic document; not a real restaurant.\n'
 (APP/'assets'/f'{aid}.txt').write_text(body);b=body.encode();assets.append(dict(schema_version='pale.asset-descriptor.v1',asset_id=aid,scope=dict(level='package',app_id='tablewise'),roles=['content.attachment'],subjects=[dict(app_id='tablewise',account_id='tablewise-maya',object_type='venue',object_id=vid)],mime_type='text/plain',availability=dict(status='ready'),storage=dict(adapter='storage.file',path=f'assets/{aid}.txt',packaging='bundled'),integrity=dict(bytes=len(b),sha256=hashlib.sha256(b).hexdigest()),provenance=dict(dataset_id='tablewise-m1',source_ids=['authored']),publication='public',access=dict(audience=['agent'],rule='parent_object'),media={},extensions=[]))
 data['venues'].append(dict(id=vid,name=name,cuisine=cuisine,neighborhood=area,description=['Seasonal tasting menus, warm timber and a relaxed evening.','Handmade pasta and a private room for gathering.','An intimate counter with a changing omakase menu.','Garden dining and bright Mediterranean plates.','A neighborhood dining room with a seasonal menu.','Coastal French cooking in an intimate dining room.'][i-1],max_party_size=cap,accessible=True if i%2 else None,outdoor=True if i==4 else None,terms=dict(revision=1,menu_cents=price,minimum_cents=60000 if i==2 else 0,service_bps=2000,tax_bps=1000,deposit_cents=10000,late_fee_cents=15000,cancel_hours=24,asset_id=aid)))
 for d in ['2026-11-28','2026-11-29']:
  for hour in [17,19,21]:data['slots'].append(dict(id=f'slot-{i}-{d[-2:]}-{hour}',venue_id=vid,starts_at=f'{d}T{hour}:00:00-08:00',duration_minutes=120,capacity=cap,external_booked_seats=0,release_at='2026-11-24T10:00:00-08:00' if i==3 else '2026-11-01T10:00:00-08:00'))
data['plans']=[dict(id='plan-1',name='An evening together',party_size=2,participants=[dict(person_id='person-maya',name='Maya Chen',status='accepted',dietary_note='',audience='host',source_ref='trusted-user-brief'),dict(person_id='person-alex',name='Alex Rivera',status='pending',dietary_note='Please ask about a nut-free option.',audience='kitchen',source_ref='guest-preference')],revision=1,status='active',created_at=now)]
data['grants']=[dict(id='grant-1',venues=[v['id'] for v in data['venues']],date_from='2026-11-28',date_to='2026-11-29',max_party_size=12,max_active_bookings=2,max_active_holds=2,max_charge_cents=20000,max_deposit_cents=30000,max_fee_exposure_cents=30000,expires_at='2026-11-30T23:59:59-08:00',revoked=False,source_ref='trusted-user-brief')]
for year in [2025,2026]:
 for month in range(1,13):
  if year==2026 and month>11:break
  date=f'{year}-{month:02d}-01';data['history'].append(dict(id=f'history-{year}-{month}',plan_name='Dinner with friends',venue_id=f'venue-{month%6+1}',date=date,party_size=2,total_cents=19500,source_ref='synthetic-dining-history'))
write('fixtures/minimal.json',data)
dataset=load('apps/files/contribution/dataset.json');dataset.update(dataset_id='tablewise-m1',version='0.1.0',description='Original fictional six-venue scene and monthly historical activity from 2025-01-01. Task-ready timeline starts 2026-01-01.',expected_counts={'records':sum(len(data[k]) for k in groups),'assets':len(assets)});dataset['sources'][0].update(description='Deterministically authored synthetic restaurant scene and original electronic menus.',license='CC0-1.0',generation=dict(method='deterministic script',tool='Tablewise build-package.py',tool_version='0.1.0',seed=1,parameters={'scene':'m1'}));dataset['transformations']=['All prices and venues fictional; amounts are USD integer cents.'];write('contribution/dataset.json',dataset);write('contribution/assets.catalog.json',dict(schema_version='pale.asset-catalog.v1',catalog_id='tablewise-originals',app_id='tablewise',dataset_ref='dataset.json',assets=assets,extensions=[]))
write('tests/cases.json',{'read':{'name':'tablewise.venues.search','args':{}}});write('examples/scenario.json',dict(event_id='other-diner-1',at='2026-11-24T09:01:00-08:00',operation='dining.inventory_changed',payload={'slot_id':'slot-2-28-19','external_booked_seats':2,'source_ref':'external-booking-1'}))
write('package.json',dict(name='pale-tablewise',version='0.1.0',private=True,license='MIT',scripts={'test':'node --test tests/*.test.cjs','example':'node examples/run.cjs','connected':'node examples/run-connected.cjs'},engines={'node':'>=18'}))
(APP/'service.cjs').write_text((ROOT/'apps/files/service.cjs').read_text().replace("fixedApp:'files'","fixedApp:'tablewise'"));shutil.copyfile(ROOT/'apps/files/LICENSE',APP/'LICENSE')
print('Built Tablewise M1:',len(data['venues']),'venues;',len(data['history']),'historical outings;',len(assets),'originals.')
