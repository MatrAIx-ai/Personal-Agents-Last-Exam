'use strict';
// Deterministic fixture generator. Narrative content is authored here; schedules, slot calendars and
// cent-exact insurance arithmetic are computed. Same seed, same bytes. Run: node scripts/generate-fixture.cjs
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const TZ = '-08:00';                      // Pacific standard time for the whole history (Nov 2026)
const PDT = '-07:00';
const daylight = day => (day >= '2025-03-09' && day < '2025-11-02') || (day >= '2026-03-08' && day < '2026-11-01');
const T = (day, hm, off) => day + 'T' + hm + ':00' + (off || (daylight(day) ? PDT : TZ));
const NOW = '2026-11-18T09:00:00-08:00';  // matches the shared registry clock
const seed = 20261118;
let state = seed;
const rand = () => {state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648;};
const pick = list => list[Math.floor(rand() * list.length)];
const hist = (entries) => entries.map(([at, action, detail]) => detail === undefined ? {at, action} : {at, action, detail});

const ACCOUNT = 'acct-rosa', PERSON = 'person-rosa', PLAN = 'plan-cascade-ppo-silver';
const data = {
  account_id:ACCOUNT, owner_person_id:PERSON,
  settings:{require_user_confirmation:false, preview_ttl_minutes:30, timezone:'America/Los_Angeles'},
  health_system:{name:'Northlake Health', portal_name:'Northlake Patient Portal', phone:'(503) 555-0140', billing_phone:'(503) 555-0199', billing_hours:'Monday to Friday, 8:00 am to 5:00 pm Pacific',
    cancellation_policy:'Cancel or reschedule at least 24 hours before your visit to avoid a $50 late cancellation fee.', cancellation_notice_hours:24, late_cancellation_fee_cents:5000, past_due_after_days:30},
  patient:{patient_id:'pt-rosa', name:'Rosa Delgado', date_of_birth:'1987-04-12', email:'rosa.delgado@example.com', phone:'(503) 555-0172',
    address:{line1:'418 Alder Street', line2:'Apt 3B', city:'Portland', state:'OR', postal_code:'97204'}, mrn:'NLH-204117',
    insurance:{plan_id:PLAN, plan_name:'Cascade Health PPO Silver', payer:'Cascade Health Plans', member_id:'CHP-77310924', group_number:'G-55102', effective_from:'2025-01-01'},
    card_on_file:{brand:'Visa', last4:'4417'}},
  interstitial:null, clinics:[], providers:[], slots:[], appointments:[], waitlist:[], threads:[], claims:[], payments:[], billing_requests:[], statements:[], previews:[], approvals:[]
};

