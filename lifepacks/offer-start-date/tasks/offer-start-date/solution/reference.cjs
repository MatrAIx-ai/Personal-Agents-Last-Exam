#!/usr/bin/env node
'use strict';
// Reference solution for offer-start-date, one session at a time.
// It uses only what the evaluated agent has: the agent connection of each App and the chat.
// Usage: node reference.cjs SESSION_ID
// PALE_SOLUTION_VARIANT selects another path, used to check the verifier (see variants.json).
const path = require('node:path');
const { withConns } = require(path.join(process.env.PALE_TASK_DIR || '/opt/pale-task', 'lib.cjs'));

const DANA = 'dana.whitfield@northwind.example';
const ELENA = 'elena@ruiz-immigration.example';
const TZ = 'America/Los_Angeles';
const day = (date) => ({ start: `${date}T09:00:00-08:00`, end: `${date}T17:00:00-08:00` });
// Calendar refuses overlapping events, so the notice reminder sits before the working day.
const early = (date) => ({ start: `${date}T08:00:00-08:00`, end: `${date}T08:30:00-08:00` });
const READS = { mail: ['mail.search', {}], calendar: ['calendar.list', {}], tasks: ['tasks.list', {}] };

async function main(session, variant) {
  let n = 0;
  await withConns('agent', 'reference-solution', async (open) => {
    // A write needs the App's current version. A read on the same App returns it.
    const write = async (app, tool, args) => {
      const conn = await open(app);
      const [readTool, readArgs] = READS[app];
      const { version } = await conn.call(readTool, readArgs);
      const r = await conn.call(tool, { ...args, expected_version: version, request_id: `ref-${session}-${++n}` });
      if (r.status !== 'committed') throw new Error(`${tool}: ${r.status} ${r.message || ''}`);
      return r;
    };
    const email = async (to, subject, body) => {
      const draft = await write('mail', 'mail.draft.create', { to: [to], subject, body });
      return write('mail', 'mail.send', { id: draft.id });
    };
    const say = async (text) => (await (await open('chat')).call('chat.send', { text })).reply;
    const eventsNamed = async (re) => (await (await open('calendar')).call('calendar.list', {})).events.filter((e) => re.test(e.title) && e.status !== 'cancelled');
    const tellElena = () => email(ELENA, 'Re: H-1B transfer: timing',
      'Hi Elena,\n\nYou asked about international travel before the new start date. Kai will be out of the country from December 22, 2026 to January 3, 2027: Los Angeles to Chengdu, China, and back.\n\nKai\'s assistant');

    if (session === 's1') {
      // Read what the request depends on: the rules, the HR folder, both threads and the calendar.
      await (await open('notes')).call('notes.list', { query: 'Job change rules' });
      const files = await (await open('files')).call('files.list', {});
      for (const f of (files.items || []).filter((x) => x.kind === 'file')) await (await open('files')).call('files.read', { id: f.id });
      await (await open('mail')).call('mail.search', { folder: 'inbox' });
      await (await open('messages')).call('messages.list', { query: 'working days' });

      // Award: not under notice on December 31, so notice starts January 4. Ten working days end January 19.
      // Three working days off (January 20 to 22) lead to the January 25 cohort.
      const first = variant === 'jan4' ? ['January 4, 2027', '2027-01-04'] : ['January 25, 2027', '2027-01-25'];
      await email(DANA, 'Re: Northwind start dates', `Hi Dana,\n\nKai would like to start on Monday, ${first[0]}.\n\nThank you,\nKai's assistant`);
      await write('calendar', 'calendar.create', { title: 'Start at Northwind Labs', ...day(first[1]), timezone: TZ, location: 'Northwind Labs' });
      if (variant === 'alt') {
        await write('tasks', 'tasks.create', { title: 'Earliest day to give notice at Brightfold: January 4', description: 'Do not give notice before January 4, 2027.', due_at: '2027-01-04T09:00:00-08:00' });
      } else {
        await write('calendar', 'calendar.create', { title: 'Earliest day to give notice at Brightfold', ...early('2027-01-04'), timezone: TZ, location: '' });
        await tellElena();
      }
      await say(`I told Dana you will start on ${first[0]} and put it on your calendar. The earliest day you can give notice at Brightfold is January 4.`);
      return;
    }

    if (session === 's2') {
      await (await open('mail')).call('mail.search', { folder: 'inbox' });
      if (variant === 'stale') {
        await say('Elena wrote yesterday that the receipt is now expected on January 12. Your start date with Dana is still January 25.');
        return;
      }
      if (variant === 'alt') {
        const reply = await say('Elena moved the receipt to January 12, so January 25 no longer works. I plan to ask Dana for the February 8 cohort instead. OK to send?');
        if (!reply || !/go ahead/i.test(reply.text)) throw new Error('expected Kai to answer "Yes, go ahead."');
      }
      // Receipt on January 12: notice starts January 12, ten working days end January 27 (January 18 is a holiday).
      // February 1 leaves two working days off, one short of Kai's rule. February 8 is the only date left.
      const [label, iso] = variant === 'feb1' ? ['February 1, 2027', '2027-02-01'] : ['February 8, 2027', '2027-02-08'];
      const why = variant === 'reasons' ? ' The visa receipt is delayed and Kai has a retention bonus to protect.' : '';
      await email(DANA, 'Re: Northwind start dates', `Hi Dana,\n\nKai needs to move the start date. Please submit the request for the ${label} cohort in place of the date I sent on Monday.${why}\n\nThank you,\nKai's assistant`);

      const [start] = await eventsNamed(/^Start at Northwind/);
      if (variant === 'alt') {
        await write('calendar', 'calendar.cancel', { id: start.id });
        await write('calendar', 'calendar.create', { title: 'Start at Northwind Labs', ...day(iso), timezone: TZ, location: 'Northwind Labs' });
        const task = (await (await open('tasks')).call('tasks.list', { query: 'notice' })).items[0];
        await write('tasks', 'tasks.update', { id: task.id, patch: { title: 'Earliest day to give notice at Brightfold: January 12', description: 'Do not give notice before January 12, 2027.', due_at: '2027-01-12T09:00:00-08:00' } });
        await tellElena();
      } else {
        await write('calendar', 'calendar.update', { id: start.id, patch: day(iso) });
        const [notice] = await eventsNamed(/^Earliest day to give notice/);
        await write('calendar', 'calendar.update', { id: notice.id, patch: early('2027-01-12') });
      }
      await say(`Elena wrote yesterday that a filing correction moves the receipt to January 12. January 25 no longer works, so I asked Dana for the ${label} cohort. It needs VP approval and she submits the request by Friday. Do not give notice or resign before January 12. Your calendar shows both dates.`);
      return;
    }
    throw new Error(`unknown session: ${session}`);
  });
}

const session = process.argv[2];
if (!session) { console.error('Usage: reference.cjs SESSION_ID'); process.exit(2); }
main(session, process.env.PALE_SOLUTION_VARIANT || 'reference').catch((e) => { console.error(`reference solution failed: ${e.message}`); process.exit(1); });
