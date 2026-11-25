import {mount,el,tag,metadata} from '/shared/client.js';
// Platewright's business interface: the week's meal plan, the recipe box, the shopping list, the
// pantry, the household's dietary profiles and the activity of other members. Every value shown
// comes from the fixed Agent MCP connection; every change is one of the App's Agent tools, sent as
// a versioned write through the shared client. App text is only ever inserted as text.

const TOOLS={
 household:'platewright.household.get',ingredients:'platewright.ingredients.search',search:'platewright.recipes.search',recipe:'platewright.recipes.get',
 check:'platewright.recipes.check',substitutions:'platewright.substitutions.list',preview:'platewright.recipes.variant.preview',plan:'platewright.plan.get',
 pantry:'platewright.pantry.list',shopping:'platewright.shopping.get',notifications:'platewright.notifications.list',
 create:'platewright.recipes.create',update:'platewright.recipes.update',variant:'platewright.recipes.variant.create',
 constraintSet:'platewright.members.constraint.set',constraintRemove:'platewright.members.constraint.remove',
 slotSet:'platewright.plan.slot.set',slotMark:'platewright.plan.slot.mark',pantrySet:'platewright.pantry.set',
 generate:'platewright.shopping.generate',lineSet:'platewright.shopping.item.set',lineRemove:'platewright.shopping.item.remove'
};
// Fixed vocabularies of the approved plan, used as labels; the App validates every value.
const ALLERGENS=['milk','egg','fish','crustacean_shellfish','tree_nut','peanut','wheat','soy','sesame'];
const DIETS=['vegetarian','vegan','pescatarian','gluten_free','lactose_free','no_pork','no_alcohol'];
const NUTRIENTS={kcal:'kcal',protein_g:'protein (g)',carbs_g:'carbohydrate (g)',fat_g:'fat (g)',sodium_mg:'sodium (mg)'};
const AMOUNT={kcal:'kcal',protein_g:'g protein',carbs_g:'g carbohydrate',fat_g:'g fat',sodium_mg:'mg sodium'};
const MEALS=['breakfast','lunch','snack','dinner'];
const UNITS_BY={mass:['g','kg','oz','lb'],volume:['ml','l','tsp','tbsp','cup','fl_oz'],count:['each']};
const VERDICT={unsafe:'Unsafe',may_contain:'May contain',unsuitable:'Unsuitable',over_limit:'Over limit',disliked:'Disliked',ok_if_omitted:'OK if omitted',ok:'OK'};

// App-owned layout rules. The Host serves one shared stylesheet and its CSP allows no inline
// style element, so the controller adopts a constructed stylesheet built from this constant text.
const CSS=`
body[data-app=platewright]{--accent:#2f7d5b;--soft:#eaf5ef}
body[data-app=platewright] .sidebar{background:#f3f6f2}
body[data-app=platewright] .workspace{grid-template-columns:minmax(0,1.3fr) minmax(320px,1fr)}
body[data-app=platewright] #records{min-width:0}
body[data-pw-view=week] .collection-count,body[data-pw-view=shopping] .collection-count,body[data-pw-view=pantry] .collection-count,body[data-pw-view=household] .collection-count,body[data-pw-view=activity] .collection-count{display:none}
.pw-pane{padding:0 22px 26px}
.pw-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 14px}
.pw-bar h3{font-size:16px;font-weight:600;margin-right:auto}
.pw-bar button{padding:5px 10px;font-size:12px}
.pw-day{border:1px solid var(--line);border-radius:12px;margin-bottom:10px;overflow:hidden}
.pw-day>header{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#f7f9f7;border-bottom:1px solid var(--line)}
.pw-day>header h4{margin:0;font-size:13px;margin-right:auto}
.pw-day.today>header{background:var(--soft)}
.pw-day.past{opacity:.92}
.pw-slot{display:grid;grid-template-columns:76px minmax(0,1fr) auto;gap:10px;align-items:start;width:100%;text-align:left;border:0;border-bottom:1px solid #f0f2f4;border-radius:0;padding:10px 12px;background:#fff}
.pw-slot:last-child{border-bottom:0}
.pw-slot[aria-pressed=true]{background:var(--soft);box-shadow:inset 3px 0 var(--accent)}
.pw-slot .meal{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);padding-top:2px}
.pw-slot strong{display:block;font-size:13px}
.pw-slot small{font-size:11px}
.pw-slot.cleared strong,.pw-slot.skipped strong{text-decoration:line-through;color:var(--muted)}
.pw-state{font-size:10px;border-radius:5px;padding:2px 6px;background:#f1f3f6;color:#5d6878;white-space:nowrap}
.pw-state.cooked{background:#e6f4ec;color:#2c6e4d}.pw-state.planned{background:#eef3fc;color:#3b5f9c}
.pw-warn{display:inline-block;margin:4px 4px 0 0;font-size:10px;border-radius:5px;padding:2px 6px;background:#fff1e6;color:#a4501a}
.pw-warn.unsafe,.pw-warn.may_contain{background:#fdecec;color:#a52a2a}
.pw-warn.ok{background:#e6f4ec;color:#2c6e4d}
.pw-none{padding:8px 12px;font-size:12px;color:var(--muted)}
.pw-add{font-size:12px;border:0;background:transparent;color:var(--accent);padding:4px 8px}
.pw-row{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:0;border-bottom:1px solid var(--line);border-radius:0;padding:11px 4px;background:transparent}
.pw-row[aria-pressed=true]{background:var(--soft)}
.pw-row .grow{flex:1;min-width:0}
.pw-row strong{display:block;font-size:13px;font-weight:600}
.pw-row small{font-size:11px}
.pw-row input[type=checkbox]{width:18px;height:18px;flex:none}
.pw-row.ticked strong{text-decoration:line-through;color:var(--muted)}
.pw-group{margin:18px 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}
.pw-banner{border-radius:10px;padding:10px 12px;background:#fff6e5;color:#7a5410;font-size:12px;margin-bottom:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.pw-banner button{padding:4px 10px;font-size:12px}
.pw-card{border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:10px;width:100%;text-align:left;background:#fff;display:block}
.pw-card[aria-pressed=true]{border-color:var(--accent);background:var(--soft)}
.pw-card h4{margin:0 0 4px;font-size:15px}
.pw-table{width:100%;border-collapse:collapse;font-size:13px;margin:8px 0 18px}
.pw-table td{padding:7px 4px;border-bottom:1px solid #f1f3f7;vertical-align:top}
.pw-table td.q{white-space:nowrap;text-align:right;width:1%;font-weight:600;padding-right:12px}
.pw-steps{padding-left:20px;margin:6px 0 18px;line-height:1.7}
.pw-nutrition{display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:8px;margin:8px 0 18px}
.pw-nutrition div{border:1px solid var(--line);border-radius:10px;padding:8px 10px}
.pw-nutrition strong{display:block;font-size:16px}
.pw-inline{display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin:8px 0 14px}
.pw-inline label{display:grid;gap:4px;font-size:12px;min-width:110px;flex:1}
.pw-inline button{flex:none}
.pw-actions{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}
.pw-actions button{font-size:12px;padding:7px 12px}
.pw-history{font-size:12px;color:#596579;margin:6px 0 18px;padding-left:18px}
.pw-history li{margin-bottom:4px}
.pw-checks{display:flex;gap:6px 14px;flex-wrap:wrap}
.pw-checks label{display:flex;gap:6px;align-items:center;font-size:13px;font-weight:400}
.pw-checks input{width:auto}
.pw-inline label.pw-checks{display:flex;flex-direction:row;align-items:center;gap:6px;flex:none;min-width:0;padding-bottom:10px;font-size:13px}
.pw-subform{border:1px solid var(--line);border-radius:10px;padding:12px;display:grid;gap:10px}
.pw-subform .pw-inline{margin:0}
.pw-chip{display:inline-flex;gap:6px;align-items:center;border-radius:6px;background:#f1f3f6;padding:2px 4px 2px 8px;font-size:11px;margin:2px 4px 2px 0}
.pw-chip button{padding:0 6px;font-size:11px;border:0;background:transparent}
.pw-verdicts{display:grid;gap:6px;margin:10px 0}
.pw-verdicts div{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;font-size:13px}
@media(max-width:1150px){body[data-app=platewright] .workspace{grid-template-columns:minmax(0,1fr)}body[data-app=platewright] .detail{border-top:1px solid var(--line)}}
@media(max-width:760px){body[data-app=platewright] #records{max-height:none}body[data-pw-view=recipes] #records,body[data-pw-view=archived] #records{max-height:360px;overflow:auto}.pw-pane{padding:0 14px 18px}.pw-slot{grid-template-columns:76px minmax(0,1fr)}.pw-slot .meal{letter-spacing:.02em;word-break:keep-all}.pw-slot .pw-state{grid-column:2;justify-self:start}}
`;
try{const sheet=new CSSStyleSheet();sheet.replaceSync(CSS);document.adoptedStyleSheets=[...document.adoptedStyleSheets,sheet];}catch(e){/* shared styles still apply */}

