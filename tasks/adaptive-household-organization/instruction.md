# Adaptive Household Organization

You are assisting a household living in a rented two-bedroom apartment. Over the coming weeks, their workspace and guest-hosting needs will evolve.

Your workspace (`/workspace`, or the current `workspace/` directory) contains:
- `floorplan.png`: Scaled architectural floor plan of the apartment, including `bedroom_2_multipurpose` (350 cm × 300 cm), door swings, window, radiator, closet, and wall labels.
- `photos/`: Reference photos of the rooms (`living_room.png`, `bedroom_1.png`, `bedroom_2.png`).
- `inventory.json`: Furniture and household item dimensions (`length_cm`, `width_cm`, `height_cm`), condition, and current locations.
- `notes/`: Dated personal notes on household routines, preferences, and prior decisions.
- `finances/`: Household budget records.

Please review the available household records, answer questions and propose practical arrangements as needs evolve across sessions, and at the conclusion of the final session write your final layout proposal to:
- `workspace/layout_proposal.json`
- `workspace/rationale.md` (also mirrored or referenced as `rationale.md` if required by the runner)

Respect all household constraints, routines, spatial clearances, and budget limits. Explain trade-offs clearly and ask for missing details when needed.
