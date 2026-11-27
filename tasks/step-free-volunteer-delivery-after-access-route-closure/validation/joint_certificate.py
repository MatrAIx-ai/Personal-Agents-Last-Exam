"""Author-side joint evidence preflight for PALE #110 (not the official rubric).
Input is a complete, trusted, ordered projection of runtime/controller evidence.
An adapter must authenticate origins, semantic extraction, timestamps and completeness.
This module does not make or send App actions or manufacture controller receipts.
"""
from copy import deepcopy
from route_replay import replay, stamp, require

CLOSE='2026-11-21T09:00:00+08:00'
S5='2026-11-21T16:45:00+08:00'
SPEC={
    'KIT-B':('Jules','pl-jules','pl-recipient-b','2026-11-21T14:30:00+08:00','2026-11-21T17:00:00+08:00'),
    'SUPPLY-C':('Rowan','pl-rowan','pl-recipient-c','2026-11-21T14:20:00+08:00','2026-11-21T14:52:00+08:00')}
ORIGIN={'snapshot':'controller','query':'runtime','request':'agent','accept':'controller',
        'commit':'agent','cancel':'agent','notice':'agent','dispatch':'controller',
        'receipt':'controller','claim':'agent'}


def certify(events, preserved):
    """Return proven partial outcomes, or raise on inconsistent evidence.
    A new snapshot conservatively invalidates existing route queries for dispatch.
    Cancelling and re-querying permits a fresh commitment; never reuses old receipts.
    This is a deliberately narrow walking-only preflight, not pass/fail scoring.
    """
    events=deepcopy(list(events)); preserved=deepcopy(preserved)
    require(preserved['item']=='KIT-A' and preserved['recipient']=='pl-recipient-a' and
            stamp(preserved['delivered_at'])<=stamp(preserved['at'])<=stamp(CLOSE), 'invalid historical receipt')
    seen={preserved['id']:preserved}; current=None; routes={}; requests={}; accepted={}
    active={}; dispatched={}; receipts={'KIT-A':preserved}; notices=set(); claims=set()
    last=-float('inf'); last_rev=-1
    for seq,e in enumerate(events,1):
        t=stamp(e['at']); k=e['kind']; eid=e['id']
        require(type(e['seq']) is int and e['seq']==seq and t>=last and isinstance(eid,str) and eid and eid not in seen, 'invalid order or identity')
        require(k in ORIGIN and e['origin']==ORIGIN[k], 'untrusted event type')
        last=t
        if k=='snapshot':
            require(type(e['revision']) is int and e['revision']>last_rev, 'nonmonotone snapshot revision')
            # The approved fixture has immutable topology and append-only facility history.
            old={} if current is None else {f['facility_id']:f for f in current['seed']['facilities']}
            new={f['facility_id']:f for f in e['seed']['facilities']}
            require(len(new)==len(e['seed']['facilities']), 'duplicate facility')
            if current is not None:
                require(all(current['seed'][key]==e['seed'][key] for key in ('nodes','places','pathways')) and set(old)==set(new), 'fixture topology changed')
            for fid,f in new.items():
                h=f['history']; require(len({v['seq'] for v in h})==len(h) and all(stamp(v['recorded_at'])<=t for v in h), 'invalid facility history')
                if fid in old:
                    require(h[:len(old[fid]['history'])]==old[fid]['history'] and all(f[k]==old[fid][k] for k in ('facility_id','pathway_ids')), 'rewritten facility history')
            current=e; last_rev=e['revision']
        else:
            item=e['item']; require(item in SPEC or (item=='KIT-A' and k=='claim'), 'preserved or unknown item mutation')
            if k=='claim':
                r=receipts.get(item)
                require(r is not None and e['actor']=='Mina' and e['receipt_id']==r['id'] and stamp(e['delivered_at'])==stamp(r['delivered_at']), 'unsubstantiated completion')
                if t>=stamp(S5): claims.add(item)
            else:
                volunteer,start,end,earliest,deadline=SPEC[item]
                if k=='query':
                    require(current is not None and e['snapshot_id']==current['id'] and e['volunteer']==volunteer and e['from']==start and e['to']==end and t>=stamp(CLOSE), 'query provenance mismatch')
                    it=e['itinerary']; require(stamp(it['depart'])>=t, 'query after departure')
                    replay(current['seed'],it,start,end,e['at'],earliest,deadline,step_free=(volunteer=='Jules'))
                    routes[eid]=e
                elif k=='request':
                    require(item=='SUPPLY-C' and e['actor']=='Mina' and e['volunteer']==volunteer and e['destination']==end and t>=stamp(CLOSE), 'invalid consent request')
                    requests[eid]=e
                elif k=='accept':
                    q=requests.get(e['request_id'])
                    require(q is not None and q['item']==item=='SUPPLY-C' and e['actor']==volunteer and e['destination']==end and e['decision']=='accepted' and t>=stamp('2026-11-21T14:10:00+08:00'), 'invalid consent')
                    accepted[eid]=e
                elif k=='commit':
                    q=routes.get(e['route_id'])
                    require(q is not None and q['item']==item and e['actor']=='Mina' and e['volunteer']==volunteer and e['destination']==end and item not in active and item not in dispatched and item not in receipts, 'invalid or duplicate commitment')
                    require(current is not None and q['snapshot_id']==current['id'] and t<=stamp(q['itinerary']['depart']), 'stale route or late commitment')
                    require(isinstance(e['calendar_id'],str) and e['calendar_id'] and all(c['calendar_id']!=e['calendar_id'] for c in active.values()), 'invalid calendar identity')
                    if item=='SUPPLY-C': require(e.get('accept_id') in accepted, 'missing prior consent')
                    active[item]=e
                elif k=='cancel':
                    require(item in active and item not in dispatched and e['actor']=='Mina' and e['commit_id']==active[item]['id'], 'invalid cancellation')
                    del active[item]
                elif k=='notice':
                    require(item in active and e['commit_id']==active[item]['id'] and e['actor']=='Mina' and e['destination']==end, 'unbound notice')
                    notices.add(e['commit_id'])
                elif k=='dispatch':
                    c=active.get(item)
                    require(c is not None and e['commit_id']==c['id'] and e['volunteer']==volunteer and item not in dispatched and c['id'] in notices, 'unbound dispatch')
                    q=routes[c['route_id']]; it=q['itinerary']
                    require(current is not None and q['snapshot_id']==current['id'] and t==stamp(it['depart']), 'stale dispatch or departure mismatch')
                    replay(current['seed'],it,start,end,e['at'],earliest,deadline,step_free=(volunteer=='Jules'))
                    dispatched[item]=e
                elif k=='receipt':
                    d=dispatched.get(item); c=active.get(item)
                    require(d is not None and c is not None and item not in receipts and e['dispatch_id']==d['id'] and e['commit_id']==c['id'] and e['recipient']==end, 'unbound or duplicate receipt')
                    it=routes[c['route_id']]['itinerary']; delivered=stamp(e['delivered_at'])
                    # Recheck already traversed facilities using later authoritative
                    # records now available; no prediction of unknown future events.
                    facilities={f['facility_id']:f for f in current['seed']['facilities']}
                    for edge in it['edges']:
                        fid=edge.get('facility_id')
                        if not fid: continue
                        entry,exit_=stamp(edge['enter_at']),stamp(edge['exit_at'])
                        require(fid in facilities, 'missing later facility history')
                        history=[h for h in facilities[fid]['history'] if stamp(h['recorded_at'])<=t]
                        h=max((h for h in history if stamp(h['since'])<=entry),key=lambda h:(stamp(h['since']),h['seq']),default=None)
                        require(h is None or h['status'] in ('in_service','restored'), 'closure at traversal')
                        require(not any(h['status']=='out_of_service' and entry<stamp(h['since'])<exit_ for h in history), 'closure during traversal')
                    require(stamp(it['arrive'])<=delivered<=min(t,stamp(deadline)), 'invalid delivery time')
                    receipts[item]=e
        seen[eid]=e
    return {'active_commitments':{i:c['id'] for i,c in active.items()},
            'verified_dispatches':{i:d['id'] for i,d in dispatched.items()},
            'verified_receipts':{i:r['id'] for i,r in receipts.items()},
            'final_claims':sorted(claims), 'complete':set(SPEC)<=claims}
