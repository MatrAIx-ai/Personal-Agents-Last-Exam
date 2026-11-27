// apps/health-hub/scripts/generate_personas.cjs
const fs = require("fs");
const path = require("path");

const PERSONAS = [
  {
    id: "person_endurance_01",
    account_id: "acc_elena_runner",
    name: "Elena (Endurance Runner)",
    baselineRhr: 46,
    baselineHrv: 78,
    baselineWeight: 58.5,
    avgStrain: 14.5,
    gapDates: ["2025-10-14", "2025-10-15"], // Task #117 2-day physio gap
    goals: [
      { goal_id: "goal_elena_01", title: "Weekly mileage >= 45km", metric_type: "running_distance_km", target_value: 45, status: "active", due_date: "2026-01-31T23:59:59Z" }
    ],
    routines: [
      {
        routine_id: "rtn_morning_run",
        title: "Morning Aerobic Run",
        status: "active",
        blocks: [
          { block_id: "b1", name: "Dynamic Warmup", start_offset_minutes: 0, duration_minutes: 10 },
          { block_id: "b2", name: "Zone 2 Run", start_offset_minutes: 10, duration_minutes: 50 },
          { block_id: "b3", name: "Post-Run Stretch", start_offset_minutes: 60, duration_minutes: 15 }
        ]
      }
    ]
  },
  {
    id: "person_shiftworker_02",
    account_id: "acc_marcus_nurse",
    name: "Marcus (Shift Worker / Nurse)",
    baselineRhr: 58,
    baselineHrv: 45,
    baselineWeight: 82.0,
    avgStrain: 11.0,
    gapDates: ["2025-04-12", "2025-08-19"],
    goals: [
      { goal_id: "goal_marcus_01", title: "Sleep >= 7h post-night shift", metric_type: "sleep_duration_minutes", target_value: 420, status: "active", due_date: "2026-02-15T23:59:59Z" }
    ],
    routines: [
      {
        routine_id: "rtn_night_winddown",
        title: "Post-Shift Decompression",
        status: "active",
        blocks: [
          { block_id: "b1", name: "Blackout & White Noise Setup", start_offset_minutes: 0, duration_minutes: 15 },
          { block_id: "b2", name: "Breathwork", start_offset_minutes: 15, duration_minutes: 15 }
        ]
      }
    ]
  },
  {
    id: "person_deskworker_03",
    account_id: "acc_sophia_pm",
    name: "Sophia (Hybrid Knowledge Worker - Weight Management)",
    baselineRhr: 64,
    baselineHrv: 42,
    baselineWeight: 68.0, // Weight tracking for Task #52
    avgStrain: 8.5,
    gapDates: ["2025-07-04"],
    goals: [
      { goal_id: "goal_sophia_01", title: "Daily step target >= 8,000", metric_type: "step_count", target_value: 8000, status: "active", due_date: "2026-01-31T23:59:59Z" }
    ],
    routines: [
      {
        routine_id: "rtn_midday_walk",
        title: "Lunch Mobility Break",
        status: "active",
        blocks: [
          { block_id: "b1", name: "Outdoor Walk", start_offset_minutes: 0, duration_minutes: 30 }
        ]
      }
    ]
  },
  {
    id: "person_rehab_04",
    account_id: "acc_liam_recovery",
    name: "Liam (Physical Rehab)",
    baselineRhr: 62,
    baselineHrv: 50,
    baselineWeight: 76.5,
    avgStrain: 7.0,
    gapDates: ["2025-03-10", "2025-03-11", "2025-03-12"],
    goals: [
      { goal_id: "goal_liam_01", title: "Knee rehab exercises 4x/week", metric_type: "rehab_sessions", target_value: 4, status: "active", due_date: "2026-01-20T23:59:59Z" }
    ],
    routines: [
      {
        routine_id: "rtn_physio",
        title: "Prescribed PT Protocol",
        status: "active",
        blocks: [
          { block_id: "b1", name: "Isometric Holds", start_offset_minutes: 0, duration_minutes: 20 },
          { block_id: "b2", name: "Resistance Band Routine", start_offset_minutes: 20, duration_minutes: 25 }
        ]
      }
    ]
  },
  {
    id: "person_strength_05",
    account_id: "acc_zain_hybrid",
    name: "Zain (Powerlifter & Hybrid Athlete)",
    baselineRhr: 54,
    baselineHrv: 62,
    baselineWeight: 91.0,
    avgStrain: 13.0,
    gapDates: ["2025-11-27"],
    goals: [
      { goal_id: "goal_zain_01", title: "Maintain weight 90-92kg", metric_type: "body_weight_kg", target_value: 91, status: "active", due_date: "2026-03-01T23:59:59Z" }
    ],
    routines: [
      {
        routine_id: "rtn_heavy_upper",
        title: "Upper Body Strength Block",
        status: "active",
        blocks: [
          { block_id: "b1", name: "Rotator Cuff Prep", start_offset_minutes: 0, duration_minutes: 15 },
          { block_id: "b2", name: "Compound Lifts", start_offset_minutes: 15, duration_minutes: 60 }
        ]
      }
    ]
  }
];

