import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {expandTemplate} from '../src/lib/campaign/engine';
import {EMPTY_STATE} from '../src/lib/campaign/types';
import {remainingRules, REMAINING_CAMPAIGNS} from '../src/lib/campaign/remainingRules';
import {preparationPhase, inventoryPreview, preparationSource} from '../src/lib/campaign/remainingPreparation';
import {campaignScenarioSetupSteps,cardPreparationDetails} from '../src/lib/schemeSetup';
const load=p=>JSON.parse(readFileSync(p,'utf8'));
const templates=Object.fromEntries(REMAINING_CAMPAIGNS.map(id=>[id,expandTemplate(load(`public/data/campaigns/${id}.json`))]));
const packs={gmw:'gmw',mts:'mts',sm:'sm',mg:'mut_gen',next:'next_evol',aos:'aos'};
let scenarios=0;
for(const [id,template] of Object.entries(templates)){
 const original=JSON.stringify(template), corrected=remainingRules(template);
 assert.equal(JSON.stringify(template),original,'read-time audit must not mutate the stored snapshot');
 assert.deepEqual(remainingRules(corrected),corrected,`${id}: corrections are idempotent`);
 for(const scenario of corrected.scenarios){
  scenarios++;
  assert(preparationSource(id,scenario.id).includes('p.'));
  for(const n of [1,2,3,4])for(const difficulty of ['standard','expert'])for(const scenarioExpert of [false,true])for(const locale of ['fr','en']){
   const state={...EMPTY_STATE,difficulty,heroes:Array.from({length:n},(_,i)=>({id:String(i),name:'Hero'})),flags:{scenarioExpert:{[scenario.id]:scenarioExpert}}};
   const preview=inventoryPreview(id,scenario.id,state,scenario.campaignSetup);
   assert(preview.every(s=>!s.action&&!s.draw),'preview cannot repeat a random choice or apply an action');
   const cards=new Map(load(`public/data/cards/${locale}/${packs[id]}.json`).map(c=>[c.code,c]));
   const steps=campaignScenarioSetupSteps(cards,scenario.baseSetup.mainScheme,scenario.baseSetup.villainDeck[scenarioExpert?'expert':'standard'],scenario.id,n,locale);
   assert(steps.length>0,`${id}/${scenario.id} ${locale}: no silent empty setup`);
   assert(!steps.some(s=>/threshold X|seuil X/.test(s)),`${id}/${scenario.id}: no invented threat counter on setup-only cards`);
  }
 }
}
assert.equal(scenarios,30);
const scenario=(id,sid)=>remainingRules(templates[id]).scenarios.find(s=>s.id===sid);
const steps=(id,sid)=>scenario(id,sid).campaignSetup;
const gmw=steps('gmw','s1_badoon');
assert(!gmw.some(s=>s.cards?.includes('16142')),'Milano only installed by main scheme');
assert(gmw.some(s=>s.cards?.includes('16178b')));
const collection=steps('gmw','s2_museum').find(s=>s.text?.en.startsWith('When setup ends'));
assert.equal(preparationPhase('gmw','s2_museum',collection),'finished');
assert.equal(steps('gmw','s5_ronan').find(s=>s.cards?.includes('16112')).compute,undefined,'zero extra threat never hides mandatory Pincer reveal');
const tower=steps('mts','s2_tower_defense');
assert(!tower.some(s=>s.cards?.includes('21102')),'minions from 2A are not installed twice');
const thanos=steps('mts','s3_thanos');
assert(thanos.findIndex(s=>s.text?.en.startsWith('Deal 3 damage'))>thanos.findIndex(s=>s.action?.id==='heal'),'damage must survive the optional heal');
for(const s of remainingRules(templates.sm).scenarios){
 assert(s.campaignSetup.some(s=>s.cards?.includes('27174b')&&s.when?.scenarioDifficulty==='expert'));
 const mulligan=s.campaignSetup.find(s=>s.text?.en.startsWith('During the mulligan'));
 if(mulligan)assert.equal(preparationPhase('sm',s.id,mulligan),'mulligan');
 const enhanced=s.campaignSetup.findIndex(s=>s.text?.en.startsWith('Setup: each player flips'));
 const threat=s.campaignSetup.findIndex(s=>s.text?.en==='Setup: place 1 threat per player on the main scheme.');
 if(enhanced>=0)assert(enhanced<threat,'left reputation column precedes right');
}
assert(steps('next','s3_juggernaut').some(s=>s.text?.en.includes('one Creeping Willow per player')));
assert(steps('next','s4_mister_sinister').some(s=>s.text?.en.includes('one threat per player for each campaign environment')));
assert(steps('aos','s3_modok').some(s=>s.text?.en.includes('three lock counters per player')));
assert(!steps('aos','s4_thunderbolts').some(s=>s.text?.en.startsWith('Add 2 modular')));
for(const s of remainingRules(templates.aos).scenarios){
 const evidence=s.campaignSetup.find(s=>s.text?.en.startsWith('After mulligans,'));
 if(evidence)assert.equal(preparationPhase('aos',s.id,evidence),'afterMulligan');
}
for(const locale of ['fr','en']){
 const mg=new Map(load(`public/data/cards/${locale}/mut_gen.json`).map(c=>[c.code,c]));
 const mansion=campaignScenarioSetupSteps(mg,['32125a'],['32121a','32122a','32123a','32124a'],'s4_mansion',2,locale,{brotherhoodOrder:['32121a','32122a','32123a','32124a']});
 assert.equal(mansion.filter(s=>/2B/.test(s)).length,1,'advance through 1B once with the next stage numbers');
 assert(mansion.some(s=>s.includes('14')),'Mansion location threshold');
 const aos=new Map(load(`public/data/cards/${locale}/aos.json`).map(c=>[c.code,c]));
 for(const n of [1,2,3,4]){
  const modok=campaignScenarioSetupSteps(aos,['50104a'],['50103a'],'s3_modok',n,locale).join(' ');
  assert(modok.includes(`${2*n} ${locale==='fr'?'jetons Verrou':'lock counters'}`),'Holding Cell locks are supplied without opening the booklet');
  assert(!modok.includes('13)'),'booklet cross-reference must be replaced in full');
 }
 const cards=new Map(load(`public/data/cards/${locale}/gmw.json`).map(c=>[c.code,c]));
 for(const n of [1,2,3,4]){
  assert(cardPreparationDetails(cards.get('16178a'),true,n,locale)[0].includes(String(2+3*n)),'revealed Hinder scales per player');
  assert(cardPreparationDetails(cards.get('16178a'),false,n,locale)[0].includes('2'),'put into play does not trigger Hinder');
 }
 const next=new Map(load(`public/data/cards/${locale}/next_evol.json`).map(c=>[c.code,c]));
 const setup=campaignScenarioSetupSteps(next,['40139a'],['40137','40138'],'s4_mister_sinister',2,locale,{experiments:['40140a','40142a']});
 const experiment=setup.findIndex(s=>s.includes('2B'));
 const villain=setup.findIndex(s=>s.includes('II :'));
 assert(experiment>=0&&villain>experiment,'revealed experiment resolves before Sinister II');
 assert(!setup.some(s=>s.includes('3B')),'future experiment stages remain inactive');
}
const custom={id:'custom',scenarios:[{id:'s1_badoon',campaignSetup:[{text:{en:'My custom setup'}}]}]};
assert.equal(remainingRules(custom),custom);
const customOfficial={id:'gmw',scenarios:[{id:'s1_badoon',campaignSetup:[{text:{en:'My custom setup'},cards:['custom'] }]}]};
assert.deepEqual(remainingRules(customOfficial),customOfficial);
for(const s of remainingRules(templates.aos).scenarios) for(const step of s.campaignSetup.filter(s=>s.text?.en.startsWith('A board member reaching '))) assert(step.when.scenarioDifficulty && !step.when.difficulty);
assert(steps('gmw','s2_museum').find(s=>s.action?.id==='heal').action.effects.some(e=>e.valueFrom==='heroCard.health'&&e.value===undefined));
const sameNameCards=new Map(['one','two'].map(code=>[code,{code,name:'Loki',type_code:'villain',text:`<b>When Revealed</b>: Resolve ${code}.`}]));
assert.deepEqual(campaignScenarioSetupSteps(sameNameCards,[],['one','two'],'s5_loki',1,'en',{loki:['two']}),['Loki  : Resolve two.'],'selected card wins over matching villain names');
console.log('Remaining preparation audit: 30 scenarios, 1–4 players, independent difficulties, FR/EN, ordered exceptions PASS');