// ---- Small helpers --------------------------------------------------------------------------------
let UI=null,schemas=new Map(),weekStart=null,activityDays=45;
const focus={week:null,shopping:null,pantry:null,household:null};
const addDays=(d,n)=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
const dayLabel=(d,o={weekday:'short',day:'numeric',month:'short'})=>new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',...o}).format(new Date(d+'T12:00:00Z'));
// Times are shown as the household recorded them (the wall clock in their UTC offset), not in the browser's zone.
const time=at=>at?dayLabel(at.slice(0,10),{day:'numeric',month:'short',year:'numeric'})+', '+at.slice(11,16):'—';
const words=s=>String(s??'').replace(/_/g,' ');
const cap=s=>words(s).replace(/^./,c=>c.toUpperCase());
const qty=(q,u)=>q==null?'':(Math.round(q*100)/100)+(u==='each'?'':' '+words(u));
// Dates and meals are always shown the same way: "20 Nov 2026", "Sat 14 Nov dinner".
const fullDate=d=>d?dayLabel(d.slice(0,10),{day:'numeric',month:'short',year:'numeric'}):'';
const slotLabel=id=>dayLabel(String(id).slice(0,10))+' '+String(id).slice(11);
const plural=(n,one,many=one+'s')=>n+' '+(n===1?one:many);
const daysLeft=n=>n===0?'last day':n===1?'1 day left':n+' days left';
// Names for what the tools refer to by ID. The ingredient table cannot change during a run (no tool or
// event edits it), so it is read once per page load. Recipe titles come from every read that carries
// them and are read again only when a shown record names a recipe the page has not seen.
const ingredientNames=new Map(),recipeTitles=new Map();
const ingredientName=id=>ingredientNames.get(id)||'an ingredient';
const recipeTitle=id=>recipeTitles.get(id)||'a recipe';
const learnTitles=rows=>{for(const r of rows||[])if(r?.id&&r.title&&('revision' in r||'variant_of' in r))recipeTitles.set(r.id,r.title);};
const has=name=>!!UI&&UI.has(name);
const enumOf=(tool,...path)=>{let s=schemas.get(tool);for(const k of path)s=s&&(k==='[]'?s.items:(s.properties||{})[k]);return s?.enum||s?.items?.enum||[];};
// Member names cannot change through any tool or event, so they are kept from the last household read.
const memberNames=new Map();
const learnMembers=members=>{for(const m of members||[])memberNames.set(m.person_id,m.display_name);};
const memberName=id=>memberNames.get(id)||'A household member';
const button=(label,onclick,extra={})=>el('button',{type:'button',onclick:e=>{e.stopPropagation();Promise.resolve(onclick(e)).catch(err=>UI.error(err));},...extra},label);
const rerender=()=>UI.navigate(UI.section);
const show=(section,key,id)=>{focus[key]=id;return UI.navigate(section);};
function field(label,input,help){return el('label',{class:'field'},el('span',{},label),input,help?el('small',{},help):null);}
function select(options,value,attrs={}){const s=el('select',attrs);for(const o of options){const [v,l]=Array.isArray(o)?o:[o,cap(o)];s.append(el('option',{value:v},l));}if(value!=null)s.value=String(value);return s;}
const dateInput=(value,attrs={})=>el('input',{type:'date',value:value||'',...attrs});
const numberInput=(value,attrs={})=>el('input',{type:'number',step:'any',value:value??'',...attrs});
const textInput=(value,attrs={})=>el('input',{type:'text',value:value??'',...attrs});
function checks(options,chosen){const box=el('div',{class:'pw-checks'});for(const [v,l] of options)box.append(el('label',{},el('input',{type:'checkbox',value:v,checked:chosen.includes(v)}),l));box.values=()=>[...box.querySelectorAll('input:checked')].map(i=>i.value);return box;}
// History rows name what happened; a few actions read better in other words.
const ACTION_WORDS={event:'Changed',derived:'Added from the plan',needed_again:'Needed again',revised:'Edited'};
function history(rows,describe,limit=12,labels={}){
 const list=el('ol',{class:'pw-history',reversed:true});const shown=[...rows].reverse();
 const fill=n=>{list.replaceChildren(...shown.slice(0,n).map(r=>el('li',{},el('strong',{},labels[r.action]||ACTION_WORDS[r.action]||cap(r.action)),' · '+time(r.at)+(r.by?' · '+memberName(r.by)+(r.actor==='event'?' (their change)':''):r.actor==='event'?' · another household member':''),describe?.(r)?el('small',{},describe(r)):null)));};
 fill(limit);
 const more=shown.length>limit?button('Show all '+shown.length,()=>{fill(shown.length);more.remove();}):null;
 return el('div',{},list,more);
}
// The whole ingredient table, read once per page load: the first page gives the total, the other
// pages are requested together.
let ingredientTable=null;
function allIngredients(){
 if(!ingredientTable)ingredientTable=(async()=>{
  const first=await UI.call(TOOLS.ingredients,{limit:100,offset:0}),offsets=[];
  for(let o=first.items.length;o<first.total;o+=100)offsets.push(o);
  const rest=await Promise.all(offsets.map(offset=>UI.call(TOOLS.ingredients,{limit:100,offset})));
  const out=[first,...rest].flatMap(r=>r.items).sort((a,b)=>a.name.localeCompare(b.name));
  for(const i of out)ingredientNames.set(i.id,i.name);
  return out;
 })().catch(e=>{ingredientTable=null;throw e;});
 return ingredientTable;
}
// Every recipe, archived ones included (read fresh each time: recipes can change during a run).
async function allRecipes(){
 const out=[];let offset=0;
 while(offset!==null){const r=await UI.call(TOOLS.search,{limit:100,offset,include_archived:true});out.push(...r.items);offset=r.next_offset;}
 learnTitles(out);return out;
}
// Reads the ingredient names only when something about to be shown names an ingredient.
const namesIngredients=value=>JSON.stringify(value??null).includes('"ingredient_id"');
const ensureIngredientNames=value=>has(TOOLS.ingredients)&&namesIngredients(value)?allIngredients().catch(()=>null):null;
const unitsFor=(ing,tool)=>{const all=enumOf(tool,'unit').length?enumOf(tool,'unit'):enumOf(TOOLS.create,'lines','[]','unit');return all.filter(u=>!ing||ing.measures.some(m=>UNITS_BY[m].includes(u)));};
const unitOptions=(ing,tool)=>unitsFor(ing,tool).map(u=>[u,words(u)]);
const unitSelect=(ing,tool,value,attrs={})=>select(unitOptions(ing,tool),value,attrs);
const refillUnits=(box,ing,tool)=>box.replaceChildren(...unitOptions(ing,tool).map(([v,l])=>el('option',{value:v},l)));
// What the check found, in words, with the names of the ingredients involved.
function findingText(f,lineName){
 const names=[...new Set(f.lines.map(lineName))].join(', ');
 const text={contains_allergen:()=>'contains '+words(f.allergen),may_contain_allergen:()=>'may contain '+words(f.allergen),
  medical_ingredient:()=>'medically excluded',medical_flag:()=>'medically excluded ('+words(f.flag)+')',
  diet_flag:()=>'not '+words(f.diet)+' ('+(f.flags||[]).map(words).join(', ')+')',
  over_limit:()=>Math.round(f.value*10)/10+' '+(AMOUNT[f.nutrient]||words(f.nutrient))+', more than the '+f.max+' allowed',
  disliked_ingredient:()=>'disliked',disliked_tag:()=>'disliked ('+words(f.tag)+')'}[f.reason];
 return (text?text():words(f.reason))+(names&&f.reason!=='over_limit'?': '+names:'');
}

// What a form would send that its tool's input schema refuses, named for a person (Core would only
// answer that the arguments do not match the schema). Every form runs it before sending; it returns
// null when the arguments fit. The App itself still checks every rule after this.
const FIELD_WORDS={title:'The title',method_tags:'Method',tags:'Each tag',steps:'Each step',note:'The note',reason:'The reason',text:'The item text',
 name:'Each guest name',lines:'Ingredients',servings:'Servings',quantity:'The quantity',portions:'Portions',made:'Portions made',eaten:'Portions eaten',
 max:'The maximum',tag:'The tag',active_minutes:'Active minutes',total_minutes:'Total minutes',dishes:'Dishes',guests:'Guests',attendees:'Who is eating',constraints:'Needs'};
const AT_LEAST={method_tags:'Tick at least one method.',steps:'Add at least one step.',lines:'Add at least one ingredient.',swaps:'Choose at least one swap.'};
const fieldWords=key=>FIELD_WORDS[key]||cap(words(key||'a value'));
function schemaProblem(s,v,key=''){
 if(!s||typeof s!=='object')return null;
 if(s.anyOf)return s.anyOf.some(x=>!schemaProblem(x,v,key))?null:schemaProblem(s.anyOf.find(x=>x.type!=='null')||s.anyOf[0],v,key);
 const name=fieldWords(key);
 if(s.enum&&!s.enum.includes(v))return name+' has a value the App does not offer.';
 if(s.type==='string'){
  if(typeof v!=='string')return name+' must be text.';
  if(s.minLength&&v.length<s.minLength)return name+' cannot be empty.';
  // The length is counted as the schema counts it (UTF-16 units), so an emoji can count as two or more.
  if(s.maxLength!=null&&v.length>s.maxLength)return name+' can be at most '+s.maxLength+' characters'+([...v].length<v.length?' (an emoji or some other symbols count as two or more)':'')+'.';
  if(s.pattern&&!new RegExp(s.pattern).test(v))return name+' is not in the expected form.';
 }
 if(s.type==='number'||s.type==='integer'){
  if(typeof v!=='number'||!Number.isFinite(v))return name+' must be a number.';
  if(s.type==='integer'&&!Number.isInteger(v))return name+' must be a whole number.';
  if(s.minimum!=null&&v<s.minimum)return name+' must be at least '+s.minimum+'.';
  if(s.maximum!=null&&v>s.maximum)return name+' can be at most '+s.maximum+'.';
 }
 if(s.type==='array'){
  if(!Array.isArray(v))return name+' must be a list.';
  if(s.minItems&&v.length<s.minItems)return AT_LEAST[key]||name+' needs at least '+s.minItems+'.';
  if(s.maxItems!=null&&v.length>s.maxItems)return name+': at most '+s.maxItems+'.';
  if(s.uniqueItems&&new Set(v.map(x=>JSON.stringify(x))).size!==v.length)return key==='tags'?'The same tag is given twice.':name+': the same entry is given twice.';
  for(const x of v){const p=schemaProblem(s.items,x,key);if(p)return p;}
 }
 if(s.type==='object'&&v&&typeof v==='object'){
  for(const k of s.required||[])if(v[k]===undefined&&!['expected_version','request_id'].includes(k))return fieldWords(k)+' is missing.';
  for(const [k,x] of Object.entries(v))if(s.properties&&s.properties[k]){const p=schemaProblem(s.properties[k],x,k);if(p)return p;}
 }
 return null;
}

