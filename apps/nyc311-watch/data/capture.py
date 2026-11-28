"""Build-time only. Standard library; do not use the live API during replay."""
import calendar
import collections
import concurrent.futures
import datetime as d
import hashlib
import json
import pathlib
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/New_York")
API = "https://data.cityofnewyork.us/resource/erm2-nwe9.json"
TERMS = "https://data.cityofnewyork.us/stories/s/Terms-of-Use/k9k7-3cje"
COLS = "unique_key,created_date,closed_date,borough,complaint_type,agency,status"
BOROUGHS = ["BRONX", "BROOKLYN", "MANHATTAN", "QUEENS", "STATEN ISLAND"]
STATUS = {"open":"open","assigned":"in_progress","in progress":"in_progress","pending":"in_progress","started":"in_progress","closed":"closed"}
CUTOFF = d.datetime.now(d.timezone.utc).replace(microsecond=0)
OUT = pathlib.Path(__file__).resolve().parent
def jsonbytes(x):
    return (json.dumps(x, indent=2, ensure_ascii=True, sort_keys=True)+"\n").encode()
def sha(b):
    return hashlib.sha256(b).hexdigest()
def instant(x):
    a=d.datetime.fromisoformat(x)
    if a.tzinfo is not None: raise ValueError("expected floating time")
    b=a.replace(tzinfo=TZ)
    if b.utcoffset()!=a.replace(tzinfo=TZ,fold=1).utcoffset(): raise ValueError("ambiguous/nonexistent local time")
    return b.isoformat(timespec="milliseconds")
def fetch(i):
    year,month=2025+i//12, i%12+1
    ym=f"{year}-{month:02}"
    next_month=f"{year+(month==12)}-{month%12+1:02}-01T00:00:00"
    end=min(next_month,CUTOFF.astimezone(TZ).replace(tzinfo=None).isoformat())
    if end<ym+"-01T00:00:00": return ym,[],{"reason":"month after cutoff"}
    where=f"complaint_type = 'Street Condition' AND created_date >= '{ym}-01T00:00:00' AND created_date < '{end}' AND borough IN ({','.join(repr(b) for b in BOROUGHS)})"
    url=API+"?"+urllib.parse.urlencode({"$select":COLS,"$where":where,"$order":"created_date,unique_key","$limit":50000})
    for n in range(3):
        try:
            with urllib.request.urlopen(url,timeout=25) as r: raw=r.read()
            break
        except OSError:
            if n==2: raise
    observed=d.datetime.now(d.timezone.utc).isoformat(timespec="milliseconds")
    rows=json.loads(raw)
    if not isinstance(rows,list) or len(rows)>=50000: raise ValueError("Unexpected or truncated result")
    by_date=collections.defaultdict(list)
    excluded=collections.Counter()
    seen=set()
    for row in rows:
        key=row["unique_key"]
        try:
            if key in seen: excluded["duplicate"]+=1; continue
            seen.add(key)
            at=instant(row["created_date"])
            if d.datetime.fromisoformat(at)>CUTOFF: raise ValueError("out of cutoff")
            closed=instant(row["closed_date"]) if row.get("closed_date") else None
            if closed and not d.datetime.fromisoformat(at)<=d.datetime.fromisoformat(closed)<=d.datetime.fromisoformat(observed):
                closed=None
                excluded["closure_field_omitted"]+=1
            agency=row.get("agency","")
            if not agency.isascii() or not agency.isalnum() or not 1<=len(agency)<=16: raise ValueError("unsupported agency")
            status=STATUS.get(row.get("status","").lower().strip())
            obs=[dict(at=observed,status=status,agency=agency,source="nyc311-snapshot")] if status else []
            if not obs: excluded["unmapped_status_not_observed"]+=1
            by_date[at[:10]].append(dict(created_at=at,borough=row["borough"],category="Street Condition",source="nyc311-snapshot",recorded_closed_at=closed,observations=obs))
        except (TypeError, ValueError, KeyError):
            excluded["invalid_or_ambiguous_row"]+=1
    dates=sorted(by_date)
    chosen=[]
    if dates:
        for slot in range(min(16,len(dates))):
            day=dates[slot*(len(dates)-1)//max(1,min(16,len(dates))-1)]
            priority=BOROUGHS[slot%len(BOROUGHS)]
            options=by_date[day]
            chosen.append(next((x for x in options if x["borough"]==priority),options[0]))
    return ym,chosen,dict(query=url,response_received_at=observed,response_sha256=sha(raw),rows=len(rows),usable_dates=len(dates),exclusions=dict(excluded))

def main():
    cases=[]
    counts={}
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        for ym, rows, capture in pool.map(fetch,range(24)):
            real=len(rows)
            used={x["created_at"][:10] for x in rows}
            y,m=map(int,ym.split("-"))
            # Only calendar gaps receive clearly synthetic creation/observations.
            for day in range(1,calendar.monthrange(y,m)[1]+1):
                date=f"{ym}-{day:02}"
                if len(rows)>=16 and date not in {ym+"-01",f"{ym}-{calendar.monthrange(y,m)[1]:02}"}: continue
                if date in used: continue
                at=instant(date+"T10:00:00")
                rows.append(dict(created_at=at,borough=BOROUGHS[(day+m)%5],category="Street Condition",source="synthetic-gaps",recorded_closed_at=None,observations=[dict(at=instant(date+"T12:00:00"),agency="DOT",status=["open","in_progress"][day%2],source="synthetic-gaps")]))
            for n,x in enumerate(sorted(rows,key=lambda x:x["created_at"]),1):
                x["case_id"]=f"{'R' if x['source']=='nyc311-snapshot' else 'S'}{ym.replace('-','')}-{n:02}"
                cases.append(x)
            counts[ym]=dict(real=real,synthetic=len(rows)-real,distinct_creation_dates=len(rows),capture=capture)
    seed=dict(account_id="resident-demo",cases=cases,watches=[],activity=[],events=[])
    blob=jsonbytes(seed)
    (OUT/"evaluation-v1.json").write_bytes(blob)
    manifest=dict(dataset="erm2-nwe9",terms=TERMS,source_timezone=str(TZ),cutoff=CUTOFF.isoformat(),normalized_sha256=sha(blob),evaluation_version="1.0.0",records=len(cases),months=counts)
    (OUT/"capture-v1.json").write_bytes(jsonbytes(manifest))
    print("records",len(cases),"real",sum(v["real"] for v in counts.values()),"synthetic",sum(v["synthetic"] for v in counts.values()),sha(blob))
if __name__=="__main__": main()