// ---- clinics and providers ---------------------------------------------------
data.clinics.push(
  {clinic_id:'clinic-northlake-main', name:'Northlake Health Main Campus', address:{line1:'2200 Lakeshore Drive', line2:null, city:'Portland', state:'OR', postal_code:'97210'}, phone:'(503) 555-0140', hours:'Monday to Friday 7:30 am to 6:00 pm; Saturday 8:00 am to 1:00 pm', parking_note:'Garage B, validated at the front desk.'},
  {clinic_id:'clinic-eastbank', name:'Northlake Eastbank Clinic', address:{line1:'1601 SE Division Street', line2:null, city:'Portland', state:'OR', postal_code:'97202'}, phone:'(503) 555-0161', hours:'Monday to Friday 8:00 am to 5:00 pm', parking_note:'Street parking; MAX Green Line two blocks away.'},
  {clinic_id:'clinic-westhills', name:'Northlake West Hills Physical Therapy', address:{line1:'7705 SW Barnes Road', line2:'Suite 120', city:'Portland', state:'OR', postal_code:'97225'}, phone:'(503) 555-0188', hours:'Monday to Thursday 7:00 am to 7:00 pm; Friday 7:00 am to 4:00 pm', parking_note:'Free surface lot.'}
);
const net = (status, other = 'in_network') => [{plan_id:PLAN, status}, {plan_id:'plan-evergreen-hmo', status:other}];
data.providers.push(
  {provider_id:'prov-okafor', name:'Dr. Adaeze Okafor', credentials:'MD', specialty:'Internal Medicine', clinic_id:'clinic-northlake-main', networks:net('in_network'), rating:4.8, review_count:212, accepting_new_patients:true, languages:['English', 'Igbo'], bio:'Primary care physician focused on preventive care and chronic condition management. Rosa\'s primary care provider since 2025.'},
  {provider_id:'prov-lindqvist', name:'Dr. Mats Lindqvist', credentials:'MD', specialty:'Internal Medicine', clinic_id:'clinic-eastbank', networks:net('in_network'), rating:4.5, review_count:88, accepting_new_patients:true, languages:['English', 'Swedish'], bio:'Internist with an interest in sports medicine and musculoskeletal pain.'},
  {provider_id:'prov-bhatt', name:'Priya Bhatt', credentials:'DPT', specialty:'Physical Therapy', clinic_id:'clinic-westhills', networks:net('in_network'), rating:4.9, review_count:143, accepting_new_patients:true, languages:['English', 'Gujarati', 'Hindi'], bio:'Orthopedic physical therapist. Treated Rosa\'s shoulder in the September and October visits.'},
  {provider_id:'prov-castellanos', name:'Dr. Luis Castellanos', credentials:'MD', specialty:'Dermatology', clinic_id:'clinic-northlake-main', networks:net('in_network', 'out_of_network'), rating:4.6, review_count:301, accepting_new_patients:true, languages:['English', 'Spanish'], bio:'Medical and surgical dermatology; same-week visits for new rashes and suspicious moles.'},
  {provider_id:'prov-haddad', name:'Dr. Nour Haddad', credentials:'MD', specialty:'Dermatology', clinic_id:'clinic-eastbank', networks:net('out_of_network', 'in_network'), rating:4.9, review_count:57, accepting_new_patients:true, languages:['English', 'Arabic', 'French'], bio:'Dermatologist with a focus on eczema and psoriasis. Not in the Cascade PPO network.'},
  {provider_id:'prov-whitfield', name:'Dr. Owen Whitfield', credentials:'DO', specialty:'Orthopedics', clinic_id:'clinic-westhills', networks:net('in_network'), rating:4.2, review_count:64, accepting_new_patients:false, languages:['English'], bio:'Non-operative orthopedics. Currently accepting referrals only.'},
  {provider_id:'prov-nakamura', name:'Dr. Keiko Nakamura', credentials:'MD', specialty:'Orthopedics', clinic_id:'clinic-northlake-main', networks:net('in_network'), rating:4.7, review_count:129, accepting_new_patients:true, languages:['English', 'Japanese'], bio:'Shoulder and knee specialist; works closely with the West Hills physical therapy team.'},
  {provider_id:'prov-reyes', name:'Camila Reyes', credentials:'PA-C', specialty:'Internal Medicine', clinic_id:'clinic-northlake-main', networks:net('in_network'), rating:null, review_count:0, accepting_new_patients:true, languages:['English', 'Spanish'], bio:'Physician assistant who joined the Main Campus primary care team in October 2026.'},
  {provider_id:'prov-singh', name:'Dr. Harpreet Singh', credentials:'MD', specialty:'Cardiology', clinic_id:'clinic-eastbank', networks:net('in_network'), rating:4.4, review_count:176, accepting_new_patients:true, languages:['English', 'Punjabi'], bio:'General cardiology and preventive heart care.'},
  {provider_id:'prov-mendes', name:'Tiago Mendes', credentials:'DPT', specialty:'Physical Therapy', clinic_id:'clinic-westhills', networks:net('in_network'), rating:4.3, review_count:39, accepting_new_patients:true, languages:['English', 'Portuguese'], bio:'Physical therapist; vestibular and balance rehabilitation.'}
);

// ---- slot calendars: four weeks from Nov 18, 2026, plus the historical slots the record references ----
const DAYS = 28, START = Date.parse('2026-11-19T00:00:00-08:00');
const schedules = {'prov-okafor':['09:00', '09:30', '10:30', '11:00', '14:00', '15:30'], 'prov-lindqvist':['08:30', '10:00', '13:30', '15:00'], 'prov-bhatt':['07:30', '08:30', '12:00', '16:00', '17:00'],
  'prov-castellanos':['08:00', '11:30', '14:30'], 'prov-haddad':['09:30', '13:00'], 'prov-whitfield':['10:00', '14:00'], 'prov-nakamura':['08:30', '10:30', '13:30', '15:30'], 'prov-reyes':['09:00', '11:00', '14:00', '16:00'], 'prov-singh':['08:00', '12:30', '15:00'], 'prov-mendes':['07:00', '12:30', '17:30']};
