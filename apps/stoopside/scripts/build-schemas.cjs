#!/usr/bin/env node
'use strict';
// Generates schemas/seed.schema.json, schemas/events.schema.json and tools.json
// from the compact definitions below. Run after changing them; `--check` fails
// if a generated file differs (the business tests run the check).
const fs = require('node:fs');
const path = require('node:path');

const ID = {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
const TIME = {type: 'string', format: 'date-time'};
const BOOL = {type: 'boolean'};
const OBJECT = {type: 'object'};
const str = (min, max) => ({type: 'string', minLength: min, maxLength: max});
const int = (min, max) => ({type: 'integer', minimum: min, maximum: max});
const nullable = s => ({anyOf: [s, {type: 'null'}]});
const one = (...values) => ({enum: values});
const arr = (items, max = 2000, min) => ({type: 'array', items, ...(min ? {minItems: min} : {}), maxItems: max});
const obj = (properties, required = Object.keys(properties)) => ({type: 'object', properties, required, additionalProperties: false});

const ROLE = one('member', 'event_host', 'co_organizer', 'organizer');
const AUDIENCE = one('group', 'event_guests', 'hosts_only');
const ANSWER = one('yes', 'no', 'waitlist', 'offered', 'expired', 'needs_reconfirm');
const REASON = str(1, 60);

// ---- Seed ------------------------------------------------------------------

const seed = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Stoopside account, community groups and their committed history',
  ...obj({
    account_id: ID,
    owner_person_id: ID,
    user_member_id: ID,
    next_seq: int(1, 1000000000),
    groups: arr(obj({
      id: ID, name: str(1, 200), description: str(0, 2000), utc_offset: {type: 'string', pattern: '^[+-]\\d{2}:\\d{2}$'},
      tz_label: str(1, 10), requires_approval: BOOL, hide_from_member_list: BOOL, hide_rsvps: BOOL,
      created_at: TIME, digest_through: TIME,
    }), 100),
    members: arr(obj({
      id: ID, display_name: str(1, 100), bio: str(0, 1000),
      email: {type: 'string', pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', maxLength: 200}, person_id: ID, created_at: TIME,
    }), 5000),
    memberships: arr(obj({
      id: ID, group_id: ID, member_id: ID, state: one('pending', 'member', 'declined', 'left', 'removed'), role: ROLE,
      created_at: TIME,
      revisions: arr(obj({seq: int(0, 1000000000), at: TIME, state: one('pending', 'member', 'declined', 'left', 'removed'), role: ROLE, reason: REASON}), 500, 1),
    }), 20000),
    events: arr(obj({
      id: ID, group_id: ID, title: str(1, 200), description: str(0, 4000), start: TIME, end: TIME, venue: str(1, 200),
      capacity: int(1, 10000), guest_limit: int(0, 20), rsvp_open: TIME, rsvp_close: TIME,
      host_member_ids: arr(ID, 20, 1), state: one('published', 'cancelled'), created_by: ID, created_at: TIME,
      revisions: arr(obj({seq: int(0, 1000000000), at: TIME, action: one('created', 'edited', 'cancelled'), state: one('published', 'cancelled'),
        fields: OBJECT, notify: nullable(one('guests', 'group')), actor: ID, previous: OBJECT},
      ['seq', 'at', 'action', 'state', 'fields', 'notify', 'actor']), 500, 1),
    }), 5000),
    rsvps: arr(obj({
      id: ID, event_id: ID, member_id: ID, answer: ANSWER, guests: int(0, 20), children: int(0, 20),
      created_at: TIME, updated_at: TIME, waitlisted_at: nullable(TIME), offer_expires_at: nullable(TIME), reconfirm_by: nullable(TIME),
      revisions: arr(obj({seq: int(0, 1000000000), at: TIME, answer: ANSWER, guests: int(0, 20), children: int(0, 20), reason: REASON}), 500, 1),
    }), 50000),
    posts: arr(obj({
      id: ID, group_id: ID, kind: one('post', 'comment', 'announcement'), audience: AUDIENCE, event_id: nullable(ID),
      parent_id: nullable(ID), author_member_id: ID, text: str(1, 5000), state: one('published', 'edited', 'deleted'),
      created_at: TIME, updated_at: TIME,
      revisions: arr(obj({seq: int(0, 1000000000), at: TIME, state: one('published', 'edited', 'deleted'), text: str(1, 5000)}), 500, 1),
    }), 20000),
    digests: arr(obj({id: ID, group_id: ID, due_at: TIME, post_ids: arr(ID, 1000)}), 5000),
    sheets: arr(obj({
      id: ID, event_id: ID, title: str(1, 200), lock_at: TIME,
      slots: arr(obj({id: ID, label: str(1, 100), quantity: int(1, 100), claims: arr(ID, 100)}), 50, 1),
      revisions: arr(obj({seq: int(0, 1000000000), at: TIME, action: one('claim', 'release', 'swap'), slot_id: ID, member_id: ID, reason: REASON}), 5000),
    }), 1000),
    swaps: arr(obj({
      id: ID, sheet_id: ID, from_member_id: ID, to_member_id: ID, give_slot: ID, want_slot: ID,
      state: one('proposed', 'accepted', 'declined', 'withdrawn', 'expired'), proposed_at: TIME, expires_at: TIME, decided_at: nullable(TIME),
    }), 5000),
    deliveries: arr(obj({
      id: ID, seq: int(0, 1000000000), at: TIME, recipient_member_id: ID,
      object_type: one('post', 'event', 'rsvp', 'digest', 'swap', 'membership'), object_id: ID,
      channel: one('email', 'in_app'), reason: REASON,
    }), 100000),
    previews: arr(obj({
      id: ID, kind: one('event', 'rsvp', 'post'), created_at: TIME, expires_at: TIME, consumed_at: nullable(TIME),
      request: OBJECT, basis: str(0, 500000), summary: OBJECT,
    }), 5000),
    notices: arr(obj({
      id: ID, kind: str(1, 40), created_at: TIME, object_type: str(1, 40), object_id: ID,
      message: {$ref: 'router-message.schema.json'},
    }), 5000),
  }),
};

// ---- Scenario events -------------------------------------------------------------

const EVENTS = {
  'member.joined': obj({group_id: ID, member_id: ID, display_name: str(1, 100)}, ['group_id', 'member_id']),
  'member.removed': obj({group_id: ID, member_id: ID}),
  'membership.decided': obj({group_id: ID, decision: one('member', 'declined')}),
  'rsvp.changed_by_other': obj({event_id: ID, member_id: ID, answer: one('yes', 'no'), guests: int(0, 20), children: int(0, 20)}),
  'event.changed_by_cohost': obj({
    event_id: ID, change: one('edit', 'cancel'), member_id: ID, notify: one('guests', 'group'),
    title: str(1, 200), description: str(0, 4000), start: TIME, end: TIME, venue: str(1, 200), capacity: int(1, 10000),
    guest_limit: int(0, 20), rsvp_open: TIME, rsvp_close: TIME,
  }, ['event_id', 'change']),
  'signup.claimed_by_other': obj({sheet_id: ID, slot_id: ID, member_id: ID}),
  'signup.released_by_other': obj({sheet_id: ID, slot_id: ID, member_id: ID}),
  'swap.proposed_by_other': obj({swap_id: ID, sheet_id: ID, from_member: ID, give_slot: ID, want_slot: ID}),
  'swap.answered': obj({swap_id: ID, answer: one('accepted', 'declined')}),
  'post.created_by_other': obj({
    post_id: ID, group_id: ID, member_id: ID, kind: one('post', 'comment', 'announcement'), audience: AUDIENCE,
    event_ref: ID, parent_id: ID, text: str(1, 5000),
  }, ['post_id', 'group_id', 'member_id', 'kind', 'text']),
};

const events = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Stoopside scenario events',
  oneOf: Object.entries(EVENTS).map(([op, payload]) => obj({event_id: ID, at: TIME, operation: {const: 'stoopside.' + op}, payload})),
};

