'use strict';
// Generates Counterline's delivery dataset: two years (2025-01-01 to 2026-12-31) of one customer's history
// with one provider, for each fixture family. Fully synthetic; no website content is modeled.
//
// The history is not written by hand. A seeded agenda of customer and provider steps runs in time order
// through Counterline's own business code (the same handleTool and applyEvent the runtime calls), so every
// record follows the App's rules. Each executed call is logged with its virtual time in actions.json, so any
// earlier state can be rebuilt exactly by replay (scripts/select-history.cjs).
//
// Run: node scripts/generate-dataset.cjs          (write datasets/)
//      node scripts/generate-dataset.cjs --check  (fail if a regenerated file differs)
const fs = require('node:fs');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const root = path.resolve(__dirname, '..');
const OUT = path.join(root, 'datasets');
const binding = require('../fixtures/binding.json');
const ZONE = 'America/New_York';
const END = '2026-12-31T23:59:00-05:00';

// ---------- deterministic helpers ----------
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const offsetAt = ms => { const m = /GMT([+-]\d+)/.exec(new Intl.DateTimeFormat('en-US', { timeZone: ZONE, timeZoneName: 'shortOffset' }).format(new Date(ms))); return Number(m ? m[1] : 0); };
// Local wall time in New York, rendered with the offset in force then.
function local(y, mo, d, h = 9, mi = 0) {
  let off = -5;
  for (let i = 0; i < 2; i++) off = offsetAt(Date.UTC(y, mo - 1, d, h - off, mi));
  const p = n => String(n).padStart(2, '0');
  return `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:00${off < 0 ? '-' : '+'}${p(Math.abs(off))}:00`;
}
const plusMinutes = (iso, min) => { const t = Date.parse(iso) + min * 60e3; const d = new Date(t + offsetAt(t) * 3600e3); return local(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()); };
const plusDays = (iso, days) => plusMinutes(iso, days * 1440);

