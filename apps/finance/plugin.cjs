'use strict';
const {business} = require('./src/bridge.cjs');
const records = data => ['accounts', 'proposals', 'receipts', 'transactions', 'assessments',
  'instruments', 'quotes', 'market_history', 'announcements', 'obligations', 'rules'].flatMap(key => data[key]);
module.exports = {
  validateSeed: (ctx, data) => { business(ctx, data, {mode: 'validate'}); },
  handleTool: (ctx, data, name, args) => business(ctx, data, {mode: 'tool', name, args}),
  applyEvent: (ctx, data, event) => business(ctx, data, {mode: 'event', event}).data,
  records,
  objects: data => records(data).map(row => row.id),
  references: () => []
};
