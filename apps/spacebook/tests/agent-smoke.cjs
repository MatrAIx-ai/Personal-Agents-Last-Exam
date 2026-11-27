"use strict";
// Optional paid acceptance trial. Only synthetic business context/tools are sent to the API.
// The grader, Infra connection, snapshots and scenario schedule never enter model messages.
const fs = require("node:fs"),
  path = require("node:path"),
  https = require("node:https");
const runtime = require("./runtime-path.cjs"),
  { prepare } = require(path.join(runtime, "prepare.cjs")),
  { Client } = require(path.join(runtime, "client.cjs")),
  { digestTree } = require(path.join(runtime, "verify.cjs"));
const app = path.resolve(__dirname, ".."),
  out = path.resolve(
    process.env.SPACEBOOK_REPORT_DIR || ".artifacts/spacebook",
  );
const models = ["gpt-4.1-mini-2025-04-14", "gpt-4.1-2025-04-14"];
const endpoint = new URL(
  (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(
    /\/$/,
    "",
  ) + "/chat/completions",
);
if (endpoint.protocol !== "https:") throw Error("Use an HTTPS model endpoint.");
// Deliberately conservative reservation, not a claim about current invoice rates.
const reserveInputRate = 10 / 1e6,
  reserveOutputRate = 40 / 1e6,
  maxBudget = 30,
  maxRounds = 16,
  maxOutput = 1200;
let reservationSpent = 0;
function completion(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload),
      reserve =
        Buffer.byteLength(body) * reserveInputRate +
        maxOutput * reserveOutputRate;
    if (reservationSpent + reserve > maxBudget)
      return reject(
        Error(
          "Local conservative budget reservation exceeded; no request sent.",
        ),
      );
    reservationSpent += reserve;
    const req = https.request(
      endpoint,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + process.env.OPENAI_API_KEY,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (b) => {
          raw += b;
        });
        res.on("end", () => {
          if (res.statusCode !== 200)
            return reject(Error("Model API HTTP " + res.statusCode));
          try {
            resolve(JSON.parse(raw));
          } catch {
            reject(Error("Invalid model response JSON"));
          }
        });
      },
    );
    req.setTimeout(45000, () => req.destroy(Error("Model request timeout")));
    req.on("error", (e) => reject(Error("Model transport failed: " + e.code)));
    req.end(body);
  });
}
function grade(data, scenario) {
  const active = data.bookings.filter(
    (b) => b.owner_person_id === "person-maya" && b.status === "confirmed",
  );
  const b = active[0],
    room = b && data.resources.find((r) => r.id === b.room_id);
  return {
    one_active: active.length === 1,
    suitable:
      !!room &&
      room.capacity >= 8 &&
      room.step_free === true &&
      (room.video === true ||
        b.equipment_ids.some(
          (id) => data.resources.find((r) => r.id === id)?.video === true,
        )),
    correct_time:
      !!b &&
      Date.parse(b.start_at) === Date.parse("2026-12-08T22:00:00Z") &&
      Date.parse(b.end_at) === Date.parse("2026-12-08T23:00:00Z"),
    no_active_holds: !data.holds.some(
      (h) => h.owner_person_id === "person-maya" && h.status === "active",
    ),
    replacement: scenario === "ordinary" || !!b?.previous_id,
  };
}
(async () => {
  if (!process.env.OPENAI_API_KEY)
    throw Error(
      "Set OPENAI_API_KEY; credentials are never written to reports.",
    );
  fs.mkdirSync(out, { recursive: true });
  const prepared = prepare(app),
    batch = {
      kind: "spacebook-agent-smoke",
      checked_at: new Date().toISOString(),
      app_sha256: digestTree(app),
      runtime: require(path.join(runtime, "package.json")).version,
      node: process.version,
      models,
      configuration: {
        temperature: 0,
        max_rounds: maxRounds,
        max_completion_tokens: maxOutput,
        parallel_tool_calls: false,
        budget_reservation_cap_usd: maxBudget,
        input_reserve_per_million: 10,
        output_reserve_per_million: 40,
      },
      runs: [],
      purpose:
        "Environment usability smoke only; not Task difficulty qualification.",
    };
  try {
    for (const model of models)
      for (const scenario of ["ordinary", "outage-replacement"]) {
        const run = "smoke-" + batch.runs.length,
          clients = [],
          trace = {
            model,
            scenario,
            run_id: run,
            messages: [],
            model_responses: [],
            infra_events: [],
            tool_results: [],
            grade: null,
            completed: false,
          };
        try {
          const infra = new Client(
            "spacebook",
            "infra",
            run,
            path.join(prepared.root, "state"),
            "smoke-runner",
            { registry: prepared.registry, initialProfile: "sandbox" },
          );
          clients.push(infra);
          await infra.initialize();
          const agent = new Client(
            "spacebook",
            "agent",
            run,
            path.join(prepared.root, "state"),
            "model-agent",
            { registry: prepared.registry },
          );
          clients.push(agent);
          await agent.initialize();
          const toolDefs = (await agent.request("tools/list")).result.tools,
            map = new Map(
              toolDefs.map((t, i) => ["spacebook_tool_" + i, t.name]),
            );
          const tools = toolDefs.map((t, i) => ({
            type: "function",
            function: {
              name: "spacebook_tool_" + i,
              description: t.name + ": " + t.description,
              parameters: t.inputSchema,
            },
          }));
          const bundle = {
            room_id: "room-cedar",
            equipment_ids: ["equipment-1"],
            title: "Planning",
            start_at: "2026-12-08T22:00:00Z",
            end_at: "2026-12-08T23:00:00Z",
          };
          if (scenario === "outage-replacement") {
            for (const [i, action, args] of [
              [0, "holds.create", bundle],
              [1, "holds.confirm", { id: "hold-1" }],
            ]) {
              const before = await infra.call("env.snapshot");
              const event = {
                event_id: "setup-" + i,
                at: before.snapshot.virtual_now,
                operation: "spacebook.actor_action",
                payload: { actor_person_id: "person-maya", action, args },
              };
              const result = await infra.call("env.apply_event", {
                expected_version: before.version,
                event,
              });
              if (result.status !== "committed") throw Error("Setup failed");
              trace.infra_events.push({ event, result });
            }
            const before = await infra.call("env.snapshot");
            const event = require("../examples/scenario.json");
            const result = await infra.call("env.apply_event", {
              expected_version: before.version,
              event,
            });
            if (result.status !== "committed")
              throw Error("Outage setup failed");
            trace.infra_events.push({ event, result });
          }
          const messages = [
            {
              role: "system",
              content:
                "You are a personal assistant operating a synthetic workplace reservation application. Act only through the provided business tools. Read current state before deciding. Writes require the exact version returned by a read and a unique retry-stable request_id. These are concurrency metadata, not approval gates. The user authorizes the requested booking action. Finish with a concise explanation.",
            },
            {
              role: "user",
              content:
                scenario === "ordinary"
                  ? "I am Maya. Book a room for eight people on December 8, 2026, from 2 pm to 3 pm Los Angeles time. We need step-free access and video conferencing, built in or using a compatible camera. Confirm one suitable booking, release any unused holds, and leave other bookings alone."
                  : "I am Maya. My Planning reservation for eight people on December 8, 2026, from 2 pm to 3 pm Los Angeles time was disrupted by maintenance. Replace that reservation with a suitable room at the same time, retaining step-free access and video conferencing. Confirm exactly one replacement and leave unrelated bookings alone.",
            },
          ];
          for (let step = 0; step < maxRounds; step++) {
            const result = await completion({
              model,
              messages,
              tools,
              temperature: 0,
              parallel_tool_calls: false,
              max_completion_tokens: maxOutput,
              store: false,
            });
            trace.model_responses.push(result);
            const message = result.choices?.[0]?.message;
            if (!message) throw Error("Model response has no message");
            messages.push(message);
            if (!message.tool_calls?.length) {
              trace.completed = true;
              break;
            }
            for (const tc of message.tool_calls) {
              const name = map.get(tc.function.name);
              let response;
              try {
                const args = JSON.parse(tc.function.arguments);
                response = name
                  ? await agent.call(name, args)
                  : { status: "unknown_tool" };
                trace.tool_results.push({ name, args, response });
              } catch (e) {
                response = {
                  status: "adapter_error",
                  message: "Invalid tool request",
                };
              }
              messages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: JSON.stringify(response),
              });
            }
          }
          trace.messages = messages;
          const final = await infra.call("env.snapshot");
          trace.final_business_state = final.snapshot.data;
          trace.audit = final.snapshot.audit;
          trace.grade = grade(final.snapshot.data, scenario);
          trace.passed = Object.values(trace.grade).every(Boolean);
          trace.usage = trace.model_responses.reduce(
            (a, r) => ({
              prompt_tokens: a.prompt_tokens + (r.usage?.prompt_tokens || 0),
              completion_tokens:
                a.completion_tokens + (r.usage?.completion_tokens || 0),
            }),
            { prompt_tokens: 0, completion_tokens: 0 },
          );
        } catch (e) {
          trace.error = e.message;
          trace.passed = false;
        } finally {
          await Promise.allSettled(clients.map((c) => c.close()));
          fs.writeFileSync(
            path.join(out, run + ".json"),
            JSON.stringify(trace, null, 2) + "\n",
          );
          batch.runs.push({
            model,
            scenario,
            trace: run + ".json",
            passed: trace.passed,
            completed: trace.completed,
            grade: trace.grade,
            usage: trace.usage,
            error: trace.error,
          });
          console.log(JSON.stringify(batch.runs.at(-1)));
        }
      }
  } finally {
    prepared.cleanup();
    batch.conservative_reserved_usd = reservationSpent;
    batch.passed = batch.runs.length === 4 && batch.runs.every((r) => r.passed);
    batch.billing_note =
      "Reservation is an intentionally conservative bound at configured rates, not an API invoice; actual token usage is recorded per run.";
    fs.writeFileSync(
      path.join(out, "agent-smoke.json"),
      JSON.stringify(batch, null, 2) + "\n",
    );
    if (!batch.passed) process.exitCode = 1;
  }
})();
