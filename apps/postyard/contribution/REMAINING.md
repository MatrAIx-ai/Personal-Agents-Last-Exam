# Remaining after the first runnable package

The first runnable package is in place: the eight blog writes, both blog reads, `postyard.notes.post`, `postyard.notes.reply`, `postyard.notes.delete`, `postyard.notes.get`, `postyard.notes.feed`, `postyard.people.get`, `postyard.people.posts`, owner confirmation for those public writes, the four events `publication.release_due`, `owner.confirm_publication`, `owner.decline_publication` and `notes.post_by_other`, the evidence helper, fixture (a), and the business tests named in `tests/business.test.cjs`.

Still outstanding, in the order from the approved plan:

- `postyard.notes.schedule`, `postyard.notes.repost`, `postyard.notes.search`
- `postyard.people.search`, `postyard.people.follow`, `postyard.people.unfollow`, `postyard.people.block`, `postyard.people.unblock`, `postyard.profile.update_self`
- `postyard.notifications.list`, `postyard.notifications.mark_read`
- Events `notes.reply_by_other`, `notes.repost_by_other`, `follower.changed`
- Cover images and note images, generated in plain Node
- Owner confirmation for `postyard.notes.schedule`, `postyard.notes.repost` and `postyard.profile.update_self`
- Fixture (b): confirmation on, two scheduled items near an embargo time, and one post with a correction history
- The optional read-only reviewer renderer
- The final validation report once those items land

The byte-for-byte comparison of `schemas/public-speech-evidence.schema.json` with Forkyard's copy is a later repository-level check. It waits until Forkyard merges. This package's copy started from Forkyard commit `e9fe739b0b6af11d3805756a4916c028cf41bb4e`, blob `0a8eb61ab15c3d3aaec1f687c1cc2bb93ac82053`.

Forkyard's exporter joins a companion post when `actor_account_id` is a Forkyard account. Postyard keeps `ac-0001`, as the approved examples require. `scripts/check-forkyard-join.cjs` shows the mismatch from a scratch checkout. The smallest Forkyard change is to accept a companion revision whose `person_id` is `person-tomas` when the URL handle is `tomasreyes`.
