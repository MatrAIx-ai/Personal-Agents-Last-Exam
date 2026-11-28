# CutRoom

CutRoom is a synthetic production workspace. It supports release checks, review notes, music search, thumbnail selection and simulated release through stdio MCP. It does not publish or encode video. The default seed `fixtures/minimal.json` is a small smoke fixture. The evaluation dataset is `datasets/history/`: it covers 2025-01-01 to 2026-12-31, and is loaded with `env.load_seed` using `require('./scripts/history-bundle.cjs').loadSeedArgs()`. It is also listed in `contribution/contribution.json` under the extension `cutroom.evaluation_dataset`.

Run from the PALE checkout with Node.js 18 or later and public runtime 1.6.0 (Core API 1.2.0):

```sh
npm --prefix apps/cutroom test
npm --prefix apps/cutroom run example
npm run app:verify -- --app apps/cutroom --output .artifacts/cutroom.json
node --test apps/cutroom/tests/mcp.test.cjs
node apps/cutroom/service.cjs --role agent
```

Use `--role infra` for fixture load, events, clock and reset. At release time a read derives the outcome without persisting it; subsequent mutations preserve past outcomes. A later revocation adds an audit blocker without taking down a completed release. An event at the exact scheduled instant is included in the clearance check. Music can be revoked; a guest release can be withdrawn and later re-signed. The override is a separate tool, excluded from the default scenario policy.

`cutroom.license.revoke` rules, for Task authors:
- **Guest release:** `resource_id` is one of the project's `guest_releases`, with status `withdrawn` or `signed`.
- **Music:** `resource_id` must be the track currently assigned to that project (`track_id`), with status `revoked`. The revocation is recorded on the library track, so every project using that track sees it.
- If the Agent has already swapped the track, a music revocation naming the old track on that project is rejected as `invalid_event`, and nothing changes. This is intended: the Agent did the right thing. A Task that revokes a track should target a project that still uses it, or apply the event before the Agent acts.

Proposal names and fixture IDs:

| In the proposal | In the fixture |
| --- | --- |
| `proj-ep14-laptop` | `ep14` |
| `release-guest-maya-ep14` | `guest-ep14` |
| `thumb_a.png`, `thumb_b.png` | `thumb-a`, `thumb-b` (also `thumb-c`) |
| the `08:45` keyframe | `keyframe-0845` |
| `force_override: true` | the separate tool `cutroom.projects.override_release` |

Stored data must agree with the clock. `validateSeed` rejects data (`invalid_seed`) when any stored past fact is dated after `ctx.virtual_now`. Past facts are `published_at`, a note's `at` and `resolved_at`, an A/B result's `at`, guest and license history entries, and an override's `at`. Schedules and license expiries are plans, so they can point forward. The rule runs on every `env.load_seed`, event and write, so a Task cannot load later history as if it were already in the past. The history dataset's default clock is `2026-11-19T18:00:00Z`. The earliest clock it can be loaded at is its latest past fact, `2026-11-19T08:15:00Z`. Both values are recorded in `datasets/history/dataset.json` (`sources[0].generation.parameters.load_clock`). For an earlier session date, build a seed without the later records; do not load this one at an earlier `virtual_now`.

Both thumbnails and keyframes belong to the project for Core authorization. Asset permissions do not depend on whether the simulated release is public.

The default seed `fixtures/minimal.json` is a small smoke fixture. The delivery evaluation dataset in `datasets/history/` covers 2025-01-01 through 2026-12-31: 51 projects, 39 library items and 48 images, all synthetic. It is built from the authored episode plan `scripts/history-episodes.json`. Each episode has its own description and its own topic-specific, timecoded review notes over one to three cuts. Release days and times vary, and the plan includes skipped slots, delayed, unlisted and pulled releases, and A/B thumbnail tests on 12 released projects. Load it with `env.load_seed`, using the arguments from `require('apps/cutroom/scripts/history-bundle.cjs').loadSeedArgs()` (`data`, `bundle` with all 48 blobs, `binding`, `virtual_now`). Recount it with `node apps/cutroom/scripts/coverage.cjs`. Regenerate it with `node apps/cutroom/scripts/build-history.cjs`. [`evidence/README.md`](evidence/README.md) indexes the tests, how each review item was handled, the coverage report and the remaining work.

The bundled PNGs are original illustrations, with one scene per episode topic. Each project has three thumbnail candidates, and exactly one is acceptable on mobile. Each of the other two carries one defect: the duration badge covers the title, the title is clipped at the right edge, or the title has unreadable contrast. Which candidate is acceptable, and which defect sits where, varies by project. For the plan's ep14 example, only `thumb-b` is correct. Keyframes are frames from the cut, with a burned-in review timecode and no duration badge, and each shows the moment of one timecoded note. The answer key is `review/visual-checks.md`, which is not served over MCP.

Image access needs `runtime/registrations/cutroom.json`, which maps `project` to `cutroom.projects.get`. This is a host dependency outside the package (owner: maintainers/Infra). Without it, `resources/list` is empty and no image can be read, while `app:verify` still passes. `tests/mcp.test.cjs` fails with a message naming the file.

An author can regenerate the images with `python3 apps/cutroom/scripts/render.py` (requires CairoSVG and Pillow), then run `node apps/cutroom/scripts/build.cjs` to rebuild the manifests, schemas, fixture records and catalog. Neither build step is needed to run the shipped package. Independent visual and provenance review remains open.
