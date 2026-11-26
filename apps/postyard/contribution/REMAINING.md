# Remaining after the approved v1 tools

The approved tools, events, confirmation paths, images, fixture (b), and the validation report are in the package. `contribution/evidence.md` is the index.

Still outside this delivery:

- The optional read-only reviewer renderer stays a declared placeholder in `gui/`. No business page is shipped.
- The byte-for-byte comparison of `schemas/public-speech-evidence.schema.json` with Forkyard's copy waits until Forkyard merges. This package's copy started from Forkyard commit `e9fe739b0b6af11d3805756a4916c028cf41bb4e`, blob `0a8eb61ab15c3d3aaec1f687c1cc2bb93ac82053`.

The live reverse join is a pinned Forkyard limitation. `scripts/check-forkyard-join.cjs` drafts, publishes, and confirms `tidewater-gatekeeping` under `ac-0001`, then exports it. That document produces no `linked_post` subject. The same document with the actor rewritten to `fy-tomasreyes` produces `person-ingrid`. Postyard keeps `ac-0001`, the stable post id, the slug, the canonical URL, and `person_id` `person-tomas`. A later Forkyard change can resolve the URL handle to its Forkyard account and compare `person_id`. This package does not apply that change.
