import random
import unittest
from datetime import datetime, timedelta, timezone
from facility_timeline import FacilityTimeline, traversal_conflict
from route_replay import stamp

BASE = datetime(2026, 11, 21, tzinfo=timezone.utc)

def dt(x):
    return (BASE + timedelta(seconds=x)).isoformat()

def ts(x):
    return BASE.timestamp() + x

def row(seq, since, recorded, status):
    return dict(seq=seq, since=dt(since), recorded_at=dt(recorded), status=status)

def reference(history, as_of, entry, exit_):
    known = [h for h in history if stamp(h['recorded_at']) <= as_of]
    boundaries = sorted({entry} | {stamp(h['since']) for h in known
                                  if entry < stamp(h['since']) < exit_})
    for t in boundaries:
        h = next((h for h in reversed(known) if stamp(h['since']) <= t), None)
        if h is not None and h['status'] == 'out_of_service':
            return h['seq']
    return None

class TimelineTests(unittest.TestCase):
    def test_empty(self):
        self.assertIsNone(FacilityTimeline([], ts(100)).conflict(ts(0), ts(100)))

    def test_half_open_and_zero_duration(self):
        t = FacilityTimeline([row(1, 5, 5, 'out_of_service')], ts(20))
        self.assertIsNone(t.conflict(ts(0), ts(5)))
        self.assertEqual(t.conflict(ts(5), ts(5)), 1)
        self.assertEqual(t.conflict(ts(0), ts(6)), 1)

    def test_late_correction_and_same_boundary(self):
        h = [row(1, 8, 9, 'out_of_service'), row(2, 4, 12, 'restored'),
             row(3, 4, 13, 'out_of_service')]
        self.assertEqual(FacilityTimeline(h, ts(10)).conflict(ts(4), ts(10)), 1)
        self.assertIsNone(FacilityTimeline(h, ts(12)).conflict(ts(4), ts(12)))
        self.assertEqual(FacilityTimeline(h, ts(13)).conflict(ts(4), ts(13)), 3)

    def test_unknown_future_not_used(self):
        h = [row(1, 3, 11, 'unknown')]
        self.assertIsNone(FacilityTimeline(h, ts(10)).conflict(ts(0), ts(10)))
        with self.assertRaises(ValueError):
            FacilityTimeline(h, ts(11))

    def test_invalid_sequence(self):
        with self.assertRaises(ValueError):
            FacilityTimeline([row(None, 1, 1, 'out_of_service')], ts(10))

    def test_invalid_interval(self):
        t = FacilityTimeline([], ts(10))
        for a,b in [(3,2),(3,11)]:
            with self.assertRaises(ValueError):
                t.conflict(ts(a),ts(b))

    def test_traversal_multiple_edges(self):
        snapshot = {'seed': {'facilities': [
            {'facility_id': 'lift', 'history': [row(1, 5, 7, 'out_of_service')]},
            {'facility_id': 'other', 'history': [row(2, 1, 1, 'unknown')]}]}}
        def edge(a,b,fid='lift'):
            return dict(facility_id=fid, enter_at=dt(a), exit_at=dt(b))
        it = {'edges': [edge(0,5),edge(5,6,None),edge(6,8)]}
        self.assertEqual(traversal_conflict(it,snapshot,ts(10)), ('lift',1))
        self.assertIsNone(traversal_conflict({'edges':[edge(0,5)]},snapshot,ts(10)))
        self.assertIsNone(traversal_conflict({'edges':[edge(0,5)]},snapshot,ts(5)))
        with self.assertRaises(ValueError):
            traversal_conflict({'edges':[edge(0,11)]},snapshot,ts(10))
        with self.assertRaises(ValueError):
            traversal_conflict({'edges':[edge(0,5,'missing')]},snapshot,ts(10))

    def test_random_differential(self):
        rng = random.Random(20261127)
        states = ['in_service', 'restored', 'out_of_service']
        count = 0
        for _ in range(100):
            h = [row(i+1, rng.randrange(30), rng.randrange(45), rng.choice(states))
                 for i in range(rng.randrange(50))]
            for cutoff in [10, 20, 30, 45]:
                t = FacilityTimeline(h, ts(cutoff))
                for _ in range(40):
                    a,b = sorted([rng.randrange(cutoff+1),rng.randrange(cutoff+1)])
                    self.assertEqual(t.conflict(ts(a), ts(b)),
                                     reference(h,ts(cutoff),ts(a),ts(b)))
                    count += 1
        self.assertEqual(count,16000)

if __name__ == '__main__':
    unittest.main()
