# Task data: second family, payment due

Edit seed, binding, policies and dataset together, then use `env.validate_bundle` and `env.load_seed`. These are input examples; loading is an Infra operation. The scenario supplies event content and virtual time; a task runner chooses when to inject it.

`seed.json`, `binding.json`, `policies.json` and `dataset.json` describe a one-member family account: Leila Haddad (`tidepool-leila`, member `mem-leila`) on the Individual plan. The catalog is the same as `fixtures/minimal.json`. The binding also lists Rafael Haddad (`person-rafael`), whom a task can have the agent invite.

- **Billing.** The anchor is Jan. 15, 2026, 00:00 Eastern. January to October are paid. `inv-2026-11-15` ($10.99) was declined on Nov. 20, 09:00 Eastern, so the account reads `payment_due` with grace until Nov. 27, 09:00 Eastern. After that, her four downloads (three Harbor Hours episodes and one album) read `needs_check` and new downloads return `payment_due`. Upgrades are refused until the invoice is paid.
- **`events/leila-november-paid.json`** pays that invoice on Nov. 28, 10:00 Eastern.
- **Loading.** Load at or after Nov. 24, 08:03 Eastern (05:03 Pacific), its latest record: the completion of her newest Harbor Hours download. The walkthrough uses the registry clock, Nov. 24, 19:00 Pacific. Pass a bundle with this `dataset.json`, which counts 315 records. The package's own `contribution/dataset.json` counts the 506 records of the main family.
- **Policies.** `policies.json` grants all 33 tools in the `scenario` profile; the package default grants only reads.
- **Coverage.** `tests/business.test.cjs` (T11b) and `examples/mcp-walkthrough.cjs` load this seed directly. They show the grace period ending by time alone, the payment, a 221-cent prorated upgrade to Duo, and a downgrade back to Individual taking effect on Dec. 15 with a 1320-cent invoice.