const slotId = (prov, start) => 'slot-' + prov.slice(5) + '-' + start.slice(0, 10) + 'T' + start.slice(11, 13) + start.slice(14, 16);
for (const p of data.providers) {
  for (let d = 0; d < DAYS; d++) {
    const dayMs = START + d * 86400000, dow = new Date(dayMs + 8 * 3600000).getUTCDay();
    if (dow === 0 || (dow === 6 && p.clinic_id !== 'clinic-northlake-main')) continue;
    const day = new Date(dayMs + 8 * 3600000).toISOString().slice(0, 10);
    for (const hm of schedules[p.provider_id]) {
      if (rand() < 0.45) continue;                       // the clinic is busy; roughly half the template times are open
      const start = T(day, hm, TZ), end = T(day, String(Number(hm.slice(0, 2)) + (hm.endsWith('30') ? 1 : 0)).padStart(2, '0') + ':' + (hm.endsWith('30') ? '00' : '30'), TZ);
      const types = p.specialty === 'Physical Therapy' ? ['follow_up'] : (rand() < 0.5 ? ['new_patient', 'follow_up'] : ['follow_up']);
      if (!p.accepting_new_patients && types.includes('new_patient')) types.shift();
      data.slots.push({slot_id:slotId(p.provider_id, start), provider_id:p.provider_id, clinic_id:p.clinic_id, start, end, visit_types:types, status:rand() < 0.3 ? 'taken' : 'open'});
    }
  }
}
// Historical and booked slots referenced by appointments (added explicitly so every appointment matches a slot).
function slotFor(prov, start, end, status, types = ['follow_up']) {
  const p = data.providers.find(x => x.provider_id === prov);
  const s = {slot_id:slotId(prov, start), provider_id:prov, clinic_id:p.clinic_id, start, end, visit_types:types, status};
  const i = data.slots.findIndex(x => x.slot_id === s.slot_id);
  if (i >= 0) data.slots[i] = s; else data.slots.push(s);
  return s;
}
function appt(id, prov, start, end, visit_type, reason, status, extra, history) {
  slotFor(prov, start, end, status === 'booked' ? 'booked' : 'taken', visit_type === 'new_patient' ? ['new_patient', 'follow_up'] : ['follow_up']);
  const p = data.providers.find(x => x.provider_id === prov);
  data.appointments.push({appointment_id:id, provider_id:prov, clinic_id:p.clinic_id, slot_id:slotId(prov, start), start, end, visit_type, reason, status, replaced_by:null, replaces:null,
    cancellation_reason:null, reminder_sent_at:null, created_at:history[0][0], updated_at:history[history.length - 1][0], history:hist(history), ...extra});
}
// Shoulder story: PT visits in September and October, a follow-up with the orthopedist, a cancelled PT visit (the disputed fee), an upcoming primary-care visit.
appt('appt-4001', 'prov-okafor', T('2026-08-24', '09:30'), T('2026-08-24', '10:00'), 'follow_up', 'Annual physical and shoulder pain', 'completed', {}, [[T('2026-08-03', '10:12'), 'booked'], [T('2026-08-24', '10:05'), 'completed', 'Visit completed']]);
appt('appt-4002', 'prov-nakamura', T('2026-09-02', '10:30'), T('2026-09-02', '11:00'), 'new_patient', 'Right shoulder pain, referred by Dr. Okafor', 'completed', {}, [[T('2026-08-24', '10:20'), 'booked'], [T('2026-09-02', '11:02'), 'completed', 'Visit completed']]);
const ptDays = ['2026-09-09', '2026-09-16', '2026-09-23', '2026-09-30', '2026-10-07', '2026-10-14'];
ptDays.forEach((day, i) => appt('appt-41' + String(i + 1).padStart(2, '0'), 'prov-bhatt', T(day, '16:00'), T(day, '16:45'), 'follow_up', 'Physical therapy, right shoulder (visit ' + (i + 1) + ' of 8)', 'completed', {}, [[T('2026-09-02', '11:10'), 'booked'], [T(day, '16:50'), 'completed', 'Visit completed']]));
// Visit 7 was cancelled on the evening before, inside the 24-hour window: the fee Rosa disputes. Her cancellation message is in the scheduling thread.
appt('appt-4107', 'prov-bhatt', T('2026-10-21', '16:00'), T('2026-10-21', '16:45'), 'follow_up', 'Physical therapy, right shoulder (visit 7 of 8)', 'cancelled_by_patient', {cancellation_reason:'Fever; cancelled through the scheduling thread'},
  [[T('2026-09-02', '11:12'), 'booked'], [T('2026-10-20', '19:40'), 'cancelled_by_patient', 'Inside the notice window; the late cancellation fee applies.']]);
appt('appt-4108', 'prov-bhatt', T('2026-10-28', '16:00'), T('2026-10-28', '16:45'), 'follow_up', 'Physical therapy, right shoulder (visit 8 of 8)', 'completed', {}, [[T('2026-09-02', '11:13'), 'booked'], [T('2026-10-28', '16:48'), 'completed', 'Visit completed']]);
appt('appt-5102', 'prov-okafor', T('2026-11-24', '10:30', TZ), T('2026-11-24', '11:00', TZ), 'follow_up', 'Shoulder follow-up and lab review', 'booked', {}, [[T('2026-11-03', '08:45', TZ), 'booked']]);
// A clinic-side reschedule earlier in the year: the original slot and its replacement.
appt('appt-3901', 'prov-castellanos', T('2026-06-11', '11:30'), T('2026-06-11', '12:00'), 'new_patient', 'Mole check', 'rescheduled', {replaced_by:'appt-3902'}, [[T('2026-05-20', '13:00'), 'booked'], [T('2026-06-04', '09:15'), 'rescheduled', 'provider_schedule_change; moved to appt-3902']]);
appt('appt-3902', 'prov-castellanos', T('2026-06-18', '08:00'), T('2026-06-18', '08:30'), 'new_patient', 'Mole check', 'completed', {replaces:'appt-3901'}, [[T('2026-06-04', '09:15'), 'moved_by_clinic', 'Replaces appt-3901'], [T('2026-06-18', '08:32'), 'completed', 'Visit completed']]);

