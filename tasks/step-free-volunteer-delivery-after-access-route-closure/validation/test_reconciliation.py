import copy, unittest
from joint_certificate import certify, EvidenceConflict, _verify_traversal, stamp
from test_joint_certificate import base, order, H, ev, T, seed, make, J, B


def record(seq, status, since, recorded):
    return dict(seq=seq,status=status,since=T(since),recorded_at=T(recorded))


def lift_trace():
    es=copy.deepcopy(base());s=copy.deepcopy(seed);s['facilities'][0]['history']=[]
    es[0]['seed']=s;es[1]['itinerary']=make(J,B,['cc-lift'])
    return es,s


def late(es,s,history,at='16:40',index=13):
    snapshot=copy.deepcopy(s);snapshot['facilities'][0]['history']=history
    es.insert(index,ev('late','snapshot',at,'controller',revision=2,seed=snapshot))
    return es

class ReconcileTests(unittest.TestCase):
    def test_late_closure_after_receipt(self):
        es,s=lift_trace();late(es,s,[record(1,'out_of_service','14:33','16:40')])
        with self.assertRaises(EvidenceConflict):certify(order(es),H)
    def test_late_closure_after_claim(self):
        es,s=lift_trace();late(es,s,[record(1,'out_of_service','14:33','16:46')],at='16:46',index=len(es))
        with self.assertRaises(EvidenceConflict):certify(order(es),H)
    def test_late_closure_after_traversal(self):
        es,s=lift_trace();late(es,s,[record(1,'out_of_service','14:34','16:40')])
        self.assertTrue(certify(order(es),H)['complete'])
    def test_unrelated_late_closure(self):
        es=copy.deepcopy(base());s=copy.deepcopy(seed);h=s['facilities'][0]['history']+[record(2,'out_of_service','14:33','16:40')]
        late(es,s,h);self.assertTrue(certify(order(es),H)['complete'])
    def test_closure_restored_before_entry(self):
        es,s=lift_trace();late(es,s,[record(1,'out_of_service','14:00','16:39'),record(2,'in_service','14:31','16:40')]);self.assertTrue(certify(order(es),H)['complete'])
    def test_closure_at_entry(self):
        es,s=lift_trace();late(es,s,[record(1,'out_of_service','14:32','16:40')]);self.assertRaises(EvidenceConflict,certify,order(es),H)
    def test_later_record_supersedes_effective_timestamp(self):
        es,s=lift_trace();late(es,s,[record(1,'out_of_service','14:33','16:39'),record(2,'in_service','14:31','16:40')]);self.assertTrue(certify(order(es),H)['complete'])
    def test_same_effective_boundary_restored(self):
        es,s=lift_trace();late(es,s,[record(1,'out_of_service','14:33','16:39'),record(2,'in_service','14:33','16:40')]);self.assertTrue(certify(order(es),H)['complete'])
    def test_restored_after_traversal_still_conflict(self):
        es,s=lift_trace();late(es,s,[record(1,'out_of_service','14:33','16:39'),record(2,'in_service','14:34','16:40')]);self.assertRaises(EvidenceConflict,certify,order(es),H)
    def test_exact_exit_boundary(self):
        es,s=lift_trace();h=record(1,'out_of_service','14:33','16:40');h['since']='2026-11-21T14:33:30+08:00';late(es,s,[h]);self.assertTrue(certify(order(es),H)['complete'])
    def test_unknown_status(self):
        es,s=lift_trace();late(es,s,[record(1,'unknown','14:33','16:40')]);self.assertRaises(ValueError,certify,order(es),H)
    def test_future_knowledge_not_used(self):
        es,s=lift_trace();it=es[1]['itinerary'];s['facilities'][0]['history']=[record(1,'out_of_service','14:33','16:40')];_verify_traversal(it,{'seed':s},stamp(T('14:45')))

if __name__=='__main__':unittest.main()
