# Personal Health & Life Hub (`health-hub`)

Simulated personal health, recovery, and fitness platform running on PALE Runtime 1.6.0 / Core API 1.2.0.

## Capabilities

- **Biometrics & Recovery (`health-hub.get_daily_summary`, `health-hub.list_metrics`):** Daily sleep architecture, resting heart rate, HRV, day strain, and body weight with explicit `no_data` (`device_not_worn`) gap representation.
- **Workouts (`health-hub.list_workouts`, `health-hub.plan_workout`, `health-hub.log_workout`, `health-hub.update_workout`):** Lifecycle transitions (`planned` -> `completed` / `skipped` / `cancelled`).
- **Goals (`health-hub.list_goals`, `health-hub.create_goal`, `health-hub.update_goal`):** Wellness and habit targets (`active` -> `achieved` / `missed` / `abandoned`), with lazy `missed` derivation at read time.
- **Routine Templates (`health-hub.list_routine_templates`, `health-hub.create_routine_template`, `health-hub.update_routine_template`):** Reusable routine templates (`draft` -> `active` -> `archived`) with internal block overlap detection.
- **Notifications & Events (`health-hub.list_notifications`, `health-hub.ingest_daily_sync`):** Notifications persisted strictly during writes and incoming daily sync events.

## Verification

```bash
npm run app:verify -- --app apps/health-hub
```
