import {mount,el,date,time,tag,textBlock} from '/shared/client.js';
// Northlake Patient Portal: App-owned pages served by the shared Web Host over the Agent MCP connection.
// Walking skeleton: the secure-messaging inbox and thread view. Billing, claim and statement pages follow.
const T='northlake-portal.';
export const config={
 id:'northlake-portal',title:'Northlake Patient Portal',description:'Secure messages, billing and appointments for one patient.',
 list:T+'messages.list',collection:'threads',queryField:'query',listArgs:{status:'all'},get:T+'messages.get',item:'thread',
 heading:t=>t.subject,subtitle:t=>t.recipient.display_name+' · '+(t.status==='closed'?'Closed':t.awaiting==='patient'?'Reply needed':'Awaiting staff'),
 labels:{body:'Message',files:'Attachments'},
 actions:[
  {label:'New message',tool:T+'messages.send',primary:true},
  {label:'Reply',tool:T+'messages.reply',selected:true,prefill:t=>({id:t.thread_id}),available:t=>t.status==='open'},
  {label:'Mark read / unread',tool:T+'messages.flags',selected:true,prefill:t=>({id:(t.messages[t.messages.length-1]||{}).message_id,patch:{read:true}})},
  {label:'Export thread',tool:T+'messages.export',selected:true,prefill:t=>({id:t.thread_id})}
 ],
 symbol:'✚',searchLabel:'Search your messages',initialSection:'inbox',
 sections:()=>[{id:'inbox',label:'Inbox',symbol:'▤',filter:t=>t.status==='open'},{id:'unread',label:'Unread',symbol:'●',filter:t=>t.unread_count>0},{id:'billing',label:'Billing office',symbol:'$',filter:t=>t.recipient.category==='billing_office'},{id:'closed',label:'Closed',symbol:'▣',filter:t=>t.status==='closed'}],
 sort:(a,b)=>Date.parse(b.updated_at)-Date.parse(a.updated_at),
 row:(t,ui)=>ui.record(t,el('div',{class:'note-row'},el('span',{class:'note-title'},t.unread_count?el('span',{class:'pin','aria-label':'Unread'},'●'):null,t.subject),el('span',{class:'snippet'},t.last_message_preview||'No messages yet'),el('div',{class:'row-bottom'},el('time',{},date(t.updated_at)),tag(t.recipient.display_name),t.status==='closed'?tag('closed'):null))),
 view:(t)=>el('article',{class:'note-paper'},el('h2',{},t.subject),el('div',{class:'tags'},tag(t.recipient.display_name),tag(t.status==='closed'?'Closed: '+(t.closed_reason||''):'Awaiting '+t.awaiting)),
   ...t.messages.map(m=>el('section',{class:'message'},el('div',{class:'note-date'},time(m.at)+' · '+m.author.display_name+(m.read?'':' · unread')),textBlock(m.body),m.attachments.length?el('div',{class:'note-foot'},m.attachments.length+' attachment'+(m.attachments.length===1?'':'s')):null)),
   el('div',{class:'note-foot'},'Opened '+date(t.opened_at))),
 sectionAfter:(tool)=>tool===T+'messages.send'?'inbox':null
};
mount(config);
