<script lang="ts">
  import {liveQuery} from 'dexie';
  import {db} from '../lib/db';
  import {stateOf, templateOf} from '../lib/campaign/store';
  import type {Strings} from '../lib/i18n';
  import type {IndexRow} from '../lib/types';
  import {aoaDeckOverlay} from '../lib/campaign/aoaDeckOverlay';
  import CardRef from './CardRef.svelte';
  let {deckId, t, index}: {deckId: string; t: Strings; index: readonly IndexRow[]} = $props();
  let grants = $state<{code:string; campaign:string; key:string; optional?:boolean}[]>([]);
  $effect(() => {
    const subscription = liveQuery(async () => {
      const rows = await db.campaignRuns.toArray();
      // Register events as a live dependency, including changes from a sync.
      await db.campaignEvents.toArray();
      const result: typeof grants = [];
      for (const run of rows) {
        if (templateOf(run) === null) continue;
        const state = await stateOf(run);
        const heroes = state?.heroes.filter(h => h.deckId === deckId || (h.deckId == null && h.id === deckId)) ?? [];
        if (state !== null) for (const hero of heroes) for (const card of aoaDeckOverlay(state)) {
          result.push({...card,campaign:run.name || run.templateName,key:`${run.id}.${hero.id}.${card.code}`});
        }
        for (const hero of heroes) for (const [list, byHero] of Object.entries(state?.heroCardLists ?? {})) {
          for (const [i, code] of (byHero[hero.id] ?? []).entries()) result.push({code,campaign:run.name || run.templateName,key:`${run.id}.${list}.${hero.id}.${i}`});
        }
      }
      return result;
    }).subscribe(value => {grants = value;});
    return () => subscription.unsubscribe();
  });
</script>
{#if grants.length > 0}
  <section class="surface rewards">
    <h2>{t.campaignDeckCards}</h2>
    <p>{t.campaignDeckCardsHint}</p>
    <ul>{#each grants as grant (grant.key)}<li><CardRef code={grant.code} name={index.find(c => c.code === grant.code)?.name ?? grant.code} /> <span class="muted">{grant.campaign}{grant.optional === undefined ? '' : ` · ${grant.optional ? t.campaignCardOptional : t.campaignCardRequired}`}</span></li>{/each}</ul>
  </section>
{/if}
<style>.rewards{padding:var(--space-4);margin-block:var(--space-4)}li{margin-block:var(--space-2)}li span{margin-inline-start:var(--space-2)}</style>
