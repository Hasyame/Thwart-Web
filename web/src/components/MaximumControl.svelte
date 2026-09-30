<script lang="ts">
  import type { Strings } from '../lib/i18n';
  const {t, label, current, printed, onChange}: {
    t: Strings; label: string; current: number | null; printed: number | null;
    onChange: (value: number | null) => void;
  } = $props();
</script>

<details class="maximum">
  <summary>{label}: {current ?? '★'}</summary>
  <p class="muted">{t.trackerMaximumHint}</p>
  <div class="controls">
    {#each [-5, -1] as step (step)}
      <button type="button" class="btn" aria-label={`${label} ${step}`} disabled={current === null || current + step < 1} onclick={() => onChange((current ?? 1) + step)}>−{-step}</button>
    {/each}
    <label>
      <span class="caption">{label}</span>
      <input class="field" type="number" min="1" step="1" value={current ?? ''} onchange={event => {
        const value = Number(event.currentTarget.value);
        if (Number.isSafeInteger(value) && value > 0) onChange(value);
        else event.currentTarget.value = current?.toString() ?? '';
      }} />
    </label>
    {#each [1, 5] as step (step)}
      <button type="button" class="btn" aria-label={`${label} +${step}`} onclick={() => onChange((current ?? 0) + step)}>+{step}</button>
    {/each}
  </div>
  <button type="button" class="btn reset" onclick={() => onChange(null)}>{t.trackerPrintedMaximum}: {printed ?? '★'}</button>
</details>

<style>
  .maximum { margin-block: var(--space-3); }
  summary { cursor: pointer; font-weight: 600; padding-block: var(--space-2); }
  .controls { display: flex; align-items: end; flex-wrap: wrap; gap: var(--space-1); }
  label { flex: 1; min-width: 5rem; max-width: 9rem; }
  .caption { display: block; font-size: var(--text-xs); }
  input { width: 100%; box-sizing: border-box; }
  .controls button { min-height: 44px; min-width: 44px; }
  .reset { margin-top: var(--space-2); white-space: normal; }
  /* Its own surface and ink, not the panel's: the tracker draws this inside
     the dark scheme and villain panels, where a transparent button with the
     page's text colour was dark on dark in the light theme. */
  .controls button, .reset { background: var(--surface-1); color: var(--text); border: 1px solid var(--border); border-radius: 8px; }
  .controls button:is(:hover, :active, :focus-visible), .reset:is(:hover, :active, :focus-visible) { background: var(--surface-3); color: var(--text); }
</style>
