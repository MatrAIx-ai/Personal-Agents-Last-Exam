import copy, unittest
from datetime import datetime,timedelta
from route_replay import replay

# Relevant fields transcribed from actual task seed 57651d4f; not an App snapshot.
P=[('lift','hill-cc','canal-cc','elevator',90,10,'fac-cc-lift'),('hill-cc-ep','hill-cc','hill-ep','walkway',120,150,None),('ep-stairs','hill-ep','canal-ep','stairs',60,20,None),('canal-ep-cc','canal-ep','canal-cc','walkway',120,150,None),('hill-ep-rr','hill-ep','hill-rr','walkway',120,150,None),('rr-ramp','hill-rr','canal-rr','ramp',150,120,None),('canal-rr-ep','canal-rr','canal-ep','walkway',120,150,None),('cc-supply','canal-cc','supply','walkway',600,480,None),('rowan-supply','rowan','supply','walkway',60,75,None)]
P[0]=('cc-lift',*P[0][1:]); paths=[dict(pathway_id='pw-'+k,from_=a,to=b,mode=m,seconds=s,length_m=d,facility_id=f,bidirectional=True) for k,a,b,m,s,d,f in P]
for p in paths:p['from']=p.pop('from_')
places=[dict(place_id='pl-'+k,access=[dict(node_id=n,seconds=s,length_m=d,step_free=True)]) for k,n,s,d in [('jules','hill-cc',120,150),('recipient-b','canal-cc',120,150),('recipient-c','supply',120,150),('rowan','rowan',60,75),('depot','hill-cc',0,0)]]
T=lambda h:'2026-11-21T'+h+':00+08:00'
seed=dict(pathways=paths,nodes=[dict(node_id=n) for n in sorted({p['from'] for p in paths}|{p['to'] for p in paths})],places=places,facilities=[dict(facility_id='fac-cc-lift',pathway_ids=['pw-cc-lift'],history=[dict(seq=1,status='out_of_service',since=T('09:00'),recorded_at=T('09:00'),expected_return='2026-11-23T09:00:00+08:00')])])

def make(start,end,ids,dep='14:30'):
    t=datetime.fromisoformat(T(dep)); depart=t.isoformat(); edges=[]; total=0; pos=start
    def add(b,link,**k):
        nonlocal t,total,pos
        nt=t+timedelta(seconds=link['seconds']);edges.append(dict(k,**{'from':pos,'to':b,'enter_at':t.isoformat(),'exit_at':nt.isoformat(),'length_m':link['length_m']}));t=nt;total+=link['length_m'];pos=b
    s=next(p for p in places if p['place_id']==start)['access'][0];add(s['node_id'],s,kind='access',link_id=f'acc:{start}:{s["node_id"]}',step_free=True)
    for id in ids:
        p=next(p for p in paths if p['pathway_id']=='pw-'+id);b=p['to'] if pos==p['from'] else p['from'];add(b,p,kind='pathway',pathway_id=p['pathway_id'],mode=p['mode'],facility_id=p['facility_id'],step_free=p['mode']!='stairs',uses_estimate=False,facility_status='in_service' if p['facility_id'] else None,facility_status_seq=0 if p['facility_id'] else None)
    s=next(p for p in places if p['place_id']==end)['access'][0];add(end,s,kind='access',link_id=f'acc:{end}:{s["node_id"]}',step_free=True)
    return dict(depart=depart,arrive=t.isoformat(),edges=edges,walk_m=total,step_free=all(e['step_free'] for e in edges),uses_estimates=[])

