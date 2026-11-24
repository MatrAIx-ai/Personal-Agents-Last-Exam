# Sources and licenses

Original Coverline code: MIT. Original synthetic owner/provider facts, pricing rules, PDF/JSON originals and UI presentation: CC0-1.0 for data/media. Files/Mail public package schemas, contribution metadata and service launcher are adapted from this repository under MIT; there is no copied receiving App implementation or private state.

Consulted 2026-11-24: [The Zebra](https://www.thezebra.com/auto-insurance/) for multi-provider quote/comparison interactions and [California consumer terminology](https://www.insurance.ca.gov/01-consumers/105-type/95-guides/01-auto/auto101.cfm) for common coverage labels. No page prose, insurer marks, photographs, rate data or customer records were imported. Synthetic jurisdiction `CL-DEMO` is not a real state-law or compliance rule pack.

Fixtures: one fictional owner/vehicle, three obtained source records, one profile/coverage baseline, two fictional providers, two provider-specific grants, two submitted applications, one open question and two source-backed PDF/JSON quote pairs. The source registry includes a later supplied mileage correction without silently altering the old profile. The VIN is explicitly synthetic. Privacy grants omit driving-data enrollment.

Rules: listed premiums/low-mileage discounts are six-month amounts, prorated to the requested term with integer rounding. Installment fees are additional per-month charges; installment amounts sum exactly to the term total and include the initial payment. Harbor's default $600 premium plus six $5 fees totals $630; Juniper's default $660 quote omits rental coverage and offers a $1,000 collision deductible. Conditional/written stages and provider-specific missing fields stay explicit.

`scripts/build-package.py` authors fixtures using the actual Node handlers and original deterministic PDF renderer; Python is generation-only. Runtime business/provider code uses Node built-ins. The local provider actor is outside the Agent GUI, uses public Infra MCP, processes only submitted requests at the supplied virtual time, and never issues consent. No credentials or external service are needed.

Original PDFs contain selectable, readable ASCII text. Rendering was checked with the bundled Poppler and a temporary fontconfig file pointing to local system fonts. Advanced typography, arbitrary third-party PDF extraction/OCR, the full scene corpus and independent human provenance review remain future work. Dynamic Core-imported assets retain the platform's provenance-review marker until reviewed.
