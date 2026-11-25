// apps/health-hub/gui/src/app.js
document.addEventListener("DOMContentLoaded", async () => {
  // Navigation Routing
  const navBtns = document.querySelectorAll(".nav-btn");
  const panels = document.querySelectorAll(".view-panel");
  const pageTitle = document.getElementById("page-title");

  navBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      navBtns.forEach((b) => b.classList.remove("active"));
      panels.forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      const tabId = btn.getAttribute("data-tab");
      document.getElementById(tabId).classList.add("active");
      pageTitle.innerText = btn.innerText;
    });
  });

  // Data Fetching: uses local fixtures or Host API bridge
  let state = null;
  try {
    const res = await fetch("/api/state");
    if (res.ok) {
      state = await res.json();
    }
  } catch (err) {
    console.warn("Host API not reachable, falling back to bundled seed fixture", err);
  }

  if (!state) {
    try {
      const res = await fetch("../fixtures/seed.json");
      state = await res.json();
    } catch (e) {
      console.error("Failed to load initial state", e);
      return;
    }
  }

  renderApp(state);
});

function renderApp(state) {
  document.getElementById("user-badge").innerText = `User: ${state.owner_person_id}`;

  // Get most recent valid daily summary
  const validSummaries = (state.daily_summaries || []).filter((s) => s.status === "valid");
  const latest = validSummaries[validSummaries.length - 1];

  if (latest && latest.metrics) {
    const { sleep, recovery, day_strain, body_weight_kg } = latest.metrics;
    document.getElementById("val-recovery").innerText = `${recovery.recovery_score}%`;
    document.getElementById("val-rhr").innerText = `RHR: ${recovery.resting_hr} bpm | HRV: ${recovery.hrv_rmssd} ms`;

    const hrs = Math.floor(sleep.duration_minutes / 60);
    const mins = sleep.duration_minutes % 60;
    document.getElementById("val-sleep").innerText = `${hrs}h ${mins}m`;
    document.getElementById("val-sleep-score").innerText = `Sleep Score: ${sleep.sleep_score}`;

    document.getElementById("val-strain").innerText = `${day_strain}`;
    if (body_weight_kg) {
      document.getElementById("val-weight").innerText = `${body_weight_kg} kg`;
    }
  }

  // Render Biometrics Table (Past 7 Records)
  const tbody = document.getElementById("biometrics-tbody");
  tbody.innerHTML = "";
  const recentDays = (state.daily_summaries || []).slice(-7).reverse();

  recentDays.forEach((row) => {
    const tr = document.createElement("tr");
    if (row.status === "no_data") {
      tr.innerHTML = `
        <td><strong>${row.date}</strong></td>
        <td><span class="badge badge-warning">No Data (${row.reason})</span></td>
        <td>--</td><td>--</td><td>--</td><td>--</td><td>--</td>
      `;
    } else {
      const m = row.metrics;
      tr.innerHTML = `
        <td><strong>${row.date}</strong></td>
        <td><span class="badge badge-success">Recorded</span></td>
        <td>${m.recovery.recovery_score}%</td>
        <td>${Math.round(m.sleep.duration_minutes / 60)}h ${m.sleep.duration_minutes % 60}m</td>
        <td>${m.recovery.resting_hr} bpm</td>
        <td>${m.recovery.hrv_rmssd} ms</td>
        <td>${m.day_strain}</td>
      `;
    }
    tbody.appendChild(tr);
  });

  // Render Workouts
  const wkTbody = document.getElementById("workouts-tbody");
  const recentWorkoutsList = document.getElementById("recent-workouts-list");
  wkTbody.innerHTML = "";
  recentWorkoutsList.innerHTML = "";

  (state.workouts || []).forEach((w) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${w.workout_id}</td>
      <td><strong>${w.activity_type}</strong></td>
      <td><span class="badge badge-${w.status}">${w.status}</span></td>
      <td>${w.scheduled_at || w.logged_at || "--"}</td>
      <td>${w.duration_minutes} min</td>
      <td>${w.avg_hr ? w.avg_hr + " bpm" : "--"}</td>
    `;
    wkTbody.appendChild(tr);

    if (w.status === "planned") {
      const li = document.createElement("li");
      li.innerText = `${w.activity_type} (${w.duration_minutes}m) - Scheduled: ${w.scheduled_at}`;
      recentWorkoutsList.appendChild(li);
    }
  });

  if (recentWorkoutsList.children.length === 0) {
    recentWorkoutsList.innerHTML = "<li class='empty-state'>No upcoming planned workouts</li>";
  }

  // Render Goals
  const goalsList = document.getElementById("goals-list");
  goalsList.innerHTML = "";
  (state.goals || []).forEach((g) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <div class="goal-item">
        <strong>${g.title}</strong>
        <span class="badge badge-${g.status}">${g.status}</span>
        <p class="subtext">Target: ${g.target_value} (${g.metric_type}) | Due: ${g.due_date || "Open"}</p>
      </div>
    `;
    goalsList.appendChild(li);
  });

  // Render Routines
  const routinesContainer = document.getElementById("routines-container");
  routinesContainer.innerHTML = "";
  (state.routine_templates || []).forEach((rtn) => {
    const card = document.createElement("div");
    card.className = "card routine-card";
    card.innerHTML = `
      <h4>${rtn.title} <span class="badge badge-${rtn.status}">${rtn.status}</span></h4>
      <ol class="blocks-list">
        ${(rtn.blocks || []).map((b) => `<li>${b.name} (${b.duration_minutes}m)</li>`).join("")}
      </ol>
    `;
    routinesContainer.appendChild(card);
  });

  // Render Notifications
  const notifList = document.getElementById("notification-list");
  if ((state.notifications || []).length > 0) {
    notifList.innerHTML = "";
    state.notifications.forEach((n) => {
      const li = document.createElement("li");
      li.innerHTML = `<strong>[${n.type}]</strong> ${n.message} <span class="subtext">${n.created_at}</span>`;
      notifList.appendChild(li);
    });
  }
}
