'use strict';
const fs = require('node:fs');
const lib = require('./lib.cjs');
const notes = require('./notes.cjs');
const { applyDueTimers, project } = require('../src/timers.cjs');
const { relation } = require('../src/authority.cjs');
const { ms, toIso, fromLocal, localDate, addDays, MINUTE, HOUR, DAY } = require('../src/time.cjs');
const { P, START, END, FIRST, LAST, REFERENCE, FILES, SEED_IDS } = lib;
const { officeDay, away, NAMES, STATEMENTS, EXPEDITES, PA_REQUESTS, APPEAL_REQUESTS, REPLIES } = notes;

const SEED = 20250158;
const VERSION = '1';
const RECORDS = ['coverage', 'claims', 'info_requests', 'eobs', 'accumulators', 'pas', 'appeals', 'windows', 'grants', 'approvals', 'notices'];
const ADULTS = ['m-1', 'm-2'];
const RATES = {
  'm-1': { sick: 0.25, phone: 0.15, specialist: 0.06, joint: 0.06, imaging: 0.03, injury: 0.05 },
  'm-2': { sick: 0.3, phone: 0.15, specialist: 0.06, joint: 0.04, imaging: 0.04, injury: 0.05 },
  'm-3': { sick: 0.45, strep: 0.15, phone: 0.15, injury: 0.08 },
};
const SEASON = { winter: ['01', '02', '03', '11', '12'], summer: ['07', '08'] };
const VISITS = {
  sick: { provider: 'pv-1', lines: [['svc-office-visit', [20500, 21000, 21500, 22000]]] },
  strep: { provider: 'pv-1', lines: [['svc-office-visit', [20500, 21000, 21500]], ['svc-strep-test', [4200, 4600]]] },
  labs: { provider: 'pv-1', lines: [['svc-office-visit', [21000, 21500, 22000]], ['svc-lab-panel', [8643, 9418, 11826]]] },
  phone: { provider: 'pv-1', lines: [['svc-phone-consult', [2400, 2600]]] },
  specialist: { provider: 'pv-4', lines: [['svc-specialist-visit', [33500, 34000, 36500]]] },
  joint: { provider: 'pv-2', lines: [['svc-specialist-visit', [33500, 34000]], ['svc-xray', [14500, 15800]]], accident: true },
  physical: { provider: 'pv-1', lines: [['svc-office-visit', [22000, 23500]], ['svc-lipid-panel', [7200, 7800]]] },
  checkup: { provider: 'pv-1', lines: [['svc-office-visit', [21500, 22000]]] },
};
const CAUSE_WEIGHTS = { 'm-1': [['home', 4], ['sport', 2], ['work', 4]], 'm-2': [['home', 3], ['sport', 2]], 'm-3': [['school', 3], ['sport', 4], ['home', 2]] };
const LAG = { 'pv-1': [2, 6], 'pv-2': [3, 8], 'pv-3': [2, 5], 'pv-4': [4, 12], 'pv-5': [5, 12], 'pv-6': [7, 16] };
const ANSWER = { 'm-1': { other_coverage: 0.1, accident: 0.22, quick: 9, late: 0.06 }, 'm-2': { other_coverage: 0.06, accident: 0.13, quick: 6, late: 0.04 } };
const APPEAL = { 'm-1': { file: [3, 28] }, 'm-2': { file: [2, 18] } };
const LIKELY = { missing_information: 0.9, out_of_network: 0.8, prior_auth_missing: 0.85, pa: 0.75 };
const OVERTURN = { missing_information: 1, out_of_network: 0.25, prior_auth_missing: 0.65, expedited_surgery: 0.85 };
const OFFICE_GAP = lib.OFFICE_GAP;
const CAPS = lib.CAPS;
const quarterOf = date => date.slice(0, 4) + 'Q' + Math.ceil(Number(date.slice(5, 7)) / 3);
const APPEAL_INFO = { out_of_network: 0.6, prior_auth_missing: 0.45, pa: 0.5 };
const PA_INFO = { 'svc-physical-therapy': 0.35, 'svc-arthroscopy': 0.45, 'svc-semaglutide-1': 0.7 };
const PLAN_LATE = { usual: 0.03, pa: 0.5, heavy: 0.5, chance: { heavy: 0.6, light: 0.1 }, periods: [{ from: '01-02', to: '03-15', what: 'plan-year surge' }, { from: '06-15', to: '08-31', what: 'summer staffing' }, { from: '11-20', to: '12-31', what: 'holiday backlog' }] };
const severityOf = (year, what) => (random((SEED ^ hash('plan:backlog:' + year + ' ' + what)) >>> 0).next() < PLAN_LATE.heavy ? 'heavy' : 'light');
const backlogOf = planned => {
  const date = localDate(planned), d = date.slice(5), p = PLAN_LATE.periods.find(x => d >= x.from && d <= x.to);
  return p ? { ...p, severity: severityOf(date.slice(0, 4), p.what) } : null;
};
const lateness = (planned, kind) => { const b = backlogOf(planned); return (b ? PLAN_LATE.chance[b.severity] : PLAN_LATE.usual) * (kind === 'pa' ? PLAN_LATE.pa : 1); };
const backlogs = () => ['2025', '2026'].flatMap(year => PLAN_LATE.periods.map(p => ({ from: year + '-' + p.from, to: year + '-' + p.to, what: p.what, severity: severityOf(year, p.what), chance: PLAN_LATE.chance[severityOf(year, p.what)] })));
const SLOTS = { 'm-1': { weekday: [[1140, 1335]], weekend: [[570, 1290]] }, 'm-2': { weekday: [[725, 775], [1200, 1350]], weekend: [[600, 1200]] } };
const OTHER_COVERAGE = { 'm-3:2026': 'other_secondary' };

function random(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const n = k => Math.floor(next() * k);
  return {
    next, n, chance: p => next() < p, between: (lo, hi) => lo + n(hi - lo + 1), pick: list => list[n(list.length)],
    weighted: list => { let r = next() * list.reduce((s, [, w]) => s + w, 0); for (const [v, w] of list) { if (r < w) return v; r -= w; } return list[list.length - 1][0]; },
    count: mean => { let k = 0, p = Math.exp(-mean), s = p; const u = next(); while (u > s && k < 4) { k++; p *= mean / k; s += p; } return k; },
  };
}
const hash = text => { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const streams = new Map();
const stream = key => { if (!streams.has(key)) streams.set(key, random((SEED ^ hash(key)) >>> 0)); return streams.get(key); };

const pad = n => String(n).padStart(2, '0');
const clockOf = minutes => pad(Math.floor(minutes / 60)) + ':' + pad(minutes % 60);
const daysOf = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };
function officeAfter(date, n) {
  let d = date, k = 0;
  while (!officeDay(d)) d = addDays(d, 1);
  while (k < n) { d = addDays(d, 1); if (officeDay(d)) k++; }
  return d;
}
const officeAt = (R, date, from = 480, to = 1019) => fromLocal(date, clockOf(R.between(from, to)));
const planAt = (R, date) => officeAt(R, date, 540, 1019);
function householdAt(person, R, date) {
  const slots = SLOTS[person][officeDay(date) ? 'weekday' : 'weekend'], [lo, hi] = R.pick(slots);
  return fromLocal(date, clockOf(R.between(lo, hi)));
}
function householdAfter(person, R, t, days = 0) {
  let date = addDays(localDate(t), days), w = householdAt(person, R, date);
  while (w <= t) { date = addDays(date, 1); w = householdAt(person, R, date); }
  return w;
}
function planAfter(R, t, n = 0) {
  let day = officeAfter(localDate(t), n), w = planAt(R, day);
  while (w <= t) { day = officeAfter(addDays(day, 1), 0); w = planAt(R, day); }
  return w;
}
function officeTimeAfter(R, t, n = 0) {
  let day = officeAfter(localDate(t), n), w = officeAt(R, day);
  while (w <= t) { day = officeAfter(addDays(day, 1), 0); w = officeAt(R, day); }
  return w;
}
function promptly(R, t) {
  const w = t + R.between(45, 150) * MINUTE, day = localDate(w), clock = toIso(w).slice(11, 16);
  if (officeDay(day) && clock >= '09:00' && clock < '17:00') return w;
  return fromLocal(officeDay(day) && clock < '09:00' ? day : officeAfter(addDays(day, 1), 0), clockOf(R.between(540, 600)));
}
function planBefore(R, from, n, limit) {
  let w = planAfter(R, from, n);
  for (let back = 1; w >= limit && back < 40; back++) w = planAfter(R, from, Math.max(0, n - back));
  return w;
}
const billed = (R, prices, year) => Math.round(R.pick(prices) * (year === 2026 ? 1.03 : 1));