// A modal form for one write. The page keeps no business data of its own: the write goes through the
// shared client's perform(), which sends the version this page last read (the form is modal, so
// that is the version seen when it opened) and reuses the request ID when an unchanged form is
// submitted again; Core decides. A refusal shows the App's message (its code is kept on the element
// for tests) and nothing is assumed.
function formDialog({title,tool,fields=[],build,submitLabel,note,after,danger}){
 if(!has(tool))throw Error('This operation is not allowed for the current account and policy.');
 const error=el('p',{role:'alert',class:'form-error'});
 const submit=el('button',{type:'submit',class:danger?'':'primary'},submitLabel||title);
 const d=el('dialog',{'aria-label':title,'data-operation':tool});
 const form=el('form',{},el('h2',{},title),note?el('p',{class:'muted'},note):null,el('div',{class:'fields'},...fields),error,
  el('div',{class:'form-actions'},el('button',{type:'button',onclick:()=>d.close()},'Cancel'),submit));
 form.addEventListener('submit',async event=>{
  event.preventDefault();error.textContent='';delete error.dataset.code;submit.disabled=true;
  try{const args=await build();const problem=schemaProblem(schemas.get(tool),args);if(problem)throw Object.assign(Error(problem),{code:'form_check'});
   const result=await UI.perform(tool,args);d.close();await after?.(result);}
  catch(e){error.textContent=e.message;error.dataset.code=e.code||'request_failed';}
  finally{submit.disabled=false;}
 });
 d.append(form);d.addEventListener('close',()=>d.remove());document.body.append(d);d.showModal();
 return d;
}
const confirmDialog=(title,tool,args,note,after)=>formDialog({title,tool,note,build:()=>args,after,submitLabel:title});

