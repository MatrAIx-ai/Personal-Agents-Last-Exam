'use strict';
// Read-only App catalog shipped with the package (App state). Tasks cannot change it; the one
// task-adjustable policy value (the automatic-shift line) lives in the seed's settings.
const CATALOG_VERSION = 'curbline-catalog-1';
const FARE_VERSION = 'curbline-fares-2026-1';

// Ride options: seats, bags, child-seat support and per-option rates (integer cents).
const OPTIONS = {
  standard: {seats: 4, bags: 3, child_seats: true, wheelchair: false, base_cents: 300, per_km_cents: 110, per_min_cents: 35},
  xl: {seats: 6, bags: 5, child_seats: true, wheelchair: false, base_cents: 500, per_km_cents: 170, per_min_cents: 50},
  comfort: {seats: 4, bags: 3, child_seats: true, wheelchair: false, base_cents: 450, per_km_cents: 150, per_min_cents: 45},
  wheelchair_accessible: {seats: 3, bags: 2, child_seats: false, wheelchair: true, base_cents: 300, per_km_cents: 110, per_min_cents: 35}
};
const OPTION_ORDER = ['standard', 'comfort', 'xl', 'wheelchair_accessible'];

const FEES = {booking_cents: 250, airport_cents: 500, cancellation_cents: 1000, no_show_cents: 1000, wait_per_min_cents: 50};

// Policy times in minutes unless named otherwise.
const POLICY = {
  quote_ttl_min: 10, change_token_ttl_min: 10,
  min_lead_min: 30, max_lead_days: 30,
  free_cancel_before_min: 60,
  free_wait_min: 5, airport_free_wait_after_landing_min: 60,
  tip_window_hours: 72, expense_window_days: 30,
  default_buffer_min: 20, max_buffer_min: 90,
  default_auto_shift_max_min: 360,
  overlap_margin_min: 15,
  max_tip_cents: 10000, max_child_seats: 2
};

// Local time bands used for travel times and supply. Night wraps midnight.
const BANDS = [
  {band: 'night', start: '22:00', end: '06:30'},
  {band: 'peak', start: '06:30', end: '09:30'},
  {band: 'offpeak', start: '09:30', end: '16:00'},
  {band: 'peak', start: '16:00', end: '19:00'},
  {band: 'offpeak', start: '19:00', end: '22:00'}
];
const BAND_NAMES = ['night', 'offpeak', 'peak'];

const ACTIVE = ['scheduled', 'driver_assigned', 'driver_arrived', 'on_trip', 'needs_attention'];
const FINAL = ['completed', 'cancelled', 'rider_no_show', 'lapsed'];
const STATUSES = [...ACTIVE, ...FINAL];
const ATTENTION_REASONS = ['large_shift', 'no_vehicle_after_shift', 'flight_cancelled', 'airport_changed', 'driver_cancelled'];
const FLIGHT_STATUSES = ['scheduled', 'on_time', 'delayed', 'early', 'cancelled', 'diverted', 'landed'];
const SUPPORT_REASONS = ['fare_review', 'wait_fee_review', 'lost_item', 'driver_no_show'];
const SHARE_SCOPES = ['status', 'status_and_eta'];
const PROFILES = ['personal', 'business'];

// Notification kinds, the short word used in their IDs, and who receives them.
const NOTIFICATION_KINDS = {
  booking_confirmed: {short: 'confirmed', role: 'booker'},
  booking_changed: {short: 'changed', role: 'booker'},
  needs_attention: {short: 'attention', role: 'booker'},
  booking_cancelled: {short: 'cancelled', role: 'booker'},
  driver_assigned: {short: 'assigned', role: 'booker_or_rider'},
  driver_arrived: {short: 'arrived', role: 'booker_or_rider'},
  receipt: {short: 'receipt', role: 'booker'},
  refund_settled: {short: 'refund', role: 'booker'},
  pickup_details: {short: 'pickup', role: 'rider'},
  share_started: {short: 'share', role: 'sharee'},
  share_update: {short: 'status', role: 'sharee'}
};
const NOTIFICATION_STATUSES = ['pending_delivery', 'no_recipient_channel', 'delivered', 'delivery_failed'];

const PLACE_KINDS = ['address', 'hotel', 'venue', 'airport_terminal'];

module.exports = {CATALOG_VERSION, FARE_VERSION, OPTIONS, OPTION_ORDER, FEES, POLICY, BANDS, BAND_NAMES, ACTIVE, FINAL, STATUSES,
  ATTENTION_REASONS, FLIGHT_STATUSES, SUPPORT_REASONS, SHARE_SCOPES, PROFILES, NOTIFICATION_KINDS, NOTIFICATION_STATUSES, PLACE_KINDS};
