import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CIVIL_WAR,civilCards,civilGuide,civilModules} from '../src/lib/civilWar';
import {civilBalanced,civilResult,validCivilSave} from '../src/lib/civilWarBattle';
import {setupFor,startOf,versusSetup,villainHealth,villainAdvanced,isFinalVillainStage,schemeLimit,phaseThreatFor,schemeAdvanced} from '../src/lib/encounter';
const load=locale=>JSON.parse(readFileSync(`public/data/cards/${locale}/cw.json`,'utf8'));
for(const locale of ['fr','en']) {
 const cards=load(locale),before=JSON.stringify(cards);
 for(const [id,spec] of Object.entries(CIVIL_WAR)) for(const n of [1,2,3,4]) for(const expert of [false,true]) {
  const setup=setupFor(civilCards(cards,id),n,expert),g=startOf(setup);
  assert.deepEqual(setup.villain.map(c=>c.stage),expert?['III','IV']:['I','II']);
  assert.equal(g.progress.threat,n>1?n*2:0);assert.equal(schemeLimit(g),7*n);assert.equal(phaseThreatFor(g),n);
  const hp={iron_man_leader:[12,16],captain_marvel_leader:[14,18],captain_america_leader:[14,18],spider_woman_leader:[13,17]}[id][expert?1:0];
  assert.equal(villainHealth(g),hp*n);assert.equal(isFinalVillainStage(g),false);assert.equal(isFinalVillainStage(villainAdvanced(g)),true);
  assert.equal(schemeAdvanced(g).progress.threat,0);
  for(const competitive of [false,true]) {
   const guide=civilGuide(locale,id,n,expert,competitive);
   assert.equal(guide.length,competitive?11:8);
   for(const step of guide){assert.ok(step.lines.length);for(const ref of step.cards)assert.ok(cards.some(c=>c.code===ref),ref);}
   assert.ok(guide[2].lines[0].includes(expert?'III':'I'));
   if(competitive&&n<=2)assert.deepEqual(versusSetup(cards.filter(c=>c.card_set_code===id),cards.filter(c=>spec.schemes.includes(c.code)),n,expert),setup);
  }
  assert.equal(spec.modules.length,4);assert.ok(spec.modules.every(x=>civilModules(spec.side).includes(x)));
 }
 assert.equal(JSON.stringify(cards),before);
}
assert.equal(civilResult('none','none'),null);assert.equal(civilResult('win','win'),'tie');assert.equal(civilResult('loss','loss'),'both-lose');
for(const [a,b,w] of [['win','none','registration'],['none','win','resistance'],['loss','none','resistance'],['none','loss','registration'],['win','loss','registration'],['loss','win','resistance']])assert.equal(civilResult(a,b),w);
assert.deepEqual([0,1,2,3].map(civilBalanced),[false,true,false,true]);
const cards=load('en');
const board=id=>({leader:id,schemes:[...CIVIL_WAR[id].schemes],modules:[...CIVIL_WAR[id].modules],heroes:['tigra','hulkling'],game:startOf(setupFor(civilCards(cards,id),2,true)),choosing:8,reward:false,first:1,status:'none',phaseThreatAdded:false});
const save={version:1,players:2,expert:true,phase:'playing',turn:2,round:4,boards:{registration:board('captain_america_leader'),resistance:board('iron_man_leader')}};
assert.ok(validCivilSave(JSON.parse(JSON.stringify(save))));
for(const bad of [null,{}, {...save,players:3},{...save,turn:4},{...save,boards:{...save.boards,registration:{...save.boards.registration,leader:'iron_man_leader'}}},{...save,boards:{...save.boards,registration:{...save.boards.registration,game:{}}}}])assert.equal(validCivilSave(bad),false);
console.log('Civil War: four leaders, both modes/languages/difficulties, scaling, balanced outcomes and save validation pass.');
