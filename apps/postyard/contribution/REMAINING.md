# Remaining after the approved v1 tools

The approved tools, events, confirmation paths, fixture (b), and the validation report are in the package. `contribution/evidence.md` is the index.

The smoke fixture, fixture (a), fixture (b), and `examples/dataset/later-2026/` share one cover. It is `cover-checksum`, a 32 by 24 JPEG at `assets/cover.jpg`, and each seed attaches it to `ac-0001:p1`. Those four seeds contain no avatar and no note image. A task that needs either one adds the file bytes to that seed's `media` array as `bytes_base64` and passes the `asset_id` on the write. `notes.post` copies a note image onto the new note, and the public runtime can then read it with the note. A ready cover is listed and read through `postyard.blog.posts.get`.

Still outside this delivery:

- The optional read-only reviewer renderer stays a declared placeholder in `gui/`. No business page is shipped.
- The byte-for-byte comparison of `schemas/public-speech-evidence.schema.json` with Forkyard's copy waits until Forkyard merges. This package's copy started from Forkyard commit `e9fe739b0b6af11d3805756a4916c028cf41bb4e`, blob `0a8eb61ab15c3d3aaec1f687c1cc2bb93ac82053`.

Postyard identifiers stay `ac-0001`, the stable post id, the slug, the canonical URL, and `person_id` `person-tomas`. Task #74 needs no actor rewrite. `scripts/check-forkyard-join.cjs` drafts, publishes, and confirms `tidewater-gatekeeping` under `ac-0001`, then exports it.

At Forkyard `e9fe739b0b6af11d3805756a4916c028cf41bb4e`, the recorded sample, that native document produces no `linked_post` subject. Rewriting only the actor to `fy-tomasreyes` produces `person-ingrid`. At Forkyard `80417c59460dff88d383f9e2cc5da14186ef6ef5`, both documents join. `linked_post` names the person in the post text. The companion revision keeps the author `person-tomas`. The same native join still holds on branch head `2500aa0c1a7279e2f89a547fa75cfd9d81132919`. A Forkyard snapshot that keeps only Tomás-authored pulls, comments, and reviews omits a `linked_post` that lives only on a Ship-authored object. This package does not change Forkyard.
