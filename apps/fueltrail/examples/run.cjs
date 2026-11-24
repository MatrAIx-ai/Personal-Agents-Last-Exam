'use strict';
const {fixture}=require('../tests/harness.cjs');
const f=fixture(),before=f.call('fueltrail.station.search',{place_id:'place-harbor',grade:'regular',price_type:'cash',radius_milli:10000,sort:'price'});
f.event(require('./scenario.json'));
const alerts=f.call('fueltrail.price_alert.list',{include_deleted:false});
const triggered=alerts.notifications.find(x=>x.triggered_at==='2026-11-23T09:00:00-08:00');
if(!triggered)throw Error('Approved workflow did not produce its price notification');
console.log(JSON.stringify({before_search:before.results.slice(0,3),triggered_notification:triggered,diagnostic_steps:f.logs},null,2));