// ---------- provider bases (authored) ----------
function cardBase() {
  const d = structuredClone(require('../fixtures/minimal.json'));
  const p = d.provider;
  p.topics.push(
    { topic_id: 'late_fee', title: 'A late fee on my statement', greeting_script_id: 'greet-late', identity_required: true },
    { topic_id: 'interest_charge', title: 'An interest charge I did not expect', greeting_script_id: 'greet-interest', identity_required: true },
    { topic_id: 'foreign_fee', title: 'A foreign transaction fee', greeting_script_id: 'greet-foreign', identity_required: true },
    { topic_id: 'card_replacement', title: 'Replace a lost or damaged card', greeting_script_id: 'greet-card', identity_required: true },
    { topic_id: 'statement_question', title: 'A question about my statement', greeting_script_id: 'greet-general', identity_required: false },
    { topic_id: 'travel_notice', title: 'Traveling with my card', greeting_script_id: 'greet-general', identity_required: false },
    { topic_id: 'payment_question', title: 'A question about a payment', greeting_script_id: 'greet-general', identity_required: false });
  p.scripts.push(
    { script_id: 'greet-late', text: 'Thanks for contacting Larchmont Card Services. I can look at the late fee. Please confirm the last four digits of your card and your billing ZIP code.' },
    { script_id: 'greet-interest', text: 'Thanks for contacting Larchmont Card Services. I can review the interest charge. Please confirm the last four digits of your card and your billing ZIP code.' },
    { script_id: 'greet-foreign', text: 'Thanks for contacting Larchmont Card Services. I can look at that fee. Please confirm the last four digits of your card and your billing ZIP code.' },
    { script_id: 'greet-card', text: 'Thanks for contacting Larchmont Card Services. I can order a new card. Please confirm the last four digits of your card and your billing ZIP code.' },
    { script_id: 'greet-general', text: 'Thanks for contacting Larchmont Card Services. How can I help today?' },
    { script_id: 'followup-report-posted', text: 'The credit we promised has been sent to your card account.' });
  const cat = (catalog_id, topic_id, kind, title, terms, amount, perform_days = 7) => ({ catalog_id, topic_id, tier: 'frontline', stage: 'initial', kind, title, terms,
    value: amount === null ? null : { amount_minor: amount, currency: 'USD' }, conditions: [], group: `${topic_id}-relief`, expires_hours: 72, perform_days });
  p.offer_catalog.push(
    cat('cat-late-f1', 'late_fee', 'fee_waiver', 'Late fee waiver', 'The 39.00 late fee on this statement is waived as a one-time courtesy.', 3900),
    cat('cat-int-f1', 'interest_charge', 'refund', 'Interest refund', 'The 24.80 interest charge on this statement is refunded as a statement credit.', 2480),
    cat('cat-fx-f1', 'foreign_fee', 'refund', 'Foreign fee refund', 'The 11.25 foreign transaction fee is refunded as a statement credit.', 1125),
    cat('cat-card-f1', 'card_replacement', 'refund', 'Expedited delivery fee refund', 'The 15.00 expedited delivery fee for your new card is refunded.', 1500, 10));
  d.help_articles.push(
    { article_id: 'kb-late-fees', title: 'Late fees and courtesy waivers', body: 'A late fee posts if the minimum payment arrives after the due date. Customer Care can review a first late fee.', tags: ['late fee', 'fees'], updated_at: '2025-02-03T10:00:00-05:00', revisions: null },
    { article_id: 'kb-travel', title: 'Using your card abroad', body: 'You do not need to tell us before you travel. Foreign transaction fees appear as separate lines on your statement.', tags: ['travel', 'foreign fee'], updated_at: '2025-05-12T10:00:00-04:00', revisions: null },
    { article_id: 'kb-replacement', title: 'Replacing a card', body: 'A replacement card arrives in 7 to 10 days. Expedited delivery has a fee.', tags: ['card', 'replacement'], updated_at: '2025-08-18T10:00:00-04:00', revisions: null },
    { article_id: 'kb-annual-fee-2026', title: 'Annual fee changes for 2026', body: 'The annual fee stays at 250.00 for accounts renewing in 2026. Fee reviews are handled by Account Review.', tags: ['annual fee'], updated_at: '2026-01-06T09:00:00-05:00', revisions: null });
  d.cases = []; d.offers = []; d.commitments = []; d.confirmations = []; d.outbox = [];
  return withRevisions(d);
}

function ispBase() {
  const d = structuredClone(require('../fixtures/internet-provider.json'));
  const p = d.provider;
  p.topics.push(
    { topic_id: 'outage_credit', title: 'Credit for a service outage', greeting_script_id: 'greet-outage', identity_required: true },
    { topic_id: 'plan_change', title: 'Change my plan', greeting_script_id: 'greet-plan', identity_required: true },
    { topic_id: 'equipment', title: 'A problem with my router', greeting_script_id: 'greet-general', identity_required: false },
    { topic_id: 'moving', title: 'Moving to a new address', greeting_script_id: 'greet-general', identity_required: false });
  p.scripts.push(
    { script_id: 'greet-outage', text: 'Thanks for contacting Kestrel Fiber. I can check outage credits. Please confirm the name on the account and your billing ZIP code.' },
    { script_id: 'greet-plan', text: 'Thanks for contacting Kestrel Fiber. I can look at plan options. Please confirm the name on the account and your billing ZIP code.' },
    { script_id: 'greet-general', text: 'Thanks for contacting Kestrel Fiber. How can I help today?' });
  const cat = (catalog_id, topic_id, kind, title, terms, amount, perform_days = 10) => ({ catalog_id, topic_id, tier: 'frontline', stage: 'initial', kind, title, terms,
    value: amount === null ? null : { amount_minor: amount, currency: 'USD' }, conditions: [], group: `${topic_id}-relief`, expires_hours: 72, perform_days });
  p.offer_catalog.push(
    cat('cat-dup-f1', 'billing_review', 'refund', 'Duplicate charge refund', 'A refund of the duplicate router rental line, 8.00 per affected bill.', 800),
    cat('cat-out-f1', 'outage_credit', 'statement_credit', 'Outage credit', 'A 15.00 credit on your next bill for the outage.', 1500),
    cat('cat-plan-f1', 'plan_change', 'product_change', 'Switch to Fiber 300', 'Move to the Fiber 300 plan at 45.00 a month from your next bill.', null, 14));
  d.help_articles.push(
    { article_id: 'kb-outages', title: 'Outage credits', body: 'If service is down for more than 4 hours, ask for an outage credit in chat.', tags: ['outage', 'credit'], updated_at: '2025-07-07T10:00:00-04:00', revisions: null },
    { article_id: 'kb-moving', title: 'Moving your service', body: 'Tell us your new address two weeks before you move.', tags: ['moving'], updated_at: '2026-03-02T10:00:00-05:00', revisions: null });
  d.cases = []; d.offers = []; d.commitments = []; d.confirmations = []; d.outbox = [];
  return withRevisions(d);
}

