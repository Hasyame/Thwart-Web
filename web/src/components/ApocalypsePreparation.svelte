<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import type { Strings } from '../lib/i18n';
  import type { Locale, IndexRow } from '../lib/types';
  import type { CampaignState } from '../lib/campaign/types';
  import { counterOf } from '../lib/campaign/types';
  import { apocalypseGuide, APOCALYPSE_PRELATES, APOCALYPSE_PRELATE_DRAW } from '../lib/campaign/apocalypseGuide';
  import { parseCampaignText, type TextContext } from '../lib/campaign/text';
  import CampaignText from './CampaignText.svelte';
  import CardRef from './CardRef.svelte';

  interface Props {
    t: Strings; uiLocale: Locale; guideKey: string; campaign: CampaignState;
    expert: boolean; scenarioExpert: boolean; text: TextContext;
    index: readonly IndexRow[]; encounterSets: readonly string[]; setName: (code: string) => string;
    settings: Snippet; storyContent: Snippet; campaignContent: Snippet; missionContent: Snippet;
    allyContent: Snippet; healthContent: Snippet; recoveryContent: Snippet;
    rejoinRequired: boolean; onReady: () => void; onKeep: (id: string, code: string) => void;
  }
  const {t,uiLocale,guideKey,campaign,expert,scenarioExpert,text,index,encounterSets,setName,settings,storyContent,campaignContent,missionContent,allyContent,healthContent,recoveryContent,rejoinRequired,onReady,onKeep}: Props = $props();
  const steps = $derived(apocalypseGuide(uiLocale,campaign.heroes.length,scenarioExpert,expert));
  const key = $derived(`${guideKey}.detailed-v1`);
  let position = $state(0);
  let heading = $state.raw<HTMLHeadingElement | null>(null);
  let drawing = $state(false);
  let drawError = $state(false);
  let attemptedKey = "";
  const prelate = $derived(campaign.draws.s3_apocalypse?.[APOCALYPSE_PRELATE_DRAW]?.[0] ?? '');
  const shown = $derived(steps[position]!);
  const sets = $derived(encounterSets.filter(code => code !== 'age_of_apocalypse'));
  $effect(() => { const storageKey=key; try { const n=Number(localStorage.getItem(storageKey)); position=Number.isInteger(n)&&n>=0&&n<14?n:0; } catch { position=0; } });
  function move(n: number): void { position=n; try { localStorage.setItem(key,String(n)); } catch { /* Navigation works without storage. */ } heading?.focus(); }
  $effect(() => {
    const currentKey=key;
    untrack(() => { if (attemptedKey !== currentKey && !prelate) { attemptedKey=currentKey; void drawPrelate(); } });
  });
  async function drawPrelate(): Promise<void> {
    if (drawing || prelate) return;
    drawing=true; drawError=false;
    try { await onKeep(APOCALYPSE_PRELATE_DRAW,APOCALYPSE_PRELATES[Math.floor(Math.random()*APOCALYPSE_PRELATES.length)]!); }
    catch { drawError=true; }
    finally { drawing=false; }
  }
</script>

