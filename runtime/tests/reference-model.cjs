'use strict';
const runtime=require('../core/runtime.cjs').createRuntime();
module.exports={...runtime,fixtures:{mail:runtime.configs.get('mail').seed,calendar:runtime.configs.get('calendar').seed},scenario:require('../../examples/apps/mail/examples/scenario.json'),busyEvent:require('../../examples/apps/calendar/examples/scenario.json')};
