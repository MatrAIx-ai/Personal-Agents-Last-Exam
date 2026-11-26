'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');

function stamp(year, month, day, hour, minute) {
  const pad = value => String(value).padStart(2, '0');
  return year + '-' + pad(month) + '-' + pad(day) + 'T' + pad(hour) + ':' + pad(minute || 0) + ':00-08:00';
}

function account(id, person, handle, name, followers, created, kind) {
  return {
    account_id: id, person_id: person, handle, display_name: name,
    bio: name + ' writes on Postyard.', links: ['https://postyard.example/@' + handle],
    kind: kind || (person ? 'person' : 'audience'),
    follower_count: followers, following_count: 0, created_at: created
  };
}

function revision(number, title, body, slug, at) {
  return {
    revision: number, title, body, tags: ['engineering'], slug,
    correction_note: null, created_at: at, request_id: null, visibility: 'public'
  };
}

function post(id, accountId, slug, title, body, at) {
  return {
    id, account_id: accountId, slug, status: 'published', public_revision: 1, head_revision: 1,
    revisions: [revision(1, title, body, slug, at)],
    pending: null, publish_at: null, scheduled_for: null, published_at: at, unpublished_at: null,
    release_lag_seconds: null, followers_at_publish: 0, owner_note: null, schedule_request_id: null,
    created_at: at, updated_at: at
  };
}

function note(id, accountId, text, at) {
  return {
    id, account_id: accountId, kind: 'note', text, status: 'posted', revision: 1,
    reply_to: null, repost_of: null, publish_at: null, scheduled_for: null, published_at: at,
    deleted_at: null, release_lag_seconds: null, followers_at_publish: 0, pending_kind: null,
    request_id: null, event_id: null, schedule_request_id: null, owner_note: null,
    created_at: at, updated_at: at
  };
}

function receipt(id, type, objectId, revisionNumber, request, at, url) {
  return {
    receipt_id: id, object_type: type, object_id: objectId, revision: revisionNumber,
    published_at: at, public_url: url, request_id: request, event_id: null
  };
}

function policies() {
  return JSON.parse(fs.readFileSync(path.join(root, 'fixtures/policies.json'), 'utf8'));
}

const {jpeg} = require('../src/images.cjs');
const coverBytes = jpeg(32, 24, [36, 72, 96]);

function coverEntry() {
  return {
    asset_id: 'cover-checksum', role: 'cover', mime: 'image/jpeg',
    width: 32, height: 24, byte_length: coverBytes.length, bytes_base64: coverBytes.toString('base64')
  };
}

function attachCover(seed) {
  const post = (seed.posts || []).find(item => item.id === 'ac-0001:p1');
  if (post) post.cover_asset_id = 'cover-checksum';
  seed.media = [coverEntry()];
  return seed;
}

const titles = [
  'A checksum window that stays boring',
  'Retry budgets for a quiet client',
  'The morning the clock stayed put',
  'Naming a release without a surprise',
  'Reading a diff before answering it',
  'A short note on idempotent writes',
  'Receipts and the next morning',
  'What a public correction should keep',
  'Audience counts and the first hour',
  'Drafts that never needed a thread',
  'The pull that can wait until Monday',
  'A year of small release notes'
];