// Help-article revisions across the window: [date, note, new body]. The first revision is the article's
// publication; an article's title, body and updated_at are those of its latest revision.
const REVISIONS = {
  'kb-annual-fee': [['2025-09-22T10:00:00-04:00', 'Added how to reach Account Review in chat.', 'The annual fee posts on your card anniversary. If you have questions about the fee or the value of your card, our Account Review team handles fee reviews. In chat, ask to be transferred to Account Review; you can also call the number on the back of your card.']],
  'kb-identity': [['2025-11-03T09:00:00-05:00', 'Clarified that we never ask for a full card number.', 'We verify you with the last four digits of your card and your billing ZIP code. We never need your full card number or Social Security number in chat, and a representative will never ask for them.']],
  'kb-credits': [['2026-04-06T09:00:00-04:00', 'Changed the usual posting time from 7 to 5 business days.', 'A statement credit you accept in chat usually posts within 5 business days. Check your card account to confirm it posted; a message saying it was processed is not the same as a posted credit.']],
  'kb-late-fees': [['2026-05-18T10:00:00-04:00', 'Late fee amount updated for 2026.', 'A late fee of up to 40.00 posts if the minimum payment arrives after the due date. Customer Care can review a first late fee.']],
  'kb-refunds': [['2025-10-13T09:00:00-04:00', 'Refunds now go to the original payment method by default.', 'Refunds we promise in chat are sent to your original payment method within 10 days. Your bank statement is the record that the money arrived.']],
  'kb-outages': [['2026-06-15T10:00:00-04:00', 'Outage threshold lowered from 4 to 3 hours.', 'If service is down for more than 3 hours, ask for an outage credit in chat.']]
};
function withRevisions(d) {
  for (const a of d.help_articles) {
    const first = a.revisions?.[0] || { at: a.updated_at, note: 'Published.', body: a.body };
    a.revisions = [first, ...(REVISIONS[a.article_id] || []).map(([at, note, body]) => ({ at, note, body }))];
    const last = a.revisions.at(-1);
    a.updated_at = last.at; a.body = last.body;
  }
  return d;
}

