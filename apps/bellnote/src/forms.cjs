'use strict';
// W2: forms and permission slips, one answer per form and child, versions and fees.
const c = require('./common.cjs');
const {notify, money} = require('./notify.cjs');
const MATERIAL = Object.freeze(['title', 'text', 'questions', 'fee_cents', 'event_date']);
const ACTIVE = Object.freeze(['signed', 'declined', 'needs_review']);

// Whether the form still accepts answers: decided by the clock alone.
const phase = (ctx, f) => c.passed(ctx, f.due_at) ? 'closed' : 'open';
const responseOf = (data, formId, childId) => data.form_responses.find(r => r.form_id === formId && r.child_id === childId) || null;
function responseView(ctx, data, f, r) {
  const closed = phase(ctx, f) === 'closed';
  const effective = r.state === 'needs_review' && closed ? 'not_signed' : r.state;
  return {...c.copy(r), mine: r.by_person_id === data.owner_person_id, by_display_name: c.displayName(data, r.by_person_id),
    effective_state: effective, counts_as_signed: r.state === 'signed' && r.form_version === f.version};
}
// Listing phase (plan W2: open, answered, closed), for the children in scope (one child when
// forms.list is filtered by child_id, otherwise every addressed child): `closed` once the due time
// has passed; else `answered` when every child in scope has a signed or declined answer at the
// current version (a needs_review answer does not count); else `open`.
function listPhase(ctx, data, f, childIds = f.child_ids) {
  if (phase(ctx, f) === 'closed') return 'closed';
  return childIds.every(id => { const r = responseOf(data, f.id, id); return r && ['signed', 'declined'].includes(r.state); }) ? 'answered' : 'open';
}
function summary(ctx, data, f, scope) {
  return {id: f.id, school_id: f.school_id, kind: f.kind, title: f.title, child_ids: c.copy(f.child_ids), fee_cents: f.fee_cents,
    event_date: f.event_date, due_at: f.due_at, version: f.version, phase: listPhase(ctx, data, f, scope), accepting_answers: phase(ctx, f) === 'open',
    responses: f.child_ids.map(id => { const r = responseOf(data, f.id, id); return r ? responseView(ctx, data, f, r) : {child_id: id, state: 'unanswered'}; })};
}
function list(ctx, data, args) {
  if (args.child_id) c.child(data, args.child_id);
  const forms = data.forms.filter(f => !args.child_id || f.child_ids.includes(args.child_id))
    .map(f => summary(ctx, data, f, args.child_id ? [args.child_id] : f.child_ids)).filter(f => !args.phase || f.phase === args.phase);
  return {forms};
}
function get(ctx, data, args) {
  const f = c.find(data.forms, args.id, 'Form');
  return {form: {...summary(ctx, data, f), text: f.text, questions: c.copy(f.questions), versions: c.copy(f.versions),
    published_at: f.published_at, history: c.copy(f.history),
    my_rights: f.child_ids.map(id => { const l = c.myLink(data, id); return {child_id: id, can_sign: !!l?.can_sign, can_pay: !!l?.can_pay}; })}};
}

// Answers must cover every required question with a value of the declared type.
function checkAnswers(f, answers, required, code) {
  const known = new Map(f.questions.map(q => [q.id, q]));
  for (const [id, v] of Object.entries(answers || {})) {
    const q = known.get(id);
    if (!q) c.fail(code, 'The form has no question ' + id + '.');
    const ok = q.type === 'text' ? typeof v === 'string' && v.trim().length > 0 && v.length <= 2000
      : q.type === 'choice' ? typeof v === 'string' && q.options.includes(v)
        : q.type === 'boolean' ? typeof v === 'boolean'
          : q.type === 'number' ? typeof v === 'number' && Number.isFinite(v) : false;
    if (!ok) c.fail(code, 'Answer to ' + id + ' does not match its type (' + q.type + ').');
  }
  if (required) for (const q of f.questions) if (q.required && !Object.hasOwn(answers || {}, q.id)) c.fail(code, 'Question ' + q.id + ' is required.');
}
function refundAll(ctx, data, r, reason) {
  for (const id of r.payment_ids) {
    const p = data.payments.find(x => x.id === id);
    if (p && p.status === 'paid') { p.status = 'refunded'; p.refunded_at = ctx.virtual_now; p.refund_reason = reason; }
  }
  r.paid_cents = 0;
}

