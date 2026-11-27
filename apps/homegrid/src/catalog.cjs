'use strict';
// Read-only App catalog (App state). Fictional round numbers, not a real utility's rates.
const CATALOG_VERSION = 'homegrid-catalog-1';
const SERVICE_TYPES = ['electricity', 'water', 'internet'];
const TARIFFS = {
  electricity: {per_unit_cents: 18, unit: 'kwh', customer_charge_cents: 1200},
  water: {per_unit_cents: 0.9, unit: 'gal', customer_charge_cents: 800}
};
const PLANS = [
  {plan_id: 'elec-standard', service_type: 'electricity', name: 'Standard residential', monthly_cents: 0, tech: null},
  {plan_id: 'water-standard', service_type: 'water', name: 'Standard residential', monthly_cents: 0, tech: null},
  {plan_id: 'net-fiber-300', service_type: 'internet', name: 'Fiber 300', monthly_cents: 6000, speed_mbps: 300, tech: 'fiber'},
  {plan_id: 'net-fiber-1000', service_type: 'internet', name: 'Fiber 1 Gig', monthly_cents: 8000, speed_mbps: 1000, tech: 'fiber'},
  {plan_id: 'net-cable-200', service_type: 'internet', name: 'Cable 200', monthly_cents: 5000, speed_mbps: 200, tech: 'cable'}
];
const FEES = {deposit: 15000, late_reschedule: 2500, missed_appointment_credit: -2000, returned_payment: 1500,
  unreturned_gateway: 12000, unreturned_hotspot: 15000, temporary_week: 1000, late_fee_rate: 0.015};
const POLICY = {utility_lead_business_days: 2, technician_lead_business_days: 3, shipping_business_days: 2,
  free_change_hours: 24, gateway_return_days: 30, hotspot_return_days: 7, hotspot_max_days: 30, bill_due_days: 21,
  late_grace_days: 5, outage_credit_hours: 24, token_minutes: 30, arrangement_min_cents: 5000,
  arrangement_lookback_days: 365, arrangement_first_due_days: 7, arrangement_interval_days: 30, late_payments_for_deposit: 2};
const SLOTS = {weekday: ['08-12', '12-16', '16-20'], saturday: ['08-12']};
const DEFAULT_CAPACITY = 2;
const TYPES = ['order', 'appointment', 'outage', 'advisory', 'billing'];
const HEALTH_ADVISORIES = ['boil_water', 'do_not_drink'];
module.exports = {CATALOG_VERSION, SERVICE_TYPES, TARIFFS, PLANS, FEES, POLICY, SLOTS, DEFAULT_CAPACITY, TYPES, HEALTH_ADVISORIES};
