<script lang="ts">
  import { session, updateEncounter } from '../lib/session.svelte';
  import CardRef from './CardRef.svelte';
  import type { Strings } from '../lib/i18n';
  let {t, cardName}: {t: Strings; cardName: (code: string) => string} = $props();
  const e = $derived(session.current.encounter);
  const code = $derived(session.current.scenarioCode);
  const gene = $derived(e?.progress.genePool ?? 4);
  function setGene(n: number): void { updateEncounter(e => ({...e, progress: {...e.progress, genePool: Math.max(0,n)}})); }
</script>
{#if e !== null && ['unus','apocalypse'].includes(code)}
  <section class="surface extra">
    <h2><CardRef code="45071" name={cardName('45071')} /></h2>
    {#if e.progress.genePool === undefined}
      <p>{t.genePoolOptional}</p>
      <div class="actions">{#each [0,1,2,3] as perPlayer}<button class="btn" onclick={() => setGene(4 + perPlayer * e.setup.players)}>{t.genePoolExtra.replace('{n}',String(perPlayer))}</button>{/each}</div>
    {/if}
    <label>{t.missionThreat}<input class="field" type="number" min="0" value={gene} onchange={event => setGene(Number(event.currentTarget.value) || 0)} /></label>
    <p>{t.genePoolTriggers}</p>
    {#if code === 'unus'}<p aria-live="polite">{gene >= 3 ? t.genePoolThree : ''} {gene >= 6 ? t.genePoolSix : ''} {gene >= 9 ? t.genePoolNine : ''}</p>{/if}
    <CardRef code="45069" name={cardName('45069')} />
  </section>
{/if}
{#if e !== null && code === 'dark_beast'}
  <section class="surface extra">
    <h2>{t.campaignSettingTitle}</h2>
    <p>{t.campaignEnvironmentHint}</p>
    <div class="actions">{#each ['45127','45133','45139'] as environment}
      <button class="btn" aria-pressed={e.progress.environment === environment} onclick={() => updateEncounter(e => ({...e,progress:{...e.progress,environment}}))}>{cardName(environment)}</button>
    {/each}</div>
    {#if e.progress.environment}<CardRef code={e.progress.environment} name={cardName(e.progress.environment)} />{/if}
  </section>
{/if}
<style>.extra {padding:var(--space-4);margin-block:var(--space-4)} .actions {display:flex;flex-wrap:wrap;gap:var(--space-2);margin-block:var(--space-3)}label{display:grid;gap:var(--space-2)}button[aria-pressed=true]{border:3px solid var(--accent)}</style>