J,B,C,R='pl-jules','pl-recipient-b','pl-recipient-c','pl-rowan'
DETOUR=['hill-cc-ep','hill-ep-rr','rr-ramp','canal-rr-ep','canal-ep-cc']
class ReplayTests(unittest.TestCase):
    def check(self,it,start=J,end=B,s=seed,now='09:10',cut='17:00',dep='14:30',**kw):return replay(s,it,start,end,T(now),T(dep),T(cut),**kw)
    def valid(self):return make(J,B,DETOUR)
    def test_detour(self):self.assertEqual(self.check(self.valid())['seconds'],870)
    def test_lift_before_closure(self):self.assertEqual(self.check(make(J,B,['cc-lift']),now='08:00')['seconds'],330)
    def test_closed_lift(self):self.assertRaises(ValueError,self.check,make(J,B,['cc-lift']))
    def test_stairs(self):self.assertRaises(ValueError,self.check,make(J,B,['hill-cc-ep','ep-stairs','canal-ep-cc']))
    def test_counterfactual(self):self.assertEqual(self.check(make(J,C,['hill-cc-ep','ep-stairs','canal-ep-cc','cc-supply']),end=C,cut='14:52',step_free=False)['seconds'],1140)
    def test_supply_late(self):self.assertRaises(ValueError,self.check,make(J,C,DETOUR+['cc-supply']),end=C,cut='14:52')
    def test_rowan(self):self.assertEqual(self.check(make(R,C,['rowan-supply'],dep='14:20'),start=R,end=C,cut='14:52',dep='14:20')['seconds'],240)
    def test_edge_forgery(self):it=self.valid();it['edges'][2]['pathway_id']='pw-cc-lift';self.assertRaises(ValueError,self.check,it)
    def test_gap(self):it=self.valid();it['edges'][2]['enter_at']=T('14:31');self.assertRaises(ValueError,self.check,it)
    def test_metric(self):it=self.valid();it['edges'][1]['length_m']=0;self.assertRaises(ValueError,self.check,it)
    def test_budget(self):self.assertRaises(ValueError,self.check,self.valid(),max_walk=10)
    def test_empty(self):it=self.valid();it['edges']=[];self.assertRaises(ValueError,self.check,it)
    def test_access_only(self):self.assertEqual(self.check(make('pl-depot',J,[]),start='pl-depot',end=J)['seconds'],120)
    def test_unconfirmed_restore(self):it=make(J,B,['cc-lift']);it['edges'][1]['uses_estimate']=True;self.assertRaises(ValueError,self.check,it)
    def test_confirmed_restore(self):s=copy.deepcopy(seed);s['facilities'][0]['history'].append(dict(seq=2,status='restored',since=T('10:00'),recorded_at=T('10:00')));it=make(J,B,['cc-lift']);it['edges'][1]['facility_status_seq']=2;self.assertEqual(self.check(it,s=s,now='10:01')['seconds'],330)
    def test_stale_seq(self):s=copy.deepcopy(seed);s['facilities'][0]['history'].append(dict(seq=2,status='restored',since=T('10:00'),recorded_at=T('10:00')));self.assertRaises(ValueError,self.check,make(J,B,['cc-lift']),s=s,now='10:01')
    def test_wrong_endpoint(self):self.assertRaises(ValueError,self.check,self.valid(),end=C)
    def test_timezone(self):it=self.valid();it['depart']='2026-11-21T14:30:00';self.assertRaises(ValueError,self.check,it)
    def test_later_record_supersedes_effective_order(self):
        s=copy.deepcopy(seed)
        s['facilities'][0]['history'].append(dict(seq=2,status='restored',since=T('08:30'),recorded_at=T('10:00')))
        it=make(J,B,['cc-lift']);it['edges'][1]['facility_status_seq']=2
        self.assertEqual(self.check(it,s=s,now='10:01')['seconds'],330)
    def test_future_entry_uses_latest_known_record(self):
        from route_replay import facility_record, stamp
        h=[dict(seq=1,status='in_service',since=T('08:00'),recorded_at=T('09:00')),
           dict(seq=2,status='out_of_service',since=T('16:00'),recorded_at=T('10:00'))]
        self.assertEqual(facility_record(h,stamp(T('14:30')),stamp(T('12:00')))['seq'],2)
        self.assertEqual(facility_record(h,stamp(T('12:00')),stamp(T('12:00')))['seq'],1)
        self.assertEqual(facility_record(h,stamp(T('14:30')),stamp(T('09:30')))['seq'],1)
    def test_late_record_does_not_leak_future_knowledge(self):
        s=copy.deepcopy(seed)
        s['facilities'][0]['history'].append(dict(seq=2,status='restored',since=T('08:30'),recorded_at=T('10:00')))
        it=make(J,B,['cc-lift']);it['edges'][1]['facility_status_seq']=2
        self.assertRaises(ValueError,self.check,it,s=s,now='09:10')
if __name__=='__main__':unittest.main()