function baseSeed(reference) {
  const base = structuredClone(reference);
  base.seed_id = SEED_IDS.base;
  for (const key of RECORDS) base[key] = [];
  base.issued = {};
  for (const m of base.members) for (const y of m.enrolled_years) {
    base.coverage.push({ member_id: m.member_id, plan_year: y, status: 'unknown', version: 0, attested_at: null });
    base.accumulators.push({ member_id: m.member_id, plan_year: y, deductible_cents: 0, oop_cents: 0 });
  }
  return base;
}

function catalog(seed) {
  return { account_id: seed.account_id, owner_person_id: seed.owner_person_id, time_zone: seed.time_zone, plan: seed.plan, members: seed.members, providers: seed.providers, services: seed.services };
}

function simulate(options = {}) {
  streams.clear();
  const reference = lib.read('fixtures/minimal.json');
  const base = baseSeed(reference);
  const data = structuredClone(base);
  const steps = [], queue = [];
  const endT = ms(END);
  let seq = 0, now = ms(START), running = null;
  const schedule = (t, fn) => {
    if (t >= endT) return;
    if (t < now) throw Error('A step was scheduled at ' + toIso(t) + ', before the current time ' + toIso(now) + '.');
    const item = { t, seq: seq++, fn, causes: running ? [...(running.made.length ? running.made : running.causes)] : [] };
    let lo = 0, hi = queue.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; const q = queue[mid]; if (q.t < t || (q.t === t && q.seq < item.seq)) lo = mid + 1; else hi = mid; }
    queue.splice(lo, 0, item);
  };
  const record = (t, entry) => {
    if (t < now) throw Error('A step at ' + toIso(t) + ' comes before the current time ' + toIso(now) + '.');
    const step = { id: 's-' + (steps.length + 1), at: toIso(t), ...entry, ...(running && running.causes.length ? { after: [...running.causes] } : {}) };
    if (!lib.changes(data, step)) throw Error('Step ' + step.id + ' (' + (step.tool || step.operation) + ' at ' + step.at + ') would not change the state.');
    const result = lib.apply(data, step, { check: true });
    lib.validate(data, step.at);
    steps.push(step);
    if (running) running.made.push(step.id);
    return result;
  };
  const call = (t, actor, tool, args) => record(t, { by: actor, tool: P + tool, args });
  const event = (t, operation, payload, extra = {}) => record(t, { by: 'infra', operation, payload, ...extra });
  const seen = t => project(data, toIso(t));
  const canAct = (person, member, t) => relation(data, person, member, t).act;
  const providerName = id => data.providers.find(p => p.provider_id === id).name;
  const serviceName = id => data.services.find(s => s.service_id === id).description;
  const paOf = id => data.pas.find(p => p.pa_id === id);
  const appealOf = id => data.appeals.find(a => a.appeal_id === id);
  const claimOf = id => data.claims.find(c => c.claim_id === id);
  const OPEN_PA = ['pending', 'info_requested'], OPEN_APPEAL = ['under_review', 'info_requested'];
  let claimN = 0, paN = 0;
  const grantId = () => 'gr-' + (Math.max(Number(data.issued.gr || 0), 0, ...data.grants.map(g => Number(g.grant_id.slice(3)) || 0)) + 1);
  const handled = new Set(), cobPlanned = new Map(), claimMeta = new Map(), paMeta = new Map(), appealMeta = new Map(), visits = [];
  const recovery = [];
  const busy = (person, t) => away(person, localDate(t)) || (person === 'm-2' && recovery.some(([a, b]) => t >= a && t <= b));
  const officeNear = (member, date) => visits.some(v => v.member === member && v.service === 'svc-office-visit' && Math.abs(lib.daysBetween(v.date, date)) <= OFFICE_GAP);
  const officeFull = (member, date) => new Set(visits.filter(v => v.member === member && v.service === 'svc-office-visit' && !v.accident && v.date.slice(0, 7) === date.slice(0, 7)).map(v => v.date)).size >= CAPS.office_per_month;
  const free = (member, provider, date, office = false) => {
    let d = date;
    while (!officeDay(d) || away(member, d) || visits.some(v => v.member === member && v.date === d && v.provider === provider) || (office && (officeNear(member, d) || officeFull(member, d)))) d = addDays(d, 1);
    return d;
  };
  const lastVisit = (member, provider, before) => visits.filter(v => v.member === member && v.provider === provider && v.date <= before).map(v => v.date).sort().at(-1);
  const authorized = (actor, member, t) => (canAct(actor, member, t) ? actor : member === 'm-3' ? (actor === 'm-1' ? 'm-2' : 'm-1') : member);

  function responder(member, t, R) {
    if (member === 'm-3') return authorized(R.chance(0.6) ? 'm-2' : 'm-1', member, t);
    const other = member === 'm-1' ? 'm-2' : 'm-1';
    if (canAct(other, member, t) && R.chance(member === 'm-1' ? 0.25 : 0.5)) return other;
    return member;
  }
  function answerTime(person, R, noticeT, expiresT) {
    const notice = localDate(noticeT), cfg = ANSWER[person];
    const lag = R.chance(cfg.late) ? R.between(32, 42) : 1 + Math.floor(R.next() * R.next() * cfg.quick);
    let date = addDays(notice, lag), t = householdAt(person, R, date);
    while (t >= expiresT - 2 * HOUR) { date = addDays(date, -1); t = householdAt(person, R, date); }
    return t > noticeT ? t : null;
  }

  function encounter(e) {
    if (!e.key) e.key = [e.member, e.provider, e.lines[0][1], e.lines.map(l => l[0]).join('+')].join('|');
    for (const [service, date, , flags = {}] of e.lines) visits.push({ member: e.member, provider: e.provider, service, date, accident: Boolean(flags.accident || flags.emergency) });
    const R = stream('bill:' + e.key), last = e.lines.reduce((m, l) => (l[1] > m ? l[1] : m), e.lines[0][1]);
    const when = e.receiveAfter !== undefined ? officeTimeAfter(R, e.receiveAfter, R.between(...LAG[e.provider])) : officeAt(R, officeAfter(last, R.between(...LAG[e.provider])));
    schedule(when, t => receive(t, e));
  }
  function receive(t, e) {
    const id = 'cl-' + (++claimN);
    const lines = e.lines.map(([service_id, service_date, billed_cents, flags = {}], i) => ({ line_id: 'ln-' + (i + 1), service_id, service_date, units: 1, billed_cents, emergency: Boolean(flags.emergency), possible_accident: Boolean(flags.accident) }));
    event(t, 'claim.received', { claim_id: id, member_id: e.member, provider_id: e.provider, lines }, { visit: e.kind, ...(e.course ? { course: e.course } : {}), ...(e.corrects ? { corrects: e.corrects } : {}), ...(e.episode ? { episode: e.episode } : {}) });
    claimMeta.set(id, e);
    schedule(ms(claimOf(id).review_at) + MINUTE, u => reviewed(id, u));
  }
  function reviewed(id, u) {
    const v = seen(u), c = v.claims.find(x => x.claim_id === id);
    scan(u);
    if (c.status !== 'pending_info') return;
    const open = v.info_requests.filter(r => r.claim_id === id && r.status === 'open');
    for (const r of open) schedule(ms(r.expires_at) + MINUTE, w => scan(w));
    const e = claimMeta.get(id), R = stream('answer:' + e.key);
    for (const year of [...new Set(open.filter(r => r.type === 'other_coverage').map(r => r.plan_year))]) {
      const key = c.member_id + ':' + year, planned = cobPlanned.get(key);
      if (planned && planned > u) continue;
      const actor = responder(c.member_id, u, R), cfg = ANSWER[actor];
      const expires = Math.min(...open.filter(r => r.type === 'other_coverage' && r.plan_year === year).map(r => ms(r.expires_at)));
      if (R.chance(cfg.other_coverage * (busy(actor, u) ? 2.5 : 1))) { cobPlanned.set(key, 0); continue; }
      const t = answerTime(actor, R, u, expires);
      if (t === null) continue;
      cobPlanned.set(key, t);
      schedule(t, w => cob(w, actor, c.member_id, year));
    }
    const accidents = open.filter(r => r.type === 'accident');
    if (!accidents.length) return;
    const actor = responder(c.member_id, u, R), cfg = ANSWER[actor];
    if (R.chance(cfg.accident * (busy(actor, u) ? 2 : 1))) return;
    const t = answerTime(actor, R, u, Math.min(...accidents.map(r => ms(r.expires_at))));
    if (t === null) return;
    const answer = e.cause === 'work' ? 'work_related' : e.cause === 'none' ? 'not_accident' : 'accident';
    accidents.forEach((r, i) => schedule(t + i * 2 * MINUTE, w => info(w, actor, id, r.line_id, answer)));
  }
  function cob(t, actor, member, year) {
    const v = seen(t);
    if (!v.info_requests.some(r => r.type === 'other_coverage' && r.status === 'open' && r.plan_year === year && v.claims.find(c => c.claim_id === r.claim_id).member_id === member)) return;
    call(t, authorized(actor, member, t), 'coverage.cob.confirm', { member_id: member, plan_year: year, answer: OTHER_COVERAGE[member + ':' + year] || 'none' });
    scan(t);
  }
  function info(t, actor, claim, line, answer) {
    const v = seen(t);
    if (!v.info_requests.some(r => r.claim_id === claim && r.line_id === line && r.type === 'accident' && r.status === 'open')) return;
    call(t, authorized(actor, v.claims.find(c => c.claim_id === claim).member_id, t), 'claims.info.confirm', { claim_id: claim, line_id: line, answer });
    scan(t);
  }
  function scan(u) {
    const v = seen(u);
    for (const c of v.claims) {
      if (c.status !== 'processed' || handled.has(c.claim_id)) continue;
      handled.add(c.claim_id);
      processed(v, c, u);
    }
  }
  function processed(v, c, u) {
    const e = claimMeta.get(c.claim_id);
    if (e.onProcessed) e.onProcessed(v, c, u);
    const v1 = v.eobs.find(x => x.claim_id === c.claim_id && x.version === 1);
    const denied = v1.lines.filter(l => l.status === 'denied');
    if (!denied.length) return;
    const reason = denied[0].reason;
    if (reason === 'other_party_liable' || denied.some(l => l.reason !== reason)) return;
    const R = stream('file:' + e.key);
    if (!R.chance(e.appeal === undefined ? LIKELY[reason] : e.appeal)) return;
    const line = c.lines.find(l => l.line_id === denied[0].line_id), noticeT = ms(c.processed_at);
    const facts = { member: c.member_id, service: serviceName(line.service_id), date: line.service_date, provider: providerName(c.provider_id), lines: denied.map(d => { const l = c.lines.find(x => x.line_id === d.line_id); return { service: serviceName(l.service_id), date: l.service_date }; }) };
    let statement, reply = null;
    if (reason === 'out_of_network' && e.emergencyStory) statement = STATEMENTS.emergency(facts);
    else if (reason === 'out_of_network') {
      const variant = stream('text:' + e.key).n(2);
      statement = STATEMENTS.out_of_network({ ...facts, orderer: providerName(e.ordered.provider), ordered: e.ordered.date, variant });
      reply = () => REPLIES.out_of_network(providerName(e.ordered.provider), e.ordered.date, providerName(c.provider_id), variant);
    } else if (reason === 'missing_information') {
      const expired = denied.map(d => v.info_requests.find(x => x.claim_id === c.claim_id && x.line_id === d.line_id && x.status === 'expired'));
      if (expired.some(x => !x || x.type !== expired[0].type)) return;
      const r = expired[0];
      if (r.type === 'other_coverage' && OTHER_COVERAGE[c.member_id + ':' + r.plan_year]) return;
      if (r.type === 'accident' && e.cause === 'work') return;
      statement = r.type === 'other_coverage' ? STATEMENTS.missing_coverage(facts) : STATEMENTS.missing_accident({ ...facts, cause: e.cause });
    } else if (reason === 'prior_auth_missing') {
      const moved = e.moved && e.moved[line.service_date];
      if (!moved || denied.length !== 1) return;
      statement = STATEMENTS.prior_auth_missing({ date: line.service_date, from: moved.from, pa: moved.pa });
      reply = () => REPLIES.prior_auth_missing(providerName(c.provider_id), moved.from, line.service_date, paOf(moved.pa).approved.valid_until);
    }
    const filer = responder(c.member_id, noticeT, R);
    const [lo, hi] = APPEAL[filer].file;
    const t = householdAfter(filer, R, u, lo + Math.floor(R.next() * R.next() * (hi - lo)));
    schedule(t, w => {
      const who = authorized(filer, c.member_id, w);
      const appeal = call(w, who, 'appeals.file.confirm', { target_type: 'claim', target_id: c.claim_id, statement }).appeal;
      appealMeta.set(appeal.appeal_id, { reason, claim: c.claim_id, filer: who });
      if (e.onAppealed) { e.onAppealed(appeal.appeal_id, w); return; }
      planAppeal(appeal, w, reason, { key: e.key, filer: who, service: facts.service, reply, days: [8, 30] });
    });
  }

  function planAppeal(appeal, t, reason, ctx) {
    const R = stream('plan:appeal:' + ctx.key), due = ms(appeal.due_at);
    const decide = (from, waited = false) => {
      const planned = waited ? planAfter(R, from, R.between(4, 12)) : planBefore(R, from, R.between(...ctx.days), due - HOUR);
      const when = !waited && R.chance(lateness(planned, 'appeal')) ? planAfter(R, due, R.between(1, 6)) : planned;
      schedule(when, x => decideAppeal(x, appeal.appeal_id, reason, ctx));
    };
    if (ctx.reply && R.chance(APPEAL_INFO[reason] || 0)) {
      schedule(planAfter(R, t, R.between(3, 9)), x => {
        if (appealOf(appeal.appeal_id).status !== 'under_review') return;
        event(x, 'appeal.info_requested', { appeal_id: appeal.appeal_id, request: reason === 'pa' ? APPEAL_REQUESTS.pa() : APPEAL_REQUESTS[reason](ctx.service) });
        const H = stream('reply:' + ctx.key);
        schedule(householdAfter(ctx.filer, H, x, H.between(1, 6)), y => {
          const b = appealOf(appeal.appeal_id);
          if (b.status !== 'info_requested') return;
          call(y, authorized(ctx.filer, b.member_id, y), 'appeals.add_statement', { appeal_id: appeal.appeal_id, statement: ctx.reply(x) });
          decide(y, true);
        });
      });
    } else decide(t);
  }
  function decideAppeal(t, id, reason, ctx) {
    const a = appealOf(id);
    if (!OPEN_APPEAL.includes(a.status)) return;
    const R = stream('plan:outcome:' + ctx.key);
    if (a.target.type === 'pa') {
      const over = R.chance(ctx.overturn);
      event(t, 'appeal.decided', over ? { appeal_id: id, outcome: 'overturned', units: ctx.units, valid_until: ctx.until(localDate(t)) } : { appeal_id: id, outcome: 'upheld' });
      if (over && ctx.onApproved) ctx.onApproved(t);
      return;
    }
    const over = R.chance(OVERTURN[reason]);
    event(t, 'appeal.decided', over ? { appeal_id: id, outcome: 'overturned', lines: [...a.lines] } : { appeal_id: id, outcome: 'upheld' });
  }

  const paRequest = spec => (spec.service === 'svc-arthroscopy' && !visits.some(v => v.member === spec.member && v.service === 'svc-physical-therapy') ? PA_REQUESTS['svc-arthroscopy-first'] : PA_REQUESTS[spec.service]);
  function submitPa(t, spec) {
    const id = 'pa-' + (++paN);
    event(t, 'pa.submitted', { pa_id: id, member_id: spec.member, provider_id: spec.provider, service_id: spec.service, units: spec.units, valid_from: spec.from, valid_until: spec.until }, spec.service === 'svc-physical-therapy' ? { course: spec.key.replace(/:resubmit$/, '') } : {});
    if (!paOf(id)) return null;
    paMeta.set(id, spec);
    const R = stream('plan:pa:' + spec.key), due = ms(paOf(id).due_at);
    const scheduleDecision = (from, waited = false) => {
      const planned = waited ? planAfter(R, from, R.between(1, 4)) : planBefore(R, from, R.between(...(spec.decideDays || [1, 5])), due - HOUR);
      const when = !waited && R.chance(lateness(planned, 'pa')) ? planAfter(R, due, R.between(1, 4)) : planned;
      schedule(when, z => decidePa(z, id));
    };
    if (spec.expedite) {
      const H = stream('expedite:' + spec.key);
      schedule(householdAfter(spec.expedite.by, H, t), x => {
        if (!OPEN_PA.includes(paOf(id).status)) return;
        call(x, spec.expedite.by, 'pa.request_expedite', { pa_id: id, reason: spec.expedite.reason });
        const ok = R.chance(spec.expedite.approve);
        schedule(promptly(R, x), y => {
          event(y, 'pa.expedite_decided', { pa_id: id, decision: ok ? 'approved' : 'denied' });
          if (ok) schedule(promptly(R, y), z => decidePa(z, id));
          else scheduleDecision(y);
        });
      });
      return id;
    }
    if (R.chance(PA_INFO[spec.service])) {
      schedule(planAfter(R, t, R.between(1, 3)), x => {
        if (paOf(id).status !== 'pending') return;
        event(x, 'pa.info_requested', { pa_id: id, request: paRequest(spec) });
        const B = stream('docs:' + spec.key);
        schedule(officeTimeAfter(B, x, 1 + Math.floor(B.next() * B.next() * 12)), y => { if (paOf(id).status !== 'info_requested') return; event(y, 'pa.info_provided', { pa_id: id }); scheduleDecision(y, true); });
      });
    } else scheduleDecision(t);
    return id;
  }
  function decidePa(t, id) {
    const p = paOf(id), spec = paMeta.get(id);
    if (p.status !== 'pending') return;
    const approve = stream('plan:outcome:pa:' + spec.key).chance(spec.approve);
    if (approve) {
      const today = localDate(t), from = spec.from < today ? today : spec.from, until = addDays(from, lib.daysBetween(spec.from, spec.until));
      event(t, 'pa.decided', { pa_id: id, decision: 'approved', units: spec.units, valid_from: from, valid_until: until });
      if (spec.onApproved) spec.onApproved(t, id);
    } else {
      event(t, 'pa.decided', { pa_id: id, decision: 'denied' });
      if (spec.onDenied) spec.onDenied(t, id);
    }
  }

  function course(member, pa, startAfter, spec) {
    const key = paMeta.get(pa).key, R = stream('therapy:' + key), p = paOf(pa);
    const pattern = R.pick([[1, 4], [2, 5], [1, 3]]);
    let date = addDays(localDate(startAfter), R.between(2, 6));
    if (date < p.approved.valid_from) date = p.approved.valid_from;
    const sessions = [], skipped = [], moved = {};
    const total = spec.sessions || p.approved.units;
    while (sessions.length < total && !(spec.stop && date >= spec.stop)) {
      if (officeDay(date) && pattern.includes(notes.weekday(date)) && !away(member, date)) {
        if (R.chance(spec.skip)) skipped.push(date);
        else {
          sessions.push(date);
          const from = skipped.filter(d => d <= p.approved.valid_until && lib.daysBetween(d, date) <= 14).at(-1);
          if (date > p.approved.valid_until && from) { moved[date] = { from, pa }; skipped.splice(skipped.indexOf(from), 1); }
          if (date > p.approved.valid_until) break;
        }
      }
      date = addDays(date, 1);
    }
    const C = stream('resubmit:' + key);
    if (sessions.length > 6 && !spec.stop && C.chance(0.45)) {
      schedule(officeAt(C, officeAfter(sessions[4], 1)), u => {
        const q = paOf(pa), left = q.approved.units - q.units_used;
        if (q.status !== 'approved' || left < 2 || addDays(localDate(u), 1) > q.approved.valid_until) return;
        submitPa(u, { key: key + ':resubmit', member, provider: 'pv-3', service: 'svc-physical-therapy', units: Math.min(4, left), from: addDays(localDate(u), 1), until: q.approved.valid_until, approve: 1 });
      });
    }
    const batches = [];
    for (const d of sessions) { const b = batches[batches.length - 1]; if (b && lib.daysBetween(b[0], d) < 14) b.push(d); else batches.push([d]); }
    batches.forEach((b, i) => encounter({ key: key + ':batch-' + (i + 1), member, provider: 'pv-3', kind: 'therapy', course: key, lines: b.map(d => ['svc-physical-therapy', d, billed(R, [16500, 17000], Number(d.slice(0, 4)))]), moved }));
    return sessions;
  }

  function storyInjuries() {
    const A = stream('story:riley-ankle'), ankle = A.pick(daysOf('2025-04-12', '2025-05-17').filter(d => notes.weekday(d) === 6));
    const K = stream('story:casey-knee'), kneeCause = K.chance(0.6) ? 'sport' : 'none', knee = K.pick(daysOf('2026-01-24', '2026-02-07').filter(d => notes.weekday(d) === 6));
    const H = stream('story:riley-knee'), game = H.pick(daysOf('2026-01-10', '2026-02-21').filter(d => notes.weekday(d) === 6 && !away('m-3', d)));
    const J = stream('story:jordan-work'), cut = J.pick(daysOf('2025-03-03', '2026-05-29').filter(d => officeDay(d) && !away('m-1', d)));
    const B = stream('story:jordan-back'), back = B.pick(daysOf('2026-08-24', '2026-09-18').filter(officeDay));
    return { ankle, kneeCause, knee, game, cut, back, injuries: [{ member: 'm-3', date: ankle }, { member: 'm-2', date: knee }, { member: 'm-3', date: game }, { member: 'm-1', date: cut }, { member: 'm-1', date: back }] };
  }
  function routine() {
    for (const member of ['m-1', 'm-2', 'm-3']) {
      const R = stream('visits:' + member), used = new Set();
      const office = kind => VISITS[kind].lines.some(([s]) => s === 'svc-office-visit');
      const take = (date, kind, dry = false) => {
        if (used.has(date) || away(member, date) || !officeDay(date) || (office(kind) && officeNear(member, date))) return false;
        used.add(date);
        const v = VISITS[kind], year = Number(date.slice(0, 4));
        const lines = v.lines.map(([s, prices]) => [s, date, billed(R, prices, year), v.accident ? { accident: true } : {}]);
        if (!dry && !(office(kind) && officeFull(member, date))) encounter({ member, provider: v.provider, kind, lines, cause: v.accident ? 'none' : null, ...(v.accident ? { episode: 'joint:' + member + ':' + date } : {}) });
        return true;
      };
      const sickIn = new Map(), injuriesIn = [];
      const sickFull = month => (sickIn.get(month) || 0) >= CAPS.sick_per_month;
      const injuryBlocked = d => pre.injuries.some(x => x.member === member && d >= addDays(x.date, -CAPS.story_injury_days) && d <= addDays(x.date, CAPS.story_injury_days + 7))
        || injuriesIn.some(x => Math.abs(lib.daysBetween(x, d)) <= CAPS.injury_gap_days || quarterOf(x) === quarterOf(d));
      const someDay = (month, visit = false) => {
        const days = daysOf(month + '-01', addDays(month + '-28', 3)).filter(d => d.startsWith(month) && officeDay(d) && !away(member, d) && !used.has(d) && !(visit && officeNear(member, d)));
        return days.length ? R.pick(days) : null;
      };
      for (const year of [2025, 2026]) {
        const d = someDay(year + '-' + pad(member === 'm-3' ? R.between(6, 8) : R.between(2, 10)), true);
        if (d) take(d, member === 'm-3' ? 'checkup' : 'physical');
        if (member === 'm-2') { const d2 = someDay(year + '-' + pad(R.between(1, 11)), true); if (d2) take(d2, 'labs'); }
      }
      if (member === 'm-1') {
        for (let d = addDays('2025-01-06', R.between(0, 30)); d <= LAST; d = addDays(d, R.between(84, 98))) {
          let day = d;
          while (day <= LAST && (!officeDay(day) || away(member, day) || used.has(day) || officeNear(member, day))) day = addDays(day, 1);
          if (day <= LAST) take(day, 'labs');
        }
      }
      for (const month of lib.months()) {
        const mm = month.slice(5);
        for (const [kind, rate] of Object.entries(RATES[member])) {
          const mult = (kind === 'sick' || kind === 'strep') ? (SEASON.winter.includes(mm) ? 1.7 : SEASON.summer.includes(mm) ? 0.5 : 1) : 1;
          for (let k = R.count(rate * mult); k > 0; k--) {
            const d = someDay(month, ['sick', 'strep', 'imaging'].includes(kind) || (VISITS[kind] && office(kind)));
            if (!d) continue;
            if (kind === 'injury') { used.add(d); const dry = injuryBlocked(d); injury(member, d, R, dry); if (!dry) injuriesIn.push(d); continue; }
            const sick = ['sick', 'strep', 'imaging'].includes(kind), dry = sick && sickFull(month);
            const done = kind === 'imaging' ? ordered(member, d, R, used, dry) : take(d, kind, dry);
            if (sick && done && !dry) sickIn.set(month, (sickIn.get(month) || 0) + 1);
          }
        }
      }
    }
  }
  function ordered(member, date, R, used, dry = false) {
    used.add(date);
    const year = Number(date.slice(0, 4)), test = R.pick([['svc-ultrasound', [58500, 61000]], ['svc-xray', [14500, 15800]]]);
    const visit = { member, provider: 'pv-1', kind: 'sick', lines: [['svc-office-visit', date, billed(R, [21000, 21500, 22000], year)]] };
    let day = officeAfter(date, R.between(4, 12));
    while (away(member, day) || used.has(day)) day = officeAfter(addDays(day, 1), 0);
    used.add(day);
    const outside = R.chance(0.2), scan = { member, provider: outside ? 'pv-5' : 'pv-4', kind: 'imaging', ordered: { provider: 'pv-1', date }, lines: [[test[0], day, billed(R, test[1], Number(day.slice(0, 4)))]] };
    if (!dry && !officeFull(member, date)) { encounter(visit); encounter(scan); }
    return true;
  }
  function injury(member, date, R, dry = false) {
    const cause = R.weighted(CAUSE_WEIGHTS[member]), year = Number(date.slice(0, 4)), episode = 'injury:' + member + ':' + date;
    const make = e => { if (!dry) encounter({ ...e, episode }); };
    if (cause === 'work') {
      make({ member, provider: 'pv-1', kind: 'injury', cause, lines: [['svc-office-visit', date, billed(R, [21000, 21500], year), { accident: true }], ['svc-wound-repair', date, billed(R, [46000, 48500], year), { accident: true }]] });
      return;
    }
    if (member === 'm-3' && R.chance(0.35)) {
      make({ member, provider: 'pv-4', kind: 'injury', cause, lines: [['svc-er-visit', date, billed(R, [231000, 241000], year), { emergency: true, accident: true }], ['svc-xray', date, billed(R, [15800, 16800], year), { emergency: true, accident: true }]] });
      return;
    }
    make({ member, provider: 'pv-2', kind: 'injury', cause, lines: [['svc-specialist-visit', date, billed(R, [33500, 34000], year), { accident: true }], ['svc-xray', date, billed(R, [15800, 16800], year), { accident: true }]] });
  }

  function stories() {
    const G = stream('story:grants');
    schedule(householdAt('m-1', G, '2025-01-01'), t => call(t, 'm-1', 'grants.change.confirm', { action: 'grant', member_id: 'm-1', grantee_id: 'm-2', scope: 'act', expires_at: '2026-01-01T00:00:00-05:00' }));
    schedule(householdAt('m-1', G, G.pick(daysOf('2025-12-01', '2025-12-20'))), t => call(t, 'm-1', 'grants.change.confirm', { action: 'grant', member_id: 'm-1', grantee_id: 'm-2', scope: 'act', expires_at: '2027-01-01T00:00:00-05:00' }));
    let viewId = null;
    schedule(householdAt('m-2', G, G.pick(daysOf('2025-02-08', '2025-02-23'))), t => { viewId = grantId(); event(t, 'grant.changed', { grant_id: viewId, member_id: 'm-2', grantor_id: 'm-2', grantee_id: 'm-1', scope: 'view', expires_at: null, status: 'active' }); });
    schedule(householdAt('m-2', G, G.pick(daysOf('2025-09-06', '2025-09-28'))), t => event(t, 'grant.changed', { grant_id: viewId, status: 'revoked' }));

    const A = stream('story:riley-ankle');
    const visit = free('m-3', 'pv-2', officeAfter(addDays(pre.ankle, 1), A.between(0, 1)));
    encounter({ episode: 'riley-ankle', member: 'm-3', provider: 'pv-2', kind: 'injury', cause: 'sport', lines: [['svc-specialist-visit', visit, billed(A, [33500, 34000], 2025), { accident: true }], ['svc-xray', visit, billed(A, [15800, 16800], 2025), { accident: true }]] });
    schedule(officeAt(A, officeAfter(visit, A.between(1, 2))), t => {
      const from = addDays(localDate(t), 3), season = officeAfter(addDays(localDate(t), A.between(9, 16)), 0);
      submitPa(t, {
        key: 'riley-ankle', member: 'm-3', provider: 'pv-3', service: 'svc-physical-therapy', units: 8, from, until: addDays(from, 34), approve: 0.95,
        expedite: A.chance(0.8) ? { by: A.chance(0.6) ? 'm-2' : 'm-1', reason: EXPEDITES['svc-physical-therapy']({ member: 'm-3', season }), approve: 0.75 } : null,
        onApproved: (u, pa) => course('m-3', pa, u, { skip: 0.12 }),
      });
    });

    const U = stream('story:casey-ultrasound');
    const pain = free('m-2', 'pv-1', U.pick(daysOf('2025-05-05', '2025-06-13').filter(officeDay)), true);
    encounter({ member: 'm-2', provider: 'pv-1', kind: 'sick', lines: [['svc-office-visit', pain, billed(U, [21000, 21500], 2025)]] });
    encounter({ member: 'm-2', provider: 'pv-5', kind: 'imaging', ordered: { provider: 'pv-1', date: pain }, lines: [['svc-ultrasound', free('m-2', 'pv-5', officeAfter(pain, U.between(8, 12))), billed(U, [58500, 61000], 2025)]] });

    const S = stream('story:casey-semaglutide');
    const visit2 = free('m-2', 'pv-1', S.pick(daysOf('2025-09-08', '2025-10-10').filter(officeDay)), true);
    encounter({ member: 'm-2', provider: 'pv-1', kind: 'work-up', lines: [['svc-office-visit', visit2, billed(S, [21500, 22000], 2025)], ['svc-lab-panel', visit2, billed(S, [9418, 11826], 2025)]] });
    const since = notes.spoken(addDays(visit2, -S.between(300, 420))).replace(/ \d+,/, '');
    const prescriber = providerName('pv-1');
    let round = 0;
    const semaglutide = (t, first) => {
      const from = addDays(localDate(t), S.between(3, 7)), until = addDays(from, 181), key = 'casey-semaglutide-' + (++round);
      submitPa(t, {
        key, member: 'm-2', provider: 'pv-1', service: 'svc-semaglutide-1', units: 6, from, until, approve: first ? 0.25 : 0.8,
        onDenied: (u, pa) => {
          if (!S.chance(LIKELY.pa)) return;
          schedule(householdAfter('m-2', S, u, S.between(3, 12)), w => {
            const appeal = call(w, 'm-2', 'appeals.file.confirm', { target_type: 'pa', target_id: pa, statement: STATEMENTS.pa_semaglutide({ since, provider: prescriber }) }).appeal;
            planAppeal(appeal, w, 'pa', { key, filer: 'm-2', overturn: 0.6, units: 6, until: d => addDays(d, 180), days: [4, 14], reply: x => REPLIES.pa(prescriber, lastVisit('m-2', 'pv-1', localDate(x))), onApproved: renewal });
          });
        },
        onApproved: renewal,
      });
    };
    function renewal() {
      const p = data.pas.filter(x => x.member_id === 'm-2' && x.service_id === 'svc-semaglutide-1' && x.approved).at(-1);
      const visitDay = free('m-2', 'pv-1', officeAfter(addDays(p.approved.valid_until, -S.between(20, 30)), 0), true);
      if (visitDay >= LAST) return;
      encounter({ member: 'm-2', provider: 'pv-1', kind: 'follow-up', lines: [['svc-office-visit', visitDay, billed(S, [21500, 22000], Number(visitDay.slice(0, 4)))]] });
      schedule(officeAt(S, officeAfter(visitDay, S.between(2, 5))), u => semaglutide(u, false));
    }
    schedule(officeAt(S, officeAfter(visit2, S.between(2, 5))), t => semaglutide(t, true));

    const W = stream('story:winter-trip');
    encounter({ member: W.pick(['m-1', 'm-2', 'm-3']), provider: 'pv-6', kind: 'emergency', lines: [['svc-er-visit', '2025-12-31', billed(W, [268500, 271000], 2025), { emergency: true }], ['svc-lab-panel', '2026-01-01', billed(W, [11800, 12400], 2026), { emergency: true }]] });

    const K = stream('story:casey-knee');
    const cause = pre.kneeCause;
    const ortho = free('m-2', 'pv-2', officeAfter(addDays(pre.knee, 2), K.between(1, 4)));
    encounter({ episode: 'casey-knee', member: 'm-2', provider: 'pv-2', kind: 'injury', cause, lines: [['svc-specialist-visit', ortho, billed(K, [33500, 34000], 2026), { accident: true }]] });
    const mri = free('m-2', 'pv-4', officeAfter(ortho, K.between(7, 12)));
    encounter({ episode: 'casey-knee', member: 'm-2', provider: 'pv-4', kind: 'imaging', cause, lines: [['svc-knee-mri', mri, billed(K, [172000, 180000], 2026), { accident: true }]] });
    const surgeon = providerName('pv-2');
    schedule(officeAt(K, officeAfter(mri, K.between(3, 6))), t => {
      const from = addDays(localDate(t), 14);
      const pa = submitPa(t, { key: 'casey-knee-surgery-1', member: 'm-2', provider: 'pv-2', service: 'svc-arthroscopy', units: 1, from, until: addDays(from, 45), approve: 0, decideDays: [4, 7] });
      schedule(officeTimeAfter(K, t, K.between(1, 2)), u => {
        if (!OPEN_PA.includes(paOf(pa).status)) return;
        event(u, 'pa.withdrawn', { pa_id: pa });
        schedule(officeTimeAfter(K, u, K.between(1, 3)), w => {
          const from2 = addDays(localDate(w), 2);
          submitPa(w, { key: 'casey-knee-preop', member: 'm-2', provider: 'pv-3', service: 'svc-physical-therapy', units: 12, from: from2, until: addDays(from2, 55), approve: 1, onApproved: (x, pt) => preop(x, pt) });
        });
      });
    });
    const surgery = x => {
      const day = free('m-2', 'pv-4', officeAfter(addDays(localDate(x), 1), K.between(2, 5)));
      schedule(householdAfter('m-2', K, x), y => event(y, 'grant.changed', { grant_id: grantId(), member_id: 'm-2', grantor_id: 'm-2', grantee_id: 'm-1', scope: 'act', expires_at: toIso(fromLocal(addDays(day, 56), '00:00')), status: 'active' }));
      recovery.push([fromLocal(day, '00:00'), fromLocal(addDays(day, 42), '00:00')]);
      encounter({ member: 'm-2', provider: 'pv-4', kind: 'surgery', lines: [['svc-arthroscopy', day, billed(K, [912000, 948000], 2026)], ['svc-specialist-visit', day, billed(K, [36500, 38000], 2026)]] });
      schedule(officeAt(K, officeAfter(day, K.between(3, 6))), y => {
        const from3 = addDays(localDate(y), 1);
        submitPa(y, { key: 'casey-knee-postop', member: 'm-2', provider: 'pv-3', service: 'svc-physical-therapy', units: 12, from: from3, until: addDays(from3, 48), approve: 1, onApproved: (z, pt2) => course('m-2', pt2, z, { skip: 0.12 }) });
      });
    };
    const preop = (t, pt) => {
      const lock = free('m-2', 'pv-2', officeAfter(addDays(localDate(t), K.between(30, 38)), 0));
      course('m-2', pt, t, { skip: 0.1, stop: lock });
      encounter({ member: 'm-2', provider: 'pv-2', kind: 'orthopedic', lines: [['svc-specialist-visit', lock, billed(K, [33500, 34000], 2026)]] });
      schedule(officeAt(K, officeAfter(lock, 1), 480, 690), u => {
        const from = localDate(u);
        submitPa(u, {
          key: 'casey-knee-surgery-2', member: 'm-2', provider: 'pv-2', service: 'svc-arthroscopy', units: 1, from, until: addDays(from, 30), approve: K.chance(0.15) ? 1 : 0,
          expedite: { by: 'm-2', reason: EXPEDITES['svc-arthroscopy']({ provider: surgeon, seen: lock }), approve: 1 },
          onApproved: x => surgery(x),
          onDenied: (x, pa) => schedule(householdAfter('m-2', K, x), y => {
            const appeal = call(y, 'm-2', 'appeals.file.confirm', { target_type: 'pa', target_id: pa, statement: STATEMENTS.pa_arthroscopy({ provider: surgeon, seen: lock }), expedited: true, urgency_attested: true }).appeal;
            const R = stream('plan:appeal:casey-knee-surgery-2');
            const over = options.surgery ? options.surgery === 'overturned' : stream('story:casey-surgery-appeal').chance(OVERTURN.expedited_surgery);
            schedule(Math.min(planAfter(R, y, 0), ms(appeal.due_at) - 2 * HOUR), z => {
              if (over) { event(z, 'appeal.decided', { appeal_id: appeal.appeal_id, outcome: 'overturned', units: 1, valid_until: addDays(localDate(z), 30) }); surgery(z); return; }
              event(z, 'appeal.decided', { appeal_id: appeal.appeal_id, outcome: 'upheld' });
              const M = stream('story:casey-more-therapy');
              schedule(officeAt(M, officeAfter(localDate(z), M.between(1, 3))), w => {
                const from4 = addDays(localDate(w), 1);
                submitPa(w, { key: 'casey-knee-more-therapy', member: 'm-2', provider: 'pv-3', service: 'svc-physical-therapy', units: 8, from: from4, until: addDays(from4, 34), approve: 1, onApproved: (x, pt) => course('m-2', pt, x, { skip: 0.1 }) });
              });
              schedule(officeAt(K, officeAfter(localDate(z), K.between(25, 35))), w => {
                const from2 = localDate(w);
                submitPa(w, { key: 'casey-knee-surgery-3', member: 'm-2', provider: 'pv-2', service: 'svc-arthroscopy', units: 1, from: from2, until: addDays(from2, 30), approve: 1, onApproved: q => surgery(q) });
              });
            });
          }),
        });
      });
    };
    const C = stream('story:corrected-claim');
    const urgent = C.pick(daysOf('2026-07-19', '2026-07-25'));
    const er = billed(C, [241000, 248000], 2026);
    encounter({
      member: 'm-3', provider: 'pv-6', kind: 'emergency', emergencyStory: true, appeal: 1, lines: [['svc-er-visit', urgent, er]],
      onAppealed: (appeal, t) => encounter({
        member: 'm-3', provider: 'pv-6', kind: 'emergency', corrects: appealMeta.get(appeal).claim, receiveAfter: t, lines: [['svc-er-visit', urgent, er, { emergency: true }]],
        onProcessed: (v, c, u) => {
          const filer = appealMeta.get(appeal).filer, H = stream('withdraw:corrected-claim');
          schedule(householdAfter(filer, H, u, H.between(1, 5)), w => { if (OPEN_APPEAL.includes(appealOf(appeal).status)) call(w, authorized(filer, 'm-3', w), 'appeals.withdraw.confirm', { appeal_id: appeal }); });
        },
      }),
    });

    const H = stream('story:riley-knee');
    const game = pre.game;
    const seenOn = free('m-3', 'pv-2', officeAfter(addDays(game, 1), H.between(0, 2)));
    encounter({ episode: 'riley-knee', member: 'm-3', provider: 'pv-2', kind: 'injury', cause: 'sport', lines: [['svc-specialist-visit', seenOn, billed(H, [34000, 35000], 2026), { accident: true }], ['svc-xray', seenOn, billed(H, [16300, 17300], 2026), { accident: true }]] });
    schedule(officeAt(H, officeAfter(seenOn, H.between(1, 3))), t => {
      const from = addDays(localDate(t), 3);
      submitPa(t, { key: 'riley-knee', member: 'm-3', provider: 'pv-3', service: 'svc-physical-therapy', units: 6, from, until: addDays(from, 27), approve: 0.9, onApproved: (u, pa) => course('m-3', pa, u, { skip: 0.12 }) });
    });

    const J = stream('story:jordan-work');
    const cut = free('m-1', 'pv-1', pre.cut, true);
    encounter({ episode: 'jordan-work', member: 'm-1', provider: 'pv-1', kind: 'injury', cause: 'work', lines: [['svc-office-visit', cut, billed(J, [21000, 21500], Number(cut.slice(0, 4))), { accident: true }], ['svc-wound-repair', cut, billed(J, [46000, 48500], Number(cut.slice(0, 4))), { accident: true }]] });

    const B = stream('story:jordan-back');
    const back = free('m-1', 'pv-1', pre.back, true);
    encounter({ episode: 'jordan-back', member: 'm-1', provider: 'pv-1', kind: 'injury', cause: 'home', lines: [['svc-office-visit', back, billed(B, [21500, 22000], 2026), { accident: true }]] });
    schedule(officeAt(B, officeAfter(back, B.between(2, 4))), t => {
      const from = addDays(localDate(t), 3);
      submitPa(t, { key: 'jordan-back', member: 'm-1', provider: 'pv-3', service: 'svc-physical-therapy', units: 8, from, until: addDays(from, 34), approve: 1, onApproved: (u, pa) => course('m-1', pa, u, { skip: 0.12 }) });
    });
  }

  const pre = storyInjuries();
  routine();
  stories();
  while (queue.length) {
    const item = queue.shift();
    now = item.t;
    running = { causes: item.causes, made: [] };
    item.fn(item.t);
    running = null;
  }
  return { base, data, steps, reference };
}