function generateYearOfData(persona) {
  const daily_summaries = [];
  const workouts = [];
  const startDate = new Date("2025-01-01T00:00:00Z");
  const endDate = new Date("2025-12-31T00:00:00Z");
  let current = new Date(startDate);
  let weight = persona.baselineWeight;

  while (current <= endDate) {
    const dateStr = current.toISOString().slice(0, 10);
    const dayOfWeek = current.getUTCDay();

    if (persona.gapDates.includes(dateStr)) {
      daily_summaries.push({
        date: dateStr,
        status: "no_data",
        reason: "device_not_worn",
        metrics: null
      });
    } else {
      // Deterministic pseudo-random generation based on date and persona
      const seedVal = (current.getTime() / 86400000) * 0.1;
      const rhr = Math.round(persona.baselineRhr + Math.sin(seedVal) * 4);
      const hrv = Math.round(persona.baselineHrv + Math.cos(seedVal) * 8);
      const sleepMinutes = (dayOfWeek === 0 || dayOfWeek === 6) ? 480 + Math.round(Math.sin(seedVal) * 40) : 420 + Math.round(Math.cos(seedVal) * 30);
      const sleepScore = Math.min(98, Math.max(45, Math.round((sleepMinutes / 480) * 85)));
      const recoveryScore = Math.min(100, Math.max(25, Math.round((hrv / persona.baselineHrv) * 75)));
      const strain = parseFloat((persona.avgStrain + Math.sin(seedVal * 2) * 2.5).toFixed(1));

      // Gradual weight trend with realistic noise
      weight += (Math.sin(seedVal) * 0.05);

      daily_summaries.push({
        date: dateStr,
        status: "valid",
        metrics: {
          sleep: {
            duration_minutes: sleepMinutes,
            deep_sleep_minutes: Math.round(sleepMinutes * 0.22),
            rem_sleep_minutes: Math.round(sleepMinutes * 0.23),
            sleep_score: sleepScore
          },
          recovery: {
            resting_hr: rhr,
            hrv_rmssd: hrv,
            recovery_score: recoveryScore
          },
          day_strain: strain,
          body_weight_kg: parseFloat(weight.toFixed(1))
        }
      });

      // Periodic completed workout
      if (dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5) {
        workouts.push({
          workout_id: `wkt_${persona.id}_${dateStr}`,
          activity_type: "training_session",
          status: "completed",
          scheduled_at: `${dateStr}T17:30:00Z`,
          duration_minutes: 50,
          perceived_exertion: 7,
          avg_hr: rhr + 85
        });
      }
    }

    current.setUTCDate(current.getUTCDate() + 1);
  }

  return {
    account_id: persona.account_id,
    owner_person_id: persona.id,
    daily_summaries,
    workouts,
    goals: persona.goals,
    routine_templates: persona.routines,
    notifications: []
  };
}

const outDir = path.join(__dirname, "../fixtures/personas");
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

PERSONAS.forEach((persona) => {
  const seed = generateYearOfData(persona);
  const filePath = path.join(outDir, `${persona.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(seed, null, 2));
  console.log(`Generated fixture for ${persona.name} -> ${daily_summaries_count(seed)} days`);
});

function daily_summaries_count(s) {
  return s.daily_summaries.length;
}

// Write the default seed fixture to match Persona 1 (Elena)
const elenaSeed = generateYearOfData(PERSONAS[0]);
fs.writeFileSync(path.join(__dirname, "../fixtures/seed.json"), JSON.stringify(elenaSeed, null, 2));
console.log("\nDefault fixtures/seed.json refreshed with Persona 1 (Elena) full 2025 dataset!");
