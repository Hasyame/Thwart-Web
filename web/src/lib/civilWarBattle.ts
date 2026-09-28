import {CIVIL_WAR,civilModules,isCivilLeader} from './civilWar';
import {parseEncounterProgress} from './encounterProgress';

export type BattleReport='none'|'win'|'loss';
export function civilResult(registration:BattleReport,resistance:BattleReport):'registration'|'resistance'|'tie'|'both-lose'|null {
  if(registration==='none'&&resistance==='none')return null;
  if(registration===resistance)return registration==='win'?'tie':'both-lose';
  return registration==='win'||resistance==='loss'?'registration':'resistance';
}
/** End of Resistance's matching phase, not end of the entire round. */
export const civilBalanced=(phase:number):boolean=>phase===1||phase===3;
const obj=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const int=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
/** Reject damaged saves before they can replace either current board. */
export function validCivilSave(value:unknown):boolean {
  if(!obj(value)||value.version!==1||![1,2].includes(Number(value.players))||typeof value.expert!=='boolean'||!['setup','guide','playing','result'].includes(String(value.phase))||!int(value.turn)||value.turn>3||!int(value.round)||value.round<1||!obj(value.boards))return false;
  return ['registration','resistance'].every(side=>{
    const b=(value.boards as Record<string,unknown>)[side],camp=side==='registration'?'resistance':'registration';
    if(!obj(b)||typeof b.leader!=='string'||!isCivilLeader(b.leader)||CIVIL_WAR[b.leader].side!==camp||!Array.isArray(b.heroes)||b.heroes.length!==2||!b.heroes.every(x=>typeof x==='string')||!Array.isArray(b.modules)||!b.modules.every(x=>typeof x==='string'&&civilModules(camp).includes(x))||!Array.isArray(b.schemes)||b.schemes.length!==2||!b.schemes.every(x=>typeof x==='string')||!int(b.choosing)||typeof b.reward!=='boolean'||![1,2].includes(Number(b.first))||!['none','win','loss'].includes(String(b.status))||typeof b.phaseThreatAdded!=='boolean')return false;
    if(value.phase==='setup'||value.phase==='guide')return b.game===null;
    if(!obj(b.game)||!obj(b.game.setup)||!obj(b.game.progress))return false;
    const setup=b.game.setup,p=b.game.progress;
    return setup.players===value.players&&Array.isArray(setup.villain)&&setup.villain.length===2&&setup.villain.every(c=>obj(c)&&typeof c.name==='string'&&typeof c.code==='string'&&typeof c.value==='number')&&Array.isArray(setup.scheme)&&setup.scheme.length===2&&setup.scheme.every(s=>obj(s)&&Array.isArray(s.options)&&s.options.length===1&&obj(s.options[0])&&typeof s.options[0].code==='string')&&parseEncounterProgress(JSON.stringify(p))!==null&&int(p.villainIndex)&&p.villainIndex<2&&int(p.schemeIndex)&&p.schemeIndex<2&&p.schemeOption===0&&int(p.damage)&&int(p.threat);
  });
}