// ---------- the engine: an agenda run in time order through the App ----------
function engine(base) {
  let data = structuredClone(base);
  const actions = [], agenda = [];
  let seq = 0, now = '2025-01-01T00:00:00-05:00';
  const ctx = () => ({ app_id: 'counterline', role: 'agent', virtual_now: now, binding: structuredClone(binding) });
  const api = {
    get data() { return data; },
    at: (when, fn) => agenda.push({ when, seq: seq++, fn }),
    call(name, args) {
      const out = plugin.handleTool(ctx(), structuredClone(data), 'counterline.' + name, structuredClone(args));
      plugin.validateSeed(ctx(), out.data);
      data = out.data;
      actions.push({ at: now, type: 'tool', name: 'counterline.' + name, args });
      return out.result;
    },
    event(operation, payload) {
      const event = { event_id: `ev-ds-${String(actions.length + 1).padStart(4, '0')}`, at: now, operation: 'counterline.' + operation, payload };
      data = plugin.applyEvent({ ...ctx(), role: 'infra' }, structuredClone(data), event);
      plugin.validateSeed(ctx(), data);
      actions.push({ at: now, type: 'event', event });
    },
    run() {
      while (agenda.length) {
        agenda.sort((a, b) => Date.parse(a.when) - Date.parse(b.when) || a.seq - b.seq);
        const step = agenda.shift();
        if (Date.parse(step.when) > Date.parse(END)) continue;   // after the window: has not happened yet
        if (Date.parse(step.when) < Date.parse(now)) throw Error('Agenda went backwards at ' + step.when);
        now = step.when;
        step.fn();
      }
      return { data, actions };
    }
  };
  return api;
}

// ---------- scenario building blocks ----------
function blocks(e, rand, account_ref, identity) {
  const pick = list => list[Math.floor(rand() * list.length)];
  let refs = 0;
  const ref = prefix => `${prefix}-${String(++refs).padStart(3, '0')}`;
  const open = (topic_id, message) => e.call('cases.open', { topic_id, account_ref, message }).case_id;
  const verify = case_id => e.call('identity.provide', { case_id, fields: identity });
  const say = (case_id, text) => e.call('cases.send_message', { case_id, text });
  const offerIn = (case_id, title) => e.data.offers.filter(o => o.case_id === case_id && o.state === 'presented' && (!title || o.title === title)).at(-1);
  const accept = (case_id, title) => {
    const o = offerIn(case_id, title);
    const t = e.call('offers.accept', { offer_id: o.offer_id }).confirmation_token;
    return e.call('offers.accept', { offer_id: o.offer_id, confirmation_token: t }).commitment_id;
  };
  const end = case_id => { if (!['resolved', 'closed'].includes(e.data.cases.find(c => c.case_id === case_id).status)) e.call('cases.take_action', { case_id, action: 'end_chat' }); };
  const close = case_id => e.call('cases.close', { case_id });
  const report = (commitment_id, amount, prefix = 'POST') => {
    const m = e.data.commitments.find(x => x.commitment_id === commitment_id);
    e.event('commitment.performance_reported', { commitment_id, provider_id: m.provider_id, reference_id: ref(prefix), amount_minor: amount ?? (m.value ? m.value.amount_minor : 0), currency: m.value ? m.value.currency : 'USD', status: 'reported' });
  };
  // A commitment's later life, chosen by outcome: reported in full, in two parts, contested, revoked, or never.
  function afterwards(when, case_id, commitment_id, outcome, prefix) {
    const m = () => e.data.commitments.find(x => x.commitment_id === commitment_id);
    if (outcome === 'reported') e.at(plusDays(when, 3 + Math.floor(rand() * 4)), () => report(commitment_id, null, prefix));
    if (outcome === 'partial') {
      e.at(plusDays(when, 3), () => report(commitment_id, Math.round(m().value.amount_minor / 2), prefix));
      e.at(plusDays(when, 9), () => report(commitment_id, m().value.amount_minor - Math.round(m().value.amount_minor / 2), prefix));
    }
    if (outcome === 'contested_reissued' || outcome === 'contested_upheld') {
      e.at(plusDays(when, 4), () => report(commitment_id, null, prefix));
      e.at(plusDays(when, 11), () => e.call('commitments.contest', { commitment_id, reason: pick(['The credit does not show on my account.', 'I cannot find this credit on my statement.', 'My statement still shows the full charge.']) }));
      e.at(plusDays(when, 14), () => e.event('contest.answered', { commitment_id, outcome: outcome === 'contested_reissued' ? 'reissued' : 'upheld', reference_id: outcome === 'contested_reissued' ? ref(prefix) : null }));
      if (outcome === 'contested_reissued') e.at(plusDays(when, 18), () => report(commitment_id, null, prefix));
    }
    if (outcome === 'revoked') e.at(plusDays(when, 2), () => e.event('commitment.revoked', { commitment_id, reason: 'the charge was already reversed by another adjustment' }));
    if (outcome === 'processed_said') e.at(plusDays(when, 5), () => e.event('case.followup', { case_id, script_id: e.data.provider.scripts.some(s => s.script_id === 'followup-report-posted') ? 'followup-report-posted' : 'followup-refund-processed' }));
    e.at(plusDays(when, 20), () => { const c = e.data.cases.find(x => x.case_id === case_id); if (c.status !== 'closed') close(case_id); });
  }
  return { pick, open, verify, say, accept, end, close, report, afterwards, offerIn };
}