// ---- claims: billed = insurance adjustment + insurance paid + patient responsibility, to the cent ----
function claim(id, kind, service_date, prov, clinic, description, status, billed, adj, ins, resp, reason_code, statement_id, history) {
  if (status !== 'in_adjudication' && adj + ins + resp !== billed) throw new Error('Claim arithmetic does not sum: ' + id);
  data.claims.push({claim_id:id, kind, service_date, provider_id:prov, clinic_id:clinic, description, status, billed_cents:billed, insurance_adjustment_cents:adj, insurance_paid_cents:ins,
    patient_responsibility_cents:resp, reason_code, statement_id, posted_at:history[0][0], updated_at:history[history.length - 1][0], history:history.map(([at, action, st, detail]) => detail === undefined ? {at, action, status:st} : {at, action, status:st, detail})});
}
const posted = (at, billed) => [at, 'claim_posted', 'in_adjudication', 'Billed $' + (billed / 100).toFixed(2) + ' to Cascade Health Plans'];
claim('clm-0801', 'visit', '2026-08-24', 'prov-okafor', 'clinic-northlake-main', 'Office visit, established patient, level 4', 'paid', 24500, 9800, 11700, 3000, null, 'stmt-2026-09',
  [posted(T('2026-08-26', '06:00'), 24500), [T('2026-09-12', '06:00'), 'adjudicated', 'paid', 'Insurer paid $117.00, adjusted $98.00; you owe $30.00']]);
claim('clm-0802', 'lab', '2026-08-24', null, 'clinic-northlake-main', 'Comprehensive metabolic panel and lipid panel', 'paid', 18600, 11160, 7440, 0, null, 'stmt-2026-09',
  [posted(T('2026-08-27', '06:00'), 18600), [T('2026-09-12', '06:00'), 'adjudicated', 'paid', 'Preventive labs covered in full']]);
claim('clm-0803', 'visit', '2026-09-02', 'prov-nakamura', 'clinic-northlake-main', 'Orthopedic consultation, new patient, with shoulder imaging review', 'paid', 41000, 16400, 19600, 5000, null, 'stmt-2026-09',
  [posted(T('2026-09-04', '06:00'), 41000), [T('2026-09-25', '06:00'), 'adjudicated', 'paid', 'Insurer paid $196.00, adjusted $164.00; you owe $50.00 (specialist copay)']]);
// The six PT visits: the first four paid; visits five and six denied for no referral on file, then reprocessed on Nov 12 after the clinic resent the referral.
const ptBilled = 18500, ptAdj = 6000, ptIns = 8500, ptResp = 4000;
['2026-09-09', '2026-09-16', '2026-09-23', '2026-09-30'].forEach((day, i) => claim('clm-081' + (i + 1), 'visit', day, 'prov-bhatt', 'clinic-westhills', 'Physical therapy, therapeutic exercise and manual therapy (visit ' + (i + 1) + ')', 'paid', ptBilled, ptAdj, ptIns, ptResp, null, i < 3 ? 'stmt-2026-09' : 'stmt-2026-10',
  [posted(T(new Date(Date.parse(day + 'T12:00:00Z') + 2 * 86400000).toISOString().slice(0, 10), '06:00'), ptBilled), [T(day < '2026-09-20' ? '2026-09-27' : '2026-10-16', '06:00'), 'adjudicated', 'paid', 'Insurer paid $85.00, adjusted $60.00; you owe $40.00']]));
claim('clm-0815', 'visit', '2026-10-07', 'prov-bhatt', 'clinic-westhills', 'Physical therapy, therapeutic exercise and manual therapy (visit 5)', 'paid', ptBilled, ptAdj, ptIns, ptResp, null, 'stmt-2026-10',
  [posted(T('2026-10-09', '06:00'), ptBilled), [T('2026-10-24', '06:00'), 'adjudicated', 'denied', 'Denied: no_referral_on_file'], [T('2026-11-12', '06:00', TZ), 'resubmitted', 'reprocessing', 'Corrected claim resubmitted to Cascade Health Plans'], [T('2026-11-12', '06:00', TZ), 'reprocessed', 'paid', 'Insurer paid $85.00, adjusted $60.00; you owe $40.00']]);
claim('clm-0816', 'visit', '2026-10-14', 'prov-bhatt', 'clinic-westhills', 'Physical therapy, therapeutic exercise and manual therapy (visit 6)', 'paid', ptBilled, ptAdj, ptIns, ptResp, null, 'stmt-2026-10',
  [posted(T('2026-10-16', '06:00'), ptBilled), [T('2026-10-30', '06:00'), 'adjudicated', 'denied', 'Denied: no_referral_on_file'], [T('2026-11-12', '06:00', TZ), 'resubmitted', 'reprocessing', 'Corrected claim resubmitted to Cascade Health Plans'], [T('2026-11-12', '06:00', TZ), 'reprocessed', 'paid', 'Insurer paid $85.00, adjusted $60.00; you owe $40.00']]);
// The disputed late cancellation fee (visit 7) and visit 8, still with the insurer.
claim('clm-0820', 'fee', '2026-10-21', 'prov-bhatt', 'clinic-westhills', 'Late cancellation fee, visit of 2026-10-21', 'paid', 5000, 0, 0, 5000, null, 'stmt-2026-10',
  [[T('2026-10-21', '06:00'), 'fee_posted', 'paid', 'Cancelled inside the 24-hour notice window (appt-4107).']]);
