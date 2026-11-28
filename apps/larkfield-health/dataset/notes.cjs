'use strict';
const { ms, localDate, addDays } = require('../src/time.cjs');

const TRIPS = [
  { from: '2025-07-12', to: '2025-07-20', people: ['m-1', 'm-2', 'm-3'], what: 'family summer trip' },
  { from: '2025-12-27', to: '2026-01-03', people: ['m-1', 'm-2', 'm-3'], what: 'winter visit to family near Cindervale' },
  { from: '2026-07-18', to: '2026-07-26', people: ['m-1', 'm-2', 'm-3'], what: 'family summer trip near Cindervale' },
];
const OFFICE_CLOSED = new Set([
  '2025-01-01', '2025-01-20', '2025-02-17', '2025-05-26', '2025-06-19', '2025-07-04', '2025-09-01', '2025-10-13', '2025-11-11', '2025-11-27', '2025-12-24', '2025-12-25',
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26', '2026-12-24', '2026-12-25',
]);
const weekday = date => new Date(Date.parse(date + 'T00:00:00Z')).getUTCDay();
const officeDay = date => { const day = weekday(date); return day >= 1 && day <= 5 && !OFFICE_CLOSED.has(date); };
const hhmm = iso => iso.slice(11, 16);
const officeHours = iso => officeDay(localDate(ms(iso))) && hhmm(iso) >= '08:00' && hhmm(iso) < '17:00';
const planHours = iso => officeDay(localDate(ms(iso))) && hhmm(iso) >= '09:00' && hhmm(iso) < '17:00';
const away = (person, date) => TRIPS.some(x => x.people.includes(person) && date >= x.from && date <= x.to);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const spoken = date => MONTHS[Number(date.slice(5, 7)) - 1] + ' ' + Number(date.slice(8, 10)) + ', ' + date.slice(0, 4);
const DATE = '((?:' + MONTHS.join('|') + ') \\d{1,2}, \\d{4})';
const MONTH = '((?:' + MONTHS.join('|') + ') \\d{4})';
const parsed = text => { const m = /^(\w+) (\d{1,2}), (\d{4})$/.exec(text); return m && MONTHS.includes(m[1]) ? m[3] + '-' + String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0') + '-' + m[2].padStart(2, '0') : null; };
const NAMES = { 'm-1': 'Jordan', 'm-2': 'Casey', 'm-3': 'Riley' };
const lowerFirst = text => (/^[A-Z][A-Z-]/.test(text) ? text : text.charAt(0).toLowerCase() + text.slice(1));

const PA_REQUESTS = {
  'svc-physical-therapy': 'Notes from the initial evaluation',
  'svc-arthroscopy': 'The MRI report and the notes from the physical therapy so far',
  'svc-arthroscopy-first': 'The MRI report and the surgeon\'s notes',
  'svc-semaglutide-1': 'Chart notes with the weight history and the treatments tried before',
};
const APPEAL_REQUESTS = {
  out_of_network: service => 'The order from the doctor who requested the ' + lowerFirst(service),
  prior_auth_missing: () => 'The therapy clinic\'s schedule showing the moved session',
  pa: () => 'Notes from the prescriber on the treatments tried before',
};
const REPLIES = {
  out_of_network: (orderer, date, provider, variant = 0) => (variant ? orderer + '\'s order from the visit on ' + spoken(date) + ' gives three weeks for the scan, and ' + provider + ' had the only appointment inside that time.' : 'The order from ' + orderer + ', written at the visit on ' + spoken(date) + ', asks for the scan within three weeks; ' + provider + ' was the first place that could do it in time.'),
  prior_auth_missing: (provider, from, to, until) => provider + ' moved the session of ' + spoken(from) + ' to ' + spoken(to) + '; the authorization ended on ' + spoken(until) + '.',
  pa: (provider, date) => 'At the visit on ' + spoken(date) + ' the doctor at ' + provider + ' recorded the diet program and the two medicines I tried before.',
};
const CAUSES = {
  home: 'it happened at home and was an accident',
  sport: 'it happened during a game and was an accident',
  school: 'it happened at school and was an accident',
  none: 'it was not an accident',
};
const whatOf = lines => lines.map(l => 'the ' + lowerFirst(l.service) + ' on ' + spoken(l.date)).join(' and ');
const several = (lines, one, many) => (lines.length > 1 ? many : one);
const STATEMENTS = {
  out_of_network: f => (f.variant ? 'At the visit on ' + spoken(f.ordered) + ' the doctor at ' + f.orderer + ' asked for the scan within three weeks; ' + f.provider + ' could do it soonest: ' + whatOf(f.lines) + '. We were not told it was out of network and ask you to cover it at the in-network level.' : f.orderer + ' ordered the scan at the visit on ' + spoken(f.ordered) + ', and ' + f.provider + ' had the first opening: ' + whatOf(f.lines) + '. Nobody told us it was out of network. Please cover it at the in-network level.'),
  emergency: f => NAMES[f.member] + ' was seen in the emergency department at ' + f.provider + ' while we were away from home: ' + whatOf(f.lines) + '. It was an emergency visit, so please cover it at the in-network level.',
  missing_accident: f => 'We missed the accident ' + several(f.lines, 'question', 'questions') + ' for ' + whatOf(f.lines) + ' at ' + f.provider + '; ' + CAUSES[f.cause] + '. Please process ' + several(f.lines, 'the line', 'these lines') + '.',
  missing_coverage: f => 'We missed the other-coverage ' + several(f.lines, 'question', 'questions') + ' for ' + whatOf(f.lines) + ' at ' + f.provider + '; ' + NAMES[f.member] + ' has no other coverage for ' + f.lines[0].date.slice(0, 4) + '. Please process ' + several(f.lines, 'the line', 'these lines') + '.',
  prior_auth_missing: f => 'The therapy session on ' + spoken(f.date) + ' was moved from ' + spoken(f.from) + ' because the clinic rescheduled it; the authorization for the course still had sessions left. Please cover it as part of the approved course.',
  pa_semaglutide: f => 'I have followed the diet program and tried two other medicines since ' + f.since + '. The doctor at ' + f.provider + ' recommends this treatment. Please approve it.',
  pa_arthroscopy: f => 'My knee locks and I cannot straighten it. The surgeon at ' + f.provider + ' saw me on ' + spoken(f.seen) + ' and wants to operate as soon as possible. Please approve the surgery urgently.',
};
const EXPEDITES = {
  'svc-arthroscopy': f => 'My knee locks and the surgeon at ' + f.provider + ' wants to operate within days; the surgeon saw me on ' + spoken(f.seen) + '.',
  'svc-physical-therapy': f => NAMES[f.member] + '\'s season continues on ' + spoken(f.season) + ' and the orthopedist wants therapy to start now.',
};
const esc = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SHAPES = {
  out_of_network: new RegExp('^(.+) ordered the scan at the visit on ' + DATE + ', and (.+?) had the first opening: (.+)\\. Nobody told us it was out of network\\. Please cover it at the in-network level\\.$'),
  out_of_network_soonest: new RegExp('^At the visit on ' + DATE + ' the doctor at (.+?) asked for the scan within three weeks; (.+?) could do it soonest: (.+)\\. We were not told it was out of network and ask you to cover it at the in-network level\\.$'),
  prior_auth_missing: new RegExp('^The therapy session on ' + DATE + ' was moved from ' + DATE + ' because the clinic rescheduled it; the authorization for the course still had sessions left\\. Please cover it as part of the approved course\\.$'),
  pa_semaglutide: new RegExp('^I have followed the diet program and tried two other medicines since ' + MONTH + '\\. The doctor at (.+) recommends this treatment\\. Please approve it\\.$'),
  pa_arthroscopy: new RegExp('^My knee locks and I cannot straighten it\\. The surgeon at (.+) saw me on ' + DATE + ' and wants to operate as soon as possible\\. Please approve the surgery urgently\\.$'),
  reply_order: new RegExp('^The order from (.+), written at the visit on ' + DATE + ', asks for the scan within three weeks; (.+) was the first place that could do it in time\\.$'),
  reply_schedule: new RegExp('^(.+) moved the session of ' + DATE + ' to ' + DATE + '; the authorization ended on ' + DATE + '\\.$'),
  reply_chart: new RegExp('^At the visit on ' + DATE + ' the doctor at (.+) recorded the diet program and the two medicines I tried before\\.$'),
  expedite_surgery: new RegExp('^My knee locks and the surgeon at (.+) wants to operate within days; the surgeon saw me on ' + DATE + '\\.$'),
  expedite_therapy: new RegExp('^(\\w+)\'s season continues on ' + DATE + ' and the orthopedist wants therapy to start now\\.$'),
};

function problems(seed, steps = null) {
  const out = [];
  const claim = id => seed.claims.find(c => c.claim_id === id);
  const provider = id => seed.providers.find(p => p.provider_id === id);
  const named = name => seed.providers.find(p => p.name === name) || null;
  const service = id => seed.services.find(s => s.service_id === id).description;
  const lines = member => seed.claims.filter(c => c.member_id === member).flatMap(c => c.lines.map(l => ({ c, l })));
  const visitOn = (member, providerId, date, services) => lines(member).some(x => x.c.provider_id === providerId && x.l.service_date === date && (!services || services.includes(x.l.service_id)));
  const VISIT = ['svc-office-visit', 'svc-specialist-visit'];
  const v1 = c => seed.eobs.find(e => e.claim_id === c.claim_id && e.version === 1);
  for (const p of seed.pas) {
    const submitted = localDate(ms(p.submitted_at));
    for (const r of p.info_requests) {
      if (!planHours(r.at)) out.push(p.pa_id + ' information request at ' + r.at + ' is outside the plan\'s business hours');
      const first = p.service_id === 'svc-arthroscopy' && r.text === PA_REQUESTS['svc-arthroscopy-first'];
      if (r.text !== PA_REQUESTS[p.service_id] && !first) { out.push(p.pa_id + ' information request "' + r.text + '" is not the request for ' + p.service_id); continue; }
      const before = (x, days) => x.l.service_date <= submitted && x.l.service_date >= addDays(submitted, -days);
      if (p.service_id === 'svc-physical-therapy' && !lines(p.member_id).some(x => VISIT.includes(x.l.service_id) && before(x, 45))) out.push(p.pa_id + ' asks for the initial evaluation, but ' + p.member_id + ' had no visit in the 45 days before');
      if (p.service_id === 'svc-arthroscopy') {
        const mri = lines(p.member_id).some(x => x.l.service_id === 'svc-knee-mri' && before(x, 120)), therapy = lines(p.member_id).some(x => x.l.service_id === 'svc-physical-therapy' && before(x, 120));
        if (!mri || therapy === first) out.push(p.pa_id + ' asks for "' + r.text + '", which does not match the MRI and therapy ' + p.member_id + ' had before');
      }
      if (p.service_id === 'svc-semaglutide-1' && !lines(p.member_id).some(x => x.c.provider_id === p.provider_id && before(x, 60))) out.push(p.pa_id + ' asks for chart notes, but ' + p.member_id + ' had no visit at ' + p.provider_id + ' in the 60 days before');
    }
    if (p.expedite) {
      const asked = localDate(ms(p.expedite.requested_at)), text = p.expedite.reason || '';
      if (p.service_id === 'svc-arthroscopy') {
        const m = SHAPES.expedite_surgery.exec(text), seen = m && parsed(m[2]);
        if (!m || named(m[1]) !== provider(p.provider_id) || !seen || seen > asked || seen < addDays(asked, -7) || !visitOn(p.member_id, p.provider_id, seen, ['svc-specialist-visit'])) out.push(p.pa_id + ' expedite reason "' + text + '" does not name the surgeon\'s visit in the week before');
      } else if (p.service_id === 'svc-physical-therapy') {
        const m = SHAPES.expedite_therapy.exec(text), season = m && parsed(m[2]);
        const ortho = lines(p.member_id).some(x => x.c.provider_id === 'pv-2' && x.l.service_date <= asked && x.l.service_date >= addDays(asked, -14));
        if (!m || m[1] !== NAMES[p.member_id] || !season || season <= asked || season > addDays(asked, 60) || !ortho) out.push(p.pa_id + ' expedite reason "' + text + '" does not name the member, a season date in the next 60 days and an orthopedic visit in the two weeks before');
      } else out.push(p.pa_id + ' has an expedite request for a service without an urgent reason');
    }
  }
  for (const a of seed.appeals) {
    const text = a.statements[0].text, filed = localDate(ms(a.filed_at));
    let reason = null, facts = null, ok = false;
    if (a.target.type === 'claim') {
      const c = claim(a.target.id), denied = v1(c).lines.filter(l => l.status === 'denied'), line = c.lines.find(l => l.line_id === denied[0].line_id);
      const prov = provider(c.provider_id), lines = denied.map(d => { const l = c.lines.find(x => x.line_id === d.line_id); return { service: service(l.service_id), date: l.service_date, line: l }; });
      const base = { member: c.member_id, provider: prov.name, lines };
      reason = denied[0].reason;
      if (denied.some(d => d.reason !== reason) || JSON.stringify(a.lines) !== JSON.stringify(denied.map(d => d.line_id))) out.push(a.appeal_id + ' appeals lines denied for different reasons or not every denied line');
      if (reason === 'out_of_network' && prov.kind === 'hospital') {
        ok = text === STATEMENTS.emergency(base) && lines.every(x => x.line.service_id === 'svc-er-visit' && away(c.member_id, x.date)) && !prov.in_network;
      } else if (reason === 'out_of_network') {
        const m0 = SHAPES.out_of_network.exec(text), m1 = SHAPES.out_of_network_soonest.exec(text), m = m0 || m1, variant = m0 ? 0 : 1;
        const ordered = m && parsed(m0 ? m0[2] : m1[1]), orderer = m && named(m0 ? m0[1] : m1[2]), ordererName = m && (m0 ? m0[1] : m1[2]);
        ok = Boolean(m) && text === STATEMENTS.out_of_network({ ...base, orderer: ordererName, ordered, variant }) && !prov.in_network && Boolean(orderer) && orderer.in_network && lines.every(x => ordered < x.date && ordered >= addDays(x.date, -45)) && visitOn(c.member_id, orderer.provider_id, ordered, VISIT);
        facts = ok ? { orderer: ordererName, ordered, provider: prov.name, date: line.service_date } : null;
      } else if (reason === 'missing_information') {
        const expired = denied.map(d => seed.info_requests.find(r => r.claim_id === c.claim_id && r.line_id === d.line_id && r.status === 'expired'));
        if (expired.every(r => r && r.type === 'accident')) ok = Object.keys(CAUSES).some(cause => text === STATEMENTS.missing_accident({ ...base, cause }));
        else if (expired.every(r => r && r.type === 'other_coverage')) {
          const cov = seed.coverage.find(x => x.member_id === c.member_id && x.plan_year === expired[0].plan_year);
          ok = text === STATEMENTS.missing_coverage(base) && Boolean(cov) && (cov.status === 'none' || cov.status === 'unknown');
        }
      } else if (reason === 'prior_auth_missing') {
        const m = SHAPES.prior_auth_missing.exec(text), from = m && parsed(m[2]), pa = m && seed.pas.find(p => p.member_id === c.member_id && p.service_id === line.service_id && p.approved && p.approved.valid_from <= from && from <= p.approved.valid_until);
        ok = Boolean(m) && parsed(m[1]) === line.service_date && line.service_id === 'svc-physical-therapy' && denied.length === 1 && Boolean(pa) && pa.member_id === c.member_id && pa.service_id === line.service_id && pa.approved !== null
          && Boolean(from) && pa.approved.valid_from <= from && from <= pa.approved.valid_until && pa.approved.valid_until < line.service_date && from >= addDays(line.service_date, -14) && officeDay(from) && pa.approved.units > pa.units_used;
        facts = ok ? { from, provider: prov.name, to: line.service_date, until: pa.approved.valid_until } : null;
      }
    } else {
      const p = seed.pas.find(x => x.pa_id === a.target.id);
      reason = 'pa';
      if (p.service_id === 'svc-semaglutide-1') {
        const m = SHAPES.pa_semaglutide.exec(text), since = m && parsed(m[1].replace(' ', ' 1, '));
        ok = Boolean(m) && named(m[2]) === provider(p.provider_id) && Boolean(since) && since < localDate(ms(p.submitted_at));
      } else if (p.service_id === 'svc-arthroscopy') {
        const m = SHAPES.pa_arthroscopy.exec(text), seen = m && parsed(m[2]);
        ok = Boolean(m) && named(m[1]) === provider(p.provider_id) && Boolean(seen) && seen <= filed && seen >= addDays(filed, -7) && visitOn(p.member_id, p.provider_id, seen, ['svc-specialist-visit']) && a.expedited === true;
      }
    }
    if (!ok) out.push(a.appeal_id + ' statement "' + text + '" does not match the denial it appeals');
    a.info_requests.forEach((r, i) => {
      if (!planHours(r.at)) out.push(a.appeal_id + ' information request at ' + r.at + ' is outside the plan\'s business hours');
      const want = APPEAL_REQUESTS[reason];
      const svc = a.target.type === 'claim' ? service(claim(a.target.id).lines.find(l => l.line_id === a.lines[0]).service_id) : null;
      if (!want || r.text !== want(svc)) out.push(a.appeal_id + ' information request "' + r.text + '" is not the request for a ' + reason + ' appeal');
      const replies = a.statements.filter(s => ms(s.at) > ms(r.at) && (!a.info_requests[i + 1] || ms(s.at) < ms(a.info_requests[i + 1].at)));
      if (!replies.length && !['info_requested', 'withdrawn'].includes(a.status)) out.push(a.appeal_id + ' was decided after an information request without a reply');
      for (const s of replies) {
        let fits = false;
        if (reason === 'out_of_network' && facts) { fits = [0, 1].some(v => s.text === REPLIES.out_of_network(facts.orderer, facts.ordered, facts.provider, v)) && facts.date <= addDays(facts.ordered, 21); }
        else if (reason === 'prior_auth_missing' && facts) { const m = SHAPES.reply_schedule.exec(s.text); fits = Boolean(m) && m[1] === facts.provider && parsed(m[2]) === facts.from && parsed(m[3]) === facts.to && parsed(m[4]) === facts.until; }
        else if (reason === 'pa') {
          const p = seed.pas.find(x => x.pa_id === a.target.id), m = SHAPES.reply_chart.exec(s.text), date = m && parsed(m[1]);
          fits = Boolean(m) && named(m[2]) === provider(p.provider_id) && Boolean(date) && date <= localDate(ms(r.at)) && visitOn(p.member_id, p.provider_id, date);
        }
        if (!fits) out.push(a.appeal_id + ' reply "' + s.text + '" does not answer the request with facts the records hold');
      }
    });
    for (const s of a.statements.slice(1)) if (!a.info_requests.some(r => ms(r.at) < ms(s.at))) out.push(a.appeal_id + ' statement at ' + s.at + ' answers no information request');
    if (a.decided_at && !planHours(a.decided_at)) out.push(a.appeal_id + ' was decided at ' + a.decided_at + ', outside the plan\'s business hours');
  }
  for (const p of seed.pas) {
    if (!officeHours(p.submitted_at)) out.push(p.pa_id + ' was submitted at ' + p.submitted_at + ', outside the provider\'s office hours');
    if (p.decided_at && !planHours(p.decided_at)) out.push(p.pa_id + ' was decided at ' + p.decided_at + ', outside the plan\'s business hours');
    if (p.expedite && p.expedite.decided_at && !planHours(p.expedite.decided_at)) out.push(p.pa_id + ' expedite was decided at ' + p.expedite.decided_at + ', outside the plan\'s business hours');
    for (const s of p.covered_submissions) if (!officeHours(s.at)) out.push(s.pa_id + ' was submitted at ' + s.at + ', outside the provider\'s office hours');
  }
  for (const c of seed.claims) {
    if (!officeHours(c.received_at)) out.push(c.claim_id + ' was received at ' + c.received_at + ', outside business hours');
    for (const l of c.lines) if (!l.emergency && !officeDay(l.service_date) && !seed.claims.some(x => x !== c && x.provider_id === c.provider_id && x.lines.some(y => y.service_date === l.service_date && y.emergency))) out.push(c.claim_id + ' line ' + l.line_id + ' was a scheduled service on ' + l.service_date + ', when offices are closed');
  }
  if (steps) {
    const plan = new Set(['pa.info_requested', 'pa.decided', 'pa.expedite_decided', 'appeal.info_requested', 'appeal.decided']);
    const office = new Set(['pa.submitted', 'pa.info_provided', 'pa.withdrawn', 'claim.received']);
    for (const s of steps) {
      if (plan.has(s.operation) && !planHours(s.at)) out.push(s.id + ' ' + s.operation + ' at ' + s.at + ' is outside the plan\'s business hours');
      if (office.has(s.operation) && !officeHours(s.at)) out.push(s.id + ' ' + s.operation + ' at ' + s.at + ' is outside office hours');
    }
  }
  return out;
}

module.exports = { lowerFirst, whatOf, TRIPS, OFFICE_CLOSED, officeDay, officeHours, planHours, away, spoken, parsed, weekday, NAMES, PA_REQUESTS, APPEAL_REQUESTS, REPLIES, CAUSES, STATEMENTS, EXPEDITES, SHAPES, problems };
