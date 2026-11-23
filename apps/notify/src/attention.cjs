'use strict';
// Device attention: is the phone quiet at a given instant?
// Silence ("silence until") wins over focus windows. Focus windows are local
// wall-clock times in the device time zone, so daylight-saving changes follow
// the zone rather than a fixed UTC offset.
const DAYS = ['sun','mon','tue','wed','thu','fri','sat'];
const formatters = new Map();

function validTimeZone(zone) {
  try { new Intl.DateTimeFormat('en-US', {timeZone:zone}); return true; } catch { return false; }
}

function local(zone, instant) {
  if (!formatters.has(zone)) {
    formatters.set(zone, new Intl.DateTimeFormat('en-US', {timeZone:zone, weekday:'short', hour:'2-digit', minute:'2-digit', hourCycle:'h23'}));
  }
  const parts = Object.fromEntries(formatters.get(zone).formatToParts(new Date(instant)).map(p => [p.type, p.value]));
  return {day:DAYS.indexOf(parts.weekday.toLowerCase().slice(0, 3)), minutes:Number(parts.hour) * 60 + Number(parts.minute)};
}

const clock = hhmm => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

function focusAt(device, instant) {
  const {day, minutes} = local(device.timezone, instant);
  const yesterday = DAYS[(day + 6) % 7], today = DAYS[day];
  for (const w of device.focus) {
    const start = clock(w.start), end = clock(w.end), overnight = end <= start;
    if (w.days.includes(today) && minutes >= start && (overnight || minutes < end)) return w;
    if (overnight && w.days.includes(yesterday) && minutes < end) return w;
  }
  return null;
}

function quietAt(device, at) {
  const instant = Date.parse(at);
  if (device.silence_until && Date.parse(device.silence_until) > instant) return {quiet:true, reason:'silence', focus_id:null};
  const w = focusAt(device, instant);
  return w ? {quiet:true, reason:'focus', focus_id:w.id} : {quiet:false, reason:'none', focus_id:null};
}

module.exports = {validTimeZone, quietAt};