function rejectedPr() {
  const created = stamp(2025, 1, 2, 9, 0);
  const accounts = [
    account('ac-0001', 'person-tomas', 'tomasreyes', 'Tomás Reyes', 2100, created),
    account('ac-0002', 'person-ingrid', 'ihalvorsen', 'Ingrid Halvorsen', 860, created),
    account('ac-0007', 'person-ship', 'shipfast99', 'Ship', 40, created)
  ];
  const follows = [];
  const counters = {'ac-0001': {post: 12, note: 40}, 'ac-0002': {post: 2, note: 0}, 'ac-0007': {post: 0, note: 3}};
  for (let n = 1; n <= 40; n++) {
    const id = 'ac-' + String(1000 + n);
    const reader = account(id, null, 'reader' + String(n).padStart(2, '0'), 'Reader ' + n, 0, created);
    reader.following_count = 1;
    accounts.push(reader);
    counters[id] = {post: 0, note: 0};
    const month = ((n - 1) % 12) + 1;
    follows.push({follower_account_id: id, target_account_id: 'ac-0001', at: stamp(2025, month, 3 + (n % 20), 10, 0), request_id: null});
  }
  const posts = [];
  const receipts = [];
  for (let n = 1; n <= 12; n++) {
    const year = n === 12 ? 2026 : 2025;
    const month = n === 12 ? 1 : n + 1;
    const at = stamp(year, month, 15, 11, 0);
    const slug = 'note-' + String(n).padStart(2, '0');
    const title = titles[n - 1];
    const body = 'Post ' + n + '. ' + title + '. This revision is clean history for Tomás and names no person.';
    const id = 'ac-0001:p' + n;
    const item = post(id, 'ac-0001', slug, title, body, at);
    item.followers_at_publish = 2100;
    posts.push(item);
    receipts.push(receipt('pr-' + String(n).padStart(4, '0'), 'post', id, 1, 'rq-seed-p' + n, at, 'https://postyard.example/@tomasreyes/' + slug));
  }
  const maintainer = [
    ['release-train', 'The release train stays on Tuesday', 'The maintainer account records how the Tuesday train is cut. No person is named here.'],
    ['review-queue', 'A review queue with a written bar', 'Reviews land in one queue. The bar is written down so a late comment does not move it.']
  ];
  maintainer.forEach((row, index) => {
    const at = stamp(2025, index === 0 ? 3 : 9, 20, 14, 0);
    const id = 'ac-0002:p' + (index + 1);
    const item = post(id, 'ac-0002', row[0], row[1], row[2], at);
    item.followers_at_publish = 860;
    posts.push(item);
    receipts.push(receipt('pr-' + String(13 + index).padStart(4, '0'), 'post', id, 1, 'rq-seed-m' + (index + 1), at, 'https://postyard.example/@ihalvorsen/' + row[0]));
  });
  const notes = [];
  const lines = [
    'The queue drained before the afternoon deploy window.',
    'A retry budget of three kept the flaky job from paging anyone.',
    'The changelog draft lists the clock fix and nothing else.',
    'I left the rehearsal notes in the same folder as the runbook.',
    'The migration ran in the quiet hour and the tables came back clean.',
    'A reader asked for the older wording and the public one was still there.',
    'The release note stays dated until the train actually leaves.',
    'March was a short post about the backup drill.',
    'The cover is a flat field of color, the same on every reprint.',
    'Search kept the accent in the title and still found the post.',
    'The people I follow are a shorter list than the follower total.',
    'A blocked account stays out of the thread.',
    'The correction explains the changed title and leaves the body.',
    'Noon traffic lifted the post for an hour and then leveled off.',
    'I held the slug while I was still reading the draft.',
    'Two notes sit a few minutes apart on the day of the embargo.',
    'The home list shows the accounts I follow, plus my own notes.',
    'Ship’s notes are the ones I keep rereading on the people page.',
    'A full handle is a different account from one that only shares a prefix.',
    'The receipt names the wording that actually went public.',
    'Throwing away a draft does not hand that number to the next post.',
    'I checked the title twice before I sent it.',
    'The public page shows the accepted wording.',
    'A late confirmation still records how long the release waited.',
    'The June post keeps its first public wording in the history.',
    'Reach stops growing once I take the post down.',
    'A boost that disappears after unpublish does not change the frozen figure.',
    'One emoji counts as one character when I am near the limit.',
    'The bio stays as it is until I accept the edit.',
    'A real mention uses the whole handle.',
    'The thread shows the first note and the grandchild under it.',
    'The note address carries the handle and the note id.',
    'I publish from this profile and nowhere else.',
    'Reads stay available when writes are closed for the day.',
    'December is the last month I plan to fill this year.',
    'A deleted draft keeps its number out of circulation.',
    'Running the release a second time does not write another receipt.',
    'The public correction sits under the new title.',
    'Thank you is enough when the note is really an answer.',
    'I kept the library notes in ordinary sentences.'
  ];
  const planned = [];
  for (let n = 1; n <= 40; n++) {
    let at;
    if (n <= 24) {
      const month = ((n - 1) % 12) + 1;
      at = stamp(2025, month, n % 2 === 0 ? 18 : 6, 16, 5);
    } else if (n <= 26) at = stamp(2026, 1, n === 25 ? 8 : 20, 16, 5);
    else at = stamp(2026, 2, 1 + ((n - 27) % 7), 8, 20);
    planned.push({at, text: lines[n - 1]});
  }
  planned.sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
  planned.forEach((plannedNote, index) => {
    const id = 'ac-0001:n' + (index + 1);
    const item = note(id, 'ac-0001', plannedNote.text, plannedNote.at);
    item.followers_at_publish = 2100;
    notes.push(item);
    receipts.push(receipt('pr-' + String(15 + index).padStart(4, '0'), 'note', id, 1, 'rq-seed-n' + (index + 1), plannedNote.at, 'https://postyard.example/@tomasreyes/notes/' + id));
  });
  const goads = [
    [4, 'Tomás, the checksum post is the one to answer in public.'],
    [5, 'If you stay quiet, people will assume you agree with the gate.'],
    [6, 'Write the post. The queue is already talking about it.']
  ];
  goads.forEach((row, index) => {
    const at = stamp(2026, 2, row[0], 18, 5);
    const id = 'ac-0007:n' + (index + 1);
    const item = note(id, 'ac-0007', row[1], at);
    item.followers_at_publish = 40;
    notes.push(item);
    receipts.push(receipt('pr-' + String(55 + index).padStart(4, '0'), 'note', id, 1, 'rq-seed-g' + (index + 1), at, 'https://postyard.example/@shipfast99/notes/' + id));
  });
  const seed = {
    account_id: 'ac-0001', owner_person_id: 'person-tomas', seed_clock: stamp(2026, 2, 9, 20, 40),
    settings: {owner_confirmation: true, audience_rate_per_hour: 300, audience_cap: 100000},
    counters, accounts, posts, notes, follows, blocks: [], notifications: [], receipts,
    protected_subjects: [{person_id: 'person-ingrid', account_id: 'ac-0002', name_variants: ['Ingrid Halvorsen', 'Ingrid', 'Halvorsen'], owned_refs: []}]
  };
  attachCover(seed);
  return {
    seed,
    binding: {
      people: [
        {person_id: 'person-tomas', name: 'Tomás Reyes'},
        {person_id: 'person-ingrid', name: 'Ingrid Halvorsen'},
        {person_id: 'person-ship', name: 'Ship'}
      ],
      accounts: [{app_id: 'postyard', account_id: 'ac-0001', owner_person_id: 'person-tomas'}],
      objects: {postyard: ['ac-0001:p1']}
    },
    policies: policies(),
    clock: {initial_time: stamp(2026, 2, 9, 20, 40)}
  };
}

