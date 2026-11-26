# Building Tasks on Tutorwell

For Task authors and graders. Tutorwell holds one student's account at a university tutoring and writing centre: the centre's settings, services, skills, tutors and open slots, and the student's appointments with their intakes, the tutors' session reports and their follow-ups, and the student's accommodations with their consents. A good Tutorwell task is one where the right help depends on this student: what the latest report says to work on, what a cancellation would cost given their history, what they have actually done, and what they have agreed to share. Tutorwell enforces the centre's rules (`centre-rules/1`); the Task decides what success means, from state.

## 1. Write the student's data

A seed follows `schemas/seed.schema.json`; `fixtures/minimal.json` is the proposal's small example. To start from a realistic student, copy one of the full fixtures in `fixtures/students/` and load it with its `binding.json` and `bundle: {dataset, catalog, blobs: {}}`; their sources are `fixtures/centre.json` and `fixtures/profiles/`. Without a bundle, Core records the data as an unidentified import that needs review. If your Task changes a fixture, say how in the copy's `dataset.json` (`transformations`) and update `expected_counts.records`. `scripts/build-scenarios.cjs` shows this end to end for the reference scenarios.

- **Centre:** `settings` as a history of entries (the latest at or before a time is in force; every booking, cancellation and outcome needs one), `services` (the writing centre has `requires_draft`), `skills` of a service, `tutors` with the skills of their own service and their modes, and `slots` of a tutor (a mode the tutor offers, no overlap with the tutor's other slots, `withdrawn_at` before the start).
- **Student:** `accommodations` with `consent_to_share`; `appointments` with the slot, `booked_at`, the intake (skills, questions, item references, type of work, a draft reference for the writing centre, whether to share accommodations), the stored status (`booked`, `cancelled`, `late_cancel`, `cancelled_by_centre`) and an outcome (`completed` or `no_show`, with when it was recorded) only for a booked appointment whose session has started.
- **Consistency:** a cancellation's status must match the cutoff in force when it was made; a centre cancellation is dated at its slot's withdrawal; at most one booked appointment per slot; a report belongs to a completed appointment and is posted after the outcome is recorded; a follow-up is done exactly when it has `done_at` and `done_by`.
- **Time:** past records (settings, bookings, cancellations, outcomes, reports, completed follow-ups, log entries) cannot be after the run's `virtual_now`; slot starts and due dates may be later.
- **Evaluator data:** an empty `evaluator.activity_log`, or seeded entries written as `src/model.cjs` writes them. The Agent never sees it.
- **Identity:** `account_id` and `owner_person_id` must match the binding you load with the seed, and every tutor must be a person in it.

Every object ID must be unique across the whole seed. `validateSeed` rejects the seed with `invalid_seed` and a reason if any of this fails; use `env.validate_bundle` to check before loading. The full fixtures' builder also refuses a history the centre's rules would not have produced (over the weekly cap, during a suspension, outside the tutor's skills or timetable); `validateSeed` does not check those.

## 2. Time and events

- Load with `env.load_seed` and set the scene's start with `virtual_now`. `env.reset` restores that seed and time. Move the clock with `env.advance_time`.
- Apply the centre's actions with `env.apply_event` at their own times (never before the App clock): `tutorwell.slot.released`, `slot.withdrawn` (a booked appointment on it becomes `cancelled_by_centre`), `appointment.attended` (the only way an appointment gets an outcome), `report.posted` (with the follow-ups) and `rules.changed`. `examples/events/` has one complete example of each; a refused event changes neither data nor the clock.
- Core checks the whole record again after every event and write. So a `rules.changed` dated at the very time of a recorded cancellation or attendance is refused (`invalid_value`): it would re-judge that result. Date it later.
- Mind daylight saving time in New York fixtures: after Sun 03-14 the offset is −04:00, and durations are exact, so 14 days from 21:00 on 03-02 end at 22:00 (−04:00) on 03-16.

## 3. What the Agent can do

Both policy profiles, `scenario` (the default) and `sandbox`, offer all ten tools; supply your own `policies` with `env.load_seed` to narrow them. Every read returns `as_of` in the student's zone; `appointments.list` gives each booked appointment its `cancellation_cutoff`; `profile.get` gives the week's count, the no-shows in the window against the limit, the accommodations with their consents and any suspension. Unknown IDs return `not_found` with the valid ones and what they are. The Agent does not see the activity log or the checker.

Optional connections (workflows 2 and 4 in the proposal): run Calendar 1.3.0 for the same person, and the Agent can check conflicts and add sessions with Calendar's own tools (`calendar.freebusy`, `calendar.create`); run Milepost (PR #70) with the same student, and the Agent can read the weakest skills and targets (`mastery.get`, `plan.project`) and turn follow-ups into practice blocks (`plan.add_block`). The full fixtures use Milepost's students (Maya Ortiz, Daniel Kim, same person IDs), its skill IDs and its loading time (Mon 2027-03-01 09:00), so both Apps can be loaded for one student. Tutorwell sends nothing to either App and reads nothing from them; a Task that uses them grades that part from their own records.

## 4. Grade from state, not from prose

Read `env.snapshot` before any reset; reset clears the run's activity log and Core audit.

- `src/checker.cjs` exports `checkAppointments(snapshot)`: each intake the Agent wrote with the consents in force and `shared_without_consent`; every cancellation with the cutoff it was judged against and who made it; the no-shows; every suspension with its cause and the incidents it counted; and each follow-up with when and by whom it was marked done. It is pure and is for graders only.
- `snapshot.data.evaluator.activity_log` lists every committed Agent write with its `request_id`, observed version, the consents in force and details (the intake, the cutoff, the follow-up's change); repeated requests add no entry. Join it with `snapshot.audit` and the supplied Agent trace by `request_id` to see refused attempts and order.
- Typical checks: one booking with a tutor who teaches the skill the record calls for, in the right week, with the items to bring; nothing shared without consent; the type of work stated truthfully; no cancellation that would start a suspension the student was not told about; follow-ups marked done only for work the student has done. `examples/scenarios/grade.cjs` implements these.

## 5. Twins

A twin is a copy of the task's seed (or setup) with one decisive part of the student's record changed: the appointment history, one consent, the type of work a follow-up asks for, or the student's weakest skill. State which decision must change and why, check both members with the same grader, and make sure no single Agent outcome passes both. If a reference run passes both members, the twin does not test what the task claims. `tests/scenarios.cjs` checks this for the reference scenarios.

## 6. Pitfalls

- Sharing accommodations is all or nothing: `share_accommodations: true` shares every one, so it is without consent if any of them lacks it.
- No outcome is inferred from the clock. A booked appointment whose session has started stays `awaiting_outcome`, counts toward its week and cannot get a report until `appointment.attended` arrives, however late.
- A late cancellation counts as a no-show at once, dated at the cancellation; a no-show is dated at the session start but counts from when the centre records it.
- A suspension refuses new bookings only; existing appointments, cancellations and follow-ups still work.
- New appointment IDs continue the account's sequence: in the full fixtures the first new booking is `apt-13`.
- `followups.set_status` refuses a status the follow-up already has (`invalid_state`).
