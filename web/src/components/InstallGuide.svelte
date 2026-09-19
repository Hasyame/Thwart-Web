<script lang="ts">
  import type { Strings } from '../lib/i18n';
  const { t }: { t: Strings } = $props();
</script>

<details class="install">
  <summary>{t.install.title}</summary>
  <p>{t.install.intro}</p>
  <ol>
    <li>{t.install.safari}</li>
    <li>{t.install.share}</li>
    <li>{t.install.add}</li>
  </ol>
  <p>{t.install.offline}</p>
  <p>{t.install.updates}</p>
</details>

<style>
  .install { max-width: var(--prose-max); margin-block: var(--space-3); }
  summary { cursor: pointer; color: var(--accent); font-weight: var(--weight-semibold); min-height: var(--tap-min); align-content: center; }
  p, ol { margin-block: var(--space-2); }
  ol { padding-left: 1.4rem; }
  li { margin-block: var(--space-2); }
</style>
