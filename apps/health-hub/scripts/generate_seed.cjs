// apps/health-hub/scripts/generate_seed.cjs
const fs = require("fs");
const path = require("path");

const daily_summaries = [];
const startDate = new Date("2025-01-01T00:00:00Z");
const endDate = new Date("2025-12-31T00:00:00Z");

let currentDate = new Date(startDate);
let currentWeight = 75.0;

while (currentDate <= endDate) {
  const dateStr = currentDate.toISOString().slice(0, 10);
  
  // Simulate intentional 2-day sensor gap in October 2025 (for Task #117)
  if (dateStr === "2025-10-14" || dateStr === "2025-10-15") {
    daily_summaries.push({
      date: dateStr,
      status: "no_data",
      reason: "device_not_worn",
      metrics: null
    });
  } else {
    // Deterministic physiological variations
    const dayOfWeek = currentDate.getUTCDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    
    const sleepDuration = isWeekend ? 480 + Math.floor(Math.sin(currentDate.getTime()) * 30) : 420 + Math.floor(Math.cos(currentDate.getTime()) * 25);
    const restingHr = 52 + Math.floor(Math.abs(Math.sin(currentDate.getTime() / 1000000)) * 8);
    const hrv = 65 - (restingHr - 52) * 2;
    const strain = isWeekend ? 8.5 : 12.0 + Math.abs(Math.sin(currentDate.getTime())) * 4.0;
    
    currentWeight += (Math.random() - 0.5) * 0.1; // realistic drift

    daily_summaries.push({
      date: dateStr,
      status: "valid",
      metrics: {
        sleep: {
          duration_minutes: sleepDuration,
          deep_sleep_minutes: Math.round(sleepDuration * 0.2),
          rem_sleep_minutes: Math.round(sleepDuration * 0.25),
          sleep_score: Math.min(95, Math.max(50, Math.round((sleepDuration / 480) * 85)))
        },
        recovery: {
          resting_hr: restingHr,
          hrv_rmssd: hrv,
          recovery_score: Math.min(100, Math.max(20, Math.round(hrv * 1.2)))
        },
        day_strain: parseFloat(strain.toFixed(1)),
        body_weight_kg: parseFloat(currentWeight.toFixed(1))
      }
    });
  }

  currentDate.setUTCDate(currentDate.getUTCDate() + 1);
}

const seed = {
  account_id: "acc_jane_health_01",
  owner_person_id: "person_jane_01",
  daily_summaries,
  workouts: [
    {
      workout_id: "wkt_hist_01",
      activity_type: "running",
      status: "completed",
      scheduled_at: "2025-06-15T07:00:00Z",
      duration_minutes: 45,
      perceived_exertion: 7,
      avg_hr: 152
    },
    {
      workout_id: "wkt_seed_planned",
      activity_type: "running",
      status: "planned",
      scheduled_at: "2026-01-02T07:30:00Z",
      duration_minutes: 45
    }
  ],
  goals: [
    {
      goal_id: "goal_seed_01",
      title: "Sleep >= 7.5 hours",
      metric_type: "sleep_duration_minutes",
      target_value: 450,
      status: "active",
      due_date: "2026-01-31T23:59:59Z"
    }
  ],
  routine_templates: [
    {
      routine_id: "rtn_seed_morning",
      title: "Morning Focus Routine",
      status: "active",
      blocks: [
        { "block_id": "b1", "name": "Hydration & Sunlight", "start_offset_minutes": 0, "duration_minutes": 15 },
        { "block_id": "b2", "name": "Mobility & Stretching", "start_offset_minutes": 15, "duration_minutes": 30 }
      ]
    }
  ],
  notifications: []
};

fs.writeFileSync(path.join(__dirname, "../fixtures/seed.json"), JSON.stringify(seed, null, 2));
console.log(`Generated ${daily_summaries.length} days of history from 2025-01-01 to 2025-12-31!`);
