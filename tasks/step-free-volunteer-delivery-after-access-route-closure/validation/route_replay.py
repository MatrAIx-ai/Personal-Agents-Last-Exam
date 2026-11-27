"""Independent replay of the approved #110 walking-only Hopline itinerary.
Inputs must be extracted from trusted runtime trace and authoritative snapshot.
No live App, event injection, or official rubric is implemented here.
"""
from datetime import datetime
import math


def stamp(s):
    t = datetime.fromisoformat(s)
    if t.utcoffset() is None:
        raise ValueError('missing timezone')
    return t.timestamp()


def require(ok, reason):
    if not ok:
        raise ValueError(reason)


def unique(rows, key):
    d = {r[key]: r for r in rows}
    require(len(d) == len(rows), 'duplicate authoritative ID')
    return d


def replay(seed, itinerary, start, end, as_of, earliest, deadline, max_walk=2500,
           step_free=True):
    """Return verified metrics or raise ValueError. All timestamps require offsets.
    Walking-only fixture, exact continuous path; no estimated restorations.
    Snapshot freshness/trace authenticity must be established by the caller.
    """
    now, dep, arr = map(stamp, (as_of, itinerary['depart'], itinerary['arrive']))
    require(now <= dep and stamp(earliest) <= dep <= arr <= stamp(deadline), 'time window')
    paths = unique(seed['pathways'], 'pathway_id')
    nodes = unique(seed['nodes'], 'node_id')
    places = unique(seed['places'], 'place_id')
    facilities = unique(seed['facilities'], 'facility_id')
    require(start in places and end in places and start != end, 'unsupported endpoints')
    require(not set(places) & set(nodes), 'ambiguous endpoint ID')
    edges = itinerary['edges']
    require(isinstance(edges, list) and len(edges) >= 2, 'empty path')
    require(not itinerary.get('uses_estimates', []), 'estimated restoration')
    pos, t, dist = start, dep, 0.0
    all_free = True
    for idx, edge in enumerate(edges):
        a, b = edge['from'], edge['to']
        entry, exit_ = stamp(edge['enter_at']), stamp(edge['exit_at'])
        require(a == pos and entry == t and exit_ >= entry, 'discontinuous path/time')
        if idx == 0 or idx == len(edges)-1:
            require(edge['kind'] == 'access', 'missing endpoint link')
            place, node = (a,b) if idx == 0 else (b,a)
            require(place == (start if idx == 0 else end) and node in nodes, 'wrong endpoint')
            links = unique(places[place]['access'], 'node_id')
            require(node in links and edge['link_id'] == f'acc:{place}:{node}', 'unknown access link')
            link = links[node]
            free = link.get('step_free') is True
        else:
            require(edge['kind'] == 'pathway' and a in nodes and b in nodes, 'unsupported edge')
            link = paths.get(edge['pathway_id'])
            require(link is not None, 'unknown pathway')
            require((a,b) == (link['from'],link['to']) or (link['bidirectional'] and (b,a) == (link['from'],link['to'])), 'wrong pathway direction')
            require(edge['mode'] == link['mode'], 'wrong pathway mode')
            free = link['mode'] in ('walkway','elevator','ramp')
            fid = link.get('facility_id')
            require(edge.get('facility_id') == fid and not edge.get('uses_estimate'), 'facility mismatch')
            if fid:
                f = facilities.get(fid)
                require(f is not None and link['pathway_id'] in f['pathway_ids'], 'unknown facility')
                history = [h for h in f['history'] if stamp(h['recorded_at']) <= now]
                # The task permits future walking only with confirmed current service.
                # Reject an explicitly known closure intersecting traversal as well.
                require(all(h['status'] in ('in_service','restored','out_of_service') for h in history), 'unknown status')
                known = [h for h in history if stamp(h['since']) <= entry]
                require(len({h['seq'] for h in history}) == len(history), 'duplicate facility sequence')
                h = max(known, key=lambda h:(stamp(h['since']),h['seq']), default=None)
                require(h is None or h['status'] in ('in_service','restored'), 'facility closed')
                require(not any(h['status']=='out_of_service' and entry < stamp(h['since']) < exit_ for h in history), 'closure during traversal')
                require(edge.get('facility_status') == 'in_service' and edge.get('facility_status_seq') == (h['seq'] if h else 0), 'stale facility evidence')
        length, seconds = link['length_m'], link['seconds']
        require(all(isinstance(v,(int,float)) and math.isfinite(v) and v>=0 for v in (length,seconds)), 'invalid authoritative edge')
        require(exit_-entry == seconds and edge['length_m'] == length, 'incorrect edge metrics')
        require(edge.get('step_free') is free and (free or not step_free), 'accessibility violation')
        all_free &= free
        pos,t,dist=b,exit_,dist+length
    require(pos==end and t==arr and dist==itinerary['walk_m'] and dist<=max_walk, 'incorrect destination/total')
    require(itinerary.get('step_free') is all_free, 'incorrect itinerary accessibility')
    return {'seconds':arr-dep,'walk_m':dist,'step_free':all_free}
