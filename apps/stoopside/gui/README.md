# Stoopside pages

`index.html` and `src/app.js` are Stoopside's business pages for the shared Web Host (`runtime/web/server.cjs`), declared with the optional `pale.web` extension in `contribution/gui.json`. The Host serves only these two files plus its shared client and stylesheet, and forwards only the Agent tools the run's profile allows.

From the repository root:

```sh
node runtime/web/server.cjs --app stoopside --registry apps/stoopside/web.registry.json --run web-demo --profile sandbox
```

Open the access link the Host prints. `web.registry.json` starts a new instance at the Maple St fixture's clock (2027-03-01 09:00 EST); see the package README, section Pages, for why the shared registry's clock does not suit this fixture. The pages hold no business state and apply no business rule: every value shown is a Stoopside tool result, and Refresh reads again. `tests/web-checks.cjs` drives all eight pages in Chromium.
