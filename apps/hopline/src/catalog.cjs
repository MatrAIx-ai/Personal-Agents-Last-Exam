'use strict';
// Read-only App catalog (App state). Fictional round numbers, not a real agency's fares.
const CATALOG_VERSION = 'hopline-fares-1';
const FARES = {
  rail: 240, bus: 170,
  transfer_window_min: 120,  // within 120 min of a paid boarding, a transfer costs only the difference
  weekly_cap: 2250,          // half-open week [Mon 00:00, next Mon 00:00), local time
  reduced_factor: 0.5,       // a reduced fare halves every fare and the cap
  monthly_pass: 9000,
  replacement_fee: 500
};
const PROGRAMS = ['senior', 'disability', 'low_income'];
const PATHWAY_MODES = ['walkway', 'stairs', 'escalator', 'elevator', 'ramp'];
const STEP_FREE_MODES = ['walkway', 'elevator', 'ramp'];
const EFFECTS = ['detour', 'stop_closed', 'no_service', 'reduced_service', 'significant_delays', 'stop_moved'];
const URGENT_EFFECTS = ['no_service', 'stop_closed'];
const CAUSES = ['construction', 'maintenance', 'accident', 'weather', 'technical_problem', 'police_activity', 'special_event', 'other'];
const LIMITS = {saved: 20, subscriptions: 25, planning_days: 7, departure_window_min: 30, search_hours: 4, departures_window_h: 6, history_days: 400};
module.exports = {CATALOG_VERSION, FARES, PROGRAMS, PATHWAY_MODES, STEP_FREE_MODES, EFFECTS, URGENT_EFFECTS, CAUSES, LIMITS};