const CARD_INFO = {
  statement_question: ['Why is my statement balance different from my current balance?', 'When does my statement close each month?', 'Can you explain a pending charge on my statement?'],
  travel_notice: ['I am traveling to Portugal next month. Do I need to tell you?', 'Will my card work in Canada?', 'I will be abroad for two weeks. Anything I should know?'],
  payment_question: ['Did my payment from last week post?', 'Can I change my autopay date?', 'I paid twice by mistake. What happens now?']
};
const CARD_FEE = {
  late_fee: ['I was charged a late fee but I paid on the due date.', 'There is a late fee on my statement. Can you take another look?'],
  interest_charge: ['I paid my balance in full but I see an interest charge.', 'Why was I charged interest this month?'],
  foreign_fee: ['I was charged a foreign transaction fee for an online order in dollars.', 'There is a foreign fee on a purchase I made at home.'],
  card_replacement: ['My card was damaged and I paid for expedited delivery, but it arrived late.', 'I need a new card; the chip stopped working.']
};
const OFFER_FOR = { late_fee: 'Late fee waiver', interest_charge: 'Interest refund', foreign_fee: 'Foreign fee refund', card_replacement: 'Expedited delivery fee refund' };

function cardFamily() {
  const e = engine(cardBase()), rand = rng(219001);
  const b = blocks(e, rand, 'brindle:acct-jordan-1234', { last_four: '1234', billing_zip: '02139' });
  // Fee and refund cases: 18 commitments across every outcome, spread over the two years.
  const plan = [
    ['2025-01-20', 'late_fee', 'reported'], ['2025-02-11', 'foreign_fee', 'reported'], ['2025-03-25', 'interest_charge', 'partial'],
    ['2025-04-16', 'card_replacement', 'processed_said'], ['2025-05-28', 'late_fee', 'contested_reissued'], ['2025-07-09', 'foreign_fee', 'revoked'],
    ['2025-08-19', 'interest_charge', 'reported'], ['2025-09-30', 'card_replacement', 'reported'], ['2025-12-09', 'late_fee', 'contested_upheld'],
    ['2026-01-27', 'foreign_fee', 'reported'], ['2026-03-10', 'interest_charge', 'reported'], ['2026-04-21', 'card_replacement', 'partial'],
    ['2026-06-02', 'late_fee', 'reported'], ['2026-07-14', 'foreign_fee', 'contested_reissued'], ['2026-08-25', 'interest_charge', 'revoked'],
    ['2026-10-06', 'late_fee', 'reported'], ['2026-12-15', 'foreign_fee', 'pending'], ['2026-12-22', 'card_replacement', 'pending'],
    ['2026-12-18', 'late_fee', 'contested_reissued'], ['2026-12-26', 'interest_charge', 'partial']];   // open at the window's end
  for (const [day, topic, outcome] of plan) {
    const [y, m, d] = day.split('-').map(Number), when = local(y, m, d, 9 + Math.floor(rand() * 8), Math.floor(rand() * 4) * 15);
    e.at(when, () => {
      const c = b.open(topic, b.pick(CARD_FEE[topic]));
      b.verify(c);
      if (rand() < 0.4) b.say(c, b.pick(['Can you explain the terms?', 'What are the conditions?', 'Thanks. Can you explain the terms?']));
      const m_ = b.accept(c, OFFER_FOR[topic]);
      b.end(c);
      b.afterwards(when, c, m_, outcome, 'POST');
    });
  }
  // The annual fee each November: 2025 takes the conditional spend credit and misses it; 2026 asks for Account Review.
  e.at(local(2025, 11, 4, 18, 30), () => {
    const c = b.open('annual_fee', 'My annual fee just posted. Is there anything you can do?');
    b.verify(c);
    b.say(c, 'Thanks. Is there anything better?');
    const m_ = b.accept(c, 'Spend bonus credit');
    b.end(c);
    e.at(local(2026, 2, 3, 9, 0), () => e.event('commitment.condition_missed', { commitment_id: m_, reason: 'purchases reached 1,840.00 of 3,000.00 within 90 days' }));
  });
  e.at(local(2026, 11, 3, 19, 0), () => {
    const c = b.open('annual_fee', 'The annual fee posted again. I would like to discuss it.');
    b.verify(c);
    b.say(c, 'Can you explain the terms, and is there anything better?');
    b.say(c, 'Please transfer me to Account Review.');
    const m_ = b.accept(c, 'Annual fee waiver');
    b.end(c);
    b.afterwards(local(2026, 11, 3, 19, 0), c, m_, 'reported', 'POST');
  });
  // Ordinary questions, about two a month, and status checks on open commitments.
  for (let y = 2025; y <= 2026; y++) for (let mo = 1; mo <= 12; mo++) {
    const n = 1 + (rand() < 0.5 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const topic = b.pick(Object.keys(CARD_INFO)), when = local(y, mo, 3 + Math.floor(rand() * 24), 8 + Math.floor(rand() * 12), Math.floor(rand() * 4) * 15);
      e.at(when, () => {
        const c = b.open(topic, b.pick(CARD_INFO[topic]));
        if (rand() < 0.3) b.say(c, b.pick(['Thanks, that is all.', 'Goodbye.', 'ok sure whatever works']));
        if (rand() < 0.25) b.say(c, 'Also, can you check on the status of any credit you promised me?');
        b.end(c);
        if (rand() < 0.5) e.at(plusDays(when, 2), () => b.close(c));
      });
    }
  }
  return e.run();
}

