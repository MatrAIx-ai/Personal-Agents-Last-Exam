# Environment Track Proposal: Hearth — Household Simulation

**Title:** `[Environment Proposal] [Home & utilities] Hearth`

## 1. App and domains

- **Authors / GitHub handles:** TBD
- **Reference app or website / URL:** Home Assistant — https://www.home-assistant.io/ (reference for household entities, devices and automations; Hearth will be an independent simulation, not a Home Assistant integration or clone)
- **Primary domain:** Home & utilities
- **Secondary domains:** Shopping & groceries

## 2. What you plan to build

Hearth is a persistent, interactive simulation of a household and its residents. It gives personal agents a shared environment in which to understand household needs, manage resources, coordinate people, and respond to changes over time.

The simulated household includes a property with rooms and physical features; residents with individual profiles, preferences, schedules and relationships; possessions, appliances and furniture; household supplies; recurring expenses and budgets; maintenance needs; and shared routines and responsibilities.

The environment will support workflows such as:

- **Household organisation:** Track belongings, locate items, manage storage, and maintain an accurate household inventory.
- **Space and property management:** Understand room layouts, dimensions, access constraints, utilities and intended uses. Plan changes while respecting physical and resident-specific constraints.
- **Resident coordination:** Account for different preferences, schedules, needs, responsibilities and conflicting requests.
- **Purchasing and resource management:** Track supplies, compare potential purchases, manage budgets, and consider whether existing items can be reused, repaired or repurposed.
- **Maintenance and issue resolution:** Track appliance condition, repairs, warranties, recurring maintenance and household problems.
- **Household planning:** Coordinate chores, shared activities, routines, and upcoming changes.
- **Adaptation over time:** Respond to new residents, departures, changing needs, new possessions, breakdowns, budget changes and feedback.

## 3. Potential app connections

- **Internal personal apps:** Calendar (read and update household schedules and appointments); Mail (read household-related messages, receipts, warranties and service notices); Contacts (identify residents, relatives, landlords and service providers).
- **Other apps and websites:** Shopping services, home-maintenance providers, smart-home platforms and utility services. Initial implementation will use simulated services and data rather than depend on live third-party accounts.

### Integration details

- **Operations and access:** Provide an agent-facing API and web GUI. Core actions should include reading and updating resident profiles, rooms, objects, inventory, budgets, chores, maintenance records and household plans. Support search and filtering across household data. Provide explicit actions for creating, updating, moving, assigning, purchasing, repairing and disposing of objects or records. Include setup, reset, snapshot and event-injection operations for the platform. Mutating actions should return a clear result and updated state. Where an action has meaningful consequences, such as a purchase or a change to a shared plan, the environment should support confirmation or approval.

- **State and lifecycle:** Separate persistent household state, resident accounts and individual task-run state. Each fixture should start with a coherent household containing multiple residents, a property, rooms, objects, routines, budgets and outstanding issues. State should persist across sessions within a run. Provide deterministic reset to a known snapshot, plus event injection to introduce new circumstances. Mutations should be logged with timestamps and actor identity. Use version checks or equivalent safeguards to prevent silent overwrites when multiple agents or residents update shared information. Retries should not duplicate purchases, bookings or other consequential actions.

- **Events and notifications:** Support external events that change household circumstances. Examples include a resident changing their schedule or preferences, a new person joining the household, an appliance breaking, a delivery arriving, a bill changing, a maintenance appointment being rescheduled, or a household member reporting that a proposed solution does not work. Events should enter through a controlled event interface and update the relevant records. The environment should expose notifications through an in-app activity feed, with optional simulated Mail or Calendar messages. Task scenarios will define when events occur; the environment itself should not prescribe the agent's response.

- **Shared data and dependencies:** Use stable identifiers for residents, rooms, objects, appliances, suppliers, tasks, expenses and events. Objects should be linked to their current location, owner or shared status, condition and relevant history. Residents should be linked to their preferences, schedules, responsibilities and household relationships. Support image assets for rooms, furniture, appliances and household objects, plus documents such as receipts, warranties and maintenance reports. The initial implementation should use a self-contained database and asset store, with no live external service required at runtime.

## 4. Construction plan and effort

**Work breakdown**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :---: |
| Web / app construction | Build a responsive household dashboard and views for residents, property, rooms, inventory, budgets, routines, maintenance and activity history. Implement search, filtering and core create/update actions. | Working GUI and API. Verify that core workflows update the same underlying state and that users can inspect the effects of actions. | 12–16 |
| Data and image collection | Identify suitable openly licensed reference images for rooms, furniture, appliances and household objects. Target 80–120 reusable images, with source and license records. | Asset library with source metadata. Check license compatibility, image relevance, file integrity and broken references. | 2–4 |
| Synthetic data and assets | Generate 3–5 coherent household fixtures, each with 2–5 residents, 5–10 rooms, 100–200 objects, routines, budgets, maintenance records and event histories. Include varied household structures, preferences, constraints and financial circumstances. Generate synthetic receipts, warranties, messages and event records. | Reproducible fixture datasets and documents. Validate referential integrity, plausible values, consistent histories, realistic variation and absence of contradictory records. | 5–7 |
| App integrations | Implement simulated Mail, Calendar and Contacts interfaces or adapters for household-related messages, schedules and people. Keep real external integrations out of the initial scope. | Demonstrate that relevant records can be read and updated through the simulated interfaces without creating inconsistent duplicate state. | 3–5 |
| Validation and reset | Test core workflows, multi-resident conflicts, permission boundaries, event injection, concurrent updates, action retries and deterministic reset. Add end-to-end scenarios that verify state changes independently of the agent's narrative. | Automated tests, reproducible fixtures, reset evidence and platform validation evidence covering permissions, state consistency and repeatability. | 5–7 |

- **Milestones, owners and dependencies:**  
  1. Agree on the household data model, fixture scope and action interface (1–2 days; environment design and backend contributors).  
  2. Implement the database, API and reset/event mechanisms (4–6 days; backend contributor).  
  3. Build the web interface and household workflows (5–7 days; frontend contributor).  
  4. Generate fixtures and collect assets in parallel with app construction (3–5 days; data/assets contributor).  
  5. Implement simulated app connections, run validation and prepare platform integration evidence (4–6 days; integration and validation contributors).  
  Dependencies: the data model and action interface must be agreed before the main UI and fixtures are finalised. Owners and related PRs: TBD.

- **Resources and total effort:** Estimated total: **27–39 person-days**. Local application runtime, database, and asset storage. Image collection should use openly licensed assets; synthetic records and documents should be generated locally. 

- **Scope boundary and open questions:** The initial release will simulate one household per environment instance. It will not control real smart-home devices, make real purchases, access real financial accounts, or contact real service providers. Real integrations can be considered later. Open questions include the final number and diversity of fixtures and how much resident-level permission control the first release should expose. Resolve these during the data-model milestone, prioritising a reliable state model and varied task coverage over visual complexity.

- **License and external dependencies:** Code will use the repository's required license (confirm before implementation). All collected images and other external assets must have compatible licenses and recorded sources. Synthetic household data and generated documents will be created for the project. No external service should be required at runtime; simulated integrations and event delivery will be controlled by the environment.