claim('clm-0821', 'visit', '2026-10-28', 'prov-bhatt', 'clinic-westhills', 'Physical therapy, therapeutic exercise and manual therapy (visit 8)', 'in_adjudication', ptBilled, 0, 0, 0, null, null,
  [posted(T('2026-10-30', '06:00'), ptBilled)]);
claim('clm-0790', 'visit', '2026-06-18', 'prov-castellanos', 'clinic-northlake-main', 'Dermatology consultation, new patient, mole check', 'paid', 31000, 12400, 13600, 5000, null, 'stmt-2026-07',
  [posted(T('2026-06-20', '06:00'), 31000), [T('2026-07-08', '06:00'), 'adjudicated', 'paid', 'Insurer paid $136.00, adjusted $124.00; you owe $50.00 (specialist copay)']]);

// ---- payments: Rosa paid the September statement in full and the June copay; October is unpaid ----
data.payments.push(
  {payment_id:'pay-0701', at:T('2026-07-15', '18:22'), kind:'payment', amount_cents:5000, method:'portal_card_on_file', last4:'4417', allocations:[{claim_id:'clm-0790', amount_cents:5000}], confirmation_number:'NLH-7A2C19B0E4', note:'Online payment'},
  {payment_id:'pay-0901', at:T('2026-10-03', '20:05'), kind:'payment', amount_cents:20000, method:'portal_card_on_file', last4:'4417', allocations:[{claim_id:'clm-0801', amount_cents:3000}, {claim_id:'clm-0803', amount_cents:5000}, {claim_id:'clm-0811', amount_cents:4000}, {claim_id:'clm-0812', amount_cents:4000}, {claim_id:'clm-0813', amount_cents:4000}], confirmation_number:'NLH-C41D77AA02', note:'Online payment, September statement'}
);

// ---- statements ---------------------------------------------------------------
const stmt = (id, start, end, generated_at, past_due_note, claim_ids, payment_ids, balance_due_cents, past_due_cents) => data.statements.push({statement_id:id, period_start:start, period_end:end, generated_at, past_due_note, claim_ids, payment_ids, balance_due_cents, past_due_cents, filename:'northlake-statement-' + start + '-to-' + end + '.pdf'});
stmt('stmt-2026-07', '2026-07-01', '2026-07-31', T('2026-08-01', '06:00'), false, ['clm-0790'], ['pay-0701'], 0, 0);
stmt('stmt-2026-09', '2026-09-01', '2026-09-30', T('2026-10-01', '06:00'), false, ['clm-0801', 'clm-0802', 'clm-0803', 'clm-0811', 'clm-0812', 'clm-0813'], [], 20000, 0);
// October statement: visits 4 to 6 ($40 each; 5 and 6 were denied at the time so Rosa owed the full $185 each) plus the $50 fee. Reprocessing on Nov 12 reduced the balance to $170.
stmt('stmt-2026-10', '2026-10-01', '2026-10-31', T('2026-11-01', '06:00'), true, ['clm-0814', 'clm-0815', 'clm-0816', 'clm-0820'], ['pay-0901'], 46000, 0);

// ---- billing requests: none open yet (the fee waiver is what a task asks for) ---

