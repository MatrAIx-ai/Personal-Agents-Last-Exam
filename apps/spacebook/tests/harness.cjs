"use strict";
const assert = require("node:assert/strict"),
  path = require("node:path");
const { compile } = require("./schema-validator.cjs"),
  plugin = require("../plugin.cjs"),
  tools = require("../tools.json");
const root = path.resolve(__dirname, ".."),
  valid = compile(
    require("../schemas/seed.schema.json"),
    path.join(root, "schemas"),
  );
function fixture(seed = require("../fixtures/minimal.json")) {
  let data = structuredClone(seed);
  const ctx = {
    app_id: "spacebook",
    role: "agent",
    virtual_now: require("../fixtures/clock.json").initial_time,
    binding: structuredClone(require("../fixtures/binding.json")),
  };
  function validate(value) {
    assert.ok(valid(value), "Seed schema");
    plugin.validateSeed(ctx, value);
  }
  validate(data);
  let seq = 0;
  return {
    ctx,
    get data() {
      return structuredClone(data);
    },
    call(suffix, args = {}) {
      const name = suffix.startsWith("spacebook.")
          ? suffix
          : "spacebook." + suffix,
        tool = tools.find((t) => t.name === name);
      assert.ok(tool);
      const full = tool.read_only
        ? args
        : {
            ...args,
            request_id: "test-" + ++seq,
            expected_version: { epoch: 1, revision: seq },
          };
      assert.ok(compile(tool.inputSchema, root)(full), "Input schema " + name);
      const out = plugin.handleTool(ctx, structuredClone(data), name, full);
      validate(out.data);
      if (tool.read_only) assert.deepEqual(out.data, data);
      assert.ok(
        compile(
          tool.outputSchema,
          root,
        )({
          ...out.result,
          status: tool.read_only ? "ok" : "committed",
          app_id: "spacebook",
          version: { epoch: 1, revision: seq },
        }),
        "Output schema " + name,
      );
      data = out.data;
      return structuredClone(out.result);
    },
    event(event) {
      assert.ok(
        compile(
          require("../schemas/events.schema.json"),
          path.join(root, "schemas"),
        )(event),
        "Event schema",
      );
      const out = plugin.applyEvent(ctx, structuredClone(data), event);
      const previous = ctx.virtual_now;
      ctx.virtual_now = event.at;
      try {
        validate(out);
        data = out;
      } catch (e) {
        ctx.virtual_now = previous;
        throw e;
      }
      return structuredClone(data);
    },
  };
}
module.exports = { fixture };
