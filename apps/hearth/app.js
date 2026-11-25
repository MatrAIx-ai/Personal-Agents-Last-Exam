{
  "name": "hearth",
  "version": "1.0.0",
  "display_name": "Hearth Household Simulation",
  "domain": "Home & utilities",
  "secondary_domains": ["Shopping & groceries"],
  "description": "Simulated household system of record managing physical room layouts, furniture inventory, appliance maintenance, and budget approval workflows.",
  "dependencies": [],
  "event_types": [
    "hearth.appliance_breakdown",
    "hearth.cancel_maintenance_issue",
    "hearth.purchase_approval"
  ],
  "entrypoint": "src/index.cjs"
}