const ISP_INFO = {
  equipment: ['My router keeps restarting.', 'The Wi-Fi light on my router is red.', 'Can I use my own router?'],
  moving: ['I am moving next month. Can I keep my plan?', 'How do I move my service to a new apartment?']
};
function ispFamily() {
  const e = engine(ispBase()), rand = rng(219002);
  const b = blocks(e, rand, 'kestrel:acct-55120', { full_name: 'Jordan Avery', billing_zip: '02139' });
  const plan = [
    ['2025-01-14', 'billing_review', 'reported'], ['2025-02-25', 'outage_credit', 'reported'], ['2025-04-08', 'billing_review', 'processed_said'],
    ['2025-05-20', 'outage_credit', 'partial'], ['2025-06-24', 'plan_change', 'reported'], ['2025-08-05', 'outage_credit', 'contested_reissued'],
    ['2025-09-16', 'billing_review', 'revoked'], ['2025-10-28', 'outage_credit', 'reported'], ['2025-12-02', 'billing_review', 'contested_upheld'],
    ['2026-01-20', 'outage_credit', 'reported'], ['2026-03-03', 'billing_review', 'reported'], ['2026-04-14', 'plan_change', 'reported'],
    ['2026-05-26', 'outage_credit', 'reported'], ['2026-07-07', 'billing_review', 'partial'], ['2026-08-18', 'outage_credit', 'revoked'],
    ['2026-09-29', 'billing_review', 'reported'], ['2026-11-10', 'outage_credit', 'contested_reissued'], ['2026-12-17', 'billing_review', 'pending'],
    ['2026-12-18', 'outage_credit', 'contested_upheld'], ['2026-12-27', 'billing_review', 'partial']];   // open at the window's end
  const ask = { billing_review: ['My bill charged me twice for the router.', 'There is a router rental line twice on my bill again.'],
    outage_credit: ['My internet was down for most of yesterday.', 'Service was out for six hours on Saturday.'], plan_change: ['Do you have a cheaper plan?', 'I would like a slower, cheaper plan.'] };
  const title = { billing_review: 'Duplicate charge refund', outage_credit: 'Outage credit', plan_change: 'Switch to Fiber 300' };
  for (const [day, topic, outcome] of plan) {
    const [y, m, d] = day.split('-').map(Number), when = local(y, m, d, 9 + Math.floor(rand() * 9), Math.floor(rand() * 4) * 15);
    e.at(when, () => {
      const c = b.open(topic, b.pick(ask[topic]));
      if (rand() < 0.35) b.say(c, 'Can I talk to a supervisor in Billing Review?');
      b.verify(c);
      const m_ = b.accept(c, title[topic]);
      b.end(c);
      b.afterwards(when, c, m_, topic === 'plan_change' && outcome !== 'reported' ? 'reported' : outcome, 'RF');
    });
  }
  for (let y = 2025; y <= 2026; y++) for (let mo = 1; mo <= 12; mo++) {
    const n = 1 + (rand() < 0.4 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const topic = rand() < 0.3 ? 'refund_status' : b.pick(Object.keys(ISP_INFO)), when = local(y, mo, 2 + Math.floor(rand() * 25), 8 + Math.floor(rand() * 13), Math.floor(rand() * 4) * 15);
      e.at(when, () => {
        const c = b.open(topic, topic === 'refund_status' ? 'Can you check on the refund you promised me?' : b.pick(ISP_INFO[topic]));
        if (topic === 'refund_status') b.say(c, 'Any update? I am still waiting.');
        if (rand() < 0.2) b.say(c, 'Please transfer me to Billing Review.');
        b.end(c);
        if (rand() < 0.5) e.at(plusDays(when, 3), () => b.close(c));
      });
    }
  }
  return e.run();
}

