"use strict";
const { fixture } = require("../tests/harness.cjs");
const f = fixture();
f.event(require("./scenario.json"));
console.log(
  JSON.stringify(
    {
      blocks: f.data.blocks,
      notice: "Maintenance is visible; no external message is sent.",
    },
    null,
    2,
  ),
);