// ---- Tools -------------------------------------------------------------------

const VERSION = obj({epoch: int(1, 1000000000), revision: int(0, 1000000000)});
const LIST = arr(OBJECT, 5000);
const TOOLS = [
  ['groups.list', true, 'List every group (discovery) with your membership state and role. Optional substring query on name and description.',
    {query: str(0, 200)}, [], {groups: LIST}],
  ['groups.get', true, 'One group: privacy flags, your membership, its organizers and hosts, and (for members) upcoming events.',
    {group_id: ID}, ['group_id'], {group: OBJECT, hosts: LIST, upcoming_events: LIST}],
  ['groups.join', false, 'Join a group. Groups that require approval record a pending request (approval_pending if one is already waiting).',
    {group_id: ID}, ['group_id'], {membership: OBJECT}],
  ['groups.leave', false, 'Leave a group or withdraw a pending request. Leaving sets your upcoming RSVPs in the group to no and releases your sign-up slots (sole_organizer, sole_host).',
    {group_id: ID}, ['group_id'], {membership: OBJECT, released: OBJECT}],
  ['members.search', true, 'Search a group\'s members by part of a display name or bio. Shows member ID, display name, bio and role, never emails. Groups with hide_from_member_list allow this only to organizers and co-organizers.',
    {group_id: ID, query: str(0, 200)}, ['group_id', 'query'], {members: LIST}],
  ['members.export', true, 'Co-organizers and organizers: every member of a group with email address and member-since date (role_required otherwise).',
    {group_id: ID}, ['group_id'], {group_id: ID, members: LIST}],
  ['profile.get', true, 'Your own profile and memberships.', {}, [], {profile: OBJECT, memberships: LIST}],
  ['profile.update', false, 'Change your display name or bio.', {display_name: str(1, 100), bio: str(0, 1000)}, [], {profile: OBJECT}],
  ['events.list', true, 'Events in your groups, soonest first, with places taken and free, waitlist size and your RSVP. Past events only with include_past.',
    {group_id: ID, include_past: BOOL}, [], {events: LIST}],
  ['events.get', true, 'One event with your RSVP, its change history, sign-up sheets and (unless hide_rsvps hides it from you) the guest list.',
    {event_id: ID}, ['event_id'], {event: OBJECT}],
  ['events.preview_change', false, 'Preview creating (change=create, group_id, fields), editing (change=edit, event_id, fields, notify) or cancelling (change=cancel, event_id) an event. Lists who will be notified and which RSVPs must reconfirm. Changing date, time or venue needs notify: guests or group. Expires after 15 minutes.',
    {change: one('create', 'edit', 'cancel'), group_id: ID, event_id: ID, notify: one('guests', 'group'),
      fields: obj({title: str(1, 200), description: str(0, 4000), start: TIME, end: TIME, venue: str(1, 200), capacity: int(1, 10000),
        guest_limit: int(0, 20), rsvp_open: TIME, rsvp_close: TIME}, [])}, ['change'], {preview: OBJECT}],
  ['events.confirm_change', false, 'Confirm an event preview. Fails preview_expired after 15 minutes and preview_stale if anything it read has changed.',
    {preview_id: ID}, ['preview_id'], {event: OBJECT, receipt: OBJECT}],
  ['rsvps.preview', false, 'Preview an RSVP (answer yes or no) with guest and child counts. Counts you leave out are pre-filled from your latest RSVP in that group; the preview shows which RSVP and when. Shows whether you get a place or go on the waitlist. Also claims an offered place or reconfirms a held one. Expires after 15 minutes.',
    {event_id: ID, answer: one('yes', 'no'), guests: int(0, 20), children: int(0, 20), rejoin_waitlist: BOOL}, ['event_id', 'answer'], {preview: OBJECT}],
  ['rsvps.confirm', false, 'Confirm an RSVP preview and get a receipt (also sent to your Mail).',
    {preview_id: ID}, ['preview_id'], {rsvp: OBJECT, receipt: OBJECT}],
  ['posts.list', true, 'Posts, comments and announcements in a group that you can see now, oldest first. Optional event_id filter.',
    {group_id: ID, event_id: ID}, ['group_id'], {posts: LIST}],
  ['posts.preview', false, 'Preview a post, comment, announcement or edit. Posts and announcements need an audience (group, event_guests with event_id, or hosts_only); comments take parent_id and use its audience; edit_of edits your own post\'s text. Lists every member who will be notified. Expires after 15 minutes.',
    {group_id: ID, kind: one('post', 'comment', 'announcement'), audience: AUDIENCE, event_id: ID, parent_id: ID, edit_of: ID, text: str(1, 5000)},
    ['group_id', 'kind', 'text'], {preview: OBJECT}],
  ['posts.publish', false, 'Publish a post preview. Publishing notifies the listed members; nothing delivered can be recalled.',
    {preview_id: ID}, ['preview_id'], {post: OBJECT, receipt: OBJECT}],
  ['posts.delete', false, 'Delete a post (author, co-organizers and organizers). Hides it from now on; recalls nothing already delivered. Announcements and posts on past or cancelled events are locked.',
    {post_id: ID}, ['post_id'], {post: OBJECT}],
  ['signups.get', true, 'A sign-up sheet: slots, who holds them, your claims, lock time and swaps involving you.',
    {sheet_id: ID}, ['sheet_id'], {sheet: OBJECT, swaps: LIST}],
  ['signups.claim', false, 'Claim one unit of a slot before the sheet locks (slot_taken, sheet_locked).',
    {sheet_id: ID, slot_id: ID}, ['sheet_id', 'slot_id'], {sheet: OBJECT}],
  ['signups.release', false, 'Release your claim on a slot before the sheet locks (not_your_slot, swap_pending).',
    {sheet_id: ID, slot_id: ID}, ['sheet_id', 'slot_id'], {sheet: OBJECT}],
  ['signups.swap_propose', false, 'Offer your claim on give_slot for another member\'s claim on want_slot. They must accept; it expires after 48 hours or at the lock.',
    {sheet_id: ID, give_slot: ID, want_slot: ID, member_id: ID}, ['sheet_id', 'give_slot', 'want_slot', 'member_id'], {swap: OBJECT}],
  ['signups.swap_answer', false, 'Accept or decline a swap offered to you, or withdraw one you proposed. Accepting exchanges the two claims.',
    {swap_id: ID, answer: one('accept', 'decline', 'withdraw')}, ['swap_id', 'answer'], {swap: OBJECT, sheet: OBJECT}],
  ['visibility.view_as', true, 'Show a group, event, post or sheet as a named member can see it now. Not what was already delivered to them. Objects you cannot see are not_found.',
    {member_id: ID, object_type: one('group', 'event', 'post', 'sheet'), object_id: ID}, ['member_id', 'object_type', 'object_id'],
    {member: OBJECT, object_type: str(1, 20), object_id: ID, visible: BOOL, view: nullable(OBJECT), as_of: TIME, note: str(0, 500)}],
  ['help.get', true, 'Stoopside\'s rules: time and deadlines, groups, events and RSVPs, posts, sign-up sheets and visibility.',
    {topic: one('time', 'groups', 'events', 'posts', 'signups', 'visibility')}, [], {topics: LIST}],
];

