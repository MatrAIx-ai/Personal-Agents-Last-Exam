'use strict';
// Single authoring source for this App's own contracts: the seed/state data
// schema, the incoming-event schema and the business tool catalog. The JSON
// files under schemas/ and tools.json are generated from here by
// dev/generate-contracts.cjs and must not be edited by hand.
//
// Everything is emitted fully inlined (no $ref / $defs): Core embeds the seed
// and event schemas inside its own lifecycle schemas, where document-local
// references would not resolve, and Agents receive tool schemas as-is.

const APP = 'university-course-registration';

// ---- builders -------------------------------------------------------------
const obj = (properties, optional = []) => ({
  type: 'object',
  properties,
  required: Object.keys(properties).filter(key => !optional.includes(key)),
  additionalProperties: false
});
const arr = (items, extra = {}) => ({type: 'array', items, ...extra});
const text = (max = 200) => ({type: 'string', minLength: 1, maxLength: max});
const int = (minimum = 0, maximum) => ({type: 'integer', minimum, ...(maximum === undefined ? {} : {maximum})});
const nullable = schema => ({anyOf: [schema, {type: 'null'}]});
const bool = () => ({type: 'boolean'});
const one = value => ({const: value});
const any = (...values) => ({enum: values});
// Agent-facing explanation of one argument or result field.
const note = (schema, description) => ({...schema, description});

