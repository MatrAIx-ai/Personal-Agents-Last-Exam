import {el} from '/shared/client.js';

const money = cents => new Intl.NumberFormat('en-US', {style:'currency', currency:'USD'}).format(cents / 100);
const date = value => new Date(value).toLocaleString('en-US', {timeZone:'America/Los_Angeles', month:'short', day:'numeric', hour:'numeric', minute:'2-digit'});
const clone = value => structuredClone(value);
let csrf, data, version, busy = false, section = sessionStorage.getItem('finance-section') || 'accounts';
let selected = sessionStorage.getItem('finance-selected'), pendingWrites = new Map();
let available = new Set();
let marketRange = sessionStorage.getItem('finance-market-range') || '1M';
let chartType = sessionStorage.getItem('finance-chart-type') || 'line', marketQuery = '';
const sourceName = provider => ({authored:'Authored synthetic data',yahoo_chart:'Yahoo Finance public chart feed',alphavantage_demo:'Alpha Vantage daily demo'}[provider] || provider);
const views = [['accounts','Accounts','◉'],['holdings','Holdings','▤'],['market','Market','↗'],['activity','Activity','≡'],['actions','Actions','✓'],['receipts','Receipts','▧']];
const status = el('p', {id:'status', role:'status', 'aria-live':'polite'}, 'Connecting…');
const collection = el('div', {id:'records', class:'records'}), detail = el('section', {class:'detail', 'aria-label':'Selected record'});
const marketSearch = el('input',{class:'market-search',type:'search',placeholder:'Search symbol or company','aria-label':'Search market',oninput:event=>{marketQuery=event.target.value;render();}});
const nav = el('nav', {'aria-label':'Finance navigation'}), title = el('h2', {class:'section-title'});
const refreshButton = el('button', {type:'button', onclick:()=>refresh().catch(showError)}, 'Refresh');
const dialog = el('dialog', {'aria-label':'Preview financial action'}), form = el('form');
dialog.append(form);
const actionButtons = () => [['transfer','Transfer cash'],['buy','Buy shares'],['sell','Sell shares']].map(([kind,label])=>
  el('button',{type:'button',class:kind==='transfer'?'primary':'',onclick:()=>openPreview(kind)},label));
const globalActions = el('div', {class:'actions'}, ...actionButtons());
document.querySelector('#app').replaceChildren(el('div', {class:'app-shell'},
  el('aside',{class:'sidebar'},el('div',{class:'brand'},el('span',{class:'brand-mark','aria-hidden':'true'},'$'),el('h1',{},'Finance')),
    globalActions,nav,el('div',{class:'sidebar-foot'},el('span',{class:'avatar small'},'D'),el('div',{},el('strong',{},'Demo Owner'),el('small',{},'Simulated funds')))),
  el('main',{class:'app-main'},el('header',{class:'toolbar'},el('strong',{},'Your money, in one place'),refreshButton),status,
    el('div',{class:'workspace'},el('section',{class:'collection','aria-label':'Finance records'},el('div',{class:'collection-head'},title,marketSearch),collection),detail))),dialog);