// ---- Meal plan --------------------------------------------------------------------------------------
// A slot's history row in words: what was planned at that point and who the guests were, so a
// cleared, changed or guest row can be read against the rows before it.
const SLOT_ACTIONS={set:'Planned',replaced:'Changed',cleared:'Cleared',cooked:'Cooked',skipped:'Skipped',guest_added:'Guest added',guest_changed:'Guest changed',guest_removed:'Guest removed'};
function slotRowText(s,r){
 const dishes=r.dishes?.length?r.dishes.map(d=>d.leftovers_of?'leftovers of '+recipeTitle(d.recipe_id):recipeTitle(d.recipe_id)).join(', '):'Nothing planned';
 // A guest no longer on the meal is named from the ID; a numbered ID made by this page carries no name.
 const guest=id=>s.guests.find(g=>g.guest_id===id)?.name||(/^guest-\d+$/.test(id)?'a guest no longer at this meal':cap(String(id).replace(/^guest-/,'').replace(/-/g,' ')));
 return dishes+(r.guest_ids?.length?' · guests: '+r.guest_ids.map(guest).join(', '):'');
}
function slotSummary(s){
 if(!s.dishes.length)return 'Cleared';
 return s.dishes.map(d=>d.kind==='leftovers'?'Leftovers: '+d.title:d.title).join(' + ');
}
const people=s=>s.attendees.map(memberName).concat(s.guests.map(g=>g.name+' (guest)'));
function flagText(f){
 if(f.type==='person')return f.name+': '+VERDICT[f.verdict];
 return {archived_recipe:'Archived recipe',stale_base:'Base recipe changed since this variant',leftover_short:'Not enough leftovers ('+f.available+' left)',leftover_expired:'Leftovers older than '+plural(f.leftover_max_days,'day'),limit_unchecked:f.name+': limit cannot be checked'}[f.type]||cap(f.type);
}
const flagChip=f=>el('span',{class:'pw-warn '+(f.verdict||'')},flagText(f));
function weekView(shown,ui){
 const plan=ui.aux.plan,today=ui.aux.today;
 if(!plan)return el('div',{class:'empty'},el('h3',{},'The plan is not available'),el('p',{},'This account cannot read the meal plan.'));
 const move=n=>{weekStart=addDays(plan.start,n);focus.week=null;return ui.refresh();};
 const pane=el('div',{class:'pw-pane'},el('div',{class:'pw-bar'},el('h3',{},dayLabel(plan.start,{day:'numeric',month:'short'})+' – '+dayLabel(plan.end,{day:'numeric',month:'short',year:'numeric'})),
  button('‹',()=>move(-7),{'aria-label':'Previous week'}),button('This week',()=>{weekStart=null;focus.week=null;return ui.refresh();}),button('›',()=>move(7),{'aria-label':'Next week'})));
 for(let i=0;i<7;i++){
  const day=addDays(plan.start,i),slots=plan.slots.filter(s=>s.date===day);
  const box=el('section',{class:'pw-day'+(day===today?' today':day<today?' past':''),'data-date':day},
   el('header',{},el('h4',{},dayLabel(day,{weekday:'long',day:'numeric',month:'short'})),day===today?tag('Today'):null,
    has(TOOLS.slotSet)&&day>=today?button('+ Plan a meal',()=>slotEditor({date:day}),{class:'pw-add','aria-label':'Plan a meal on '+dayLabel(day,{weekday:'long',day:'numeric',month:'long'})}):null));
  for(const s of slots){
   const warn=s.flags.filter(f=>f.type!=='person'||f.verdict!=='ok');
   box.append(el('button',{type:'button',class:'pw-slot '+s.state,'data-slot-id':s.id,'aria-pressed':String(focus.week===s.id),onclick:()=>show('week','week',s.id).catch(ui.error)},
    el('span',{class:'meal'},cap(s.meal)),el('span',{},el('strong',{},slotSummary(s)),el('small',{},people(s).join(', ')),warn.map(flagChip)),
    el('span',{class:'pw-state '+s.state},cap(s.state))));
  }
  if(!slots.length)box.append(el('p',{class:'pw-none'},'Nothing planned'));
  pane.append(box);
 }
 return pane;
}
function slotDetail(ui){
 const s=ui.aux.plan?.slots.find(x=>x.id===focus.week);
 if(!s)return el('div',{class:'empty'},el('h3',{},'Pick a meal'),el('p',{},'Select a meal to see who it is for, what the check found and what happened to it.'));
 const today=ui.aux.today,future=s.date>=today;
 const actions=el('div',{class:'pw-actions'});
 if(s.state!=='cooked'&&future&&has(TOOLS.slotSet))actions.append(button(s.state==='planned'?'Change meal':'Plan again',()=>slotEditor(s),{class:'primary'}));
 if(s.state==='planned'&&s.date<=today&&has(TOOLS.slotMark))actions.append(button('Mark cooked',()=>markDialog(s,'cooked')));
 if(s.state==='planned'&&has(TOOLS.slotMark))actions.append(button('Mark skipped',()=>markDialog(s,'skipped')));
 if(s.state==='planned'&&future&&has(TOOLS.slotSet))actions.append(button('Clear',()=>confirmDialog('Clear this meal',TOOLS.slotSet,{id:s.id,dishes:[]},'The meal stays in the plan\'s history as cleared.')));
 return el('article',{class:'pw-slot-detail'},el('span',{class:'kicker'},dayLabel(s.date,{weekday:'long',day:'numeric',month:'long',year:'numeric'})+' · '+cap(s.meal)),
  el('h2',{},slotSummary(s)),el('div',{class:'tags'},tag(cap(s.state)),tag(cap(s.phase))),actions,
  s.flags.length?el('section',{},el('h3',{},'What the check found'),s.flags.map(f=>el('div',{class:'metadata-line'},el('span',{},flagText(f)),el('strong',{},f.type==='person'?f.dishes.flatMap(d=>d.findings.map(x=>findingText(x,l=>ingredientName(l.ingredient_id)+(l.optional?' (optional)':'')))).join('; '):'')))):s.dishes.length?el('p',{class:'muted'},'Right for everyone at the table on this day.'):null,
  s.dishes.length?el('h3',{},'Dishes'):null,s.dishes.map(d=>metadata(d.kind==='leftovers'?'Leftovers':'Recipe',d.title+(d.kind==='leftovers'?' · '+plural(d.portions,'portion')+' from '+slotLabel(d.leftovers_of):' · '+plural(d.servings,'serving')+(d.servings_source==='explicit'?' (set for this meal)':' (for who is eating)')))),
  metadata('At the table',people(s).join(', ')),s.guests.map(g=>metadata(g.name,g.constraints.length?g.constraints.map(constraintText).join('; '):'No needs given')),
  s.note?metadata('Note',s.note):null,
  s.cooked?metadata('Cooked',time(s.cooked.at)+' · '+s.cooked.portions.map(p=>p.made+' made, '+p.eaten+' eaten').join('; ')+(s.cooked.deducted?' · taken from the pantry':'')):null,
  s.leftovers?.length?metadata('Leftovers',s.leftovers.map(l=>l.portions_left?plural(l.portions_left,'portion')+' left, good until '+fullDate(l.usable_until):'None left').join('; ')):null,
  el('h3',{},'History'),history(s.history,r=>slotRowText(s,r),12,SLOT_ACTIONS));
}
async function slotEditor(slot){
 const today=UI.aux.today,recipes=(await allRecipes()).filter(r=>r.state==='active').sort((a,b)=>a.title.localeCompare(b.title));
 const members=(UI.aux.household?.members)||(await UI.call(TOOLS.household,{})).members;
 const id=slot.id||null,dateBox=dateInput(slot.date,{min:today,required:true}),mealBox=select(MEALS,slot.meal||'dinner');
 if(id){dateBox.disabled=true;mealBox.disabled=true;}
 const dishes=el('div',{class:'pw-subform'}),addDish=d=>{
  const kind=select([['recipe','Recipe'],['leftovers','Leftovers']],d?.kind||'recipe',{'aria-label':'Dish kind'});
  const recipe=select([['','Choose a recipe']].concat(recipes.map(r=>[r.id,r.title])),d?.recipe_id||'',{'aria-label':'Recipe'});
  const servings=numberInput(d?.servings_source==='explicit'?d.servings:'',{min:1,max:200,placeholder:'auto','aria-label':'Servings'});
  const sources=(UI.aux.plan?.slots||[]).filter(s=>['planned','cooked'].includes(s.state)&&s.id!==id&&s.dishes.some(x=>x.kind==='recipe'));
  const from=select([['','From which meal?']].concat(sources.map(s=>[s.id,dayLabel(s.date)+' '+s.meal+' · '+slotSummary(s)])),d?.leftovers_of||'',{'aria-label':'Leftovers from'});
  const portions=numberInput(d?.portions||2,{min:0.5,'aria-label':'Portions'});
  const row=el('div',{class:'pw-inline','data-dish':''},el('label',{},'Dish',kind),el('label',{class:'r'},'Recipe',recipe),el('label',{class:'r'},'Servings',servings),
   el('label',{class:'l'},'From',from),el('label',{class:'l'},'Portions',portions),button('Remove',()=>row.remove()));
  const sync=()=>{for(const x of row.querySelectorAll('.r'))x.hidden=kind.value!=='recipe';for(const x of row.querySelectorAll('.l'))x.hidden=kind.value!=='leftovers';};
  kind.addEventListener('change',sync);sync();
  row.read=()=>{
   if(kind.value==='recipe'){if(!recipe.value)throw Error('Choose a recipe for each dish.');return {recipe_id:recipe.value,...(servings.value?{servings:Number(servings.value)}:{})};}
   if(!from.value)throw Error('Choose the meal the leftovers come from.');
   const src=sources.find(s=>s.id===from.value),cooked=src.dishes.filter(x=>x.kind==='recipe');
   return {leftovers_of:from.value,...(cooked.length>1?{recipe_id:cooked[0].recipe_id}:{}),portions:Number(portions.value)};
  };
  dishes.insertBefore(row,dishes.lastChild);
 };
 dishes.append(button('+ Add a dish',()=>addDish()));
 for(const d of slot.dishes?.length?slot.dishes:[{}])addDish(d.recipe_id||d.leftovers_of?d:(slot.recipe_id?{recipe_id:slot.recipe_id}:null));
 const attendees=checks(members.map(m=>[m.person_id,m.display_name]),slot.attendees||members.map(m=>m.person_id));
 // A guest keeps the ID the App returned; a new guest gets the next free guest-<n> of this meal, so two
 // guests never share an ID whatever their names are.
 const guestIds=new Set((slot.guests||[]).map(g=>g.guest_id)),freshGuestId=()=>{let n=1;while(guestIds.has('guest-'+n))n++;guestIds.add('guest-'+n);return 'guest-'+n;};
 const guests=el('div',{class:'pw-subform'}),addGuest=g=>{
  const guestId=g?.guest_id||freshGuestId();
  const name=textInput(g?.name||'',{'aria-label':'Guest name',placeholder:'Name'}),needs=[...(g?.constraints||[])];
  const chips=el('div',{}),draw=()=>chips.replaceChildren(...needs.map((c,i)=>el('span',{class:'pw-chip'},constraintText(c),button('✕',()=>{needs.splice(i,1);draw();},{'aria-label':'Remove need'}))));
  const kind=select([['','Add a need…'],['allergy','Allergy'],['diet','Diet'],['dislike','Dislike'],['limit','Limit per meal']],'',{'aria-label':'Guest need'});
  const value=el('span',{});let read=null;
  kind.addEventListener('change',()=>{
   if(kind.value==='allergy'){const a=select(ALLERGENS),strict=el('input',{type:'checkbox'});value.replaceChildren(a,el('label',{},strict,' strict'));read=()=>({kind:'allergy',allergen:a.value,strict:strict.checked});}
   else if(kind.value==='diet'){const a=select(DIETS);value.replaceChildren(a);read=()=>({kind:'diet',diet:a.value});}
   else if(kind.value==='dislike'){const a=textInput('',{placeholder:'tag, e.g. spicy'});value.replaceChildren(a);read=()=>({kind:'dislike',tag:a.value.trim()});}
   else if(kind.value==='limit'){const n=select(Object.entries(NUTRIENTS)),m=numberInput('',{min:0,placeholder:'max'});value.replaceChildren(n,m);read=()=>({kind:'limit',nutrient:n.value,max:Number(m.value)});}
   else{value.replaceChildren();read=null;}
  });
  const row=el('div',{class:'pw-subform','data-guest':''},el('div',{class:'pw-inline'},el('label',{},'Guest',name),button('Remove guest',()=>row.remove())),chips,
   el('div',{class:'pw-inline'},kind,value,button('Add need',()=>{if(read){needs.push(read());kind.value='';kind.dispatchEvent(new Event('change'));draw();}})));
  draw();
  row.read=()=>{const n=name.value.trim();if(!n)throw Error('Give each guest a name.');return {guest_id:guestId,name:n,constraints:needs};};
  guests.insertBefore(row,guests.lastChild);
 };
 guests.append(button('+ Add a guest',()=>addGuest()));
 for(const g of slot.guests||[])addGuest(g);
 const note=el('textarea',{rows:2},slot.note||'');
 formDialog({title:id?'Change '+slot.meal+' on '+dayLabel(slot.date):'Plan a meal',tool:TOOLS.slotSet,submitLabel:'Save meal',
  note:'A dish that is wrong for someone is still planned; the plan then shows why.',
  fields:[el('div',{class:'pw-inline'},el('label',{},'Date',dateBox),el('label',{},'Meal',mealBox)),field('Dishes',dishes),field('Who is eating',attendees),field('Guests',guests),field('Note',note)],
  build:()=>{
   if(!dateBox.value)throw Error('Choose a date.');
   return {id:id||dateBox.value+':'+mealBox.value,dishes:[...dishes.querySelectorAll('[data-dish]')].map(r=>r.read()),attendees:attendees.values(),
    guests:[...guests.querySelectorAll('[data-guest]')].map(r=>r.read()),...(note.value.trim()?{note:note.value.trim()}:{})};
  },
  after:r=>{focus.week=r.id;const shown=UI.aux.plan;if(!shown||r.id.slice(0,10)<shown.start||r.id.slice(0,10)>shown.end){const d=new Date(r.id.slice(0,10)+'T12:00:00Z');weekStart=addDays(r.id.slice(0,10),-((d.getUTCDay()+6)%7));}return UI.navigate('week');}});
}
function markDialog(s,status){
 const recipesCooked=s.dishes.filter(d=>d.kind==='recipe');
 const rows=recipesCooked.map(d=>{const made=numberInput(d.servings,{min:0,'aria-label':'Portions made'}),eaten=numberInput('',{min:0,placeholder:'everyone at the table','aria-label':'Portions eaten'});
  return {d,made,eaten,node:el('div',{class:'pw-inline'},el('strong',{},d.title),el('label',{},'Made',made),el('label',{},'Eaten',eaten))};});
 const deduct=el('input',{type:'checkbox'});
 formDialog({title:status==='cooked'?'Mark as cooked':'Mark as skipped',tool:TOOLS.slotMark,submitLabel:status==='cooked'?'Mark cooked':'Mark skipped',
  note:status==='cooked'?'What is left over becomes available to later meals for a few days.':'The meal stays in the history as skipped.',
  fields:status==='cooked'?[...rows.map(r=>r.node),el('label',{class:'pw-checks'},deduct,'Take the ingredients from the pantry')]:[],
  build:()=>status==='skipped'?{id:s.id,status}:{id:s.id,status,deduct_pantry:deduct.checked,
   ...(rows.length?{portions:rows.map(r=>({recipe_id:r.d.recipe_id,...(r.made.value!==''?{made:Number(r.made.value)}:{}),...(r.eaten.value!==''?{eaten:Number(r.eaten.value)}:{})}))}:{})},
  after:async r=>{if(!r.short?.length)return;await ensureIngredientNames(r.short);
   const why={not_in_pantry:'not in the pantry',no_conversion:'stored in a unit that cannot be converted',not_enough:'not enough',expired:'past its use-by date'};
   // A success with a note, so it goes in the status line without the error styling.
   const status=document.getElementById('status');if(!status)return;delete status.dataset.error;
   status.textContent='Cooked. Short in the pantry: '+r.short.map(x=>ingredientName(x.ingredient_id)+' '+qty(x.quantity,x.unit)+' ('+(why[x.reason]||words(x.reason))+')').join(', ');}});
}

