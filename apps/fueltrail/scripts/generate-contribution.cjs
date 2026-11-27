#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..'),tools=require('../tools.json');
const admin=['env.reset','env.load_seed','env.apply_event','env.snapshot','env.event_status','env.validate_bundle'];
const contribution={
 schema_version:'pale.app-contribution.v1',contract_revision:'0.4.0',app_id:'fueltrail',app_categories:['external'],runtime_manifest_ref:'app.json',
 interfaces:[
  {interface_id:'agent-mcp',transport:'mcp.stdio',audience:['agent'],status:'implemented',entrypoint_ref:'service.cjs --role agent',operations:tools.map(t=>({name:t.name,effect:t.read_only?'read':'write',caller:'agent'}))},
  {interface_id:'infra-mcp',transport:'mcp.stdio',audience:['infra'],status:'implemented',entrypoint_ref:'service.cjs --role infra',operations:admin.map(name=>({name,effect:'admin',caller:'infra'}))}
 ],
 state:{owner:'app',isolation_keys:['run_id','app_id'],seed_schema_ref:'schemas/seed.schema.json',snapshot_includes_assets:true,reset_scope:'app_instance',version_checks:'implemented',idempotent_writes:'implemented',concurrency_control:'Per-App lock plus Core epoch/revision and App record-version checks',commit_confirmation:'committed + epoch/revision; failures preserve business state',outbox_atomic_with_business_state:'unsupported'},
 events:{accepts:['fuel.price_observed','fuel.station_status_changed','fuel.station_details_changed'].map(type=>({type,schema_ref:'schemas/events.schema.json',status:'implemented'})),emits:[],trigger_owner:'task_and_infra'},
 shared_data:{identity_binding_ref:'fixtures/binding.json',account_model_ref:'schemas/seed.schema.json',cross_app_references:true,asset_catalog_refs:['assets.catalog.json']},gui_ref:'gui.json',notification_channels:['channel.email'],
 subscriptions:{business_owner:'source_app',routing_owner:'infra',task_binding_required:true,preferences_seed_ref:null,status:'unsupported'},
 dependencies:{core_api:'1.2.0',required_apps:[],services:[]},extensions:[],
 asset_runtime:{implemented_descriptor_versions:['pale.asset-descriptor.v1'],implemented_mime_types:['image/png','image/jpeg','audio/mpeg','audio/wav','video/mp4','application/json','application/pdf','text/calendar','text/plain'],implemented_storage_adapters:['storage.file','storage.inline'],max_assets:64,max_bundle_bytes:1048576},
 messaging:{publishes:[{channel:'channel.email',schema_id:'urn:pale:email-message:2',schema_ref:'schemas/router-message.schema.json',status:'implemented',event_type:'org.pale.mail.notification.v1',payload_schema_id:'urn:pale:email-payload:1'}],receives:[],envelope:'cloudevents/1.0'}
};
fs.writeFileSync(path.join(root,'contribution/contribution.json'),JSON.stringify(contribution,null,2)+'\n');
console.log('Generated Fueltrail contribution declaration.');
