import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EMPTY_STATE } from '../src/lib/campaign/types.ts';
import { redSkullGuide, redSkullStartingThreat, RED_SKULL_SCENARIOS } from '../src/lib/campaign/redSkullGuide.ts';
import { upgradeTemplate } from '../src/lib/campaign/templateUpgrade.ts';
import { encounterSetsOf } from '../src/lib/campaign/encounter.ts';
import { fold } from '../src/lib/campaign/engine.ts';
const load=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const original=load('../public/data/campaigns/trors.json');
const index=load('../public/data/index.en.json'),codes=new Set(index.map(c=>c.code));
const template=upgradeTemplate(original);
const make=(n,campaignExpert,scenarioExpert,id)=>({...EMPTY_STATE,templateId:'trors',difficulty:campaignExpert?'expert':'standard',currentScenarioId:id,heroes:Array.from({length:n},(_,i)=>({id:String(i),name:`Hero ${i}`,heroCardCode:'01001'})),flags:{scenarioExpert:{[id]:scenarioExpert}},counters:{delay:3},cardLists:{experimental:['04072'],imprisoned:['04097']}});
for(const locale of ['fr','en'])for(const n of [1,2,3,4])for(const campaignExpert of [false,true])for(const scenarioExpert of [false,true])for(const id of Object.keys(RED_SKULL_SCENARIOS)){
 const state=make(n,campaignExpert,scenarioExpert,id), before=JSON.stringify(state);
 const steps=redSkullGuide(locale,state,id);
 assert.equal(steps.length,10); assert.equal(new Set(steps.map(s=>s.id)).size,10);
 assert(steps.every(s=>s.lines.length&&s.title&&s.source));
 assert(steps.find(s=>s.id==='villain').lines[0].includes(scenarioExpert?'II':'I'));
 assert(steps.find(s=>s.id==='reveal').lines[0].includes(scenarioExpert?'II':'I'));
 for(const code of steps.flatMap(s=>s.lines).join(' ').matchAll(/\{card:([^}]+)\}/g))assert(codes.has(code[1]),`Unknown card ${code[1]}`);
 assert.equal(JSON.stringify(state),before);assert.deepEqual(redSkullGuide(locale,state,id),steps);
 assert.equal(redSkullStartingThreat(state,id),id==='s5_red_skull'?3*(campaignExpert?n:1):0);
 const sets=encounterSetsOf(template.scenarios.find(s=>s.id===id),state);
 for(const set of sets)assert(index.some(card=>card.setCode===set),`Unknown set ${set}`);
 assert.equal(sets.includes('expert'),scenarioExpert);
 if(id==='s1_crossbones'){assert(sets.includes('legions_of_hydra'));assert(!sets.includes('hydra_patrol'));}
 if(id==='s4_zola'){assert(sets.includes('under_attack'));assert(!sets.includes('hydra_assault'));}
}
assert.deepEqual(upgradeTemplate(template),template,'upgrade is idempotent');
assert.equal(original.scenarios[0].baseSetup.encounterSets.includes('hydra_patrol'),true,'stored snapshot remains unchanged');
const customized=structuredClone(original);customized.scenarios[0].baseSetup.encounterSets=['crossbones','bomb_scare','standard'];
assert.deepEqual(upgradeTemplate(customized).scenarios[0].baseSetup.encounterSets,customized.scenarios[0].baseSetup.encounterSets);
const lines=(id,step,expert=false)=>redSkullGuide('en',make(2,expert,expert,id),id).find(s=>s.id===step).lines.join(' ');
assert(lines('s4_zola','reserve').includes('2 threat plus the combined costs'));
assert(lines('s3_taskmaster','reserve').includes('4 threat'));
assert(lines('s5_red_skull','reserve').includes('6 threat'));
assert(lines('s1_crossbones','reveal',true).includes('4 ammo'));
assert(!lines('s1_crossbones','reveal').includes('04064'));
assert(lines('s5_red_skull','campaign',true).includes('Add 6 threat'));
assert(lines('s5_red_skull','campaign').includes('Add 3 threat'));
for(const expert of [false,true]){
 const events=[{id:'start',type:'setup',timestamp:1,difficulty:expert?'expert':'standard',heroes:[{id:'h',name:'Hero',heroCardCode:'01001'}]},{id:'loss',type:'scenario_result',timestamp:2,scenarioId:'s5_red_skull',victory:false,answers:{},elapsedMillis:0}];
 assert.equal(fold(template,events).campaignLost,expert,'Expert finale defeat loses the campaign; Standard can retry');
}
console.log('Red Skull: five guides, 1–4 players, both languages, independent difficulties, records and template corrections PASS');
