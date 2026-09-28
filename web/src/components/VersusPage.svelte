<script lang="ts">

  import type {CardSet, IndexRow, Locale, Pack} from '../lib/types';

  import type {Strings} from '../lib/i18n';

  import CivilWarVersus from './CivilWarVersus.svelte';

  import LegacyVersusPage from './LegacyVersusPage.svelte';

  interface Props {t:Strings; cardLocale:Locale; sets:readonly CardSet[]; packs:readonly Pack[]; index:readonly IndexRow[]; ownedPacks:ReadonlySet<string>}

  const props:Props=$props();

  let other=$state(false);

</script>

{#if props.ownedPacks.has('cw')}

  <button class="btn" onclick={()=>other=!other}>{other?'Civil War':props.cardLocale==='fr'?'Autres boîtes':'Other boxes'}</button>

  {#if !other}<CivilWarVersus t={props.t} locale={props.cardLocale} sets={props.sets}/>{:else}<LegacyVersusPage {...props} sets={props.sets.filter(set=>set.packCode!=='cw')}/>{/if}

{:else}<LegacyVersusPage {...props} sets={props.sets.filter(set=>set.packCode!=='cw')}/>{/if}
