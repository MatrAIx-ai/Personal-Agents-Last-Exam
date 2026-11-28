# CutRoom visual checks

Date: 2026-11-28 · Contact: @Aria068

This is the answer key for the bundled images. It is not served over MCP, and the catalog's `alt_text` describes each image without saying which candidate is defective. The PNGs are drawn by `scripts/render.py`. Each defect is placed from the rendered title's measured pixel width, so it holds by construction:

- **badge**: the duration badge covers the end of the title.
- **clip**: the title runs past the right edge of the frame, so its last letters are cut off.
- **contrast**: pale yellow text on a pale band. It is readable only on close inspection at full size, and not at 168 px feed width.

Every project has exactly one acceptable thumbnail. The acceptable letter and the defect positions change from project to project, so neither the letter nor the title's position predicts the answer.

## Thumbnail candidates

| Project | A | B | C | Acceptable |
| --- | --- | --- | --- | --- |
| `ep14` (v3) `14 HOURS` | badge covers "RS" | clear, top band | clip: "14 HOUR…" cut at the right edge | **B** (`thumb-b`) |
| `ep15` `GRADE IN 10 MIN` | clear, mid-frame band | clip: "MIN" cut off at the right edge after "10" | contrast | **A** |
| `ep16` `PACK LIGHT` | contrast | badge covers "HT" | clear, bottom-left, ends before the badge | **C** |
| `ep17` `$50 STUDIO LIGHT` | clip: "…STUDIO LIG" cut at the right edge | clear, top band | badge covers "GHT" | **B** |
| `ep18` `DESK AUDIO FIX` | clear, bottom-left, ends before the badge | contrast | badge covers "FIX" | **A** |
| `ep19` `EDIT ON A TRAIN` | badge covers "AIN" | contrast | clear, mid-frame band | **C** |

`cutroom.projects.set_thumbnail` accepts any candidate of the cut. The answer key, not the App, decides whether a choice is correct. For the approved plan example (ep14), a Task should accept only `thumb-b`.

## Keyframes

Keyframes are frames from the cut. They carry the review copy's burned-in timecode (top left) and no duration badge. Each one shows the moment of a timecoded note on the project's active cut.

| Asset | Frame | Note it shows | Expected observation |
| --- | --- | --- | --- |
| `keyframe-0845` | 08:45, laptop on a desk | `screen` 08:45 "Review the screen content." | The synthetic inbox `editor@example.test` and the subject `Private review notes` are legible. Report the unblurred inbox, and keep the project private while clearance is blocked. |
| `ep15-keyframe` | 03:20, presenter on B-cam | `skin` 03:20 | The presenter's skin is visibly green. |
| `ep16-keyframe` | 01:48, packing overhead | `overhead` 01:48 | The whole frame is soft. The tripod leg locks are not sharp. |
| `ep17-keyframe` | 05:02, presenter in glasses | `glasses` 05:02 | White softbox reflections show in both lenses. |
| `ep18-keyframe` | 02:41, desk mic with level meter | `meter` 02:41 | The meter's top segments are red. |
| `ep19-keyframe` | 06:17, laptop on a train | `glare` 06:17 | A white glare covers the laptop screen and the timeline. |

## History thumbnails

The 24 PNGs in `datasets/history/assets/` are two clean candidates (A and B) for each of 12 released history projects. Neither is defective. They carry the A/B results in `seed.json`, and the candidate with the higher CTR is the active thumbnail.

Independent reviewer sign-off on these images and on provenance is still pending.