// ---- threads ----------------------------------------------------------------
let msgN = 1;
const msg = (at, role, name, body, read = true, attachments = []) => ({message_id:'msg-' + String(msgN++).padStart(4, '0'), at, author:{role, display_name:name}, body, read, attachments});
function thread(id, subject, category, display, status, awaiting, closed_reason, related, messages, history) {
  data.threads.push({thread_id:id, subject, recipient:{category, display_name:display}, status, awaiting, closed_reason, related, opened_at:messages[0].at, updated_at:history[history.length - 1][0], history:hist(history), messages});
}
const ROSA = ['patient', 'Rosa Delgado'];
thread('thr-scheduling-0906', 'Physical therapy schedule and cancellation', 'clinic', 'Northlake West Hills Physical Therapy', 'closed', null, 'resolved', {claim_id:null, appointment_id:'appt-4107'}, [
  msg(T('2026-09-06', '08:14'), ...ROSA, 'Hi, Dr. Nakamura referred me for 8 PT visits with Priya Bhatt. Can I keep the Wednesday 4:00 pm slot for all of them? I get off work at 3:30.'),
  msg(T('2026-09-08', '10:02'), 'clinic', 'Northlake West Hills Scheduling', 'Hello Rosa, yes. We have you on Wednesdays at 4:00 pm from September 9 through October 28. Please give us 24 hours notice if you need to change a visit.'),
  msg(T('2026-10-20', '19:40'), ...ROSA, 'I came down with a fever tonight and will not make it to tomorrow\'s 4:00 pm visit (October 21). Please cancel it; I will keep the October 28 visit.'),
  msg(T('2026-10-22', '09:15'), 'clinic', 'Northlake West Hills Scheduling', 'Thanks Rosa, the October 21 visit is cancelled. Feel better. Because the cancellation came in after 4:00 pm the day before, the system applied the late cancellation fee; billing can review that if you write to them.'),
  msg(T('2026-10-22', '12:30'), ...ROSA, 'Understood, I will write to billing. Thank you.')
], [[T('2026-09-06', '08:14'), 'thread_opened'], [T('2026-09-08', '10:02'), 'staff_replied', 'Northlake West Hills Scheduling'], [T('2026-10-20', '19:40'), 'patient_replied'], [T('2026-10-22', '09:15'), 'staff_replied', 'Northlake West Hills Scheduling'], [T('2026-10-22', '12:30'), 'patient_replied'], [T('2026-10-29', '17:00'), 'closed', 'resolved']]);
thread('thr-billing-0928', 'Denied physical therapy claims and October statement', 'billing_office', 'Northlake Billing Office', 'open', 'patient', null, {claim_id:'clm-0815', appointment_id:null}, [
  msg(T('2026-10-25', '21:10'), ...ROSA, 'My October 7 PT visit (claim clm-0815) shows as denied with "no referral on file". Dr. Nakamura referred me on September 2 and the first four visits were paid. Can you check what happened?'),
  msg(T('2026-10-28', '14:35'), 'billing_office', 'Northlake Billing Office', 'Hi Rosa, we see the denial. The referral in our system shows an effective date of September 9, 2026, and the insurer treats visits after October 1 as needing a renewed referral. We have asked Dr. Nakamura\'s office to send a backdated referral. You do not need to do anything yet.'),
  msg(T('2026-11-02', '08:05'), ...ROSA, 'My October statement arrived and shows $460 due with a past-due note and a line about collections. $370 of that is the two denied visits you said you were fixing, and $50 is a cancellation fee for a visit I cancelled through the scheduling thread. Please advise.'),
  msg(T('2026-11-12', '09:40', TZ), 'billing_office', 'Northlake PT Billing', 'The referring office has sent the backdated referral and corrected claims for visits five and six were resubmitted today. Please allow 30 days. The collections line on your statement is automated.', false)
], [[T('2026-10-25', '21:10'), 'thread_opened'], [T('2026-10-28', '14:35'), 'staff_replied', 'Northlake Billing Office'], [T('2026-11-02', '08:05'), 'patient_replied'], [T('2026-11-12', '09:40', TZ), 'staff_replied', 'Northlake PT Billing']]);
thread('thr-nurse-1103', 'Shoulder exercises and ibuprofen', 'nurse_line', 'Northlake Nurse Line', 'open', 'patient', null, {claim_id:null, appointment_id:'appt-5102'}, [
  msg(T('2026-11-03', '07:50', TZ), ...ROSA, 'Since finishing PT my shoulder is much better, but it aches after the gym. Is it OK to take ibuprofen 400 mg before workouts, and should I keep doing the band exercises every day?'),
  msg(T('2026-11-03', '16:20', TZ), 'nurse_line', 'Nurse Dana Whitcomb, RN', 'Hi Rosa, ibuprofen 400 mg with food up to three times a day is fine for a few days at a time unless Dr. Okafor has told you otherwise. Keep the band exercises to the three days a week Priya recommended rather than daily, and rest if the ache lasts more than two hours after a workout.'),
  msg(T('2026-11-04', '08:10', TZ), 'nurse_line', 'Nurse Dana Whitcomb, RN', 'One more thing: Priya\'s home program sheet says to switch to the heavier band only once you can do 15 pain-free repetitions. We booked your follow-up with Dr. Okafor for November 24 at 10:30 am; she will review the labs then.', false)
], [[T('2026-11-03', '07:50', TZ), 'thread_opened'], [T('2026-11-03', '16:20', TZ), 'staff_replied', 'Nurse Dana Whitcomb, RN'], [T('2026-11-04', '08:10', TZ), 'staff_replied', 'Nurse Dana Whitcomb, RN']]);
thread('thr-clinic-0601', 'Mole check appointment moved', null, 'Northlake Health Main Campus', 'closed', null, 'resolved', {claim_id:null, appointment_id:'appt-3902'}, [
  msg(T('2026-06-04', '09:16'), 'clinic', 'Northlake Health Main Campus', 'Hello Rosa, Dr. Castellanos has a schedule change on June 11. We moved your mole check to Thursday, June 18 at 8:00 am. Reply here if that does not work.'),
  msg(T('2026-06-04', '12:40'), ...ROSA, 'June 18 at 8:00 works, thanks.')
], [[T('2026-06-04', '09:16'), 'thread_opened'], [T('2026-06-04', '12:40'), 'patient_replied'], [T('2026-06-19', '09:00'), 'closed', 'resolved']]);
thread('thr-billing-0715', 'Question about dermatology copay', 'billing_office', 'Northlake Billing Office', 'closed', null, 'resolved', {claim_id:'clm-0790', appointment_id:null}, [
  msg(T('2026-07-10', '19:02'), ...ROSA, 'My June 18 dermatology visit shows $50 due. My plan says specialist visits are $50 but my primary care copay is $30; I just want to confirm $50 is right before I pay.'),
  msg(T('2026-07-13', '10:48'), 'billing_office', 'Northlake Billing Office', 'Hi Rosa, that is correct: Cascade PPO Silver applies a $50 specialist copay for dermatology. You can pay in the portal under Billing.'),
  msg(T('2026-07-15', '18:25'), ...ROSA, 'Paid, thank you.')
], [[T('2026-07-10', '19:02'), 'thread_opened'], [T('2026-07-13', '10:48'), 'staff_replied', 'Northlake Billing Office'], [T('2026-07-15', '18:25'), 'patient_replied'], [T('2026-07-20', '09:00'), 'closed', 'resolved']]);