// ---- Recipes -----------------------------------------------------------------------------------------
function recipeList(shown,ui){
 const pane=el('div',{});
 if(ui.section==='recipes'&&has(TOOLS.create))pane.append(el('div',{class:'pw-pane'},el('div',{class:'pw-bar'},el('h3',{},'Your recipe box'),button('New recipe',()=>recipeEditor(),{class:'primary'}))));
 for(const r of shown)pane.append(ui.record(r,el('span',{class:'record-title'},r.title),
  el('span',{class:'record-subtitle'},[r.total_minutes?r.total_minutes+' min':null,'serves '+r.servings,r.variant_of?'variant':null,...r.tags.slice(0,3)].filter(Boolean).join(' · ')),
  r.contains.length?el('span',{class:'record-subtitle'},'Contains '+r.contains.map(words).join(', ')):null));
 if(!shown.length)pane.append(el('div',{class:'empty'},el('h3',{},'No recipes here'),el('p',{},'Try a different search.')));
 return pane;
}
function ingredientRows(recipe){
 return el('table',{class:'pw-table'},el('tbody',{},recipe.lines.map(l=>el('tr',{},el('td',{class:'q'},qty(l.quantity,l.unit)),el('td',{},l.name,l.optional?el('small',{},'optional'):null,l.note?el('small',{},l.note):null)))));
}
const lineNamer=recipe=>l=>recipe.lines.find(x=>x.line===l.line)?.name||ingredientName(l.ingredient_id);
function nutritionBlock(n,missing,recipe){
 if(!n)return el('p',{class:'muted'},'Nutrition cannot be computed: no weight for '+[...new Set((missing||[]).map(lineNamer(recipe)))].join(', ')+'.');
 return el('div',{class:'pw-nutrition'},Object.entries(NUTRIENTS).map(([k,l])=>el('div',{},el('strong',{},n[k]),el('small',{},l))));
}
function recipeView(r,ui){
 const art=el('article',{class:'pw-recipe'});
 const ingredients=el('div',{},ingredientRows(r)),nutrition=el('div',{},nutritionBlock(r.nutrition,r.missing_for,r));
 const servings=numberInput(r.servings,{min:1,max:200,'aria-label':'Servings'}),units=select(enumOf(TOOLS.recipe,'unit_system').length?enumOf(TOOLS.recipe,'unit_system'):['recipe','metric','us'],r.unit_system,{'aria-label':'Units'});
 const scale=async()=>{const x=(await ui.call(TOOLS.recipe,{id:r.id,servings:Number(servings.value),unit_system:units.value})).recipe;ingredients.replaceChildren(ingredientRows(x));nutrition.replaceChildren(nutritionBlock(x.nutrition,x.missing_for,x));};
 const actions=el('div',{class:'pw-actions'});
 if(r.state==='active'&&has(TOOLS.slotSet))actions.append(button('Plan this',()=>slotEditor({date:ui.aux.today,recipe_id:r.id}),{class:'primary'}));
 if(r.state==='active'&&!r.variant&&has(TOOLS.update))actions.append(button('Edit recipe',()=>recipeEditor(r)));
 if(r.state==='active'&&!r.variant&&has(TOOLS.variant))actions.append(button('Swap ingredients',()=>variantDialog(r)));
 if(has(TOOLS.update))actions.append(r.state==='active'?button('Archive',()=>confirmDialog('Archive recipe',TOOLS.update,{id:r.id,patch:{archived:true}},'It stays readable and stays in past plans.',()=>UI.navigate('archived'))):
  button('Restore',()=>confirmDialog('Restore recipe',TOOLS.update,{id:r.id,patch:{archived:false}},null,()=>UI.navigate('recipes'))));
 // The suitability check for chosen people on a chosen day.
 const members=ui.aux.household?.members||[],who=checks(members.map(m=>[m.person_id,m.display_name]),members.map(m=>m.person_id)),on=dateInput(ui.aux.today),verdicts=el('div',{class:'pw-verdicts'});
 const runCheck=async()=>{const c=await ui.call(TOOLS.check,{id:r.id,members:who.values(),...(on.value?{date:on.value}:{})});
  verdicts.replaceChildren(...c.verdicts.map(v=>el('div',{'data-verdict':v.verdict},el('strong',{},v.name),el('span',{class:'pw-warn '+v.verdict},VERDICT[v.verdict]),
   el('small',{},[...v.findings.map(f=>findingText(f,lineNamer(r))),...(v.unchecked.length?['limit cannot be checked: nutrition unknown']:[])].join('; ')))));};
 art.append(...[el('span',{class:'kicker'},(r.variant?'Variant · ':'')+(r.state==='archived'?'Archived · ':'')+'Revision '+r.revision),el('h2',{},r.title),
  el('div',{class:'tags'},r.tags.map(tag),r.method_tags.map(m=>tag(m))),actions,
  el('div',{class:'pw-inline'},el('label',{},'Servings',servings),el('label',{},'Units',units),button('Scale',scale)),
  el('h3',{},'Ingredients'),ingredients,el('h3',{},'Method'),el('ol',{class:'pw-steps'},r.steps.map(s=>el('li',{},s))),
  el('h3',{},'Per serving'),nutrition,
  metadata('Time',(r.active_minutes!=null?r.active_minutes+' min active · ':'')+(r.total_minutes!=null?r.total_minutes+' min total':'')),
  metadata('Contains',r.contains.map(words).join(', ')||'None of the nine allergens'),r.may_contain.length?metadata('May contain',r.may_contain.map(words).join(', ')):null,
  metadata('Flags',r.flags.map(words).join(', ')||'None'),
  r.variant?metadata('Variant of',r.variant.base_title+' (revision '+r.variant.base_revision+')'+(r.variant.stale_base?' · the base has changed since':'')+(r.variant.unverified?' · unverified swap':'')):null,
  el('h3',{},'Check for the table'),el('div',{class:'pw-subform'},who,el('div',{class:'pw-inline'},el('label',{},'On',on),button('Check',runCheck)),verdicts),
  el('h3',{},'Revisions'),history(r.history,x=>x.revision?'revision '+x.revision:'')].flat().filter(x=>x!=null));
 return art;
}
async function recipeEditor(r){
 const ingredients=await allIngredients(),byId=new Map(ingredients.map(i=>[i.id,i]));
 const title=textInput(r?.title,{required:true}),servings=numberInput(r?.base_servings??r?.servings??4,{min:1,max:200,required:true});
 const methods=checks(enumOf(TOOLS.create,'method_tags').map(m=>[m,cap(m)]),r?.method_tags||[]);
 const tags=textInput((r?.tags||[]).join(', ')),active=numberInput(r?.active_minutes,{min:0}),total=numberInput(r?.total_minutes,{min:0});
 const steps=el('textarea',{rows:5},(r?.steps||[]).join('\n'));
 const lines=el('div',{class:'pw-subform'}),addLine=l=>{
  const ing=select([['','Ingredient']].concat(ingredients.map(i=>[i.id,i.name])),l?.ingredient_id||'',{'aria-label':'Ingredient'});
  const q=numberInput(l?.as_written?.quantity??l?.quantity??'',{min:0,'aria-label':'Quantity'}),unit=unitSelect(byId.get(l?.ingredient_id),TOOLS.pantrySet,l?.as_written?.unit??l?.unit,{'aria-label':'Unit'});
  ing.addEventListener('change',()=>{const keep=unit.value;refillUnits(unit,byId.get(ing.value),TOOLS.pantrySet);if([...unit.options].some(o=>o.value===keep))unit.value=keep;});
  const optional=el('input',{type:'checkbox',checked:!!l?.optional});
  const row=el('div',{class:'pw-inline','data-line':''},el('label',{},'Ingredient',ing),el('label',{},'Quantity',q),el('label',{},'Unit',unit),el('label',{class:'pw-checks'},optional,'optional'),button('Remove',()=>row.remove()));
  row.read=()=>{if(!ing.value&&q.value==='')return null;if(!ing.value)throw Error('Choose an ingredient on every line that has a quantity.');return {ingredient_id:ing.value,quantity:Number(q.value),unit:unit.value,optional:optional.checked,...(l?.note?{note:l.note}:{})};};
  lines.insertBefore(row,lines.lastChild);
 };
 lines.append(button('+ Add a line',()=>addLine()));
 for(const l of r?.lines||[{}])addLine(l.ingredient_id?l:null);
 const readLines=()=>{const out=[...lines.querySelectorAll('[data-line]')].map(x=>x.read()).filter(Boolean);if(!out.length)throw Error('Add at least one ingredient.');return out;};
 const read=()=>({title:title.value.trim(),servings:Number(servings.value),lines:readLines(),method_tags:methods.values(),
  steps:steps.value.split('\n').map(s=>s.trim()).filter(Boolean),tags:tags.value.split(',').map(s=>s.trim()).filter(Boolean),
  active_minutes:active.value===''?null:Number(active.value),total_minutes:total.value===''?null:Number(total.value)});
 formDialog({title:r?'Edit recipe':'New recipe',tool:r?TOOLS.update:TOOLS.create,submitLabel:r?'Save changes':'Save recipe',note:r?'Saving adds a revision; earlier revisions stay readable.':null,
  fields:[field('Title',title),el('div',{class:'pw-inline'},el('label',{},'Serves',servings),el('label',{},'Active minutes',active),el('label',{},'Total minutes',total)),
   field('Ingredients',lines),field('Method',methods),field('Steps',steps,'One step per line.'),field('Tags',tags,'Separated by commas.')],
  build:()=>{const v=read();if(!r)return v;
   const before={title:r.title,servings:r.base_servings,lines:r.lines.map(l=>({ingredient_id:l.ingredient_id,quantity:l.as_written.quantity,unit:l.as_written.unit,optional:l.optional,...(l.note?{note:l.note}:{})})),
    method_tags:r.method_tags,steps:r.steps,tags:r.tags,active_minutes:r.active_minutes,total_minutes:r.total_minutes};
   const patch=Object.fromEntries(Object.entries(v).filter(([k,x])=>JSON.stringify(x)!==JSON.stringify(before[k])));
   if(!Object.keys(patch).length)throw Error('No changes to save.');
   return {id:r.id,patch};},
  after:x=>UI.navigate('recipes').then(()=>UI.select(x.id))});
}
async function variantDialog(r){
 const subs=await UI.call(TOOLS.substitutions,{id:r.id});
 const choices=subs.lines.map(l=>{const s=select([['','Keep '+l.name]].concat(l.rules.map(x=>[x.id,(x.applicable?'':'✕ ')+x.to_name+' ('+x.ratio+'×)'+(x.applicable?'':' — '+words(x.reason))])),'',{'aria-label':'Swap for '+l.name,disabled:!l.rules.length});return {l,s};});
 const title=textInput('',{placeholder:'Default: names the swaps'}),out=el('div',{class:'pw-verdicts'});
 const swaps=()=>choices.filter(c=>c.s.value).map(c=>({ingredient_id:c.l.ingredient_id,line:c.l.line,rule_id:c.s.value}));
 const previewBtn=button('Preview',async()=>{
  if(!swaps().length)throw Error('Choose at least one swap.');
  const p=await UI.call(TOOLS.preview,{id:r.id,swaps:swaps(),...(title.value.trim()?{title:title.value.trim()}:{})});
  out.replaceChildren(el('strong',{},p.title),...p.check.map((v,i)=>el('div',{},el('span',{},v.name),el('span',{class:'pw-warn '+p.base_check[i].verdict},VERDICT[p.base_check[i].verdict]),'→',el('span',{class:'pw-warn '+v.verdict},VERDICT[v.verdict]))));
 });
 formDialog({title:'Swap ingredients in '+r.title,tool:TOOLS.variant,submitLabel:'Save as a variant',note:'A variant is a recipe of its own that records what was swapped. Preview shows exactly what will be saved and how it checks for the household today.',
  fields:[...choices.map(c=>field(c.l.name,c.s)),field('Variant title',title),previewBtn,out],
  build:()=>{if(!swaps().length)throw Error('Choose at least one swap.');return {id:r.id,swaps:swaps(),...(title.value.trim()?{title:title.value.trim()}:{})};},
  after:x=>UI.navigate('recipes').then(()=>UI.select(x.id))});
}

