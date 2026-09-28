import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EMPTY_STATE } from '../src/lib/campaign/types.ts';
import { fneGuide, fneGuideSets, FNE_JOB_SETS } from '../src/lib/campaign/fneGuide.ts';
import { fneCardAliases } from '../src/lib/fneCards.ts';
import { trackerSetupFor } from '../src/lib/campaign/encounter.ts';
import { startOf, phaseThreatFor } from '../src/lib/encounter.ts';
import { parseEncounterProgress, recoveredEncounter } from '../src/lib/encounterProgress.ts';
const index=JSON.parse(readFileSync(new URL('../public/data/index.en.json',import.meta.url),'utf8'));
const codes=new Set(index.map(c=>c.code));
const template=JSON.parse(readFileSync(new URL('../public/data/campaigns/fne.json',import.meta.url),'utf8'));
const villains=['hammerhead','bullseye','electro','homme_pourpre','mary_typhoide'];
const make=(n,expert,id,villain='electro')=>({...EMPTY_STATE,templateId:'fne',difficulty:expert?'expert':'standard',heroes:Array.from({length:n},(_,i)=>({id:String(i),name:'Hero',heroCardCode:'01001'})),draws:{[id]:{villain:[`fne_villain_${villain}`],maryFace:[expert?'fne_face_bloody_b':'fne_face_mary_a']}}});
const lines=(state,id,step)=>fneGuide('en',state,id).find(s=>s.id===step).lines.join(' ');
for(const locale of ['fr','en'])for(const n of [1,2,3,4])for(const expert of [false,true])for(const id of Object.keys(FNE_JOB_SETS))for(const villain of villains){
 const state=make(n,expert,id,villain), before=JSON.stringify(state), steps=fneGuide(locale,state,id);
 assert.equal(steps.length,11);assert.equal(new Set(steps.map(s=>s.id)).size,11);
 assert(steps.every(s=>s.title&&s.lines.length&&s.source));
 for(const code of steps.flatMap(s=>s.lines).join(' ').matchAll(/\{card:([^}]+)\}/g))assert(codes.has(code[1]),`Unknown ${code[1]}`);
 assert.deepEqual(fneGuide(locale,state,id),steps);assert.equal(JSON.stringify(state),before,'guide cannot reroll or mutate a campaign');
 const sets=fneGuideSets(state,id);assert.equal(sets.includes('standard'),id!=='s6_caid');assert.equal(sets.includes('expert'),expert);
 assert(steps.findIndex(s=>s.id==='decks')<steps.findIndex(s=>s.id==='hand'));
 assert(steps.findIndex(s=>s.id==='hand')<steps.findIndex(s=>s.id==='health'));
}
for(const n of [1,2,3,4])for(const expert of [false,true]){
 const state={...make(n,expert,'s1_musee'),counters:{pressionMusee:2,pressionRacket:2,pressionPoursuite:2,pressionRotatives:2,pressionRaft:2}};
 assert(lines(state,'s1_musee','pressure').includes(`Add ${2*n*(expert?2:1)} threat`));
 assert(lines(state,'s3_racket','pressure').includes(`Add ${2*(expert?2:1)} threat to EACH`));
 assert(lines(state,'s2_poursuite','pressure').includes(`Add ${n*(expert?2:1)} threat`));
 assert(lines(state,'s5_rotatives','pressure').includes('1 remain'));
 assert(lines(state,'s4_raft','pressure').includes('facedown boost'));
 const mary=make(n,expert,'s1_musee','mary_typhoide');assert(lines(mary,'s1_musee','reveal').includes(`${n*(expert?11:8)} threat`));
}
const allJobs=Object.keys(FNE_JOB_SETS).filter(id=>id!=='s6_caid');
const won={...make(2,true,'s6_caid'),flags:{acheve:Object.fromEntries(allJobs.map(id=>[id,true])),confianceGagnee:{'':true}}};
assert(lines(won,'s6_caid','pressure').includes('60165'));
assert(lines(won,'s6_caid','environments').includes('60210a'));
assert(!lines({...won,flags:{...won.flags,maryVaincue:{'':true}}},'s6_caid','environments').includes('60210a'));
const lost={...make(2,true,'s6_caid'),flags:{echoue:Object.fromEntries(allJobs.map(id=>[id,true]))}};
for(let n=205;n<=209;n++)assert(lines(lost,'s6_caid','environments').includes(`60${n}b`));
const aliases=fneCardAliases(index);for(const [alias,code]of [['fne_face_mary_a','60110a'],['fne_face_bloody_b','60111b']])assert.equal(aliases.get(alias),code);
console.log('Fear No Evil guide: six scenarios, five villains, 1–4 players, both languages and difficulties PASS');
for(const n of [1,2,3,4])for(const expert of [false,true]){
 const id='s1_musee', state={...make(n,expert,id,'bullseye'),counters:{pressionMusee:2}};
 const setup=trackerSetupFor(template,state,template.scenarios.find(s=>s.id===id),n);
 assert.equal(setup.scheme[0].options[0].extraStartingThreat,2*n*(expert?2:1));
 assert.equal(setup.villain[0].code,expert?'60066':'60065');
 assert.equal(setup.villain[0].value,expert?16:14);
 let game=startOf(setup);assert.equal(phaseThreatFor(game),2*n);
 for(const artAttachments of [0,1,2,3,4]){game={...game,progress:{...game.progress,artAttachments}};assert.equal(phaseThreatFor(game),(artAttachments+1)*n);}
 const restored=recoveredEncounter(setup,parseEncounterProgress(JSON.stringify(game.progress)));
 assert.equal(restored.progress.artAttachments,4);
 const mary=trackerSetupFor(template,make(n,expert,id,'mary_typhoide'),template.scenarios.find(s=>s.id===id),n);
 assert.equal(mary.villain.length,1,'Mary has forms, not sequential difficulty stages');
 assert.equal(mary.scheme.length,1,'Mary retains the chosen job’s main scheme');
 assert.equal(mary.villain[0].value,expert?13:10);
 assert.equal(mary.villain[0].code,expert?'60111b':'60110a');
 assert.equal(mary.villainForms[0].length,2);
 const kingpin=trackerSetupFor(template,make(n,expert,'s6_caid'),template.scenarios.find(s=>s.id==='s6_caid'),n);
 assert.equal(kingpin.schemeCompletionIsLoss,true,'Kingpin scheme threshold is a loss, not phase advancement');
}
for(const value of [-1,5,'2',1.5])assert.equal(parseEncounterProgress(JSON.stringify({artAttachments:value})),null);