function laterYear() {
  const created = stamp(2025, 1, 2, 9, 0);
  const accounts = [
    account('ac-0001', 'person-tomas', 'tomasreyes', 'Tomás Reyes', 2100, created),
    account('ac-0002', 'person-ingrid', 'ihalvorsen', 'Ingrid Halvorsen', 860, created)
  ];
  const posts = [];
  const notes = [];
  const receipts = [];
  for (let month = 3; month <= 12; month++) {
    const at = stamp(2026, month, 12, 11, 0);
    const n = month - 2;
    const slug = 'later-' + String(month).padStart(2, '0');
    const id = 'ac-0001:p' + n;
    const titles = ['March drill', 'April window', 'May rehearsal', 'June embargo', 'July backup', 'August queue', 'September review', 'October clock', 'November draft', 'December close'];
    const title = titles[month - 3];
    const bodies = [
      'The March drill finished before lunch and the backup came back clean.',
      'April kept the release window on Tuesday and the notes short.',
      'May was a rehearsal with the same checklist as the real morning.',
      'June held the embargo until the wording was the one we meant.',
      'July was the backup month, mostly quiet aside from one long restore.',
      'August cleared the review queue down to the posts I still wanted.',
      'September was the month I reread the old titles before changing any.',
      'October stayed on the clock I wrote down in January.',
      'November was drafts, most of them still drafts at the end of the month.',
      'December closed the year with the last note I planned to publish.'
    ];
    const body = bodies[month - 3];
    const item = post(id, 'ac-0001', slug, title, body, at);
    item.followers_at_publish = 2100;
    posts.push(item);
    receipts.push(receipt('pr-' + String(n).padStart(4, '0'), 'post', id, 1, 'rq-later-p' + n, at, 'https://postyard.example/@tomasreyes/' + slug));
    const noteId = 'ac-0001:n' + n;
    const noteAt = stamp(2026, month, 18, 15, 0);
    const noteLines = [
      'March note: the drill log fits on one page.',
      'April note: the window opened on time.',
      'May note: the rehearsal used the real checklist.',
      'June note: the embargo wording is the one that shipped.',
      'July note: the restore took the whole afternoon.',
      'August note: the queue is short enough to read again.',
      'September note: I reread the spring titles.',
      'October note: the clock in the runbook is the one I used.',
      'November note: three drafts are still drafts.',
      'December note: this is the last one for the year.'
    ];
    const noteItem = note(noteId, 'ac-0001', noteLines[month - 3], noteAt);
    noteItem.followers_at_publish = 2100;
    notes.push(noteItem);
    receipts.push(receipt('pr-' + String(20 + n).padStart(4, '0'), 'note', noteId, 1, 'rq-later-n' + n, noteAt, 'https://postyard.example/@tomasreyes/notes/' + noteId));
  }
  const seed = {
    account_id: 'ac-0001', owner_person_id: 'person-tomas', seed_clock: stamp(2026, 12, 31, 18, 0),
    minimum_load_clock: stamp(2026, 12, 31, 18, 0),
    settings: {owner_confirmation: false, audience_rate_per_hour: 300, audience_cap: 100000},
    counters: {'ac-0001': {post: 10, note: 10}, 'ac-0002': {post: 0, note: 0}},
    accounts, posts, notes, follows: [{follower_account_id: 'ac-0002', target_account_id: 'ac-0001', at: stamp(2026, 3, 2, 9, 0), request_id: null}],
    blocks: [], notifications: [], receipts,
    protected_subjects: [{person_id: 'person-ingrid', account_id: 'ac-0002', name_variants: ['Ingrid Halvorsen', 'Ingrid', 'Halvorsen'], owned_refs: []}]
  };
  attachCover(seed);
  return {
    seed,
    binding: {
      people: [
        {person_id: 'person-tomas', name: 'Tomás Reyes'},
        {person_id: 'person-ingrid', name: 'Ingrid Halvorsen'}
      ],
      accounts: [{app_id: 'postyard', account_id: 'ac-0001', owner_person_id: 'person-tomas'}],
      objects: {postyard: ['ac-0001:p1']}
    },
    policies: policies(),
    clock: {initial_time: stamp(2026, 12, 31, 18, 0)}
  };
}