function respond(ctx, data, args) {
  const f = c.find(data.forms, args.id, 'Form');
  c.child(data, args.child_id);
  if (!f.child_ids.includes(args.child_id)) c.fail('not_found', 'Form ' + f.id + ' is not addressed to ' + args.child_id + '.');
  c.requireRight(data, args.child_id, 'can_sign');
  if (phase(ctx, f) === 'closed') c.fail('closed', 'The form closed at ' + f.due_at + '.');
  let r = responseOf(data, f.id, args.child_id);
  const me = data.owner_person_id;
  if (r && ACTIVE.includes(r.state) && (r.by_person_id !== me || r.state !== 'needs_review')) {
    c.fail('already_answered', 'This child already has an answer (' + r.state + ') from ' + c.displayName(data, r.by_person_id) + '.');
  }
  if (args.form_version !== f.version) c.fail('stale_form', 'The form is at version ' + f.version + '; read it again before answering.');
  checkAnswers(f, args.answers, args.action === 'sign', 'missing_answer');
  const alreadyPaid = r && r.by_person_id === me ? r.paid_cents : 0;
  let charged = 0, payment = null;
  if (args.action === 'sign' && f.fee_cents > alreadyPaid) {
    c.requireRight(data, args.child_id, 'can_pay');
    const m = c.chargeableMethod(ctx, data, args.payment_method_id);
    charged = f.fee_cents - alreadyPaid;
    payment = {id: c.nextId(data.payments, 'pay'), kind: 'form_fee', child_id: args.child_id, amount_cents: charged,
      payment_method_id: m.id, object_type: 'form_response', object_id: null, status: 'paid', paid_at: ctx.virtual_now,
      refunded_at: null, refund_reason: null, request_id: args.request_id};
  }
  if (!r) {
    r = {id: c.nextId(data.form_responses, 'fr'), form_id: f.id, child_id: args.child_id, by_person_id: me, state: null,
      form_version: f.version, answers: {}, paid_cents: 0, payment_ids: [], answered_at: ctx.virtual_now, history: []};
    data.form_responses.push(r);
  }
  if (args.action === 'decline' && r.paid_cents > 0) refundAll(ctx, data, r, 'declined');
  if (payment) { payment.object_id = r.id; data.payments.push(payment); r.payment_ids.push(payment.id); r.paid_cents += charged; }
  const action = r.state === 'needs_review' ? (args.action === 'sign' ? 're_signed' : 'declined_after_change') : args.action === 'sign' ? 'signed' : 'declined';
  r.state = args.action === 'sign' ? 'signed' : 'declined';
  r.by_person_id = me; r.form_version = f.version; r.answers = c.copy(args.answers || {}); r.answered_at = ctx.virtual_now;
  r.history.push({at: ctx.virtual_now, action, by: me, form_version: f.version, request_id: args.request_id, charged_cents: charged});
  c.activity(ctx, data, {actor: 'agent', action: 'forms.respond', child_id: args.child_id, object_id: r.id, request_id: args.request_id});
  return {id: r.id, form_id: f.id, child_id: args.child_id, state: r.state, form_version: f.version, charged_cents: charged,
    payment_id: payment ? payment.id : null, paid_cents: r.paid_cents};
}

function withdraw(ctx, data, args) {
  const r = c.find(data.form_responses, args.id, 'Form response'), f = c.find(data.forms, r.form_id, 'Form');
  c.requireRight(data, r.child_id, 'can_sign');
  if (r.by_person_id !== data.owner_person_id) c.fail('not_yours', 'Only the guardian who answered can withdraw this answer.');
  if (!ACTIVE.includes(r.state)) c.fail('invalid_state', 'The answer is already ' + r.state + '.');
  if (phase(ctx, f) === 'closed') c.fail('closed', 'The form closed at ' + f.due_at + '.');
  const refunded = r.paid_cents;
  refundAll(ctx, data, r, 'withdrawn');
  r.state = 'withdrawn';
  r.history.push({at: ctx.virtual_now, action: 'withdrawn', by: data.owner_person_id, request_id: args.request_id, refunded_cents: refunded});
  c.activity(ctx, data, {actor: 'agent', action: 'forms.withdraw', child_id: r.child_id, object_id: r.id, request_id: args.request_id});
  return {id: r.id, state: r.state, refunded_cents: refunded};
}