function showError(error) { status.textContent=error.message;status.dataset.error='true'; }
const loadingStates=new WeakMap();
function loading(value) {
  busy=value;document.querySelector('#app').setAttribute('aria-busy',String(value));
  for(const b of document.querySelectorAll('#app button')) {
    if(value){if(!loadingStates.has(b))loadingStates.set(b,b.disabled);b.disabled=true;}
    else if(loadingStates.has(b)){b.disabled=loadingStates.get(b);loadingStates.delete(b);}
  }
}
async function request(url, method='GET', value) {
  const response=await fetch(url,{method,headers:method==='POST'?{'Content-Type':'application/json','X-Pale-CSRF':csrf}:{},
    ...(method==='POST'?{body:JSON.stringify(value)}:{})});
  const result=await response.json();if(!response.ok)throw Error(result.error||'Request failed.');return result;
}
let callQueue=Promise.resolve();
function call(name,args={}) {
  // The local MCP connection is serial. Avoid starting timeout clocks for a
  // whole group of large history reads while earlier reads still hold it.
  const result=callQueue.then(()=>performCall(name,args));
  callQueue=result.catch(()=>{});return result;
}
async function performCall(name,args={},attempt=0) {
  let result;
  try {result=await request('/api/call','POST',{name,arguments:args});}
  catch(error) {
    // A read can safely retry a temporary transport/host failure once. Financial
    // writes retain their original request and require an explicit user retry.
    const read=/^finance\.(accounts\.list|holdings\.list|transactions\.list|obligations\.list|market\.get|actions\.get|receipts\.get)$/.test(name);
    if(read&&attempt===0&&/Internal local environment error|App is locked|MCP request timed out|Failed to fetch/i.test(error.message))return performCall(name,args,1);
    throw error;
  }
  if(!['ok','committed'].includes(result.status))throw Object.assign(Error(result.status==='stale_version'?
    'The workspace changed. Close this form, refresh and review the current terms.':result.message||result.status),{code:result.status});
  return result;
}
async function write(name,args, observedVersion=version) {
  const payload={...clone(args),expected_version:clone(observedVersion)}, key=name+JSON.stringify(payload);
  if(!pendingWrites.has(key))pendingWrites.set(key,'finance-web-'+crypto.randomUUID());
  payload.request_id=pendingWrites.get(key);
  const result=await call(name,payload);pendingWrites.delete(key);return result;
}
async function refresh() {
  if(busy)return;loading(true);
  try {
    available=new Set((await request('/api/tools')).tools.map(t=>t.name));
    if(!available.has('finance.accounts.list'))throw Error('Account access is not available for this workspace.');
    if(!available.has('finance.actions.preview'))globalActions.replaceChildren();
    else if(!globalActions.children.length)globalActions.replaceChildren(...actionButtons());
    const accounts=await call('finance.accounts.list');
    const [market,obligations,...transactions]=await Promise.all([
      available.has('finance.market.get')?call('finance.market.get'):{instruments:[],quotes:[],history:[],announcements:[],observed_at:null},
      available.has('finance.obligations.list')?call('finance.obligations.list'):{obligations:[],rules:[],assessments:[]},
      ...(available.has('finance.transactions.list')?accounts.accounts.map(a=>call('finance.transactions.list',{account_id:a.id})):[])]);
    const holdings=available.has('finance.holdings.list')?(await Promise.all(accounts.accounts.filter(a=>a.kind==='brokerage').map(a=>call('finance.holdings.list',{account_id:a.id})))).flatMap(r=>r.holdings):[];
    const actions=available.has('finance.actions.get')?await Promise.all(accounts.action_ids.map(id=>call('finance.actions.get',{id}))):[];
    const receipts=available.has('finance.receipts.get')?(await Promise.all(accounts.receipt_ids.map(id=>call('finance.receipts.get',{id})))).map(r=>r.receipt):[];
    // Re-read after the collection reads. A write still uses this observed version
    // and the backend checks all business bindings at execution.
    const latest=await call('finance.accounts.list');version=latest.version;
    data={accounts:latest.accounts,instruction:latest.instruction,market,obligations,holdings,actions,receipts,
      transactions:[...new Map(transactions.flatMap(r=>r.transactions).map(r=>[r.id,r])).values()].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))};
    render();status.textContent='Saved'+(market.source?.mode&&market.source.mode!=='synthetic'?
      ' · '+(market.source.mode==='live'?'Live collection':'Offline replay')+' · '+market.source.status+' · '+date(market.source.checked_at)+' Pacific':
      market.observed_at?' · Simulated time '+date(market.observed_at)+' Pacific':'');delete status.dataset.error;
  } finally {loading(false);}
}
const metadata=(label,value)=>el('div',{class:'metadata-line'},el('span',{},label),el('strong',{},String(value)));
const empty=text=>el('div',{class:'empty'},el('h3',{},text));
const name=id=>data.accounts.find(a=>a.id===id)?.name||id;
const instrument=id=>data.market.instruments.find(i=>i.id===id)?.name||id;
const effects=row=>el('section',{},...row.effects.map(e=>metadata(name(e.account_id),money(e.amount_cents))));
function summary(p) {
  const a=p.parameters;
  return p.kind==='transfer'?`${money(a.amount_cents)} · ${name(a.from_account)} → ${name(a.to_account)}`:
    `${p.kind==='buy'?'Buy':'Sell'} ${a.quantity} ${a.instrument_id} · ${money(a.total_cents)}`;
}
function rows() {
  return {accounts:data.accounts,holdings:data.holdings.map(h=>({...h,id:h.account_id+':'+h.instrument_id})),market:data.market.instruments,
    activity:data.transactions,actions:data.actions.map(a=>({...a.proposal,validity:a.validity})),receipts:data.receipts}[section]||data.accounts;
}
function heading(row) {
  if(section==='accounts')return row.name;
  if(section==='market'&&data.market.source?.mode!=='synthetic')return row.id+' · '+instrument(row.id);
  if(section==='holdings'||section==='market')return instrument(row.instrument_id||row.id);
  if(section==='activity')return row.description;
  if(section==='actions')return summary(row);
  return 'Receipt '+row.id.replace('receipt-','');
}
function subtitle(row) {
  if(section==='accounts')return money(row.balance_cents)+' available cash';
  if(section==='holdings')return row.quantity+' shares · cost '+money(row.cost_cents);
  if(section==='market') {const q=data.market.quotes.find(q=>q.instrument_id===row.id);return q?money(q.price_cents)+(q.executable?' · usable reference':' · quote expired'):'Quote unavailable';}
  if(section==='activity')return row.status+' · '+date(row.at);
  if(section==='actions')return row.status+' · '+(row.validity.valid_now?'current terms':row.validity.reason);
  return date(row.executed_at);
}
function render() {
  const visible=views.filter(([id])=>available.has({accounts:'finance.accounts.list',holdings:'finance.holdings.list',market:'finance.market.get',
    activity:'finance.transactions.list',actions:'finance.actions.get',receipts:'finance.receipts.get'}[id]));
  if(!visible.some(v=>v[0]===section))section='accounts';
  nav.replaceChildren(...visible.map(([id,label,symbol])=>el('button',{type:'button','aria-current':id===section?'page':false,
    onclick:()=>{section=id;selected=null;sessionStorage.setItem('finance-section',id);render();}},el('span',{class:'nav-symbol','aria-hidden':'true'},symbol),label)));
  title.textContent=views.find(v=>v[0]===section)?.[1]||'Accounts';
  document.body.dataset.view=section;
  const list=rows().filter(row=>section!=='market'||(row.id+' '+row.name).toLowerCase().includes(marketQuery.toLowerCase()));
  if(!list.some(r=>r.id===selected))selected=list[0]?.id;
  collection.replaceChildren(...list.map(row=>el('button',{type:'button',class:'record','data-record-id':row.id,'aria-pressed':selected===row.id,
    onclick:()=>{selected=row.id;sessionStorage.setItem('finance-selected',selected);render();}},
    el('span',{class:'record-title'},section==='market'?row.id:heading(row),section==='market'?el('span',{class:'watch-name'},row.name):null),el('span',{class:'record-subtitle'},section==='market'?watchPrice(row):subtitle(row)))));
  if(!list.length)collection.append(empty('Nothing here yet'));
  const row=list.find(r=>r.id===selected);
  detail.replaceChildren(row?view(row):empty(section==='actions'?'Preview a transfer or trade to begin.':section==='receipts'?'Receipts appear after execution.':'Select a record.'));
}
function view(row) {
  if(section==='market')return marketView(row);
  const source=data.market.source||{mode:'synthetic',provider:'authored'};
  const article=el('article',{'data-selected-id':row.id},el('span',{class:'kicker'},section==='market'?
    source.mode==='synthetic'?'Synthetic market data':source.mode==='live'?'Live market collection':'Recorded real-data replay':section),el('h2',{},heading(row)));
  if(section==='accounts') {
    article.append(metadata('Available cash',money(row.balance_cents)),metadata('Account type',row.kind),
      el('p',{class:'body-text'},data.instruction.text));
    const obligations=data.obligations.obligations.filter(o=>o.account_id===row.id);
    article.append(el('h3',{},'Upcoming commitments'));
    for(const o of obligations)article.append(metadata(o.description,`${money(o.amount_cents)} · ${date(o.due_at)}${o.kind==='credit'?' · expected, not posted':''}`));
    for(const r of data.obligations.rules.filter(r=>r.account_id===row.id))article.append(metadata('Balance rule',`${money(r.minimum_cents)} minimum · ${money(r.fee_cents)} fee at ${r.assessment_time} Pacific`));
    for(const a of data.obligations.assessments.filter(a=>a.account_id===row.id))article.append(metadata('Fee · '+a.business_date,
      `${money(a.assessed_cents)} assessed · ${money(a.paid_cents)} paid · ${money(a.outstanding_cents)} outstanding`));
  } else if(section==='holdings') {
    article.append(metadata('Account',name(row.account_id)),metadata('Shares',row.quantity),metadata('Acquisition cost',money(row.cost_cents)));
    const q=data.market.quotes.find(q=>q.instrument_id===row.instrument_id);
    article.append(metadata('Reference value',q?money(q.price_cents*row.quantity):'Quote unavailable'),
      el('p',{class:'body-text'},'Reference value uses the latest observed price. Trades remain local simulations and require a current quote and your exact approval.'));
  } else if(section==='activity') {
    article.append(metadata('Status',row.status),metadata('Recorded',date(row.at)),effects(row));
    if(row.requested_cents)article.append(metadata('Requested debit',money(row.requested_cents)));
    if(row.kind==='fee')article.append(metadata('Fee assessed',money(row.assessed_cents)),metadata('Outstanding',money(row.outstanding_cents)));
    if(row.opening_history)article.append(el('p',{class:'body-text'},'Opening statement history. These effects are already included in the opening balances.'));
    if(row.status==='failed')article.append(el('p',{class:'body-text'},'Insufficient cash. This attempt did not debit the account.'));
  } else if(section==='actions') {
    article.append(metadata('Status',row.status),metadata('Preview expires',date(row.expires_at)),el('p',{class:'body-text'},row.reason),metadata('Validity',row.validity.reason));
    if(row.kind!=='transfer')article.append(metadata('Price per share',money(row.parameters.price_cents)),metadata('Quote',row.parameters.quote_id));
    if(row.approval)article.append(metadata('Decision',row.approval.decision),metadata('Approval expires',date(row.approval.expires_at)));
    if(row.status==='pending')article.append(el('p',{class:'body-text'},'Waiting for confirmation through your trusted approval channel. Previewing does not move money.'));
    const actions=el('div',{class:'reader-footer'});
    if(row.status==='approved'&&row.validity.valid_now&&available.has('finance.actions.execute'))actions.append(el('button',{type:'button',class:'primary',onclick:()=>operate('finance.actions.execute',{id:row.id})},'Execute '+row.kind));
    if(['pending','approved'].includes(row.status)&&available.has('finance.actions.cancel'))actions.append(el('button',{type:'button',onclick:()=>operate('finance.actions.cancel',{id:row.id})},'Cancel action'));
    article.append(actions);
  } else {
    article.append(metadata('Executed',date(row.executed_at)),metadata('Approved action',row.proposal_id),effects(row));
    for(const e of row.position_effects)article.append(metadata(instrument(e.instrument_id),`${e.quantity_delta>0?'+':''}${e.quantity_delta} shares · cost change ${money(e.cost_delta_cents)}`));
    article.append(el('p',{class:'body-text'},'This receipt records the original committed effects. Repeating the request does not repeat the financial action.'));
  }
  return article;
}
const tradingDay = value => new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const barTime = b => b.bar_start_at || b.as_of;
const barValue = (b,key) => b[key+'_price']!==undefined?Number(b[key+'_price'])*100:b.price_cents;
const signed = cents => (cents>=0?'+':'−')+money(Math.abs(cents));
function watchPrice(row) {
  const q=data.market.quotes.find(q=>q.instrument_id===row.id);
  return el('span',{class:'watch-price'},q?money(q.price_cents):'Unavailable');
}
function chartRows(id,range) {
  const interval=['1D','1W'].includes(range)?'15m':'1d';
  const rows=data.market.history.filter(b=>b.instrument_id===id&&(b.interval||'1d')===interval).sort((a,b)=>Date.parse(barTime(a))-Date.parse(barTime(b)));
  if(!rows.length)return [];
  if(interval==='15m') {
    const days=[...new Set(rows.map(b=>tradingDay(barTime(b))))].slice(range==='1D'?-1:-5);
    return rows.filter(b=>days.includes(tradingDay(barTime(b))));
  }
  return range==='1M'?rows.filter(b=>Date.parse(barTime(b))>=Date.parse(barTime(rows.at(-1)))-31*86400000):rows;
}
function marketView(row) {
  const source=data.market.source||{mode:'synthetic',provider:'authored'},q=data.market.quotes.find(q=>q.instrument_id===row.id);
  const available=data.market.history.filter(b=>b.instrument_id===row.id),intraday=available.some(b=>b.interval==='15m');
  if(!intraday&&['1D','1W'].includes(marketRange))marketRange='1M';
  const sameRange=(a,b)=>{const left=chartRows(row.id,a),right=chartRows(row.id,b);return left.length===right.length&&left.every((bar,i)=>bar.id===right[i].id);};
  const unavailable=new Set(['1D','1W'].filter(()=>!intraday));
  if(sameRange('1D','1W'))unavailable.add('1W');
  if(sameRange('1M','ALL'))unavailable.add('ALL');
  if(unavailable.has(marketRange))marketRange=marketRange==='1W'&&intraday?'1D':'1M';
  const bars=chartRows(row.id,marketRange),isDaily=!['1D','1W'].includes(marketRange);
  const candles=bars.length>0&&bars.every(b=>['open','high','low','close'].every(k=>Number.isFinite(Number(b[k+'_price']))));
  const article=el('article',{class:'market-reader','data-selected-id':row.id},el('span',{class:'kicker'},row.id+' / '+(source.mode==='synthetic'?'SYNTHETIC':source.mode==='replay'?'REPLAY':'MARKET')),el('h2',{},row.name));
  const hero=el('div',{class:'price-hero'},q?money(q.price_cents):'—');
  const first=bars[0],last=bars.at(-1),base=first?barValue(first,'open'):null;
  const move=el('div',{class:'price-move'}),priceTime=el('p',{class:'price-time'});
  function showPrice(bar) {
    const displayed=bar?bar.price_cents:q?.price_cents;
    hero.textContent=displayed===undefined?'—':money(displayed);
    const delta=last&&base?((bar?.price_cents??q?.price_cents??last.price_cents)-base):null;
    move.className='price-move '+(delta<0?'negative':'positive');
    move.replaceChildren(delta===null?'No price history':signed(delta)+' ('+(delta>=0?'+':'')+(delta/base*100).toFixed(2)+'%)',el('span',{},'from first displayed open'));
    priceTime.textContent=bar?date(bar.as_of)+' Pacific · '+(bar.bar_complete===false?'In progress':'Historical observation'):q?'Latest quote · '+date(q.as_of)+' Pacific':'Waiting for a collected quote';
  }
  showPrice(null);article.append(hero,move,priceTime);
  const canvas=el('canvas',{class:'market-chart',role:'img',tabindex:'0','aria-label':row.id+' '+marketRange+' price history. Point, touch, or use arrow keys to inspect prices.'});
  const inspect=el('div',{class:'chart-inspect','aria-live':'polite'});
  const ranges=el('div',{class:'chart-ranges','aria-label':'Chart time range'},...['1D','1W','1M','ALL'].map(range=>el('button',{type:'button','aria-pressed':marketRange===range,disabled:unavailable.has(range),title:unavailable.has(range)?'Not enough captured history for a distinct '+range+' view':range,onclick:()=>{marketRange=range;sessionStorage.setItem('finance-market-range',range);render();}},range)));
  const types=el('div',{class:'chart-types','aria-label':'Chart style'},...['line','candles'].map(type=>el('button',{type:'button','aria-pressed':chartType===type,disabled:type==='candles'&&!candles,onclick:()=>{chartType=type;sessionStorage.setItem('finance-chart-type',type);render();}},type==='line'?'Line':'Candles')));
  const coverage=el('p',{class:'chart-coverage'},bars.length?bars.length+' '+(isDaily?'daily':'15-minute')+' observations · '+tradingDay(barTime(first))+' → '+tradingDay(barTime(last))+' · Available captured history':'No observations for this range');
  article.append(el('div',{class:'chart-wrap'},canvas),el('div',{class:'chart-controls'},ranges,types),inspect,coverage);
  const order=el('div',{class:'market-order'}),buttons=el('div',{});
  if(availableToolsPreview())for(const kind of ['buy','sell'])buttons.append(el('button',{type:'button',class:kind==='buy'?'primary':'',onclick:()=>openPreview(kind,row.id)},(kind==='buy'?'Buy ':'Sell ')+row.id));
  order.append(buttons,el('small',{},'Simulated trades · Approval required'));article.append(order);
  const details=el('details',{class:'source-details'},el('summary',{},'Market data & source'),metadata('Source',sourceName(source.provider)),metadata('Quote status',q?(q.executable?'Available for simulation':'Expired · refresh required'):'Unavailable'));
  if(q?.collected_at)details.append(metadata('Price as of',date(q.as_of)+' Pacific'),metadata('Collected',date(q.collected_at)+' Pacific'),metadata('Provider delay',q.delay_seconds===null?'Not specified by source':q.delay_seconds+' seconds'),metadata('Source price',q.raw_price+' USD'));
  details.append(el('p',{class:'body-text'},source.mode==='synthetic'?'Authored synthetic prices.':'Collected market observations. Source precision is preserved; simulated trades round to cents. Provider prices can be delayed.'));
  article.append(details);
  for(const error of source.errors||[])if(error.instrument_id===row.id)article.append(el('p',{class:'body-text',role:'alert'},error.interval+': '+error.message+'. Displayed prices keep their original observation times.'));
  for(const a of data.market.announcements.filter(a=>a.instrument_id===row.id))article.append(el('p',{class:'body-text'},a.text),el('small',{},date(a.published_at)));
  requestAnimationFrame(()=>drawMarket(canvas,bars,chartType==='candles'&&candles,inspect,showPrice));
  return article;
}
function availableToolsPreview(){return available.has('finance.actions.preview');}
function drawMarket(canvas,bars,candles,readout,showPrice) {
  if(!canvas.isConnected)return;
  const rect=canvas.getBoundingClientRect(),w=rect.width,h=rect.height,dpr=Math.min(3,window.devicePixelRatio||1);
  canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
  const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);
  if(!bars.length){ctx.fillStyle='#849188';ctx.font='12px system-ui';ctx.fillText('No captured observations for this range',16,h/2);return;}
  const left=7,right=w-48,top=20,bottom=h-82,volTop=h-65,volBottom=h-28;
  const prices=bars.map(b=>b.price_cents),low=Math.min(...bars.map(b=>candles?barValue(b,'low'):b.price_cents)),high=Math.max(...bars.map(b=>candles?barValue(b,'high'):b.price_cents));
  const margin=Math.max((high-low)*.12,Math.abs(high)*.0003,1),lo=low-margin,hi=high+margin,step=(right-left)/Math.max(1,bars.length-1);
  const x=i=>bars.length===1?(left+right)/2:left+i*step,y=value=>bottom-(value-lo)/(hi-lo)*(bottom-top);
  const gain=prices.at(-1)>=barValue(bars[0],'open'),color=gain?'#009b60':'#e15a38',maxVol=Math.max(1,...bars.map(b=>b.volume||0));
  let selected=bars.length-1;
  function paint(index=null){
    ctx.clearRect(0,0,w,h);ctx.font='10px system-ui';
    for(let i=0;i<3;i++){const value=low+(high-low)*i/2,at=y(value);ctx.strokeStyle='#f1f4f1';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(left,at);ctx.lineTo(right,at);ctx.stroke();ctx.fillStyle='#93a096';ctx.textAlign='right';ctx.fillText((value/100).toFixed(2),w-1,at-6);}
    ctx.save();ctx.setLineDash([3,5]);ctx.strokeStyle='#dce5de';ctx.beginPath();ctx.moveTo(left,y(barValue(bars[0],'open')));ctx.lineTo(right,y(barValue(bars[0],'open')));ctx.stroke();ctx.restore();
    const bw=Math.max(1,Math.min(9,(right-left)/bars.length*.55));
    bars.forEach((bar,i)=>{const c=bar.price_cents>=barValue(bar,'open')?'#009b60':'#e15a38';ctx.fillStyle=c;ctx.globalAlpha=.18;const vh=(bar.volume||0)/maxVol*(volBottom-volTop);ctx.fillRect(x(i)-bw/2,volBottom-vh,bw,vh);ctx.globalAlpha=1;if(candles){ctx.strokeStyle=c;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x(i),y(barValue(bar,'high')));ctx.lineTo(x(i),y(barValue(bar,'low')));ctx.stroke();ctx.fillRect(x(i)-bw/2,Math.min(y(barValue(bar,'open')),y(bar.price_cents)),bw,Math.max(1,Math.abs(y(bar.price_cents)-y(barValue(bar,'open')))));}});
    if(!candles){ctx.beginPath();prices.forEach((v,i)=>i?ctx.lineTo(x(i),y(v)):ctx.moveTo(x(i),y(v)));ctx.lineTo(x(bars.length-1),bottom);ctx.lineTo(x(0),bottom);ctx.closePath();const fill=ctx.createLinearGradient(0,top,0,bottom);fill.addColorStop(0,gain?'#009b6012':'#e15a3812');fill.addColorStop(1,'#ffffff00');ctx.fillStyle=fill;ctx.fill();ctx.beginPath();prices.forEach((v,i)=>i?ctx.lineTo(x(i),y(v)):ctx.moveTo(x(i),y(v)));ctx.strokeStyle=color;ctx.lineWidth=2;ctx.lineJoin='round';ctx.lineCap='round';ctx.stroke();}
    ctx.fillStyle='#91a094';ctx.textAlign='left';
    for(const i of [...new Set([0,Math.floor((bars.length-1)/2),bars.length-1])]){ctx.textAlign=i===0?'left':i===bars.length-1?'right':'center';const time=bars[i].interval==='15m'?new Date(barTime(bars[i])).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit'}):tradingDay(barTime(bars[i])).slice(5);ctx.fillText(time,x(i),h-7);}
    const i=index===null?bars.length-1:index;
    if(index!==null){ctx.strokeStyle='#93a198';ctx.lineWidth=1;ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(x(i),top);ctx.lineTo(x(i),volBottom);ctx.stroke();ctx.setLineDash([]);}
    if(!candles||index!==null){ctx.beginPath();ctx.arc(x(i),y(prices[i]),3.5,0,2*Math.PI);ctx.fillStyle=color;ctx.fill();}
  }
  function inspect(index){selected=Math.max(0,Math.min(bars.length-1,index));const b=bars[selected];showPrice(b);readout.textContent=date(b.as_of)+' Pacific'+(b.open_price!==undefined?' · O '+money(barValue(b,'open'))+'  H '+money(barValue(b,'high'))+'  L '+money(barValue(b,'low'))+'  C '+money(b.price_cents):' · Close '+money(b.price_cents))+(b.volume!==null&&b.volume!==undefined?' · Vol '+b.volume.toLocaleString('en-US'):'');paint(selected);}
  function restore(){showPrice(null);readout.textContent=candles?'OHLC candles · Volume below · Point or use ← → to inspect':'Closing prices · Volume below · Point or use ← → to inspect';paint();}
  canvas.onpointermove=event=>{const r=canvas.getBoundingClientRect();inspect(Math.round(((event.clientX-r.left)-left)/Math.max(1,step)));};
  canvas.onpointerleave=restore;
  canvas.onkeydown=event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();inspect(event.key==='Home'?0:event.key==='End'?bars.length-1:selected+(event.key==='ArrowLeft'?-1:1));}};
  canvas.onblur=restore;restore();
}
window.addEventListener('resize',()=>{if(data&&section==='market')render();});
async function operate(name,args) {
  if(busy)return;loading(true);
  try {await write(name,args);loading(false);await refresh();}
  catch(error){showError(error);}finally{loading(false);}
}
function field(label,input) {return el('label',{class:'field'},el('span',{},label),input);}
function select(label, choices, key) {
  const input=el('select',{'data-field':key,'aria-label':label},...choices.map(([value,text])=>el('option',{value},text)));
  return [field(label,input),input];
}
function openPreview(kind, instrumentId) {
  if(!data||busy)return;
  const observed=clone(version),fields=el('div',{class:'fields'}),error=el('p',{class:'form-error',role:'alert'});
  let parameters;
  if(kind==='transfer') {
    const choices=data.accounts.map(a=>[a.id,a.name]);
    const [fromField,from]=select('From account',choices,'from_account'),[toField,to]=select('To account',choices,'to_account');
    to.value='investing';
    const amount=el('input',{type:'number',min:'0.01',step:'0.01',required:true,'data-field':'amount',value:'100.00','aria-label':'Amount in USD'});
    fields.append(fromField,toField,field('Amount in USD',amount));
    parameters=()=>{const match=amount.value.match(/^(\d+)(?:\.(\d{1,2}))?$/);if(!match)throw Error('Enter dollars with at most two decimal places.');
      const cents=Number(match[1])*100+Number((match[2]||'').padEnd(2,'0'));if(!Number.isSafeInteger(cents)||cents<=0)throw Error('Enter a positive supported amount.');
      return {from_account:from.value,to_account:to.value,amount_cents:cents};};
  } else {
    const [accountField,account]=select('Brokerage account',data.accounts.filter(a=>a.kind==='brokerage').map(a=>[a.id,a.name]),'account_id');
    const [instrumentField,instrument]=select('Instrument',data.market.instruments.map(i=>[i.id,i.name]),'instrument_id');
    if(instrumentId)instrument.value=instrumentId;
    const quantity=el('input',{type:'number',min:1,max:1000000,step:1,required:true,value:1,'data-field':'quantity','aria-label':'Whole shares'});
    fields.append(accountField,instrumentField,field('Whole shares',quantity));
    parameters=()=>({account_id:account.value,instrument_id:instrument.value,quantity:Number(quantity.value)});
  }
  const reason=el('textarea',{required:true,maxlength:2000,rows:3,'data-field':'reason','aria-label':'Purpose'});
  fields.append(field('Purpose',reason));
  const submit=el('button',{type:'submit',class:'primary'},'Create preview');
  form.replaceChildren(el('h2',{},kind==='transfer'?'Preview transfer':kind==='buy'?'Preview share purchase':'Preview share sale'),fields,error,
    el('div',{class:'form-actions'},el('button',{type:'button',onclick:()=>dialog.close()},'Close'),submit));
  form.onsubmit=async event=>{
    event.preventDefault();if(busy)return;busy=true;submit.disabled=true;error.textContent='';
    try {const result=await write('finance.actions.preview',{kind,parameters:parameters(),reason:reason.value},observed);
      selected=result.proposal.id;section='actions';sessionStorage.setItem('finance-section',section);dialog.close();busy=false;await refresh();}
    catch(e){error.textContent=e.message;error.dataset.code=e.code||'invalid_arguments';}
    finally{busy=false;submit.disabled=false;}
  };
  dialog.showModal();fields.querySelector('select,input')?.focus();
}
try {
  const access=new URLSearchParams(location.hash.slice(1)).get('access');
  if(access){history.replaceState(null,'',location.pathname);({csrf}=await request('/session','POST',{token:access}));}
  else ({csrf}=await request('/session'));
  await refresh();
} catch(error) {showError(error);}
setInterval(()=>{if(data?.market.source?.mode==='live'&&!busy&&!dialog.open)refresh().catch(showError);},30000);
