'use strict';
const c = require('./common.cjs');
const views = require('./views.cjs');
const {ms, cents, tenths, sum, time, amountText, hoursText} = c;
// The text of a notification and, when the account wants email, the full wire message for Mail's receive contract.
// The object type and the subscription topic of each kind of notification.
const ABOUT = {
  'payroll.run_posted': ['pay_statement', 'pay'], 'calendar.changed': ['pay_date', 'pay-calendar'], 'deposit.updated': ['deposit', 'pay'],
  'inquiry.answered': ['inquiry', 'inquiries'], 'leave.decided': ['leave_request', 'leave'], 'leave.adjusted': ['leave_balance', 'leave'],
  'enrollment.opened': ['enrollment_window', 'benefits']
};
const list = items => items.length < 2 ? items.join('') : items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
const count = (n, one, many = one + 's') => n + ' ' + (n === 1 ? one : many);
const account = a => a.label + ' ending in ' + a.last4;
// A reason as given, as the end of the sentence "Reason given: ...".
function reasonText(reason) {
  if (!reason) return '';
  const text = /^[A-Z][a-z]/.test(reason) ? reason[0].toLowerCase() + reason.slice(1) : reason;
  return ' Reason given: ' + text + (/[.!?]$/.test(text) ? '' : '.');
}
const noteText = note => note ? ' Note: ' + note + (/[.!?]$/.test(note) ? '' : '.') : '';

