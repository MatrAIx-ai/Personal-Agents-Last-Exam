import unittest, copy, itertools
from joint_certificate import certify
from test_route_replay import seed,make,T,J,B,C,R,DETOUR

H={'id':'old','item':'KIT-A','recipient':'pl-recipient-a','at':'2026-11-19T17:00:00+08:00','delivered_at':'2026-11-19T16:59:00+08:00'}
def ev(id,kind,time,origin,**kw): return dict(id=id,kind=kind,at=T(time),origin=origin,**kw)
def order(es): return [dict(e,seq=i) for i,e in enumerate(es,1)]
def base():
    return [ev('s','snapshot','09:10','controller',revision=1,seed=seed),
            ev('bq','query','09:10','runtime',item='KIT-B',volunteer='Jules',snapshot_id='s',**{'from':J,'to':B},itinerary=make(J,B,DETOUR)),
            ev('bc','commit','09:11','agent',item='KIT-B',actor='Mina',volunteer='Jules',destination=B,route_id='bq',calendar_id='cal-b'),
            ev('bn','notice','09:12','agent',item='KIT-B',actor='Mina',destination=B,commit_id='bc'),
            ev('req','request','09:13','agent',item='SUPPLY-C',actor='Mina',volunteer='Rowan',destination=C),
            ev('acc','accept','14:10','controller',item='SUPPLY-C',actor='Rowan',destination=C,decision='accepted',request_id='req'),
            ev('cq','query','14:20','runtime',item='SUPPLY-C',volunteer='Rowan',snapshot_id='s',**{'from':R,'to':C},itinerary=make(R,C,['rowan-supply'],dep='14:20')),
            ev('cc','commit','14:20','agent',item='SUPPLY-C',actor='Mina',volunteer='Rowan',destination=C,route_id='cq',calendar_id='cal-c',accept_id='acc'),
            ev('cn','notice','14:20','agent',item='SUPPLY-C',actor='Mina',destination=C,commit_id='cc'),
            ev('cd','dispatch','14:20','controller',item='SUPPLY-C',volunteer='Rowan',commit_id='cc'),
            ev('cr','receipt','14:25','controller',item='SUPPLY-C',recipient=C,dispatch_id='cd',commit_id='cc',delivered_at=T('14:24')),
            ev('bd','dispatch','14:30','controller',item='KIT-B',volunteer='Jules',commit_id='bc'),
            ev('br','receipt','14:45','controller',item='KIT-B',recipient=B,dispatch_id='bd',commit_id='bc',delivered_at=T('14:45')),
            ev('bs','claim','16:45','agent',item='KIT-B',actor='Mina',receipt_id='br',delivered_at=T('14:45')),
            ev('cs','claim','16:45','agent',item='SUPPLY-C',actor='Mina',receipt_id='cr',delivered_at=T('14:24'))]
class JointTests(unittest.TestCase):
    def run_case(self,es): return certify(order(es),H)
    def mutate(self,id,**kw):return [dict(e,**kw) if e['id']==id else e for e in base()]
    def rejected(self,es): self.assertRaises(ValueError,self.run_case,es)
    def test_positive(self): self.assertTrue(self.run_case(base())['complete'])
    def test_noop(self): self.assertFalse(self.run_case([])['complete'])
    def test_forged_controller(self): self.rejected(self.mutate('acc',origin='agent'))
    def test_wrong_accept(self): self.rejected(self.mutate('cc',accept_id='req'))
    def test_wrong_destination(self): self.rejected(self.mutate('cc',destination=B))
    def test_wrong_route(self): self.rejected(self.mutate('cc',route_id='bq'))
    def test_stale_query(self): self.rejected(self.mutate('bq',snapshot_id='wrong'))
    def test_missing_notice(self): self.rejected([e for e in base() if e['id']!='cn'])
    def test_missing_dispatch(self): self.rejected([e for e in base() if e['id']!='cd'])
    def test_receipt_old_commit(self): self.rejected(self.mutate('cr',commit_id='bc'))
    def test_receipt_wrong_dispatch(self): self.rejected(self.mutate('cr',dispatch_id='bd'))
    def test_receipt_early(self): self.rejected(self.mutate('cr',delivered_at=T('14:23')))
    def test_claim_wrong_receipt(self): self.rejected(self.mutate('cs',receipt_id='br'))
    def test_claim_time_mismatch(self): self.rejected(self.mutate('cs',delivered_at=T('14:25')))
    def test_cancellation_invalidates(self):
        es=base();es.insert(4,ev('cancel','cancel','09:12','agent',item='KIT-B',actor='Mina',commit_id='bc'));self.rejected(es)
    def test_new_snapshot_invalidates(self):
        es=base();es.insert(11,ev('s2','snapshot','14:26','controller',revision=2,seed=seed));self.rejected(es)
    def test_nonmonotone_revision(self):
        es=base();es.insert(11,ev('s2','snapshot','14:26','controller',revision=1,seed=seed));self.rejected(es)
    def test_duplicate(self): es=base();es.insert(3,es[2]);self.rejected(es)
    def test_sequence_gap(self): es=order(base());es[5]['seq']=99;self.assertRaises(ValueError,certify,es,H)
    def test_requery_after_snapshot(self):
        es=base();es[11:11]=[ev('s2','snapshot','14:26','controller',revision=2,seed=seed),ev('bx','cancel','14:26','agent',item='KIT-B',actor='Mina',commit_id='bc'),dict(es[1],id='bq2',at=T('14:27'),snapshot_id='s2'),dict(es[2],id='bc2',at=T('14:28'),route_id='bq2'),dict(es[3],id='bn2',at=T('14:29'),commit_id='bc2')];es=[dict(e,commit_id='bc2') if e['id'] in ('bd','br') else e for e in es];self.assertTrue(self.run_case(es)['complete'])
    def test_reordered_same_timestamp_exhaustive(self):
        es=base();count=0
        for p in itertools.permutations(es[6:10]):
            try: self.run_case(es[:6]+list(p)+es[10:]);count+=1
            except ValueError: pass
        self.assertEqual(count,1)
    def test_preserved_item_mutation(self): self.rejected(self.mutate('bc',item='KIT-A'))
    def test_wrong_edge(self): es=copy.deepcopy(base());es[1]['itinerary']['edges'][1]['length_m']=0;self.rejected(es)
    def test_new_closure_during_traversal(self):
        es=base();s=copy.deepcopy(seed);s['facilities'][0]['history']=[];es[0]['seed']=s;es[1]['itinerary']=make(J,B,['cc-lift']);es[12]=dict(es[12],at=T('14:45'),delivered_at=T('14:45'));s2=copy.deepcopy(s);s2['facilities'][0]['history']=[dict(seq=1,status='out_of_service',since=T('14:33'),recorded_at=T('14:34'))];es.insert(12,ev('later','snapshot','14:34','controller',revision=2,seed=s2));self.rejected(es)
    def test_history_rewrite(self):
        es=base();s=copy.deepcopy(seed);s['facilities'][0]['history']=[];es.insert(11,ev('s2','snapshot','14:26','controller',revision=2,seed=s));self.rejected(es)
    def test_future_record(self):
        es=base();s=copy.deepcopy(seed);s['facilities'][0]['history'][0]['recorded_at']=T('10:00');es[0]['seed']=s;self.rejected(es)
    def test_unknown_event(self): self.rejected(self.mutate('bc',kind='unknown'))
if __name__=='__main__':unittest.main()
