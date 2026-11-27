"use strict";
module.exports = {
  ...require("./src/model.cjs"),
  handleTool: require("./src/domain.cjs").handleTool,
  applyEvent: require("./src/domain.cjs").applyEvent,
};
