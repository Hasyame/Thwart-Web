<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import { install, installer } from '../lib/install.svelte';
  import AlphaSignup from './AlphaSignup.svelte';
  const { t }: { t: Strings } = $props();
</script>

<!--
  One button where the browser can install by itself (Chrome, Edge, Samsung
  Internet), and the menu steps for the browsers that cannot be asked: Firefox
  on Android, and Safari, which is the only way onto an iPhone's home screen.
-->
{#if installer.installed}
  <p class="muted installed">{t.install.installed}</p>
{:else if installer.offer !== null}
  <p class="offer">
    <button type="button" class="btn btn--primary" onclick={() => void install()}>{t.install.button}</button>
  </p>
{/if}
<details class="install">
  <summary>{t.install.title}</summary>
  <p>{t.install.intro}</p>
  <h3>{t.install.androidTitle}</h3>
  <ol>
    <li>{t.install.androidOpen}</li>
    <li>{t.install.androidMenu}</li>
    <li>{t.install.androidFirefox}</li>
  </ol>
  <h3>{t.install.iosTitle}</h3>
  <ol>
    <li>{t.install.safari}</li>
    <li>{t.install.share}</li>
    <li>{t.install.add}</li>
  </ol>
  <p>{t.install.offline}</p>
  <p>{t.install.updates}</p>
</details>
<AlphaSignup {t} />

<style>
  .install { max-width: var(--prose-max); margin-block: var(--space-3); }
  summary { cursor: pointer; color: var(--accent); font-weight: var(--weight-semibold); min-height: var(--tap-min); align-content: center; }
  h3 { font-size: var(--text-base); margin: var(--space-3) 0 0; }
  p, ol { margin-block: var(--space-2); }
  ol { padding-left: 1.4rem; }
  li { margin-block: var(--space-2); }
  .offer, .installed { margin-block: var(--space-3) 0; }
</style>