function check(base, log, end, live, reference) {
  const problems = [];
  const expect = (ok, message) => { if (!ok) problems.push(message); };
  const replayed = lib.replay(base, log.steps).data;
  expect(JSON.stringify(replayed) === JSON.stringify(live), 'replaying the steps over the base reproduces the generated state');
  expect(log.steps.every((s, i) => i === 0 || ms(s.at) >= ms(log.steps[i - 1].at)), 'steps are in time order');
  expect(log.steps.every(s => ms(s.at) >= ms(START) && ms(s.at) < ms(END)), 'every step is inside the window');
  const counts = Object.fromEntries(lib.months().map(m => [m, [end.claims.filter(c => lib.dateOf(c.received_at).startsWith(m)).length, end.eobs.filter(e => lib.dateOf(e.issued_at).startsWith(m)).length]]));
  expect(Object.values(counts).every(([c]) => c >= 1), 'a claim received in every month: ' + JSON.stringify(counts));
  const texts = notes.problems(end, log.steps);
  expect(texts.length === 0, 'every text agrees with the records it describes: ' + texts.join('; '));
  const atReference = lib.replay(base, log.steps, REFERENCE).data;
  expect(JSON.stringify(catalog(atReference)) === JSON.stringify(catalog(reference)), 'at the fixture clock the account and catalog equal the fixture');
  expect(Buffer.byteLength(lib.pretty(end)) < 1024 * 1024, 'the end state is under 1 MiB');
  const hurt = lib.injuryProblems(end, log.steps), load = lib.visitLoad(end), late = lib.afterEnd(end, log.steps), kinds = lib.visitProblems(end, log.steps, VISITS);
  expect(kinds.length === 0, 'every claim names its kind of visit, which fits its services and provider, a member has at most ' + lib.CAPS.sick_per_month + ' sick visit a month and their yearly visits, Jordan\'s lab visits are 12 to 14 weeks apart from the window start to its end, and each semaglutide request has its own work-up or follow-up visit before it: ' + kinds.join('; '));
  expect(late.length === 0, 'every therapy claim and request names its course, and a course has at most one session outside its own authorizations, its last, after one ends, counting a corrected session once: ' + late.join('; '));
  expect(hurt.length === 0, 'every injury names its episode, whose name, member and dates fit the claim, two injuries of one member are more than ' + lib.CAPS.story_injury_days + ' days apart, two routine injuries more than ' + lib.CAPS.injury_gap_days + ' days apart and a member has at most one routine injury a quarter: ' + hurt.join('; '));
  expect(load.length === 0, 'a member has at most ' + lib.CAPS.office_per_month + ' office visits a month, apart from injuries: ' + load.join('; '));
  const clash = lib.collisions(end, log.steps);
  expect(clash.length === 0, 'no member has two visits billed at one provider on one day, nor two office visits on one day: ' + clash.join('; '));
  const missing = variety(end, log.steps);
  expect(missing.length === 0, 'the window holds every kind of record and outcome: missing ' + missing.join('; '));
  return problems;
}