// ---- routine history from 2025-01 (synthetic filler, fully paid): visits, labs, statements, payments, closed threads ----
const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const nextMonth = day => {const [y, m] = day.split('-').map(Number); return (m === 12 ? (y + 1) + '-01' : y + '-' + String(m + 1).padStart(2, '0'));};
const ROUTINE = [
  {day:'2025-01-28', hm:'09:30', prov:'prov-okafor', visit:'follow_up', reason:'Blood pressure follow-up', charges:[['visit', 'Office visit, established patient, level 3', 19500, 7800, 8700, 3000]]},
  {day:'2025-03-11', hm:'12:30', prov:'prov-singh', visit:'new_patient', reason:'Palpitations, referred by Dr. Okafor', charges:[['visit', 'Cardiology consultation, new patient', 38000, 15200, 17800, 5000], ['lab', '12-lead electrocardiogram', 12500, 5000, 7500, 0]],
    thread:{category:'nurse_line', display:'Northlake Nurse Line', subject:'Palpitations before the cardiology visit', lines:[['patient', 'Rosa Delgado', 'My palpitations come back in the evening after coffee. Should I stop coffee before the March 11 visit with Dr. Singh?'], ['nurse_line', 'Nurse Dana Whitcomb, RN', 'Hi Rosa, keep your usual routine so the ECG reflects a normal day, but note the time of each episode. Call 911 for chest pain, fainting or shortness of breath.'], ['patient', 'Rosa Delgado', 'Will do, thank you.']]}},
  {day:'2025-04-22', hm:'10:30', prov:'prov-okafor', visit:'follow_up', reason:'Review cardiology findings', charges:[['visit', 'Office visit, established patient, level 3', 19500, 7800, 8700, 3000]]},
  {day:'2025-06-05', hm:'13:00', prov:'prov-haddad', visit:'new_patient', reason:'Eczema flare on both hands', charges:[['visit', 'Dermatology consultation, new patient (out of network)', 26000, 0, 10400, 15600]]},
  {day:'2025-08-19', hm:'09:00', prov:'prov-okafor', visit:'follow_up', reason:'Annual physical', charges:[['visit', 'Preventive visit, established patient', 24500, 9800, 14700, 0], ['lab', 'Comprehensive metabolic panel and lipid panel', 18600, 11160, 7440, 0]],
    thread:{category:'clinic', display:'Northlake Health Main Campus', subject:'Lab results from the August physical', lines:[['patient', 'Rosa Delgado', 'My lab results are posted but I do not understand the LDL line. Is 128 something to worry about?'], ['clinic', 'Northlake Health Main Campus', 'Hello Rosa, Dr. Okafor reviewed the results: LDL 128 is slightly above the goal of 100. She recommends diet changes and a repeat lipid panel in six months; no medication for now.']]}},
  {day:'2025-10-07', hm:'14:00', prov:null, visit:'follow_up', reason:'Influenza vaccine, nurse visit', charges:[['visit', 'Influenza vaccine and administration', 4500, 2000, 2500, 0]]},
  {day:'2025-11-18', hm:'15:30', prov:'prov-okafor', visit:'follow_up', reason:'Blood pressure follow-up', charges:[['visit', 'Office visit, established patient, level 3', 19500, 7800, 8700, 3000]]},
  {day:'2026-02-10', hm:'11:00', prov:'prov-okafor', visit:'follow_up', reason:'Repeat lipid panel and blood pressure', charges:[['visit', 'Office visit, established patient, level 3', 19500, 7800, 8700, 3000], ['lab', 'Lipid panel', 9800, 5880, 3920, 0]],
    thread:{category:'nurse_line', display:'Northlake Nurse Line', subject:'Refill timing for lisinopril', lines:[['patient', 'Rosa Delgado', 'I have four lisinopril tablets left and my February 10 visit is next week. Can the refill wait until then?'], ['nurse_line', 'Nurse Dana Whitcomb, RN', 'Hi Rosa, Dr. Okafor sent a seven-day bridge refill to your pharmacy so you do not run out before the visit.']]}}
];
let seq = 0;
for (const r of ROUTINE) {
  seq++;
  const n = String(seq).padStart(2, "0"), startHm = r.hm, endHm = String(Number(r.hm.slice(0, 2)) + (r.hm.endsWith('30') ? 1 : 0)).padStart(2, '0') + ':' + (r.hm.endsWith('30') ? '00' : '30');
  const clinicId = r.prov ? data.providers.find(p => p.provider_id === r.prov).clinic_id : 'clinic-northlake-main';
  if (r.prov) appt('appt-h' + n, r.prov, T(r.day, startHm), T(r.day, endHm), r.visit, r.reason, 'completed', {}, [[T(addDays(r.day, -18), '10:00'), 'booked'], [T(r.day, endHm.slice(0, 2) + ':' + String(Number(endHm.slice(3)) + 5).padStart(2, '0')), 'completed', 'Visit completed']]);
  const ids = [], stmtId = 'stmt-' + nextMonth(r.day), resp = [];
  r.charges.forEach(([kind, desc, billed, adj, ins, pr], i) => {
    const id = 'clm-h' + n + String(i + 1);
    ids.push(id); if (pr > 0) resp.push([id, pr]);
    claim(id, kind, r.day, r.prov, clinicId, desc, 'paid', billed, adj, ins, pr, null, stmtId,
      [posted(T(addDays(r.day, 2), '06:00'), billed), [T(addDays(r.day, 21 + i), '06:00'), 'adjudicated', 'paid', pr === 0 ? 'Covered in full' : 'Insurer paid $' + (ins / 100).toFixed(2) + ', adjusted $' + (adj / 100).toFixed(2) + '; you owe $' + (pr / 100).toFixed(2)]]);
  });
  const total = resp.reduce((s, [, v]) => s + v, 0), payDay = nextMonth(r.day) + '-12';
  if (total > 0) data.payments.push({payment_id:'pay-h' + n, at:T(payDay, '19:05'), kind:'payment', amount_cents:total, method:'portal_card_on_file', last4:'4417', allocations:resp.map(([claim_id, amount_cents]) => ({claim_id, amount_cents})),
    confirmation_number:'NLH-' + (seq * 7919).toString(16).toUpperCase().padStart(10, '0'), note:'Online payment, ' + nextMonth(r.day).slice(0, 4) + ' statement'});
  stmt(stmtId, nextMonth(r.day) + '-01', addDays(nextMonth(nextMonth(r.day)) + '-01', -1), T(nextMonth(nextMonth(r.day)) + '-01', '06:00'), false, ids, [], total, 0);
  if (r.thread) {
    const base = addDays(r.day, -6), msgs = r.thread.lines.map(([role, name, body], i) => msg(T(addDays(base, i), i === 0 ? '08:10' : '14:20'), role, name, body));
    thread('thr-h' + n, r.thread.subject, r.thread.category, r.thread.display, 'closed', null, 'resolved', {claim_id:null, appointment_id:r.prov ? 'appt-h' + n : null}, msgs,
      [[msgs[0].at, 'thread_opened'], ...msgs.slice(1).map(m => [m.at, m.author.role === 'patient' ? 'patient_replied' : 'staff_replied', m.author.role === 'patient' ? undefined : m.author.display_name]), [T(addDays(r.day, 1), '09:00'), 'closed', 'resolved']]);
  }
}