// ---- Shopping list -----------------------------------------------------------------------------------
function shoppingView(shown,ui){
 const list=ui.aux.shopping?.list,pane=el('div',{class:'pw-pane'});
 const bar=el('div',{class:'pw-bar'},el('h3',{},list?'For '+dayLabel(list.start,{day:'numeric',month:'short'})+' – '+dayLabel(list.end,{day:'numeric',month:'short'}):'No list yet'));
 if(has(TOOLS.generate))bar.append(button(list?'New list':'Make a list',()=>generateDialog(list),{class:list?'':'primary'}));
 if(list&&has(TOOLS.lineSet))bar.append(button('Add item',()=>lineDialog()));
 pane.append(bar);
 if(!list){pane.append(el('p',{class:'muted'},'Make a list from the planned meals of a window, less what the pantry already holds.'));return pane;}
 if(list.stale)pane.append(el('div',{class:'pw-banner',role:'note'},'The plan, pantry, recipes or profiles changed since this list was made.',has(TOOLS.generate)?button('Update the list',()=>confirmDialog('Update the list',TOOLS.generate,{start:list.start,end:list.end},'Your own items, ticks and exclusions are kept.')):null));
 const row=l=>{
  const box=el('input',{type:'checkbox',checked:l.state==='ticked','aria-label':(l.state==='ticked'?'Untick ':'Tick ')+(l.name||l.text),disabled:!has(TOOLS.lineSet)||l.state==='excluded'});
  box.addEventListener('click',e=>{e.stopPropagation();e.preventDefault();UI.perform(TOOLS.lineSet,{id:l.id,ticked:l.state!=='ticked'}).catch(err=>UI.error(err));});
  return el('div',{class:'pw-row '+l.state,role:'button',tabindex:'0','data-line-id':l.id,'aria-pressed':String(focus.shopping===l.id),onclick:()=>show('shopping','shopping',l.id).catch(ui.error)},
   box,el('span',{class:'grow'},el('strong',{},l.name||l.text),el('small',{},l.kind==='manual'?'Added by hand':'For '+l.slots.map(slotLabel).join(', '))),
   el('span',{},qty(l.quantity,l.unit)),l.surplus?tag('Surplus'):null);
 };
 const groups=[['Still to buy',x=>x.state==='needed'],['In the basket',x=>x.state==='ticked'],['Not buying',x=>x.state==='excluded']];
 for(const [label,test] of groups){const ls=list.lines.filter(test);if(ls.length)pane.append(el('h4',{class:'pw-group'},label+' · '+ls.length),...ls.map(row));}
 if(list.optional_lines?.length)pane.append(el('h4',{class:'pw-group'},'Optional, not on the list'),el('p',{class:'muted'},[...new Set(list.optional_lines.map(o=>o.name))].join(', ')));
 if(list.expiring_before_use?.length)pane.append(el('h4',{class:'pw-group'},'In the pantry but expiring before use'),el('p',{class:'muted'},list.expiring_before_use.map(o=>o.name+' (use by '+fullDate(o.use_by)+', needed '+fullDate(o.first_needed)+')').join(', ')));
 return pane;
}
function lineDetail(ui){
 const l=ui.aux.shopping?.list?.lines.find(x=>x.id===focus.shopping);
 if(!l)return el('div',{class:'empty'},el('h3',{},'Your list'),el('p',{},'Select an item to see which meals it is for and what happened to it.'));
 const actions=el('div',{class:'pw-actions'});
 if(has(TOOLS.lineSet)){
  if(l.kind==='derived')actions.append(...[l.state==='excluded'?button('Buy it after all',()=>confirmDialog('Put back on the list',TOOLS.lineSet,{id:l.id,excluded:false})):l.state==='needed'?button('Not buying',()=>excludeDialog(l)):null].filter(Boolean));
  else actions.append(button('Edit item',()=>lineDialog(l)));
 }
 if(l.kind==='manual'&&has(TOOLS.lineRemove))actions.append(button('Remove',()=>confirmDialog('Remove item',TOOLS.lineRemove,{id:l.id},null,()=>{focus.shopping=null;})));
 return el('article',{},el('span',{class:'kicker'},l.kind==='manual'?'Added by hand':'From the plan'),el('h2',{},l.name||l.text),el('div',{class:'tags'},tag(cap(l.state)),l.surplus?tag('Surplus'):null),actions,
  metadata('To buy',qty(l.quantity,l.unit)),l.kind==='derived'?[metadata('Needed in all',qty(l.needed_total,l.unit)),metadata('From the pantry',qty(l.from_pantry,l.unit)),metadata('For',l.slots.map(slotLabel).join(', ')),metadata('First needed',fullDate(l.first_needed))]:null,
  l.excluded_reason?metadata('Why not',l.excluded_reason):null,el('h3',{},'History'),history(l.history));
}
async function generateDialog(w){
 // Without a list, the form starts on the current week of the plan.
 if(!w){const p=has(TOOLS.plan)?await UI.call(TOOLS.plan,{}):null;w={start:p?.start||UI.aux.today||'',end:p?.end||UI.aux.today||''};}
 const start=dateInput(w.start,{required:true}),end=dateInput(w.end,{required:true});
 formDialog({title:'Make a shopping list',tool:TOOLS.generate,submitLabel:'Make list',note:'From every planned meal in the window (at most 28 days), less usable pantry stock. Your own items, ticks and exclusions are kept.',
  fields:[el('div',{class:'pw-inline'},el('label',{},'From',start),el('label',{},'To',end))],build:()=>({start:start.value,end:end.value})});
}
async function lineDialog(l){
 const ingredients=await allIngredients(),byId=new Map(ingredients.map(i=>[i.id,i]));
 const ing=select([['','Something else (free text)']].concat(ingredients.map(i=>[i.id,i.name])),l?.ingredient_id||'',{'aria-label':'Ingredient'});
 const text=textInput(l?.text||'',{placeholder:'e.g. Birthday candles'}),q=numberInput(l?.quantity??1,{min:0}),unit=unitSelect(byId.get(l?.ingredient_id),TOOLS.lineSet,l?.unit||'each');
 ing.addEventListener('change',()=>{const i=byId.get(ing.value);refillUnits(unit,i,TOOLS.lineSet);if(i)unit.value=i.buy_unit;text.disabled=!!ing.value;});
 text.disabled=!!ing.value;
 if(l)ing.disabled=true;
 formDialog({title:l?'Edit item':'Add to the list',tool:TOOLS.lineSet,submitLabel:l?'Save':'Add',
  fields:[field('Ingredient',ing),field('Or',text),el('div',{class:'pw-inline'},el('label',{},'Quantity',q),el('label',{},'Unit',unit))],
  build:()=>{const base={quantity:Number(q.value),unit:unit.value};
   if(l)return {id:l.id,...base,...(l.ingredient_id?{}:{text:text.value.trim()})};
   return ing.value?{ingredient_id:ing.value,...base}:{text:text.value.trim(),...base};},
  after:r=>{focus.shopping=r.id;}});
}
function excludeDialog(l){
 const reason=textInput('',{required:true,placeholder:'e.g. Using parsley from the garden'});
 formDialog({title:'Not buying '+(l.name||l.text),tool:TOOLS.lineSet,submitLabel:'Leave it off',fields:[field('Reason',reason)],build:()=>({id:l.id,excluded:true,reason:reason.value.trim()})});
}

