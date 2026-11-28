# Stoopside pages

`index.html` and `src/app.js` are Stoopside's business pages for the shared Web Host (`runtime/web/server.cjs`), declared with the optional `pale.web` extension in `contribution/gui.json`. The Host serves only these two files plus its shared client and stylesheet, and forwards only the Agent tools the run's profile allows.

From the repository root:

```sh
node apps/stoopside/scripts/web-fixture.cjs maple-street
```

Open the access link the script prints. It starts the Host with `web.registry.json` (2027-03-01 09:00 EST) and loads the Maple St fixture at its clock through Infra's `env.load_seed`. `node apps/stoopside/scripts/web-fixture.cjs hillcrest` starts the Host on the manifest seed, Hillcrest, at its clock (2026-11-18 09:00 PST), inside the 2025-2026 coverage window; see the package README, section Pages.

The pages hold no business state: every value shown is a Stoopside tool result, and Refresh reads again. Events, groups, posts, members and slots are cards; times are in the group's zone ("Sat, Mar 20, 2027, 4:00 PM EST"); previews are sentences with Confirm and Cancel; receipts stay on the page after a confirm and errors stay next to their form; delete and leave ask first; controls the profile or the user's role cannot use are hidden (the tools still enforce every rule). App text is at least 12px through a constructed stylesheet, because the Host allows no inline styles. `tests/web-checks.cjs` drives all eight pages in Chromium (85 checks); `--evidence` writes the screenshots indexed in `evidence/README.md`.