<div class="apocalypse-preparation">
  <div class="skip-preparation">
    <button class="btn btn--primary launch-shortcut" disabled={rejoinRequired} onclick={onReady}>{t.campaignSkipPreparation}</button>
    {#if rejoinRequired}<p>{t.campaignRejoinRequired}</p>{/if}
  </div>
  <details><summary>{t.campaignGuideStory}</summary>{@render storyContent()}</details>
  <details class="settings"><summary>{t.scenarioDifficulty} · {scenarioExpert?'Expert':'Standard'}</summary>{@render settings()}</details>
  <nav class="guide-nav" aria-label={t.campaignGuideTitle}>
    <label class="field-group"><span>{position+1} / {steps.length}</span><select class="field" value={position} onchange={event=>move(Number(event.currentTarget.value))}>{#each steps as step,i}<option value={i}>{i+1}. {step.title}</option>{/each}</select></label>
    <progress max={steps.length} value={position+1} aria-label={t.campaignGuideTitle}></progress>
    {#if position < 13}<button class="btn btn--primary" onclick={()=>move(position+1)}>{t.campaignGuideNext}</button>{/if}
  </nav>
  {#if drawError}<p role="alert">{uiLocale==='fr'?'Le tirage n’a pas pu être enregistré. Réessayez à l’étape Prélat.':'The draw could not be saved. Retry at the Prelate step.'}</p>{/if}
  <section class="instructions">
    <h3 bind:this={heading} tabindex="-1">{shown.title}</h3>
    <ol>{#each shown.lines as line}<li><CampaignText segments={parseCampaignText(line,text)} /></li>{/each}</ol>
    {#if position === 2}
      {#each sets as set}
        {#if set === 'prelates'}
          <div class="saved-draw"><strong>{uiLocale==='fr'?'Premier Prélat tiré':'First Prelate drawn'}</strong>
            {#if prelate}<p><CardRef code={prelate} name={text.cardName(prelate)} /> · {5*campaign.heroes.length} {uiLocale==='fr'?'PV':'HP'} · {uiLocale==='fr'?'Tenace':'Tough'}</p>{:else}<button class="btn" disabled={drawing} onclick={()=>void drawPrelate()}>{uiLocale==='fr'?'Tirer le Prélat':'Draw the Prelate'}</button>{/if}
            <p>{uiLocale==='fr'?'Il sera révélé à l’étape 7. Gardez les quatre autres de côté pour la suite.':'Reveal it at step 7. Keep the other four aside for later.'}</p>
            <details><summary>{uiLocale==='fr'?'Autres Prélats à préparer':'Other Prelates to prepare'}</summary><div class="cards">{#each APOCALYPSE_PRELATES.filter(code=>code!==prelate) as code}<CardRef {code} name={text.cardName(code)} />{/each}</div></details>
          </div>
        {:else}
          <details class="set"><summary>{setName(set)}</summary><div class="cards">{#each index.filter(card=>card.setCode===set&&!['villain','main_scheme'].includes(card.typeCode)&&!card.code.endsWith('b')) as card (card.code)}<CardRef code={card.code} name={card.name} />{/each}</div></details>
        {/if}
      {/each}
    {/if}
    {#if position === 3 && sets.includes('standard_iii')}
      <p><CampaignText segments={parseCampaignText(uiLocale==='fr'
        ? 'Avec Standard III, mettez {card:45075a} en jeu, face A visible, sans jeton Poursuite. Cette carte permanente reste en jeu. À '+(campaign.heroes.length+3)+' jetons Poursuite, retirez-les tous : votre Némésis s’active contre vous si elle est en jeu ; sinon retournez la carte pour révéler votre sbire Némésis et votre manigance Némésis, mélangez le reste du set au deck Rencontre, puis revenez sur A.'
        : 'With Standard III, put {card:45075a} into play, A side up, with no pursuit counters. This permanent card stays in play. At '+(campaign.heroes.length+3)+' pursuit counters, remove them all: your nemesis activates against you if in play; otherwise flip to reveal your nemesis minion and side scheme, shuffle the remaining set into the encounter deck, then flip back to A.',text)} /></p>
    {/if}
    {#if position === 3 && sets.includes('standard_ii')}
      <p><CampaignText segments={parseCampaignText(uiLocale==='fr'
        ? 'Avec Standard II, mettez {card:'+(scenarioExpert?'24049b':'24049a')+'} en jeu sur la face '+(scenarioExpert?'Expert':'Standard')+'. Elle reste en jeu. '+(scenarioExpert?'Tous les ennemis sont Solides : deux états identiques sont nécessaires pour les sonner ou les désorienter.':'Le méchant est Solide, comme l’indique déjà Apocalypse. Les deux occurrences ne s’additionnent pas.')
        : 'With Standard II, put {card:'+(scenarioExpert?'24049b':'24049a')+'} into play on the '+(scenarioExpert?'Expert':'Standard')+' side. It stays in play. '+(scenarioExpert?'Every enemy is steady, requiring two matching status cards to be stunned or confused.':'The villain is steady, as Apocalypse already is. Multiple instances do not stack.'),text)} /></p>
    {/if}
    {#if position === 6}
      {#if prelate}<p class="saved-draw"><CardRef code={prelate} name={text.cardName(prelate)} /></p>{:else}<button class="btn" disabled={drawing} onclick={()=>void drawPrelate()}>{uiLocale==='fr'?'Tirer le Prélat et le mémoriser':'Draw and save the Prelate'}</button>{/if}
      <label class="field-group"><span>{uiLocale==='fr'?'Prélat déjà révélé sur votre table':'Prelate already revealed on your table'}</span><select class="field" value={prelate} disabled={drawing} onchange={event=>{if(event.currentTarget.value)onKeep(APOCALYPSE_PRELATE_DRAW,event.currentTarget.value)}}><option value="">{t.campaignChooseOne}</option>{#each APOCALYPSE_PRELATES as code}<option value={code}>{text.cardName(code)}</option>{/each}</select></label>
    {/if}
    {#if position === 8}{@render campaignContent()}{@render recoveryContent()}{/if}
    {#if position === 9}{@render missionContent()}{/if}
    {#if position === 10}{@render allyContent()}{/if}
    {#if position === 11}
      {@render healthContent()}
      <p class="total">{uiLocale==='fr'?'Total sur la mission':'Total mission threat'}: <strong>{5*campaign.heroes.length+counterOf(campaign,'missionThreat')}</strong></p>
    {/if}
    <p class="source">{shown.source}</p>
  </section>
  <div class="guide-actions"><button class="btn" disabled={position===0} onclick={()=>move(position-1)}>{t.campaignGuidePrevious}</button>{#if position<13}<button class="btn btn--primary" onclick={()=>move(position+1)}>{t.campaignGuideNext}</button>{:else}<button class="btn btn--primary launch" disabled={rejoinRequired} onclick={onReady}>{t.campaignImReady}</button>{/if}</div>
</div>

<style>
  .skip-preparation{position:sticky;top:calc(56px + env(safe-area-inset-top) + var(--space-2));z-index:5;padding:var(--space-2);background:var(--surface);border:1px solid var(--border);margin-bottom:var(--space-4)}
  .skip-preparation button{width:100%;min-height:48px;white-space:normal}
  .guide-nav{padding:var(--space-3);border-left:4px solid var(--accent);margin-block:var(--space-4)}
  progress{width:100%;accent-color:var(--accent)}
  h3{font-size:var(--text-xl);font-weight:900;font-style:italic;scroll-margin-top:6rem}
  ol{padding-left:1.4rem;line-height:var(--leading-body)}li{margin-block:var(--space-3)}
  .source{color:var(--text-muted);font-size:var(--text-sm);margin-top:var(--space-5)}
  summary{min-height:44px;display:flex;align-items:center;cursor:pointer;font-weight:600}summary::before{content:'▸';margin-right:var(--space-2)}
  details{border:1px solid var(--border);padding:var(--space-3);margin-block:var(--space-2)}
  .cards{display:flex;flex-wrap:wrap;gap:var(--space-3)}
  .guide-actions{display:flex;justify-content:space-between;gap:var(--space-3);margin-block:var(--space-5)}
  .guide-actions button{min-height:48px;white-space:normal}.total,.saved-draw{padding:var(--space-3);border-left:4px solid var(--accent)}
</style>
