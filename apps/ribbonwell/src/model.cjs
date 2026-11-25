'use strict';
const {fail, ms, fold, FLOOR, OFFSET} = require('./util.cjs');
const d = require('./derive.cjs');
const bad = message => fail('invalid_seed', message);

function validateSeed(ctx, data) {
  const account = ctx.binding.accounts.filter(a => a.app_id === ctx.app_id && a.account_id === data.account_id);
  if (account.length !== 1) bad('The seed account_id must be the ribbonwell account declared in the run binding.');
  if (data.members.filter(m => m.person_id === account[0].owner_person_id).length !== 1) bad('Exactly one member must carry the account owner\'s person_id.');
  const now = ms(ctx.virtual_now), floor = ms(FLOOR);
  const time = (value, label, {future = false} = {}) => {
    if (value === null) return;
    if (!OFFSET.test(value)) bad(label + ' needs a UTC offset.');
    if (ms(value) < floor) bad(label + ' is before 2025-01-01.');
    if (!future && ms(value) > now) bad(label + ' is after the current time.');
  };
  const unique = (rows, key, label) => { const ids = new Set(rows.map(r => r[key])); if (ids.size !== rows.length) bad('Duplicate ' + label + ' ID.'); return ids; };
  const all = [...data.members.map(m => m.member_id), ...data.groups.map(g => g.group_id), ...data.lists.map(l => l.list_id), ...data.items.map(i => i.item_id),
    ...data.claims.map(c => c.claim_id), ...data.exchanges.map(x => x.exchange_id), ...data.notifications.map(n => n.notification_id)];
  if (new Set(all).size !== all.length) bad('Duplicate ID.');
  const members = unique(data.members, 'member_id', 'member');
  const people = data.members.map(m => m.person_id).filter(Boolean);
  if (new Set(people).size !== people.length) bad('Two members share a person_id.');
  for (const p of people) if (!ctx.binding.people.some(x => x.person_id === p)) bad('A member person_id is not in the run binding.');
  const groups = new Map(data.groups.map(g => [g.group_id, g]));
  for (const g of data.groups) if (g.member_ids.some(m => !members.has(m))) bad('A group names an unknown member.');
  const lists = new Map(data.lists.map(l => [l.list_id, l]));
  for (const l of data.lists) {
    const g = groups.get(l.group_id);
    if (!g || !g.member_ids.includes(l.owner_member_id)) bad('A list owner is outside the list\'s group.');
    if (l.managed_by !== null && (!g.member_ids.includes(l.managed_by) || l.managed_by === l.owner_member_id)) bad('A list manager is outside the list\'s group.');
    time(l.created_at, 'List creation time'); time(l.occasion_date, 'Occasion date', {future: true});
  }
  const items = new Map(data.items.map(i => [i.item_id, i])), names = new Set();
  for (const i of data.items) {
    if (!lists.has(i.list_id)) bad('An item names an unknown list.');
    if (i.status === 'listed') { const key = i.list_id + '\n' + fold(i.name); if (names.has(key)) bad('Two listed items on one list share a name.'); names.add(key); }
    time(i.created_at, 'Item creation time'); time(i.updated_at, 'Item change time');
    if (ms(i.updated_at) < ms(i.created_at)) bad('Item times are reversed.');
  }
  const exchanges = new Map(data.exchanges.map(x => [x.exchange_id, x])), open = new Set();
  for (const c of data.claims) {
    const i = items.get(c.item_id);
    if (!i || !members.has(c.member_id)) bad('A claim names an unknown item or member.');
    const l = lists.get(i.list_id);
    if (l.owner_member_id === c.member_id) bad('A list owner cannot claim their own item.');
    if (!groups.get(l.group_id).member_ids.includes(c.member_id)) bad('A claimer is outside the list\'s group.');
    if (c.status !== 'released') { const key = c.member_id + '\n' + c.item_id; if (open.has(key)) bad('One member has two unreleased claims on one item.'); open.add(key); }
    if ((c.status === 'reserved') !== (c.reserved_until !== null)) bad('Only a reserved claim carries reserved_until.');
    if (c.for_exchange_id !== null && !exchanges.has(c.for_exchange_id)) bad('A claim names an unknown exchange.');
    time(c.created_at, 'Claim creation time'); time(c.updated_at, 'Claim change time'); time(c.reserved_until, 'Hold end', {future: true});
  }
  const exchangeNames = new Set();
  for (const x of data.exchanges) {
    const g = groups.get(x.group_id);
    if (!g || !g.member_ids.includes(x.organizer_member_id)) bad('An exchange organizer is outside its group.');
    if (x.participant_ids.some(p => !g.member_ids.includes(p))) bad('An exchange participant is outside its group.');
    if (x.exclusions.some(([a, b]) => a === b || !g.member_ids.includes(a) || !g.member_ids.includes(b))) bad('An exclusion names someone outside the group or pairs a member with themselves.');
    const key = x.group_id + '\n' + fold(x.name); if (exchangeNames.has(key)) bad('Two exchanges in one group share a name.'); exchangeNames.add(key);
    time(x.created_at, 'Exchange creation time'); time(x.join_by, 'join_by', {future: true}); time(x.exchange_date, 'exchange_date', {future: true}); time(x.drawn_at, 'Draw time');
    if (ms(x.join_by) >= ms(x.exchange_date)) bad('join_by must be before exchange_date.');
    if (x.drawn_at === null ? x.assignments.length > 0 : !d.validAssignments(x, x.assignments)) bad('Assignments are not a valid set for the participants and exclusions.');
  }
  for (const n of data.notifications) time(n.at, 'Notification time');
  let seq = 0;
  for (const row of data.activity) { if (row.seq !== ++seq) bad('Activity rows must be numbered from 1 without gaps.'); time(row.at, 'Activity time'); }
}
// Core counts and addresses App objects through these two hooks; they describe the same records.
const records = data => [...data.lists, ...data.items, ...data.claims, ...data.exchanges];
const objects = data => [...data.lists.map(l => l.list_id), ...data.items.map(i => i.item_id), ...data.claims.map(c => c.claim_id), ...data.exchanges.map(x => x.exchange_id)];
module.exports = {validateSeed, records, objects, references: () => []};
