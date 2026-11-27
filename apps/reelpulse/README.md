# ReelPulse

A synthetic creator workspace for reviewing post images, scheduling sponsored posts, moderating comments and ranking posting slots. It does not connect to a social platform.

Requires Node.js 18+ and PALE public runtime 1.6.0 (Core API 1.2.0). From the repository root:

```sh
npm --prefix apps/reelpulse test
npm --prefix apps/reelpulse run example
npm run app:verify -- --app apps/reelpulse --output .artifacts/reelpulse.json
node --test apps/reelpulse/tests/mcp.test.cjs
node apps/reelpulse/service.cjs --role agent
```

Infra can start the same service with `--role infra`. Task authors can load replacement synthetic history, set the virtual clock and inject the three declared event types. At the scheduled instant, reads and event targeting treat a scheduled post as published without a timer. A sponsor update before that instant cancels a noncompliant schedule and records why. At the exact instant, publication takes precedence. The task injects the creator’s promo comment; pinning never creates it.

Draft and published image resources both use the `post → reelpulse.posts.get` registration. Core controls resource access by account, run and parent object. Visual privacy assessment is done by the caller, not by image classification in the app.

The bundled PNGs and records are synthetic. Run `node apps/reelpulse/scripts/build-fixtures.cjs` to regenerate the JSON fixture and catalog files from the bundled PNGs. Independent visual/provenance review is still required. There is no GUI, live publishing, playback, transcoding, DM delivery or billing.
