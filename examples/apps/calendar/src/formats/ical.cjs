'use strict';
function ical(e,now=e.start){
 const esc=s=>String(s).replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
 const utc=d=>new Date(d).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//PALE//Local Lite//EN','BEGIN:VEVENT','UID:'+esc(e.uid),'DTSTAMP:'+utc(now),'DTSTART:'+utc(e.start),'DTEND:'+utc(e.end),'SUMMARY:'+esc(e.title),'LOCATION:'+esc(e.location),'SEQUENCE:'+e.sequence,'STATUS:'+e.status.toUpperCase(),'END:VEVENT','END:VCALENDAR'];
 return lines.map(line=>{let out='',n=0;for(const c of line){const k=new TextEncoder().encode(c).length;if(n+k>73){out+='\r\n ';n=1;}out+=c;n+=k;}return out;}).join('\r\n')+'\r\n';
}
module.exports={ical};