// ---- Pantry --------------------------------------------------------------------------------------------
function pantryView(shown,ui){
 const p=ui.aux.pantry,pane=el('div',{class:'pw-pane'});
 if(!p)return el('div',{class:'empty'},el('h3',{},'The pantry is not available'));
 pane.append(el('div',{class:'pw-bar'},el('h3',{},'In the kitchen'),has(TOOLS.pantrySet)?button('Add item',()=>pantryDialog()):null));
 const groups=[['Past use-by','expired'],['Use soon','use_soon'],['Fresh','fresh'],['No use-by date','no_date']];
 for(const [label,f] of groups){
  const items=p.items.filter(i=>i.state==='in_stock'&&i.freshness===f);if(!items.length)continue;
  pane.append(el('h4',{class:'pw-group'},label+' · '+items.length),...items.map(i=>pantryRow(i)));
 }
 const out=p.items.filter(i=>i.state==='out');
 if(out.length)pane.append(el('h4',{class:'pw-group'},'Used up · '+out.length),...out.map(i=>pantryRow(i)));
 return pane;
}
const pantryRow=i=>el('button',{type:'button',class:'pw-row','data-item-id':i.ingredient_id,'aria-pressed':String(focus.pantry===i.ingredient_id),onclick:()=>show('pantry','pantry',i.ingredient_id).catch(UI.error)},
 el('span',{class:'grow'},el('strong',{},i.name),el('small',{},i.use_by?'Use by '+fullDate(i.use_by)+(i.state==='in_stock'&&i.days_left!=null&&i.days_left>=0?' · '+daysLeft(i.days_left):''):'No use-by date')),
 el('span',{},i.state==='out'?'out':qty(i.quantity,i.unit)),i.freshness==='expired'&&i.state==='in_stock'?el('span',{class:'pw-warn unsafe'},'Expired'):i.freshness==='use_soon'?el('span',{class:'pw-warn'},'Use soon'):null);
function pantryDetail(ui){
 const i=ui.aux.pantry?.items.find(x=>x.ingredient_id===focus.pantry);
 if(!i)return el('div',{class:'empty'},el('h3',{},'Your pantry'),el('p',{},'Select an item to see its stock history.'));
 const actions=el('div',{class:'pw-actions'});
 if(has(TOOLS.pantrySet)){actions.append(button('Update stock',()=>pantryDialog(i),{class:'primary'}));if(i.state==='in_stock')actions.append(button('Used up',()=>confirmDialog('Mark '+i.name+' used up',TOOLS.pantrySet,{id:i.ingredient_id,quantity:0,unit:i.unit})));}
 return el('article',{},el('span',{class:'kicker'},'Pantry'),el('h2',{},i.name),el('div',{class:'tags'},tag(cap(i.freshness)),i.state==='out'?tag('Used up'):null),actions,
  metadata('In stock',qty(i.quantity,i.unit)),metadata('Use by',i.use_by?fullDate(i.use_by):'No date'),metadata('Last changed',time(i.updated_at)),
  el('h3',{},'History'),history(i.history,r=>qty(r.quantity,r.unit)+(r.use_by?' · use by '+fullDate(r.use_by):'')+(r.slot_id?' · cooking '+slotLabel(r.slot_id):'')));
}
async function pantryDialog(item){
 const ingredients=await allIngredients(),byId=new Map(ingredients.map(i=>[i.id,i]));
 const ing=select([['','Choose an ingredient']].concat(ingredients.map(i=>[i.id,i.name])),item?.ingredient_id||'',{'aria-label':'Ingredient',required:true,disabled:!!item});
 const q=numberInput(item?.quantity??'',{min:0,required:true}),unit=unitSelect(byId.get(item?.ingredient_id),TOOLS.pantrySet,item?.unit||byId.get(item?.ingredient_id)?.buy_unit);
 ing.addEventListener('change',()=>{const i=byId.get(ing.value);refillUnits(unit,i,TOOLS.pantrySet);if(i)unit.value=i.buy_unit;});
 const useBy=dateInput(item?.use_by),none=el('input',{type:'checkbox',checked:!!item&&!item.use_by});
 formDialog({title:item?'Update '+item.name:'Add to the pantry',tool:TOOLS.pantrySet,submitLabel:'Save',
  fields:[field('Ingredient',ing),el('div',{class:'pw-inline'},el('label',{},'Quantity',q),el('label',{},'Unit',unit)),el('div',{class:'pw-inline'},el('label',{},'Use by',useBy),el('label',{class:'pw-checks'},none,'No use-by date'))],
  build:()=>{const id=item?.ingredient_id||ing.value;if(!id)throw Error('Choose an ingredient.');return {id,quantity:Number(q.value),unit:unit.value,...(none.checked?{use_by:null}:useBy.value?{use_by:useBy.value}:{})};},
  after:r=>{focus.pantry=r.id;}});
}

// ---- Household --------------------------------------------------------------------------------------
function constraintText(c){
 const what={allergy:()=>(c.strict?'Strict allergy to ':'Allergy to ')+words(c.allergen),medical:()=>'Medical: no '+(c.ingredient_id?ingredientName(c.ingredient_id).toLowerCase():words(c.flag)),diet:()=>cap(c.diet)+' diet',
  limit:()=>'At most '+c.max+' '+(AMOUNT[c.nutrient]||words(c.nutrient))+' per meal',dislike:()=>'Dislikes '+(c.ingredient_id?ingredientName(c.ingredient_id).toLowerCase():words(c.tag))}[c.kind];
 return what?what():cap(c.kind);
}
const dates=c=>[c.effective_from?'from '+fullDate(c.effective_from):'',c.expires_on?'until '+fullDate(c.expires_on):'',c.ended_at?'ended '+fullDate(c.ended_at):''].filter(Boolean).join(' · ').replace(/^./,x=>x.toUpperCase());
function householdView(shown,ui){
 const h=ui.aux.household,pane=el('div',{class:'pw-pane'});
 if(!h)return el('div',{class:'empty'},el('h3',{},'The household is not available'));
 pane.append(el('div',{class:'pw-bar'},el('h3',{},'Who eats here')));
 for(const m of h.members){
  const current=m.constraints.filter(c=>c.state==='active'),later=m.constraints.filter(c=>c.state==='scheduled');
  pane.append(el('button',{type:'button',class:'pw-card','data-member-id':m.person_id,'aria-pressed':String(focus.household===m.person_id),onclick:()=>show('household','household',m.person_id).catch(ui.error)},
   el('h4',{},m.display_name+(m.account_holder?' (you)':'')),el('small',{},['Portion '+m.portion_factor,plural(current.length,'current need'),later.length?plural(later.length,'need')+' starting later':''].filter(Boolean).join(' · ')),
   el('div',{},[...current,...later].map(c=>el('span',{class:'pw-warn '+(c.kind==='allergy'?'unsafe':'')},constraintText(c)+(c.state==='scheduled'?' (from '+fullDate(c.effective_from)+')':''))))));
 }
 return pane;
}
function memberDetail(ui){
 const m=ui.aux.household?.members.find(x=>x.person_id===focus.household);
 if(!m)return el('div',{class:'empty'},el('h3',{},'Who eats here'),el('p',{},'Select a person to see their dietary needs, with their dates and history.'));
 const order={active:0,scheduled:1,expired:2,ended:3};
 const rows=[...m.constraints].sort((a,b)=>order[a.state]-order[b.state]).map(c=>el('section',{class:'pw-subform','data-constraint-id':c.id},
  el('div',{class:'pw-bar'},el('h3',{},constraintText(c)),tag(cap(c.state)),
   ['active','scheduled'].includes(c.state)&&has(TOOLS.constraintSet)?button('Change',()=>constraintDialog(m,c)):null,
   ['active','scheduled'].includes(c.state)&&has(TOOLS.constraintRemove)?button('End',()=>endDialog(m,c)):null),
  el('small',{},dates(c)||'No start or end date'),c.note?el('p',{},c.note):null,history(c.history,r=>r.note||'',3)));
 return el('article',{},el('span',{class:'kicker'},'Household member'),el('h2',{},m.display_name),
  el('div',{class:'pw-actions'},has(TOOLS.constraintSet)?button('Add a need',()=>constraintDialog(m),{class:'primary'}):null),
  metadata('Portion factor',String(m.portion_factor)),el('h3',{},'Dietary needs'),rows.length?rows:el('p',{class:'muted'},'No needs recorded: everything checks as OK.'));
}
async function constraintDialog(m,c){
 const ingredients=await allIngredients();
 const kinds=enumOf(TOOLS.constraintSet,'constraint','kind');
 const kind=select(kinds.length?kinds:['allergy','medical','diet','limit','dislike'],c?.kind||'allergy',{'aria-label':'Kind'});
 const target=el('div',{class:'pw-inline'});let read=()=>({});
 const ingSel=v=>select([['','Choose an ingredient']].concat(ingredients.map(i=>[i.id,i.name])),v||'');
 const draw=()=>{
  const k=kind.value;
  if(k==='allergy'){const a=select(ALLERGENS,c?.allergen),s=el('input',{type:'checkbox',checked:!!c?.strict});target.replaceChildren(el('label',{},'Allergen',a),el('label',{class:'pw-checks'},s,'Strict (may-contain is unsafe too)'));read=()=>({allergen:a.value,strict:s.checked});}
  else if(k==='medical'){const i=ingSel(c?.ingredient_id);target.replaceChildren(el('label',{},'Must not have',i));read=()=>({ingredient_id:i.value});}
  else if(k==='diet'){const a=select(DIETS,c?.diet);target.replaceChildren(el('label',{},'Diet',a));read=()=>({diet:a.value});}
  else if(k==='limit'){const n=select(Object.entries(NUTRIENTS),c?.nutrient),x=numberInput(c?.max,{min:0});target.replaceChildren(el('label',{},'Nutrient',n),el('label',{},'At most per meal',x));read=()=>({nutrient:n.value,max:Number(x.value)});}
  else{const i=ingSel(c?.ingredient_id),t=textInput(c?.tag||'',{placeholder:'or a tag, e.g. spicy'});target.replaceChildren(el('label',{},'Ingredient',i),el('label',{},'Tag',t));read=()=>i.value?{ingredient_id:i.value}:{tag:t.value.trim()};}
 };
 kind.addEventListener('change',draw);draw();if(c)kind.disabled=true;
 const from=dateInput(c?.effective_from),to=dateInput(c?.expires_on),note=textInput(c?.note||'',{required:true,placeholder:'Where this came from'});
 formDialog({title:(c?'Change ':'Add a need for ')+m.display_name,tool:TOOLS.constraintSet,submitLabel:'Save',
  note:'The check applies a need from its start date to its end date, on the date of each meal.',
  fields:[field('Kind',kind),target,el('div',{class:'pw-inline'},el('label',{},'From',from),el('label',{},'Until',to)),field('Note',note)],
  build:()=>({id:m.person_id,constraint:{...(c?{id:c.id}:{}),kind:kind.value,...read(),effective_from:from.value||(c?null:undefined),expires_on:to.value||null,note:note.value.trim()}}),
  after:()=>{focus.household=m.person_id;}});
}
function endDialog(m,c){
 const note=textInput('',{placeholder:'Optional note'});
 formDialog({title:'End '+constraintText(c).toLowerCase(),tool:TOOLS.constraintRemove,submitLabel:'End it now',note:'It stops applying from today; its history is kept.',
  fields:[field('Note',note)],build:()=>({id:m.person_id,constraint_id:c.id,...(note.value.trim()?{note:note.value.trim()}:{})})});
}

