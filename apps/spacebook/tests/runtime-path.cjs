"use strict";
const fs = require("node:fs"),
  path = require("node:path");
let root = path.resolve(__dirname, "..");
while (
  !process.env.PALE_RUNTIME_ROOT &&
  !fs.existsSync(path.join(root, "runtime/client.cjs"))
) {
  const parent = path.dirname(root);
  if (parent === root)
    throw Error(
      "Set PALE_RUNTIME_ROOT to the pinned public runtime directory.",
    );
  root = parent;
}
module.exports = process.env.PALE_RUNTIME_ROOT
  ? path.resolve(process.env.PALE_RUNTIME_ROOT)
  : path.join(root, "runtime");