// ---------- write ----------
const FAMILIES = { 'card-issuer': [cardFamily, cardBase], 'internet-provider': [ispFamily, ispBase] };
function build() {
  const files = new Map();
  for (const [name, [family, base]] of Object.entries(FAMILIES)) {
    const { data, actions } = family();
    if (actions.some(a => Date.parse(a.at) > Date.parse(END))) throw Error(`${name}: an action falls after ${END}`);
    const json = v => JSON.stringify(v, null, 1) + '\n';
    files.set(`${name}/base.json`, json(base()));
    files.set(`${name}/actions.json`, json({ family: name, time_zone: ZONE, window: ['2025-01-01', '2026-12-31'], generator: 'scripts/generate-dataset.cjs', actions }));
    files.set(`${name}/seed.json`, json(data));
    files.set(`${name}/binding.json`, json(binding));
  }
  return files;
}
if (require.main === module) {
  const check = process.argv.includes('--check'), drift = [];
  for (const [file, content] of build()) {
    const p = path.join(OUT, file);
    if (check) { if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== content) drift.push(file); }
    else { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); }
  }
  if (drift.length) { console.error('Dataset drift: ' + drift.join(', ')); process.exit(1); }
  console.log(check ? 'Dataset is up to date.' : 'Wrote datasets/: ' + [...build().keys()].join(', '));
}
module.exports = { build, engine, local, END, ZONE };
