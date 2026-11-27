"""Indexed retrospective facility evidence, matching pinned Hopline record order."""
from bisect import bisect_left, bisect_right
from itertools import groupby
from route_replay import stamp, require


class FacilityTimeline:
    """Build O(H log H); query earliest conflicting state in O(log H).

    Among records known by as_of and effective by t, the latest *record
    position* wins, not the largest effective timestamp. An empty history
    matches Hopline's default in-service state. Intervals are half-open;
    even a zero-duration traversal checks its entry, as in the old replay.
    """
    def __init__(self, history, as_of):
        self.as_of = as_of
        known = []
        for i, h in enumerate(history):
            if stamp(h['recorded_at']) <= as_of:
                require(h['status'] in ('in_service', 'restored', 'out_of_service'),
                        'unknown facility status')
                require(type(h['seq']) is int, 'invalid facility sequence')
                known.append((stamp(h['since']), i, h['status'], h['seq']))
        known.sort(key=lambda h: (h[0], h[1]))
        self.points = []
        self.states = []
        self.closed_prefix = [0]
        rank = -1
        for t, rows in groupby(known, key=lambda h: h[0]):
            winner = max(rows, key=lambda h: h[1])
            if winner[1] > rank:
                rank = winner[1]
                self.points.append(t)
                self.states.append((winner[2], winner[3]))
                self.closed_prefix.append(self.closed_prefix[-1] +
                                          (winner[2] == 'out_of_service'))

    def conflict(self, entry, exit_):
        """Return first conflicting record sequence, or None for no conflict."""
        require(entry <= exit_ <= self.as_of, 'incomplete traversal evidence')
        i = bisect_right(self.points, entry) - 1
        if i >= 0 and self.states[i][0] == 'out_of_service':
            return self.states[i][1]
        lo, hi = i + 1, bisect_left(self.points, exit_)
        if lo < hi and self.closed_prefix[hi] > self.closed_prefix[lo]:
            j = bisect_right(self.closed_prefix, self.closed_prefix[lo],
                             lo + 1, hi + 1) - 1
            return self.states[j][1]
        return None


def traversal_conflict(itinerary, snapshot, as_of):
    """Return (facility_id, status_seq) for the first conflicting edge.

    Build at most one index per used facility within a fixed evidence cutoff.
    The caller must already have validated itinerary topology and provenance.
    """
    facilities = {f['facility_id']: f for f in snapshot['seed']['facilities']}
    timelines = {}
    for edge in itinerary['edges']:
        fid = edge.get('facility_id')
        if not fid:
            continue
        entry, exit_ = stamp(edge['enter_at']), stamp(edge['exit_at'])
        require(entry <= exit_ <= as_of and fid in facilities,
                'incomplete traversal evidence')
        if fid not in timelines:
            timelines[fid] = FacilityTimeline(facilities[fid]['history'], as_of)
        seq = timelines[fid].conflict(entry, exit_)
        if seq is not None:
            return fid, seq
    return None