// ---- waitlist: one entry waiting for an earlier primary care slot -----------
data.waitlist.push({waitlist_entry_id:'wl-77', provider_id:'prov-okafor', appointment_id:'appt-5102', earliest:T('2026-11-19', '08:00', TZ), latest:T('2026-11-23', '18:00', TZ), status:'waiting', offer:null, booked_appointment_id:null,
  created_at:T('2026-11-04', '08:30', TZ), updated_at:T('2026-11-04', '08:30', TZ), history:hist([[T('2026-11-04', '08:30', TZ), 'joined']])});
// Keep the slot the approved example offers open so the example event can run.
slotFor('prov-okafor', T('2026-11-20', '15:00', TZ), T('2026-11-20', '15:30', TZ), 'open');
slotFor('prov-okafor', T('2026-11-24', '09:00', TZ), T('2026-11-24', '09:30', TZ), 'open');
slotFor('prov-okafor', T('2026-11-25', '14:00', TZ), T('2026-11-25', '14:30', TZ), 'open');
slotFor('prov-nakamura', T('2026-12-03', '10:30', TZ), T('2026-12-03', '11:00', TZ), 'open', ['new_patient', 'follow_up']);

// ---- write -------------------------------------------------------------------
data.slots.sort((a, b) => a.start.localeCompare(b.start) || a.slot_id.localeCompare(b.slot_id));
const seedFile = path.join(root, 'fixtures/minimal.json');
fs.writeFileSync(seedFile, JSON.stringify(data, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'fixtures/clock.json'), JSON.stringify({initial_time:NOW}, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'fixtures/binding.json'), JSON.stringify({people:[{person_id:PERSON, name:'Rosa Delgado'}], accounts:[{app_id:'northlake-portal', account_id:ACCOUNT, owner_person_id:PERSON}],
  objects:{'northlake-portal':require('../src/model.cjs').objects(data)}}, null, 2) + '\n');
const datasetFile = path.join(root, 'contribution/dataset.json');
if (fs.existsSync(datasetFile)) {const d = JSON.parse(fs.readFileSync(datasetFile, 'utf8')); d.expected_counts.records = require('../src/model.cjs').records(data).length; fs.writeFileSync(datasetFile, JSON.stringify(d, null, 2) + '\n');}
const counts = {threads:data.threads.length, messages:data.threads.reduce((s, t) => s + t.messages.length, 0), claims:data.claims.length, payments:data.payments.length, appointments:data.appointments.length, slots:data.slots.length, providers:data.providers.length, records:require('../src/model.cjs').records(data).length};
console.log('Wrote fixtures/minimal.json: ' + JSON.stringify(counts));