const writers = {
  'payroll.run_posted'({statement, say}) {
    const total = lines => sum(lines.map(l => cents(l.amount))), net = cents(statement.net_pay), flags = views.statementFlags(statement);
    const deposits = statement.deposits.map(d => amountText(cents(d.amount)) + ' to ' + account(d.account));
    return {title: 'Your pay for ' + time.shortDay(statement.pay_date) + ' is posted: ' + amountText(net) + ' net pay',
      text: 'Payroll posted pay statement ' + statement.id + ' for the period ' + time.rangeText(statement.period_start, statement.period_end) + '. Pay date: ' +
        say.day(statement.pay_date) + '. Earnings ' + amountText(total(statement.earnings)) + ', taxes ' + amountText(total(statement.taxes)) + ', deductions ' +
        amountText(total(statement.deductions)) + ', net pay ' + amountText(net) + '.' + (deposits.length ? ' Deposits: ' + list(deposits) + '.' : ' No deposit was made.') +
        (flags.includes('deductions_cut') ? ' Some deductions were not taken in full, because the pay left after taxes was too low.' : '') +
        (flags.includes('short_deposit') ? ' The fixed deposit amounts were not paid in full, because the net pay was too low.' : '') +
        ' Open Payleaf to see the statement.'};
  },
  'calendar.changed'({data, entry, before, payload, say, now}) {
    const period = time.rangeText(entry.period_start, entry.period_end), cutoff = ms(entry.cutoff_at);
    const still = now < cutoff ? ' Changes to your pay settings for this pay date are still accepted until ' + say.moment(cutoff) + '.'
      : ' The cut-off for changes to your pay settings for this pay date passed on ' + say.moment(cutoff) + '.';
    const end = reasonText(payload.reason) + still + ' Open Payleaf to see your pay calendar.';
    if (!before) return {title: 'A new pay date was added: ' + time.shortDay(entry.pay_date),
      text: 'Payroll added the pay date ' + say.day(entry.pay_date) + ' for the period ' + period + '.' + end};
    const movedCutoff = ms(before.cutoff_at) !== cutoff;
    if (before.pay_date === entry.pay_date) return {title: 'The cut-off for your pay date of ' + time.shortDay(entry.pay_date) + ' moved',
      text: 'Payroll moved the cut-off for the pay date ' + say.day(entry.pay_date) + ' from ' + say.moment(ms(before.cutoff_at)) + ' to ' + say.moment(cutoff) + '.' + end};
    const next = c.planned(data).sort((a, b) => c.compare(a.pay_date, b.pay_date) || c.compare(a.id, b.id))[0] === entry;
    return {title: 'Your ' + (next ? 'next ' : '') + 'pay date moved from ' + time.shortDay(before.pay_date) + ' to ' + time.shortDay(entry.pay_date),
      text: 'Payroll moved the pay date for the period ' + period + ' from ' + say.day(before.pay_date) + ' to ' + say.day(entry.pay_date) + '.' +
        (movedCutoff ? ' It also moved the cut-off from ' + say.moment(ms(before.cutoff_at)) + '.' : '') + end};
  },
  'deposit.updated'({statement, deposit, payload, say}) {
    const amount = amountText(cents(deposit.amount)), pay = say.day(statement.pay_date);
    if (deposit.state === 'returned') return {title: 'A deposit of ' + amount + ' was returned',
      text: 'Your deposit ' + deposit.id + ' of ' + amount + ' to ' + account(deposit.account) + ', from the pay of ' + pay + ', was returned.' +
        reasonText(payload.reason) + ' Check your deposit setup in Payleaf.'};
    const to = deposit.reissued_to;
    return {title: 'Your returned deposit of ' + amount + ' was reissued',
      text: 'Payroll reissued your deposit ' + deposit.id + ' of ' + amount + ', from the pay of ' + pay + ', ' +
        (to.kind === 'check' ? 'as a check' + (to.label ? ' (' + to.label + ')' : '') : 'to ' + account(to)) + '.' + reasonText(payload.reason) + ' Open Payleaf to see the statement.'};
  },
  'inquiry.answered'({data, inquiry}) {
    const statement = data.statements.find(s => s.id === inquiry.statement_id), answer = inquiry.answer;
    const line = inquiry.line_id === null ? null : c.linesOf(statement).find(l => l.line_id === inquiry.line_id);
    return {title: answer.answered_by + ' answered your question on pay statement ' + statement.id,
      text: answer.answered_by + ' answered your question ' + inquiry.id + ' on pay statement ' + statement.id +
        (line ? ', line ' + line.line_id + ' (' + line.text + ')' : '') + '. ' +
        (answer.outcome === 'corrected' ? 'The answer is a correction of ' + amountText(cents(answer.correction_amount)) + '. The money comes on a later pay statement.'
          : 'The answer is that nothing changes.') + noteText(answer.note)};
  },
  'leave.decided'({data, request}) {
    const type = data.leave_types.find(t => t.id === request.leave_type_id), manager = data.employment.manager;
    const who = request.decided_by === manager.person_id ? manager.name : request.decided_by, approved = request.stored_state === 'approved';
    const what = type.name + ', ' + time.rangeText(request.start, request.end);
    return {title: 'Leave ' + (approved ? 'approved' : 'denied') + ': ' + what,
      text: who + (approved ? ' approved' : ' denied') + ' your leave request ' + request.id + ': ' + what + ', ' + count(request.days.length, 'working day') + ', ' +
        hoursText(tenths(request.hours)) + ' hours.' + (approved ? '' : ' These hours are available again.') + noteText(request.decision_note)};
  },
  'leave.adjusted'({data, entry, now}) {
    const type = data.leave_types.find(t => t.id === entry.leave_type_id), b = views.balance(data, type, now), hours = tenths(entry.hours);
    return {title: 'Your leave balance for ' + type.name + ' went ' + (hours < 0 ? 'down' : 'up') + ' by ' + hoursText(Math.abs(hours)) + ' hours',
      text: 'Your leave balance for ' + type.name + ' changed by ' + (hours < 0 ? '' : '+') + hoursText(hours) + ' hours. Reason: ' + entry.reason + '.' + noteText(entry.note) +
        ' The balance is now ' + hoursText(b.balance) + ' hours, and ' + hoursText(b.available) + ' hours are available.'};
  },
  'enrollment.opened'({data, window, say, now}) {
    const plans = window.plan_ids.map(id => c.planOf(data, id)), rolls = plans.filter(p => p.rolls_over), stays = plans.filter(p => !p.rolls_over);
    const opened = now >= ms(window.opens_at);
    return {title: 'Benefits enrollment for ' + window.plan_year + (opened ? ' is open' : ' opens on ' + time.shortDay(time.localDay(ms(window.opens_at), data.preferences.timezone))),
      text: 'Benefits enrollment for the ' + window.plan_year + ' plan year is open from ' + say.moment(ms(window.opens_at)) + ' to ' + say.moment(ms(window.closes_at)) +
        '. It covers ' + count(plans.length, 'plan') + ': ' + list(plans.map(p => p.name)) + '.' +
        (rolls.length ? ' If you submit nothing, ' + list(rolls.map(p => p.name)) + ' keep' + (rolls.length === 1 ? 's' : '') + ' your ' + (window.plan_year - 1) + ' choice.' : '') +
        (stays.length ? ' ' + list(stays.map(p => p.name)) + (stays.length === 1 ? ' does' : ' do') + ' not roll over, so with nothing submitted you have no coverage there.' : '') +
        ' Open Payleaf to choose and submit.'};
  }
};
function wire(data, notification) {
  const [objectType, topic] = ABOUT[notification.kind];
  return {specversion: '1.0', id: notification.id, source: 'urn:pale:app:' + encodeURIComponent(c.APP) + ':account:' + encodeURIComponent(data.account_id),
    type: 'org.pale.mail.notification.v1', time: notification.at, datacontenttype: 'application/json', dataschema: 'urn:pale:email-payload:1',
    data: {channel: 'channel.email', recipient: {kind: 'person_ref', id: data.owner_person_id},
      source_object: {app_id: c.APP, account_id: data.account_id, object_type: objectType, object_id: notification.object_id},
      content: {title: notification.title, body: {format: 'text/plain', text: notification.text}, asset_ids: []},
      subscription_ref: data.account_id + ':' + topic, extensions: []}};
}
// One notification for one applied event. Times in the text use the time zone of the preferences.
function write(t, data, kind, objectId, details) {
  const zone = data.preferences.timezone, year = Number(time.localDay(t.now, zone).slice(0, 4));
  const say = {day: day => time.dayText(day, year), moment: instant => time.momentText(instant, zone, year)};
  const {title, text} = writers[kind]({data, say, now: t.now, ...details});
  const notification = {id: c.nextId(c.allIds(data), 'ntf-'), at: t.at, kind, event_id: t.ref, object_type: ABOUT[kind][0], object_id: objectId,
    title: title.slice(0, 200), text: text.slice(0, 4000), email: null};
  if (data.preferences.email_notices) notification.email = wire(data, notification);
  data.notifications.push(notification);
  c.record(t, data, 'notification.written', notification.id, true);
  return notification;
}
module.exports = {write, wire, ABOUT};