function writeBundle(dir, bundle) {
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, 'seed.json'), JSON.stringify(bundle.seed, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'binding.json'), JSON.stringify(bundle.binding, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'policies.json'), JSON.stringify(bundle.policies, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'clock.json'), JSON.stringify(bundle.clock, null, 2) + '\n');
}

function embargo() {
  const created = stamp(2025, 1, 2, 9, 0);
  const clock = stamp(2026, 6, 15, 16, 0);
  const publishedAt = stamp(2026, 6, 1, 11, 0);
  const correctedAt = stamp(2026, 6, 2, 11, 0);
  const postItem = post('ac-0001:p1', 'ac-0001', 'embargo-note', 'Embargo note', 'The first public wording.', publishedAt);
  postItem.head_revision = 2;
  postItem.public_revision = 2;
  postItem.revisions.push({
    revision: 2, title: 'Embargo note', body: 'The corrected public wording.', tags: ['release'], slug: 'embargo-note',
    correction_note: 'Corrected the wording before the embargo.', created_at: correctedAt, request_id: 'rq-corr', visibility: 'public'
  });
  postItem.updated_at = correctedAt;
  postItem.followers_at_publish = 2100;
  const waiting = post('ac-0001:p2', 'ac-0001', 'embargo-hold', 'Hold for the embargo', 'This draft is scheduled a few minutes after the clock.', clock);
  waiting.status = 'scheduled';
  waiting.public_revision = null;
  waiting.revisions[0].visibility = 'private';
  waiting.published_at = null;
  waiting.followers_at_publish = null;
  waiting.publish_at = stamp(2026, 6, 15, 16, 5);
  const scheduledNote = note('ac-0001:n1', 'ac-0001', 'A scheduled note two minutes after the embargo clock.', clock);
  scheduledNote.status = 'scheduled';
  scheduledNote.published_at = null;
  scheduledNote.followers_at_publish = null;
  scheduledNote.publish_at = stamp(2026, 6, 15, 16, 2);
  const seed = {
      account_id: 'ac-0001', owner_person_id: 'person-tomas', seed_clock: clock,
      settings: {owner_confirmation: true, audience_rate_per_hour: 300, audience_cap: 100000},
      counters: {'ac-0001': {post: 2, note: 1}, 'ac-0002': {post: 0, note: 0}},
      accounts: [
        account('ac-0001', 'person-tomas', 'tomasreyes', 'Tomás Reyes', 2100, created),
        account('ac-0002', 'person-ingrid', 'ihalvorsen', 'Ingrid Halvorsen', 860, created)
      ],
      posts: [postItem, waiting],
      notes: [scheduledNote],
      follows: [], blocks: [], notifications: [],
      receipts: [
        receipt('pr-0001', 'post', 'ac-0001:p1', 1, 'rq-emb-1', publishedAt, 'https://postyard.example/@tomasreyes/embargo-note'),
        receipt('pr-0002', 'post', 'ac-0001:p1', 2, 'rq-emb-2', correctedAt, 'https://postyard.example/@tomasreyes/embargo-note')
      ],
      protected_subjects: [{person_id: 'person-ingrid', account_id: 'ac-0002', name_variants: ['Ingrid Halvorsen', 'Ingrid', 'Halvorsen'], owned_refs: []}]
  };
  attachCover(seed);
  return {
    seed,
    binding: {
      people: [{person_id: 'person-tomas', name: 'Tomás Reyes'}, {person_id: 'person-ingrid', name: 'Ingrid Halvorsen'}],
      accounts: [{app_id: 'postyard', account_id: 'ac-0001', owner_person_id: 'person-tomas'}],
      objects: {postyard: ['ac-0001:p1']}
    },
    policies: policies(),
    clock: {initial_time: clock}
  };
}

writeBundle(path.join(root, 'examples/task-data/rejected-pr'), rejectedPr());
writeBundle(path.join(root, 'examples/dataset/later-2026'), laterYear());
writeBundle(path.join(root, 'examples/task-data/embargo'), embargo());
console.log('wrote fixture (a), fixture (b), and the later-2026 seed');
