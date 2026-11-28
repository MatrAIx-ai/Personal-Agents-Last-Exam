'use strict';
const c=require('./common.cjs'),r=require('./rules.cjs');
function validateSeed(ctx,data){
 const groups=['tld_policies','availability','contact_profiles','payment_methods','quotes','domains','zones','charges','renewal_attempts','transfers','notifications'].map(k=>data[k]);const ids=new Set();
 for(const group of groups)for(const item of group){if(ids.has(item.id))c.fail('invalid_seed','Business IDs must be globally unique.');ids.add(item.id);}
 if(data.account_id!==ctx.binding.accounts.find(x=>x.app_id==='namegrove-domains')?.account_id)c.fail('invalid_seed','Namegrove account does not match its binding.');
 const domains=new Map(data.domains.map(x=>[x.id,x]));for(const d of data.domains){r.fqdn(d.domain);r.policy(data,d.domain);if(!data.contact_profiles.some(x=>x.id===d.contact_profile_id)||!data.payment_methods.some(x=>x.id===d.payment_method_id))c.fail('invalid_seed','Domain profile references are invalid.');}
 for(const z of data.zones){if(!domains.has(z.domain_id))c.fail('invalid_seed','Zone domain reference is invalid.');for(const record of z.records)r.dnsFields(record);}
 for(const t of data.transfers)if(t.domain_id&&!domains.has(t.domain_id))c.fail('invalid_seed','Transfer domain reference is invalid.');
 for(const n of data.notifications){if(!domains.has(n.domain_id))c.fail('invalid_seed','Notification domain reference is invalid.');if((n.email_status==='unknown')!==n.reconciliation_required)c.fail('invalid_seed','Unknown Mail state and reconciliation flag must agree.');}
 if(new Set(data.processed_event_ids).size!==data.processed_event_ids.length)c.fail('invalid_seed','Processed event IDs must be unique.');
 if(data.domains.some(d=>d.auth_code_hash&&!/^[a-f0-9]{64}$/.test(d.auth_code_hash))||data.inbound_authorizations.some(a=>!/^[a-f0-9]{64}$/.test(a.code_hash)))c.fail('invalid_seed','Authorization codes must be stored only as SHA-256 hashes.');
}
function records(data){return ['tld_policies','availability','contact_profiles','payment_methods','quotes','domains','zones','charges','renewal_attempts','transfers','notifications'].flatMap(k=>data[k]);}
module.exports={validateSeed,records,objects:data=>records(data).map(x=>x.id),references:()=>[],assetReferences:()=>[]};