const tools = TOOLS.map(([op, read, description, input, required, output]) => ({
  name: 'stoopside.' + op,
  description,
  read_only: read,
  scope: 'stoopside.' + op,
  resource_target: 'current account',
  inputSchema: read ? obj(input, required) : obj({expected_version: VERSION, request_id: str(1, 100), ...input}, ['expected_version', 'request_id', ...required]),
  outputSchema: obj({status: {const: read ? 'ok' : 'committed'}, app_id: {const: 'stoopside'}, version: VERSION, ...output}),
}));

const root = path.resolve(__dirname, '..');
const outputs = {'schemas/seed.schema.json': seed, 'schemas/events.schema.json': events, 'tools.json': tools};
function build({check = false} = {}) {
  for (const [file, value] of Object.entries(outputs)) {
    const text = JSON.stringify(value, null, 2) + '\n', target = path.join(root, file);
    if (check) {
      if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) throw new Error('Generated file is out of date: ' + file);
    } else fs.writeFileSync(target, text);
  }
}
module.exports = {build, EVENTS, TOOLS};
if (require.main === module) {
  build({check: process.argv.includes('--check')});
  console.log(process.argv.includes('--check') ? 'Generated schemas and tools.json are current.' : 'Wrote schemas/seed.schema.json, schemas/events.schema.json and tools.json.');
}
