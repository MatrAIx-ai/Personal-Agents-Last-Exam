#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),c=require('../src/common.cjs');
const root=path.resolve(__dirname,'..'),at='2026-11-24T09:00:00-08:00';
const policies=[
 ['bloom',1200,1600,300,30,60],['craft',1400,1800,0,30,60],['grove',1100,1500,250,30,60],
 ['home',900,1300,200,20,45],['studio',2000,2400,0,30,60],['work',1700,2100,350,25,60]
].map(([tld,first,renewal,privacy,grace,lock])=>({id:`tld-${tld}`,tld,first_year_price_cents:first,renewal_price_cents:renewal,privacy_price_cents:privacy,transfer_price_cents:renewal,min_years:1,max_years:5,grace_days:grace,transfer_lock_days:lock,restrictions:tld==='home'?'Synthetic personal-use contact required.':'No live registry; synthetic evaluation use only.'}));
const contacts=[
 {id:'contact-primary',label:'Primary synthetic registrant',eligible:true,country:'US',privacy_eligible:true},
 {id:'contact-business',label:'Northwind Workshop',eligible:true,country:'US',privacy_eligible:true},
 {id:'contact-eu',label:'Juniper Studio EU',eligible:true,country:'DE',privacy_eligible:true},
 {id:'contact-expired',label:'Expired verification profile',eligible:false,country:'US',privacy_eligible:false},
 {id:'contact-minor',label:'Ineligible synthetic profile',eligible:false,country:'CA',privacy_eligible:false}
];
const payments=[
 {id:'payment-amber',label:'Amber Card',brand:'Aster',last_four:'4242',expires_at:'2028-12-01T00:00:00Z',status:'active',next_outcome:'approved'},
 {id:'payment-slate',label:'Slate Card',brand:'Morrow',last_four:'0911',expires_at:'2028-08-01T00:00:00Z',status:'active',next_outcome:'declined'}
];
const specs=[
 ['riverstone.bloom','active','2027-05-12T17:00:00Z',true,'contact-primary','payment-amber'],
 ['emberloom.craft','expiring','2026-12-01T17:00:00Z',false,'contact-business','payment-amber'],
 ['northpine.grove','expired_grace','2026-11-20T17:00:00Z',false,'contact-primary','payment-slate'],
 ['meadowgrid.home','redemption','2026-10-01T17:00:00Z',false,'contact-primary','payment-amber'],
 ['brightforge.studio','transferred','2027-02-01T17:00:00Z',false,'contact-business','payment-amber'],
 ['juniperdesk.work','deleted','2026-08-01T17:00:00Z',false,'contact-eu','payment-amber'],
 ['cedarpath.bloom','active','2026-11-30T17:00:00Z',true,'contact-primary','payment-amber'],
 ['silverquill.craft','active','2027-07-15T17:00:00Z',false,'contact-eu','payment-amber'],
 ['harborframe.grove','active','2027-09-09T17:00:00Z',false,'contact-business','payment-amber'],
 ['mapledger.work','active','2027-01-10T17:00:00Z',false,'contact-primary','payment-amber']
];
const domains=specs.map(([domain,status,expires,auto,contact,payment],i)=>{const p=policies.find(x=>domain.endsWith(`.${x.tld}`));return {id:`domain-${i+1}`,domain,status,contact_profile_id:contact,payment_method_id:payment,privacy:i%2===0,auto_renew:auto,registered_at:`2025-${String((i%9)+1).padStart(2,'0')}-10T17:00:00Z`,expires_at:expires,grace_ends_at:status==='expired_grace'?'2026-12-20T17:00:00Z':null,transfer_lock:domain!=='mapledger.work',last_transfer_at:i===4?'2026-06-01T17:00:00Z':null,accepted_price:{registration_total_cents:p.first_year_price_cents,renewal_price_cents:p.renewal_price_cents,currency:'USD'},accepted_policy:{tld:p.tld,renewal_price_cents:p.renewal_price_cents,grace_days:p.grace_days,transfer_lock_days:p.transfer_lock_days,restrictions:p.restrictions},version:1,updated_at:'2026-11-22T17:00:00Z',auth_code_hash:null,auth_code_expires_at:null,auth_code_used_at:null};});
const stems=['riverstone','emberloom','northpine','meadowgrid','brightforge','juniperdesk','cedarpath'];
const owned=new Map(domains.map(d=>[d.domain,d.id])),availability=[];
for(const stem of stems)for(const p of policies){const domain=`${stem}.${p.tld}`;availability.push({id:c.id('availability',domain),domain,status:owned.has(domain)?'unavailable':stem==='northpine'&&p.tld==='work'?'reserved':'available',reserved_reason:stem==='northpine'&&p.tld==='work'?'Reserved synthetic registry label.':null,owner_domain_id:owned.get(domain)||null});}
const zones=domains.map((d,i)=>{const records=[];if(!['deleted'].includes(d.status)){records.push({id:`dns-${i+1}-a`,type:'A',name:'@',value:`192.0.2.${10+i}`,ttl:3600,priority:null},{id:`dns-${i+1}-txt`,type:'TXT',name:'@',value:`namegrove-fixture-${i+1}`,ttl:3600,priority:null},{id:`dns-${i+1}-mx`,type:'MX',name:'@',value:`mail${i+1}.example.test`,ttl:3600,priority:10});if(i<9)records.push({id:`dns-${i+1}-www`,type:'CNAME',name:'www',value:`site${i+1}.example.test`,ttl:1800,priority:null});}const mode=d.domain==='silverquill.craft'?'custom':'hosted',nameservers=mode==='custom'?['ns1.example.test','ns2.example.test']:[];return {id:`zone-${i+1}`,domain_id:d.id,mode,nameservers,records,version:1,revisions:[{id:`zone-${i+1}-revision-1`,version:1,action:'fixture_loaded',at:'2026-11-01T17:00:00Z',before:null,after:{mode,nameservers,records:structuredClone(records)}}]};});
const charges=domains.slice(0,7).map((d,i)=>({id:`charge-history-${i+1}`,idempotency_key:`fixture-charge-${i+1}`,domain_id:d.id,kind:'registration',years:1,currency:'USD',items:[{description:'Synthetic registration',quantity:1,unit_price_cents:d.accepted_price.registration_total_cents,amount_cents:d.accepted_price.registration_total_cents}],subtotal_cents:d.accepted_price.registration_total_cents,tax_cents:0,total_cents:d.accepted_price.registration_total_cents,charged_at:d.registered_at}));
const renewal_attempts=[{id:'renewal-attempt-failed',domain_id:'domain-3',payment_method_id:'payment-slate',scheduled_expiration:'2026-11-20T17:00:00Z',status:'failed',years:1,created_at:'2026-11-15T17:00:00Z',updated_at:'2026-11-15T17:05:00Z',outcome_event_id:'fixture-payment-failed',charge_id:null,reason:'Seeded decline'}];
const transfers=[
 {id:'transfer-outbound-pending',direction:'outbound',domain_id:'domain-10',target_domain:'mapledger.work',status:'pending',fee_cents:0,contact_profile_id:'contact-primary',payment_method_id:'payment-amber',created_at:'2026-11-23T17:00:00Z',updated_at:'2026-11-23T17:00:00Z',cancellable_until:'2026-11-26T17:00:00Z',reason:null,version:1},
 {id:'transfer-inbound-pending',direction:'inbound',domain_id:null,target_domain:'incoming.grove',status:'pending',fee_cents:1500,contact_profile_id:'contact-business',payment_method_id:'payment-amber',created_at:'2026-11-22T17:00:00Z',updated_at:'2026-11-22T17:00:00Z',cancellable_until:'2026-11-25T17:00:00Z',reason:null,version:1},
 {id:'transfer-outbound-complete',direction:'outbound',domain_id:'domain-5',target_domain:'brightforge.studio',status:'completed',fee_cents:0,contact_profile_id:'contact-business',payment_method_id:'payment-amber',created_at:'2026-05-01T17:00:00Z',updated_at:'2026-06-01T17:00:00Z',cancellable_until:'2026-05-03T17:00:00Z',reason:'Registry completed',version:3},
 {id:'transfer-inbound-rejected',direction:'inbound',domain_id:null,target_domain:'locked.home',status:'rejected',fee_cents:1300,contact_profile_id:'contact-primary',payment_method_id:'payment-amber',created_at:'2026-09-01T17:00:00Z',updated_at:'2026-09-02T17:00:00Z',cancellable_until:'2026-09-03T17:00:00Z',reason:'Registry lock',version:2},
 {id:'transfer-inbound-cancelled',direction:'inbound',domain_id:null,target_domain:'cancelled.craft',status:'cancelled',fee_cents:1800,contact_profile_id:'contact-eu',payment_method_id:'payment-amber',created_at:'2026-10-01T17:00:00Z',updated_at:'2026-10-01T18:00:00Z',cancellable_until:'2026-10-03T17:00:00Z',reason:'User changed plans',version:2}
];
const notice=(id,domainId,kind,title,body,created,deadline=null)=>({id,dedupe_key:`fixture:${id}`,domain_id:domainId,kind,title,body,deadline,status:'unread',created_at:created,email_status:'not_prepared',email_request_id:null,email_receipt_id:null,email_message:null,delivery_attempts:0,reconciliation_required:false});
const notifications=[
 notice('notification-expiring','domain-2','expiration_reminder','emberloom.craft expires soon','Review renewal and payment settings. This reminder performs no renewal.','2026-11-24T08:00:00-08:00','2026-12-01T17:00:00Z'),
 notice('notification-failed','domain-3','renewal_failure','Auto-renew failed for northpine.grove','The Slate Card was declined. Retry with another saved method.','2026-11-15T09:05:00-08:00','2026-12-20T17:00:00Z'),
 notice('notification-grace','domain-3','expiration','northpine.grove is in grace','Renew before grace ends; DNS changes and outbound transfer are blocked.','2026-11-20T09:00:00-08:00','2026-12-20T17:00:00Z'),
 notice('notification-transfer','domain-5','transfer_status','brightforge.studio transfer completed','The outbound transfer completed.','2026-06-01T10:00:00-07:00'),
 notice('notification-registration','domain-1','registration_confirmation','riverstone.bloom is registered','Registration confirmation for the synthetic domain.','2026-05-12T10:00:00-07:00')
];
const data={fixture_generated_at:at,account_id:'namegrove-maya',owner_person_id:'person-maya',settings:{email_enabled:true,mail_account_id:'mail-maya',tax_basis_points:825},tld_policies:policies,availability,contact_profiles:contacts,payment_methods:payments,quotes:[],domains,zones,charges,renewal_attempts,transfers,notifications,inbound_authorizations:[{id:'inbound-auth-cedar',domain:'newarrival.grove',code_hash:c.hash('INBOUND-CEDAR-2026'),expires_at:'2026-12-31T23:59:59Z',used_at:null}],processed_event_ids:[]};
fs.writeFileSync(path.join(root,'fixtures/minimal.json'),JSON.stringify(data,null,2)+'\n');
const objectIds=['tld_policies','availability','contact_profiles','payment_methods','domains','zones','charges','renewal_attempts','transfers','notifications'].flatMap(k=>data[k].map(x=>x.id));
const binding={people:[{person_id:'person-maya',name:'Maya Chen'}],accounts:[{app_id:'namegrove-domains',account_id:data.account_id,owner_person_id:'person-maya'},{app_id:'mail',account_id:'mail-maya',owner_person_id:'person-maya'}],objects:{'namegrove-domains':objectIds}};
fs.writeFileSync(path.join(root,'fixtures/binding.json'),JSON.stringify(binding,null,2)+'\n');
fs.writeFileSync(path.join(root,'fixtures/clock.json'),JSON.stringify({initial_time:at},null,2)+'\n');
console.log(`Generated ${policies.length} TLDs, ${availability.length} candidates, ${domains.length} domains, ${zones.reduce((n,z)=>n+z.records.length,0)} DNS records, ${transfers.length} transfers.`);