// ---- shared value shapes ----------------------------------------------------
const id = () => ({type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$'});
const courseCode = () => ({type: 'string', minLength: 2, maxLength: 20, pattern: '^[A-Z][A-Z0-9-]*$'});
const dateTime = () => ({type: 'string', format: 'date-time'});
const clockTime = () => ({type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$'});
const day = () => any('MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN');
const meeting = () => obj({
  days: arr(day(), {minItems: 1, maxItems: 7, uniqueItems: true}),
  start: clockTime(),
  end: clockTime()
});
const meetings = () => arr(meeting(), {maxItems: 10});
const timeWindow = () => obj({opens_at: dateTime(), closes_at: dateTime()});
const bundle = () => arr(id(), {minItems: 1, maxItems: 2, uniqueItems: true});
const sectionKind = () => any('lecture', 'lab');
const requestId = () => ({type: 'string', minLength: 1, maxLength: 100});

// Every write operation the App will offer; receipts name one of these.
const WRITE_ACTIONS = ['enrollment.enroll', 'enrollment.withdraw', 'enrollment.swap',
  'waitlist.join', 'waitlist.leave', 'offer.accept', 'offer.decline'];

// ---- records shared by the seed and by read results ---------------------------
const university = () => obj({id: id(), name: text(), timezone: text(64)});
const term = () => obj({
  id: id(),
  name: text(),
  registration: obj({opens_at: dateTime(), closes_at: dateTime(), withdraw_deadline: dateTime()})
});
// The rules this App implements, stated as data the Agent can read. Each rule
// field admits only the implemented value, so a seed cannot claim another policy.
const enrollmentPolicy = () => obj({
  id: id(),
  version: text(40),
  offer_window_minutes: int(1, 43200),
  queue: obj({
    order: one('join_sequence'),
    bundle: one('all_sections_or_none'),
    skipped_entries: one('keep_position_without_hold'),
    join: one('only_when_target_bundle_is_unavailable')
  }),
  expiry: obj({
    boundary: one('invalid_at_or_after_expires_at'),
    hold_release: one('on_offers_expire_event')
  }),
  swaps: obj({
    max_pending_per_enrollment: one(1),
    original: one('kept_until_replacement_commits')
  }),
  conflicts: obj({rule: one('no_new_conflicts')})
});
const completedCourse = () => obj({code: courseCode(), title: text(), credits: int(0, 30), term: text(40), grade: text(10)});
const notice = () => obj({
  id: id(),
  seq: int(1),
  at: dateTime(),
  kind: any('offer_issued', 'offer_expired', 'section_rescheduled', 'swap_cancelled'),
  text: text(500),
  refs: obj({
    event_id: id(), course_id: id(), section_id: id(), enrollment_id: id(), entry_id: id(), offer_id: id(),
    from_version: int(1), to_version: int(1), expires_at: dateTime()
  }, ['event_id', 'course_id', 'section_id', 'enrollment_id', 'entry_id', 'offer_id', 'from_version', 'to_version', 'expires_at'])
});
const receipt = () => obj({
  id: id(),
  seq: int(1),
  at: dateTime(),
  action: any(...WRITE_ACTIONS),
  request_id: requestId(),
  refs: obj({
    course_id: id(), enrollment_id: id(), replaced_enrollment_id: id(), entry_id: id(), offer_id: id(),
    section_ids: bundle(), cancelled_entry_ids: arr(id(), {maxItems: 50, uniqueItems: true}), existing: bool()
  }, ['course_id', 'enrollment_id', 'replaced_enrollment_id', 'entry_id', 'offer_id', 'section_ids', 'cancelled_entry_ids', 'existing'])
});

// ---- seed / runtime data -----------------------------------------------------
function seedSchema() {
  const course = obj({
    id: id(),
    code: courseCode(),
    title: text(),
    department: text(80),
    credits: int(0, 30),
    prerequisite_codes: arr(courseCode(), {maxItems: 20, uniqueItems: true}),
    requires_lab: bool(),
    registration_window: timeWindow()
  }, ['registration_window']);
  const section = obj({
    id: id(),
    course_id: id(),
    kind: sectionKind(),
    label: text(40),
    capacity: int(1, 5000),
    base_enrolled: int(0, 5000),
    linked_lecture_ids: arr(id(), {minItems: 1, maxItems: 20, uniqueItems: true}),
    meetings: meetings(),
    version: int(1),
    history: arr(obj({version: int(1), meetings: meetings(), replaced_at: dateTime(), event_id: id()}), {maxItems: 200})
  }, ['linked_lecture_ids']);
  const enrollment = obj({
    id: id(),
    seq: int(1),
    occupant_ref: id(),
    course_id: id(),
    section_ids: bundle(),
    status: any('enrolled', 'withdrawn', 'swapped_out'),
    enrolled_at: dateTime(),
    ended_at: nullable(dateTime())
  });
  const waitlistEntry = obj({
    id: id(),
    seq: int(1),
    occupant_ref: id(),
    course_id: id(),
    section_ids: bundle(),
    swap_from_enrollment_id: nullable(id()),
    status: any('queued', 'offered', 'fulfilled', 'left', 'declined', 'expired', 'cancelled'),
    joined_at: dateTime(),
    ended_at: nullable(dateTime()),
    end_reason: nullable(text(80)),
    blocked_reason: nullable(text(80))
  });
  const offer = obj({
    id: id(),
    seq: int(1),
    entry_id: id(),
    held_section_ids: bundle(),
    issued_at: dateTime(),
    expires_at: dateTime(),
    status: any('live', 'accepted', 'declined', 'expired', 'cancelled'),
    resolved_at: nullable(dateTime())
  });
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'University Course Registration: account, catalog and run records',
    description: 'One document is both the loadable seed and the live App data. Generated from dev/contracts.cjs.',
    ...obj({
      account_id: text(100),
      owner_person_id: text(100),
      university: university(),
      term: term(),
      enrollment_policy: enrollmentPolicy(),
      student: obj({
        id: id(),
        name: text(),
        program: text(),
        credit_limit: int(0, 60),
        completed_courses: arr(completedCourse(), {maxItems: 200})
      }),
      courses: arr(course, {maxItems: 500}),
      sections: arr(section, {maxItems: 2000}),
      enrollments: arr(enrollment, {maxItems: 20000}),
      waitlist_entries: arr(waitlistEntry, {maxItems: 20000}),
      offers: arr(offer, {maxItems: 20000}),
      notices: arr(notice(), {maxItems: 20000}),
      receipts: arr(receipt(), {maxItems: 20000}),
      counters: obj({next_seq: int(1)})
    })
  };
}

// ---- incoming Infra events ---------------------------------------------------
function eventsSchema() {
  const envelope = (operation, payload) => obj({
    event_id: requestId(),
    at: dateTime(),
    operation: one(APP + '.' + operation),
    payload
  });
  const occupancy = {
    anyOf: [
      obj({change: one('withdraw'), occupant_ref: id(), enrollment_id: id()}),
      obj({change: one('enroll'), occupant_ref: id(), section_ids: bundle(), enrollment_id: id()}, ['enrollment_id']),
      obj({change: one('waitlist_join'), occupant_ref: id(), section_ids: bundle(), entry_id: id()}, ['entry_id']),
      obj({change: one('waitlist_leave'), occupant_ref: id(), entry_id: id()}),
      obj({change: one('offer_accept'), occupant_ref: id(), offer_id: id()}),
      obj({change: one('offer_decline'), occupant_ref: id(), offer_id: id()})
    ]
  };
  return {
    title: 'University Course Registration: Infra events',
    description: 'Scenario events supplied by a Task and applied by Infra. Generated from dev/contracts.cjs.',
    type: 'object',
    anyOf: [
      envelope('occupancy.change', occupancy),
      envelope('section.reschedule', obj({section_id: id(), meetings: meetings()})),
      envelope('offers.expire', obj({}))
    ]
  };
}

// ---- business tools ----------------------------------------------------------
const version = () => obj({epoch: int(1), revision: int(0)});
const failure = () => obj({
  status: {type: 'string'},
  message: {type: 'string'},
  applied: one(false),
  version: version(),
  current_version: version()
}, ['current_version']);
const result = (properties, optional = []) => ({
  type: 'object',
  anyOf: [
    obj({status: any('ok', 'committed'), app_id: one(APP), version: version(), duplicate: bool(), ...properties},
      ['duplicate', ...optional]),
    failure()
  ]
});
const readInput = (properties = {}, optional = Object.keys(properties)) => obj(properties, optional);
const writeInput = (properties, optional = []) => obj({
  ...properties,
  expected_version: note(version(), 'The version returned by your most recent read or preview of this App. A write based on an older version is refused with stale_version.'),
  request_id: note(requestId(), 'A new identifier for this request. Reuse it only to retry the identical request; the original result is then returned and nothing is applied twice.')
}, optional);

const sectionView = () => obj({
  id: id(),
  kind: sectionKind(),
  label: text(40),
  meetings: meetings(),
  capacity: int(1),
  enrolled: note(int(0), 'Seats taken by enrolled students.'),
  held: note(int(0), 'Seats reserved by pending waitlist offers; not enrollments, and not available to anyone else until released.'),
  available: note(int(0), 'capacity - enrolled - held.'),
  version: note(int(1), 'Increases each time this section\'s meeting times change.'),
  linked_lecture_ids: note(arr(id(), {uniqueItems: true}), 'Present on a lab that can only be combined with these lecture sections. Absent: any lecture of the course.')
}, ['linked_lecture_ids']);
const courseView = () => obj({
  id: id(),
  code: courseCode(),
  title: text(),
  department: text(80),
  credits: int(0),
  requires_lab: bool(),
  prerequisite_codes: arr(courseCode()),
  sections: arr(sectionView())
});
const creditView = () => obj({
  enrolled: note(int(0), 'Credits of all currently enrolled courses. Waitlist entries and offers do not count.'),
  limit: note(int(0), 'The student\'s credit limit for the term.')
});
const sectionPairs = () => arr(arr(id(), {minItems: 2, maxItems: 2}));
// One rule that a proposed change fails. The same codes are returned as the
// status of a rejected write.
const ruleFailure = () => obj({
  code: note(text(60), 'not_found, invalid_state, offer_not_live, offer_expired, invalid_bundle, withdrawal_closed, registration_closed, '
    + 'swap_required, pending_swap_exists, duplicate_enrollment, prerequisite_missing, seats_available, section_full, '
    + 'credit_limit_exceeded or time_conflict.'),
  message: text(1000),
  missing_prerequisites: arr(courseCode()),
  full_section_ids: arr(id()),
  conflicts: sectionPairs(),
  offer_id: note(id(), 'With section_full: the student\'s own live offer that is holding a seat in one of the full sections. Accept that offer to use the seat.')
}, ['missing_prerequisites', 'full_section_ids', 'conflicts', 'offer_id']);
const cancelledEntries = () => note(arr(id()), 'Pending swaps that were tied to the enrollment given up and are therefore cancelled.');

function tools() {
  const tool = (name, read_only, description, inputSchema, outputSchema) => ({
    name: APP + '.' + name,
    description,
    scope: APP + (read_only ? '.read' : '.write'),
    resource_target: 'current account',
    read_only,
    inputSchema,
    outputSchema
  });
  const writeHint = ' Pass the version returned by your latest read or preview as expected_version and a new request_id; '
    + 'retrying with the same request_id and arguments is safe.';
  return [
    tool('catalog.search', true,
      'Search this term\'s course catalog. Returns each matching course with all of its sections: meeting times, '
      + 'capacity, seats taken by enrolled students, seats held by pending waitlist offers, seats available, credits '
      + 'and prerequisite course codes. A course that requires a lab must be taken as one lecture plus one lab. '
      + 'Filters are optional and combine with AND. Read only.',
      readInput({
        term_id: note(id(), 'Term to search. Optional: this portal serves a single term.'),
        query: note(text(100), 'Case-insensitive text matched against the course code, title and department.'),
        department: note(text(80), 'Exact department name, case-insensitive, for example "Mathematics".'),
        days: note(arr(day(), {minItems: 1, maxItems: 7, uniqueItems: true}),
          'Keep only courses that can be taken entirely on these days: at least one complete lecture/lab bundle meets on no other day.'),
        open_only: note(bool(),
          'When true, keep only courses with at least one complete lecture/lab bundle in which every section has a seat available. '
          + 'A free lecture whose only labs are full does not count.')
      }),
      result({term: obj({id: id(), name: text()}), courses: arr(courseView())})),

    tool('course.get', true,
      'Read one course: its sections with seats, which lecture/lab combinations form a valid bundle and whether each is '
      + 'currently available, the prerequisite courses and whether the signed-in student has completed each, the '
      + 'registration window and whether it is open now, and the student\'s current enrollment in the course if any. Read only.',
      readInput({id: note(id(), 'The course ID, for example the id returned by catalog.search (not the course code).')}, []),
      result({
        course: courseView(),
        prerequisites: arr(obj({code: courseCode(), completed: note(bool(), 'Whether the student\'s academic record lists this course as completed.')})),
        registration: obj({
          opens_at: dateTime(),
          closes_at: note(dateTime(), 'Registration is closed at and after this instant.'),
          open: note(bool(), 'Whether registration for this course is open at the current time.')
        }),
        bundles: arr(obj({
          section_ids: bundle(),
          available: note(bool(), 'True when every section of this lecture/lab combination has a seat available.')
        })),
        enrollment_id: note(nullable(id()), 'The student\'s current enrollment in this course, or null.')
      })),

    tool('record.get', true,
      'Read the signed-in student\'s academic record and the rules that apply: completed courses, enrolled credits and '
      + 'the credit limit, the term\'s registration window, the withdrawal deadline and whether an enrollment can still '
      + 'be given up now, and the enrollment policy (queue order, offer window, expiry boundary, swap and conflict rules). '
      + 'The record cannot be changed through this App. Read only.',
      readInput(),
      result({
        student: obj({id: id(), name: text(), program: text()}),
        completed_courses: arr(completedCourse()),
        credits: creditView(),
        university: university(),
        term: term(),
        withdrawal: obj({
          deadline: note(dateTime(), 'An enrollment cannot be given up, by withdrawing or by swapping out of it, at or after this instant.'),
          open: note(bool(), 'Whether an enrollment can still be given up at the current time.')
        }),
        enrollment_policy: enrollmentPolicy()
      })),

    tool('schedule.get', true,
      'Read the signed-in student\'s current schedule: each enrollment with its sections and meeting times, enrolled '
      + 'credits, every pair of sections whose meeting times overlap and the meeting-time change that caused it when '
      + 'there was one, and pending swaps waiting for a seat. Waitlist entries and offers are not enrollments and are '
      + 'not part of the schedule. Read only.',
      readInput(),
      result({
        enrollments: arr(obj({
          id: id(), course_id: id(), code: courseCode(), title: text(), credits: int(0), enrolled_at: dateTime(),
          sections: arr(obj({id: id(), kind: sectionKind(), label: text(40), meetings: meetings(), version: int(1)}))
        })),
        credits: creditView(),
        conflicts: arr(obj({
          section_ids: arr(id(), {minItems: 2, maxItems: 2}),
          caused_by: note(nullable(obj({
            event_id: id(), section_id: id(), replaced_at: dateTime(), from_version: int(1), to_version: int(1)
          })), 'The meeting-time change that produced this overlap, or null when the overlap does not come from such a change.')
        })),
        pending_swaps: arr(obj({
          entry_id: id(), from_enrollment_id: id(), course_id: id(), section_ids: bundle(), status: any('queued', 'offered')
        }))
      })),

    tool('waitlist.list', true,
      'Read the signed-in student\'s own waitlist entries and seat offers. Each entry shows its rank among entries '
      + 'waiting for the same seats, the sections it is still waiting for, and any rule that currently blocks it from '
      + 'receiving or accepting an offer. Each offer shows when it expires. A waitlist position or an offer is not an '
      + 'enrollment. Other students\' entries are not shown. Read only.',
      readInput(),
      result({
        entries: arr(obj({
          id: id(), course_id: id(), code: courseCode(), section_ids: bundle(),
          swap_from_enrollment_id: note(nullable(id()), 'The enrollment this entry would replace when it is a pending swap; otherwise null.'),
          status: any('queued', 'offered'),
          joined_at: dateTime(),
          rank: note(int(1), '1 means no earlier entry is waiting for any of the same seats.'),
          waiting_for_section_ids: note(arr(id()), 'Sections of the bundle that have no seat for this entry right now.'),
          blocked_by: note(arr(ruleFailure()), 'Rules other than seat availability that this entry fails right now. A blocked entry keeps its place but holds no seat.')
        })),
        offers: arr(obj({
          id: id(), entry_id: id(), course_id: id(), held_section_ids: bundle(), issued_at: dateTime(),
          expires_at: note(dateTime(), 'The offer cannot be accepted at or after this instant.'),
          expired: note(bool(), 'True when the current time has reached expires_at. The held seats are released only when the expiry is processed.')
        }))
      })),

    tool('activity.list', true,
      'Read the signed-in student\'s notices (seat offers, expiries, meeting-time changes, cancelled swaps) and the '
      + 'receipts of every committed write, oldest first. A notice informs; it never accepts an offer or changes an '
      + 'enrollment by itself. Read only.',
      readInput(),
      result({notices: arr(notice()), receipts: arr(receipt())})),

    tool('change.preview', true,
      'Preview one change without making it: enrolling in a bundle, withdrawing from an enrollment, swapping an '
      + 'enrollment for another bundle, or accepting a seat offer. Returns whether it would be allowed now, every rule it fails, the credits and '
      + 'schedule that would result, the time conflicts it would introduce or resolve, and any pending swap it would '
      + 'cancel. Nothing is stored. The returned version is the state the preview was computed from: use it as '
      + 'expected_version for the write, which re-checks everything and is refused if the state has changed. Read only.',
      readInput({
        action: note(any('enroll', 'withdraw', 'swap', 'accept_offer'),
          'enroll takes section_ids; withdraw takes id; swap takes id and section_ids; accept_offer takes id (the offer).'),
        id: note(id(), 'The enrollment to withdraw from or to replace, or the offer to accept. Not used for enroll.'),
        section_ids: note(bundle(), 'The target bundle for enroll or swap: the lecture section ID, plus one lab section ID when the course requires a lab.')
      }, ['id', 'section_ids']),
      result({
        action: any('enroll', 'withdraw', 'swap', 'accept_offer'),
        allowed: bool(),
        failures: arr(ruleFailure()),
        credits: obj({current: int(0), resulting: int(0), limit: int(0)}),
        schedule: note(arr(obj({course_id: id(), code: courseCode(), section_ids: bundle(), change: any('kept', 'added', 'removed')})),
          'The schedule after the change: enrollments kept, the bundle added and the enrollment removed.'),
        conflicts: obj({current: sectionPairs(), resulting: sectionPairs(), introduced: sectionPairs(), resolved: sectionPairs()}),
        cancelled_entry_ids: cancelledEntries()
      })),

    tool('enrollment.enroll', false,
      'Enroll the signed-in student in one lecture/lab bundle: the lecture section plus one lab section when the '
      + 'course requires a lab. Nothing changes and an error status is returned if the bundle is invalid, registration '
      + 'is closed, the student is already enrolled in the course, a prerequisite is missing, any section is full, the '
      + 'credit limit would be exceeded or a new time conflict would result.' + writeHint,
      writeInput({section_ids: note(bundle(), 'The bundle to enroll in: the lecture section ID, plus one lab section ID when the course requires a lab.')}),
      result({id: note(id(), 'The new enrollment.'), receipt_id: id(), course_id: id(), section_ids: bundle(), credits: creditView()})),

    tool('enrollment.withdraw', false,
      'Withdraw the signed-in student from one of their enrollments. The seats of the whole bundle are released. A '
      + 'pending swap that was waiting to replace this enrollment is cancelled, not turned into an enrollment. Nothing '
      + 'changes and an error status is returned if the enrollment is not held by this student or the withdrawal '
      + 'deadline has passed.' + writeHint,
      writeInput({id: note(id(), 'The enrollment to withdraw from, as listed by schedule.get.')}),
      result({id: note(id(), 'The enrollment that was withdrawn.'), receipt_id: id(), course_id: id(), section_ids: bundle(),
        cancelled_entry_ids: cancelledEntries(), credits: creditView()})),

    tool('enrollment.swap', false,
      'Replace one of the signed-in student\'s enrollments with another bundle that is available now, in one step: '
      + 'the new bundle is taken and the old one given up together, or nothing changes. Use it to change sections of '
      + 'the same course or to move to a different course. A seat in a section shared by both bundles is kept, so only '
      + 'the other sections need a free seat. Eligibility is judged on the schedule with the old bundle replaced. On any '
      + 'failure the original enrollment is kept.' + writeHint,
      writeInput({
        id: note(id(), 'The enrollment to replace, as listed by schedule.get.'),
        section_ids: note(bundle(), 'The bundle to move to: the lecture section ID, plus one lab section ID when the course requires a lab.')
      }),
      result({id: note(id(), 'The new enrollment.'), replaced_id: note(id(), 'The enrollment that was given up.'), receipt_id: id(),
        course_id: id(), section_ids: bundle(), cancelled_entry_ids: cancelledEntries(), credits: creditView()})),

    tool('waitlist.join', false,
      'Join the waitlist for one lecture/lab bundle that has no seat for the signed-in student right now. Optionally name '
      + 'one of the student\'s enrollments to swap from: the entry then waits to replace that enrollment, which is kept '
      + 'until the replacement commits. A waitlist entry is not an enrollment and counts toward neither credits nor the '
      + 'timetable. When seats become available, entries are served in the order they joined: an eligible entry receives '
      + 'a time-limited offer, and an entry that fails a rule at that moment keeps its place, holds no seat and shows '
      + 'what blocks it. Joining again for the same bundle returns the existing entry with its rank unchanged. Refused '
      + 'with seats_available when every section the entry would newly occupy has a seat (enroll or swap directly), with '
      + 'swap_required when the student is already enrolled in the course and names no enrollment to swap from, and with '
      + 'pending_swap_exists when that enrollment already has a pending swap.' + writeHint,
      writeInput({
        section_ids: note(bundle(), 'The bundle to wait for: the lecture section ID, plus one lab section ID when the course requires a lab.'),
        swap_from_enrollment_id: note(nullable(id()), 'Optional. One of the student\'s current enrollments, as listed by schedule.get, that this entry '
          + 'should replace once a seat is offered and accepted. Omit it, or pass null, for an entry that is not a swap.')
      }, ['swap_from_enrollment_id']),
      result({
        id: note(id(), 'The waitlist entry.'), receipt_id: id(), course_id: id(), section_ids: bundle(),
        swap_from_enrollment_id: note(nullable(id()), 'The enrollment this entry would replace, or null for a plain entry.'),
        existing: note(bool(), 'True when the student was already waiting for this bundle: the entry and its rank are unchanged.'),
        rank: note(int(1), '1 means no earlier entry is waiting for any of the same seats.'),
        waiting_for_section_ids: note(arr(id()), 'Sections of the bundle that have no seat for this entry right now.'),
        blocked_by: note(arr(ruleFailure()), 'Rules other than seat availability that this entry fails right now. A blocked entry keeps its place but holds no seat.')
      })),

    tool('waitlist.leave', false,
      'Leave the waitlist: remove one of the signed-in student\'s waiting entries. A seat offer made to the entry is '
      + 'cancelled and its held seats are released. When the entry was a pending swap, the swap is dropped and the '
      + 'original enrollment is kept unchanged.' + writeHint,
      writeInput({id: note(id(), 'The waitlist entry to leave, as listed by waitlist.list.')}),
      result({id: note(id(), 'The waitlist entry that left the queue.'), receipt_id: id(), course_id: id(), section_ids: bundle(),
        cancelled_offer_id: note(nullable(id()), 'The seat offer that was cancelled with the entry, or null.')})),

    tool('offer.accept', false,
      'Accept a seat offer made to one of the signed-in student\'s waitlist entries. All rules are checked again on the '
      + 'schedule that would result. A plain entry becomes an enrollment; a pending swap gives up its original '
      + 'enrollment and takes the new bundle together. Refused with offer_expired at or after the offer\'s expires_at, '
      + 'and with offer_not_live when the offer was already accepted, declined, cancelled or expired. On any failure '
      + 'nothing changes: the original enrollment is kept, and an offer that is still live stays held until it is '
      + 'accepted, declined, cancelled or expired.' + writeHint,
      writeInput({id: note(id(), 'The offer to accept, as listed by waitlist.list (not the waitlist entry).')}),
      result({id: note(id(), 'The new enrollment.'), receipt_id: id(), offer_id: id(), entry_id: id(), course_id: id(), section_ids: bundle(),
        replaced_id: note(nullable(id()), 'The enrollment given up when the offer fulfilled a pending swap; otherwise null.'), credits: creditView()})),

    tool('offer.decline', false,
      'Decline a seat offer made to one of the signed-in student\'s waitlist entries. The offer is closed, its held '
      + 'seats are released and the entry leaves the queue. An original enrollment the entry would have replaced is kept.' + writeHint,
      writeInput({id: note(id(), 'The offer to decline, as listed by waitlist.list (not the waitlist entry).')}),
      result({id: note(id(), 'The offer that was declined.'), receipt_id: id(), entry_id: id(), course_id: id(), section_ids: bundle()}))
  ];
}

module.exports = {APP, WRITE_ACTIONS, seedSchema, eventsSchema, tools};