function variety(end, steps) {
  const missing = [];
  const need = (ok, what) => { if (!ok) missing.push(what); };
  const has = (list, test) => list.some(test);
  const lines = end.eobs.flatMap(e => e.lines.map(l => ({ e, l })));
  for (const reason of ['out_of_network', 'prior_auth_missing', 'other_party_liable', 'missing_information']) need(has(lines, x => x.l.reason === reason), 'a line denied as ' + reason);
  need(has(lines, x => x.l.copay_cents > 0) && has(lines, x => x.l.deductible_cents > 0) && has(lines, x => x.l.coinsurance_cents > 0), 'copay, deductible and coinsurance lines');
  need(has(end.eobs, e => e.version === 2), 'an EOB version 2');
  need(has(end.claims, c => c.lines.some(l => l.service_date.startsWith('2025'))) && has(end.claims, c => new Set(c.lines.map(l => l.service_date.slice(0, 4))).size === 2), 'a claim posting to two plan years');
  for (const answer of ['none', 'other_secondary']) need(has(end.info_requests, r => r.type === 'other_coverage' && r.answer === answer), 'an other-coverage question answered ' + answer);
  for (const answer of ['accident', 'not_accident', 'work_related']) need(has(end.info_requests, r => r.type === 'accident' && r.answer === answer), 'an accident question answered ' + answer);
  need(has(end.info_requests, r => r.status === 'expired'), 'an expired information request');
  for (const status of ['withdrawn', 'expired']) need(has(end.pas, p => p.status === status), 'a PA ' + status);
  need(has(end.pas, p => p.denial_notice_at !== null), 'a denied PA');
  need(has(end.pas, p => p.approved !== null && p.decided_at !== null), 'an approved PA');
  need(has(end.pas, p => p.info_requests.length), 'a PA information request');
  need(has(end.pas, p => p.expedite && p.expedite.status === 'approved'), 'an approved expedite');
  need(has(end.pas, p => p.overdue), 'an overdue PA');
  need(has(end.pas, p => p.covered_submissions.length), 'a covered PA submission');
  need(has(end.pas, p => p.service_id === 'svc-semaglutide-1'), 'a pharmacy PA');
  for (const status of ['upheld', 'overturned', 'withdrawn']) need(has(end.appeals, a => a.target.type === 'claim' && a.status === status), 'a claim appeal ' + status);
  need(has(end.appeals, a => a.target.type === 'pa' && a.expedited && ['upheld', 'overturned'].includes(a.status)), 'an expedited PA appeal decided');
  need(has(end.appeals, a => a.info_requests.length && a.statements.length > 1), 'an appeal information request answered with a statement');
  need(has(end.appeals, a => a.overdue), 'an overdue appeal');
  need(has(end.windows, w => w.closing.notice_at !== null), 'an appeal window closing notice');
  for (const scope of ['view', 'act']) need(has(end.grants, g => g.scope === scope), 'a ' + scope + ' grant');
  need(has(end.grants, g => g.status === 'revoked') && has(end.grants, g => g.expires_at !== null && g.expires_at < END && g.status === 'active'), 'a revoked and an expired grant');
  need(steps.some(s => s.tool === P + 'grants.change.confirm') && steps.some(s => s.operation === 'grant.changed'), 'grants changed by the account holder and by events');
  const operations = new Set(steps.map(s => s.operation).filter(Boolean)), tools = new Set(steps.map(s => s.tool).filter(Boolean));
  for (const op of ['claim.received', 'pa.submitted', 'pa.info_requested', 'pa.info_provided', 'pa.decided', 'pa.withdrawn', 'pa.expedite_decided', 'appeal.info_requested', 'appeal.decided', 'grant.changed']) need(operations.has(op), 'a ' + op + ' event');
  for (const tool of lib.TOOLS.filter(t => !t.read_only).map(t => t.name)) need(tools.has(tool), 'a ' + tool.slice(P.length) + ' call');
  const kinds = new Set(end.notices.map(n => n.kind));
  for (const kind of ['notice.eob_available', 'notice.info_requested', 'notice.claim_denied', 'notice.pa_decision', 'notice.appeal_received', 'notice.appeal_info_requested', 'notice.appeal_decision', 'notice.appeal_window_closing', 'notice.decision_overdue']) need(kinds.has(kind), 'a ' + kind);
  return missing;
}

