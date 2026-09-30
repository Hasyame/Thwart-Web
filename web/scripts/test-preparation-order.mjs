import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { expandTemplate } from '../src/lib/campaign/engine';
import { EMPTY_STATE } from '../src/lib/campaign/types';
import { aoaPlayerDeckStep, aoaScenarioStep, aoaRepeatedStep } from '../src/lib/campaign/preparation';
import { campaignSetupSteps, villainSetupSteps } from '../src/lib/schemeSetup';
import { fneGuide, FNE_JOB_SETS } from '../src/lib/campaign/fneGuide';
import { redSkullGuide, RED_SKULL_SCENARIOS } from '../src/lib/campaign/redSkullGuide';
import { civilGuide, CIVIL_WAR } from '../src/lib/civilWar';
const load=p=>JSON.parse(readFileSync(p,'utf8'));
const aoa=expandTemplate(load('src/lib/campaign/templates/aoa.json'));
for(const scenario of aoa.scenarios){
 const steps=scenario.campaignSetup??[];
 const rewards=steps.filter(aoaPlayerDeckStep);
 assert(rewards.every(s=>!s.draw&&!s.action),'deck inventory must not redraw or heal');
 assert(!rewards.some(s=>s.when?.drawIs),'new mission effects keep their prescribed campaign timing');
 const horsemen=steps.filter(s=>aoaScenarioStep(s,scenario.id));
 if(scenario.id==='s2_four_horsemen')assert(horsemen.some(s=>s.draw?.id==='horsemen'));
 assert(steps.some(aoaRepeatedStep),'settings instruction is replaced by actual controls');
 assert(rewards.some(s=>s.showCardList==='rewardUpgrade'));
}
for(const locale of ['fr','en'])for(const n of [1,2,3,4])for(const expert of [false,true]){
 const state={...EMPTY_STATE,difficulty:expert?'expert':'standard',heroes:Array.from({length:n},(_,i)=>({id:String(i),name:'Hero',heroCardCode:'01001a'})),cardLists:{imprisoned:['04097'],tech:['04073']}};
 const cards=new Map(load(`public/data/cards/${locale}/aoa.json`).map(c=>[c.code,c]));
 const before=JSON.stringify([...cards.values()]);
 assert(villainSetupSteps(cards.get('45118'),locale).some(s=>s.includes('I :')),'Dark Beast initial reveal is explicit');
 assert(villainSetupSteps(cards.get('45059'),locale).length>0,'Unus Toughness is applied');
 const scheme=campaignSetupSteps(cards,['45085a'],n,locale);
 assert(scheme.some(s=>s.includes('1B')&&s.includes(String(12*n))));
 assert.equal(JSON.stringify([...cards.values()]),before);
 assert.deepEqual(campaignSetupSteps(cards,['45085b'],n,locale),scheme,'B references still resolve A setup');
 const final=campaignSetupSteps(cards,['45147a','45148a'],n,locale);
 assert(!final.some(s=>s.includes('2B')),'future scheme must not be prepared now');
 for(const id of Object.keys(FNE_JOB_SETS)){
  const guide=fneGuide(locale,state,id),position=id=>guide.findIndex(s=>s.id===id);
  assert(position('scheme')<position('reveal'));
  assert(position('reveal')<position('decks'),'FNE booklet puts player deck changes after scenario setup');
  assert(position('decks')<position('hand'));
  assert(position('hand')<position('health'));
  assert(!guide.find(s=>s.id==='hand').lines[0].includes('then shuffle'));
 }
 for(const id of Object.keys(RED_SKULL_SCENARIOS)){
  const guide=redSkullGuide(locale,state,id),position=id=>guide.findIndex(s=>s.id===id);
  assert(position('reserve')<position('scheme'));
  assert(position('scheme')<position('reveal'));
  assert(position('reveal')<position('campaign'));
  assert(position('health')<position('hand'),'possible obligation must enter before opening hand');
  assert(guide[0].lines.join(' ').includes('04073'),'known reward is visible at deck preparation');
 }
 for(const id of Object.keys(CIVIL_WAR))for(const competitive of [false,true]){
  const guide=civilGuide(locale,id,n,expert,competitive);
  assert.equal(guide.length,competitive?11:8);
  assert(guide[2].title===(locale==='fr'?'Les stades du leader':'Leader stages'));
  assert(guide[3].title===(locale==='fr'?'Le deck Rencontre':'Encounter deck'));
  assert(guide[4].title===(locale==='fr'?'La manigance principale':'Main scheme'));
  assert(guide[5].title===(locale==='fr'?'Mise en place et révélation du leader':'Leader setup and reveal'));
 }
}


for (const leader of Object.keys(CIVIL_WAR)) for (const competitive of [true,false]) {
 const hand=civilGuide('en',leader,2,false,competitive).find(step=>step.title==='Opening hand');
 assert(hand.lines[0].includes('without shuffling those discards'),'Civil War uses current mulligan');
}
console.log('Preparation order: AoA, FNE, Red Skull and Civil War; both languages/difficulties, 1–4 players PASS');