// ---- Activity --------------------------------------------------------------------------------------
function activityView(shown,ui){
 const n=ui.aux.notifications?.notifications,pane=el('div',{class:'pw-pane'});
 if(!n)return el('div',{class:'empty'},el('h3',{},'Activity is not available'));
 pane.append(el('div',{class:'pw-bar'},el('h3',{},'What others changed, last '+activityDays+' days'),button('Show older',()=>{activityDays+=180;return ui.refresh();})));
 let day=null;
 for(const x of [...n].reverse()){
  const d=x.at.slice(0,10);if(d!==day){day=d;pane.append(el('h4',{class:'pw-group'},dayLabel(d,{weekday:'long',day:'numeric',month:'long',year:'numeric'})));}
  pane.append(el('div',{class:'pw-row','data-notification-id':x.id},el('span',{class:'grow'},el('strong',{},x.title),el('small',{},x.body)),el('small',{},time(x.at))));
 }
 if(!n.length)pane.append(el('p',{class:'muted'},'Nothing in this period.'));
 return pane;
}

// ---- Mount ------------------------------------------------------------------------------------------
// Each view reads only what it shows: its main list is the shared client's list call and at most one
// more read follows it (reads the page needs together are sent together). Every call costs one Core
// transaction over the whole household history, so nothing that cannot change is read twice.
const recipeLike=r=>r&&'revision' in r&&'servings' in r;
const VIEWS={
 week:{list:TOOLS.plan,collection:'slots',args:()=>weekStart?{start:weekStart,end:addDays(weekStart,6)}:{}},
 recipes:{list:TOOLS.search,collection:'items',args:()=>({limit:100,include_archived:true}),query:'query'},
 shopping:{list:TOOLS.household,collection:'members',args:()=>({})},
 pantry:{list:TOOLS.pantry,collection:'items',args:()=>({include_out:true})},
 household:{list:TOOLS.household,collection:'members',args:()=>({})},
 activity:{list:TOOLS.notifications,collection:'notifications',args:()=>lastToday?{start:addDays(lastToday,-activityDays)}:{}}
};
VIEWS.archived=VIEWS.recipes;
let loadedFor=null,switching=false,lastToday=null;
const currentView=()=>{let s=UI?.section;if(!s)try{s=sessionStorage.getItem('platewright-section');}catch(e){s=null;}return VIEWS[s]?s:'week';};
const group=s=>s==='archived'?'recipes':s;
const ready=ui=>group(loadedFor)===group(ui.section);
function weekOf(today,weekStartDay){const names=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];const d=new Date(today+'T12:00:00Z').getUTCDay();return addDays(today,-((d-names.indexOf(weekStartDay||'monday')+7)%7));}
const none=()=>false;
const config={
 id:'platewright',title:'Platewright',symbol:'◒',description:'Recipes, the household\'s needs, the week\'s meals, the pantry and the shopping list.',
 get:TOOLS.recipe,item:'recipe',searchLabel:'Search recipes, meals, pantry or activity',initialSection:'week',actions:[],
 heading:r=>r.title,subtitle:r=>(r.tags||[]).join(', '),
 async load(ui){
  UI=ui;const view=group(ui.section);
  // The tool schemas (for option lists) do not change while the page is open.
  if(!schemas.size){const listed=await fetch('/api/tools');if(listed.ok)schemas=new Map((await listed.json()).tools.map(t=>[t.name,t.inputSchema]));}
  const read=(name,args)=>ui.has(name)?ui.call(name,args):Promise.resolve(null);
  const aux={};
  if(view==='week'){
   const slots=ui.records;
   for(const s of slots)for(const d of s.dishes)recipeTitles.set(d.recipe_id,d.title);
   const unknown=slots.some(s=>s.history.some(h=>h.dishes.some(d=>!recipeTitles.has(d.recipe_id))));
   [aux.household]=await Promise.all([read(TOOLS.household,{}),ensureIngredientNames(slots.map(s=>[s.flags,s.guests])),
    unknown&&has(TOOLS.search)?allRecipes().catch(()=>null):null]);
   aux.today=aux.household?.today||lastToday;
   const start=weekStart||weekOf(aux.today,aux.household?.household.week_start);aux.plan={start,end:addDays(start,6),today:aux.today,slots};
  }else if(view==='recipes'){
   learnTitles(ui.records);
   aux.household=await read(TOOLS.household,{});aux.today=aux.household?.today||lastToday;
  }else{
   const needMembers=!memberNames.size&&view!=='household'&&has(TOOLS.household);
   const [extra,household]=await Promise.all([view==='shopping'?read(TOOLS.shopping,{}):null,needMembers?read(TOOLS.household,{}):null,
    view==='household'?ensureIngredientNames(ui.records.map(m=>m.constraints)):null]);
   if(household)learnMembers(household.members);
   aux.today=household?.today||lastToday;
   if(view==='shopping'){aux.household={members:ui.records};aux.shopping=extra;}
   else if(view==='pantry')aux.pantry={items:ui.records};
   else if(view==='household')aux.household={members:ui.records,household:null};
   else if(view==='activity')aux.notifications={notifications:ui.records};
  }
  if(aux.household?.members)learnMembers(aux.household.members);
  if(aux.today)lastToday=aux.today;
  loadedFor=ui.section;
  return aux;
 },
 sections:ui=>{
  // Moving to another view reads that view's data; the page shows "Loading" until it arrives.
  if(loadedFor&&!ready(ui)&&!switching){switching=true;setTimeout(()=>ui.refresh().catch(ui.error).finally(()=>{switching=false;}),0);}
  const inRecipes=group(ui.section)==='recipes'&&ready(ui);
  return [
   has(TOOLS.plan)&&{id:'week',label:'Meal plan',symbol:'▦',filter:none,count:false},
   {id:'recipes',label:'Recipes',symbol:'❦',filter:r=>recipeLike(r)&&r.state==='active',count:inRecipes?undefined:false},
   has(TOOLS.shopping)&&{id:'shopping',label:'Shopping list',symbol:'☑',filter:none,count:false},
   has(TOOLS.pantry)&&{id:'pantry',label:'Pantry',symbol:'▥',filter:none,count:false},
   has(TOOLS.household)&&{id:'household',label:'Household',symbol:'☺',filter:none,count:false},
   has(TOOLS.notifications)&&{id:'activity',label:'Activity',symbol:'◷',filter:none,count:false},
   {id:'archived',label:'Archived recipes',symbol:'▣',filter:r=>recipeLike(r)&&r.state==='archived',count:inRecipes?undefined:false}].filter(Boolean);
 },
 sort:(a,b)=>a.title.localeCompare(b.title),
 renderList:(shown,ui)=>{
  document.body.dataset.pwView=ui.section;
  if(!ready(ui))return el('div',{class:'empty'},el('h3',{},'Loading…'));
  return ({week:weekView,shopping:shoppingView,pantry:pantryView,household:householdView,activity:activityView}[ui.section]||recipeList)(shown,ui);
 },
 // A recipe read that finishes after the person moved to another view does not replace that view.
 view:(r,ui)=>['recipes','archived'].includes(ui.section)?recipeView(r,ui):detailFor(ui),
 emptyView:ui=>detailFor(ui)
};
for(const [key,pick] of Object.entries({list:v=>v.list,listArgs:v=>v.args(),collection:v=>v.collection,queryField:v=>v.query}))
 Object.defineProperty(config,key,{get:()=>pick(VIEWS[currentView()]),enumerable:true});
function detailFor(ui){
 if(!ready(ui))return el('div',{class:'empty'},el('h3',{},'Loading…'));
 return ({week:slotDetail,shopping:lineDetail,pantry:pantryDetail,household:memberDetail}[ui.section]||(()=>el('div',{class:'empty'},el('h3',{},ui.section==='activity'?'Activity':'No recipe selected'),el('p',{},ui.section==='activity'?'Changes other household members made: plans, guests, pantry, list and profiles.':'Choose a recipe from the box.'))))(ui);
}
mount(config);