function selectEnd(data) {
  const out = structuredClone(data);
  applyDueTimers(out, toIso(ms(END) - 1));
  out.seed_id = SEED_IDS.full;
  return out;
}

function build(options = {}) {
  const { base, data, steps, reference } = simulate(options);
  const log = { schema: 'larkfield-health.delivery-replay.v1', dataset_id: SEED_IDS.full, generator: { tool: 'dataset/generate.cjs', version: VERSION, seed: SEED }, time_zone: lib.ZONE, starts_at: START, ends_at: END, reference_clock: REFERENCE, base: FILES.base, end_state: FILES.full, steps };
  const end = selectEnd(data);
  lib.validate(end, END);
  const problems = check(base, log, end, data, reference);
  if (problems.length) throw Error(problems.join('\n'));
  return { [FILES.base]: lib.pretty(base), [FILES.replay]: lib.replayText(log), [FILES.full]: lib.pretty(end), stats: { claims: end.claims.length, pas: end.pas.length, appeals: end.appeals.length, notices: end.notices.length, steps: steps.length, bytes: Buffer.byteLength(lib.pretty(end)) } };
}

function main() {
  const out = build();
  const files = [FILES.base, FILES.replay, FILES.full];
  if (process.argv.includes('--check')) {
    const differs = files.filter(rel => !fs.existsSync(lib.file(rel)) || fs.readFileSync(lib.file(rel), 'utf8') !== out[rel]);
    console.log(differs.length ? 'delivery dataset differs from the generator output: ' + differs.join(', ') : 'delivery dataset is up to date: ' + JSON.stringify(out.stats));
    process.exitCode = differs.length ? 1 : 0;
    return;
  }
  for (const rel of files) fs.writeFileSync(lib.file(rel), out[rel]);
  console.log(JSON.stringify(out.stats));
}

if (require.main === module) main();
module.exports = { CAPS, promptly, random, backlogs, build, simulate, selectEnd, catalog, variety, check, SEED, VERSION, RATES, VISITS, ANSWER, LIKELY, OVERTURN, PLAN_LATE, OTHER_COVERAGE };
