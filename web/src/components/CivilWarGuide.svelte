<script lang="ts">
  import type { Card, Locale } from '../lib/types';
  import { civilGuide, type CivilLeader, CIVIL_WAR } from '../lib/civilWar';
  import { cardHtml } from '../lib/cardText';
  import CardRef from './CardRef.svelte';
  interface Props {locale:Locale; cards:readonly Card[]; leader:CivilLeader; players:number; expert:boolean; competitive?:boolean; schemes?:readonly string[]; modules?:readonly string[]; setName?:(id:string)=>string; onReady?:()=>void; storageKey:string}
  const {locale,cards,leader,players,expert,competitive=false,schemes,modules,setName=(id)=>id,onReady,storageKey}:Props=$props();
  const fr=$derived(locale==='fr');
  const steps=$derived(civilGuide(locale,leader,players,expert,competitive,schemes));
  let position=$state(0);
  const shown=$derived(steps[Math.min(position,steps.length-1)]!);
  let heading=$state.raw<HTMLHeadingElement|null>(null);
  $effect(()=>{const key=storageKey;try{const n=Number(localStorage.getItem(key));position=Number.isInteger(n)&&n>=0&&n<steps.length?n:0;}catch{position=0;}});
  function move(n:number){position=n;try{localStorage.setItem(storageKey,String(n));}catch{/* Reading remains possible. */}heading?.focus();}
  const stages=$derived(cards.filter(c=>c.type_code==='leader'&&c.card_set_code===leader&&(expert?['III','IV']:['I','II']).includes(c.stage??'')));
  const references=$derived(shown.title===(fr?'Les stades du leader':'Leader stages')?stages.map(c=>c.code):shown.cards);
</script>
<section class="guide surface">
  {#if onReady}<button class="btn btn--primary ready" onclick={onReady}>{fr?'Je suis prêt à démarrer la partie':'I am ready to start'}</button>{/if}
  <label class="field-group"><span>{fr?'Préparation guidée':'Guided preparation'} · {position+1}/{steps.length}</span><select class="field" value={position} onchange={e=>move(Number(e.currentTarget.value))}>{#each steps as step,i}<option value={i}>{i+1}. {step.title}</option>{/each}</select></label>
  <progress max={steps.length} value={position+1} aria-label={fr?'Préparation':'Preparation'}></progress>
  {#if position<steps.length-1}<button class="btn" onclick={()=>move(position+1)}>{fr?'Continuer →':'Continue →'}</button>{/if}
  <h2 bind:this={heading} tabindex="-1">{shown.title}</h2>
  <ol>{#each shown.lines as line}<li>{line}</li>{/each}</ol>
  {#if position===2}
    {#each modules??CIVIL_WAR[leader].modules as code}<details><summary>{setName(code)}</summary><div class="refs">{#each cards.filter(c=>c.card_set_code===code) as card}<CardRef code={card.code} name={card.name}/>{/each}</div></details>{/each}
  {/if}
  {#each references as code}
    {@const card=cards.find(c=>c.code===code)}
    {#if card}<article><h3><CardRef {code} name={`${card.name}${card.stage?' · '+card.stage:''}`}/></h3>
      {#if card.type_code==='leader'}<p><strong>{(card.health??0)*players} {fr?'PV':'HP'}</strong></p>{/if}
      {#if typeof card.base_threat==='number'}<p>{fr?'Menace de départ':'Starting threat'} : {card.type_code==='main_scheme'&&card.stage==='1B'?(players>1?2*players:0):card.base_threat*(card.base_threat_fixed?1:players)}</p>{/if}
      <div class="card-text">{@html cardHtml(card.text??'')}</div></article>{/if}
  {/each}
  <p class="muted">mc56 · {competitive?'3–8, 14–17':'3–8'}</p>
  <div class="actions"><button class="btn" disabled={position===0} onclick={()=>move(position-1)}>{fr?'← Précédent':'← Previous'}</button>{#if position<steps.length-1}<button class="btn btn--primary" onclick={()=>move(position+1)}>{fr?'Continuer →':'Continue →'}</button>{:else if onReady}<button class="btn btn--primary" onclick={onReady}>{fr?'Démarrer':'Start'}</button>{/if}</div>
</section>
<style>
  .guide{padding:var(--space-4);margin-block:var(--space-4)}
  .ready{position:sticky;top:64px;z-index:2;width:100%;margin-bottom:var(--space-4);white-space:normal}
  progress{width:100%;accent-color:var(--accent);margin-block:12px}h2{margin-block:24px 16px}li{margin-bottom:16px;line-height:1.6}ol{padding-left:22px}
  article{padding:16px;border:1px solid var(--border);margin-block:12px}.card-text{white-space:pre-line;line-height:1.6}
  .actions,.refs{display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between}summary{min-height:44px;align-content:center}button{min-height:44px}
</style>