// ---- events ----------------------------------------------------------------------------------
function validateQuestions(questions) {
  const ids = new Set();
  for (const q of questions) {
    if (ids.has(q.id)) c.fail('invalid_event', 'Duplicate question id ' + q.id + '.');
    ids.add(q.id);
    if ((q.type === 'choice') !== Array.isArray(q.options) || (q.options && (q.options.length < 2 || new Set(q.options).size !== q.options.length))) {
      c.fail('invalid_event', 'A choice question needs two or more distinct options; other types have none.');
    }
  }
}
function published(ctx, data, event, row) {
  const p = event.payload;
  if (c.idTaken(data, p.form_id)) c.fail('invalid_event', 'Object ID ' + p.form_id + ' already exists.');
  const s = data.schools.find(x => x.id === p.school_id);
  if (!s) c.fail('invalid_event', 'Unknown school.');
  for (const id of p.child_ids) {
    const k = data.children.find(x => x.id === id);
    if (!k || k.school_id !== s.id) c.fail('invalid_event', 'Child ' + id + ' is not in this account at that school.');
  }
  if (!(Date.parse(p.due_at) > Date.parse(ctx.virtual_now))) c.fail('invalid_event', 'A form must be due after it is published.');
  validateQuestions(p.questions);
  const content = {title: p.title, text: p.text, questions: c.copy(p.questions), fee_cents: p.fee_cents, event_date: p.event_date ?? null};
  const f = {id: p.form_id, school_id: s.id, child_ids: c.copy(p.child_ids), kind: p.kind, ...content, due_at: p.due_at, version: 1,
    versions: [{version: 1, at: ctx.virtual_now, ...c.copy(content), reason: null, event_id: event.event_id}],
    published_at: ctx.virtual_now, history: [{at: ctx.virtual_now, action: 'published', version: 1, changed_fields: [], event_id: event.event_id}]};
  data.forms.push(f);
  row.object_id = f.id; row.child_id = p.child_ids.length === 1 ? p.child_ids[0] : null;
  const names = p.child_ids.map(id => c.child(data, id).display_name).join(' and ');
  notify(ctx, data, {kind: 'form.published', child_id: row.child_id, object_type: 'form', object_id: f.id, event_id: event.event_id, cause_seq: row.seq,
    title: s.name + ': ' + p.title,
    body: s.name + ' sent a form for ' + names + ': "' + p.title + '". ' + (p.fee_cents ? 'Fee: ' + money(p.fee_cents) + '. ' : 'No fee. ') +
      'Answers are due by ' + c.time.localDate(p.due_at, c.tz(data)) + ' ' + c.time.localTime(p.due_at, c.tz(data)) + '.'});
}
function changed(ctx, data, event, row) {
  const p = event.payload, f = data.forms.find(x => x.id === p.form_id);
  if (!f) c.fail('invalid_event', 'Unknown form.');
  if (phase(ctx, f) === 'closed') c.fail('invalid_event', 'A closed form cannot change.');
  const ch = p.change, fields = Object.keys(ch).filter(k => JSON.stringify(ch[k]) !== JSON.stringify(k === 'due_at' ? f.due_at : f[k]));
  if (!fields.length) c.fail('invalid_event', 'The change does not change the form.');
  if (ch.questions) validateQuestions(ch.questions);
  if (ch.due_at && !(Date.parse(ch.due_at) > Date.parse(ctx.virtual_now))) c.fail('invalid_event', 'A new due time must be in the future.');
  const material = fields.filter(k => MATERIAL.includes(k));
  for (const k of fields) f[k] = c.copy(ch[k]);
  row.object_id = f.id;
  const affectedMine = [];
  if (material.length) {
    f.version += 1;
    f.versions.push({version: f.version, at: ctx.virtual_now, title: f.title, text: f.text, questions: c.copy(f.questions),
      fee_cents: f.fee_cents, event_date: f.event_date, reason: p.reason, event_id: event.event_id});
    for (const r of data.form_responses.filter(x => x.form_id === f.id && x.state === 'signed')) {
      r.state = 'needs_review';
      r.history.push({at: ctx.virtual_now, action: 'needs_review', form_version: f.version, event_id: event.event_id});
      if (r.by_person_id === data.owner_person_id) affectedMine.push(r);
      c.activity(ctx, data, {actor: 'event', action: 'effect.form_response.needs_review', child_id: r.child_id, object_id: r.id, event_id: event.event_id, cause_seq: row.seq});
    }
  }
  f.history.push({at: ctx.virtual_now, action: material.length ? 'changed' : 'due_time_changed', version: f.version, changed_fields: fields,
    reason: p.reason, event_id: event.event_id});
  const s = c.school(data, f.school_id);
  const mine = affectedMine.length
    ? 'Your signature for ' + affectedMine.map(r => c.child(data, r.child_id).display_name).join(' and ') + ' no longer counts: review version ' + f.version + ' and sign again or withdraw.'
    : 'None of your answers is affected.';
  notify(ctx, data, {kind: 'form.changed', child_id: f.child_ids.length === 1 ? f.child_ids[0] : null, object_type: 'form', object_id: f.id,
    event_id: event.event_id, cause_seq: row.seq, title: s.name + ': "' + f.title + '" was changed',
    body: 'The school changed ' + fields.join(', ') + ' on "' + f.title + '"' + (p.reason ? ' (' + p.reason + ')' : '') + '. ' + mine});
}
function answered(ctx, data, event, row) {
  const p = event.payload, f = data.forms.find(x => x.id === p.form_id);
  if (!f || !f.child_ids.includes(p.child_id)) c.fail('invalid_event', 'Unknown form or child.');
  const link = c.guardianLink(data, p.child_id, p.by_guardian_id);
  if (p.by_guardian_id === data.owner_person_id || !link || !link.can_sign) c.fail('invalid_event', 'The answering guardian has no signing right for this child.');
  if (phase(ctx, f) === 'closed') c.fail('invalid_event', 'The form is closed.');
  let r = responseOf(data, f.id, p.child_id);
  row.object_id = f.id; row.child_id = p.child_id;
  if (p.action === 'withdraw') {
    if (!r || r.by_person_id !== p.by_guardian_id || !ACTIVE.includes(r.state)) c.fail('invalid_event', 'There is no answer of theirs to withdraw.');
    r.state = 'withdrawn'; r.paid_cents = 0;
    r.history.push({at: ctx.virtual_now, action: 'withdrawn', by: p.by_guardian_id, event_id: event.event_id});
  } else {
    if (r && ACTIVE.includes(r.state) && !(r.by_person_id === p.by_guardian_id && r.state === 'needs_review')) c.fail('invalid_event', 'This child already has an answer.');
    if (p.form_version !== f.version) c.fail('invalid_event', 'The answer names a version that is not current.');
    checkAnswers(f, p.answers, p.action === 'sign', 'invalid_event');
    if (p.action === 'sign' && f.fee_cents > 0 && !link.can_pay) c.fail('invalid_event', 'The answering guardian cannot pay the fee for this child.');
    if (!r) {
      r = {id: c.nextId(data.form_responses, 'fr'), form_id: f.id, child_id: p.child_id, by_person_id: p.by_guardian_id, state: null,
        form_version: f.version, answers: {}, paid_cents: 0, payment_ids: [], answered_at: ctx.virtual_now, history: []};
      data.form_responses.push(r);
    }
    const prior = r.state;
    r.by_person_id = p.by_guardian_id; r.state = p.action === 'sign' ? 'signed' : 'declined'; r.form_version = f.version;
    r.answers = c.copy(p.answers || {}); r.answered_at = ctx.virtual_now;
    // The other guardian's fee goes to their own payment method; this account records only the amount.
    r.paid_cents = p.action === 'sign' ? f.fee_cents : 0;
    r.history.push({at: ctx.virtual_now, action: prior === 'needs_review' ? 're_' + r.state : r.state, by: p.by_guardian_id, form_version: f.version, event_id: event.event_id});
  }
  row.object_id = r.id;
  const who = c.displayName(data, p.by_guardian_id), kid = c.child(data, p.child_id).display_name;
  const verb = {sign: 'signed', decline: 'declined', withdraw: 'withdrew their answer to'}[p.action];
  notify(ctx, data, {kind: 'form.answered', child_id: p.child_id, object_type: 'form_response', object_id: r.id, event_id: event.event_id, cause_seq: row.seq,
    title: who + ' ' + verb + ' "' + f.title + '" for ' + kid,
    body: who + ' ' + verb + ' "' + f.title + '" for ' + kid + ' (version ' + f.version + ').' +
      (p.action === 'withdraw' ? ' The form can be answered again until it closes.' : ' Their answer holds the form for ' + kid + '; it cannot be changed from this account.')});
}
module.exports = {list, get, respond, withdraw, published, changed, answered, phase, responseOf, MATERIAL, ACTIVE};
