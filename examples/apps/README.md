# Complete App reference packages

[Mail](mail/README.md) and [Calendar](calendar/README.md) are two separate App implementations. Each has its own schema, tools, business modules, fixtures, media, examples and tests. Their internal folders need not be identical.

Use the [common contribution structure](../../docs/app-contribution.md), then read the [App integration guide](../../docs/app-integrations.md) before calling another App or producing a notification. New contributions can live under `apps/<app-id>/`; keep one implementation per App.

App-only checks (Node.js 18+, no dependencies):

```sh
cd examples/apps/mail
npm test
npm run example
```

Use the same commands in Calendar. These directly test business functions.

The full public repository also includes [Core and Messaging](../../runtime/README.md), so contributors can run real MCP/lifecycle/permission checks:

```sh
npm run app:verify -- --app examples/apps/mail
npm run app:verify -- --app examples/apps/calendar
npm test
```

Common integration reports are separate from manual workflow/provenance review and remote production deployment. Mail declares separate text and attachment Email channels; Calendar exposes ICS import and attachment operations while keeping its messaging directions empty. Other destinations require their own receive contracts and implementations.
