<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import type { Locale, IndexRow } from '../lib/types';
  import type { CampaignState } from '../lib/campaign/types';
  import { fneGuide, fneGuideSets } from '../lib/campaign/fneGuide';
  import { parseCampaignText, type TextContext } from '../lib/campaign/text';
  import CampaignText from './CampaignText.svelte';
  import CardRef from './CardRef.svelte';

  interface Props {
    t: Strings; uiLocale: Locale; guideKey: string; campaign: CampaignState; scenarioId: string;
    text: TextContext; index: readonly IndexRow[]; setName: (code:string)=>string; onReady:()=>void;
  }
  const {t,uiLocale,guideKey,campaign,scenarioId,text,index,setName,onReady}:Props=$props();
  const steps=$derived(fneGuide(uiLocale,campaign,scenarioId));
  const sets=$derived(fneGuideSets(campaign,scenarioId));
  const key=$derived(`${guideKey}.fne-v1`);
  let position=$state(0);
  let heading=$state.raw<HTMLHeadingElement|null>(null);
  const shown=$derived(steps[position]!);
  $effect(()=>{const storageKey=key;try{const saved=Number(localStorage.getItem(storageKey));position=Number.isInteger(saved)&&saved>=0&&saved<steps.length?saved:0;}catch{position=0;}});
  function move(n:number):void{position=n;try{localStorage.setItem(key,String(n));}catch{/* Navigation remains available without storage. */}heading?.focus();}
  const removed=$derived([...new Set([...(campaign.cardLists.alliesRetires??[]),...Object.values(campaign.heroCardLists.alliesRetires??{}).flat()])]);
</script>

<div class="skip"><button class="btn btn--primary" onclick={onReady}>{t.campaignSkipPreparation}</button></div>
<nav aria-label={t.campaignGuideTitle}>
  <label class="field-group"><span>{position+1} / {steps.length}</span><select class="field" value={position} onchange={event=>move(Number(event.currentTarget.value))}>{#each steps as step,i}<option value={i}>{i+1}. {step.title}</option>{/each}</select></label>
  <progress max={steps.length} value={position+1} aria-label={t.campaignGuideTitle}></progress>
  {#if position<steps.length-1}<button class="btn btn--primary" onclick={()=>move(position+1)}>{t.campaignGuideNext}</button>{/if}
</nav>
<section>
  <h3 bind:this={heading} tabindex="-1">{shown.title}</h3>
  <ol>{#each shown.lines as line}<li><CampaignText segments={parseCampaignText(line,text)}/></li>{/each}</ol>
  {#if shown.id==='deck'}
    {#each sets as set}<details><summary>{setName(set)}</summary><div class="cards">{#each index.filter(card=>card.setCode===set&&!['villain','main_scheme'].includes(card.typeCode)&&!card.code.endsWith('b')) as card (card.code)}<CardRef code={card.code} name={card.name}/>{/each}</div></details>{/each}
  {/if}
  {#if shown.id==='heroes' || shown.id==='decks'}
    <div class="record"><strong>{uiLocale==='fr'?(shown.id==='heroes'?'À prévoir : cartes exclues de la campagne':'Retirez ces cartes avant le mélange'):(shown.id==='heroes'?'Plan ahead: cards excluded from the campaign':'Remove these cards before shuffling')}</strong><div class="cards">{#each removed as code}<CardRef {code} name={text.cardName(code)}/>{:else}<p>{t.campaignNothingRecorded}</p>{/each}</div></div>
  {/if}
  {#if shown.id==='health'&&campaign.difficulty==='expert'&&campaign.completedScenarios.length>0}
    <ul>{#each campaign.heroes as hero}<li>{hero.name} : {campaign.heroCounters.hp?.[hero.id]??(uiLocale==='fr'?'PV de départ':'starting HP')}</li>{/each}</ul>
  {/if}
  <p class="source">{shown.source}</p>
</section>
<div class="actions"><button class="btn" disabled={position===0} onclick={()=>move(position-1)}>{t.campaignGuidePrevious}</button>{#if position<steps.length-1}<button class="btn btn--primary" onclick={()=>move(position+1)}>{t.campaignGuideNext}</button>{:else}<button class="btn btn--primary" onclick={onReady}>{t.campaignImReady}</button>{/if}</div>

<style>
  p{margin-block:var(--space-4);line-height:var(--leading-body);max-width:var(--prose-max)}

  .skip{position:sticky;top:calc(56px + env(safe-area-inset-top) + var(--space-2));z-index:5;padding:var(--space-2);background:var(--surface-1);border:1px solid var(--border);margin-bottom:var(--space-4)}
  .skip button{width:100%;min-height:48px;white-space:normal}
  nav{padding:var(--space-3);border-left:4px solid var(--accent);margin-block:var(--space-4)}
  progress{width:100%;accent-color:var(--accent);margin-block:var(--space-2)}
  h3{font-size:var(--text-xl);font-weight:900;font-style:italic;margin-block:var(--space-5) var(--space-3)}
  li{margin-bottom:var(--space-5);line-height:var(--leading-body)}
  ol{padding-inline-start:var(--space-5)}
  .cards{display:flex;flex-wrap:wrap;gap:var(--space-3);padding:var(--space-3)}
  details{padding:var(--space-3);border-bottom:1px solid var(--border)}
  summary{cursor:pointer;min-height:44px;align-content:center}
  .record{padding:var(--space-3);background:var(--surface-1);border:1px solid var(--border)}
  .source{font-size:var(--text-xs);color:var(--text-muted)}
  .actions{display:flex;justify-content:space-between;gap:var(--space-3);margin-block:var(--space-5)}
  .actions button,nav button{min-height:48px;white-space:normal}
</style>
